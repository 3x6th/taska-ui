import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskaApi } from "../api/TaskaApi";
import type { ProjectRole, ProjectWorkflowEntry, WorkflowDefinition } from "../domain/types";
import { ProjectWorkflowsModal } from "./ProjectWorkflowsModal";

/**
 * The Workflows dialog (TAS-382, DESIGN.md §4.28). What is pinned is what the
 * dialog does with an answer — every state, the role gating, the three forms'
 * defaults and bodies, the in-flight window, a refusal, and a 201 whose re-read
 * fails. What the server answers lives in the mock and rest tests; the
 * gateway's static-resource 404, which the mock cannot produce, is stubbed
 * here as the work log's tests stub it.
 */
const PROJECT = "p-382";

const { fakeApi, state } = vi.hoisted(() => {
  const state = {
    /** Each list read takes the next answer; the last one repeats. */
    lists: [] as (unknown[] | Error)[],
    listCalls: 0,
    /** A write held open until `release` is called, so a case can look at the in-flight form. */
    held: false,
    release: () => {},
    writeFailure: null as Error | null,
    writes: [] as { method: string; args: unknown[] }[],
    answer: null as unknown,
  };
  const listAnswer = () => {
    const next = state.lists[Math.min(state.listCalls, state.lists.length - 1)];
    state.listCalls += 1;
    return next;
  };
  const write = (method: string) => async (...args: unknown[]) => {
    state.writes.push({ method, args });
    if (state.held) await new Promise<void>((resolve) => (state.release = resolve));
    if (state.writeFailure) throw state.writeFailure;
    return state.answer;
  };
  const api = {
    getMeta: async () => ({ issueTypes: null, priorities: null, linkTypes: null, notificationTypes: null, userStatuses: null }),
    listProjectWorkflows: async () => {
      const next = listAnswer();
      if (next instanceof Error) throw next;
      if (next === undefined) return new Promise(() => {});
      return next;
    },
    createProjectWorkflow: write("create"),
    addWorkflowStatus: write("status"),
    addWorkflowTransition: write("transition"),
  };
  return { fakeApi: api as unknown as TaskaApi, state };
});

vi.mock("../api/client", () => ({ taskaApi: fakeApi }));

const refusal = (message: string, status: number, code: string) =>
  Object.assign(new Error(message), { status, code, requestId: "req-382" });

const statuses = [
  { id: "s-todo", statusKey: "TODO", name: "To Do", category: "TODO", sortOrder: 10 },
  { id: "s-progress", statusKey: "IN_PROGRESS", name: "In Progress", category: "IN_PROGRESS", sortOrder: 20 },
  { id: "s-done", statusKey: "DONE", name: "Done", category: "DONE", sortOrder: 30 },
];

const sharedWorkflow: WorkflowDefinition = {
  id: "wf-default",
  name: "Default workflow",
  version: 1,
  createdAt: "",
  updatedAt: "",
  statuses,
  transitions: [
    { id: "t1", fromStatusId: "s-todo", toStatusId: "s-progress", name: "Start Progress", sortOrder: 10, hidden: false },
    { id: "t2", fromStatusId: "s-progress", toStatusId: "s-done", name: "Complete", sortOrder: 20, hidden: false },
    { id: "t5", fromStatusId: "s-todo", toStatusId: "s-done", name: "Close", sortOrder: 50, hidden: false },
    { id: "t9", fromStatusId: "s-done", toStatusId: "s-todo", name: "Archive", sortOrder: 90, hidden: true },
  ],
};

const sharedEntry: ProjectWorkflowEntry = { workflow: sharedWorkflow, issueTypes: ["TASK", "BUG"], shared: true };
const ownWorkflow: WorkflowDefinition = { ...sharedWorkflow, id: "wf-own", name: "Development" };
const ownEntry: ProjectWorkflowEntry = { workflow: ownWorkflow, issueTypes: ["STORY"], shared: false };

