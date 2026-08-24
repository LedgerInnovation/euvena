/**
 * The shareable link form of a payment request.
 *
 * A request that leaves the device has to come back as the same request, so
 * the link carries the EPC069-12 payload itself rather than a second encoding
 * of the same fields. There is one codec and one source of truth: a link built
 * beside a code always decodes to the values that code carries.
 *
 * The scheme is the wallet's own and the link has no host, so a shared request
 * names no server. Nothing about it is resolved over the network and a link
 * that is opened is read entirely on the device that opened it.
 *
 * Links are built and parsed with string operations and the global percent
 * encoding functions rather than with `URL`, whose React Native implementation
 * does not carry the whole WHATWG surface.
 */

import { EpcQrError, decodeEpcQr, type EpcQrData } from "@eupi/qr";

import { summarizeRequest } from "./request";

/** URI scheme of a shared request. */
export const REQUEST_LINK_SCHEME = "eupi";

/** Path of a shared request, after the scheme. */
export const REQUEST_LINK_PATH = "request";

/** Query parameter holding the percent-encoded EPC069-12 payload. */
export const REQUEST_LINK_PARAM = "epc";

export type ParsedRequestLink =
  | { ok: true; payload: string; data: EpcQrData }
  | { ok: false; reason: string };

const NOT_A_REQUEST_LINK = `not a ${REQUEST_LINK_SCHEME}://${REQUEST_LINK_PATH} link`;

/** Wraps an EPC069-12 payload into the link form of the same request. */
export function buildRequestLink(payload: string): string {
  return `${REQUEST_LINK_SCHEME}://${REQUEST_LINK_PATH}?${REQUEST_LINK_PARAM}=${encodeURIComponent(payload)}`;
}

/**
 * Reads a shared link back into the payload it carries and the values a
 * scanner would read out of that payload.
 *
 * The payload is validated by the codec in strict mode, the same way a scanned
 * code is, so a link cannot smuggle in a request that a code could not carry.
 */
export function parseRequestLink(link: string): ParsedRequestLink {
  const trimmed = link.trim();

  const schemeEnd = trimmed.indexOf("://");
  if (schemeEnd === -1) return { ok: false, reason: NOT_A_REQUEST_LINK };
  // A scheme is case-insensitive (RFC 3986 section 3.1), the path is not.
  if (trimmed.slice(0, schemeEnd).toLowerCase() !== REQUEST_LINK_SCHEME) {
    return { ok: false, reason: NOT_A_REQUEST_LINK };
  }

  const rest = trimmed.slice(schemeEnd + 3);
  const queryStart = rest.indexOf("?");
  if (queryStart === -1 || rest.slice(0, queryStart) !== REQUEST_LINK_PATH) {
    return { ok: false, reason: NOT_A_REQUEST_LINK };
  }

  const encoded = findParameter(rest.slice(queryStart + 1), REQUEST_LINK_PARAM);
  if (encoded === undefined) {
    return { ok: false, reason: "the link carries no payment request" };
  }

  let payload: string;
  try {
    payload = decodeURIComponent(encoded);
  } catch {
    // decodeURIComponent throws a URIError on a truncated or malformed escape,
    // which is what a link mangled in transit looks like.
    return { ok: false, reason: "the link is damaged and cannot be read" };
  }

  try {
    return { ok: true, payload, data: decodeEpcQr(payload).data };
  } catch (error) {
    if (error instanceof EpcQrError) return { ok: false, reason: error.message };
    throw error;
  }
}

/**
 * Returns the first value of `name` in a query string, still percent-encoded.
 *
 * Percent escapes are the only decoding applied: "+" is left as it is rather
 * than read as a space. Nothing here ever emits an unescaped "+", so reading
 * one as a space would corrupt a remittance line that legitimately contains
 * one for the sake of a producer that does not exist.
 */
function findParameter(query: string, name: string): string | undefined {
  for (const pair of query.split("&")) {
    const separator = pair.indexOf("=");
    if (separator === -1) continue;
    if (pair.slice(0, separator) !== name) continue;
    return pair.slice(separator + 1);
  }
  return undefined;
}

/**
 * The text a share sheet carries: the request in the same invoice-style
 * presentation that is printed beside the code, then the link itself.
 *
 * The summary is for the person reading the message and the link is what
 * carries the request; both are built from the decoded payload, so neither can
 * drift from the code.
 */
export function buildShareMessage(data: EpcQrData, payload: string): string {
  const lines = summarizeRequest(data).map((row) => `${row.label}: ${row.value}`);
  return `${lines.join("\n")}\n\n${buildRequestLink(payload)}`;
}
