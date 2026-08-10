import { describe, expect, it } from "vitest";
import { issueLinkTypeLabel, issueLinkTypes } from "./format";

/**
 * `viewLinkType` is the one field in the domain that is deliberately an open
 * string (see `IssueLink`), which makes this function the whole of the
 * narrowing: everything the API layer refuses to decide is decided here. The
 * cases that matter are the ones no fixture will ever produce — a relation this
 * build has not heard of, and a response that states none at all.
 */
describe("issueLinkTypeLabel", () => {
  it("labels every relation a request may ask for", () => {
    expect(issueLinkTypes.map(issueLinkTypeLabel)).toEqual(["Blocks", "Relates to", "Duplicates"]);
  });

  it.each([
    ["IS_BLOCKED_BY", "Is blocked by"],
    ["IS_DUPLICATED_BY", "Is duplicated by"],
  ])("labels %s, which the request enum cannot express, as %s", (value, expected) => {
    // The inverse views are the reason the response field is not the request
    // enum. Written out rather than humanised, because these are values the UI
    // expects to meet.
    expect(issueLinkTypeLabel(value)).toBe(expected);
  });

  it.each([
    ["SUPERSEDES", "Supersedes"],
    ["IS_SUPERSEDED_BY", "Is superseded by"],
    ["depends-on", "Depends on"],
    ["CAUSES", "Causes"],
  ])("humanises %s, a relation this build has never heard of, as %s", (value, expected) => {
    // Not dropped and not coerced into a relation it is not: the link is real
    // whatever the server chose to call it.
    expect(issueLinkTypeLabel(value)).toBe(expected);
  });

  it.each([
    ["an empty string", ""],
    ["whitespace", "   "],
    ["separators only", "__"],
  ])("says only that the issues are linked when the relation is %s", (_case, value) => {
    // The response DTO requires no fields, so "no relation stated" is a shape
    // the contract permits. It claims exactly what the response proves.
    expect(issueLinkTypeLabel(value)).toBe("Linked");
  });

  it("does not care how the server cased the value", () => {
    expect(issueLinkTypeLabel("blocks")).toBe("Blocks");
    expect(issueLinkTypeLabel("is_blocked_by")).toBe("Is blocked by");
  });
});
