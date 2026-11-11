import { apiErrorFacts, isWorkspaceClosed } from "../../api/errors";
import {
  isKnownMembershipRole,
  isKnownMembershipState,
  type Invitation,
  type Membership,
} from "../../api/tenantMembers";
import { DELETED_USER, DELETED_USER_IN_SENTENCE } from "../../lib/deletedUser";
import { shortKey } from "../admin/columns";

/*
 * Settings › Members (TAS-502, DESIGN.md §4.38) as pure functions: who the
 * reader is in the list, what each row offers, the groups and their order, and
 * when a write may send its previous key again. Pinned by unit tests rather
 * than by whichever component happens to draw them.
 */

/** The three groups of the page, in order (§4.38 «Список»). */
export interface MemberGroups {
  pending: Invitation[];
  members: Membership[];
  expired: Invitation[];
}

/**
 * What the reader may change, **from their own row** found by `me.id` (the
 * orchestrator's reconciliation, B8): no capability names, no count of admins.
 * `known` is false when the row is missing or its role or state is outside the
 * dictionary — then nothing is offered, and one line says so.
 */
export interface ReaderAccess {
  known: boolean;
  admin: boolean;
  owner: boolean;
  row: Membership | null;
}

export function readerAccess(members: readonly Membership[] | undefined, meId: string | null): ReaderAccess {
  const row = meId === null ? null : (members?.find((member) => member.userId === meId) ?? null);
  if (row === null) return { known: false, admin: false, owner: false, row: null };
  const known = isKnownMembershipRole(row.role) && isKnownMembershipState(row.state);
  return { known, admin: known && row.role === "TENANT_ADMIN" && row.state === "ACTIVE", owner: row.isOwner, row };
}

/** Who a row, a control and a sentence are about — worded once, so the three cannot disagree. */
export interface MemberSubject {
  /** The row's first line: the name, else «You» on one's own row, else «Unknown». */
  title: string;
  /** Opens a sentence: the name, else the address, else the short id. */
  name: string;
  self: boolean;
  /** Whether the server named the person at all. */
  named: boolean;
  /** A deleted account (TAS-529): «Deleted user» on both lines, and never the address. */
  deleted: boolean;
}

export function memberSubject(member: Membership, meId: string | null): MemberSubject {
  const self = meId !== null && member.userId === meId;
  // From the mark alone (TAS-529, api-contract-guard N1): the mapper has
  // already dropped the name and the address, and this never reaches for
  // either — no sentence falls back to an email the account used to carry.
  if (member.deleted) return { title: DELETED_USER, name: DELETED_USER, self: false, named: false, deleted: true };
  if (member.displayName !== null) return { title: member.displayName, name: member.displayName, self, named: true, deleted: false };
  // §4.22's unnamed person: the row cannot be named by its account (develop
  // sends no profile until TAS-321, ask A19).
  const name = member.email ?? `The member with ID ${shortKey(member.userId)}`;
  return { title: self ? "You" : "Unknown", name, self, named: false, deleted: false };
}

/** What a sorted row is called — the name, then the address, then the id. */
const sortName = (member: Membership) => member.displayName ?? member.email ?? member.userId;

const timeOf = (iso: string | null) => {
  const at = iso === null ? Number.NaN : Date.parse(iso);
  return Number.isNaN(at) ? 0 : at;
};
/** Newest first. */
const byTime = (a: string | null, b: string | null) => timeOf(b) - timeOf(a);

/**
 * §4.38's groups: pending invitations, newest first (`expiresAt` descending,
 * then the address); ACTIVE and SUSPENDED members — and a state this build
 * does not know, printed as it came — by name (`sensitivity: 'base'`, then
 * `userId`), the reader's own row not lifted; expired invitations, freshest
 * first. REMOVED, ACCEPTED, REVOKED and an invitation state this build does
 * not know are not drawn (N2). A deleted account's row (TAS-529,
 * art-director §5) comes after every other member, by `userId`: it has no
 * name to be sorted by, and its address is not one to use.
 */
