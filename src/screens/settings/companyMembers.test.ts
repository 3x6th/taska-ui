import { describe, expect, it } from "vitest";
import type { Invitation, Membership } from "../../api/tenantMembers";
import {
  earliestPendingExpiry,
  groupRows,
  invitationsSentBy,
  isIndefinite,
  keyFor,
  memberControls,
  memberSubject,
  readerAccess,
} from "./companyMembers";

/*
 * Settings › Members' rules as pure functions (TAS-502): gating from the
 * reader's own row only (api-contract-guard B3, B8; art-director B5 as
 * reconciled), the groups' order (B2), and the key of an intent (§4).
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

const refusal = (status: number | undefined, code: string) =>
  Object.assign(new Error(code), { ...(status === undefined ? {} : { status }), code, requestId: "rid", details: null, reasons: [] });

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

describe("the key of an intent (§4)", () => {
  it("is reused only for the same intent after an answer that never came", () => {
    const first = keyFor(null, "role:MEMBER:3");
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(keyFor({ signature: "role:MEMBER:3", key: first, open: true }, "role:MEMBER:3")).toBe(first);
    expect(keyFor({ signature: "role:MEMBER:3", key: first, open: false }, "role:MEMBER:3")).not.toBe(first);
    expect(keyFor({ signature: "role:MEMBER:3", key: first, open: true }, "role:MEMBER:4")).not.toBe(first);
  });

  it("an answer that never came is no status, 408, 429 or 5xx — never a refusal", () => {
    expect(isIndefinite(new TypeError("Failed to fetch"))).toBe(true);
    expect(isIndefinite(refusal(503, "DEPENDENCY_UNAVAILABLE"))).toBe(true);
    expect(isIndefinite(refusal(429, "RATE_LIMITED"))).toBe(true);
    expect(isIndefinite(refusal(408, "TIMEOUT"))).toBe(true);
    expect(isIndefinite(refusal(412, "VERSION_CONFLICT"))).toBe(false);
    expect(isIndefinite(refusal(409, "LAST_ADMIN"))).toBe(false);
  });
});
