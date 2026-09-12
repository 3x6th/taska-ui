/**
 * The four states an account can be in — `UserStatusDto` in the contract
 * (docs/contract/openapi.yml), and `USER_STATUS_LOCKED = 4` in `common.proto`.
 *
 * `LOCKED` was widened into this union by TAS-188 a build *before* the backend
 * could produce it, deliberately: at `ref=develop` on 2026-09-05 the entity
 * enum stopped at `INVITED`, the proto enum at `USER_STATUS_BLOCKED = 3`, and
 * `handleFailedAttempt(Credential)` wrote no status at all. All four of those —
 * plus `resetFailedAttempts` restoring `ACTIVE` — shipped in backend PR #146,
 * which merged on 2026-09-07 and is deployed, so the value is live now and the
 * bet came off.
 *
 * What earns it a value of its own: `LOCKED` is **not** an
 * administrative state, and no write this client makes reaches it. An account
 * locks itself after `maxFailedAttempts` failed sign-ins and the next
 * successful one releases it, which is why `block` and `unblock` are both
 * refused from it and `resetCredentialLockout` (src/api/TaskaApi.ts) is the
 * only write that leaves it.
 *
 * A value outside this union can still arrive, and adding to the union is not
 * what stops it: `GET /users/me` answers the gateway's own `GatewayUserStatus`,
 * which has no `LOCKED` and reports `UNSPECIFIED` instead. So every reader
 * still prints an unrecognised status verbatim rather than trusting the type
 * (TAS-173, `userStatusLabel` in src/screens/admin/users.ts).
 */
export type UserStatus = "INVITED" | "ACTIVE" | "BLOCKED" | "LOCKED";
/**
 * The account-wide role from `GET /users/me`, not a project role — `ProjectRole`
 * below is the per-project one and the two never substitute for each other.
 *
 * The contract's third value, `UNSPECIFIED`, is deliberately not modelled: it is
 * a proto-style zero value meaning "not stated", so it is normalised away in the
 * API layer and reaches the domain as a missing `globalRole`, exactly like a
 * gateway that does not send the field at all.
 */
export type GlobalRole = "USER" | "GLOBAL_ADMIN";
export type ProjectRole = "ADMIN" | "MEMBER" | "VIEWER";
export type IssueType = "TASK" | "BUG" | "STORY";
export type IssuePriority = "LOW" | "MEDIUM" | "HIGH";
export type IssueStatus = "TODO" | "IN_PROGRESS" | "DONE";
export type NotificationType =
  | "ISSUE_ASSIGNED"
  | "ISSUE_TRANSITIONED"
  | "ISSUE_CREATED"
  | "ISSUE_UPDATED"
  | "ISSUE_DELETED"
  | "USER_INVITED"
  | "USER_ACTIVATED"
  | "PROJECT_CREATED"
  | "MEMBER_ADDED"
  | "MEMBER_UPDATED"
  | "MEMBER_REMOVED"
  | "MEMBER_ROLE_CHANGED";

export interface User {
  id: string;
  login: string;
  email: string;
  displayName: string;
  status: UserStatus;
  // Not in the contract at all — `color` there belongs to a label and to
  // nothing else — so today this arrives only from the mock. It is load-bearing
  // anyway: a value here beats the colour `avatarColor` computes from the id,
  // which is the hook a chosen colour would arrive through (TAS-148).
  color?: string;
  // Optional because the deployed gateway may not carry the field yet, and
  // because UNSPECIFIED collapses to the same absence. Never inferred from the
  // JWT, and it grants nothing on its own — the server stays authoritative.
  globalRole?: GlobalRole;
}

/**
 * What `POST /admin/users/{userId}/block`, `.../unblock` and
 * `.../reset-lockout` answer with — `UserStatusResponseDto`. The server states
 * the transition it performed, both ends of it, so the caller never has to
 * infer what happened from what it asked for.
 *
 * `previousStatus` and `currentStatus` are the domain's own `UserStatus`
 * because the contract declares them as that enum, exactly as it declares the
 * status on `User` — this is not the open-string case of
 * `IssueLink.viewLinkType`, where the contract types the field as a bare
 * string.
 *
 * `changedAt` — **not** `updatedAt`, which is what this field was called until
 * TAS-188. The gateway's `AdminUserManagementMapper.toRestUserStatusResponse`
 * calls `setChangedAt`, and `UserStatusResponseDto` lists `changedAt` among its
 * required properties, so the old name read `undefined` out of every successful
 * response while the type still promised a `string`.
 *
 * It is modelled because the contract declares it, and it **is not drawn
 * anywhere**. The reason it is not drawn is no longer that it is a second
 * clock: auth-service builds the response as
 * `.changedAt(savedUser.getUpdatedAt())` on an entity carrying
 * `@LastModifiedDate`, so this *is* the `updated_at` of the `auth.users` row it
 * changed, to the same instant. What it is not is the row itself. The list this
 * value would decorate is refetched immediately after the write, and the
 * refetched row carries its own `updated_at` — so the section reads one source
 * for the whole table rather than patching one row's timestamp from a response
 * and the rest from a list.
 */
