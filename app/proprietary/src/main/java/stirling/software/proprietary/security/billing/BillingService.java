package stirling.software.proprietary.security.billing;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.LocalDateTime;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

import jakarta.mail.internet.AddressException;
import jakarta.mail.internet.InternetAddress;

import lombok.extern.slf4j.Slf4j;

import stirling.software.proprietary.security.database.repository.BillingPaymentRepository;
import stirling.software.proprietary.security.database.repository.HalykInvoiceNumberRepository;
import stirling.software.proprietary.security.database.repository.UserRepository;
import stirling.software.proprietary.security.model.BillingPayment;
import stirling.software.proprietary.security.model.BillingPayment.Status;
import stirling.software.proprietary.security.model.HalykInvoiceNumber;
import stirling.software.proprietary.security.model.LicenseTier;
import stirling.software.proprietary.security.model.User;
import stirling.software.proprietary.security.service.EmailService;

@Service
@Slf4j
public class BillingService {
    public static final String TERMS_VERSION = "prepaid-v1";
    private final UserRepository users;
    private final BillingPaymentRepository payments;
    private final BillingProperties properties;
    private final FreedomPayClient gateway;
    private final TransactionTemplate transactions;
    private final Optional<EmailService> email;
    private final Clock clock;
    private final HalykEpayClient halyk;
    private final HalykInvoiceNumberRepository invoices;

    @Autowired
    public BillingService(
            UserRepository users,
            BillingPaymentRepository payments,
            BillingProperties properties,
            FreedomPayClient gateway,
            HalykEpayClient halyk,
            HalykInvoiceNumberRepository invoices,
            PlatformTransactionManager manager,
            Optional<EmailService> email) {
        this(
                users,
                payments,
                properties,
                gateway,
                halyk,
                invoices,
                manager,
                email,
                Clock.systemUTC());
    }

    BillingService(
            UserRepository users,
            BillingPaymentRepository payments,
            BillingProperties properties,
            FreedomPayClient gateway,
            HalykEpayClient halyk,
            HalykInvoiceNumberRepository invoices,
            PlatformTransactionManager manager,
            Optional<EmailService> email,
            Clock clock) {
        this.users = users;
        this.payments = payments;
        this.properties = properties;
        this.gateway = gateway;
        this.halyk = halyk;
        this.invoices = invoices;
        this.transactions = new TransactionTemplate(manager);
        this.email = email;
        this.clock = clock;
    }

    public record PaymentView(
            String id,
            BillingPlan plan,
            BillingProvider provider,
            BigDecimal amount,
            String currency,
            Status status,
            boolean testing,
            LocalDateTime createdAt,
            LocalDateTime expiresAt,
            LocalDateTime paidAt,
            LocalDateTime accessUntil,
            String checkoutUrl) {}

    private record Reservation(BillingPayment payment, boolean created, String email) {}

    public User user(String username) {
        if (username == null)
            throw error(HttpStatus.UNAUTHORIZED, "Sign in to manage your subscription.");
        return users.findByUsernameIgnoreCase(username)
                .orElseThrow(() -> error(HttpStatus.UNAUTHORIZED, "Account not found."));
    }

    public List<PaymentView> history(String username) {
        return payments.findTop20ByUserIdOrderByCreatedAtDesc(user(username).getId()).stream()
                .map(this::view)
                .toList();
    }

    public PaymentView get(String username, String id) {
        BillingPayment payment =
                payments.findById(id)
                        .filter(p -> p.getUserId().equals(user(username).getId()))
                        .orElseThrow(() -> error(HttpStatus.NOT_FOUND, "Payment not found."));
        refreshHalyk(payment);
        return view(payments.findById(id).orElseThrow());
    }

