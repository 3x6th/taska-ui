import type { AccessTokenExpiryDays, AccessTokenScopes } from "./accessTokens";
import type {
  AccessToken,
  AdminCatalog,
  AdminRow,
  AdminRowQuery,
  AdminRows,
  AdminRowsQuery,
  AuditEntries,
  AuditEntriesQuery,
  AttachmentDownloadUrl,
  AttachmentUploadTicket,
  AvatarUploadTicket,
  Board,
  DateOnly,
  DirectoryPage,
  Issue,
  IssueAttachment,
  IssueComment,
  EnumDictionaries,
  IssueLink,
  IssueLinkTypeCode,
  IssuePriorityCode,
  IssueSearchHit,
  IssueStatusKey,
  IssueTypeCode,
  IssueWatchers,
  IssueWorklog,
  IssueDetailsWithHistory,
  IssuedAccessToken,
  InvitationResult,
  Label,
  Notification,
  NotificationPage,
  NotificationPreferences,
  NotificationPreferencesPatch,
  OutboxRetryResult,
  Page,
  ProblematicOutboxSummary,
  Project,
  ProjectContext,
  ProjectLabel,
  ProjectMember,
  ProjectMembership,
  ProjectMemberWriteResult,
  ProjectRole,
  ProjectStats,
  ProjectWorkflowEntry,
  TelegramLink,
  UnwatchIssueResult,
  User,
  UserAvatar,
  UserStatusChange,
  WatchIssueResult,
} from "../domain/types";