export interface UserStatusChange {
  userId: string;
  previousStatus: UserStatus;
  currentStatus: UserStatus;
  changedAt: string;
}

export interface Project {
  id: string;
  projectKey: string;
  name: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  /**
   * The reader's own role in this project — `currentUserRole` on
   * `ProjectResponseDto`, added by backend PR #152 (TAS-137).
   *
   * Optional **and** nullable, and both for real reasons on the wire rather
   * than a style choice — corrected here from an earlier version of this
   * comment, which called it "optional rather than nullable" and was wrong.
   * Nullable because the api-gateway configures no Jackson inclusion override
   * anywhere — no `spring.jackson` block in its `application.yml`, no
   * `ObjectMapper` or codec customizer bean — so Jackson's default `ALWAYS`
   * inclusion applies, and a reader for whom `hasCurrentUserRole()` is false
   * still gets the key, as an explicit `"currentUserRole": null` — exactly
   * like `archivedAt` above. Optional because a gateway that predates PR #152
   * does not carry the key at all. The client reads both the same way,
   * because the gateway has not committed to sending one rather than the
   * other.
   *
   * Typed as the closed set because it is one. `ProjectMapper.toRestProjectRole`
   * emits exactly ADMIN, MEMBER or VIEWER and throws 500 on anything else, so
   * an unrecognised project role fails the read instead of arriving here.
   * `ProjectMember.role` below is the other case and is *not* a closed set.
   *
   * **Undeployed on 2026-09-12**: PR #152 was still open, so every
   * `GET /projects/{id}` on the stand answers without this field and readers of
   * it take their floor.
   */
  currentUserRole?: ProjectRole | null;
  /**
   * Both of the next two are added to `ProjectResponseDto` by backend PR #155
   * (TAS-145), pinned at `docs/contract/pending/pr-155-TAS-145.yml`, and both
   * are `nullable: true` there. **Open and undeployed on 2026-09-12**, so
   * `docs/contract/openapi.yml` — the authority — still carries neither, and on
   * the stand the only values either field ever holds are the mock's.
   *
   * Optional *and* nullable for the same reason `currentUserRole` above is: a
   * gateway that predates the PR omits the key, and one that has it sends an
   * explicit `null` for a project that stated no value, because the api-gateway
   * configures no Jackson inclusion override. Readers must treat the two alike.
   *
   * An empty-string `description` is a third state and a meaningful one: the
   * schema's `maxLength: 2000` accepts it, so `""` is how a description is
   * cleared through `PATCH`. Anything drawing a placeholder for "no
   * description" therefore has to cover blank as well as absent — `??` alone
   * does not.
   */
  description?: string | null;
  /**
   * The colour an admin chose, which wins over the one `keyBadgeStyle` computes
   * from the project key. `""` is *not* a third state here, in deliberate
   * contrast with `description` above: the schema's `^#[0-9A-Fa-f]{6}$` rejects
   * it, and an absent `color` and an explicit `null` both mean "keep" on the
   * PATCH — so there is no way through the contract to put a colour back to
   * null once one is set (TAS-145 is the backend story that would add one).
   */
  color?: string | null;
  memberIds?: string[];
}

export interface ProjectMembership {
  role: ProjectRole;
  isMember: boolean;
  projectExists: boolean;
}

/**
 * One row of `GET /projects/{projectId}/members` — `ProjectMemberDetailsDto`
 * in backend PR #152 (TAS-137), which is where `displayName` and `email` come
 * from. That PR was open and undeployed on 2026-09-12, so on the stand these
 * rows are synthesised by `HybridTaskaApi` rather than read from anywhere.
 */
export interface ProjectMember {
  userId: string;
  /**
   * `null` means the server did not state a role this build can act on —
   * corrected here from an earlier version of this comment, which named
   * `ANY_UNMAPPED → UNSPECIFIED` as the mechanism and was wrong: that mapping
   * is the *inbound write* path, not what fills this field. The read path is
   * MapStruct's built-in enum-to-string conversion (`.name()`), off a column a
   * CHECK constraint confines to ADMIN, MEMBER and VIEWER
   * (`ck_project_members_role`, project-service `0000-init.sql`) — so
   * "UNSPECIFIED" is not actually on the wire today. What this narrowing
   * guards against is a role the enum grows later, returned verbatim (say
   * "OWNER") before this build has a name for it. `Project.currentUserRole`
   * above cannot carry even that: a different mapper, and one that throws 500
   * rather than ever emit a role it does not recognise.
   *
   * Nothing draws this field today. Whatever eventually does reads `null` as
   * "the server did not state a role we can act on", never as a role of its own.
   */
  role: ProjectRole | null;
  /**
   * Both optional because `ProjectMemberDetailsDto` carries neither: the row is
   * `userId`, `role`, `displayName`, `email` and an avatar, and nothing else.
   * The only values that exist are `HybridTaskaApi`'s, synthesised from the
   * project's own `createdAt`/`createdBy` while the member route is undeployed,
   * and nothing outside that synthesis reads them.
   */
  addedAt?: string;
  addedBy?: string;
  /**
   * Absent when the row named nobody. Callers key off its presence to choose
   * between drawing a person and falling to their own unknown-person path
   * (`toUserMap` in BoardScreen filters on exactly this), so a `user` carrying
   * a blank `displayName` would be worse than no `user` at all.
   */
  user?: Pick<User, "displayName" | "email" | "color">;
}

