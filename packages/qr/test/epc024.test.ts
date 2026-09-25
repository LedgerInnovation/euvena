import { describe, expect, it } from "vitest";
import {
  MsctQrError,
  decodeMsctQr,
  encodeMsctPayeeClear,
  encodeMsctPayeeProxy,
  encodeMsctPayeeToken,
  encodeMsctPayerToken,
} from "../src/index.js";

const COMMON = { domain: "qr.example.org", providerId: "AB1", issuer: "XY9" };

describe("payee-presented MSCT QR codes", () => {
  it("builds the URL structure from EPC024-22 section 4.4", () => {
    const url = encodeMsctPayeeToken({ ...COMMON, context: "m", token: "t0k3n" });
    expect(url).toBe("https://qr.example.org/1/m/AB1/?iss=XY9&tok=t0k3n");
  });

  it("roundtrips a token payload", () => {
    const url = encodeMsctPayeeToken({ ...COMMON, context: "p", token: "abc123" });
    const { data } = decodeMsctQr(url);
    expect(data.kind).toBe("payee-token");
    if (data.kind === "payee-token") {
      expect(data.token).toBe("abc123");
      expect(data.context).toBe("p");
      expect(data.providerId).toBe("AB1");
      expect(data.issuer).toBe("XY9");
    }
  });

  it("roundtrips a proxy payload with transaction data", () => {
    const url = encodeMsctPayeeProxy({
      ...COMMON,
      context: "m",
      proxy: "+3212345678",
      instrument: "INST",
      mcc: "5812",
      amount: 24.5,
      remittance: "table 7",
    });
    const { data } = decodeMsctQr(url);
    expect(data.kind).toBe("payee-proxy");
    if (data.kind === "payee-proxy") {
      expect(data.proxy).toBe("+3212345678");
      expect(data.instrument).toBe("INST");
      expect(data.currency).toBe("EUR");
      expect(data.amount).toBe("24.5");
      expect(data.mcc).toBe("5812");
      expect(data.remittance).toBe("table 7");
    }
  });

  it("roundtrips an all-in-clear payload", () => {
    const url = encodeMsctPayeeClear({
      ...COMMON,
      context: "e",
      name: "Webshop BV",
      tradeName: "webshop.example",
      iban: "BE72000000001616",
      instrument: "SCT",
      amount: "12",
      reference: "RF18539007547034",
    });
    const { data } = decodeMsctQr(url);
    expect(data.kind).toBe("payee-clear");
    if (data.kind === "payee-clear") {
      expect(data.name).toBe("Webshop BV");
      expect(data.iban).toBe("BE72000000001616");
      expect(data.reference).toBe("RF18539007547034");
    }
  });

  it("supports custom parameter naming profiles", () => {
    const keys = { token: "payload", issuer: "src" };
    const url = encodeMsctPayeeToken({ ...COMMON, context: "m", token: "zz", keys });
    expect(url).toContain("payload=zz");
    const { data } = decodeMsctQr(url, { keys });
    expect(data.kind).toBe("payee-token");
  });

  it("rejects unknown payment contexts", () => {
    const url = "https://qr.example.org/1/z/AB1/?iss=XY9&tok=a";
    expect(() => decodeMsctQr(url)).toThrow(MsctQrError);
  });

  it("rejects a provider ID that is not 3 alphanumerics", () => {
    expect(() => encodeMsctPayeeToken({ ...COMMON, providerId: "TOOLONG", context: "m", token: "a" })).toThrow(
      MsctQrError,
    );
  });

  it("rejects invalid instruments", () => {
    expect(() =>
      encodeMsctPayeeClear({
        ...COMMON,
        context: "m",
        name: "X",
        iban: "BE72000000001616",
        // @ts-expect-error deliberately wrong
        instrument: "CARD",
        amount: "1",
      }),
    ).toThrow(MsctQrError);
  });

  it("rejects simultaneous structured and unstructured remittance", () => {
    expect(() =>
      encodeMsctPayeeProxy({
        ...COMMON,
        context: "m",
        proxy: "p",
        instrument: "INST",
        amount: "1",
        reference: "RF18539007547034",
        remittance: "both",
      }),
    ).toThrow(MsctQrError);
  });

  it("requires https", () => {
    expect(() => decodeMsctQr("http://qr.example.org/1/m/AB1/?iss=XY9&tok=a")).toThrow(/https/);
  });

  it("validates transaction fields of scanned URLs in strict mode", () => {
    const bad =
      "https://qr.example.org/1/m/AB1/?iss=XY9&iban=BE72000000001616&nm=Alice" +
      "&ins=CARD&mcc=12&pur=TOOLONG&cur=EURO&amt=0&rs=RF18539007547035";
    expect(() => decodeMsctQr(bad)).toThrow(MsctQrError);
    const { issues } = decodeMsctQr(bad, { strict: false });
    const fields = issues.map((i) => i.field);
    expect(fields).toContain("instrument");
    expect(fields).toContain("mcc");
    expect(fields).toContain("purpose");
    expect(fields).toContain("currency");
    expect(fields).toContain("amount");
    expect(fields).toContain("reference");
  });

  it("rejects simultaneous remittance fields on scanned URLs", () => {
    const bad =
      "https://qr.example.org/1/m/AB1/?iss=XY9&prx=p&ins=INST&cur=EUR&amt=1&rs=INV-1&ru=also";
    const { issues } = decodeMsctQr(bad, { strict: false });
    expect(issues.some((i) => i.message.includes("mutually exclusive"))).toBe(true);
  });

  it("validates name lengths of scanned clear-profile URLs", () => {
    const bad =
      "https://qr.example.org/1/m/AB1/?iss=XY9&iban=BE72000000001616" +
      `&nm=Alice&tn=${"t".repeat(36)}&ins=INST&cur=EUR&amt=1`;
    const { issues } = decodeMsctQr(bad, { strict: false });
    expect(issues.some((i) => i.field === "tradeName")).toBe(true);
  });
});

