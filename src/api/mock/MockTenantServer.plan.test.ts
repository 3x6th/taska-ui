import { describe, expect, it } from "vitest";
import { MemoryStorage } from "../../test/memoryStorage";
import { apiErrorFacts, refusalCode, refusalReasons } from "../errors";
import type { TaskaApi } from "../TaskaApi";
import { createLocalLockManager } from "../webSession";
import { MOCK_PROJECT_IDS, MockTaskaStore } from "./MockTaskaApi";
import {
  MOCK_INVITATION_IDS,
  MOCK_PLAN_IDS,
  MOCK_SERVER_KEY,
  MOCK_TENANT_HOOKS_KEY,
  MOCK_TENANT_IDS,
  MOCK_TENANT_PROJECT_IDS,
  MockTenantServer,
} from "./MockTenantServer";
import { MOCK_COMPANY_ROUTES, createCompaniesMockApi } from "./mockCompanies";

/*
 * The companies mock's plan, usage and restrictions (TAS-512,
 * api-contract-guard §5): the entitlement route and its order of checks, the
 * three quota rows, the lifetime issue counter and the create refusals, the
 * lifecycle clock's scheduled change and expiry, and the three new hooks.
 */

const NW = MOCK_TENANT_IDS.northwind;
const GX = MOCK_TENANT_IDS.globex;
const IN = MOCK_TENANT_IDS.initech;
const UM = MOCK_TENANT_IDS.umbrella;
const LN = MOCK_TENANT_IDS.longName;
const DAY = 24 * 60 * 60_000;

const key = () => crypto.randomUUID();
const caught = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error("expected a refusal");
    },
    (error: unknown) => error,
  );
const facts = (error: unknown) => ({ status: apiErrorFacts(error).status, code: refusalCode(error), reasons: [...refusalReasons(error)] });

function browser() {
  const local = new MemoryStorage();
  const locks = createLocalLockManager();
  const open = (session = new MemoryStorage()) =>
    createCompaniesMockApi({ local, session, locks, events: null, latencyMs: 0, ownershipWaitMs: 25 });
  const hooks = (value: Record<string, unknown>) => local.setItem(MOCK_TENANT_HOOKS_KEY, JSON.stringify(value));
  return { local, open, hooks };
}

async function inCompany(email: string, tenantId: string, setup?: (hooks: (value: Record<string, unknown>) => void) => void) {
  const { local, open, hooks } = browser();
  setup?.(hooks);
  const api = open();
  await api.signIn({ email, password: "x" });
  await api.enterCompany(tenantId);
  return { api, local, hooks };
}

/** The server's raw routes over the same storage — for the checks the session layer never lets through. */
async function raw(local: MemoryStorage, email: string, tenantId?: string) {
  const server = new MockTenantServer({ storage: local, accountStore: new MockTaskaStore(), latencyMs: 0 });
  const transport = server.transport();
  const account = (await transport.startWebSession({ email, password: "x" }, key())) as { accessToken: string };
  const company = tenantId ? ((await transport.createTenantSession(account.accessToken, tenantId, key())) as { accessToken: string }) : null;
  return { server, transport, account: account.accessToken, company: company?.accessToken ?? null };
}

const signal = () => new AbortController().signal;
const issue = { summary: "One more", description: "", issueType: "TASK", priority: "LOW" } as const;
const quotaRow = async (api: TaskaApi, tenantId: string, kind: string) =>
  (await api.getTenantQuotas(tenantId)).quotas.find((row) => row.kind === kind);

describe("the routes (§1)", () => {
  it("getEntitlement is the session layer's, as for the REST leg", () => {
    expect(MOCK_COMPANY_ROUTES.getEntitlement).toBe("session");
  });
});

