import type { IssueType, ProjectContext } from "../domain/types";

/**
 * The cache key of `getProjectContext` (TAS-251). The board reads its whole
 * frame from it — project, role, members, labels, workflows — so every write
 * that changes one of those invalidates this key, and the dialogs that patch
 * the board optimistically patch this entry.
 */
export const projectContextKey = (projectId: string) => ["project-context", projectId] as const;

/** Every issue type in the order the board offers them. */
export const ALL_ISSUE_TYPES: readonly IssueType[] = ["TASK", "BUG", "STORY"];

/**
 * The issue types this project allows, in the board's own order — the types the
 * context sent a workflow for, and only those. Empty is a real answer: a
 * project the server lets nobody create anything in.
 */
export function allowedIssueTypes(context: ProjectContext | undefined): IssueType[] {
  if (!context) return [];
  return ALL_ISSUE_TYPES.filter((issueType) => context.workflows[issueType] !== undefined);
}
