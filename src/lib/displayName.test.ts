import { describe, expect, it } from "vitest";
import {
  DISPLAY_NAME_MAX_CODE_POINTS,
  displayNameProblem,
  normalizeDisplayName,
  trimDisplayName,
} from "./displayName";

// Built from code points, so the source itself carries none of these
// invisible characters.
const LINE_SEPARATOR = String.fromCodePoint(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCodePoint(0x2029);
const NBSP = String.fromCodePoint(0xa0);
const NARROW_NBSP = String.fromCodePoint(0x202f);
const IDEOGRAPHIC_SPACE = String.fromCodePoint(0x3000);
const BOM = String.fromCodePoint(0xfeff);
const GRINNING = String.fromCodePoint(0x1f600);

describe("the display-name check (TAS-425, DESIGN.md §5.9)", () => {
  it("says nothing for an ordinary name", () => {
    expect(displayNameProblem("Anna Ivanova")).toBeNull();
    expect(displayNameProblem("  Anna  ")).toBeNull();
  });

  it("asks for a name when nothing is left after trimming — a lone tab included", () => {
    expect(displayNameProblem("")).toBe("Enter a name.");
    expect(displayNameProblem("   ")).toBe("Enter a name.");
    expect(displayNameProblem(`${NBSP}${IDEOGRAPHIC_SPACE}`)).toBe("Enter a name.");
    expect(displayNameProblem("\t")).toBe("Enter a name.");
  });

  it("refuses a tab, a control character or a line or paragraph separator anywhere", () => {
    const sentence = "Remove the tab or line break from the name.";
    expect(displayNameProblem("Anna\tIvanova")).toBe(sentence);
    expect(displayNameProblem(`Anna${LINE_SEPARATOR}Ivanova`)).toBe(sentence);
    expect(displayNameProblem(`Anna${PARAGRAPH_SEPARATOR}`)).toBe(sentence);
    expect(displayNameProblem("Anna\u0085")).toBe(sentence);
    expect(displayNameProblem("Anna\u007f")).toBe(sentence);
    // At the edge too: the server reads the raw value before it trims.
    expect(displayNameProblem("Anna\t")).toBe(sentence);
    // A lone surrogate, which no keyboard types and a broken paste can.
    expect(displayNameProblem("Anna\ud83d")).toBe(sentence);
  });

  it("counts code points after trimming, so an astral character is one, and says how many there are", () => {
    const longest = "a".repeat(DISPLAY_NAME_MAX_CODE_POINTS);
    expect(displayNameProblem(longest)).toBeNull();
    expect(displayNameProblem(` ${longest} `)).toBeNull();
    expect(displayNameProblem(`${longest}b`)).toBe("Use at most 128 characters. This name has 129.");
    // 128 emoji are 256 UTF-16 units and still 128 characters to the server.
    expect(displayNameProblem(GRINNING.repeat(128))).toBeNull();
    expect(displayNameProblem(GRINNING.repeat(130))).toBe("Use at most 128 characters. This name has 130.");
  });

  it("gives one reason at a time, in §5.9's order", () => {
    // Too long and carrying a tab: the tab first.
    expect(displayNameProblem(`${"a".repeat(200)}\tb`)).toBe("Remove the tab or line break from the name.");
  });

  it("trims the edges the server trims — the no-break spaces too — and not U+FEFF, which JS's own trim takes", () => {
    expect(trimDisplayName(`${NBSP} Anna ${NARROW_NBSP}${IDEOGRAPHIC_SPACE}`)).toBe("Anna");
    expect(trimDisplayName(`${BOM}Anna`)).toBe(`${BOM}Anna`);
    expect(trimDisplayName("\u001fAnna")).toBe("Anna");
    expect(trimDisplayName("Anna  Ivanova")).toBe("Anna  Ivanova");
  });

  it("normalises as the server does, or refuses with null", () => {
    expect(normalizeDisplayName(`  Leo F.${NBSP}`)).toBe("Leo F.");
    expect(normalizeDisplayName("   ")).toBeNull();
    expect(normalizeDisplayName("Leo\tF.")).toBeNull();
    expect(normalizeDisplayName("Leo\t")).toBeNull();
    expect(normalizeDisplayName(`Leo${LINE_SEPARATOR}`)).toBeNull();
    expect(normalizeDisplayName("x".repeat(129))).toBeNull();
    expect(normalizeDisplayName(42)).toBeNull();
  });
});
