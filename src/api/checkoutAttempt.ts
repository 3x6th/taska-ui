import type { ReturnTarget } from "./billing";
import { newIdempotencyKey } from "./tenantCreation";

/*
 * One payment attempt of an invoice (TAS-513, api-contract-guard §2 and its
 * addendum; the orchestrator's decision 3): the `Idempotency-Key` of
 * `createCheckout`, kept in `localStorage` — shared by the browser's tabs —
 * **before the request leaves**, in one `setItem`, read-or-created inside the
 * Web Lock `taska.checkout:{tenantId}:{invoiceId}`. So a double click, a second
 * tab, a reload mid-request, the 401 rotation, a 429, a 5xx or 503 and a lost
 * answer all send the same key with the same `returnTarget`, and the server
 * answers the one checkout it made: one payment. Without Web Locks it runs
 * unlocked (the server's unique index holds; the residual race is accepted).
 *
 * `sessionStorage` cannot do this: the server refuses a second key while one
 * attempt is active (`payment_attempts_invoice_active_uniq`) with a 409 that
 * names no checkout (A57) — a second tab with a key of its own could never
 * find the first tab's payment again.
 *
 * The record names the checkout once the server has answered (`checkoutId`,
 * with its `expiresAt`), and the return from the payment page is routed by it
 * (`/billing/return`, `/billing/cancel`, A54) — the return address carries no
 * id at all. **The payment page's address is never stored.** `leftAt` is a
 * wording hint only (A56): set when the owner came back through the cancel
 * address or by Back from the provider (the orchestrator's N3), cleared when
 * they came back through the return address.
 *
 * Closed — removed — when a checkout FAILED or EXPIRED (the next Pay is a new
 * key); when the invoice is read PAID, EXPIRED or VOID, on its page or in the
 * list; when the company is no longer never-opened (its CREATION records);
 * on the definitive refusals before anything was created (403
 * `OWNER_REQUIRED`, `CAPABILITY_DISABLED`, `READ_ONLY`; 409 `INVALID_STATE`,
 * `IDEMPOTENCY_CONFLICT`; 503 `POLICY_NOT_CONFIGURED`) — only while the record
 * still holds the refused key; and on sign-out. A lost answer, a 5xx, a 408,
 * a 429 and a 503 `DEPENDENCY_UNAVAILABLE` keep it, and so does an UNKNOWN
 * checkout. Another account's records are dropped unread.
 */

export const CHECKOUT_ATTEMPT_PREFIX = "taska.checkout.";

export const checkoutAttemptKey = (userId: string, tenantId: string, invoiceId: string) =>
  `${CHECKOUT_ATTEMPT_PREFIX}${userId}.${tenantId}.${invoiceId}`;

export const checkoutLockName = (tenantId: string, invoiceId: string) => `taska.checkout:${tenantId}:${invoiceId}`;

export interface CheckoutAttempt {
  v: 1;
  userId: string;
  tenantId: string;
  invoiceId: string;
  /** The canonical lowercase UUID sent as `Idempotency-Key`. */
  key: string;
  returnTarget: ReturnTarget;
  /** When the first send left — ISO-8601. */
  startedAt: string;
  /** From the 201: the checkout, and when it expires (when the server said). */
  checkoutId?: string;
  expiresAt?: string;
  /** The owner came back through the cancel address (`/billing/cancel`): a hint only, never a state (A56). */
  leftAt?: string;
}

/** The part of `navigator.locks` this uses; absent — run unlocked. */
export interface CheckoutLocks {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

/** The browser's Web Locks, or `null` where there are none. */
export function browserCheckoutLocks(): CheckoutLocks | null {
  const locks = typeof navigator === "undefined" ? undefined : (navigator as Navigator & { locks?: LockManager }).locks;
  if (!locks || typeof locks.request !== "function") return null;
  return { request: (name, callback) => locks.request(name, callback) as Promise<never> };
}

const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

function parse(raw: string | null): CheckoutAttempt | null {
  let parsed: unknown;
  try {
    parsed = raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const row = parsed as Record<string, unknown>;
  const userId = text(row.userId);
  const tenantId = text(row.tenantId);
  const invoiceId = text(row.invoiceId);
  const key = text(row.key);
  const startedAt = text(row.startedAt);
  const returnTarget = row.returnTarget === "BILLING" || row.returnTarget === "CREATION" ? row.returnTarget : null;
  if (row.v !== 1 || userId === null || tenantId === null || invoiceId === null || key === null || startedAt === null || returnTarget === null) {
    return null;
  }
  const checkoutId = text(row.checkoutId);
  const expiresAt = text(row.expiresAt);
  const leftAt = text(row.leftAt);
  return {
    v: 1,
    userId,
    tenantId,
    invoiceId,
    key,
    returnTarget,
    startedAt,
    ...(checkoutId !== null ? { checkoutId } : {}),
    ...(expiresAt !== null ? { expiresAt } : {}),
    ...(leftAt !== null ? { leftAt } : {}),
  };
}

/** The record of this account for this invoice, or `null`. */
export function readCheckoutAttempt(storage: Storage, userId: string, tenantId: string, invoiceId: string): CheckoutAttempt | null {
  let raw: string | null;
  try {
    raw = storage.getItem(checkoutAttemptKey(userId, tenantId, invoiceId));
  } catch {
    return null;
  }
  const record = parse(raw);
  return record !== null && record.userId === userId && record.tenantId === tenantId && record.invoiceId === invoiceId ? record : null;
}

/** One `setItem`: the key and the body never land apart. A storage that refuses keeps nothing. */
export function writeCheckoutAttempt(storage: Storage, record: CheckoutAttempt): void {
  try {
    storage.setItem(checkoutAttemptKey(record.userId, record.tenantId, record.invoiceId), JSON.stringify(record));
  } catch {
    // Nothing was kept: the attempt lives as long as the page.
  }
}

/**
 * Removes the record — only while it still holds `key`, when one is named: a
 * refusal of one tab's key never closes the record another tab's live
 * attempt has written since (release-reviewer N2).
 */
export function clearCheckoutAttempt(storage: Storage, userId: string, tenantId: string, invoiceId: string, key?: string): void {
  if (key !== undefined) {
    const current = readCheckoutAttempt(storage, userId, tenantId, invoiceId);
    if (current !== null && current.key !== key) return;
  }
  try {
    storage.removeItem(checkoutAttemptKey(userId, tenantId, invoiceId));
  } catch {
    // Nothing was kept.
  }
}

function attemptKeys(storage: Storage): string[] {
  const keys: string[] = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key !== null && key.startsWith(CHECKOUT_ATTEMPT_PREFIX)) keys.push(key);
    }
  } catch {
    return [];
  }
  return keys;
}

