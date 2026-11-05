import { apiErrorFacts, type FieldViolation } from "../errors";
import type { LoginInput } from "../TaskaApi";
import {
  isKnownMembershipRole,
  isKnownProjectGrantRole,
  invitationEmailProblem,
  sameInvitationEmail,
  trimInvitationEmail,
  type CreateInvitationInput,
  type KnownMembershipRole,
  type ListCompanyPageParams,
} from "../tenantMembers";
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
 * **Shared by every tab** through `localStorage` `taska.mockServer.v4`: the
 * companies, memberships, sessions and tokens — since TAS-501 the FREE
 * ledger, the creations' operations and their durable receipts, since TAS-502
 * the invitations, the seat limits, the membership generation and the member
 * writes' durable receipts, and since TAS-504 each company's subscription —
 * read and written on every operation, so a second tab — or a duplicated one
 * — meets the same server. (v1 was TAS-500's, v2 TAS-501's, v3 TAS-502's;
 * each bump re-seeds, signing every mock account out once.)
 * Each company's projects and issues are this page's own, in memory, as
 * today's mock's are: they reset with a reload.
 *
 * This narrows docs/ai/API-DIVERGENCE.md's "The mock has a session flag but no
 * session enforcement" for the companies build only; today's build's mock is
 * untouched and enforces nothing.
 */

export const MOCK_SERVER_KEY = "taska.mockServer.v4";

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
 *   answers like a dropped connection, once (the reload replays it); since
 *   TAS-502 `"leaveTenant"` too — the leave is applied, its answer lost;
 * - `firstPaymentConfirmed`: `[tenantId]` — an AWAITING_PAYMENT company opens
 *   (stands in for TAS-513);
 * - `latePaymentConfirmed`: `[tenantId]` — an AUTO_CLOSED company opens
 *   (D216); never an OWNER_CANCELLED one.
 *
 * A company's members and invitations (TAS-502, api-contract-guard §7):
 *
 * - `refuseNext` and `delayMs` take the new operation ids too
 *   (`listTenantMembers`, `setTenantMemberRole`, `setTenantMemberState`,
 *   `removeTenantMember`, `leaveTenant`, `listTenantInvitations`,
 *   `createTenantInvitation`, `resendTenantInvitation`,
 *   `revokeTenantInvitation`, `getTenantQuotas`) — `LAST_ADMIN` is reachable
 *   only this way, because every company's owner is an admin the server
 *   protects;
 * - `clockOffsetMs` also expires invitations;
 * - `memberOperationStepMs`: a removal's operation is PENDING for this long,
 *   RUNNING as long again, then `memberOperationOutcome` (`SUCCEEDED` by
 *   default, `FAILED` with `memberOperationFailureCode`, or `MANUAL_REVIEW`);
 *   the default 0 removes at once;
 * - `restrict`: `{[tenantId]: string[]}`, restrictions added to a company for
 *   the member routes only — `PAYMENT_EXPIRED` shows the RECOVERY policy
 *   (remove and revoke allowed, the rest `READ_ONLY`).
 *
 * The company's name, owner and pause (TAS-504, api-contract-guard §6):
 *
 * - `refuseNext`, `delayMs` and `loseAnswer` take `renameTenant`,
 *   `pauseTenant`, `resumeTenant`, `transferTenantOwnership` and
 *   `getSubscription` — a lost command is applied and then answered like a
 *   dropped connection, once;
 * - `platformBlock`: `{[tenantId]: boolean}` — stands in for the platform's
 *   `setPlatformBlock` (GLOBAL_ADMIN): `true` adds `PLATFORM_BLOCK`, `false`
 *   lifts it, a company not named keeps what it has (Hooli is seeded blocked);
 * - `ownerPauseEnabled` (default `true`): `false` refuses a new pause 403
 *   `CAPABILITY_DISABLED` (D93/D94) — never a resume;
 * - `ownershipTransferEnabled` (default `true`): `false` refuses a transfer
 *   403 `CAPABILITY_DISABLED`;
 * - `clockOffsetMs` also ends paid periods: an ACTIVE company whose
 *   `paidThrough` has passed gets `PAYMENT_EXPIRED`, which a resume never
 *   lifts (D131);
 * - `contentReadUnderRestriction: false` closes content under a pause or a
 *   block only — the members list and the notifications stay readable (the
 *   control plane, asks A35 and G1).
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
  memberOperationStepMs?: number;
  memberOperationOutcome?: string;
  memberOperationFailureCode?: string;
  restrict?: Record<string, string[]>;
  platformBlock?: Record<string, boolean>;
  ownerPauseEnabled?: boolean;
  ownershipTransferEnabled?: boolean;
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
/** Omar Haddad — in today's seed the LOCKED account; here also Northwind's suspended member (TAS-502). */
const omar = "d58f0e73-4b2c-4c9d-8e15-3f6a70b2c9d4";

/** The fixture invitations' ids (TAS-502). */
export const MOCK_INVITATION_IDS = {
  /** Northwind, pending: Kai, invited by Anna as a Member of WEB, holds Northwind's fifth seat. */
  kai: "9c1f2e3d-4b5a-4c6d-8e7f-0a1b2c3d4e01",
  /** Northwind, expired two days before the seed. */
  zoe: "9c1f2e3d-4b5a-4c6d-8e7f-0a1b2c3d4e02",
  /** Umbrella, pending, sent by Priya — revoked when Tom demotes her. */
  lena: "9c1f2e3d-4b5a-4c6d-8e7f-0a1b2c3d4e03",
} as const;

type MembershipRole = "TENANT_ADMIN" | "MEMBER";
type MembershipState = "ACTIVE" | "SUSPENDED" | "REMOVED";

/**
 * A company's subscription (TAS-504; `Subscription`, TAS-314) — **never on the
 * `Tenant` wire**, answered only by `getSubscription`, to the owner.
 * `paidThrough` is the exclusive end of the current paid coverage, absent for
 * FREE and before the first payment (ask A37); a pause or a block never moves
 * it (D129, D145).
 */
interface StoredSubscription {
  planVersionId: string;
  version: string;
  paidThrough?: string;
  anchorDay?: number;
  renewalCancelled: boolean;
  autopayState: string;
}

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
  /** TAS-504. Never on the wire. */
  subscription: StoredSubscription;
  /** The plan's SEAT limit, a decimal string, or `null` for an unlimited one (TAS-502). Never on the wire. */
  seatLimit: string | null;
  /** `QuotaSnapshot.version`: moves whenever `used` or `reserved` does. Never on the wire. */
  quotaVersion: number;
  /** The membership generation: moves with every change to a membership, and the members cursor is bound to it. */
  generation: number;
}

interface StoredMembership {
  id: string;
  tenantId: string;
  userId: string;
  role: MembershipRole;
  state: MembershipState;
  version: number;
  /** Not on the wire (`Membership` has no `joinedAt`); the list's order, `(joinedAt, userId)` as develop has it. */
  joinedAt: string;
}

/** An invitation (TAS-502). `issuedAt` orders the list and is not on the wire. */
interface StoredInvitation {
  id: string;
  tenantId: string;
  email: string;
  role: MembershipRole;
  state: string;
  issuedAt: string;
  expiresAt: string;
  createdBy: string;
  projectGrants: Array<{ projectId: string; role: string }>;
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
  /** A removal's subject (TAS-502) — never on the wire. */
  subjectUserId?: string;
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
  v: 4;
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
  /** TAS-502. */
  invitations: StoredInvitation[];
  /**
   * The member writes' receipts — **durable**, `{actor}:{operation}:{key}`:
   * the same key with the same request (body and `If-Match`) answers what it
   * answered, with another is 409 `IDEMPOTENCY_CONFLICT`. A removal's receipt
   * names its operation, whose state is read as it is now.
   */
  memberReceipts: Record<string, { hash: string; answer: unknown; operationId?: string }>;
  /**
   * People whose project rows and assignments a suspension, removal or leave
   * cleared (contracts §8), so that a company store this page builds from the
   * seed — after a reload, or in another tab — leaves them out too.
   */
  cleared: Array<{ tenantId: string; userId: string; seq: number }>;
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
    violations: readonly FieldViolation[] = [],
  ) {
    super(title);
    this.name = "MockProblemError";
    this.requestId = uuid();
    // Only on a refusal that names fields (TAS-502): a Problem without
    // `violations` carries none, as TAS-501's refusals are pinned to.
    if (violations.length > 0) this.violations = violations;
  }

  /** `Problem.violations`, the fields a `VALIDATION_FAILED` names (TAS-502); absent when it names none. */
  readonly violations?: readonly FieldViolation[];
}

const problem = (status: number, code: string, title: string, reasons: readonly string[] = [], retryAfterSeconds: number | null = null) =>
  new MockProblemError(status, code, title, reasons, retryAfterSeconds);

