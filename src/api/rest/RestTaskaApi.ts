import type {
  AcceptInvitationInput,
  AuthTokens,
  ConfirmAttachmentUploadInput,
  CreateAttachmentUploadUrlInput,
  CreateIssueInput,
  CreateIssueLinkInput,
  CreateProjectInput,
  CreateProjectLabelInput,
  ListCommentsParams,
  ListIssuesParams,
  ListNotificationsParams,
  LoginInput,
  SearchIssuesParams,
  TaskaApi,
  UpdateIssueInput,
  UpdateProjectLabelInput,
} from "../TaskaApi";
import {
  ADMIN_WRITE_REASON_MAX_LENGTH,
  ADMIN_WRITE_REASON_REQUIRED_MESSAGE,
  ADMIN_WRITE_REASON_TOO_LONG_MESSAGE,
  SEARCH_QUERY_MIN_LENGTH,
  SEARCH_QUERY_TOO_SHORT_MESSAGE,
} from "../TaskaApi";
import {
  ATTACHMENT_STORE_REJECTED_CODE,
  ATTACHMENT_STORE_UNREACHABLE_CODE,
  AttachmentStoreError,
  attachmentRefusal,
  attachmentRefusalKind,
  requireUsableUploadUrl,
} from "../attachments";
import type { PlanningFieldsInput, StoredPlanningDates } from "../planningFields";
import {
  emptyPlanningFields,
  planningFieldRefusal,
  planningFieldsBody,
  resolvePlanningFields,
} from "../planningFields";
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
  AttachmentDownloadUrl,
  AttachmentUploadTicket,
  DateOnly,
  GlobalRole,
  Issue,
  IssueAttachment,
  IssueComment,
  IssueLink,
  IssueSearchHit,
  IssueType,
  IssueWithHistory,
  Label,
  Notification,
  Page,
  ProblematicOutboxCounts,
  ProblematicOutboxEvent,
  ProblematicOutboxSummary,
  Project,
  ProjectLabel,
  ProjectMember,
  ProjectMembership,
  User,
  UserStatus,
  UserStatusChange,
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

/**
 * `UserStatusResponseDto` — what all three admin user writes answer with.
 *
 * Fields are typed as present, unlike the `/readonly` family above, because the
 * contract declares this schema's four properties as required, with an enum on
 * the two statuses — the same standing `RestUser.status` has.
 *
 * `changedAt` is the wire's own spelling
 * (`AdminUserManagementMapper.setChangedAt`, and `changedAt` in the DTO's
 * `required` list). It was read here as `updatedAt` until TAS-188, which is a
 * failure that would have shown up as `undefined` in a field typed `string` and
 * as nothing at all on screen. It is read and carried and never drawn; see
 * `UserStatusChange` for why the refetched row is what carries the timestamp.
 */
interface RestUserStatusChange {
  userId: string;
  previousStatus: UserStatus;
  currentStatus: UserStatus;
  changedAt: string;
}

/** `GET /readonly/catalog`, with the same caveat. */
interface RestAdminCatalog {
  services?: (Partial<Omit<AdminService, "tables">> & { tables?: AdminTable[] })[];
}

/**
 * `GET /readonly/outbox/problematic-summary` —
 * `ProblematicOutboxEventsSummaryResponseDto` and its two item schemas. Every
 * field is optional for the same reason the reads above are: the contract
 * declares no `required` block anywhere in this family, and this endpoint has
 * additionally never answered this client (docs/ai/API-DIVERGENCE.md), so a
 * guaranteed field here would be a claim rather than a fact.
 */
interface RestProblematicOutboxSummary {
  events?: Partial<ProblematicOutboxEvent>[];
  counts?: Partial<ProblematicOutboxCounts>[];
  notAllShown?: boolean;
}

type RestIssue = Omit<
  Issue,
  | "assigneeId"
  | "deletedAt"
  | "labels"
  | "storyPoints"
  | "startDate"
  | "dueDate"
  | "originalEstimateMinutes"
  | "remainingEstimateMinutes"
> & {
  assigneeId?: string | null;
  deletedAt?: string | null;
  // Absent on every gateway built before TAS-120, and absent again the moment
  // this app talks to one. `toIssue` turns that into `[]` so no card has to.
  labels?: RestLabel[];
  // The five planning fields, restated as optional rather than inherited as
  // required. `Issue` promises them because the domain does; the *wire* does
  // not, and will not until backend PR #148 deploys — until then every response
  // this adapter reads is missing all five. Inheriting them as required would
  // be a promise about a gateway that has never sent them, and `toIssue` would
  // then be typed as if it had nothing to fold.
  storyPoints?: number | null;
  startDate?: DateOnly | null;
  dueDate?: DateOnly | null;
  originalEstimateMinutes?: number | null;
  remainingEstimateMinutes?: number | null;
};

/**
 * `IssueLabelResponseDto` — the three fields a label has when an *issue* is
 * carrying it, and `ProjectLabelResponseDto`'s first three as well. Optional
 * throughout because neither schema declares a `required` block, which is the
 * same reading `RestIssueLink` gets and for the same reason.
 */
interface RestLabel {
  id?: string;
  name?: string;
  color?: string;
}

interface RestProjectLabel extends RestLabel {
  projectId?: string;
  createdBy?: string;
  createdAt?: string;
  deletedAt?: string | null;
}

interface RestListProjectLabelsResponse {
  items?: RestProjectLabel[];
  totalCount?: number;
}

