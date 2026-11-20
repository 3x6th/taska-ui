import { describe, expect, it } from "vitest";
import { MemoryStorage } from "../../test/memoryStorage";
import { WorkspaceClosedError, apiErrorFacts, refusalCode, refusalReasons, refusalRetryAfter } from "../errors";
import type { TaskaApi, WorkspaceClosedEvent, WorkspacePendingEvent } from "../TaskaApi";
import { readAllPlans } from "../tenants";
import { createLocalLockManager } from "../webSession";
import { MOCK_ACCOUNT_IDS, MockTaskaStore } from "./MockTaskaApi";
import { MOCK_PLAN_IDS, MOCK_SERVER_KEY, MOCK_TENANT_HOOKS_KEY, MOCK_TENANT_IDS, MockTenantServer } from "./MockTenantServer";
import { MOCK_COMPANY_ROUTES, createCompaniesMockApi } from "./mockCompanies";

/*
 * The companies mock's creation (TAS-501, api-contract-guard §9; B2, B5): the
 * catalogue, the FREE ledger, durable creation receipts, the never-opened
 * company's refusals, the lifecycle clock and the hooks — each pinned the way
 * the guard asks the two implementations to agree.
 */

const DAY = 24 * 60 * 60_000;
const key = () => crypto.randomUUID();

function browser(now: () => number = Date.now) {
  const local = new MemoryStorage();
  const locks = createLocalLockManager();
  const open = (session = new MemoryStorage()) => ({
    api: createCompaniesMockApi({ local, session, locks, events: null, latencyMs: 0, ownershipWaitMs: 25, now }),
    session,
  });
  const hooks = (value: Record<string, unknown>) => local.setItem(MOCK_TENANT_HOOKS_KEY, JSON.stringify(value));
  return { local, open, hooks };
}

async function signedIn(api: TaskaApi, email: string) {
  await expect(api.signIn({ email, password: "x" })).resolves.toMatchObject({ status: "SIGNED_IN" });
}

const caught = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error("expected a refusal");
    },
    (error: unknown) => error,
  );

const tenantNames = async (api: TaskaApi) => (await api.listTenants({ limit: 100 })).items.map((tenant) => tenant.name);

describe("the catalogue", () => {
  it("is public, every state, and ends where nextCursor is absent", async () => {
    const { open } = browser();
    const { api } = open();
    // Signed out: the plans are PUBLIC_SAFE_METADATA.
    const plans = await readAllPlans((params) => api.listBillingPlans({ ...params, limit: 1 }));
    expect(plans.map((plan) => [plan.name, plan.state, plan.price?.amountMinor])).toEqual([
      ["Free", "PUBLISHED", "0"],
      ["Team", "RETIRED", "1500"],
      ["Team", "PUBLISHED", "2000"],
      // TAS-515 (B15): one cheaper than Team v1, one dearer than Team v2.
      ["Starter", "PUBLISHED", "1000"],
      ["Business", "PUBLISHED", "4000"],
    ]);
    await expect(api.listBillingPlans({ limit: 100 })).resolves.toMatchObject({ nextCursor: null });
    await expect(api.listBillingPlans({ limit: 0 })).rejects.toMatchObject({ status: 400, code: "VALIDATION_FAILED" });
  });
});

