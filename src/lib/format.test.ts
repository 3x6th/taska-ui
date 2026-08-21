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
 * The colour is computed, not stored, so the property being tested is that the
 * answer never moves. That is why the first case below is a golden and not a
 * comparison of two calls made in the same process: a memoised random, or a
 * module-level map filled in insertion order, would satisfy "twice in a row"
 * and still repaint everyone on the next reload. A pinned input-to-hex pairing
 * fails exactly when the hash changes, which is the promise being made.
 *
 * Changing the algorithm therefore means updating these numbers deliberately —
 * that is the cost of the guarantee, not a brittleness in the test.
 */
describe("avatarColor", () => {
  const ids = Array.from({ length: 200 }, (_, index) => `3f1f5a2e-0000-4000-8000-${String(index).padStart(12, "0")}`);

  // Real ids from the mock, so a failure names someone a reader can go and look
  // up. What they pin is the *computed* answer, which is what the screen shows
  // for Tom and Priya only — Anna, Mark and Sofia state a colour, and a stated
  // colour wins.
  it.each([
    ["6d774efa-57d8-4ae0-a27e-2984d1dfbbf6", "#c1397c"],
    ["16ad2404-96e3-4c51-b00d-55c5d1451d3c", "#077d56"],
    ["1ab80365-0843-460a-b0a1-e6dd3e0f2a0d", "#585bd8"],
  ])("pins %s to %s, in this build and every later one", (id, expected) => {
    expect(avatarColor(id)).toBe(expected);
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

  it("draws a circle rather than throwing when the id never arrived", () => {
    // `ValidateAccessTokenResponseDto` and `ProjectMemberResponseDto` mark no
    // field required, and this runs during render with no error boundary above
    // it: a throw here is a white screen, not a missing colour. The cast is the
    // point of the test — it is the shape the wire can produce and the types
    // cannot.
    expect(() => avatarColor(undefined as unknown as string)).not.toThrow();
    expect(avatarColorChoices).toContain(avatarColor(undefined as unknown as string));
  });
});

/**
 * The badge carries the project's colour as its tint only — the letters are
 * `--fg-2` from CSS — so every assertion here is about `background`, and the
 * absence of a `color` key is itself part of the contract being tested.
 */
describe("keyBadgeStyle", () => {
  const keys = Array.from({ length: 200 }, (_, index) => `K${index}`);
  const tint = (color: string) => `color-mix(in oklab, ${color} 16%, transparent)`;

  it("draws §4.5's badge: a 16% tint, and no colour on the glyph", () => {
    expect(keyBadgeStyle("TAS", "#0052cc")).toEqual({ background: tint("#0052cc") });
  });

  // Golden for the same reason as `avatarColor`'s: two calls agreeing inside
  // one process is not evidence that a reload agrees with them.
  it.each([
    ["TAS", "#6366f1"],
    ["WEB", "#0ea5e9"],
    ["MOB", "#ec4899"],
    ["OPS", "#e3a008"],
  ])("pins %s to %s, in this build and every later one", (key, expected) => {
    expect(keyBadgeStyle(key)).toEqual({ background: tint(expected) });
  });

  it("only ever computes a colour the label palette already offers", () => {
    for (const key of keys) {
      expect(labelColorChoices.map(tint)).toContain(keyBadgeStyle(key)!.background);
    }
  });

  it("reaches every colour in the palette rather than crowding into a few", () => {
    // The bound is the whole palette, not "more than one": eight keys landing
    // on two colours would satisfy a loose assertion and still leave most
    // projects looking alike, which is the failure this feature exists to fix.
    const distinct = new Set(keys.map((key) => keyBadgeStyle(key)!.background));
    expect(distinct.size).toBe(labelColorChoices.length);
  });

  it("keeps a colour the server stated", () => {
    expect(keyBadgeStyle("TAS", "#123456")).toEqual({ background: tint("#123456") });
  });

  it.each([["violet"], ["#12345"], [""]])("computes a colour rather than passing %s to a style", (color) => {
    expect(labelColorChoices.map(tint)).toContain(keyBadgeStyle("TAS", color)!.background);
  });

  it.each([["an empty key", ""], ["a blank key", "   "]])("paints nothing at all given %s", (_case, key) => {
    // The modals ask with `project?.projectKey ?? ""`, so this is the board
    // whose `getProject` failed (TAS-163). A confident hue on an empty pill
    // would be claiming to know a project the app could not read.
    expect(keyBadgeStyle(key)).toBeUndefined();
  });

  it("still honours a stated colour when the key is missing", () => {
    // Not a guess: a colour on the wire is a fact about a project we were told
    // about, whatever happened to its key.
    expect(keyBadgeStyle("", "#123456")).toEqual({ background: tint("#123456") });
  });

  it("paints nothing rather than throwing when the key never arrived", () => {
    // `ProjectResponseDto` marks nothing required either, and `listProjects`
    // hands its items through unmapped.
    expect(() => keyBadgeStyle(undefined as unknown as string)).not.toThrow();
    expect(keyBadgeStyle(undefined as unknown as string)).toBeUndefined();
  });
});
