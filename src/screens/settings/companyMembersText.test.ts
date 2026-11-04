import { describe, expect, it } from "vitest";
import type { Invitation } from "../../api/tenantMembers";
import {
  demoteQuestion,
  expiredLine,
  inviteHeadText,
  inviteRefusalWords,
  invitationsPhrase,
  leadText,
  leaveQuestion,
  leaveRefusalWords,
  memberRefusalWords,
  pendingLine,
  removeQuestion,
  resentStatus,
  roleWord,
  seatLineText,
  suspendQuestion,
} from "./companyMembersText";

/*
 * Every sentence of Settings › Members (DESIGN.md §4.38, TAS-502) — the seat
 * line from the server's numbers, the strips' true sentences with the
 * invitations phrase, and the refusal table by Problem.code.
 */

const refusal = (status: number | null, code: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error("server words"), { ...(status === null ? {} : { status }), code, requestId: "rid", details: null, reasons: [], ...extra });

const invitation = (overrides: Partial<Invitation> = {}): Invitation => ({
  id: "i",
  tenantId: "t",
  email: "kai@example.com",
  role: "MEMBER",
  state: "PENDING",
  expiresAt: "2026-11-12T10:30:00Z",
  createdBy: "anna",
  projectGrants: [],
  version: "1",
  ...overrides,
});

const NOW = new Date("2026-11-05T10:00:00Z");

describe("the lead and the role words", () => {
  it("names the company, else «this company»; Owner, Admin, Member, or the role as it came", () => {
    expect(leadText("Northwind", true)).toBe("Everyone in Northwind, and the people invited to join.");
    expect(leadText(null, false)).toBe("Everyone in this company. Only its admins can invite people or change members.");
    expect([roleWord("TENANT_ADMIN", true), roleWord("TENANT_ADMIN"), roleWord("MEMBER"), roleWord("AUDITOR"), roleWord(null)]).toEqual([
      "Owner",
      "Admin",
      "Member",
      "AUDITOR",
      "Unknown role",
    ]);
  });
});

describe("the seat line (B4): the server's numbers, as they are", () => {
  it("in use, full, over the limit, unlimited — with the held tail", () => {
    expect(seatLineText({ used: 3n, reserved: 0n, limit: 5n })).toEqual({ text: "3 of 5 seats in use", full: false });
    expect(seatLineText({ used: 3n, reserved: 1n, limit: 5n })).toEqual({ text: "4 of 5 seats in use · 1 held by an invitation", full: false });
    expect(seatLineText({ used: 4n, reserved: 1n, limit: 5n })).toEqual({ text: "All 5 seats are in use · 1 held by an invitation", full: true });
    expect(seatLineText({ used: 6n, reserved: 2n, limit: 5n })).toEqual({ text: "8 of 5 seats in use · 2 held by invitations", full: true });
    expect(seatLineText({ used: 12n, reserved: 3n, limit: null })).toEqual({ text: "15 seats in use · no limit · 3 held by invitations", full: false });
    expect(seatLineText({ used: 1n, reserved: 0n, limit: null }).text).toBe("1 seat in use · no limit");
  });

  it("the invite modal's head says the free seats only when they were read", () => {
    expect(inviteHeadText("Northwind", { used: 3n, reserved: 1n, limit: 5n })).toBe(
      "The invitation holds one of Northwind’s seats until it’s accepted, revoked or expires. 1 of 5 are free.",
    );
    expect(inviteHeadText(null, null)).toBe("The invitation holds one of this company’s seats until it’s accepted, revoked or expires.");
    expect(inviteHeadText("Acme", { used: 9n, reserved: 0n, limit: null })).not.toMatch(/free/);
  });
});

describe("the rows' second lines", () => {
  it("pending: who invited, the expiry as sent, the projects; once the clock passed it, «Expired · releasing its seat»", () => {
    expect(pendingLine(invitation({ projectGrants: [{ projectId: "p", role: "MEMBER" }] }), "you", false, NOW)).toMatch(
      /^Invited by you · Expires Nov 12, \d\d:30 · 1 project$/,
    );
    expect(pendingLine(invitation(), null, false, NOW)).toMatch(/^Expires Nov 12, \d\d:30$/);
    expect(pendingLine(invitation({ projectGrants: [{ projectId: "p", role: "MEMBER" }, { projectId: "q", role: "VIEWER" }] }), "Priya Nair", false, NOW)).toMatch(/ · 2 projects$/);
    expect(pendingLine(invitation(), "you", true, NOW)).toBe("Expired · releasing its seat");
  });

  it("expired: the day, and who invited", () => {
    expect(expiredLine(invitation({ state: "EXPIRED", expiresAt: "2026-11-03T10:00:00Z" }), "you", NOW)).toBe("Expired Nov 3 · invited by you");
    expect(expiredLine(invitation({ state: "EXPIRED", expiresAt: "2025-11-03T10:00:00Z" }), null, NOW)).toBe("Expired Nov 3, 2025");
  });
});

