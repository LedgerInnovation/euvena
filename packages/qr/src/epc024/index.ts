/**
 * EPC024-22 v2.10 "Standardisation of QR-codes for Mobile Initiated SEPA
 * (Instant) Credit Transfers" (European Payments Council, 17 June 2024),
 * the specification underlying EN 18184:2025.
 *
 * An MSCT QR code is an https URL with five parts (EPC024-22 section 4.4):
 *
 *   https://<domain>/<version>/<type>/<MSCT service provider ID>/?<payload>
 *
 * - domain: the MSCT interoperability framework or scheme domain
 * - version: "1" for the first version
 * - type (payee-presented): payment context
 *     m = mobile payment at the POI, e = e-commerce, i = invoice,
 *     p = person-to-person, w = URL opened in a webview (virtual POI)
 *   (for payer-presented codes the type is reserved for future use)
 * - MSCT service provider ID: 3 alphanumeric characters, issued by the framework
 * - payload: standard URL query parameters ("?" then "&"-separated)
 *
 * EPC024-22 fixes the payload CONTENT (section 4.5, tables 8 and 9) but leaves
 * the query parameter NAMES to the payload issuer: "the payload is at the
 * discretion of the payload issuer [...] the only constraint is that the
 * parameters have to be structured so that the URL in its entirety is a valid
 * URL". The parameter names used here are therefore the Euvena profile v1, an
 * open naming proposal documented in the README; pass a custom `keys` mapping
 * to interoperate with issuers that chose different names.
 */

import { isValidIban, isValidRfReference, normalizeIban } from "../shared/iban.js";
import { formatAmount, isValidAmountString } from "../shared/amount.js";
import { hasControlChars } from "../shared/text.js";

/** Payment context for payee-presented QR codes (EPC024-22 section 4.5). */
export type MsctContext = "m" | "e" | "i" | "p" | "w";

/** Type of payment instrument: SEPA Credit Transfer or SEPA Instant Credit Transfer. */
export type MsctInstrument = "SCT" | "INST";

/** Euvena profile v1 query parameter names for the EPC024-22 payload fields. */
export const DEFAULT_KEYS = {
  issuer: "iss",
  token: "tok",
  proxy: "prx",
  referencePartyProxy: "rpx",
  name: "nm",
  tradeName: "tn",
  referencePartyName: "rn",
  referencePartyTradeName: "rtn",
  iban: "iban",
  mcc: "mcc",
  instrument: "ins",
  purpose: "pur",
  referenceStructured: "rs",
  remittanceUnstructured: "ru",
  currency: "cur",
  amount: "amt",
  valueAddedServices: "vas",
} as const;

export type MsctKeys = { [K in keyof typeof DEFAULT_KEYS]: string };

const PROVIDER_ID_RE = /^[A-Za-z0-9]{3}$/;
const ISSUER_RE = /^[A-Za-z0-9]{3}$/;
const MCC_RE = /^\d{4}$/;
const CURRENCY_RE = /^[A-Za-z0-9]{1,3}$/;
const PURPOSE_RE = /^[A-Za-z0-9]{1,4}$/;

export interface MsctIssue {
  field: string;
  message: string;
}

export class MsctQrError extends Error {
  readonly issues: MsctIssue[];
  constructor(message: string, issues: MsctIssue[]) {
    super(message);
    this.name = "MsctQrError";
    this.issues = issues;
  }
}

interface CommonEncodeOptions {
  /** Domain of the MSCT interoperability framework or scheme, e.g. "qr.example.org". */
  domain: string;
  /** MSCT service provider ID (3 alphanumeric characters). */
  providerId: string;
  /** Payload issuer identifier (3 alphanumeric characters). */
  issuer: string;
  /** QR specification version, defaults to 1. */
  version?: number;
  /** Override the Euvena profile v1 parameter names. */
  keys?: Partial<MsctKeys>;
}

export interface PayeeTokenOptions extends CommonEncodeOptions {
  context: MsctContext;
  /** Payee token, 1..300 characters; de-tokenised by the payee's MSCT service provider. */
  token: string;
}

