import { describe, expect, it } from "vitest";
import { MemoryStorage } from "../../test/memoryStorage";
import { apiErrorFacts, refusalCode, refusalReasons, refusalViolations } from "../errors";
import type { TaskaApi, WorkspaceClosedEvent, WorkspaceRestrictedEvent } from "../TaskaApi";
import { readAllPages } from "../tenantMembers";
import { createLocalLockManager } from "../webSession";
import { MOCK_ACCOUNT_IDS, MockTaskaStore } from "./MockTaskaApi";
import { MOCK_PLAN_IDS, MOCK_SERVER_KEY, MOCK_TENANT_HOOKS_KEY, MOCK_TENANT_IDS, MockTenantServer } from "./MockTenantServer";
import { MOCK_COMPANY_ROUTES, createCompaniesMockApi } from "./mockCompanies";

/*
 * The companies mock's company page (TAS-504, api-contract-guard §6): the
 * subscriptions of the fixtures, the order of checks of the four commands,
 * each command's restriction rule, the platform's flags, paid periods ending
 * by the lifecycle clock, the durable receipts and their replay, and the
 * session rule B2 (a pause closes the projects, never the company).
 */

const { anna, sofia, tom, priya } = MOCK_ACCOUNT_IDS;
const NW = MOCK_TENANT_IDS.northwind;
const GX = MOCK_TENANT_IDS.globex;
const IN = MOCK_TENANT_IDS.initech;
const UM = MOCK_TENANT_IDS.umbrella;
const HO = MOCK_TENANT_IDS.hooli;
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

function browser(now?: () => number) {
  const local = new MemoryStorage();
  const locks = createLocalLockManager();
  const open = (session = new MemoryStorage()) =>
    createCompaniesMockApi({ local, session, locks, events: null, latencyMs: 0, ownershipWaitMs: 25, now });
  const hooks = (value: Record<string, unknown>) => local.setItem(MOCK_TENANT_HOOKS_KEY, JSON.stringify(value));
  return { local, open, hooks };
}

async function inCompany(email: string, tenantId: string, setup?: (hooks: (value: Record<string, unknown>) => void) => void) {
  const { local, open, hooks } = browser();
  setup?.(hooks);
  const api = open();
  await api.signIn({ email, password: "x" });
  await api.enterCompany(tenantId);
  return { api, local, open, hooks };
}

/** The server's raw routes over the same storage, for the checks the session layer would never let through. */
async function raw(local: MemoryStorage, email: string, tenantId?: string) {
  const transport = new MockTenantServer({ storage: local, accountStore: new MockTaskaStore(), latencyMs: 0 }).transport();
  const account = (await transport.startWebSession({ email, password: "x" }, key())) as { accessToken: string };
  const company = tenantId ? ((await transport.createTenantSession(account.accessToken, tenantId, key())) as { accessToken: string }) : null;
  return { transport, account: account.accessToken, company: company?.accessToken ?? null };
}

const versionOf = async (api: TaskaApi, tenantId: string) => (await api.getTenant(tenantId)).version as string;

describe("the routes (§1)", () => {
  it("every one of the five is the session layer's — its credential picked there, as for the REST leg", () => {
    for (const name of ["renameTenant", "pauseTenant", "resumeTenant", "transferTenantOwnership", "getSubscription", "onWorkspaceRestricted"] as const) {
      expect(MOCK_COMPANY_ROUTES[name], name).toBe("session");
    }
  });
});

