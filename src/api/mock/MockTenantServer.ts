import { apiErrorFacts } from "../errors";
import type { LoginInput } from "../TaskaApi";
import type { ListTenantsParams } from "../tenants";
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
 * **Shared by every tab** through `localStorage` `taska.mockServer.v1`: the
 * companies, memberships, sessions and tokens, read and written on every
 * operation, so a second tab — or a duplicated one — meets the same server.
 * Each company's projects and issues are this page's own, in memory, as
 * today's mock's are: they reset with a reload.
 *
 * This narrows docs/ai/API-DIVERGENCE.md's "The mock has a session flag but no
 * session enforcement" for the companies build only; today's build's mock is
 * untouched and enforces nothing.
 */

export const MOCK_SERVER_KEY = "taska.mockServer.v1";

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
 *   `createTenantSession`, `revokeTenantSession`) or a `TaskaApi` method name.
 */
export const MOCK_TENANT_HOOKS_KEY = "taska.mockTenantHooks";

export interface MockTenantHooks {
  suspend?: Array<{ tenantId: string; userId: string }>;
  accessTtlSeconds?: number;
  delayMs?: Record<string, number>;
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
} as const;

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

interface ServerState {
  v: 1;
  tenants: StoredTenant[];
  memberships: StoredMembership[];
  sessions: StoredSession[];
  access: Record<string, { sessionId: string; expiresAt: number }>;
  refresh: Record<string, StoredRefresh>;
  receipts: Record<string, StoredReceipt>;
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
  ) {
    super(title);
    this.name = "MockProblemError";
    this.requestId = uuid();
  }
}

const problem = (status: number, code: string, title: string, reasons: readonly string[] = []) =>
  new MockProblemError(status, code, title, reasons);

const uuid = () =>
  globalThis.crypto?.randomUUID?.() ??
  "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const FAMILY_LIFETIME_MS = 7 * DAY;
const SECRET_RECEIPT_MS = 60_000;
const DEFAULT_ACCESS_TTL_S = 900;
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
 */
function seedTenants(): Pick<ServerState, "tenants" | "memberships"> {
  const at = (day: number) => `2026-05-${String(day).padStart(2, "0")}T09:00:00Z`;
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
      tenant(ids.massive, "Massive Dynamic", tom, 6, "AUTO_CLOSED"),
      tenant(ids.longName, MOCK_LONG_TENANT_NAME, priya, 7),
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

  /** The five blueprint routes, as the session layer calls them. */
  transport(): B2bTransport {
    return {
      startWebSession: (input, key) => this.startWebSession(input, key),
      refreshWebSession: (refreshToken, key) => this.refreshWebSession(refreshToken, key),
      listTenants: (bearer, params) => this.listTenants(bearer, params),
      createTenantSession: (bearer, tenantId, key) => this.createTenantSession(bearer, tenantId, key),
      revokeTenantSession: (bearer, tenantSessionId) => this.revokeTenantSession(bearer, tenantSessionId),
    };
  }

  /**
   * One data call: the bearer checked against `kind`, then `run` on the store
   * it opens — the company's for a company route, the account's for the
   * account's own — signed in as the bearer's account.
   */
  async serve<T>(bearer: string | null, kind: MockRouteKind, operation: string, run: (store: MockTaskaStore) => Promise<T>): Promise<T> {
    await this.delay(operation, 0);
    const grant = this.read((state) => this.authorize(state, bearer, kind));
    const store = kind === "account" || grant.tenantId === null ? this.accountStore : this.tenantStore(grant.tenantId);
    if (!store.restoreSession(grant.userId)) throw problem(401, "AUTHENTICATION_REQUIRED", "Invalid session");
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
   * write in a company with any restriction is 403 `READ_ONLY` with them as
   * `reasons`.
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
    if (kind === "tenant-write" && tenant.restrictions.length > 0) {
      throw problem(403, "READ_ONLY", "The company is read-only", tenant.restrictions);
    }
    if (kind === "tenant-read" && tenant.restrictions.length > 0 && !MOCK_PROJECT_CONTENT_READ_UNDER_RESTRICTION) {
      throw problem(403, "CAPABILITY_DISABLED", "Project content is not available", tenant.restrictions);
    }
    return { userId: session.userId, tenantId };
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
    try {
      const raw = this.storage.getItem(MOCK_SERVER_KEY);
      if (raw !== null) {
        const parsed = JSON.parse(raw) as ServerState;
        if (parsed && parsed.v === 1 && Array.isArray(parsed.tenants)) return parsed;
      }
    } catch {
      if (this.memory) return this.memory;
    }
    return { v: 1, ...seedTenants(), sessions: [], access: {}, refresh: {}, receipts: {} };
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