export interface LoginInput {
  email: string;
  password: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AcceptInvitationInput {
  token: string;
  newPassword: string;
}

/**
 * `GET /users` — the people directory (backend #204, TAS-204). `page` is
 * zero-based, 0–1000; `pageSize` 1–50, the server's default 20.
 */
export interface SearchUsersParams {
  /**
   * Callers trim it and never pass fewer than `DIRECTORY_QUERY_MIN_CODE_POINTS`
   * code points. Rest also refuses one on the client, after trimming, without
   * a request; the mock answers as the server would — the gateway's binding on
   * the raw value, then auth-service on the trimmed one.
   */
  query: string;
  page?: number;
  pageSize?: number;
}

/**
 * `POST /auth/invitations` — `InvitationRequestDto`. The server trims and
 * lower-cases `email`; `displayName` is used only when the call creates the
 * account, and a blank one becomes the part of the email before `@`. `resend`
 * asks for a new link even while the current one still works, which revokes
 * the current one.
 */
export interface InviteUserInput {
  email: string;
  displayName?: string;
  resend?: boolean;
}

/**
 * The shortest people-directory query, in **code points** after trimming —
 * auth-service's own rule (`UserDirectoryService.search`: `strip()`, then
 * `codePointCount`), and the contract's `minLength: 3`. The two are not one
 * check: the gateway binds the raw query and refuses one under three UTF-16
 * characters before sign-in, "Invalid request parameters"; auth-service then
 * refuses a trimmed one under three code points in its own sentence
 * (`DIRECTORY_QUERY_REFUSAL_MESSAGE`). So "  ab " passes the first and fails
 * the second. The rest leg trims and counts code points before the request,
 * which spends neither.
 */
export const DIRECTORY_QUERY_MIN_CODE_POINTS = 3;

/** `maxLength: 100` on the query — the field's own cap, so the gateway's is never met. */
export const DIRECTORY_QUERY_MAX_LENGTH = 100;

/**
 * auth-service's refusal of a directory query out of range (backend #204,
 * `UserDirectoryService.search`), and what the rest leg throws for a query it
 * will not send. Reproduced rather than reworded because, unlike issue search's
 * `SEARCH_QUERY_TOO_SHORT_MESSAGE`, the server really does answer it — for a
 * query whose raw length passes the gateway and whose trimmed one does not.
 */
export const DIRECTORY_QUERY_REFUSAL_MESSAGE = "Query must contain 3-100 characters, page 0-1000 and pageSize 1-50";

/** A query's length the way auth-service measures it: trimmed, in code points. */
export function directoryQueryLength(query: string): number {
  return [...query.trim()].length;
}

/** `maxLength` of `InvitationRequestDto.email` and `.displayName` — the form's caps. */
export const INVITE_EMAIL_MAX_LENGTH = 320;
export const INVITE_DISPLAY_NAME_MAX_LENGTH = 128;

/**
 * `CreateProjectRequestDto`. `description` and `color` came with backend PR
 * #155 (TAS-145), merged and deployed, and both are optional. A blank or
 * whitespace-only description is stored as `null` (PR #155 as merged).
 *
 * A project that is to stay on its computed colour is created without one,
 * which is why the create form offers "Automatic" and omits the field for it
 * rather than sending the computed value. It is not the only way back to a
 * computed colour — `PATCH` clears one with an explicit `null` (see
 * `UpdateProjectInput`) — but sending the computed value would still be wrong:
 * it would store a colour the reader never chose, and the badge would stop
 * following the key.
 */
export interface CreateProjectInput {
  projectKey: string;
  name: string;
  /** 0–2000 characters. Omitted rather than sent blank when nothing was typed. */
  description?: string;
  /** `^#[0-9A-Fa-f]{6}$`. Omitted for a project that should compute its own. */
  color?: string;
}

/**
 * `UpdateProjectRequestDto` — every field optional, PATCH semantics: a field
 * that is not here is not changed.
 *
 * `projectKey` is deliberately absent and cannot be added: the route's own
 * description says "project_key через этот эндпоинт изменить нельзя", and the
 * key is the prefix of every `issueKey` in the project, so changing it would
 * rewrite every issue's identity.
 *
 * Three spellings per string field — read out of backend PR #155 as merged,
 * where the gateway parses the body by hand in `ProjectController` to tell an
 * explicit `null` from an absent key:
 *
 * - **absent** (`undefined` here, the key not on the wire) — keep;
 * - **`null`** — clear: `description` and `color` go back to `null`, and a
 *   project without a colour is coloured from its key again (TAS-171);
 * - **a string** — set. A blank or whitespace-only `description` is stored as
 *   `null`, the same clear; the UI sends `null` itself. `color: ""` is a
 *   **400**: the schema's `^#[0-9A-Fa-f]{6}$` rejects it.
 *
 * `name` takes no `null`: `name: null` is a 400 "Invalid request parameters",
 * and so is a blank name — and so is an unknown or immutable key, or a value
 * that is not a string. `{}` is a 200 that changes nothing.
 */
export interface UpdateProjectInput {
  /** 1–255 characters. A blank name is a 400, not a clear — and so is `null`, which is why the type has none. */
  name?: string;
  /** `null` clears. A blank string is stored as `null` too. */
  description?: string | null;
  /** `null` clears, back to the colour computed from the key. `""` is a 400. */
  color?: string | null;
}

export interface ListIssuesParams {
  status?: IssueStatusKey;
  assigneeId?: string;
  /** `labelId` on the wire: the issues carrying this label, filtered by the server. */
  labelId?: string;
  page?: number;
  pageSize?: number;
}

/**
 * Everything `GET /projects/{projectId}/board` takes since backend #205
 * (TAS-213): six filters, every one optional and all ANDed by the server.
 *
 * Without `issueType` the board is about TASK, BUG and STORY together (see
 * `Board`); with it, about that one type. `assigneeId`, `labelId` and
 * `priority` narrow the issues and never the columns. `query` is a literal,
 * case-insensitive substring over the key, the summary and the description,
 * `minLength: 1` in the contract — a blank one is not sent.
 *
 * `includeDone` filters **issues, not columns**: omitted or `false`, the
 * issues whose status the workflow of their own type files under the `DONE`
 * category are left out while the columns stay. The board screen always sends
 * `true` (TAS-202): `false` would empty every done column of a board that is
 * meant to be complete. `false` and `undefined` are the same request, which is
 * why the implementations send the parameter only when it is `true`.
 *
 * The board screen sends `includeDone` and nothing else: its four filters are
 * local over the complete read (DESIGN.md §5.4) until the route pages (backend
 * A3).
 */
export interface BoardParams {
  issueType?: IssueTypeCode;
  assigneeId?: string;
  labelId?: string;
  includeDone?: boolean;
  priority?: IssuePriorityCode;
  query?: string;
}

/**
 * The shortest `query` `GET /issues/search` will answer — **three**, the
 * contract's `minLength: 3` since backend PR #200. The gateway generates its
 * controller from that contract, so it refuses a raw `query` under three
 * characters, the empty one included, while binding the request — before
 * sign-in, as 400 `INVALID_ARGUMENT` "Invalid request parameters",
 * `details: null`. Probed without a token 2026-10-19: `?query=ab` 400
 * (`f4857c3e-98fa-4450-a193-9146767cea70`), `?query=` 400
 * (`69e851a1-9e3f-4762-b8a5-2bac1de81ee0`), `?query=abc` 401
 * (`ae6f1390-aa64-4828-9fd2-133470cdc8f1`). It is exported so the mock, the
 * REST mapper and every field in the UI read the same number: a UI that
 * searched from two characters would meet a `400` at the boundary and nowhere
 * else, which is the worst place to find a gap.
 *
 * Omitting the parameter is a `200` with everything. So an absent query means
 * "no text filter" and an *empty* one is a rejected query, never a silent
 * "show me everything".
 */
export const SEARCH_QUERY_MIN_LENGTH = 3;

/**
 * The client's own refusal of a query below that minimum — what `RestTaskaApi`
 * throws instead of spending the request. The words are issue-service's
 * (`IssueServiceImpl.searchIssues`), but issue-service never gets to say them
 * at its default configuration: the gateway's binding refuses the same query
 * first, in its own sentence (see `SEARCH_QUERY_MIN_LENGTH`). So this is not
 * an answer the server gives, and nothing should read it as one.
 */
export const SEARCH_QUERY_TOO_SHORT_MESSAGE = `Search query must be at least ${SEARCH_QUERY_MIN_LENGTH} characters`;

/**
 * The contract's own spelling for a project colour — `^#[0-9A-Fa-f]{6}$`, on
 * `CreateProjectRequestDto.color` and `UpdateProjectRequestDto.color` in
 * backend PR #155 (TAS-145).
 *
 * Byte-equal to what `isLabelColor` in src/lib/format.ts tests, and
 * deliberately **not** the same function. That one guards a value on its way
 * into a `style` attribute and says in its own comment that it makes no claim
 * about the contract; this one is a claim about the contract and nothing else.
 * Merging them would mean a future tightening of either job silently changing
 * the other — and the two do not even share a subject, since `isLabelColor`
 * also filters avatar colours the gateway has never heard of.
 *
 * What it is for, concretely: `""` fails it, so an empty colour is a 400 on
 * `PATCH` rather than a clear. Clearing is an explicit `null`, which the
 * pattern never sees — see `UpdateProjectInput`.
 */
export const PROJECT_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

/**
 * The longest `reason` the admin user writes accept — `maxLength: 550` in the
 * contract branch that adds them, which becomes `@Size(max = 550)` on the
 * gateway's generated request DTO and is checked nowhere else on the server
 * (see `ADMIN_WRITE_REASON_TOO_LONG_MESSAGE` below).
 *
 * Named for the family rather than for one member of it: the same rule governs
 * `block`, `unblock` and `reset-lockout`, all three of which declare the same
 * 1–550 `reason` and refuse a request without one.
 *
 * Exported so that the field's own `maxLength`, the remaining-characters hint
 * and **both** implementations' refusals all read one number: a form that let
 * 600 through would meet a `400` at the boundary and nowhere else.
 */
export const ADMIN_WRITE_REASON_MAX_LENGTH = 550;

/**
 * What every implementation says when the reason is longer than that, worded
 * once here: two copies of a sentence are two chances to drift, and the whole
 * point of this pair of guards is that a caller cannot tell mock from rest.
 *
 * Not the server's own wording, because the server has none to reproduce. The
 * 550 is stated in exactly one place on the backend — `maxLength` in the
 * contract, which becomes `@Size(max = 550)` on the gateway's generated request
 * DTO. Neither `auth-service` nor `admin-service` re-checks it: both validate
 * `body.reason` with `GrpcRequestValidators.requireNonBlank` and nothing else
 * (measured at backend PR #146's head, 2026-09-05). So this is not a weaker
 * second copy of a rule the services state — below the gateway there is no such
 * rule to copy.
 */
export const ADMIN_WRITE_REASON_TOO_LONG_MESSAGE = `A reason is at most ${ADMIN_WRITE_REASON_MAX_LENGTH} characters`;

/**
 * What every implementation says when the reason is blank — for all three admin
 * user writes **and** for the outbox retry below.
 *
 * The one thing the two families genuinely share. `minLength: 1` is declared
 * identically on all four request DTOs, and unlike the upper bound it is the
 * same number in both, so one sentence is one rule rather than two rules that
 * happen to agree today. The upper bound is where they part
 * (`OUTBOX_RETRY_REASON_MAX_LENGTH` below), and it has a message of its own
 * precisely because that message states a number.
 *
 * The server answers `400` for a blank one, and **not** through `@NotBlank`:
 * the generated request DTO carries `@Size(min = 1)` from the contract's
 * `minLength`, which a single space satisfies. It is stopped one layer deeper,
 * by `GrpcRequestValidators.requireNonBlankOrInvalidArgument`, and arrives as
 * `400 INVALID_ARGUMENT` saying `body.reason must not be blank`. The guard on
 * this side is unchanged by that — a whitespace-only reason is refused before
 * the request either way — but the mechanism is worth stating correctly, since
 * `@Size(min = 1)` alone would have let `" "` through.
 *
 * Mock and rest refuse it identically and before the request, so the caller
 * cannot tell which side stopped it and nothing has to special-case the guard.
 */
export const ADMIN_WRITE_REASON_REQUIRED_MESSAGE = "A reason is required";

/**
 * The longest `reason` the outbox retry accepts — `maxLength: 1000` on
 * `RetryOutboxEventRequestDto` in the contract, which becomes
 * `@Size(max = 1000)` on the gateway's generated request DTO.
 *
 * **Deliberately not `ADMIN_WRITE_REASON_MAX_LENGTH`, and the difference is the
 * contract's, not an oversight.** That constant is named for a *family* — block,
 * unblock and reset-lockout, whose three DTOs each declare the same 1–550 — and
 * `retryOutboxEvent` is not a member of it. It declares 1–1000, in a schema of
 * its own. Two numbers, stated twice by the backend, so two constants: sharing
 * one would have made this field 450 characters shorter than the server allows,
 * and would have taught the next reader that the gateway has a single reason
 * limit. It has two, and a reader who meets both should learn that.
 *
 * Exported for the same reason its neighbour is: the field's own `maxLength`,
 * the remaining-characters hint and **both** implementations' refusals read one
 * number, so the form cannot produce a request the boundary is the first thing
 * to refuse.
 */
export const OUTBOX_RETRY_REASON_MAX_LENGTH = 1000;

/**
 * What every implementation says when a retry reason is longer than that.
 *
 * Its own sentence rather than `ADMIN_WRITE_REASON_TOO_LONG_MESSAGE` for the
 * one reason that decides it: that sentence carries the *number*, and the number
 * is exactly what the two families do not share. "A reason is at most 550
 * characters", printed against a field the server accepts 1000 in, is a string
 * whose whole job is to be exact being wrong.
 *
 * Not the server's own wording, because the server has none to reproduce. The
 * 1000 is stated once on the backend, as `maxLength` in the contract; below the
 * gateway nothing re-checks it — `OutboxRetryServiceImpl` takes `reason` only to
 * `.trim()` it into the audit row (read on backend `develop`, 2026-09-08). So
 * this is not a weaker second copy of a rule the services state.
 */
export const OUTBOX_RETRY_REASON_TOO_LONG_MESSAGE = `A reason is at most ${OUTBOX_RETRY_REASON_MAX_LENGTH} characters`;

/**
 * Which services `POST /admin/outbox/{service}/{eventId}/retry` will take in its
 * path. A **closed** enum — `auth | project | issue` — and closed here because
 * the contract closes it.
 *
 * The two specs disagree and the narrow one wins. The handwritten
 * `docs/contract/openapi.yml` types this parameter as a `string` with an `enum`
 * of those three; the deployed gateway's springdoc-generated spec types it as a
 * bare string, which is springdoc describing a Java `String` parameter rather
 * than the gateway promising to accept anything. Below it, admin-service resolves
 * the name against a fixed map of outbox write datasources and answers
 * `INVALID_ARGUMENT "Unsupported outbox service: …"` for anything else
 * (`OutboxRetryRepositoryImpl.getDatabaseClient`, backend `develop`), so the
 * enum is the truth and the bare string is the description.
 *
 * Listed rather than read from `GET /readonly/catalog` — which is where
 * `outboxServices` (src/screens/admin/events.ts) gets the journal's selector
 * from — because these are two different questions. The catalog answers "which
 * services have an `outbox_events` table to read", and a fourth one appearing
 * there should grow a journal tab by itself. This answers "which services this
 * route will write to", and a fourth one there is a contract change with a
 * frontend edit behind it. Deriving one from the other would put a Retry button
 * on a row the gateway is certain to refuse the first day they differ.
 */
export const RETRYABLE_OUTBOX_SERVICES = ["auth", "project", "issue"] as const;

export type RetryableOutboxService = (typeof RETRYABLE_OUTBOX_SERVICES)[number];

/**
 * Whether this service key is one the retry route will accept.
 *
 * `serviceKey` arrives from the summary as a bare `string` — it is a column of a
 * database table on the far side of the endpoint — so this is the only thing
 * standing between an unfamiliar value and a request the path parameter cannot
 * carry. On today's data the case does not arise: the summary's own `counts`
 * name exactly these three. The guard is for the day a fourth outbox appears
 * before this list does, and the honest answer then is no button rather than a
 * button that 400s.
 */
export function isRetryableOutboxService(service: string): service is RetryableOutboxService {
  return (RETRYABLE_OUTBOX_SERVICES as readonly string[]).includes(service);
}

/**
 * Every parameter `GET /issues/search` takes, all AND-combined by the server.
 *
 * The enums are the domain's own unions, which is ordinary typing and no longer
 * a compensation. Since backend TAS-218 (develop `485fea5`, deployed
 * 2026-10-09) an unrecognised `priority` or `issueType` passes the edge — a
 * probe without a token answers `401` where it answered `400` — and the search
 * answers an empty page; the mock answers the same, because nothing matches a
 * value no issue holds. Before TAS-168 the same value was silently ignored and
 * widened the result (TAS-180), which is what these types once stood against.
 */
export interface SearchIssuesParams {
  /**
   * Absent means "no text filter". Present means it is searched, so anything
   * shorter than `SEARCH_QUERY_MIN_LENGTH` is refused: the rest leg refuses it
   * before it reaches the wire, and the mock as the gateway would.
   */
  query?: string;
  /** Absent searches every project the caller can see. Unknown id → `NOT_FOUND`. */
  projectId?: string;
  statusKey?: IssueStatusKey;
  assigneeId?: string;
  reporterId?: string;
  priority?: IssuePriorityCode;
  issueType?: IssueTypeCode;
  /** Zero-based, like every other paged read here. */
  page?: number;
  /** 1..100 by contract; the gateway's own default is 20. */
  pageSize?: number;
}

/**
 * `issueType` and `priority` are open (TAS-173): the form offers the types the
 * project context sent and the priorities `GET /meta` listed, so a value the
 * backend added after this build is one a reader can pick. The server stays
 * authoritative over both.
 */
export interface CreateIssueInput {
  issueType: IssueTypeCode;
  summary: string;
  description: string;
  priority: IssuePriorityCode;
  /**
   * The five planning fields, all optional — `CreateIssueRequestDto` in
   * docs/contract/openapi.yml (backend develop `21a0d9d177a1`, where TAS-116
   * landed as merged PR #148).
   *
   * `undefined` and `null` mean the same thing here, unlike on the update
   * below: a create has no prior value to leave alone, so both spellings of
   * nothing produce a body with the key omitted. `null` is accepted so a caller
   * holding a form value that is already `number | null` does not have to strip
   * it on the way in.
   *
   * Refused before the request, identically by every implementation, by
   * `planningFieldRefusal` in src/api/planningFields.ts — which is also where
   * the reasons are written down.
   */
  storyPoints?: number | null;
  startDate?: DateOnly | null;
  dueDate?: DateOnly | null;
  originalEstimateMinutes?: number | null;
  remainingEstimateMinutes?: number | null;
}

/**
 * A partial edit of one issue — `PatchIssueRequestDto`, a JSON merge patch
 * (`PATCH /issues/{issueId}`, backend TAS-215, develop `60d62ee`).
 * **`undefined` and `null` are different answers here, and the difference is
 * the whole reason this type has a comment.**
 *
 * - a key left `undefined`, or absent altogether, means **leave it as it is** —
 *   the key is not sent;
 * - a key set to `null` means **clear it** — the key is sent as `null`.
 *
 * `summary` and `priority` cannot be cleared (the gateway refuses a `null` for
 * either), so they have no `null` case. The other seven can.
 *
 * Only these nine keys ever reach the wire: `issuePatchBody` in
 * src/api/issuePatch.ts copies them by name, so a caller spreading a wider
 * object cannot widen the request.
 *
 * The edit used to be `PUT /issues/{issueId}`, a full replace that erased any
 * field the request left out, compensated by a read before every write
 * (docs/ai/API-DIVERGENCE.md, "Closed by TAS-246: `PUT /issues/{issueId}` is a
 * full replace, and the client no longer calls it"). `assignIssue` went with
 * it: assigning and unassigning are this input's `assigneeId`, so there is one
 * write path and one place that handles the version.
 */
export interface UpdateIssueInput {
  summary?: string;
  /** `null` clears it. Read back as `""`, which is how the UI spells an empty description. */
  description?: string | null;
  priority?: IssuePriorityCode;
  /** `null` unassigns. */
  assigneeId?: string | null;
  /** `undefined` keeps the stored value; `null` clears it; a number sets it. `0` is a value. */
  storyPoints?: number | null;
  /** `undefined` keeps the stored value; `null` clears it. Never a `Date` — see `DateOnly`. */
  startDate?: DateOnly | null;
  dueDate?: DateOnly | null;
  originalEstimateMinutes?: number | null;
  remainingEstimateMinutes?: number | null;
}

/**
 * What an issue write answers with: the issue **without** `labels`.
 *
 * `PATCH /issues/{issueId}` answers `IssueResponseDto` on both 200 and 409, and
 * on both its `labels` is `[]` whatever the issue carries — issue-service builds
 * the answer with the label-less `toIssueProto(issue)` (read at backend
 * `60d62ee`). A type that kept the field would invite a caller to merge an
 * empty list over the labels it already holds; leaving it out makes that a type
 * error. Recorded in docs/ai/API-DIVERGENCE.md as "`PATCH /issues/{issueId}`
 * answers `labels: []` on 200 and on 409".
 */
export type IssueWriteAnswer = Omit<Issue, "labels">;

export interface CreateIssueLinkInput {
  targetIssueId: string;
  /**
   * The request half of the contract's asymmetry. Closed in the contract, and
   * open here since TAS-173 because the picker offers what `GET /meta` lists:
   * a relation the backend adds is offered the day it is served.
   */
  linkType: IssueLinkTypeCode;
}

/**
 * Both label writes take the same pair, because `UpdateProjectLabelRequestDto`
 * requires `name` *and* `color` just as the create does — a PATCH that means to
 * change only the colour still has to send the name it is keeping. The two
 * types are kept apart anyway: they are two request bodies in the contract, and
 * an alias would hide it the day one of them grows a field.
 */
export interface CreateProjectLabelInput {
  /** 1-50 characters, unique within the project (the server decides, not this). */
  name: string;
  /** `#RRGGBB`. The contract rejects any other spelling with a 400. */
  color: string;
}

export interface UpdateProjectLabelInput {
  name: string;
  color: string;
}

/**
 * Leg 1's request — `CreateAttachmentUploadUrlRequestDto`. All three fields are
 * required by the contract, and the server validates two of them
 * (`S3StorageClient.validateFileParams`) before it will sign anything.
 *
 * `fileName` is the odd one out: the contract requires it and **the gateway
 * drops it**. `GrpcIssueAttachmentServiceClient.createAttachmentUploadUrl`
 * builds `CreateAttachmentUploadUrlRequestBody` from `contentType`,
 * `sizeBytes`, `actorUserId` and `issueId` and nothing else, so the name dies
 * at the gRPC boundary and `AttachmentServiceImpl.createUploadUrl` is never
 * offered it. The conclusion is the one it always was — the object key is a
 * fresh UUID and the name is only stored at leg 3, from that leg's own copy —
 * so this field is sent because the contract asks for it, not because it
 * decides anything here. Read at backend `f53dca38`.
 */
export interface CreateAttachmentUploadUrlInput {
  fileName: string;
  /**
   * The browser's own `File.type`, passed through untouched. This exact string
   * is what gets signed into the presigned URL, so whatever is sent here must
   * be sent again, byte for byte, on the PUT.
   */
  contentType: string;
  sizeBytes: number;
}

/**
 * Leg 3's request — `ConfirmAttachmentUploadRequestDto`. Note what is *not*
 * here: no size. The server re-measures the object it finds in the bucket
 * rather than believing the client, which is also how an over-size upload is
 * still refused after a PUT the presigned URL did not size-limit.
 */
export interface ConfirmAttachmentUploadInput {
  objectKey: string;
  fileName: string;
  /** The same value sent at leg 1. Stored as the attachment's `contentType`. */
  contentType: string;
}

/**
 * Leg 1's request for an avatar — `CreateAvatarUploadUrlRequestDto` (backend PR
 * #150). Identical in shape to the attachment one above, and separate from it
 * for the reason `src/api/avatars.ts` gives at length: the two are validated by
 * two services reading two configurations that agree today by coincidence.
 *
 * `sizeBytes` is declared `minimum: 1, maximum: 2097152` since backend TAS-222
 * (`be6ea7f`), which is the limit auth-service enforces too. Every
 * implementation refuses a larger one before sending anything, with the
 * gateway's own bean-validation answer (src/api/avatars.ts).
 */
export interface CreateAvatarUploadUrlInput {
  fileName: string;
  /**
   * The browser's own `File.type`, passed through untouched. This exact string
   * is what gets signed into the presigned URL, so whatever is sent here must
   * be sent again, byte for byte, on the PUT.
   */
  contentType: string;
  sizeBytes: number;
}

/**
 * The confirm's request — `ConfirmAvatarUploadRequestDto`. No size, exactly as
 * the attachment confirm has none: the server re-measures the object it finds
 * in the bucket rather than believing the client.
 */
export interface ConfirmAvatarUploadInput {
  objectKey: string;
  fileName: string;
  /** The same value sent at leg 1. Stored as the avatar's `contentType`. */
  contentType: string;
}

/**
 * `AddIssueWorklogRequestDto` (backend PR #178). `spentMinutes` is a whole
 * number of minutes, at least 1, with no upper bound; `workDate` is at most the
 * server's today plus one day (`issue.max-future-days`), with no lower bound.
 * A blank `comment` is stored as `null`; the gateway refuses one over
 * `WORKLOG_COMMENT_MAX_LENGTH`.
 */
export interface AddIssueWorklogInput {
  spentMinutes: number;
  workDate: DateOnly;
  comment?: string | null;
}

/**
 * `UpdateIssueWorklogRequestDto` (backend PR #178): a partial update. An absent
 * field is left as it is; `comment: ""` clears the comment (stored `null`); a
 * body with no field at all is refused `400` ("No data provided for update").
 * There is no version and no `If-Match`: the last write wins.
 *
 * The server declares no `maxLength` on this `comment` and stores `text`, so
 * it would keep a longer one; the panel holds an edit to the same
 * `WORKLOG_COMMENT_MAX_LENGTH` as an add.
 */
export interface UpdateIssueWorklogInput {
  spentMinutes?: number;
  workDate?: DateOnly;
  comment?: string;
}

/** `maxLength` of `AddIssueWorklogRequestDto.comment`, which the panel applies to an edit too. */
export const WORKLOG_COMMENT_MAX_LENGTH = 2000;

/**
 * `CreateWorkflowStatusRequestDto` (backend PR #208). The server trims
 * `statusKey` and `name`; the key's format (`^[A-Z][A-Z0-9_]{1,63}$`) and the
 * 100-character name are workflow-service configuration, refused in its own
 * words. `category` stays open: its values come from the list's own statuses,
 * since the server publishes no dictionary of them (docs/ai/BACKLOG.md).
 */
export interface WorkflowStatusInput {
  statusKey: string;
  name: string;
  category: IssueStatusKey;
  sortOrder: number;
}

/**
 * `CreateWorkflowTransitionRequestDto` (backend PR #208). The two keys are
 * matched as sent — the server does not trim them — and `hidden` is always
 * stated, never left to the contract's default.
 */
export interface WorkflowTransitionInput {
  fromStatusKey: string;
  toStatusKey: string;
  name: string;
  sortOrder: number;
  hidden: boolean;
}

/**
 * `CreateWorkflowRequestDto` (backend PR #208). The server checks no minimum —
 * a workflow with no status or no visible transition is accepted and then makes
 * the project context answer 404, and one with no `TODO` puts new issues of its
 * types outside their workflow on the board (docs/ai/API-DIVERGENCE.md) — so the one caller sends
 * a verbatim copy of the shared default.
 */
export interface CreateProjectWorkflowInput {
  name: string;
  issueTypes: IssueTypeCode[];
  statuses: WorkflowStatusInput[];
  transitions: WorkflowTransitionInput[];
}

/**
 * The edit and delete routes of backend PR #225 (TAS-384) all take the
 * workflow's `version`, and the server compares it: a version that is not the
 * one it holds is refused 409 `ABORTED` ("Workflow version changed"). It is
 * optional on the wire; the dialog always sends the version of the workflow it
 * is showing. Every body is `additionalProperties: false` and refuses an
 * explicit `null`, so a field left `undefined` here is left out of the body —
 * never sent as `null`.
 */
interface WorkflowVersion {
  version?: number;
}

/** `PatchWorkflowRequestDto`: a new name, 1–100 characters. */
export interface UpdateProjectWorkflowInput extends WorkflowVersion {
  name?: string;
}

/**
 * `DeleteProjectWorkflowRequestDto`. `statusMappings` sends the issues of a
 * status the shared default does not have to one it does: source key of this
 * workflow → target key present in **both** workflows.
 */
export interface DeleteProjectWorkflowInput extends WorkflowVersion {
  statusMappings?: Record<string, string>;
}

/** `PatchWorkflowStatusRequestDto`: at least one of the three. The key never changes. */
export interface UpdateWorkflowStatusInput extends WorkflowVersion {
  name?: string;
  category?: IssueStatusKey;
  sortOrder?: number;
}

/** `DELETE …/statuses/{statusId}`'s two query parameters, both optional. */
export interface DeleteWorkflowStatusParams extends WorkflowVersion {
  /** Another status of this workflow that the deleted status's issues move to first. */
  targetStatusKey?: string;
}

/** `PatchWorkflowTransitionRequestDto`: at least one of the three. From and To never change. */
export interface UpdateWorkflowTransitionInput extends WorkflowVersion {
  name?: string;
  sortOrder?: number;
  hidden?: boolean;
}

/** `DELETE …/transitions/{transitionId}`'s one query parameter. */
export type DeleteWorkflowTransitionParams = WorkflowVersion;

export interface ListCommentsParams {
  page?: number;
  pageSize?: number;
}

/**
 * `POST /users/me/access-tokens` (TAS-412, for backend TAS-402): a name, the
 * grants and a lifetime from `ACCESS_TOKEN_EXPIRY_DAYS`. The frontend's
 * proposal, not the contract — see `RestTaskaApi`.
 */
export interface CreateAccessTokenInput {
  /** Trimmed, 1 to `ACCESS_TOKEN_NAME_MAX_LENGTH` characters. */
  name: string;
  scopes: AccessTokenScopes;
  expiresInDays: AccessTokenExpiryDays;
}

export interface ListNotificationsParams {
  unreadOnly?: boolean;
  pageSize?: number;
  offset?: number;
}

export interface TaskaApi {
  login(input: LoginInput): Promise<AuthTokens>;
  /**
   * `POST /auth/invitations/accept` — sets the invited account's password and
   * makes it `ACTIVE`. **204 with no tokens**: the contract says the client then
   * signs in with `POST /auth/login` like anybody else (backend #204), so this
   * opens no session in any implementation, and nothing reads `/users/me` after
   * it — there is nobody signed in to read.
   *
   * What the server checks, in order. auth-service's gRPC transport first: a
   * blank token, 400 "body.token must not be blank", then a blank password,
   * 400 "body.newPassword must not be blank" (`AuthGrpcService`,
   * `GrpcRequestValidators`). Then `AuthServiceImpl.setPasswordByToken`
   * (develop `e8a8d316b326`): the password
   * policy, 400 in the validator's own sentences (minimum 8 code points and at
   * most 128, at most 72 UTF-8 bytes, an upper-case letter, a digit and a
   * symbol — the defaults, each configurable on the stand); a token over 256
   * characters, 400 "Invite token is too long"; then one **401
   * `UNAUTHENTICATED` "Invalid or expired token"** for a token nobody holds,
   * one already used or revoked by a newer invitation, one past its deadline,
   * and an account that is no longer `INVITED`. A weak password does not spend
   * the link; a success does.
   */
  acceptInvitation(input: AcceptInvitationInput): Promise<void>;
  refresh(refreshToken: string): Promise<AuthTokens>;
  logout(): Promise<void>;
  /**
   * The signed-in account as the server describes it. `globalRole` may be
   * absent — an older gateway, or the contract's UNSPECIFIED — and callers must
   * treat that as "not stated" rather than as a role. It is descriptive only:
   * the server, not this field, decides what the account may do.
   *
   * Carries the reader's own avatar since backend PR #193 (TAS-223):
   * `avatarUrl` and `avatarId` from the response's nullable `avatar`, `null`
   * when there is none *or* when the gateway's profile read failed. The answer
   * is 200 either way, and the server tells the two apart in a field of its
   * own, mapped to `avatarUnavailable`: `true` for a failed read, `false` for
   * a read with or without a photo, absent on a gateway older than that PR.
   * A failed read is still a 200: its request id is in the `X-Request-Id`
   * response header, which the REST implementation reads only on a failed
   * request, so no id reaches the caller and the UI has none to show.
   * This replaced `GET /users/{userId}/avatar`, which was the one avatar read
   * that cost a request of its own; nothing calls that route any more.
   */
  getCurrentUser(): Promise<User>;

