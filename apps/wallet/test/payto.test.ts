import { describe, expect, it } from "vitest";

import { buildPaytoUri, handoffFields, parsePaytoUri } from "../src/epc/payto";
import { buildPaymentRequest, type Payee, type RequestForm } from "../src/epc/request";
import { readPastedRequest, readPaymentRequest } from "../src/epc/scan";

const payee: Payee = {
  name: "Wikimedia Foerdergesellschaft",
  iban: "DE33 1002 0500 0001 1947 00",
  bic: "",
};

/** Decoded data the way the review screen holds it, via the real builder. */
function dataFor(form: RequestForm, withPayee: Payee = payee) {
  const request = buildPaymentRequest(withPayee, form);
  if (!request.ok) throw new Error(`the form did not build: ${JSON.stringify(request.issues)}`);
  return request.data;
}

describe("buildPaytoUri", () => {
  it("maps a full request onto RFC 8905", () => {
    const data = dataFor({
      amount: "13,05",
      remittanceKind: "text",
      remittance: "Spende fuer Wikipedia",
    });

    expect(buildPaytoUri(data)).toBe(
      "payto://iban/DE33100205000001194700" +
        "?amount=EUR:13.05" +
        "&receiver-name=Wikimedia%20Foerdergesellschaft" +
        "&message=Spende%20fuer%20Wikipedia",
    );
  });

  it("leaves the amount out when the payer decides it", () => {
    const data = dataFor({ amount: "", remittanceKind: "text", remittance: "" });

    const uri = buildPaytoUri(data);

    expect(uri).not.toContain("amount=");
    expect(uri).not.toContain("message=");
    expect(uri).toContain("receiver-name=");
  });

  it("never emits a structured reference, which payto cannot carry", () => {
    // RFC 8905 section 7.3: "message" is the unstructured remittance
    // information and "instruction" is the end-to-end identifier. Neither is
    // the structured creditor reference, so emitting it through either would
    // silently downgrade it and reconciliation could miss it.
    const data = dataFor({
      amount: "10",
      remittanceKind: "reference",
      remittance: "RF18539007547034",
    });

    const uri = buildPaytoUri(data);

    expect(uri).not.toContain("RF18539007547034");
    expect(uri).not.toContain("message=");
    expect(uri).not.toContain("instruction=");
  });

  it("puts the BIC ahead of the IBAN in the path", () => {
    const data = dataFor(
      { amount: "5", remittanceKind: "text", remittance: "" },
      { ...payee, bic: "BFSWDE33BER" },
    );

    expect(buildPaytoUri(data)).toContain("payto://iban/BFSWDE33BER/DE33100205000001194700?");
  });

  it("percent encodes characters that would restructure the URI", () => {
    const data = dataFor({
      amount: "5",
      remittanceKind: "text",
      remittance: "Rechnung 44 & 45 = bezahlt",
    });

    const uri = buildPaytoUri(data);

    expect(uri).toContain("message=Rechnung%2044%20%26%2045%20%3D%20bezahlt");
  });
});

describe("handoffFields", () => {
  it("offers the raw values a transfer form expects", () => {
    const data = dataFor({
      amount: "13,05",
      remittanceKind: "reference",
      remittance: "RF18539007547034",
    });

    expect(handoffFields(data)).toEqual([
      { label: "Name", value: "Wikimedia Foerdergesellschaft" },
      { label: "IBAN", value: "DE33100205000001194700" },
      { label: "Amount", value: "13.05" },
      { label: "Reference", value: "RF18539007547034" },
    ]);
  });

  it("adds the BIC row only when the payload carries one", () => {
    const data = dataFor(
      { amount: "", remittanceKind: "text", remittance: "" },
      { ...payee, bic: "BFSWDE33BER" },
    );

    const labels = handoffFields(data).map((field) => field.label);

    expect(labels).toContain("BIC");
    expect(labels).not.toContain("Amount");
    expect(labels).not.toContain("Text");
  });
});

const IBAN = "DE33100205000001194700";
const NAME = "receiver-name=Wikimedia%20Foerdergesellschaft";

