package stirling.software.proprietary.security.billing;

import java.math.BigDecimal;

public enum BillingPlan {
    PRO_MONTHLY(1),
    PRO_YEARLY(12);

    private final int months;

    BillingPlan(int months) {
        this.months = months;
    }

    public int months() {
        return months;
    }

    public BigDecimal amount(BillingProperties properties) {
        return (this == PRO_MONTHLY ? properties.getMonthlyPrice() : properties.getYearlyPrice())
                .setScale(2);
    }
}
