import { clearLastCompany, readLastCompany, writeLastCompany } from "../lib/lastCompany";
import { WorkspaceClosedError, apiErrorFacts, isWorkspaceClosed, refusalCode, refusalReasons } from "./errors";
import { SessionExpiredSignal, WorkspaceClosedSignal } from "./session";
import type {
  LoginInput,
  SignInResult,
  Workspace,
  WorkspaceClosedEvent,
  WorkspaceLeftEvent,
  WorkspacePendingEvent,
} from "./TaskaApi";
import { TRANSPORT_FAILURE_REASON } from "./TaskaApi";
import { TENANT_CREATION_KEY } from "./tenantCreation";
import {
  toInvitation,
  toInvitationPage,
  toMembership,
  toMembershipPage,
  toQuotaSnapshot,
  type CreateInvitationInput,
  type Invitation,
  type InvitationPage,
  type KnownMembershipRole,
  type ListCompanyPageParams,
  type Membership,
  type MembershipPage,
  type QuotaSnapshot,
} from "./tenantMembers";
import {
  toCreateTenantResult,
  toPlanVersionPage,
  toTenant,
  toTenantOperation,
  toTenantPage,
  type CreateTenantInput,
  type CreateTenantResult,
  type ListBillingPlansParams,
  type ListTenantsParams,
  type PlanVersionPage,
  type Tenant,
  type TenantOperation,
  type TenantPage,
} from "./tenants";

/*
 * The companies build's session layer (TAS-500), shared by both
 * implementations: `RestTaskaApi` hands it a transport that calls the B2B
 * blueprint's routes over `fetch`, the mock one that calls `MockTenantServer`.
 * Everything that decides *which* credential a request carries, when it is
 * renewed, and whether its answer still belongs to the tab lives here, once —
 * so the two implementations cannot drift apart on it.
 *
 * The specification is api-contract-guard's pre-build design
 * (docs/ai/reviews/TAS-500/contract-guard-design.md §2–§5, B1–B3, B8):
 *
 * - **Two families.** The account session (WEB_GLOBAL) is one record,
 *   `taska.webSession` in `localStorage`, shared by every tab of the browser.
 *   The company session (WEB_TENANT) is the tab's own, `taska.tab` in
 *   `sessionStorage`. WEB_GLOBAL is sent only for the company list and the
 *   company-session commands — and, in a tab with no company, for the account
 *   routes; everything else in a company goes with the tab's WEB_TENANT.
 * - **Rotation is single-use** (contracts §2), so a refresh token is rotated
 *   only with the `Idempotency-Key` recorded next to it before the request
 *   leaves; a retry sends the same key and gets the same pair from the
 *   server's 60-second receipt; the key is cleared with the new pair written in
 *   the same `setItem`. The account family rotates under the Web Lock
 *   `taska.web-session.refresh`, re-reading the record inside it, so two tabs
 *   never rotate it together (B1). The company family is renewed only by the
 *   tab holding the lock `taska.tenant-session.<id>`, held for the document's
 *   life; a tab that cannot take it within `ownershipWaitMs` is a duplicate
 *   and mints a session of its own without ever touching the copy (B2).
 * - **The context epoch** (B3). Every request captures it; it moves on a
 *   switch, a closed company, a re-selected session, signing in and signing
 *   out; an answer for an older epoch — success or failure — becomes
 *   `WorkspaceClosedError`, and the older epoch's `AbortController` is aborted.
 *   A request made while a transition is in flight waits for it, and is then
 *   refused without being sent if the epoch moved meanwhile.
 */

export const WEB_SESSION_KEY = "taska.webSession";
export const TAB_KEY = "taska.tab";
/** Today's build's pair. Never read in the companies build, and deleted at its sign-in (B8). */
export const LEGACY_ACCESS_TOKEN_KEY = "taska.accessToken";
export const LEGACY_REFRESH_TOKEN_KEY = "taska.refreshToken";
export const ACCOUNT_REFRESH_LOCK = "taska.web-session.refresh";
export const companySessionLock = (tenantSessionId: string) => `taska.tenant-session.${tenantSessionId}`;
/**
 * How long a tab waits for its company session's ownership lock before it
 * concludes it is a duplicate. Not `ifAvailable`: a reload's new document can
 * ask before the old one has released it (api-contract-guard §3, inferred).
 */
export const OWNERSHIP_WAIT_MS = 1500;

/** The part of `navigator.locks` this uses; injected so jsdom, which has none, can drive it. */
export interface LockManagerLike {
  request<T>(name: string, options: { signal?: AbortSignal }, callback: () => Promise<T> | T): Promise<T>;
}

/** The blueprint's five session routes, as each implementation sends them. Answers are narrowed here, not there. */
export interface B2bTransport {
  /** `POST /auth/web-sessions` — public. */
  startWebSession(input: LoginInput, idempotencyKey: string): Promise<unknown>;
  /** `POST /auth/web-sessions/refresh` — public; renews both families. */
  refreshWebSession(refreshToken: string, idempotencyKey: string): Promise<unknown>;
  /** `GET /tenants` with WEB_GLOBAL. */
  listTenants(bearer: string, params: ListTenantsParams, signal: AbortSignal): Promise<unknown>;
  /** `POST /auth/tenant-sessions` with WEB_GLOBAL — 201 `AccessSession` with `tenantId`. */
  createTenantSession(bearer: string, tenantId: string, idempotencyKey: string): Promise<unknown>;
  /** `DELETE /auth/tenant-sessions/{sessionId}` with WEB_GLOBAL — 204. */
  revokeTenantSession(bearer: string, tenantSessionId: string, idempotencyKey: string): Promise<void>;
  /** `GET /billing/plans` — public, no credential (TAS-501). */
  listBillingPlans(params: ListBillingPlansParams, signal: AbortSignal): Promise<unknown>;
  /** `POST /tenants` with WEB_GLOBAL and the caller's `Idempotency-Key` — 202 `CreateTenantResponse`. */
  createTenant(bearer: string, input: CreateTenantInput, idempotencyKey: string): Promise<unknown>;
  /** `GET /tenants/{tenantId}` with that company's WEB_TENANT. */
  getTenant(bearer: string | null, tenantId: string, signal: AbortSignal): Promise<unknown>;
  /** `GET /tenants/{tenantId}/operations/{operationId}` with that company's WEB_TENANT. */
  getTenantOperation(bearer: string | null, tenantId: string, operationId: string, signal: AbortSignal): Promise<unknown>;
  /** `POST /tenants/{tenantId}/cancel-creation` with WEB_TENANT, `Idempotency-Key` and `If-Match: "{version}"`. */
  cancelTenantCreation(bearer: string | null, tenantId: string, version: string, idempotencyKey: string): Promise<unknown>;

  /*
   * A company's members, invitations and seats (TAS-502), all with that
   * company's WEB_TENANT. `version` goes as `If-Match: "{version}"`; every
   * write carries the caller's `Idempotency-Key`.
   */