describe("getEntitlement (§5)", () => {
  it("TAS-502's order: no bearer 401, the account session 400 TENANT_REQUIRED, a hook, a bad path 400, another company 403", async () => {
    const local = new MemoryStorage();
    const { transport, account, company } = await raw(local, "anna@example.com", NW);
    expect(facts(await caught(transport.getEntitlement(null, NW, signal())))).toMatchObject({ status: 401, code: "AUTHENTICATION_REQUIRED" });
    expect(facts(await caught(transport.getEntitlement(account, NW, signal())))).toMatchObject({ status: 400, code: "TENANT_REQUIRED" });
    local.setItem(MOCK_TENANT_HOOKS_KEY, JSON.stringify({ refuseNext: { getEntitlement: { status: 503, code: "DEPENDENCY_UNAVAILABLE" } } }));
    expect(facts(await caught(transport.getEntitlement(company, NW, signal())))).toMatchObject({ status: 503, code: "DEPENDENCY_UNAVAILABLE" });
    expect(facts(await caught(transport.getEntitlement(company, "not-a-uuid", signal())))).toMatchObject({ status: 400, code: "VALIDATION_FAILED" });
    expect(facts(await caught(transport.getEntitlement(company, GX, signal())))).toMatchObject({ status: 403, code: "TENANT_MISMATCH" });
  });

  it("the blueprint's whole answer on the wire — validUntil only while paid — and four fields of it kept", async () => {
    const local = new MemoryStorage();
    const { transport, company } = await raw(local, "tom@example.com", UM);
    const wire = (await transport.getEntitlement(company, UM, signal())) as Record<string, unknown>;
    expect(wire).toMatchObject({
      tenantId: UM,
      version: "1",
      planVersionId: MOCK_PLAN_IDS.teamRetired,
      restrictions: [],
      features: ["projects.basic"],
      validUntil: expect.any(String),
      validFrom: expect.any(String),
      issuedAt: expect.any(String),
    });
    const { api } = await inCompany("tom@example.com", UM);
    await expect(api.getEntitlement(UM)).resolves.toEqual({
      tenantId: UM,
      version: "1",
      planVersionId: MOCK_PLAN_IDS.teamRetired,
      limits: [
        { kind: "PROJECT", limit: "3", unlimited: false },
        { kind: "SEAT", limit: "25", unlimited: false },
        { kind: "STORAGE_BYTES", limit: "2000000000", unlimited: false },
        { kind: "TASK_LIFETIME", limit: null, unlimited: true },
      ],
    });
    const free = (await (await raw(local, "anna@example.com", NW)).transport.getEntitlement(
      (await raw(local, "anna@example.com", NW)).company,
      NW,
      signal(),
    )) as Record<string, unknown>;
    expect(free).not.toHaveProperty("validUntil");
  });

  it("any role reads it, and no restriction refuses it", async () => {
    const globex = await inCompany("anna@example.com", GX);
    await expect(globex.api.getEntitlement(GX)).resolves.toMatchObject({ planVersionId: MOCK_PLAN_IDS.free });
    const initech = await inCompany("anna@example.com", IN);
    await expect(initech.api.getEntitlement(IN)).resolves.toMatchObject({ planVersionId: MOCK_PLAN_IDS.team });
  });

  it("delayMs and loseAnswer take it too", async () => {
    const { api, hooks } = await inCompany("anna@example.com", NW);
    hooks({ loseAnswer: ["getEntitlement"] });
    expect(apiErrorFacts(await caught(api.getEntitlement(NW))).status).toBeNull();
    await expect(api.getEntitlement(NW)).resolves.toMatchObject({ tenantId: NW });
  });
});

describe("the quota snapshot (§5)", () => {
  it("SEAT, PROJECT and STORAGE_BYTES — Umbrella on Team v1: 3 + 1 of 25 seats, 1 of 3 projects, no bytes yet", async () => {
    const { api } = await inCompany("tom@example.com", UM);
    const snapshot = await api.getTenantQuotas(UM);
    expect(snapshot.quotas.map((row) => [row.kind, row.used, row.reserved, row.limit, row.unlimited])).toEqual([
      ["SEAT", "3", "1", "25", false],
      ["PROJECT", "1", "0", "3", false],
      ["STORAGE_BYTES", "0", "0", "2000000000", false],
    ]);
  });

  it("Northwind's three projects against a limit of 1 set no OVER_QUOTA (the platform's bypass, A46)", async () => {
    const { api } = await inCompany("anna@example.com", NW);
    expect(await quotaRow(api, NW, "PROJECT")).toMatchObject({ used: "3", limit: "1" });
    await expect(api.getTenant(NW)).resolves.toMatchObject({ restrictions: [] });
  });

  it("archived projects count, and an upload link holds its bytes until it is confirmed", async () => {
    const { api } = await inCompany("anna@example.com", NW);
    await api.archiveProject(MOCK_PROJECT_IDS.mob);
    expect(await quotaRow(api, NW, "PROJECT")).toMatchObject({ used: "3" });
    const issues = await api.listIssues(MOCK_PROJECT_IDS.web);
    const before = await quotaRow(api, NW, "STORAGE_BYTES");
    await api.createAttachmentUploadUrl(MOCK_PROJECT_IDS.web, issues.items[0].id, { fileName: "notes.pdf", contentType: "application/pdf", sizeBytes: 1500 });
    const after = await quotaRow(api, NW, "STORAGE_BYTES");
    expect(BigInt(after?.reserved ?? "0") - BigInt(before?.reserved ?? "0")).toBe(1500n);
    expect(after?.used).toBe(before?.used);
  });
});

