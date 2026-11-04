import { apiErrorFacts, refusalCode, refusalRetryAfter } from "../../api/errors";
import { freeSeats, type Invitation, type Membership, type Seats } from "../../api/tenantMembers";
import { formatWait } from "../authText";
import { formatDeadline } from "../companySetupText";

/*
 * The words of Settings › Members (TAS-502, DESIGN.md §4.38) as pure values,
 * so every sentence is pinned by a unit test. The UI says «company», «Admin»,
 * «Member», «Owner» — never «tenant», «team» or «workspace» (§4.33). A
 * sentence names the company by the reader's list, else «this company».
 */

/** «{Company}» inside a sentence. */
export const companyInside = (name: string | null) => name ?? "this company";
/** «{Company}’s». */
const companys = (name: string | null) => `${companyInside(name)}’s`;

/** A role as a word — «Owner» for the owner's row; a role outside the dictionary as it came. */
export function roleWord(role: string | null, isOwner = false): string {
  if (isOwner) return "Owner";
  if (role === "TENANT_ADMIN") return "Admin";
  if (role === "MEMBER") return "Member";
  return role ?? "Unknown role";
}

export function leadText(company: string | null, admin: boolean): string {
  return admin
    ? `Everyone in ${companyInside(company)}, and the people invited to join.`
    : `Everyone in ${companyInside(company)}. Only its admins can invite people or change members.`;
}

export const UNCHECKED_TEXT = "Taska couldn’t check what you can change here, so changes aren’t offered.";
export const LOADING_TEXT = "Loading members";
export const MEMBERS_READ_FAILED = "Members could not be loaded.";
export const MEMBERS_REFRESH_FAILED = "Members could not be refreshed. The last loaded list is shown.";
export const INVITATIONS_READ_FAILED = "Invitations could not be loaded.";
export const SEATS_READ_FAILED = "Seat usage could not be loaded.";
export const SEATS_FULL_HINT = "To invite someone, remove a member or revoke an invitation.";

/* ---------------------------------------------------------------- seats */

const heldTail = (reserved: bigint) =>
  reserved === 0n ? "" : reserved === 1n ? " · 1 held by an invitation" : ` · ${reserved} held by invitations`;

/** The seat line (§4.38 «Места»): the server's numbers as they are, never derived from the list. */
export function seatLineText(seats: Seats): { text: string; full: boolean } {
  const total = seats.used + seats.reserved;
  const tail = heldTail(seats.reserved);
  if (seats.limit === null) return { text: `${total} ${total === 1n ? "seat" : "seats"} in use · no limit${tail}`, full: false };
  if (total < seats.limit) return { text: `${total} of ${seats.limit} seats in use${tail}`, full: false };
  if (total > seats.limit) return { text: `${total} of ${seats.limit} seats in use${tail}`, full: true };
  const all = seats.limit === 1n ? "The 1 seat is in use" : `All ${seats.limit} seats are in use`;
  return { text: `${all}${tail}`, full: true };
}

/** The invite modal's first line, with the free seats when they were read. */
export function inviteHeadText(company: string | null, seats: Seats | null): string {
  const base = `The invitation holds one of ${companys(company)} seats until it’s accepted, revoked or expires.`;
  if (seats === null || seats.limit === null) return base;
  return `${base} ${freeSeats(seats)} of ${seats.limit} are free.`;
}

/* ---------------------------------------------------------------- dates */

/** «Nov 12, 14:32»; another year — «Nov 12, 2027, 14:32». Local time, as sent, no countdown (§4.37). */
export const formatWhen = (iso: string, now: Date = new Date()) => formatDeadline(iso, now);

/** «Nov 3»; another year — «Nov 3, 2025». */
export function formatDay(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  }).format(date);
}

/* ----------------------------------------------------------- the rows */

const projectsTail = (count: number) => (count === 0 ? "" : count === 1 ? " · 1 project" : ` · ${count} projects`);