  /** `GET /tenants/{tenantId}/members?cursor&limit` — 200 `MembershipPage`. */
  listTenantMembers(bearer: string | null, tenantId: string, params: ListCompanyPageParams, signal: AbortSignal): Promise<unknown>;
  /** `PATCH /tenants/{tenantId}/members/{userId}/role` `{role}` with the key and `If-Match` — 200 `Membership`. */
  setTenantMemberRole(
    bearer: string | null,
    tenantId: string,
    userId: string,
    role: KnownMembershipRole,
    version: string,
    idempotencyKey: string,
  ): Promise<unknown>;
  /** `PATCH /tenants/{tenantId}/members/{userId}/state` `{state}` with the key and `If-Match` — 200 `Membership`. */
  setTenantMemberState(
    bearer: string | null,
    tenantId: string,
    userId: string,
    state: "ACTIVE" | "SUSPENDED",
    version: string,
    idempotencyKey: string,
  ): Promise<unknown>;
  /** `DELETE /tenants/{tenantId}/members/{userId}`, no body, the key and `If-Match` — 202 `Operation`. */
  removeTenantMember(bearer: string | null, tenantId: string, userId: string, version: string, idempotencyKey: string): Promise<unknown>;
  /** `POST /tenants/{tenantId}/leave` `{confirmed: true}` with the key, **no `If-Match`** (the blueprint's; ask A20) — 202 `Operation`. */
  leaveTenant(bearer: string | null, tenantId: string, idempotencyKey: string): Promise<unknown>;
  /** `GET /tenants/{tenantId}/invitations?cursor&limit` — 200 `InvitationPage`. */
  listTenantInvitations(bearer: string | null, tenantId: string, params: ListCompanyPageParams, signal: AbortSignal): Promise<unknown>;
  /** `POST /tenants/{tenantId}/invitations` `{email, role, projectGrants}` with the key — 201 `Invitation`. */
  createTenantInvitation(bearer: string | null, tenantId: string, input: CreateInvitationInput, idempotencyKey: string): Promise<unknown>;
  /** `POST /tenants/{tenantId}/invitations/{invitationId}/resend`, no body, the key only — 200 `Invitation`. */
  resendTenantInvitation(bearer: string | null, tenantId: string, invitationId: string, idempotencyKey: string): Promise<unknown>;
  /** `DELETE /tenants/{tenantId}/invitations/{invitationId}` with the key and `If-Match` — 204. */
  revokeTenantInvitation(
    bearer: string | null,
    tenantId: string,
    invitationId: string,
    version: string,
    idempotencyKey: string,
  ): Promise<void>;
  /** `GET /tenants/{tenantId}/quotas` — 200 `QuotaSnapshot`. */
  getTenantQuotas(bearer: string | null, tenantId: string, signal: AbortSignal): Promise<unknown>;
}

/** `AccessSession` as this layer reads it: the four strings it needs, `tenantId` only on a company session. */
export interface AccessSession {
  sessionId: string;
  userId: string;
  tenantId: string | null;
  accessToken: string;
  refreshToken: string;
}

const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

/** An `AccessSession`, or `null` for an answer that does not hold one. `tokenType` and `expiresIn` are not needed. */
export function toAccessSession(wire: unknown): AccessSession | null {
  if (typeof wire !== "object" || wire === null) return null;
  const row = wire as Record<string, unknown>;
  const sessionId = text(row.sessionId);
  const userId = text(row.userId);
  const accessToken = text(row.accessToken);
  const refreshToken = text(row.refreshToken);
  if (sessionId === null || userId === null || accessToken === null || refreshToken === null) return null;
  return { sessionId, userId, tenantId: text(row.tenantId), accessToken, refreshToken };
}

/**
 * `LoginResult` is `AccessSession | MfaChallenge` with no discriminator; the
 * challenge is the one with a `challengeId` and no `accessToken`.
 */
export function isMfaChallenge(wire: unknown): boolean {
  if (typeof wire !== "object" || wire === null) return false;
  const row = wire as Record<string, unknown>;
  return text(row.challengeId) !== null && row.accessToken === undefined;
}

interface AccountRecord {
  v: 1;
  userId: string;
  sessionId: string;
  accessToken: string;
  refreshToken: string;
  /** The key of a rotation that was sent and not yet answered: the retry must send it again. */
  pending?: { key: string };
}

interface TabRecord {
  v: 1;
  tabId: string;
  userId: string;
  tenantId: string;
  tenantName: string | null;
  tenantSessionId: string;
  accessToken: string;
  refreshToken: string;
  pending?: { key: string };
}

const pendingOf = (value: unknown): { key: string } | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const key = text((value as Record<string, unknown>).key);
  return key === null ? undefined : { key };
};

function toAccountRecord(value: unknown): AccountRecord | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  const userId = text(row.userId);
  const sessionId = text(row.sessionId);
  const accessToken = text(row.accessToken);
  const refreshToken = text(row.refreshToken);
  if (row.v !== 1 || userId === null || sessionId === null || accessToken === null || refreshToken === null) return null;
  const pending = pendingOf(row.pending);
  return { v: 1, userId, sessionId, accessToken, refreshToken, ...(pending ? { pending } : {}) };
}

function toTabRecord(value: unknown): TabRecord | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  const tabId = text(row.tabId);
  const userId = text(row.userId);
  const tenantId = text(row.tenantId);
  const tenantSessionId = text(row.tenantSessionId);
  const accessToken = text(row.accessToken);
  const refreshToken = text(row.refreshToken);
  if (
    row.v !== 1 ||
    tabId === null ||
    userId === null ||
    tenantId === null ||
    tenantSessionId === null ||
    accessToken === null ||
    refreshToken === null
  ) {
    return null;
  }
  const pending = pendingOf(row.pending);
  return {
    v: 1,
    tabId,
    userId,
    tenantId,
    tenantName: text(row.tenantName),
    tenantSessionId,
    accessToken,
    refreshToken,
    ...(pending ? { pending } : {}),
  };
}

const abortError = () => new DOMException("The lock request was aborted", "AbortError");

/**
 * An in-page lock manager with `navigator.locks`' semantics for what this file
 * uses: exclusive, first come first served, a waiting request abortable by its
 * signal. The fallback where the browser has none (jsdom, older engines) — and
 * there it cannot coordinate tabs, which is the residual risk the guard named;
 * shared between two clients it *is* the browser's manager, which is how the
 * unit tests stand in two tabs.
 */
export function createLocalLockManager(): LockManagerLike {
  const held = new Set<string>();
  const waiting = new Map<string, Array<() => void>>();
  return {
    request<T>(name: string, options: { signal?: AbortSignal }, callback: () => Promise<T> | T): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const grant = () => {
          held.add(name);
          Promise.resolve()
            .then(callback)
            .then(resolve, reject)
            .finally(() => {
              held.delete(name);
              waiting.get(name)?.shift()?.();
            });
        };
        const { signal } = options;
        if (signal?.aborted) {
          reject(abortError());
          return;
        }
        if (!held.has(name)) {
          grant();
          return;
        }
        const queue = waiting.get(name) ?? [];
        waiting.set(name, queue);
        const onAbort = () => {
          const index = queue.indexOf(take);
          if (index >= 0) queue.splice(index, 1);
          reject(abortError());
        };
        const take = () => {
          signal?.removeEventListener("abort", onAbort);
          grant();
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        queue.push(take);
      });
    },
  };
}

/** `navigator.locks` when the browser has it, the in-page manager otherwise. */
export function defaultLockManager(): LockManagerLike {
  const locks = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  if (!locks) return createLocalLockManager();
  return {
    request: <T>(name: string, options: { signal?: AbortSignal }, callback: () => Promise<T> | T) =>
      locks.request(name, options, () => callback()) as Promise<T>,
  };
}

const randomKey = () =>
  globalThis.crypto?.randomUUID?.() ?? `taska-${Date.now()}-${Math.random().toString(16).slice(2)}`;

interface Epoch {
  readonly value: number;
  readonly controller: AbortController;
}

const newEpoch = (value: number): Epoch => ({ value, controller: new AbortController() });

/** A leave whose answer never came (`WebSessionClient.lostLeaves`). */
interface LostLeave {
  tenantId: string;
  /** The company session it was sent with: only that session's refusals can say it was applied. */
  tenantSessionId: string;
  /** The number of the last request sent when it was recorded: a 2xx of a later one proves the session still works. */
  after: number;
}

interface Owned {
  record: TabRecord;
  release: () => void;
}

/** Refusals that close the tab's company wherever they come from (§5). */
const CLOSING_CODES: ReadonlySet<string> = new Set([
  "MEMBERSHIP_INACTIVE",
  "TENANT_NOT_FOUND",
  "TENANT_REQUIRED",
  "TENANT_MISMATCH",
]);

