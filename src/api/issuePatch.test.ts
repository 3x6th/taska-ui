import { describe, expect, it } from "vitest";
import {
  BLANK_SUMMARY_MESSAGE,
  IF_MATCH_NOT_POSITIVE_MESSAGE,
  IF_MATCH_UNPARSEABLE_MESSAGE,
  ISSUE_PATCH_KEYS,
  blankSummaryRefusal,
  datesOutOfOrderServerMessage,
  ifMatch,
  isDatesOutOfOrderRefusal,
  issuePatchBody,
  issueTypePatchRefusal,
  issueVersionRefusal,
} from "./issuePatch";
import type { UpdateIssueInput } from "./TaskaApi";

/**
 * The PATCH body and its guards (TAS-246). What is pinned here is what the
 * contract cannot check for us: that `undefined` never reaches the wire, that
 * `null` and `0` always do, and that nothing outside `PatchIssueRequestDto`
 * ever does.
 */
describe("issuePatchBody", () => {
  it("sends exactly the ten keys PatchIssueRequestDto declares, issueType among them since backend #226", () => {
    expect([...ISSUE_PATCH_KEYS].sort()).toEqual(
      [
        "assigneeId",
        "description",
        "dueDate",
        "issueType",
        "originalEstimateMinutes",
        "priority",
        "remainingEstimateMinutes",
        "startDate",
        "storyPoints",
        "summary",
      ].sort(),
    );
  });

  it("carries a type change as the key it names", () => {
    expect(issuePatchBody({ issueType: "EPIC" })).toEqual({ issueType: "EPIC" });
  });

  it("omits what is undefined and keeps what is stated, null and zero included", () => {
    expect(issuePatchBody({ summary: "Renamed", priority: undefined })).toEqual({ summary: "Renamed" });
    expect(
      issuePatchBody({
        description: null,
        assigneeId: null,
        storyPoints: null,
        startDate: null,
        dueDate: null,
        originalEstimateMinutes: null,
        remainingEstimateMinutes: null,
      }),
    ).toEqual({
      description: null,
      assigneeId: null,
      storyPoints: null,
      startDate: null,
      dueDate: null,
      originalEstimateMinutes: null,
      remainingEstimateMinutes: null,
    });
    // `0` is a count, and a falsy check would drop it.
    expect(issuePatchBody({ storyPoints: 0, originalEstimateMinutes: 0 })).toEqual({
      storyPoints: 0,
      originalEstimateMinutes: 0,
    });
  });

  it("never carries a key the contract does not declare", () => {
    // A caller spreading a cached issue into the input is the realistic way
    // this happens; the type would not stop it after a cast.
    const wide = { summary: "Kept", version: 4, labels: [], status: "DONE" } as unknown as UpdateIssueInput;
    expect(issuePatchBody(wide)).toEqual({ summary: "Kept" });
  });
});

describe("the If-Match version", () => {
  it("is sent in the quoted ETag form", () => {
    expect(ifMatch(7)).toBe('"7"');
  });

  it("refuses what the gateway cannot parse, and what issue-service will not take", () => {
    for (const version of [1.5, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648]) {
      expect(issueVersionRefusal(version)).toEqual({ code: "BAD_REQUEST", message: IF_MATCH_UNPARSEABLE_MESSAGE });
    }
    for (const version of [0, -1]) {
      expect(issueVersionRefusal(version)).toEqual({ code: "INVALID_ARGUMENT", message: IF_MATCH_NOT_POSITIVE_MESSAGE });
    }
    expect(issueVersionRefusal(1)).toBeNull();
    expect(issueVersionRefusal(2_147_483_647)).toBeNull();
  });
});

describe("the other guards", () => {
  it("refuses a blank summary and leaves an absent one alone", () => {
    expect(blankSummaryRefusal({ summary: "   " })).toEqual({ code: "INVALID_ARGUMENT", message: BLANK_SUMMARY_MESSAGE });
    expect(blankSummaryRefusal({ summary: "" })).not.toBeNull();
    expect(blankSummaryRefusal({ priority: "LOW" })).toBeNull();
    expect(blankSummaryRefusal({ summary: "Fine" })).toBeNull();
  });

  it("recognises the server's date-order sentence and nothing near it", () => {
    const sentence = datesOutOfOrderServerMessage("2026-07-01", "2026-06-26");
    expect(sentence).toBe("Start date: 2026-07-01 must not be after Due date: 2026-06-26");
    const refusal = (code: string, message: string) => Object.assign(new Error(message), { code, status: 400 });
    expect(isDatesOutOfOrderRefusal(refusal("INVALID_ARGUMENT", sentence))).toBe(true);
    expect(isDatesOutOfOrderRefusal(refusal("BAD_REQUEST", sentence))).toBe(false);
    expect(isDatesOutOfOrderRefusal(refusal("INVALID_ARGUMENT", "Start date must not be after Due date"))).toBe(false);
    expect(isDatesOutOfOrderRefusal(new Error(sentence))).toBe(false);
  });
});

/**
 * The gateway refuses an `issueType` on the request's face, before the issue
 * is looked up (`IssueMapper`, backend #226) — in its own `BAD_REQUEST`, which
 * the mock and the REST adapter both raise from here without a request.
 */
describe("issueTypePatchRefusal", () => {
  it("lets a patch without a type, and a well-formed key, through", () => {
    expect(issueTypePatchRefusal({ summary: "Renamed" })).toBeNull();
    expect(issueTypePatchRefusal({ issueType: "EPIC" })).toBeNull();
    expect(issueTypePatchRefusal({ issueType: "QA_2" })).toBeNull();
  });

  it("refuses null: a type cannot be cleared", () => {
    expect(issueTypePatchRefusal({ issueType: null } as unknown as UpdateIssueInput)).toEqual({
      code: "BAD_REQUEST",
      message: "issueType cannot be cleared",
    });
  });

  it.each([[""], ["epic"], ["E"], ["1EPIC"], ["EPIC-1"], ["A".repeat(33)], [42]])(
    "refuses %j as a key outside IssueTypeDto's pattern",
    (issueType) => {
      expect(issueTypePatchRefusal({ issueType } as unknown as UpdateIssueInput)).toEqual({
        code: "BAD_REQUEST",
        message: "Invalid issue type key",
      });
    },
  );
});
