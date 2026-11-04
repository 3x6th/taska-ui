import { apiErrorFacts } from "../errors";
import type { LoginInput } from "../TaskaApi";
import { tenantNameProblem, type CreateTenantInput, type ListBillingPlansParams, type ListTenantsParams } from "../tenants";
import type { B2bTransport } from "../webSession";
import { MOCK_ACCOUNT_IDS, MOCK_PROJECT_IDS, MockTaskaStore, type MockTenantSeed } from "./MockTaskaApi";

/*
 * The companies build's mock server (TAS-500, api-contract-guard §7, B7): the
 * B2B blueprint's session routes, and the session check in front of every data
 * call, enforced — not a flag that says somebody signed in. A data call's
 * bearer resolves to a session, the session to a company, and the company to
 * its own `MockTaskaStore`; a credential of the wrong kind, an expired or
 * revoked one, a suspended membership or a paused company is refused here the
 * way the blueprint says the gateway will refuse it.
 *
 * **Shared by every tab** through `localStorage` `taska.mockServer.v2`: the
 * companies, memberships, sessions and tokens — and since TAS-501 the FREE
 * ledger, the creations' operations and their durable receipts — read and
 * written on every operation, so a second tab — or a duplicated one — meets
 * the same server. (v1 was TAS-500's; the bump re-seeds, signing every mock
 * account out once.)
 * Each company's projects and issues are this page's own, in memory, as
 * today's mock's are: they reset with a reload.
 *
 * This narrows docs/ai/API-DIVERGENCE.md's "The mock has a session flag but no
 * session enforcement" for the companies build only; today's build's mock is
 * untouched and enforces nothing.
 */

export const MOCK_SERVER_KEY = "taska.mockServer.v2";

/**
 * `localStorage` key for the server's test hooks, as JSON — the seam
 * `taska.mockAuthMethods` set (src/api/mock/mockAuthFixtures.ts): the e2e suite
 * sets it with `page.addInitScript` or `page.evaluate`, a person clicking
 * through sets it in the console, and it is read on every operation.
 *
 * - `suspend`: memberships answered as `SUSPENDED` whatever their state, as
 *   `[{"tenantId": "…", "userId": "…"}]` — take one out and it is active again;
 * - `accessTtlSeconds`: the lifetime of every access token issued from now on
 *   (the blueprint's is 60–900; default 900), to make renewal happen;
 * - `delayMs`: extra latency per operation, keyed by a blueprint operation id
 *   (`startWebSession`, `refreshWebSession`, `listTenants`,
 *   `createTenantSession`, `revokeTenantSession`) or a `TaskaApi` method name;
 * - `contentReadUnderRestriction`: the global flag below for this browser —
 *   `false` refuses every content read of a paused or blocked company with 403
 *   `CAPABILITY_DISABLED` and its restrictions (ask A2c). A company awaiting its
 *   first payment refuses them whatever the flag says (TAS-501, B5).
 *
 * Creating a company (TAS-501, api-contract-guard §9):
 *
 * - `clockOffsetMs`: moves the **lifecycle clock** — deadlines, provisioning,
 *   new companies' `createdAt` — and nothing else (tokens keep the real one),
 *   so `+ 11 days` closes Stark Industries on the next read;
 * - `provisioning`: `{stepMs, outcome, failureCode}` — an operation is PENDING
 *   for `stepMs` (default 1200), RUNNING for as long again, then `outcome`
 *   (`SUCCEEDED` by default, or `FAILED` / `MANUAL_REVIEW`); a FREE company
 *   turns ACTIVE when its operation succeeds and stays PROVISIONING otherwise;
 * - `refuseNext`: `{[operation]: {status, code, reasons?, retryAfterSeconds?}}`,
 *   the next call of that operation refused so — once, then forgotten (429,
 *   503, 422, 409 PAYMENT_PENDING…);
 * - `loseAnswer`: `["createTenant"]` — the next creation commits and then
 *   answers like a dropped connection, once (the reload replays it);
 * - `firstPaymentConfirmed`: `[tenantId]` — an AWAITING_PAYMENT company opens
 *   (stands in for TAS-513);
 * - `latePaymentConfirmed`: `[tenantId]` — an AUTO_CLOSED company opens
 *   (D216); never an OWNER_CANCELLED one.
 *
 * Everything time- or hook-driven is evaluated on every read of the server's
 * state: there are no timers.
 */
export const MOCK_TENANT_HOOKS_KEY = "taska.mockTenantHooks";

export interface MockRefusalHook {
  status: number;
  code: string;
  title?: string;
  reasons?: string[];
  retryAfterSeconds?: number;
}

export interface MockTenantHooks {
  suspend?: Array<{ tenantId: string; userId: string }>;
  accessTtlSeconds?: number;
  delayMs?: Record<string, number>;
  contentReadUnderRestriction?: boolean;
  clockOffsetMs?: number;
  provisioning?: { stepMs?: number; outcome?: string; failureCode?: string };
  refuseNext?: Record<string, MockRefusalHook>;
  loseAnswer?: string[];
  firstPaymentConfirmed?: string[];
  latePaymentConfirmed?: string[];
}

/** The fixture companies' ids (fixed, `createdAt` ascending in this order). */
export const MOCK_TENANT_IDS = {
  northwind: "0b6f3c1e-4a2d-4e8b-9c7f-1d2e3f4a5b01",
  globex: "0b6f3c1e-4a2d-4e8b-9c7f-1d2e3f4a5b02",
  initech: "0b6f3c1e-4a2d-4e8b-9c7f-1d2e3f4a5b03",
  umbrella: "0b6f3c1e-4a2d-4e8b-9c7f-1d2e3f4a5b04",
  hooli: "0b6f3c1e-4a2d-4e8b-9c7f-1d2e3f4a5b05",
  massive: "0b6f3c1e-4a2d-4e8b-9c7f-1d2e3f4a5b06",
  longName: "0b6f3c1e-4a2d-4e8b-9c7f-1d2e3f4a5b07",
  /** TAS-501: Tom's company awaiting its first payment, the deadline ~10 days ahead. */
  stark: "0b6f3c1e-4a2d-4e8b-9c7f-1d2e3f4a5b08",
  /** TAS-501: Tom's cancelled creation. */
  wayne: "0b6f3c1e-4a2d-4e8b-9c7f-1d2e3f4a5b09",
  /** TAS-501: Sofia's deleted FREE company, unlisted — deletion did not give her FREE back. */
  vandelay: "0b6f3c1e-4a2d-4e8b-9c7f-1d2e3f4a5b0a",
} as const;

/**
 * The mock's catalogue (TAS-501): fixed ids, the mock's own codes — the UI
 * never compares a code. Free and Team are `PUBLISHED`; Team's first version is
 * `RETIRED`, listed and never offered, so the screen's filter has something to
 * leave out.
 */
export const MOCK_PLAN_IDS = {
  free: "7d2c4e1a-5b3f-4a6c-9e8d-0f1a2b3c4d01",
  team: "7d2c4e1a-5b3f-4a6c-9e8d-0f1a2b3c4d02",
  teamRetired: "7d2c4e1a-5b3f-4a6c-9e8d-0f1a2b3c4d03",
} as const;

interface MockPlan {
  id: string;
  code: string;
  version: string;
  name: string;
  price: { amountMinor: string; currency: string; exponent: number };
  period: string;
  limits: Array<{ kind: string; limit?: string; unlimited: boolean }>;
  capabilities: string[];
  state: string;
  publishedAt: string;
}

