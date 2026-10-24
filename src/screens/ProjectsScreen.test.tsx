import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskaApi } from "../api/TaskaApi";
import type { ProjectRole } from "../domain/types";
import { ProjectsScreen } from "./ProjectsScreen";

/**
 * Every card on this screen states two numbers it did not fetch itself, and
 * the failure mode that shipped (TAS-163) was that both numbers lied: a read
 * that did not answer was printed as "0 issues" — a claim about the project,
 * not an admission about the request. Since TAS-202 every card's numbers come
 * from one `GET /project-stats`, all or nothing, so these tests are about which
 * answer reaches which card, and about zero never standing in for unknown.
 */
const {
  addProject,
  archiveElsewhere,
  dropFromStats,
  fakeApi,
  failStats,
  holdProjectsList,
  holdStats,
  previewFor,
  projectsRefetchStarted,
  refuseEdits,
  refuseEditsAsArchived,
  refuseEditsAsUndeployed,
  releaseProjectsList,
  releaseStats,
  reset,
  roleFor,
  statesNoRoleFor,
  statsCountsFor,
  statsReads,
} = vi.hoisted(() => {
  const state: {
    /** The stats read fails as a whole with this — the server's all-or-nothing. */
    statsFailure?: Error;
    /** Projects the stats answer leaves out, as a membership that vanished between its two calls would. */
    statsDropped: Set<string>;
    /** Counts by project, `null` where the answer carries none; a count not stated here is the default. */
    counts: Record<string, { issueCount?: number | null; memberCount?: number | null }>;
    /** The member preview by project, when a test needs other than one row. */
    previews: Record<string, { userId: string; displayName: string }[]>;
    statsReads: number;
    /** Projects added after the first read, as a create would. */
    added: string[];
    /** Rows the list answers without a `currentUserRole` — the gateway today. */
    roleless: Set<string>;
    roles: Record<string, ProjectRole>;
    /** What the server holds after a successful edit, so a refetch agrees with it. */
    edits: Record<string, Record<string, unknown>>;
    refuseEdit: boolean;
    /** Projects archived through `archiveProject`, which `GET /projects` leaves out (backend PR #159). */
    archived: Set<string>;
    /** The 405 signature `PATCH /projects/{id}` answers with on a gateway that has not deployed backend PR #155. */
    refuseEditAsUndeployed: boolean;
    /**
     * Somebody else archived the project a moment before the save: the PATCH
     * answers the archived refusal (backend PR #159), and `GET /projects` no
     * longer lists it.
     */
    refuseEditAsArchived: boolean;
    /** A gate the stats read waits behind, so the pending state can be looked at. */
    gate?: Promise<void>;
    openGate?: () => void;
    /**
     * A second, independent gate on `listProjects` itself — held only by the
     * rollback test below. `onSettled` invalidates `["projects"]`
     * unconditionally, success or failure, so a save that failed still ends
     * in a refetch; holding it is what lets that test look at the moment the
     * rollback alone is responsible for the card, before the refetch has a
     * chance to agree or disagree with it.
     */
    listGate?: Promise<void>;
    openListGate?: () => void;
    /**
     * Resolves the moment a held `listProjects` call is entered, which is to
     * say the moment `onSettled`'s `invalidateQueries` reaches this fake.
     * `execute()` in `@tanstack/query-core` awaits `onError` *in full* before
     * `onSettled` even starts, so this is also proof that `onError` — if the
     * dialog has one — has already had its turn. That is what the rollback
     * test waits on rather than the card's own re-render: a rollback this
     * fast can beat React's next paint, so waiting for the optimistic name to
     * become visible first, or for it to disappear on its own, both wait on a
     * frame that may never be drawn.
     */
    listGateEntered?: Promise<void>;
    resolveListGateEntered?: () => void;
  } = {
    statsDropped: new Set<string>(),
    counts: {},
    previews: {},
    statsReads: 0,
    added: [],
    roleless: new Set<string>(),
    roles: {},
    edits: {},
    refuseEdit: false,
    archived: new Set<string>(),
    refuseEditAsUndeployed: false,
    refuseEditAsArchived: false,
  };
  const now = "2026-08-01T09:00:00Z";

  const project = (id: string, projectKey: string, name: string) => ({
    id,
    projectKey,
    name,
    createdBy: "user-anna",
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  });

  const issueCounts: Record<string, number> = { "project-a": 9, "project-b": 4, "project-c": 0 };

  const api = {
    hasSession: () => true,
    onSessionExpired: () => () => {},
    // `GET /meta` (TAS-173), answered with no dictionaries: every reader then
    // uses the build's own words and sets, which is what these tests are about.
    getMeta: async () => ({ issueTypes: null, priorities: null, linkTypes: null, notificationTypes: null, userStatuses: null }),
    getCurrentUser: async () => ({
      id: "user-anna",
      email: "anna@example.com",
      displayName: "Anna Ivanova",
      status: "ACTIVE" as const,
    }),
    listProjects: async () => {
      if (state.listGate) {
        state.resolveListGateEntered?.();
        await state.listGate;
      }
      return [
        project("project-a", "AAA", "Alpha"),
        project("project-b", "BBB", "Beta"),
        project("project-c", "CCC", "Gamma"),
        ...state.added.map((id) => project(id, "DDD", "Delta")),
      ]
        .filter((row) => !state.archived.has(row.id))
        .map((row) => ({
        ...row,
        // `currentUserRole` on the row and nowhere else (backend TAS-137):
        // this screen reads the role from the list and spends no request of
        // its own on it. `roleless` is a row that states none — the key
        // missing, as on every row before TAS-137 deployed.
        ...(state.roleless.has(row.id) ? {} : { currentUserRole: state.roles[row.id] ?? ("ADMIN" as const) }),
        ...(state.edits[row.id] ?? {}),
      }));
    },
    // `GET /project-stats` (backend TAS-211): one entry per listed project, in
    // the list's order, all or nothing.
    getProjectStats: async () => {
      state.statsReads += 1;
      if (state.gate) await state.gate;
      if (state.statsFailure) throw state.statsFailure;
      return ["project-a", "project-b", "project-c", ...state.added]
        .filter((id) => !state.archived.has(id) && !state.statsDropped.has(id))
        .map((projectId) => ({
          projectId,
          issueCount: state.counts[projectId]?.issueCount !== undefined ? state.counts[projectId].issueCount : (issueCounts[projectId] ?? 0),
          memberCount: state.counts[projectId]?.memberCount !== undefined ? state.counts[projectId].memberCount : 1,
          members: (state.previews[projectId] ?? [{ userId: "user-anna", displayName: "Anna Ivanova" }]).map((row) => ({
            userId: row.userId,
            role: "MEMBER" as const,
            addedAt: now,
            user: { displayName: row.displayName, email: `${row.userId}@example.com`, avatarUrl: null },
          })),
        }));
    },
    updateProject: async (projectId: string, input: Record<string, unknown>) => {
      if (state.refuseEditAsArchived) {
        state.archived.add(projectId);
        throw Object.assign(new Error("Project is archived"), {
          code: "FAILED_PRECONDITION",
          status: 400,
          details: { reason: "PROJECT_ARCHIVED" },
          requestId: "5d0e7c31-archived",
        });
      }
      // Recorded before the possible throw below: a refusal that never wrote
      // this would let `listProjects` answer the old name on its own, and the
      // rollback test could pass on that coincidence with `onError` deleted.
      // Recording it first means a refetch answers the *new* name, so only a
      // real rollback can show the old one.
      state.edits[projectId] = { ...(state.edits[projectId] ?? {}), ...input };
      // The 405 `PATCH /projects/{id}` answered before backend PR #155
      // deployed: the path existed for GET, so not the static-resource 404.
      // `isUndeployedRoute` read it as "not deployed yet" until TAS-149 took
      // that arm out; the dialog now shows it as the refusal it is.
      if (state.refuseEditAsUndeployed) {
        throw Object.assign(new Error("Request method 'PATCH' is not supported."), {
          code: "METHOD_NOT_ALLOWED",
          status: 405,
        });
      }
      if (state.refuseEdit) {
        throw Object.assign(new Error("Project was concurrently modified by another request, please retry"), {
          code: "ABORTED",
          status: 409,
          // As `RestTaskaApi.request` attaches it from `X-Request-Id`. A 409
          // telling the reader to retry and a 403 are the two refusals this
          // dialog can actually receive, and for both the gateway log is the
          // only place to learn what happened — so the id has to reach the
          // surface that reports them.
          requestId: "2f1c7d40-9b3e-4a11",
        });
      }
      return { ...project(projectId, "BBB", "Beta"), id: projectId, ...state.edits[projectId] };
    },
    archiveProject: async (projectId: string) => {
      state.archived.add(projectId);
      return { ...project(projectId, "BBB", "Beta"), archivedAt: "2026-10-23T10:00:00Z", currentUserRole: "ADMIN" as const };
    },
    // No `getMembership` on purpose. This screen used to fall back to it for
    // any row that stated no role, which against the gateway meant one extra
    // request per card forever; leaving it off the fake is what makes a
    // reintroduction fail loudly here rather than only on the network tab.
  };

  return {
    fakeApi: api as unknown as TaskaApi,
    failStats: (error: Error | undefined) => {
      state.statsFailure = error;
    },
    dropFromStats: (projectId: string) => state.statsDropped.add(projectId),
    statsCountsFor: (projectId: string, counts: { issueCount?: number | null; memberCount?: number | null }) => {
      state.counts[projectId] = { ...state.counts[projectId], ...counts };
    },
    previewFor: (projectId: string, rows: { userId: string; displayName: string }[]) => {
      state.previews[projectId] = rows;
    },
    statsReads: () => state.statsReads,
    addProject: (projectId: string) => {
      state.added.push(projectId);
    },
    statesNoRoleFor: (projectId: string) => state.roleless.add(projectId),
    refuseEdits: () => {
      state.refuseEdit = true;
    },
    refuseEditsAsUndeployed: () => {
      state.refuseEditAsUndeployed = true;
    },
    refuseEditsAsArchived: () => {
      state.refuseEditAsArchived = true;
    },
    /** Another session archives the project: the next `GET /projects` leaves it out. */
    archiveElsewhere: (projectId: string) => {
      state.archived.add(projectId);
    },
    roleFor: (projectId: string, role: ProjectRole) => {
      state.roles[projectId] = role;
    },
    holdStats: () => {
      state.gate = new Promise<void>((resolve) => {
        state.openGate = resolve;
      });
    },
    releaseStats: () => {
      const open = state.openGate;
      state.gate = undefined;
      state.openGate = undefined;
      open?.();
    },
    holdProjectsList: () => {
      state.listGate = new Promise<void>((resolve) => {
        state.openListGate = resolve;
      });
      state.listGateEntered = new Promise<void>((resolve) => {
        state.resolveListGateEntered = resolve;
      });
    },
    releaseProjectsList: () => {
      const open = state.openListGate;
      state.listGate = undefined;
      state.openListGate = undefined;
      open?.();
    },
    projectsRefetchStarted: () => state.listGateEntered ?? Promise.resolve(),
    reset: () => {
      state.statsFailure = undefined;
      state.statsDropped.clear();
      state.counts = {};
      state.previews = {};
      state.statsReads = 0;
      state.added = [];
      state.roleless.clear();
      state.roles = {};
      state.edits = {};
      state.refuseEdit = false;
      state.archived.clear();
      state.refuseEditAsUndeployed = false;
      state.refuseEditAsArchived = false;
      state.gate = undefined;
      state.openGate = undefined;
      state.listGate = undefined;
      state.openListGate = undefined;
      state.listGateEntered = undefined;
      state.resolveListGateEntered = undefined;
    },
  };
});

