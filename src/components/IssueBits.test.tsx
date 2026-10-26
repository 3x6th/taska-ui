import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import type { IssueTypeIcon, IssueTypeShape, ProjectIssueType } from "../domain/types";
import { TypeChip, TypeLookChip } from "./IssueBits";

/**
 * DESIGN.md §4.6 since TAS-434: one 14×14 slot holding either the type's shape
 * filled with its colour or its icon stroked with it — never both — and the
 * out-of-dictionary fallbacks. The sizes and the paint are the stylesheet's
 * (measured in `e2e/issue-types.spec.ts`); this pins what the component
 * decides: which of the two, which figure, and which colour it hands over.
 */

const entry = (code: string, look: Partial<ProjectIssueType>): ProjectIssueType => ({
  code,
  name: code,
  color: "blue",
  shape: "square",
  icon: null,
  sortOrder: 10,
  ...look,
});

const chipOf = (ui: ReactElement) => {
  const { container } = render(ui);
  return container.querySelector(".type-chip") as HTMLElement;
};

describe("the type chip", () => {
  it.each([
    ["square", "is-square"],
    ["circle", "is-circle"],
    ["diamond", "is-diamond"],
  ] as const)("draws a type without an icon as its %s, filled, with no glyph", (shape, className) => {
    const chip = chipOf(<TypeChip registry={[entry("TASK", { shape, color: "red" })]} type="TASK" />);
    expect(chip).toHaveClass("type-chip", className);
    expect(chip).not.toHaveClass("is-icon");
    expect(chip.querySelector("svg")).toBeNull();
    expect(chip.style.getPropertyValue("--type-fill")).toBe("#e5544b");
    expect(chip).toHaveAttribute("title", "TASK");
  });

  it("draws the icon instead of the shape — the glyph at 14 with its 1.7 stroke, in the type's colour", () => {
    const chip = chipOf(<TypeChip registry={[entry("EPIC", { shape: "diamond", icon: "layers", color: "purple" })]} type="EPIC" />);
    expect(chip).toHaveClass("is-icon");
    for (const shape of ["is-square", "is-circle", "is-diamond"]) expect(chip).not.toHaveClass(shape);
    const glyph = chip.querySelector("svg") as SVGElement;
    expect(glyph).not.toBeNull();
    expect(glyph).toHaveAttribute("width", "14");
    expect(glyph).toHaveAttribute("aria-hidden", "true");
    expect(chip.style.getPropertyValue("--type-fill")).toBe("#8b5cf6");
  });

  it("draws a shape it does not know, or none, as the square — never a guessed circle", () => {
    for (const shape of [null, "triangle" as IssueTypeShape]) {
      const chip = chipOf(<TypeLookChip color="red" icon={null} shape={shape} />);
      expect(chip).toHaveClass("is-square");
      expect(chip.querySelector("svg")).toBeNull();
    }
  });

  it("draws an icon it does not know as the shape", () => {
    const chip = chipOf(<TypeLookChip color="teal" icon={"rocket" as IssueTypeIcon} shape="circle" />);
    expect(chip).toHaveClass("is-circle");
    expect(chip).not.toHaveClass("is-icon");
    expect(chip.querySelector("svg")).toBeNull();
    // Nor is the prototype read as a table entry.
    expect(chipOf(<TypeLookChip color="teal" icon={"constructor" as IssueTypeIcon} shape="square" />)).toHaveClass(
      "is-square",
    );
  });

  it("sets no colour for one it does not know, so the sheet's --fg-3 fills the shape or strokes the glyph", () => {
    expect(chipOf(<TypeLookChip color={null} icon={null} shape="circle" />).style.getPropertyValue("--type-fill")).toBe("");
    const glyph = chipOf(<TypeLookChip color={null} icon="flag" shape="square" />);
    expect(glyph).toHaveClass("is-icon");
    expect(glyph.style.getPropertyValue("--type-fill")).toBe("");
  });

  it("draws a key the registry does not hold, and a hit with no look, as the neutral square", () => {
    const missing = chipOf(<TypeChip registry={[entry("TASK", { shape: "circle" })]} type="SPIKE" />);
    expect(missing).toHaveClass("is-square");
    expect(missing.style.getPropertyValue("--type-fill")).toBe("");
    expect(missing).toHaveAttribute("title", "SPIKE");

    const orphan = chipOf(
      <TypeChip
        hit={{ issueTypeName: null, issueTypeColor: null, issueTypeShape: null, issueTypeIcon: null }}
        type="REQUEST"
      />,
    );
    expect(orphan).toHaveClass("is-square");
    expect(orphan.style.getPropertyValue("--type-fill")).toBe("");
  });

  it("draws a search hit by its own shape and icon (backend TAS-432)", () => {
    const circle = chipOf(
      <TypeChip
        hit={{ issueTypeName: "Bug", issueTypeColor: "red", issueTypeShape: "circle", issueTypeIcon: null }}
        type="BUG"
      />,
    );
    expect(circle).toHaveClass("is-circle");
    expect(circle.style.getPropertyValue("--type-fill")).toBe("#e5544b");

    const icon = chipOf(
      <TypeChip
        hit={{ issueTypeName: "Epic", issueTypeColor: "purple", issueTypeShape: "square", issueTypeIcon: "layers" }}
        type="EPIC"
      />,
    );
    expect(icon).toHaveClass("is-icon");
    expect(icon.querySelector("svg")).not.toBeNull();
  });
});
