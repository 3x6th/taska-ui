import { queryOptions } from "@tanstack/react-query";
import { taskaApi } from "../api/client";
import { isMissingOrForbidden } from "../api/errors";
import type { BoardParams } from "../api/TaskaApi";

/**
 * The board's four filters as they go to the server (TAS-392, DESIGN.md §5.4):
 * `null` for a filter that is off, and the text already trimmed and never
 * blank — a blank one is no filter. Every key is always there, so one
 * combination is one cache key however it was reached.
 */
export interface BoardFilters {
  issueType: string | null;
  assigneeId: string | null;
  labelId: string | null;
  query: string | null;
}

/** No filter: the whole board, whose sum is `Y` and whose cards the link picker offers (§5.4). */
export const NO_BOARD_FILTERS: BoardFilters = Object.freeze({ issueType: null, assigneeId: null, labelId: null, query: null });

/** Whether `filters` narrows anything. */
export const isFiltered = (filters: BoardFilters) =>
  filters.issueType !== null || filters.assigneeId !== null || filters.labelId !== null || filters.query !== null;

/**
 * The most issues a column — and «Outside their workflow» — carries in one
 * board read: the contract's ceiling (backend TAS-392). A column with more says
 * so at its foot (DESIGN.md §4.9).
 */
export const BOARD_PAGE_SIZE_PER_COLUMN = 200;

/**
 * The prefix of every board read of a project (TAS-202): one entry per
 * combination of filters sits under it (`boardReadKey`). Every write that
 * moves, creates, edits, labels or deletes an issue — and every workflow write,
 * since the columns come from the workflows — settles through the prefix, so it
 * reaches each entry.
 */
export const boardKey = (projectId: string) => ["board", projectId] as const;

/** One board read: the project and its filters (TAS-392). */
export const boardReadKey = (projectId: string, filters: BoardFilters) => ["board", projectId, filters] as const;

/**
 * The board read: `GET /projects/{projectId}/board?includeDone=true&pageSizePerColumn=200`
 * and the filters that are on. `includeDone` always, because the server's
 * default would empty every done column of a board that is meant to be whole;
 * the page size at its ceiling, so a capped column is rare.
 *
 * The unfiltered entry is shared by the board — its `Y` — and the panel's link
 * picker, which reads it rather than asking again.
 *
 * "Missing or not yours" is an answer and is not retried; anything else keeps
 * the app's one retry.
 */
export function boardQueryOptions(projectId: string, filters: BoardFilters = NO_BOARD_FILTERS) {
  const params: BoardParams = { includeDone: true, pageSizePerColumn: BOARD_PAGE_SIZE_PER_COLUMN };
  if (filters.issueType !== null) params.issueType = filters.issueType;
  if (filters.assigneeId !== null) params.assigneeId = filters.assigneeId;
  if (filters.labelId !== null) params.labelId = filters.labelId;
  if (filters.query !== null) params.query = filters.query;
  return queryOptions({
    queryKey: boardReadKey(projectId, filters),
    queryFn: () => taskaApi.getBoard(projectId, params),
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
