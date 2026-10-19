import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskaApi } from "../../api/TaskaApi";
import type { AuditEntries, AuditEntriesQuery } from "../../domain/types";
import { MockTaskaApi } from "../../api/mock/MockTaskaApi";
import { ApiError } from "../../api/rest/RestTaskaApi";
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
  return <span data-testid="location">{`${location.pathname}${location.search}`}</span>;
}

const where = () => screen.getByTestId("location").textContent;

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
    // Pretty-printed, and the masked value printed as the server sent it.
    expect(old.querySelector("pre")!.textContent).toBe(
      JSON.stringify({ status: "LOCKED", failedAttempts: 5, passwordHash: "***" }, null, 2),
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
          actorLogin: "mark",
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
