import { describe, expect, it } from "vitest";
import { MemoryStorage } from "../../test/memoryStorage";
import { TenancyUnavailableError, apiErrorFacts, refusalCode, refusalViolations } from "../errors";
import type { TaskaApi } from "../TaskaApi";
import type { ActivityRecord } from "../tenantActivity";
import { readAllPages } from "../tenantMembers";
import { createLocalLockManager } from "../webSession";
import { MOCK_ACCOUNT_IDS, MockTaskaApi, MockTaskaStore } from "./MockTaskaApi";
import {
  ACTIVITY_CAP,
  MOCK_FORMER_MEMBER_ID,
  MOCK_INVITATION_IDS,
  MOCK_LONG_TENANT_NAME,
  MOCK_PLAN_IDS,
  MOCK_SERVER_KEY,
  MOCK_TENANT_HOOKS_KEY,
  MOCK_TENANT_IDS,
  MockTenantServer,
} from "./MockTenantServer";
import { MOCK_COMPANY_ROUTES, createCompaniesMockApi } from "./mockCompanies";

/*
 * The companies mock's activity log (TAS-524, api-contract-guard B8 — a route
 * proposed on TAS-523, not in the blueprint): the invitations list's order of
 * checks, the parameters' refusals naming their field, the keyset cursor bound
 * to the reader, the company and the filters, the seeded logs, and a record
 * for every write that takes effect — none for a replay, a no-op or a
 * refusal — the removal's when it succeeds, the platform's block, the cap.
 */

const { anna, tom, priya, mark, nina } = MOCK_ACCOUNT_IDS;
const NW = MOCK_TENANT_IDS.northwind;
const GX = MOCK_TENANT_IDS.globex;
const IN = MOCK_TENANT_IDS.initech;
const UM = MOCK_TENANT_IDS.umbrella;
const HO = MOCK_TENANT_IDS.hooli;
const LN = MOCK_TENANT_IDS.longName;

const key = () => crypto.randomUUID();
const caught = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error("expected a refusal");
    },
    (error: unknown) => error,
  );
const facts = (error: unknown) => ({
  status: apiErrorFacts(error).status,
  code: refusalCode(error),
  fields: refusalViolations(error).map((violation) => violation.field),
});

function browser(now?: () => number) {
  const local = new MemoryStorage();
  const locks = createLocalLockManager();
  const open = (session = new MemoryStorage()) =>
    createCompaniesMockApi({ local, session, locks, events: null, latencyMs: 0, ownershipWaitMs: 25, now });
  const hooks = (value: Record<string, unknown>) => local.setItem(MOCK_TENANT_HOOKS_KEY, JSON.stringify(value));
  return { local, open, hooks };
}

async function inCompany(email: string, tenantId: string, local?: MemoryStorage) {
  const opened = browser();
  const storage = local ?? opened.local;
  const api = createCompaniesMockApi({
    local: storage,
    session: new MemoryStorage(),
    locks: createLocalLockManager(),
    events: null,
    latencyMs: 0,
    ownershipWaitMs: 25,
  });
  await api.signIn({ email, password: "x" });
  await api.enterCompany(tenantId);
  const hooks = (value: Record<string, unknown>) => storage.setItem(MOCK_TENANT_HOOKS_KEY, JSON.stringify(value));
  return { api, local: storage, hooks };
}

/** The server's raw routes over the same storage, for the checks the session layer never lets through. */
async function raw(local: MemoryStorage, email: string, tenantId?: string) {
  const transport = new MockTenantServer({ storage: local, accountStore: new MockTaskaStore(), latencyMs: 0 }).transport();
  const account = (await transport.startWebSession({ email, password: "x" }, key())) as { accessToken: string };
  const company = tenantId ? ((await transport.createTenantSession(account.accessToken, tenantId, key())) as { accessToken: string }) : null;
  return { transport, account: account.accessToken, company: company?.accessToken ?? null };
}

const signal = () => new AbortController().signal;
const log = async (api: TaskaApi, tenantId: string, params: Parameters<TaskaApi["listTenantActivity"]>[1] = {}) =>
  (await api.listTenantActivity(tenantId, { limit: 50, ...params })).items;
const kinds = (records: ActivityRecord[]) => records.map((record) => record.kind);
const member = async (api: TaskaApi, tenantId: string, userId: string) =>
  (await readAllPages((params) => api.listTenantMembers(tenantId, params))).find((row) => row.userId === userId);

