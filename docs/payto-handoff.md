# The payto handoff profile

Version 1, September 2026.

A payer who has reviewed a payment request still has to get it into their banking app. Europe has
no common way to open a banking app with a credit transfer filled in. The EPC069-12 QR code works
when the payer's app can scan it, but the payer is often holding the request on the same phone.

RFC 8905 defines the `payto` URI, an open and registered way to name a payment target. This
profile says how a SEPA credit transfer request, the one an EPC069-12 code carries, is written as a
payto URI, how such a URI is read, and what a banking app does to take part. Any app can emit
these URIs today. A banking app that registers for them lets any request, from a code, a link or
an invoice, open the app with the transfer filled in.

The profile is implemented by `encodePaytoUri` and `decodePaytoUri` in
[`@euvena/qr`](../packages/qr). The Euvena wallet emits the URIs, and the GNU Taler wallets read
payto URIs, so there are two independent implementations.

The key words MUST, MUST NOT, SHOULD and MAY are used as in RFC 2119.

## The URI

```
payto://iban/[<BIC>/]<IBAN>?amount=EUR:<amount>&receiver-name=<name>&message=<text>
```

For example:

```
payto://iban/DE33100205000001194700?amount=EUR:13.05&receiver-name=Wikimedia%20Foerdergesellschaft&message=Spende%20fuer%20Wikipedia
```

The target type is `iban` (RFC 8905 section 7.3). No other target type belongs to this profile.

## Element mapping