describe("the fixtures' subscriptions (§6)", () => {
  it("are the owner's read only and never on the Tenant wire", async () => {
    const { api } = await inCompany("sofia@example.com", IN);
    const initech = await api.getTenant(IN);
    expect(initech).toMatchObject({ ownerId: sofia, restrictions: ["OWNER_PAUSE"] });
    const subscription = await api.getSubscription(IN);
    expect(subscription).toMatchObject({ tenantId: IN, planVersionId: MOCK_PLAN_IDS.team, autopayState: "CONSENTED", renewalCancelled: false });
    const left = Date.parse(subscription.paidThrough as string) - Date.now();
    expect(left).toBeGreaterThan(31 * DAY);
    expect(left).toBeLessThan(33 * DAY);
    const { transport, account } = await raw(new MemoryStorage(), "sofia@example.com");
    const page = (await transport.listTenants(account, {}, new AbortController().signal)) as { items: Record<string, unknown>[] };
    for (const tenant of page.items) expect(tenant).not.toHaveProperty("subscription");
  });

  it("Northwind and Globex are FREE: no paidThrough, autopay DISABLED; a member of Globex is refused the read", async () => {
    const { api, open } = await inCompany("anna@example.com", NW);
    await expect(api.getSubscription(NW)).resolves.toMatchObject({ planVersionId: MOCK_PLAN_IDS.free, paidThrough: null, autopayState: "DISABLED" });
    const globex = open();
    await globex.enterCompany(GX);
    expect(facts(await caught(globex.getSubscription(GX)))).toEqual({ status: 403, code: "OWNER_REQUIRED", reasons: [] });
  });

  it("Umbrella (Tom) +45 days, Hooli (Priya, blocked) +38, the long-named company (Priya) +50 — none expired at the seed", async () => {
    const umbrella = await inCompany("tom@example.com", UM);
    const days = async (api: TaskaApi, tenantId: string) =>
      Math.round((Date.parse((await api.getSubscription(tenantId)).paidThrough as string) - Date.now()) / DAY);
    expect(await days(umbrella.api, UM)).toBe(45);
    const hooli = await inCompany("priya@example.com", HO);
    expect(await days(hooli.api, HO)).toBe(38);
    await hooli.api.enterCompany(MOCK_TENANT_IDS.longName);
    expect(await days(hooli.api, MOCK_TENANT_IDS.longName)).toBe(50);
    await expect(hooli.api.getTenant(MOCK_TENANT_IDS.longName)).resolves.toMatchObject({ restrictions: [] });
  });
});