export interface WorkflowStatus {
  id: string;
  statusKey: IssueStatus;
  name: string;
  category: IssueStatus;
  sortOrder: number;
}

export interface WorkflowTransition {
  id: string;
  fromStatusId: string;
  toStatusId: string;
  name: string;
  sortOrder: number;
}

export interface Workflow {
  id: string;
  name: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  statuses: WorkflowStatus[];
  transitions: WorkflowTransition[];
}

/**
 * A label as an *issue* carries it — the contract's `IssueLabelResponseDto`,
 * and the same three fields `IssueResponseDto.labels[]` holds. Deliberately not
 * an alias for `ProjectLabel` below: three fields is everything the issue side
 * of the contract is ever told, and typing it as the project record would put
 * `createdBy` and `deletedAt` in scope for code that has never been sent them.
 */
export interface Label {
  id: string;
  name: string;
  color: string;
}

/**
 * A label as the *project* owns it (`ProjectLabelResponseDto`). `deletedAt` is
 * the contract's soft delete: a removed label keeps its row and stops being
 * returned by the list. Whether it also comes off the issues already carrying
 * it is *this repository's* reading of TAS-119, not something the contract
 * states or the gateway has been observed doing — the mock implements it that
 * way, and nothing here depends on the gateway agreeing. Nothing in this app
 * asks for deleted labels, so in practice this is `null` wherever it is read —
 * it is modelled because the field is in the response, not because a screen
 * branches on it.
 */
export interface ProjectLabel extends Label {
  projectId: string;
  createdBy: string;
  createdAt: string;
  deletedAt: string | null;
}

/**
 * A calendar date with no time and no zone — `YYYY-MM-DD`, the contract's
 * `format: date`, a `LocalDate` on the gateway and a `date` column in
 * `taska.issues`.
 *
 * **It is a `string` and it must never become a `Date`.** `new Date("2026-09-01")`
 * is parsed by the spec as UTC midnight, and every formatter this app owns
 * prints in the viewer's zone — so anyone west of UTC reads *2026-08-31* for a
 * due date the server, the database and the person who typed it all call the
 * 1st. There is no formatting option that repairs it after the fact, because by
 * then the value is an instant and the day has already been chosen. That is the
 * trap this alias exists to close: keep the wire's three fields as text, split
 * them when they need to be drawn, and never hand one to the `Date`
 * constructor.
 *
 * Two more things follow from it being text, and both are worth having:
 * ISO-8601 dates sort and compare correctly as strings (`"2026-01-02" <
 * "2026-03-01"`), so every comparison in the API layer is a string comparison;
 * and equality is exact, with no instant to round.
 *
 * The alias is not branded. A brand would make every literal need a cast for a
 * guarantee TypeScript cannot keep anyway — the value arrives from the network
 * — so the guarantee is `isDateOnly` below, applied where a value enters.
 */
export type DateOnly = string;

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const isLeapYear = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

/**
 * Whether a string is a date the wire would accept: four-digit year, two-digit
 * month, two-digit day, and a day that exists.
 *
 * The shape check alone is not enough, which is the whole reason this is a
 * function rather than a regular expression at each call site. `2026-13-01`
 * and `2026-02-30` both match `\d{4}-\d{2}-\d{2}` and both are refused by
 * `LocalDate.parse` on the gateway with a `400` — so they are refused here
 * too, before a request is spent on them.
 *
 * Written as arithmetic rather than through `Date`, deliberately. Checking a
 * date by constructing one and reading the parts back is the same UTC-midnight
 * trap the alias above is about, and it also silently accepts overflow in some
 * engines. A leap-year rule is four lines and cannot drift with a zone.
 *
 * This is the one runtime export in this file. It lives here because it is the
 * type's own definition of validity, and a caller that has a `DateOnly` in hand
 * should not have to know which module remembers what one is.
 */
export function isDateOnly(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return false;
  const lastDay = month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1];
  return day >= 1 && day <= lastDay;
}

