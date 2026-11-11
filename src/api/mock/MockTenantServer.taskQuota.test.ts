import { describe, expect, it } from "vitest";
import { MemoryStorage } from "../../test/memoryStorage";
import { apiErrorFacts, refusalCode, refusalReasons, isProjectArchived } from "../errors";
import { createLocalLockManager } from "../webSession";
import { MOCK_PROJECT_IDS, MockTaskaStore } from "./MockTaskaApi";
import {
  MOCK_PLAN_IDS,
  MOCK_SERVER_KEY,
  MOCK_TENANT_HOOKS_KEY,
  MOCK_TENANT_IDS,
  MOCK_TENANT_PROJECT_IDS,
  MockTenantServer,
} from "./MockTenantServer";
import { MOCK_COMPANY_ROUTES, createCompaniesMockApi } from "./mockCompanies";

/*
 * The companies mock's project issue counter and the create's key (TAS-528,
 * api-contract-guard §6): the task-quota route, its order of checks and its
 * exact answer; the counter it reads is the one a new issue is checked
 * against; a new issue replayed by its key counts nothing; an archived project
 * at its limit answers the archive first (M2); and the hooks.
 */

const NW = MOCK_TENANT_IDS.northwind;
const UM = MOCK_TENANT_IDS.umbrella;
const IN = MOCK_TENANT_IDS.initech;
const LN = MOCK_TENANT_IDS.longName;
const GX = MOCK_TENANT_IDS.globex;

const key = () => crypto.randomUUID();
const caught = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error("expected a refusal");
    },
    (error: unknown) => error,
  );
const facts = (error: unknown) => ({ status: apiErrorFacts(error).status, code: refusalCode(error), reasons: [...refusalReasons(error)] });
const issue = { summary: "One more", description: "", issueType: "TASK", priority: "LOW" } as const;

function browser() {
  const local = new MemoryStorage();
  const open = () =>
    createCompaniesMockApi({ local, session: new MemoryStorage(), locks: createLocalLockManager(), events: null, latencyMs: 0, ownershipWaitMs: 25 });
  const hooks = (value: Record<string, unknown>) => local.setItem(MOCK_TENANT_HOOKS_KEY, JSON.stringify(value));
  const stored = () => JSON.parse(local.getItem(MOCK_TENANT_HOOKS_KEY) ?? "{}") as Record<string, unknown>;
  return { local, open, hooks, stored };
}

async function inCompany(email: string, tenantId: string, setup?: (hooks: (value: Record<string, unknown>) => void) => void) {
  const { local, open, hooks, stored } = browser();
  setup?.(hooks);
  const api = open();
  await api.signIn({ email, password: "x" });
  await api.enterCompany(tenantId);
  return { api, local, hooks, stored };
}

/** The server's raw route over the same storage — the exact wire answer, and the checks the session layer never lets through. */
async function raw(local: MemoryStorage, email: string, tenantId?: string) {
  const server = new MockTenantServer({ storage: local, accountStore: new MockTaskaStore(), latencyMs: 0 });
  const transport = server.transport();
  const account = (await transport.startWebSession({ email, password: "x" }, key())) as { accessToken: string };
  const company = tenantId ? ((await transport.createTenantSession(account.accessToken, tenantId, key())) as { accessToken: string }) : null;
  return { transport, account: account.accessToken, company: company?.accessToken ?? null };
}

const signal = () => new AbortController().signal;

describe("the route (§6 rule 1)", () => {
  it("getProjectTaskQuota is the session layer's, as for the REST leg", () => {
    expect(MOCK_COMPANY_ROUTES.getProjectTaskQuota).toBe("session");
  });
});