vi.mock("../api/client", () => ({ taskaApi: fakeApi }));

/**
 * Returns the `QueryClient` too, which every caller but one ignores. The one
 * that does not is the rollback test below, and for a reason specific to
 * it: this screen briefly drops and re-adds every query observer it holds —
 * measured, not this query alone — around the moment a save settles, so a
 * DOM read taken right then can catch the gap between the drop and the
 * re-add rather than either render either side of it. The cache has no such
 * gap; `setQueryData` is what `onError` calls, straight away, and reading it
 * back is reading the same fact `onError` itself would give a caller.
 */
function renderProjects() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/projects"]}>
        <ProjectsScreen theme="light" toggleTheme={() => {}} onLogout={() => {}} logoutPending={false} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return queryClient;
}

/**
 * The card is a button, and since TAS-148 an ADMIN's card carries a second one
 * on top of it — "Edit <name>" — so a bare match on the project's name now
 * finds two. The lookahead is what keeps these lookups about the card: the
 * card's accessible name opens with its key badge, the edit button's opens with
 * the word "Edit", and nothing else on this screen is named after a project.
 */
const cardName = (name: string) => new RegExp(`^(?!Edit\\b).*${name}`);
const card = (name: string) => screen.getByRole("button", { name: cardName(name) });
const findCard = (name: string) => screen.findByRole("button", { name: cardName(name) });

