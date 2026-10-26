import { describe, expect, it } from "vitest";
import type { ProjectWorkflowEntry, WorkflowDefinition, WorkflowStatus } from "../domain/types";
import {
  andList,
  defaultCategory,
  defaultPosition,
  defaultTransitionPair,
  freeSortOrderBetween,
  isIssueCountRefusal,
  isMigrationLimitRefusal,
  issueCountOf,
  migrationLimitOf,
  namedStatusKeys,
  nextTransitionSortOrder,
  normalizeStatusKey,
  orderWorkflowEntries,
  positionOptions,
  positionValue,
  statusCategoriesOf,
  statusEditPositions,
  statusKeyFromName,
  statusesToMap,
  targetStatusKeysOf,
  transitionButtonLabel,
  transitionEditPositions,
  transitionPositionValue,
  transitionsInListOrder,
  unreachedStatusIds,
  withWorkflowEntry,
  workflowCopyInput,
} from "./workflows";

const status = (id: string, statusKey: string, category: string, sortOrder: number, name = statusKey): WorkflowStatus => ({
  id,
  statusKey,
  name,
  category,
  sortOrder,
});

/** The shared default as backend PR #208's migration leaves it: 10/20/30 and six transitions, 10…60. */
const shared: WorkflowDefinition = {
  id: "wf-default",
  name: "Default workflow",
  version: 1,
  createdAt: "",
  updatedAt: "",
  statuses: [
    status("s-todo", "TODO", "TODO", 10, "To Do"),
    status("s-progress", "IN_PROGRESS", "IN_PROGRESS", 20, "In Progress"),
    status("s-done", "DONE", "DONE", 30, "Done"),
  ],
  transitions: [
    { id: "t1", fromStatusId: "s-todo", toStatusId: "s-progress", name: "Start Progress", sortOrder: 10, hidden: false },
    { id: "t2", fromStatusId: "s-progress", toStatusId: "s-done", name: "Complete", sortOrder: 20, hidden: false },
    { id: "t3", fromStatusId: "s-done", toStatusId: "s-progress", name: "Reopen", sortOrder: 30, hidden: false },
    { id: "t4", fromStatusId: "s-progress", toStatusId: "s-todo", name: "Stop Progress", sortOrder: 40, hidden: false },
    { id: "t5", fromStatusId: "s-todo", toStatusId: "s-done", name: "Close", sortOrder: 50, hidden: false },
    { id: "t6", fromStatusId: "s-done", toStatusId: "s-todo", name: "Back to To Do", sortOrder: 60, hidden: true },
  ],
};

const sortOrders = (statuses: WorkflowStatus[]) => positionOptions(statuses).map((option) => option.sortOrder);

describe("where a new status goes (§4.28)", () => {
  it("halves the first number at the start, takes the midpoint between two, and ten past the last", () => {
    expect(sortOrders(shared.statuses)).toEqual([5, 15, 25, 40]);
  });

  it("floors a midpoint that is not whole", () => {
    expect(sortOrders([status("a", "A1", "TODO", 10), status("b", "B1", "DONE", 13)])).toEqual([5, 11, 23]);
  });

  it("offers a gap with no whole number in it as having no space, and never renumbers", () => {
    const tight = [status("a", "A1", "TODO", 0), status("b", "B1", "IN_PROGRESS", 1), status("c", "C1", "DONE", 3)];
    // first = 0 at the start, next − prev < 2 after A1, 2 fits after B1.
    expect(sortOrders(tight)).toEqual([null, null, 2, 13]);
  });

  it("orders by sortOrder whatever order the answer had", () => {
    const shuffled = [status("c", "C1", "DONE", 30), status("a", "A1", "TODO", 10)];
    expect(positionOptions(shuffled).map((option) => option.after?.id ?? "start")).toEqual(["start", "a", "c"]);
  });

  it("starts a workflow with no status at the shared step", () => {
    expect(sortOrders([])).toEqual([10]);
  });
});

