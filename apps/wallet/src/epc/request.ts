/**
 * Turns the request form into a payment code: an EPC069-12 payload, or the
 * URL of an EN 18184 code when a profile for one is set up.
 *
 * Everything here is plain TypeScript so it can be exercised without a React
 * Native runtime. The screen owns the form state; this module owns the mapping
 * onto `@euvena/qr` and the validation messages the screen shows.
 */

import {
  EpcQrError,
  MsctQrError,
  decodeEpcQr,
  isValidAmountString,
  type EpcQrData,
  type EpcQrIssue,
  type MsctInstrument,
  type MsctIssue,
  encodeEpcQr,
} from "@euvena/qr";

import { formatMoney, type Dictionary } from "../i18n";
import { encodePoiRequest, readPoiRequest, type PoiProfile, type PoiRequest } from "./poi";

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

/**
 * Which standard a code follows. EPC069-12 is what banking apps scan today;
 * EN 18184 is the point-of-interaction format, read by apps in an MSCT
 * interoperability framework.
 */
export type CodeFormat = "epc069" | "en18184";

export interface RequestForm {
  /** As typed, so "12,30" and " 12.30 " are both accepted. */
  amount: string;
  remittanceKind: RemittanceKind;
  remittance: string;
  /** Only followed while an EN 18184 profile is set up. */
  format: CodeFormat;
  /** Instant or standard transfer, which only an EN 18184 code can ask for. */
  instrument: MsctInstrument;
}

/**
 * A code and the values a scanner reads out of it. The payload is the text
 * the code carries: an EPC069-12 payload or an EN 18184 URL.
 */
export type PaymentCode =
  | { format: "epc069"; payload: string; data: EpcQrData }
  | { format: "en18184"; payload: string; data: PoiRequest };

export type BuildRequestResult = ({ ok: true } & PaymentCode) | { ok: false; issues: EpcQrIssue[] };

export const EMPTY_PAYEE: Payee = { name: "", iban: "", bic: "" };

export const EMPTY_FORM: RequestForm = {
  amount: "",
  remittanceKind: "text",
  remittance: "",
  format: "epc069",
  instrument: "INST",
};

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
 * An empty amount is not an error for EPC069-12, which keeps element 8
 * optional so the payer can enter the amount in their own banking app. An
 * EN 18184 code has no open amount, so there it is one.
 *
 * The EN 18184 format is followed only with a profile to build it from; the
 * screen offers it only then.
 */
