import { beforeEach, describe, expect, it } from "vitest";
import { MockTaskaApi } from "./MockTaskaApi";
import type { Project } from "../../domain/types";

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
});