  /** TAS-387: authenticated current-user routes; never accept a target user id. */
  getNotificationPreferences(): Promise<NotificationPreferences>;
  updateNotificationPreferences(input: NotificationPreferencesPatch): Promise<NotificationPreferences>;
  createTelegramLink(): Promise<TelegramLink>;
  confirmTelegramLink(linkId: string): Promise<NotificationPreferences>;
  disconnectTelegram(): Promise<NotificationPreferences>;

  /**
   * The reader's own personal access tokens (TAS-412; routes from backend
   * TAS-402, **not deployed and not in the contract** — the shapes are the
   * frontend's proposal, noted once in `RestTaskaApi`). Managing tokens is a
   * signed-in session's business only: a request made with a token gets 403
   * `insufficient_scope`. On a gateway without the routes every one of them
   * answers the static-resource 404 (`isUndeployedRoute`).
   *
   * `listAccessTokens` never carries a secret. `createAccessToken` answers with
   * the token's value once; the caller shows it and lets it go — no cache, no
   * storage, no log. `revokeAccessToken` takes the token out at once, and
   * revoking it again succeeds as the first time did (TAS-401).
   */
  listAccessTokens(): Promise<AccessToken[]>;
  createAccessToken(input: CreateAccessTokenInput): Promise<IssuedAccessToken>;
  revokeAccessToken(tokenId: string): Promise<void>;

  /**
   * Synchronous by design: the route guard reads it during render, so it cannot
   * wait on a promise. It answers "does this client hold credentials", not "is
   * the server still willing to accept them" — the server stays authoritative.
   */
  hasSession(): boolean;
  /**
   * Fires when the server rejected the session and it could not be refreshed.
   * Returns an unsubscribe.
   */
  onSessionExpired(listener: () => void): () => void;

  /**
   * `GET /meta` — the enum dictionaries (backend TAS-217), read once per
   * session through `useMeta`. A dictionary the answer did not carry as a list
   * is `null`; a row without a usable `code` is dropped; nothing is checked
   * against this build's unions — the point of the route is the values this
   * build does not know yet.
   */
  getMeta(): Promise<EnumDictionaries>;

