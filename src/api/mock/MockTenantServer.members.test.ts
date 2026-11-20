import { describe, expect, it } from "vitest";
import { MemoryStorage } from "../../test/memoryStorage";
import { WorkspaceClosedError, apiErrorFacts, refusalCode, refusalReasons, refusalViolations } from "../errors";
import type { TaskaApi, WorkspaceClosedEvent, WorkspaceRestrictedEvent } from "../TaskaApi";
import { readAllPages, seatsOf, type Invitation, type Membership } from "../tenantMembers";
import { createLocalLockManager } from "../webSession";
import { MOCK_ACCOUNT_IDS, MOCK_PROJECT_IDS, MockTaskaStore } from "./MockTaskaApi";
import {
  MOCK_INVITATION_IDS,
  MOCK_SERVER_KEY,
  MOCK_TENANT_HOOKS_KEY,
  MOCK_TENANT_IDS,
  MOCK_TENANT_PROJECT_IDS,
  MockTenantServer,
} from "./MockTenantServer";
import { createCompaniesMockApi } from "./mockCompanies";

/*
 * The companies mock's members, invitations and seats (TAS-502,
 * api-contract-guard §7 with the orchestrator's rulings): the fixtures, PR
 * #287's order of checks, the per-policy restrictions, the durable receipts,
 * what a suspension, removal, demotion and leave take, expiry on the
 * lifecycle clock, and the parity points against the REST leg.
 */

const OMAR = "d58f0e73-4b2c-4c9d-8e15-3f6a70b2c9d4";
const { anna, sofia, tom, priya } = MOCK_ACCOUNT_IDS;
const NW: string = MOCK_TENANT_IDS.northwind;

function browser(now?: () => number) {
  const local = new MemoryStorage();
  const locks = createLocalLockManager();
  const open = (session = new MemoryStorage()) =>
    createCompaniesMockApi({ local, session, locks, events: null, latencyMs: 0, ownershipWaitMs: 25, now });
  return { local, open };
}

async function inCompany(email: string, tenantId: string, setup?: (local: MemoryStorage) => void, now?: () => number) {
  const { local, open } = browser(now);
  setup?.(local);
  const api = open();
  await api.signIn({ email, password: "x" });
  await api.enterCompany(tenantId);
  return { api, local, open };
}

const key = () => crypto.randomUUID();
const caught = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error("expected a refusal");
    },
    (error: unknown) => error,
  );
const members = (api: TaskaApi, tenantId = NW) => readAllPages((params) => api.listTenantMembers(tenantId, params));
const invitations = (api: TaskaApi, tenantId = NW) => readAllPages((params) => api.listTenantInvitations(tenantId, params));
const seats = async (api: TaskaApi, tenantId = NW) => seatsOf(await api.getTenantQuotas(tenantId));
const row = (rows: Membership[], userId: string) => rows.find((item) => item.userId === userId) as Membership;
const facts = (error: unknown) => ({ status: apiErrorFacts(error).status, code: refusalCode(error) });
const hooks = (local: MemoryStorage, value: Record<string, unknown>) => local.setItem(MOCK_TENANT_HOOKS_KEY, JSON.stringify(value));

