import { describe, expect, it } from "vitest";
import { toActivityRecord, type ActivityRecord } from "../../api/tenantActivity";
import {
  KIND_GROUPS,
  KIND_LABELS,
  activitySentence,
  activityWhen,
  actorName,
  continuationFailedText,
  firstPageFailedText,
  kindChipLabel,
  leadText,
  emptyText,
  deniedText,
  sentenceText,
  showsPlatformMark,
  showsServerWords,
  unknownKindCode,
} from "./companyActivityText";

/*
 * The words of Company › Activity (DESIGN.md §4.41, TAS-524): every row of
 * the sentence table and its fallbacks, the author and target chains, the
 * platform mark, the kind filter's labels and chip, and which refusals print
 * the server's words.
 */

const ANNA = { userId: "u-anna", displayName: "Anna Ivanova", email: "anna@example.com", platformAdmin: false };
const TOM = { type: "MEMBER", id: "u-tom", displayName: "Tom Becker", email: "tom@example.com" };

const record = (wire: Record<string, unknown>): ActivityRecord =>
  toActivityRecord({ id: "r", tenantId: "t", createdAt: "2026-11-04T09:12:00Z", actor: ANNA, outcome: "SUCCEEDED", ...wire });
const say = (wire: Record<string, unknown>) => sentenceText(activitySentence(record(wire)));