describe("the routes (B1)", () => {
  it("listTenantActivity is the session layer's, as for the REST leg; today's build refuses it without a request", async () => {
    expect(MOCK_COMPANY_ROUTES.listTenantActivity).toBe("session");
    await expect(new MockTaskaApi().listTenantActivity(NW, { limit: 50 })).rejects.toBeInstanceOf(TenancyUnavailableError);
  });

  it("the shared record is v6", async () => {
    const { local } = await inCompany("anna@example.com", NW);
    expect(MOCK_SERVER_KEY).toBe("taska.mockServer.v6");
    expect(JSON.parse(local.getItem(MOCK_SERVER_KEY) ?? "{}").v).toBe(6);
  });
});

describe("the order of checks (ADMIN_READ, B8)", () => {
  it("no bearer 401, the account session 400 TENANT_REQUIRED, a hook, a bad path 400, another company 403", async () => {
    const local = new MemoryStorage();
    const { transport, account, company } = await raw(local, "anna@example.com", NW);
    expect(facts(await caught(transport.listTenantActivity(null, NW, {}, signal())))).toMatchObject({ status: 401, code: "AUTHENTICATION_REQUIRED" });
    expect(facts(await caught(transport.listTenantActivity(account, NW, {}, signal())))).toMatchObject({ status: 400, code: "TENANT_REQUIRED" });
    local.setItem(MOCK_TENANT_HOOKS_KEY, JSON.stringify({ refuseNext: { listTenantActivity: { status: 503, code: "DEPENDENCY_UNAVAILABLE" } } }));
    expect(facts(await caught(transport.listTenantActivity(company, NW, {}, signal())))).toMatchObject({ status: 503, code: "DEPENDENCY_UNAVAILABLE" });
    expect(facts(await caught(transport.listTenantActivity(company, "not-a-uuid", {}, signal())))).toMatchObject({ status: 400, code: "VALIDATION_FAILED" });
    expect(facts(await caught(transport.listTenantActivity(company, GX, {}, signal())))).toMatchObject({ status: 403, code: "TENANT_MISMATCH" });
  });

  it("a member is 403 SCOPE_DENIED; the owner and an admin read", async () => {
    const { api } = await inCompany("anna@example.com", GX);
    expect(facts(await caught(api.listTenantActivity(GX, { limit: 50 })))).toMatchObject({ status: 403, code: "SCOPE_DENIED" });
    const { api: admin } = await inCompany("priya@example.com", UM);
    expect((await log(admin, UM)).length).toBeGreaterThan(0);
  });

  it("a company being set up is 409; no restriction refuses it — paused, blocked, with the read flag off", async () => {
    const { open, hooks } = browser();
    hooks({ provisioning: { stepMs: 60_000 } });
    const api = open();
    await api.signIn({ email: "nina@example.com", password: "x" });
    const { tenant } = await api.createTenant({ name: "Acme", planVersionId: MOCK_PLAN_IDS.free }, key());
    await api.enterCompany(tenant.id);
    expect(facts(await caught(api.listTenantActivity(tenant.id, { limit: 50 })))).toMatchObject({ status: 409, code: "INVALID_STATE" });

    const paused = await inCompany("sofia@example.com", IN);
    paused.hooks({ contentReadUnderRestriction: false });
    expect(kinds(await log(paused.api, IN))).toEqual(["TENANT_PAUSED"]);
    const blocked = await inCompany("priya@example.com", HO);
    blocked.hooks({ contentReadUnderRestriction: false });
    expect(kinds(await log(blocked.api, HO))).toEqual(["TENANT_BLOCKED"]);
  });
});