describe("the task limit (§5, B5)", () => {
  it("Northwind's WEB at 50 refuses a new issue 422 QUOTA_EXCEEDED, no reasons — editing, moving and commenting go on", async () => {
    const { api } = await inCompany("anna@example.com", NW);
    expect(facts(await caught(api.createIssue(MOCK_PROJECT_IDS.web, issue, key())))).toEqual({ status: 422, code: "QUOTA_EXCEEDED", reasons: [] });
    const page = await api.listIssues(MOCK_PROJECT_IDS.web);
    const target = page.items[0];
    await expect(api.updateIssue(MOCK_PROJECT_IDS.web, target.id, { summary: "Still editable" }, target.version)).resolves.toBeTruthy();
    await expect(api.addComment(MOCK_PROJECT_IDS.web, target.id, "Still commentable")).resolves.toBeTruthy();
    // Not over the limit — exactly at it: nothing restricts the company.
    await expect(api.getTenant(NW)).resolves.toMatchObject({ restrictions: [] });
  });

  it("TAS takes three more, then 422 — and deleting one frees nothing; the counter is the server's, not the issue numbers", async () => {
    const { api } = await inCompany("anna@example.com", NW);
    const made = [];
    for (let left = 3; left > 0; left -= 1) made.push(await api.createIssue(MOCK_PROJECT_IDS.taska, issue, key()));
    expect(made).toHaveLength(3);
    expect(refusalCode(await caught(api.createIssue(MOCK_PROJECT_IDS.taska, issue, key())))).toBe("QUOTA_EXCEEDED");
    await api.deleteIssue(MOCK_PROJECT_IDS.taska, made[0].id);
    expect(refusalCode(await caught(api.createIssue(MOCK_PROJECT_IDS.taska, issue, key())))).toBe("QUOTA_EXCEEDED");
  });

  it("the restriction first, then the project's own check, then the counter", async () => {
    const { api, hooks } = await inCompany("anna@example.com", NW, (set) => set({ platformBlock: { [NW]: true } }));
    expect(facts(await caught(api.createIssue(MOCK_PROJECT_IDS.web, issue, key())))).toEqual({ status: 403, code: "READ_ONLY", reasons: ["PLATFORM_BLOCK"] });
    hooks({ platformBlock: { [NW]: false }, taskLifetime: { [MOCK_TENANT_PROJECT_IDS.globexWeb]: 50 } });
    // Globex's WEB is at its limit — and it is not Northwind's: the project check answers first.
    expect(apiErrorFacts(await caught(api.createIssue(MOCK_TENANT_PROJECT_IDS.globexWeb, issue, key()))).code).toBe("NOT_FOUND");
  });

  it("a paid plan without a task limit: Umbrella's RND at 50 takes more", async () => {
    const { api } = await inCompany("tom@example.com", UM);
    await expect(api.createIssue(MOCK_TENANT_PROJECT_IDS.umbrellaResearch, issue, key())).resolves.toMatchObject({ issueKey: "RND-1" });
  });

  it("the counters live in the shared storage", async () => {
    const { api, local } = await inCompany("anna@example.com", NW);
    await api.createIssue(MOCK_PROJECT_IDS.mob, issue, key());
    const stored = JSON.parse(local.getItem(MOCK_SERVER_KEY) ?? "{}") as { taskLifetime: Record<string, { count: number }> };
    expect(stored.taskLifetime[MOCK_PROJECT_IDS.mob].count).toBe(13);
  });
});

