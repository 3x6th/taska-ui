import { describe, expect, it } from "vitest";
import type { Board, BoardColumn, BoardColumnPage, BoardIssue } from "../domain/types";
import {
  boardHasMore,
  boardIssueCount,
  columnCursor,
  keepExpandedColumns,
  moveCardOnBoard,
  withCardVersion,
  withColumnPage,
  withoutCardOnBoard,
} from "./boardCards";

/**
 * A board read cut at its page (backend TAS-392, DESIGN.md §4.9, §5.3): what
 * it counts, and what an optimistic move or delete does to its counts and to
 * the cards drawn.
 */
const card = (id: string, createdAt: string, statusKey = "TODO"): BoardIssue => ({
  id,
  issueKey: id.toUpperCase(),
  summary: id,
  issueType: "TASK",
  priority: "MEDIUM",
  statusKey,
  description: null,
  createdAt,
  updatedAt: createdAt,
  version: 1,
  assignee: null,
  labels: [],
});
const column = (statusKey: string, issues: BoardIssue[], over: Partial<BoardColumn> = {}): BoardColumn => ({
  statusKey,
  name: statusKey,
  category: statusKey,
  sortOrder: 10,
  issues,
  totalCount: issues.length,
  hasMore: false,
  ...over,
});
const board = (columns: BoardColumn[], over: Partial<Board> = {}): Board => ({
  projectId: "p",
  columns,
  unplacedIssues: [],
  unplacedTotalCount: 0,
  unplacedHasMore: false,
  ...over,
});
const ids = (issues: readonly BoardIssue[]) => issues.map((issue) => issue.id);

describe("a capped board's counts", () => {
  it("sums every column's count and the unplaced one, and is unknown when any is", () => {
    const whole = board([column("TODO", [card("a", "2026-01-01")], { totalCount: 250, hasMore: true })], {
      unplacedTotalCount: 3,
    });
    expect(boardIssueCount(whole)).toBe(253);
    expect(boardIssueCount({ ...whole, unplacedTotalCount: null })).toBeNull();
    expect(boardHasMore(whole)).toBe(true);
    expect(boardHasMore(board([column("TODO", [])], { unplacedHasMore: true }))).toBe(true);
    expect(boardHasMore(board([column("TODO", [])], { unplacedHasMore: null }))).toBe(false);
  });
});