interface RestListIssueLabelsResponse {
  items?: RestLabel[];
  totalCount?: number;
}

type RestIssueHistoryEvent = Omit<IssueHistoryEvent, "issueId">;

interface RestIssueWithHistory {
  issue: RestIssue;
  history: RestIssueHistoryEvent[];
}

/**
 * `IssueShortResponseDto`, which since TAS-195 is the *search* DTO and nothing
 * else — hence the name. It used to be called `RestIssueListItem` and used by
 * both response types below, until `ListIssuesResponseDto.items` became
 * `IssueResponseDto` and the list stopped being short.
 */
interface RestIssueShortItem {
  id: string;
  issueKey: string;
  summary: string;
  issueType: IssueType;
  priority: Issue["priority"];
  assigneeId?: string | null;
  // The only planning field `IssueShortResponseDto` grows in backend PR #148.
  // No dates and no estimates: see `IssueSearchHit` in src/domain/types.ts for
  // why this must not be widened to match `RestIssue` above.
  storyPoints?: number | null;
}

/**
 * `ListIssuesResponseDto`, whose `items` is a whole `IssueResponseDto` — the
 * same schema `GET /issues/{issueId}` answers with, `status` and `labels`
 * included. Measured on the deployed gateway on 2026-09-08 rather than read
 * off the contract, because the two have disagreed here before: every row of
 * `GET /projects/{id}/issues?page=0&pageSize=3` carried all fifteen fields,
 * `status` as a key and `labels` populated. That measurement is what let
 * TAS-195 delete the per-row hydration `listIssues` used to pay.
 */
interface RestListIssuesResponse {
  items: RestIssue[];
  totalCount: number;
}

/**
 * `SearchIssuesResponseDto`. Two fields with the same names as
 * `ListIssuesResponseDto` above, and deliberately not an alias for it: they are
 * two schemas in the contract, and one name would hide the day either of them
 * grows a field.
 *
 * That day was TAS-195. The list's `items` became `IssueResponseDto` and this
 * one stayed `IssueShortResponseDto` (openapi.yml, `SearchIssuesResponseDto`),
 * so the shared `RestIssueListItem` split in two rather than widening a search
 * hit into an issue it never was.
 *
 * Both fields are `required` here, which the list response's schema still does
 * not say.
 */
interface RestSearchIssuesResponse {
  items: RestIssueShortItem[];
  totalCount: number;
}

interface RestUpdateIssueResponse {
  id: string;
  summary: string;
  description: string;
  priority: Issue["priority"];
  // `UpdateIssueResponseDto` carries all five after backend PR #148 and none of
  // them before it, and even afterwards it states only the ones that are set —
  // the gateway's mapper writes a field only when the proto optional is
  // present. So an absent key here is "not set", never "unchanged", which is
  // what `updateIssue` folds against the value it just sent.
  storyPoints?: number | null;
  startDate?: DateOnly | null;
  dueDate?: DateOnly | null;
  originalEstimateMinutes?: number | null;
  remainingEstimateMinutes?: number | null;
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

/**
 * `IssueAttachmentDto`. Optional throughout, like `RestIssueLink` above and for
 * the same reason: the extract in `docs/contract/pending/pr-147-TAS-131.yml`
 * does mark seven of the eight `required`, but this endpoint family has never
 * answered this client — it is not on the deployed gateway — so a field typed
 * as guaranteed here would be a claim rather than a measurement. `toAttachment`
 * turns each blank into the domain's own spelling of "not stated".
 */
interface RestIssueAttachment {
  id?: string;
  issueId?: string;
  fileName?: string;
  contentType?: string;
  sizeBytes?: number;
  uploadedBy?: string;
  checksum?: string | null;
  createdAt?: string;
}

interface RestListAttachmentsResponse {
  items?: RestIssueAttachment[];
}

interface RestAttachmentUploadTicket {
  uploadUrl?: string;
  objectKey?: string;
}

interface RestAttachmentDownloadUrl {
  downloadUrl?: string;
  checksum?: string | null;
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
    if (params.labelId) search.set("labelId", params.labelId);
    if (params.page !== undefined) search.set("page", String(params.page));
    if (params.pageSize !== undefined) search.set("pageSize", String(params.pageSize));
    const response = await this.request<RestListIssuesResponse>(
      `/projects/${this.segment(projectId)}/issues${this.query(search)}`,
    );

    // One request per page, and the same mapping the detail read uses, because
    // the list and the detail answer with the same DTO. Until TAS-195 this
    // followed the list with `GET /issues/{issueId}` per row at concurrency 6 —
    // up to a hundred extra requests for the board's `pageSize: 100` — because
    // `ListIssuesResponseDto.items` was the short DTO and a kanban card cannot
    // choose a column without `status`. It is `IssueResponseDto` now, measured
    // on the deployed gateway (see `RestListIssuesResponse`), so the reason is
    // gone. Nothing else went with it: `getIssue` still backs the issue panel,
    // and the fan-out was the multiplier that made TAS-139 fail a whole board.
    //
    // `?? []` because `ListIssuesResponseDto` declares no `required` block, so
    // a `200` with no `items` at all is a legal answer to this route — the
    // opposite of `SearchIssuesResponseDto` below, which requires both fields
    // and is still read defensively. Unguarded, a body of `{ totalCount: 0 }`
    // rejects with a `TypeError`: no `code`, no `requestId`, nothing
    // `apiErrorFacts` can name, and a board that reports an unreadable failure
    // where an empty page was meant.
    const items = (response.items ?? []).map((item) => this.toIssue(item));