describe("creating (develop's order)", () => {
  it("FREE: PROVISIONING with no deadline, the reader its owner and admin, the ledger used — and ACTIVE once provisioned", async () => {
    let clock = Date.parse("2026-11-04T10:00:00Z");
    const { open } = browser(() => clock);
    const { api } = open();
    await signedIn(api, "nina@example.com");
    const { tenant, operation } = await api.createTenant({ name: "Acme", planVersionId: MOCK_PLAN_IDS.free }, key());
    expect(tenant).toMatchObject({ name: "Acme", ownerId: MOCK_ACCOUNT_IDS.nina, lifecycle: "PROVISIONING", restrictions: [], creationDeadline: null, version: "1" });
    // develop's answer: PENDING, updatedAt = createdAt (ask A12).
    expect(operation).toMatchObject({ type: "TENANT_PROVISION", state: "PENDING", tenantId: tenant.id });
    expect(operation.updatedAt).toBe(operation.createdAt);
    expect(await tenantNames(api)).toEqual(["Acme"]);

    await api.enterCompany(tenant.id);
    // Being set up, its content is not there yet: 409 INVALID_STATE, no reasons.
    const early = await caught(api.listProjects());
    expect(apiErrorFacts(early)).toMatchObject({ status: 409, code: "INVALID_STATE" });
    expect(refusalReasons(early)).toEqual([]);
    expect((await api.getTenantOperation(tenant.id, operation.id)).state).toBe("PENDING");
    clock += 1300;
    expect((await api.getTenantOperation(tenant.id, operation.id)).state).toBe("RUNNING");
    clock += 1300;
    const done = await api.getTenantOperation(tenant.id, operation.id);
    expect(done.state).toBe("SUCCEEDED");
    expect(done.updatedAt).not.toBe(done.createdAt);
    await expect(api.getTenant(tenant.id)).resolves.toMatchObject({ lifecycle: "ACTIVE", version: "2" });
    // An empty store: a new company has no projects.
    await expect(api.listProjects()).resolves.toEqual([]);

    // One FREE company per account.
    const second = await caught(api.createTenant({ name: "Acme Two", planVersionId: MOCK_PLAN_IDS.free }, key()));
    expect(apiErrorFacts(second)).toMatchObject({ status: 409, code: "FREE_ELIGIBILITY_USED" });
  });

  it("paid: AWAITING_PAYMENT with the 30-day deadline and PENDING_FIRST_PAYMENT; the ledger untouched", async () => {
    const clock = Date.parse("2026-11-04T10:00:00Z");
    const { open } = browser(() => clock);
    const { api } = open();
    await signedIn(api, "nina@example.com");
    const { tenant } = await api.createTenant({ name: "Stark Labs", planVersionId: MOCK_PLAN_IDS.team }, key());
    expect(tenant).toMatchObject({
      lifecycle: "AWAITING_PAYMENT",
      restrictions: ["PENDING_FIRST_PAYMENT"],
      creationDeadline: new Date(clock + 30 * DAY).toISOString(),
    });
    await expect(api.createTenant({ name: "Acme", planVersionId: MOCK_PLAN_IDS.free }, key())).resolves.toMatchObject({
      tenant: { lifecycle: "PROVISIONING" },
    });
  });

  it("the FREE allowance is by account: Anna's on Northwind, Priya's on Globex, Sofia's on a deleted, unlisted company; Tom has his", async () => {
    for (const [email, used] of [
      ["anna@example.com", true],
      ["priya@example.com", true],
      ["sofia@example.com", true],
      ["tom@example.com", false],
    ] as const) {
      const { open } = browser();
      const { api } = open();
      await signedIn(api, email);
      const answer = api.createTenant({ name: "Free Co", planVersionId: MOCK_PLAN_IDS.free }, key());
      if (used) await expect(answer, email).rejects.toMatchObject({ status: 409, code: "FREE_ELIGIBILITY_USED" });
      else await expect(answer, email).resolves.toMatchObject({ tenant: { lifecycle: "PROVISIONING" } });
    }
    // Sofia's list does not name Vandelay: nothing on screen could have said her FREE was used (B3).
    const { open } = browser();
    const { api } = open();
    await signedIn(api, "sofia@example.com");
    expect(await tenantNames(api)).not.toContain("Vandelay Industries");
  });

  it("refuses a name or a plan alike, 400 without violations; a key that is not a canonical UUID too", async () => {
    const { open } = browser();
    const { api } = open();
    await signedIn(api, "nina@example.com");
    for (const name of ["", " Acme", "Ac\u0007me", "x".repeat(121)]) {
      const refused = await caught(api.createTenant({ name, planVersionId: MOCK_PLAN_IDS.team }, key()));
      expect(apiErrorFacts(refused), JSON.stringify(name)).toMatchObject({ status: 400, code: "VALIDATION_FAILED" });
      expect((refused as { violations?: unknown }).violations).toBeUndefined();
    }
    for (const planVersionId of [MOCK_PLAN_IDS.teamRetired, "7d2c4e1a-5b3f-4a6c-9e8d-0f1a2b3c4dff"]) {
      await expect(api.createTenant({ name: "Acme", planVersionId }, key())).rejects.toMatchObject({ status: 400, code: "VALIDATION_FAILED" });
    }
    for (const bad of ["not-a-key", key().toUpperCase()]) {
      await expect(api.createTenant({ name: "Acme", planVersionId: MOCK_PLAN_IDS.team }, bad)).rejects.toMatchObject({
        status: 400,
        code: "VALIDATION_FAILED",
      });
    }
    expect(await tenantNames(api)).toEqual([]);
  });

  it("a company session asking to create is 403 SCOPE_DENIED at the server", async () => {
    const local = new MemoryStorage();
    const server = new MockTenantServer({ storage: local, accountStore: new MockTaskaStore(), latencyMs: 0 });
    const transport = server.transport();
    const account = (await transport.startWebSession({ email: "anna@example.com", password: "x" }, key())) as { accessToken: string };
    const company = (await transport.createTenantSession(account.accessToken, MOCK_TENANT_IDS.northwind, key())) as { accessToken: string };
    await expect(
      transport.createTenant(company.accessToken, { name: "Acme", planVersionId: MOCK_PLAN_IDS.team }, key()),
    ).rejects.toMatchObject({ status: 403, code: "SCOPE_DENIED" });
  });
});

