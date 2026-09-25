import { describe, expect, it } from "vitest";
import {
  encodeMsctPayeeClear,
  encodeMsctPayeeProxy,
  encodeMsctPayeeToken,
} from "@euvena/qr";

import { buildShareMessage } from "../src/epc/link";
import { buildPaytoUri, handoffFields } from "../src/epc/payto";
import { poiProfileIssues, type PoiProfile } from "../src/epc/poi";
import {
  EMPTY_FORM,
  buildPaymentRequest,
  summarizeRequest,
  type Payee,
  type RequestForm,
} from "../src/epc/request";
import { readPastedRequest, readPaymentRequest } from "../src/epc/scan";
import { DICTIONARIES, en } from "../src/i18n";
import { MAX_PAYLOAD_LENGTH, readHistory } from "../src/settings/history";
import { parsePreferences, serializePreferences } from "../src/settings/preferences";
import { QR_MAX_VERSION, toQrSymbol } from "../src/qr/symbol";

const de = DICTIONARIES.de;

const profile: PoiProfile = { domain: "qr.example.org", providerId: "AB1", issuer: "XY9" };

const payee: Payee = {
  name: "Wikimedia Foerdergesellschaft",
  iban: "DE33 1002 0500 0001 1947 00",
  bic: "BFSWDE33BER",
};

const poiForm = (changes: Partial<RequestForm> = {}): RequestForm => ({
  ...EMPTY_FORM,
  format: "en18184",
  amount: "13,05",
  ...changes,
});

function build(changes: Partial<RequestForm> = {}, of: Payee = payee) {
  const built = buildPaymentRequest(of, poiForm(changes), en, profile);
  if (!built.ok || built.format !== "en18184") {
    throw new Error(`expected an EN 18184 code, got ${JSON.stringify(built)}`);
  }
  return built;
}

/** A clear-data code as another issuer would write it, with the fields given. */
function clearCode(changes: Record<string, unknown> = {}): string {
  return encodeMsctPayeeClear({
    ...profile,
    context: "m",
    name: "Alice Example",
    tradeName: "Alice's Bakery",
    iban: "BE72000000001616",
    mcc: "5462",
    instrument: "INST",
    amount: "24.5",
    remittance: "lunch",
    ...changes,
  } as Parameters<typeof encodeMsctPayeeClear>[0]);
}

describe("the EN 18184 profile", () => {
  it("accepts what a framework issues", () => {
    expect(poiProfileIssues(profile)).toEqual([]);
    expect(poiProfileIssues({ domain: " QR.Example.ORG ", providerId: "ab1", issuer: "007" })).toEqual(
      [],
    );
  });

  it("names each field the encoder refuses, not only the first", () => {
    expect(poiProfileIssues({ domain: "https://qr.example.org", providerId: "AB", issuer: "X-9" })).toEqual(
      ["domain", "providerId", "issuer"],
    );
    // "shop.1" is on the way to typing "shop.1und1.de"; "123" would build a
    // code for the address 0.0.0.123.
    for (const domain of [
      "",
      "qr.example.org/pay",
      "user@qr.example.org",
      "qr.example.org:8443",
      "shop.1",
      "a.0x",
      "123",
      "192.168.1.1",
    ]) {
      expect(poiProfileIssues({ ...profile, domain })).toEqual(["domain"]);
    }
  });

  it("survives a restart and drops a stored profile that would not build", () => {
    const stored = serializePreferences({ appearance: "system", language: null, poi: profile });
    expect(parsePreferences(stored).poi).toEqual(profile);
    const broken = JSON.stringify({ poi: { ...profile, providerId: "TOOLONG" } });
    expect(parsePreferences(broken).poi).toBeNull();
    expect(parsePreferences(JSON.stringify({ poi: "qr.example.org" })).poi).toBeNull();
  });
});

