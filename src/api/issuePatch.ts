import type { DateOnly } from "../domain/types";
import { apiErrorFacts } from "./errors";
import type { UpdateIssueInput } from "./TaskaApi";

/**
 * `PATCH /issues/{issueId}` as every implementation of `TaskaApi` has to treat
 * it (backend TAS-215, develop `60d62ee`): which keys go on the wire, how the
 * version is spelled, and the refusals answered before a request is spent.
 *
 * Written once for the reason src/api/planningFields.ts gives: a rule the mock
 * and the REST adapter both apply has to live in one place, or the two drift and
 * the mock stops being able to prove anything. Each implementation throws its
 * own error class with the facts decided here.
 *
 * Every server behaviour below is a **code read** at `60d62ee` — the gateway's
 * `IssueMapper` and `GrpcIssueServiceClient`, issue-service's
 * `GrpcIssueService.patchIssue` and `IssuePatchServiceImpl` — and not a
 * measurement: no PATCH carrying a token has been sent to the stand yet.
 */

/** The nine keys `PatchIssueRequestDto` declares. Nothing else is ever sent. */
export const ISSUE_PATCH_KEYS = [
  "summary",
  "description",
  "priority",
  "assigneeId",
  "storyPoints",
  "startDate",
  "dueDate",
  "originalEstimateMinutes",
  "remainingEstimateMinutes",
] as const satisfies readonly (keyof UpdateIssueInput)[];

export type IssuePatchKey = (typeof ISSUE_PATCH_KEYS)[number];

/**
 * The merge-patch body: each whitelisted key whose value is not `undefined`,
 * copied as it is — `null` stays `null` (clear it), `0` stays `0`.
 *
 * Copied by name rather than by spreading `input`, so an object wider than
 * `UpdateIssueInput` — a form state, a cached issue — cannot put a key on the
 * wire that the contract does not declare.
 */
export function issuePatchBody(input: UpdateIssueInput): Partial<Record<IssuePatchKey, unknown>> {
  const body: Partial<Record<IssuePatchKey, unknown>> = {};
  for (const key of ISSUE_PATCH_KEYS) {
    const value = input[key];
    if (value !== undefined) body[key] = value;
  }
  return body;
}

/** `If-Match` in the quoted ETag form. The gateway strips one pair of quotes and parses an int. */
export const ifMatch = (version: number) => `"${version}"`;

/** The ceiling `Integer.parseInt` accepts, which is what reads `If-Match` at the gateway. */
const IF_MATCH_VERSION_MAX = 2_147_483_647;

/** The gateway's sentence for an `If-Match` it cannot parse (`IssueMapper.parseIfMatchVersion`), on 400 `BAD_REQUEST`. */
export const IF_MATCH_UNPARSEABLE_MESSAGE = "If-Match header must contain a valid integer issue version";
/** issue-service's sentence for a version below 1 (`requirePositiveOrInvalidArgument`), on 400 `INVALID_ARGUMENT`. */
export const IF_MATCH_NOT_POSITIVE_MESSAGE = "body.version must be positive";
/** issue-service's sentence for a blank `summary` (`requireNonBlankOrInvalidArgument`), on 400 `INVALID_ARGUMENT`. */
export const BLANK_SUMMARY_MESSAGE = "body.summary must not be blank";

/** A refusal as a fact, so mock and rest can each throw it as their own error. Always on 400. */
export interface IssuePatchRefusal {
  code: "INVALID_ARGUMENT" | "BAD_REQUEST";
  message: string;
}

/**
 * Why this version cannot be sent, or `null`. Two layers refuse, with two
 * answers: something `Integer.parseInt` will not take — a fraction, `NaN`, a
 * number past `int32` — fails at the gateway as a `ResponseStatusException`
 * (`BAD_REQUEST`); a whole number below 1 reaches issue-service and fails its
 * gRPC validation (`INVALID_ARGUMENT`). Neither can be a version the server
 * holds, so neither is worth a request.
 */
export function issueVersionRefusal(version: number): IssuePatchRefusal | null {
  if (!Number.isInteger(version) || version > IF_MATCH_VERSION_MAX) {
    return { code: "BAD_REQUEST", message: IF_MATCH_UNPARSEABLE_MESSAGE };
  }
  if (version < 1) return { code: "INVALID_ARGUMENT", message: IF_MATCH_NOT_POSITIVE_MESSAGE };
  return null;
}

/**
 * A `summary` that is present and blank. Validated by issue-service before it
 * looks the issue up, so it is refused even for an issue that does not exist.
 * An absent `summary` is fine: the patch leaves it alone.
 */
export function blankSummaryRefusal(input: UpdateIssueInput): IssuePatchRefusal | null {
  if (input.summary !== undefined && input.summary.trim() === "") {
    return { code: "INVALID_ARGUMENT", message: BLANK_SUMMARY_MESSAGE };
  }
  return null;
}

/**
 * The server's own sentence when the merged pair is out of order —
 * `IssuePatchServiceImpl.validateStartNotAfterDue`, which lays the request's
 * dates over the stored ones and compares the result. `LocalDate` prints as
 * `YYYY-MM-DD`, which is what `DateOnly` already is.
 *
 * The mock throws exactly this, so that the one place that reads it — the issue
 * panel, which turns it into advice (`planningDateOrderAdvice` in
 * src/lib/planning.ts) — is exercised by the same words in both modes.
 */
export const datesOutOfOrderServerMessage = (start: DateOnly, due: DateOnly) =>
  `Start date: ${start} must not be after Due date: ${due}`;

const DATES_OUT_OF_ORDER = /^Start date: \d{4}-\d{2}-\d{2} must not be after Due date: \d{4}-\d{2}-\d{2}$/;

/**
 * Whether a write was refused because its dates, merged with the stored ones,
 * are out of order. Matched on the code and the whole sentence: this is a branch
 * keyed on server prose, which is fragile by nature, so it matches only the
 * sentence that was read and nothing near it — a reworded refusal falls through
 * to being printed as it came, which is still true.
 */
export function isDatesOutOfOrderRefusal(error: unknown): boolean {
  const { code, message } = apiErrorFacts(error);
  return code === "INVALID_ARGUMENT" && message !== null && DATES_OUT_OF_ORDER.test(message);
}
