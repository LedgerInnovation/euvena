/**
 * What the user chose about the wallet itself: how it looks and which
 * language it speaks. Both are on-device settings beside the payees. A
 * language of null means the device language decides.
 */

import { isLanguage, type Language } from "../i18n";

export type Appearance = "system" | "light" | "dark";

export const APPEARANCES: readonly Appearance[] = ["system", "light", "dark"];

export interface Preferences {
  appearance: Appearance;
  language: Language | null;
}

export const DEFAULT_PREFERENCES: Preferences = { appearance: "system", language: null };

/** Reads stored preferences, falling back field by field on anything unexpected. */
export function parsePreferences(stored: string | null): Preferences {
  if (stored === null) return DEFAULT_PREFERENCES;

  let value: unknown;
  try {
    value = JSON.parse(stored);
  } catch {
    return DEFAULT_PREFERENCES;
  }
  if (typeof value !== "object" || value === null) return DEFAULT_PREFERENCES;

  const record = value as Record<string, unknown>;
  return {
    appearance: isAppearance(record.appearance) ? record.appearance : "system",
    language: isLanguage(record.language) ? record.language : null,
  };
}

export function serializePreferences(preferences: Preferences): string {
  return JSON.stringify({
    appearance: preferences.appearance,
    language: preferences.language,
  });
}

function isAppearance(value: unknown): value is Appearance {
  return typeof value === "string" && (APPEARANCES as readonly string[]).includes(value);
}
