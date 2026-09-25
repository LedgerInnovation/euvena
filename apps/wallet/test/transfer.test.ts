import { describe, expect, it } from "vitest";

import { EMPTY_FORM, buildPaymentRequest, type Payee } from "../src/epc/request";
import { HISTORY_LIMIT, type HistoryEntry } from "../src/settings/history";
import { EMPTY_BOOK, PAYEE_LIMIT } from "../src/settings/payee";
import {
  MAX_TRANSFER_LENGTH,
  NEWER_EXPORT,
  NOT_AN_EXPORT,
  TRANSFER_VERSION,
  describeImport,
  mergeTransfer,
  readTransfer,
  serializeTransfer,
  transferFileName,
  type Transfer,
} from "../src/settings/transfer";

const payee: Payee = {
  name: "Wikimedia Foerdergesellschaft",
  iban: "DE33100205000001194700",
  bic: "BFSWDE33MUE",
};
const club: Payee = { name: "Chess Club", iban: "FR7630006000011234567890189", bic: "" };
const shop: Payee = { name: "Corner Shop", iban: "NL91ABNA0417164300", bic: "" };

function payload(of: Payee, amount: string): string {
  const built = buildPaymentRequest(of, { ...EMPTY_FORM, amount });
  if (!built.ok) throw new Error("fixture does not encode");
  return built.payload;
}

const entryA: HistoryEntry = {
  id: "1700000000000",
  payload: payload(payee, "12.30"),
  builtAt: "2026-09-20T10:00:00.000Z",
  done: false,
};
const entryB: HistoryEntry = {
  id: "1700000001000",
  payload: payload(club, "5"),
  builtAt: "2026-09-21T10:00:00.000Z",
  done: true,
};
const entryC: HistoryEntry = {
  id: "1700000002000",
  payload: payload(shop, "7"),
  builtAt: "2026-09-22T10:00:00.000Z",
  done: false,
};

const transfer: Transfer = {
  book: { payees: [payee, club], active: 1 },
  history: [entryB, entryA],
};
const now = new Date("2026-09-25T08:00:00.000Z");

describe("transfer file", () => {
  it("round-trips", () => {
    const result = readTransfer(serializeTransfer(transfer, now), now);
    expect(result).toEqual({ ok: true, transfer, dropped: { payees: 0, history: 0 } });
  });

  it("names the file by the day", () => {
    expect(transferFileName(now)).toBe("euvena-wallet-2026-09-25.json");
  });

  it("carries the format and version", () => {
    const parsed = JSON.parse(serializeTransfer(transfer, now));
    expect(parsed.format).toBe("euvena-wallet");
    expect(parsed.version).toBe(TRANSFER_VERSION);
    expect(parsed.exportedAt).toBe(now.toISOString());
  });

  it("refuses what is not an export", () => {
    for (const text of ["", "{", "null", "[]", '"a"', "{}", '{"format":"other","version":1}']) {
      expect(readTransfer(text, now)).toEqual({ ok: false, reason: NOT_AN_EXPORT });
    }
    const base = { format: "euvena-wallet", payees: [], history: [] };
    for (const version of [0, -1, 1.5, "1", null]) {
      expect(readTransfer(JSON.stringify({ ...base, version }), now)).toEqual({
        ok: false,
        reason: NOT_AN_EXPORT,
      });
    }
    expect(readTransfer(JSON.stringify({ format: "euvena-wallet", version: 1 }), now)).toEqual({
      ok: false,
      reason: NOT_AN_EXPORT,
    });
    expect(readTransfer(`{"format":"euvena-wallet"${" ".repeat(MAX_TRANSFER_LENGTH)}}`, now)).toEqual({
      ok: false,
      reason: NOT_AN_EXPORT,
    });
  });

  it("refuses a newer version as a whole", () => {
    const text = JSON.stringify({
      format: "euvena-wallet",
      version: TRANSFER_VERSION + 1,
      payees: [payee],
      history: [],
    });
    expect(readTransfer(text, now)).toEqual({ ok: false, reason: NEWER_EXPORT });
  });

  it("drops a payee the encoder rejects and keeps the active one by identity", () => {
    const text = JSON.stringify({
      format: "euvena-wallet",
      version: 1,
      payees: [{ ...payee, iban: "DE00" }, 7, club, { ...shop, name: " Corner Shop " }],
      active: 3,
      history: [],
    });
    expect(readTransfer(text, now)).toEqual({
      ok: true,
      transfer: { book: { payees: [club, shop], active: 1 }, history: [] },
      dropped: { payees: 2, history: 0 },
    });
  });

  it("drops a kept request that does not decode or is dated past the clock", () => {
    const text = JSON.stringify({
      format: "euvena-wallet",
      version: 1,
      payees: [],
      history: [
        entryA,
        { ...entryB, payload: "BCD\n002\n1\nSCT\n\n\n\n" },
        "x",
        { ...entryC, id: "future", builtAt: "2026-09-27T08:00:00.000Z" },
        { ...entryC, id: "soon", builtAt: "2026-09-25T20:00:00.000Z" },
        entryC,
      ],
    });
    expect(readTransfer(text, now)).toEqual({
      ok: true,
      transfer: {
        book: EMPTY_BOOK,
        history: [entryA, { ...entryC, id: "soon", builtAt: "2026-09-25T20:00:00.000Z" }, entryC],
      },
      dropped: { payees: 0, history: 3 },
    });
  });
});

