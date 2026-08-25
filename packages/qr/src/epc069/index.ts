/**
 * EPC069-12 v3.1 "Quick Response Code: Guidelines to Enable the Data Capture
 * for the Initiation of a SEPA Credit Transfer" (European Payments Council,
 * 19 March 2024). Known in the wild as the "EPC QR code" or "GiroCode".
 *
 * The payload is a line-separated text (LF or CRLF), maximum 331 bytes,
 * intended to be rendered as a QR code with error correction level M and
 * QR version <= 13:
 *
 *   1  Service tag        "BCD"                          mandatory
 *   2  Version            "001" | "002"                  mandatory
 *   3  Character set      "1".."8"                       mandatory
 *   4  Identification     "SCT"                          mandatory
 *   5  BIC                8 or 11 chars                  mandatory in 001, optional in 002 (EEA)
 *   6  Beneficiary name   <= 70 chars                    mandatory
 *   7  IBAN               <= 34 chars                    mandatory
 *   8  Amount             "EUR" + 1..12n                 optional, 0.01..999999999.99
 *   9  Purpose            <= 4 chars                     optional
 *  10  Reference          <= 35 chars (ISO 11649 RF)     optional, exclusive with 11
 *  11  Remittance text    <= 140 chars                   optional, exclusive with 10
 *  12  Information        <= 70 chars                    optional
 *
 * Trailing empty elements are omitted; the last populated element carries no
 * trailing separator.
 */

import { isNonEeaSepaIban, isValidIban, isValidRfReference, normalizeIban } from "../shared/iban.js";
import { byteLength, hasControlChars, isLatin1, type EpcCharset } from "../shared/text.js";
import { formatAmount, isValidAmountString } from "../shared/amount.js";

export const EPC069_MAX_BYTES = 331;

const BIC_RE = /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/;
const PURPOSE_RE = /^[A-Za-z0-9]{1,4}$/;

export interface EpcQrData {
  /** "001" requires a BIC; "002" (default) makes it optional within the EEA. */
  version: "001" | "002";
  /** EPC069-12 character set indicator; 1 = UTF-8 (default), 2 = ISO 8859-1, ... */
  charset: EpcCharset;
  /** BIC of the beneficiary PSP. */
  bic?: string;
  /** AT-E001 beneficiary name, up to 70 characters. */
  name: string;
  /** AT-C001 beneficiary IBAN. */
  iban: string;
  /** AT-T002 amount in euro as the numeric string that follows "EUR", e.g. "12.3". */
  amount?: string;
  /** AT-T007 purpose code, up to 4 characters. */
  purpose?: string;
  /** AT-T009 structured remittance information (ISO 11649 RF creditor reference may be used). */
  reference?: string;
  /** AT-T009 unstructured remittance information, up to 140 characters. */
  text?: string;
  /** Beneficiary-to-originator information, up to 70 characters. */
  information?: string;
}

export interface EncodeEpcQrOptions {
  version?: "001" | "002";
  charset?: EpcCharset;
  bic?: string;
  name: string;
  iban: string;
  /** Number (rounded to cents) or pre-formatted numeric string. */
  amount?: number | string;
  purpose?: string;
  reference?: string;
  text?: string;
  information?: string;
  /** Use CRLF as element separator instead of LF. */
  crlf?: boolean;
}

export interface EpcQrIssue {
  element: string;
  message: string;
}

export class EpcQrError extends Error {
  readonly issues: EpcQrIssue[];
  constructor(message: string, issues: EpcQrIssue[]) {
    super(message);
    this.name = "EpcQrError";
    this.issues = issues;
  }
}