const MOCK_PLANS: readonly MockPlan[] = [
  {
    id: MOCK_PLAN_IDS.free,
    code: "mock-free",
    version: "1",
    name: "Free",
    price: { amountMinor: "0", currency: "EUR", exponent: 2 },
    period: "NONE",
    limits: [
      { kind: "PROJECT", limit: "1", unlimited: false },
      { kind: "SEAT", limit: "5", unlimited: false },
      { kind: "STORAGE_BYTES", limit: "100000000", unlimited: false },
      { kind: "TASK_LIFETIME", limit: "50", unlimited: false },
    ],
    capabilities: ["projects.basic"],
    state: "PUBLISHED",
    publishedAt: "2026-05-01T00:00:00Z",
  },
  {
    id: MOCK_PLAN_IDS.teamRetired,
    code: "mock-team",
    version: "1",
    name: "Team",
    price: { amountMinor: "1500", currency: "EUR", exponent: 2 },
    period: "CALENDAR_MONTH",
    limits: [
      { kind: "PROJECT", limit: "3", unlimited: false },
      { kind: "SEAT", limit: "25", unlimited: false },
    ],
    capabilities: ["projects.basic"],
    state: "RETIRED",
    publishedAt: "2026-01-01T00:00:00Z",
  },
  {
    id: MOCK_PLAN_IDS.team,
    code: "mock-team",
    version: "2",
    name: "Team",
    price: { amountMinor: "2000", currency: "EUR", exponent: 2 },
    period: "CALENDAR_MONTH",
    limits: [
      { kind: "PROJECT", limit: "5", unlimited: false },
      { kind: "SEAT", limit: "50", unlimited: false },
      { kind: "STORAGE_BYTES", limit: "5000000000", unlimited: false },
      { kind: "TASK_LIFETIME", unlimited: true },
    ],
    capabilities: ["projects.basic", "projects.unlimited-issues"],
    state: "PUBLISHED",
    publishedAt: "2026-05-01T00:00:00Z",
  },
];

/** The projects the fixture companies add of their own (fixed ids). Globex's WEB shares its key with Northwind's. */
export const MOCK_TENANT_PROJECT_IDS = {
  globexWeb: "5a1e9c3d-7b2f-4d6a-8e0c-2f4b6d8a0c01",
  globexFinance: "5a1e9c3d-7b2f-4d6a-8e0c-2f4b6d8a0c02",
  initechHelpdesk: "5a1e9c3d-7b2f-4d6a-8e0c-2f4b6d8a0c03",
  umbrellaResearch: "5a1e9c3d-7b2f-4d6a-8e0c-2f4b6d8a0c04",
  hooliSearch: "5a1e9c3d-7b2f-4d6a-8e0c-2f4b6d8a0c05",
  longNameProject: "5a1e9c3d-7b2f-4d6a-8e0c-2f4b6d8a0c07",
} as const;

/** A company name at the blueprint's maximum, 120 characters, for the layout review. */
export const MOCK_LONG_TENANT_NAME =
  "Consolidated Intercontinental Widget Manufacturing and Logistics Holdings of Northern Europe, Asia and the Pacific Coast";

const { anna, sofia, tom, priya } = MOCK_ACCOUNT_IDS;

type MembershipRole = "TENANT_ADMIN" | "MEMBER";
type MembershipState = "ACTIVE" | "SUSPENDED" | "REMOVED";

interface StoredTenant {
  id: string;
  name: string;
  ownerId: string;
  lifecycle: string;
  restrictions: string[];
  createdAt: string;
  creationDeadline?: string;
  version: string;
  ownerVersion: string;
}

interface StoredMembership {
  tenantId: string;
  userId: string;
  role: MembershipRole;
  state: MembershipState;
  version: number;
}

type SessionKind = "WEB_GLOBAL" | "WEB_TENANT";

interface StoredSession {
  id: string;
  kind: SessionKind;
  userId: string;
  tenantId?: string;
  /** A company session's account session: it is revoked with it and expires with it (PR #288). */
  parentId?: string;
  /** The family's absolute end — 7 days, PR #288's (contracts §11 allows 1–90). */
  expiresAt: number;
  revokedAt?: number;
}

interface WireAccessSession {
  sessionId: string;
  userId: string;
  tenantId?: string;
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
  expiresIn: number;
  mfaVerified: boolean;
}

interface StoredRefresh {
  sessionId: string;
  spentAt?: number;
  /** The rotation that spent it: the same key within 60 s answers the same pair (contracts §7). */
  receipt?: { key: string; at: number; answer: WireAccessSession };
}

interface StoredReceipt {
  operation: string;
  hash: string;
  at: number;
  answer: unknown;
}

/** A creation's provisioning (TAS-501). `state` moves with the lifecycle clock until it is terminal, then stays. */
interface StoredOperation {
  id: string;
  tenantId: string;
  actorId: string;
  type: string;
  createdAt: string;
  state: string;
  updatedAt: string;
  failureCode?: string;
}

/**
 * A creation's receipt — **durable**, unlike the 60-second secret receipt of
 * the session routes (B2): develop replays a creation by reading the company
 * row, for as long as the key exists. Keyed by `{actor}:{key}`; `hash` is the
 * body exactly as sent.
 */
interface StoredCreation {
  hash: string;
  tenantId: string;
  operationId: string;
}

interface ServerState {
  v: 2;
  tenants: StoredTenant[];
  memberships: StoredMembership[];
  sessions: StoredSession[];
  access: Record<string, { sessionId: string; expiresAt: number }>;
  refresh: Record<string, StoredRefresh>;
  receipts: Record<string, StoredReceipt>;
  /** Who has used their one FREE company, and on which (contracts §8): by account, never restored. */
  freeLedger: Record<string, string>;
  operations: StoredOperation[];
  creations: Record<string, StoredCreation>;
  /** Cancel receipts, `{actor}:{key}` — the answer a replay of the same key gets. */
  cancels: Record<string, { hash: string; answer: unknown }>;
}

/**
 * A refusal as the blueprint's gateway answers one: an HTTP status and a
 * `Problem` — `code`, `title` as the message, `requestId`, `reasons`. Read by
 * the same duck-typed helpers as `ApiError` (`apiErrorFacts`, `refusalCode`,
 * `refusalReasons`), so the session layer cannot tell the two apart — which is
 * the point. `details` is always `null`: a Problem has none.
 */
export class MockProblemError extends Error {
  readonly details = null;
  readonly requestId: string;

  constructor(
    readonly status: number,
    readonly code: string,
    title: string,
    readonly reasons: readonly string[] = [],
    /** The wait a 429 names — `Retry-After` on the wire (api-contract-guard N1). */
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(title);
    this.name = "MockProblemError";
    this.requestId = uuid();
  }
}

const problem = (status: number, code: string, title: string, reasons: readonly string[] = [], retryAfterSeconds: number | null = null) =>
  new MockProblemError(status, code, title, reasons, retryAfterSeconds);

const uuid = () =>
  globalThis.crypto?.randomUUID?.() ??
  "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** An `Idempotency-Key` develop accepts for a creation: a canonical, lowercase UUID (`TenantRegistryService.java:81`). */
const CANONICAL_KEY = UUID_PATTERN;

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const FAMILY_LIFETIME_MS = 7 * DAY;
const SECRET_RECEIPT_MS = 60_000;
const DEFAULT_ACCESS_TTL_S = 900;
/** The window a paid creation has for its first payment — develop's default (the blueprint allows 1–90 days). */
const CREATION_WINDOW_MS = 30 * DAY;
const DEFAULT_PROVISIONING_STEP_MS = 1200;
const TERMINAL_OPERATION_STATES: ReadonlySet<string> = new Set(["SUCCEEDED", "FAILED", "MANUAL_REVIEW"]);
const nextVersion = (version: string) => (/^[0-9]+$/.test(version) ? (BigInt(version) + 1n).toString() : "1");
/**
 * Whether a paused or blocked company's projects can still be read — the
 * blueprint leaves it to a separate global flag (contracts §5). **This mock's
 * value: true**, so Initech and Hooli read and refuse every write with
 * `READ_ONLY` and their restrictions as `reasons`.
 */
export const MOCK_PROJECT_CONTENT_READ_UNDER_RESTRICTION = true;

