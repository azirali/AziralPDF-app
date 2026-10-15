package stirling.software.proprietary.security.billing;

import java.security.Principal;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import jakarta.validation.Valid;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import stirling.software.proprietary.security.billing.BillingService.PaymentView;

@RestController
@RequestMapping("/api/v1/billing")
public class BillingController {
    private final BillingService service;
    private final BillingProperties properties;
    private final int freeDailyLimit;

    public BillingController(
            BillingService service,
            BillingProperties properties,
            @Value("${aziral.free-daily-limit:20}") int freeDailyLimit) {
        this.service = service;
        this.properties = properties;
        this.freeDailyLimit = freeDailyLimit;
    }

    public record Offer(BillingPlan id, int months, java.math.BigDecimal amount, String currency) {}

    public record Catalog(
            boolean checkoutEnabled,
            BillingProvider provider,
            boolean testMode,
            boolean applePayEnabled,
            int freeDailyLimit,
            String termsVersion,
            String termsUrl,
            String privacyUrl,
            List<Offer> plans) {}

    public record CheckoutRequest(
            @NotNull BillingPlan plan,
            @NotNull UUID requestKey,
            @AssertTrue boolean acceptedTerms,
            @NotBlank String termsVersion) {}

    @GetMapping("/catalog")
    public Catalog catalog() {
        return new Catalog(
                properties.isReady(),
                properties.getProvider(),
                properties.isTestMode(),
                properties.isReady() && properties.isApplePayEnabled(),
                freeDailyLimit,
                BillingService.TERMS_VERSION,
                properties.baseUrl() + "/legal/offer",
                properties.baseUrl() + "/legal/privacy",
                List.of(BillingPlan.values()).stream()
                        .map(plan -> new Offer(plan, plan.months(), plan.amount(properties), "KZT"))
                        .toList());
    }

    @GetMapping("/payments")
    public List<PaymentView> history(Principal principal) {
        return service.history(username(principal));
    }

    @GetMapping("/payments/{id}")
    public PaymentView payment(@PathVariable String id, Principal principal) {
        return service.get(username(principal), id);
    }

    @PostMapping(value = "/checkout", consumes = MediaType.APPLICATION_JSON_VALUE)
    public PaymentView checkout(@Valid @RequestBody CheckoutRequest request, Principal principal) {
        return service.checkout(
                username(principal),
                request.plan(),
                request.requestKey(),
                request.acceptedTerms(),
                request.termsVersion());
    }

    @PostMapping(
            value = "/freedompay/{kind:check|result}",
            consumes = {
                MediaType.APPLICATION_FORM_URLENCODED_VALUE,
                MediaType.MULTIPART_FORM_DATA_VALUE
            },
            produces = MediaType.APPLICATION_XML_VALUE)
    public ResponseEntity<String> callback(
            @PathVariable String kind, @RequestParam MultiValueMap<String, String> parameters) {
        if (parameters.size() > 100) throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
        Map<String, String> fields = new LinkedHashMap<>();
        parameters.forEach(
                (name, values) -> {
                    if (values.size() != 1
                            || name.length() > 128
                            || values.getFirst() == null
                            || values.getFirst().length() > 4096)
                        throw new ResponseStatusException(
                                HttpStatus.BAD_REQUEST, "Ambiguous payment fields.");
                    fields.put(name, values.getFirst());
                });
        service.callback(kind, fields);
        return ResponseEntity.ok(
                FreedomPayProtocol.acknowledgment(kind, "ok", properties.getSecretKey()));
    }

    @PostMapping("/halyk/payments/{id}/session")
    public ResponseEntity<HalykEpayClient.Session> halykSession(
            @PathVariable String id, Principal principal) {
        return ResponseEntity.ok()
                .cacheControl(org.springframework.http.CacheControl.noStore())
                .body(service.halykSession(username(principal), id));
    }

    @com.fasterxml.jackson.annotation.JsonIgnoreProperties(ignoreUnknown = true)
    public record HalykNotification(String invoiceId, String secret_hash) {}

    @PostMapping(value = "/halyk/result", consumes = MediaType.APPLICATION_JSON_VALUE)
    public void halykResult(@RequestBody HalykNotification notification) {
        service.halykCallback(notification.invoiceId(), notification.secret_hash());
    }

    private String username(Principal principal) {
        if (principal == null) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        return principal.getName();
    }
}