describe("the order of checks (§6)", () => {
  it("(1) no bearer 401, (2) the account session 400 TENANT_REQUIRED, (3) a hook before the path, (4) a bad path 400, another company 403", async () => {
    const local = new MemoryStorage();
    const { transport, account } = await raw(local, "anna@example.com");
    const { company } = await raw(local, "anna@example.com", GX);
    expect(facts(await caught(transport.renameTenant(null, NW, "X", "3", key())))).toMatchObject({ status: 401, code: "AUTHENTICATION_REQUIRED" });
    expect(facts(await caught(transport.renameTenant(account, NW, "X", "3", key())))).toMatchObject({ status: 400, code: "TENANT_REQUIRED" });
    local.setItem(MOCK_TENANT_HOOKS_KEY, JSON.stringify({ refuseNext: { pauseTenant: { status: 503, code: "DEPENDENCY_UNAVAILABLE" } } }));
    expect(facts(await caught(transport.pauseTenant(company, "not-a-uuid", "3", key())))).toMatchObject({ status: 503 });
    expect(facts(await caught(transport.pauseTenant(company, "not-a-uuid", "3", key())))).toMatchObject({ status: 400, code: "VALIDATION_FAILED" });
    expect(facts(await caught(transport.resumeTenant(company, NW, "3", key())))).toMatchObject({ status: 403, code: "TENANT_MISMATCH" });
  });

  it("(5) a deleted company 404, (6) one not ACTIVE 409, (7) a suspended caller 403 MEMBERSHIP_INACTIVE, (8) not the owner 403 OWNER_REQUIRED", async () => {
    const local = new MemoryStorage();
    const tom_ = await raw(local, "tom@example.com", MOCK_TENANT_IDS.stark);
    expect(facts(await caught(tom_.transport.renameTenant(tom_.company, MOCK_TENANT_IDS.stark, "Stark", "1", key())))).toMatchObject({
      status: 409,
      code: "INVALID_STATE",
    });
    const priya_ = await raw(local, "priya@example.com", UM);
    // Priya is an ACTIVE admin of Umbrella — and not its owner.
    for (const sent of [
      priya_.transport.renameTenant(priya_.company, UM, "U", "3", key()),
      priya_.transport.pauseTenant(priya_.company, UM, "3", key()),
      priya_.transport.resumeTenant(priya_.company, UM, "3", key()),
      priya_.transport.transferTenantOwnership(priya_.company, UM, priya, "3", key()),
    ]) {
      expect(facts(await caught(sent))).toEqual({ status: 403, code: "OWNER_REQUIRED", reasons: [] });
    }
    local.setItem(MOCK_TENANT_HOOKS_KEY, JSON.stringify({ suspend: [{ tenantId: UM, userId: priya }] }));
    expect(facts(await caught(priya_.transport.renameTenant(priya_.company, UM, "U", "3", key())))).toMatchObject({
      status: 403,
      code: "MEMBERSHIP_INACTIVE",
    });
    local.setItem(MOCK_TENANT_HOOKS_KEY, "{}");
    const state = JSON.parse(local.getItem(MOCK_SERVER_KEY) as string) as { tenants: { id: string; lifecycle: string }[] };
    state.tenants.find((item) => item.id === UM)!.lifecycle = "DELETED";
    local.setItem(MOCK_SERVER_KEY, JSON.stringify(state));
    expect(facts(await caught(priya_.transport.renameTenant(priya_.company, UM, "U", "3", key())))).toMatchObject({
      status: 404,
      code: "TENANT_NOT_FOUND",
    });
  });

  it("(9) the restriction before (10) the flag before (11) coverage before (12) the receipt before (13) the body before (14) the version", async () => {
    const { api, hooks } = await inCompany("priya@example.com", HO);
    // Blocked, flags off, a stale version and a recipient who is not a member: the block answers.
    hooks({ ownershipTransferEnabled: false, ownerPauseEnabled: false });
    expect(facts(await caught(api.transferTenantOwnership(HO, priya, "0", "not-a-key")))).toEqual({
      status: 403,
      code: "READ_ONLY",
      reasons: ["PLATFORM_BLOCK"],
    });
    // Umbrella (Tom, paid): the flag before the key and the body.
    const umbrella = await inCompany("tom@example.com", UM, (set) => set({ ownershipTransferEnabled: false }));
    expect(facts(await caught(umbrella.api.transferTenantOwnership(UM, tom, "0", "not-a-key")))).toEqual({
      status: 403,
      code: "CAPABILITY_DISABLED",
      reasons: [],
    });
    umbrella.hooks({});
    expect(facts(await caught(umbrella.api.transferTenantOwnership(UM, priya, "3", "not-a-key")))).toMatchObject({ status: 400, code: "VALIDATION_FAILED" });
    expect(facts(await caught(umbrella.api.transferTenantOwnership(UM, tom, "0", key())))).toMatchObject({ status: 409, code: "INVALID_STATE" });
    expect(facts(await caught(umbrella.api.transferTenantOwnership(UM, priya, "0", key())))).toMatchObject({ status: 412, code: "VERSION_CONFLICT" });
    // Northwind (FREE): coverage before the receipt and the body.
    const northwind = await inCompany("anna@example.com", NW);
    expect(facts(await caught(northwind.api.transferTenantOwnership(NW, sofia, "3", "not-a-key")))).toEqual({
      status: 409,
      code: "INVALID_STATE",
      reasons: [],
    });
  });

  it("(14) If-Match: missing 428, malformed 400, stale 412 — and nothing changes", async () => {
    const { api } = await inCompany("tom@example.com", UM);
    expect(facts(await caught(api.renameTenant(UM, "Umbrella Corp", "", key())))).toMatchObject({ status: 428, code: "VERSION_CONFLICT" });
    expect(facts(await caught(api.renameTenant(UM, "Umbrella Corp", "v3", key())))).toMatchObject({ status: 400, code: "VALIDATION_FAILED" });
    expect(facts(await caught(api.renameTenant(UM, "Umbrella Corp", "2", key())))).toMatchObject({ status: 412, code: "VERSION_CONFLICT" });
    await expect(api.getTenant(UM)).resolves.toMatchObject({ name: "Umbrella", version: "3" });
  });
});