/**
 * What a `MockTenantServer` call is, for the session check: the routes of a
 * company (`tenant-read`, `tenant-write`, and `tenant-self` — the reader's own
 * notifications and their settings, which a restriction does not stop), and
 * the account's own routes (`account`), which either session may call.
 */
export type MockRouteKind = "tenant-read" | "tenant-write" | "tenant-self" | "account";

/**
 * The fixture companies (api-contract-guard §7, with art-director's layout
 * account). Anna signs in to three: Northwind (owner, company admin), Globex
 * (member, OPS only), Initech (member; paused). Umbrella has suspended her and
 * is not listed. Sofia — the layout account — has five: Northwind, Initech
 * (owner), Hooli (blocked by Taska), Massive Dynamic (closed) and one with a
 * 120-character name. Nina has none. Mark is the GLOBAL_ADMIN and never gets a
 * session.
 *
 * TAS-501 adds the creation's states on Tom (api-contract-guard §9): Stark
 * Industries awaiting its first payment, created 20 days before the seed with
 * the 30-day window — so its deadline is ~10 days ahead; Wayne Enterprises,
 * cancelled; and Massive Dynamic, closed since its deadline passed in June.
 * The FREE ledger: Anna used hers on Northwind, Priya on Globex, and Sofia on
 * Vandelay — deleted and unlisted, because deleting a company does not give
 * the allowance back; Nina and Tom have theirs.
 */
function seedTenants(seedAt: number): Pick<ServerState, "tenants" | "memberships" | "freeLedger"> {
  const at = (day: number) => `2026-05-${String(day).padStart(2, "0")}T09:00:00Z`;
  const iso = (ms: number) => new Date(ms).toISOString();
  const tenant = (
    id: string,
    name: string,
    ownerId: string,
    day: number,
    lifecycle = "ACTIVE",
    restrictions: string[] = [],
  ): StoredTenant => ({ id, name, ownerId, lifecycle, restrictions, createdAt: at(day), version: "3", ownerVersion: "1" });
  const member = (tenantId: string, userId: string, role: MembershipRole, state: MembershipState = "ACTIVE") => ({
    tenantId,
    userId,
    role,
    state,
    version: 1,
  });
  const ids = MOCK_TENANT_IDS;
  return {
    tenants: [
      tenant(ids.northwind, "Northwind", anna, 1),
      tenant(ids.globex, "Globex", priya, 2),
      tenant(ids.initech, "Initech", sofia, 3, "ACTIVE", ["OWNER_PAUSE"]),
      tenant(ids.umbrella, "Umbrella", tom, 4),
      tenant(ids.hooli, "Hooli", priya, 5, "ACTIVE", ["PLATFORM_BLOCK"]),
      {
        ...tenant(ids.massive, "Massive Dynamic", tom, 6, "AUTO_CLOSED", ["PENDING_FIRST_PAYMENT"]),
        creationDeadline: "2026-06-05T09:00:00Z",
      },
      tenant(ids.longName, MOCK_LONG_TENANT_NAME, priya, 7),
      {
        ...tenant(ids.stark, "Stark Industries", tom, 8, "AWAITING_PAYMENT", ["PENDING_FIRST_PAYMENT"]),
        createdAt: iso(seedAt - 20 * DAY),
        creationDeadline: iso(seedAt - 20 * DAY + CREATION_WINDOW_MS),
        version: "1",
      },
      {
        ...tenant(ids.wayne, "Wayne Enterprises", tom, 9, "OWNER_CANCELLED", ["PENDING_FIRST_PAYMENT"]),
        createdAt: iso(seedAt - 5 * DAY),
        creationDeadline: iso(seedAt - 5 * DAY + CREATION_WINDOW_MS),
        version: "2",
      },
      tenant(ids.vandelay, "Vandelay Industries", sofia, 10, "DELETED"),
    ],
    memberships: [
      member(ids.northwind, anna, "TENANT_ADMIN"),
      member(ids.northwind, sofia, "MEMBER"),
      member(ids.northwind, tom, "MEMBER"),
      member(ids.globex, priya, "TENANT_ADMIN"),
      member(ids.globex, anna, "MEMBER"),
      member(ids.initech, sofia, "TENANT_ADMIN"),
      member(ids.initech, anna, "MEMBER"),
      member(ids.umbrella, tom, "TENANT_ADMIN"),
      member(ids.umbrella, anna, "MEMBER", "SUSPENDED"),
      member(ids.hooli, priya, "TENANT_ADMIN"),
      member(ids.hooli, sofia, "MEMBER"),
      member(ids.massive, tom, "TENANT_ADMIN"),
      member(ids.massive, sofia, "MEMBER"),
      member(ids.longName, priya, "TENANT_ADMIN"),
      member(ids.longName, sofia, "MEMBER"),
      member(ids.stark, tom, "TENANT_ADMIN"),
      member(ids.wayne, tom, "TENANT_ADMIN"),
      member(ids.vandelay, sofia, "TENANT_ADMIN", "REMOVED"),
    ],
    freeLedger: { [anna]: ids.northwind, [priya]: ids.globex, [sofia]: ids.vandelay },
  };
}

/**
 * Each company's projects. Northwind is today's seed's TAS, WEB and MOB — with
 * Anna, its admin, on all three, Sofia on WEB only, Tom a viewer of TAS and
 * MOB as before; Mark and Priya, who are not in Northwind, are not on them.
 * Globex keeps OPS (Priya, and Anna as a member) and adds a WEB of its own —
 * another id, the same key, numbered from 12 as Northwind's is, so
 * `/browse/WEB-12` is a different issue in each — and FIN, neither of which
 * Anna is on.
 */
const TENANT_SEEDS: Readonly<Record<string, MockTenantSeed>> = {
  [MOCK_TENANT_IDS.northwind]: {
    keep: [
      { projectId: MOCK_PROJECT_IDS.taska, members: [[anna, "ADMIN"], [tom, "VIEWER"]] },
      { projectId: MOCK_PROJECT_IDS.web, members: [[anna, "ADMIN"], [sofia, "MEMBER"]] },
      { projectId: MOCK_PROJECT_IDS.mob, members: [[anna, "ADMIN"], [tom, "VIEWER"]] },
    ],
    add: [],
  },
  [MOCK_TENANT_IDS.globex]: {
    keep: [{ projectId: MOCK_PROJECT_IDS.ops, members: [[priya, "ADMIN"], [anna, "MEMBER"]] }],
    add: [
      {
        id: MOCK_TENANT_PROJECT_IDS.globexWeb,
        key: "WEB",
        name: "Globex Web",
        description: "Globex's storefront",
        createdAt: "2026-06-09T09:00:00Z",
        members: [[priya, "ADMIN"]],
        firstNumber: 12,
        issues: [
          {
            summary: "Checkout button overlaps the basket total on narrow screens",
            issueType: "BUG",
            status: "TODO",
            priority: "HIGH",
            assigneeId: priya,
            reporterId: priya,
          },
          {
            summary: "Translate the storefront into Spanish",
            issueType: "TASK",
            status: "IN_PROGRESS",
            priority: "MEDIUM",
            assigneeId: null,
            reporterId: priya,
          },
        ],
      },
      {
        id: MOCK_TENANT_PROJECT_IDS.globexFinance,
        key: "FIN",
        name: "Finance",
        description: "Invoices and quarterly close",
        createdAt: "2026-06-09T09:01:00Z",
        members: [[priya, "ADMIN"]],
        issues: [
          {
            summary: "Close Q2 books",
            issueType: "TASK",
            status: "TODO",
            priority: "HIGH",
            assigneeId: priya,
            reporterId: priya,
          },
        ],
      },
    ],
  },
  [MOCK_TENANT_IDS.initech]: {
    keep: [],
    add: [
      {
        id: MOCK_TENANT_PROJECT_IDS.initechHelpdesk,
        key: "HLP",
        name: "Helpdesk",
        description: "Internal IT requests",
        createdAt: "2026-06-09T09:02:00Z",
        members: [[sofia, "ADMIN"], [anna, "MEMBER"]],
        issues: [
          {
            summary: "Replace the printer on floor 3",
            issueType: "TASK",
            status: "TODO",
            priority: "LOW",
            assigneeId: anna,
            reporterId: sofia,
          },
          {
            summary: "TPS report cover sheets are out of stock",
            issueType: "BUG",
            status: "IN_PROGRESS",
            priority: "MEDIUM",
            assigneeId: sofia,
            reporterId: sofia,
          },
        ],
      },
    ],
  },
  [MOCK_TENANT_IDS.umbrella]: {
    keep: [],
    add: [
      {
        id: MOCK_TENANT_PROJECT_IDS.umbrellaResearch,
        key: "RND",
        name: "Research",
        createdAt: "2026-06-09T09:03:00Z",
        members: [[tom, "ADMIN"]],
        issues: [],
      },
    ],
  },
  [MOCK_TENANT_IDS.hooli]: {
    keep: [],
    add: [
      {
        id: MOCK_TENANT_PROJECT_IDS.hooliSearch,
        key: "HOO",
        name: "Hooli Search",
        createdAt: "2026-06-09T09:04:00Z",
        members: [[priya, "ADMIN"], [sofia, "MEMBER"]],
        issues: [
          {
            summary: "Middle-out compression benchmark",
            issueType: "TASK",
            status: "TODO",
            priority: "MEDIUM",
            assigneeId: sofia,
            reporterId: priya,
          },
        ],
      },
    ],
  },
  [MOCK_TENANT_IDS.longName]: {
    keep: [],
    add: [
      {
        id: MOCK_TENANT_PROJECT_IDS.longNameProject,
        key: "LNG",
        name: "Fulfilment",
        createdAt: "2026-06-09T09:05:00Z",
        members: [[priya, "ADMIN"], [sofia, "MEMBER"]],
        issues: [
          {
            summary: "Label printer queue stalls after 500 jobs",
            issueType: "BUG",
            status: "TODO",
            priority: "HIGH",
            assigneeId: null,
            reporterId: priya,
          },
        ],
      },
    ],
  },
};

