import { describe, expect, it } from "vitest";
import type { DictionaryEntry } from "../domain/types";
import { enumLabel, enumLabelInSentence, isEnglishName, selectableCodes } from "./enumLabel";

const known = { LOW: "Low", MEDIUM: "Medium", HIGH: "High" };

/**
 * The one rule every dictionary is printed by (TAS-173): known code → the
 * build's word; unknown → the `/meta` name when it has no Cyrillic; otherwise
 * the code verbatim. It must never throw and never answer an empty string —
 * the board went blank on exactly that.
 */
describe("enumLabel", () => {
  it("answers a known code with the build's word, whatever is served for it", () => {
    expect(enumLabel("LOW", known, [{ code: "LOW", name: "Low-ish", selectable: true }])).toBe("Low");
  });

  it("takes an English served name for a code the build does not know", () => {
    expect(enumLabel("URGENT", known, [{ code: "URGENT", name: "  Urgent ", selectable: true }])).toBe("Urgent");
  });

  it.each([
    ["Russian", "Срочный"],
    ["mixed", "Urgent / Срочный"],
    ["blank", "   "],
    ["empty", ""],
  ])("prints the code itself when the served name is %s", (_case, name) => {
    expect(enumLabel("URGENT", known, [{ code: "URGENT", name, selectable: true }])).toBe("URGENT");
  });

  it("prints a code the dictionary does not list, and matches codes exactly", () => {
    const served: DictionaryEntry[] = [{ code: "urgent", name: "Urgent", selectable: true }];
    expect(enumLabel("URGENT", known, served)).toBe("URGENT");
    expect(enumLabel("URGENT", known, null)).toBe("URGENT");
    expect(enumLabel("URGENT", known)).toBe("URGENT");
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty", ""],
    ["blank", "  "],
  ])("answers the empty mark for a %s code", (_case, code) => {
    expect(enumLabel(code, known)).toBe("—");
    expect(enumLabel(code, known, null, "No status")).toBe("No status");
  });

  it.each([["constructor"], ["__proto__"], ["toString"], ["hasOwnProperty"]])(
    "treats %s as a code, not as a member of Object.prototype",
    (code) => {
      expect(enumLabel(code, known)).toBe(code);
      expect(enumLabel(code, known, [{ code, name: "Named", selectable: true }])).toBe("Named");
    },
  );
});

describe("enumLabelInSentence", () => {
  it("lowercases the build's word and nothing else", () => {
    expect(enumLabelInSentence("HIGH", known)).toBe("high");
    expect(enumLabelInSentence("URGENT", known, [{ code: "URGENT", name: "Urgent", selectable: true }])).toBe("Urgent");
    expect(enumLabelInSentence("URGENT", known)).toBe("URGENT");
  });
});

describe("isEnglishName", () => {
  it("accepts a non-blank name with no Cyrillic letter in it", () => {
    expect(isEnglishName("Epic")).toBe(true);
    expect(isEnglishName("Épopée")).toBe(true);
    expect(isEnglishName("Задача")).toBe(false);
    expect(isEnglishName("Epic (Эпик)")).toBe(false);
    expect(isEnglishName(" ")).toBe(false);
  });
});

/**
 * Art-director's ruling 5: the build's known codes first in the build's order,
 * then the unknown ones in the order served — a served list can only add
 * segments at the end — and the build's own set when nothing was served.
 */
describe("selectableCodes", () => {
  const buildOrder = ["LOW", "MEDIUM", "HIGH"];

  it("falls back to the build's set when nothing, or nothing usable, was served", () => {
    expect(selectableCodes(undefined, buildOrder)).toEqual(buildOrder);
    expect(selectableCodes(null, buildOrder)).toEqual(buildOrder);
    expect(selectableCodes([], buildOrder)).toEqual(buildOrder);
  });

  it("keeps known codes in the build's order and appends unknown ones as served", () => {
    const served: DictionaryEntry[] = [
      { code: "URGENT", name: "Срочный", selectable: true },
      { code: "HIGH", name: "Высокий", selectable: true },
      { code: "LOW", name: "Низкий", selectable: true },
      { code: "TRIVIAL", name: "Trivial", selectable: true },
      { code: "MEDIUM", name: "Средний", selectable: true },
    ];
    expect(selectableCodes(served, buildOrder)).toEqual(["LOW", "MEDIUM", "HIGH", "URGENT", "TRIVIAL"]);
  });

  it("drops a known code the served list leaves out", () => {
    expect(selectableCodes([{ code: "HIGH", name: "", selectable: true }, { code: "LOW", name: "", selectable: true }], buildOrder)).toEqual(["LOW", "HIGH"]);
  });

  it("never offers an entry the server marks `selectable: false` (backend #201)", () => {
    // The four placeholders `MetaServiceImpl` marks — and the mark, not the
    // code, is what decides: the list of codes this used to keep is gone.
    const served: DictionaryEntry[] = [
      { code: "UNSPECIFIED", name: "Unspecified", selectable: false },
      { code: "LOW", name: "Low", selectable: true },
      { code: "UNKNOWN", name: "Unknown", selectable: false },
      { code: "HIGH", name: "High", selectable: true },
      { code: "UNRECOGNIZED", name: "Unrecognized", selectable: false },
      { code: "RETIRED", name: "Retired", selectable: false },
    ];
    expect(selectableCodes(served, buildOrder)).toEqual(["LOW", "HIGH"]);
    // A list of nothing but unselectable entries offers nothing of its own.
    expect(selectableCodes([{ code: "UNSPECIFIED", name: "", selectable: false }], buildOrder)).toEqual(buildOrder);
  });

  it("offers whatever the server marks selectable, whatever its code is called", () => {
    const served: DictionaryEntry[] = [
      { code: "LOW", name: "Low", selectable: true },
      { code: "UNKNOWN", name: "Unknown", selectable: true },
    ];
    expect(selectableCodes(served, buildOrder)).toEqual(["LOW", "UNKNOWN"]);
  });
});
