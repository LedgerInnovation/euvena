/** On-device persistence for the payee settings and the request history. */

import AsyncStorage from "@react-native-async-storage/async-storage";

import { parseHistory, serializeHistory, type HistoryEntry } from "./history";
import { parsePayeeBook, serializePayeeBook, type PayeeBook } from "./payee";

// Key from before the rename to Euvena, and from before the book of payees:
// changing it would silently drop the payee saved on existing installs. The
// parser reads the single-payee value those installs hold.
const PAYEE_KEY = "eupi.payee";

const HISTORY_KEY = "euvena.history";

export async function loadPayeeBook(): Promise<PayeeBook> {
  return parsePayeeBook(await AsyncStorage.getItem(PAYEE_KEY));
}

export async function savePayeeBook(book: PayeeBook): Promise<void> {
  await AsyncStorage.setItem(PAYEE_KEY, serializePayeeBook(book));
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
