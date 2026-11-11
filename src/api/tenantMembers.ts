import { refusalCode } from "./errors";

/**
 * A company's members, its invitations and its seats (TAS-502) — the
 * blueprint's `Membership`, `Invitation` and `QuotaSnapshot`
 * (`docs/contract/b2b/b2b-openapi.yaml` at develop `758f8fc6`), none of which
 * the stand serves: every route answers the static-resource 404
 * (docs/ai/API-DIVERGENCE.md «TAS-502»). Reached only in the B2B build.
 *
 * Every enum is read as a known value or the server's own string (TAS-173):
 * an unknown role, state or kind is kept, and the screen gives that row no
 * controls (api-contract-guard B8). Versions and counts stay decimal strings;
 * arithmetic on a count goes through `decimal`, never `Number` (contracts §1).
 */

/** `Membership.role` and the role of an invitation. */
export const MEMBERSHIP_ROLES = ["MEMBER", "TENANT_ADMIN"] as const;
export type KnownMembershipRole = (typeof MEMBERSHIP_ROLES)[number];
export type MembershipRole = KnownMembershipRole | (string & {});

/** `Membership.state`. The list carries ACTIVE and SUSPENDED (develop `TenantMembershipService.java:131`). */
export const MEMBERSHIP_STATES = ["ACTIVE", "SUSPENDED", "REMOVED"] as const;
export type KnownMembershipState = (typeof MEMBERSHIP_STATES)[number];
export type MembershipState = KnownMembershipState | (string & {});

/** `Invitation.state`. */
export const INVITATION_STATES = ["PENDING", "ACCEPTED", "REVOKED", "EXPIRED"] as const;
export type KnownInvitationState = (typeof INVITATION_STATES)[number];
export type InvitationState = KnownInvitationState | (string & {});

/** `ProjectGrant.role` — a project's own roles. */
export const PROJECT_GRANT_ROLES = ["ADMIN", "MEMBER", "VIEWER"] as const;
export type KnownProjectGrantRole = (typeof PROJECT_GRANT_ROLES)[number];
export type ProjectGrantRole = KnownProjectGrantRole | (string & {});

export const isKnownMembershipRole = (value: unknown): value is KnownMembershipRole =>
  typeof value === "string" && (MEMBERSHIP_ROLES as readonly string[]).includes(value);
export const isKnownMembershipState = (value: unknown): value is KnownMembershipState =>
  typeof value === "string" && (MEMBERSHIP_STATES as readonly string[]).includes(value);
export const isKnownProjectGrantRole = (value: unknown): value is KnownProjectGrantRole =>
  typeof value === "string" && (PROJECT_GRANT_ROLES as readonly string[]).includes(value);

/**
 * One person in a company, as `GET /tenants/{t}/members` lists them. The
 * profile fields are on the row (no per-person read, B7) and **empty on
 * develop** until TAS-321 (ask A19): `null` here, and the screen draws its
 * unnamed-person fallback. `avatarPath` is a storage path with no route to
 * load it by, so nothing loads it — initials are drawn (art-director N2).
 */
export interface Membership {
  id: string | null;
  tenantId: string | null;
  userId: string;
  role: MembershipRole | null;
  state: MembershipState | null;
  /** Only a `true` reads as the owner — anything else is not one. */
  isOwner: boolean;
  displayName: string | null;
  email: string | null;
  avatarPath: string | null;
  /** The entity version, a decimal string, sent back verbatim in `If-Match`. */
  version: string | null;
}

/** `MembershipPage`, as sent: `nextCursor` absent at the end. */
export interface MembershipPage {
  items: Membership[];
  nextCursor: string | null;
}

/** `ProjectGrant`. */
export interface ProjectGrant {
  projectId: string;
  role: ProjectGrantRole;
}

/** One invitation, as `GET /tenants/{t}/invitations` lists it. `expiresAt` is a snapshot, shown as sent. */
export interface Invitation {
  id: string;
  tenantId: string | null;
  email: string | null;
  role: MembershipRole | null;
  state: InvitationState | null;
  expiresAt: string | null;
  createdBy: string | null;
  projectGrants: ProjectGrant[];
  version: string | null;
}

