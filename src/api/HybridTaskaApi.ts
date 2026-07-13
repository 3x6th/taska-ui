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

/**
 * Auth endpoints are served by the real gateway; the rest of the contract
 * is not implemented on the backend yet and stays on the mock.
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
    return this.mock.listIssues(projectId, params);
  }

  getIssue(projectId: string, issueId: string): Promise<IssueWithHistory> {
    return this.mock.getIssue(projectId, issueId);
  }

  createIssue(projectId: string, input: CreateIssueInput): Promise<Issue> {
    return this.mock.createIssue(projectId, input);
  }

  updateIssue(projectId: string, issueId: string, input: UpdateIssueInput): Promise<Issue> {
    return this.mock.updateIssue(projectId, issueId, input);
  }

  assignIssue(projectId: string, issueId: string, assigneeId: string | null): Promise<Issue> {
    return this.mock.assignIssue(projectId, issueId, assigneeId);
  }

  transitionIssue(projectId: string, issueId: string, toStatus: IssueStatus): Promise<Issue> {
    return this.mock.transitionIssue(projectId, issueId, toStatus);
  }

  deleteIssue(projectId: string, issueId: string): Promise<void> {
    return this.mock.deleteIssue(projectId, issueId);
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