describe("the fixtures (§7)", () => {
  it("Northwind is full: four members, Omar suspended among them, Kai's invitation holding the fifth seat, Zoe's expired", async () => {
    const { api } = await inCompany("anna@example.com", NW);
    const rows = await members(api);
    expect(rows.map((item) => [item.displayName, item.role, item.state, item.isOwner]).sort()).toEqual(
      [
        ["Anna Ivanova", "TENANT_ADMIN", "ACTIVE", true],
        ["Omar Haddad", "MEMBER", "SUSPENDED", false],
        ["Sofia Reyes", "MEMBER", "ACTIVE", false],
        ["Tom Becker", "MEMBER", "ACTIVE", false],
      ].sort(),
    );
    expect(row(rows, OMAR).version).toBe("2");
    expect(row(rows, anna)).toMatchObject({ email: "anna@example.com", tenantId: NW, version: "1", avatarPath: null });
    expect(await seats(api)).toEqual({ used: 4n, reserved: 1n, limit: 5n });
    const sent = await invitations(api);
    expect(sent.map((item) => [item.email, item.state, item.role, item.createdBy])).toEqual([
      ["zoe@example.com", "EXPIRED", "TENANT_ADMIN", anna],
      ["kai@example.com", "PENDING", "MEMBER", anna],
    ]);
    expect(sent[1].projectGrants).toEqual([{ projectId: MOCK_PROJECT_IDS.web, role: "MEMBER" }]);
  });

  it("the store's raw answers carry decimal strings, no avatarPath and no bookkeeping of the mock's", async () => {
    const local = new MemoryStorage();
    const server = new MockTenantServer({ storage: local, accountStore: new MockTaskaStore(), latencyMs: 0 });
    const transport = server.transport();
    const account = (await transport.startWebSession({ email: "anna@example.com", password: "x" }, key())) as { accessToken: string };
    const company = (await transport.createTenantSession(account.accessToken, NW, key())) as { accessToken: string };
    const signal = new AbortController().signal;
    const page = (await transport.listTenantMembers(company.accessToken, NW, {}, signal)) as { items: Record<string, unknown>[] };
    expect(page).not.toHaveProperty("nextCursor");
    for (const item of page.items) {
      expect(Object.keys(item).sort()).toEqual(["displayName", "email", "id", "isOwner", "role", "state", "tenantId", "userId", "version"]);
      expect(item.version).toMatch(/^[0-9]+$/);
    }
    const quotas = (await transport.getTenantQuotas(company.accessToken, NW, signal)) as Record<string, unknown>;
    expect(quotas).toMatchObject({
      tenantId: NW,
      version: expect.stringMatching(/^[0-9]+$/),
      // TAS-512: the three rows the blueprint allows — Northwind's three projects against the FREE limit of 1
      // (the platform's bypass, no OVER_QUOTA) and its seeded bytes of 100 MB.
      quotas: [
        { kind: "SEAT", used: "4", reserved: "1", limit: "5", unlimited: false, version: expect.stringMatching(/^[0-9]+$/) },
        { kind: "PROJECT", used: "3", reserved: "0", limit: "1", unlimited: false, version: expect.stringMatching(/^[0-9]+$/) },
        { kind: "STORAGE_BYTES", used: expect.stringMatching(/^[0-9]+$/), reserved: "0", limit: "100000000", unlimited: false, version: expect.stringMatching(/^[0-9]+$/) },
      ],
    });
    const tenants = (await transport.listTenants(account.accessToken, {}, signal)) as { items: Record<string, unknown>[] };
    for (const tenant of tenants.items) {
      expect(tenant).not.toHaveProperty("seatLimit");
      expect(tenant).not.toHaveProperty("generation");
      expect(tenant).not.toHaveProperty("quotaVersion");
      // TAS-504: the subscription is the owner's read, never on the Tenant wire.
      expect(tenant).not.toHaveProperty("subscription");
      // TAS-512: nor the entitlement's version or the quota bookkeeping.
      expect(tenant).not.toHaveProperty("entitlementVersion");
      expect(tenant).not.toHaveProperty("quotaBreach");
      // TAS-514: nor how the server picks a company's invoices' method.
      expect(tenant).not.toHaveProperty("invoiceMethod");
    }
    // v9 since TAS-516's fresh seed (payment facts, paid periods and disputes; Soylent Corp).
    expect(JSON.parse(local.getItem(MOCK_SERVER_KEY) ?? "{}").v).toBe(9);
  });

  it("keeps TAS-500's directory: Northwind's ACTIVE people are Anna, Sofia and Tom", async () => {
    const { api } = await inCompany("anna@example.com", NW);
    const emails = (await api.searchUsers({ query: "example.com" })).items.map((user) => user.email).sort();
    expect(emails).toEqual(["anna@example.com", "sofia@example.com", "tom@example.com"]);
  });

  it("Umbrella has Priya as a second admin and Lena's invitation of hers; Globex shows Anna its directory and seats only", async () => {
    const umbrella = await inCompany("tom@example.com", MOCK_TENANT_IDS.umbrella);
    expect((await members(umbrella.api, MOCK_TENANT_IDS.umbrella)).map((item) => [item.displayName, item.role, item.state]).sort()).toEqual([
      ["Anna Ivanova", "MEMBER", "SUSPENDED"],
      ["Priya Nair", "TENANT_ADMIN", "ACTIVE"],
      ["Tom Becker", "TENANT_ADMIN", "ACTIVE"],
    ]);
    expect((await invitations(umbrella.api, MOCK_TENANT_IDS.umbrella)).map((item) => [item.email, item.createdBy])).toEqual([
      ["lena@example.com", priya],
    ]);
    const globex = await inCompany("anna@example.com", MOCK_TENANT_IDS.globex);
    expect((await members(globex.api, MOCK_TENANT_IDS.globex)).length).toBe(2);
    expect(await seats(globex.api, MOCK_TENANT_IDS.globex)).toEqual({ used: 2n, reserved: 0n, limit: 5n });
    expect(facts(await caught(invitations(globex.api, MOCK_TENANT_IDS.globex)))).toEqual({ status: 403, code: "SCOPE_DENIED" });
  });
});