/** Reads a payto URI the way the paste entry does and returns the rejection reason. */
function reasonFor(uri: string): string {
  const read = readPastedRequest(uri);
  if (read.ok) throw new Error(`expected a rejection for ${uri}`);
  return read.reason;
}

describe("reading a payto link", () => {
  it("round-trips every request the handoff emits", () => {
    for (const [form, withPayee] of [
      [{ amount: "13,05", remittanceKind: "text", remittance: "Spende fuer Wikipedia" }, payee],
      [{ amount: "", remittanceKind: "text", remittance: "" }, payee],
      [{ amount: "12,3", remittanceKind: "text", remittance: "A+B & C = 100%" }, payee],
      [{ amount: "5", remittanceKind: "text", remittance: "" }, { ...payee, bic: "BFSWDE33BER" }],
    ] as const) {
      const data = dataFor(form, withPayee);

      const read = readPaymentRequest(buildPaytoUri(data));

      expect(read.ok).toBe(true);
      if (!read.ok) return;
      expect(read.data).toEqual(data);
    }
  });

  it("reads the RFC 8905 example once it names a beneficiary", () => {
    const read = readPastedRequest(
      "payto://iban/DE75512108001245126199?amount=EUR:200.0&message=hello&receiver-name=Alice",
    );

    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.data).toMatchObject({
      name: "Alice",
      iban: "DE75512108001245126199",
      amount: "200.0",
      text: "hello",
    });
    expect(read.data.reference).toBeUndefined();
  });

  it("reads the scheme, target type and currency without regard to case", () => {
    const read = readPastedRequest(`  PAYTO://IBAN/${IBAN}?amount=eur:1000.5&receiver-name=Alice  `);

    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.data.amount).toBe("1000.5");
  });

  it("matches option names exactly, as the GNU Taler wallet does", () => {
    // That wallet would skip "AMOUNT" and pay nothing fixed, or pay "amount".
    for (const query of [`${NAME}&AMOUNT=EUR:1000`, "Receiver-Name=Mallory"]) {
      expect(reasonFor(`payto://iban/${IBAN}?${query}`)).toBe(
        "the payto link carries an option this wallet does not know",
      );
    }
  });

  it("keeps digits past the cent only when they are zeros", () => {
    expect(parsePaytoUri(`payto://iban/${IBAN}?${NAME}&amount=EUR:10.50000000`)).toMatchObject({
      ok: true,
      request: { amount: "10.50" },
    });
    expect(reasonFor(`payto://iban/${IBAN}?${NAME}&amount=EUR:10.505`)).toBe(
      "the payto link carries an amount this wallet cannot use",
    );
    expect(reasonFor(`payto://iban/${IBAN}?${NAME}&amount=EUR:10.000000000`)).toBe(
      "the payto link carries an amount this wallet cannot use",
    );
  });

  it("strips leading zeros instead of counting them against the digit limit", () => {
    expect(parsePaytoUri(`payto://iban/${IBAN}?${NAME}&amount=EUR:0000000000012`)).toMatchObject({
      ok: true,
      request: { amount: "12" },
    });
  });

  it("refuses amounts a transfer cannot carry", () => {
    for (const amount of [
      "EUR:",
      "EUR:.5",
      "EUR:10.",
      "EUR:1:2",
      "EUR:-5",
      "EUR:0",
      "EUR:0.001",
      "EUR:1000000000",
      "10",
    ]) {
      expect(reasonFor(`payto://iban/${IBAN}?${NAME}&amount=${amount}`)).toBe(
        "the payto link carries an amount this wallet cannot use",
      );
    }
  });

  it("refuses any comma rather than guessing which way it separates", () => {
    // RFC 8905 says to ignore commas, which would pay a decimal comma as a
    // hundredfold sum and "1.500,00" as 1.50.
    for (const amount of ["EUR:12,50", "EUR:1%2C50", "EUR:1,000.50", "EUR:1.500,00", "EUR:,"]) {
      expect(reasonFor(`payto://iban/${IBAN}?${NAME}&amount=${amount}`)).toBe(
        "the payto link carries an amount this wallet cannot use",
      );
    }
  });

  it("refuses another currency", () => {
    expect(reasonFor(`payto://iban/${IBAN}?${NAME}&amount=CHF:10`)).toBe(
      "the payto link asks for a currency other than euro",
    );
  });

  it("refuses an option given twice", () => {
    // Two readers resolving the repeat differently would pay different sums.
    expect(reasonFor(`payto://iban/${IBAN}?${NAME}&amount=EUR:1&amount=EUR:1000`)).toBe(
      "the payto link repeats an option",
    );
    expect(reasonFor(`payto://iban/${IBAN}?${NAME}&receiver-name=Mallory`)).toBe(
      "the payto link repeats an option",
    );
  });

  it("refuses an end-to-end identifier rather than dropping it", () => {
    expect(reasonFor(`payto://iban/${IBAN}?${NAME}&instruction=E2E-4711`)).toBe(
      "the payto link carries an end-to-end identifier, which this wallet cannot pass on",
    );
  });

  it("refuses options it does not know rather than dropping what they mean", () => {
    for (const option of [
      "reference=RF18539007547034",
      "ch-qrr=210000000003139471430009017",
      "bic=BFSWDE33BER",
    ]) {
      expect(reasonFor(`payto://iban/${IBAN}?${NAME}&${option}`)).toBe(
        "the payto link carries an option this wallet does not know",
      );
    }
  });

  it("ignores the payer's name and the creditor address the Taler wallets add", () => {
    const read = readPastedRequest(
      `payto://iban/${IBAN}?${NAME}&sender-name=Bob&receiver-postal-code=8000&receiver-town=Z%C3%BCrich`,
    );

    expect(read.ok).toBe(true);
  });

  it("reads a Taler exchange account, trailing slash included", () => {
    // taler-exchange.conf(5) publishes accounts in this form. The Taler
    // wallet keeps the slash when it adds the amount and the subject.
    for (const uri of [
      "payto://iban/GENODEF1SLR/DE67830654080004822650/?receiver-name=Exchange",
      "payto://iban/DE67830654080004822650/?receiver-name=Exchange&amount=EUR:10&message=RESERVE",
    ]) {
      const read = readPastedRequest(uri);

      expect(read.ok).toBe(true);
      if (!read.ok) return;
      expect(read.data.iban).toBe("DE67830654080004822650");
    }
  });

  it("requires a beneficiary name", () => {
    for (const query of ["", "?amount=EUR:5", "?receiver-name="]) {
      expect(reasonFor(`payto://iban/${IBAN}${query}`)).toBe(
        "the payto link names no beneficiary",
      );
    }
  });

  it("refuses a name that shows nothing", () => {
    for (const name of ["+%20", "%E2%80%8B", "%20%E2%80%8B%EF%BB%BF%20"]) {
      expect(reasonFor(`payto://iban/${IBAN}?receiver-name=${name}&amount=EUR:5`)).toBe(
        "the payto link is not a valid payment request: the beneficiary name failed the checks",
      );
    }
  });

  it("carries the message as text and never as a structured reference", () => {
    const read = readPastedRequest(`payto://iban/${IBAN}?${NAME}&message=RF18539007547034`);

    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.data.text).toBe("RF18539007547034");
    expect(read.data.reference).toBeUndefined();
  });

  it("refuses other account types", () => {
    for (const uri of [
      "payto://upi/alice@example.com?receiver-name=Alice&amount=INR:200",
      "payto://x-taler-bank/bank.example.com/alice?receiver-name=Alice",
      `payto://user@iban/${IBAN}?${NAME}`,
      `payto://iban:443/${IBAN}?${NAME}`,
      `payto://ibanx/${IBAN}?${NAME}`,
    ]) {
      expect(reasonFor(uri)).toBe("the payto link is for an account type other than an IBAN");
    }
  });

  it("refuses a malformed structure", () => {
    for (const uri of [
      "payto://iban",
      "payto://iban/",
      `payto://iban//${IBAN}?${NAME}`,
      `payto://iban/${IBAN}//?${NAME}`,
      `payto://iban//?${NAME}`,
      `payto://iban/BFSWDE33BER/${IBAN}/extra?${NAME}`,
      `payto://iban/${IBAN}?${NAME}#amount=EUR:1000`,
      `payto://iban/${IBAN}?`,
      `payto://iban/${IBAN}?${NAME}&amount`,
      `payto://iban/${IBAN}?${NAME}&=x`,
      `payto://iban/${IBAN}?${NAME}&&amount=EUR:1`,
      `payto://iban/DE33%201002%200500%200001%201947%2000?${NAME}`,
      `payto://iban/DE33%0A100205000001194700?${NAME}`,
    ]) {
      expect(reasonFor(uri)).toBe("the payto link is malformed");
    }
  });

  it("refuses a damaged escape rather than throwing", () => {
    expect(reasonFor(`payto://iban/${IBAN}?receiver-name=Alice%E2%82`)).toBe(
      "the payto link is damaged and cannot be read",
    );
    expect(reasonFor(`payto://iban/${IBAN}%ZZ?${NAME}`)).toBe(
      "the payto link is damaged and cannot be read",
    );
  });

  it("reads a raw plus as a space and an escaped one as a plus", () => {
    const read = readPastedRequest(`payto://iban/${IBAN}?receiver-name=Alice+Smith&message=1%2B1`);

    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.data.name).toBe("Alice Smith");
    expect(read.data.text).toBe("1+1");
  });

  it("names the failed element without repeating the input", () => {
    const reason = reasonFor(`payto://iban/DE33100205000001194799?${NAME}`);
    expect(reason).toBe("the payto link is not a valid payment request: the IBAN failed the checks");

    const smuggled = reasonFor(
      `payto://iban/${IBAN}?receiver-name=Alice%0A${IBAN}&message=Ev%E2%80%AEil`,
    );
    expect(smuggled).toBe(
      "the payto link is not a valid payment request: the beneficiary name and the remittance text failed the checks",
    );
  });

  it("holds values to the limits a code has", () => {
    expect(reasonFor(`payto://iban/${IBAN}?receiver-name=${"n".repeat(71)}`)).toContain(
      "the beneficiary name",
    );
    expect(reasonFor(`payto://iban/${IBAN}?${NAME}&message=${"t".repeat(141)}`)).toContain(
      "the remittance text",
    );
    expect(reasonFor(`payto://iban/CH9300762011623852957?${NAME}`)).toContain("the BIC");
  });

  it("says so when the values fit one by one but not together", () => {
    // 70 and 140 characters are within the element limits, yet at three bytes
    // each they overrun the 331 bytes of a code.
    const name = encodeURIComponent("\u6771".repeat(70));
    const message = encodeURIComponent("\u4EAC".repeat(140));

    expect(reasonFor(`payto://iban/${IBAN}?receiver-name=${name}&message=${message}`)).toBe(
      "the payto link carries more text than a payment code can hold",
    );
    // A failed element is still named, even when the size is over as well.
    expect(
      reasonFor(`payto://iban/DE33100205000001194799?receiver-name=${name}&message=${message}`),
    ).toBe("the payto link is not a valid payment request: the IBAN failed the checks");
  });

  it("reads a name with characters beyond the basic plane", () => {
    const name = "Caf\u00E9 \u{1F600} \u{20BB7}\u91CE";
    const read = readPastedRequest(
      `payto://iban/${IBAN}?receiver-name=${encodeURIComponent(name)}`,
    );

    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.data.name).toBe(name);
  });

  it("refuses half a surrogate pair, which no code can carry", () => {
    expect(reasonFor(`payto://iban/${IBAN}?receiver-name=\uDB40`)).toBe(
      "the payto link is not a valid payment request: the beneficiary name failed the checks",
    );
    expect(reasonFor(`payto://iban/${IBAN}?${NAME}&message=pay\uD800now`)).toBe(
      "the payto link is not a valid payment request: the remittance text failed the checks",
    );
  });

  it("reads a very long link quickly", () => {
    const long = `payto://iban/${IBAN}?${NAME}&message=${"%0A".repeat(100_000)}x`;

    expect(reasonFor(long)).toContain("the remittance text");
  });
});