/** `InvitationPage`, as sent. */
export interface InvitationPage {
  items: Invitation[];
  nextCursor: string | null;
}

/** `QuotaUsage`: counts as decimal strings; `limit` absent exactly when `unlimited`. */
export interface QuotaUsage {
  kind: string;
  used: string;
  reserved: string;
  limit: string | null;
  unlimited: boolean;
}

/**
 * One project's lifetime issue counter — the blueprint's `QuotaUsage` of kind
 * `TASK_LIFETIME` from `GET /tenants/{t}/projects/{p}/task-quota`
 * (`getProjectTaskQuota`, TAS-460; TAS-528). `used` is every issue the project
 * ever created, deleted ones included, as the server counts them; never
 * incremented here. `kind` is checked and dropped; `reserved` (always "0")
 * and `version` (tenant-wide on develop, ask A116) are never kept.
 */
export interface ProjectTaskQuota {
  /** The requested project — an answer that names another is a failed read. */
  projectId: string;
  /** Decimal string ≥ 0. */
  used: string;
  /** Decimal string; `null` exactly when `unlimited`. */
  limit: string | null;
  unlimited: boolean;
}

/**
 * An answer to `getProjectTaskQuota` that is not one project's issue counter:
 * another project named in it, another kind, or no counts (TAS-528,
 * api-contract-guard §4). A failed read, and a definite one — it is an answer,
 * so it is neither retried nor taken for a lost one. Like
 * `ForeignCompanyAnswerError` it carries no message: nothing in it is the
 * server's words.
 */
export class TaskQuotaAnswerError extends Error {
  constructor(readonly reason: "another-project" | "unreadable") {
    super("");
    this.name = "TaskQuotaAnswerError";
  }
}

/** `QuotaSnapshot` — the company's seats (and, later, other quotas) at `asOf`. */
export interface QuotaSnapshot {
  tenantId: string | null;
  version: string | null;
  quotas: QuotaUsage[];
  asOf: string | null;
}

/** `GET …/members` and `GET …/invitations`' two parameters. */
export interface ListCompanyPageParams {
  cursor?: string;
  limit?: number;
}

/** `CreateInvitationRequest`, in the order it is sent (a retry sends the same bytes). */
export interface CreateInvitationInput {
  email: string;
  role: KnownMembershipRole;
  projectGrants: ReadonlyArray<{ projectId: string; role: KnownProjectGrantRole }>;
}

/** The largest page the two lists serve (`Limit.maximum`). */
export const COMPANY_PAGE_MAX = 100;

const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

/** The blueprint's decimal string (`^(0|[1-9][0-9]{0,18})$`) — versions and counts. */
const DECIMAL = /^(0|[1-9][0-9]{0,18})$/;

/** A decimal string as it came, or `null` for anything that is not one. */
const decimalText = (value: unknown): string | null => (typeof value === "string" && DECIMAL.test(value) ? value : null);

/**
 * The one way a count becomes a number to compare or add: `BigInt`, never
 * `Number` — a seat count is a decimal string of up to 19 digits (contracts
 * §1). `null` for anything that is not the blueprint's decimal.
 */
export function decimal(value: string | null | undefined): bigint | null {
  return typeof value === "string" && DECIMAL.test(value) ? BigInt(value) : null;
}

/** Whether a version may go into `If-Match`; otherwise the list is read again instead of sending (§4). */
export const isSendableVersion = (version: string | null | undefined): version is string =>
  typeof version === "string" && DECIMAL.test(version);

/** One wire `Membership`, or `null` for a row without a usable `userId` — nothing could address it. */
export function toMembership(wire: unknown): Membership | null {
  if (typeof wire !== "object" || wire === null) return null;
  const row = wire as Record<string, unknown>;
  const userId = text(row.userId);
  if (userId === null) return null;
  return {
    id: text(row.id),
    tenantId: text(row.tenantId),
    userId,
    role: text(row.role),
    state: text(row.state),
    isOwner: row.isOwner === true,
    displayName: typeof row.displayName === "string" && row.displayName.trim() !== "" ? row.displayName : null,
    email: text(row.email),
    avatarPath: text(row.avatarPath),
    version: decimalText(row.version),
  };
}

