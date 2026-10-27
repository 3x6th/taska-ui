import { compareBoardIssues } from "../api/boardOrder";
import type { Board, BoardColumn, BoardColumnPage, BoardIssue } from "../domain/types";

/**
 * The board read's arithmetic, kept out of the screen so each rule is tested by
 * itself (TAS-392, DESIGN.md §4.9, §5.3, §5.4): what a capped column counts,
 * and what an optimistic move or delete does to a board whose columns are cut
 * at a page.
 */

/** Every card the read drew — the columns' and «Outside their workflow»'s. */
export function boardCards(board: Board): BoardIssue[] {
  return [...board.columns.flatMap((column) => column.issues), ...board.unplacedIssues];
}

/**
 * The issues the read counts — every column's `totalCount` and the unplaced
 * one — or `null` when any of them is unknown: one unknown count makes the sum
 * unknown, never a smaller number (§5.4's `X` and `Y`).
 */
export function boardIssueCount(board: Board): number | null {
  let sum = 0;
  for (const count of [...board.columns.map((column) => column.totalCount), board.unplacedTotalCount]) {
    if (count === null) return null;
    sum += count;
  }
  return sum;
}

/** Whether any column, or «Outside their workflow», says issues lie past its page (§5.4's link-picker line). */
export function boardHasMore(board: Board): boolean {
  return board.unplacedHasMore === true || board.columns.some((column) => column.hasMore === true);
}

/** A count moved by `by`, an unknown one left unknown. */
const counted = (total: number | null, by: number) => (total === null ? null : Math.max(0, total + by));

/** `hasMore` once the count or the drawn cards moved: the count says it when known, else it stays as it was. */
const stillMore = (total: number | null, drawn: number, before: boolean | null) =>
  total === null ? before : total > drawn;

/**
 * `board` with the card `issueId` moved to the column `statusKey` (§5.3,
 * §4.9): out of wherever it stood — its column's count, or the unplaced one,
 * one down — and into the target — its count one up — at the place
 * `compareBoardIssues` gives it, the server's order, with `updatedAt` stamped.
 * Into a column that has more issues than it drew, a card that would sort
 * after the last one drawn is **not** drawn: its place among the issues not
 * read is unknown, and the count carries it. `hasMore` follows the counts.
 *
 * Answered unchanged when this board does not hold the card or has no such
 * column — a board read under a type filter has only that type's columns.
 */
export function moveCardOnBoard(board: Board, issueId: string, statusKey: string, updatedAt: string): Board {
  const card = boardCards(board).find((issue) => issue.id === issueId);
  if (!card || !board.columns.some((column) => column.statusKey === statusKey)) return board;
  const moved: BoardIssue = { ...card, statusKey, updatedAt };
  const fromUnplaced = board.unplacedIssues.some((issue) => issue.id === issueId);
  const unplacedIssues = fromUnplaced ? board.unplacedIssues.filter((issue) => issue.id !== issueId) : board.unplacedIssues;
  const unplacedTotalCount = fromUnplaced ? counted(board.unplacedTotalCount, -1) : board.unplacedTotalCount;
  return {
    ...board,
    columns: board.columns.map((column): BoardColumn => {
      const held = column.issues.some((issue) => issue.id === issueId);
      const others = held ? column.issues.filter((issue) => issue.id !== issueId) : column.issues;
      if (column.statusKey === statusKey) {
        if (held) return { ...column, issues: [...others, moved].sort(compareBoardIssues) };
        const totalCount = counted(column.totalCount, 1);
        const last = others.at(-1);
        const pastTheEnd = column.hasMore === true && last !== undefined && compareBoardIssues(moved, last) > 0;
        const issues = pastTheEnd ? others : [...others, moved].sort(compareBoardIssues);
        return { ...column, issues, totalCount, hasMore: stillMore(totalCount, issues.length, column.hasMore) };
      }
      if (!held) return column;
      const totalCount = counted(column.totalCount, -1);
      return { ...column, issues: others, totalCount, hasMore: stillMore(totalCount, others.length, column.hasMore) };
    }),
    unplacedIssues,
    unplacedTotalCount,
    unplacedHasMore: fromUnplaced
      ? stillMore(unplacedTotalCount, unplacedIssues.length, board.unplacedHasMore)
      : board.unplacedHasMore,
  };
}

/** `board` without the card `issueId`, wherever it stood, one less in that count. Unchanged when it holds no such card. */
export function withoutCardOnBoard(board: Board, issueId: string): Board {
  if (!boardCards(board).some((issue) => issue.id === issueId)) return board;
  const fromUnplaced = board.unplacedIssues.some((issue) => issue.id === issueId);
  const unplacedIssues = fromUnplaced ? board.unplacedIssues.filter((issue) => issue.id !== issueId) : board.unplacedIssues;
  const unplacedTotalCount = fromUnplaced ? counted(board.unplacedTotalCount, -1) : board.unplacedTotalCount;
  return {
    ...board,
    columns: board.columns.map((column) => {
      if (!column.issues.some((issue) => issue.id === issueId)) return column;
      const issues = column.issues.filter((issue) => issue.id !== issueId);
      const totalCount = counted(column.totalCount, -1);
      return { ...column, issues, totalCount, hasMore: stillMore(totalCount, issues.length, column.hasMore) };
    }),
    unplacedIssues,
    unplacedTotalCount,
    unplacedHasMore: fromUnplaced
      ? stillMore(unplacedTotalCount, unplacedIssues.length, board.unplacedHasMore)
      : board.unplacedHasMore,
  };
}

