import { describe, expect, it } from "vitest";
import type { Invitation, Membership } from "../../api/tenantMembers";
import {
  earliestPendingExpiry,
  groupRows,
  invitationsSentBy,
  memberControls,
  memberSubject,
  readerAccess,
} from "./companyMembers";

/*
 * Settings › Members' rules as pure functions (TAS-502): gating from the
 * reader's own row only (api-contract-guard B3, B8; art-director B5 as
 * reconciled) and the groups' order (B2). The key of an intent (§4) is
 * src/lib/intentKey.test.ts.
 */

const member = (userId: string, overrides: Partial<Membership> = {}): Membership => ({
  id: `m-${userId}`,
  tenantId: "t",
  userId,
  role: "MEMBER",
  state: "ACTIVE",
  isOwner: false,
  displayName: userId,
  email: `${userId}@example.com`,
  avatarPath: null,
  version: "1",
  ...overrides,
});

const invitation = (id: string, overrides: Partial<Invitation> = {}): Invitation => ({
  id,
  tenantId: "t",
  email: `${id}@example.com`,
  role: "MEMBER",
  state: "PENDING",
  expiresAt: "2026-11-12T10:00:00Z",
  createdBy: "anna",
  projectGrants: [],
  version: "1",
  ...overrides,
});

describe("the reader's own row decides what is offered (B8)", () => {
  const list = [
    member("anna", { role: "TENANT_ADMIN", isOwner: true }),
    member("sofia", { role: "TENANT_ADMIN" }),
    member("tom"),
    member("omar", { state: "SUSPENDED" }),
    member("zed", { role: "AUDITOR" }),
    member("yan", { state: "ON_LEAVE" }),
  ];

  it("an admin's own row: role only — the way out is Leave; the owner's row: nothing; ACTIVE: all three; SUSPENDED: reactivate and remove", () => {
    const access = readerAccess(list, "sofia");
    expect(access).toMatchObject({ known: true, admin: true, owner: false });
    expect(memberControls(list[1], access, "sofia")).toEqual({ role: true, action: null, remove: false });
    expect(memberControls(list[0], access, "sofia")).toEqual({ role: false, action: null, remove: false });
    expect(memberControls(list[2], access, "sofia")).toEqual({ role: true, action: "suspend", remove: true });
    expect(memberControls(list[3], access, "sofia")).toEqual({ role: false, action: "reactivate", remove: true });
  });

  it("a role or a state outside the dictionary offers nothing", () => {
    const access = readerAccess(list, "sofia");
    expect(memberControls(list[4], access, "sofia")).toEqual({ role: false, action: null, remove: false });
    expect(memberControls(list[5], access, "sofia")).toEqual({ role: false, action: null, remove: false });
  });

  it("the last admin is never computed: an admin row keeps its controls when it is the only other admin", () => {
    const two = [member("anna", { role: "TENANT_ADMIN", isOwner: true }), member("priya", { role: "TENANT_ADMIN" })];
    expect(memberControls(two[1], readerAccess(two, "anna"), "anna")).toEqual({ role: true, action: "suspend", remove: true });
  });

  it("a member, a missing own row and an unknown own role offer nothing", () => {
    expect(readerAccess(list, "tom")).toMatchObject({ known: true, admin: false });
    expect(memberControls(list[2], readerAccess(list, "tom"), "tom")).toEqual({ role: false, action: null, remove: false });
    expect(readerAccess(list, "nobody")).toEqual({ known: false, admin: false, owner: false, row: null });
    expect(readerAccess(list, null).known).toBe(false);
    expect(readerAccess(list, "zed")).toMatchObject({ known: false, admin: false });
    // An admin only by a known role that is ACTIVE (M42).
    expect(readerAccess([member("me", { role: "TENANT_ADMIN", state: "SUSPENDED" })], "me")).toMatchObject({ known: true, admin: false });
    expect(readerAccess([member("me", { role: "TENANT_ADMIN", state: "FROZEN" })], "me")).toMatchObject({ known: false, admin: false });
    expect(readerAccess([member("me", { role: "TENANT_OWNER", state: "ACTIVE" })], "me")).toMatchObject({ known: false, admin: false });
  });

  it("an unnamed row (develop's empty profile) is the address, else the short id; one's own is «You»", () => {
    expect(memberSubject(member("u-1", { displayName: null }), null)).toEqual({ title: "Unknown", name: "u-1@example.com", self: false, named: false });
    expect(memberSubject(member("u-1", { displayName: null, email: null }), "u-1")).toMatchObject({ title: "You", self: true, named: false });
    expect(memberSubject(member("0123456789abcdef", { displayName: null, email: null }), null).name).toMatch(/^The member with ID /);
  });
});

describe("the groups (B2)", () => {
  it("pending newest first, members by name with the reader's row not lifted, expired freshest first; the rest not drawn", () => {
    const groups = groupRows(
      [member("zoe", { displayName: "Zoë" }), member("adam", { displayName: "adam" }), member("me", { displayName: "Mia" }), member("gone", { state: "REMOVED" })],
      [
        invitation("a", { expiresAt: "2026-11-10T10:00:00Z" }),
        invitation("b", { expiresAt: "2026-11-12T10:00:00Z" }),
        invitation("c", { state: "EXPIRED", expiresAt: "2026-10-01T10:00:00Z" }),
        invitation("d", { state: "EXPIRED", expiresAt: "2026-11-01T10:00:00Z" }),
        invitation("e", { state: "REVOKED" }),
        invitation("f", { state: "ACCEPTED" }),
        invitation("g", { state: "FUTURE" }),
      ],
    );
    expect(groups.pending.map((row) => row.id)).toEqual(["b", "a"]);
    expect(groups.members.map((row) => row.userId)).toEqual(["adam", "me", "zoe"]);
    expect(groups.expired.map((row) => row.id)).toEqual(["d", "c"]);
  });

  it("counts a person's pending invitations from createdBy, and finds the earliest pending expiry", () => {
    const rows = [
      invitation("a", { createdBy: "priya", expiresAt: "2026-11-10T10:00:00Z" }),
      invitation("b", { createdBy: "priya", expiresAt: "2026-11-08T10:00:00Z" }),
      invitation("c", { createdBy: "priya", state: "EXPIRED", expiresAt: "2026-11-01T10:00:00Z" }),
      invitation("d", { createdBy: "tom" }),
    ];
    expect(invitationsSentBy(rows, "priya")).toBe(2);
    expect(invitationsSentBy(undefined, "priya")).toBe(0);
    expect(earliestPendingExpiry(rows)).toBe(Date.parse("2026-11-08T10:00:00Z"));
    expect(earliestPendingExpiry([])).toBeNull();
  });
});
