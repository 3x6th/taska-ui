import { describe, expect, it } from "vitest";
import { MemoryStorage } from "../../test/memoryStorage";
import type { Board, UserSummary } from "../../domain/types";
import type { TaskaApi } from "../TaskaApi";
import { readAllPages, seatsOf, type Membership } from "../tenantMembers";
import { createLocalLockManager } from "../webSession";
import { MOCK_ACCOUNT_IDS, MOCK_DELETED_ACCOUNT_ID, MOCK_FORMER_ACCOUNT_ID, MOCK_PROJECT_IDS } from "./MockTaskaApi";
import { MOCK_SERVER_KEY, MOCK_TENANT_HOOKS_KEY, MOCK_TENANT_IDS, MOCK_TENANT_PROJECT_IDS } from "./MockTenantServer";
import { createCompaniesMockApi } from "./mockCompanies";

/*
 * A deleted account in the companies mock (TAS-529, api-contract-guard §6 and
 * Addendum 2): the seed's own after its cleanup — Initech's HLP-3 — and the
 * `deletedAccounts` hook on Sofia in Northwind, in the window
 * (`cleanup: false`) and after the cleanup (the default). The wire is the
 * mark alone; nothing the account carried is answered anywhere; the cleanup is
 * the existing removal, once, and writes no history.
 */

const { anna, sofia } = MOCK_ACCOUNT_IDS;
const T = MOCK_DELETED_ACCOUNT_ID;
const NW: string = MOCK_TENANT_IDS.northwind;
const IN: string = MOCK_TENANT_IDS.initech;
const WEB = MOCK_PROJECT_IDS.web;
const TASKA = MOCK_PROJECT_IDS.taska;
const tombstone = (id: string): UserSummary => ({ id, displayName: null, avatarUrl: null, deleted: true });

async function inCompany(email: string, tenantId: string, hooks?: Record<string, unknown>) {
  const local = new MemoryStorage();
  if (hooks) local.setItem(MOCK_TENANT_HOOKS_KEY, JSON.stringify(hooks));
  const locks = createLocalLockManager();
  const api = createCompaniesMockApi({ local, session: new MemoryStorage(), locks, events: null, latencyMs: 0, ownershipWaitMs: 25 });
  await api.signIn({ email, password: "x" });
  await api.enterCompany(tenantId);
  return { api, local, setHooks: (value: Record<string, unknown>) => local.setItem(MOCK_TENANT_HOOKS_KEY, JSON.stringify(value)) };
}

const members = (api: TaskaApi, tenantId: string) => readAllPages((params) => api.listTenantMembers(tenantId, params));
const row = (rows: Membership[], userId: string) => rows.find((item) => item.userId === userId);
const cards = (board: Board) => [...board.columns.flatMap((column) => column.issues), ...board.unplacedIssues];

/** Every read of the panel of `issueKey`, as one string — what a leak would show up in. */
async function panelReads(api: TaskaApi, issueKey: string) {
  const issue = await api.getIssueByKey(issueKey);
  const details = await api.getIssue(issue.projectId, issue.id);
  const comments = await api.listComments(issue.projectId, issue.id);
  const worklogs = await api.listIssueWorklogs(issue.projectId, issue.id);
  return { issue, details, comments, worklogs, all: JSON.stringify([details, comments, worklogs]) };
}

