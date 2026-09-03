/**
 * Bridge between GNU Taler and the European payment QR standards.
 *
 * A Taler wallet is funded by wiring money to the exchange's bank account
 * with the reserve public key as the transfer subject: the exchange watches
 * its account (via LibEuFin/Nexus), finds the reserve public key in the
 * subject of an incoming credit, and credits that reserve.
 *
 * This package encodes that flow as a standard EPC069-12 QR code (the
 * "EPC QR" / GiroCode many European banking apps scan natively): the QR
 * carries the exchange's IBAN, an optional amount, and the reserve public
 * key as remittance text. Scanning it in a regular banking app produces a
 * correctly addressed SEPA (Instant) Credit Transfer that funds the
 * reserve, with no Taler-specific software on the payer's side.
 */

import { EpcQrError, decodeEpcQr, encodeEpcQr } from "@euvena/qr";

/**
 * Taler encodes binary data in Crockford base32 using the alphabet
 * 0-9 A-Z without I, L, O, U. A reserve public key is a 32-byte EdDSA
 * public key, which encodes to 52 characters.
 */
export const RESERVE_PUB_RE = /^[0-9A-HJKMNP-TV-Z]{52}$/;

/** True when the input is a well-formed Taler reserve public key. */
export function isValidReservePub(input: string): boolean {
  return RESERVE_PUB_RE.test(input);
}

/**
 * Extracts the first well-formed reserve public key token from a transfer
 * subject. Exchanges tolerate surrounding text in the subject line, and
 * some banks prepend or append their own text; this scans token-wise.
 */
export function findReservePub(subject: string): string | undefined {
  for (const token of subject.toUpperCase().split(/[^0-9A-Z]+/)) {
    if (RESERVE_PUB_RE.test(token)) return token;
  }
  return undefined;
}

export interface TalerTopupIssue {
  field: string;
  message: string;
}

export class TalerTopupError extends Error {
  readonly issues: TalerTopupIssue[];
  constructor(message: string, issues: TalerTopupIssue[]) {
    super(message);
    this.name = "TalerTopupError";
    this.issues = issues;
  }
}

export interface TalerTopupOptions {
  /** Account holder name of the exchange's bank account, up to 70 characters. */
  accountName: string;
  /** IBAN of the exchange's bank account. */
  iban: string;
  /** BIC of the exchange's bank; optional within the EEA. */
  bic?: string;
  /**
   * Amount in euro (number or numeric string). Omit for an open-amount QR
   * where the payer chooses the top-up amount in their banking app.
   */
  amount?: number | string;
  /** The Taler reserve public key to credit (52-character Crockford base32). */
  reservePub: string;
  /** Use CRLF as the payload element separator instead of LF. */
  crlf?: boolean;
}

/**
 * Builds an EPC069-12 QR payload that tops up the given Taler reserve when
 * scanned and confirmed in the payer's own banking app. Render it with any
 * QR library at error correction level M.
 *
 * @throws TalerTopupError on a malformed reserve public key; EpcQrError on
 *         invalid bank data (propagated from @euvena/qr).
 */
export function encodeTalerTopupQr(options: TalerTopupOptions): string {
  const reservePub = options.reservePub.toUpperCase();
  if (!isValidReservePub(reservePub)) {
    throw new TalerTopupError("invalid Taler reserve public key", [
      {
        field: "reservePub",
        message: "must be 52 Crockford base32 characters (0-9, A-Z without I, L, O, U)",
      },
    ]);
  }
  return encodeEpcQr({
    name: options.accountName,
    iban: options.iban,
    text: reservePub,
    ...(options.bic !== undefined ? { bic: options.bic } : {}),
    ...(options.amount !== undefined ? { amount: options.amount } : {}),
    ...(options.crlf !== undefined ? { crlf: options.crlf } : {}),
  });
}

export interface TalerTopup {
  /** The reserve public key found in the remittance text. */
  reservePub: string;
  /** IBAN of the receiving (exchange) account. */
  iban: string;
  /** Account holder name of the receiving account. */
  accountName: string;
  bic?: string;
  /** Amount in euro as a numeric string, when the QR fixes one. */
  amount?: string;
}

/**
 * Parses an EPC069-12 payload and extracts the Taler top-up details.
 *
 * @throws EpcQrError when the payload is not a valid EPC QR;
 *         TalerTopupError when it contains no reserve public key.
 */
export function parseTalerTopupQr(payload: string): TalerTopup {
  const { data } = decodeEpcQr(payload);
  const subject = data.text ?? data.reference ?? "";
  const reservePub = findReservePub(subject);
  if (reservePub === undefined) {
    throw new TalerTopupError("no Taler reserve public key in remittance information", [
      { field: "text", message: "expected a 52-character Crockford base32 reserve public key" },
    ]);
  }
  return {
    reservePub,
    iban: data.iban,
    accountName: data.name,
    ...(data.bic !== undefined ? { bic: data.bic } : {}),
    ...(data.amount !== undefined ? { amount: data.amount } : {}),
  };
}

export { EpcQrError };
