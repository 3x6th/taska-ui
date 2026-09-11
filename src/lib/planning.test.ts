import { describe, expect, it } from "vitest";
import {
  formatDuration,
  formatStoryPoints,
  parseDuration,
  parseStoryPoints,
  planningDrafts,
  planningInput,
  samePlanningDrafts,
  type PlanningDrafts,
} from "./planning";

/**
 * The planning fields' display layer (TAS-189). Two halves are worth pinning
 * and they fail differently.
 *
 * The first is the round trip: minutes are `int32` on the wire and a duration
 * on screen, so every value the seed carries has to come back out of
 * `parseDuration(formatDuration(n))` as itself. A formatter that invented days
 * would pass a naive assertion about `480` and lose `2880`.
 *
 * The second is the one this feature is actually about: **empty is not zero.**
 * `0` story points and `0` minutes are counts, `null` is an absence, and the
 * two spellings meet in `Number("")`, which is `0`. Every test below that names
 * `""` or `null` is there because the obvious implementation gets that wrong
 * and nothing downstream notices — a cleared field would arrive at the server
 * as a stored nought.
 */
describe("formatDuration", () => {
  it.each([
    [0, "0m"],
    [45, "45m"],
    [60, "1h"],
    [90, "1h 30m"],
    [480, "8h"],
    [1, "1m"],
    [59, "59m"],
    [960, "16h"],
    // No days, deliberately: the length of a working day is a policy the
    // product has not set, so two days of minutes read as the hours they are.
    [2880, "48h"],
    [1439, "23h 59m"],
  ])("prints %i minutes as %s", (minutes, expected) => {
    expect(formatDuration(minutes)).toBe(expected);
  });

  it("prints a zero estimate rather than nothing", () => {
    // The whole feature in one assertion. An estimate of nought is a fact about
    // the issue; an empty field is the absence of one, and `formatDuration` is
    // never asked for the second (see `planningDrafts`).
    expect(formatDuration(0)).not.toBe("");
  });

  it.each([
    [30.5, "30.5m"],
    [-30, "-30m"],
  ])("prints %s, which the wire cannot carry, as bare minutes", (minutes, expected) => {
    // Neither value can be stored: `int32` with `minimum: 0`, and
    // `planningFieldRefusal` refuses both before the request. There is no right
    // way to dress one up as hours, so it is printed visibly odd instead.
    expect(formatDuration(minutes)).toBe(expected);
  });

  it("prints nothing for a value that is not a number at all", () => {
    expect(formatDuration(Number.NaN)).toBe("");
  });
});

describe("parseDuration", () => {
  it.each([
    ["8h", 480],
    ["1h 30m", 90],
    ["2h30m", 150],
    ["90m", 90],
    ["90", 90],
    ["1.5h", 90],
    [" 8H ", 480],
    ["0m", 0],
    ["0", 0],
    ["45M", 45],
    ["2 h 30 m", 150],
    // 93 minutes exactly, and `1.55 * 60` is 93.00000000000001 in binary
    // floating point. Snapped, or the whole-minutes rule would refuse a value
    // that is whole.
    ["1.55h", 93],
  ])("reads %s as %i minutes", (draft, expected) => {
    expect(parseDuration(draft)).toBe(expected);
  });

  it("reads an empty field as null, which is how this wire spells 'clear it'", () => {
    // Documented rather than inferred: `""` is not garbage and must not become
    // `NaN`, because the reader who emptied the field asked for the value to go
    // away — and it must not become `0` either, which is what `Number("")`
    // would have made it.
    expect(parseDuration("")).toBeNull();
    expect(parseDuration("   ")).toBeNull();
  });

  it.each([["abc"], ["1d"], ["h"], ["m"], ["8 hours"], ["1:30"], ["--"], ["1h2"]])(
    "hands %s on as NaN for the API layer to refuse",
    (draft) => {
      // Not a local error message: `planningFieldRefusal` answers this with
      // `ESTIMATE_WHOLE_MINUTES_MESSAGE`, which is true of every one of these,
      // and one rulebook is the point (see the module comment).
      expect(parseDuration(draft)).toBeNaN();
    },
  );

  it("keeps a genuinely fractional duration fractional, so the API layer can refuse it", () => {
    expect(parseDuration("1.51h")).toBeCloseTo(90.6, 9);
    expect(parseDuration("30.5")).toBe(30.5);
  });

  it("keeps a negative bare number negative, so the refusal names the sign", () => {
    // `NaN` here would earn "An estimate is a whole number of minutes" for
    // something that is one. `-5` earns "An estimate cannot be negative".
    expect(parseDuration("-5")).toBe(-5);
  });

  it("round-trips every duration the mock seed carries", () => {
    for (const minutes of [0, 90, 120, 240, 480, 960]) {
      expect(parseDuration(formatDuration(minutes))).toBe(minutes);
    }
  });
});

