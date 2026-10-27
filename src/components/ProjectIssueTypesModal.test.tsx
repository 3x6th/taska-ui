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
    listProjectWorkflows: vi.fn(),
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
let savedWorkflows: ProjectContext["workflows"];
const contextOf = (issueTypes: ProjectIssueType[]): ProjectContext =>
  ({
    project: { id: PROJECT, projectKey: "TAS", name: "Taska", createdBy: "u", createdAt: "x", updatedAt: "x", archivedAt: null },
    role: "ADMIN",
    members: [],
    labels: [],
    issueTypes,
    workflows: savedWorkflows,
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
      workflows={data?.workflows}
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
  savedWorkflows = {};
  api.getProjectContext.mockImplementation(async () => contextOf(saved));
  // The list New type reads (TAS-437): unanswered unless a case answers it.
  api.listProjectWorkflows.mockImplementation(() => new Promise(() => {}));
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
  it("says any other refusal of the first press in the slot, with the server's words, and focus back on Delete", async () => {
    api.deleteProjectIssueType.mockRejectedValueOnce(refusal("INTERNAL", "Something broke"));
    const dialog = renderDialog();

    const remove = within(dialog).getByRole("button", { name: "Delete Bug" });
    fireEvent.click(remove);
    expect(
      within(dialog).getByText(
        "Bug will be deleted from this project for everyone. If issues have this type, you will choose another type for them first.",
      ),
    ).toBeVisible();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete type" }));

    expect(await within(dialog).findByText("Bug was not deleted.")).toBeVisible();
    expect(within(dialog).getByText("Something broke")).toBeVisible();
    expect(within(dialog).getByText("rid-1")).toBeInTheDocument();
    await waitFor(() => expect(remove).toHaveFocus());
    expect(names(dialog)).toEqual(["Task", "Bug", "Story"]);
    // The first press sends no body (§4.30).
    expect(api.deleteProjectIssueType).toHaveBeenCalledWith(PROJECT, "BUG");
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

/** The workflow list New type reads (TAS-437): the shared default with Task and Bug, an own one with Story, a donor. */
const SHARED_ID = "11111111-1111-1111-1111-111111111111";
const OWN_ID = "22222222-2222-2222-2222-222222222222";
const DONOR_ID = "33333333-3333-3333-3333-333333333333";
const flow = (id: string, name: string, statuses: { statusKey: string; name: string; sortOrder: number }[] = []) => ({
  id,
  name,
  version: 1,
  createdAt: "",
  updatedAt: "",
  statuses: statuses.map((status) => ({ ...status, id: `${id}-${status.statusKey}`, category: "IN_PROGRESS" })),
  transitions: [],
});
const workflowList = () => [
  { workflow: flow(SHARED_ID, "Default workflow"), issueTypes: ["TASK", "BUG"], shared: true },
  { workflow: flow(OWN_ID, "Stories"), issueTypes: ["STORY"], shared: false },
  { workflow: flow(DONOR_ID, "Old flow"), issueTypes: [], shared: false },
];

describe("New type's workflow (TAS-437)", () => {
  const openNew = () => {
    const dialog = renderDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Add type" }));
    return { dialog, form: within(dialog).getByRole("form", { name: "New type" }) };
  };
  const options = (select: HTMLElement) =>
    [...(select as HTMLSelectElement).options].map((option) => [option.text, option.value]);

  it("offers only «Same as {First}» while the list is read, and sends no workflowId then", async () => {
    api.createProjectIssueType.mockImplementation(async (_project: string, input: ProjectIssueType) => ({ ...input, workflowId: SHARED_ID }));
    const { form } = openNew();
    const select = within(form).getByRole("combobox", { name: "Workflow" });
    expect(options(select)).toEqual([["Same as Task", ""]]);
    expect(api.listProjectWorkflows).toHaveBeenCalledWith(PROJECT);

    fireEvent.change(within(form).getByLabelText("Name"), { target: { value: "Spike" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add type" }));
    await waitFor(() => expect(api.createProjectIssueType).toHaveBeenCalledTimes(1));
    expect(api.createProjectIssueType.mock.calls[0][1]).not.toHaveProperty("workflowId");
  });

  it("offers the own workflows, donors included, then the shared one, the main one chosen and named after the first type", async () => {
    api.listProjectWorkflows.mockResolvedValue(workflowList());
    api.createProjectIssueType.mockImplementation(async (_project: string, input: ProjectIssueType) => ({
      ...input,
      workflowId: OWN_ID,
    }));
    const { dialog, form } = openNew();
    const select = within(form).getByRole("combobox", { name: "Workflow" });
    await waitFor(() =>
      expect(options(select)).toEqual([
        ["Stories", OWN_ID],
        ["Old flow", DONOR_ID],
        ["Default workflow (shared, same as Task)", SHARED_ID],
      ]),
    );
    expect(select).toHaveValue(SHARED_ID);

    fireEvent.change(select, { target: { value: OWN_ID } });
    fireEvent.change(within(form).getByLabelText("Name"), { target: { value: "Spike" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add type" }));
    await waitFor(() => expect(api.createProjectIssueType).toHaveBeenCalledTimes(1));
    expect(api.createProjectIssueType.mock.calls[0][1]).toMatchObject({ code: "SPIKE", workflowId: OWN_ID });
    // The answer's workflowId names the workflow; the registry entry goes in without it.
    expect(await within(dialog).findByText("Type Spike added. It uses Stories.")).toHaveAttribute("aria-live", "polite");
    expect(api.createProjectIssueType.mock.calls[0]).toHaveLength(2);
  });

  it("names an own main workflow «(same as {First})», and says when the list could not be read", async () => {
    api.listProjectWorkflows.mockResolvedValue([
      { workflow: flow(OWN_ID, "Delivery"), issueTypes: ["TASK"], shared: false },
      { workflow: flow(SHARED_ID, "Default workflow"), issueTypes: ["BUG", "STORY"], shared: true },
    ]);
    const { form } = openNew();
    const select = within(form).getByRole("combobox", { name: "Workflow" });
    await waitFor(() =>
      expect(options(select)).toEqual([
        ["Delivery (same as Task)", OWN_ID],
        ["Default workflow (shared)", SHARED_ID],
      ]),
    );
    expect(select).toHaveValue(OWN_ID);
  });

  it("offers only the main one, and says why, when the list cannot be read", async () => {
    api.listProjectWorkflows.mockRejectedValue(refusal("UNAVAILABLE", "down"));
    const { form } = openNew();
    const select = within(form).getByRole("combobox", { name: "Workflow" });
    // After the read's one retry.
    expect(
      await within(form).findByText("Other workflows could not be loaded, so only this one is offered.", undefined, { timeout: 4000 }),
    ).toBeVisible();
    expect(options(select)).toEqual([["Same as Task", ""]]);
    expect(select).toHaveAccessibleDescription("Other workflows could not be loaded, so only this one is offered.");
  });

  it("holds a create the server is still applying, frozen, and repeats it with the 503's request id", async () => {
    api.listProjectWorkflows.mockResolvedValue(workflowList());
    api.createProjectIssueType
      .mockRejectedValueOnce(
        Object.assign(refusal("UNAVAILABLE", "Issue type creation is pending", { reason: "ISSUE_TYPE_CREATION_PENDING" }), {
          status: 503,
          requestId: "req-503",
        }),
      )
      .mockImplementationOnce(async (_project: string, input: ProjectIssueType) => ({ ...input, workflowId: SHARED_ID }));
    const { dialog, form } = openNew();
    await waitFor(() => expect(within(form).getByRole("combobox", { name: "Workflow" })).toHaveValue(SHARED_ID));
    fireEvent.change(within(form).getByLabelText("Name"), { target: { value: "Spike" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add type" }));

    const note = await within(form).findByText(
      "The server has not finished this change yet. Press Add type again in a few seconds to finish it; nothing is applied twice.",
    );
    expect(note).toHaveAttribute("role", "status");
    expect(within(form).getByText("req-503")).toBeInTheDocument();
    expect(within(form).queryByText("The type was not added.")).toBeNull();
    expect(within(form).getByLabelText("Name")).toHaveAttribute("readonly");
    fireEvent.change(within(form).getByLabelText("Name"), { target: { value: "Other" } });
    expect(within(form).getByLabelText("Name")).toHaveValue("Spike");

    fireEvent.click(within(form).getByRole("button", { name: "Add type" }));
    await waitFor(() => expect(api.createProjectIssueType).toHaveBeenCalledTimes(2));
    expect(api.createProjectIssueType.mock.calls[1]).toEqual([
      PROJECT,
      api.createProjectIssueType.mock.calls[0][1],
      { requestId: "req-503" },
    ]);
    expect(api.createProjectIssueType.mock.calls[0]).toHaveLength(2);
    expect(await within(dialog).findByText("Type Spike added. It uses Default workflow.")).toBeInTheDocument();
  });
});

describe("deleting a type with issues (TAS-433, TAS-437)", () => {
  const GENERATION = "d6a4f5e7-0000-4000-8000-000000000433";
  const inUse = (count = "3") =>
    refusal("FAILED_PRECONDITION", `Issue type BUG has ${count} issues`, { reason: "ISSUE_TYPE_IN_USE", issueCount: count });
  const openStep = async (count = "3") => {
    saved = seeded().map((entry) => (entry.code === "BUG" ? { ...entry, generation: GENERATION } : entry));
    savedWorkflows = {
      BUG: { ...flow(SHARED_ID, "Default workflow", [{ statusKey: "IN_PROGRESS", name: "Doing", sortOrder: 20 }]) },
      TASK: { ...flow(OWN_ID, "Delivery", [{ statusKey: "TODO", name: "To Do", sortOrder: 10 }, { statusKey: "DONE", name: "Done", sortOrder: 30 }]) },
    } as unknown as ProjectContext["workflows"];
    api.deleteProjectIssueType.mockRejectedValueOnce(inUse(count));
    const dialog = renderDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete Bug" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete type" }));
    const select = await within(dialog).findByRole("combobox", { name: "Move them to" });
    return { dialog, select };
  };

  it("turns ISSUE_TYPE_IN_USE into the move step: the count, the other types, nothing chosen, focus on the select", async () => {
    const { dialog, select } = await openStep();
    await waitFor(() => expect(select).toHaveFocus());
    expect(within(dialog).getByRole("alert")).toHaveTextContent("3 issues have this type. Move them to another type to delete Bug.");
    expect([...(select as HTMLSelectElement).options].map((option) => [option.text, option.disabled])).toEqual([
      ["Choose a type", true],
      ["Task", false],
      ["Story", false],
    ]);
    // A question, not a report: no words, no id, no slot sentence.
    expect(within(dialog).queryByText("Issue type BUG has 3 issues")).toBeNull();
    expect(within(dialog).queryByText("rid-1")).toBeNull();
    const answer = within(dialog).getByRole("button", { name: "Move and delete" });
    expect(answer).toHaveAttribute("aria-disabled", "true");
    expect(api.deleteProjectIssueType).toHaveBeenCalledWith(PROJECT, "BUG");
  });

  it("moves with the target and the entry's generation, then deletes: the issues' caches read again", async () => {
    const { dialog, select } = await openStep("1");
    expect(within(dialog).getByRole("alert")).toHaveTextContent("1 issue has this type. Move it to another type to delete Bug.");
    api.deleteProjectIssueType.mockResolvedValueOnce(undefined);
    const invalidated = vi.spyOn(QueryClient.prototype, "invalidateQueries");
    fireEvent.change(select, { target: { value: "TASK" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Move and delete" }));

    expect(await within(dialog).findByText("Type Bug deleted. Its issues are now Task.")).toHaveAttribute("aria-live", "polite");
    expect(api.deleteProjectIssueType).toHaveBeenLastCalledWith(PROJECT, "BUG", { moveIssuesTo: "TASK", expectedGeneration: GENERATION }, undefined);
    expect(invalidated.mock.calls.map(([filters]) => filters?.queryKey)).toEqual(
      expect.arrayContaining([projectContextKey(PROJECT), ["board", PROJECT], ["project-workflows", PROJECT], ["issue", PROJECT]]),
    );
    invalidated.mockRestore();
  });

  it("sends no generation when the registry carried none", async () => {
    api.deleteProjectIssueType.mockRejectedValueOnce(inUse()).mockResolvedValueOnce(undefined);
    const dialog = renderDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete Bug" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete type" }));
    fireEvent.change(await within(dialog).findByRole("combobox", { name: "Move them to" }), { target: { value: "STORY" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Move and delete" }));
    await waitFor(() => expect(api.deleteProjectIssueType).toHaveBeenCalledTimes(2));
    expect(api.deleteProjectIssueType.mock.calls[1][2]).toEqual({ moveIssuesTo: "STORY" });
  });

  it("adds a select per status the target's workflow lacks, for that target only, and sends the mapping", async () => {
    const { dialog, select } = await openStep();
    api.deleteProjectIssueType.mockRejectedValueOnce(
      refusal("FAILED_PRECONDITION", "Supply mappings", {
        reason: "ISSUE_STATUSES_UNMAPPED",
        statusKeys: "IN_PROGRESS",
        targetStatusKeys: "DONE,TODO",
      }),
    );
    fireEvent.change(select, { target: { value: "TASK" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Move and delete" }));

    const status = await within(dialog).findByRole("combobox", { name: "Move Doing issues to" });
    await waitFor(() => expect(status).toHaveFocus());
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "3 issues have this type. Some are in a status Task issues cannot have, so choose where each status’s issues go.",
    );
    // The target workflow's column order and labels.
    expect([...(status as HTMLSelectElement).options].map((option) => option.text)).toEqual(["Choose a status", "To Do", "Done"]);
    expect(within(dialog).getByRole("button", { name: "Move and delete" })).toHaveAttribute("aria-disabled", "true");

    fireEvent.change(status, { target: { value: "DONE" } });
    api.deleteProjectIssueType.mockResolvedValueOnce(undefined);
    fireEvent.click(within(dialog).getByRole("button", { name: "Move and delete" }));
    await waitFor(() => expect(api.deleteProjectIssueType).toHaveBeenCalledTimes(3));
    expect(api.deleteProjectIssueType.mock.calls[2]).toEqual([
      PROJECT,
      "BUG",
      { moveIssuesTo: "TASK", expectedGeneration: GENERATION, statusMappings: { IN_PROGRESS: "DONE" } },
      undefined,
    ]);
  });

  it("takes the status selects away when another target is chosen", async () => {
    const { dialog, select } = await openStep();
    api.deleteProjectIssueType.mockRejectedValueOnce(
      refusal("FAILED_PRECONDITION", "Supply mappings", { reason: "ISSUE_STATUSES_UNMAPPED", statusKeys: "IN_PROGRESS", targetStatusKeys: "TODO" }),
    );
    fireEvent.change(select, { target: { value: "TASK" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Move and delete" }));
    await within(dialog).findByRole("combobox", { name: "Move Doing issues to" });
    fireEvent.change(select, { target: { value: "STORY" } });
    expect(within(dialog).queryByRole("combobox", { name: "Move Doing issues to" })).toBeNull();
    expect(within(dialog).getByRole("alert")).toHaveTextContent("3 issues have this type. Move them to another type to delete Bug.");
  });

  it("closes on ISSUE_TYPE_CHANGED, reads the registry again and says nothing moved, with the id only", async () => {
    const { dialog, select } = await openStep();
    const reads = api.getProjectContext.mock.calls.length;
    api.deleteProjectIssueType.mockRejectedValueOnce(
      Object.assign(refusal("ABORTED", "Issue type lifecycle changed", { reason: "ISSUE_TYPE_CHANGED", generation: "x" }), { status: 409 }),
    );
    fireEvent.change(select, { target: { value: "TASK" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Move and delete" }));

    expect(
      await within(dialog).findByText(
        "Issue types changed elsewhere, so Bug was not deleted and no issue moved. The list now shows the current types.",
      ),
    ).toBeVisible();
    expect(within(dialog).getByText("rid-1")).toBeInTheDocument();
    expect(within(dialog).queryByText("Issue type lifecycle changed")).toBeNull();
    expect(within(dialog).queryByRole("combobox", { name: "Move them to" })).toBeNull();
    await waitFor(() => expect(api.getProjectContext.mock.calls.length).toBe(reads + 1));
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Delete Bug" })).toHaveFocus());
  });

  it("says a target that left the registry in the strip, reads it again and starts the select over", async () => {
    const { dialog, select } = await openStep();
    api.deleteProjectIssueType.mockRejectedValueOnce(
      refusal("INVALID_ARGUMENT", "Target issue type is not registered in this project", { reason: "ISSUE_TYPE_TARGET_INVALID" }),
    );
    fireEvent.change(select, { target: { value: "STORY" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Move and delete" }));

    expect(await within(dialog).findByText("Story is no longer one of this project’s types. Choose another.")).toBeVisible();
    expect(within(dialog).getByText("Target issue type is not registered in this project")).toBeVisible();
    const fresh = within(dialog).getByRole("combobox", { name: "Move them to" });
    expect(fresh).toHaveValue("");
    await waitFor(() => expect(fresh).toHaveFocus());
  });

  it("ends at the migration limit with one sentence, the words and the id, no answer, focus on Cancel", async () => {
    const { dialog, select } = await openStep();
    api.deleteProjectIssueType.mockRejectedValueOnce(
      refusal("FAILED_PRECONDITION", "Synchronous issue type migration is limited to 5000 issues", {
        reason: "WORKFLOW_MIGRATION_LIMIT",
        limit: "5000",
      }),
    );
    fireEvent.change(select, { target: { value: "TASK" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Move and delete" }));

    expect(
      await within(dialog).findByText(
        "More than 5,000 issues would have to move, and the server moves at most 5,000 at once, so Bug cannot be deleted.",
      ),
    ).toBeVisible();
    expect(within(dialog).getByText("Synchronous issue type migration is limited to 5000 issues")).toBeVisible();
    expect(within(dialog).queryByRole("button", { name: "Move and delete" })).toBeNull();
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus());
  });

  it("says a 403 on the move in the slot, which outlives the strip the role line takes away", async () => {
    const { dialog, select } = await openStep();
    api.deleteProjectIssueType.mockRejectedValueOnce(
      Object.assign(refusal("PERMISSION_DENIED", "Project ADMIN role is required"), { status: 403 }),
    );
    fireEvent.change(select, { target: { value: "TASK" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Move and delete" }));

    expect(await within(dialog).findByText("Bug was not deleted.")).toBeVisible();
    expect(within(dialog).getByText("Project ADMIN role is required")).toBeVisible();
    expect(within(dialog).queryByRole("combobox", { name: "Move them to" })).toBeNull();
  });

  it("holds a delete the server is still applying and repeats the same command with its request id", async () => {
    const { dialog, select } = await openStep();
    api.deleteProjectIssueType
      .mockRejectedValueOnce(
        Object.assign(refusal("UNAVAILABLE", "Issue type deletion is durably pending", { reason: "ISSUE_TYPE_DELETION_PENDING" }), {
          status: 503,
          requestId: "req-del",
        }),
      )
      .mockResolvedValueOnce(undefined);
    fireEvent.change(select, { target: { value: "TASK" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Move and delete" }));

    expect(
      await within(dialog).findByText(
        "The server has not finished this change yet. Press Move and delete again in a few seconds to finish it; nothing is applied twice.",
      ),
    ).toHaveAttribute("role", "status");
    // Frozen: the target stays as sent.
    fireEvent.change(select, { target: { value: "STORY" } });
    expect(select).toHaveValue("TASK");
    fireEvent.click(within(dialog).getByRole("button", { name: "Move and delete" }));
    await waitFor(() => expect(api.deleteProjectIssueType).toHaveBeenCalledTimes(3));
    expect(api.deleteProjectIssueType.mock.calls[2]).toEqual([
      PROJECT,
      "BUG",
      { moveIssuesTo: "TASK", expectedGeneration: GENERATION },
      { requestId: "req-del" },
    ]);
    expect(await within(dialog).findByText("Type Bug deleted. Its issues are now Task.")).toBeInTheDocument();
  });
});