  listProjects(): Promise<Project[]>;
  createProject(input: CreateProjectInput): Promise<Project>;
  /**
   * `GET /projects/{projectId}` — the project alone, membership-checked (a
   * non-member is a 403, a missing project a 404).
   *
   * Since TAS-251 the board's frame comes from `getProjectContext`, and no
   * screen calls this. It no longer second-guesses a context 404/403 either:
   * that was a compensation for the context's avatar failure and came out
   * under AGENTS.md's "No compensations for the backend". Kept for
   * reversibility (docs/ai/BACKLOG.md).
   */
  getProject(projectId: string): Promise<Project>;
  /**
   * `PATCH /api/v1/projects/{projectId}` — name, description and colour, and
   * nothing else. Answers with the whole project as the server now holds it.
   *
   * Backend PR #155 (TAS-145), merged and deployed: without a token the route
   * answers 401 on 2026-10-23, where it answered 405 before.
   *
   * What the Java does that the yml does not say, read out of
   * `ProjectController` and `ProjectServiceImpl` as merged, each of which
   * decides something in the UI:
   *
   * - **The body is checked first.** The gateway parses it by hand: an unknown
   *   or immutable key, a value that is not a string, a missing body, a `null`
   *   or blank `name` — all 400, before the project is looked up.
   * - **Then ADMIN only, refused with 403.** A missing project is `NOT_FOUND`,
   *   a 404; a non-member and a member below ADMIN both take
   *   `PERMISSION_DENIED`. So a 403 from this route is "not your project to
   *   edit" and must never be read as a dead session, and the control is not
   *   offered below ADMIN — while the server stays the authority either way.
   * - **Then the archive.** An archived project answers 400 `FAILED_PRECONDITION`
   *   with `details.reason: "PROJECT_ARCHIVED"` (`isProjectArchived`), after
   *   the role. The UI never offers this on an archived project.
   * - **An all-absent body is a 200, not a 400**, and equal values save
   *   nothing. A caller that sends no changes gets a successful no-op, so the
   *   UI does not need to defend against one; it declines to spend the request
   *   instead.
   * - **A concurrent edit is `ABORTED` → 409**, "Project was concurrently
   *   modified by another request, please retry". `isConflict` in
   *   `src/api/errors.ts` already matches both arms of that.
   * - **An explicit `null` clears `description` and `color`**, an absent key
   *   keeps them, and a blank description is stored as `null`. See
   *   `UpdateProjectInput`.
   * - **The answer carries `currentUserRole: "ADMIN"`** and `archivedAt: null`.
   *   A caller still keeps the role it already holds rather than taking one
   *   from a write answer.
   */
  updateProject(projectId: string, input: UpdateProjectInput): Promise<Project>;
  /**
   * `DELETE /api/v1/projects/{projectId}` — archives the project: a soft
   * delete that sets `archivedAt`, with no body on the request. Answers 200
   * with the project as stored, `archivedAt` set and `currentUserRole:
   * "ADMIN"`.
   *
   * Backend PR #159 (TAS-146), merged and deployed: without a token the route
   * answers 401 on 2026-10-23, where it answered 405 before.
   *
   * What the merged Java does, which every implementation reproduces:
   *
   * - **Idempotent.** A second call answers 200 with the original
   *   `archivedAt` and writes nothing — no second event, no second
   *   notification.
   * - **ADMIN only.** A missing project is 404 "Project not found"; a
   *   non-member and a member below ADMIN are both 403 `PERMISSION_DENIED`
   *   "Project ADMIN role is required". This route never answers
   *   `PROJECT_ARCHIVED`.
   * - **Afterwards the project leaves `GET /projects`** (and `/project-stats`)
   *   for every caller, and nothing lists it or restores it. It stays
   *   **readable** — `GET /projects/{id}`, the context, issues, the board,
   *   by-key, comments, watchers, work log, attachments — and **every write
   *   refuses** with 400 `FAILED_PRECONDITION`, "Project is archived",
   *   `details.reason: "PROJECT_ARCHIVED"` (`isProjectArchived`), checked after
   *   membership, so an outsider is told 403/404 as before.
   * - **Its members are told**: `PROJECT_ARCHIVED`, title "Project archived",
   *   body "Project {name} was archived", with `projectId` and no issue — every
   *   member at that moment but the one who archived it.
   */
  archiveProject(projectId: string): Promise<Project>;
  /**
   * `GET /projects/{projectId}/context` — the project, the reader's role in it,
   * its members, its labels and the workflow of every issue type it allows, in
   * one read (backend PR #169, TAS-212, in `docs/contract/openapi.yml`). The
   * board's only frame read since TAS-251; see `ProjectContext` for the shape.
   *
   * **Merged at develop `fa90b51` and deployed on stage 2026-10-12** (probed
   * without a token; the shape is not yet measured with one).
   *
   * What the Java does that the yml does not say, and every implementation
   * reproduces:
   *
   * - **All or nothing.** Any part failing fails the whole response; there is no
   *   degraded context.
   * - **A non-member is refused with 403, a `GLOBAL_ADMIN` included; a
   *   missing project is 404.**
   *   At head `a1bfe19` the code intends 200 with empty members and labels (its
   *   TODO says so), but the labels leg's denial arrives from issue-service as
   *   a gRPC `StatusRuntimeException`, which
   *   `ProjectServiceImpl.isPermissionDenied` (it matches only
   *   `DomainException`) does not catch, so the whole context fails
   *   `PERMISSION_DENIED` and answers 403. Removal: when the labels call
   *   carries the global role, or `isPermissionDenied` also matches a gRPC
   *   denial, the context answers 200 with empty parts and the mock must
   *   follow.
   * - **A 404 or 403 is not only about the project.** The members are enriched
   *   exactly as `listMembers` enriches them (`ProjectMemberServiceImpl` at
   *   #169): every avatar is HEADed and presigned per person with no per-row
   *   fallback, so one missing avatar object answers 404 and a storage refusal
   *   403 — the statuses of a missing project and of no access. There is no
   *   compensation: the board takes a 404/403 as the server states it and
   *   shows §4.18's screen, so a project with one unreadable avatar shows as
   *   not found. The backend ask — an unreadable avatar as `avatar: null`
   *   rather than a failed read — is a comment on TAS-212
   *   (docs/ai/API-DIVERGENCE.md).
   * - **Only the allowed issue types.** `workflows` may hold fewer than three
   *   entries, or none, in no fixed order; an entry with an issue type this
   *   build does not know arrives as `issueType: null` and is dropped.
   * - Statuses and transitions are ordered by `sortOrder` and carry no
   *   timestamps; labels carry only `id`, `name` and `color`, unordered;
   *   members come by `userId`, and a name auth-service could not supply
   *   arrives as `""`.
   */
  getProjectContext(projectId: string): Promise<ProjectContext>;
  /**
   * The reader's own standing in one project: the role they hold, whether they
   * are a member at all, and whether the project exists.
   *
   * **There is no membership route, and none is coming**: backend TAS-137 put
   * the role on the project read instead. `GET /projects/{projectId}/membership`
   * answers the static-resource 404 (probed without a token on 2026-09-12 and
   * again on 2026-09-16, after TAS-137 deployed, each time against a control
   * that answered 401), so the `rest` leg derives all three from
   * `GET /projects/{projectId}`: that read is membership-checked — someone
   * else's project is a 403, not a 200 (TAS-154) — so a 200 settles `isMember`
   * and `projectExists`, and the role is the response's `currentUserRole`.
   *
   * Every 200 from that read states a role name: it refuses a non-member with
   * 403, and a member's role is never null (see `Project.currentUserRole`).
   * When the field is `null`, absent — as it was on every response before
   * TAS-137 deployed — or a value this build does not know, the answer is
   * `role: null`, and nothing is put in its place. Until TAS-226 that was
   * floored to `VIEWER`, which claimed a permission the server never stated and
   * left the board read-only without a word about why. The board now treats
   * `null` as it treats a failed read: nothing writable, and a banner saying so.
   * It resolves rather than rejects, because the read did not fail — a
   * rejection would bring the retry and the error classification of
   * `src/api/errors.ts` to a request that answered. Role gating hides UI; the
   * server stays authoritative either way.
   *
   * A failed project read rejects this call, in every implementation that
   * reads one. On the deployed stand that has been so since TAS-224 — until
   * then the `hybrid` mode (removed in TAS-209) answered without asking — so
   * the board's "your role could not be loaded" state (TAS-163) is reachable
   * there.
   */
  getMembership(projectId: string): Promise<ProjectMembership>;
  /**
   * Everyone on the project, each row carrying the display name and email the
   * server holds for them — `GET /projects/{projectId}/members`, unwrapped from
   * `members`.
   *
   * Backend TAS-137 (PR #152), merged into `develop` `1cfe4d79f074` and in
   * `docs/contract/openapi.yml`. Deployed: probed without a token on 2026-09-16
   * the route answers 401, where it answered 405 on 2026-09-12. The `rest` leg
   * was written against the PR before it merged, and it is the read the stand
   * makes.
   *
   * **An unreadable avatar object costs that member's avatar, not the read.**
   * auth-service presigns each avatar owner's object and, since TAS-225, falls
   * back per row (`enrichWithAvatarUrl` ends in `onErrorResume(…
   * withoutAvatar(user))`, read at backend develop `398285cde074`), so the row
   * arrives with `avatar: null` and the rest of the answer stands. Before that
   * commit one missing object failed the whole read with a 404. A read that
   * fails for its own reasons is still said almost nowhere: the board does not
   * retry a 404 or a 403, only the watcher section of an open issue says the
   * members could not be read, and only to an ADMIN. Everywhere else it is
   * silent — the assignee filter and the assignee chips offer nobody, and the
   * reporter reads "Unknown".
   *
   * `addedAt` and `addedBy` are not on the wire: `ProjectMemberDetailsDto` is
   * `userId`, `role`, `displayName`, `email` and an avatar, and nothing else. A
   * row's `role` may be `null`; see `ProjectMember` for why that is a real
   * answer rather than a defensive one.
   */
  listMembers(projectId: string): Promise<ProjectMember[]>;

  /**
   * The three member writes (TAS-158): add somebody by user id, change a
   * member's role, remove a member. In `docs/contract/openapi.yml` as
   * `addProjectMember`, `changeProjectMemberRole` and `removeProjectMember`.
   *
   * Deployed: probed without a token on 2026-09-16 at 21:37 UTC, `POST …/members`,
   * `PATCH …/members/{userId}` and `DELETE …/members/{userId}` each answer 401
   * and a `PUT` answers 405, where `GET /users/me` answered 401 and an unmapped
   * path the static-resource 404 as the controls. So on that stand a 404 from any
   * of the three is the resource's own answer rather than a missing route.
   *
   * **ADMIN of that project, and nobody else** — a `GLOBAL_ADMIN` included, who
   * gets no exemption. Hiding the controls below ADMIN is presentation; the
   * server decides, and a 403 arriving here is shown rather than swallowed.
   *
   * What the yml does not say, read out of `ProjectMemberValidatorImpl`,
   * `GrpcProjectService` and the gateway's `GatewayValidationExceptionHandler`
   * and `RestErrorMapper` at backend `develop` `1cfe4d79f074` — read, not
   * measured on the stand:
   *
   * - **The order of the refusals is the server's, and it is not the same for
   *   add as for the other two.** Shape comes first on all three. A missing or
   *   unrecognised `role` is `400 INVALID_ARGUMENT` "Invalid request parameters"
   *   from the gateway's own request validation
   *   (`GatewayValidationExceptionHandler`): the generated `RoleEnum.fromValue`
   *   refuses an unknown value while the body is decoded, and `@NotNull`
   *   refuses a missing one, so `ProjectMapper.toGrpcProjectRole`'s own 400 is
   *   not reached from these routes. It comes after the token check and before
   *   project-service is asked; an id `UUID.fromString` rejects is
   *   `400 INVALID_ARGUMENT` from
   *   project-service's transport ("body.addedMemberId must be a valid UUID",
   *   `changedMemberId` and `deletedMemberId` on the other two), before any row
   *   is read. Then one locked read of the project's member rows
   *   (`getRequiredMembersInProject`, every ADMIN plus the actor and the target,
   *   `FOR UPDATE`) decides the rest. No rows at all — a
   *   project that does not exist — is `404 NOT_FOUND`. For **add**: an actor
   *   who is not ADMIN is `403 PERMISSION_DENIED`, then a target already on
   *   the project is `409 ALREADY_EXISTS`. For **change** and **remove**
   *   (backend PR #185, TAS-229): an actor who is not ADMIN is
   *   `403 PERMISSION_DENIED` — checked *before* the target, so a non-admin
   *   touching a non-member gets 403, not 404 — then a target who is not a
   *   member is `404 NOT_FOUND`, then the last-admin rule below.
   * - **The last ADMIN cannot be demoted or removed**: when the target is an
   *   ADMIN and the project has one ADMIN or fewer, both writes are
   *   `FAILED_PRECONDITION` — **400**, not 409 — saying "Can't modify last
   *   admin: …". That includes a `PATCH` to `ADMIN` itself. `isConflict`
   *   (src/api/errors.ts) reads it through the `code`, which is the only half
   *   that carries it.
   * - **An ADMIN may change or remove their own row** whenever another ADMIN
   *   exists, and loses the access with it. The caller refetches the reader's
   *   role afterwards rather than assuming the old one survived.
   * - **Add does not check that the user exists** (TAS-227). Any well-formed id
   *   is a 201, and `GET …/members` then returns that row with no name and no
   *   email — auth-service drops an id it has no user for from its lookup, and
   *   does not filter by status, so an INVITED or BLOCKED user comes back named.
   *   A member row without a name therefore means no account came back for its
   *   id. `MockTaskaApi` accepts an unknown id the same way; a mock that refused
   *   one would be a false statement about this route.
   *
   * An id that is not in the canonical 8-4-4-4-12 form is refused before the
   * request by every implementation (`isUserId`, src/api/members.ts), which is
   * stricter than the server's own parse and says why there.
   *
   * Both answers are `ProjectMemberWriteResult` — `projectId`, `userId` and
   * `role`, and nothing about the person. The member list is what names them.
   */
  addProjectMember(projectId: string, userId: string, role: ProjectRole): Promise<ProjectMemberWriteResult>;
  /**
   * `PATCH /projects/{projectId}/members/{userId}` with `{ role }`, 200. The
   * refusals and their order are listed on `addProjectMember` above.
   */
  changeProjectMemberRole(projectId: string, userId: string, role: ProjectRole): Promise<ProjectMemberWriteResult>;
  /**
   * `DELETE /projects/{projectId}/members/{userId}`, 204 with no body. The
   * refusals and their order are listed on `addProjectMember` above.
   *
   * Nothing else goes with the row. project-service deletes the membership and
   * writes a `MemberRemoved` outbox event, and the only consumer of that event
   * at `1cfe4d79f074` is notification-service, which tells the person — so an
   * issue assigned to them stays assigned to them, and the board then draws
   * that assignee as somebody the member list cannot name.
   */
  removeProjectMember(projectId: string, userId: string): Promise<void>;

  /**
   * `GET /users` — the people directory, for anybody signed in (backend #204,
   * TAS-204, merged and deployed at develop `e8a8d316b326`). What the members
   * dialog looks people up by, in place of the user id it used to take.
   *
   * Case-insensitive substring over display name **or** email, `%`, `_` and
   * `!` matched literally; `ACTIVE`, `INVITED` and `LOCKED` accounts, never a
   * `BLOCKED` one; ordered by `lower(displayName)`, then `lower(email)`, then
   * `id`. `hasMore` comes from reading one row past the page.
   *
   * The query is refused before the request when it is shorter than
   * `DIRECTORY_QUERY_MIN_CODE_POINTS` once trimmed — see that constant for the
   * two different refusals the server has for it. Out of range, the gateway
   * answers 400 "Invalid request parameters" before authentication.
   */
  searchUsers(params: SearchUsersParams): Promise<DirectoryPage>;

  /**
   * `POST /auth/invitations` — creates an `INVITED` account and queues an email
   * carrying a link to set a password (backend #204). `GLOBAL_ADMIN` only: the
   * gateway refuses anybody else with 403 "User doesn't have permission", and
   * hiding the button is presentation. It adds nobody to any project.
   *
   * What the server does, in order (`AdminInviteUserServiceImpl`, develop
   * `e8a8d316b326`): the email trimmed and lower-cased, and refused 400 "A
   * valid email address is required (maximum 320 characters)"; the name
   * refused 400 "Display name must contain at most 128 characters and no
   * control characters"; then, by the account that email already has —
   *
   * - none: the account is created, **201**, `created: true`, queued;
   * - `INVITED` with a link that still works and no `resend`: **200**,
   *   `deliveryQueued: false`, nothing sent, the current deadline;
   * - `INVITED` otherwise (`resend`, or the link expired): a new link revokes
   *   the old one, **200**, queued — unless the last one was made less than a
   *   minute ago, **429** "Invitation was sent recently; try again later" with
   *   `details.retryAfterSeconds` as a *string*. The `Retry-After` header is
   *   set too, and no browser can read it: CORS exposes only `X-Request-Id`
   *   and `ETag`;
   * - `ACTIVE`, `LOCKED` or `BLOCKED`: **409** `ALREADY_EXISTS` "An account
   *   with this email already exists", and nothing changes.
   *
   * `created` is the HTTP status, which the rest leg reads; nothing in the body
   * says it. Nothing here is optimistic — the outcome is the server's to name.
   */
  inviteUser(input: InviteUserInput): Promise<InvitationResult>;

