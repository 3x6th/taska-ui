import { describe, expect, it, vi } from "vitest";
import { MemoryStorage } from "../test/memoryStorage";
import { WorkspaceClosedError, refusalReasons } from "./errors";
import { LAST_COMPANY_KEY } from "../lib/lastCompany";
import {
  LEGACY_ACCESS_TOKEN_KEY,
  LEGACY_REFRESH_TOKEN_KEY,
  TAB_KEY,
  WEB_SESSION_KEY,
  WebSessionClient,
  createLocalLockManager,
  defaultLockManager,
  type B2bTransport,
  type LockManagerLike,
} from "./webSession";
import type { WorkspaceClosedEvent, WorkspaceLeftEvent, WorkspacePendingEvent, WorkspaceRestrictedEvent } from "./TaskaApi";
import { TENANT_CREATION_KEY } from "./tenantCreation";

/*
 * The companies build's session layer (TAS-500) against a scripted transport.
 * Two clients over one `localStorage` and one lock manager are two tabs of one
 * browser; a copied `sessionStorage` is a duplicated tab.
 */

const USER = "user-a";
const NORTHWIND = "tenant-northwind";
const GLOBEX = "tenant-globex";

/** A refusal shaped as both implementations throw one: an HTTP status and the Problem's fields. */
const refusal = (status: number, code: string, reasons: string[] = []) =>
  Object.assign(new Error(code), { status, code, requestId: `rid-${code}`, details: null, reasons });

const accessSession = (sessionId: string, tag: string, tenantId?: string) => ({
  sessionId,
  userId: USER,
  ...(tenantId ? { tenantId } : {}),
  accessToken: `${tag}-access`,
  refreshToken: `${tag}-refresh-0123456789abcdef0123456789`,
  tokenType: "Bearer",
  expiresIn: 900,
  mfaVerified: false,
});

const accountRecord = (tag = "g0") => ({
  v: 1,
  userId: USER,
  sessionId: "account-session",
  accessToken: `${tag}-access`,
  refreshToken: `${tag}-refresh-0123456789abcdef0123456789`,
});

function signedIn(local: MemoryStorage, tag = "g0") {
  local.setItem(WEB_SESSION_KEY, JSON.stringify(accountRecord(tag)));
}

/** A transport that mints a new company session per create, `ts-1`, `ts-2`… with tokens `t1-access`, `t2-access`… */
function fakeTransport() {
  let minted = 0;
  return {
    startWebSession: vi.fn<B2bTransport["startWebSession"]>(async () => accessSession("account-session", "g0")),
    refreshWebSession: vi.fn<B2bTransport["refreshWebSession"]>(async (refreshToken) => {
      if (refreshToken.startsWith("g")) return accessSession("account-session", "g1");
      const sessionId = `ts-${refreshToken.slice(1, refreshToken.indexOf("-"))}`;
      return accessSession(sessionId, `r${sessionId}`, NORTHWIND);
    }),
    listTenants: vi.fn<B2bTransport["listTenants"]>(async () => ({
      items: [
        { id: NORTHWIND, name: "Northwind", ownerId: USER, lifecycle: "ACTIVE", restrictions: [], createdAt: "2026-05-01T09:00:00Z", version: "3" },
        { id: GLOBEX, name: "Globex", ownerId: "someone", lifecycle: "ACTIVE", restrictions: [], createdAt: "2026-05-02T09:00:00Z", version: "3" },
      ],
    })),
    createTenantSession: vi.fn<B2bTransport["createTenantSession"]>(async (_bearer, tenantId) => {
      minted += 1;
      return accessSession(`ts-${minted}`, `t${minted}`, tenantId);
    }),
    revokeTenantSession: vi.fn<B2bTransport["revokeTenantSession"]>(async () => undefined),
    listBillingPlans: vi.fn<B2bTransport["listBillingPlans"]>(async () => ({ items: [] })),
    createTenant: vi.fn<B2bTransport["createTenant"]>(async (_bearer, input) => ({
      tenant: { id: "tenant-new", name: input.name, ownerId: USER, lifecycle: "PROVISIONING", restrictions: [], createdAt: "2026-11-04T10:00:00Z", version: "1" },
      operation: { id: "operation-new", type: "TENANT_PROVISION", state: "PENDING", createdAt: "2026-11-04T10:00:00Z", updatedAt: "2026-11-04T10:00:00Z", tenantId: "tenant-new" },
    })),
    getTenant: vi.fn<B2bTransport["getTenant"]>(async (_bearer, tenantId) => ({
      id: tenantId, name: "Northwind", ownerId: USER, lifecycle: "AWAITING_PAYMENT", restrictions: ["PENDING_FIRST_PAYMENT"], createdAt: "2026-05-01T09:00:00Z", version: "4",
    })),
    getTenantOperation: vi.fn<B2bTransport["getTenantOperation"]>(async (_bearer, tenantId, operationId) => ({
      id: operationId, type: "TENANT_PROVISION", state: "RUNNING", createdAt: "2026-11-04T10:00:00Z", updatedAt: "2026-11-04T10:00:01Z", tenantId,
    })),
    cancelTenantCreation: vi.fn<B2bTransport["cancelTenantCreation"]>(async (_bearer, tenantId) => ({
      id: tenantId, name: "Northwind", ownerId: USER, lifecycle: "OWNER_CANCELLED", restrictions: ["PENDING_FIRST_PAYMENT"], createdAt: "2026-05-01T09:00:00Z", version: "5",
    })),
    // TAS-502.
    listTenantMembers: vi.fn<B2bTransport["listTenantMembers"]>(async (_bearer, tenantId) => ({
      items: [{ id: "m-1", tenantId, userId: USER, role: "TENANT_ADMIN", state: "ACTIVE", isOwner: false, displayName: "A", email: "a@example.com", version: "1" }],
    })),
    setTenantMemberRole: vi.fn<B2bTransport["setTenantMemberRole"]>(async (_bearer, tenantId, userId, role) => ({
      id: "m-1", tenantId, userId, role, state: "ACTIVE", isOwner: false, displayName: "A", email: "a@example.com", version: "2",
    })),
    setTenantMemberState: vi.fn<B2bTransport["setTenantMemberState"]>(async (_bearer, tenantId, userId, state) => ({
      id: "m-1", tenantId, userId, role: "MEMBER", state, isOwner: false, displayName: "A", email: "a@example.com", version: "2",
    })),
    removeTenantMember: vi.fn<B2bTransport["removeTenantMember"]>(async (_bearer, tenantId) => ({
      id: "op-remove", type: "removeTenantMember", state: "PENDING", createdAt: "2026-11-05T10:00:00Z", updatedAt: "2026-11-05T10:00:00Z", tenantId,
    })),
    leaveTenant: vi.fn<B2bTransport["leaveTenant"]>(async (_bearer, tenantId) => ({
      id: "op-leave", type: "leaveTenant", state: "SUCCEEDED", createdAt: "2026-11-05T10:00:00Z", updatedAt: "2026-11-05T10:00:00Z", tenantId,
    })),
    listTenantInvitations: vi.fn<B2bTransport["listTenantInvitations"]>(async () => ({ items: [] })),
    createTenantInvitation: vi.fn<B2bTransport["createTenantInvitation"]>(async (_bearer, tenantId, input) => ({
      id: "inv-1", tenantId, email: input.email, role: input.role, state: "PENDING", expiresAt: "2026-11-12T10:00:00Z", createdBy: USER, projectGrants: input.projectGrants, version: "1",
    })),
    resendTenantInvitation: vi.fn<B2bTransport["resendTenantInvitation"]>(async (_bearer, tenantId, invitationId) => ({
      id: invitationId, tenantId, email: "kai@example.com", role: "MEMBER", state: "PENDING", expiresAt: "2026-11-12T10:00:00Z", createdBy: USER, projectGrants: [], version: "2",
    })),
    revokeTenantInvitation: vi.fn<B2bTransport["revokeTenantInvitation"]>(async () => undefined),
    getTenantQuotas: vi.fn<B2bTransport["getTenantQuotas"]>(async (_bearer, tenantId) => ({
      tenantId, version: "1", quotas: [{ kind: "SEAT", used: "4", reserved: "1", limit: "5", unlimited: false }], asOf: "2026-11-05T10:00:00Z",
    })),
    // TAS-504.
    renameTenant: vi.fn<B2bTransport["renameTenant"]>(async (_bearer, tenantId, name) => ({
      id: tenantId, name, ownerId: USER, lifecycle: "ACTIVE", restrictions: [], createdAt: "2026-05-01T09:00:00Z", version: "5",
    })),
    pauseTenant: vi.fn<B2bTransport["pauseTenant"]>(async (_bearer, tenantId) => ({
      id: tenantId, name: "Northwind", ownerId: USER, lifecycle: "ACTIVE", restrictions: ["OWNER_PAUSE"], createdAt: "2026-05-01T09:00:00Z", version: "5",
    })),
    resumeTenant: vi.fn<B2bTransport["resumeTenant"]>(async (_bearer, tenantId) => ({
      id: tenantId, name: "Northwind", ownerId: USER, lifecycle: "ACTIVE", restrictions: [], createdAt: "2026-05-01T09:00:00Z", version: "6",
    })),
    transferTenantOwnership: vi.fn<B2bTransport["transferTenantOwnership"]>(async (_bearer, tenantId, newOwnerUserId) => ({
      id: tenantId, name: "Northwind", ownerId: newOwnerUserId, lifecycle: "ACTIVE", restrictions: [], createdAt: "2026-05-01T09:00:00Z", version: "5",
    })),
    getSubscription: vi.fn<B2bTransport["getSubscription"]>(async (_bearer, tenantId) => ({
      tenantId, planVersionId: "plan-team", version: "2", paidThrough: "2026-12-07T09:00:00Z", renewalCancelled: false, autopayState: "CONSENTED",
    })),
    // TAS-512.
    getEntitlement: vi.fn<B2bTransport["getEntitlement"]>(async (_bearer, tenantId) => ({
      tenantId, version: "3", planVersionId: "plan-free", coveragePeriodId: "period-1", validFrom: "2026-05-01T09:00:00Z", validUntil: "2026-12-07T09:00:00Z",
      restrictions: [], limits: [{ kind: "TASK_LIFETIME", limit: "50", unlimited: false }], features: ["projects.basic"], issuedAt: "2026-11-05T10:00:00Z",
    })),
    // TAS-513.
    listInvoices: vi.fn<B2bTransport["listInvoices"]>(async () => ({ items: [] })),
    getInvoice: vi.fn<B2bTransport["getInvoice"]>(async (_bearer, tenantId, invoiceId) => ({ id: invoiceId, tenantId, state: "OPEN" })),
    createCheckout: vi.fn<B2bTransport["createCheckout"]>(async (_bearer, _tenantId, invoiceId) => ({ id: "checkout-1", invoiceId, state: "CREATED" })),
    getCheckout: vi.fn<B2bTransport["getCheckout"]>(async (_bearer, _tenantId, checkoutId) => ({ id: checkoutId, invoiceId: "invoice-1", state: "PENDING" })),
    getInvoiceDocument: vi.fn<B2bTransport["getInvoiceDocument"]>(async () => ({
      contentType: "application/pdf",
      disposition: null,
      body: new Blob(["%PDF-1.4"], { type: "application/pdf" }),
    })),
    listRefunds: vi.fn<B2bTransport["listRefunds"]>(async () => ({ items: [] })),
    listDisputes: vi.fn<B2bTransport["listDisputes"]>(async () => ({ items: [] })),
    getTenantCapabilities: vi.fn<B2bTransport["getTenantCapabilities"]>(async (_bearer, tenantId) => ({ tenantId, durationsSeconds: {} })),
    // TAS-515.
    changeSubscriptionPlan: vi.fn<B2bTransport["changeSubscriptionPlan"]>(async (_bearer, tenantId) => ({
      subscription: { tenantId, planVersionId: "plan-team", version: "3", renewalCancelled: false, autopayState: "DISABLED" },
      effect: "AFTER_PAYMENT",
      invoiceId: "invoice-2",
      operationId: "operation-1",
    })),
    cancelSubscriptionRenewal: vi.fn<B2bTransport["cancelSubscriptionRenewal"]>(async (_bearer, tenantId) => ({
      tenantId, planVersionId: "plan-team", version: "3", renewalCancelled: true, autopayState: "CONSENTED",
    })),
    resumeSubscriptionRenewal: vi.fn<B2bTransport["resumeSubscriptionRenewal"]>(async (_bearer, tenantId) => ({
      tenantId, planVersionId: "plan-team", version: "4", renewalCancelled: false, autopayState: "CONSENTED",
    })),
    setAutopayConsent: vi.fn<B2bTransport["setAutopayConsent"]>(async () => ({ id: "mandate-1", state: "DISABLED", version: "41" })),
  };
}

