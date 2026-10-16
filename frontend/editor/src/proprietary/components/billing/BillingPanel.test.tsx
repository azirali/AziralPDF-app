import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInstance } from "i18next";
import { parse } from "smol-toml";
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
  t: vi.fn((key: string, _options?: Record<string, unknown>) => key),
  language: "en-GB",
}));
vi.mock("react-i18next", async (original) => ({
  ...(await original<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: mocks.t, i18n: { language: mocks.language } }),
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
  mocks.t.mockImplementation((key: string) => key);
  mocks.language = "en-GB";
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
    expect(screen.getAllByText("aziralBilling.freePlan")).toHaveLength(2);
  });
  it("labels test payments without claiming that Pro was activated", async () => {
    mocks.payment.mockResolvedValue({
      ...order,
      status: "TEST_PAID",
      testing: true,
    });
    mount(`/settings/plan?payment=${order.id}`);
    await screen.findByText("aziralBilling.result.TEST_PAID");
    expect(screen.getAllByText("aziralBilling.freePlan")).toHaveLength(2);
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

describe("Russian billing interface", () => {
  beforeEach(async () => {
    const translator = createInstance();
    await translator.init({
      lng: "ru-RU",
      fallbackLng: false,
      resources: {
        "ru-RU": {
          translation: parse(
            readFileSync(
              resolve(
                process.cwd(),
                "editor/public/locales/ru-RU/translation.toml",
              ),
              "utf8",
            ),
          ),
        },
      },
    });
    mocks.language = "ru-RU";
    mocks.t.mockImplementation((key, options) => translator.t(key, options));
  });

  it("shows Russian public plans, periods, prices and unavailable payment notice", async () => {
    mocks.catalog.mockResolvedValue({ ...catalog, checkoutEnabled: false });
    mount("/pricing", true);
    await screen.findByRole("heading", {
      name: "Выберите тариф для работы с PDF",
    });
    expect(
      screen.getByRole("heading", { name: "Бесплатный" }),
    ).toBeInTheDocument();
    expect(screen.getByText("20 операций в день")).toBeInTheDocument();
    expect(screen.getByText(/Подключаем онлайн-оплату/)).toBeInTheDocument();
    expect(screen.getByText(/1\s990/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "На год" }));
    expect(screen.getByText(/19\s900/)).toBeInTheDocument();
    expect(screen.getByText("12 месяцев по цене 10")).toBeInTheDocument();
    expect(screen.queryByText(/aziralBilling\./)).not.toBeInTheDocument();
  });

  it("translates account tier, consent and checkout errors", async () => {
    mocks.checkout.mockRejectedValue(new Error("Provider unavailable"));
    mount();
    await screen.findByRole("heading", { name: "Pro" });
    expect(screen.getAllByText("Бесплатный")).toHaveLength(2);
    expect(
      screen.getByRole("checkbox", {
        name: "Я принимаю условия публичной оферты",
      }),
    ).not.toBeChecked();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /Оплатить.*за месяц/ }));
    await screen.findByText(/Не удалось открыть страницу оплаты/);
    expect(screen.queryByText("FREE")).not.toBeInTheDocument();
  });

  it.each([
    ["PENDING", "Ожидает оплаты", "Ожидаем подтверждения оплаты."],
    ["PAID", "Оплачен", "Оплата подтверждена."],
    ["TEST_PAID", "Тестовый платёж", "Тестовый платёж подтверждён."],
    ["FAILED", "Ошибка оплаты", "Оплата не завершена."],
  ] as const)(
    "translates %s payment history and return message",
    async (status, label, message) => {
      mocks.history.mockResolvedValue([{ ...order, status }]);
      mocks.payment.mockResolvedValue({ ...order, status });
      mount(`/settings/plan?payment=${order.id}`);
      await screen.findByText(new RegExp(message));
      expect(screen.getByText(label)).toBeInTheDocument();
      expect(screen.getByText("История платежей")).toBeInTheDocument();
    },
  );
});
