/**
 * The four states an account can be in — `UserStatusDto` in the contract this
 * story is written against (backend PR #146, extracted at
 * docs/contract/pending/pr-146-TAS-108.yml), and `USER_STATUS_LOCKED = 4` in
 * that PR's `common.proto`.
 *
 * `LOCKED` is not on `develop`, so nothing holds it yet. Measured at
 * `ref=develop` on 2026-09-05: `auth-service`'s `UserStatus` enum declares
 * `ACTIVE`, `BLOCKED` and `INVITED`; the proto enum stops at
 * `USER_STATUS_BLOCKED = 3`; and `handleFailedAttempt(Credential)` touches the
 * credential's counters and writes no status at all. The entity value, the
 * proto value, the failed-login write and `resetFailedAttempts` restoring
 * `ACTIVE` all ship with PR #146 — the same PR that brings the three admin
 * writes TAS-188 is about. The union is widened now for that reason and no
 * other: so this frontend is right on the day that PR merges rather than a
 * build after it.
 *
 * What earns it a value of its own once it does ship: `LOCKED` is **not** an
 * administrative state, and no write this client makes reaches it. An account
 * locks itself after `maxFailedAttempts` failed sign-ins and the next
 * successful one releases it, which is why `block` and `unblock` are both
 * refused from it and `resetCredentialLockout` (src/api/TaskaApi.ts) is the
 * only write that leaves it.
 *
 * A value outside this union can still arrive, and adding to the union is not
 * what stops it: `GET /users/me` answers the gateway's own `GatewayUserStatus`,
 * which has no `LOCKED` and reports `UNSPECIFIED` instead. So every reader
 * still prints an unrecognised status verbatim rather than trusting the type
 * (TAS-173, `userStatusLabel` in src/screens/admin/users.ts).
 */
export type UserStatus = "INVITED" | "ACTIVE" | "BLOCKED" | "LOCKED";
/**
 * The account-wide role from `GET /users/me`, not a project role — `ProjectRole`
 * below is the per-project one and the two never substitute for each other.
 *
 * The contract's third value, `UNSPECIFIED`, is deliberately not modelled: it is
 * a proto-style zero value meaning "not stated", so it is normalised away in the
 * API layer and reaches the domain as a missing `globalRole`, exactly like a
 * gateway that does not send the field at all.
 */
export type GlobalRole = "USER" | "GLOBAL_ADMIN";
export type ProjectRole = "ADMIN" | "MEMBER" | "VIEWER";
export type IssueType = "TASK" | "BUG" | "STORY";
export type IssuePriority = "LOW" | "MEDIUM" | "HIGH";
export type IssueStatus = "TODO" | "IN_PROGRESS" | "DONE";
export type NotificationType =
  | "ISSUE_ASSIGNED"
  | "ISSUE_TRANSITIONED"
  | "ISSUE_CREATED"
  | "ISSUE_UPDATED"
  | "ISSUE_DELETED"
  | "USER_INVITED"
  | "USER_ACTIVATED"
  | "PROJECT_CREATED"
  | "MEMBER_ADDED"
  | "MEMBER_UPDATED"
  | "MEMBER_REMOVED"
  | "MEMBER_ROLE_CHANGED";

export interface User {
  id: string;
  login: string;
  email: string;
  displayName: string;
  status: UserStatus;
  // Not in the contract at all — `color` there belongs to a label and to
  // nothing else — so today this arrives only from the mock. It is load-bearing
  // anyway: a value here beats the colour `avatarColor` computes from the id,
  // which is the hook a chosen colour would arrive through (TAS-148).
  color?: string;
  // Optional because the deployed gateway may not carry the field yet, and
  // because UNSPECIFIED collapses to the same absence. Never inferred from the
  // JWT, and it grants nothing on its own — the server stays authoritative.
  globalRole?: GlobalRole;
}

