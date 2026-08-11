import type {
  AcceptInvitationInput,
  AuthTokens,
  CreateIssueInput,
  CreateIssueLinkInput,
  CreateProjectInput,
  ListCommentsParams,
  ListIssuesParams,
  ListNotificationsParams,
  LoginInput,
  TaskaApi,
  UpdateIssueInput,
} from "../TaskaApi";
import { SessionExpiredSignal } from "../session";
import type {
  AdminCatalog,
  AdminPagination,
  AdminRow,
  AdminRowQuery,
  AdminRows,
  AdminRowsMeta,
  AdminRowsQuery,
  AdminService,
  AdminTable,
  GlobalRole,
  Issue,
  IssueComment,
  IssueLink,
  IssueType,
  IssueWithHistory,
  Notification,
  Page,
  Project,
  ProjectMember,
  ProjectMembership,
  User,
  UserStatus,
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

// GET /users/me answers with ValidateAccessTokenResponseDto. `globalRole` is
// read as `unknown` rather than as the enum: the field is optional on older
// deployments, its contract includes the proto zero value UNSPECIFIED, and a
// backend is free to grow values this build has never heard of. Narrowing it
// here is what keeps an unrecognised string out of the UI.
interface RestUser {
  id: string;
  login: string;
  email: string;
  displayName: string;
  status: UserStatus;
  color?: string;
  globalRole?: unknown;
}

/**
 * `GET /readonly/{service}/{table}` — `data` on the wire, `rows` in the domain.
 * Every field is optional because the contract marks none of them required, and
 * this is the one endpoint family in the codebase that has never returned a
 * byte to us: typing it as guaranteed would be a claim, not a fact.
 */
interface RestAdminRows {
  data?: AdminRow[];
  pagination?: Partial<AdminPagination>;
  meta?: Partial<AdminRowsMeta>;
}

/** `GET /readonly/{service}/{table}/{id}` — one row under the same `data` key. */
interface RestAdminRow {
  data?: AdminRow;
}

/** `GET /readonly/catalog`, with the same caveat. */
interface RestAdminCatalog {
  services?: (Partial<Omit<AdminService, "tables">> & { tables?: AdminTable[] })[];
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

/**
 * `IssueLinkResponseDto`. Every field is read as optional because the schema
 * declares no `required` block, and `viewLinkType` is read as `unknown` for the
 * same reason `globalRole` is: the contract types it as a bare string with no
 * enum, so this build cannot know the value set. Unlike `globalRole` it is not
 * narrowed to a domain enum — see `IssueLink` in src/domain/types.ts — only
 * proved to be a string before it reaches a component.
 */
interface RestIssueLink {
  id?: string;
  projectId?: string;
  sourceIssueId?: string;
  targetIssueId?: string;
  viewLinkType?: unknown;
  createdBy?: string;
  createdAt?: string;
}

interface RestListIssueLinksResponse {
  items?: RestIssueLink[];
}

type RestComment = Omit<IssueComment, "updatedAt"> & {
  updatedAt?: string | null;
};

interface RestCommentsListResponse {
  items: RestComment[];
  totalCount: number;
}

type RestNotification = Omit<Notification, "userId" | "link"> & {
  userId?: string;
  link?: string | null;
};

interface RestNotificationListResponse {
  items: RestNotification[];
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
  private readonly sessionExpired = new SessionExpiredSignal();

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
    // Deliberately clearTokens() and not expireSession(): signing out is the
    // user's own doing and already navigates. Announcing "your session expired"
    // here would put a false explanation on the login screen.
    this.clearTokens();
  }

  async getCurrentUser(): Promise<User> {
    const response = await this.request<RestUser>("/users/me");
    return this.toUser(response);
  }

  hasSession(): boolean {
    // `||`, not `??`: an empty-string access token is not a credential, and with
    // `??` it would hide a refresh token that could still revive the session.
    return Boolean(this.accessToken || this.refreshTokenValue);
  }

  onSessionExpired(listener: () => void): () => void {
    return this.sessionExpired.subscribe(listener);
  }

  async listProjects(): Promise<Project[]> {
    try {
      const response = await this.request<{ items: Project[] }>("/projects");
      return response.items;
    } catch (error) {
      // project-service currently reports an empty collection as NOT_FOUND.
      // Keep the UI onboarding flow usable until the backend returns 200 [].
      if (error instanceof ApiError && error.status === 404) {
        return [];
      }
      throw error;
    }
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
    search.set("issueType", issueType ?? "TASK");
    return this.request<Workflow>(`/projects/${this.segment(projectId)}/workflow${this.query(search)}`);
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

  async listIssueLinks(_projectId: string, issueId: string): Promise<IssueLink[]> {
    const response = await this.request<RestListIssueLinksResponse>(this.linksPath(issueId));
    return (response.items ?? []).map((link) => this.toIssueLink(link));
  }

  async createIssueLink(_projectId: string, issueId: string, input: CreateIssueLinkInput): Promise<IssueLink> {
    const response = await this.request<RestIssueLink>(this.linksPath(issueId), {
      method: "POST",
      // `linkType`, not `viewLinkType`: the request enum and the response field
      // are different fields by the contract's own spelling.
      body: { targetIssueId: input.targetIssueId, linkType: input.linkType },
    });
    return this.toIssueLink(response);
  }

  async deleteIssueLink(_projectId: string, issueId: string, linkId: string): Promise<void> {
    await this.request<void>(`${this.linksPath(issueId)}/${this.segment(linkId)}`, {
      method: "DELETE",
    });
  }

  async listComments(projectId: string, issueId: string, params: ListCommentsParams = {}): Promise<Page<IssueComment>> {
    const search = new URLSearchParams();
    if (params.page !== undefined) search.set("page", String(params.page));
    if (params.pageSize !== undefined) search.set("pageSize", String(params.pageSize));

    const response = await this.request<RestCommentsListResponse>(
      `${this.commentsPath(projectId, issueId)}${this.query(search)}`,
    );
    return {
      items: response.items.map((comment) => this.toComment(comment)),
      page: params.page ?? 0,
      pageSize: params.pageSize ?? response.items.length,
      totalCount: response.totalCount,
    };
  }

  async addComment(projectId: string, issueId: string, body: string): Promise<IssueComment> {
    const response = await this.request<RestComment>(this.commentsPath(projectId, issueId), {
      method: "POST",
      body: { body },
    });
    return this.toComment(response);
  }

  async updateComment(projectId: string, issueId: string, commentId: string, body: string): Promise<IssueComment> {
    const response = await this.request<RestComment>(
      `${this.commentsPath(projectId, issueId)}/${this.segment(commentId)}`,
      {
        method: "PUT",
        body: { body },
      },
    );
    return this.toComment(response);
  }

  async deleteComment(projectId: string, issueId: string, commentId: string): Promise<void> {
    await this.request<void>(`${this.commentsPath(projectId, issueId)}/${this.segment(commentId)}`, {
      method: "DELETE",
    });
  }

  async listNotifications(params: ListNotificationsParams = {}): Promise<Page<Notification>> {
    const search = new URLSearchParams();
    if (params.unreadOnly !== undefined) search.set("unreadOnly", String(params.unreadOnly));
    if (params.pageSize !== undefined) search.set("pageSize", String(params.pageSize));
    if (params.offset !== undefined) search.set("offset", String(params.offset));

    const response = await this.request<RestNotificationListResponse>(`/notifications${this.query(search)}`);
    return {
      items: response.items.map((notification) => this.toNotification(notification)),
      pageSize: params.pageSize ?? 20,
      offset: params.offset ?? 0,
    };
  }

  async markNotificationRead(notificationId: string): Promise<Notification> {
    const response = await this.request<RestNotification>(
      `/notifications/${this.segment(notificationId)}/read`,
      {
        method: "PATCH",
      },
    );
    return this.toNotification(response);
  }

  async markAllNotificationsRead(): Promise<{ updatedCount: number }> {
    let updatedCount = 0;

    while (true) {
      const page = await this.listNotifications({ unreadOnly: true, pageSize: 100, offset: 0 });
      if (page.items.length === 0) break;

      await mapWithConcurrency(page.items, 6, (notification) => this.markNotificationRead(notification.id));
      updatedCount += page.items.length;

      if (page.items.length < 100) break;
    }

    return { updatedCount };
  }

  async getAdminCatalog(): Promise<AdminCatalog> {
    const response = await this.request<RestAdminCatalog>("/readonly/catalog");
    // The contract marks nothing in this response required, and the gateway's
    // own mapper emits an empty object when it has no catalog. Screens read
    // these lists by walking them, so a missing one is a render crash — and
    // with no error boundary in this app that is a blank page, not a blank
    // console.
    return {
      services: (response.services ?? []).map((service) => ({
        ...service,
        name: service.name ?? "",
        databaseAlias: service.databaseAlias ?? "",
        tables: (service.tables ?? []).map((table) => ({ ...table, columns: table.columns ?? [] })),
      })),
    };
  }

  listAdminRows(query: AdminRowsQuery): Promise<AdminRows> {
    const search = new URLSearchParams();
    // The one place in the app where the page basis changes. The wire is
    // 0-based (`minimum: 0, default: 0`) and so is `pagination.currentPage`;
    // the domain, the URL, the pager and the mock are all 1-based, because
    // `/admin/data/x/y?page=2` links are already shared and have to keep
    // meaning the second page. Converting here rather than at every caller
    // makes the mismatch one fact in one file — this `- 1` is the conversion,
    // not an off-by-one.
    if (query.page !== undefined) search.set("page", String(Math.max(0, query.page - 1)));
    if (query.pageSize !== undefined) search.set("pageSize", String(query.pageSize));
    if (query.sort) search.set("sort", query.sort);
    if (query.order) search.set("order", query.order);

    for (const filter of query.filters ?? []) {
      // Empty means "no filter", not "match the empty string" — an input the
      // user cleared must not narrow the table to nothing. The gateway agrees
      // in the strongest way available to it: a blank value is a 400.
      if (filter.value === "") continue;
      // Always `column.operator`. The gateway splits on the last dot and
      // rejects both a key with no operator and an operator it does not know,
      // so there is exactly one spelling — and a column called `page` becomes
      // `page.equals`, which can no longer collide with the paging keys.
      search.set(`${filter.column}.${filter.operator}`, filter.value);
    }

    return this.request<RestAdminRows>(
      `/readonly/${this.segment(query.service)}/${this.segment(query.table)}${this.query(search)}`,
    ).then((response) => ({
      // `data` on the wire, `rows` in the domain: "data" says nothing at the
      // call site, and every field of this response is data.
      rows: response.data ?? [],
      pagination: this.toPagination(response.pagination, query, response.data?.length ?? 0),
      meta: {
        // A server that does not echo which table this is leaves us with what
        // we asked for, which is the only honest answer available and keeps the
        // response joinable against the catalog.
        service: response.meta?.service ?? query.service,
        table: response.meta?.table ?? query.table,
        // The contract declares none of these as required, and the table cannot
        // render a header from a missing list. An empty one is honest — no
        // columns stated — and the screen already handles it.
        columns: response.meta?.columns ?? [],
        sortableColumns: response.meta?.sortableColumns ?? [],
        filterableColumns: response.meta?.filterableColumns ?? [],
      },
    }));
  }

  async getAdminRow(query: AdminRowQuery): Promise<AdminRow> {
    const response = await this.request<RestAdminRow>(
      `/readonly/${this.segment(query.service)}/${this.segment(query.table)}/${this.segment(query.id)}`,
    );
    // A 200 with no `data` is not "no such row" — the server would have said
    // 404 for that, and the card has its own words for it. An empty row renders
    // as a card of dashes, which is what "the server returned nothing about
    // this row" honestly looks like.
    return response.data ?? {};
  }

  /**
   * The wire's pagination on the domain's 1-based page, field by field: the
   * contract marks none of them required, and an all-or-nothing fallback would
   * turn one missing field into a fabricated single page.
   */
  private toPagination(
    wire: Partial<AdminPagination> | undefined,
    query: AdminRowsQuery,
    rowCount: number,
  ): AdminPagination {
    return {
      // The `+ 1` half of the conversion above. Where the server said nothing,
      // the caller's own page is already 1-based and needs no move.
      //
      // `!= null`, like every sibling's `??`: nothing in the contract forbids a
      // JSON `null` here, and `null + 1` is 1 — a footer reading "Page 1 of 5"
      // over page 3's rows, with the pager then stepping from the wrong number.
      currentPage: wire?.currentPage != null ? wire.currentPage + 1 : (query.page ?? 1),
      pageSize: wire?.pageSize ?? query.pageSize ?? rowCount,
      totalRows: wire?.totalRows ?? rowCount,
      totalPages: wire?.totalPages ?? 1,
      // Basis-independent, so they pass through as stated.
      hasNext: wire?.hasNext ?? false,
      hasPrev: wire?.hasPrev ?? false,
    };
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

  /**
   * Idempotent on purpose. A board screen fires six queries in parallel and each
   * one can come back 401, so the session dies once and the listeners hear about
   * it once. With nothing left to lose there is nothing to announce either.
   *
   * `authVersion` is the session the caller was talking about, the same guard
   * `login`/`refresh` put on `setTokens`: a 401 that arrives after the user has
   * signed out and signed back in belongs to a session that is already gone, and
   * killing the fresh one on its behalf would throw the user back to the login
   * form reading "your session expired" about a session that just worked.
   */
  private expireSession(authVersion = this.authVersion) {
    if (authVersion !== this.authVersion) return;
    if (!this.accessToken && !this.refreshTokenValue) return;
    this.clearTokens();
    this.sessionExpired.emit();
  }

  private tryRefresh(): Promise<boolean> {
    const authVersion = this.authVersion;
    this.refreshInFlight ??= this.refresh()
      .then(() => true)
      .catch(() => {
        this.expireSession(authVersion);
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

  private linksPath(issueId: string) {
    return `/issues/${this.segment(issueId)}/links`;
  }

  private commentsPath(projectId: string, issueId: string) {
    return `/projects/${this.segment(projectId)}/issues/${this.segment(issueId)}/comments`;
  }

  private createIdempotencyKey() {
    return globalThis.crypto?.randomUUID?.() ?? `taska-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  private toUser(user: RestUser): User {
    return {
      id: user.id,
      login: user.login,
      email: user.email,
      displayName: user.displayName,
      status: user.status,
      color: user.color,
      globalRole: toGlobalRole(user.globalRole),
    };
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

  /**
   * Passes `viewLinkType` through untouched whenever it is a string, including
   * values this build has never heard of — that is the whole point of the
   * field. A non-string (or an absent one) becomes the empty string, which the
   * label helper renders as "Linked" rather than inventing a relation.
   */
  private toIssueLink(link: RestIssueLink): IssueLink {
    return {
      id: link.id ?? "",
      projectId: link.projectId ?? "",
      sourceIssueId: link.sourceIssueId ?? "",
      targetIssueId: link.targetIssueId ?? "",
      viewLinkType: typeof link.viewLinkType === "string" ? link.viewLinkType : "",
      createdBy: link.createdBy ?? "",
      createdAt: link.createdAt ?? "",
    };
  }

  private toComment(comment: RestComment): IssueComment {
    return {
      ...comment,
      updatedAt: comment.updatedAt ?? null,
    };
  }

  private toNotification(notification: RestNotification): Notification {
    return {
      ...notification,
      userId: notification.userId ?? "",
      link: notification.link ?? "",
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
    // Captured before the request leaves: whatever comes back answers *this*
    // session, not whichever one is current when the response finally lands.
    const authVersion = this.authVersion;
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

    // Every way a 401 can end without a usable session goes through
    // expireSession(): no refresh token at all, a refresh that failed, and a
    // retry that came back 401 again. Each of those used to fall through
    // silently and leave the UI signed out with no way to say so.
    if (response.status === 401 && !options.skipAuth) {
      if (!isRetry && this.refreshTokenValue && (await this.tryRefresh())) {
        return this.request<T>(path, options, true);
      }
      this.expireSession(authVersion);
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

/**
 * The only two roles the domain knows. Everything else — the field missing, the
 * contract's UNSPECIFIED zero value, a role added after this build, a number
 * where a string was promised — means the same thing: the server did not state
 * a role we can act on, so we say we do not know instead of passing the raw
 * value up for a component to render or compare against.
 */
function toGlobalRole(value: unknown): GlobalRole | undefined {
  return value === "USER" || value === "GLOBAL_ADMIN" ? value : undefined;
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
