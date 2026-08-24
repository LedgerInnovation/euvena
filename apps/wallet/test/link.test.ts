import { describe, expect, it } from "vitest";
import { encodeEpcQr } from "@eupi/qr";

import {
  REQUEST_LINK_PARAM,
  REQUEST_LINK_PATH,
  REQUEST_LINK_SCHEME,
  buildRequestLink,
  buildShareMessage,
  parseRequestLink,
} from "../src/epc/link";
import { buildPaymentRequest, type Payee, type RequestForm } from "../src/epc/request";

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

describe("buildRequestLink", () => {
  it("carries the payload in a link with no host", () => {
    const link = buildRequestLink("BCD\n002\n1\nSCT\n\nName\nDE33100205000001194700\n");

    expect(link.startsWith(`${REQUEST_LINK_SCHEME}://${REQUEST_LINK_PATH}?`)).toBe(true);
    expect(link).toContain(`${REQUEST_LINK_PARAM}=`);
    // The element separators are what would otherwise break the link apart.
    expect(link).not.toContain("\n");
  });
});

describe("a shared request round-trips", () => {
  it("decodes back to the values that were entered", () => {
    const form: RequestForm = {
      amount: "13,05",
      remittanceKind: "text",
      remittance: "Spende fuer Wikipedia",
    };
    const request = requestFor(form);

    const parsed = parseRequestLink(buildRequestLink(request.payload));

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.payload).toBe(request.payload);
    expect(parsed.data).toEqual(request.data);
    expect(parsed.data.name).toBe(payee.name);
    expect(parsed.data.iban).toBe("DE33100205000001194700");
    expect(parsed.data.amount).toBe("13.05");
    expect(parsed.data.text).toBe("Spende fuer Wikipedia");
  });

  it("keeps a structured reference in its own element", () => {
    const request = requestFor({
      amount: "10",
      remittanceKind: "reference",
      remittance: "RF18539007547034",
    });

    const parsed = parseRequestLink(buildRequestLink(request.payload));

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.reference).toBe("RF18539007547034");
    expect(parsed.data.text).toBeUndefined();
  });

  it("keeps an amount the payer is meant to enter out of the link", () => {
    const request = requestFor({ amount: "", remittanceKind: "text", remittance: "Open amount" });

    const parsed = parseRequestLink(buildRequestLink(request.payload));

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.amount).toBeUndefined();
  });

  it("survives remittance text made of query string punctuation", () => {
    // "&" would end the parameter, "+" would become a space under form
    // encoding, "%" and "#" would be read as an escape and a fragment.
    const remittance = "Rechnung 7 & 8 +1 100% #neu";
    const request = requestFor({ amount: "1,00", remittanceKind: "text", remittance });

    const parsed = parseRequestLink(buildRequestLink(request.payload));

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.text).toBe(remittance);
  });

  it("survives a name outside ASCII", () => {
    const request = buildPaymentRequest(
      { name: "Zürcher Kantonalbank Ärzte", iban: "DE33100205000001194700", bic: "" },
      { amount: "2,50", remittanceKind: "text", remittance: "Kaffee" },
    );
    expect(request.ok).toBe(true);
    if (!request.ok) return;

    const parsed = parseRequestLink(buildRequestLink(request.payload));

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.name).toBe("Zürcher Kantonalbank Ärzte");
  });
});

describe("parseRequestLink", () => {
  const payload = encodeEpcQr({
    name: "Wikimedia Foerdergesellschaft",
    iban: "DE33100205000001194700",
  });

  it("accepts a scheme in any case and ignores parameters it does not know", () => {
    const link = `EUPI://${REQUEST_LINK_PATH}?ref=chat&${REQUEST_LINK_PARAM}=${encodeURIComponent(payload)}`;

    const parsed = parseRequestLink(link);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.payload).toBe(payload);
  });

  it("accepts a link with whitespace around it, as pasted", () => {
    expect(parseRequestLink(`  ${buildRequestLink(payload)}\n`).ok).toBe(true);
  });

  it("rejects another scheme, another path and a bare string", () => {
    expect(parseRequestLink(`https://${REQUEST_LINK_PATH}?${REQUEST_LINK_PARAM}=x`).ok).toBe(false);
    expect(parseRequestLink(`${REQUEST_LINK_SCHEME}://pay?${REQUEST_LINK_PARAM}=x`).ok).toBe(false);
    expect(parseRequestLink(payload).ok).toBe(false);
  });

  it("rejects a link that carries no request", () => {
    const parsed = parseRequestLink(`${REQUEST_LINK_SCHEME}://${REQUEST_LINK_PATH}?ref=chat`);

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toContain("no payment request");
  });

  it("rejects a truncated escape rather than throwing", () => {
    const parsed = parseRequestLink(
      `${REQUEST_LINK_SCHEME}://${REQUEST_LINK_PATH}?${REQUEST_LINK_PARAM}=BCD%`,
    );

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toContain("damaged");
  });

  it("rejects a payload a scanner would reject, so a link cannot smuggle one in", () => {
    const broken = payload.replace("DE33100205000001194700", "DE00100205000001194700");

    expect(parseRequestLink(buildRequestLink(broken)).ok).toBe(false);
  });
});

describe("buildShareMessage", () => {
  it("puts the request above the link that carries it", () => {
    const request = requestFor({
      amount: "13,05",
      remittanceKind: "text",
      remittance: "Spende fuer Wikipedia",
    });

    const message = buildShareMessage(request.data, request.payload);

    expect(message).toContain("Payee: Wikimedia Foerdergesellschaft");
    expect(message).toContain("IBAN: DE33 1002 0500 0001 1947 00");
    expect(message).toContain("Amount: EUR 13,05");
    expect(message).toContain("Text: Spende fuer Wikipedia");
    expect(message.endsWith(buildRequestLink(request.payload))).toBe(true);
  });

  it("says who enters the amount when the request leaves it open", () => {
    const request = requestFor({ amount: "", remittanceKind: "text", remittance: "" });

    expect(buildShareMessage(request.data, request.payload)).toContain(
      "Amount: entered by the payer",
    );
  });
});