describe("seats: an invitation holds one, resend takes none, revoke and expiry free it", () => {
  it("a full company refuses 422; revoking Kai frees the seat; the new invitation holds it; resend keeps the count and the expiry", async () => {
    const { api } = await inCompany("anna@example.com", NW);
    const input = { email: "lin@example.com", role: "MEMBER" as const, projectGrants: [] };
    expect(facts(await caught(api.createTenantInvitation(NW, input, key())))).toEqual({ status: 422, code: "QUOTA_EXCEEDED" });
    await api.revokeTenantInvitation(NW, MOCK_INVITATION_IDS.kai, "1", key());
    expect(await seats(api)).toEqual({ used: 4n, reserved: 0n, limit: 5n });
    const created = await api.createTenantInvitation(NW, input, key());
    expect(created).toMatchObject({ email: "lin@example.com", state: "PENDING", createdBy: anna, version: "1" });
    expect(Date.parse(created.expiresAt ?? "") - Date.now()).toBeGreaterThan(6.9 * 24 * 3600_000);
    expect(await seats(api)).toEqual({ used: 4n, reserved: 1n, limit: 5n });
    const resent = await api.resendTenantInvitation(NW, created.id, key());
    expect(resent).toMatchObject({ version: "2", expiresAt: created.expiresAt });
    expect(await seats(api)).toEqual({ used: 4n, reserved: 1n, limit: 5n });
    // A revoked invitation is no longer PENDING.
    expect(facts(await caught(api.revokeTenantInvitation(NW, MOCK_INVITATION_IDS.kai, "2", key())))).toEqual({ status: 409, code: "INVALID_STATE" });
    expect(facts(await caught(api.resendTenantInvitation(NW, MOCK_INVITATION_IDS.zoe, key())))).toEqual({
      status: 422,
      code: "INVITATION_EXPIRED",
    });
  });

  it("an invitation expires on the lifecycle clock and releases its seat", async () => {
    const { api, local } = await inCompany("anna@example.com", NW);
    hooks(local, { clockOffsetMs: 6 * 24 * 3600_000 });
    expect((await invitations(api)).find((item) => item.id === MOCK_INVITATION_IDS.kai)?.state).toBe("EXPIRED");
    expect(await seats(api)).toEqual({ used: 4n, reserved: 0n, limit: 5n });
  });

  it("invite refusals where the blueprint is silent (A23): a foreign project, a duplicate pending address, a member's address, a bad address", async () => {
    const { api } = await inCompany("anna@example.com", NW);
    await api.revokeTenantInvitation(NW, MOCK_INVITATION_IDS.kai, "1", key());
    const foreign = await caught(
      api.createTenantInvitation(NW, { email: "lin@example.com", role: "MEMBER", projectGrants: [{ projectId: MOCK_PROJECT_IDS.ops, role: "MEMBER" }] }, key()),
    );
    expect(facts(foreign)).toEqual({ status: 400, code: "VALIDATION_FAILED" });
    expect(refusalViolations(foreign).map((item) => item.field)).toEqual(["projectGrants[0].projectId"]);
    expect(refusalViolations(await caught(api.createTenantInvitation(NW, { email: "no-at-sign", role: "MEMBER", projectGrants: [] }, key()))).map((item) => item.field)).toEqual(["email"]);
    expect(facts(await caught(api.createTenantInvitation(NW, { email: "Sofia@Example.com", role: "MEMBER", projectGrants: [] }, key())))).toEqual({
      status: 409,
      code: "INVALID_STATE",
    });
    await api.createTenantInvitation(NW, { email: "lin@example.com", role: "MEMBER", projectGrants: [] }, key());
    // Northwind is full again — free a seat, then the duplicate is the refusal.
    await api.removeTenantMember(NW, OMAR, "2", key());
    expect(facts(await caught(api.createTenantInvitation(NW, { email: "LIN@example.com", role: "MEMBER", projectGrants: [] }, key())))).toEqual({
      status: 409,
      code: "INVALID_STATE",
    });
  });
});