describe("project cards state what they know", () => {
  beforeEach(() => {
    reset();
    window.localStorage.clear();
  });

  const statsFailure = () =>
    Object.assign(new Error("project-service is unavailable"), { status: 503, code: "UNAVAILABLE", requestId: "c85c0694-7909-4a8a" });

  it("draws every card's counts from one stats read, each found by its project", async () => {
    renderProjects();

    expect(await within(await findCard("Alpha")).findByText("9")).toBeVisible();
    expect(within(card("Beta")).getByText("4")).toBeVisible();
    expect(within(card("Gamma")).getByText("0")).toBeVisible();
    expect(statsReads()).toBe(1);
  });

  it("says unknown rather than zero when the read failed, in words a screen reader can hear", async () => {
    failStats(statsFailure());
    renderProjects();

    const alpha = await findCard("Alpha");
    await waitFor(() => expect(alpha).toHaveAccessibleName(/unknown issues/));
    expect(alpha).toHaveAccessibleName(/unknown members/);
    expect(alpha).not.toHaveAccessibleName(/0 issues/);
    expect(alpha).not.toHaveAccessibleName(/0 members/);
    // All or nothing: every card at once, and no faces.
    expect(card("Gamma")).toHaveAccessibleName(/unknown issues/);
    expect(alpha.querySelectorAll(".avatar")).toHaveLength(0);
  });

  it("says unknown for a project the answer left out, and for a count it did not carry", async () => {
    dropFromStats("project-b");
    statsCountsFor("project-a", { memberCount: null });
    renderProjects();

    const alpha = await findCard("Alpha");
    expect(await within(alpha).findByText("9")).toBeVisible();
    expect(alpha).toHaveAccessibleName(/unknown members/);
    expect(card("Beta")).toHaveAccessibleName(/unknown issues/);
    expect(card("Beta")).toHaveAccessibleName(/unknown members/);
    // A settled answer is not a failure: no banner.
    expect(screen.queryByText(/could not be loaded/i)).not.toBeInTheDocument();
  });

  it("prints a real zero for a project that genuinely has no issues", async () => {
    renderProjects();

    const gamma = await findCard("Gamma");
    await waitFor(() => expect(gamma).toHaveAccessibleName(/0 issues/));
    expect(within(gamma).queryByText("—")).not.toBeInTheDocument();
  });

  it("says one member and one issue in the singular", async () => {
    statsCountsFor("project-b", { issueCount: 1, memberCount: 1 });
    statsCountsFor("project-a", { memberCount: 7 });
    renderProjects();

    const beta = await findCard("Beta");
    await waitFor(() => expect(beta).toHaveAccessibleName(/1 member\b(?!s)/));
    expect(beta).toHaveAccessibleName(/1 issue\b(?!s)/);
    expect(card("Alpha")).toHaveAccessibleName(/7 members/);
    expect(card("Alpha")).toHaveAccessibleName(/9 issues/);
  });

  it("shows the first four of the server's faces, in its order, beside the true count", async () => {
    previewFor("project-a", [
      { userId: "user-zed", displayName: "Zed Young" },
      { userId: "user-anna", displayName: "Anna Ivanova" },
      { userId: "user-tom", displayName: "Tom Baker" },
      { userId: "user-mia", displayName: "Mia Lee" },
      { userId: "user-ola", displayName: "Ola Nord" },
    ]);
    statsCountsFor("project-a", { memberCount: 12 });
    renderProjects();

    const alpha = await findCard("Alpha");
    await waitFor(() => expect(alpha.querySelectorAll(".avatar-stack .avatar")).toHaveLength(4));
    expect([...alpha.querySelectorAll(".avatar-stack .avatar")].map((face) => face.getAttribute("aria-label"))).toEqual([
      "Zed Young",
      "Anna Ivanova",
      "Tom Baker",
      "Mia Lee",
    ]);
    expect(alpha).toHaveAccessibleName(/12 members/);
    expect(within(alpha).queryByText(/\+\d/)).not.toBeInTheDocument();
  });

  // Loading and unknown were the same em dash, so every visit began by telling
  // the reader that requests still in flight had already failed (§5.6: loading
  // is a skeleton).
  it("waits with a skeleton rather than declaring the numbers unknown", async () => {
    holdStats();
    renderProjects();

    const alpha = await findCard("Alpha");
    expect(alpha).toHaveAccessibleName(/loading issues/);
    expect(alpha).toHaveAccessibleName(/loading members/);
    expect(within(alpha).queryByText("—")).not.toBeInTheDocument();

    // And it gives way to the real number rather than staying.
    releaseStats();
    expect(await within(alpha).findByText("9")).toBeVisible();
    expect(alpha).not.toHaveAccessibleName(/loading/);
  });

  it("draws a new project's card pending until the stats answer has it, and keeps the others' numbers", async () => {
    const queryClient = renderProjects();
    await within(await findCard("Alpha")).findByText("9");

    addProject("project-d");
    holdStats();
    void queryClient.invalidateQueries({ queryKey: ["projects"] });
    void queryClient.invalidateQueries({ queryKey: ["project-stats"] });

    const delta = await findCard("Delta");
    expect(delta).toHaveAccessibleName(/loading issues/);
    // A re-read keeps the numbers it already drew.
    expect(within(card("Alpha")).getByText("9")).toBeVisible();

    releaseStats();
    await waitFor(() => expect(delta).toHaveAccessibleName(/0 issues/));
  });

  // The only trace of a failure used to be a `title` attribute — hover-only, so
  // unreachable from a touch screen and from a keyboard — and neither the
  // gateway's message nor its request id reached the reader at all.
  it("says once, in reachable text, why the numbers are missing", async () => {
    failStats(statsFailure());
    renderProjects();

    const notice = await screen.findByText(
      "Members and issue counts could not be loaded, so the cards show them as unknown.",
    );
    expect(notice).toBeVisible();
    expect(screen.getByText("project-service is unavailable")).toBeVisible();
    expect(screen.getByRole("button", { name: /Copy request id c85c0694-7909-4a8a/ })).toBeVisible();
  });

  it("keeps the numbers it drew, and says nothing, when a re-read fails", async () => {
    const queryClient = renderProjects();
    await within(await findCard("Alpha")).findByText("9");

    failStats(statsFailure());
    await queryClient.invalidateQueries({ queryKey: ["project-stats"] });

    expect(within(card("Alpha")).getByText("9")).toBeVisible();
    expect(screen.queryByText(/could not be loaded/i)).not.toBeInTheDocument();
  });

  it("keeps quiet when the read answered", async () => {
    renderProjects();

    await within(await findCard("Alpha")).findByText("9");
    expect(screen.queryByText(/could not be loaded/i)).not.toBeInTheDocument();
  });
});

