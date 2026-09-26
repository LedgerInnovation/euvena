/**
 * RFC 8905 payto URIs for SEPA credit transfers: the Euvena payto handoff
 * profile, specified in docs/payto-handoff.md at the repository root.
 *
 * A payto URI names a payment target. For the `iban` target type
 * (RFC 8905 section 7.3) it carries what a payer's banking app needs to
 * prefill a SEPA credit transfer, the same request an EPC069-12 code
 * carries:
 *
 *   payto://iban/[<BIC>/]<IBAN>?amount=EUR:<amount>&receiver-name=<name>&message=<text>
 *
 * encodePaytoUri writes one from the elements of a request and
 * decodePaytoUri reads one back into elements that encodeEpcQr takes. Both
 * hold each element to the EPC069-12 rules (IBAN check digits, BIC format,
 * name and text length, no control or bidirectional formatting characters),
 * so a URI read here says nothing a code could not.
 *
 * A structured creditor reference has no payto option. `message` is the
 * unstructured remittance information and `instruction` the end-to-end
 * identifier, so either would silently downgrade it and the creditor's
 * reconciliation could miss the payment. The encoder refuses a reference
 * unless the caller says to leave it out, and the caller then has to tell
 * the payer.
 */

import { collectIssues, type EpcQrData, type EpcQrIssue } from "../epc069/index.js";
import { formatAmount, isValidAmountString } from "../shared/amount.js";
import { normalizeIban } from "../shared/iban.js";

/** The elements of a SEPA credit transfer that a payto URI carries. */
export interface PaytoTransfer {
  /** Beneficiary name, the `receiver-name` option. */
  name: string;
  /** Beneficiary IBAN in its electronic form. */
  iban: string;
  /** BIC of the beneficiary PSP, the first path segment when present. */
  bic?: string;
  /** Amount in euro as a numeric string, e.g. "12.3". */
  amount?: string;
  /** Unstructured remittance information, the `message` option. */
  text?: string;
}

export interface EncodePaytoInput {
  name: string;
  iban: string;
  bic?: string | undefined;
  /** Number (rounded to cents) or numeric string, in euro. */
  amount?: number | string | undefined;
  text?: string | undefined;
  /**
   * A structured creditor reference. No payto option carries one, so it is
   * refused unless `omitReference` is set.
   */
  reference?: string | undefined;
}

export interface EncodePaytoOptions {
  /**
   * Leave a structured reference out instead of refusing it. A caller that
   * sets this shows the payer the reference to enter by hand.
   */
  omitReference?: boolean;
}

/**
 * Why a payto URI was refused.
 *
 * - "not-payto": the input is not a payto URI
 * - "not-iban": the target type is not `iban`, or carries userinfo or a port
 * - "malformed": the path or the query is not built the way the profile says
 * - "damaged": a percent escape is truncated or not UTF-8
 * - "repeated-option": an option is given twice
 * - "instruction": an end-to-end identifier, which the profile cannot pass on
 * - "unknown-option": an option the profile does not define
 * - "no-name": no beneficiary name
 * - "amount": the amount is not a SEPA amount in the RFC 8905 syntax
 * - "currency": the amount is in a currency other than euro
 * - "invalid": elements fail the EPC069-12 checks; `issues` names them
 */
export type PaytoErrorCode =
  | "not-payto"
  | "not-iban"
  | "malformed"
  | "damaged"
  | "repeated-option"
  | "instruction"
  | "unknown-option"
  | "no-name"
  | "amount"
  | "currency"
  | "invalid";

export class PaytoError extends Error {
  readonly code: PaytoErrorCode;
  /** The elements that failed, when `code` is "invalid". */
  readonly issues: EpcQrIssue[];
  constructor(code: PaytoErrorCode, message: string, issues: EpcQrIssue[] = []) {
    super(message);
    this.name = "PaytoError";
    this.code = code;
    this.issues = issues;
  }
}

const PAYTO_PREFIX = "payto://";

/** True when the text begins like a payto URI, compared without case. */
export function isPaytoUri(text: string): boolean {
  return text.slice(0, PAYTO_PREFIX.length).toLowerCase() === PAYTO_PREFIX;
}

/**
 * Builds a payto URI for a SEPA credit transfer.
 *
 * @throws PaytoError with code "invalid" when an element fails the EPC069-12
 *         checks, or when a structured reference is given without
 *         `omitReference`.
 */
