import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskaApi } from "../api/TaskaApi";
import type { ProjectIssueType, ProjectRole, ProjectWorkflowEntry, WorkflowDefinition } from "../domain/types";
import { boardKey } from "../lib/boardQuery";
import { projectContextKey } from "../lib/projectContext";
import { ProjectWorkflowsModal } from "./ProjectWorkflowsModal";

/**
 * The Workflows dialog (TAS-382, TAS-416, DESIGN.md §4.28). What is pinned is
 * what the dialog does with an answer — every state, the role gating, the
 * forms' and strips' defaults and bodies, the in-flight window, a refusal, a
 * delete's move and mapping steps, a stale version, and a 201 whose re-read
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
    /** Refusals for the next writes, one each, before `writeFailure` and `answer` apply. */
    failQueue: [] as Error[],
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
    const queued = state.failQueue.shift();
    if (queued) throw queued;
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
    updateProjectWorkflow: write("rename"),
    deleteProjectWorkflow: write("delete-workflow"),
    updateWorkflowStatus: write("edit-status"),
    deleteWorkflowStatus: write("delete-status"),
    updateWorkflowTransition: write("edit-transition"),
    deleteWorkflowTransition: write("delete-transition"),
  };
  return { fakeApi: api as unknown as TaskaApi, state };
});

vi.mock("../api/client", () => ({ taskaApi: fakeApi }));

const refusal = (message: string, status: number, code: string, details: Record<string, string> | null = null) =>
  Object.assign(new Error(message), { status, code, requestId: "req-382", details });

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

/** The registry every project is seeded with (backend #212), in its order. */
const SEEDED_TYPES: ProjectIssueType[] = [
  { code: "TASK", name: "Task", color: "blue", icon: "check-square", sortOrder: 10 },
  { code: "BUG", name: "Bug", color: "red", icon: "bug", sortOrder: 20 },
  { code: "STORY", name: "Story", color: "green", icon: "book-open", sortOrder: 30 },
];

function renderDialog(readerRole: ProjectRole | null | undefined = "ADMIN", archived = false) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <ProjectWorkflowsModal
        issueTypes={SEEDED_TYPES}
        onClose={onClose}
        projectId={PROJECT}
        projectKey="TAS"
        readerRole={readerRole}
        archived={archived}
      />
    </QueryClientProvider>,
  );
  return { onClose, queryClient, dialog: screen.getByRole("dialog", { name: "Workflows" }) };
}

const card = (name: string) => screen.getByRole("heading", { level: 3, name }).closest("section") as HTMLElement;
const pressEscape = () => fireEvent.keyDown(document, { key: "Escape" });

