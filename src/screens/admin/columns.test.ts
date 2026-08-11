import { describe, expect, it } from "vitest";
import type { AdminTable } from "../../domain/types";
import { classifyColumnType, isAddressableKey, isAlignedType, operatorsForType } from "./columns";

/**
 * The catalog states `information_schema.columns.data_type` verbatim, and the
 * gateway matches that string exactly before deciding whether a filter is
 * legal. Everything here is about that exactness: a class this file gets wrong
 * is an operator the console offers and the server answers 400 to, with no way
 * for the reader to tell why.
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

describe("filter operators offered per column type", () => {
  it("offers contains only for text", () => {
    expect(operatorsForType("text")).toEqual(["equals", "contains"]);
    expect(operatorsForType("character varying")).toContain("contains");
    expect(operatorsForType("integer")).not.toContain("contains");
    expect(operatorsForType("timestamp with time zone")).not.toContain("contains");
  });

  it("offers the range operators for temporal and numeric columns", () => {
    expect(operatorsForType("timestamp with time zone")).toEqual(["equals", "from", "to"]);
    expect(operatorsForType("numeric")).toEqual(["equals", "from", "to"]);
    expect(operatorsForType("date")).toContain("from");
    expect(operatorsForType("text")).not.toContain("from");
    expect(operatorsForType("boolean")).not.toContain("to");
  });

  // Failing towards fewer operators is the whole rule: an operator the server
  // refuses turns a filter into a 400 the reader cannot act on, while a missing
  // one only costs a narrower question.
  it("offers equality alone for a type it does not recognise", () => {
    expect(operatorsForType("uuid")).toEqual(["equals"]);
    expect(operatorsForType("jsonb")).toEqual(["equals"]);
    expect(operatorsForType(undefined)).toEqual(["equals"]);
    expect(operatorsForType("some_type_from_a_later_migration")).toEqual(["equals"]);
  });

  it("offers equality for every type, including the ones it knows", () => {
    for (const type of ["text", "boolean", "integer", "date", "uuid"]) {
      expect(operatorsForType(type)).toContain("equals");
    }
  });
});

describe("whether a table's rows can be addressed", () => {
  const table = (primaryKey: string, columns: AdminTable["columns"]): AdminTable => ({
    name: "t",
    primaryKey,
    columns,
  });

  it("says yes only for a uuid primary key", () => {
    expect(isAddressableKey(table("id", [{ name: "id", type: "uuid", sensitive: false }]))).toBe(true);
    expect(isAddressableKey(table("id", [{ name: "id", type: "UUID", sensitive: false }]))).toBe(true);
    // The gateway parses the path parameter as a UUID, so these rows cannot be
    // opened at all — a link to them is a guaranteed refusal.
    expect(isAddressableKey(table("id", [{ name: "id", type: "bigint", sensitive: false }]))).toBe(false);
    expect(isAddressableKey(table("code", [{ name: "code", type: "character varying", sensitive: false }]))).toBe(
      false,
    );
  });

  it("says no when the catalog names no key, or names one it does not describe", () => {
    expect(isAddressableKey(undefined)).toBe(false);
    expect(isAddressableKey(table("", [{ name: "id", type: "uuid", sensitive: false }]))).toBe(false);
    expect(isAddressableKey(table("missing", [{ name: "id", type: "uuid", sensitive: false }]))).toBe(false);
  });

  // The address carries the key, so a link would print in the URL bar and in
  // browser history the very value the table masks in its own cell.
  it("says no when the key column itself is sensitive", () => {
    expect(isAddressableKey(table("id", [{ name: "id", type: "uuid", sensitive: true }]))).toBe(false);
  });
});

/**
 * Typography, which is a different question from filtering and deliberately
 * keeps its own looser rules (DESIGN.md §5.8, §2.3): monospace is for values the
 * eye compares down a column, and a type this list has never seen falls back to
 * prose rather than to terminal cosplay.
 */
describe("which columns are set in mono", () => {
  it("aligns identifiers, times, numbers and JSON", () => {
    for (const type of ["uuid", "timestamp with time zone", "timestamptz", "integer", "numeric", "jsonb"]) {
      expect(isAlignedType(type)).toBe(true);
    }
  });

  it("leaves prose in the UI font", () => {
    for (const type of ["character varying", "text", "boolean", undefined]) {
      expect(isAlignedType(type)).toBe(false);
    }
  });
});
