import type { IssueTypeCode, ProjectContext, ProjectWorkflow } from "../domain/types";

/**
 * The cache key of `getProjectContext` (TAS-251). The board reads its whole
 * frame from it — project, role, members, labels, workflows — so every write
 * that changes one of those invalidates this key, and the dialogs that patch
 * the board optimistically patch this entry.
 */
export const projectContextKey = (projectId: string) => ["project-context", projectId] as const;

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
 * The issue types this project offers — its registry's keys, **in the
 * registry's order** (backend #212, DESIGN.md §6): the order of the type
 * filter, the create form and every other list of types, and the first is the
 * type a new issue starts as. Not re-sorted, and not narrowed to the types the
 * context sent a workflow for: the registry is the set (TAS-417). Empty is a
 * real answer — a project nobody can create anything in.
 */
export function allowedIssueTypes(context: ProjectContext | undefined): IssueTypeCode[] {
  return context ? context.issueTypes.map((entry) => entry.code) : [];
}