describe("the strips ask with only true sentences (art-director B6)", () => {
  it("the invitations phrase is counted, said only when there are some, and about oneself in the first person", () => {
    expect(invitationsPhrase(0, false)).toBe("");
    expect(invitationsPhrase(1, false)).toBe(" The invitation they sent is revoked.");
    expect(invitationsPhrase(3, true)).toBe(" The 3 invitations you sent are revoked.");
  });

  it("demote, suspend, remove and leave", () => {
    expect(demoteQuestion("Priya Nair", false, 1)).toEqual({
      sentence: "Priya Nair will be a Member and keep only the projects they were added to. The invitation they sent is revoked.",
      answer: "Make Member",
    });
    expect(demoteQuestion("Anna", true, 0)).toEqual({
      sentence:
        "You’ll be a Member and keep only the projects you were added to. You won’t be able to manage members or make yourself an admin again.",
      answer: "Make me a Member",
    });
    expect(suspendQuestion("Tom Becker", "Northwind", 0)).toBe(
      "Tom Becker loses access to Northwind at once but keeps their seat. If you reactivate them later, they come back as a Member, without their projects.",
    );
    expect(removeQuestion("Tom Becker", "Northwind", false, 2)).toBe(
      "Tom Becker is removed from Northwind and loses access at once. Their seat is freed. The 2 invitations they sent are revoked.",
    );
    expect(removeQuestion("Omar Haddad", "Northwind", true, 0)).toBe("Omar Haddad is removed from Northwind. Their seat is freed.");
    expect(leaveQuestion("Globex", 0)).toBe("You’ll lose access to Globex and its projects at once. Only an admin can invite you back.");
  });
});

