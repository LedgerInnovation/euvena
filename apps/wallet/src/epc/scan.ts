/**
 * Reads payer-side input, a scanned QR code, pasted text or a link the app was
 * opened with, back into a payment request.
 *
 * Three shapes arrive here: the EPC069-12 payload itself, which is what a
 * displayed or printed code carries, the shared-link form from ./link and an
 * RFC 8905 payto URI from ./payto. All of them end at the same codec in strict
 * mode, so nothing scanned, pasted or opened can present values that a code
 * could not carry.
 *
 * Rejection reasons are fixed sentences that name the element that failed and
 * nothing else. The codec's own messages can quote the value they rejected,
 * and a scanned code is someone else's writing, so they are never shown.
 */

import { EpcQrError, decodeEpcQr, encodeEpcQr, type EpcQrData } from "@euvena/qr";

import { elementKeys, sameRejection, type Rejection } from "../i18n";
import { REQUEST_LINK_SCHEME, parseRequestLink } from "./link";
import { PAYTO_SCHEME, parsePaytoUri } from "./payto";

export type ReadRequestResult =
  | { ok: true; payload: string; data: EpcQrData }
  | { ok: false; reason: Rejection };

/** A request the app was opened with, numbered in order of arrival. */
export interface OpenedRequest {
  id: number;
  result: ReadRequestResult;
}

export const NOT_A_PAYMENT_INPUT: Rejection = { code: "notPaymentInput" };

/** Input shaped like a URI, which belongs to the link parser. */
const SCHEME_SHAPED = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;

/** How a URL in the wallet's own scheme begins. */
const OWN_SCHEME_PREFIX = `${REQUEST_LINK_SCHEME}:`;

/** How a payto URI begins, compared without case. */
const PAYTO_PREFIX = `${PAYTO_SCHEME}://`;

const PAYTO_TOO_LONG: Rejection = { code: "paytoTooLong" };

/**
 * Classifies the input, then decodes it through the codec in strict mode.
 *
 * The payload shape is checked first: remittance text may legitimately carry a
 * web address, so the presence of something link-shaped inside a payload must
 * not reroute the whole input to the link parser.
 *
 * A payload is decoded exactly as it arrived. The codec measures the 331-byte
 * cap on the bytes as scanned, so stripping even a trailing separator would
 * admit an oversized code, and trailing whitespace inside the last element is
 * part of the request, not packaging. Text from a clipboard goes through
 * readPastedRequest instead.
 */
export function readPaymentRequest(input: string): ReadRequestResult {
  if (input.startsWith("BCD")) {
    try {
      return { ok: true, payload: input, data: decodeEpcQr(input).data };
    } catch (error) {
      if (error instanceof EpcQrError) {
        return { ok: false, reason: rejectionOf(error, "codeInvalid") };
      }
      throw error;
    }
  }

  const trimmed = input.trim();
  if (trimmed === "") return { ok: false, reason: { code: "empty" } };
  if (trimmed.slice(0, PAYTO_PREFIX.length).toLowerCase() === PAYTO_PREFIX) {
    return readPaytoRequest(trimmed);
  }
  if (SCHEME_SHAPED.test(trimmed)) return parseRequestLink(trimmed);

  return { ok: false, reason: NOT_A_PAYMENT_INPUT };
}

/**
 * Turns a payto URI into the EPC069-12 payload of the same request and reads
 * that payload back, so the review shows what an equivalent code carries.
 *
 * A link has no size limit of its own, so its name and text can each pass
 * and still not fit the 331 bytes of a code together. That is the only way
 * the encoder faults the payload as a whole here. The structure of the link
 * is not what is wrong, so the case gets its own sentence.
 */
function readPaytoRequest(uri: string): ReadRequestResult {
  const parsed = parsePaytoUri(uri);
  if (!parsed.ok) return parsed;
  try {
    const payload = encodeEpcQr(parsed.request);
    return { ok: true, payload, data: decodeEpcQr(payload).data };
  } catch (error) {
    if (error instanceof EpcQrError) {
      if (error.issues.some((issue) => issue.element === "payload")) {
        return { ok: false, reason: PAYTO_TOO_LONG };
      }
      return { ok: false, reason: rejectionOf(error, "paytoInvalid") };
    }
    throw error;
  }
}

/**
 * The paste entry's route into readPaymentRequest. Outer whitespace on pasted
 * text is packaging from the clipboard or the message app, so it is removed
 * before the input is classified; everything inside passes through unchanged.
 */
export function readPastedRequest(input: string): ReadRequestResult {
  return readPaymentRequest(input.trim());
}

/**
 * Reads a URL the operating system opened the app with, at launch or while it
 * runs. Returns null when there is nothing to show.
 *
 * Only the wallet's own scheme is read. This check is what decides it, since
 * registering a scheme does not stop other URLs from arriving: any Android app
 * can address the app directly with a URL of its choosing, an iOS build also
 * answers to its bundle identifier and a development host launches the app
 * with a URL of its own (Expo Go uses exp://), which is not a failed request.
 * Everything in the wallet's scheme goes to parseRequestLink, the parser a
 * pasted link reaches, so a link that is ours but malformed ends as a
 * rejection rather than as a partial request.
 */
export function readOpenedLink(url: string | null): ReadRequestResult | null {
  if (url === null) return null;
  // Compared without case, as parseRequestLink compares schemes.
  if (url.slice(0, OWN_SCHEME_PREFIX.length).toLowerCase() !== OWN_SCHEME_PREFIX) return null;
  return parseRequestLink(url);
}

/**
 * What the scan screen does with an opened request while it may already be
 * showing something.
 *
 * - "show": nothing is on screen, so the opened request is shown.
 * - "same": the screen already shows this very request, so nothing changes.
 * - "hold": something else is on screen. It stays and the payer is told that
 *   another request is waiting. Swapping it in place would change the values
 *   under a payer who has already checked them, right where the handoff
 *   actions are about to be tapped.
 */
export function openedRequestStep(
  shown: ReadRequestResult | null,
  opened: ReadRequestResult,
): "show" | "same" | "hold" {
  if (shown === null) return "show";
  if (shown.ok && opened.ok) return shown.payload === opened.payload ? "same" : "hold";
  if (!shown.ok && !opened.ok) return sameRejection(shown.reason, opened.reason) ? "same" : "hold";
  return "hold";
}

/**
 * The elements that failed, by key, so the screen names them in the user's
 * language and never from the codec's messages.
 */
function rejectionOf(error: EpcQrError, code: "codeInvalid" | "paytoInvalid"): Rejection {
  return { code, elements: elementKeys(error.issues.map((issue) => issue.element)) };
}