/**
 * The filter over the cards. It is a client filter and that is not a
 * compromise: `GET /projects` answers with the whole list unpaginated, so there
 * is no page for it to be wrong about — unlike the board's issue box, which is
 * why that one has a server half and this one does not.
 */
describe("filtering the project list", () => {
  beforeEach(() => {
    reset();
    window.localStorage.clear();
  });

  const filterBy = async (text: string) => {
    const box = await screen.findByPlaceholderText("Filter projects");
    fireEvent.change(box, { target: { value: text } });
  };

  it("matches the name, case-insensitively", async () => {
    renderProjects();
    await findCard("Alpha");

    await filterBy("bet");

    expect(card("Beta")).toBeVisible();
    expect(screen.queryByRole("button", { name: cardName("Alpha") })).not.toBeInTheDocument();
  });

  it("matches the project key as well, which is what the cards are labelled with", async () => {
    renderProjects();
    await findCard("Alpha");

    await filterBy("ccc");

    expect(card("Gamma")).toBeVisible();
    expect(screen.queryByRole("button", { name: cardName("Beta") })).not.toBeInTheDocument();
  });

  it("keeps the heading count honest about what it is showing", async () => {
    renderProjects();
    expect(await screen.findByText(/^3 projects/)).toBeVisible();

    await filterBy("a");

    // Three of them contain an "a", so this says what is on screen and what it
    // is out of — "3 projects" under a filter would be a claim about the
    // account rather than about the filter.
    expect(screen.getByText(/^3 of 3 projects/)).toBeVisible();

    await filterBy("bet");
    expect(screen.getByText(/^1 of 3 projects/)).toBeVisible();
  });

  it("says a filter matched nothing, which is not an account with no projects", async () => {
    renderProjects();
    await findCard("Alpha");

    await filterBy("nothing like this");

    expect(screen.getByText(/No projects match/)).toBeVisible();
    expect(screen.getByText(/^0 of 3 projects/)).toBeVisible();
  });

  it("keeps each card's own counts with it while the list is filtered", async () => {
    renderProjects();
    // Counts belong to queries built over the unfiltered list, so a filtered
    // grid read by position would print Alpha's nine on Beta's card.
    await within(await findCard("Alpha")).findByText("9");

    await filterBy("bet");

    const beta = card("Beta");
    expect(within(beta).getByText("4")).toBeVisible();
    expect(within(beta).queryByText("9")).not.toBeInTheDocument();
  });
});

