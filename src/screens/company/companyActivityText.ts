import { apiErrorFacts, isB2bErrorCode, refusalCode, refusalRetryAfter } from "../../api/errors";
import {
  ACTIVITY_KINDS,
  isKnownActivityKind,
  type ActivityActor,
  type ActivityPerson,
  type ActivityRecord,
  type ActivityTarget,
  type KnownActivityKind,
} from "../../api/tenantActivity";
import { formatWait } from "../authText";
import { companyInside, formatWhen } from "./companyMembersText";

/*
 * The words of Company › Activity (TAS-524, DESIGN.md §4.41) as pure values,
 * so every sentence of the table is pinned by a unit test. Every name comes
 * from the record itself — never from the members list (B5) — and the UI
 * says «company», «member», «Admin», «Owner»: never «tenant», «team»,
 * «workspace» or «audit» (§4.33).
 */

/* ---------------------------------------------------------------- the page */

export const leadText = (company: string | null) => `Who changed what in ${companyInside(company)}, newest first.`;
export const LOADING_TEXT = "Loading activity";
export const emptyText = (company: string | null) => `No activity in ${companyInside(company)} yet.`;
export const EMPTY_FILTERED_TEXT = "No activity matches these filters.";
export const END_TEXT = "No older activity.";
export const END_FILTERED_TEXT = "No older activity matches these filters.";
export const deniedText = (company: string | null) => `Only the admins and the owner of ${companyInside(company)} can see its activity.`;
export const REFRESH_FAILED_TEXT = "Activity could not be refreshed. The last loaded list is shown.";
export const FILTERS_REFUSED_TEXT = "Taska didn’t accept these filters.";
export const CONTINUE_REFUSED_TEXT = "Taska couldn’t continue the list from here.";
/** The author link's one description (`aria-describedby` and `title`, §4.41 «Фильтр по автору»). */
export const AUTHOR_LINK_HINT = "Shows only this person’s actions.";
export const TIME_UNKNOWN = "Time unknown";
export const PLATFORM_MARK = "Taska administrator";

/* --------------------------------------------------------- kinds and labels */

/** The filter's label of each kind, in the table's order (§4.41). */
export const KIND_LABELS: Readonly<Record<KnownActivityKind, string>> = {
  TENANT_CREATED: "Company created",
  TENANT_RENAMED: "Company renamed",
  TENANT_PAUSED: "Company paused",
  TENANT_RESUMED: "Company resumed",
  TENANT_BLOCKED: "Company blocked",
  TENANT_UNBLOCKED: "Block lifted",
  OWNERSHIP_TRANSFERRED: "Ownership transferred",
  INVITATION_CREATED: "Invitation sent",
  INVITATION_RESENT: "Invitation resent",
  INVITATION_REVOKED: "Invitation revoked",
  INVITATION_ACCEPTED: "Invitation accepted",
  ROLE_CHANGED: "Role changed",
  MEMBER_SUSPENDED: "Member suspended",
  MEMBER_REACTIVATED: "Member reactivated",
  MEMBER_REMOVED: "Member removed",
  MEMBER_LEFT: "Member left",
};

/** The kind select's three groups (§4.41 «Фильтр по виду»): the company's seven, the invitations' four, the members' five. */
export const KIND_GROUPS: readonly { label: string; kinds: readonly KnownActivityKind[] }[] = [
  { label: "Company", kinds: ACTIVITY_KINDS.slice(0, 7) },
  { label: "Invitations", kinds: ACTIVITY_KINDS.slice(7, 11) },
  { label: "Members", kinds: ACTIVITY_KINDS.slice(11) },
];

/**
 * «Action is {A} or {B}» — the address's kinds, the known ones by their
 * labels in the table's order, then an unknown code as it came; each once.
 */
export function kindChipLabel(kinds: readonly string[]): string {
  const unique = [...new Set(kinds)];
  const known = ACTIVITY_KINDS.filter((kind) => unique.includes(kind)).map((kind) => KIND_LABELS[kind]);
  const unknown = unique.filter((kind) => !isKnownActivityKind(kind));
  return `Action is ${[...known, ...unknown].join(" or ")}`;
}

/* ------------------------------------------------------------ the sentence */

/**
 * One part of a sentence: plain words (400), a person or a thing named by
 * the record (550), or the author — 550 too, and the link to the author
 * filter when it may be one.
 */
export type SentencePart = { type: "words"; text: string } | { type: "named"; text: string } | { type: "actor"; text: string };

export interface ActivitySentence {
  /** `outcome` present and not `SUCCEEDED`: «Not done: » before it (§4.41; art-director N1 — a missing one is done). */
  notDone: boolean;
  parts: SentencePart[];
}