/** Something that never got an answer from a server: no HTTP status (`fetch`'s `TypeError`, an abort). */
const isTransportFailure = (error: unknown) => apiErrorFacts(error).status === null;

/** The account family is gone — refused, or replaced by another account. Internal; callers turn it into closure. */
class AccountGone extends Error {
  constructor(readonly refused: boolean) {
    super(refused ? "The account session could not be renewed" : "The account session was replaced");
    this.name = "AccountGone";
  }
}

type RotateOutcome = "rotated" | "unreachable" | "refused" | "replaced";
type RenewOutcome = "renewed" | "unreachable" | "closed";

export interface WebSessionDeps {
  transport: B2bTransport;
  local: Storage;
  session: Storage;
  locks?: LockManagerLike;
  newKey?: () => string;
  ownershipWaitMs?: number;
  /** Where `storage` events arrive — `window` in a browser; `null` listens to none. */
  events?: Pick<EventTarget, "addEventListener" | "removeEventListener"> | null;
}

/** Which credential a request goes with: none (a public route), or the tab's (WEB_TENANT in a company, else WEB_GLOBAL). */
export type RequestCredential = "none" | "session";

export class WebSessionClient {
  private readonly transport: B2bTransport;
  private readonly local: Storage;
  private readonly session: Storage;
  private readonly locks: LockManagerLike;
  private readonly newKey: () => string;
  private readonly ownershipWaitMs: number;
  /** This document's own id — kept by a reload (the record's), replaced in a duplicate. */
  private readonly documentTabId: string;

  private epoch: Epoch = newEpoch(0);
  /** Moves with the account only (sign-in, sign-out, expiry, another account) — what the company list is guarded by. */
  private accountEpoch: Epoch = newEpoch(0);
  private owned: Owned | null = null;
  private view: Workspace | null = null;
  private accountUserId: string | null;
  private readonly restoring: Promise<void>;
  /** The tab record's company while `restore()` has not finished: the company the tab is already in. */
  private restoringTenantId: string | null = null;
  /** The company a switch has been asked for and not finished — one transition per company at a time. */
  private entering: { tenantId: string; promise: Promise<Workspace> } | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private renewing: Promise<RenewOutcome> | null = null;
  private rotating: Promise<RotateOutcome> | null = null;
  private readonly names = new Map<string, string>();
  /**
   * The company this tab is leaving (TAS-502, api-contract-guard B6), from
   * `leaveTenant`'s send until its company session is released: a closing
   * refusal meanwhile — the server may already have removed the reader —
   * closes nothing and draws no §4.35; it rejects its own request.
   */
  private leaving: string | null = null;
  /**
   * Leaves whose answer never came — no status, 408 or 5xx; never a 429, which
   * says the leave was not taken (api-contract-guard M4) — by key, with the
   * company and **the company session** they were sent with, and the number of
   * the last request sent before the answer was lost. While one is open, a
   * refusal of that same session saying the reader is no longer in the company
   * means the leave was applied: released as left, never closed (B-1).
   *
   * How long one lives (release-reviewer R2-M1): until the leave is answered
   * — 202, or a definite refusal (a 429 keeps it); until any later request of
   * that session is answered 2xx, which proves it still works and so the leave
   * did not apply; and until the account changes. A new session of the
   * company — a switch away and back, a successful re-selection — never
   * matches it.
   */
  private readonly lostLeaves = new Map<string, LostLeave>();
  /** Every request a company session sends is numbered, so a 2xx can tell whether it was sent after a leave was lost. */
  private sent = 0;
  /**
   * Set while a leave is out, when the re-selection behind a refused renewal
   * of its session was itself refused «no longer a member» — the one 401 that
   * counts as «left» on a retry (ruling 2b; not an unreachable refresh, L-a).
   */
  private leaveRefusedBySelection: string | null = null;
  private readonly expired = new SessionExpiredSignal();
  private readonly changeListeners = new Set<() => void>();
  private readonly closed = new WorkspaceClosedSignal<WorkspaceClosedEvent>();
  private readonly pending = new WorkspaceClosedSignal<WorkspacePendingEvent>();
  private readonly left = new WorkspaceClosedSignal<WorkspaceLeftEvent>();

  constructor(deps: WebSessionDeps) {
    this.transport = deps.transport;
    this.local = deps.local;
    this.session = deps.session;
    this.locks = deps.locks ?? defaultLockManager();
    this.newKey = deps.newKey ?? randomKey;
    this.ownershipWaitMs = deps.ownershipWaitMs ?? OWNERSHIP_WAIT_MS;
    this.documentTabId = this.newKey();
    this.accountUserId = this.readAccount()?.userId ?? null;
    deps.events?.addEventListener("storage", this.onStorage);
    const tab = this.readTab();
    this.restoringTenantId = tab !== null && tab.userId === this.accountUserId ? tab.tenantId : null;
    // At once, so the ownership wait starts with the page rather than with the
    // first request; every request and transition waits for it.
    this.restoring = this.restore()
      .catch(() => undefined)
      .finally(() => {
        this.restoringTenantId = null;
      });
  }

  /* ---------------------------------------------------------------- account */

  /** The tab holds an account session — not "the server still accepts it". */
  hasSession(): boolean {
    return this.readAccount() !== null;
  }

  onSessionExpired(listener: () => void): () => void {
    return this.expired.subscribe(listener);
  }

  signIn(input: LoginInput): Promise<SignInResult> {
    return this.serialize(async (): Promise<SignInResult> => {
      await this.restoring;
      let answer: unknown;
      try {
        answer = await this.transport.startWebSession(input, this.newKey());
      } catch (error) {
        // Backend PR #288's answer to a GLOBAL_ADMIN's password; the blueprint's is the challenge below.
        if (refusalCode(error) === "MFA_REQUIRED") {
          return { status: "ADMIN_MFA_REQUIRED", requestId: apiErrorFacts(error).requestId };
        }
        throw error;
      }
      if (isMfaChallenge(answer)) return { status: "ADMIN_MFA_REQUIRED", requestId: null };
      const session = toAccessSession(answer);
      if (session === null || session.tenantId !== null) throw new Error("The sign-in answer held no account session.");

      const previous = this.readAccount();
      const owned = this.owned;
      this.moveAccountEpoch();
      if (owned) {
        this.dropOwned();
        if (previous) void this.revokeQuietly(owned.record.tenantSessionId, previous, false);
      }
      this.removeTab();
      this.removeItem(this.local, LEGACY_ACCESS_TOKEN_KEY);
      this.removeItem(this.local, LEGACY_REFRESH_TOKEN_KEY);
      this.writeAccount({
        v: 1,
        userId: session.userId,
        sessionId: session.sessionId,
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
      });
      this.accountUserId = session.userId;
      this.notifyChange();
      return { status: "SIGNED_IN", userId: session.userId };
    });
  }

  /**
   * Log out: the tab's company session is revoked best-effort with the account
   * credential it was made with, and the account record is dropped locally —
   * the blueprint has no route that ends the account family (N1, ask A4), so it
   * and sibling tabs' company sessions live until they expire. Siblings see the
   * record go (`storage`) and drop their companies too.
   */
  signOut(): Promise<void> {
    return this.serialize(async () => {
      await this.restoring;
      const account = this.readAccount();
      const owned = this.owned;
      this.moveAccountEpoch();
      if (owned) {
        this.dropOwned();
        if (account) void this.revokeQuietly(owned.record.tenantSessionId, account, false);
      }
      this.removeTab();
      this.removeItem(this.session, TENANT_CREATION_KEY);
      this.removeItem(this.local, WEB_SESSION_KEY);
      clearLastCompany(this.local);
      this.accountUserId = null;
      this.notifyChange();
    });
  }

  lastCompanyHint(): string | null {
    const account = this.readAccount();
    return account ? readLastCompany(this.local, account.userId) : null;
  }

  /* -------------------------------------------------------------- companies */

