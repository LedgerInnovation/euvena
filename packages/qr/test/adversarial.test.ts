/**
 * Adversarial cases: hostile or ambiguous input that must never be accepted
 * silently, because these payloads carry money.
 */
import { describe, expect, it } from "vitest";
import {
  EpcQrError,
  isNonEeaSepaIban,
  MsctQrError,
  decodeEpcQr,
  decodeMsctQr,
  encodeEpcQr,
  encodeMsctPayeeClear,
  encodeMsctPayeeToken,
  encodeMsctPayerToken,
  isValidIban,
} from "../src/index.js";

const COMMON = { domain: "qr.example.org", providerId: "AB1", issuer: "XY9" };

describe("EPC069 delimiter injection", () => {
  const attacker = "\nDE89370400440532013000";

  it("rejects a line feed smuggled into the beneficiary name", () => {
    // Without this check the injected line shifts every following element,
    // so the bank app would display and credit the attacker's IBAN.
    expect(() => encodeEpcQr({ name: `Alice${attacker}`, iban: "BE72000000001616" })).toThrow(
      EpcQrError,
    );
  });

  it("rejects carriage returns and other control characters", () => {
    for (const hostile of ["Alice\r\nBob", "Alice\rBob", "Alice\u0000Bob", "Alice\u001fBob", "A\u0085B"]) {
      expect(() => encodeEpcQr({ name: hostile, iban: "BE72000000001616" })).toThrow(EpcQrError);
    }
  });

  it("rejects control characters in every free-text element", () => {
    const base = { name: "Alice", iban: "BE72000000001616" } as const;
    expect(() => encodeEpcQr({ ...base, text: "pay\nnow" })).toThrow(EpcQrError);
    expect(() => encodeEpcQr({ ...base, information: "note\nhere" })).toThrow(EpcQrError);
    expect(() => encodeEpcQr({ ...base, reference: "ref\nhere" })).toThrow(EpcQrError);
  });
});

describe("EPC069 invisible formatting characters", () => {
  it("rejects line and paragraph separators the way it rejects line feeds", () => {
    // The payload structure survives U+2028/U+2029, but most text displays
    // render them as line breaks, so a decoded value could visually push a
    // row of payment data out of place.
    for (const hostile of ["Alice\u2028Bob", "Alice\u2029Bob"]) {
      expect(() => encodeEpcQr({ name: hostile, iban: "BE72000000001616" })).toThrow(EpcQrError);
    }
  });

  it("rejects bidirectional formatting characters in every free-text element", () => {
    // These reorder what a reader sees without changing the bytes, so the
    // displayed payment data can read differently from what it says.
    const base = { name: "Alice", iban: "BE72000000001616" } as const;
    for (const bidi of ["\u061C", "\u200E", "\u200F", "\u202A", "\u202E", "\u2066", "\u2069"]) {
      expect(() => encodeEpcQr({ ...base, name: `Alice${bidi}Bob` })).toThrow(EpcQrError);
      expect(() => encodeEpcQr({ ...base, text: `pay${bidi}now` })).toThrow(EpcQrError);
      expect(() => encodeEpcQr({ ...base, information: `note${bidi}here` })).toThrow(EpcQrError);
    }
  });

  it("rejects them on decode, so a scanned code cannot carry them in", () => {
    const name = ["BCD", "002", "1", "SCT", "", "Alice\u202EBob", "BE72000000001616"].join("\n");
    expect(() => decodeEpcQr(name)).toThrow(EpcQrError);
    const text = [
      "BCD", "002", "1", "SCT", "", "Alice", "BE72000000001616", "", "", "", "pay\u2028now",
    ].join("\n");
    expect(() => decodeEpcQr(text)).toThrow(EpcQrError);
    const { issues } = decodeEpcQr(text, { strict: false });
    expect(issues.some((i) => /invisible formatting/.test(i.message))).toBe(true);
  });
});

describe("EPC069 structural strictness", () => {
  it("rejects charset segments that are not exactly one digit", () => {
    for (const charset of ["01", " 1", "1.0", "1e0", "+1", ""]) {
      const payload = ["BCD", "002", charset, "SCT", "", "Alice", "BE72000000001616"].join("\n");
      expect(() => decodeEpcQr(payload)).toThrow(EpcQrError);
    }
  });

  it("rejects unknown structural versions", () => {
    const payload = ["BCD", "003", "1", "SCT", "", "Alice", "BE72000000001616"].join("\n");
    expect(() => decodeEpcQr(payload)).toThrow(EpcQrError);
  });

  it("requires a BIC for non-EEA SEPA beneficiaries even in version 002", () => {
    // Swiss IBAN: still a SEPA scheme participant outside the EEA.
    expect(() => encodeEpcQr({ name: "Alice", iban: "CH9300762011623852957" })).toThrow(EpcQrError);
    try {
      encodeEpcQr({ name: "Alice", iban: "CH9300762011623852957" });
    } catch (error) {
      expect((error as EpcQrError).issues.some((i) => i.element === "bic")).toBe(true);
    }
    expect(() =>
      encodeEpcQr({ name: "Alice", iban: "CH9300762011623852957", bic: "POFICHBEXXX" }),
    ).not.toThrow();
    // EEA beneficiaries remain fine without one.
    expect(() => encodeEpcQr({ name: "Alice", iban: "BE72000000001616" })).not.toThrow();
  });
});