export interface Issue {
  id: string;
  projectId: string;
  issueNumber: number;
  issueKey: string;
  issueType: IssueType;
  summary: string;
  description: string;
  status: IssueStatus;
  priority: IssuePriority;
  assigneeId: string | null;
  reporterId: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  deletedAt: string | null;
  /**
   * `IssueResponseDto.labels`. Always an array by the time it is read — the API
   * layer defaults an absent one to `[]` — so a card never has to ask whether
   * the gateway sent the field. The list endpoint answers with that same DTO
   * since TAS-195 and carries the labels itself (measured on the deployed
   * gateway 2026-09-08), which is where the board's chips come from; before
   * that `listIssues` hydrated every row from the detail endpoint to get them.
   */
  labels: Label[];
  /**
   * The five planning fields — `IssueResponseDto`'s `storyPoints`, `startDate`,
   * `dueDate`, `originalEstimateMinutes` and `remainingEstimateMinutes`, added
   * by TAS-116 (merged PR #148) and now part of the contract proper:
   * docs/contract/openapi.yml, backend develop `21a0d9d177a1`. The deployed
   * gateway's own `/v3/api-docs` declares all five on `IssueResponseDto`
   * (measured 2026-09-11, docs/ai/API-DIVERGENCE.md) — but a declaration is not
   * a response, and no body carrying one of the five has been read.
   *
   * **`null` is the only "not set", for all five.** The wire cannot tell an
   * absent key from a JSON `null` and the server never means the difference:
   * the gateway's mapper writes a field only when the proto optional is
   * present, and an unset optional resolves to a Java `null`. Making them
   * `number | null` rather than optional is what stops a reader from having to
   * ask which of two spellings of nothing arrived.
   *
   * `storyPoints` is `format: double`, so **0.5 is a legal value** and this is
   * never an integer. The column is `numeric(5,2)` (`0007-issue-planing-fields.sql`),
   * which is where the 0…999.99 bound in src/api/planningFields.ts comes from.
   * `0` is legal too, and is a count rather than an absence — the one
   * distinction an `||` anywhere near this field would erase.
   *
   * The two estimates are `int32` minutes, whole numbers, `>= 0`.
   */
  storyPoints: number | null;
  startDate: DateOnly | null;
  dueDate: DateOnly | null;
  originalEstimateMinutes: number | null;
  remainingEstimateMinutes: number | null;
}

/**
 * One result of `GET /issues/search` — the contract's `IssueShortResponseDto`,
 * and **not** an `Issue`.
 *
 * Seven fields is everything the search route is ever told — six until merged
 * PR #148 added `storyPoints` to `IssueShortResponseDto`. There is no `status`,
 * no `projectId`, no `description`, no `labels`, no `updatedAt` and no
 * `version`, which is why this is its own type rather than a `Partial<Issue>`
 * or an `Issue` with holes punched in it: a hit that was typed as an issue
 * would let a column, a card or a drop target read a status the server never
 * sent.
 *
 * Two consequences shape the feature rather than decorate it. A hit cannot be
 * placed in a board column, so the board renders server hits as their own group
 * (DESIGN.md §5.4 counts them, §5.2 does not hold them). And a hit needs a
 * `projectId` to be linkable, which is resolved from the `issueKey` prefix
 * against the projects list the client already holds — see
 * `projectKeyFromIssueKey`. Deliberately not hydrated through `getIssue` — the
 * owner settled the general question on 2026-08-23 (docs/ai/API-DIVERGENCE.md,
 * TAS-178): fix the backend, do not hydrate on the frontend. `listIssues` used
 * to pay exactly that N+1 and stopped in TAS-195, when its DTO grew into a
 * whole issue; this one did not, so hydrating here would be a `getIssue` per
 * hit on every keystroke.
 */
export interface IssueSearchHit {
  id: string;
  issueKey: string;
  issueType: IssueType;
  summary: string;
  priority: IssuePriority;
  /** `""` on the wire for an unassigned issue; normalised to `null` like `Issue.assigneeId`. */
  assigneeId: string | null;
  /**
   * The **one** planning field the search DTO carries: `IssueShortResponseDto`
   * in docs/contract/openapi.yml states `storyPoints` and nothing else of the
   * five — no dates, no estimates.
   *
   * Do not widen this type past it. The narrowness is the point — a hit that
   * grew a `dueDate` the server never sent would be drawn as an empty date on
   * every search result, which reads as "no due date" rather than as "not
   * asked for".
   */
  storyPoints: number | null;
}

/**
 * Who a board card is assigned to — `BoardUserDto`, and two fields is all of
 * it. Not a `User` and not a `ProjectMember`: the board route is told an id and
 * a name and nothing else, so typing this as a person would put an email, a
 * status and a colour in scope for a card that was never sent them.
 *
 * `displayName` is `string | null`. The deployed gateway answered
 * `{"id":"275417fd-…","displayName":null}` for **every** assigned issue on
 * 2026-09-09 — not by chance: `IssueBoardResponse` in the backend's
 * `v1/issue-service.proto` carries `assignee_id` (field 6) and no name field
 * of any kind, and `IssueMapper.toRestBoardIssue` builds `BoardUserDto` with
 * `setId` alone — `setDisplayName` appears nowhere in the gateway. So it is
 * null on every branch that exists today, exactly like `storyPoints` ten
 * lines below: a caller that wants to print a person's name resolves the id
 * against the members it already holds.
 */
