package stirling.software.proprietary.security.billing;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;
import java.util.stream.Collectors;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

import stirling.software.proprietary.security.model.BillingPayment;

@Component
public class FreedomPayClient {
    private final BillingProperties properties;
    private final HttpClient http;

    @Autowired
    public FreedomPayClient(BillingProperties properties) {
        this(
                properties,
                HttpClient.newBuilder()
                        .connectTimeout(Duration.ofSeconds(10))
                        .followRedirects(HttpClient.Redirect.NEVER)
                        .build());
    }

    FreedomPayClient(BillingProperties properties, HttpClient http) {
        this.properties = properties;
        this.http = http;
    }

    public record Checkout(String providerPaymentId, String url) {}

    public Checkout create(BillingPayment payment, String email) {
        Map<String, String> fields = new TreeMap<>();
        fields.put("pg_merchant_id", properties.getMerchantId());
        fields.put("pg_order_id", payment.getId());
        fields.put("pg_amount", payment.getAmount().toPlainString());
        fields.put("pg_currency", "KZT");
        fields.put("pg_description", "AziralPDF Pro: " + payment.getPlan().months() + " month(s)");
        fields.put("pg_result_url", properties.baseUrl() + "/api/v1/billing/freedompay/result");
        fields.put("pg_check_url", properties.baseUrl() + "/api/v1/billing/freedompay/check");
        fields.put("pg_request_method", "POST");
        String returnUrl = properties.baseUrl() + "/settings/plan?payment=" + payment.getId();
        fields.put("pg_success_url", returnUrl);
        fields.put("pg_failure_url", returnUrl);
        fields.put("pg_success_url_method", "GET");
        fields.put("pg_failure_url_method", "GET");
        fields.put("pg_testing_mode", payment.isTesting() ? "1" : "0");
        fields.put("pg_auto_clearing", "1");
        fields.put("pg_lifetime", "1800");
        fields.put("pg_user_id", payment.getUserId().toString());
        fields.put("pg_user_contact_email", email);
        fields.put("pg_salt", UUID.randomUUID().toString().replace("-", ""));
        fields.put(
                "pg_sig",
                FreedomPayProtocol.sign("init_payment.php", fields, properties.getSecretKey()));
        String body =
                fields.entrySet().stream()
                        .map(entry -> encode(entry.getKey()) + "=" + encode(entry.getValue()))
                        .collect(Collectors.joining("&"));
        HttpRequest request =
                HttpRequest.newBuilder(URI.create("https://api.freedompay.kz/init_payment.php"))
                        .timeout(Duration.ofSeconds(30))
                        .header("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8")
                        .POST(HttpRequest.BodyPublishers.ofString(body))
                        .build();
        try {
            HttpResponse<String> response =
                    http.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (response.statusCode() != 200)
                throw new IllegalArgumentException("Gateway HTTP error");
            Map<String, String> result = FreedomPayProtocol.parseXml(response.body());
            if (!FreedomPayProtocol.verify("init_payment.php", result, properties.getSecretKey())
                    || !"ok".equals(result.get("pg_status")))
                throw new IllegalArgumentException("Gateway rejected initialization");
            String id = result.getOrDefault("pg_payment_id", "");
            String url = result.getOrDefault("pg_redirect_url", "");
            if (!id.matches("[0-9]{1,64}") || !isAllowedCheckoutUrl(url))
                throw new IllegalArgumentException("Invalid checkout response");
            return new Checkout(id, url);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw unavailable();
        } catch (IOException | IllegalArgumentException e) {
            throw unavailable();
        }
    }

    public static boolean isAllowedCheckoutUrl(String url) {
        try {
            URI uri = URI.create(url);
            String host = uri.getHost();
            return "https".equals(uri.getScheme())
                    && host != null
                    && uri.getUserInfo() == null
                    && (uri.getPort() == -1 || uri.getPort() == 443)
                    && (host.equals("freedompay.kz") || host.endsWith(".freedompay.kz"));
        } catch (IllegalArgumentException e) {
            return false;
        }
    }

    private static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    private static ResponseStatusException unavailable() {
        return new ResponseStatusException(
                HttpStatus.BAD_GATEWAY, "Payment provider is unavailable. Please try again later.");
    }
}