/**
 * What `POST /admin/users/{userId}/block`, `.../unblock` and
 * `.../reset-lockout` answer with — `UserStatusResponseDto`. The server states
 * the transition it performed, both ends of it, so the caller never has to
 * infer what happened from what it asked for.
 *
 * `previousStatus` and `currentStatus` are the domain's own `UserStatus`
 * because the contract declares them as that enum, exactly as it declares the
 * status on `User` — this is not the open-string case of
 * `IssueLink.viewLinkType`, where the contract types the field as a bare
 * string.
 *
 * `changedAt` — **not** `updatedAt`, which is what this field was called until
 * TAS-188. The gateway's `AdminUserManagementMapper.toRestUserStatusResponse`
 * calls `setChangedAt`, and `UserStatusResponseDto` lists `changedAt` among its
 * required properties, so the old name read `undefined` out of every successful
 * response while the type still promised a `string`.
 *
 * It is modelled because the contract declares it, and it **is not drawn
 * anywhere**. The reason it is not drawn is no longer that it is a second
 * clock: auth-service builds the response as
 * `.changedAt(savedUser.getUpdatedAt())` on an entity carrying
 * `@LastModifiedDate`, so this *is* the `updated_at` of the `auth.users` row it
 * changed, to the same instant. What it is not is the row itself. The list this
 * value would decorate is refetched immediately after the write, and the
 * refetched row carries its own `updated_at` — so the section reads one source
 * for the whole table rather than patching one row's timestamp from a response
 * and the rest from a list.
 */
export interface UserStatusChange {
  userId: string;
  previousStatus: UserStatus;
  currentStatus: UserStatus;
  changedAt: string;
}

export interface Project {
  id: string;
  projectKey: string;
  name: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  description?: string;
  // Same standing as `User.color` above: absent from the contract, present only
  // in the mock, and still the value that wins over the colour `keyBadgeStyle`
  // computes from the project key (TAS-148).
  color?: string;
  memberIds?: string[];
}

export interface ProjectMembership {
  role: ProjectRole;
  isMember: boolean;
  projectExists: boolean;
}

export interface ProjectMember {
  userId: string;
  role: ProjectRole;
  addedAt: string;
  addedBy: string;
  user?: Pick<User, "displayName" | "email" | "color">;
}

export interface WorkflowStatus {
  id: string;
  statusKey: IssueStatus;
  name: string;
  category: IssueStatus;
  sortOrder: number;
}

export interface WorkflowTransition {
  id: string;
  fromStatusId: string;
  toStatusId: string;
  name: string;
  sortOrder: number;
}

export interface Workflow {
  id: string;
  name: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  statuses: WorkflowStatus[];
  transitions: WorkflowTransition[];
}

/**
 * A label as an *issue* carries it — the contract's `IssueLabelResponseDto`,
 * and the same three fields `IssueResponseDto.labels[]` holds. Deliberately not
 * an alias for `ProjectLabel` below: three fields is everything the issue side
 * of the contract is ever told, and typing it as the project record would put
 * `createdBy` and `deletedAt` in scope for code that has never been sent them.
 */
export interface Label {
  id: string;
  name: string;
  color: string;
}

/**
 * A label as the *project* owns it (`ProjectLabelResponseDto`). `deletedAt` is
 * the contract's soft delete: a removed label keeps its row and stops being
 * returned by the list. Whether it also comes off the issues already carrying
 * it is *this repository's* reading of TAS-119, not something the contract
 * states or the gateway has been observed doing — the mock implements it that
 * way, and nothing here depends on the gateway agreeing. Nothing in this app
 * asks for deleted labels, so in practice this is `null` wherever it is read —
 * it is modelled because the field is in the response, not because a screen
 * branches on it.
 */
export interface ProjectLabel extends Label {
  projectId: string;
  createdBy: string;
  createdAt: string;
  deletedAt: string | null;
}

/**
 * A calendar date with no time and no zone — `YYYY-MM-DD`, the contract's
 * `format: date`, a `LocalDate` on the gateway and a `date` column in
 * `taska.issues`.
 *
 * **It is a `string` and it must never become a `Date`.** `new Date("2026-09-01")`
 * is parsed by the spec as UTC midnight, and every formatter this app owns
 * prints in the viewer's zone — so anyone west of UTC reads *2026-08-31* for a
 * due date the server, the database and the person who typed it all call the
 * 1st. There is no formatting option that repairs it after the fact, because by
 * then the value is an instant and the day has already been chosen. That is the
 * trap this alias exists to close: keep the wire's three fields as text, split
 * them when they need to be drawn, and never hand one to the `Date`
 * constructor.
 *
 * Two more things follow from it being text, and both are worth having:
 * ISO-8601 dates sort and compare correctly as strings (`"2026-01-02" <
 * "2026-03-01"`), so every comparison in the API layer is a string comparison;
 * and equality is exact, with no instant to round.
 *
 * The alias is not branded. A brand would make every literal need a cast for a
 * guarantee TypeScript cannot keep anyway — the value arrives from the network
 * — so the guarantee is `isDateOnly` below, applied where a value enters.
 */