describe("MSCT domains", () => {
  it("refuses a host the URL parser would read as an IP address, as a domain issue", () => {
    // "shop.1" and "a.0x" are what a user passes through while typing
    // "shop.1und1.de"; the parser throws on them. "123" and "0x7f.1" parse,
    // as 0.0.0.123 and 127.0.0.1, so the code would point somewhere else.
    for (const domain of [
      "shop.1",
      "a.0x",
      "123",
      "0x7f.1",
      "10.0.0.300",
      "192.168.1.1",
      // Punycode, which parsers read differently.
      "xn--a.example",
      "qr.xn--p1ai",
    ]) {
      let caught: unknown;
      try {
        encodeMsctPayeeToken({ ...COMMON, domain, context: "p", token: "x" });
      } catch (error) {
        caught = error;
      }
      expect(caught, domain).toBeInstanceOf(MsctQrError);
      expect((caught as MsctQrError).issues.map((issue) => issue.field), domain).toEqual(["domain"]);
    }
  });

  it("keeps domain names whose labels merely start with digits", () => {
    for (const domain of [
      "shop.1und1.de",
      "api.24pay.eu",
      "0x.example.org",
      "1.example.org",
      "a--b.example.org",
      "qr-x--y.example.org",
    ]) {
      const url = encodeMsctPayeeToken({ ...COMMON, domain, context: "p", token: "x" });
      expect(decodeMsctQr(url).data.domain).toBe(domain);
    }
  });

  it("refuses to read a code served from an IP address", () => {
    expect(() => decodeMsctQr("https://127.0.0.1/1/p/AB1/?iss=XY9&tok=x")).toThrow(MsctQrError);
    expect(() => decodeMsctQr("https://0x7f.1/1/p/AB1/?iss=XY9&tok=x")).toThrow(MsctQrError);
    expect(() => decodeMsctQr("https://xn--a.example/1/p/AB1/?iss=XY9&tok=x")).toThrow(MsctQrError);
  });
});

describe("payer-presented MSCT QR codes", () => {
  it("roundtrips a payer token with the reserved type segment", () => {
    const url = encodeMsctPayerToken({ ...COMMON, token: "payer-token", valueAddedServices: "loyalty:1" });
    expect(url).toBe("https://qr.example.org/1/0/AB1/?iss=XY9&tok=payer-token&vas=loyalty%3A1");
    const { data } = decodeMsctQr(url, { presenter: "payer" });
    expect(data.kind).toBe("payer-token");
    if (data.kind === "payer-token") {
      expect(data.token).toBe("payer-token");
      expect(data.valueAddedServices).toBe("loyalty:1");
    }
  });

  it("limits payer tokens to 70 characters", () => {
    expect(() => encodeMsctPayerToken({ ...COMMON, token: "x".repeat(71) })).toThrow(MsctQrError);
  });

  it("rejects empty optional fields on encode so output always decodes", () => {
    expect(() => encodeMsctPayerToken({ ...COMMON, token: "t", valueAddedServices: "" })).toThrow(
      MsctQrError,
    );
    expect(() =>
      encodeMsctPayeeClear({
        ...COMMON,
        context: "m",
        name: "Alice",
        iban: "BE72000000001616",
        instrument: "INST",
        amount: "1",
        tradeName: "",
      }),
    ).toThrow(MsctQrError);
    expect(() =>
      encodeMsctPayeeProxy({
        ...COMMON,
        context: "m",
        proxy: "p",
        instrument: "INST",
        amount: "1",
        remittance: "",
      }),
    ).toThrow(MsctQrError);
  });

  it("rejects oversized value-added services data on scanned payer URLs", () => {
    const bad = `https://qr.example.org/1/0/AB1/?iss=XY9&tok=t&vas=${"v".repeat(71)}`;
    expect(() => decodeMsctQr(bad, { presenter: "payer" })).toThrow(MsctQrError);
    const { issues } = decodeMsctQr(bad, { presenter: "payer", strict: false });
    expect(issues.some((i) => i.field === "valueAddedServices")).toBe(true);
  });

  it("rejects empty identifiers on scanned URLs in strict mode", () => {
    expect(() => decodeMsctQr("https://qr.example.org/1/m/AB1/?iss=XY9&tok=")).toThrow(MsctQrError);
    expect(() =>
      decodeMsctQr("https://qr.example.org/1/0/AB1/?iss=XY9&tok=", { presenter: "payer" }),
    ).toThrow(MsctQrError);
    const { issues } = decodeMsctQr(
      "https://qr.example.org/1/m/AB1/?iss=XY9&prx=&ins=INST&cur=EUR&amt=1",
      { strict: false },
    );
    expect(issues.some((i) => i.field === "proxy")).toBe(true);
  });
});
