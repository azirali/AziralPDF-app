package stirling.software.proprietary.security.billing;

import java.math.BigDecimal;
import java.net.URI;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import lombok.Getter;
import lombok.Setter;

@Component
@ConfigurationProperties(prefix = "aziral.billing")
@Getter
@Setter
public class BillingProperties {
    private boolean enabled;
    private BillingProvider provider = BillingProvider.FREEDOM_PAY;
    private String halykClientId = "";
    private String halykClientSecret = "";
    private String halykTerminalId = "";
    private String merchantId = "";
    private String secretKey = "";
    private boolean testMode = true;
    private boolean applePayEnabled;
    private String publicBaseUrl = "https://pdf.aziral.com";
    private BigDecimal monthlyPrice = new BigDecimal("1990.00");
    private BigDecimal yearlyPrice = new BigDecimal("19900.00");

    public boolean isReady() {
        if (!enabled || provider == null) return false;
        if (provider == BillingProvider.FREEDOM_PAY
                && (merchantId == null
                        || !merchantId.matches("[0-9]+")
                        || secretKey == null
                        || secretKey.isBlank())) return false;
        if (provider == BillingProvider.HALYK_EPAY
                && (halykClientId == null
                        || halykClientId.isBlank()
                        || halykClientSecret == null
                        || halykClientSecret.isBlank()
                        || halykTerminalId == null
                        || !halykTerminalId.matches(
                                "[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}")))
            return false;
        try {
            URI uri = URI.create(publicBaseUrl);
            return "https".equals(uri.getScheme())
                    && uri.getHost() != null
                    && uri.getUserInfo() == null
                    && uri.getQuery() == null
                    && uri.getFragment() == null
                    && (uri.getPath().isEmpty() || "/".equals(uri.getPath()))
                    && validPrice(monthlyPrice)
                    && validPrice(yearlyPrice);
        } catch (IllegalArgumentException e) {
            return false;
        }
    }

    private boolean validPrice(BigDecimal amount) {
        return amount != null && amount.signum() > 0 && amount.scale() <= 2;
    }

    public String baseUrl() {
        return publicBaseUrl.replaceAll("/+$", "");
    }
}