    public PaymentView checkout(
            String username,
            BillingPlan plan,
            UUID requestKey,
            boolean acceptedTerms,
            String termsVersion) {
        requireReady();
        if (!acceptedTerms || !TERMS_VERSION.equals(termsVersion))
            throw error(HttpStatus.BAD_REQUEST, "Accept the current payment terms.");
        User current = user(username);
        Reservation reservation =
                Objects.requireNonNull(
                        transactions.execute(
                                tx -> {
                                    User owner = lockUser(current.getId());
                                    Optional<BillingPayment> retry =
                                            payments.findByUserIdAndRequestKey(
                                                    owner.getId(), requestKey.toString());
                                    if (retry.isPresent()) {
                                        requireMatchingProvider(retry.get());
                                        if (retry.get().getPlan() != plan)
                                            throw error(
                                                    HttpStatus.CONFLICT,
                                                    "This payment attempt belongs to another plan.");
                                        return new Reservation(
                                                retry.get(), false, owner.getEmail());
                                    }
                                    if (owner.getEffectiveLicenseTier() == LicenseTier.ENTERPRISE
                                            || (owner.getEffectiveLicenseTier() == LicenseTier.PRO
                                                    && owner.getLicenseExpiresAt() == null)) {
                                        throw error(
                                                HttpStatus.CONFLICT,
                                                "Your account already has permanent or business access.");
                                    }
                                    if (!owner.isEnabled())
                                        throw error(HttpStatus.FORBIDDEN, "Account disabled.");
                                    Optional<BillingPayment> pending =
                                            payments
                                                    .findFirstByUserIdAndStatusInAndExpiresAtAfterOrderByCreatedAtDesc(
                                                            owner.getId(),
                                                            List.of(
                                                                    Status.CREATING,
                                                                    Status.PENDING,
                                                                    Status.AUTHORIZED),
                                                            now());
                                    if (pending.isPresent()) {
                                        requireMatchingProvider(pending.get());
                                        if (pending.get().getPlan() != plan)
                                            throw error(
                                                    HttpStatus.CONFLICT,
                                                    "Complete the existing payment before choosing another period.");
                                        return new Reservation(
                                                pending.get(), false, owner.getEmail());
                                    }
                                    if (payments.countByUserIdAndCreatedAtAfter(
                                                    owner.getId(), now().minusDays(1))
                                            >= 10)
                                        throw error(
                                                HttpStatus.TOO_MANY_REQUESTS,
                                                "Too many payment attempts. Please try again later.");
                                    validateEmail(owner.getEmail());
                                    BillingPayment payment = new BillingPayment();
                                    payment.setId(UUID.randomUUID().toString());
                                    payment.setUserId(owner.getId());
                                    payment.setRequestKey(requestKey.toString());
                                    payment.setPlan(plan);
                                    payment.setAmount(plan.amount(properties));
                                    payment.setTesting(properties.isTestMode());
                                    payment.setProvider(properties.getProvider());
                                    if (properties.getProvider() == BillingProvider.HALYK_EPAY) {
                                        long number =
                                                invoices.saveAndFlush(new HalykInvoiceNumber())
                                                        .getId();
                                        if (number > 999999)
                                            throw error(
                                                    HttpStatus.SERVICE_UNAVAILABLE,
                                                    "Payment invoice capacity reached. Contact support.");
                                        payment.setHalykInvoice(
                                                String.format(
                                                        java.util.Locale.ROOT, "%06d", number));
                                        byte[] secret = new byte[32];
                                        new SecureRandom().nextBytes(secret);
                                        payment.setVerificationSecret(
                                                HexFormat.of().formatHex(secret));
                                        payment.setTerminalId(properties.getHalykTerminalId());
                                    }
                                    payment.setStatus(Status.CREATING);
                                    payment.setCreatedAt(now());
                                    payment.setExpiresAt(now().plusMinutes(30));
                                    payment.setTermsVersion(TERMS_VERSION);
                                    payment.setTermsAcceptedAt(now());
                                    payments.saveAndFlush(payment);
                                    return new Reservation(payment, true, owner.getEmail());
                                }));
        if (!reservation.created()) return view(reservation.payment());
        FreedomPayClient.Checkout checkout;
        try {
            checkout =
                    reservation.payment().effectiveProvider() == BillingProvider.HALYK_EPAY
                            ? new FreedomPayClient.Checkout(
                                    null,
                                    properties.baseUrl()
                                            + "/billing/halyk/"
                                            + reservation.payment().getId())
                            : gateway.create(reservation.payment(), reservation.email());
        } catch (RuntimeException e) {
            transactions.executeWithoutResult(
                    tx -> {
                        lockUser(current.getId());
                        BillingPayment failed = lockPayment(reservation.payment().getId());
                        if (failed.getStatus() == Status.CREATING) {
                            failed.setStatus(Status.FAILED);
                            payments.save(failed);
                        }
                    });
            throw e;
        }
        return Objects.requireNonNull(
                transactions.execute(
                        tx -> {
                            lockUser(current.getId());
                            BillingPayment payment = lockPayment(reservation.payment().getId());
                            if (checkout.providerPaymentId() != null)
                                bindProviderId(payment, checkout.providerPaymentId());
                            payment.setCheckoutUrl(checkout.url());
                            if (payment.getStatus() == Status.CREATING)
                                payment.setStatus(Status.PENDING);
                            payments.save(payment);
                            return view(payment);
                        }));
    }

