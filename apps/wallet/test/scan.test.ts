import { describe, expect, it } from "vitest";

import { describeRejection, en, type Rejection } from "../src/i18n";
import { EPC069_MAX_BYTES, byteLength } from "@euvena/qr";

import { parseRequestLink, buildRequestLink } from "../src/epc/link";
import { EMPTY_FORM, buildPaymentRequest,
  summarizeRequest,
  type Payee,
  type RequestForm, } from "../src/epc/request";
import {
  NOT_A_PAYMENT_INPUT,
  openedRequestStep,
  readOpenedLink,
  readPastedRequest,
  readPaymentRequest,
} from "../src/epc/scan";

const text = (rejection: Rejection) => describeRejection(rejection, en);

const payee: Payee = {
  name: "Wikimedia Foerdergesellschaft",
  iban: "DE33 1002 0500 0001 1947 00",
  bic: "",
};

/** Builds a request the way the screen does, then fails the test if it cannot. */
function requestFor(form: RequestForm) {
  const request = buildPaymentRequest(payee, form, en);
  if (!request.ok) throw new Error(`the form did not build: ${JSON.stringify(request.issues)}`);
  return request;
}

/** A hand-written payload from its elements, in EPC069-12 order. */
function payloadOf(elements: string[]): string {
  return elements.join("\n");
}

const VALID = payloadOf(["BCD", "002", "1", "SCT", "", "Name", "DE33100205000001194700"]);

describe("readPaymentRequest reads what the request side produces", () => {
  it("round-trips a payload the request screen builds", () => {
    const request = requestFor({
      ...EMPTY_FORM,
      amount: "13,05",
      remittanceKind: "text",
      remittance: "Spende fuer Wikipedia",
    });

    const read = readPaymentRequest(request.payload);

    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.payload).toBe(request.payload);
    expect(read.data).toEqual(request.data);
    expect(read.data.amount).toBe("13.05");
  });

  it("reads the link form of the same request", () => {
    const request = requestFor({ ...EMPTY_FORM, amount: "10", remittanceKind: "text", remittance: "" });

    const read = readPaymentRequest(buildRequestLink(request.payload));

    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.data).toEqual(request.data);
  });

  it("sheds the outer whitespace a paste picks up", () => {
    const read = readPastedRequest(`\n  ${VALID}\n\n`);

    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.data.iban).toBe("DE33100205000001194700");
  });

  it("does not strip packaging from a scanned code", () => {
    expect(readPaymentRequest(`\n${VALID}`).ok).toBe(false);
  });

  it("shows purpose and information elements a scanned code carries", () => {
    const scanned = payloadOf([
      "BCD",
      "002",
      "1",
      "SCT",
      "",
      "Name",
      "DE33100205000001194700",
      "EUR12.00",
      "GDDS",
      "",
      "Order 44",
      "Collect at desk 3",
    ]);

    const read = readPaymentRequest(scanned);

    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const rows = summarizeRequest(read, en, "en");
    expect(rows).toContainEqual({ label: "Purpose", value: "GDDS" });
    expect(rows).toContainEqual({ label: "Information", value: "Collect at desk 3" });
  });

  it("reads a payload whose remittance text carries a web address as a payload", () => {
    const request = requestFor({
      ...EMPTY_FORM,
      amount: "5",
      remittanceKind: "text",
      remittance: "Details at https://example.org/invoice",
    });

    const read = readPaymentRequest(request.payload);

    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.data.text).toBe("Details at https://example.org/invoice");
  });
});

describe("readPaymentRequest classifies input", () => {
  it("hands link-shaped input to the link parser, whatever its scheme", () => {
    const link = "ftp://example.org/pay";

    expect(readPaymentRequest(link)).toEqual(parseRequestLink(link));
  });

  it("reads an https address as an EN 18184 code and refuses one that is not", () => {
    expect(readPaymentRequest("https://example.org/pay")).toEqual({
      ok: false,
      reason: { code: "poiNot" },
    });
  });

  it("rejects text that is neither a payload nor a link", () => {
    const read = readPaymentRequest("please send me 20 euro");

    expect(read).toEqual({ ok: false, reason: NOT_A_PAYMENT_INPUT });
  });

  it("rejects empty input", () => {
    expect(readPaymentRequest("   ").ok).toBe(false);
  });
});

describe("readOpenedLink reads the link the app was opened with", () => {
  const request = requestFor({ ...EMPTY_FORM, amount: "10", remittanceKind: "text", remittance: "Invoice 7" });
  const link = buildRequestLink(request.payload);

  it("reviews a shared request link", () => {
    const read = readOpenedLink(link);

    expect(read).toEqual(parseRequestLink(link));
    expect(read?.ok).toBe(true);
    if (!read?.ok) return;
    expect(read.data).toEqual(request.data);
  });

  it("reads the scheme without regard to case", () => {
    const read = readOpenedLink(link.replace("euvena://", "EUVENA://"));

    expect(read?.ok).toBe(true);
  });

  it("shows nothing when the app was launched without a URL", () => {
    expect(readOpenedLink(null)).toBeNull();
  });

  it("ignores the URL a development host launches the app with", () => {
    // Expo Go opens the project with an exp:// URL on every launch, and its
    // own link form can carry a valid request. Neither is the wallet's link.
    expect(readOpenedLink("exp://192.168.1.5:8081")).toBeNull();
    expect(readOpenedLink(link.replace("euvena://", "exp://192.168.1.5:8081/--/"))).toBeNull();
  });

  it("ignores a payto link, which is read from a scan or a paste only", () => {
    // The handoff opens payto URIs. A wallet that also opened them would be
    // offered its own handoff, so the scheme is never registered and a payto
    // URL that reaches the app some other way is not shown.
    const payto = "payto://iban/DE33100205000001194700?receiver-name=Alice&amount=EUR:5";
    expect(readPaymentRequest(payto).ok).toBe(true);
    expect(readOpenedLink(payto)).toBeNull();
    expect(readOpenedLink(payto.replace("payto://", "PAYTO://"))).toBeNull();
  });

  it("ignores a scheme that only begins with the wallet's", () => {
    expect(readOpenedLink(link.replace("euvena://", "euvenax://"))).toBeNull();
  });

  it("rejects a link in the wallet's scheme that is not a request, rather than ignoring it", () => {
    const notARequest = { ok: false, reason: { code: "linkNot" } };

    expect(readOpenedLink("euvena://settings")).toEqual(notARequest);
    // Without the slashes the link is still the wallet's, so the link parser
    // explains it rather than the paste classifier calling it unrecognised.
    expect(readOpenedLink(link.replace("euvena://", "euvena:"))).toEqual(notARequest);
  });

  it("rejects a tampered request as a whole, without a partial reading", () => {
    const tampered = buildRequestLink(
      payloadOf(["BCD", "002", "1", "SCT", "", "Name", "DE33100205000001194799"]),
    );

    const read = readOpenedLink(tampered);

    expect(read).toEqual({ ok: false, reason: { code: "linkInvalid" } });
  });
});

