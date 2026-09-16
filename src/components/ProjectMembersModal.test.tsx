import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskaApi } from "../api/TaskaApi";
import type { Project, ProjectMember, ProjectRole } from "../domain/types";
import { ProjectMembersModal } from "./ProjectMembersModal";

/**
 * The members dialog (TAS-158). What is pinned here is what the dialog does
 * with an answer, never what the server answers — that half lives in
 * src/api/members.test.ts against both implementations.
 *
 * Four things in particular: the controls exist for an ADMIN and for nobody
 * else; an add, a role change and a removal are drawn before the server answers
 * and put back, with the reason, when it refuses; the last ADMIN is neither
 * offered a demotion nor a removal, and is told why; and a row the member read
 * could not name (TAS-227) is drawn as its id rather than as somebody.
 */
const PROJECT = "2e74e49f-0f29-4e03-b4ec-adc4dbf2382e";
const OTHER_PROJECT = "58e93598-ea1a-460d-9d72-f1f201c310e2";
const ANNA = "6d774efa-57d8-4ae0-a27e-2984d1dfbbf6";
const MARK = "e65186a2-b807-42ae-a66f-711be116a93b";
const SOFIA = "16ad2404-96e3-4c51-b00d-55c5d1451d3c";
const PRIYA = "fdf35fa6-e68b-4dbe-8a48-5867d7f08ce9";
const NOBODY = "0b1c2d3e-4f50-4617-8a9b-0c1d2e3f4a5b";

const { fakeApi, state, reset, release, releaseList } = vi.hoisted(() => {
  const directory: Record<string, { displayName: string; email: string }> = {
    "6d774efa-57d8-4ae0-a27e-2984d1dfbbf6": { displayName: "Anna Ivanova", email: "anna@example.com" },
    "e65186a2-b807-42ae-a66f-711be116a93b": { displayName: "Mark Lee", email: "mark@example.com" },
    "16ad2404-96e3-4c51-b00d-55c5d1451d3c": { displayName: "Sofia Reyes", email: "sofia@example.com" },
    "fdf35fa6-e68b-4dbe-8a48-5867d7f08ce9": { displayName: "Priya Nair", email: "priya@example.com" },
  };

  const person = (userId: string, role: ProjectRole | null) => ({
    userId,
    role,
    user: directory[userId] ? { ...directory[userId], avatarUrl: null } : undefined,
  });

  const state = {
    directory,
    person,
    members: [] as ProjectMember[],
    listFailure: undefined as Error | undefined,
    addFailure: undefined as Error | undefined,
    roleFailure: undefined as Error | undefined,
    removeFailure: undefined as Error | undefined,
    /** Writes held open, so a case can look at the screen between the press and the answer. */
    held: false,
    releases: [] as (() => void)[],
    /**
     * Member reads held open. A write settles by reading the list again, and a
     * fake that answered that read at once would put a refused change back by
     * itself — so a rollback test holds the read to see the rollback alone.
     */
    listHeld: false,
    listReleases: [] as (() => void)[],
    adds: [] as [string, string, ProjectRole][],
    roleChanges: [] as [string, string, ProjectRole][],
    removals: [] as [string, string][],
  };

  const hold = async () => {
    if (!state.held) return;
    await new Promise<void>((resolve) => state.releases.push(resolve));
  };

  const api = {
    listMembers: async () => {
      if (state.listHeld) await new Promise<void>((resolve) => state.listReleases.push(resolve));
      if (state.listFailure) throw state.listFailure;
      return state.members.map((member) => ({ ...member }));
    },
    addProjectMember: async (projectId: string, userId: string, role: ProjectRole) => {
      state.adds.push([projectId, userId, role]);
      await hold();
      if (state.addFailure) throw state.addFailure;
      state.members = [...state.members, person(userId, role)];
      return { projectId, userId, role };
    },
    changeProjectMemberRole: async (projectId: string, userId: string, role: ProjectRole) => {
      state.roleChanges.push([projectId, userId, role]);
      await hold();
      if (state.roleFailure) throw state.roleFailure;
      state.members = state.members.map((member) => (member.userId === userId ? { ...member, role } : member));
      return { projectId, userId, role };
    },
    removeProjectMember: async (projectId: string, userId: string) => {
      state.removals.push([projectId, userId]);
      await hold();
      if (state.removeFailure) throw state.removeFailure;
      state.members = state.members.filter((member) => member.userId !== userId);
    },
  };

  const reset = () => {
    state.members = [
      person("6d774efa-57d8-4ae0-a27e-2984d1dfbbf6", "ADMIN"),
      person("e65186a2-b807-42ae-a66f-711be116a93b", "MEMBER"),
      person("16ad2404-96e3-4c51-b00d-55c5d1451d3c", "MEMBER"),
    ];
    state.listFailure = undefined;
    state.addFailure = undefined;
    state.roleFailure = undefined;
    state.removeFailure = undefined;
    state.held = false;
    state.releases = [];
    state.listHeld = false;
    state.listReleases = [];
    state.adds = [];
    state.roleChanges = [];
    state.removals = [];
  };

  const release = () => {
    const pending = state.releases;
    state.releases = [];
    pending.forEach((resolve) => resolve());
  };

  const releaseList = () => {
    state.listHeld = false;
    const pending = state.listReleases;
    state.listReleases = [];
    pending.forEach((resolve) => resolve());
  };

  return { fakeApi: api as unknown as TaskaApi, state, reset, release, releaseList };
});

