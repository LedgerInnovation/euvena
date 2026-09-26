import { describe, expect, it } from "vitest";

import {
  PaytoError,
  decodePaytoUri,
  decodeEpcQr,
  encodeEpcQr,
  encodePaytoUri,
  isPaytoUri,
} from "../src/index.js";

const IBAN = "DE33100205000001194700";
const NAME = "receiver-name=Wikimedia%20Foerdergesellschaft";

function codeOf(uri: string): string {
  try {
    decodePaytoUri(uri);
  } catch (error) {
    if (error instanceof PaytoError) return error.code;
    throw error;
  }
  return "ok";
}

describe("encodePaytoUri", () => {
  it("maps a request onto RFC 8905 section 7.3", () => {
    expect(
      encodePaytoUri({
        name: "Wikimedia Foerdergesellschaft",
        iban: "DE33 1002 0500 0001 1947 00",
        amount: 13.05,
        text: "Spende fuer Wikipedia",
      }),
    ).toBe(`payto://iban/${IBAN}?amount=EUR:13.05&${NAME}&message=Spende%20fuer%20Wikipedia`);
  });

  it("puts the BIC ahead of the IBAN and leaves out what is absent", () => {
    expect(encodePaytoUri({ name: "A", iban: IBAN, bic: "bfswde33ber" })).toBe(
      `payto://iban/BFSWDE33BER/${IBAN}?receiver-name=A`,
    );
  });

  it("escapes what would restructure the URI and keeps a literal plus", () => {
    const uri = encodePaytoUri({
      name: "A&B=C",
      iban: IBAN,
      text: "1+1 #2 ?x",
    });
    expect(uri).toBe(`payto://iban/${IBAN}?receiver-name=A%26B%3DC&message=1%2B1%20%232%20%3Fx`);
    expect(decodePaytoUri(uri)).toEqual({
      name: "A&B=C",
      iban: IBAN,
      text: "1+1 #2 ?x",
    });
  });

  it("refuses a structured reference unless told to leave it out", () => {
    const input = { name: "A", iban: IBAN, reference: "RF18539007547034" };
    expect(() => encodePaytoUri(input)).toThrow(PaytoError);
    try {
      encodePaytoUri(input);
    } catch (error) {
      expect((error as PaytoError).code).toBe("invalid");
      expect((error as PaytoError).issues.map((issue) => issue.element)).toEqual(["reference"]);
    }
    expect(encodePaytoUri(input, { omitReference: true })).toBe(
      `payto://iban/${IBAN}?receiver-name=A`,
    );
  });

  it("holds every element to the EPC069-12 checks", () => {
    const failed = (input: Parameters<typeof encodePaytoUri>[0]) => {
      try {
        encodePaytoUri(input);
      } catch (error) {
        return (error as PaytoError).issues.map((issue) => issue.element);
      }
      return [];
    };
    expect(failed({ name: "A", iban: "DE33100205000001194799" })).toEqual(["iban"]);
    expect(failed({ name: "A", iban: IBAN, bic: "NOTABIC" })).toEqual(["bic"]);
    expect(failed({ name: "​", iban: IBAN })).toEqual(["name"]);
    expect(failed({ name: `A\n${IBAN}`, iban: IBAN })).toEqual(["name"]);
    expect(failed({ name: "A", iban: IBAN, amount: 0 })).toEqual(["amount"]);
    expect(failed({ name: "A", iban: IBAN, amount: "12,50" })).toEqual(["amount"]);
    expect(failed({ name: "A", iban: IBAN, text: "t".repeat(141) })).toEqual(["text"]);
    // A non-EEA SEPA account needs its BIC, as in a code.
    expect(failed({ name: "A", iban: "CH9300762011623852957" })).toEqual(["bic"]);
  });
});

