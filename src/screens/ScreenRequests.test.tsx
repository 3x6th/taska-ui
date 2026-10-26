import { QueryClientProvider, focusManager, type QueryClient } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "../lib/queryClient";
import { BoardScreen } from "./BoardScreen";
import { ProjectsScreen } from "./ProjectsScreen";

/**
 * What the two busiest screens cost on the wire, and what coming back to the
 * tab costs (TAS-202): **2 screen reads (+ the profile) + 2 shell reads**, and
 * nothing on focus return.
 *
 * - `/projects` reads the list and `GET /project-stats` in parallel — never an
 *   issue or member read per card, which made it 2N + 4 requests at N projects.
 * - The board reads its context and `GET /projects/{id}/board?includeDone=true`
 *   in parallel — no issue list, no search — and its four filters ask nothing.
 * - A return to the tab re-reads only what failed (`createQueryClient`), so a
 *   screen that loaded costs nothing however stale it is; the bell re-reads its
 *   inbox when it is opened instead.
 *
 * Measured against the real `RestTaskaApi` over a stubbed `fetch` and the
 * app's own query client, so the policy pinned is the page's and every count is
 * a request that would reach the gateway — the method of
 * IssuePanelRequests.test.tsx.
 */

const PROJECT = "2e74e49f-0f29-4e03-b4ec-adc4dbf2382e";
const ANNA = "6d774efa-57d8-4ae0-a27e-2984d1dfbbf6";
const TOM = "8b1f2a3c-4d5e-4f60-9a1b-2c3d4e5f6a7b";
const LABEL = "760798da-9e59-4c54-aaac-4c93de82e68a";
const ISSUE = "7a1b2c3d-0000-4000-8000-000000000101";
const NOW = "2026-10-20T09:00:00Z";

vi.mock("../api/client", async () => {
  // The token has to be in place before the instance reads it at construction.
  window.localStorage.setItem("taska.accessToken", "valid-access");
  const { RestTaskaApi } = await import("../api/rest/RestTaskaApi");
  return { taskaApi: new RestTaskaApi("/api/v1") };
});

/** Nine projects: enough that a per-card read would be unmistakable. */
const projectIds = [PROJECT, ...Array.from({ length: 8 }, (_, index) => `0000000${index}-1111-4222-8333-444444444444`)];

const statuses = [
  { id: "s1", statusKey: "TODO", name: "To Do", category: "TODO", sortOrder: 10 },
  { id: "s2", statusKey: "IN_PROGRESS", name: "In Progress", category: "IN_PROGRESS", sortOrder: 20 },
  { id: "s3", statusKey: "DONE", name: "Done", category: "DONE", sortOrder: 30 },
];
const workflow = {
  id: "workflow",
  name: "Default",
  version: 1,
  statuses,
  transitions: [{ id: "start", fromStatusId: "s1", toStatusId: "s2", name: "Start progress", sortOrder: 10 }],
};

const card = (number: number, issueType: string, statusKey: string, assignee: string | null, labels: unknown[] = []) => ({
  id: `7a1b2c3d-0000-4000-8000-00000000010${number}`,
  issueKey: `TAS-10${number}`,
  summary: `Issue ${number} of the board`,
  issueType,
  priority: "MEDIUM",
  statusKey,
  description: number === 1 ? "Wire the columns to the gateway" : null,
  createdAt: NOW,
  updatedAt: NOW,
  version: 1,
  assignee: assignee ? { id: assignee, displayName: assignee === ANNA ? "Anna Ivanova" : "Tom Baker", avatarUrl: null } : null,
  labels,
});

/** Switches the stub's answers for one test. */
const server = {
  /** `GET /project-stats` refuses while this is set. */
  statsFails: false,
  /** While set, `GET /notifications` waits for it before answering. */
  holdNotifications: null as Promise<void> | null,
};

class Refusal {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {}
}