describe("the seed's deleted account — Initech's HLP-3, after the cleanup", () => {
  it("is the mark on every person the panel's reads name, and nothing the account carried", async () => {
    const { api } = await inCompany("anna@example.com", IN);
    const { details, comments, worklogs } = await panelReads(api, "HLP-3");

    expect(details.issue.reporter).toEqual(tombstone(T));
    // The assignment went with the cleanup; its ASSIGNED row stays, and names the account by its mark.
    expect(details.issue.assigneeId).toBeNull();
    const assigned = details.history.find((event) => event.eventType === "ASSIGNED");
    expect(assigned?.participants?.[T]).toEqual(tombstone(T));
    for (const event of details.history.filter((item) => item.actorUserId === T)) expect(event.actor).toEqual(tombstone(T));
    expect(details.history.map((event) => event.eventType)).toEqual([
      "CREATED",
      "ASSIGNED",
      "TRANSITIONED",
      "ATTACHMENT_UPLOADED",
      "WORKLOG_ADDED",
      "WORKLOG_ADDED",
    ]);
    expect(details.issue.attachments?.[0]).toMatchObject({ uploadedBy: T, uploadedByUser: tombstone(T) });
    expect(comments.items.find((item) => item.authorUserId === T)?.author).toEqual(tombstone(T));
    expect(worklogs.items.find((item) => item.authorUserId === T)?.author).toEqual(tombstone(T));
    // Beside it, an account nobody can name: no summary, no mark — «Unknown» on screen.
    expect(worklogs.items.find((item) => item.authorUserId === MOCK_FORMER_ACCOUNT_ID)?.author).toBeNull();
  });

  it("holds no seat, is listed nowhere and is found by nobody", async () => {
    const { api } = await inCompany("anna@example.com", IN);

    expect(row(await members(api, IN), T)).toBeUndefined();
    expect(seatsOf(await api.getTenantQuotas(IN))).toMatchObject({ used: 2n, reserved: 0n });
    expect((await api.listMembers(MOCK_TENANT_PROJECT_IDS.initechHelpdesk)).map((member) => member.userId)).not.toContain(T);
    expect((await api.searchUsers({ query: "deleted" })).items).toEqual([]);
  });
});

