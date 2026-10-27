import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectContext, ProjectIssueType } from "../domain/types";
import { projectContextKey } from "../lib/projectContext";
import { ProjectIssueTypesModal } from "./ProjectIssueTypesModal";

/**
 * The Issue types dialog's writes (DESIGN.md §4.30, TAS-417, TAS-434) where
 * the end-to-end suite cannot hold a request open, refuse one, or read the
 * exact body: the reorder queue — one PUT per press, in press order,
 * optimistic in the same frame — and what a refusal does to it, the delete
 * refusals by `details.reason`, and what the add and edit forms send for the
 * shape and the icon.
 */

const PROJECT = "2e74e49f-0f29-4e03-b4ec-adc4dbf2382e";

const { api } = vi.hoisted(() => ({
  api: {
    getProjectContext: vi.fn(),
    reorderProjectIssueTypes: vi.fn(),
    deleteProjectIssueType: vi.fn(),
    createProjectIssueType: vi.fn(),
    updateProjectIssueType: vi.fn(),
  },
}));
vi.mock("../api/client", () => ({ taskaApi: api }));

const seeded = (): ProjectIssueType[] => [
  { code: "TASK", name: "Task", color: "blue", shape: "square", icon: null, sortOrder: 10 },
  { code: "BUG", name: "Bug", color: "red", shape: "circle", icon: null, sortOrder: 20 },
  { code: "STORY", name: "Story", color: "green", shape: "square", icon: null, sortOrder: 30 },
];
/** A type drawn by its icon, as WEB's Epic in the mock. */
const epic = (): ProjectIssueType => ({
  code: "EPIC",
  name: "Epic",
  color: "purple",
  shape: "square",
  icon: "layers",
  sortOrder: 40,
});
let saved: ProjectIssueType[];
const contextOf = (issueTypes: ProjectIssueType[]): ProjectContext =>
  ({
    project: { id: PROJECT, projectKey: "TAS", name: "Taska", createdBy: "u", createdAt: "x", updatedAt: "x", archivedAt: null },
    role: "ADMIN",
    members: [],
    labels: [],
    issueTypes,
    workflows: {},
  }) as unknown as ProjectContext;

/** What the board does: reads the context and hands the dialog its registry. */
function Board() {
  const { data } = useQuery({
    queryKey: projectContextKey(PROJECT),
    queryFn: () => api.getProjectContext(PROJECT),
    staleTime: Infinity,
  });
  return (
    <ProjectIssueTypesModal
      archived={false}
      contextError={null}
      issueTypes={data?.issueTypes}
      onClose={() => {}}
      projectId={PROJECT}
      projectKey="TAS"
      readerRole="ADMIN"
    />
  );
}

const renderDialog = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  queryClient.setQueryData(projectContextKey(PROJECT), contextOf(saved));
  render(
    <QueryClientProvider client={queryClient}>
      <Board />
    </QueryClientProvider>,
  );
  return screen.getByRole("dialog", { name: "Issue types" });
};
const names = (dialog: HTMLElement) =>
  [...within(dialog).getByRole("list", { name: "Issue types" }).querySelectorAll(".issue-type-name")].map(
    (node) => node.textContent,
  );
const refusal = (code: string, message: string, details: Record<string, string> | null = null) =>
  Object.assign(new Error(message), { code, status: 400, details, requestId: "rid-1" });

/** A request held open until the test settles it. */
function held<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.resetAllMocks();
  saved = seeded();
  api.getProjectContext.mockImplementation(async () => contextOf(saved));
});

