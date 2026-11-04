import { describe, expect, it, vi } from "vitest";
import { MemoryStorage } from "../../test/memoryStorage";
import { TenancyUnavailableError, WorkspaceClosedError, apiErrorFacts, refusalCode, refusalReasons } from "../errors";
import { TENANCY_WITHHELD_OPERATIONS, type TaskaApi, type WorkspaceClosedEvent } from "../TaskaApi";
import { readAllTenants } from "../tenants";
import { WEB_SESSION_KEY, createLocalLockManager } from "../webSession";
import { MOCK_ACCOUNT_IDS, MOCK_PROJECT_IDS, MockTaskaStore } from "./MockTaskaApi";
import {
  MOCK_LONG_TENANT_NAME,
  MOCK_SERVER_KEY,
  MOCK_TENANT_HOOKS_KEY,
  MOCK_TENANT_IDS,
  MOCK_TENANT_PROJECT_IDS,
  MockTenantServer,
} from "./MockTenantServer";
import { MOCK_COMPANY_ROUTES, createCompaniesMockApi } from "./mockCompanies";

/*
 * The companies build's mock enforces sessions (TAS-500, api-contract-guard §7,
 * B7). Every test opens "tabs" over one `localStorage` — the server's record
 * and the account session are shared — and a `sessionStorage` each.
 */

function browser(now?: () => number) {
  const local = new MemoryStorage();
  const locks = createLocalLockManager();
  const open = (session = new MemoryStorage()) => ({
    api: createCompaniesMockApi({ local, session, locks, events: null, latencyMs: 0, ownershipWaitMs: 25, now }),
    session,
  });
  return { local, locks, open };
}

async function signedIn(api: TaskaApi, email: string) {
  await expect(api.signIn({ email, password: "mock-accepts-anything" })).resolves.toMatchObject({ status: "SIGNED_IN" });
}

const caught = (promise: Promise<unknown>) => promise.then(
  () => {
    throw new Error("expected a refusal");
  },
  (error: unknown) => error,
);

const projectKeys = async (api: TaskaApi) => (await api.listProjects()).map((project) => project.projectKey).sort();

describe("the companies mock is complete", () => {
  it("routes every TaskaApi method, and offers each as a function", () => {
    const { open } = browser();
    const { api } = open();
    for (const name of Object.keys(MOCK_COMPANY_ROUTES) as (keyof TaskaApi)[]) {
      expect(typeof api[name], name).toBe("function");
    }
    expect(api.getTenancy()).toEqual({ companies: true, providerSignIn: false, accessTokenCreate: false, adminConsole: false });
  });

  it("refuses the withheld operations without asking the server", async () => {
    const { open, local } = browser();
    const { api } = open();
    await signedIn(api, "anna@example.com");
    const before = local.getItem(MOCK_SERVER_KEY);
    for (const name of TENANCY_WITHHELD_OPERATIONS) {
      expect(MOCK_COMPANY_ROUTES[name], name).toBe("withheld");
      const call = (api[name] as (...args: unknown[]) => Promise<unknown>)();
      const error = await caught(call);
      expect(error, name).toBeInstanceOf(TenancyUnavailableError);
    }
    expect(local.getItem(MOCK_SERVER_KEY)).toBe(before);
  });
});

