import type { DateOnly } from "../domain/types";
import { isDateOnly } from "../domain/types";

/**
 * The five planning fields — story points, start and due dates, and the two
 * estimates — as every implementation of `TaskaApi` has to treat them.
 *
 * Why this is a module of its own rather than a guard duplicated per
 * implementation, which is what `requireSearchQuery` and
 * `requireAdminWriteReason` are: those are three lines each, and the interesting
 * half of them is a constant already shared through `TaskaApi.ts`. This is not.
 * It is eight refusals, a resolution rule and a body-shaping rule, and mock and
 * rest have to agree on every one of them or they stop being interchangeable on
 * exactly the input this module is about (AGENTS.md, *Frontend constraints*).
 * The one thing the two cannot share is the error class — `MockApiError`
 * carries a code, `ApiError` carries a code and an HTTP status — so this module
 * decides *what* is refused and each implementation throws its own error with
 * it.
 *
 * ## Two writes, two shapes
 *
 * **An edit is `PATCH /issues/{issueId}`** since TAS-246 (backend TAS-215,
 * develop `60d62ee`): a merge patch, where an absent key is left alone and a
 * `null` clears the field. Nothing has to be re-sent, so nothing is read first,
 * and `issuePatchBody` in src/api/issuePatch.ts shapes that body. The client
 * used to edit through `PUT`, a full replace that erased whatever the request
 * omitted, and paid for it with a read before every write; that route is
 * deprecated and no longer called.
 *
 * **A create is `POST /projects/{projectId}/issues`**, where there is nothing
 * to leave alone, so `null` and `undefined` mean the same thing and
 * `resolvePlanningFields` + `planningFieldsBody` shape the body.
 *
 * ## The refusals
 *
 * All eight are `INVALID_ARGUMENT` / `400`, decided by the caller's own input
 * alone, and applied on this side of the wire so a request that cannot succeed
 * is never spent.
 *
 * Three of them reproduce a rule the server states. The other five exist
 * because the server's answer to the input is *worse* than a refusal: it stores
 * something else, or it raises, or it fails to bind the body at all and answers
 * with a message about JSON.
 *
 * - **negative story points or a negative estimate** — on a create,
 *   `GrpcRequestValidators.requireOptionalPositiveZeroOrInvalidArgument`, which
 *   refuses `value < 0` with a message saying "must be positive" while it
 *   enforces `>= 0`; on a PATCH, the gateway's own `toNullableMinutes`
 *   (`IssueMapper`, read at `60d62ee`) answers **400 `BAD_REQUEST`**
 *   "originalEstimateMinutes must not be negative" for an estimate, and
 *   issue-service's nullable parser "must be positive or zero" for story
 *   points. **`0` is accepted** everywhere and is a count, not an absence. The
 *   server's wording is not reproduced, because there are three of it.
 * - **a malformed or impossible date** — the generated DTO's field is a
 *   `LocalDate` (`format: date` in the contract), so the gateway binds the
 *   string before gRPC sees it. What a REST caller sees for a string that does
 *   not bind has **not** been observed. The wording below is this client's own
 *   either way.
 * - **an estimate that is not a whole number, or will not fit an `int32`** —
 *   on a PATCH the gateway reads the number as a `BigDecimal` and refuses both
 *   with **400 `BAD_REQUEST`** "originalEstimateMinutes must be an integer
 *   number of minutes" (`IssueMapper.toNullableMinutes`, `intValueExact`, read
 *   at `60d62ee`) — a code read, not a measurement. On a create the DTO's field
 *   is an `Integer`, so the answer is whatever the gateway's Jackson 3 body
 *   binding does with `30.5` or `2147483648`, which has not been observed;
 *   refusing locally is right under every possible answer, so it does not need
 *   to be. `2147483647` is the ceiling in the contract (`format: int32`), the
 *   proto and the column. There is deliberately no matching floor: every value
 *   below `int32`'s is negative, and `< 0` already refuses it for the truer
 *   reason.
 * - **`startDate` after `dueDate` in the same request** —
 *   `requireStartDateBeforeDueDate` on a create, `validateStartNotAfterDue` on
 *   a PATCH, and the database's own `issues_dates_chk` behind both.
 * - **story points outside 0…999.99, or beyond two decimals**, which no layer of
 *   the server states. The column is `numeric(5,2)`
 *   (`0007-issue-planing-fields.sql`): above 999.99 Postgres raises a numeric
 *   field overflow, so the write fails on a value the client could see was too
 *   large — which is the whole reason to refuse it here, whatever status the
 *   failure comes back as. That status is a *code read*: `500 INTERNAL`.
 *   `GrpcExceptionHandler` maps `R2dbcException` and `TransactionException` to
 *   `UNAVAILABLE`, but Spring Data R2DBC's `DatabaseClient` converts the
 *   driver's exception into a `DataAccessException` first, so neither matches
 *   and the catch-all answers `INTERNAL`. (Read at spring-r2dbc 7.0.5 and
 *   spring-data-r2dbc 4.0.3.) Beyond two decimals Postgres **rounds** instead
 *   of raising, so `1.235` would be stored as `1.23` with no error anywhere.
 * - **story points that are not a finite number.** `JSON.stringify` writes `NaN`
 *   and `Infinity` as `null`, and `null` on a PATCH means *clear the field*.
 *   So an unguarded `Number("")` from a form would not fail — it would silently
 *   erase the value it was trying to set.
 *
 * **What is no longer refused here: a date against the *stored* one.** The PUT
 * compared the incoming start date with the stored due date and vice versa, and
 * this module reproduced that before the request. On a PATCH the server lays
 * the request's dates over the stored ones and checks the merged pair *after*
 * the version check (`IssuePatchServiceImpl`), so a stale write is a conflict
 * before it is a date refusal, and refusing it here would answer a question the
 * server answers differently. Both implementations now leave it to the server,
 * whose sentence is `datesOutOfOrderServerMessage` in src/api/issuePatch.ts; the
 * issue panel turns it into advice the reader can act on (docs/ai/API-DIVERGENCE.md,
 * "Closed by TAS-246 on the `PATCH` path: the date cross-check compared against
 * stored values, and refused the ordinary case").
 *
 * **Eight is the count of what this module refuses, not of what the client
 * refuses, and the ninth could not have been written here** (TAS-231). A
 * date box the reader is only part-way through typing is refused before it ever
 * becomes a `PlanningFieldsInput` — `isIncompleteDateEntry` in
 * src/lib/planning.ts, with the two sentences the surfaces say. It has to be
 * refused up there because `<input type="date">` reports `value === ""` for a
 * half-typed day exactly as it does for an empty box, and `""` arrives here as
 * `null`, which is a legal request meaning *clear the date*.
 *
 * Only fields the caller actually supplied are checked. A stored value is never
 * re-validated: an issue whose stored dates are already inconsistent can still
 * have its summary edited, and the server is the one entitled to refuse that.
 */