const words = (text: string): SentencePart => ({ type: "words", text });
const named = (text: string): SentencePart => ({ type: "named", text });

/** {A} — the record's own name, else its address, else «A Taska administrator» for one, else «Someone». */
export function actorName(actor: ActivityActor | null): string {
  if (actor?.displayName) return actor.displayName;
  if (actor?.email) return actor.email;
  return actor?.platformAdmin === true ? "A Taska administrator" : "Someone";
}

/** {a} — {A} inside a sentence: a name or an address as it is, a fallback in lower case. */
function actorInside(actor: ActivityActor | null): string {
  if (actor?.displayName || actor?.email) return actorName(actor);
  return actor?.platformAdmin === true ? "a Taska administrator" : "someone";
}

/** Whether the meta line carries «Taska administrator»: only for an author with a name or an address (§4.41). */
export const showsPlatformMark = (actor: ActivityActor | null) =>
  actor?.platformAdmin === true && (actor.displayName !== null || actor.email !== null);

/** A person — a member target, or the previous owner: the name, the address, else «someone» in plain words. */
function personPart(person: Pick<ActivityPerson, "displayName" | "email"> | null): SentencePart {
  if (person?.displayName) return named(person.displayName);
  if (person?.email) return named(person.email);
  return words("someone");
}

/**
 * {T} by its type: a member's name → address → «someone»; an invitation's
 * address (`null` without one — the «an invitation» forms are the caller's);
 * the company as «the company»; a type outside the dictionary its name →
 * address → no target.
 */
function targetPart(target: ActivityTarget | null): SentencePart | null {
  if (target === null) return null;
  switch (target.type) {
    case "MEMBER":
      return personPart(target);
    case "INVITATION":
      return target.email ? named(target.email) : null;
    case "TENANT":
      return words("the company");
    default:
      if (target.displayName) return named(target.displayName);
      if (target.email) return named(target.email);
      return null;
  }
}

/** A role as a word: Admin, Member, Owner; outside the dictionary, as it came. */
export function activityRoleWord(role: string): string {
  if (role === "TENANT_ADMIN") return "Admin";
  if (role === "MEMBER") return "Member";
  if (role === "OWNER") return "Owner";
  return role;
}

/** «as an Admin» / «as a Member» / «as an Owner»; a role outside the dictionary without an article. */
function asRole(role: string): string {
  if (role === "TENANT_ADMIN") return " as an Admin.";
  if (role === "MEMBER") return " as a Member.";
  if (role === "OWNER") return " as an Owner.";
  return ` as ${role}.`;
}

/**
 * §4.41's sentence table, from the record alone. `{A}` is always the first
 * part — the author — so the screen can make it the filter's link.
 */
