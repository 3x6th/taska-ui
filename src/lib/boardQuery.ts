import { queryOptions } from "@tanstack/react-query";
import { taskaApi } from "../api/client";
import { isMissingOrForbidden } from "../api/errors";

/**
 * The cache key of a project's board read (TAS-202): the columns, the issues in
 * them and the issues outside their own type's workflow, in one entry. Every
 * write that moves, creates, edits, labels or deletes an issue — and every
 * workflow write, since the columns come from the workflows — settles through
 * it. No filter is in the key: the board's four filters are local.
 */
export const boardKey = (projectId: string) => ["board", projectId] as const;

/**
 * The board read: `GET /projects/{projectId}/board?includeDone=true`, and
 * nothing else in the query string. `includeDone` always, because the server's
 * default would empty every done column of a board that is meant to be whole.
 *
 * Shared by the board and by the panel's link picker, which reads the same
 * entry rather than asking again.
 *
 * "Missing or not yours" is an answer and is not retried; anything else keeps
 * the app's one retry.
 */
export function boardQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: boardKey(projectId),
    queryFn: () => taskaApi.getBoard(projectId, { includeDone: true }),
    retry: (failureCount: number, error: Error) => !isMissingOrForbidden(error) && failureCount < 1,
  });
}

/**
 * The cache key of `GET /project-stats` (TAS-202): the counts and faces of every
 * project card on `/projects`, one entry for the whole grid. A member write
 * invalidates it, a create invalidates it, an archive filters its entry out.
 */
export const PROJECT_STATS_KEY = ["project-stats"] as const;

/** The project cards' one read. */
export function projectStatsQueryOptions() {
  return queryOptions({
    queryKey: PROJECT_STATS_KEY,
    queryFn: () => taskaApi.getProjectStats(),
  });
}