    public void callback(String kind, Map<String, String> fields) {
        requireReady();
        if (properties.getProvider() != BillingProvider.FREEDOM_PAY
                || !FreedomPayProtocol.verify(kind, fields, properties.getSecretKey()))
            throw error(HttpStatus.FORBIDDEN, "Invalid payment signature.");
        String id = fields.getOrDefault("pg_order_id", "");
        BillingPayment snapshot =
                payments.findById(id)
                        .orElseThrow(() -> error(HttpStatus.BAD_REQUEST, "Unknown payment."));
        transactions.executeWithoutResult(
                tx -> {
                    User owner = lockUser(snapshot.getUserId());
                    BillingPayment payment = lockPayment(id);
                    if (payment.effectiveProvider() != BillingProvider.FREEDOM_PAY)
                        throw error(HttpStatus.BAD_REQUEST, "Payment provider mismatch.");
                    validateCallback(payment, fields);
                    if ("check".equals(kind)) {
                        if (payment.getExpiresAt().isBefore(now())
                                || !owner.isEnabled()
                                || payment.getStatus() == Status.FAILED)
                            throw error(HttpStatus.CONFLICT, "Payment is no longer available.");
                        return;
                    }
                    String result = fields.get("pg_result");
                    if (!List.of("0", "1", "2").contains(result == null ? "" : result))
                        throw error(HttpStatus.BAD_REQUEST, "Invalid payment result.");
                    bindProviderId(payment, fields.get("pg_payment_id"));
                    if (payment.getStatus() == Status.PAID
                            || payment.getStatus() == Status.TEST_PAID) return;
                    if ("0".equals(result)) payment.setStatus(Status.FAILED);
                    else if ("2".equals(result)) payment.setStatus(Status.PENDING);
                    else if (!"1".equals(fields.get("pg_captured"))) {
                        // Authorization/hold is not a captured payment. Require one-stage clearing.
                        payment.setStatus(Status.AUTHORIZED);
                    } else {
                        markPaid(owner, payment);
                    }
                    payments.save(payment);
                });
    }

    private void markPaid(User owner, BillingPayment payment) {
        payment.setPaidAt(now());
        if (payment.isTesting()) payment.setStatus(Status.TEST_PAID);
        else {
            payment.setStatus(Status.PAID);
            // Preserve higher/permanent grants if an administrator changed access
            // during checkout.
            if (owner.getEffectiveLicenseTier() != LicenseTier.ENTERPRISE
                    && !(owner.getEffectiveLicenseTier() == LicenseTier.PRO
                            && owner.getLicenseExpiresAt() == null)) {
                LocalDateTime base = owner.getLicenseExpiresAt();
                if (base == null || base.isBefore(now())) base = now();
                LocalDateTime until = base.plusMonths(payment.getPlan().months());
                owner.setLicenseTier(LicenseTier.PRO);
                owner.setLicenseExpiresAt(until);
                payment.setAccessUntil(until);
                users.save(owner);
            }
            sendConfirmationAfterCommit(owner.getEmail(), payment);
        }
    }

    public HalykEpayClient.Session halykSession(String username, String id) {
        requireHalykReady();
        User owner = user(username);
        BillingPayment payment =
                transactions.execute(
                        tx -> {
                            lockUser(owner.getId());
                            BillingPayment p = lockPayment(id);
                            if (!p.getUserId().equals(owner.getId()))
                                throw error(HttpStatus.NOT_FOUND, "Payment not found.");
                            if (p.effectiveProvider() != BillingProvider.HALYK_EPAY
                                    || p.isTesting() != properties.isTestMode()
                                    || !properties.getHalykTerminalId().equals(p.getTerminalId())
                                    || p.getStatus() != Status.PENDING
                                    || !p.getExpiresAt().isAfter(now())
                                    || !owner.isEnabled())
                                throw error(HttpStatus.CONFLICT, "Payment is no longer available.");
                            if (p.getSessionCreatedAt() != null
                                    && p.getSessionCreatedAt().isAfter(now().minusSeconds(10)))
                                throw error(
                                        HttpStatus.TOO_MANY_REQUESTS,
                                        "Please wait before retrying payment.");
                            p.setSessionCreatedAt(now());
                            return payments.save(p);
                        });
        return halyk.session(Objects.requireNonNull(payment), owner.getEmail());
    }

