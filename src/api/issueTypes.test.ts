import { describe, expect, it } from "vitest";
import { projectIssueTypePatchBody, toProjectIssueType, toProjectIssueTypes } from "./issueTypes";

/**
 * `ProjectIssueTypeDto[]` off the wire (backend #212, TAS-418): what the
 * context and the reorder's answer are read through before any screen draws a
 * type.
 */
describe("toProjectIssueTypes", () => {
  const task = { code: "TASK", name: "Task", color: "blue", icon: "check-square", sortOrder: 10 };

  it("keeps the order sent — never re-sorted — even against sortOrder", () => {
    const registry = toProjectIssueTypes([
      { ...task, code: "STORY", sortOrder: 30 },
      task,
      { ...task, code: "BUG", sortOrder: 20 },
    ]);
    expect(registry.map((entry) => entry.code)).toEqual(["STORY", "TASK", "BUG"]);
  });

  it("keeps the first of a repeated code and drops an entry with no usable code", () => {
    const registry = toProjectIssueTypes([
      task,
      { ...task, name: "Second task" },
      { ...task, code: "" },
      { ...task, code: "   " },
      { ...task, code: 7 },
      { ...task, code: undefined },
      null,
      "TASK",
      { ...task, code: "EPIC" },
    ]);
    expect(registry.map((entry) => [entry.code, entry.name])).toEqual([
      ["TASK", "Task"],
      ["EPIC", "Task"],
    ]);
  });

  it("reads a blank or missing name as the code: a type is never drawn nameless", () => {
    expect(toProjectIssueType({ ...task, name: "  " })?.name).toBe("TASK");
    expect(toProjectIssueType({ ...task, name: undefined })?.name).toBe("TASK");
  });

  it("reads a colour or an icon outside the contract's sets as null, which the chip draws neutral", () => {
    expect(toProjectIssueType({ ...task, color: "pink", icon: "rocket" })).toMatchObject({ color: null, icon: null });
    expect(toProjectIssueType({ ...task, color: "BLUE", icon: null })).toMatchObject({ color: null, icon: null });
    expect(toProjectIssueType({ ...task, color: "teal", icon: "headset" })).toMatchObject({ color: "teal", icon: "headset" });
  });

  it("reads a sortOrder that is not a whole number as 0", () => {
    expect(toProjectIssueType({ ...task, sortOrder: 1.5 })?.sortOrder).toBe(0);
    expect(toProjectIssueType({ ...task, sortOrder: "10" })?.sortOrder).toBe(0);
  });

  it("reads anything but an array as an empty registry", () => {
    expect(toProjectIssueTypes(undefined)).toEqual([]);
    expect(toProjectIssueTypes({ items: [task] })).toEqual([]);
  });
});

describe("projectIssueTypePatchBody", () => {
  it("copies the four declared keys by name, never null, never the code", () => {
    expect(
      projectIssueTypePatchBody({ name: "Epics", color: null, icon: undefined, ...({ code: "X", extra: 1 } as object) }),
    ).toEqual({ name: "Epics" });
  });
});
