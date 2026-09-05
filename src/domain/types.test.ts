import { describe, expect, it } from "vitest";
import { isDateOnly } from "./types";

/**
 * `DateOnly` is the wire's `format: date` — a string, never a `Date` — and
 * `isDateOnly` is the whole of what the type can enforce at runtime. The cases
 * that matter are the ones a shape check alone would let through: the gateway
 * parses these with `LocalDate.parse` and answers `400`, and the client refuses
 * them before a request is spent (TAS-189).
 */
describe("isDateOnly", () => {
  it("accepts an ISO calendar day", () => {
    expect(isDateOnly("2026-09-01")).toBe(true);
    expect(isDateOnly("2026-01-31")).toBe(true);
    expect(isDateOnly("2026-12-31")).toBe(true);
  });

  it("rejects a well-shaped date that does not exist", () => {
    // Both match `\d{4}-\d{2}-\d{2}`, which is why the check is a function and
    // not a regular expression at each call site.
    expect(isDateOnly("2026-13-01")).toBe(false);
    expect(isDateOnly("2026-02-30")).toBe(false);
    expect(isDateOnly("2026-00-10")).toBe(false);
    expect(isDateOnly("2026-04-31")).toBe(false);
    expect(isDateOnly("2026-09-00")).toBe(false);
  });

  it("follows the Gregorian leap rule rather than a modulo four", () => {
    expect(isDateOnly("2028-02-29")).toBe(true);
    expect(isDateOnly("2027-02-29")).toBe(false);
    expect(isDateOnly("2000-02-29")).toBe(true);
    expect(isDateOnly("1900-02-29")).toBe(false);
  });

  it("rejects anything that is not exactly YYYY-MM-DD", () => {
    expect(isDateOnly("2026-9-1")).toBe(false);
    expect(isDateOnly("01-09-2026")).toBe(false);
    expect(isDateOnly("2026-09-01T00:00:00Z")).toBe(false);
    expect(isDateOnly("2026-09-01 ")).toBe(false);
    expect(isDateOnly("")).toBe(false);
  });
});
