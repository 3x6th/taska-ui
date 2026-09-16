import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    /** Who `GET /users/me` says is reading, for the cases where the dialog opened before it answered. */
    me: { id: "6d774efa-57d8-4ae0-a27e-2984d1dfbbf6" } as { id: string },
    meFailure: undefined as Error | undefined,
    meReads: 0,
    adds: [] as [string, string, ProjectRole][],
    roleChanges: [] as [string, string, ProjectRole][],
    removals: [] as [string, string][],
  };

  const hold = async () => {
    if (!state.held) return;
    await new Promise<void>((resolve) => state.releases.push(resolve));
  };

  const api = {
    getCurrentUser: async () => {
      state.meReads += 1;
      if (state.meFailure) throw state.meFailure;
      return { ...state.me, login: "reader", email: "reader@example.com", displayName: "Reader", status: "ACTIVE" };
    },
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
    state.me = { id: "6d774efa-57d8-4ae0-a27e-2984d1dfbbf6" };
    state.meFailure = undefined;
    state.meReads = 0;
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

/**
 * `currentUserId` is Anna and `readerRole` is ADMIN unless a case passes the
 * key: passing either as `undefined` is a read that has not answered yet —
 * `GET /users/me` for the first, the board's membership read for the second —
 * which is a state of its own and not a default.
 */
type PanelProps = { readerRole?: ProjectRole | null; currentUserId?: string };

function renderPanel(props: PanelProps = {}) {
  const queryClient = new QueryClient({
    // `retryDelay` rather than `retry`: the dialog states its own retry rule on
    // the member read, which a default here would not reach.
    defaultOptions: { queries: { retry: false, retryDelay: 1 }, mutations: { retry: false } },
  });
  const onClose = vi.fn();
  // A rerender passes the same tree with other props, so React keeps the router
  // and the dialog mounted and only the props change — which is what a role the
  // board re-read does to the dialog it is showing.
  const panel = (next: PanelProps) => (
    <ProjectMembersModal
      currentUserId={"currentUserId" in next ? next.currentUserId : ANNA}
      onClose={onClose}
      projectId={PROJECT}
      projectKey="TAS"
      readerRole={"readerRole" in next ? next.readerRole : "ADMIN"}
    />
  );
  const tree = (next: PanelProps) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/projects/${PROJECT}/board`]}>
        <Routes>
          <Route element={panel(next)} path="/projects/:projectId/board" />
          <Route element={<p>Projects page</p>} path="/projects" />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const { rerender } = render(tree(props));
  return { queryClient, onClose, rerender: (next: PanelProps) => rerender(tree(next)) };
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
    renderPanel({ readerRole: "MEMBER", currentUserId: MARK });

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

  it("shows a VIEWER the list and no control, for the same reason it gives a MEMBER", async () => {
    state.members = state.members.map((member) => (member.userId === SOFIA ? { ...member, role: "VIEWER" } : member));
    renderPanel({ readerRole: "VIEWER", currentUserId: SOFIA });

    expect(await within(dialog()).findByText("Anna Ivanova")).toBeVisible();
    expect(within(rowOf("Sofia Reyes")).getByText("Viewer")).toBeVisible();
    expect(within(dialog()).getByText("Only a project admin can add, change or remove members.")).toBeVisible();
    expect(within(dialog()).queryByRole("textbox")).toBeNull();
    expect(within(dialog()).queryByRole("combobox")).toBeNull();
    expect(within(dialog()).queryByRole("button", { name: /^Remove/ })).toBeNull();
  });

  // TAS-226: a role the server did not state — a read that failed, or one that
  // answered with no role this build knows — is not a MEMBER or a VIEWER, and
  // the admin rule is not the reason the dialog may give. The board says why in
  // a banner, which this dialog's scrim covers.
  it("shows a reader whose role is unknown the list, no control, and that the role is the unknown part", async () => {
    renderPanel({ readerRole: null });

    expect(await within(dialog()).findByText("Mark Lee")).toBeVisible();
    expect(
      within(dialog()).getByText("Your role on this project is unknown, so members cannot be changed here."),
    ).toBeVisible();
    expect(within(dialog()).queryByText("Only a project admin can add, change or remove members.")).toBeNull();
    expect(within(dialog()).queryByRole("textbox")).toBeNull();
    expect(within(dialog()).queryByRole("combobox")).toBeNull();
    expect(within(dialog()).queryByRole("button", { name: /^Remove/ })).toBeNull();
  });

  it("offers nothing and explains nothing while the role is still being read", async () => {
    renderPanel({ readerRole: undefined });

    expect(await within(dialog()).findByText("Mark Lee")).toBeVisible();
    expect(within(dialog()).queryByRole("textbox")).toBeNull();
    expect(within(dialog()).queryByRole("button", { name: /^Remove/ })).toBeNull();
    expect(within(dialog()).queryByText(/Only a project admin/)).toBeNull();
    expect(within(dialog()).queryByText(/Your role on this project is unknown/)).toBeNull();
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
    // An empty place where the button would be, so the role text lines up with
    // the selects in the rows below it; hidden from the accessibility tree.
    expect(row.querySelector(".member-remove-slot")).toHaveAttribute("aria-hidden", "true");
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

    fireEvent.click(within(row).getByRole("button", { name: "Change to Member" }));

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

  /**
   * The last-admin guard, counted the way that keeps a project manageable
   * rather than the way the server counts. project-service counts every ADMIN
   * row, so an admin whose id no account came back for (TAS-227) would let the
   * only real admin step down and leave nobody who can sign in and manage the
   * project.
   */
  describe("an admin row with no account beside the only real admin", () => {
    const realAdminAndUnknownAdmins = (unknownAdmins: string[]) => [
      state.person(ANNA, "ADMIN"),
      ...unknownAdmins.map((id) => state.person(id, "ADMIN")),
      state.person(MARK, "MEMBER"),
    ];

    it("offers the real admin neither a demotion nor a removal, and still lets the row with no account be removed", async () => {
      state.members = realAdminAndUnknownAdmins([NOBODY]);
      renderPanel();

      await within(dialog()).findByText("Anna Ivanova");
      const anna = rowOf("Anna Ivanova");
      expect(within(anna).queryByRole("combobox")).toBeNull();
      expect(within(anna).queryByRole("button", { name: /Remove/ })).toBeNull();
      expect(
        within(anna).getByText(
          "You are this project’s only admin with an account — the other admin is an ID no account came back for — so your role cannot change and you cannot be removed until someone with an account is an admin.",
        ),
      ).toBeVisible();

      // The row with no account keeps the server's count, which is two.
      const unknown = within(dialog()).getByText(NOBODY).closest("li") as HTMLElement;
      fireEvent.click(within(unknown).getByRole("button", { name: "Remove the member with ID 0b1c2d3e from this project" }));
      fireEvent.click(within(unknown).getByRole("button", { name: "Remove" }));

      await waitFor(() => expect(state.removals).toEqual([[PROJECT, NOBODY]]));
      // With it gone Anna is the only admin by either count, and the note says
      // the plain thing again.
      expect(
        await within(rowOf("Anna Ivanova")).findByText(
          "You are this project’s only admin, so your role cannot change and you cannot be removed until someone else is an admin.",
        ),
      ).toBeVisible();
    });

    it("says so for more than one admin row with no account", async () => {
      state.members = realAdminAndUnknownAdmins([NOBODY, "7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d"]);
      renderPanel();

      expect(
        await within(dialog()).findByText(/— the other admins are IDs no account came back for —/),
      ).toBeVisible();
    });
  });

  describe("an open question whose row stops offering it", () => {
    const twoRealAdmins = () =>
      state.members.map((member) => (member.userId === MARK ? { ...member, role: "ADMIN" as const } : member));
    const markDemoted = () =>
      state.members.map((member) => (member.userId === MARK ? { ...member, role: "MEMBER" as const } : member));

    it("closes when the list moves under it, sends nothing, and says why", async () => {
      state.members = twoRealAdmins();
      const { queryClient } = renderPanel();

      fireEvent.click(await within(dialog()).findByRole("button", { name: "Remove yourself from this project" }));
      expect(within(dialog()).getByRole("button", { name: "Remove me" })).toBeVisible();

      // A refetch, or another write, lands: Mark is not an admin any more, so
      // Anna is the only one and the removal the strip offers is forbidden.
      act(() => {
        queryClient.setQueryData<ProjectMember[]>(["members", PROJECT], markDemoted());
      });

      await waitFor(() => expect(within(dialog()).queryByRole("button", { name: "Remove me" })).toBeNull());
      expect(within(dialog()).queryByRole("button", { name: "Remove yourself from this project" })).toBeNull();
      expect(within(dialog()).getByText(/You are this project’s only admin, so/)).toBeVisible();
      expect(within(dialog()).getByText("The member list changed before you confirmed, so nothing was sent.")).toBeVisible();
      // The strip took focus with it; it is caught on the heading, not left on <body>.
      expect(within(dialog()).getByRole("heading", { name: /Current members/ })).toHaveFocus();
      expect(state.removals).toHaveLength(0);
    });

    it("refuses a press that lands after the list moved but before the strip was redrawn", async () => {
      state.members = twoRealAdmins();
      const { queryClient } = renderPanel();

      fireEvent.click(await within(dialog()).findByRole("button", { name: "Remove yourself from this project" }));
      const removeMe = within(dialog()).getByRole("button", { name: "Remove me" });

      // The cache moves and the press follows in the same tick, before
      // react-query has told the dialog: the handler still belongs to the render
      // that drew the strip.
      queryClient.setQueryData<ProjectMember[]>(["members", PROJECT], markDemoted());
      fireEvent.click(removeMe);

      expect(within(dialog()).getByText("The member list changed before you confirmed, so nothing was sent.")).toBeVisible();
      await waitFor(() => expect(within(dialog()).queryByRole("button", { name: "Remove me" })).toBeNull());
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(state.removals).toHaveLength(0);
    });

    it("closes a self-demotion the same way once the reader is the only admin", async () => {
      state.members = twoRealAdmins();
      const { queryClient } = renderPanel();

      fireEvent.change(await within(dialog()).findByRole("combobox", { name: "Your role" }), {
        target: { value: "VIEWER" },
      });
      expect(within(dialog()).getByRole("button", { name: "Change to Viewer" })).toBeVisible();

      act(() => {
        queryClient.setQueryData<ProjectMember[]>(["members", PROJECT], markDemoted());
      });

      await waitFor(() => expect(within(dialog()).queryByRole("button", { name: "Change to Viewer" })).toBeNull());
      expect(within(dialog()).queryByRole("combobox", { name: "Your role" })).toBeNull();
      expect(state.roleChanges).toHaveLength(0);
    });
  });

  it("closes an open question when the reader's own role stops being admin, and says that was the reason", async () => {
    const { rerender } = renderPanel();

    fireEvent.click(await within(dialog()).findByRole("button", { name: "Remove Mark Lee from this project" }));
    expect(within(dialog()).getByText("Mark Lee will lose access to this project.")).toBeVisible();

    // The board re-read the role — a 403 on some other write, or a change made
    // elsewhere — and it is not ADMIN any more.
    rerender({ readerRole: "MEMBER" });

    await waitFor(() => expect(within(dialog()).queryByText("Mark Lee will lose access to this project.")).toBeNull());
    expect(
      within(dialog()).getByText("Your role on this project changed before you confirmed, so nothing was sent."),
    ).toBeVisible();
    expect(within(dialog()).getByRole("heading", { name: /Current members/ })).toHaveFocus();
    expect(state.removals).toHaveLength(0);
  });

  it("drops every cached read of the board a reader removed themselves from, and keeps other projects' reads", async () => {
    state.members = state.members.map((member) => (member.userId === MARK ? { ...member, role: "ADMIN" } : member));
    const { queryClient } = renderPanel();
    // What the board had cached: re-entered from history or a link within the
    // cache's lifetime, these would draw the board as ADMIN with controls whose
    // every write is a 403.
    queryClient.setQueryData(["project", PROJECT], { id: PROJECT });
    queryClient.setQueryData(["membership", PROJECT], { role: "ADMIN", isMember: true, projectExists: true });
    queryClient.setQueryData(["issues", PROJECT, "ALL"], { items: [], page: 0, pageSize: 100, totalCount: 0 });
    queryClient.setQueryData(["project-summaries", PROJECT], { count: 0, members: [], failure: null });
    queryClient.setQueryData(["project", OTHER_PROJECT], { id: OTHER_PROJECT });
    queryClient.setQueryData(["issue-search", "all-projects", "login"], { items: [], totalCount: 0 });

    fireEvent.click(await within(dialog()).findByRole("button", { name: "Remove yourself from this project" }));
    fireEvent.click(within(rowOf("Anna Ivanova")).getByRole("button", { name: "Remove me" }));

    expect(await screen.findByText("Projects page")).toBeVisible();
    for (const key of [
      ["project", PROJECT],
      ["membership", PROJECT],
      ["members", PROJECT],
      ["issues", PROJECT, "ALL"],
      ["project-summaries", PROJECT],
    ]) {
      expect(queryClient.getQueryState(key), JSON.stringify(key)).toBeUndefined();
    }
    expect(queryClient.getQueryData(["project", OTHER_PROJECT])).toEqual({ id: OTHER_PROJECT });
    expect(queryClient.getQueryData(["issue-search", "all-projects", "login"])).toBeDefined();
  });

  describe("before GET /users/me has answered", () => {
    const twoRealAdmins = () =>
      state.members.map((member) => (member.userId === MARK ? { ...member, role: "ADMIN" as const } : member));

    it("asks before any admin is demoted, in words that do not assume who is reading", async () => {
      state.members = twoRealAdmins();
      renderPanel({ currentUserId: undefined });

      fireEvent.change(await within(dialog()).findByRole("combobox", { name: "Role of Mark Lee" }), {
        target: { value: "MEMBER" },
      });

      const row = rowOf("Mark Lee");
      expect(
        within(row).getByText(
          "Mark Lee will stop being an admin of this project. If that is you, only another admin can make you one again.",
        ),
      ).toBeVisible();
      expect(state.roleChanges).toHaveLength(0);

      fireEvent.click(within(row).getByRole("button", { name: "Change to Member" }));
      await waitFor(() => expect(state.roleChanges).toEqual([[PROJECT, MARK, "MEMBER"]]));

      // A role change that is not a demotion from ADMIN cannot take the reader's
      // own admin away, so it does not ask.
      fireEvent.change(within(dialog()).getByRole("combobox", { name: "Role of Sofia Reyes" }), {
        target: { value: "VIEWER" },
      });
      await waitFor(() => expect(state.roleChanges).toContainEqual([PROJECT, SOFIA, "VIEWER"]));
    });

    it("finds out who was removed and takes a reader who removed themselves back to their projects", async () => {
      state.members = twoRealAdmins();
      const { queryClient } = renderPanel({ currentUserId: undefined });
      queryClient.setQueryData(["membership", PROJECT], { role: "ADMIN", isMember: true, projectExists: true });

      fireEvent.click(await within(dialog()).findByRole("button", { name: "Remove Anna Ivanova from this project" }));
      const row = rowOf("Anna Ivanova");
      expect(
        within(row).getByText("Anna Ivanova will lose access to this project. If that is you, you will go back to your projects."),
      ).toBeVisible();
      fireEvent.click(within(row).getByRole("button", { name: "Remove" }));

      expect(await screen.findByText("Projects page")).toBeVisible();
      expect(state.meReads).toBe(1);
      expect(queryClient.getQueryState(["membership", PROJECT])).toBeUndefined();
    });

    it("stays on the board when the reader turns out to have removed somebody else", async () => {
      state.members = twoRealAdmins();
      renderPanel({ currentUserId: undefined });

      fireEvent.click(await within(dialog()).findByRole("button", { name: "Remove Mark Lee from this project" }));
      fireEvent.click(within(rowOf("Mark Lee")).getByRole("button", { name: "Remove" }));

      await waitFor(() => expect(state.meReads).toBe(1));
      await waitFor(() => expect(within(dialog()).queryByText("Mark Lee")).toBeNull());
      expect(screen.queryByText("Projects page")).toBeNull();
      expect(dialog()).toBeVisible();
    });

    it("falls back to the board's own no-access state when the profile cannot be read either", async () => {
      state.members = twoRealAdmins();
      state.meFailure = refusal("UNAVAILABLE", 503, "Service unavailable", "req-me");
      const { queryClient } = renderPanel({ currentUserId: undefined });
      queryClient.setQueryData(["project", PROJECT], { id: PROJECT });
      queryClient.setQueryData(["membership", PROJECT], { role: "ADMIN", isMember: true, projectExists: true });

      fireEvent.click(await within(dialog()).findByRole("button", { name: "Remove Anna Ivanova from this project" }));
      fireEvent.click(within(rowOf("Anna Ivanova")).getByRole("button", { name: "Remove" }));

      // Reset, not removed and not merely invalidated: the entries are still
      // there with no data, so the board's next read answers from nothing and a
      // 403 reaches its no-access state instead of hiding under a kept answer.
      await waitFor(() => expect(queryClient.getQueryState(["membership", PROJECT])?.data).toBeUndefined());
      expect(queryClient.getQueryState(["membership", PROJECT])).toBeDefined();
      expect(queryClient.getQueryState(["project", PROJECT])?.data).toBeUndefined();
      expect(screen.queryByText("Projects page")).toBeNull();
    });
  });
  /**
   * Every refusal a write can meet on these routes, in the dialog's words, with
   * the server's own under them and the request id beside those. The sentences
   * are pinned because each says what did *not* happen after an optimistic
   * change, and a 403 is also the moment the reader's role is read again.
   */
  describe("refusals", () => {
    const REFUSED = "The server refused: only a project admin can change members, and your role on this project may have changed.";
    const membershipReRead = (queryClient: QueryClient) =>
      waitFor(() => expect(queryClient.getQueryState(["membership", PROJECT])?.isInvalidated).toBe(true));

    it.each([
      [
        "an add",
        () => {
          state.addFailure = refusal("PERMISSION_DENIED", 403, `Actor ${ANNA} is not an admin of project: ${PROJECT}`, "req-403");
        },
        () => {
          fireEvent.change(within(dialog()).getByLabelText("Add by user ID"), { target: { value: PRIYA } });
          fireEvent.click(within(dialog()).getByRole("button", { name: "Add" }));
        },
      ],
      [
        "a role change",
        () => {
          state.roleFailure = refusal("PERMISSION_DENIED", 403, `User with id: ${ANNA} is not an admin of project: ${PROJECT}`, "req-403");
        },
        () => {
          fireEvent.change(within(dialog()).getByRole("combobox", { name: "Role of Mark Lee" }), { target: { value: "VIEWER" } });
        },
      ],
      [
        "a removal",
        () => {
          state.removeFailure = refusal("PERMISSION_DENIED", 403, `User with id: ${ANNA} is not an admin of project: ${PROJECT}`, "req-403");
        },
        () => {
          fireEvent.click(within(dialog()).getByRole("button", { name: "Remove Mark Lee from this project" }));
          fireEvent.click(within(rowOf("Mark Lee")).getByRole("button", { name: "Remove" }));
        },
      ],
    ])("a 403 on %s says the server refused, keeps its words and request id, and re-reads the role", async (_case, arrange, act403) => {
      arrange();
      const { queryClient } = renderPanel();
      queryClient.setQueryData(["membership", PROJECT], { role: "ADMIN", isMember: true, projectExists: true });
      await within(dialog()).findByText("Mark Lee");

      act403();

      expect(await within(dialog()).findByText(REFUSED)).toBeVisible();
      expect(within(dialog()).getByText(/is not an admin of project:/)).toBeVisible();
      expect(within(dialog()).getByRole("button", { name: "Copy request id req-403" })).toBeVisible();
      expect(within(dialog()).getByText(REFUSED).closest(".member-note")).toHaveClass("is-error");
      await membershipReRead(queryClient);
      // Whatever was drawn before the answer is back where it was.
      expect(within(rowOf("Mark Lee")).getByText("mark@example.com")).toBeVisible();
    });

    it("a 404 on an add says the project could not be found, with the server's words and request id", async () => {
      state.addFailure = refusal("NOT_FOUND", 404, `Project: ${PROJECT} doesn't exist`, "req-404-add");
      renderPanel();
      await within(dialog()).findByText("Mark Lee");

      fireEvent.change(within(dialog()).getByLabelText("Add by user ID"), { target: { value: PRIYA } });
      fireEvent.click(within(dialog()).getByRole("button", { name: "Add" }));

      expect(await within(dialog()).findByText("This project could not be found, so nobody was added.")).toBeVisible();
      expect(within(dialog()).getByText(`Project: ${PROJECT} doesn't exist`)).toBeVisible();
      expect(within(dialog()).getByRole("button", { name: "Copy request id req-404-add" })).toBeVisible();
    });

    it("a 404 on a role change says the member is not on the project any more", async () => {
      state.roleFailure = refusal(
        "NOT_FOUND",
        404,
        `Project member with id ${MARK} was not found in project with id ${PROJECT}`,
        "req-404-role",
      );
      renderPanel();

      fireEvent.change(await within(dialog()).findByRole("combobox", { name: "Role of Mark Lee" }), {
        target: { value: "VIEWER" },
      });

      expect(
        await within(dialog()).findByText("Mark Lee is not a member of this project any more, so nothing changed."),
      ).toBeVisible();
      expect(within(dialog()).getByText(/was not found in project with id/)).toBeVisible();
      expect(within(dialog()).getByRole("button", { name: "Copy request id req-404-role" })).toBeVisible();
    });

    it("a 404 on a removal is information, not a failure: the row stays gone, and the server's words stay", async () => {
      state.removeFailure = refusal(
        "NOT_FOUND",
        404,
        `Project member with id ${MARK} was not found in project with id ${PROJECT}`,
        "req-404-remove",
      );
      renderPanel();

      fireEvent.click(await within(dialog()).findByRole("button", { name: "Remove Mark Lee from this project" }));
      // Held, so what keeps the row gone is the dialog, not a re-read.
      state.listHeld = true;
      fireEvent.click(within(rowOf("Mark Lee")).getByRole("button", { name: "Remove" }));

      const sentence = await within(dialog()).findByText(
        "Mark Lee is not a member of this project any more, so nothing changed.",
      );
      expect(sentence.closest(".member-note")).not.toHaveClass("is-error");
      expect(within(dialog()).getByText(/was not found in project with id/)).toBeVisible();
      expect(within(dialog()).getByRole("button", { name: "Copy request id req-404-remove" })).toBeVisible();
      expect(within(dialog()).queryByText("mark@example.com")).toBeNull();
    });

    it("a 404 on removing your own row means somebody removed you first, and takes you to your projects", async () => {
      state.members = state.members.map((member) => (member.userId === MARK ? { ...member, role: "ADMIN" } : member));
      state.removeFailure = refusal(
        "NOT_FOUND",
        404,
        `Project member with id ${ANNA} was not found in project with id ${PROJECT}`,
        "req-404-self",
      );
      const { queryClient } = renderPanel();
      queryClient.setQueryData(["membership", PROJECT], { role: "ADMIN", isMember: true, projectExists: true });

      fireEvent.click(await within(dialog()).findByRole("button", { name: "Remove yourself from this project" }));
      fireEvent.click(within(rowOf("Anna Ivanova")).getByRole("button", { name: "Remove me" }));

      expect(await screen.findByText("Projects page")).toBeVisible();
      expect(queryClient.getQueryState(["membership", PROJECT])).toBeUndefined();
    });

    it("a FAILED_PRECONDITION on a removal puts the row back and names the last-admin reason", async () => {
      state.members = state.members.map((member) => (member.userId === MARK ? { ...member, role: "ADMIN" } : member));
      state.removeFailure = refusal(
        "FAILED_PRECONDITION",
        400,
        `Can't modify last admin: ${MARK} in project: ${PROJECT}`,
        "req-last-admin-remove",
      );
      renderPanel();

      fireEvent.click(await within(dialog()).findByRole("button", { name: "Remove Mark Lee from this project" }));
      state.listHeld = true;
      fireEvent.click(within(rowOf("Mark Lee")).getByRole("button", { name: "Remove" }));

      expect(
        await within(dialog()).findByText("Mark Lee is this project’s only admin, so they were not removed."),
      ).toBeVisible();
      expect(within(dialog()).getByText(`Can't modify last admin: ${MARK} in project: ${PROJECT}`)).toBeVisible();
      expect(within(dialog()).getByRole("button", { name: "Copy request id req-last-admin-remove" })).toBeVisible();
      // Put back by the rollback, with the re-read held.
      expect(within(rowOf("Mark Lee")).getByText("mark@example.com")).toBeVisible();
    });

    it("brings the notice into view when it appears, without a scroll behaviour to animate", async () => {
      const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
      state.removeFailure = refusal("INTERNAL", 500, "Internal error", "req-500-scroll");
      renderPanel();

      fireEvent.click(await within(dialog()).findByRole("button", { name: "Remove Sofia Reyes from this project" }));
      fireEvent.click(within(rowOf("Sofia Reyes")).getByRole("button", { name: "Remove" }));
      await within(dialog()).findByText("Sofia Reyes was not removed from this project.");

      await waitFor(() => {
        const index = scrolled.mock.contexts.findIndex(
          (element) => element instanceof Element && element.classList.contains("member-note"),
        );
        expect(index).toBeGreaterThanOrEqual(0);
        expect(scrolled.mock.calls[index]).toEqual([{ block: "nearest" }]);
      });
      scrolled.mockRestore();
    });
  });

  it("does not count a promotion still in flight as cover for the only real admin", async () => {
    // The reviewer's case: beside an admin with no account, a promotion drawn
    // at once used to unfreeze Anna, and her own removal could reach the server
    // before — or instead of — the promotion.
    state.members = [state.person(ANNA, "ADMIN"), state.person(NOBODY, "ADMIN"), state.person(MARK, "MEMBER")];
    state.held = true;
    renderPanel();

    fireEvent.change(await within(dialog()).findByRole("combobox", { name: "Role of Mark Lee" }), {
      target: { value: "ADMIN" },
    });
    await waitFor(() => expect(within(dialog()).getByRole("combobox", { name: "Role of Mark Lee" })).toHaveValue("ADMIN"));

    // Drawn as an admin, and still no cover while the write is out.
    const anna = rowOf("Anna Ivanova");
    expect(within(anna).queryByRole("button", { name: "Remove yourself from this project" })).toBeNull();
    expect(within(anna).queryByRole("combobox", { name: "Your role" })).toBeNull();
    expect(within(anna).getByText(/You are this project’s only admin with an account/)).toBeVisible();

    release();

    // Landed: Mark is an admin with an account, and Anna may step down.
    expect(await within(rowOf("Anna Ivanova")).findByRole("button", { name: "Remove yourself from this project" })).toBeVisible();
    expect(within(rowOf("Anna Ivanova")).getByRole("combobox", { name: "Your role" })).toBeVisible();
  });

  it("does not count a demotion still in flight as cover either", async () => {
    // Why the rule is "an admin before the write and after it", not "the role
    // before the write": counted at its old role, Mark's demotion would still
    // cover Anna until it landed — beside an admin with no account, the same
    // project nobody can manage.
    state.members = [state.person(ANNA, "ADMIN"), state.person(MARK, "ADMIN"), state.person(NOBODY, "ADMIN")];
    state.held = true;
    renderPanel();

    await within(dialog()).findByText("Anna Ivanova");
    expect(within(rowOf("Anna Ivanova")).getByRole("button", { name: "Remove yourself from this project" })).toBeVisible();

    fireEvent.change(within(dialog()).getByRole("combobox", { name: "Role of Mark Lee" }), {
      target: { value: "MEMBER" },
    });

    await waitFor(() =>
      expect(within(rowOf("Anna Ivanova")).queryByRole("button", { name: "Remove yourself from this project" })).toBeNull(),
    );
    expect(within(rowOf("Anna Ivanova")).getByText(/You are this project’s only admin with an account/)).toBeVisible();
  });

  it("counts the reader's own row as an account even when the member read named nobody on it", async () => {
    // A real account with a blank display name arrives with no `user`. As the
    // only real admin beside an admin with no account, it has to stay frozen.
    state.members = [
      { userId: ANNA, role: "ADMIN" as const, user: undefined },
      state.person(NOBODY, "ADMIN"),
      state.person(MARK, "MEMBER"),
    ];
    renderPanel();

    const anna = (await within(dialog()).findByText(ANNA)).closest("li") as HTMLElement;
    expect(within(anna).getByText("You")).toBeVisible();
    expect(within(anna).queryByText("No account came back for this ID.")).toBeNull();
    expect(within(anna).queryByRole("button", { name: /Remove/ })).toBeNull();
    expect(within(anna).queryByRole("combobox")).toBeNull();
    expect(within(anna).getByText(/You are this project’s only admin with an account/)).toBeVisible();

    // The row that really has no account is still the removable one.
    const unknown = within(dialog()).getByText(NOBODY).closest("li") as HTMLElement;
    expect(within(unknown).getByText("No account came back for this ID.")).toBeVisible();
    expect(within(unknown).getByRole("button", { name: "Remove the member with ID 0b1c2d3e from this project" })).toBeVisible();
  });

});
