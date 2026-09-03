# @euvena/qr

Encode and decode European payment QR codes in TypeScript, with zero runtime dependencies.

Two codecs are included:

- **EPC069-12** ("EPC QR code" / GiroCode): the line-based payload many European banking
  apps can scan today to prefill a SEPA Credit Transfer. Ideal for invoices, donations,
  and pay-me screens.
- **EPC024-22** (MSCT QR, the specification underlying **EN 18184:2025**): the URL-based
  QR format for Mobile Initiated SEPA (Instant) Credit Transfers, covering
  merchant-presented and payer-presented codes for P2P, C2B, B2B and B2C payments.

This library produces and parses QR *payloads*. Render them with any QR library
(EPC069-12 requires error correction level M):

```ts
import QRCode from "qrcode";
import { encodeEpcQr } from "@euvena/qr";

const payload = encodeEpcQr({
  name: "Franz Mustermann",
  iban: "DE71 1102 2033 0123 4567 89",
  amount: 12.3,
  text: "Invoice 2026-001",
});
await QRCode.toDataURL(payload, { errorCorrectionLevel: "M" });
```

## EPC069-12

```ts
import { encodeEpcQr, decodeEpcQr } from "@euvena/qr";

const payload = encodeEpcQr({
  name: "Red Cross of Belgium",
  iban: "BE72000000001616",
  amount: "1",          // number or numeric string, 0.01..999999999.99
  purpose: "CHAR",       // optional AT-44 purpose code
  text: "Urgency fund",  // or `reference` for an ISO 11649 RF creditor reference
});

const { data } = decodeEpcQr(scannedText);
// data.name, data.iban, data.amount, ...
```

Validation covers IBAN check digits and country lengths, BIC format, the version 001
BIC requirement, ISO 11649 RF reference check digits, amount range, mutually exclusive
remittance fields, character set constraints, and the 331 byte payload limit. Both
official examples from the specification are reproduced byte for byte in the test suite.

`decodeEpcQr(text, { strict: false })` returns structurally readable payloads together
with a list of issues instead of throwing.

## EPC024-22 / EN 18184

An MSCT QR code is an https URL:

```
https://<domain>/<version>/<type>/<MSCT service provider ID>/?<payload>
```

where `type` is the payment context: `m` (POI), `e` (e-commerce), `i` (invoice),
`p` (person-to-person), `w` (webview). Three payee-presented payload profiles exist
(token, proxy, all data in clear) plus a payer-presented token profile:

```ts
import { encodeMsctPayeeClear, decodeMsctQr } from "@euvena/qr";

const url = encodeMsctPayeeClear({
  domain: "qr.example.org", // your MSCT framework or scheme domain
  providerId: "AB1",         // 3-character MSCT service provider ID
  issuer: "XY9",             // 3-character payload issuer ID
  context: "p",
  name: "Alice Example",
  iban: "BE72000000001616",
  instrument: "INST",        // SEPA Instant ("SCT" for regular)
  amount: 24.5,
  remittance: "lunch",
});

const { data } = decodeMsctQr(scannedUrl);
if (data.kind === "payee-clear") {
  // data.name, data.iban, data.amount, data.instrument, ...
}
```

### A note on parameter names

EPC024-22 standardises the URL structure and the payload *content*, but explicitly
leaves the query parameter *names* to the payload issuer. The names used by default
here (`iss`, `tok`, `prx`, `nm`, `iban`, `ins`, `cur`, `amt`, ...) are the **Euvena
profile v1**, an open naming proposal. Every encode and decode function accepts a
`keys` mapping to interoperate with issuers that made different choices, and
`decodeMsctQr` always returns the raw `URLSearchParams`.

## Utilities

`isValidIban`, `normalizeIban`, `IBAN_LENGTHS`, `isValidRfReference`,
`formatAmount`, `isValidAmountString`, `byteLength`, `isLatin1`.

## Specifications

- EPC069-12 v3.1, Quick Response Code: Guidelines to Enable the Data Capture for the
  Initiation of a SEPA Credit Transfer (EPC, 19 March 2024)
- EPC024-22 v2.10, Standardisation of QR-codes for Mobile Initiated SEPA (Instant)
  Credit Transfers (EPC, 17 June 2024)

Both are freely available from the
[EPC document library](https://www.europeanpaymentscouncil.eu/document-library).
This is an independent implementation written from the freely published EPC documents;
it is not endorsed by the European Payments Council.

## License

Apache-2.0
