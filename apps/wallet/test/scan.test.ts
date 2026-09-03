import { describe, expect, it } from "vitest";
import { EPC069_MAX_BYTES, byteLength } from "@euvena/qr";

import { parseRequestLink, buildRequestLink } from "../src/epc/link";
import {
  buildPaymentRequest,
  summarizeRequest,
  type Payee,
  type RequestForm,
} from "../src/epc/request";
import { NOT_A_PAYMENT_INPUT, readPastedRequest, readPaymentRequest } from "../src/epc/scan";

const payee: Payee = {
  name: "Wikimedia Foerdergesellschaft",
  iban: "DE33 1002 0500 0001 1947 00",
  bic: "",
};

/** Builds a request the way the screen does, then fails the test if it cannot. */
function requestFor(form: RequestForm) {
  const request = buildPaymentRequest(payee, form);
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
    const request = requestFor({ amount: "10", remittanceKind: "text", remittance: "" });

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
    const rows = summarizeRequest(read.data);
    expect(rows).toContainEqual({ label: "Purpose", value: "GDDS" });
    expect(rows).toContainEqual({ label: "Information", value: "Collect at desk 3" });
  });

  it("reads a payload whose remittance text carries a web address as a payload", () => {
    const request = requestFor({
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
    const link = "https://example.org/pay";

    expect(readPaymentRequest(link)).toEqual(parseRequestLink(link));
  });

  it("rejects text that is neither a payload nor a link", () => {
    const read = readPaymentRequest("please send me 20 euro");

    expect(read).toEqual({ ok: false, reason: NOT_A_PAYMENT_INPUT });
  });

  it("rejects empty input", () => {
    expect(readPaymentRequest("   ").ok).toBe(false);
  });
});

describe("rejection reasons name the element and never the value", () => {
  it("names the IBAN without repeating it", () => {
    const tampered = payloadOf(["BCD", "002", "1", "SCT", "", "Name", "DE33100205000001194799"]);

    const read = readPaymentRequest(tampered);

    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.reason).toContain("the IBAN");
    expect(read.reason).not.toContain("DE33100205000001194799");
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
    expect(read.reason).toContain("the beneficiary name");
    expect(read.reason).not.toContain("Ev");
  });

  it("names the format version without repeating it", () => {
    const unknown = payloadOf(["BCD", "999", "1", "SCT", "", "Name", "DE33100205000001194700"]);

    const read = readPaymentRequest(unknown);

    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.reason).toContain("the format version");
    expect(read.reason).not.toContain("999");
  });

  it("lists several failed elements in one sentence", () => {
    const doubly = payloadOf(["BCD", "999", "1", "SCT", "", "Name", "DE33100205000001194799"]);

    const read = readPaymentRequest(doubly);

    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.reason).toContain("the format version");
    expect(read.reason).toContain("the IBAN");
    expect(read.reason).toContain(" and ");
    expect(read.reason).not.toContain(", and");
  });

  it("reports a truncated payload as a structural failure", () => {
    const read = readPaymentRequest(payloadOf(["BCD", "002", "1", "SCT"]));

    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.reason).toContain("the overall structure");
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
    expect(read.reason).toContain("the overall structure");
  });
});