  listIssues(projectId: string, params?: ListIssuesParams): Promise<Page<Issue>>;
  /**
   * `GET /projects/{projectId}/board` — the board screen's one issue read since
   * TAS-202 (backend #205, TAS-213): the columns, the issues placed in them and
   * the issues outside their own type's workflow (`Board`).
   *
   * **Complete and unbounded.** The route has no paging and no cap, so the
   * answer holds every issue of the three types the gateway reads — which is
   * what lets the board filter locally and count `Y` from it (backend A3 is the
   * day that changes).
   *
   * Order inside a column, as read from the merged Java and not stated by the
   * contract: grouped by type — TASK, BUG, STORY — and by `createdAt` ascending
   * inside each, with no tiebreak (backend A1). `compareBoardIssues`
   * (src/api/boardOrder.ts) is that order, with `id` as the tiebreak the server
   * lacks; the mock sorts with it and the board's optimistic move places a card
   * with it.
   *
   * Enrichment fails silently on the server (backend A2): a label read that
   * fails sends every card's `labels` as `[]`, and a profile read that fails
   * sends every `assignee.displayName` as `null`, with a 200 either way.
   *
   * Access: a missing project is 404 "Project not found", then a reader who is
   * not a member is 403 "Access denied"; an archived project is read like any
   * other.
   */
  getBoard(projectId: string, params?: BoardParams): Promise<Board>;
  /**
   * `GET /project-stats` (backend TAS-211): one entry per project the reader
   * lists — the projects of `GET /projects`, archived ones left out — with its
   * issue count, member count and first five members (`ProjectStats`).
   *
   * What the contract does not say, read from the merged Java: the order
   * follows `GET /projects`; a project whose membership vanished between the
   * two internal calls is dropped rather than zeroed, so a listed project can
   * be missing; and the read is all or nothing — any failure is the whole
   * answer's, with the gateway's `{code, message, requestId}`. An empty list is
   * `{items: []}`.
   */
  getProjectStats(): Promise<ProjectStats[]>;
  /**
   * `GET /issues/search` — substring, case-insensitive, over `issueKey` OR
   * `summary` OR `description`, with every other parameter ANDed onto it.
   *
   * Answers with `IssueSearchHit`, which is not an `Issue` and must not be
   * widened into one: see the type. `totalCount` is the size of the whole
   * matching set rather than of the page, which makes it the first honest issue
   * total this frontend has been able to print.
   *
   * A `query` shorter than `SEARCH_QUERY_MIN_LENGTH` — the empty string
   * included — rejects with `INVALID_ARGUMENT` in every implementation. The
   * rest leg refuses it without a request, in the client's own words
   * (`SEARCH_QUERY_TOO_SHORT_MESSAGE`); the mock answers what the gateway
   * answers when such a query does reach it, "Invalid request parameters". That
   * is not politeness: the gateway refuses exactly these, so a mock that quietly
   * accepted them would hide the failure from the e2e suite.
   *
   * Newest first: `createdAt` descending, then `id` descending, as the route
   * declares since backend PR #200. The mock sorts the same way.
   */
  searchIssues(params: SearchIssuesParams): Promise<Page<IssueSearchHit>>;
  /**
   * The issue panel's one read — `GET /issues/{issueId}` answering
   * `IssueDetailsWithHistoryResponseDto` (backend TAS-214, develop `60d62ee`):
   * the issue with its people named, its labels, watchers, links and
   * attachments, a comment count, and the history. Comments are not in it and
   * stay `listComments`. See `IssueDetails` for what a missing part means.
   *
   * **`issueId` is a UUID and only ever a UUID.** The route does not resolve a
   * key; `getIssueByKey` does, and a caller holding only a key asks there first.
   *
   * The route is issue-scoped on the wire, so `projectId` never reaches the
   * gateway — but it is not decoration. The mock resolves an issue *within* a
   * project (`MockTaskaStore.findIssue` matches `projectId && id && deletedAt
   * === null`), so on a mismatched pair the two disagree outright: the mock
   * answers NOT_FOUND, the gateway answers 200 with the issue. Callers pass a
   * pair they read together — a board and its card, a notification's own
   * `projectId` and `issueId`, a by-key answer — never a project guessed from
   * the screen around them.
   *
   * The gateway's read is access-checked (`IssueAccessGuard`, issue-service):
   * a missing issue is `404 NOT_FOUND`, a reader who is not a member of its
   * project `403 PERMISSION_DENIED`.
   */
  getIssue(projectId: string, issueId: string): Promise<IssueDetailsWithHistory>;
  /**
   * `GET /issues/by-key/{issueKey}` — which issue a key names, and so which
   * project it lives in (backend TAS-214, develop `60d62ee`). Answers
   * `IssueResponseDto`; the caller then opens the issue by id with `getIssue`.
   *
   * Read at that commit, and none of it stated in the contract, which lists
   * only a `default` error: the key is matched **case-insensitively**
   * (`IssueRepository.findActiveByKeyIgnoreCase`, `UPPER(issue_key) =
   * UPPER(:issueKey)`), soft-deleted issues are not found, a key nobody has is
   * `404 NOT_FOUND` "Issue not found: {key}", and a reader who is not a member
   * of the issue's project is `403 PERMISSION_DENIED` "Access denied"
   * (`IssueAccessGuard.verifyReadAccess` → `ProjectRoleChecker`).
   *
   * `labels` on this answer are not to be relied on — the route is a lookup,
   * and nothing here reads them.
   */
  getIssueByKey(issueKey: string): Promise<Issue>;
  createIssue(projectId: string, input: CreateIssueInput): Promise<Issue>;
  /**
   * `PATCH /issues/{issueId}` with `If-Match: "<expectedVersion>"` — a merge
   * patch under optimistic locking (backend TAS-215, develop `60d62ee`). One
   * request: nothing is read first, because nothing has to be re-sent.
   *
   * `expectedVersion` is the `version` of the issue the caller is editing, as it
   * last read it. Sent in the quoted ETag form; the gateway also accepts a bare
   * number (`IssueMapper.parseIfMatchVersion`).
   *
   * What the server checks, in order (issue-service `IssuePatchServiceImpl`,
   * read at `60d62ee`; none of it stated in the contract beyond the 409):
   * 1. the issue exists — `404 NOT_FOUND`;
   * 2. the caller holds `update-issue-roles` — `403 PERMISSION_DENIED`;
   * 3. the version — **`409` with the current issue as the body**, thrown here
   *    as `IssueVersionConflictError` (src/api/errors.ts). Nothing is written,
   *    and no later check runs, so a stale write is a conflict even when it
   *    would also have been refused;
   * 4. the merged start/due pair — the request's dates laid over the stored
   *    ones — `400 INVALID_ARGUMENT` "Start date: X must not be after Due date:
   *    Y" (`datesOutOfOrderServerMessage` in src/api/issuePatch.ts);
   * 5. only when the assignee actually changes: `assign-issue-roles` for the
   *    caller, and for the new assignee unless it is `null` or the caller;
   * 6. under `FOR UPDATE`, the version again — the same 409.
   *
   * A write that changes nothing answers 200 with **no** version bump and no
   * history. A change of assignee to somebody also subscribes them as a watcher
   * (`IssueAutoWatchService.watchAssigneeOnAssign`), with no history row of its
   * own.
   *
   * Refused before any request, identically by every implementation: a version
   * the gateway cannot use, a blank summary, and the input-only planning-field
   * refusals (src/api/issuePatch.ts, src/api/planningFields.ts).
   *
   * Never retried here. A conflict is the caller's to resolve: it holds the
   * reader's edit, and only it can decide whether to send it again.
   */
  updateIssue(
    projectId: string,
    issueId: string,
    input: UpdateIssueInput,
    expectedVersion: number,
  ): Promise<IssueWriteAnswer>;
  transitionIssue(projectId: string, issueId: string, transitionId: string): Promise<Issue>;
  deleteIssue(projectId: string, issueId: string): Promise<void>;

  /**
   * The three link routes are issue-scoped on the wire
   * (`/issues/{issueId}/links`) and need no `projectId`, but it stays first in
   * the signature like `getIssue`/`updateIssue`: the mock resolves an issue
   * within a project, and a caller that has one issue id but not its project is
   * not a case this app has.
   */
  listIssueLinks(projectId: string, issueId: string): Promise<IssueLink[]>;
  createIssueLink(projectId: string, issueId: string, input: CreateIssueLinkInput): Promise<IssueLink>;
  deleteIssueLink(projectId: string, issueId: string, linkId: string): Promise<void>;

  /**
   * The project's own labels (`GET /projects/{projectId}/labels`). Everyone who
   * can read the project can read these — the writes below are the gated half.
   * Soft-deleted labels are not in the answer, so nothing here filters them.
   */
  listProjectLabels(projectId: string): Promise<ProjectLabel[]>;
  createProjectLabel(projectId: string, input: CreateProjectLabelInput): Promise<ProjectLabel>;
  updateProjectLabel(projectId: string, labelId: string, input: UpdateProjectLabelInput): Promise<ProjectLabel>;
  /** Soft delete by the contract's own summary: the row stays, the label stops being served. */
  deleteProjectLabel(projectId: string, labelId: string): Promise<void>;

  /**
   * The labels on one issue. Nothing in the UI calls it since TAS-246: the
   * panel's detail read carries the same set (`IssueDetails.labels`) and a
   * write is settled by re-reading that. Kept because it is a route of the
   * contract, and the two implementations stay interchangeable on it.
   */
  listIssueLabels(projectId: string, issueId: string): Promise<Label[]>;
  /**
   * Returns nothing on purpose. `AddIssueLabelResponseDto` answers with the join
   * row — issue id, label id, who and when — and the caller picked the label out
   * of a list it already holds, so there is no fact in that response it does not
   * have. Passing it up would invite a component to treat a join record as a
   * label, which is the one thing it is not.
   */
  addIssueLabel(projectId: string, issueId: string, labelId: string): Promise<void>;
  removeIssueLabel(projectId: string, issueId: string, labelId: string): Promise<void>;

  /**
   * The five watcher routes (`TAS-193`), backend PR #144. Two families, and the
   * split is a permission rather than a shape:
   *
   * - `listIssueWatchers` and the `…/watchers/me` pair are about **whoever is
   *   reading**. The contract states no role for any of the three, and the
   *   server has one for the pair anyway: issue-service's `watch-issue-roles`
   *   is `ADMIN,MEMBER`, checked against the reader's own role when they watch
   *   or unwatch themselves (`IssueWatcherServiceImpl.checkMutationRole`, read
   *   at `develop` `1cfe4d7`). So a `VIEWER` can neither subscribe nor
   *   unsubscribe themselves, and the panel's toggle is live only for the two
   *   roles that rule lets through (TAS-226). Until TAS-226 this comment said
   *   the opposite, reading the contract's silence as permission.
   * - `addIssueWatcher` and `removeIssueWatcher` name a subscriber, and the
   *   rule depends on whose subscription it is
   *   (`IssueWatcherServiceImpl.checkMutationRole`; backend PR #194, TAS-228,
   *   head `a33ed5d`, states it in the contract). For **somebody else's**
   *   `userId` the actor needs `manage-watchers-roles` — ADMIN. For **their
   *   own** it is
   *   `watch-issue-roles` — ADMIN or MEMBER, as for the `me` pair — so a
   *   MEMBER may use either route on themselves and a VIEWER may use neither.
   *   Only the actor's role is checked, never the subscriber's, so an ADMIN
   *   may subscribe a VIEWER. `MockTaskaStore.requireWatcherRoleFor` applies
   *   the same rule. The panel renders both controls only for an ADMIN — a
   *   MEMBER manages their own subscription through the `me` toggle — and
   *   hiding them is presentation; the server decides.
   *
   * The `me` pair takes the user from the JWT and sends no body, which is why
   * neither signature has a `userId`. Passing one would be a lie about the
   * request.
   *
   * Measured against the deployed gateway on 2026-09-08 with a `GLOBAL_ADMIN`
   * token: `GET …/watchers` answers `200` with `{"totalCount":1,"watchers":[…]}`.
   * **The array key is `watchers`, not `items`** — every other list DTO in this
   * contract says `items`, so the mapper is the one place that knows, and it is
   * measured rather than inferred. The other four were probed on 2026-09-09
   * for *existence* only — an invalid uuid and no credentials draws `400
   * INVALID_ARGUMENT` from three of them and `415 UNSUPPORTED_MEDIA_TYPE` from
   * `POST …/watchers`, against the static-resource `404` an unmapped path gets
   * — so their answers are still read out of the contract and the mapping below
   * follows it for those.
   */
  listIssueWatchers(projectId: string, issueId: string): Promise<IssueWatchers>;
  /**
   * `PUT …/watchers/me`. Idempotent by the shape of its answer: there is no
   * "was it new" flag to read, so a second call on an issue already watched is
   * indistinguishable from the first. That asymmetry with `unwatchIssue` below
   * is the contract's, not a field dropped here.
   */
  watchIssue(projectId: string, issueId: string): Promise<WatchIssueResult>;
  /**
   * `DELETE …/watchers/me`, and the one call in this family whose answer says
   * more than its status code. See `UnwatchIssueResult.removed`: a `200` with
   * `removed: false` is the server reporting that there was nothing to delete,
   * and the caller is expected not to announce a change.
   */
  unwatchIssue(projectId: string, issueId: string): Promise<UnwatchIssueResult>;
  /** `POST …/watchers`, project `ADMIN` only. Subscribes somebody else. */
  addIssueWatcher(projectId: string, issueId: string, userId: string): Promise<WatchIssueResult>;
  /**
   * `DELETE …/watchers/{userId}`, project `ADMIN` only. Answers with the same
   * DTO as `unwatchIssue`, `removed` included and meaning the same thing.
   */
  removeIssueWatcher(projectId: string, issueId: string, userId: string): Promise<UnwatchIssueResult>;

