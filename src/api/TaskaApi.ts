import type {
  AdminCatalog,
  AdminRow,
  AdminRowQuery,
  AdminRows,
  AdminRowsQuery,
  Issue,
  IssueComment,
  IssueLink,
  IssueLinkType,
  IssuePriority,
  IssueStatus,
  IssueType,
  IssueWithHistory,
  Label,
  Notification,
  Page,
  Project,
  ProjectLabel,
  ProjectMember,
  ProjectMembership,
  User,
  Workflow,
} from "../domain/types";

export interface LoginInput {
  email: string;
  password: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AcceptInvitationInput {
  token: string;
  newPassword: string;
}

export interface CreateProjectInput {
  projectKey: string;
  name: string;
  description?: string;
}

export interface ListIssuesParams {
  status?: IssueStatus;
  assigneeId?: string;
  /** `labelId` on the wire: the issues carrying this label, filtered by the server. */
  labelId?: string;
  page?: number;
  pageSize?: number;
}

export interface CreateIssueInput {
  issueType: IssueType;
  summary: string;
  description: string;
  priority: IssuePriority;
}

export interface UpdateIssueInput {
  summary?: string;
  description?: string;
  priority?: IssuePriority;
}

export interface CreateIssueLinkInput {
  targetIssueId: string;
  /** The request half of the contract's asymmetry — closed, unlike the response. */
  linkType: IssueLinkType;
}

/**
 * Both label writes take the same pair, because `UpdateProjectLabelRequestDto`
 * requires `name` *and* `color` just as the create does — a PATCH that means to
 * change only the colour still has to send the name it is keeping. The two
 * types are kept apart anyway: they are two request bodies in the contract, and
 * an alias would hide it the day one of them grows a field.
 */
export interface CreateProjectLabelInput {
  /** 1-50 characters, unique within the project (the server decides, not this). */
  name: string;
  /** `#RRGGBB`. The contract rejects any other spelling with a 400. */
  color: string;
}

export interface UpdateProjectLabelInput {
  name: string;
  color: string;
}

export interface ListCommentsParams {
  page?: number;
  pageSize?: number;
}

export interface ListNotificationsParams {
  unreadOnly?: boolean;
  pageSize?: number;
  offset?: number;
}

export interface TaskaApi {
  login(input: LoginInput): Promise<AuthTokens>;
  acceptInvitation(input: AcceptInvitationInput): Promise<void>;
  refresh(refreshToken: string): Promise<AuthTokens>;
  logout(): Promise<void>;
  /**
   * The signed-in account as the server describes it. `globalRole` may be
   * absent — an older gateway, or the contract's UNSPECIFIED — and callers must
   * treat that as "not stated" rather than as a role. It is descriptive only:
   * the server, not this field, decides what the account may do.
   */
  getCurrentUser(): Promise<User>;

  /**
   * Synchronous by design: the route guard reads it during render, so it cannot
   * wait on a promise. It answers "does this client hold credentials", not "is
   * the server still willing to accept them" — the server stays authoritative.
   */
  hasSession(): boolean;
  /**
   * Fires when the server rejected the session and it could not be refreshed.
   * Returns an unsubscribe.
   */
  onSessionExpired(listener: () => void): () => void;

  listProjects(): Promise<Project[]>;
  createProject(input: CreateProjectInput): Promise<Project>;
  getProject(projectId: string): Promise<Project>;
  getMembership(projectId: string): Promise<ProjectMembership>;
  listMembers(projectId: string): Promise<ProjectMember[]>;

  getWorkflow(projectId: string, issueType?: IssueType): Promise<Workflow>;
  listIssues(projectId: string, params?: ListIssuesParams): Promise<Page<Issue>>;
  getIssue(projectId: string, issueId: string): Promise<IssueWithHistory>;
  createIssue(projectId: string, input: CreateIssueInput): Promise<Issue>;
  updateIssue(projectId: string, issueId: string, input: UpdateIssueInput): Promise<Issue>;
  assignIssue(projectId: string, issueId: string, assigneeId: string | null): Promise<Issue>;
  transitionIssue(projectId: string, issueId: string, transitionId: string): Promise<Issue>;
  deleteIssue(projectId: string, issueId: string): Promise<void>;

