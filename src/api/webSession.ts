import { clearLastCompany, readLastCompany, writeLastCompany } from "../lib/lastCompany";
import { WorkspaceClosedError, apiErrorFacts, isWorkspaceClosed, refusalCode, refusalReasons } from "./errors";
import { SessionExpiredSignal, WorkspaceClosedSignal } from "./session";
import type { LoginInput, SignInResult, Workspace, WorkspaceClosedEvent } from "./TaskaApi";
import { TRANSPORT_FAILURE_REASON } from "./TaskaApi";
import { toTenantPage, type ListTenantsParams, type TenantPage } from "./tenants";

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
  private readonly expired = new SessionExpiredSignal();
  private readonly changeListeners = new Set<() => void>();
  private readonly closed = new WorkspaceClosedSignal<WorkspaceClosedEvent>();

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
   * `TENANT_MISMATCH` close the company. `READ_ONLY` and `CAPABILITY_DISABLED`
   * do not: they reject this one request with their `reasons`.
   */
  async call<T>(credential: RequestCredential, send: (bearer: string | null, signal: AbortSignal) => Promise<T>): Promise<T> {
    const epoch = this.epoch;
    await this.settled();
    if (epoch !== this.epoch) throw new WorkspaceClosedError();
    if (credential === "none") return this.answerFor(epoch, () => send(null, epoch.controller.signal));
    return this.withCredential(epoch, send, false);
  }

  private async withCredential<T>(
    epoch: Epoch,
    send: (bearer: string | null, signal: AbortSignal) => Promise<T>,
    isRetry: boolean,
  ): Promise<T> {
    const owned = this.owned;
    if (owned) {
      const sent = owned.record.accessToken;
      try {
        return await this.answerFor(epoch, () => send(sent, epoch.controller.signal));
      } catch (error) {
        if (isWorkspaceClosed(error)) throw error;
        const { status, requestId } = apiErrorFacts(error);
        if (status === 401 && !isRetry) {
          const outcome = await this.renewCompany(owned, sent);
          if (epoch !== this.epoch) throw new WorkspaceClosedError();
          if (outcome === "renewed") return this.withCredential(epoch, send, true);
          throw error;
        }
        const code = refusalCode(error);
        if (code !== null && CLOSING_CODES.has(code)) {
          this.closeWorkspace(owned, code, requestId, refusalReasons(error));
          throw new WorkspaceClosedError();
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
      if (outcome === "rotated") return this.withCredential(epoch, send, true);
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
      const { code, requestId } = apiErrorFacts(error);
      const reason = isTransportFailure(error) ? TRANSPORT_FAILURE_REASON : (refusalCode(error) ?? code ?? "UNKNOWN");
      this.closeWorkspace(owned, reason, requestId, refusalReasons(error));
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

  /** Closes the tab's company with a reason the shell can word (DESIGN.md §4.35). */
  private closeWorkspace(owned: Owned, reason: string, requestId: string | null, reasons: readonly string[]): void {
    if (owned !== this.owned) return;
    this.moveEpoch();
    const { tenantId, tenantName, tenantSessionId } = owned.record;
    this.dropOwned();
    void this.revokeQuietly(tenantSessionId);
    this.notifyChange();
    this.closed.emit({ reason, tenantId, tenantName, requestId, reasons: [...reasons] });
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