  /**
   * The five attachment routes, plus the one leg of the upload that is not a
   * route at all.
   *
   * All five gateway routes are `EndpointSecurity.PROTECTED` — authenticated,
   * and with **no role check at the gateway**. The gate is a project-role check
   * inside issue-service, from `issue.allowed-roles` in its `application.yml`:
   * `upload-attachment-roles: ADMIN,MEMBER` covers leg 1 and leg 3,
   * `view-attachment-roles: ADMIN,MEMBER,VIEWER` covers the list and the
   * download link, and delete is split in two —
   * `delete-own-attachment-roles: ADMIN,MEMBER` when the caller uploaded it and
   * `delete-attachment-roles: ADMIN` when somebody else did. Hiding a control
   * on those rules is presentation; the server decides.
   *
   * `projectId` is in every signature because it is in every path, but it is
   * **not** an access check on the wire: `IssueAttachmentController` says so in
   * its own comment — "projectId в пути используется только для
   * REST-иерархии/читаемости URL и не участвует в авторизации" — and forwards
   * only `issueId` (or `attachmentId`) over gRPC. The mock resolves an issue
   * *within* a project and so does enforce it, which is a known divergence of
   * the same shape as `getIssue`'s.
   */
  listAttachments(projectId: string, issueId: string): Promise<IssueAttachment[]>;

  /**
   * **Leg 1 of three.** Asks the gateway to sign an upload, and starts the
   * fifteen-minute clock on `ATTACHMENT_PRESIGNED_TTL_MS` — which is why this
   * belongs to the moment a file is chosen rather than to the moment the panel
   * opens.
   *
   * Refused before the request, identically by every implementation, by
   * `attachmentRefusal` in src/api/attachments.ts: a type outside the
   * thirteen-entry allowlist, an empty file, or one over 2 MB. Not politeness —
   * the server refuses all three, so a mock that accepted them would hide the
   * failure from the e2e suite.
   *
   * All three answer the same at this leg, `400` `INVALID_ARGUMENT`: the type
   * from issue-service, and the empty file and the ceiling from the gateway's
   * own bean validation (`minimum: 1`, `maximum: 2097152`) before issue-service
   * is asked. The ceiling is checked again at leg 3, where an oversized object
   * answers `400` `OUT_OF_RANGE` (read at `develop` `1cfe4d79f074`).
   *
   * This comment said the ceiling was a **500** until TAS-224, and no gateway
   * ever answered one: that was a reading of backend PR #147's older head
   * `f53dca38`, where the DTO had no `maximum` and `RestErrorMapper` no
   * `OUT_OF_RANGE` row. The PR's head moved to `deeedbf` (committed 2026-09-09)
   * with both, which removed the 500 before any gateway served these routes.
   * The re-pin to that head on 2026-09-12 updated the YAML half — the extract
   * gained the `maximum` — but missed the Java half, and TAS-224 caught it.
   * `refuseAttachment` in src/api/rest/RestTaskaApi.ts traces the chain and
   * reproduces it.
   */
  createAttachmentUploadUrl(
    projectId: string,
    issueId: string,
    input: CreateAttachmentUploadUrlInput,
  ): Promise<AttachmentUploadTicket>;

  /**
   * **Leg 2 of three, and the first method on this interface that does not
   * talk to the gateway** (`putAvatarBytes` and `getAttachmentBytes` followed
   * it). The browser PUTs the bytes straight to the object store
   * at the presigned URL, cross-origin, with no bearer token and no request id.
   *
   * It is on the interface — rather than being done inline wherever an upload
   * happens — for one reason: the mock has to be able to stand in for it. This
   * is the leg that cannot be exercised against a real store from a browser
   * today (nothing in the backend repository configures CORS on the bucket), so
   * if it were not swappable, the choreography could not be clicked through or
   * end-to-end tested at all.
   *
   * `contentType` is passed separately from the blob on purpose. It must be
   * **byte-identical** to the value given to `createAttachmentUploadUrl`,
   * because `S3StorageClient.createPresignedUploadUrl` calls `.contentType(…)`
   * on the presign request, which puts `Content-Type` into the signed headers.
   * Reading it back off a `File` would work; recomputing it, normalising its
   * case or appending a charset would produce a signature mismatch that the
   * store answers with a 403 nobody can explain.
   *
   * Failures arrive as `ObjectStoreError` (src/api/objectStore.ts), never as an
   * `ApiError`. See that class for why the store's status must not travel in a
   * field named `status`.
   *
   * `uploadUrl` is checked before it is used, by every implementation, through
   * `requireUsableUploadUrl`: an empty or relative string would resolve against
   * this app's own document and turn a malformed gateway response into a
   * same-origin PUT of the file's bytes, with cookies.
   */
  putAttachmentBytes(uploadUrl: string, body: Blob, contentType: string): Promise<void>;

  /**
   * **Leg 3 of three.** Tells the gateway the object is there; the server heads
   * it in the bucket, re-measures it, writes the row, the history event and the
   * outbox event, and answers **201** with the persisted attachment.
   *
   * **Never retry this call.** There is no unique constraint on `object_key`
   * (`0001-issue-attachments.sql` declares one primary key and one foreign key
   * and nothing else) and `AttachmentTransactionExecutor.saveAttachment` calls
   * `repository.save` unconditionally, so a second confirm for the same object
   * inserts a **second row**, plus a second `ATTACHMENT_UPLOADED` history entry
   * and a second outbox event. A failure in transit is indistinguishable from a
   * failure on the server, and only one of those is safe to repeat — so after
   * any failure here the correct move is to re-read the list and look, never to
   * send it again.
   *
   * A successful leg 2 followed by a failed leg 3 leaves the object in the
   * bucket with no row pointing at it. Nothing sweeps those, and the delete
   * route is a soft delete that does not touch the store either, so no client
   * can clean it up. Say the file was not attached; do not pretend to have
   * tidied up.
   */
  confirmAttachmentUpload(
    projectId: string,
    issueId: string,
    input: ConfirmAttachmentUploadInput,
  ): Promise<IssueAttachment>;

  /**
   * A presigned GET, freshly signed per call and good for the same fifteen
   * minutes. Asked for on demand rather than per row on load, because a link
   * minted when the panel opened would be dead by the time anybody clicked it.
   */
  getAttachmentDownloadUrl(
    projectId: string,
    issueId: string,
    attachmentId: string,
  ): Promise<AttachmentDownloadUrl>;

  /**
   * **The third method on this interface that does not talk to the gateway**
   * (TAS-253): a plain GET of the bytes behind a link `getAttachmentDownloadUrl`
   * just handed back, so the panel can save the file under its own name. The
   * presigned object carries no `Content-Disposition` (measured 2026-10-11), so
   * the link alone can only *open* a file, never download it.
   *
   * On the interface for the reason the two PUTs are: the seam that swaps mock
   * for rest has to sit at the level of the thing it stands in for, or the
   * end-to-end suite — whose links point at `127.0.0.1:9000` — would have no
   * structural guarantee that it never fetches one.
   *
   * Failures arrive as `ObjectStoreError` (src/api/objectStore.ts), never as an
   * `ApiError`; `objectStore.test.ts` proves the gateway predicates do not match
   * them. No header is sent, so the request stays a CORS "simple" GET with no
   * preflight, and no credentials. `downloadUrl` is checked first through
   * `requireUsableDownloadUrl`, so an empty or relative link cannot turn into a
   * same-origin read of this app's own document.
   */
  getAttachmentBytes(downloadUrl: string): Promise<Blob>;

  /**
   * Soft delete: `deleted_at` is stamped and the row stops being listed. **The
   * object itself is left in the bucket** — `AttachmentTransactionExecutor`
   * writes the row, the history event and the outbox event, and calls nothing
   * on the storage client. The UI must not describe this as removing the file.
   */
  deleteAttachment(projectId: string, issueId: string, attachmentId: string): Promise<void>;

  /**
   * The four avatar routes, plus the one leg of the upload that is not a route
   * at all — backend PR #150 (TAS-129), **merged** into `develop` on 2026-09-14
   * at `368ae77355bd` and in `docs/contract/openapi.yml` since, and **deployed**
   * later the same day.
   *
   * All four answered Spring's static-resource **404** when probed on
   * 2026-09-12 without a token, with `GET /users/me` answering 401 in the same
   * run as the control, and the routes still answered it on 2026-09-14 at 11:14
   * UTC, after the merge. Probed again at 13:53 UTC the same day, `GET
   * /users/{id}/avatar` answered 400 `INVALID_ARGUMENT` and `POST
   * /users/me/avatar/upload-url` answered 405 — the routes had deployed, and
   * neither answer is the signature `isUndeployedRoute` in src/api/errors.ts
   * matches (its one arm is the 404; the 405 arm went in TAS-149). A caller
   * must still read that predicate before printing a raw failure, because the
   * mechanism stays: `UserProfileMenu` reads it on each write. Since TAS-223 this interface carries three
   * of the four: the reader's own avatar arrives on `GET /users/me`, and
   * `GET /users/{userId}/avatar` has no caller and no method here.
   *
   * **No role gates any of these.** Three of the four are scoped to `me`, and
   * the read is authenticated and nothing more. There is therefore no
   * `ADMIN`/`MEMBER`/`VIEWER` question here at all — a `VIEWER` of every project
   * in the product still owns their own face — and nothing in the UI hides
   * these controls from anybody.
   *
   * Where the choreography differs from attachments, and it is worth stating
   * because the two look interchangeable: this one is **replace**, not append —
   * a user has one avatar, and a confirm takes the place of the one before —
   * and `DELETE` is declared idempotent, 204 whether or not there was anything
   * to delete. Since backend PR #198 the confirm is idempotent too, for the
   * key the saved row holds — see `confirmAvatarUpload` below — where an
   * attachment confirm sent twice is still two rows.
   *
   * The key leg 1 mints is `avatars/{userId}/{uuid}` since that PR: the
   * caller's own folder, which is what the confirm checks a key against.
   */
  createAvatarUploadUrl(input: CreateAvatarUploadUrlInput): Promise<AvatarUploadTicket>;

  /**
   * **The second method on this interface that does not talk to the gateway**,
   * and it is here for exactly the reason the attachment one is: the seam that
   * swaps mock for rest has to sit at the same level as the thing it stands in
   * for, or the end-to-end suite has no structural guarantee that it makes no
   * real network call.
   *
   * `contentType` is passed separately from the blob and must be
   * **byte-identical** to the value given to `createAvatarUploadUrl`: the
   * presign covers the `Content-Type` header, so recomputing it, normalising
   * its case or appending a charset is a signature mismatch the store answers
   * with a 403 nobody can explain.
   *
   * Failures arrive as `ObjectStoreError` (src/api/objectStore.ts) — the same
   * type the attachment leg throws, not a second one meaning the same thing.
   * The guarantee AGENTS.md attaches to a non-gateway method on this interface
   * is a property of that class and is tested once, in
   * src/api/rest/RestTaskaApi.test.ts: the gateway-error predicates provably
   * do not match it.
   *
   * It is a separate *method* from `putAttachmentBytes` even though the REST
   * implementation of the two is one shared private helper, because the mock is
   * not shared: an avatar ticket and an attachment ticket are minted by
   * different routes against different buckets, and a mock that honoured either
   * link on either leg would let a caller cross them without noticing.
   */
  putAvatarBytes(uploadUrl: string, body: Blob, contentType: string): Promise<void>;

  /**
   * Leg 3: auth-service checks that the key is the caller's, heads the object
   * in the bucket, re-measures it against its own 2 MB ceiling — deleting an
   * object over it and answering 400 `OUT_OF_RANGE`, a 500 until backend PR
   * #147 gave `RestErrorMapper` the row — replaces the user's row, deletes the
   * *previous* row's object, and answers with the avatar, `downloadUrl` and
   * `createdAt` included. So a freshly uploaded face needs no follow-up read:
   * the link to draw is in the answer.
   *
   * What backend PR #198 (TAS-221) made of it, read at develop `398285cde074`
   * (`ProfileServiceImpl.confirmAvatarUpload`) and deployed 2026-10-19:
   *
   * - **only the caller's key is accepted** — one leg 1 minted for them, or
   *   the key their saved row already holds (a row from before the PR keeps a
   *   key without the folder). Any other key, and one of theirs with no object
   *   behind it, is 404 `NOT_FOUND` "An object with this key was not found in
   *   the storage." — one answer for both, before anything changes;
   * - **the key the saved row holds changes nothing**: that row comes back as
   *   it is, with a freshly signed link, and nothing is deleted.
   *
   * Before the PR neither held: a confirm could point the caller's row at
   * somebody else's object, and a second confirm of the saved key deleted the
   * very object it confirmed. Repeating a confirm is safe now; this client
   * still does not — a retry is a new ticket, the person choosing the file
   * again and leg 1 minting a new key, and there is no retry-confirm control.
   */
  confirmAvatarUpload(input: ConfirmAvatarUploadInput): Promise<UserAvatar>;

  /**
   * `DELETE /users/me/avatar` — **idempotent by the contract's own words**
   * ("Идемпотентная операция. Если аватар отсутствует, завершается успешно"),
   * 204 either way. So a client can neither learn nor report whether there was
   * anything to remove, and must not phrase the outcome as though it had.
   */
  deleteMyAvatar(): Promise<void>;


