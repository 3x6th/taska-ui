import { beforeEach, describe, expect, it } from "vitest";
import { MOCK_ATTACHMENT_TRIGGERS, MockTaskaApi } from "./MockTaskaApi";
import type { Issue, Project } from "../../domain/types";
import {
  ATTACHMENT_MAX_SIZE_BYTES,
  AttachmentStoreError,
  attachmentSizeRefusalMessage,
  attachmentTypeRefusalMessage,
} from "../attachments";
import { ESTIMATE_MAX_MESSAGE, STORY_POINTS_RANGE_MESSAGE } from "../planningFields";

/**
 * The mock is the reference implementation of the TaskaApi contract: it is what
 * the UI is developed against and what `api-contract-guard` compares the REST
 * and hybrid adapters to. These tests pin the behaviour that parity is measured
 * against, not the seed data.
 */
describe("MockTaskaApi", () => {
  let api: MockTaskaApi;
  let project: Project;

  beforeEach(async () => {
    // The mock session lives in localStorage so it survives a reload; clearing
    // it here keeps every case independent of the one before it.
    window.localStorage.clear();
    api = new MockTaskaApi();
    [project] = await api.listProjects();
  });

  describe("session", () => {
    it("holds no session until someone signs in", () => {
      expect(api.hasSession()).toBe(false);
    });

    it("holds a session after a successful sign-in and drops it on sign-out", async () => {
      await api.login({ email: "anna@example.com", password: "mock-accepts-anything" });
      expect(api.hasSession()).toBe(true);

      await api.logout();
      expect(api.hasSession()).toBe(false);
    });

    it("does not open a session for a rejected sign-in", async () => {
      await expect(api.login({ email: "nobody@example.com", password: "x" })).rejects.toThrow();
      expect(api.hasSession()).toBe(false);
    });

    it("does not open a session for an accepted invitation", async () => {
      // `POST /auth/invitations/accept` answers 204 with no tokens, so `rest`
      // cannot produce a session here and neither may the mock — otherwise an
      // empty token and an empty password would walk straight past the route
      // guard in mock mode. The gap is recorded in docs/ai/API-DIVERGENCE.md.
      await api.acceptInvitation({ token: "", newPassword: "" });

      expect(api.hasSession()).toBe(false);
    });

    it("restores the signed-in user on the next page load", async () => {
      await api.login({ email: "mark@example.com", password: "mock-accepts-anything" });

      // A fresh instance is what a reload produces: same storage, new store.
      const reloaded = new MockTaskaApi();

      expect(reloaded.hasSession()).toBe(true);
      await expect(reloaded.getCurrentUser()).resolves.toMatchObject({ email: "mark@example.com" });
    });

    it("drops a stored id that no longer names an active user", () => {
      window.localStorage.setItem("taska.mockSession", "00000000-0000-4000-8000-000000000000");

      expect(new MockTaskaApi().hasSession()).toBe(false);
      expect(window.localStorage.getItem("taska.mockSession")).toBeNull();
    });
  });

  describe("workflow transitions", () => {
    it("moves an issue to the target status of a legal transition", async () => {
      const { items } = await api.listIssues(project.id);
      const todo = items.find((issue) => issue.status === "TODO");
      expect(todo).toBeDefined();

      const workflow = await api.getWorkflow(project.id);
      const from = workflow.statuses.find((status) => status.statusKey === "TODO");
      const transition = workflow.transitions.find((item) => item.fromStatusId === from?.id);
      expect(transition).toBeDefined();

      const target = workflow.statuses.find((status) => status.id === transition!.toStatusId);
      const moved = await api.transitionIssue(project.id, todo!.id, transition!.id);

      expect(moved.status).toBe(target!.statusKey);
      expect(moved.version).toBe(todo!.version + 1);
    });

    it("rejects a transition that is not legal from the current status", async () => {
      const { items } = await api.listIssues(project.id);
      const done = items.find((issue) => issue.status === "DONE");
      expect(done).toBeDefined();

      const workflow = await api.getWorkflow(project.id);
      const todoStatus = workflow.statuses.find((status) => status.statusKey === "TODO");
      const fromTodo = workflow.transitions.find((item) => item.fromStatusId === todoStatus?.id);

      await expect(api.transitionIssue(project.id, done!.id, fromTodo!.id)).rejects.toThrow();
    });

    it("records a TRANSITIONED history event carrying both endpoints", async () => {
      const { items } = await api.listIssues(project.id);
      const todo = items.find((issue) => issue.status === "TODO")!;

      const workflow = await api.getWorkflow(project.id);
      const from = workflow.statuses.find((status) => status.statusKey === "TODO");
      const transition = workflow.transitions.find((item) => item.fromStatusId === from?.id)!;

      await api.transitionIssue(project.id, todo.id, transition.id);
      const { history } = await api.getIssue(project.id, todo.id);
      const event = history.find((item) => item.eventType === "TRANSITIONED");

      expect(event).toBeDefined();
      expect(event!.payload.from).toBe("TODO");
      expect(event!.payload.to).toBeTruthy();
    });
  });

  describe("comments", () => {
    it("returns the newest comment first", async () => {
      const { items } = await api.listIssues(project.id);
      const issue = items[0];

      await api.addComment(project.id, issue.id, "first");
      const second = await api.addComment(project.id, issue.id, "second");

      const page = await api.listComments(project.id, issue.id);
      expect(page.items[0].id).toBe(second.id);
    });

    it("paginates with a total count spanning every page", async () => {
      const { items } = await api.listIssues(project.id);
      const issue = items[0];

      for (const body of ["a", "b", "c"]) {
        await api.addComment(project.id, issue.id, body);
      }

      const first = await api.listComments(project.id, issue.id, { page: 0, pageSize: 2 });
      const rest = await api.listComments(project.id, issue.id, { page: 1, pageSize: 2 });

      expect(first.items).toHaveLength(2);
      expect(first.totalCount).toBeGreaterThanOrEqual(3);
      expect(rest.items[0].id).not.toBe(first.items[0].id);
    });

    it("refuses to edit or delete a comment the current user does not own", async () => {
      const { items } = await api.listIssues(project.id);
      const me = await api.getCurrentUser();

      // Walk the seed until an issue with a foreign comment turns up, so this
      // test cannot silently pass by picking an uncommented issue. The first
      // shipped version did exactly that — see docs/ai/HARNESS.md.
      let issueId: string | undefined;
      let foreignId: string | undefined;
      for (const issue of items) {
        const page = await api.listComments(project.id, issue.id);
        const foreign = page.items.find((comment) => comment.authorUserId !== me.id);
        if (foreign) {
          issueId = issue.id;
          foreignId = foreign.id;
          break;
        }
      }
      expect(issueId).toBeDefined();
      expect(foreignId).toBeDefined();

      await expect(api.updateComment(project.id, issueId!, foreignId!, "hijack")).rejects.toThrow();
      await expect(api.deleteComment(project.id, issueId!, foreignId!)).rejects.toThrow();
    });
  });

  describe("issue links", () => {
    const issueByKey = async (issueKey: string) => {
      const { items } = await api.listIssues(project.id);
      const issue = items.find((item) => item.issueKey === issueKey);
      expect(issue, `seed is missing ${issueKey}`).toBeDefined();
      return issue!;
    };

    it("seeds links so the panel has something to show on first load", async () => {
      const source = await issueByKey("TAS-101");
      const links = await api.listIssueLinks(project.id, source.id);

      expect(links.length).toBeGreaterThan(0);
      expect(links.every((link) => link.id && link.createdAt)).toBe(true);
    });

    it("answers each end with the relation as that end sees it", async () => {
      const source = await issueByKey("TAS-101");
      const target = await issueByKey("TAS-102");

      const fromSource = (await api.listIssueLinks(project.id, source.id)).find(
        (link) => link.targetIssueId === target.id,
      );
      const fromTarget = (await api.listIssueLinks(project.id, target.id)).find(
        (link) => link.sourceIssueId === source.id,
      );

      // Same link, same id, two views — this is what `viewLinkType` means, and
      // the receiving end's value is not one the request enum can express.
      expect(fromSource!.id).toBe(fromTarget!.id);
      expect(fromSource!.viewLinkType).toBe("BLOCKS");
      expect(fromTarget!.viewLinkType).toBe("IS_BLOCKED_BY");
    });

    it("creates a link and returns it as the asking issue sees it", async () => {
      const issue = await issueByKey("TAS-104");
      const target = await issueByKey("TAS-105");

      const link = await api.createIssueLink(project.id, issue.id, {
        targetIssueId: target.id,
        linkType: "RELATES_TO",
      });

      expect(link).toMatchObject({
        projectId: project.id,
        sourceIssueId: issue.id,
        targetIssueId: target.id,
        viewLinkType: "RELATES_TO",
      });
      await expect(api.listIssueLinks(project.id, issue.id)).resolves.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: link.id })]),
      );
    });

    it("refuses to link an issue to itself", async () => {
      const issue = await issueByKey("TAS-104");

      await expect(
        api.createIssueLink(project.id, issue.id, { targetIssueId: issue.id, linkType: "BLOCKS" }),
      ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    });

    it("refuses a duplicate link in either direction", async () => {
      const source = await issueByKey("TAS-101");
      const target = await issueByKey("TAS-102");

      await expect(
        api.createIssueLink(project.id, source.id, { targetIssueId: target.id, linkType: "RELATES_TO" }),
      ).rejects.toMatchObject({ code: "ALREADY_EXISTS" });
      // The seeded link runs source -> target; asking from the other end is the
      // same relation, not a second one.
      await expect(
        api.createIssueLink(project.id, target.id, { targetIssueId: source.id, linkType: "RELATES_TO" }),
      ).rejects.toMatchObject({ code: "ALREADY_EXISTS" });
    });

    it("refuses an issue or a target it does not know", async () => {
      const issue = await issueByKey("TAS-104");
      const missing = "00000000-0000-4000-8000-000000000000";

      await expect(
        api.createIssueLink(project.id, issue.id, { targetIssueId: missing, linkType: "BLOCKS" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        api.createIssueLink(project.id, missing, { targetIssueId: issue.id, linkType: "BLOCKS" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(api.listIssueLinks(project.id, missing)).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("deletes a link from either of its ends", async () => {
      const source = await issueByKey("TAS-101");
      const target = await issueByKey("TAS-102");
      const [link] = (await api.listIssueLinks(project.id, source.id)).filter(
        (item) => item.targetIssueId === target.id,
      );

      // Removed from the receiving end: the route is issue-scoped and that end
      // sees the link just as much.
      await api.deleteIssueLink(project.id, target.id, link.id);

      await expect(api.listIssueLinks(project.id, source.id)).resolves.toEqual(
        expect.not.arrayContaining([expect.objectContaining({ id: link.id })]),
      );
      await expect(api.listIssueLinks(project.id, target.id)).resolves.toEqual(
        expect.not.arrayContaining([expect.objectContaining({ id: link.id })]),
      );
    });

    it("refuses to delete a link that does not belong to the issue", async () => {
      const unrelated = await issueByKey("TAS-104");
      const source = await issueByKey("TAS-101");
      const [link] = await api.listIssueLinks(project.id, source.id);

      await expect(api.deleteIssueLink(project.id, unrelated.id, link.id)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(api.deleteIssueLink(project.id, source.id, "no-such-link")).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  describe("issue listing", () => {
    it("filters by status without leaking other statuses", async () => {
      const { items } = await api.listIssues(project.id, { status: "DONE" });
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((issue) => issue.status === "DONE")).toBe(true);
    });

    it("excludes deleted issues", async () => {
      const before = await api.listIssues(project.id);
      const victim = before.items[0];

      await api.deleteIssue(project.id, victim.id);
      const after = await api.listIssues(project.id);

      expect(after.items.some((issue) => issue.id === victim.id)).toBe(false);
    });
  });

  /**
   * The five planning fields (TAS-189), and mostly one defect:
   * `PUT /issues/{issueId}` is a **full replace** on the gateway, so a field the
   * request omits is erased rather than preserved
   * (`IssueServiceImpl.updateIssue` on backend `develop`, read 2026-09-06). The
   * board edits a summary, a description and a priority one at a time; the day
   * backend PR #148 exposes these fields over REST, every one of those edits
   * would wipe the story points and both dates unless the client re-sends what
   * it is keeping.
   *
   * These cases pin that on the mock, which is the reference implementation and
   * what the e2e suite runs against. `RestTaskaApi.test.ts` pins the same
   * behaviour on the wire, including the body shape, and both sides share the
   * rules in src/api/planningFields.ts so they cannot answer differently.
   */
  describe("planning fields", () => {
    const issueByKey = async (key: string): Promise<Issue> => {
      const { items } = await api.listIssues(project.id, { pageSize: 100 });
      const found = items.find((item) => item.issueKey === key);
      if (!found) throw new Error(`the seed has no ${key}`);
      return found;
    };

    it("seeds the two values a plausible reader gets wrong", async () => {
      // Zero points is an estimate of nothing, not the absence of an estimate,
      // and 1.5 is legal because the field is a double. Both are seeded so the
      // UI half has something to be wrong about.
      expect((await issueByKey("TAS-102")).storyPoints).toBe(0);
      expect((await issueByKey("TAS-103")).storyPoints).toBe(1.5);

      const full = await issueByKey("TAS-101");
      expect(full).toMatchObject({
        storyPoints: 3,
        startDate: "2026-06-15",
        dueDate: "2026-06-26",
        originalEstimateMinutes: 480,
        remainingEstimateMinutes: 240,
      });
    });

    it("keeps all five when only the summary is edited — the regression this exists for", async () => {
      const before = await issueByKey("TAS-101");

      const updated = await api.updateIssue(project.id, before.id, { summary: "Login form validation, revisited" });

      expect(updated.summary).toBe("Login form validation, revisited");
      expect(updated).toMatchObject({
        storyPoints: 3,
        startDate: "2026-06-15",
        dueDate: "2026-06-26",
        originalEstimateMinutes: 480,
        remainingEstimateMinutes: 240,
      });
      // And the store agrees with what the write answered.
      const { issue } = await api.getIssue(project.id, before.id);
      expect(issue).toMatchObject({
        storyPoints: 3,
        startDate: "2026-06-15",
        dueDate: "2026-06-26",
        originalEstimateMinutes: 480,
        remainingEstimateMinutes: 240,
      });
    });

    it("keeps zero and a fraction through an unrelated edit, rather than reading them as nothing", async () => {
      const zero = await issueByKey("TAS-102");
      const half = await issueByKey("TAS-103");

      expect((await api.updateIssue(project.id, zero.id, { priority: "HIGH" })).storyPoints).toBe(0);
      expect((await api.updateIssue(project.id, half.id, { description: "Rewritten." })).storyPoints).toBe(1.5);
    });

    it("clears the one field asked for by an explicit null and leaves the others standing", async () => {
      const before = await issueByKey("TAS-101");

      const updated = await api.updateIssue(project.id, before.id, { storyPoints: null });

      expect(updated.storyPoints).toBeNull();
      expect(updated).toMatchObject({
        startDate: "2026-06-15",
        dueDate: "2026-06-26",
        originalEstimateMinutes: 480,
        remainingEstimateMinutes: 240,
      });
    });

    it("reads an explicitly undefined key as 'leave it alone', not as 'clear it'", async () => {
      const before = await issueByKey("TAS-101");

      // What a component produces by spreading a form state that has not been
      // touched. `Object.assign(issue, { ...input })` used to write the
      // `undefined` straight over the stored value.
      const updated = await api.updateIssue(project.id, before.id, { storyPoints: undefined, dueDate: undefined });

      expect(updated.storyPoints).toBe(3);
      expect(updated.dueDate).toBe("2026-06-26");
    });

    it("sets and clears each of the five in turn", async () => {
      const target = await issueByKey("TAS-104");

      const set = await api.updateIssue(project.id, target.id, {
        storyPoints: 0.25,
        startDate: "2026-07-01",
        dueDate: "2026-07-31",
        originalEstimateMinutes: 0,
        remainingEstimateMinutes: 45,
      });
      expect(set).toMatchObject({
        storyPoints: 0.25,
        startDate: "2026-07-01",
        dueDate: "2026-07-31",
        originalEstimateMinutes: 0,
        remainingEstimateMinutes: 45,
      });

      const cleared = await api.updateIssue(project.id, target.id, {
        storyPoints: null,
        startDate: null,
        dueDate: null,
        originalEstimateMinutes: null,
        remainingEstimateMinutes: null,
      });
      expect(cleared).toMatchObject({
        storyPoints: null,
        startDate: null,
        dueDate: null,
        originalEstimateMinutes: null,
        remainingEstimateMinutes: null,
      });
    });

    it("refuses a story-point value the column cannot hold", async () => {
      const target = await issueByKey("TAS-104");
      const refuse = (storyPoints: number) => api.updateIssue(project.id, target.id, { storyPoints });

      // `>= 0` is what the server enforces even though its message says "must
      // be positive", so 0 is accepted and -0.5 is not.
      //
      // The sentence is asserted here and on the same input in
      // `RestTaskaApi.test.ts`: both read it from src/api/planningFields.ts, and
      // pinning it on both sides is what makes "a caller cannot tell which
      // implementation refused it" a test rather than a claim.
      await expect(refuse(-0.5)).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message: STORY_POINTS_RANGE_MESSAGE,
      });
      // numeric(5,2): above this the database raises and the answer is a 500.
      await expect(refuse(1000)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
      // Beyond the scale Postgres rounds silently — 1.235 would come back 1.23.
      await expect(refuse(1.235)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
      // JSON.stringify writes NaN as null, and null on this wire means "clear
      // it" — so an unguarded Number("") would erase the field it meant to set.
      await expect(refuse(Number.NaN)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });

      await expect(refuse(999.99)).resolves.toMatchObject({ storyPoints: 999.99 });
      await expect(refuse(0)).resolves.toMatchObject({ storyPoints: 0 });
    });

    it("refuses an estimate that is negative, fractional, or larger than an int32", async () => {
      const target = await issueByKey("TAS-104");

      await expect(
        api.updateIssue(project.id, target.id, { originalEstimateMinutes: -1 }),
      ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
      await expect(
        api.updateIssue(project.id, target.id, { remainingEstimateMinutes: 30.5 }),
      ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });

      // The bound the field has in all three descriptions of it — `format:
      // int32`, `int32` in the proto, `integer` in the column. Without it the
      // mock would store and display a value the gateway could not bind, which
      // is the one way these two stop being interchangeable on this input.
      // Asserted with the sentence, here and on the same input in
      // `RestTaskaApi.test.ts`.
      await expect(
        api.updateIssue(project.id, target.id, { originalEstimateMinutes: 2_147_483_648 }),
      ).rejects.toMatchObject({ code: "INVALID_ARGUMENT", message: ESTIMATE_MAX_MESSAGE });

      // Both ends of what is still accepted: zero is an estimate of nothing,
      // and the ceiling itself fits.
      await expect(
        api.updateIssue(project.id, target.id, { remainingEstimateMinutes: 0 }),
      ).resolves.toMatchObject({ remainingEstimateMinutes: 0 });
      await expect(
        api.updateIssue(project.id, target.id, { originalEstimateMinutes: 2_147_483_647 }),
      ).resolves.toMatchObject({ originalEstimateMinutes: 2_147_483_647 });
    });

    it("refuses a date that is not a real calendar day", async () => {
      const target = await issueByKey("TAS-104");
      const refuse = (startDate: string) => api.updateIssue(project.id, target.id, { startDate });

      await expect(refuse("2026-13-01")).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
      await expect(refuse("2026-02-30")).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
      await expect(refuse("01-09-2026")).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
      await expect(refuse("2026-9-1")).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
      // A leap day that exists, against one that does not.
      await expect(refuse("2028-02-29")).resolves.toMatchObject({ startDate: "2028-02-29" });
      await expect(refuse("2027-02-29")).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    });

    it("refuses a start date later than the due date stated in the same request", async () => {
      const target = await issueByKey("TAS-104");

      await expect(
        api.updateIssue(project.id, target.id, { startDate: "2026-08-02", dueDate: "2026-08-01" }),
      ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
      await expect(
        api.updateIssue(project.id, target.id, { startDate: "2026-08-01", dueDate: "2026-08-01" }),
      ).resolves.toMatchObject({ startDate: "2026-08-01", dueDate: "2026-08-01" });
    });

    it("refuses a start date past the *stored* due date, even when the same request clears that due date", async () => {
      // The check the contract does not state: `IssueServiceImpl` compares the
      // incoming start date against the due date already on the record, so
      // clearing the due date in the same breath does not help.
      const target = await issueByKey("TAS-101");

      await expect(
        api.updateIssue(project.id, target.id, { startDate: "2026-07-01", dueDate: null }),
      ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });

      // Nothing was written before the refusal.
      const { issue } = await api.getIssue(project.id, target.id);
      expect(issue).toMatchObject({ startDate: "2026-06-15", dueDate: "2026-06-26" });
    });

    it("refuses moving a whole window forward in one request, and accepts the same move in two", async () => {
      const target = await issueByKey("TAS-101");

      // The new pair is internally consistent, and it is still refused: the
      // incoming start is after the *stored* due date. This is the case a
      // reader meets first in practice, and the UI half has to lead with the
      // due date because of it.
      await expect(
        api.updateIssue(project.id, target.id, { startDate: "2026-07-01", dueDate: "2026-07-20" }),
      ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });

      await api.updateIssue(project.id, target.id, { dueDate: "2026-07-20" });
      await expect(
        api.updateIssue(project.id, target.id, { startDate: "2026-07-01" }),
      ).resolves.toMatchObject({ startDate: "2026-07-01", dueDate: "2026-07-20" });
    });

    it("refuses a due date earlier than the stored start date", async () => {
      const target = await issueByKey("TAS-105");
      expect(target.startDate).toBe("2026-06-20");

      await expect(
        api.updateIssue(project.id, target.id, { dueDate: "2026-06-01" }),
      ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
      await expect(
        api.updateIssue(project.id, target.id, { dueDate: "2026-06-20" }),
      ).resolves.toMatchObject({ dueDate: "2026-06-20" });
    });

    it("accepts the five on a create and refuses the same values it refuses on an update", async () => {
      const created = await api.createIssue(project.id, {
        issueType: "TASK",
        summary: "Plan the migration",
        description: "With dates.",
        priority: "MEDIUM",
        storyPoints: 2.5,
        startDate: "2026-09-01",
        dueDate: "2026-09-30",
        originalEstimateMinutes: 600,
      });

      expect(created).toMatchObject({
        storyPoints: 2.5,
        startDate: "2026-09-01",
        dueDate: "2026-09-30",
        originalEstimateMinutes: 600,
        // Not stated on the create, and there is no prior value to keep.
        remainingEstimateMinutes: null,
      });

      await expect(
        api.createIssue(project.id, {
          issueType: "TASK",
          summary: "Backwards",
          description: "",
          priority: "LOW",
          startDate: "2026-09-30",
          dueDate: "2026-09-01",
        }),
      ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    });

    it("carries storyPoints on a search hit and still carries nothing else the short DTO lacks", async () => {
      const { items } = await api.searchIssues({ query: "Login form validation" });
      const hit = items.find((item) => item.issueKey === "TAS-101");

      expect(hit).toBeDefined();
      expect(hit?.storyPoints).toBe(3);
      // The shape itself is pinned by the search section above; what this adds
      // is that a *seeded* value survives the mapping rather than arriving as
      // `undefined`, which is the failure a spread would have produced.
      expect(hit).not.toHaveProperty("dueDate");
      expect(hit).not.toHaveProperty("originalEstimateMinutes");
    });
  });

  /**
   * `GET /issues/search` as the deployed gateway was measured behaving on
   * 2026-08-23, not as the contract describes it. Two of those measurements are
   * the reason these cases exist at all: the runtime refuses a query below
   * three characters where the contract permits two, and refuses an empty one
   * where its own generated spec (`/v3/api-docs`) offers it as the parameter's
   * default. The e2e suite runs against
   * this mock, so a mock that quietly accepted either would let the suite pass
   * a case the gateway answers 400 to.
   */
  describe("issue search", () => {
    it("refuses a query below the minimum, and the empty string with it", async () => {
      await expect(api.searchIssues({ query: "bo" })).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message: "Search query must be at least 3 characters",
      });
      await expect(api.searchIssues({ query: "" })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
      // Whitespace is not length: the field the reader types into trims, and so
      // does this, or " a " would be a legal three-character search for one
      // character.
      await expect(api.searchIssues({ query: " a " })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    });

    it("treats an absent query as no text filter rather than as an empty one", async () => {
      // The trap the compensation exists for: omitting the parameter is a 200
      // with everything, sending it empty is a 400. They must not collapse.
      const everything = await api.searchIssues({});
      const inProject = await api.listIssues(project.id, { pageSize: 100 });

      expect(everything.totalCount).toBeGreaterThanOrEqual(inProject.items.length);
    });

    it("matches the key, the summary and the description, case-insensitively", async () => {
      const byKey = await api.searchIssues({ query: "tas-104", projectId: project.id, pageSize: 100 });
      expect(byKey.items.map((hit) => hit.issueKey)).toContain("TAS-104");

      const bySummary = await api.searchIssues({ query: "ONBOARDING", projectId: project.id, pageSize: 100 });
      expect(bySummary.items.map((hit) => hit.issueKey)).toContain("TAS-102");

      // The word appears in TAS-104's description and in no summary or key, so
      // this is the OR the probe recorded and not a coincidence of wording.
      const byDescription = await api.searchIssues({ query: "gRPC", projectId: project.id, pageSize: 100 });
      expect(byDescription.items.map((hit) => hit.issueKey)).toEqual(["TAS-104"]);
    });

    it("searches every project the caller can see, and no further", async () => {
      const hits = await api.searchIssues({ query: "board", pageSize: 100 });
      const projects = await api.listProjects();
      const keys = hits.items.map((hit) => hit.issueKey);

      // More than one project answers, which is what "no projectId" means.
      expect(new Set(keys.map((key) => key.split("-")[0])).size).toBeGreaterThan(1);
      // And nothing from a project this account is not in. Anna is a member of
      // three of the four seeded projects.
      const visible = new Set(projects.map((item) => item.projectKey));
      expect(keys.every((key) => visible.has(key.split("-")[0]))).toBe(true);
      expect(keys.some((key) => key.startsWith("MOB-"))).toBe(false);
    });

    it("scopes to one project when asked, and refuses a project that is not there", async () => {
      const scoped = await api.searchIssues({ query: "board", projectId: project.id, pageSize: 100 });
      expect(scoped.items.length).toBeGreaterThan(0);
      expect(scoped.items.every((hit) => hit.issueKey.startsWith(`${project.projectKey}-`))).toBe(true);

      await expect(api.searchIssues({ query: "board", projectId: "no-such-project" })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("refuses a project the caller is not a member of, the same way as one that is not there", async () => {
      // Mark is in the seed's fourth project and Anna is not, so the id has to
      // be fetched as him before the question can be asked as her.
      await api.login({ email: "mark@example.com", password: "mock-accepts-anything" });
      const marks = await api.listProjects();
      const notAnnas = marks.find((item) => !["TAS", "WEB", "OPS"].includes(item.projectKey));
      expect(notAnnas).toBeDefined();

      await api.login({ email: "anna@example.com", password: "mock-accepts-anything" });
      await expect(await api.listProjects().then((items) => items.map((item) => item.id))).not.toContain(notAnnas!.id);

      // Existence is not access. Checking only that the project exists let a
      // non-member read every issue in it — the mock stating an access rule in
      // its own comment and not keeping it, which is worse than not stating one.
      await expect(api.searchIssues({ query: "issues", projectId: notAnnas!.id })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("ANDs every filter onto the query", async () => {
      const all = await api.searchIssues({ query: "the", projectId: project.id, pageSize: 100 });
      const bugs = await api.searchIssues({
        query: "the",
        projectId: project.id,
        issueType: "BUG",
        priority: "HIGH",
        pageSize: 100,
      });

      expect(bugs.items.length).toBeGreaterThan(0);
      expect(bugs.items.length).toBeLessThan(all.items.length);
      expect(bugs.items.every((hit) => hit.issueType === "BUG" && hit.priority === "HIGH")).toBe(true);
    });

    it("counts the whole matching set and pages the answer after it", async () => {
      const whole = await api.searchIssues({ query: "the", projectId: project.id, pageSize: 100 });
      expect(whole.totalCount).toBeGreaterThan(2);

      const first = await api.searchIssues({ query: "the", projectId: project.id, page: 0, pageSize: 2 });
      const second = await api.searchIssues({ query: "the", projectId: project.id, page: 1, pageSize: 2 });

      expect(first.items).toHaveLength(2);
      // The count is about the search, not about the page — the first honest
      // issue total this frontend can print.
      expect(first.totalCount).toBe(whole.totalCount);
      expect(second.totalCount).toBe(whole.totalCount);
      expect(first.items.map((hit) => hit.id)).not.toEqual(second.items.map((hit) => hit.id));
    });

    it("answers with the seven fields of the short DTO and nothing else", async () => {
      const created = await api.createIssue(project.id, {
        issueType: "TASK",
        summary: "Unassigned needle for the search",
        description: "Nobody owns this one yet.",
        priority: "LOW",
      });

      const { items } = await api.searchIssues({ query: "needle", projectId: project.id, pageSize: 100 });
      const hit = items.find((item) => item.id === created.id);

      expect(hit).toBeDefined();
      // No status, no projectId, no description, no labels: a hit that carried
      // them would let a column or a card claim something the gateway never
      // sent. `storyPoints` is the seventh and last — backend PR #148 adds it
      // to `IssueShortResponseDto` and adds no dates and no estimates with it.
      expect(Object.keys(hit ?? {}).sort()).toEqual([
        "assigneeId",
        "id",
        "issueKey",
        "issueType",
        "priority",
        "storyPoints",
        "summary",
      ]);
      // Created without one, so this states "not estimated" rather than a value.
      expect(hit?.storyPoints).toBeNull();
      // `""` on the wire for nobody, `null` here, exactly as `Issue.assigneeId`.
      expect(hit?.assigneeId).toBeNull();
    });

    it("does not find a deleted issue", async () => {
      const created = await api.createIssue(project.id, {
        issueType: "TASK",
        summary: "Doomed haystack entry",
        description: "About to be deleted.",
        priority: "LOW",
      });
      await api.deleteIssue(project.id, created.id);

      const { items } = await api.searchIssues({ query: "haystack", projectId: project.id, pageSize: 100 });
      expect(items).toEqual([]);
    });
  });

  /**
   * The label rules the gateway states in TAS-119 — project scope, one name per
   * project case-insensitively, a HEX colour, and a soft delete that reaches
   * every issue at once. The cases below find their subjects in the seed rather
   * than naming them, so a reshuffled seed changes nothing here.
   */
  describe("labels", () => {
    it("lists the project's own labels and puts them on the issues that carry them", async () => {
      const labels = await api.listProjectLabels(project.id);
      expect(labels.length).toBeGreaterThan(0);
      expect(labels.every((label) => label.projectId === project.id && label.deletedAt === null)).toBe(true);

      const { items } = await api.listIssues(project.id);
      const carrier = items.find((issue) => issue.labels.length > 0);
      expect(carrier).toBeDefined();
      if (!carrier) return;

      // What the issue carries is the project's label narrowed to the three
      // fields the issue side of the contract has.
      const projectIds = labels.map((label) => label.id);
      expect(projectIds).toEqual(expect.arrayContaining(carrier.labels.map((label) => label.id)));
      expect(Object.keys(carrier.labels[0]).sort()).toEqual(["color", "id", "name"]);
    });

    it("creates a label, trimming the name the caller typed", async () => {
      const created = await api.createProjectLabel(project.id, { name: "  spacing  ", color: "#0052cc" });

      expect(created).toMatchObject({ projectId: project.id, name: "spacing", color: "#0052cc", deletedAt: null });
      expect((await api.listProjectLabels(project.id)).some((label) => label.id === created.id)).toBe(true);
    });

    it("refuses a name the project already uses, whatever its case", async () => {
      const [existing] = await api.listProjectLabels(project.id);

      await expect(
        api.createProjectLabel(project.id, { name: existing.name.toUpperCase(), color: "#123456" }),
      ).rejects.toThrow();
    });

    it("refuses a colour the contract's own pattern rejects", async () => {
      await expect(api.createProjectLabel(project.id, { name: "unheard-of", color: "red" })).rejects.toThrow();
      await expect(api.createProjectLabel(project.id, { name: "unheard-of", color: "#12345" })).rejects.toThrow();
    });

    it("lets a label keep its own name through a recolour", async () => {
      const [label] = await api.listProjectLabels(project.id);

      const updated = await api.updateProjectLabel(project.id, label.id, { name: label.name, color: "#123456" });

      expect(updated).toMatchObject({ id: label.id, name: label.name, color: "#123456" });
    });

    it("shows a rename through every issue carrying the label", async () => {
      const { items } = await api.listIssues(project.id);
      const carrier = items.find((issue) => issue.labels.length > 0);
      expect(carrier).toBeDefined();
      if (!carrier) return;
      const [carried] = carrier.labels;

      await api.updateProjectLabel(project.id, carried.id, { name: "renamed", color: "#123456" });

      const after = await api.getIssue(project.id, carrier.id);
      expect(after.issue.labels.find((label) => label.id === carried.id)).toEqual({
        id: carried.id,
        name: "renamed",
        color: "#123456",
      });
    });

    it("puts a label on an issue once and refuses the second attempt", async () => {
      const { items } = await api.listIssues(project.id);
      const bare = items.find((issue) => issue.labels.length === 0);
      const [label] = await api.listProjectLabels(project.id);
      expect(bare).toBeDefined();
      if (!bare) return;

      await api.addIssueLabel(project.id, bare.id, label.id);

      expect((await api.listIssueLabels(project.id, bare.id)).map((item) => item.id)).toEqual([label.id]);
      expect((await api.getIssue(project.id, bare.id)).issue.labels.map((item) => item.id)).toEqual([label.id]);
      await expect(api.addIssueLabel(project.id, bare.id, label.id)).rejects.toThrow();
    });

    it("takes a label off an issue and refuses to take off one it does not carry", async () => {
      const { items } = await api.listIssues(project.id);
      const carrier = items.find((issue) => issue.labels.length > 0);
      expect(carrier).toBeDefined();
      if (!carrier) return;
      const [carried] = carrier.labels;

      await api.removeIssueLabel(project.id, carrier.id, carried.id);

      expect((await api.listIssueLabels(project.id, carrier.id)).some((label) => label.id === carried.id)).toBe(false);
      await expect(api.removeIssueLabel(project.id, carrier.id, carried.id)).rejects.toThrow();
    });

    it("takes a soft-deleted label off the project and off every issue at once", async () => {
      const { items } = await api.listIssues(project.id);
      const carrier = items.find((issue) => issue.labels.length > 0);
      expect(carrier).toBeDefined();
      if (!carrier) return;
      const [carried] = carrier.labels;

      await api.deleteProjectLabel(project.id, carried.id);

      expect((await api.listProjectLabels(project.id)).some((label) => label.id === carried.id)).toBe(false);
      expect((await api.listIssueLabels(project.id, carrier.id)).some((label) => label.id === carried.id)).toBe(false);
      // A deleted label cannot be addressed again, which is what stops the UI
      // from "restoring" one by re-adding it to an issue.
      await expect(api.addIssueLabel(project.id, carrier.id, carried.id)).rejects.toThrow();
    });

    it("filters the issue list by label", async () => {
      const { items } = await api.listIssues(project.id);
      const carrier = items.find((issue) => issue.labels.length > 0);
      expect(carrier).toBeDefined();
      if (!carrier) return;
      const [carried] = carrier.labels;

      const filtered = await api.listIssues(project.id, { labelId: carried.id });

      expect(filtered.items.length).toBeGreaterThan(0);
      expect(filtered.items.every((issue) => issue.labels.some((label) => label.id === carried.id))).toBe(true);
      expect(filtered.items.some((issue) => issue.id === carrier.id)).toBe(true);
      expect(filtered.items.length).toBeLessThan(items.length);
    });

    it("answers a label from another project with a not-found rather than a cross-project write", async () => {
      const projects = await api.listProjects();
      const other = projects.find((item) => item.id !== project.id);
      expect(other).toBeDefined();
      if (!other) return;
      const [foreign] = await api.listProjectLabels(other.id);
      const { items } = await api.listIssues(project.id);

      await expect(api.addIssueLabel(project.id, items[0].id, foreign.id)).rejects.toThrow();
    });
  });

  /**
   * `getIssueById` is the one issue read a project id does not already narrow
   * (TAS-183), so it is the one that has to ask about membership itself. Before
   * TAS-183 nothing called it; now a notification does, in one click, which is
   * what turns a permissive read into a reachable one.
   */
  describe("reading an issue by id alone", () => {
    it("answers for an issue in a project the current user is a member of", async () => {
      const [issue] = (await api.listIssues(project.id, {})).items;
      const byId = await api.getIssueById(issue.id);

      expect(byId.issue.id).toBe(issue.id);
      // The whole point of the method: the project comes back with the answer,
      // because the caller had no way to name it.
      expect(byId.issue.projectId).toBe(project.id);
    });

    it("refuses an issue in a project the current user is not a member of", async () => {
      // MOB is seeded with Mark, Tom and Priya and deliberately without Anna,
      // who is the default user here and the e2e login.
      await api.login({ email: "mark@example.com", password: "mock-accepts-anything" });
      const mob = (await api.listProjects()).find((item) => item.projectKey === "MOB");
      expect(mob, "the seed no longer has a project Anna is not in").toBeDefined();
      const [mobIssue] = (await api.listIssues(mob!.id, {})).items;
      expect(mobIssue).toBeDefined();

      await api.login({ email: "anna@example.com", password: "mock-accepts-anything" });
      await expect(api.listProjects()).resolves.not.toContainEqual(expect.objectContaining({ projectKey: "MOB" }));

      // NOT_FOUND rather than PERMISSION_DENIED: DESIGN.md §4.18 does not let
      // the refusal itself confirm that someone else's project exists.
      await expect(api.getIssueById(mobIssue.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  describe("notifications", () => {
    it("marks every notification read and reports how many changed", async () => {
      const before = await api.listNotifications({ unreadOnly: true });
      expect(before.items.length).toBeGreaterThan(0);

      const { updatedCount } = await api.markAllNotificationsRead();
      const after = await api.listNotifications({ unreadOnly: true });

      expect(updatedCount).toBe(before.items.length);
      expect(after.items).toHaveLength(0);
    });
  });
  describe("read-only admin", () => {
    it("seeds a catalog whose tables are all readable", async () => {
      const catalog = await api.getAdminCatalog();

      expect(catalog.services.length).toBeGreaterThan(1);
      for (const service of catalog.services) {
        for (const table of service.tables) {
          const result = await api.listAdminRows({ service: service.name, table: table.name });
          // The seed exists so the console is clickable without a gateway; an
          // advertised table that answers nothing would defeat that.
          expect(result.rows.length).toBeGreaterThan(0);
          expect(result.meta.columns).toEqual(table.columns.map((column) => column.name));
        }
      }
    });

    // The console branches on the catalog's column types — which operators a
    // filter offers, and whether a row can be opened at all — so a seed that
    // does not carry those cases proves nothing about the screen above it.
    it("spells column types the way information_schema does", async () => {
      const catalog = await api.getAdminCatalog();
      const types = new Set(
        catalog.services.flatMap((service) => service.tables).flatMap((table) => table.columns.map((c) => c.type)),
      );

      // Every class the gateway distinguishes is present.
      expect(types).toContain("character varying");
      expect(types).toContain("timestamp with time zone");
      expect(types).toContain("integer");
      expect(types).toContain("boolean");
      expect(types).toContain("uuid");
      // And none of the short aliases, which the gateway matches exactly and
      // would therefore classify as "unknown" — offering operators it refuses.
      expect(types).not.toContain("varchar");
      expect(types).not.toContain("timestamptz");
    });

    it("seeds both a table whose rows can be opened and one whose rows cannot", async () => {
      const catalog = await api.getAdminCatalog();
      const keyTypes = catalog.services
        .flatMap((service) => service.tables)
        .map((table) => table.columns.find((column) => column.name === table.primaryKey)?.type);

      // A uuid key is addressable by the gateway; anything else is not, and
      // §5.8 refuses to link it. Both cases have to exist in mock mode or the
      // screen's decision is never exercised.
      expect(keyTypes).toContain("uuid");
      expect(keyTypes.some((type) => type !== "uuid")).toBe(true);
    });

    it("reads one row by its key and refuses a key nobody has", async () => {
      const page = await api.listAdminRows({ service: "auth", table: "users" });
      const id = String(page.rows[0].id);

      await expect(api.getAdminRow({ service: "auth", table: "users", id })).resolves.toMatchObject({ id });
      // The way the REST implementation's 404 reaches the card, so the
      // missing-row state is reachable without a gateway.
      await expect(
        api.getAdminRow({ service: "auth", table: "users", id: "0f3d5cb0-0000-0000-0000-000000000000" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    // The gateway types the path parameter as a UUID, so a card for a row keyed
    // by a code is one the mock could serve and the gateway never can. The
    // console refuses to link those rows; a hand-typed address has to hit the
    // same wall in both modes, or mock mode teaches a screen that does not
    // exist.
    it("refuses a row id the gateway would not parse", async () => {
      const rows = await api.listAdminRows({ service: "admin", table: "audit_log" });
      const id = String(rows.rows[0].id);

      // The row is genuinely there — it is the address that is impossible.
      expect(id).not.toMatch(/^[0-9a-f-]{36}$/i);
      await expect(api.getAdminRow({ service: "admin", table: "audit_log", id })).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
      });
    });

    it("marks at least one column sensitive, so masking is reachable without a gateway", async () => {
      const catalog = await api.getAdminCatalog();
      const sensitive = catalog.services
        .flatMap((service) => service.tables)
        .flatMap((table) => table.columns)
        .filter((column) => column.sensitive);

      expect(sensitive.length).toBeGreaterThan(0);
    });

    it("answers an unknown service and an unserved table the way the gateway does", async () => {
      // An unknown service key is a rejected argument there, not a missing
      // resource: the gateway resolves the key before it looks for anything and
      // answers `400 INVALID_ARGUMENT` with this exact sentence (measured
      // 2026-08-25). A table it will not serve is a refusal rather than an
      // absence. The mock is the reference implementation and should not teach
      // the wrong shape to whoever reads it next.
      //
      // The wording is load-bearing beyond this test: the Events section tells
      // "the gateway has not deployed the summary yet" from a real failure by
      // this sentence and this code together.
      await expect(api.listAdminRows({ service: "no_such_service", table: "users" })).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message: "Unknown service: no_such_service",
      });
      await expect(api.listAdminRows({ service: "auth", table: "no_such_table" })).rejects.toMatchObject({
        code: "PERMISSION_DENIED",
      });
    });

    it("matches case the way the gateway does: exactly, except for contains", async () => {
      // The gateway's `contains` is ILIKE and its equality is not. A mock that
      // lowercased both accepted `global_admin`, so a filter that passed every
      // test found nothing against a real database.
      const exact = await api.listAdminRows({
        service: "auth",
        table: "users",
        filters: [{ column: "global_role", operator: "equals", value: "global_admin" }],
      });
      expect(exact.rows).toHaveLength(0);

      const insensitive = await api.listAdminRows({
        service: "auth",
        table: "users",
        filters: [{ column: "email", operator: "contains", value: "ANNA@" }],
      });
      expect(insensitive.rows).toHaveLength(1);
    });

    it("pages, and reports the totals the pager is drawn from", async () => {
      const first = await api.listAdminRows({ service: "admin", table: "audit_log", page: 1, pageSize: 20 });

      expect(first.rows).toHaveLength(20);
      expect(first.pagination.totalRows).toBeGreaterThan(20);
      expect(first.pagination.hasPrev).toBe(false);
      expect(first.pagination.hasNext).toBe(true);

      const last = await api.listAdminRows({
        service: "admin",
        table: "audit_log",
        page: first.pagination.totalPages,
        pageSize: 20,
      });

      expect(last.pagination.hasNext).toBe(false);
      expect(last.rows[0]).not.toEqual(first.rows[0]);
    });

    it("sorts both ways", async () => {
      const query = { service: "admin" as const, table: "audit_log", sort: "id", pageSize: 100 };
      const asc = await api.listAdminRows({ ...query, order: "asc" });
      const desc = await api.listAdminRows({ ...query, order: "desc" });

      expect(asc.rows[0]).not.toEqual(desc.rows[0]);
      expect(asc.rows[0]).toEqual(desc.rows[desc.rows.length - 1]);
    });

    /**
     * The gateway compares a `from`/`to` range typed — `BigDecimal` for a
     * numeric column, `OffsetDateTime` for a temporal one — and the mock is
     * both the reference implementation and what the e2e suite runs against
     * (AGENTS.md: the three implementations stay behaviourally
     * interchangeable). Comparing as text is not a mock detail: it answers a
     * different set of rows than the wire does.
     */
    it("compares a numeric range as numbers, not as text", async () => {
      const from = await api.listAdminRows({
        service: "auth",
        table: "users",
        pageSize: 100,
        filters: [{ column: "failed_logins", operator: "from", value: "10" }],
      });

      // As text, "5" >= "10" — so the row with 5 came back from a filter that
      // asked for 10 and up. The list runs to 35 since TAS-186 seeded a sixth
      // and seventh account and TAS-188 an eighth (`failed_logins` is
      // `index * 5`), which is what makes the two-digit half of this assertion
      // several values rather than one.
      expect(from.rows.map((row) => row.failed_logins)).toEqual([10, 15, 20, 25, 30, 35]);

      const to = await api.listAdminRows({
        service: "auth",
        table: "users",
        pageSize: 100,
        filters: [{ column: "failed_logins", operator: "to", value: "10" }],
      });

      expect(to.rows.map((row) => row.failed_logins)).toEqual([0, 5, 10]);
    });

    it("compares a temporal range as instants, not as text", async () => {
      // The same moment, spelled with the milliseconds the picker used to emit.
      // As text `"…10:00:00Z" <= "…10:00:00.000Z"` is false, so the boundary row
      // the gateway keeps was the one row the mock dropped.
      const to = await api.listAdminRows({
        service: "admin",
        table: "audit_log",
        pageSize: 100,
        filters: [{ column: "created_at", operator: "to", value: "2026-07-01T10:00:00.000Z" }],
      });

      expect(to.rows).toHaveLength(1);
      expect(to.rows[0].created_at).toBe("2026-07-01T10:00:00Z");

      const from = await api.listAdminRows({
        service: "admin",
        table: "audit_log",
        pageSize: 100,
        filters: [{ column: "created_at", operator: "from", value: "2026-07-01T10:00:00.000Z" }],
      });

      // The boundary belongs to both halves, and nothing else is missing from
      // this one: 47 rows, one of which is the boundary.
      expect(from.rows).toHaveLength(47);
    });

    it("sorts a numeric column as numbers, not as locale-collated text", async () => {
      const asc = await api.listAdminRows({
        service: "auth",
        table: "users",
        pageSize: 100,
        sort: "failed_logins",
        order: "asc",
      });

      // `localeCompare` put 10 before 5 here, and did it differently depending
      // on the machine's locale.
      expect(asc.rows.map((row) => row.failed_logins)).toEqual([0, 5, 10, 15, 20, 25, 30, 35]);

      const desc = await api.listAdminRows({
        service: "auth",
        table: "users",
        pageSize: 100,
        sort: "failed_logins",
        order: "desc",
      });

      expect(desc.rows.map((row) => row.failed_logins)).toEqual([35, 30, 25, 20, 15, 10, 5, 0]);
    });

    it("applies each filter operator", async () => {
      const contains = await api.listAdminRows({
        service: "auth",
        table: "users",
        filters: [{ column: "email", operator: "contains", value: "anna@" }],
      });
      expect(contains.rows).toHaveLength(1);

      const equals = await api.listAdminRows({
        service: "auth",
        table: "users",
        filters: [{ column: "global_role", operator: "equals", value: "GLOBAL_ADMIN" }],
      });
      expect(equals.rows).toHaveLength(1);

      const none = await api.listAdminRows({
        service: "auth",
        table: "users",
        filters: [{ column: "email", operator: "contains", value: "nobody-here" }],
      });
      // An empty result is a real answer, not an error.
      expect(none.rows).toHaveLength(0);
      expect(none.pagination.totalRows).toBe(0);
    });
  });

  /**
   * The Events section (TAS-167). The summary endpoint is deployed — backend
   * PR #141 (TAS-105) merged 2026-08-27 — and this is the reference
   * implementation of it: derived from the very rows the Outbox journal reads,
   * so the two views of the section can never disagree. That derivation is what
   * these tests are about.
   */
  describe("problematic outbox summary", () => {
    it("gives exactly auth, project and issue an outbox_events table", async () => {
      const catalog = await api.getAdminCatalog();
      const withOutbox = catalog.services
        .filter((service) => service.tables.some((table) => table.name === "outbox_events"))
        .map((service) => service.name);

      // The Events service selector is built from this and nothing else, so a
      // seed where every service had one would make that filter untestable.
      expect(withOutbox).toEqual(["auth", "project", "issue"]);
    });

    it("counts what the journal's own rows say, service by service", async () => {
      const summary = await api.getProblematicOutboxSummary();

      for (const count of summary.counts) {
        const { rows } = await api.listAdminRows({
          service: count.serviceKey,
          table: "outbox_events",
          pageSize: 500,
        });
        const failed = rows.filter((row) => row.status === "FAILED");
        // The two other categories are thresholds rather than states, so the
        // strong claim here is FAILED — and that every counted row is real.
        expect(count.failedCount).toBe(failed.length);
        const problematic = count.failedCount + count.stuckProcessingCount + count.overdueNewCount;
        expect(problematic).toBeLessThanOrEqual(rows.length);
        expect(problematic).toBeGreaterThan(0);
      }
    });

    it("does not count a row that has not been waiting long enough", async () => {
      const summary = await api.getProblematicOutboxSummary();
      const { rows } = await api.listAdminRows({ service: "issue", table: "outbox_events", pageSize: 500 });
      const issue = summary.counts.find((count) => count.serviceKey === "issue")!;

      // The seed carries a NEW and a PROCESSING row a couple of minutes old.
      // Without them nothing would prove the summary applies a threshold rather
      // than counting states.
      expect(rows.filter((row) => row.status === "NEW").length).toBeGreaterThan(issue.overdueNewCount);
      expect(rows.filter((row) => row.status === "PROCESSING").length).toBeGreaterThan(issue.stuckProcessingCount);
    });

    it("lists the oldest first and says when it had to stop", async () => {
      const summary = await api.getProblematicOutboxSummary();

      const times = summary.events.map((event) => new Date(event.createdAt).getTime());
      expect(times).toEqual([...times].sort((a, b) => a - b));

      const total = summary.counts.reduce(
        (sum, count) => sum + count.failedCount + count.stuckProcessingCount + count.overdueNewCount,
        0,
      );
      // The list is capped and the counts are not, which is the whole reason
      // `notAllShown` exists: the matrix still covers what was cut.
      expect(summary.events.length).toBeLessThan(total);
      expect(summary.notAllShown).toBe(true);
    });

    it("gives each event the backend's own sentence for why it is here", async () => {
      const summary = await api.getProblematicOutboxSummary();

      for (const event of summary.events) {
        // Prose, not an enum — the UI derives the category from `status` and
        // never parses these. They are seeded word for word so that what the
        // card shows in mock mode is what it will show against the gateway.
        expect(event.reason).toBe(
          event.status === "FAILED"
            ? "Event processing failed"
            : event.status === "PROCESSING"
              ? "Event stuck in PROCESSING state (exceeded processing timeout)"
              : "Event stuck in NEW state (not picked up for processing)",
        );
      }
      // All three sentences are reachable from one read of the seed, or the
      // card's own rendering would only ever be seen with one of them.
      expect(new Set(summary.events.map((event) => event.status))).toEqual(new Set(["FAILED", "PROCESSING", "NEW"]));
    });

    it("names every listed event with a row the journal can open", async () => {
      const summary = await api.getProblematicOutboxSummary();

      for (const event of summary.events) {
        // The summary's row link goes straight to `GET /{service}/{table}/{id}`,
        // so an id the journal cannot resolve would be a link to a 404.
        await expect(
          api.getAdminRow({ service: event.serviceKey, table: "outbox_events", id: event.id }),
        ).resolves.toMatchObject({ id: event.id, status: event.status });
      }
    });

    it("seeds payloads that are all documents, which is all a jsonb column can hold", async () => {
      const { rows } = await api.listAdminRows({ service: "issue", table: "outbox_events", pageSize: 500 });
      const payloads = rows.map((row) => String(row.payload));

      // This used to assert the opposite for one row. The seed carried a
      // `JsonByteArrayInput{…}` payload, because admin-service served every
      // jsonb column through a wrapper's toString and what arrived was not JSON.
      // Backend PR #141 (TAS-105) fixed that, and the probe that closes the
      // divergence entry was taken on 2026-09-08: 20 live `issue.outbox_events`
      // rows, every payload clean JSON, no `JsonByteArrayInput` in the response.
      // So the mock stopped modelling a wire format the gateway cannot produce.
      // The card's rule did not change and is not a compensation — a payload
      // that does not parse is still printed verbatim, and that branch is tested
      // where it lives, in src/screens/admin/columns.test.ts.
      expect(payloads.length).toBeGreaterThan(0);
      for (const payload of payloads) {
        expect(() => JSON.parse(payload) as unknown).not.toThrow();
      }
    });

    it("seeds a payload whose values arrived masked", async () => {
      const { rows } = await api.listAdminRows({ service: "auth", table: "outbox_events", pageSize: 500 });

      // admin-service masks fields *inside* the document, so a masked payload is
      // still valid JSON — which is what makes it fall out of the card's one
      // rule with no special case.
      const masked = rows.find((row) => String(row.payload).includes("****"));
      expect(masked).toBeDefined();
      expect(() => JSON.parse(String(masked!.payload)) as unknown).not.toThrow();
    });
  });

  /**
   * Retrying a stuck outbox event (TAS-194) —
   * `POST /admin/outbox/{service}/{eventId}/retry`, backend TAS-106.
   *
   * Every rule below is admin-service's own, read out of `OutboxRetryServiceImpl`
   * and `OutboxRetryRepositoryImpl` on `develop` at 2026-09-08. The contract
   * states none of them: it declares `400/401/403/404` and a response of
   * `{eventId, status, attempts}`, and everything about *which* events may be
   * retried and *what changes* lives in the service. The mock is where those
   * rules are demonstrable without a broken queue on a real stand.
   */
  describe("retrying an outbox event", () => {
    const failedEvent = async () => {
      const summary = await api.getProblematicOutboxSummary();
      const event = summary.events.find((candidate) => candidate.status === "FAILED");
      expect(event).toBeDefined();
      return event!;
    };

    it("puts a failed event back into NEW and clears the error it stopped on", async () => {
      const event = await failedEvent();
      expect(event.serviceKey === "auth" || event.serviceKey === "project" || event.serviceKey === "issue").toBe(true);

      const result = await api.retryOutboxEvent(
        event.serviceKey as "auth" | "project" | "issue",
        event.id,
        "Kafka is back",
      );

      expect(result).toEqual({ eventId: event.id, status: "NEW", attempts: event.attempts });
      // The journal reads the same rows, so the change has to be visible there
      // too — the two views of this section are one store.
      const row = await api.getAdminRow({ service: event.serviceKey, table: "outbox_events", id: event.id });
      expect(row.status).toBe("NEW");
      expect(row.last_error_message).toBeNull();
      expect(row.processing_started_at).toBeNull();
    });

    /**
     * The single most assumable thing about this endpoint, and it is false:
     * `attempts` is absent from the backend's `UPDATE`, so the count survives
     * the retry. A mock that reset it would teach the opposite of the server.
     */
    it("does not reset the attempt count", async () => {
      const event = await failedEvent();
      expect(event.attempts).toBeGreaterThan(0);

      const result = await api.retryOutboxEvent(event.serviceKey as "auth", event.id, "Retry after incident");

      expect(result.attempts).toBe(event.attempts);
      const row = await api.getAdminRow({ service: event.serviceKey, table: "outbox_events", id: event.id });
      expect(row.attempts).toBe(event.attempts);
    });

    /**
     * The refusal an operator meets without having done anything wrong. `NEW` is
     * where retry *puts* an event, so retrying one is `FAILED_PRECONDITION` —
     * which reaches the dialog's "conflict" sentence through `isConflict`'s code
     * arm, since on the wire it is a 400.
     */
    it("refuses an overdue NEW event, with the server's own sentence", async () => {
      const summary = await api.getProblematicOutboxSummary();
      const overdue = summary.events.find((candidate) => candidate.status === "NEW");
      expect(overdue).toBeDefined();

      await expect(
        api.retryOutboxEvent(overdue!.serviceKey as "auth", overdue!.id, "Please go"),
      ).rejects.toMatchObject({
        code: "FAILED_PRECONDITION",
        message: "Outbox event with status NEW is not eligible for retry",
      });
    });

    /**
     * The divergence this whole feature has to be honest about, reachable here
     * because the seed puts a row in the gap on purpose. admin-service calls a
     * `PROCESSING` row stuck after the producing service's timeout (5m) and
     * retryable only after its own, longer one (10m), so between the two the
     * summary lists an event that the retry route refuses — and no client can
     * predict which, since both numbers are server configuration
     * (docs/ai/API-DIVERGENCE.md).
     */
    it("lists a briefly stuck PROCESSING event and still refuses to retry it", async () => {
      const summary = await api.getProblematicOutboxSummary();
      const briefly = summary.events.find(
        (event) => event.status === "PROCESSING" && event.serviceKey === "project",
      );
      // Listed: the summary's own threshold has passed.
      expect(briefly).toBeDefined();
      expect(briefly!.reason).toContain("PROCESSING");

      // And refused: the retry route's has not.
      await expect(api.retryOutboxEvent("project", briefly!.id, "It looks stuck")).rejects.toMatchObject({
        code: "FAILED_PRECONDITION",
        message: "Outbox event with status PROCESSING is not eligible for retry",
      });
    });

    it("retries a PROCESSING event that has been stuck long enough", async () => {
      const summary = await api.getProblematicOutboxSummary();
      const longStuck = summary.events.find(
        (event) => event.status === "PROCESSING" && event.serviceKey === "issue",
      );
      expect(longStuck).toBeDefined();

      await expect(api.retryOutboxEvent("issue", longStuck!.id, "Consumer restarted")).resolves.toMatchObject({
        status: "NEW",
      });
    });

    it("refuses a published event, which is not in the summary at all", async () => {
      const { rows } = await api.listAdminRows({ service: "auth", table: "outbox_events", pageSize: 500 });
      const published = rows.find((row) => row.status === "PUBLISHED");
      expect(published).toBeDefined();

      await expect(api.retryOutboxEvent("auth", String(published!.id), "Send it again")).rejects.toMatchObject({
        code: "FAILED_PRECONDITION",
      });
    });

    it("answers NOT_FOUND for an event this service does not have", async () => {
      // A real uuid that is simply not in this outbox — and specifically not the
      // INVALID_ARGUMENT below, which is what a malformed one gets.
      await expect(
        api.retryOutboxEvent("auth", "00000000-0000-4000-8000-000000000000", "Nothing there"),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("refuses an id the gateway's path could not carry", async () => {
      // `eventId` is `format: uuid` in the contract, so a non-uuid is rejected
      // before admin-service is reached — the same wall `adminRow` puts up.
      await expect(api.retryOutboxEvent("auth", "not-a-uuid", "Try it")).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
      });
    });

    /**
     * The body is validated before the path, because Spring validates
     * `@Valid @RequestBody` before the controller method runs. So a blank reason
     * against an event nobody has is a 400, not a 404 — the order is the
     * server's and is worth pinning, since the obvious implementation has it the
     * other way round.
     */
    it("checks the reason before the event, and refuses a blank one", async () => {
      await expect(
        api.retryOutboxEvent("auth", "00000000-0000-4000-8000-000000000000", "   "),
      ).rejects.toMatchObject({ code: "INVALID_ARGUMENT", message: "A reason is required" });
    });

    /**
     * 1000, not the user writes' 550. Two contract limits, two guards — the
     * point of this case is that the *number* is this route's own, so a build
     * that folded the two families into one would fail here at 551.
     */
    it("takes a reason up to 1000 characters and refuses 1001", async () => {
      const event = await failedEvent();

      await expect(
        api.retryOutboxEvent(event.serviceKey as "auth", event.id, "x".repeat(1001)),
      ).rejects.toMatchObject({ code: "INVALID_ARGUMENT", message: "A reason is at most 1000 characters" });
      // 551 would be refused by the admin *user* writes and must not be here.
      await expect(api.retryOutboxEvent(event.serviceKey as "auth", event.id, "x".repeat(1000))).resolves.toMatchObject(
        { status: "NEW" },
      );
    });
  });

  /**
   * Blocking and unblocking an account (TAS-186). Every rule below is the
   * backend's own, read out of `AdminUserManagementServiceImpl` — on the TAS-107
   * branch when these were written, on `develop` since backend PR #146 merged.
   *
   * The routes are deployed now, and that does not make this less load-bearing:
   * these refusals cannot be produced against the live gateway without blocking
   * a real account, so the mock stays the implementation that demonstrates them,
   * and it has to answer exactly what the gateway does
   * (docs/ai/API-DIVERGENCE.md).
   */
  describe("admin user block and unblock", () => {
    /** Whoever the seed gave this status, found through the same table the section reads. */
    const findByStatus = async (status: string) => {
      const { rows } = await api.listAdminRows({ service: "auth", table: "users", pageSize: 100 });
      const row = rows.find((candidate) => candidate.status === status);
      expect(row, `the seed has nobody with status ${status}`).toBeDefined();
      return String(row!.id);
    };

    it("seeds one account of every status, so the section can be seen whole", async () => {
      const { rows } = await api.listAdminRows({ service: "auth", table: "users", pageSize: 100 });

      // All four since TAS-188. `LOCKED` is the one nobody in this product puts
      // an account into — it takes failed sign-ins against the real auth-service
      // — so without a seeded row the third action would be unreachable in the
      // only environment a reviewer or an e2e run has.
      expect(new Set(rows.map((row) => row.status))).toEqual(new Set(["ACTIVE", "INVITED", "BLOCKED", "LOCKED"]));
      // And exactly one global admin, which is what makes the last-active-admin
      // refusal reachable by clicking rather than only by unit test.
      expect(rows.filter((row) => row.global_role === "GLOBAL_ADMIN")).toHaveLength(1);
    });

    it("blocks an active account and says what it changed", async () => {
      const id = await findByStatus("ACTIVE");

      await expect(api.blockUser(id, "Left the company")).resolves.toMatchObject({
        userId: id,
        previousStatus: "ACTIVE",
        currentStatus: "BLOCKED",
      });
      // The list is what the section refetches, so the write has to be visible
      // there and not only in the response.
      const { rows } = await api.listAdminRows({ service: "auth", table: "users", pageSize: 100 });
      expect(rows.find((row) => row.id === id)?.status).toBe("BLOCKED");
    });

    it("blocks an invited account, and unblocking it makes it active rather than invited", async () => {
      const id = await findByStatus("INVITED");

      await expect(api.blockUser(id, "Invitation sent to the wrong address")).resolves.toMatchObject({
        previousStatus: "INVITED",
        currentStatus: "BLOCKED",
      });
      // The backend does not restore the invite state, and the mock must not
      // invent a kinder rule than the server's — the confirmation dialog says
      // this out loud precisely because it is surprising.
      await expect(api.unblockUser(id, "Address corrected")).resolves.toMatchObject({
        previousStatus: "BLOCKED",
        currentStatus: "ACTIVE",
      });
    });

    it("unblocks a blocked account", async () => {
      const id = await findByStatus("BLOCKED");

      await expect(api.unblockUser(id, "Back from leave")).resolves.toMatchObject({
        previousStatus: "BLOCKED",
        currentStatus: "ACTIVE",
      });
    });

    it("refuses a transition the current status does not allow, in the server's words and its code", async () => {
      // `ABORTED`, which the gateway maps to 409 — and deliberately not the
      // code the last-admin refusal below carries. The two are different
      // `DomainStatus` values on the backend and land on different HTTP
      // statuses, so a mock that gave them one code would be the only place
      // they looked alike.
      const blocked = await findByStatus("BLOCKED");
      await expect(api.blockUser(blocked, "Again")).rejects.toMatchObject({
        code: "ABORTED",
        message: "Cannot block user with current status: BLOCKED",
      });

      const active = await findByStatus("ACTIVE");
      await expect(api.unblockUser(active, "Again")).rejects.toMatchObject({
        code: "ABORTED",
        message: "Cannot unblock user with current status: ACTIVE",
      });

      const invited = await findByStatus("INVITED");
      await expect(api.unblockUser(invited, "Again")).rejects.toMatchObject({
        code: "ABORTED",
        message: "Cannot unblock user with current status: INVITED",
      });
    });

    it("resets a lockout, which is the only way out of LOCKED and always lands on ACTIVE", async () => {
      const id = await findByStatus("LOCKED");

      await expect(api.resetCredentialLockout(id, "Called in, identity confirmed")).resolves.toMatchObject({
        userId: id,
        previousStatus: "LOCKED",
        currentStatus: "ACTIVE",
      });
      const { rows } = await api.listAdminRows({ service: "auth", table: "users", pageSize: 100 });
      expect(rows.find((row) => row.id === id)?.status).toBe("ACTIVE");
    });

    it("refuses a lockout reset on an account that is not locked, with a code the gateway sends as a 400", async () => {
      // FAILED_PRECONDITION, not ABORTED: this refusal wears the shape of the
      // last-active-admin guard rather than of the transition guard, so it
      // reaches the dialog by its code and not by a 409. The sentence is the
      // server's own (`AdminUserManagementServiceImpl.resetCredentialLockout`).
      for (const status of ["ACTIVE", "INVITED", "BLOCKED"]) {
        await expect(api.resetCredentialLockout(await findByStatus(status), "Just in case")).rejects.toMatchObject({
          code: "FAILED_PRECONDITION",
          message: "User is not in LOCKED status",
        });
      }
    });

    it("refuses the two transitions that are not legal from LOCKED either", async () => {
      // The reason `actionFor` maps LOCKED to the reset action rather than to
      // Block: the account is not blocked and cannot be unblocked, and blocking
      // it is refused as a transition.
      const locked = await findByStatus("LOCKED");

      await expect(api.blockUser(locked, "Again")).rejects.toMatchObject({
        code: "ABORTED",
        message: "Cannot block user with current status: LOCKED",
      });
      await expect(api.unblockUser(locked, "Again")).rejects.toMatchObject({
        code: "ABORTED",
        message: "Cannot unblock user with current status: LOCKED",
      });
    });

    it("checks a lockout reset's body and its user the way the other two writes do", async () => {
      const locked = await findByStatus("LOCKED");

      await expect(api.resetCredentialLockout(locked, "  ")).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message: "A reason is required",
      });
      await expect(
        api.resetCredentialLockout("0f3d5cb0-0000-0000-0000-000000000000", "Nobody"),
      ).rejects.toMatchObject({ code: "NOT_FOUND", message: "User not found" });
      await expect(api.resetCredentialLockout("not-a-uuid", "Nobody")).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
      });
      // Refused, not partly applied.
      const { rows } = await api.listAdminRows({ service: "auth", table: "users", pageSize: 100 });
      expect(rows.find((row) => row.id === locked)?.status).toBe("LOCKED");
    });

    it("refuses to block the last active global admin", async () => {
      const { rows } = await api.listAdminRows({ service: "auth", table: "users", pageSize: 100 });
      const admin = rows.find((row) => row.global_role === "GLOBAL_ADMIN");

      // FAILED_PRECONDITION, which the gateway maps to **400**: this refusal
      // reaches the dialog by its code and not by a 409.
      await expect(api.blockUser(String(admin!.id), "Testing the guard")).rejects.toMatchObject({
        code: "FAILED_PRECONDITION",
        message: "Cannot block the last active global admin",
      });
      // Refused, not partly applied.
      const after = await api.listAdminRows({ service: "auth", table: "users", pageSize: 100 });
      expect(after.rows.find((row) => row.id === admin!.id)?.status).toBe("ACTIVE");
    });

    it("refuses a user nobody has, and an id the gateway would not parse", async () => {
      await expect(
        api.blockUser("0f3d5cb0-0000-0000-0000-000000000000", "Nobody"),
      ).rejects.toMatchObject({ code: "NOT_FOUND", message: "User not found" });

      // The path parameter is typed `UUID` on the gateway, so anything else is
      // a 400 there before auth-service is reached — the same wall `adminRow`
      // puts in front of a non-uuid row id.
      await expect(api.blockUser("not-a-uuid", "Nobody")).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    });

    it("validates the body before it looks for the account, the way Spring does", async () => {
      // `@Valid @RequestBody` runs before the controller method, so a blank
      // reason on an account nobody has is a 400 and not a 404. Unreachable
      // from the section, and pinned because the mock is what the two modes are
      // compared against.
      await expect(
        api.blockUser("0f3d5cb0-0000-0000-0000-000000000000", "  "),
      ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    });

    it("refuses a blank reason, and one past the server's limit", async () => {
      const id = await findByStatus("ACTIVE");

      // Whitespace-only is blank to `@NotBlank`, and the gateway answers 400 —
      // so the mock refuses it too, or the e2e suite would never see the rule.
      await expect(api.blockUser(id, "   ")).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message: "A reason is required",
      });
      await expect(api.unblockUser(id, "")).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
      await expect(api.blockUser(id, "x".repeat(551))).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message: "A reason is at most 550 characters",
      });
      // 550 exactly is accepted: the bound is inclusive on the server.
      await expect(api.blockUser(id, "x".repeat(550))).resolves.toMatchObject({ currentStatus: "BLOCKED" });
    });

    it("states a changedAt, under the name the wire uses, that the section is nonetheless not allowed to draw", async () => {
      const id = await findByStatus("ACTIVE");
      const change = await api.blockUser(id, "Left the company");

      // `changedAt` and not `updatedAt`: the gateway's mapper calls
      // `setChangedAt` and the DTO requires that name, so the old spelling read
      // `undefined` out of every 200 while the type still promised a string.
      // A real instant, and nothing renders it — the section refetches the list
      // and reads the row's own timestamp there.
      expect(Object.keys(change).sort()).toEqual(["changedAt", "currentStatus", "previousStatus", "userId"]);
      expect(new Date(change.changedAt).getUTCFullYear()).toBeGreaterThan(2000);
    });
  });

  /**
   * The three-legged upload, every way it can be refused, and the two rules
   * that decide what the panel is allowed to say afterwards. This is the only
   * place the feature can be exercised at all until backend TAS-131 deploys, so
   * the fidelity of these branches is the deliverable rather than scaffolding
   * for it.
   */
  describe("attachments", () => {
    /** A file the allowlist accepts, of a size the ceiling accepts. */
    const textFile = (name: string, contents = "trace line\n") =>
      new File([contents], name, { type: "text/plain" });

    const openIssue = async (issueKey: string) => {
      const { items } = await api.listIssues(project.id, { pageSize: 100 });
      const issue = items.find((item) => item.issueKey === issueKey);
      if (!issue) throw new Error(`no ${issueKey} in the seed`);
      return issue;
    };

    /** The whole choreography, as the panel runs it. */
    const upload = async (issueId: string, file: File) => {
      const ticket = await api.createAttachmentUploadUrl(project.id, issueId, {
        fileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      });
      await api.putAttachmentBytes(ticket.uploadUrl, file, file.type);
      return api.confirmAttachmentUpload(project.id, issueId, {
        objectKey: ticket.objectKey,
        fileName: file.name,
        contentType: file.type,
      });
    };

    beforeEach(async () => {
      await api.login({ email: "anna@example.com", password: "anything" });
    });

    it("seeds an issue with two attachments from two different people", async () => {
      const issue = await openIssue("TAS-101");
      const attachments = await api.listAttachments(project.id, issue.id);

      expect(attachments.map((item) => item.fileName)).toEqual([
        "login-500-trace.txt",
        "validation-error.png",
      ]);
      // Two uploaders on one issue is what makes the split delete rule visible:
      // one row is the signed-in person's and one is not.
      expect(new Set(attachments.map((item) => item.uploadedBy)).size).toBe(2);
      // The gateway's mapper does not send the object key, so neither does this.
      expect(Object.keys(attachments[0]).sort()).toEqual([
        "checksum",
        "contentType",
        "createdAt",
        "fileName",
        "id",
        "issueId",
        "sizeBytes",
        "uploadedBy",
      ]);
    });

    it("runs the three legs and lands a row the list can see", async () => {
      const issue = await openIssue("TAS-102");
      const file = textFile("notes.txt", "one\ntwo\n");

      const ticket = await api.createAttachmentUploadUrl(project.id, issue.id, {
        fileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      });
      // A presigned URL on the object store, not on the gateway — and the
      // signature covers the content type, which is why leg 2 may not change it.
      expect(ticket.uploadUrl).toContain("http://127.0.0.1:9000/taska-attachments/");
      expect(ticket.uploadUrl).toContain("X-Amz-SignedHeaders=content-type%3Bhost");
      expect(ticket.objectKey).toBeTruthy();

      await api.putAttachmentBytes(ticket.uploadUrl, file, file.type);
      const attachment = await api.confirmAttachmentUpload(project.id, issue.id, {
        objectKey: ticket.objectKey,
        fileName: file.name,
        contentType: file.type,
      });

      expect(attachment).toMatchObject({ fileName: "notes.txt", contentType: "text/plain", sizeBytes: file.size });
      // The checksum is a fact about the bytes that were actually sent.
      expect(attachment.checksum).toMatch(/^[0-9a-f]{32}$/);
      expect((await api.listAttachments(project.id, issue.id)).map((item) => item.fileName)).toEqual(["notes.txt"]);
    });

    it("writes the history event the activity feed reads", async () => {
      const issue = await openIssue("TAS-102");
      const attachment = await upload(issue.id, textFile("notes.txt"));

      const afterUpload = (await api.getIssue(project.id, issue.id)).history.at(-1);
      expect(afterUpload).toMatchObject({ eventType: "ATTACHMENT_UPLOADED" });
      expect(afterUpload?.payload.fileName).toBe("notes.txt");

      await api.deleteAttachment(project.id, issue.id, attachment.id);
      expect((await api.getIssue(project.id, issue.id)).history.at(-1)).toMatchObject({
        eventType: "ATTACHMENT_DELETED",
        payload: { fileName: "notes.txt" },
      });
    });

    it("refuses a type outside the thirteen-entry allowlist, in the server's own words", async () => {
      const issue = await openIssue("TAS-102");
      // The `.zip` that Windows browsers report differently, and the case-folded
      // spelling of a type that *is* on the list: both are refused, because the
      // server compares exact strings.
      for (const contentType of ["application/x-zip-compressed", "IMAGE/PNG", "application/octet-stream", "image/gif"]) {
        await expect(
          api.createAttachmentUploadUrl(project.id, issue.id, { fileName: "f", contentType, sizeBytes: 10 }),
        ).rejects.toMatchObject({
          code: "INVALID_ARGUMENT",
          message: attachmentTypeRefusalMessage(contentType),
        });
      }
    });

    it("refuses an empty file and one over the 2 MB ceiling, and accepts the ceiling exactly", async () => {
      const issue = await openIssue("TAS-102");
      const ask = (sizeBytes: number) =>
        api.createAttachmentUploadUrl(project.id, issue.id, {
          fileName: "f.txt",
          contentType: "text/plain",
          sizeBytes,
        });

      await expect(ask(0)).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message: "File size must be positive, got: 0",
      });
      await expect(ask(ATTACHMENT_MAX_SIZE_BYTES + 1)).rejects.toMatchObject({
        code: "OUT_OF_RANGE",
        message: attachmentSizeRefusalMessage(ATTACHMENT_MAX_SIZE_BYTES + 1),
      });
      // Inclusive: 2097152 is the largest accepted, not the smallest refused.
      await expect(ask(ATTACHMENT_MAX_SIZE_BYTES)).resolves.toMatchObject({ objectKey: expect.any(String) });
    });

    it("answers a blocked cross-origin PUT with no status at all", async () => {
      const issue = await openIssue("TAS-102");
      const file = textFile(`${MOCK_ATTACHMENT_TRIGGERS.storeUnreachable}.txt`);
      const ticket = await api.createAttachmentUploadUrl(project.id, issue.id, {
        fileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      });

      const error = await api.putAttachmentBytes(ticket.uploadUrl, file, file.type).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AttachmentStoreError);
      // The whole point of the shape: no `status`, so nothing in
      // src/api/errors.ts reads a store failure as a gateway one.
      expect(error).toMatchObject({ code: "STORAGE_UNREACHABLE", storeStatus: null });
      expect((error as { status?: unknown }).status).toBeUndefined();
    });

    it("carries a store's own status in storeStatus and never in status", async () => {
      const issue = await openIssue("TAS-102");
      const file = textFile(`${MOCK_ATTACHMENT_TRIGGERS.storeRefused}.txt`);
      const ticket = await api.createAttachmentUploadUrl(project.id, issue.id, {
        fileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      });

      const error = await api.putAttachmentBytes(ticket.uploadUrl, file, file.type).catch((e: unknown) => e);
      expect(error).toMatchObject({ code: "STORAGE_REJECTED", storeStatus: 500 });
      expect((error as { status?: unknown }).status).toBeUndefined();
    });

    it("answers 403 for an expired link and for a content type that was not the one signed", async () => {
      const issue = await openIssue("TAS-102");

      const stale = textFile(`${MOCK_ATTACHMENT_TRIGGERS.expiredTicket}.txt`);
      const staleTicket = await api.createAttachmentUploadUrl(project.id, issue.id, {
        fileName: stale.name,
        contentType: stale.type,
        sizeBytes: stale.size,
      });
      await expect(api.putAttachmentBytes(staleTicket.uploadUrl, stale, stale.type)).rejects.toMatchObject({
        code: "STORAGE_REJECTED",
        storeStatus: 403,
      });

      // The signature covers `Content-Type`, so "text/plain; charset=utf-8" is
      // a different request from "text/plain" and the store says so.
      const file = textFile("ok.txt");
      const ticket = await api.createAttachmentUploadUrl(project.id, issue.id, {
        fileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      });
      await expect(
        api.putAttachmentBytes(ticket.uploadUrl, file, "text/plain; charset=utf-8"),
      ).rejects.toMatchObject({ storeStatus: 403 });
    });

    it("leaves the object in the bucket when the confirm fails, and lists nothing", async () => {
      const issue = await openIssue("TAS-102");
      const file = textFile(`${MOCK_ATTACHMENT_TRIGGERS.confirmFails}.txt`);
      const ticket = await api.createAttachmentUploadUrl(project.id, issue.id, {
        fileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      });
      // Leg 2 succeeds: the bytes are in the bucket.
      await api.putAttachmentBytes(ticket.uploadUrl, file, file.type);

      await expect(
        api.confirmAttachmentUpload(project.id, issue.id, {
          objectKey: ticket.objectKey,
          fileName: file.name,
          contentType: file.type,
        }),
      ).rejects.toMatchObject({ code: "UNAVAILABLE" });

      // No row — which is exactly the orphan: an object nothing points at, and
      // nothing on either side can remove it.
      expect(await api.listAttachments(project.id, issue.id)).toEqual([]);
    });

    it("refuses a confirm for an object nobody uploaded", async () => {
      const issue = await openIssue("TAS-102");
      await expect(
        api.confirmAttachmentUpload(project.id, issue.id, {
          objectKey: "never-put-here",
          fileName: "ghost.txt",
          contentType: "text/plain",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND", message: "Object not found in storage" });
    });

    it("creates a second row when a confirm is repeated, which is why it is never retried", async () => {
      const issue = await openIssue("TAS-102");
      const file = textFile("duplicate.txt");
      const ticket = await api.createAttachmentUploadUrl(project.id, issue.id, {
        fileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      });
      await api.putAttachmentBytes(ticket.uploadUrl, file, file.type);

      const body = { objectKey: ticket.objectKey, fileName: file.name, contentType: file.type };
      const first = await api.confirmAttachmentUpload(project.id, issue.id, body);
      const second = await api.confirmAttachmentUpload(project.id, issue.id, body);

      // `object_key` has no unique constraint on the server and the insert is
      // unconditional, so a repeat is a duplicate row rather than a no-op. Two
      // ids, two rows, two history events. Pinned so nobody "helpfully" adds a
      // retry to the confirm.
      expect(first.id).not.toBe(second.id);
      expect(await api.listAttachments(project.id, issue.id)).toHaveLength(2);
    });

    it("gives a fresh presigned download link per call, carrying the checksum", async () => {
      const issue = await openIssue("TAS-101");
      const [attachment] = await api.listAttachments(project.id, issue.id);

      const link = await api.getAttachmentDownloadUrl(project.id, issue.id, attachment.id);
      expect(link.downloadUrl).toContain("http://127.0.0.1:9000/taska-attachments/");
      expect(link.downloadUrl).toContain("X-Amz-Signature=");
      expect(link.checksum).toBe(attachment.checksum);

      await expect(
        api.getAttachmentDownloadUrl(project.id, issue.id, "00000000-0000-0000-0000-000000000000"),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("soft-deletes: the row leaves the list and the id stops resolving", async () => {
      const issue = await openIssue("TAS-101");
      const before = await api.listAttachments(project.id, issue.id);

      await api.deleteAttachment(project.id, issue.id, before[0].id);

      const after = await api.listAttachments(project.id, issue.id);
      expect(after.map((item) => item.id)).not.toContain(before[0].id);
      expect(after).toHaveLength(before.length - 1);
      await expect(api.getAttachmentDownloadUrl(project.id, issue.id, before[0].id)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("lets a MEMBER delete their own attachment and refuses somebody else's", async () => {
      // Mark is a MEMBER of TAS; Anna is its ADMIN. The seed puts one file from
      // each on TAS-101 precisely so this rule has both cases to answer.
      await api.login({ email: "mark@example.com", password: "anything" });
      const issue = await openIssue("TAS-101");
      const attachments = await api.listAttachments(project.id, issue.id);
      const mine = attachments.find((item) => item.fileName === "validation-error.png");
      const theirs = attachments.find((item) => item.fileName === "login-500-trace.txt");
      expect(mine && theirs).toBeTruthy();
      if (!mine || !theirs) return;

      await expect(api.deleteAttachment(project.id, issue.id, theirs.id)).rejects.toMatchObject({
        code: "PERMISSION_DENIED",
      });
      await expect(api.deleteAttachment(project.id, issue.id, mine.id)).resolves.toBeUndefined();

      // And an ADMIN may remove the one they did not upload.
      await api.login({ email: "anna@example.com", password: "anything" });
      await expect(api.deleteAttachment(project.id, issue.id, theirs.id)).resolves.toBeUndefined();
    });

    it("answers a delete for an attachment that is not there, and refuses its download", async () => {
      const issue = await openIssue("TAS-101");
      const [attachment] = await api.listAttachments(project.id, issue.id);
      const ghost = "00000000-0000-0000-0000-000000000000";

      // `AttachmentServiceImpl.deleteAttachment` opens on
      // `findByIdAndDeletedAtIsNull` with **no** `switchIfEmpty`, so an empty
      // result skips both `flatMap`s and `GrpcAttachmentService` closes with
      // `.thenReturn(Empty)` — 204, not the 404 the contract documents. The
      // implementation is reproduced rather than the contract, and the gap is
      // written down in docs/ai/API-DIVERGENCE.md rather than absorbed here.
      await expect(api.deleteAttachment(project.id, issue.id, ghost)).resolves.toBeUndefined();

      // The case a stale list actually produces — a second tab, or somebody
      // else's delete. A 404 here would roll the panel's optimistic removal
      // back and put a file that *is* deleted back on screen under an error
      // message, which is worse than the divergence.
      await api.deleteAttachment(project.id, issue.id, attachment.id);
      await expect(api.deleteAttachment(project.id, issue.id, attachment.id)).resolves.toBeUndefined();

      // Lenient, not silently repeated: the second call writes no second event.
      const deletions = (await api.getIssue(project.id, issue.id)).history.filter(
        (event) => event.eventType === "ATTACHMENT_DELETED",
      );
      expect(deletions).toHaveLength(1);

      // And the leniency is one method wide. `getDownloadUrl` goes through the
      // server's private `findActiveAttachment`, which *does* carry
      // `switchIfEmpty(NOT_FOUND)`, so both of these are 404s — pinned here
      // beside the 204s so nobody makes the lookup lenient for everyone.
      await expect(api.getAttachmentDownloadUrl(project.id, issue.id, attachment.id)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(api.getAttachmentDownloadUrl(project.id, issue.id, ghost)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("checks upload-attachment-roles on both legs that reach the gateway", async () => {
      // `upload-attachment-roles: ADMIN,MEMBER`, checked once by
      // `createUploadUrl` and again by `confirmUpload` — a presigned URL is a
      // bearer token for the bucket and says nothing about who may add a row.
      // Nothing in the UI can reach either leg as a VIEWER, because the picker
      // is hidden; that is exactly why it is proved here, since a hidden
      // control is a courtesy and the server stays the authority.
      //
      // Mark is a member of the Mobile project and Anna is not, so the gate is
      // two sign-ins on one issue — and the project id is read from his list
      // rather than pasted in as a second copy of a seed literal.
      //
      // Neither half is the role it stands for. The seed gives `memberIds[0]`
      // ADMIN and everybody else MEMBER, and Mark is Mobile's first member, so
      // the allowed side below is an ADMIN; and no seeded member is a VIEWER
      // anywhere, so the refused side is a non-member that `getMembership`
      // answers `VIEWER` for. Against the gateway that second substitution is
      // not equivalent — a non-member is refused on `!isMember` before a role
      // is read at all — which is why it is written down here and in
      // docs/ai/API-DIVERGENCE.md rather than passed off as a VIEWER test.
      await api.login({ email: "mark@example.com", password: "anything" });
      const mobile = (await api.listProjects()).find((item) => item.projectKey === "MOB");
      expect(mobile).toBeDefined();
      if (!mobile) return;
      const { items } = await api.listIssues(mobile.id, { pageSize: 100 });
      const issue = items.find((item) => item.issueKey === "MOB-5");
      expect(issue).toBeDefined();
      if (!issue) return;

      // An allowed role runs all three legs, so the gate is not one notch too
      // tight. `upload-attachment-roles` is ADMIN and MEMBER; this is the ADMIN.
      const file = textFile("mark.txt");
      const ticket = await api.createAttachmentUploadUrl(mobile.id, issue.id, {
        fileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      });
      await api.putAttachmentBytes(ticket.uploadUrl, file, file.type);
      await expect(
        api.confirmAttachmentUpload(mobile.id, issue.id, {
          objectKey: ticket.objectKey,
          fileName: file.name,
          contentType: file.type,
        }),
      ).resolves.toMatchObject({ fileName: "mark.txt" });

      // Anna is not a member of MOB at all, so `getMembership` answers VIEWER.
      await api.login({ email: "anna@example.com", password: "anything" });

      // Reading stays hers **in the mock, which is looser than the gateway
      // here**. It is not that `view-attachment-roles` includes VIEWER:
      // `ProjectRoleChecker.validateAccess` refuses a non-member with
      // `PERMISSION_DENIED "Access denied"` before it maps a role or consults
      // `allowedRoles`, so the gateway answers 403 to these two reads whatever
      // that config contains. The mock membership-checks neither read, the
      // same convention `getIssueById` already follows for project-scoped
      // reads — recorded in docs/ai/API-DIVERGENCE.md, and left as it is
      // because adding the check would cost the read-only seed this section
      // demonstrates.
      const attachments = await api.listAttachments(mobile.id, issue.id);
      const seeded = attachments.find((item) => item.fileName === "crash-report.json");
      expect(seeded).toBeDefined();
      if (!seeded) return;
      await expect(api.getAttachmentDownloadUrl(mobile.id, issue.id, seeded.id)).resolves.toMatchObject({
        downloadUrl: expect.stringContaining("X-Amz-Signature="),
      });

      await expect(
        api.createAttachmentUploadUrl(mobile.id, issue.id, {
          fileName: "notes.txt",
          contentType: "text/plain",
          sizeBytes: 10,
        }),
      ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
      // Refused before the object is looked for, the way the server refuses it:
      // `confirmUpload` opens with its own role check, so this never reaches
      // "Object not found in storage".
      await expect(
        api.confirmAttachmentUpload(mobile.id, issue.id, {
          objectKey: "never-put-here",
          fileName: "notes.txt",
          contentType: "text/plain",
        }),
      ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });

      // Somebody else's file, and this reader is no ADMIN of MOB.
      await expect(api.deleteAttachment(mobile.id, issue.id, seeded.id)).rejects.toMatchObject({
        code: "PERMISSION_DENIED",
      });
      // But an attachment that is not there is refused by nothing at all: the
      // server's empty lookup skips the role check along with everything else.
      await expect(
        api.deleteAttachment(mobile.id, issue.id, "00000000-0000-0000-0000-000000000000"),
      ).resolves.toBeUndefined();
    });

    it("judges the file before the role at leg 1, and the role before the object at leg 3", async () => {
      // Not symmetry, and not what this store used to assume. `createUploadUrl`
      // is `checkUserHasRoleForIssue(...).then(createPresignedUploadUrl(...))`,
      // and `Mono.then(Mono)` evaluates its argument at assembly — while
      // `S3StorageClient.createPresignedUploadUrl` calls `validateFileParams`
      // synchronously before it returns a Mono. So the file refusal escapes
      // before the role check ever subscribes, and leg 1 answers 400 where a
      // reader would expect 403. Verified against backend `f53dca38`.
      //
      // `confirmUpload` has no such argument and does check the role first,
      // which is why the two assertions below differ.
      // Mark's sign-in only to read the ids: `listProjects` answers a
      // non-member nothing, so Anna cannot find MOB herself.
      await api.login({ email: "mark@example.com", password: "anything" });
      const mobile = (await api.listProjects()).find((item) => item.projectKey === "MOB");
      expect(mobile).toBeDefined();
      if (!mobile) return;
      const issue = (await api.listIssues(mobile.id, { pageSize: 100 })).items.find(
        (item) => item.issueKey === "MOB-5",
      );
      expect(issue).toBeDefined();
      if (!issue) return;
      await api.login({ email: "anna@example.com", password: "anything" });

      // Anna may not upload here at all, and the file is unacceptable too. The
      // server answers the file, so this does as well — and `RestTaskaApi`,
      // which refuses before it sends anything, answers the same.
      await expect(
        api.createAttachmentUploadUrl(mobile.id, issue.id, {
          fileName: "bundle.zip",
          contentType: "application/x-zip-compressed",
          sizeBytes: 10,
        }),
      ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });

      // Same two problems on leg 3, opposite answer: the role goes first.
      await expect(
        api.confirmAttachmentUpload(mobile.id, issue.id, {
          objectKey: "never-put-here",
          fileName: "bundle.zip",
          contentType: "application/x-zip-compressed",
        }),
      ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    });

    it("refuses an upload URL that is not one instead of PUTting to this origin", async () => {
      // `RestTaskaApi` lands a response with no `uploadUrl` as `""`, and
      // `fetch("")` resolves against the document rather than failing — so an
      // unguarded leg 2 would PUT the file to the SPA's own origin with
      // cookies attached. Refused by both implementations, in the store-error
      // shape and with its own code, because nothing was sent and no store was
      // asked.
      const file = textFile("notes.txt");
      for (const url of ["", "/api/v1/upload", "javascript:void 0"]) {
        await expect(api.putAttachmentBytes(url, file, file.type)).rejects.toMatchObject({
          name: "AttachmentStoreError",
          code: "STORAGE_URL_UNUSABLE",
          storeStatus: null,
        });
      }
    });

    it("scopes every read to the project in the path, unlike the gateway", async () => {
      const issue = await openIssue("TAS-101");
      const other = (await api.listProjects()).find((item) => item.id !== project.id);
      expect(other).toBeDefined();
      if (!other) return;

      // The gateway forwards only `issueId` and says in its own comment that
      // `projectId` takes no part in authorisation, so it would answer this.
      // The mock resolves an issue *within* a project and refuses — the same
      // known divergence `getIssue` carries, recorded here rather than found by
      // somebody at a boundary.
      await expect(api.listAttachments(other.id, issue.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });
});
