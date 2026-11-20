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

/* -------------------------------------------------- creating a company (TAS-501) */

/*
 * The blueprint's creation routes (`docs/contract/b2b/b2b-openapi.yaml` at
 * develop `758f8fc6`: `listBillingPlans`, `createTenant`, `getTenant`,
 * `getTenantOperation`, `cancelTenantCreation`), none of which the stand serves
 * (docs/ai/API-DIVERGENCE.md «TAS-501»). Every enum is read as a known value or
 * the server's own string (TAS-173); money stays a string of minor units — no
 * float ever holds a price (contracts §1, `Money`).
 */

/** `PlanVersion.period`. */
export const PLAN_PERIODS = ["CALENDAR_MONTH", "NONE"] as const;
export type PlanPeriod = (typeof PLAN_PERIODS)[number] | (string & {});

/** `PlanVersion.state` — only `PUBLISHED` is offered (DESIGN.md §4.36). */
export const PLAN_STATES = ["DRAFT", "PUBLISHED", "RETIRED"] as const;
export type PlanState = (typeof PLAN_STATES)[number] | (string & {});

/** `Money.currency`. */
export const CURRENCIES = ["EUR", "USD"] as const;
export type Currency = (typeof CURRENCIES)[number] | (string & {});

/** `QuotaLimit.kind`, in the order DESIGN.md §4.36 lists them on a plan's line. */
export const QUOTA_KINDS = ["PROJECT", "SEAT", "STORAGE_BYTES", "TASK_LIFETIME"] as const;
export type QuotaKind = (typeof QUOTA_KINDS)[number] | (string & {});

/** `Operation.state`. Never keyed on `Operation.type` (develop sends "TENANT_PROVISION"). */
export const OPERATION_STATES = ["PENDING", "RUNNING", "SUCCEEDED", "FAILED", "MANUAL_REVIEW"] as const;
export type OperationState = (typeof OPERATION_STATES)[number] | (string & {});

/** `Money`: unsigned minor units as a decimal string, never a float. */
export interface Money {
  amountMinor: string;
  currency: Currency;
  exponent: number;
}

/** `QuotaLimit`: `limit` a decimal string, absent exactly when `unlimited`. */
export interface QuotaLimit {
  kind: QuotaKind;
  limit: string | null;
  unlimited: boolean;
}

/**
 * One `PlanVersion`. `capabilities` is not read: the blueprint calls it opaque,
 * and the UI neither draws nor compares it (api-contract-guard §1). **Nothing
 * here says whether the reader may take the plan** — FREE eligibility is the
 * server's ledger, learnt only from a refusal (B3, ask A10).
 */
export interface PlanVersion {
  id: string;
  code: string | null;
  name: string | null;
  version: string | null;
  /** `null` when the answer carried no readable `Money`. */
  price: Money | null;
  period: PlanPeriod | null;
  limits: QuotaLimit[];
  state: PlanState | null;
}

/** `PlanVersionPage`, as sent: `nextCursor` absent at the end. */
export interface PlanVersionPage {
  items: PlanVersion[];
  nextCursor: string | null;
}

/** `GET /billing/plans`' two parameters, as `GET /tenants` has them. */
export interface ListBillingPlansParams {
  cursor?: string;
  limit?: number;
}

/** `Operation` — the creation's provisioning, read by the never-opened card (DESIGN.md §4.37). */
export interface TenantOperation {
  id: string;
  type: string | null;
  state: OperationState | null;
  createdAt: string | null;
  updatedAt: string | null;
  tenantId: string | null;
  resourceId: string | null;
  /** An `ErrorCode` when the operation failed; kept as its string. */
  failureCode: string | null;
}

/** `CreateTenantRequest`. The name goes trimmed (`trimTenantName`); nothing else is sent — no currency, no buyer. */
export interface CreateTenantInput {
  name: string;
  planVersionId: string;
}

/** `CreateTenantResponse` — the same shape on the first send and on a replay of the same key. */
export interface CreateTenantResult {
  tenant: Tenant;
  /** As the server sent it — **never trusted for its `state`** (develop reports PENDING on every replay, ask A12). */
  operation: TenantOperation;
}

const DECIMAL = /^(0|[1-9][0-9]{0,18})$/;

/** `Money`, or `null` for one whose amount is not a decimal string or whose exponent is not a small whole number. */
export function toMoney(wire: unknown): Money | null {
  if (typeof wire !== "object" || wire === null) return null;
  const row = wire as Record<string, unknown>;
  const amountMinor = typeof row.amountMinor === "string" && DECIMAL.test(row.amountMinor) ? row.amountMinor : null;
  const currency = text(row.currency);
  const exponent =
    typeof row.exponent === "number" && Number.isInteger(row.exponent) && row.exponent >= 0 && row.exponent <= 18
      ? row.exponent
      : null;
  if (amountMinor === null || currency === null || exponent === null) return null;
  return { amountMinor, currency, exponent };
}