export function toMembershipPage(wire: unknown): MembershipPage {
  const page = typeof wire === "object" && wire !== null ? (wire as Record<string, unknown>) : {};
  const items = Array.isArray(page.items)
    ? page.items.map(toMembership).filter((member): member is Membership => member !== null)
    : [];
  return { items, nextCursor: text(page.nextCursor) };
}

function toProjectGrant(wire: unknown): ProjectGrant | null {
  if (typeof wire !== "object" || wire === null) return null;
  const row = wire as Record<string, unknown>;
  const projectId = text(row.projectId);
  const role = text(row.role);
  return projectId === null || role === null ? null : { projectId, role };
}

/** One wire `Invitation`, or `null` without a usable `id`. */
export function toInvitation(wire: unknown): Invitation | null {
  if (typeof wire !== "object" || wire === null) return null;
  const row = wire as Record<string, unknown>;
  const id = text(row.id);
  if (id === null) return null;
  return {
    id,
    tenantId: text(row.tenantId),
    email: text(row.email),
    role: text(row.role),
    state: text(row.state),
    expiresAt: text(row.expiresAt),
    createdBy: text(row.createdBy),
    projectGrants: Array.isArray(row.projectGrants)
      ? row.projectGrants.map(toProjectGrant).filter((grant): grant is ProjectGrant => grant !== null)
      : [],
    version: decimalText(row.version),
  };
}

export function toInvitationPage(wire: unknown): InvitationPage {
  const page = typeof wire === "object" && wire !== null ? (wire as Record<string, unknown>) : {};
  const items = Array.isArray(page.items)
    ? page.items.map(toInvitation).filter((invitation): invitation is Invitation => invitation !== null)
    : [];
  return { items, nextCursor: text(page.nextCursor) };
}

/** `QuotaUsage`, or `null` for a row without a kind or counts, or stating neither a limit nor `unlimited`. */
function toQuotaUsage(wire: unknown): QuotaUsage | null {
  if (typeof wire !== "object" || wire === null) return null;
  const row = wire as Record<string, unknown>;
  const kind = text(row.kind);
  const used = decimalText(row.used);
  const reserved = decimalText(row.reserved);
  if (kind === null || used === null || reserved === null) return null;
  if (row.unlimited === true) return { kind, used, reserved, limit: null, unlimited: true };
  const limit = decimalText(row.limit);
  return limit === null ? null : { kind, used, reserved, limit, unlimited: false };
}

/**
 * `getProjectTaskQuota`'s answer for `projectId` (TAS-528), read by
 * `toQuotaUsage`'s rules: a `TASK_LIFETIME` row with decimal counts and a
 * limit unless unlimited. An absent `projectId` is the requested project's —
 * the path named it; a present one that differs, another kind, or a row
 * `toQuotaUsage` cannot read is `TaskQuotaAnswerError`.
 */
export function toProjectTaskQuota(wire: unknown, projectId: string): ProjectTaskQuota {
  const row = toQuotaUsage(wire);
  if (row === null || row.kind !== "TASK_LIFETIME") throw new TaskQuotaAnswerError("unreadable");
  const named = text((wire as Record<string, unknown>).projectId);
  if (named !== null && named !== projectId) throw new TaskQuotaAnswerError("another-project");
  return { projectId, used: row.used, limit: row.limit, unlimited: row.unlimited };
}

export function toQuotaSnapshot(wire: unknown): QuotaSnapshot {
  const row = typeof wire === "object" && wire !== null ? (wire as Record<string, unknown>) : {};
  return {
    tenantId: text(row.tenantId),
    version: decimalText(row.version),
    quotas: Array.isArray(row.quotas)
      ? row.quotas.map(toQuotaUsage).filter((quota): quota is QuotaUsage => quota !== null)
      : [],
    asOf: text(row.asOf),
  };
}

/** The company's seats from its snapshot — the `SEAT` row, as BigInt; `null` when the snapshot has none. */
export interface Seats {
  used: bigint;
  reserved: bigint;
  /** `null` exactly when `unlimited`. */
  limit: bigint | null;
}