export interface PayeeTransactionFields {
  /** Merchant Category Code, mandatory for C2B. */
  mcc?: string;
  instrument: MsctInstrument;
  /** Purpose of the credit transfer, 1..4 characters. */
  purpose?: string;
  /** Structured remittance information, 1..35 characters (exclusive with `remittance`). */
  reference?: string;
  /** Unstructured remittance information, 1..35 characters (exclusive with `reference`). */
  remittance?: string;
  /** Currency, defaults to "EUR". */
  currency?: string;
  /** Transaction amount, number or pre-formatted numeric string. */
  amount: number | string;
}

export interface PayeeProxyOptions extends CommonEncodeOptions, PayeeTransactionFields {
  context: MsctContext;
  /** Proxy for the payee identification data, 1..70 characters. */
  proxy: string;
  /** Proxy for the payee reference party identification data, 1..70 characters. */
  referencePartyProxy?: string;
}

export interface PayeeClearOptions extends CommonEncodeOptions, PayeeTransactionFields {
  context: MsctContext;
  /** Name of the payee (account holder), 1..70 characters. */
  name: string;
  /** Trade name of the merchant, mandatory for C2B and B2B, 1..35 characters. */
  tradeName?: string;
  referencePartyName?: string;
  referencePartyTradeName?: string;
  iban: string;
}

export interface PayerTokenOptions extends CommonEncodeOptions {
  /**
   * Path segment for the type part, which EPC024-22 reserves for future use
   * in payer-presented codes. Defaults to "0".
   */
  context?: string;
  /** Payer token, 1..70 characters. */
  token: string;
  /** Additional clear-text data for value-added services, 1..70 characters. */
  valueAddedServices?: string;
}

/** Hostname per RFC 1123: dot-separated labels, no credentials, path, port or query. */
const HOSTNAME_RE =
  /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;

/** Query parameter names must be non-empty, unique, and URL-safe unreserved. */
const KEY_NAME_RE = /^[A-Za-z0-9._~-]+$/;

function mergeKeys(overrides?: Partial<MsctKeys>): MsctKeys {
  const keys = { ...DEFAULT_KEYS, ...overrides } as MsctKeys;
  const issues: MsctIssue[] = [];
  const seen = new Map<string, string>();
  for (const [field, name] of Object.entries(keys)) {
    if (typeof name !== "string" || !KEY_NAME_RE.test(name)) {
      issues.push({ field, message: `parameter name "${name}" must be non-empty and URL-safe` });
      continue;
    }
    const previous = seen.get(name);
    if (previous !== undefined) {
      // Two fields sharing a name would silently overwrite one another.
      issues.push({ field, message: `parameter name "${name}" is already used by "${previous}"` });
    } else {
      seen.set(name, field);
    }
  }
  if (issues.length > 0) throw new MsctQrError("invalid parameter name mapping", issues);
  return keys;
}

/** Payment contexts defined for payee-presented codes (EPC024-22 section 4.5). */
export const MSCT_CONTEXTS: readonly MsctContext[] = ["m", "e", "i", "p", "w"];

function baseUrl(domain: string, version: number, context: string, providerId: string): URL {
  // The domain must be a bare hostname. Interpolating anything else lets a
  // caller point the QR at another host entirely, for example by smuggling
  // credentials ("trusted.example@evil.example") or a path.
  if (!HOSTNAME_RE.test(domain)) {
    throw new MsctQrError("invalid domain", [
      {
        field: "domain",
        message: "must be a bare hostname, without credentials, port, path, query or fragment",
      },
    ]);
  }
  if (!PROVIDER_ID_RE.test(providerId)) {
    throw new MsctQrError("invalid MSCT service provider ID", [
      { field: "providerId", message: "must be exactly 3 alphanumeric characters" },
    ]);
  }
  if (version !== 1) {
    throw new MsctQrError("unsupported version", [
      { field: "version", message: "only QR-code specification version 1 is defined" },
    ]);
  }
  // TypeScript constrains the payee context, but JavaScript callers do not
  // get that check, and a stray path separator would restructure the URL.
  if (!/^[A-Za-z0-9]$/.test(context)) {
    throw new MsctQrError("invalid type segment", [
      { field: "context", message: "must be a single alphanumeric character" },
    ]);
  }
  return new URL(`https://${domain}/${version}/${context}/${providerId}/`);
}