/** `QuotaLimit`, or `null` for a row that states neither a limit nor `unlimited`. */
export function toQuotaLimit(wire: unknown): QuotaLimit | null {
  if (typeof wire !== "object" || wire === null) return null;
  const row = wire as Record<string, unknown>;
  const kind = text(row.kind);
  if (kind === null) return null;
  const limit = typeof row.limit === "string" && DECIMAL.test(row.limit) ? row.limit : null;
  if (row.unlimited === true) return { kind, limit: null, unlimited: true };
  return limit === null ? null : { kind, limit, unlimited: false };
}

/** One `PlanVersion`, or `null` for a row without a usable `id` — nothing could be chosen by it. */
export function toPlanVersion(wire: unknown): PlanVersion | null {
  if (typeof wire !== "object" || wire === null) return null;
  const row = wire as Record<string, unknown>;
  const id = text(row.id);
  if (id === null) return null;
  return {
    id,
    code: text(row.code),
    name: text(row.name),
    version: text(row.version),
    price: toMoney(row.price),
    period: text(row.period),
    limits: Array.isArray(row.limits)
      ? row.limits.map(toQuotaLimit).filter((limit): limit is QuotaLimit => limit !== null)
      : [],
    state: text(row.state),
  };
}

/** `PlanVersionPage` in the server's order — the screen orders it (DESIGN.md §4.36). */
export function toPlanVersionPage(wire: unknown): PlanVersionPage {
  const page = typeof wire === "object" && wire !== null ? (wire as Record<string, unknown>) : {};
  const items = Array.isArray(page.items)
    ? page.items.map(toPlanVersion).filter((plan): plan is PlanVersion => plan !== null)
    : [];
  return { items, nextCursor: text(page.nextCursor) };
}

/** One `Operation`, or `null` without a usable `id`. */
export function toTenantOperation(wire: unknown): TenantOperation | null {
  if (typeof wire !== "object" || wire === null) return null;
  const row = wire as Record<string, unknown>;
  const id = text(row.id);
  if (id === null) return null;
  return {
    id,
    type: text(row.type),
    state: text(row.state),
    createdAt: text(row.createdAt),
    updatedAt: text(row.updatedAt),
    tenantId: text(row.tenantId),
    resourceId: text(row.resourceId),
    failureCode: text(row.failureCode),
  };
}

/** `CreateTenantResponse`, or `null` for an answer that holds no company or no operation. */
export function toCreateTenantResult(wire: unknown): CreateTenantResult | null {
  if (typeof wire !== "object" || wire === null) return null;
  const row = wire as Record<string, unknown>;
  const tenant = toTenant(row.tenant);
  const operation = toTenantOperation(row.operation);
  return tenant === null || operation === null ? null : { tenant, operation };
}

/** Every published-or-not plan, all pages, as `readAllTenants` reads the company list. */
export async function readAllPlans(
  list: (params: ListBillingPlansParams) => Promise<PlanVersionPage>,
): Promise<PlanVersion[]> {
  const plans: PlanVersion[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 50; page += 1) {
    const answer = await list(cursor === undefined ? { limit: TENANT_PAGE_MAX } : { cursor, limit: TENANT_PAGE_MAX });
    plans.push(...answer.items);
    if (answer.nextCursor === null || seen.has(answer.nextCursor)) break;
    seen.add(answer.nextCursor);
    cursor = answer.nextCursor;
  }
  return plans;
}

/* --------------------------------------- the company's subscription (TAS-504) */

/** `Subscription.autopayState`. */
export const AUTOPAY_STATES = ["DISABLED", "CONSENTED", "SUSPENDED"] as const;
export type KnownAutopayState = (typeof AUTOPAY_STATES)[number];
/** A value this build knows, or the server's own string as it came — kept, and given no sentence (TAS-173). */
export type AutopayState = KnownAutopayState | (string & {});

/**
 * `Subscription` (`GET /tenants/{t}/billing/subscription`, TAS-314; owner only)
 * as the company page reads it (api-contract-guard §1, B5): `paidThrough` is
 * the one field drawn — «Paid until», as sent, never computed — and is `null`
 * when the answer carried none (a FREE company, one before its first payment,
 * or a server without TAS-314). **Nothing here says whether the company is
 * paid** or whether its coverage is current: a missing `paidThrough` is never
 * read as FREE (B3, ask A16).
 */
export interface Subscription {
  tenantId: string | null;
  planVersionId: string | null;
  /** The entity version, a decimal string. */
  version: string | null;
  /** An instant; the exclusive end of the current paid coverage (ask A37). `null` when absent. */
  paidThrough: string | null;
  autopayState: AutopayState | null;
  renewalCancelled: boolean | null;
  /**
   * TAS-512: the plan version the subscription is scheduled to move to, read
   * as the owner's announced terms (ask A47 — the blueprint does not say whose
   * change it is). `null` when absent. `currentPeriodId` and `anchorDay` are
   * not read: nothing draws them.
   */
  scheduledPlanVersionId: string | null;
  /** When the scheduled plan applies — an instant, or `null` when absent or unreadable. */
  scheduledEffectiveAt: string | null;
}