describe("the default position of a new status", () => {
  it("is the end of its category: after the last status whose rank is not above it", () => {
    expect(defaultPosition(shared.statuses, "IN_PROGRESS")).toEqual({ after: "s-progress" });
    expect(defaultPosition(shared.statuses, "DONE")).toEqual({ after: "s-done" });
    expect(defaultPosition(shared.statuses, "TODO")).toEqual({ after: "s-todo" });
  });

  it("is the start when nothing ranks at or below it", () => {
    expect(defaultPosition([status("p", "IN_PROGRESS", "IN_PROGRESS", 20)], "TODO")).toBe("start");
  });

  it("passes over a status of a category it cannot rank, and puts an unranked category last", () => {
    const withReview = [...shared.statuses, status("r", "REVIEW", "REVIEW", 25)];
    expect(defaultPosition(withReview, "IN_PROGRESS")).toEqual({ after: "s-progress" });
    expect(defaultPosition(withReview, "REVIEW")).toEqual({ after: "s-done" });
  });

  it("falls back to after the last status when the end of its category has no room", () => {
    const tight = [status("a", "TODO", "TODO", 10), status("b", "DOING", "IN_PROGRESS", 20), status("c", "DONE", "DONE", 21)];
    expect(defaultPosition(tight, "IN_PROGRESS")).toEqual({ after: "c" });
  });
});

describe("a new transition's number", () => {
  it("is ten past the highest of every transition, the hidden ones included", () => {
    // t6 is hidden and the highest: a number taken from the visible ones (50)
    // would land on it.
    expect(nextTransitionSortOrder(shared.transitions)).toBe(70);
  });

  it("is ten for a workflow with none", () => {
    expect(nextTransitionSortOrder([])).toBe(10);
  });
});

describe("the key a name suggests", () => {
  it("is the name in capitals with spaces and hyphens as underscores", () => {
    expect(statusKeyFromName("  Code review-ready ")).toBe("CODE_REVIEW_READY");
    expect(normalizeStatusKey("qa sign-off")).toBe("QA_SIGN_OFF");
  });

  it("stops at the 64 characters a key may have", () => {
    expect(statusKeyFromName("a".repeat(80))).toHaveLength(64);
  });

  it("leaves anything else to the server: a Cyrillic name gives a key it will refuse", () => {
    expect(statusKeyFromName("Ревью")).toBe("РЕВЬЮ");
  });
});

describe("the categories a new status may take", () => {
  const entry = (statuses: WorkflowStatus[], isShared = false): ProjectWorkflowEntry => ({
    workflow: { ...shared, id: `wf-${statuses.length}-${String(isShared)}`, statuses, transitions: [] },
    issueTypes: [],
    shared: isShared,
  });

  it("are every category the list carries, the shared default's included, known ones first in board order", () => {
    const own = entry([status("r", "REVIEW", "REVIEW", 25), status("d", "DONE", "DONE", 30)]);
    expect(statusCategoriesOf([own, entry(shared.statuses, true)])).toEqual(["TODO", "IN_PROGRESS", "DONE", "REVIEW"]);
  });

  it("default to In Progress, or the first when it is not offered", () => {
    expect(defaultCategory(["TODO", "IN_PROGRESS", "DONE"])).toBe("IN_PROGRESS");
    expect(defaultCategory(["TODO", "DONE"])).toBe("TODO");
    expect(defaultCategory([])).toBeUndefined();
  });
});

describe("Add transition's opening pair", () => {
  it("is the first status and the first it has no move to", () => {
    // TODO already goes to In Progress (t1) and to Done (t5).
    const open = { ...shared, transitions: shared.transitions.filter((transition) => transition.id !== "t5") };
    expect(defaultTransitionPair(open, [])).toEqual({ fromStatusId: "s-todo", toStatusId: "s-done" });
  });

  it("leads into a status this dialog added that nothing on the board reaches yet, from the one before it", () => {
    const withReview = { ...shared, statuses: [...shared.statuses, status("s-review", "REVIEW", "IN_PROGRESS", 25)] };
    expect(unreachedStatusIds(withReview)).toEqual(new Set(["s-review"]));
    expect(defaultTransitionPair(withReview, ["s-review"])).toEqual({ fromStatusId: "s-progress", toStatusId: "s-review" });
  });

  it("does not count a hidden transition as reaching a status, and never counts To Do as unreached", () => {
    const hiddenIntoDone = {
      ...shared,
      transitions: [
        shared.transitions[0],
        { id: "h", fromStatusId: "s-progress", toStatusId: "s-done", name: "Auto-close", sortOrder: 90, hidden: true },
      ],
    };
    expect(unreachedStatusIds(hiddenIntoDone)).toEqual(new Set(["s-done"]));
  });
});

