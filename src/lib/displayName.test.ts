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
const ZWSP = String.fromCodePoint(0x200b);
const ZWNJ = String.fromCodePoint(0x200c);
const ZWJ = String.fromCodePoint(0x200d);

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
    expect(displayNameProblem(GRINNING.repeat(129))).toBe("Use at most 128 characters. This name has 129.");
    expect(displayNameProblem(GRINNING.repeat(130))).toBe("Use at most 128 characters. This name has 130.");
  });

  it("gives one reason at a time, in §5.9's order", () => {
    // Too long and carrying a tab: the tab first.
    expect(displayNameProblem(`${"a".repeat(200)}\tb`)).toBe("Remove the tab or line break from the name.");
    expect(displayNameProblem(ZWSP.repeat(129))).toBe("Enter a name.");
    for (const refused of ["\t", LINE_SEPARATOR, PARAGRAPH_SEPARATOR, "\ud83d"]) {
      expect(displayNameProblem(`${ZWSP}${refused}`)).toBe("Remove the tab or line break from the name.");
      expect(normalizeDisplayName(`${ZWSP}${refused}`)).toBeNull();
    }
  });

  it.each([0x200b, 0x200c, 0x200d, 0x2060, 0xfeff, 0x200e, 0x202e, 0x2067, 0xe0001])(
    "rejects FORMAT U+%s alone or with server spaces, without trimming FORMAT away",
    (point) => {
      const format = String.fromCodePoint(point);
      expect(trimDisplayName(format)).toBe(format);
      for (const name of [format, `${NBSP}${format} ${format}${IDEOGRAPHIC_SPACE}`]) {
        expect(displayNameProblem(name)).toBe("Enter a name.");
        expect(normalizeDisplayName(name)).toBeNull();
      }
    },
  );

  it("preserves FORMAT in valid names, including Persian ZWNJ, ZWJ emoji and supplementary FORMAT", () => {
    for (const name of [`${BOM}Anna${ZWSP}`, `علی${ZWNJ}رضا`, `👩${ZWJ}💻`, `${String.fromCodePoint(0xe0001)}A`]) {
      expect(displayNameProblem(name)).toBeNull();
      expect(normalizeDisplayName(`${NBSP}${name}${NBSP}`)).toBe(name);
    }
    // The server's category predicate also accepts combining marks, variation
    // selectors and a braille blank. It does not test whether a font draws ink.
    for (const point of [0x0301, 0x20dd, 0x0903, 0x034f, 0xfe0f, 0x2800, 0x1160, 0xe000, 0x0378]) {
      const name = String.fromCodePoint(point);
      expect(displayNameProblem(name)).toBeNull();
      expect(normalizeDisplayName(name)).toBe(name);
    }
  });

  it("counts accepted FORMAT toward the same 128 code-point bound", () => {
    for (const format of [ZWSP, String.fromCodePoint(0xe0001)]) {
      const longest = `A${format.repeat(127)}`;
      expect(displayNameProblem(longest)).toBeNull();
      expect(normalizeDisplayName(longest)).toBe(longest);
      expect(displayNameProblem(`${longest}${format}`)).toBe("Use at most 128 characters. This name has 129.");
      expect(normalizeDisplayName(`${longest}${format}`)).toBeNull();
    }
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