describe("the deletedAccounts hook (Addendum 2)", () => {
  it("in the window (`cleanup: false`) marks Sofia on every read and removes nothing", async () => {
    const before = await inCompany("anna@example.com", NW);
    const face = (await before.api.listMembers(WEB)).find((member) => member.userId === sofia)?.user?.avatarUrl;
    expect(face).toEqual(expect.any(String));

    const { api } = await inCompany("anna@example.com", NW, { deletedAccounts: [{ userId: sofia, cleanup: false }] });

    // Her company row: still ACTIVE, still holding its seat — marked, with no name and no address.
    const company = row(await members(api, NW), sofia);
    expect(company).toMatchObject({ state: "ACTIVE", role: "MEMBER", deleted: true, displayName: null, email: null });
    expect(seatsOf(await api.getTenantQuotas(NW))).toMatchObject({ used: 4n, reserved: 1n });
    // Her project row: kept, with its role, and the mark instead of the person.
    expect((await api.listMembers(WEB)).find((member) => member.userId === sofia)).toEqual(
      expect.objectContaining({ userId: sofia, role: "MEMBER", deleted: true }),
    );
    expect((await api.listMembers(WEB)).find((member) => member.userId === sofia)).not.toHaveProperty("user");
    expect((await api.getProjectStats()).find((stats) => stats.projectId === WEB)?.members.find((member) => member.userId === sofia)).toMatchObject({
      deleted: true,
    });
    // Her assignments: kept, marked.
    const board = await api.getBoard(WEB, { includeDone: true });
    const hers = cards(board).filter((card) => card.assignee?.id === sofia);
    expect(hers.length).toBeGreaterThan(0);
    for (const card of hers) expect(card.assignee).toEqual(tombstone(sofia));
    const web12 = await panelReads(api, "WEB-12");
    expect(web12.details.issue.assignee).toEqual(tombstone(sofia));
    // Her words and her subscription on TAS: the mark, never the name, the address or the face.
    const tas107 = await panelReads(api, "TAS-107");
    expect(tas107.comments.items.find((item) => item.authorUserId === sofia)?.author).toEqual(tombstone(sofia));
    const tas101 = await panelReads(api, "TAS-101");
    expect(tas101.details.issue.watchers?.watchers.find((item) => item.userId === sofia)).toMatchObject({ displayName: null, avatarUrl: null, deleted: true });
    for (const { all } of [web12, tas107, tas101]) {
      expect(all).not.toContain("Sofia");
      expect(all).not.toContain("sofia@example.com");
      expect(all).not.toContain(face);
    }
    expect(JSON.stringify(await members(api, NW))).not.toContain("sofia@example.com");
    // Never found, by name or by address.
    expect((await api.searchUsers({ query: "Sofia" })).items).toEqual([]);
    expect((await api.searchUsers({ query: "sofia@example" })).items).toEqual([]);
  });

  it("with its cleanup, once: her memberships removed, her seat, rows and assignments with them — and no history written", async () => {
    const { api, local, setHooks } = await inCompany("anna@example.com", NW);
    const historyOf = async (key: string) => (await panelReads(api, key)).details.history.length;
    const tas107Before = await historyOf("TAS-107");
    const web12Before = await historyOf("WEB-12");
    const notificationsBefore = (await api.listNotifications()).items.length;
    const stateKeys = Object.keys(JSON.parse(local.getItem(MOCK_SERVER_KEY) ?? "{}") as object).sort();

    setHooks({ deletedAccounts: [{ userId: sofia }] });

    expect(row(await members(api, NW), sofia)).toBeUndefined();
    expect(seatsOf(await api.getTenantQuotas(NW))).toMatchObject({ used: 3n, reserved: 1n });
    expect((await api.listMembers(WEB)).map((member) => member.userId)).not.toContain(sofia);
    expect(cards(await api.getBoard(WEB, { includeDone: true })).some((card) => card.assignee?.id === sofia)).toBe(false);
    // What she wrote keeps her id and is drawn by the mark.
    const tas107 = await panelReads(api, "TAS-107");
    expect(tas107.comments.items.find((item) => item.authorUserId === sofia)?.author).toEqual(tombstone(sofia));
    expect(tas107.all).not.toContain("Sofia");
    // The cleanup is silent: no history row, no notification (A124).
    expect(tas107.details.history.length).toBe(tas107Before);
    expect(await historyOf("WEB-12")).toBe(web12Before);
    expect((await api.listNotifications()).items.length).toBe(notificationsBefore);
    // Once: a second read finds nothing left to remove, and the server's state keeps its shape and its key.
    expect(seatsOf(await api.getTenantQuotas(NW))).toMatchObject({ used: 3n, reserved: 1n });
    const state = JSON.parse(local.getItem(MOCK_SERVER_KEY) ?? "{}") as { v?: number; memberships?: Array<{ userId: string; tenantId: string; state: string }> };
    expect(state.v).toBe(5);
    expect(Object.keys(state).sort()).toEqual(stateKeys);
    expect(state.memberships?.filter((item) => item.userId === sofia && item.state !== "REMOVED")).toEqual([]);
    expect(JSON.stringify(state)).not.toContain("Sofia");

    // Taken out, the account is named again; what the cleanup removed stays removed.
    setHooks({});
    expect((await panelReads(api, "TAS-107")).comments.items.find((item) => item.authorUserId === sofia)?.author?.displayName).toBe("Sofia Reyes");
    expect(row(await members(api, NW), sofia)).toBeUndefined();
  });

  it("leaves everybody else as they were — Anna is named, Tom is listed", async () => {
    const { api } = await inCompany("anna@example.com", NW, { deletedAccounts: [{ userId: sofia, cleanup: false }] });

    const rows = await members(api, NW);
    expect(row(rows, anna)).toMatchObject({ displayName: "Anna Ivanova", deleted: false });
    expect(row(rows, MOCK_ACCOUNT_IDS.tom)).toMatchObject({ displayName: "Tom Becker", deleted: false });
    const tas = await api.listMembers(TASKA);
    expect(tas.find((member) => member.userId === anna)).toMatchObject({ user: { displayName: "Anna Ivanova" } });
    expect(tas.some((member) => member.deleted)).toBe(false);
  });
});