describe("the transitions as the dialog lists them", () => {
  it("are grouped by the status they leave in column order, and by sortOrder inside a group", () => {
    expect(transitionsInListOrder(shared).map((transition) => transition.id)).toEqual(["t1", "t5", "t2", "t4", "t3", "t6"]);
  });
});

describe("New workflow's body", () => {
  it("is the shared default as the list sent it: every status, every transition by key, hidden ones included", () => {
    const input = workflowCopyInput(shared, "Development", ["TASK", "BUG"]);
    expect(input.name).toBe("Development");
    expect(input.issueTypes).toEqual(["TASK", "BUG"]);
    expect(input.statuses).toEqual([
      { statusKey: "TODO", name: "To Do", category: "TODO", sortOrder: 10 },
      { statusKey: "IN_PROGRESS", name: "In Progress", category: "IN_PROGRESS", sortOrder: 20 },
      { statusKey: "DONE", name: "Done", category: "DONE", sortOrder: 30 },
    ]);
    expect(input.transitions).toHaveLength(6);
    expect(input.transitions.at(-1)).toEqual({
      fromStatusKey: "DONE",
      toStatusKey: "TODO",
      name: "Back to To Do",
      sortOrder: 60,
      hidden: true,
    });
  });
});

describe("the order of the cards", () => {
  const own = (id: string, issueTypes: string[]): ProjectWorkflowEntry => ({
    workflow: { ...shared, id },
    issueTypes,
    shared: false,
  });
  const sharedEntry: ProjectWorkflowEntry = { workflow: shared, issueTypes: ["TASK"], shared: true };

  it("puts the project's own by the board's order of their first type, and the shared default last", () => {
    const ordered = orderWorkflowEntries([sharedEntry, own("story", ["STORY"]), own("bug", ["BUG"])], ["TASK", "BUG", "STORY"]);
    expect(ordered.map((entry) => entry.workflow.id)).toEqual(["bug", "story", "wf-default"]);
  });

  it("ranks a type the board does not offer after every one it does, and drops none", () => {
    const ordered = orderWorkflowEntries([own("story", ["STORY"]), own("bug", ["BUG"]), sharedEntry], ["TASK", "BUG"]);
    expect(ordered.map((entry) => entry.workflow.id)).toEqual(["bug", "story", "wf-default"]);
  });
});

describe("a move button's name (§4.1)", () => {
  it("adds where it goes to the transition's own name", () => {
    expect(transitionButtonLabel("Close", "Done")).toEqual({ text: "Close", ariaLabel: "Close, move to Done" });
  });

  it("adds nothing to a name that already says it, whatever its case and edges", () => {
    expect(transitionButtonLabel(" move to done ", "Done")).toEqual({ text: " move to done ", ariaLabel: undefined });
  });

  it("draws an unnamed transition as Move to {To}", () => {
    expect(transitionButtonLabel("  ", "In Review")).toEqual({ text: "Move to In Review", ariaLabel: undefined });
  });
});

describe("a list in words", () => {
  it("joins with commas and a final and", () => {
    expect(andList([])).toBe("");
    expect(andList(["Task"])).toBe("Task");
    expect(andList(["Task", "Bug"])).toBe("Task and Bug");
    expect(andList(["Task", "Bug", "Story"])).toBe("Task, Bug and Story");
  });
});