describe("the other two create refusals (§5)", () => {
  it("a new project in Northwind (3 of 1) is 422 QUOTA_EXCEEDED; Initech's restriction answers before its quota", async () => {
    const northwind = await inCompany("anna@example.com", NW);
    expect(facts(await caught(northwind.api.createProject({ projectKey: "NEW", name: "New" })))).toEqual({ status: 422, code: "QUOTA_EXCEEDED", reasons: [] });
    const initech = await inCompany("sofia@example.com", IN);
    expect(facts(await caught(initech.api.createProject({ projectKey: "NEW", name: "New" })))).toMatchObject({ status: 403, code: "READ_ONLY" });
  });

  it("Nina's new FREE company: the first project is made, the second refused", async () => {
    const { local, open, hooks } = browser();
    hooks({ provisioning: { stepMs: 0 } });
    const api = open();
    await api.signIn({ email: "nina@example.com", password: "x" });
    const created = await api.createTenant({ name: "Acme", planVersionId: MOCK_PLAN_IDS.free }, key());
    await api.enterCompany(created.tenant.id);
    await expect(api.createProject({ projectKey: "ONE", name: "First" })).resolves.toMatchObject({ projectKey: "ONE" });
    expect(refusalCode(await caught(api.createProject({ projectKey: "TWO", name: "Second" })))).toBe("QUOTA_EXCEEDED");
    expect(local.getItem(MOCK_SERVER_KEY)).toContain("Acme");
  });

  it("an upload link is refused once used + reserved + its size would pass the storage limit", async () => {
    const local = new MemoryStorage();
    const { server, company } = await raw(local, "anna@example.com", NW);
    const issues = await server.serve(company, "tenant-read", "listIssues", async (store) => store.listIssues(MOCK_PROJECT_IDS.web));
    const target = issues.items[0].id;
    const input = { fileName: "big.pdf", contentType: "application/pdf", sizeBytes: 2_000_000 };
    const usage = async () => {
      const snapshot = (await server.transport().getTenantQuotas(company, NW, signal())) as { quotas: Array<{ kind: string; used: string; reserved: string }> };
      const row = snapshot.quotas.find((item) => item.kind === "STORAGE_BYTES");
      return BigInt(row?.used ?? "0") + BigInt(row?.reserved ?? "0");
    };
    const fits = (100_000_000n - (await usage())) / 2_000_000n;
    const ask = () =>
      server.serve(company, "tenant-write", "createAttachmentUploadUrl", async (store) => store.createAttachmentUploadUrl(MOCK_PROJECT_IDS.web, target, input), [
        MOCK_PROJECT_IDS.web,
        target,
        input,
      ]);
    for (let n = 0n; n < fits; n += 1n) await ask();
    expect(facts(await caught(ask()))).toEqual({ status: 422, code: "QUOTA_EXCEEDED", reasons: [] });
  });
});

