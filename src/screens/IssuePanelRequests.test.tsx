import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BoardScreen } from "./BoardScreen";

/**
 * The issue panel's request budget, measured on the wire (TAS-246, inherited
 * from TAS-202's acceptance): **opening a panel in `rest` mode costs at most two
 * requests — the issue read and the comments read.**
 *
 * Measured against the real `RestTaskaApi` over a stubbed `fetch`, rather than
 * against a fake `TaskaApi`, because the budget is a property of what reaches
 * the gateway: a fake counts method calls, and one method may be several
 * requests (or none). Every request the board makes before the panel opens is
 * counted too, and subtracted — the panel is charged only for what opening it
 * costs.
 */

const PROJECT = "2e74e49f-0f29-4e03-b4ec-adc4dbf2382e";
const ISSUE = "7a1b2c3d-0000-4000-8000-000000000102";
const ANNA = "6d774efa-57d8-4ae0-a27e-2984d1dfbbf6";
const NOW = "2026-10-07T09:00:00Z";

vi.mock("../api/client", async () => {
  // The token has to be in place before the instance reads it at construction.
  window.localStorage.setItem("taska.accessToken", "valid-access");
  const { RestTaskaApi } = await import("../api/rest/RestTaskaApi");
  return { taskaApi: new RestTaskaApi("/api/v1") };
});

const seededIssue = {
  id: ISSUE,
  projectId: PROJECT,
  issueNumber: 102,
  issueKey: "TAS-102",
  issueType: "TASK",
  summary: "Wire the board to the gateway",
  description: "",
  status: "TODO",
  priority: "MEDIUM",
  assigneeId: null,
  reporterId: ANNA,
  createdAt: NOW,
  updatedAt: NOW,
  version: 1,
  labels: [],
};

/** The issue as this stub's server holds it; a PATCH moves it on, as the gateway's would. */
let issue: Record<string, unknown> = { ...seededIssue };

/** A plausible gateway: enough of each answer for the board and the panel to draw. */
function respond(url: string, init?: RequestInit): unknown {
  const path = url.replace(/^\/api\/v1/, "").split("?")[0];
  if (path === `/issues/${ISSUE}` && init?.method === "PATCH") {
    // The merge patch, and a version bump; `labels` is `[]` as the route sends it.
    issue = { ...issue, ...JSON.parse(String(init.body)), version: Number(issue.version) + 1, labels: [] };
    return issue;
  }
  if (path === "/users/me") {
    return { id: ANNA, login: "anna", email: "anna@example.com", displayName: "Anna Ivanova", status: "ACTIVE" };
  }
  if (path === `/users/${ANNA}/avatar`) return { url: null };
  if (path === `/projects/${PROJECT}`) {
    return { id: PROJECT, projectKey: "TAS", name: "Taska Platform", createdBy: ANNA, createdAt: NOW, updatedAt: NOW, currentUserRole: "ADMIN" };
  }
  if (path === `/projects/${PROJECT}/members`) {
    return { members: [{ userId: ANNA, role: "ADMIN", displayName: "Anna Ivanova", email: "anna@example.com" }] };
  }
  if (path === `/projects/${PROJECT}/workflow`) {
    return {
      id: "workflow",
      name: "Default",
      version: 1,
      createdAt: NOW,
      updatedAt: NOW,
      statuses: [{ id: "s1", statusKey: "TODO", name: "To Do", category: "TODO", sortOrder: 10 }],
      transitions: [],
    };
  }
  if (path === `/projects/${PROJECT}/issues`) return { items: [issue], totalCount: 1 };
  if (path === `/projects/${PROJECT}/labels`) return { items: [], totalCount: 0 };
  if (path === "/notifications") return { items: [], unreadCount: 0 };
  if (path === `/issues/${ISSUE}`) {
    return {
      issue: {
        ...issue,
        reporter: { id: ANNA, displayName: "Anna Ivanova" },
        watchers: [],
        isWatching: false,
        links: [],
        attachments: [],
        commentCount: 0,
      },
      history: [],
    };
  }
  if (path === `/projects/${PROJECT}/issues/${ISSUE}/comments`) return { items: [], totalCount: 0 };
  return { items: [], totalCount: 0 };
}

