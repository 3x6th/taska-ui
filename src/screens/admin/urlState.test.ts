import { describe, expect, it } from "vitest";
import { readViewState, writeViewState } from "./urlState";

/**
 * The Data section's state is the URL (DESIGN.md §5.8), which makes every
 * spelling here a compatibility promise: a link an admin sent last week has to
 * open the same rows today, and a link written today has to be one the current
 * gateway accepts.
 */
describe("admin view state in the URL", () => {
  const read = (query: string) => readViewState(new URLSearchParams(query));
  const write = (state: Parameters<typeof writeViewState>[0]) => writeViewState(state).toString();

  const base = { page: 1, sort: null, order: "asc" } as const;

  it("round-trips a filter", () => {
    const state = { ...base, filter: { column: "status", operator: "equals" as const, value: "ACTIVE" } };

    expect(read(write(state))).toEqual(state);
  });

  it("keeps a value that contains colons, because a timestamp does", () => {
    const state = {
      ...base,
      filter: { column: "created_at", operator: "from" as const, value: "2026-01-01T00:00:00Z" },
    };

    expect(read(write(state)).filter).toEqual(state.filter);
  });

  // The rename from `eq` to `equals` happened because the gateway now rejects
  // any key without a known operator. Links carrying the old spelling are
  // already out there, and dropping the filter would show unfiltered rows under
  // a chip that still read as applied — a wrong answer that looks like a right
  // one.
  it("still understands the legacy `eq` spelling and reads it as `equals`", () => {
    expect(read("filter=status:eq:ACTIVE").filter).toEqual({
      column: "status",
      operator: "equals",
      value: "ACTIVE",
    });
  });

  it("never writes the legacy spelling, so an old link heals when it is re-shared", () => {
    const decoded = read("filter=status:eq:ACTIVE");

    const written = write(decoded);
    expect(written).toContain("status%3Aequals%3AACTIVE");
    expect(written).not.toContain("eq%3A");
  });

  // §5.8: a blank filter is not applied and creates no chip. The API layer
  // drops an empty value from the request either way, which is exactly what
  // made this quiet — the chip read as applied over an unfiltered table, and
  // the empty state said "No rows match this filter".
  it("reads a filter with no value as no filter at all", () => {
    expect(read("filter=email:contains:").filter).toBeNull();
    expect(read("filter=expires_at:from:").filter).toBeNull();
  });

  it("never writes a filter with no value", () => {
    expect(write({ ...base, filter: { column: "email", operator: "contains", value: "" } })).toBe("");
  });

  it("reads an operator it has never heard of as no filter at all", () => {
    // Not an error state: a hand-edited address should show the table rather
    // than a diagnostic, and an operator we cannot send is not a filter.
    expect(read("filter=status:startsWith:A").filter).toBeNull();
  });

  it("keeps the page 1-based and ignores nonsense", () => {
    expect(read("page=2").page).toBe(2);
    expect(read("page=0").page).toBe(1);
    expect(read("page=-3").page).toBe(1);
    expect(read("page=banana").page).toBe(1);
    // Page 1 is the default, so it stays out of the address.
    expect(write({ ...base, page: 1, filter: null })).toBe("");
    expect(write({ ...base, page: 4, filter: null })).toBe("page=4");
  });

  it("writes order only alongside a sort column", () => {
    expect(write({ ...base, sort: "email", order: "desc", filter: null })).toBe("sort=email&order=desc");
    expect(write({ ...base, sort: null, order: "desc", filter: null })).toBe("");
  });
});