function collectIssues(data: EpcQrData): EpcQrIssue[] {
  const issues: EpcQrIssue[] = [];

  // Control characters would shift the meaning of every following element,
  // letting a crafted free-text field displace the beneficiary's IBAN.
  for (const [element, value] of [
    ["name", data.name],
    ["reference", data.reference],
    ["text", data.text],
    ["information", data.information],
  ] as const) {
    if (value !== undefined && hasControlChars(value)) {
      issues.push({
        element,
        message: `${element} must not contain control characters or invisible formatting`,
      });
    }
  }

  if (data.version !== "001" && data.version !== "002") {
    issues.push({ element: "version", message: `unknown version "${data.version}"` });
  }
  if (!Number.isInteger(data.charset) || data.charset < 1 || data.charset > 8) {
    issues.push({ element: "charset", message: `character set must be 1..8, got ${data.charset}` });
  }

  if (data.bic !== undefined && data.bic !== "") {
    if (!BIC_RE.test(data.bic)) issues.push({ element: "bic", message: `invalid BIC "${data.bic}"` });
  } else if (data.version === "001") {
    issues.push({ element: "bic", message: "BIC is mandatory in version 001" });
  } else if (isNonEeaSepaIban(data.iban)) {
    // Version 002 keeps the BIC mandatory for SCT scheme participants from
    // non-EEA countries; the IBAN country is the signal available here.
    issues.push({
      element: "bic",
      message: "BIC is mandatory for beneficiary accounts in non-EEA SEPA countries",
    });
  }

  if (!data.name || data.name.length > 70) {
    issues.push({ element: "name", message: "beneficiary name is mandatory, 1..70 characters" });
  }

  if (!isValidIban(data.iban)) {
    issues.push({ element: "iban", message: `invalid IBAN "${data.iban}"` });
  }

  if (data.amount !== undefined && !isValidAmountString(data.amount)) {
    issues.push({ element: "amount", message: `invalid amount "${data.amount}"` });
  }

  if (data.purpose !== undefined && !PURPOSE_RE.test(data.purpose)) {
    issues.push({ element: "purpose", message: `purpose must be 1..4 alphanumeric characters` });
  }

  if (data.reference !== undefined && data.text !== undefined) {
    issues.push({
      element: "reference",
      message: "structured reference and unstructured text are mutually exclusive",
    });
  }
  if (data.reference !== undefined) {
    if (data.reference.length > 35) {
      issues.push({ element: "reference", message: "structured reference is limited to 35 characters" });
    } else if (/^RF/i.test(data.reference) && !isValidRfReference(data.reference)) {
      issues.push({ element: "reference", message: `invalid ISO 11649 creditor reference "${data.reference}"` });
    }
  }
  if (data.text !== undefined && data.text.length > 140) {
    issues.push({ element: "text", message: "unstructured remittance is limited to 140 characters" });
  }
  if (data.information !== undefined && data.information.length > 70) {
    issues.push({ element: "information", message: "information is limited to 70 characters" });
  }

  return issues;
}

/**
 * Builds an EPC069-12 payload string, ready to be rendered as a QR code
 * (error correction level M).
 *
 * @throws EpcQrError when the input violates the specification.
 */
export function encodeEpcQr(options: EncodeEpcQrOptions): string {
  const data: EpcQrData = {
    version: options.version ?? "002",
    charset: options.charset ?? 1,
    name: options.name,
    iban: normalizeIban(options.iban),
  };
  if (options.bic !== undefined) data.bic = options.bic.toUpperCase();
  if (options.amount !== undefined) data.amount = formatAmount(options.amount);
  if (options.purpose !== undefined) data.purpose = options.purpose;
  if (options.reference !== undefined) data.reference = options.reference;
  if (options.text !== undefined) data.text = options.text;
  if (options.information !== undefined) data.information = options.information;

  const issues = collectIssues(data);
  if (issues.length > 0) throw new EpcQrError("invalid EPC QR data", issues);

  const elements = [
    "BCD",
    data.version,
    String(data.charset),
    "SCT",
    data.bic ?? "",
    data.name,
    data.iban,
    data.amount !== undefined ? `EUR${data.amount}` : "",
    data.purpose ?? "",
    data.reference ?? "",
    data.text ?? "",
    data.information ?? "",
  ];
  while (elements.length > 7 && elements[elements.length - 1] === "") elements.pop();

  const payload = elements.join(options.crlf ? "\r\n" : "\n");

  if (data.charset === 2 && !isLatin1(payload)) {
    throw new EpcQrError("payload contains characters outside ISO 8859-1", [
      { element: "charset", message: "character set 2 requires ISO 8859-1 encodable content" },
    ]);
  }
  const bytes = byteLength(payload, data.charset);
  if (bytes > EPC069_MAX_BYTES) {
    throw new EpcQrError(`payload is ${bytes} bytes, maximum is ${EPC069_MAX_BYTES}`, [
      { element: "payload", message: `payload exceeds ${EPC069_MAX_BYTES} bytes` },
    ]);
  }
  return payload;
}