describe("the parameters (B8)", () => {
  it("each 400 names its field: limit, actorUserId, kind, cursor", async () => {
    const { api } = await inCompany("anna@example.com", NW);
    expect(facts(await caught(api.listTenantActivity(NW, { limit: 0 })))).toEqual({ status: 400, code: "VALIDATION_FAILED", fields: ["limit"] });
    expect(facts(await caught(api.listTenantActivity(NW, { limit: 101 })))).toEqual({ status: 400, code: "VALIDATION_FAILED", fields: ["limit"] });
    expect(facts(await caught(api.listTenantActivity(NW, { actorUserId: "anna" })))).toEqual({ status: 400, code: "VALIDATION_FAILED", fields: ["actorUserId"] });
    expect(facts(await caught(api.listTenantActivity(NW, { kinds: ["TENANT_CREATED", "TENANT_EXPORTED"] })))).toEqual({
      status: 400,
      code: "VALIDATION_FAILED",
      fields: ["kind"],
    });
    expect(facts(await caught(api.listTenantActivity(NW, { cursor: "not-a-cursor" })))).toEqual({ status: 400, code: "VALIDATION_FAILED", fields: ["cursor"] });
  });

  it("a filter without a match is an empty page, not a refusal", async () => {
    const { api } = await inCompany("anna@example.com", NW);
    await expect(api.listTenantActivity(NW, { limit: 50, kinds: ["OWNERSHIP_TRANSFERRED"] })).resolves.toEqual({ items: [], nextCursor: null });
    await expect(api.listTenantActivity(NW, { limit: 50, actorUserId: tom })).resolves.toEqual({ items: [], nextCursor: null });
  });

  it("filters by author and by kinds — several kinds as one OR", async () => {
    const { api } = await inCompany("anna@example.com", NW);
    expect(kinds(await log(api, NW, { actorUserId: anna }))).toEqual(["INVITATION_CREATED", "MEMBER_SUSPENDED", "INVITATION_CREATED", "TENANT_CREATED"]);
    expect(kinds(await log(api, NW, { actorUserId: anna.toUpperCase() }))).toHaveLength(4);
    expect(kinds(await log(api, NW, { kinds: ["MEMBER_LEFT", "INVITATION_RESENT", "MEMBER_LEFT"] }))).toEqual(["INVITATION_RESENT", "MEMBER_LEFT"]);
    expect(kinds(await log(api, NW, { actorUserId: anna, kinds: ["INVITATION_CREATED"] }))).toEqual(["INVITATION_CREATED", "INVITATION_CREATED"]);
  });
});

describe("the seeded logs (B8)", () => {
  it("Northwind, newest first: Mark's nameless resend, Kai, the former member, Omar, Zoe, the creation", async () => {
    const { api } = await inCompany("anna@example.com", NW);
    const records = await log(api, NW);
    expect(kinds(records)).toEqual([
      "INVITATION_RESENT",
      "INVITATION_CREATED",
      "MEMBER_LEFT",
      "MEMBER_SUSPENDED",
      "INVITATION_CREATED",
      "TENANT_CREATED",
    ]);
    expect(records[0]).toMatchObject({
      tenantId: NW,
      actor: { userId: mark, displayName: null, email: null, platformAdmin: true },
      target: { type: "INVITATION", id: MOCK_INVITATION_IDS.kai, email: "kai@example.com" },
      outcome: "SUCCEEDED",
    });
    expect(records[2].actor).toEqual({ userId: MOCK_FORMER_MEMBER_ID, displayName: null, email: null, platformAdmin: false });
    expect(records[4]).toMatchObject({ target: { email: "zoe@example.com" }, details: { kind: "INVITATION_CREATED", role: "TENANT_ADMIN" } });
    expect(records[5]).toMatchObject({ createdAt: "2026-05-01T09:00:00Z", actor: { userId: anna, displayName: "Anna Ivanova" } });
    // Newest first, and never later than the seed.
    const times = records.map((record) => Date.parse(record.createdAt ?? ""));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(times[0]).toBeLessThanOrEqual(Date.now());
    // No record is DENIED.
    expect(records.every((record) => record.outcome === "SUCCEEDED")).toBe(true);
  });

  it("Umbrella carries a kind this build does not know; Globex, Initech and Hooli one record each", async () => {
    const { api } = await inCompany("tom@example.com", UM);
    expect(kinds(await log(api, UM))).toEqual(["INVITATION_CREATED", "TENANT_EXPORTED", "MEMBER_SUSPENDED", "ROLE_CHANGED", "TENANT_CREATED"]);
    const { api: priyaApi } = await inCompany("priya@example.com", GX);
    expect(kinds(await log(priyaApi, GX))).toEqual(["TENANT_CREATED"]);
    const { api: hooli } = await inCompany("priya@example.com", HO);
    expect((await log(hooli, HO))[0].actor).toMatchObject({ userId: mark, platformAdmin: true, displayName: null });
  });
});

