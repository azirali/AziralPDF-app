import apiClient from "@app/services/apiClient";

export type BillingPlanId = "PRO_MONTHLY" | "PRO_YEARLY";
export type PaymentStatus =
  | "CREATING"
  | "PENDING"
  | "AUTHORIZED"
  | "PAID"
  | "TEST_PAID"
  | "FAILED";
export interface BillingOffer {
  id: BillingPlanId;
  months: number;
  amount: number;
  currency: string;
}
export interface BillingCatalog {
  checkoutEnabled: boolean;
  provider: "FREEDOM_PAY" | "HALYK_EPAY";
  testMode: boolean;
  applePayEnabled: boolean;
  freeDailyLimit: number;
  termsVersion: string;
  termsUrl: string;
  privacyUrl: string;
  plans: BillingOffer[];
}
export interface BillingPayment {
  id: string;
  plan: BillingPlanId;
  amount: number;
  currency: string;
  status: PaymentStatus;
  testing: boolean;
  createdAt: string;
  expiresAt: string;
  paidAt: string | null;
  accessUntil: string | null;
  checkoutUrl: string | null;
}
export interface HalykSession {
  scriptUrl: string;
  payment: Record<string, unknown>;
}
export function validHalykScriptUrl(url: string): boolean {
  return (
    url === "https://epay.homebank.kz/payform/payment-api.js" ||
    url === "https://test-epay.epayment.kz/payform/payment-api.js"
  );
}
export const billingService = {
  async halykSession(id: string): Promise<HalykSession> {
    return (
      await apiClient.post<HalykSession>(
        `/api/v1/billing/halyk/payments/${encodeURIComponent(id)}/session`,
        {},
        { suppressErrorToast: true },
      )
    ).data;
  },
  async catalog(): Promise<BillingCatalog> {
    return (
      await apiClient.get<BillingCatalog>("/api/v1/billing/catalog", {
        suppressErrorToast: true,
      })
    ).data;
  },
  async history(): Promise<BillingPayment[]> {
    return (
      await apiClient.get<BillingPayment[]>("/api/v1/billing/payments", {
        suppressErrorToast: true,
      })
    ).data;
  },
  async payment(id: string): Promise<BillingPayment> {
    return (
      await apiClient.get<BillingPayment>(
        `/api/v1/billing/payments/${encodeURIComponent(id)}`,
        { suppressErrorToast: true },
      )
    ).data;
  },
  async checkout(
    plan: BillingPlanId,
    requestKey: string,
    termsVersion: string,
  ): Promise<BillingPayment> {
    return (
      await apiClient.post<BillingPayment>(
        "/api/v1/billing/checkout",
        { plan, requestKey, acceptedTerms: true, termsVersion },
        { suppressErrorToast: true },
      )
    ).data;
  },
};
export function validCheckoutUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (
      url.origin === window.location.origin &&
      /^\/billing\/halyk\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
        url.pathname,
      ) &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password
    )
      return true;
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === "443") &&
      (url.hostname === "freedompay.kz" ||
        url.hostname.endsWith(".freedompay.kz"))
    );
  } catch {
    return false;
  }
}
export function isPaymentPending(status: PaymentStatus): boolean {
  return (
    status === "CREATING" || status === "PENDING" || status === "AUTHORIZED"
  );
}