describe("rename (TAS-333)", () => {
  it("the owner renames: the name and the version move together; the list and the tab's name follow", async () => {
    const { api } = await inCompany("anna@example.com", NW);
    const renamed = await api.renameTenant(NW, "Northwind Traders", "3", key());
    expect(renamed).toMatchObject({ id: NW, name: "Northwind Traders", version: "4", ownerId: anna });
    expect(api.currentWorkspace()?.tenantName).toBe("Northwind Traders");
    expect((await api.listTenants({ limit: 100 })).items.find((tenant) => tenant.id === NW)?.name).toBe("Northwind Traders");
    // The same name again is a 200 at the same version.
    await expect(api.renameTenant(NW, "Northwind Traders", "4", key())).resolves.toMatchObject({ version: "4" });
  });

  it("a name the shared rule refuses is 400 with a violation on name", async () => {
    const { api } = await inCompany("anna@example.com", NW);
    for (const name of ["", " Northwind", "North\u0007wind", "x".repeat(121)]) {
      const refused = await caught(api.renameTenant(NW, name, "3", key()));
      expect(facts(refused)).toMatchObject({ status: 400, code: "VALIDATION_FAILED" });
      expect(refusalViolations(refused).map((item) => item.field)).toEqual(["name"]);
    }
    await expect(api.renameTenant(NW, "x".repeat(120), "3", key())).resolves.toMatchObject({ name: "x".repeat(120) });
  });

  it("is refused under every restriction (NORMAL): the pause names itself, the block its own", async () => {
    const sofia_ = await inCompany("sofia@example.com", IN);
    expect(facts(await caught(sofia_.api.renameTenant(IN, "Initrode", "3", key())))).toEqual({ status: 403, code: "READ_ONLY", reasons: ["OWNER_PAUSE"] });
    const priya_ = await inCompany("priya@example.com", HO);
    expect(facts(await caught(priya_.api.renameTenant(HO, "Hooli XYZ", "3", key())))).toEqual({ status: 403, code: "READ_ONLY", reasons: ["PLATFORM_BLOCK"] });
  });
});

