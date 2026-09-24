# @euvena/wallet

Reference wallet for European payment QR codes. It renders and scans codes with
[`@euvena/qr`](../../packages/qr), then hands the result to the payer's own banking app to
authorise the transfer.

The app never holds or routes funds and never submits an order to a bank interface. There are
no accounts and no backend.

## Status

The request flow is implemented. Enter an amount and remittance information to get an EPC069-12
code with the decoded values printed beside it, and share that request through the share sheet of
the operating system. On the paying side the app scans a code, reads a pasted request (including a
payto link) or opens a shared link, shows what the request says and then hands it to a banking
app. The screens follow the system appearance, light or dark, and a native build shows the logo
on a splash screen while the settings are read. EN 18184 codes are not supported yet; see the
checklist on the tracking issue.

## Keeping a request

A request is kept in an on-device history when it is shared (on Android, when the share sheet is
opened, since the system does not report whether a destination was picked), or when the Keep
action is pressed without sharing. The history stores the payload and when it was built, nothing else, and shows an
entry by decoding its payload again through the same strict reader a scanned code goes through. A
kept request can be opened as the same code and share action it had when it was built, so what is
re-shared later is exactly what was shown at the time.

An entry can be marked done or stale by hand and is shown struck through. The wallet cannot know
whether a request was ever paid, so the mark is the payee's own bookkeeping, never a payment
status. The newest 200 entries are kept; sharing the same request twice in a row keeps one entry.
A stored history that cannot be read is left in place: nothing is kept or marked until the app
restarts, so a failed read never turns into a lost list.

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
euvena://request?epc=<percent-encoded EPC069-12 payload>
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

`euvena` is the only link scheme the app reads. This is a deliberate breaking migration: links
shared under the pre-rename `eupi` scheme are refused, so that the app registers no scheme for them
and the parser accepts exactly one. A pasted pre-rename link gets a message saying to ask for a
fresh link or code. Its payload is never decoded.

## Opening a shared link

Tapping a `euvena://request` link opens the app on the review screen, whether the link starts the
app or reaches it while it is already running. The link is read by the same parser as a pasted
one, so the review shows exactly what a scanned code would show. A link that fails any check
opens the rejection screen instead and nothing from it is displayed. Opening a link only shows
the request: handing it to a banking app still waits for the payer. A link goes straight to
review even on a first run, because paying someone needs no payee settings.

A request that is already on screen is never replaced in place. If another link arrives while
the payer is looking at one, the screen keeps it and says that a new request is waiting. The new
one appears only when the payer asks for it. Opening the same request again changes nothing. A
review that has just appeared ignores presses on its handoff actions for half a second, so a tap
meant for the screen it replaced cannot act on it.

Links are read through `expo-linking`, whose native side keeps the latest link even when it
arrives before the JavaScript side is listening, such as a link that restarts the app after
Android stopped it in the background. The app clears that link once it has read it, so a
remounted app does not open it again. For the same reason, the config plugin in `plugins/` makes
Android drop the link a task first started with whenever it recreates the app from saved state or
starts it from Recents, since that link belongs to an earlier visit. A link the app had no time to
show before the system stopped it is dropped as well and has to be opened again.

Only URLs in the wallet's own scheme are read. That check is made in the app rather than left to
the system: any Android app can address the app directly with a URL of its choosing, while an
iOS build also registers its bundle identifier as a scheme. Expo Go launches the project with an
`exp://` URL of its own and does not register the `euvena` scheme, so link opening can only be
tried in a build that registers it, such as one made with `npx expo run:android`. With that build
installed on an emulator or a connected device, this opens a request for 10 euro:

```sh
adb shell "am start -a android.intent.action.VIEW -d 'euvena://request?epc=BCD%0A002%0A1%0ASCT%0A%0AWikimedia%20Foerdergesellschaft%0ADE33100205000001194700%0AEUR10%0A%0A%0ADonation'"
```

The paste entry reads the same links through the same parser and works in Expo Go.

## Reading a payto link