/** An instant as sent, or `null` for one that is absent, empty or not something `Date` can read (TAS-504; TAS-524's records too). */
export const instant = (value: unknown): string | null => {
  const at = text(value);
  return at === null || Number.isNaN(Date.parse(at)) ? null : at;
};

/** One wire `Subscription`: every field optional, an unknown `autopayState` kept as its string, an unreadable instant dropped. */
export function toSubscription(wire: unknown): Subscription {
  const row = typeof wire === "object" && wire !== null ? (wire as Record<string, unknown>) : {};
  return {
    tenantId: text(row.tenantId),
    planVersionId: text(row.planVersionId),
    version: text(row.version),
    // An instant the page can draw, or nothing: a value `Date` cannot read is not «Paid until» (api-contract-guard M2).
    paidThrough: instant(row.paidThrough),
    autopayState: text(row.autopayState),
    renewalCancelled: typeof row.renewalCancelled === "boolean" ? row.renewalCancelled : null,
    scheduledPlanVersionId: text(row.scheduledPlanVersionId),
    scheduledEffectiveAt: instant(row.scheduledEffectiveAt),
  };
}

/* ----------------------------------------- the company's entitlement (TAS-512) */

/**
 * `Entitlement` (`GET /tenants/{t}/billing/entitlement`, TAS-319; every member
 * of the company) as the Plan page reads it (api-contract-guard §1, B1): the
 * plan the company is on and its limits — of which only `TASK_LIFETIME` is
 * drawn; the other three come from the quota snapshot (B2).
 *
 * **Kept on purpose, nothing more.** `validUntil` is the coverage's end and is
 * money-adjacent — the owner's «Paid until» comes from the subscription only —
 * so it is not read for anybody (B1, ask A52); `coveragePeriodId` and
 * `features` are not read either (no capability is drawn, ask A30);
 * `restrictions` come from `Tenant` (ask A48). The mapper's object has no
 * field for any of them, so no screen can reach one.
 */
export interface Entitlement {
  tenantId: string | null;
  /** The entity version, a decimal string. */
  version: string | null;
  planVersionId: string | null;
  limits: QuotaLimit[];
}

/** One wire `Entitlement`: every field optional, an unusable limit row dropped, an unknown kind kept as it came. */
export function toEntitlement(wire: unknown): Entitlement {
  const row = typeof wire === "object" && wire !== null ? (wire as Record<string, unknown>) : {};
  return {
    tenantId: text(row.tenantId),
    version: typeof row.version === "string" && DECIMAL.test(row.version) ? row.version : null,
    planVersionId: text(row.planVersionId),
    limits: Array.isArray(row.limits)
      ? row.limits.map(toQuotaLimit).filter((limit): limit is QuotaLimit => limit !== null)
      : [],
  };
}

/**
 * A company read whose answer names another company (TAS-512,
 * api-contract-guard B3): the read fails — nothing of it is drawn, under any
 * company's name. The client's own rule, so its message is empty: no client
 * words are ever shown as the server's, and it carries no status, code or
 * request id for `apiErrorFacts` to find.
 */
export class ForeignCompanyAnswerError extends Error {
  constructor() {
    super("");
    this.name = "ForeignCompanyAnswerError";
  }
}

/**
 * The answer, unless it names a company other than `tenantId` — a present
 * `tenantId` that differs is `ForeignCompanyAnswerError`. An answer that names
 * none is the requested company's: the session it went with is.
 */
export function ofCompany<T extends { tenantId: string | null }>(answer: T, tenantId: string): T {
  if (answer.tenantId !== null && answer.tenantId !== tenantId) throw new ForeignCompanyAnswerError();
  return answer;
}

/* -------------------------------------------------------- the company's name */

/**
 * `CreateTenantRequest.name`'s and `RenameTenantRequest.name`'s `maxLength` —
 * the blueprint's 120 (develop allows 128, ask A13). One rule for creating and
 * renaming (TAS-504, ask A38).
 */
export const TENANT_NAME_MAX = 120;

/** A control character (`\p{Cc}`) — never part of a company's name (DESIGN.md §4.36). */
const CONTROL = /\p{Cc}/gu;

/** What a typed name keeps: everything but its control characters. Applied as the reader types. */
export const withoutControlCharacters = (value: string) => value.replace(CONTROL, "");

/** The name as it is sent: trimmed at both ends. */
export const trimTenantName = (value: string) => value.trim();

/**
 * The one name rule, shared by the form and the mock server (api-contract-guard
 * §9 parity): a name is sent trimmed, 1–120 code points, with no control
 * character. `null` — acceptable; otherwise what is wrong with it.
 */
export function tenantNameProblem(name: string): "empty" | "untrimmed" | "too-long" | "control" | null {
  if (name.length === 0) return "empty";
  if (name !== name.trim()) return "untrimmed";
  if (new RegExp(CONTROL.source, "u").test(name)) return "control";
  if ([...name].length > TENANT_NAME_MAX) return "too-long";
  return null;
}
