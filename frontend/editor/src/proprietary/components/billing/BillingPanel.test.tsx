import { randomUUID } from "node:crypto";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BillingPanel from "@app/components/billing/BillingPanel";
import type {
  BillingCatalog,
  BillingPayment,
} from "@app/services/billingService";

const mocks = vi.hoisted(() => ({
  catalog: vi.fn(),
  history: vi.fn(),
  payment: vi.fn(),
  checkout: vi.fn(),
  license: vi.fn(),
  t: (key: string) => key,
}));
vi.mock("react-i18next", async (original) => ({
  ...(await original<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: mocks.t, i18n: { language: "en-GB" } }),
}));
vi.mock("@app/components/shared/LocalIcon", () => ({ default: () => null }));
vi.mock("@app/services/subscriptionService", () => ({
  subscriptionService: { getMyLicense: mocks.license },
}));
vi.mock("@app/services/billingService", async (original) => ({
  ...(await original<typeof import("@app/services/billingService")>()),
  billingService: {
    catalog: mocks.catalog,
    history: mocks.history,
    payment: mocks.payment,
    checkout: mocks.checkout,
  },
}));
const catalog: BillingCatalog = {
  checkoutEnabled: true,
  provider: "FREEDOM_PAY",
  testMode: false,
  applePayEnabled: false,
  freeDailyLimit: 20,
  termsVersion: "prepaid-v1",
  termsUrl: "https://pdf.aziral.com/legal/offer",
  privacyUrl: "https://pdf.aziral.com/legal/privacy",
  plans: [
    { id: "PRO_MONTHLY", months: 1, amount: 1990, currency: "KZT" },
    { id: "PRO_YEARLY", months: 12, amount: 19900, currency: "KZT" },
  ],
};
const order: BillingPayment = {
  id: "10000000-0000-4000-a000-000000000000",
  plan: "PRO_MONTHLY",
  amount: 1990,
  currency: "KZT",
  status: "PENDING",
  testing: false,
  createdAt: "2026-10-15T12:00:00",
  expiresAt: "2026-10-15T12:30:00",
  paidAt: null,
  accessUntil: null,
  checkoutUrl: null,
};
function mount(path = "/settings/plan", publicPage = false) {
  return render(
    <MantineProvider>
      <MemoryRouter initialEntries={[path]}>
        <BillingPanel publicPage={publicPage} />
      </MemoryRouter>
    </MantineProvider>,
  );
}
async function loaded() {
  await screen.findByRole("heading", { name: "Pro" });
}
beforeEach(() => {
  Object.defineProperty(crypto, "randomUUID", {
    value: randomUUID,
    configurable: true,
  });
  vi.clearAllMocks();
  mocks.catalog.mockResolvedValue(catalog);
  mocks.history.mockResolvedValue([]);
  mocks.license.mockResolvedValue({
    tier: "FREE",
    storedTier: "FREE",
    expiresAt: null,
  });
  mocks.payment.mockResolvedValue(order);
  mocks.checkout.mockResolvedValue({ ...order, status: "PAID" });
});
describe("AziralPDF billing", () => {
  it("shows pricing publicly without requesting private account data", async () => {
    mount("/pricing", true);
    await loaded();
    expect(mocks.history).not.toHaveBeenCalled();
    expect(mocks.license).not.toHaveBeenCalled();
    expect(
      screen.getByRole("link", { name: "aziralBilling.choosePro" }),
    ).toHaveAttribute("href", "/settings/plan");
  });
  it("blocks checkout until the provider is connected", async () => {
    mocks.catalog.mockResolvedValue({ ...catalog, checkoutEnabled: false });
    mount();
    await loaded();
    expect(screen.getByText("aziralBilling.notConnected")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "aziralBilling.pay" }),
    ).toBeDisabled();
    expect(screen.getByRole("checkbox")).toBeDisabled();
  });
  it("requires explicit terms acceptance and sends no client-controlled amount", async () => {
    mount();
    await loaded();
    const pay = screen.getByRole("button", { name: "aziralBilling.pay" });
    expect(pay).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(pay);
    await waitFor(() =>
      expect(mocks.checkout).toHaveBeenCalledWith(
        "PRO_MONTHLY",
        expect.any(String),
        "prepaid-v1",
      ),
    );
  });
  it("clears consent when switching to an annual payment", async () => {
    mount();
    await loaded();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(
      screen.getByRole("radio", { name: "aziralBilling.yearly" }),
    );
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(
      screen.getByRole("button", { name: "aziralBilling.pay" }),
    ).toBeDisabled();
  });
  it("does not trust a success query parameter or a pending provider payment", async () => {
    mount(`/settings/plan?payment=${order.id}&pg_result=1`);
    await loaded();
    await screen.findByText("aziralBilling.result.PENDING");
    expect(
      screen.queryByText("aziralBilling.result.PAID"),
    ).not.toBeInTheDocument();
    expect(mocks.checkout).not.toHaveBeenCalled();
    expect(screen.getByText("FREE")).toBeInTheDocument();
  });
  it("labels test payments without claiming that Pro was activated", async () => {
    mocks.payment.mockResolvedValue({
      ...order,
      status: "TEST_PAID",
      testing: true,
    });
    mount(`/settings/plan?payment=${order.id}`);
    await screen.findByText("aziralBilling.result.TEST_PAID");
    expect(screen.getByText("FREE")).toBeInTheDocument();
    expect(
      screen.queryByText("aziralBilling.result.PAID"),
    ).not.toBeInTheDocument();
  });
  it("rejects checkout destinations outside the payment provider", async () => {
    mocks.checkout.mockResolvedValue({
      ...order,
      checkoutUrl: "https://evil.example/pay",
    });
    mount();
    await loaded();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "aziralBilling.pay" }));
    await screen.findByText("aziralBilling.checkoutError");
  });
  it("keeps permanent grants out of unnecessary checkout", async () => {
    mocks.license.mockResolvedValue({
      tier: "PRO",
      storedTier: "PRO",
      expiresAt: null,
    });
    mount();
    await loaded();
    expect(
      screen.getByRole("button", { name: "aziralBilling.accessIncluded" }),
    ).toBeDisabled();
  });
});