describe("the same key (B2): a durable receipt, not the 60-second one", () => {
  it("the same key and body is the same company and operation — a day later too; another body is 409 IDEMPOTENCY_CONFLICT", async () => {
    let clock = Date.parse("2026-11-04T10:00:00Z");
    const { open, hooks } = browser(() => clock);
    const { api } = open();
    await signedIn(api, "nina@example.com");
    const sent = key();
    const first = await api.createTenant({ name: "Acme", planVersionId: MOCK_PLAN_IDS.team }, sent);
    // Two days on the session's clock; past the deadline on the lifecycle's.
    clock += 2 * DAY;
    hooks({ clockOffsetMs: 29 * DAY });
    const again = await api.createTenant({ name: "Acme", planVersionId: MOCK_PLAN_IDS.team }, sent);
    expect(again.tenant.id).toBe(first.tenant.id);
    expect(again.operation.id).toBe(first.operation.id);
    // The row as it is now (deadline passed: closed) — replays do not check the lifecycle.
    expect(again.tenant.lifecycle).toBe("AUTO_CLOSED");
    expect(again.operation.state).toBe("PENDING");
    await expect(api.createTenant({ name: "Acme Inc", planVersionId: MOCK_PLAN_IDS.team }, sent)).rejects.toMatchObject({
      status: 409,
      code: "IDEMPOTENCY_CONFLICT",
    });
    expect(await tenantNames(api)).toEqual(["Acme"]);
  });

  it("a lost answer commits: the replay with the same key finds the company, and there is one", async () => {
    const { open, hooks } = browser();
    const { api } = open();
    await signedIn(api, "nina@example.com");
    hooks({ loseAnswer: ["createTenant"] });
    const sent = key();
    const lost = await caught(api.createTenant({ name: "Twice Co", planVersionId: MOCK_PLAN_IDS.team }, sent));
    expect(apiErrorFacts(lost).status).toBeNull();
    const replay = await api.createTenant({ name: "Twice Co", planVersionId: MOCK_PLAN_IDS.team }, sent);
    expect(replay.tenant.name).toBe("Twice Co");
    expect(await tenantNames(api)).toEqual(["Twice Co"]);
  });

  it("a forced refusal is taken once, with its Retry-After", async () => {
    const { open, hooks, local } = browser();
    const { api } = open();
    await signedIn(api, "nina@example.com");
    hooks({ refuseNext: { createTenant: { status: 429, code: "RATE_LIMITED", retryAfterSeconds: 30 } } });
    const refused = await caught(api.createTenant({ name: "Acme", planVersionId: MOCK_PLAN_IDS.team }, key()));
    expect(apiErrorFacts(refused)).toMatchObject({ status: 429, code: "RATE_LIMITED", requestId: expect.any(String) });
    expect(refusalRetryAfter(refused)).toBe(30);
    expect(JSON.parse(local.getItem(MOCK_TENANT_HOOKS_KEY) as string)).toEqual({ refuseNext: {} });
    await expect(api.createTenant({ name: "Acme", planVersionId: MOCK_PLAN_IDS.team }, key())).resolves.toBeTruthy();
  });

  it("a deleted company's key is 404 TENANT_NOT_FOUND on replay", async () => {
    const { open, local } = browser();
    const { api } = open();
    await signedIn(api, "nina@example.com");
    const sent = key();
    const { tenant } = await api.createTenant({ name: "Gone Co", planVersionId: MOCK_PLAN_IDS.team }, sent);
    const state = JSON.parse(local.getItem(MOCK_SERVER_KEY) as string) as { tenants: { id: string; lifecycle: string }[] };
    state.tenants.find((item) => item.id === tenant.id)!.lifecycle = "DELETED";
    local.setItem(MOCK_SERVER_KEY, JSON.stringify(state));
    await expect(api.createTenant({ name: "Gone Co", planVersionId: MOCK_PLAN_IDS.team }, sent)).rejects.toMatchObject({
      status: 404,
      code: "TENANT_NOT_FOUND",
    });
  });
});