type FakeTransport = ReturnType<typeof fakeTransport>;

function openTab(options: {
  local: MemoryStorage;
  session?: MemoryStorage;
  transport?: FakeTransport;
  locks?: LockManagerLike;
  events?: EventTarget | null;
}) {
  const transport = options.transport ?? fakeTransport();
  const session = options.session ?? new MemoryStorage();
  const client = new WebSessionClient({
    transport,
    local: options.local,
    session,
    locks: options.locks ?? createLocalLockManager(),
    ownershipWaitMs: 25,
    events: options.events ?? null,
  });
  return { client, transport, session };
}

/** A pending answer the test hands over when it chooses to. */
function gate<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const stored = (storage: MemoryStorage, key: string) => {
  const raw = storage.getItem(key);
  return raw === null ? null : (JSON.parse(raw) as Record<string, unknown>);
};

describe("the account family is rotated once across tabs, with its key recorded first (B1)", () => {
  it("two tabs refused together send one refresh, and both retry with the new pair", async () => {
    const local = new MemoryStorage();
    signedIn(local);
    const locks = createLocalLockManager();
    const transport = fakeTransport();
    const refreshed = gate<void>();
    const pendingAtSend: unknown[] = [];
    transport.refreshWebSession.mockImplementation(async () => {
      pendingAtSend.push(stored(local, WEB_SESSION_KEY)?.pending);
      await refreshed.promise;
      return accessSession("account-session", "g1");
    });
    const a = openTab({ local, transport, locks });
    const b = openTab({ local, transport, locks });
    const refusedOnStale = async (bearer: string | null) => {
      if (bearer === "g0-access") throw refusal(401, "AUTHENTICATION_REQUIRED");
      return bearer;
    };

    const fromA = a.client.call("session", refusedOnStale);
    const fromB = b.client.call("session", refusedOnStale);
    await vi.waitFor(() => expect(transport.refreshWebSession).toHaveBeenCalledTimes(1));
    refreshed.resolve();

    await expect(fromA).resolves.toBe("g1-access");
    await expect(fromB).resolves.toBe("g1-access");
    expect(transport.refreshWebSession).toHaveBeenCalledTimes(1);
    const [sentToken, sentKey] = transport.refreshWebSession.mock.calls[0];
    expect(sentToken).toBe(accountRecord().refreshToken);
    // The key was in storage before the request left, and is gone with the new pair.
    expect(pendingAtSend).toEqual([{ key: sentKey }]);
    expect(stored(local, WEB_SESSION_KEY)).toEqual(accountRecord("g1"));
  });

  it("retries a rotation that got no answer with the same key, from the record", async () => {
    const local = new MemoryStorage();
    signedIn(local);
    const transport = fakeTransport();
    transport.refreshWebSession
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(accessSession("account-session", "g1"));
    const { client } = openTab({ local, transport });
    const refusedOnStale = async (bearer: string | null) => {
      if (bearer === "g0-access") throw refusal(401, "AUTHENTICATION_REQUIRED");
      return bearer;
    };

    // No answer: the request keeps its 401, nobody is signed out, the key stays.
    await expect(client.call("session", refusedOnStale)).rejects.toMatchObject({ status: 401 });
    const firstKey = transport.refreshWebSession.mock.calls[0][1];
    expect(stored(local, WEB_SESSION_KEY)?.pending).toEqual({ key: firstKey });

    await expect(client.call("session", refusedOnStale)).resolves.toBe("g1-access");
    expect(transport.refreshWebSession.mock.calls[1]).toEqual([accountRecord().refreshToken, firstKey]);
    expect(stored(local, WEB_SESSION_KEY)).toEqual(accountRecord("g1"));
  });

  it("a refused rotation signs every tab out: the record goes and the account session is announced dead", async () => {
    const local = new MemoryStorage();
    signedIn(local);
    const transport = fakeTransport();
    transport.refreshWebSession.mockRejectedValue(refusal(401, "TOKEN_REVOKED"));
    const { client } = openTab({ local, transport });
    const expired = vi.fn();
    client.onSessionExpired(expired);

    await expect(
      client.call("session", async () => {
        throw refusal(401, "AUTHENTICATION_REQUIRED");
      }),
    ).rejects.toBeInstanceOf(WorkspaceClosedError);
    expect(expired).toHaveBeenCalledTimes(1);
    expect(local.getItem(WEB_SESSION_KEY)).toBeNull();
    expect(client.hasSession()).toBe(false);
  });

  it("falls back to an in-page lock manager where the browser has none (jsdom)", async () => {
    expect((navigator as Navigator & { locks?: unknown }).locks).toBeUndefined();
    const locks = defaultLockManager();
    const order: string[] = [];
    const first = locks.request("x", {}, async () => {
      order.push("first");
      await Promise.resolve();
      order.push("first done");
    });
    const second = locks.request("x", {}, () => {
      order.push("second");
    });
    await Promise.all([first, second]);
    expect(order).toEqual(["first", "first done", "second"]);
  });
});

describe("a company session is the tab's own (B2)", () => {
  it("a duplicated tab never uses, renews or revokes the copied session, and mints its own before it answers", async () => {
    const local = new MemoryStorage();
    signedIn(local);
    const locks = createLocalLockManager();
    const a = openTab({ local, locks });
    const original = await a.client.enterCompany(NORTHWIND);
    expect(original.tenantSessionId).toBe("ts-1");

    const copied = a.session.copy();
    const transport = fakeTransport();
    transport.createTenantSession.mockImplementation(async (_bearer, tenantId) =>
      accessSession("ts-dup", "dup", tenantId),
    );
    const b = openTab({ local, locks, session: copied, transport });
    // Nothing is offered before the tab knows whose the session is.
    expect(b.client.currentWorkspace()).toBeNull();

    const own = await b.client.enterCompany(NORTHWIND);
    expect(own).toEqual({ tenantId: NORTHWIND, tenantName: null, tenantSessionId: "ts-dup" });
    expect(transport.createTenantSession).toHaveBeenCalledTimes(1);
    expect(transport.createTenantSession.mock.calls[0][0]).toBe("g0-access");
    expect(transport.refreshWebSession).not.toHaveBeenCalled();
    expect(transport.revokeTenantSession).not.toHaveBeenCalled();

    const bearers: (string | null)[] = [];
    await b.client.call("session", async (bearer) => bearers.push(bearer));
    expect(bearers).toEqual(["dup-access"]);
    expect(stored(copied, TAB_KEY)).toMatchObject({ tenantSessionId: "ts-dup", accessToken: "dup-access" });

    // The original tab still has, and uses, its own.
    expect(a.client.currentWorkspace()).toEqual(original);
    expect(stored(a.session, TAB_KEY)).toMatchObject({ tenantSessionId: "ts-1", accessToken: "t1-access" });
    await a.client.call("session", async (bearer) => bearers.push(bearer));
    expect(bearers).toEqual(["dup-access", "t1-access"]);
  });

  it("a reload takes the tab's session back without a request", async () => {
    const local = new MemoryStorage();
    signedIn(local);
    const first = openTab({ local });
    await first.client.enterCompany(NORTHWIND);
    // The old document is gone and its lock with it: a new manager, the same storages.
    const reloaded = openTab({ local, session: first.session });
    await vi.waitFor(() => expect(reloaded.client.currentWorkspace()?.tenantSessionId).toBe("ts-1"));
    await reloaded.client.enterCompany(NORTHWIND);
    expect(reloaded.transport.createTenantSession).not.toHaveBeenCalled();
  });

  it("only the owning tab renews its company family", async () => {
    const local = new MemoryStorage();
    signedIn(local);
    const { client, transport } = openTab({ local });
    await client.enterCompany(NORTHWIND);
    const answers = await client.call("session", async (bearer) => {
      if (bearer === "t1-access") throw refusal(401, "AUTHENTICATION_REQUIRED");
      return bearer;
    });
    expect(answers).toBe("rts-1-access");
    expect(transport.refreshWebSession).toHaveBeenCalledTimes(1);
    expect(transport.refreshWebSession.mock.calls[0][0]).toBe("t1-refresh-0123456789abcdef0123456789");
  });
});