/** The largest value `numeric(5,2)` holds. Above it the database raises, not the validator. */
export const STORY_POINTS_MAX = 999.99;

/** `numeric(5,2)`'s scale. Beyond it Postgres rounds silently, which is why it is refused here. */
export const STORY_POINTS_DECIMALS = 2;

/**
 * The largest value an `int32` holds, and so the ceiling on both estimates —
 * `format: int32` in the contract, `int32` in the proto, `integer` in the
 * column. Above it the value cannot be held by the DTO's `Integer`, so
 * `requireOptionalPositiveZeroOrInvalidArgument` never sees it. What the
 * gateway answers instead has not been observed — see the ceiling bullet above.
 */
export const ESTIMATE_MINUTES_MAX = 2_147_483_647;

export const STORY_POINTS_NUMBER_MESSAGE = "Story points must be a number";
export const STORY_POINTS_RANGE_MESSAGE = `Story points must be between 0 and ${STORY_POINTS_MAX}`;
export const STORY_POINTS_PRECISION_MESSAGE = `Story points are stored to ${STORY_POINTS_DECIMALS} decimal places`;
export const ESTIMATE_WHOLE_MINUTES_MESSAGE = "An estimate is a whole number of minutes";
/**
 * Named for the bound it states rather than `…_RANGE_MESSAGE`, because it is not
 * a range: it answers for the floor only, and `ESTIMATE_MAX_MESSAGE` answers for
 * the ceiling. The two are separate sentences because they are separate server
 * refusals — the floor is the gRPC validator's, the ceiling is the gateway's
 * body binding — and folding them into one range sentence the way story points
 * do would hide that, on top of putting a ten-digit number in front of every
 * reader who merely typed `-5`.
 */