describe("an optimistic move on a capped board", () => {
  const a = card("a", "2026-01-01");
  const b = card("b", "2026-01-02", "DONE");
  const c = card("c", "2026-01-03", "DONE");

  it("moves the card and both counts by one, in the target's order", () => {
    const before = board([column("TODO", [a]), column("DONE", [b, c])]);
    const after = moveCardOnBoard(before, "a", "DONE", "2026-05-01T00:00:00Z");
    expect(ids(after.columns[0].issues)).toEqual([]);
    expect(after.columns[0]).toMatchObject({ totalCount: 0, hasMore: false });
    expect(ids(after.columns[1].issues)).toEqual(["a", "b", "c"]);
    expect(after.columns[1]).toMatchObject({ totalCount: 3, hasMore: false });
    expect(after.columns[1].issues[0]).toMatchObject({ statusKey: "DONE", updatedAt: "2026-05-01T00:00:00Z" });
  });

  // §5.3: in a column with more than it drew, a card that sorts after the last
  // drawn one is not drawn — its place among the issues not read is unknown —
  // and the count carries it.
  it("does not draw a card that would sort past the end of a column with more, and counts it", () => {
    const late = card("z", "2026-09-01");
    const before = board([column("TODO", [late]), column("DONE", [b, c], { totalCount: 300, hasMore: true })]);
    const after = moveCardOnBoard(before, "z", "DONE", "2026-05-01T00:00:00Z");
    expect(ids(after.columns[1].issues)).toEqual(["b", "c"]);
    expect(after.columns[1]).toMatchObject({ totalCount: 301, hasMore: true });
    expect(after.columns[0]).toMatchObject({ totalCount: 0 });

    // One that sorts among the drawn ones is drawn.
    const first = board([column("TODO", [a]), column("DONE", [b, c], { totalCount: 300, hasMore: true })]);
    expect(ids(moveCardOnBoard(first, "a", "DONE", "x").columns[1].issues)).toEqual(["a", "b", "c"]);
  });

  it("leaves an unknown count unknown, and works hasMore out from a known one", () => {
    const before = board([column("TODO", [a], { totalCount: null, hasMore: null }), column("DONE", [b], { totalCount: 1 })]);
    const after = moveCardOnBoard(before, "a", "DONE", "x");
    expect(after.columns[0]).toMatchObject({ totalCount: null, hasMore: null });
    expect(after.columns[1]).toMatchObject({ totalCount: 2, hasMore: false });
  });

  it("takes a card out of «Outside their workflow» with its count", () => {
    const outside = card("o", "2026-01-05", "BLOCKED");
    const before = board([column("TODO", [])], { unplacedIssues: [outside], unplacedTotalCount: 1 });
    const after = moveCardOnBoard(before, "o", "TODO", "x");
    expect(after.unplacedIssues).toEqual([]);
    expect(after.unplacedTotalCount).toBe(0);
    expect(after.unplacedHasMore).toBe(false);
    expect(ids(after.columns[0].issues)).toEqual(["o"]);
  });

  it("leaves a board without the card, or without the column, as it was", () => {
    const before = board([column("TODO", [a])]);
    expect(moveCardOnBoard(before, "nope", "TODO", "x")).toBe(before);
    expect(moveCardOnBoard(before, "a", "DONE", "x")).toBe(before);
  });
});

describe("an optimistic delete and a write's version on a capped board", () => {
  it("takes the card off with its count, wherever it stood", () => {
    const a = card("a", "2026-01-01");
    const before = board([column("TODO", [a], { totalCount: 201, hasMore: true })]);
    const after = withoutCardOnBoard(before, "a");
    expect(after.columns[0]).toMatchObject({ issues: [], totalCount: 200, hasMore: true });
    expect(withoutCardOnBoard(after, "a")).toBe(after);
  });

  it("stamps the version and updatedAt a write brought back", () => {
    const before = board([column("TODO", [card("a", "2026-01-01")])]);
    const after = withCardVersion(before, "a", 7, "2026-05-01T00:00:00Z");
    expect(after.columns[0].issues[0]).toMatchObject({ version: 7, updatedAt: "2026-05-01T00:00:00Z" });
    expect(withCardVersion(before, "nope", 7, "x")).toBe(before);
  });
});

/**
 * «Show more» (DESIGN.md §4.9, backend TAS-430): the cursor a column's next
 * page starts after, the page appended without repeats, and an expanded column
 * kept across a re-read of the board.
 */