describe("the keyset cursor (B4, B8)", () => {
  it("the long-named company reads in three pages; a record written at the head meanwhile neither repeats nor shifts a page", async () => {
    const { api } = await inCompany("priya@example.com", LN);
    const first = await api.listTenantActivity(LN, { limit: 50 });
    expect(first.items).toHaveLength(50);
    expect(first.nextCursor).not.toBeNull();
    // A write at the head between two pages.
    await api.createTenantInvitation(LN, { email: "late@example.com", role: "MEMBER", projectGrants: [] }, key());
    const second = await api.listTenantActivity(LN, { limit: 50, cursor: first.nextCursor ?? "" });
    const third = await api.listTenantActivity(LN, { limit: 50, cursor: second.nextCursor ?? "" });
    expect(second.items).toHaveLength(50);
    expect(third.items).toHaveLength(24);
    expect(third.nextCursor).toBeNull();
    const ids = [...first.items, ...second.items, ...third.items].map((record) => record.id);
    expect(new Set(ids).size).toBe(124);
    expect(third.items.map((record) => record.kind).slice(-4)).toEqual(["INVITATION_ACCEPTED", "INVITATION_CREATED", "TENANT_RENAMED", "TENANT_CREATED"]);
    // The new record is on the next first page, at the head.
    expect((await log(api, LN))[0]).toMatchObject({ kind: "INVITATION_CREATED", target: { email: "late@example.com" } });
  });

  it("a cursor is bound to its reader, its company and its filters", async () => {
    const { api, local } = await inCompany("priya@example.com", LN);
    const { nextCursor } = await api.listTenantActivity(LN, { limit: 2 });
    expect(nextCursor).not.toBeNull();
    const cursor = nextCursor ?? "";
    expect(facts(await caught(api.listTenantActivity(LN, { limit: 2, cursor, kinds: ["INVITATION_REVOKED"] })))).toMatchObject({ fields: ["cursor"] });
    expect(facts(await caught(api.listTenantActivity(LN, { limit: 2, cursor, actorUserId: priya })))).toMatchObject({ fields: ["cursor"] });
    // Another admin of another company, or the same company's other reader, cannot follow it.
    const { api: tomApi } = await inCompany("tom@example.com", UM, local);
    expect(facts(await caught(tomApi.listTenantActivity(UM, { limit: 2, cursor })))).toMatchObject({ fields: ["cursor"] });
    const umbrella = await inCompany("priya@example.com", UM, local);
    const own = await umbrella.api.listTenantActivity(UM, { limit: 2 });
    const { api: tomAgain } = await inCompany("tom@example.com", UM, local);
    expect(facts(await caught(tomAgain.listTenantActivity(UM, { limit: 2, cursor: own.nextCursor ?? "" })))).toMatchObject({ fields: ["cursor"] });
    // Its own filter follows it.
    await expect(api.listTenantActivity(LN, { limit: 2, cursor })).resolves.toMatchObject({ items: expect.any(Array) });
  });
});

