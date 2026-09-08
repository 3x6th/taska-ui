import type {
  AdminCatalog,
  AdminRow,
  AdminRowQuery,
  AdminRows,
  AdminRowsQuery,
  AttachmentDownloadUrl,
  AttachmentUploadTicket,
  DateOnly,
  Issue,
  IssueAttachment,
  IssueComment,
  IssueLink,
  IssueLinkType,
  IssuePriority,
  IssueSearchHit,
  IssueStatus,
  IssueType,
  IssueWithHistory,
  Label,
  Notification,
  OutboxRetryResult,
  Page,
  ProblematicOutboxSummary,
  Project,
  ProjectLabel,
  ProjectMember,
  ProjectMembership,
  User,
  UserStatusChange,
  Workflow,
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

export interface CreateProjectInput {
  projectKey: string;
  name: string;
  description?: string;
}

export interface ListIssuesParams {
  status?: IssueStatus;
  assigneeId?: string;
  /** `labelId` on the wire: the issues carrying this label, filtered by the server. */
  labelId?: string;
  page?: number;
  pageSize?: number;
}

/**
 * The shortest `query` `GET /issues/search` will answer — **three**, measured
 * against the deployed gateway on 2026-08-23, where the contract declares
 * `minLength: 2`. The runtime wins (AGENTS.md), and it is exported so the mock,
 * the REST mapper and every field in the UI read the same number: a UI that
 * searched from two characters would meet a `400` at the boundary and nowhere
 * else, which is the worst place to find a gap.
 *
 * The empty string is a `400` too, while omitting the parameter is a `200` with
 * everything — so an absent query means "no text filter" and an *empty* one is
 * a rejected query, never a silent "show me everything". Both divergences are
 * recorded in docs/ai/API-DIVERGENCE.md and removed by TAS-180.
 */
export const SEARCH_QUERY_MIN_LENGTH = 3;

/** The gateway's own wording for a query below that minimum, reproduced verbatim. */
export const SEARCH_QUERY_TOO_SHORT_MESSAGE = `Search query must be at least ${SEARCH_QUERY_MIN_LENGTH} characters`;

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
 * once here for the same reason `SEARCH_QUERY_TOO_SHORT_MESSAGE` is: two copies
 * of a sentence are two chances to drift, and the whole point of this pair of
 * guards is that a caller cannot tell mock from rest.
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
 * The enums are the domain's own unions rather than the contract's bare
 * `string`s on purpose: an unrecognised `priority` or `issueType` is *silently
 * ignored* by the runtime, so the answer to a filter the server did not
 * understand is the whole set rather than a `400` — indistinguishable from a
 * filter that applied and matched everything (TAS-180). Types are the only
 * thing standing between a typo and a wider result than the one asked for.
 */
export interface SearchIssuesParams {
  /**
   * Absent means "no text filter". Present means it is searched, so anything
   * shorter than `SEARCH_QUERY_MIN_LENGTH` is rejected by the implementation
   * before it reaches the wire rather than sent and refused.
   */
  query?: string;
  /** Absent searches every project the caller can see. Unknown id → `NOT_FOUND`. */
  projectId?: string;
  statusKey?: IssueStatus;
  assigneeId?: string;
  reporterId?: string;
  priority?: IssuePriority;
  issueType?: IssueType;
  /** Zero-based, like every other paged read here. */
  page?: number;
  /** 1..100 by contract; the gateway's own default is 20. */
  pageSize?: number;
}

export interface CreateIssueInput {
  issueType: IssueType;
  summary: string;
  description: string;
  priority: IssuePriority;
  /**
   * The five planning fields, all optional — `CreateIssueRequestDto` in backend
   * PR #148 (docs/contract/pending/pr-148-TAS-116.yml).
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
 * A partial edit of one issue. **`undefined` and `null` are different answers
 * here, and the difference is the whole reason this type has a comment.**
 *
 * - a key left `undefined`, or absent altogether, means **leave it as it is**;
 * - a key set to `null` means **clear it**.
 *
 * `PUT /issues/{issueId}` is a *full replace*. `IssueServiceImpl.updateIssue`
 * on backend `develop` writes all five planning fields unconditionally, the
 * proto fields are `optional`, the gateway sets them through `setIfPresent`,
 * and `GrpcIssueService` resolves an unset optional with `.orElse(null)` — so a
 * field the request omits is **erased**, not preserved. The backend's own
 * *unit* test says so in its display name — «Частичное обновление —
 * непереданные planning fields затираются», in `IssuePlaningFieldsTest.java`
 * on `develop` (one `n`), which is Mockito over a stubbed repository.
 *
 * Every implementation therefore re-reads the issue and re-sends the value it
 * is keeping. That read is what makes "leave it as it is" true, and it is the
 * single most deletable-looking line in this API layer: it is one extra `GET`
 * before a `PUT`, it changes no visible behaviour when it is removed, and
 * removing it turns editing a summary into a write that wipes the story points,
 * both dates and both estimates of the issue being edited. Nothing in the type
 * system will notice. If you are reading this while deleting a redundant
 * re-read, this is the one that is not redundant.
 *
 * The three original fields keep the meaning they always had — `undefined`
 * leaves them alone — and they have no `null` case at all, because the contract
 * marks all three `required` and the server refuses a blank summary or
 * description outright.
 *
 * The alternative design, exposing the full replace to callers by requiring all
 * eight fields on every edit, was not chosen: it makes every component that
 * edits one field responsible for knowing the other seven, which is the same
 * data loss one layer up and in five more places.
 */
export interface UpdateIssueInput {
  summary?: string;
  description?: string;
  priority?: IssuePriority;
  /** `undefined` keeps the stored value; `null` clears it; a number sets it. `0` is a value. */
  storyPoints?: number | null;
  /** `undefined` keeps the stored value; `null` clears it. Never a `Date` — see `DateOnly`. */
  startDate?: DateOnly | null;
  dueDate?: DateOnly | null;
  originalEstimateMinutes?: number | null;
  remainingEstimateMinutes?: number | null;
}

export interface CreateIssueLinkInput {
  targetIssueId: string;
  /** The request half of the contract's asymmetry — closed, unlike the response. */
  linkType: IssueLinkType;
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

export interface ListCommentsParams {
  page?: number;
  pageSize?: number;
}

export interface ListNotificationsParams {
  unreadOnly?: boolean;
  pageSize?: number;
  offset?: number;
}

export interface TaskaApi {
  login(input: LoginInput): Promise<AuthTokens>;
  acceptInvitation(input: AcceptInvitationInput): Promise<void>;
  refresh(refreshToken: string): Promise<AuthTokens>;
  logout(): Promise<void>;
  /**
   * The signed-in account as the server describes it. `globalRole` may be
   * absent — an older gateway, or the contract's UNSPECIFIED — and callers must
   * treat that as "not stated" rather than as a role. It is descriptive only:
   * the server, not this field, decides what the account may do.
   */
  getCurrentUser(): Promise<User>;

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

  listProjects(): Promise<Project[]>;
  createProject(input: CreateProjectInput): Promise<Project>;
  getProject(projectId: string): Promise<Project>;
  getMembership(projectId: string): Promise<ProjectMembership>;
  listMembers(projectId: string): Promise<ProjectMember[]>;

  getWorkflow(projectId: string, issueType?: IssueType): Promise<Workflow>;
  listIssues(projectId: string, params?: ListIssuesParams): Promise<Page<Issue>>;
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
   * included — rejects with `INVALID_ARGUMENT` in every implementation, without
   * a request. That is not politeness: the gateway answers `400` for exactly
   * these, so a mock that quietly accepted them would hide the failure from the
   * e2e suite.
   */
  searchIssues(params: SearchIssuesParams): Promise<Page<IssueSearchHit>>;
  getIssue(projectId: string, issueId: string): Promise<IssueWithHistory>;
  /**
   * The same read for a caller that has an issue id and *not* its project.
   *
   * The route is issue-scoped on the wire (`GET /issues/{issueId}`), so
   * `RestTaskaApi.getIssue` already ignored its `projectId` argument and this
   * costs it nothing — but the mock does not ignore it, it resolves an issue
   * within a project, so a component calling `getIssue` with a project it had
   * to guess would work against the gateway and fail against the mock. Stating
   * the narrower read as its own method is what keeps the three
   * implementations interchangeable instead of accidentally equivalent.
   *
   * Added for the notifications popover, whose notification names an issue and
   * never its project (TAS-183, compensating TAS-184).
   *
   * Callers that hold both ids keep using `getIssue`, but not because its
   * `projectId` is an access check — it is not. `MockTaskaStore.findIssue`
   * matches `projectId && id && deletedAt === null`, which asks whether *this
   * issue belongs to the project you named*, and answers NOT_FOUND when it does
   * not; membership never enters it. `RestTaskaApi` asks nothing at all,
   * because the argument never reaches the wire.
   *
   * So on a mismatched `(projectId, issueId)` pair the two implementations
   * disagree outright: the mock throws NOT_FOUND, the gateway answers 200 with
   * the issue. That disagreement is the whole reason a project-less caller
   * needs its own method rather than a guessed project — routing one through
   * `getIssue` would work against the gateway and fail against the mock, which
   * is the interchangeability rule broken on the one input that distinguishes
   * them.
   */
  getIssueById(issueId: string): Promise<IssueWithHistory>;
  createIssue(projectId: string, input: CreateIssueInput): Promise<Issue>;
  updateIssue(projectId: string, issueId: string, input: UpdateIssueInput): Promise<Issue>;
  assignIssue(projectId: string, issueId: string, assigneeId: string | null): Promise<Issue>;
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
   * The labels on one issue. `Issue.labels` carries the same set from the detail
   * read, so this exists for the panel to refetch after a write rather than for
   * a screen that has no issue in hand.
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
   * The three refusals do not share an answer: the first two are `400`
   * `INVALID_ARGUMENT`, and the ceiling is `OUT_OF_RANGE` on **500**, because
   * the gateway's `RestErrorMapper` has no `OUT_OF_RANGE` row. `refuseAttachment`
   * in src/api/rest/RestTaskaApi.ts traces the whole chain and reproduces it.
   */
  createAttachmentUploadUrl(
    projectId: string,
    issueId: string,
    input: CreateAttachmentUploadUrlInput,
  ): Promise<AttachmentUploadTicket>;

  /**
   * **Leg 2 of three, and the only method on this interface that does not talk
   * to the gateway.** The browser PUTs the bytes straight to the object store
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
   * Failures arrive as `AttachmentStoreError`, never as an `ApiError`. See that
   * class for why the store's status must not travel in a field named `status`.
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
   * Soft delete: `deleted_at` is stamped and the row stops being listed. **The
   * object itself is left in the bucket** — `AttachmentTransactionExecutor`
   * writes the row, the history event and the outbox event, and calls nothing
   * on the storage client. The UI must not describe this as removing the file.
   */
  deleteAttachment(projectId: string, issueId: string, attachmentId: string): Promise<void>;

  listComments(projectId: string, issueId: string, params?: ListCommentsParams): Promise<Page<IssueComment>>;
  addComment(projectId: string, issueId: string, body: string): Promise<IssueComment>;
  updateComment(projectId: string, issueId: string, commentId: string, body: string): Promise<IssueComment>;
  deleteComment(projectId: string, issueId: string, commentId: string): Promise<void>;

  listNotifications(params?: ListNotificationsParams): Promise<Page<Notification>>;
  markNotificationRead(notificationId: string): Promise<Notification>;
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
   * `GET /users/me` reports a locked account as `UNSPECIFIED`, because the
   * gateway's `GatewayUserStatus` has no `LOCKED` member and
   * `ValidateAccessTokenResponseDto.status` is an unconstrained string the
   * contract makes no promise about.
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
 * **One caller: the attachments panel** (`src/screens/BoardScreen.tsx`), whose
 * five routes ship in backend PR #147 and are still open. The admin user writes
 * were the original caller and are no longer one — PR #146 deployed all three,
 * so `POST /api/v1/admin/users/not-a-uuid/block` answers `400 INVALID_ARGUMENT`
 * as of 2026-09-08 where it answered this 404 on 2026-08-25, and TAS-196 took
 * that compensation out.
 *
 * Pinned here rather than inline in a component for the reason
 * `SEARCH_QUERY_TOO_SHORT_MESSAGE` is: a gateway string the UI branches on is a
 * measurement, and it belongs where the measurement can be read.
 *
 * The *signature* removes itself; the *code* does not, and this build has now
 * shipped the worked example twice. The day PR #146 deployed the three admin
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