describe("a company that has never opened (B4, B5)", () => {
  it("awaiting payment refuses content 403 CAPABILITY_DISABLED whatever the global flag — without closing — and answers its own reads", async () => {
    for (const flag of [true, false]) {
      const { open, hooks } = browser();
      const { api } = open();
      await signedIn(api, "tom@example.com");
      hooks({ contentReadUnderRestriction: flag });
      const closed: WorkspaceClosedEvent[] = [];
      const pending: WorkspacePendingEvent[] = [];
      api.onWorkspaceClosed((event) => closed.push(event));
      api.onWorkspacePending((event) => pending.push(event));
      // The server admits the owner's session to a pending company (PR #288, ask A9).
      await api.enterCompany(MOCK_TENANT_IDS.stark);
      const refused = await caught(api.listProjects());
      expect(refusalCode(refused), String(flag)).toBe("CAPABILITY_DISABLED");
      expect(refusalReasons(refused)).toEqual(["PENDING_FIRST_PAYMENT"]);
      expect(pending.map((event) => event.reasons)).toEqual([["PENDING_FIRST_PAYMENT"]]);
      expect(closed).toEqual([]);
      expect(api.currentWorkspace()?.tenantId).toBe(MOCK_TENANT_IDS.stark);
      // Writes are READ_ONLY with the reason; the reader's own notifications still answer.
      await expect(api.createProject({ projectKey: "NEW", name: "New" })).rejects.toMatchObject({ status: 403, code: "READ_ONLY" });
      await expect(api.listNotifications()).resolves.toBeTruthy();
      // The company itself: read, and not stopped by the restriction.
      const stark = await api.getTenant(MOCK_TENANT_IDS.stark);
      expect(stark).toMatchObject({ name: "Stark Industries", ownerId: MOCK_ACCOUNT_IDS.tom, lifecycle: "AWAITING_PAYMENT" });
      const left = Date.parse(stark.creationDeadline as string) - Date.now();
      expect(left).toBeGreaterThan(9 * DAY);
      expect(left).toBeLessThan(11 * DAY);
    }
  });

  it("the company's own routes want that company's session: another's, or the account's, is 403 TENANT_MISMATCH", async () => {
    const { open } = browser();
    const { api } = open();
    await signedIn(api, "tom@example.com");
    await expect(api.getTenant(MOCK_TENANT_IDS.stark)).rejects.toMatchObject({ status: 403, code: "TENANT_MISMATCH" });
    await api.enterCompany(MOCK_TENANT_IDS.northwind);
    const closed: WorkspaceClosedEvent[] = [];
    api.onWorkspaceClosed((event) => closed.push(event));
    await expect(api.getTenant(MOCK_TENANT_IDS.stark)).rejects.toBeInstanceOf(WorkspaceClosedError);
    expect(closed.map((event) => event.reason)).toEqual(["TENANT_MISMATCH"]);
  });

  it("an operation of another company, or of another actor, is 404 RESOURCE_NOT_FOUND", async () => {
    const { open } = browser();
    const nina = open().api;
    await signedIn(nina, "nina@example.com");
    const mine = await nina.createTenant({ name: "Mine", planVersionId: MOCK_PLAN_IDS.team }, key());
    await nina.enterCompany(mine.tenant.id);
    await expect(nina.getTenantOperation(mine.tenant.id, crypto.randomUUID())).rejects.toMatchObject({ status: 404, code: "RESOURCE_NOT_FOUND" });
    await expect(nina.getTenantOperation(mine.tenant.id, mine.operation.id)).resolves.toMatchObject({ id: mine.operation.id });
  });

  it("cancel: the owner only, the lifecycle before the version, then «OWNER_CANCELLED» — and a replay of the key answers the same", async () => {
    const { open, hooks } = browser();
    const { api } = open();
    await signedIn(api, "tom@example.com");
    await api.enterCompany(MOCK_TENANT_IDS.stark);
    const stark = await api.getTenant(MOCK_TENANT_IDS.stark);
    await expect(api.cancelTenantCreation(MOCK_TENANT_IDS.stark, "0", key())).rejects.toMatchObject({ status: 412, code: "VERSION_CONFLICT" });
    hooks({ refuseNext: { cancelTenantCreation: { status: 409, code: "PAYMENT_PENDING" } } });
    await expect(api.cancelTenantCreation(MOCK_TENANT_IDS.stark, stark.version as string, key())).rejects.toMatchObject({
      code: "PAYMENT_PENDING",
    });
    const sent = key();
    const cancelled = await api.cancelTenantCreation(MOCK_TENANT_IDS.stark, stark.version as string, sent);
    expect(cancelled).toMatchObject({ lifecycle: "OWNER_CANCELLED", creationDeadline: stark.creationDeadline });
    expect(Number(cancelled.version)).toBe(Number(stark.version) + 1);
    await expect(api.cancelTenantCreation(MOCK_TENANT_IDS.stark, stark.version as string, sent)).resolves.toEqual(cancelled);
    // No longer pending: the lifecycle is checked before the (now stale) version.
    await expect(api.cancelTenantCreation(MOCK_TENANT_IDS.stark, stark.version as string, key())).rejects.toMatchObject({
      status: 409,
      code: "INVALID_STATE",
    });
  });

  it("cancel by a member who is not the owner is 403 OWNER_REQUIRED", async () => {
    const { open, local } = browser();
    const { api } = open();
    await signedIn(api, "tom@example.com");
    // Sofia joins Stark as an admin in the server's record.
    const state = JSON.parse(local.getItem(MOCK_SERVER_KEY) as string) as { memberships: unknown[] };
    state.memberships.push({ tenantId: MOCK_TENANT_IDS.stark, userId: MOCK_ACCOUNT_IDS.sofia, role: "TENANT_ADMIN", state: "ACTIVE", version: 1 });
    local.setItem(MOCK_SERVER_KEY, JSON.stringify(state));
    // Another account in the same browser.
    await api.logout();
    const other = open().api;
    await signedIn(other, "sofia@example.com");
    await other.enterCompany(MOCK_TENANT_IDS.stark);
    const stark = await other.getTenant(MOCK_TENANT_IDS.stark);
    await expect(other.cancelTenantCreation(MOCK_TENANT_IDS.stark, stark.version as string, key())).rejects.toMatchObject({
      status: 403,
      code: "OWNER_REQUIRED",
    });
  });

  it("Tom's list: Stark awaiting payment, Wayne cancelled, Massive closed past its deadline — closed ones refuse a session", async () => {
    const { open } = browser();
    const { api } = open();
    await signedIn(api, "tom@example.com");
    const page = await api.listTenants({ limit: 100 });
    const byName = Object.fromEntries(page.items.map((tenant) => [tenant.name, tenant]));
    expect(byName["Stark Industries"]).toMatchObject({ lifecycle: "AWAITING_PAYMENT", restrictions: ["PENDING_FIRST_PAYMENT"] });
    expect(byName["Wayne Enterprises"]).toMatchObject({ lifecycle: "OWNER_CANCELLED", creationDeadline: expect.any(String) });
    expect(byName["Massive Dynamic"]).toMatchObject({ lifecycle: "AUTO_CLOSED", creationDeadline: "2026-06-05T09:00:00Z" });
    await expect(api.enterCompany(MOCK_TENANT_IDS.wayne)).rejects.toMatchObject({ status: 409, code: "INVALID_STATE" });
  });
});

