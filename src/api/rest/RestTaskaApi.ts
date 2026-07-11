import type {
  AcceptInvitationInput,
  AuthTokens,
  CreateIssueInput,
  CreateProjectInput,
  ListIssuesParams,
  LoginInput,
  TaskaApi,
  UpdateIssueInput,
} from "../TaskaApi";
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
  IssueStatus,
} from "../../domain/types";

// Gateway contract: RestErrorResponse is a flat { code, message };
// the nested `error` shape is kept for older service responses.
interface ApiErrorBody {
  code?: string;
  message?: string;
  error?: {
    code: string;
    message: string;
    requestId?: string;
  };
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class RestTaskaApi implements TaskaApi {
  private accessToken = window.localStorage.getItem("taska.accessToken");
  private refreshTokenValue = window.localStorage.getItem("taska.refreshToken");
  private refreshInFlight: Promise<boolean> | null = null;

  constructor(private readonly baseUrl = "/api/v1") {}

  async login(input: LoginInput): Promise<AuthTokens> {
    const tokens = await this.request<AuthTokens>("/auth/login", {
      method: "POST",
      body: input,
      skipAuth: true,
    });
    this.setTokens(tokens);
    return tokens;
  }

  async acceptInvitation(input: AcceptInvitationInput): Promise<void> {
    await this.request<void>("/auth/invitations/accept", {
      method: "POST",
      body: input,
      skipAuth: true,
    });
  }

  async refresh(refreshToken = this.refreshTokenValue ?? ""): Promise<AuthTokens> {
    const tokens = await this.request<AuthTokens>("/auth/refresh", {
      method: "POST",
      body: { refreshToken },
      skipAuth: true,
    });
    this.setTokens(tokens);
    return tokens;
  }

  getCurrentUser(): Promise<User> {
    return this.request<User>("/users/me");
  }

  async listProjects(): Promise<Project[]> {
    const response = await this.request<{ items: Project[] }>("/projects");
    return response.items;
  }

  createProject(input: CreateProjectInput): Promise<Project> {
    return this.request<Project>("/projects", {
      method: "POST",
      body: {
        projectKey: input.projectKey,
        name: input.name,
      },
    });
  }

  getProject(projectId: string): Promise<Project> {
    return this.request<Project>(`/projects/${projectId}`);
  }

  getMembership(projectId: string): Promise<ProjectMembership> {
    return this.request<ProjectMembership>(`/projects/${projectId}/membership`);
  }

  async listMembers(projectId: string): Promise<ProjectMember[]> {
    const response = await this.request<{ items: ProjectMember[] }>(`/projects/${projectId}/members`);
    return response.items;
  }

  getWorkflow(projectId: string, issueType?: IssueType): Promise<Workflow> {
    const search = new URLSearchParams();
    if (issueType) {
      search.set("issueType", issueType);
    }
    return this.request<Workflow>(`/projects/${projectId}/workflow${this.query(search)}`);
  }

  listIssues(projectId: string, params: ListIssuesParams = {}): Promise<Page<Issue>> {
    const search = new URLSearchParams();
    if (params.status) search.set("status", params.status);
    if (params.assigneeId) search.set("assigneeId", params.assigneeId);
    if (params.page !== undefined) search.set("page", String(params.page));
    if (params.pageSize !== undefined) search.set("pageSize", String(params.pageSize));
    return this.request<Page<Issue>>(`/projects/${projectId}/issues${this.query(search)}`);
  }

  getIssue(projectId: string, issueId: string): Promise<IssueWithHistory> {
    return this.request<IssueWithHistory>(`/projects/${projectId}/issues/${issueId}`);
  }

  createIssue(projectId: string, input: CreateIssueInput): Promise<Issue> {
    return this.request<Issue>(`/projects/${projectId}/issues`, {
      method: "POST",
      body: input,
    });
  }

  async updateIssue(projectId: string, issueId: string, input: UpdateIssueInput): Promise<Issue> {
    await this.request<Issue>(`/projects/${projectId}/issues/${issueId}`, {
      method: "PATCH",
      body: input,
    });
    return (await this.getIssue(projectId, issueId)).issue;
  }

  async assignIssue(projectId: string, issueId: string, assigneeId: string | null): Promise<Issue> {
    await this.request<Issue>(`/projects/${projectId}/issues/${issueId}/assignee`, {
      method: "PUT",
      body: { assigneeId },
    });
    return (await this.getIssue(projectId, issueId)).issue;
  }

  async transitionIssue(projectId: string, issueId: string, toStatus: IssueStatus): Promise<Issue> {
    await this.request<Issue>(`/projects/${projectId}/issues/${issueId}/transitions`, {
      method: "POST",
      body: { toStatus },
    });
    return (await this.getIssue(projectId, issueId)).issue;
  }

  async deleteIssue(projectId: string, issueId: string): Promise<void> {
    await this.request<void>(`/projects/${projectId}/issues/${issueId}`, {
      method: "DELETE",
    });
  }

  listNotifications(): Promise<Page<Notification>> {
    return this.request<Page<Notification>>("/notifications");
  }

  markNotificationRead(notificationId: string): Promise<Notification> {
    return this.request<Notification>(`/notifications/${notificationId}/read`, {
      method: "PATCH",
    });
  }

  markAllNotificationsRead(): Promise<{ updatedCount: number }> {
    return this.request<{ updatedCount: number }>("/notifications/read-all", {
      method: "PATCH",
    });
  }

  private setTokens(tokens: AuthTokens) {
    this.accessToken = tokens.accessToken;
    this.refreshTokenValue = tokens.refreshToken;
    window.localStorage.setItem("taska.accessToken", tokens.accessToken);
    window.localStorage.setItem("taska.refreshToken", tokens.refreshToken);
  }

  private clearTokens() {
    this.accessToken = null;
    this.refreshTokenValue = null;
    window.localStorage.removeItem("taska.accessToken");
    window.localStorage.removeItem("taska.refreshToken");
  }

  private tryRefresh(): Promise<boolean> {
    this.refreshInFlight ??= this.refresh()
      .then(() => true)
      .catch(() => {
        this.clearTokens();
        return false;
      })
      .finally(() => {
        this.refreshInFlight = null;
      });
    return this.refreshInFlight;
  }

  private query(search: URLSearchParams) {
    const value = search.toString();
    return value ? `?${value}` : "";
  }

  private async request<T>(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      skipAuth?: boolean;
    } = {},
    isRetry = false,
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(!options.skipAuth && this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (response.status === 401 && !options.skipAuth && !isRetry && this.refreshTokenValue) {
      if (await this.tryRefresh()) {
        return this.request<T>(path, options, true);
      }
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const data = (await response.json().catch(() => undefined)) as T | ApiErrorBody | undefined;
    if (!response.ok) {
      const body = data as ApiErrorBody | undefined;
      const message = body?.message ?? body?.error?.message ?? `Request failed with ${response.status}`;
      const code = body?.code ?? body?.error?.code ?? "UNKNOWN";
      const requestId = response.headers.get("X-Request-Id") ?? body?.error?.requestId;
      throw new ApiError(message, code, response.status, requestId ?? undefined);
    }
    return data as T;
  }
}
