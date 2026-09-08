import { apiErrorFacts, isConflict, isMissingOrForbidden } from "../../api/errors";
import type { AdminRow, GlobalRole, UserStatus } from "../../domain/types";

/**
 * Where the Users section reads its people from (DESIGN.md §5.8). The section
 * has no endpoint of its own for the list: it reads `auth.users` through the
 * same generic `GET /readonly/{service}/{table}` the Data section uses, and
 * names the columns it draws instead of rendering whatever came back.
 */
export const USERS_SERVICE = "auth";
export const USERS_TABLE = "users";

/**
 * The columns the section names, spelled as `auth.users` spells them — measured
 * on the deployed gateway 2026-08-25, where `meta.columns` is
 * `[id, login, global_role, email, display_name, status, created_at,
 * updated_at]`.
 *
 * A column that is not in the response simply has no value, which is why every
 * field of `AdminUserRow` below is nullable: the mock's `auth.users` carries no
 * `updated_at` and the gateway's carries no `password_hash`, and neither of
 * those is an error — the section draws what it was given.
 */
const COLUMN = {
  id: "id",
  login: "login",
  email: "email",
  displayName: "display_name",
  status: "status",
  globalRole: "global_role",
} as const;

/**
 * One account as this section reads it. Deliberately **not** the domain's
 * `User`: these values come out of a raw table row where every cell is
 * `unknown`, so `status` and `globalRole` are open strings here even though the
 * domain's enums are closed. A value this build has never seen is printed
 * verbatim and offers no action — it is not coerced into one of the values we
 * do know (the same rule `outboxCategory` follows for an unknown outbox
 * status).
 */
export interface AdminUserRow {
  /** `null` when the row has no usable key, which is the one case with no action. */
  id: string | null;
  login: string | null;
  email: string | null;
  displayName: string | null;
  status: string | null;
  globalRole: string | null;
}

/**
 * A cell as text, or `null` for "nothing to show".
 *
 * `null`, `undefined` and the empty string all mean the same thing to a reader
 * here — there is no name, no login, no role — so they collapse. Numbers and
 * booleans are stringified because a column's type is runtime news and a
 * service is free to hold a status as something other than text; anything with
 * no printable form at all (an object, an array) is treated as absent rather
 * than rendered as `[object Object]`.
 */
