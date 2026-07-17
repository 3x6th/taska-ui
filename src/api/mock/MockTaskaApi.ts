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
  IssueHistoryEvent,
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
} from "../../domain/types";

const ANNA_ID = "6d774efa-57d8-4ae0-a27e-2984d1dfbbf6";
const MARK_ID = "e65186a2-b807-42ae-a66f-711be116a93b";
const SOFIA_ID = "16ad2404-96e3-4c51-b00d-55c5d1451d3c";
const TOM_ID = "1ab80365-0843-460a-b0a1-e6dd3e0f2a0d";
const PRIYA_ID = "fdf35fa6-e68b-4dbe-8a48-5867d7f08ce9";

const TASKA_PROJECT_ID = "2e74e49f-0f29-4e03-b4ec-adc4dbf2382e";
const WEB_PROJECT_ID = "58e93598-ea1a-460d-9d72-f1f201c310e2";
const MOB_PROJECT_ID = "f315c5cf-3333-47d1-8d22-79f07c2ec99b";
const OPS_PROJECT_ID = "64d70a2b-72b0-4866-bdbf-4f71a416f9e4";

const WORKFLOW_ID = "11111111-1111-1111-1111-111111111111";
const TODO_STATUS_ID = "22222222-2222-2222-2222-222222222222";
const IN_PROGRESS_STATUS_ID = "33333333-3333-3333-3333-333333333333";
const DONE_STATUS_ID = "44444444-4444-4444-4444-444444444444";

class MockApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const now = () => new Date().toISOString();

const clone = <T>(value: T): T => structuredClone(value);

const wait = async <T>(value: T, ms = 140): Promise<T> =>
  new Promise((resolve) => {
    window.setTimeout(() => resolve(clone(value)), ms);
  });

const makeId = (prefix: string) => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const byCreatedAt = <T extends { createdAt: string }>(a: T, b: T) =>
  new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();

export class MockTaskaStore {
  private users: User[];
  private projects: Project[];
  private membersByProject: Record<string, ProjectMember[]>;
  private issues: Issue[];
  private historyByIssue: Record<string, IssueHistoryEvent[]>;
  private notifications: Notification[];
  private workflow: Workflow;
  private currentUserId = ANNA_ID;

