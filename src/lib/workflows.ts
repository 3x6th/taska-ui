import { apiErrorFacts, hasRefusalReason, type ErrorDetails } from "../api/errors";
import type { CreateProjectWorkflowInput } from "../api/TaskaApi";
import type {
  IssueTypeCode,
  ProjectWorkflowEntry,
  WorkflowDefinition,
  WorkflowDefinitionTransition,
  WorkflowStatus,
} from "../domain/types";
import { statusLabel } from "./format";

/**
 * The arithmetic and the defaults of the Workflows dialog (DESIGN.md §4.28,
 * TAS-382, TAS-416), kept out of the component so each rule can be tested by
 * itself: where a new or moved status goes, which number a new or moved
 * transition takes, which key a name suggests, what a new workflow is a copy
 * of, and which statuses a delete has to move issues out of.
 *
 * A position is still never a renumbering: a move changes one row's number,
 * to a free one between its new neighbours, and says so when there is no room
 * (backend PR #225 refuses a `sortOrder` another row holds).
 */

/** The status issue-service creates every issue in, which the server never lets a workflow delete. */
export const INITIAL_STATUS_KEY = "TODO";

/** The three categories this build can rank, in board order (§4.28 "Position"). */
const CATEGORY_RANK: Readonly<Record<string, number>> = { TODO: 0, IN_PROGRESS: 1, DONE: 2 };

const rankOf = (category: string): number | undefined =>
  Object.hasOwn(CATEGORY_RANK, category) ? CATEGORY_RANK[category] : undefined;

/** The gap the shared default leaves between its statuses (10/20/30), and what a first number is. */
const SORT_ORDER_STEP = 10;

/**
 * workflow-service's `workflow.validation.status-key-pattern` at backend PR
 * #208 (`9a04e99`). Read only for the one reason §4.28 lists — "A key starts
 * with a letter and has 2–64 capital letters, digits or underscores." — and
 * otherwise left to the server, whose 400 names the problem in its own words.
 */
export const STATUS_KEY_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;
/** The Key field's `maxLength` — the pattern's 64. */
export const STATUS_KEY_MAX_LENGTH = 64;
/** `workflow.validation.name-max-length`, as every name field's `maxLength`. */
export const WORKFLOW_NAME_MAX_LENGTH = 100;

/** What the Key field does to what is typed: capitals, and a space or a hyphen as `_` (§4.28). */
export function normalizeStatusKey(text: string): string {
  return text.toUpperCase().replace(/[\s-]/g, "_");
}

/** The key a name suggests while the reader has not typed one of their own. */
export function statusKeyFromName(name: string): string {
  return normalizeStatusKey(name.trim()).slice(0, STATUS_KEY_MAX_LENGTH);
}

/** A category in words (§6): "In Progress", or the code as sent. */
export function categoryLabel(category: string): string {
  return category.trim() === "" ? "No category" : statusLabel(category);
}

/**
 * The categories a new status may take: every one the list's statuses carry,
 * the shared default's included (§4.28). There is no dictionary of them
 * (docs/ai/BACKLOG.md), and offering only a workflow's own would leave a
 * workflow without one unable to ever get it. The three this build can rank
 * come first in board order, then the rest in the order the answer has them.
 */
export function statusCategoriesOf(entries: readonly ProjectWorkflowEntry[]): string[] {
  const sent: string[] = [];
  for (const entry of entries) {
    for (const status of entry.workflow.statuses) {
      if (status.category.trim() !== "" && !sent.includes(status.category)) sent.push(status.category);
    }
  }
  const ranked = Object.keys(CATEGORY_RANK).filter((category) => sent.includes(category));
  return [...ranked, ...sent.filter((category) => rankOf(category) === undefined)];
}

/** In Progress when it is offered — the category a status added between two is most often in — else the first. */
export function defaultCategory(categories: readonly string[]): string | undefined {
  return categories.includes("IN_PROGRESS") ? "IN_PROGRESS" : categories[0];
}