function cellText(value: unknown): string | null {
  if (typeof value === "string") return value === "" ? null : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

/** One row of `auth.users`, read by column name rather than by position. */
export function readUserRow(row: AdminRow): AdminUserRow {
  return {
    id: cellText(row[COLUMN.id]),
    login: cellText(row[COLUMN.login]),
    email: cellText(row[COLUMN.email]),
    displayName: cellText(row[COLUMN.displayName]),
    status: cellText(row[COLUMN.status]),
    globalRole: cellText(row[COLUMN.globalRole]),
  };
}

/**
 * What to call this person. The display name if there is one, the login
 * otherwise, and the key as a last resort — a confirmation that named nobody
 * would be asking the reader to trust a row they cannot identify.
 */
export function personLabel(user: AdminUserRow): string {
  return user.displayName ?? user.login ?? user.id ?? "this account";
}

const userStatusLabels: Record<UserStatus, string> = {
  ACTIVE: "Active",
  BLOCKED: "Blocked",
  INVITED: "Invited",
  // Not an administrative state (TAS-188): auth-service puts an account here
  // after `maxFailedAttempts` failed sign-ins and takes it out again on the next
  // successful one, so this word names something no administrator decided. Live
  // since backend PR #146 merged on 2026-09-07 — before that the value was not
  // on `develop` at all and no row could carry it (src/domain/types.ts).
  LOCKED: "Locked",
};

const globalRoleLabels: Record<GlobalRole, string> = {
  USER: "User",
  GLOBAL_ADMIN: "Global admin",
};

/**
 * Whether the table's raw value is one of the four the domain knows. Not
 * exported: the one caller is the label below, and a second reader of "is this
 * status known" elsewhere would be a screen deciding for itself what to do with
 * a value it has never seen.
 */
function isKnownUserStatus(status: string | null): status is UserStatus {
  return status === "ACTIVE" || status === "BLOCKED" || status === "INVITED" || status === "LOCKED";
}

/**
 * The written status, or the raw value for anything this build has never heard
 * of. `status` here is a column of a database table, not a contract enum, so a
 * service that grows a state has to render as itself rather than take the row
 * down with it (TAS-173).
 *
 * The union growing a fourth value with TAS-188 does not retire that rule and
 * must not be read as narrowing it. `LOCKED` is not the evidence for the rule —
 * it is now a value `auth.users` can hold, so it is simply one more named case.
 * The evidence is the shape of the source: this is a database cell, and a
 * fifth value can appear in it on the day a service grows one, with no contract
 * change and no build of this frontend in between. Naming four values is as far
 * as the union goes; the fallback below is what covers the rest, and it covers
 * exactly as much as it did before the fourth was added.
 */
export function userStatusLabel(status: string | null): string {
  return isKnownUserStatus(status) ? userStatusLabels[status] : (status ?? "—");
}

/** The written role, same rule and same reason as the status above. */
export function globalRoleLabel(role: string | null): string {
  if (role === "USER" || role === "GLOBAL_ADMIN") return globalRoleLabels[role];
  return role ?? "—";
}

/**
 * A row that can actually be acted on: one the table gave a key for. The
 * gateway addresses the account by `{userId}` in the path, so a row with no key
 * has nothing to send — narrowing it once, here, is what keeps the modal from
 * carrying a `null` id it would have to invent a value for.
 */
export type AdminUserTarget = AdminUserRow & { id: string };

export function hasKey(user: AdminUserRow): user is AdminUserTarget {
  return user.id !== null;
}

/** Which of the three writes this row offers, or `null` for none of them. */
export type UserAction = "block" | "unblock" | "reset";

/**
 * The one action a row offers, decided by the server's own transition rules
 * (`AdminUserManagementServiceImpl`, backend TAS-107 and TAS-108): block is
 * legal from `ACTIVE` and `INVITED`, unblock only from `BLOCKED`, and
 * reset-lockout only from `LOCKED`.
 *
 * `LOCKED` used to fall through to `null` here, which was right while the row
 * had nothing to offer and became wrong the moment reset-lockout existed. It is
 * emphatically not a case for `block`: the server refuses that from `LOCKED`
 * with `ABORTED`, so the row would have carried a button certain to fail.
 *
 * `null` for a status this build does not recognise, and for a row with no key
 * — a button that is certain to be refused, or that has nothing to address, is
 * worse than no button. The gateway stays the authority either way: hiding a
 * control has never been a permission (DESIGN.md §5.7).
 */
export function actionFor(user: AdminUserRow): UserAction | null {
  if (user.id === null) return null;
  if (user.status === "ACTIVE" || user.status === "INVITED") return "block";
  if (user.status === "BLOCKED") return "unblock";
  if (user.status === "LOCKED") return "reset";
  return null;
}

/**
 * What the status becomes if the server accepts this action. Both of the
 * undoing actions land on `ACTIVE` — reset-lockout because auth-service sets
 * the account active while clearing the credential's counters, which is why the
 * confirmation can name the transition before asking for it.
 */
export function targetStatus(action: UserAction): UserStatus {
  return action === "block" ? "BLOCKED" : "ACTIVE";
}

/** The button and the confirmation both say this word. */
export const actionLabels: Record<UserAction, string> = {
  block: "Block",
  unblock: "Unblock",
  // "Reset lockout", not "Unlock": a one-letter difference from "Unblock" in a
  // column where both appear is not a difference a reader can rely on, and this
  // names what the server actually does (`resetCredentialLockout`).
  reset: "Reset lockout",
};

/**
 * How the row's button and the dialog it opens *name* the action, which is not
 * the label with the person's name after it. "Block Nina Kowal" is a sentence;
 * "Reset lockout Omar Haddad" is a fragment, because that label is already a
 * verb plus its object and the person needs a preposition to hang on. One
 * template per action rather than one concatenation for all three, and each
 * visible label stays contained in the name it produces — which is what WCAG
 * 2.5.3 requires of a control whose visible words are part of its name.
 */
const actionNames: Record<UserAction, (person: string) => string> = {
  block: (person) => `Block ${person}`,
  unblock: (person) => `Unblock ${person}`,
  reset: (person) => `Reset lockout for ${person}`,
};

export function actionAccessibleName(action: UserAction, person: string): string {
  return actionNames[action](person);
}

/** The same button while the server is answering. Not derivable: "Reseting" is not a word. */
export const actionPendingLabels: Record<UserAction, string> = {
  block: "Blocking…",
  unblock: "Unblocking…",
  reset: "Resetting…",
};

/** Mid-sentence, for the failure that is the gateway's own fault: "failed while …ing this account". */
export const actionGerunds: Record<UserAction, string> = {
  block: "blocking",
  unblock: "unblocking",
  reset: "resetting the lockout on",
};

/**
 * The five ways a write can fail, told apart by words rather than by one text
 * (DESIGN.md §5.8's taxonomy).
 *
 * Classification lives here and the sentences live in the modal, because the
 * sentences differ per action — the same `conflict` reads one way for a
 * transition and another for a lockout — and a string cannot branch.
 * `AdminError`'s own sentences are deliberately not reused: they name a *table*
 * and describe *reading* one, which is not what happened here.
 *
 * There used to be a sixth case, `undeployed`, for the 404 with Spring's
 * static-resource message the gateway answered while these three routes were
 * unmapped. Backend PR #146 deployed all three, measured 2026-09-08 — both
 * `block` and `reset-lockout` now answer `400 INVALID_ARGUMENT` to an invalid
 * uuid where they answered that 404 before — so the case is gone (TAS-196). The
 * shared predicate it used is still in src/api/errors.ts and still has a live
 * caller: the attachment routes, which really are unmapped.
 *
 * Order matters, and two constraints hold it rather than one. `isConflict`
 * must come before the `>= 400 && < 500` arm because `FAILED_PRECONDITION` —
 * the last-active-admin guard and the not-locked refusal — arrives on **400**,
 * which that arm would otherwise call a rejected request. `isMissingOrForbidden`
 * must come before it too, or every 404 and every 403 would classify as
 * `rejected` instead of `refused` — the gateway blamed for not accepting a
 * request it read and refused.
 */
export type UserWriteFailure = "conflict" | "refused" | "server" | "rejected" | "unreachable";

export function userWriteFailure(error: unknown): UserWriteFailure {
  if (isConflict(error)) return "conflict";
  if (isMissingOrForbidden(error)) return "refused";
  const { status, code } = apiErrorFacts(error);
  if (status !== null && status >= 500) return "server";
  if ((status !== null && status >= 400 && status < 500) || code === "INVALID_ARGUMENT") return "rejected";
  return "unreachable";
}
