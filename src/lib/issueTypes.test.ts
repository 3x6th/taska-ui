import { describe, expect, it } from "vitest";
import type { ProjectIssueType } from "../domain/types";
import {
  defaultIssueTypeColor,
  issueTypeCodeOf,
  issueTypeDeleteRefusalText,
  movedIssueTypeCodes,
  nextIssueTypeSortOrder,
  withIssueTypeOrder,
} from "./issueTypes";

const entry = (code: string, sortOrder: number, color: ProjectIssueType["color"] = "blue"): ProjectIssueType => ({
  code,
  name: code,
  color,
  shape: "diamond",
  icon: "flag",
  sortOrder,
});
// A migrated project's default at 0, and a tie — the orders the old gap rule
// could not move through in one write (backend ask A1, closed by TAS-418).
const registry = [entry("TASK", 0), entry("BUG", 20), entry("STORY", 20), entry("EPIC", 21)];

/** DESIGN.md §4.30 since backend TAS-418: one press, one PUT of the whole order. */
describe("movedIssueTypeCodes", () => {
  it("swaps the type with its neighbour and sends the whole order, ties and a zero included", () => {
    expect(movedIssueTypeCodes(registry, 1, "up")).toEqual(["BUG", "TASK", "STORY", "EPIC"]);
    expect(movedIssueTypeCodes(registry, 1, "down")).toEqual(["TASK", "STORY", "BUG", "EPIC"]);
    expect(movedIssueTypeCodes(registry, 2, "down")).toEqual(["TASK", "BUG", "EPIC", "STORY"]);
  });

  it("has nothing to send at the list's ends, or for a row that is not there", () => {
    expect(movedIssueTypeCodes(registry, 0, "up")).toBeNull();
    expect(movedIssueTypeCodes(registry, 3, "down")).toBeNull();
    expect(movedIssueTypeCodes(registry, 7, "up")).toBeNull();
    expect(movedIssueTypeCodes([entry("TASK", 10)], 0, "down")).toBeNull();
  });
});

describe("withIssueTypeOrder", () => {
  it("draws the order pressed, numbered 10, 20, 30… as the server will number it", () => {
    const moved = withIssueTypeOrder(registry, ["BUG", "TASK", "STORY", "EPIC"]);
    expect(moved.map((item) => [item.code, item.sortOrder])).toEqual([
      ["BUG", 10],
      ["TASK", 20],
      ["STORY", 30],
      ["EPIC", 40],
    ]);
    // Nothing else of an entry changes.
    expect(moved[0]).toMatchObject({ name: "BUG", color: "blue", shape: "diamond", icon: "flag" });
  });
});

describe("the form's derivations", () => {
  it("spells a code from what is typed: capitals, _ for spaces and hyphens, nothing else, 32 at most", () => {
    expect(issueTypeCodeOf("Customer request")).toBe("CUSTOMER_REQUEST");
    expect(issueTypeCodeOf("hot-fix 2!")).toBe("HOT_FIX_2");
    // Cyrillic derives nothing: the code has to be typed.
    expect(issueTypeCodeOf("Заявка")).toBe("");
    expect(issueTypeCodeOf("x".repeat(40))).toHaveLength(32);
  });

  it("starts a new type in the first colour nobody wears, else blue, and after the last", () => {
    expect(defaultIssueTypeColor([entry("A", 10, "blue"), entry("B", 20, "red")])).toBe("green");
    const everyColour = (["blue", "red", "green", "amber", "purple", "teal", "slate"] as const).map((color, index) =>
      entry(`T${index}`, index, color),
    );
    expect(defaultIssueTypeColor(everyColour)).toBe("blue");
    expect(nextIssueTypeSortOrder(registry)).toBe(31);
    expect(nextIssueTypeSortOrder([])).toBe(10);
  });
});

/** §4.30: a refused delete is worded by `details.reason`, never by the server's prose. */
describe("issueTypeDeleteRefusalText", () => {
  const refusal = (details: Record<string, string> | null, message = "Something the server said") =>
    Object.assign(new Error(message), { code: "FAILED_PRECONDITION", status: 400, details });

  it("names how many live issues have the type", () => {
    expect(issueTypeDeleteRefusalText(refusal({ reason: "ISSUE_TYPE_IN_USE", issueCount: "3" }), "Epic")).toBe(
      "Epic was not deleted: 3 issues have this type. Change their type first.",
    );
    expect(issueTypeDeleteRefusalText(refusal({ reason: "ISSUE_TYPE_IN_USE", issueCount: "1" }), "Epic")).toBe(
      "Epic was not deleted: 1 issue has this type. Change their type first.",
    );
  });

  it("says issues still have the type when the count does not parse", () => {
    for (const issueCount of ["", "many", "-1", "1e3"]) {
      expect(issueTypeDeleteRefusalText(refusal({ reason: "ISSUE_TYPE_IN_USE", issueCount }), "Epic")).toBe(
        "Epic was not deleted: issues still have this type. Change their type first.",
      );
    }
    expect(issueTypeDeleteRefusalText(refusal({ reason: "ISSUE_TYPE_IN_USE" }), "Epic")).toBe(
      "Epic was not deleted: issues still have this type. Change their type first.",
    );
  });

  it("says a project needs a type on LAST_ISSUE_TYPE", () => {
    expect(issueTypeDeleteRefusalText(refusal({ reason: "LAST_ISSUE_TYPE" }), "Task")).toBe(
      "Task was not deleted: a project needs at least one issue type.",
    );
  });

  it("never reads the prose or a bare count: anything else is just 'was not deleted'", () => {
    // The old shape — a count with no reason — and the server's in-use sentence alone.
    expect(issueTypeDeleteRefusalText(refusal({ issueCount: "3" }), "Epic")).toBe("Epic was not deleted.");
    expect(issueTypeDeleteRefusalText(refusal(null, "Issue type EPIC has 3 issues"), "Epic")).toBe("Epic was not deleted.");
    expect(issueTypeDeleteRefusalText(refusal({ reason: "PROJECT_ARCHIVED" }), "Epic")).toBe("Epic was not deleted.");
    expect(issueTypeDeleteRefusalText(new Error("network"), "Epic")).toBe("Epic was not deleted.");
  });
});
