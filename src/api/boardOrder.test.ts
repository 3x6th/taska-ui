import { describe, expect, it } from "vitest";
import { boardIssueOrder, compareByCreatedAt, compareByUpdatedAt, isDoneCategory } from "./boardOrder";

/**
 * The order a card is placed in without the server outside a done column
 * (DESIGN.md §5.3, backend TAS-392): the oldest first, then the id — and the
 * type plays no part.
 */
describe("compareByCreatedAt", () => {
  const card = (id: string, issueType: string, createdAt: string) => ({ id, issueType, createdAt });

  it("ignores the type: an older STORY stands before a newer TASK", () => {
    const sorted = [
      card("task", "TASK", "2026-06-01T00:00:00Z"),
      card("epic", "EPIC", "2026-03-01T00:00:00Z"),
      card("story", "STORY", "2026-01-01T00:00:00Z"),
      card("bug", "BUG", "2026-02-01T00:00:00Z"),
    ].sort(compareByCreatedAt);

    expect(sorted.map((item) => item.id)).toEqual(["story", "bug", "epic", "task"]);
  });

  it("puts the oldest first, comparing instants rather than text", () => {
    const sorted = [
      card("a", "TASK", "2026-06-02T00:00:00Z"),
      // The same instant as the first, spelled with an offset: not earlier.
      card("b", "TASK", "2026-06-02T03:00:00+03:00"),
      card("c", "BUG", "2026-06-01T23:00:00Z"),
    ].sort(compareByCreatedAt);

    expect(sorted.map((item) => item.id)).toEqual(["c", "a", "b"]);
  });

  it("puts a card with no readable date after every dated one, then by id", () => {
    const sorted = [
      card("b", "TASK", ""),
      card("z", "BUG", "2026-06-01T00:00:00Z"),
      card("a", "STORY", "not a date"),
      card("y", "TASK", "2026-01-01T00:00:00Z"),
    ].sort(compareByCreatedAt);

    expect(sorted.map((item) => item.id)).toEqual(["y", "z", "a", "b"]);
  });

  it("breaks a tie on the id across types, so the order is total", () => {
    const sorted = [card("b", "TASK", "2026-06-01T00:00:00Z"), card("a", "BUG", "2026-06-01T00:00:00Z")].sort(
      compareByCreatedAt,
    );

    expect(sorted.map((item) => item.id)).toEqual(["a", "b"]);
  });
});

/**
 * A done column's order (DESIGN.md §5.3, backend TAS-525): `updatedAt` newest
 * first, then the id **descending** — `ORDER BY updated_at DESC, id DESC` —
 * and the creation date plays no part.
 */
describe("compareByUpdatedAt", () => {
  const card = (id: string, updatedAt: string, createdAt = "2026-01-01T00:00:00Z") => ({ id, updatedAt, createdAt });

  it("puts the last change first, whenever the issue was made", () => {
    const sorted = [
      card("old-touched", "2026-11-10T00:00:00Z", "2026-01-01T00:00:00Z"),
      card("new-untouched", "2026-09-01T00:00:00Z", "2026-09-01T00:00:00Z"),
      card("touched-last", "2026-11-16T00:00:00Z", "2026-05-01T00:00:00Z"),
    ].sort(compareByUpdatedAt);

    expect(sorted.map((item) => item.id)).toEqual(["touched-last", "old-touched", "new-untouched"]);
  });

  it("compares instants rather than text", () => {
    const sorted = [
      card("a", "2026-06-02T00:00:00Z"),
      // The same instant as the first, spelled with an offset: a tie, so by id.
      card("b", "2026-06-02T03:00:00+03:00"),
      card("c", "2026-06-01T23:00:00Z"),
    ].sort(compareByUpdatedAt);

    expect(sorted.map((item) => item.id)).toEqual(["b", "a", "c"]);
  });

  it("breaks a tie on the id, descending, and puts a card with no readable date last", () => {
    const sorted = [
      card("a", "2026-06-01T00:00:00Z"),
      card("x", "not a date"),
      card("c", "2026-06-01T00:00:00Z"),
      card("y", ""),
      card("b", "2026-06-01T00:00:00Z"),
    ].sort(compareByUpdatedAt);

    expect(sorted.map((item) => item.id)).toEqual(["c", "b", "a", "y", "x"]);
  });
});

describe("boardIssueOrder", () => {
  it("orders a DONE column by its last change and every other one, and the unplaced bucket, by creation", () => {
    expect(boardIssueOrder("DONE")).toBe(compareByUpdatedAt);
    for (const category of ["TODO", "IN_PROGRESS", "BLOCKED", "done", null, undefined]) {
      expect(boardIssueOrder(category)).toBe(compareByCreatedAt);
    }
    expect(isDoneCategory("DONE")).toBe(true);
    // The gateway compares the category as written (`"DONE".equals(...)`).
    expect(isDoneCategory("Done")).toBe(false);
  });
});
