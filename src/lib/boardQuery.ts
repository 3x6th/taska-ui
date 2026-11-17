import { queryOptions } from "@tanstack/react-query";
import { taskaApi } from "../api/client";
import { isMissingOrForbidden } from "../api/errors";
import type { BoardColumnPageParams, BoardParams } from "../api/TaskaApi";
import type { Board } from "../domain/types";
import { withColumnTails, type ColumnCursor } from "./boardCards";
import type { BoardDoneWindow } from "./readerPrefs";

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

/**
 * One board read's key (DESIGN.md §6): the four filters and the Done window
 * (TAS-532, §4.13) — the **name** of the window, never the moment it cuts at,
 * so a read under «2 weeks» is one entry however often it is made. The window
 * is a view and not a filter: `isFiltered` does not count it, and «Clear»
 * does not reset it.
 */
export interface BoardView extends BoardFilters {
  doneWindow: BoardDoneWindow;
}

/** No filter: the whole board, whose sum is `Y` under the board's own window (§5.4). */
export const NO_BOARD_FILTERS: BoardFilters = Object.freeze({ issueType: null, assigneeId: null, labelId: null, query: null });

/**
 * The link picker's record (§5.4, TAS-532): no filter and no Done window, so
 * neither narrows what an issue may be linked to. Under «All» it is the very
 * entry the board's `Y` reads; under «2 weeks» a read of its own.
 */
export const LINK_PICKER_VIEW: BoardView = Object.freeze({ ...NO_BOARD_FILTERS, doneWindow: "all" });

/** Whether `filters` narrows anything. The Done window of a `BoardView` is not a filter and is not counted. */
export const isFiltered = (filters: BoardFilters) =>
  filters.issueType !== null || filters.assigneeId !== null || filters.labelId !== null || filters.query !== null;

/**
 * The most issues a column — and «Outside their workflow» — carries in one
 * board read: the contract's ceiling (backend TAS-392). A column with more says
 * so at its foot (DESIGN.md §4.9).
 */
export const BOARD_PAGE_SIZE_PER_COLUMN = 200;

/** «2 weeks»: 14×24 hours, not two calendar weeks — no time zone, no daylight saving (§4.13). */
export const BOARD_DONE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * The `doneSince` a board read under `doneWindow` sends (§4.13, backend
 * TAS-525): `now` less 14×24 h for «2 weeks», as an ISO instant; `null` — no
 * parameter, no cut — for «All». `now` is `Date.now()` at the moment of the
 * read: computed once per read, and that read's continuations reuse it.
 */
export function doneSinceFor(doneWindow: BoardDoneWindow, now: number = Date.now()): string | null {
  return doneWindow === "2w" ? new Date(now - BOARD_DONE_WINDOW_MS).toISOString() : null;
}

/**
 * One board read as the cache holds it: the server's answer, and the window it
 * was read under with the very `doneSince` that went out (TAS-532). Neither is
 * on the wire. They are what «Show more» and the tail re-read continue with —
 * the same `doneSince`, never a second «now» — and what tells the screen which
 * window the board it draws was read under while another read is out (§5.4).
 * Every rewrite of a cached board spreads it (src/lib/boardCards.ts), so both
 * outlive optimistic moves, deletes and pages.
 */
export type BoardRead = Board & {
  doneWindow: BoardDoneWindow;
  /** The `doneSince` the read sent; `null` under «All», which sends none. */
  doneSince: string | null;
};

/**
 * The prefix of every board read of a project (TAS-202): one entry per
 * combination of filters and Done window sits under it (`boardReadKey`).
 * Every write that moves, creates, edits, labels or deletes an issue — and
 * every workflow write, since the columns come from the workflows — settles
 * through the prefix, so it reaches each entry.
 */
export const boardKey = (projectId: string) => ["board", projectId] as const;