describe("moving a type", () => {
  it("sends one PUT per press with the whole order, one at a time in press order, drawn in the same frame", async () => {
    const first = held<ProjectIssueType[]>();
    const second = held<ProjectIssueType[]>();
    api.reorderProjectIssueTypes.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const dialog = renderDialog();

    fireEvent.click(within(dialog).getByRole("button", { name: "Move Story up" }));
    await waitFor(() => expect(names(dialog)).toEqual(["Task", "Story", "Bug"]));
    expect(api.reorderProjectIssueTypes).toHaveBeenCalledTimes(1);
    expect(api.reorderProjectIssueTypes).toHaveBeenLastCalledWith(PROJECT, ["TASK", "STORY", "BUG"]);

    // A second press while the first is out: drawn at once, sent after it.
    fireEvent.click(within(dialog).getByRole("button", { name: "Move Story up" }));
    await waitFor(() => expect(names(dialog)).toEqual(["Story", "Task", "Bug"]));
    expect(api.reorderProjectIssueTypes).toHaveBeenCalledTimes(1);

    await act(async () => first.resolve(seeded()));
    await waitFor(() => expect(api.reorderProjectIssueTypes).toHaveBeenCalledTimes(2));
    expect(api.reorderProjectIssueTypes).toHaveBeenLastCalledWith(PROJECT, ["STORY", "TASK", "BUG"]);
    // The first answer is not drawn over the second press.
    expect(names(dialog)).toEqual(["Story", "Task", "Bug"]);

    await act(async () =>
      second.resolve([
        { ...seeded()[2], sortOrder: 10 },
        { ...seeded()[0], sortOrder: 20 },
        { ...seeded()[1], sortOrder: 30 },
      ]),
    );
    expect(names(dialog)).toEqual(["Story", "Task", "Bug"]);
    expect(within(dialog).getByText("Story moved to position 1 of 3.")).toBeInTheDocument();
  });

  it("stops the queue on a refusal, reads the context again and says the saved order is back", async () => {
    const first = held<ProjectIssueType[]>();
    api.reorderProjectIssueTypes.mockReturnValueOnce(first.promise);
    const dialog = renderDialog();

    fireEvent.click(within(dialog).getByRole("button", { name: "Move Bug down" }));
    await waitFor(() => expect(names(dialog)).toEqual(["Task", "Story", "Bug"]));
    fireEvent.click(within(dialog).getByRole("button", { name: "Move Bug up" }));
    await waitFor(() => expect(names(dialog)).toEqual(["Task", "Bug", "Story"]));

    // Any refusal but the stale registry's: the general sentence, the
    // server's words and the request id.
    const reads = api.getProjectContext.mock.calls.length;
    await act(async () => first.reject(refusal("INVALID_ARGUMENT", "codes must be a complete permutation without duplicates")));

    expect(
      await within(dialog).findByText("The new order was not saved. The list now shows the saved order."),
    ).toBeVisible();
    expect(within(dialog).getByText("codes must be a complete permutation without duplicates")).toBeVisible();
    expect(within(dialog).getByText("rid-1")).toBeInTheDocument();
    expect(api.getProjectContext.mock.calls.length).toBe(reads + 1);
    // The queued press was never sent, and the list is the server's again.
    expect(api.reorderProjectIssueTypes).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(names(dialog)).toEqual(["Task", "Bug", "Story"]));
  });

  // Backend TAS-429 (§4.30): a type added or deleted elsewhere makes the set
  // stale — 409 `ABORTED`, `details.reason` `ISSUE_TYPES_CHANGED`. Its own
  // sentence, the request id without the server's words, and the current
  // registry read again.
  it("says the types changed elsewhere on ISSUE_TYPES_CHANGED, with the request id, and draws the current types", async () => {
    const first = held<ProjectIssueType[]>();
    api.reorderProjectIssueTypes.mockReturnValueOnce(first.promise);
    const dialog = renderDialog();

    fireEvent.click(within(dialog).getByRole("button", { name: "Move Bug down" }));
    await waitFor(() => expect(names(dialog)).toEqual(["Task", "Story", "Bug"]));

    saved = [...seeded(), epic()];
    const reads = api.getProjectContext.mock.calls.length;
    await act(async () =>
      first.reject(
        Object.assign(new Error("Issue type registry changed; reload the current types before reordering"), {
          code: "ABORTED",
          status: 409,
          details: { reason: "ISSUE_TYPES_CHANGED" },
          requestId: "rid-429",
        }),
      ),
    );

    expect(
      await within(dialog).findByText(
        "Issue types changed elsewhere, so the new order was not saved. The list now shows the current types.",
      ),
    ).toBeVisible();
    expect(within(dialog).getByText("rid-429")).toBeInTheDocument();
    expect(within(dialog).queryByText(/reload the current types/)).toBeNull();
    expect(within(dialog).queryByText("The new order was not saved. The list now shows the saved order.")).toBeNull();
    expect(api.getProjectContext.mock.calls.length).toBe(reads + 1);
    await waitFor(() => expect(names(dialog)).toEqual(["Task", "Bug", "Story", "Epic"]));
  });
});