describe("the answer (§6 rules 2–4)", () => {
  it("exactly the blueprint's QuotaUsage: kind, projectId, used, reserved, limit, unlimited, version — nothing else", async () => {
    const { local } = browser();
    const { transport, company } = await raw(local, "anna@example.com", NW);
    const answer = await transport.getProjectTaskQuota(company, NW, MOCK_PROJECT_IDS.taska, signal());
    expect(answer).toEqual({ kind: "TASK_LIFETIME", projectId: MOCK_PROJECT_IDS.taska, used: "47", reserved: "0", limit: "50", unlimited: false, version: "48" });
    expect(Object.keys(answer as object)).toEqual(["kind", "projectId", "used", "reserved", "limit", "unlimited", "version"]);
  });

  it("an unlimited plan: no limit key at all — Umbrella's RND at 50", async () => {
    const { local } = browser();
    const { transport, company } = await raw(local, "tom@example.com", UM);
    const answer = await transport.getProjectTaskQuota(company, UM, MOCK_TENANT_PROJECT_IDS.umbrellaResearch, signal());
    expect(answer).toEqual({ kind: "TASK_LIFETIME", projectId: MOCK_TENANT_PROJECT_IDS.umbrellaResearch, used: "50", reserved: "0", unlimited: true, version: "51" });
    expect(answer).not.toHaveProperty("limit");
  });

  it("the session layer narrows it: kind checked and dropped, reserved and version never kept", async () => {
    const { api } = await inCompany("anna@example.com", NW);
    await expect(api.getProjectTaskQuota(NW, MOCK_PROJECT_IDS.web)).resolves.toEqual({
      projectId: MOCK_PROJECT_IDS.web,
      used: "50",
      limit: "50",
      unlimited: false,
    });
  });

  it("used is the counter a new issue is checked against: TAS 47 → one create → 48; a refused create moves nothing", async () => {
    const { api } = await inCompany("anna@example.com", NW);
    await api.createIssue(MOCK_PROJECT_IDS.taska, issue, key());
    await expect(api.getProjectTaskQuota(NW, MOCK_PROJECT_IDS.taska)).resolves.toMatchObject({ used: "48" });
    expect(refusalCode(await caught(api.createIssue(MOCK_PROJECT_IDS.web, issue, key())))).toBe("QUOTA_EXCEEDED");
    await expect(api.getProjectTaskQuota(NW, MOCK_PROJECT_IDS.web)).resolves.toMatchObject({ used: "50" });
  });

  it("never down: deleting an issue frees nothing; a project that created none reads 0", async () => {
    const { api } = await inCompany("anna@example.com", NW);
    const made = await api.createIssue(MOCK_PROJECT_IDS.mob, issue, key());
    await api.deleteIssue(MOCK_PROJECT_IDS.mob, made.id);
    await expect(api.getProjectTaskQuota(NW, MOCK_PROJECT_IDS.mob)).resolves.toMatchObject({ used: "13" });
    // A new project (in Umbrella: Northwind is at its project limit) has created none.
    const umbrella = await inCompany("tom@example.com", UM);
    const created = await umbrella.api.createProject({ projectKey: "NEW", name: "New one" });
    await expect(umbrella.api.getProjectTaskQuota(UM, created.id)).resolves.toMatchObject({ used: "0", unlimited: true });
  });

  it("an archived project answers, its counter as it was", async () => {
    const { api } = await inCompany("anna@example.com", NW);
    await api.archiveProject(MOCK_PROJECT_IDS.mob);
    await expect(api.getProjectTaskQuota(NW, MOCK_PROJECT_IDS.mob)).resolves.toMatchObject({ used: "12", limit: "50" });
  });

  it("the taskLifetime hook sets what it reads", async () => {
    const { api } = await inCompany("anna@example.com", NW, (set) => set({ taskLifetime: { [MOCK_PROJECT_IDS.taska]: 49 } }));
    await expect(api.getProjectTaskQuota(NW, MOCK_PROJECT_IDS.taska)).resolves.toMatchObject({ used: "49" });
  });
});

