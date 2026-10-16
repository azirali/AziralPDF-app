import { render, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Pricing from "@app/routes/Pricing";

const mocks = vi.hoisted(() => ({ get: vi.fn(), language: vi.fn() }));
vi.mock("@app/services/apiClient", () => ({ default: { get: mocks.get } }));
vi.mock("@app/i18n", () => ({ updateSupportedLanguages: mocks.language }));
vi.mock("@app/components/billing/BillingPanel", () => ({
  default: () => null,
}));

const mount = () =>
  render(
    <MantineProvider>
      <MemoryRouter>
        <Pricing />
      </MemoryRouter>
    </MantineProvider>,
  );

describe("public pricing language", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  it("applies the server locale without requiring a signed-in account", async () => {
    mocks.get.mockResolvedValue({
      data: { languages: ["ru-RU"], defaultLocale: "ru-RU" },
    });
    mount();
    await waitFor(() =>
      expect(mocks.language).toHaveBeenCalledWith(["ru-RU"], "ru-RU"),
    );
    expect(mocks.get).toHaveBeenCalledWith(
      "/api/v1/proprietary/ui-data/login",
      { suppressErrorToast: true },
    );
  });

  it("keeps the current locale when public configuration is unavailable", async () => {
    mocks.get.mockRejectedValue(new Error("Offline"));
    mount();
    await waitFor(() => expect(mocks.get).toHaveBeenCalled());
    expect(mocks.language).not.toHaveBeenCalled();
  });
});