    return {
      items,
      page: params.page ?? 0,
      pageSize: params.pageSize ?? items.length,
      totalCount: response.totalCount,
    };
  }

  /**
   * `GET /issues/search`. The whole of the compensation for TAS-180 lives in
   * the first three lines: a `query` the runtime would refuse never leaves this
   * process, and an absent one is *omitted* rather than sent empty — the
   * gateway answers `400` for `query=` and `200` for no `query` at all, so the
   * obvious implementation, which sets the parameter on every keystroke, turns
   * a cleared field into an error.
   *
   * The enum filters are typed, never stringly passed through: an unrecognised
   * `priority` or `issueType` is silently ignored by the runtime and answers
   * with a *wider* set than the one asked for.
   */
  async searchIssues(params: SearchIssuesParams): Promise<Page<IssueSearchHit>> {
    const query = requireSearchQuery(params.query);
    const search = new URLSearchParams();
    if (query !== null) search.set("query", query);
    if (params.projectId) search.set("projectId", params.projectId);
    if (params.statusKey) search.set("statusKey", params.statusKey);
    if (params.assigneeId) search.set("assigneeId", params.assigneeId);
    if (params.reporterId) search.set("reporterId", params.reporterId);
    if (params.priority) search.set("priority", params.priority);
    if (params.issueType) search.set("issueType", params.issueType);
    if (params.page !== undefined) search.set("page", String(params.page));
    if (params.pageSize !== undefined) search.set("pageSize", String(params.pageSize));

    const response = await this.request<RestSearchIssuesResponse>(`/issues/search${this.query(search)}`);
    // No hydration, on purpose, and the reason outlived the N+1 in `listIssues`
    // above: the search DTO is still `IssueShortResponseDto`, so filling in a
    // status here would mean a `getIssue` per hit on every keystroke. The owner
    // settled that on 2026-08-23 — fix the backend, do not hydrate on the
    // frontend (docs/ai/API-DIVERGENCE.md, TAS-178). A hit stays as short as
    // the contract made it.
    const items = (response.items ?? []).map((item) => this.toIssueSearchHit(item));
    return {
      items,
      page: params.page ?? 0,
      pageSize: params.pageSize ?? items.length,
      totalCount: response.totalCount,
    };
  }

  /**
   * The project is not on the wire for this read — the route is
   * `/issues/{issueId}` — so this is `getIssueById` with an argument the
   * gateway never sees. It stays in the signature because the mock does need
   * it; see `TaskaApi.getIssueById`.
   */
  getIssue(_projectId: string, issueId: string): Promise<IssueWithHistory> {
    return this.getIssueById(issueId);
  }

  async getIssueById(issueId: string): Promise<IssueWithHistory> {
    const response = await this.request<RestIssueWithHistory>(`/issues/${this.segment(issueId)}`);
    return this.toIssueWithHistory(response);
  }

  /**
   * The body is built key by key rather than by passing `input` through: the
   * five planning fields have to be omitted when they are not set, and a
   * create has nothing to resolve them against, so `null` and `undefined`
   * collapse to the same omission here.
   */
  async createIssue(projectId: string, input: CreateIssueInput): Promise<Issue> {
    refusePlanningFields(input, null);
    const response = await this.request<RestIssue>(`/projects/${this.segment(projectId)}/issues`, {
      method: "POST",
      body: {
        issueType: input.issueType,
        summary: input.summary,
        description: input.description,
        priority: input.priority,
        ...planningFieldsBody(resolvePlanningFields(input, emptyPlanningFields())),
      },
      headers: {
        "Idempotency-Key": this.createIdempotencyKey(),
      },
    });
    return this.toIssue(response);
  }

