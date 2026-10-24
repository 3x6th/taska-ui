import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskaApi } from "../../api/TaskaApi";
import type { AuditEntries, AuditEntriesQuery } from "../../domain/types";
import { MockTaskaApi } from "../../api/mock/MockTaskaApi";
import { ApiError } from "../../api/rest/RestTaskaApi";
import { tabbables } from "../../lib/focusTrap";
import { AdminAuditSection } from "./AdminAuditSection";

/**
 * The Audit section (TAS-251). The log is read from a **real `MockTaskaApi`**
 * signed in as its GLOBAL_ADMIN, so filters, date bounds and paging are the
 * mock's reproduction of what the server does (backend PR #197); only the
 * answers the mock cannot give — a gateway that does not serve the route, a
 * page of the caller's own making — are put on top.
 */
const { fakeApi, useMock, setFailure, setAnswer, queries } = vi.hoisted(() => {
  const state: {
    mock?: TaskaApi;
    failure?: Error;
    answer?: AuditEntries;
    queries: AuditEntriesQuery[];
  } = { queries: [] };
  const api = {
    hasSession: () => true,
    onSessionExpired: () => () => {},
    getCurrentUser: () => state.mock!.getCurrentUser(),
    getMeta: () => state.mock!.getMeta(),
    listAuditEntries: async (query: AuditEntriesQuery) => {
      state.queries.push(query);
      if (state.failure) throw state.failure;
      if (state.answer) return state.answer;
      return state.mock!.listAuditEntries(query);
    },
  };
  return {
    fakeApi: api as unknown as TaskaApi,
    useMock: (mock: TaskaApi) => {
      state.mock = mock;
      state.failure = undefined;
      state.answer = undefined;
      state.queries = [];
    },
    setFailure: (failure: Error) => {
      state.failure = failure;
    },
    setAnswer: (answer: AuditEntries) => {
      state.answer = answer;
    },
    queries: () => state.queries,
  };
});

vi.mock("../../api/client", () => ({ taskaApi: fakeApi }));

function Where() {
  const location = useLocation();
  const navigationType = useNavigationType();
  return (
    <>
      <span data-testid="location">{`${location.pathname}${location.search}`}</span>
      <span data-testid="navigation-type">{navigationType}</span>
    </>
  );
}

const where = () => screen.getByTestId("location").textContent;
const navigationType = () => screen.getByTestId("navigation-type").textContent;

function renderAudit(path = "/admin/audit") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/admin/audit"
            element={
              <>
                <AdminAuditSection />
                <Where />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return queryClient;
}

const table = () => screen.findByRole("table", { name: "Audit entries" });
const bodyRows = (element: HTMLElement) => within(element).getAllByRole("row").slice(1);

