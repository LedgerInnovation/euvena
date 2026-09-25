import { describe, expect, it } from "vitest";

import { DICTIONARIES, en } from "../src/i18n";
import { decodeEpcQr } from "@euvena/qr";

import {
  EMPTY_FORM,
  buildPaymentRequest,
  formatIbanForDisplay,
  normalizeAmountInput,
  normalizePayee,
  summarizeRequest,
  validatePayee,
  type Payee,
} from "../src/epc/request";

const payee: Payee = {
  name: "Wikimedia Foerdergesellschaft",
  iban: "DE33 1002 0500 0001 1947 00",
  bic: "",
};

describe("normalizeAmountInput", () => {
  it("accepts the decimal comma and strips spaces", () => {
    expect(normalizeAmountInput(" 13,05 ")).toBe("13.05");
    expect(normalizeAmountInput("13.05")).toBe("13.05");
    expect(normalizeAmountInput("1 000")).toBe("1000");
  });

  it("leaves an ambiguous pair of separators alone so it is rejected downstream", () => {
    expect(normalizeAmountInput("1.234,56")).toBe("1.234,56");
    expect(normalizeAmountInput("1,234.56")).toBe("1,234.56");
  });
});

describe("buildPaymentRequest", () => {
  it("builds a payload whose decoded values match the form", () => {
    const result = buildPaymentRequest(payee, {
      amount: "13,05",
      remittanceKind: "text",
      remittance: "Spende fuer Wikipedia",
    }, en);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.iban).toBe("DE33100205000001194700");
    expect(result.data.amount).toBe("13.05");
    expect(result.data.text).toBe("Spende fuer Wikipedia");
    expect(result.data.reference).toBeUndefined();
    expect(result.data.version).toBe("002");
    expect(result.data.charset).toBe(1);

    // A payload that decodes in strict mode is one a conformant scanner accepts.
    expect(decodeEpcQr(result.payload).issues).toEqual([]);
  });

  it("fills the structured reference element instead of the text element", () => {
    const result = buildPaymentRequest(payee, {
      amount: "10",
      remittanceKind: "reference",
      remittance: "RF18539007547034",
    }, en);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.reference).toBe("RF18539007547034");
    expect(result.data.text).toBeUndefined();
  });

  it("omits the amount so the payer can enter it", () => {
    const result = buildPaymentRequest(payee, { ...EMPTY_FORM, remittance: "Donation" }, en);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.amount).toBeUndefined();
    expect(result.data.text).toBe("Donation");
  });

  it("carries the BIC when settings hold one", () => {
    const result = buildPaymentRequest({ ...payee, bic: "bfswde33mue" }, EMPTY_FORM, en);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.bic).toBe("BFSWDE33MUE");
  });

  it("reports an amount outside the SEPA range instead of throwing", () => {
    const result = buildPaymentRequest(payee, { ...EMPTY_FORM, amount: "0" }, en);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.element)).toContain("amount");
  });

  it("reports an amount that is not a number instead of throwing", () => {
    const result = buildPaymentRequest(payee, { ...EMPTY_FORM, amount: "1.234,56" }, en);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.element)).toContain("amount");
  });

  it("reports missing and invalid settings", () => {
    const empty = buildPaymentRequest({ name: "", iban: "", bic: "" }, EMPTY_FORM, en);
    expect(empty.ok).toBe(false);
    if (empty.ok) return;
    expect(empty.issues.map((issue) => issue.element)).toEqual(["name", "iban"]);

    const wrongCheckDigits = buildPaymentRequest({ ...payee, iban: "DE34100205000001194700" }, EMPTY_FORM, en);
    expect(wrongCheckDigits.ok).toBe(false);
    if (wrongCheckDigits.ok) return;
    expect(wrongCheckDigits.issues.map((issue) => issue.element)).toEqual(["iban"]);
  });

  it("refuses a non-EEA payee without a BIC and points at the setting", () => {
    const result = buildPaymentRequest({ ...payee, iban: "CH9300762011623852957" }, EMPTY_FORM, en);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toEqual([
      { element: "bic", message: expect.stringContaining("(payee settings)") },
    ]);
  });

  it("surfaces the codec's own issues, such as remittance text that is too long", () => {
    const result = buildPaymentRequest(payee, {
      ...EMPTY_FORM,
      remittance: "x".repeat(141),
    }, en);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.element)).toContain("text");
  });

  it("keeps a name that is only whitespace out of the payload", () => {
    const result = buildPaymentRequest({ ...payee, name: "   " }, EMPTY_FORM, en);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.element)).toContain("name");
  });
});