  /**
   * Read, modify, write — and the read is load-bearing rather than defensive.
   * `PUT /issues/{issueId}` replaces the whole issue: the three required fields
   * have always had to be re-sent, and since TAS-115 the five planning fields
   * do too, because a field the request omits is erased on the server rather
   * than preserved (see `UpdateIssueInput` and src/api/planningFields.ts).
   *
   * So every value the caller did not state is resolved from `current` and sent
   * back unchanged, which makes the write a no-op for the fields nobody
   * touched. A resolved `null` is *omitted* from the body, because omission is
   * how this contract spells "not set" — which is also why, against a gateway
   * that does not carry the planning fields yet, this sends the same three keys
   * it always did and changes nothing on the wire.
   *
   * The refusals are checked against the values the caller supplied and against
   * the issue as stored, before the request, so mock and rest answer a bad
   * value identically. What is *not* checked is the resolved pair: an issue
   * whose stored dates already disagree must still be editable by its summary,
   * and the server is the one entitled to refuse that.
   */
  async updateIssue(projectId: string, issueId: string, input: UpdateIssueInput): Promise<Issue> {
    const current = (await this.getIssue(projectId, issueId)).issue;
    refusePlanningFields(input, current);
    const planning = resolvePlanningFields(input, current);
    const updated = await this.request<RestUpdateIssueResponse>(`/issues/${this.segment(issueId)}`, {
      method: "PUT",
      body: {
        summary: input.summary ?? current.summary,
        description: input.description ?? current.description,
        priority: input.priority ?? current.priority,
        ...planningFieldsBody(planning),
      },
    });
    return {
      ...current,
      ...updated,
      // Folded after the spread, and against `planning` — the values this
      // request just sent — rather than against `current`. The response states
      // only the fields that are set, so an absent key means "not set", and the
      // spread alone would leave the *old* value standing on a field this very
      // request cleared. `??` reads a stated `null` the same way as an absent
      // key, which is safe because the only thing it falls back to is what was
      // just asked for: a cleared field falls back to `null` either way.
      storyPoints: updated.storyPoints ?? planning.storyPoints,
      startDate: updated.startDate ?? planning.startDate,
      dueDate: updated.dueDate ?? planning.dueDate,
      originalEstimateMinutes: updated.originalEstimateMinutes ?? planning.originalEstimateMinutes,
      remainingEstimateMinutes: updated.remainingEstimateMinutes ?? planning.remainingEstimateMinutes,
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

  async listProjectLabels(projectId: string): Promise<ProjectLabel[]> {
    const response = await this.request<RestListProjectLabelsResponse>(this.projectLabelsPath(projectId));
    return (response.items ?? []).map((label) => this.toProjectLabel(label, projectId));
  }

  async createProjectLabel(projectId: string, input: CreateProjectLabelInput): Promise<ProjectLabel> {
    const response = await this.request<RestProjectLabel>(this.projectLabelsPath(projectId), {
      method: "POST",
      body: { name: input.name, color: input.color },
    });
    return this.toProjectLabel(response, projectId);
  }

  async updateProjectLabel(
    projectId: string,
    labelId: string,
    input: UpdateProjectLabelInput,
  ): Promise<ProjectLabel> {
    // Both fields every time: `UpdateProjectLabelRequestDto` requires `name` and
    // `color`, so a rename still sends the colour it is keeping. The caller does
    // the keeping — this layer does not read the label first to fill a gap.
    const response = await this.request<RestProjectLabel>(
      `${this.projectLabelsPath(projectId)}/${this.segment(labelId)}`,
      {
        method: "PATCH",
        body: { name: input.name, color: input.color },
      },
    );
    return this.toProjectLabel(response, projectId);
  }

  async deleteProjectLabel(projectId: string, labelId: string): Promise<void> {
    await this.request<void>(`${this.projectLabelsPath(projectId)}/${this.segment(labelId)}`, {
      method: "DELETE",
    });
  }

  async listIssueLabels(projectId: string, issueId: string): Promise<Label[]> {
    const response = await this.request<RestListIssueLabelsResponse>(this.issueLabelsPath(projectId, issueId));
    return (response.items ?? []).map((label) => toLabel(label));
  }

  async addIssueLabel(projectId: string, issueId: string, labelId: string): Promise<void> {
    await this.request<unknown>(this.issueLabelsPath(projectId, issueId), {
      method: "POST",
      body: { labelId },
    });
  }

  async removeIssueLabel(projectId: string, issueId: string, labelId: string): Promise<void> {
    await this.request<void>(`${this.issueLabelsPath(projectId, issueId)}/${this.segment(labelId)}`, {
      method: "DELETE",
    });
  }

  async listAttachments(projectId: string, issueId: string): Promise<IssueAttachment[]> {
    const response = await this.request<RestListAttachmentsResponse>(this.attachmentsPath(projectId, issueId));
    return (response.items ?? []).map((attachment) => this.toAttachment(attachment, issueId));
  }

  async createAttachmentUploadUrl(
    projectId: string,
    issueId: string,
    input: CreateAttachmentUploadUrlInput,
  ): Promise<AttachmentUploadTicket> {
    refuseAttachment(input);
    const response = await this.request<RestAttachmentUploadTicket>(
      `${this.attachmentsPath(projectId, issueId)}/upload-url`,
      {
        method: "POST",
        body: { fileName: input.fileName, contentType: input.contentType, sizeBytes: input.sizeBytes },
      },
    );
    return { uploadUrl: response.uploadUrl ?? "", objectKey: response.objectKey ?? "" };
  }

  /**
   * **The one call in this class that does not go through `request()`, and it
   * must stay that way.**
   *
   * `request()` prefixes the gateway base URL, attaches the bearer token,
   * refreshes the session on a 401, sets `Accept: application/json` and parses
   * the body as JSON. Every one of those is wrong here:
   *
   * - the URL is absolute and points at the object store, not at the gateway;
   * - a presigned URL carries its own credentials in the query string, and
   *   sending an `Authorization` header alongside them makes some S3
   *   implementations authenticate *that* instead and fail the signature — so
   *   the token would not merely be useless, it would be harmful;
   * - a 401 from a bucket says nothing about this app's session, and routing it
   *   into `tryRefresh` would sign the person out over somebody else's server;
   * - the store answers XML, and a 204 or an empty 200 on success.
   *
   * The headers are therefore exactly one: the `Content-Type` that was signed.
   * Nothing else is added — no `X-Request-Id`, no `Accept` — because every
   * header beyond the CORS-safelist has to be named in the preflight's
   * `Access-Control-Allow-Headers`, and asking for headers the bucket has not
   * been told to allow is one more way to be refused before the bytes move.
   *
   * `credentials` is left at its default (`same-origin`), so no cookie of this
   * app's goes to the store — **as long as the store is a different origin**,
   * which is why the URL is checked before it is used rather than trusted. See
   * `requireUsableUploadUrl`: `createAttachmentUploadUrl` above lands a missing
   * `uploadUrl` as `""`, and `fetch("")` resolves against the document, which
   * would make this a same-origin PUT of the file with cookies attached.
   */
  async putAttachmentBytes(uploadUrl: string, body: Blob, contentType: string): Promise<void> {
    requireUsableUploadUrl(uploadUrl);
    let response: Response;
    try {
      response = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body,
      });
    } catch (cause) {
      // `fetch` rejects without a response for a blocked CORS preflight, and
      // gives script no way to learn that is what happened — the spec is
      // explicit that the reason is not exposed. Being offline and a dead host
      // land here too, so this carries no status and claims no cause.
      throw new AttachmentStoreError(
        cause instanceof Error && cause.message ? `The file store could not be reached: ${cause.message}` : "The file store could not be reached.",
        ATTACHMENT_STORE_UNREACHABLE_CODE,
        null,
      );
    }
    if (!response.ok) {
      // The store's status goes in the message and in `storeStatus`, never in a
      // field called `status`: see AttachmentStoreError.
      throw new AttachmentStoreError(
        `The file store answered ${response.status}.`,
        ATTACHMENT_STORE_REJECTED_CODE,
        response.status,
      );
    }
  }