/**
 * A pending invitation's second line: «Invited by {name} · Expires {when}» —
 * «Invited by you» for the reader's own, no «Invited by» when `createdBy` is
 * not in the list — and the projects it grants. Once the local clock has
 * passed `expiresAt` and the server still says PENDING: «Expired · releasing
 * its seat» (EXPIRED is never set by the client).
 */
export function pendingLine(invitation: Invitation, invitedBy: string | null, passed: boolean, now: Date = new Date()): string {
  if (passed) return "Expired · releasing its seat";
  const parts: string[] = [];
  if (invitedBy !== null) parts.push(`Invited by ${invitedBy}`);
  if (invitation.expiresAt !== null && !Number.isNaN(Date.parse(invitation.expiresAt))) {
    parts.push(`Expires ${formatWhen(invitation.expiresAt, now)}`);
  }
  return `${parts.join(" · ")}${projectsTail(invitation.projectGrants.length)}`;
}

/** An expired invitation's second line: «Expired {Mon D}» and « · invited by …». */
export function expiredLine(invitation: Invitation, invitedBy: string | null, now: Date = new Date()): string {
  const when =
    invitation.expiresAt !== null && !Number.isNaN(Date.parse(invitation.expiresAt))
      ? `Expired ${formatDay(invitation.expiresAt, now)}`
      : "Expired";
  return invitedBy === null ? when : `${when} · invited by ${invitedBy}`;
}

/* ---------------------------------------------------------- the strips */

/** «The {n} invitations they sent are revoked.» — only when n > 0 (contracts §8, L03). */
export function invitationsPhrase(count: number, self: boolean): string {
  if (count <= 0) return "";
  const who = self ? "you" : "they";
  return count === 1 ? ` The invitation ${who} sent is revoked.` : ` The ${count} invitations ${who} sent are revoked.`;
}

export function demoteQuestion(name: string, self: boolean, sent: number): { sentence: string; answer: string } {
  if (self) {
    return {
      sentence: `You’ll be a Member and keep only the projects you were added to. You won’t be able to manage members or make yourself an admin again.${invitationsPhrase(sent, true)}`,
      answer: "Make me a Member",
    };
  }
  return {
    sentence: `${name} will be a Member and keep only the projects they were added to.${invitationsPhrase(sent, false)}`,
    answer: "Make Member",
  };
}

export function suspendQuestion(name: string, company: string | null, sent: number): string {
  return `${name} loses access to ${companyInside(company)} at once but keeps their seat. If you reactivate them later, they come back as a Member, without their projects.${invitationsPhrase(sent, false)}`;
}

export function removeQuestion(name: string, company: string | null, suspended: boolean, sent: number): string {
  return suspended
    ? `${name} is removed from ${companyInside(company)}. Their seat is freed.`
    : `${name} is removed from ${companyInside(company)} and loses access at once. Their seat is freed.${invitationsPhrase(sent, false)}`;
}

export const revokeQuestion = (email: string) => `The invitation to ${email} stops working, and its seat is freed.`;

export function leaveQuestion(company: string | null, sent: number): string {
  return `You’ll lose access to ${companyInside(company)} and its projects at once. Only an admin can invite you back.${invitationsPhrase(sent, true)}`;
}

export const leaveZoneText = (company: string | null) => `Leaving removes you from ${companyInside(company)} and its projects at once.`;
export const ownerCannotLeaveText = (company: string | null) => `You own ${companyInside(company)}, so you can’t leave it.`;

/* ---------------------------------------------------------- the status */

export const roleChangedStatus = (name: string, role: string) =>
  role === "TENANT_ADMIN" ? `${name} is now an Admin.` : `${name} is now a Member.`;
export const suspendedStatus = (name: string) => `${name} is suspended. Their seat stays taken.`;
export const reactivatedStatus = (name: string) => `${name} is active again, as a Member.`;
export const removedStatus = (name: string, company: string | null) =>
  `${name} was removed from ${companyInside(company)}. Their seat is free.`;