export function encodePaytoUri(input: EncodePaytoInput, options: EncodePaytoOptions = {}): string {
  const issues: EpcQrIssue[] = [];
  if (input.reference !== undefined && options.omitReference !== true) {
    issues.push({
      element: "reference",
      message: "a structured reference has no payto option; set omitReference to leave it out",
    });
  }

  let amount: string | undefined;
  if (input.amount !== undefined) {
    try {
      amount = formatAmount(input.amount);
    } catch {
      issues.push({ element: "amount", message: "invalid amount" });
    }
  }

  const transfer: PaytoTransfer = {
    name: input.name,
    iban: normalizeIban(input.iban),
  };
  if (input.bic !== undefined) transfer.bic = input.bic.toUpperCase();
  if (amount !== undefined) transfer.amount = amount;
  if (input.text !== undefined) transfer.text = input.text;

  issues.push(...elementIssues(transfer));
  if (issues.length > 0) throw new PaytoError("invalid", "invalid payto transfer", issues);

  const path =
    transfer.bic === undefined
      ? encodeURIComponent(transfer.iban)
      : `${encodeURIComponent(transfer.bic)}/${encodeURIComponent(transfer.iban)}`;

  const query: [string, string][] = [];
  if (transfer.amount !== undefined) query.push(["amount", `EUR:${transfer.amount}`]);
  query.push(["receiver-name", transfer.name]);
  if (transfer.text !== undefined) query.push(["message", transfer.text]);

  return `payto://iban/${path}?${query
    .map(([name, value]) => `${name}=${encodeOptionValue(value)}`)
    .join("&")}`;
}

/**
 * Percent encodes an option value, keeping ":" literal: a colon is valid in a
 * query (RFC 3986 pchar) and the RFC 8905 amount examples carry it bare, so
 * the plain form is what existing payto parsers are known to read.
 */
function encodeOptionValue(value: string): string {
  return encodeURIComponent(value).replace(/%3A/gi, ":");
}

/** Options read into the transfer. */
const READ_OPTIONS = new Set(["amount", "receiver-name", "message"]);

/**
 * Options that describe the parties rather than the payment: the payer's own
 * name, and the creditor address the GNU Taler wallets add, which neither a
 * code nor a transfer form takes and which does not change where the money
 * goes.
 */
const IGNORED_OPTIONS = new Set(["sender-name", "receiver-postal-code", "receiver-town"]);

/**
 * Reads a `payto://iban` URI into the elements of a SEPA credit transfer.
 * The result can be passed to encodeEpcQr as it is.
 *
 * Every option lands in an element or makes the URI fail, except the three
 * in IGNORED_OPTIONS:
 * - `receiver-name` is the beneficiary name, which is required
 * - `amount` must be in euro, at most once (RFC 8905 section 5). Digits past
 *   the cent must be zeros. Commas are refused although the RFC says to
 *   ignore them: a producer writing a decimal comma would otherwise have
 *   "12,50" paid as 1250
 * - `message` is the unstructured remittance text (section 7.3)
 * - `instruction` is the end-to-end identifier, which the profile cannot
 *   carry on. Section 6 says to refuse rather than lose it
 * - anything else is refused, as is any option given twice. That includes
 *   `ch-qrr` (a Swiss structured reference) and a `bic` option that would
 *   compete with the path
 *
 * Option names are matched exactly, although RFC 5234 makes the RFC's quoted
 * names case-insensitive. The GNU Taler wallet matches them exactly, so
 * "AMOUNT" is an option that reader skips: honouring it here would have the
 * two readers pay different sums. A raw "+" in a value is read as a space, as
 * the GNU Taler wallet reads it and as the PHP and Python query builders that
 * invoicing backends use write one. A literal plus has to arrive as "%2B",
 * which encodePaytoUri emits. One trailing slash after the account is
 * accepted, since Taler exchanges publish their accounts that way.
 *
 * Error messages are fixed sentences that never repeat the input; the
 * messages of `issues` may quote the value that failed.
 *
 * The URI has no size limit of its own. A name and a text that each pass can
 * still overrun the 331 bytes of an EPC069-12 payload together, which
 * encodeEpcQr reports on the "payload" element.
 *
 * @throws PaytoError
 */