export interface BoardAssignee {
  id: string;
  displayName: string | null;
}

/**
 * One card on the board — `BoardIssueDto`, and deliberately not an `Issue`.
 * Six fields is everything this route is ever told: no `status` (the column
 * carries it), no `priority`, no `projectId`, no `description`, no dates and no
 * estimates. Same rule as `IssueSearchHit` above — do not widen it into an
 * issue it never was.
 */
export interface BoardIssue {
  id: string;
  issueKey: string;
  summary: string;
  /**
   * `??`, never `||`, at every reader: an issue estimated at zero points has
   * been estimated. Absent on the wire is `null`, and the deployed gateway
   * answered `null` for every issue measured on 2026-09-09 — not by chance:
   * `IssueBoardResponse` in the backend's `v1/issue-service.proto` has no
   * `story_points` field, and `IssueMapper.toRestBoardIssue` never sets one, so
   * the field cannot be filled by any branch that exists today.
   */
  storyPoints: number | null;
  assignee: BoardAssignee | null;
  /**
   * The wire field is `labels` and it carries label **ids**, not names —
   * measured against the deployed gateway on 2026-09-09, where every value was
   * a uuid matching a row of `GET /projects/{projectId}/labels`. Renamed here
   * for what it holds, so nothing can print it as a chip by mistake.
   */
  labelIds: string[];
}

/**
 * One column — `BoardColumnDto`. A workflow status of the asked-for issue type,
 * plus the issues sitting in it.
 *
 * **`statusKey` and `category` are plain strings and must stay that way.**
 * `WorkflowStatus` narrows both to `IssueStatus` because this build has only
 * ever been shown three; the board's columns come straight out of whatever
 * workflow the project has, and a value outside that union is a project
 * configuration rather than a bug. Narrowing them is how TAS-173 and TAS-199
 * blanked screens — the type would say the case cannot happen and the renderer
 * would then not draw it.
 */
export interface BoardColumn {
  statusKey: string;
  name: string;
  category: string;
  sortOrder: number;
  issues: BoardIssue[];
}

/**
 * `GET /projects/{projectId}/board` — `BoardResponseDto`. One issue type's
 * columns, in the workflow's own `sortOrder` (10/20/30 for TODO/IN_PROGRESS/DONE
 * on the deployed gateway, measured 2026-09-09).
 *
 * `issueType` is the echo of what the caller asked for: the route requires the
 * parameter, so a board is always about exactly one type and there is no "all".
 *
 * The `includeDone` filter drops *issues*, never columns: without it the DONE
 * column still arrives, carrying an empty `issues` array.
 */
export interface Board {
  projectId: string;
  issueType: IssueType;
  columns: BoardColumn[];
}

export type IssueEventType =
  | "CREATED"
  | "TRANSITIONED"
  | "ASSIGNED"
  | "PRIORITY"
  | "UPDATED"
  | "DELETED"
  | "COMMENT_CREATED"
  | "COMMENT_UPDATED"
  | "COMMENT_DELETED"
  /**
   * The two the attachment routes write, both already on backend `develop`:
   * `AttachmentTransactionExecutor` saves an `ATTACHMENT_UPLOADED` history row
   * inside the same transaction as the insert, and an `ATTACHMENT_DELETED` one
   * inside the soft delete (read at PR #147's head `f53dca38`, where
   * `issue-service/.../domain/IssueEventType.java` lists fourteen members).
   *
   * Added because the union being closed is not what protects the activity
   * feed — `historyText` ends in a catch-all `return "updated this issue"`, so
   * before this every upload rendered as *"Anna updated this issue"*, a
   * sentence about the wrong event with nothing on screen to contradict it.
   * Widening the type is only half the fix; the branch in `historyText` is the
   * other half, and neither works alone.
   *
   * The gateway does **not** constrain this field — `IssueHistoryResponseDto`
   * types `eventType` as a bare `type: string` with no enum — so this union is
   * a statement about the values this build can *name*, never a guarantee about
   * what arrives. Four more the backend already emits (`LINK_CREATED`,
   * `LINK_DELETED`, `LABEL_ADDED`, `LABEL_REMOVED`) are still missing from it
   * and still land in the catch-all; they are out of this story's scope and are
   * recorded rather than quietly added here.
   */
  | "ATTACHMENT_UPLOADED"
  | "ATTACHMENT_DELETED";

