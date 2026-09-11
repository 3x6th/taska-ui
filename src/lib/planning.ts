import type { PlanningFields, PlanningFieldsInput } from "../api/planningFields";

/**
 * How the five planning fields read and how they are typed back — the display
 * half of `src/api/planningFields.ts`, and deliberately nothing more.
 *
 * **This module states no rules.** Every refusal lives in
 * `planningFieldRefusal`, which every implementation of `TaskaApi` applies
 * before the wire, and the whole point of parsing here is to hand that function
 * a number it can judge. So a draft the reader has garbled comes out as `NaN`
 * rather than as a local error message: `NaN` is refused one layer down with
 * that layer's own sentence, and the alternative — a second copy of the bounds
 * in a component — is two rulebooks that drift.
 *
 * Two conversions and one asymmetry:
 *
 * - **Story points** are `format: double` (docs/contract/openapi.yml, backend
 *   develop `21a0d9d177a1`, merged PR #148), so `1.5` is a legal value and the
 *   draft is printed and read as a plain decimal. `0` is a count, never an
 *   absence, which is why every branch here tests against `null` and never for
 *   truthiness.
 * - **Estimates** are `int32` minutes on the wire and a duration to the reader.
 *   Hours and minutes only — `8h`, `1h 30m`, `45m`, `0m`. No days: the length
 *   of a working day is a policy this product has not set, and dividing by
 *   eight would invent one.
 * - **Dates** are `format: date` — `DateOnly`, a calendar day and not a moment
 *   — so they are carried verbatim in both directions. `<input type="date">`
 *   already holds exactly `YYYY-MM-DD`, so there is nothing to convert and
 *   deliberately no `Date` anywhere in this file: constructing one would put a
 *   timezone between the reader and the day they picked.
 */

/** What an empty field shows instead of a value. Never `0` — see `planningDrafts`. */
export const PLANNING_EMPTY_PLACEHOLDER = "—";

/**
 * The five as the inputs hold them: display strings, `""` for "not set".
 *
 * Strings rather than the values themselves because a half-typed `1.` and a
 * half-typed `1h ` are states the reader is allowed to be in, and a draft that
 * round-tripped through a number could not hold either.
 */
export interface PlanningDrafts {
  storyPoints: string;
  startDate: string;
  dueDate: string;
  originalEstimateMinutes: string;
  remainingEstimateMinutes: string;
}

/**
 * Minutes as a duration a reader can act on. `0` is `0m` and not empty — the
 * one distinction this whole feature is about.
 *
 * A value that is neither whole nor non-negative cannot be stored (`int32`,
 * `minimum: 0`, and `planningFieldRefusal` refuses both on the way out), so
 * there is no correct rendering to choose for one. It is printed as bare
 * minutes rather than dressed up as hours: visibly odd beats plausibly wrong.
 */
export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes)) return "";
  if (!Number.isInteger(minutes) || minutes < 0) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

/** `2h`, `2h30m`, `2h 30m`, `30m`, `1.5h`, and a bare number of minutes. Case and spaces free. */
const DURATION_PATTERN = /^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+(?:\.\d+)?)\s*m)?$/i;

/** A bare number, which means minutes. The sign is accepted so that `-5` is refused *as a negative*. */
const BARE_NUMBER_PATTERN = /^-?\d+(?:\.\d+)?$/;

/**
 * A duration draft as minutes: `null` for an empty field — which means *clear
 * it* — and `NaN` for anything this does not understand.
 *
 * `NaN` is a return value rather than a failure on purpose. It reaches
 * `planningFieldRefusal` as a number that is not a whole count of minutes and
 * comes back as `ESTIMATE_WHOLE_MINUTES_MESSAGE`, which is the true sentence
 * about `abc` as well as about `30.5`: neither is a number of minutes this wire
 * can carry. The same goes for `1d` — days are not a unit here (see the module
 * comment), so the draft is not understood rather than silently multiplied.
 */
