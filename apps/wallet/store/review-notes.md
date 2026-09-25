# App review notes

Paste into App Store Connect (App Review Information, Notes) and, shortened, into the Play
Console where a reviewer note is asked for. No sign-in is needed, so no demo account is given.

---

Euvena composes and reads payment requests for SEPA credit transfers. It holds no funds, executes
no payments, has no accounts and no backend, and contacts no bank or payment service.

How to try it:

1. On first launch the app asks for a payee. Enter any name and a test IBAN such as
   DE89 3704 0044 0532 0130 00, then Save.
2. The Request tab now shows an EPC069-12 QR code ("EPC QR code" or "GiroCode"), the format
   European banking apps scan to fill in a transfer. Type an amount and the code updates. "Share
   this request" opens the system share sheet with the request as text and a link.
3. The Pay tab reads a payment code with the camera, or pasted text. Copy one of the two samples
   below to the test device, paste it and tap "Read what was pasted". The review shows the decoded
   values. "Open your banking app" hands them on as a payto link to an installed app that accepts
   one; the rows below it copy each value for a transfer form. The payment itself is always made
   and authorised in the user's own banking app.
4. The History tab lists requests that were shared or kept. Settings holds the payees, the
   appearance, the language, an export and import of the on-device data, and the optional
   EN 18184 code settings.

Sample request on one line, a payto link:

payto://iban/DE33100205000001194700?amount=EUR:13.05&receiver-name=Wikimedia%20Foerdergesellschaft&message=Spende%20fuer%20Wikipedia

The same request as an EPC069-12 payload, eleven lines copied exactly, with nothing before each
line. Lines 5, 9 and 10 are empty: no BIC, no purpose code, no structured reference.

BCD
002
1
SCT

Wikimedia Foerdergesellschaft
DE33100205000001194700
EUR13.05


Spende fuer Wikipedia

The same request is attached as review-code.png, for scanning from a second device.

The camera is used only on the Pay tab, to read QR codes. All data stays on the device.
