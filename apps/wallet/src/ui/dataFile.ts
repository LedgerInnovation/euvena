/**
 * Moving a data file in and out of the wallet. Writing goes through the
 * share sheet of the operating system, so the destination is the user's
 * choice; reading goes through the system file picker. The wallet sends
 * nothing itself.
 */

import { Platform } from "react-native";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

import { MAX_TRANSFER_LENGTH, TransferProblem } from "../settings/transfer";

const JSON_TYPE = "application/json";

/**
 * What the picker offers. Downloads from messengers and drives often carry
 * the generic type rather than JSON, so those are offered too; the reader
 * refuses what is not an export.
 */
const PICK_TYPES = [JSON_TYPE, "text/plain", "application/octet-stream"];

const FILE_TOO_LARGE = "That file is larger than any wallet export.";

/**
 * Writes the text to a file in the cache and offers it to the share sheet.
 * The sheet settles when it closes on iOS, so the file is removed then; on
 * Android it settles as soon as it is launched, so the file is left for the
 * destination to read and the system clears the cache when it needs the
 * space.
 */
export async function shareDataFile(name: string, text: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("sharing is not available on this device");
  }
  const file = new File(Paths.cache, name);
  file.write(text);
  try {
    await Sharing.shareAsync(file.uri, {
      mimeType: JSON_TYPE,
      UTI: "public.json",
      dialogTitle: "Save or send the wallet data",
    });
  } finally {
    // A missing file throws on delete, and a throw here would hide the
    // outcome of the share; the cache is the system's to clear anyway.
    if (Platform.OS === "ios") {
      try {
        file.delete();
      } catch {
        // Left for the system.
      }
    }
  }
}

/**
 * Lets the user pick a file and reads it as text. Resolves null when nothing
 * was picked. A file far larger than any export is refused before it is
 * read, since reading it would be the only cost of a wrong pick.
 */
export async function pickDataFile(): Promise<string | null> {
  const picked = await File.pickFileAsync({ mimeTypes: PICK_TYPES });
  if (picked.canceled) return null;
  const file = picked.result;
  // The limit counts characters and this counts bytes, so it is a coarse
  // gate; the reader applies the exact one.
  if (file.size !== null && file.size > MAX_TRANSFER_LENGTH) {
    throw new TransferProblem(FILE_TOO_LARGE);
  }
  return file.text();
}