describe("an answer of a context the tab has left never lands (B3)", () => {
  for (const outcome of ["success", "failure"] as const) {
    it(`a late ${outcome} after a switch is WorkspaceClosedError, and its request was aborted`, async () => {
      const local = new MemoryStorage();
      signedIn(local);
      const { client } = openTab({ local });
      await client.enterCompany(NORTHWIND);
      const late = gate<string>();
      let signal: AbortSignal | null = null;
      const asked = client.call("session", (_bearer, given) => {
        signal = given;
        return late.promise;
      });
      await vi.waitFor(() => expect(signal).not.toBeNull());

      await client.enterCompany(GLOBEX);
      expect((signal as AbortSignal | null)?.aborted).toBe(true);
      if (outcome === "success") late.resolve("Northwind's projects");
      else late.reject(refusal(404, "RESOURCE_NOT_FOUND"));
      await expect(asked).rejects.toBeInstanceOf(WorkspaceClosedError);
    });
  }

  it("a request asked once a switch has begun waits and goes to the new company; one asked before is discarded", async () => {
    const local = new MemoryStorage();
    signedIn(local);
    const { client, transport } = openTab({ local });
    await client.enterCompany(NORTHWIND);
    const before = gate<string>();
    const askedBefore = client.call("session", () => before.promise);
    const created = gate<unknown>();
    transport.createTenantSession.mockImplementationOnce(() => created.promise);
    const switching = client.enterCompany(GLOBEX);
    // Asked twice for the same company: one transition, one answer.
    expect(client.enterCompany(GLOBEX)).toBe(switching);
    const send = vi.fn(async (bearer: string | null) => bearer);
    const askedAfter = client.call("session", send);
    created.resolve(accessSession("ts-g", "g-company", GLOBEX));
    await switching;
    before.resolve("Northwind's answer");
    await expect(askedBefore).rejects.toBeInstanceOf(WorkspaceClosedError);
    await expect(askedAfter).resolves.toBe("g-company-access");
    expect(send).toHaveBeenCalledTimes(1);
    expect(transport.createTenantSession).toHaveBeenCalledTimes(2);
  });

  it("a refused switch discards what waited for it rather than sending it with no company", async () => {
    const local = new MemoryStorage();
    signedIn(local);
    const { client, transport } = openTab({ local });
    transport.createTenantSession.mockRejectedValueOnce(refusal(403, "MEMBERSHIP_INACTIVE"));
    const entering = client.enterCompany(GLOBEX);
    const send = vi.fn(async () => "sent");
    const asked = client.call("session", send);
    await expect(entering).rejects.toMatchObject({ code: "MEMBERSHIP_INACTIVE" });
    await expect(asked).rejects.toBeInstanceOf(WorkspaceClosedError);
    expect(send).not.toHaveBeenCalled();
  });

  it("settles the tab's company once a reload's restoration is done", async () => {
    const local = new MemoryStorage();
    signedIn(local);
    const first = openTab({ local });
    await first.client.enterCompany(NORTHWIND);
    const reloaded = openTab({ local, session: first.session });
    await expect(reloaded.client.settleWorkspace()).resolves.toMatchObject({ tenantId: NORTHWIND, tenantSessionId: "ts-1" });
    const fresh = openTab({ local });
    await expect(fresh.client.settleWorkspace()).resolves.toBeNull();
  });

  it("entering the company the tab is in sends nothing; switching revokes the previous session best-effort", async () => {
    const local = new MemoryStorage();
    signedIn(local);
    const { client, transport } = openTab({ local });
    const changes = vi.fn();
    client.onWorkspaceChange(changes);
    await client.enterCompany(NORTHWIND);
    await client.enterCompany(NORTHWIND);
    expect(transport.createTenantSession).toHaveBeenCalledTimes(1);

    transport.revokeTenantSession.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const next = await client.enterCompany(GLOBEX);
    expect(next.tenantId).toBe(GLOBEX);
    expect(transport.revokeTenantSession).toHaveBeenCalledWith("g0-access", "ts-1", expect.any(String));
    expect(stored(local, LAST_COMPANY_KEY)).toEqual({ userId: USER, companyId: GLOBEX });
    expect(client.lastCompanyHint()).toBe(GLOBEX);
    expect(changes).toHaveBeenCalled();
  });

  it("signing out moves the epoch, revokes the tab's session with the account's token and forgets the hint", async () => {
    const local = new MemoryStorage();
    signedIn(local);
    const { client, transport, session } = openTab({ local });
    await client.enterCompany(NORTHWIND);
    const late = gate<string>();
    const asked = client.call("session", () => late.promise);
    await client.signOut();
    late.resolve("too late");
    await expect(asked).rejects.toBeInstanceOf(WorkspaceClosedError);
    await vi.waitFor(() => expect(transport.revokeTenantSession).toHaveBeenCalledWith("g0-access", "ts-1", expect.any(String)));
    expect(local.getItem(WEB_SESSION_KEY)).toBeNull();
    expect(local.getItem(LAST_COMPANY_KEY)).toBeNull();
    expect(session.getItem(TAB_KEY)).toBeNull();
    expect(client.hasSession()).toBe(false);
    expect(client.currentWorkspace()).toBeNull();
  });
});

describe("credentials per route (§2)", () => {
  it("a tab without a company sends the account's; in a company, the company's — and the list always the account's", async () => {
    const local = new MemoryStorage();
    signedIn(local);
    const { client, transport } = openTab({ local });
    const bearers: (string | null)[] = [];
    await client.call("session", async (bearer) => bearers.push(bearer));
    await client.call("none", async (bearer) => bearers.push(bearer));
    await client.enterCompany(NORTHWIND);
    await client.call("session", async (bearer) => bearers.push(bearer));
    await client.listTenants({ limit: 100 });
    expect(bearers).toEqual(["g0-access", null, "t1-access"]);
    expect(transport.listTenants).toHaveBeenCalledWith("g0-access", { limit: 100 }, expect.any(AbortSignal));
    // The list taught the tab its company's name.
    expect(client.currentWorkspace()).toEqual({ tenantId: NORTHWIND, tenantName: "Northwind", tenantSessionId: "ts-1" });
  });
});

describe("refusals (§5)", () => {
  async function inNorthwind() {
    const local = new MemoryStorage();
    signedIn(local);
    const tab = openTab({ local });
    await tab.client.enterCompany(NORTHWIND);
    const closed: WorkspaceClosedEvent[] = [];
    tab.client.onWorkspaceClosed((event) => closed.push(event));
    const expired = vi.fn();
    tab.client.onSessionExpired(expired);
    return { ...tab, local, closed, expired };
  }

  it("403 MEMBERSHIP_INACTIVE closes the company with its code and request id, and revokes it best-effort", async () => {
    const { client, transport, closed, session } = await inNorthwind();
    await expect(
      client.call("session", async () => {
        throw refusal(403, "MEMBERSHIP_INACTIVE");
      }),
    ).rejects.toBeInstanceOf(WorkspaceClosedError);
    expect(closed).toEqual([
      {
        reason: "MEMBERSHIP_INACTIVE",
        tenantId: NORTHWIND,
        tenantName: null,
        requestId: "rid-MEMBERSHIP_INACTIVE",
        reasons: [],
        // The server's own words travel to the screen (api-contract-guard N1).
        message: "MEMBERSHIP_INACTIVE",
      },
    ]);
    expect(client.currentWorkspace()).toBeNull();
    expect(session.getItem(TAB_KEY)).toBeNull();
    await vi.waitFor(() => expect(transport.revokeTenantSession).toHaveBeenCalledWith("g0-access", "ts-1", expect.any(String)));
  });

  it("the legacy envelope's details.reason closes it the same way", async () => {
    const { client, closed } = await inNorthwind();
    const legacy = Object.assign(new Error("Membership is not active"), {
      status: 403,
      code: "PERMISSION_DENIED",
      details: { reason: "MEMBERSHIP_INACTIVE" },
    });
    await expect(client.call("session", async () => Promise.reject(legacy))).rejects.toBeInstanceOf(WorkspaceClosedError);
    expect(closed.map((event) => event.reason)).toEqual(["MEMBERSHIP_INACTIVE"]);
  });

  it("403 TENANT_MISMATCH closes the company with its words and request id, and never switches it", async () => {
    const { client, transport, closed } = await inNorthwind();
    await expect(
      client.call("session", async () => {
        throw refusal(403, "TENANT_MISMATCH");
      }),
    ).rejects.toBeInstanceOf(WorkspaceClosedError);
    expect(closed).toEqual([
      { reason: "TENANT_MISMATCH", tenantId: NORTHWIND, tenantName: null, requestId: "rid-TENANT_MISMATCH", reasons: [], message: "TENANT_MISMATCH" },
    ]);
    expect(client.currentWorkspace()).toBeNull();
    // Never an automatic switch to some other company: one session was made, the first.
    expect(transport.createTenantSession).toHaveBeenCalledTimes(1);
  });

  // TAS-504 (api-contract-guard B2) narrowed this on purpose: a pause or a
  // block keeps the company (the next describe); any other reason closes it.
  it("a read refused CAPABILITY_DISABLED with another reason closes the company with them; the same refusal of a write does not", async () => {
    const { client, closed } = await inNorthwind();
    const disputed = () => refusal(403, "CAPABILITY_DISABLED", ["PAYMENT_DISPUTE"]);
    const write = client.call("session", async () => Promise.reject(disputed()));
    await expect(write).rejects.toMatchObject({ code: "CAPABILITY_DISABLED" });
    expect(closed).toEqual([]);
    await expect(client.call("session", async () => Promise.reject(disputed()), { read: true })).rejects.toBeInstanceOf(
      WorkspaceClosedError,
    );
    expect(closed.map((event) => [event.reason, event.reasons])).toEqual([["CAPABILITY_DISABLED", ["PAYMENT_DISPUTE"]]]);
    expect(client.currentWorkspace()).toBeNull();
  });

  it("403 READ_ONLY refuses that one action with its reasons; the company stays open", async () => {
    const { client, closed } = await inNorthwind();
    const readOnly = refusal(403, "READ_ONLY", ["OWNER_PAUSE"]);
    const answer = client.call("session", async () => Promise.reject(readOnly));
    await expect(answer).rejects.toBe(readOnly);
    expect(refusalReasons(await answer.catch((error: unknown) => error))).toEqual(["OWNER_PAUSE"]);
    expect(closed).toEqual([]);
    expect(client.currentWorkspace()?.tenantSessionId).toBe("ts-1");
  });

  it("a refused company renewal re-selects the company once: a new session, a new context", async () => {
    const { client, transport, closed } = await inNorthwind();
    transport.refreshWebSession.mockRejectedValueOnce(refusal(401, "AUTHENTICATION_REQUIRED"));
    const changes = vi.fn();
    client.onWorkspaceChange(changes);
    await expect(
      client.call("session", async () => {
        throw refusal(401, "AUTHENTICATION_REQUIRED");
      }),
    ).rejects.toBeInstanceOf(WorkspaceClosedError);
    expect(client.currentWorkspace()).toEqual({ tenantId: NORTHWIND, tenantName: null, tenantSessionId: "ts-2" });
    expect(changes).toHaveBeenCalled();
    expect(closed).toEqual([]);
  });

  for (const [answer, reason] of [
    [refusal(403, "MEMBERSHIP_INACTIVE"), "MEMBERSHIP_INACTIVE"],
    [refusal(404, "TENANT_NOT_FOUND"), "TENANT_NOT_FOUND"],
    [refusal(409, "INVALID_STATE"), "INVALID_STATE"],
    [new TypeError("Failed to fetch"), "TRANSPORT_FAILURE"],
  ] as const) {
    it(`a re-selection answered ${reason} closes the company with that reason`, async () => {
      const { client, transport, closed, expired } = await inNorthwind();
      transport.refreshWebSession.mockRejectedValueOnce(refusal(401, "AUTHENTICATION_REQUIRED"));
      transport.createTenantSession.mockRejectedValueOnce(answer);
      await expect(
        client.call("session", async () => {
          throw refusal(401, "AUTHENTICATION_REQUIRED");
        }),
      ).rejects.toBeInstanceOf(WorkspaceClosedError);
      expect(closed.map((event) => event.reason)).toEqual([reason]);
      expect(client.currentWorkspace()).toBeNull();
      expect(expired).not.toHaveBeenCalled();
    });
  }

  it("a re-selection whose account session is dead signs out, not closes", async () => {
    const { client, transport, closed, expired, local } = await inNorthwind();
    transport.refreshWebSession.mockRejectedValue(refusal(401, "AUTHENTICATION_REQUIRED"));
    transport.createTenantSession.mockRejectedValueOnce(refusal(401, "AUTHENTICATION_REQUIRED"));
    await expect(
      client.call("session", async () => {
        throw refusal(401, "AUTHENTICATION_REQUIRED");
      }),
    ).rejects.toBeInstanceOf(WorkspaceClosedError);
    expect(expired).toHaveBeenCalledTimes(1);
    expect(closed).toEqual([]);
    expect(local.getItem(WEB_SESSION_KEY)).toBeNull();
  });

  it("a revoke's own 401 — backend PR #288's answer for an unknown id — never signs out", async () => {
    const { client, transport, expired, local } = await inNorthwind();
    transport.revokeTenantSession.mockRejectedValue(refusal(401, "AUTHENTICATION_REQUIRED"));
    await client.leaveCompany();
    await vi.waitFor(() => expect(transport.revokeTenantSession).toHaveBeenCalledTimes(2));
    expect(transport.refreshWebSession).toHaveBeenCalledTimes(1);
    expect(expired).not.toHaveBeenCalled();
    expect(local.getItem(WEB_SESSION_KEY)).not.toBeNull();
  });
});