describe("a refused delete", () => {
  it("names how many issues have the type, in the slot, with the server's words, and focus back on Delete", async () => {
    api.deleteProjectIssueType.mockRejectedValueOnce(
      refusal("FAILED_PRECONDITION", "Issue type BUG has 3 issues", { reason: "ISSUE_TYPE_IN_USE", issueCount: "3" }),
    );
    const dialog = renderDialog();

    const remove = within(dialog).getByRole("button", { name: "Delete Bug" });
    fireEvent.click(remove);
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete type" }));

    expect(
      await within(dialog).findByText("Bug was not deleted: 3 issues have this type. Change their type first."),
    ).toBeVisible();
    expect(within(dialog).getByText("Issue type BUG has 3 issues")).toBeVisible();
    expect(within(dialog).getByText("rid-1")).toBeInTheDocument();
    await waitFor(() => expect(remove).toHaveFocus());
    expect(names(dialog)).toEqual(["Task", "Bug", "Story"]);
  });

  it("reads the context again on LAST_ISSUE_TYPE: Delete was offered from a registry that was stale", async () => {
    api.deleteProjectIssueType.mockRejectedValueOnce(
      refusal("FAILED_PRECONDITION", "Cannot delete the last issue type", { reason: "LAST_ISSUE_TYPE" }),
    );
    const dialog = renderDialog();
    const reads = api.getProjectContext.mock.calls.length;

    fireEvent.click(within(dialog).getByRole("button", { name: "Delete Bug" }));
    saved = [seeded()[1]];
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete type" }));

    expect(await within(dialog).findByText("Bug was not deleted: a project needs at least one issue type.")).toBeVisible();
    await waitFor(() => expect(api.getProjectContext.mock.calls.length).toBe(reads + 1));
    // The lone type now offers no Delete, and says why.
    await waitFor(() => expect(names(dialog)).toEqual(["Bug"]));
    expect(within(dialog).queryByRole("button", { name: "Delete Bug" })).not.toBeInTheDocument();
    expect(within(dialog).getByText("A project needs at least one issue type, so this one cannot be deleted.")).toBeVisible();
  });
});