describe("who reads (§6 rule 1, §1)", () => {
  it("a VIEWER of the project reads it — Tom on TAS", async () => {
    const { api } = await inCompany("tom@example.com", NW);
    await expect(api.getProjectTaskQuota(NW, MOCK_PROJECT_IDS.taska)).resolves.toMatchObject({ used: "47" });
  });

  it("a project the reader is not on, and another company's project, are the same concealed 404 — the company stays open", async () => {
    const { api } = await inCompany("tom@example.com", NW);
    const closed: unknown[] = [];
    api.onWorkspaceClosed((event) => closed.push(event));
    expect(facts(await caught(api.getProjectTaskQuota(NW, MOCK_PROJECT_IDS.web)))).toEqual({ status: 404, code: "RESOURCE_NOT_FOUND", reasons: [] });
    expect(facts(await caught(api.getProjectTaskQuota(NW, MOCK_TENANT_PROJECT_IDS.globexWeb)))).toEqual({ status: 404, code: "RESOURCE_NOT_FOUND", reasons: [] });
    expect(closed).toEqual([]);
    expect(api.currentWorkspace()).toMatchObject({ tenantId: NW });
  });

  it("a company admin reads every project of the company — Priya on LNG", async () => {
    const { api } = await inCompany("priya@example.com", LN);
    await expect(api.getProjectTaskQuota(LN, MOCK_TENANT_PROJECT_IDS.longNameProject)).resolves.toMatchObject({ used: "64" });
  });

  it("the raw checks: no bearer 401, the account's session 400 TENANT_REQUIRED, another company's 403 TENANT_MISMATCH, a project id that is not a UUID 400", async () => {
    const { local } = browser();
    const { transport, account, company } = await raw(local, "anna@example.com", NW);
    const project = MOCK_PROJECT_IDS.taska;
    expect(facts(await caught(transport.getProjectTaskQuota(null, NW, project, signal())))).toMatchObject({ status: 401, code: "AUTHENTICATION_REQUIRED" });
    expect(facts(await caught(transport.getProjectTaskQuota(account, NW, project, signal())))).toMatchObject({ status: 400, code: "TENANT_REQUIRED" });
    expect(facts(await caught(transport.getProjectTaskQuota(company, GX, project, signal())))).toMatchObject({ status: 403, code: "TENANT_MISMATCH" });
    expect(facts(await caught(transport.getProjectTaskQuota(company, NW, "not-a-uuid", signal())))).toMatchObject({ status: 400, code: "VALIDATION_FAILED" });
  });
});