/** A plausible gateway: enough of each answer for both screens and the panel to draw. */
function respond(path: string, search = new URLSearchParams()): unknown {
  if (path === "/projects") {
    return {
      items: projectIds.map((id, index) => ({
        id,
        projectKey: index === 0 ? "TAS" : `P${index}`,
        name: index === 0 ? "Taska Platform" : `Project ${index}`,
        createdBy: ANNA,
        createdAt: NOW,
        updatedAt: NOW,
        currentUserRole: "ADMIN",
      })),
    };
  }
  if (path === "/project-stats") {
    if (server.statsFails) return new Refusal(503, { code: "UNAVAILABLE", message: "project-service is unavailable" });
    return {
      items: projectIds.map((projectId) => ({
        projectId,
        issueCount: 4,
        memberCount: 2,
        members: [{ userId: ANNA, role: "ADMIN", displayName: "Anna Ivanova", email: "anna@example.com", avatar: null, addedAt: NOW }],
      })),
    };
  }
  if (path === "/users/me") {
    return { id: ANNA, email: "anna@example.com", displayName: "Anna Ivanova", status: "ACTIVE", avatar: null };
  }
  if (path === "/notifications") {
    return {
      items: [
        {
          id: "n-1",
          notificationType: "ISSUE_ASSIGNED",
          title: "TAS-101 was assigned to you",
          body: "Anna Ivanova assigned it to you.",
          issueId: ISSUE,
          projectId: PROJECT,
          createdAt: NOW,
          readAt: null,
          sourceEventId: "e-1",
        },
      ],
      unreadCount: 1,
    };
  }
  if (path === "/meta") {
    return { issueTypes: null, priorities: null, linkTypes: null, notificationTypes: null, userStatuses: null };
  }
  if (path === `/projects/${PROJECT}/context`) {
    return {
      project: { id: PROJECT, projectKey: "TAS", name: "Taska Platform", createdBy: ANNA, createdAt: NOW, updatedAt: NOW, currentUserRole: "ADMIN" },
      members: [
        { userId: ANNA, role: "ADMIN", displayName: "Anna Ivanova", email: "anna@example.com", avatar: null, addedAt: NOW },
        { userId: TOM, role: "MEMBER", displayName: "Tom Baker", email: "tom@example.com", avatar: null, addedAt: NOW },
      ],
      labels: [{ id: LABEL, name: "ui", color: "#0052cc" }],
      issueTypes: [
        { code: "TASK", name: "Task", color: "blue", shape: "square", icon: null, sortOrder: 10 },
        { code: "BUG", name: "Bug", color: "red", shape: "circle", icon: null, sortOrder: 20 },
        { code: "STORY", name: "Story", color: "green", shape: "square", icon: null, sortOrder: 30 },
      ],
      workflows: ["TASK", "BUG", "STORY"].map((issueType) => ({ issueType, workflow })),
    };
  }
  if (path === `/projects/${PROJECT}/board`) {
    // The four filters, applied the way the server applies them (TAS-392),
    // and the counts it states; nothing here is cut.
    const query = search.get("query")?.toLowerCase();
    const keep = (item: ReturnType<typeof card>) =>
      (!search.has("issueType") || item.issueType === search.get("issueType")) &&
      (!search.has("assigneeId") || item.assignee?.id === search.get("assigneeId")) &&
      (!search.has("labelId") || item.labels.some((label) => (label as { id?: string }).id === search.get("labelId"))) &&
      (query === undefined || [item.issueKey, item.summary, item.description ?? ""].some((text) => text.toLowerCase().includes(query)));
    const counted = (issues: ReturnType<typeof card>[]) => ({ issues, totalCount: issues.length, hasMore: false });
    const unplaced = [card(4, "TASK", "BLOCKED_BY_QA", TOM)].filter(keep);
    return {
      projectId: PROJECT,
      columns: [
        {
          ...statuses[0],
          ...counted(
            [card(1, "TASK", "TODO", ANNA, [{ id: LABEL, name: "ui", color: "#0052cc" }]), card(2, "BUG", "TODO", TOM)].filter(keep),
          ),
        },
        { ...statuses[1], ...counted([card(3, "STORY", "IN_PROGRESS", null)].filter(keep)) },
        { ...statuses[2], ...counted([]) },
      ],
      unplacedIssues: unplaced,
      unplacedTotalCount: unplaced.length,
      unplacedHasMore: false,
    };
  }
  if (path === `/issues/${ISSUE}`) {
    const { statusKey, assignee: _assignee, ...rest } = card(1, "TASK", "TODO", ANNA);
    return {
      issue: {
        ...rest,
        projectId: PROJECT,
        issueNumber: 101,
        status: statusKey,
        assigneeId: ANNA,
        reporterId: ANNA,
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
  if (path === `/projects/${PROJECT}/issues/${ISSUE}/worklogs`) {
    return { items: [], page: 0, pageSize: 100, totalCount: 0, hasMore: false };
  }
  // Anything else is a request this budget does not expect: answered as the
  // gateway answers a route it does not serve, and recorded all the same.
  return new Refusal(404, { code: "NOT_FOUND", message: `No route ${path}` });
}

const answer = (body: unknown) =>
  body instanceof Refusal
    ? ({ status: body.status, ok: false, headers: { get: () => null }, json: async () => body.body } as unknown as Response)
    : ({ status: 200, ok: true, headers: { get: () => null }, json: async () => body } as unknown as Response);

describe("the request budget of /projects and the board, and of coming back to the tab", () => {
  /** Every request, as `METHOD /path?query` with the `/api/v1` prefix off. */
  let requested: string[];
  const realNow = Date.now;

  beforeEach(() => {
    window.localStorage.setItem("taska.accessToken", "valid-access");
    requested = [];
    server.statsFails = false;
    server.holdNotifications = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input).replace(/^\/api\/v1/, "");
        requested.push(`${init?.method ?? "GET"} ${url}`);
        const [path, query = ""] = url.split("?");
        if (path === "/notifications" && server.holdNotifications) await server.holdNotifications;
        return answer(respond(path, new URLSearchParams(query)));
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    focusManager.setFocused(undefined);
  });

  const renderAt = (path: string) => {
    const queryClient = createQueryClient();
    const board = <BoardScreen theme="light" toggleTheme={() => {}} onLogout={() => {}} logoutPending={false} />;
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route
              path="/projects"
              element={<ProjectsScreen theme="light" toggleTheme={() => {}} onLogout={() => {}} logoutPending={false} />}
            />
            <Route path="/projects/:projectId/board" element={board} />
            <Route path="/projects/:projectId/issues/:issueId" element={board} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    return queryClient;
  };

  const settled = (queryClient: QueryClient) => waitFor(() => expect(queryClient.isFetching()).toBe(0));
  const since = (mark: number) => requested.slice(mark);

  /** A minute later — past `staleTime` — the tab loses focus and gets it back. */
  const leaveAndReturn = async (queryClient: QueryClient) => {
    const later = realNow() + 60_000;
    vi.spyOn(Date, "now").mockImplementation(() => later);
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));
    await settled(queryClient);
  };

  it("draws /projects with the list and one stats read, and no read per card", async () => {
    const queryClient = renderAt("/projects");
    await waitFor(() => expect(screen.getAllByText("4")).toHaveLength(9));
    await settled(queryClient);

    // The two screen reads, the profile, and the shell's two: the bell's inbox
    // and `GET /meta`, once per session (TAS-173) — in the app the session
    // guard starts that one; here the top bar's search does, in the same round.
    expect([...requested].sort()).toEqual(
      ["GET /projects", "GET /project-stats", "GET /users/me", "GET /notifications", "GET /meta"].sort(),
    );
    expect(requested.filter((request) => /\/projects\/[^/]+\/(issues|members)/.test(request))).toEqual([]);
  });

  it("reads nothing on /projects when the tab comes back, however stale", async () => {
    const queryClient = renderAt("/projects");
    await waitFor(() => expect(screen.getAllByText("4")).toHaveLength(9));
    await settled(queryClient);
    const mark = requested.length;

    await leaveAndReturn(queryClient);

    expect(since(mark)).toEqual([]);
  });

  it("re-reads only a read that failed when the tab comes back", async () => {
    server.statsFails = true;
    const queryClient = renderAt("/projects");
    // The app's one retry, then the banner.
    expect(
      await screen.findByText("Members and issue counts could not be loaded, so the cards show them as unknown.", undefined, {
        timeout: 4000,
      }),
    ).toBeVisible();
    await settled(queryClient);
    const mark = requested.length;

    server.statsFails = false;
    await leaveAndReturn(queryClient);

    expect(since(mark)).toEqual(["GET /project-stats"]);
    await waitFor(() => expect(screen.getAllByText("4")).toHaveLength(9));
  });

  it("re-reads the inbox when the bell is opened past staleTime, keeping its rows meanwhile", async () => {
    const queryClient = renderAt("/projects");
    await waitFor(() => expect(screen.getAllByText("4")).toHaveLength(9));
    await settled(queryClient);
    const mark = requested.length;
    vi.spyOn(Date, "now").mockImplementation(() => realNow() + 60_000);
    let release: () => void = () => {};
    server.holdNotifications = new Promise<void>((resolve) => {
      release = resolve;
    });

    fireEvent.click(screen.getByRole("button", { name: "Notifications, 1 unread" }));

    // The row the cache holds is on screen while the re-read is out.
    expect(await screen.findByText("TAS-101 was assigned to you")).toBeVisible();
    await waitFor(() => expect(since(mark)).toEqual(["GET /notifications"]));
    release();
    await settled(queryClient);
    expect(since(mark)).toEqual(["GET /notifications"]);

    // Closed and opened again within staleTime: nothing.
    fireEvent.click(screen.getByRole("button", { name: "Notifications, 1 unread" }));
    fireEvent.click(screen.getByRole("button", { name: "Notifications, 1 unread" }));
    await settled(queryClient);
    expect(since(mark)).toEqual(["GET /notifications"]);
  });

  it("draws the board with the context and one board read, and none of the reads they replaced", async () => {
    const queryClient = renderAt(`/projects/${PROJECT}/board`);
    await screen.findByRole("button", { name: /TAS-101/ });
    await settled(queryClient);

    expect([...requested].sort()).toEqual(
      [
        `GET /projects/${PROJECT}/context`,
        // Pass 2b's request table (TAS-392): the page size joins the URL.
        `GET /projects/${PROJECT}/board?includeDone=true&pageSizePerColumn=200`,
        "GET /users/me",
        "GET /notifications",
        "GET /meta",
      ].sort(),
    );
    for (const replaced of [
      /\/issues\?|\/issues$/,
      /\/issues\/search/,
      /\/members/,
      /\/labels/,
      /\/workflows?\b/,
      /\/membership/,
      // The registry rides the context (TAS-417): no read of its own.
      /\/issue-types/,
    ]) {
      expect(requested.filter((request) => replaced.test(request)), String(replaced)).toEqual([]);
    }
    expect(requested.some((request) => request.includes("issueType="))).toBe(false);
  });

  // Pass 2b's request table (TAS-392): one read per filter change, none for a
  // combination already read and fresh, none for Clear — and the text after
  // its pause only, trimmed, so a word typed is one read and not one a key.
  it("asks once for each new combination of filters, and nothing for one already read or for Clear", async () => {
    const queryClient = renderAt(`/projects/${PROJECT}/board`);
    await screen.findByRole("button", { name: /TAS-101/ });
    await settled(queryClient);
    const mark = requested.length;

    const type = screen.getByRole("combobox", { name: "Type" });
    fireEvent.change(type, { target: { value: "BUG" } });
    expect(await screen.findByText("1 of 4")).toBeVisible();
    fireEvent.change(type, { target: { value: "" } });
    fireEvent.click(within(document.querySelector(".assignee-row") as HTMLElement).getByRole("button", { name: "Tom Baker" }));
    expect(await screen.findByText("2 of 4")).toBeVisible();
    fireEvent.change(screen.getByRole("combobox", { name: "Label" }), { target: { value: LABEL } });
    expect(await screen.findByText("0 of 4")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(await screen.findByText("4 of 4")).toBeVisible();
    const box = screen.getByRole("textbox", { name: "Filter issues by key, summary or description" });
    for (const typed of ["w", "wi", "wir", " wire "]) fireEvent.change(box, { target: { value: typed } });
    expect(await screen.findByText("1 of 4")).toBeVisible();
    await settled(queryClient);
    // Back to a type already read: from the cache.
    fireEvent.change(box, { target: { value: "" } });
    fireEvent.change(type, { target: { value: "BUG" } });
    expect(await screen.findByText("1 of 4")).toBeVisible();
    await settled(queryClient);

    const board = `GET /projects/${PROJECT}/board`;
    expect(since(mark)).toEqual([
      `${board}?issueType=BUG&includeDone=true&pageSizePerColumn=200`,
      `${board}?assigneeId=${TOM}&includeDone=true&pageSizePerColumn=200`,
      `${board}?assigneeId=${TOM}&labelId=${LABEL}&includeDone=true&pageSizePerColumn=200`,
      `${board}?includeDone=true&query=wire&pageSizePerColumn=200`,
    ]);
  });

  it("opens Issue types from the board's context, asking nothing (TAS-417)", async () => {
    const queryClient = renderAt(`/projects/${PROJECT}/board`);
    await screen.findByRole("button", { name: /TAS-101/ });
    await settled(queryClient);
    const mark = requested.length;

    fireEvent.click(screen.getByRole("button", { name: "Issue types" }));
    const dialog = await screen.findByRole("dialog", { name: "Issue types" });
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(3);
    await settled(queryClient);

    expect(since(mark)).toEqual([]);
  });

  it("reads nothing on the board when the tab comes back, however stale", async () => {
    const queryClient = renderAt(`/projects/${PROJECT}/board`);
    await screen.findByRole("button", { name: /TAS-101/ });
    await settled(queryClient);
    const mark = requested.length;

    await leaveAndReturn(queryClient);

    expect(since(mark)).toEqual([]);
  });

  it("opens a panel over the board for the panel's own three reads and nothing of the board's", async () => {
    const queryClient = renderAt(`/projects/${PROJECT}/board`);
    fireEvent.click(await screen.findByRole("button", { name: /TAS-101/ }));
    await settled(queryClient);
    const mark = requested.length;
    // Its reads were already out with the click; count from before it.
    const opened = requested.filter((request) => request.includes(`/issues/${ISSUE}`));

    expect(await screen.findByRole("dialog", { name: "TAS-101 issue" })).toBeVisible();
    await settled(queryClient);

    expect([...opened].sort()).toEqual(
      [
        `GET /issues/${ISSUE}`,
        `GET /projects/${PROJECT}/issues/${ISSUE}/comments?page=0&pageSize=50`,
        `GET /projects/${PROJECT}/issues/${ISSUE}/worklogs?page=0&pageSize=100`,
      ].sort(),
    );
    expect(since(mark)).toEqual([]);
    expect(requested.filter((request) => request.includes("/board"))).toHaveLength(1);
  });

  it("opens a panel a minute after the board loaded for the panel's own reads, and none of the board's", async () => {
    const queryClient = renderAt(`/projects/${PROJECT}/board`);
    const open = await screen.findByRole("button", { name: /TAS-101/ });
    await settled(queryClient);
    const mark = requested.length;
    // Past `staleTime`: the board and the context, which the panel's link
    // picker and label picker read beside the screen, are stale when it
    // mounts. It reuses what the screen holds and asks for neither again
    // (release-reviewer, TAS-202); the reader's own writes and the focus
    // policy are what refresh them.
    vi.spyOn(Date, "now").mockImplementation(() => realNow() + 60_000);

    fireEvent.click(open);
    expect(await screen.findByRole("dialog", { name: "TAS-101 issue" })).toBeVisible();
    await settled(queryClient);

    expect([...since(mark)].sort()).toEqual(
      [
        `GET /issues/${ISSUE}`,
        `GET /projects/${PROJECT}/issues/${ISSUE}/comments?page=0&pageSize=50`,
        `GET /projects/${PROJECT}/issues/${ISSUE}/worklogs?page=0&pageSize=100`,
      ].sort(),
    );
  });
});