describe("companies and who sees what (§7 fixtures)", () => {
  it("lists the reader's active memberships in (createdAt, id) order, and walks the cursor", async () => {
    const { open } = browser();
    const { api } = open();
    await signedIn(api, "anna@example.com");
    const first = await api.listTenants({ limit: 1 });
    expect(first.items.map((tenant) => tenant.name)).toEqual(["Northwind"]);
    expect(first.nextCursor).toEqual(expect.any(String));
    const all = await readAllTenants((params) => api.listTenants({ ...params, limit: 1 }));
    // Umbrella has suspended Anna and is not listed.
    expect(all.map((tenant) => tenant.name)).toEqual(["Northwind", "Globex", "Initech"]);
    expect(all[2]).toMatchObject({ id: MOCK_TENANT_IDS.initech, lifecycle: "ACTIVE", restrictions: ["OWNER_PAUSE"] });
    expect(all[0].ownerId).toBe(MOCK_ACCOUNT_IDS.anna);
    await expect(api.listTenants({ limit: 101 })).rejects.toMatchObject({ status: 400, code: "VALIDATION_FAILED" });
    await expect(api.listTenants({ cursor: "not-a-cursor" })).rejects.toMatchObject({ status: 400, code: "VALIDATION_FAILED" });
  });

  it("the layout account has a paused, a blocked, a closed and a 120-character company", async () => {
    const { open } = browser();
    const { api } = open();
    await signedIn(api, "sofia@example.com");
    const page = await api.listTenants({ limit: 100 });
    expect(page.nextCursor).toBeNull();
    expect(page.items.map((tenant) => [tenant.name, tenant.lifecycle, tenant.restrictions])).toEqual([
      ["Northwind", "ACTIVE", []],
      ["Initech", "ACTIVE", ["OWNER_PAUSE"]],
      ["Hooli", "ACTIVE", ["PLATFORM_BLOCK"]],
      ["Massive Dynamic", "AUTO_CLOSED", []],
      [MOCK_LONG_TENANT_NAME, "ACTIVE", []],
    ]);
    expect(MOCK_LONG_TENANT_NAME).toHaveLength(120);
    // Closed: the server's answer, not the list's lifecycle, keeps it shut.
    await expect(api.enterCompany(MOCK_TENANT_IDS.massive)).rejects.toMatchObject({ status: 409, code: "INVALID_STATE" });
    expect(api.currentWorkspace()).toBeNull();
  });

  it("a company admin sees every project, a member only theirs, and each company only its own", async () => {
    const { open } = browser();
    const anna = open().api;
    await signedIn(anna, "anna@example.com");
    await anna.enterCompany(MOCK_TENANT_IDS.northwind);
    expect(await projectKeys(anna)).toEqual(["MOB", "TAS", "WEB"]);

    const globex = open().api;
    await globex.enterCompany(MOCK_TENANT_IDS.globex);
    expect(await projectKeys(globex)).toEqual(["OPS"]);
    // Another company's project is not there at all; a project of this one the reader is not on is refused.
    await expect(globex.getProjectContext(MOCK_PROJECT_IDS.taska)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(globex.getProjectContext(MOCK_TENANT_PROJECT_IDS.globexFinance)).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });

    const priya = browser().open().api;
    await signedIn(priya, "priya@example.com");
    await priya.enterCompany(MOCK_TENANT_IDS.globex);
    expect(await projectKeys(priya)).toEqual(["FIN", "OPS", "WEB"]);
  });

  it("the people directory names the company's active members only (TENANT_DIRECTORY)", async () => {
    const { open, local } = browser();
    const { api } = open();
    await signedIn(api, "anna@example.com");
    await api.enterCompany(MOCK_TENANT_IDS.northwind);
    const emails = async () => (await api.searchUsers({ query: "example.com" })).items.map((user) => user.email).sort();
    // Northwind is Anna, Sofia and Tom — not Mark, Priya or anyone else in the seed.
    expect(await emails()).toEqual(["anna@example.com", "sofia@example.com", "tom@example.com"]);
    local.setItem(MOCK_TENANT_HOOKS_KEY, JSON.stringify({ suspend: [{ tenantId: MOCK_TENANT_IDS.northwind, userId: MOCK_ACCOUNT_IDS.tom }] }));
    expect(await emails()).toEqual(["anna@example.com", "sofia@example.com"]);
  });

  it("the same key is a different issue in each company's tab", async () => {
    const { open } = browser();
    const northwind = open().api;
    await signedIn(northwind, "anna@example.com");
    await northwind.enterCompany(MOCK_TENANT_IDS.northwind);
    const ours = await northwind.getIssueByKey("WEB-12");
    expect(ours.projectId).toBe(MOCK_PROJECT_IDS.web);

    const priya = browser().open().api;
    await signedIn(priya, "priya@example.com");
    await priya.enterCompany(MOCK_TENANT_IDS.globex);
    const theirs = await priya.getIssueByKey("WEB-12");
    expect(theirs.projectId).toBe(MOCK_TENANT_PROJECT_IDS.globexWeb);
    expect(theirs.summary).not.toBe(ours.summary);

    // Anna in Globex is not on its WEB: the key does not open Northwind's issue there.
    const globex = open().api;
    await globex.enterCompany(MOCK_TENANT_IDS.globex);
    const refused = await caught(globex.getIssueByKey("WEB-12"));
    expect(apiErrorFacts(refused).code).toBe("PERMISSION_DENIED");
  });
});

