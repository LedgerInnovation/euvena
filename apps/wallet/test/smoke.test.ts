import { describe, expect, it } from "vitest";
import { decodeEpcQr, encodeEpcQr } from "@euvena/qr";

// The scaffold has no payment features yet. This asserts only that the app
// resolves the workspace copy of @euvena/qr and can round-trip through it, so a
// broken workspace link fails here rather than at runtime on a device.
describe("@euvena/qr is wired into the app", () => {
  it("round-trips an EPC069-12 payload", () => {
    const payload = encodeEpcQr({
      name: "Wikimedia Foerdergesellschaft",
      iban: "DE33100205000001194700",
      amount: 13.05,
      text: "Spende fuer Wikipedia",
    });

    const decoded = decodeEpcQr(payload);

    expect(decoded.data.iban).toBe("DE33100205000001194700");
    expect(decoded.data.amount).toBe("13.05");
  });
});
