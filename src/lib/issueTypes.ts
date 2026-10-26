import { apiErrorFacts } from "../api/errors";
import {
  ISSUE_TYPE_CODE_MAX_LENGTH,
  ISSUE_TYPE_COLORS,
  ISSUE_TYPE_IN_USE_REASON,
  LAST_ISSUE_TYPE_REASON,
} from "../api/issueTypes";
import type { IssueTypeColor, ProjectIssueType } from "../domain/types";

/**
 * The Issue types dialog's rules that are not drawing (DESIGN.md §4.30,
 * TAS-417): what one press of a move button sends, how a code is spelled, what
 * a new type starts as, and how a refused delete is worded. Pure, so each is
 * tested on its own.
 */

/**
 * The full order of codes one press of Move up / Move down asks for (§4.30,
 * backend TAS-418): the registry as it stands on screen with the type at
 * `index` swapped with its neighbour — the body of one `PUT …/order`. `null`
 * at the list's ends, where the button is unavailable and nothing is sent.
 *
 * `registry` is in the server's order, which is the order on screen; it is
 * never re-sorted here.
 */
export function movedIssueTypeCodes(
  registry: readonly ProjectIssueType[],
  index: number,
  direction: "up" | "down",
): string[] | null {
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || index >= registry.length || target < 0 || target >= registry.length) return null;
  const codes = registry.map((entry) => entry.code);
  [codes[index], codes[target]] = [codes[target], codes[index]];
  return codes;
}

/**
 * The registry in the order of `codes`, numbered 10, 20, 30… as the server
 * numbers it on a reorder — the optimistic frame of a move, which the answer
 * then replaces. An entry `codes` does not name keeps its place after the
 * named ones; a code no entry holds is skipped. Neither happens for a list
 * `movedIssueTypeCodes` built from the same registry.
 */
export function withIssueTypeOrder(registry: readonly ProjectIssueType[], codes: readonly string[]): ProjectIssueType[] {
  const named = codes.flatMap((code) => registry.filter((entry) => entry.code === code).slice(0, 1));
  const rest = registry.filter((entry) => !codes.includes(entry.code));
  return [...named, ...rest].map((entry, position) => ({ ...entry, sortOrder: (position + 1) * 10 }));
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
 * The dialog's sentence for a refused delete (§4.30), branched on
 * `details.reason` and never on the server's prose (backend TAS-418):
 * `ISSUE_TYPE_IN_USE` names how many live issues have the type — "issues still
 * have this type" when `details.issueCount` does not parse; `LAST_ISSUE_TYPE`
 * is the last type; anything else — `PROJECT_ARCHIVED` included, whose §5.7
 * sentence is the caller's — is just "was not deleted". The server's words
 * and the request id go under it (§5.6), which is the caller's too.
 */
export function issueTypeDeleteRefusalText(error: unknown, name: string): string {
  const { details } = apiErrorFacts(error);
  if (details?.reason === ISSUE_TYPE_IN_USE_REASON) {
    const raw = details.issueCount;
    const count = typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : NaN;
    const who = !Number.isSafeInteger(count)
      ? "issues still have this type"
      : count === 1
        ? "1 issue has this type"
        : `${count} issues have this type`;
    return `${name} was not deleted: ${who}. Change their type first.`;
  }
  if (details?.reason === LAST_ISSUE_TYPE_REASON) {
    return `${name} was not deleted: a project needs at least one issue type.`;
  }
  return `${name} was not deleted.`;
}
