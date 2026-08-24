import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskaApi } from "../api/TaskaApi";
import { BoardScreen } from "./BoardScreen";

/**
 * The board reads five things and used to show a failure in only one of them.
 * When the project read and the membership read failed — which is exactly what
 * the live gateway does today, TAS-162 — the board still drew: the name fell
 * back to "Project", the key badge vanished, every write control went disabled
 * and drag stopped working, and nothing on screen said why (TAS-163). These
 * tests are about the difference between a board that cannot be written to and
 * a board that will not say whether it can — and about the two ways the first
 * attempt at saying it got the answer wrong.
 */
const PROJECT_ID = "2e74e49f-0f29-4e03-b4ec-adc4dbf2382e";
/** Somewhere other than the open board, so a route built from the board's own id would be visibly wrong. */
const OTHER_PROJECT_ID = "9c3f7b18-6d21-4a55-8e0b-7f2a1d4c9e30";

const {
  fakeApi,
  seedSearch,
  failSearch,
  seedNotifications,
  readNotifications,
  failIssueById,
  setMembership,
  failMembership,
  holdMembership,
  failProject,
  holdProject,
  failIssues,
  failWorkflow,
  seedLabels,
  holdLabelCreate,
  reset,
} = vi.hoisted(() => {
  const now = "2026-08-01T09:00:00Z";

  const makeIssue = (id: string, issueKey: string, summary: string, description: string) => ({
    id,
    projectId: PROJECT_ID,
    issueNumber: Number(issueKey.split("-")[1]),
    issueKey,
    issueType: "TASK" as const,
    summary,
    description,
    status: "TODO" as const,
    priority: "MEDIUM" as const,
    assigneeId: null,
    reporterId: "user-anna",
    createdAt: now,
    updatedAt: now,
    version: 1,
    deletedAt: null,
    labels: [] as { id: string; name: string; color: string }[],
  });

  const state: {
    membership: { role: "ADMIN" | "MEMBER" | "VIEWER"; isMember: boolean; projectExists: boolean };
    membershipFailure?: Error;
    membershipHeld: boolean;
    projectFailure?: Error;
    projectHeld: boolean;
    issuesFailure?: Error;
    workflowFailure?: Error;
    labels: { id: string; name: string; color: string }[];
    labelCreateHeld: boolean;
    searchHits: { id: string; issueKey: string; issueType: "TASK" | "BUG" | "STORY"; summary: string; priority: "LOW" | "MEDIUM" | "HIGH"; assigneeId: string | null }[];
    searchTotal: number;
    searchFailure?: Error;
    /** The notifications popover: what the bell lists, what it managed to mark read, and a read that fails. */
    notifications: { id: string; title: string; body: string; createdAt: string; readAt: string | null; link: string }[];
    readNotifications: string[];
    issueByIdFailure?: Error;
    /** Issues created during a test, the ones deleted and the fields edited, so the list moves the way a server's would. */
    created: ReturnType<typeof makeIssue>[];
    deleted: Set<string>;
    edits: Record<string, { summary?: string; description?: string }>;
  } = {
    membership: { role: "ADMIN", isMember: true, projectExists: true },
    membershipHeld: false,
    projectHeld: false,
    labels: [],
    labelCreateHeld: false,
    searchHits: [],
    searchTotal: 0,
    notifications: [],
    readNotifications: [],
    created: [],
    deleted: new Set<string>(),
    edits: {},
  };

  const api = {
    hasSession: () => true,
    onSessionExpired: () => () => {},
    getCurrentUser: async () => ({
      id: "user-anna",
      login: "anna",
      email: "anna@example.com",
      displayName: "Anna Ivanova",
      status: "ACTIVE" as const,
    }),
    getProject: async (projectId: string) => {
      if (state.projectHeld) return new Promise(() => {});
      if (state.projectFailure) throw state.projectFailure;
      return {
        id: projectId,
        projectKey: "TAS",
        name: "Taska Platform",
        createdBy: "user-anna",
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
      };
    },
    getMembership: async () => {
      // A request that never settles: the only way to hold a query in the
      // refetch window the banner has to survive.
      if (state.membershipHeld) return new Promise(() => {});
      if (state.membershipFailure) throw state.membershipFailure;
      return state.membership;
    },
    listMembers: async () => [],
    getWorkflow: async () => {
      if (state.workflowFailure) throw state.workflowFailure;
      return {
        id: "workflow",
        name: "Default",
        version: 1,
        createdAt: now,
        updatedAt: now,
        statuses: [{ id: "s1", statusKey: "TODO" as const, name: "To Do", category: "TODO" as const, sortOrder: 10 }],
        transitions: [],
      };
    },
    listIssues: async () => {
      if (state.issuesFailure) throw state.issuesFailure;
      // The description is not empty: the board's own box searches descriptions
      // too, and a fixture with none could not tell whether it does.
      const seeded = makeIssue("issue-1", "TAS-102", "Wire the board to the gateway", "Point the columns at the deployed gateway.");
      const items = [seeded, ...state.created]
        .filter((issue) => !state.deleted.has(issue.id))
        .map((issue) => ({ ...issue, ...(state.edits[issue.id] ?? {}) }));
      return { items, page: 0, pageSize: 100, totalCount: items.length };
    },
    // Both of these move the issue list *and* the server's own match count, the
    // way a server would. That pairing is the whole point: a fixture where only
    // one of them moved could not tell a counter that invalidates its search
    // from one that strands it.
    createIssue: async (_projectId: string, input: { summary: string; description: string }) => {
      const created = makeIssue(`issue-${state.created.length + 2}`, `TAS-20${state.created.length}`, input.summary, input.description);
      state.created = [...state.created, created];
      state.searchTotal += 1;
      return created;
    },
    deleteIssue: async (_projectId: string, issueId: string) => {
      state.deleted.add(issueId);
      state.searchTotal = Math.max(0, state.searchTotal - 1);
    },
    // The third way match membership moves, and the one most likely to be
    // re-broken: editing a summary or a description in or out of a match. It is
    // safe today only because the panel's edit routes through `invalidateBoard`
    // — nothing about the edit itself knows the search exists. Written here so
    // that stops being luck. Every case below edits an issue *out* of its
    // match, so the hit goes with it.
    updateIssue: async (_projectId: string, issueId: string, patch: { summary?: string; description?: string }) => {
      state.edits[issueId] = { ...state.edits[issueId], ...patch };
      state.searchHits = state.searchHits.filter((hit) => hit.id !== issueId);
      state.searchTotal = Math.max(0, state.searchTotal - 1);
      const seeded = makeIssue("issue-1", "TAS-102", "Wire the board to the gateway", "Point the columns at the deployed gateway.");
      return { ...seeded, id: issueId, ...state.edits[issueId] };
    },
    // The search route answers with the short DTO — six fields, no status and
    // no projectId — so the fixture cannot accidentally hand the board an issue
    // where the gateway would hand it a hit.
    searchIssues: async () => {
      if (state.searchFailure) throw state.searchFailure;
      // A deleted issue stops being a hit, the way it stops being a row.
      const items = state.searchHits.filter((hit) => !state.deleted.has(hit.id));
      return { items, page: 0, pageSize: 50, totalCount: state.searchTotal };
    },
    listNotifications: async () => ({ items: state.notifications, pageSize: 20, offset: 0 }),
    markNotificationRead: async (notificationId: string) => {
      state.readNotifications.push(notificationId);
      return state.notifications.find((item) => item.id === notificationId);
    },
    // The project-less read the notifications popover uses. It answers with an
    // issue in a *different* project than the board's on purpose: a
    // notification names an issue and never its project, and a popover that
    // reused the board's would look right in every test and be wrong on every
    // cross-project notification.
    getIssueById: async (issueId: string) => {
      if (state.issueByIdFailure) throw state.issueByIdFailure;
      return {
        issue: { ...makeIssue(issueId, "OTH-9", "Something elsewhere", ""), projectId: OTHER_PROJECT_ID },
        history: [],
      };
    },
    // The board reads the project's labels for its filter. The tests about the
    // five reads above say nothing about labels, so this answers successfully
    // with none — `seedLabels` is what the label tests use to put something in
    // it, rather than every other assertion growing a sixth state.
    listProjectLabels: async () => state.labels,
    createProjectLabel: async (_projectId: string, input: { name: string; color: string }) => {
      // A create that never settles. The defect this covers lives entirely in
      // the window between the optimistic row appearing and the server
      // answering, and against the mock that window is 140ms of real time — a
      // test that raced it would be passing on a stopwatch. Holding the
      // promise makes the window the whole test instead.
      if (state.labelCreateHeld) return new Promise(() => {});
      const label = { id: `label-${state.labels.length + 1}`, name: input.name, color: input.color };
      state.labels = [...state.labels, label];
      return label;
    },
    // The panel's own reads. Empty answers throughout: this is scaffolding for
    // the label picker inside it, not a second set of claims about the panel.
    getIssue: async (projectId: string, issueId: string) => ({
      issue: {
        id: issueId,
        projectId,
        issueNumber: 102,
        issueKey: "TAS-102",
        issueType: "TASK" as const,
        summary: "Wire the board to the gateway",
        description: "",
        status: "TODO" as const,
        priority: "MEDIUM" as const,
        assigneeId: null,
        reporterId: "user-anna",
        createdAt: now,
        updatedAt: now,
        version: 1,
        deletedAt: null,
        labels: [],
        ...(state.edits[issueId] ?? {}),
      },
      history: [],
    }),
    listIssueLabels: async () => [],
    listIssueLinks: async () => [],
    listComments: async () => ({ items: [], page: 0, pageSize: 50, totalCount: 0 }),
  };

  return {
    fakeApi: api as unknown as TaskaApi,
    setMembership: (role: "ADMIN" | "MEMBER" | "VIEWER") => {
      state.membership = { role, isMember: true, projectExists: true };
    },
    failMembership: (error: Error) => {
      state.membershipFailure = error;
    },
    holdMembership: (held: boolean) => {
      state.membershipHeld = held;
    },
    failProject: (error: Error) => {
      state.projectFailure = error;
    },
    holdProject: (held: boolean) => {
      state.projectHeld = held;
    },
    failIssues: (error: Error) => {
      state.issuesFailure = error;
    },
    failWorkflow: (error: Error) => {
      state.workflowFailure = error;
    },
    seedLabels: (labels: { id: string; name: string; color: string }[]) => {
      state.labels = labels;
    },
    holdLabelCreate: (held: boolean) => {
      state.labelCreateHeld = held;
    },
    seedSearch: (hits: typeof state.searchHits, totalCount: number) => {
      state.searchHits = hits;
      state.searchTotal = totalCount;
    },
    failSearch: (error: Error) => {
      state.searchFailure = error;
    },
    seedNotifications: (items: typeof state.notifications) => {
      state.notifications = items;
    },
    readNotifications: () => state.readNotifications,
    failIssueById: (error: Error) => {
      state.issueByIdFailure = error;
    },
    reset: () => {
      state.membership = { role: "ADMIN", isMember: true, projectExists: true };
      state.membershipFailure = undefined;
      state.membershipHeld = false;
      state.projectFailure = undefined;
      state.projectHeld = false;
      state.issuesFailure = undefined;
      state.workflowFailure = undefined;
      state.labels = [];
      state.labelCreateHeld = false;
      state.searchHits = [];
      state.searchTotal = 0;
      state.searchFailure = undefined;
      state.notifications = [];
      state.readNotifications = [];
      state.issueByIdFailure = undefined;
      state.created = [];
      state.deleted = new Set<string>();
      state.edits = {};
    },
  };
});

