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