const EMPTY_SEED: MockTenantSeed = { keep: [], add: [] };

/** The two ends that close a company to new sessions in this mock (blueprint silent, ask A2). */
const CLOSED_LIFECYCLES: ReadonlySet<string> = new Set(["AUTO_CLOSED", "OWNER_CANCELLED", "DELETING"]);

export interface MockTenantServerOptions {
  storage: Storage;
  /** The account directory and the account's own routes: the store sign-in checks passwords against. */
  accountStore: MockTaskaStore;
  /** Base latency of a session route, ms (default 80); data routes keep the store's own. Tests pass 0. */
  latencyMs?: number;
  /** The clock, for tests. */
  now?: () => number;
}

export class MockTenantServer {
  private readonly storage: Storage;
  private readonly accountStore: MockTaskaStore;
  private readonly latencyMs: number;
  private readonly now: () => number;
  /** This page's company stores, built on first use from `TENANT_SEEDS`. */
  private readonly stores = new Map<string, MockTaskaStore>();
  /** Used only when `storage` refuses (a locked-down profile): the state then lives as long as the page. */
  private memory: ServerState | null = null;

  constructor(options: MockTenantServerOptions) {
    this.storage = options.storage;
    this.accountStore = options.accountStore;
    this.latencyMs = options.latencyMs ?? 80;
    this.now = options.now ?? Date.now;
    // Nina is today's seed's BLOCKED account; here she is the account without
    // a company, so she has to be able to sign in.
    this.accountStore.overrideAccountStatus(MOCK_ACCOUNT_IDS.nina, "ACTIVE");
  }

  /** The blueprint routes the session layer sends — TAS-500's five, and TAS-501's creation routes. */
  transport(): B2bTransport {
    return {
      startWebSession: (input, key) => this.startWebSession(input, key),
      refreshWebSession: (refreshToken, key) => this.refreshWebSession(refreshToken, key),
      listTenants: (bearer, params) => this.listTenants(bearer, params),
      createTenantSession: (bearer, tenantId, key) => this.createTenantSession(bearer, tenantId, key),
      revokeTenantSession: (bearer, tenantSessionId) => this.revokeTenantSession(bearer, tenantSessionId),
      listBillingPlans: (params) => this.listBillingPlans(params),
      createTenant: (bearer, input, key) => this.createTenant(bearer, input, key),
      getTenant: (bearer, tenantId) => this.getTenant(bearer, tenantId),
      getTenantOperation: (bearer, tenantId, operationId) => this.getTenantOperation(bearer, tenantId, operationId),
      cancelTenantCreation: (bearer, tenantId, version, key) => this.cancelTenantCreation(bearer, tenantId, version, key),
    };
  }

  /**
   * One data call: the bearer checked against `kind`, then `run` on the store
   * it opens — the company's for a company route, the account's for the
   * account's own — signed in as the bearer's account.
   */
  async serve<T>(bearer: string | null, kind: MockRouteKind, operation: string, run: (store: MockTaskaStore) => Promise<T>): Promise<T> {
    await this.delay(operation, 0);
    const { grant, members } = this.read((state) => {
      const granted = this.authorize(state, bearer, kind);
      const tenantId = granted.tenantId;
      // The company's directory is its active members (TENANT_DIRECTORY, backend TAS-321).
      const active =
        tenantId === null
          ? null
          : new Set(
              state.memberships
                .filter((item) => item.tenantId === tenantId && this.membershipState(state, tenantId, item.userId) === "ACTIVE")
                .map((item) => item.userId),
            );
      return { grant: granted, members: active };
    });
    const store = kind === "account" || grant.tenantId === null ? this.accountStore : this.tenantStore(grant.tenantId);
    if (!store.restoreSession(grant.userId)) throw problem(401, "AUTHENTICATION_REQUIRED", "Invalid session");
    if (store !== this.accountStore) store.scopeDirectory(members);
    return run(store);
  }

  /* ------------------------------------------------------------ the routes */

  /**
   * `POST /auth/web-sessions`. The password is checked as today's mock checks
   * it (any password for an `ACTIVE` account; a locked account's refusal as
   * it is). A GLOBAL_ADMIN gets the blueprint's `MfaChallenge` and no session
   * — backend PR #288 answers 403 `MFA_REQUIRED` instead, which the session
   * layer reads as the same dead end (unit-tested against `RestTaskaApi`).
   */
  private async startWebSession(input: LoginInput, key: string): Promise<unknown> {
    await this.delay("startWebSession");
    return this.write((state) => {
      const replay = this.replay(state, key, "startWebSession", input.email);
      if (replay !== undefined) return replay;
      try {
        this.accountStore.login(input);
      } catch (error) {
        if (apiErrorFacts(error).code === "UNAUTHENTICATED") throw problem(401, "AUTHENTICATION_REQUIRED", "Invalid credentials");
        throw error;
      }
      const user = this.accountStore.currentUser();
      let answer: unknown;
      if (user.globalRole === "GLOBAL_ADMIN") {
        answer = {
          challengeId: uuid(),
          purpose: "ADMIN_LOGIN",
          expiresAt: new Date(this.now() + 10 * MINUTE).toISOString(),
          delivery: "EMAIL",
          maskedDestination: user.email.replace(/^(.).*(@.*)$/, "$1•••$2"),
          retryAfterSeconds: 60,
        };
      } else {
        const session: StoredSession = { id: uuid(), kind: "WEB_GLOBAL", userId: user.id, expiresAt: this.now() + FAMILY_LIFETIME_MS };
        state.sessions.push(session);
        answer = this.issue(state, session);
      }
      state.receipts[key] = { operation: "startWebSession", hash: input.email, at: this.now(), answer };
      return answer;
    });
  }

