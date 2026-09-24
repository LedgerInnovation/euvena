import { describe, expect, it } from "vitest";

import { EMPTY_PAYEE, type Payee } from "../src/epc/request";
import {
  EMPTY_BOOK,
  PAYEE_LIMIT,
  activePayee,
  parsePayee,
  parsePayeeBook,
  removePayeeAt,
  savePayeeAt,
  serializePayee,
  serializePayeeBook,
  setActivePayee,
  type PayeeBook,
} from "../src/settings/payee";

const payee: Payee = {
  name: "Wikimedia Foerdergesellschaft",
  iban: "DE33100205000001194700",
  bic: "BFSWDE33MUE",
};

const club: Payee = { name: "Chess Club", iban: "FR7630006000011234567890189", bic: "" };
const shop: Payee = { name: "Corner Shop", iban: "NL91ABNA0417164300", bic: "" };

const book: PayeeBook = { payees: [payee, club, shop], active: 1 };

describe("payee settings", () => {
  it("round-trips", () => {
    expect(parsePayee(serializePayee(payee))).toEqual(payee);
  });

  it("returns empty fields when nothing is stored", () => {
    expect(parsePayee(null)).toEqual(EMPTY_PAYEE);
  });

  it("falls back to empty fields rather than trusting a damaged value", () => {
    for (const stored of ["", "{", "null", '"a string"', "[]", "42"]) {
      expect(parsePayee(stored)).toEqual(EMPTY_PAYEE);
    }
  });

  it("drops fields of the wrong type and keeps the rest", () => {
    expect(parsePayee('{"name":"Acme","iban":42}')).toEqual({
      name: "Acme",
      iban: "",
      bic: "",
    });
  });

  it("stores only the fields it knows", () => {
    expect(JSON.parse(serializePayee({ ...payee, extra: true } as Payee))).toEqual(payee);
  });
});

describe("payee book", () => {
  it("round-trips", () => {
    expect(parsePayeeBook(serializePayeeBook(book))).toEqual(book);
  });

  it("starts empty", () => {
    expect(parsePayeeBook(null)).toEqual(EMPTY_BOOK);
    expect(activePayee(EMPTY_BOOK)).toEqual(EMPTY_PAYEE);
  });

  it("reads a single payee written by an earlier version as a book of one", () => {
    expect(parsePayeeBook(serializePayee(payee))).toEqual({ payees: [payee], active: 0 });
  });

  it("reads a single payee without an IBAN as an empty book", () => {
    expect(parsePayeeBook(serializePayee(EMPTY_PAYEE))).toEqual(EMPTY_BOOK);
    expect(parsePayeeBook(serializePayee({ ...payee, iban: "" }))).toEqual(EMPTY_BOOK);
  });

  it("drops a listed payee without an IBAN", () => {
    const stored = JSON.stringify({ payees: [{ ...payee, iban: "" }, {}, club], active: 2 });
    expect(parsePayeeBook(stored)).toEqual({ payees: [club], active: 0 });
  });

  it("falls back to an empty book rather than trusting a damaged value", () => {
    for (const stored of ["", "{", "null", '"a string"', "[]", "42", '{"payees":"x"}']) {
      expect(parsePayeeBook(stored)).toEqual(EMPTY_BOOK);
    }
  });

  it("keeps the active payee when malformed entries before it are dropped", () => {
    const stored = JSON.stringify({ payees: [7, payee, null, club, shop], active: 3 });
    expect(parsePayeeBook(stored)).toEqual({ payees: [payee, club, shop], active: 1 });
    const gone = JSON.stringify({ payees: [payee, { ...club, iban: "" }, shop], active: 1 });
    expect(parsePayeeBook(gone)).toEqual({ payees: [payee, shop], active: 0 });
  });

  it("drops malformed payees and falls back when the active index points at nothing", () => {
    const stored = JSON.stringify({ payees: [payee, 7, null, club], active: 9 });
    expect(parsePayeeBook(stored)).toEqual({ payees: [payee, club], active: 0 });
    expect(parsePayeeBook(JSON.stringify({ payees: [payee, club], active: 2 }))).toEqual({
      payees: [payee, club],
      active: 0,
    });
    expect(parsePayeeBook(JSON.stringify({ payees: [payee], active: -3 }))).toEqual({
      payees: [payee],
      active: 0,
    });
    expect(parsePayeeBook(JSON.stringify({ payees: [payee], active: "1" }))).toEqual({
      payees: [payee],
      active: 0,
    });
  });

  it("caps a stored book at the limit", () => {
    const payees = Array.from({ length: PAYEE_LIMIT + 3 }, (_, i) => ({ ...club, name: `${i}` }));
    const last = parsePayeeBook(JSON.stringify({ payees, active: PAYEE_LIMIT - 1 }));
    expect(last.payees).toHaveLength(PAYEE_LIMIT);
    expect(last.active).toBe(PAYEE_LIMIT - 1);
    // An active entry beyond the limit is cut, so the book falls back.
    expect(parsePayeeBook(JSON.stringify({ payees, active: PAYEE_LIMIT })).active).toBe(0);
  });

  it("stores only the fields it knows", () => {
    const stored = serializePayeeBook({ payees: [{ ...payee, extra: 1 } as Payee], active: 0 });
    expect(JSON.parse(stored)).toEqual({ payees: [payee], active: 0 });
  });

  it("gives the active payee", () => {
    expect(activePayee(book)).toEqual(club);
  });

  it("appends a new payee and makes it active", () => {
    const next = savePayeeAt(EMPTY_BOOK, null, payee);
    expect(next).toEqual({ payees: [payee], active: 0 });
    expect(savePayeeAt(next, null, club)).toEqual({ payees: [payee, club], active: 1 });
  });

  it("refuses to append past the limit", () => {
    const full: PayeeBook = {
      payees: Array.from({ length: PAYEE_LIMIT }, () => club),
      active: 2,
    };
    expect(savePayeeAt(full, null, payee)).toBe(full);
  });

  it("replaces a payee in place and makes it active", () => {
    const edited = { ...shop, name: "Corner Shop GmbH" };
    expect(savePayeeAt(book, 2, edited)).toEqual({ payees: [payee, club, edited], active: 2 });
    expect(savePayeeAt(book, 5, edited)).toBe(book);
    expect(savePayeeAt(book, -1, edited)).toBe(book);
  });

  it("switches the active payee within bounds", () => {
    expect(setActivePayee(book, 2)).toEqual({ payees: book.payees, active: 2 });
    expect(setActivePayee(book, 3)).toBe(book);
    expect(setActivePayee(book, -1)).toBe(book);
  });

  it("removes a payee and keeps the active one by identity", () => {
    expect(removePayeeAt(book, 0)).toEqual({ payees: [club, shop], active: 0 });
    expect(removePayeeAt(book, 2)).toEqual({ payees: [payee, club], active: 1 });
    expect(removePayeeAt(book, 1)).toEqual({ payees: [payee, shop], active: 0 });
    expect(removePayeeAt({ payees: [payee], active: 0 }, 0)).toEqual(EMPTY_BOOK);
    expect(removePayeeAt(book, 3)).toBe(book);
  });
});
