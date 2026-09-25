/**
 * The file that carries a wallet's data to another device: the payees and the
 * history in one JSON document, with a format name and a version so a later
 * shape can still read an earlier export. Reading is as strict as the forms:
 * a payee must pass the encoder and a kept request must decode, so nothing
 * gets in through a file that could not have got in by hand.
 *
 * Plain TypeScript. Writing the file out and reading one in belong to the
 * screen, since they need the platform.
 */

import { normalizePayee, validatePayee, type Payee } from "../epc/request";
import { readPaymentRequest } from "../epc/scan";
import { HISTORY_LIMIT, readHistory, type HistoryEntry } from "./history";
import { PAYEE_LIMIT, pickPayee, readPayeeBook, type PayeeBook } from "./payee";

export const TRANSFER_FORMAT = "euvena-wallet";
export const TRANSFER_VERSION = 1;

/**
 * Longest file read. A full export is a few tens of kilobytes, so anything
 * far past that is not one, and is refused before it is parsed.
 */
export const MAX_TRANSFER_LENGTH = 1_000_000;

/** What moves between devices. */
export interface Transfer {
  book: PayeeBook;
  history: HistoryEntry[];
}

/** How many of each the file held that did not get in. */
export interface Counts {
  payees: number;
  history: number;
}

export type ReadTransferResult =
  | { ok: true; transfer: Transfer; dropped: Counts }
  | { ok: false; reason: string };

/** A failure worded for the user, as opposed to one from the platform. */
export class TransferProblem extends Error {}

/** What an import did, for the notice under the buttons. */
export interface ImportOutcome {
  added: Counts;
  /** Already held, or past what the lists can hold. */
  skipped: Counts;
  /** Failed the checks the forms run, or could not be read at all. */
  dropped: Counts;
  /** The history could not be written; the payees were. */
  historyFailed: boolean;
}

export const NOT_AN_EXPORT = "That file is not a Euvena wallet export.";
export const NEWER_EXPORT =
  "That file was written by a newer version of the wallet. Update the wallet to read it.";

/** How far ahead of the clock a kept request may be dated before it is not believed. */
const FUTURE_ALLOWANCE_MS = 24 * 60 * 60 * 1000;

export function serializeTransfer(transfer: Transfer, now: Date): string {
  return JSON.stringify(
    {
      format: TRANSFER_FORMAT,
      version: TRANSFER_VERSION,
      exportedAt: now.toISOString(),
      payees: transfer.book.payees.map(pickPayee),
      active: transfer.book.active,
      history: transfer.history.map(({ id, payload, builtAt, done }) => ({
        id,
        payload,
        builtAt,
        done,
      })),
    },
    null,
    2,
  );
}

/** The name the export is offered under, dated so two exports tell apart. */
export function transferFileName(now: Date): string {
  return `${TRANSFER_FORMAT}-${now.toISOString().slice(0, 10)}.json`;
}

/**
 * Reads an export. A file of the wrong shape or a newer version is refused
 * as a whole; within a readable file, a payee the encoder rejects, a request
 * that does not decode or one dated past the clock is dropped and counted,
 * so the user hears what did not make it rather than finding out later. The
 * counts also cover what the lists could not hold, so every entry in the
 * file is either taken or counted.
 */
export function readTransfer(text: string, now: Date): ReadTransferResult {
  if (text.length > MAX_TRANSFER_LENGTH) return { ok: false, reason: NOT_AN_EXPORT };

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, reason: NOT_AN_EXPORT };
  }
  if (typeof value !== "object" || value === null) return { ok: false, reason: NOT_AN_EXPORT };

  const record = value as Record<string, unknown>;
  if (record.format !== TRANSFER_FORMAT) return { ok: false, reason: NOT_AN_EXPORT };
  if (typeof record.version !== "number" || !Number.isInteger(record.version) || record.version < 1) {
    return { ok: false, reason: NOT_AN_EXPORT };
  }
  if (record.version > TRANSFER_VERSION) return { ok: false, reason: NEWER_EXPORT };
  if (!Array.isArray(record.payees) || !Array.isArray(record.history)) {
    return { ok: false, reason: NOT_AN_EXPORT };
  }

  // The stored readers drop what is malformed and cap the lists; the checks
  // the forms run then drop what is well formed but wrong.
  const read = readPayeeBook(record);
  const payees: Payee[] = [];
  let active = 0;
  for (const [at, payee] of read.payees.entries()) {
    const normalized = normalizePayee(payee);
    if (Object.keys(validatePayee(normalized)).length > 0) continue;
    payees.push(normalized);
    if (at === read.active) active = payees.length - 1;
  }

  const latest = now.getTime() + FUTURE_ALLOWANCE_MS;
  const history = (readHistory(record.history) ?? []).filter(
    (entry) => Date.parse(entry.builtAt) <= latest && readPaymentRequest(entry.payload).ok,
  );

  return {
    ok: true,
    transfer: { book: { payees, active }, history },
    dropped: {
      payees: record.payees.length - payees.length,
      history: record.history.length - history.length,
    },
  };
}