describe("openedRequestStep never swaps what the payer is looking at", () => {
  const first = requestFor({ ...EMPTY_FORM, amount: "10", remittanceKind: "text", remittance: "Invoice 7" });
  const second = requestFor({ ...EMPTY_FORM, amount: "10", remittanceKind: "text", remittance: "Invoice 8" });
  const read = (payload: string) => readPaymentRequest(payload);
  const damaged = { ok: false, reason: { code: "linkDamaged" } } as const;
  const invalid = { ok: false, reason: { code: "linkInvalid" } } as const;

  it("shows an opened request when nothing is on screen", () => {
    expect(openedRequestStep(null, read(first.payload))).toBe("show");
    expect(openedRequestStep(null, damaged)).toBe("show");
  });

  it("holds a different request back while a review is on screen", () => {
    expect(openedRequestStep(read(first.payload), read(second.payload))).toBe("hold");
  });

  it("holds a rejection back while a review is on screen and the other way round", () => {
    expect(openedRequestStep(read(first.payload), damaged)).toBe("hold");
    expect(openedRequestStep(damaged, read(first.payload))).toBe("hold");
  });

  it("holds a different rejection back while a rejection is on screen", () => {
    expect(openedRequestStep(damaged, invalid)).toBe("hold");
  });

  it("treats the same request opened again as nothing new", () => {
    expect(openedRequestStep(read(first.payload), read(first.payload))).toBe("same");
    expect(openedRequestStep(damaged, { ...damaged })).toBe("same");
  });
});

describe("rejection reasons name the element and never the value", () => {
  it("names the IBAN without repeating it", () => {
    const tampered = payloadOf(["BCD", "002", "1", "SCT", "", "Name", "DE33100205000001194799"]);

    const read = readPaymentRequest(tampered);

    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(text(read.reason)).toContain("the IBAN");
    expect(text(read.reason)).not.toContain("DE33100205000001194799");
  });

  it("names the beneficiary name when it hides invisible formatting", () => {
    const spoofed = payloadOf([
      "BCD",
      "002",
      "1",
      "SCT",
      "",
      "Ev\u202Eil",
      "DE33100205000001194700",
    ]);

    const read = readPaymentRequest(spoofed);

    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(text(read.reason)).toContain("the beneficiary name");
    expect(text(read.reason)).not.toContain("Ev");
  });

  it("names the format version without repeating it", () => {
    const unknown = payloadOf(["BCD", "999", "1", "SCT", "", "Name", "DE33100205000001194700"]);

    const read = readPaymentRequest(unknown);

    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(text(read.reason)).toContain("the format version");
    expect(text(read.reason)).not.toContain("999");
  });

  it("lists several failed elements in one sentence", () => {
    const doubly = payloadOf(["BCD", "999", "1", "SCT", "", "Name", "DE33100205000001194799"]);

    const read = readPaymentRequest(doubly);

    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(text(read.reason)).toContain("the format version");
    expect(text(read.reason)).toContain("the IBAN");
    expect(text(read.reason)).toContain(" and ");
    expect(text(read.reason)).not.toContain(", and");
  });

  it("refuses a scanned code whose beneficiary name shows nothing", () => {
    for (const blank of [" ", "\u00A0", "\u200B"]) {
      const read = readPaymentRequest(
        payloadOf(["BCD", "002", "1", "SCT", "", blank, "DE33100205000001194700"]),
      );

      expect(read).toEqual({
        ok: false,
        reason: { code: "codeInvalid", elements: ["name"] },
      });
    }
  });

  it("reports a truncated payload as a structural failure", () => {
    const read = readPaymentRequest(payloadOf(["BCD", "002", "1", "SCT"]));

    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(text(read.reason)).toContain("the overall structure");
  });

  it("counts the bytes of a scanned payload as they arrived", () => {
    const atCap = payloadOf([
      "BCD",
      "002",
      "1",
      "SCT",
      "",
      "n".repeat(70),
      "DE33100205000001194700",
      "EUR1.00",
      "CHAR",
      "",
      "t".repeat(140),
      "x".repeat(67),
    ]);
    expect(byteLength(atCap, 1)).toBe(EPC069_MAX_BYTES);
    expect(readPaymentRequest(atCap).ok).toBe(true);

    // One separator past the cap is an oversized code, not trailing packaging.
    const read = readPaymentRequest(`${atCap}\n`);

    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(text(read.reason)).toContain("the overall structure");
  });
});