beforeEach(() => {
  state.lists = [[ownEntry, sharedEntry]];
  state.listCalls = 0;
  state.held = false;
  state.writeFailure = null;
  state.failQueue = [];
  state.writes = [];
  state.answer = ownEntry;
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
    expect(within(own).getByText(/New issues always start in TODO, which this workflow does not have, so new Story issues/)).toBeVisible();
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
    state.answer = { workflow: created, issueTypes: ["BUG"], shared: false };
    state.lists = [[ownEntry, sharedEntry], [ownEntry, { workflow: created, issueTypes: ["BUG"], shared: false }, { ...sharedEntry, issueTypes: ["TASK"] }]];
    fireEvent.click(submit);

    await waitFor(() => expect(screen.getByRole("heading", { level: 3, name: "Bugs" })).toHaveFocus());
    expect(state.writes).toHaveLength(1);
    const [, input] = state.writes[0].args as [string, { name: string; issueTypes: string[]; transitions: { hidden: boolean }[] }];
    expect(input.name).toBe("Bugs");
    expect(input.issueTypes).toEqual(["BUG"]);
    expect(input.transitions.map((transition) => transition.hidden)).toEqual([false, false, false, true]);
    // A create moves types off the shared default, which its answer does not say: the list is read again.
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
    // Backend PR #225: the 201 is the whole workflow, and it is what is drawn.
    state.answer = { ...ownEntry, workflow: added };
    const form = await openForm();
    fireEvent.change(within(form).getByRole("textbox", { name: "Name" }), { target: { value: "QA" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add status" }));

    await waitFor(() => expect(within(card("Development")).getByRole("button", { name: "Add transition" })).toHaveFocus());
    expect(state.listCalls).toBe(1);
    expect(screen.getByText("QA", { selector: ".workflow-status-name" }).closest("li")).toHaveClass("is-highlighted");
    expect(screen.getByText("Status QA added. Add a transition so issues can move into it.")).toBeInTheDocument();

    // Add transition now leads into the status this dialog added, from the one before it.
    fireEvent.click(within(card("Development")).getByRole("button", { name: "Add transition" }));
    const next = screen.getByRole("form", { name: "Add transition" });
    expect(within(next).getByRole("combobox", { name: "From" })).toHaveDisplayValue("In Progress");
    expect(within(next).getByRole("combobox", { name: "To" })).toHaveDisplayValue("QA");
    expect(within(next).getByRole("textbox", { name: "Name" })).toHaveValue("Move to QA");
  });

  it("says nothing that would stop a status being renamed, moved or removed later", async () => {
    const form = await openForm();
    expect(within(form).queryByText(/cannot be renamed/)).toBeNull();
    expect(within(form).getByRole("button", { name: "Add status" })).not.toHaveAccessibleDescription();
  });
});

describe("a create whose re-read failed", () => {
  it("is said as what it is: created, not shown — no highlight, focus back on the trigger", async () => {
    state.answer = { workflow: { ...ownWorkflow, id: "wf-new", name: "Bugs" }, issueTypes: ["BUG"], shared: false };
    state.lists = [[ownEntry, sharedEntry], refusal("Upstream timeout", 504, "UNAVAILABLE")];
    renderDialog("ADMIN");
    fireEvent.click(await screen.findByRole("button", { name: "New workflow" }));
    const form = screen.getByRole("form", { name: "New workflow" });
    fireEvent.change(within(form).getByRole("textbox", { name: "Name" }), { target: { value: "Bugs" } });
    fireEvent.click(within(form).getByRole("checkbox", { name: "Bug" }));
    fireEvent.click(within(form).getByRole("button", { name: "Create workflow" }));

    // A 504 keeps the app's one retry (`projectWorkflowsOptions`), a second later.
    const notice = await screen.findByText(
      "Workflow Bugs was created, but this list could not be read again. Reopen Workflows to see it.",
      {},
      { timeout: 3000 },
    );
    expect(notice).toHaveAttribute("role", "status");
    expect(screen.getByText("Upstream timeout")).toBeVisible();
    expect(screen.queryByText("The workflow was not created.")).toBeNull();
    expect(screen.queryByRole("form", { name: "New workflow" })).toBeNull();
    // The cards that were there stay.
    expect(card("Development")).toBeVisible();
    expect(document.querySelector(".is-highlighted")).toBeNull();
    await waitFor(() => expect(screen.getByRole("button", { name: "New workflow" })).toHaveFocus());
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

  it("says nothing that would stop a transition being renamed or removed later", async () => {
    renderDialog("ADMIN");
    await screen.findAllByRole("heading", { level: 3 });
    fireEvent.click(within(card("Development")).getByRole("button", { name: "Add transition" }));
    expect(within(screen.getByRole("form", { name: "Add transition" })).queryByText(/cannot be renamed/)).toBeNull();
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

/**
 * TAS-416 (backend PR #225): editing and deleting the project's own workflows.
 * Every edit sends the version on screen and draws its answer — the whole
 * workflow — without reading the list again; a create and a workflow delete,
 * which move types on or off the shared default, read it again.
 */
const ACTIONS = /^(Rename|Edit|Delete) /;
const answerWith = (workflow: Partial<WorkflowDefinition>): ProjectWorkflowEntry => ({
  ...ownEntry,
  workflow: { ...ownWorkflow, version: 2, ...workflow },
});
const openDialog = async (role: ProjectRole | null = "ADMIN") => {
  renderDialog(role);
  await screen.findAllByRole("heading", { level: 3 });
};

describe("who is offered the edits", () => {
  for (const role of ["MEMBER", "VIEWER", null] as const) {
    it(`offers a ${role ?? "reader of unknown role"} no rename, edit or delete anywhere`, async () => {
      await openDialog(role);
      expect(screen.queryAllByRole("button", { name: ACTIONS })).toEqual([]);
    });
  }

  it("offers an archived project's ADMIN none either", async () => {
    renderDialog("ADMIN", true);
    await screen.findAllByRole("heading", { level: 3 });
    expect(screen.queryAllByRole("button", { name: ACTIONS })).toEqual([]);
  });

  it("offers an ADMIN every row of the own workflow and nothing on the shared one — and no Delete on TODO", async () => {
    await openDialog();
    const own = card("Development");
    expect(within(own).getByRole("button", { name: "Rename Development" })).toBeVisible();
    expect(within(own).getByRole("button", { name: "Delete Development" })).toHaveAttribute("aria-expanded", "false");
    expect(within(own).getByRole("button", { name: "Edit In Progress" })).toBeVisible();
    expect(within(own).getByRole("button", { name: "Delete In Progress" })).toBeVisible();
    expect(within(own).getByRole("button", { name: "Edit To Do to Done" })).toBeVisible();
    expect(within(own).getByRole("button", { name: "Delete Done to To Do" })).toBeVisible();
    // The server never deletes TODO, so the dialog does not offer it, and says why.
    expect(within(own).getByRole("button", { name: "Edit To Do" })).toBeVisible();
    expect(within(own).queryByRole("button", { name: "Delete To Do" })).toBeNull();
    expect(within(own).getByText("New issues start here, so it cannot be deleted.")).toBeVisible();
    expect(within(card("Default workflow")).queryAllByRole("button", { name: ACTIONS })).toEqual([]);
  });
});

describe("Rename", () => {
  it("puts a Name field in the heading's place, sends the name with the version, and draws the answer", async () => {
    state.answer = answerWith({ name: "Delivery" });
    await openDialog();
    fireEvent.click(within(card("Development")).getByRole("button", { name: "Rename Development" }));

    const form = screen.getByRole("form", { name: "Rename Development" });
    const name = within(form).getByRole("textbox", { name: "Name" });
    expect(name).toHaveFocus();
    expect(name).toHaveValue("Development");
    expect(screen.queryByRole("heading", { level: 3, name: "Development" })).toBeNull();
    fireEvent.change(name, { target: { value: "  Delivery " } });
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Rename Delivery" })).toHaveFocus());
    expect(state.writes).toEqual([{ method: "rename", args: [PROJECT, "wf-own", { version: 1, name: "Delivery" }] }]);
    expect(card("Delivery")).toHaveClass("is-highlighted");
    expect(screen.getByText("Workflow renamed to Delivery.")).toHaveAttribute("aria-live", "polite");
    // The answer is the whole workflow: nothing is read again.
    expect(state.listCalls).toBe(1);
  });

  it("sends nothing for the same name, and Esc puts the heading back with focus on Rename", async () => {
    await openDialog();
    fireEvent.click(within(card("Development")).getByRole("button", { name: "Rename Development" }));
    fireEvent.click(within(screen.getByRole("form", { name: "Rename Development" })).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Rename Development" })).toHaveFocus());
    expect(state.writes).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Rename Development" }));
    const form = screen.getByRole("form", { name: "Rename Development" });
    fireEvent.change(within(form).getByRole("textbox", { name: "Name" }), { target: { value: " " } });
    expect(within(form).getByRole("button", { name: "Save" })).toHaveAttribute("aria-disabled", "true");
    pressEscape();
    expect(screen.getByRole("heading", { level: 3, name: "Development" })).toBeVisible();
    await waitFor(() => expect(screen.getByRole("button", { name: "Rename Development" })).toHaveFocus());
  });

  it("reloads a workflow the server says changed elsewhere, and says so once with its words and id", async () => {
    state.writeFailure = refusal("Workflow version changed", 409, "ABORTED");
    state.lists = [[ownEntry, sharedEntry], [{ ...ownEntry, workflow: { ...ownWorkflow, version: 4, name: "Platform" } }, sharedEntry]];
    const { queryClient } = renderDialog("ADMIN");
    await screen.findAllByRole("heading", { level: 3 });
    const invalidated = vi.spyOn(queryClient, "invalidateQueries");
    fireEvent.click(within(card("Development")).getByRole("button", { name: "Rename Development" }));
    const form = screen.getByRole("form", { name: "Rename Development" });
    fireEvent.change(within(form).getByRole("textbox", { name: "Name" }), { target: { value: "Delivery" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));

    const notice = await screen.findByText("Development was changed elsewhere, so it has been reloaded. Nothing was saved.");
    expect(notice).toHaveAttribute("role", "status");
    expect(screen.getByText("Workflow version changed")).toBeVisible();
    expect(screen.getByText("req-382")).toBeVisible();
    expect(state.listCalls).toBe(2);
    // The board read the same workflow: it is read again with the list (api-contract-guard N3).
    expect(invalidated.mock.calls.map(([filters]) => filters?.queryKey)).toEqual(
      expect.arrayContaining([projectContextKey(PROJECT), boardKey(PROJECT)]),
    );
    expect(screen.queryByRole("form", { name: /Rename/ })).toBeNull();
    // Not "was not renamed": a conflict is not said as a refusal of the form.
    expect(screen.queryByText("The workflow was not renamed.")).toBeNull();
    await waitFor(() => expect(screen.getByRole("heading", { level: 3, name: "Platform" })).toHaveFocus());

    // The next edit sends the version the server has now.
    state.writeFailure = null;
    state.answer = answerWith({ name: "Delivery", version: 5 });
    fireEvent.click(screen.getByRole("button", { name: "Rename Platform" }));
    fireEvent.change(within(screen.getByRole("form", { name: "Rename Platform" })).getByRole("textbox", { name: "Name" }), {
      target: { value: "Delivery" },
    });
    fireEvent.click(within(screen.getByRole("form", { name: "Rename Platform" })).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(state.writes).toHaveLength(2));
    expect(state.writes[1].args).toEqual([PROJECT, "wf-own", { version: 4, name: "Delivery" }]);
    expect(screen.queryByText(/was changed elsewhere/)).toBeNull();
  });
});

describe("Edit status", () => {
  const openEdit = async (statusName: string) => {
    await openDialog();
    fireEvent.click(within(card("Development")).getByRole("button", { name: `Edit ${statusName}` }));
    return screen.getByRole("form", { name: `Edit ${statusName}` });
  };

  it("opens filled in, the key read-only, the position it holds chosen among the other statuses", async () => {
    const form = await openEdit("In Progress");
    expect(within(form).getByRole("textbox", { name: "Name" })).toHaveFocus();
    expect(within(form).getByRole("textbox", { name: "Name" })).toHaveValue("In Progress");
    expect(within(form).getByRole("textbox", { name: "Key" })).toHaveAttribute("readonly");
    expect(within(form).getByRole("textbox", { name: "Key" })).toHaveValue("IN_PROGRESS");
    expect(within(form).getByRole("button", { name: "In Progress" })).toHaveAttribute("aria-pressed", "true");
    const position = within(form).getByRole("combobox", { name: "Position" });
    expect(position).toHaveDisplayValue("After To Do");
    // Without itself: no "After In Progress".
    expect(within(position).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "At the start",
      "After To Do",
      "After Done",
    ]);
    // The row's own line is gone while its form is open.
    expect(within(card("Development")).queryByRole("button", { name: "Edit In Progress" })).toBeNull();
  });

  it("moves it to a free number after its new neighbour, sending only what changed", async () => {
    const moved = answerWith({ statuses: [statuses[0], statuses[2], { ...statuses[1], sortOrder: 40 }] });
    state.answer = moved;
    const form = await openEdit("In Progress");
    fireEvent.change(within(form).getByRole("combobox", { name: "Position" }), { target: { value: "after:s-done" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(within(card("Development")).getByRole("button", { name: "Edit In Progress" })).toHaveFocus());
    expect(state.writes).toEqual([
      { method: "edit-status", args: [PROJECT, "wf-own", "s-progress", { version: 1, sortOrder: 40 }] },
    ]);
    const rows = within(within(card("Development")).getByRole("list", { name: "Statuses of Development" })).getAllByRole("listitem");
    expect(rows.map((row) => row.querySelector(".workflow-status-name")?.textContent)).toEqual(["To Do", "Done", "In Progress"]);
    expect(rows[2]).toHaveClass("is-highlighted");
    expect(screen.getByText("Status In Progress saved.")).toBeInTheDocument();
  });

  it("renames and recategorises without a sortOrder when the place stays, and closes on nothing changed", async () => {
    state.answer = answerWith({ statuses: [statuses[0], { ...statuses[1], name: "Doing", category: "DONE" }, statuses[2]] });
    let form = await openEdit("In Progress");
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("form", { name: "Edit In Progress" })).toBeNull());
    expect(state.writes).toEqual([]);

    fireEvent.click(within(card("Development")).getByRole("button", { name: "Edit In Progress" }));
    form = screen.getByRole("form", { name: "Edit In Progress" });
    fireEvent.change(within(form).getByRole("textbox", { name: "Name" }), { target: { value: "Doing" } });
    fireEvent.click(within(form).getByRole("button", { name: "Done" }));
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(state.writes).toHaveLength(1));
    expect(state.writes[0].args).toEqual([PROJECT, "wf-own", "s-progress", { version: 1, name: "Doing", category: "DONE" }]);
  });

  it("keeps the form and what was typed on a refusal, in the server's words", async () => {
    state.writeFailure = refusal("Workflow requires a TODO status and at least one visible transition", 400, "INVALID_ARGUMENT");
    const form = await openEdit("In Progress");
    fireEvent.change(within(form).getByRole("textbox", { name: "Name" }), { target: { value: "Doing" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));

    expect(await within(form).findByText("The status was not changed.")).toHaveAttribute("role", "alert");
    expect(within(form).getByText("Workflow requires a TODO status and at least one visible transition")).toBeVisible();
    expect(within(form).getByRole("textbox", { name: "Name" })).toHaveValue("Doing");
    expect(within(form).getByRole("button", { name: "Save" })).toHaveFocus();
  });
});

describe("Edit transition", () => {
  it("shows From and To as they are, and moves, renames and hides with only what changed", async () => {
    state.answer = answerWith({
      transitions: sharedWorkflow.transitions.map((transition) =>
        transition.id === "t5" ? { ...transition, sortOrder: 5, hidden: true } : transition,
      ),
    });
    await openDialog();
    fireEvent.click(within(card("Development")).getByRole("button", { name: "Edit To Do to Done" }));
    const form = screen.getByRole("form", { name: "Edit To Do to Done" });
    expect(within(form).getByRole("textbox", { name: "Name" })).toHaveValue("Close");
    expect(form.querySelector(".workflow-form-pair")).toHaveTextContent("To Do→ to Done");
    // Among the moves out of To Do — Start Progress at 10 and this one at 50.
    const position = within(form).getByRole("combobox", { name: "Position" });
    expect(position).toHaveDisplayValue("After Start Progress");
    expect(within(position).getAllByRole("option").map((option) => option.textContent)).toEqual(["First", "After Start Progress"]);
    expect(position).toHaveAccessibleDescription("The order of the move buttons on a To Do issue.");
    const hidden = within(form).getByRole("checkbox", { name: "Hidden" });
    expect(hidden).not.toBeChecked();
    expect(hidden).toHaveAccessibleDescription("A hidden transition is not offered on the board.");

    fireEvent.change(position, { target: { value: "first" } });
    fireEvent.click(hidden);
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(within(card("Development")).getByRole("button", { name: "Edit To Do to Done" })).toHaveFocus());
    // Half of 10, which no transition of the workflow holds.
    expect(state.writes[0].args).toEqual([PROJECT, "wf-own", "t5", { version: 1, sortOrder: 5, hidden: true }]);
    const row = within(card("Development")).getByRole("button", { name: "Edit To Do to Done" }).closest("li") as HTMLElement;
    expect(row).toHaveTextContent("hidden");
    expect(row).toHaveClass("is-highlighted");
  });
});

describe("Delete status", () => {
  const openStrip = async () => {
    await openDialog();
    fireEvent.click(within(card("Development")).getByRole("button", { name: "Delete In Progress" }));
    return document.getElementById(
      within(card("Development")).getByRole("button", { name: "Delete In Progress" }).getAttribute("aria-controls")!,
    ) as HTMLElement;
  };
  const withoutProgress = answerWith({
    statuses: [statuses[0], statuses[2]],
    transitions: sharedWorkflow.transitions.filter((t) => t.fromStatusId !== "s-progress" && t.toStatusId !== "s-progress"),
  });

  it("asks in a strip under the row, Cancel first, and deletes a status nobody is in at once", async () => {
    state.answer = withoutProgress;
    const strip = await openStrip();
    expect(within(card("Development")).getByRole("button", { name: "Delete In Progress" })).toHaveAttribute("aria-expanded", "true");
    expect(strip).toHaveTextContent("Delete In Progress? Its transitions are deleted with it.");
    expect(within(strip).getByRole("button", { name: "Cancel" })).toHaveFocus();
    fireEvent.click(within(strip).getByRole("button", { name: "Delete status" }));

    await waitFor(() => expect(within(card("Development")).getByRole("button", { name: "Add status" })).toHaveFocus());
    expect(state.writes).toEqual([{ method: "delete-status", args: [PROJECT, "wf-own", "s-progress", { version: 1 }] }]);
    expect(within(card("Development")).queryByText("In Progress", { selector: ".workflow-status-name" })).toBeNull();
    expect(screen.getByText("Status In Progress deleted, with its transitions.")).toBeInTheDocument();
  });

  it("turns a refusal for its issues into a move step, then deletes with the target chosen", async () => {
    state.failQueue = [
      refusal("Workflow statuses have 2 issues; supply a target status mapping", 400, "FAILED_PRECONDITION", {
        issueCount: "2",
        statusKeys: "IN_PROGRESS",
      }),
    ];
    state.answer = withoutProgress;
    const strip = await openStrip();
    fireEvent.click(within(strip).getByRole("button", { name: "Delete status" }));

    const step = await within(strip).findByRole("alert");
    expect(step).toHaveTextContent("2 issues would be left in a status this workflow no longer has. Move In Progress’s issues to delete it.");
    // A step with an answer is a question: the server's instruction to an API
    // client and the request id are not printed (art-director, TAS-416).
    expect(within(strip).queryByText("Workflow statuses have 2 issues; supply a target status mapping")).toBeNull();
    expect(within(strip).queryByText("req-382")).toBeNull();
    // Said once, by the step: not again as "was not deleted".
    expect(within(strip).queryByText("The status was not deleted.")).toBeNull();
    // A refusal is not a reason to read the list again.
    expect(state.listCalls).toBe(1);
    const target = within(strip).getByRole("combobox", { name: "Move its issues to" });
    await waitFor(() => expect(target).toHaveFocus());
    expect(within(target).getAllByRole("option").map((option) => option.textContent)).toEqual(["Choose a status", "To Do", "Done"]);
    const answer = within(strip).getByRole("button", { name: "Move and delete" });
    expect(answer).toHaveAttribute("aria-disabled", "true");

    fireEvent.change(target, { target: { value: "TODO" } });
    expect(answer).not.toHaveAttribute("aria-disabled");
    fireEvent.click(answer);

    await waitFor(() => expect(state.writes).toHaveLength(2));
    expect(state.writes[1].args).toEqual([PROJECT, "wf-own", "s-progress", { version: 1, targetStatusKey: "TODO" }]);
    expect(await screen.findByText("Status In Progress deleted. Its issues moved to To Do.")).toBeInTheDocument();
    expect(state.listCalls).toBe(1);
  });

  // api-contract-guard, TAS-416: the deletes have other FAILED_PRECONDITIONs,
  // and the message is never read — only the details make a step.
  it("says a FAILED_PRECONDITION without details as an ordinary refusal, in the server's words", async () => {
    state.failQueue = [refusal("Workflow statuses have 3 issues; supply a target status mapping", 400, "FAILED_PRECONDITION")];
    const strip = await openStrip();
    fireEvent.click(within(strip).getByRole("button", { name: "Delete status" }));

    expect(await within(strip).findByText("The status was not deleted.")).toHaveAttribute("role", "alert");
    expect(within(strip).getByText("Workflow statuses have 3 issues; supply a target status mapping")).toBeVisible();
    expect(within(strip).getByText("req-382")).toBeVisible();
    expect(within(strip).queryByRole("combobox")).toBeNull();
    expect(within(strip).getByRole("button", { name: "Delete status" })).toBeVisible();
  });

  it("names no count when only the statuses came", async () => {
    state.failQueue = [
      refusal("Workflow statuses have 3 issues; supply a target status mapping", 400, "FAILED_PRECONDITION", {
        statusKeys: "IN_PROGRESS",
      }),
    ];
    const strip = await openStrip();
    fireEvent.click(within(strip).getByRole("button", { name: "Delete status" }));

    expect(await within(strip).findByRole("alert")).toHaveTextContent(
      "Issues would be left in a status this workflow no longer has. Move In Progress’s issues to delete it.",
    );
    expect(within(strip).getByRole("combobox", { name: "Move its issues to" })).toBeVisible();
  });

  // issue-service counts issues already outside the workflow too; a target
  // moves only the deleted status's, so the move would be refused forever.
  it("stops offering the move once the refusal names issues in a status the workflow does not have", async () => {
    state.failQueue = [
      refusal("Workflow statuses have 2 issues; supply a target status mapping", 400, "FAILED_PRECONDITION", {
        issueCount: "2",
        statusKeys: "IN_PROGRESS",
      }),
      refusal("Workflow statuses have 1 issues; supply a target status mapping", 400, "FAILED_PRECONDITION", {
        issueCount: "1",
        statusKeys: "BLOCKED_BY_QA",
      }),
    ];
    const strip = await openStrip();
    fireEvent.click(within(strip).getByRole("button", { name: "Delete status" }));
    fireEvent.change(await within(strip).findByRole("combobox", { name: "Move its issues to" }), { target: { value: "TODO" } });
    fireEvent.click(within(strip).getByRole("button", { name: "Move and delete" }));

    await waitFor(() =>
      expect(within(strip).getByRole("alert")).toHaveTextContent(/^1 issue would be left in a status this workflow no longer has\.$/),
    );
    const why = within(strip).getByText("BLOCKED_BY_QA is not a status of Development, so its issues cannot be moved from here.");
    expect(why).toBeVisible();
    // A dead end reads sentence, why, then the server's words and the id, then Cancel.
    const words = within(strip).getByText("Workflow statuses have 1 issues; supply a target status mapping");
    expect(why.compareDocumentPosition(words) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(strip).getByText("req-382")).toBeVisible();
    expect(within(strip).queryByRole("combobox")).toBeNull();
    expect(within(strip).queryByRole("button", { name: /Move and delete|Delete status/ })).toBeNull();
    await waitFor(() => expect(within(strip).getByRole("button", { name: "Cancel" })).toHaveFocus());
    expect(state.writes).toHaveLength(2);
    expect(state.listCalls).toBe(1);
  });

  it("says any other refusal in the strip, and Esc closes it with focus back on Delete", async () => {
    state.failQueue = [refusal("Workflow requires a TODO status and at least one visible transition", 400, "INVALID_ARGUMENT")];
    const strip = await openStrip();
    fireEvent.click(within(strip).getByRole("button", { name: "Delete status" }));

    expect(await within(strip).findByText("The status was not deleted.")).toHaveAttribute("role", "alert");
    expect(within(strip).queryByRole("combobox")).toBeNull();
    await waitFor(() => expect(within(strip).getByRole("button", { name: "Delete status" })).toHaveFocus());
    pressEscape();
    await waitFor(() => expect(within(card("Development")).getByRole("button", { name: "Delete In Progress" })).toHaveFocus());
    expect(within(card("Development")).getByRole("button", { name: "Delete In Progress" })).toHaveAttribute("aria-expanded", "false");
  });
});

describe("Delete transition", () => {
  it("names the pair, deletes with the version, and hands focus to Add transition", async () => {
    state.answer = answerWith({ transitions: sharedWorkflow.transitions.filter((transition) => transition.id !== "t5") });
    await openDialog();
    const trigger = within(card("Development")).getByRole("button", { name: "Delete To Do to Done" });
    fireEvent.click(trigger);
    const strip = document.getElementById(trigger.getAttribute("aria-controls")!) as HTMLElement;
    expect(within(strip).getByText(/^Delete To Do/)).toHaveTextContent("Delete To Do → to Done?");
    fireEvent.click(within(strip).getByRole("button", { name: "Delete transition" }));

    await waitFor(() => expect(within(card("Development")).getByRole("button", { name: "Add transition" })).toHaveFocus());
    expect(state.writes).toEqual([{ method: "delete-transition", args: [PROJECT, "wf-own", "t5", { version: 1 }] }]);
    expect(within(card("Development")).queryByRole("button", { name: "Edit To Do to Done" })).toBeNull();
    expect(screen.getByText("Transition To Do to Done deleted.")).toBeInTheDocument();
  });
});

describe("Delete workflow", () => {
  const qa = { id: "s-qa", statusKey: "QA", name: "QA", category: "IN_PROGRESS", sortOrder: 25 };
  const withQa: ProjectWorkflowEntry = { ...ownEntry, workflow: { ...ownWorkflow, statuses: [...statuses, qa] } };
  const issuesRefusal = (details: Record<string, string> | null) =>
    refusal("Workflow statuses have 1 issues; supply a target status mapping", 400, "FAILED_PRECONDITION", details);
  const openStrip = async () => {
    await openDialog();
    const trigger = within(card("Development")).getByRole("button", { name: "Delete Development" });
    fireEvent.click(trigger);
    return document.getElementById(trigger.getAttribute("aria-controls")!) as HTMLElement;
  };

  it("says which types go back, and after the delete reads the list again: the card gone, the types on the shared one", async () => {
    state.answer = { workflow: sharedWorkflow, issueTypes: ["STORY"], shared: true };
    state.lists = [[ownEntry, sharedEntry], [{ ...sharedEntry, issueTypes: ["TASK", "BUG", "STORY"] }]];
    const strip = await openStrip();
    expect(strip).toHaveTextContent("Delete Development? Story goes back to Default workflow.");
    fireEvent.click(within(strip).getByRole("button", { name: "Delete workflow" }));

    await waitFor(() => expect(screen.getByRole("heading", { level: 3, name: "Default workflow" })).toHaveFocus());
    expect(state.writes).toEqual([{ method: "delete-workflow", args: [PROJECT, "wf-own", { version: 1 }] }]);
    expect(screen.queryByRole("heading", { level: 3, name: "Development" })).toBeNull();
    expect(within(card("Default workflow")).getByText("Story")).toBeVisible();
    expect(card("Default workflow")).toHaveClass("is-highlighted");
    expect(state.listCalls).toBe(2);
    expect(screen.getByText("Workflow Development deleted. Story uses Default workflow again.")).toBeInTheDocument();
  });

  it("maps the statuses the details name to statuses of both workflows, then deletes with the mapping", async () => {
    state.lists = [[withQa, sharedEntry], [{ ...sharedEntry, issueTypes: ["TASK", "BUG", "STORY"] }]];
    state.failQueue = [issuesRefusal({ issueCount: "1", statusKeys: "QA" })];
    state.answer = { workflow: sharedWorkflow, issueTypes: ["STORY"], shared: true };
    const strip = await openStrip();
    fireEvent.click(within(strip).getByRole("button", { name: "Delete workflow" }));

    expect(await within(strip).findByRole("alert")).toHaveTextContent(
      "1 issue would be left in statuses Default workflow does not have. Choose where each status’s issues go.",
    );
    expect(within(strip).queryByText("Workflow statuses have 1 issues; supply a target status mapping")).toBeNull();
    expect(within(strip).queryByText("req-382")).toBeNull();
    const select = within(strip).getByRole("combobox", { name: "Move QA issues to" });
    await waitFor(() => expect(select).toHaveFocus());
    // Only what both workflows have: QA is not among them.
    expect(within(select).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Choose a status",
      "To Do",
      "In Progress",
      "Done",
    ]);
    const answer = within(strip).getByRole("button", { name: "Move and delete" });
    expect(answer).toHaveAttribute("aria-disabled", "true");
    fireEvent.change(select, { target: { value: "IN_PROGRESS" } });
    fireEvent.click(answer);

    await waitFor(() => expect(state.writes).toHaveLength(2));
    expect(state.writes[1].args).toEqual([PROJECT, "wf-own", { version: 1, statusMappings: { QA: "IN_PROGRESS" } }]);
    await waitFor(() => expect(screen.queryByRole("heading", { level: 3, name: "Development" })).toBeNull());
  });

  it("says a refusal without the statuses it names as an ordinary refusal, and keeps the question", async () => {
    state.lists = [[withQa, sharedEntry]];
    for (const details of [null, { issueCount: "1" }]) {
      state.failQueue = [issuesRefusal(details)];
      const strip = await openStrip();
      fireEvent.click(within(strip).getByRole("button", { name: "Delete workflow" }));

      expect(await within(strip).findByText("The workflow was not deleted.")).toHaveAttribute("role", "alert");
      expect(within(strip).getByText("Workflow statuses have 1 issues; supply a target status mapping")).toBeVisible();
      expect(within(strip).queryByRole("combobox")).toBeNull();
      expect(within(strip).getByRole("button", { name: "Delete workflow" })).toBeVisible();
      cleanup();
    }
  });

  it("offers no answer when the two workflows share no status, and says what to do first", async () => {
    const apart: ProjectWorkflowEntry = {
      ...ownEntry,
      workflow: { ...ownWorkflow, statuses: [{ ...qa, id: "s-todo", statusKey: "TODO_LOCAL" }] },
    };
    state.lists = [[apart, sharedEntry]];
    state.failQueue = [issuesRefusal({ issueCount: "1", statusKeys: "TODO_LOCAL" })];
    const strip = await openStrip();
    fireEvent.click(within(strip).getByRole("button", { name: "Delete workflow" }));

    const why = await within(strip).findByText(
      "Development shares no status with Default workflow, so these issues have nowhere to go. Add one of Default workflow’s statuses to Development first.",
    );
    expect(why).toBeVisible();
    expect(within(strip).getByRole("alert")).toHaveTextContent(/^1 issue would be left in statuses Default workflow does not have\.$/);
    const words = within(strip).getByText("Workflow statuses have 1 issues; supply a target status mapping");
    expect(why.compareDocumentPosition(words) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(strip).getByText("req-382")).toBeVisible();
    expect(within(strip).queryByRole("button", { name: /Move and delete|Delete workflow/ })).toBeNull();
    await waitFor(() => expect(within(strip).getByRole("button", { name: "Cancel" })).toHaveFocus());
  });

  // Every type with a workflow of its own: the list leaves the shared default out.
  it("without the shared default in the list, offers its own other statuses and says the server takes only shared ones", async () => {
    state.lists = [[withQa]];
    state.failQueue = [issuesRefusal({ issueCount: "1", statusKeys: "QA" })];
    state.answer = { workflow: sharedWorkflow, issueTypes: ["STORY"], shared: true };
    const strip = await openStrip();
    expect(strip).toHaveTextContent("Delete Development? Story goes back to the shared workflow.");
    fireEvent.click(within(strip).getByRole("button", { name: "Delete workflow" }));

    // The line under it says "Choose" already; the sentence does not say it twice.
    expect(await within(strip).findByRole("alert")).toHaveTextContent(
      /^1 issue would be left in statuses the shared workflow does not have\.$/,
    );
    expect(
      within(strip).getByText(
        "The shared workflow is not in this list, so its statuses are not known here. Choose one it also has: the server moves issues only to a status both workflows have.",
      ),
    ).toBeVisible();
    expect(within(strip).queryByText(/shares no status/)).toBeNull();
    const select = within(strip).getByRole("combobox", { name: "Move QA issues to" });
    // QA is the status the server named as one the shared default lacks.
    expect(within(select).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Choose a status",
      "To Do",
      "In Progress",
      "Done",
    ]);
    fireEvent.change(select, { target: { value: "DONE" } });
    fireEvent.click(within(strip).getByRole("button", { name: "Move and delete" }));

    await waitFor(() => expect(state.writes).toHaveLength(2));
    expect(state.writes[1].args).toEqual([PROJECT, "wf-own", { version: 1, statusMappings: { QA: "DONE" } }]);
  });

  it("without the shared default and without details, says the refusal as one", async () => {
    state.lists = [[withQa]];
    state.failQueue = [issuesRefusal(null)];
    const strip = await openStrip();
    fireEvent.click(within(strip).getByRole("button", { name: "Delete workflow" }));

    expect(await within(strip).findByText("The workflow was not deleted.")).toBeVisible();
    expect(within(strip).queryByText(/shares no status|not in this list/)).toBeNull();
    expect(within(strip).queryByRole("combobox")).toBeNull();
    expect(within(strip).getByRole("button", { name: "Delete workflow" })).toBeVisible();
  });

  it("says a refusal that names nothing to map as a refusal, and keeps the question", async () => {
    state.failQueue = [refusal("Default workflow is not usable", 400, "FAILED_PRECONDITION", { issueCount: "0" })];
    const strip = await openStrip();
    fireEvent.click(within(strip).getByRole("button", { name: "Delete workflow" }));

    expect(await within(strip).findByText("The workflow was not deleted.")).toBeVisible();
    expect(within(strip).getByText("Default workflow is not usable")).toBeVisible();
    expect(within(strip).getByRole("button", { name: "Delete workflow" })).toBeVisible();
  });
});

/**
 * api-contract-guard N2 (TAS-416): what each write asks of the server. An edit
 * or an add answers the whole workflow, so it is one write and no re-read of
 * the list; it invalidates exactly the project context and the board, the two
 * reads that show the workflow elsewhere.
 */
describe("what a write asks the server for", () => {
  const flows: [string, ProjectWorkflowEntry, () => void][] = [
    [
      "edit status",
      answerWith({ statuses: [statuses[0], { ...statuses[1], name: "Doing" }, statuses[2]] }),
      () => {
        fireEvent.click(within(card("Development")).getByRole("button", { name: "Edit In Progress" }));
        const form = screen.getByRole("form", { name: "Edit In Progress" });
        fireEvent.change(within(form).getByRole("textbox", { name: "Name" }), { target: { value: "Doing" } });
        fireEvent.click(within(form).getByRole("button", { name: "Save" }));
      },
    ],
    [
      "edit transition",
      answerWith({ transitions: sharedWorkflow.transitions.map((t) => (t.id === "t5" ? { ...t, hidden: true } : t)) }),
      () => {
        fireEvent.click(within(card("Development")).getByRole("button", { name: "Edit To Do to Done" }));
        const form = screen.getByRole("form", { name: "Edit To Do to Done" });
        fireEvent.click(within(form).getByRole("checkbox", { name: "Hidden" }));
        fireEvent.click(within(form).getByRole("button", { name: "Save" }));
      },
    ],
    [
      "add transition",
      answerWith({
        transitions: [
          ...sharedWorkflow.transitions,
          { id: "t10", fromStatusId: "s-progress", toStatusId: "s-todo", name: "Move to To Do", sortOrder: 100, hidden: false },
        ],
      }),
      () => {
        fireEvent.click(within(card("Development")).getByRole("button", { name: "Add transition" }));
        const form = screen.getByRole("form", { name: "Add transition" });
        fireEvent.change(within(form).getByRole("combobox", { name: "From" }), { target: { value: "s-progress" } });
        fireEvent.change(within(form).getByRole("combobox", { name: "To" }), { target: { value: "s-todo" } });
        fireEvent.click(within(form).getByRole("button", { name: "Add transition" }));
      },
    ],
    [
      "delete status",
      answerWith({ statuses: [statuses[0], statuses[1]], transitions: [sharedWorkflow.transitions[0]] }),
      () => {
        fireEvent.click(within(card("Development")).getByRole("button", { name: "Delete Done" }));
        fireEvent.click(screen.getByRole("button", { name: "Delete status" }));
      },
    ],
    [
      "delete transition",
      answerWith({ transitions: sharedWorkflow.transitions.filter((t) => t.id !== "t5") }),
      () => {
        fireEvent.click(within(card("Development")).getByRole("button", { name: "Delete To Do to Done" }));
        fireEvent.click(screen.getByRole("button", { name: "Delete transition" }));
      },
    ],
  ];

  for (const [name, answer, act] of flows) {
    it(`${name}: one write, no re-read of the list, and the context and the board read again`, async () => {
      state.answer = answer;
      const { queryClient } = renderDialog("ADMIN");
      await screen.findAllByRole("heading", { level: 3 });
      const invalidated = vi.spyOn(queryClient, "invalidateQueries");
      act();

      await waitFor(() => expect(screen.getByText(/ (saved|added|deleted)/, { selector: "[aria-live]" })).toBeInTheDocument());
      expect(state.writes).toHaveLength(1);
      expect(state.listCalls).toBe(1);
      expect(invalidated.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([projectContextKey(PROJECT), boardKey(PROJECT)]);
    });
  }
});

describe("a row form or strip opened below the fold", () => {
  it("is brought into the body's view on opening, nearest and without an animation", async () => {
    await openDialog();
    const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
    fireEvent.click(within(card("Development")).getByRole("button", { name: "Edit In Progress to Done" }));
    expect(scrolled).toHaveBeenCalledWith({ block: "nearest" });
    expect(scrolled.mock.contexts.at(-1)).toBe(screen.getByRole("form", { name: "Edit In Progress to Done" }));

    pressEscape();
    scrolled.mockClear();
    fireEvent.click(within(card("Development")).getByRole("button", { name: "Delete In Progress" }));
    expect(scrolled).toHaveBeenCalledWith({ block: "nearest" });
    expect((scrolled.mock.contexts.at(-1) as HTMLElement).classList.contains("workflow-confirm")).toBe(true);
    scrolled.mockRestore();
  });
});