    public void halykCallback(String invoice, String secret) {
        requireHalykReady();
        if (invoice == null
                || !invoice.matches("[0-9]{6}")
                || secret == null
                || secret.length() > 128)
            throw error(HttpStatus.BAD_REQUEST, "Invalid notification.");
        BillingPayment p =
                payments.findByHalykInvoice(invoice)
                        .orElseThrow(() -> error(HttpStatus.BAD_REQUEST, "Unknown payment."));
        byte[] expected =
                p.getVerificationSecret() == null
                        ? new byte[0]
                        : p.getVerificationSecret().getBytes(StandardCharsets.UTF_8);
        boolean valid =
                expected.length > 0
                        && MessageDigest.isEqual(expected, secret.getBytes(StandardCharsets.UTF_8));
        if (!valid && expected.length > 0) {
            try {
                valid =
                        MessageDigest.isEqual(
                                expected, java.util.Base64.getDecoder().decode(secret));
            } catch (IllegalArgumentException ignored) {
            }
        }
        if (!valid) throw error(HttpStatus.FORBIDDEN, "Invalid notification.");
        refreshHalyk(p);
    }

    @Scheduled(fixedDelay = 60000, initialDelay = 60000)
    public void reconcileHalyk() {
        if (!properties.isReady() || properties.getProvider() != BillingProvider.HALYK_EPAY) return;
        for (BillingPayment p :
                payments
                        .findTop20ByHalykInvoiceNotNullAndStatusInAndCreatedAtAfterOrderByLastCheckedAtAsc(
                                List.of(Status.PENDING, Status.AUTHORIZED), now().minusDays(2))) {
            try {
                refreshHalyk(p);
            } catch (RuntimeException e) {
                log.warn("Bank status check failed for order {}", p.getId());
            }
        }
    }

    private void refreshHalyk(BillingPayment snapshot) {
        if (snapshot.effectiveProvider() != BillingProvider.HALYK_EPAY
                || !properties.isReady()
                || properties.getProvider() != BillingProvider.HALYK_EPAY
                || snapshot.isTesting() != properties.isTestMode()
                || !properties.getHalykTerminalId().equals(snapshot.getTerminalId())) return;
        BillingPayment payment =
                transactions.execute(
                        tx -> {
                            lockUser(snapshot.getUserId());
                            BillingPayment p = lockPayment(snapshot.getId());
                            if (p.getStatus() != Status.PENDING
                                    && p.getStatus() != Status.AUTHORIZED) return null;
                            if (p.getLastCheckedAt() != null
                                    && p.getLastCheckedAt().isAfter(now().minusSeconds(5)))
                                return null;
                            p.setLastCheckedAt(now());
                            return payments.save(p);
                        });
        if (payment == null) return;
        HalykEpayClient.BankStatus bank = halyk.status(payment);
        if (bank == null) return;
        transactions.executeWithoutResult(
                tx -> {
                    User owner = lockUser(payment.getUserId());
                    BillingPayment p = lockPayment(payment.getId());
                    if (!p.getHalykInvoice().equals(bank.invoice())
                            || !p.getTerminalId().equalsIgnoreCase(bank.terminalId())
                            || p.getAmount().compareTo(bank.amount()) != 0
                            || !p.getCurrency().equals(bank.currency()))
                        throw error(
                                HttpStatus.BAD_GATEWAY,
                                "Bank payment details do not match the order.");
                    bindProviderId(p, bank.transactionId());
                    if (p.getStatus() == Status.PAID || p.getStatus() == Status.TEST_PAID) return;
                    switch (bank.status()) {
                        case "CHARGE" -> markPaid(owner, p);
                        case "AUTH" -> p.setStatus(Status.AUTHORIZED);
                        case "CANCEL", "CANCEL_OLD", "FAILED", "REJECT", "3D", "REFUND" ->
                                p.setStatus(Status.FAILED);
                        default -> {}
                    }
                    payments.save(p);
                });
    }

    private void requireHalykReady() {
        requireReady();
        if (properties.getProvider() != BillingProvider.HALYK_EPAY)
            throw error(HttpStatus.SERVICE_UNAVAILABLE, "Halyk ePay is not connected yet.");
    }

