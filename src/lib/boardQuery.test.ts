import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardColumnPageParams, BoardParams } from "../api/TaskaApi";
import type { Board, BoardIssue } from "../domain/types";

/**
 * The board read and its continuations under the Done window (TAS-532,
 * DESIGN.md §4.13, §4.9 «Перечитывание», §6): one `doneSince` per read, the
 * window's name — never the moment — in the key, and that read's tail re-read
 * sent with the very `doneSince` it went out with.
 */
const api = vi.hoisted(() => ({
  getBoard: vi.fn<(projectId: string, params?: BoardParams) => Promise<Board>>(),
  getBoardColumnPage: vi.fn<(projectId: string, statusKey: string, params?: BoardColumnPageParams) => Promise<unknown>>(),
}));
vi.mock("../api/client", () => ({ taskaApi: api }));

const { BOARD_DONE_WINDOW_MS, LINK_PICKER_VIEW, NO_BOARD_FILTERS, boardColumnPageParams, boardQueryOptions, boardReadKey, doneSinceFor, isFiltered } =
  await import("./boardQuery");

const card = (id: string, updatedAt: string): BoardIssue => ({
  id,
  issueKey: id.toUpperCase(),
  summary: id,
  issueType: "TASK",
  priority: "LOW",
  statusKey: "DONE",
  description: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt,
  version: 1,
  assignee: null,
  labels: [],
});
const doneBoard = (issues: BoardIssue[], totalCount: number): Board => ({
  projectId: "p",
  columns: [{ statusKey: "DONE", name: "Done", category: "DONE", sortOrder: 30, issues, totalCount, hasMore: totalCount > issues.length }],
  unplacedIssues: [],
  unplacedTotalCount: 0,
  unplacedHasMore: false,
});

const NOW = Date.parse("2026-11-17T09:00:00Z");

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  api.getBoard.mockReset();
  api.getBoardColumnPage.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the Done window's cut", () => {
  it("is the read's moment less 14×24 hours under «2 weeks», and nothing under «All»", () => {
    expect(BOARD_DONE_WINDOW_MS).toBe(1_209_600_000);
    expect(doneSinceFor("2w")).toBe("2026-11-03T09:00:00.000Z");
    expect(doneSinceFor("2w", Date.parse("2026-03-29T12:00:00Z"))).toBe("2026-03-15T12:00:00.000Z");
    expect(doneSinceFor("all")).toBeNull();
  });

  it("keys a read on the window's name, which is no filter", () => {
    const view = { ...NO_BOARD_FILTERS, doneWindow: "2w" as const };
    expect(boardReadKey("p", view)).toEqual([
      "board",
      "p",
      { issueType: null, assigneeId: null, labelId: null, query: null, doneWindow: "2w" },
    ]);
    expect(boardReadKey("p", LINK_PICKER_VIEW)[2]).toMatchObject({ doneWindow: "all" });
    expect(isFiltered(view)).toBe(false);
    expect(isFiltered({ ...view, labelId: "l" })).toBe(true);
  });

  it("sends doneSince with a column's page only when the board read sent one", () => {
    const cursor = { afterUpdatedAt: "2026-11-16T10:00:00Z", afterId: "d1" };
    expect(boardColumnPageParams({ ...NO_BOARD_FILTERS, query: "x" }, "2026-11-03T09:00:00.000Z", cursor)).toEqual({
      afterUpdatedAt: "2026-11-16T10:00:00Z",
      afterId: "d1",
      includeDone: true,
      query: "x",
      doneSince: "2026-11-03T09:00:00.000Z",
      pageSize: 200,
    });
    expect(boardColumnPageParams(NO_BOARD_FILTERS, null, cursor, 5)).toEqual({ ...cursor, includeDone: true, pageSize: 5 });
  });
});

describe("a board read under the Done window", () => {
  it("sends doneSince under «2 weeks», none under «All», and keeps both beside the answer", async () => {
    const client = new QueryClient();
    api.getBoard.mockResolvedValue(doneBoard([], 0));

    const recent = await client.fetchQuery(boardQueryOptions("p", { ...NO_BOARD_FILTERS, doneWindow: "2w" }));
    const all = await client.fetchQuery(boardQueryOptions("p", LINK_PICKER_VIEW));

    expect(api.getBoard.mock.calls.map(([, params]) => params)).toEqual([
      { includeDone: true, doneSince: "2026-11-03T09:00:00.000Z", pageSizePerColumn: 200 },
      { includeDone: true, pageSizePerColumn: 200 },
    ]);
    expect(recent).toMatchObject({ doneWindow: "2w", doneSince: "2026-11-03T09:00:00.000Z" });
    expect(all).toMatchObject({ doneWindow: "all", doneSince: null });
  });

  // §4.9 «Перечитывание»: an expanded done column is read again after the
  // board's last card by its `updatedAt`, under the `doneSince` this read sent.
  it("reads an expanded done column's tail again with this read's doneSince, after its last card's updatedAt", async () => {
    const client = new QueryClient();
    const view = { ...NO_BOARD_FILTERS, doneWindow: "2w" as const };
    const [d3, d2, d1] = [card("d3", "2026-11-16T00:00:00Z"), card("d2", "2026-11-15T00:00:00Z"), card("d1", "2026-11-14T00:00:00Z")];
    // What «Show more» had drawn: all three.
    client.setQueryData(boardReadKey("p", view), { ...doneBoard([d3, d2, d1], 3), doneWindow: "2w", doneSince: "2026-11-03T08:00:00.000Z" });
    api.getBoard.mockResolvedValue(doneBoard([d3], 3));
    api.getBoardColumnPage.mockResolvedValue({ statusKey: "DONE", issues: [d2, d1], totalCount: 3, hasMore: false });
    // A minute on: this read's own moment, not the previous read's.
    vi.spyOn(Date, "now").mockReturnValue(NOW + 60_000);

    const read = await client.fetchQuery({ ...boardQueryOptions("p", view), staleTime: 0 });

    expect(api.getBoard.mock.calls[0][1]).toMatchObject({ doneSince: "2026-11-03T09:01:00.000Z" });
    expect(api.getBoardColumnPage.mock.calls).toEqual([
      [
        "p",
        "DONE",
        {
          afterUpdatedAt: "2026-11-16T00:00:00Z",
          afterId: "d3",
          includeDone: true,
          doneSince: "2026-11-03T09:01:00.000Z",
          pageSize: 2,
        },
      ],
    ]);
    expect(read.columns[0].issues.map((issue) => issue.id)).toEqual(["d3", "d2", "d1"]);
    expect(read.doneSince).toBe("2026-11-03T09:01:00.000Z");
  });
});