  constructor() {
    const ts = (day: number, minute: number) =>
      `2026-06-${String(day).padStart(2, "0")}T09:${String(minute).padStart(2, "0")}:00Z`;

    this.users = [
      {
        id: ANNA_ID,
        login: "anna",
        email: "anna@example.com",
        displayName: "Anna Ivanova",
        status: "ACTIVE",
        color: "#6366f1",
      },
      {
        id: MARK_ID,
        login: "mark",
        email: "mark@example.com",
        displayName: "Mark Lee",
        status: "ACTIVE",
        color: "#0ea5e9",
      },
      {
        id: SOFIA_ID,
        login: "sofia",
        email: "sofia@example.com",
        displayName: "Sofia Reyes",
        status: "ACTIVE",
        color: "#10b981",
      },
      {
        id: TOM_ID,
        login: "tom",
        email: "tom@example.com",
        displayName: "Tom Becker",
        status: "ACTIVE",
        color: "#f59e0b",
      },
      {
        id: PRIYA_ID,
        login: "priya",
        email: "priya@example.com",
        displayName: "Priya Nair",
        status: "ACTIVE",
        color: "#ec4899",
      },
    ];

    this.projects = [
      this.project(TASKA_PROJECT_ID, "TAS", "Taska Platform", "Core gateway, auth and issue services", "#6366f1", [
        ANNA_ID,
        MARK_ID,
        SOFIA_ID,
        TOM_ID,
      ]),
      this.project(WEB_PROJECT_ID, "WEB", "Web App", "Customer-facing web client", "#0ea5e9", [
        ANNA_ID,
        SOFIA_ID,
        PRIYA_ID,
      ]),
      this.project(MOB_PROJECT_ID, "MOB", "Mobile", "iOS and Android applications", "#8b5cf6", [
        MARK_ID,
        TOM_ID,
        PRIYA_ID,
      ]),
      this.project(OPS_PROJECT_ID, "OPS", "Infra and Ops", "CI/CD, observability, on-call", "#0d9488", [
        ANNA_ID,
        TOM_ID,
      ]),
    ];

    this.membersByProject = Object.fromEntries(
      this.projects.map((project) => [
        project.id,
        (project.memberIds ?? []).map((userId, index) => ({
          userId,
          role: index === 0 ? "ADMIN" : "MEMBER",
          addedAt: ts(8 + index, 20 + index),
          addedBy: ANNA_ID,
          user: this.userSummary(userId),
        })),
      ]),
    );

    this.workflow = {
      id: WORKFLOW_ID,
      name: "Default workflow",
      version: 1,
      createdAt: ts(8, 10),
      updatedAt: ts(8, 10),
      statuses: [
        { id: TODO_STATUS_ID, statusKey: "TODO", name: "To Do", category: "TODO", sortOrder: 10 },
        {
          id: IN_PROGRESS_STATUS_ID,
          statusKey: "IN_PROGRESS",
          name: "In Progress",
          category: "IN_PROGRESS",
          sortOrder: 20,
        },
        { id: DONE_STATUS_ID, statusKey: "DONE", name: "Done", category: "DONE", sortOrder: 30 },
      ],
      transitions: [
        {
          id: "55555555-5555-5555-5555-555555555555",
          fromStatusId: TODO_STATUS_ID,
          toStatusId: IN_PROGRESS_STATUS_ID,
          name: "Start Progress",
          sortOrder: 10,
        },
        {
          id: "66666666-6666-6666-6666-666666666666",
          fromStatusId: IN_PROGRESS_STATUS_ID,
          toStatusId: DONE_STATUS_ID,
          name: "Complete",
          sortOrder: 20,
        },
        {
          id: "77777777-7777-7777-7777-777777777777",
          fromStatusId: DONE_STATUS_ID,
          toStatusId: IN_PROGRESS_STATUS_ID,
          name: "Reopen",
          sortOrder: 30,
        },
      ],
    };

    let minute = 10;
    const issue = (
      projectId: string,
      key: string,
      number: number,
      issueType: IssueType,
      summary: string,
      description: string,
      status: IssueStatus,
      priority: IssuePriority,
      assigneeId: string | null,
      reporterId: string,
      day: number,
    ): Issue => ({
      id: makeId(`issue-${key}-${number}`),
      projectId,
      issueNumber: number,
      issueKey: `${key}-${number}`,
      issueType,
      summary,
      description,
      status,
      priority,
      assigneeId,
      reporterId,
      createdAt: ts(day, minute++),
      updatedAt: ts(day, minute++),
      version: 1,
      deletedAt: null,
    });

    this.issues = [
      issue(
        TASKA_PROJECT_ID,
        "TAS",
        101,
        "BUG",
        "Login form validation fails on empty email",
        "Submitting the sign-in form with an empty email returns a 500 instead of a 400 validation error.",
        "IN_PROGRESS",
        "HIGH",
        MARK_ID,
        ANNA_ID,
        12,
      ),
      issue(
        TASKA_PROJECT_ID,
        "TAS",
        102,
        "TASK",
        "Prepare onboarding checklist for invited users",
        "Checklist surfaced after an invited user activates their account.",
        "TODO",
        "MEDIUM",
        ANNA_ID,
        ANNA_ID,
        13,
      ),
      issue(
        TASKA_PROJECT_ID,
        "TAS",
        103,
        "STORY",
        "Project members list endpoint",
        "Add GET /projects/{id}/members so the assignee picker and member settings can render real people.",
        "TODO",
        "HIGH",
        SOFIA_ID,
        SOFIA_ID,
        14,
      ),
      issue(
        TASKA_PROJECT_ID,
        "TAS",
        104,
        "TASK",
        "Propagate X-Request-Id through the gateway",
        "Generate a request id when missing and forward it into gRPC Header.request_id.",
        "DONE",
        "LOW",
        TOM_ID,
        ANNA_ID,
        9,
      ),
      issue(
        TASKA_PROJECT_ID,
        "TAS",
        105,
        "BUG",
        "Refresh token rotation drops the session",
        "Rotating the refresh token occasionally invalidates the active access token early.",
        "IN_PROGRESS",
        "MEDIUM",
        ANNA_ID,
        MARK_ID,
        15,
      ),
      issue(
        TASKA_PROJECT_ID,
        "TAS",
        106,
        "STORY",
        "Kanban drag-and-drop transitions",
        "Wire POST /issues/{id}/transitions to board drag-and-drop and card buttons.",
        "TODO",
        "MEDIUM",
        MARK_ID,
        SOFIA_ID,
        16,
      ),
      issue(
        TASKA_PROJECT_ID,
        "TAS",
        107,
        "TASK",
        "Define a shared JSON error schema",
        "One error envelope { code, message, requestId } across every service.",
        "IN_PROGRESS",
        "HIGH",
        SOFIA_ID,
        ANNA_ID,
        16,
      ),
      issue(
        TASKA_PROJECT_ID,
        "TAS",
        108,
        "TASK",
        "Assignee picker user search",
        "GET /users?query= for the assignee and member pickers.",
        "TODO",
        "MEDIUM",
        PRIYA_ID,
        SOFIA_ID,
        17,
      ),
      issue(
        TASKA_PROJECT_ID,
        "TAS",
        109,
        "STORY",
        "Notifications inbox: mark all as read",
        "PATCH /notifications/read-all plus an inbox affordance.",
        "DONE",
        "LOW",
        ANNA_ID,
        ANNA_ID,
        8,
      ),
      issue(
        TASKA_PROJECT_ID,
        "TAS",
        110,
        "BUG",
        "Board column count is off by one",
        "Soft-deleted issues are still counted in the column badge.",
        "TODO",
        "LOW",
        TOM_ID,
        MARK_ID,
        18,
      ),
      issue(WEB_PROJECT_ID, "WEB", 12, "STORY", "Responsive board layout", "Board columns should collapse gracefully under 900px.", "TODO", "MEDIUM", SOFIA_ID, ANNA_ID, 11),
      issue(WEB_PROJECT_ID, "WEB", 13, "BUG", "Dark theme contrast on chips", "Type chips fail AA contrast on the dark surface.", "IN_PROGRESS", "HIGH", PRIYA_ID, SOFIA_ID, 12),
      issue(WEB_PROJECT_ID, "WEB", 14, "TASK", "Persist last opened project", "Remember the user's last project on reload.", "DONE", "LOW", ANNA_ID, ANNA_ID, 7),
      issue(MOB_PROJECT_ID, "MOB", 5, "TASK", "Push notification permission flow", "Ask for permission after the first assignment, not on launch.", "TODO", "MEDIUM", TOM_ID, MARK_ID, 10),
      issue(MOB_PROJECT_ID, "MOB", 6, "BUG", "Pull-to-refresh duplicates issues", "List occasionally renders duplicates after refresh.", "IN_PROGRESS", "MEDIUM", MARK_ID, TOM_ID, 11),
      issue(OPS_PROJECT_ID, "OPS", 3, "TASK", "Add board endpoint dashboards", "Grafana panels for /board latency.", "TODO", "LOW", TOM_ID, ANNA_ID, 9),
    ];

    this.historyByIssue = Object.fromEntries(
      this.issues.map((item) => [
        item.id,
        [
          {
            id: makeId("history"),
            issueId: item.id,
            eventType: "CREATED",
            actorUserId: item.reporterId,
            occurredAt: item.createdAt,
            payload: {},
          },
        ],
      ]),
    );

    const tas107 = this.issues.find((item) => item.issueKey === "TAS-107");
    const tas101 = this.issues.find((item) => item.issueKey === "TAS-101");
    if (tas107) {
      this.pushHistory(tas107.id, "ASSIGNED", ANNA_ID, { to: SOFIA_ID }, ts(16, 43));
      this.pushHistory(tas107.id, "TRANSITIONED", SOFIA_ID, { from: "TODO", to: "IN_PROGRESS" }, ts(17, 14));
    }
    if (tas101) {
      this.pushHistory(tas101.id, "TRANSITIONED", MARK_ID, { from: "TODO", to: "IN_PROGRESS" }, ts(13, 31));
      this.pushHistory(tas101.id, "PRIORITY", MARK_ID, { to: "HIGH" }, ts(13, 44));
    }

    this.notifications = [
      this.notification("ISSUE_ASSIGNED", "Issue assigned", "TAS-107 was assigned to you", `/projects/${TASKA_PROJECT_ID}/issues/${tas107?.id ?? ""}`, ts(25, 10), null),
      this.notification("ISSUE_TRANSITIONED", "Status changed", "TAS-101 moved to In Progress", `/projects/${TASKA_PROJECT_ID}/issues/${tas101?.id ?? ""}`, ts(25, 7), null),
      this.notification("ISSUE_UPDATED", "Mention in issue", "Sofia mentioned you on TAS-103", `/projects/${TASKA_PROJECT_ID}/board`, ts(24, 50), ts(25, 8)),
    ];
  }

