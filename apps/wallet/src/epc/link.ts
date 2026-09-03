/**
 * The shareable link form of a payment request.
 *
 * A request that leaves the device has to come back as the same request, so
 * the link carries the EPC069-12 payload itself rather than a second encoding
 * of the same fields. There is one codec and one source of truth: a link built
 * beside a code always decodes to the values that code carries.
 *
 * The scheme is the wallet's own and the word after it names an action, not a
 * server, even though it occupies the spot a web address uses for its host.
 * Nothing about a shared request is resolved over the network and a link that
 * is opened is read entirely on the device that opened it.
 *
 * Links are built and parsed with string operations and the global percent
 * encoding functions rather than with `URL`, whose React Native implementation
 * does not carry the whole WHATWG surface.
 */

import { EpcQrError, decodeEpcQr, type EpcQrData } from "@euvena/qr";

import { summarizeRequest } from "./request";

/** URI scheme of a shared request. */
export const REQUEST_LINK_SCHEME = "euvena";

/**
 * The word after the scheme, naming what a link carries. It sits where a web
 * address keeps its host, so URL parsers report it as one; it names no server.
 */
export const REQUEST_LINK_ACTION = "request";

/** Query parameter holding the percent-encoded EPC069-12 payload. */
export const REQUEST_LINK_PARAM = "epc";

export type ParsedRequestLink =
  | { ok: true; payload: string; data: EpcQrData }
  | { ok: false; reason: string };

const NOT_A_REQUEST_LINK = `not a ${REQUEST_LINK_SCHEME}://${REQUEST_LINK_ACTION} link`;

/**
 * Scheme the wallet emitted before it was renamed to Euvena, retired on
 * purpose so exactly one scheme is registered with the operating system and
 * accepted here. A retired link is still recognised, but only to say what
 * happened and what to do: its payload is never decoded.
 */
const RETIRED_LINK_SCHEME = "eupi";

const RETIRED_LINK_NOTICE =
  "this link was shared before the app was renamed to Euvena; ask for a fresh link or code";

/**
 * Wraps an EPC069-12 payload into the link form of the same request.
 *
 * On top of percent encoding, the characters it leaves bare that message apps
 * commonly split off the end of a link (".", "!", "'", parentheses, "*") are
 * escaped as well. A link travels as plain text and remittance text decides
 * how it ends; kept inside escapes, a clipped link reads as damaged instead of
 * decoding to an altered request.
 */
export function buildRequestLink(payload: string): string {
  const encoded = encodeURIComponent(payload).replace(
    /[.!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${REQUEST_LINK_SCHEME}://${REQUEST_LINK_ACTION}?${REQUEST_LINK_PARAM}=${encoded}`;
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
  // A scheme is case-insensitive (RFC 3986 section 3.1) and normalizers do
  // lowercase it. The word after it is compared exactly: the wallet only emits
  // lowercase, and parsers pass this part of a custom-scheme link through as
  // written.
  const scheme = trimmed.slice(0, schemeEnd).toLowerCase();
  if (scheme === RETIRED_LINK_SCHEME) return { ok: false, reason: RETIRED_LINK_NOTICE };
  if (scheme !== REQUEST_LINK_SCHEME) {
    return { ok: false, reason: NOT_A_REQUEST_LINK };
  }

  const rest = trimmed.slice(schemeEnd + 3);
  const queryStart = rest.indexOf("?");
  if (queryStart === -1 || rest.slice(0, queryStart) !== REQUEST_LINK_ACTION) {
    return { ok: false, reason: NOT_A_REQUEST_LINK };
  }

  // The query ends at the first "#" (RFC 3986 section 3.4). The wallet never
  // builds a fragment, but a stray one must not ride into the payload.
  const fragmentStart = rest.indexOf("#", queryStart + 1);
  const query = rest.slice(queryStart + 1, fragmentStart === -1 ? rest.length : fragmentStart);

  const encoded = findParameter(query, REQUEST_LINK_PARAM);
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
    if (error instanceof EpcQrError) {
      // The codec's message can repeat the input it rejected, and a link's
      // payload is someone else's writing. Describe it instead, the way
      // validatePayee replaces messages that would echo a typed value.
      return { ok: false, reason: "the link does not carry a valid payment request" };
    }
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
