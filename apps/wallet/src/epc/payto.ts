/**
 * Builds the handoff URI for a reviewed payment request.
 *
 * The URI is a payto URI (RFC 8905), the one open standard for naming a
 * payment target. There is no EU-wide scheme for opening a banking app with a
 * credit transfer prefilled; apps that do accept payto URIs, such as the GNU
 * Taler wallet, can take this one, and everything it carries comes from the
 * decoded payload, so the handoff cannot say anything the review did not show.
 *
 * The mapping from EPC069-12: the IBAN becomes the authority path, with the
 * BIC ahead of it when the payload carries one (RFC 8905 section 7.3), the
 * amount becomes `amount=EUR:<value>` with the codec's canonical value, the
 * beneficiary name becomes `receiver-name` and the unstructured text becomes
 * `message`, which section 7.3 defines as the unstructured remittance
 * information of a SEPA credit transfer.
 *
 * A structured creditor reference is NOT emitted. It has no interoperable
 * payto mapping: `message` would silently downgrade it to unstructured text
 * and `instruction` is the SEPA end-to-end identifier, a different field. A
 * receiving app would submit the downgraded form and the creditor's
 * reconciliation could miss it. The reference stays in the review and in the
 * copy fields, and the screen says so beside the handoff action. A purpose
 * code likewise has no generic option and stays visible in the review only.
 */

import { isValidAmountString, type EncodeEpcQrOptions } from "@euvena/qr";

import { type Rejection } from "../i18n";

/** URI scheme of RFC 8905 payment target URIs. */
export const PAYTO_SCHEME = "payto";

/** The only payment target type the wallet reads: a SEPA account by IBAN. */
const IBAN_TARGET = "iban";

/**
 * What a handoff carries, which a code of either format can say. The amount
 * is in euro: both readers refuse any other currency.
 */
export interface TransferDetails {
  name: string;
  iban: string;
  bic?: string | undefined;
  amount?: string | undefined;
  reference?: string | undefined;
  text?: string | undefined;
}

export function buildPaytoUri(data: TransferDetails): string {
  const path =
    data.bic === undefined
      ? encodeURIComponent(data.iban)
      : `${encodeURIComponent(data.bic)}/${encodeURIComponent(data.iban)}`;

  const options: [string, string][] = [];
  if (data.amount !== undefined) options.push(["amount", `EUR:${data.amount}`]);
  options.push(["receiver-name", data.name]);
  if (data.text !== undefined) options.push(["message", data.text]);

  const query = options
    .map(([name, value]) => `${name}=${encodeOptionValue(value)}`)
    .join("&");
  return `payto://iban/${path}?${query}`;
}

/**
 * Percent encodes an option value, keeping ":" literal: a colon is valid in a
 * query (RFC 3986 pchar) and the RFC 8905 amount examples carry it bare, so
 * the plain form is what existing payto parsers are known to read.
 */
function encodeOptionValue(value: string): string {
  return encodeURIComponent(value).replace(/%3A/gi, ":");
}

export interface HandoffField {
  /** Which row this is; the screen names it in the user's language. */
  key: "payee" | "iban" | "bic" | "amount" | "reference" | "text";
  /** The raw value a bank form expects, not the display presentation. */
  value: string;
}

/**
 * The fields a payer copies into a transfer form, one at a time, when no
 * installed app takes the URI. Values are the raw decoded ones: the IBAN
 * without display grouping and the amount as the codec's canonical string,
 * because bank forms are filled field by field and reject decoration.
 */
export function handoffFields(data: TransferDetails): HandoffField[] {
  const fields: HandoffField[] = [
    { key: "payee", value: data.name },
    { key: "iban", value: data.iban },
  ];
  if (data.bic !== undefined) fields.push({ key: "bic", value: data.bic });
  if (data.amount !== undefined) fields.push({ key: "amount", value: data.amount });
  if (data.reference !== undefined) fields.push({ key: "reference", value: data.reference });
  if (data.text !== undefined) fields.push({ key: "text", value: data.text });
  return fields;
}