export function buildPaymentRequest(
  payee: Payee,
  form: RequestForm,
  strings: Dictionary,
  profile: PoiProfile | null = null,
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
  const poi = form.format === "en18184";
  if (hasAmount && !isValidAmountString(amount)) {
    issues.push({ element: "amount", message: strings.payeeIssues.amountRange });
  } else if (poi && !hasAmount) {
    issues.push({ element: "amount", message: strings.payeeIssues.amountRequired });
  }
  if (poi && profile === null) {
    issues.push({ element: "routing", message: strings.payeeIssues.poiProfile });
  }

  const remittance = form.remittance.trim();
  if (issues.length > 0) return { ok: false, issues };

  if (poi && profile !== null) {
    return buildPoiCode(profile, { name, iban, bic }, amount, form, remittance, strings);
  }

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
    return { ok: true, format: "epc069", payload, data: decodeEpcQr(payload).data };
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

/**
 * The EN 18184 side of buildPaymentRequest, called once the payee and the
 * amount have passed. A BIC is not carried: EPC024-22 has no element for it.
 */
function buildPoiCode(
  profile: PoiProfile,
  payee: Payee,
  amount: string,
  form: RequestForm,
  remittance: string,
  strings: Dictionary,
): BuildRequestResult {
  const reference = form.remittanceKind === "reference";
  let url: string;
  try {
    url = encodePoiRequest(profile, {
      name: payee.name,
      iban: payee.iban,
      amount,
      instrument: form.instrument,
      ...(remittance === "" ? {} : reference ? { reference: remittance } : { text: remittance }),
    });
  } catch (error) {
    if (error instanceof MsctQrError) {
      return {
        ok: false,
        issues: error.issues.map((issue) => describePoiIssue(issue, payee, strings)),
      };
    }
    throw error;
  }
  // Read back as a scanned code is read, so the screen shows what a scanner
  // takes out of the URL. A URL the encoder built always reads back.
  const read = readPoiRequest(url);
  if (!read.ok) {
    return { ok: false, issues: [{ element: "payload", message: strings.payeeIssues.unencodable }] };
  }
  return { ok: true, format: "en18184", payload: url, data: read.data };
}

/**
 * Words an EN 18184 encoder issue, as describeFormIssue does for EPC069-12.
 * Issues are reported against the element names of the form, so the
 * unstructured remittance is "text" here too.
 */
function describePoiIssue(issue: MsctIssue, payee: Payee, strings: Dictionary): EpcQrIssue {
  switch (issue.field) {
    case "name":
    case "iban":
      return { element: issue.field, message: describePayeeIssue(issue.field, payee, strings) };
    case "amount":
      return { element: "amount", message: strings.payeeIssues.amountRange };
    case "remittance":
      return { element: "text", message: strings.payeeIssues.poiTextShape };
    case "reference":
      return { element: "reference", message: strings.payeeIssues.poiReferenceShape };
    case "domain":
    case "providerId":
    case "issuer":
    case "context":
      return { element: "routing", message: strings.payeeIssues.poiProfile };
    default:
      return { element: issue.field, message: strings.payeeIssues.unencodable };
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
export function summarizeRequest(code: PaymentCode, strings: Dictionary, tag: string): RequestRow[] {
  return code.format === "epc069"
    ? summarizeEpcRequest(code.data, strings, tag)
    : summarizePoiRequest(code.data, strings, tag);
}

function summarizeEpcRequest(data: EpcQrData, strings: Dictionary, tag: string): RequestRow[] {
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

/**
 * The rows of an EN 18184 code. Beside what an EPC069-12 code carries, it
 * names the kind of transfer the payee asks for, who the payee trades as or
 * collects for, and where the URL points: the framework and the provider are
 * what a phone camera would open, so they are part of what the payer checks.
 */
function summarizePoiRequest(data: PoiRequest, strings: Dictionary, tag: string): RequestRow[] {
  const labels = strings.rows;
  const rows: RequestRow[] = [{ label: labels.payee, value: data.name }];
  if (data.tradeName !== undefined) rows.push({ label: labels.tradeName, value: data.tradeName });
  if (data.referencePartyName !== undefined) {
    rows.push({ label: labels.onBehalfOf, value: data.referencePartyName });
  }
  if (data.referencePartyTradeName !== undefined) {
    rows.push({ label: labels.onBehalfOfTrade, value: data.referencePartyTradeName });
  }
  rows.push(
    { label: labels.iban, value: formatIbanForDisplay(data.iban) },
    { label: labels.amount, value: formatMoney(data.amount, tag) },
    {
      label: labels.transfer,
      value: data.instrument === "INST" ? labels.instant : labels.standard,
    },
  );
  if (data.purpose !== undefined) rows.push({ label: labels.purpose, value: data.purpose });
  if (data.reference !== undefined) rows.push({ label: labels.reference, value: data.reference });
  if (data.text !== undefined) rows.push({ label: labels.text, value: data.text });
  if (data.mcc !== undefined) rows.push({ label: labels.category, value: data.mcc });
  rows.push(
    { label: labels.context, value: labels.contexts[data.context] },
    { label: labels.framework, value: data.domain },
    { label: labels.provider, value: data.providerId },
    { label: labels.issuer, value: data.issuer },
  );
  return rows;
}

/** Groups an IBAN into blocks of four, the presentation format of ISO 13616. */
export function formatIbanForDisplay(iban: string): string {
  return iban.replace(/(.{4})/g, "$1 ").trim();
}

