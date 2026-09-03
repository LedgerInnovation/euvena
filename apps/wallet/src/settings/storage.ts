/** On-device persistence for the payee settings. */

import AsyncStorage from "@react-native-async-storage/async-storage";

import { type Payee } from "../epc/request";
import { parsePayee, serializePayee } from "./payee";

// Key from before the rename to Euvena: changing it would silently drop the
// payee saved on existing installs.
const STORAGE_KEY = "eupi.payee";

export async function loadPayee(): Promise<Payee> {
  return parsePayee(await AsyncStorage.getItem(STORAGE_KEY));
}

export async function savePayee(payee: Payee): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, serializePayee(payee));
}