export interface IssueHistoryEvent {
  id: string;
  issueId: string;
  eventType: IssueEventType;
  actorUserId: string;
  occurredAt: string;
  payload: {
    from?: IssueStatus;
    to?: IssueStatus | IssuePriority | string | null;
    field?: string;
    fromStatus?: IssueStatus;
    toStatus?: IssueStatus;
    assigneeId?: string | null;
    previousAssigneeId?: string | null;
    oldPriority?: IssuePriority;
    newPriority?: IssuePriority;
    /**
     * `PayloadSerializer.createAttachmentUploadedPayload` and
     * `createAttachmentDeletedPayload` both put the file name here, and it is
     * the only field of either payload the activity feed prints. The rest —
     * `attachmentId`, `uploadedBy`, `deletedBy`, `contentType`, `sizeBytes` —
     * arrive too and are reachable through the index signature; they are not
     * declared because nothing draws them, and a declared field nobody reads is
     * a promise about a payload this app has never seen.
     */
    fileName?: string;
    [key: string]: unknown;
  };
}

/**
 * One file attached to an issue — `IssueAttachmentDto` in backend PR #147
 * (`docs/contract/pending/pr-147-TAS-131.yml`), field for field.
 *
 * `sizeBytes` is `format: int64` on the wire and a `number` here, and that is
 * safe rather than convenient: the server refuses anything above
 * `ATTACHMENT_MAX_SIZE_BYTES` (2097152) at leg 1 *and* re-measures the stored
 * object at leg 3, so no row this type describes can hold a value within eleven
 * orders of magnitude of `Number.MAX_SAFE_INTEGER`. A `bigint` would buy
 * nothing and would cost every caller an arithmetic conversion to divide by
 * 1024.
 *
 * `objectKey` is deliberately absent: the gateway's mapper
 * (`IssueAttachmentMapper.toIssueAttachmentDto`) never sets it, so no client
 * has ever seen one on a listed attachment. It exists only inside one upload,
 * as the value leg 1 hands to leg 3, and that is where it stays.
 *
 * A presigned download URL is absent for the same reason and it is worth
 * stating, because the service one layer down *does* mint one per row:
 * `AttachmentServiceImpl.listAttachments` builds a presigned GET for every
 * attachment and the gateway's mapper drops it. So `GET .../download-url` is
 * not a redundant second call — it is the only way this contract offers a link.
 */
export interface IssueAttachment {
  id: string;
  issueId: string;
  fileName: string;
  /** Exactly as it was signed. Never normalised, never recomputed from the extension. */
  contentType: string;
  sizeBytes: number;
  uploadedBy: string;
  /**
   * The object's ETag with its quotes stripped, which for a single-part PUT is
   * the MD5 of the bytes. `nullable: true` in the contract and blank-to-`null`
   * in the gateway's mapper, though the column itself is `NOT NULL` — so a
   * `null` here means "the gateway sent an empty string", not "the row has no
   * checksum".
   */
  checksum: string | null;
  createdAt: string;
}

/** What leg 1 hands back: where to PUT the bytes, and what to call the object at leg 3. */
export interface AttachmentUploadTicket {
  /**
   * A presigned S3 URL on `storage.public-url`, **not on the gateway**. The
   * signature is in the query string, it covers the `Content-Type` header, and
   * it is honoured for `ATTACHMENT_PRESIGNED_TTL_MS` from the moment this
   * ticket was minted.
   */
  uploadUrl: string;
  /** Opaque; a bare UUID today. The only thing leg 3 identifies the object by. */
  objectKey: string;
}

/** `GetAttachmentDownloadUrlResponseDto` — a presigned GET, and the checksum again. */
export interface AttachmentDownloadUrl {
  downloadUrl: string;
  checksum: string | null;
}

export interface IssueWithHistory {
  issue: Issue;
  history: IssueHistoryEvent[];
}

/**
 * The link type a *request* may ask for — the contract's `IssueLinkTypeDto`,
 * a closed enum. Deliberately not reused for the response: see `IssueLink`.
 */
export type IssueLinkType = "BLOCKS" | "RELATES_TO" | "DUPLICATES";

export interface IssueLink {
  id: string;
  projectId: string;
  sourceIssueId: string;
  targetIssueId: string;
  /**
   * Open on purpose. The contract asks for `linkType` (the closed enum above)
   * and answers with `viewLinkType`, typed as a bare `string` with no enum —
   * the asymmetry is the contract's, not a typo to be corrected here. Read
   * literally, "view" means the relation *as seen from the issue that was
   * asked about*, so the response may legitimately carry the inverse of a
   * request value (`IS_BLOCKED_BY` for a `BLOCKS` link) which the request enum
   * has no name for. Narrowing this to `IssueLinkType` would therefore drop
   * exactly the values that make the field worth having.
   *
   * Presentation narrows it instead (`issueLinkTypeLabel`): a known value gets
   * a written label, anything else is humanised verbatim. Recorded in
   * docs/ai/API-DIVERGENCE.md and unverified against the deployed gateway.
   */
  viewLinkType: string;
  createdBy: string;
  createdAt: string;
}