function requirePayeeContext(context: string, issues: MsctIssue[]): void {
  if (!(MSCT_CONTEXTS as readonly string[]).includes(context)) {
    issues.push({ field: "context", message: `unknown payment context "${context}"` });
  }
}

function requireIssuer(issuer: string, issues: MsctIssue[]): void {
  if (!ISSUER_RE.test(issuer)) {
    issues.push({ field: "issuer", message: "payload issuer must be exactly 3 alphanumeric characters" });
  }
}

/** Rejects control characters in free-text payment data. */
function checkText(field: string, value: string | undefined, issues: MsctIssue[]): void {
  if (value !== undefined && hasControlChars(value)) {
    issues.push({
      field,
      message: `${field} must not contain control characters or invisible formatting`,
    });
  }
}

function applyTransactionFields(
  url: URL,
  keys: MsctKeys,
  fields: PayeeTransactionFields,
  issues: MsctIssue[],
): void {
  if (fields.mcc !== undefined) {
    if (!MCC_RE.test(fields.mcc)) issues.push({ field: "mcc", message: "MCC must be 4 digits" });
    url.searchParams.set(keys.mcc, fields.mcc);
  }
  if (fields.instrument !== "SCT" && fields.instrument !== "INST") {
    issues.push({ field: "instrument", message: 'instrument must be "SCT" or "INST"' });
  }
  url.searchParams.set(keys.instrument, fields.instrument);
  if (fields.purpose !== undefined) {
    if (!PURPOSE_RE.test(fields.purpose)) {
      issues.push({ field: "purpose", message: "purpose must be 1..4 alphanumeric characters" });
    }
    url.searchParams.set(keys.purpose, fields.purpose);
  }
  checkText("reference", fields.reference, issues);
  checkText("remittance", fields.remittance, issues);
  if (fields.reference !== undefined && fields.remittance !== undefined) {
    issues.push({ field: "reference", message: "structured and unstructured remittance are mutually exclusive" });
  }
  if (fields.reference !== undefined) {
    if (fields.reference.length < 1 || fields.reference.length > 35) {
      issues.push({ field: "reference", message: "structured remittance must be 1..35 characters" });
    } else if (/^RF/i.test(fields.reference) && !isValidRfReference(fields.reference)) {
      issues.push({ field: "reference", message: "invalid ISO 11649 creditor reference" });
    }
    url.searchParams.set(keys.referenceStructured, fields.reference);
  }
  if (fields.remittance !== undefined) {
    if (fields.remittance.length < 1 || fields.remittance.length > 35) {
      issues.push({ field: "remittance", message: "unstructured remittance must be 1..35 characters" });
    }
    url.searchParams.set(keys.remittanceUnstructured, fields.remittance);
  }
  const currency = fields.currency ?? "EUR";
  if (!CURRENCY_RE.test(currency)) {
    issues.push({ field: "currency", message: "currency must be 1..3 alphanumeric characters" });
  }
  url.searchParams.set(keys.currency, currency);
  const amount = formatAmount(fields.amount);
  url.searchParams.set(keys.amount, amount);
}

/** Encodes a payee-presented MSCT QR URL that carries a (payee) token. */
export function encodeMsctPayeeToken(options: PayeeTokenOptions): string {
  const keys = mergeKeys(options.keys);
  const issues: MsctIssue[] = [];
  requirePayeeContext(options.context, issues);
  requireIssuer(options.issuer, issues);
  checkText("token", options.token, issues);
  if (options.token.length < 1 || options.token.length > 300) {
    issues.push({ field: "token", message: "payee token must be 1..300 characters" });
  }
  if (issues.length > 0) throw new MsctQrError("invalid MSCT data", issues);

  const url = baseUrl(options.domain, options.version ?? 1, options.context, options.providerId);
  url.searchParams.set(keys.issuer, options.issuer);
  url.searchParams.set(keys.token, options.token);
  return url.toString();
}