const invalid = (title: string, violations: readonly FieldViolation[]) =>
  new MockProblemError(400, "VALIDATION_FAILED", title, [], null, violations);

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
/** An invitation's lifetime (contracts §8: 7 days by default, configurable 1–30). */
const INVITATION_TTL_MS = 7 * DAY;
/** The operation type of a removal (TAS-502) — the screens never key on it. */
const REMOVE_OPERATION_TYPE = "removeTenantMember";
const LEAVE_OPERATION_TYPE = "leaveTenant";
/** The restrictions the RECOVERY policy allows remove and revoke under (access-matrix.json; api-contract-guard §2). */
const RECOVERY_ALLOWED: ReadonlySet<string> = new Set(["PAYMENT_EXPIRED", "OVER_QUOTA"]);
/** The SEAT limit of a plan of this mock's catalogue, a decimal string — `null` for unlimited. */
const seatLimitOf = (planId: string): string | null => {
  const seat = MOCK_PLANS.find((plan) => plan.id === planId)?.limits.find((limit) => limit.kind === "SEAT");
  return seat && !seat.unlimited && seat.limit ? seat.limit : null;
};

/** How long a paid period the mock starts on a confirmed first payment lasts — its own choice (TAS-504). */
const PAID_PERIOD_MS = 30 * DAY;

/** Sets or lifts one restriction, kept in `RESTRICTION_ORDER`; a change moves the company's version. */
function setRestriction(tenant: StoredTenant, code: string, on: boolean): boolean {
  if (tenant.restrictions.includes(code) === on) return false;
  tenant.restrictions = orderedRestrictions(on ? [...tenant.restrictions, code] : tenant.restrictions.filter((item) => item !== code));
  tenant.version = nextVersion(tenant.version);
  return true;
}

/** A subscription with no paid period: FREE, or a paid plan before its first payment (TAS-504). */
const unpaid = (planVersionId: string): StoredSubscription => ({
  planVersionId,
  version: "1",
  renewalCancelled: false,
  autopayState: "DISABLED",
});

/** Whether a plan of this mock's catalogue is FREE — the server's knowledge, never the client's (B3). */
const isFreePlan = (planVersionId: string) => MOCK_PLANS.find((plan) => plan.id === planVersionId)?.price.amountMinor === "0";

/**
 * The order a refusal names a company's restrictions in, and the order they
 * are kept in (api-contract-guard §6) — a code this mock does not know, last.
 */
const RESTRICTION_ORDER: readonly string[] = [
  "PLATFORM_BLOCK",
  "OWNER_PAUSE",
  "PAYMENT_DISPUTE",
  "PENDING_FIRST_PAYMENT",
  "PAYMENT_EXPIRED",
  "OVER_QUOTA",
];
const orderedRestrictions = (codes: readonly string[]): string[] => {
  const rank = (code: string) => {
    const index = RESTRICTION_ORDER.indexOf(code);
    return index === -1 ? RESTRICTION_ORDER.length : index;
  };
  return [...new Set(codes)].sort((a, b) => rank(a) - rank(b));
};

/** The two restrictions that close a company's projects when the global read flag is off (contracts §5, D82). */
const closesContent = (codes: readonly string[]) => codes.includes("OWNER_PAUSE") || codes.includes("PLATFORM_BLOCK");

/**
 * Which restrictions each command's rule lets through (access-matrix.json
 * `tenant.*`; api-contract-guard §4): rename (NORMAL) none; pause and resume
 * (OWNER_CONTROL) the owner's own pause and the two financial ones; a transfer
 * (TRANSFER) the owner's own pause only (D244). Anything else is 403
 * `READ_ONLY` with every current restriction as `reasons`.
 */
type TenantPolicy = "NORMAL" | "OWNER_CONTROL" | "TRANSFER";
const POLICY_ALLOWS: Readonly<Record<TenantPolicy, ReadonlySet<string>>> = {
  NORMAL: new Set(),
  OWNER_CONTROL: new Set(["OWNER_PAUSE", "PAYMENT_EXPIRED", "OVER_QUOTA"]),
  TRANSFER: new Set(["OWNER_PAUSE"]),
};

/** Which restriction rule a member route answers to (access-matrix.json `membership.*`, `invitation.*`). */
type MemberPolicy = "DIRECTORY" | "SEATS" | "ADMIN_READ" | "NORMAL" | "RECOVERY" | "LEAVE";
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
 *
 * TAS-502 adds the members' states and the invitations (api-contract-guard
 * §7): Northwind (FREE, 5 seats) is full — Anna, Sofia, Tom and Omar
 * (suspended, so still holding his seat) use four, Kai's pending invitation
 * holds the fifth, and Zoe's has expired; Umbrella has Priya as a second
 * admin, with Lena's invitation of hers pending; Globex is Anna's member view;
 * Initech, paused, keeps its directory readable and its Leave open; Hooli,
 * blocked, refuses Priya's admin writes `READ_ONLY`.
 *
 * TAS-504 adds each company's subscription (api-contract-guard §6), never on
 * the `Tenant` wire: Northwind and Globex are FREE — no `paidThrough`, autopay
 * DISABLED — so a transfer of either is refused; Initech (paused, Sofia) is
 * paid 32 days past the seed, Umbrella (Tom) 45, Hooli (blocked, Priya) 38
 * and the long-named company (Priya) 50 — every one past the largest clock
 * offset the earlier tests use (29 days), so none of them expires there.
 * Stark, Wayne and Massive Dynamic have never been paid. Who may be the new
 * owner: Initech's Anna (ACTIVE member), Umbrella's Priya (ACTIVE admin) — and
 * Umbrella's Anna is SUSPENDED, refused.
 */