/**
 * Every open record of this account, newest first — the return addresses'
 * routing (A54). Another account's records, and anything that is not a
 * record, are removed unread.
 */
export function listCheckoutAttempts(storage: Storage, userId: string): CheckoutAttempt[] {
  const own: CheckoutAttempt[] = [];
  for (const key of attemptKeys(storage)) {
    let raw: string | null;
    try {
      raw = storage.getItem(key);
    } catch {
      continue;
    }
    const record = parse(raw);
    const mine = record !== null && record.userId === userId && key === checkoutAttemptKey(record.userId, record.tenantId, record.invoiceId);
    if (!mine) {
      try {
        storage.removeItem(key);
      } catch {
        // Left as it was.
      }
      continue;
    }
    own.push(record);
  }
  return own.sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0));
}

/**
 * A company that is no longer never-opened has spent its creation's payment
 * (release-reviewer B1): its CREATION records go, whoever's they are — the
 * first payment they were about is settled, or the company opened without it.
 * Its other records are left alone. Answers whether anything went.
 */
export function closeCreationAttempts(storage: Storage, tenantId: string): boolean {
  let closed = false;
  for (const key of attemptKeys(storage)) {
    let raw: string | null;
    try {
      raw = storage.getItem(key);
    } catch {
      continue;
    }
    const record = parse(raw);
    if (record === null || record.tenantId !== tenantId || record.returnTarget !== "CREATION") continue;
    try {
      storage.removeItem(key);
      closed = true;
    } catch {
      // Left as it was.
    }
  }
  return closed;
}

/** Sign-out: every record of the account goes (`taska.checkout.{userId}.*`). */
export function clearCheckoutAttempts(storage: Storage, userId: string): void {
  for (const key of attemptKeys(storage)) {
    if (!key.startsWith(`${CHECKOUT_ATTEMPT_PREFIX}${userId}.`)) continue;
    try {
      storage.removeItem(key);
    } catch {
      // Left as it was.
    }
  }
}

/**
 * The record for this invoice — the open one, or a new one written before
 * anything is sent — and `send` with its key, inside the invoice's Web Lock,
 * so two tabs pressing Pay at once send one key. A record whose
 * `returnTarget` differs keeps its own: a retry never changes the body. The
 * checkout's id and expiry are written on the answer.
 */
export async function withCheckoutAttempt<T extends { id: string; expiresAt: string | null }>(
  options: {
    storage: Storage;
    locks: CheckoutLocks | null;
    userId: string;
    tenantId: string;
    invoiceId: string;
    returnTarget: ReturnTarget;
    now?: () => Date;
  },
  send: (key: string, returnTarget: ReturnTarget) => Promise<T>,
): Promise<T> {
  const { storage, locks, userId, tenantId, invoiceId } = options;
  const run = async () => {
    const open = readCheckoutAttempt(storage, userId, tenantId, invoiceId);
    const record: CheckoutAttempt = open ?? {
      v: 1,
      userId,
      tenantId,
      invoiceId,
      key: newIdempotencyKey(),
      returnTarget: options.returnTarget,
      startedAt: (options.now?.() ?? new Date()).toISOString(),
    };
    if (open === null) writeCheckoutAttempt(storage, record);
    const checkout = await send(record.key, record.returnTarget);
    // Re-read: another tab may have added `leftAt` meanwhile; a record closed meanwhile stays closed.
    const current = readCheckoutAttempt(storage, userId, tenantId, invoiceId);
    if (current !== null && current.key === record.key) {
      const { leftAt: _left, ...kept } = current;
      writeCheckoutAttempt(storage, {
        ...kept,
        checkoutId: checkout.id,
        ...(checkout.expiresAt !== null ? { expiresAt: checkout.expiresAt } : {}),
      });
    }
    return checkout;
  };
  return locks === null ? run() : locks.request(checkoutLockName(tenantId, invoiceId), run);
}

/** The return address was the way back: the record's `leftAt` goes (release-reviewer R1). */
export function clearLeft(storage: Storage, record: CheckoutAttempt): CheckoutAttempt {
  if (record.leftAt === undefined) return record;
  const { leftAt: _left, ...kept } = record;
  writeCheckoutAttempt(storage, kept);
  return kept;
}

/** The cancel address was the way back: `leftAt` on the record (a hint for the wording only). */
export function markLeft(storage: Storage, record: CheckoutAttempt, at: Date = new Date()): CheckoutAttempt {
  const marked = { ...record, leftAt: at.toISOString() };
  writeCheckoutAttempt(storage, marked);
  return marked;
}