export const revokedStatus = (email: string) => `The invitation to ${email} was revoked. Its seat is free.`;
export const resentStatus = (email: string, expiresAt: string | null, now: Date = new Date()) =>
  expiresAt !== null && !Number.isNaN(Date.parse(expiresAt))
    ? `Another invitation email to ${email} is queued. The earlier link stops working; it still expires ${formatWhen(expiresAt, now)}.`
    : `Another invitation email to ${email} is queued. The earlier link stops working.`;
export const expiredStatus = (email: string) => `The invitation to ${email} expired, so its seat is free.`;
export const invitedStatus = (email: string, expiresAt: string | null, now: Date = new Date()) =>
  expiresAt !== null && !Number.isNaN(Date.parse(expiresAt))
    ? `${email} is invited. The email is queued, and the invitation holds a seat until ${formatWhen(expiresAt, now)}.`
    : `${email} is invited. The email is queued, and the invitation holds a seat.`;
export const leftStatus = (company: string | null) => `You left ${companyInside(company)}.`;

/* -------------------------------------------------------- the refusals */

export type MemberAction = "role" | "suspend" | "reactivate" | "remove" | "revoke" | "resend";

/** A refusal as the page says it: the sentence, and the server's words for the detail line when §4.38 prints them. */
export interface RefusalWords {
  text: string;
  words: string | null;
}

const isUnanswered = (status: number | null) => status === null || status === 408 || status >= 500;

function otherwise(action: MemberAction, name: string, email: string): string {
  switch (action) {
    case "role":
      return `The role did not change for ${name}.`;
    case "suspend":
      return `${name} was not suspended.`;
    case "reactivate":
      return `${name} was not reactivated.`;
    case "remove":
      return `${name} was not removed.`;
    case "revoke":
      return `The invitation to ${email} was not revoked.`;
    case "resend":
      return `The invitation email to ${email} was not sent again.`;
  }
}

const notDone = (action: MemberAction) =>
  action === "role" ? "their role did not change" : action === "remove" ? "they were not removed" : "they were not suspended";

/**
 * §4.38's refusal table — by `Problem.code`, never by status alone and never
 * by the server's prose. The server's words go on the detail line only for a
 * code outside the table, `INVALID_STATE`, and an answer that never came.
 */
export function memberRefusalWords(
  action: MemberAction,
  error: unknown,
  subject: { name: string; self: boolean; email: string; company: string | null },
): RefusalWords {
  const code = refusalCode(error);
  const { status, message } = apiErrorFacts(error);
  const invitation = action === "revoke" || action === "resend";
  const { name, self, email, company } = subject;
  if (isUnanswered(status) && code !== "RATE_LIMITED") {
    return { text: "Taska couldn’t confirm the change. The list shows what Taska has now.", words: message };
  }
  switch (code) {
    case "LAST_ADMIN":
      if (action === "role") {
        return {
          text: self ? "You are the only active admin, so your role did not change." : `${name} is the only active admin, so their role did not change.`,
          words: null,
        };
      }
      if (action === "suspend" || action === "remove") return { text: `${name} is the only active admin, so ${notDone(action)}.`, words: null };
      break;
    case "OWNER_MEMBERSHIP_PROTECTED":
      if (action === "role" || action === "suspend" || action === "remove") {
        return { text: `${name} owns ${companyInside(company)}, so ${notDone(action)}.`, words: null };
      }
      break;
    case "VERSION_CONFLICT":
      return {
        text: invitation
          ? "This invitation changed elsewhere, so nothing changed. The list now shows the latest."
          : `${name} was changed elsewhere, so nothing changed. The list now shows the latest.`,
        words: null,
      };
    case "RESOURCE_NOT_FOUND":
      return { text: invitation ? "This invitation no longer exists." : `${name} is no longer in ${companyInside(company)}.`, words: null };
    case "INVITATION_EXPIRED":
      if (action === "resend") return { text: `The invitation to ${email} has expired, so nothing was sent. Invite them again.`, words: null };
      break;
    case "READ_ONLY":
    case "CAPABILITY_DISABLED":
      return { text: invitation ? "Invitations can’t be changed right now." : "Members can’t be changed right now.", words: null };
    case "SCOPE_DENIED":
      return { text: invitation ? "Only company admins can change invitations." : "Only company admins can change members.", words: null };
    // The action's own sentence only: the server's words for it may say
    // «tenant» (§4.33; art-director N-c). The request id still goes under it.
    case "INVALID_STATE":
      return { text: otherwise(action, name, email), words: null };
    case "RATE_LIMITED":
      if (invitation) {
        return { text: `An email to ${email} was queued moments ago. Try again in ${formatWait(refusalRetryAfter(error))}.`, words: null };
      }
      break;
    default:
      break;
  }
  return { text: otherwise(action, name, email), words: message };
}

