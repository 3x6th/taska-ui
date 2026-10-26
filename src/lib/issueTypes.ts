import { apiErrorFacts, isProjectArchived } from "../api/errors";
import { ISSUE_TYPE_CODE_MAX_LENGTH, ISSUE_TYPE_COLORS } from "../api/issueTypes";
import type { IssueTypeColor, ProjectIssueType } from "../domain/types";

/**
 * The Issue types dialog's rules that are not drawing (DESIGN.md §4.30,
 * TAS-417): where a moved type goes in one write, how a code is spelled, what a
 * new type starts as, and how a refused delete is worded. Pure, so each is
 * tested on its own.
 */

/** Where a move button sends a type, or why it cannot. */
export type ReorderPlan =
  /** The first row's Move up, the last row's Move down: unavailable, and nothing to explain. */
  | { kind: "edge" }
  /** One `PATCH {sortOrder}` puts the type at `index` among its new neighbours. */
  | { kind: "move"; sortOrder: number; index: number }
  /**
   * No whole number fits strictly between the new neighbours (or below the
   * first at ≥ 0), so the move would rest on the server's `code` tie-break or
   * need a renumbering — neither of which is one write (backend ask A1).
   * `other` is the neighbour it cannot pass; `instead` is the direction that
   * neighbour can move to make the same swap, when it can.
   */
  | { kind: "blocked"; other: ProjectIssueType; instead: "up" | "down" | null };

/**
 * One press of Move up / Move down as one `PATCH {sortOrder}` (§4.30): the
 * moved type gets a whole number **strictly** between its new neighbours —
 * `floor((prev + next) / 2)`; with no next one, `prev + 10`; to the top,
 * `next − 1` when that is still ≥ 0. Never a tie and never a renumbering of
 * the others: a tie would leave the order to the database's collation, and a
 * renumbering is a request per row (backend ask A1).
 *
 * `registry` is in the server's order, which is the order on screen.
 */
export function reorderPlan(
  registry: readonly ProjectIssueType[],
  index: number,
  direction: "up" | "down",
): ReorderPlan {
  const plan = placeBetween(registry, index, direction);
  if (plan.kind !== "blocked") return plan;
  const otherIndex = direction === "up" ? index - 1 : index + 1;
  const swap = placeBetween(registry, otherIndex, direction === "up" ? "down" : "up");
  return { ...plan, instead: swap.kind === "move" ? (direction === "up" ? "down" : "up") : null };
}

function placeBetween(registry: readonly ProjectIssueType[], index: number, direction: "up" | "down"): ReorderPlan {
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || index >= registry.length || target < 0 || target >= registry.length) return { kind: "edge" };
  // The neighbours the type will stand between once it has moved.
  const [prev, next] =
    direction === "up" ? [registry[index - 2], registry[index - 1]] : [registry[index + 1], registry[index + 2]];
  const other = registry[target];
  let sortOrder: number | null;
  if (!next) sortOrder = prev.sortOrder + 10;
  else if (!prev) sortOrder = next.sortOrder - 1 >= 0 ? next.sortOrder - 1 : null;
  else {
    const middle = Math.floor((prev.sortOrder + next.sortOrder) / 2);
    sortOrder = middle > prev.sortOrder && middle < next.sortOrder ? middle : null;
  }
  return sortOrder === null ? { kind: "blocked", other, instead: null } : { kind: "move", sortOrder, index: target };
}

/** The registry with one entry's `sortOrder` changed and moved to `index` — the optimistic order of a move. */
export function withMovedType(
  registry: readonly ProjectIssueType[],
  code: string,
  sortOrder: number,
  index: number,
): ProjectIssueType[] {
  const moved = registry.find((entry) => entry.code === code);
  if (!moved) return [...registry];
  const rest = registry.filter((entry) => entry.code !== code);
  rest.splice(Math.min(index, rest.length), 0, { ...moved, sortOrder });
  return rest;
}

/**
 * A code as it may be typed (§4.30): capitals, spaces and hyphens as `_`, and
 * nothing outside `[A-Z0-9_]` — so a Cyrillic name derives an empty code. Cut
 * at the 32 the server takes.
 */
export function issueTypeCodeOf(text: string): string {
  return text
    .toUpperCase()
    .replace(/[\s-]/g, "_")
    .replace(/[^A-Z0-9_]/g, "")
    .slice(0, ISSUE_TYPE_CODE_MAX_LENGTH);
}

/** A new type's colour: the first of the seven no type of this project wears yet, else `blue` (§4.30). */
export function defaultIssueTypeColor(registry: readonly ProjectIssueType[]): IssueTypeColor {
  return ISSUE_TYPE_COLORS.find((color) => !registry.some((entry) => entry.color === color)) ?? "blue";
}

/** A new type's `sortOrder`: the largest + 10, so it lands last (§4.30). 10 in an empty registry. */
export function nextIssueTypeSortOrder(registry: readonly ProjectIssueType[]): number {
  return registry.reduce((largest, entry) => Math.max(largest, entry.sortOrder), 0) + 10;
}

/**
 * The dialog's sentence for a refused delete (§4.30), branched on `details`
 * and never on the server's prose (backend ask A2): `PROJECT_ARCHIVED` is
 * §5.7's and is the caller's; a parsed `issueCount` names the number, deleted
 * issues included (backend ask A3); a count that does not parse still says
 * issues have the type; a `FAILED_PRECONDITION` with no details is the last
 * type; anything else is just "was not deleted".
 */
export function issueTypeDeleteRefusalText(error: unknown, name: string): string {
  const { code, details } = apiErrorFacts(error);
  if (details && Object.hasOwn(details, "issueCount")) {
    const raw = details.issueCount;
    const count = /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (Number.isSafeInteger(count)) {
      return count === 1
        ? `${name} was not deleted: 1 issue has this type, deleted issues included.`
        : `${name} was not deleted: ${count} issues have this type, deleted issues included.`;
    }
    return `${name} was not deleted: issues still have this type, deleted issues included.`;
  }
  if (code === "FAILED_PRECONDITION" && !details && !isProjectArchived(error)) {
    return `${name} was not deleted: a project needs at least one issue type.`;
  }
  return `${name} was not deleted.`;
}
