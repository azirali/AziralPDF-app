package stirling.software.proprietary.security.billing;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class BillingControllerTest {
    BillingService service;
    MockMvc mvc;
    BillingProperties properties;

    @BeforeEach
    void setup() {
        service = mock(BillingService.class);
        properties = new BillingProperties();
        mvc =
                MockMvcBuilders.standaloneSetup(new BillingController(service, properties, 20))
                        .build();
    }

    @Test
    void catalogIsPublicAndHasNoCredentialsOrEnabledWalletClaims() throws Exception {
        properties.setSecretKey("never-publish-this");
        mvc.perform(get("/api/v1/billing/catalog"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.checkoutEnabled").value(false))
                .andExpect(jsonPath("$.applePayEnabled").value(false))
                .andExpect(jsonPath("$.plans[0].amount").value(1990))
                .andExpect(jsonPath("$.plans[1].amount").value(19900))
                .andExpect(jsonPath("$.secretKey").doesNotExist())
                .andExpect(jsonPath("$.merchantId").doesNotExist());
    }

    @Test
    void checkoutAndHistoryRequireAPrincipal() throws Exception {
        mvc.perform(get("/api/v1/billing/payments")).andExpect(status().isUnauthorized());
        mvc.perform(
                        post("/api/v1/billing/checkout")
                                .contentType("application/json")
                                .content(
                                        "{\"plan\":\"PRO_MONTHLY\",\"requestKey\":\""
                                                + UUID.randomUUID()
                                                + "\",\"acceptedTerms\":true,\"termsVersion\":\"prepaid-v1\"}"))
                .andExpect(status().isUnauthorized());
        verifyNoInteractions(service);
    }

    @Test
    void clientCannotChooseTheUserOrPriceAndMustAcceptTerms() throws Exception {
        UUID key = UUID.randomUUID();
        String body =
                "{\"plan\":\"PRO_YEARLY\",\"requestKey\":\""
                        + key
                        + "\",\"acceptedTerms\":true,\"termsVersion\":\"prepaid-v1\",\"amount\":1,\"userId\":999}";
        mvc.perform(
                        post("/api/v1/billing/checkout")
                                .principal(() -> "alice")
                                .contentType("application/json")
                                .content(body))
                .andExpect(status().isOk());
        verify(service).checkout("alice", BillingPlan.PRO_YEARLY, key, true, "prepaid-v1");
        mvc.perform(
                        post("/api/v1/billing/checkout")
                                .principal(() -> "alice")
                                .contentType("application/json")
                                .content(body.replace("true", "false")))
                .andExpect(status().isBadRequest());
        verifyNoMoreInteractions(service);
    }

    @Test
    void duplicateWebhookParametersAreRejectedBeforeSignatureValidation() throws Exception {
        mvc.perform(
                        post("/api/v1/billing/freedompay/result")
                                .contentType("application/x-www-form-urlencoded")
                                .param("pg_amount", "1", "1990"))
                .andExpect(status().isBadRequest());
        verifyNoInteractions(service);
    }

    @Test
    void webhookAcknowledgesOnlyAfterServiceCommits() throws Exception {
        properties.setSecretKey("secret");
        mvc.perform(
                        post("/api/v1/billing/freedompay/result")
                                .contentType("application/x-www-form-urlencoded")
                                .param("pg_salt", "salt"))
                .andExpect(status().isOk())
                .andExpect(xpath("/response/pg_status").string("ok"));
        verify(service).callback(eq("result"), anyMap());
        doThrow(
                        new org.springframework.web.server.ResponseStatusException(
                                org.springframework.http.HttpStatus.FORBIDDEN))
                .when(service)
                .callback(eq("result"), anyMap());
        mvc.perform(
                        post("/api/v1/billing/freedompay/result")
                                .contentType("application/x-www-form-urlencoded")
                                .param("pg_salt", "salt"))
                .andExpect(status().isForbidden());
    }

    @Test
    void halykSessionRequiresOwnerAndIsNeverCached() throws Exception {
        mvc.perform(post("/api/v1/billing/halyk/payments/test/session"))
                .andExpect(status().isUnauthorized());
        mvc.perform(post("/api/v1/billing/halyk/payments/test/session").principal(() -> "alice"))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"));
        verify(service).halykSession("alice", "test");
    }

    @Test
    void halykNotificationIgnoresUntrustedSuccessAndCardFields() throws Exception {
        mvc.perform(
                        post("/api/v1/billing/halyk/result")
                                .contentType("application/json")
                                .content(
                                        "{\"invoiceId\":\"000001\",\"secret_hash\":\"secret\",\"code\":\"ok\",\"amount\":1,\"cardMask\":\"hidden\"}"))
                .andExpect(status().isOk());
        verify(service).halykCallback("000001", "secret");
    }
}