/** A workflow's statuses in the order the board draws them. `sort` is stable, so a tie keeps the answer's order. */
export function statusesInColumnOrder<T extends Pick<WorkflowStatus, "sortOrder">>(statuses: readonly T[]): T[] {
  return [...statuses].sort((a, b) => a.sortOrder - b.sortOrder);
}

/** "At the start" or "After {status}" — the Position select's value. */
export type StatusPosition = "start" | { after: string };

export const positionValue = (position: StatusPosition) => (position === "start" ? "start" : `after:${position.after}`);

export interface PositionOption {
  position: StatusPosition;
  /** The status this option puts the new one after; `null` for "At the start". */
  after: WorkflowStatus | null;
  /** The number the new status would take, or `null` when there is no whole number left between the two. */
  sortOrder: number | null;
}

/**
 * Every place a new status can go (§4.28, "Порядок колонок"): at the start —
 * half the first number — or after each status — halfway to the next, or ten
 * past the last. A gap with no whole number in it is offered as such rather
 * than renumbered: renumbering would move other columns, and the board sorts
 * columns across *every* workflow of the project (the gateway's merge, as
 * `buildMockBoard` plays it), so numbers far from the copy's 10/20/30 would put
 * a column beside the wrong neighbours. A workflow with no status at all takes
 * the shared step, 10.
 */
export function positionOptions(statuses: readonly WorkflowStatus[]): PositionOption[] {
  const ordered = statusesInColumnOrder(statuses);
  const first = ordered[0]?.sortOrder;
  const start: PositionOption = {
    position: "start",
    after: null,
    sortOrder: first === undefined ? SORT_ORDER_STEP : first <= 0 ? null : Math.floor(first / 2),
  };
  return [
    start,
    ...ordered.map((status, index) => {
      const next = ordered[index + 1]?.sortOrder;
      const sortOrder =
        next === undefined
          ? status.sortOrder + SORT_ORDER_STEP
          : next - status.sortOrder < 2
            ? null
            : Math.floor((status.sortOrder + next) / 2);
      return { position: { after: status.id }, after: status, sortOrder };
    }),
  ];
}

/**
 * Where a new status of this category goes unless the reader says otherwise:
 * the end of its category — after the last status whose rank is not above the
 * chosen one's, or at the start when there is none. Only the three known
 * categories are ranked, so a status of any other category is passed over, and
 * a new status of any other category goes after the last status. A default
 * with no room left falls back to after the last status, which always has room.
 */
export function defaultPosition(statuses: readonly WorkflowStatus[], category: string): StatusPosition {
  const options = positionOptions(statuses);
  const ordered = statusesInColumnOrder(statuses);
  const last = ordered.at(-1);
  const rank = rankOf(category);
  let anchor: WorkflowStatus | undefined;
  if (rank === undefined) anchor = last;
  else {
    anchor = ordered.filter((status) => {
      const statusRank = rankOf(status.category);
      return statusRank !== undefined && statusRank <= rank;
    }).at(-1);
  }
  const chosen: StatusPosition = anchor ? { after: anchor.id } : "start";
  const option = options.find((item) => positionValue(item.position) === positionValue(chosen));
  if (option && option.sortOrder !== null) return chosen;
  return last ? { after: last.id } : "start";
}

/**
 * A new transition's number: ten past the highest of **every** transition of
 * the workflow as the list sent it, the hidden ones included. The context
 * carries no hidden transition, so a number taken from it could land on one and
 * be refused as a duplicate (§4.28).
 */
export function nextTransitionSortOrder(transitions: readonly Pick<WorkflowDefinitionTransition, "sortOrder">[]): number {
  if (!transitions.length) return SORT_ORDER_STEP;
  return Math.max(...transitions.map((transition) => transition.sortOrder)) + SORT_ORDER_STEP;
}

/** The transition between these two statuses, hidden or not — the pair the server keeps unique. */
export function transitionBetween(workflow: WorkflowDefinition, fromStatusId: string, toStatusId: string) {
  return workflow.transitions.find(
    (transition) => transition.fromStatusId === fromStatusId && transition.toStatusId === toStatusId,
  );
}

