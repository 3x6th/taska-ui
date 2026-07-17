import type {
  AcceptInvitationInput,
  AuthTokens,
  CreateIssueInput,
  CreateProjectInput,
  ListIssuesParams,
  LoginInput,
  TaskaApi,
  UpdateIssueInput,
} from "./TaskaApi";
import type {
  Issue,
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
 * Auth and issue endpoints are served by the real gateway. Projects, members,
 * workflow and notifications stay on the mock until their REST APIs land.
 */
export class HybridTaskaApi implements TaskaApi {
  constructor(
    private readonly live: TaskaApi,
    private readonly mock: TaskaApi,
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
    return this.mock.listProjects();
  }

  createProject(input: CreateProjectInput): Promise<Project> {
    return this.mock.createProject(input);
  }

  getProject(projectId: string): Promise<Project> {
    return this.mock.getProject(projectId);
  }

  getMembership(projectId: string): Promise<ProjectMembership> {
    return this.mock.getMembership(projectId);
  }

  listMembers(projectId: string): Promise<ProjectMember[]> {
    return this.mock.listMembers(projectId);
  }

  getWorkflow(projectId: string, issueType?: IssueType): Promise<Workflow> {
    return this.mock.getWorkflow(projectId, issueType);
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

  listNotifications(): Promise<Page<Notification>> {
    return this.mock.listNotifications();
  }

  markNotificationRead(notificationId: string): Promise<Notification> {
    return this.mock.markNotificationRead(notificationId);
  }

  markAllNotificationsRead(): Promise<{ updatedCount: number }> {
    return this.mock.markAllNotificationsRead();
  }
}