describe("PR #287's order of checks, with the rulings", () => {
  it("a member is refused SCOPE_DENIED for every admin write; the directory and the seats are theirs to read", async () => {
    const { api } = await inCompany("anna@example.com", MOCK_TENANT_IDS.globex);
    const G = MOCK_TENANT_IDS.globex;
    const rows = await members(api, G);
    const priyaRow = row(rows, priya);
    for (const write of [
      () => api.setTenantMemberRole(G, priya, "MEMBER", priyaRow.version ?? "1", key()),
      () => api.setTenantMemberState(G, priya, "SUSPENDED", priyaRow.version ?? "1", key()),
      () => api.removeTenantMember(G, priya, priyaRow.version ?? "1", key()),
      () => api.createTenantInvitation(G, { email: "x@example.com", role: "MEMBER", projectGrants: [] }, key()),
    ]) {
      expect(facts(await caught(write()))).toEqual({ status: 403, code: "SCOPE_DENIED" });
    }
    expect(api.currentWorkspace()?.tenantId).toBe(G);
  });

  it("the owner is protected; a non-ACTIVE target is 409 INVALID_STATE (A17), never the caller's MEMBERSHIP_INACTIVE", async () => {
    const closed: WorkspaceClosedEvent[] = [];
    const { api } = await inCompany("anna@example.com", NW);
    api.onWorkspaceClosed((event) => closed.push(event));
    expect(facts(await caught(api.setTenantMemberRole(NW, anna, "MEMBER", "1", key())))).toEqual({ status: 409, code: "OWNER_MEMBERSHIP_PROTECTED" });
    expect(facts(await caught(api.removeTenantMember(NW, anna, "1", key())))).toEqual({ status: 409, code: "OWNER_MEMBERSHIP_PROTECTED" });
    expect(facts(await caught(api.setTenantMemberRole(NW, OMAR, "TENANT_ADMIN", "2", key())))).toEqual({ status: 409, code: "INVALID_STATE" });
    expect(facts(await caught(api.setTenantMemberState(NW, sofia, "ACTIVE", "1", key())))).toEqual({ status: 409, code: "INVALID_STATE" });
    // Suspending a target that is not ACTIVE is 409 too, never 403 (M17).
    expect(facts(await caught(api.setTenantMemberState(NW, OMAR, "SUSPENDED", "2", key())))).toEqual({ status: 409, code: "INVALID_STATE" });
    expect(facts(await caught(api.setTenantMemberRole(NW, "0c2e5a7b-1d3f-4b6a-8c9e-0f1a2b3c4d5e", "MEMBER", "1", key())))).toEqual({
      status: 404,
      code: "RESOURCE_NOT_FOUND",
    });
    expect(closed).toEqual([]);
  });

  it("If-Match: missing 428, malformed 400, stale 412; the same role is a no-op at the same version", async () => {
    const { api } = await inCompany("anna@example.com", NW);
    expect(facts(await caught(api.setTenantMemberRole(NW, sofia, "TENANT_ADMIN", "", key())))).toEqual({ status: 428, code: "VERSION_CONFLICT" });
    expect(facts(await caught(api.setTenantMemberRole(NW, sofia, "TENANT_ADMIN", "v1", key())))).toEqual({ status: 400, code: "VALIDATION_FAILED" });
    expect(facts(await caught(api.setTenantMemberRole(NW, sofia, "TENANT_ADMIN", "7", key())))).toEqual({ status: 412, code: "VERSION_CONFLICT" });
    await expect(api.setTenantMemberRole(NW, sofia, "MEMBER", "1", key())).resolves.toMatchObject({ role: "MEMBER", version: "1" });
    await expect(api.setTenantMemberRole(NW, sofia, "TENANT_ADMIN", "1", key())).resolves.toMatchObject({ role: "TENANT_ADMIN", version: "2" });
  });

  it("a key is a durable receipt: the same request replays its answer, another request is 409 IDEMPOTENCY_CONFLICT", async () => {
    const { api } = await inCompany("anna@example.com", NW);
    const once = key();
    const first = await api.setTenantMemberRole(NW, tom, "TENANT_ADMIN", "1", once);
    await expect(api.setTenantMemberRole(NW, tom, "TENANT_ADMIN", "1", once)).resolves.toEqual(first);
    expect(facts(await caught(api.setTenantMemberRole(NW, tom, "MEMBER", "2", once)))).toEqual({ status: 409, code: "IDEMPOTENCY_CONFLICT" });
    expect(facts(await caught(api.setTenantMemberRole(NW, tom, "MEMBER", "2", "not-a-uuid")))).toEqual({ status: 400, code: "VALIDATION_FAILED" });
  });

  it("LAST_ADMIN is reachable through refuseNext, and closes nothing", async () => {
    const { api, local } = await inCompany("tom@example.com", MOCK_TENANT_IDS.umbrella);
    hooks(local, { refuseNext: { setTenantMemberRole: { status: 409, code: "LAST_ADMIN" } } });
    const refused = await caught(api.setTenantMemberRole(MOCK_TENANT_IDS.umbrella, priya, "MEMBER", "1", key()));
    expect(facts(refused)).toEqual({ status: 409, code: "LAST_ADMIN" });
    expect(api.currentWorkspace()?.tenantId).toBe(MOCK_TENANT_IDS.umbrella);
  });
});