describe("building an EN 18184 code", () => {
  it("builds a person-to-person URL whose read-back values match the form", () => {
    const code = build({ remittance: "Spende fuer Wikipedia" });

    expect(code.payload.startsWith("https://qr.example.org/1/p/AB1/?")).toBe(true);
    expect(code.data).toMatchObject({
      domain: "qr.example.org",
      providerId: "AB1",
      issuer: "XY9",
      context: "p",
      name: "Wikimedia Foerdergesellschaft",
      iban: "DE33100205000001194700",
      instrument: "INST",
      amount: "13.05",
      text: "Spende fuer Wikipedia",
    });
    // EPC024-22 has no BIC element, so the one in the settings is not carried.
    expect(code.payload).not.toContain("BFSWDE33BER");
  });

  it("asks for a standard transfer when chosen and fills the structured reference", () => {
    const code = build({ instrument: "SCT", remittanceKind: "reference", remittance: "RF18539007547034" });
    expect(code.data.instrument).toBe("SCT");
    expect(code.data.reference).toBe("RF18539007547034");
    expect(code.data.text).toBeUndefined();
  });

  it("requires an amount, since the format has no open one", () => {
    const built = buildPaymentRequest(payee, poiForm({ amount: "" }), en, profile);
    expect(built).toEqual({
      ok: false,
      issues: [{ element: "amount", message: en.payeeIssues.amountRequired }],
    });
  });

  it("words the shorter remittance limit in the language, never echoing the value", () => {
    const long = "Miete Mai Wohnung drei links oben 2026";
    const built = buildPaymentRequest(payee, poiForm({ remittance: long }), de, profile);
    expect(built).toEqual({
      ok: false,
      issues: [{ element: "text", message: de.payeeIssues.poiTextShape }],
    });
    expect(JSON.stringify(built)).not.toContain("Wohnung");
  });

  it("falls back to nothing it could not build without a profile", () => {
    const built = buildPaymentRequest(payee, poiForm(), en, null);
    expect(built).toEqual({
      ok: false,
      issues: [{ element: "routing", message: en.payeeIssues.poiProfile }],
    });
  });

  it("keeps the EPC069-12 code when that format is chosen, profile or not", () => {
    const built = buildPaymentRequest(payee, { ...poiForm(), format: "epc069" }, en, profile);
    expect(built.ok && built.format).toBe("epc069");
  });

  it("stays inside what the history keeps and what a symbol holds, however full", () => {
    const worst = buildPaymentRequest(
      { name: "€".repeat(70), iban: "DE33100205000001194700", bic: "" },
      poiForm({ amount: "999999999.99", remittance: "€".repeat(35) }),
      en,
      { domain: `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(61)}`, providerId: "AB1", issuer: "XY9" },
    );
    if (!worst.ok) throw new Error(JSON.stringify(worst));
    expect(worst.payload.length).toBeLessThan(MAX_PAYLOAD_LENGTH);
    expect(toQrSymbol(worst.payload, QR_MAX_VERSION).version).toBeLessThanOrEqual(QR_MAX_VERSION);
  });
});

