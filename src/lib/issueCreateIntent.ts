import { apiErrorFacts } from "../api/errors";
import type { CreateIssueInput } from "../api/TaskaApi";
import { isIndefinite } from "./intentKey";

/**
 * What one New issue draft sends, as one string (TAS-528, api-contract-guard
 * H1): the project and every field of the create — type, status, priority,
 * summary, description and the five planning fields — exactly as they go, in
 * one fixed order. Two sends with the same signature are the same request; a
 * change to any sent field is a new one, and with it a new `Idempotency-Key`
 * (`keyFor`). `null` and absent are the same: the REST leg omits both.
 */
export function createIssueSignature(projectId: string, input: CreateIssueInput): string {
  return JSON.stringify([
    projectId,
    input.issueType,
    input.statusKey ?? null,
    input.priority,
    input.summary,
    input.description,
    input.storyPoints ?? null,
    input.originalEstimateMinutes ?? null,
    input.remainingEstimateMinutes ?? null,
    input.startDate ?? null,
    input.dueDate ?? null,
  ]);
}

/**
 * Whether a create's answer left the draft's key open (TAS-528, H1): it never
 * came, or said nothing about the request — no status, 408, 429, 5xx
 * (`isIndefinite`). An error with a `code` and no HTTP status is an answer
 * too: the mocks' refusals (`MockApiError`) carry no status, while a request
 * that got no answer at all carries neither (`fetch`'s `TypeError`).
 */
export function createLeftOpen(error: unknown): boolean {
  const { status, code } = apiErrorFacts(error);
  return isIndefinite(error) && !(status === null && code !== null);
}

/**
 * The form's sentence for a create whose answer never came or said nothing —
 * no status, 408, 5xx, but not a 429, which keeps its own words
 * (art-director BLK-1, after §4.36's «5xx, 408, network» row). Pressing again
 * unchanged sends the same key, so it cannot make a second issue — and any
 * change mints a new one, hence «without changing anything».
 */
export const ISSUE_CREATE_UNCONFIRMED =
  "Taska couldn’t confirm the issue was created. Press Create issue again without changing anything — it won’t create a second one.";

export function createUnconfirmed(error: unknown): boolean {
  return createLeftOpen(error) && apiErrorFacts(error).status !== 429;
}

/** The server's own words under that sentence — only when there was an HTTP answer (a 408 or a 5xx); a lost one has none. */
export function unconfirmedServerWords(error: unknown): string | null {
  const { status, message } = apiErrorFacts(error);
  return status !== null && message !== null && message !== ISSUE_CREATE_UNCONFIRMED ? message : null;
}
