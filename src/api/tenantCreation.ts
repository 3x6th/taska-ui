/*
 * One company-creation attempt of this tab (TAS-501, api-contract-guard §3,
 * B2): the `Idempotency-Key` and the exact body it was sent with, kept in
 * `sessionStorage` `taska.tenantCreation` **before the request leaves**, in one
 * `setItem`. Every retry of the attempt — a second press, the reload's own
 * replay, the account session's 401 rotation, a 429 after its wait, a 5xx or
 * 503, a transport failure — sends the same key with this same body, so the
 * server answers with the same company and never makes a second one.
 *
 * The record is closed — removed — by a definitive answer (DESIGN.md §4.36):
 * a refusal the server will repeat for this key, a 202 whose company is
 * already working or closed, or a terminal operation read by the never-opened
 * card (§4.37); and by signing out (`WebSessionClient`). A 202 for a company
 * still being set up or awaiting its first payment keeps the record with the
 * company's `tenantId` and `operationId`, because `Tenant` carries neither
 * back (ask A11) and the card polls the operation by them. A record with a
 * `tenantId` is an answered attempt: the form does not replay it.
 *
 * Per tab, by design: a new tab has no record, and so no attempt to replay —
 * the residual risk the guard named (a lost answer followed by a new tab).
 */

export const TENANT_CREATION_KEY = "taska.tenantCreation";

/** A canonical lowercase UUID — what `Idempotency-Key` takes (develop refuses anything else, api-contract-guard §3). */
export function newIdempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface TenantCreationRecord {
  v: 1;
  /** The account the attempt was made by; a record of another account is dropped unread. */
  userId: string;
  /** The canonical lowercase UUID sent as `Idempotency-Key`. */
  key: string;
  /** Exactly as sent: trimmed. */
  name: string;
  planVersionId: string;
  /** When the first send left — ISO-8601. */
  sentAt: string;
  /** From the 202: the company, and its creation's operation. */
  tenantId?: string;
  operationId?: string;
}

const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

/** The record, or `null` for none or for anything that is not one. */
export function readTenantCreation(storage: Storage): TenantCreationRecord | null {
  let parsed: unknown;
  try {
    const raw = storage.getItem(TENANT_CREATION_KEY);
    parsed = raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const row = parsed as Record<string, unknown>;
  const userId = text(row.userId);
  const key = text(row.key);
  const name = text(row.name);
  const planVersionId = text(row.planVersionId);
  const sentAt = text(row.sentAt);
  if (row.v !== 1 || userId === null || key === null || name === null || planVersionId === null || sentAt === null) {
    return null;
  }
  const tenantId = text(row.tenantId);
  const operationId = text(row.operationId);
  return {
    v: 1,
    userId,
    key,
    name,
    planVersionId,
    sentAt,
    ...(tenantId !== null ? { tenantId } : {}),
    ...(operationId !== null ? { operationId } : {}),
  };
}

/** One `setItem`: the key and the body never land apart. A storage that refuses keeps nothing — the attempt lives as long as the page. */
export function writeTenantCreation(storage: Storage, record: TenantCreationRecord): void {
  try {
    storage.setItem(TENANT_CREATION_KEY, JSON.stringify(record));
  } catch {
    // Nothing was kept.
  }
}

export function clearTenantCreation(storage: Storage): void {
  try {
    storage.removeItem(TENANT_CREATION_KEY);
  } catch {
    // Nothing was kept.
  }
}

/** The tab's open attempt for this account — sent, no definitive answer yet — or `null`. */
export function openTenantCreation(storage: Storage, userId: string): TenantCreationRecord | null {
  const record = readTenantCreation(storage);
  if (record === null) return null;
  if (record.userId !== userId) {
    clearTenantCreation(storage);
    return null;
  }
  return record.tenantId === undefined ? record : null;
}

/** The answered attempt that made `tenantId`, while the card may still poll it — or `null`. */
export function creationOf(storage: Storage, tenantId: string): TenantCreationRecord | null {
  const record = readTenantCreation(storage);
  return record !== null && record.tenantId === tenantId ? record : null;
}