  async listTenants(params: ListTenantsParams = {}): Promise<TenantPage> {
    const epoch = this.accountEpoch;
    let page: TenantPage;
    try {
      page = toTenantPage(
        await this.withAccount((bearer) => this.transport.listTenants(bearer, params, epoch.controller.signal)),
      );
    } catch (error) {
      if (epoch !== this.accountEpoch) throw new WorkspaceClosedError();
      if (error instanceof AccountGone) {
        if (error.refused) this.expireAccount();
        throw new WorkspaceClosedError();
      }
      throw error;
    }
    if (epoch !== this.accountEpoch) throw new WorkspaceClosedError();
    for (const tenant of page.items) if (tenant.name !== null) this.names.set(tenant.id, tenant.name);
    this.renameOwned();
    return page;
  }

  /**
   * The switch **begins when this is called**, not when the queue reaches it:
   * the epoch moves at once (aborting every request of the company being
   * left), and every request asked from then on is asked of `tenantId` — it
   * waits for the session and goes with it. That is what lets the shell
   * render the target company's screens, loading, in the frame of the click
   * (DESIGN.md §4.34), while nothing of the previous company can answer
   * them. A refused entry moves the epoch once more, so what waited is
   * discarded rather than sent with no company. Asked twice for the same
   * company, it is one transition and one answer.
   */
  enterCompany(tenantId: string): Promise<Workspace> {
    if (this.entering?.tenantId === tenantId) return this.entering.promise;
    if (this.companyInView() !== tenantId) this.moveEpoch();
    const started = this.epoch;
    // Only if no later switch has taken the epoch over since.
    const discardWaiting = () => {
      if (this.epoch === started) this.moveEpoch();
    };
    const promise = this.serialize(async (): Promise<Workspace> => {
      await this.restoring;
      const account = this.readAccount();
      if (account === null) {
        discardWaiting();
        throw new Error("There is no account session to enter a company with.");
      }
      const current = this.owned;
      if (current && current.record.tenantId === tenantId && current.record.userId === account.userId && this.view) {
        return this.view;
      }
      if (current) {
        this.dropOwned();
        void this.revokeQuietly(current.record.tenantSessionId);
      }
      this.notifyChange();
      try {
        await this.mint(tenantId, this.names.get(tenantId) ?? null);
      } catch (error) {
        discardWaiting();
        if (error instanceof AccountGone) {
          if (error.refused) this.expireAccount();
          throw new WorkspaceClosedError();
        }
        throw error;
      }
      this.notifyChange();
      if (this.view === null) throw new WorkspaceClosedError();
      return this.view;
    });
    this.entering = { tenantId, promise };
    const done = () => {
      if (this.entering?.promise === promise) this.entering = null;
    };
    promise.then(done, done);
    return promise;
  }

  /** The tab's company as a new request would meet it: the one being entered, the one held, or the one being restored. */
  private companyInView(): string | null {
    return this.entering?.tenantId ?? this.owned?.record.tenantId ?? this.restoringTenantId;
  }

  /**
   * The tab's company once it is known — after a reload's or a duplicate's
   * restoration and any transition already asked for — or `null`.
   */
  async settleWorkspace(): Promise<Workspace | null> {
    await this.settled();
    return this.view;
  }

  leaveCompany(): Promise<void> {
    return this.serialize(async () => {
      await this.restoring;
      const owned = this.owned;
      this.moveEpoch();
      if (owned) {
        this.dropOwned();
        void this.revokeQuietly(owned.record.tenantSessionId);
      }
      this.notifyChange();
    });
  }

  currentWorkspace(): Workspace | null {
    return this.view;
  }

  onWorkspaceChange(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => {
      this.changeListeners.delete(listener);
    };
  }

  onWorkspaceClosed(listener: (event: WorkspaceClosedEvent) => void): () => void {
    return this.closed.subscribe(listener);
  }

  onWorkspacePending(listener: (event: WorkspacePendingEvent) => void): () => void {
    return this.pending.subscribe(listener);
  }

  onWorkspaceLeft(listener: (event: WorkspaceLeftEvent) => void): () => void {
    return this.left.subscribe(listener);
  }

  /* ------------------------------------------------ creating a company (TAS-501) */

  /** `GET /billing/plans`: public metadata, sent with no credential. */
  async listBillingPlans(params: ListBillingPlansParams = {}): Promise<PlanVersionPage> {
    return toPlanVersionPage(await this.call("none", (_bearer, signal) => this.transport.listBillingPlans(params, signal)));
  }

  /**
   * `POST /tenants` — **always the account session** (api-contract-guard B1):
   * from inside a company `call("session")` would send that company's session,
   * which the server refuses. Guarded by the account epoch, as the company list
   * is: a sign-out or another account meanwhile answers `WorkspaceClosedError`.
   * A 401 rotates the account family once and sends again — the same key and
   * the same body, because `send` is the same closure. The new company's name
   * is learnt here, so the tab that enters it next is not «This company».
   */
  async createTenant(input: CreateTenantInput, idempotencyKey: string): Promise<CreateTenantResult> {
    const epoch = this.accountEpoch;
    const body: CreateTenantInput = { name: input.name, planVersionId: input.planVersionId };
    let result: CreateTenantResult | null;
    try {
      result = toCreateTenantResult(
        await this.withAccount((bearer) => this.transport.createTenant(bearer, body, idempotencyKey)),
      );
    } catch (error) {
      if (epoch !== this.accountEpoch) throw new WorkspaceClosedError();
      if (error instanceof AccountGone) {
        if (error.refused) this.expireAccount();
        throw new WorkspaceClosedError();
      }
      throw error;
    }
    if (epoch !== this.accountEpoch) throw new WorkspaceClosedError();
    if (result === null) throw new Error("The creation answer held no company.");
    if (result.tenant.name !== null) this.names.set(result.tenant.id, result.tenant.name);
    return result;
  }

  /** `GET /tenants/{tenantId}` with the tab's company session — the never-opened card's read (DESIGN.md §4.37). */
  async getTenant(tenantId: string): Promise<Tenant> {
    const tenant = toTenant(await this.call("session", (bearer, signal) => this.transport.getTenant(bearer, tenantId, signal)));
    if (tenant === null) throw new Error("The answer held no company.");
    this.learnName(tenant);
    return tenant;
  }

  /** `GET /tenants/{tenantId}/operations/{operationId}` with the tab's company session. */
  async getTenantOperation(tenantId: string, operationId: string): Promise<TenantOperation> {
    const operation = toTenantOperation(
      await this.call("session", (bearer, signal) => this.transport.getTenantOperation(bearer, tenantId, operationId, signal)),
    );
    if (operation === null) throw new Error("The answer held no operation.");
    return operation;
  }

  /** `POST /tenants/{tenantId}/cancel-creation` with the tab's company session, the key and `If-Match`. */
  async cancelTenantCreation(tenantId: string, version: string, idempotencyKey: string): Promise<Tenant> {
    const tenant = toTenant(
      await this.call("session", (bearer) => this.transport.cancelTenantCreation(bearer, tenantId, version, idempotencyKey)),
    );
    if (tenant === null) throw new Error("The answer held no company.");
    this.learnName(tenant);
    return tenant;
  }

  private learnName(tenant: Tenant): void {
    if (tenant.name === null) return;
    this.names.set(tenant.id, tenant.name);
    this.renameOwned();
  }

  /* -------------------------------- members, invitations and seats (TAS-502) */

  /*
   * api-contract-guard's pre-build design §1, §4 and B6, with the
   * orchestrator's rulings: every call goes with the tab's company session
   * (`call("session")`, `{read: true}` on the three reads), and only once the
   * tab holds **that** company — a call for another is refused here without a
   * request (`inCompany`), because sent it would be the server's 403
   * `TENANT_MISMATCH`, which closes the tab's own company. The key and
   * `If-Match` are the caller's: a retry of one intent sends the same ones.
   */

