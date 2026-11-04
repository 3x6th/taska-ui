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
import type { WorkspaceClosedEvent } from "./TaskaApi";

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

  it("a request asked while the tab is switching is never sent", async () => {
    const local = new MemoryStorage();
    signedIn(local);
    const { client, transport } = openTab({ local });
    await client.enterCompany(NORTHWIND);
    const created = gate<unknown>();
    transport.createTenantSession.mockImplementationOnce(() => created.promise);
    const switching = client.enterCompany(GLOBEX);
    const send = vi.fn(async () => "sent");
    const asked = client.call("session", send);
    created.resolve(accessSession("ts-g", "g-company", GLOBEX));
    await switching;
    await expect(asked).rejects.toBeInstanceOf(WorkspaceClosedError);
    expect(send).not.toHaveBeenCalled();
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
      { reason: "MEMBERSHIP_INACTIVE", tenantId: NORTHWIND, tenantName: null, requestId: "rid-MEMBERSHIP_INACTIVE", reasons: [] },
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