/** Opens the popover, picks the named filter, types the value and presses Apply. */
function applyFilter(key: string, value: string) {
  fireEvent.click(screen.getByRole("button", { name: "Filter" }));
  const dialog = screen.getByRole("dialog", { name: "Filter audit entries" });
  fireEvent.change(within(dialog).getByLabelText("Filter"), { target: { value: key } });
  fireEvent.change(within(dialog).getByLabelText(/^Value/), { target: { value } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
  return dialog;
}

describe("the Audit section", () => {
  beforeEach(async () => {
    window.localStorage.clear();
    const mock = new MockTaskaApi();
    await mock.login({ email: "mark@example.com", password: "anything" });
    useMock(mock);
  });

  it("draws the first page newest first, with the count and the pager", async () => {
    renderAudit();

    const grid = await table();
    expect(bodyRows(grid)).toHaveLength(20);
    expect(screen.getByText("30 entries")).toBeVisible();
    expect(screen.getByText("Page 1 of 2")).toBeVisible();
    // UTC to the second, as this area writes an instant.
    expect(within(bodyRows(grid)[0]).getByText("2026-10-09T16:40:00Z")).toBeVisible();
    expect(queries()[0]).toEqual({ page: 1, pageSize: 20 });
  });

  it("keeps the page in the URL, both ways", async () => {
    renderAudit();
    await table();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(where()).toBe("/admin/audit?page=2"));
    await waitFor(() => expect(bodyRows(screen.getByRole("table", { name: "Audit entries" }))).toHaveLength(10));
    expect(queries().at(-1)).toMatchObject({ page: 2 });
  });

  it("reads its filters from the URL and sends each as its own parameter", async () => {
    renderAudit("/admin/audit?filter=action:equals:BLOCK_USER&filter=createdAt:from:2026-09-01");

    const grid = await table();
    expect(screen.getByRole("button", { name: "Action is BLOCK_USER" })).toBeVisible();
    expect(screen.getByRole("button", { name: "From 2026-09-01" })).toBeVisible();
    expect(queries()[0]).toEqual({ page: 1, pageSize: 20, action: "BLOCK_USER", createdAtFrom: "2026-09-01" });
    for (const row of bodyRows(grid)) expect(within(row).getByText("BLOCK_USER")).toBeVisible();
  });

  it("writes an applied filter into the URL and goes back to the first page", async () => {
    renderAudit("/admin/audit?page=2");
    await table();

    applyFilter("targetTable.equals", "credentials");

    await waitFor(() => expect(where()).toBe("/admin/audit?filter=targetTable%3Aequals%3Acredentials"));
    expect(queries().at(-1)).toMatchObject({ page: 1, targetTable: "credentials" });
  });

  it("refuses an actor id that is not a UUID, and never sends it", async () => {
    renderAudit();
    await table();

    const dialog = applyFilter("actorUserId.equals", "mark");

    expect(within(dialog).getByRole("alert")).toHaveTextContent(/actor id is a UUID/i);
    expect(within(dialog).getByLabelText(/^Value/)).toHaveAttribute("aria-invalid", "true");
    expect(where()).toBe("/admin/audit");
    expect(queries().some((query) => "actorUserId" in query)).toBe(false);

    // A UUID goes through.
    fireEvent.change(within(dialog).getByLabelText(/^Value/), {
      target: { value: "e65186a2-b807-42ae-a66f-711be116a93b" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(queries().at(-1)).toMatchObject({ actorUserId: "e65186a2-b807-42ae-a66f-711be116a93b" }));
  });

  it("refuses a From after the To already applied", async () => {
    renderAudit("/admin/audit?filter=createdAt:to:2026-10-01");
    await table();

    const dialog = applyFilter("createdAt.from", "2026-10-05");

    expect(within(dialog).getByRole("alert")).toHaveTextContent(/From is after To/);
    expect(where()).toBe("/admin/audit?filter=createdAt:to:2026-10-01");
  });

  it("drops what it would not send from a hand-edited URL", async () => {
    renderAudit(
      "/admin/audit?filter=actorUserId:equals:mark&filter=createdAt:from:2026-10-05&filter=createdAt:to:2026-10-01&filter=createdAt:to:yesterday",
    );
    await table();

    expect(queries()[0]).toEqual({ page: 1, pageSize: 20 });
    expect(screen.queryByRole("button", { name: /Actor id is|From|To / })).not.toBeInTheDocument();
  });

  it("opens an entry in place, with the old and new values side by side", async () => {
    renderAudit("/admin/audit?filter=action:equals:RESET_CREDENTIAL_LOCKOUT");
    const grid = await table();
    const [row] = bodyRows(grid);
    const toggle = within(row).getByRole("button", { name: /^Changes of RESET_CREDENTIAL_LOCKOUT at / });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const detail = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    const old = within(detail).getByRole("figure", { name: "Old value" });
    const next = within(detail).getByRole("figure", { name: "New value" });
    // Pretty-printed, and the masked value printed as the server sent it — in
    // the order the server sent the keys, which is jsonb's (shorter first),
    // not the order they were written in.
    expect(old.querySelector("pre")!.textContent).toBe(
      JSON.stringify({ status: "LOCKED", passwordHash: "***", failedAttempts: 5 }, null, 2),
    );
    expect(next.querySelector("pre")!.textContent).toContain('"status": "ACTIVE"');
    expect(within(detail).getByRole("button", { name: /Copy request id/ })).toBeVisible();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("says a value is missing, and prints one that is not JSON exactly as it came", async () => {
    setAnswer({
      entries: [
        {
          id: null,
          actorUserId: null,
          actorDisplayName: "mark",
          actorEmail: null,
          action: "CREATE_INVITATION",
          targetService: "auth",
          targetTable: "invitations",
          targetId: null,
          reason: null,
          requestId: null,
          createdAt: "2026-10-01T10:00:00Z",
          oldValue: null,
          newValue: "JsonByteArrayInput{token=***}",
        },
      ],
      pagination: { currentPage: 1, pageSize: 20, totalRows: 1, totalPages: 1, hasNext: false, hasPrev: false },
    });
    renderAudit();
    const grid = await table();

    fireEvent.click(within(bodyRows(grid)[0]).getByRole("button", { name: /^Changes of CREATE_INVITATION/ }));

    expect(screen.getByRole("figure", { name: "Old value" })).toHaveTextContent("nothing logged");
    const next = screen.getByRole("figure", { name: /New value/ });
    expect(next).toHaveTextContent("not JSON, shown as sent");
    expect(next.querySelector("pre")!.textContent).toBe("JsonByteArrayInput{token=***}");
  });

  /**
   * Who acted (DESIGN.md §5.8, TAS-389), from the snapshot the log kept —
   * `actorDisplayName` and `actorEmail`, backend PR #219. The seed has the
   * stand's two shapes; the three the stand cannot produce but the DTO allows
   * (no name: address, id, or nothing) are fixtures below.
   */
  describe("the actor", () => {
    const ACTOR_ID = "e65186a2-b807-42ae-a66f-711be116a93b";
    const actorCell = (row: HTMLElement) => within(row).getAllByRole("cell")[1];
    const facts = (detail: HTMLElement) =>
      [...detail.querySelectorAll(".admin-audit-facts > div")].map((pair) => [
        pair.querySelector("dt")?.textContent,
        pair.querySelector("dd"),
      ]) as [string, HTMLElement][];
    const fact = (detail: HTMLElement, term: string) => facts(detail).find(([name]) => name === term)![1];
    const openDetail = (row: HTMLElement) => {
      const toggle = within(row).getByRole("button", { name: /^Changes of / });
      fireEvent.click(toggle);
      return document.getElementById(toggle.getAttribute("aria-controls")!)!;
    };

    it("prints the name the log kept, the new shape and the historical one alike", async () => {
      renderAudit();
      const rows = bodyRows(await table());

      // Since #219: the display name, with the address in the title.
      const newest = actorCell(rows[0]);
      expect(newest).toHaveTextContent(/^Mark Lee$/);
      expect(newest).toHaveAttribute("title", "Mark Lee · mark@example.com");
      expect(newest).toHaveClass("admin-audit-actor");
      expect(newest).not.toHaveClass("admin-cell-mono");

      // Before it: the old login the rename kept, as stored, and no address —
      // the same account under its other label, not reconciled here.
      const older = rows.map(actorCell).find((cell) => cell.textContent === "mark")!;
      expect(older).toHaveAttribute("title", "mark");
      const names = new Set(rows.map((row) => actorCell(row).textContent));
      expect(names).toEqual(new Set(["Mark Lee", "mark", "migrator", "vera"]));
    });

    it("opens to the actor's name and address, and the full id as selectable text", async () => {
      renderAudit();
      const [row] = bodyRows(await table());

      const detail = openDetail(row);

      expect(facts(detail).map(([term]) => term)).toEqual(["actor", "actor id", "target id", "reason"]);
      const actor = fact(detail, "actor");
      expect(within(actor).getByText("Mark Lee")).toHaveClass("admin-user-name");
      expect(within(actor).getByText("mark@example.com")).toHaveClass("admin-user-email");
      const id = fact(detail, "actor id");
      // The UUID whole, mono, in a span of its own; the link under it is UI type.
      expect(within(id).getByText(ACTOR_ID)).toHaveClass("admin-cell-mono");
      expect(within(id).getByRole("link", { name: "Filter by this actor" })).toHaveClass("admin-audit-actor-filter");
    });

    it("falls back to the address, then the start of the id, then a dash — and the detail says the same", async () => {
      const base = (await (async () => {
        const mock = new MockTaskaApi();
        await mock.login({ email: "mark@example.com", password: "anything" });
        return mock.listAuditEntries({ pageSize: 1 });
      })()).entries[0];
      const variant = (id: string, overrides: Partial<typeof base>) => ({ ...base, id, ...overrides });
      setAnswer({
        entries: [
          variant("0000000a-0000-4000-8000-000000000000", { actorDisplayName: null, actorEmail: "ops@example.com" }),
          variant("0000000b-0000-4000-8000-000000000000", { actorDisplayName: null, actorEmail: null }),
          variant("0000000c-0000-4000-8000-000000000000", {
            actorDisplayName: null,
            actorEmail: null,
            actorUserId: null,
          }),
        ],
        pagination: { currentPage: 1, pageSize: 20, totalRows: 3, totalPages: 1, hasNext: false, hasPrev: false },
      });
      renderAudit();
      const [emailOnly, idOnly, nothing] = bodyRows(await table());

      const byEmail = actorCell(emailOnly);
      expect(byEmail).toHaveTextContent(/^ops@example\.com$/);
      expect(byEmail).toHaveAttribute("title", "ops@example.com");
      expect(byEmail).not.toHaveClass("admin-cell-mono");

      // Mono and cut like the target and request ids, said as an id, and whole
      // in the title.
      const byId = actorCell(idOnly);
      expect(byId).toHaveClass("admin-cell-mono");
      expect(byId).toHaveAttribute("title", ACTOR_ID);
      expect(byId).toHaveTextContent(/^account id e65186a2$/);

      // Nothing about the actor at all: the area's pale dash, and no title.
      const blank = actorCell(nothing);
      expect(blank).toHaveTextContent(/^—$/);
      expect(blank).not.toHaveAttribute("title");
      expect(blank.querySelector(".admin-card-null")).not.toBeNull();

      // The address takes the name's line, with nothing under it.
      let detail = openDetail(emailOnly);
      expect(within(fact(detail, "actor")).getByText("ops@example.com")).toHaveClass("admin-user-name");
      expect(fact(detail, "actor").querySelector(".admin-user-email")).toBeNull();

      // No name and no address: a dash for the actor, and the id beside it is
      // the whole UUID — the one way to the account from the keyboard.
      detail = openDetail(idOnly);
      expect(fact(detail, "actor")).toHaveTextContent(/^—$/);
      expect(within(fact(detail, "actor id")).getByText(ACTOR_ID)).toHaveClass("admin-cell-mono");

      // No id, no link: there is nothing to filter by.
      detail = openDetail(nothing);
      expect(fact(detail, "actor")).toHaveTextContent(/^—$/);
      expect(fact(detail, "actor id")).toHaveTextContent(/^—$/);
      expect(within(detail).queryByRole("link", { name: "Filter by this actor" })).not.toBeInTheDocument();
    });

    /**
     * «Filter by this actor» (DESIGN.md §5.8, TAS-396): the one way to bring
     * together the old rows that kept `mark` and the new ones that say `Mark
     * Lee`. A link that writes the address; page 1, `replace`, the detail
     * closed, and focus on the open half of the new chip — next Tab, its ×.
     */
    it("filters the log by the entry's actor id, on page 1, and puts focus on the new chip", async () => {
      renderAudit("/admin/audit?page=2");
      const [row] = bodyRows(await table());
      const detail = openDetail(row);
      const id = fact(detail, "actor id").querySelector(".admin-cell-mono")!.textContent!;
      const link = within(detail).getByRole("link", { name: "Filter by this actor" });
      expect(link).toHaveAttribute("href", `/admin/audit?filter=actorUserId%3Aequals%3A${id}`);

      fireEvent.click(link);

      await waitFor(() => expect(where()).toBe(`/admin/audit?filter=actorUserId%3Aequals%3A${id}`));
      expect(navigationType()).toBe("REPLACE");
      const chip = await screen.findByRole("button", { name: `Actor id is ${id}` });
      await waitFor(() => expect(chip).toHaveFocus());
      const stops = tabbables(document.body);
      expect(stops[stops.indexOf(chip) + 1]).toBe(screen.getByRole("button", { name: `Remove filter Actor id is ${id}` }));
      await waitFor(() => expect(queries().at(-1)).toEqual({ page: 1, pageSize: 20, actorUserId: id }));
      // The detail closed with the view it was about.
      for (const toggle of screen.getAllByRole("button", { name: /^Changes of / })) {
        expect(toggle).toHaveAttribute("aria-expanded", "false");
      }
    });

    it("keeps the other filters, and replaces an actor filter for somebody else where it stood", async () => {
      const OTHER_ID = "6d774efa-57d8-4ae0-a27e-2984d1dfbbf6";
      const base = (await (async () => {
        const mock = new MockTaskaApi();
        await mock.login({ email: "mark@example.com", password: "anything" });
        return mock.listAuditEntries({ pageSize: 1 });
      })()).entries[0];
      setAnswer({
        entries: [{ ...base, actorUserId: ACTOR_ID }],
        pagination: { currentPage: 1, pageSize: 20, totalRows: 1, totalPages: 1, hasNext: false, hasPrev: false },
      });
      renderAudit(`/admin/audit?filter=actorUserId:equals:${OTHER_ID}&filter=action:equals:BLOCK_USER`);
      const [row] = bodyRows(await table());

      const link = within(openDetail(row)).getByRole("link", { name: "Filter by this actor" });

      expect(link).toHaveAttribute(
        "href",
        `/admin/audit?filter=actorUserId%3Aequals%3A${ACTOR_ID}&filter=action%3Aequals%3ABLOCK_USER`,
      );
    });

    it("draws no link when the log is already filtered to this actor", async () => {
      renderAudit(`/admin/audit?filter=actorUserId:equals:${ACTOR_ID}`);
      const [row] = bodyRows(await table());

      const detail = openDetail(row);

      expect(within(fact(detail, "actor id")).getByText(ACTOR_ID)).toBeVisible();
      expect(within(detail).queryByRole("link", { name: "Filter by this actor" })).not.toBeInTheDocument();
    });
  });

  it("keeps the same entry open when a refetch puts a newer one on top, even among entries that say the same thing", async () => {
    // Entries identical but for their ids: named by what they say, they could
    // only be told apart by position, and a new entry on top moves every
    // position by one — the open row would silently become its neighbour.
    const { entries } = await (async () => {
      const mock = new MockTaskaApi();
      await mock.login({ email: "mark@example.com", password: "anything" });
      return mock.listAuditEntries({ action: "BLOCK_USER", pageSize: 1 });
    })();
    const same = (id: string) => ({ ...entries[0], id });
    const page = (ids: string[]) => ({
      entries: ids.map(same),
      pagination: { currentPage: 1, pageSize: 20, totalRows: ids.length, totalPages: 1, hasNext: false, hasPrev: false },
    });
    const ids = ["0000000a-0000-4000-8000-000000000000", "0000000b-0000-4000-8000-000000000000"];
    setAnswer(page(ids));
    const client = renderAudit();
    const grid = await table();

    // The second of the two.
    fireEvent.click(within(bodyRows(grid)[1]).getByRole("button", { name: /^Changes of BLOCK_USER/ }));
    expect(within(bodyRows(grid)[1]).getByRole("button", { name: /^Changes of BLOCK_USER/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    setAnswer(page(["0000000c-0000-4000-8000-000000000000", ...ids]));
    await client.invalidateQueries();

    // Two entry rows and an open detail became three entry rows and the
    // detail — still under the second of the two, now third on the page.
    await waitFor(() => expect(bodyRows(screen.getByRole("table", { name: "Audit entries" }))).toHaveLength(4));
    const toggles = screen.getAllByRole("button", { name: /^Changes of BLOCK_USER/ });
    expect(toggles.map((toggle) => toggle.getAttribute("aria-expanded"))).toEqual(["false", "false", "true"]);
  });

  it("draws every row the server sends, whatever the page size said", async () => {
    const mock = new MockTaskaApi();
    await mock.login({ email: "mark@example.com", password: "anything" });
    const { entries } = await mock.listAuditEntries({ pageSize: 26 });
    setAnswer({
      entries,
      pagination: { currentPage: 1, pageSize: 20, totalRows: 26, totalPages: 2, hasNext: true, hasPrev: false },
    });
    renderAudit();

    expect(bodyRows(await table())).toHaveLength(26);
  });

  it("says a gateway without the route does not serve the log yet, not that it failed or is empty", async () => {
    // What a gateway older than backend PR #197 answers: Spring's
    // static-resource 404, which `isUndeployedRoute` reads.
    setFailure(new ApiError("No static resource api/v1/readonly/audit-entries.", "NOT_FOUND", 404));
    renderAudit();

    const notice = await screen.findByText(/does not serve the audit log yet/);
    expect(notice.closest("[role=status]")).not.toBeNull();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Filter" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "TAS-160" })).toBeVisible();
  });

  it("states a 501 as the failure it is now, not as a route that is not served", async () => {
    // The mapped-but-empty route a pre-merge draft would have answered with
    // never shipped; a 501 today is an error like any other, with its retry.
    setFailure(new ApiError("Method not implemented", "UNIMPLEMENTED", 501));
    renderAudit();

    // After the one retry a fault gets, which is what the longer wait is for.
    expect(await screen.findByRole("alert", undefined, { timeout: 4000 })).toBeVisible();
    expect(screen.queryByText(/does not serve the audit log yet/)).not.toBeInTheDocument();
  });

  it("states a refusal for an account the server does not take as a global admin", async () => {
    const mock = new MockTaskaApi();
    await mock.login({ email: "anna@example.com", password: "anything" });
    useMock(mock);
    renderAudit();

    expect(await screen.findByRole("alert")).toHaveTextContent(/server refused this/i);
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
  });
});
