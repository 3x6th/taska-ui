import type {
  AcceptInvitationInput,
  AddIssueWorklogInput,
  AuthTokens,
  CreateAccessTokenInput,
  BoardColumnPageParams,
  BoardParams,
  ConfirmAttachmentUploadInput,
  ConfirmAvatarUploadInput,
  CreateAttachmentUploadUrlInput,
  CreateAvatarUploadUrlInput,
  CreateIssueInput,
  CreateIssueLinkInput,
  CreateProjectInput,
  CreateProjectIssueTypeInput,
  CreateProjectLabelInput,
  CreateProjectWorkflowInput,
  DeleteProjectWorkflowInput,
  DeleteWorkflowStatusParams,
  DeleteWorkflowTransitionParams,
  InviteUserInput,
  ListCommentsParams,
  ListWorklogsParams,
  ListIssuesParams,
  ListNotificationsParams,
  LoginInput,
  RetryableOutboxService,
  SearchIssuesParams,
  SearchUsersParams,
  IssueWriteAnswer,
  TaskaApi,
  UpdateIssueWorklogInput,
  UpdateIssueInput,
  UpdateProjectInput,
  UpdateProjectIssueTypeInput,
  UpdateProjectLabelInput,
  UpdateProjectWorkflowInput,
  UpdateWorkflowStatusInput,
  UpdateWorkflowTransitionInput,
  WorkflowStatusInput,
  WorkflowTransitionInput,
} from "../TaskaApi";
import {
  ADMIN_WRITE_REASON_MAX_LENGTH,
  ADMIN_WRITE_REASON_REQUIRED_MESSAGE,
  ADMIN_WRITE_REASON_TOO_LONG_MESSAGE,
  DIRECTORY_QUERY_MIN_CODE_POINTS,
  DIRECTORY_QUERY_REFUSAL_MESSAGE,
  OUTBOX_RETRY_REASON_MAX_LENGTH,
  OUTBOX_RETRY_REASON_TOO_LONG_MESSAGE,
  SEARCH_QUERY_MIN_LENGTH,
  SEARCH_QUERY_TOO_SHORT_MESSAGE,
  directoryQueryLength,
} from "../TaskaApi";
import { attachmentRefusal } from "../attachments";
import { MEMBER_USER_ID_REFUSAL_MESSAGE, isUserId } from "../members";
import { AVATAR_GATEWAY_REFUSAL_MESSAGE, AVATAR_MAX_SIZE_BYTES, avatarRefusal } from "../avatars";
import { IssueVersionConflictError, errorDetails, type ErrorDetails } from "../errors";
import { toViewLinkType } from "../linkViewTypes";
import { blankSummaryRefusal, ifMatch, issuePatchBody, issueTypePatchRefusal, issueVersionRefusal } from "../issuePatch";
import {
  ISSUE_TYPE_EMPTY_PATCH_MESSAGE,
  isIssueTypeColor,
  isIssueTypeIcon,
  isIssueTypeShape,
  projectIssueTypePatchBody,
  toProjectIssueType,
  toProjectIssueTypes,
} from "../issueTypes";
import {
  OBJECT_STORE_REJECTED_CODE,
  OBJECT_STORE_UNREACHABLE_CODE,
  ObjectStoreError,
  requireUsableDownloadUrl,
  requireUsableUploadUrl,
} from "../objectStore";
import type { PlanningFieldsInput } from "../planningFields";
import {
  emptyPlanningFields,
  planningFieldRefusal,
  planningFieldsBody,
  resolvePlanningFields,
} from "../planningFields";
import { SessionExpiredSignal } from "../session";
import type {
  AccessToken,
  AccessTokenList,
  AccessTokenPolicy,
  AdminCatalog,
  AdminPagination,
  AdminRow,
  AdminRowQuery,
  AdminRows,
  AdminRowsMeta,
  AdminRowsQuery,
  AdminService,
  AdminTable,
  AuditEntries,
  AuditEntriesQuery,
  AuditEntry,
  AttachmentDownloadUrl,
  AttachmentUploadTicket,
  AvatarUploadTicket,
  Board,
  BoardColumnPage,
  BoardIssue,
  DateOnly,
  DictionaryEntry,
  DirectoryPage,
  DirectoryUser,
  EnumDictionaries,
  GlobalRole,
  Issue,
  IssueAttachment,
  IssueComment,
  IssueLink,
  IssuePriorityCode,
  IssueSearchHit,
  IssueTypeCode,
  IssueWatcher,
  IssueWatchers,
  IssueWorklog,
  IssueWorklogPage,
  IssueDetails,
  IssueDetailsWithHistory,
  IssuedAccessToken,
  InvitationResult,
  LinkedIssue,
  UserSummary,
  Label,
  Notification,
  NotificationPage,
  NotificationPreferences,
  NotificationPreferencesPatch,
  OutboxRetryResult,
  Page,
  ProblematicOutboxCounts,
  ProblematicOutboxEvent,
  ProblematicOutboxSummary,
  Project,
  ProjectContext,
  ProjectIssueType,
  ProjectLabel,
  ProjectMember,
  ProjectWorkflow,
  ProjectWorkflowEntry,
  ProjectMembership,
  ProjectMemberWriteResult,
  ProjectRole,
  ProjectStats,
  TelegramLink,
  TelegramStatus,
  UnwatchIssueResult,
  User,
  UserAvatar,
  UserStatus,
  UserStatusChange,
  WatchIssueResult,
  WorkflowDefinition,
  WorkflowStatus,
  WorkflowTransition,
  IssueHistoryEvent,
} from "../../domain/types";

// `InvitationResponseDto` (backend #204). All four are required by the contract
// and read as `unknown` anyway, like every other body here: `inviteUser` is the
// one place that decides what an absent field means.
interface RestInvitation {
  userId?: unknown;
  status?: unknown;
  deliveryQueued?: unknown;
  expiresAt?: unknown;
}

// Gateway contract: RestErrorResponse is a flat { code, message, details };
// the nested `error` shape is kept for older service responses. `details` is
// read as `unknown` and narrowed by `errorDetails` (src/api/errors.ts): the
// schema says `{string: string}` or null, and a body is not trusted to keep to it.
interface ApiErrorBody {
  code?: string;
  message?: string;
  details?: unknown;
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
  email: string;
  displayName: string;
  // Read as `unknown`: the contract types it as `UserStatusDto` since backend
  // PR #200, but the gateway's `AuthMapper` can write `null` and a newer
  // backend can add a value (TAS-173). `toUserStatus` keeps a string as it
  // came, reads `UNSPECIFIED` as none, and turns anything else into `null`.
  status?: unknown;
  color?: string;
  globalRole?: unknown;
  /**
   * `AvatarDto`, nullable, on `GET /users/me` since backend PR #193 (TAS-223).
   * Only `id` and `downloadUrl` are read. `null` both for no avatar and for a
   * profile read the gateway could not make; `avatarUnavailable` below is
   * what tells those two apart. Absent on a gateway older than that PR.
   */
  avatar?: { id?: string; downloadUrl?: string } | null;
  /**
   * Required boolean in backend PR #193's schema (head `3bd33cac`): `true` when
   * the gateway's `GetUserProfile` read failed and `avatar: null` means
   * unknown, `false` when it read the profile. Typed optional and `unknown`
   * anyway: a gateway older than that PR omits it, and only a real boolean
   * is taken (`toUser`).
   */
  avatarUnavailable?: unknown;
}

/**
 * `ProjectMemberDetailsDto` and its envelope — backend TAS-137 (PR #152), in
 * `docs/contract/openapi.yml` since `develop` `1cfe4d79f074`. Every field is
 * optional because that schema declares no `required` block, and `role` is
 * `unknown` for a related but distinct reason from `globalRole` above, read at
 * the PR's head `1ad6ffad815d`: MapStruct fills it with its built-in
 * enum-to-string conversion (`.name()`) off a column a CHECK constraint
 * confines to ADMIN, MEMBER and VIEWER (`ck_project_members_role`,
 * project-service `0000-init.sql`), so nothing outside those three is on the
 * wire today. The type stays open here anyway, defensively, against a role
 * the enum grows later that this build has no name for — unlike
 * `Project.currentUserRole`, whose own mapper returns `null` rather than ever
 * emit one (read at `develop` `1cfe4d79f074`).
 *
 * `avatar` is declared and **is read** since TAS-220: `AvatarDto` carries a
 * presigned `downloadUrl`, which is the whole reason a board of faces costs one
 * request instead of one per person. The server fills it since TAS-225:
 * auth-service's `UserRepository.findUsersWithAvatars` selects the avatar row
 * with its id, and a presign that fails leaves that one row `avatar: null`
 * (read at backend develop `398285cde074`). Only `downloadUrl` is modelled —
 * the other six fields say nothing a member row draws, and `createdAt` among
 * them is declared and never populated (`AvatarResponse` in
 * project-service.proto has no `created_at`, and `ProjectMapper.toAvatarDto`
 * sets six fields, not seven).
 */
interface RestProjectMember {
  userId?: string;
  role?: unknown;
  displayName?: string;
  email?: string;
  avatar?: { downloadUrl?: string } | null;
  addedAt?: string | null;
}

/**
 * `ProjectContextResponseDto` (backend PR #169, TAS-212). The four parts are
 * `required` there; they are read with `?? []` all the same, for the reason
 * `RestProjectMembers` is — an unguarded `.map` turns a malformed 200 into a
 * `TypeError` nothing can name.
 */
interface RestProjectContext {
  project: Project;
  members?: RestProjectMember[];
  labels?: RestLabel[];
  /** `ProjectIssueTypeDto[]` (backend #212); read by `toProjectIssueTypes`. */
  issueTypes?: unknown;
  workflows?: RestProjectWorkflowEntry[];
}

/**
 * `ProjectWorkflowEntryDto`. `issueType` is the registry key as sent — the
 * gateway passes it through since backend #226 — and read as `unknown` so a
 * `null` or a blank is dropped rather than trusted.
 */
interface RestProjectWorkflowEntry {
  issueType?: unknown;
  workflow?: {
    id?: string;
    name?: string;
    version?: number;
    statuses?: WorkflowStatus[];
    transitions?: WorkflowTransition[];
  } | null;
}

/**
 * `WorkflowResponseDto` as the workflow routes of backend PR #208 send it. Read
 * field by field rather than passed through, as the context's workflows are:
 * `hidden` on a transition is new and optional in the yml, and a raw copy would
 * carry whatever else the wire held into the domain.
 */
interface RestWorkflowDefinition {
  id?: string;
  name?: string;
  version?: number;
  createdAt?: string | null;
  updatedAt?: string | null;
  statuses?: Partial<WorkflowStatus>[];
  transitions?: (Partial<WorkflowTransition> & { hidden?: unknown })[];
}

/**
 * `ProjectWorkflowDto` (backend PR #208): an item of the list, and since
 * backend PR #225 (develop `6ba4ed6`) the answer of every workflow write.
 */
interface RestProjectWorkflowItem {
  workflow?: RestWorkflowDefinition | null;
  issueTypes?: unknown[] | null;
  shared?: unknown;
}

/** `ProjectWorkflowsResponseDto` (backend PR #208). */
interface RestProjectWorkflows {
  items?: RestProjectWorkflowItem[] | null;
}

/** `ListProjectMemberDetailsDto` — the array is `members`, not `items`. */
interface RestProjectMembers {
  members?: RestProjectMember[];
}

/** `AuditEntryDto` as the wire may carry it: nothing in the schema is `required`. */
type RestAuditEntry = Partial<Record<keyof AuditEntry, unknown>>;

interface RestAuditEntries {
  entries?: RestAuditEntry[] | null;
  pagination?: Partial<AdminPagination>;
}

/**
 * `GET /readonly/{service}/{table}` — `data` on the wire, `rows` in the domain.
 * Every field is optional because the contract marks none of them required:
 * the Data section has read the live gateway through this since the read-only
 * routes deployed, but a schema with no `required` block promises nothing, and
 * typing it as guaranteed would be a claim, not a fact.
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

/**
 * `RetryOutboxEventResponseDto` — what the outbox retry answers with.
 *
 * `eventId` and `status` are in the schema's `required` list, so they are typed
 * as present. `attempts` is not, and is declared `nullable` on top of that, so
 * it carries both spellings of "no number" — which is why the mapper below has
 * to collapse them rather than spread the response through.
 */