vi.mock("../api/client", () => ({ taskaApi: fakeApi }));

function Whereabouts() {
  return <span data-testid="whereabouts">{useLocation().pathname}</span>;
}

function renderBoard(initialPath = `/projects/${PROJECT_ID}/board`) {
  // `staleTime` is the app's own (src/main.tsx) rather than react-query's
  // default of 0, so this harness caches the way production does. That is all
  // it is: **it is not what makes the counter tests below bind.** The 2×2 was
  // run — with `20_000` and with `0`, against the fix and against its absence —
  // and the two tests fail without the fix under either value. At 0 react-query
  // still refetches only on a trigger, and `BoardScreen` stays mounted with the
  // same observer for the whole test, so nothing ever re-observes the key.
  //
  // What makes them bind is the fixture: a server total that differs from the
  // loaded page's. The first draft seeded them equal, so "1 of 1" was what the
  // counter read both before the search had answered and after, and the test
  // asserted the pre-search state and measured nothing. The defect never
  // depended on a cache window either — it was a missing invalidation, which is
  // also why re-typing the query could not clear it.
  //
  // The line stays because the harness should mirror production, and because it
  // is now the only thing here that would catch a refetch-on-observe
  // regression.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 20_000 } } });
  const board = <BoardScreen theme="light" toggleTheme={() => {}} onLogout={() => {}} logoutPending={false} />;
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        {/* Where the router actually went. The notification tests are about a
            destination rather than about what renders there, and the
            destination can be a project this fixture draws no board for. */}
        <Whereabouts />
        <Routes>
          <Route path="/projects/:projectId/board" element={board} />
          {/* The same screen with the panel open, which is how the app routes
              it too. Rendering straight at this URL puts the panel's label
              picker and the board's side by side without a drag-enabled card
              having to be clicked first. */}
          <Route path="/projects/:projectId/issues/:issueId" element={board} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return queryClient;
}