/**
 * The From and To an Add transition form opens with (§4.28). A status this
 * dialog added that nothing on the board leads to yet comes first — it is the
 * one the reader is about to connect — with the status before it as From.
 * Otherwise the first status, and the first one it has no transition to.
 */
export function defaultTransitionPair(
  workflow: WorkflowDefinition,
  addedStatusIds: readonly string[],
): { fromStatusId: string; toStatusId: string } {
  const ordered = statusesInColumnOrder(workflow.statuses);
  const unreached = unreachedStatusIds(workflow);
  const added = ordered.find((status) => addedStatusIds.includes(status.id) && unreached.has(status.id));
  if (added) {
    const index = ordered.indexOf(added);
    const before = ordered[index - 1] ?? ordered.find((status) => status.id !== added.id);
    if (before) return { fromStatusId: before.id, toStatusId: added.id };
  }
  const from = ordered[0];
  if (!from) return { fromStatusId: "", toStatusId: "" };
  return { fromStatusId: from.id, toStatusId: firstTargetFrom(workflow, from.id) };
}

/** The first status, after `fromStatusId` itself, it has no transition to — or the first other status when it has one to all. */
export function firstTargetFrom(workflow: WorkflowDefinition, fromStatusId: string): string {
  const others = statusesInColumnOrder(workflow.statuses).filter((status) => status.id !== fromStatusId);
  return (others.find((status) => !transitionBetween(workflow, fromStatusId, status.id)) ?? others[0])?.id ?? "";
}

/**
 * The statuses, other than `TODO`, that no transition the board offers leads
 * to: a column a card can only reach by being created in it, which nothing but
 * `TODO` is (§4.28).
 */
export function unreachedStatusIds(workflow: WorkflowDefinition): Set<string> {
  const reached = new Set(workflow.transitions.filter((transition) => !transition.hidden).map((transition) => transition.toStatusId));
  return new Set(
    workflow.statuses.filter((status) => status.statusKey !== "TODO" && !reached.has(status.id)).map((status) => status.id),
  );
}

/**
 * The transitions as the dialog lists them: grouped by the status they leave,
 * in column order, and by `sortOrder` inside a group. A transition leaving a
 * status the workflow does not list still shows, after the rest.
 */
export function transitionsInListOrder(workflow: WorkflowDefinition): WorkflowDefinitionTransition[] {
  const column = new Map(statusesInColumnOrder(workflow.statuses).map((status, index) => [status.id, index]));
  const columnOf = (transition: WorkflowDefinitionTransition) => column.get(transition.fromStatusId) ?? column.size;
  return [...workflow.transitions].sort((a, b) => columnOf(a) - columnOf(b) || a.sortOrder - b.sortOrder);
}

/**
 * The body of Create workflow: the shared default as the list sent it, every
 * status and every transition — hidden ones included, which only the list has
 * — with their keys, names, categories and numbers unchanged (§4.28). The copy
 * is not editable: the server accepts a workflow with no status or no visible
 * transition, and then the project's context answers 404 to every member; one
 * with no `TODO` puts new issues of its types outside their workflow on the board
 * (docs/ai/API-DIVERGENCE.md). A transition naming a status the shared
 * workflow does not list is sent with an empty key, for the server to refuse
 * in its own words rather than for this to guess one.
 */
export function workflowCopyInput(
  shared: WorkflowDefinition,
  name: string,
  issueTypes: readonly IssueTypeCode[],
): CreateProjectWorkflowInput {
  const keyOf = (statusId: string) => shared.statuses.find((status) => status.id === statusId)?.statusKey ?? "";
  return {
    name,
    issueTypes: [...issueTypes],
    statuses: shared.statuses.map(({ statusKey, name: statusName, category, sortOrder }) => ({
      statusKey,
      name: statusName,
      category,
      sortOrder,
    })),
    transitions: shared.transitions.map((transition) => ({
      fromStatusKey: keyOf(transition.fromStatusId),
      toStatusKey: keyOf(transition.toStatusId),
      name: transition.name,
      sortOrder: transition.sortOrder,
      hidden: transition.hidden,
    })),
  };
}

