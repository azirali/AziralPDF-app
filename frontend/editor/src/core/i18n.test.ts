import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@app/i18n/tomlBackend", () => ({
  default: class {
    static type = "backend";
    type = "backend";
    init() {}
    read(
      _language: string,
      _namespace: string,
      callback: (error: null, data: object) => void,
    ) {
      callback(null, {});
    }
  },
}));

import i18n, {
  setUserLanguage,
  supportedLanguages,
  updateSupportedLanguages,
} from "@app/i18n";

describe("server language configuration", () => {
  beforeEach(async () => {
    localStorage.clear();
    updateSupportedLanguages(null);
    i18n.addResourceBundle(
      "en-GB",
      "translation",
      { audit: { fallback: "Plans" } },
      true,
      true,
    );
    i18n.addResourceBundle(
      "ru-RU",
      "translation",
      { audit: { translated: "Перевод" } },
      true,
      true,
    );
    await i18n.changeLanguage("ru-RU");
  });

  it("keeps English translation fallback when only Russian is selectable", async () => {
    updateSupportedLanguages(["ru-RU"], "ru-RU");
    await i18n.changeLanguage("ru-RU");
    expect(i18n.language).toBe("ru-RU");
    expect(i18n.t("audit.translated")).toBe("Перевод");
    expect(i18n.t("audit.fallback")).toBe("Plans");
  });

  it("restores available languages when the server removes the filter", () => {
    updateSupportedLanguages(["ru-RU"], "ru-RU");
    updateSupportedLanguages(null);
    expect(i18n.options.supportedLngs).toEqual(Object.keys(supportedLanguages));
    expect(i18n.options.fallbackLng).toBe("en-GB");
  });

  it("does not replace a user-selected language with the server default", async () => {
    setUserLanguage("de-DE");
    updateSupportedLanguages(["de-DE", "ru-RU"], "ru-RU");
    await i18n.changeLanguage(i18n.language);
    expect(i18n.language).toBe("de-DE");
  });
});