/** TAS-416 (backend PR #225): where an existing row can move, and what a delete has to move issues out of. */
describe("moving an existing status", () => {
  it("offers Add status's places among the other statuses, the one it holds keeping its own number", () => {
    const { options, current } = statusEditPositions(shared.statuses, "s-progress");
    expect(current).toEqual({ after: "s-todo" });
    expect(options.map((option) => [positionValue(option.position), option.sortOrder, option.current])).toEqual([
      ["start", 5, false],
      ["after:s-todo", 20, true],
      ["after:s-done", 40, false],
    ]);
  });

  it("puts the first status at the start, and finds no room where the others leave none", () => {
    const tight = [status("a", "TODO", "TODO", 10), status("b", "B", "IN_PROGRESS", 11), status("c", "C", "DONE", 12)];
    const { options, current } = statusEditPositions(tight, "a");
    expect(current).toBe("start");
    expect(options.map((option) => [positionValue(option.position), option.sortOrder])).toEqual([
      ["start", 10],
      ["after:b", null],
      ["after:c", 22],
    ]);
  });
});

describe("moving an existing transition", () => {
  it("offers the places among the moves out of the same status, at numbers no transition of the workflow holds", () => {
    // Out of To Do: Start Progress (10) and Close (50); Complete (20) and Reopen (30) leave other statuses.
    const { options, current } = transitionEditPositions(shared, "t5");
    expect(current).toEqual({ after: "t1" });
    expect(options.map((option) => [transitionPositionValue(option.position), option.sortOrder, option.current])).toEqual([
      ["first", 5, false],
      ["after:t1", 50, true],
    ]);
    const first = transitionEditPositions(shared, "t1");
    expect(first.current).toBe("first");
    expect(first.options.map((option) => [transitionPositionValue(option.position), option.sortOrder])).toEqual([
      ["first", 10],
      ["after:t5", 60 + 1],
    ]);
  });

  it("finds the free number nearest the middle of a gap, or says there is none", () => {
    expect(freeSortOrderBetween(10, 50, new Set([30]))).toBe(29);
    expect(freeSortOrderBetween(10, 12, new Set([11]))).toBeNull();
    expect(freeSortOrderBetween(null, 1, new Set())).toBe(0);
    expect(freeSortOrderBetween(null, 0, new Set())).toBeNull();
    expect(freeSortOrderBetween(40, null, new Set([50, 51]))).toBe(52);
  });
});