  login(input: LoginInput): AuthTokens {
    const user = this.users.find((item) => item.email === input.email);
    if (!user || user.status !== "ACTIVE") {
      throw new MockApiError("UNAUTHENTICATED", "Invalid credentials");
    }
    this.currentUserId = user.id;
    return {
      accessToken: "mock-access-token",
      refreshToken: "mock-refresh-token",
      expiresIn: 3600,
    };
  }

  acceptInvitation(_input: AcceptInvitationInput): void {
    this.currentUserId = ANNA_ID;
  }

  currentUser(): User {
    return this.getUser(this.currentUserId);
  }

  refresh(): AuthTokens {
    return {
      accessToken: "mock-access-token-refreshed",
      refreshToken: "mock-refresh-token-refreshed",
      expiresIn: 3600,
    };
  }

  listProjects(): Project[] {
    return this.projects.filter((project) => project.memberIds?.includes(this.currentUserId));
  }

  createProject(input: CreateProjectInput): Project {
    const key = input.projectKey.trim().toUpperCase();
    if (!key || this.projects.some((project) => project.projectKey === key)) {
      throw new MockApiError("ALREADY_EXISTS", "Project key already exists");
    }
    const project = this.project(makeId("project"), key, input.name.trim(), input.description || "Project workspace", "#7c3aed", [
      this.currentUserId,
    ]);
    this.projects.unshift(project);
    this.membersByProject[project.id] = [
      {
        userId: this.currentUserId,
        role: "ADMIN",
        addedAt: now(),
        addedBy: this.currentUserId,
        user: this.userSummary(this.currentUserId),
      },
    ];
    return project;
  }