    private void validateCallback(BillingPayment payment, Map<String, String> fields) {
        try {
            if (new BigDecimal(fields.getOrDefault("pg_amount", "")).compareTo(payment.getAmount())
                            != 0
                    || !payment.getCurrency().equals(fields.get("pg_currency"))
                    || !(payment.isTesting() ? "1" : "0").equals(fields.get("pg_testing_mode"))
                    || (fields.containsKey("pg_merchant_id")
                            && !properties.getMerchantId().equals(fields.get("pg_merchant_id")))) {
                throw error(HttpStatus.BAD_REQUEST, "Payment details do not match the order.");
            }
        } catch (NumberFormatException e) {
            throw error(HttpStatus.BAD_REQUEST, "Invalid payment amount.");
        }
        String providerId = fields.getOrDefault("pg_payment_id", "");
        if (!providerId.matches("[0-9]{1,64}"))
            throw error(HttpStatus.BAD_REQUEST, "Invalid provider payment ID.");
        if (payment.getProviderPaymentId() != null
                && !payment.getProviderPaymentId().equals(providerId))
            throw error(HttpStatus.CONFLICT, "Provider payment ID mismatch.");
    }

    private void bindProviderId(BillingPayment payment, String id) {
        if (payment.getProviderPaymentId() != null && !payment.getProviderPaymentId().equals(id))
            throw error(HttpStatus.CONFLICT, "Provider payment ID mismatch.");
        payment.setProviderPaymentId(id);
    }

    private User lockUser(Long id) {
        return users.findForBilling(id)
                .orElseThrow(() -> error(HttpStatus.NOT_FOUND, "Account not found."));
    }

    private BillingPayment lockPayment(String id) {
        return payments.findForUpdate(id)
                .orElseThrow(() -> error(HttpStatus.NOT_FOUND, "Payment not found."));
    }

    private LocalDateTime now() {
        return LocalDateTime.now(clock);
    }

    private PaymentView view(BillingPayment p) {
        String url =
                properties.isReady()
                                && p.effectiveProvider() == properties.getProvider()
                                && p.isTesting() == properties.isTestMode()
                                && p.getExpiresAt().isAfter(now())
                                && p.getStatus() == Status.PENDING
                        ? p.getCheckoutUrl()
                        : null;
        return new PaymentView(
                p.getId(),
                p.getPlan(),
                p.effectiveProvider(),
                p.getAmount(),
                p.getCurrency(),
                p.getStatus(),
                p.isTesting(),
                p.getCreatedAt(),
                p.getExpiresAt(),
                p.getPaidAt(),
                p.getAccessUntil(),
                url);
    }

    private void requireMatchingProvider(BillingPayment p) {
        if (p.effectiveProvider() != properties.getProvider()
                || p.isTesting() != properties.isTestMode())
            throw error(
                    HttpStatus.CONFLICT,
                    "Payment settings have changed. Contact support about this order.");
    }

    private void requireReady() {
        if (!properties.isReady())
            throw error(HttpStatus.SERVICE_UNAVAILABLE, "Online payment is not connected yet.");
    }

    private static void validateEmail(String value) {
        try {
            if (value == null || value.isBlank()) throw new AddressException();
            InternetAddress address = new InternetAddress(value, true);
            address.validate();
            if (!value.equals(address.getAddress())) throw new AddressException();
        } catch (AddressException e) {
            throw error(
                    HttpStatus.UNPROCESSABLE_ENTITY,
                    "Add a valid email address to your account before payment.");
        }
    }

    private void sendConfirmationAfterCommit(String address, BillingPayment payment) {
        if (email.isEmpty() || address == null || address.isBlank()) return;
        String body =
                "<p>AziralPDF: payment confirmed.</p><p>Order: "
                        + payment.getId()
                        + "<br>Amount: "
                        + payment.getAmount().toPlainString()
                        + " KZT"
                        + (payment.getAccessUntil() == null
                                ? ""
                                : "<br>Pro active until: " + payment.getAccessUntil())
                        + "</p><p>Manage your plan: <a href=\""
                        + properties.baseUrl()
                        + "/settings/plan\">AziralPDF</a></p>";
        TransactionSynchronizationManager.registerSynchronization(
                new TransactionSynchronization() {
                    @Override
                    public void afterCommit() {
                        try {
                            email.orElseThrow()
                                    .sendSimpleMail(address, "AziralPDF: payment confirmed", body);
                        } catch (Exception e) {
                            log.warn(
                                    "Payment confirmation email failed for order {}",
                                    payment.getId());
                        }
                    }
                });
    }

    private static ResponseStatusException error(HttpStatus status, String message) {
        return new ResponseStatusException(status, message);
    }
}