describe("the add and edit forms' shape and icon (TAS-434)", () => {
  const shapeGroup = (form: HTMLElement) => within(form).getByRole("group", { name: "Shape" });
  const iconGroup = (form: HTMLElement) => within(form).getByRole("group", { name: "Icon" });
  const pressed = (group: HTMLElement) =>
    within(group)
      .getAllByRole("button")
      .filter((button) => button.getAttribute("aria-pressed") === "true")
      .map((button) => button.getAttribute("aria-label"));
  const SHAPE_NOTE = "A type with an icon shows the icon instead of a shape.";

  it("adds a type as a square with no icon by default, sending the shape and no icon key", async () => {
    api.createProjectIssueType.mockImplementation(async (_project: string, input: ProjectIssueType) => ({
      ...input,
      icon: null,
    }));
    const dialog = renderDialog();

    fireEvent.click(within(dialog).getByRole("button", { name: "Add type" }));
    const form = within(dialog).getByRole("form", { name: "New type" });
    // «No icon» is the first icon button, and the chosen one.
    expect(within(iconGroup(form)).getAllByRole("button")[0]).toHaveAccessibleName("No icon");
    expect(pressed(iconGroup(form))).toEqual(["No icon"]);
    expect(pressed(shapeGroup(form))).toEqual(["Square"]);
    expect(within(shapeGroup(form)).getAllByRole("button").map((button) => button.getAttribute("title"))).toEqual([
      "Square",
      "Circle",
      "Diamond",
    ]);
    expect(within(form).queryByText(SHAPE_NOTE)).not.toBeInTheDocument();
    // The live chip in the head is the shape, no glyph.
    expect(form.querySelector(".issue-type-form-head .type-chip")).toHaveClass("is-square");

    fireEvent.change(within(form).getByLabelText("Name"), { target: { value: "Spike" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add type" }));

    await waitFor(() => expect(api.createProjectIssueType).toHaveBeenCalledTimes(1));
    expect(api.createProjectIssueType).toHaveBeenCalledWith(PROJECT, {
      code: "SPIKE",
      name: "Spike",
      color: "amber",
      shape: "square",
      sortOrder: 40,
    });
    expect(api.createProjectIssueType.mock.calls[0][1]).not.toHaveProperty("icon");
  });

  it("keeps the shape steadily unavailable while an icon is chosen, and sends both", async () => {
    api.createProjectIssueType.mockImplementation(async (_project: string, input: ProjectIssueType) => input);
    const dialog = renderDialog();

    fireEvent.click(within(dialog).getByRole("button", { name: "Add type" }));
    const form = within(dialog).getByRole("form", { name: "New type" });
    fireEvent.change(within(form).getByLabelText("Name"), { target: { value: "Spike" } });
    fireEvent.click(within(shapeGroup(form)).getByRole("button", { name: "Diamond" }));
    expect(pressed(shapeGroup(form))).toEqual(["Diamond"]);
    expect(form.querySelector(".issue-type-form-head .type-chip")).toHaveClass("is-diamond");

    fireEvent.click(within(iconGroup(form)).getByRole("button", { name: "Flag" }));
    // The icon replaces the shape in the chip; the Shape group stays, unavailable, and says why.
    expect(form.querySelector(".issue-type-form-head .type-chip")).toHaveClass("is-icon");
    expect(form.querySelector(".issue-type-form-head .type-chip svg")).not.toBeNull();
    const note = within(form).getByText(SHAPE_NOTE);
    for (const button of within(shapeGroup(form)).getAllByRole("button")) {
      expect(button).toHaveAttribute("aria-disabled", "true");
      expect(button).toHaveAttribute("aria-describedby", note.id);
    }
    // A press does nothing; the choice is kept.
    fireEvent.click(within(shapeGroup(form)).getByRole("button", { name: "Circle" }));
    expect(pressed(shapeGroup(form))).toEqual(["Diamond"]);

    fireEvent.click(within(form).getByRole("button", { name: "Add type" }));
    await waitFor(() => expect(api.createProjectIssueType).toHaveBeenCalledTimes(1));
    expect(api.createProjectIssueType).toHaveBeenCalledWith(PROJECT, {
      code: "SPIKE",
      name: "Spike",
      color: "amber",
      shape: "diamond",
      icon: "flag",
      sortOrder: 40,
    });
  });

  it("removes a type's icon with icon: null and nothing else, and the Shape group comes back", async () => {
    saved = [...seeded(), epic()];
    api.updateProjectIssueType.mockImplementation(async () => ({ ...epic(), icon: null }));
    const dialog = renderDialog();

    fireEvent.click(within(dialog).getByRole("button", { name: "Edit Epic" }));
    const form = within(dialog).getByRole("form", { name: "Edit Epic" });
    expect(pressed(iconGroup(form))).toEqual(["Layers"]);
    expect(within(shapeGroup(form)).getByRole("button", { name: "Square" })).toHaveAttribute("aria-disabled", "true");
    const save = within(form).getByRole("button", { name: "Save changes" });
    expect(save).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(within(iconGroup(form)).getByRole("button", { name: "No icon" }));
    expect(within(shapeGroup(form)).getByRole("button", { name: "Square" })).not.toHaveAttribute("aria-disabled");
    expect(within(form).queryByText(SHAPE_NOTE)).not.toBeInTheDocument();
    expect(form.querySelector(".issue-type-form-head .type-chip")).toHaveClass("is-square");
    fireEvent.click(save);

    await waitFor(() => expect(api.updateProjectIssueType).toHaveBeenCalledTimes(1));
    expect(api.updateProjectIssueType).toHaveBeenCalledWith(PROJECT, "EPIC", { icon: null });
    // The answer lands in the row: the shape now, not the glyph.
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Edit Epic" })).toHaveFocus());
    const row = within(dialog).getByRole("button", { name: "Edit Epic" }).closest("li") as HTMLElement;
    expect(row.querySelector(".type-chip")).toHaveClass("is-square");
    expect(row.querySelector(".type-chip svg")).toBeNull();
  });

  it("sends only a changed shape, and nothing while nothing changed", async () => {
    api.updateProjectIssueType.mockImplementation(async () => ({ ...seeded()[1], shape: "diamond" }));
    const dialog = renderDialog();

    fireEvent.click(within(dialog).getByRole("button", { name: "Edit Bug" }));
    const form = within(dialog).getByRole("form", { name: "Edit Bug" });
    expect(pressed(shapeGroup(form))).toEqual(["Circle"]);
    expect(pressed(iconGroup(form))).toEqual(["No icon"]);
    const save = within(form).getByRole("button", { name: "Save changes" });
    // «No icon» pressed again on a type that has none is no change.
    fireEvent.click(within(iconGroup(form)).getByRole("button", { name: "No icon" }));
    expect(save).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(save);
    expect(api.updateProjectIssueType).not.toHaveBeenCalled();

    fireEvent.click(within(shapeGroup(form)).getByRole("button", { name: "Diamond" }));
    expect(save).not.toHaveAttribute("aria-disabled");
    fireEvent.click(save);

    await waitFor(() => expect(api.updateProjectIssueType).toHaveBeenCalledTimes(1));
    expect(api.updateProjectIssueType).toHaveBeenCalledWith(PROJECT, "BUG", { shape: "diamond" });
  });

  it("does not send back a saved shape this build cannot draw, and shows it as the square it is drawn as", async () => {
    saved = [{ ...seeded()[0], shape: null }, ...seeded().slice(1)];
    api.updateProjectIssueType.mockImplementation(async () => ({ ...seeded()[0], name: "Chore", shape: null }));
    const dialog = renderDialog();

    fireEvent.click(within(dialog).getByRole("button", { name: "Edit Task" }));
    const form = within(dialog).getByRole("form", { name: "Edit Task" });
    expect(pressed(shapeGroup(form))).toEqual(["Square"]);
    fireEvent.change(within(form).getByLabelText("Name"), { target: { value: "Chore" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(api.updateProjectIssueType).toHaveBeenCalledTimes(1));
    expect(api.updateProjectIssueType).toHaveBeenCalledWith(PROJECT, "TASK", { name: "Chore" });
  });
});