export type DateOnly = string;

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const isLeapYear = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

/**
 * Whether a string is a date the wire would accept: four-digit year, two-digit
 * month, two-digit day, and a day that exists.
 *
 * The shape check alone is not enough, which is the whole reason this is a
 * function rather than a regular expression at each call site. `2026-13-01`
 * and `2026-02-30` both match `\d{4}-\d{2}-\d{2}` and both are refused by
 * `LocalDate.parse` on the gateway with a `400` — so they are refused here
 * too, before a request is spent on them.
 *
 * Written as arithmetic rather than through `Date`, deliberately. Checking a
 * date by constructing one and reading the parts back is the same UTC-midnight
 * trap the alias above is about, and it also silently accepts overflow in some
 * engines. A leap-year rule is four lines and cannot drift with a zone.
 *
 * This is the one runtime export in this file. It lives here because it is the
 * type's own definition of validity, and a caller that has a `DateOnly` in hand
 * should not have to know which module remembers what one is.
 */
export function isDateOnly(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return false;
  const lastDay = month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1];
  return day >= 1 && day <= lastDay;
}

export interface Issue {
  id: string;
  projectId: string;
  issueNumber: number;
  issueKey: string;
  issueType: IssueType;
  summary: string;
  description: string;
  status: IssueStatus;
  priority: IssuePriority;
  assigneeId: string | null;
  reporterId: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  deletedAt: string | null;
  /**
   * `IssueResponseDto.labels`. Always an array by the time it is read — the API
   * layer defaults an absent one to `[]` — so a card never has to ask whether
   * the gateway sent the field. The list endpoint's short DTO does not carry
   * labels at all; `listIssues` hydrates each row from the detail endpoint
   * (`RestTaskaApi`), which is where the board's chips come from.
   */
  labels: Label[];
  /**
   * The five planning fields — `IssueResponseDto`'s `storyPoints`, `startDate`,
   * `dueDate`, `originalEstimateMinutes` and `remainingEstimateMinutes`, added
   * by backend PR #148 (TAS-116, extracted at
   * docs/contract/pending/pr-148-TAS-116.yml).
   *
   * **`null` is the only "not set", for all five.** The wire cannot tell an
   * absent key from a JSON `null` and the server never means the difference:
   * the gateway's mapper writes a field only when the proto optional is
   * present, and an unset optional resolves to a Java `null`. Making them
   * `number | null` rather than optional is what stops a reader from having to
   * ask which of two spellings of nothing arrived.
   *
   * `storyPoints` is `format: double`, so **0.5 is a legal value** and this is
   * never an integer. The column is `numeric(5,2)` (`0007-issue-planing-fields.sql`),
   * which is where the 0…999.99 bound in src/api/planningFields.ts comes from.
   * `0` is legal too, and is a count rather than an absence — the one
   * distinction an `||` anywhere near this field would erase.
   *
   * The two estimates are `int32` minutes, whole numbers, `>= 0`.
   */
  storyPoints: number | null;
  startDate: DateOnly | null;
  dueDate: DateOnly | null;
  originalEstimateMinutes: number | null;
  remainingEstimateMinutes: number | null;
}

/**
 * One result of `GET /issues/search` — the contract's `IssueShortResponseDto`,
 * and **not** an `Issue`.
 *
 * Seven fields is everything the search route is ever told — six until backend
 * PR #148 added `storyPoints` to `IssueShortResponseDto`. There is no `status`,
 * no `projectId`, no `description`, no `labels`, no `updatedAt` and no
 * `version`, which is why this is its own type rather than a `Partial<Issue>`
 * or an `Issue` with holes punched in it: a hit that was typed as an issue
 * would let a column, a card or a drop target read a status the server never
 * sent.
 *
 * Two consequences shape the feature rather than decorate it. A hit cannot be
 * placed in a board column, so the board renders server hits as their own group
 * (DESIGN.md §5.4 counts them, §5.2 does not hold them). And a hit needs a
 * `projectId` to be linkable, which is resolved from the `issueKey` prefix
 * against the projects list the client already holds — see
 * `projectKeyFromIssueKey`. Deliberately not hydrated through `getIssue`: that
 * is the N+1 `RestTaskaApi.listIssues` already pays, and the owner settled the
 * general question on 2026-08-23 (docs/ai/API-DIVERGENCE.md, TAS-178) — fix the
 * backend, do not hydrate on the frontend. On a search it would be that N+1 on
 * every keystroke.
 */