  async listTenantMembers(tenantId: string, params: ListCompanyPageParams = {}): Promise<MembershipPage> {
    return toMembershipPage(
      await this.inCompany(tenantId, (bearer, signal) => this.transport.listTenantMembers(bearer, tenantId, params, signal), {
        read: true,
      }),
    );
  }

  async setTenantMemberRole(
    tenantId: string,
    userId: string,
    role: KnownMembershipRole,
    version: string,
    idempotencyKey: string,
  ): Promise<Membership> {
    return this.membership(
      await this.inCompany(tenantId, (bearer) =>
        this.transport.setTenantMemberRole(bearer, tenantId, userId, role, version, idempotencyKey),
      ),
    );
  }

  async setTenantMemberState(
    tenantId: string,
    userId: string,
    state: "ACTIVE" | "SUSPENDED",
    version: string,
    idempotencyKey: string,
  ): Promise<Membership> {
    return this.membership(
      await this.inCompany(tenantId, (bearer) =>
        this.transport.setTenantMemberState(bearer, tenantId, userId, state, version, idempotencyKey),
      ),
    );
  }

  async removeTenantMember(tenantId: string, userId: string, version: string, idempotencyKey: string): Promise<TenantOperation> {
    return this.operation(
      await this.inCompany(tenantId, (bearer) => this.transport.removeTenantMember(bearer, tenantId, userId, version, idempotencyKey)),
    );
  }

  /**
   * `POST /tenants/{tenantId}/leave` — leaving the company on purpose (B6).
   * While it is out, a refusal that would close the company closes nothing
   * (`leaving`). Answered 202 with an operation that is not `FAILED`, the
   * tab's company session is released (`leaveCompany`) before this answers:
   * nothing of the company can be sent after it. An operation that is
   * `FAILED` is answered as it came, with the session kept.
   *
   * A leave whose answer never came is remembered by its key (`lostLeaves`).
   * Its retry with that key, from the same company session, is the same
   * success, answered `null`, when it is refused in a way that says the reader
   * is no longer a member (ruling 2b, by the code and never the status alone):
   * 403 `MEMBERSHIP_INACTIVE`, 404 `TENANT_NOT_FOUND`, or a 401 whose renewal
   * was refused and whose re-selection was refused «no longer a member» — not
   * a 401 whose refresh got no answer, which leaves the retry as open as it was
   * (L-a). A 429 keeps the record too; any other refusal, of a first leave or
   * of a retry, is that refusal and closes it.
   */
  async leaveTenant(tenantId: string, idempotencyKey: string): Promise<TenantOperation | null> {
    const session = this.owned?.record.tenantId === tenantId ? this.owned.record.tenantSessionId : null;
    const record = this.lostLeaves.get(idempotencyKey);
    const retry = record !== undefined && record.tenantId === tenantId && record.tenantSessionId === session;
    this.leaving = tenantId;
    this.leaveRefusedBySelection = null;
    let answer: unknown;
    try {
      answer = await this.inCompany(tenantId, (bearer) => this.transport.leaveTenant(bearer, tenantId, idempotencyKey));
    } catch (error) {
      if (!isWorkspaceClosed(error)) {
        const { status } = apiErrorFacts(error);
        const code = refusalCode(error);
        const refusedBySelection = status === 401 && session !== null && this.leaveRefusedBySelection === session;
        const gone = code === "MEMBERSHIP_INACTIVE" || code === "TENANT_NOT_FOUND" || refusedBySelection;
        if (retry && gone) {
          this.forgetLostLeaves(tenantId);
          await this.releaseLeft(tenantId);
          return null;
        }
        const unanswered = status === null || status === 408 || (status !== null && status >= 500);
        // A 401 whose refresh got no answer says nothing either (L-a): the leave stays as open as it was.
        const unrenewed = status === 401 && retry && !refusedBySelection;
        if (session !== null && (unanswered || unrenewed)) {
          this.lostLeaves.set(idempotencyKey, record ?? { tenantId, tenantSessionId: session, after: this.sent });
        } else if (status !== 429) {
          this.lostLeaves.delete(idempotencyKey);
        }
      }
      if (this.leaving === tenantId) this.leaving = null;
      throw error;
    }
    this.forgetLostLeaves(tenantId);
    let operation: TenantOperation;
    try {
      operation = this.operation(answer);
    } catch (error) {
      if (this.leaving === tenantId) this.leaving = null;
      throw error;
    }
    if (operation.state === "FAILED") {
      if (this.leaving === tenantId) this.leaving = null;
      return operation;
    }
    await this.releaseLeft(tenantId);
    return operation;
  }

  private forgetLostLeaves(tenantId: string): void {
    for (const [key, record] of this.lostLeaves) if (record.tenantId === tenantId) this.lostLeaves.delete(key);
  }

  /** The record of a lost leave sent with this session of this company, if one is open. */
  private lostLeaveOf(owned: Owned): LostLeave | null {
    for (const record of this.lostLeaves.values()) {
      if (record.tenantId === owned.record.tenantId && record.tenantSessionId === owned.record.tenantSessionId) return record;
    }
    return null;
  }

  /** A 2xx of a request this session sent after a leave was lost: the session works, so that leave did not apply. */
  private answeredAfterLostLeave(owned: Owned, number: number): void {
    for (const [key, record] of this.lostLeaves) {
      if (record.tenantId === owned.record.tenantId && record.tenantSessionId === owned.record.tenantSessionId && number > record.after) {
        this.lostLeaves.delete(key);
      }
    }
  }

  /** The company left: its session released, and only then the closing rule back on. */
  private async releaseLeft(tenantId: string): Promise<void> {
    try {
      if (this.owned?.record.tenantId === tenantId) await this.leaveCompany();
    } finally {
      if (this.leaving === tenantId) this.leaving = null;
    }
  }

  async listTenantInvitations(tenantId: string, params: ListCompanyPageParams = {}): Promise<InvitationPage> {
    return toInvitationPage(
      await this.inCompany(tenantId, (bearer, signal) => this.transport.listTenantInvitations(bearer, tenantId, params, signal), {
        read: true,
      }),
    );
  }

  /** The body is the three fields exactly, in one order, so a retry with the same key sends the same bytes. */
  async createTenantInvitation(tenantId: string, input: CreateInvitationInput, idempotencyKey: string): Promise<Invitation> {
    const body: CreateInvitationInput = {
      email: input.email,
      role: input.role,
      projectGrants: input.projectGrants.map((grant) => ({ projectId: grant.projectId, role: grant.role })),
    };
    return this.invitation(
      await this.inCompany(tenantId, (bearer) => this.transport.createTenantInvitation(bearer, tenantId, body, idempotencyKey)),
    );
  }

  async resendTenantInvitation(tenantId: string, invitationId: string, idempotencyKey: string): Promise<Invitation> {
    return this.invitation(
      await this.inCompany(tenantId, (bearer) => this.transport.resendTenantInvitation(bearer, tenantId, invitationId, idempotencyKey)),
    );
  }

  async revokeTenantInvitation(tenantId: string, invitationId: string, version: string, idempotencyKey: string): Promise<void> {
    await this.inCompany(tenantId, (bearer) =>
      this.transport.revokeTenantInvitation(bearer, tenantId, invitationId, version, idempotencyKey),
    );
  }

  async getTenantQuotas(tenantId: string): Promise<QuotaSnapshot> {
    return toQuotaSnapshot(
      await this.inCompany(tenantId, (bearer, signal) => this.transport.getTenantQuotas(bearer, tenantId, signal), { read: true }),
    );
  }

