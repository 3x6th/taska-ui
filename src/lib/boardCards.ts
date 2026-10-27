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
export function columnCursor(column: Pick<BoardColumn, "issues">): { afterCreatedAt: string; afterId: string } | null {
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

/**
 * A board read again — after a write, or on return to a combination of filters
 * already read — laid over the board it replaces (§4.9, «Перечитывание»): a
 * column the reader expanded with «Show more» is not collapsed back to its
 * first page. Pure; `previous` is the cached board, with every optimistic move
 * and delete already in it.
 *
 * Per column of `fresh` that still has more than its first page
 * (`hasMore: true`), the cards `previous` drew in that column past `fresh`'s
 * last card stay at the end, in the order they were drawn — unless `fresh`
 * draws them anywhere (they left the column; the server's word wins), or the
 * column's page is empty. What `fresh` draws is the server's and is never
 * touched. A column the server now sends complete takes `fresh` as it is: every
 * issue of it is there. `hasMore` follows the count, which is `fresh`'s.
 *
 * What it cannot know without another read is that a kept card left the
 * column since: it stays until the board is read under other filters or the
 * page is reloaded. No read is made to find out — one page per «Show more» is
 * the whole of the cost (§4.9).
 */
export function keepExpandedColumns(previous: Board | undefined, fresh: Board): Board {
  if (!previous) return fresh;
  const freshIds = new Set(boardCards(fresh).map((issue) => issue.id));
  let kept = false;
  const columns = fresh.columns.map((column) => {
    const before = previous.columns.find((item) => item.statusKey === column.statusKey);
    const last = column.issues.at(-1);
    if (!before || column.hasMore !== true || last === undefined || before.issues.length <= column.issues.length) {
      return column;
    }
    const past = before.issues.filter((issue) => !freshIds.has(issue.id) && compareBoardIssues(issue, last) > 0);
    if (past.length === 0) return column;
    kept = true;
    const issues = [...column.issues, ...past];
    return { ...column, issues, hasMore: stillMore(column.totalCount, issues.length, column.hasMore) };
  });
  return kept ? { ...fresh, columns } : fresh;
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
