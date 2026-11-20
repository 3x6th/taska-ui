import { describe, expect, it } from "vitest";
import type { Board, BoardColumn, BoardColumnPage, BoardIssue } from "../domain/types";
import {
  boardHasMore,
  boardIssueCount,
  columnCursor,
  moveCardOnBoard,
  withCardVersion,
  withColumnPage,
  withColumnTails,
  withoutCardOnBoard,
  type ColumnCursor,
} from "./boardCards";

/**
 * A board read cut at its page (backend TAS-392, DESIGN.md §4.9, §5.3): what
 * it counts, and what an optimistic move or delete does to its counts and to
 * the cards drawn.
 */
const card = (id: string, createdAt: string, statusKey = "TODO", updatedAt = createdAt): BoardIssue => ({
  id,
  issueKey: id.toUpperCase(),
  summary: id,
  issueType: "TASK",
  priority: "MEDIUM",
  statusKey,
  description: null,
  createdAt,
  updatedAt,
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
  // In Progress runs by creation (backend TAS-392), oldest first.
  const b = card("b", "2026-01-02", "IN_PROGRESS");
  const c = card("c", "2026-01-03", "IN_PROGRESS");
  // Done runs by the last change (backend TAS-525), newest first: `e`, made
  // first, was touched last.
  const d = card("d", "2026-01-05", "DONE", "2026-03-01T00:00:00Z");
  const e = card("e", "2026-01-04", "DONE", "2026-04-01T00:00:00Z");

  it("moves the card and both counts by one, at its place in a column ordered by creation", () => {
    const later = card("l", "2026-01-02T12:00:00Z");
    const before = board([column("TODO", [later]), column("IN_PROGRESS", [b, c])]);
    const after = moveCardOnBoard(before, "l", "IN_PROGRESS", "2026-05-01T00:00:00Z");
    expect(ids(after.columns[0].issues)).toEqual([]);
    expect(after.columns[0]).toMatchObject({ totalCount: 0, hasMore: false });
    expect(ids(after.columns[1].issues)).toEqual(["b", "l", "c"]);
    expect(after.columns[1]).toMatchObject({ totalCount: 3, hasMore: false });
    expect(after.columns[1].issues[1]).toMatchObject({ statusKey: "IN_PROGRESS", updatedAt: "2026-05-01T00:00:00Z" });
  });

  // §5.3: in a column with more than it drew, a card that sorts after the last
  // drawn one is not drawn — its place among the issues not read is unknown —
  // and the count carries it.
  it("does not draw a card that would sort past the end of a column with more, and counts it", () => {
    const late = card("z", "2026-09-01");
    const before = board([column("TODO", [late]), column("IN_PROGRESS", [b, c], { totalCount: 300, hasMore: true })]);
    const after = moveCardOnBoard(before, "z", "IN_PROGRESS", "2026-05-01T00:00:00Z");
    expect(ids(after.columns[1].issues)).toEqual(["b", "c"]);
    expect(after.columns[1]).toMatchObject({ totalCount: 301, hasMore: true });
    expect(after.columns[0]).toMatchObject({ totalCount: 0 });

    // One that sorts among the drawn ones is drawn.
    const first = board([column("TODO", [a]), column("IN_PROGRESS", [b, c], { totalCount: 300, hasMore: true })]);
    expect(ids(moveCardOnBoard(first, "a", "IN_PROGRESS", "x").columns[1].issues)).toEqual(["a", "b", "c"]);
  });

  // §5.3 (TAS-532): a done column runs by the last change, and the move is
  // its newest one — first, and drawn however much of the column lies unread.
  it("puts a card moved into a done column first, and draws it even in a column with more", () => {
    const late = card("z", "2026-09-01");
    const before = board([column("TODO", [late]), column("DONE", [e, d], { totalCount: 300, hasMore: true })]);
    const after = moveCardOnBoard(before, "z", "DONE", "2026-05-01T00:00:00Z");
    expect(ids(after.columns[1].issues)).toEqual(["z", "e", "d"]);
    expect(after.columns[1]).toMatchObject({ totalCount: 301, hasMore: true });
    expect(after.columns[1].issues[0]).toMatchObject({ statusKey: "DONE", updatedAt: "2026-05-01T00:00:00Z" });

    // First outright, not by the comparator: a card another clock stamped
    // later than this move still comes after it.
    const skewed = card("s", "2026-01-01", "DONE", "2099-01-01T00:00:00Z");
    const ahead = board([column("TODO", [a]), column("DONE", [skewed, e], { totalCount: 300, hasMore: true })]);
    expect(ids(moveCardOnBoard(ahead, "a", "DONE", "2026-05-01T00:00:00Z").columns[1].issues)).toEqual(["a", "s", "e"]);
  });

  it("puts a card moved out of a done column at its place by creation, under the rule for a column with more", () => {
    const before = board([column("IN_PROGRESS", [b, c]), column("DONE", [e, d])]);
    const back = moveCardOnBoard(before, "e", "IN_PROGRESS", "2026-05-01T00:00:00Z");
    expect(ids(back.columns[0].issues)).toEqual(["b", "c", "e"]);
    expect(ids(back.columns[1].issues)).toEqual(["d"]);

    const capped = board([column("IN_PROGRESS", [b, c], { totalCount: 9, hasMore: true }), column("DONE", [e, d])]);
    expect(ids(moveCardOnBoard(capped, "e", "IN_PROGRESS", "x").columns[0].issues)).toEqual(["b", "c"]);
  });

  it("leaves an unknown count unknown, and works hasMore out from a known one", () => {
    const before = board([column("TODO", [a], { totalCount: null, hasMore: null }), column("DONE", [d], { totalCount: 1 })]);
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

  // The board query's entries carry the window they were read under beside
  // the answer (TAS-532); «Show more» continues with its `doneSince`.
  it("keeps what the board was read with beside the answer", () => {
    const read = { ...board([column("TODO", [a]), column("DONE", [d])]), doneWindow: "2w" as const, doneSince: "2026-11-03T00:00:00.000Z" };
    expect(moveCardOnBoard(read, "a", "DONE", "x")).toMatchObject({ doneWindow: "2w", doneSince: "2026-11-03T00:00:00.000Z" });
    expect(withoutCardOnBoard(read, "a")).toMatchObject({ doneSince: "2026-11-03T00:00:00.000Z" });
    expect(withCardVersion(read, "a", 2, "x")).toMatchObject({ doneSince: "2026-11-03T00:00:00.000Z" });
    expect(withColumnPage(read, { statusKey: "DONE", issues: [e], totalCount: 2, hasMore: false })).toMatchObject({
      doneSince: "2026-11-03T00:00:00.000Z",
    });
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

  // Backend TAS-525: a done column continues by the last change, and the
  // gateway refuses the other kind of cursor with a 400 — the bug of TAS-532.
  it("continues a done column after the last card's updatedAt, by the column's category and not its key", () => {
    const touched = card("t", "2026-01-01", "DONE", "2026-11-16T10:00:00Z");
    expect(columnCursor(column("DONE", [touched]))).toEqual({ afterUpdatedAt: "2026-11-16T10:00:00Z", afterId: "t" });
    expect(columnCursor(column("RELEASED", [touched], { category: "DONE" }))).toEqual({
      afterUpdatedAt: "2026-11-16T10:00:00Z",
      afterId: "t",
    });
    // A key called DONE that the merged column files under another category.
    expect(columnCursor(column("DONE", [touched], { category: "IN_PROGRESS" }))).toEqual({
      afterCreatedAt: "2026-01-01",
      afterId: "t",
    });
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

  /**
   * §4.9 «Перечитывание» (release-reviewer, TAS-438): an expanded column's
   * tail is read again with the board, to the same depth, and every kept card
   * is the server's copy — never the one drawn before.
   */
  describe("across a re-read of the board", () => {
    const fresh = (issues: BoardIssue[], over: Partial<BoardColumn> = {}) =>
      board([column("TODO", issues, { totalCount: 5, hasMore: true, ...over }), column("DONE", [])]);
    const expanded = board([column("TODO", [a, b, c, d], { totalCount: 5, hasMore: true }), column("DONE", [])]);
    /** A server holding `cards` in the column, read after a cursor; every read recorded. */
    const server = (cards: BoardIssue[], fail = false) => {
      const reads: { statusKey: string; afterId: string; pageSize: number }[] = [];
      const read = async (statusKey: string, cursor: ColumnCursor, pageSize: number) => {
        reads.push({ statusKey, afterId: cursor.afterId, pageSize });
        if (fail) throw new Error("issue-service is unavailable");
        const index = cards.findIndex((issue) => issue.id === cursor.afterId);
        const after = cards.slice(index + 1);
        return page(after.slice(0, pageSize), { totalCount: cards.length, hasMore: after.length > pageSize });
      };
      return { read, reads };
    };

    it("reads the column again after the board's page, as deep as it was drawn, and draws the server's copies", async () => {
      const edited = { ...c, summary: "edited elsewhere", version: 7 };
      const { read, reads } = server([a, b, edited, d, e]);

      const next = await withColumnTails(fresh([a, b]), expanded, read, 200);

      expect(reads).toEqual([{ statusKey: "TODO", afterId: "b", pageSize: 2 }]);
      expect(ids(next.columns[0].issues)).toEqual(["a", "b", "c", "d"]);
      // The server's copy, not the one drawn before.
      expect(next.columns[0].issues[2]).toBe(edited);
      expect(next.columns[0]).toMatchObject({ totalCount: 5, hasMore: true });
      // Done was not expanded: the board's own column, untouched.
      expect(reads.every((item) => item.statusKey === "TODO")).toBe(true);
    });

    it("drops a card that left the column, and fills its place from the server's order", async () => {
      // `c` was deleted elsewhere: the tail is read to the same depth and finds `d` and `e`.
      const { read } = server([a, b, d, e]);
      const next = await withColumnTails(fresh([a, b], { totalCount: 4 }), expanded, read, 200);
      expect(ids(next.columns[0].issues)).toEqual(["a", "b", "d", "e"]);
      expect(next.columns[0]).toMatchObject({ totalCount: 4, hasMore: false });
    });

    it("reads at most the page limit at a time, in turn, while the server says more follow", async () => {
      const { read, reads } = server([a, b, c, d, e]);
      const deep = board([column("TODO", [a, b, c, d, e], { totalCount: 5, hasMore: false })]);
      const next = await withColumnTails(board([column("TODO", [a], { totalCount: 5, hasMore: true })]), deep, read, 2);
      expect(reads.map((item) => [item.afterId, item.pageSize])).toEqual([
        ["a", 2],
        ["c", 2],
      ]);
      expect(ids(next.columns[0].issues)).toEqual(["a", "b", "c", "d", "e"]);
      expect(next.columns[0].hasMore).toBe(false);
    });

    it("draws no tail card twice, nor one the board's read already draws in another column", async () => {
      const moved = card("c", "2026-01-03", "DONE");
      const { read } = server([a, b, c, d, e]);
      const next = await withColumnTails(
        board([column("TODO", [a, b], { totalCount: 5, hasMore: true }), column("DONE", [moved])]),
        expanded,
        read,
        200,
      );
      expect(ids(next.columns[0].issues)).toEqual(["a", "b", "d"]);
    });

    it("puts a column whose tail could not be read back to its first page, and leaves the rest of the board", async () => {
      const { read } = server([a, b, c, d, e], true);
      const answer = fresh([a, b]);
      const next = await withColumnTails(answer, expanded, read, 200);
      expect(next.columns[0]).toBe(answer.columns[0]);
      expect(next.columns[0].hasMore).toBe(true);
    });

    it("reads a done column's tail after the board's last card by its updatedAt, page after page", async () => {
      // Newest change first (backend TAS-525).
      const done = [5, 4, 3, 2, 1].map((n) => card(`d${n}`, `2026-01-0${n}`, "DONE", `2026-11-1${n}T00:00:00Z`));
      const cursors: ColumnCursor[] = [];
      const read = async (_statusKey: string, cursor: ColumnCursor, pageSize: number) => {
        cursors.push(cursor);
        const after = done.slice(done.findIndex((issue) => issue.id === cursor.afterId) + 1);
        return page(after.slice(0, pageSize), { statusKey: "DONE", totalCount: 5, hasMore: after.length > pageSize });
      };
      const was = board([column("DONE", done, { totalCount: 5, hasMore: false })]);
      const next = await withColumnTails(board([column("DONE", done.slice(0, 1), { totalCount: 5, hasMore: true })]), was, read, 2);

      expect(cursors).toEqual([
        { afterUpdatedAt: "2026-11-15T00:00:00Z", afterId: "d5" },
        { afterUpdatedAt: "2026-11-13T00:00:00Z", afterId: "d3" },
      ]);
      expect(ids(next.columns[0].issues)).toEqual(["d5", "d4", "d3", "d2", "d1"]);
    });

    it("reads nothing for a column that was not expanded, is whole now, or when nothing was drawn before", async () => {
      const { read, reads } = server([a, b, c, d, e]);
      const whole = fresh([a, b, c], { totalCount: 3, hasMore: false });
      expect(await withColumnTails(whole, expanded, read, 200)).toBe(whole);
      const again = fresh([a, b]);
      expect(await withColumnTails(again, board([column("TODO", [a, b], { totalCount: 5, hasMore: true })]), read, 200)).toBe(
        again,
      );
      expect(await withColumnTails(again, undefined, read, 200)).toBe(again);
      expect(reads).toEqual([]);
    });
  });
});