  /**
   * `POST /auth/web-sessions/refresh`, for both families. Single use: the
   * spent token with the same key within 60 s answers the same pair, after
   * that 409 `INVALID_STATE`; with a different key it is a reuse, which
   * revokes the family — an account session with every company session under
   * it. Every other refusal is backend PR #288's one 401 "Invalid session",
   * including a company session whose membership is no longer active (ask A3).
   */
  private async refreshWebSession(refreshToken: string, key: string): Promise<unknown> {
    await this.delay("refreshWebSession");
    return this.write((state) => {
      const entry = state.refresh[refreshToken];
      if (!entry) throw problem(401, "AUTHENTICATION_REQUIRED", "Invalid session");
      const session = state.sessions.find((item) => item.id === entry.sessionId);
      if (!session) throw problem(401, "AUTHENTICATION_REQUIRED", "Invalid session");
      if (entry.spentAt !== undefined) {
        if (entry.receipt && entry.receipt.key === key) {
          if (this.now() - entry.receipt.at <= SECRET_RECEIPT_MS) return entry.receipt.answer;
          throw problem(409, "INVALID_STATE", "The refresh was already used");
        }
        this.revokeFamily(state, session);
        throw problem(401, "TOKEN_REVOKED", "Invalid session");
      }
      if (!this.alive(state, session)) throw problem(401, "TOKEN_REVOKED", "Invalid session");
      if (session.kind === "WEB_TENANT" && this.membershipState(state, session.tenantId ?? "", session.userId) !== "ACTIVE") {
        session.revokedAt = this.now();
        throw problem(401, "TOKEN_REVOKED", "Invalid session");
      }
      const answer = this.issue(state, session);
      entry.spentAt = this.now();
      entry.receipt = { key, at: this.now(), answer };
      return answer;
    });
  }

  /**
   * `GET /tenants`: the companies the reader is an `ACTIVE` member of — which
   * is the mock's reading of a list the blueprint leaves unstated (ask A1) — in
   * `(createdAt, id)` order, `limit` 1–100 (default 50), an opaque cursor bound
   * to the reader, `nextCursor` absent at the end.
   */
  private async listTenants(bearer: string, params: ListTenantsParams): Promise<unknown> {
    await this.delay("listTenants");
    return this.read((state) => {
      const grant = this.authorizeCommand(state, bearer);
      const limit = params.limit ?? 50;
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw problem(400, "VALIDATION_FAILED", "limit must be 1–100");
      const offset = params.cursor === undefined ? 0 : this.readCursor(params.cursor, grant.userId);
      const listed = state.tenants
        .filter((tenant) => this.membershipState(state, tenant.id, grant.userId) === "ACTIVE")
        .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const items = listed.slice(offset, offset + limit).map((tenant) => ({ ...tenant, restrictions: [...tenant.restrictions] }));
      const next = offset + limit;
      return next < listed.length ? { items, nextCursor: this.writeCursor(next, grant.userId) } : { items };
    });
  }

  /**
   * `POST /auth/tenant-sessions`. Who may: an `ACTIVE` member. A company the
   * reader is not in is the same 404 `TENANT_NOT_FOUND` as one that does not
   * exist; a suspended membership is 403 `MEMBERSHIP_INACTIVE`; a deleted
   * company is 404; and **this mock's** answer for a closed one (`AUTO_CLOSED`,
   * `OWNER_CANCELLED`, `DELETING`) is 409 `INVALID_STATE` — the blueprint does
   * not say (ask A2), so the screens render whatever the answer is.
   */
  private async createTenantSession(bearer: string, tenantId: string, key: string): Promise<unknown> {
    await this.delay("createTenantSession");
    return this.write((state) => {
      const grant = this.authorizeCommand(state, bearer);
      const replay = this.replay(state, key, "createTenantSession", tenantId);
      if (replay !== undefined) return replay;
      if (!UUID_PATTERN.test(tenantId)) throw problem(400, "VALIDATION_FAILED", "tenantId must be a UUID");
      const tenant = state.tenants.find((item) => item.id === tenantId);
      const membership = this.membershipState(state, tenantId, grant.userId);
      if (!tenant || membership === null || membership === "REMOVED" || tenant.lifecycle === "DELETED") {
        throw problem(404, "TENANT_NOT_FOUND", "Tenant not found");
      }
      if (membership !== "ACTIVE") throw problem(403, "MEMBERSHIP_INACTIVE", "Membership is not active");
      if (CLOSED_LIFECYCLES.has(tenant.lifecycle)) throw problem(409, "INVALID_STATE", "The company is closed");
      const parent = state.sessions.find((item) => item.id === grant.sessionId);
      const session: StoredSession = {
        id: uuid(),
        kind: "WEB_TENANT",
        userId: grant.userId,
        tenantId,
        parentId: grant.sessionId,
        expiresAt: parent?.expiresAt ?? this.now() + FAMILY_LIFETIME_MS,
      };
      state.sessions.push(session);
      const answer = this.issue(state, session);
      state.receipts[key] = { operation: "createTenantSession", hash: tenantId, at: this.now(), answer };
      return answer;
    });
  }

  /**
   * `DELETE /auth/tenant-sessions/{id}`: 204 for the reader's own company
   * session, revoked or not; **404 `RESOURCE_NOT_FOUND` for an id that is not
   * one** — the blueprint's (contracts §6). Backend PR #288 answers 401
   * "Invalid session" there instead, which the session layer is written not to
   * read as the account dying.
   */
  private async revokeTenantSession(bearer: string, tenantSessionId: string): Promise<void> {
    await this.delay("revokeTenantSession");
    this.write((state) => {
      const grant = this.authorizeCommand(state, bearer);
      if (!UUID_PATTERN.test(tenantSessionId)) throw problem(400, "VALIDATION_FAILED", "sessionId must be a UUID");
      const session = state.sessions.find(
        (item) => item.id === tenantSessionId && item.kind === "WEB_TENANT" && item.userId === grant.userId,
      );
      if (!session) throw problem(404, "RESOURCE_NOT_FOUND", "Session not found");
      session.revokedAt ??= this.now();
    });
  }

  /* ------------------------------------------------ creating a company (TAS-501) */

  /** `GET /billing/plans`: public, `limit` 1–100 (default 50), every state, `nextCursor` absent at the end. */
  private async listBillingPlans(params: ListBillingPlansParams): Promise<unknown> {
    await this.delay("listBillingPlans");
    const refusal = this.takeRefusal("listBillingPlans");
    if (refusal) throw refusal;
    const limit = params.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw problem(400, "VALIDATION_FAILED", "limit must be 1–100");
    const offset = params.cursor === undefined ? 0 : this.readCursor(params.cursor, "billing-plans");
    const items = MOCK_PLANS.slice(offset, offset + limit).map((plan) => structuredClone(plan));
    const next = offset + limit;
    return next < MOCK_PLANS.length ? { items, nextCursor: this.writeCursor(next, "billing-plans") } : { items };
  }