describe("the sentence table (§4.41)", () => {
  it("the company's own actions", () => {
    expect(say({ kind: "TENANT_CREATED", target: { type: "TENANT", id: "t" } })).toBe("Anna Ivanova created the company.");
    expect(say({ kind: "TENANT_PAUSED" })).toBe("Anna Ivanova paused the company.");
    expect(say({ kind: "TENANT_RESUMED" })).toBe("Anna Ivanova resumed the company.");
    expect(say({ kind: "TENANT_BLOCKED" })).toBe("Anna Ivanova blocked the company.");
    expect(say({ kind: "TENANT_UNBLOCKED" })).toBe("Anna Ivanova lifted the block on the company.");
  });

  it("a rename: both names, only the new one, neither", () => {
    expect(say({ kind: "TENANT_RENAMED", details: { fromName: "Northwind", toName: "Northwind Traders" } })).toBe(
      "Anna Ivanova renamed the company from “Northwind” to “Northwind Traders”.",
    );
    expect(say({ kind: "TENANT_RENAMED", details: { toName: "Northwind Traders" } })).toBe("Anna Ivanova renamed the company to “Northwind Traders”.");
    expect(say({ kind: "TENANT_RENAMED", details: { fromName: "Northwind" } })).toBe("Anna Ivanova renamed the company.");
    expect(say({ kind: "TENANT_RENAMED" })).toBe("Anna Ivanova renamed the company.");
  });

  it("an ownership transfer: to, from and to, of the company", () => {
    expect(say({ kind: "OWNERSHIP_TRANSFERRED", target: TOM })).toBe("Anna Ivanova transferred ownership to Tom Becker.");
    // The previous owner is the author: «from» says nothing new.
    expect(say({ kind: "OWNERSHIP_TRANSFERRED", target: TOM, details: { previousOwner: { userId: "u-anna", displayName: "Anna Ivanova" } } })).toBe(
      "Anna Ivanova transferred ownership to Tom Becker.",
    );
    // A Taska administrator handing it over for someone else.
    expect(
      say({
        kind: "OWNERSHIP_TRANSFERRED",
        actor: { userId: "u-mark", platformAdmin: true },
        target: TOM,
        details: { previousOwner: { userId: "u-anna", displayName: "Anna Ivanova", email: "anna@example.com" } },
      }),
    ).toBe("A Taska administrator transferred ownership from Anna Ivanova to Tom Becker.");
    expect(say({ kind: "OWNERSHIP_TRANSFERRED", target: TOM, details: { previousOwner: { userId: "u-x", email: "x@example.com" } } })).toBe(
      "Anna Ivanova transferred ownership from x@example.com to Tom Becker.",
    );
    expect(say({ kind: "OWNERSHIP_TRANSFERRED" })).toBe("Anna Ivanova transferred ownership of the company.");
  });

  it("an invitation sent: as an Admin, a Member, an Owner, a role outside the dictionary, none; no address — «someone»", () => {
    const to = { type: "INVITATION", id: "i", email: "lin@example.com" };
    expect(say({ kind: "INVITATION_CREATED", target: to, details: { role: "TENANT_ADMIN" } })).toBe("Anna Ivanova invited lin@example.com as an Admin.");
    expect(say({ kind: "INVITATION_CREATED", target: to, details: { role: "MEMBER" } })).toBe("Anna Ivanova invited lin@example.com as a Member.");
    expect(say({ kind: "INVITATION_CREATED", target: to, details: { role: "OWNER" } })).toBe("Anna Ivanova invited lin@example.com as an Owner.");
    expect(say({ kind: "INVITATION_CREATED", target: to, details: { role: "BILLING_ADMIN" } })).toBe("Anna Ivanova invited lin@example.com as BILLING_ADMIN.");
    expect(say({ kind: "INVITATION_CREATED", target: to })).toBe("Anna Ivanova invited lin@example.com.");
    expect(say({ kind: "INVITATION_CREATED", target: { type: "INVITATION", id: "i" }, details: { role: "MEMBER" } })).toBe(
      "Anna Ivanova invited someone as a Member.",
    );
  });

  it("an invitation resent, revoked, accepted", () => {
    const to = { type: "INVITATION", id: "i", email: "kai@example.com" };
    expect(say({ kind: "INVITATION_RESENT", target: to })).toBe("Anna Ivanova resent the invitation to kai@example.com.");
    expect(say({ kind: "INVITATION_RESENT", target: { type: "INVITATION", id: "i" } })).toBe("Anna Ivanova resent an invitation.");
    expect(say({ kind: "INVITATION_REVOKED", target: to })).toBe("Anna Ivanova revoked the invitation to kai@example.com.");
    expect(say({ kind: "INVITATION_REVOKED" })).toBe("Anna Ivanova revoked an invitation.");
    // The target is never printed.
    expect(say({ kind: "INVITATION_ACCEPTED", target: to })).toBe("Anna Ivanova accepted an invitation and joined the company.");
  });

  it("a role change: from and to, only to, neither — and one's own", () => {
    expect(say({ kind: "ROLE_CHANGED", target: TOM, details: { fromRole: "MEMBER", toRole: "TENANT_ADMIN" } })).toBe(
      "Anna Ivanova changed the role of Tom Becker from Member to Admin.",
    );
    expect(say({ kind: "ROLE_CHANGED", target: TOM, details: { toRole: "MEMBER" } })).toBe("Anna Ivanova changed the role of Tom Becker to Member.");
    expect(say({ kind: "ROLE_CHANGED", target: TOM })).toBe("Anna Ivanova changed the role of Tom Becker.");
    expect(say({ kind: "ROLE_CHANGED", target: TOM, details: { fromRole: "MEMBER", toRole: "AUDITOR" } })).toBe(
      "Anna Ivanova changed the role of Tom Becker from Member to AUDITOR.",
    );
    const self = { type: "MEMBER", id: "u-anna", displayName: "Anna Ivanova" };
    expect(say({ kind: "ROLE_CHANGED", target: self, details: { fromRole: "TENANT_ADMIN", toRole: "MEMBER" } })).toBe(
      "Anna Ivanova changed their own role from Admin to Member.",
    );
    expect(say({ kind: "ROLE_CHANGED", target: self, details: { toRole: "MEMBER" } })).toBe("Anna Ivanova changed their own role to Member.");
  });

  it("members suspended, reactivated, removed, left — «someone» for a target without a name or address", () => {
    expect(say({ kind: "MEMBER_SUSPENDED", target: TOM })).toBe("Anna Ivanova suspended Tom Becker.");
    expect(say({ kind: "MEMBER_SUSPENDED", target: { type: "MEMBER", id: "u", email: "omar@example.com" } })).toBe("Anna Ivanova suspended omar@example.com.");
    expect(say({ kind: "MEMBER_SUSPENDED", target: { type: "MEMBER", id: "u" } })).toBe("Anna Ivanova suspended someone.");
    expect(say({ kind: "MEMBER_SUSPENDED" })).toBe("Anna Ivanova suspended someone.");
    expect(say({ kind: "MEMBER_REACTIVATED", target: TOM })).toBe("Anna Ivanova reactivated Tom Becker.");
    expect(say({ kind: "MEMBER_REMOVED", target: TOM })).toBe("Anna Ivanova removed Tom Becker from the company.");
    expect(say({ kind: "MEMBER_REMOVED", target: { type: "MEMBER", id: "u" } })).toBe("Anna Ivanova removed someone from the company.");
    expect(say({ kind: "MEMBER_LEFT", target: TOM })).toBe("Anna Ivanova left the company.");
  });

  it("a kind outside the dictionary, or none: «Other action by {a}», on its target", () => {
    expect(say({ kind: "TENANT_EXPORTED", target: { type: "TENANT", id: "t" } })).toBe("Other action by Anna Ivanova on the company.");
    expect(say({ kind: "INVITATION_EXTENDED", target: { type: "INVITATION", id: "i", email: "kai@example.com" } })).toBe(
      "Other action by Anna Ivanova on the invitation to kai@example.com.",
    );
    expect(say({ kind: "INVITATION_EXTENDED", target: { type: "INVITATION", id: "i" } })).toBe("Other action by Anna Ivanova on an invitation.");
    expect(say({ kind: "SEAT_MOVED", target: TOM })).toBe("Other action by Anna Ivanova on Tom Becker.");
    expect(say({ kind: "SEAT_MOVED", target: { type: "PROJECT", id: "p", displayName: "Web App" } })).toBe("Other action by Anna Ivanova on Web App.");
    expect(say({ kind: "SEAT_MOVED", target: { type: "PROJECT", id: "p" } })).toBe("Other action by Anna Ivanova.");
    expect(say({ kind: undefined })).toBe("Other action by Anna Ivanova.");
    expect(say({ kind: "SEAT_MOVED", actor: null })).toBe("Other action by someone.");
    expect(say({ kind: "SEAT_MOVED", actor: { userId: "u-mark", platformAdmin: true } })).toBe("Other action by a Taska administrator.");
    // The code goes in the meta line — a known kind and a missing one have none.
    expect(unknownKindCode(record({ kind: "TENANT_EXPORTED" }))).toBe("TENANT_EXPORTED");
    expect(unknownKindCode(record({ kind: "TENANT_PAUSED" }))).toBeNull();
    expect(unknownKindCode(record({ kind: undefined }))).toBeNull();
  });

  it("a target type outside the dictionary: its name, its address, else no target", () => {
    expect(say({ kind: "MEMBER_SUSPENDED", target: { type: "SERVICE", id: "s", email: "bot@example.com" } })).toBe("Anna Ivanova suspended bot@example.com.");
    expect(say({ kind: "MEMBER_SUSPENDED", target: { type: "SERVICE", id: "s" } })).toBe("Anna Ivanova suspended someone.");
  });

  it("«Not done: » only for an outcome that came and is not SUCCEEDED (art-director N1)", () => {
    expect(say({ kind: "TENANT_PAUSED", outcome: "DENIED" })).toBe("Not done: Anna Ivanova paused the company.");
    expect(say({ kind: "TENANT_PAUSED", outcome: "SUCCEEDED" })).toBe("Anna Ivanova paused the company.");
    expect(say({ kind: "TENANT_PAUSED", outcome: undefined })).toBe("Anna Ivanova paused the company.");
  });
});

