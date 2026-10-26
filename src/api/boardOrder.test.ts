import { describe, expect, it } from "vitest";
import { compareBoardIssues } from "./boardOrder";

/**
 * The one order a card is placed in without the server (DESIGN.md §5.3, backend
 * TAS-392): the oldest first, then the id — and the type plays no part.
 */
describe("compareBoardIssues", () => {
  const card = (id: string, issueType: string, createdAt: string) => ({ id, issueType, createdAt });

  it("ignores the type: an older STORY stands before a newer TASK", () => {
    const sorted = [
      card("task", "TASK", "2026-06-01T00:00:00Z"),
      card("epic", "EPIC", "2026-03-01T00:00:00Z"),
      card("story", "STORY", "2026-01-01T00:00:00Z"),
      card("bug", "BUG", "2026-02-01T00:00:00Z"),
    ].sort(compareBoardIssues);

    expect(sorted.map((item) => item.id)).toEqual(["story", "bug", "epic", "task"]);
  });

  it("puts the oldest first, comparing instants rather than text", () => {
    const sorted = [
      card("a", "TASK", "2026-06-02T00:00:00Z"),
      // The same instant as the first, spelled with an offset: not earlier.
      card("b", "TASK", "2026-06-02T03:00:00+03:00"),
      card("c", "BUG", "2026-06-01T23:00:00Z"),
    ].sort(compareBoardIssues);

    expect(sorted.map((item) => item.id)).toEqual(["c", "a", "b"]);
  });

  it("puts a card with no readable date after every dated one, then by id", () => {
    const sorted = [
      card("b", "TASK", ""),
      card("z", "BUG", "2026-06-01T00:00:00Z"),
      card("a", "STORY", "not a date"),
      card("y", "TASK", "2026-01-01T00:00:00Z"),
    ].sort(compareBoardIssues);

    expect(sorted.map((item) => item.id)).toEqual(["y", "z", "a", "b"]);
  });

  it("breaks a tie on the id across types, so the order is total", () => {
    const sorted = [card("b", "TASK", "2026-06-01T00:00:00Z"), card("a", "BUG", "2026-06-01T00:00:00Z")].sort(
      compareBoardIssues,
    );

    expect(sorted.map((item) => item.id)).toEqual(["a", "b"]);
  });
});