export interface IssueSearchHit {
  id: string;
  issueKey: string;
  issueType: IssueType;
  summary: string;
  priority: IssuePriority;
  /** `""` on the wire for an unassigned issue; normalised to `null` like `Issue.assigneeId`. */
  assigneeId: string | null;
  /**
   * The **one** planning field the search DTO carries: backend PR #148 adds
   * `storyPoints` to `IssueShortResponseDto` and adds nothing else to it — no
   * dates, no estimates.
   *
   * Do not widen this type past it. The narrowness is the point — a hit that
   * grew a `dueDate` the server never sent would be drawn as an empty date on
   * every search result, which reads as "no due date" rather than as "not
   * asked for".
   */
  storyPoints: number | null;
}

export type IssueEventType =
  | "CREATED"
  | "TRANSITIONED"
  | "ASSIGNED"
  | "PRIORITY"
  | "UPDATED"
  | "DELETED"
  | "COMMENT_CREATED"
  | "COMMENT_UPDATED"
  | "COMMENT_DELETED"
  /**
   * The two the attachment routes write, both already on backend `develop`:
   * `AttachmentTransactionExecutor` saves an `ATTACHMENT_UPLOADED` history row
   * inside the same transaction as the insert, and an `ATTACHMENT_DELETED` one
   * inside the soft delete (read at PR #147's head `f53dca38`, where
   * `issue-service/.../domain/IssueEventType.java` lists fourteen members).
   *
   * Added because the union being closed is not what protects the activity
   * feed — `historyText` ends in a catch-all `return "updated this issue"`, so
   * before this every upload rendered as *"Anna updated this issue"*, a
   * sentence about the wrong event with nothing on screen to contradict it.
   * Widening the type is only half the fix; the branch in `historyText` is the
   * other half, and neither works alone.
   *
   * The gateway does **not** constrain this field — `IssueHistoryResponseDto`
   * types `eventType` as a bare `type: string` with no enum — so this union is
   * a statement about the values this build can *name*, never a guarantee about
   * what arrives. Four more the backend already emits (`LINK_CREATED`,
   * `LINK_DELETED`, `LABEL_ADDED`, `LABEL_REMOVED`) are still missing from it
   * and still land in the catch-all; they are out of this story's scope and are
   * recorded rather than quietly added here.
   */
  | "ATTACHMENT_UPLOADED"
  | "ATTACHMENT_DELETED";

export interface IssueHistoryEvent {
  id: string;
  issueId: string;
  eventType: IssueEventType;
  actorUserId: string;
  occurredAt: string;
  payload: {
    from?: IssueStatus;
    to?: IssueStatus | IssuePriority | string | null;
    field?: string;
    fromStatus?: IssueStatus;
    toStatus?: IssueStatus;
    assigneeId?: string | null;
    previousAssigneeId?: string | null;
    oldPriority?: IssuePriority;
    newPriority?: IssuePriority;
    /**
     * `PayloadSerializer.createAttachmentUploadedPayload` and
     * `createAttachmentDeletedPayload` both put the file name here, and it is
     * the only field of either payload the activity feed prints. The rest —
     * `attachmentId`, `uploadedBy`, `deletedBy`, `contentType`, `sizeBytes` —
     * arrive too and are reachable through the index signature; they are not
     * declared because nothing draws them, and a declared field nobody reads is
     * a promise about a payload this app has never seen.
     */
    fileName?: string;
    [key: string]: unknown;
  };
}

/**
 * One file attached to an issue — `IssueAttachmentDto` in backend PR #147
 * (`docs/contract/pending/pr-147-TAS-131.yml`), field for field.
 *
 * `sizeBytes` is `format: int64` on the wire and a `number` here, and that is
 * safe rather than convenient: the server refuses anything above
 * `ATTACHMENT_MAX_SIZE_BYTES` (2097152) at leg 1 *and* re-measures the stored
 * object at leg 3, so no row this type describes can hold a value within eleven
 * orders of magnitude of `Number.MAX_SAFE_INTEGER`. A `bigint` would buy
 * nothing and would cost every caller an arithmetic conversion to divide by
 * 1024.
 *
 * `objectKey` is deliberately absent: the gateway's mapper
 * (`IssueAttachmentMapper.toIssueAttachmentDto`) never sets it, so no client
 * has ever seen one on a listed attachment. It exists only inside one upload,
 * as the value leg 1 hands to leg 3, and that is where it stays.
 *
 * A presigned download URL is absent for the same reason and it is worth
 * stating, because the service one layer down *does* mint one per row:
 * `AttachmentServiceImpl.listAttachments` builds a presigned GET for every
 * attachment and the gateway's mapper drops it. So `GET .../download-url` is
 * not a redundant second call — it is the only way this contract offers a link.
 */
