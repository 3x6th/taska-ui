import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskaApi } from "../api/TaskaApi";
import { BoardScreen } from "./BoardScreen";
import { AttachmentStoreError } from "../api/attachments";

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
  seedMembers,
  seedAttachments,
  failAttachmentsRead,
  failUpload,
  confirmCalls,
  listedAttachments,
  deletedAttachments,
  seedSearch,
  failSearch,
  seedNotifications,
  readNotifications,
  failIssueById,
  holdIssueById,
  releaseIssueById,
  heldIssueByIdCount,
  answeredIssueByIds,
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
    /** Reads held open one at a time, so a test can decide when each one lands and in what order. */
    issueByIdHeld: boolean;
    issueByIdReleases: (() => void)[];
    /** Ids whose read has actually completed. Waiting on a *release* proves nothing: it is synchronous, and the promise it settles has not run its continuations yet. */
    issueByIdAnswered: string[];
    /** Issues created during a test, the ones deleted and the fields edited, so the list moves the way a server's would. */
    created: ReturnType<typeof makeIssue>[];
    deleted: Set<string>;
    edits: Record<string, { summary?: string; description?: string }>;
    /** The panel's attachments section: what it lists, and how each leg answers. */
    /**
     * `GET /projects/{id}/members`. Empty for every other case here — the
     * assignee row is not what they are about — and seeded only where a name
     * has to be resolved from an id, which is how an attachment's byline works.
     */
    members: { userId: string; role: "ADMIN" | "MEMBER" | "VIEWER"; addedAt: string; addedBy: string; user: { displayName: string; email: string } }[];
    attachments: {
      id: string;
      issueId: string;
      fileName: string;
      contentType: string;
      sizeBytes: number;
      uploadedBy: string;
      checksum: string | null;
      createdAt: string;
    }[];
    attachmentsFailure?: Error;
    uploadUrlFailure?: Error;
    putFailure?: Error;
    /**
     * A confirm that rejects. `landsAnyway` is the case the panel exists to get
     * right: the row *is* on the server and only the answer was lost, so the
     * list has to be re-read before anybody is told otherwise.
     */
    confirmFailure?: Error;
    confirmLandsAnyway: boolean;
    confirmCalls: number;
    downloadUrl: string;
    deleted_attachments: string[];
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
    issueByIdHeld: false,
    issueByIdReleases: [],
    issueByIdAnswered: [],
    created: [],
    deleted: new Set<string>(),
    edits: {},
    members: [],
    attachments: [],
    confirmLandsAnyway: false,
    confirmCalls: 0,
    downloadUrl: "https://store.example/taska-attachments/obj?X-Amz-Signature=abc",
    deleted_attachments: [],
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
    listMembers: async () => state.members,
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
      // A read that does not land until the test says so. The two defects
      // below live entirely in the window between the click and the answer,
      // and against a fake that resolves on the next tick that window is not
      // something a test can stand in.
      if (state.issueByIdHeld) {
        await new Promise<void>((resolve) => state.issueByIdReleases.push(resolve));
      }
      state.issueByIdAnswered.push(issueId);
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
    // The attachments section's five reachable calls. `putAttachmentBytes`
    // takes a Blob and answers nothing, exactly as the real middle leg does.
    listAttachments: async () => {
      if (state.attachmentsFailure) throw state.attachmentsFailure;
      return state.attachments.filter((item) => !state.deleted_attachments.includes(item.id));
    },
    createAttachmentUploadUrl: async () => {
      if (state.uploadUrlFailure) throw state.uploadUrlFailure;
      return { uploadUrl: "https://store.example/obj?X-Amz-Signature=abc", objectKey: "obj-1" };
    },
    putAttachmentBytes: async () => {
      if (state.putFailure) throw state.putFailure;
    },
    confirmAttachmentUpload: async (
      _projectId: string,
      issueId: string,
      input: { objectKey: string; fileName: string; contentType: string },
    ) => {
      state.confirmCalls += 1;
      const created = {
        id: `attachment-${state.attachments.length + 1}`,
        issueId,
        fileName: input.fileName,
        contentType: input.contentType,
        sizeBytes: 11,
        uploadedBy: "user-anna",
        checksum: null,
        createdAt: now,
      };
      if (state.confirmFailure) {
        // The server-side half of the write happening while the answer is lost
        // — the only way to reach the panel's "attached after all" sentence.
        if (state.confirmLandsAnyway) state.attachments = [...state.attachments, created];
        throw state.confirmFailure;
      }
      state.attachments = [...state.attachments, created];
      return created;
    },
    getAttachmentDownloadUrl: async () => ({ downloadUrl: state.downloadUrl, checksum: null }),
    deleteAttachment: async (_projectId: string, _issueId: string, attachmentId: string) => {
      state.deleted_attachments.push(attachmentId);
    },
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
    seedMembers: (members: typeof state.members) => {
      state.members = members;
    },
    seedAttachments: (attachments: typeof state.attachments) => {
      state.attachments = attachments;
    },
    failAttachmentsRead: (error: Error) => {
      state.attachmentsFailure = error;
    },
    failUpload: (where: "sign" | "put" | "confirm", error: Error, landsAnyway = false) => {
      if (where === "sign") state.uploadUrlFailure = error;
      if (where === "put") state.putFailure = error;
      if (where === "confirm") {
        state.confirmFailure = error;
        state.confirmLandsAnyway = landsAnyway;
      }
    },
    confirmCalls: () => state.confirmCalls,
    listedAttachments: () => state.attachments.filter((item) => !state.deleted_attachments.includes(item.id)),
    deletedAttachments: () => state.deleted_attachments,
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
    holdIssueById: (held: boolean) => {
      state.issueByIdHeld = held;
    },
    /** Lands the oldest held read. Order is the point: it is how "resolved last" is told from "clicked last". */
    releaseIssueById: () => {
      state.issueByIdReleases.shift()?.();
    },
    heldIssueByIdCount: () => state.issueByIdReleases.length,
    answeredIssueByIds: () => state.issueByIdAnswered,
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
      state.issueByIdHeld = false;
      state.issueByIdReleases = [];
      state.issueByIdAnswered = [];
      state.created = [];
      state.deleted = new Set<string>();
      state.edits = {};
      state.members = [];
      state.attachments = [];
      state.attachmentsFailure = undefined;
      state.uploadUrlFailure = undefined;
      state.putFailure = undefined;
      state.confirmFailure = undefined;
      state.confirmLandsAnyway = false;
      state.confirmCalls = 0;
      state.deleted_attachments = [];
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
 *
 * The bell itself is `src/components/NotificationsBell.tsx` since TAS-185, and
 * these stay here rather than moving with it: they are about the bell as it is
 * mounted, and this file already has the fake `TaskaApi` and the router it
 * needs. The shared bar mounts the same component, so a regression here is a
 * regression on `/projects` and `/admin` too.
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
 *
 * The popover lives in `src/components/NotificationsBell.tsx` since TAS-185 and
 * is reached from two bars now. Nothing here depends on which one: the route is
 * built from the issue's own `projectId`, never from the screen's. Following it
 * from a screen that has no project is pinned in e2e/notifications.spec.ts,
 * which is the only place a real router can say so.
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

    // A resolvable row does not carry the dead-end line.
    expect(screen.queryByText(/Nothing to open/)).not.toBeInTheDocument();
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
    // And it does not offer itself as something that opens. The class carries
    // `cursor: default`, which is worth nothing on a phone or on the keyboard
    // path, so the row says it in words — inside the button, where it reaches
    // the accessible name.
    const button = row.closest("button");
    expect(button).toHaveClass("is-inert");
    expect(button).toHaveTextContent(/Nothing to open/);
    // A row that does go somewhere must not carry it.
    expect(screen.getAllByText(/Nothing to open/)).toHaveLength(1);
  });

  it("says so when the read that resolves the project fails, instead of going quiet", async () => {
    failIssueById(Object.assign(new Error("Internal error"), { status: 500, requestId: "3d9b7a12-44ef-4c08" }));
    seedNotifications([notification({ id: "n4", link: `/issues/${ISSUE_ID}`, body: "TAS-107 was assigned to you" })]);
    renderBoard();
    await openBell();

    fireEvent.click(await screen.findByText("TAS-107 was assigned to you"));

    const alert = await screen.findByRole("alert", undefined, AFTER_RETRY);
    expect(alert).toHaveTextContent(/could not be opened/i);
    // A fault on the server keeps the server's own words and its request id:
    // that half is useful and reveals nothing.
    expect(screen.getByText("Internal error")).toBeVisible();
    expect(screen.getByRole("button", { name: /Copy request id 3d9b7a12-44ef-4c08/ })).toBeVisible();
    // The panel stays open to carry the failure, and the reader is not moved.
    expect(screen.getByRole("button", { name: "Mark all read" })).toBeVisible();
    expect(where()).toBe(`/projects/${PROJECT_ID}/board`);
  });

  /**
   * DESIGN.md §4.18: "there is no such issue" and "that issue is not yours" are
   * one sentence, because a UI that tells them apart confirms that someone
   * else's project exists. The gateway does tell them apart — 404 against 403,
   * with its own wording in each — so the sentence is only half of it; the
   * server's words underneath are where the difference would leak out.
   */
  it.each([
    ["missing", Object.assign(new Error("Issue not found"), { code: "NOT_FOUND", status: 404, requestId: "aa11bb22-cc33" })],
    ["refused", Object.assign(new Error("Not a member of project MOB"), { code: "PERMISSION_DENIED", status: 403, requestId: "aa11bb22-cc33" })],
  ])("reads the same whether the issue is missing or refused (%s)", async (_case, error) => {
    failIssueById(error);
    seedNotifications([notification({ id: "n5", link: `/issues/${ISSUE_ID}`, body: "TAS-107 was assigned to you" })]);
    renderBoard();
    await openBell();

    fireEvent.click(await screen.findByText("TAS-107 was assigned to you"));

    const alert = await screen.findByRole("alert", undefined, AFTER_RETRY);
    expect(alert).toHaveTextContent(/doesn.t exist, or you don.t have access to it/i);
    // Neither the wording that distinguishes them nor the one that names the
    // project the reader was never told about.
    expect(screen.queryByText("Issue not found")).not.toBeInTheDocument();
    expect(screen.queryByText(/Not a member of project/)).not.toBeInTheDocument();
    // The id that finds this failure in the gateway log survives: it identifies
    // the failure without saying which failure it was.
    expect(screen.getByRole("button", { name: /Copy request id aa11bb22-cc33/ })).toBeVisible();
  });

  it("does not navigate when the popover is dismissed before the read lands", async () => {
    holdIssueById(true);
    seedNotifications([notification({ id: "n6", link: `/issues/${ISSUE_ID}`, body: "TAS-107 was assigned to you" })]);
    renderBoard();
    await openBell();

    fireEvent.click(await screen.findByText("TAS-107 was assigned to you"));
    await waitFor(() => expect(heldIssueByIdCount()).toBe(1));

    // The reader changed their mind while the read was in flight.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("button", { name: "Mark all read" })).not.toBeInTheDocument();

    releaseIssueById();

    // An options-level `onSuccess` is called from `Mutation.execute()` with no
    // observer guard, so the navigation used to land here — panel gone, reader
    // moved by a click they had cancelled. Passing the callback to `mutate`
    // puts it behind the library's own `hasListeners()` check.
    await waitFor(() => expect(answeredIssueByIds()).toContain(ISSUE_ID));
    expect(where()).toBe(`/projects/${PROJECT_ID}/board`);
  });

  /**
   * What this pins is the behaviour — the destination is the row that was
   * clicked last — and not either half of the machinery that produces it.
   *
   * Worth saying plainly, because the obvious next question is why there is no
   * assertion aimed at the `awaited` ref specifically. There is nothing to aim
   * at: `MutationObserver.mutate()` detaches the observer from the previous
   * mutation before building the new one, so deleting the ref and keeping the
   * per-call callback leaves this test green. Measured, by deleting it. Like
   * the dismissal test below, this binds against the move from an
   * options-level `onSuccess` to a per-call one; the ref is a backstop for a
   * library internal changing, and a backstop that is currently unreachable is
   * not a thing a test can observe.
   */
  it("goes to the row that was clicked last, whichever read answers first", async () => {
    const SECOND_ID = "7a1d9e30-55cc-4f0e-b2d3-8c6f41ab0e77";
    holdIssueById(true);
    seedNotifications([
      notification({ id: "n7", link: `/issues/${ISSUE_ID}`, body: "First notification" }),
      notification({ id: "n8", link: `/issues/${SECOND_ID}`, body: "Second notification" }),
    ]);
    renderBoard();
    await openBell();

    fireEvent.click(await screen.findByText("First notification"));
    await waitFor(() => expect(heldIssueByIdCount()).toBe(1));
    fireEvent.click(await screen.findByText("Second notification"));
    await waitFor(() => expect(heldIssueByIdCount()).toBe(2));

    // The first read lands first — the order a slower gateway would pick at
    // random, and the order that used to decide the destination. Wait for the
    // *answer*, not for the release: releasing is synchronous and settles a
    // promise whose continuations have not run, so asserting straight after it
    // measures a moment the navigation could not have happened in yet, and the
    // test passes against the defect.
    releaseIssueById();
    await waitFor(() => expect(answeredIssueByIds()).toContain(ISSUE_ID));
    expect(where()).toBe(`/projects/${PROJECT_ID}/board`);

    releaseIssueById();
    await waitFor(() => expect(where()).toBe(`/projects/${OTHER_PROJECT_ID}/issues/${SECOND_ID}`));
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


/**
 * The attachments section (TAS-190). Four things are pinned here and nowhere
 * else, because each of them is a sentence the panel says about a fact only the
 * panel can know:
 *
 * - a 404 from the list has more than one cause, so it must not be read as
 *   "this issue is gone" and must not take the section off the screen;
 * - a confirm that fails is never repeated, and the list is re-read before
 *   anybody is told the file was not attached;
 * - the middle leg does not touch Taska, so a failure with no HTTP status is
 *   named as the network-or-CORS problem it is;
 * - delete is drawn per row, on two different rules.
 */
describe("issue attachments", () => {
  const ISSUE_PATH = `/projects/${PROJECT_ID}/issues/issue-1`;

  const attachment = (over: Partial<ReturnType<typeof baseAttachment>> = {}) => ({ ...baseAttachment(), ...over });
  function baseAttachment() {
    return {
      id: "attachment-seed",
      issueId: "issue-1",
      fileName: "login-500-trace.txt",
      contentType: "text/plain",
      sizeBytes: 2411,
      uploadedBy: "user-anna",
      checksum: null as string | null,
      createdAt: "2026-08-01T09:00:00Z",
    };
  }

  const section = async () => {
    const heading = await screen.findByRole("heading", { name: /attachments/i });
    const found = heading.closest("section");
    if (!found) throw new Error("no attachments section");
    return within(found);
  };

  /**
   * Hands a file to the input the "Attach a file" button drives. The input is
   * `hidden` and has no accessible name on purpose — it is not a tab stop, the
   * button is — so it is reached by class rather than by role, which is the one
   * place in this file that is allowed to.
   */
  const chooseFile = (name = "notes.txt", type = "text/plain") => {
    const fileInput = document.querySelector<HTMLInputElement>(".attachment-input");
    if (!fileInput) throw new Error("no file input");
    fireEvent.change(fileInput, { target: { files: [new File(["trace body"], name, { type })] } });
  };

  beforeEach(() => {
    reset();
    window.localStorage.clear();
  });

  it("lists what is attached, with its size, uploader and time", async () => {
    // The byline resolves a user id through the project's member list, like
    // every other name in the panel. Without a member list there is no name to
    // print, and the row prints the size and the time rather than "Unknown" —
    // which is the state `hybrid` mode is in for anybody but the reader
    // themselves (DESIGN.md §6, TAS-137).
    seedMembers([
      { userId: "user-anna", role: "ADMIN", addedAt: "2026-08-01T09:00:00Z", addedBy: "user-anna", user: { displayName: "Anna Ivanova", email: "anna@example.com" } },
    ]);
    seedAttachments([attachment()]);
    renderBoard(ISSUE_PATH);

    const panel = await section();
    const row = await panel.findByRole("button", { name: "Download login-500-trace.txt" });
    expect(row).toHaveTextContent("login-500-trace.txt");
    expect(row).toHaveTextContent("2.4 KB");
    expect(row).toHaveTextContent("Anna Ivanova");
  });

  it("says the routes are not deployed rather than hiding itself, on the gateway's own 404", async () => {
    // The undeployed signature: a 404 whose message is Spring's static-resource
    // fallback. Measured against the deployed gateway on 2026-09-06.
    failAttachmentsRead(
      Object.assign(new Error(`No static resource api/v1/projects/${PROJECT_ID}/issues/issue-1/attachments for request '…'.`), {
        status: 404,
        code: "NOT_FOUND",
      }),
    );
    renderBoard(ISSUE_PATH);

    const panel = await section();
    expect(await panel.findByText(/not on this gateway yet/i, undefined, AFTER_RETRY)).toBeVisible();
    // The section stays, and the upload control is not offered for a route that
    // does not exist.
    expect(panel.queryByRole("button", { name: /attach a file/i })).toBeNull();
  });

  it("keeps the section and shows the failure for a 404 that is not the undeployed one", async () => {
    // "Issue not found" is a deployed route's own 404. Reading it as "this
    // issue is gone" and dropping the section would hide a whole feature over a
    // failure that may be about one read.
    failAttachmentsRead(Object.assign(new Error("Issue not found"), { status: 404, code: "NOT_FOUND" }));
    renderBoard(ISSUE_PATH);

    const panel = await section();
    expect(await panel.findByText("Issue not found", undefined, AFTER_RETRY)).toBeVisible();
    expect(panel.queryByText(/not on this gateway yet/i)).toBeNull();
    expect(panel.getByRole("heading", { name: /attachments/i })).toBeVisible();
  });

  it("refuses a file the server's allowlist would refuse, before any request", async () => {
    renderBoard(ISSUE_PATH);
    await section();
    // The `.zip` Windows browsers report differently. `accept` lets it through
    // the picker; the allowlist does not.
    chooseFile("bundle.zip", "application/x-zip-compressed");

    const panel = await section();
    expect(await panel.findByText("Content type not allowed: application/x-zip-compressed")).toBeVisible();
    // Nothing was uploaded and nothing was confirmed.
    expect(confirmCalls()).toBe(0);
  });

  it("runs the three legs and shows the new row", async () => {
    renderBoard(ISSUE_PATH);
    await section();
    chooseFile();

    const panel = await section();
    expect(await panel.findByRole("button", { name: "Download notes.txt" })).toBeVisible();
    expect(confirmCalls()).toBe(1);
  });

  it("names a blocked cross-origin PUT as a network-or-CORS problem, not as 'upload failed'", async () => {
    // The shape a refused preflight takes: no status anywhere, because the
    // browser does not tell script why.
    failUpload("put", new AttachmentStoreError("The file store could not be reached: Failed to fetch", "STORAGE_UNREACHABLE", null));
    renderBoard(ISSUE_PATH);
    await section();
    chooseFile();

    const panel = await section();
    const message = await panel.findByText(/could not reach the file store/i);
    expect(message).toHaveTextContent(/straight to storage rather than through Taska/i);
    expect(confirmCalls()).toBe(0);
  });

  it("reads a store 403 as an expired upload link rather than as a permission failure", async () => {
    failUpload("put", new AttachmentStoreError("The file store answered 403.", "STORAGE_REJECTED", 403));
    renderBoard(ISSUE_PATH);
    await section();
    chooseFile();

    const panel = await section();
    expect(await panel.findByText(/15 minutes from the moment the file is chosen/i)).toBeVisible();
  });

  it("re-reads the list after a failed confirm and does not claim the file was lost when it was not", async () => {
    // The confirm succeeded on the server and the answer never came back. This
    // is the sentence the whole "refetch before speaking" rule exists for.
    failUpload("confirm", Object.assign(new Error("Service unavailable"), { status: 503, code: "UNAVAILABLE" }), true);
    renderBoard(ISSUE_PATH);
    await section();
    chooseFile();

    const panel = await section();
    expect(await panel.findByText(/was attached after all/i)).toBeVisible();
    // And the row it is telling the truth about is on screen.
    expect(await panel.findByRole("button", { name: "Download notes.txt" })).toBeVisible();
    // Never repeated: a second confirm is a second row on the server.
    expect(confirmCalls()).toBe(1);
  });

  it("says the file was not attached only when the re-read agrees", async () => {
    failUpload("confirm", Object.assign(new Error("Service unavailable"), { status: 503, code: "UNAVAILABLE" }), false);
    renderBoard(ISSUE_PATH);
    await section();
    chooseFile();

    const panel = await section();
    expect(await panel.findByText(/notes\.txt was not attached/i)).toBeVisible();
    expect(confirmCalls()).toBe(1);
    expect(listedAttachments()).toHaveLength(0);
  });

  it("opens a download link in a new tab and asks for it per click", async () => {
    seedAttachments([attachment()]);
    // Typed with the parameters so the assertions below can read them: a bare
    // `vi.fn(() => …)` infers an empty argument tuple.
    const open = vi.fn((_url: string, _target: string, _features: string) => ({}) as Window);
    vi.stubGlobal("open", open);
    renderBoard(ISSUE_PATH);

    const panel = await section();
    fireEvent.click(await panel.findByRole("button", { name: "Download login-500-trace.txt" }));

    await waitFor(() => expect(open).toHaveBeenCalled());
    expect(open.mock.calls[0][0]).toContain("X-Amz-Signature=");
    expect(open.mock.calls[0][2]).toBe("noopener,noreferrer");
    vi.unstubAllGlobals();
  });

  it("offers the link to click when the browser refused to open it", async () => {
    seedAttachments([attachment()]);
    // `window.open` returning null is the popup blocker's one honest signal.
    vi.stubGlobal("open", vi.fn(() => null));
    renderBoard(ISSUE_PATH);

    const panel = await section();
    fireEvent.click(await panel.findByRole("button", { name: "Download login-500-trace.txt" }));

    const fallback = await panel.findByRole("link", { name: "Open" });
    expect(fallback).toHaveAttribute("href", expect.stringContaining("X-Amz-Signature="));
    expect(fallback).toHaveAttribute("rel", "noopener noreferrer");
    vi.unstubAllGlobals();
  });

  it("removes an attachment optimistically and restores it when the server refuses", async () => {
    seedAttachments([attachment()]);
    renderBoard(ISSUE_PATH);

    const panel = await section();
    fireEvent.click(await panel.findByRole("button", { name: "Delete login-500-trace.txt" }));

    await waitFor(() => expect(deletedAttachments()).toEqual(["attachment-seed"]));
    await waitFor(() => expect(panel.queryByRole("button", { name: "Download login-500-trace.txt" })).toBeNull());
  });

  it("draws delete on your own row for a MEMBER and on nobody else's", async () => {
    setMembership("MEMBER");
    seedAttachments([
      attachment(),
      attachment({ id: "attachment-mark", fileName: "validation-error.png", uploadedBy: "user-mark" }),
    ]);
    renderBoard(ISSUE_PATH);

    const panel = await section();
    // `delete-own-attachment-roles: ADMIN,MEMBER` — Anna uploaded this one.
    expect(await panel.findByRole("button", { name: "Delete login-500-trace.txt" })).toBeVisible();
    // `delete-attachment-roles: ADMIN` — and this reader is not one.
    expect(panel.queryByRole("button", { name: "Delete validation-error.png" })).toBeNull();
  });

  it("draws delete on both rows for an ADMIN", async () => {
    setMembership("ADMIN");
    seedAttachments([
      attachment(),
      attachment({ id: "attachment-mark", fileName: "validation-error.png", uploadedBy: "user-mark" }),
    ]);
    renderBoard(ISSUE_PATH);

    const panel = await section();
    expect(await panel.findByRole("button", { name: "Delete login-500-trace.txt" })).toBeVisible();
    expect(panel.getByRole("button", { name: "Delete validation-error.png" })).toBeVisible();
  });

  it("offers a VIEWER the list and the download and neither write", async () => {
    setMembership("VIEWER");
    seedAttachments([attachment()]);
    renderBoard(ISSUE_PATH);

    const panel = await section();
    expect(await panel.findByRole("button", { name: "Download login-500-trace.txt" })).toBeVisible();
    expect(panel.queryByRole("button", { name: /attach a file/i })).toBeNull();
    expect(panel.queryByRole("button", { name: /^Delete / })).toBeNull();
  });

  it("states the limit and the accepted types before a file is chosen", async () => {
    renderBoard(ISSUE_PATH);

    const panel = await section();
    const hint = await panel.findByText(/Up to 2 MB\./);
    // The list refuses more than people expect, so it is on screen rather than
    // discovered by being refused.
    expect(hint).toHaveTextContent(/JPEG, PNG or WebP images, PDF/);
    expect(hint).toHaveTextContent(/ZIP/);
  });
});
