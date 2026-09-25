/**
 * Turns the request form into an EPC069-12 payload.
 *
 * Everything here is plain TypeScript so it can be exercised without a React
 * Native runtime. The screen owns the form state; this module owns the mapping
 * onto `@euvena/qr` and the validation messages the screen shows.
 */

import {
  EpcQrError,
  decodeEpcQr,
  isValidAmountString,
  type EpcQrData,
  type EpcQrIssue,
  encodeEpcQr,
} from "@euvena/qr";

import { formatMoney, type Dictionary } from "../i18n";

/**
 * EPC069-12 element 10 (structured creditor reference) and element 11
 * (unstructured remittance text) are mutually exclusive, so the form offers
 * one field and a choice of which element it fills.
 */
export type RemittanceKind = "reference" | "text";

/** Beneficiary details, held in local settings rather than in an account. */
export interface Payee {
  name: string;
  iban: string;
  /** Optional for EEA beneficiaries in version 002, which is what we emit. */
  bic: string;
}

export interface RequestForm {
  /** As typed, so "12,30" and " 12.30 " are both accepted. */
  amount: string;
  remittanceKind: RemittanceKind;
  remittance: string;
}

export type BuildRequestResult =
  | { ok: true; payload: string; data: EpcQrData }
  | { ok: false; issues: EpcQrIssue[] };

export const EMPTY_PAYEE: Payee = { name: "", iban: "", bic: "" };

export const EMPTY_FORM: RequestForm = { amount: "", remittanceKind: "text", remittance: "" };

export type PayeeField = keyof Payee;

/** One message per field that would keep the payee out of a payload. */
export type PayeeIssues = Partial<Record<PayeeField, string>>;

const PAYEE_FIELDS: ReadonlySet<string> = new Set<PayeeField>(["name", "iban", "bic"]);

/** Normalises typed payee fields the way the encoder will see them. */
export function normalizePayee(payee: Payee): Payee {
  return {
    name: payee.name.trim(),
    iban: payee.iban.replace(/\s+/g, "").toUpperCase(),
    bic: payee.bic.replace(/\s+/g, "").toUpperCase(),
  };
}

/**
 * Validates the payee against the encoder itself, run without an amount or
 * remittance so only the beneficiary elements are in play. The settings form
 * therefore rejects exactly what the request screen would fail on later,
 * including the conditional BIC of EPC069-12: optional for EEA accounts in
 * version 002, still mandatory for accounts in SEPA countries outside the EEA.
 *
 * Empty fields get a prompt rather than the encoder's wording, since an empty
 * form is a state and not a mistake. Messages that would echo the typed value
 * are replaced with a description of what the element must look like.
 */
export function validatePayee(payee: Payee, strings: Dictionary): PayeeIssues {
  const { name, iban, bic } = normalizePayee(payee);
  const issues: PayeeIssues = {};

  try {
    encodeEpcQr({ name, iban, ...(bic === "" ? {} : { bic }) });
  } catch (error) {
    if (!(error instanceof EpcQrError)) throw error;
    for (const issue of error.issues) {
      if (!PAYEE_FIELDS.has(issue.element)) continue;
      const field = issue.element as PayeeField;
      issues[field] ??= describePayeeIssue(field, { name, iban, bic }, strings);
    }
  }

  if (name === "") issues.name = strings.payeeIssues.enterName;
  if (iban === "") issues.iban = strings.payeeIssues.enterIban;
  return issues;
}

function describePayeeIssue(field: PayeeField, payee: Payee, strings: Dictionary): string {
  switch (field) {
    case "iban":
      return strings.payeeIssues.ibanChecks;
    case "bic":
      return payee.bic === "" ? strings.payeeIssues.bicRequired : strings.payeeIssues.bicShape;
    case "name":
      return strings.payeeIssues.nameShape;
  }
}

/**
 * Words an encoder issue for the user. The codec's own message can echo the
 * typed value, and it is English, so each element the form can fill gets
 * the wallet's description of what it must look like.
 */
function describeFormIssue(issue: EpcQrIssue, payee: Payee, strings: Dictionary): EpcQrIssue {
  const { element } = issue;
  if (element === "name" || element === "iban" || element === "bic") {
    return { element, message: describePayeeIssue(element, payee, strings) };
  }
  switch (element) {
    case "text":
      return { element, message: strings.payeeIssues.textShape };
    case "reference":
      return { element, message: strings.payeeIssues.referenceShape };
    case "amount":
      return { element, message: strings.payeeIssues.amountRange };
    case "payload":
      return { element, message: strings.payeeIssues.requestTooLong };
    default:
      return { element, message: strings.payeeIssues.unencodable };
  }
}