describe("the session check in front of every data call (B7)", () => {
  it("a company route with the account's session is 400 TENANT_REQUIRED; the account's own routes take it", async () => {
    const { open } = browser();
    const { api } = open();
    await signedIn(api, "anna@example.com");
    await expect(api.listProjects()).rejects.toMatchObject({ status: 400, code: "TENANT_REQUIRED" });
    await expect(api.getCurrentUser()).resolves.toMatchObject({ id: MOCK_ACCOUNT_IDS.anna });
  });

  it("the company-session commands refuse a company session (403)", async () => {
    const local = new MemoryStorage();
    const server = new MockTenantServer({ storage: local, accountStore: new MockTaskaStore(), latencyMs: 0 });
    const transport = server.transport();
    const account = (await transport.startWebSession({ email: "anna@example.com", password: "x" }, crypto.randomUUID())) as {
      accessToken: string;
    };
    const company = (await transport.createTenantSession(account.accessToken, MOCK_TENANT_IDS.northwind, crypto.randomUUID())) as {
      accessToken: string;
      tenantId: string;
      sessionId: string;
    };
    expect(company.tenantId).toBe(MOCK_TENANT_IDS.northwind);
    await expect(transport.listTenants(company.accessToken, {}, new AbortController().signal)).rejects.toMatchObject({
      status: 403,
      code: "SCOPE_DENIED",
    });
    await expect(
      transport.createTenantSession(company.accessToken, MOCK_TENANT_IDS.globex, crypto.randomUUID()),
    ).rejects.toMatchObject({ status: 403 });
    // Revoking an id that is not the reader's session: the blueprint's 404 (PR #288 answers 401).
    await expect(
      transport.revokeTenantSession(account.accessToken, "9e0e2a4c-1b3d-4e5f-8a7b-9c0d1e2f3a4b", crypto.randomUUID()),
    ).rejects.toMatchObject({ status: 404, code: "RESOURCE_NOT_FOUND" });
    await expect(transport.revokeTenantSession(account.accessToken, company.sessionId, crypto.randomUUID())).resolves.toBeUndefined();
    await expect(transport.revokeTenantSession(account.accessToken, company.sessionId, crypto.randomUUID())).resolves.toBeUndefined();
  });

  it("a refresh token is single use: the same key replays within 60 s, 409 after, and another key revokes the family", async () => {
    let clock = Date.parse("2026-11-04T10:00:00Z");
    const local = new MemoryStorage();
    const server = new MockTenantServer({ storage: local, accountStore: new MockTaskaStore(), latencyMs: 0, now: () => clock });
    const transport = server.transport();
    const account = (await transport.startWebSession({ email: "anna@example.com", password: "x" }, crypto.randomUUID())) as {
      accessToken: string;
      refreshToken: string;
    };
    const company = (await transport.createTenantSession(account.accessToken, MOCK_TENANT_IDS.northwind, crypto.randomUUID())) as {
      accessToken: string;
    };
    const key = crypto.randomUUID();
    const rotated = await transport.refreshWebSession(account.refreshToken, key);
    expect(rotated).not.toHaveProperty("tenantId");
    await expect(transport.refreshWebSession(account.refreshToken, key)).resolves.toEqual(rotated);
    clock += 61_000;
    await expect(transport.refreshWebSession(account.refreshToken, key)).rejects.toMatchObject({ status: 409, code: "INVALID_STATE" });
    await expect(transport.refreshWebSession(account.refreshToken, crypto.randomUUID())).rejects.toMatchObject({
      status: 401,
      code: "TOKEN_REVOKED",
    });
    // The family is gone: the account session and the company session under it.
    const revoked = await caught(
      server.serve(company.accessToken, "tenant-read", "listProjects", async (store) => store.listProjects()),
    );
    expect(refusalCode(revoked)).toBe("TOKEN_REVOKED");
  });

  it("a paused company reads, and refuses every write with READ_ONLY and its restriction — without closing", async () => {
    const { open } = browser();
    const { api } = open();
    await signedIn(api, "anna@example.com");
    const closed: WorkspaceClosedEvent[] = [];
    api.onWorkspaceClosed((event) => closed.push(event));
    await api.enterCompany(MOCK_TENANT_IDS.initech);
    expect(await projectKeys(api)).toEqual(["HLP"]);
    const refused = await caught(
      api.createIssue(MOCK_TENANT_PROJECT_IDS.initechHelpdesk, {
        summary: "Order toner",
        description: "",
        issueType: "TASK",
        priority: "LOW",
      }),
    );
    expect(apiErrorFacts(refused)).toMatchObject({ status: 403, code: "READ_ONLY", requestId: expect.any(String) });
    expect(refusalReasons(refused)).toEqual(["OWNER_PAUSE"]);
    expect(closed).toEqual([]);
    expect(api.currentWorkspace()?.tenantId).toBe(MOCK_TENANT_IDS.initech);
    // The reader's own notifications are not company data a pause stops.
    await expect(api.markAllNotificationsRead()).resolves.toEqual(expect.objectContaining({ updatedCount: expect.any(Number) }));
  });

  it("with the content-read flag off, a paused company's read closes it with its restriction (ask A2c)", async () => {
    const { open, local } = browser();
    const { api } = open();
    await signedIn(api, "anna@example.com");
    local.setItem(MOCK_TENANT_HOOKS_KEY, JSON.stringify({ contentReadUnderRestriction: false }));
    const closed: WorkspaceClosedEvent[] = [];
    api.onWorkspaceClosed((event) => closed.push(event));
    await api.enterCompany(MOCK_TENANT_IDS.initech);
    await expect(api.listProjects()).rejects.toBeInstanceOf(WorkspaceClosedError);
    expect(closed.map((event) => [event.reason, event.reasons])).toEqual([["CAPABILITY_DISABLED", ["OWNER_PAUSE"]]]);
    // Northwind, with no restriction, reads as ever.
    await api.enterCompany(MOCK_TENANT_IDS.northwind);
    expect(await projectKeys(api)).toEqual(["MOB", "TAS", "WEB"]);
  });

  it("a suspended membership is refused at entry and not listed", async () => {
    const { open } = browser();
    const { api } = open();
    await signedIn(api, "anna@example.com");
    const refused = await caught(api.enterCompany(MOCK_TENANT_IDS.umbrella));
    expect(apiErrorFacts(refused)).toMatchObject({ status: 403, code: "MEMBERSHIP_INACTIVE" });
    expect(api.currentWorkspace()).toBeNull();
  });

  it("suspending Anna in Globex mid-session closes that tab with the reason; her Northwind tab is untouched", async () => {
    const { open, local } = browser();
    const northwind = open().api;
    await signedIn(northwind, "anna@example.com");
    await northwind.enterCompany(MOCK_TENANT_IDS.northwind);
    const globex = open().api;
    await globex.enterCompany(MOCK_TENANT_IDS.globex);
    const closed: WorkspaceClosedEvent[] = [];
    globex.onWorkspaceClosed((event) => closed.push(event));

    local.setItem(MOCK_TENANT_HOOKS_KEY, JSON.stringify({ suspend: [{ tenantId: MOCK_TENANT_IDS.globex, userId: MOCK_ACCOUNT_IDS.anna }] }));
    await expect(globex.listProjects()).rejects.toBeInstanceOf(WorkspaceClosedError);
    expect(closed).toEqual([
      {
        reason: "MEMBERSHIP_INACTIVE",
        tenantId: MOCK_TENANT_IDS.globex,
        tenantName: null,
        requestId: expect.any(String),
        reasons: [],
        message: "Membership is not active",
      },
    ]);
    expect(globex.currentWorkspace()).toBeNull();
    expect(await projectKeys(northwind)).toEqual(["MOB", "TAS", "WEB"]);
    expect(northwind.currentWorkspace()?.tenantId).toBe(MOCK_TENANT_IDS.northwind);
  });

  it("an access token that ran out is renewed and the call answered, without the reader noticing", async () => {
    let clock = Date.parse("2026-11-04T10:00:00Z");
    const { open, local } = browser(() => clock);
    local.setItem(MOCK_TENANT_HOOKS_KEY, JSON.stringify({ accessTtlSeconds: 60 }));
    const { api } = open();
    await signedIn(api, "anna@example.com");
    await api.enterCompany(MOCK_TENANT_IDS.northwind);
    clock += 61_000;
    expect(await projectKeys(api)).toEqual(["MOB", "TAS", "WEB"]);
    clock += 61_000;
    await expect(api.listTenants({ limit: 100 })).resolves.toMatchObject({ items: expect.any(Array) });
  });

  it("delays a route by the hook's milliseconds", async () => {
    const { open, local } = browser();
    const { api } = open();
    await signedIn(api, "anna@example.com");
    local.setItem(MOCK_TENANT_HOOKS_KEY, JSON.stringify({ delayMs: { listTenants: 60 } }));
    const started = performance.now();
    await api.listTenants();
    expect(performance.now() - started).toBeGreaterThanOrEqual(50);
  });

  it("neither reads nor clears today's mock session key", () => {
    window.localStorage.setItem("taska.mockSession", "not-anybody");
    browser().open();
    expect(window.localStorage.getItem("taska.mockSession")).toBe("not-anybody");
    window.localStorage.removeItem("taska.mockSession");
  });

  it("a duplicated tab gets a session of its own from the server", async () => {
    const { open, local } = browser();
    const first = open();
    await signedIn(first.api, "anna@example.com");
    const original = await first.api.enterCompany(MOCK_TENANT_IDS.northwind);
    const duplicate = open(first.session.copy());
    const own = await duplicate.api.enterCompany(MOCK_TENANT_IDS.northwind);
    expect(own.tenantSessionId).not.toBe(original.tenantSessionId);
    expect(await projectKeys(duplicate.api)).toEqual(["MOB", "TAS", "WEB"]);
    expect(await projectKeys(first.api)).toEqual(["MOB", "TAS", "WEB"]);
    expect(local.getItem(WEB_SESSION_KEY)).not.toBeNull();
  });
});

