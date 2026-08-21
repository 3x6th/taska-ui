import type {
  AcceptInvitationInput,
  AuthTokens,
  CreateIssueInput,
  CreateIssueLinkInput,
  CreateProjectInput,
  CreateProjectLabelInput,
  ListCommentsParams,
  ListIssuesParams,
  ListNotificationsParams,
  LoginInput,
  TaskaApi,
  UpdateIssueInput,
  UpdateProjectLabelInput,
} from "../TaskaApi";
import type {
  AdminCatalog,
  AdminRow,
  AdminRowQuery,
  AdminRows,
  AdminRowsQuery,
  AdminTable,
  Issue,
  IssueComment,
  IssueHistoryEvent,
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
} from "../../domain/types";
import type { AdminColumnClass } from "../../lib/adminColumnTypes";
import { classifyColumnType } from "../../lib/adminColumnTypes";

const ANNA_ID = "6d774efa-57d8-4ae0-a27e-2984d1dfbbf6";
const MARK_ID = "e65186a2-b807-42ae-a66f-711be116a93b";
const SOFIA_ID = "16ad2404-96e3-4c51-b00d-55c5d1451d3c";
const TOM_ID = "1ab80365-0843-460a-b0a1-e6dd3e0f2a0d";
const PRIYA_ID = "fdf35fa6-e68b-4dbe-8a48-5867d7f08ce9";

const TASKA_PROJECT_ID = "2e74e49f-0f29-4e03-b4ec-adc4dbf2382e";
const WEB_PROJECT_ID = "58e93598-ea1a-460d-9d72-f1f201c310e2";
const MOB_PROJECT_ID = "f315c5cf-3333-47d1-8d22-79f07c2ec99b";
const OPS_PROJECT_ID = "64d70a2b-72b0-4866-bdbf-4f71a416f9e4";

// Mirrors how RestTaskaApi keeps its tokens in localStorage, so a reload behaves
// the same in both modes: the id of the signed-in user, nothing secret.
const SESSION_KEY = "taska.mockSession";

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

/** Ordinary text ordering, deterministic and not locale-collated. */
const compareAsText = (left: unknown, right: unknown) => {
  const a = String(left);
  const b = String(right);
  return a < b ? -1 : a > b ? 1 : 0;
};

/**
 * Compare a table value the way the read-only admin API compares it: the
 * gateway binds a `BigDecimal` for a numeric column and an `OffsetDateTime` for
 * a temporal one, and the database does the rest.
 *
 * `null` when either side cannot be read as the column's type — a filter value
 * the gateway would have answered 400 for, or an absent cell, neither of which
 * matches anything. Callers that need a total order (sorting) fall back to text.
 *
 * The three implementations have to stay behaviourally interchangeable
 * (AGENTS.md), and this mock is what the e2e suite runs against, so comparing
 * as strings here was not a mock detail: `failed_logins.from=10` matched 9 in
 * every test and would not on the wire, and at a timestamp boundary
 * `"…08:00:00Z" <= "…08:00:00.000Z"` is false, so the mock dropped a row the
 * gateway keeps.
 *
 * What this models is how the gateway *orders and matches* values — not how it
 * *validates* them, and it is uniformly the more permissive of the two.
 * `new Date("2026-01-01")` parses here where `OffsetDateTime.parse` is a 400;
 * `Number("Infinity")` and `Number("0x10")` succeed where `new BigDecimal`
 * throws; and `Number` is float64, so a `bigint` past 2^53 that Postgres
 * compares exactly is compared approximately here. None of that is reachable
 * through the filter form, which picks the value control from the column's type
 * — only through a hand-edited URL. Going further would mean re-implementing
 * `ReadOnlyQueryValidator` in TypeScript and keeping two copies of the
 * backend's parsing rules in sync, which is a worse failure than this one: it
 * stops at ordering deliberately, so do not read it as a promise that anything
 * this function accepts the gateway would accept too.
 */
const compareAsColumn = (columnClass: AdminColumnClass, left: unknown, right: unknown): number | null => {
  if (left === null || left === undefined || right === null || right === undefined) return null;
  if (columnClass === "NUMERIC") {
    const a = Number(left);
    const b = Number(right);
    if (Number.isNaN(a) || Number.isNaN(b)) return null;
    return a < b ? -1 : a > b ? 1 : 0;
  }
  if (columnClass === "TEMPORAL") {
    const a = new Date(String(left)).getTime();
    const b = new Date(String(right)).getTime();
    if (Number.isNaN(a) || Number.isNaN(b)) return null;
    return a - b;
  }
  return compareAsText(left, right);
};

/**
 * The gateway types the row id in `GET /readonly/{service}/{table}/{id}` as a
 * `UUID`, so anything else is refused before admin-service sees it — whatever
 * the table's own key looks like.
 */
/** The contract's own spelling for a label colour: `^#[0-9A-Fa-f]{6}$`. */
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

/** `CreateProjectLabelRequestDto.name` — `minLength: 1, maxLength: 50`. */
const LABEL_NAME_MAX = 50;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A link is stored once, the way it was created, and read from both ends. What
 * each end sees is `viewLinkType` — hence the name — so the issue on the
 * receiving side of a `BLOCKS` reads `IS_BLOCKED_BY`, a value the *request*
 * enum has no name for. That is the reading of the contract's asymmetry this
 * repository works to (docs/ai/API-DIVERGENCE.md); seeding it here is what
 * keeps the UI's open-string handling reachable without a gateway. If the
 * deployed gateway turns out to echo the stored type from both ends instead,
 * this map is the one place that changes.
 */
const inverseViewLinkType: Record<IssueLinkType, string> = {
  BLOCKS: "IS_BLOCKED_BY",
  RELATES_TO: "RELATES_TO",
  DUPLICATES: "IS_DUPLICATED_BY",
};

interface StoredIssueLink {
  id: string;
  projectId: string;
  sourceIssueId: string;
  targetIssueId: string;
  linkType: IssueLinkType;
  createdBy: string;
  createdAt: string;
}