/**
 * The cards in the dialog's order: the project's own workflows by where the
 * board offers their first type (`allowedIssueTypes`), then the shared default
 * last. A type the board does not offer ranks after every one it does, and a
 * tie keeps the answer's order. Ordering only — no type is taken off a card.
 */
export function orderWorkflowEntries(
  entries: readonly ProjectWorkflowEntry[],
  boardTypes: readonly IssueTypeCode[],
): ProjectWorkflowEntry[] {
  const rank = (entry: ProjectWorkflowEntry) => {
    if (entry.shared) return Number.POSITIVE_INFINITY;
    const index = entry.issueTypes.length ? boardTypes.indexOf(entry.issueTypes[0]) : -1;
    return index === -1 ? boardTypes.length : index;
  };
  return [...entries].sort((a, b) => {
    const [first, second] = [rank(a), rank(b)];
    return first === second ? 0 : first < second ? -1 : 1;
  });
}

/** "Task", "Task and Bug", "Task, Bug and Story". */
export function andList(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

/**
 * A move button in the issue panel, and a transition row here (DESIGN.md §4.1,
 * TAS-382): the transition's name as the visible text, unchanged — or "Move to
 * {To}" for one with no name — and an accessible name that says where it
 * goes, "{name}, move to {To}". An admin names a transition, and a name can be
 * the same as a control of the panel's own: migration 0001 of backend PR #208
 * adds "Close". The target is what tells the two apart, so it is what the name
 * adds. A name that already says "Move to {To}", in any case, needs nothing
 * added, and gets no `aria-label` at all.
 */
export function transitionButtonLabel(name: string, toLabel: string): { text: string; ariaLabel: string | undefined } {
  const plain = `Move to ${toLabel}`;
  const text = name.trim() === "" ? plain : name;
  return {
    text,
    ariaLabel: text.trim().toLowerCase() === plain.toLowerCase() ? undefined : `${text.trim()}, move to ${toLabel}`,
  };
}

/** "Move …" — an edit's Position select, the current place included. */
export interface EditPositionOption<P> {
  position: P;
  /** The number the row would take there: its own for the place it is in, `null` where no whole number is free. */
  sortOrder: number | null;
  /** The place the row is in now — what the select opens on, and what sends no `sortOrder`. */
  current: boolean;
}

/**
 * Every place an existing status can move to (§4.28, Edit status): Add
 * status's positions computed among the **other** statuses, so the row does
 * not stand in its own way, with the place it is in now keeping its own
 * number. Every other number is a midpoint between two of the others, which
 * no status holds.
 */
export function statusEditPositions(
  statuses: readonly WorkflowStatus[],
  statusId: string,
): { options: (EditPositionOption<StatusPosition> & { after: WorkflowStatus | null })[]; current: StatusPosition } {
  const ordered = statusesInColumnOrder(statuses);
  const index = ordered.findIndex((status) => status.id === statusId);
  const self = ordered[index];
  const before = index > 0 ? ordered[index - 1] : undefined;
  const current: StatusPosition = before ? { after: before.id } : "start";
  const options = positionOptions(ordered.filter((status) => status.id !== statusId)).map((option) => {
    const here = positionValue(option.position) === positionValue(current);
    return { ...option, sortOrder: here && self ? self.sortOrder : option.sortOrder, current: here };
  });
  return { options, current };
}

/** "First" or "After {transition}" among the moves leaving the same status — an edit's Position select value. */
export type TransitionPosition = "first" | { after: string };

export const transitionPositionValue = (position: TransitionPosition) =>
  position === "first" ? "first" : `after:${position.after}`;

/**
 * Every place an existing transition can move to among the transitions that
 * leave the same status — the order of the move buttons on an issue in that
 * status (§4.1). `sortOrder` is unique across **every** transition of the
 * workflow, hidden ones included, so a place takes the free number nearest the
 * middle of its gap that no other transition holds — or `null` when the gap has
 * none. "First" counts from 0; after the last, ten past it. The place the row
 * is in keeps its own number. A transition alone in its group has one place.
 */
export function transitionEditPositions(
  workflow: Pick<WorkflowDefinition, "transitions">,
  transitionId: string,
): {
  options: (EditPositionOption<TransitionPosition> & { after: WorkflowDefinitionTransition | null })[];
  current: TransitionPosition;
} {
  const self = workflow.transitions.find((transition) => transition.id === transitionId);
  const siblings = [...workflow.transitions]
    .filter((transition) => self && transition.fromStatusId === self.fromStatusId)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const index = siblings.findIndex((transition) => transition.id === transitionId);
  const before = index > 0 ? siblings[index - 1] : undefined;
  const current: TransitionPosition = before ? { after: before.id } : "first";
  const others = siblings.filter((transition) => transition.id !== transitionId);
  const taken = new Set(workflow.transitions.filter((transition) => transition.id !== transitionId).map((t) => t.sortOrder));
  const places: { position: TransitionPosition; after: WorkflowDefinitionTransition | null; low: number | null; high: number | null }[] = [
    { position: "first", after: null, low: null, high: others[0]?.sortOrder ?? null },
    ...others.map((transition, at) => ({
      position: { after: transition.id } as TransitionPosition,
      after: transition,
      low: transition.sortOrder,
      high: others[at + 1]?.sortOrder ?? null,
    })),
  ];
  const options = places.map(({ position, after, low, high }) => {
    const here = transitionPositionValue(position) === transitionPositionValue(current);
    return {
      position,
      after,
      current: here,
      sortOrder: here && self ? self.sortOrder : freeSortOrderBetween(low, high, taken),
    };
  });
  return { options, current };
}

/**
 * A whole number strictly between `low` and `high` that `taken` does not hold:
 * the one nearest the midpoint, or `null` when there is none. No `low` counts
 * from 0 (half of `high`, as "At the start" does for a status); no `high` is ten
 * past `low`, or the first free number after that.
 */
export function freeSortOrderBetween(low: number | null, high: number | null, taken: ReadonlySet<number>): number | null {
  if (high === null) {
    let next = (low ?? 0) + SORT_ORDER_STEP;
    while (taken.has(next)) next += 1;
    return next;
  }
  const floor = low === null ? 0 : low + 1;
  const ceil = high - 1;
  if (floor > ceil) return null;
  const mid = low === null ? Math.floor(high / 2) : Math.floor((low + high) / 2);
  for (let step = 0; mid - step >= floor || mid + step <= ceil; step += 1) {
    for (const candidate of [mid - step, mid + step]) {
      if (candidate >= floor && candidate <= ceil && !taken.has(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * The status keys a refusal for issues names in `details.statusKeys` — the
 * statuses those issues sit in (issue-service, comma-joined and sorted) — or
 * none when the details did not come. Never read out of the message.
 */
export function namedStatusKeys(details: ErrorDetails | null): string[] {
  const named = details && Object.hasOwn(details, "statusKeys") ? details.statusKeys : "";
  return named
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
}

/**
 * The statuses whose issues a workflow delete has to map, after the server
 * refused it for issues: the statuses of `own` that `details.statusKeys`
 * names, in its column order. Since backend TAS-429 (A12) the delete moves
 * only the workflow's own statuses and the keys a mapping names, so every key
 * the refusal names is one of `own`'s; a key that is not would be a status
 * nothing here can map, and is left out rather than offered. Without the keys
 * there is nothing to map, and the refusal is said as one.
 */
export function statusesToMap(own: WorkflowDefinition, details: ErrorDetails | null): WorkflowStatus[] {
  const keys = namedStatusKeys(details);
  return statusesInColumnOrder(own.statuses).filter((status) => keys.includes(status.statusKey));
}

/** `details.reason` of a delete refused for the issues it would leave behind (backend TAS-427). */
export const WORKFLOW_ISSUES_UNMAPPED_REASON = "WORKFLOW_ISSUES_UNMAPPED";

/** `details.reason` of a delete that would move more issues than one migration may (backend TAS-427). */
export const WORKFLOW_MIGRATION_LIMIT_REASON = "WORKFLOW_MIGRATION_LIMIT";

/**
 * Whether a delete was refused for the issues it would leave behind — issue-
 * service's 400 `FAILED_PRECONDITION` "Workflow statuses have N issues; supply
 * a target status mapping" — so that the strip can offer to move them. Read
 * off the code and `details.reason` `WORKFLOW_ISSUES_UNMAPPED` (backend
 * TAS-427, which also carries `issueCount`, `statusKeys` and
 * `targetStatusKeys`), never the message: the two deletes have other
 * `FAILED_PRECONDITION`s ("Default workflow is not usable", the migration
 * limit, an archived project), and each is said as the refusal it is.
 */
export function isIssueCountRefusal(error: unknown): boolean {
  return hasRefusalReason(error, "FAILED_PRECONDITION", WORKFLOW_ISSUES_UNMAPPED_REASON);
}

/**
 * Whether a delete was refused because it would move more issues than one
 * synchronous migration may — 400 `FAILED_PRECONDITION`, `details.reason`
 * `WORKFLOW_MIGRATION_LIMIT` with the `limit` (backend TAS-427; it was a 429
 * `RESOURCE_EXHAUSTED` before). Not a rate limit: trying again later does not
 * help, and no mapping does either.
 */
export function isMigrationLimitRefusal(error: unknown): boolean {
  return hasRefusalReason(error, "FAILED_PRECONDITION", WORKFLOW_MIGRATION_LIMIT_REASON);
}

/** `details.limit` of the migration-limit refusal as a number when it came as a whole one, else `null`. */
export function migrationLimitOf(error: unknown): number | null {
  const { details } = apiErrorFacts(error);
  const limit = details && Object.hasOwn(details, "limit") ? details.limit : "";
  return /^\d+$/.test(limit) ? Number(limit) : null;
}

/**
 * The status keys an unmapped refusal offers as targets, `details.targetStatusKeys`
 * (backend TAS-427, comma-joined): for a status delete the statuses the
 * workflow keeps, for a workflow delete the shared default's statuses this
 * workflow also has, in the default's order. Empty when the details named
 * none — for a workflow delete, that is "no status in common".
 */
export function targetStatusKeysOf(error: unknown): string[] {
  const { details } = apiErrorFacts(error);
  const named = details && Object.hasOwn(details, "targetStatusKeys") ? details.targetStatusKeys : "";
  return named
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
}

/** `details.issueCount` as a number when it came as a whole one, else `null`. */
export function issueCountOf(error: unknown): number | null {
  const { details } = apiErrorFacts(error);
  const count = details && Object.hasOwn(details, "issueCount") ? details.issueCount : "";
  return /^\d+$/.test(count) ? Number(count) : null;
}

/**
 * The list with `answer`'s workflow in the place of the entry it answers for —
 * an edit's whole `ProjectWorkflowDto` (backend PR #225) — or `null` when no
 * entry has its id, which leaves the caller to read the list again. The
 * entry keeps the list's `issueTypes`: an edit never changes a binding, and
 * the answer's come from an unordered binding read where the list's are TASK,
 * BUG, STORY — the order the chips are drawn in and the cards are ranked by
 * (`orderWorkflowEntries`).
 */
export function withWorkflowEntry(
  list: readonly ProjectWorkflowEntry[],
  answer: ProjectWorkflowEntry,
): ProjectWorkflowEntry[] | null {
  const index = answer.workflow.id ? list.findIndex((entry) => entry.workflow.id === answer.workflow.id) : -1;
  if (index === -1) return null;
  return list.map((entry, at) => (at === index ? { ...answer, issueTypes: entry.issueTypes } : entry));
}

/** "1 issue", "12 issues". */
export const issueCountWords = (count: number) => `${count} ${count === 1 ? "issue" : "issues"}`;