describe("the lifecycle and restriction gates (§6 rule 5)", () => {
  it("never refused for OVER_QUOTA: LNG moved to FREE reads 64 of 50 — and its create is READ_ONLY [OVER_QUOTA]", async () => {
    const { api } = await inCompany("priya@example.com", LN, (set) => set({ applyPlan: { [LN]: MOCK_PLAN_IDS.free } }));
    await expect(api.getProjectTaskQuota(LN, MOCK_TENANT_PROJECT_IDS.longNameProject)).resolves.toEqual({
      projectId: MOCK_TENANT_PROJECT_IDS.longNameProject,
      used: "64",
      limit: "50",
      unlimited: false,
    });
    expect(facts(await caught(api.createIssue(MOCK_TENANT_PROJECT_IDS.longNameProject, issue, key())))).toEqual({
      status: 403,
      code: "READ_ONLY",
      reasons: ["OVER_QUOTA"],
    });
  });

  it("never refused for a dispute or an ended paid period", async () => {
    const { api } = await inCompany("anna@example.com", NW, (set) => set({ paymentDispute: { [NW]: true } }));
    await expect(api.getTenant(NW)).resolves.toMatchObject({ restrictions: expect.arrayContaining(["PAYMENT_DISPUTE"]) });
    await expect(api.getProjectTaskQuota(NW, MOCK_PROJECT_IDS.taska)).resolves.toMatchObject({ used: "47" });
    const umbrella = await inCompany("tom@example.com", UM, (set) => set({ clockOffsetMs: 400 * 24 * 60 * 60_000 }));
    await expect(umbrella.api.getTenant(UM)).resolves.toMatchObject({ restrictions: expect.arrayContaining(["PAYMENT_EXPIRED"]) });
    await expect(umbrella.api.getProjectTaskQuota(UM, MOCK_TENANT_PROJECT_IDS.umbrellaResearch)).resolves.toMatchObject({ used: "50" });
  });

  it("a pause answers while content reads stay open, and is 403 CAPABILITY_DISABLED with its reasons when they close", async () => {
    const open = await inCompany("sofia@example.com", IN);
    await expect(open.api.getProjectTaskQuota(IN, MOCK_TENANT_PROJECT_IDS.initechHelpdesk)).resolves.toMatchObject({ used: "12" });
    const { local } = browser();
    local.setItem(MOCK_TENANT_HOOKS_KEY, JSON.stringify({ contentReadUnderRestriction: false }));
    const { transport, company } = await raw(local, "sofia@example.com", IN);
    expect(facts(await caught(transport.getProjectTaskQuota(company, IN, MOCK_TENANT_PROJECT_IDS.initechHelpdesk, signal())))).toEqual({
      status: 403,
      code: "CAPABILITY_DISABLED",
      reasons: ["OWNER_PAUSE"],
    });
  });

  it("a company still being set up is 409 INVALID_STATE; one awaiting its first payment 409 PAYMENT_PENDING [PENDING_FIRST_PAYMENT]", async () => {
    const { local } = browser();
    // Tom has not used his one FREE company: his new one is PROVISIONING for a while.
    const { transport, account } = await raw(local, "tom@example.com");
    const created = (await transport.createTenant(account, { name: "Fresh Co", planVersionId: MOCK_PLAN_IDS.free }, key())) as { tenant: { id: string } };
    const session = (await transport.createTenantSession(account, created.tenant.id, key())) as { accessToken: string };
    const provisioning = await caught(transport.getProjectTaskQuota(session.accessToken, created.tenant.id, MOCK_PROJECT_IDS.taska, signal()));
    expect(facts(provisioning)).toMatchObject({ status: 409, code: "INVALID_STATE" });

    const stark = await raw(local, "tom@example.com", MOCK_TENANT_IDS.stark);
    const pending = await caught(stark.transport.getProjectTaskQuota(stark.company, MOCK_TENANT_IDS.stark, MOCK_PROJECT_IDS.taska, signal()));
    expect(facts(pending)).toEqual({ status: 409, code: "PAYMENT_PENDING", reasons: ["PENDING_FIRST_PAYMENT"] });
  });
});

describe("the hooks (§6 rule 6)", () => {
  it("refuseNext, loseAnswer and count take it", async () => {
    const { api, hooks, stored } = await inCompany("anna@example.com", NW);
    hooks({ refuseNext: { getProjectTaskQuota: { status: 503, code: "DEPENDENCY_UNAVAILABLE" } }, count: ["getProjectTaskQuota"] });
    expect(facts(await caught(api.getProjectTaskQuota(NW, MOCK_PROJECT_IDS.taska)))).toMatchObject({ status: 503, code: "DEPENDENCY_UNAVAILABLE" });
    hooks({ ...stored(), loseAnswer: ["getProjectTaskQuota"] });
    const lost = await caught(api.getProjectTaskQuota(NW, MOCK_PROJECT_IDS.taska));
    expect(lost).toBeInstanceOf(TypeError);
    expect(apiErrorFacts(lost).status).toBeNull();
    await expect(api.getProjectTaskQuota(NW, MOCK_PROJECT_IDS.taska)).resolves.toMatchObject({ used: "47" });
    expect(stored().calls).toEqual({ getProjectTaskQuota: 3 });
  });

});

