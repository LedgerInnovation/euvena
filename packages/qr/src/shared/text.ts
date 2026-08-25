/**
 * Character-set handling for EPC069-12 payloads.
 *
 * EPC069-12 section 2.1 defines eight character sets:
 *   1: UTF-8      2: ISO 8859-1  3: ISO 8859-2  4: ISO 8859-4
 *   5: ISO 8859-5 6: ISO 8859-7  7: ISO 8859-10 8: ISO 8859-15
 */

export type EpcCharset = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

const utf8 = new TextEncoder();

/**
 * Byte length of a payload in the given character set.
 *
 * UTF-8 is measured exactly. All ISO 8859 variants are single-byte encodings,
 * so the byte length equals the character count; for ISO 8859-1 we additionally
 * verify every character is encodable (code point <= 0xFF). For sets 3..8 the
 * caller is responsible for using only characters that exist in that code page;
 * this function only counts.
 */
export function byteLength(text: string, charset: EpcCharset): number {
  if (charset === 1) return utf8.encode(text).length;
  return text.length;
}

/** True when every character fits ISO 8859-1 (code point <= 0xFF). */
export function isLatin1(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 0xff) return false;
  }
  return true;
}

/**
 * Characters that must never appear in payment data.
 *
 * C0 and C1 control characters, including CR and LF: EPC069-12 joins its
 * elements with line separators, so a control character inside a field would
 * shift every following element. A payload whose beneficiary name contained a
 * line feed could displace the IBAN that the payer's bank app displays and
 * credits.
 *
 * U+2028 LINE SEPARATOR and U+2029 PARAGRAPH SEPARATOR: the payload structure
 * survives them, but most text displays render them as line breaks, so a
 * decoded value could visually push a row of payment data out of place.
 *
 * The bidirectional formatting characters (U+061C, U+200E, U+200F,
 * U+202A..U+202E, U+2066..U+2069): they reorder what a reader sees without
 * changing the bytes, so displayed payment data can read differently from
 * what it says.
 */
const CONTROL_CHARS =
  /[\u0000-\u001F\u007F-\u009F\u061C\u200E\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069]/;

/**
 * True when the text contains a C0/C1 control character (including CR or LF),
 * a line or paragraph separator, or a bidirectional formatting character.
 */
export function hasControlChars(text: string): boolean {
  return CONTROL_CHARS.test(text);
}