describe("IBAN registry", () => {
  it("rejects unregistered country codes even with valid check digits", () => {
    expect(isValidIban("ZZ93111111111111111111")).toBe(false);
    expect(() => encodeEpcQr({ name: "Alice", iban: "ZZ93111111111111111111" })).toThrow(EpcQrError);
  });

  it("still accepts registered countries", () => {
    expect(isValidIban("BE72000000001616")).toBe(true);
    expect(isValidIban("CH9300762011623852957")).toBe(true);
  });
});

describe("MSCT URL authority", () => {
  it("rejects credentials smuggled into the domain", () => {
    // "https://trusted.example@evil.example/..." is served by evil.example.
    expect(() =>
      encodeMsctPayeeToken({ ...COMMON, domain: "trusted.example@evil.example", context: "m", token: "t" }),
    ).toThrow(MsctQrError);
  });

  it("rejects paths, queries, fragments, ports and schemes in the domain", () => {
    for (const domain of [
      "good.example/../evil",
      "good.example?x=1",
      "good.example#f",
      "good.example:8443",
      "https://good.example",
      "good.example/",
      "",
      "-bad.example",
      "bad_underscore.example",
    ]) {
      expect(() =>
        encodeMsctPayeeToken({ ...COMMON, domain, context: "m", token: "t" }),
      ).toThrow(MsctQrError);
    }
  });

  it("rejects decoding a URL that carries credentials", () => {
    expect(() => decodeMsctQr("https://trusted.example@evil.example/1/m/AB1/?iss=XY9&tok=t")).toThrow(
      /credentials/,
    );
  });
});

describe("MSCT parameter naming", () => {
  it("rejects two fields mapped to the same parameter name", () => {
    expect(() =>
      encodeMsctPayeeClear({
        ...COMMON,
        context: "m",
        keys: { issuer: "x", iban: "x" },
        name: "Alice",
        iban: "BE72000000001616",
        instrument: "INST",
        amount: "1",
      }),
    ).toThrow(MsctQrError);
    try {
      encodeMsctPayeeClear({
        ...COMMON,
        context: "m",
        keys: { issuer: "x", iban: "x" },
        name: "Alice",
        iban: "BE72000000001616",
        instrument: "INST",
        amount: "1",
      });
    } catch (error) {
      expect((error as MsctQrError).issues.some((i) => /already used/.test(i.message))).toBe(true);
    }
  });

  it("rejects empty and non-URL-safe parameter names", () => {
    for (const name of ["", " ", "a b", "a&b", "a=b", "a#b"]) {
      expect(() =>
        encodeMsctPayeeToken({ ...COMMON, context: "m", token: "t", keys: { token: name } }),
      ).toThrow(MsctQrError);
    }
  });
});

describe("MSCT payload ambiguity", () => {
  it("rejects payloads carrying more than one profile selector", () => {
    const url =
      "https://qr.example.org/1/m/AB1/?iss=XY9&iban=BE72000000001616&nm=Alice&prx=%2B32123&tok=t" +
      "&ins=INST&cur=EUR&amt=1";
    expect(() => decodeMsctQr(url)).toThrow(/more than one profile/);
  });

  it("rejects duplicated recognized parameters", () => {
    const url =
      "https://qr.example.org/1/m/AB1/?iss=XY9&iban=BE72000000001616&nm=Alice&amt=1&amt=999" +
      "&ins=INST&cur=EUR";
    expect(() => decodeMsctQr(url)).toThrow(MsctQrError);
    const { issues } = decodeMsctQr(url, { strict: false });
    expect(issues.some((i) => /more than once/.test(i.message))).toBe(true);
  });
});