/** One board read: the project, its filters and its Done window (TAS-392, TAS-532; DESIGN.md §6). */
export const boardReadKey = (projectId: string, view: BoardView) =>
  [
    "board",
    projectId,
    {
      issueType: view.issueType,
      assigneeId: view.assigneeId,
      labelId: view.labelId,
      query: view.query,
      doneWindow: view.doneWindow,
    },
  ] as const;

/**
 * The filters that are on, and `doneSince` when there is one, as both board
 * routes take them (TAS-392, TAS-430, TAS-525), with `includeDone` always.
 */
function filterParams(filters: BoardFilters, doneSince: string | null): Omit<BoardParams, "pageSizePerColumn"> {
  const params: Omit<BoardParams, "pageSizePerColumn"> = { includeDone: true };
  if (filters.issueType !== null) params.issueType = filters.issueType;
  if (filters.assigneeId !== null) params.assigneeId = filters.assigneeId;
  if (filters.labelId !== null) params.labelId = filters.labelId;
  if (filters.query !== null) params.query = filters.query;
  if (doneSince !== null) params.doneSince = doneSince;
  return params;
}

/**
 * The board read: `GET /projects/{projectId}/board?includeDone=true&pageSizePerColumn=200`,
 * the filters that are on and, under the Done window «2 weeks», `doneSince`
 * (§4.13, backend TAS-525) — computed here, once, when the read starts.
 * `includeDone` always, because the server's default would empty every done
 * column of a board that is meant to be whole; the page size at its ceiling,
 * so a capped column is rare.
 *
 * A column the reader expanded with «Show more» is read again with it, to the
 * same depth, through the column page (`withColumnTails`; DESIGN.md §4.9,
 * «Перечитывание»), **with the same `doneSince`**: one more read per expanded
 * column (per 200 cards read past its first page), none for the rest. The
 * cache is read **after** the board has answered, so a page «Show more» drew
 * while the read was out is counted in that depth rather than overwritten.
 * The entry keeps the window and `doneSince` beside the answer (`BoardRead`).
 *
 * The unfiltered entry under the board's window is the board's `Y`; the link
 * picker reads the unfiltered one under «All» (`LINK_PICKER_VIEW`), which is
 * the same entry while the board is under «All».
 *
 * "Missing or not yours" is an answer and is not retried; anything else keeps
 * the app's one retry.
 */
export function boardQueryOptions(projectId: string, view: BoardView) {
  return queryOptions({
    queryKey: boardReadKey(projectId, view),
    queryFn: async ({ client, queryKey }): Promise<BoardRead> => {
      const doneSince = doneSinceFor(view.doneWindow);
      const params: BoardParams = { ...filterParams(view, doneSince), pageSizePerColumn: BOARD_PAGE_SIZE_PER_COLUMN };
      const fresh = await taskaApi.getBoard(projectId, params);
      const board = await withColumnTails(
        fresh,
        client.getQueryData<Board>(queryKey),
        (statusKey, cursor, pageSize) =>
          taskaApi.getBoardColumnPage(projectId, statusKey, boardColumnPageParams(view, doneSince, cursor, pageSize)),
        BOARD_PAGE_SIZE_PER_COLUMN,
      );
      return { ...board, doneWindow: view.doneWindow, doneSince };
    },
    retry: (failureCount: number, error: Error) => !isMissingOrForbidden(error) && failureCount < 1,
  });
}

/**
 * The request of a column's page (DESIGN.md §4.9, backend TAS-430, TAS-525):
 * the board's own filters and `doneSince` — the ones the drawn board was read
 * with — and `includeDone=true`, the cursor of the last card drawn in the
 * column's own kind (`columnCursor`), and the page size: 200 for «Show more»,
 * the depth already drawn when a re-read reads a column's tail again.
 */
export function boardColumnPageParams(
  filters: BoardFilters,
  doneSince: string | null,
  cursor: ColumnCursor,
  pageSize: number = BOARD_PAGE_SIZE_PER_COLUMN,
): BoardColumnPageParams {
  return { ...cursor, ...filterParams(filters, doneSince), pageSize };
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
