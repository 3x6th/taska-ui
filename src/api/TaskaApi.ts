import type {
  Issue,
  IssueComment,
  IssuePriority,
  IssueStatus,
  IssueType,
  IssueWithHistory,
  Notification,
  Page,
  Project,
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

  listComments(projectId: string, issueId: string, params?: ListCommentsParams): Promise<Page<IssueComment>>;
  addComment(projectId: string, issueId: string, body: string): Promise<IssueComment>;
  updateComment(projectId: string, issueId: string, commentId: string, body: string): Promise<IssueComment>;
  deleteComment(projectId: string, issueId: string, commentId: string): Promise<void>;

  listNotifications(params?: ListNotificationsParams): Promise<Page<Notification>>;
  markNotificationRead(notificationId: string): Promise<Notification>;
  markAllNotificationsRead(): Promise<{ updatedCount: number }>;
}
