import type {
  AcceptInvitationInput,
  AuthTokens,
  CreateIssueInput,
  CreateProjectInput,
  ListCommentsParams,
  ListIssuesParams,
  ListNotificationsParams,
  LoginInput,
  TaskaApi,
  UpdateIssueInput,
} from "./TaskaApi";
import type {
  Issue,
  IssueComment,
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

/**
 * API groups with gateway contracts are served by the real backend.
 * Project membership and member reads use a temporary single-admin
 * compatibility view until TAS-137 lands.
 */
export class HybridTaskaApi implements TaskaApi {
  constructor(
    private readonly live: TaskaApi,
    private readonly assumeProjectAdmin = false,
  ) {}

  login(input: LoginInput): Promise<AuthTokens> {
    return this.live.login(input);
  }

  acceptInvitation(input: AcceptInvitationInput): Promise<void> {
    return this.live.acceptInvitation(input);
  }

  refresh(refreshToken: string): Promise<AuthTokens> {
    return this.live.refresh(refreshToken);
  }

  logout(): Promise<void> {
    return this.live.logout();
  }

  getCurrentUser(): Promise<User> {
    return this.live.getCurrentUser();
  }

  listProjects(): Promise<Project[]> {
    return this.live.listProjects();
  }

  createProject(input: CreateProjectInput): Promise<Project> {
    return this.live.createProject(input);
  }

  getProject(projectId: string): Promise<Project> {
    return this.live.getProject(projectId);
  }

  async getMembership(projectId: string): Promise<ProjectMembership> {
    const [project, currentUser] = await Promise.all([
      this.live.getProject(projectId),
      this.live.getCurrentUser(),
    ]);

    return {
      role: this.assumeProjectAdmin || project.createdBy === currentUser.id ? "ADMIN" : "VIEWER",
      isMember: true,
      projectExists: true,
    };
  }

  async listMembers(projectId: string): Promise<ProjectMember[]> {
    const [project, currentUser] = await Promise.all([
      this.live.getProject(projectId),
      this.live.getCurrentUser(),
    ]);

    return [
      {
        userId: currentUser.id,
        role: this.assumeProjectAdmin || project.createdBy === currentUser.id ? "ADMIN" : "VIEWER",
        addedAt: project.createdAt,
        addedBy: project.createdBy,
        user: {
          displayName: currentUser.displayName,
          email: currentUser.email,
          color: currentUser.color,
        },
      },
    ];
  }

  getWorkflow(projectId: string, issueType?: IssueType): Promise<Workflow> {
    return this.live.getWorkflow(projectId, issueType);
  }

  listIssues(projectId: string, params?: ListIssuesParams): Promise<Page<Issue>> {
    return this.live.listIssues(projectId, params);
  }

  getIssue(projectId: string, issueId: string): Promise<IssueWithHistory> {
    return this.live.getIssue(projectId, issueId);
  }

  createIssue(projectId: string, input: CreateIssueInput): Promise<Issue> {
    return this.live.createIssue(projectId, input);
  }

  updateIssue(projectId: string, issueId: string, input: UpdateIssueInput): Promise<Issue> {
    return this.live.updateIssue(projectId, issueId, input);
  }

  assignIssue(projectId: string, issueId: string, assigneeId: string | null): Promise<Issue> {
    return this.live.assignIssue(projectId, issueId, assigneeId);
  }

  transitionIssue(projectId: string, issueId: string, transitionId: string): Promise<Issue> {
    return this.live.transitionIssue(projectId, issueId, transitionId);
  }

  deleteIssue(projectId: string, issueId: string): Promise<void> {
    return this.live.deleteIssue(projectId, issueId);
  }

  listComments(projectId: string, issueId: string, params?: ListCommentsParams): Promise<Page<IssueComment>> {
    return this.live.listComments(projectId, issueId, params);
  }

  addComment(projectId: string, issueId: string, body: string): Promise<IssueComment> {
    return this.live.addComment(projectId, issueId, body);
  }

  updateComment(projectId: string, issueId: string, commentId: string, body: string): Promise<IssueComment> {
    return this.live.updateComment(projectId, issueId, commentId, body);
  }

  deleteComment(projectId: string, issueId: string, commentId: string): Promise<void> {
    return this.live.deleteComment(projectId, issueId, commentId);
  }

  listNotifications(params?: ListNotificationsParams): Promise<Page<Notification>> {
    return this.live.listNotifications(params);
  }

  markNotificationRead(notificationId: string): Promise<Notification> {
    return this.live.markNotificationRead(notificationId);
  }

  markAllNotificationsRead(): Promise<{ updatedCount: number }> {
    return this.live.markAllNotificationsRead();
  }
}
