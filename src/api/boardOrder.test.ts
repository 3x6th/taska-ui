import { describe, expect, it } from "vitest";
import { compareBoardIssues } from "./boardOrder";

/**
 * The one order a card is placed in without the server (TAS-202,
 * art-director's B1): the type's rank, then the oldest first, then the id.
 */
describe("compareBoardIssues", () => {
  const card = (id: string, issueType: string, createdAt: string) => ({ id, issueType, createdAt });

  it("groups TASK, BUG and STORY in that order, any other code after them", () => {
    const sorted = [
      card("a", "EPIC", "2026-01-01T00:00:00Z"),
      card("b", "STORY", "2026-01-01T00:00:00Z"),
      card("c", "BUG", "2026-01-01T00:00:00Z"),
      card("d", "TASK", "2026-06-01T00:00:00Z"),
    ].sort(compareBoardIssues);

    expect(sorted.map((item) => item.issueType)).toEqual(["TASK", "BUG", "STORY", "EPIC"]);
  });

  it("puts the oldest first inside a type, comparing instants rather than text", () => {
    const sorted = [
      card("a", "TASK", "2026-06-02T00:00:00Z"),
      // The same instant as the first, spelled with an offset: not earlier.
      card("b", "TASK", "2026-06-02T03:00:00+03:00"),
      card("c", "TASK", "2026-06-01T23:00:00Z"),
    ].sort(compareBoardIssues);

    expect(sorted.map((item) => item.id)).toEqual(["c", "a", "b"]);
  });

  it("breaks a tie on the id, so the order is total", () => {
    const sorted = [card("b", "BUG", "2026-06-01T00:00:00Z"), card("a", "BUG", "2026-06-01T00:00:00Z")].sort(
      compareBoardIssues,
    );

    expect(sorted.map((item) => item.id)).toEqual(["a", "b"]);
  });
});
