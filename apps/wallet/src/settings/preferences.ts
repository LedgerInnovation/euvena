/**
 * What the user chose about the wallet itself: how it looks, which language
 * it speaks and, when there is one, the EN 18184 profile its codes are built
 * with. All are on-device settings beside the payees. A language of null
 * means the device language decides; a profile of null means the wallet
 * builds EPC069-12 codes only.
 */

import { normalizePoiProfile, poiProfileIssues, type PoiProfile } from "../epc/poi";
import { isLanguage, type Language } from "../i18n";

export type Appearance = "system" | "light" | "dark";

export const APPEARANCES: readonly Appearance[] = ["system", "light", "dark"];

export interface Preferences {
  appearance: Appearance;
  language: Language | null;
  poi: PoiProfile | null;
}

export const DEFAULT_PREFERENCES: Preferences = { appearance: "system", language: null, poi: null };

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
    poi: readPoiProfile(record.poi),
  };
}

export function serializePreferences(preferences: Preferences): string {
  return JSON.stringify({
    appearance: preferences.appearance,
    language: preferences.language,
    poi: preferences.poi,
  });
}

/**
 * A stored profile, or null. One that the encoder would refuse is dropped
 * whole: half a profile builds no code, and the settings offer to enter it
 * again.
 */
function readPoiProfile(value: unknown): PoiProfile | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const { domain, providerId, issuer } = record;
  if (typeof domain !== "string" || typeof providerId !== "string" || typeof issuer !== "string") {
    return null;
  }
  const profile = normalizePoiProfile({ domain, providerId, issuer });
  return poiProfileIssues(profile).length === 0 ? profile : null;
}

function isAppearance(value: unknown): value is Appearance {
  return typeof value === "string" && (APPEARANCES as readonly string[]).includes(value);
}
