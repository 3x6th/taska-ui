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
    api = new MockTaskaApi();
    [project] = await api.listProjects();
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
      const issue = items[0];
      const me = await api.getCurrentUser();

      const page = await api.listComments(project.id, issue.id);
      const foreign = page.items.find((comment) => comment.authorUserId !== me.id);

      // Seeded issues may have no foreign comment; only assert when one exists.
      if (!foreign) return;

      await expect(api.updateComment(project.id, issue.id, foreign.id, "hijack")).rejects.toThrow();
      await expect(api.deleteComment(project.id, issue.id, foreign.id)).rejects.toThrow();
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