vi.mock("../api/client", () => ({ taskaApi: fakeApi }));

/** A gateway-shaped refusal: the code the mock carries, and the status and request id only a wire can. */
const refusal = (code: string, status: number, message: string, requestId = "req-7f0e6d5c") =>
  Object.assign(new Error(message), { code, status, requestId });

function renderPanel(props: { isProjectAdmin?: boolean; currentUserId?: string } = {}) {
  const queryClient = new QueryClient({
    // `retryDelay` rather than `retry`: the dialog states its own retry rule on
    // the member read, which a default here would not reach.
    defaultOptions: { queries: { retry: false, retryDelay: 1 }, mutations: { retry: false } },
  });
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/projects/${PROJECT}/board`]}>
        <Routes>
          <Route
            element={
              <ProjectMembersModal
                currentUserId={props.currentUserId ?? ANNA}
                isProjectAdmin={props.isProjectAdmin ?? true}
                onClose={onClose}
                projectId={PROJECT}
                projectKey="TAS"
              />
            }
            path="/projects/:projectId/board"
          />
          <Route element={<p>Projects page</p>} path="/projects" />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { queryClient, onClose };
}

const dialog = () => screen.getByRole("dialog", { name: "Members" });
const rowOf = (text: string) => {
  const row = within(dialog()).getByText(text).closest("li");
  if (!row) throw new Error(`no row for ${text}`);
  return row;
};

beforeEach(() => {
  reset();
});

describe("ProjectMembersModal", () => {
  it("shows every member to a reader who is not an admin, with no control to change any of them", async () => {
    renderPanel({ isProjectAdmin: false, currentUserId: MARK });

    expect(await within(dialog()).findByText("Anna Ivanova")).toBeVisible();
    expect(within(rowOf("Anna Ivanova")).getByText("Admin")).toBeVisible();
    expect(within(rowOf("Mark Lee")).getByText("(you)")).toBeVisible();
    expect(within(rowOf("Sofia Reyes")).getByText("sofia@example.com")).toBeVisible();
    expect(within(dialog()).getByText("Only a project admin can add, change or remove members.")).toBeVisible();

    // Absent from the markup, not hidden by a style — and the server refuses
    // every one of these writes regardless (DESIGN.md §5.7).
    expect(within(dialog()).queryByRole("textbox")).toBeNull();
    expect(within(dialog()).queryByRole("combobox")).toBeNull();
    expect(within(dialog()).queryByRole("button", { name: /^Remove/ })).toBeNull();
    // Focus is inside the dialog even with nothing to type into (§7).
    expect(within(dialog()).getByRole("heading", { name: /Current members/ })).toHaveFocus();
  });

  it("adds by user ID: refuses a malformed one, draws the pending row, then the member the server names", async () => {
    renderPanel();
    await within(dialog()).findByText("Mark Lee");

    const field = within(dialog()).getByLabelText("Add by user ID");
    const add = within(dialog()).getByRole("button", { name: "Add" });
    expect(field).toHaveFocus();
    expect(add).toHaveAttribute("aria-disabled", "true");

    fireEvent.change(field, { target: { value: "Priya Nair" } });
    expect(within(dialog()).getByText(/This is not a user ID yet/)).toBeVisible();
    expect(add).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(add);
    expect(state.adds).toHaveLength(0);

    // Pasted the way ids usually arrive: padded and in the wrong case.
    fireEvent.change(field, { target: { value: `  ${PRIYA.toUpperCase()} ` } });
    fireEvent.change(within(dialog()).getByLabelText("Role"), { target: { value: "VIEWER" } });
    expect(add).not.toHaveAttribute("aria-disabled");

    state.held = true;
    fireEvent.click(add);

    // Cleared in the handler, not when the answer lands.
    expect(field).toHaveValue("");
    // Sent normalised: the id the server will store, not the one pasted.
    await waitFor(() => expect(state.adds).toEqual([[PROJECT, PRIYA, "VIEWER"]]));
    const pending = (await within(dialog()).findByText(PRIYA)).closest("li");
    expect(pending).toHaveClass("is-pending");
    expect(within(pending as HTMLElement).getByText("Adding as Viewer…")).toBeVisible();
    // Nobody is named until the server has named them.
    expect(within(dialog()).queryByText("Priya Nair")).toBeNull();

    // The add answers, and the re-read that names the person is still out: the
    // pending row has to stay until that read lands, or the list has a gap
    // where neither row is drawn.
    state.listHeld = true;
    release();
    await waitFor(() => expect(state.listReleases).toHaveLength(1));
    expect(within(dialog()).getByText("Adding as Viewer…")).toBeVisible();

    releaseList();

    expect(await within(dialog()).findByText("Priya Nair")).toBeVisible();
    expect(within(rowOf("Priya Nair")).getByRole("combobox", { name: "Role of Priya Nair" })).toHaveValue("VIEWER");
    await waitFor(() => expect(within(dialog()).queryByText("Adding as Viewer…")).toBeNull());
  });

  it("says an ID is already a member, and does not send it", async () => {
    renderPanel();
    await within(dialog()).findByText("Mark Lee");

    const field = within(dialog()).getByLabelText("Add by user ID");
    fireEvent.change(field, { target: { value: MARK.toUpperCase() } });

    expect(within(dialog()).getByText("Mark Lee is already a member of this project.")).toBeVisible();
    expect(within(dialog()).getByRole("button", { name: "Add" })).toHaveAttribute("aria-disabled", "true");
    fireEvent.submit(field.closest("form") as HTMLFormElement);
    expect(state.adds).toHaveLength(0);
  });

  it("reads a 409 as somebody already on the project, and does not put the ID back to be sent again", async () => {
    state.addFailure = refusal(
      "ALREADY_EXISTS",
      409,
      `User with id: ${PRIYA} already exists in project: ${PROJECT}`,
      "req-409",
    );
    renderPanel();
    await within(dialog()).findByText("Mark Lee");

    const field = within(dialog()).getByLabelText("Add by user ID");
    fireEvent.change(field, { target: { value: PRIYA } });
    fireEvent.click(within(dialog()).getByRole("button", { name: "Add" }));

    expect(await within(dialog()).findByText("This user ID is already a member of this project.")).toBeVisible();
    expect(within(dialog()).getByRole("button", { name: "Copy request id req-409" })).toBeVisible();
    expect(field).toHaveValue("");
    expect(within(dialog()).queryByText(PRIYA)).toBeNull();
  });

  it("draws a member nobody could name as the ID and a sentence, and still lets an admin remove it (TAS-227)", async () => {
    state.members = [...state.members, state.person(NOBODY, "MEMBER")];
    renderPanel();

    const id = await within(dialog()).findByText(NOBODY);
    const row = id.closest("li") as HTMLElement;
    expect(within(row).getByText("Unknown")).toBeVisible();
    expect(within(row).getByText("No account came back for this ID.")).toBeVisible();
    // No invented name anywhere on the row, and no role to hand an account that
    // is not there — only the removal.
    expect(within(row).queryByRole("combobox")).toBeNull();
    expect(within(row).getByLabelText("Unknown")).toHaveClass("avatar-empty");

    fireEvent.click(within(row).getByRole("button", { name: "Remove the member with ID 0b1c2d3e from this project" }));
    fireEvent.click(within(row).getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(within(dialog()).queryByText(NOBODY)).toBeNull());
    expect(state.removals).toEqual([[PROJECT, NOBODY]]);
  });

  it("puts a changed role back and says why when the server refuses it", async () => {
    state.members = state.members.map((member) => (member.userId === MARK ? { ...member, role: "ADMIN" } : member));
    // The list said two admins; the server counted one. A stale list is exactly
    // how the last-admin refusal reaches a dialog that hides the control.
    state.roleFailure = refusal(
      "FAILED_PRECONDITION",
      400,
      `Can't modify last admin: ${MARK} in project: ${PROJECT}`,
      "req-last-admin",
    );
    state.held = true;
    renderPanel();

    const select = await within(dialog()).findByRole("combobox", { name: "Role of Mark Lee" });
    expect(select).toHaveValue("ADMIN");

    fireEvent.change(select, { target: { value: "MEMBER" } });
    // Drawn at once, before any answer.
    await waitFor(() => expect(select).toHaveValue("MEMBER"));
    expect(select).toHaveAttribute("aria-disabled", "true");

    // A second pick while the first is out is not sent.
    fireEvent.change(select, { target: { value: "VIEWER" } });
    expect(state.roleChanges).toEqual([[PROJECT, MARK, "MEMBER"]]);

    // The read that follows the refusal is held, so what puts the role back is
    // the rollback and not a list that happens to say ADMIN.
    state.listHeld = true;
    release();

    expect(
      await within(dialog()).findByText("Mark Lee is this project’s only admin, so the role did not change."),
    ).toBeVisible();
    expect(within(dialog()).getByRole("combobox", { name: "Role of Mark Lee" })).toHaveValue("ADMIN");
    expect(within(dialog()).getByText(`Can't modify last admin: ${MARK} in project: ${PROJECT}`)).toBeVisible();
    expect(within(dialog()).getByRole("button", { name: "Copy request id req-last-admin" })).toBeVisible();
  });

  it("asks before removing, removes at once, and puts the row back with the reason when the server refuses", async () => {
    state.removeFailure = refusal("INTERNAL", 500, "Internal error", "req-500");
    state.held = true;
    renderPanel();

    const toggle = await within(dialog()).findByRole("button", { name: "Remove Sofia Reyes from this project" });
    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const row = rowOf("Sofia Reyes");
    expect(within(row).getByText("Sofia Reyes will lose access to this project.")).toBeVisible();
    // Into the question on the answer that changes nothing.
    expect(within(row).getByRole("button", { name: "Cancel" })).toHaveFocus();
    expect(state.removals).toHaveLength(0);

    fireEvent.click(within(row).getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(within(dialog()).queryByText("Sofia Reyes")).toBeNull());
    expect(state.removals).toEqual([[PROJECT, SOFIA]]);

    // Held for the reason the role case gives: the row has to come back by
    // the rollback, not by a re-read.
    state.listHeld = true;
    release();

    expect(await within(dialog()).findByText("Sofia Reyes was not removed from this project.")).toBeVisible();
    expect(within(dialog()).getByText("Sofia Reyes")).toBeVisible();
    expect(within(dialog()).getByRole("button", { name: "Copy request id req-500" })).toBeVisible();
    // The sentence is the live region; the id under it is not in one.
    expect(within(dialog()).getByRole("button", { name: "Copy request id req-500" }).closest("[aria-live]")).toBeNull();
  });

  it("hands focus to the next row's remove control when the row that had it leaves", async () => {
    renderPanel();

    fireEvent.click(await within(dialog()).findByRole("button", { name: "Remove Mark Lee from this project" }));
    fireEvent.click(within(rowOf("Mark Lee")).getByRole("button", { name: "Remove" }));

    await waitFor(() =>
      expect(within(dialog()).getByRole("button", { name: "Remove Sofia Reyes from this project" })).toHaveFocus(),
    );
  });

  it("offers the last admin neither a role nor a removal, and says so in words", async () => {
    renderPanel();
    await within(dialog()).findByText("Anna Ivanova");

    const row = rowOf("Anna Ivanova");
    expect(within(row).queryByRole("combobox")).toBeNull();
    expect(within(row).queryByRole("button", { name: /Remove/ })).toBeNull();
    expect(within(row).getByText("Admin")).toBeVisible();
    expect(
      within(row).getByText(
        "You are this project’s only admin, so your role cannot change and you cannot be removed until someone else is an admin.",
      ),
    ).toBeVisible();
  });

  it("asks before an admin demotes themselves, then re-reads their role so the controls can leave", async () => {
    state.members = state.members.map((member) => (member.userId === MARK ? { ...member, role: "ADMIN" } : member));
    const { queryClient } = renderPanel();
    queryClient.setQueryData(["membership", PROJECT], { role: "ADMIN", isMember: true, projectExists: true });

    const mine = await within(dialog()).findByRole("combobox", { name: "Your role" });
    fireEvent.change(mine, { target: { value: "MEMBER" } });

    // Asked, not sent — and the select shows the answer being asked about.
    expect(state.roleChanges).toHaveLength(0);
    expect(mine).toHaveValue("MEMBER");
    const row = rowOf("Anna Ivanova");
    expect(
      within(row).getByText("You will stop being an admin of this project, and only another admin can make you one again."),
    ).toBeVisible();

    fireEvent.click(within(row).getByRole("button", { name: "Make me Member" }));

    await waitFor(() => expect(state.roleChanges).toEqual([[PROJECT, ANNA, "MEMBER"]]));
    expect(
      await within(dialog()).findByText("You are now a Member of this project, so only an admin can change its members."),
    ).toBeVisible();
    await waitFor(() => expect(queryClient.getQueryState(["membership", PROJECT])?.isInvalidated).toBe(true));
  });

  it("puts the select back when an admin answers their own question with Cancel", async () => {
    state.members = state.members.map((member) => (member.userId === MARK ? { ...member, role: "ADMIN" } : member));
    renderPanel();

    const mine = await within(dialog()).findByRole("combobox", { name: "Your role" });
    fireEvent.change(mine, { target: { value: "VIEWER" } });
    fireEvent.click(within(rowOf("Anna Ivanova")).getByRole("button", { name: "Cancel" }));

    expect(mine).toHaveValue("ADMIN");
    expect(mine).toHaveFocus();
    expect(state.roleChanges).toHaveLength(0);
  });

  it("takes a reader who removed themselves back to their projects, without the project in the list", async () => {
    state.members = state.members.map((member) => (member.userId === MARK ? { ...member, role: "ADMIN" } : member));
    const { queryClient } = renderPanel();
    const listed = (id: string) => ({ id, projectKey: "X", name: id }) as Project;
    queryClient.setQueryData<Project[]>(["projects"], [listed(PROJECT), listed(OTHER_PROJECT)]);

    fireEvent.click(await within(dialog()).findByRole("button", { name: "Remove yourself from this project" }));
    const row = rowOf("Anna Ivanova");
    expect(within(row).getByText("You will lose access to this project and go back to your projects.")).toBeVisible();
    fireEvent.click(within(row).getByRole("button", { name: "Remove me" }));

    expect(await screen.findByText("Projects page")).toBeVisible();
    expect(state.removals).toEqual([[PROJECT, ANNA]]);
    expect(queryClient.getQueryData<Project[]>(["projects"])?.map((project) => project.id)).toEqual([OTHER_PROJECT]);
  });

  it("cancels an open question on the first Esc and closes the dialog on the second", async () => {
    const { onClose } = renderPanel();

    const toggle = await within(dialog()).findByRole("button", { name: "Remove Mark Lee from this project" });
    fireEvent.click(toggle);
    expect(within(dialog()).getByText("Mark Lee will lose access to this project.")).toBeVisible();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(within(dialog()).queryByText("Mark Lee will lose access to this project.")).toBeNull();
    expect(toggle).toHaveFocus();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("says the members could not be loaded, with the server's words and the request id, instead of an empty list", async () => {
    state.listFailure = refusal("PERMISSION_DENIED", 403, "User has no access to project", "req-read");
    renderPanel();

    expect(await within(dialog()).findByText("This project’s members could not be loaded.")).toBeVisible();
    expect(within(dialog()).getByText("User has no access to project")).toBeVisible();
    expect(within(dialog()).getByRole("button", { name: "Copy request id req-read" })).toBeVisible();
    expect(within(dialog()).queryByText("No members came back for this project.")).toBeNull();
    expect(within(dialog()).queryByRole("list")).toBeNull();
  });
});