/**
 * The cursor of a column's «Show more» (§4.9, backend TAS-430): the last card
 * the column draws, whose `createdAt` and `id` the next page starts after.
 * `null` for a column that draws none — its first page is the board read's,
 * and nothing continues an empty one.
 */
export function columnCursor(column: Pick<BoardColumn, "issues">): ColumnCursor | null {
  const last = column.issues.at(-1);
  return last ? { afterCreatedAt: last.createdAt, afterId: last.id } : null;
}

/**
 * `board` with a column's next page appended (§4.9, «Нажатие»): the page's
 * cards after the ones drawn, in the server's order, **without repeats** — a
 * card the board already draws anywhere, in this column or another one an
 * optimistic move put it in, is not drawn twice. The column's count and
 * `hasMore` become the page's: it was read after the board and counts the same
 * column under the same filters. Unchanged when the board has no such column.
 */
export function withColumnPage(board: Board, page: BoardColumnPage): Board {
  if (!board.columns.some((column) => column.statusKey === page.statusKey)) return board;
  const drawn = new Set(boardCards(board).map((issue) => issue.id));
  return {
    ...board,
    columns: board.columns.map((column) => {
      if (column.statusKey !== page.statusKey) return column;
      const fresh = page.issues.filter((issue) => !drawn.has(issue.id));
      const issues = [...column.issues, ...fresh];
      const totalCount = page.totalCount ?? column.totalCount;
      return {
        ...column,
        issues,
        totalCount,
        hasMore: page.hasMore ?? stillMore(totalCount, issues.length, column.hasMore),
      };
    }),
  };
}

/** The cursor a column page starts after: the `createdAt` and `id` of the last card before it. */
export interface ColumnCursor {
  afterCreatedAt: string;
  afterId: string;
}

/** One read of a column's page after `cursor`, `pageSize` deep, under the board read's own filters. */
export type ColumnPageReader = (statusKey: string, cursor: ColumnCursor, pageSize: number) => Promise<BoardColumnPage>;

/**
 * A board read again — after a write, or on return to a combination of filters
 * already read — with every column the reader expanded with «Show more» read
 * again to the same depth (§4.9, «Перечитывание»; release-reviewer, TAS-438):
 * an expanded column is not collapsed back to its first page, and none of its
 * cards is a copy older than the read — a summary, a priority, an assignee,
 * labels and, above all, the `version` the next move sends as `If-Match` are
 * the server's.
 *
 * `previous` is the cached board **as it stands once `fresh` has answered** —
 * every optimistic move and delete in it, and a page «Show more» drew while
 * the board read was out. A column is read again when `previous` drew more of
 * it than `fresh`'s first page holds and `fresh` still says `hasMore`: the
 * column's pages after `fresh`'s last card, as deep as `previous` drew beyond
 * that page, at most `pageLimit` a read, while the server says more follow.
 * The pages land after the first page in one result — no card twice, none
 * `fresh` already draws — and the column takes the last page's count and
 * `hasMore`. Columns are read in parallel, each column's pages in turn.
 *
 * A read that fails puts that column back to its first page, foot and all, and
 * says nothing (§4.9): the rest of the board stands. A column that was not
 * expanded, or that the server now sends whole, costs no read.
 */
export async function withColumnTails(
  fresh: Board,
  previous: Board | undefined,
  readPage: ColumnPageReader,
  pageLimit: number,
): Promise<Board> {
  if (!previous) return fresh;
  const drawn = new Set(boardCards(fresh).map((issue) => issue.id));
  const columns = await Promise.all(
    fresh.columns.map(async (column): Promise<BoardColumn> => {
      const before = previous.columns.find((item) => item.statusKey === column.statusKey);
      const depth = before ? before.issues.length - column.issues.length : 0;
      let cursor = columnCursor(column);
      if (column.hasMore !== true || depth <= 0 || !cursor) return column;
      const tail: BoardIssue[] = [];
      const seen = new Set<string>();
      let last: BoardColumnPage | null = null;
      try {
        for (let wanted = depth; wanted > 0 && cursor; ) {
          last = await readPage(column.statusKey, cursor, Math.min(wanted, pageLimit));
          for (const issue of last.issues) {
            if (drawn.has(issue.id) || seen.has(issue.id)) continue;
            seen.add(issue.id);
            tail.push(issue);
          }
          wanted -= last.issues.length;
          cursor = columnCursor(last);
          if (last.hasMore !== true) break;
        }
      } catch {
        return column;
      }
      if (!last) return column;
      const issues = [...column.issues, ...tail];
      const totalCount = last.totalCount ?? column.totalCount;
      return { ...column, issues, totalCount, hasMore: last.hasMore ?? stillMore(totalCount, issues.length, column.hasMore) };
    }),
  );
  return columns.every((column, index) => column === fresh.columns[index]) ? fresh : { ...fresh, columns };
}

/**
 * `board` with the card `issueId` at the version and `updatedAt` a write's
 * answer brought back (TAS-422): what the next move of it sends as `If-Match`
 * before the re-read lands. Unchanged when it holds no such card.
 */
export function withCardVersion(board: Board, issueId: string, version: number, updatedAt: string): Board {
  if (!boardCards(board).some((issue) => issue.id === issueId)) return board;
  const stamp = (issue: BoardIssue) => (issue.id === issueId ? { ...issue, version, updatedAt } : issue);
  return {
    ...board,
    columns: board.columns.map((column) => ({ ...column, issues: column.issues.map(stamp) })),
    unplacedIssues: board.unplacedIssues.map(stamp),
  };
}