  /**
   * `POST /tenants` — develop's order (`TenantRegistryService`, TAS-310): the
   * account session only (a company session is 403 `SCOPE_DENIED`); a key
   * that is not a canonical UUID is 400; a key seen before with the same body
   * replays the company **as it is now** (a deleted one, or one the reader is
   * no longer an active member of, is 404 `TENANT_NOT_FOUND`), with another
   * body is 409 `IDEMPOTENCY_CONFLICT`; then the name (the shared rule) and a
   * `PUBLISHED` plan, both 400 `VALIDATION_FAILED` without violations; then
   * the FREE ledger, 409 `FREE_ELIGIBILITY_USED`. A FREE company starts
   * PROVISIONING; a paid one AWAITING_PAYMENT with the 30-day deadline and
   * `PENDING_FIRST_PAYMENT`, and never touches the ledger. The operation is
   * answered as develop answers it — PENDING, `updatedAt = createdAt` — on
   * the first send and on every replay (ask A12).
   */
  private async createTenant(bearer: string, input: CreateTenantInput, key: string): Promise<unknown> {
    await this.delay("createTenant");
    const answer = this.write((state) => {
      const grant = this.authorizeCommand(state, bearer);
      const refusal = this.takeRefusal("createTenant");
      if (refusal) throw refusal;
      if (!CANONICAL_KEY.test(key)) throw problem(400, "VALIDATION_FAILED", "Idempotency-Key must be a canonical UUID");
      const hash = JSON.stringify({ name: input.name, planVersionId: input.planVersionId });
      const receiptKey = `${grant.userId}:${key}`;
      const receipt = state.creations[receiptKey];
      if (receipt) {
        if (receipt.hash !== hash) throw problem(409, "IDEMPOTENCY_CONFLICT", "The key was used for another request");
        const tenant = state.tenants.find((item) => item.id === receipt.tenantId);
        const operation = state.operations.find((item) => item.id === receipt.operationId);
        if (!tenant || !operation || tenant.lifecycle === "DELETED" || this.membershipState(state, tenant.id, grant.userId) !== "ACTIVE") {
          throw problem(404, "TENANT_NOT_FOUND", "Tenant not found");
        }
        return this.creationAnswer(tenant, operation);
      }
      if (typeof input.name !== "string" || tenantNameProblem(input.name) !== null) {
        throw problem(400, "VALIDATION_FAILED", "Invalid request");
      }
      const plan = MOCK_PLANS.find((item) => item.id === input.planVersionId && item.state === "PUBLISHED");
      if (!plan) throw problem(400, "VALIDATION_FAILED", "Invalid request");
      const free = plan.price.amountMinor === "0";
      if (free && state.freeLedger[grant.userId] !== undefined) {
        throw problem(409, "FREE_ELIGIBILITY_USED", "The free company allowance has been used");
      }
      const createdMs = this.lifecycleNow();
      const createdAt = new Date(createdMs).toISOString();
      const tenant: StoredTenant = {
        id: uuid(),
        name: input.name,
        ownerId: grant.userId,
        lifecycle: free ? "PROVISIONING" : "AWAITING_PAYMENT",
        restrictions: free ? [] : ["PENDING_FIRST_PAYMENT"],
        createdAt,
        ...(free ? {} : { creationDeadline: new Date(createdMs + CREATION_WINDOW_MS).toISOString() }),
        version: "1",
        ownerVersion: "1",
      };
      const operation: StoredOperation = {
        id: uuid(),
        tenantId: tenant.id,
        actorId: grant.userId,
        type: "TENANT_PROVISION",
        createdAt,
        state: "PENDING",
        updatedAt: createdAt,
      };
      state.tenants.push(tenant);
      state.memberships.push({ tenantId: tenant.id, userId: grant.userId, role: "TENANT_ADMIN", state: "ACTIVE", version: 1 });
      state.operations.push(operation);
      if (free) state.freeLedger[grant.userId] = tenant.id;
      state.creations[receiptKey] = { hash, tenantId: tenant.id, operationId: operation.id };
      // A zero `stepMs` finishes provisioning in the same answer.
      this.evaluate(state);
      return this.creationAnswer(tenant, operation);
    });
    // Committed, and the answer never arrives (AC 3): the same key replays it.
    if (this.takeLostAnswer("createTenant")) throw new TypeError("Failed to fetch");
    return answer;
  }

  /** `GET /tenants/{tenantId}` — the tab's company session of that company; not stopped by a restriction. */
  private async getTenant(bearer: string | null, tenantId: string): Promise<unknown> {
    await this.delay("getTenant");
    return this.read((state) => this.wireTenant(this.authorizeControl(state, bearer, tenantId, "getTenant").tenant));
  }

  /** `GET /tenants/{tenantId}/operations/{operationId}` — its actor only; another's, or another company's, is 404. */
  private async getTenantOperation(bearer: string | null, tenantId: string, operationId: string): Promise<unknown> {
    await this.delay("getTenantOperation");
    return this.read((state) => {
      const { session } = this.authorizeControl(state, bearer, tenantId, "getTenantOperation");
      if (!UUID_PATTERN.test(operationId)) throw problem(400, "VALIDATION_FAILED", "operationId must be a UUID");
      const operation = state.operations.find(
        (item) => item.id === operationId && item.tenantId === tenantId && item.actorId === session.userId,
      );
      if (!operation) throw problem(404, "RESOURCE_NOT_FOUND", "Operation not found");
      return this.wireOperation(operation, false);
    });
  }

  /**
   * `POST /tenants/{tenantId}/cancel-creation`: the owner only (403
   * `OWNER_REQUIRED`), the lifecycle before the version (409 `INVALID_STATE`
   * once it no longer awaits payment, then 412 `VERSION_CONFLICT`), and a
   * durable receipt per `{actor}:{key}`. The deadline is never extended.
   */
  private async cancelTenantCreation(bearer: string | null, tenantId: string, version: string, key: string): Promise<unknown> {
    await this.delay("cancelTenantCreation");
    return this.write((state) => {
      const { session, tenant } = this.authorizeControl(state, bearer, tenantId, "cancelTenantCreation");
      if (!CANONICAL_KEY.test(key)) throw problem(400, "VALIDATION_FAILED", "Idempotency-Key must be a canonical UUID");
      const receiptKey = `${session.userId}:${key}`;
      const hash = `${tenantId}:${version}`;
      const receipt = state.cancels[receiptKey];
      if (receipt) {
        if (receipt.hash !== hash) throw problem(409, "IDEMPOTENCY_CONFLICT", "The key was used for another request");
        return receipt.answer;
      }
      if (tenant.ownerId !== session.userId) throw problem(403, "OWNER_REQUIRED", "Only the owner can cancel the creation");
      if (tenant.lifecycle !== "AWAITING_PAYMENT") throw problem(409, "INVALID_STATE", "The company is not awaiting payment");
      if (!/^[0-9]+$/.test(version)) throw problem(428, "VALIDATION_FAILED", "If-Match is required");
      if (version !== tenant.version) throw problem(412, "VERSION_CONFLICT", "The company has changed");
      tenant.lifecycle = "OWNER_CANCELLED";
      tenant.version = nextVersion(tenant.version);
      const answer = this.wireTenant(tenant);
      state.cancels[receiptKey] = { hash, answer };
      return answer;
    });
  }

  /* ---------------------------------------------------------- the checks */

  /** The company-session commands and the list: WEB_GLOBAL only (backend PR #288's scopes; the blueprint says any web session, ask A2). */
  private authorizeCommand(state: ServerState, bearer: string): { userId: string; sessionId: string } {
    const session = this.sessionOf(state, bearer);
    if (session.kind !== "WEB_GLOBAL") throw problem(403, "SCOPE_DENIED", "An account session is required");
    return { userId: session.userId, sessionId: session.id };
  }

