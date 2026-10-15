package stirling.software.proprietary.security.billing;

import java.io.IOException;
import java.math.BigDecimal;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

import stirling.software.proprietary.security.model.BillingPayment;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@Component
public class HalykEpayClient {
    private final BillingProperties properties;
    private final HttpClient http;
    private final JsonMapper json = JsonMapper.builder().build();

    @Autowired
    public HalykEpayClient(BillingProperties properties) {
        this(
                properties,
                HttpClient.newBuilder()
                        .connectTimeout(Duration.ofSeconds(10))
                        .followRedirects(HttpClient.Redirect.NEVER)
                        .build());
    }

    HalykEpayClient(BillingProperties properties, HttpClient http) {
        this.properties = properties;
        this.http = http;
    }

    public record Session(String scriptUrl, Map<String, Object> payment) {}

    public record BankStatus(
            String transactionId,
            String invoice,
            BigDecimal amount,
            String currency,
            String terminalId,
            String status) {}

    public Session session(BillingPayment payment, String email) {
        Map<String, String> fields = credentials();
        fields.put("invoiceID", payment.getHalykInvoice());
        fields.put("secret_hash", payment.getVerificationSecret());
        fields.put("amount", payment.getAmount().toPlainString());
        fields.put("currency", payment.getCurrency());
        fields.put("postLink", callbackUrl());
        fields.put("failurePostLink", callbackUrl());
        JsonNode auth = token(payment.isTesting(), fields);
        Map<String, Object> object = new LinkedHashMap<>();
        object.put("invoiceId", payment.getHalykInvoice());
        object.put("backLink", properties.baseUrl() + "/settings/plan?payment=" + payment.getId());
        object.put("failureBackLink", object.get("backLink"));
        object.put("autoBackLink", true);
        object.put("postLink", callbackUrl());
        object.put("failurePostLink", callbackUrl());
        object.put("language", "rus");
        object.put("description", "AziralPDF Pro: " + payment.getPlan().months() + " month(s)");
        object.put("terminal", payment.getTerminalId());
        object.put("amount", payment.getAmount());
        object.put("currency", payment.getCurrency());
        object.put("email", email);
        object.put(
                "auth",
                Map.of(
                        "access_token",
                        auth.path("access_token").asText(),
                        "token_type",
                        "Bearer",
                        "expires_in",
                        auth.path("expires_in").asInt(),
                        "refresh_token",
                        "",
                        "scope",
                        auth.path("scope").asText()));
        return new Session(
                payment.isTesting()
                        ? "https://test-epay.epayment.kz/payform/payment-api.js"
                        : "https://epay.homebank.kz/payform/payment-api.js",
                object);
    }

    public BankStatus status(BillingPayment payment) {
        String access = token(payment.isTesting(), credentials()).path("access_token").asText();
        String host =
                payment.isTesting()
                        ? "https://test-epay-api.epayment.kz"
                        : "https://epay-api.homebank.kz";
        JsonNode response =
                send(
                        HttpRequest.newBuilder(
                                        URI.create(
                                                host
                                                        + "/check-status/payment/transaction/"
                                                        + payment.getHalykInvoice()))
                                .header("Authorization", "Bearer " + access)
                                .GET());
        String code = response.path("resultCode").asText();
        if ("102".equals(code) || "107".equals(code)) return null;
        if (!"100".equals(code)) throw unavailable();
        JsonNode tx = response.path("transaction");
        try {
            String id = UUID.fromString(tx.path("id").asText()).toString();
            return new BankStatus(
                    id,
                    tx.path("invoiceID").asText(),
                    new BigDecimal(tx.path("amount").asText()),
                    tx.path("currency").asText(),
                    tx.path("terminalID").asText(),
                    tx.path("statusName").asText());
        } catch (IllegalArgumentException e) {
            throw unavailable();
        }
    }

    private Map<String, String> credentials() {
        Map<String, String> fields = new LinkedHashMap<>();
        fields.put("grant_type", "client_credentials");
        fields.put(
                "scope",
                "webapi usermanagement email_send verification statement statistics payment");
        fields.put("client_id", properties.getHalykClientId());
        fields.put("client_secret", properties.getHalykClientSecret());
        fields.put("terminal", properties.getHalykTerminalId());
        return fields;
    }

    private JsonNode token(boolean testing, Map<String, String> fields) {
        String host =
                testing ? "https://test-epay-oauth.epayment.kz" : "https://epay-oauth.homebank.kz";
        String body =
                fields.entrySet().stream()
                        .map(e -> encode(e.getKey()) + "=" + encode(e.getValue()))
                        .collect(java.util.stream.Collectors.joining("&"));
        JsonNode response =
                send(
                        HttpRequest.newBuilder(URI.create(host + "/oauth2/token"))
                                .header("Content-Type", "application/x-www-form-urlencoded")
                                .POST(HttpRequest.BodyPublishers.ofString(body)));
        if (!"Bearer".equalsIgnoreCase(response.path("token_type").asText())
                || response.path("access_token").asText().isBlank()
                || response.path("expires_in").asInt() <= 0) throw unavailable();
        return response;
    }

    private JsonNode send(HttpRequest.Builder request) {
        try {
            HttpResponse<String> response =
                    http.send(
                            request.timeout(Duration.ofSeconds(20))
                                    .header("Accept", "application/json")
                                    .build(),
                            HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() != 200 || response.body().length() > 65536)
                throw unavailable();
            return json.readTree(response.body());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw unavailable();
        } catch (IOException | tools.jackson.core.JacksonException e) {
            throw unavailable();
        }
    }

    private String callbackUrl() {
        return properties.baseUrl() + "/api/v1/billing/halyk/result";
    }

    private static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    private static ResponseStatusException unavailable() {
        return new ResponseStatusException(
                HttpStatus.BAD_GATEWAY, "The bank is temporarily unavailable. Please retry.");
    }
}