describe("MSCT version strictness", () => {
  it("rejects version segments that are not exactly \"1\"", () => {
    for (const seg of ["01", "1.0", " 1", "0", "v1"]) {
      expect(() => decodeMsctQr(`https://qr.example.org/${seg}/m/AB1/?iss=XY9&tok=t`)).toThrow(
        MsctQrError,
      );
    }
  });

  it("does not decode a future version with version 1 semantics", () => {
    expect(() => decodeMsctQr("https://qr.example.org/2/m/AB1/?iss=XY9&tok=t")).toThrow(MsctQrError);
    const { issues } = decodeMsctQr("https://qr.example.org/2/m/AB1/?iss=XY9&tok=t", {
      strict: false,
    });
    expect(issues.some((i) => /only version 1/.test(i.message))).toBe(true);
  });

  it("rejects encoding an undefined version", () => {
    expect(() =>
      encodeMsctPayerToken({ ...COMMON, version: 2, token: "t" }),
    ).toThrow(/version/);
  });
});

describe("MSCT control characters", () => {
  it("rejects control characters in free-text payment data", () => {
    expect(() =>
      encodeMsctPayeeClear({
        ...COMMON,
        context: "m",
        name: "Alice\nBob",
        iban: "BE72000000001616",
        instrument: "INST",
        amount: "1",
      }),
    ).toThrow(MsctQrError);
    expect(() => encodeMsctPayerToken({ ...COMMON, token: "t\u0000x" })).toThrow(MsctQrError);
  });
});

describe("MSCT decode authority policy", () => {
  it("rejects non-default ports instead of silently dropping them", () => {
    // The decoded `domain` reports only the hostname, so accepting a port
    // would misreport where the payload is served from.
    expect(() => decodeMsctQr("https://qr.example.org:444/1/m/AB1/?iss=XY9&tok=t")).toThrow(
      /port/,
    );
  });

  it("rejects malformed hostnames on decode", () => {
    expect(() => decodeMsctQr("https://-bad.example/1/m/AB1/?iss=XY9&tok=t")).toThrow(MsctQrError);
  });

  it("rejects fragments", () => {
    expect(() => decodeMsctQr("https://qr.example.org/1/m/AB1/?iss=XY9&tok=t#frag")).toThrow(
      /fragment/,
    );
  });
});

describe("MSCT decoded control characters", () => {
  it("rejects percent-encoded control characters in payload values", () => {
    const url = "https://qr.example.org/1/m/AB1/?iss=XY9&tok=a%0Ab";
    expect(() => decodeMsctQr(url)).toThrow(MsctQrError);
    const { issues } = decodeMsctQr(url, { strict: false });
    expect(issues.some((i) => /control characters/.test(i.message))).toBe(true);
  });
});

describe("MSCT invisible formatting characters", () => {
  it("rejects them in free-text payment data on encode", () => {
    expect(() =>
      encodeMsctPayeeClear({
        ...COMMON,
        context: "m",
        name: "Alice\u2028Bob",
        iban: "BE72000000001616",
        instrument: "INST",
        amount: "1",
      }),
    ).toThrow(MsctQrError);
  });

  it("rejects percent-encoded bidirectional characters on decode", () => {
    const url = "https://qr.example.org/1/m/AB1/?iss=XY9&tok=a%E2%80%AEb";
    expect(() => decodeMsctQr(url)).toThrow(MsctQrError);
    const { issues } = decodeMsctQr(url, { strict: false });
    expect(issues.some((i) => /invisible formatting/.test(i.message))).toBe(true);
  });
});

describe("MSCT context validation on encode", () => {
  it("rejects payee contexts outside the defined set", () => {
    expect(() =>
      encodeMsctPayeeToken({ ...COMMON, context: "x" as unknown as "m", token: "t" }),
    ).toThrow(MsctQrError);
  });

  it("rejects a payer type segment that would restructure the path", () => {
    expect(() => encodeMsctPayerToken({ ...COMMON, context: "", token: "t" })).toThrow(MsctQrError);
    expect(() => encodeMsctPayerToken({ ...COMMON, context: "a/b", token: "t" })).toThrow(
      MsctQrError,
    );
  });
});

describe("non-EEA SEPA country coverage", () => {
  it("covers the SEPA scheme countries outside the EEA", () => {
    for (const iban of [
      "AL47212110090000000235698741",
      "MD24AG000225100013104168",
      "ME25505000012345678951",
      "MK07250120000058984",
      "RS35260005601001611379",
      "GI75NWBK000000007099453",
      "CH9300762011623852957",
      "SM86U0322509800000000270100",
    ]) {
      expect(isNonEeaSepaIban(iban)).toBe(true);
      expect(() => encodeEpcQr({ name: "X", iban })).toThrow(EpcQrError);
    }
  });

  it("does not constrain EEA countries", () => {
    for (const iban of ["BE72000000001616", "DE71110220330123456789", "NO9386011117947"]) {
      expect(isNonEeaSepaIban(iban)).toBe(false);
    }
  });
});