/** Encodes a payee-presented MSCT QR URL that carries a proxy for the payee. */
export function encodeMsctPayeeProxy(options: PayeeProxyOptions): string {
  const keys = mergeKeys(options.keys);
  const issues: MsctIssue[] = [];
  requirePayeeContext(options.context, issues);
  requireIssuer(options.issuer, issues);
  checkText("proxy", options.proxy, issues);
  checkText("referencePartyProxy", options.referencePartyProxy, issues);
  if (options.proxy.length < 1 || options.proxy.length > 70) {
    issues.push({ field: "proxy", message: "proxy must be 1..70 characters" });
  }
  if (
    options.referencePartyProxy !== undefined &&
    (options.referencePartyProxy.length < 1 || options.referencePartyProxy.length > 70)
  ) {
    issues.push({ field: "referencePartyProxy", message: "reference party proxy must be 1..70 characters" });
  }

  const url = baseUrl(options.domain, options.version ?? 1, options.context, options.providerId);
  url.searchParams.set(keys.issuer, options.issuer);
  url.searchParams.set(keys.proxy, options.proxy);
  if (options.referencePartyProxy !== undefined) {
    url.searchParams.set(keys.referencePartyProxy, options.referencePartyProxy);
  }
  applyTransactionFields(url, keys, options, issues);
  if (issues.length > 0) throw new MsctQrError("invalid MSCT data", issues);
  return url.toString();
}

/** Encodes a payee-presented MSCT QR URL with all data "in clear". */
export function encodeMsctPayeeClear(options: PayeeClearOptions): string {
  const keys = mergeKeys(options.keys);
  const issues: MsctIssue[] = [];
  requirePayeeContext(options.context, issues);
  requireIssuer(options.issuer, issues);
  checkText("name", options.name, issues);
  checkText("tradeName", options.tradeName, issues);
  checkText("referencePartyName", options.referencePartyName, issues);
  checkText("referencePartyTradeName", options.referencePartyTradeName, issues);
  if (options.name.length < 1 || options.name.length > 70) {
    issues.push({ field: "name", message: "payee name must be 1..70 characters" });
  }
  if (options.tradeName !== undefined && (options.tradeName.length < 1 || options.tradeName.length > 35)) {
    issues.push({ field: "tradeName", message: "trade name must be 1..35 characters" });
  }
  if (
    options.referencePartyName !== undefined &&
    (options.referencePartyName.length < 1 || options.referencePartyName.length > 70)
  ) {
    issues.push({ field: "referencePartyName", message: "reference party name must be 1..70 characters" });
  }
  if (
    options.referencePartyTradeName !== undefined &&
    (options.referencePartyTradeName.length < 1 || options.referencePartyTradeName.length > 35)
  ) {
    issues.push({ field: "referencePartyTradeName", message: "reference party trade name must be 1..35 characters" });
  }
  const iban = normalizeIban(options.iban);
  if (!isValidIban(iban)) {
    issues.push({ field: "iban", message: `invalid IBAN "${options.iban}"` });
  }

  const url = baseUrl(options.domain, options.version ?? 1, options.context, options.providerId);
  url.searchParams.set(keys.issuer, options.issuer);
  url.searchParams.set(keys.name, options.name);
  if (options.tradeName !== undefined) url.searchParams.set(keys.tradeName, options.tradeName);
  if (options.referencePartyName !== undefined) {
    url.searchParams.set(keys.referencePartyName, options.referencePartyName);
  }
  if (options.referencePartyTradeName !== undefined) {
    url.searchParams.set(keys.referencePartyTradeName, options.referencePartyTradeName);
  }
  url.searchParams.set(keys.iban, iban);
  applyTransactionFields(url, keys, options, issues);
  if (issues.length > 0) throw new MsctQrError("invalid MSCT data", issues);
  return url.toString();
}

/** Encodes a payer-presented MSCT QR URL (token-based, per EPC024-22 table 9). */
export function encodeMsctPayerToken(options: PayerTokenOptions): string {
  const keys = mergeKeys(options.keys);
  const issues: MsctIssue[] = [];
  // The payer-presented type segment is reserved for future use, so it is not
  // constrained to the payee contexts; baseUrl still requires a single
  // alphanumeric character so the path cannot be restructured.
  requireIssuer(options.issuer, issues);
  checkText("token", options.token, issues);
  checkText("valueAddedServices", options.valueAddedServices, issues);
  if (options.token.length < 1 || options.token.length > 70) {
    issues.push({ field: "token", message: "payer token must be 1..70 characters" });
  }
  if (
    options.valueAddedServices !== undefined &&
    (options.valueAddedServices.length < 1 || options.valueAddedServices.length > 70)
  ) {
    issues.push({ field: "valueAddedServices", message: "value-added services data must be 1..70 characters" });
  }
  if (issues.length > 0) throw new MsctQrError("invalid MSCT data", issues);

  const url = baseUrl(options.domain, options.version ?? 1, options.context ?? "0", options.providerId);
  url.searchParams.set(keys.issuer, options.issuer);
  url.searchParams.set(keys.token, options.token);
  if (options.valueAddedServices !== undefined) {
    url.searchParams.set(keys.valueAddedServices, options.valueAddedServices);
  }
  return url.toString();
}

