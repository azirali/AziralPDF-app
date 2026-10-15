package stirling.software.proprietary.security.model;

import java.math.BigDecimal;
import java.time.LocalDateTime;

import jakarta.persistence.*;

import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import stirling.software.proprietary.security.billing.BillingPlan;
import stirling.software.proprietary.security.billing.BillingProvider;

@Entity
@Table(
        name = "aziral_billing_payments",
        uniqueConstraints = @UniqueConstraint(columnNames = {"user_id", "request_key"}),
        indexes = @Index(columnList = "user_id,created_at"))
@Getter
@Setter
@NoArgsConstructor
public class BillingPayment {
    public enum Status {
        CREATING,
        PENDING,
        AUTHORIZED,
        PAID,
        TEST_PAID,
        FAILED
    }

    @Id
    @Column(length = 36)
    private String id;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Column(name = "request_key", nullable = false, length = 36)
    private String requestKey;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private BillingPlan plan;

    @Column(nullable = false, precision = 12, scale = 2)
    private BigDecimal amount;

    @Column(nullable = false, length = 3)
    private String currency = "KZT";

    @Column(nullable = false)
    private boolean testing;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Status status;

    @Column(name = "provider_payment_id", unique = true, length = 64)
    private String providerPaymentId;

    @Enumerated(EnumType.STRING)
    private BillingProvider provider;

    @Column(unique = true, length = 6)
    private String halykInvoice;

    @Column(length = 64)
    private String verificationSecret;

    private String terminalId;
    private LocalDateTime lastCheckedAt;
    private LocalDateTime sessionCreatedAt;

    public BillingProvider effectiveProvider() {
        return provider == null ? BillingProvider.FREEDOM_PAY : provider;
    }

    @Column(length = 2048)
    private String checkoutUrl;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    @Column(nullable = false)
    private LocalDateTime expiresAt;

    private LocalDateTime paidAt;
    private LocalDateTime accessUntil;

    @Column(nullable = false)
    private LocalDateTime termsAcceptedAt;

    @Column(nullable = false)
    private String termsVersion;
}