  getProject(projectId: string): Project {
    const project = this.projects.find((item) => item.id === projectId);
    if (!project) {
      throw new MockApiError("NOT_FOUND", "Project not found");
    }
    return project;
  }

  getMembership(projectId: string): ProjectMembership {
    const project = this.projects.find((item) => item.id === projectId);
    const member = this.membersByProject[projectId]?.find((item) => item.userId === this.currentUserId);
    return {
      role: member?.role ?? "VIEWER",
      isMember: Boolean(member),
      projectExists: Boolean(project),
    };
  }

  listMembers(projectId: string): ProjectMember[] {
    this.getProject(projectId);
    return this.membersByProject[projectId] ?? [];
  }

  getWorkflow(): Workflow {
    return this.workflow;
  }

  listIssues(projectId: string, params: ListIssuesParams = {}): Page<Issue> {
    this.getProject(projectId);
    const page = params.page ?? 0;
    const pageSize = params.pageSize ?? 100;
    const filtered = this.issues
      .filter((item) => item.projectId === projectId && item.deletedAt === null)
      .filter((item) => !params.status || item.status === params.status)
      .filter((item) => !params.assigneeId || item.assigneeId === params.assigneeId)
      .sort(byCreatedAt);
    return {
      items: filtered.slice(page * pageSize, page * pageSize + pageSize),
      page,
      pageSize,
      totalCount: filtered.length,
    };
  }

  getIssue(projectId: string, issueId: string): IssueWithHistory {
    const issue = this.findIssue(projectId, issueId);
    return {
      issue,
      history: this.historyByIssue[issue.id] ?? [],
    };
  }

  createIssue(projectId: string, input: CreateIssueInput): Issue {
    const project = this.getProject(projectId);
    const issueNumber =
      Math.max(0, ...this.issues.filter((item) => item.projectId === projectId).map((item) => item.issueNumber)) + 1;
    const issue: Issue = {
      id: makeId("issue"),
      projectId,
      issueNumber,
      issueKey: `${project.projectKey}-${issueNumber}`,
      issueType: input.issueType,
      summary: input.summary.trim(),
      description: input.description.trim(),
      status: "TODO",
      priority: input.priority,
      assigneeId: null,
      reporterId: this.currentUserId,
      createdAt: now(),
      updatedAt: now(),
      version: 1,
      deletedAt: null,
    };
    this.issues.push(issue);
    this.historyByIssue[issue.id] = [];
    this.pushHistory(issue.id, "CREATED", this.currentUserId, {});
    this.notifications.unshift(
      this.notification("ISSUE_CREATED", "Issue created", `${issue.issueKey} was created`, `/projects/${projectId}/issues/${issue.id}`, now(), null),
    );
    return issue;
  }