describe("the author and the platform mark (§4.41 «Автор и цель»)", () => {
  it("name → address → «A Taska administrator» for one → «Someone»", () => {
    expect(actorName({ ...ANNA })).toBe("Anna Ivanova");
    expect(actorName({ userId: "u", displayName: null, email: "anna@example.com", platformAdmin: false })).toBe("anna@example.com");
    expect(actorName({ userId: "u", displayName: null, email: null, platformAdmin: true })).toBe("A Taska administrator");
    expect(actorName({ userId: "u", displayName: null, email: null, platformAdmin: false })).toBe("Someone");
    expect(actorName(null)).toBe("Someone");
    expect(say({ kind: "TENANT_BLOCKED", actor: { userId: "u-mark", platformAdmin: true } })).toBe("A Taska administrator blocked the company.");
    expect(say({ kind: "MEMBER_LEFT", actor: { userId: "u-gone", platformAdmin: false } })).toBe("Someone left the company.");
  });

  it("the author is the sentence's first part, the one the link is made of", () => {
    const parts = activitySentence(record({ kind: "MEMBER_SUSPENDED", target: TOM })).parts;
    expect(parts[0]).toEqual({ type: "actor", text: "Anna Ivanova" });
    expect(parts.find((part) => part.text === "Tom Becker")).toEqual({ type: "named", text: "Tom Becker" });
    // Fallback words and the company are plain words, never named.
    expect(activitySentence(record({ kind: "MEMBER_SUSPENDED" })).parts[2]).toEqual({ type: "words", text: "someone" });
  });

  it("the meta line's mark: only a platform administrator who has a name or an address", () => {
    expect(showsPlatformMark({ userId: "u", displayName: "Mark Lee", email: null, platformAdmin: true })).toBe(true);
    expect(showsPlatformMark({ userId: "u", displayName: null, email: "mark@example.com", platformAdmin: true })).toBe(true);
    // Nameless: the sentence names them instead.
    expect(showsPlatformMark({ userId: "u", displayName: null, email: null, platformAdmin: true })).toBe(false);
    expect(showsPlatformMark({ ...ANNA })).toBe(false);
    expect(showsPlatformMark(null)).toBe(false);
  });
});