/**
 * Adds what a file holds to what the device holds. Nothing on the device is
 * replaced or pushed out: a payee with an IBAN already held is skipped, a
 * request already kept is skipped, the lists take new entries only into the
 * room they have, and the active payee stays unless there was none. A kept
 * request is the same one when it has the same id, or the same payload built
 * at the same time; the same payload built at another time is another
 * request, as it is in the history itself. The history stays newest first.
 * What was skipped is counted, so the notice can say it.
 */
export function mergeTransfer(
  current: Transfer,
  imported: Transfer,
): { transfer: Transfer; added: Counts; skipped: Counts } {
  const ibans = new Set(current.book.payees.map((payee) => normalizePayee(payee).iban));
  const payees = [...current.book.payees];
  let active = current.book.active;
  for (const [at, payee] of imported.book.payees.entries()) {
    if (payees.length >= PAYEE_LIMIT) break;
    const iban = normalizePayee(payee).iban;
    if (ibans.has(iban)) continue;
    ibans.add(iban);
    payees.push(payee);
    if (current.book.payees.length === 0 && at === imported.book.active) {
      active = payees.length - 1;
    }
  }

  const ids = new Set(current.history.map((entry) => entry.id));
  const built = new Set(current.history.map(builtKey));
  const fresh: HistoryEntry[] = [];
  for (const entry of imported.history) {
    if (ids.has(entry.id) || built.has(builtKey(entry))) continue;
    ids.add(entry.id);
    built.add(builtKey(entry));
    fresh.push(entry);
  }
  // Newest first, then only as many as the history has room for, so nothing
  // the device kept is pushed out. The new entries are slotted into the
  // device's own order, which is left as it is.
  fresh.sort(newestFirst);
  const taken = fresh.slice(0, Math.max(HISTORY_LIMIT - current.history.length, 0));
  const history: HistoryEntry[] = [];
  let at = 0;
  for (const entry of current.history) {
    while (at < taken.length && newestFirst(taken[at] as HistoryEntry, entry) < 0) {
      history.push(taken[at] as HistoryEntry);
      at += 1;
    }
    history.push(entry);
  }
  history.push(...taken.slice(at));

  return {
    transfer: { book: { payees, active }, history },
    added: {
      payees: payees.length - current.book.payees.length,
      history: taken.length,
    },
    skipped: {
      payees: imported.book.payees.length - (payees.length - current.book.payees.length),
      history: imported.history.length - taken.length,
    },
  };
}

function builtKey(entry: HistoryEntry): string {
  return `${entry.builtAt}\n${entry.payload}`;
}

/** Negative when a was built later than b. */
function newestFirst(a: HistoryEntry, b: HistoryEntry): number {
  return Date.parse(b.builtAt) - Date.parse(a.builtAt);
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The halves of a count that are not zero, joined for a sentence. */
function both(counts: Counts, history: boolean): string {
  const parts: string[] = [];
  if (counts.payees > 0) parts.push(count(counts.payees, "payee", "payees"));
  if (history && counts.history > 0) parts.push(count(counts.history, "request", "requests"));
  return parts.join(" and ");
}

/** What an import did, in a sentence or three. */
export function describeImport(outcome: ImportOutcome): string {
  const { added, skipped, dropped, historyFailed } = outcome;
  const parts: string[] = [];
  const gained = both(added, !historyFailed);
  if (gained !== "") parts.push(`Added ${gained}.`);
  else if (!historyFailed) parts.push("Nothing new in that file.");
  if (historyFailed) parts.push("The kept requests could not be written to this device.");
  const held = both(skipped, !historyFailed);
  if (held !== "") parts.push(`Already here or past the limit: ${held}.`);
  const unfit = both(dropped, true);
  if (unfit !== "") parts.push(`Could not be used: ${unfit}.`);
  return parts.join(" ");
}