describe("a record for each write that takes effect (B8)", () => {
  it("invite, resend, revoke — and none for a replay or a refusal", async () => {
    const { api } = await inCompany("tom@example.com", UM);
    const sent = key();
    const invitation = await api.createTenantInvitation(UM, { email: "lin@example.com", role: "TENANT_ADMIN", projectGrants: [] }, sent);
    // The same key again: the receipt's answer, no second record.
    await api.createTenantInvitation(UM, { email: "lin@example.com", role: "TENANT_ADMIN", projectGrants: [] }, sent);
    // A refusal: a second pending invitation to the same address — nothing written.
    await caught(api.createTenantInvitation(UM, { email: "lin@example.com", role: "MEMBER", projectGrants: [] }, key()));
    await api.resendTenantInvitation(UM, invitation.id, key());
    const pending = (await readAllPages((params) => api.listTenantInvitations(UM, params))).find((row) => row.id === invitation.id);
    await api.revokeTenantInvitation(UM, invitation.id, pending?.version ?? "", key());
    const records = await log(api, UM);
    expect(kinds(records).slice(0, 4)).toEqual(["INVITATION_REVOKED", "INVITATION_RESENT", "INVITATION_CREATED", "INVITATION_CREATED"]);
    expect(records[2]).toMatchObject({
      actor: { userId: tom, displayName: "Tom Becker", email: "tom@example.com", platformAdmin: false },
      target: { type: "INVITATION", id: invitation.id, email: "lin@example.com" },
      details: { kind: "INVITATION_CREATED", role: "TENANT_ADMIN" },
    });
    // The seeded Lena invitation stays fourth: exactly three new records.
    expect(records[3].target?.email).toBe("lena@example.com");
  });

  it("a role change, from and to — and none for the same role", async () => {
    const { api } = await inCompany("tom@example.com", UM);
    const before = (await log(api, UM)).length;
    const row = await member(api, UM, priya);
    await api.setTenantMemberRole(UM, priya, "TENANT_ADMIN", row?.version ?? "", key());
    expect((await log(api, UM)).length).toBe(before);
    await api.setTenantMemberRole(UM, priya, "MEMBER", row?.version ?? "", key());
    expect((await log(api, UM))[0]).toMatchObject({
      kind: "ROLE_CHANGED",
      target: { type: "MEMBER", id: priya, displayName: "Priya Nair" },
      details: { kind: "ROLE_CHANGED", fromRole: "TENANT_ADMIN", toRole: "MEMBER" },
    });
  });

  it("a suspension and a reactivation; a removal once its operation succeeds", async () => {
    const { api, hooks } = await inCompany("tom@example.com", UM);
    let row = await member(api, UM, priya);
    await api.setTenantMemberState(UM, priya, "SUSPENDED", row?.version ?? "", key());
    row = await member(api, UM, priya);
    await api.setTenantMemberState(UM, priya, "ACTIVE", row?.version ?? "", key());
    expect(kinds(await log(api, UM)).slice(0, 2)).toEqual(["MEMBER_REACTIVATED", "MEMBER_SUSPENDED"]);

    hooks({ memberOperationStepMs: 60_000 });
    row = await member(api, UM, priya);
    const operation = await api.removeTenantMember(UM, priya, row?.version ?? "", key());
    // Under way: nothing yet.
    expect((await log(api, UM))[0].kind).toBe("MEMBER_REACTIVATED");
    hooks({ memberOperationStepMs: 0 });
    expect((await api.getTenantOperation(UM, operation.id)).state).toBe("SUCCEEDED");
    expect((await log(api, UM))[0]).toMatchObject({ kind: "MEMBER_REMOVED", actor: { userId: tom }, target: { id: priya, displayName: "Priya Nair" } });
  });

  it("a leave, by the one who left", async () => {
    const { api: annaApi, local } = await inCompany("anna@example.com", GX);
    await annaApi.leaveTenant(GX, key());
    const { api: owner } = await inCompany("priya@example.com", GX, local);
    expect((await log(owner, GX))[0]).toMatchObject({ kind: "MEMBER_LEFT", actor: { userId: anna, displayName: "Anna Ivanova" }, target: { id: anna } });
  });

  it("rename, pause, resume — none for the same name or a pause over a pause", async () => {
    const { api } = await inCompany("anna@example.com", NW);
    const version = async () => (await api.getTenant(NW)).version ?? "";
    await api.renameTenant(NW, "Northwind", await version(), key());
    await api.renameTenant(NW, "Northwind Traders", await version(), key());
    await api.pauseTenant(NW, await version(), key());
    await api.pauseTenant(NW, await version(), key());
    await api.resumeTenant(NW, await version(), key());
    const records = await log(api, NW);
    expect(kinds(records).slice(0, 3)).toEqual(["TENANT_RESUMED", "TENANT_PAUSED", "TENANT_RENAMED"]);
    expect(records[2]).toMatchObject({ target: { type: "TENANT", id: NW }, details: { kind: "TENANT_RENAMED", fromName: "Northwind", toName: "Northwind Traders" } });
    expect(records[3].kind).toBe("INVITATION_RESENT");
  });

  it("an ownership transfer: the new owner the target, the previous one in details", async () => {
    const { api } = await inCompany("tom@example.com", UM);
    await api.transferTenantOwnership(UM, priya, (await api.getTenant(UM)).version ?? "", key());
    expect((await log(api, UM))[0]).toMatchObject({
      kind: "OWNERSHIP_TRANSFERRED",
      actor: { userId: tom },
      target: { type: "MEMBER", id: priya },
      details: { kind: "OWNERSHIP_TRANSFERRED", previousOwner: { userId: tom, displayName: "Tom Becker", email: "tom@example.com" } },
    });
  });

  it("a new company's first record is its creation", async () => {
    const { open, hooks } = browser();
    hooks({ provisioning: { stepMs: 0 } });
    const api = open();
    await api.signIn({ email: "nina@example.com", password: "x" });
    const { tenant } = await api.createTenant({ name: "Acme", planVersionId: MOCK_PLAN_IDS.free }, key());
    await api.enterCompany(tenant.id);
    expect(await log(api, tenant.id)).toMatchObject([
      { kind: "TENANT_CREATED", tenantId: tenant.id, actor: { userId: nina, displayName: "Nina Kowal" }, target: { type: "TENANT", id: tenant.id, displayName: "Acme" } },
    ]);
  });

  it("the platform's block and its lifting, by a nameless administrator of Taska; a hook that changes nothing writes nothing", async () => {
    const { api, hooks } = await inCompany("anna@example.com", NW);
    hooks({ platformBlock: { [NW]: true } });
    hooks({ platformBlock: { [NW]: true } });
    expect(kinds(await log(api, NW)).slice(0, 2)).toEqual(["TENANT_BLOCKED", "INVITATION_RESENT"]);
    hooks({ platformBlock: { [NW]: false } });
    const records = await log(api, NW);
    expect(kinds(records).slice(0, 3)).toEqual(["TENANT_UNBLOCKED", "TENANT_BLOCKED", "INVITATION_RESENT"]);
    expect(records[0].actor).toEqual({ userId: mark, displayName: null, email: null, platformAdmin: true });
  });

  it("a refused write writes nothing — Northwind is full", async () => {
    const { api } = await inCompany("anna@example.com", NW);
    const before = await log(api, NW);
    expect(facts(await caught(api.createTenantInvitation(NW, { email: "lin@example.com", role: "MEMBER", projectGrants: [] }, key())))).toMatchObject({
      status: 422,
      code: "QUOTA_EXCEEDED",
    });
    expect(await log(api, NW)).toEqual(before);
  });
});

