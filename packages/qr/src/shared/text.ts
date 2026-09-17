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
 *
 * The interlinear annotation marks (U+FFF9..U+FFFB): a display that honours
 * them lifts the annotated part out of the line, so a name could read shorter
 * than the one the payload carries. Unicode keeps them out of interchanged
 * plain text.
 *
 * Half of a surrogate pair on its own (U+D800..U+DFFF): it is not a
 * character, so no code can carry it. UTF-8 has no bytes for it and an
 * encoder writes U+FFFD in its place, in a payload and in a URL alike, so the
 * code would not say what the caller passed. In Unicode mode a well-formed
 * pair is one code point and does not match.
 */
const CONTROL_CHARS =
  /[\u0000-\u001F\u007F-\u009F\u061C\u200E\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069\uD800-\uDFFF\uFFF9-\uFFFB]/u;

/**
 * True when the text contains a C0/C1 control character (including CR or LF),
 * a line or paragraph separator, a bidirectional formatting character, an
 * interlinear annotation mark or a lone surrogate.
 */
export function hasControlChars(text: string): boolean {
  return CONTROL_CHARS.test(text);
}

/**
 * Characters that show nothing: whitespace plus the default ignorable and
 * filler code points that render as blank space or not at all (soft hyphen,
 * combining grapheme joiner, Hangul and Khmer fillers, Mongolian variation
 * selectors, zero-width characters, word joiner and invisible operators, the
 * Braille blank, variation selectors, the byte order mark, the unassigned
 * specials U+FFF0..U+FFF8, Egyptian hieroglyph format controls, shorthand
 * format controls, musical formatting and the tag characters). The
 * hieroglyph controls only arrange the signs beside them, so inside a name
 * they stay legal and a name made of nothing else is refused. Spelled out rather than written with Unicode property
 * escapes, which not every JavaScript engine a consumer runs on supports.
 */
const BLANK_CHARS =
  /[\s\u00AD\u034F\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B-\u200F\u2060-\u206F\u2800\u3164\uFE00-\uFE0F\uFEFF\uFFA0\uFFF0-\uFFF8]|\uD80D[\uDC30-\uDC3F]|\uD82F[\uDCA0-\uDCA3]|\uD834[\uDD73-\uDD7A]|[\uDB40-\uDB43][\uDC00-\uDFFF]/g;

/**
 * True when the text shows at least one character. A beneficiary name made
 * only of blank or invisible characters would let a review display a payment
 * to nobody in particular.
 */
export function hasVisibleText(text: string): boolean {
  return text.replace(BLANK_CHARS, "") !== "";
}