function renderDialog(readerRole: ProjectRole | null | undefined = "ADMIN", archived = false) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <ProjectWorkflowsModal
        issueTypeOrder={["TASK", "BUG", "STORY"]}
        onClose={onClose}
        projectId={PROJECT}
        projectKey="TAS"
        readerRole={readerRole}
        archived={archived}
      />
    </QueryClientProvider>,
  );
  return { onClose, dialog: screen.getByRole("dialog", { name: "Workflows" }) };
}

const card = (name: string) => screen.getByRole("heading", { level: 3, name }).closest("section") as HTMLElement;
const pressEscape = () => fireEvent.keyDown(document, { key: "Escape" });

beforeEach(() => {
  state.lists = [[ownEntry, sharedEntry]];
  state.listCalls = 0;
  state.held = false;
  state.writeFailure = null;
  state.writes = [];
  state.answer = ownWorkflow;
});

describe("the Workflows dialog's states", () => {
  it("draws a skeleton card while the list is read, busy and said, with no spinner", async () => {
    state.lists = [undefined as unknown as unknown[]];
    renderDialog();

    expect(await screen.findByRole("status")).toHaveTextContent("Loading workflows");
    expect(document.querySelector("[aria-busy='true'] .workflow-skeleton")).not.toBeNull();
    expect(document.querySelector(".workflow-skeleton")).toHaveAttribute("aria-hidden", "true");
  });

  it("says a failed read with the server's words and the request id, and does not announce it", async () => {
    state.lists = [refusal("You don't have access to this project", 403, "PERMISSION_DENIED")];
    renderDialog();

    const sentence = await screen.findByText("This project’s workflows could not be loaded.");
    expect(screen.getByText("You don't have access to this project")).toBeVisible();
    expect(screen.getByText("req-382")).toBeVisible();
    expect(sentence.closest("[role='alert'], [role='status'], [aria-live]")).toBeNull();
    expect(state.listCalls).toBe(1);
  });

  it("says the routes are not on this gateway on the static-resource 404, with no id and no write control", async () => {
    state.lists = [refusal(`No static resource api/v1/projects/${PROJECT}/workflows.`, 404, "NOT_FOUND")];
    renderDialog("ADMIN");

    expect(await screen.findByText("Workflows are not on this gateway yet, so they cannot be shown here.")).toBeVisible();
    expect(screen.queryByText("req-382")).toBeNull();
    expect(document.querySelector(".api-notice")).toBeNull();
    expect(screen.queryByRole("button", { name: "New workflow" })).toBeNull();
  });

  it("answers an empty list as a project with no issue types, and offers no new workflow", async () => {
    state.lists = [[]];
    renderDialog("ADMIN");

    expect(await screen.findByText("This project has no issue types, so it runs on no workflow.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "New workflow" })).toBeNull();
  });

  it("lists the project's own workflow before the shared one, each with its types, statuses and every transition", async () => {
    renderDialog("ADMIN");

    const headings = await screen.findAllByRole("heading", { level: 3 });
    expect(headings.map((heading) => heading.textContent)).toEqual(["Development", "Default workflow"]);
    const shared = card("Default workflow");
    expect(within(shared).getByText("shared")).toHaveClass("workflow-marker");
    expect(within(shared).getByText(/Shared by every Taska project, so it cannot be changed here\. A new workflow starts/)).toBeVisible();
    expect(within(shared).getByText("Task")).toBeVisible();
    expect(within(shared).getByText("Bug")).toBeVisible();

    const rows = within(within(shared).getByRole("list", { name: "Transitions of Default workflow" })).getAllByRole("listitem");
    // Grouped by the status left, in column order: To Do's two, then In Progress's, then Done's.
    expect(rows.map((row) => row.textContent)).toEqual([
      "To Do→ to In Progress, named Start Progress",
      "To Do→ to Done, named Close",
      "In Progress→ to Done, named Complete",
      "Done→ to To Do, named Archive, hidden",
    ]);
    expect(within(shared).getByText("Hidden transitions are not offered on the board.")).toBeVisible();
    expect(within(shared).getByRole("list", { name: "Statuses of Default workflow" })).toHaveTextContent("TODO");
  });

  it("names an unknown status, a status nothing on the board leads to, and a workflow with no TODO", async () => {
    const odd: ProjectWorkflowEntry = {
      shared: false,
      issueTypes: ["STORY"],
      workflow: {
        ...ownWorkflow,
        statuses: [statuses[1], statuses[2], { id: "s-review", statusKey: "REVIEW", name: "Review", category: "QA", sortOrder: 25 }],
        transitions: [{ id: "x", fromStatusId: "s-gone", toStatusId: "s-done", name: "Ship", sortOrder: 10, hidden: false }],
      },
    };
    state.lists = [[odd, sharedEntry]];
    renderDialog("ADMIN");

    const own = await screen.findByRole("heading", { level: 3, name: "Development" }).then((heading) => heading.closest("section") as HTMLElement);
    expect(within(own).getByText("Unknown status")).toBeVisible();
    // In Progress and Review are reached by nothing visible; Done is reached by Ship.
    expect(within(own).getAllByText("No transition on the board leads here.")).toHaveLength(2);
    expect(within(own).getByText(/New issues always start in TODO, which this workflow does not have, so new story issues/)).toBeVisible();
    // A category this build cannot colour is the hollow ring, said in words beside it.
    expect(within(own).getByText("QA")).toBeVisible();
    expect(own.querySelector(".status-dot.is-unknown")).not.toBeNull();
  });
});

describe("what each role is offered", () => {
  for (const role of ["MEMBER", "VIEWER"] as const) {
    it(`gives a ${role} the list, the reason, and no write control — with the body as the stop that scrolls it`, async () => {
      renderDialog(role);

      expect(screen.getByText("Only a project admin can change workflows.")).toBeVisible();
      // The list answered, with no "A new workflow starts as a copy" for a reader who cannot make one.
      expect(await screen.findByText(/Shared by every Taska project, so it cannot be changed here\.$/)).toBeVisible();
      expect(screen.queryByRole("button", { name: /New workflow|Add status|Add transition/ })).toBeNull();
      expect(screen.getByRole("region", { name: "Workflows" })).toHaveAttribute("tabindex", "0");
    });
  }

  // TAS-149, DESIGN.md §5.7: an archived project's ADMIN gets a reader's dialog.
  it("gives an archived project's ADMIN the list, the archive as the reason, and no write control", async () => {
    renderDialog("ADMIN", true);

    expect(screen.getByText("This project is archived, so its workflows cannot be changed.")).toBeVisible();
    expect(await screen.findByText(/Shared by every Taska project, so it cannot be changed here\.$/)).toBeVisible();
    expect(screen.queryByText("Only a project admin can change workflows.")).toBeNull();
    expect(screen.queryByRole("button", { name: /New workflow|Add status|Add transition/ })).toBeNull();
  });

  it("says the role is unknown rather than that it is not an admin's, and offers nothing", async () => {
    renderDialog(null);

    expect(await screen.findByText("Your role on this project is unknown, so workflows cannot be changed here.")).toBeVisible();
    expect(screen.queryByRole("button", { name: /New workflow|Add status|Add transition/ })).toBeNull();
    expect(screen.getByRole("region", { name: "Workflows" })).toBeInTheDocument();
  });

  it("says nothing about the role while it is still being read", async () => {
    renderDialog(undefined);

    await screen.findAllByRole("heading", { level: 3 });
    expect(screen.queryByText(/Only a project admin|role on this project is unknown/)).toBeNull();
  });

  it("gives an ADMIN the writes on the project's own workflow and none on the shared one", async () => {
    renderDialog("ADMIN");

    await screen.findAllByRole("heading", { level: 3 });
    expect(within(card("Development")).getByRole("button", { name: "Add status" })).toBeVisible();
    expect(within(card("Development")).getByRole("button", { name: "Add transition" })).toBeVisible();
    expect(within(card("Default workflow")).queryByRole("button")).toBeNull();
    expect(screen.queryByRole("region", { name: "Workflows" })).toBeNull();
  });

  it("tells an ADMIN when every type already has its own workflow, in place of New workflow", async () => {
    state.lists = [[ownEntry, { ...sharedEntry, issueTypes: [] }]];
    renderDialog("ADMIN");

    expect(await screen.findByText("Every issue type in this project already has its own workflow.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "New workflow" })).toBeNull();
    expect(within(card("Default workflow")).getByText("No issue type uses it.")).toBeVisible();
  });
});

describe("New workflow", () => {
  it("sends the shared default verbatim with the name and the types, and re-reads before it closes", async () => {
    renderDialog("ADMIN");
    fireEvent.click(await screen.findByRole("button", { name: "New workflow" }));

    const form = screen.getByRole("form", { name: "New workflow" });
    const name = within(form).getByRole("textbox", { name: "Name" });
    expect(name).toHaveFocus();
    const submit = within(form).getByRole("button", { name: "Create workflow" });
    expect(submit).toHaveAttribute("aria-disabled", "true");
    // Only the types the shared default runs; the copy's source is named.
    expect(within(form).getAllByRole("checkbox").map((box) => box.closest("label")?.textContent)).toEqual(["Task", "Bug"]);
    expect(within(form).getByRole("group", { name: "Issue types" })).toHaveAccessibleDescription(
      "Starts as a copy of Default workflow, so issues of the types you move keep their status.",
    );

    fireEvent.change(name, { target: { value: "  Bugs  " } });
    expect(submit).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(within(form).getByRole("checkbox", { name: "Bug" }));
    expect(submit).not.toHaveAttribute("aria-disabled");

    const created = { ...ownWorkflow, id: "wf-new", name: "Bugs" };
    state.answer = created;
    state.lists = [[ownEntry, sharedEntry], [ownEntry, { workflow: created, issueTypes: ["BUG"], shared: false }, { ...sharedEntry, issueTypes: ["TASK"] }]];
    fireEvent.click(submit);

    await waitFor(() => expect(screen.getByRole("heading", { level: 3, name: "Bugs" })).toHaveFocus());
    expect(state.writes).toHaveLength(1);
    const [, input] = state.writes[0].args as [string, { name: string; issueTypes: string[]; transitions: { hidden: boolean }[] }];
    expect(input.name).toBe("Bugs");
    expect(input.issueTypes).toEqual(["BUG"]);
    expect(input.transitions.map((transition) => transition.hidden)).toEqual([false, false, false, true]);
    expect(state.listCalls).toBe(2);
    expect(card("Bugs")).toHaveClass("is-highlighted");
    expect(screen.getByText("Workflow Bugs created for Bug.")).toHaveAttribute("aria-live", "polite");
    expect(screen.queryByRole("form", { name: "New workflow" })).toBeNull();
  });
});

describe("Add status", () => {
  const openForm = async () => {
    renderDialog("ADMIN");
    await screen.findAllByRole("heading", { level: 3 });
    fireEvent.click(within(card("Development")).getByRole("button", { name: "Add status" }));
    return screen.getByRole("form", { name: "Add status" });
  };

  it("derives the key from the name until it is typed, and sends the midpoint at the end of its category", async () => {
    const form = await openForm();
    const name = within(form).getByRole("textbox", { name: "Name" });
    const key = within(form).getByRole("textbox", { name: "Key" });
    expect(name).toHaveFocus();
    // In Progress is the default category, and its end is between In Progress (20) and Done (30).
    expect(within(form).getByRole("button", { name: "In Progress" })).toHaveAttribute("aria-pressed", "true");
    expect(within(form).getByRole("combobox", { name: "Position" })).toHaveDisplayValue("After In Progress");

    fireEvent.change(name, { target: { value: "Code review" } });
    expect(key).toHaveValue("CODE_REVIEW");
    fireEvent.change(key, { target: { value: "cr-ready" } });
    expect(key).toHaveValue("CR_READY");
    fireEvent.change(name, { target: { value: "Code review ready" } });
    expect(key).toHaveValue("CR_READY");

    fireEvent.click(within(form).getByRole("button", { name: "Add status" }));
    await waitFor(() => expect(state.writes).toHaveLength(1));
    expect(state.writes[0].method).toBe("status");
    expect(state.writes[0].args).toEqual([
      PROJECT,
      "wf-own",
      { statusKey: "CR_READY", name: "Code review ready", category: "IN_PROGRESS", sortOrder: 25 },
    ]);
  });

  it("moves the default position with the category until a position is picked, and says where new issues start", async () => {
    const form = await openForm();
    const position = within(form).getByRole("combobox", { name: "Position" });

    fireEvent.click(within(form).getByRole("button", { name: "Done" }));
    expect(position).toHaveDisplayValue("After Done");
    fireEvent.change(position, { target: { value: "start" } });
    expect(within(form).getByText("New issues will still start in To Do.")).toBeVisible();
    fireEvent.click(within(form).getByRole("button", { name: "To Do" }));
    expect(position).toHaveDisplayValue("At the start");
  });

  it("offers a position with no whole number left as disabled", async () => {
    state.lists = [
      [{ ...ownEntry, workflow: { ...ownWorkflow, statuses: [statuses[0], { ...statuses[1], sortOrder: 11 }, statuses[2]] } }, sharedEntry],
    ];
    const form = await openForm();
    const option = within(form).getByRole("option", { name: "After To Do (no space left)" });
    expect(option).toBeDisabled();
  });

  it("says why the submit is off for a taken key or a key the server will not take, one reason at a time", async () => {
    const form = await openForm();
    const submit = within(form).getByRole("button", { name: "Add status" });
    fireEvent.change(within(form).getByRole("textbox", { name: "Name" }), { target: { value: "Done" } });

    expect(within(form).getByText("DONE is already a status in this workflow.")).toHaveClass("admin-write-hint");
    expect(submit).toHaveAttribute("aria-disabled", "true");
    expect(submit).toHaveClass("is-unavailable");

    fireEvent.change(within(form).getByRole("textbox", { name: "Key" }), { target: { value: "Q" } });
    expect(within(form).getByText("A key starts with a letter and has 2–64 capital letters, digits or underscores.")).toBeVisible();
    expect(within(form).queryByText(/already a status/)).toBeNull();
  });

  it("holds the form in flight — Cancel and Esc inert, other triggers closed — and keeps what was typed on a refusal", async () => {
    state.held = true;
    state.writeFailure = refusal("Workflow update failed: Status key is not unique: QA", 409, "ALREADY_EXISTS");
    const { onClose } = renderDialog("ADMIN");
    await screen.findAllByRole("heading", { level: 3 });
    fireEvent.click(within(card("Development")).getByRole("button", { name: "Add status" }));
    const form = screen.getByRole("form", { name: "Add status" });
    fireEvent.change(within(form).getByRole("textbox", { name: "Name" }), { target: { value: "QA" } });
    const submit = within(form).getByRole("button", { name: "Add status" });
    fireEvent.click(submit);

    await waitFor(() => expect(submit).toHaveAttribute("aria-disabled", "true"));
    expect(submit).not.toHaveClass("is-unavailable");
    expect(submit).toHaveTextContent("Add status");
    fireEvent.click(within(form).getByRole("button", { name: "Cancel" }));
    pressEscape();
    fireEvent.click(within(card("Development")).getByRole("button", { name: "Add transition" }));
    expect(screen.getByRole("form", { name: "Add status" })).toBeVisible();
    expect(screen.queryByRole("form", { name: "Add transition" })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    // Close stays usable in flight and cancels nothing (§4.28).
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await act(async () => state.release());
    const sentence = await within(form).findByText("The status was not added.");
    expect(sentence).toHaveAttribute("role", "alert");
    expect(within(form).getByText("Workflow update failed: Status key is not unique: QA")).toBeVisible();
    expect(within(form).getByText("req-382")).toBeVisible();
    expect(within(form).getByRole("textbox", { name: "Name" })).toHaveValue("QA");
    expect(submit).toHaveFocus();
    // A 409 says the list moved under the form: it is read again.
    await waitFor(() => expect(state.listCalls).toBe(2));
  });

  it("says the write route is not on this gateway when only the list answered", async () => {
    state.writeFailure = refusal(`No static resource api/v1/projects/${PROJECT}/workflows/wf-own/statuses.`, 404, "NOT_FOUND");
    const form = await openForm();
    fireEvent.change(within(form).getByRole("textbox", { name: "Name" }), { target: { value: "QA" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add status" }));

    expect(await within(form).findByText("Workflow changes are not on this gateway yet, so this was not saved.")).toHaveAttribute(
      "role",
      "status",
    );
    expect(within(form).queryByText("The status was not added.")).toBeNull();
  });

  it("closes on success, lights the new row, says what to do next, and hands focus to Add transition", async () => {
    const added = { ...ownWorkflow, statuses: [...statuses, { id: "s-qa", statusKey: "QA", name: "QA", category: "IN_PROGRESS", sortOrder: 25 }] };
    state.answer = { ...added, transitions: added.transitions.filter((transition) => !transition.hidden) };
    state.lists = [[ownEntry, sharedEntry], [{ ...ownEntry, workflow: added }, sharedEntry]];
    const form = await openForm();
    fireEvent.change(within(form).getByRole("textbox", { name: "Name" }), { target: { value: "QA" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add status" }));

    await waitFor(() => expect(within(card("Development")).getByRole("button", { name: "Add transition" })).toHaveFocus());
    expect(screen.getByText("QA", { selector: ".workflow-status-name" }).closest("li")).toHaveClass("is-highlighted");
    expect(screen.getByText("Status QA added. Add a transition so issues can move into it.")).toBeInTheDocument();

    // Add transition now leads into the status this dialog added, from the one before it.
    fireEvent.click(within(card("Development")).getByRole("button", { name: "Add transition" }));
    const next = screen.getByRole("form", { name: "Add transition" });
    expect(within(next).getByRole("combobox", { name: "From" })).toHaveDisplayValue("In Progress");
    expect(within(next).getByRole("combobox", { name: "To" })).toHaveDisplayValue("QA");
    expect(within(next).getByRole("textbox", { name: "Name" })).toHaveValue("Move to QA");
  });

  it("says a 201 whose re-read failed as what it is: added, not shown — no highlight, focus back on the trigger", async () => {
    state.answer = ownWorkflow;
    state.lists = [[ownEntry, sharedEntry], refusal("Upstream timeout", 504, "UNAVAILABLE")];
    const form = await openForm();
    fireEvent.change(within(form).getByRole("textbox", { name: "Name" }), { target: { value: "QA" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add status" }));

    // A 504 keeps the app's one retry (`projectWorkflowsOptions`), a second later.
    const notice = await screen.findByText(
      "Status QA was added, but this list could not be read again. Reopen Workflows to see it.",
      {},
      { timeout: 3000 },
    );
    expect(notice).toHaveAttribute("role", "status");
    expect(screen.getByText("Upstream timeout")).toBeVisible();
    expect(screen.queryByText("The status was not added.")).toBeNull();
    expect(screen.queryByRole("form", { name: "Add status" })).toBeNull();
    // The cards that were there stay.
    expect(card("Development")).toBeVisible();
    expect(document.querySelector(".is-highlighted")).toBeNull();
    await waitFor(() => expect(within(card("Development")).getByRole("button", { name: "Add status" })).toHaveFocus());
  });
});

describe("Add transition", () => {
  it("opens on the first move the workflow lacks, names it after its target, and numbers it past the hidden ones", async () => {
    const lacking = { ...ownWorkflow, transitions: ownWorkflow.transitions.filter((transition) => transition.id !== "t5") };
    state.lists = [[{ ...ownEntry, workflow: lacking }, sharedEntry]];
    renderDialog("ADMIN");
    await screen.findAllByRole("heading", { level: 3 });
    fireEvent.click(within(card("Development")).getByRole("button", { name: "Add transition" }));

    const form = screen.getByRole("form", { name: "Add transition" });
    const from = within(form).getByRole("combobox", { name: "From" });
    expect(from).toHaveFocus();
    expect(from).toHaveDisplayValue("To Do");
    const to = within(form).getByRole("combobox", { name: "To" });
    expect(to).toHaveDisplayValue("Done");
    // The From status is not a target.
    expect(within(to).queryByRole("option", { name: "To Do" })).toBeNull();
    expect(within(form).getByRole("textbox", { name: "Name" })).toHaveValue("Move to Done");

    fireEvent.click(within(form).getByRole("button", { name: "Add transition" }));
    await waitFor(() => expect(state.writes).toHaveLength(1));
    expect(state.writes[0].args).toEqual([
      PROJECT,
      "wf-own",
      { fromStatusKey: "TODO", toStatusKey: "DONE", name: "Move to Done", sortOrder: 100, hidden: false },
    ]);
  });

  it("says a pair that already exists, by the name it has", async () => {
    renderDialog("ADMIN");
    await screen.findAllByRole("heading", { level: 3 });
    fireEvent.click(within(card("Development")).getByRole("button", { name: "Add transition" }));
    const form = screen.getByRole("form", { name: "Add transition" });

    fireEvent.change(within(form).getByRole("combobox", { name: "To" }), { target: { value: "s-progress" } });
    expect(within(form).getByText("To Do → In Progress already exists as “Start Progress”.")).toBeVisible();
    expect(within(form).getByRole("button", { name: "Add transition" })).toHaveAttribute("aria-disabled", "true");
  });
});

describe("the keyboard", () => {
  it("starts on Close, closes an open form on Esc with focus back on its trigger, then the dialog", async () => {
    const { onClose } = renderDialog("ADMIN");
    await screen.findAllByRole("heading", { level: 3 });
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();

    const trigger = within(card("Development")).getByRole("button", { name: "Add status" });
    fireEvent.click(trigger);
    expect(screen.getByRole("form", { name: "Add status" })).toBeVisible();
    pressEscape();
    expect(screen.queryByRole("form", { name: "Add status" })).toBeNull();
    await waitFor(() => expect(within(card("Development")).getByRole("button", { name: "Add status" })).toHaveFocus());
    expect(onClose).not.toHaveBeenCalled();

    pressEscape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("leaves Esc to the input method while it is composing", async () => {
    const { onClose } = renderDialog("ADMIN");
    await screen.findAllByRole("heading", { level: 3 });
    fireEvent.keyDown(document, { key: "Escape", isComposing: true });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("opens one form at a time: another one takes the first one's place, draft and all", async () => {
    renderDialog("ADMIN");
    await screen.findAllByRole("heading", { level: 3 });
    fireEvent.click(within(card("Development")).getByRole("button", { name: "Add status" }));
    fireEvent.change(within(screen.getByRole("form", { name: "Add status" })).getByRole("textbox", { name: "Name" }), {
      target: { value: "Draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: "New workflow" }));

    expect(screen.queryByRole("form", { name: "Add status" })).toBeNull();
    expect(screen.getByRole("form", { name: "New workflow" })).toBeVisible();
    fireEvent.click(within(screen.getByRole("form", { name: "New workflow" })).getByRole("button", { name: "Cancel" }));
    fireEvent.click(within(card("Development")).getByRole("button", { name: "Add status" }));
    expect(within(screen.getByRole("form", { name: "Add status" })).getByRole("textbox", { name: "Name" })).toHaveValue("");
  });
});