  /**
   * A new company session for the tab's company (TAS-502, the orchestrator's
   * ruling 3): after a change to the reader's own membership, so that nothing
   * cached under the old role survives — a new session is a new context, and
   * the shell remounts on the route it was on, without a notice. The new
   * session is made first and the old one revoked best-effort after it; a
   * refusal that closes the company closes it (§4.35); no answer, or any other
   * refusal, keeps the session the tab has — the server checks the role on
   * every request either way (contracts §2).
   */
  reenterCompany(tenantId: string): Promise<void> {
    return this.serialize(async () => {
      await this.restoring;
      const owned = this.owned;
      if (owned === null || owned.record.tenantId !== tenantId) return;
      let session: AccessSession;
      try {
        session = await this.createSession(tenantId);
      } catch (error) {
        if (owned !== this.owned) return;
        if (error instanceof AccountGone) {
          if (error.refused) this.expireAccount();
          return;
        }
        const code = refusalCode(error);
        if (code !== null && CLOSING_CODES.has(code)) {
          const { requestId, message } = apiErrorFacts(error);
          this.closeWorkspace(owned, code, requestId, refusalReasons(error), message);
        }
        return;
      }
      if (owned !== this.owned) {
        void this.revokeQuietly(session.sessionId);
        return;
      }
      this.moveEpoch();
      const { tenantSessionId, tenantName } = owned.record;
      this.dropOwned();
      void this.revokeQuietly(tenantSessionId);
      await this.install(session, tenantName);
      this.notifyChange();
    });
  }

  /** `call("session")` for `tenantId` only: refused without a request (`WorkspaceClosedError`) unless the tab holds it. */
  private inCompany<T>(
    tenantId: string,
    send: (bearer: string | null, signal: AbortSignal) => Promise<T>,
    options: { read?: boolean } = {},
  ): Promise<T> {
    return this.call(
      "session",
      (bearer, signal) => {
        const owned = this.owned;
        if (owned === null || owned.record.tenantId !== tenantId || bearer !== owned.record.accessToken) {
          return Promise.reject(new WorkspaceClosedError());
        }
        return send(bearer, signal);
      },
      options,
    );
  }

  private membership(answer: unknown): Membership {
    const membership = toMembership(answer);
    if (membership === null) throw new Error("The answer held no membership.");
    return membership;
  }

  private invitation(answer: unknown): Invitation {
    const invitation = toInvitation(answer);
    if (invitation === null) throw new Error("The answer held no invitation.");
    return invitation;
  }

  private operation(answer: unknown): TenantOperation {
    const operation = toTenantOperation(answer);
    if (operation === null) throw new Error("The answer held no operation.");
    return operation;
  }

  /* --------------------------------------------------------------- requests */

  /**
   * Sends one request through the tab's context. `send` is handed the bearer —
   * `null` for a public route, the tab's WEB_TENANT in a company, WEB_GLOBAL
   * otherwise — and the epoch's abort signal; whatever it answers or throws is
   * what the caller gets, unless the epoch moved meanwhile.
   *
   * A 401 on WEB_TENANT renews the company family (this tab owns it) and
   * retries once; a refused renewal re-selects the same company once, which is
   * a new context. A 401 on WEB_GLOBAL rotates the account family under its
   * lock and retries once; a refused rotation signs every tab out.
   * `MEMBERSHIP_INACTIVE`, `TENANT_NOT_FOUND`, `TENANT_REQUIRED` and
   * `TENANT_MISMATCH` close the company. So does a **read** refused
   * `CAPABILITY_DISABLED` with `reasons` — a paused or blocked company whose
   * content cannot be read is an answer about the company, not a missing page
   * (DESIGN.md §4.35, api-contract-guard N2, ask A2c) — **except** one whose
   * `reasons` carry `PENDING_FIRST_PAYMENT`, or code `PAYMENT_PENDING`: that
   * company has never opened, and the read only tells `onWorkspacePending`
   * (TAS-501, B4). `READ_ONLY`, and `CAPABILITY_DISABLED` on a write, do not
   * close: they reject that one request with their `reasons`.
   */
  async call<T>(
    credential: RequestCredential,
    send: (bearer: string | null, signal: AbortSignal) => Promise<T>,
    options: { read?: boolean } = {},
  ): Promise<T> {
    const epoch = this.epoch;
    await this.settled();
    if (epoch !== this.epoch) throw new WorkspaceClosedError();
    if (credential === "none") return this.answerFor(epoch, () => send(null, epoch.controller.signal));
    return this.withCredential(epoch, send, false, options.read === true);
  }

  private async withCredential<T>(
    epoch: Epoch,
    send: (bearer: string | null, signal: AbortSignal) => Promise<T>,
    isRetry: boolean,
    read: boolean,
  ): Promise<T> {
    const owned = this.owned;
    if (owned) {
      const sent = owned.record.accessToken;
      const number = ++this.sent;
      try {
        const answer = await this.answerFor(epoch, () => send(sent, epoch.controller.signal));
        if (this.lostLeaves.size > 0) this.answeredAfterLostLeave(owned, number);
        return answer;
      } catch (error) {
        if (isWorkspaceClosed(error)) throw error;
        const { status, requestId, message } = apiErrorFacts(error);
        if (status === 401 && !isRetry) {
          const outcome = await this.renewCompany(owned, sent);
          if (epoch !== this.epoch) throw new WorkspaceClosedError();
          if (outcome === "renewed") return this.withCredential(epoch, send, true, read);
          throw error;
        }
        const code = refusalCode(error);
        const reasons = refusalReasons(error);
        if (code !== null && CLOSING_CODES.has(code)) {
          if (this.closeWorkspace(owned, code, requestId, reasons, message)) throw new WorkspaceClosedError();
          throw error;
        }
        // A company that has never opened (TAS-501, B4): its content is
        // refused until the first payment, and that is no closure — the
        // session stays, because paying, reading the company and cancelling
        // go with it. The shell is told; the read rejects as it was refused.
        if (read && (code === "PAYMENT_PENDING" || reasons.includes("PENDING_FIRST_PAYMENT"))) {
          if (owned === this.owned) {
            this.pending.emit({ tenantId: owned.record.tenantId, code, reasons: [...reasons], requestId });
          }
          throw error;
        }
        if (read && code === "CAPABILITY_DISABLED" && reasons.length > 0) {
          if (this.closeWorkspace(owned, code, requestId, reasons, message)) throw new WorkspaceClosedError();
          throw error;
        }
        throw error;
      }
    }

    const account = this.readAccount();
    try {
      return await this.answerFor(epoch, () => send(account?.accessToken ?? null, epoch.controller.signal));
    } catch (error) {
      if (isWorkspaceClosed(error) || account === null || apiErrorFacts(error).status !== 401) throw error;
      const outcome: RotateOutcome = isRetry ? "refused" : await this.rotateAccount(account);
      if (epoch !== this.epoch) throw new WorkspaceClosedError();
      if (outcome === "rotated") return this.withCredential(epoch, send, true, read);
      if (outcome === "unreachable") throw error;
      if (outcome === "refused") this.expireAccount();
      throw new WorkspaceClosedError();
    }
  }

  /** `run`'s answer, or `WorkspaceClosedError` when the epoch moved before it arrived — success or failure alike. */
  private async answerFor<T>(epoch: Epoch, run: () => Promise<T>): Promise<T> {
    let value: T;
    try {
      value = await run();
    } catch (error) {
      if (epoch !== this.epoch) throw new WorkspaceClosedError();
      throw error;
    }
    if (epoch !== this.epoch) throw new WorkspaceClosedError();
    return value;
  }

  /** Restoration and any transition already queued — a request waits for both before it picks a credential. */
  private async settled(): Promise<void> {
    await this.restoring;
    await this.queue;
  }

