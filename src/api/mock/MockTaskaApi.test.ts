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
      // asked for 10 and up.
      expect(from.rows.map((row) => row.failed_logins)).toEqual([10, 15, 20]);

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
      expect(asc.rows.map((row) => row.failed_logins)).toEqual([0, 5, 10, 15, 20]);

      const desc = await api.listAdminRows({
        service: "auth",
        table: "users",
        pageSize: 100,
        sort: "failed_logins",
        order: "desc",
      });

      expect(desc.rows.map((row) => row.failed_logins)).toEqual([20, 15, 10, 5, 0]);
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
});
