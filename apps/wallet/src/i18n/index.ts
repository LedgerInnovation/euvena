/**
 * The languages the wallet speaks and what depends on the chosen one:
 * wording, and how numbers and dates read. The amount inside a code is not
 * formatted here; EPC069-12 fixes how it is written.
 *
 * Plain TypeScript, so the readers under src/epc and src/settings can take a
 * dictionary and the tests can pass one.
 */

import { LANGUAGES, type Dictionary, type ElementKey, type Language } from "./dictionary";
import { de } from "./de";
import { en } from "./en";
import { es } from "./es";
import { fr } from "./fr";
import { it } from "./it";
import { nl } from "./nl";
import { pl } from "./pl";

export {
  LANGUAGES,
  LANGUAGE_NAMES,
  type Dictionary,
  type ElementKey,
  type Language,
  type RejectionCode,
  type TransferRefusal,
} from "./dictionary";
export { en } from "./en";

export const DICTIONARIES: Record<Language, Dictionary> = { en, de, fr, es, it, nl, pl };

export const DEFAULT_LANGUAGE: Language = "en";

/** A language in force, and the BCP 47 tag numbers and dates are written for. */
export interface Locale {
  language: Language;
  /**
   * The device's own tag when it speaks the language, such as "de-AT" or
   * "en-IE", so money and dates keep their regional shape; else the bare
   * language.
   */
  tag: string;
}

/**
 * The language to use: the one chosen by hand, else the first device
 * language the wallet speaks, else English. Device languages arrive as
 * tags such as "de-AT"; only the language part decides which language,
 * and the whole tag decides how it is written when it fits.
 */
export function resolveLocale(chosen: Language | null, deviceTags: readonly string[]): Locale {
  const spoken = deviceTags.find((tag) => isLanguage(languageOf(tag)));
  if (chosen !== null) {
    const regional = deviceTags.find((tag) => languageOf(tag) === chosen);
    return { language: chosen, tag: regional ?? chosen };
  }
  if (spoken !== undefined) return { language: languageOf(spoken) as Language, tag: spoken };
  return { language: DEFAULT_LANGUAGE, tag: DEFAULT_LANGUAGE };
}

export function resolveLanguage(chosen: Language | null, deviceTags: readonly string[]): Language {
  return resolveLocale(chosen, deviceTags).language;
}

function languageOf(tag: string): string {
  return tag.toLowerCase().split(/[-_]/)[0] ?? "";
}

export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);
}

// Formatters are built once per tag: on Hermes each one crosses into native
// code, and the history builds a row per entry on every render.
const moneyFormats = new Map<string, Intl.NumberFormat>();
const dateFormats = new Map<string, Intl.DateTimeFormat>();

/**
 * An amount from a payload, as the locale writes money. The payload carries
 * a decimal point and no grouping; a reader of German sees a comma. Anything
 * that is not a plain decimal is shown as it came, since a review must not
 * invent a value, and so is anything the platform cannot format.
 */
export function formatMoney(amount: string, tag: string): string {
  if (!/^\d+(\.\d+)?$/.test(amount)) return amount;
  try {
    let format = moneyFormats.get(tag);
    if (format === undefined) {
      format = new Intl.NumberFormat(tag, {
        style: "currency",
        currency: "EUR",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      moneyFormats.set(tag, format);
    }
    return format.format(Number(amount));
  } catch {
    return amount;
  }
}

/** A build time from the history, as the locale writes a date and time. */
export function formatDateTime(iso: string, tag: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    let format = dateFormats.get(tag);
    if (format === undefined) {
      format = new Intl.DateTimeFormat(tag, {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
      dateFormats.set(tag, format);
    }
    return format.format(date);
  } catch {
    return iso;
  }
}

/** Why an input was not read as a payment request. */
export interface Rejection {
  code: import("./dictionary").RejectionCode;
  /** The elements that failed, for codeInvalid, paytoInvalid and poiInvalid. */
  elements?: ElementKey[];
}

/** The rejection in the chosen language. */
export function describeRejection(rejection: Rejection, strings: Dictionary): string {
  const elements = (rejection.elements ?? []).map((key) => strings.elements[key]);
  switch (rejection.code) {
    case "codeInvalid":
      return elements.length === 0
        ? strings.rejections.codeNoRequest
        : strings.rejections.codeInvalid(elements);
    case "paytoInvalid":
      return elements.length === 0
        ? strings.rejections.paytoNoRequest
        : strings.rejections.paytoInvalid(elements);
    case "poiInvalid":
      return elements.length === 0
        ? strings.rejections.poiNoRequest
        : strings.rejections.poiInvalid(elements);
    default:
      return strings.rejections[rejection.code];
  }
}

/** True when two rejections say the same thing. */
export function sameRejection(a: Rejection, b: Rejection): boolean {
  if (a.code !== b.code) return false;
  const left = a.elements ?? [];
  const right = b.elements ?? [];
  return left.length === right.length && left.every((key, at) => key === right[at]);
}

/** The codec's element names the wallet knows how to name. */
const ELEMENT_KEYS: ReadonlySet<string> = new Set<ElementKey>([
  "serviceTag",
  "version",
  "charset",
  "identification",
  "bic",
  "name",
  "iban",
  "amount",
  "purpose",
  "reference",
  "text",
  "information",
  "payload",
]);

/**
 * The distinct elements a codec error names, in order, as keys. An element
 * the wallet has no name for is named as one it cannot name.
 */
export function elementKeys(elements: readonly string[]): ElementKey[] {
  const keys: ElementKey[] = [];
  for (const element of elements) {
    const key: ElementKey = ELEMENT_KEYS.has(element) ? (element as ElementKey) : "other";
    if (!keys.includes(key)) keys.push(key);
  }
  return keys;
}