  updateIssue(projectId: string, issueId: string, input: UpdateIssueInput): Issue {
    const issue = this.findIssue(projectId, issueId);
    const changedPriority = input.priority && input.priority !== issue.priority;
    Object.assign(issue, {
      ...input,
      updatedAt: now(),
      version: issue.version + 1,
    });
    this.pushHistory(issue.id, changedPriority ? "PRIORITY" : "UPDATED", this.currentUserId, {
      field: changedPriority ? "priority" : "issue",
      to: changedPriority ? input.priority : undefined,
    });
    return issue;
  }

  assignIssue(projectId: string, issueId: string, assigneeId: string | null): Issue {
    const issue = this.findIssue(projectId, issueId);
    if (assigneeId) {
      this.getUser(assigneeId);
    }
    issue.assigneeId = assigneeId;
    issue.updatedAt = now();
    issue.version += 1;
    this.pushHistory(issue.id, "ASSIGNED", this.currentUserId, { to: assigneeId });
    if (assigneeId) {
      this.notifications.unshift(
        this.notification("ISSUE_ASSIGNED", "Issue assigned", `${issue.issueKey} was assigned to you`, `/projects/${projectId}/issues/${issue.id}`, now(), null),
      );
    }
    return issue;
  }

  transitionIssue(projectId: string, issueId: string, transitionId: string): Issue {
    const issue = this.findIssue(projectId, issueId);
    const fromStatus = this.workflow.statuses.find((status) => status.statusKey === issue.status);
    const transition = this.workflow.transitions.find(
      (item) => item.id === transitionId && item.fromStatusId === fromStatus?.id,
    );
    const toStatus = this.workflow.statuses.find((status) => status.id === transition?.toStatusId)?.statusKey;
    if (!transition || !toStatus) {
      throw new MockApiError("FAILED_PRECONDITION", "Transition is not available for the current issue status");
    }
    const from = issue.status;
    issue.status = toStatus;
    issue.updatedAt = now();
    issue.version += 1;
    this.pushHistory(issue.id, "TRANSITIONED", this.currentUserId, { from, to: toStatus });
    this.notifications.unshift(
      this.notification("ISSUE_TRANSITIONED", "Status changed", `${issue.issueKey} moved to ${toStatus}`, `/projects/${projectId}/issues/${issue.id}`, now(), null),
    );
    return issue;
  }

  deleteIssue(projectId: string, issueId: string): void {
    const issue = this.findIssue(projectId, issueId);
    issue.deletedAt = now();
    issue.updatedAt = now();
    issue.version += 1;
    this.pushHistory(issue.id, "UPDATED", this.currentUserId, { field: "deleted" });
  }

  listNotifications(): Page<Notification> {
    return {
      items: [...this.notifications].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
      pageSize: 20,
      offset: 0,
    };
  }

  markNotificationRead(notificationId: string): Notification {
    const notification = this.notifications.find((item) => item.id === notificationId);
    if (!notification) {
      throw new MockApiError("NOT_FOUND", "Notification not found");
    }
    notification.readAt = notification.readAt ?? now();
    return notification;
  }

  markAllNotificationsRead(): { updatedCount: number } {
    let updatedCount = 0;
    this.notifications.forEach((notification) => {
      if (!notification.readAt) {
        notification.readAt = now();
        updatedCount += 1;
      }
    });
    return { updatedCount };
  }

  private project(
    id: string,
    projectKey: string,
    name: string,
    description: string,
    color: string,
    memberIds: string[],
  ): Project {
    return {
      id,
      projectKey,
      name,
      description,
      color,
      memberIds,
      createdBy: memberIds[0] ?? ANNA_ID,
      createdAt: "2026-06-08T09:10:00Z",
      updatedAt: "2026-06-18T10:30:00Z",
      archivedAt: null,
    };
  }

