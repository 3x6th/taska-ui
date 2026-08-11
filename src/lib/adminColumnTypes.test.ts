import { describe, expect, it } from "vitest";
import { classifyColumnType } from "./adminColumnTypes";

/**
 * The catalog states `information_schema.columns.data_type` verbatim, and the
 * gateway matches that string exactly before deciding whether a filter is legal
 * and how to parse its value. Everything here is about that exactness: a class
 * this file gets wrong is an operator or an input the console offers and the
 * server answers 400 to, with no way for the reader to tell why — and, since
 * MockTaskaApi compares and sorts by the same classes, a mock that quietly
 * disagrees with the wire.
 */
describe("column type classification", () => {
  it.each([
    ["text", "TEXT"],
    ["character varying", "TEXT"],
    ["varchar", "TEXT"],
    ["character", "TEXT"],
    ["char", "TEXT"],
    ["name", "TEXT"],
    ["citext", "TEXT"],
    ["timestamp with time zone", "TEMPORAL"],
    ["timestamp without time zone", "TEMPORAL"],
    ["date", "TEMPORAL"],
    ["time with time zone", "TEMPORAL"],
    ["time without time zone", "TEMPORAL"],
    ["integer", "NUMERIC"],
    ["bigint", "NUMERIC"],
    ["smallint", "NUMERIC"],
    ["numeric", "NUMERIC"],
    ["decimal", "NUMERIC"],
    ["real", "NUMERIC"],
    ["double precision", "NUMERIC"],
    ["serial", "NUMERIC"],
    ["bigserial", "NUMERIC"],
    ["smallserial", "NUMERIC"],
    ["boolean", "BOOLEAN"],
  ] as const)("puts %s in %s", (type, expected) => {
    expect(classifyColumnType(type)).toBe(expected);
    // The gateway lowercases before matching, and a catalog is free to shout.
    expect(classifyColumnType(type.toUpperCase())).toBe(expected);
  });

  it.each(["uuid", "jsonb", "json", "bytea", "inet", "character varying[]", "timestamptz", undefined])(
    "falls back to OTHER for %s",
    (type) => {
      expect(classifyColumnType(type)).toBe("OTHER");
    },
  );

  // Substring matching is the trap this table replaced: `timestamptz` contains
  // "timestamp" but is not what information_schema returns, and an array type
  // contains its element type without behaving like it.
  it("matches the whole type, not a fragment of it", () => {
    expect(classifyColumnType("character varying[]")).toBe("OTHER");
    expect(classifyColumnType("integer[]")).toBe("OTHER");
  });
});