describe("the lifecycle clock and the payment hooks (evaluated on every read, no timers)", () => {
  it("a passed deadline closes the company; a late confirmation reopens it (D216), never a cancelled one", async () => {
    const { open, hooks } = browser();
    const { api } = open();
    await signedIn(api, "tom@example.com");
    const lifecycle = async (name: string) => (await api.listTenants({ limit: 100 })).items.find((tenant) => tenant.name === name)?.lifecycle;
    hooks({ clockOffsetMs: 11 * DAY });
    expect(await lifecycle("Stark Industries")).toBe("AUTO_CLOSED");
    hooks({ clockOffsetMs: 11 * DAY, latePaymentConfirmed: [MOCK_TENANT_IDS.stark, MOCK_TENANT_IDS.wayne] });
    expect(await lifecycle("Stark Industries")).toBe("ACTIVE");
    expect(await lifecycle("Wayne Enterprises")).toBe("OWNER_CANCELLED");
    const stark = (await api.listTenants({ limit: 100 })).items.find((tenant) => tenant.name === "Stark Industries");
    expect(stark).toMatchObject({ restrictions: [], creationDeadline: null });
    // Opened: its content reads now.
    await api.enterCompany(MOCK_TENANT_IDS.stark);
    await expect(api.listProjects()).resolves.toEqual([]);
  });

  it("a confirmed first payment opens a company awaiting it", async () => {
    const { open, hooks } = browser();
    const { api } = open();
    await signedIn(api, "tom@example.com");
    hooks({ firstPaymentConfirmed: [MOCK_TENANT_IDS.stark] });
    expect((await api.listTenants({ limit: 100 })).items.find((tenant) => tenant.id === MOCK_TENANT_IDS.stark)?.lifecycle).toBe("ACTIVE");
  });

  it("a failed provisioning stays PROVISIONING with the operation's failure code", async () => {
    let clock = Date.parse("2026-11-04T10:00:00Z");
    const { open, hooks } = browser(() => clock);
    const { api } = open();
    await signedIn(api, "nina@example.com");
    hooks({ provisioning: { stepMs: 100, outcome: "FAILED", failureCode: "POLICY_NOT_CONFIGURED" } });
    const { tenant, operation } = await api.createTenant({ name: "Broken Co", planVersionId: MOCK_PLAN_IDS.free }, key());
    clock += 500;
    await api.enterCompany(tenant.id);
    await expect(api.getTenantOperation(tenant.id, operation.id)).resolves.toMatchObject({ state: "FAILED", failureCode: "POLICY_NOT_CONFIGURED" });
    await expect(api.getTenant(tenant.id)).resolves.toMatchObject({ lifecycle: "PROVISIONING" });
  });
});

describe("routes", () => {
  it("every creation method is the session layer's — its credential picked there, as for the REST leg", () => {
    for (const name of ["listBillingPlans", "createTenant", "getTenant", "getTenantOperation", "cancelTenantCreation", "onWorkspacePending"] as const) {
      expect(MOCK_COMPANY_ROUTES[name], name).toBe("session");
    }
  });
});
