import { createContext, useContext } from "react";
import { useColorScheme } from "react-native";

import type { Appearance } from "../settings/preferences";

/** The two blues of the logo mark, top and bottom of its gradients. */
export const BRAND_BLUE = "#1F74F7";
export const BRAND_BLUE_DEEP = "#0A56DC";
export const BRAND_SKY = "#62CFF8";
export const BRAND_SKY_DEEP = "#3BAAF0";

/** Page backgrounds, also the splash backgrounds in app.json. */
export const PAGE_LIGHT = "#EDF5FD";
export const PAGE_DARK = "#0B1220";

export interface Theme {
  scheme: "light" | "dark";
  /** Page behind the cards. */
  background: string;
  /** Cards. */
  surface: string;
  /** Inputs and other wells sunk into a card. */
  well: string;
  text: string;
  muted: string;
  border: string;
  /** Border of a focused input. */
  focus: string;
  /** Filled buttons. */
  primary: string;
  primaryPressed: string;
  onPrimary: string;
  /** Text actions and outlined buttons, readable on the page and on cards. */
  link: string;
  /** Tinted background for chips and soft cards. */
  primarySoft: string;
  /** Pressed state of an outlined or text button, distinct from a soft card. */
  pressedSoft: string;
  danger: string;
  dangerSoft: string;
}

export const LIGHT: Theme = {
  scheme: "light",
  background: PAGE_LIGHT,
  surface: "#FFFFFF",
  well: "#F4F8FD",
  text: "#0E1B30",
  muted: "#5A6A82",
  border: "#D7E3F1",
  focus: "#155FD6",
  primary: "#155FD6",
  primaryPressed: "#0F4DB5",
  onPrimary: "#FFFFFF",
  link: "#155FD6",
  primarySoft: "#E4F0FE",
  pressedSoft: "#CFE2FB",
  danger: "#B3261E",
  dangerSoft: "#FBECEA",
};

export const DARK: Theme = {
  scheme: "dark",
  background: PAGE_DARK,
  surface: "#151F31",
  well: "#0F1828",
  text: "#EAF1FA",
  muted: "#98A9C2",
  border: "#273650",
  focus: "#5C9BFF",
  primary: "#2A6BD4",
  primaryPressed: "#1F5AB8",
  onPrimary: "#FFFFFF",
  link: "#5C9BFF",
  primarySoft: "#1B2C48",
  pressedSoft: "#27406A",
  danger: "#FF8A7E",
  dangerSoft: "#3B1F1D",
};

/**
 * The palette for the system appearance. The blues are the logo's, darkened
 * where white text sits on them so every label reaches 4.5:1. Every screen reads its colours from
 * here, so a device in dark mode gets a dark app rather than a light page
 * inside dark system chrome. The QR card is the one deliberate exception and
 * stays dark modules on a light card in both appearances, for scanner contrast.
 */
export function useTheme(): Theme {
  return useScheme() === "dark" ? DARK : LIGHT;
}

/** The appearance chosen in the settings; "system" follows the device. */
export const AppearanceContext = createContext<Appearance>("system");

/** The scheme in force: the chosen one, or the device's while following it. */
export function useScheme(): "light" | "dark" {
  const chosen = useContext(AppearanceContext);
  const system = useColorScheme();
  if (chosen !== "system") return chosen;
  return system === "dark" ? "dark" : "light";
}