/**
 * One subscription row — `IssueWatcherResponseDto`.
 *
 * **It names nobody.** The only thing here that identifies a person is
 * `userId`, exactly as with `Issue.assigneeId` and `IssueAttachment.uploadedBy`,
 * and it is resolved the same way: through the `userById` map the board builds
 * from `GET /projects/{id}/members`. That read is a 405 on the deployed gateway
 * (TAS-137), so a watcher degrades to "Unknown" in `rest` mode precisely as the
 * reporter line already does — one mechanism, one failure, no second invention.
 *
 * `createdBy` is not `userId`: a project ADMIN may subscribe somebody else
 * through `POST .../watchers`, and then the two differ.
 */
export interface IssueWatcher {
  /** The subscription's own id. Never the user's. */
  id: string;
  issueId: string;
  projectId: string;
  /** The subscribed person. */
  userId: string;
  createdAt: string;
  createdBy: string;
}

/**
 * `ListIssueWatchersResponseDto` — and the two fields are kept apart on purpose.
 *
 * `totalCount` is the server's own answer to "how many", stated beside the
 * array rather than derived from it, and it is what the UI prints. The array is
 * what the UI lists. Reading the count off `watchers.length` would be this
 * side deciding a number the server already sent, and the route takes no paging
 * parameter, so if the two ever disagree there is nothing the client could ask
 * to reconcile them — printing the field the contract calls the total is the
 * only reading that cannot be wrong on purpose.
 *
 * `null` means the server did not send it. No field of this DTO is `required`,
 * so an answer with only `watchers` is legal, and "the server did not say" must
 * not arrive at a screen looking like the number zero.
 */
export interface IssueWatchers {
  watchers: IssueWatcher[];
  totalCount: number | null;
}

/** `WatchIssueResponseDto` — the row that now exists, and the count after it. */
export interface WatchIssueResult {
  /**
   * `null` when the response omitted it. Nothing in the UI needs the row — the
   * caller knows who was subscribed, because it asked — so this is carried for
   * completeness rather than read.
   */
  watcher: IssueWatcher | null;
  /** The count after the write, `null` when the server did not state one. */
  watchersCount: number | null;
}

/**
 * `UnwatchIssueResponseDto`, and `removed` is the field this whole type exists
 * for.
 *
 * `removed: false` is a **successful** response saying that nothing was
 * deleted, because there was no subscription to delete. The end state is the
 * one that was asked for either way, so this is not a failure and must not be
 * shown as one — but it is also not the change the reader thinks they just
 * made, and flattening the two is how a UI comes to report events that did not
 * happen (the same distinction TAS-194 drew for the outbox retry).
 */
export interface UnwatchIssueResult {
  issueId: string;
  /** Whether a subscription was actually deleted, as opposed to never existing. */
  removed: boolean;
  /** The count after the write, `null` when the server did not state one. */
  watchersCount: number | null;
}

export interface IssueComment {
  id: string;
  issueId: string;
  projectId: string;
  authorUserId: string;
  body: string;
  createdAt: string;
  updatedAt: string | null;
  version: number;
}

export interface Notification {
  id: string;
  userId: string;
  notificationType: NotificationType;
  title: string;
  body: string;
  link: string;
  createdAt: string;
  readAt: string | null;
  sourceEventId: string;
}

export interface Page<T> {
  items: T[];
  page?: number;
  pageSize: number;
  totalCount?: number;
  offset?: number;
}

/* ==================== Read-only admin console (TAS-155) ====================
 *
 * `/api/v1/readonly/*` is a generic window onto the services' own tables, so
 * unlike the rest of this file these types describe *shapes the server
 * declares at runtime* rather than a schema known at build time. A row is
 * therefore `unknown` per column, not `string` — the console renders whatever
 * it is handed and never assumes a type it was not told about.
 */

export interface AdminColumn {
  name: string;
  type: string;
  /**
   * Column the catalog marks as holding secrets. The server masks it before it
   * leaves admin-service, three different ways, so this flag says the column is
   * masked — not that nothing of it is drawn. A partial mask is a value and is
   * printed; see `isWithheld` for which of the three arrived.
   *
   * The contract does not require the field. `RestTaskaApi` defaults a missing
   * one to `true`, so this is a boolean by the time anything reads it.
   */
  sensitive: boolean;
}

export interface AdminTable {
  name: string;
  columns: AdminColumn[];
  primaryKey: string;
}

export interface AdminService {
  name: string;
  databaseAlias: string;
  tables: AdminTable[];
}

export interface AdminCatalog {
  services: AdminService[];
}

/**
 * The contract spells filters as query keys `column.operator`, with the
 * operator always present: `column.equals`, `column.contains`, `column.from`,
 * `column.to`. Kept structured here so the UI never hand-builds a key, and so
 * the API layer is the only place that knows the wire spelling.
 *
 * The gateway also decides which operator a column may take from that column's
 * type and answers 400 for the rest, which is why the catalog's `type` is not
 * decoration — see `src/screens/admin/columns.ts`.
 */
