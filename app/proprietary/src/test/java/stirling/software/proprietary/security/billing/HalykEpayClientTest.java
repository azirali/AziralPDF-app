package stirling.software.proprietary.security.billing;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

import java.math.BigDecimal;
import java.net.http.*;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Flow;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.web.server.ResponseStatusException;

import stirling.software.proprietary.security.model.BillingPayment;

class HalykEpayClientTest {
    BillingProperties props = new BillingProperties();
    HttpClient http = mock(HttpClient.class);

    BillingPayment payment() {
        props.setHalykClientId("merchant");
        props.setHalykClientSecret("server-only-secret");
        props.setHalykTerminalId("67e34d63-102f-4bd1-898e-370781d0074d");
        BillingPayment p = new BillingPayment();
        p.setId("10000000-0000-4000-a000-000000000000");
        p.setHalykInvoice("000001");
        p.setTerminalId(props.getHalykTerminalId());
        p.setVerificationSecret("order-specific-secret");
        p.setAmount(new BigDecimal("1990.00"));
        p.setPlan(BillingPlan.PRO_MONTHLY);
        p.setTesting(true);
        return p;
    }

    HttpResponse<String> response(String body) {
        return new HttpResponse<>() {
            public int statusCode() {
                return 200;
            }

            public HttpRequest request() {
                return null;
            }

            public java.util.Optional<HttpResponse<String>> previousResponse() {
                return java.util.Optional.empty();
            }

            public HttpHeaders headers() {
                return HttpHeaders.of(java.util.Map.of(), (a, b) -> true);
            }

            public String body() {
                return body;
            }

            public java.util.Optional<javax.net.ssl.SSLSession> sslSession() {
                return java.util.Optional.empty();
            }

            public java.net.URI uri() {
                return java.net.URI.create("https://epay.homebank.kz");
            }

            public HttpClient.Version version() {
                return HttpClient.Version.HTTP_1_1;
            }
        };
    }

    String token() {
        return "{\"access_token\":\"scoped-token\",\"token_type\":\"Bearer\",\"expires_in\":7200,\"scope\":\"payment\"}";
    }

    @Test
    @SuppressWarnings("unchecked")
    void sessionScopesTokenToOrderAndNeverExposesServerSecretsOrEnablesRecurringCharges()
            throws Exception {
        var p = payment();
        when(http.send(any(HttpRequest.class), any(HttpResponse.BodyHandler.class)))
                .thenReturn(response(token()));
        var session = new HalykEpayClient(props, http).session(p, "owner@example.com");
        assertEquals("https://test-epay.epayment.kz/payform/payment-api.js", session.scriptUrl());
        assertEquals(p.getAmount(), session.payment().get("amount"));
        assertEquals("000001", session.payment().get("invoiceId"));
        assertFalse(session.payment().containsKey("recurrent"));
        assertFalse(session.payment().containsKey("cardSave"));
        assertFalse(session.payment().toString().contains("server-only-secret"));
        assertFalse(session.payment().toString().contains("order-specific-secret"));
        var capture = ArgumentCaptor.forClass(HttpRequest.class);
        verify(http).send(capture.capture(), any(HttpResponse.BodyHandler.class));
        assertEquals(
                "https://test-epay-oauth.epayment.kz/oauth2/token",
                capture.getValue().uri().toString());
        String body = body(capture.getValue());
        assertTrue(body.contains("invoiceID=000001"));
        assertTrue(body.contains("amount=1990.00"));
        assertTrue(body.contains("secret_hash=order-specific-secret"));
        assertTrue(body.contains("terminal=" + props.getHalykTerminalId()));
        assertTrue(
                body.contains(
                        "postLink=https%3A%2F%2Fpdf.aziral.com%2Fapi%2Fv1%2Fbilling%2Fhalyk%2Fresult"));
    }

    @Test
    @SuppressWarnings("unchecked")
    void statusUsesAuthenticatedBankApiAndTerminalUuidField() throws Exception {
        var p = payment();
        p.setTesting(false);
        when(http.send(any(HttpRequest.class), any(HttpResponse.BodyHandler.class)))
                .thenReturn(
                        response(token()),
                        response(
                                "{\"resultCode\":\"100\",\"transaction\":{\"id\":\"c46aa129-4569-4dfc-9b16-433226e879d4\",\"invoiceID\":\"000001\",\"amount\":1990,\"currency\":\"KZT\",\"terminal\":\"98120001\",\"terminalID\":\""
                                        + props.getHalykTerminalId()
                                        + "\",\"statusName\":\"AUTH\"}}"));
        var result = new HalykEpayClient(props, http).status(p);
        assertEquals("AUTH", result.status());
        assertEquals(props.getHalykTerminalId(), result.terminalId());
        var capture = ArgumentCaptor.forClass(HttpRequest.class);
        verify(http, times(2)).send(capture.capture(), any(HttpResponse.BodyHandler.class));
        var request = capture.getAllValues().get(1);
        assertEquals(
                "https://epay-api.homebank.kz/check-status/payment/transaction/000001",
                request.uri().toString());
        assertEquals(
                "Bearer scoped-token", request.headers().firstValue("Authorization").orElseThrow());
    }

    @Test
    @SuppressWarnings("unchecked")
    void failedOrMalformedBankResponseCannotBecomePaid() throws Exception {
        var p = payment();
        when(http.send(any(HttpRequest.class), any(HttpResponse.BodyHandler.class)))
                .thenReturn(
                        response(token()),
                        response("{\"resultCode\":\"102\",\"transaction\":null}"));
        assertNull(new HalykEpayClient(props, http).status(p));
        when(http.send(any(HttpRequest.class), any(HttpResponse.BodyHandler.class)))
                .thenReturn(response("{\"error\":\"invalid_client\"}"));
        assertThrows(
                ResponseStatusException.class,
                () -> new HalykEpayClient(props, http).session(p, "x@example.com"));
    }

    static String body(HttpRequest request) {
        var subscriber = HttpResponse.BodySubscribers.ofString(StandardCharsets.UTF_8);
        request.bodyPublisher()
                .orElseThrow()
                .subscribe(
                        new Flow.Subscriber<ByteBuffer>() {
                            public void onSubscribe(Flow.Subscription subscription) {
                                subscriber.onSubscribe(subscription);
                            }

                            public void onNext(ByteBuffer buffer) {
                                subscriber.onNext(java.util.List.of(buffer));
                            }

                            public void onError(Throwable t) {
                                subscriber.onError(t);
                            }

                            public void onComplete() {
                                subscriber.onComplete();
                            }
                        });
        return subscriber.getBody().toCompletableFuture().join();
    }
}
