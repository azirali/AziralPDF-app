import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import HalykCheckout from "@app/routes/HalykCheckout";
import {
  validCheckoutUrl,
  validHalykScriptUrl,
} from "@app/services/billingService";

const mocks = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("react-i18next", async (original) => ({
  ...(await original<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@app/services/billingService", async (original) => ({
  ...(await original<typeof import("@app/services/billingService")>()),
  billingService: { halykSession: mocks.session },
}));
function mount() {
  render(
    <MantineProvider>
      <MemoryRouter
        initialEntries={["/billing/halyk/10000000-0000-4000-a000-000000000000"]}
      >
        <Routes>
          <Route path="/billing/halyk/:id" element={<HalykCheckout />} />
        </Routes>
      </MemoryRouter>
    </MantineProvider>,
  );
}
beforeEach(() => vi.clearAllMocks());
describe("Halyk payment handoff", () => {
  it("accepts only exact bank script URLs and same-origin order routes", () => {
    expect(
      validHalykScriptUrl("https://epay.homebank.kz/payform/payment-api.js"),
    ).toBe(true);
    for (const value of [
      "https://epay.homebank.kz.evil.test/payform/payment-api.js",
      "javascript:alert(1)",
      "https://epay.homebank.kz/payform/payment-api.js?evil=1",
    ]) {
      expect(validHalykScriptUrl(value)).toBe(false);
    }
    expect(
      validCheckoutUrl(
        `${window.location.origin}/billing/halyk/10000000-0000-4000-a000-000000000000`,
      ),
    ).toBe(true);
    expect(
      validCheckoutUrl(
        "https://evil.test/billing/halyk/10000000-0000-4000-a000-000000000000",
      ),
    ).toBe(false);
  });
  it("requires a user action and refuses an untrusted script before loading", async () => {
    mocks.session.mockResolvedValue({
      scriptUrl: "https://evil.test/payment.js",
      payment: { amount: 1 },
    });
    mount();
    expect(mocks.session).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "aziralBilling.bankCheckoutButton" }),
    );
    await screen.findByRole("alert");
    expect(
      document.querySelector('script[src="https://evil.test/payment.js"]'),
    ).toBeNull();
  });
  it("shows a recoverable error if the authenticated session request fails", async () => {
    mocks.session.mockRejectedValue(new Error("not authorized"));
    mount();
    fireEvent.click(
      screen.getByRole("button", { name: "aziralBilling.bankCheckoutButton" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "aziralBilling.checkoutError",
      ),
    );
    expect(
      screen.getByRole("link", { name: "aziralBilling.managePlan" }),
    ).toHaveAttribute("href", "/settings/plan");
  });
});
