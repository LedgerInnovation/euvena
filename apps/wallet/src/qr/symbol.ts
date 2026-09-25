/**
 * Builds the QR symbol for a payment code.
 *
 * For EPC069-12, the guidelines fix two rendering parameters (v3.1 section 3):
 * error correction level M and a symbol no larger than version 13. A
 * conformant payload is at most 331 bytes, which is exactly the byte-mode
 * capacity of version 13 at level M, so the cap is reachable but never
 * exceeded by valid input.
 *
 * The payload goes in as a single byte-mode segment holding its UTF-8 bytes.
 * Letting the encoder split the text into numeric and alphanumeric segments
 * would be a shorter bitstream and a worse code: byte mode is what the EPC
 * character set element describes and what deployed bank scanners expect.
 */

import { create } from "qrcode";

/** Error correction level required by the guidelines. */
export const EPC069_ERROR_CORRECTION = "M";

/** Largest symbol version the guidelines allow. */
export const EPC069_MAX_VERSION = 13;

/**
 * Largest symbol version of ISO/IEC 18004. EPC024-22 names the standard and
 * fixes no parameters of its own, so an EN 18184 code is bounded only by it
 * and is drawn at the same level M.
 */
export const QR_MAX_VERSION = 40;

export interface QrSymbol {
  /** Module count per side, excluding the quiet zone. */
  size: number;
  /** QR symbol version, 1..13 for conformant EPC069-12 payloads. */
  version: number;
  /** Row-major dark-module flags, `size` rows of `size` entries. */
  modules: boolean[][];
}

/**
 * @throws Error when the payload does not fit a symbol of `maxVersion` at level M.
 */
export function toQrSymbol(payload: string, maxVersion: number = EPC069_MAX_VERSION): QrSymbol {
  const bytes = new TextEncoder().encode(payload);
  const symbol = create([{ mode: "byte", data: bytes }], {
    errorCorrectionLevel: EPC069_ERROR_CORRECTION,
  });

  if (symbol.version > maxVersion) {
    throw new Error(`payload needs QR version ${symbol.version}, up to ${maxVersion} is allowed`);
  }

  const size = symbol.modules.size;
  const modules: boolean[][] = [];
  for (let row = 0; row < size; row++) {
    const cells: boolean[] = [];
    for (let column = 0; column < size; column++) {
      cells.push(symbol.modules.get(row, column) === 1);
    }
    modules.push(cells);
  }

  return { size, version: symbol.version, modules };
}

/**
 * Renders the dark modules as a single SVG path, one module per unit of the
 * path's coordinate space. One path for the whole symbol keeps the view tree
 * to a single node, where a rect per module would be thousands.
 */
export function toSvgPath(symbol: QrSymbol): string {
  const segments: string[] = [];
  for (let row = 0; row < symbol.size; row++) {
    const cells = symbol.modules[row];
    if (cells === undefined) continue;
    let column = 0;
    while (column < symbol.size) {
      if (cells[column] !== true) {
        column++;
        continue;
      }
      // Merge each horizontal run of dark modules into one rectangle.
      const start = column;
      while (column < symbol.size && cells[column] === true) column++;
      segments.push(`M${start} ${row}h${column - start}v1h-${column - start}z`);
    }
  }
  return segments.join("");
}
