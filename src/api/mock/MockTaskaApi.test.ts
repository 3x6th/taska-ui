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

    it("marks at least one column sensitive, so masking is reachable without a gateway", async () => {
      const catalog = await api.getAdminCatalog();
      const sensitive = catalog.services
        .flatMap((service) => service.tables)
        .flatMap((table) => table.columns)
        .filter((column) => column.sensitive);

      expect(sensitive.length).toBeGreaterThan(0);
    });

    it("answers an unknown service and an unserved table the way the gateway does", async () => {
      // Unknown service is a 404 there; a table it will not serve is a refusal,
      // not an absence. Both reach the UI through `isMissingOrForbidden`, but
      // the mock is the reference implementation and should not teach the wrong
      // shape to whoever reads it next.
      await expect(api.listAdminRows({ service: "no_such_service", table: "users" })).rejects.toMatchObject({
        code: "NOT_FOUND",
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
        filters: [{ column: "global_role", operator: "eq", value: "global_admin" }],
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
        filters: [{ column: "global_role", operator: "eq", value: "GLOBAL_ADMIN" }],
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
});
