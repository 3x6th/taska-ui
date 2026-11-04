/**
 * Companies — the blueprint's tenants (TAS-500, `docs/contract/b2b/b2b-openapi.yaml`
 * at develop `758f8fc6`, `Tenant` and `TenantPage`). None of this is on the
 * gateway yet; every route behind it answers the static-resource 404 on the
 * stand, and it is only reached in the B2B build (`src/lib/tenancy.ts`).
 *
 * The UI says "company"; the code keeps the contract's "tenant" so a reader can
 * find each name in the yaml.
 */

/** `Tenant.lifecycle`, in the blueprint's order. */
export const TENANT_LIFECYCLES = [
  "PROVISIONING",
  "AWAITING_PAYMENT",
  "ACTIVE",
  "AUTO_CLOSED",
  "OWNER_CANCELLED",
  "DELETING",
  "DELETED",
] as const;
export type KnownTenantLifecycle = (typeof TENANT_LIFECYCLES)[number];
/** A value this build knows, or the server's own string as it came (TAS-173): never dropped, never a throw. */
export type TenantLifecycle = KnownTenantLifecycle | (string & {});

/** `RestrictionCode` — independent of each other and of the lifecycle (contracts §5). */
export const RESTRICTION_CODES = [
  "PAYMENT_EXPIRED",
  "OVER_QUOTA",
  "OWNER_PAUSE",
  "PLATFORM_BLOCK",
  "PAYMENT_DISPUTE",
  "PENDING_FIRST_PAYMENT",
] as const;
export type KnownRestrictionCode = (typeof RESTRICTION_CODES)[number];
export type RestrictionCode = KnownRestrictionCode | (string & {});

export const isKnownTenantLifecycle = (value: unknown): value is KnownTenantLifecycle =>
  typeof value === "string" && (TENANT_LIFECYCLES as readonly string[]).includes(value);

export const isKnownRestrictionCode = (value: unknown): value is KnownRestrictionCode =>
  typeof value === "string" && (RESTRICTION_CODES as readonly string[]).includes(value);

/**
 * One company as `GET /tenants` lists it. **Nothing here says whether the reader
 * may enter it**: the blueprint's `Tenant` carries no membership of the caller
 * and no rule maps lifecycle or restrictions to the answer of
 * `createTenantSession` (api-contract-guard B4, ask A1/A2). `lifecycle` and
 * `restrictions` are for a state line and an order only; entering always asks
 * the server. `ownerId` equal to the reader may draw "Owner" — display only.
 *
 * Every field the schema requires is still read as optional: a field that is
 * not what the schema promises is `null` (or dropped from `restrictions`)
 * rather than an exception, and a value outside this build's unions is kept
 * as its string. `ownerVersion` is not read — nothing in TAS-500 uses it.
 */
export interface Tenant {
  id: string;
  /** 1–120 characters by the schema; `null` when the answer carried none. */
  name: string | null;
  ownerId: string | null;
  lifecycle: TenantLifecycle | null;
  restrictions: RestrictionCode[];
  createdAt: string | null;
  /** Present only while the company is awaiting its first payment. */
  creationDeadline: string | null;
  /** The entity version, a decimal string (contracts §1). */
  version: string | null;
}

/** `TenantPage`, as sent: `nextCursor` is absent at the end of the list. */
export interface TenantPage {
  items: Tenant[];
  nextCursor: string | null;
}

/** `GET /tenants`' two parameters: an opaque cursor and a page size of 1–100 (server default 50). */
export interface ListTenantsParams {
  cursor?: string;
  limit?: number;
}

/** The largest page `GET /tenants` serves (`Limit.maximum`). */
export const TENANT_PAGE_MAX = 100;

const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

/**
 * One wire `Tenant`, or `null` for a row without a usable `id` — nothing could
 * enter it, and an empty id would be one row's key for every such row.
 */
export function toTenant(wire: unknown): Tenant | null {
  if (typeof wire !== "object" || wire === null) return null;
  const row = wire as Record<string, unknown>;
  const id = text(row.id);
  if (id === null) return null;
  return {
    id,
    name: text(row.name),
    ownerId: text(row.ownerId),
    lifecycle: text(row.lifecycle),
    restrictions: Array.isArray(row.restrictions)
      ? row.restrictions.filter((item): item is string => typeof item === "string" && item !== "")
      : [],
    createdAt: text(row.createdAt),
    creationDeadline: text(row.creationDeadline),
    version: text(row.version),
  };
}

/** `TenantPage` in the server's order — never re-sorted here; the screens order it (DESIGN.md §4.33). */
export function toTenantPage(wire: unknown): TenantPage {
  const page = typeof wire === "object" && wire !== null ? (wire as Record<string, unknown>) : {};
  const items = Array.isArray(page.items)
    ? page.items.map(toTenant).filter((tenant): tenant is Tenant => tenant !== null)
    : [];
  return { items, nextCursor: text(page.nextCursor) };
}

/**
 * Every company the reader has, read the way DESIGN.md §4.33 asks: pages of
 * `TENANT_PAGE_MAX`, following `nextCursor` until it is absent. Nobody is in
 * hundreds of companies, so this is a loop of one in practice. A cursor the
 * server repeats ends the loop rather than spinning on it, and so does a
 * generous page cap — a list longer than that is a server fault this should not
 * turn into a frozen tab.
 */
export async function readAllTenants(list: (params: ListTenantsParams) => Promise<TenantPage>): Promise<Tenant[]> {
  const tenants: Tenant[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 50; page += 1) {
    const answer = await list(cursor === undefined ? { limit: TENANT_PAGE_MAX } : { cursor, limit: TENANT_PAGE_MAX });
    tenants.push(...answer.items);
    if (answer.nextCursor === null || seen.has(answer.nextCursor)) break;
    seen.add(answer.nextCursor);
    cursor = answer.nextCursor;
  }
  return tenants;
}