export interface IssueAttachment {
  id: string;
  issueId: string;
  fileName: string;
  /** Exactly as it was signed. Never normalised, never recomputed from the extension. */
  contentType: string;
  sizeBytes: number;
  uploadedBy: string;
  /**
   * The object's ETag with its quotes stripped, which for a single-part PUT is
   * the MD5 of the bytes. `nullable: true` in the contract and blank-to-`null`
   * in the gateway's mapper, though the column itself is `NOT NULL` — so a
   * `null` here means "the gateway sent an empty string", not "the row has no
   * checksum".
   */
  checksum: string | null;
  createdAt: string;
}

/** What leg 1 hands back: where to PUT the bytes, and what to call the object at leg 3. */
export interface AttachmentUploadTicket {
  /**
   * A presigned S3 URL on `storage.public-url`, **not on the gateway**. The
   * signature is in the query string, it covers the `Content-Type` header, and
   * it is honoured for `ATTACHMENT_PRESIGNED_TTL_MS` from the moment this
   * ticket was minted.
   */
  uploadUrl: string;
  /** Opaque; a bare UUID today. The only thing leg 3 identifies the object by. */
  objectKey: string;
}

/** `GetAttachmentDownloadUrlResponseDto` — a presigned GET, and the checksum again. */
export interface AttachmentDownloadUrl {
  downloadUrl: string;
  checksum: string | null;
}

export interface IssueWithHistory {
  issue: Issue;
  history: IssueHistoryEvent[];
}

/**
 * The link type a *request* may ask for — the contract's `IssueLinkTypeDto`,
 * a closed enum. Deliberately not reused for the response: see `IssueLink`.
 */
export type IssueLinkType = "BLOCKS" | "RELATES_TO" | "DUPLICATES";

export interface IssueLink {
  id: string;
  projectId: string;
  sourceIssueId: string;
  targetIssueId: string;
  /**
   * Open on purpose. The contract asks for `linkType` (the closed enum above)
   * and answers with `viewLinkType`, typed as a bare `string` with no enum —
   * the asymmetry is the contract's, not a typo to be corrected here. Read
   * literally, "view" means the relation *as seen from the issue that was
   * asked about*, so the response may legitimately carry the inverse of a
   * request value (`IS_BLOCKED_BY` for a `BLOCKS` link) which the request enum
   * has no name for. Narrowing this to `IssueLinkType` would therefore drop
   * exactly the values that make the field worth having.
   *
   * Presentation narrows it instead (`issueLinkTypeLabel`): a known value gets
   * a written label, anything else is humanised verbatim. Recorded in
   * docs/ai/API-DIVERGENCE.md and unverified against the deployed gateway.
   */
  viewLinkType: string;
  createdBy: string;
  createdAt: string;
}

export interface IssueComment {
  id: string;
  issueId: string;
  projectId: string;
  authorUserId: string;
  body: string;
  createdAt: string;
  updatedAt: string | null;
  version: number;
}

export interface Notification {
  id: string;
  userId: string;
  notificationType: NotificationType;
  title: string;
  body: string;
  link: string;
  createdAt: string;
  readAt: string | null;
  sourceEventId: string;
}

export interface Page<T> {
  items: T[];
  page?: number;
  pageSize: number;
  totalCount?: number;
  offset?: number;
}

/* ==================== Read-only admin console (TAS-155) ====================
 *
 * `/api/v1/readonly/*` is a generic window onto the services' own tables, so
 * unlike the rest of this file these types describe *shapes the server
 * declares at runtime* rather than a schema known at build time. A row is
 * therefore `unknown` per column, not `string` — the console renders whatever
 * it is handed and never assumes a type it was not told about.
 */

export interface AdminColumn {
  name: string;
  type: string;
  /**
   * Column the catalog marks as holding secrets. The server masks it before it
   * leaves admin-service, three different ways, so this flag says the column is
   * masked — not that nothing of it is drawn. A partial mask is a value and is
   * printed; see `isWithheld` for which of the three arrived.
   *
   * The contract does not require the field. `RestTaskaApi` defaults a missing
   * one to `true`, so this is a boolean by the time anything reads it.
   */
  sensitive: boolean;
}

export interface AdminTable {
  name: string;
  columns: AdminColumn[];
  primaryKey: string;
}