export interface MsctUrlParts {
  domain: string;
  version: number;
  /** Raw type path segment; one of MsctContext for payee-presented codes. */
  context: string;
  providerId: string;
  /** Raw query parameters, for issuers using a different naming profile. */
  params: URLSearchParams;
}

export type DecodedMsct =
  | ({ kind: "payee-token"; issuer: string; token: string } & MsctUrlParts)
  | ({
      kind: "payee-proxy";
      issuer: string;
      proxy: string;
      referencePartyProxy?: string;
    } & DecodedTransaction &
      MsctUrlParts)
  | ({
      kind: "payee-clear";
      issuer: string;
      name: string;
      tradeName?: string;
      referencePartyName?: string;
      referencePartyTradeName?: string;
      iban: string;
    } & DecodedTransaction &
      MsctUrlParts)
  | ({ kind: "payer-token"; issuer: string; token: string; valueAddedServices?: string } & MsctUrlParts);

interface DecodedTransaction {
  mcc?: string;
  instrument?: MsctInstrument;
  purpose?: string;
  reference?: string;
  remittance?: string;
  currency?: string;
  amount?: string;
}

export interface DecodeMsctOptions {
  /** Whether the code was presented by the payee (default) or the payer. */
  presenter?: "payee" | "payer";
  /** Override the Euvena profile v1 parameter names. */
  keys?: Partial<MsctKeys>;
  /** In strict mode (default) validation issues throw; lenient returns issues. */
  strict?: boolean;
}

export interface DecodeMsctResult {
  data: DecodedMsct;
  issues: MsctIssue[];
}

/**
 * Parses an MSCT QR URL. The payload profile (token, proxy, or all data
 * "in clear") is detected from the parameters present.
 *
 * @throws MsctQrError when the URL does not have the EPC024-22 structure,
 *         and on any validation issue when `strict` is true.
 */