A scanned code or pasted text may also hold an [RFC 8905](https://www.rfc-editor.org/rfc/rfc8905)
payto URI for a SEPA account, the same form the handoff emits:

```
payto://iban/[BIC/]IBAN?receiver-name=...&amount=EUR:12.30&message=...
```

The link is turned into the EPC069-12 payload of the same request and read back through the
decoder in strict mode, so the review shows exactly what an equivalent code would carry. Every
option lands in an element the review shows or makes the link fail, except three that describe
the parties rather than the payment, which are ignored.

| Option | Handling |
| --- | --- |
| `receiver-name` | Beneficiary name, required because a code requires one. A name that shows nothing fails, as it does in a code |
| `amount` | Euro only and at most once. Digits past the cent must be zeros, since rounding would change what is paid. Commas are refused although the RFC says to ignore them, because a producer writing a decimal comma would have `12,50` paid as 1250 |
| `message` | Unstructured remittance text (RFC 8905 section 7.3), never the structured reference |
| `instruction` | Refused. It is the end-to-end identifier, which neither a code nor the handoff can carry. The RFC says to refuse rather than lose it |
| `sender-name` | Ignored, since it names the payer |
| `receiver-postal-code`, `receiver-town` | Ignored. The GNU Taler wallets add the creditor address, which neither a code nor a transfer form takes |
| anything else | Refused, as is any option given twice. That includes `ch-qrr` (a Swiss structured reference) and a `bic` option that would compete with the path |

The scheme, the target type and the currency are compared without case. Option names are matched
exactly, as the GNU Taler wallet matches them, although RFC 5234 would make them case-insensitive:
`AMOUNT` is refused instead of being honoured here and skipped there. A raw `+` in a value is read
as a space, as that wallet reads it and as common query builders write one. A literal plus has to
arrive as `%2B`, which is what the handoff emits; a producer that leaves it raw loses it. The IBAN
and BIC must be plain letters and digits. One trailing slash after the account is accepted, since
Taler exchanges publish their accounts that way. Other target types, userinfo, a port, a fragment or
further path segments make the link fail.

A link has no size limit, but a code holds 331 bytes. A name and a text that each pass and do not
fit a code together make the link fail, with a message that says it carries more text than a code
can hold.

The app does not register `payto` with the operating system, so a tapped payto link does not
open it. The handoff itself opens a payto URI, so a wallet registered for the scheme would be
offered its own handoff.

## Running it

From the repository root:

```sh
pnpm install
pnpm --filter @euvena/qr build
pnpm --filter @euvena/wallet start
```

Then open the project in [Expo Go](https://expo.dev/go) on a physical device, which needs no
Android Studio or Xcode install. The emulator paths are `a` for Android, which requires Android
Studio, and `i` for the iOS simulator, which requires Xcode on macOS.

`@euvena/qr` has to be built before the app can resolve it, which the second command does.

## Checks

```sh
pnpm --filter @euvena/wallet lint
pnpm --filter @euvena/wallet typecheck
pnpm --filter @euvena/wallet test
pnpm --filter @euvena/wallet build   # bundles the JS, no native toolchain required
```

## Layout

| Path | Purpose |
| --- | --- |
| `App.tsx` | Root component, loads the payee settings, opens incoming links and switches between the screens |
| `plugins/` | Config plugin that keeps a restored Android activity from reopening its launch link |
| `src/epc/` | Form state to EPC069-12 payload, the link form of a request, plus the display formatting |
| `src/qr/` | QR symbol construction and its SVG path |
| `src/settings/` | Payee settings and the request history, on-device only |
| `src/ui/` | Screens, the building blocks they share (`kit.tsx`), the palette for both appearances (`theme.ts`) and the QR view |
| `metro.config.js` | Workspace-aware resolver so `packages/*` resolve and hot-reload |
| `test/` | Plain-TypeScript tests; the React Native surface is covered by typecheck and lint |

Everything under `src/epc`, `src/qr` and `src/settings` is plain TypeScript with no React Native
imports, which is what keeps it testable in `test/`.
