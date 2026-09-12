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
  holdSummaries,
  refuseEdits,
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
    /** A gate the summary reads wait behind, so the pending state can be looked at. */
    gate?: Promise<void>;
    openGate?: () => void;
  } = {
    issueFailures: new Set<string>(),
    memberFailures: new Set<string>(),
    roleFailures: new Set<string>(),
    roles: {},
    edits: {},
    refuseEdit: false,
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
    listProjects: async () =>
      [
        project("project-a", "AAA", "Alpha"),
        project("project-b", "BBB", "Beta"),
        project("project-c", "CCC", "Gamma"),
      ].map((row) => ({ ...row, ...(state.edits[row.id] ?? {}) })),
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
      if (state.refuseEdit) {
        throw Object.assign(new Error("Project was concurrently modified by another request, please retry"), {
          code: "ABORTED",
          status: 409,
        });
      }
      state.edits[projectId] = { ...(state.edits[projectId] ?? {}), ...input };
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
    reset: () => {
      state.issueFailures.clear();
      state.memberFailures.clear();
      state.roleFailures.clear();
      state.roles = {};
      state.edits = {};
      state.refuseEdit = false;
      state.gate = undefined;
      state.openGate = undefined;
    },
  };
});

vi.mock("../api/client", () => ({ taskaApi: fakeApi }));

function renderProjects() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/projects"]}>
        <ProjectsScreen theme="light" toggleTheme={() => {}} onLogout={() => {}} logoutPending={false} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
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
    renderProjects();
    fireEvent.click(await screen.findByRole("button", { name: `Edit ${name}` }));
    return screen.findByRole("dialog", { name: "Edit project" });
  };

  it("shows the new name on the card at once, and closes on the answer", async () => {
    const dialog = await openEditor("Beta");
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Beta Renamed" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));

    expect(await screen.findByRole("button", { name: cardName("Beta Renamed") })).toBeVisible();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit project" })).not.toBeInTheDocument());
  });

  it("puts the old name back when the save is refused, and says why", async () => {
    refuseEdits();
    const dialog = await openEditor("Beta");
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Beta Renamed" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));

    // The server's own sentence, in the dialog the fields are still in — a
    // refusal reported where there is nothing left open to fix it in is a
    // refusal nobody can act on.
    expect(await within(dialog).findByText(/concurrently modified/)).toBeVisible();
    expect(screen.getByRole("dialog", { name: "Edit project" })).toBeVisible();

    await waitFor(() => expect(screen.getByRole("button", { name: cardName("Beta") })).toBeVisible());
    expect(screen.queryByRole("button", { name: cardName("Beta Renamed") })).not.toBeInTheDocument();
  });

  it("spends no request on a dialog nothing was changed in", async () => {
    // An all-absent body is a 200 that changes nothing, so this is not a guard
    // against a refusal — it is a request not worth making, and a Save that
    // looked available would promise a change it was not going to make.
    const dialog = await openEditor("Beta");

    expect(within(dialog).getByRole("button", { name: "Save changes" })).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Beta Renamed" } });
    expect(within(dialog).getByRole("button", { name: "Save changes" })).toBeEnabled();

    // And a name emptied out is not a change either: a blank name is a 400,
    // never a clear.
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "   " } });
    expect(within(dialog).getByRole("button", { name: "Save changes" })).toBeDisabled();
  });
});