interface RestOutboxRetryResult {
  eventId: string;
  status: string;
  attempts?: number | null;
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
 * guaranteed field here would be a claim rather than a fact. The one exception
 * is `retryable` (backend PR #195, TAS-200), which its schema does mark
 * required — and it is still read as optional, and absent as `false`, because
 * a Retry button is the one thing on this list that must never be offered on
 * a guess.
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
  | "description"
  | "labels"
  | "storyPoints"
  | "startDate"
  | "dueDate"
  | "originalEstimateMinutes"
  | "remainingEstimateMinutes"
  | "timeSpentMinutes"
> & {
  assigneeId?: string | null;
  deletedAt?: string | null;
  // Neither spec puts this field in a `required` block, and the deployed
  // gateway's generated spec types it `["string", "null"]`, so the wire may
  // state `null` or omit the key outright. Restated so that `toIssue`'s
  // `?? ""` is code with a reason a reader can check, rather than a guard
  // against a case the type says cannot happen.
  //
  // Restating it does not newly imply that the rest are guaranteed: an `Omit`
  // of nine fields already says the other twelve arrive exactly as `Issue`
  // states them, on no better evidence than this one had. Typing the whole
  // schema honestly is its own story; see docs/ai/BACKLOG.md.
  description?: string | null;
  // Absent on every gateway built before TAS-120, and absent again the moment
  // this app talks to one. `toIssue` turns that into `[]` so no card has to.
  labels?: RestLabel[];
  // The five planning fields, restated as optional rather than inherited as
  // required. `Issue` promises them because the domain does; the *wire* does
  // not have to. The contract states them (merged PR #148) and the deployed
  // gateway's `/v3/api-docs` declares them (measured 2026-09-11), but no
  // response *body* carrying one of the five has been read — so inheriting them
  // as required would be a promise about answers nobody has seen, and
  // `toIssue` would then be typed as if it had nothing to fold.
  storyPoints?: number | null;
  startDate?: DateOnly | null;
  dueDate?: DateOnly | null;
  originalEstimateMinutes?: number | null;
  remainingEstimateMinutes?: number | null;
  // Backend TAS-431: the issue's active logged minutes, on every issue answer
  // (the gateway writes the column, `0` when it is unset). Read defensively —
  // `toIssue` keeps only a whole number `>= 0`.
  timeSpentMinutes?: unknown;
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

/**
 * `IssueHistoryResponseDto` without `via`: the channel mark (TAS-411) is not on
 * the wire, and a wire type that declared it would say it is. `actor` is a
 * nullable `UserSummaryDto` (backend TAS-398), read field by field, and so is
 * every entry of `participants` (backend TAS-431), a map of `UserSummaryDto`
 * by id.
 */
type RestIssueHistoryEvent = Omit<IssueHistoryEvent, "issueId" | "via" | "actor" | "participants"> & {
  actor?: unknown;
  participants?: unknown;
};

interface RestIssueWithHistory {
  issue: RestIssue;
  history: RestIssueHistoryEvent[];
}

/**
 * `UserSummaryDto`. The contract requires `id` and `displayName`; both are read
 * as optional anyway, because no body carrying one has been read on the stand
 * yet (develop `60d62ee` was still queued for deployment when this was written)
 * and because `displayName` is `""` on a `200` whenever auth-service is down —
 * the gateway does not fail the read over a missing name.
 */
interface RestUserSummary {
  id?: string;
  displayName?: string | null;
  avatarUrl?: string | null;
}

/**
 * `IssueDetailsResponseDto` — `RestIssue` plus the parts the panel used to read
 * separately. Every addition is optional, and every list may be `null` or
 * absent as well as `[]`: see `IssueDetails` in src/domain/types.ts for why, on
 * this gateway, a part that failed arrives as `[]` all the same.
 *
 * `reporter` is always sent: the gateway's mapper sets it only when
 * issue-service sent one, and issue-service always does
 * (`IssueDetailsMapper` resolves `core.getReporterId()`, a `NOT NULL` column) —
 * read at develop `60d62ee`. What can be missing is its name: `displayName` is
 * `""` when auth-service had no profile for the person or did not answer.
 * Recorded in docs/ai/API-DIVERGENCE.md as "GET /issues/{issueId}: a failed part
 * arrives as [] and an unnamed person as a blank or absent displayName".
 */
type RestIssueDetails = Omit<RestIssue, "labels"> & {
  labels?: RestLabel[] | null;
  assignee?: RestUserSummary | null;
  reporter?: RestUserSummary | null;
  watchers?: RestIssueWatcher[] | null;
  isWatching?: boolean | null;
  links?: RestIssueLink[] | null;
  attachments?: RestIssueAttachment[] | null;
  commentCount?: number | null;
};

interface RestIssueDetailsWithHistory {
  issue: RestIssueDetails;
  history?: RestIssueHistoryEvent[] | null;
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
  issueType: IssueTypeCode;
  priority: Issue["priority"];
  assigneeId?: string | null;
  // The only planning field `IssueShortResponseDto` states (merged PR #148).
  // No dates and no estimates: see `IssueSearchHit` in src/domain/types.ts for
  // why this must not be widened to match `RestIssue` above.
  storyPoints?: number | null;
  // Backend TAS-218 (develop `485fea5`, deployed 2026-10-09): `statusKey` is
  // required, the two project fields optional.
  projectId?: string | null;
  projectKey?: string | null;
  statusKey?: string | null;
  // Backend TAS-418 (develop `be5085e5`) and TAS-432 (PR #256): the type's
  // look from the hit's project registry, all four nullable — the icon `null`
  // for a type without one, all four for a type deleted since. Read as
  // `unknown` and narrowed; a key left out reads as `null`.
  issueTypeName?: unknown;
  issueTypeColor?: unknown;
  issueTypeShape?: unknown;
  issueTypeIcon?: unknown;
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
  // Optional, unlike `RestSearchIssuesResponse` below: `ListIssuesResponseDto`
  // declares no `required` block in either spec, so a `200` carrying no `items`
  // is a legal answer. `listIssues` reads it with `?? []` and a test pins that.
  items?: RestIssue[];
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

/**
 * `BoardUserDto`. `id` is the schema's one required property; `displayName`
 * and `avatarUrl` are nullable, and the gateway leaves both unset when its
 * profile read fails or does not know the id (`BoardServiceImpl.enrichIssue`,
 * backend #205), so every spelling of "no name" arrives.
 */
interface RestBoardUser {
  id?: string;
  displayName?: string | null;
  avatarUrl?: string | null;
}

/**
 * `BoardIssueDto` since backend #205 (TAS-213). Nine properties are required
 * by the schema; every field is still read defensively below, because a
 * malformed card has to be drawn as a card that could not be shown rather than
 * fail the whole board with a `TypeError` carrying no code and no request id.
 *
 * `storyPoints`, `dueDate`, `commentCount` and `attachmentCount` are on the
 * wire too and are not read: no screen draws them on a card (TAS-202).
 */
interface RestBoardIssue {
  id: string;
  issueKey: string;
  summary: string;
  issueType: IssueTypeCode;
  priority: IssuePriorityCode;
  statusKey: string;
  description?: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  assignee?: RestBoardUser | null;
  labels?: RestLabel[] | null;
}

/** `BoardColumnDto`. Every property is in the schema's `required` block; the counts are read defensively. */
interface RestBoardColumn {
  statusKey: string;
  name: string;
  category: string;
  sortOrder: number;
  issues: RestBoardIssue[];
  totalCount?: unknown;
  hasMore?: unknown;
}

/**
 * `BoardResponseDto` since backend #205: `projectId`, `columns` and
 * `unplacedIssues`, all three required — and the two arrays are still read
 * with `?? []` below, for the same reason `RestSearchIssuesResponse` is: a
 * missing array rejects with a `TypeError` carrying no code and no request id,
 * which reaches a caller as an unreadable failure where an empty board was
 * meant. The `issueType` echo the route answered with before #205 is gone.
 */
interface RestBoardResponse {
  projectId: string;
  columns: RestBoardColumn[];
  unplacedIssues?: RestBoardIssue[];
  unplacedTotalCount?: unknown;
  unplacedHasMore?: unknown;
}

/**
 * `BoardColumnPageResponseDto` (backend TAS-430). All four properties are
 * required by the schema; `issues` is still read with `?? []` and the counts
 * defensively, as on the board.
 */
interface RestBoardColumnPage {
  statusKey?: unknown;
  issues?: RestBoardIssue[];
  totalCount?: unknown;
  hasMore?: unknown;
}

/**
 * `ProjectStatsDto` (backend TAS-211). Every field is required by the schema
 * and read as optional all the same: a count the wire did not carry becomes
 * `null`, which a card draws as `Unknown`, never as `0`.
 */
interface RestProjectStats {
  projectId?: string;
  issueCount?: number | null;
  memberCount?: number | null;
  members?: RestProjectMember[] | null;
}

/** `ListProjectStatsDto`. */
interface RestProjectStatsList {
  items?: RestProjectStats[] | null;
}

/**
 * `IssueLinkResponseDto`. Every field is read as optional because the schema
 * declares no `required` block, and `viewLinkType` is read as `unknown` for the
 * same reason `globalRole` is: the contract types it as `IssueLinkViewTypeDto`
 * since backend PR #200, and a backend newer than this build can add a value
 * to it. Unlike `globalRole` it is not narrowed to a domain enum — see
 * `IssueLink` in src/domain/types.ts — only proved to be a string before it
 * reaches a component.
 */
interface RestIssueLink {
  id?: string;
  projectId?: string;
  sourceIssueId?: string;
  targetIssueId?: string;
  viewLinkType?: unknown;
  createdBy?: string;
  createdAt?: string;
  /** `TargetIssueDto`, since backend TAS-214. Its five fields are required by the contract and read as optional here. */
  target?: RestLinkedIssue | null;
}

interface RestLinkedIssue {
  id?: string;
  issueKey?: string;
  summary?: string;
  projectId?: string;
  statusKey?: string;
}

interface RestListIssueLinksResponse {
  items?: RestIssueLink[];
}

/**
 * `IssueWatcherResponseDto`. Optional throughout, like its neighbours: the
 * contract marks no field of any watcher schema `required`.
 */
interface RestIssueWatcher {
  id?: string;
  issueId?: string;
  projectId?: string;
  userId?: string;
  createdAt?: string;
  createdBy?: string;
  /** Since backend TAS-214. Set by the gateway only when issue-service named the person. */
  displayName?: string | null;
  avatarUrl?: string | null;
}

/**
 * `ListIssueWatchersResponseDto`, and the reason this interface exists at all
 * rather than being inlined: **the array is `watchers`, not `items`.**
 *
 * Every other list on this gateway answers with `items`, so the one place that
 * knows otherwise had better be named. Measured on the deployed gateway
 * 2026-09-08 with a `GLOBAL_ADMIN` token — `GET …/watchers` on issue `API-2`
 * answered `200 {"totalCount":1,"watchers":[{…}]}` — which agrees with the
 * contract. A mapper that reached for `items` here would map every answer to an
 * empty list and never fail.
 */
interface RestListIssueWatchersResponse {
  watchers?: RestIssueWatcher[];
  totalCount?: number;
}

interface RestWatchIssueResponse {
  watcher?: RestIssueWatcher;
  watchersCount?: number;
}

interface RestUnwatchIssueResponse {
  issueId?: string;
  removed?: boolean;
  watchersCount?: number;
}

/**
 * `IssueAttachmentDto`. Optional throughout, like `RestIssueLink` above and for
 * the same reason: `docs/contract/openapi.yml` does mark seven of the eight
 * `required` (backend PR #147, merged), but what is measured about this family
 * on the deployed gateway is that its list route exists — it answered 401
 * without a token on 2026-09-16 — and not what any body carries, so a field
 * typed as guaranteed here would be a claim rather than a measurement.
 * `toAttachment` turns each blank into the domain's own spelling of "not
 * stated".
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
  /** Since backend TAS-214. */
  uploadedByUser?: RestUserSummary | null;
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

/**
 * The two avatar response bodies this client reads —
 * `CreateAvatarUploadUrlResponseDto` and `AvatarResponseDto`, in
 * `docs/contract/openapi.yml` since backend PR #150 merged at `develop`
 * `368ae77355bd`. The third, `GetAvatarDownloadUrlResponseDto`, is no longer
 * read: the reader's own avatar arrives on `GET /users/me` (TAS-223).
 *
 * Every field optional, for the reason the attachment bodies above give: none
 * of these schemas declares a `required` block, so a field typed as guaranteed
 * here would be a claim rather than a measurement.
 */
interface RestAvatarUploadTicket {
  uploadUrl?: string;
  objectKey?: string;
  expiresIn?: number;
}

interface RestUserAvatar {
  id?: string;
  userId?: string;
  objectKey?: string;
  fileName?: string;
  contentType?: string;
  sizeBytes?: number;
  createdAt?: string;
  downloadUrl?: string;
}

/** `CommentResponseDto`. No `via`: the channel mark (TAS-411) is not on the wire. */
type RestComment = Omit<IssueComment, "updatedAt" | "author" | "via"> & {
  updatedAt?: string | null;
  /** Since backend TAS-214. */
  author?: RestUserSummary | null;
};

/**
 * `IssueWorklogResponseDto` (backend PR #178); `comment` and `updatedAt` are
 * nullable and may be absent; `author` (TAS-421) is a nullable summary on the
 * list's rows and absent from a write's answer.
 */
type RestWorklog = Omit<IssueWorklog, "comment" | "updatedAt" | "author"> & {
  comment?: string | null;
  updatedAt?: string | null;
  author?: unknown;
};

/** `ListIssueWorklogsResponseDto` (backend TAS-421), every field read as optional. */
interface RestWorklogsListResponse {
  items?: RestWorklog[];
  page?: unknown;
  pageSize?: unknown;
  totalCount?: unknown;
  hasMore?: unknown;
}

interface RestCommentsListResponse {
  items: RestComment[];
  totalCount: number;
}

/**
 * `NotificationResponseDto` as the contract has it since backend `5a8d805a3ac3`
 * (TAS-243). Six fields are required; the rest are nullable and read that way.
 *
 * `issueId`, `issueKey` and `projectId` are `null` together on a notification
 * that is not about an issue (`MEMBER_*`, `PROJECT_CREATED`, `USER_*`) and on
 * an issue notification stored before the migration that added them, which did
 * not backfill. A third case sends `issueId` alone: an `ISSUE_ATTACHMENT_ADDED`
 * or `ISSUE_ATTACHMENT_DELETED` written before backend PR #191 (TAS-245), when
 * issue-service's `PayloadSerializer` did not call `putIssueFields` for those
 * two. New ones carry all three; the old rows were not backfilled. All three are typed optional as
 * well as nullable so that an absent key lands in the domain as `null` rather
 * than as `undefined`; `readAt` is not in the schema's `required` list either,
 * and is read the same way.
 *
 * The schema has no `link` and no `userId`, and nothing here reads either: the
 * notification is the reader's by construction, and the issue it is about is
 * stated by id rather than by a path to be parsed.
 */
type RestNotification = Omit<Notification, "issueId" | "issueKey" | "projectId" | "readAt"> & {
  issueId?: string | null;
  issueKey?: string | null;
  projectId?: string | null;
  readAt?: string | null;
};

/** `unreadCount` is required: the reader's total across every notification, whatever the query narrowed `items` to. */
interface RestNotificationListResponse {
  items: RestNotification[];
  unreadCount: number;
}

interface RestReadAllNotificationsResponse {
  updatedCount: number;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    public readonly requestId?: string,
    /**
     * The parsed body of the failed response, as it came. Read by exactly one
     * caller: `updateIssue`, whose 409 carries the issue rather than a
     * `{code, message}`.
     */
    public readonly body?: unknown,
    /**
     * `RestErrorResponse.details` (backend PR #199) as `errorDetails` reads
     * it: a plain object of strings, or `null` — which is what every refusal
     * but the account lock carries.
     */
    public readonly details: ErrorDetails | null = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * One `AuditEntryDto`, field by field. The schema declares nothing `required`,
 * so anything that is not a string arrives here as `null` rather than as
 * whatever it was — the section prints a dash for it, and never a `[object
 * Object]`. `oldValue` and `newValue` stay text: they are JSON documents *as
 * strings* on the wire, and parsing them is the screen's job.
 *
 * `id` is read more narrowly than "a string": an empty one names nothing, and
 * a row keyed by `""` would collide with every other such row, so it is `null`
 * and the row falls back to being named by what it says.
 *
 * The actor is `actorDisplayName` and `actorEmail` (backend PR #219, TAS-388),
 * read the same narrow way, and for the same reason: an empty name, address or
 * `actorUserId` names no one, and the section prints a dash for it rather than
 * a blank cell. The gateway sets each name and address only when the record
 * has it, so an absent field and an explicit `null` both read as `null`.
 * Nothing here falls back to the retired `actorLogin`, and nothing looks the
 * actor up by `actorUserId`: the row says who acted, or it does not.
 */
function toAuditEntry(wire: RestAuditEntry): AuditEntry {
  const text = (value: unknown) => (typeof value === "string" ? value : null);
  // An earlier draft of the contract typed these as objects, so a document that
  // arrives unstringified is turned back into text rather than dropped. The
  // merged contract says string, and so does the stand.
  const documentText = (value: unknown) =>
    typeof value === "string" ? value : value !== null && typeof value === "object" ? JSON.stringify(value) : null;
  return {
    id: text(wire.id) || null,
    actorUserId: text(wire.actorUserId) || null,
    actorDisplayName: text(wire.actorDisplayName) || null,
    actorEmail: text(wire.actorEmail) || null,
    action: text(wire.action),
    targetService: text(wire.targetService),
    targetTable: text(wire.targetTable),
    targetId: text(wire.targetId),
    reason: text(wire.reason),
    requestId: text(wire.requestId),
    createdAt: text(wire.createdAt),
    oldValue: documentText(wire.oldValue),
    newValue: documentText(wire.newValue),
  };
}

export class RestTaskaApi implements TaskaApi {
  private accessToken = window.localStorage.getItem("taska.accessToken");
  private refreshTokenValue = window.localStorage.getItem("taska.refreshToken");
  private refreshInFlight: { authVersion: number; promise: Promise<boolean> } | null = null;
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

  async getNotificationPreferences(): Promise<NotificationPreferences> {
    return toNotificationPreferences(
      await this.request<RestNotificationPreferences>("/users/me/notification-preferences"),
    );
  }

  async updateNotificationPreferences(input: NotificationPreferencesPatch): Promise<NotificationPreferences> {
    return toNotificationPreferences(
      await this.request<RestNotificationPreferences>("/users/me/notification-preferences", {
        method: "PATCH",
        body: input,
      }),
    );
  }

  /**
   * `POST /users/me/telegram/link`. The answer carries the reader's settings as
   * they stand after the link was issued (`TelegramLinkDto.preferences`,
   * required by the contract and always filled by the gateway), read through
   * the same mapper as every other settings answer — so the section draws from
   * it and asks for nothing more. A missing field is a contract violation, not
   * a case to recover from here.
   */
  async createTelegramLink(): Promise<TelegramLink> {
    const response = await this.request<Omit<TelegramLink, "preferences"> & { preferences: RestNotificationPreferences }>(
      "/users/me/telegram/link",
      { method: "POST" },
    );
    return {
      linkId: response.linkId,
      url: response.url,
      expiresAt: response.expiresAt,
      preferences: toNotificationPreferences(response.preferences),
    };
  }

  async confirmTelegramLink(linkId: string): Promise<NotificationPreferences> {
    return toNotificationPreferences(
      await this.request<RestNotificationPreferences>("/users/me/telegram/confirm", {
        method: "POST",
        body: { linkId },
      }),
    );
  }

  async disconnectTelegram(): Promise<NotificationPreferences> {
    return toNotificationPreferences(
      await this.request<RestNotificationPreferences>("/users/me/telegram", { method: "DELETE" }),
    );
  }

  /*
   * Personal access tokens (TAS-412; backend TAS-401/402, `openapi.yml` at
   * develop `be5085e5`):
   *
   *   GET    /users/me/access-tokens → 200 {items: PersonalAccessTokenDto[], policy}
   *   POST   /users/me/access-tokens {name, scopes, expiresInDays?} → 201 {token, secret}
   *   DELETE /users/me/access-tokens/{tokenId} → 204, for any id
   *
   * Each DTO is read field by field (`toAccessToken`), and a row without a
   * usable id is dropped: nothing could revoke it, and an empty id would be one
   * row's key for every such row. The list is drawn in the server's order —
   * `createdAt`, then `id`, newest first — and never re-sorted here.
   */
  async listAccessTokens(): Promise<AccessTokenList> {
    const response = await this.request<{ items?: unknown; policy?: unknown }>("/users/me/access-tokens");
    const tokens = Array.isArray(response?.items)
      ? response.items.map(toAccessToken).filter((token): token is AccessToken => token !== null)
      : [];
    return { tokens, policy: toAccessTokenPolicy(response?.policy) };
  }

  async createAccessToken(input: CreateAccessTokenInput): Promise<IssuedAccessToken> {
    const response = await this.request<{ token?: unknown; secret?: unknown }>("/users/me/access-tokens", {
      method: "POST",
      // No lifetime at all when the form had no policy to offer one from: the
      // server's default applies, rather than a number this build made up.
      body: {
        name: input.name,
        scopes: input.scopes,
        ...(input.expiresInDays === undefined ? {} : { expiresInDays: input.expiresInDays }),
      },
    });
    // The secret is handed straight to the caller and kept nowhere here. A
    // token without a usable id still comes back with its value — the one
    // showing of it matters more than the row — and the caller reads the list
    // again for the row rather than placing one nothing could revoke.
    return { token: toAccessTokenFields(response?.token), secret: typeof response?.secret === "string" ? response.secret : "" };
  }

  async revokeAccessToken(tokenId: string): Promise<void> {
    await this.request<void>(`/users/me/access-tokens/${this.segment(tokenId)}`, { method: "DELETE" });
  }

  hasSession(): boolean {
    // `||`, not `??`: an empty-string access token is not a credential, and with
    // `??` it would hide a refresh token that could still revive the session.
    return Boolean(this.accessToken || this.refreshTokenValue);
  }

  onSessionExpired(listener: () => void): () => void {
    return this.sessionExpired.subscribe(listener);
  }

  /**
   * `GET /meta` (backend TAS-217, deployed 2026-10-19) — see `TaskaApi.getMeta`.
   *
   * A plain `request`, with no `cache:` option and no `If-None-Match`: the
   * route's `ETag` is the browser's to use, and it revalidates a stored answer
   * by itself (`useMeta`). Sent by hand, the header would make a 304 reach this
   * code as a failed request.
   */
  async getMeta(): Promise<EnumDictionaries> {
    const response = await this.request<unknown>("/meta");
    const body = typeof response === "object" && response !== null ? (response as Record<string, unknown>) : {};
    return {
      issueTypes: toDictionary(body.issueTypes),
      priorities: toDictionary(body.priorities),
      linkTypes: toDictionary(body.linkTypes),
      // Through the same reading a link row's `viewLinkType` takes
      // (`toViewLinkType`): the prefix comes off and the two placeholders read
      // as `""` and are dropped, so a stripped code is looked up among stripped
      // codes. Read raw, `ISSUE_LINK_VIEW_TYPE_BLOCKS` would never meet the
      // `BLOCKS` a row carries.
      linkViewTypes: toDictionary(body.linkViewTypes, toViewLinkType),
      notificationTypes: toDictionary(body.notificationTypes),
      userStatuses: toDictionary(body.userStatuses),
    };
  }

  /**
   * `GET /users` (backend #204) — see `TaskaApi.searchUsers`. The query is
   * trimmed here and never sent under `DIRECTORY_QUERY_MIN_CODE_POINTS`, so
   * neither of the server's two refusals of a short one is spent; a refusal on
   * this side carries auth-service's own sentence, which is what the server
   * answers for a trimmed query that short.
   */
  async searchUsers(params: SearchUsersParams): Promise<DirectoryPage> {
    const query = params.query.trim();
    if (directoryQueryLength(query) < DIRECTORY_QUERY_MIN_CODE_POINTS) {
      throw new ApiError(DIRECTORY_QUERY_REFUSAL_MESSAGE, "INVALID_ARGUMENT", 400);
    }
    const search = new URLSearchParams();
    search.set("query", query);
    if (params.page !== undefined) search.set("page", String(params.page));
    if (params.pageSize !== undefined) search.set("pageSize", String(params.pageSize));
    const response = await this.request<unknown>(`/users${this.query(search)}`);
    return toDirectoryPage(response);
  }

  /**
   * `POST /auth/invitations` (backend #204) — see `TaskaApi.inviteUser`. The
   * one write here whose HTTP status is part of the answer: 201 is a new
   * account and 200 an existing invitation, and the body says neither.
   * `displayName` and `resend` are sent only when they say something — the
   * server's defaults are "the email's local part" and `false`.
   */
  async inviteUser(input: InviteUserInput): Promise<InvitationResult> {
    const body: Record<string, unknown> = { email: input.email };
    if (input.displayName !== undefined && input.displayName.trim() !== "") body.displayName = input.displayName;
    if (input.resend) body.resend = true;
    const { status, data } = await this.exchange<RestInvitation>("/auth/invitations", { method: "POST", body });
    return {
      userId: typeof data?.userId === "string" ? data.userId : "",
      status: toUserStatus(data?.status),
      deliveryQueued: data?.deliveryQueued === true,
      expiresAt: typeof data?.expiresAt === "string" ? data.expiresAt : "",
      created: status === 201,
    };
  }

  /**
   * An empty collection is `200 { items: [] }` since TAS-207 — project-service
   * used to answer it with NOT_FOUND, and this method used to turn every 404
   * into `[]`. That catch is gone: a 404 here now means something is actually
   * wrong, and it reaches the caller as one.
   */
  async listProjects(): Promise<Project[]> {
    const response = await this.request<{ items: Project[] }>("/projects");
    return response.items;
  }

  /**
   * `description` and `color` are sent because backend PR #155 (TAS-145) puts
   * them on `CreateProjectRequestDto`. Until this build they were dropped here
   * silently, so the create form's Description box had never once reached a
   * server — the field existed, was typed into, and went nowhere.
   *
   * Both omitted rather than sent empty when the caller left them out.
   * `description: ""` would be accepted and stored as a blank description,
   * which is a different thing from never having had one, and `color: ""`
   * fails the schema's hex pattern outright.
   */
  createProject(input: CreateProjectInput): Promise<Project> {
    return this.request<Project>("/projects", {
      method: "POST",
      body: {
        projectKey: input.projectKey,
        name: input.name,
        ...(input.description ? { description: input.description } : {}),
        ...(input.color ? { color: input.color } : {}),
      },
    });
  }

  getProject(projectId: string): Promise<Project> {
    return this.request<Project>(`/projects/${projectId}`);
  }

  /**
   * `PATCH /projects/{projectId}` — see `TaskaApi.updateProject` for the
   * behaviours of this route that its schema does not state.
   *
   * Only the keys the caller actually named are sent, and the test for "named"
   * is `!== undefined` rather than truthiness. That distinction is the whole
   * of the clearing story (backend PR #155): an explicit `null` has to survive
   * this spread as `"color": null` / `"description": null`, because that is
   * what clears the field, while `undefined` must not become one — an absent
   * key is "keep", and a stray `null` would wipe a colour the reader never
   * touched. `description: ""` survives too, as written; the server stores a
   * blank one as `null`, the same clear the dialog sends explicitly. And no key
   * beyond the three: the gateway answers an unknown one with a 400.
   */
  updateProject(projectId: string, input: UpdateProjectInput): Promise<Project> {
    return this.request<Project>(`/projects/${this.segment(projectId)}`, {
      method: "PATCH",
      body: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
      },
    });
  }

  /**
   * `DELETE /projects/{projectId}` — see `TaskaApi.archiveProject`. No body:
   * the route takes none. The answer is the archived project as stored, passed
   * through as the reads pass theirs, `currentUserRole: "ADMIN"` included —
   * the caller decides what to keep from it, and the edit dialog keeps only
   * `archivedAt`.
   */
  archiveProject(projectId: string): Promise<Project> {
    return this.request<Project>(`/projects/${this.segment(projectId)}`, { method: "DELETE" });
  }

  /**
   * `GET /projects/{projectId}/context` — see `TaskaApi.getProjectContext`.
   *
   * Each part goes through the mapper its own route uses, so the board draws a
   * context member exactly as it drew a `/members` row: blank names become an
   * unnamed row, idless rows are dropped, and `compareMembers` decides the
   * order. The issue-type registry is read by `toProjectIssueTypes` in the
   * order sent (backend #212, never re-sorted). Workflows are keyed by issue
   * type as the server sent it. Only an entry with no type at all — `null` on
   * the wire — is dropped rather than guessed, and so is one with no workflow
   * in it.
   */
  async getProjectContext(projectId: string): Promise<ProjectContext> {
    const response = await this.request<RestProjectContext>(`/projects/${this.segment(projectId)}/context`);
    // Collected as pairs and built with `Object.fromEntries`, which defines
    // every key as an own property: an assignment would treat a type the
    // server spelled `__proto__` as a prototype rather than as a key.
    const entries: [IssueTypeCode, ProjectWorkflow][] = [];
    for (const entry of response.workflows ?? []) {
      const issueType = toIssueType(entry.issueType);
      if (!issueType || !entry.workflow || entries.some(([seen]) => seen === issueType)) continue;
      entries.push([
        issueType,
        {
          id: entry.workflow.id ?? "",
          name: entry.workflow.name ?? "",
          version: entry.workflow.version ?? 0,
          statuses: entry.workflow.statuses ?? [],
          transitions: entry.workflow.transitions ?? [],
        },
      ]);
    }
    const workflows: ProjectContext["workflows"] = Object.fromEntries(entries);
    return {
      project: response.project,
      role: toProjectRole(response.project.currentUserRole),
      members: (response.members ?? [])
        .filter((member) => Boolean(member.userId))
        .map((member) => toProjectMember(member))
        .sort(compareMembers),
      labels: (response.labels ?? []).map(toLabel),
      issueTypes: toProjectIssueTypes(response.issueTypes),
      workflows,
    };
  }

  /**
   * Derived from `GET /projects/{projectId}`, because there is no membership
   * route to call: backend TAS-137 put the role on the project read as
   * `currentUserRole` instead of adding one. Until TAS-219 this asked
   * `GET /projects/{projectId}/membership`, which has never existed: probed
   * without a token it answered the static-resource **404** on 2026-09-12, in
   * the same run where `GET /users/me` answered 401, and still did on
   * 2026-09-16, after TAS-137 deployed — so the path is unmapped rather than
   * merely unauthorised.
   *
   * The board asks for the project twice as a result, once here and once for
   * its own header. That is one extra GET of the cheapest read the gateway has,
   * and the alternative — taking the project from the caller — would put this
   * method's contract in the caller's hands.
   */
  async getMembership(projectId: string): Promise<ProjectMembership> {
    const project = await this.getProject(projectId);
    return {
      // What the server stated, and nothing in its place. `toProjectRole` reads
      // an absent key, an explicit `null` and a value this build does not
      // recognise as one `null`, and that `null` is the answer: the server named
      // no role this build can act on. It is not a VIEWER — until TAS-226 this
      // floored it to one, which was a permission nobody had stated, drawn as a
      // board that went read-only without a word — and it is not thrown either,
      // because the read answered. The board shows it as it shows a failed read:
      // writes off, and a banner that says why.
      //
      // No 200 from this route carries it since backend TAS-137 deployed: the
      // route refuses a non-member with 403, and a member's row holds a NOT NULL
      // role a CHECK constraint confines to the three (read at `develop`
      // `1cfe4d79f074`). The one `null` the gateway writes is on the
      // `POST /projects` response, which never comes here. Before the deploy
      // `ProjectResponseDto` had no `currentUserRole` at all, so a gateway that
      // predates it is how this answer is reached. The server stays
      // authoritative either way (AGENTS.md, role gating).
      role: toProjectRole(project.currentUserRole),
      // Both true on a 200, and neither is an assumption: `GET /projects/{id}`
      // is membership-checked, so a project the reader is not on answers 403
      // and one that does not exist answers 404 (TAS-154). Either way this
      // method rejects rather than reporting `false`, which is the same shape
      // the board already handles — it draws §4.18 for both, deliberately not
      // distinguishing "no such project" from "not yours".
      isMember: true,
      projectExists: true,
    };
  }

  /**
   * `GET /projects/{projectId}/members`, unwrapped from **`members`** rather
   * than the `items` every other collection on this class uses — that is what
   * `ListProjectMemberDetailsDto` calls its array.
   *
   * Written against backend PR #152 at head `1ad6ffad815d` while it was open,
   * when this route answered **405** (2026-09-12, no token: only POST was
   * mapped on the path). The PR merged into `develop` `1cfe4d79f074` and is
   * deployed — measured on 2026-09-16 without a token, the route answers 401 —
   * and it is the method the stand calls.
   *
   * **The row's `avatar` is read, and only its `downloadUrl`** (TAS-220, which
   * picked up what TAS-219 deliberately left: that comment said the avatars
   * story would land the rendering and the upload together rather than half of
   * each here, and this is that story). Reading it here is the whole reason a
   * board full of faces is one request: the avatar is declared inline on the
   * row, so nothing in this product ever calls `GET /users/{userId}/avatar` per
   * person. Rows carry one since TAS-225 — see `RestProjectMember`.
   *
   * **An unreadable avatar object costs that row's avatar, not this read.**
   * `enrichWithAvatarUrl` falls back per row since TAS-225 (read at backend
   * develop `398285cde074`); until then a missing object failed the whole read
   * with **404**, the status this route gives a missing project. A read that
   * fails for its own reasons is still mostly silent: the board's
   * `retryUnlessMissing` does not retry a 404 or a 403, only the watcher
   * section of an open issue says the members could not be read, and only to
   * an ADMIN. Everywhere else there are simply no assignee chips and no people
   * in the assignee filter, and the reporter reads "Unknown".
   *
   * The other six fields of `AvatarDto` stay dropped, and one of them is worth
   * recording so the next reader does not re-derive it: `createdAt` is declared
   * in the schema and is **never populated** — `AvatarResponse` in
   * project-service.proto has no `created_at` and `ProjectMapper.toAvatarDto`
   * sets six fields, not seven.
   *
   * **The order below is this client's own, not the server's.** The server's
   * is stable now: `findProjectMembers` in project-service ends
   * `ORDER BY pm.user_id ASC` on `develop` `1cfe4d79f074`, and nothing
   * downstream reorders it — it had no `ORDER BY` at the head this was first
   * written against, which is what the sort used to be for. It stays for a
   * different reason: a uuid order is not one a reader can use, and the avatar
   * stack, the assignee filter and the watcher picker all read this list.
   * Sorted by `displayName` (rows with no name last), `userId` as the tiebreak
   * so the order is total. What would remove this is the server sorting by name
   * after it joins in the user details, not the `ORDER BY` it already has.
   */
  async listMembers(projectId: string): Promise<ProjectMember[]> {
    const response = await this.request<RestProjectMembers>(`/projects/${this.segment(projectId)}/members`);
    // `?? []` like every other collection read here:
    // `ListProjectMemberDetailsDto` declares no `required` block, so a 200
    // carrying no `members` key is a legal answer to this route, and an
    // unguarded `.map` would reject with a `TypeError` — no code, no request
    // id, nothing `apiErrorFacts` can name.
    //
    // `.filter(...)` drops a row with no `userId` before it ever reaches
    // `toProjectMember`. `userId` is `ProjectMemberDetailsDto`'s join key (read
    // at PR #152's head), so a row missing it is not a shape the gateway sends —
    // only the schema's empty `required` block allows it in principle. This is
    // the mapper refusing to invent an id, not a compensation for an observed answer:
    // unlike a nameless row, which still has a `userId` a screen can act on, an
    // idless one has nothing to act on at all. Left in, it used to reach the
    // watcher picker's `<select>` as an option valued `""`, colliding with that
    // list's own placeholder and, with two such rows, with each other's React
    // `key`.
    //
    // `.sort(compareMembers)` after it, always — see the method doc above for
    // why the server's own order is not the one drawn.
    return (response.members ?? [])
      .filter((member) => Boolean(member.userId))
      .map((member) => toProjectMember(member))
      .sort(compareMembers);
  }

  /**
   * `POST /projects/{projectId}/members` with `{ userId, role }`, answered 201
   * with `ProjectMemberResponseDto`. See `TaskaApi.addProjectMember` for the
   * refusals and the order the server checks them in.
   *
   * The id goes out as the caller gave it, once `requireMemberUserId` has
   * accepted it, and is not repaired here: a layer that trimmed or lower-cased
   * its input would make a padded id succeed through here while the same body
   * from any other client is a 400. Since TAS-297 the members dialog sends
   * only ids the people directory answered with, which are already in the
   * stored form.
   */
  async addProjectMember(projectId: string, userId: string, role: ProjectRole): Promise<ProjectMemberWriteResult> {
    requireMemberUserId(userId);
    const response = await this.request<RestProjectMemberWrite | undefined>(
      `/projects/${this.segment(projectId)}/members`,
      { method: "POST", body: { userId, role } },
    );
    return toProjectMemberWriteResult(response, projectId, userId);
  }

  /** `PATCH /projects/{projectId}/members/{userId}` with `{ role }`, answered 200 with the same DTO. */
  async changeProjectMemberRole(
    projectId: string,
    userId: string,
    role: ProjectRole,
  ): Promise<ProjectMemberWriteResult> {
    requireMemberUserId(userId);
    const response = await this.request<RestProjectMemberWrite | undefined>(
      `/projects/${this.segment(projectId)}/members/${this.segment(userId)}`,
      { method: "PATCH", body: { role } },
    );
    return toProjectMemberWriteResult(response, projectId, userId);
  }

  /** `DELETE /projects/{projectId}/members/{userId}`, answered 204 with no body. */
  async removeProjectMember(projectId: string, userId: string): Promise<void> {
    requireMemberUserId(userId);
    await this.request<void>(`/projects/${this.segment(projectId)}/members/${this.segment(userId)}`, {
      method: "DELETE",
    });
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
   * `GET /projects/{projectId}/board` (backend #205, TAS-213). Every parameter
   * is optional and goes only when it says something: an id filter only when
   * set, `includeDone` only when `true` — `false` is the server's default, so
   * sending it would add a parameter that never changes an answer — and `query`
   * only when it is not blank, because the contract's `minLength: 1` refuses
   * an empty one. The board screen sends `includeDone=true` and nothing else.
   */
  async getBoard(projectId: string, params: BoardParams = {}): Promise<Board> {
    const search = new URLSearchParams();
    if (params.issueType) search.set("issueType", params.issueType);
    if (params.assigneeId) search.set("assigneeId", params.assigneeId);
    if (params.labelId) search.set("labelId", params.labelId);
    if (params.includeDone) search.set("includeDone", "true");
    if (params.priority) search.set("priority", params.priority);
    // As given: the gateway refuses an empty one (`minLength: 1`), as the
    // mock does. The board screen never sends a blank one.
    if (params.query !== undefined) search.set("query", params.query);
    if (params.pageSizePerColumn !== undefined) search.set("pageSizePerColumn", String(params.pageSizePerColumn));
    const response = await this.request<RestBoardResponse>(
      `/projects/${this.segment(projectId)}/board${this.query(search)}`,
    );
    return this.toBoard(response);
  }

  /**
   * `GET /projects/{projectId}/board/columns/{statusKey}/issues` (backend
   * TAS-430). The cursor first, then the filters by the board read's own rule —
   * each only when it says something, `includeDone` only when `true`, `query`
   * as given — then the page size. Half a cursor is sent as given: refusing it
   * is the server's, in its words.
   */
  async getBoardColumnPage(projectId: string, statusKey: string, params: BoardColumnPageParams = {}): Promise<BoardColumnPage> {
    const search = new URLSearchParams();
    if (params.afterCreatedAt !== undefined) search.set("afterCreatedAt", params.afterCreatedAt);
    if (params.afterId !== undefined) search.set("afterId", params.afterId);
    if (params.issueType) search.set("issueType", params.issueType);
    if (params.assigneeId) search.set("assigneeId", params.assigneeId);
    if (params.labelId) search.set("labelId", params.labelId);
    if (params.includeDone) search.set("includeDone", "true");
    if (params.priority) search.set("priority", params.priority);
    if (params.query !== undefined) search.set("query", params.query);
    if (params.pageSize !== undefined) search.set("pageSize", String(params.pageSize));
    const response = await this.request<RestBoardColumnPage>(
      `/projects/${this.segment(projectId)}/board/columns/${this.segment(statusKey)}/issues${this.query(search)}`,
    );
    const issues = (response.issues ?? []).map((issue) => this.toBoardIssue(issue));
    return {
      // The column asked about, when the answer does not name one.
      statusKey: typeof response.statusKey === "string" && response.statusKey !== "" ? response.statusKey : statusKey,
      issues,
      // The count as a column's. `hasMore` only as the server states it: the
      // count is the whole column's, not this page's, so the page's length
      // says nothing about what lies past it (api-contract-guard, TAS-438).
      totalCount: boardCounts(response.totalCount, null, issues.length).totalCount,
      hasMore: typeof response.hasMore === "boolean" ? response.hasMore : null,
    };
  }

  /**
   * `GET /project-stats` (backend TAS-211). `items ?? []` like every other
   * collection read here; members through `toProjectMember`, the mapper the
   * member list uses, and **in the server's order** — the first five by
   * `addedAt`, then `userId` — not re-sorted by name the way `listMembers` is:
   * the card's faces are the server's first four. A count that is not a number
   * is `null`, never `0`.
   */
  async getProjectStats(): Promise<ProjectStats[]> {
    const response = await this.request<RestProjectStatsList>("/project-stats");
    return (response.items ?? [])
      .filter((entry) => typeof entry.projectId === "string" && entry.projectId !== "")
      .map((entry) => ({
        projectId: entry.projectId as string,
        issueCount: typeof entry.issueCount === "number" ? entry.issueCount : null,
        memberCount: typeof entry.memberCount === "number" ? entry.memberCount : null,
        members: (entry.members ?? []).filter((member) => Boolean(member.userId)).map((member) => toProjectMember(member)),
      }));
  }

  /**
   * `GET /issues/search`. The whole of the compensation for TAS-180 lives in
   * the first three lines: a `query` the runtime would refuse never leaves this
   * process, and an absent one is *omitted* rather than sent empty — the
   * gateway answers `400` for `query=` and `200` for no `query` at all, so the
   * obvious implementation, which sets the parameter on every keystroke, turns
   * a cleared field into an error.
   *
   * The enum filters are typed, never stringly passed through. That is the
   * domain's own typing rather than a compensation: since backend TAS-218 an
   * unrecognised `priority` or `issueType` passes the edge and answers an
   * empty page (it was a `400` before, and a silently *wider* set before that).
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
    // above: the search DTO is still `IssueShortResponseDto` — with its project
    // and status since TAS-218, and nothing more — so filling in anything else
    // here would mean a `getIssue` per hit on every keystroke. The owner
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
   * `/issues/{issueId}` — so the argument is one the gateway never sees. It
   * stays in the signature because the mock does need it; see
   * `TaskaApi.getIssue`.
   */
  async getIssue(_projectId: string, issueId: string): Promise<IssueDetailsWithHistory> {
    const response = await this.request<RestIssueDetailsWithHistory>(`/issues/${this.segment(issueId)}`);
    return this.toIssueDetailsWithHistory(response);
  }

  /**
   * The key goes into the path encoded and otherwise untouched — not
   * upper-cased, not trimmed. The server matches it case-insensitively, and a
   * key that needs repairing is the caller's question, not this layer's.
   */
  async getIssueByKey(issueKey: string): Promise<Issue> {
    const response = await this.request<RestIssue>(`/issues/by-key/${this.segment(issueKey)}`);
    return this.toIssue(response);
  }

  /**
   * The body is built key by key rather than by passing `input` through: the
   * five planning fields have to be omitted when they are not set, and a
   * create has nothing to resolve them against, so `null` and `undefined`
   * collapse to the same omission here. `statusKey` goes only when stated
   * (backend TAS-428): without it the server creates in `TODO`.
   */
  async createIssue(projectId: string, input: CreateIssueInput): Promise<Issue> {
    refusePlanningFields(input);
    const response = await this.request<RestIssue>(`/projects/${this.segment(projectId)}/issues`, {
      method: "POST",
      body: {
        issueType: input.issueType,
        ...(input.statusKey !== undefined ? { statusKey: input.statusKey } : {}),
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
   * One request: `PATCH /issues/{issueId}` with `If-Match` and a body of only
   * the keys the caller stated (`issuePatchBody`). Nothing is read first —
   * the merge patch leaves an absent key alone on the server, so there is
   * nothing to re-send (see `TaskaApi.updateIssue` for the server's checks).
   *
   * The refusals that need nothing but the input are answered before the
   * request, as the gateway would answer them: the version, a blank summary,
   * and the input-only planning-field refusals. A date that only clashes with
   * the *stored* one is the server's to refuse, after its version check.
   *
   * A 409 whose body is an issue becomes `IssueVersionConflictError`, carrying
   * that issue as `current`. A 409 without one is passed on as the `ApiError`
   * it is: whatever it means, it is not this conflict, and inventing a
   * `current` for it would hand the caller an issue nobody sent.
   *
   * The answer is mapped without `labels` (`IssueWriteAnswer`): on this route
   * they are always `[]`, and a caller that took them would wipe the labels it
   * holds.
   */
  async updateIssue(
    _projectId: string,
    issueId: string,
    input: UpdateIssueInput,
    expectedVersion: number,
  ): Promise<IssueWriteAnswer> {
    const versionRefusal = issueVersionRefusal(expectedVersion);
    if (versionRefusal) throw new ApiError(versionRefusal.message, versionRefusal.code, 400);
    refusePlanningFields(input);
    const summaryRefusal = blankSummaryRefusal(input);
    if (summaryRefusal) throw new ApiError(summaryRefusal.message, summaryRefusal.code, 400);
    const typeRefusal = issueTypePatchRefusal(input);
    if (typeRefusal) throw new ApiError(typeRefusal.message, typeRefusal.code, 400);

    try {
      const answer = await this.request<RestIssue>(`/issues/${this.segment(issueId)}`, {
        method: "PATCH",
        body: issuePatchBody(input),
        headers: { "If-Match": ifMatch(expectedVersion) },
      });
      return writeAnswerOf(this.toIssue(answer));
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && isRestIssue(error.body)) {
        throw new IssueVersionConflictError(writeAnswerOf(this.toIssue(error.body)), expectedVersion, error.requestId);
      }
      throw error;
    }
  }

  async transitionIssue(_projectId: string, issueId: string, transitionId: string, expectedVersion?: number): Promise<Issue> {
    if (expectedVersion !== undefined) {
      const versionRefusal = issueVersionRefusal(expectedVersion);
      if (versionRefusal) throw new ApiError(versionRefusal.message, versionRefusal.code, 400);
    }
    const response = await this.request<RestIssueWithHistory>(
      `/issues/${this.segment(issueId)}/transition/${this.segment(transitionId)}`,
      {
        method: "PUT",
        // Backend TAS-422: the compare is atomic with the move. Without it the
        // server validates against one read and executes against another.
        ...(expectedVersion !== undefined ? { headers: { "If-Match": ifMatch(expectedVersion) } } : {}),
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

  async listIssueWatchers(projectId: string, issueId: string): Promise<IssueWatchers> {
    const response = await this.request<RestListIssueWatchersResponse>(this.watchersPath(projectId, issueId));
    return {
      // `watchers`, measured. See `RestListIssueWatchersResponse`.
      watchers: (response.watchers ?? []).map((watcher) => this.toIssueWatcher(watcher, projectId, issueId)),
      totalCount: toWatchersCount(response.totalCount),
    };
  }

  async watchIssue(projectId: string, issueId: string): Promise<WatchIssueResult> {
    // No body, and none may be added: the contract declares no request schema
    // for this route and says the user comes from the Gateway context (JWT).
    const response = await this.request<RestWatchIssueResponse>(`${this.watchersPath(projectId, issueId)}/me`, {
      method: "PUT",
    });
    return this.toWatchResult(response, projectId, issueId);
  }

  async unwatchIssue(projectId: string, issueId: string): Promise<UnwatchIssueResult> {
    const response = await this.request<RestUnwatchIssueResponse>(`${this.watchersPath(projectId, issueId)}/me`, {
      method: "DELETE",
    });
    return this.toUnwatchResult(response, issueId);
  }

  async addIssueWatcher(projectId: string, issueId: string, userId: string): Promise<WatchIssueResult> {
    const response = await this.request<RestWatchIssueResponse>(this.watchersPath(projectId, issueId), {
      method: "POST",
      body: { userId },
    });
    return this.toWatchResult(response, projectId, issueId);
  }

  async removeIssueWatcher(projectId: string, issueId: string, userId: string): Promise<UnwatchIssueResult> {
    const response = await this.request<RestUnwatchIssueResponse>(
      `${this.watchersPath(projectId, issueId)}/${this.segment(userId)}`,
      { method: "DELETE" },
    );
    return this.toUnwatchResult(response, issueId);
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
  putAttachmentBytes(uploadUrl: string, body: Blob, contentType: string): Promise<void> {
    return this.putPresignedBytes(uploadUrl, body, contentType);
  }

  /**
   * The body of both direct-to-store PUTs, written once. The two callers are
   * separate methods on `TaskaApi` because the *mock* cannot share them — an
   * avatar ticket and an attachment ticket are minted against different buckets
   * — but against a real store there is nothing to tell apart: a presigned URL
   * carries everything, including which bucket it is for.
   */
  private async putPresignedBytes(uploadUrl: string, body: Blob, contentType: string): Promise<void> {
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
      throw new ObjectStoreError(
        cause instanceof Error && cause.message ? `The file store could not be reached: ${cause.message}` : "The file store could not be reached.",
        OBJECT_STORE_UNREACHABLE_CODE,
        null,
      );
    }
    if (!response.ok) {
      // The store's status goes in the message and in `storeStatus`, never in a
      // field called `status`: see ObjectStoreError.
      throw new ObjectStoreError(
        `The file store answered ${response.status}.`,
        OBJECT_STORE_REJECTED_CODE,
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

  /**
   * The bytes behind a presigned download link — a GET straight to the store,
   * not through the gateway (TAS-253). Measured 2026-10-11 from
   * `https://taska.ozero.dev`: the cross-origin `fetch()` of a link on
   * `minio.taska.ozero.dev` answers 200 with a readable body.
   *
   * No headers, so it is a CORS "simple" request with no preflight to be
   * refused; `credentials: "omit"`, because nothing of this app's belongs on a
   * request to a host that is not the gateway; and the link is checked before
   * it is used (`requireUsableDownloadUrl`) for the reason the PUT's is. Every
   * failure is an `ObjectStoreError` — the store's status in `storeStatus` and
   * the message, never in a field called `status`.
   */
  async getAttachmentBytes(downloadUrl: string): Promise<Blob> {
    requireUsableDownloadUrl(downloadUrl);
    let response: Response;
    try {
      response = await fetch(downloadUrl, { credentials: "omit" });
    } catch (cause) {
      throw new ObjectStoreError(
        cause instanceof Error && cause.message ? `The file store could not be reached: ${cause.message}` : "The file store could not be reached.",
        OBJECT_STORE_UNREACHABLE_CODE,
        null,
      );
    }
    if (!response.ok) {
      throw new ObjectStoreError(`The file store answered ${response.status}.`, OBJECT_STORE_REJECTED_CODE, response.status);
    }
    try {
      return await response.blob();
    } catch (cause) {
      // The body stopped arriving after the headers did — a dropped
      // connection, as far as script can tell.
      throw new ObjectStoreError(
        cause instanceof Error && cause.message ? `The file store could not be read: ${cause.message}` : "The file store could not be read.",
        OBJECT_STORE_UNREACHABLE_CODE,
        null,
      );
    }
  }

  async deleteAttachment(projectId: string, issueId: string, attachmentId: string): Promise<void> {
    await this.request<void>(`${this.attachmentsPath(projectId, issueId)}/${this.segment(attachmentId)}`, {
      method: "DELETE",
    });
  }

  /**
   * Leg 1 of the avatar upload — `POST /users/me/avatar/upload-url`, backend PR
   * #150, **merged** at `develop` `368ae77355bd` and **deployed** later the
   * same day: probed 2026-09-12 without a token, this path and the three below
   * it answered Spring's static-resource 404 while `GET /users/me` answered
   * 401 in the same run, and the routes still answered it on 2026-09-14 at
   * 11:14 UTC, after the merge. Probed again at 13:53 UTC, this route answered
   * 405 rather than that 404 — `isUndeployedRoute`, whose one arm is that
   * 404, no longer matches on this gateway, though it is still what
   * `UserProfileMenu` reads before it offers a control or prints a refusal.
   *
   * Refused before the request by `refuseAvatar` below, with the answers the
   * gateway would give. The
   * response's `expiresIn` is carried up rather than dropped; `uploadUrl` and
   * `objectKey` land as `""` when absent, the way every other absent field on
   * this class does, and `requireUsableUploadUrl` is what stops an empty one
   * from becoming a same-origin PUT.
   */
  async createAvatarUploadUrl(input: CreateAvatarUploadUrlInput): Promise<AvatarUploadTicket> {
    refuseAvatar(input);
    const response = await this.request<RestAvatarUploadTicket>("/users/me/avatar/upload-url", {
      method: "POST",
      body: { fileName: input.fileName, contentType: input.contentType, sizeBytes: input.sizeBytes },
    });
    return {
      uploadUrl: response.uploadUrl ?? "",
      objectKey: response.objectKey ?? "",
      expiresIn: typeof response.expiresIn === "number" ? response.expiresIn : null,
    };
  }

  /**
   * Leg 2 — the browser's own PUT to the presigned host, sharing every word of
   * `putAttachmentBytes`'s reasoning and its implementation
   * (`putPresignedBytes` above): no bearer token, no `Accept`, no request id,
   * and exactly one header — the `Content-Type` that was signed.
   */
  putAvatarBytes(uploadUrl: string, body: Blob, contentType: string): Promise<void> {
    return this.putPresignedBytes(uploadUrl, body, contentType);
  }

  /**
   * Leg 3 — `POST /users/me/avatar/confirm`, which answers with the stored
   * avatar and its `downloadUrl`, so a freshly uploaded face needs no follow-up
   * read.
   *
   * No `Idempotency-Key` and no retry wrapper, and the reason is not the
   * attachment confirm's duplicate row. A repeat here is worse: the server does
   * not check that the key was minted for the caller, and a second confirm of
   * the key the saved row already holds deletes that very object before
   * presigning a link to it, answers 404, and leaves a row whose every later
   * presign fails — so `GET /users/me` carries `avatar: null,
   * avatarUnavailable: true` for that reader until an upload or a removal
   * replaces the row. So one key is confirmed once,
   * and a retry starts again at leg 1. See `confirmAvatarUpload` on TaskaApi.
   */
  async confirmAvatarUpload(input: ConfirmAvatarUploadInput): Promise<UserAvatar> {
    const response = await this.request<RestUserAvatar>("/users/me/avatar/confirm", {
      method: "POST",
      body: { objectKey: input.objectKey, fileName: input.fileName, contentType: input.contentType },
    });
    return toUserAvatar(response);
  }

  /**
   * `DELETE /users/me/avatar` — 204, and idempotent by the contract's own
   * words. `request` returns `undefined` for a 204, so there is nothing to map
   * and nothing this method can report about whether there was an avatar.
   */
  async deleteMyAvatar(): Promise<void> {
    await this.request<void>("/users/me/avatar", { method: "DELETE" });
  }

  /**
   * One page of the work log (backend TAS-421). `totalCount` and `hasMore` are
   * read only as the number and the boolean the contract states; anything
   * else is `null`, which the section never reads as a complete list.
   */
  async listIssueWorklogs(projectId: string, issueId: string, params: ListWorklogsParams = {}): Promise<IssueWorklogPage> {
    const search = new URLSearchParams();
    if (params.page !== undefined) search.set("page", String(params.page));
    if (params.pageSize !== undefined) search.set("pageSize", String(params.pageSize));
    const response = await this.request<RestWorklogsListResponse>(
      `${this.worklogsPath(projectId, issueId)}${this.query(search)}`,
    );
    const whole = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
    return {
      items: (Array.isArray(response?.items) ? response.items : []).map((worklog) => this.toWorklog(worklog)),
      page: whole(response?.page) ? response.page : (params.page ?? 0),
      pageSize: whole(response?.pageSize) ? response.pageSize : (params.pageSize ?? 0),
      totalCount: whole(response?.totalCount) ? response.totalCount : null,
      hasMore: typeof response?.hasMore === "boolean" ? response.hasMore : null,
    };
  }

  async addIssueWorklog(projectId: string, issueId: string, input: AddIssueWorklogInput): Promise<IssueWorklog> {
    const response = await this.request<RestWorklog>(this.worklogsPath(projectId, issueId), {
      method: "POST",
      body: {
        spentMinutes: input.spentMinutes,
        workDate: input.workDate,
        ...(input.comment !== undefined ? { comment: input.comment } : {}),
      },
    });
    return this.toWorklog(response);
  }

  /**
   * Sends exactly the fields it is given and nothing else: an absent field is
   * "unchanged" to the server, so filling one in would overwrite somebody
   * else's edit (there is no `If-Match` on this route). An empty input is sent
   * as it is and refused by the server with `400`; not sending one is the
   * caller's job.
   */
  async updateIssueWorklog(
    projectId: string,
    issueId: string,
    worklogId: string,
    input: UpdateIssueWorklogInput,
  ): Promise<IssueWorklog> {
    const body: UpdateIssueWorklogInput = {};
    if (input.spentMinutes !== undefined) body.spentMinutes = input.spentMinutes;
    if (input.workDate !== undefined) body.workDate = input.workDate;
    if (input.comment !== undefined) body.comment = input.comment;
    const response = await this.request<RestWorklog>(
      `${this.worklogsPath(projectId, issueId)}/${this.segment(worklogId)}`,
      { method: "PUT", body },
    );
    return this.toWorklog(response);
  }

  async deleteIssueWorklog(projectId: string, issueId: string, worklogId: string): Promise<void> {
    await this.request<void>(`${this.worklogsPath(projectId, issueId)}/${this.segment(worklogId)}`, {
      method: "DELETE",
    });
  }

  /**
   * `GET /projects/{projectId}/workflows` — see `TaskaApi.listProjectWorkflows`.
   * An item without a workflow is dropped, as the context drops one; an issue
   * type is kept as sent, a code this build has no name for included
   * (TAS-173). `shared` is `true` unless the server said `false` in so many
   * words: a flag nobody stated must not open the writes on the shared default.
   */
  async listProjectWorkflows(projectId: string): Promise<ProjectWorkflowEntry[]> {
    const response = await this.request<RestProjectWorkflows>(this.workflowsPath(projectId));
    return (response.items ?? []).flatMap((item) => (item.workflow ? [toProjectWorkflowEntry(item)] : []));
  }

  /**
   * `POST /projects/{projectId}/issue-types` — see
   * `TaskaApi.createProjectIssueType`. The six declared fields and nothing
   * else; `shape`, `icon` and `sortOrder` only when the caller states them
   * (backend TAS-432: no shape is the server's square, no icon is none). The
   * 201 is read as a registry entry is.
   */
  async createProjectIssueType(projectId: string, input: CreateProjectIssueTypeInput): Promise<ProjectIssueType> {
    const response = await this.request<unknown>(this.issueTypesPath(projectId), {
      method: "POST",
      body: {
        code: input.code,
        name: input.name,
        color: input.color,
        ...(input.shape !== undefined ? { shape: input.shape } : {}),
        ...(input.icon !== undefined ? { icon: input.icon } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      },
    });
    return this.toIssueTypeAnswer(response, input.code);
  }

  /**
   * `PATCH /projects/{projectId}/issue-types/{code}`. The body is whitelisted
   * (`projectIssueTypePatchBody`): no `code`, and `null` only as `icon: null`,
   * which removes the icon (backend TAS-432). An empty one is
   * refused here in the server's own words — the service refuses `{}` before
   * it looks at anything else, so the request would say nothing new.
   */
  async updateProjectIssueType(
    projectId: string,
    code: string,
    input: UpdateProjectIssueTypeInput,
  ): Promise<ProjectIssueType> {
    const body = projectIssueTypePatchBody(input);
    if (Object.keys(body).length === 0) throw new ApiError(ISSUE_TYPE_EMPTY_PATCH_MESSAGE, "INVALID_ARGUMENT", 400);
    const response = await this.request<unknown>(`${this.issueTypesPath(projectId)}/${this.segment(code)}`, {
      method: "PATCH",
      body,
    });
    return this.toIssueTypeAnswer(response, code);
  }

  /** `DELETE /projects/{projectId}/issue-types/{code}` — 204. */
  async deleteProjectIssueType(projectId: string, code: string): Promise<void> {
    await this.request<void>(`${this.issueTypesPath(projectId)}/${this.segment(code)}`, { method: "DELETE" });
  }

  /**
   * `PUT /projects/{projectId}/issue-types/order` (backend TAS-418) — see
   * `TaskaApi.reorderProjectIssueTypes`. `codes` is sent as given, repeats
   * included: refusing one is the server's, in its own words. The 200 is
   * `ListProjectIssueTypesDto`, the whole registry in its new order.
   */
  async reorderProjectIssueTypes(projectId: string, codes: readonly string[]): Promise<ProjectIssueType[]> {
    const response = await this.request<{ items?: unknown }>(`${this.issueTypesPath(projectId)}/order`, {
      method: "PUT",
      body: { codes: [...codes] },
    });
    return toProjectIssueTypes(response?.items);
  }

  /**
   * A registry write's 2xx as a registry entry, through the registry's own
   * reader. Both routes are about one code — the one the create sent, the one
   * in the PATCH path — so an answer that leaves `code` out is still about
   * that code, and is keyed by it rather than dropped.
   */
  private toIssueTypeAnswer(response: unknown, sentCode: string): ProjectIssueType {
    const wire = typeof response === "object" && response !== null ? (response as Record<string, unknown>) : {};
    const code = typeof wire.code === "string" && wire.code.trim() !== "" ? wire.code : sentCode;
    return (
      toProjectIssueType({ ...wire, code }) ?? { code, name: code, color: null, shape: null, icon: null, sortOrder: 0 }
    );
  }

  /**
   * `POST /projects/{projectId}/workflows`. The 201 is a `ProjectWorkflowDto`
   * since backend PR #225 — read as a list item is, so the bare workflow it
   * used to be parses into an entry with no types and `shared: true`, which
   * opens nothing.
   */
  async createProjectWorkflow(projectId: string, input: CreateProjectWorkflowInput): Promise<ProjectWorkflowEntry> {
    const response = await this.request<RestProjectWorkflowItem>(this.workflowsPath(projectId), {
      method: "POST",
      body: {
        name: input.name,
        issueTypes: input.issueTypes,
        statuses: input.statuses.map(workflowStatusBody),
        transitions: input.transitions.map(workflowTransitionBody),
      },
    });
    return toProjectWorkflowEntry(response);
  }

  async addWorkflowStatus(projectId: string, workflowId: string, input: WorkflowStatusInput): Promise<ProjectWorkflowEntry> {
    const response = await this.request<RestProjectWorkflowItem>(`${this.workflowPath(projectId, workflowId)}/statuses`, {
      method: "POST",
      body: workflowStatusBody(input),
    });
    return toProjectWorkflowEntry(response);
  }

  async addWorkflowTransition(
    projectId: string,
    workflowId: string,
    input: WorkflowTransitionInput,
  ): Promise<ProjectWorkflowEntry> {
    const response = await this.request<RestProjectWorkflowItem>(`${this.workflowPath(projectId, workflowId)}/transitions`, {
      method: "POST",
      body: workflowTransitionBody(input),
    });
    return toProjectWorkflowEntry(response);
  }

  /** `PATCH …/workflows/{workflowId}` — `PatchWorkflowRequestDto`, only the fields given. */
  async updateProjectWorkflow(
    projectId: string,
    workflowId: string,
    input: UpdateProjectWorkflowInput,
  ): Promise<ProjectWorkflowEntry> {
    const response = await this.request<RestProjectWorkflowItem>(this.workflowPath(projectId, workflowId), {
      method: "PATCH",
      body: definedFields({ version: input.version, name: input.name }),
    });
    return toProjectWorkflowEntry(response);
  }

  /**
   * `DELETE …/workflows/{workflowId}` with a JSON body, always — `request`
   * labels a body `application/json`, the type the gateway's typed route takes
   * (a body of another type is 415). An empty input is sent as `{}`.
   */
  async deleteProjectWorkflow(
    projectId: string,
    workflowId: string,
    input: DeleteProjectWorkflowInput,
  ): Promise<ProjectWorkflowEntry> {
    const response = await this.request<RestProjectWorkflowItem>(this.workflowPath(projectId, workflowId), {
      method: "DELETE",
      body: definedFields({
        version: input.version,
        statusMappings: input.statusMappings ? { ...input.statusMappings } : undefined,
      }),
    });
    return toProjectWorkflowEntry(response);
  }

  /** `PATCH …/statuses/{statusId}` — `PatchWorkflowStatusRequestDto`, only the fields given. */
  async updateWorkflowStatus(
    projectId: string,
    workflowId: string,
    statusId: string,
    input: UpdateWorkflowStatusInput,
  ): Promise<ProjectWorkflowEntry> {
    const response = await this.request<RestProjectWorkflowItem>(
      `${this.workflowPath(projectId, workflowId)}/statuses/${this.segment(statusId)}`,
      {
        method: "PATCH",
        body: definedFields({
          version: input.version,
          name: input.name,
          category: input.category,
          sortOrder: input.sortOrder,
        }),
      },
    );
    return toProjectWorkflowEntry(response);
  }

  /** `DELETE …/statuses/{statusId}?version=&targetStatusKey=`, each parameter only when given. */
  async deleteWorkflowStatus(
    projectId: string,
    workflowId: string,
    statusId: string,
    params: DeleteWorkflowStatusParams,
  ): Promise<ProjectWorkflowEntry> {
    const search = new URLSearchParams();
    if (params.version !== undefined) search.set("version", String(params.version));
    if (params.targetStatusKey !== undefined) search.set("targetStatusKey", params.targetStatusKey);
    const query = search.toString();
    const response = await this.request<RestProjectWorkflowItem>(
      `${this.workflowPath(projectId, workflowId)}/statuses/${this.segment(statusId)}${query ? `?${query}` : ""}`,
      { method: "DELETE" },
    );
    return toProjectWorkflowEntry(response);
  }

  /** `PATCH …/transitions/{transitionId}` — `PatchWorkflowTransitionRequestDto`, only the fields given. */
  async updateWorkflowTransition(
    projectId: string,
    workflowId: string,
    transitionId: string,
    input: UpdateWorkflowTransitionInput,
  ): Promise<ProjectWorkflowEntry> {
    const response = await this.request<RestProjectWorkflowItem>(
      `${this.workflowPath(projectId, workflowId)}/transitions/${this.segment(transitionId)}`,
      {
        method: "PATCH",
        body: definedFields({
          version: input.version,
          name: input.name,
          sortOrder: input.sortOrder,
          hidden: input.hidden,
        }),
      },
    );
    return toProjectWorkflowEntry(response);
  }

  /** `DELETE …/transitions/{transitionId}?version=`. */
  async deleteWorkflowTransition(
    projectId: string,
    workflowId: string,
    transitionId: string,
    params: DeleteWorkflowTransitionParams,
  ): Promise<ProjectWorkflowEntry> {
    const query = params.version !== undefined ? `?${new URLSearchParams({ version: String(params.version) })}` : "";
    const response = await this.request<RestProjectWorkflowItem>(
      `${this.workflowPath(projectId, workflowId)}/transitions/${this.segment(transitionId)}${query}`,
      { method: "DELETE" },
    );
    return toProjectWorkflowEntry(response);
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

  async listNotifications(params: ListNotificationsParams = {}): Promise<NotificationPage> {
    const search = new URLSearchParams();
    if (params.unreadOnly !== undefined) search.set("unreadOnly", String(params.unreadOnly));
    if (params.pageSize !== undefined) search.set("pageSize", String(params.pageSize));
    if (params.offset !== undefined) search.set("offset", String(params.offset));

    const response = await this.request<RestNotificationListResponse>(`/notifications${this.query(search)}`);
    return {
      items: response.items.map((notification) => this.toNotification(notification)),
      pageSize: params.pageSize ?? 20,
      offset: params.offset ?? 0,
      unreadCount: response.unreadCount,
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
    const response = await this.request<RestReadAllNotificationsResponse>("/notifications/read-all", {
      method: "POST",
    });
    return { updatedCount: response.updatedCount };
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

  listAuditEntries(query: AuditEntriesQuery): Promise<AuditEntries> {
    const search = new URLSearchParams();
    // The same basis conversion as `listAdminRows`: 1-based in the domain,
    // 0-based on the wire.
    if (query.page !== undefined) search.set("page", String(Math.max(0, query.page - 1)));
    if (query.pageSize !== undefined) search.set("pageSize", String(query.pageSize));
    // In the contract's order. An empty value is not sent: every filter is an
    // exact match on the server, and `""` would narrow to nothing.
    for (const key of [
      "actorUserId",
      "action",
      "targetService",
      "targetTable",
      "targetId",
      "requestId",
      "createdAtFrom",
      "createdAtTo",
    ] as const) {
      // Not trimmed: the server matches exactly. Empty is no filter.
      const value = query[key];
      if (value) search.set(key, value);
    }
    return this.request<RestAuditEntries>(`/readonly/audit-entries${this.query(search)}`).then((response) => {
      const entries = (response.entries ?? []).map(toAuditEntry);
      // Mapped as it arrives, in the server's order (`createdAt` desc, `id`
      // desc). Nothing here re-sorts it or slices it down to the page that was
      // asked for: the server pages, and a page that came back longer is the
      // server's statement, not this leg's to correct.
      return { entries, pagination: this.toPagination(response.pagination, query, entries.length) };
    });
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
        // Only an explicit `true` offers a Retry: anything else — `false`, an
        // absent field from a gateway older than TAS-200 — draws no button.
        retryable: event.retryable === true,
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
   * `POST /admin/outbox/{service}/{eventId}/retry`.
   *
   * A different reason guard from the three writes above, because the contract
   * states a different bound — 1–1000 here against their 1–550. See
   * `requireOutboxRetryReason` and `OUTBOX_RETRY_REASON_MAX_LENGTH`.
   *
   * `service` is escaped like every other path value even though its type is a
   * three-member union: the escaping is what the path is built with, not a
   * check, and a value that could not need it costs nothing to pass through it.
   */
  async retryOutboxEvent(
    service: RetryableOutboxService,
    eventId: string,
    reason: string,
  ): Promise<OutboxRetryResult> {
    const response = await this.request<RestOutboxRetryResult>(
      `/admin/outbox/${this.segment(service)}/${this.segment(eventId)}/retry`,
      { method: "POST", body: { reason: requireOutboxRetryReason(reason) } },
    );
    return {
      eventId: response.eventId,
      status: response.status,
      // `undefined` and `null` are one answer here — the schema can send either
      // and neither is a number — and the domain type has one spelling for it.
      attempts: response.attempts ?? null,
    };
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
    query: { page?: number; pageSize?: number },
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
    if (this.refreshInFlight?.authVersion === authVersion) return this.refreshInFlight.promise;
    const promise = this.refresh()
      .then(() => true)
      .catch(() => {
        this.expireSession(authVersion);
        return false;
      })
      .finally(() => {
        // A completed refresh from an earlier account must not clear a newer
        // account's flight or make its requests join the old result.
        if (this.refreshInFlight?.promise === promise) this.refreshInFlight = null;
      });
    this.refreshInFlight = { authVersion, promise };
    return promise;
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

  private watchersPath(projectId: string, issueId: string) {
    return `/projects/${this.segment(projectId)}/issues/${this.segment(issueId)}/watchers`;
  }

  private worklogsPath(projectId: string, issueId: string) {
    return `/projects/${this.segment(projectId)}/issues/${this.segment(issueId)}/worklogs`;
  }

  private issueTypesPath(projectId: string) {
    return `/projects/${this.segment(projectId)}/issue-types`;
  }

  private workflowsPath(projectId: string) {
    return `/projects/${this.segment(projectId)}/workflows`;
  }

  private workflowPath(projectId: string, workflowId: string) {
    return `${this.workflowsPath(projectId)}/${this.segment(workflowId)}`;
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

  /**
   * The avatar is stated rather than inferred: an absent `avatar` (a gateway
   * older than TAS-223) leaves both fields `undefined` — nobody was told — and
   * an explicit `null`, or an avatar with no usable link, is `null`. An empty
   * `downloadUrl` is `null` too, because `<img src="">` re-requests the page.
   *
   * `avatarUnavailable` is copied only when it is a boolean, and on its own —
   * not tied to whether `avatar` came. Absent, or anything else (`"true"`,
   * `null`), leaves the key off rather than defaulting it to `false`: `false`
   * is the server saying "I read the profile", and a client that writes that
   * on the server's behalf has invented an answer.
   */
  private toUser(user: RestUser): User {
    const avatar = user.avatar;
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      status: toUserStatus(user.status),
      color: user.color,
      globalRole: toGlobalRole(user.globalRole),
      ...(avatar === undefined
        ? {}
        : {
            avatarUrl: typeof avatar?.downloadUrl === "string" && avatar.downloadUrl ? avatar.downloadUrl : null,
            avatarId: typeof avatar?.id === "string" && avatar.id ? avatar.id : null,
          }),
      ...(typeof user.avatarUnavailable === "boolean" ? { avatarUnavailable: user.avatarUnavailable } : {}),
    };
  }

  /**
   * `IssueResponseDto` → `Issue`, for the detail read *and*, since TAS-195,
   * for every row of `listIssues`: the two routes answer with the same schema,
   * so a field this method forgets to default is a hundred cards rather than
   * one panel.
   *
   * The five planning fields are folded one by one rather than left to the
   * spread. A spread of a response that carries none of them — every response
   * from a gateway older than merged PR #148, and every response whose issue
   * simply has no plan — produces five members that are `undefined` while their
   * type says `number | null`: it type-checks by structural accident and
   * renders the string "undefined" on the card.
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
   * `description` is defaulted because `""` is how the rest of the UI already
   * spells "no description" — the panel's textarea, the board's search — so
   * nothing downstream has to learn a second spelling of empty. It used to be
   * defaulted for the edit's full-replace `PUT` as well, which re-sent the
   * stored description and would have dropped a required key on an
   * `undefined`; the edit is a `PATCH` now and sends only what changed, so that
   * reason is gone and this one is enough.
   *
   * It is **not** the field that blanks the application, and an earlier version
   * of this paragraph said it was. The board's filter tests
   * `issue.summary.toLowerCase()` before it reaches the description, so a row
   * bare enough to be missing one has already thrown on the summary; and an
   * absent description renders as `<p>{undefined}</p>`, which draws nothing and
   * throws nothing. The dereferences that really do take the whole app need no
   * keystroke and are not in this mapper — `Record` lookups on `issueType` and
   * `priority` in the card render path, over two fields no spec constrains to
   * an enum. They are their own defect with their own line in
   * `docs/ai/BACKLOG.md`; this default neither causes nor fixes them.
   *
   * For `status` there is no such harmless value. Every candidate is a real
   * column, so an invented one puts the card under a heading the server does not
   * agree with, and the drag out of that column then asks for a transition from
   * a status the issue was never in. A statusless card matches no column and
   * does not appear (`BoardScreen` groups by `issue.status ===
   * status.statusKey`) — while still being counted at *both* ends of that
   * screen's "X of Y" header, since `filteredIssues` and `issues` each hold it.
   * The board reads "10 of 10" over nine cards. That is still the recoverable
   * failure of the two, and its visible half is in `docs/ai/BACKLOG.md` with
   * this reasoning rather than papered over here with an invented column.
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
      timeSpentMinutes: wholeMinutes(issue.timeSpentMinutes),
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
   * `BoardResponseDto` → `Board`. The columns and the cards inside them are
   * passed through in the order the server sent them rather than re-sorted
   * here: the server decides the board's shape, and a client that quietly
   * re-ordered would hide the day it stops agreeing.
   */
  /**
   * The board, its counts read defensively (backend TAS-392): a `totalCount`
   * that is not a whole number is `null` — `Unknown` on screen, never the
   * number of cards drawn — and a `hasMore` that is not a boolean is worked out
   * from the count when there is one, else `null`.
   */
  private toBoard(response: RestBoardResponse): Board {
    const unplacedIssues = (response.unplacedIssues ?? []).map((issue) => this.toBoardIssue(issue));
    const unplaced = boardCounts(response.unplacedTotalCount, response.unplacedHasMore, unplacedIssues.length);
    return {
      projectId: response.projectId,
      columns: (response.columns ?? []).map((column) => {
        const issues = (column.issues ?? []).map((issue) => this.toBoardIssue(issue));
        return {
          statusKey: column.statusKey,
          name: column.name,
          category: column.category,
          sortOrder: column.sortOrder,
          issues,
          ...boardCounts(column.totalCount, column.hasMore, issues.length),
        };
      }),
      unplacedIssues,
      unplacedTotalCount: unplaced.totalCount,
      unplacedHasMore: unplaced.hasMore,
    };
  }

  /**
   * `BoardIssueDto` → `BoardIssue`, field by field like `toIssueSearchHit` and
   * for the same reason: a spread would widen a card the day the DTO grows a
   * property, and four of its properties are deliberately not read.
   *
   * Values pass through as sent — a card that cannot be drawn is the board's
   * to contain (`IssueCardFailure`), not this mapper's to repair. Two
   * normalisations only: a blank `displayName` is `null`, as on every other
   * summary of a person (the gateway answers `""` when auth-service is down),
   * and a label with no id is dropped, because a chip nobody can address is
   * worse than no chip.
   */
  private toBoardIssue(issue: RestBoardIssue): BoardIssue {
    const assignee = issue.assignee;
    return {
      id: issue.id,
      issueKey: issue.issueKey,
      summary: issue.summary,
      issueType: issue.issueType,
      priority: issue.priority,
      statusKey: issue.statusKey,
      description: issue.description ?? null,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
      version: issue.version,
      assignee:
        assignee && typeof assignee.id === "string" && assignee.id !== ""
          ? {
              id: assignee.id,
              displayName: assignee.displayName?.trim() ? assignee.displayName : null,
              avatarUrl: assignee.avatarUrl || null,
            }
          : null,
      labels: (Array.isArray(issue.labels) ? issue.labels : [])
        .filter((label) => typeof label?.id === "string" && label.id !== "")
        .map((label) => toLabel(label)),
    };
  }

  /**
   * `IssueShortResponseDto` → `IssueSearchHit`, field by field rather than by
   * spread. The listing is the point: a spread would quietly widen the hit the
   * day the DTO grows a field. It grew three with TAS-218 — the project and
   * the status key — and each is listed below, blank read as absent.
   */
  private toIssueSearchHit(item: RestIssueShortItem): IssueSearchHit {
    return {
      id: item.id,
      issueKey: item.issueKey,
      issueType: item.issueType,
      // TAS-418, TAS-432: the look the hit's project registry gives its type.
      // A blank name is no name; a colour, a shape or an icon outside the
      // contract's sets is `null`, drawn by DESIGN.md §4.6's fallbacks rather
      // than guessed; an icon `null` or left out is a type without one.
      issueTypeName:
        typeof item.issueTypeName === "string" && item.issueTypeName.trim() !== "" ? item.issueTypeName : null,
      issueTypeColor: isIssueTypeColor(item.issueTypeColor) ? item.issueTypeColor : null,
      issueTypeShape: isIssueTypeShape(item.issueTypeShape) ? item.issueTypeShape : null,
      issueTypeIcon: isIssueTypeIcon(item.issueTypeIcon) ? item.issueTypeIcon : null,
      summary: item.summary,
      priority: item.priority,
      // `""` for unassigned, exactly as the list endpoint answers — same
      // normalisation as `toIssue`, so one shape of "nobody" reaches the UI.
      assigneeId: item.assigneeId || null,
      // `??`, not `||`: an issue estimated at zero points has been estimated.
      storyPoints: item.storyPoints ?? null,
      projectId: item.projectId || null,
      projectKey: item.projectKey || null,
      statusKey: item.statusKey || null,
    };
  }

  /**
   * `IssueDetailsWithHistoryResponseDto` → `IssueDetailsWithHistory`, field by
   * field for everything the details DTO adds, so a key the schema does not
   * have cannot ride into the domain on a spread.
   *
   * A part the response did not carry — absent or `null` — becomes `null`, and
   * `[]` stays `[]`. That is the only distinction the wire allows; see
   * `IssueDetails` for the one it does not.
   */
  private toIssueDetailsWithHistory(response: RestIssueDetailsWithHistory): IssueDetailsWithHistory {
    const wire = response.issue;
    const { labels, assignee, reporter, watchers, isWatching, links, attachments, commentCount, ...plain } = wire;
    const base = this.toIssue(plain);
    const issueId = base.id;
    const projectId = base.projectId;
    const issue: IssueDetails = {
      ...base,
      labels: Array.isArray(labels) ? labels.map((label) => toLabel(label)) : null,
      assignee: assignee ? toUserSummary(assignee, base.assigneeId) : null,
      reporter: reporter ? toUserSummary(reporter, base.reporterId) : null,
      watchers: Array.isArray(watchers)
        ? {
            watchers: watchers.map((watcher) => this.toIssueWatcher(watcher, projectId, issueId)),
            // The details DTO states no count, so none is stated here. The
            // list's length is not one: a part that failed arrives as `[]`
            // (`IssueDetails`), and its length would put a "0" on screen that
            // the server never said. The panel draws no count until this read
            // carries one (backend ask A3).
            totalCount: null,
          }
        : null,
      isWatching: typeof isWatching === "boolean" ? isWatching : null,
      links: Array.isArray(links) ? links.map((link) => this.toIssueLink(link)) : null,
      attachments: Array.isArray(attachments)
        ? attachments.map((attachment) => this.toAttachment(attachment, issueId))
        : null,
      commentCount: typeof commentCount === "number" ? commentCount : null,
    };
    return {
      issue,
      history: (response.history ?? []).map(({ participants, ...event }) => ({
        ...event,
        issueId,
        actor: toNullableUserSummary(event.actor, event.actorUserId),
        // Backend TAS-431: who the payload names, by id. Each entry read like
        // `actor`; one that names nobody is left out, as the server leaves out
        // an id it found no profile for.
        participants: toParticipants(participants),
        // No channel mark from this gateway: TAS-411 has not said what the
        // field is called or what it holds, so whatever a key of that name
        // might carry is not read (docs/ai/API-DIVERGENCE.md, "TAS-412").
        via: null,
      })),
    };
  }

  /**
   * Passes `viewLinkType` through as an open string — values this build has
   * never heard of included, which is the point of the field — with one
   * normalisation: the contract's `IssueLinkViewTypeDto` (backend PR #200)
   * spells every value with the proto enum's prefix, as the gateway always sent
   * it (`IssueMapper.toRestIssueLinkResponse` calls `.name()`), so the
   * `ISSUE_LINK_VIEW_TYPE_` prefix is stripped here and `BLOCKS` reaches the
   * label helper as `BLOCKS`.
   *
   * Two of the contract's values mean "no relation stated" rather than a
   * relation, and become the empty string the label helper reads as "Linked":
   * `ISSUE_LINK_VIEW_TYPE_UNSPECIFIED`, the proto zero value, and
   * `UNRECOGNIZED`, which protobuf's `.name()` returns for a number the
   * gateway's generated enum does not know and which carries no prefix at all.
   * A non-string (or absent) value is the same nothing.
   */
  private toIssueLink(link: RestIssueLink): IssueLink {
    return {
      id: link.id ?? "",
      projectId: link.projectId ?? "",
      sourceIssueId: link.sourceIssueId ?? "",
      targetIssueId: link.targetIssueId ?? "",
      viewLinkType: toViewLinkType(link.viewLinkType),
      createdBy: link.createdBy ?? "",
      createdAt: link.createdAt ?? "",
      target: toLinkedIssue(link.target),
    };
  }

  /**
   * Same rule as `toAttachment` below: the ids the caller asked with fill in
   * for ids the response omitted, because those two are not inventions — the
   * route was scoped to this project and this issue. `userId` is not defaulted
   * that way and never can be: nothing in the request says who is watching, so
   * a blank stays blank and the panel draws the row as an unnamed watcher
   * rather than attributing it to somebody.
   */
  private toIssueWatcher(watcher: RestIssueWatcher, projectId: string, issueId: string): IssueWatcher {
    return {
      id: watcher.id ?? "",
      issueId: watcher.issueId ?? issueId,
      projectId: watcher.projectId ?? projectId,
      userId: watcher.userId ?? "",
      createdAt: watcher.createdAt ?? "",
      createdBy: watcher.createdBy ?? "",
      displayName: watcher.displayName?.trim() ? watcher.displayName : null,
      avatarUrl: watcher.avatarUrl || null,
    };
  }

  private toWatchResult(
    response: RestWatchIssueResponse,
    projectId: string,
    issueId: string,
  ): WatchIssueResult {
    return {
      watcher: response.watcher ? this.toIssueWatcher(response.watcher, projectId, issueId) : null,
      watchersCount: toWatchersCount(response.watchersCount),
    };
  }

  /**
   * `removed` defaults to **`false`**, and that is the safe direction rather
   * than the pessimistic one. The field means "a subscription was actually
   * deleted"; a response that does not state it has not claimed one was, and
   * announcing a change nobody can evidence is the failure this DTO exists to
   * prevent. The end state is the same either way — the caller asked to not be
   * watching, and it is not — so the default costs a sentence, never a fact.
   */
  private toUnwatchResult(response: RestUnwatchIssueResponse, issueId: string): UnwatchIssueResult {
    return {
      issueId: response.issueId ?? issueId,
      removed: response.removed === true,
      watchersCount: toWatchersCount(response.watchersCount),
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
      uploadedByUser: attachment.uploadedByUser
        ? toUserSummary(attachment.uploadedByUser, attachment.uploadedBy ?? null)
        : null,
    };
  }

  /** Field by field, for the reason `toNotification` gives. */
  /**
   * `author` is kept apart three ways (backend TAS-421): absent — a write's
   * answer, which never names the author — stays absent, so the row that knew
   * its author keeps it; `null` (or not an object) is nobody named; a summary
   * is read field by field like a history event's actor.
   */
  private toWorklog(worklog: RestWorklog): IssueWorklog {
    return {
      id: worklog.id,
      issueId: worklog.issueId,
      projectId: worklog.projectId,
      authorUserId: worklog.authorUserId,
      spentMinutes: worklog.spentMinutes,
      workDate: worklog.workDate,
      comment: worklog.comment ?? null,
      createdAt: worklog.createdAt,
      updatedAt: worklog.updatedAt ?? null,
      ...(Object.hasOwn(worklog, "author") ? { author: toNullableUserSummary(worklog.author, worklog.authorUserId) } : {}),
    };
  }

  private toComment(comment: RestComment): IssueComment {
    return {
      ...comment,
      updatedAt: comment.updatedAt ?? null,
      author: comment.author ? toUserSummary(comment.author, comment.authorUserId) : null,
      // No channel mark from this gateway yet (TAS-411), as in `getIssue`'s history.
      via: null,
    };
  }

  /**
   * Field by field rather than a spread, so a key the schema no longer has —
   * `link` and `userId` on an older gateway — cannot ride through into the
   * domain object and be read by someone who takes it for current.
   */
  private toNotification(notification: RestNotification): Notification {
    return {
      id: notification.id,
      notificationType: notification.notificationType,
      title: notification.title,
      body: notification.body,
      issueId: notification.issueId ?? null,
      issueKey: notification.issueKey ?? null,
      projectId: notification.projectId ?? null,
      createdAt: notification.createdAt,
      readAt: notification.readAt ?? null,
      sourceEventId: notification.sourceEventId,
    };
  }

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return (await this.exchange<T>(path, options)).data;
  }

  /**
   * `request` with the HTTP status beside the body, for the one route whose
   * status says something the body does not (`inviteUser`: 201 against 200).
   */
  private async exchange<T>(path: string, options: RequestOptions = {}, isRetry = false): Promise<{ status: number; data: T }> {
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
      // Retrying a current-user mutation with a different account's credentials
      // would apply the old account's action to the newly signed-in one. Check
      // both sides of the refresh await: the account can change at either wait.
      if (!isRetry && authVersion === this.authVersion && this.refreshTokenValue
          && (await this.tryRefresh()) && authVersion === this.authVersion) {
        return this.exchange<T>(path, options, true);
      }
      this.expireSession(authVersion);
    }

    if (response.status === 204) {
      return { status: 204, data: undefined as T };
    }

    const data = (await response.json().catch(() => undefined)) as T | ApiErrorBody | undefined;
    if (!response.ok) {
      const body = data as ApiErrorBody | undefined;
      const message = body?.message ?? body?.error?.message ?? `Request failed with ${response.status}`;
      const code = body?.code ?? body?.error?.code ?? "UNKNOWN";
      const requestId = response.headers.get("X-Request-Id") ?? body?.error?.requestId;
      throw new ApiError(message, code, response.status, requestId ?? undefined, data, errorDetails(body?.details));
    }
    return { status: response.status, data: data as T };
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  skipAuth?: boolean;
  headers?: Record<string, string>;
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
 * The three roles the domain knows, and `null` for everything else — the field
 * missing, an explicit `null`, a role added after this build, a number where a
 * string was promised. Same shape and the same reason as `toGlobalRole` above:
 * an unrecognised value means the server did not state a role this build can
 * act on, and passing it up would let a component compare or draw it.
 *
 * Both member rows and `Project.currentUserRole` are read through here, for
 * different reasons and by different routes to the same `null` — an earlier
 * version of this comment said only the first could really produce one off
 * the wire, citing `ANY_UNMAPPED → UNSPECIFIED`; that mapping is the inbound
 * *write* path and was the wrong mechanism. A member row's `role` is filled by
 * MapStruct's built-in enum-to-string conversion (`.name()`) off a column a
 * CHECK constraint confines to ADMIN, MEMBER and VIEWER
 * (`ck_project_members_role`, project-service `0000-init.sql`), so an
 * unrecognised string is not actually on the wire today — the narrowing guards
 * a role the enum grows later, arriving verbatim before this build knows its
 * name. `currentUserRole` cannot carry that case at all: at `develop`
 * `1cfe4d79f074` `ProjectMapper.toRestProjectRole` returns `null` rather than
 * emit an unmapped project role. What it *can* carry is an explicit JSON
 * `null` — the api-gateway configures no Jackson inclusion override, so its
 * default `ALWAYS` still serialises the key of a response built without a
 * role — which lands here as "no role", the same answer a member row's missing
 * key gives. No read builds one: a 200 from `GET /projects/{id}` or from
 * `GET /projects` always states the reader's role, and the only such response
 * is the one `POST /projects` answers with.
 */
function toProjectRole(value: unknown): ProjectRole | null {
  return value === "ADMIN" || value === "MEMBER" || value === "VIEWER" ? value : null;
}

/**
 * `NotificationPreferencesDto` as it arrives (TAS-387): `telegramStatus` is
 * read as `unknown`, so a status the enum grows later reaches the profile as
 * "this build does not know it" rather than as a value it was never written
 * for (TAS-173).
 */
type RestNotificationPreferences = Omit<NotificationPreferences, "telegramStatus"> & { telegramStatus?: unknown };

/** One of the five statuses the contract lists, or `null` for anything else. */
function toTelegramStatus(value: unknown): TelegramStatus | null {
  return value === "NOT_CONNECTED" ||
    value === "PENDING" ||
    value === "AWAITING_CONFIRMATION" ||
    value === "CONNECTED" ||
    value === "UNAVAILABLE"
    ? value
    : null;
}

function toNotificationPreferences(wire: RestNotificationPreferences): NotificationPreferences {
  return { ...wire, telegramStatus: toTelegramStatus(wire.telegramStatus) };
}

/**
 * One `PersonalAccessTokenDto`, field by field, so nothing else the body
 * carries rides into the domain object — a secret least of all. `null` for a
 * row without a usable id (the contract requires a UUID): it could be neither
 * revoked nor told apart. Any other field that is not what the contract says
 * arrives as the empty string, `[]` or `null`, never as whatever it was.
 */
function toAccessToken(value: unknown): AccessToken | null {
  const token = toAccessTokenFields(value);
  return token.id.trim() ? token : null;
}

/** `toAccessToken` without the id check: what the create answer said, `id: ""` included. */
function toAccessTokenFields(value: unknown): AccessToken {
  const wire = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const text = (key: string) => (typeof wire[key] === "string" ? (wire[key] as string) : "");
  return {
    id: text("id"),
    name: text("name"),
    tokenPrefix: text("tokenPrefix"),
    scopes: Array.isArray(wire.scopes) ? wire.scopes.filter((scope): scope is string => typeof scope === "string") : [],
    createdAt: text("createdAt"),
    expiresAt: text("expiresAt"),
    lastUsedAt: typeof wire.lastUsedAt === "string" ? wire.lastUsedAt : null,
  };
}

/**
 * `PersonalTokenPolicyDto`: both numbers whole and at least 1, or `null` —
 * a policy this build cannot read is no policy, and the form then offers no
 * lifetime rather than one the server might refuse.
 */
function toAccessTokenPolicy(value: unknown): AccessTokenPolicy | null {
  if (typeof value !== "object" || value === null) return null;
  const { maxLifetimeDays, maxActiveTokens } = value as Record<string, unknown>;
  const whole = (item: unknown): item is number => typeof item === "number" && Number.isSafeInteger(item) && item >= 1;
  return whole(maxLifetimeDays) && whole(maxActiveTokens) ? { maxLifetimeDays, maxActiveTokens } : null;
}

/**
 * The account status as the server sent it, or `null` when it stated none: not
 * a string (the gateway's `AuthMapper` can write `null`), or `UNSPECIFIED`, the
 * contract's zero value — which backend PR #200 added to `UserStatusDto` — read
 * as absent exactly as `toGlobalRole` reads its own. Anything else is kept as
 * it came and printed by `userStatusLabel` (TAS-173).
 */
function toUserStatus(value: unknown): string | null {
  return typeof value === "string" && value !== "UNSPECIFIED" ? value : null;
}

/**
 * An issue type code as the server sent it, or `null` when there is none — the
 * wire's own `null`, a blank, anything that is not a string. Not narrowed to
 * the three this build knows (TAS-173): a project's workflow for a type added
 * after this build still carries that type's issues.
 */
function toIssueType(value: unknown): IssueTypeCode | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * A `WorkflowResponseDto`, field by field, with the context's defaults for a
 * field the wire left out. `hidden` is `true` only when the server said so —
 * the list always sends a boolean, and a transition that arrives without one
 * is one the board would offer.
 */
function toWorkflowDefinition(workflow: RestWorkflowDefinition): WorkflowDefinition {
  return {
    id: workflow.id ?? "",
    name: workflow.name ?? "",
    version: workflow.version ?? 0,
    createdAt: workflow.createdAt ?? "",
    updatedAt: workflow.updatedAt ?? "",
    statuses: (workflow.statuses ?? []).map((status) => ({
      id: status.id ?? "",
      statusKey: status.statusKey ?? "",
      name: status.name ?? "",
      category: status.category ?? "",
      sortOrder: status.sortOrder ?? 0,
    })),
    transitions: (workflow.transitions ?? []).map((transition) => ({
      id: transition.id ?? "",
      fromStatusId: transition.fromStatusId ?? "",
      toStatusId: transition.toStatusId ?? "",
      name: transition.name ?? "",
      sortOrder: transition.sortOrder ?? 0,
      hidden: transition.hidden === true,
    })),
  };
}

/**
 * One `ProjectWorkflowDto` — a list item, or a write's answer. An issue type is
 * kept as sent, a code this build has no name for included (TAS-173), and
 * `shared` is `true` unless the server said `false` in so many words: a flag
 * nobody stated must not open the writes on the shared default. A missing
 * workflow reads as an empty one with no id, which no entry on screen matches.
 */
function toProjectWorkflowEntry(item: RestProjectWorkflowItem): ProjectWorkflowEntry {
  return {
    workflow: toWorkflowDefinition(item.workflow ?? {}),
    issueTypes: (Array.isArray(item.issueTypes) ? item.issueTypes : []).flatMap((code) => {
      const issueType = toIssueType(code);
      return issueType ? [issueType] : [];
    }),
    shared: item.shared !== false,
  };
}

/**
 * The fields of a workflow edit that were given. The edit DTOs are
 * `additionalProperties: false` and refuse an explicit `null`, so a field the
 * caller left `undefined` is left out of the body rather than sent empty.
 */
function definedFields(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined && value !== null));
}

/** `CreateWorkflowStatusRequestDto`, exactly the four fields. */
function workflowStatusBody(input: WorkflowStatusInput) {
  return { statusKey: input.statusKey, name: input.name, category: input.category, sortOrder: input.sortOrder };
}

/** `CreateWorkflowTransitionRequestDto`, `hidden` always stated rather than left to the contract's default. */
function workflowTransitionBody(input: WorkflowTransitionInput) {
  return {
    fromStatusKey: input.fromStatusKey,
    toStatusKey: input.toStatusKey,
    name: input.name,
    sortOrder: input.sortOrder,
    hidden: input.hidden,
  };
}

/**
 * One `GET /meta` dictionary. Not an array → `null` (the answer did not carry
 * it); a row without a non-blank string `code` is dropped; a missing or
 * non-string `name` is `""`, which every reader prints the code for. A
 * duplicated code keeps its first row. Codes are not checked against this
 * build's unions — the values it does not know are the reason to ask.
 *
 * `selectable` is `true` unless the row says `false` in so many words: the
 * contract's default is `true` and the field is not required (backend #201),
 * so its absence — every row of a gateway older than that PR — is not a
 * refusal to be offered.
 *
 * `readCode` is for the one dictionary whose codes are not read as they come:
 * `linkViewTypes`, which goes through `toViewLinkType`. A code it answers blank
 * for is dropped like any unusable one.
 */
function toDictionary(value: unknown, readCode: (code: string) => string = (code) => code): DictionaryEntry[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<string>();
  const entries: DictionaryEntry[] = [];
  for (const row of value) {
    if (typeof row !== "object" || row === null) continue;
    const { code: wire, name, selectable } = row as { code?: unknown; name?: unknown; selectable?: unknown };
    if (typeof wire !== "string") continue;
    const code = readCode(wire);
    if (code.trim() === "" || seen.has(code)) continue;
    seen.add(code);
    entries.push({ code, name: typeof name === "string" ? name : "", selectable: selectable !== false });
  }
  return entries;
}

/**
 * `UserDirectoryResponseDto` → `DirectoryPage`. Both fields are required by the
 * contract and are read defensively anyway: a row without a string `id` names
 * nobody and is dropped, a missing name or email is `""`, and `hasMore` is
 * `true` only when the server said so — a page that cannot say whether there
 * is more offers no "Show more" rather than one that would loop.
 */
function toDirectoryPage(value: unknown): DirectoryPage {
  const body = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const items: DirectoryUser[] = [];
  for (const row of Array.isArray(body.items) ? body.items : []) {
    if (typeof row !== "object" || row === null) continue;
    const { id, displayName, email, avatarUrl } = row as Record<string, unknown>;
    if (typeof id !== "string" || id === "") continue;
    items.push({
      id,
      displayName: typeof displayName === "string" ? displayName : "",
      email: typeof email === "string" ? email : "",
      avatarUrl: typeof avatarUrl === "string" && avatarUrl !== "" ? avatarUrl : null,
    });
  }
  return { items, hasMore: body.hasMore === true };
}

/**
 * `ProjectMemberDetailsDto` → `ProjectMember`. `addedAt` and `addedBy` are not
 * set because the DTO does not carry them.
 *
 * `user` is built only when the row states a `displayName`, and the blank is
 * not passed through: every screen that draws a member decides between a person
 * and its own unknown-person path by whether `user` is there at all
 * (`toUserMap` filters on it, and the assignee chip's `?? "User"` cannot catch
 * an empty string, since `"".split(" ")[0]` is `""`). A row that gives only an
 * email is therefore an unnamed member here. The members panel (TAS-158) is the
 * one reader of a member's email, and it reads it only beside a name — an
 * unnamed row draws the id and says no account came back for it. That sentence
 * leans on auth-service rather than on this file: `users.display_name` is
 * `NOT NULL` and an invitation refuses a blank one, so an email with no name is
 * not a shape its lookup produces for an account that exists (read at backend
 * `develop` `1cfe4d79f074`). A row the lookup has no account for arrives with
 * neither (TAS-227).
 */
function toProjectMember(member: RestProjectMember): ProjectMember {
  const displayName = typeof member.displayName === "string" ? member.displayName.trim() : "";
  const downloadUrl = member.avatar?.downloadUrl;
  return {
    userId: member.userId ?? "",
    role: toProjectRole(member.role),
    // New on the row with backend PR #169 (TAS-212); kept only when it is there.
    ...(typeof member.addedAt === "string" && member.addedAt ? { addedAt: member.addedAt } : {}),
    // The avatar rides inside `user` and therefore shares its condition: a row
    // the server named nobody in has no `user` at all, so a picture with no
    // name to put under it is dropped with the rest of the row. That is the
    // right side to lose it on — every caller reads `member.user` to decide
    // between drawing a person and drawing its own unknown-person path, and a
    // face over "Unknown" would claim an identity the response did not state.
    //
    // `null` and not `undefined` when the row carries no avatar: the member
    // list *asked*, inline, and got an answer. `undefined` is reserved for
    // "nobody has asked" (see `User.avatarUrl`), which is never the case here.
    user: displayName
      ? { displayName, email: member.email ?? "", avatarUrl: typeof downloadUrl === "string" && downloadUrl ? downloadUrl : null }
      : undefined,
  };
}

/**
 * `ProjectMemberResponseDto` — what the add and the role change answer with.
 * Every field optional because the schema declares no `required` block; `role`
 * is `unknown` for the reason `RestProjectMember.role` is, although this one
 * goes through `ProjectMapper.toRestProjectRole` and so arrives as one of the
 * three or as `null` (read at backend `develop` `1cfe4d79f074`).
 */
interface RestProjectMemberWrite {
  projectId?: string;
  userId?: string;
  role?: unknown;
}

/**
 * The write's answer as the domain holds it. `projectId` and `userId` fall back
 * to the request's own, which named both — an answer that omitted one is still
 * about the membership that was asked for, and an empty string there would be
 * an id nobody can act on. The fallback is the caller's spelling of the id; the
 * server's is lower-case, which is only different for a caller that did not
 * normalise.
 *
 * `role` does not fall back to the role that was asked for. A role the answer
 * does not state is exactly the case `null` exists for, and filling it from the
 * request would report a change the server never confirmed.
 */
function toProjectMemberWriteResult(
  response: RestProjectMemberWrite | undefined,
  projectId: string,
  userId: string,
): ProjectMemberWriteResult {
  return {
    projectId: response?.projectId || projectId,
    userId: response?.userId || userId,
    role: toProjectRole(response?.role),
  };
}

/**
 * The id every member write names, refused before the request when it is not
 * one — as `INVALID_ARGUMENT` on `400`, the shape `requireSearchQuery` and
 * `requireAdminWriteReason` below use, with the same sentence the mock uses. The
 * server would refuse most of these too, with its own wording, and accept a few
 * spellings this does not; `isUserId` (src/api/members.ts) says which and why.
 */
function requireMemberUserId(userId: string): void {
  if (!isUserId(userId)) {
    throw new ApiError(MEMBER_USER_ID_REFUSAL_MESSAGE, "INVALID_ARGUMENT", 400);
  }
}

/**
 * `AvatarResponseDto` as the domain holds it. Blanks become the domain's own
 * spelling of "not stated", exactly as `toAttachment` does it — and
 * `downloadUrl` becomes `null` rather than `""`, because an empty string in an
 * `<img src>` re-requests the current document.
 */
function toUserAvatar(avatar: RestUserAvatar): UserAvatar {
  return {
    id: avatar.id ?? "",
    userId: avatar.userId ?? "",
    objectKey: avatar.objectKey ?? "",
    fileName: avatar.fileName ?? "",
    contentType: avatar.contentType ?? "",
    sizeBytes: typeof avatar.sizeBytes === "number" ? avatar.sizeBytes : 0,
    createdAt: avatar.createdAt ?? null,
    downloadUrl: typeof avatar.downloadUrl === "string" && avatar.downloadUrl ? avatar.downloadUrl : null,
  };
}

/**
 * `listMembers`'s own order, not the server's — see that method's doc for why
 * one is needed at all. Named rows sort by `displayName`; a row with no
 * `user` sorts after every named one, because it has nothing to alphabetise
 * by. `userId` breaks every remaining tie — two rows `localeCompare` calls
 * equal, whether that is the same string twice or two spellings that collate
 * to 0 without being identical (NFC vs NFD of the same accented name, for
 * instance), and two rows with no name — so the comparator is a total order,
 * and the name order it draws does not depend on the order the response body
 * arrived in. The server's own order is stable by `userId` now; this is for
 * name order only, and no longer what stops the list reshuffling.
 */
function compareMembers(a: ProjectMember, b: ProjectMember): number {
  const nameA = a.user?.displayName ?? null;
  const nameB = b.user?.displayName ?? null;
  if (nameA !== null && nameB !== null) {
    const byName = nameA.localeCompare(nameB);
    if (byName !== 0) return byName;
  }
  if ((nameA === null) !== (nameB === null)) {
    return nameA === null ? 1 : -1;
  }
  return a.userId.localeCompare(b.userId);
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
 * `UserSummaryDto` → `UserSummary`. `fallbackId` is the id the surrounding row
 * already states for the same person (`assigneeId`, `uploadedBy`,
 * `authorUserId`), used only when the summary omits its own.
 *
 * A blank `displayName` becomes `null`: the gateway answers `""` when
 * auth-service is down, and that is "not named", not a name.
 */
function toUserSummary(summary: RestUserSummary, fallbackId: string | null): UserSummary {
  return {
    id: summary.id || fallbackId || "",
    displayName: summary.displayName?.trim() ? summary.displayName : null,
    avatarUrl: summary.avatarUrl || null,
  };
}

/**
 * `timeSpentMinutes` (backend TAS-431): a whole number of minutes `>= 0`, or
 * `null` — the total is drawn from nothing else (DESIGN.md §4.24).
 */
function wholeMinutes(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/**
 * `IssueHistoryResponseDto.participants` (backend TAS-431) — `UserSummaryDto`
 * by the id the payload names. Not an object is no names; each entry through
 * `toNullableUserSummary` with its key as the id it falls back to, and an entry
 * that is not an object is dropped, as the server leaves out an id it found no
 * profile for. A blank name stays `null`, and `personFor` then asks the member
 * list.
 */
function toParticipants(value: unknown): Record<string, UserSummary> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const named: Record<string, UserSummary> = {};
  for (const [id, wire] of Object.entries(value as Record<string, unknown>)) {
    const summary = toNullableUserSummary(wire, id);
    if (summary) named[id] = summary;
  }
  return named;
}

/** A column's (or the unplaced bucket's) `totalCount` and `hasMore`, read as `Board` states them. */
function boardCounts(total: unknown, more: unknown, drawn: number): { totalCount: number | null; hasMore: boolean | null } {
  const totalCount = typeof total === "number" && Number.isSafeInteger(total) && total >= 0 ? total : null;
  const hasMore = typeof more === "boolean" ? more : totalCount === null ? null : totalCount > drawn;
  return { totalCount, hasMore };
}

/**
 * A nullable `UserSummaryDto` — a history event's `actor` (backend TAS-398),
 * a work log row's `author` (TAS-421) —
 * `null` when absent, `null` or not an object; otherwise each field on its own:
 * an id that is not a non-empty string falls back to the id beside it
 * (`actorUserId`, `authorUserId`), a name that is not a non-blank string is `null` (the gateway
 * answers `""` when auth-service is down), and so is an avatar link that is
 * not a non-empty string. Nothing here consults the member list — that is
 * `personFor`'s second step, on screen.
 */
function toNullableUserSummary(actor: unknown, actorUserId: unknown): UserSummary | null {
  if (typeof actor !== "object" || actor === null || Array.isArray(actor)) return null;
  const { id, displayName, avatarUrl } = actor as Record<string, unknown>;
  return {
    id: typeof id === "string" && id ? id : typeof actorUserId === "string" ? actorUserId : "",
    displayName: typeof displayName === "string" && displayName.trim() ? displayName : null,
    avatarUrl: typeof avatarUrl === "string" && avatarUrl ? avatarUrl : null,
  };
}

/**
 * `TargetIssueDto` → `LinkedIssue`, or `null` when the link carried none. A
 * target without an id or a key identifies nothing a row could open or name, so
 * it is dropped to `null` rather than drawn half-filled.
 */
function toLinkedIssue(target: RestLinkedIssue | null | undefined): LinkedIssue | null {
  if (!target?.id || !target.issueKey) return null;
  return {
    id: target.id,
    issueKey: target.issueKey,
    summary: target.summary ?? "",
    projectId: target.projectId ?? "",
    statusKey: target.statusKey ?? "",
  };
}

/** `toIssue`'s answer as a write states it: the same issue, without the labels a write never fills. */
function writeAnswerOf(issue: Issue): IssueWriteAnswer {
  const { labels: _labels, ...answer } = issue;
  return answer;
}

/**
 * Whether a 409's body is the issue `PATCH /issues/{issueId}` answers a
 * conflict with, rather than a `{code, message}`. An id and a numeric version
 * are the two facts a caller acts on: the version to send next, and that it
 * is this issue.
 */
function isRestIssue(body: unknown): body is RestIssue {
  if (typeof body !== "object" || body === null) return false;
  const { id, version } = body as { id?: unknown; version?: unknown };
  return typeof id === "string" && id !== "" && typeof version === "number";
}

/**
 * A watcher count as the server stated it, or `null` for "the server did not
 * state one".
 *
 * Deliberately **not** `?? 0`, which is the shape every other numeric field in
 * this file uses. Zero is a fact about an issue — nobody is watching it — and no
 * field of any watcher schema is `required`, so a `200` that omits the count is
 * legal. Collapsing the two would put "0 watchers" on screen for an issue whose
 * count nobody knows, and the caller would have no way to tell. `typeof` rather
 * than a truthiness check, because `0` is exactly the value that must survive.
 */
function toWatchersCount(value: number | undefined): number | null {
  return typeof value === "number" ? value : null;
}

/**
 * The search query as the gateway would accept it, or `null` for "no text
 * filter". It lives on this side of the wire so that the `400` the gateway
 * would answer with is never spent: the minimum is 3 (`minLength: 3` since
 * backend PR #200, an empty string included), so a cleared field becomes an
 * absent parameter rather than an empty one. Measured on the trimmed value,
 * which is what gets searched.
 *
 * The refusal is the **client's own**: `INVALID_ARGUMENT` on `400`, the code
 * and status the gateway uses, so nothing has to special-case it — but the
 * sentence is `SEARCH_QUERY_TOO_SHORT_MESSAGE`, issue-service's wording, which
 * the server never sends at its default configuration. The gateway's binding
 * refuses such a query first, as "Invalid request parameters", and that is
 * what the mock answers.
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
 * thrown here as the client's own `INVALID_ARGUMENT` on `400` — the same shape
 * as `requireSearchQuery` above and the same wording the mock uses, so a caller
 * cannot tell a value stopped here from one stopped there. Every one of them is
 * decided by the input alone, on a create and on an edit alike.
 */
function refusePlanningFields(input: PlanningFieldsInput): void {
  const refusal = planningFieldRefusal(input);
  if (refusal) {
    throw new ApiError(refusal.message, refusal.code, 400);
  }
}

/**
 * The file refusals from src/api/attachments.ts, thrown as the gateway's own
 * answer so a file stopped here is indistinguishable from one stopped there.
 * All three arms share that answer: **400** `INVALID_ARGUMENT` (read at
 * `develop` `1cfe4d79f074`).
 *
 * - **disallowed type** — reaches `S3StorageClient.validateFileParams`, which
 *   raises `DomainStatus.INVALID_ARGUMENT`. `RestErrorMapper` maps that to
 *   **400** and `GatewayErrorHandler` writes the gRPC code's own name into
 *   `code` (read at PR #147's head `f53dca38`).
 * - **empty file** and **over-size** — never reach issue-service at all.
 *   `sizeBytes` carries `minimum: 1` and `maximum: 2097152` in the contract,
 *   and the gateway generates its interfaces with `useValidation`, so `@Min(1)`
 *   or `@Max(2097152)` fails first and `GatewayValidationExceptionHandler`
 *   answers **400** `INVALID_ARGUMENT` with its fixed
 *   `"Invalid request parameters"`. This throws `validateFileParams`'s sentence
 *   for both instead, which is the one part of the gateway's answer it does not
 *   reproduce — nobody reads it: the panel refuses both in its own words before
 *   this is reached.
 *
 * The ceiling used to be the odd one out here, synthesised as a **500** that no
 * gateway ever answered. It was a reading of backend PR #147's older head
 * `f53dca38`, where the DTO stated no `maximum`, so an over-size file reached
 * `validateFileParams` and was refused `OUT_OF_RANGE` — which `RestErrorMapper`
 * had no row for, so it fell to a 500. The PR's head moved to `deeedbf`
 * (committed 2026-09-09) with both the `maximum` and the row
 * (`OUT_OF_RANGE` → 400), which removed the 500 before any gateway served these
 * routes. This repository re-pinned that head on 2026-09-12 and updated the
 * YAML half — the extract gained the `maximum` — but missed the Java half, and
 * kept synthesising the 500 until TAS-224 caught it. The leg-3 re-measure still
 * refuses an oversized object with `OUT_OF_RANGE`, on 400.
 *
 * Nothing reads the status that changed: the panel takes
 * `apiErrorFacts(error).message`, and the only `status >= 500` readers in this
 * build are `userWriteFailure` (src/screens/admin/users.ts) and `AdminError`
 * (src/screens/admin/), which no attachment failure reaches.
 */
function refuseAttachment(input: CreateAttachmentUploadUrlInput): void {
  const refusal = attachmentRefusal(input);
  if (!refusal) return;
  // One code for all three arms, as `MockTaskaStore.createAttachmentUploadUrl`
  // throws it, so the two implementations answer the same file the same way.
  throw new ApiError(refusal, "INVALID_ARGUMENT", 400);
}

/**
 * The same refusal for an avatar, as the gateway would answer it, before a
 * request is spent — in the gateway's order, which is not the profile menu's.
 *
 * - **over 2 MB** fails the generated DTO's `@Max(2097152)` as the gateway
 *   reads the body (`maximum: 2097152` since backend TAS-222, `be6ea7f`), and
 *   `GatewayValidationExceptionHandler` answers **400** `INVALID_ARGUMENT`
 *   "Invalid request parameters". This runs before anything looks at the
 *   content type, so a 3 MB GIF draws this answer and not the type refusal —
 *   which is why it is checked first here.
 * - **a disallowed type** — `S3StorageClient.validateFileParams` in
 *   auth-service, `INVALID_ARGUMENT` on 400 in its own words.
 * - **an empty file** — bean-validated at the gateway too (`minimum: 1`), with
 *   the same code and status as the type arm; this throws
 *   `validateFileParams`'s sentence for it rather than the gateway's, as
 *   `refuseAttachment` does, and nothing reads the difference — the menu
 *   refuses an empty file in its own words before this is reached.
 *
 * The schema used to declare 5 MB while auth-service enforced 2 MB, so a file
 * between the two was refused a layer deeper with `OUT_OF_RANGE`; that band is
 * gone, and `OUT_OF_RANGE` now only comes back from the confirm (leg 3), which
 * re-measures the stored object. A code read at `60d62ee`, not a measurement:
 * no over-size avatar has been sent to the stand.
 *
 * Nothing reads the status: the profile menu refuses all three before a
 * request, and prints `apiErrorFacts(error).message` for anything the gateway
 * refuses.
 */
function refuseAvatar(input: CreateAvatarUploadUrlInput): void {
  if (input.sizeBytes > AVATAR_MAX_SIZE_BYTES) {
    throw new ApiError(AVATAR_GATEWAY_REFUSAL_MESSAGE, "INVALID_ARGUMENT", 400);
  }
  // Only the type and the empty file can be left: the size was answered above.
  const refusal = avatarRefusal(input);
  if (refusal) throw new ApiError(refusal, "INVALID_ARGUMENT", 400);
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
 * function decides: `AGENTS.md` requires mock and rest to stay
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

/**
 * The same guard for the outbox retry, and a **separate function on purpose**.
 *
 * The blank half is shared word for word — `minLength: 1` is the same rule on
 * all four admin writes, and the server refuses a whitespace-only reason the
 * same way for all four. The upper half is not: this route declares
 * `maxLength: 1000` where block, unblock and reset-lockout declare 550, so
 * folding the two into one function would have needed the limit as a parameter
 * and the message with it — at which point the "one guard" was two guards with
 * a shared body and a name that told the reader they were the same rule.
 *
 * They are not the same rule. The contract states two numbers, in two schemas,
 * and this file states them the same way. The cost is six duplicated lines; the
 * thing bought is that nobody reading either function comes away believing the
 * gateway has a single reason limit.
 *
 * Measured on the trimmed value like its neighbour, so 1000 characters of text
 * plus a trailing newline is accepted rather than refused on a character nobody
 * typed on purpose — and the trimmed value is what goes out, which is also what
 * the backend stores (`OutboxRetryServiceImpl` trims it into the audit row).
 */
function requireOutboxRetryReason(raw: string): string {
  const reason = raw.trim();
  if (reason === "") {
    throw new ApiError(ADMIN_WRITE_REASON_REQUIRED_MESSAGE, "INVALID_ARGUMENT", 400);
  }
  if (reason.length > OUTBOX_RETRY_REASON_MAX_LENGTH) {
    throw new ApiError(OUTBOX_RETRY_REASON_TOO_LONG_MESSAGE, "INVALID_ARGUMENT", 400);
  }
  return reason;
}