/**
 * Who is offered the edit dialog, and what a card says when the description
 * the server holds is empty (TAS-148).
 *
 * One source for the role and one only: `currentUserRole` on the list row
 * (backend TAS-137). The `getMembership` fallback that used to stand in for a
 * row without one is gone — before TAS-137 deployed it fired on every card,
 * since no row on the gateway stated a role — and the roleless case below is
 * the shape that gateway answered with.
 */
describe("editing a project from its card", () => {
  beforeEach(() => {
    reset();
    window.localStorage.clear();
  });

  const editButton = (name: string) => screen.queryByRole("button", { name: `Edit ${name}` });

  it("offers the dialog to an ADMIN", async () => {
    renderProjects();
    await findCard("Alpha");

    expect(await screen.findByRole("button", { name: "Edit Alpha" })).toBeVisible();
  });

  it.each([["MEMBER" as const], ["VIEWER" as const]])("offers nothing to a %s", async (role) => {
    roleFor("project-a", role);
    renderProjects();
    await within(await findCard("Alpha")).findByText("9");

    // Absent from the markup, not merely hidden — and the server refuses the
    // PATCH either way (§5.7).
    expect(editButton("Alpha")).not.toBeInTheDocument();
  });

  it("offers nothing, and asks nobody, when the row states no role", async () => {
    statesNoRoleFor("project-a");
    renderProjects();
    await within(await findCard("Alpha")).findByText("9");

    // A row that states no role is not a role, and this screen does not go
    // looking for one: the fake has no `getMembership`, so a call to it would
    // fail loudly here rather than quietly cost one request per card.
    expect(editButton("Alpha")).not.toBeInTheDocument();
    expect(screen.queryByText(/could not be loaded/)).not.toBeInTheDocument();
  });

  it("opens the dialog on the project that was clicked, with the key read-only", async () => {
    renderProjects();
    fireEvent.click(await screen.findByRole("button", { name: "Edit Beta" }));

    const dialog = await screen.findByRole("dialog", { name: "Edit project" });
    expect(within(dialog).getByLabelText("Name")).toHaveValue("Beta");
    // The key is stated, never typed into: `UpdateProjectRequestDto` has no
    // `projectKey`, because the key prefixes every issue key in the project.
    expect(within(dialog).getByText("BBB")).toBeVisible();
    expect(within(dialog).queryByLabelText("Key")).not.toBeInTheDocument();
    expect(within(dialog).getByText(/Prefixes every issue key/)).toBeVisible();
  });
});

