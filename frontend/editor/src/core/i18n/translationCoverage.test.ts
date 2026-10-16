import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInstance } from "i18next";
import { parse, type TomlTable } from "smol-toml";
import { describe, expect, it } from "vitest";

const readLocale = (language: string) =>
  parse(
    readFileSync(
      resolve(
        process.cwd(),
        "editor/public/locales",
        language,
        "translation.toml",
      ),
      "utf8",
    ),
  );
const english = readLocale("en-GB");
const russian = readLocale("ru-RU");

function flatten(table: TomlTable, prefix = ""): Record<string, string> {
  return Object.fromEntries(
    Object.entries(table).flatMap(([key, value]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      return typeof value === "string"
        ? [[path, value]]
        : Object.entries(flatten(value as TomlTable, path));
    }),
  );
}

describe("Russian translation coverage", () => {
  it("covers every English label without falling back to English", () => {
    const ru = flatten(russian);
    const missing = Object.entries(flatten(english))
      .filter(([key, value]) => value.length > 0 && !ru[key])
      .map(([key]) => key);
    expect(missing).toEqual([]);
  });

  it("does not leave English sentences in Russian interface copy", () => {
    const untranslated = Object.entries(flatten(russian))
      .filter(
        ([key, value]) =>
          !key.endsWith(".tags") &&
          !value.startsWith("@date{") &&
          !/^[\w.+-]+@[\w.-]+(?:,\s*[\w.+-]+@[\w.-]+)*$/.test(value) &&
          !/[а-яё]/i.test(value) &&
          (value.match(/[a-zA-Z]{2,}/g)?.length ?? 0) >= 5,
      )
      .map(([key]) => key);
    expect(untranslated).toEqual([]);
  });

  it("preserves variables in billing and newly extracted interface labels", () => {
    const ru = flatten(russian);
    for (const [key, value] of Object.entries(flatten(english))) {
      if (!key.startsWith("aziralBilling.") && !key.startsWith("ui.")) continue;
      expect(ru[key].match(/{{.*?}}/g) ?? [], key).toEqual(
        value.match(/{{.*?}}/g) ?? [],
      );
    }
  });

  it("declines daily operation counts correctly in Russian", async () => {
    const translator = createInstance();
    await translator.init({
      lng: "ru-RU",
      fallbackLng: false,
      resources: { "ru-RU": { translation: russian } },
    });
    for (const [count, expected] of [
      [1, "1 операция в день"],
      [2, "2 операции в день"],
      [5, "5 операций в день"],
      [20, "20 операций в день"],
      [21, "21 операция в день"],
    ] as const) {
      expect(translator.t("aziralBilling.freeLimit", { count })).toBe(expected);
    }
  });
});
