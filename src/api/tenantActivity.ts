import { ForeignCompanyAnswerError, instant } from "./tenants";

/**
 * A company's activity (TAS-524) — `GET /tenants/{tenantId}/activity`, a
 * route the frontend proposed on the backend story TAS-523 and nothing serves
 * yet: it is **not in the blueprint** (`docs/contract/b2b/` at develop
 * `758f8fc6`) and answers the static-resource 404 on the stand
 * (docs/ai/API-DIVERGENCE.md «TAS-524»). Reached only in the B2B build.
 *
 * Read defensively, because the shape is a proposal the backend may reshape
 * (api-contract-guard B2): every enum is an open union — a value this build
 * knows, or the server's own string as it came (TAS-173); every field of a
 * record may be missing, and **no record is ever dropped** — the screen draws
 * what it can («Other action», «Someone», «Time unknown») rather than hiding an
 * entry of the log. Nothing here is derived from anything but the answer.
 */

/**
 * `ActivityKind` — one per matrix action (api-contract-guard C5), in the order
 * DESIGN.md §4.41's table and the kind filter list them: the company, then its
 * invitations, then its members.
 */
export const ACTIVITY_KINDS = [
  "TENANT_CREATED",
  "TENANT_RENAMED",
  "TENANT_PAUSED",
  "TENANT_RESUMED",
  "TENANT_BLOCKED",
  "TENANT_UNBLOCKED",
  "OWNERSHIP_TRANSFERRED",
  "INVITATION_CREATED",
  "INVITATION_RESENT",
  "INVITATION_REVOKED",
  "INVITATION_ACCEPTED",
  "ROLE_CHANGED",
  "MEMBER_SUSPENDED",
  "MEMBER_REACTIVATED",
  "MEMBER_REMOVED",
  "MEMBER_LEFT",
] as const;
export type KnownActivityKind = (typeof ACTIVITY_KINDS)[number];
/** A kind this build knows, or the server's own code as it came — drawn as «Other action», never dropped. */
export type ActivityKind = KnownActivityKind | (string & {});

export const isKnownActivityKind = (value: unknown): value is KnownActivityKind =>
  typeof value === "string" && (ACTIVITY_KINDS as readonly string[]).includes(value);

/** `ActivityTarget.type`. */
export const ACTIVITY_TARGET_TYPES = ["MEMBER", "INVITATION", "TENANT"] as const;
export type KnownActivityTargetType = (typeof ACTIVITY_TARGET_TYPES)[number];
export type ActivityTargetType = KnownActivityTargetType | (string & {});

/** `ActivityRecord.outcome` — the proposal's v1 writes only actions that took effect (api-contract-guard C6). */
export const ACTIVITY_OUTCOMES = ["SUCCEEDED"] as const;
export type ActivityOutcome = (typeof ACTIVITY_OUTCOMES)[number] | (string & {});

/** A person a record names — the author, or an ownership transfer's previous owner. */
export interface ActivityPerson {
  userId: string | null;
  /** The text rule of `tenantMembers.ts`: a blank name is no name. */
  displayName: string | null;
  email: string | null;
}

export interface ActivityActor extends ActivityPerson {
  /** Only a `true` reads as an administrator of Taska (TAS-510) — anything else is not one. */
  platformAdmin: boolean;
}

export interface ActivityTarget {
  type: ActivityTargetType | null;
  id: string | null;
  displayName: string | null;
  email: string | null;
}

/**
 * `ActivityRecord.details`, kept only for the four kinds that carry them and
 * only their named fields (api-contract-guard B2, C8) — never printed raw, and
 * never a free-text reason.
 */
export type ActivityDetails =
  | { kind: "ROLE_CHANGED"; fromRole: string | null; toRole: string | null }
  | { kind: "TENANT_RENAMED"; fromName: string | null; toName: string | null }
  | { kind: "INVITATION_CREATED"; role: string | null }
  | { kind: "OWNERSHIP_TRANSFERRED"; previousOwner: ActivityPerson | null };

/** One entry of the company's log, as the section draws it. */
export interface ActivityRecord {
  /** `null` when the answer carried none — the screen keys such a row by its place (B2). */
  id: string | null;
  tenantId: string | null;
  /** An instant `Date` can read, or `null` — drawn «Time unknown», never «now», and never moved (B2). */
  createdAt: string | null;
  actor: ActivityActor | null;
  kind: ActivityKind | null;
  target: ActivityTarget | null;
  details: ActivityDetails | null;
  outcome: ActivityOutcome | null;
  requestId: string | null;
}

