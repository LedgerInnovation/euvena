# Accepting payto links in a banking app

A guide for the developers of banking apps. It takes an afternoon to follow and needs no
agreement with anyone.

## The problem it solves

A payment request often reaches the payer on the phone they would pay with: an invoice in an
email, a link in a chat, a QR code on a web page. The EPC QR code ("GiroCode") works when the
payer can point a second device at it. On the same phone there is nothing to scan, so the payer
copies the name, the IBAN, the amount and the reference into the banking app one by one.

A `payto://iban` link carries the same request as the code, in a form one app can hand to
another. When the banking app accepts it, the payer taps the link and the app opens with the
transfer filled in. The payer checks it and authorises it as usual. RFC 8905 defines the
scheme. The [payto handoff profile](payto-handoff.md) fixes exactly how a SEPA credit transfer
request is written and read.

Today almost no banking app accepts these links. A payment app that emits them, such as the
Euvena wallet, has to fall back to the copy fields.

## What a link looks like

```
payto://iban/DE89370400440532013000?amount=EUR:25.00&receiver-name=Example%20Payee&message=Invoice%202026-001
```

| Part | Meaning |
| --- | --- |
| `iban/[BIC/]IBAN` | The beneficiary's account. The BIC comes before the IBAN when present |
| `amount=EUR:25.00` | The amount in euro. Absent when the payer decides it |
| `receiver-name` | The beneficiary name, always present |
| `message` | The unstructured remittance information, up to 140 characters |

The profile's [element mapping](payto-handoff.md#element-mapping) lists every rule.

## Step 1: register the scheme

Android, in the manifest entry of the activity that opens the transfer form:

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

Then read the link in the handler your app already has for incoming links. On Android that is
`onNewIntent` or the launch intent. On iOS it is `scene(_:openURLContexts:)` in a scene delegate,
`application(_:open:options:)` without one or `onOpenURL` in SwiftUI.

## Step 2: read the link

Parse strictly and refuse the whole link when anything is wrong. Never fill in part of a
transfer. The profile lists the [reading rules](payto-handoff.md#reading-a-uri). The ones that
matter most:

- the IBAN passes its check digits and the BIC, when present, its format
- the amount is `EUR:` followed by digits with a point as the separator, never a comma. Digits
  past the cent must be zeros
- `receiver-name` is present and not blank
- no control characters, line breaks or bidirectional formatting characters in any value
- an unknown option, a repeated option or an `instruction` refuses the link. The exceptions are
  `sender-name`, `receiver-postal-code` and `receiver-town`, which describe the parties rather
  than the payment and are ignored. GNU Taler wallets add the last two

In JavaScript or TypeScript, including React Native, `@euvena/qr` does all of this:

```ts
import { PaytoError, decodePaytoUri } from "@euvena/qr";

try {
  const transfer = decodePaytoUri(url);
  // transfer.name, transfer.iban, transfer.bic, transfer.amount, transfer.text
  openTransferForm(transfer);
} catch (error) {
  if (!(error instanceof PaytoError)) throw error;
  showCannotReadLink(error.code);
}
```

Native Kotlin and Swift versions are planned (issues #11 and #12). Until then the profile is the
specification to implement against. The tests in `packages/qr/test/payto.test.ts` can serve as
cases.

## Step 3: show it before anything happens

- Open the ordinary transfer form with the values filled in. Show the beneficiary name, the full
  IBAN, the amount and the message before the payer confirms.
- Authorise exactly as for a transfer the payer typed in, with no step skipped. Any app on the
  phone can open a link.
- Run your usual checks on the values, including Verification of Payee.
- Let the payer choose the account to pay from. The link never names it.
- When the amount is missing, ask for it.

## Test links

Open this page on a phone with your build installed and tap each link. The account is the
widely published example IBAN, which may still belong to someone, so stop at the filled-in form
and do not authorise. Use your own test account for an end-to-end run.

| Link | Expected |
| --- | --- |
| `payto://iban/DE89370400440532013000?amount=EUR:25.00&receiver-name=Example%20Payee&message=Invoice%202026-001` | Transfer form with all four values |
| `payto://iban/COBADEFFXXX/DE89370400440532013000?receiver-name=Example%20Payee` | Form with the BIC, no amount, the payer enters it |
| `payto://iban/DE89370400440532013000?amount=EUR:12,50&receiver-name=Example%20Payee` | Refused: comma in the amount |
| `payto://iban/DE89370400440532013001?receiver-name=Example%20Payee` | Refused: IBAN check digits |
| `payto://iban/DE89370400440532013000?receiver-name=Example%20Payee&instruction=E2E-1` | Refused: end-to-end identifier |

GitHub shows these as text. The same table with tappable links is on
[ledgerinnovation.com/euvena/payto](https://ledgerinnovation.com/euvena/payto/#test-links).

On Android you can also fire a link from a computer:

```sh
adb shell am start -a android.intent.action.VIEW \
  -d "payto://iban/DE89370400440532013000?amount=EUR:25.00\&receiver-name=Example%20Payee"
```

## Where the links come from

The [Euvena wallet](../apps/wallet) emits these links from its review screen after the payer has
checked a scanned or shared request. Invoicing tools, web shops and other payment apps can emit
them with `encodePaytoUri`, the same way they already print an EPC QR code. A banking app that
accepts the link receives the request from all of them.

Questions and reports of an app that accepts links are welcome in the
[issue tracker](https://github.com/LedgerInnovation/euvena/issues).