  /**
   * A data call's bearer. A company route with WEB_GLOBAL is 400
   * `TENANT_REQUIRED`; a WEB_TENANT whose membership is not active is 403
   * `MEMBERSHIP_INACTIVE`, of a deleted company 404 `TENANT_NOT_FOUND`; a
   * company still PROVISIONING answers its content routes 409 `INVALID_STATE`;
   * a write in a company with any restriction is 403 `READ_ONLY` with them as
   * `reasons`; a read of one awaiting its first payment is 403
   * `CAPABILITY_DISABLED` with them.
   */
  private authorize(state: ServerState, bearer: string | null, kind: MockRouteKind): { userId: string; tenantId: string | null } {
    if (!bearer) throw problem(401, "AUTHENTICATION_REQUIRED", "Authentication required");
    const session = this.sessionOf(state, bearer);
    if (session.kind === "WEB_GLOBAL") {
      if (kind !== "account") throw problem(400, "TENANT_REQUIRED", "A company session is required");
      return { userId: session.userId, tenantId: null };
    }
    const tenantId = session.tenantId ?? "";
    const tenant = state.tenants.find((item) => item.id === tenantId);
    if (!tenant || tenant.lifecycle === "DELETED") throw problem(404, "TENANT_NOT_FOUND", "Tenant not found");
    if (this.membershipState(state, tenantId, session.userId) !== "ACTIVE") {
      throw problem(403, "MEMBERSHIP_INACTIVE", "Membership is not active");
    }
    // A company still being set up has no content to serve (the blueprint is
    // silent; this mock's answer, ask A14).
    if ((kind === "tenant-read" || kind === "tenant-write") && tenant.lifecycle === "PROVISIONING") {
      throw problem(409, "INVALID_STATE", "The company is still being set up");
    }
    if (kind === "tenant-write" && tenant.restrictions.length > 0) {
      throw problem(403, "READ_ONLY", "The company is read-only", tenant.restrictions);
    }
    // Before its first payment, never — whatever the global flag (TAS-501, B5:
    // the blueprint's CONTENT_READ denies PENDING_FIRST_PAYMENT outright).
    if (kind === "tenant-read" && tenant.restrictions.includes("PENDING_FIRST_PAYMENT")) {
      throw problem(403, "CAPABILITY_DISABLED", "Project content is not available", tenant.restrictions);
    }
    if (kind === "tenant-read" && tenant.restrictions.length > 0 && !this.contentReadUnderRestriction()) {
      throw problem(403, "CAPABILITY_DISABLED", "Project content is not available", tenant.restrictions);
    }
    return { userId: session.userId, tenantId };
  }

  /**
   * The route kind "tenant-control" (TAS-501): `getTenant`,
   * `getTenantOperation`, `cancelTenantCreation`. A company session of exactly
   * the path's company (anything else — another company's, the account's — is
   * 403 `TENANT_MISMATCH`), an `ACTIVE` membership, and **not** stopped by a
   * restriction: a company awaiting its first payment is read and cancelled
   * with its own session (api-contract-guard §4).
   */
  private authorizeControl(
    state: ServerState,
    bearer: string | null,
    tenantId: string,
    operation: string,
  ): { session: StoredSession; tenant: StoredTenant } {
    if (!bearer) throw problem(401, "AUTHENTICATION_REQUIRED", "Authentication required");
    const session = this.sessionOf(state, bearer);
    const refusal = this.takeRefusal(operation);
    if (refusal) throw refusal;
    if (!UUID_PATTERN.test(tenantId)) throw problem(400, "VALIDATION_FAILED", "tenantId must be a UUID");
    if (session.kind !== "WEB_TENANT" || session.tenantId !== tenantId) {
      throw problem(403, "TENANT_MISMATCH", "The session is for another tenant");
    }
    const tenant = state.tenants.find((item) => item.id === tenantId);
    if (!tenant || tenant.lifecycle === "DELETED") throw problem(404, "TENANT_NOT_FOUND", "Tenant not found");
    if (this.membershipState(state, tenantId, session.userId) !== "ACTIVE") {
      throw problem(403, "MEMBERSHIP_INACTIVE", "Membership is not active");
    }
    return { session, tenant };
  }

  /** `Tenant` as the wire carries it: `creationDeadline` only when there is one. */
  private wireTenant(tenant: StoredTenant): unknown {
    return { ...tenant, restrictions: [...tenant.restrictions] };
  }

  /** `Operation`; `asCreated` is develop's createTenant answer — PENDING, `updatedAt = createdAt` (ask A12). */
  private wireOperation(operation: StoredOperation, asCreated: boolean): unknown {
    const { actorId: _actor, failureCode, ...rest } = operation;
    if (asCreated) return { ...rest, state: "PENDING", updatedAt: operation.createdAt };
    return { ...rest, ...(failureCode ? { failureCode } : {}) };
  }

  private creationAnswer(tenant: StoredTenant, operation: StoredOperation): unknown {
    return { tenant: this.wireTenant(tenant), operation: this.wireOperation(operation, true) };
  }

  private sessionOf(state: ServerState, bearer: string): StoredSession {
    const access = state.access[bearer];
    if (!access || access.expiresAt <= this.now()) throw problem(401, "AUTHENTICATION_REQUIRED", "Authentication required");
    const session = state.sessions.find((item) => item.id === access.sessionId);
    if (!session || !this.alive(state, session)) throw problem(401, "TOKEN_REVOKED", "Invalid session");
    return session;
  }

  private alive(state: ServerState, session: StoredSession): boolean {
    if (session.revokedAt !== undefined || session.expiresAt <= this.now()) return false;
    if (session.parentId === undefined) return true;
    const parent = state.sessions.find((item) => item.id === session.parentId);
    return parent !== undefined && this.alive(state, parent);
  }

  /** The membership's state as the hooks leave it: `suspend` answers `SUSPENDED` over whatever is stored. */
  private membershipState(state: ServerState, tenantId: string, userId: string): MembershipState | null {
    const membership = state.memberships.find((item) => item.tenantId === tenantId && item.userId === userId);
    if (!membership) return null;
    const suspended = this.hooks().suspend?.some((item) => item.tenantId === tenantId && item.userId === userId);
    return suspended && membership.state === "ACTIVE" ? "SUSPENDED" : membership.state;
  }

  /** A reused refresh token ends its family: an account session with every company session under it, or the one company session. */
  private revokeFamily(state: ServerState, session: StoredSession): void {
    session.revokedAt ??= this.now();
    if (session.kind === "WEB_GLOBAL") {
      for (const child of state.sessions) if (child.parentId === session.id) child.revokedAt ??= this.now();
    }
  }

  /** A fresh pair for `session`: an access token living `accessTtlSeconds`, a refresh token of 32+ characters. */
  private issue(state: ServerState, session: StoredSession): WireAccessSession {
    const ttl = this.accessTtlSeconds();
    const accessToken = `mock-${session.kind === "WEB_GLOBAL" ? "account" : "company"}-access-${uuid()}`;
    const refreshToken = `mock-refresh-${uuid()}-${uuid()}`;
    state.access[accessToken] = { sessionId: session.id, expiresAt: this.now() + ttl * 1000 };
    state.refresh[refreshToken] = { sessionId: session.id };
    return {
      sessionId: session.id,
      userId: session.userId,
      ...(session.tenantId ? { tenantId: session.tenantId } : {}),
      accessToken,
      refreshToken,
      tokenType: "Bearer",
      expiresIn: ttl,
      mfaVerified: false,
    };
  }

  /** A secret answer replayed for the same key within 60 s; the same key on another request is 409. */
  private replay(state: ServerState, key: string, operation: string, hash: string): unknown {
    const receipt = state.receipts[key];
    if (!receipt) return undefined;
    if (receipt.operation !== operation || receipt.hash !== hash) {
      throw problem(409, "IDEMPOTENCY_CONFLICT", "The key was used for another request");
    }
    if (this.now() - receipt.at > SECRET_RECEIPT_MS) throw problem(409, "INVALID_STATE", "The answer is no longer available");
    return receipt.answer;
  }

  private writeCursor(offset: number, userId: string): string {
    return btoa(JSON.stringify({ o: offset, u: userId }));
  }

  private readCursor(cursor: string, userId: string): number {
    try {
      const parsed = JSON.parse(atob(cursor)) as { o?: unknown; u?: unknown };
      if (parsed.u === userId && typeof parsed.o === "number" && Number.isInteger(parsed.o) && parsed.o >= 0) return parsed.o;
    } catch {
      // falls through to the refusal
    }
    throw problem(400, "VALIDATION_FAILED", "cursor is not valid");
  }

  /* ------------------------------------------------------------- plumbing */

  private tenantStore(tenantId: string): MockTaskaStore {
    let store = this.stores.get(tenantId);
    if (!store) {
      store = new MockTaskaStore();
      // Nina signs in here (the constructor's note) — and since TAS-501 she can
      // create a company and work in it, so every store knows her as ACTIVE.
      store.overrideAccountStatus(MOCK_ACCOUNT_IDS.nina, "ACTIVE");
      store.applyTenantSeed(TENANT_SEEDS[tenantId] ?? EMPTY_SEED);
      this.stores.set(tenantId, store);
    }
    return store;
  }