describe("the hooks and the cap (B8)", () => {
  it("loseAnswer: the read is made and its answer lost, once", async () => {
    const { api, hooks } = await inCompany("anna@example.com", NW);
    hooks({ loseAnswer: ["listTenantActivity"] });
    expect(apiErrorFacts(await caught(api.listTenantActivity(NW, { limit: 50 })))).toMatchObject({ status: null });
    await expect(log(api, NW)).resolves.toHaveLength(6);
  });

  it("the newest 500 of a company are kept", async () => {
    const { api, local } = await inCompany("tom@example.com", UM);
    const state = JSON.parse(local.getItem(MOCK_SERVER_KEY) ?? "{}") as { activity: Array<Record<string, unknown>> };
    const others = state.activity.filter((item) => item.tenantId !== UM);
    const filler = Array.from({ length: ACTIVITY_CAP }, (_, index) => ({
      id: `f0000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`,
      tenantId: UM,
      seq: 10_000 + index,
      createdAt: new Date(Date.parse("2026-06-01T00:00:00Z") + index * 60_000).toISOString(),
      actor: { userId: tom, platformAdmin: false },
      kind: "INVITATION_RESENT",
      target: { type: "INVITATION", id: "i", email: "x@example.com" },
      outcome: "SUCCEEDED",
    }));
    local.setItem(MOCK_SERVER_KEY, JSON.stringify({ ...state, activity: [...others, ...filler] }));
    const version = (await api.getTenant(UM)).version ?? "";
    await api.renameTenant(UM, "Umbrella Corp", version, key());
    const stored = JSON.parse(local.getItem(MOCK_SERVER_KEY) ?? "{}") as { activity: Array<{ tenantId: string; id: string; kind: string }> };
    const own = stored.activity.filter((item) => item.tenantId === UM);
    expect(own).toHaveLength(ACTIVITY_CAP);
    // The oldest went; the newest is the rename; the other companies' are untouched.
    expect(own.some((item) => item.id === filler[0].id)).toBe(false);
    expect(own.some((item) => item.kind === "TENANT_RENAMED")).toBe(true);
    expect(stored.activity.filter((item) => item.tenantId !== UM)).toHaveLength(others.length);
  });

  it("the long name is snapshotted as the record's company name", async () => {
    const { api } = await inCompany("priya@example.com", LN);
    const records = (await readAll(api, LN)).filter((record) => record.kind === "TENANT_RENAMED");
    expect(records[0].details).toMatchObject({ toName: MOCK_LONG_TENANT_NAME });
    // Sofia, a member there, is refused.
    const { api: member } = await inCompany("sofia@example.com", LN);
    expect(facts(await caught(member.listTenantActivity(LN, { limit: 50 })))).toMatchObject({ status: 403, code: "SCOPE_DENIED" });
  });
});

async function readAll(api: TaskaApi, tenantId: string): Promise<ActivityRecord[]> {
  const records: ActivityRecord[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 10; page += 1) {
    const answer = await api.listTenantActivity(tenantId, { limit: 100, ...(cursor ? { cursor } : {}) });
    records.push(...answer.items);
    if (answer.nextCursor === null) break;
    cursor = answer.nextCursor;
  }
  return records;
}