describe("restriction policies (NORMAL, RECOVERY, LEAVE, DIRECTORY)", () => {
  it("a blocked company refuses an admin's NORMAL and RECOVERY writes READ_ONLY with its reasons, and reads its directory", async () => {
    const H = MOCK_TENANT_IDS.hooli;
    const { api } = await inCompany("priya@example.com", H);
    const rows = await members(api, H);
    expect(rows.length).toBe(2);
    for (const write of [
      () => api.setTenantMemberRole(H, sofia, "TENANT_ADMIN", "1", key()),
      () => api.removeTenantMember(H, sofia, "1", key()),
    ]) {
      const refused = await caught(write());
      expect(facts(refused)).toEqual({ status: 403, code: "READ_ONLY" });
      expect(refusalReasons(refused)).toEqual(["PLATFORM_BLOCK"]);
    }
    expect(api.currentWorkspace()?.tenantId).toBe(H);
  });

  it("under PAYMENT_EXPIRED (the restrict hook) an invite is READ_ONLY and a revoke goes through (RECOVERY)", async () => {
    const { api, local } = await inCompany("anna@example.com", NW);
    hooks(local, { restrict: { [NW]: ["PAYMENT_EXPIRED"] } });
    expect(facts(await caught(api.createTenantInvitation(NW, { email: "x@example.com", role: "MEMBER", projectGrants: [] }, key())))).toEqual({
      status: 403,
      code: "READ_ONLY",
    });
    await expect(api.revokeTenantInvitation(NW, MOCK_INVITATION_IDS.kai, "1", key())).resolves.toBeUndefined();
    // RECOVERY lets a removal through too (M18); NORMAL's role change stays READ_ONLY.
    await expect(api.removeTenantMember(NW, OMAR, "2", key())).resolves.toMatchObject({ state: "SUCCEEDED" });
    expect(facts(await caught(api.setTenantMemberRole(NW, sofia, "TENANT_ADMIN", "1", key())))).toEqual({ status: 403, code: "READ_ONLY" });
    // Under a pause RECOVERY is refused as well.
    hooks(local, { restrict: { [NW]: ["OWNER_PAUSE"] } });
    expect(facts(await caught(api.removeTenantMember(NW, tom, "1", key())))).toEqual({ status: 403, code: "READ_ONLY" });
  });

  it("leaving is never refused by a restriction: Anna leaves paused Initech", async () => {
    const I = MOCK_TENANT_IDS.initech;
    const { api } = await inCompany("anna@example.com", I);
    expect((await members(api, I)).length).toBe(2);
    const operation = await api.leaveTenant(I, key());
    expect(operation).toMatchObject({ state: "SUCCEEDED", tenantId: I });
    expect(api.currentWorkspace()).toBeNull();
    const companies = await api.listTenants({ limit: 100 });
    expect(companies.items.map((tenant) => tenant.name)).toEqual(["Northwind", "Globex"]);
  });

  // Since TAS-504 (api-contract-guard B2) the refusal no longer closes the
  // company: it marks the tab, and the session stays — the rule itself is
  // TAS-502's (DIRECTORY = CONTENT_READ; whether it should be the control
  // plane is ask A42).
  it("with the content-read flag off, a paused company's directory read is refused (DIRECTORY = CONTENT_READ) — marking the tab, not closing it", async () => {
    const I = MOCK_TENANT_IDS.initech;
    const { api, local } = await inCompany("anna@example.com", I);
    hooks(local, { contentReadUnderRestriction: false });
    const closed: WorkspaceClosedEvent[] = [];
    const restricted: WorkspaceRestrictedEvent[] = [];
    api.onWorkspaceClosed((event) => closed.push(event));
    api.onWorkspaceRestricted((event) => restricted.push(event));
    const refused = await caught(members(api, I));
    expect(facts(refused)).toEqual({ status: 403, code: "CAPABILITY_DISABLED" });
    expect(refusalReasons(refused)).toEqual(["OWNER_PAUSE"]);
    expect(closed).toEqual([]);
    expect(restricted.map((event) => [event.restricted, event.reasons])).toEqual([[true, ["OWNER_PAUSE"]]]);
    expect(api.currentWorkspace()?.tenantId).toBe(I);
    // Leaving is never refused by a restriction (LEAVE).
    await expect(api.leaveTenant(I, key())).resolves.toMatchObject({ state: "SUCCEEDED" });
  });
});

