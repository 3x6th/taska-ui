import { describe, expect, it } from "vitest";
import type { AdminFilter } from "../../domain/types";
import { readEventsViewState, readsBackToProblems, writeEventsViewState } from "./eventsUrlState";

/**
 * The Outbox journal's state is its URL (DESIGN.md §5.8), so every spelling
 * here is a promise: a link an admin pastes into a chat has to open the same
 * page, the same order and the same nine-way filter combination tomorrow, and
 * a link that has been mangled on the way has to open the journal rather than a
 * diagnostic.
 */
describe("Events journal state in the URL", () => {
  const read = (query: string) => readEventsViewState(new URLSearchParams(query));
  const write = (state: Parameters<typeof writeEventsViewState>[0]) => writeEventsViewState(state).toString();

  const base = { page: 1, sort: null, order: "asc" } as const;
  const status: AdminFilter = { column: "status", operator: "equals", value: "FAILED" };
  const since: AdminFilter = { column: "created_at", operator: "from", value: "2026-01-01T00:00:00Z" };
  const attempts: AdminFilter = { column: "attempts", operator: "from", value: "3" };

  it("round-trips several filters at once, in the order they were applied", () => {
    const state = { ...base, page: 4, sort: "attempts", order: "desc" as const, filters: [status, since, attempts] };

    expect(read(write(state))).toEqual(state);
  });

  it("keeps a value that contains colons, because a timestamp does", () => {
    expect(read(write({ ...base, filters: [since] })).filters).toEqual([since]);
  });

  it("writes each filter as its own parameter, so one can be removed on its own", () => {
    const written = new URLSearchParams(write({ ...base, filters: [status, attempts] }));

    expect(written.getAll("filter")).toEqual(["status:equals:FAILED", "attempts:from:3"]);
  });

  // The gateway reads a repeated query key as a single value, so a second
  // `status.equals` would be dropped on the wire while its chip claimed to be
  // narrowing the journal.
  it("takes the first value of a key and ignores a second", () => {
    expect(read("filter=status:equals:FAILED&filter=status:equals:NEW").filters).toEqual([status]);
  });

  it("keeps two filters that share a column but not an operator", () => {
    const state = {
      ...base,
      filters: [since, { column: "created_at", operator: "to" as const, value: "2026-02-01T00:00:00Z" }],
    };

    expect(read(write(state)).filters).toHaveLength(2);
  });

  it("reads a filter this section does not offer as no filter at all", () => {
    // Only reachable by hand-editing the address, and the alternative is worse
    // than dropping it: the journal would narrow with nothing on screen naming
    // the reason and no cross to take it off again. `payload` is the live case
    // — jsonb, which the gateway will not match on at all.
    expect(read("filter=payload:contains:secret").filters).toEqual([]);
    expect(read("filter=status:contains:FAIL").filters).toEqual([]);
  });

  it("tolerates garbage as 'not set' rather than failing", () => {
    expect(read("filter=nonsense").filters).toEqual([]);
    expect(read("filter=status:startsWith:F").filters).toEqual([]);
    expect(read("filter=:equals:FAILED").filters).toEqual([]);
    expect(read("filter=status:equals:").filters).toEqual([]);
    expect(read("page=banana&order=sideways")).toEqual({ page: 1, sort: null, order: "asc", filters: [] });
  });

  it("never writes a filter with no value", () => {
    expect(write({ ...base, filters: [{ column: "event_type", operator: "equals", value: "" }] })).toBe("");
  });

  it("keeps the default sort out of the address until someone chooses one", () => {
    // `null` is not "no sort": the journal reads newest first, and the bare
    // address has to mean that for the next reader too. What must not happen is
    // the default being written out and then read back as a choice.
    expect(read("").sort).toBeNull();
    expect(write({ ...base, filters: [] })).toBe("");
    expect(write({ ...base, sort: "created_at", order: "desc", filters: [] })).toBe("sort=created_at&order=desc");
  });

  it("keeps the page 1-based and ignores nonsense", () => {
    expect(read("page=7").page).toBe(7);
    expect(read("page=0").page).toBe(1);
    expect(read("page=-3").page).toBe(1);
    expect(write({ ...base, page: 1, filters: [] })).toBe("");
    expect(write({ ...base, page: 4, filters: [] })).toBe("page=4");
  });

  // Where a card goes back to is part of its address, not of history: a pasted
  // link and a reload have to offer the same way out as the click did.
  it("reads the way back to the summary out of the address", () => {
    expect(readsBackToProblems(new URLSearchParams("from=problems"))).toBe(true);
    expect(readsBackToProblems(new URLSearchParams("from=somewhere"))).toBe(false);
    expect(readsBackToProblems(new URLSearchParams("page=2"))).toBe(false);
  });
});
