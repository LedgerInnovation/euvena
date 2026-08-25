# @eupi/wallet

Reference wallet for European payment QR codes. It renders and scans codes with
[`@eupi/qr`](../../packages/qr), then hands the result to the payer's own banking app to
authorise the transfer.

The app never holds or routes funds and never submits an order to a bank interface. There are
no accounts and no backend.

## Status

The request flow is implemented. Enter an amount and remittance information to get an EPC069-12
code with the decoded values printed beside it, and share that request through the share sheet of
the operating system. Reading a shared link back into the app, scanning and handoff are not
implemented yet; see the checklist on the tracking issue.

## The request flow

Payee name, IBAN and optional BIC are settings on the device. There is no account to register and
no interface is called to verify them. The first run opens the settings screen because a code
cannot be built without an IBAN.

The amount is optional. Leaving it empty omits element 8 of the payload, which lets the payer
enter the amount in their own banking app. Remittance information goes into either the structured
reference element or the unstructured text element, never both, so the form offers a choice of
which one the field fills.

The code is rendered at error correction level M and never above version 13, as EPC069-12
requires. A conformant payload is at most 331 bytes, which is exactly the byte-mode capacity of a
version 13 symbol at level M, so a valid request always fits. The payload is placed in a single
byte-mode segment holding its UTF-8 bytes rather than split into shorter numeric and alphanumeric
segments, because byte mode is what the character set element of the payload describes.

The values shown below the code are decoded back out of the payload rather than read from the
form, so what the payer reads is what a scanner reads.

## Sharing a request

A code works when the payer is in front of it. When they are not, the same request goes out
through the share sheet of the operating system as a short message: the decoded values, then a
link. The wallet sends nothing itself. It hands the text to the system and the user picks the
destination.

The link is:

```
eupi://request?epc=<percent-encoded EPC069-12 payload>
```

It carries the payload the code carries, not a second encoding of the same fields. There is one
codec and one source of truth, so a link shared beside a code decodes to exactly what that code
holds. Reading one back runs the payload through the decoder in strict mode, the same way a
scanned code is read, so a link cannot carry a request that a code could not.

The link names no server. `request` sits where a web address keeps its host, but it is a word for
the wallet, not a place on a network: nothing about a shared request is resolved over the network
and a link that is opened is read entirely on the device that opened it. Percent escapes are the
only decoding applied when reading one: "+" stays a plus rather than becoming a space, because the
wallet never emits an unescaped one and a remittance line may legitimately contain it. Punctuation
that message apps like to split off the end of a link is kept inside escapes, so a link that does
get clipped reads as damaged instead of decoding to an altered request.

`eupi` is registered as the app's URI scheme. Handling an incoming link is part of the scan and
review flow and is not wired up yet.

## Running it

From the repository root:

```sh
pnpm install
pnpm --filter @eupi/qr build
pnpm --filter @eupi/wallet start
```

Then open the project in [Expo Go](https://expo.dev/go) on a physical device, which needs no
Android Studio or Xcode install. The emulator paths are `a` for Android, which requires Android
Studio, and `i` for the iOS simulator, which requires Xcode on macOS.

`@eupi/qr` has to be built before the app can resolve it, which the second command does.

## Checks

```sh
pnpm --filter @eupi/wallet lint
pnpm --filter @eupi/wallet typecheck
pnpm --filter @eupi/wallet test
pnpm --filter @eupi/wallet build   # bundles the JS, no native toolchain required
```

## Layout

| Path | Purpose |
| --- | --- |
| `App.tsx` | Root component, loads the payee settings and switches between the two screens |
| `src/epc/` | Form state to EPC069-12 payload, the link form of a request, plus the display formatting |
| `src/qr/` | QR symbol construction and its SVG path |
| `src/settings/` | Payee settings, on-device only |
| `src/ui/` | Screens and the QR view |
| `metro.config.js` | Workspace-aware resolver so `packages/*` resolve and hot-reload |
| `test/` | Plain-TypeScript tests; the React Native surface is covered by typecheck and lint |

Everything under `src/epc`, `src/qr` and `src/settings` is plain TypeScript with no React Native
imports, which is what keeps it testable in `test/`.