  private serialize<T>(run: () => Promise<T>): Promise<T> {
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /* ------------------------------------------------------- the company family */

  /** Renews the tab's company family once per stale token; re-selects the company when the renewal is refused. */
  private renewCompany(owned: Owned, staleAccessToken: string): Promise<RenewOutcome> {
    if (this.renewing) return this.renewing;
    const run = (async (): Promise<RenewOutcome> => {
      if (owned !== this.owned) return "closed";
      if (owned.record.accessToken !== staleAccessToken) return "renewed";
      const refreshed = await this.refreshCompany(owned);
      if (refreshed !== "refused") return refreshed;
      return this.reselect(owned);
    })();
    this.renewing = run;
    void run.finally(() => {
      if (this.renewing === run) this.renewing = null;
    });
    return run;
  }

  private async refreshCompany(owned: Owned): Promise<"renewed" | "unreachable" | "refused" | "closed"> {
    let record = owned.record;
    const key = record.pending?.key ?? this.newKey();
    if (record.pending === undefined) {
      record = { ...record, pending: { key } };
      this.keepTab(owned, record);
    }
    try {
      const session = toAccessSession(await this.transport.refreshWebSession(record.refreshToken, key));
      if (owned !== this.owned) return "closed";
      if (session === null || session.tenantId !== record.tenantId || session.sessionId !== record.tenantSessionId) {
        return "refused";
      }
      const { pending: _spent, ...rest } = record;
      this.keepTab(owned, { ...rest, accessToken: session.accessToken, refreshToken: session.refreshToken });
      return "renewed";
    } catch (error) {
      if (owned !== this.owned) return "closed";
      return isTransportFailure(error) ? "unreachable" : "refused";
    }
  }

  /**
   * The company family could not be renewed and the account may still be
   * alive: ask for the same company once more (§5). A new session is a new
   * context — the epoch moves and the shell remounts on the route it was on;
   * a refusal closes the company with its code; no answer closes it with
   * `TRANSPORT_FAILURE`; a dead account signs every tab out. Either way the
   * request that asked is answered `WorkspaceClosedError`.
   */
  private async reselect(owned: Owned): Promise<RenewOutcome> {
    const { tenantId, tenantName } = owned.record;
    try {
      const session = await this.createSession(tenantId);
      if (owned !== this.owned) {
        void this.revokeQuietly(session.sessionId);
        return "closed";
      }
      this.moveEpoch();
      this.dropOwned();
      await this.install(session, tenantName);
      this.notifyChange();
      return "closed";
    } catch (error) {
      if (owned !== this.owned) return "closed";
      if (error instanceof AccountGone) {
        if (error.refused) this.expireAccount();
        else {
          this.moveEpoch();
          this.dropOwned();
          this.notifyChange();
        }
        return "closed";
      }
      const { code, requestId, message } = apiErrorFacts(error);
      const transport = isTransportFailure(error);
      const reason = transport ? TRANSPORT_FAILURE_REASON : (refusalCode(error) ?? code ?? "UNKNOWN");
      // While a leave of this company is out, the re-selection's «no longer a
      // member» is what lets its 401 read as «left» (ruling 2b).
      if (this.leaving === tenantId && (reason === "MEMBERSHIP_INACTIVE" || reason === "TENANT_NOT_FOUND")) {
        this.leaveRefusedBySelection = owned.record.tenantSessionId;
      }
      this.closeWorkspace(owned, reason, requestId, refusalReasons(error), transport ? null : message);
      return "closed";
    }
  }

  /** `POST /auth/tenant-sessions`, checked: a session for exactly this company and this account. */
  private async createSession(tenantId: string): Promise<AccessSession> {
    const key = this.newKey();
    const answer = await this.withAccount((bearer) => this.transport.createTenantSession(bearer, tenantId, key));
    const session = toAccessSession(answer);
    const account = this.readAccount();
    if (account === null) throw new AccountGone(false);
    if (session === null || session.tenantId !== tenantId || session.userId !== account.userId) {
      throw new Error("The company session answer held no session for that company.");
    }
    return session;
  }

  /** Makes `tenantId` this tab's company: a new session, owned by this document. */
  private async mint(tenantId: string, tenantName: string | null): Promise<void> {
    await this.install(await this.createSession(tenantId), tenantName);
  }

  private async install(session: AccessSession, tenantName: string | null): Promise<void> {
    const tenantId = session.tenantId as string;
    // A brand-new id: nobody else can hold its lock, so this does not wait.
    const release = await this.acquire(session.sessionId);
    const record: TabRecord = {
      v: 1,
      tabId: this.documentTabId,
      userId: session.userId,
      tenantId,
      tenantName: this.names.get(tenantId) ?? tenantName,
      tenantSessionId: session.sessionId,
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
    };
    this.writeTab(record);
    this.owned = { record, release: release ?? (() => undefined) };
    this.accountUserId = session.userId;
    this.refreshView();
    writeLastCompany(this.local, session.userId, tenantId);
  }

  /**
   * The tab's record from before this document — a reload, or a duplicate's
   * copy. Owned if its lock can be had within `ownershipWaitMs`; otherwise the
   * copy is dropped unread and a session of this tab's own is made (B2).
   */
  private async restore(): Promise<void> {
    const tab = this.readTab();
    if (tab === null) return;
    const account = this.readAccount();
    if (account === null || account.userId !== tab.userId) {
      this.removeTab();
      return;
    }
    const release = await this.acquire(tab.tenantSessionId, this.ownershipWaitMs);
    if (release !== null) {
      this.owned = { record: tab, release };
      this.accountUserId = tab.userId;
      this.refreshView();
      this.notifyChange();
      return;
    }
    // A duplicate: another document owns that session. Never use, renew or
    // revoke the copied credentials — forget them and make this tab's own.
    this.removeTab();
    try {
      await this.mint(tab.tenantId, tab.tenantName);
      this.notifyChange();
    } catch (error) {
      if (error instanceof AccountGone && error.refused) this.expireAccount();
    }
  }

  /** The ownership lock, held until `release` — or `null` if it was not granted within `waitMs`. */
  private acquire(tenantSessionId: string, waitMs = 0): Promise<(() => void) | null> {
    return new Promise((resolve) => {
      const controller = new AbortController();
      const timer = waitMs > 0 ? setTimeout(() => controller.abort(), waitMs) : undefined;
      let release: () => void = () => undefined;
      const held = new Promise<void>((done) => {
        release = done;
      });
      this.locks
        .request(companySessionLock(tenantSessionId), waitMs > 0 ? { signal: controller.signal } : {}, () => {
          clearTimeout(timer);
          resolve(release);
          return held;
        })
        .catch(() => {
          clearTimeout(timer);
          resolve(null);
        });
    });
  }

  /**
   * Closes the tab's company with a reason the shell can word (DESIGN.md
   * §4.35). Answers whether the request that asked is to be answered
   * `WorkspaceClosedError` — `false` only while the tab is leaving this
   * company (TAS-502, B6): then nothing is closed, no §4.35 is drawn, and the
   * refusal stands as that request's answer.
   *
   * While a leave of this company whose answer never came is open, a refusal
   * that says the reader is no longer in it (`MEMBERSHIP_INACTIVE`,
   * `TENANT_NOT_FOUND`) is that leave applied (api-contract-guard B-1): the
   * company is released all the same, with no `closed` event: `left` says it,
   * and the shell goes to the picker, never to §4.35.
   */
  private closeWorkspace(
    owned: Owned,
    reason: string,
    requestId: string | null,
    reasons: readonly string[],
    message: string | null,
  ): boolean {
    if (owned !== this.owned) return true;
    if (this.leaving !== null && this.leaving === owned.record.tenantId) return false;
    const { tenantId, tenantName, tenantSessionId } = owned.record;
    const left = (reason === "MEMBERSHIP_INACTIVE" || reason === "TENANT_NOT_FOUND") && this.lostLeaveOf(owned) !== null;
    if (left) this.forgetLostLeaves(tenantId);
    this.moveEpoch();
    this.dropOwned();
    void this.revokeQuietly(tenantSessionId);
    this.notifyChange();
    if (left) this.left.emit({ tenantId, tenantName });
    else this.closed.emit({ reason, tenantId, tenantName, requestId, reasons: [...reasons], message });
    return true;
  }

  /* ------------------------------------------------------- the account family */

  /** `send` with WEB_GLOBAL, rotating the account family once on a 401. */
  private async withAccount<T>(send: (bearer: string) => Promise<T>): Promise<T> {
    const account = this.readAccount();
    if (account === null) throw new AccountGone(false);
    try {
      return await send(account.accessToken);
    } catch (error) {
      if (apiErrorFacts(error).status !== 401) throw error;
      const outcome = await this.rotateAccount(account);
      if (outcome === "unreachable") throw error;
      if (outcome !== "rotated") throw new AccountGone(outcome === "refused");
      const renewed = this.readAccount();
      if (renewed === null || renewed.userId !== account.userId) throw new AccountGone(false);
      try {
        return await send(renewed.accessToken);
      } catch (retryError) {
        if (apiErrorFacts(retryError).status === 401) throw new AccountGone(true);
        throw retryError;
      }
    }
  }

  /**
   * Rotates the shared account family — once across every tab (B1). Under the
   * lock the record is read again: another tab may have rotated it already
   * (its access token is no longer the one that was refused), or left a
   * rotation half-done (`pending`), which is then finished with the same key.
   */
  private rotateAccount(stale: AccountRecord): Promise<RotateOutcome> {
    if (this.rotating) return this.rotating;
    const run = this.locks
      .request(ACCOUNT_REFRESH_LOCK, {}, async (): Promise<RotateOutcome> => {
        let record = this.readAccount();
        if (record === null || record.userId !== stale.userId) return "replaced";
        if (record.accessToken !== stale.accessToken && record.pending === undefined) return "rotated";
        const key = record.pending?.key ?? this.newKey();
        if (record.pending === undefined) {
          record = { ...record, pending: { key } };
          this.writeAccount(record);
        }
        try {
          const session = toAccessSession(await this.transport.refreshWebSession(record.refreshToken, key));
          if (session === null || session.tenantId !== null || session.userId !== record.userId) return "refused";
          this.writeAccount({
            v: 1,
            userId: record.userId,
            sessionId: record.sessionId,
            accessToken: session.accessToken,
            refreshToken: session.refreshToken,
          });
          return "rotated";
        } catch (error) {
          return isTransportFailure(error) ? "unreachable" : "refused";
        }
      })
      .catch((): RotateOutcome => "unreachable");
    this.rotating = run;
    void run.finally(() => {
      if (this.rotating === run) this.rotating = null;
    });
    return run;
  }

  /**
   * `DELETE /auth/tenant-sessions/{id}`, best effort and never thrown: a
   * session that is not revoked dies with its parent anyway. One account
   * rotation on a 401, never a sign-out on the revoke's own refusal — backend
   * PR #288 answers an unknown id 401, which must not read as the account
   * dying (§8.4). `mayRenew` is off when the account is being dropped.
   */
  private async revokeQuietly(tenantSessionId: string, account = this.readAccount(), mayRenew = true): Promise<void> {
    if (account === null) return;
    const key = this.newKey();
    try {
      await this.transport.revokeTenantSession(account.accessToken, tenantSessionId, key);
    } catch (error) {
      if (!mayRenew || apiErrorFacts(error).status !== 401) return;
      const outcome = await this.rotateAccount(account);
      if (outcome === "refused") {
        this.expireAccount();
        return;
      }
      const renewed = this.readAccount();
      if (outcome !== "rotated" || renewed === null || renewed.userId !== account.userId) return;
      await this.transport.revokeTenantSession(renewed.accessToken, tenantSessionId, key).catch(() => undefined);
    }
  }

  /** The account family is lost: every tab signs out (`onSessionExpired`, and `storage` for the others). */
  private expireAccount(): void {
    const had = this.readAccount() !== null || this.owned !== null || this.accountUserId !== null;
    this.moveAccountEpoch();
    if (this.owned) this.dropOwned();
    this.removeTab();
    this.removeItem(this.session, TENANT_CREATION_KEY);
    this.removeItem(this.local, WEB_SESSION_KEY);
    this.accountUserId = null;
    this.notifyChange();
    if (had) this.expired.emit();
  }

  /**
   * Another tab changed the account record. Its own rotation (same account) is
   * nothing to this tab. The record gone means that tab signed out or found
   * the family dead — this one drops its company and signs out too, without a
   * revoke, having no credential left to send one with. Another account means
   * this tab's company is that account's no longer.
   */
  private readonly onStorage = (event: Event) => {
    const { key } = event as StorageEvent;
    if (key !== null && key !== WEB_SESSION_KEY) return;
    const account = this.readAccount();
    if (account !== null && account.userId === this.accountUserId) return;
    if (account === null && this.accountUserId === null && this.owned === null) return;
    const hadAccount = this.accountUserId !== null;
    this.moveAccountEpoch();
    if (this.owned) this.dropOwned();
    this.removeTab();
    this.removeItem(this.session, TENANT_CREATION_KEY);
    this.accountUserId = account?.userId ?? null;
    this.notifyChange();
    if (account === null && hadAccount) this.expired.emit();
  };

  /* ---------------------------------------------------------------- plumbing */

  private moveEpoch(): void {
    this.epoch.controller.abort();
    this.epoch = newEpoch(this.epoch.value + 1);
  }

  private moveAccountEpoch(): void {
    this.accountEpoch.controller.abort();
    this.accountEpoch = newEpoch(this.accountEpoch.value + 1);
    // Sign-out, sign-in, expiry, another account: no leave of the account
    // before it says anything about the next one (release-reviewer R2-M1).
    this.lostLeaves.clear();
    this.leaveRefusedBySelection = null;
    this.moveEpoch();
  }

  private dropOwned(): void {
    const owned = this.owned;
    if (owned === null) return;
    this.owned = null;
    owned.release();
    this.removeTab();
    this.refreshView();
  }

  private keepTab(owned: Owned, record: TabRecord): void {
    owned.record = record;
    this.writeTab(record);
  }

  /** The list taught the tab its company's name, or a new one. */
  private renameOwned(): void {
    const owned = this.owned;
    if (owned === null) return;
    const name = this.names.get(owned.record.tenantId) ?? null;
    if (name === null || name === owned.record.tenantName) return;
    this.keepTab(owned, { ...owned.record, tenantName: name });
    this.refreshView();
    this.notifyChange();
  }

  private refreshView(): void {
    const owned = this.owned;
    if (owned === null) {
      this.view = null;
      return;
    }
    const { tenantId, tenantName, tenantSessionId } = owned.record;
    const view = this.view;
    if (view && view.tenantId === tenantId && view.tenantName === tenantName && view.tenantSessionId === tenantSessionId) {
      return;
    }
    this.view = Object.freeze({ tenantId, tenantName, tenantSessionId });
  }

  private notifyChange(): void {
    for (const listener of [...this.changeListeners]) listener();
  }

  private readAccount(): AccountRecord | null {
    return toAccountRecord(this.readJson(this.local, WEB_SESSION_KEY));
  }

  /** One record, one `setItem`: the pair and its pending key never land apart. */
  private writeAccount(record: AccountRecord): void {
    this.writeJson(this.local, WEB_SESSION_KEY, record);
  }

  private readTab(): TabRecord | null {
    return toTabRecord(this.readJson(this.session, TAB_KEY));
  }

  private writeTab(record: TabRecord): void {
    this.writeJson(this.session, TAB_KEY, record);
  }

  private removeTab(): void {
    this.removeItem(this.session, TAB_KEY);
  }

  private readJson(storage: Storage, key: string): unknown {
    try {
      const raw = storage.getItem(key);
      return raw === null ? null : (JSON.parse(raw) as unknown);
    } catch {
      return null;
    }
  }

  private writeJson(storage: Storage, key: string, value: unknown): void {
    try {
      storage.setItem(key, JSON.stringify(value));
    } catch {
      // A storage that refuses: the session lives as long as this page does.
    }
  }

  private removeItem(storage: Storage, key: string): void {
    try {
      storage.removeItem(key);
    } catch {
      // Nothing was kept.
    }
  }
}
