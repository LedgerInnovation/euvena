# Store declarations

The answers for the questionnaires in App Store Connect and the Play Console, with the reason for
each. They follow from what the app does: it has no server, sends nothing by itself and keeps
everything on the device.

## App Store Connect

**App Privacy: Data Not Collected.** Apple counts data as collected when it is transmitted off the
device in a way that lets the developer or a partner access it. Nothing is: payees, kept requests
and settings are stored on the device (and in the user's own device backups, which the developer
cannot access), and sharing or exporting hands data to the system share sheet at the user's
request, to a destination the user picks. The privacy manifest in
`app.json` says the same: no tracking, no tracking domains, no collected data types.

**Required reason APIs.** The privacy manifest declares the reasons the dependencies give in their
own manifests, since App Store processing does not read those from static CocoaPods:

| API | Reasons | Declared by |
| --- | --- | --- |
| UserDefaults | CA92.1 | React Native, expo-constants, expo-localization, expo-system-ui |
| File timestamp | 0A2A.1, 3B52.1, C617.1 | React Native and its pods, AsyncStorage, expo-file-system |
| Disk space | 85F4.1, E174.1 | expo-file-system |
| System boot time | 35F9.1 | React Native |

When a dependency is added or updated, compare its `ios/PrivacyInfo.xcprivacy` with this list.

**Export compliance.** `usesNonExemptEncryption: false`. The app makes no network requests and
contains no encryption of its own, so the question does not come up at each upload.

**Age rating: 4+.** No objectionable content, no web browsing inside the app, no user-generated
content shared through the app, no purchases.

**Devices.** iPhone only (`supportsTablet: false`). Screenshots are needed for the 6.9-inch
iPhone size.

## Play Console

**Data safety: no data collected, no data shared.** Google counts data as collected when it is
transmitted off the device; data processed only on the device is not collected, and a transfer
the user starts through the share sheet or an intent to another app is not sharing by the
developer. The camera image is processed on the device and never stored.

**Financial features declaration.** A choice for the publisher. The app creates and reads
payment request QR codes and hands the payment to the user's banking app; it holds no funds,
moves no money and is not a payment service. Two answers fit:

- *Support services, Other*, described as "Creates and reads SEPA payment request QR codes. No
  funds are held or moved; the payment is made in the user's own banking app." This matches the
  Finance category the listing uses and explains the app to the reviewer.
- *My app doesn't provide any financial features*, since none of the listed features (banking,
  loans, wallets, transfers, trading) is offered.

"Mobile payments and digital wallets" and "Money transfer and wire services" do not fit: the app
neither stores payment credentials nor transmits money.

**Content rating (IARC).** Category: utility, productivity, communication or other. No violence,
sexual content, profanity, controlled substances, gambling or horror. Users cannot interact or
exchange content with each other inside the app, no location is shared and nothing is sold. The
expected result is the lowest rating in every region (PEGI 3, USK 0, Everyone).

**Target API.** 36, the default of React Native 0.86. The production profile in `eas.json` builds
an app bundle for Play App Signing.

**Ads.** The app contains no ads.

## Both stores

**Privacy policy.** https://ledgerinnovation.com/euvena/privacy/, the text of
`privacy-policy.md`.

**EU trader status (Digital Services Act).** Set on the publisher's developer accounts, not per
app: Euvena is published from the Ledger Innovation MB accounts that carry its other apps.
Confirm in each console that the trader details are complete before the first release.

**Support URL.** The repository's issue tracker.