/**
 * Normalises a typed amount into the numeric string EPC069-12 expects.
 *
 * Accepts the decimal comma used across the euro area and strips the spaces
 * that come with copy-and-paste. Group separators are left alone: "1.234,56"
 * and "1,234.56" are ambiguous once both separators are in play, so they are
 * rejected as invalid rather than guessed at.
 */
export function normalizeAmountInput(input: string): string {
  const compact = input.replace(/[\s  ]/g, "");
  return compact.includes(",") && !compact.includes(".") ? compact.replace(",", ".") : compact;
}

/**
 * Builds the payload, then decodes it so the screen can display the values a
 * scanner will actually read rather than the values that were typed.
 *
 * An empty amount is not an error: EPC069-12 keeps element 8 optional so the
 * payer can enter the amount in their own banking app.
 */
export function buildPaymentRequest(
  payee: Payee,
  form: RequestForm,
  strings: Dictionary,
): BuildRequestResult {
  const issues: EpcQrIssue[] = [];

  // Same check the settings form runs, so a payee that saved will encode and a
  // payee that cannot encode is reported against its field, not against the code.
  const { name, iban, bic } = normalizePayee(payee);
  for (const [element, message] of Object.entries(validatePayee(payee, strings))) {
    issues.push({ element, message: `${message} ${strings.payeeIssues.inPayeeSettings}` });
  }

  // encodeEpcQr throws a RangeError on an unparseable amount before it reports
  // any other problem, so the amount is checked here and kept out of the call.
  const amount = normalizeAmountInput(form.amount);
  const hasAmount = amount !== "";
  if (hasAmount && !isValidAmountString(amount)) {
    issues.push({ element: "amount", message: strings.payeeIssues.amountRange });
  }

  const remittance = form.remittance.trim();
  if (issues.length > 0) return { ok: false, issues };

  let remittanceElement: { reference: string } | { text: string } | Record<string, never> = {};
  if (remittance !== "") {
    remittanceElement =
      form.remittanceKind === "reference" ? { reference: remittance } : { text: remittance };
  }

  try {
    const payload = encodeEpcQr({
      name,
      iban,
      ...(bic === "" ? {} : { bic }),
      ...(hasAmount ? { amount } : {}),
      ...remittanceElement,
    });
    return { ok: true, payload, data: decodeEpcQr(payload).data };
  } catch (error) {
    if (error instanceof EpcQrError) {
      const normalized = { name, iban, bic };
      return {
        ok: false,
        issues: error.issues.map((issue) => describeFormIssue(issue, normalized, strings)),
      };
    }
    throw error;
  }
}

export interface RequestRow {
  label: string;
  value: string;
}

/**
 * The decoded request as the labelled rows the guidelines recommend printing
 * beside the code, in an invoice-style presentation.
 *
 * Built from the decoded payload rather than from the form, so the rows on
 * screen and the rows in a shared message both say what a scanner reads.
 *
 * Every element the payload can carry has a row here. The wallet composes no
 * purpose or information element of its own, but the scan side reviews codes
 * from anywhere, and a review that drops elements is not a review.
 */
export function summarizeRequest(data: EpcQrData, strings: Dictionary, tag: string): RequestRow[] {
  const labels = strings.rows;
  const rows: RequestRow[] = [
    { label: labels.payee, value: data.name },
    { label: labels.iban, value: formatIbanForDisplay(data.iban) },
  ];
  if (data.bic !== undefined) rows.push({ label: labels.bic, value: data.bic });
  rows.push({
    label: labels.amount,
    value: data.amount === undefined ? labels.payerDecides : formatMoney(data.amount, tag),
  });
  if (data.purpose !== undefined) rows.push({ label: labels.purpose, value: data.purpose });
  if (data.reference !== undefined) rows.push({ label: labels.reference, value: data.reference });
  if (data.text !== undefined) rows.push({ label: labels.text, value: data.text });
  if (data.information !== undefined) {
    rows.push({ label: labels.information, value: data.information });
  }
  return rows;
}

/** Groups an IBAN into blocks of four, the presentation format of ISO 13616. */
export function formatIbanForDisplay(iban: string): string {
  return iban.replace(/(.{4})/g, "$1 ").trim();
}