export const ESTIMATE_NEGATIVE_MESSAGE = "An estimate cannot be negative";
export const ESTIMATE_MAX_MESSAGE = `An estimate cannot be more than ${ESTIMATE_MINUTES_MAX} minutes`;
export const DATE_FORMAT_MESSAGE = "A date must be a real calendar day, written as YYYY-MM-DD";
export const DATE_ORDER_MESSAGE = "The start date cannot be later than the due date";

/**
 * The five as a *request* carries them: `undefined` is "leave it alone",
 * `null` is "clear it", a value is "set it".
 *
 * Structurally the shared half of `CreateIssueInput` and `UpdateIssueInput`, so
 * both can be checked by the same function without a cast. On a create the two
 * spellings of nothing mean the same thing, because there is no prior value to
 * leave alone.
 */
export interface PlanningFieldsInput {
  storyPoints?: number | null;
  startDate?: DateOnly | null;
  dueDate?: DateOnly | null;
  originalEstimateMinutes?: number | null;
  remainingEstimateMinutes?: number | null;
}

/** The five as a *record* holds them: resolved, with `null` the only "not set". */
export interface PlanningFields {
  storyPoints: number | null;
  startDate: DateOnly | null;
  dueDate: DateOnly | null;
  originalEstimateMinutes: number | null;
  remainingEstimateMinutes: number | null;
}

/**
 * A refusal as a fact rather than as an exception, so one rule can be thrown as
 * `MockApiError` on one side and as `ApiError` on the other without either side
 * owning the rule.
 */
export interface PlanningFieldRefusal {
  code: "INVALID_ARGUMENT";
  message: string;
}

const refuse = (message: string): PlanningFieldRefusal => ({ code: "INVALID_ARGUMENT", message });

/** `null` when there is nothing to refuse, in the order the server applies its own checks. */
export function planningFieldRefusal(input: PlanningFieldsInput): PlanningFieldRefusal | null {
  const storyPoints = input.storyPoints;
  if (storyPoints !== undefined && storyPoints !== null) {
    if (!Number.isFinite(storyPoints)) return refuse(STORY_POINTS_NUMBER_MESSAGE);
    if (storyPoints < 0 || storyPoints > STORY_POINTS_MAX) return refuse(STORY_POINTS_RANGE_MESSAGE);
    // The value has to survive a round trip through the column's scale. Written
    // as arithmetic rather than by counting the characters after the dot, so a
    // value judged by what it *is* rather than by how it happens to print —
    // `0.1 + 0.2` is not two decimal places, whatever the field showed.
    const scale = 10 ** STORY_POINTS_DECIMALS;
    if (Math.round(storyPoints * scale) / scale !== storyPoints) return refuse(STORY_POINTS_PRECISION_MESSAGE);
  }

  const startDate = input.startDate;
  if (startDate !== undefined && startDate !== null && !isDateOnly(startDate)) return refuse(DATE_FORMAT_MESSAGE);

  const dueDate = input.dueDate;
  if (dueDate !== undefined && dueDate !== null && !isDateOnly(dueDate)) return refuse(DATE_FORMAT_MESSAGE);

  // Both stated in one request: compared to each other, exactly as
  // `requireStartDateBeforeDueDate` does. String comparison, because ISO dates
  // order as text and turning either into a `Date` is the trap `DateOnly`
  // exists to close.
  if (startDate != null && dueDate != null && startDate > dueDate) return refuse(DATE_ORDER_MESSAGE);

  for (const estimate of [input.originalEstimateMinutes, input.remainingEstimateMinutes]) {
    if (estimate === undefined || estimate === null) continue;
    // In the order the gateway runs them on a PATCH (`toNullableMinutes`):
    // whole first — `intValueExact` refuses a fraction and a value past int32
    // alike — and the sign after. On a create the DTO's `Integer` has to hold
    // the number before gRPC sees it, which gives the same order.
    // `Number.isInteger` alone would let 2_147_483_648 through: it is whole and
    // it is not negative, and the mock would then store and display a value
    // REST could never send.
    if (!Number.isInteger(estimate)) return refuse(ESTIMATE_WHOLE_MINUTES_MESSAGE);
    if (estimate > ESTIMATE_MINUTES_MAX) return refuse(ESTIMATE_MAX_MESSAGE);
    // No `< -2_147_483_648` to match: everything below the int32 floor is
    // negative, and the line below already refuses it for the truer reason.
    if (estimate < 0) return refuse(ESTIMATE_NEGATIVE_MESSAGE);
  }

  return null;
}