describe("a column continued with Show more", () => {
  const a = card("a", "2026-01-01");
  const b = card("b", "2026-01-02");
  const c = card("c", "2026-01-03");
  const d = card("d", "2026-01-04");
  const e = card("e", "2026-01-05");
  const page = (issues: BoardIssue[], over: Partial<BoardColumnPage> = {}): BoardColumnPage => ({
    statusKey: "TODO",
    issues,
    totalCount: 5,
    hasMore: true,
    ...over,
  });

  it("starts the next page after the last card drawn, and has no cursor for a column that draws none", () => {
    expect(columnCursor(column("TODO", [a, b]))).toEqual({ afterCreatedAt: "2026-01-02", afterId: "b" });
    expect(columnCursor(column("TODO", []))).toBeNull();
  });

  it("appends the page after the cards drawn and takes its count and hasMore", () => {
    const capped = board([column("TODO", [a, b], { totalCount: 4, hasMore: true }), column("DONE", [])]);

    const next = withColumnPage(capped, page([c, d], { totalCount: 5, hasMore: true }));

    expect(ids(next.columns[0].issues)).toEqual(["a", "b", "c", "d"]);
    expect(next.columns[0]).toMatchObject({ totalCount: 5, hasMore: true });
    expect(next.columns[1]).toBe(capped.columns[1]);
    const last = withColumnPage(next, page([e], { hasMore: false }));
    expect(ids(last.columns[0].issues)).toEqual(["a", "b", "c", "d", "e"]);
    expect(last.columns[0].hasMore).toBe(false);
  });

  it("draws no card twice — one the column already draws, or one another column does", () => {
    const moved = card("c", "2026-01-03", "DONE");
    const capped = board([column("TODO", [a, b], { totalCount: 5, hasMore: true }), column("DONE", [moved])]);

    const next = withColumnPage(capped, page([b, c, d]));

    expect(ids(next.columns[0].issues)).toEqual(["a", "b", "d"]);
    expect(ids(next.columns[1].issues)).toEqual(["c"]);
  });

  it("keeps the column's count when the page states none, and works hasMore out from it", () => {
    const capped = board([column("TODO", [a, b], { totalCount: 3, hasMore: true })]);
    const next = withColumnPage(capped, page([c], { totalCount: null, hasMore: null }));
    expect(next.columns[0]).toMatchObject({ totalCount: 3, hasMore: false });
  });

  it("leaves a board without the page's column as it was", () => {
    const capped = board([column("TODO", [a])]);
    expect(withColumnPage(capped, page([b], { statusKey: "LATER" }))).toBe(capped);
  });

  describe("across a re-read of the board", () => {
    const fresh = (issues: BoardIssue[], over: Partial<BoardColumn> = {}) =>
      board([column("TODO", issues, { totalCount: 5, hasMore: true, ...over }), column("DONE", [])]);
    const expanded = board([column("TODO", [a, b, c, d], { totalCount: 5, hasMore: true }), column("DONE", [])]);

    it("keeps the cards read past the first page, after it, and counts by the new read", () => {
      const kept = keepExpandedColumns(expanded, fresh([a, b]));
      expect(ids(kept.columns[0].issues)).toEqual(["a", "b", "c", "d"]);
      expect(kept.columns[0]).toMatchObject({ totalCount: 5, hasMore: true });
      // A sixth issue counted: still more to read.
      expect(keepExpandedColumns(expanded, fresh([a, b], { totalCount: 6 })).columns[0].hasMore).toBe(true);
      // Every issue drawn now: no foot.
      expect(keepExpandedColumns(expanded, fresh([a, b], { totalCount: 4 })).columns[0].hasMore).toBe(false);
    });

    it("drops a kept card the new read draws anywhere, or one that sorts inside its page", () => {
      const movedToDone = board([column("TODO", [a, b], { totalCount: 4, hasMore: true }), column("DONE", [card("c", "2026-01-03", "DONE")])]);
      expect(ids(keepExpandedColumns(expanded, movedToDone).columns[0].issues)).toEqual(["a", "b", "d"]);
      // `b` left; the page now reaches to `c`: what it draws is the server's.
      expect(ids(keepExpandedColumns(expanded, fresh([a, c])).columns[0].issues)).toEqual(["a", "c", "d"]);
    });

    it("takes the new read as it is when the column is whole, was not expanded, or there was nothing before", () => {
      const whole = fresh([a, b, c], { totalCount: 3, hasMore: false });
      expect(keepExpandedColumns(expanded, whole)).toBe(whole);
      const firstPage = board([column("TODO", [a, b], { totalCount: 5, hasMore: true })]);
      const again = fresh([a, b]);
      expect(keepExpandedColumns(firstPage, again)).toBe(again);
      expect(keepExpandedColumns(undefined, again)).toBe(again);
    });
  });
});