export function groupRows(members: readonly Membership[], invitations: readonly Invitation[] | undefined): MemberGroups {
  const byUserId = (a: Membership, b: Membership) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0);
  const listed = members
    .filter((member) => member.state !== "REMOVED")
    .sort(
      (a, b) =>
        Number(a.deleted) - Number(b.deleted) ||
        (a.deleted ? 0 : sortName(a).localeCompare(sortName(b), undefined, { sensitivity: "base" })) ||
        byUserId(a, b),
    );
  const pending = (invitations ?? [])
    .filter((invitation) => invitation.state === "PENDING")
    .sort((a, b) => byTime(a.expiresAt, b.expiresAt) || (a.email ?? "").localeCompare(b.email ?? ""));
  const expired = (invitations ?? [])
    .filter((invitation) => invitation.state === "EXPIRED")
    .sort((a, b) => byTime(a.expiresAt, b.expiresAt) || (a.email ?? "").localeCompare(b.email ?? ""));
  return { pending, members: listed, expired };
}

/**
 * Who sent an invitation, as its second line says it (§4.38): «you» for the
 * reader's own, the inviter's name off the members list, else the address —
 * and «a deleted user» for a deleted account (TAS-529), whose address is never
 * used. `null` when the list does not hold them: the line then says nobody.
 */
export function inviterName(members: readonly Membership[] | undefined, meId: string | null, userId: string | null): string | null {
  if (userId === null) return null;
  if (userId === meId) return "you";
  const row = members?.find((member) => member.userId === userId);
  if (!row) return null;
  return row.deleted ? DELETED_USER_IN_SENTENCE : (row.displayName ?? row.email);
}

/** The person's pending invitations, counted from `createdBy` of the list read — the strips' phrase (§4.38 «Вопросы»). */
export function invitationsSentBy(invitations: readonly Invitation[] | undefined, userId: string): number {
  return (invitations ?? []).filter((invitation) => invitation.state === "PENDING" && invitation.createdBy === userId).length;
}

/** The earliest `expiresAt` of a pending invitation, in ms — when the page re-reads (§4.38 «Истечение»). */
export function earliestPendingExpiry(invitations: readonly Invitation[] | undefined): number | null {
  let earliest: number | null = null;
  for (const invitation of invitations ?? []) {
    if (invitation.state !== "PENDING" || invitation.expiresAt === null) continue;
    const at = Date.parse(invitation.expiresAt);
    if (!Number.isNaN(at) && (earliest === null || at < earliest)) earliest = at;
  }
  return earliest;
}

/** What a row of the Members group offers an admin reader (§4.38 «Кому какие контролы»). */
export interface MemberControls {
  role: boolean;
  /** «Suspend» on an ACTIVE row, «Reactivate» on a SUSPENDED one. */
  action: "suspend" | "reactivate" | null;
  remove: boolean;
}

const NONE: MemberControls = { role: false, action: null, remove: false };

/**
 * The owner's row offers nothing (the server protects it); one's own row the
 * role only (the way out is Leave); an ACTIVE row all three; a SUSPENDED row
 * Reactivate and Remove; a role or state outside the dictionary nothing.
 * Never «the only active admin» — the client does not count admins (B3): the
 * server's `LAST_ADMIN` answers.
 */
export function memberControls(member: Membership, access: ReaderAccess, meId: string | null): MemberControls {
  if (!access.admin || !access.known) return NONE;
  // A deleted account's row offers nothing (TAS-529, art-director B6).
  if (member.deleted) return NONE;
  if (member.isOwner || !isKnownMembershipRole(member.role) || !isKnownMembershipState(member.state)) return NONE;
  if (meId !== null && member.userId === meId) return { role: true, action: null, remove: false };
  if (member.state === "ACTIVE") return { role: true, action: "suspend", remove: true };
  if (member.state === "SUSPENDED") return { role: false, action: "reactivate", remove: true };
  return NONE;
}

/**
 * An answer that never came, or one that says nothing about the request: no
 * status, 408, 429 and 5xx. Its retry is the same intent and goes with the
 * same key and the same body (api-contract-guard §4); after anything else the
 * next press is a new intent with a new key.
 */
export function isIndefinite(error: unknown): boolean {
  if (isWorkspaceClosed(error)) return false;
  const { status } = apiErrorFacts(error);
  return status === null || status === 408 || status === 429 || status >= 500;
}

/** An intent sent, and whether its answer left it open — what `keyFor` reads. */
export interface SentIntent {
  signature: string;
  key: string;
  open: boolean;
}

const newKey = () =>
  globalThis.crypto?.randomUUID?.() ??
  "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));

/** The key for an intent: the previous one when the same intent is retried after an indefinite answer, else a fresh one. */
export function keyFor(previous: SentIntent | null, signature: string): string {
  return previous !== null && previous.open && previous.signature === signature ? previous.key : newKey();
}