/**
 * The optimistic half, and the half that has to undo it (TAS-148).
 *
 * DESIGN.md §4 asks every mutation to show at once and roll back on failure,
 * and §5.6 records that this product has no toast — so a rollback that said
 * nothing would be a card sliding back to its old name for no visible reason.
 * The dialog stays open carrying the server's own words instead.
 */
describe("saving a project edit", () => {
  beforeEach(() => {
    reset();
    window.localStorage.clear();
  });

  const openEditor = async (name: string) => {
    const queryClient = renderProjects();
    fireEvent.click(await screen.findByRole("button", { name: `Edit ${name}` }));
    const dialog = await screen.findByRole("dialog", { name: "Edit project" });
    return { dialog, queryClient };
  };

  it("shows the new name on the card at once, and closes on the answer", async () => {
    const { dialog } = await openEditor("Beta");
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Beta Renamed" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));

    expect(await screen.findByRole("button", { name: cardName("Beta Renamed") })).toBeVisible();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit project" })).not.toBeInTheDocument());
  });

  it("puts the old name back when the save is refused, and says why", async () => {
    refuseEdits();
    const { dialog, queryClient } = await openEditor("Beta");

    // Held before the mutation fires: the fake now records a refused edit
    // before it throws (see `updateProject` above), and `onSettled`
    // invalidates `["projects"]` unconditionally — success or failure — so an
    // unheld refetch would put that "new" name straight back regardless of
    // whether `onError` ever ran. Held, that refetch cannot land yet, so the
    // rollback below can only be the rollback's own doing.
    holdProjectsList();
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Beta Renamed" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));

    // What this reads, and why it is the cache rather than the card, is the
    // part two earlier drafts of this test got wrong. Neither direction of
    // the card's own name is a usable signal: waiting for "Beta Renamed" to
    // appear can wait on a frame React never draws — a rollback this fast
    // can be batched away with the optimistic update it undoes, in the same
    // commit, so the two never render apart — and waiting for it to
    // disappear is already true before the mutation even starts, since the
    // project began as "Beta". A DOM read has a second problem on top,
    // measured rather than guessed: this screen briefly drops and re-adds
    // every query observer it holds around the moment a save settles (every
    // key, not only this one, so it is this screen's own render settling,
    // not anything about the mutation), and a read taken in that gap sees
    // neither name.
    //
    // `projectsRefetchStarted` sidesteps the first problem: it resolves the
    // instant a held `listProjects` call is entered, which is `onSettled`
    // reaching this fake, and `execute()` in `@tanstack/query-core` awaits
    // `onError` *in full* first — so by the time it resolves, the rollback
    // has already happened if this dialog has one, as a fact about the
    // mutation rather than about any render of it. Reading the cache
    // directly sidesteps the second: `setQueryData` is what `onError` calls,
    // and it has no gap for a read to land in the way a re-rendering DOM
    // does.
    await projectsRefetchStarted();
    const projects = queryClient.getQueryData<{ id: string; name: string }[]>(["projects"]);
    expect(projects?.find((item) => item.id === "project-b")?.name).toBe("Beta");
    expect(screen.getByRole("dialog", { name: "Edit project" })).toBeVisible();

    // Released only now, and deliberately not checked again afterward: once
    // the held refetch is allowed to land, it answers with `state.edits`'s
    // "Beta Renamed" regardless of the rollback above, because the fake
    // records a refused edit as if the server had kept it (the whole reason
    // this test holds the refetch at all). A real refusal would not do that
    // — this dialog's actual gateway leaves nothing to reconcile with — so
    // asserting on the card again here would be testing the fake's fiction
    // rather than the dialog. What the refetch does once it lands is not
    // this test's question; releasing it is only to let the mutation settle
    // so the dialog can report why.
    releaseProjectsList();
    // The server's own sentence, in the dialog the fields are still in — a
    // refusal reported where there is nothing left open to fix it in is a
    // refusal nobody can act on.
    expect(await within(dialog).findByText(/concurrently modified/)).toBeVisible();
    // And the id that identifies this failure in the gateway log, beside it.
    // A 409 asking the reader to retry is exactly the case where the sentence
    // alone leaves them nothing to take to anyone.
    expect(within(dialog).getByRole("button", { name: "Copy request id 2f1c7d40-9b3e-4a11" })).toBeVisible();
  });

  // Backend PR #155 deployed — `PATCH` answers 401 without a token on
  // 2026-10-23, where it answered 405 — so the dialog's "not on this gateway
  // yet" line went (TAS-149) and a 405 is a refusal like any other.
  it("shows a 405 as the ordinary refusal, in the server's words", async () => {
    refuseEditsAsUndeployed();
    const { dialog } = await openEditor("Beta");
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Beta Renamed" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));

    expect(await within(dialog).findByText("Request method 'PATCH' is not supported.")).toBeVisible();
    expect(within(dialog).queryByText(/not on this gateway yet/)).not.toBeInTheDocument();
  });

  it("spends no request on a dialog nothing was changed in", async () => {
    // An all-absent body is a 200 that changes nothing, so this is not a guard
    // against a refusal — it is a request not worth making, and a Save that
    // looked available would promise a change it was not going to make.
    const { dialog } = await openEditor("Beta");

    expect(within(dialog).getByRole("button", { name: "Save changes" })).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Beta Renamed" } });
    expect(within(dialog).getByRole("button", { name: "Save changes" })).toBeEnabled();

    // And a name emptied out is not a change either: a blank name is a 400,
    // never a clear.
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "   " } });
    expect(within(dialog).getByRole("button", { name: "Save changes" })).toBeDisabled();
    // Said on screen, not left to be worked out. A disabled button cannot take
    // focus, so its own tooltip would never be read.
    expect(within(dialog).getByText(/Save is off until there is one/)).toBeVisible();
  });
});

