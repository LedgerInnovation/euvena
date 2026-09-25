/**
 * Payment requests in the point-of-interaction format of EN 18184:2025, the
 * standard published from EPC024-22: an https URL instead of the line-based
 * EPC069-12 payload.
 *
 * The URL names an MSCT interoperability framework by its domain, the payee's
 * MSCT service provider by a 3-character ID the framework issues, and the
 * payload issuer by another. None of the three can be invented, so the wallet
 * only builds these codes from a profile the user enters in the settings, and
 * builds none while there is no profile.
 *
 * Of the three payee-presented payload profiles, only the one with all data in
 * clear names the account to be paid. A token or a proxy stands for data that
 * only the payee's service provider can resolve, over its own network, so the
 * wallet refuses those codes rather than opening their address: it reads
 * everything on the device and contacts nobody.
 *
 * As on the EPC069-12 side, rejection reasons name what failed and never quote
 * the codec, whose messages can repeat the value they rejected.
 */

import {
  MsctQrError,
  decodeMsctQr,
  encodeMsctPayeeClear,
  encodeMsctPayeeToken,
  formatAmount,
  type MsctContext,
  type MsctInstrument,
  type MsctIssue,
} from "@euvena/qr";

import { type ElementKey, type Rejection } from "../i18n";

/** What a framework issues to take part: where codes point and who issues them. */
export interface PoiProfile {
  /** Domain of the MSCT interoperability framework or scheme, a bare host name. */
  domain: string;
  /** The payee's MSCT service provider ID, 3 alphanumeric characters. */
  providerId: string;
  /** The payload issuer ID, 3 alphanumeric characters. */
  issuer: string;
}

export type PoiProfileField = keyof PoiProfile;

export const EMPTY_POI_PROFILE: PoiProfile = {
  domain: "",
  providerId: "",
  issuer: "",
};

/**
 * The payment context the wallet puts in its codes: person to person. A
 * request built here is one person asking another to pay; the merchant
 * contexts make a trade name and a merchant category mandatory, which a
 * wallet payee does not have.
 */
export const POI_CONTEXT: MsctContext = "p";

/** The only currency a SEPA credit transfer is made in. */
const EURO = "EUR";

/** What an EN 18184 code with all data in clear says, as a scanner reads it. */
export interface PoiRequest {
  domain: string;
  providerId: string;
  context: MsctContext;
  issuer: string;
  /** The payee as account holder. */
  name: string;
  /** The merchant's trade name, mandatory for merchants. */
  tradeName?: string;
  /** Who the payee collects for, when that is someone else. */
  referencePartyName?: string;
  referencePartyTradeName?: string;
  iban: string;
  /** Merchant category code, 4 digits. */
  mcc?: string;
  /** Whether the payee asks for an instant or a standard transfer. */
  instrument: MsctInstrument;
  purpose?: string;
  /** Structured remittance information. */
  reference?: string;
  /** Unstructured remittance information, named as the EPC069-12 side names it. */
  text?: string;
  /** Euro, always present: EN 18184 has no open amount. */
  amount: string;
}

export type ReadPoiResult =
  { ok: true; payload: string; data: PoiRequest } | { ok: false; reason: Rejection };

/** Trims the profile the way it is stored. Host names do not depend on case. */
export function normalizePoiProfile(profile: PoiProfile): PoiProfile {
  return {
    domain: profile.domain.trim().toLowerCase(),
    providerId: profile.providerId.trim(),
    issuer: profile.issuer.trim(),
  };
}

/** Values the codec accepts, so each field is checked on its own. */
const PROBE: PoiProfile = {
  domain: "example.org",
  providerId: "AAA",
  issuer: "AAA",
};

const PROFILE_FIELDS: readonly PoiProfileField[] = ["domain", "providerId", "issuer"];

/**
 * The profile fields the encoder refuses, in form order.
 *
 * The encoder is the judge, as validatePayee makes it for the payee, so a
 * profile that saves always builds. It stops at the first field it faults, so
 * each field is tried beside values it is known to accept.
 */
export function poiProfileIssues(profile: PoiProfile): PoiProfileField[] {
  const normalized = normalizePoiProfile(profile);
  return PROFILE_FIELDS.filter((field) => !encodes({ ...PROBE, [field]: normalized[field] }));
}

function encodes(profile: PoiProfile): boolean {
  try {
    encodeMsctPayeeToken({ ...profile, context: POI_CONTEXT, token: "x" });
    return true;
  } catch (error) {
    if (error instanceof MsctQrError) return false;
    throw error;
  }
}

export interface PoiRequestFields {
  name: string;
  iban: string;
  /** A valid amount string, which EN 18184 requires. */
  amount: string;
  instrument: MsctInstrument;
  reference?: string;
  text?: string;
}