describe("story points", () => {
  it.each([
    ["", null],
    ["0", 0],
    ["1.5", 1.5],
    ["3", 3],
    [" 13 ", 13],
    ["999.99", 999.99],
  ])("reads %s as %s", (draft, expected) => {
    expect(parseStoryPoints(draft)).toBe(expected);
  });

  it("hands garbage on as NaN rather than refusing it here", () => {
    expect(parseStoryPoints("abc")).toBeNaN();
    expect(parseStoryPoints("1.2.3")).toBeNaN();
  });

  it("does not turn an emptied field into nought", () => {
    // `Number("")` is `0`. Without the empty check, clearing story points would
    // store a zero estimate — and zero is legal here, so no layer below would
    // question it.
    expect(parseStoryPoints("")).not.toBe(0);
  });

  it.each([
    [0, "0"],
    [1.5, "1.5"],
    [3, "3"],
    [13, "13"],
  ])("prints %s as %s", (points, expected) => {
    expect(formatStoryPoints(points)).toBe(expected);
  });
});

describe("planningDrafts", () => {
  const issue = {
    storyPoints: 3,
    startDate: "2026-06-15",
    dueDate: "2026-06-26",
    originalEstimateMinutes: 480,
    remainingEstimateMinutes: 240,
  };

  it("prints the five of an issue that carries them all", () => {
    expect(planningDrafts(issue)).toEqual({
      storyPoints: "3",
      // Verbatim. `<input type="date">` holds exactly this string, and building
      // a `Date` from it would put a timezone between the reader and the day.
      startDate: "2026-06-15",
      dueDate: "2026-06-26",
      originalEstimateMinutes: "8h",
      remainingEstimateMinutes: "4h",
    });
  });

  it("empties an unset field and keeps a zero one", () => {
    expect(
      planningDrafts({
        storyPoints: 0,
        startDate: null,
        dueDate: null,
        originalEstimateMinutes: 0,
        remainingEstimateMinutes: null,
      }),
    ).toEqual({
      storyPoints: "0",
      startDate: "",
      dueDate: "",
      originalEstimateMinutes: "0m",
      remainingEstimateMinutes: "",
    });
  });

  it("answers for an issue that has not loaded yet", () => {
    // The panel builds its drafts before the issue read lands, so this is the
    // state the inputs mount in rather than a defensive branch.
    expect(planningDrafts(undefined)).toEqual({
      storyPoints: "",
      startDate: "",
      dueDate: "",
      originalEstimateMinutes: "",
      remainingEstimateMinutes: "",
    });
    expect(planningDrafts(null)).toEqual(planningDrafts(undefined));
  });
});

describe("planningInput", () => {
  const empty: PlanningDrafts = {
    storyPoints: "",
    startDate: "",
    dueDate: "",
    originalEstimateMinutes: "",
    remainingEstimateMinutes: "",
  };

  it("omits every field the reader left alone", () => {
    // Not five `null`s: on a create both spellings of nothing mean the same
    // thing, and an object with no keys is the one that cannot be misread.
    expect(planningInput(empty)).toEqual({});
  });

  it("carries what was typed, in the units the wire uses", () => {
    expect(
      planningInput({
        storyPoints: "2",
        startDate: "2026-06-15",
        dueDate: "2026-06-26",
        originalEstimateMinutes: "1h 30m",
        remainingEstimateMinutes: "45m",
      }),
    ).toEqual({
      storyPoints: 2,
      startDate: "2026-06-15",
      dueDate: "2026-06-26",
      originalEstimateMinutes: 90,
      remainingEstimateMinutes: 45,
    });
  });

  it("carries a zero, which is a value", () => {
    expect(planningInput({ ...empty, storyPoints: "0", originalEstimateMinutes: "0m" })).toEqual({
      storyPoints: 0,
      originalEstimateMinutes: 0,
    });
  });

  it("carries garbage on to the API layer rather than dropping it", () => {
    // Dropping it would create the issue with no estimate at all and say
    // nothing — the reader's input silently discarded. `NaN` reaches
    // `planningFieldRefusal` and comes back as a sentence.
    const input = planningInput({ ...empty, storyPoints: "abc", remainingEstimateMinutes: "1d" });
    expect(input.storyPoints).toBeNaN();
    expect(input.remainingEstimateMinutes).toBeNaN();
    expect(input.startDate).toBeUndefined();
  });
});

describe("samePlanningDrafts", () => {
  it("is true for two readings of the same issue and false when one field moved", () => {
    const drafts = planningDrafts({
      storyPoints: 3,
      startDate: "2026-06-15",
      dueDate: null,
      originalEstimateMinutes: 480,
      remainingEstimateMinutes: null,
    });
    expect(samePlanningDrafts(drafts, { ...drafts })).toBe(true);
    expect(samePlanningDrafts(drafts, { ...drafts, storyPoints: "5" })).toBe(false);
    // The pair the reseed exists for: a field that was cleared on the server
    // has to pull the draft back with it, and `""` versus `"3"` is the only
    // signal that happened.
    expect(samePlanningDrafts(drafts, { ...drafts, storyPoints: "" })).toBe(false);
    expect(samePlanningDrafts(drafts, { ...drafts, dueDate: "2026-07-01" })).toBe(false);
  });
});