/**
 * The invite modal's refusals (§4.38 «Приглашение»). An `INVALID_STATE` is
 * said from what the page has read — the address is a member's, or already has
 * a pending invitation — and otherwise as «not created»; never in the server's
 * words, which may say «tenant» (§4.33, art-director N-c).
 */
export function inviteRefusalWords(
  error: unknown,
  known: { email: string; company: string | null; member: boolean; pending: boolean } | null = null,
): RefusalWords {
  const code = refusalCode(error);
  const { status, message } = apiErrorFacts(error);
  if (code === "INVALID_STATE") {
    if (known?.member) return { text: `${known.email} is already a member of ${companyInside(known.company)}, so no invitation was created.`, words: null };
    if (known?.pending) {
      return { text: `${known.email} already has a pending invitation to ${companyInside(known.company)}, so no new one was created.`, words: null };
    }
    return { text: "This invitation was not created.", words: null };
  }
  if (code === "QUOTA_EXCEEDED") {
    return {
      text: "All seats are in use, so this invitation was not created. Remove a member or revoke an invitation to free a seat.",
      words: null,
    };
  }
  if (code === "VALIDATION_FAILED") return { text: "Taska didn’t accept this email or one of the chosen projects.", words: null };
  if (code === "RATE_LIMITED") {
    return { text: `Too many invitations were sent just now. Try again in ${formatWait(refusalRetryAfter(error))}.`, words: null };
  }
  if (code === "READ_ONLY" || code === "CAPABILITY_DISABLED") return { text: "Invitations can’t be sent right now.", words: null };
  if (isUnanswered(status)) {
    return { text: "Taska couldn’t confirm the invitation was created. Try again — it won’t create a second one.", words: message };
  }
  return { text: "This invitation was not created.", words: message };
}

/**
 * Leaving refused (§4.38 «Leave company»). An answer that never came is not a
 * refusal: the leave may have been applied, and pressing again — with the
 * same key — finds out (api-contract-guard B-1).
 */
export function leaveRefusalWords(error: unknown, company: string | null): RefusalWords {
  const code = refusalCode(error);
  const { status, message } = apiErrorFacts(error);
  if (code === "LAST_ADMIN") return { text: `You’re the only active admin, so you didn’t leave ${companyInside(company)}.`, words: null };
  if (code === "OWNER_MEMBERSHIP_PROTECTED") return { text: `You own ${companyInside(company)}, so you didn’t leave it.`, words: null };
  if (error !== null && isUnanswered(status) && code !== "RATE_LIMITED") {
    return { text: `Taska couldn’t confirm that you left ${companyInside(company)}. Press Leave company again to check.`, words: message };
  }
  // INVALID_STATE's words may say «tenant» (§4.33), as in the rows' table: the sentence and the id only.
  return { text: `You didn’t leave ${companyInside(company)}.`, words: code === "INVALID_STATE" ? null : message };
}

/** «{failureCode} · operation {id}» — an operation's own detail line; it has no request id. */
export const operationDetail = (failureCode: string | null, operationId: string) =>
  `${failureCode ?? "FAILED"} · operation ${operationId}`;

/** The member a sentence names, from the row (no profile read, B7). */
export const membershipEmail = (member: Membership) => member.email ?? "";
