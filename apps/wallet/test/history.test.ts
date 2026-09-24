import { describe, expect, it } from "vitest";

import {
  HISTORY_LIMIT,
  MAX_PAYLOAD_LENGTH,
  markEntry,
  parseHistory,
  rememberRequest,
  serializeHistory,
  type HistoryEntry,
} from "../src/settings/history";

const PAYLOAD_A = "BCD\n002\n1\nSCT\n\nAcme\nDE33100205000001194700\nEUR12.30\n\n\nInvoice 1";
const PAYLOAD_B = "BCD\n002\n1\nSCT\n\nAcme\nDE33100205000001194700\nEUR5\n\n\nInvoice 2";

const T0 = new Date("2026-09-24T10:00:00.000Z");
const T1 = new Date("2026-09-24T10:05:00.000Z");

describe("request history", () => {
  it("starts empty", () => {
    expect(parseHistory(null)).toEqual([]);
  });

  it("remembers newest first with the build time as id", () => {
    const one = rememberRequest([], PAYLOAD_A, T0);
    const two = rememberRequest(one, PAYLOAD_B, T1);
    expect(two.map((entry) => entry.payload)).toEqual([PAYLOAD_B, PAYLOAD_A]);
    expect(two[0]).toEqual({
      id: String(T1.getTime()),
      payload: PAYLOAD_B,
      builtAt: "2026-09-24T10:05:00.000Z",
      done: false,
    });
  });

  it("keeps one entry when the same request is remembered twice in a row", () => {
    const one = rememberRequest([], PAYLOAD_A, T0);
    const again = rememberRequest(one, PAYLOAD_A, T1);
    expect(again).toEqual(one);
    expect(again).not.toBe(one);
  });

  it("adds a new entry when the same request comes back after another", () => {
    const list = rememberRequest(
      rememberRequest(rememberRequest([], PAYLOAD_A, T0), PAYLOAD_B, T1),
      PAYLOAD_A,
      new Date(T1.getTime() + 1),
    );
    expect(list.map((entry) => entry.payload)).toEqual([PAYLOAD_A, PAYLOAD_B, PAYLOAD_A]);
  });

  it("keeps ids unique within one millisecond", () => {
    const one = rememberRequest([], PAYLOAD_A, T0);
    const two = rememberRequest(one, PAYLOAD_B, T0);
    const three = rememberRequest(two, PAYLOAD_A, T0);
    expect(three.map((entry) => entry.id)).toEqual([
      `${T0.getTime()}-2`,
      `${T0.getTime()}-1`,
      String(T0.getTime()),
    ]);
    expect(new Set(three.map((entry) => entry.id)).size).toBe(3);
  });

  it("drops the oldest entry past the limit", () => {
    let list: HistoryEntry[] = [];
    for (let i = 0; i <= HISTORY_LIMIT; i += 1) {
      list = rememberRequest(list, `${PAYLOAD_A}${i}`, new Date(T0.getTime() + i));
    }
    expect(list).toHaveLength(HISTORY_LIMIT);
    expect(list[0]?.payload).toBe(`${PAYLOAD_A}${HISTORY_LIMIT}`);
    expect(list[list.length - 1]?.payload).toBe(`${PAYLOAD_A}1`);
  });

  it("marks one entry and leaves the rest", () => {
    const list = rememberRequest(rememberRequest([], PAYLOAD_A, T0), PAYLOAD_B, T1);
    const marked = markEntry(list, String(T0.getTime()), true);
    expect(marked.map((entry) => entry.done)).toEqual([false, true]);
    expect(markEntry(marked, String(T0.getTime()), false)).toEqual(list);
    expect(markEntry(list, "nope", true)).toEqual(list);
  });

  it("round-trips through storage", () => {
    const list = markEntry(
      rememberRequest(rememberRequest([], PAYLOAD_A, T0), PAYLOAD_B, T1),
      String(T0.getTime()),
      true,
    );
    expect(parseHistory(serializeHistory(list))).toEqual(list);
  });

  it("stores only the fields it knows", () => {
    const list = rememberRequest([], PAYLOAD_A, T0).map((entry) => ({ ...entry, extra: 1 }));
    expect(JSON.parse(serializeHistory(list))).toEqual([
      { id: String(T0.getTime()), payload: PAYLOAD_A, builtAt: T0.toISOString(), done: false },
    ]);
  });

  it("reports a value that is not a list as unreadable rather than as empty", () => {
    for (const stored of ["", "{", "null", '"a string"', "{}", "42"]) {
      expect(parseHistory(stored)).toBeNull();
    }
  });

  it("reads a list with no well-formed entry as empty", () => {
    expect(parseHistory("[]")).toEqual([]);
    expect(parseHistory('[1, null, "x"]')).toEqual([]);
  });

  it("drops entries whose payload is not an EPC payload or is too long", () => {
    const good = { id: "1", payload: PAYLOAD_A, builtAt: T0.toISOString(), done: false };
    const stored = JSON.stringify([
      { ...good, id: "2", payload: "payto://iban/DE33100205000001194700" },
      { ...good, id: "3", payload: "euvena://request?epc=BCD" },
      { ...good, id: "4", payload: `BCD${"x".repeat(MAX_PAYLOAD_LENGTH)}` },
      { ...good, id: "5", payload: `BCD${"x".repeat(MAX_PAYLOAD_LENGTH - 3)}` },
      good,
    ]);
    expect(parseHistory(stored)?.map((entry) => entry.id)).toEqual(["5", "1"]);
  });

  it("drops malformed entries and keeps the well-formed ones", () => {
    const good = { id: "1", payload: PAYLOAD_A, builtAt: T0.toISOString(), done: true };
    const stored = JSON.stringify([
      { ...good, id: "" },
      { ...good, id: 7 },
      { ...good, payload: "" },
      { ...good, builtAt: "yesterday" },
      { ...good, id: "2", done: "yes" },
      good,
    ]);
    expect(parseHistory(stored)).toEqual([{ ...good, id: "2", done: false }, good]);
  });

  it("keeps the first of two entries that share an id", () => {
    const a = { id: "1", payload: PAYLOAD_A, builtAt: T0.toISOString(), done: false };
    const b = { ...a, payload: PAYLOAD_B };
    expect(parseHistory(JSON.stringify([a, b]))).toEqual([a]);
  });

  it("caps a stored list at the limit", () => {
    const entries = Array.from({ length: HISTORY_LIMIT + 5 }, (_, i) => ({
      id: String(i),
      payload: PAYLOAD_A,
      builtAt: T0.toISOString(),
      done: false,
    }));
    expect(parseHistory(JSON.stringify(entries))).toHaveLength(HISTORY_LIMIT);
  });
});
