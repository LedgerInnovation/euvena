/**
 * Reads payer-side input, a scanned QR code or pasted text, back into a
 * payment request.
 *
 * Two shapes arrive here: the EPC069-12 payload itself, which is what a
 * displayed or printed code carries, and the shared-link form from ./link.
 * Both end at the same codec in strict mode, so nothing scanned or pasted can
 * present values that a code could not carry.
 *
 * Rejection reasons are fixed sentences that name the element that failed and
 * nothing else. The codec's own messages can quote the value they rejected,
 * and a scanned code is someone else's writing, so they are never shown.
 */

import { EpcQrError, decodeEpcQr, type EpcQrData } from "@eupi/qr";

import { parseRequestLink } from "./link";

export type ReadRequestResult =
  | { ok: true; payload: string; data: EpcQrData }
  | { ok: false; reason: string };

export const NOT_A_PAYMENT_INPUT = "not a payment code or a shared payment link";

/** Input shaped like a URI, which belongs to the link parser. */
const SCHEME_SHAPED = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;

/** What each codec element is called when a rejection names it. */
const ELEMENT_LABELS: Record<string, string> = {
  serviceTag: "the service tag",
  version: "the format version",
  charset: "the character set",
  identification: "the identification code",
  bic: "the BIC",
  name: "the beneficiary name",
  iban: "the IBAN",
  amount: "the amount",
  purpose: "the purpose code",
  reference: "the payment reference",
  text: "the remittance text",
  information: "the information line",
  payload: "the overall structure",
};

/**
 * Classifies the input, then decodes it through the codec in strict mode.
 *
 * The payload shape is checked first: remittance text may legitimately carry a
 * web address, so the presence of something link-shaped inside a payload must
 * not reroute the whole input to the link parser.
 */
export function readPaymentRequest(input: string): ReadRequestResult {
  const trimmed = input.trim();
  if (trimmed === "") return { ok: false, reason: "there is nothing to read" };

  if (trimmed.startsWith("BCD")) {
    try {
      return { ok: true, payload: trimmed, data: decodeEpcQr(trimmed).data };
    } catch (error) {
      if (error instanceof EpcQrError) return { ok: false, reason: describeRejection(error) };
      throw error;
    }
  }

  if (SCHEME_SHAPED.test(trimmed)) return parseRequestLink(trimmed);

  return { ok: false, reason: NOT_A_PAYMENT_INPUT };
}

/**
 * One sentence naming the elements that failed, built from this module's own
 * labels and never from the codec's messages.
 */
function describeRejection(error: EpcQrError): string {
  const labels: string[] = [];
  for (const issue of error.issues) {
    const label = ELEMENT_LABELS[issue.element] ?? "an element";
    if (!labels.includes(label)) labels.push(label);
  }
  if (labels.length === 0) return "the code does not carry a valid payment request";
  return `the code is not a valid payment request: ${joinLabels(labels)} failed the checks`;
}

function joinLabels(labels: string[]): string {
  const last = labels[labels.length - 1] ?? "";
  if (labels.length === 1) return last;
  return `${labels.slice(0, -1).join(", ")} and ${last}`;
}