describe("sign-in (§6, B8)", () => {
  it("stores one account record, deletes the legacy pair and drops a tab of another account", async () => {
    const local = new MemoryStorage();
    local.setItem(LEGACY_ACCESS_TOKEN_KEY, "legacy-access");
    local.setItem(LEGACY_REFRESH_TOKEN_KEY, "legacy-refresh");
    const { client, transport } = openTab({ local });
    await expect(client.signIn({ email: "anna@example.com", password: "x" })).resolves.toEqual({
      status: "SIGNED_IN",
      userId: USER,
    });
    expect(transport.startWebSession).toHaveBeenCalledWith({ email: "anna@example.com", password: "x" }, expect.any(String));
    expect(stored(local, WEB_SESSION_KEY)).toEqual(accountRecord("g0"));
    expect(local.getItem(LEGACY_ACCESS_TOKEN_KEY)).toBeNull();
    expect(local.getItem(LEGACY_REFRESH_TOKEN_KEY)).toBeNull();
  });

  it("a GLOBAL_ADMIN's challenge (the blueprint's 200) is a dead end with nothing stored", async () => {
    const local = new MemoryStorage();
    const transport = fakeTransport();
    transport.startWebSession.mockResolvedValueOnce({
      challengeId: "8f0e2a4c-1b3d-4e5f-8a7b-9c0d1e2f3a4b",
      purpose: "ADMIN_LOGIN",
      expiresAt: "2026-11-04T10:00:00Z",
      delivery: "EMAIL",
      maskedDestination: "m•••@example.com",
      retryAfterSeconds: 60,
    });
    const { client } = openTab({ local, transport });
    await expect(client.signIn({ email: "mark@example.com", password: "x" })).resolves.toEqual({
      status: "ADMIN_MFA_REQUIRED",
      requestId: null,
    });
    expect(local.keys()).toEqual([]);
    expect(client.hasSession()).toBe(false);
  });

  it("and so is backend PR #288's 403 MFA_REQUIRED, with its request id", async () => {
    const local = new MemoryStorage();
    const transport = fakeTransport();
    transport.startWebSession.mockRejectedValueOnce(refusal(403, "MFA_REQUIRED"));
    const { client } = openTab({ local, transport });
    await expect(client.signIn({ email: "mark@example.com", password: "x" })).resolves.toEqual({
      status: "ADMIN_MFA_REQUIRED",
      requestId: "rid-MFA_REQUIRED",
    });
    expect(local.keys()).toEqual([]);
  });

  it("any other refusal rejects as it came", async () => {
    const local = new MemoryStorage();
    const transport = fakeTransport();
    const notThere = refusal(404, "NOT_FOUND");
    transport.startWebSession.mockRejectedValueOnce(notThere);
    const { client } = openTab({ local, transport });
    await expect(client.signIn({ email: "anna@example.com", password: "x" })).rejects.toBe(notThere);
    expect(local.keys()).toEqual([]);
  });
});

describe("another tab changes the account (§4)", () => {
  it("the record removed elsewhere drops this tab's company and announces the account session gone", async () => {
    const local = new MemoryStorage();
    signedIn(local);
    const events = new EventTarget();
    const { client, transport, session } = openTab({ local, events });
    await client.enterCompany(NORTHWIND);
    const expired = vi.fn();
    client.onSessionExpired(expired);

    local.removeItem(WEB_SESSION_KEY);
    events.dispatchEvent(new StorageEvent("storage", { key: WEB_SESSION_KEY }));
    expect(client.currentWorkspace()).toBeNull();
    expect(session.getItem(TAB_KEY)).toBeNull();
    expect(expired).toHaveBeenCalledTimes(1);
    expect(transport.revokeTenantSession).not.toHaveBeenCalled();
  });

  it("a sibling's rotation of the same account changes nothing here", async () => {
    const local = new MemoryStorage();
    signedIn(local);
    const events = new EventTarget();
    const { client } = openTab({ local, events });
    await client.enterCompany(NORTHWIND);
    signedIn(local, "g9");
    events.dispatchEvent(new StorageEvent("storage", { key: WEB_SESSION_KEY }));
    expect(client.currentWorkspace()?.tenantSessionId).toBe("ts-1");
  });
});

/* --------------------------------------------- creating a company (TAS-501) */

describe("creating a company goes with the account session (api-contract-guard B1)", () => {
  async function inNorthwind() {
    const local = new MemoryStorage();
    signedIn(local);
    const tab = openTab({ local });
    await tab.client.enterCompany(NORTHWIND);
    return { ...tab, local };
  }

  it("from inside a company, createTenant sends WEB_GLOBAL — never the company's — with the caller's key and the body exactly", async () => {
    const { client, transport } = await inNorthwind();
    const result = await client.createTenant({ name: "Acme", planVersionId: "plan-free" }, "key-1");
    expect(transport.createTenant).toHaveBeenCalledWith("g0-access", { name: "Acme", planVersionId: "plan-free" }, "key-1");
    expect(result.tenant).toMatchObject({ id: "tenant-new", name: "Acme", lifecycle: "PROVISIONING" });
    expect(result.operation).toMatchObject({ id: "operation-new", state: "PENDING" });
    // The tab is still in Northwind: creating is not entering.
    expect(client.currentWorkspace()?.tenantId).toBe(NORTHWIND);
  });

  it("a 401 rotates the account family once and sends again with the same key and the same body", async () => {
    const { client, transport } = await inNorthwind();
    transport.createTenant.mockRejectedValueOnce(refusal(401, "AUTHENTICATION_REQUIRED"));
    await client.createTenant({ name: "Acme", planVersionId: "plan-team" }, "key-2");
    expect(transport.refreshWebSession).toHaveBeenCalledTimes(1);
    expect(transport.createTenant.mock.calls).toEqual([
      ["g0-access", { name: "Acme", planVersionId: "plan-team" }, "key-2"],
      ["g1-access", { name: "Acme", planVersionId: "plan-team" }, "key-2"],
    ]);
  });

  it("learns the new company's name, so the tab that enters it next is not «This company»", async () => {
    const { client } = await inNorthwind();
    await client.createTenant({ name: "Acme", planVersionId: "plan-free" }, "key-3");
    await expect(client.enterCompany("tenant-new")).resolves.toMatchObject({ tenantId: "tenant-new", tenantName: "Acme" });
  });

  it("an answer that lands after signing out is WorkspaceClosedError, and a refusal is the server's as it came", async () => {
    const { client, transport } = await inNorthwind();
    const held = gate<unknown>();
    transport.createTenant.mockReturnValueOnce(held.promise);
    const asked = client.createTenant({ name: "Acme", planVersionId: "plan-free" }, "key-4");
    await client.signOut();
    held.resolve({});
    await expect(asked).rejects.toBeInstanceOf(WorkspaceClosedError);

    const other = await inNorthwind();
    const used = refusal(409, "FREE_ELIGIBILITY_USED");
    other.transport.createTenant.mockRejectedValueOnce(used);
    await expect(other.client.createTenant({ name: "Acme", planVersionId: "plan-free" }, "key-5")).rejects.toBe(used);
  });

  it("the plans go with no credential; the company's own reads and its cancel go with the tab's company session", async () => {
    const { client, transport } = await inNorthwind();
    await client.listBillingPlans({ limit: 100 });
    expect(transport.listBillingPlans).toHaveBeenCalledWith({ limit: 100 }, expect.any(AbortSignal));
    await expect(client.getTenant(NORTHWIND)).resolves.toMatchObject({ lifecycle: "AWAITING_PAYMENT", creationDeadline: null });
    expect(transport.getTenant).toHaveBeenCalledWith("t1-access", NORTHWIND, expect.any(AbortSignal));
    await client.getTenantOperation(NORTHWIND, "operation-1");
    expect(transport.getTenantOperation).toHaveBeenCalledWith("t1-access", NORTHWIND, "operation-1", expect.any(AbortSignal));
    await expect(client.cancelTenantCreation(NORTHWIND, "4", "key-6")).resolves.toMatchObject({ lifecycle: "OWNER_CANCELLED" });
    expect(transport.cancelTenantCreation).toHaveBeenCalledWith("t1-access", NORTHWIND, "4", "key-6");
  });

  it("signing out forgets the tab's creation attempt", async () => {
    const { client, session } = await inNorthwind();
    session.setItem(TENANT_CREATION_KEY, JSON.stringify({ v: 1, userId: USER, key: "k", name: "Acme", planVersionId: "p", sentAt: "x" }));
    await client.signOut();
    expect(session.getItem(TENANT_CREATION_KEY)).toBeNull();
  });
});