  private notification(
    notificationType: Notification["notificationType"],
    title: string,
    body: string,
    link: string,
    createdAt: string,
    readAt: string | null,
  ): Notification {
    return {
      id: makeId("notification"),
      userId: this.currentUserId,
      notificationType,
      title,
      body,
      link,
      createdAt,
      readAt,
      sourceEventId: makeId("event"),
    };
  }

  private getUser(userId: string): User {
    const user = this.users.find((item) => item.id === userId);
    if (!user) {
      throw new MockApiError("NOT_FOUND", "User not found");
    }
    return user;
  }

  private userSummary(userId: string): ProjectMember["user"] {
    const user = this.getUser(userId);
    return {
      displayName: user.displayName,
      email: user.email,
      color: user.color,
    };
  }

  private findIssue(projectId: string, issueId: string): Issue {
    const issue = this.issues.find((item) => item.projectId === projectId && item.id === issueId && item.deletedAt === null);
    if (!issue) {
      throw new MockApiError("NOT_FOUND", "Issue not found");
    }
    return issue;
  }

  private pushHistory(
    issueId: string,
    eventType: IssueHistoryEvent["eventType"],
    actorUserId: string,
    payload: IssueHistoryEvent["payload"],
    occurredAt = now(),
  ) {
    const event: IssueHistoryEvent = {
      id: makeId("history"),
      issueId,
      eventType,
      actorUserId,
      occurredAt,
      payload,
    };
    this.historyByIssue[issueId] = [...(this.historyByIssue[issueId] ?? []), event];
  }
}

export class MockTaskaApi implements TaskaApi {
  constructor(private readonly store = new MockTaskaStore()) {}

  async login(input: LoginInput): Promise<AuthTokens> {
    return wait(this.store.login(input));
  }

  async acceptInvitation(input: AcceptInvitationInput): Promise<void> {
    this.store.acceptInvitation(input);
    await wait(null);
  }

  async refresh(_refreshToken: string): Promise<AuthTokens> {
    return wait(this.store.refresh());
  }

  async logout(): Promise<void> {
    await wait(null);
  }

  async getCurrentUser(): Promise<User> {
    return wait(this.store.currentUser());
  }

  async listProjects(): Promise<Project[]> {
    return wait(this.store.listProjects());
  }

  async createProject(input: CreateProjectInput): Promise<Project> {
    return wait(this.store.createProject(input));
  }

  async getProject(projectId: string): Promise<Project> {
    return wait(this.store.getProject(projectId));
  }

  async getMembership(projectId: string): Promise<ProjectMembership> {
    return wait(this.store.getMembership(projectId));
  }

  async listMembers(projectId: string): Promise<ProjectMember[]> {
    return wait(this.store.listMembers(projectId));
  }

  async getWorkflow(projectId: string, issueType?: IssueType): Promise<Workflow> {
    void projectId;
    void issueType;
    return wait(this.store.getWorkflow());
  }

  async listIssues(projectId: string, params?: ListIssuesParams): Promise<Page<Issue>> {
    return wait(this.store.listIssues(projectId, params));
  }

  async getIssue(projectId: string, issueId: string): Promise<IssueWithHistory> {
    return wait(this.store.getIssue(projectId, issueId));
  }

  async createIssue(projectId: string, input: CreateIssueInput): Promise<Issue> {
    return wait(this.store.createIssue(projectId, input));
  }

  async updateIssue(projectId: string, issueId: string, input: UpdateIssueInput): Promise<Issue> {
    return wait(this.store.updateIssue(projectId, issueId, input));
  }

  async assignIssue(projectId: string, issueId: string, assigneeId: string | null): Promise<Issue> {
    return wait(this.store.assignIssue(projectId, issueId, assigneeId));
  }

  async transitionIssue(projectId: string, issueId: string, transitionId: string): Promise<Issue> {
    return wait(this.store.transitionIssue(projectId, issueId, transitionId));
  }

  async deleteIssue(projectId: string, issueId: string): Promise<void> {
    this.store.deleteIssue(projectId, issueId);
    await wait(null);
  }

  async listNotifications(): Promise<Page<Notification>> {
    return wait(this.store.listNotifications());
  }

  async markNotificationRead(notificationId: string): Promise<Notification> {
    return wait(this.store.markNotificationRead(notificationId));
  }

  async markAllNotificationsRead(): Promise<{ updatedCount: number }> {
    return wait(this.store.markAllNotificationsRead());
  }
}
