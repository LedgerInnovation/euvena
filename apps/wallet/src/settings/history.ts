/**
 * The on-device log of composed requests.
 *
 * An entry holds the payload a code carried and when it was built. The payload
 * is the source of truth: an entry is shown by decoding it again, the same way
 * a scanned code is read, so the history cannot show a request that a code
 * could not carry. The done mark is the payee's own bookkeeping. The wallet
 * never learns whether a request was paid, so the mark is never a payment
 * status.
 *
 * Parsing is defensive for the same reason the payee settings are: the stored
 * value is only as trustworthy as the last version of the app that wrote it.
 */

export interface HistoryEntry {
  /** Unique within the list. Derived from the build time, see rememberRequest. */
  id: string;
  /** What the code carried, exactly: an EPC069-12 payload or an EN 18184 URL. */
  payload: string;
  /** When the request was built, as an ISO 8601 instant. */
  builtAt: string;
  /** Marked by hand as done or stale. Not a payment status. */
  done: boolean;
}

/** Entries kept, newest first. Older ones fall off the end. */
export const HISTORY_LIMIT = 200;

/**
 * Longest payload an entry may hold. A conformant EPC069-12 payload is at most
 * 331 bytes and an EN 18184 URL the wallet builds, with every text field full
 * of escaped characters, stays under 2048, so anything past that is not
 * something this app wrote.
 */
export const MAX_PAYLOAD_LENGTH = 2048;

/** How the two kinds of payload begin; an EN 18184 URL is compared without case. */
function isPayloadShaped(payload: string): boolean {
  return payload.startsWith("BCD") || payload.slice(0, 8).toLowerCase() === "https://";
}

/**
 * Reads a stored history, dropping anything that is not a well-formed entry.
 *
 * Nothing stored reads as an empty list. A stored value that is not a list at
 * all reads as null: it is a history that could not be read, which the caller
 * must not overwrite with the next entry it keeps.
 */
export function parseHistory(stored: string | null): HistoryEntry[] | null {
  if (stored === null) return [];

  let value: unknown;
  try {
    value = JSON.parse(stored);
  } catch {
    return null;
  }
  return readHistory(value);
}

/**
 * Reads a history out of a parsed value. Anything but a list reads as null;
 * entries that are not well formed are dropped, and a repeated id keeps its
 * first entry.
 */
export function readHistory(value: unknown): HistoryEntry[] | null {
  if (!Array.isArray(value)) return null;

  const entries: HistoryEntry[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const entry = parseEntry(item);
    // A repeated id would make two entries answer to one mark. The first one
    // read is the newer one, so it is the one kept.
    if (entry === null || seen.has(entry.id)) continue;
    seen.add(entry.id);
    entries.push(entry);
    if (entries.length === HISTORY_LIMIT) break;
  }
  return entries;
}

function parseEntry(item: unknown): HistoryEntry | null {
  if (typeof item !== "object" || item === null) return null;
  const record = item as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    record.id === "" ||
    typeof record.payload !== "string" ||
    // Only a code's payload is shown by decoding it as one. Any other string
    // would be read as a link and shown as something else.
    !isPayloadShaped(record.payload) ||
    record.payload.length > MAX_PAYLOAD_LENGTH ||
    typeof record.builtAt !== "string" ||
    Number.isNaN(Date.parse(record.builtAt))
  ) {
    return null;
  }
  return {
    id: record.id,
    payload: record.payload,
    builtAt: record.builtAt,
    done: record.done === true,
  };
}

export function serializeHistory(entries: HistoryEntry[]): string {
  return JSON.stringify(
    entries.map(({ id, payload, builtAt, done }) => ({ id, payload, builtAt, done })),
  );
}

/**
 * Adds a request to the front of the list.
 *
 * Building the same request twice in a row, such as sharing it to two
 * destinations, keeps one entry: the newest entry with the same payload is
 * left in place. An older entry with the same payload is a separate request
 * that happens to read the same, so it stays where it is.
 *
 * The id is the build time in milliseconds, made unique with a suffix when the
 * same millisecond already has an entry, so ids never depend on randomness.
 */
export function rememberRequest(
  entries: readonly HistoryEntry[],
  payload: string,
  now: Date,
): HistoryEntry[] {
  const newest = entries[0];
  if (newest !== undefined && newest.payload === payload) return [...entries];

  const base = String(now.getTime());
  const taken = new Set(entries.map((entry) => entry.id));
  let id = base;
  for (let suffix = 1; taken.has(id); suffix += 1) id = `${base}-${suffix}`;

  const entry: HistoryEntry = { id, payload, builtAt: now.toISOString(), done: false };
  return [entry, ...entries].slice(0, HISTORY_LIMIT);
}

/** Sets the done mark on one entry. An unknown id changes nothing. */
export function markEntry(
  entries: readonly HistoryEntry[],
  id: string,
  done: boolean,
): HistoryEntry[] {
  return entries.map((entry) => (entry.id === id ? { ...entry, done } : entry));
}
