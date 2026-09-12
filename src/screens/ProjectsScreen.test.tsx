import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskaApi } from "../api/TaskaApi";
import type { ProjectRole } from "../domain/types";
import { ProjectsScreen } from "./ProjectsScreen";

/**
 * Every card on this screen states two numbers it did not fetch itself, and
 * the failure mode that shipped (TAS-163) was that both numbers lied: one
 * project the gateway would not answer for rejected the batch that fetched all
 * of them, and each card then printed "0 issues" — a claim about the project,
 * not an admission about the request. So these tests are entirely about which
 * project's failure reaches which card, and about zero never standing in for
 * unknown.
 */
const {
  fakeApi,
  failIssuesFor,
  failMembersFor,
  failRoleFor,
  holdProjectsList,
  holdSummaries,
  projectsRefetchStarted,
  refuseEdits,
  refuseEditsAsUndeployed,
  releaseProjectsList,
  releaseSummaries,
  reset,
  roleFor,
} = vi.hoisted(() => {
  const state: {
    issueFailures: Set<string>;
    memberFailures: Set<string>;
    roleFailures: Set<string>;
    roles: Record<string, ProjectRole>;
    /** What the server holds after a successful edit, so a refetch agrees with it. */
    edits: Record<string, Record<string, unknown>>;
    refuseEdit: boolean;
    /** The 405 signature `PATCH /projects/{id}` answers with on a gateway that has not deployed backend PR #155. */
    refuseEditAsUndeployed: boolean;
    /** A gate the summary reads wait behind, so the pending state can be looked at. */
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
    issueFailures: new Set<string>(),
    memberFailures: new Set<string>(),
    roleFailures: new Set<string>(),
    roles: {},
    edits: {},
    refuseEdit: false,
    refuseEditAsUndeployed: false,
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
    getCurrentUser: async () => ({
      id: "user-anna",
      login: "anna",
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
      ].map((row) => ({ ...row, ...(state.edits[row.id] ?? {}) }));
    },
    listIssues: async (projectId: string) => {
      if (state.gate) await state.gate;
      if (state.issueFailures.has(projectId)) {
        throw Object.assign(new Error(`Internal error for ${projectId}`), {
          status: 500,
          requestId: "c85c0694-7909-4a8a",
        });
      }
      return { items: [], page: 0, pageSize: 100, totalCount: issueCounts[projectId] ?? 0 };
    },
    listMembers: async (projectId: string) => {
      if (state.memberFailures.has(projectId)) throw new Error(`Internal error for ${projectId}`);
      return [
        {
          userId: "user-anna",
          role: "ADMIN" as const,
          addedAt: now,
          addedBy: "user-anna",
          user: { displayName: "Anna Ivanova", email: "anna@example.com" },
        },
      ];
    },
    // The fallback role read (TAS-148). These rows carry no `currentUserRole`,
    // which is exactly the gateway this build ships against — backend PR #152
    // was open on 2026-09-12 — so every card here takes this path.
    updateProject: async (projectId: string, input: Record<string, unknown>) => {
      // Recorded before the possible throw below: a refusal that never wrote
      // this would let `listProjects` answer the old name on its own, and the
      // rollback test could pass on that coincidence with `onError` deleted.
      // Recording it first means a refetch answers the *new* name, so only a
      // real rollback can show the old one.
      state.edits[projectId] = { ...(state.edits[projectId] ?? {}), ...input };
      // The 405 signature `isUndeployedRoute`'s second arm matches (TAS-148):
      // the path exists for GET, so this is not the static-resource 404, and
      // it carries the code the real gateway names rather than a message the
      // predicate would have to parse.
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
        });
      }
      return { ...project(projectId, "BBB", "Beta"), id: projectId, ...state.edits[projectId] };
    },
    getMembership: async (projectId: string) => {
      if (state.roleFailures.has(projectId)) throw new Error(`Internal error for ${projectId}`);
      return { role: state.roles[projectId] ?? "ADMIN", isMember: true, projectExists: true };
    },
  };

  return {
    fakeApi: api as unknown as TaskaApi,
    failIssuesFor: (projectId: string) => state.issueFailures.add(projectId),
    failMembersFor: (projectId: string) => state.memberFailures.add(projectId),
    failRoleFor: (projectId: string) => state.roleFailures.add(projectId),
    refuseEdits: () => {
      state.refuseEdit = true;
    },
    refuseEditsAsUndeployed: () => {
      state.refuseEditAsUndeployed = true;
    },
    roleFor: (projectId: string, role: ProjectRole) => {
      state.roles[projectId] = role;
    },
    holdSummaries: () => {
      state.gate = new Promise<void>((resolve) => {
        state.openGate = resolve;
      });
    },
    releaseSummaries: () => {
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
      state.issueFailures.clear();
      state.memberFailures.clear();
      state.roleFailures.clear();
      state.roles = {};
      state.edits = {};
      state.refuseEdit = false;
      state.refuseEditAsUndeployed = false;
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

  it("keeps one project's failure out of every other project's card", async () => {
    failIssuesFor("project-b");
    renderProjects();

    // The project that answered still shows its own count.
    expect(await within(await findCard("Alpha")).findByText("9")).toBeVisible();
    expect(within(card("Gamma")).getByText("0")).toBeVisible();

    // And the one that did not is the only card missing a number.
    const beta = card("Beta");
    expect(within(beta).getByText("—")).toBeVisible();
    expect(within(beta).queryByText("0")).not.toBeInTheDocument();
  });

  it("says unknown rather than zero, in words a screen reader can hear", async () => {
    failIssuesFor("project-a");
    failMembersFor("project-a");
    renderProjects();

    const alpha = await findCard("Alpha");
    // Not "0 issues" and not "0 members": the accessible name carries the word.
    expect(alpha).toHaveAccessibleName(/unknown issues/);
    expect(alpha).toHaveAccessibleName(/unknown members/);
    expect(alpha).not.toHaveAccessibleName(/0 issues/);
    expect(alpha).not.toHaveAccessibleName(/0 members/);
  });

  it("still counts the issues when only the member list failed", async () => {
    // The live shape of TAS-162: `listMembers` goes through GET /projects/{id}
    // and 500s, while the issue list answers fine. Joining the two used to
    // throw the good answer away with the bad one.
    failMembersFor("project-a");
    renderProjects();

    const alpha = await findCard("Alpha");
    expect(within(alpha).getByText("9")).toBeVisible();
    expect(alpha).toHaveAccessibleName(/unknown members/);
  });

  it("prints a real zero for a project that genuinely has no issues", async () => {
    renderProjects();

    const gamma = await findCard("Gamma");
    expect(gamma).toHaveAccessibleName(/0 issues/);
    expect(within(gamma).queryByText("—")).not.toBeInTheDocument();
  });

  // Loading and unknown were the same em dash, so every visit began by telling
  // the reader that four requests still in flight had already failed — and the
  // `title="Not loaded"` behind it said so in words (§5.6: loading is a
  // skeleton).
  it("waits with a skeleton rather than declaring the numbers unknown", async () => {
    holdSummaries();
    renderProjects();

    const alpha = await findCard("Alpha");
    expect(alpha).toHaveAccessibleName(/loading issues/);
    expect(alpha).toHaveAccessibleName(/loading members/);
    expect(within(alpha).queryByText("—")).not.toBeInTheDocument();

    // And it gives way to the real number rather than staying.
    releaseSummaries();
    expect(await within(alpha).findByText("9")).toBeVisible();
    expect(alpha).not.toHaveAccessibleName(/loading/);
  });

  // The only trace of a failure used to be a `title` attribute — hover-only, so
  // unreachable from a touch screen and from a keyboard — and neither the
  // gateway's message nor its request id reached the reader at all.
  it("says once, in reachable text, why a number is missing", async () => {
    failIssuesFor("project-b");
    renderProjects();

    const notice = await screen.findByText(/Some project details could not be loaded/i);
    expect(notice).toBeVisible();
    expect(screen.getByText("Internal error for project-b")).toBeVisible();
    expect(screen.getByRole("button", { name: /Copy request id c85c0694-7909-4a8a/ })).toBeVisible();
  });

  it("keeps quiet when every project answered", async () => {
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
 * These rows carry no `currentUserRole`, which is the gateway this build
 * actually ships against, so every case here runs through the `getMembership`
 * fallback in `loadSummary`. That is the point of testing it rather than the
 * list-stated role: the fallback is the branch that exists today.
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

  it("offers nothing when the role could not be read at all", async () => {
    failRoleFor("project-a");
    renderProjects();
    await within(await findCard("Alpha")).findByText("9");

    // A role nobody could read is not a role. The counts still arrive, which is
    // the other half: a refused role read must not take the card's numbers
    // down with it.
    expect(editButton("Alpha")).not.toBeInTheDocument();
    expect(screen.queryByText(/Some project details could not be loaded/)).not.toBeInTheDocument();
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
  });

  // A 405 on a path that exists for GET reads as the gateway not having
  // shipped this write yet (TAS-148), not as a protocol sentence for the
  // reader to puzzle over or act on.
  it("reads a 405 as this gateway not shipping the write yet, not as a failure to act on", async () => {
    refuseEditsAsUndeployed();
    const { dialog } = await openEditor("Beta");
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Beta Renamed" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));

    expect(await within(dialog).findByText(/not on this gateway yet/)).toBeVisible();
    // Never the gateway's own sentence, and never the alarmed red box every
    // other refusal in this dialog gets.
    expect(within(dialog).queryByText(/Request method/)).not.toBeInTheDocument();
    expect(document.querySelector(".form-error")).not.toBeInTheDocument();
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
  });
});