describe("what a delete moves issues out of", () => {
  const own: WorkflowDefinition = {
    ...shared,
    id: "wf-own",
    statuses: [...shared.statuses, status("s-qa", "QA", "IN_PROGRESS", 25, "QA"), status("s-ship", "SHIP", "DONE", 40, "Ship")],
  };

  it("takes the statuses the details name, and keeps apart the ones that are not this workflow's", () => {
    expect(statusesToMap(own, { issueCount: "4", statusKeys: "SHIP,BLOCKED" })).toEqual({
      mappable: [own.statuses[4]],
      unmappable: ["BLOCKED"],
    });
  });

  // Never guessed from the shared default: without the keys there is nothing to map.
  it("maps nothing when the details name no status", () => {
    expect(statusesToMap(own, null)).toEqual({ mappable: [], unmappable: [] });
    expect(statusesToMap(own, { issueCount: "4" })).toEqual({ mappable: [], unmappable: [] });
  });

  it("reads the named status keys as the server joins them, and none when they did not come", () => {
    expect(namedStatusKeys({ issueCount: "3", statusKeys: "BLOCKED, QA" })).toEqual(["BLOCKED", "QA"]);
    expect(namedStatusKeys({ issueCount: "3" })).toEqual([]);
    expect(namedStatusKeys(null)).toEqual([]);
  });

  const refusal = (code: string, details: Record<string, string> | null) =>
    Object.assign(new Error("Workflow statuses have 3 issues; supply a target status mapping"), { code, details });

  // Backend TAS-427: the reason is the key. Before it the dialog read any
  // FAILED_PRECONDITION carrying `issueCount` or `statusKeys` as this one.
  it("reads the issue-count refusal off the code and details.reason, never the message or the other keys", () => {
    const unmapped = { reason: "WORKFLOW_ISSUES_UNMAPPED", issueCount: "3", statusKeys: "QA", targetStatusKeys: "TODO,DONE" };
    expect(isIssueCountRefusal(refusal("FAILED_PRECONDITION", unmapped))).toBe(true);
    expect(isIssueCountRefusal(refusal("FAILED_PRECONDITION", { reason: "WORKFLOW_ISSUES_UNMAPPED" }))).toBe(true);
    // The keys without the reason are not it, and neither is another reason.
    expect(isIssueCountRefusal(refusal("FAILED_PRECONDITION", { issueCount: "3", statusKeys: "QA" }))).toBe(false);
    expect(isIssueCountRefusal(refusal("FAILED_PRECONDITION", null))).toBe(false);
    expect(isIssueCountRefusal(refusal("FAILED_PRECONDITION", { reason: "PROJECT_ARCHIVED" }))).toBe(false);
    expect(isIssueCountRefusal(refusal("FAILED_PRECONDITION", { reason: "WORKFLOW_MIGRATION_LIMIT", limit: "5000" }))).toBe(
      false,
    );
    expect(isIssueCountRefusal(refusal("INVALID_ARGUMENT", { reason: "WORKFLOW_ISSUES_UNMAPPED" }))).toBe(false);
    expect(issueCountOf(refusal("FAILED_PRECONDITION", { issueCount: "3" }))).toBe(3);
    expect(issueCountOf(refusal("FAILED_PRECONDITION", { issueCount: "three" }))).toBeNull();
    expect(issueCountOf(refusal("FAILED_PRECONDITION", null))).toBeNull();
  });

  it("reads the targets the refusal names, in its order, and none when it named none", () => {
    expect(targetStatusKeysOf(refusal("FAILED_PRECONDITION", { targetStatusKeys: "TODO, IN_PROGRESS,DONE" }))).toEqual([
      "TODO",
      "IN_PROGRESS",
      "DONE",
    ]);
    expect(targetStatusKeysOf(refusal("FAILED_PRECONDITION", { targetStatusKeys: "" }))).toEqual([]);
    expect(targetStatusKeysOf(refusal("FAILED_PRECONDITION", { issueCount: "3" }))).toEqual([]);
    expect(targetStatusKeysOf(refusal("FAILED_PRECONDITION", null))).toEqual([]);
  });

  // Was a 429 RESOURCE_EXHAUSTED; a 400 with its own reason since TAS-427.
  it("reads the migration limit off the reason, with the limit as a number only when it is a whole one", () => {
    const limited = refusal("FAILED_PRECONDITION", { reason: "WORKFLOW_MIGRATION_LIMIT", limit: "5000" });
    expect(isMigrationLimitRefusal(limited)).toBe(true);
    expect(migrationLimitOf(limited)).toBe(5000);
    expect(migrationLimitOf(refusal("FAILED_PRECONDITION", { reason: "WORKFLOW_MIGRATION_LIMIT", limit: "lots" }))).toBeNull();
    expect(isMigrationLimitRefusal(refusal("RESOURCE_EXHAUSTED", { reason: "WORKFLOW_MIGRATION_LIMIT" }))).toBe(false);
    expect(isMigrationLimitRefusal(refusal("FAILED_PRECONDITION", { limit: "5000" }))).toBe(false);
  });
});

describe("an edit's answer in the list", () => {
  it("takes the place of the entry with its id, and leaves the list to be read when none has it", () => {
    const list: ProjectWorkflowEntry[] = [
      { workflow: { ...shared, id: "wf-own" }, issueTypes: ["TASK"], shared: false },
      { workflow: shared, issueTypes: ["BUG"], shared: true },
    ];
    const answer: ProjectWorkflowEntry = { workflow: { ...shared, id: "wf-own", name: "Renamed" }, issueTypes: ["TASK"], shared: false };
    expect(withWorkflowEntry(list, answer)?.map((entry) => entry.workflow.name)).toEqual(["Renamed", "Default workflow"]);
    // An edit changes no binding: the list's types, in the list's order, stay.
    const reordered = withWorkflowEntry(
      [{ ...list[0], issueTypes: ["TASK", "STORY"] }, list[1]],
      { ...answer, issueTypes: ["STORY", "TASK"] },
    );
    expect(reordered?.[0].issueTypes).toEqual(["TASK", "STORY"]);
    expect(withWorkflowEntry(list, { ...answer, workflow: { ...answer.workflow, id: "" } })).toBeNull();
    expect(withWorkflowEntry(list, { ...answer, workflow: { ...answer.workflow, id: "wf-gone" } })).toBeNull();
  });
});