  /**
   * The three link routes are issue-scoped on the wire
   * (`/issues/{issueId}/links`) and need no `projectId`, but it stays first in
   * the signature like `getIssue`/`updateIssue`: the mock resolves an issue
   * within a project, and a caller that has one issue id but not its project is
   * not a case this app has.
   */
  listIssueLinks(projectId: string, issueId: string): Promise<IssueLink[]>;
  createIssueLink(projectId: string, issueId: string, input: CreateIssueLinkInput): Promise<IssueLink>;
  deleteIssueLink(projectId: string, issueId: string, linkId: string): Promise<void>;

  /**
   * The project's own labels (`GET /projects/{projectId}/labels`). Everyone who
   * can read the project can read these — the writes below are the gated half.
   * Soft-deleted labels are not in the answer, so nothing here filters them.
   */
  listProjectLabels(projectId: string): Promise<ProjectLabel[]>;
  createProjectLabel(projectId: string, input: CreateProjectLabelInput): Promise<ProjectLabel>;
  updateProjectLabel(projectId: string, labelId: string, input: UpdateProjectLabelInput): Promise<ProjectLabel>;
  /** Soft delete by the contract's own summary: the row stays, the label stops being served. */
  deleteProjectLabel(projectId: string, labelId: string): Promise<void>;

  /**
   * The labels on one issue. `Issue.labels` carries the same set from the detail
   * read, so this exists for the panel to refetch after a write rather than for
   * a screen that has no issue in hand.
   */
  listIssueLabels(projectId: string, issueId: string): Promise<Label[]>;
  /**
   * Returns nothing on purpose. `AddIssueLabelResponseDto` answers with the join
   * row — issue id, label id, who and when — and the caller picked the label out
   * of a list it already holds, so there is no fact in that response it does not
   * have. Passing it up would invite a component to treat a join record as a
   * label, which is the one thing it is not.
   */
  addIssueLabel(projectId: string, issueId: string, labelId: string): Promise<void>;
  removeIssueLabel(projectId: string, issueId: string, labelId: string): Promise<void>;

  listComments(projectId: string, issueId: string, params?: ListCommentsParams): Promise<Page<IssueComment>>;
  addComment(projectId: string, issueId: string, body: string): Promise<IssueComment>;
  updateComment(projectId: string, issueId: string, commentId: string, body: string): Promise<IssueComment>;
  deleteComment(projectId: string, issueId: string, commentId: string): Promise<void>;

  listNotifications(params?: ListNotificationsParams): Promise<Page<Notification>>;
  markNotificationRead(notificationId: string): Promise<Notification>;
  markAllNotificationsRead(): Promise<{ updatedCount: number }>;

  /**
   * The catalog of services and tables the read-only admin API will serve
   * (`GET /readonly/catalog`). `GLOBAL_ADMIN` only — every other caller gets a
   * 403 from the server, which is the actual permission control; the UI hiding
   * the section is not.
   */
  getAdminCatalog(): Promise<AdminCatalog>;

  /**
   * One page of one table (`GET /readonly/{service}/{table}`). The service and
   * table names are not validated here: the catalog above is the only source of
   * legitimate values, and the gateway validates them again regardless.
   */
  listAdminRows(query: AdminRowsQuery): Promise<AdminRows>;

  /**
   * One row by its primary key (`GET /readonly/{service}/{table}/{id}`), for
   * the row card in §5.8. A row that is not there is a missing row, not a
   * missing address: the caller distinguishes it from a refusal and says so
   * inside the card.
   */
  getAdminRow(query: AdminRowQuery): Promise<AdminRow>;
}
