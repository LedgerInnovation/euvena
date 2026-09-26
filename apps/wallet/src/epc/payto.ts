/**
 * The payto handoff: the URI the "Open your banking app" action fires, and
 * the payto links a payer pastes or opens.
 *
 * Both directions follow the Euvena payto handoff profile
 * (docs/payto-handoff.md), implemented by the codec's encodePaytoUri and
 * decodePaytoUri. There is no EU-wide scheme for opening a banking app with a
 * credit transfer prefilled; apps that accept payto URIs, such as the GNU
 * Taler wallet, can take this one, and everything it carries comes from the
 * decoded payload, so the handoff cannot say anything the review did not
 * show.
 *
 * A structured creditor reference has no payto option and is left out. It
 * stays in the review and in the copy fields, and the screen says so above
 * the handoff action. A purpose code likewise stays visible in the review
 * only.
 */

import {
  PaytoError,
  decodePaytoUri,
  encodePaytoUri,
  type EncodeEpcQrOptions,
  type PaytoErrorCode,
} from "@euvena/qr";

import { elementKeys, type Rejection } from "../i18n";

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

/**
 * The payto URI for a reviewed request, or null when the profile cannot
 * carry it. That happens for an EN 18184 code to an account in a non-EEA
 * SEPA country: EPC024-22 has no BIC element, and a transfer there needs
 * one, so the payer copies the fields instead.
 */
export function buildPaytoUri(data: TransferDetails): string | null {
  try {
    return encodePaytoUri(data, { omitReference: true });
  } catch (error) {
    if (error instanceof PaytoError) return null;
    throw error;
  }
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
  { ok: true; request: EncodeEpcQrOptions } | { ok: false; reason: Rejection };

const REJECTIONS: Record<Exclude<PaytoErrorCode, "invalid">, Rejection["code"]> = {
  "not-payto": "paytoNot",
  "not-iban": "paytoNotIban",
  malformed: "paytoMalformed",
  damaged: "paytoDamaged",
  "repeated-option": "paytoRepeatedOption",
  instruction: "paytoInstruction",
  "unknown-option": "paytoUnknownOption",
  "no-name": "paytoNoName",
  amount: "paytoBadAmount",
  currency: "paytoNotEuro",
};

/**
 * Reads a `payto://iban` URI into the fields of an EPC069-12 request, which
 * the caller encodes and decodes in strict mode like any other input. The
 * codec's reasons become fixed sentences in the user's language that name
 * the failed elements and never repeat the input.
 */
export function parsePaytoUri(uri: string): ParsedPaytoUri {
  try {
    return { ok: true, request: decodePaytoUri(uri) };
  } catch (error) {
    if (!(error instanceof PaytoError)) throw error;
    if (error.code === "invalid") {
      return {
        ok: false,
        reason: {
          code: "paytoInvalid",
          elements: elementKeys(error.issues.map((issue) => issue.element)),
        },
      };
    }
    return { ok: false, reason: { code: REJECTIONS[error.code] } };
  }
}