describe("pause and resume (TAS-480)", () => {
  it("the owner pauses and resumes; each moves the version once, and the paid period stays where it was", async () => {
    const { api } = await inCompany("tom@example.com", UM);
    const paidThrough = (await api.getSubscription(UM)).paidThrough;
    await expect(api.pauseTenant(UM, "3", key())).resolves.toMatchObject({ restrictions: ["OWNER_PAUSE"], version: "4" });
    // Already paused: a 200 at the same version (ask A34a).
    await expect(api.pauseTenant(UM, "4", key())).resolves.toMatchObject({ restrictions: ["OWNER_PAUSE"], version: "4" });
    await expect(api.resumeTenant(UM, "4", key())).resolves.toMatchObject({ restrictions: [], version: "5" });
    await expect(api.resumeTenant(UM, "5", key())).resolves.toMatchObject({ restrictions: [], version: "5" });
    expect((await api.getSubscription(UM)).paidThrough).toBe(paidThrough);
  });

  it("the owner's pause flag off refuses a new pause 403 CAPABILITY_DISABLED with no reasons — never a resume", async () => {
    const { api } = await inCompany("sofia@example.com", IN, (set) => set({ ownerPauseEnabled: false }));
    await expect(api.resumeTenant(IN, "3", key())).resolves.toMatchObject({ restrictions: [] });
    expect(facts(await caught(api.pauseTenant(IN, "4", key())))).toEqual({ status: 403, code: "CAPABILITY_DISABLED", reasons: [] });
  });

  it("the block refuses all four (OWNER_CONTROL, TRANSFER); lifting it with the platform's hook lets them through", async () => {
    const { api, hooks } = await inCompany("priya@example.com", HO);
    const sent = [
      () => api.renameTenant(HO, "Hooli XYZ", "3", key()),
      () => api.pauseTenant(HO, "3", key()),
      () => api.resumeTenant(HO, "3", key()),
      () => api.transferTenantOwnership(HO, sofia, "3", key()),
    ];
    for (const send of sent) expect(facts(await caught(send()))).toEqual({ status: 403, code: "READ_ONLY", reasons: ["PLATFORM_BLOCK"] });
    hooks({ platformBlock: { [HO]: false } });
    await expect(api.getTenant(HO)).resolves.toMatchObject({ restrictions: [], version: "4" });
    await expect(api.pauseTenant(HO, "4", key())).resolves.toMatchObject({ restrictions: ["OWNER_PAUSE"] });
  });

  it("a pause and a block are separate causes: resuming under a block is refused, and the block outlives the resume", async () => {
    const { api, hooks } = await inCompany("sofia@example.com", IN);
    hooks({ platformBlock: { [IN]: true } });
    const initech = await api.getTenant(IN);
    expect(initech).toMatchObject({ restrictions: ["PLATFORM_BLOCK", "OWNER_PAUSE"], version: "4" });
    expect(facts(await caught(api.resumeTenant(IN, "4", key())))).toEqual({ status: 403, code: "READ_ONLY", reasons: ["PLATFORM_BLOCK", "OWNER_PAUSE"] });
    hooks({ platformBlock: { [IN]: false } });
    await expect(api.resumeTenant(IN, "5", key())).resolves.toMatchObject({ restrictions: [], version: "6" });
  });

  it("past paidThrough the company gets PAYMENT_EXPIRED; resuming then lifts only the pause and extends nothing (D131)", async () => {
    const { api, hooks } = await inCompany("sofia@example.com", IN);
    const paidThrough = (await api.getSubscription(IN)).paidThrough;
    hooks({ clockOffsetMs: 33 * DAY });
    await expect(api.getTenant(IN)).resolves.toMatchObject({ restrictions: ["OWNER_PAUSE", "PAYMENT_EXPIRED"], version: "4" });
    await expect(api.resumeTenant(IN, "4", key())).resolves.toMatchObject({ restrictions: ["PAYMENT_EXPIRED"], version: "5" });
    expect((await api.getSubscription(IN)).paidThrough).toBe(paidThrough);
    // And it can no longer be handed over (TRANSFER refuses PAYMENT_EXPIRED).
    expect(facts(await caught(api.transferTenantOwnership(IN, anna, "5", key())))).toEqual({ status: 403, code: "READ_ONLY", reasons: ["PAYMENT_EXPIRED"] });
  });

  it("a lost pause is applied; the same key and version again replay its 200 (G7)", async () => {
    const { api, hooks } = await inCompany("tom@example.com", UM, (set) => set({ loseAnswer: ["pauseTenant"] }));
    const sent = key();
    const lost = await caught(api.pauseTenant(UM, "3", sent));
    expect(lost).toBeInstanceOf(TypeError);
    hooks({});
    await expect(api.pauseTenant(UM, "3", sent)).resolves.toMatchObject({ restrictions: ["OWNER_PAUSE"], version: "4" });
    // The same key with another request is a conflict.
    expect(facts(await caught(api.pauseTenant(UM, "4", sent)))).toMatchObject({ status: 409, code: "IDEMPOTENCY_CONFLICT" });
  });
});