export type ParsedPaytoUri =
  | { ok: true; request: EncodeEpcQrOptions }
  | { ok: false; reason: Rejection };

const MALFORMED: Rejection = { code: "paytoMalformed" };
const DAMAGED: Rejection = { code: "paytoDamaged" };

/**
 * Reads an RFC 8905 `payto://iban` URI into the fields of an EPC069-12
 * request, which the caller encodes and decodes in strict mode like any other
 * input. Only the URI's own structure is checked here; the codec judges the
 * values.
 *
 * Every option lands in an element the review shows or makes the link fail,
 * except three that describe the parties rather than the payment, which are
 * ignored.
 * - `receiver-name` is the beneficiary name, which EPC069-12 requires
 * - `amount` must be in euro, at most once (RFC 8905 section 5). Digits past
 *   the cent must be zeros. Commas are refused although the RFC says to
 *   ignore them: a producer writing a decimal comma would otherwise have
 *   "12,50" paid as 1250
 * - `message` is the unstructured remittance text (section 7.3)
 * - `instruction` is the end-to-end identifier, which neither a code nor the
 *   handoff can carry. Section 6 says to refuse rather than lose it
 * - `sender-name` names the payer, who is the one reading, so it is ignored.
 *   So are `receiver-postal-code` and `receiver-town`, the creditor address
 *   the GNU Taler wallets add, which neither a code nor a transfer form takes
 *   and which does not change where the money goes
 * - anything else is refused, as is any option given twice. That includes
 *   `ch-qrr` (a Swiss structured reference) and a `bic` option that would
 *   compete with the path
 *
 * Option names are matched exactly, although RFC 5234 makes the RFC's quoted
 * names case-insensitive. The GNU Taler wallet matches them exactly, so
 * "AMOUNT" is an option that reader skips: honouring it here would have the
 * two wallets pay different sums. A raw "+" in a value is read as a space, as
 * the GNU Taler wallet reads it and as the PHP and Python query builders that
 * invoicing backends use write one. A literal plus has to arrive as "%2B",
 * which is what buildPaytoUri emits; a producer that leaves it raw loses it.
 * One trailing slash after the account is accepted, since Taler exchanges
 * publish their accounts that way. Reasons are fixed sentences that never
 * repeat the input.
 */
