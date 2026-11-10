import { describe, expect, it, vi } from "vitest";
import { MemoryStorage } from "../test/memoryStorage";
import {
  checkoutAttemptKey,
  clearCheckoutAttempt,
  clearCheckoutAttempts,
  listCheckoutAttempts,
  markLeft,
  readCheckoutAttempt,
  withCheckoutAttempt,
  type CheckoutLocks,
} from "./checkoutAttempt";

/*
 * The payment attempt record (TAS-513, api-contract-guard §2, the
 * orchestrator's decision 3): one key per (account, company, invoice) in
 * `localStorage`, written before the request, read-or-created inside the
 * invoice's Web Lock, the checkout's id added on the answer, never the page
 * address; another account's dropped unread; sign-out clears the account's.
 */

const USER = "user-1";
const T = "tenant-1";
const I = "invoice-1";

/** A Web Locks stand-in: one holder per name at a time, the rest queued. */
function fifoLocks(): CheckoutLocks {
  const tails = new Map<string, Promise<unknown>>();
  return {
    request<T>(name: string, callback: () => Promise<T>): Promise<T> {
      const previous = tails.get(name) ?? Promise.resolve();
      const run = previous.then(callback, callback);
      tails.set(name, run.catch(() => undefined));
      return run;
    },
  };
}

const answer = (id: string) => ({ id, expiresAt: "2026-11-11T10:30:00Z", redirect: "secret-ish" });

describe("withCheckoutAttempt", () => {
  it("writes the record before the request, and the checkout's id and expiry on its answer — never the address", async () => {
    const storage = new MemoryStorage();
    const send = vi.fn(async (key: string) => {
      const before = readCheckoutAttempt(storage, USER, T, I);
      expect(before).toMatchObject({ key, returnTarget: "BILLING", userId: USER, tenantId: T, invoiceId: I });
      expect(before?.checkoutId).toBeUndefined();
      return answer("co-1");
    });
    await withCheckoutAttempt({ storage, locks: null, userId: USER, tenantId: T, invoiceId: I, returnTarget: "BILLING" }, send);
    const record = readCheckoutAttempt(storage, USER, T, I);
    expect(record).toMatchObject({ checkoutId: "co-1", expiresAt: "2026-11-11T10:30:00Z" });
    expect(storage.getItem(checkoutAttemptKey(USER, T, I))).not.toContain("secret-ish");
  });

  it("a retry after a lost answer sends the same key and the same target", async () => {
    const storage = new MemoryStorage();
    const keys: string[] = [];
    const lost = vi.fn(async (key: string) => {
      keys.push(key);
      throw new TypeError("Failed to fetch");
    });
    await expect(withCheckoutAttempt({ storage, locks: null, userId: USER, tenantId: T, invoiceId: I, returnTarget: "CREATION" }, lost)).rejects.toThrow();
    const targets: string[] = [];
    await withCheckoutAttempt({ storage, locks: null, userId: USER, tenantId: T, invoiceId: I, returnTarget: "BILLING" }, async (key, target) => {
      keys.push(key);
      targets.push(target);
      return answer("co-1");
    });
    expect(new Set(keys).size).toBe(1);
    // A retry never changes the body: the record's target stays.
    expect(targets).toEqual(["CREATION"]);
  });

  it("two tabs pressing at once share one key under the invoice's lock", async () => {
    const storage = new MemoryStorage();
    const locks = fifoLocks();
    const keys: string[] = [];
    const press = () =>
      withCheckoutAttempt({ storage, locks, userId: USER, tenantId: T, invoiceId: I, returnTarget: "BILLING" }, async (key) => {
        keys.push(key);
        await Promise.resolve();
        return answer("co-1");
      });
    await Promise.all([press(), press()]);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it("a record closed while the request was out stays closed", async () => {
    const storage = new MemoryStorage();
    await withCheckoutAttempt({ storage, locks: null, userId: USER, tenantId: T, invoiceId: I, returnTarget: "BILLING" }, async () => {
      clearCheckoutAttempt(storage, USER, T, I);
      return answer("co-1");
    });
    expect(readCheckoutAttempt(storage, USER, T, I)).toBeNull();
  });
});

describe("the account's records", () => {
  it("are listed newest first; another account's and anything malformed are removed unread", () => {
    const storage = new MemoryStorage();
    const record = (tenantId: string, invoiceId: string, startedAt: string, userId = USER) =>
      storage.setItem(
        checkoutAttemptKey(userId, tenantId, invoiceId),
        JSON.stringify({ v: 1, userId, tenantId, invoiceId, key: "k", returnTarget: "BILLING", startedAt }),
      );
    record("t-a", "i-a", "2026-11-11T09:00:00Z");
    record("t-b", "i-b", "2026-11-11T10:00:00Z");
    record("t-c", "i-c", "2026-11-11T11:00:00Z", "someone-else");
    storage.setItem(`taska.checkout.${USER}.t-d.i-d`, "{not json");
    storage.setItem("taska.lastCompany", "keep me");
    expect(listCheckoutAttempts(storage, USER).map((item) => item.tenantId)).toEqual(["t-b", "t-a"]);
    expect(storage.getItem(checkoutAttemptKey("someone-else", "t-c", "i-c"))).toBeNull();
    expect(storage.getItem(`taska.checkout.${USER}.t-d.i-d`)).toBeNull();
    expect(storage.getItem("taska.lastCompany")).toBe("keep me");
  });

  it("a record under another key than its own body names is not one", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      checkoutAttemptKey(USER, T, I),
      JSON.stringify({ v: 1, userId: USER, tenantId: "other", invoiceId: I, key: "k", returnTarget: "BILLING", startedAt: "2026-11-11T09:00:00Z" }),
    );
    expect(readCheckoutAttempt(storage, USER, T, I)).toBeNull();
    expect(listCheckoutAttempts(storage, USER)).toEqual([]);
  });

  it("`leftAt` marks a way back through the cancel address; sign-out clears only this account's", () => {
    const storage = new MemoryStorage();
    const mine = { v: 1 as const, userId: USER, tenantId: T, invoiceId: I, key: "k", returnTarget: "BILLING" as const, startedAt: "2026-11-11T09:00:00Z" };
    storage.setItem(checkoutAttemptKey(USER, T, I), JSON.stringify(mine));
    storage.setItem(checkoutAttemptKey("other", T, I), JSON.stringify({ ...mine, userId: "other" }));
    expect(markLeft(storage, mine, new Date("2026-11-11T09:05:00Z")).leftAt).toBe("2026-11-11T09:05:00.000Z");
    expect(readCheckoutAttempt(storage, USER, T, I)?.leftAt).toBe("2026-11-11T09:05:00.000Z");
    clearCheckoutAttempts(storage, USER);
    expect(readCheckoutAttempt(storage, USER, T, I)).toBeNull();
    expect(storage.getItem(checkoutAttemptKey("other", T, I))).not.toBeNull();
  });
});