describe("reading an EN 18184 code", () => {
  it("reads a code the wallet built back to the same request", () => {
    const code = build({ remittance: "a=b & c" });
    const read = readPaymentRequest(code.payload);
    expect(read).toEqual(code);
  });

  it("reads another issuer's merchant code with everything it carries", () => {
    const read = readPaymentRequest(clearCode());
    if (!read.ok || read.format !== "en18184") throw new Error(JSON.stringify(read));
    expect(summarizeRequest(read, en, "en")).toEqual([
      { label: "Payee", value: "Alice Example" },
      { label: "Trade name", value: "Alice's Bakery" },
      { label: "IBAN", value: "BE72 0000 0000 1616" },
      { label: "Amount", value: "€24.50" },
      { label: "Transfer", value: "Instant" },
      { label: "Text", value: "lunch" },
      { label: "Merchant category", value: "5462" },
      { label: "Payment context", value: "In store" },
      { label: "Framework", value: "qr.example.org" },
      { label: "Provider", value: "AB1" },
      { label: "Issuer", value: "XY9" },
    ]);
  });

  it("accepts the capitals EPC024-22 writes its examples in, and pasted packaging", () => {
    const code = clearCode();
    const upper = code.replace("https://qr.example.org", "HTTPS://QR.EXAMPLE.ORG");
    const read = readPaymentRequest(upper);
    expect(read.ok && read.format === "en18184" && read.data.domain).toBe("qr.example.org");
    expect(readPastedRequest(`  ${code}\n`).ok).toBe(true);
  });

  it("refuses token and proxy codes, which only the provider can resolve", () => {
    const token = encodeMsctPayeeToken({ ...profile, context: "m", token: "abc123" });
    const proxy = encodeMsctPayeeProxy({
      ...profile,
      context: "p",
      proxy: "+32470000000",
      instrument: "INST",
      amount: "5",
    });
    for (const code of [token, proxy]) {
      expect(readPaymentRequest(code)).toEqual({ ok: false, reason: { code: "poiNeedsProvider" } });
    }
  });

  it("refuses a currency other than euro, whatever the case of the code", () => {
    expect(readPaymentRequest(clearCode({ currency: "USD" }))).toEqual({
      ok: false,
      reason: { code: "poiNotEuro" },
    });
    expect(readPaymentRequest(clearCode({ currency: "eur" })).ok).toBe(true);
  });

  it("hands the amount on in the codec's canonical form", () => {
    const read = readPaymentRequest(clearCode({ amount: "01.50" }));
    expect(read.ok && read.format === "en18184" && read.data.amount).toBe("1.5");
  });

  it("names the failed elements and never quotes them", () => {
    const code = clearCode().replace("iban=BE72000000001616", "iban=BE72000000001617");
    const read = readPaymentRequest(code);
    expect(read).toEqual({ ok: false, reason: { code: "poiInvalid", elements: ["iban"] } });

    const noAmount = clearCode().replace(/&amt=[^&]*/, "");
    expect(readPaymentRequest(noAmount)).toEqual({
      ok: false,
      reason: { code: "poiInvalid", elements: ["amount"] },
    });

    const repeated = `${clearCode()}&ru=dinner`;
    expect(readPaymentRequest(repeated)).toEqual({
      ok: false,
      reason: { code: "poiInvalid", elements: ["text"] },
    });
  });

  it("refuses web addresses that are not payment codes, and plain http", () => {
    for (const address of [
      "https://example.org/",
      "https://example.org/1/p/AB1/?q=search",
      "https://user@qr.example.org/1/p/AB1/?iss=XY9",
      `${clearCode()}#fragment`,
    ]) {
      expect(readPaymentRequest(address)).toEqual({ ok: false, reason: { code: "poiNot" } });
    }
    expect(readPaymentRequest(clearCode().replace("https://", "http://")).ok).toBe(false);
  });
});

describe("handing an EN 18184 request on", () => {
  it("copies and links the same values as an EPC069-12 request, in euro", () => {
    const code = build({ remittance: "Spende" });
    expect(handoffFields(code.data)).toEqual([
      { key: "payee", value: "Wikimedia Foerdergesellschaft" },
      { key: "iban", value: "DE33100205000001194700" },
      { key: "amount", value: "13.05" },
      { key: "text", value: "Spende" },
    ]);
    expect(buildPaytoUri(code.data)).toBe(
      "payto://iban/DE33100205000001194700?amount=EUR:13.05&receiver-name=Wikimedia%20Foerdergesellschaft&message=Spende",
    );
  });

  it("shares the URL itself, which is already the request", () => {
    const code = build();
    const message = buildShareMessage(code, en, "en");
    expect(message.endsWith(`\n\n${code.payload}`)).toBe(true);
    expect(message).not.toContain("euvena://");
  });

  it("is kept in the history, where other web addresses are not", () => {
    const code = build();
    const entry = { id: "1", builtAt: "2026-09-25T10:00:00.000Z", done: false };
    expect(readHistory([{ ...entry, payload: code.payload }])).toHaveLength(1);
    expect(readHistory([{ ...entry, payload: "ftp://qr.example.org/1/p/AB1/" }])).toEqual([]);
  });
});