/** `ActivityPage`, in the server's order — never sorted, merged or de-duplicated here. */
export interface CompanyActivityPage {
  items: ActivityRecord[];
  /** A non-empty string, or `null` at the end of the log. */
  nextCursor: string | null;
}

/** The route's parameters (proposal v2 on TAS-523). The section always sends `limit` 50 (B1). */
export interface ListTenantActivityParams {
  cursor?: string;
  limit?: number;
  /** One UUID; the section never sends one that is not. */
  actorUserId?: string;
  /** Sent as the address has them — the server validates — repeated, sorted and de-duplicated (B1). */
  kinds?: readonly string[];
}

/** The page size the section reads (B1). */
export const ACTIVITY_PAGE_SIZE = 50;

const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
/** `tenantMembers.ts`' name rule: a name that is only whitespace is no name. */
const name = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value : null);
const objectOf = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

function toPerson(row: Record<string, unknown>): ActivityPerson {
  return { userId: text(row.userId), displayName: name(row.displayName), email: text(row.email) };
}

function toActor(wire: unknown): ActivityActor | null {
  const row = objectOf(wire);
  return row === null ? null : { ...toPerson(row), platformAdmin: row.platformAdmin === true };
}

function toTarget(wire: unknown): ActivityTarget | null {
  const row = objectOf(wire);
  if (row === null) return null;
  return { type: text(row.type), id: text(row.id), displayName: name(row.displayName), email: text(row.email) };
}

function toDetails(kind: string | null, wire: unknown): ActivityDetails | null {
  const row = objectOf(wire);
  if (row === null) return null;
  switch (kind) {
    case "ROLE_CHANGED":
      return { kind, fromRole: text(row.fromRole), toRole: text(row.toRole) };
    case "TENANT_RENAMED":
      return { kind, fromName: name(row.fromName), toName: name(row.toName) };
    case "INVITATION_CREATED":
      return { kind, role: text(row.role) };
    case "OWNERSHIP_TRANSFERRED": {
      const previous = objectOf(row.previousOwner);
      return { kind, previousOwner: previous === null ? null : toPerson(previous) };
    }
    default:
      return null;
  }
}

/**
 * One wire record — always a record, whatever came: an entry that is not an
 * object is drawn as an action nobody can name (B2: no record is dropped).
 */
export function toActivityRecord(wire: unknown): ActivityRecord {
  const row = objectOf(wire) ?? {};
  const kind = text(row.kind);
  return {
    id: text(row.id),
    tenantId: text(row.tenantId),
    createdAt: instant(row.createdAt),
    actor: toActor(row.actor),
    kind,
    target: toTarget(row.target),
    details: toDetails(kind, row.details),
    outcome: text(row.outcome),
    requestId: text(row.requestId),
  };
}

/** `ActivityPage`: `items` not an array is no records; `nextCursor` a non-empty string or `null`. */
export function toCompanyActivityPage(wire: unknown): CompanyActivityPage {
  const page = objectOf(wire) ?? {};
  return {
    items: Array.isArray(page.items) ? page.items.map(toActivityRecord) : [],
    nextCursor: text(page.nextCursor),
  };
}

/**
 * The page, unless one of its records names another company (TAS-512's rule,
 * api-contract-guard B3, checked per record): then nothing of it is drawn —
 * `ForeignCompanyAnswerError`, never retried. A record that names none is the
 * requested company's: the session it went with is.
 */
export function ofCompanyActivity(page: CompanyActivityPage, tenantId: string): CompanyActivityPage {
  if (page.items.some((record) => record.tenantId !== null && record.tenantId !== tenantId)) {
    throw new ForeignCompanyAnswerError();
  }
  return page;
}

/** The `kind` values as they go on the wire: de-duplicated and sorted, so one filter is one request (B1). */
export function activityKindsParam(kinds: readonly string[] | undefined): string[] {
  return [...new Set((kinds ?? []).filter((kind) => kind !== ""))].sort();
}

/**
 * The query string of `GET …/activity`, in the proposal's order: `limit`,
 * `actorUserId`, `kind` repeated, `cursor`. Absent parameters are not sent.
 */
export function activitySearch(params: ListTenantActivityParams): URLSearchParams {
  const search = new URLSearchParams();
  if (params.limit !== undefined) search.set("limit", String(params.limit));
  if (params.actorUserId !== undefined) search.set("actorUserId", params.actorUserId);
  for (const kind of activityKindsParam(params.kinds)) search.append("kind", kind);
  if (params.cursor !== undefined) search.set("cursor", params.cursor);
  return search;
}