function seedTenants(seedAt: number): Pick<ServerState, "tenants" | "memberships" | "freeLedger" | "invitations"> {
  const at = (day: number) => `2026-05-${String(day).padStart(2, "0")}T09:00:00Z`;
  const iso = (ms: number) => new Date(ms).toISOString();
  const tenant = (
    id: string,
    name: string,
    ownerId: string,
    day: number,
    lifecycle = "ACTIVE",
    restrictions: string[] = [],
    seatLimit: string | null = seatLimitOf(MOCK_PLAN_IDS.team),
    subscription: StoredSubscription = unpaid(MOCK_PLAN_IDS.team),
  ): StoredTenant => ({
    id,
    name,
    ownerId,
    lifecycle,
    restrictions,
    createdAt: at(day),
    version: "3",
    ownerVersion: "1",
    subscription,
    seatLimit,
    quotaVersion: 1,
    generation: 1,
  });
  /** Team, paid `days` past the seed; the anchor is that day of the month. */
  const paid = (days: number, autopayState: string): StoredSubscription => {
    const through = new Date(seedAt + days * DAY);
    return {
      planVersionId: MOCK_PLAN_IDS.team,
      version: "2",
      paidThrough: through.toISOString(),
      anchorDay: through.getUTCDate(),
      renewalCancelled: false,
      autopayState,
    };
  };
  const free = seatLimitOf(MOCK_PLAN_IDS.free);
  const freePlan = unpaid(MOCK_PLAN_IDS.free);
  const ids = MOCK_TENANT_IDS;
  const joined = new Map<string, string>([
    [ids.northwind, at(1)],
    [ids.globex, at(2)],
    [ids.initech, at(3)],
    [ids.umbrella, at(4)],
    [ids.hooli, at(5)],
    [ids.massive, at(6)],
    [ids.longName, at(7)],
    [ids.stark, iso(seedAt - 20 * DAY)],
    [ids.wayne, iso(seedAt - 5 * DAY)],
    [ids.vandelay, at(10)],
  ]);
  const member = (
    tenantId: string,
    userId: string,
    role: MembershipRole,
    state: MembershipState = "ACTIVE",
    version = 1,
  ): StoredMembership => ({
    id: uuid(),
    tenantId,
    userId,
    role,
    state,
    version,
    joinedAt: joined.get(tenantId) ?? at(1),
  });
  return {
    tenants: [
      tenant(ids.northwind, "Northwind", anna, 1, "ACTIVE", [], free, freePlan),
      tenant(ids.globex, "Globex", priya, 2, "ACTIVE", [], free, freePlan),
      tenant(ids.initech, "Initech", sofia, 3, "ACTIVE", ["OWNER_PAUSE"], undefined, paid(32, "CONSENTED")),
      tenant(ids.umbrella, "Umbrella", tom, 4, "ACTIVE", [], undefined, paid(45, "CONSENTED")),
      // Blocked: no automatic payment is taken while it is (D145).
      tenant(ids.hooli, "Hooli", priya, 5, "ACTIVE", ["PLATFORM_BLOCK"], undefined, paid(38, "SUSPENDED")),
      {
        ...tenant(ids.massive, "Massive Dynamic", tom, 6, "AUTO_CLOSED", ["PENDING_FIRST_PAYMENT"]),
        creationDeadline: "2026-06-05T09:00:00Z",
      },
      tenant(ids.longName, MOCK_LONG_TENANT_NAME, priya, 7, "ACTIVE", [], undefined, paid(50, "DISABLED")),
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
      tenant(ids.vandelay, "Vandelay Industries", sofia, 10, "DELETED", [], free, freePlan),
    ],
    memberships: [
      member(ids.northwind, anna, "TENANT_ADMIN"),
      member(ids.northwind, sofia, "MEMBER"),
      member(ids.northwind, tom, "MEMBER"),
      member(ids.northwind, omar, "MEMBER", "SUSPENDED", 2),
      member(ids.globex, priya, "TENANT_ADMIN"),
      member(ids.globex, anna, "MEMBER"),
      member(ids.initech, sofia, "TENANT_ADMIN"),
      member(ids.initech, anna, "MEMBER"),
      member(ids.umbrella, tom, "TENANT_ADMIN"),
      member(ids.umbrella, priya, "TENANT_ADMIN"),
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
    invitations: [
      {
        id: MOCK_INVITATION_IDS.kai,
        tenantId: ids.northwind,
        email: "kai@example.com",
        role: "MEMBER",
        state: "PENDING",
        issuedAt: iso(seedAt - 2 * DAY),
        expiresAt: iso(seedAt + 5 * DAY),
        createdBy: anna,
        projectGrants: [{ projectId: MOCK_PROJECT_IDS.web, role: "MEMBER" }],
        version: 1,
      },
      {
        id: MOCK_INVITATION_IDS.zoe,
        tenantId: ids.northwind,
        email: "zoe@example.com",
        role: "TENANT_ADMIN",
        state: "EXPIRED",
        issuedAt: iso(seedAt - 9 * DAY),
        expiresAt: iso(seedAt - 2 * DAY),
        createdBy: anna,
        projectGrants: [],
        version: 2,
      },
      {
        id: MOCK_INVITATION_IDS.lena,
        tenantId: ids.umbrella,
        email: "lena@example.com",
        role: "MEMBER",
        state: "PENDING",
        issuedAt: iso(seedAt - 1 * DAY),
        expiresAt: iso(seedAt + 6 * DAY),
        createdBy: priya,
        projectGrants: [{ projectId: MOCK_TENANT_PROJECT_IDS.umbrellaResearch, role: "VIEWER" }],
        version: 1,
      },
    ],
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
        members: [[tom, "ADMIN"], [priya, "ADMIN"]],
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
  /** The `cleared` entries each of this page's company stores has applied, by `seq` (TAS-502). */
  private readonly appliedClears = new Map<string, Set<number>>();

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
      listTenantMembers: (bearer, tenantId, params) => this.listTenantMembers(bearer, tenantId, params),
      setTenantMemberRole: (bearer, tenantId, userId, role, version, key) =>
        this.setTenantMemberRole(bearer, tenantId, userId, role, version, key),
      setTenantMemberState: (bearer, tenantId, userId, memberState, version, key) =>
        this.setTenantMemberState(bearer, tenantId, userId, memberState, version, key),
      removeTenantMember: (bearer, tenantId, userId, version, key) => this.removeTenantMember(bearer, tenantId, userId, version, key),
      leaveTenant: (bearer, tenantId, key) => this.leaveTenant(bearer, tenantId, key),
      listTenantInvitations: (bearer, tenantId, params) => this.listTenantInvitations(bearer, tenantId, params),
      createTenantInvitation: (bearer, tenantId, input, key) => this.createTenantInvitation(bearer, tenantId, input, key),
      resendTenantInvitation: (bearer, tenantId, invitationId, key) => this.resendTenantInvitation(bearer, tenantId, invitationId, key),
      revokeTenantInvitation: (bearer, tenantId, invitationId, version, key) =>
        this.revokeTenantInvitation(bearer, tenantId, invitationId, version, key),
      getTenantQuotas: (bearer, tenantId) => this.getTenantQuotas(bearer, tenantId),
      renameTenant: (bearer, tenantId, name, version, key) => this.renameTenant(bearer, tenantId, name, version, key),
      pauseTenant: (bearer, tenantId, version, key) => this.pauseTenant(bearer, tenantId, version, key),
      resumeTenant: (bearer, tenantId, version, key) => this.resumeTenant(bearer, tenantId, version, key),
      transferTenantOwnership: (bearer, tenantId, newOwnerUserId, version, key) =>
        this.transferTenantOwnership(bearer, tenantId, newOwnerUserId, version, key),
      getSubscription: (bearer, tenantId) => this.getSubscription(bearer, tenantId),
    };
  }

  /**
   * One data call: the bearer checked against `kind`, then `run` on the store
   * it opens — the company's for a company route, the account's for the
   * account's own — signed in as the bearer's account.
   */
  async serve<T>(bearer: string | null, kind: MockRouteKind, operation: string, run: (store: MockTaskaStore) => Promise<T>): Promise<T> {
    await this.delay(operation, 0);
    const { grant, members, cleared } = this.read((state) => {
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
      return { grant: granted, members: active, cleared: tenantId === null ? [] : state.cleared.filter((item) => item.tenantId === tenantId) };
    });
    const store = kind === "account" || grant.tenantId === null ? this.accountStore : this.tenantStore(grant.tenantId);
    if (grant.tenantId !== null && store !== this.accountStore) this.applyClears(grant.tenantId, cleared);
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
      const items = listed.slice(offset, offset + limit).map((tenant) => this.wireTenant(tenant));
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
        // FREE, or a paid plan before its first payment: no paid period yet (TAS-504).
        subscription: unpaid(plan.id),
        seatLimit: seatLimitOf(plan.id),
        quotaVersion: 1,
        generation: 1,
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
      state.memberships.push({
        id: uuid(),
        tenantId: tenant.id,
        userId: grant.userId,
        role: "TENANT_ADMIN",
        state: "ACTIVE",
        version: 1,
        joinedAt: createdAt,
      });
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

  /* ------------------------------ members, invitations and seats (TAS-502) */

  /*
   * api-contract-guard §7, with the orchestrator's rulings: PR #287's order of
   * checks — (1) the company ACTIVE, (2) the caller ACTIVE, (3) the caller a
   * TENANT_ADMIN, (4) the route's restriction policy, (5) the key's receipt,
   * (6) the target, (7) the owner, (8) the version, (9) the last admin, (10)
   * apply — **except where develop deviates from the blueprint**: a change to
   * a target that is not ACTIVE is 409 `INVALID_STATE` (never the caller's
   * 403 `MEMBERSHIP_INACTIVE`, ask A17), and a change to the caller's own
   * membership never refuses the caller's next request (no stale-generation
   * refusal, ask A18 — the role is checked online, contracts §2).
   */

  /**
   * `GET /tenants/{t}/members`: ACTIVE and SUSPENDED, `(joinedAt, userId)`,
   * `limit` 1–100 (default 50), the cursor bound to the reader, the company
   * and the membership generation — a change meanwhile makes it a 400, as
   * develop does. The profile fields come from the account store (the
   * blueprint's to-be, TAS-321); `avatarPath` is never sent (no route loads
   * it, B7).
   */
  private async listTenantMembers(bearer: string | null, tenantId: string, params: ListCompanyPageParams): Promise<unknown> {
    await this.delay("listTenantMembers");
    return this.read((state) => {
      const { session, tenant } = this.authorizeMembers(state, bearer, tenantId, "listTenantMembers", "DIRECTORY");
      const limit = this.pageLimit(params);
      const bound = `members:${tenantId}:${tenant.generation}`;
      const offset = params.cursor === undefined ? 0 : this.readCursor(params.cursor, `${session.userId}:${bound}`);
      const listed = state.memberships
        .filter((item) => item.tenantId === tenantId && (item.state === "ACTIVE" || item.state === "SUSPENDED"))
        .sort((a, b) => (a.joinedAt < b.joinedAt ? -1 : a.joinedAt > b.joinedAt ? 1 : a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
      const items = listed.slice(offset, offset + limit).map((item) => this.wireMembership(state, tenant, item));
      const next = offset + limit;
      return next < listed.length ? { items, nextCursor: this.writeCursor(next, `${session.userId}:${bound}`) } : { items };
    });
  }

  /**
   * `PATCH …/members/{userId}/role`. A demotion revokes the person's pending
   * invitations (L03, B03) and nothing else: their sessions stay, and the role
   * is checked online on their next request (contracts §2, ruling 2 — only a
   * suspension or a removal ends a person's access). The same role is a no-op
   * 200 at the same version.
   */
  private async setTenantMemberRole(
    bearer: string | null,
    tenantId: string,
    userId: string,
    role: KnownMembershipRole,
    version: string,
    key: string,
  ): Promise<unknown> {
    await this.delay("setTenantMemberRole");
    return this.write((state) => {
      const { session, tenant } = this.authorizeMembers(state, bearer, tenantId, "setTenantMemberRole", "NORMAL");
      if (!isKnownMembershipRole(role)) {
        throw invalid("Invalid request", [{ field: "role", code: "INVALID", message: "role must be MEMBER or TENANT_ADMIN" }]);
      }
      const receipt = this.memberReceipt(state, session.userId, "setTenantMemberRole", key, { userId, role, version });
      if (receipt.replay !== undefined) return receipt.replay;
      const target = this.targetMembership(state, tenantId, userId);
      if (this.membershipState(state, tenantId, userId) !== "ACTIVE") {
        throw problem(409, "INVALID_STATE", "The membership is not active");
      }
      if (tenant.ownerId === userId) throw problem(409, "OWNER_MEMBERSHIP_PROTECTED", "The owner's membership is protected");
      this.checkVersion(version, target.version);
      if (target.role === role) return receipt.keep(this.wireMembership(state, tenant, target));
      if (target.role === "TENANT_ADMIN" && this.otherActiveAdmins(state, tenantId, userId) === 0) {
        throw problem(409, "LAST_ADMIN", "The last active admin cannot be demoted");
      }
      target.role = role;
      target.version += 1;
      tenant.generation += 1;
      if (role === "MEMBER") this.revokeInvitationsBy(state, tenant, userId);
      return receipt.keep(this.wireMembership(state, tenant, target));
    });
  }

  /**
   * `PATCH …/members/{userId}/state`. Suspending keeps the seat and revokes
   * the person's company sessions, pending invitations, project rows and
   * assignments (contracts §8); reactivating restores none of them and
   * answers MEMBER, whatever the role was (L03).
   */
  private async setTenantMemberState(
    bearer: string | null,
    tenantId: string,
    userId: string,
    memberState: "ACTIVE" | "SUSPENDED",
    version: string,
    key: string,
  ): Promise<unknown> {
    await this.delay("setTenantMemberState");
    return this.write((state) => {
      const { session, tenant } = this.authorizeMembers(state, bearer, tenantId, "setTenantMemberState", "NORMAL");
      if (memberState !== "ACTIVE" && memberState !== "SUSPENDED") {
        throw invalid("Invalid request", [{ field: "state", code: "INVALID", message: "state must be ACTIVE or SUSPENDED" }]);
      }
      const receipt = this.memberReceipt(state, session.userId, "setTenantMemberState", key, { userId, state: memberState, version });
      if (receipt.replay !== undefined) return receipt.replay;
      const target = this.targetMembership(state, tenantId, userId);
      const now = this.membershipState(state, tenantId, userId);
      if (memberState === "SUSPENDED" && now !== "ACTIVE") throw problem(409, "INVALID_STATE", "The membership is not active");
      if (memberState === "ACTIVE" && now !== "SUSPENDED") throw problem(409, "INVALID_STATE", "The membership is not suspended");
      if (tenant.ownerId === userId) throw problem(409, "OWNER_MEMBERSHIP_PROTECTED", "The owner's membership is protected");
      this.checkVersion(version, target.version);
      if (memberState === "SUSPENDED") {
        if (target.role === "TENANT_ADMIN" && this.otherActiveAdmins(state, tenantId, userId) === 0) {
          throw problem(409, "LAST_ADMIN", "The last active admin cannot be suspended");
        }
        target.state = "SUSPENDED";
        this.cutOff(state, tenant, userId);
      } else {
        target.state = "ACTIVE";
        target.role = "MEMBER";
      }
      target.version += 1;
      tenant.generation += 1;
      return receipt.keep(this.wireMembership(state, tenant, target));
    });
  }

  /**
   * `DELETE …/members/{userId}` — 202 with an operation of its own; the
   * removal is applied, and the seat released, when it succeeds
   * (`memberOperationStepMs`). A removal already under way is 409.
   */
  private async removeTenantMember(bearer: string | null, tenantId: string, userId: string, version: string, key: string): Promise<unknown> {
    await this.delay("removeTenantMember");
    return this.write((state) => {
      const { session, tenant } = this.authorizeMembers(state, bearer, tenantId, "removeTenantMember", "RECOVERY");
      const receiptKey = `${session.userId}:removeTenantMember:${key}`;
      if (!CANONICAL_KEY.test(key)) throw problem(400, "VALIDATION_FAILED", "Idempotency-Key must be a canonical UUID");
      const hash = JSON.stringify({ userId, version });
      const stored = state.memberReceipts[receiptKey];
      if (stored) {
        if (stored.hash !== hash) throw problem(409, "IDEMPOTENCY_CONFLICT", "The key was used for another request");
        const operation = state.operations.find((item) => item.id === stored.operationId);
        return operation ? this.wireOperation(operation, false) : stored.answer;
      }
      const target = this.targetMembership(state, tenantId, userId);
      if (tenant.ownerId === userId) throw problem(409, "OWNER_MEMBERSHIP_PROTECTED", "The owner's membership is protected");
      this.checkVersion(version, target.version);
      if (state.operations.some((item) => item.subjectUserId === userId && item.tenantId === tenantId && !TERMINAL_OPERATION_STATES.has(item.state))) {
        throw problem(409, "INVALID_STATE", "The member is already being removed");
      }
      if (
        target.role === "TENANT_ADMIN" &&
        this.membershipState(state, tenantId, userId) === "ACTIVE" &&
        this.otherActiveAdmins(state, tenantId, userId) === 0
      ) {
        throw problem(409, "LAST_ADMIN", "The last active admin cannot be removed");
      }
      const createdAt = new Date(this.lifecycleNow()).toISOString();
      const operation: StoredOperation = {
        id: uuid(),
        tenantId,
        actorId: session.userId,
        type: REMOVE_OPERATION_TYPE,
        createdAt,
        state: "PENDING",
        updatedAt: createdAt,
        subjectUserId: userId,
      };
      state.operations.push(operation);
      // A zero step finishes the removal in the same answer.
      this.evaluate(state);
      const answer = this.wireOperation(operation, false);
      state.memberReceipts[receiptKey] = { hash, answer, operationId: operation.id };
      return answer;
    });
  }

  /**
   * `POST …/leave` (TENANT_SELF): never refused by a restriction; the owner
   * and the last active admin are; applied at once, as a removal of oneself —
   * 202 with a SUCCEEDED operation. The transport always sends
   * `{confirmed: true}`, so the 422 `CONFIRMATION_REQUIRED` is unreachable here.
   */
  private async leaveTenant(bearer: string | null, tenantId: string, key: string): Promise<unknown> {
    await this.delay("leaveTenant");
    const answer = this.write((state) => {
      const { session, tenant, actor } = this.authorizeMembers(state, bearer, tenantId, "leaveTenant", "LEAVE");
      const receipt = this.memberReceipt(state, session.userId, "leaveTenant", key, { confirmed: true });
      if (receipt.replay !== undefined) return receipt.replay;
      if (tenant.ownerId === session.userId) throw problem(409, "OWNER_MEMBERSHIP_PROTECTED", "The owner cannot leave the company");
      if (actor.role === "TENANT_ADMIN" && this.otherActiveAdmins(state, tenantId, session.userId) === 0) {
        throw problem(409, "LAST_ADMIN", "The last active admin cannot leave");
      }
      this.removeMembership(state, tenant, actor);
      const at = new Date(this.lifecycleNow()).toISOString();
      const operation: StoredOperation = {
        id: uuid(),
        tenantId,
        actorId: session.userId,
        type: LEAVE_OPERATION_TYPE,
        createdAt: at,
        state: "SUCCEEDED",
        updatedAt: at,
      };
      state.operations.push(operation);
      return receipt.keep(this.wireOperation(operation, false));
    });
    // Applied, and the answer never arrives (`loseAnswer: ["leaveTenant"]`, B-1).
    if (this.takeLostAnswer("leaveTenant")) throw new TypeError("Failed to fetch");
    return answer;
  }

  /** `GET …/invitations` (a company admin's): every state, `(issuedAt, id)`; the screen keeps PENDING and EXPIRED. */
  private async listTenantInvitations(bearer: string | null, tenantId: string, params: ListCompanyPageParams): Promise<unknown> {
    await this.delay("listTenantInvitations");
    return this.read((state) => {
      const { session } = this.authorizeMembers(state, bearer, tenantId, "listTenantInvitations", "ADMIN_READ");
      const limit = this.pageLimit(params);
      const bound = `${session.userId}:invitations:${tenantId}`;
      const offset = params.cursor === undefined ? 0 : this.readCursor(params.cursor, bound);
      const listed = state.invitations
        .filter((item) => item.tenantId === tenantId)
        .sort((a, b) => (a.issuedAt < b.issuedAt ? -1 : a.issuedAt > b.issuedAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const items = listed.slice(offset, offset + limit).map((item) => this.wireInvitation(item));
      const next = offset + limit;
      return next < listed.length ? { items, nextCursor: this.writeCursor(next, bound) } : { items };
    });
  }

  /**
   * `POST …/invitations`. The mock's answers where the blueprint is silent
   * (ask A23): an address that fails the shared rule, or a grant naming a
   * project that is not this company's, is 400 with a violation; an address
   * with a pending invitation, or of a current member, is 409 `INVALID_STATE`.
   * Then the seat: `used + reserved + 1 ≤ limit`, else 422 `QUOTA_EXCEEDED`.
   * Seven days on the lifecycle clock.
   */
  private async createTenantInvitation(
    bearer: string | null,
    tenantId: string,
    input: CreateInvitationInput,
    key: string,
  ): Promise<unknown> {
    await this.delay("createTenantInvitation");
    return this.write((state) => {
      const { session, tenant } = this.authorizeMembers(state, bearer, tenantId, "createTenantInvitation", "NORMAL");
      const receipt = this.memberReceipt(state, session.userId, "createTenantInvitation", key, {
        email: input.email,
        role: input.role,
        projectGrants: input.projectGrants,
      });
      if (receipt.replay !== undefined) return receipt.replay;
      const violations: FieldViolation[] = [];
      if (typeof input.email !== "string" || input.email !== trimInvitationEmail(input.email) || invitationEmailProblem(input.email) !== null) {
        violations.push({ field: "email", code: "INVALID", message: "email must be an email address of at most 254 characters" });
      }
      if (!isKnownMembershipRole(input.role)) violations.push({ field: "role", code: "INVALID", message: "role must be MEMBER or TENANT_ADMIN" });
      const grants = Array.isArray(input.projectGrants) ? input.projectGrants : [];
      if (grants.length > 100) violations.push({ field: "projectGrants", code: "TOO_MANY", message: "at most 100 grants" });
      const store = this.tenantStore(tenantId);
      this.applyClears(tenantId, state.cleared.filter((item) => item.tenantId === tenantId));
      grants.forEach((grant, index) => {
        if (!store.hasOpenProject(grant.projectId)) {
          violations.push({ field: `projectGrants[${index}].projectId`, code: "NOT_FOUND", message: "no such project in this tenant" });
        }
        if (!isKnownProjectGrantRole(grant.role)) {
          violations.push({ field: `projectGrants[${index}].role`, code: "INVALID", message: "role must be ADMIN, MEMBER or VIEWER" });
        }
      });
      if (violations.length > 0) throw invalid("Invalid request", violations);
      if (state.invitations.some((item) => item.tenantId === tenantId && item.state === "PENDING" && sameInvitationEmail(item.email, input.email))) {
        throw problem(409, "INVALID_STATE", "An invitation to this email is already pending");
      }
      const isMember = state.memberships.some(
        (item) =>
          item.tenantId === tenantId &&
          (item.state === "ACTIVE" || item.state === "SUSPENDED") &&
          sameInvitationEmail(this.accountStore.accountProfile(item.userId)?.email ?? null, input.email),
      );
      if (isMember) throw problem(409, "INVALID_STATE", "This email belongs to a member of the tenant");
      const seats = this.seatCounts(state, tenant);
      if (tenant.seatLimit !== null && seats.used + seats.reserved + 1n > BigInt(tenant.seatLimit)) {
        throw problem(422, "QUOTA_EXCEEDED", "No seat is free");
      }
      const issued = this.lifecycleNow();
      const invitation: StoredInvitation = {
        id: uuid(),
        tenantId,
        email: input.email,
        role: input.role,
        state: "PENDING",
        issuedAt: new Date(issued).toISOString(),
        expiresAt: new Date(issued + INVITATION_TTL_MS).toISOString(),
        createdBy: session.userId,
        projectGrants: grants.map((grant) => ({ projectId: grant.projectId, role: grant.role })),
        version: 1,
      };
      state.invitations.push(invitation);
      tenant.quotaVersion += 1;
      return receipt.keep(this.wireInvitation(invitation));
    });
  }

  /** `POST …/invitations/{id}/resend`: PENDING only (409), an expired one 422; a new link, the same `expiresAt`, no seat. */
  private async resendTenantInvitation(bearer: string | null, tenantId: string, invitationId: string, key: string): Promise<unknown> {
    await this.delay("resendTenantInvitation");
    return this.write((state) => {
      const { session } = this.authorizeMembers(state, bearer, tenantId, "resendTenantInvitation", "NORMAL");
      const receipt = this.memberReceipt(state, session.userId, "resendTenantInvitation", key, { invitationId });
      if (receipt.replay !== undefined) return receipt.replay;
      const invitation = this.targetInvitation(state, tenantId, invitationId);
      if (invitation.state === "EXPIRED") throw problem(422, "INVITATION_EXPIRED", "The invitation has expired");
      if (invitation.state !== "PENDING") throw problem(409, "INVALID_STATE", "The invitation is no longer pending");
      invitation.version += 1;
      return receipt.keep(this.wireInvitation(invitation));
    });
  }

  /** `DELETE …/invitations/{id}` with `If-Match`: PENDING only (409), then the version; its seat is released. 204. */
  private async revokeTenantInvitation(
    bearer: string | null,
    tenantId: string,
    invitationId: string,
    version: string,
    key: string,
  ): Promise<void> {
    await this.delay("revokeTenantInvitation");
    this.write((state) => {
      const { session, tenant } = this.authorizeMembers(state, bearer, tenantId, "revokeTenantInvitation", "RECOVERY");
      const receipt = this.memberReceipt(state, session.userId, "revokeTenantInvitation", key, { invitationId, version });
      if (receipt.replay !== undefined) return;
      const invitation = this.targetInvitation(state, tenantId, invitationId);
      if (invitation.state !== "PENDING") throw problem(409, "INVALID_STATE", "The invitation is no longer pending");
      this.checkVersion(version, invitation.version);
      invitation.state = "REVOKED";
      invitation.version += 1;
      tenant.quotaVersion += 1;
      receipt.keep(null);
    });
  }

  /** `GET …/quotas`: the SEAT row only (the mock has no PROJECT or STORAGE rows, TAS-512); never refused by a restriction. */
  private async getTenantQuotas(bearer: string | null, tenantId: string): Promise<unknown> {
    await this.delay("getTenantQuotas");
    return this.read((state) => {
      const { tenant } = this.authorizeMembers(state, bearer, tenantId, "getTenantQuotas", "SEATS");
      const seats = this.seatCounts(state, tenant);
      return {
        tenantId,
        version: String(tenant.quotaVersion),
        quotas: [
          {
            kind: "SEAT",
            used: seats.used.toString(),
            reserved: seats.reserved.toString(),
            ...(tenant.seatLimit === null ? { unlimited: true } : { limit: tenant.seatLimit, unlimited: false }),
            // `QuotaUsage` requires `version` and `unlimited` (api-contract-guard N3).
            version: String(tenant.quotaVersion),
          },
        ],
        asOf: new Date(this.now()).toISOString(),
      };
    });
  }

  /* ------------------------------- the company's name, owner and pause (TAS-504) */

  /*
   * api-contract-guard §6, the order of checks: (1) a bearer, (2) a company
   * session — WEB_GLOBAL is 400 `TENANT_REQUIRED`, (3) a `refuseNext` hook,
   * (4) the path's id a UUID and the session's own company (403
   * `TENANT_MISMATCH`), (5) the company there (404), (6) ACTIVE (409
   * `INVALID_STATE`), (7) the caller ACTIVE (403 `MEMBERSHIP_INACTIVE`), (8)
   * the caller its owner (403 `OWNER_REQUIRED`), (9) the command's restriction
   * rule (403 `READ_ONLY` with every current restriction, in
   * `RESTRICTION_ORDER`), (10) the platform's flags (403 `CAPABILITY_DISABLED`,
   * no reasons; never for a resume), (11) a transfer's paid coverage (409
   * `INVALID_STATE` — the code the blueprint has not named, ask A32), (12) the
   * key's durable receipt — after the access checks, so a replay is checked
   * again (contracts.md:89) and a transfer's replay by its former owner is 403
   * `OWNER_REQUIRED` (ask A33) —, (13) the body, (14) `If-Match`, (15) apply.
   * No session is revoked by any of them.
   */

  /** `PATCH /tenants/{t}` `{name}` — the shared name rule; the same name is a 200 at the same version. */
  private async renameTenant(bearer: string | null, tenantId: string, name: string, version: string, key: string): Promise<unknown> {
    await this.delay("renameTenant");
    const answer = this.write((state) => {
      const { session, tenant } = this.authorizeOwner(state, bearer, tenantId, "renameTenant", "NORMAL");
      const receipt = this.memberReceipt(state, session.userId, "renameTenant", key, { name, version });
      if (receipt.replay !== undefined) return receipt.replay;
      if (typeof name !== "string" || tenantNameProblem(name) !== null) {
        throw invalid("Invalid request", [{ field: "name", code: "INVALID", message: "name must be 1-120 characters, trimmed, without control characters" }]);
      }
      this.checkVersion(version, tenant.version);
      if (name !== tenant.name) {
        tenant.name = name;
        tenant.version = nextVersion(tenant.version);
      }
      return receipt.keep(this.wireTenant(tenant));
    });
    if (this.takeLostAnswer("renameTenant")) throw new TypeError("Failed to fetch");
    return answer;
  }

  /** `PUT /tenants/{t}/pause` — adds `OWNER_PAUSE`; a company already paused is a 200 at the same version (ask A34). */
  private async pauseTenant(bearer: string | null, tenantId: string, version: string, key: string): Promise<unknown> {
    await this.delay("pauseTenant");
    const answer = this.write((state) => {
      const { session, tenant } = this.authorizeOwner(state, bearer, tenantId, "pauseTenant", "OWNER_CONTROL");
      if (this.hooks().ownerPauseEnabled === false) {
        throw problem(403, "CAPABILITY_DISABLED", "Pausing a company is not available");
      }
      const receipt = this.memberReceipt(state, session.userId, "pauseTenant", key, { confirmed: true, version });
      if (receipt.replay !== undefined) return receipt.replay;
      this.checkVersion(version, tenant.version);
      setRestriction(tenant, "OWNER_PAUSE", true);
      return receipt.keep(this.wireTenant(tenant));
    });
    if (this.takeLostAnswer("pauseTenant")) throw new TypeError("Failed to fetch");
    return answer;
  }

  /**
   * `DELETE /tenants/{t}/pause` — lifts `OWNER_PAUSE` and nothing else: a
   * block, a dispute and an ended period stay (D131), and the paid period is
   * not moved. Refused under a block, as the access matrix's OWNER_CONTROL
   * says (ask A34c). Not paused is a 200 at the same version.
   */
  private async resumeTenant(bearer: string | null, tenantId: string, version: string, key: string): Promise<unknown> {
    await this.delay("resumeTenant");
    const answer = this.write((state) => {
      const { session, tenant } = this.authorizeOwner(state, bearer, tenantId, "resumeTenant", "OWNER_CONTROL");
      const receipt = this.memberReceipt(state, session.userId, "resumeTenant", key, { version });
      if (receipt.replay !== undefined) return receipt.replay;
      this.checkVersion(version, tenant.version);
      setRestriction(tenant, "OWNER_PAUSE", false);
      return receipt.keep(this.wireTenant(tenant));
    });
    if (this.takeLostAnswer("resumeTenant")) throw new TypeError("Failed to fetch");
    return answer;
  }

  /**
   * `POST /tenants/{t}/ownership-transfer` `{newOwnerUserId, confirmed}` — a
   * paid company with current coverage only (a FREE one, or one whose period
   * has ended, is 409 `INVALID_STATE`); allowed under the owner's own pause
   * (D244). The recipient: a UUID (400), not the caller (409), a member (404
   * `RESOURCE_NOT_FOUND`), ACTIVE (409 `INVALID_STATE` — never the caller's
   * `MEMBERSHIP_INACTIVE`). Applied: the recipient owns it and is a
   * TENANT_ADMIN, the former owner stays a TENANT_ADMIN, both memberships and
   * the generation move, the old autopay consent is switched off, and no
   * session is revoked (ask A36).
   */
  private async transferTenantOwnership(
    bearer: string | null,
    tenantId: string,
    newOwnerUserId: string,
    version: string,
    key: string,
  ): Promise<unknown> {
    await this.delay("transferTenantOwnership");
    const answer = this.write((state) => {
      const { session, tenant, actor } = this.authorizeOwner(state, bearer, tenantId, "transferTenantOwnership", "TRANSFER");
      if (this.hooks().ownershipTransferEnabled === false) {
        throw problem(403, "CAPABILITY_DISABLED", "Transferring a company is not available");
      }
      const through = tenant.subscription.paidThrough;
      const covered = through !== undefined && Date.parse(through) > this.lifecycleNow();
      if (isFreePlan(tenant.subscription.planVersionId) || !covered) {
        throw problem(409, "INVALID_STATE", "The tenant has no current paid coverage");
      }
      const receipt = this.memberReceipt(state, session.userId, "transferTenantOwnership", key, { newOwnerUserId, confirmed: true, version });
      if (receipt.replay !== undefined) return receipt.replay;
      if (typeof newOwnerUserId !== "string" || !UUID_PATTERN.test(newOwnerUserId)) {
        throw invalid("Invalid request", [{ field: "newOwnerUserId", code: "INVALID", message: "newOwnerUserId must be a UUID" }]);
      }
      if (newOwnerUserId === session.userId) throw problem(409, "INVALID_STATE", "The tenant is already owned by this user");
      const recipient = state.memberships.find((item) => item.tenantId === tenantId && item.userId === newOwnerUserId);
      if (!recipient || recipient.state === "REMOVED") throw problem(404, "RESOURCE_NOT_FOUND", "Membership not found");
      if (this.membershipState(state, tenantId, newOwnerUserId) !== "ACTIVE") {
        throw problem(409, "INVALID_STATE", "The new owner's membership is not active");
      }
      this.checkVersion(version, tenant.version);
      tenant.ownerId = newOwnerUserId;
      tenant.ownerVersion = nextVersion(tenant.ownerVersion);
      tenant.version = nextVersion(tenant.version);
      tenant.generation += 1;
      recipient.role = "TENANT_ADMIN";
      recipient.version += 1;
      actor.role = "TENANT_ADMIN";
      actor.version += 1;
      // The former owner's consent is never carried over: the new owner sets up their own.
      tenant.subscription = { ...tenant.subscription, autopayState: "DISABLED", version: nextVersion(tenant.subscription.version) };
      return receipt.keep(this.wireTenant(tenant));
    });
    if (this.takeLostAnswer("transferTenantOwnership")) throw new TypeError("Failed to fetch");
    return answer;
  }

  /** `GET /tenants/{t}/billing/subscription` — the company's own session and its owner only (403 `OWNER_REQUIRED`); no restriction stops it. */
  private async getSubscription(bearer: string | null, tenantId: string): Promise<unknown> {
    await this.delay("getSubscription");
    const answer = this.read((state) => {
      const { session, tenant } = this.authorizeControl(state, bearer, tenantId, "getSubscription");
      if (tenant.ownerId !== session.userId) throw problem(403, "OWNER_REQUIRED", "Only the owner can read the subscription");
      return this.wireSubscription(tenant);
    });
    if (this.takeLostAnswer("getSubscription")) throw new TypeError("Failed to fetch");
    return answer;
  }

  /** Checks (1)–(9) for the four commands — see the block comment above. */
  private authorizeOwner(
    state: ServerState,
    bearer: string | null,
    tenantId: string,
    operation: string,
    policy: TenantPolicy,
  ): { session: StoredSession; tenant: StoredTenant; actor: StoredMembership } {
    if (!bearer) throw problem(401, "AUTHENTICATION_REQUIRED", "Authentication required");
    const session = this.sessionOf(state, bearer);
    if (session.kind === "WEB_GLOBAL") throw problem(400, "TENANT_REQUIRED", "A company session is required");
    const refusal = this.takeRefusal(operation);
    if (refusal) throw refusal;
    if (!UUID_PATTERN.test(tenantId)) throw problem(400, "VALIDATION_FAILED", "tenantId must be a UUID");
    if (session.tenantId !== tenantId) throw problem(403, "TENANT_MISMATCH", "The session is for another tenant");
    const tenant = state.tenants.find((item) => item.id === tenantId);
    if (!tenant || tenant.lifecycle === "DELETED") throw problem(404, "TENANT_NOT_FOUND", "Tenant not found");
    if (tenant.lifecycle !== "ACTIVE") throw problem(409, "INVALID_STATE", "The tenant is not active");
    const actor = state.memberships.find((item) => item.tenantId === tenantId && item.userId === session.userId);
    if (!actor || this.membershipState(state, tenantId, session.userId) !== "ACTIVE") {
      throw problem(403, "MEMBERSHIP_INACTIVE", "Membership is not active");
    }
    if (tenant.ownerId !== session.userId) throw problem(403, "OWNER_REQUIRED", "Only the owner can change the tenant");
    const restrictions = orderedRestrictions(tenant.restrictions);
    if (restrictions.some((code) => !POLICY_ALLOWS[policy].has(code))) {
      throw problem(403, "READ_ONLY", "The tenant is read-only", restrictions);
    }
    return { session, tenant, actor };
  }

  /**
   * The checks in front of every member route, in PR #287's order up to the
   * receipt: a company session of exactly this company (WEB_GLOBAL is 400
   * `TENANT_REQUIRED`, another company's 403 `TENANT_MISMATCH`), the company
   * there (404), a `refuseNext` hook, (1) the lifecycle, (2) the caller's
   * membership ACTIVE, (3) a company admin where the route needs one, (4) the
   * route's restriction policy:
   *
   * - `DIRECTORY` (the members list): refused 403 `CAPABILITY_DISABLED`
   *   before the first payment only — since TAS-504 the control plane under a
   *   pause or a block whatever the global read flag says (art-director G1,
   *   ask A35), so the owner can choose a new owner and a member can leave;
   * - `SEATS` and `LEAVE`: never;
   * - `ADMIN_READ` (the invitations list): none stated, so never;
   * - `NORMAL` (role, state, invite, resend): `READ_ONLY` under any restriction;
   * - `RECOVERY` (remove, revoke): allowed under `PAYMENT_EXPIRED` and
   *   `OVER_QUOTA` only, otherwise `READ_ONLY`.
   */
  private authorizeMembers(
    state: ServerState,
    bearer: string | null,
    tenantId: string,
    operation: string,
    policy: MemberPolicy,
  ): { session: StoredSession; tenant: StoredTenant; actor: StoredMembership } {
    if (!bearer) throw problem(401, "AUTHENTICATION_REQUIRED", "Authentication required");
    const session = this.sessionOf(state, bearer);
    if (session.kind === "WEB_GLOBAL") throw problem(400, "TENANT_REQUIRED", "A company session is required");
    const refusal = this.takeRefusal(operation);
    if (refusal) throw refusal;
    if (!UUID_PATTERN.test(tenantId)) throw problem(400, "VALIDATION_FAILED", "tenantId must be a UUID");
    if (session.tenantId !== tenantId) throw problem(403, "TENANT_MISMATCH", "The session is for another tenant");
    const tenant = state.tenants.find((item) => item.id === tenantId);
    if (!tenant || tenant.lifecycle === "DELETED") throw problem(404, "TENANT_NOT_FOUND", "Tenant not found");
    const read = policy === "DIRECTORY" || policy === "SEATS" || policy === "ADMIN_READ";
    if (read ? tenant.lifecycle === "PROVISIONING" : tenant.lifecycle !== "ACTIVE") {
      throw problem(409, "INVALID_STATE", "The tenant is not active");
    }
    const actor = state.memberships.find((item) => item.tenantId === tenantId && item.userId === session.userId);
    if (!actor || this.membershipState(state, tenantId, session.userId) !== "ACTIVE") {
      throw problem(403, "MEMBERSHIP_INACTIVE", "Membership is not active");
    }
    if ((policy === "ADMIN_READ" || policy === "NORMAL" || policy === "RECOVERY") && actor.role !== "TENANT_ADMIN") {
      throw problem(403, "SCOPE_DENIED", "A tenant admin is required");
    }
    const restrictions = this.restrictionsOf(tenant);
    if (policy === "DIRECTORY" && restrictions.includes("PENDING_FIRST_PAYMENT")) {
      throw problem(403, "CAPABILITY_DISABLED", "The directory is not available", restrictions);
    }
    if (policy === "NORMAL" && restrictions.length > 0) throw problem(403, "READ_ONLY", "The tenant is read-only", restrictions);
    if (policy === "RECOVERY" && restrictions.some((code) => !RECOVERY_ALLOWED.has(code))) {
      throw problem(403, "READ_ONLY", "The tenant is read-only", restrictions);
    }
    return { session, tenant, actor };
  }

  /** The company's restrictions, with the `restrict` hook's added — for the member routes only. */
  private restrictionsOf(tenant: StoredTenant): string[] {
    const extra = this.hooks().restrict?.[tenant.id];
    const added = Array.isArray(extra) ? extra.filter((code): code is string => typeof code === "string" && code !== "") : [];
    return [...new Set([...tenant.restrictions, ...added])];
  }

  /**
   * (5) The key's durable receipt: a key that is not a canonical UUID is 400;
   * seen with the same request, `replay` is what it answered; with another,
   * 409 `IDEMPOTENCY_CONFLICT`. `keep` records an answer and hands it back.
   */
  private memberReceipt(
    state: ServerState,
    actorId: string,
    operation: string,
    key: string,
    request: unknown,
  ): { replay: unknown; keep: <T>(answer: T) => T } {
    if (!CANONICAL_KEY.test(key)) throw problem(400, "VALIDATION_FAILED", "Idempotency-Key must be a canonical UUID");
    const receiptKey = `${actorId}:${operation}:${key}`;
    const hash = JSON.stringify(request);
    const stored = state.memberReceipts[receiptKey];
    if (stored) {
      if (stored.hash !== hash) throw problem(409, "IDEMPOTENCY_CONFLICT", "The key was used for another request");
      return { replay: stored.answer ?? null, keep: (answer) => answer };
    }
    return {
      replay: undefined,
      keep: (answer) => {
        state.memberReceipts[receiptKey] = { hash, answer };
        return answer;
      },
    };
  }

  /** (6) The target membership: absent or REMOVED is 404 `RESOURCE_NOT_FOUND`. */
  private targetMembership(state: ServerState, tenantId: string, userId: string): StoredMembership {
    const target = state.memberships.find((item) => item.tenantId === tenantId && item.userId === userId);
    if (!target || target.state === "REMOVED") throw problem(404, "RESOURCE_NOT_FOUND", "Membership not found");
    return target;
  }

  private targetInvitation(state: ServerState, tenantId: string, invitationId: string): StoredInvitation {
    const invitation = state.invitations.find((item) => item.id === invitationId && item.tenantId === tenantId);
    if (!invitation) throw problem(404, "RESOURCE_NOT_FOUND", "Invitation not found");
    return invitation;
  }

  /** (8) `If-Match`: missing 428 `VERSION_CONFLICT`, malformed 400 `VALIDATION_FAILED`, stale 412 (contracts §6). */
  private checkVersion(version: string, current: number | string): void {
    if (version === "") throw problem(428, "VERSION_CONFLICT", "If-Match is required");
    if (!/^(0|[1-9][0-9]{0,18})$/.test(version)) throw problem(400, "VALIDATION_FAILED", "If-Match must be a quoted version");
    if (version !== String(current)) throw problem(412, "VERSION_CONFLICT", "The resource has changed");
  }

  /** (9) The active admins other than `userId` — the owner is always one, so this is 0 only in a fixture nobody seeds. */
  private otherActiveAdmins(state: ServerState, tenantId: string, userId: string): number {
    return state.memberships.filter(
      (item) =>
        item.tenantId === tenantId &&
        item.userId !== userId &&
        item.role === "TENANT_ADMIN" &&
        this.membershipState(state, tenantId, item.userId) === "ACTIVE",
    ).length;
  }

  /** `used` (ACTIVE and SUSPENDED memberships) and `reserved` (PENDING invitations), in BigInt. */
  private seatCounts(state: ServerState, tenant: StoredTenant): { used: bigint; reserved: bigint } {
    const used = state.memberships.filter(
      (item) => item.tenantId === tenant.id && (item.state === "ACTIVE" || item.state === "SUSPENDED"),
    ).length;
    const reserved = state.invitations.filter((item) => item.tenantId === tenant.id && item.state === "PENDING").length;
    return { used: BigInt(used), reserved: BigInt(reserved) };
  }

  /** The person's pending invitations revoked — on a suspension, removal, demotion or leave (contracts §8, L03). */
  private revokeInvitationsBy(state: ServerState, tenant: StoredTenant, userId: string): void {
    let revoked = false;
    for (const invitation of state.invitations) {
      if (invitation.tenantId !== tenant.id || invitation.createdBy !== userId || invitation.state !== "PENDING") continue;
      invitation.state = "REVOKED";
      invitation.version += 1;
      revoked = true;
    }
    if (revoked) tenant.quotaVersion += 1;
  }

  /**
   * What a suspension, a removal and a leave take from a person (contracts
   * §8): their company sessions, their pending invitations, their project
   * rows and assignments — recorded, so a store built later leaves them out.
   */
  private cutOff(state: ServerState, tenant: StoredTenant, userId: string): void {
    this.revokeSessionsOf(state, tenant, userId);
    this.revokeInvitationsBy(state, tenant, userId);
    const seq = state.cleared.reduce((top, item) => Math.max(top, item.seq), 0) + 1;
    state.cleared.push({ tenantId: tenant.id, userId, seq });
    this.applyClears(
      tenant.id,
      state.cleared.filter((item) => item.tenantId === tenant.id),
    );
  }

  /** The person's company sessions of this company, revoked. */
  private revokeSessionsOf(state: ServerState, tenant: StoredTenant, userId: string): void {
    for (const session of state.sessions) {
      if (session.kind === "WEB_TENANT" && session.tenantId === tenant.id && session.userId === userId) session.revokedAt ??= this.now();
    }
  }

  /** A membership ended — removed or left: REMOVED, its seat free, and everything `cutOff` takes. */
  private removeMembership(state: ServerState, tenant: StoredTenant, membership: StoredMembership): void {
    membership.state = "REMOVED";
    membership.version += 1;
    tenant.generation += 1;
    tenant.quotaVersion += 1;
    this.cutOff(state, tenant, membership.userId);
  }

  /** The clears this page's store of `tenantId` has not applied yet, applied — once each. */
  private applyClears(tenantId: string, cleared: ReadonlyArray<{ userId: string; seq: number }>): void {
    const store = this.stores.get(tenantId);
    if (!store) return;
    const applied = this.appliedClears.get(tenantId) ?? new Set<number>();
    this.appliedClears.set(tenantId, applied);
    for (const item of cleared) {
      if (applied.has(item.seq)) continue;
      store.forgetCompanyMember(item.userId);
      applied.add(item.seq);
    }
  }

  private pageLimit(params: ListCompanyPageParams): number {
    const limit = params.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw problem(400, "VALIDATION_FAILED", "limit must be 1–100");
    return limit;
  }

  /** `Membership` as the blueprint has it (its to-be — develop sends no profile, TAS-321); never `avatarPath`. */
  private wireMembership(state: ServerState, tenant: StoredTenant, membership: StoredMembership): unknown {
    const profile = this.accountStore.accountProfile(membership.userId);
    return {
      id: membership.id,
      tenantId: membership.tenantId,
      userId: membership.userId,
      role: membership.role,
      state: this.membershipState(state, membership.tenantId, membership.userId) ?? membership.state,
      isOwner: tenant.ownerId === membership.userId,
      ...(profile ? { displayName: profile.displayName, email: profile.email } : {}),
      version: String(membership.version),
    };
  }

  /** `Invitation` — without `issuedAt`, which is not on the wire. */
  private wireInvitation(invitation: StoredInvitation): unknown {
    const { issuedAt: _issued, version, projectGrants, ...rest } = invitation;
    return { ...rest, projectGrants: projectGrants.map((grant) => ({ ...grant })), version: String(version) };
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
    // Only a pause or a block closes content with the flag off (contracts §5,
    // D82); a dispute, an ended period or a quota leaves it readable
    // (api-contract-guard §4). The reasons are every current restriction.
    if (kind === "tenant-read" && closesContent(tenant.restrictions) && !this.contentReadUnderRestriction()) {
      throw problem(403, "CAPABILITY_DISABLED", "Project content is not available", orderedRestrictions(tenant.restrictions));
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

  /**
   * `Tenant` as the wire carries it: `creationDeadline` only when there is one,
   * and none of the mock's own bookkeeping — the subscription included
   * (TAS-504: `getSubscription` is the owner's only).
   */
  private wireTenant(tenant: StoredTenant): unknown {
    const { seatLimit: _seats, quotaVersion: _quota, generation: _generation, subscription: _subscription, ...rest } = tenant;
    return { ...rest, restrictions: [...tenant.restrictions] };
  }

  /** `Subscription`: `paidThrough` and `anchorDay` only when there is a paid period (ask A37). */
  private wireSubscription(tenant: StoredTenant): unknown {
    const { planVersionId, version, paidThrough, anchorDay, renewalCancelled, autopayState } = tenant.subscription;
    return {
      tenantId: tenant.id,
      planVersionId,
      version,
      ...(paidThrough === undefined ? {} : { paidThrough }),
      ...(anchorDay === undefined ? {} : { anchorDay }),
      renewalCancelled,
      autopayState,
    };
  }

  /** `Operation`; `asCreated` is develop's createTenant answer — PENDING, `updatedAt = createdAt` (ask A12). */
  private wireOperation(operation: StoredOperation, asCreated: boolean): unknown {
    const { actorId: _actor, subjectUserId: _subject, failureCode, ...rest } = operation;
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
        if (parsed && parsed.v === 4 && Array.isArray(parsed.tenants)) return parsed;
      }
    } catch {
      if (this.memory) return this.memory;
    }
    return {
      v: 4,
      ...seedTenants(this.now()),
      sessions: [],
      access: {},
      refresh: {},
      receipts: {},
      operations: [],
      creations: {},
      cancels: {},
      memberReceipts: {},
      cleared: [],
    };
  }

  /**
   * The lifecycle clock's effects (TAS-501): an operation moves through
   * PENDING and RUNNING to its outcome by `provisioning.stepMs`, and a FREE
   * company opens when it succeeds; a confirmed first payment opens a company
   * awaiting it; a passed deadline closes it (`AUTO_CLOSED`); a late
   * confirmation reopens an auto-closed one (D216) — never a cancelled one.
   * Each change moves the company's version. Since TAS-502 a removal's
   * operation moves the same way by `memberOperationStepMs` (default 0) and
   * removes the member when it succeeds, and a pending invitation whose
   * `expiresAt` has passed is EXPIRED, its seat released. Since TAS-504 a
   * confirmed first payment starts a paid period (`PAID_PERIOD_MS`, the mock's
   * own length), an ACTIVE company whose `paidThrough` has passed gets
   * `PAYMENT_EXPIRED` (nothing here lifts it — payment is TAS-513), and the
   * `platformBlock` hook sets or lifts `PLATFORM_BLOCK`; each change moves the
   * version. Answers whether anything changed.
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
    const open = (tenant: StoredTenant, paidAt?: number) => {
      tenant.lifecycle = "ACTIVE";
      tenant.restrictions = tenant.restrictions.filter((code) => code !== "PENDING_FIRST_PAYMENT");
      delete tenant.creationDeadline;
      tenant.version = nextVersion(tenant.version);
      // A first payment confirmed: the paid period starts (TAS-504).
      if (paidAt !== undefined && !isFreePlan(tenant.subscription.planVersionId)) {
        const through = new Date(paidAt + PAID_PERIOD_MS);
        tenant.subscription = {
          ...tenant.subscription,
          version: nextVersion(tenant.subscription.version),
          paidThrough: through.toISOString(),
          anchorDay: through.getUTCDate(),
        };
      }
      changed = true;
    };

    const memberStep = hooks.memberOperationStepMs;
    const memberStepMs = typeof memberStep === "number" && Number.isFinite(memberStep) && memberStep >= 0 ? memberStep : 0;
    const memberOutcome = hooks.memberOperationOutcome;
    const memberTerminal = memberOutcome === "FAILED" || memberOutcome === "MANUAL_REVIEW" ? memberOutcome : "SUCCEEDED";
    for (const operation of state.operations) {
      if (TERMINAL_OPERATION_STATES.has(operation.state)) continue;
      const removal = operation.type === REMOVE_OPERATION_TYPE;
      const step = removal ? memberStepMs : stepMs;
      const end = removal ? memberTerminal : terminal;
      const started = Date.parse(operation.createdAt);
      const elapsed = now - started;
      const next = elapsed < step ? "PENDING" : elapsed < 2 * step ? "RUNNING" : end;
      if (next === operation.state) continue;
      operation.state = next;
      operation.updatedAt = new Date(next === "RUNNING" ? started + step : started + 2 * step).toISOString();
      if (next === "FAILED") {
        operation.failureCode = removal
          ? (hooks.memberOperationFailureCode ?? "DEPENDENCY_UNAVAILABLE")
          : (hooks.provisioning?.failureCode ?? "DEPENDENCY_UNAVAILABLE");
      }
      changed = true;
      const tenant = state.tenants.find((item) => item.id === operation.tenantId);
      if (removal) {
        const subject = state.memberships.find((item) => item.tenantId === operation.tenantId && item.userId === operation.subjectUserId);
        if (next === "SUCCEEDED" && tenant && subject && subject.state !== "REMOVED") this.removeMembership(state, tenant, subject);
        continue;
      }
      if (next === "SUCCEEDED" && tenant?.lifecycle === "PROVISIONING") open(tenant);
    }
    for (const invitation of state.invitations) {
      if (invitation.state !== "PENDING" || Date.parse(invitation.expiresAt) > now) continue;
      invitation.state = "EXPIRED";
      invitation.version += 1;
      const tenant = state.tenants.find((item) => item.id === invitation.tenantId);
      if (tenant) tenant.quotaVersion += 1;
      changed = true;
    }
    for (const tenant of state.tenants) {
      if (tenant.lifecycle === "AWAITING_PAYMENT" && confirmed.has(tenant.id)) open(tenant, now);
      else if (tenant.lifecycle === "AWAITING_PAYMENT" && tenant.creationDeadline && Date.parse(tenant.creationDeadline) <= now) {
        tenant.lifecycle = "AUTO_CLOSED";
        tenant.version = nextVersion(tenant.version);
        changed = true;
      } else if (tenant.lifecycle === "AUTO_CLOSED" && late.has(tenant.id)) open(tenant, now);
    }
    // TAS-504: the platform's block, and paid periods that have ended.
    const blocks = typeof hooks.platformBlock === "object" && hooks.platformBlock !== null ? hooks.platformBlock : {};
    for (const tenant of state.tenants) {
      const block = blocks[tenant.id];
      if (typeof block === "boolean" && setRestriction(tenant, "PLATFORM_BLOCK", block)) changed = true;
      const through = tenant.subscription.paidThrough;
      if (tenant.lifecycle === "ACTIVE" && through !== undefined && Date.parse(through) <= now && setRestriction(tenant, "PAYMENT_EXPIRED", true)) {
        changed = true;
      }
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