describe("what a suspension, a demotion, a removal and a leave take", () => {
  it("a demotion revokes the person's pending invitations and frees their seats; their session stays, its role checked online", async () => {
    const U = MOCK_TENANT_IDS.umbrella;
    const { api, local } = await inCompany("tom@example.com", U);
    const transport = new MockTenantServer({ storage: local, accountStore: new MockTaskaStore(), latencyMs: 0 }).transport();
    const priyaAccount = (await transport.startWebSession({ email: "priya@example.com", password: "x" }, key())) as { accessToken: string };
    const priyaCompany = (await transport.createTenantSession(priyaAccount.accessToken, U, key())) as { accessToken: string };
    await api.setTenantMemberRole(U, priya, "MEMBER", "1", key());
    // The old session still answers — the reader's next request is not refused (ruling 2) …
    await expect(transport.getTenantQuotas(priyaCompany.accessToken, U, new AbortController().signal)).resolves.toBeTruthy();
    // … and an admin write with it is the role's refusal, checked online (contracts §2).
    await expect(
      transport.createTenantInvitation(priyaCompany.accessToken, U, { email: "x@example.com", role: "MEMBER", projectGrants: [] }, key()),
    ).rejects.toMatchObject({ status: 403, code: "SCOPE_DENIED" });
    expect((await invitations(api, U)).map((item: Invitation) => item.state)).toEqual(["REVOKED"]);
    expect((await seats(api, U))?.reserved).toBe(0n);
  });

  it("suspension keeps the seat, ends the person's session and their project rows; reactivation is a MEMBER with no projects", async () => {
    const { local, open } = browser();
    // Tom's own company session, straight from the server over the same storage.
    const server = new MockTenantServer({ storage: local, accountStore: new MockTaskaStore(), latencyMs: 0 });
    const transport = server.transport();
    const tomAccount = (await transport.startWebSession({ email: "tom@example.com", password: "x" }, key())) as { accessToken: string };
    const tomCompany = (await transport.createTenantSession(tomAccount.accessToken, NW, key())) as { accessToken: string };
    const signal = new AbortController().signal;
    await expect(transport.listTenantMembers(tomCompany.accessToken, NW, {}, signal)).resolves.toBeTruthy();

    const admin = open();
    await admin.signIn({ email: "anna@example.com", password: "x" });
    await admin.enterCompany(NW);
    expect((await admin.listMembers(MOCK_PROJECT_IDS.taska)).map((member) => member.userId)).toContain(tom);
    await admin.setTenantMemberRole(NW, tom, "TENANT_ADMIN", "1", key());
    await admin.setTenantMemberState(NW, tom, "SUSPENDED", "2", key());
    expect(await seats(admin)).toEqual({ used: 4n, reserved: 1n, limit: 5n });
    await expect(transport.listTenantMembers(tomCompany.accessToken, NW, {}, signal)).rejects.toMatchObject({ status: 401 });
    expect((await admin.listMembers(MOCK_PROJECT_IDS.taska)).map((member) => member.userId)).not.toContain(tom);

    await admin.setTenantMemberState(NW, tom, "ACTIVE", "3", key());
    expect(row(await members(admin), tom)).toMatchObject({ role: "MEMBER", state: "ACTIVE", version: "4" });
    expect((await admin.listMembers(MOCK_PROJECT_IDS.taska)).map((member) => member.userId)).not.toContain(tom);
  });

  it("a removal is 202 with an operation; with memberOperationStepMs it is under way, and the seat is free once it succeeds", async () => {
    let clock = Date.now();
    const now = () => clock;
    const { api, local } = await inCompany("anna@example.com", NW, (storage) => hooks(storage, { memberOperationStepMs: 1000 }), now);
    const operation = await api.removeTenantMember(NW, sofia, "1", key());
    expect(operation).toMatchObject({ state: "PENDING", type: "removeTenantMember", tenantId: NW });
    expect(operation).not.toHaveProperty("subjectUserId");
    expect(facts(await caught(api.removeTenantMember(NW, sofia, "1", key())))).toEqual({ status: 409, code: "INVALID_STATE" });
    expect(await seats(api)).toEqual({ used: 4n, reserved: 1n, limit: 5n });
    clock += 2500;
    await expect(api.getTenantOperation(NW, operation.id)).resolves.toMatchObject({ state: "SUCCEEDED" });
    expect((await members(api)).map((item) => item.userId)).not.toContain(sofia);
    expect(await seats(api)).toEqual({ used: 3n, reserved: 1n, limit: 5n });
    hooks(local, {});
  });

  it("the owner cannot leave; the last-admin rule stands for any other admin", async () => {
    const { api } = await inCompany("anna@example.com", NW);
    expect(facts(await caught(api.leaveTenant(NW, key())))).toEqual({ status: 409, code: "OWNER_MEMBERSHIP_PROTECTED" });
    expect(api.currentWorkspace()?.tenantId).toBe(NW);
  });
});