describe("a company that has never opened is not closed by its refusals (api-contract-guard B4)", () => {
  async function inPending() {
    const local = new MemoryStorage();
    signedIn(local);
    const tab = openTab({ local });
    await tab.client.enterCompany(NORTHWIND);
    const closed: WorkspaceClosedEvent[] = [];
    const pending: WorkspacePendingEvent[] = [];
    tab.client.onWorkspaceClosed((event) => closed.push(event));
    tab.client.onWorkspacePending((event) => pending.push(event));
    return { ...tab, closed, pending };
  }

  it("a content read refused for PENDING_FIRST_PAYMENT tells the shell, keeps the session, revokes nothing and rejects as refused", async () => {
    const { client, transport, closed, pending } = await inPending();
    const refused = refusal(403, "CAPABILITY_DISABLED", ["PENDING_FIRST_PAYMENT"]);
    await expect(client.call("session", async () => Promise.reject(refused), { read: true })).rejects.toBe(refused);
    expect(pending).toEqual([
      { tenantId: NORTHWIND, code: "CAPABILITY_DISABLED", reasons: ["PENDING_FIRST_PAYMENT"], requestId: "rid-CAPABILITY_DISABLED" },
    ]);
    expect(closed).toEqual([]);
    expect(client.currentWorkspace()?.tenantSessionId).toBe("ts-1");
    expect(transport.revokeTenantSession).not.toHaveBeenCalled();
    // The session still answers the company's own reads.
    await expect(client.getTenant(NORTHWIND)).resolves.toMatchObject({ id: NORTHWIND });
  });

  it("so does code PAYMENT_PENDING on a read; on a write it is that write's refusal and nothing more", async () => {
    const { client, closed, pending } = await inPending();
    const refused = refusal(409, "PAYMENT_PENDING");
    await expect(client.call("session", async () => Promise.reject(refused))).rejects.toBe(refused);
    expect(pending).toEqual([]);
    await expect(client.call("session", async () => Promise.reject(refused), { read: true })).rejects.toBe(refused);
    expect(pending.map((event) => event.code)).toEqual(["PAYMENT_PENDING"]);
    expect(closed).toEqual([]);
  });

  it("a pause still closes the company, and a lapsed membership wins over the payment reason", async () => {
    const { client, closed, pending } = await inPending();
    await expect(
      client.call("session", async () => Promise.reject(refusal(403, "MEMBERSHIP_INACTIVE", ["PENDING_FIRST_PAYMENT"])), { read: true }),
    ).rejects.toBeInstanceOf(WorkspaceClosedError);
    expect(closed.map((event) => event.reason)).toEqual(["MEMBERSHIP_INACTIVE"]);
    expect(pending).toEqual([]);
  });
});