  async confirmAttachmentUpload(
    projectId: string,
    issueId: string,
    input: ConfirmAttachmentUploadInput,
  ): Promise<IssueAttachment> {
    // No `Idempotency-Key` and no retry wrapper, deliberately. The route does
    // not read one, and the insert underneath is unconditional against a table
    // with no unique key on `object_key`, so a repeat is a duplicate row rather
    // than a no-op. See `confirmAttachmentUpload` on TaskaApi.
    const response = await this.request<RestIssueAttachment>(
      `${this.attachmentsPath(projectId, issueId)}/confirm`,
      {
        method: "POST",
        body: { objectKey: input.objectKey, fileName: input.fileName, contentType: input.contentType },
      },
    );
    return this.toAttachment(response, issueId);
  }

  async getAttachmentDownloadUrl(
    projectId: string,
    issueId: string,
    attachmentId: string,
  ): Promise<AttachmentDownloadUrl> {
    const response = await this.request<RestAttachmentDownloadUrl>(
      `${this.attachmentsPath(projectId, issueId)}/${this.segment(attachmentId)}/download-url`,
    );
    return { downloadUrl: response.downloadUrl ?? "", checksum: response.checksum ?? null };
  }

  async deleteAttachment(projectId: string, issueId: string, attachmentId: string): Promise<void> {
    await this.request<void>(`${this.attachmentsPath(projectId, issueId)}/${this.segment(attachmentId)}`, {
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
        tables: (service.tables ?? []).map((table) => ({
          ...table,
          // `sensitive` is the one field here that decides whether a secret is
          // drawn, and `ColumnMetadataDto` has no `required` block — a gateway
          // may legally omit it while `AdminColumn.sensitive` asserts a boolean.
          // Absent therefore means sensitive, not harmless: the deployed
          // catalog sends the field on every column today, so treating a
          // missing one as `true` costs nothing now and fails closed if that
          // ever stops being true. The alternative — defaulting to `false` —
          // would drop the column's lock, print `"***"` as data, and let the
          // column be sorted on, which is the leak `withoutSensitive` exists to
          // prevent.
          columns: (table.columns ?? []).map((column) => ({ ...column, sensitive: column.sensitive !== false })),
        })),
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
   * No query string at all: the UI never narrows this call, and the contract's
   * optional `serviceKey` therefore has no caller (see `TaskaApi`).
   */
  async getProblematicOutboxSummary(): Promise<ProblematicOutboxSummary> {
    const response = await this.request<RestProblematicOutboxSummary>("/readonly/outbox/problematic-summary");
    return {
      // Oldest first, exactly as the server ordered them. Nothing here sorts:
      // the order is the endpoint's own semantics (§5.8), and re-sorting a list
      // the server truncated would misrepresent what was cut.
      events: (response.events ?? []).map((event) => ({
        id: event.id ?? "",
        aggregateType: event.aggregateType ?? "",
        aggregateId: event.aggregateId ?? "",
        eventType: event.eventType ?? "",
        payload: event.payload ?? "",
        status: event.status ?? "",
        createdAt: event.createdAt ?? "",
        // The four nullable ones keep `null` rather than "": an event that was
        // never published and one published at an unstated time are the same
        // fact to a reader — nothing to show — and the card prints the section's
        // own dash for it. Empty strings would print as blanks instead.
        publishedAt: event.publishedAt ?? null,
        attempts: event.attempts ?? 0,
        lastErrorMessage: event.lastErrorMessage ?? null,
        processingStartedAt: event.processingStartedAt ?? null,
        requestId: event.requestId ?? null,
        serviceKey: event.serviceKey ?? "",
        reason: event.reason ?? "",
      })),
      counts: (response.counts ?? []).map((count) => ({
        serviceKey: count.serviceKey ?? "",
        // Zero, not absent: the matrix is a grid of numbers and a hole in it
        // would read as "unknown" while the service is in fact fine.
        overdueNewCount: count.overdueNewCount ?? 0,
        stuckProcessingCount: count.stuckProcessingCount ?? 0,
        failedCount: count.failedCount ?? 0,
      })),
      // Absent means the server said nothing was cut, which is the only reading
      // that does not put a truncation notice over a complete list.
      notAllShown: response.notAllShown === true,
    };
  }

  /**
   * `POST /admin/users/{userId}/block`. The reason is the whole body, and it is
   * checked here rather than at the boundary — the server answers `400` for a
   * blank one, and the mock refuses it with the same code, so neither mode can
   * quietly send one.
   */
  async blockUser(userId: string, reason: string): Promise<UserStatusChange> {
    return this.toUserStatusChange(
      await this.request<RestUserStatusChange>(`/admin/users/${this.segment(userId)}/block`, {
        method: "POST",
        body: { reason: requireAdminWriteReason(reason) },
      }),
    );
  }

  /** `POST /admin/users/{userId}/unblock` — the same body and the same guard. */
  async unblockUser(userId: string, reason: string): Promise<UserStatusChange> {
    return this.toUserStatusChange(
      await this.request<RestUserStatusChange>(`/admin/users/${this.segment(userId)}/unblock`, {
        method: "POST",
        body: { reason: requireAdminWriteReason(reason) },
      }),
    );
  }

  /**
   * `POST /admin/users/{userId}/reset-lockout` — the same body, the same guard
   * and the same response as its two neighbours. What differs is entirely on
   * the server: it is legal only from `LOCKED`, and the refusal for anything
   * else is a 400 carrying `FAILED_PRECONDITION` (see `TaskaApi`).
   */
  async resetCredentialLockout(userId: string, reason: string): Promise<UserStatusChange> {
    return this.toUserStatusChange(
      await this.request<RestUserStatusChange>(`/admin/users/${this.segment(userId)}/reset-lockout`, {
        method: "POST",
        body: { reason: requireAdminWriteReason(reason) },
      }),
    );
  }

  /**
   * Field by field rather than by spread, like `toIssueSearchHit`: the listing
   * is the point. What must keep being provable about this response is that
   * `changedAt` is carried and nothing more — no screen may start drawing it
   * because a spread happened to put it in scope.
   */
  private toUserStatusChange(response: RestUserStatusChange): UserStatusChange {
    return {
      userId: response.userId,
      previousStatus: response.previousStatus,
      currentStatus: response.currentStatus,
      changedAt: response.changedAt,
    };
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

  private projectLabelsPath(projectId: string) {
    return `/projects/${this.segment(projectId)}/labels`;
  }

  private issueLabelsPath(projectId: string, issueId: string) {
    return `/projects/${this.segment(projectId)}/issues/${this.segment(issueId)}/labels`;
  }

  private commentsPath(projectId: string, issueId: string) {
    return `/projects/${this.segment(projectId)}/issues/${this.segment(issueId)}/comments`;
  }

  private attachmentsPath(projectId: string, issueId: string) {
    return `/projects/${this.segment(projectId)}/issues/${this.segment(issueId)}/attachments`;
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

  /**
   * `IssueResponseDto` → `Issue`, for the detail read *and*, since TAS-195,
   * for every row of `listIssues`: the two routes answer with the same schema,
   * so a field this method forgets to default is a hundred cards rather than
   * one panel.
   *
   * The five planning fields are folded one by one rather than left to the
   * spread. A spread of a response that carries none of them — which is every
   * response until backend PR #148 deploys — produces five members that are
   * `undefined` while their type says `number | null`: it type-checks by
   * structural accident and renders the string "undefined" on the card.
   *
   * `?? null` and never `||`. `0` is a legal story-point count and a legal
   * estimate, and `0 || null` is `null` — the one substitution that turns a
   * value into an absence without failing anywhere.
   *
   * **`description` is defaulted and `status` deliberately is not**, and the
   * asymmetry is the interesting half. Both may be absent: the deployed
   * gateway's own generated spec (`GET /v3/api-docs`, read 2026-09-08) declares
   * every property of `IssueResponseDto` as `["string", "null"]` under no
   * `required` block, so `null` here is a server-declared value rather than a
   * hypothesis. The difference is what a substitute costs.
   *
   * For `description`, `""` is the value the UI already means by "no
   * description" — it is what the issue panel writes back, and what the board's
   * filter needs, because that filter calls `.toLowerCase()` on it inside a
   * `useMemo` during render and there is no error boundary in `src`: one `null`
   * blanks the whole application on the first keystroke, and again after a
   * reload on the next one.
   *
   * For `status` there is no such harmless value. Every candidate is a real
   * column, so an invented one puts the card under a heading the server does not
   * agree with, and the drag out of that column then asks for a transition from
   * a status the issue was never in. A statusless card matches no column and
   * simply does not appear (`BoardScreen` groups by `issue.status ===
   * status.statusKey`), which is the recoverable failure of the two. That half
   * is in `docs/ai/BACKLOG.md` with this reasoning rather than papered over
   * here.
   */
  private toIssue(issue: RestIssue): Issue {
    return {
      ...issue,
      description: issue.description ?? "",
      assigneeId: issue.assigneeId || null,
      deletedAt: issue.deletedAt ?? null,
      labels: (issue.labels ?? []).map((label) => toLabel(label)),
      storyPoints: issue.storyPoints ?? null,
      startDate: issue.startDate ?? null,
      dueDate: issue.dueDate ?? null,
      originalEstimateMinutes: issue.originalEstimateMinutes ?? null,
      remainingEstimateMinutes: issue.remainingEstimateMinutes ?? null,
    };
  }

  /**
   * `projectId` is passed in rather than trusted from the body: the response
   * declares no required fields, and the project a label belongs to is a fact
   * the caller asked the question with. A body that names a different project
   * is still preferred — it is the server's answer — but an absent one falls
   * back to the path rather than to the empty string, which would leave the
   * label pointing at no project at all.
   */
  private toProjectLabel(label: RestProjectLabel, projectId: string): ProjectLabel {
    return {
      ...toLabel(label),
      projectId: label.projectId ?? projectId,
      createdBy: label.createdBy ?? "",
      createdAt: label.createdAt ?? "",
      deletedAt: label.deletedAt ?? null,
    };
  }

  /**
   * `IssueShortResponseDto` → `IssueSearchHit`, field by field rather than by
   * spread. The listing is the point: a spread would quietly widen the hit the
   * day the DTO grows a field, and the one thing this type must keep proving is
   * that it carries no status and no project.
   */
  private toIssueSearchHit(item: RestIssueShortItem): IssueSearchHit {
    return {
      id: item.id,
      issueKey: item.issueKey,
      issueType: item.issueType,
      summary: item.summary,
      priority: item.priority,
      // `""` for unassigned, exactly as the list endpoint answers — same
      // normalisation as `toIssue`, so one shape of "nobody" reaches the UI.
      assigneeId: item.assigneeId || null,
      // `??`, not `||`: an issue estimated at zero points has been estimated.
      storyPoints: item.storyPoints ?? null,
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

  /**
   * `issueId` is defaulted from the request rather than left blank: the caller
   * asked about one issue, so an attachment that arrived without one belongs to
   * that issue and nothing is being invented. Everything else keeps the shape
   * `toLabel` uses — an unaddressable row is still drawn, and the id it did not
   * carry stays empty so the controls that need one can tell.
   */
  private toAttachment(attachment: RestIssueAttachment, issueId: string): IssueAttachment {
    return {
      id: attachment.id ?? "",
      issueId: attachment.issueId ?? issueId,
      fileName: attachment.fileName ?? "",
      contentType: attachment.contentType ?? "",
      sizeBytes: typeof attachment.sizeBytes === "number" ? attachment.sizeBytes : 0,
      uploadedBy: attachment.uploadedBy ?? "",
      checksum: attachment.checksum ?? null,
      createdAt: attachment.createdAt ?? "",
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

/**
 * A label the UI can draw whatever the response left out. An id it cannot use
 * is worse than no row at all, so an unaddressable label keeps the empty id it
 * arrived with and the caller decides — but the name and the colour are only
 * ever *drawn*, and blanks there are handled where they are rendered
 * (`labelChipStyle`, which falls back to the accent for an unstated colour).
 */
function toLabel(label: RestLabel): Label {
  return {
    id: label.id ?? "",
    name: label.name ?? "",
    color: typeof label.color === "string" ? label.color : "",
  };
}

/**
 * The search query as the gateway would accept it, or `null` for "no text
 * filter". The same rule the mock applies, and it lives on this side of the
 * wire so that the `400` the runtime would answer with is never spent: the
 * minimum is 3 in the runtime against `minLength: 2` in the contract, and the
 * empty string — which the gateway's own generated spec (`/v3/api-docs`) offers
 * as the parameter's *default*, though the vendored contract states no default
 * at all — is refused.
 *
 * The error is the gateway's own answer reproduced locally, `INVALID_ARGUMENT`
 * with `400` and its wording, so a caller cannot tell a query stopped here from
 * one stopped there and nothing has to special-case the compensation.
 */
function requireSearchQuery(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const query = raw.trim();
  if (query.length < SEARCH_QUERY_MIN_LENGTH) {
    throw new ApiError(SEARCH_QUERY_TOO_SHORT_MESSAGE, "INVALID_ARGUMENT", 400);
  }
  return query;
}

/**
 * The planning-field refusals, decided in src/api/planningFields.ts and
 * thrown here as the gateway's own answer: `INVALID_ARGUMENT` on `400`, the
 * same shape as `requireSearchQuery` above and the same wording the mock uses,
 * so a caller cannot tell a value stopped here from one stopped there.
 *
 * `stored` is the issue as it stands, and `null` on a create. The server's
 * date cross-check reads the stored row rather than the request, so a guard
 * without it would let through a write the gateway refuses.
 */
function refusePlanningFields(input: PlanningFieldsInput, stored: StoredPlanningDates | null): void {
  const refusal = planningFieldRefusal(input, stored);
  if (refusal) {
    throw new ApiError(refusal.message, refusal.code, 400);
  }
}

/**
 * The file refusals from src/api/attachments.ts, thrown as the gateway's own
 * answer so a file stopped here is indistinguishable from one stopped there —
 * which is why the over-size arm synthesises a **500** where its two siblings
 * get a 400. That is not a typo, and the three arms genuinely do not share an
 * answer. Read off backend PR #147's head `f53dca38`:
 *
 * - **disallowed type** — reaches `S3StorageClient.validateFileParams`, which
 *   raises `DomainStatus.INVALID_ARGUMENT`. `RestErrorMapper` maps that to
 *   **400** and `GatewayErrorHandler` writes the gRPC code's own name into
 *   `code`, so `INVALID_ARGUMENT` on 400.
 * - **empty file** — never reaches `validateFileParams` at all. `sizeBytes`
 *   carries `minimum: 1` in the contract and the gateway generates its
 *   interfaces with `useValidation`, so `@Min(1)` fails first and
 *   `GatewayValidationExceptionHandler` answers **400** `INVALID_ARGUMENT`.
 *   Same code, same status; only the *message* differs, because that handler
 *   sends its fixed `"Invalid request parameters"` rather than
 *   `validateFileParams`'s sentence. This throws the sentence, which is the one
 *   part of the gateway's answer it does not reproduce — nobody reads it: the
 *   panel refuses an empty file in its own words before this is reached.
 * - **over-size** — the request DTO states no `maximum` and the value is
 *   positive, so both earlier guards pass and `validateFileParams` raises
 *   `DomainStatus.OUT_OF_RANGE`. `GrpcExceptionMapper` has an explicit
 *   `case OUT_OF_RANGE -> Status.OUT_OF_RANGE`, so `code` is `"OUT_OF_RANGE"` —
 *   and `RestErrorMapper.mapGrpcCodeToHttpStatus` **has no `OUT_OF_RANGE`
 *   case**, so the status falls through its `default ->
 *   INTERNAL_SERVER_ERROR`. A file one byte too large is a **500**.
 *
 * An earlier version of this comment cited the mapping table in `common-lib`'s
 * `DomainStatus` javadoc, which sends `OUT_OF_RANGE` to 400, and concluded the
 * flattened 400 was therefore right. That table is documentation of intent in a
 * library the gateway does not consult; what the gateway executes is
 * `RestErrorMapper`, and it does not implement that row. Reproducing an answer
 * means reproducing the one that is served.
 *
 * Synthesising a 500 costs nothing here, and that was checked rather than
 * assumed: no reader in the attachment path branches on `status` — the panel
 * takes `apiErrorFacts(error).message` and prints it — and the only
 * `status >= 500` readers in this build are `userWriteFailure`
 * (src/screens/admin/users.ts) and `AdminError` (src/screens/admin/), neither
 * of which any attachment failure reaches. `HybridTaskaApi` forwards this leg to `live` untouched.
 *
 * Recorded in docs/ai/API-DIVERGENCE.md, and it disappears when the backend
 * adds the missing row — or a `maximum` to `sizeBytes`, which would move the
 * ceiling into bean validation and make it a 400 like its siblings.
 */
function refuseAttachment(input: CreateAttachmentUploadUrlInput): void {
  const refusal = attachmentRefusal(input);
  if (!refusal) return;
  // Split exactly as `MockTaskaApi.createAttachmentUploadUrl` splits it, so the
  // two implementations answer the same file with the same code.
  const overSize = attachmentRefusalKind(input) === "size";
  throw new ApiError(refusal, overSize ? "OUT_OF_RANGE" : "INVALID_ARGUMENT", overSize ? 500 : 400);
}

/**
 * The reason as the server would accept it, trimmed. One guard for all three
 * admin user writes, which all declare the same 1–550 `reason`.
 *
 * A whitespace-only reason is a `400` on the backend — through
 * `GrpcRequestValidators.requireNonBlankOrInvalidArgument` rather than through
 * `@NotBlank`, since the generated DTO only carries `@Size(min = 1)`, which a
 * single space passes. This is that rule applied on this side of the wire so
 * that a request which cannot succeed is never spent — the same shape as
 * `requireSearchQuery` above, and the same wording the mock uses, so a caller
 * cannot tell a reason stopped here from one stopped there.
 *
 * The upper bound is checked here too, and that is the whole of what this
 * function decides: `AGENTS.md` requires mock, rest and hybrid to stay
 * behaviourally interchangeable, and the mock has always refused
 * `reason.length > ADMIN_WRITE_REASON_MAX_LENGTH`. An earlier version of this
 * comment argued the other way — that a client-side length refusal would be a
 * second, weaker copy of a rule the server states — and the argument was both
 * outranked and wrong. Outranked, because interchangeability is a constraint
 * and that was a preference. Wrong, because there is no rule below the gateway
 * to be a weaker copy of: the 550 is stated once, as `maxLength` in the
 * contract and therefore `@Size(max = 550)` on the gateway's generated request
 * DTO, and both `auth-service` and `admin-service` validate `body.reason` with
 * `GrpcRequestValidators.requireNonBlank` alone.
 *
 * It costs nothing. The field carries `maxLength={ADMIN_WRITE_REASON_MAX_LENGTH}`
 * (src/screens/admin/AdminUserActionModal.tsx), so the UI cannot produce an
 * over-long reason; the guard is for a caller that bypasses the field, and both
 * implementations owe that caller the same answer. Before this, a 600-character
 * reason threw `INVALID_ARGUMENT` against the mock and went out on the wire
 * against REST — the two modes disagreeing about a request, which is exactly
 * what interchangeability names.
 *
 * The length is measured on the trimmed value, as the mock measures it, so 550
 * characters plus a trailing newline is accepted rather than refused on a
 * character nobody typed on purpose.
 */
function requireAdminWriteReason(raw: string): string {
  const reason = raw.trim();
  if (reason === "") {
    throw new ApiError(ADMIN_WRITE_REASON_REQUIRED_MESSAGE, "INVALID_ARGUMENT", 400);
  }
  if (reason.length > ADMIN_WRITE_REASON_MAX_LENGTH) {
    throw new ApiError(ADMIN_WRITE_REASON_TOO_LONG_MESSAGE, "INVALID_ARGUMENT", 400);
  }
  return reason;
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