describe("ownership transfer (TAS-473)", () => {
  it("Tom hands Umbrella to Priya: she owns it, he stays an admin, autopay is off, nobody's session is revoked", async () => {
    const { api, local } = await inCompany("tom@example.com", UM);
    const priya_ = await raw(local, "priya@example.com", UM);
    const transferred = await api.transferTenantOwnership(UM, priya, "3", key());
    expect(transferred).toMatchObject({ ownerId: priya, version: "4" });
    const rows = await readAllPages((params) => api.listTenantMembers(UM, params));
    expect(rows.filter((row) => row.state === "ACTIVE").map((row) => [row.userId, row.role, row.isOwner, row.version]).sort()).toEqual(
      [
        [tom, "TENANT_ADMIN", false, "2"],
        [priya, "TENANT_ADMIN", true, "2"],
      ].sort(),
    );
    // The old owner's session still works — as an admin who is not the owner.
    expect(facts(await caught(api.getSubscription(UM)))).toMatchObject({ status: 403, code: "OWNER_REQUIRED" });
    await expect(api.listProjects()).resolves.toBeTruthy();
    // The new owner's session too, and the subscription is hers now, autopay off.
    const subscription = (await priya_.transport.getSubscription(priya_.company, UM, new AbortController().signal)) as Record<string, unknown>;
    expect(subscription).toMatchObject({ autopayState: "DISABLED" });
    const state = JSON.parse(local.getItem(MOCK_SERVER_KEY) as string) as { tenants: { id: string; ownerVersion: string }[] };
    expect(state.tenants.find((item) => item.id === UM)?.ownerVersion).toBe("2");
  });

  it("a member becomes the owner and an admin; under the owner's own pause the transfer is allowed (D244)", async () => {
    const { api } = await inCompany("sofia@example.com", IN);
    await expect(api.transferTenantOwnership(IN, anna, "3", key())).resolves.toMatchObject({ ownerId: anna, restrictions: ["OWNER_PAUSE"] });
    const rows = await readAllPages((params) => api.listTenantMembers(IN, params));
    expect(rows.find((row) => row.userId === anna)).toMatchObject({ role: "TENANT_ADMIN", isOwner: true });
  });

  it("refused unchanged: FREE, a suspended recipient (never MEMBERSHIP_INACTIVE), a stranger, oneself", async () => {
    const free = await inCompany("anna@example.com", NW);
    expect(facts(await caught(free.api.transferTenantOwnership(NW, sofia, "3", key())))).toEqual({ status: 409, code: "INVALID_STATE", reasons: [] });
    await expect(free.api.getTenant(NW)).resolves.toMatchObject({ ownerId: anna, version: "3" });
    const { api } = await inCompany("tom@example.com", UM);
    const closed: WorkspaceClosedEvent[] = [];
    api.onWorkspaceClosed((event) => closed.push(event));
    expect(facts(await caught(api.transferTenantOwnership(UM, anna, "3", key())))).toEqual({ status: 409, code: "INVALID_STATE", reasons: [] });
    expect(facts(await caught(api.transferTenantOwnership(UM, MOCK_ACCOUNT_IDS.nina, "3", key())))).toMatchObject({ status: 404, code: "RESOURCE_NOT_FOUND" });
    expect(facts(await caught(api.transferTenantOwnership(UM, tom, "3", key())))).toMatchObject({ status: 409, code: "INVALID_STATE" });
    expect(closed).toEqual([]);
    await expect(api.getTenant(UM)).resolves.toMatchObject({ ownerId: tom, version: "3" });
  });

  it("a lost transfer is applied; its retry with the same key is refused 403 OWNER_REQUIRED — the access check comes first (ask A33)", async () => {
    const { api, hooks } = await inCompany("tom@example.com", UM, (set) => set({ loseAnswer: ["transferTenantOwnership"] }));
    const sent = key();
    expect(await caught(api.transferTenantOwnership(UM, priya, "3", sent))).toBeInstanceOf(TypeError);
    hooks({});
    expect(facts(await caught(api.transferTenantOwnership(UM, priya, "3", sent)))).toMatchObject({ status: 403, code: "OWNER_REQUIRED" });
    // Only a re-read says what happened.
    await expect(api.getTenant(UM)).resolves.toMatchObject({ ownerId: priya });
  });

  it("an ended paid period refuses it: the clock sets PAYMENT_EXPIRED, which the TRANSFER rule refuses", async () => {
    const { api, hooks } = await inCompany("tom@example.com", UM);
    hooks({ clockOffsetMs: 46 * DAY });
    // PAYMENT_EXPIRED is set on the next read of the server's state (version 4).
    expect(facts(await caught(api.transferTenantOwnership(UM, priya, "4", key())))).toEqual({ status: 403, code: "READ_ONLY", reasons: ["PAYMENT_EXPIRED"] });
  });
});

