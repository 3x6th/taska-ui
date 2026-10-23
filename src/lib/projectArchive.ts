import type { QueryClient } from "@tanstack/react-query";
import { apiErrorFacts, isProjectArchived } from "../api/errors";
import { formatDayWithYearIfOther } from "./format";
import { projectContextKey } from "./projectContext";

/**
 * What a write refused with `PROJECT_ARCHIVED` says in place of the server's
 * words, wherever that refusal lands (DESIGN.md §5.7, «Архив пришёл отказом
 * записи»): the archive happened while the reader had the board open, and the
 * gateway's "Project is archived" says less than this does.
 */
export const PROJECT_ARCHIVED_SENTENCE = "This project has been archived, so nothing in it can be changed.";

/**
 * The server's words for a refusal, or ours for an archived project's — the one
 * substitution §5.7 asks for. Everything else about the place the refusal is
 * shown stays its own: the sentence in front, the request id after.
 */
export function refusalWords(error: unknown): string | null {
  return isProjectArchived(error) ? PROJECT_ARCHIVED_SENTENCE : apiErrorFacts(error).message;
}

/**
 * A refusal that says the project is archived makes the board read its context
 * again, and the board turns read-only from the `archivedAt` that read brings
 * back — never from the refusal itself (§5.7). For the writes that are not
 * mutations (the attachment upload's legs); every mutation's refusal reaches the
 * board through its mutation-cache listener instead.
 */
export function rereadContextIfArchived(queryClient: QueryClient, projectId: string, error: unknown): void {
  if (isProjectArchived(error)) void queryClient.invalidateQueries({ queryKey: projectContextKey(projectId) });
}

/** "Oct 23", or "Oct 23, 2025" for another year — the day an archived project is said to have been archived on. */
export const archivedOnDay = (archivedAt: string, now?: Date) => formatDayWithYearIfOther(archivedAt, now);