export interface AdminService {
  name: string;
  databaseAlias: string;
  tables: AdminTable[];
}

export interface AdminCatalog {
  services: AdminService[];
}

/**
 * The contract spells filters as query keys `column.operator`, with the
 * operator always present: `column.equals`, `column.contains`, `column.from`,
 * `column.to`. Kept structured here so the UI never hand-builds a key, and so
 * the API layer is the only place that knows the wire spelling.
 *
 * The gateway also decides which operator a column may take from that column's
 * type and answers 400 for the rest, which is why the catalog's `type` is not
 * decoration — see `src/screens/admin/columns.ts`.
 */
export type AdminFilterOperator = "equals" | "contains" | "from" | "to";

export interface AdminFilter {
  column: string;
  operator: AdminFilterOperator;
  value: string;
}

export type AdminSortOrder = "asc" | "desc";

export interface AdminRowsQuery {
  service: string;
  table: string;
  page?: number;
  pageSize?: number;
  sort?: string;
  order?: AdminSortOrder;
  filters?: AdminFilter[];
}

export interface AdminPagination {
  currentPage: number;
  pageSize: number;
  totalRows: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

/**
 * What the server says about the table it just returned. `columns` is the
 * authority on which columns exist and in what order — the rows themselves are
 * bags of keys and cannot be trusted to agree with each other, least of all
 * when a value is null.
 */
export interface AdminRowsMeta {
  service: string;
  table: string;
  columns: string[];
  sortableColumns: string[];
  filterableColumns: string[];
}

/** One record of a service table: a bag of columns whose types are runtime news. */
export type AdminRow = Record<string, unknown>;

export interface AdminRows {
  rows: AdminRow[];
  pagination: AdminPagination;
  meta: AdminRowsMeta;
}

/**
 * One row by its primary key (`GET /readonly/{service}/{table}/{id}`).
 *
 * `id` is a string here because a primary key is whatever the table says it is,
 * but the gateway types the path parameter as a `UUID` — a table keyed by
 * anything else cannot be addressed at all, which is why §5.8 only makes a row
 * clickable when the catalog says its key column is `uuid`.
 */
export interface AdminRowQuery {
  service: string;
  table: string;
  id: string;
}

/**
 * One problematic transactional-outbox event, as
 * `GET /readonly/outbox/problematic-summary` reports it (the Events section,
 * DESIGN.md §5.8).
 *
 * This is a row of `outbox_events` with two fields added by the summary —
 * `serviceKey`, because the endpoint answers for every service at once, and
 * `reason`. Unlike the generic admin reads above, the shape *is* known at build
 * time here: the endpoint declares it.
 *
 * `status` stays an open `string` rather than a union. It is raw table data,
 * the contract types it as a bare string with no enum, and the three values a
 * problematic row can carry today (`FAILED`, `PROCESSING`, `NEW`) are a fact
 * about the backend's query, not a promise. The UI derives the category from it
 * and prints anything else verbatim.
 *
 * `reason` is a human-readable English sentence the backend writes, not a code.
 * Nothing may parse or switch on it — the category comes from `status` — and it
 * is rendered on the summary list's category cell, in `title` and in that
 * cell's accessible name: the visible word is the derived category, the
 * server's whole sentence is one hover or one screen reader away. Not a column
 * of its own and not on the event card, which draws the table's catalog
 * columns — `reason` is a field of the summary, and a row opened by its own
 * address does not have one (§5.8).
 */
export interface ProblematicOutboxEvent {
  id: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: string;
  status: string;
  createdAt: string;
  publishedAt: string | null;
  attempts: number;
  lastErrorMessage: string | null;
  processingStartedAt: string | null;
  requestId: string | null;
  serviceKey: string;
  reason: string;
}

/**
 * How many problematic events one service has, by category. The counts cover
 * every outbox service and every problematic row, including the ones the
 * summary's own list was cut short of — which is what makes the matrix the
 * answer to "what is broken and where" rather than a caption for the list.
 */
export interface ProblematicOutboxCounts {
  serviceKey: string;
  overdueNewCount: number;
  stuckProcessingCount: number;
  failedCount: number;
}

/**
 * The whole summary. `events` arrives oldest first and is capped by the
 * server's own limit; `notAllShown` says the cap was reached, which is a
 * statement about this response rather than an error.
 */
export interface ProblematicOutboxSummary {
  events: ProblematicOutboxEvent[];
  counts: ProblematicOutboxCounts[];
  notAllShown: boolean;
}