describe("a company's members, invitations and seats (TAS-502)", () => {
  async function inNorthwind() {
    const local = new MemoryStorage();
    signedIn(local);
    const tab = openTab({ local });
    await tab.client.enterCompany(NORTHWIND);
    const closed: WorkspaceClosedEvent[] = [];
    tab.client.onWorkspaceClosed((event) => closed.push(event));
    return { ...tab, local, closed };
  }

  it("every route goes with the tab's company session, the caller's key and the row's version", async () => {
    const { client, transport } = await inNorthwind();
    await client.listTenantMembers(NORTHWIND, { limit: 100 });
    await client.setTenantMemberRole(NORTHWIND, USER, "MEMBER", "4", "key-role");
    await client.setTenantMemberState(NORTHWIND, USER, "SUSPENDED", "5", "key-state");
    await client.removeTenantMember(NORTHWIND, USER, "6", "key-remove");
    await client.listTenantInvitations(NORTHWIND, { cursor: "c", limit: 100 });
    await client.createTenantInvitation(NORTHWIND, { email: "kai@example.com", role: "MEMBER", projectGrants: [{ projectId: "p", role: "VIEWER" }] }, "key-invite");
    await client.resendTenantInvitation(NORTHWIND, "inv-1", "key-resend");
    await client.revokeTenantInvitation(NORTHWIND, "inv-1", "2", "key-revoke");
    await expect(client.getTenantQuotas(NORTHWIND)).resolves.toMatchObject({ quotas: [{ kind: "SEAT", used: "4" }] });
    expect(transport.listTenantMembers.mock.calls[0].slice(0, 3)).toEqual(["t1-access", NORTHWIND, { limit: 100 }]);
    expect(transport.setTenantMemberRole.mock.calls[0]).toEqual(["t1-access", NORTHWIND, USER, "MEMBER", "4", "key-role"]);
    expect(transport.setTenantMemberState.mock.calls[0]).toEqual(["t1-access", NORTHWIND, USER, "SUSPENDED", "5", "key-state"]);
    expect(transport.removeTenantMember.mock.calls[0]).toEqual(["t1-access", NORTHWIND, USER, "6", "key-remove"]);
    expect(transport.listTenantInvitations.mock.calls[0].slice(0, 3)).toEqual(["t1-access", NORTHWIND, { cursor: "c", limit: 100 }]);
    // The body is the three fields, in one order, so a retry sends the same bytes.
    expect(JSON.stringify(transport.createTenantInvitation.mock.calls[0][2])).toBe(
      '{"email":"kai@example.com","role":"MEMBER","projectGrants":[{"projectId":"p","role":"VIEWER"}]}',
    );
    expect(transport.resendTenantInvitation.mock.calls[0]).toEqual(["t1-access", NORTHWIND, "inv-1", "key-resend"]);
    expect(transport.revokeTenantInvitation.mock.calls[0]).toEqual(["t1-access", NORTHWIND, "inv-1", "2", "key-revoke"]);
    expect(transport.getTenantQuotas.mock.calls[0].slice(0, 2)).toEqual(["t1-access", NORTHWIND]);
  });

  it("a call for a company the tab does not hold is refused without a request — never a TENANT_MISMATCH that would close it", async () => {
    const { client, transport, closed } = await inNorthwind();
    await expect(client.listTenantMembers(GLOBEX)).rejects.toBeInstanceOf(WorkspaceClosedError);
    await expect(client.setTenantMemberRole(GLOBEX, USER, "MEMBER", "1", "k")).rejects.toBeInstanceOf(WorkspaceClosedError);
    expect(transport.listTenantMembers).not.toHaveBeenCalled();
    expect(transport.setTenantMemberRole).not.toHaveBeenCalled();
    expect(closed).toEqual([]);
    // And with no company at all, nothing goes with the account session either.
    await client.leaveCompany();
    await expect(client.getTenantQuotas(NORTHWIND)).rejects.toBeInstanceOf(WorkspaceClosedError);
    expect(transport.getTenantQuotas).not.toHaveBeenCalled();
  });

  it("a 401 renews the company family and retries once with the same key, body and version", async () => {
    const { client, transport } = await inNorthwind();
    transport.setTenantMemberRole.mockImplementationOnce(async () => {
      throw refusal(401, "AUTHENTICATION_REQUIRED");
    });
    await client.setTenantMemberRole(NORTHWIND, USER, "MEMBER", "4", "key-role");
    expect(transport.setTenantMemberRole.mock.calls.map((call) => call.slice(1))).toEqual([
      [NORTHWIND, USER, "MEMBER", "4", "key-role"],
      [NORTHWIND, USER, "MEMBER", "4", "key-role"],
    ]);
    expect(transport.setTenantMemberRole.mock.calls[1][0]).not.toBe(transport.setTenantMemberRole.mock.calls[0][0]);
  });

  it("leaving: on a 202 that is not FAILED the company session is released, and nothing draws §4.35", async () => {
    const { client, transport, closed } = await inNorthwind();
    const operation = await client.leaveTenant(NORTHWIND, "key-leave");
    expect(operation).toMatchObject({ state: "SUCCEEDED" });
    expect(transport.leaveTenant.mock.calls[0]).toEqual(["t1-access", NORTHWIND, "key-leave"]);
    expect(client.currentWorkspace()).toBeNull();
    expect(transport.revokeTenantSession).toHaveBeenCalledWith("g0-access", "ts-1", expect.any(String));
    expect(closed).toEqual([]);
  });

  it("a closing refusal while leaving closes nothing; a FAILED operation keeps the session", async () => {
    const { client, transport, closed } = await inNorthwind();
    const held = gate<unknown>();
    transport.leaveTenant.mockImplementationOnce(() => held.promise);
    const leaving = client.leaveTenant(NORTHWIND, "key-leave");
    await vi.waitFor(() => expect(transport.leaveTenant).toHaveBeenCalled());
    // A read in flight meets the server's removal of the reader meanwhile.
    const inactive = refusal(403, "MEMBERSHIP_INACTIVE");
    await expect(client.call("session", async () => Promise.reject(inactive), { read: true })).rejects.toBe(inactive);
    expect(closed).toEqual([]);
    held.resolve({ id: "op", type: "leaveTenant", state: "FAILED", failureCode: "DEPENDENCY_UNAVAILABLE", createdAt: "x", updatedAt: "x" });
    await expect(leaving).resolves.toMatchObject({ state: "FAILED", failureCode: "DEPENDENCY_UNAVAILABLE" });
    expect(client.currentWorkspace()?.tenantId).toBe(NORTHWIND);
    // After it, the closing rule is back.
    await expect(client.call("session", async () => Promise.reject(inactive))).rejects.toBeInstanceOf(WorkspaceClosedError);
    expect(closed.map((event) => event.reason)).toEqual(["MEMBERSHIP_INACTIVE"]);
  });

  it("a leave whose answer was lost, retried with its key and refused 401/403/404, is the same success", async () => {
    const { client, transport, closed } = await inNorthwind();
    transport.leaveTenant.mockImplementationOnce(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(client.leaveTenant(NORTHWIND, "key-leave")).rejects.toBeInstanceOf(TypeError);
    expect(client.currentWorkspace()?.tenantId).toBe(NORTHWIND);
    transport.leaveTenant.mockImplementationOnce(async () => {
      throw refusal(404, "TENANT_NOT_FOUND");
    });
    await expect(client.leaveTenant(NORTHWIND, "key-leave")).resolves.toBeNull();
    expect(transport.leaveTenant.mock.calls.map((call) => call[2])).toEqual(["key-leave", "key-leave"]);
    expect(client.currentWorkspace()).toBeNull();
    expect(closed).toEqual([]);
  });

  it("a first leave refused 403 MEMBERSHIP_INACTIVE or 404 TENANT_NOT_FOUND is that refusal, never «left» (M3)", async () => {
    for (const refused of [refusal(403, "MEMBERSHIP_INACTIVE"), refusal(404, "TENANT_NOT_FOUND")]) {
      const { client, transport, closed } = await inNorthwind();
      transport.leaveTenant.mockImplementationOnce(async () => {
        throw refused;
      });
      await expect(client.leaveTenant(NORTHWIND, "key-first")).rejects.toBe(refused);
      expect(client.currentWorkspace()?.tenantId).toBe(NORTHWIND);
      expect(closed).toEqual([]);
    }
  });

  it("a lost leave is any answer that never came — none, 408 or 5xx — and never a 429 (M4)", async () => {
    for (const [lost, isLost] of [
      [new TypeError("Failed to fetch"), true],
      [refusal(408, "TIMEOUT"), true],
      [refusal(503, "DEPENDENCY_UNAVAILABLE"), true],
      [refusal(429, "RATE_LIMITED"), false],
    ] as const) {
      const { client, transport } = await inNorthwind();
      transport.leaveTenant.mockImplementationOnce(async () => {
        throw lost;
      });
      await expect(client.leaveTenant(NORTHWIND, "key-leave")).rejects.toBe(lost);
      const gone = refusal(404, "TENANT_NOT_FOUND");
      transport.leaveTenant.mockImplementationOnce(async () => {
        throw gone;
      });
      if (isLost) await expect(client.leaveTenant(NORTHWIND, "key-leave")).resolves.toBeNull();
      else await expect(client.leaveTenant(NORTHWIND, "key-leave")).rejects.toBe(gone);
    }
  });

  it("the retry of a lost leave is «left» by its code: another 403 or 404 is that refusal (ruling 2b)", async () => {
    for (const other of [refusal(403, "SCOPE_DENIED"), refusal(404, "RESOURCE_NOT_FOUND")]) {
      const { client, transport } = await inNorthwind();
      transport.leaveTenant.mockImplementationOnce(async () => {
        throw new TypeError("Failed to fetch");
      });
      await expect(client.leaveTenant(NORTHWIND, "key-leave")).rejects.toBeInstanceOf(TypeError);
      transport.leaveTenant.mockImplementationOnce(async () => {
        throw other;
      });
      await expect(client.leaveTenant(NORTHWIND, "key-leave")).rejects.toBe(other);
      expect(client.currentWorkspace()?.tenantId).toBe(NORTHWIND);
    }
    // 403 MEMBERSHIP_INACTIVE on the retry is «left».
    const { client, transport } = await inNorthwind();
    transport.leaveTenant.mockImplementationOnce(async () => {
      throw refusal(502, "DEPENDENCY_UNAVAILABLE");
    });
    await expect(client.leaveTenant(NORTHWIND, "key-leave")).rejects.toMatchObject({ status: 502 });
    transport.leaveTenant.mockImplementationOnce(async () => {
      throw refusal(403, "MEMBERSHIP_INACTIVE");
    });
    await expect(client.leaveTenant(NORTHWIND, "key-leave")).resolves.toBeNull();
    expect(client.currentWorkspace()).toBeNull();
  });

  it("with a lost leave open, another request's «no longer a member» is the leave applied: released, no closure (B-1)", async () => {
    const { client, transport, closed } = await inNorthwind();
    const left: WorkspaceLeftEvent[] = [];
    client.onWorkspaceLeft((event) => left.push(event));
    transport.leaveTenant.mockImplementationOnce(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(client.leaveTenant(NORTHWIND, "key-leave")).rejects.toBeInstanceOf(TypeError);
    // A background re-read meets the server's answer first.
    await expect(
      client.call("session", async () => Promise.reject(refusal(403, "MEMBERSHIP_INACTIVE")), { read: true }),
    ).rejects.toBeInstanceOf(WorkspaceClosedError);
    expect(closed).toEqual([]);
    expect(left).toEqual([{ tenantId: NORTHWIND, tenantName: null }]);
    expect(client.currentWorkspace()).toBeNull();
    expect(transport.revokeTenantSession).toHaveBeenCalledWith("g0-access", "ts-1", expect.any(String));
  });

  it("…through renewal too: a refused refresh and a re-selection refused 404 TENANT_NOT_FOUND are «left»", async () => {
    const { client, transport, closed } = await inNorthwind();
    const left: WorkspaceLeftEvent[] = [];
    client.onWorkspaceLeft((event) => left.push(event));
    transport.leaveTenant.mockImplementationOnce(async () => {
      throw refusal(504, "DEPENDENCY_UNAVAILABLE");
    });
    await expect(client.leaveTenant(NORTHWIND, "key-leave")).rejects.toMatchObject({ status: 504 });
    transport.refreshWebSession.mockImplementationOnce(async () => {
      throw refusal(401, "TOKEN_REVOKED");
    });
    transport.createTenantSession.mockImplementationOnce(async () => {
      throw refusal(404, "TENANT_NOT_FOUND");
    });
    await expect(
      client.call("session", async () => Promise.reject(refusal(401, "TOKEN_REVOKED")), { read: true }),
    ).rejects.toBeInstanceOf(WorkspaceClosedError);
    expect(closed).toEqual([]);
    expect(left.map((event) => event.tenantId)).toEqual([NORTHWIND]);
    // Without a lost leave the same refusal is a closure, as TAS-500 has it.
    const second = await inNorthwind();
    await expect(
      second.client.call("session", async () => Promise.reject(refusal(403, "MEMBERSHIP_INACTIVE"))),
    ).rejects.toBeInstanceOf(WorkspaceClosedError);
    expect(second.closed.map((event) => event.reason)).toEqual(["MEMBERSHIP_INACTIVE"]);
  });

  describe("how long a lost leave is remembered (release-reviewer R2-M1, api-contract-guard P1/P2, L-a)", () => {
    async function lostLeave() {
      const tab = await inNorthwind();
      const left: WorkspaceLeftEvent[] = [];
      tab.client.onWorkspaceLeft((event) => left.push(event));
      tab.transport.leaveTenant.mockImplementationOnce(async () => {
        throw refusal(503, "DEPENDENCY_UNAVAILABLE");
      });
      await expect(tab.client.leaveTenant(NORTHWIND, "key-leave")).rejects.toMatchObject({ status: 503 });
      return { ...tab, left };
    }
    const inactive = () => refusal(403, "MEMBERSHIP_INACTIVE");
    const readRefused = (client: WebSessionClient, error: unknown) =>
      client.call("session", async () => Promise.reject(error), { read: true });

    it("A: a switch away and back is a new session — its «no longer a member» is a closure, not «left»", async () => {
      const { client, closed, left } = await lostLeave();
      await client.enterCompany(GLOBEX);
      await client.enterCompany(NORTHWIND);
      await expect(readRefused(client, inactive())).rejects.toBeInstanceOf(WorkspaceClosedError);
      expect(left).toEqual([]);
      expect(closed.map((event) => [event.tenantId, event.reason])).toEqual([[NORTHWIND, "MEMBERSHIP_INACTIVE"]]);
    });

    it("B: signing out and in forgets it", async () => {
      const { client, closed, left } = await lostLeave();
      await client.signOut();
      await client.signIn({ email: "a@example.com", password: "x" });
      await client.enterCompany(NORTHWIND);
      await expect(readRefused(client, inactive())).rejects.toBeInstanceOf(WorkspaceClosedError);
      expect(left).toEqual([]);
      expect(closed.map((event) => event.reason)).toEqual(["MEMBERSHIP_INACTIVE"]);
    });

    it("C: a successful re-selection is a new session — a later refusal is a closure", async () => {
      const { client, transport, closed, left } = await lostLeave();
      transport.refreshWebSession.mockImplementationOnce(async () => {
        throw refusal(401, "TOKEN_REVOKED");
      });
      await expect(readRefused(client, refusal(401, "TOKEN_REVOKED"))).rejects.toBeInstanceOf(WorkspaceClosedError);
      expect(client.currentWorkspace()?.tenantSessionId).toBe("ts-2");
      await expect(readRefused(client, inactive())).rejects.toBeInstanceOf(WorkspaceClosedError);
      expect(left).toEqual([]);
      expect(closed.map((event) => event.reason)).toEqual(["MEMBERSHIP_INACTIVE"]);
    });

    it("D: a 2xx of that session after the loss proves it still works — the leave did not apply", async () => {
      const { client, closed, left } = await lostLeave();
      await expect(client.call("session", async () => "an answer", { read: true })).resolves.toBe("an answer");
      await expect(readRefused(client, refusal(404, "TENANT_NOT_FOUND"))).rejects.toBeInstanceOf(WorkspaceClosedError);
      expect(left).toEqual([]);
      expect(closed.map((event) => event.reason)).toEqual(["TENANT_NOT_FOUND"]);
    });

    it("N4: a 2xx of a request sent before the loss — in flight when it was lost — proves nothing", async () => {
      const tab = await inNorthwind();
      const left: WorkspaceLeftEvent[] = [];
      tab.client.onWorkspaceLeft((event) => left.push(event));
      const inFlight = gate<string>();
      const sendRead = vi.fn(() => inFlight.promise);
      const read = tab.client.call("session", sendRead, { read: true });
      await vi.waitFor(() => expect(sendRead).toHaveBeenCalled());
      tab.transport.leaveTenant.mockImplementationOnce(async () => {
        throw refusal(503, "DEPENDENCY_UNAVAILABLE");
      });
      await expect(tab.client.leaveTenant(NORTHWIND, "key-leave")).rejects.toMatchObject({ status: 503 });
      inFlight.resolve("an answer from before");
      await expect(read).resolves.toBe("an answer from before");
      await expect(readRefused(tab.client, inactive())).rejects.toBeInstanceOf(WorkspaceClosedError);
      expect(tab.closed).toEqual([]);
      expect(left.map((event) => event.tenantId)).toEqual([NORTHWIND]);
    });

    it("N2: a retry lost again moves the record on — a read sent while the retry was out proves nothing", async () => {
      const { client, transport, closed, left } = await lostLeave();
      const retry = gate<unknown>();
      transport.leaveTenant.mockImplementationOnce(() => retry.promise);
      const leaving = client.leaveTenant(NORTHWIND, "key-leave");
      await vi.waitFor(() => expect(transport.leaveTenant).toHaveBeenCalledTimes(2));
      const inFlight = gate<string>();
      const sendRead = vi.fn(() => inFlight.promise);
      const read = client.call("session", sendRead, { read: true });
      // The read is sent before the retry's answer is lost.
      await vi.waitFor(() => expect(sendRead).toHaveBeenCalled());
      retry.reject(new TypeError("Failed to fetch"));
      await expect(leaving).rejects.toBeInstanceOf(TypeError);
      inFlight.resolve("sent while the retry was out");
      await expect(read).resolves.toBe("sent while the retry was out");
      await expect(readRefused(client, inactive())).rejects.toBeInstanceOf(WorkspaceClosedError);
      expect(closed).toEqual([]);
      expect(left.map((event) => event.tenantId)).toEqual([NORTHWIND]);
    });

    it("P1: a retry answered 429 keeps it — a later 404 retry is «left»", async () => {
      const { client, transport } = await lostLeave();
      transport.leaveTenant.mockImplementationOnce(async () => {
        throw refusal(429, "RATE_LIMITED");
      });
      await expect(client.leaveTenant(NORTHWIND, "key-leave")).rejects.toMatchObject({ status: 429 });
      transport.leaveTenant.mockImplementationOnce(async () => {
        throw refusal(404, "TENANT_NOT_FOUND");
      });
      await expect(client.leaveTenant(NORTHWIND, "key-leave")).resolves.toBeNull();
    });

    it("P2: a retry answered 429 keeps it — a background MEMBERSHIP_INACTIVE is «left»", async () => {
      const { client, transport, closed, left } = await lostLeave();
      transport.leaveTenant.mockImplementationOnce(async () => {
        throw refusal(429, "RATE_LIMITED");
      });
      await expect(client.leaveTenant(NORTHWIND, "key-leave")).rejects.toMatchObject({ status: 429 });
      await expect(readRefused(client, inactive())).rejects.toBeInstanceOf(WorkspaceClosedError);
      expect(closed).toEqual([]);
      expect(left.map((event) => event.tenantId)).toEqual([NORTHWIND]);
    });

    // TAS-504 (B2): a pause no longer closes at all — and it is never «left».
    it("N2: only MEMBERSHIP_INACTIVE and TENANT_NOT_FOUND say «left» — a pause keeps the company, another reason closes it", async () => {
      const { client, closed, left } = await lostLeave();
      const paused = refusal(403, "CAPABILITY_DISABLED", ["OWNER_PAUSE"]);
      await expect(readRefused(client, paused)).rejects.toBe(paused);
      expect(left).toEqual([]);
      expect(closed).toEqual([]);
      expect(client.currentWorkspace()?.tenantId).toBe(NORTHWIND);
      await expect(readRefused(client, refusal(403, "CAPABILITY_DISABLED", ["PAYMENT_DISPUTE"]))).rejects.toBeInstanceOf(
        WorkspaceClosedError,
      );
      expect(left).toEqual([]);
      expect(closed.map((event) => event.reason)).toEqual(["CAPABILITY_DISABLED"]);
    });

    it("N3: another company's refusal closes that company", async () => {
      const { client, closed, left } = await lostLeave();
      await client.enterCompany(GLOBEX);
      await expect(readRefused(client, inactive())).rejects.toBeInstanceOf(WorkspaceClosedError);
      expect(left).toEqual([]);
      expect(closed.map((event) => [event.tenantId, event.reason])).toEqual([[GLOBEX, "MEMBERSHIP_INACTIVE"]]);
    });

    it("N6: a definite refusal of the retry closes the record — a later refusal is a closure", async () => {
      const { client, transport, closed, left } = await lostLeave();
      transport.leaveTenant.mockImplementationOnce(async () => {
        throw refusal(409, "LAST_ADMIN");
      });
      await expect(client.leaveTenant(NORTHWIND, "key-leave")).rejects.toMatchObject({ code: "LAST_ADMIN" });
      await expect(readRefused(client, inactive())).rejects.toBeInstanceOf(WorkspaceClosedError);
      expect(left).toEqual([]);
      expect(closed.map((event) => event.reason)).toEqual(["MEMBERSHIP_INACTIVE"]);
    });

    it("a 202 on the retry forgets it: a FAILED operation keeps the session, and a later refusal is a closure", async () => {
      const { client, transport, closed, left } = await lostLeave();
      transport.leaveTenant.mockImplementationOnce(async () => ({
        id: "op", type: "leaveTenant", state: "FAILED", failureCode: "DEPENDENCY_UNAVAILABLE", createdAt: "x", updatedAt: "x",
      }));
      await expect(client.leaveTenant(NORTHWIND, "key-leave")).resolves.toMatchObject({ state: "FAILED" });
      expect(client.currentWorkspace()?.tenantSessionId).toBe("ts-1");
      await expect(readRefused(client, inactive())).rejects.toBeInstanceOf(WorkspaceClosedError);
      expect(left).toEqual([]);
      expect(closed.map((event) => event.reason)).toEqual(["MEMBERSHIP_INACTIVE"]);
    });

    it("a «left» release forgets it: the company entered again is closed by its refusal", async () => {
      const { client, closed, left } = await lostLeave();
      await expect(readRefused(client, inactive())).rejects.toBeInstanceOf(WorkspaceClosedError);
      expect(left).toHaveLength(1);
      await client.enterCompany(NORTHWIND);
      await expect(readRefused(client, inactive())).rejects.toBeInstanceOf(WorkspaceClosedError);
      expect(left).toHaveLength(1);
      expect(closed.map((event) => event.reason)).toEqual(["MEMBERSHIP_INACTIVE"]);
    });

    it("a 401 on the retry is «left» only when renewal was refused and re-selection said «no longer a member»", async () => {
      const { client, transport, closed } = await lostLeave();
      transport.leaveTenant.mockImplementationOnce(async () => {
        throw refusal(401, "TOKEN_REVOKED");
      });
      transport.refreshWebSession.mockImplementationOnce(async () => {
        throw refusal(401, "TOKEN_REVOKED");
      });
      transport.createTenantSession.mockImplementationOnce(async () => {
        throw refusal(404, "TENANT_NOT_FOUND");
      });
      await expect(client.leaveTenant(NORTHWIND, "key-leave")).resolves.toBeNull();
      expect(client.currentWorkspace()).toBeNull();
      expect(closed).toEqual([]);
    });

    it("L-a: a 401 whose refresh got no answer is no «left» — the record stays, and a later 404 retry is", async () => {
      const { client, transport, closed } = await lostLeave();
      transport.leaveTenant.mockImplementationOnce(async () => {
        throw refusal(401, "TOKEN_REVOKED");
      });
      transport.refreshWebSession.mockImplementationOnce(async () => {
        throw new TypeError("Failed to fetch");
      });
      await expect(client.leaveTenant(NORTHWIND, "key-leave")).rejects.toMatchObject({ status: 401 });
      expect(client.currentWorkspace()?.tenantId).toBe(NORTHWIND);
      expect(closed).toEqual([]);
      transport.leaveTenant.mockImplementationOnce(async () => {
        throw refusal(404, "TENANT_NOT_FOUND");
      });
      await expect(client.leaveTenant(NORTHWIND, "key-leave")).resolves.toBeNull();
    });
  });

  it("a first leave refused LAST_ADMIN is that refusal: the session stays, nothing closes", async () => {
    const { client, transport, closed } = await inNorthwind();
    transport.leaveTenant.mockImplementationOnce(async () => {
      throw refusal(409, "LAST_ADMIN");
    });
    await expect(client.leaveTenant(NORTHWIND, "key-leave")).rejects.toMatchObject({ code: "LAST_ADMIN" });
    expect(client.currentWorkspace()?.tenantId).toBe(NORTHWIND);
    expect(closed).toEqual([]);
  });

  it("re-entering after the reader's own change mints a new session, then revokes the old one; the epoch moves", async () => {
    const { client, transport } = await inNorthwind();
    const before = client.currentWorkspace();
    const old = client.call("session", () => new Promise(() => {}));
    transport.createTenantSession.mockClear();
    transport.revokeTenantSession.mockClear();
    await client.reenterCompany(NORTHWIND);
    // The new session first, the old one revoked after it (release-reviewer L2).
    expect(transport.createTenantSession.mock.invocationCallOrder[0]).toBeLessThan(
      transport.revokeTenantSession.mock.invocationCallOrder[0],
    );
    expect(client.currentWorkspace()).toMatchObject({ tenantId: NORTHWIND, tenantSessionId: "ts-2" });
    expect(client.currentWorkspace()?.tenantSessionId).not.toBe(before?.tenantSessionId);
    expect(transport.revokeTenantSession).toHaveBeenCalledWith("g0-access", "ts-1", expect.any(String));
    await expect(old).rejects.toBeInstanceOf(WorkspaceClosedError);
    await client.listTenantMembers(NORTHWIND);
    expect(transport.listTenantMembers.mock.calls.at(-1)?.[0]).toBe("t2-access");
  });

  it("a re-entry that gets no answer keeps the session the tab has; one refused MEMBERSHIP_INACTIVE closes the company", async () => {
    const { client, transport, closed } = await inNorthwind();
    transport.createTenantSession.mockImplementationOnce(async () => {
      throw new TypeError("Failed to fetch");
    });
    await client.reenterCompany(NORTHWIND);
    expect(client.currentWorkspace()?.tenantSessionId).toBe("ts-1");
    expect(closed).toEqual([]);
    transport.createTenantSession.mockImplementationOnce(async () => {
      throw refusal(403, "MEMBERSHIP_INACTIVE");
    });
    await client.reenterCompany(NORTHWIND);
    expect(client.currentWorkspace()).toBeNull();
    expect(closed.map((event) => event.reason)).toEqual(["MEMBERSHIP_INACTIVE"]);
  });
});

describe("a pause or a block closes the projects, not the company (TAS-504, api-contract-guard B2)", () => {
  async function inNorthwind() {
    const local = new MemoryStorage();
    signedIn(local);
    const tab = openTab({ local });
    await tab.client.enterCompany(NORTHWIND);
    const closed: WorkspaceClosedEvent[] = [];
    const pending: WorkspacePendingEvent[] = [];
    const restricted: WorkspaceRestrictedEvent[] = [];
    tab.client.onWorkspaceClosed((event) => closed.push(event));
    tab.client.onWorkspacePending((event) => pending.push(event));
    tab.client.onWorkspaceRestricted((event) => restricted.push(event));
    return { ...tab, local, closed, pending, restricted };
  }
  const contentRead = (client: WebSessionClient, error: unknown) =>
    client.call("session", async () => Promise.reject(error), { read: true, content: true });

  for (const reasons of [["OWNER_PAUSE"], ["PLATFORM_BLOCK"], ["PLATFORM_BLOCK", "OWNER_PAUSE", "PAYMENT_EXPIRED"]]) {
    it(`a content read refused CAPABILITY_DISABLED ${reasons.join(", ")} keeps the session, revokes nothing, marks the tab and rejects as refused`, async () => {
      const { client, transport, closed, pending, restricted } = await inNorthwind();
      // A request already out when the refusal lands is not discarded: the epoch did not move.
      let release!: (value: string) => void;
      const inFlight = client.call("session", () => new Promise<string>((resolve) => (release = resolve)));
      const refused = refusal(403, "CAPABILITY_DISABLED", reasons);
      await expect(contentRead(client, refused)).rejects.toBe(refused);
      release("answered");
      await expect(inFlight).resolves.toBe("answered");
      expect(restricted).toEqual([{ tenantId: NORTHWIND, restricted: true, reasons, requestId: "rid-CAPABILITY_DISABLED" }]);
      expect(closed).toEqual([]);
      expect(pending).toEqual([]);
      expect(client.currentWorkspace()?.tenantSessionId).toBe("ts-1");
      expect(transport.revokeTenantSession).not.toHaveBeenCalled();
      // The company's own reads still go with the same session.
      await client.getSubscription(NORTHWIND);
      expect(transport.getSubscription.mock.calls[0][0]).toBe("t1-access");
    });
  }

  it("PENDING_FIRST_PAYMENT beside a pause is the never-opened company's (TAS-501), not this mark", async () => {
    const { client, pending, restricted, closed } = await inNorthwind();
    await expect(contentRead(client, refusal(403, "CAPABILITY_DISABLED", ["OWNER_PAUSE", "PENDING_FIRST_PAYMENT"]))).rejects.toMatchObject({
      code: "CAPABILITY_DISABLED",
    });
    expect(pending.map((event) => event.reasons)).toEqual([["OWNER_PAUSE", "PENDING_FIRST_PAYMENT"]]);
    expect(restricted).toEqual([]);
    expect(closed).toEqual([]);
  });

  it("a write refused the same way is that write's refusal and marks nothing; a lapsed membership still closes", async () => {
    const { client, restricted, closed } = await inNorthwind();
    await expect(client.call("session", async () => Promise.reject(refusal(403, "CAPABILITY_DISABLED", ["OWNER_PAUSE"])))).rejects.toMatchObject({
      code: "CAPABILITY_DISABLED",
    });
    expect(restricted).toEqual([]);
    await expect(contentRead(client, refusal(403, "MEMBERSHIP_INACTIVE", ["OWNER_PAUSE"]))).rejects.toBeInstanceOf(WorkspaceClosedError);
    expect(closed.map((event) => event.reason)).toEqual(["MEMBERSHIP_INACTIVE"]);
  });

  it("the mark is lifted by a Tenant answer without either reason — never by one that still carries one", async () => {
    const { client, transport, restricted } = await inNorthwind();
    await contentRead(client, refusal(403, "CAPABILITY_DISABLED", ["OWNER_PAUSE"])).catch(() => undefined);
    transport.getTenant.mockResolvedValueOnce({ id: NORTHWIND, name: "Northwind", ownerId: USER, lifecycle: "ACTIVE", restrictions: ["OWNER_PAUSE"], version: "4" });
    await client.getTenant(NORTHWIND);
    transport.pauseTenant.mockClear();
    await client.pauseTenant(NORTHWIND, "4", "key-pause");
    expect(restricted.map((event) => event.restricted)).toEqual([true]);
    // The owner's own resume answers the company without the pause.
    await client.resumeTenant(NORTHWIND, "5", "key-resume");
    expect(restricted.at(-1)).toEqual({ tenantId: NORTHWIND, restricted: false, reasons: [], requestId: null });
    // Said once: another answer without a mark to lift says nothing.
    await client.resumeTenant(NORTHWIND, "6", "key-resume-2");
    expect(restricted.map((event) => event.restricted)).toEqual([true, false]);
  });

  it("…and by a content read that answers — not by a read of the reader's own routes", async () => {
    const { client, restricted } = await inNorthwind();
    await contentRead(client, refusal(403, "CAPABILITY_DISABLED", ["PLATFORM_BLOCK"])).catch(() => undefined);
    await client.call("session", async () => "me", { read: true });
    await client.call("session", async () => "notifications");
    expect(restricted.map((event) => event.restricted)).toEqual([true]);
    await client.call("session", async () => "projects", { read: true, content: true });
    expect(restricted.map((event) => event.restricted)).toEqual([true, false]);
  });

  it("…and by anything that takes the company from the tab; a re-entry of the same company keeps it", async () => {
    const { client, restricted } = await inNorthwind();
    await contentRead(client, refusal(403, "CAPABILITY_DISABLED", ["OWNER_PAUSE"])).catch(() => undefined);
    await client.reenterCompany(NORTHWIND);
    expect(restricted.map((event) => event.restricted)).toEqual([true]);
    await client.enterCompany(GLOBEX);
    expect(restricted.map((event) => [event.tenantId, event.restricted])).toEqual([
      [NORTHWIND, true],
      [NORTHWIND, false],
    ]);
    await contentRead(client, refusal(403, "CAPABILITY_DISABLED", ["OWNER_PAUSE"])).catch(() => undefined);
    await client.signOut();
    expect(restricted.map((event) => [event.tenantId, event.restricted]).slice(2)).toEqual([
      [GLOBEX, true],
      [GLOBEX, false],
    ]);
  });
});

describe("the company's name, owner and pause (TAS-504, api-contract-guard §1)", () => {
  async function inNorthwind() {
    const local = new MemoryStorage();
    signedIn(local);
    const tab = openTab({ local });
    await tab.client.enterCompany(NORTHWIND);
    const closed: WorkspaceClosedEvent[] = [];
    tab.client.onWorkspaceClosed((event) => closed.push(event));
    return { ...tab, local, closed };
  }

  it("every command goes with the tab's company session, the caller's key and version; the answer is a Tenant", async () => {
    const { client, transport } = await inNorthwind();
    await expect(client.renameTenant(NORTHWIND, "Northwind Traders", "4", "key-rename")).resolves.toMatchObject({
      id: NORTHWIND,
      name: "Northwind Traders",
      version: "5",
    });
    // The new name is the tab's at once (the switcher, the title, the menu read it, §4.39).
    expect(client.currentWorkspace()?.tenantName).toBe("Northwind Traders");
    await expect(client.pauseTenant(NORTHWIND, "5", "key-pause")).resolves.toMatchObject({ restrictions: ["OWNER_PAUSE"] });
    await expect(client.resumeTenant(NORTHWIND, "6", "key-resume")).resolves.toMatchObject({ restrictions: [] });
    await expect(client.transferTenantOwnership(NORTHWIND, "user-b", "7", "key-transfer")).resolves.toMatchObject({ ownerId: "user-b" });
    expect(transport.renameTenant.mock.calls[0]).toEqual(["t1-access", NORTHWIND, "Northwind Traders", "4", "key-rename"]);
    expect(transport.pauseTenant.mock.calls[0]).toEqual(["t1-access", NORTHWIND, "5", "key-pause"]);
    expect(transport.resumeTenant.mock.calls[0]).toEqual(["t1-access", NORTHWIND, "6", "key-resume"]);
    expect(transport.transferTenantOwnership.mock.calls[0]).toEqual(["t1-access", NORTHWIND, "user-b", "7", "key-transfer"]);
  });

  it("the subscription: the company session, paidThrough as sent or null, an unknown autopay state kept", async () => {
    const { client, transport } = await inNorthwind();
    await expect(client.getSubscription(NORTHWIND)).resolves.toEqual({
      tenantId: NORTHWIND,
      planVersionId: "plan-team",
      version: "2",
      paidThrough: "2026-12-07T09:00:00Z",
      autopayState: "CONSENTED",
      renewalCancelled: false,
      // TAS-512: the announced terms, absent here.
      scheduledPlanVersionId: null,
      scheduledEffectiveAt: null,
    });
    expect(transport.getSubscription.mock.calls[0].slice(0, 2)).toEqual(["t1-access", NORTHWIND]);
    transport.getSubscription.mockResolvedValueOnce({ tenantId: NORTHWIND, planVersionId: "plan-free", version: "1", renewalCancelled: false, autopayState: "PAUSED_BY_BANK" });
    await expect(client.getSubscription(NORTHWIND)).resolves.toMatchObject({ paidThrough: null, autopayState: "PAUSED_BY_BANK" });
  });

  it("a call for a company the tab does not hold is refused without a request", async () => {
    const { client, transport, closed } = await inNorthwind();
    await expect(client.renameTenant(GLOBEX, "X", "1", "k")).rejects.toBeInstanceOf(WorkspaceClosedError);
    await expect(client.pauseTenant(GLOBEX, "1", "k")).rejects.toBeInstanceOf(WorkspaceClosedError);
    await expect(client.resumeTenant(GLOBEX, "1", "k")).rejects.toBeInstanceOf(WorkspaceClosedError);
    await expect(client.transferTenantOwnership(GLOBEX, "user-b", "1", "k")).rejects.toBeInstanceOf(WorkspaceClosedError);
    await expect(client.getSubscription(GLOBEX)).rejects.toBeInstanceOf(WorkspaceClosedError);
    for (const route of [transport.renameTenant, transport.pauseTenant, transport.resumeTenant, transport.transferTenantOwnership, transport.getSubscription]) {
      expect(route).not.toHaveBeenCalled();
    }
    expect(closed).toEqual([]);
  });

  it("a 401 renews the company family and sends the same command again: the same key, body and version", async () => {
    const { client, transport } = await inNorthwind();
    transport.transferTenantOwnership.mockImplementationOnce(async () => {
      throw refusal(401, "AUTHENTICATION_REQUIRED");
    });
    await client.transferTenantOwnership(NORTHWIND, "user-b", "7", "key-transfer");
    expect(transport.transferTenantOwnership.mock.calls.map((call) => call.slice(1))).toEqual([
      [NORTHWIND, "user-b", "7", "key-transfer"],
      [NORTHWIND, "user-b", "7", "key-transfer"],
    ]);
    expect(transport.transferTenantOwnership.mock.calls.map((call) => call[0])).toEqual(["t1-access", "rts-1-access"]);
  });

  it("a refusal is the command's own: READ_ONLY, OWNER_REQUIRED and a subscription read refused for a pause close and mark nothing", async () => {
    const { client, transport, closed } = await inNorthwind();
    const restricted: WorkspaceRestrictedEvent[] = [];
    client.onWorkspaceRestricted((event) => restricted.push(event));
    transport.renameTenant.mockRejectedValueOnce(refusal(403, "READ_ONLY", ["OWNER_PAUSE"]));
    await expect(client.renameTenant(NORTHWIND, "X", "4", "k")).rejects.toMatchObject({ code: "READ_ONLY", reasons: ["OWNER_PAUSE"] });
    transport.pauseTenant.mockRejectedValueOnce(refusal(403, "OWNER_REQUIRED"));
    await expect(client.pauseTenant(NORTHWIND, "4", "k")).rejects.toMatchObject({ code: "OWNER_REQUIRED" });
    transport.getSubscription.mockRejectedValueOnce(refusal(403, "CAPABILITY_DISABLED", ["OWNER_PAUSE"]));
    await expect(client.getSubscription(NORTHWIND)).rejects.toMatchObject({ code: "CAPABILITY_DISABLED" });
    expect(closed).toEqual([]);
    expect(restricted).toEqual([]);
    expect(client.currentWorkspace()?.tenantSessionId).toBe("ts-1");
  });
});