export function seatsOf(snapshot: QuotaSnapshot | null | undefined): Seats | null {
  const row = snapshot?.quotas.find((quota) => quota.kind === "SEAT");
  if (!row) return null;
  const used = decimal(row.used);
  const reserved = decimal(row.reserved);
  if (used === null || reserved === null) return null;
  if (row.unlimited) return { used, reserved, limit: null };
  const limit = decimal(row.limit);
  return limit === null ? null : { used, reserved, limit };
}

/**
 * Seats still free — `max(limit − used − reserved, 0)`, in BigInt (an
 * administrator of the platform may push `used` past the limit). For a
 * sentence only: **never used to disable inviting** — the server's 422 decides
 * (api-contract-guard §5). `null` for an unlimited company.
 */
export function freeSeats(seats: Seats): bigint | null {
  if (seats.limit === null) return null;
  const free = seats.limit - seats.used - seats.reserved;
  return free > 0n ? free : 0n;
}

/* ------------------------------------------------------------- the email */

/** `CreateInvitationRequest.email`'s `maxLength`. */
export const INVITATION_EMAIL_MAX = 254;

/** The address as it is sent: trimmed. Compared lowercased (`sameInvitationEmail`). */
export const trimInvitationEmail = (value: string) => value.trim();

export const sameInvitationEmail = (a: string | null, b: string | null) =>
  a !== null && b !== null && a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The one address rule, shared by the invite form and the mock server
 * (api-contract-guard §7 parity): sent trimmed, with an `@` that has something
 * on both sides, at most 254 characters. `null` — acceptable.
 */
export function invitationEmailProblem(value: string): "empty" | "too-long" | "invalid" | null {
  const email = trimInvitationEmail(value);
  if (email === "") return "empty";
  if (email.length > INVITATION_EMAIL_MAX) return "too-long";
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1 || /\s/.test(email)) return "invalid";
  return null;
}

/* -------------------------------------------------------------- the lists */

/**
 * A company list that did not end: a cursor the server repeated, or more pages
 * than any company has (api-contract-guard N2). The read fails rather than
 * passing a part of the directory off as everyone. Its message is empty on
 * purpose — the sentence is the screen's, and no client words are shown as
 * the server's.
 */
export class UnendedListError extends Error {
  constructor() {
    super("");
    this.name = "UnendedListError";
  }
}

/** How many pages `readAllPages` follows before it fails — 5 000 rows at 100 a page. */
export const COMPANY_PAGE_CAP = 50;

/**
 * Every row of a company list, read the way DESIGN.md §4.38 asks: pages of
 * `COMPANY_PAGE_MAX`, following `nextCursor` until it is absent, before the
 * first draw. Develop binds the members cursor to the membership generation
 * (`TenantMembershipService.java:159-161`), so a change meanwhile makes a
 * later page a 400 `VALIDATION_FAILED`: the read starts again from the first
 * page **once**, and a second such refusal is the read's error. A repeated
 * cursor, or more than `COMPANY_PAGE_CAP` pages, is the read's error too
 * (`UnendedListError`) — never a list cut short.
 */
export async function readAllPages<T>(
  list: (params: ListCompanyPageParams) => Promise<{ items: T[]; nextCursor: string | null }>,
): Promise<T[]> {
  let restarted = false;
  for (;;) {
    const rows: T[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    try {
      for (let page = 0; page < COMPANY_PAGE_CAP; page += 1) {
        const answer = await list(cursor === undefined ? { limit: COMPANY_PAGE_MAX } : { cursor, limit: COMPANY_PAGE_MAX });
        rows.push(...answer.items);
        if (answer.nextCursor === null) return rows;
        if (seen.has(answer.nextCursor)) throw new UnendedListError();
        seen.add(answer.nextCursor);
        cursor = answer.nextCursor;
      }
      throw new UnendedListError();
    } catch (error) {
      if (cursor !== undefined && !restarted && refusalCode(error) === "VALIDATION_FAILED") {
        restarted = true;
        continue;
      }
      throw error;
    }
  }
}