describe("the kind filter (§4.41 «Фильтр по виду»)", () => {
  it("three groups of the sixteen, in the table's order", () => {
    expect(KIND_GROUPS.map((group) => [group.label, group.kinds.map((kind) => KIND_LABELS[kind])])).toEqual([
      ["Company", ["Company created", "Company renamed", "Company paused", "Company resumed", "Company blocked", "Block lifted", "Ownership transferred"]],
      ["Invitations", ["Invitation sent", "Invitation resent", "Invitation revoked", "Invitation accepted"]],
      ["Members", ["Role changed", "Member suspended", "Member reactivated", "Member removed", "Member left"]],
    ]);
  });

  it("the chip: one kind, several in the table's order, an unknown code as it came, each once", () => {
    expect(kindChipLabel(["INVITATION_CREATED"])).toBe("Action is Invitation sent");
    expect(kindChipLabel(["MEMBER_LEFT", "TENANT_PAUSED", "MEMBER_LEFT"])).toBe("Action is Company paused or Member left");
    expect(kindChipLabel(["TENANT_EXPORTED", "ROLE_CHANGED"])).toBe("Action is Role changed or TENANT_EXPORTED");
  });
});

describe("the page's words", () => {
  it("lead, empty, refusal — with «this company» when the name is not known", () => {
    expect(leadText("Northwind")).toBe("Who changed what in Northwind, newest first.");
    expect(leadText(null)).toBe("Who changed what in this company, newest first.");
    expect(emptyText("Northwind")).toBe("No activity in Northwind yet.");
    expect(deniedText("Globex")).toBe("Only the admins and the owner of Globex can see its activity.");
  });

  it("the time, local and without a countdown; another year carries it", () => {
    const now = new Date("2026-11-05T12:00:00");
    expect(activityWhen("2026-11-04T09:12:00", now)).toBe("Nov 4, 09:12");
    expect(activityWhen("2025-11-04T09:12:00", now)).toBe("Nov 4, 2025, 09:12");
  });

  it("a 429 says its wait; everything else the plain sentence", () => {
    const tooMany = Object.assign(new Error("slow down"), { status: 429, code: "RATE_LIMITED", retryAfterSeconds: 30 });
    expect(firstPageFailedText(tooMany)).toBe("Activity could not be loaded. Try again in 30 seconds.");
    expect(continuationFailedText(tooMany)).toBe("More activity could not be loaded. Try again in 30 seconds.");
    const down = Object.assign(new Error("upstream"), { status: 503, code: "DEPENDENCY_UNAVAILABLE" });
    expect(firstPageFailedText(down)).toBe("Activity could not be loaded.");
  });

  it("the server's words: a 5xx and a code outside the dictionary — never a known code's, never a lost answer's", () => {
    expect(showsServerWords(Object.assign(new Error("upstream"), { status: 503, code: "DEPENDENCY_UNAVAILABLE" }))).toBe(true);
    expect(showsServerWords(Object.assign(new Error("No static resource api/v1/tenants/x/activity"), { status: 404, code: "NOT_FOUND" }))).toBe(true);
    expect(showsServerWords(Object.assign(new Error("tenant is not active"), { status: 409, code: "INVALID_STATE" }))).toBe(false);
    expect(showsServerWords(new TypeError("Failed to fetch"))).toBe(false);
  });
});
