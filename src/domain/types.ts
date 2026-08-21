export type UserStatus = "INVITED" | "ACTIVE" | "BLOCKED";
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
  color?: string;
  // Optional because the deployed gateway may not carry the field yet, and
  // because UNSPECIFIED collapses to the same absence. Never inferred from the
  // JWT, and it grants nothing on its own — the server stays authoritative.
  globalRole?: GlobalRole;
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
 * the contract's soft delete: a removed label keeps its row, stops being
 * returned by the list, and stops being attached to issues. Nothing in this app
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