export function parseDuration(draft: string): number | null {
  const text = draft.trim();
  if (!text) return null;
  if (BARE_NUMBER_PATTERN.test(text)) return Number(text);
  const match = DURATION_PATTERN.exec(text);
  // Both groups optional, so the pattern also matches the empty string and a
  // lone separator; a draft that named no unit at all is not a duration.
  if (!match || (match[1] === undefined && match[2] === undefined)) return Number.NaN;
  const total = (match[1] === undefined ? 0 : Number(match[1])) * 60 + (match[2] === undefined ? 0 : Number(match[2]));
  // `1.55h` is 93 minutes exactly and `1.55 * 60` is 93.00000000000001, which
  // the estimate's whole-minutes rule would refuse for a reason that belongs to
  // binary floating point rather than to the value. Snapped only when the
  // distance is noise: `1.51h` is genuinely 90.6 and stays refusable.
  const rounded = Math.round(total);
  return Math.abs(total - rounded) < 1e-9 ? rounded : total;
}

/** Story points as the field shows them. `String` and not a formatter: `0` is `0`, `1.5` is `1.5`. */
export function formatStoryPoints(points: number): string {
  return Number.isFinite(points) ? String(points) : "";
}

/**
 * A story-points draft as a number: `null` for an empty field, `NaN` for
 * anything that is not a number.
 *
 * The empty check is not a convenience. `Number("")` is `0`, so without it
 * clearing the field would *set the value to nought* — and `0` is a legal count
 * here, so nothing downstream would notice.
 */
export function parseStoryPoints(draft: string): number | null {
  const text = draft.trim();
  if (!text) return null;
  return Number(text);
}

/**
 * The five of an issue as drafts. `null` becomes `""`, so an unset field shows
 * nothing and its placeholder says `—`; **`0` becomes `"0"`**, because a zero
 * estimate and a missing one are different answers and only one of them is
 * empty.
 */
export function planningDrafts(fields: PlanningFields | null | undefined): PlanningDrafts {
  return {
    storyPoints: fields == null || fields.storyPoints === null ? "" : formatStoryPoints(fields.storyPoints),
    startDate: fields?.startDate ?? "",
    dueDate: fields?.dueDate ?? "",
    originalEstimateMinutes:
      fields == null || fields.originalEstimateMinutes === null ? "" : formatDuration(fields.originalEstimateMinutes),
    remainingEstimateMinutes:
      fields == null || fields.remainingEstimateMinutes === null ? "" : formatDuration(fields.remainingEstimateMinutes),
  };
}

/**
 * The drafts as a **create** request carries them.
 *
 * An empty field is omitted, because on a create `undefined` and `null` mean
 * the same thing — there is no prior value to leave alone (see
 * `CreateIssueInput`). A field the reader typed is included even when it parses
 * to `NaN`: the form has no business deciding that `abc` is not a number when
 * `planningFieldRefusal` already says so, in a sentence the update path shows
 * too.
 */
export function planningInput(drafts: PlanningDrafts): PlanningFieldsInput {
  const input: PlanningFieldsInput = {};
  const storyPoints = parseStoryPoints(drafts.storyPoints);
  if (storyPoints !== null) input.storyPoints = storyPoints;
  const startDate = drafts.startDate.trim();
  if (startDate) input.startDate = startDate;
  const dueDate = drafts.dueDate.trim();
  if (dueDate) input.dueDate = dueDate;
  const originalEstimateMinutes = parseDuration(drafts.originalEstimateMinutes);
  if (originalEstimateMinutes !== null) input.originalEstimateMinutes = originalEstimateMinutes;
  const remainingEstimateMinutes = parseDuration(drafts.remainingEstimateMinutes);
  if (remainingEstimateMinutes !== null) input.remainingEstimateMinutes = remainingEstimateMinutes;
  return input;
}

/**
 * Whether two draft sets say the same thing, which is what the panel's
 * reseed-on-render test needs (DESIGN.md §6: on render, never from an effect,
 * because an effect costs a pass on every refetch and a `key` would drop focus
 * mid-edit). Written as a field-by-field comparison rather than by serialising
 * both sides, so adding a sixth field fails the typecheck instead of quietly
 * passing.
 */
export function samePlanningDrafts(a: PlanningDrafts, b: PlanningDrafts): boolean {
  return (
    a.storyPoints === b.storyPoints &&
    a.startDate === b.startDate &&
    a.dueDate === b.dueDate &&
    a.originalEstimateMinutes === b.originalEstimateMinutes &&
    a.remainingEstimateMinutes === b.remainingEstimateMinutes
  );
}