export function activitySentence(record: ActivityRecord): ActivitySentence {
  const notDone = record.outcome !== null && record.outcome !== "SUCCEEDED";
  const author: SentencePart = { type: "actor", text: actorName(record.actor) };
  const say = (...rest: SentencePart[]): ActivitySentence => ({ notDone, parts: [author, ...rest] });
  const target = targetPart(record.target);
  const member = target ?? words("someone");
  const details = record.details;

  switch (record.kind) {
    case "TENANT_CREATED":
      return say(words(" created the company."));
    case "TENANT_RENAMED": {
      const renamed = details?.kind === "TENANT_RENAMED" ? details : null;
      if (renamed?.toName && renamed.fromName) return say(words(` renamed the company from “${renamed.fromName}” to “${renamed.toName}”.`));
      if (renamed?.toName) return say(words(` renamed the company to “${renamed.toName}”.`));
      return say(words(" renamed the company."));
    }
    case "TENANT_PAUSED":
      return say(words(" paused the company."));
    case "TENANT_RESUMED":
      return say(words(" resumed the company."));
    case "TENANT_BLOCKED":
      return say(words(" blocked the company."));
    case "TENANT_UNBLOCKED":
      return say(words(" lifted the block on the company."));
    case "OWNERSHIP_TRANSFERRED": {
      if (target === null) return say(words(" transferred ownership of the company."));
      const previous = details?.kind === "OWNERSHIP_TRANSFERRED" ? details.previousOwner : null;
      const actorId = record.actor?.userId ?? null;
      const fromSomeoneElse = previous !== null && !(previous.userId !== null && actorId !== null && previous.userId === actorId);
      if (fromSomeoneElse) return say(words(" transferred ownership from "), personPart(previous), words(" to "), target, words("."));
      return say(words(" transferred ownership to "), target, words("."));
    }
    case "INVITATION_CREATED": {
      const role = details?.kind === "INVITATION_CREATED" ? details.role : null;
      const invited = record.target?.type === "INVITATION" ? (target ?? words("someone")) : member;
      return role === null ? say(words(" invited "), invited, words(".")) : say(words(" invited "), invited, words(asRole(role)));
    }
    case "INVITATION_RESENT":
      return target !== null && record.target?.type === "INVITATION"
        ? say(words(" resent the invitation to "), target, words("."))
        : say(words(" resent an invitation."));
    case "INVITATION_REVOKED":
      return target !== null && record.target?.type === "INVITATION"
        ? say(words(" revoked the invitation to "), target, words("."))
        : say(words(" revoked an invitation."));
    case "INVITATION_ACCEPTED":
      return say(words(" accepted an invitation and joined the company."));
    case "ROLE_CHANGED": {
      const change = details?.kind === "ROLE_CHANGED" ? details : null;
      const own = record.target?.id != null && record.target.id === record.actor?.userId;
      const subject = own ? [words(" changed their own role")] : [words(" changed the role of "), member];
      if (change?.toRole && change.fromRole) {
        return say(...subject, words(` from ${activityRoleWord(change.fromRole)} to ${activityRoleWord(change.toRole)}.`));
      }
      if (change?.toRole) return say(...subject, words(` to ${activityRoleWord(change.toRole)}.`));
      return say(...subject, words("."));
    }
    case "MEMBER_SUSPENDED":
      return say(words(" suspended "), member, words("."));
    case "MEMBER_REACTIVATED":
      return say(words(" reactivated "), member, words("."));
    case "MEMBER_REMOVED":
      return say(words(" removed "), member, words(" from the company."));
    case "MEMBER_LEFT":
      return say(words(" left the company."));
    default: {
      // Outside the dictionary, or no kind at all: «Other action by {a}[ on {T}].»
      const by: SentencePart = { type: "actor", text: actorInside(record.actor) };
      const on =
        record.target?.type === "INVITATION"
          ? target !== null
            ? [words(" on the invitation to "), target]
            : [words(" on an invitation")]
          : target !== null
            ? [words(" on "), target]
            : [];
      return { notDone, parts: [words("Other action by "), by, ...on, words(".")] };
    }
  }
}

/** The sentence as one string — what a test and the chip's name read. */
export const sentenceText = (sentence: ActivitySentence) =>
  `${sentence.notDone ? "Not done: " : ""}${sentence.parts.map((part) => part.text).join("")}`;

/** The code a kind outside the dictionary shows in the meta line; none for a known kind or a missing one. */
export const unknownKindCode = (record: ActivityRecord): string | null =>
  record.kind !== null && !isKnownActivityKind(record.kind) ? record.kind : null;

/* ---------------------------------------------------------------- the time */

/** «Nov 4, 09:12»; another year — «Nov 4, 2025, 09:12» (§4.38's «Expires»). */
export const activityWhen = (iso: string, now: Date = new Date()) => formatWhen(iso, now);

/** The full local date and time to the second, for the `<time>`'s `title` (art-director N3). */
export function activityWhenFull(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

/* ------------------------------------------------------------- the refusals */

/** The server's words go on the detail line only for a 5xx and a code outside the dictionary (§4.41 «Состояния»). */
export function showsServerWords(error: unknown): boolean {
  const { status, code } = apiErrorFacts(error);
  if (status !== null && status >= 500) return true;
  return code !== null && !isB2bErrorCode(code) && refusalCode(error) === null;
}

/** 403 `SCOPE_DENIED` — the reader is not an admin: never drawn as an empty log (§4.41). */
export const isActivityDenied = (error: unknown) => refusalCode(error) === "SCOPE_DENIED";

/** 400 `VALIDATION_FAILED` — the filters on the first page, the cursor on a continuation. */
export const isActivityRefused = (error: unknown) => refusalCode(error) === "VALIDATION_FAILED";

const isTooMany = (error: unknown) => refusalCode(error) === "RATE_LIMITED" || apiErrorFacts(error).status === 429;

/** A first page that did not load (§4.41): «Activity could not be loaded.», with the wait after a 429. */
export function firstPageFailedText(error: unknown): string {
  return isTooMany(error)
    ? `Activity could not be loaded. Try again in ${formatWait(refusalRetryAfter(error))}.`
    : "Activity could not be loaded.";
}

/** A continuation that did not load (§4.41): «More activity could not be loaded.», with the wait after a 429. */
export function continuationFailedText(error: unknown): string {
  return isTooMany(error)
    ? `More activity could not be loaded. Try again in ${formatWait(refusalRetryAfter(error))}.`
    : "More activity could not be loaded.";
}
