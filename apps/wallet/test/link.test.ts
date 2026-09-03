import { describe, expect, it } from "vitest";
import { encodeEpcQr } from "@euvena/qr";

import {
  REQUEST_LINK_ACTION,
  REQUEST_LINK_PARAM,
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
  it("carries the payload in a link that names no server", () => {
    const link = buildRequestLink("BCD\n002\n1\nSCT\n\nName\nDE33100205000001194700\n");

    expect(link.startsWith(`${REQUEST_LINK_SCHEME}://${REQUEST_LINK_ACTION}?`)).toBe(true);
    expect(link).toContain(`${REQUEST_LINK_PARAM}=`);
    // The element separators are what would otherwise break the link apart.
    expect(link).not.toContain("\n");
  });

  it("keeps punctuation a message app may clip inside percent escapes", () => {
    const payload = "BCD\n002\n1\nSCT\n\nName\nDE33100205000001194700\nEUR1.00\n\n\nDanke :)";

    const link = buildRequestLink(payload);

    expect(link.slice(link.indexOf("=") + 1)).not.toMatch(/[.!'()*]/);
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

  it("reads as damaged rather than altered when a message app clips the last character", () => {
    const request = requestFor({ amount: "1,00", remittanceKind: "text", remittance: "Danke :)" });
    const link = buildRequestLink(request.payload);

    const parsed = parseRequestLink(link);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.text).toBe("Danke :)");

    // A link detector that splits a trailing ")" off the link now cuts inside
    // a percent escape, which cannot decode to an altered request.
    const clipped = parseRequestLink(link.slice(0, -1));
    expect(clipped.ok).toBe(false);
    if (clipped.ok) return;
    expect(clipped.reason).toContain("damaged");
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
    const link = `EUVENA://${REQUEST_LINK_ACTION}?ref=chat&${REQUEST_LINK_PARAM}=${encodeURIComponent(payload)}`;

    const parsed = parseRequestLink(link);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.payload).toBe(payload);
  });

  it("rejects the retired eupi scheme and says what to do instead", () => {
    // Pre-rename links are dead on purpose: one accepted scheme keeps the
    // parser's surface as small as possible. The refusal names the migration
    // rather than reading as a damaged link, and the payload is never decoded.
    const link = `eupi://${REQUEST_LINK_ACTION}?${REQUEST_LINK_PARAM}=${encodeURIComponent(payload)}`;

    const parsed = parseRequestLink(link);

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toBe(
      "this link was shared before the app was renamed to Euvena; ask for a fresh link or code",
    );
  });

  it("emits the current scheme, never the legacy one", () => {
    // Pinned as a literal on purpose: the constant-based assertions elsewhere
    // would keep passing if the emitted scheme regressed to the legacy one.
    expect(buildRequestLink(payload).startsWith("euvena://request?")).toBe(true);
  });

  it("accepts a link with whitespace around it, as pasted", () => {
    expect(parseRequestLink(`  ${buildRequestLink(payload)}\n`).ok).toBe(true);
  });

  it("ends the query at a fragment instead of reading it into the payload", () => {
    const parsed = parseRequestLink(`${buildRequestLink(payload)}#from-a-chat`);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.payload).toBe(payload);
  });

  it("keeps a raw plus in a hand-assembled link rather than reading it as a space", () => {
    const withPlus = encodeEpcQr({
      name: "Wikimedia Foerdergesellschaft",
      iban: "DE33100205000001194700",
      text: "Rechnung 7+8",
    });
    const encoded = encodeURIComponent(withPlus).replace(/%2B/g, "+");

    const parsed = parseRequestLink(
      `${REQUEST_LINK_SCHEME}://${REQUEST_LINK_ACTION}?${REQUEST_LINK_PARAM}=${encoded}`,
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.text).toBe("Rechnung 7+8");
  });

  it("rejects another scheme, another action and a bare string", () => {
    expect(parseRequestLink(`https://${REQUEST_LINK_ACTION}?${REQUEST_LINK_PARAM}=x`).ok).toBe(false);
    expect(parseRequestLink(`${REQUEST_LINK_SCHEME}://pay?${REQUEST_LINK_PARAM}=x`).ok).toBe(false);
    expect(parseRequestLink(payload).ok).toBe(false);
  });

  it("rejects another action even when the link carries a valid payload", () => {
    const link = `${REQUEST_LINK_SCHEME}://pay?${REQUEST_LINK_PARAM}=${encodeURIComponent(payload)}`;

    expect(parseRequestLink(link).ok).toBe(false);
  });

  it("rejects a link that carries no request", () => {
    const parsed = parseRequestLink(`${REQUEST_LINK_SCHEME}://${REQUEST_LINK_ACTION}?ref=chat`);

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toContain("no payment request");
  });

  it("rejects a truncated escape rather than throwing", () => {
    const parsed = parseRequestLink(
      `${REQUEST_LINK_SCHEME}://${REQUEST_LINK_ACTION}?${REQUEST_LINK_PARAM}=BCD%`,
    );

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toContain("damaged");
  });

  it("rejects a payload a scanner would reject, so a link cannot smuggle one in", () => {
    const broken = payload.replace("DE33100205000001194700", "DE00100205000001194700");

    expect(parseRequestLink(buildRequestLink(broken)).ok).toBe(false);
  });

  it("describes an unreadable payload without repeating it", () => {
    const encoded = encodeURIComponent("EVIL\nlines");

    const parsed = parseRequestLink(
      `${REQUEST_LINK_SCHEME}://${REQUEST_LINK_ACTION}?${REQUEST_LINK_PARAM}=${encoded}`,
    );

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toBe("the link does not carry a valid payment request");
    expect(parsed.reason).not.toContain("EVIL");
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