const answer = (body: unknown) =>
  ({ status: 200, ok: true, headers: { get: () => null }, json: async () => body }) as unknown as Response;

describe("the issue panel's request budget against the REST implementation", () => {
  let requested: string[];
  /** Every request with its method and `If-Match`, for the write below. */
  let sent: { path: string; method: string; ifMatch: string | undefined }[];

  beforeEach(() => {
    window.localStorage.setItem("taska.accessToken", "valid-access");
    requested = [];
    sent = [];
    issue = { ...seededIssue };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => {
        requested.push(String(input));
        const headers = (init?.headers ?? {}) as Record<string, string>;
        sent.push({ path: String(input).split("?")[0], method: init?.method ?? "GET", ifMatch: headers["If-Match"] });
        return answer(respond(String(input), init));
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const renderBoard = () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 20_000 } } });
    const board = <BoardScreen theme="light" toggleTheme={() => {}} onLogout={() => {}} logoutPending={false} />;
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/projects/${PROJECT}/board`]}>
          <Routes>
            <Route path="/projects/:projectId/board" element={board} />
            <Route path="/projects/:projectId/issues/:issueId" element={board} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    return queryClient;
  };

  it("opens a panel with two requests: the issue read and the comments read", async () => {
    const queryClient = renderBoard();

    // The board, settled: its card is drawn and nothing is in flight.
    const card = await screen.findByRole("button", { name: /TAS-102/ });
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    const beforeOpen = requested.length;

    fireEvent.click(card);

    const panel = await screen.findByRole("complementary", { name: "TAS-102 issue" });
    expect(await within(panel).findByText("No comments yet")).toBeVisible();
    expect(within(panel).getByText("No one is watching this issue yet")).toBeVisible();
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));

    const opened = requested.slice(beforeOpen).map((url) => url.split("?")[0]);
    expect(opened).toHaveLength(2);
    expect(opened.sort()).toEqual([`/api/v1/issues/${ISSUE}`, `/api/v1/projects/${PROJECT}/issues/${ISSUE}/comments`].sort());
  });

  /**
   * The end of the read-modify-write, pinned at the screen (TAS-246): an edit
   * is one `PATCH` carrying `If-Match`, with no read of the issue before it.
   * What follows it is the settle — re-reads of what the edit changed — and
   * nothing else writes.
   */
  it("edits with one PATCH carrying If-Match, and no read before it", async () => {
    const queryClient = renderBoard();
    fireEvent.click(await screen.findByRole("button", { name: /TAS-102/ }));
    const panel = await screen.findByRole("complementary", { name: "TAS-102 issue" });
    expect(await within(panel).findByText("No comments yet")).toBeVisible();
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    const beforeEdit = sent.length;

    fireEvent.click(within(panel).getByRole("button", { name: "Low" }));

    await waitFor(() => expect(within(panel).getByRole("button", { name: "Low" })).toHaveClass("is-active"));
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    const edit = sent.slice(beforeEdit);
    expect(edit[0]).toEqual({ path: `/api/v1/issues/${ISSUE}`, method: "PATCH", ifMatch: '"1"' });
    expect(edit.filter((request) => request.method !== "GET")).toHaveLength(1);
    // The settle, after the write and never before it: the issue, the board's
    // page and the notifications. (A search would be re-read too, had one been
    // on screen.)
    expect(edit.slice(1).map((request) => request.path)).toEqual(
      expect.arrayContaining([`/api/v1/issues/${ISSUE}`, `/api/v1/projects/${PROJECT}/issues`, "/api/v1/notifications"]),
    );
  });
});