export class MockTaskaStore {
  private users: User[];
  private projects: Project[];
  private membersByProject: Record<string, ProjectMember[]>;
  private issues: Issue[];
  private historyByIssue: Record<string, IssueHistoryEvent[]>;
  private commentsByIssue: Record<string, IssueComment[]>;
  private links: StoredIssueLink[] = [];
  private projectLabels: ProjectLabel[];
  /**
   * Which labels an issue carries, held as ids against `projectLabels` rather
   * than as copies on the issue. A rename or a recolour then shows everywhere
   * at once, and a soft-deleted label leaves every issue it was on — which is
   * what the gateway does (TAS-119) and what copies would quietly get wrong.
   */
  private labelIdsByIssue: Record<string, string[]> = {};
  private notifications: Notification[];
  private workflow: Workflow;
  private currentUserId = ANNA_ID;

  constructor() {
    const ts = (day: number, minute: number) =>
      `2026-06-${String(day).padStart(2, "0")}T09:${String(minute).padStart(2, "0")}:00Z`;

    // Mark is the seed's only GLOBAL_ADMIN so both role displays can be reached
    // by signing in; everyone else, Anna included, is a plain USER.
    this.users = [
      {
        id: ANNA_ID,
        login: "anna",
        email: "anna@example.com",
        displayName: "Anna Ivanova",
        status: "ACTIVE",
        // Deliberately not the colour Anna's own id computes to, and the same
        // goes for Mark and Sofia. A seed that duplicates the computed answer
        // exercises the branch without showing it: the point of seeding three
        // people is that a reader can see which colour came from the server.
        // The three people who do state a colour state one from
        // `avatarColorChoices`, not one of the brighter §2.2 hues those were
        // derived from. This mock does not stand in for some server; it stands
        // in for one that behaves correctly. The "colour came from the server"
        // branch exists for TAS-148, where an admin picks from the set this app
        // itself offers — so a seeded value from outside that set would be
        // demonstrating a case the product does not permit, in the one
        // environment where anybody looks at these colours at all. Same
        // argument as Tom and Priya below: a mock that had depicted reality
        // would not have let TAS-171's flat accent avatars live this long.
        color: "#986004",
        globalRole: "USER",
      },
      {
        id: MARK_ID,
        login: "mark",
        email: "mark@example.com",
        displayName: "Mark Lee",
        status: "ACTIVE",
        color: "#0775a7",
        globalRole: "GLOBAL_ADMIN",
      },
      {
        id: SOFIA_ID,
        login: "sofia",
        email: "sofia@example.com",
        displayName: "Sofia Reyes",
        status: "ACTIVE",
        color: "#c1397c",
        globalRole: "USER",
      },
      {
        id: TOM_ID,
        login: "tom",
        email: "tom@example.com",
        displayName: "Tom Becker",
        status: "ACTIVE",
        // Tom and Priya state no colour on purpose. Every seeded person having
        // one meant the only environment a reviewer or an e2e run can reach
        // always took the "server sent a colour" branch — the branch the live
        // gateway does not have — which is how the flat accent avatars of
        // TAS-171 survived as long as they did. Two of the five now exercise
        // the computed branch instead, and they were the pair that collided
        // with each other anyway.
        globalRole: "USER",
      },
      {
        id: PRIYA_ID,
        login: "priya",
        email: "priya@example.com",
        displayName: "Priya Nair",
        status: "ACTIVE",
        globalRole: "USER",
      },
    ];

    this.projects = [
      // Not `#6366f1`, which is what this key computes to: a seed equal to the
      // computed answer hides the override branch instead of showing it, the
      // same trap the seeded people above avoid. TAS and MOB now demonstrate a
      // stated colour winning; WEB happens to state its computed one, which is
      // honest and costs nothing.
      this.project(TASKA_PROJECT_ID, "TAS", "Taska Platform", "Core gateway, auth and issue services", "#0052cc", [
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
      // OPS states no colour for the same reason as Tom and Priya above: one
      // project has to take the computed path. Its former `#0d9488` was not a
      // member of the palette a computed key draws from either.
      this.project(OPS_PROJECT_ID, "OPS", "Infra and Ops", "CI/CD, observability, on-call", undefined, [
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
          id: "88888888-8888-8888-8888-888888888888",
          fromStatusId: IN_PROGRESS_STATUS_ID,
          toStatusId: TODO_STATUS_ID,
          name: "Move to To Do",
          sortOrder: 25,
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
      labels: [],
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
    this.commentsByIssue = {};
    if (tas107) {
      this.pushHistory(tas107.id, "ASSIGNED", ANNA_ID, { to: SOFIA_ID }, ts(16, 43));
      this.pushHistory(tas107.id, "TRANSITIONED", SOFIA_ID, { from: "TODO", to: "IN_PROGRESS" }, ts(17, 14));
      this.comment(tas107, SOFIA_ID, "Picked this up — the token refresh path needs a retry guard first.", ts(17, 20));
      this.comment(tas107, ANNA_ID, "Agreed. Ping me once the guard is in and I will review.", ts(18, 5));
    }
    if (tas101) {
      this.pushHistory(tas101.id, "TRANSITIONED", MARK_ID, { from: "TODO", to: "IN_PROGRESS" }, ts(13, 31));
      this.pushHistory(tas101.id, "PRIORITY", MARK_ID, { to: "HIGH" }, ts(13, 44));
      this.comment(tas101, MARK_ID, "Bumped to high — this blocks the release checklist.", ts(13, 52));
    }

    // Seeded links so the panel has something to show on first load, and so
    // both directions of the view are reachable: TAS-101 reads "Blocks
    // TAS-102", TAS-102 reads "Is blocked by TAS-101".
    const linkSeed: [string, IssueLinkType, string][] = [
      ["TAS-101", "BLOCKS", "TAS-102"],
      ["TAS-103", "RELATES_TO", "TAS-106"],
      ["TAS-110", "DUPLICATES", "TAS-101"],
      // In a project Anna is not a member of, so the read-only view of this
      // section has something to be read-only about.
      ["MOB-5", "BLOCKS", "MOB-6"],
    ];
    linkSeed.forEach(([sourceKey, linkType, targetKey], index) => {
      const source = this.issues.find((item) => item.issueKey === sourceKey);
      const target = this.issues.find((item) => item.issueKey === targetKey);
      if (!source || !target) return;
      this.links.push({
        id: makeId("link"),
        projectId: source.projectId,
        sourceIssueId: source.id,
        targetIssueId: target.id,
        linkType,
        createdBy: source.reporterId,
        createdAt: ts(19, 10 + index),
      });
    });

    // Labels the projects already own, so the picker is not empty on first
    // load and so a project Anna cannot write to has labels to be read-only
    // about. Colours are the seed's own data, not design tokens: the contract
    // stores a HEX string per label and this is what the server would send.
    const labelSeed: [string, string, string][] = [
      [TASKA_PROJECT_ID, "backend", "#0052cc"],
      [TASKA_PROJECT_ID, "frontend", "#8b5cf6"],
      [TASKA_PROJECT_ID, "tech-debt", "#e3a008"],
      [TASKA_PROJECT_ID, "needs-design", "#ec4899"],
      [WEB_PROJECT_ID, "design", "#ec4899"],
      [WEB_PROJECT_ID, "accessibility", "#3fa863"],
      [MOB_PROJECT_ID, "ios", "#0ea5e9"],
      [MOB_PROJECT_ID, "android", "#3fa863"],
      [OPS_PROJECT_ID, "observability", "#6366f1"],
    ];
    this.projectLabels = labelSeed.map(([projectId, name, color], index) => ({
      id: makeId("label"),
      projectId,
      name,
      color,
      createdBy: ANNA_ID,
      createdAt: ts(9, 10 + index),
      deletedAt: null,
    }));

    const issueLabelSeed: [string, string][] = [
      ["TAS-101", "backend"],
      ["TAS-101", "tech-debt"],
      ["TAS-102", "frontend"],
      ["TAS-103", "frontend"],
      ["TAS-103", "needs-design"],
      ["TAS-107", "backend"],
      ["TAS-110", "tech-debt"],
      ["WEB-13", "design"],
      ["WEB-13", "accessibility"],
      ["MOB-5", "ios"],
    ];
    issueLabelSeed.forEach(([issueKey, labelName]) => {
      const target = this.issues.find((item) => item.issueKey === issueKey);
      const label = this.projectLabels.find(
        (item) => item.projectId === target?.projectId && item.name === labelName,
      );
      if (!target || !label) return;
      (this.labelIdsByIssue[target.id] ??= []).push(label.id);
    });

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

  /**
   * Adopt a session persisted by a previous page load. A stored id that no
   * longer names an active user is not trusted — the caller drops it.
   */
  restoreSession(userId: string): boolean {
    const user = this.users.find((item) => item.id === userId);
    if (!user || user.status !== "ACTIVE") return false;
    this.currentUserId = user.id;
    return true;
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
    const project = this.project(makeId("project"), key, input.name.trim(), input.description || "Project workspace", undefined, [
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
      // The contract's `labelId` query parameter. Filtered on the ids actually
      // attached, so a label that was soft-deleted matches nothing rather than
      // matching the issues it used to be on.
      .filter((item) => !params.labelId || this.labelsForIssue(item.id).some((label) => label.id === params.labelId))
      .sort(byCreatedAt);
    return {
      items: filtered
        .slice(page * pageSize, page * pageSize + pageSize)
        .map((item) => this.issueView(item)),
      page,
      pageSize,
      totalCount: filtered.length,
    };
  }

  getIssue(projectId: string, issueId: string): IssueWithHistory {
    const issue = this.findIssue(projectId, issueId);
    return {
      issue: this.issueView(issue),
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
      labels: [],
    };
    this.issues.push(issue);
    this.historyByIssue[issue.id] = [];
    this.pushHistory(issue.id, "CREATED", this.currentUserId, {});
    this.notifications.unshift(
      this.notification("ISSUE_CREATED", "Issue created", `${issue.issueKey} was created`, `/projects/${projectId}/issues/${issue.id}`, now(), null),
    );
    return this.issueView(issue);
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
    return this.issueView(issue);
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
    return this.issueView(issue);
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
    return this.issueView(issue);
  }

  deleteIssue(projectId: string, issueId: string): void {
    const issue = this.findIssue(projectId, issueId);
    issue.deletedAt = now();
    issue.updatedAt = now();
    issue.version += 1;
    this.pushHistory(issue.id, "UPDATED", this.currentUserId, { field: "deleted" });
  }

  listIssueLinks(projectId: string, issueId: string): IssueLink[] {
    const issue = this.findIssue(projectId, issueId);
    return this.links
      .filter((link) => link.sourceIssueId === issue.id || link.targetIssueId === issue.id)
      .sort(byCreatedAt)
      .map((link) => this.linkView(link, issue.id));
  }

  createIssueLink(projectId: string, issueId: string, input: CreateIssueLinkInput): IssueLink {
    const issue = this.findIssue(projectId, issueId);
    if (input.targetIssueId === issue.id) {
      throw new MockApiError("INVALID_ARGUMENT", "An issue cannot be linked to itself");
    }
    // Unknown target, a target in another project, and a deleted target all
    // answer the same way here, because findIssue is scoped to the project.
    const target = this.findIssue(projectId, input.targetIssueId);
    const existing = this.links.find(
      (link) =>
        (link.sourceIssueId === issue.id && link.targetIssueId === target.id) ||
        (link.sourceIssueId === target.id && link.targetIssueId === issue.id),
    );
    if (existing) {
      throw new MockApiError("ALREADY_EXISTS", `${issue.issueKey} is already linked to ${target.issueKey}`);
    }

    const link: StoredIssueLink = {
      id: makeId("link"),
      projectId,
      sourceIssueId: issue.id,
      targetIssueId: target.id,
      linkType: input.linkType,
      createdBy: this.currentUserId,
      createdAt: now(),
    };
    this.links.push(link);
    return this.linkView(link, issue.id);
  }

  deleteIssueLink(projectId: string, issueId: string, linkId: string): void {
    const issue = this.findIssue(projectId, issueId);
    // Either end may remove the link: the route is issue-scoped, and the issue
    // on the receiving side of a BLOCKS sees the link just as much.
    const link = this.links.find(
      (item) => item.id === linkId && (item.sourceIssueId === issue.id || item.targetIssueId === issue.id),
    );
    if (!link) {
      throw new MockApiError("NOT_FOUND", "Issue link not found");
    }
    this.links = this.links.filter((item) => item.id !== link.id);
  }

  listProjectLabels(projectId: string): ProjectLabel[] {
    this.getProject(projectId);
    return this.projectLabels.filter((label) => label.projectId === projectId && label.deletedAt === null);
  }

  createProjectLabel(projectId: string, input: CreateProjectLabelInput): ProjectLabel {
    this.getProject(projectId);
    const name = this.validLabelName(input.name);
    const color = this.validLabelColor(input.color);
    if (this.findLabelByName(projectId, name)) {
      throw new MockApiError("ALREADY_EXISTS", `This project already has a label called "${name}"`);
    }
    const label: ProjectLabel = {
      id: makeId("label"),
      projectId,
      name,
      color,
      createdBy: this.currentUserId,
      createdAt: now(),
      deletedAt: null,
    };
    this.projectLabels.push(label);
    return label;
  }

  updateProjectLabel(projectId: string, labelId: string, input: UpdateProjectLabelInput): ProjectLabel {
    const label = this.findProjectLabel(projectId, labelId);
    const name = this.validLabelName(input.name);
    const color = this.validLabelColor(input.color);
    // A label keeping its own name is not a duplicate of itself.
    const clash = this.findLabelByName(projectId, name);
    if (clash && clash.id !== label.id) {
      throw new MockApiError("ALREADY_EXISTS", `This project already has a label called "${name}"`);
    }
    label.name = name;
    label.color = color;
    return label;
  }

  /**
   * Soft delete, as the contract's own summary says. The row keeps its place in
   * the store with `deletedAt` set, which is what makes it vanish from the
   * project list *and* from every issue at once: `labelsForIssue` resolves
   * through this list, so nothing has to walk the issues and unpick them.
   */
  deleteProjectLabel(projectId: string, labelId: string): void {
    const label = this.findProjectLabel(projectId, labelId);
    label.deletedAt = now();
  }

  listIssueLabels(projectId: string, issueId: string): Label[] {
    const issue = this.findIssue(projectId, issueId);
    return this.labelsForIssue(issue.id);
  }

  addIssueLabel(projectId: string, issueId: string, labelId: string): void {
    const issue = this.findIssue(projectId, issueId);
    const label = this.findProjectLabel(projectId, labelId);
    const attached = (this.labelIdsByIssue[issue.id] ??= []);
    if (attached.includes(label.id)) {
      throw new MockApiError("ALREADY_EXISTS", `${issue.issueKey} already carries "${label.name}"`);
    }
    attached.push(label.id);
    // "UPDATED" rather than a LABEL_ADDED of our own invention: the gateway's
    // history DTO types `eventType` as a bare string with no enum, so this
    // build has no value to claim. The panel prints "updated this issue".
    this.pushHistory(issue.id, "UPDATED", this.currentUserId, { field: "labels", to: label.name });
  }

  removeIssueLabel(projectId: string, issueId: string, labelId: string): void {
    const issue = this.findIssue(projectId, issueId);
    const attached = this.labelIdsByIssue[issue.id] ?? [];
    if (!attached.includes(labelId)) {
      throw new MockApiError("NOT_FOUND", "This issue does not carry that label");
    }
    this.labelIdsByIssue[issue.id] = attached.filter((id) => id !== labelId);
    this.pushHistory(issue.id, "UPDATED", this.currentUserId, { field: "labels" });
  }

  listComments(projectId: string, issueId: string, params: ListCommentsParams = {}): Page<IssueComment> {
    const issue = this.findIssue(projectId, issueId);
    const page = params.page ?? 0;
    const pageSize = params.pageSize ?? 20;
    // The gateway returns the newest comment first, so "load more" walks backwards in time.
    const comments = [...(this.commentsByIssue[issue.id] ?? [])].sort((a, b) => byCreatedAt(b, a));
    return {
      items: comments.slice(page * pageSize, page * pageSize + pageSize),
      page,
      pageSize,
      totalCount: comments.length,
    };
  }

  addComment(projectId: string, issueId: string, body: string): IssueComment {
    const issue = this.findIssue(projectId, issueId);
    const comment = this.comment(issue, this.currentUserId, this.commentBody(body), now());
    this.pushHistory(issue.id, "COMMENT_CREATED", this.currentUserId, { commentId: comment.id });
    return comment;
  }

  updateComment(projectId: string, issueId: string, commentId: string, body: string): IssueComment {
    const comment = this.findOwnComment(projectId, issueId, commentId);
    comment.body = this.commentBody(body);
    comment.updatedAt = now();
    comment.version += 1;
    this.pushHistory(comment.issueId, "COMMENT_UPDATED", this.currentUserId, { commentId: comment.id });
    return comment;
  }

  deleteComment(projectId: string, issueId: string, commentId: string): void {
    const comment = this.findOwnComment(projectId, issueId, commentId);
    this.commentsByIssue[comment.issueId] = (this.commentsByIssue[comment.issueId] ?? []).filter(
      (item) => item.id !== comment.id,
    );
    this.pushHistory(comment.issueId, "COMMENT_DELETED", this.currentUserId, { commentId: comment.id });
  }

  listNotifications(params: ListNotificationsParams = {}): Page<Notification> {
    const offset = params.offset ?? 0;
    const pageSize = params.pageSize ?? 20;
    const notifications = [...this.notifications]
      .filter((notification) => !params.unreadOnly || !notification.readAt)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return {
      items: notifications.slice(offset, offset + pageSize),
      pageSize,
      offset,
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

  /**
   * The read-only admin API looks at the *services' own tables*, not at the
   * product model, so this is deliberately a separate shape rather than a view
   * over `this.projects` and friends: snake_case columns, database ids, and one
   * column per masking treatment — `MASK_FULL`, `MASK_PARTIAL` and `HIDE` —
   * so all three render paths are reachable without a gateway.
   * Rows are derived from the same seed where it is cheap, so a table the
   * console shows agrees with the app around it.
   *
   * `type` is spelled the way `information_schema.columns.data_type` spells it —
   * `character varying`, not `varchar`; `timestamp with time zone`, not
   * `timestamptz` — because that is what the gateway forwards and what the
   * console classifies a column by. A mock that used the short aliases would
   * offer operators the real gateway then answers 400 for, and no test could
   * see it.
   *
   * The seed deliberately covers what the screen branches on: `auth.users` has
   * a `uuid` primary key (its rows open a card) and a column of every class,
   * while `admin.audit_log` is keyed by text (the gateway takes a `UUID` in the
   * path, so those rows are not addressable and must not pretend to be).
   */
  adminCatalog(): AdminCatalog {
    return {
      services: [
        {
          name: "auth",
          databaseAlias: "taska_auth",
          tables: [
            {
              name: "users",
              primaryKey: "id",
              columns: [
                { name: "id", type: "uuid", sensitive: false },
                { name: "login", type: "character varying", sensitive: false },
                { name: "email", type: "character varying", sensitive: false },
                { name: "display_name", type: "character varying", sensitive: false },
                { name: "status", type: "character varying", sensitive: false },
                { name: "global_role", type: "character varying", sensitive: false },
                { name: "password_hash", type: "character varying", sensitive: true },
                { name: "recovery_email", type: "character varying", sensitive: true },
                { name: "failed_logins", type: "integer", sensitive: false },
                { name: "email_verified", type: "boolean", sensitive: false },
                { name: "created_at", type: "timestamp with time zone", sensitive: false },
              ],
            },
            {
              // Keyed by a uuid *and* long enough to page through, which is the
              // combination the row card needs to be exercised properly: the
              // product tables are all one page, and the only long table in the
              // seed is keyed by a code.
              name: "sessions",
              primaryKey: "id",
              columns: [
                { name: "id", type: "uuid", sensitive: false },
                { name: "user_id", type: "uuid", sensitive: false },
                { name: "token_hash", type: "character varying", sensitive: true },
                { name: "ip_address", type: "inet", sensitive: false },
                { name: "revoked", type: "boolean", sensitive: false },
                { name: "expires_at", type: "timestamp with time zone", sensitive: false },
              ],
            },
          ],
        },
        {
          name: "project",
          databaseAlias: "taska_project",
          tables: [
            {
              name: "projects",
              primaryKey: "id",
              columns: [
                { name: "id", type: "uuid", sensitive: false },
                { name: "project_key", type: "character varying", sensitive: false },
                { name: "name", type: "character varying", sensitive: false },
                { name: "created_by", type: "uuid", sensitive: false },
                { name: "settings", type: "jsonb", sensitive: false },
                { name: "archived_at", type: "timestamp with time zone", sensitive: false },
                { name: "created_at", type: "timestamp with time zone", sensitive: false },
              ],
            },
          ],
        },
        {
          name: "issue",
          databaseAlias: "taska_issue",
          tables: [
            {
              name: "issues",
              primaryKey: "id",
              columns: [
                { name: "id", type: "uuid", sensitive: false },
                { name: "issue_key", type: "character varying", sensitive: false },
                { name: "project_id", type: "uuid", sensitive: false },
                { name: "summary", type: "character varying", sensitive: false },
                { name: "issue_type", type: "character varying", sensitive: false },
                { name: "status", type: "character varying", sensitive: false },
                { name: "priority", type: "character varying", sensitive: false },
                { name: "assignee_id", type: "uuid", sensitive: false },
                { name: "created_at", type: "timestamp with time zone", sensitive: false },
              ],
            },
          ],
        },
        {
          name: "admin",
          databaseAlias: "taska_admin",
          tables: [
            {
              // Keyed by a readable code rather than a uuid, which is the case
              // the gateway cannot address: `GET /readonly/{s}/{t}/{id}` parses
              // `id` as a UUID and refuses everything else before admin-service
              // ever sees it. The console must not offer those rows a link.
              name: "audit_log",
              primaryKey: "id",
              columns: [
                { name: "id", type: "character varying", sensitive: false },
                { name: "actor_id", type: "uuid", sensitive: false },
                { name: "action", type: "character varying", sensitive: false },
                { name: "target", type: "character varying", sensitive: false },
                { name: "duration_ms", type: "integer", sensitive: false },
                { name: "created_at", type: "timestamp with time zone", sensitive: false },
              ],
            },
          ],
        },
      ],
    };
  }

  listAdminRows(query: AdminRowsQuery): AdminRows {
    const table = this.adminTable(query.service, query.table);
    const columns = table.columns.map((column) => column.name);
    // The catalog's own types, which is what makes the comparisons below the
    // gateway's comparisons rather than JavaScript's.
    const typeOf = (column: string) => table.columns.find((item) => item.name === column)?.type;
    let rows = this.adminRowsFor(query.service, query.table);

    for (const filter of query.filters ?? []) {
      if (filter.value === "") continue;
      const columnClass = classifyColumnType(typeOf(filter.column));
      rows = rows.filter((row) => {
        const raw = row[filter.column];
        const value = raw === null || raw === undefined ? "" : String(raw);
        switch (filter.operator) {
          // Case-insensitive only here, matching the gateway: `contains` is
          // ILIKE, everything else compares exactly. Lowercasing all of them
          // made the mock accept `global_admin` where the gateway wants
          // `GLOBAL_ADMIN`, so a filter that worked in every test found nothing
          // in production.
          case "contains":
            return value.toLowerCase().includes(filter.value.toLowerCase());
          case "from": {
            const order = compareAsColumn(columnClass, raw, filter.value);
            return order !== null && order >= 0;
          }
          case "to": {
            const order = compareAsColumn(columnClass, raw, filter.value);
            return order !== null && order <= 0;
          }
          default:
            // Equality is typed too, and for the same reason: the gateway binds
            // a BigDecimal against a numeric column, so `10.0` and `10` are the
            // same row there. Where the value cannot be read as the column's
            // type, the text comparison is the honest fallback.
            return (compareAsColumn(columnClass, raw, filter.value) ?? (value === filter.value ? 0 : 1)) === 0;
        }
      });
    }

    if (query.sort && columns.includes(query.sort)) {
      const direction = query.order === "desc" ? -1 : 1;
      const sortColumn = query.sort;
      const columnClass = classifyColumnType(typeOf(sortColumn));
      rows = [...rows].sort((left, right) => {
        const a = left[sortColumn];
        const b = right[sortColumn];
        // Nulls last whichever way the sort runs: a column full of them at the
        // top is never what the person asking to sort by it wanted.
        if (a === null || a === undefined) return 1;
        if (b === null || b === undefined) return -1;
        // By the column's type, not `localeCompare`: the gateway sorts in the
        // database, where 9 comes before 10 and a timestamp is an instant.
        // Sorting every column as locale-collated text put 10 before 9 and made
        // the order depend on the machine's locale.
        return (compareAsColumn(columnClass, a, b) ?? compareAsText(a, b)) * direction;
      });
    }

    const pageSize = query.pageSize ?? 20;
    const currentPage = query.page ?? 1;
    const totalRows = rows.length;
    const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
    const start = (currentPage - 1) * pageSize;

    return {
      rows: rows.slice(start, start + pageSize),
      pagination: {
        currentPage,
        pageSize,
        totalRows,
        totalPages,
        hasNext: currentPage < totalPages,
        hasPrev: currentPage > 1,
      },
      meta: {
        service: query.service,
        table: query.table,
        columns,
        // Everything is sortable and filterable here. A real service will say
        // less, and the screen reads these lists rather than assuming.
        sortableColumns: columns,
        filterableColumns: columns,
      },
    };
  }

  /**
   * One row by its primary key. A key nobody has fails exactly the way the
   * gateway's 404 reaches the UI, so the card's missing-row state is reachable
   * in mock mode — that state is otherwise unreachable without a database.
   *
   * A key that is not a UUID is refused outright, because that is where the
   * gateway refuses it: the path parameter is typed `UUID`, so
   * `/admin/data/admin/audit_log/AUD-0001` is a 400 there however honest the
   * row behind it. Serving a card the gateway never could made the mock the
   * more permissive of the two, which is the direction that hides bugs — the
   * console refuses to link those rows, and a hand-typed address has to hit the
   * same wall in both modes.
   *
   * Past that, the id is compared as text, which is what admin-service does
   * (`"pk"::text = $1`).
   */
  adminRow(query: AdminRowQuery): AdminRow {
    const table = this.adminTable(query.service, query.table);
    if (!UUID_PATTERN.test(query.id)) {
      throw new MockApiError("INVALID_ARGUMENT", `Row id ${query.id} is not a UUID`);
    }
    const row = this.adminRowsFor(query.service, query.table).find(
      (candidate) => String(candidate[table.primaryKey] ?? "") === query.id,
    );
    if (!row) {
      throw new MockApiError("NOT_FOUND", `No row ${query.id} in ${query.service}.${query.table}`);
    }
    return row;
  }

  /** The catalog entry both admin reads start from, refusing the same two ways. */
  private adminTable(serviceName: string, tableName: string): AdminTable {
    const service = this.adminCatalog().services.find((item) => item.name === serviceName);
    if (!service) {
      throw new MockApiError("NOT_FOUND", `Unknown service ${serviceName}`);
    }
    const table = service.tables.find((item) => item.name === tableName);
    if (!table) {
      // Not NOT_FOUND: the gateway permits or denies a table by config, so a
      // table it will not serve comes back as PERMISSION_DENIED. Unreachable
      // from the console, which only offers catalog tables, and
      // `isMissingOrForbidden` treats both the same — but the mock is the
      // reference implementation, so it should not teach the wrong shape.
      throw new MockApiError("PERMISSION_DENIED", `Table ${serviceName}.${tableName} is not served`);
    }
    return table;
  }

  private adminRowsFor(service: string, table: string): AdminRow[] {
    if (service === "auth" && table === "users") {
      return this.users.map((user, index) => ({
        id: user.id,
        login: user.login,
        email: user.email,
        display_name: user.displayName,
        status: user.status,
        global_role: user.globalRole ?? null,
        // Masked here, not in the client. `admin-service` replaces a
        // `MASK_FULL` column's value with this exact literal before it leaves
        // the server, so a mock that sent the real hash and trusted the console
        // to hide it would be teaching a shape the gateway never sends.
        password_hash: "***",
        // The other half of the same rule: `MASK_PARTIAL` keeps the first and
        // last character and stars the middle, which is a value — degraded, but
        // enough to tell two rows apart — and the console prints it.
        recovery_email:
          user.email.length <= 2
            ? "***"
            : `${user.email[0]}${"*".repeat(user.email.length - 2)}${user.email.slice(-1)}`,
        // Spans one and two digits on purpose: 5 and 10 order one way as
        // numbers and the other way as text, so a numeric column compared as a
        // string — in a filter or in a sort — is visible here rather than only
        // against a real database.
        failed_logins: index * 5,
        email_verified: index % 2 === 0,
        created_at: `2026-06-0${index + 1}T09:00:00Z`,
      }));
    }

    if (service === "auth" && table === "sessions") {
      // Deterministic uuids: a row address has to survive a reload and a
      // copied link, so the ids cannot be regenerated per call.
      return Array.from({ length: 45 }, (_, index) => ({
        id: `9c1f${String(index + 1).padStart(4, "0")}-0000-4000-8000-0000000${String(index + 1).padStart(5, "0")}`,
        user_id: [ANNA_ID, MARK_ID, SOFIA_ID][index % 3],
        // `token_hash` is deliberately absent: a `HIDE` column is deleted from
        // the row altogether, so the console meets a missing key rather than a
        // masked value. The catalog still names it, which is the case the table
        // has to survive — a column with a header and no cell behind it.
        ip_address: `10.0.${index % 8}.${index % 251}`,
        revoked: index % 3 === 0,
        expires_at: `2026-09-${String((index % 28) + 1).padStart(2, "0")}T08:00:00Z`,
      }));
    }

    if (service === "project" && table === "projects") {
      return this.projects.map((project, index) => ({
        id: project.id,
        project_key: project.projectKey,
        name: project.name,
        created_by: project.createdBy,
        // A column the console renders as JSON, and one more type the catalog
        // classifies as neither text nor a number.
        settings: index === 0 ? { board: "kanban", wipLimit: 3 } : null,
        archived_at: project.archivedAt,
        created_at: project.createdAt,
      }));
    }

    if (service === "issue" && table === "issues") {
      return this.issues.map((issue) => ({
        id: issue.id,
        issue_key: issue.issueKey,
        project_id: issue.projectId,
        summary: issue.summary,
        issue_type: issue.issueType,
        status: issue.status,
        priority: issue.priority,
        assignee_id: issue.assigneeId,
        created_at: issue.createdAt,
      }));
    }

    if (service === "admin" && table === "audit_log") {
      // Enough rows that paging is a real control rather than a decoration.
      return Array.from({ length: 47 }, (_, index) => ({
        id: `audit-${String(index + 1).padStart(3, "0")}`,
        actor_id: index % 2 === 0 ? ANNA_ID : MARK_ID,
        action: ["TABLE_READ", "CATALOG_READ", "LOGIN", "ROLE_CHANGED"][index % 4],
        target: ["auth.users", "project.projects", "issue.issues", "admin.audit_log"][index % 4],
        duration_ms: (index % 7) * 11,
        created_at: `2026-07-${String((index % 28) + 1).padStart(2, "0")}T10:${String(index % 60).padStart(2, "0")}:00Z`,
      }));
    }

    return [];
  }

  private project(
    id: string,
    projectKey: string,
    name: string,
    description: string,
    /**
     * Optional because the gateway has no such field: `color` is a label
     * property in the contract, and nothing else. The seeded projects state one
     * so the mock keeps showing the palette DESIGN.md §2.2 chose; anything
     * created at runtime states none and is coloured from its key, which is the
     * path the live gateway takes for every project.
     */
    color: string | undefined,
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

  /** The issue as a reader sees it: the stored record plus its current labels. */
  private issueView(issue: Issue): Issue {
    return { ...issue, labels: this.labelsForIssue(issue.id) };
  }

  /**
   * Resolved through `projectLabels` on every read, in the project's own label
   * order rather than in the order they were attached — the picker below the
   * chips lists them the same way, and two orders for one set of labels reads
   * as a bug even when both are arbitrary.
   */
  private labelsForIssue(issueId: string): Label[] {
    const attached = this.labelIdsByIssue[issueId] ?? [];
    return this.projectLabels
      .filter((label) => label.deletedAt === null && attached.includes(label.id))
      .map(({ id, name, color }) => ({ id, name, color }));
  }

  private findProjectLabel(projectId: string, labelId: string): ProjectLabel {
    this.getProject(projectId);
    const label = this.projectLabels.find(
      (item) => item.projectId === projectId && item.id === labelId && item.deletedAt === null,
    );
    if (!label) {
      throw new MockApiError("NOT_FOUND", "Label not found");
    }
    return label;
  }

  /** Case-insensitive, as TAS-119 asks: "Backend" and "backend" are one name. */
  private findLabelByName(projectId: string, name: string): ProjectLabel | undefined {
    return this.projectLabels.find(
      (item) =>
        item.projectId === projectId &&
        item.deletedAt === null &&
        item.name.toLowerCase() === name.toLowerCase(),
    );
  }

  private validLabelName(value: string): string {
    const name = value.trim();
    if (!name) {
      throw new MockApiError("INVALID_ARGUMENT", "A label needs a name");
    }
    if (name.length > LABEL_NAME_MAX) {
      throw new MockApiError("INVALID_ARGUMENT", `A label name is at most ${LABEL_NAME_MAX} characters`);
    }
    return name;
  }

  private validLabelColor(value: string): string {
    if (!HEX_COLOR_PATTERN.test(value)) {
      throw new MockApiError("INVALID_ARGUMENT", "A label colour must be a #RRGGBB value");
    }
    return value;
  }

  private findIssue(projectId: string, issueId: string): Issue {
    const issue = this.issues.find((item) => item.projectId === projectId && item.id === issueId && item.deletedAt === null);
    if (!issue) {
      throw new MockApiError("NOT_FOUND", "Issue not found");
    }
    return issue;
  }

  /**
   * The stored link as the given issue sees it. Only `viewLinkType` depends on
   * the viewer: `sourceIssueId` and `targetIssueId` keep naming the ends the
   * link was created with, so the caller finds "the other issue" by comparing
   * against the issue it asked about rather than by trusting either field.
   */
  private linkView(link: StoredIssueLink, viewerIssueId: string): IssueLink {
    return {
      id: link.id,
      projectId: link.projectId,
      sourceIssueId: link.sourceIssueId,
      targetIssueId: link.targetIssueId,
      viewLinkType: link.sourceIssueId === viewerIssueId ? link.linkType : inverseViewLinkType[link.linkType],
      createdBy: link.createdBy,
      createdAt: link.createdAt,
    };
  }

  // The gateway rejects edits and deletes from anyone but the comment author.
  private findOwnComment(projectId: string, issueId: string, commentId: string): IssueComment {
    const issue = this.findIssue(projectId, issueId);
    const comment = this.commentsByIssue[issue.id]?.find((item) => item.id === commentId);
    if (!comment) {
      throw new MockApiError("NOT_FOUND", "Comment not found");
    }
    if (comment.authorUserId !== this.currentUserId) {
      throw new MockApiError("PERMISSION_DENIED", "Only the author can modify this comment");
    }
    return comment;
  }

  private commentBody(body: string): string {
    const trimmed = body.trim();
    if (!trimmed || trimmed.length > 10000) {
      throw new MockApiError("INVALID_ARGUMENT", "Comment body must be between 1 and 10000 characters");
    }
    return trimmed;
  }

  private comment(issue: Issue, authorUserId: string, body: string, createdAt: string): IssueComment {
    const comment: IssueComment = {
      id: makeId("comment"),
      issueId: issue.id,
      projectId: issue.projectId,
      authorUserId,
      body,
      createdAt,
      updatedAt: null,
      version: 1,
    };
    this.commentsByIssue[issue.id] = [...(this.commentsByIssue[issue.id] ?? []), comment];
    return comment;
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

/**
 * Deliberate limitation: only the session is gated here. The store's data
 * methods stay readable without one, because the mock doubles as the unit-test
 * fixture (MockTaskaApi.test.ts reads projects and issues without signing in)
 * and as the seed the UI is developed against. The route guard is what this
 * story is about; making the store throw would be a different, larger change.
 */
export class MockTaskaApi implements TaskaApi {
  constructor(private readonly store = new MockTaskaStore()) {
    // The session has to survive a reload the way the REST tokens do, or the
    // route guard would bounce every full page load back to the login form.
    const userId = window.localStorage.getItem(SESSION_KEY);
    if (userId && !this.store.restoreSession(userId)) {
      window.localStorage.removeItem(SESSION_KEY);
    }
  }

  async login(input: LoginInput): Promise<AuthTokens> {
    const tokens = this.store.login(input);
    window.localStorage.setItem(SESSION_KEY, this.store.currentUser().id);
    return wait(tokens);
  }

  // No session is opened here, on purpose: `POST /auth/invitations/accept`
  // answers 204 with no tokens, so `rest` cannot produce one either and the two
  // modes would disagree about whether an activated user is signed in. How an
  // activated user *does* get a session is a hole in the contract — recorded in
  // docs/ai/API-DIVERGENCE.md.
  async acceptInvitation(input: AcceptInvitationInput): Promise<void> {
    this.store.acceptInvitation(input);
    await wait(null);
  }

  async refresh(_refreshToken: string): Promise<AuthTokens> {
    return wait(this.store.refresh());
  }

  async logout(): Promise<void> {
    window.localStorage.removeItem(SESSION_KEY);
    await wait(null);
  }

  async getCurrentUser(): Promise<User> {
    return wait(this.store.currentUser());
  }

  hasSession(): boolean {
    return window.localStorage.getItem(SESSION_KEY) !== null;
  }

  // Implemented, never fired: the mock hands out tokens that never expire and
  // has no server to reject them, so there is no moment at which a session dies
  // on its own. Signing out is not an expiry and does not belong here either.
  onSessionExpired(_listener: () => void): () => void {
    return () => {};
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

  async listIssueLinks(projectId: string, issueId: string): Promise<IssueLink[]> {
    return wait(this.store.listIssueLinks(projectId, issueId));
  }

  async createIssueLink(projectId: string, issueId: string, input: CreateIssueLinkInput): Promise<IssueLink> {
    return wait(this.store.createIssueLink(projectId, issueId, input));
  }

  async deleteIssueLink(projectId: string, issueId: string, linkId: string): Promise<void> {
    this.store.deleteIssueLink(projectId, issueId, linkId);
    await wait(null);
  }

  async listProjectLabels(projectId: string): Promise<ProjectLabel[]> {
    return wait(this.store.listProjectLabels(projectId));
  }

  async createProjectLabel(projectId: string, input: CreateProjectLabelInput): Promise<ProjectLabel> {
    return wait(this.store.createProjectLabel(projectId, input));
  }

  async updateProjectLabel(
    projectId: string,
    labelId: string,
    input: UpdateProjectLabelInput,
  ): Promise<ProjectLabel> {
    return wait(this.store.updateProjectLabel(projectId, labelId, input));
  }

  async deleteProjectLabel(projectId: string, labelId: string): Promise<void> {
    this.store.deleteProjectLabel(projectId, labelId);
    await wait(null);
  }

  async listIssueLabels(projectId: string, issueId: string): Promise<Label[]> {
    return wait(this.store.listIssueLabels(projectId, issueId));
  }

  async addIssueLabel(projectId: string, issueId: string, labelId: string): Promise<void> {
    this.store.addIssueLabel(projectId, issueId, labelId);
    await wait(null);
  }

  async removeIssueLabel(projectId: string, issueId: string, labelId: string): Promise<void> {
    this.store.removeIssueLabel(projectId, issueId, labelId);
    await wait(null);
  }

  async listComments(projectId: string, issueId: string, params?: ListCommentsParams): Promise<Page<IssueComment>> {
    return wait(this.store.listComments(projectId, issueId, params));
  }

  async addComment(projectId: string, issueId: string, body: string): Promise<IssueComment> {
    return wait(this.store.addComment(projectId, issueId, body));
  }

  async updateComment(projectId: string, issueId: string, commentId: string, body: string): Promise<IssueComment> {
    return wait(this.store.updateComment(projectId, issueId, commentId, body));
  }

  async deleteComment(projectId: string, issueId: string, commentId: string): Promise<void> {
    this.store.deleteComment(projectId, issueId, commentId);
    await wait(null);
  }

  async listNotifications(params?: ListNotificationsParams): Promise<Page<Notification>> {
    return wait(this.store.listNotifications(params));
  }

  async markNotificationRead(notificationId: string): Promise<Notification> {
    return wait(this.store.markNotificationRead(notificationId));
  }

  async markAllNotificationsRead(): Promise<{ updatedCount: number }> {
    return wait(this.store.markAllNotificationsRead());
  }

  async getAdminCatalog(): Promise<AdminCatalog> {
    return wait(this.store.adminCatalog());
  }

  async listAdminRows(query: AdminRowsQuery): Promise<AdminRows> {
    return wait(this.store.listAdminRows(query));
  }

  async getAdminRow(query: AdminRowQuery): Promise<AdminRow> {
    return wait(this.store.adminRow(query));
  }
}