  /**
   * The four worklog routes, `/projects/{projectId}/issues/{issueId}/worklogs`
   * (backend PR #178, TAS-118 — merged at 405b5fe, deployed 2026-10-12; a
   * gateway that does not serve them yet answers the gateway's static-resource 404, which
   * `isUndeployedRoute` tells apart from a real 404).
   *
   * Roles, from issue-service's `issue.allowed-roles` at the PR head: the list
   * `ADMIN, MEMBER, VIEWER`; an add `ADMIN, MEMBER`; an update or delete of
   * your own entry `ADMIN, MEMBER`, of somebody else's `ADMIN` only. A worklog
   * of another issue is `404`, as is a missing issue or worklog.
   *
   * **Every successful write moves the issue**: its `version` goes up and its
   * `remainingEstimateMinutes` moves by the minutes added, changed or removed
   * (never below 0). A caller holding the issue's version for a later
   * `If-Match` has to re-read the issue after one of these.
   *
   * The list comes ordered by `workDate` descending with no tiebreak, so equal
   * days come in no stated order (`sortWorklogs` in src/lib/worklog.ts).
   */
  listIssueWorklogs(projectId: string, issueId: string): Promise<IssueWorklog[]>;
  /** `POST …/worklogs`, answered `201` with the entry. */
  addIssueWorklog(projectId: string, issueId: string, input: AddIssueWorklogInput): Promise<IssueWorklog>;
  /** `PUT …/worklogs/{worklogId}`, a partial update — see `UpdateIssueWorklogInput`. */
  updateIssueWorklog(
    projectId: string,
    issueId: string,
    worklogId: string,
    input: UpdateIssueWorklogInput,
  ): Promise<IssueWorklog>;
  /** `DELETE …/worklogs/{worklogId}`, answered `204`. */
  deleteIssueWorklog(projectId: string, issueId: string, worklogId: string): Promise<void>;

  /**
   * The four workflow routes of backend PR #208 (TAS-381), merged into develop
   * as `594f637` on 2026-10-22 and in `docs/contract/openapi.yml` since. A
   * gateway that has not deployed them answers the static-resource 404 that
   * `isUndeployedRoute` reads. Read from the Java at the PR's head `9a04e99`,
   * which the merge took unchanged (api-contract-guard, TAS-382):
   *
   * - The list is any member's: a missing project is 404 "Project not found", a
   *   non-member — a `GLOBAL_ADMIN` included — 403. It walks TASK, BUG and STORY
   *   whatever the project allows, resolves each to the project's own workflow
   *   or the shared default, and answers each workflow once, at the position of
   *   the first type on it. Statuses and transitions by `sortOrder`, hidden
   *   transitions included.
   * - The three writes are ADMIN-only, refused by workflow-service: 404
   *   "Project not found", 403 "Access denied" for a non-member, 403 "Not
   *   allowed role" for anybody else.
   * - The three adds compare no `version` (1 on create, +1 per add); the six
   *   edit and delete routes of backend PR #225 (TAS-384) do — see
   *   `UpdateProjectWorkflowInput`.
   *
   * **Every write answers `ProjectWorkflowDto`** since backend PR #225 (develop
   * `6ba4ed6`), the three adds included: the workflow with every status and
   * every transition, hidden ones included, both by `sortOrder`, its project's
   * issue types and `shared` — read as the list reads it, so a `shared` nobody
   * stated is `true`. A caller may put an edit's answer in place of that
   * workflow's entry; a create and a workflow delete also move types on or off
   * the shared default, which their answer does not describe, so the list is
   * read again after those.
   */
  listProjectWorkflows(projectId: string): Promise<ProjectWorkflowEntry[]>;
  /**
   * `POST /projects/{projectId}/workflows`. Refused in the server's order: the
   * role; the whole body ("Workflow creation failed: …", 400 — on create a
   * duplicate key or pair is 400 too); then any requested type already bound in
   * the project, 409 `ALREADY_EXISTS`. The 201 is the new workflow with its
   * types and `shared: false`, `version` 1.
   */
  createProjectWorkflow(projectId: string, input: CreateProjectWorkflowInput): Promise<ProjectWorkflowEntry>;
  /**
   * `POST …/workflows/{workflowId}/statuses`. After the role: an unknown
   * workflow is 404, the shared default 400 `FAILED_PRECONDITION` (not a
   * conflict), another project's workflow 404; then the whole workflow is
   * re-validated ("Workflow update failed: …") — 409 `ALREADY_EXISTS` only when
   * every violation is a duplicate key or pair, 400 otherwise.
   */
  addWorkflowStatus(projectId: string, workflowId: string, input: WorkflowStatusInput): Promise<ProjectWorkflowEntry>;
  /** `POST …/workflows/{workflowId}/transitions`. The same refusals as `addWorkflowStatus`. */
  addWorkflowTransition(projectId: string, workflowId: string, input: WorkflowTransitionInput): Promise<ProjectWorkflowEntry>;
  /**
   * The six routes of backend PR #225 (TAS-384, develop `6ba4ed6`), read from
   * workflow-service's `WorkflowMutationService`. The gateway checks a body's
   * shape only — an unknown field, an explicit `null`, a number that is not a
   * whole int, a category outside the enum: "Invalid request parameters" — and
   * not the yml's bounds; the deletes' query parameters it does check
   * (`version ≥ 1`, the key's pattern). Then a body `version` below 1 is 400
   * "version must be positive" before the role is looked at. Then each route
   * is refused as an add is (role, archive, unknown workflow 404, the shared
   * default 400 `FAILED_PRECONDITION`, another project's workflow 404), then:
   *
   * - a `version` that is not the server's → 409 `ABORTED` "Workflow version
   *   changed" (a concurrent write is `ABORTED` too). `ALREADY_EXISTS` is a 409
   *   as well: tell them apart by `code`, never by message or status;
   * - a status or transition this workflow does not have → 404;
   * - the workflow as it would stand must keep a `TODO` status and a visible
   *   transition → else 400 `INVALID_ARGUMENT` "Workflow requires a TODO status
   *   and at least one visible transition"; then the create rules with the
   *   edit's prefix, 400 "Workflow update failed: …" — a blank or over-100
   *   name, a negative `sortOrder`, a `sortOrder` another status (or
   *   transition) holds ("Status sort order is not unique: N");
   * - a delete that leaves issues of the workflow's types in a status it no
   *   longer has → issue-service's 400 `FAILED_PRECONDITION` "Workflow statuses
   *   have N issues; supply a target status mapping", `details`
   *   `{issueCount, statusKeys}` as strings. That the details survive the hop
   *   from issue-service through workflow-service to the gateway is **not
   *   verified**; the dialog offers its move or mapping step only when they
   *   came, and says any other refusal as one. Over 5000 issues →
   *   `RESOURCE_EXHAUSTED`. Each moved issue gets a `TRANSITIONED` history entry.
   *
   * Every edit raises `version` by one.
   */
  updateProjectWorkflow(
    projectId: string,
    workflowId: string,
    input: UpdateProjectWorkflowInput,
  ): Promise<ProjectWorkflowEntry>;
  /**
   * `DELETE …/workflows/{workflowId}`, with a JSON body (a body of any other
   * type is 415). The workflow's types go back to the shared default; issues in
   * a status the shared default lacks need `statusMappings` — a source that is a
   * status of this workflow, a target present in both, else 400 "Map to
   * statuses present in both workflows; add a target status to the current
   * workflow first if needed". Answers the **shared default** — `shared: true`,
   * and `issueTypes` only the deleted workflow's.
   */
  deleteProjectWorkflow(
    projectId: string,
    workflowId: string,
    input: DeleteProjectWorkflowInput,
  ): Promise<ProjectWorkflowEntry>;
  /** `PATCH …/statuses/{statusId}`: at least one of name, category, sortOrder (else 400). */
  updateWorkflowStatus(
    projectId: string,
    workflowId: string,
    statusId: string,
    input: UpdateWorkflowStatusInput,
  ): Promise<ProjectWorkflowEntry>;
  /**
   * `DELETE …/statuses/{statusId}?version=&targetStatusKey=`: the status and
   * every transition from or to it. `TODO` cannot go (400 `FAILED_PRECONDITION`
   * "The initial TODO status cannot be deleted"); a target that is not another
   * status of this workflow is 400 "Target status is not in this workflow".
   */
  deleteWorkflowStatus(
    projectId: string,
    workflowId: string,
    statusId: string,
    params: DeleteWorkflowStatusParams,
  ): Promise<ProjectWorkflowEntry>;
  /** `PATCH …/transitions/{transitionId}`: at least one of name, sortOrder, hidden (else 400). */
  updateWorkflowTransition(
    projectId: string,
    workflowId: string,
    transitionId: string,
    input: UpdateWorkflowTransitionInput,
  ): Promise<ProjectWorkflowEntry>;
  /** `DELETE …/transitions/{transitionId}?version=`. */
  deleteWorkflowTransition(
    projectId: string,
    workflowId: string,
    transitionId: string,
    params: DeleteWorkflowTransitionParams,
  ): Promise<ProjectWorkflowEntry>;

  listComments(projectId: string, issueId: string, params?: ListCommentsParams): Promise<Page<IssueComment>>;
  addComment(projectId: string, issueId: string, body: string): Promise<IssueComment>;
  updateComment(projectId: string, issueId: string, commentId: string, body: string): Promise<IssueComment>;
  deleteComment(projectId: string, issueId: string, commentId: string): Promise<void>;

  /** `unreadCount` is the reader's total, whatever `params` narrowed the page to. */
  listNotifications(params?: ListNotificationsParams): Promise<NotificationPage>;
  markNotificationRead(notificationId: string): Promise<Notification>;
  /**
   * One request (`POST /notifications/read-all`). `updatedCount` is how many
   * this call changed, so a repeat answers 0 — the route is idempotent.
   */
  markAllNotificationsRead(): Promise<{ updatedCount: number }>;

  /**
   * The catalog of services and tables the read-only admin API will serve
   * (`GET /readonly/catalog`). `GLOBAL_ADMIN` only — every other caller gets a
   * 403 from the server, which is the actual permission control; the UI hiding
   * the section is not.
   */
  getAdminCatalog(): Promise<AdminCatalog>;

  /**
   * One page of one table (`GET /readonly/{service}/{table}`). The service and
   * table names are not validated here: the catalog above is the only source of
   * legitimate values, and the gateway validates them again regardless.
   */
  listAdminRows(query: AdminRowsQuery): Promise<AdminRows>;

  /**
   * One row by its primary key (`GET /readonly/{service}/{table}/{id}`), for
   * the row card in §5.8. A row that is not there is a missing row, not a
   * missing address: the caller distinguishes it from a refusal and says so
   * inside the card.
   */
  getAdminRow(query: AdminRowQuery): Promise<AdminRow>;

  /**
   * The problematic outbox events, all services at once
   * (`GET /readonly/outbox/problematic-summary`) — the Events section's
   * Problems view (DESIGN.md §5.8).
   *
   * **No `serviceKey` parameter on purpose**, though the wire contract accepts
   * an optional one. The UI never narrows this call: the whole point of the
   * view is "what is stuck, everywhere", and digging into one service is the
   * Outbox journal's job, on the generic table reads above. A parameter with no
   * caller is surface that has to be kept working for nobody.
   *
   * It is in the vendored contract (docs/contract/openapi.yml) and in the
   * deployed gateway's own generated spec, and it answers: probed 2026-09-08
   * with a `GLOBAL_ADMIN` token, `200` with `{counts, events, notAllShown}`,
   * carrying two real `FAILED` events on `project` with `attempts: 5` and
   * `lastErrorMessage: "Failed to construct kafka producer"`.
   *
   * Until TAS-194 this route carried one more thing: a pinned copy of the
   * sentence an *older* gateway answered when it did not know the path, and a
   * predicate reading that exact pair as "not deployed yet". Backend PR #141
   * (TAS-105) merged 2026-08-27 and the signature stopped existing; the note
   * stayed in the tree, inert, until it was deleted by hand. It is worth one
   * line here because the mechanism outlives the case: a compensation that
   * promises to retire itself when the server changes is a compensation nobody
   * schedules the removal of.
   */
  getProblematicOutboxSummary(): Promise<ProblematicOutboxSummary>;

  /**
   * `GET /readonly/audit-entries` — the admin audit log, `GLOBAL_ADMIN` only
   * (backend PR #197, TAS-160), in docs/contract/openapi.yml since develop
   * `398285cde074`. **Merged and deployed 2026-10-19**: probed that day with a
   * token, `200` with `{entries, pagination}`, newest first, an `id` on every
   * entry. The Audit section's one read (DESIGN.md §5.8). `page` is 1-based on
   * both sides of this interface; the rest leg converts it.
   *
   * A gateway without the route answers the static-resource 404, which
   * `isUndeployedRoute` in src/api/errors.ts reads and the section states as
   * "not served yet" rather than as a failure.
   *
   * What the server does with the request, read at the merged head
   * (`AdminReadOnlyController`, `GrpcAdminReadonlyService`,
   * `AdminReadonlyServiceImpl`), and what each implementation does:
   *
   * - **Paged and sorted**: `createdAt` descending, then `id` descending. The
   *   rest leg maps what arrives and slices nothing; the mock pages and sorts
   *   the same way. A `pageSize` outside 1–100 never reaches admin-service's
   *   own fallback and clamp: the gateway validates the parameter as the
   *   contract declares it and answers 400 `INVALID_ARGUMENT` "Invalid request
   *   parameters", `details: null`, before authentication — probed tokenless
   *   2026-10-19, `pageSize=101` (`c2defbe6-470c-4df0-8bc6-54ef5f5ab1b7`) and
   *   `pageSize=0` (`725e0ec8-0480-47bd-9114-69b8aea13806`) both 400, while
   *   `pageSize=100` reached authentication and answered 401
   *   (`ed1bc134-db9e-41f8-b55a-32d9e64b8d01`). The mock refuses the same way;
   *   the section always asks for 20. The wire's `page` has `minimum: 0`,
   *   which the rest leg cannot break: it sends `max(0, page - 1)`. Its other
   *   bound is `int32`: `page=2147483647` reaches sign-in (401,
   *   `36256d82-dcb4-40e3-b861-38be1f590e3e`), `page=2147483648` is the same
   *   binding 400 (`7f84f3a1-aa67-4c52-b970-a2947433bfe9`).
   * - **Dates are `yyyy-MM-dd` only**, whole UTC days, both ends inclusive. Any
   *   other spelling — and an `actorUserId` that is not a UUID — is refused
   *   by the gateway's own parameter binding before authentication: 400
   *   `INVALID_ARGUMENT` "Invalid request parameters", `details: null`. The
   *   section validates both before sending, so neither is spent.
   * - A `from` after `to` is admin-service's 400 `INVALID_ARGUMENT`,
   *   "body.createdAtFrom cannot be later than body.createdAtTo" — after the
   *   role check, so a non-admin is told 403 first.
   * - Not `GLOBAL_ADMIN`: 403 `PERMISSION_DENIED` "User doesn't have
   *   permission".
   * - Every filter is an exact match; an empty one is not sent.
   * - The DTO declares nothing `required`; see `AuditEntry` for the defensive
   *   mapping. `oldValue` and `newValue` are JSON text, masked; a document
   *   that is not a JSON object is logged as nothing (masking reads objects
   *   only), so a `null` there is not proof the operation had no value.
   */
  listAuditEntries(query: AuditEntriesQuery): Promise<AuditEntries>;

