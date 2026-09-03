import { describe, expect, it } from "vitest";
import { decodeEpcQr } from "@euvena/qr";
import {
  TalerTopupError,
  encodeTalerTopupQr,
  findReservePub,
  isValidReservePub,
  parseTalerTopupQr,
} from "../src/index.js";

/** 52 characters from the Taler Crockford base32 alphabet (no I, L, O, U). */
const RESERVE_PUB = "ABCDEFGHJKMNPQRSTVWXYZ0123456789ABCDEFGHJKMNPQRSTVWX";

const EXCHANGE = {
  accountName: "Taler Exchange Demo",
  iban: "DE71110220330123456789",
};

describe("isValidReservePub", () => {
  it("accepts a well-formed key", () => {
    expect(RESERVE_PUB).toHaveLength(52);
    expect(isValidReservePub(RESERVE_PUB)).toBe(true);
  });

  it("rejects wrong lengths and excluded letters", () => {
    expect(isValidReservePub(RESERVE_PUB.slice(1))).toBe(false);
    expect(isValidReservePub(RESERVE_PUB + "A")).toBe(false);
    expect(isValidReservePub("I" + RESERVE_PUB.slice(1))).toBe(false);
    expect(isValidReservePub("L" + RESERVE_PUB.slice(1))).toBe(false);
    expect(isValidReservePub("O" + RESERVE_PUB.slice(1))).toBe(false);
    expect(isValidReservePub("U" + RESERVE_PUB.slice(1))).toBe(false);
    expect(isValidReservePub("")).toBe(false);
  });
});

describe("findReservePub", () => {
  it("finds the key in a noisy subject line", () => {
    expect(findReservePub(`Taler ${RESERVE_PUB} withdrawal`)).toBe(RESERVE_PUB);
    expect(findReservePub(`ref:${RESERVE_PUB}`)).toBe(RESERVE_PUB);
  });

  it("is case-insensitive on input", () => {
    expect(findReservePub(RESERVE_PUB.toLowerCase())).toBe(RESERVE_PUB);
  });

  it("returns undefined when no key is present", () => {
    expect(findReservePub("invoice 42")).toBeUndefined();
    expect(findReservePub(RESERVE_PUB.slice(0, 51))).toBeUndefined();
  });
});

describe("encodeTalerTopupQr", () => {
  it("produces a valid EPC069-12 payload carrying the reserve key", () => {
    const payload = encodeTalerTopupQr({ ...EXCHANGE, reservePub: RESERVE_PUB, amount: 50 });
    const { data, issues } = decodeEpcQr(payload);
    expect(issues).toHaveLength(0);
    expect(data.iban).toBe(EXCHANGE.iban);
    expect(data.name).toBe(EXCHANGE.accountName);
    expect(data.amount).toBe("50");
    expect(data.text).toBe(RESERVE_PUB);
  });

  it("supports open-amount QR codes", () => {
    const payload = encodeTalerTopupQr({ ...EXCHANGE, reservePub: RESERVE_PUB });
    const { data } = decodeEpcQr(payload);
    expect(data.amount).toBeUndefined();
    expect(data.text).toBe(RESERVE_PUB);
  });

  it("uppercases lowercase reserve keys", () => {
    const payload = encodeTalerTopupQr({ ...EXCHANGE, reservePub: RESERVE_PUB.toLowerCase() });
    expect(payload).toContain(RESERVE_PUB);
  });

  it("rejects malformed reserve keys", () => {
    expect(() => encodeTalerTopupQr({ ...EXCHANGE, reservePub: "not-a-key" })).toThrow(
      TalerTopupError,
    );
  });
});

describe("parseTalerTopupQr", () => {
  it("roundtrips", () => {
    const payload = encodeTalerTopupQr({
      ...EXCHANGE,
      bic: "BHBLDEHHXXX",
      reservePub: RESERVE_PUB,
      amount: "20.5",
    });
    const topup = parseTalerTopupQr(payload);
    expect(topup).toEqual({
      reservePub: RESERVE_PUB,
      iban: EXCHANGE.iban,
      accountName: EXCHANGE.accountName,
      bic: "BHBLDEHHXXX",
      amount: "20.5",
    });
  });

  it("rejects EPC payloads without a reserve key", () => {
    const plain = ["BCD", "002", "1", "SCT", "", "Someone", "BE72000000001616", "", "", "", "invoice 42"].join(
      "\n",
    );
    expect(() => parseTalerTopupQr(plain)).toThrow(TalerTopupError);
  });
});