describe("merging an export", () => {
  it("fills an empty device and takes the active payee along", () => {
    const merged = mergeTransfer({ book: EMPTY_BOOK, history: [] }, transfer);
    expect(merged.transfer).toEqual(transfer);
    expect(merged.added).toEqual({ payees: 2, history: 2 });
    expect(merged.skipped).toEqual({ payees: 0, history: 0 });
  });

  it("skips payees already held by IBAN, however written, and keeps the device's active one", () => {
    const held = { ...club, name: "Club", iban: "fr76 3000 6000 0112 3456 7890 189" };
    const current: Transfer = { book: { payees: [shop, held], active: 0 }, history: [] };
    const merged = mergeTransfer(current, transfer);
    expect(merged.transfer.book).toEqual({ payees: [shop, held, payee], active: 0 });
    expect(merged.added.payees).toBe(1);
    expect(merged.skipped.payees).toBe(1);
  });

  it("keeps the device's active payee when the file's active one is added", () => {
    const current: Transfer = { book: { payees: [shop], active: 0 }, history: [] };
    expect(mergeTransfer(current, transfer).transfer.book).toEqual({
      payees: [shop, payee, club],
      active: 0,
    });
  });

  it("stops adding payees at the limit and counts the rest as skipped", () => {
    const full: Payee[] = Array.from({ length: PAYEE_LIMIT - 1 }, (_, i) => ({
      ...shop,
      iban: `NL91ABNA04171643${String(i).padStart(2, "0")}`,
    }));
    const merged = mergeTransfer({ book: { payees: full, active: 3 }, history: [] }, transfer);
    expect(merged.transfer.book.payees).toHaveLength(PAYEE_LIMIT);
    expect(merged.transfer.book.payees[PAYEE_LIMIT - 1]).toEqual(payee);
    expect(merged.transfer.book.active).toBe(3);
    expect(merged.added.payees).toBe(1);
    expect(merged.skipped.payees).toBe(1);
  });

  it("skips a request already kept, by id or by payload and time, and orders newest first", () => {
    const current: Transfer = {
      book: EMPTY_BOOK,
      history: [entryC, { ...entryA, id: "other", done: true }],
    };
    const merged = mergeTransfer(current, transfer);
    expect(merged.transfer.history).toEqual([entryC, entryB, { ...entryA, id: "other", done: true }]);
    expect(merged.added.history).toBe(1);
    expect(merged.skipped.history).toBe(1);
  });

  it("keeps the same request built at another time as its own entry", () => {
    const again = { ...entryA, id: "1700000009000", builtAt: "2026-09-23T10:00:00.000Z" };
    const merged = mergeTransfer(
      { book: EMPTY_BOOK, history: [entryA] },
      { book: EMPTY_BOOK, history: [again, entryA] },
    );
    expect(merged.transfer.history).toEqual([again, entryA]);
    expect(merged.added).toEqual({ payees: 0, history: 1 });
  });

  it("takes new requests only into the room the history has", () => {
    const old: HistoryEntry[] = Array.from({ length: HISTORY_LIMIT - 1 }, (_, i) => ({
      ...entryA,
      id: `old-${i}`,
      payload: payload(payee, `${i + 1}`),
      builtAt: "2026-01-01T00:00:00.000Z",
    }));
    const merged = mergeTransfer(
      { book: EMPTY_BOOK, history: old },
      { book: EMPTY_BOOK, history: [entryB, entryC] },
    );
    expect(merged.transfer.history).toHaveLength(HISTORY_LIMIT);
    expect(merged.transfer.history[0]).toEqual(entryC);
    expect(merged.transfer.history.slice(1)).toEqual(old);
    expect(merged.added.history).toBe(1);
    expect(merged.skipped.history).toBe(1);
  });
});

describe("describing an import", () => {
  const none = { payees: 0, history: 0 };
  it("leaves out zero halves and says nothing new when nothing was added", () => {
    expect(describeImport({ added: none, skipped: none, dropped: none, historyFailed: false })).toBe(
      "Nothing new in that file.",
    );
    expect(
      describeImport({
        added: { payees: 1, history: 0 },
        skipped: { payees: 0, history: 3 },
        dropped: { payees: 2, history: 1 },
        historyFailed: false,
      }),
    ).toBe("Added 1 payee. Already here or past the limit: 3 requests. Could not be used: 2 payees and 1 request.");
    expect(
      describeImport({ added: none, skipped: none, dropped: { payees: 0, history: 2 }, historyFailed: false }),
    ).toBe("Nothing new in that file. Could not be used: 2 requests.");
  });

  it("does not count requests when the history could not be written", () => {
    expect(
      describeImport({
        added: { payees: 2, history: 0 },
        skipped: { payees: 1, history: 0 },
        dropped: none,
        historyFailed: true,
      }),
    ).toBe(
      "Added 2 payees. The kept requests could not be written to this device. Already here or past the limit: 1 payee.",
    );
    expect(describeImport({ added: none, skipped: none, dropped: none, historyFailed: true })).toBe(
      "The kept requests could not be written to this device.",
    );
  });
});