/**
 * Builds the URL of a request. The payee and remittance map onto the profile
 * with all data in clear; the unstructured text is what EPC024-22 calls the
 * unstructured remittance information.
 *
 * @throws MsctQrError on any field the codec refuses.
 */
export function encodePoiRequest(profile: PoiProfile, fields: PoiRequestFields): string {
  return encodeMsctPayeeClear({
    ...normalizePoiProfile(profile),
    context: POI_CONTEXT,
    name: fields.name,
    iban: fields.iban,
    instrument: fields.instrument,
    currency: EURO,
    amount: fields.amount,
    ...(fields.reference === undefined ? {} : { reference: fields.reference }),
    ...(fields.text === undefined ? {} : { remittance: fields.text }),
  });
}

/**
 * Reads an https URL as an EN 18184 payee-presented code.
 *
 * Anything that is not shaped like one is a web address and is refused as
 * such; nothing is fetched to find out more. The codec runs leniently only to
 * learn which fields failed: any issue still refuses the whole code, as
 * strict mode would.
 */
export function readPoiRequest(input: string): ReadPoiResult {
  let decoded: ReturnType<typeof decodeMsctQr>;
  try {
    decoded = decodeMsctQr(input, { presenter: "payee", strict: false });
  } catch (error) {
    if (error instanceof MsctQrError) return { ok: false, reason: { code: "poiNot" } };
    throw error;
  }

  const { data, issues } = decoded;
  if (issues.length > 0) {
    return {
      ok: false,
      reason: { code: "poiInvalid", elements: poiElementKeys(issues) },
    };
  }
  if (data.kind === "payee-token" || data.kind === "payee-proxy") {
    return { ok: false, reason: { code: "poiNeedsProvider" } };
  }
  if (data.kind !== "payee-clear") return { ok: false, reason: { code: "poiNot" } };
  // A lenient decode reports a missing instrument or amount as an issue, so
  // these are present here; the checks keep the types honest.
  if (data.instrument === undefined || data.amount === undefined) {
    return { ok: false, reason: { code: "poiInvalid", elements: [] } };
  }
  // The codec accepts any currency code, in either case. SEPA transfers are
  // made in euro, and the handoff builds a euro amount, so anything else
  // stops here.
  if (data.currency?.toUpperCase() !== EURO) {
    return { ok: false, reason: { code: "poiNotEuro" } };
  }

  const request: PoiRequest = {
    domain: data.domain,
    providerId: data.providerId,
    // Checked against the payee contexts by the codec, which reported no issue.
    context: data.context as MsctContext,
    issuer: data.issuer,
    name: data.name,
    iban: data.iban,
    instrument: data.instrument,
    // The same number in the codec's canonical form, as the EPC069-12 side
    // carries it, so "01.00" is copied and handed off as "1".
    amount: formatAmount(Number(data.amount)),
    ...(data.tradeName === undefined ? {} : { tradeName: data.tradeName }),
    ...(data.referencePartyName === undefined
      ? {}
      : { referencePartyName: data.referencePartyName }),
    ...(data.referencePartyTradeName === undefined
      ? {}
      : { referencePartyTradeName: data.referencePartyTradeName }),
    ...(data.mcc === undefined ? {} : { mcc: data.mcc }),
    ...(data.purpose === undefined ? {} : { purpose: data.purpose }),
    ...(data.reference === undefined ? {} : { reference: data.reference }),
    ...(data.remittance === undefined ? {} : { text: data.remittance }),
  };
  return { ok: true, payload: input, data: request };
}

/** The codec's EN 18184 field names, as the elements the wallet names. */
const POI_ELEMENT_KEYS: ReadonlyMap<string, ElementKey> = new Map(
  Object.entries({
    version: "version",
    domain: "routing",
    providerId: "routing",
    context: "routing",
    issuer: "routing",
    name: "name",
    tradeName: "tradeName",
    referencePartyName: "referenceParty",
    referencePartyTradeName: "referenceParty",
    referencePartyProxy: "referenceParty",
    iban: "iban",
    mcc: "category",
    instrument: "instrument",
    purpose: "purpose",
    reference: "reference",
    remittance: "text",
    // The same two fields, as the codec names them when it checks the
    // parameters themselves, such as one given twice.
    referenceStructured: "reference",
    remittanceUnstructured: "text",
    currency: "currency",
    amount: "amount",
    payload: "payload",
  } satisfies Record<string, ElementKey>),
);

/** The distinct elements the issues name, in order. Unknown fields read as "other". */
export function poiElementKeys(issues: readonly MsctIssue[]): ElementKey[] {
  const keys: ElementKey[] = [];
  for (const issue of issues) {
    const key = POI_ELEMENT_KEYS.get(issue.field) ?? "other";
    if (!keys.includes(key)) keys.push(key);
  }
  return keys;
}
