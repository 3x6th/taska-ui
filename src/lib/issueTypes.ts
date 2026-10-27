import { apiErrorFacts, hasRefusalReason } from "../api/errors";
import {
  ISSUE_STATUSES_UNMAPPED_REASON,
  ISSUE_TYPE_CHANGED_REASON,
  ISSUE_TYPE_CODE_MAX_LENGTH,
  ISSUE_TYPE_COLORS,
  ISSUE_TYPE_GENERATION_REQUIRED_REASON,
  ISSUE_TYPE_IN_USE_REASON,
  ISSUE_TYPE_TARGET_INVALID_REASON,
  ISSUE_TYPES_CHANGED_REASON,
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
 * `LAST_ISSUE_TYPE` is the last type; anything else — `PROJECT_ARCHIVED`
 * included, whose §5.7 sentence is the caller's — is just "was not deleted".
 * The server's words and the request id go under it (§5.6), which is the
 * caller's too. `ISSUE_TYPE_IN_USE` is not a refusal said here any more: since
 * backend TAS-433 it turns the strip into its move step
 * (`isIssueTypeInUse`).
 */
export function issueTypeDeleteRefusalText(error: unknown, name: string): string {
  const { details } = apiErrorFacts(error);
  if (details?.reason === LAST_ISSUE_TYPE_REASON) {
    return `${name} was not deleted: a project needs at least one issue type.`;
  }
  return `${name} was not deleted.`;
}

/** Whether a delete was refused for the live issues the type has — the move step's cue (backend TAS-418, TAS-433). */
export const isIssueTypeInUse = (error: unknown) =>
  hasRefusalReason(error, "FAILED_PRECONDITION", ISSUE_TYPE_IN_USE_REASON);

/** Whether a delete with a move was refused for issues in a status the target's workflow lacks (backend TAS-433). */
export const isIssueStatusesUnmapped = (error: unknown) =>
  hasRefusalReason(error, "FAILED_PRECONDITION", ISSUE_STATUSES_UNMAPPED_REASON);

/**
 * Whether a delete with a move was refused because the type is not the one the
 * dialog read — 409 `ABORTED` with `ISSUE_TYPE_CHANGED` (another generation) or
 * `ISSUE_TYPE_GENERATION_REQUIRED` (the code was made again) — so the strip
 * closes and the registry is read again (§4.30 «Отказы шага»).
 */
export const isIssueTypeReplaced = (error: unknown) =>
  hasRefusalReason(error, "ABORTED", ISSUE_TYPE_CHANGED_REASON) ||
  hasRefusalReason(error, "ABORTED", ISSUE_TYPE_GENERATION_REQUIRED_REASON);

/** Whether a delete with a move named a target that is no longer a type of the project (400 `INVALID_ARGUMENT`). */
export const isIssueTypeTargetInvalid = (error: unknown) =>
  hasRefusalReason(error, "INVALID_ARGUMENT", ISSUE_TYPE_TARGET_INVALID_REASON);

/** `details.issueCount` of an in-use refusal as a whole number, else `null`. */
export function inUseCountOf(error: unknown): number | null {
  const { details } = apiErrorFacts(error);
  const raw = details && Object.hasOwn(details, "issueCount") ? details.issueCount : "";
  return /^\d+$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : null;
}

/** "{N} issues have this type." / "1 issue has this type." / "Issues have this type." (§4.30). */
const haveThisType = (count: number | null) =>
  count === null ? "Issues have this type." : count === 1 ? "1 issue has this type." : `${count} issues have this type.`;

/**
 * The move step's sentence (§4.30 «Шаг переноса (тип)»): how many issues have
 * the type, and that they move to another type for it to go. A single issue
 * is "it", not "them" — DESIGN.md words only the plural.
 */
export const issueTypeMoveSentence = (count: number | null, name: string) =>
  `${haveThisType(count)} Move ${count === 1 ? "it" : "them"} to another type to delete ${name}.`;

/**
 * The step once the server named statuses the target's workflow lacks (§4.30
 * «Статусы»). The count is the in-use refusal's — `ISSUE_STATUSES_UNMAPPED`
 * carries none.
 */
export const issueTypeStatusesSentence = (count: number | null, target: string) =>
  count === 1
    ? `${haveThisType(count)} It is in a status ${target} issues cannot have, so choose where it goes.`
    : `${haveThisType(count)} Some are in a status ${target} issues cannot have, so choose where each status’s issues go.`;

/** The dialog's sentence for any refused move (§4.30); the server's words and the request id go under it. */
export const ISSUE_TYPE_ORDER_REFUSED_SENTENCE = "The new order was not saved. The list now shows the saved order.";
/** The sentence for a move refused because the registry changed elsewhere (§4.30, backend TAS-429). */
export const ISSUE_TYPES_CHANGED_SENTENCE =
  "Issue types changed elsewhere, so the new order was not saved. The list now shows the current types.";

/**
 * What the dialog says when a move is refused (§4.30): 409 `ABORTED` with
 * `details.reason` `ISSUE_TYPES_CHANGED` — a type added or deleted elsewhere
 * since the registry was read (backend TAS-429) — has its own sentence and
 * only the request id under it, since the server's words would only repeat it;
 * any other refusal the general sentence, with the server's words and the id.
 * Branched on the code **and** the reason, never on the prose: an `ABORTED`
 * without the reason, or the reason on another code, is any other refusal.
 * Either way the caller reads the context again.
 */
export function issueTypeOrderRefusal(error: unknown): { sentence: string; serverWords: boolean } {
  const { code, details } = apiErrorFacts(error);
  return code === "ABORTED" && details?.reason === ISSUE_TYPES_CHANGED_REASON
    ? { sentence: ISSUE_TYPES_CHANGED_SENTENCE, serverWords: false }
    : { sentence: ISSUE_TYPE_ORDER_REFUSED_SENTENCE, serverWords: true };
}
