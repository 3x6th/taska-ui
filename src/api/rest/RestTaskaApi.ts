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
  IssueHistoryEvent,
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

type RestIssue = Omit<Issue, "assigneeId" | "deletedAt"> & {
  assigneeId?: string | null;
  deletedAt?: string | null;
};

type RestIssueHistoryEvent = Omit<IssueHistoryEvent, "issueId">;

interface RestIssueWithHistory {
  issue: RestIssue;
  history: RestIssueHistoryEvent[];
}

interface RestIssueListItem {
  id: string;
  issueKey: string;
  summary: string;
  issueType: IssueType;
  priority: Issue["priority"];
  assigneeId?: string | null;
}

interface RestListIssuesResponse {
  items: RestIssueListItem[];
  totalCount: number;
}

interface RestUpdateIssueResponse {
  id: string;
  summary: string;
  description: string;
  priority: Issue["priority"];
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
  private authVersion = 0;

  private readonly baseUrl: string;

  constructor(baseUrl = "/api/v1") {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  async login(input: LoginInput): Promise<AuthTokens> {
    const authVersion = ++this.authVersion;
    const tokens = await this.request<AuthTokens>("/auth/login", {
      method: "POST",
      body: input,
      skipAuth: true,
    });
    if (authVersion === this.authVersion) {
      this.setTokens(tokens);
    }
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
    const authVersion = this.authVersion;
    const tokens = await this.request<AuthTokens>("/auth/refresh", {
      method: "POST",
      body: { refreshToken },
      skipAuth: true,
    });
    if (authVersion === this.authVersion) {
      this.setTokens(tokens);
    }
    return tokens;
  }

  async logout(): Promise<void> {
    this.authVersion += 1;
    this.clearTokens();
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

  async listIssues(projectId: string, params: ListIssuesParams = {}): Promise<Page<Issue>> {
    const search = new URLSearchParams();
    if (params.status) search.set("status", params.status);
    if (params.assigneeId) search.set("assigneeId", params.assigneeId);
    if (params.page !== undefined) search.set("page", String(params.page));
    if (params.pageSize !== undefined) search.set("pageSize", String(params.pageSize));
    const response = await this.request<RestListIssuesResponse>(
      `/projects/${this.segment(projectId)}/issues${this.query(search)}`,
    );

    // The gateway list DTO omits fields required by the board (including status),
    // so hydrate the page with the detail endpoint until the REST contract grows.
    const items = await mapWithConcurrency(response.items, 6, async (item) => {
      const details = await this.getIssue(projectId, item.id);
      return details.issue;
    });

    return {
      items,
      page: params.page ?? 0,
      pageSize: params.pageSize ?? items.length,
      totalCount: response.totalCount,
    };
  }

  async getIssue(_projectId: string, issueId: string): Promise<IssueWithHistory> {
    const response = await this.request<RestIssueWithHistory>(`/issues/${this.segment(issueId)}`);
    return this.toIssueWithHistory(response);
  }

  async createIssue(projectId: string, input: CreateIssueInput): Promise<Issue> {
    const response = await this.request<RestIssue>(`/projects/${this.segment(projectId)}/issues`, {
      method: "POST",
      body: input,
      headers: {
        "Idempotency-Key": this.createIdempotencyKey(),
      },
    });
    return this.toIssue(response);
  }

  async updateIssue(projectId: string, issueId: string, input: UpdateIssueInput): Promise<Issue> {
    const current = (await this.getIssue(projectId, issueId)).issue;
    const updated = await this.request<RestUpdateIssueResponse>(`/issues/${this.segment(issueId)}`, {
      method: "PUT",
      body: {
        summary: input.summary ?? current.summary,
        description: input.description ?? current.description,
        priority: input.priority ?? current.priority,
      },
    });
    return {
      ...current,
      ...updated,
      updatedAt: new Date().toISOString(),
    };
  }

  async assignIssue(_projectId: string, issueId: string, assigneeId: string | null): Promise<Issue> {
    if (!assigneeId) {
      throw new ApiError("The current API contract does not support clearing an assignee", "UNSUPPORTED_OPERATION", 400);
    }
    const response = await this.request<RestIssue>(`/issues/${this.segment(issueId)}/assignee`, {
      method: "PUT",
      body: { assigneeId },
    });
    return this.toIssue(response);
  }

  async transitionIssue(_projectId: string, issueId: string, transitionId: string): Promise<Issue> {
    const response = await this.request<RestIssueWithHistory>(
      `/issues/${this.segment(issueId)}/transition/${this.segment(transitionId)}`,
      {
        method: "PUT",
      },
    );
    return this.toIssue(response.issue);
  }

  async deleteIssue(_projectId: string, issueId: string): Promise<void> {
    await this.request<void>(`/issues/${this.segment(issueId)}`, {
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

  private segment(value: string) {
    return encodeURIComponent(value);
  }

  private createIdempotencyKey() {
    return globalThis.crypto?.randomUUID?.() ?? `taska-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  private toIssue(issue: RestIssue): Issue {
    return {
      ...issue,
      assigneeId: issue.assigneeId || null,
      deletedAt: issue.deletedAt ?? null,
    };
  }

  private toIssueWithHistory(response: RestIssueWithHistory): IssueWithHistory {
    const issue = this.toIssue(response.issue);
    return {
      issue,
      history: response.history.map((event) => ({
        ...event,
        issueId: issue.id,
      })),
    };
  }

  private async request<T>(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      skipAuth?: boolean;
      headers?: Record<string, string>;
    } = {},
    isRetry = false,
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers: {
        Accept: "application/json",
        ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(!options.skipAuth && this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
        ...options.headers,
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
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

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index], index);
    }
  });

  await Promise.all(workers);
  return results;
}