export function decodeMsctQr(input: string, options: DecodeMsctOptions = {}): DecodeMsctResult {
  const keys = mergeKeys(options.keys);
  const strict = options.strict ?? true;
  const presenter = options.presenter ?? "payee";

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new MsctQrError("not a valid URL", [{ field: "url", message: "input is not a parseable URL" }]);
  }
  if (url.protocol !== "https:") {
    throw new MsctQrError("MSCT QR codes must use https", [{ field: "url", message: `unexpected protocol ${url.protocol}` }]);
  }
  if (url.port !== "") {
    // A non-default port is dropped from the reported `domain`, so accepting
    // it would misreport where the payload is served from.
    throw new MsctQrError("MSCT QR URLs must not specify a port", [
      { field: "url", message: `unexpected port ${url.port}` },
    ]);
  }
  if (!HOSTNAME_RE.test(url.hostname)) {
    throw new MsctQrError("invalid domain", [
      { field: "domain", message: `"${url.hostname}" is not a valid hostname` },
    ]);
  }
  if (url.hash !== "") {
    throw new MsctQrError("MSCT QR URLs must not carry a fragment", [
      { field: "url", message: "fragment is not part of the payload" },
    ]);
  }
  if (url.username !== "" || url.password !== "") {
    // Credentials in the authority are a spoofing device: the visible prefix
    // is not the host the payer's software would actually contact.
    throw new MsctQrError("MSCT QR URLs must not carry credentials", [
      { field: "url", message: "userinfo is not permitted in the URL authority" },
    ]);
  }
  const segments = url.pathname.split("/").filter((s) => s !== "");
  if (segments.length !== 3) {
    throw new MsctQrError("URL path must be /<version>/<type>/<provider ID>/", [
      { field: "url", message: `expected 3 path segments, got ${segments.length}` },
    ]);
  }
  const [versionSeg, context, providerId] = segments as [string, string, string];
  // Only the exact serialized form counts: "01" or " 1" are not version 1,
  // and a higher version must not be decoded with version 1 semantics.
  const version = /^[1-9][0-9]*$/.test(versionSeg) ? Number(versionSeg) : Number.NaN;

  const issues: MsctIssue[] = [];
  if (Number.isNaN(version)) {
    issues.push({ field: "version", message: `unrecognised version segment "${versionSeg}"` });
  } else if (version !== 1) {
    issues.push({
      field: "version",
      message: `unsupported QR-code specification version ${version}; only version 1 is defined`,
    });
  }
  if (!PROVIDER_ID_RE.test(providerId)) {
    issues.push({ field: "providerId", message: "MSCT service provider ID must be 3 alphanumeric characters" });
  }
  if (presenter === "payee" && !["m", "e", "i", "p", "w"].includes(context)) {
    issues.push({ field: "context", message: `unknown payment context "${context}"` });
  }

  const params = url.searchParams;
  const parts: MsctUrlParts = { domain: url.hostname, version, context, providerId, params };

  // A repeated recognized parameter is ambiguous: readers that take the first
  // value and readers that take the last would act on different payments.
  for (const [field, name] of Object.entries(keys)) {
    if (params.getAll(name).length > 1) {
      issues.push({ field, message: `parameter "${name}" appears more than once` });
    }
  }

  // Percent-encoding carries control characters through transport; they must
  // not reach payment data on the decode side either.
  for (const [field, name] of Object.entries(keys)) {
    for (const value of params.getAll(name)) {
      if (hasControlChars(value)) {
        issues.push({
          field,
          message: `${field} must not contain control characters or invisible formatting`,
        });
      }
    }
  }

  const issuer = params.get(keys.issuer) ?? "";
  if (!ISSUER_RE.test(issuer)) {
    issues.push({ field: "issuer", message: "payload issuer missing or not 3 alphanumeric characters" });
  }

  const readTransaction = (): DecodedTransaction => {
    const tx: DecodedTransaction = {};
    const mcc = params.get(keys.mcc);
    if (mcc !== null) {
      if (!MCC_RE.test(mcc)) issues.push({ field: "mcc", message: `MCC must be 4 digits, got "${mcc}"` });
      tx.mcc = mcc;
    }
    const ins = params.get(keys.instrument);
    if (ins !== null) {
      if (ins !== "SCT" && ins !== "INST") {
        issues.push({ field: "instrument", message: `instrument must be "SCT" or "INST", got "${ins}"` });
      } else {
        tx.instrument = ins;
      }
    } else {
      issues.push({ field: "instrument", message: "type of payment instrument is mandatory" });
    }
    const pur = params.get(keys.purpose);
    if (pur !== null) {
      if (!PURPOSE_RE.test(pur)) {
        issues.push({ field: "purpose", message: "purpose must be 1..4 alphanumeric characters" });
      }
      tx.purpose = pur;
    }
    const rs = params.get(keys.referenceStructured);
    const ru = params.get(keys.remittanceUnstructured);
    if (rs !== null && ru !== null) {
      issues.push({ field: "reference", message: "structured and unstructured remittance are mutually exclusive" });
    }
    if (rs !== null) {
      if (rs.length < 1 || rs.length > 35) {
        issues.push({ field: "reference", message: "structured remittance must be 1..35 characters" });
      } else if (/^RF/i.test(rs) && !isValidRfReference(rs)) {
        issues.push({ field: "reference", message: `invalid ISO 11649 creditor reference "${rs}"` });
      }
      tx.reference = rs;
    }
    if (ru !== null) {
      if (ru.length < 1 || ru.length > 35) {
        issues.push({ field: "remittance", message: "unstructured remittance must be 1..35 characters" });
      }
      tx.remittance = ru;
    }
    const cur = params.get(keys.currency);
    if (cur === null) {
      issues.push({ field: "currency", message: "currency is mandatory" });
    } else {
      if (!CURRENCY_RE.test(cur)) {
        issues.push({ field: "currency", message: `currency must be 1..3 alphanumeric characters, got "${cur}"` });
      }
      tx.currency = cur;
    }
    const amt = params.get(keys.amount);
    if (amt === null) {
      issues.push({ field: "amount", message: "transaction amount is mandatory" });
    } else {
      if (!isValidAmountString(amt)) issues.push({ field: "amount", message: `invalid amount "${amt}"` });
      tx.amount = amt;
    }
    return tx;
  };

  let data: DecodedMsct;
  const iban = params.get(keys.iban);
  const proxy = params.get(keys.proxy);
  const token = params.get(keys.token);

  // Each payload carries exactly one profile. More than one selector is
  // ambiguous, and resolving it by priority would silently discard whichever
  // payee data the reader did not pick.
  if (presenter === "payee") {
    const selectors = [
      iban !== null ? keys.iban : undefined,
      proxy !== null ? keys.proxy : undefined,
      token !== null ? keys.token : undefined,
    ].filter((s): s is string => s !== undefined);
    if (selectors.length > 1) {
      throw new MsctQrError("payload matches more than one profile", [
        { field: "payload", message: `conflicting profile selectors: ${selectors.join(", ")}` },
      ]);
    }
  }

  if (presenter === "payer") {
    if (token === null) {
      throw new MsctQrError("payer-presented code is missing its token", [
        { field: "token", message: "payer token is mandatory" },
      ]);
    }
    if (token.length < 1 || token.length > 70) {
      issues.push({ field: "token", message: "payer token must be 1..70 characters" });
    }
    const vas = params.get(keys.valueAddedServices);
    if (vas !== null && (vas.length < 1 || vas.length > 70)) {
      issues.push({ field: "valueAddedServices", message: "value-added services data must be 1..70 characters" });
    }
    data = {
      kind: "payer-token",
      issuer,
      token,
      ...(vas !== null ? { valueAddedServices: vas } : {}),
      ...parts,
    };
  } else if (iban !== null) {
    const name = params.get(keys.name) ?? "";
    if (name.length < 1 || name.length > 70) {
      issues.push({ field: "name", message: "payee name is mandatory, 1..70 characters" });
    }
    if (!isValidIban(iban)) issues.push({ field: "iban", message: `invalid IBAN "${iban}"` });
    const tn = params.get(keys.tradeName);
    if (tn !== null && (tn.length < 1 || tn.length > 35)) {
      issues.push({ field: "tradeName", message: "trade name must be 1..35 characters" });
    }
    const rn = params.get(keys.referencePartyName);
    if (rn !== null && (rn.length < 1 || rn.length > 70)) {
      issues.push({ field: "referencePartyName", message: "reference party name must be 1..70 characters" });
    }
    const rtn = params.get(keys.referencePartyTradeName);
    if (rtn !== null && (rtn.length < 1 || rtn.length > 35)) {
      issues.push({ field: "referencePartyTradeName", message: "reference party trade name must be 1..35 characters" });
    }
    data = {
      kind: "payee-clear",
      issuer,
      name,
      iban: normalizeIban(iban),
      ...(tn !== null ? { tradeName: tn } : {}),
      ...(rn !== null ? { referencePartyName: rn } : {}),
      ...(rtn !== null ? { referencePartyTradeName: rtn } : {}),
      ...readTransaction(),
      ...parts,
    };
  } else if (proxy !== null) {
    if (proxy.length < 1 || proxy.length > 70) {
      issues.push({ field: "proxy", message: "proxy must be 1..70 characters" });
    }
    const rpx = params.get(keys.referencePartyProxy);
    if (rpx !== null && (rpx.length < 1 || rpx.length > 70)) {
      issues.push({ field: "referencePartyProxy", message: "reference party proxy must be 1..70 characters" });
    }
    data = {
      kind: "payee-proxy",
      issuer,
      proxy,
      ...(rpx !== null ? { referencePartyProxy: rpx } : {}),
      ...readTransaction(),
      ...parts,
    };
  } else if (token !== null) {
    if (token.length < 1 || token.length > 300) {
      issues.push({ field: "token", message: "payee token must be 1..300 characters" });
    }
    data = { kind: "payee-token", issuer, token, ...parts };
  } else {
    throw new MsctQrError("payload matches no known profile", [
      { field: "payload", message: "expected a token, proxy, or clear-data payload" },
    ]);
  }

  if (strict && issues.length > 0) throw new MsctQrError("invalid MSCT QR payload", issues);
  return { data, issues };
}