  private read<T>(run: (state: ServerState) => T): T {
    return run(this.load());
  }

  /** Read, change, write back — also when `run` throws, since a refusal may have revoked a family first. */
  private write<T>(run: (state: ServerState) => T): T {
    const state = this.load();
    try {
      return run(state);
    } finally {
      this.save(state);
    }
  }

  private load(): ServerState {
    const state = this.stored();
    // Time and the hooks are read on every load (no timers): what changed is written back.
    if (this.evaluate(state)) this.save(state);
    return state;
  }

  private stored(): ServerState {
    try {
      const raw = this.storage.getItem(MOCK_SERVER_KEY);
      if (raw !== null) {
        const parsed = JSON.parse(raw) as ServerState;
        if (parsed && parsed.v === 2 && Array.isArray(parsed.tenants)) return parsed;
      }
    } catch {
      if (this.memory) return this.memory;
    }
    return {
      v: 2,
      ...seedTenants(this.now()),
      sessions: [],
      access: {},
      refresh: {},
      receipts: {},
      operations: [],
      creations: {},
      cancels: {},
    };
  }

  /**
   * The lifecycle clock's effects (TAS-501): an operation moves through
   * PENDING and RUNNING to its outcome by `provisioning.stepMs`, and a FREE
   * company opens when it succeeds; a confirmed first payment opens a company
   * awaiting it; a passed deadline closes it (`AUTO_CLOSED`); a late
   * confirmation reopens an auto-closed one (D216) — never a cancelled one.
   * Each change moves the company's version. Answers whether anything changed.
   */
  private evaluate(state: ServerState): boolean {
    const now = this.lifecycleNow();
    const hooks = this.hooks();
    const step = hooks.provisioning?.stepMs;
    const stepMs = typeof step === "number" && Number.isFinite(step) && step >= 0 ? step : DEFAULT_PROVISIONING_STEP_MS;
    const outcome = hooks.provisioning?.outcome;
    const terminal = outcome === "FAILED" || outcome === "MANUAL_REVIEW" ? outcome : "SUCCEEDED";
    const confirmed = new Set(Array.isArray(hooks.firstPaymentConfirmed) ? hooks.firstPaymentConfirmed : []);
    const late = new Set(Array.isArray(hooks.latePaymentConfirmed) ? hooks.latePaymentConfirmed : []);
    let changed = false;
    const open = (tenant: StoredTenant) => {
      tenant.lifecycle = "ACTIVE";
      tenant.restrictions = tenant.restrictions.filter((code) => code !== "PENDING_FIRST_PAYMENT");
      delete tenant.creationDeadline;
      tenant.version = nextVersion(tenant.version);
      changed = true;
    };

    for (const operation of state.operations) {
      if (TERMINAL_OPERATION_STATES.has(operation.state)) continue;
      const started = Date.parse(operation.createdAt);
      const elapsed = now - started;
      const next = elapsed < stepMs ? "PENDING" : elapsed < 2 * stepMs ? "RUNNING" : terminal;
      if (next === operation.state) continue;
      operation.state = next;
      operation.updatedAt = new Date(next === "RUNNING" ? started + stepMs : started + 2 * stepMs).toISOString();
      if (next === "FAILED") operation.failureCode = hooks.provisioning?.failureCode ?? "DEPENDENCY_UNAVAILABLE";
      changed = true;
      const tenant = state.tenants.find((item) => item.id === operation.tenantId);
      if (next === "SUCCEEDED" && tenant?.lifecycle === "PROVISIONING") open(tenant);
    }
    for (const tenant of state.tenants) {
      if (tenant.lifecycle === "AWAITING_PAYMENT" && confirmed.has(tenant.id)) open(tenant);
      else if (tenant.lifecycle === "AWAITING_PAYMENT" && tenant.creationDeadline && Date.parse(tenant.creationDeadline) <= now) {
        tenant.lifecycle = "AUTO_CLOSED";
        tenant.version = nextVersion(tenant.version);
        changed = true;
      } else if (tenant.lifecycle === "AUTO_CLOSED" && late.has(tenant.id)) open(tenant);
    }
    return changed;
  }

  private save(state: ServerState): void {
    const now = this.now();
    // Spent and expired entries go, so the record does not grow without end.
    for (const [token, access] of Object.entries(state.access)) if (access.expiresAt < now - MINUTE) delete state.access[token];
    for (const [key, receipt] of Object.entries(state.receipts)) if (receipt.at < now - DAY) delete state.receipts[key];
    for (const [token, entry] of Object.entries(state.refresh)) {
      if (entry.spentAt !== undefined && entry.spentAt < now - DAY) delete state.refresh[token];
    }
    state.sessions = state.sessions.filter(
      (session) => session.expiresAt >= now - DAY && (session.revokedAt === undefined || session.revokedAt >= now - DAY),
    );
    try {
      this.storage.setItem(MOCK_SERVER_KEY, JSON.stringify(state));
    } catch {
      this.memory = state;
    }
  }

  private hooks(): MockTenantHooks {
    try {
      const raw = this.storage.getItem(MOCK_TENANT_HOOKS_KEY);
      const parsed: unknown = raw === null ? null : JSON.parse(raw);
      return typeof parsed === "object" && parsed !== null ? (parsed as MockTenantHooks) : {};
    } catch {
      return {};
    }
  }

  /** The lifecycle clock: the real one, moved by `clockOffsetMs`. Tokens and sessions never read it. */
  private lifecycleNow(): number {
    const offset = this.hooks().clockOffsetMs;
    return this.now() + (typeof offset === "number" && Number.isFinite(offset) ? offset : 0);
  }

  /** `refuseNext[operation]`, taken once: the refusal it describes, or `null`. */
  private takeRefusal(operation: string): MockProblemError | null {
    const hooks = this.hooks();
    const entry = hooks.refuseNext?.[operation];
    if (!entry || typeof entry.status !== "number" || typeof entry.code !== "string") return null;
    delete hooks.refuseNext?.[operation];
    this.writeHooks(hooks);
    const wait = typeof entry.retryAfterSeconds === "number" && entry.retryAfterSeconds > 0 ? entry.retryAfterSeconds : null;
    return problem(entry.status, entry.code, entry.title ?? "Refused by the mock's hook", entry.reasons ?? [], wait);
  }

  /** `loseAnswer` holds `operation`: taken once. */
  private takeLostAnswer(operation: string): boolean {
    const hooks = this.hooks();
    if (!Array.isArray(hooks.loseAnswer) || !hooks.loseAnswer.includes(operation)) return false;
    hooks.loseAnswer = hooks.loseAnswer.filter((item) => item !== operation);
    this.writeHooks(hooks);
    return true;
  }

  private writeHooks(hooks: MockTenantHooks): void {
    try {
      this.storage.setItem(MOCK_TENANT_HOOKS_KEY, JSON.stringify(hooks));
    } catch {
      // A storage that refuses keeps the hook as it was.
    }
  }

  private contentReadUnderRestriction(): boolean {
    const flag = this.hooks().contentReadUnderRestriction;
    return typeof flag === "boolean" ? flag : MOCK_PROJECT_CONTENT_READ_UNDER_RESTRICTION;
  }

  private accessTtlSeconds(): number {
    const ttl = this.hooks().accessTtlSeconds;
    return typeof ttl === "number" && Number.isFinite(ttl) && ttl > 0 ? ttl : DEFAULT_ACCESS_TTL_S;
  }

  private async delay(operation: string, base = this.latencyMs): Promise<void> {
    const extra = this.hooks().delayMs?.[operation];
    const ms = base + (typeof extra === "number" && extra > 0 ? extra : 0);
    if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