| EPC069-12 element | payto | Notes |
| --- | --- | --- |
| BIC (5) | first path segment | Only when the request has one. Section 7.3 allows the BIC before the IBAN. |
| Beneficiary name (6) | `receiver-name` | Required. 1 to 70 characters, at least one visible. |
| IBAN (7) | last path segment | Electronic form: letters and digits, no spaces. Check digits and country length hold. |
| Amount (8) | `amount=EUR:<value>` | Omitted when the payer chooses the amount. 0.01 to 999999999.99, at most two decimals. |
| Unstructured remittance (11) | `message` | Section 7.3 defines `message` as the unstructured remittance information. At most 140 characters. |
| Structured reference (10) | none | See [the structured reference gap](#the-structured-reference-gap). |
| Purpose (9) | none | No payto option. Dropped. |
| Beneficiary to originator information (12) | none | Display text for the payer, not part of the transfer. Dropped. |
| Version, character set, identification (2 to 4) | none | Payload framing. A payto URI is always UTF-8. |

Every element that is carried is held to the EPC069-12 rules, so a URI written or read under this
profile says nothing an EPC069-12 code could not. That includes the BIC rule of version 002: a
beneficiary account in a non-EEA SEPA country (Switzerland, the United Kingdom and others) needs a
BIC. Every value MUST be free of control characters, line and paragraph separators, bidirectional
formatting characters, interlinear annotation marks and unpaired surrogates, which could make a
displayed value read differently from what it says.

The URI itself has no size limit. A name and a text that each pass can still overrun the 331
bytes of an EPC069-12 payload together. A reader that turns the URI back into a code reports that
case on its own.

## The structured reference gap

A structured creditor reference, usually an ISO 11649 `RF` reference, is how many billers match an
incoming payment to an invoice. No payto option carries it:

- `message` is the unstructured remittance information. A reference written there reaches the
  creditor as free text, which automatic reconciliation may not read.
- `instruction` is the SEPA end-to-end identifier (section 7.3), a different field that the payer's
  bank passes along for the payer's own tracking.

Writing the reference into either would downgrade it without anyone noticing. So a producer MUST
NOT write a structured reference into `message` or `instruction`. When a request carries one, the
producer either does not emit a URI, or emits one without the reference and shows the payer the
reference to enter by hand, before the banking app opens. `encodePaytoUri` refuses a reference
unless the caller passes `omitReference: true`, which is the second choice.

**Proposal.** A `creditor-reference` option for the `iban` target type, carrying the structured
remittance information of a SEPA credit transfer: at most 35 characters, and when it begins with
`RF`, a valid ISO 11649 reference. It is exclusive with `message`, as the two are in EPC069-12 and
in the SEPA rulebook. RFC 8905 section 10 places the target types in the "Payto Payment Target
Types" registry that GANA operates, with First Come First Served registration, and each entry's
references define the options of its type. The proposal is to add this profile to the references
of the `iban` entry.

Until that happens, producers MUST NOT emit `creditor-reference`. Readers under this profile
refuse any option they do not know, so a URI that carries it is refused rather than paid without
it.

## Writing a URI

- The path is the IBAN, or the BIC and the IBAN, each in upper case.
- `amount` comes first when present, then `receiver-name`, then `message`. Readers MUST accept any
  order (RFC 8905 section 5).
- Values are UTF-8 and percent-encoded as in RFC 3986. The colon in `EUR:<value>` stays literal, as
  in the RFC's examples. A plus sign MUST be written as `%2B`, because widely used query parsers
  read a raw `+` as a space.
- The amount uses a point as the decimal separator and no grouping. RFC 8905 lets readers ignore
  commas, so a comma would change the amount.
- `instruction`, `sender-name` and any option not in this profile are not written.

## Reading a URI

A reader MUST refuse the whole URI, rather than use part of it, when:

- the scheme is not `payto` or the target type is not `iban`, compared without case, or the
  authority carries userinfo or a port
- the URI has a fragment, or a path other than one or two segments of letters and digits (one
  trailing slash is accepted, as Taler exchanges publish their accounts that way)
- a percent escape is truncated or not valid UTF-8
- an option has no name or no `=`, or is given twice
- an option is `instruction`: the end-to-end identifier cannot be passed on, and RFC 8905 section 6
  says to refuse rather than lose information
- an option is not in this profile. That includes `ch-qrr` and a `bic` option that would compete
  with the path
- `receiver-name` is missing or empty
- `amount` is not `EUR:` followed by digits with an optional point, or has digits past the cent
  that are not zeros, or has a comma, or is outside the SEPA range
- any element fails the checks in [Element mapping](#element-mapping)

Three options describe the parties rather than the payment and are ignored: `sender-name`, because
the payer is the one reading, and `receiver-postal-code` and `receiver-town`, which the GNU Taler
wallets add and which do not change where the money goes.

Option names are matched exactly. RFC 5234 makes the quoted names case-insensitive, but the GNU
Taler wallet matches them exactly, and two readers must never pay different amounts for one URI.
A raw `+` in a value is read as a space.

Error messages MUST NOT repeat the input. A URI is someone else's writing.

## What a banking app does with one

A banking app that accepts these URIs:

1. MUST show the beneficiary name, the full IBAN, the amount and the message before the payer
   authorises anything, and MUST NOT authorise a transfer without the payer's action.
2. MUST treat every value as untrusted input and run its usual checks on it, including
   Verification of Payee for a euro transfer.
3. SHOULD let the payer change the amount when the URI has none, and MUST NOT take the payer's
   account or name from the URI.
4. SHOULD tell the payer, when the transfer form has a structured reference field, that a biller's
   reference may still need to be entered.

To be offered these URIs, the app registers the scheme.

Android, in the activity that opens the transfer form:

```xml
<intent-filter>
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data android:scheme="payto" android:host="iban" />
</intent-filter>
```

iOS, in `Info.plist`:

```xml
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLName</key>
    <string>payto</string>
    <key>CFBundleURLSchemes</key>
    <array>
      <string>payto</string>
    </array>
  </dict>
</array>
```

On iOS, when several apps register a scheme, the system picks one and the payer cannot choose. A
producer SHOULD therefore always offer the values to copy as well.

## Using @euvena/qr

A banking app reading an incoming URI:

```ts
import { PaytoError, decodePaytoUri } from "@euvena/qr";

try {
  const transfer = decodePaytoUri(url);
  // transfer.name, transfer.iban, transfer.bic, transfer.amount, transfer.text
  openTransferForm(transfer);
} catch (error) {
  if (!(error instanceof PaytoError)) throw error;
  // error.code says why; error.issues names the failed elements
}
```

An app turning a scanned EPC069-12 code into a handoff:

```ts
import { decodeEpcQr, encodePaytoUri } from "@euvena/qr";

const { data } = decodeEpcQr(scanned);
const uri = encodePaytoUri(data, { omitReference: true });
if (data.reference !== undefined) showReferenceToCopy(data.reference);
```

`decodePaytoUri` returns elements that `encodeEpcQr` takes as they are, so a payto URI can also be
shown as a code.

## References

- RFC 8905, The 'payto' URI Scheme for Payments (October 2020)
- EPC069-12 v3.1, Quick Response Code: Guidelines to Enable the Data Capture for the Initiation of
  a SEPA Credit Transfer (European Payments Council, March 2024)
- ISO 11649, Structured creditor reference to remittance information
- RFC 3986, Uniform Resource Identifier (URI): Generic Syntax
