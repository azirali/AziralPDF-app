package stirling.software.proprietary.security.billing;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

import stirling.software.proprietary.security.model.BillingPayment;

class FreedomPayProtocolTest {
    @Test
    void matchesPublishedFreedomPaySignatureVector() {
        Map<String, String> fields = new LinkedHashMap<>();
        fields.put("pg_merchant_id", "12345");
        fields.put("pg_order_id", "order_1001");
        fields.put("pg_amount", "100");
        fields.put("pg_currency", "KZT");
        fields.put("pg_description", "Order #1001");
        fields.put("pg_card_name", "IVAN IVANOV");
        fields.put("pg_card_pan", "4716047261941981");
        fields.put("pg_card_cvc", "123");
        fields.put("pg_card_month", "12");
        fields.put("pg_card_year", "30");
        fields.put("pg_user_phone", "77777777777");
        fields.put("pg_user_email", "user@example.com");
        fields.put("pg_salt", "a1b2c3d4");
        assertEquals(
                "b7ccbf6b20dc8125c70aa4e21617a2c0",
                FreedomPayProtocol.sign("payment", fields, "test_secret_key"));
    }

    @Test
    void signatureCoversAmountCurrencyAndCallbackPath() {
        Map<String, String> fields =
                new LinkedHashMap<>(
                        Map.of("pg_amount", "1990.00", "pg_currency", "KZT", "pg_salt", "random"));
        fields.put("pg_sig", FreedomPayProtocol.sign("result", fields, "secret"));
        assertTrue(FreedomPayProtocol.verify("result", fields, "secret"));
        assertFalse(FreedomPayProtocol.verify("check", fields, "secret"));
        fields.put("pg_amount", "1.00");
        assertFalse(FreedomPayProtocol.verify("result", fields, "secret"));
        assertFalse(FreedomPayProtocol.verify("result", fields, ""));
    }

    @Test
    void xmlCannotLoadExternalEntitiesOrDuplicateSignedFields() {
        assertThrows(
                IllegalArgumentException.class,
                () ->
                        FreedomPayProtocol.parseXml(
                                "<!DOCTYPE response [<!ENTITY ex SYSTEM 'file:///etc/passwd'>]><response><pg_status>&ex;</pg_status></response>"));
        assertThrows(
                IllegalArgumentException.class,
                () ->
                        FreedomPayProtocol.parseXml(
                                "<response><pg_amount>1</pg_amount><pg_amount>1990</pg_amount></response>"));
        assertThrows(
                IllegalArgumentException.class,
                () ->
                        FreedomPayProtocol.parseXml(
                                "<response><item><pg_amount>1</pg_amount></item></response>"));
    }

    @Test
    void acknowledgementIsSignedAndParseable() {
        Map<String, String> fields =
                FreedomPayProtocol.parseXml(
                        FreedomPayProtocol.acknowledgment("result", "ok", "secret"));
        assertEquals("ok", fields.get("pg_status"));
        assertTrue(FreedomPayProtocol.verify("result", fields, "secret"));
    }

    @Test
    void checkoutRedirectsStayOnProviderHttpsOrigins() {
        assertTrue(
                FreedomPayClient.isAllowedCheckoutUrl("https://customer.freedompay.kz/pay?id=1"));
        for (String url :
                new String[] {
                    "https://freedompay.kz.evil.test/pay",
                    "http://customer.freedompay.kz",
                    "https://freedompay.kz@evil.test",
                    "https://customer.freedompay.kz:8080",
                    "javascript:alert(1)",
                    "/pay"
                }) {
            assertFalse(FreedomPayClient.isAllowedCheckoutUrl(url), url);
        }
    }

    @Test
    @SuppressWarnings("unchecked")
    void signedInitializationAndResponseAreVerified() throws Exception {
        BillingProperties props = new BillingProperties();
        props.setMerchantId("12345");
        props.setSecretKey("secret");
        HttpClient http = mock(HttpClient.class);
        HttpResponse<String> response = mock(HttpResponse.class);
        when(response.statusCode()).thenReturn(200);
        Map<String, String> fields =
                new LinkedHashMap<>(
                        Map.of(
                                "pg_status",
                                "ok",
                                "pg_payment_id",
                                "123",
                                "pg_redirect_url",
                                "https://customer.freedompay.kz/pay?id=123",
                                "pg_salt",
                                "random"));
        fields.put("pg_sig", FreedomPayProtocol.sign("init_payment.php", fields, "secret"));
        StringBuilder xml = new StringBuilder("<response>");
        fields.forEach(
                (k, v) ->
                        xml.append('<')
                                .append(k)
                                .append('>')
                                .append(v)
                                .append("</")
                                .append(k)
                                .append('>'));
        xml.append("</response>");
        when(response.body()).thenReturn(xml.toString());
        when(http.send(any(HttpRequest.class), any(HttpResponse.BodyHandler.class)))
                .thenReturn(response);
        BillingPayment payment = new BillingPayment();
        payment.setId("order");
        payment.setUserId(7L);
        payment.setAmount(new java.math.BigDecimal("1990.00"));
        payment.setPlan(BillingPlan.PRO_MONTHLY);
        FreedomPayClient client = new FreedomPayClient(props, http);
        assertEquals("123", client.create(payment, "customer@example.com").providerPaymentId());
        var captor = org.mockito.ArgumentCaptor.forClass(HttpRequest.class);
        verify(http).send(captor.capture(), any(HttpResponse.BodyHandler.class));
        HttpRequest request = captor.getValue();
        assertEquals("https://api.freedompay.kz/init_payment.php", request.uri().toString());
        var subscriber = HttpResponse.BodySubscribers.ofString(StandardCharsets.UTF_8);
        request.bodyPublisher()
                .orElseThrow()
                .subscribe(
                        new java.util.concurrent.Flow.Subscriber<java.nio.ByteBuffer>() {
                            public void onSubscribe(
                                    java.util.concurrent.Flow.Subscription subscription) {
                                subscriber.onSubscribe(subscription);
                            }

                            public void onNext(java.nio.ByteBuffer buffer) {
                                subscriber.onNext(java.util.List.of(buffer));
                            }

                            public void onError(Throwable error) {
                                subscriber.onError(error);
                            }

                            public void onComplete() {
                                subscriber.onComplete();
                            }
                        });
        String body = subscriber.getBody().toCompletableFuture().get();
        Map<String, String> sent = new LinkedHashMap<>();
        for (String pair : body.split("&")) {
            String[] parts = pair.split("=", 2);
            sent.put(
                    java.net.URLDecoder.decode(parts[0], StandardCharsets.UTF_8),
                    java.net.URLDecoder.decode(parts[1], StandardCharsets.UTF_8));
        }
        assertEquals("1990.00", sent.get("pg_amount"));
        assertEquals("KZT", sent.get("pg_currency"));
        assertEquals("1", sent.get("pg_auto_clearing"));
        assertTrue(FreedomPayProtocol.verify("init_payment.php", sent, "secret"));
        assertFalse(sent.containsKey("pg_recurring_start"));
        assertFalse(sent.containsValue("secret"));
        when(response.body()).thenReturn(xml.toString().replace("id=123", "id=999"));
        assertThrows(
                ResponseStatusException.class,
                () -> client.create(payment, "customer@example.com"));
    }
}
