import type { CreateIssueInput } from "../api/TaskaApi";

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