export function decodePaytoUri(uri: string): PaytoTransfer {
  if (!isPaytoUri(uri)) throw new PaytoError("not-payto", "not a payto URI");
  // RFC 8905 has no fragment. A stray one must not ride into a value.
  if (uri.includes("#")) throw malformed();

  const rest = uri.slice(PAYTO_PREFIX.length);
  const queryStart = rest.indexOf("?");
  const hierarchy = queryStart === -1 ? rest : rest.slice(0, queryStart);
  const query = queryStart === -1 ? undefined : rest.slice(queryStart + 1);

  // The authority is the target type alone. Userinfo or a port leaves
  // something other than "iban" here and is refused with it.
  const [target, ...segments] = hierarchy.split("/");
  if (target === undefined || target.toLowerCase() !== "iban") {
    throw new PaytoError("not-iban", "the payto target type is not iban");
  }
  if (segments.length > 1 && segments[segments.length - 1] === "") segments.pop();
  // Section 7.3: the path is the IBAN, or the BIC followed by the IBAN.
  if (segments.length < 1 || segments.length > 2) throw malformed();

  const raw = new Map<string, string>();
  if (query !== undefined) {
    for (const pair of query.split("&")) {
      const separator = pair.indexOf("=");
      if (separator < 1) throw malformed();
      const name = pair.slice(0, separator);
      if (raw.has(name)) throw new PaytoError("repeated-option", "a payto option is repeated");
      raw.set(name, pair.slice(separator + 1));
    }
  }

  let path: string[];
  const options = new Map<string, string>();
  try {
    path = segments.map((segment) => decodeURIComponent(segment));
    for (const [name, value] of raw)
      options.set(name, decodeURIComponent(value.replace(/\+/g, " ")));
  } catch {
    // decodeURIComponent throws a URIError on a truncated or malformed escape.
    throw new PaytoError("damaged", "the payto URI has a damaged percent escape");
  }

  // Account identifiers are plain letters and digits in their electronic
  // form. Normalising would quietly strip whitespace, including an escaped
  // line break, so anything else is refused here instead.
  if (!path.every((segment) => /^[A-Za-z0-9]+$/.test(segment))) throw malformed();

  for (const name of options.keys()) {
    if (name === "instruction") {
      throw new PaytoError("instruction", "the payto URI carries an end-to-end identifier");
    }
    if (!READ_OPTIONS.has(name) && !IGNORED_OPTIONS.has(name)) {
      throw new PaytoError("unknown-option", "the payto URI carries an unknown option");
    }
  }

  const name = options.get("receiver-name") ?? "";
  if (name === "") throw new PaytoError("no-name", "the payto URI names no beneficiary");

  const transfer: PaytoTransfer = {
    name,
    iban: normalizeIban(path[path.length - 1] ?? ""),
  };
  if (path.length === 2) transfer.bic = (path[0] ?? "").toUpperCase();

  const amount = options.get("amount");
  if (amount !== undefined) transfer.amount = readAmount(amount);

  const message = options.get("message") ?? "";
  if (message !== "") transfer.text = message;

  const issues = elementIssues(transfer);
  if (issues.length > 0) throw new PaytoError("invalid", "invalid payto transfer", issues);
  return transfer;
}

function malformed(): PaytoError {
  return new PaytoError("malformed", "the payto URI is malformed");
}

/** The EPC069-12 element checks, on the elements a payto URI carries. */
function elementIssues(transfer: PaytoTransfer): EpcQrIssue[] {
  const data: EpcQrData = {
    version: "002",
    charset: 1,
    name: transfer.name,
    iban: transfer.iban,
  };
  if (transfer.bic !== undefined) data.bic = transfer.bic;
  if (transfer.amount !== undefined) data.amount = transfer.amount;
  if (transfer.text !== undefined) data.text = transfer.text;
  return collectIssues(data);
}

/**
 * `currency ":" unit [ "." fraction ]` (RFC 8905 section 5) as the numeric
 * string EPC069-12 carries after "EUR". Commas are refused rather than
 * ignored, since a decimal comma read that way changes the sum. The fraction
 * may run to eight digits, but a SEPA amount stops at the cent, so anything
 * past it must be zeros: rounding would change what is paid.
 */
function readAmount(value: string): string {
  const unusable = new PaytoError("amount", "the payto amount is not a SEPA amount");

  const separator = value.indexOf(":");
  if (separator === -1) throw unusable;
  if (value.slice(0, separator).toUpperCase() !== "EUR") {
    throw new PaytoError("currency", "the payto amount is not in euro");
  }

  // Digits only on both sides of the point, so a comma never gets through.
  const number = value.slice(separator + 1);
  const point = number.indexOf(".");
  const unit = point === -1 ? number : number.slice(0, point);
  const fraction = point === -1 ? undefined : number.slice(point + 1);
  if (!/^\d+$/.test(unit)) throw unusable;
  if (fraction !== undefined && !/^\d{1,8}$/.test(fraction)) throw unusable;
  if (fraction !== undefined && !/^0*$/.test(fraction.slice(2))) throw unusable;

  const cents = fraction?.slice(0, 2);
  const canonical = `${unit.replace(/^0+(?=\d)/, "")}${cents === undefined ? "" : `.${cents}`}`;
  if (!isValidAmountString(canonical)) throw unusable;
  return canonical;
}