export function parsePaytoUri(uri: string): ParsedPaytoUri {
  const prefix = `${PAYTO_SCHEME}://`;
  if (uri.slice(0, prefix.length).toLowerCase() !== prefix) {
    return { ok: false, reason: { code: "paytoNot" } };
  }
  // RFC 8905 has no fragment. A stray one must not ride into a value.
  if (uri.includes("#")) return { ok: false, reason: MALFORMED };

  const rest = uri.slice(prefix.length);
  const queryStart = rest.indexOf("?");
  const hierarchy = queryStart === -1 ? rest : rest.slice(0, queryStart);
  const query = queryStart === -1 ? undefined : rest.slice(queryStart + 1);

  // The authority is the target type alone. Userinfo or a port leaves
  // something other than "iban" here and is refused with it.
  const [target, ...segments] = hierarchy.split("/");
  if (target === undefined || target.toLowerCase() !== IBAN_TARGET) {
    return { ok: false, reason: { code: "paytoNotIban" } };
  }
  if (segments.length > 1 && segments[segments.length - 1] === "") segments.pop();
  // Section 7.3: the path is the IBAN, or the BIC followed by the IBAN.
  if (segments.length < 1 || segments.length > 2) {
    return { ok: false, reason: MALFORMED };
  }

  const options = new Map<string, string>();
  if (query !== undefined) {
    for (const pair of query.split("&")) {
      const separator = pair.indexOf("=");
      if (separator < 1) return { ok: false, reason: MALFORMED };
      const name = pair.slice(0, separator);
      if (options.has(name)) return { ok: false, reason: { code: "paytoRepeatedOption" } };
      options.set(name, pair.slice(separator + 1));
    }
  }

  let decoded: { segments: string[]; options: Map<string, string> };
  try {
    decoded = {
      segments: segments.map((segment) => decodeURIComponent(segment)),
      options: new Map(
        [...options].map(([name, value]) => [name, decodeURIComponent(value.replace(/\+/g, " "))]),
      ),
    };
  } catch {
    // decodeURIComponent throws a URIError on a truncated or malformed escape.
    return { ok: false, reason: DAMAGED };
  }

  // Account identifiers are plain letters and digits in their electronic form.
  // The encoder would quietly strip whitespace, including an escaped line
  // break, so anything else is refused here instead.
  if (!decoded.segments.every((segment) => /^[A-Za-z0-9]+$/.test(segment))) {
    return { ok: false, reason: MALFORMED };
  }

  for (const name of decoded.options.keys()) {
    if (name === "instruction") {
      return {
        ok: false,
        reason: { code: "paytoInstruction" },
      };
    }
    if (!READ_OPTIONS.has(name) && !IGNORED_OPTIONS.has(name)) {
      return { ok: false, reason: { code: "paytoUnknownOption" } };
    }
  }

  const name = decoded.options.get("receiver-name") ?? "";
  if (name === "") return { ok: false, reason: { code: "paytoNoName" } };

  const bic = decoded.segments.length === 2 ? decoded.segments[0] : undefined;
  const iban = decoded.segments[decoded.segments.length - 1] ?? "";
  const request: EncodeEpcQrOptions = { name, iban };
  if (bic !== undefined) request.bic = bic;

  const amount = decoded.options.get("amount");
  if (amount !== undefined) {
    const parsed = readPaytoAmount(amount);
    if (!parsed.ok) return parsed;
    request.amount = parsed.value;
  }

  const message = decoded.options.get("message") ?? "";
  if (message !== "") request.text = message;

  return { ok: true, request };
}

const READ_OPTIONS = new Set(["amount", "receiver-name", "message"]);
const IGNORED_OPTIONS = new Set(["sender-name", "receiver-postal-code", "receiver-town"]);

/**
 * `currency ":" unit [ "." fraction ]` (RFC 8905 section 5) as the numeric
 * string EPC069-12 carries after "EUR". Commas are refused rather than
 * ignored, since a decimal comma read that way changes the sum. The
 * fraction may run to eight digits, but a SEPA amount stops at the cent, so
 * anything past it must be zeros: rounding would change what is paid.
 */
function readPaytoAmount(value: string): { ok: true; value: string } | { ok: false; reason: Rejection } {
  const unusable = { ok: false, reason: { code: "paytoBadAmount" } } as const;

  const separator = value.indexOf(":");
  if (separator === -1) return unusable;
  if (value.slice(0, separator).toUpperCase() !== "EUR") {
    return { ok: false, reason: { code: "paytoNotEuro" } };
  }

  // Digits only on both sides of the point, so a comma never gets through.
  const number = value.slice(separator + 1);
  const point = number.indexOf(".");
  const unit = point === -1 ? number : number.slice(0, point);
  const fraction = point === -1 ? undefined : number.slice(point + 1);
  if (!/^\d+$/.test(unit)) return unusable;
  if (fraction !== undefined && !/^\d{1,8}$/.test(fraction)) return unusable;
  if (fraction !== undefined && !/^0*$/.test(fraction.slice(2))) return unusable;

  const cents = fraction?.slice(0, 2);
  const canonical = `${unit.replace(/^0+(?=\d)/, "")}${cents === undefined ? "" : `.${cents}`}`;
  if (!isValidAmountString(canonical)) return unusable;
  return { ok: true, value: canonical };
}