/**
 * The board gives a genuine failure one retry (`retryUnlessMissing`), so a
 * banner is a second away rather than a tick away. That budget is deliberate,
 * so the tests wait it out instead of taking it off the screen.
 */
const AFTER_RETRY = { timeout: 3000 };

const membershipKey = ["membership", PROJECT_ID];

describe("board failures the user can see", () => {
  beforeEach(() => {
    reset();
    window.localStorage.clear();
  });

  it("says the role could not be loaded rather than presenting a silent read-only board", async () => {
    failMembership(Object.assign(new Error("Internal error"), { status: 500, requestId: "6f1c2b40-a1e2-4d55" }));
    renderBoard();

    const alert = await screen.findByRole("alert", undefined, AFTER_RETRY);
    expect(alert).toHaveTextContent(/role could not be loaded/i);
    // The gateway's own words and the id that finds this failure in its log sit
    // beside the sentence, not inside its live region: `role="alert"` is
    // assertive and atomic, and a screen reader should not be interrupted to
    // hear a UUID spelled out.
    expect(alert).not.toHaveTextContent("Internal error");
    expect(screen.getByText("Internal error")).toBeVisible();
    expect(screen.getByRole("button", { name: /Copy request id 6f1c2b40-a1e2-4d55/ })).toBeVisible();
    // Still no write access: a role we could not verify is not a role.
    expect(screen.getByRole("button", { name: "New" })).toBeDisabled();
  });

  // The first fix read `membershipQuery.isError`, and react-query resets a
  // query with no data to `status:"pending", error:null` at the *start* of
  // every refetch. So the explanation disappeared on each refocus while the
  // controls it explained stayed off — the silent read-only board of TAS-163,
  // back on a timer.
  it("keeps saying so while it retries, instead of going quiet on every refetch", async () => {
    failMembership(Object.assign(new Error("Internal error"), { status: 500 }));
    const queryClient = renderBoard();
    await screen.findByRole("alert", undefined, AFTER_RETRY);

    holdMembership(true);
    void queryClient.refetchQueries({ queryKey: membershipKey });

    // The window this is about: react-query has thrown the error away and put
    // the query back into `pending`, with no data to show for it.
    await waitFor(() => expect(queryClient.getQueryState(membershipKey)?.status).toBe("pending"));
    expect(queryClient.getQueryState(membershipKey)?.error).toBeNull();

    expect(screen.getByRole("alert")).toHaveTextContent(/role could not be loaded/i);
    expect(screen.getByRole("button", { name: "New" })).toBeDisabled();
    // And the gateway's words are kept across the gap, so the banner does not
    // shrink and grow while the request is in flight.
    expect(screen.getByText("Internal error")).toBeVisible();
  });

  // The other direction of the same mistake: `isError` is *also* true when a
  // background refetch fails while the previous answer is still cached. The
  // board was then fully writable — New, the column "+", the drop targets —
  // under a banner announcing that writing was off.
  it("does not claim writes are off while a cached role still says otherwise", async () => {
    const queryClient = renderBoard();
    await waitFor(() => expect(screen.getByRole("button", { name: "New" })).toBeEnabled());

    failMembership(new Error("Internal error"));
    void queryClient.refetchQueries({ queryKey: membershipKey });
    await waitFor(() => expect(queryClient.getQueryState(membershipKey)?.status).toBe("error"), AFTER_RETRY);

    // Data was retained, so the role is not unknown and nothing changed.
    expect(screen.getByRole("button", { name: "New" })).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not accuse the server when the answer was VIEWER", async () => {
    setMembership("VIEWER");
    renderBoard();

    // Read-only is a permission, not a fault, and gets no banner. Waiting for
    // the board to settle first, so this is the answered state and not the
    // in-flight one that happens to look the same.
    await screen.findByText("To Do");
    expect(screen.getByRole("button", { name: "New" })).toBeDisabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("explains a project that failed to load instead of falling back to the word Project", async () => {
    failProject(Object.assign(new Error("Internal error"), { status: 500, requestId: "c85c0694-7909-4a8a" }));
    renderBoard();

    const alerts = await screen.findAllByRole("alert", undefined, AFTER_RETRY);
    const projectAlert = alerts.find((alert) => /details could not be loaded/i.test(alert.textContent ?? ""));
    expect(projectAlert).toBeDefined();
    expect(screen.getByRole("button", { name: /Copy request id c85c0694-7909-4a8a/ })).toBeVisible();
    // The fallback title is still there — the banner is what stops it reading
    // as the project's actual name.
    expect(screen.getByText("Project")).toBeVisible();
  });

  it("leaves an editor's board alone", async () => {
    renderBoard();

    await waitFor(() => expect(screen.getByRole("button", { name: "New" })).toBeEnabled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  // §4.18's screen has the same failure mode as the banners: reading `isError`
  // handed the project's own chrome — its name, its filters, its columns —
  // back to a visitor the gateway had already refused, for the length of every
  // refetch.
  it("keeps a refused project refused while it asks again", async () => {
    failProject(Object.assign(new Error("Project not found"), { status: 404, code: "NOT_FOUND" }));
    const queryClient = renderBoard();
    await screen.findByRole("heading", { name: /not found/i }, AFTER_RETRY);

    holdProject(true);
    void queryClient.refetchQueries({ queryKey: ["project", PROJECT_ID] });
    await waitFor(() => expect(queryClient.getQueryState(["project", PROJECT_ID])?.status).toBe("pending"));

    expect(screen.getByRole("heading", { name: /not found/i })).toBeVisible();
    expect(screen.queryByRole("button", { name: "New" })).not.toBeInTheDocument();
  });
});

// A board with no issue list said "0" in the column head, "0 of 0" in the
// filter bar and "Drop issues here" in every column — three claims about the
// project, made by a request that never answered, one of them an invitation to
// drop a card into a column whose contents are unknown.
describe("a board that could not read its issues", () => {
  beforeEach(() => {
    reset();
    window.localStorage.clear();
  });

  it("counts nothing rather than counting zero", async () => {
    failIssues(Object.assign(new Error("Internal error"), { status: 500 }));
    renderBoard();

    const alert = await screen.findByRole("alert", undefined, AFTER_RETRY);
    expect(alert).toHaveTextContent(/issues on this board could not be loaded/i);

    const column = screen.getByRole("region", { name: "To Do column" });
    expect(within(column).queryByText("0")).not.toBeInTheDocument();
    expect(within(column).getAllByText("—").length).toBeGreaterThan(0);
    // The dashes carry the word for a screen reader, in both places.
    expect(within(column).getAllByText("unknown").length).toBeGreaterThan(0);
    expect(screen.queryByText("0 of 0")).not.toBeInTheDocument();

    // And no column offers itself as a target for a card.
    expect(screen.queryByText("Drop issues here")).not.toBeInTheDocument();
    expect(within(column).getByText("Not loaded")).toBeVisible();
  });

  it("still counts a genuine zero", async () => {
    renderBoard();

    const column = await screen.findByRole("region", { name: "To Do column" });
    // One seeded issue, and the counter states it.
    expect(within(column).getByText("1")).toBeVisible();
    expect(screen.getByText("1 of 1")).toBeVisible();
  });

  // "0 of 0" from a request that has not answered is the same claim as "0 of 0"
  // from one that failed. §5.6: loading is a skeleton.
  it("counts nothing while the issues are still on their way", async () => {
    renderBoard();

    expect(await screen.findByText("Board")).toBeVisible();
    expect(screen.queryByText("0 of 0")).not.toBeInTheDocument();
    // Then the real numbers arrive.
    expect(await screen.findByText("1 of 1")).toBeVisible();
  });
});

/**
 * The board asks two searches at once and they answer different questions. The
 * box filters the page already loaded — instantly, with no request, which is
 * the thing that must not be traded away — and `GET /issues/search` answers
 * about the whole project underneath it.
 *
 * What these pin is the seam between them: that the local half consults the
 * description it always had, that a server hit is never placed in a status
 * column it has no status for, that the counter stops counting one loaded page,
 * and that a search which failed is not presented as a search that found
 * nothing.
 */
describe("the board's search and the server's", () => {
  beforeEach(() => {
    reset();
    window.localStorage.clear();
  });

  const search = async (text: string) => {
    const box = await screen.findByPlaceholderText("Search issues");
    fireEvent.change(box, { target: { value: text } });
    return box;
  };

  it("keeps a card whose description matches, with nothing on the wire", async () => {
    renderBoard();
    await screen.findByRole("region", { name: "To Do column" });

    // "deployed" is in TAS-102's description and in neither its summary nor its
    // key — the field the predicate used to have and never read.
    await search("deployed");

    expect(screen.getByRole("button", { name: /TAS-102/ })).toBeVisible();
    // Still instant: no server answer is needed for the card to stay.
    expect(within(screen.getByRole("region", { name: "To Do column" })).getByText(/TAS-102/)).toBeVisible();
  });

  it("puts a hit the loaded page does not hold in its own group, never in a column", async () => {
    seedSearch(
      [
        {
          id: "issue-900",
          issueKey: "TAS-900",
          issueType: "BUG",
          summary: "Deployed gateway rejects an empty query",
          priority: "HIGH",
          assigneeId: null,
        },
      ],
      7,
    );
    renderBoard();
    await screen.findByRole("region", { name: "To Do column" });

    await search("deployed");

    const group = await screen.findByRole("region", { name: "Other matches from the server" });
    expect(await within(group).findByText("TAS-900")).toBeVisible();
    // A hit has no status, so no column may claim it — placing one would be a
    // statement the server never made.
    expect(within(screen.getByRole("region", { name: "To Do column" })).queryByText("TAS-900")).not.toBeInTheDocument();
    // And the group says what it is rather than appearing unexplained.
    expect(within(group).getByText(/matches in descriptions/i)).toBeVisible();
  });

  it("counts the server's total instead of the page it happens to have loaded", async () => {
    seedSearch(
      [
        {
          id: "issue-900",
          issueKey: "TAS-900",
          issueType: "BUG",
          summary: "Deployed gateway rejects an empty query",
          priority: "HIGH",
          assigneeId: null,
        },
      ],
      7,
    );
    renderBoard();
    // Before the search, Y is the loaded page, which is all the board knows.
    expect(await screen.findByText("1 of 1")).toBeVisible();

    await search("deployed");

    // One card on the board plus one hit beside it, out of the seven the server
    // says match. `1 of 1` here would have been the old quiet lie.
    expect(await screen.findByText("2 of 7")).toBeVisible();
  });

  it("asks nothing until the query reaches the minimum the gateway enforces", async () => {
    seedSearch([{ id: "issue-900", issueKey: "TAS-900", issueType: "BUG", summary: "Short", priority: "LOW", assigneeId: null }], 7);
    renderBoard();
    await screen.findByRole("region", { name: "To Do column" });

    // Two characters is what the contract permits and the runtime refuses.
    await search("zz");

    await waitFor(() => expect(screen.getByText("0 of 1")).toBeVisible());
    expect(screen.queryByRole("region", { name: "Other matches from the server" })).not.toBeInTheDocument();
  });

  it("says a search failed rather than showing it as nothing found", async () => {
    failSearch(Object.assign(new Error("Internal error"), { status: 500, requestId: "3a1f0b22-91cd-4e77" }));
    renderBoard();
    await screen.findByRole("region", { name: "To Do column" });

    await search("deployed");

    const group = await screen.findByRole("region", { name: "Other matches from the server" }, AFTER_RETRY);
    expect(await within(group).findByText(/could not be searched/i, undefined, AFTER_RETRY)).toBeVisible();
    // Not "nothing else matches", which is a different answer entirely.
    expect(within(group).queryByText(/Nothing else in this project matches/i)).not.toBeInTheDocument();
    // The gateway's own words and the id its log knows this by.
    expect(within(group).getByText("Internal error")).toBeVisible();
    // And Y admits it does not know, rather than falling back to a number that
    // would read as an answer.
    expect(screen.getByText("unknown")).toBeVisible();
    // The local result is still on screen throughout: the failure of the
    // supplement never blanks the board.
    expect(screen.getByRole("button", { name: /TAS-102/ })).toBeVisible();
  });
});

/**
 * The two halves of "X of Y" are read from two caches, and only one of them was
 * ever invalidated. X comes live off the issues query, which every mutation
 * here refreshes; Y is `totalCount` off a search answer held for `staleTime`
 * under a key made of the query text and the filters — none of which a mutation
 * changes. So creating a matching issue moved X and stranded Y at "2 of 1", and
 * re-typing the same query could not correct it, because the key was already
 * the one in the cache.
 *
 * The fix is one line in `invalidateBoard` and will be re-broken by the next
 * person who adds a mutation, so what these two cases pin is the invariant
 * rather than the line: **a mutation that changes what the search would match
 * must move both halves of the counter, or neither.** The delete is here
 * because it is the mirror image and the worse of the two — a stranded Y over a
 * fallen X reads "0 of 1", which looks like a working empty state.
 */
describe("the counter after a mutation", () => {
  beforeEach(() => {
    reset();
    window.localStorage.clear();
  });

  const search = async (text: string) => {
    const box = await screen.findByPlaceholderText("Search issues");
    fireEvent.change(box, { target: { value: text } });
    return box;
  };

  /**
   * The server's answer has to be *distinguishable* from the local fallback, or
   * the precondition cannot be established at all: with a total equal to the
   * loaded page's, "1 of 1" is what the counter reads both before the search
   * has answered and after, and the first draft of this test asserted the
   * before-state and then measured nothing. Two hits and a total of two — one
   * of them a card already on the board, one of them not — make the answered
   * counter read "2 of 2" and the unanswered one "1 of 1".
   */
  const seedAnsweredSearch = () =>
    seedSearch(
      [
        // The card the board already holds: the search finds it too, and the
        // group must not draw it twice.
        { id: "issue-1", issueKey: "TAS-102", issueType: "TASK", summary: "Wire the board to the gateway", priority: "MEDIUM", assigneeId: null },
        // And one it does not.
        { id: "issue-900", issueKey: "TAS-900", issueType: "BUG", summary: "Deployed gateway rejects an empty query", priority: "HIGH", assigneeId: null },
      ],
      2,
    );

  it("moves both halves when a matching issue is created, and does not strand the total", async () => {
    seedAnsweredSearch();
    renderBoard();
    await screen.findByRole("region", { name: "To Do column" });
    await search("deployed");
    // One card plus one hit, out of the two the server says match. Reaching
    // this string is what proves the server's answer is in the cache.
    expect(await screen.findByText("2 of 2")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "New" }));
    // Scoped to the modal: each column head carries a "+" whose title is also
    // "Create issue".
    const dialog = await screen.findByRole("dialog", { name: "New issue" });
    fireEvent.change(within(dialog).getByLabelText("Summary"), {
      target: { value: "Second deployed gateway task" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create issue" }));

    // Two cards and one hit, out of three. Before the fix this read "3 of 2"
    // and stayed there: X is live off the issues query, Y was held for
    // `staleTime` under a key the reader had not changed, so even re-typing the
    // same query could not correct it.
    expect(await screen.findByText("3 of 3")).toBeVisible();
    expect(screen.queryByText("3 of 2")).not.toBeInTheDocument();
  });

  it("moves both halves when a summary is edited out of its match", async () => {
    seedAnsweredSearch();
    renderBoard(`/projects/${PROJECT_ID}/issues/issue-1`);
    await screen.findByRole("region", { name: "To Do column" });
    // "wire" is in the seeded summary and in neither its description nor its
    // key, so editing the summary is the only thing that can take this issue
    // out of the match — with "deployed" the description would hold it in, now
    // that the local predicate reads descriptions too.
    await search("wire");
    expect(await screen.findByText("2 of 2")).toBeVisible();

    // The panel's summary commits on blur (§5.5). This is the third way match
    // membership moves and the one nothing in the edit path knows about: it is
    // safe only because it routes through `invalidateBoard`, and this is what
    // says so if someone gives it its own invalidation later.
    const summary = document.querySelector(".summary-textarea") as HTMLTextAreaElement;
    fireEvent.change(summary, { target: { value: "Connect the board to the live gateway" } });
    fireEvent.blur(summary);

    // No cards and one hit, out of one — the same arithmetic as the delete,
    // reached by editing a word rather than by removing a row.
    expect(await screen.findByText("1 of 1")).toBeVisible();
    expect(screen.queryByText("2 of 2")).not.toBeInTheDocument();
  });

  it("moves both halves when the matching issue is deleted, rather than leaving a total behind an emptier board", async () => {
    seedAnsweredSearch();
    // Straight at the issue route, which is how the app opens the panel: the
    // board is underneath it with the search box still holding the query.
    renderBoard(`/projects/${PROJECT_ID}/issues/issue-1`);
    await screen.findByRole("region", { name: "To Do column" });
    await search("deployed");
    expect(await screen.findByText("2 of 2")).toBeVisible();

    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

    // No cards and one hit, out of one. The mirror image of the create and the
    // more dangerous of the two: a stale total over a board that has lost a
    // card reads as a result set, not as a stale number.
    expect(await screen.findByText("1 of 1")).toBeVisible();
    expect(screen.queryByText("2 of 2")).not.toBeInTheDocument();
  });
});

/**
 * DESIGN.md §4.12 has asked for both ways out of this popover since before it
 * shipped — «Закрытие: Esc, клик вне» — and until now the bell was the only
 * one. §7 carried it as a written defect rather than an oversight. The
 * behaviour is `useDismissOnOutside`, shared with the profile menu and the
 * global search, so what these three assertions actually protect is the one
 * copy all of them use.
 */
describe("the notifications popover", () => {
  beforeEach(() => {
    reset();
    window.localStorage.clear();
  });

  const openBell = async () => {
    const bell = await screen.findByRole("button", { name: "Notifications" });
    fireEvent.click(bell);
    return bell;
  };

  it("closes on Escape and on a press outside, and still toggles from its own bell", async () => {
    renderBoard();

    const bell = await openBell();
    expect(screen.getByRole("button", { name: "Mark all read" })).toBeVisible();
    expect(bell).toHaveAttribute("aria-expanded", "true");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("button", { name: "Mark all read" })).not.toBeInTheDocument();

    fireEvent.click(bell);
    expect(screen.getByRole("button", { name: "Mark all read" })).toBeVisible();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("button", { name: "Mark all read" })).not.toBeInTheDocument();

    // The press that would otherwise close it and let the toggle reopen it in
    // the same click. The ref wraps the bell, so the outside handler never
    // runs and the toggle closes it exactly once.
    fireEvent.click(bell);
    expect(screen.getByRole("button", { name: "Mark all read" })).toBeVisible();
    fireEvent.pointerDown(bell);
    fireEvent.click(bell);
    expect(screen.queryByRole("button", { name: "Mark all read" })).not.toBeInTheDocument();
    expect(bell).toHaveAttribute("aria-expanded", "false");
  });
});

/**
 * Clicking a notification landed on the not-found screen, for every notification
 * the deployed gateway actually sends (TAS-183). `link` was handed straight to
 * `navigate()`, and the gateway's two shapes are its own API path
 * (`/issues/{uuid}`) and the empty string — neither of which is a route this app
 * has. The mock seeded frontend routes, which is exactly why no test saw it.
 *
 * Which id comes out of which shape is `notificationTarget`'s job and is tested
 * in src/domain/notifications.test.ts. These are about what the popover then
 * does with it: one read to learn the project, one route, and the two ways that
 * can not happen.
 */
describe("a notification that is pressed", () => {
  beforeEach(() => {
    reset();
    window.localStorage.clear();
  });

  const ISSUE_ID = "be54f4ca-3b2f-4d81-9f0a-1c7c0a5e11d2";

  const notification = (over: { id: string; link: string; body: string; title?: string }) => ({
    title: over.title ?? "Issue assigned",
    createdAt: "2026-08-01T08:00:00Z",
    readAt: null,
    ...over,
  });

  const openBell = async () => {
    fireEvent.click(await screen.findByRole("button", { name: "Notifications" }));
  };

  const where = () => screen.getByTestId("whereabouts").textContent;

  it("opens the issue named by the gateway's own /issues link, in the project the issue says it is in", async () => {
    seedNotifications([notification({ id: "n1", link: `/issues/${ISSUE_ID}`, body: "TAS-107 was assigned to you" })]);
    renderBoard();
    await openBell();

    fireEvent.click(await screen.findByText("TAS-107 was assigned to you"));

    // The project comes out of the read, never out of the open board: the
    // fixture answers with an issue in a different project precisely so a route
    // built from `useParams` would fail here.
    await waitFor(() => expect(where()).toBe(`/projects/${OTHER_PROJECT_ID}/issues/${ISSUE_ID}`));
    expect(readNotifications()).toContain("n1");
    // Navigating closes the panel, the way it always did.
    expect(screen.queryByRole("button", { name: "Mark all read" })).not.toBeInTheDocument();
  });

  it("opens the issue whose id is only in the body, which is every ISSUE_ASSIGNED the gateway sends", async () => {
    seedNotifications([
      notification({ id: "n2", link: "", body: `Вам назначена задача ${ISSUE_ID}`, title: "Status changed" }),
    ]);
    renderBoard();
    await openBell();

    fireEvent.click(await screen.findByText(`Вам назначена задача ${ISSUE_ID}`));

    await waitFor(() => expect(where()).toBe(`/projects/${OTHER_PROJECT_ID}/issues/${ISSUE_ID}`));
    expect(readNotifications()).toContain("n2");
  });

  it("marks a notification with nothing behind it read and stays where it is", async () => {
    seedNotifications([
      notification({ id: "n3", link: "", body: "Sofia added you to Taska Platform", title: "Added to a project" }),
    ]);
    renderBoard();
    await openBell();

    const row = await screen.findByText("Sofia added you to Taska Platform");
    fireEvent.click(row);

    await waitFor(() => expect(readNotifications()).toContain("n3"));
    // The defect in miniature: a row that navigates nowhere is right, a row
    // that navigates to a screen saying the page does not exist is not.
    expect(where()).toBe(`/projects/${PROJECT_ID}/board`);
    // And it does not offer itself as something that opens.
    expect(row.closest("button")).toHaveClass("is-inert");
  });

  it("says so when the read that resolves the project fails, instead of going quiet", async () => {
    failIssueById(Object.assign(new Error("Internal error"), { status: 500, requestId: "3d9b7a12-44ef-4c08" }));
    seedNotifications([notification({ id: "n4", link: `/issues/${ISSUE_ID}`, body: "TAS-107 was assigned to you" })]);
    renderBoard();
    await openBell();

    fireEvent.click(await screen.findByText("TAS-107 was assigned to you"));

    const alert = await screen.findByRole("alert", undefined, AFTER_RETRY);
    expect(alert).toHaveTextContent(/could not be opened/i);
    // The panel stays open to carry the failure, and the reader is not moved.
    expect(screen.getByRole("button", { name: "Mark all read" })).toBeVisible();
    expect(where()).toBe(`/projects/${PROJECT_ID}/board`);
  });
});

/**
 * A workflow that could not be read used to be indistinguishable from one that
 * had not arrived: both left `workflowQuery.data` undefined, and the fallback
 * filled the gap with four transition ids copied from this repository's own
 * mock seed. The board then offered moves the server had never described, and a
 * drop posted one of those ids to a gateway that has never heard of it
 * (api-contract-guard, TAS-163). The columns are still drawn — their keys come
 * from the contract's `IssueStatus` — but nothing may be moved.
 */
describe("a board that could not read its workflow", () => {
  beforeEach(() => {
    reset();
    window.localStorage.clear();
  });

  it("says so, and still draws the columns the issues need", async () => {
    failWorkflow(Object.assign(new Error("Internal error"), { status: 500, requestId: "0b41d8a2-77c4-4a1f" }));
    renderBoard();

    const alerts = await screen.findAllByRole("alert", undefined, AFTER_RETRY);
    expect(alerts.some((alert) => /workflow could not be loaded/i.test(alert.textContent ?? ""))).toBe(true);
    expect(screen.getByRole("button", { name: /Copy request id 0b41d8a2-77c4-4a1f/ })).toBeVisible();

    // The board is still a board: three contract statuses, and the issue in the
    // column its own `status` names.
    expect(screen.getByRole("region", { name: "To Do column" })).toBeVisible();
    expect(screen.getByRole("region", { name: "In Progress column" })).toBeVisible();
    expect(within(screen.getByRole("region", { name: "To Do column" })).getByText(/TAS-102/)).toBeVisible();
  });

  // The refusal of the drop itself, and the keyboard half of the same defect —
  // the panel's transition buttons — are in e2e/board-drag.spec.ts: both need a
  // real drag or the whole issue panel, and both are only meaningful against an
  // API that would accept the invented id, which the mock does.
});

// §5.7: a VIEWER gets no drag. The first attempt left `useDraggable`'s
// `attributes` on the card, on the grounds that they carry `aria-disabled` —
// but they also carry `aria-roledescription="draggable"` and an
// `aria-describedby` telling the reader to press the space bar, for a gesture
// no sensor here implements and the server would refuse anyway.
describe("a card on a board that cannot be written to", () => {
  beforeEach(() => {
    reset();
    window.localStorage.clear();
  });

  it("is an ordinary button, announced as nothing else", async () => {
    setMembership("VIEWER");
    renderBoard();

    const card = await screen.findByRole("button", { name: /TAS-102/ });
    expect(card).not.toHaveAttribute("aria-roledescription");
    expect(card).not.toHaveAttribute("aria-describedby");
    expect(card).not.toHaveAttribute("aria-disabled");
    expect(card).not.toHaveAttribute("aria-pressed");
    // The one thing it still does.
    expect(card).toBeEnabled();
  });

  it("is a draggable one when the role allows it", async () => {
    renderBoard();

    const card = await screen.findByRole("button", { name: /TAS-102/ });
    await waitFor(() => expect(card).toHaveAttribute("aria-roledescription", "draggable"));
  });
});

/**
 * A create is optimistic, so a new label is drawn the instant it is asked for,
 * carrying `optimisticLabelId` until the server answers with a real one. That
 * placeholder is for the *list*: it is not an address, and every route that
 * takes a label id types it `format: uuid`, so submitting it is "Label not
 * found" from the mock and a 400 from the gateway.
 *
 * Both pickers offered it anyway for the length of the round trip — the board's
 * filter and the panel's "Add label" — which is a control offering an action
 * that cannot succeed, to the one person most likely to take it: whoever just
 * made the label. Held rather than raced, so the window is the whole test.
 */
describe("a label the server has not answered for yet", () => {
  beforeEach(() => {
    reset();
    window.localStorage.clear();
  });

  const optionNames = (select: HTMLElement) =>
    Array.from((select as HTMLSelectElement).options).map((option) => option.textContent);

  it("is drawn in the manage list, and offered by neither picker", async () => {
    seedLabels([{ id: "label-backend", name: "backend", color: "#0052cc" }]);
    holdLabelCreate(true);
    renderBoard(`/projects/${PROJECT_ID}/issues/issue-1`);

    const boardPicker = await screen.findByLabelText("Label");
    const panelPicker = await screen.findByLabelText("Add label");
    await waitFor(() => expect(optionNames(boardPicker)).toEqual(["All", "backend"]));
    expect(optionNames(panelPicker)).toEqual(["Select a label", "backend"]);

    fireEvent.click(screen.getByRole("button", { name: "Manage labels" }));
    fireEvent.change(await screen.findByLabelText("New label"), { target: { value: "release" } });
    fireEvent.click(screen.getByRole("button", { name: "Add label" }));

    // Drawn at once, which is the whole point of the optimistic row — and
    // marked as a row nothing may be done to yet, which the modal already did.
    const pendingRow = await screen.findByRole("button", { name: "Edit release" });
    expect(pendingRow).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete release" })).toBeDisabled();

    // Neither picker grew an option for it.
    expect(optionNames(boardPicker)).toEqual(["All", "backend"]);
    expect(optionNames(panelPicker)).toEqual(["Select a label", "backend"]);
  });

  it("is offered by both the moment the server answers", async () => {
    seedLabels([{ id: "label-backend", name: "backend", color: "#0052cc" }]);
    renderBoard(`/projects/${PROJECT_ID}/issues/issue-1`);

    const boardPicker = await screen.findByLabelText("Label");
    const panelPicker = await screen.findByLabelText("Add label");
    await waitFor(() => expect(optionNames(boardPicker)).toEqual(["All", "backend"]));

    fireEvent.click(screen.getByRole("button", { name: "Manage labels" }));
    fireEvent.change(await screen.findByLabelText("New label"), { target: { value: "release" } });
    fireEvent.click(screen.getByRole("button", { name: "Add label" }));

    // The guard is about an id that does not exist yet, not about hiding a new
    // label: once the create settles, both pickers carry it.
    await waitFor(() => expect(optionNames(boardPicker)).toEqual(["All", "backend", "release"]));
    await waitFor(() => expect(optionNames(panelPicker)).toEqual(["Select a label", "backend", "release"]));
  });
});