export type AdminFilterOperator = "equals" | "contains" | "from" | "to";

export interface AdminFilter {
  column: string;
  operator: AdminFilterOperator;
  value: string;
}

export type AdminSortOrder = "asc" | "desc";

export interface AdminRowsQuery {
  service: string;
  table: string;
  page?: number;
  pageSize?: number;
  sort?: string;
  order?: AdminSortOrder;
  filters?: AdminFilter[];
}

export interface AdminPagination {
  currentPage: number;
  pageSize: number;
  totalRows: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

/**
 * What the server says about the table it just returned. `columns` is the
 * authority on which columns exist and in what order — the rows themselves are
 * bags of keys and cannot be trusted to agree with each other, least of all
 * when a value is null.
 */
export interface AdminRowsMeta {
  service: string;
  table: string;
  columns: string[];
  sortableColumns: string[];
  filterableColumns: string[];
}

/** One record of a service table: a bag of columns whose types are runtime news. */
export type AdminRow = Record<string, unknown>;

export interface AdminRows {
  rows: AdminRow[];
  pagination: AdminPagination;
  meta: AdminRowsMeta;
}

/**
 * One row by its primary key (`GET /readonly/{service}/{table}/{id}`).
 *
 * `id` is a string here because a primary key is whatever the table says it is,
 * but the gateway types the path parameter as a `UUID` — a table keyed by
 * anything else cannot be addressed at all, which is why §5.8 only makes a row
 * clickable when the catalog says its key column is `uuid`.
 */
export interface AdminRowQuery {
  service: string;
  table: string;
  id: string;
}

/**
 * One problematic transactional-outbox event, as
 * `GET /readonly/outbox/problematic-summary` reports it (the Events section,
 * DESIGN.md §5.8).
 *
 * This is a row of `outbox_events` with two fields added by the summary —
 * `serviceKey`, because the endpoint answers for every service at once, and
 * `reason`. Unlike the generic admin reads above, the shape *is* known at build
 * time here: the endpoint declares it.
 *
 * `status` stays an open `string` rather than a union. It is raw table data,
 * the contract types it as a bare string with no enum, and the three values a
 * problematic row can carry today (`FAILED`, `PROCESSING`, `NEW`) are a fact
 * about the backend's query, not a promise. The UI derives the category from it
 * and prints anything else verbatim.
 *
 * `reason` is a human-readable English sentence the backend writes, not a code.
 * Nothing may parse or switch on it — the category comes from `status` — and it
 * is rendered on the summary list's category cell, in `title` and in that
 * cell's accessible name: the visible word is the derived category, the
 * server's whole sentence is one hover or one screen reader away. Not a column
 * of its own and not on the event card, which draws the table's catalog
 * columns — `reason` is a field of the summary, and a row opened by its own
 * address does not have one (§5.8).
 */
export interface ProblematicOutboxEvent {
  id: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: string;
  status: string;
  createdAt: string;
  publishedAt: string | null;
  attempts: number;
  lastErrorMessage: string | null;
  processingStartedAt: string | null;
  requestId: string | null;
  serviceKey: string;
  reason: string;
}

/**
 * How many problematic events one service has, by category. The counts cover
 * every outbox service and every problematic row, including the ones the
 * summary's own list was cut short of — which is what makes the matrix the
 * answer to "what is broken and where" rather than a caption for the list.
 */
export interface ProblematicOutboxCounts {
  serviceKey: string;
  overdueNewCount: number;
  stuckProcessingCount: number;
  failedCount: number;
}

/**
 * The whole summary. `events` arrives oldest first and is capped by the
 * server's own limit; `notAllShown` says the cap was reached, which is a
 * statement about this response rather than an error.
 */
export interface ProblematicOutboxSummary {
  events: ProblematicOutboxEvent[];
  counts: ProblematicOutboxCounts[];
  notAllShown: boolean;
}

/**
 * What `POST /admin/outbox/{service}/{eventId}/retry` says the event is now
 * (`RetryOutboxEventResponseDto`) — the state read back out of the row *after*
 * the update, not an echo of what was asked for.
 *
 * `status` is an open `string`, like every other outbox status in this file and
 * for the same reason: the contract types it as a bare string with no enum. On
 * the backend as it stands the answer is always `NEW` — the UPDATE sets it —
 * but the client reports what it was told rather than what it expected, so a
 * backend that grows a `REQUEUED` state prints that instead of lying.
 *
 * `attempts` is `null` when the response omitted it: the schema marks it
 * `nullable`, and the field is the row's own count, which the retry does **not**
 * reset — `attempts` is absent from the UPDATE (`OutboxRetryRepositoryImpl`,
 * backend `develop`). So the number that comes back is the number that was
 * already there, and nothing in the UI may present it as a fresh start.
 */
export interface OutboxRetryResult {
  eventId: string;
  status: string;
  attempts: number | null;
}
