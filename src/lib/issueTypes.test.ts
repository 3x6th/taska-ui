import { describe, expect, it } from "vitest";
import type { ProjectIssueType } from "../domain/types";
import {
  defaultIssueTypeColor,
  inUseCountOf,
  isIssueStatusesUnmapped,
  isIssueTypeInUse,
  isIssueTypeReplaced,
  isIssueTypeTargetInvalid,
  issueTypeCodeOf,
  issueTypeDeleteRefusalText,
  issueTypeMoveSentence,
  issueTypeOrderRefusal,
  issueTypeStatusesSentence,
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

  // Backend TAS-433: ISSUE_TYPE_IN_USE is the move step's cue (`isIssueTypeInUse`), not a slot sentence.
  it("names the step's count by issueCount — 'it' for one, none when it does not parse", () => {
    const inUse = (issueCount?: string) =>
      refusal({ reason: "ISSUE_TYPE_IN_USE", ...(issueCount === undefined ? {} : { issueCount }) });
    expect(isIssueTypeInUse(inUse("3"))).toBe(true);
    expect(isIssueTypeInUse(Object.assign(inUse("3"), { code: "ABORTED" }))).toBe(false);
    expect(issueTypeMoveSentence(inUseCountOf(inUse("3")), "Epic")).toBe(
      "3 issues have this type. Move them to another type to delete Epic.",
    );
    expect(issueTypeMoveSentence(inUseCountOf(inUse("1")), "Epic")).toBe(
      "1 issue has this type. Move it to another type to delete Epic.",
    );
    for (const issueCount of ["", "many", "-1", "1e3", undefined]) {
      expect(issueTypeMoveSentence(inUseCountOf(inUse(issueCount)), "Epic")).toBe(
        "Issues have this type. Move them to another type to delete Epic.",
      );
    }
    expect(issueTypeStatusesSentence(3, "Task")).toBe(
      "3 issues have this type. Some are in a status Task issues cannot have, so choose where each status’s issues go.",
    );
    expect(issueTypeStatusesSentence(null, "Task")).toBe(
      "Issues have this type. Some are in a status Task issues cannot have, so choose where each status’s issues go.",
    );
    expect(issueTypeStatusesSentence(1, "Task")).toBe(
      "1 issue has this type. It is in a status Task issues cannot have, so choose where it goes.",
    );
  });

  it("tells the step's refusals apart by code and reason only", () => {
    const with_ = (code: string, reason: string) => Object.assign(new Error("words"), { code, details: { reason } });
    expect(isIssueTypeReplaced(with_("ABORTED", "ISSUE_TYPE_CHANGED"))).toBe(true);
    expect(isIssueTypeReplaced(with_("ABORTED", "ISSUE_TYPE_GENERATION_REQUIRED"))).toBe(true);
    expect(isIssueTypeReplaced(with_("FAILED_PRECONDITION", "ISSUE_TYPE_CHANGED"))).toBe(false);
    expect(isIssueTypeTargetInvalid(with_("INVALID_ARGUMENT", "ISSUE_TYPE_TARGET_INVALID"))).toBe(true);
    expect(isIssueTypeTargetInvalid(with_("FAILED_PRECONDITION", "ISSUE_TYPE_TARGET_INVALID"))).toBe(false);
    expect(isIssueStatusesUnmapped(with_("FAILED_PRECONDITION", "ISSUE_STATUSES_UNMAPPED"))).toBe(true);
    expect(isIssueStatusesUnmapped(with_("INVALID_ARGUMENT", "ISSUE_STATUSES_UNMAPPED"))).toBe(false);
  });

  it("says a project needs a type on LAST_ISSUE_TYPE", () => {
    expect(issueTypeDeleteRefusalText(refusal({ reason: "LAST_ISSUE_TYPE" }), "Task")).toBe(
      "Task was not deleted: a project needs at least one issue type.",
    );
  });

  it("never reads the prose or a bare count: anything else is just 'was not deleted'", () => {
    // The old shape — a count with no reason — and the server's in-use sentence alone.
    expect(issueTypeDeleteRefusalText(refusal({ issueCount: "3" }), "Epic")).toBe("Epic was not deleted.");
    expect(issueTypeDeleteRefusalText(refusal({ reason: "ISSUE_TYPE_IN_USE", issueCount: "3" }), "Epic")).toBe(
      "Epic was not deleted.",
    );
    expect(issueTypeDeleteRefusalText(refusal(null, "Issue type EPIC has 3 issues"), "Epic")).toBe("Epic was not deleted.");
    expect(issueTypeDeleteRefusalText(refusal({ reason: "PROJECT_ARCHIVED" }), "Epic")).toBe("Epic was not deleted.");
    expect(issueTypeDeleteRefusalText(new Error("network"), "Epic")).toBe("Epic was not deleted.");
  });
});

/**
 * A refused move (§4.30): the stale registry's 409 `ABORTED`
 * `ISSUE_TYPES_CHANGED` (backend TAS-429) has its own sentence and only the
 * request id; anything else the general one with the server's words.
 */
describe("issueTypeOrderRefusal", () => {
  const refusal = (code: string, status: number, details: Record<string, string> | null) =>
    Object.assign(new Error("Issue type registry changed; reload the current types before reordering"), {
      code,
      status,
      details,
    });
  const changed = {
    sentence: "Issue types changed elsewhere, so the new order was not saved. The list now shows the current types.",
    serverWords: false,
  };
  const general = { sentence: "The new order was not saved. The list now shows the saved order.", serverWords: true };

  it("says the types changed elsewhere on ABORTED with ISSUE_TYPES_CHANGED, without the server's words", () => {
    expect(issueTypeOrderRefusal(refusal("ABORTED", 409, { reason: "ISSUE_TYPES_CHANGED" }))).toEqual(changed);
  });

  it("branches on the code and the reason together, never on the prose", () => {
    // The pre-TAS-429 shape: the same words, a bad request, no reason.
    expect(issueTypeOrderRefusal(refusal("INVALID_ARGUMENT", 400, null))).toEqual(general);
    expect(issueTypeOrderRefusal(refusal("ABORTED", 409, null))).toEqual(general);
    expect(issueTypeOrderRefusal(refusal("FAILED_PRECONDITION", 400, { reason: "ISSUE_TYPES_CHANGED" }))).toEqual(general);
    expect(issueTypeOrderRefusal(refusal("FAILED_PRECONDITION", 400, { reason: "PROJECT_ARCHIVED" }))).toEqual(general);
    expect(issueTypeOrderRefusal(new Error("network"))).toEqual(general);
  });
});
