/** On-device persistence for the payee settings and the request history. */

import AsyncStorage from "@react-native-async-storage/async-storage";

import { type Payee } from "../epc/request";
import { parseHistory, serializeHistory, type HistoryEntry } from "./history";
import { parsePayee, serializePayee } from "./payee";

// Key from before the rename to Euvena: changing it would silently drop the
// payee saved on existing installs.
const PAYEE_KEY = "eupi.payee";

const HISTORY_KEY = "euvena.history";

export async function loadPayee(): Promise<Payee> {
  return parsePayee(await AsyncStorage.getItem(PAYEE_KEY));
}

export async function savePayee(payee: Payee): Promise<void> {
  await AsyncStorage.setItem(PAYEE_KEY, serializePayee(payee));
}

/** Rejects when a stored history exists but cannot be read as one. */
export async function loadHistory(): Promise<HistoryEntry[]> {
  const entries = parseHistory(await AsyncStorage.getItem(HISTORY_KEY));
  if (entries === null) throw new Error("the stored history could not be read");
  return entries;
}

export async function saveHistory(entries: HistoryEntry[]): Promise<void> {
  await AsyncStorage.setItem(HISTORY_KEY, serializeHistory(entries));
}