export interface DecodeEpcQrResult {
  data: EpcQrData;
  /** Validation issues found while decoding in lenient mode. */
  issues: EpcQrIssue[];
}

export interface DecodeEpcQrOptions {
  /**
   * In strict mode (default) any validation issue throws EpcQrError.
   * In lenient mode structurally readable payloads are returned along
   * with the list of issues.
   */
  strict?: boolean;
}

/**
 * Parses an EPC069-12 payload (as scanned from a QR code).
 *
 * @throws EpcQrError on structurally unreadable payloads, and on any
 *         validation issue when `strict` is true.
 */
export function decodeEpcQr(payload: string, options: DecodeEpcQrOptions = {}): DecodeEpcQrResult {
  const strict = options.strict ?? true;
  const raw = payload.replace(/[\r\n]+$/, "");
  const lines = raw.replace(/\r\n/g, "\n").split("\n");

  if (lines[0] !== "BCD") {
    throw new EpcQrError(`not an EPC QR payload: service tag is "${lines[0] ?? ""}"`, [
      { element: "serviceTag", message: 'first element must be "BCD"' },
    ]);
  }
  if (lines.length < 7) {
    throw new EpcQrError("payload has fewer than the 7 minimum elements", [
      { element: "payload", message: "mandatory elements up to IBAN are missing" },
    ]);
  }
  if (lines[3] !== "SCT") {
    throw new EpcQrError(`unsupported identification code "${lines[3]}"`, [
      { element: "identification", message: 'identification code must be "SCT"' },
    ]);
  }

  // The character set element is exactly one digit: "01", " 1" and "1.0"
  // must not be coerced into a supported value.
  const charsetSeg = lines[2] ?? "";
  const charsetNum = /^[1-8]$/.test(charsetSeg) ? Number(charsetSeg) : Number.NaN;
  const data: EpcQrData = {
    version: lines[1] as EpcQrData["version"],
    charset: charsetNum as EpcCharset,
    name: lines[5] ?? "",
    iban: normalizeIban(lines[6] ?? ""),
  };
  const bicLine = lines[4];
  if (bicLine) data.bic = bicLine;

  const amountLine = lines[7];
  if (amountLine) {
    // A missing EUR prefix is reported as an issue below; the raw value is kept.
    data.amount = /^EUR/.test(amountLine) ? amountLine.slice(3) : amountLine;
  }
  const purposeLine = lines[8];
  if (purposeLine) data.purpose = purposeLine;
  const referenceLine = lines[9];
  if (referenceLine) data.reference = referenceLine;
  const textLine = lines[10];
  if (textLine) data.text = textLine;
  const informationLine = lines[11];
  if (informationLine) data.information = informationLine;

  const issues = collectIssues(data);
  if (amountLine && !/^EUR/.test(amountLine)) {
    issues.push({ element: "amount", message: `amount must be prefixed with "EUR", got "${amountLine}"` });
  }
  if (lines.length > 12) {
    issues.push({ element: "payload", message: `payload has ${lines.length} elements, maximum is 12` });
  }
  if (charsetNum >= 1 && charsetNum <= 8) {
    if (charsetNum === 2 && !isLatin1(payload)) {
      issues.push({ element: "charset", message: "character set 2 requires ISO 8859-1 encodable content" });
    }
    // Measured on the input as scanned: the 331-byte limit applies to the
    // whole QR payload, including any (non-conformant) trailing separator.
    const bytes = byteLength(payload, charsetNum as EpcCharset);
    if (bytes > EPC069_MAX_BYTES) {
      issues.push({ element: "payload", message: `payload is ${bytes} bytes, maximum is ${EPC069_MAX_BYTES}` });
    }
  }

  if (strict && issues.length > 0) {
    throw new EpcQrError("invalid EPC QR payload", issues);
  }
  return { data, issues };
}