describe("a new issue's key (§6 rule 8, H1)", () => {
  it("the same key with the same body answers the same issue and counts nothing; TAS stays one up", async () => {
    const { api } = await inCompany("anna@example.com", NW);
    const sent = key();
    const first = await api.createIssue(MOCK_PROJECT_IDS.taska, issue, sent);
    const again = await api.createIssue(MOCK_PROJECT_IDS.taska, { ...issue }, sent);
    expect(again.id).toBe(first.id);
    expect(again.issueKey).toBe(first.issueKey);
    await expect(api.getProjectTaskQuota(NW, MOCK_PROJECT_IDS.taska)).resolves.toMatchObject({ used: "48" });
    const page = await api.listIssues(MOCK_PROJECT_IDS.taska);
    expect(page.items.filter((item) => item.summary === "One more")).toHaveLength(1);
  });

  it("the same key with another body is 409 IDEMPOTENCY_CONFLICT and makes nothing", async () => {
    const { api } = await inCompany("anna@example.com", NW);
    const sent = key();
    await api.createIssue(MOCK_PROJECT_IDS.taska, issue, sent);
    expect(facts(await caught(api.createIssue(MOCK_PROJECT_IDS.taska, { ...issue, summary: "Another" }, sent)))).toEqual({
      status: 409,
      code: "IDEMPOTENCY_CONFLICT",
      reasons: [],
    });
    expect(facts(await caught(api.createIssue(MOCK_PROJECT_IDS.mob, issue, sent)))).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(api.getProjectTaskQuota(NW, MOCK_PROJECT_IDS.taska)).resolves.toMatchObject({ used: "48" });
  });

  it("a lost answer: the issue is made and counted; the retry with the same key answers it and counts nothing", async () => {
    const { api, hooks } = await inCompany("anna@example.com", NW, (set) => set({ taskLifetime: { [MOCK_PROJECT_IDS.taska]: 49 } }));
    hooks({ taskLifetime: { [MOCK_PROJECT_IDS.taska]: 49 }, loseAnswer: ["createIssue"] });
    const sent = key();
    const lost = await caught(api.createIssue(MOCK_PROJECT_IDS.taska, issue, sent));
    expect(apiErrorFacts(lost).status).toBeNull();
    // At the limit now — and the retry is still the same issue, not a refusal.
    await expect(api.getProjectTaskQuota(NW, MOCK_PROJECT_IDS.taska)).resolves.toMatchObject({ used: "50" });
    const retried = await api.createIssue(MOCK_PROJECT_IDS.taska, issue, sent);
    expect(retried.summary).toBe("One more");
    await expect(api.getProjectTaskQuota(NW, MOCK_PROJECT_IDS.taska)).resolves.toMatchObject({ used: "50" });
    // A new key is a new issue — and that one is over the limit.
    expect(refusalCode(await caught(api.createIssue(MOCK_PROJECT_IDS.taska, issue, key())))).toBe("QUOTA_EXCEEDED");
  });

  it("a refusal keeps no receipt: the same key after a refuseNext 503 makes the issue once", async () => {
    const { api, hooks } = await inCompany("anna@example.com", NW);
    hooks({ refuseNext: { createIssue: { status: 503, code: "DEPENDENCY_UNAVAILABLE" } } });
    const sent = key();
    expect(facts(await caught(api.createIssue(MOCK_PROJECT_IDS.taska, issue, sent)))).toMatchObject({ status: 503 });
    await expect(api.getProjectTaskQuota(NW, MOCK_PROJECT_IDS.taska)).resolves.toMatchObject({ used: "47" });
    await api.createIssue(MOCK_PROJECT_IDS.taska, issue, sent);
    await expect(api.getProjectTaskQuota(NW, MOCK_PROJECT_IDS.taska)).resolves.toMatchObject({ used: "48" });
  });

  it("the counter persists in the shared storage; the receipts do not (they are the page's, as its issues are)", async () => {
    const { api, local } = await inCompany("anna@example.com", NW);
    await api.createIssue(MOCK_PROJECT_IDS.mob, issue, key());
    const stored = local.getItem(MOCK_SERVER_KEY) ?? "";
    expect((JSON.parse(stored) as { taskLifetime: Record<string, { count: number }> }).taskLifetime[MOCK_PROJECT_IDS.mob].count).toBe(13);
    expect(stored).not.toContain("One more");
  });
});

describe("archived before the counter (M2)", () => {
  it("an archived project at its limit answers PROJECT_ARCHIVED, not QUOTA_EXCEEDED", async () => {
    const { api } = await inCompany("anna@example.com", NW);
    await api.archiveProject(MOCK_PROJECT_IDS.web);
    const refused = await caught(api.createIssue(MOCK_PROJECT_IDS.web, issue, key()));
    expect(isProjectArchived(refused)).toBe(true);
    expect(refusalCode(refused)).not.toBe("QUOTA_EXCEEDED");
  });
});
