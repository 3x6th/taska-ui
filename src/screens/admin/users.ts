import { apiErrorFacts, isConflict, isMissingOrForbidden } from "../../api/errors";
import { UNDEPLOYED_ROUTE_MESSAGE } from "../../api/TaskaApi";
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
};

const globalRoleLabels: Record<GlobalRole, string> = {
  USER: "User",
  GLOBAL_ADMIN: "Global admin",
};

/**
 * Whether the table's raw value is one of the three the domain knows. Not
 * exported: the one caller is the label below, and a second reader of "is this
 * status known" elsewhere would be a screen deciding for itself what to do with
 * a value it has never seen.
 */
function isKnownUserStatus(status: string | null): status is UserStatus {
  return status === "ACTIVE" || status === "BLOCKED" || status === "INVITED";
}

/**
 * The written status, or the raw value for anything this build has never heard
 * of. `status` here is a column of a database table, not a contract enum, so a
 * service that grows a fourth state has to render as itself rather than take
 * the row down with it (TAS-173).
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

/** Which of the two writes this row offers, or `null` for neither. */
export type UserAction = "block" | "unblock";

/**
 * The one action a row offers, decided by the server's own transition rules
 * (`AdminUserManagementServiceImpl`, backend TAS-107): block is legal from
 * `ACTIVE` and `INVITED`, unblock only from `BLOCKED`.
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
  return null;
}

/** What the status becomes if the server accepts this action. */
export function targetStatus(action: UserAction): UserStatus {
  return action === "block" ? "BLOCKED" : "ACTIVE";
}

/** The button and the confirmation both say this word. */
export const actionLabels: Record<UserAction, string> = {
  block: "Block",
  unblock: "Unblock",
};

/**
 * Whether this failure means "the gateway does not have this route yet"
 * (TAS-107) rather than "there is no such user".
 *
 * Both halves are required, and the pairing is narrow on purpose. An unmapped
 * path falls through to Spring's static-resource handler, which answers **404**
 * with a message beginning `No static resource …` — measured 2026-08-25 against
 * `POST /api/v1/admin/users/not-a-uuid/block`. A deployed route's own 404 says
 * `User not found`, so the message is the whole distinction; matching the
 * status alone would read a missing account as a missing deployment.
 *
 * Matched as a substring rather than by equality because the tail of the
 * message is the request path, which differs per user id. It stops matching the
 * day TAS-107 deploys, so the note removes itself.
 */
export function isUndeployedRoute(error: unknown): boolean {
  const { status, message } = apiErrorFacts(error);
  return status === 404 && message !== null && message.includes(UNDEPLOYED_ROUTE_MESSAGE);
}

/**
 * The five ways a write can fail, told apart by words rather than by one text
 * (DESIGN.md §5.8's taxonomy, with a sixth case this section adds).
 *
 * Classification lives here and the sentences live in the modal, because one of
 * them carries a link to a Jira story and a string cannot. `AdminError`'s own
 * sentences are deliberately not reused: they name a *table* and describe
 * *reading* one, which is not what happened here.
 *
 * Order matters in exactly one place — `undeployed` is a 404 and would
 * otherwise be swallowed by `refused`.
 */
export type UserWriteFailure = "undeployed" | "conflict" | "refused" | "server" | "rejected" | "unreachable";

export function userWriteFailure(error: unknown): UserWriteFailure {
  if (isUndeployedRoute(error)) return "undeployed";
  if (isConflict(error)) return "conflict";
  if (isMissingOrForbidden(error)) return "refused";
  const { status, code } = apiErrorFacts(error);
  if (status !== null && status >= 500) return "server";
  if ((status !== null && status >= 400 && status < 500) || code === "INVALID_ARGUMENT") return "rejected";
  return "unreachable";
}
