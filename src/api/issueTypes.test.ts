import { describe, expect, it } from "vitest";
import { projectIssueTypePatchBody, toProjectIssueType, toProjectIssueTypes } from "./issueTypes";

/**
 * `ProjectIssueTypeDto[]` off the wire (backend #212, TAS-418): what the
 * context and the reorder's answer are read through before any screen draws a
 * type.
 */
describe("toProjectIssueTypes", () => {
  const task = { code: "TASK", name: "Task", color: "blue", shape: "square", icon: null, sortOrder: 10 };

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

  it("reads the shape of backend TAS-432, and one outside the three — or missing — as null, drawn square", () => {
    expect(toProjectIssueType({ ...task, shape: "circle" })?.shape).toBe("circle");
    expect(toProjectIssueType({ ...task, shape: "diamond" })?.shape).toBe("diamond");
    expect(toProjectIssueType({ ...task, shape: "triangle" })?.shape).toBeNull();
    expect(toProjectIssueType({ ...task, shape: "Circle" })?.shape).toBeNull();
    expect(toProjectIssueType({ ...task, shape: null })?.shape).toBeNull();
    // A gateway that predates TAS-432 sends no shape at all.
    const { shape: _shape, ...withoutShape } = task;
    expect(toProjectIssueType(withoutShape)?.shape).toBeNull();
  });

  it("reads a missing icon and a null one alike: a type without an icon (backend TAS-432)", () => {
    const { icon: _icon, ...withoutIcon } = task;
    expect(toProjectIssueType(withoutIcon)).toEqual({
      code: "TASK",
      name: "Task",
      color: "blue",
      shape: "square",
      icon: null,
      sortOrder: 10,
    });
    expect(toProjectIssueType({ ...task, icon: null })).toEqual(toProjectIssueType(withoutIcon));
    expect(toProjectIssueType({ ...task, shape: "diamond", icon: "layers" })).toMatchObject({
      shape: "diamond",
      icon: "layers",
    });
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
  it("copies the five declared keys by name, never the code, and leaves out what is undefined", () => {
    expect(
      projectIssueTypePatchBody({
        name: "Epics",
        color: undefined,
        shape: "diamond",
        icon: undefined,
        ...({ code: "X", extra: 1 } as object),
      }),
    ).toEqual({ name: "Epics", shape: "diamond" });
  });

  it("sends icon: null — it removes the icon — and leaves out null for every other key (backend TAS-432)", () => {
    const body = projectIssueTypePatchBody({ name: null, color: null, shape: null, icon: null, sortOrder: null });
    expect(body).toEqual({ icon: null });
    expect(Object.keys(body)).toEqual(["icon"]);
    // Absent is not null: no icon key at all when none was stated.
    expect(projectIssueTypePatchBody({ shape: "circle" })).not.toHaveProperty("icon");
  });
});
