import { apiErrorFacts } from "../api/errors";
import { TaskQuotaAnswerError, type ProjectTaskQuota } from "../api/tenantMembers";
import { group } from "./digits";
import { isIndefinite } from "./intentKey";

/*
 * A project's issue counter in the companies build (TAS-528, DESIGN.md §4.43):
 * read only when Edit project or New issue opens, one read for one project,
 * under one key on the company session's query client — so the two dialogs
 * share it and nothing else asks (api-contract-guard B4). **It gates nothing**
 * (B2): New, every column's «+» and Create issue stay as they are at, below
 * and above the limit — the server refuses the create, and the form says its
 * refusal. **Never counted here** (B3): no `used + 1`, no board or card count;
 * after the reader's own create the cached counter is removed, after a quota
 * or restriction refusal it is read again.
 *
 * The words, as pure values so each is pinned by a unit test: one template
 * below, at and over the limit — no «full», «over», «left», percentage or
 * colour (art-director B3) — and the digits grouped from the decimal string
 * the server sent, never through `Number`.
 */

/** On the company client, so it carries no company (DESIGN.md §6). */
export const projectTaskQuotaKey = (projectId: string) => ["project-task-quota", projectId] as const;

/** The failure's sentence, in both dialogs (§5.6: a read failure, not live, no «Try again»). */
export const ISSUE_COUNT_READ_FAILED = "The issue count could not be loaded.";

/** Edit project's second line, under the count, limited or not (contracts §8). */
export const ISSUE_COUNT_NOTE = "Deleted issues still count.";

const allowed = (quota: ProjectTaskQuota) => (quota.unlimited || quota.limit === null ? "no limit" : `${group(quota.limit)} allowed`);

/** New issue's line: «47 issues created · 50 allowed», «1 issue created · 50 allowed», «312 issues created · no limit». */
export function newIssueCountText(quota: ProjectTaskQuota): string {
  return `${group(quota.used)} ${quota.used === "1" ? "issue" : "issues"} created · ${allowed(quota)}`;
}

/** Edit project's «Issues» value: «47 created · 50 allowed», «50 created · no limit». */
export function projectIssueCountText(quota: ProjectTaskQuota): string {
  return `${group(quota.used)} created · ${allowed(quota)}`;
}

/**
 * Whether a failed read leaves a value already shown in place (the guard's
 * addendum, rule 2): only an answer that never came or says nothing about the
 * request — no status, 408, 429, 5xx (`isIndefinite`). A definite answer — a
 * 4xx such as the concealed 404, a 403 the session layer does not handle, a
 * 400, an answer about another project or of another kind — drops it.
 */
export function keepsHeldCount(error: unknown): boolean {
  return !(error instanceof TaskQuotaAnswerError) && isIndefinite(error);
}

/**
 * One retry, only for an answer that never came — never for a refusal, which
 * says the same the second time, and never for a 429, which the default retry
 * would send straight back into (api-contract-guard addendum 4; unlike
 * TAS-512's `retryUnanswered`, which retries a 429 once).
 */
export const retryCountRead = (failureCount: number, error: Error) =>
  failureCount < 1 && keepsHeldCount(error) && apiErrorFacts(error).status !== 429;

/** The server's own words for the failure's detail line, when there is a server answer that has any (§5.6). */
export function countFailureWords(error: unknown): string | null {
  const { status, message } = apiErrorFacts(error);
  return status !== null && message !== null && message !== ISSUE_COUNT_READ_FAILED ? message : null;
}
