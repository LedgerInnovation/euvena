import { describe, expect, it } from "vitest";

import { buildPaytoUri, handoffFields } from "../src/epc/payto";
import { buildPaymentRequest, type Payee, type RequestForm } from "../src/epc/request";

const payee: Payee = {
  name: "Wikimedia Foerdergesellschaft",
  iban: "DE33 1002 0500 0001 1947 00",
  bic: "",
};

/** Decoded data the way the review screen holds it, via the real builder. */
function dataFor(form: RequestForm, withPayee: Payee = payee) {
  const request = buildPaymentRequest(withPayee, form);
  if (!request.ok) throw new Error(`the form did not build: ${JSON.stringify(request.issues)}`);
  return request.data;
}

describe("buildPaytoUri", () => {
  it("maps a full request onto RFC 8905", () => {
    const data = dataFor({
      amount: "13,05",
      remittanceKind: "text",
      remittance: "Spende fuer Wikipedia",
    });

    expect(buildPaytoUri(data)).toBe(
      "payto://iban/DE33100205000001194700" +
        "?amount=EUR:13.05" +
        "&receiver-name=Wikimedia%20Foerdergesellschaft" +
        "&message=Spende%20fuer%20Wikipedia",
    );
  });

  it("leaves the amount out when the payer decides it", () => {
    const data = dataFor({ amount: "", remittanceKind: "text", remittance: "" });

    const uri = buildPaytoUri(data);

    expect(uri).not.toContain("amount=");
    expect(uri).not.toContain("message=");
    expect(uri).toContain("receiver-name=");
  });

  it("carries a structured reference as the message", () => {
    const data = dataFor({
      amount: "10",
      remittanceKind: "reference",
      remittance: "RF18539007547034",
    });

    expect(buildPaytoUri(data)).toContain("message=RF18539007547034");
  });

  it("puts the BIC ahead of the IBAN in the path", () => {
    const data = dataFor(
      { amount: "5", remittanceKind: "text", remittance: "" },
      { ...payee, bic: "BFSWDE33BER" },
    );

    expect(buildPaytoUri(data)).toContain("payto://iban/BFSWDE33BER/DE33100205000001194700?");
  });

  it("percent encodes characters that would restructure the URI", () => {
    const data = dataFor({
      amount: "5",
      remittanceKind: "text",
      remittance: "Rechnung 44 & 45 = bezahlt",
    });

    const uri = buildPaytoUri(data);

    expect(uri).toContain("message=Rechnung%2044%20%26%2045%20%3D%20bezahlt");
  });
});

describe("handoffFields", () => {
  it("offers the raw values a transfer form expects", () => {
    const data = dataFor({
      amount: "13,05",
      remittanceKind: "reference",
      remittance: "RF18539007547034",
    });

    expect(handoffFields(data)).toEqual([
      { label: "Name", value: "Wikimedia Foerdergesellschaft" },
      { label: "IBAN", value: "DE33100205000001194700" },
      { label: "Amount", value: "13.05" },
      { label: "Reference", value: "RF18539007547034" },
    ]);
  });

  it("adds the BIC row only when the payload carries one", () => {
    const data = dataFor(
      { amount: "", remittanceKind: "text", remittance: "" },
      { ...payee, bic: "BFSWDE33BER" },
    );

    const labels = handoffFields(data).map((field) => field.label);

    expect(labels).toContain("BIC");
    expect(labels).not.toContain("Amount");
    expect(labels).not.toContain("Text");
  });
});
