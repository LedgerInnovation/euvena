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
 * beneficiary name becomes `receiver-name` and the remittance element becomes
 * `message`, whichever of the two mutually exclusive forms it took. A purpose
 * code has no generic payto option and is dropped from the URI; it stays
 * visible in the review.
 */

import { type EpcQrData } from "@eupi/qr";

export function buildPaytoUri(data: EpcQrData): string {
  const path =
    data.bic === undefined
      ? encodeURIComponent(data.iban)
      : `${encodeURIComponent(data.bic)}/${encodeURIComponent(data.iban)}`;

  const options: [string, string][] = [];
  if (data.amount !== undefined) options.push(["amount", `EUR:${data.amount}`]);
  options.push(["receiver-name", data.name]);
  const message = data.reference ?? data.text;
  if (message !== undefined) options.push(["message", message]);

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
  label: string;
  /** The raw value a bank form expects, not the display presentation. */
  value: string;
}

/**
 * The fields a payer copies into a transfer form, one at a time, when no
 * installed app takes the URI. Values are the raw decoded ones: the IBAN
 * without display grouping and the amount as the codec's canonical string,
 * because bank forms are filled field by field and reject decoration.
 */
export function handoffFields(data: EpcQrData): HandoffField[] {
  const fields: HandoffField[] = [
    { label: "Name", value: data.name },
    { label: "IBAN", value: data.iban },
  ];
  if (data.bic !== undefined) fields.push({ label: "BIC", value: data.bic });
  if (data.amount !== undefined) fields.push({ label: "Amount", value: data.amount });
  if (data.reference !== undefined) fields.push({ label: "Reference", value: data.reference });
  if (data.text !== undefined) fields.push({ label: "Text", value: data.text });
  return fields;
}
