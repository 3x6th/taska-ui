import { describe, expect, it } from "vitest";
import type { AdminTable } from "../../domain/types";
import { isAddressableKey, isAlignedType, operatorsForType, supportsOperator, valueControlForType } from "./columns";

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

/**
 * The value is constrained by the column's type for the same reason the
 * operator is: `ReadOnlyQueryBuilder` parses it typed — `new BigDecimal` for a
 * numeric column, `true`/`false` for a boolean one — and answers 400 when it
 * cannot. A free text field for either is a 400 the reader was given no help
 * avoiding, and the one that makes the "rejected request" error reachable from
 * the ordinary form.
 */
describe("which control enters a filter value", () => {
  it("gives a numeric column a numeric field", () => {
    for (const type of ["integer", "bigint", "numeric", "double precision", "smallserial"]) {
      expect(valueControlForType(type)).toBe("number");
    }
  });

  it("gives a boolean column a true/false choice", () => {
    expect(valueControlForType("boolean")).toBe("boolean");
    expect(valueControlForType("BOOLEAN")).toBe("boolean");
  });

  it("gives a temporal column the picker", () => {
    for (const type of ["timestamp with time zone", "timestamp without time zone", "date"]) {
      expect(valueControlForType(type)).toBe("datetime");
    }
  });

  // Free text stays exactly where the server really does take the string as
  // written: text columns, and the types it does not classify at all.
  it("keeps the free field for text and for types the gateway does not parse", () => {
    for (const type of ["text", "character varying", "uuid", "inet", "jsonb", undefined]) {
      expect(valueControlForType(type)).toBe("text");
    }
  });
});

describe("whether an operator is one the column can take", () => {
  it("answers for the pairing the gateway validates", () => {
    expect(supportsOperator("character varying", "contains")).toBe(true);
    expect(supportsOperator("uuid", "contains")).toBe(false);
    expect(supportsOperator("integer", "from")).toBe(true);
    expect(supportsOperator("boolean", "to")).toBe(false);
    // Equality is the fallback every type accepts, which is why a stranded
    // operator lands there.
    for (const type of ["uuid", "boolean", "inet", "text", undefined]) {
      expect(supportsOperator(type, "equals")).toBe(true);
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