/** The five with nothing set — the state a create starts from, and a fresh object every time. */
export function emptyPlanningFields(): PlanningFields {
  return {
    storyPoints: null,
    startDate: null,
    dueDate: null,
    originalEstimateMinutes: null,
    remainingEstimateMinutes: null,
  };
}

/**
 * The caller's value where it stated one, `current`'s where it did not —
 * `undefined` resolves to `current`, `null` stays `null`.
 *
 * Two callers, and neither is the REST edit any more. A create resolves against
 * `emptyPlanningFields()`, which makes both spellings of nothing the same
 * `null`. The mock's PATCH resolves against the stored issue, which is the merge
 * a merge patch *is* — the same laying-over the server does before it checks
 * the dates (`IssuePatchServiceImpl`, `patch.applyTo(issue)`).
 *
 * It used to be the compensation for the edit's full-replace `PUT`, resolving
 * every field the caller had not mentioned from a read made just before the
 * write. PATCH removed the need, and the read with it.
 */
export function resolvePlanningFields(input: PlanningFieldsInput, current: PlanningFields): PlanningFields {
  return {
    storyPoints: input.storyPoints === undefined ? current.storyPoints : input.storyPoints,
    startDate: input.startDate === undefined ? current.startDate : input.startDate,
    dueDate: input.dueDate === undefined ? current.dueDate : input.dueDate,
    originalEstimateMinutes:
      input.originalEstimateMinutes === undefined ? current.originalEstimateMinutes : input.originalEstimateMinutes,
    remainingEstimateMinutes:
      input.remainingEstimateMinutes === undefined ? current.remainingEstimateMinutes : input.remainingEstimateMinutes,
  };
}

/**
 * The resolved five as a **create**'s JSON body keys — every `null` omitted,
 * because on a create omission and `null` mean the same "not set", and omission
 * is the spelling that does not depend on how the gateway's mapper reads a
 * `null`. Never used for an edit: a PATCH needs `null` on the wire to clear a
 * field, and `issuePatchBody` in src/api/issuePatch.ts keeps it.
 */
export function planningFieldsBody(fields: PlanningFields): Record<string, number | DateOnly> {
  const body: Record<string, number | DateOnly> = {};
  if (fields.storyPoints !== null) body.storyPoints = fields.storyPoints;
  if (fields.startDate !== null) body.startDate = fields.startDate;
  if (fields.dueDate !== null) body.dueDate = fields.dueDate;
  if (fields.originalEstimateMinutes !== null) body.originalEstimateMinutes = fields.originalEstimateMinutes;
  if (fields.remainingEstimateMinutes !== null) body.remainingEstimateMinutes = fields.remainingEstimateMinutes;
  return body;
}
