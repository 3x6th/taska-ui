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
 * It is ten refusals, a resolution rule and a body-shaping rule, and mock and
 * rest have to agree on every one of them or they stop being interchangeable on
 * exactly the input this story is about (AGENTS.md, *Frontend constraints*). The
 * one thing the two cannot share is the error class — `MockApiError` carries a
 * code, `ApiError` carries a code and an HTTP status — so this module decides
 * *what* is refused and each implementation throws its own error with it.
 *
 * ## What the server does, measured rather than read off the contract
 *
 * `IssueServiceImpl.updateIssue` on backend `develop` (TAS-115, already merged;
 * read at `ref=develop` on 2026-09-06) writes all five fields unconditionally:
 *
 * ```java
 * updatingIssue.setStoryPoints(storyPoints);
 * updatingIssue.setStartDate(startDate);
 * …
 * ```
 *
 * The proto fields are `optional`, the gateway sets each one through
 * `setIfPresent` (`IssueMapper`, backend PR #148), and
 * `GrpcIssueService.updateIssue` resolves every unset optional with
 * `.orElse(null)`. So **`PUT /issues/{id}` is a full replace: a field the
 * request omits is erased, not preserved.** The backend's own integration test
 * names it — «Частичное обновление — непереданные planning fields затираются».
 *
 * That is why `resolvePlanningFields` exists and why deleting the re-read that
 * feeds it silently destroys user data. See `UpdateIssueInput` in
 * src/api/TaskaApi.ts for the caller-facing half of the same sentence.
 *
 * ## The refusals
 *
 * All ten are `INVALID_ARGUMENT` / `400`, and all ten are applied on this side
 * of the wire so a request that cannot succeed is never spent. Five reproduce a
 * rule the server states — the negative bounds, the date format, the two dates
 * against each other, and the stored-date cross-check. The other five exist
 * because the server's answer to the input is *worse* than a refusal: it stores
 * something else, or it raises, or it fails to bind the body at all and answers
 * with a message about JSON.
 *
 * - **negative story points or a negative estimate** —
 *   `GrpcRequestValidators.requireOptionalPositiveZeroOrInvalidArgument`, which
 *   refuses `value < 0`. Note the mismatch: its message says "must be positive"
 *   while it enforces `>= 0`, so **`0` is accepted** and is a count, not an
 *   absence. The server's wording is deliberately *not* reproduced here for that
 *   reason — it describes a rule the server does not have.
 * - **a malformed or impossible date** — refused by `LocalDate` binding in the
 *   gateway's own request body, *before* gRPC, so the message a REST caller
 *   would see is Spring's rather than the validator's
 *   ("Invalid date format, expected ISO yyyy-MM-dd"). Nothing here reproduces
 *   either: the wording below is this client's own.
 * - **an estimate that is not a whole number** — same class as the date: the
 *   DTO's field is an `Integer` (`openapi-generator-maven-plugin` in
 *   `api-gateway/pom.xml` generates it from the contract's `format: int32`), so
 *   this is decided by the gateway's body binding and not by any rule the
 *   services state. What that binding does with `30.5` has **not** been observed
 *   and cannot be yet: no deployed gateway accepts these fields, so no
 *   fractional estimate has ever been sent to one. It does not need to be
 *   observed either, because both of the two possible answers make refusing
 *   locally right — either the mapper coerces the value and stores `30`, which
 *   is a number the reader did not type arriving back with no error anywhere,
 *   or it refuses the body, which is a `400` carrying a deserialisation message
 *   written for a Java developer. Which of the two it is, this module
 *   deliberately does not claim: the gateway is on **Jackson 3**
 *   (`tools.jackson.databind` in `IssueMapper`, under Spring Boot 4.0.3) and
 *   sets no `spring.jackson` block in its `application.yml`, so the answer is
 *   whatever that stack defaults to — and a remembered Jackson 2 default is not
 *   evidence about it.
 * - **an estimate that will not fit an `int32`** — the same binding, one bound
 *   further out, and the only refusal here that a form can reach by accident.
 *   `2147483647` is the ceiling in all three places the field is described:
 *   `format: int32` in the pending contract (backend PR #148), `optional int32
 *   original_estimate_minutes` in `issue-service.proto`, and `integer` in the
 *   column (`0007-issue-planing-fields.sql`). A JSON number above it cannot go
 *   into the DTO's `Integer` at all — that is the Java type, not a mapper
 *   setting — so the gateway fails to bind the body and
 *   `requireOptionalPositiveZeroOrInvalidArgument` never runs. The reader would
 *   get a `400` about JSON rather than about estimates, which is why this is
 *   refused here in the estimate's own words.
 *
 *   There is deliberately no matching floor. `int32`'s is `-2147483648`, and
 *   every value below it is negative, so `< 0` already refuses the lot with a
 *   sentence that is true of them and more use than "will not fit". The
 *   asymmetry is the point rather than an omission.
 * - **`startDate` after `dueDate` in the same request** —
 *   `GrpcRequestValidators.requireStartDateBeforeDueDate`, and the database's
 *   own `issues_dates_chk` behind it.
 * - **the stored-date cross-check**, which the contract does not state at all
 *   and which is the reason the mock has to be handed the issue as it stands.
 *   `IssueServiceImpl` compares the *incoming* `startDate` against the
 *   **stored** `dueDate`, and the incoming `dueDate` against the **stored**
 *   `startDate`. Two consequences that are not obvious and are both reproduced
 *   below: moving `startDate` past the stored `dueDate` is refused *even when
 *   the same request clears `dueDate`*, and moving a whole start/due window
 *   later in one request is refused even though the new pair is internally
 *   consistent. Its server-side message has its two labels swapped — it prints
 *   the incoming start date under "Due date" — which is raised on TAS-116, so
 *   it is never shown verbatim.
 * - **story points outside 0…999.99, or beyond two decimals**, which no layer of
 *   the server states. The column is `numeric(5,2)`
 *   (`0007-issue-planing-fields.sql`): above 999.99 Postgres raises a numeric
 *   field overflow, which is a `500` and not something a client should provoke
 *   when it can see the value; beyond two decimals Postgres **rounds**, so
 *   `1.235` is accepted and stored as `1.23` — a value that is not the one the
 *   reader typed, arriving back on the next read with no error anywhere. Both
 *   are refused here, and the second is refused for the rounding rather than for
 *   a failure.
 * - **story points that are not a finite number.** `JSON.stringify` writes `NaN`
 *   and `Infinity` as `null`, and `null` on this wire means *clear the field*.
 *   So an unguarded `Number("")` from a form would not fail — it would silently
 *   erase the value it was trying to set.
 *
 * Only fields the caller actually supplied are checked. A value resolved from
 * the server passes through untouched, deliberately: validating the resolved
 * pair would mean an issue whose stored dates are already inconsistent could not
 * have its *summary* edited without this client refusing it, with this client's
 * message, about values the reader never typed. The server is free to refuse
 * that, and `apiErrorFacts` surfaces the answer.
 */

/** The largest value `numeric(5,2)` holds. Above it the database raises, not the validator. */
export const STORY_POINTS_MAX = 999.99;

/** `numeric(5,2)`'s scale. Beyond it Postgres rounds silently, which is why it is refused here. */
export const STORY_POINTS_DECIMALS = 2;

/**
 * The largest value an `int32` holds, and so the ceiling on both estimates —
 * `format: int32` in the contract, `int32` in the proto, `integer` in the
 * column. Above it the gateway cannot bind the body into the DTO's `Integer`,
 * so the answer is a binding failure before any validator, not a refusal.
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
 * The stored-date cross-check, in words a reader can act on. The server's own
 * sentence for this prints the incoming start date under the label "Due date"
 * and says nothing about what to do next, so these are ours — and the
 * advice in them is checked: two requests in this order do succeed, because each
 * one is compared against the record as the previous one left it.
 */
export const START_DATE_AFTER_STORED_DUE_MESSAGE =
  "The start date cannot be later than this issue's current due date — move the due date first";
export const DUE_DATE_BEFORE_STORED_START_MESSAGE =
  "The due date cannot be earlier than this issue's current start date — move the start date first";

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

/** The two dates of the issue *as stored*, which is what the server cross-checks against. */
export type StoredPlanningDates = Pick<PlanningFields, "startDate" | "dueDate">;

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
export function planningFieldRefusal(
  input: PlanningFieldsInput,
  stored: StoredPlanningDates | null,
): PlanningFieldRefusal | null {
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
    // Two server layers, in the order the server runs them. The gateway binds
    // the JSON number into the DTO's `Integer` first, so "not whole" and "will
    // not fit an int32" are both binding failures and both come before the
    // negative check, which is the gRPC validator's. `Number.isInteger` alone
    // would let 2_147_483_648 through — it is whole and it is not negative, and
    // the mock would then store and display a value REST could never send.
    if (!Number.isInteger(estimate)) return refuse(ESTIMATE_WHOLE_MINUTES_MESSAGE);
    if (estimate > ESTIMATE_MINUTES_MAX) return refuse(ESTIMATE_MAX_MESSAGE);
    // No `< -2_147_483_648` to match: everything below the int32 floor is
    // negative, and the line below already refuses it for the truer reason.
    if (estimate < 0) return refuse(ESTIMATE_NEGATIVE_MESSAGE);
  }

  // Last, because it is last on the server too: the gRPC validators run first
  // and `IssueServiceImpl` reads the stored row afterwards. `stored` is `null`
  // on a create, where there is no previous record to be compared with.
  if (stored !== null) {
    if (stored.dueDate !== null && startDate != null && startDate > stored.dueDate) {
      return refuse(START_DATE_AFTER_STORED_DUE_MESSAGE);
    }
    if (stored.startDate !== null && dueDate != null && dueDate < stored.startDate) {
      return refuse(DUE_DATE_BEFORE_STORED_START_MESSAGE);
    }
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
 * What the request must actually carry: the caller's value where it stated one,
 * the issue's current value where it did not.
 *
 * **This is the compensation for the full replace, and it is not redundant.**
 * A future reader who deletes it — or who deletes the `getIssue` that produces
 * `current` — turns every partial edit in the app into a write that erases the
 * four or five fields it did not mention. `undefined` is resolved to `current`;
 * `null` stays `null` and is then omitted from the body by
 * `planningFieldsBody`, which is how this wire spells "clear it".
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
 * The resolved five as JSON body keys — **every `null` omitted**, because
 * omission is the only way this contract spells "not set". A `null` on the wire
 * would arrive as a Java `null`, be skipped by `setIfPresent`, and clear the
 * field, so the two spellings happen to agree today; the key is omitted anyway,
 * so nothing depends on that coincidence surviving a mapper change.
 *
 * A consequence worth stating, because it is what makes this change safe to ship
 * before backend PR #148 deploys: against today's gateway every one of these
 * resolves to `null` — the reads carry no planning fields — so the body is
 * exactly `{summary, description, priority}` and not one request byte changes.
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