/**
 * Archiving from a card's Edit dialog (TAS-149, DESIGN.md §4.11 «Успех» from
 * `/projects`): the card leaves the grid in the frame the dialog closes in —
 * `GET /projects` no longer lists it — focus goes to the card that took its
 * place, and the page says what happened.
 */
describe("archiving a project from its card", () => {
  beforeEach(() => {
    reset();
    window.localStorage.clear();
  });

  const archiveFromCard = async (name: string, key: string) => {
    fireEvent.click(await screen.findByRole("button", { name: `Edit ${name}` }));
    const dialog = await screen.findByRole("dialog", { name: "Edit project" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Archive project" }));
    fireEvent.click(within(dialog).getByRole("button", { name: `Archive ${key}` }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit project" })).not.toBeInTheDocument());
  };

  it("takes the card away, hands focus to the next one and says so", async () => {
    renderProjects();
    await findCard("Gamma");

    await archiveFromCard("Beta", "BBB");

    // Gone in the same frame as the dialog, with no archived row of our own.
    expect(screen.queryByRole("button", { name: cardName("Beta") })).not.toBeInTheDocument();
    expect(screen.getByText(/^2\s+projects/)).toBeInTheDocument();
    expect(card("Gamma")).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("BBB archived. It no longer appears in Projects.");
    expect(screen.queryByText("Archived")).not.toBeInTheDocument();
  });

  it("falls back to the card before it, and then to New project", async () => {
    renderProjects();
    await findCard("Gamma");

    await archiveFromCard("Gamma", "CCC");
    expect(card("Beta")).toHaveFocus();

    await archiveFromCard("Beta", "BBB");
    await archiveFromCard("Alpha", "AAA");
    expect(screen.getByRole("button", { name: "New project" })).toHaveFocus();
  });
});

/**
 * Archived by somebody else while its Edit dialog is open (DESIGN.md §4.11,
 * «Архив пришёл отказом Save на `/projects`»; art-director B2, api-contract-
 * guard L1, release-reviewer N3 on TAS-149). The row leaves `["projects"]` on
 * the next read, and the dialog stays on the last row seen, read-only, until
 * the reader closes it; then focus goes where it goes after an archive, and the
 * page says nothing — the dialog did.
 */
describe("a project archived under its open Edit dialog", () => {
  beforeEach(() => {
    reset();
    window.localStorage.clear();
  });

  const openEditor = async (name: string) => {
    const queryClient = renderProjects();
    await findCard("Gamma");
    fireEvent.click(await screen.findByRole("button", { name: `Edit ${name}` }));
    const dialog = await screen.findByRole("dialog", { name: "Edit project" });
    return { dialog, queryClient };
  };

  const expectReadOnly = (dialog: HTMLElement, typed: string) => {
    expect(within(dialog).getByLabelText("Name")).toHaveValue(typed);
    expect(within(dialog).getByLabelText("Name")).toHaveAttribute("readonly");
    expect(within(dialog).queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Archive project" })).not.toBeInTheDocument();
  };

  it("survives its refused Save and the refetch that drops the row, then hands focus to the next card", async () => {
    refuseEditsAsArchived();
    const { dialog } = await openEditor("Beta");
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Beta Renamed" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));

    expect(await within(dialog).findByText("This project has been archived, so nothing in it can be changed.")).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Copy request id 5d0e7c31-archived" })).toBeVisible();
    // The refetch no longer lists it: the card goes, the dialog does not.
    await waitFor(() => expect(screen.queryByRole("button", { name: cardName("Beta") })).not.toBeInTheDocument());
    expect(screen.getByRole("dialog", { name: "Edit project" })).toBe(dialog);
    expectReadOnly(dialog, "Beta Renamed");
    // Its own refusal says it, so no second line.
    expect(within(dialog).queryByText(/no longer appears in Projects/)).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(card("Gamma")).toHaveFocus());
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("says why when the row left without a refusal, and falls back to the card before it", async () => {
    const { dialog, queryClient } = await openEditor("Gamma");
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Gamma typed" } });

    archiveElsewhere("project-c");
    await queryClient.invalidateQueries({ queryKey: ["projects"] });

    expect(
      await within(dialog).findByText("This project no longer appears in Projects, so it cannot be edited here."),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: cardName("Gamma") })).not.toBeInTheDocument();
    expectReadOnly(dialog, "Gamma typed");

    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));

    await waitFor(() => expect(card("Beta")).toHaveFocus());
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});

/**
 * New project (DESIGN.md §4.11, §5.6; TAS-397): a refused create states its
 * request id under the sentence, and `Esc` is `Modal`'s — it closes, except
 * while the description holds text-work.
 */
describe("New project", () => {
  const api = fakeApi as unknown as Record<string, unknown>;

  beforeEach(() => {
    reset();
    window.localStorage.clear();
  });

  const openNewProject = async () => {
    fireEvent.click(await screen.findByRole("button", { name: "New project" }));
    return within(await screen.findByRole("dialog", { name: "New project" }));
  };

  it("says a refused create with its request id under the sentence", async () => {
    api.createProject = vi.fn(() =>
      Promise.reject(Object.assign(new Error("Refused"), { code: "PERMISSION_DENIED", requestId: "req-1" })),
    );
    try {
      renderProjects();
      const dialog = await openNewProject();
      fireEvent.change(dialog.getByLabelText("Key"), { target: { value: "REF" } });
      fireEvent.change(dialog.getByLabelText("Name"), { target: { value: "Refused" } });

      fireEvent.click(dialog.getByRole("button", { name: "Create project" }));

      expect(await dialog.findByText("Refused")).toBeVisible();
      expect(dialog.getByRole("button", { name: "Copy request id req-1" })).toBeVisible();
    } finally {
      delete api.createProject;
    }
  });

  it("closes on Escape, and stays open while the description holds text", async () => {
    renderProjects();
    let dialog = await openNewProject();
    fireEvent.keyDown(dialog.getByLabelText("Key"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "New project" })).not.toBeInTheDocument());

    dialog = await openNewProject();
    const description = dialog.getByLabelText("Description");
    fireEvent.change(description, { target: { value: "What it is for" } });
    description.focus();
    fireEvent.keyDown(description, { key: "Escape" });

    expect(screen.getByRole("dialog", { name: "New project" })).toBeInTheDocument();
    expect(description).toHaveFocus();
    expect(description).toHaveValue("What it is for");
  });
});