describe("accounts without a company, and the administrator (§6)", () => {
  it("Nina signs in to an empty list", async () => {
    const { open } = browser();
    const { api } = open();
    await signedIn(api, "nina@example.com");
    await expect(api.listTenants()).resolves.toEqual({ items: [], nextCursor: null });
  });

  it("Mark, the GLOBAL_ADMIN, gets the emailed-code dead end and no session", async () => {
    const { open, local } = browser();
    const { api } = open();
    await expect(api.signIn({ email: "mark@example.com", password: "x" })).resolves.toEqual({
      status: "ADMIN_MFA_REQUIRED",
      requestId: null,
    });
    expect(api.hasSession()).toBe(false);
    expect(local.getItem(WEB_SESSION_KEY)).toBeNull();
  });

  it("a wrong account is the blueprint's 401, and stores nothing", async () => {
    const { open, local } = browser();
    const { api } = open();
    await expect(api.signIn({ email: "nobody@example.com", password: "x" })).rejects.toMatchObject({
      status: 401,
      code: "AUTHENTICATION_REQUIRED",
    });
    expect(local.getItem(WEB_SESSION_KEY)).toBeNull();
  });

  it("signing out ends the tab's company session on the server", async () => {
    const { open } = browser();
    const { api } = open();
    await signedIn(api, "anna@example.com");
    await api.enterCompany(MOCK_TENANT_IDS.northwind);
    const expired = vi.fn();
    api.onSessionExpired(expired);
    await api.logout();
    expect(api.hasSession()).toBe(false);
    expect(api.currentWorkspace()).toBeNull();
    expect(expired).not.toHaveBeenCalled();
  });
});
