import { describe, expect, it } from "vitest";
import { EPC069_MAX_BYTES, encodeEpcQr } from "@euvena/qr";

import { EPC069_MAX_VERSION, toQrSymbol, toSvgPath, type QrSymbol } from "../src/qr/symbol";

const payload = encodeEpcQr({
  name: "Wikimedia Foerdergesellschaft",
  iban: "DE33100205000001194700",
  amount: 13.05,
  text: "Spende fuer Wikipedia",
});

describe("toQrSymbol", () => {
  it("sizes the symbol to its version", () => {
    const symbol = toQrSymbol(payload);

    // ISO/IEC 18004: a version n symbol is 4n + 17 modules per side.
    expect(symbol.size).toBe(4 * symbol.version + 17);
    expect(symbol.modules).toHaveLength(symbol.size);
    for (const row of symbol.modules) expect(row).toHaveLength(symbol.size);
  });

  it("places the three finder patterns", () => {
    const { modules, size } = toQrSymbol(payload);

    for (const [top, left] of [
      [0, 0],
      [0, size - 7],
      [size - 7, 0],
    ]) {
      expect(top).toBeTypeOf("number");
      expect(left).toBeTypeOf("number");
      // A finder pattern is a 7x7 dark ring around a 3x3 dark core.
      for (let i = 0; i < 7; i++) {
        expect(modules[top!]?.[left! + i]).toBe(true);
        expect(modules[top! + 6]?.[left! + i]).toBe(true);
        expect(modules[top! + i]?.[left!]).toBe(true);
        expect(modules[top! + i]?.[left! + 6]).toBe(true);
      }
      expect(modules[top! + 1]?.[left! + 1]).toBe(false);
      expect(modules[top! + 3]?.[left! + 3]).toBe(true);
    }
  });

  it("keeps the largest conformant payload inside the version the guidelines allow", () => {
    // 331 bytes is the EPC069-12 maximum and the byte-mode capacity of a
    // version 13 symbol at error correction level M, so the two limits meet.
    const largest = "B".repeat(EPC069_MAX_BYTES);

    expect(toQrSymbol(largest).version).toBe(EPC069_MAX_VERSION);
    expect(() => toQrSymbol("B".repeat(EPC069_MAX_BYTES + 1))).toThrow(/guidelines allow/);
  });

  it("counts multi-byte characters as the bytes they encode to", () => {
    // 166 two-byte characters fill the same 332 bytes as 332 ASCII ones.
    expect(() => toQrSymbol("ä".repeat(166))).toThrow(/guidelines allow/);
  });
});

describe("toSvgPath", () => {
  const from = (rows: string[]): QrSymbol => ({
    size: rows.length,
    version: 1,
    modules: rows.map((row) => [...row].map((cell) => cell === "#")),
  });

  it("merges each horizontal run into one rectangle", () => {
    expect(toSvgPath(from(["###", "...", "#.#"]))).toBe(
      "M0 0h3v1h-3zM0 2h1v1h-1zM2 2h1v1h-1z",
    );
  });

  it("returns an empty path for a symbol with no dark modules", () => {
    expect(toSvgPath(from(["..", ".."]))).toBe("");
  });

  it("draws one rectangle per dark module row of the real symbol", () => {
    const symbol = toQrSymbol(payload);
    const runs = toSvgPath(symbol).match(/M/g);

    expect(runs).not.toBeNull();
    expect(runs!.length).toBeGreaterThan(0);
    // Every run is closed, so the counts of moves and closes agree.
    expect(toSvgPath(symbol).match(/z/g)).toHaveLength(runs!.length);
  });
});
