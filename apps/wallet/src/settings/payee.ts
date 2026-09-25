/**
 * Serialisation of the local payee settings.
 *
 * The wallet has no accounts and no backend, so the beneficiary details live in
 * on-device storage and nowhere else. Several payees can be held, with one
 * active: the one the request screen builds codes for. Parsing is defensive
 * because the stored value is only as trustworthy as the last version of the
 * app that wrote it, and it still reads the single-payee shape earlier
 * versions wrote.
 */

import { EMPTY_PAYEE, type Payee } from "../epc/request";

/** The payees on the device and which one requests are built for. */
export interface PayeeBook {
  payees: Payee[];
  /** Index into payees. Meaningless while the list is empty. */
  active: number;
}

/** Payees held at most. Enough for a person and a few clubs, small enough to list. */
export const PAYEE_LIMIT = 20;

export const EMPTY_BOOK: PayeeBook = { payees: [], active: 0 };

/** Reads one stored payee, falling back to empty fields on anything unexpected. */
export function parsePayee(stored: string | null): Payee {
  if (stored === null) return EMPTY_PAYEE;

  let value: unknown;
  try {
    value = JSON.parse(stored);
  } catch {
    return EMPTY_PAYEE;
  }
  return readPayee(value) ?? EMPTY_PAYEE;
}

export function serializePayee(payee: Payee): string {
  return JSON.stringify(pickPayee(payee));
}

/**
 * Reads the stored book, or a single payee written by an earlier version,
 * which becomes a book of one. Anything unexpected reads as an empty book.
 */
export function parsePayeeBook(stored: string | null): PayeeBook {
  if (stored === null) return EMPTY_BOOK;

  let value: unknown;
  try {
    value = JSON.parse(stored);
  } catch {
    return EMPTY_BOOK;
  }
  return readPayeeBook(value);
}

/**
 * Reads a book out of a parsed value: an object holding a list of payees and
 * an active index, or a single payee written by an earlier version. Anything
 * else reads as an empty book.
 */
export function readPayeeBook(value: unknown): PayeeBook {
  if (typeof value !== "object" || value === null) return EMPTY_BOOK;

  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.payees)) {
    // The single-payee shape. One without an IBAN was a first run never
    // finished, since nothing could be saved without one.
    const single = readPayee(value);
    return single === null || single.iban === "" ? EMPTY_BOOK : { payees: [single], active: 0 };
  }

  const storedActive =
    typeof record.active === "number" && Number.isInteger(record.active) ? record.active : -1;
  const payees: Payee[] = [];
  // The active index counts stored entries, so it is remapped as malformed
  // ones are dropped. It falls back to the first payee only when the active
  // entry itself is dropped, cut by the limit, or the index points at nothing.
  let active = 0;
  for (const [at, item] of record.payees.entries()) {
    const payee = readPayee(item);
    // A payee without an IBAN could never have been saved, so it is not one.
    if (payee === null || payee.iban === "") continue;
    payees.push(payee);
    if (at === storedActive) active = payees.length - 1;
    if (payees.length === PAYEE_LIMIT) break;
  }
  return { payees, active };
}

export function serializePayeeBook(book: PayeeBook): string {
  return JSON.stringify({ payees: book.payees.map(pickPayee), active: book.active });
}

/** The payee requests are built for, or empty fields while there is none. */
export function activePayee(book: PayeeBook): Payee {
  return book.payees[book.active] ?? EMPTY_PAYEE;
}

/**
 * Replaces the payee at an index, or appends when the index is null, and
 * makes it the active one: a payee just saved is the one to request into.
 * Appending past the limit changes nothing.
 */
export function savePayeeAt(book: PayeeBook, index: number | null, payee: Payee): PayeeBook {
  if (index === null) {
    if (book.payees.length >= PAYEE_LIMIT) return book;
    return { payees: [...book.payees, payee], active: book.payees.length };
  }
  if (index < 0 || index >= book.payees.length) return book;
  return {
    payees: book.payees.map((existing, at) => (at === index ? payee : existing)),
    active: index,
  };
}

/** Drops a payee. The active one stays active by identity, or falls back to the first. */
export function removePayeeAt(book: PayeeBook, index: number): PayeeBook {
  if (index < 0 || index >= book.payees.length) return book;
  const payees = book.payees.filter((_, at) => at !== index);
  const active =
    book.active === index ? 0 : book.active > index ? book.active - 1 : book.active;
  return { payees, active: Math.min(active, Math.max(payees.length - 1, 0)) };
}

export function setActivePayee(book: PayeeBook, index: number): PayeeBook {
  if (index < 0 || index >= book.payees.length) return book;
  return { payees: book.payees, active: index };
}

/** Reads one payee out of a parsed value, with empty strings for missing fields. */
export function readPayee(value: unknown): Payee | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  return {
    name: typeof record.name === "string" ? record.name : "",
    iban: typeof record.iban === "string" ? record.iban : "",
    bic: typeof record.bic === "string" ? record.bic : "",
  };
}

/** The stored fields of a payee and nothing else. */
export function pickPayee(payee: Payee): Payee {
  return { name: payee.name, iban: payee.iban, bic: payee.bic };
}
