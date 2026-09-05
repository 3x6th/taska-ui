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
}

/**
 * One result of `GET /issues/search` — the contract's `IssueShortResponseDto`,
 * and **not** an `Issue`.
 *
 * Six fields is everything the search route is ever told. There is no `status`,
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
  | "COMMENT_DELETED";

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
    [key: string]: unknown;
  };
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
