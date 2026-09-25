# @euvena/wallet

Reference wallet for European payment QR codes. It renders and scans codes with
[`@euvena/qr`](../../packages/qr), then hands the result to the payer's own banking app to
authorise the transfer.

The app never holds or routes funds and never submits an order to a bank interface. There are
no accounts and no backend.

## Status

The request flow is implemented. Enter an amount, and what the payment is for when there is one,
to get an EPC069-12 code, then share that request through the share sheet of the operating
system. The values decoded back out of the code are a tap away below it. On the paying side the
app scans a code, reads a pasted request (including a payto link) or opens a shared link, shows
what the request says and then hands it to a banking app. A bar at the foot of the screen switches
between requesting, paying and the history; the gear in the header opens the settings, which hold
the payees, the appearance, the language and the file that moves the data to another device. The
wallet speaks English, German, French, Spanish, Italian, Dutch and Polish, and follows the device
language until one is chosen by hand. The screens follow the system appearance, light or dark, or
the one chosen in the settings, and a native build shows the logo on a splash screen while the
settings are read. EN 18184 codes are read, and built once the settings hold the framework
details they need; see [EN 18184 codes](#en-18184-codes).

## Languages and appearance

Every piece of wording is one typed shape under `src/i18n`, and each language is a value of that
shape, so a missing translation is a type error at build time rather than a blank label on a
device. Wording that takes values is a function, so each language orders its sentences its own
way, Polish counts its three plural forms and lists join with their own "and". The device
language decides through `expo-localization` until a language is chosen in the settings, and the
choice survives restarts beside the payees. Amounts and dates on screen are written the way the
chosen language writes them; the amount inside a code is not touched, since EPC069-12 fixes it.

The readers under `src/epc` return what went wrong as a code and the elements concerned, not as
a sentence, and the screen words it in the language in force. Issues the encoder raises against
the request form are worded the same way, so nothing the codec says and nothing typed is echoed.
The device's own regional tag is used for money
and dates whenever it speaks the chosen language, so an Irish or Austrian reader keeps their
regional shapes. The chosen appearance is handed to the platform as well, so alerts, the keyboard
and the sheets the wallet opens follow it. Right-to-left layout is out of scope.

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

## Moving the data to another device

Settings offers an export and an import. The export writes the payees and the kept requests to
one JSON file and hands it to the share sheet of the operating system, so where it goes is the
user's choice; the wallet sends nothing itself. The appearance, the language and the EN 18184
details are settings of the device and stay out of the file. The file names its format and a version number,
so a later shape of the file can still read an earlier export, and an export written by a newer
wallet is refused with a message rather than misread.

The import reads a file the user picks and adds what it holds to what the device holds. Nothing
is replaced or pushed out: a payee whose IBAN is already held is skipped, a request already kept
(the same id, or the same payload built at the same time) is skipped, new entries go only into
the room the lists have and the active payee stays unless there was none. Every payee in the file
passes the same encoder check the form runs, and every kept request must decode through the same
strict reader a scanned code goes through and carry a build time no later than the clock, so
nothing gets in through a file that could not have got in by hand. What was skipped and what
could not be used are counted and said. The payees are written before the kept requests, so a
history that cannot be written still leaves the payees imported, and the notice says so. An
export is refused while saved data could not be read, since the file would look complete and not
be.

## The request flow

Payee name, IBAN and optional BIC are settings on the device, listed under Settings. There is no
account to register and no interface is called to verify them. The first run opens the payee form
because a code cannot be built without an IBAN. The device can hold up to 20 payees, one of them
active: requests are built for the active one, and the request screen names it and offers
switching before composing. A payee just saved becomes the active one. Each payee passes the same
encoder-backed validation, so a payee that saved always encodes. Settings written by an earlier
version, which held a single payee, are read as a book of one.

The amount is optional. Leaving it empty omits element 8 of the payload, which lets the payer
enter the amount in their own banking app. What the payment is for, folded away until wanted, goes
into either the structured reference element or the unstructured text element, never both, so the
field offers a choice of which one it fills.

The code is rendered at error correction level M and never above version 13, as EPC069-12
requires. A conformant payload is at most 331 bytes, which is exactly the byte-mode capacity of a
version 13 symbol at level M, so a valid request always fits. The payload is placed in a single
byte-mode segment holding its UTF-8 bytes rather than split into shorter numeric and alphanumeric
segments, because byte mode is what the character set element of the payload describes.

The values shown with the code, a tap away on the request screen and open in the history, are
decoded back out of the payload rather than read from the form, so what the payer reads is what a
scanner reads.

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

## EN 18184 codes

EN 18184:2025, published from EPC024-22, is the point-of-interaction format: a code is an https
URL rather than the line-based EPC069-12 payload.

```
https://<framework domain>/1/<payment context>/<provider ID>/?<payload>
```

The domain belongs to an MSCT interoperability framework, the provider ID routes the payment to
the payee's MSCT service provider and the payload names its issuer by another ID. The framework
issues all three, and nothing in the code can be looked up to find them, so the wallet builds no
EN 18184 code until they are entered under Settings, EN 18184 codes. The form checks them with the
encoder: a bare domain name, not an IP address in any spelling and not an internationalised
(punycode) name, which URL parsers read differently, and two IDs of 3 letters or digits. From
then on the request screen offers a choice of format, EPC QR or EN 18184, and for EN 18184 a
choice of an instant or a standard transfer. The code is built with the payload profile that carries all data in clear, in
the person-to-person context `p`, and uses the parameter names of the Euvena profile v1 that
`@euvena/qr` documents.

What changes for the payee against an EPC069-12 code:

| | EPC069-12 | EN 18184 |
| --- | --- | --- |
| Read by | Most European banking apps | Apps in an EN 18184 framework |
| Amount | Optional; the payer can decide | Required |
| Remittance | Text up to 140 characters, or a creditor reference | Text or a structured reference, up to 35 characters |
| BIC | Carried when the payee has one | Not carried; the format has no element for it |
| Transfer | Not stated | Instant or standard, as chosen |
| Symbol | Level M, version 13 at most, as EPC069-12 requires | Level M; EPC024-22 names ISO/IEC 18004 and fixes no version, so up to 40 |

A kept EN 18184 request goes into the history like any other and a shared one travels as its own
URL, since that is already the request. Turning the codes off in the settings brings the request
screen back to EPC069-12 only; the draft keeps what was picked for when they are set up again.

EPC024-22 leaves the query parameter names to the payload issuer, so the wallet reads the names
of the Euvena profile v1 only. A conformant code from an issuer that chose other names is refused
as an address the wallet cannot read as an EN 18184 code.

On the paying side a scanned or pasted `https://` address goes to the EN 18184 decoder, with the
scheme and host compared without case, since EPC024-22 writes its examples in capitals. A code with
all data in clear gets the same review as an EPC069-12 code, plus the transfer the payee asks for,
any trade name, reference party and merchant category, the payment context, and the framework,
provider and issuer the address names. A phone camera would have opened that address; the wallet
reads it on the device and opens nothing, and the review says so. When the payee asks for an
instant transfer, the handoff says so too, because neither the payto link nor a transfer form field
carries it.

Refused, as a whole:

| Code | Why |
| --- | --- |
| Token or proxy profile | The token or proxy stands for payee data that only the payee's provider can resolve, over its own network |
| A currency other than euro, compared without case | SEPA transfers are made in euro, and the handoff states a euro amount |
| Any field that fails a check, or any parameter given twice | Named by element, never quoted, as for EPC069-12 |
| An https address without the EN 18184 structure or the Euvena profile v1 names, served from an IP address or a punycode host, or with credentials, a port or a fragment | The wallet cannot read it as an EN 18184 code, and opens nothing |

The codec parses the URL with the global `URL`. React Native's own `URL` is not the WHATWG one and
cuts a value at a second `=`, but Expo's runtime replaces it with a WHATWG implementation, against
which the codec's EN 18184 tests pass unchanged.

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

## Publishing

Store builds are made with EAS from `eas.json`:

| Profile | Builds |
| --- | --- |
| `simulator` | An iOS simulator build and an Android APK, to try the native build (splash screen, localised camera prompt) without a store |
| `preview` | Internal distribution builds for test devices |
| `production` | Store builds: an Android app bundle for Play App Signing, build numbers kept by EAS and raised on each build |

`app.json` carries the store-facing settings: version 1.0.0, iPhone only, no non-exempt
encryption, a privacy manifest that declares no tracking and no collected data plus the
required-reason APIs the dependencies use, and the camera prompt in the seven wallet languages
(`locales/`). `expo-system-ui` lets the Android build follow the light or dark appearance. Android
targets API 36, the React Native 0.86 default. Listings, review notes, the privacy policy text and
the questionnaire answers are in [`store/`](store/).

Linking the project to an EAS account (`eas init`) and the store credentials are left to the
publisher and are not part of the repository.

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
| `App.tsx` | Root component, loads the payee settings, opens incoming links, holds the tab bar and switches between the screens |
| `eas.json` | EAS build profiles: simulator, preview and production |
| `locales/` | The camera prompt in each wallet language, for the iOS Info.plist |
| `store/` | Store listings, review notes, privacy policy text and questionnaire answers |
| `plugins/` | Config plugin that keeps a restored Android activity from reopening its launch link |
| `src/epc/` | Form state to an EPC069-12 payload or an EN 18184 URL (`poi.ts`), the link form of a request, plus the display formatting |
| `src/i18n/` | The typed dictionary shape, one file per language, language resolution and number and date formatting |
| `src/qr/` | QR symbol construction and its SVG path |
| `src/settings/` | Payee settings, the appearance, language and EN 18184 preferences, the request history and the data file that moves them, on-device only |
| `src/ui/` | Screens, the building blocks they share (`kit.tsx`), the palette for both appearances (`theme.ts`), the QR view and the file share and pick (`dataFile.ts`) |
| `metro.config.js` | Workspace-aware resolver so `packages/*` resolve and hot-reload |
| `test/` | Plain-TypeScript tests; the React Native surface is covered by typecheck and lint |

Everything under `src/epc`, `src/qr` and `src/settings` is plain TypeScript with no React Native
imports, which is what keeps it testable in `test/`.
