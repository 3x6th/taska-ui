import { describe, expect, it } from "vitest";
import { avatarColor, avatarColorChoices, issueLinkTypeLabel, issueLinkTypes, keyBadgeStyle, labelColorChoices } from "./format";

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

/**
 * The colour is computed, not stored, so the property that matters is not which
 * hex a given id lands on — it is that the answer never moves. Nothing here
 * pins a specific pairing: doing so would freeze the hash rather than test it,
 * and a future change of algorithm is allowed as long as it keeps these three
 * promises.
 */
describe("avatarColor", () => {
  const ids = Array.from({ length: 200 }, (_, index) => `3f1f5a2e-0000-4000-8000-${String(index).padStart(12, "0")}`);

  it("gives one user the same colour every time it is asked", () => {
    // The whole point: a reload, a rebuild, or a switch between the mock and
    // the gateway must not repaint the person.
    expect(ids.map((id) => avatarColor(id))).toEqual(ids.map((id) => avatarColor(id)));
  });

  it("only ever returns a colour from DESIGN.md §2.2's palette", () => {
    for (const id of ids) {
      expect(avatarColorChoices).toContain(avatarColor(id));
    }
  });

  it("spreads users across the palette instead of collapsing them onto one colour", () => {
    // Two people with the same initials are the reason an avatar is coloured
    // at all, so a hash that answered "#6366f1" to everything would pass the
    // two tests above and still deliver nothing.
    expect(new Set(ids.map((id) => avatarColor(id))).size).toBe(avatarColorChoices.length);
  });

  it("keeps a colour the server stated", () => {
    // The gateway has no `color` on a user today; the mock does, and its seeded
    // people are meant to keep the colours DESIGN.md gave them.
    expect(avatarColor(ids[0], "#123456")).toBe("#123456");
  });

  it.each([["red"], ["#12345"], ["#12345g"], [""]])("computes a colour rather than passing %s to a style", (color) => {
    expect(avatarColorChoices).toContain(avatarColor(ids[0], color));
  });
});

describe("keyBadgeStyle", () => {
  const keys = ["TAS", "WEB", "MOB", "OPS", "INFRA", "DESIGN", "QA", "SRE", "DATA", "ML"];

  it("draws §4.5's badge: the colour as text, a 16% tint behind it", () => {
    const style = keyBadgeStyle("TAS", "#0052cc");
    expect(style).toEqual({ color: "#0052cc", background: "color-mix(in oklab, #0052cc 16%, transparent)" });
  });

  it("gives one project key the same colour every time", () => {
    expect(keys.map((key) => keyBadgeStyle(key))).toEqual(keys.map((key) => keyBadgeStyle(key)));
  });

  it("only ever computes a colour the label palette already offers", () => {
    for (const key of keys) {
      expect(labelColorChoices).toContain(keyBadgeStyle(key).color);
    }
  });

  it("spreads project keys across the palette instead of collapsing them onto one colour", () => {
    const distinct = new Set(keys.map((key) => keyBadgeStyle(key).color));
    expect(distinct.size).toBeGreaterThan(1);
  });

  it("keeps a colour the server stated", () => {
    expect(keyBadgeStyle("TAS", "#123456").color).toBe("#123456");
  });

  it.each([["violet"], ["#12345"], [""]])("computes a colour rather than passing %s to a style", (color) => {
    expect(labelColorChoices).toContain(keyBadgeStyle("TAS", color).color);
  });
});