describe("the refusal table, by Problem.code (§4.38 «Отказы»)", () => {
  const who = { name: "Priya Nair", self: false, email: "kai@example.com", company: "Umbrella" };

  it("LAST_ADMIN and OWNER_MEMBERSHIP_PROTECTED per action, without the server's words", () => {
    expect(memberRefusalWords("role", refusal(409, "LAST_ADMIN"), who)).toEqual({
      text: "Priya Nair is the only active admin, so their role did not change.",
      words: null,
    });
    expect(memberRefusalWords("role", refusal(409, "LAST_ADMIN"), { ...who, self: true }).text).toBe(
      "You are the only active admin, so your role did not change.",
    );
    expect(memberRefusalWords("suspend", refusal(409, "LAST_ADMIN"), who).text).toBe("Priya Nair is the only active admin, so they were not suspended.");
    expect(memberRefusalWords("remove", refusal(409, "OWNER_MEMBERSHIP_PROTECTED"), who).text).toBe(
      "Priya Nair owns Umbrella, so they were not removed.",
    );
  });

  it("versions, gone, restrictions, scope — members and invitations each in their words", () => {
    expect(memberRefusalWords("role", refusal(412, "VERSION_CONFLICT"), who).text).toBe(
      "Priya Nair was changed elsewhere, so nothing changed. The list now shows the latest.",
    );
    expect(memberRefusalWords("revoke", refusal(412, "VERSION_CONFLICT"), who).text).toBe(
      "This invitation changed elsewhere, so nothing changed. The list now shows the latest.",
    );
    expect(memberRefusalWords("remove", refusal(404, "RESOURCE_NOT_FOUND"), who).text).toBe("Priya Nair is no longer in Umbrella.");
    expect(memberRefusalWords("resend", refusal(404, "RESOURCE_NOT_FOUND"), who).text).toBe("This invitation no longer exists.");
    expect(memberRefusalWords("resend", refusal(422, "INVITATION_EXPIRED"), who).text).toBe(
      "The invitation to kai@example.com has expired, so nothing was sent. Invite them again.",
    );
    expect(memberRefusalWords("suspend", refusal(403, "READ_ONLY"), who).text).toBe("Members can’t be changed right now.");
    expect(memberRefusalWords("revoke", refusal(403, "CAPABILITY_DISABLED"), who).text).toBe("Invitations can’t be changed right now.");
    expect(memberRefusalWords("role", refusal(403, "SCOPE_DENIED"), who).text).toBe("Only company admins can change members.");
    expect(memberRefusalWords("resend", refusal(429, "RATE_LIMITED", { retryAfterSeconds: 30 }), who).text).toBe(
      "An email to kai@example.com was queued moments ago. Try again in 30 seconds.",
    );
  });

  it("the server's words only for a code outside the table and an answer that never came", () => {
    // INVALID_STATE never prints the server's words (§4.33: they may say «tenant»; art-director N-c).
    expect(memberRefusalWords("suspend", refusal(409, "INVALID_STATE"), who)).toEqual({ text: "Priya Nair was not suspended.", words: null });
    expect(memberRefusalWords("reactivate", refusal(409, "SOMETHING_NEW"), who)).toEqual({ text: "Priya Nair was not reactivated.", words: "server words" });
    expect(memberRefusalWords("role", refusal(503, "DEPENDENCY_UNAVAILABLE"), who)).toEqual({
      text: "Taska couldn’t confirm the change. The list shows what Taska has now.",
      words: "server words",
    });
    expect(memberRefusalWords("revoke", new TypeError("Failed to fetch"), who).text).toBe(
      "Taska couldn’t confirm the change. The list shows what Taska has now.",
    );
    expect(memberRefusalWords("resend", refusal(400, "SOMETHING_NEW"), who).text).toBe("The invitation email to kai@example.com was not sent again.");
  });

  it("the invite modal and leaving", () => {
    expect(inviteRefusalWords(refusal(422, "QUOTA_EXCEEDED")).text).toBe(
      "All seats are in use, so this invitation was not created. Remove a member or revoke an invitation to free a seat.",
    );
    expect(inviteRefusalWords(refusal(400, "VALIDATION_FAILED")).text).toBe("Taska didn’t accept this email or one of the chosen projects.");
    expect(inviteRefusalWords(refusal(429, "RATE_LIMITED", { retryAfterSeconds: 120 })).text).toBe(
      "Too many invitations were sent just now. Try again in 2 minutes.",
    );
    expect(inviteRefusalWords(refusal(403, "READ_ONLY")).text).toBe("Invitations can’t be sent right now.");
    expect(inviteRefusalWords(refusal(502, "DEPENDENCY_UNAVAILABLE"))).toEqual({
      text: "Taska couldn’t confirm the invitation was created. Try again — it won’t create a second one.",
      words: "server words",
    });
    expect(inviteRefusalWords(refusal(409, "INVALID_STATE"))).toEqual({ text: "This invitation was not created.", words: null });
    const known = { email: "sofia@example.com", company: "Northwind", member: true, pending: false };
    expect(inviteRefusalWords(refusal(409, "INVALID_STATE"), known).text).toBe(
      "sofia@example.com is already a member of Northwind, so no invitation was created.",
    );
    expect(inviteRefusalWords(refusal(409, "INVALID_STATE"), { ...known, email: "kai@example.com", member: false, pending: true }).text).toBe(
      "kai@example.com already has a pending invitation to Northwind, so no new one was created.",
    );
    expect(leaveRefusalWords(refusal(409, "LAST_ADMIN"), "Globex").text).toBe("You’re the only active admin, so you didn’t leave Globex.");
    expect(leaveRefusalWords(refusal(409, "OWNER_MEMBERSHIP_PROTECTED"), "Globex").text).toBe("You own Globex, so you didn’t leave it.");
    // An answer that never came is not «you didn't leave»: the leave may have been applied (B-1).
    expect(leaveRefusalWords(refusal(500, "X"), null)).toEqual({
      text: "Taska couldn’t confirm that you left this company. Press Leave company again to check.",
      words: "server words",
    });
    expect(leaveRefusalWords(new TypeError("Failed to fetch"), "Globex").text).toBe(
      "Taska couldn’t confirm that you left Globex. Press Leave company again to check.",
    );
    expect(leaveRefusalWords(refusal(409, "INVALID_STATE"), "Globex")).toEqual({ text: "You didn’t leave Globex.", words: null });
    expect(leaveRefusalWords(refusal(400, "SOMETHING_NEW"), "Globex")).toEqual({ text: "You didn’t leave Globex.", words: "server words" });
    expect(leaveRefusalWords(null, "Globex").text).toBe("You didn’t leave Globex.");
  });

  it("resend's status keeps the expiry as sent", () => {
    expect(resentStatus("kai@example.com", "2026-11-12T10:30:00Z", NOW)).toMatch(
      /^Another invitation email to kai@example\.com is queued\. The earlier link stops working; it still expires Nov 12, \d\d:30\.$/,
    );
  });
});
