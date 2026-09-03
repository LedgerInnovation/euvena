# Euvena

**Open-source building blocks for instant payments in Europe.**

Europe has world-class payment rails: since October 2025 every eurozone bank must send and
receive SEPA Instant Credit Transfers 24/7 in under 10 seconds, at no premium over a regular
transfer. The standards on top of the rails are open too: QR codes, payee verification,
request-to-pay. What is missing is open-source software that implements them.

Euvena fills that gap: a set of independently usable, Apache-2.0 licensed libraries and
reference services for building payment experiences on SEPA, inspired by what UPI did for
India and Pix for Brazil, but as an open commons rather than a closed scheme.

Euvena was previously named EUPI. Releases up to September 2026 were published on npm as
`@eupi/qr` and `@eupi/taler`; the `@euvena` scope succeeds them.

## Packages

| Package | Status | Description |
|---|---|---|
| [`@euvena/qr`](packages/qr) | alpha | Encode and decode European payment QR codes: EPC069-12 (the "EPC QR" / GiroCode scanned by many European banking apps today) and EPC024-22 (the MSCT QR standard behind EN 18184:2025, covering merchant-presented and payer-presented codes for instant payments) |
| [`@euvena/taler`](packages/taler) | alpha | Top up GNU Taler reserves with standard EPC QR codes: any European banking app becomes a Taler on-ramp, no payer-side software needed |

Planned: Verification of Payee client (EPC VoP scheme), SEPA Request-to-Pay (EPC133-22),
alias directory reference implementation, settlement connectors, reference mobile wallet.

## Design principles

- **Implement open specifications faithfully.** Every module cites the exact free
  specification document it implements. Where a spec deliberately leaves implementation
  choices open, we document our profile and keep it overridable.
- **Never touch the money.** These libraries generate, parse, and validate payment data.
  Executing payments remains with the user's own payment service provider. A typical
  integration generates a standard QR code that the payer scans and authorizes inside their
  own banking app.
- **Zero dependencies where possible.** Payment primitives should be auditable.

## Specifications implemented

- EPC069-12 v3.1, "Quick Response Code: Guidelines to Enable the Data Capture for the
  Initiation of a SEPA Credit Transfer" (European Payments Council, March 2024)
- EPC024-22 v2.10, "Standardisation of QR-codes for Mobile Initiated SEPA (Instant) Credit
  Transfers" (European Payments Council, June 2024), the basis of EN 18184:2025

Both documents are freely available from the [EPC document library](https://www.europeanpaymentscouncil.eu/document-library).

## Legal note

This project provides software, not payment services. Generating or parsing payment data
does not make you a payment service provider, but what you build with it might. If your
product holds funds, initiates payments on a user's behalf, or intermediates them in any
way, seek your own regulatory advice.

## License

[Apache-2.0](LICENSE)
