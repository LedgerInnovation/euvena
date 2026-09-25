import { describe, expect, it } from "vitest";

import {
  DICTIONARIES,
  LANGUAGES,
  describeRejection,
  en,
  formatDateTime,
  formatMoney,
  resolveLanguage,
  sameRejection,
  type Dictionary,
} from "../src/i18n";
import { DEFAULT_PREFERENCES, parsePreferences, serializePreferences } from "../src/settings/preferences";

/** Every leaf of a dictionary, as its path and its text, calling the functions with sample values. */
function leaves(value: unknown, path: string, out: [string, string][]): void {
  if (typeof value === "string") {
    out.push([path, value]);
  } else if (typeof value === "function") {
    const fn = value as (...args: unknown[]) => unknown;
    const args: unknown[] =
      fn.length === 0
        ? []
        : path.endsWith("figures")
          ? [{ version: "002", bytes: 12, maxBytes: 331, qrVersion: 5, maxQrVersion: 13, correction: "M" }]
          : path.endsWith("Invalid")
            ? [["a", "b"]]
            : path.endsWith("andMore") || path.endsWith("and")
              ? ["x", 2]
              : [3];
    out.push([path, String(fn(...args))]);
  } else if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value)) leaves(child, `${path}.${key}`, out);
  }
}

describe("dictionaries", () => {
  it("cover every language with wording for every key", () => {
    const reference: [string, string][] = [];
    leaves(en, "en", reference);
    const paths = reference.map(([path]) => path.slice(3));
    for (const language of LANGUAGES) {
      const found: [string, string][] = [];
      leaves(DICTIONARIES[language], language, found);
      expect(found.map(([path]) => path.slice(language.length + 1))).toEqual(paths);
      for (const [path, text] of found) {
        expect(text.trim(), path).not.toBe("");
        expect(text, path).not.toContain("undefined");
      }
    }
  });

  it("count in each language", () => {
    for (const language of LANGUAGES) {
      const strings: Dictionary = DICTIONARIES[language];
      expect(strings.settings.payeesCount(1)).not.toBe(strings.settings.payeesCount(2));
      expect(strings.settings.requestsCount(5)).toContain("5");
    }
    expect(DICTIONARIES.pl.settings.requestsCount(2)).toBe("2 żądania");
    expect(DICTIONARIES.pl.settings.requestsCount(5)).toBe("5 żądań");
    expect(DICTIONARIES.pl.settings.requestsCount(22)).toBe("22 żądania");
    expect(DICTIONARIES.pl.settings.requestsCount(12)).toBe("12 żądań");
  });
});

describe("resolveLanguage", () => {
  it("takes the chosen language over the device", () => {
    expect(resolveLanguage("pl", ["de-DE"])).toBe("pl");
  });

  it("takes the first device language the wallet speaks, by its language part", () => {
    expect(resolveLanguage(null, ["pt-BR", "de-AT", "fr-FR"])).toBe("de");
    expect(resolveLanguage(null, ["NL_be"])).toBe("nl");
  });

  it("falls back to English", () => {
    expect(resolveLanguage(null, ["pt-BR", "ja"])).toBe("en");
    expect(resolveLanguage(null, [])).toBe("en");
  });
});

describe("formatting", () => {
  it("writes money the way the language does, with two decimals", () => {
    expect(formatMoney("13.05", "en")).toBe("€13.05");
    // The space before the sign is a non-breaking one, so it is matched loosely.
    expect(formatMoney("12.3", "de")).toMatch(/^12,30\s€$/);
    expect(formatMoney("1234567.8", "fr")).toMatch(/1.234.567,80.€/);
    expect(formatMoney("abc", "en")).toBe("abc");
  });

  it("writes a date and time for the language and keeps an unreadable one as it is", () => {
    const iso = "2026-09-20T10:05:00.000Z";
    expect(formatDateTime(iso, "en")).toMatch(/2026/);
    expect(formatDateTime(iso, "de")).toMatch(/2026/);
    expect(formatDateTime("not a date", "en")).toBe("not a date");
  });
});

describe("rejections", () => {
  it("names the failed elements in the language", () => {
    expect(describeRejection({ code: "codeInvalid", elements: ["iban", "name"] }, en)).toBe(
      "The code is not a valid payment request: the IBAN and the beneficiary name failed the checks.",
    );
    expect(describeRejection({ code: "paytoInvalid", elements: [] }, en)).toBe(
      en.rejections.paytoNoRequest,
    );
    expect(describeRejection({ code: "empty" }, DICTIONARIES.de)).toBe(
      DICTIONARIES.de.rejections.empty,
    );
  });

  it("compares by code and elements", () => {
    expect(sameRejection({ code: "empty" }, { code: "empty" })).toBe(true);
    expect(sameRejection({ code: "empty" }, { code: "linkNot" })).toBe(false);
    expect(
      sameRejection(
        { code: "codeInvalid", elements: ["iban"] },
        { code: "codeInvalid", elements: ["iban", "name"] },
      ),
    ).toBe(false);
    expect(
      sameRejection({ code: "codeInvalid", elements: ["iban"] }, { code: "codeInvalid", elements: ["iban"] }),
    ).toBe(true);
  });
});

describe("preferences", () => {
  it("round-trips", () => {
    const chosen = { appearance: "dark", language: "fr" } as const;
    expect(parsePreferences(serializePreferences(chosen))).toEqual(chosen);
    expect(parsePreferences(serializePreferences(DEFAULT_PREFERENCES))).toEqual(DEFAULT_PREFERENCES);
  });

  it("falls back field by field on anything unexpected", () => {
    expect(parsePreferences(null)).toEqual(DEFAULT_PREFERENCES);
    for (const stored of ["", "{", "null", "[]", "42"]) {
      expect(parsePreferences(stored)).toEqual(DEFAULT_PREFERENCES);
    }
    expect(parsePreferences('{"appearance":"blue","language":"pl"}')).toEqual({
      appearance: "system",
      language: "pl",
    });
    expect(parsePreferences('{"appearance":"light","language":"xx"}')).toEqual({
      appearance: "light",
      language: null,
    });
  });
});