describe("a pause closes the projects, never the company (B2, G1, G5)", () => {
  for (const [email, role] of [
    ["sofia@example.com", "owner"],
    ["anna@example.com", "member"],
  ] as const) {
    it(`with the read flag off, the ${role}'s content read is refused and marks the tab; members, notifications and the company still answer`, async () => {
      const { api } = await inCompany(email, IN, (set) => set({ contentReadUnderRestriction: false }));
      const closed: WorkspaceClosedEvent[] = [];
      const restricted: WorkspaceRestrictedEvent[] = [];
      api.onWorkspaceClosed((event) => closed.push(event));
      api.onWorkspaceRestricted((event) => restricted.push(event));
      expect(facts(await caught(api.listProjects()))).toEqual({ status: 403, code: "CAPABILITY_DISABLED", reasons: ["OWNER_PAUSE"] });
      expect(facts(await caught(api.searchIssues({ query: "printer", pageSize: 8 })))).toMatchObject({ code: "CAPABILITY_DISABLED" });
      expect(restricted.map((event) => event.restricted)).toEqual([true, true]);
      await expect(readAllPages((params) => api.listTenantMembers(IN, params))).resolves.toHaveLength(2);
      await expect(api.listNotifications()).resolves.toBeTruthy();
      await expect(api.getTenant(IN)).resolves.toMatchObject({ restrictions: ["OWNER_PAUSE"] });
      expect(closed).toEqual([]);
      expect(api.currentWorkspace()?.tenantId).toBe(IN);
    });
  }

  it("with the read flag on, nothing is refused and nothing is marked", async () => {
    const { api } = await inCompany("anna@example.com", IN);
    const restricted: WorkspaceRestrictedEvent[] = [];
    api.onWorkspaceRestricted((event) => restricted.push(event));
    await expect(api.listProjects()).resolves.toHaveLength(1);
    expect(restricted).toEqual([]);
  });

  it("the owner's resume lifts the mark, and the projects answer again", async () => {
    const { api } = await inCompany("sofia@example.com", IN, (set) => set({ contentReadUnderRestriction: false }));
    const restricted: WorkspaceRestrictedEvent[] = [];
    api.onWorkspaceRestricted((event) => restricted.push(event));
    await caught(api.listProjects());
    await api.resumeTenant(IN, await versionOf(api, IN), key());
    expect(restricted.map((event) => event.restricted)).toEqual([true, false]);
    await expect(api.listProjects()).resolves.toHaveLength(1);
  });

  it("only a pause or a block closes content: an ended period alone leaves the projects readable with the flag off", async () => {
    const { api, hooks } = await inCompany("sofia@example.com", IN, (set) => set({ clockOffsetMs: 33 * DAY }));
    await api.resumeTenant(IN, await versionOf(api, IN), key());
    hooks({ clockOffsetMs: 33 * DAY, contentReadUnderRestriction: false });
    await expect(api.listProjects()).resolves.toHaveLength(1);
    // A write is still READ_ONLY with the reason.
    expect(facts(await caught(api.createProject({ projectKey: "NEW", name: "New" })))).toEqual({
      status: 403,
      code: "READ_ONLY",
      reasons: ["PAYMENT_EXPIRED"],
    });
  });
});