describe("the lifecycle clock and the hooks (§5)", () => {
  it("Umbrella at its paid-through: Team v2 applies (seats 50, the entitlement moves, nothing announced) and the period ends", async () => {
    const { api, hooks } = await inCompany("tom@example.com", UM);
    const before = await api.getSubscription(UM);
    expect(before).toMatchObject({ planVersionId: MOCK_PLAN_IDS.teamRetired, scheduledPlanVersionId: MOCK_PLAN_IDS.team });
    expect(before.scheduledEffectiveAt).toBe(before.paidThrough);
    hooks({ clockOffsetMs: 45 * DAY + 60_000 });
    const after = await api.getSubscription(UM);
    expect(after).toMatchObject({ planVersionId: MOCK_PLAN_IDS.team, scheduledPlanVersionId: null, scheduledEffectiveAt: null, version: "3" });
    await expect(api.getEntitlement(UM)).resolves.toMatchObject({ planVersionId: MOCK_PLAN_IDS.team });
    expect(Number((await api.getEntitlement(UM)).version)).toBeGreaterThan(1);
    expect(await quotaRow(api, UM, "SEAT")).toMatchObject({ limit: "50" });
    await expect(api.getTenant(UM)).resolves.toMatchObject({ restrictions: ["PAYMENT_EXPIRED"] });
  });

  it("Initech at +32 days: PAYMENT_EXPIRED, and the entitlement version moves", async () => {
    const { api, hooks } = await inCompany("sofia@example.com", IN);
    expect((await api.getEntitlement(IN)).version).toBe("1");
    hooks({ clockOffsetMs: 32 * DAY + 60_000 });
    await expect(api.getTenant(IN)).resolves.toMatchObject({ restrictions: ["OWNER_PAUSE", "PAYMENT_EXPIRED"] });
    expect((await api.getEntitlement(IN)).version).toBe("2");
  });

  it("AC2: applyPlan moves the long-named company to FREE — its data kept, READ_ONLY with OVER_QUOTA, not a failed change", async () => {
    const { api, hooks } = await inCompany("priya@example.com", LN);
    await expect(api.getSubscription(LN)).resolves.toMatchObject({ renewalCancelled: true, paidThrough: expect.any(String) });
    hooks({ applyPlan: { [LN]: MOCK_PLAN_IDS.free } });
    await expect(api.getSubscription(LN)).resolves.toMatchObject({
      planVersionId: MOCK_PLAN_IDS.free,
      paidThrough: null,
      autopayState: "DISABLED",
      scheduledPlanVersionId: null,
    });
    await expect(api.getTenant(LN)).resolves.toMatchObject({ restrictions: ["OVER_QUOTA"] });
    expect(Number((await api.getEntitlement(LN)).version)).toBeGreaterThan(1);
    expect(await quotaRow(api, LN, "SEAT")).toMatchObject({ limit: "5" });
    // Readable, and every NORMAL write READ_ONLY with its reason.
    const page = await api.listIssues(MOCK_TENANT_PROJECT_IDS.longNameProject);
    expect(page.items.length).toBeGreaterThan(0);
    expect(facts(await caught(api.createIssue(MOCK_TENANT_PROJECT_IDS.longNameProject, issue, key())))).toEqual({
      status: 403,
      code: "READ_ONLY",
      reasons: ["OVER_QUOTA"],
    });
    // Applied once per value: read again, nothing moves.
    const version = (await api.getEntitlement(LN)).version;
    await api.getTenant(LN);
    expect((await api.getEntitlement(LN)).version).toBe(version);
  });

  it("OVER_QUOTA lifts once every breached kind is back within its limit — a counter set lower, an invitation revoked", async () => {
    const lifetime = await inCompany("priya@example.com", LN, (set) => set({ applyPlan: { [LN]: MOCK_PLAN_IDS.free } }));
    await expect(lifetime.api.getTenant(LN)).resolves.toMatchObject({ restrictions: ["OVER_QUOTA"] });
    lifetime.hooks({ applyPlan: { [LN]: MOCK_PLAN_IDS.free }, taskLifetime: { [MOCK_TENANT_PROJECT_IDS.longNameProject]: 40 } });
    await expect(lifetime.api.getTenant(LN)).resolves.toMatchObject({ restrictions: [] });

    // Umbrella with two more invitations holds 6 seats; FREE allows 5.
    const umbrella = await inCompany("tom@example.com", UM);
    for (const email of ["one@example.com", "two@example.com"]) {
      await umbrella.api.createTenantInvitation(UM, { email, role: "MEMBER", projectGrants: [] }, key());
    }
    umbrella.hooks({ applyPlan: { [UM]: MOCK_PLAN_IDS.free } });
    await expect(umbrella.api.getTenant(UM)).resolves.toMatchObject({ restrictions: ["OVER_QUOTA"] });
    const invitations = (await umbrella.api.listTenantInvitations(UM)).items;
    const lena = invitations.find((item) => item.id === MOCK_INVITATION_IDS.lena);
    await umbrella.api.revokeTenantInvitation(UM, MOCK_INVITATION_IDS.lena, lena?.version ?? "1", key());
    await expect(umbrella.api.getTenant(UM)).resolves.toMatchObject({ restrictions: [] });
  });

  it("paymentDispute sets and lifts PAYMENT_DISPUTE, moving both versions", async () => {
    const { api, hooks } = await inCompany("anna@example.com", NW);
    const tenant = await api.getTenant(NW);
    hooks({ paymentDispute: { [NW]: true } });
    const disputed = await api.getTenant(NW);
    expect(disputed.restrictions).toEqual(["PAYMENT_DISPUTE"]);
    expect(disputed.version).not.toBe(tenant.version);
    expect((await api.getEntitlement(NW)).version).toBe("2");
    expect(facts(await caught(api.createProject({ projectKey: "NEW", name: "New" })))).toMatchObject({ code: "READ_ONLY", reasons: ["PAYMENT_DISPUTE"] });
    hooks({ paymentDispute: { [NW]: false } });
    await expect(api.getTenant(NW)).resolves.toMatchObject({ restrictions: [] });
    expect((await api.getEntitlement(NW)).version).toBe("3");
  });

});