describe("validatePayee", () => {
  it("accepts an EEA payee with no BIC, which version 002 allows", () => {
    expect(validatePayee(payee, en)).toEqual({});
  });

  it("accepts a well-formed BIC in either length", () => {
    expect(validatePayee({ ...payee, bic: "BFSWDE33" }, en)).toEqual({});
    expect(validatePayee({ ...payee, bic: "bfswde33mue" }, en)).toEqual({});
  });

  it("requires a BIC for accounts in SEPA countries outside the EEA", () => {
    // Swiss and UK IBANs are SEPA but not EEA, so element 5 stays mandatory.
    for (const iban of ["CH9300762011623852957", "GB29NWBK60161331926819"]) {
      const issues = validatePayee({ ...payee, iban }, en);
      expect(Object.keys(issues)).toEqual(["bic"]);
      expect(issues.bic).toMatch(/outside the EEA/);
      expect(validatePayee({ ...payee, iban, bic: "UBSWCHZH80A" }, en)).toEqual({});
    }
  });

  it("rejects a malformed BIC even where one is optional", () => {
    for (const bic of ["BFSW", "BFSWDE3", "BFSWDE33MU", "1FSWDE33", "BFSW-E33"]) {
      expect(Object.keys(validatePayee({ ...payee, bic }, en))).toEqual(["bic"]);
    }
  });

  it("limits the name to 70 characters and refuses control characters", () => {
    expect(validatePayee({ ...payee, name: "x".repeat(70) }, en)).toEqual({});
    expect(Object.keys(validatePayee({ ...payee, name: "x".repeat(71) }, en))).toEqual(["name"]);
    expect(Object.keys(validatePayee({ ...payee, name: "Acme\nGmbH" }, en))).toEqual(["name"]);
  });

  it("prompts for empty required fields and describes bad check digits", () => {
    expect(validatePayee({ name: "", iban: "", bic: "" }, en)).toEqual({
      name: "Enter the beneficiary name",
      iban: "Enter the IBAN",
    });
    expect(validatePayee({ ...payee, iban: "DE34100205000001194700" }, en).iban).toMatch(/ISO 13616/);
  });

  it("reports every failing field at once", () => {
    const issues = validatePayee({ name: "x".repeat(71), iban: "CH9300762011623852957", bic: "" }, en);
    expect(Object.keys(issues).sort()).toEqual(["bic", "name"]);
  });

  it("agrees with buildPaymentRequest on what a payee may be", () => {
    // Anything the form lets through must encode; anything it refuses must not.
    const candidates: Payee[] = [
      payee,
      { ...payee, iban: "CH9300762011623852957" },
      { ...payee, iban: "CH9300762011623852957", bic: "UBSWCHZH80A" },
      { ...payee, bic: "nope" },
      { ...payee, name: "x".repeat(71) },
      { name: " Acme ", iban: " de33 1002 0500 0001 1947 00 ", bic: " bfswde33mue " },
    ];
    for (const candidate of candidates) {
      const saved = Object.keys(validatePayee(candidate, en)).length === 0;
      expect(buildPaymentRequest(candidate, EMPTY_FORM, en).ok).toBe(saved);
    }
  });
});

describe("normalizePayee", () => {
  it("trims the name and compacts the identifiers to upper case", () => {
    expect(
      normalizePayee({ name: " Acme ", iban: " de33 1002 0500 0001 1947 00 ", bic: " bfswde33mue " }),
    ).toEqual({ name: "Acme", iban: "DE33100205000001194700", bic: "BFSWDE33MUE" });
  });
});

describe("form issues are worded by the wallet", () => {
  const de = DICTIONARIES.de;
  const payee = {
    name: "Wikimedia Foerdergesellschaft",
    iban: "DE33100205000001194700",
    bic: "",
  };

  it("names what a text or reference must look like, in the language, never echoing the value", () => {
    const text = buildPaymentRequest(
      payee,
      { amount: "", remittanceKind: "text", remittance: "Miete\nMai" },
      de,
    );
    expect(text).toEqual({
      ok: false,
      issues: [{ element: "text", message: de.payeeIssues.textShape }],
    });
    const reference = buildPaymentRequest(
      payee,
      { amount: "", remittanceKind: "reference", remittance: "RF12NOPE" },
      de,
    );
    expect(reference.ok).toBe(false);
    if (reference.ok) return;
    expect(reference.issues).toEqual([
      { element: "reference", message: de.payeeIssues.referenceShape },
    ]);
    expect(JSON.stringify(reference.issues)).not.toContain("RF12NOPE");
  });

  it("says when everything fits on its own but not together", () => {
    // Each field fits on its own; in UTF-8 the two together pass 331 bytes.
    const long = buildPaymentRequest(
      { ...payee, name: "ü".repeat(70) },
      { amount: "", remittanceKind: "text", remittance: "ü".repeat(140) },
      de,
    );
    expect(long.ok).toBe(false);
    if (long.ok) return;
    expect(long.issues.map((issue) => issue.message)).toContain(de.payeeIssues.requestTooLong);
  });
});

describe("summarizeRequest", () => {
  it("prints the BIC row exactly when the decoded payload carries one", () => {
    const request = buildPaymentRequest(
      {
        name: "Wikimedia Foerdergesellschaft",
        iban: "DE33 1002 0500 0001 1947 00",
        bic: "BFSWDE33BER",
      },
      { amount: "13,05", remittanceKind: "text", remittance: "Spende fuer Wikipedia" }, en);
    expect(request.ok).toBe(true);
    if (!request.ok) return;

    expect(summarizeRequest(request.data, en, "en")).toEqual([
      { label: "Payee", value: "Wikimedia Foerdergesellschaft" },
      { label: "IBAN", value: "DE33 1002 0500 0001 1947 00" },
      { label: "BIC", value: "BFSWDE33BER" },
      { label: "Amount", value: "€13.05" },
      { label: "Text", value: "Spende fuer Wikipedia" },
    ]);
  });
});

describe("display formatting", () => {
  it("groups an IBAN into blocks of four", () => {
    expect(formatIbanForDisplay("DE33100205000001194700")).toBe("DE33 1002 0500 0001 1947 00");
    expect(formatIbanForDisplay("NL91ABNA0417164300")).toBe("NL91 ABNA 0417 1643 00");
  });

});
