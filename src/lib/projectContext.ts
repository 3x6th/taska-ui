import type { IssueType, IssueTypeCode, ProjectContext, ProjectWorkflow } from "../domain/types";

/**
 * The cache key of `getProjectContext` (TAS-251). The board reads its whole
 * frame from it — project, role, members, labels, workflows — so every write
 * that changes one of those invalidates this key, and the dialogs that patch
 * the board optimistically patch this entry.
 */
export const projectContextKey = (projectId: string) => ["project-context", projectId] as const;

/** Every issue type this build knows, in the order the board offers them. */
export const ALL_ISSUE_TYPES: readonly IssueType[] = ["TASK", "BUG", "STORY"];

/**
 * The workflow the context sent for an issue type, or `undefined`. Never an
 * index into `workflows`: the code is whatever string the server sent, and
 * `Object.hasOwn` is what keeps one spelled `constructor` from finding a member
 * of `Object.prototype` (TAS-173).
 */
export function workflowFor(
  workflows: ProjectContext["workflows"] | undefined,
  issueType: string | null | undefined,
): ProjectWorkflow | undefined {
  if (!workflows || typeof issueType !== "string" || !Object.hasOwn(workflows, issueType)) return undefined;
  return workflows[issueType];
}

/**
 * The issue types this project allows — the types the context sent a workflow
 * for, and only those. The context is the one source of the set (TAS-212);
 * `GET /meta` names types and never adds one here. The ones this build knows
 * come first, in the board's own order; a type it does not know follows in the
 * order the server sent it (TAS-173), so a new type is offered rather than
 * dropped and a known one never moves. Empty is a real answer: a project the
 * server lets nobody create anything in.
 */
export function allowedIssueTypes(context: ProjectContext | undefined): IssueTypeCode[] {
  if (!context) return [];
  const sent = Object.keys(context.workflows).filter((code) => workflowFor(context.workflows, code) !== undefined);
  const known: string[] = [...ALL_ISSUE_TYPES];
  return [...ALL_ISSUE_TYPES.filter((code) => sent.includes(code)), ...sent.filter((code) => !known.includes(code))];
}