describe("decodePaytoUri", () => {
  it("returns elements encodeEpcQr takes as they are", () => {
    const transfer = decodePaytoUri(
      `payto://iban/${IBAN}?amount=EUR:13.05&${NAME}&message=Spende%20fuer%20Wikipedia`,
    );
    const { data } = decodeEpcQr(encodeEpcQr(transfer));
    expect(data).toMatchObject({ ...transfer, version: "002", charset: 1 });
  });

  it("round-trips what encodePaytoUri writes", () => {
    for (const input of [
      { name: "Alice", iban: IBAN },
      {
        name: "Alice",
        iban: IBAN,
        bic: "BFSWDE33BER",
        amount: "999999999.99",
        text: "Café \u{1F600}",
      },
    ]) {
      expect(decodePaytoUri(encodePaytoUri(input))).toEqual(input);
    }
  });

  it("reads the scheme, target type and currency without case, option names with it", () => {
    expect(decodePaytoUri(`PAYTO://IBAN/${IBAN}?${NAME}&amount=eur:5`).amount).toBe("5");
    expect(codeOf(`payto://iban/${IBAN}?${NAME}&AMOUNT=EUR:5`)).toBe("unknown-option");
  });

  it("canonicalises the amount without rounding it", () => {
    expect(decodePaytoUri(`payto://iban/${IBAN}?${NAME}&amount=EUR:0012.50000000`).amount).toBe(
      "12.50",
    );
    for (const amount of [
      "EUR:12.501",
      "EUR:12,50",
      "EUR:1,250",
      "EUR:",
      "EUR:.5",
      "EUR:5.",
      "12.50",
      "EUR:0",
      "EUR:1000000000",
    ]) {
      expect(codeOf(`payto://iban/${IBAN}?${NAME}&amount=${amount}`)).toBe("amount");
    }
    expect(codeOf(`payto://iban/${IBAN}?${NAME}&amount=CHF:5`)).toBe("currency");
  });

  it("names why a URI is refused", () => {
    const cases: [string, string][] = [
      ["https://example.com", "not-payto"],
      [`payto://upi/alice@example.com?${NAME}`, "not-iban"],
      [`payto://user@iban/${IBAN}?${NAME}`, "not-iban"],
      ["payto://iban/", "malformed"],
      [`payto://iban/${IBAN}?${NAME}#amount=EUR:1000`, "malformed"],
      [`payto://iban/${IBAN}?${NAME}&amount`, "malformed"],
      [`payto://iban/DE33%0A100205000001194700?${NAME}`, "malformed"],
      [`payto://iban/${IBAN}?receiver-name=Alice%E2%82`, "damaged"],
      [`payto://iban/${IBAN}?${NAME}&${NAME}`, "repeated-option"],
      [`payto://iban/${IBAN}?${NAME}&instruction=E2E1`, "instruction"],
      [`payto://iban/${IBAN}?${NAME}&ch-qrr=210000000003139471430009017`, "unknown-option"],
      [`payto://iban/${IBAN}?amount=EUR:5`, "no-name"],
      [`payto://iban/${IBAN}?receiver-name=`, "no-name"],
      [`payto://iban/DE33100205000001194799?${NAME}`, "invalid"],
    ];
    for (const [uri, code] of cases) expect([uri, codeOf(uri)]).toEqual([uri, code]);
  });

  it("never repeats the input in its message", () => {
    try {
      decodePaytoUri(`payto://iban/${IBAN}?receiver-name=Evil&instruction=secret`);
    } catch (error) {
      expect((error as Error).message).not.toContain("secret");
    }
  });

  it("ignores the payer name and the creditor address, and one trailing slash", () => {
    expect(
      decodePaytoUri(
        `payto://iban/${IBAN}/?${NAME}&sender-name=Bob&receiver-postal-code=1&receiver-town=X`,
      ),
    ).toEqual({ name: "Wikimedia Foerdergesellschaft", iban: IBAN });
  });

  it("reads a raw plus as a space", () => {
    expect(decodePaytoUri(`payto://iban/${IBAN}?receiver-name=A+B&message=1%2B1`)).toEqual({
      name: "A B",
      iban: IBAN,
      text: "1+1",
    });
  });
});

describe("isPaytoUri", () => {
  it("checks the scheme without case", () => {
    expect(isPaytoUri("PayTo://iban/x")).toBe(true);
    expect(isPaytoUri("payto:iban/x")).toBe(false);
    expect(isPaytoUri(" payto://iban/x")).toBe(false);
  });
});
