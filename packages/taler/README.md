# @euvena/taler

Top up GNU Taler reserves with standard European payment QR codes.

## How it works

A Taler wallet is funded by wiring money to the exchange's bank account with the
**reserve public key** as the transfer subject. The exchange watches its account
(via LibEuFin/Nexus), finds the key in the subject of an incoming credit, and
credits that reserve.

This package encodes that flow as an **EPC069-12 QR code** (the "EPC QR" / GiroCode
that many European banking apps scan natively). The QR carries the exchange's IBAN,
an optional amount, and the reserve public key as remittance text. The payer scans
it in their own banking app and confirms; since October 2025 the resulting SEPA
Instant Credit Transfer reaches the exchange in seconds. No Taler-specific software
is needed on the payer's side, and no payment service provider sits in between.

```
Taler wallet                    payer's own banking app            exchange bank account
  reserve keypair  ──QR code──►  scan, confirm transfer  ──SCT──►  subject: <reserve pub>
                                                                        │
  coins withdrawn  ◄───────────  exchange credits reserve  ◄──────  LibEuFin/Nexus
```

## Usage

```ts
import { encodeTalerTopupQr, parseTalerTopupQr, findReservePub } from "@euvena/taler";
import QRCode from "qrcode";

// Wallet or exchange side: build the QR for a withdrawal
const payload = encodeTalerTopupQr({
  accountName: "Taler Exchange Demo",
  iban: "DE71 1102 2033 0123 4567 89",
  amount: 50,                      // omit for an open-amount QR
  reservePub: "ABCDEFGHJKMNPQRSTVWXYZ0123456789ABCDEFGHJKMNPQRSTVWX",
});
await QRCode.toDataURL(payload, { errorCorrectionLevel: "M" });

// Integration side: recognise top-up QR codes
const topup = parseTalerTopupQr(scannedText);
// topup.reservePub, topup.iban, topup.amount

// Bank-watcher side: match incoming transfer subjects
const pub = findReservePub("Taler ABCDEFGH... withdrawal");
```

Validation is inherited from [`@euvena/qr`](../qr) (IBAN check digits, amount range,
payload limits) plus Taler reserve key checks (52-character Crockford base32 in
Taler's alphabet: 0-9, A-Z without I, L, O, U). `findReservePub` tolerates
surrounding text, since banks may decorate the subject line.

## Roadmap

A runnable end-to-end demonstration against libeufin-bank (create accounts, render
the QR, execute the scanned transfer, observe the reserve credit) is planned as the
next step, along with EN 18184 QR support offered upstream to the Taler wallets.

## License

Apache-2.0