  /**
   * `POST /admin/outbox/{service}/{eventId}/retry` — `retryOutboxEvent`, the
   * Events section's one write and the only write in this product that acts on
   * a queue rather than on a record (DESIGN.md §5.8).
   *
   * `EndpointSecurity.GLOBAL_ADMIN_REQUIRED`, like everything else under
   * `/admin`. The `reason` is required, 1–1000 characters, and is written into
   * the admin audit log — that is the whole of what the body carries and the
   * whole reason a dialog asks for it.
   *
   * **What the server does, read off `OutboxRetryServiceImpl` and
   * `OutboxRetryRepositoryImpl` on backend `develop` at 2026-09-08**, because
   * the contract states none of it and every sentence the UI says about this
   * button depends on it:
   *
   * - the update is `status = 'NEW'`, `last_error_message = NULL`,
   *   `processing_started_at = NULL`. **`attempts` is not in the UPDATE**, so the
   *   count survives the retry — the response reports the same number the row
   *   already had. Nothing here resets a counter, and the dialog says so.
   * - it is legal from **`FAILED`**, and from **`PROCESSING` that has been stuck
   *   past the server's own retry threshold** (`admin.outbox-retry.stuck-threshold`,
   *   default **10m**). Anything else — `NEW`, `PUBLISHED`, a `PROCESSING` row
   *   younger than the threshold — is `DomainStatus.FAILED_PRECONDITION` with
   *   `"Outbox event with status X is not eligible for retry"`, which
   *   `RestErrorMapper.mapGrpcCodeToHttpStatus` turns into **400** carrying
   *   `"FAILED_PRECONDITION"` in the body's `code`. Same shape as the Users
   *   section's last-admin refusal, and read the same way — by `isConflict`
   *   (src/api/errors.ts), through the `code` arm and through nothing else.
   * - **that threshold is not the one this section's list uses.** The summary
   *   calls a `PROCESSING` row stuck after the producing service's own
   *   processing timeout (`admin.outbox.processing-timeouts`, default **5m**);
   *   retry wants **10m**. So the Problems view can legitimately list a row as
   *   "Stuck processing" that this route refuses, for five minutes, and the
   *   client cannot predict which — both numbers are server configuration it
   *   never sees. Recorded in docs/ai/API-DIVERGENCE.md; compensated by wording
   *   rather than by a client-side clock.
   * - a row nobody has is `404 NOT_FOUND`, `"Outbox event not found: {id}"`.
   * - a race between the eligibility read and the UPDATE is
   *   `FAILED_PRECONDITION` again, `"Outbox event is no longer eligible for
   *   retry"` — the same sentence class, which is why nothing branches on the
   *   wording and the server's own text is printed as it arrived.
   *
   * **The client cannot see whether a failed call landed**, and this is the
   * fact the caller must not paper over. The audit row is written *after* the
   * UPDATE has committed, so a fault in `AuditService` — or any 5xx, or a
   * connection dropped on the way back — is a failure reported over a retry that
   * already happened. Nothing here may be worded as "nothing changed"; the
   * attachments confirm path (`src/screens/BoardScreen.tsx`) is the same shape
   * and the same rule.
   *
   * `service` is typed to the contract's closed enum rather than to `string`
   * (`RETRYABLE_OUTBOX_SERVICES` above), so a service key the route cannot carry
   * is a type error here rather than a `400` at the boundary.
   */
  retryOutboxEvent(
    service: RetryableOutboxService,
    eventId: string,
    reason: string,
  ): Promise<OutboxRetryResult>;

  /**
   * `POST /admin/users/{userId}/block` — one of the Users section's three
   * writes (DESIGN.md §5.8). `GLOBAL_ADMIN` only; the server is the permission
   * control, and this section hiding a button is not.
   *
   * The `reason` is required by the server (1–550 characters) and must never
   * reach the wire blank: a whitespace-only reason is a `400` at the boundary,
   * which is the worst place for the reader to find out. Every implementation
   * refuses it locally for that reason, exactly as `searchIssues` refuses a
   * query below the runtime minimum.
   *
   * What the server refuses, and what the caller must therefore not assume:
   *
   * - a status the transition does not allow — block is legal from `ACTIVE`
   *   and from `INVITED` and from nothing else. `DomainStatus.ABORTED` on the
   *   backend, which `RestErrorMapper.mapGrpcCodeToHttpStatus` turns into
   *   **409** with `"ABORTED"` in the body's `code`;
   * - blocking the **last active `GLOBAL_ADMIN`**, which is a count only the
   *   server can take. That is why nothing here is optimistic: the client
   *   cannot predict the answer, so it waits for one (DESIGN.md §5.8). This one
   *   is `DomainStatus.FAILED_PRECONDITION`, and the same mapper turns *that*
   *   into **400** with `"FAILED_PRECONDITION"` in `code`.
   *
   * So the two refusals do **not** share a status, and the more important of
   * them is not a 409 at all. `isConflict` (src/api/errors.ts) is what reads
   * both, from either implementation, and it has to keep reading the `code` —
   * that is the only half carrying the last-admin refusal on the wire.
   *
   * On the deployed gateway since backend PR #146 (merged 2026-09-07). Measured
   * 2026-09-08 with a GLOBAL_ADMIN token against
   * `POST /api/v1/admin/users/not-a-uuid/block`, which answers
   * `400 INVALID_ARGUMENT` — the path is mapped and rejects the uuid — where the
   * same call answered Spring's static-resource 404 on 2026-08-25. That 404 is
   * what the Users section used to read as "not deployed yet"; the compensation
   * came out with TAS-196.
   */
  blockUser(userId: string, reason: string): Promise<UserStatusChange>;

  /**
   * `POST /admin/users/{userId}/unblock`, with the same body, the same role
   * gate and the same refusals as `blockUser`, except for the transition it
   * allows: **only** `BLOCKED` → `ACTIVE`.
   *
   * The invite state is not restored by it. An `INVITED` account that was
   * blocked comes back as `ACTIVE`, not as `INVITED` — that is the backend's
   * own semantics, and the UI says so in the confirmation rather than working
   * around it.
   */
  unblockUser(userId: string, reason: string): Promise<UserStatusChange>;

  /**
   * `POST /admin/users/{userId}/reset-lockout` — `resetCredentialLockout`, the
   * third of the Users section's writes and the only one that undoes something
   * no administrator did. `EndpointSecurity.GLOBAL_ADMIN_REQUIRED`, the same
   * 1–550 `reason` as its two neighbours, and the same
   * `UserStatusResponseDto` back.
   *
   * `LOCKED` is where an account lands after `maxFailedAttempts` failed
   * sign-ins. The state and this endpoint arrived together in backend PR #146:
   * before it, `handleFailedAttempt(Credential)` wrote no status at all and
   * nothing could be locked. That is what makes this the write that answers a
   * forgotten password rather than a decision about a person. On
   * success `AdminUserManagementServiceImpl.resetCredentialLockout` clears the
   * credential's `failedAttempts`, `lockedUntil` and `lastFailedAt` and sets
   * the account `ACTIVE`, which is why the transition it reports is always
   * `LOCKED` → `ACTIVE` and the confirmation can state it before asking.
   *
   * What it does **not** touch is worth stating, because it is the question an
   * administrator asks: the password hash, the hashing algorithm and the
   * refresh tokens are all left alone. It also writes an audit row and **no**
   * outbox event, so unlike block and unblock it notifies nobody.
   *
   * What the server refuses:
   *
   * - any status other than `LOCKED`, which is a refusal and not a no-op:
   *   `DomainStatus.FAILED_PRECONDITION` with the message
   *   `"User is not in LOCKED status"`. `RestErrorMapper.mapGrpcCodeToHttpStatus`
   *   turns that into **400** carrying `"FAILED_PRECONDITION"` in the body's
   *   `code` — the same shape as `blockUser`'s last-admin refusal and *not* the
   *   409 its transition refusal wears. So `isConflict` (src/api/errors.ts)
   *   reading the `code` is again the only half that works; the status alone
   *   would file this under "the gateway would not accept this request".
   * - `404 NOT_FOUND` in two different sentences: `"User not found"` for an
   *   account nobody has, and `"Credential not found"` for a `LOCKED` account
   *   with no `PASSWORD` credential row. One status, one code, two messages —
   *   so nothing may branch on the wording, and the server's own sentence is
   *   printed as it arrived.
   *
   * The failed-attempt count and the lock expiry are deliberately **not** in
   * this signature. `UserCredentialStateResponseDto` carries them between
   * auth-service and admin-service and is dropped before REST, so no client can
   * show them; modelling them here would be inventing a field the wire has
   * never had.
   *
   * Deployed with the other two — same backend PR #146, measured the same way
   * on 2026-09-08: `POST /api/v1/admin/users/not-a-uuid/reset-lockout` answers
   * `400 INVALID_ARGUMENT`.
   *
   * Two things about it stay compensated (docs/ai/API-DIVERGENCE.md), and
   * neither is closed by the routes deploying. The not-locked refusal arrives as
   * **400** — the contract lists `400/401/403/404` here and no `409`, while the
   * backend's own gateway test for it asserts 409, so the client believes the
   * mapper and reads the `code` (`isConflict`, src/api/errors.ts). And
   * `GET /users/me` used to report a locked account as `UNSPECIFIED`: since
   * backend TAS-197 (`04546f1`, deployed) the gateway's `GatewayUserStatus` has
   * a `LOCKED` member, so a locked account whose token was issued before the
   * lock reads `LOCKED` — and that token still works while TAS-198 (backend PR
   * #174) is open. `ValidateAccessTokenResponseDto.status` is `UserStatusDto`
   * since backend PR #200, and `UNSPECIFIED` is a member of it as it is of the
   * gateway's enum — read as no status (TAS-173).
   */
  resetCredentialLockout(userId: string, reason: string): Promise<UserStatusChange>;
}

/**
 * What the *deployed* gateway says when asked for a route it does not have —
 * measured 2026-09-06 against
 * `GET /api/v1/projects/{uuid}/issues/{uuid}/attachments`:
 * `404 {"code":"NOT_FOUND","message":"No static resource
 * api/v1/projects/…/attachments for request '…'"}`, where the deployed
 * neighbour `…/comments` answers `401` to the same unauthenticated request.
 *
 * That prefix is Spring's static-resource fallback, which is what an unmapped
 * path falls through to, and it is what tells "this route has not deployed yet"
 * apart from a deployed route's own `404 "Issue not found"`. Matched as a
 * **substring** paired with the 404 — never by equality — because the tail
 * carries the request path, so an equality check would never fire.
 *
 * `UserProfileMenu` passes it for the avatar routes — deployed on 2026-09-14,
 * so this 404 no longer comes back for them. `EditProjectModal` used to, for
 * `PATCH` and `DELETE /projects/{id}` (backend PRs #155 and #159), which
 * answered with the 405 that `isUndeployedRoute` had a second arm for; both
 * deployed — 401 without a token on 2026-10-23 — and TAS-149 took the dialog's
 * two branches out, and that arm with them. Two older callers are gone too. The admin user writes were the original
 * one — PR #146
 * deployed all three, so `POST /api/v1/admin/users/not-a-uuid/block` answers
 * `400 INVALID_ARGUMENT` as of 2026-09-08 where it answered this 404 on
 * 2026-08-25, and TAS-196 took that compensation out. The attachments panel was
 * the other — its routes merged with backend PR #147 on 2026-09-14 and are
 * deployed, the list route answered `401` without a token on 2026-09-16, and
 * TAS-224 took that branch out.
 *
 * Pinned here rather than inline in a component: a gateway string the UI
 * branches on is a measurement, and it belongs where the measurement can be
 * read.
 *
 * The *signature* removes itself; the *code* does not, and this build has now
 * shipped the worked example three times — the attachments branch above is the
 * third, taken out by hand in TAS-224. The day PR #146 deployed the three admin
 * user routes they began answering for themselves and this string stopped
 * matching them — silently, with nothing reported to anyone; deleting the
 * branch, the dialog copy and the divergence entry was a separate act, done by
 * hand in TAS-196. The problems summary's own "not deployed yet" note went the
 * same way, and less kindly: its route deployed on 2026-08-27 and the note sat
 * inert for twelve days before TAS-194 deleted it, because nothing was looking.
 * That is why a compensation needs a story to retire
 * it and never a deployment: nobody schedules the removal of a check that has
 * promised to disappear on its own.
 */
export const UNDEPLOYED_ROUTE_MESSAGE = "No static resource";