describe("parity points (§7)", () => {
  it("WEB_GLOBAL is 400 TENANT_REQUIRED; another company's session is 403 TENANT_MISMATCH", async () => {
    const local = new MemoryStorage();
    const server = new MockTenantServer({ storage: local, accountStore: new MockTaskaStore(), latencyMs: 0 });
    const transport = server.transport();
    const account = (await transport.startWebSession({ email: "anna@example.com", password: "x" }, key())) as { accessToken: string };
    const globex = (await transport.createTenantSession(account.accessToken, MOCK_TENANT_IDS.globex, key())) as { accessToken: string };
    const signal = new AbortController().signal;
    await expect(transport.listTenantMembers(account.accessToken, NW, {}, signal)).rejects.toMatchObject({ status: 400, code: "TENANT_REQUIRED" });
    await expect(transport.listTenantMembers(globex.accessToken, NW, {}, signal)).rejects.toMatchObject({ status: 403, code: "TENANT_MISMATCH" });
    await expect(transport.getTenantQuotas(globex.accessToken, NW, signal)).rejects.toMatchObject({ status: 403, code: "TENANT_MISMATCH" });
  });

  it("the members cursor is bound to the membership generation: a change in between makes it a 400", async () => {
    const { api } = await inCompany("anna@example.com", NW);
    const first = await api.listTenantMembers(NW, { limit: 2 });
    expect(first.items.length).toBe(2);
    expect(first.nextCursor).toEqual(expect.any(String));
    await api.setTenantMemberRole(NW, sofia, "TENANT_ADMIN", "1", key());
    expect(facts(await caught(api.listTenantMembers(NW, { cursor: first.nextCursor ?? "", limit: 2 })))).toEqual({
      status: 400,
      code: "VALIDATION_FAILED",
    });
    // readAllPages starts again once, and reads the whole list.
    expect((await members(api)).length).toBe(4);
  });

  it("the session layer refuses a call for a company the tab does not hold, without a request", async () => {
    const { api, local } = await inCompany("anna@example.com", NW);
    const before = local.getItem(MOCK_SERVER_KEY);
    await expect(api.listTenantMembers(MOCK_TENANT_IDS.globex)).rejects.toBeInstanceOf(WorkspaceClosedError);
    expect(local.getItem(MOCK_SERVER_KEY)).toBe(before);
    expect(api.currentWorkspace()?.tenantId).toBe(NW);
  });

  it("a re-entry after the reader's own change is a new company session, and the tab keeps its company", async () => {
    const { api } = await inCompany("tom@example.com", MOCK_TENANT_IDS.umbrella);
    const before = api.currentWorkspace();
    await api.setTenantMemberRole(MOCK_TENANT_IDS.umbrella, priya, "MEMBER", "1", key());
    await api.reenterCompany(MOCK_TENANT_IDS.umbrella);
    const after = api.currentWorkspace();
    expect(after?.tenantId).toBe(MOCK_TENANT_IDS.umbrella);
    expect(after?.tenantSessionId).not.toBe(before?.tenantSessionId);
    await expect(members(api, MOCK_TENANT_IDS.umbrella)).resolves.toHaveLength(3);
  });

  it("a grant role outside the dictionary is refused with its field; the umbrella research project accepts Priya's grants", async () => {
    const U = MOCK_TENANT_IDS.umbrella;
    const { api } = await inCompany("tom@example.com", U);
    const created = await api.createTenantInvitation(
      U,
      { email: "ravi@example.com", role: "MEMBER", projectGrants: [{ projectId: MOCK_TENANT_PROJECT_IDS.umbrellaResearch, role: "VIEWER" }] },
      key(),
    );
    expect(created.projectGrants).toEqual([{ projectId: MOCK_TENANT_PROJECT_IDS.umbrellaResearch, role: "VIEWER" }]);
  });
});
