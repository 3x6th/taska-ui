import type {
  AcceptInvitationInput,
  AddIssueWorklogInput,
  AuthTokens,
  BoardColumnPageParams,
  BoardParams,
  CreateAccessTokenInput,
  ConfirmAttachmentUploadInput,
  ConfirmAvatarUploadInput,
  CreateAttachmentUploadUrlInput,
  CreateAvatarUploadUrlInput,
  CreateIssueInput,
  CreateIssueLinkInput,
  CreateProjectInput,
  CommandRetry,
  CreateProjectIssueTypeInput,
  CreateProjectLabelInput,
  CreateProjectWorkflowInput,
  DeleteProjectIssueTypeInput,
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
  IssueWriteAnswer,
  SearchIssuesParams,
  SearchUsersParams,
  TaskaApi,
  UpdateIssueInput,
  UpdateIssueWorklogInput,
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
  BOARD_CURSOR_PAIR_MESSAGE,
  BOARD_CURSOR_REFUSAL_MESSAGE,
  DIRECTORY_QUERY_REFUSAL_MESSAGE,
  INVITE_DISPLAY_NAME_MAX_LENGTH,
  INVITE_EMAIL_MAX_LENGTH,
  OUTBOX_RETRY_REASON_MAX_LENGTH,
  OUTBOX_RETRY_REASON_TOO_LONG_MESSAGE,
  PROJECT_COLOR_PATTERN,
  SEARCH_QUERY_MIN_LENGTH,
  SEARCH_QUERY_TOO_SHORT_MESSAGE,
  WORKLOG_COMMENT_MAX_LENGTH,
} from "../TaskaApi";
import {
  ATTACHMENT_BUCKET,
  ATTACHMENT_MAX_SIZE_BYTES,
  ATTACHMENT_PRESIGNED_TTL_MS,
  ATTACHMENT_STORE_ORIGIN,
  attachmentRefusal,
  attachmentSizeRefusalMessage,
} from "../attachments";
import { compareBoardIssues } from "../boardOrder";
import { toViewLinkType } from "../linkViewTypes";
import { MEMBER_USER_ID_REFUSAL_MESSAGE, isUserId } from "../members";
import {
  AVATAR_BUCKET,
  AVATAR_GATEWAY_REFUSAL_MESSAGE,
  AVATAR_MAX_SIZE_BYTES,
  AVATAR_MOCK_STORE_ORIGIN,
  AVATAR_PRESIGNED_TTL_MS,
  avatarRefusal,
  avatarSizeRefusalMessage,
} from "../avatars";
import { IssueVersionConflictError, LAST_ADMIN_REASON, PROJECT_ARCHIVED_REASON, type ErrorDetails } from "../errors";
import { blankSummaryRefusal, datesOutOfOrderServerMessage, issueTypePatchRefusal, issueVersionRefusal } from "../issuePatch";
import {
  INVALID_ISSUE_TYPE_KEY_MESSAGE,
  INVALID_REQUEST_PARAMETERS_MESSAGE,
  ISSUE_TYPE_ADMIN_REQUIRED_MESSAGE,
  ISSUE_TYPE_CODE_PATTERN,
  ISSUE_TYPE_DEFAULT_SORT_ORDER,
  ISSUE_TYPE_EMPTY_PATCH_MESSAGE,
  ISSUE_TYPE_INVALID_FIELDS_MESSAGE,
  ISSUE_TYPE_NAME_MAX_LENGTH,
  ISSUE_TYPE_IN_USE_REASON,
  ISSUE_TYPE_NOT_FOUND_MESSAGE,
  INITIAL_STATUS_NOT_IN_WORKFLOW_MESSAGE,
  ISSUE_TYPE_ORDER_REPEATS_MESSAGE,
  ISSUE_TYPES_CHANGED_MESSAGE,
  ISSUE_TYPES_CHANGED_REASON,
  LAST_ISSUE_TYPE_MESSAGE,
  LAST_ISSUE_TYPE_REASON,
  STATUS_KEY_PATTERN,
  STATUS_NOT_IN_TARGET_TYPE_MESSAGE,
  STATUS_NOT_IN_TARGET_WORKFLOW_REASON,
  STATUS_NOT_IN_WORKFLOW_REASON,
  isIssueTypeCode,
  isIssueTypeColor,
  isIssueTypeIcon,
  isIssueTypeShape,
  issueTypeExistsMessage,
  issueTypeInUseMessage,
  issueTypeNotDefinedMessage,
} from "../issueTypes";
import {
  OBJECT_STORE_REJECTED_CODE,
  OBJECT_STORE_UNREACHABLE_CODE,
  ObjectStoreError,
  requireUsableDownloadUrl,
  requireUsableUploadUrl,
} from "../objectStore";
import type { PlanningFields, PlanningFieldsInput } from "../planningFields";
import { emptyPlanningFields, planningFieldRefusal, resolvePlanningFields } from "../planningFields";
import type {
  AccessTokenList,
  ActionVia,
  AdminCatalog,
  AdminFilterOperator,
  AdminRow,
  AdminRowQuery,
  AdminRows,
  AdminRowsQuery,
  AdminTable,
  AuditEntries,
  AuditEntriesQuery,
  AuditEntry,
  AttachmentDownloadUrl,
  AttachmentUploadTicket,
  AvatarUploadTicket,
  Board,
  CreatedProjectIssueType,
  BoardColumn,
  BoardColumnPage,
  BoardIssue,
  DictionaryEntry,
  DirectoryPage,
  EnumDictionaries,
  InvitationResult,
  Issue,
  IssueAttachment,
  IssueComment,
  IssueHistoryEvent,
  IssueLink,
  IssueLinkTypeCode,
  IssuePriorityCode,
  IssueSearchHit,
  IssueStatusKey,
  IssueTypeCode,
  IssueWatcher,
  IssueWatchers,
  IssueWorklog,
  IssueWorklogPage,
  IssueDetails,
  IssueDetailsWithHistory,
  IssuedAccessToken,
  Label,
  Notification,
  NotificationPage,
  NotificationPreferences,
  NotificationPreferencesPatch,
  NotificationType,
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
  ProjectMembership,
  ProjectMemberWriteResult,
  ProjectRole,
  ProjectStats,
  ProjectWorkflowEntry,
  TelegramLink,
  UnwatchIssueResult,
  User,
  UserAvatar,
  UserSummary,
  UserStatus,
  UserStatusChange,
  WatchIssueResult,
  WorkflowDefinition,
  WorkflowStatus,
} from "../../domain/types";
import { isDateOnly } from "../../domain/types";
import { accountLockedMessage } from "../../lib/accountLock";
import { addDays, localDateOnly } from "../../lib/worklog";
import type { AdminColumnClass } from "../../lib/adminColumnTypes";
import { classifyColumnType } from "../../lib/adminColumnTypes";
import { MockAccessTokens } from "./MockAccessTokens";
import { MockNotificationPreferences } from "./MockNotificationPreferences";

/**
 * The seeded avatar's bytes, inline. A 48×48 two-tone PNG of a head and
 * shoulders — not a photograph and not meant to be one; it exists so that an
 * avatar drawn from an image is visibly different from an avatar drawn from a
 * fill and initials.
 */
const SEEDED_AVATAR_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAIAAADYYG7QAAAAoklEQVR42u3XwQ2FMAwDUG/EnSUYmhn+CswBd2h/G1TXQZY8wJMaNQ6WdZMKDDLIoEKO3z4fdCFKmQCqaN6YMEgTNmGcJmbCUE3AlBwU0PSaDPoyKKzpMvnJDOKCvDoybnvFPqTYGBU7teLV4bssxVALfYxafeilpt0EmqbRBKamxQSy5q8JfE3dhCmaiikJiKApmTKAaJpHk0G9ILLmbpIDnTSYWlsbCRnnAAAAAElFTkSuQmCC";

const ANNA_ID = "6d774efa-57d8-4ae0-a27e-2984d1dfbbf6";
const MARK_ID = "e65186a2-b807-42ae-a66f-711be116a93b";
const SOFIA_ID = "16ad2404-96e3-4c51-b00d-55c5d1451d3c";
const TOM_ID = "1ab80365-0843-460a-b0a1-e6dd3e0f2a0d";
const PRIYA_ID = "fdf35fa6-e68b-4dbe-8a48-5867d7f08ce9";
// Added by TAS-186 rather than restyling one of the five above: the Users
// section has to show all account states at once, and moving an existing
// person into INVITED or BLOCKED would have quietly changed what every other
// screen and spec sees on the board.
const LEO_ID = "b0e3d1c4-1f24-4a1a-9a3e-2ad0c9f7b511";
const NINA_ID = "c47a9b21-6d5e-4f0b-8c72-9e13a4f8d602";
// The fourth status, added by TAS-188 on the same rule and for the same reason.
// `LOCKED` is the one state nobody here put an account into: it is where
// auth-service leaves a person who mistyped their password too many times.
const OMAR_ID = "d58f0e73-4b2c-4c9d-8e15-3f6a70b2c9d4";
// A second INVITED account, added by TAS-297 on the same rule: Leo's link still
// works, Ivy's has expired, and those are the two states an invitation answers
// differently (`inviteUser`) — 200 with nothing sent for Leo, 200 with a new
// link queued for Ivy. Neither can be reached by clicking, because a link only
// expires with a week of real time.
const IVY_ID = "e3a7c915-08b2-4d6e-9f41-7c2b5a0d8e63";

const TASKA_PROJECT_ID = "2e74e49f-0f29-4e03-b4ec-adc4dbf2382e";
/** TAS-100, which the seed never holds: the one notification about a deleted issue names it. */
const DELETED_ISSUE_ID = "0c8e5f9a-7d31-4b6e-a2c4-5e9f1b3d7a60";
const WEB_PROJECT_ID = "58e93598-ea1a-460d-9d72-f1f201c310e2";
const MOB_PROJECT_ID = "f315c5cf-3333-47d1-8d22-79f07c2ec99b";
const OPS_PROJECT_ID = "64d70a2b-72b0-4866-bdbf-4f71a416f9e4";

// Mirrors how RestTaskaApi keeps its tokens in localStorage, so a reload behaves
// the same in both modes: the id of the signed-in user, nothing secret.
const SESSION_KEY = "taska.mockSession";

/**
 * The raw invitation tokens this store seeds, by whose they are — what an
 * emailed link would carry after `?token=` (auth-service mints 32 random bytes
 * as unpadded base64url, 43 characters, and stores only their hash). Exported
 * for the tests and the e2e suite, which have no inbox to read them from: the
 * server never returns a token, and neither does this store's `inviteUser`.
 *
 * Leo's works until a week after it was made; Ivy's ran out two days ago, so
 * accepting it is the 401 "Invalid or expired token".
 */
export const MOCK_INVITE_TOKENS = {
  leo: "Lk3vQ9xW2mTz8RbN4cYp7HfJ1sDg6EaU5oKiVwXqZrM",
  ivy: "Iv7yPq2Wd9Lm4Xs8Tb1Nc6Hf3Rg5Ja0Ku2Ze7Oy9Qvw",
} as const;

/**
 * `jwt.invite-token-ttl` and `invitation.resend-cooldown`, both at auth-service's
 * defaults (7d and 1m, develop `e8a8d316b326`). Copied rather than chosen: the
 * deadline is the whole content of the sentence an invitation is confirmed
 * with, and the minute is what a 429 counts down from.
 */
const INVITE_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const INVITE_RESEND_COOLDOWN_MS = 60 * 1000;

/**
 * One invitation link as auth-service's `invite_tokens` row holds it, with the
 * raw token where the server keeps a hash. `usedAt` is set both by a
 * successful activation and by a newer invitation revoking it
 * (`revokeUnusedForUser` writes the same column), which is why the server — and
 * this store — cannot tell "used" from "replaced" afterwards, and the 401 says
 * neither.
 */
interface MockInviteToken {
  token: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
  usedAt: number | null;
}

/** `Character.isISOControl` — C0, DEL and C1 — which both directory checks refuse. */
const hasIsoControl = (value: string): boolean =>
  [...value].some((char) => {
    const code = char.codePointAt(0) ?? 0;
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
  });

/**
 * A rough reading of Hibernate Validator's `@Email`, which auth-service's
 * `DirectoryInput.email` applies to the trimmed, lower-cased address: dotted
 * atoms, one `@`, dotted domain labels — a domain without a dot passes, as it
 * does there. **Read off the validator's documented grammar, not measured**;
 * an address it and the server judge differently is possible, and the server
 * is the judge.
 */
const MOCK_EMAIL_PATTERN =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~\u0080-\uffff-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~\u0080-\uffff-]+)*@[a-z0-9\u0080-\uffff](?:[a-z0-9\u0080-\uffff-]*[a-z0-9\u0080-\uffff])?(?:\.[a-z0-9\u0080-\uffff](?:[a-z0-9\u0080-\uffff-]*[a-z0-9\u0080-\uffff])?)*$/u;

/**
 * What this store says when a project write states a colour the contract's
 * pattern rejects. **This store's wording, not the gateway's** — nothing in the
 * backend repository was read for it, and a Spring validation message is not a
 * string this build has measured. Named so a reader does not take it for one.
 *
 * The refusal itself *is* the contract: `PROJECT_COLOR_PATTERN` is what
 * `CreateProjectRequestDto` and `UpdateProjectRequestDto` declare, so a colour
 * failing it is a 400 on the wire whatever the sentence turns out to say.
 */
const PROJECT_COLOR_REFUSAL = "Project colour must be a six-digit hex value like #0052CC";

/**
 * And when a rename asks for a name the schema cannot hold. Same standing as
 * the sentence above: the bounds (`minLength: 1`, `maxLength: 255`) are the
 * contract's, the words are this store's.
 */
const PROJECT_NAME_MAX_LENGTH = 255;
const PROJECT_NAME_REFUSAL = `Project name must be 1 to ${PROJECT_NAME_MAX_LENGTH} characters`;

/** `maxLength: 2000` on both project DTOs. A blank description is legal; a long one is not. */
const PROJECT_DESCRIPTION_MAX_LENGTH = 2000;
const PROJECT_DESCRIPTION_REFUSAL = `Project description must be at most ${PROJECT_DESCRIPTION_MAX_LENGTH} characters`;

const WORKFLOW_ID = "11111111-1111-1111-1111-111111111111";
const TODO_STATUS_ID = "22222222-2222-2222-2222-222222222222";
const IN_PROGRESS_STATUS_ID = "33333333-3333-3333-3333-333333333333";
const DONE_STATUS_ID = "44444444-4444-4444-4444-444444444444";
/**
 * An account as this store holds it: its status is one of the four it can
 * write, never the open code `User.status` admits off the wire (TAS-173) — the
 * store is the server here, and a server knows its own states.
 */
type StoredUser = User & { status: UserStatus };

/** The extra status of WEB's EPIC workflow (TAS-173) — a key this build has no word for. */
const IN_REVIEW_STATUS_ID = "45454545-4545-4545-4545-454545454545";
const EPIC_WORKFLOW_ID = "12121212-1212-1212-1212-121212121212";
/** Mobile's INCIDENT workflow, which has no To Do, and its two statuses. */
const INCIDENT_WORKFLOW_ID = "13131313-1313-1313-1313-131313131313";
const TRIAGE_STATUS_ID = "13131313-1313-1313-1313-1313131313a1";
const RESOLVED_STATUS_ID = "13131313-1313-1313-1313-1313131313a2";

/**
 * One `GET /meta` pair as the gateway serialises it: `selectable` is on every
 * pair, `true` by the generated DTO's default and `false` only where
 * `MetaServiceImpl` says so.
 */
const pair = (code: string, name: string, selectable = true): DictionaryEntry => ({ code, name, selectable });

/**
 * `GET /meta` as the stand answers it since backend #201 (TAS-264, develop
 * `e8a8d316b326`, `MetaServiceImpl`): every code of the contract's enums in the
 * contract's order, each named in English, each with `selectable` — `false` for
 * the four placeholders, `UNKNOWN`, `UNSPECIFIED`,
 * `ISSUE_LINK_VIEW_TYPE_UNSPECIFIED` and `UNRECOGNIZED`. `issueTypes` is
 * exactly TASK, BUG and STORY, as `MetaServiceImpl` names them: since backend
 * #212 a project's types are its registry (`issueTypesByProject` below), and
 * `/meta` only names the three seeds — the UI reads it for nothing but a
 * global-search hit whose project context is not cached (DESIGN.md §6).
 * Plus one priority this build does not know, so the frontend's answer to a
 * value the backend adds before the frontend ships can be clicked through
 * (TAS-173): `URGENT`, named in Russian, which the UI prints as the code. That
 * one is the e2e witness of the Cyrillic check DESIGN.md §6 keeps for good: the
 * stand no longer sends a Russian name, and the guard is only seen working if
 * something here still does. It is a real value in this store — a listed
 * priority is accepted — which is what a backend that served it would do.
 *
 * `linkViewTypes` is spelled as the wire spells it, prefix and placeholders
 * included, and `getMeta` reads it back through the rest leg's own reading
 * (`toViewLinkType`, src/api/linkViewTypes.ts) — so the mock and the rest leg
 * hand the client the same stripped codes for the same answer.
 */
const META: EnumDictionaries = {
  issueTypes: [pair("TASK", "Task"), pair("BUG", "Bug"), pair("STORY", "Story")],
  priorities: [pair("LOW", "Low"), pair("MEDIUM", "Medium"), pair("HIGH", "High"), pair("URGENT", "Срочный")],
  linkTypes: [pair("BLOCKS", "Blocks"), pair("RELATES_TO", "Relates to"), pair("DUPLICATES", "Duplicates")],
  linkViewTypes: [
    pair("ISSUE_LINK_VIEW_TYPE_UNSPECIFIED", "Unspecified", false),
    pair("ISSUE_LINK_VIEW_TYPE_RELATES_TO", "Relates to"),
    pair("ISSUE_LINK_VIEW_TYPE_BLOCKS", "Blocks"),
    pair("ISSUE_LINK_VIEW_TYPE_IS_BLOCKED_BY", "Is blocked by"),
    pair("ISSUE_LINK_VIEW_TYPE_DUPLICATES", "Duplicates"),
    pair("ISSUE_LINK_VIEW_TYPE_IS_DUPLICATED_BY", "Is duplicated by"),
    pair("UNRECOGNIZED", "Unrecognized", false),
  ],
  notificationTypes: [
    pair("ISSUE_ASSIGNED", "Issue assigned"),
    pair("ISSUE_TRANSITIONED", "Issue status changed"),
    pair("ISSUE_CREATED", "Issue created"),
    pair("ISSUE_UPDATED", "Issue updated"),
    pair("ISSUE_DELETED", "Issue deleted"),
    pair("USER_INVITED", "User invited"),
    pair("USER_ACTIVATED", "User activated"),
    pair("PROJECT_CREATED", "Project created"),
    pair("PROJECT_ARCHIVED", "Project archived"),
    pair("MEMBER_ADDED", "Member added"),
    pair("MEMBER_UPDATED", "Member role changed"),
    pair("MEMBER_REMOVED", "Member removed"),
    pair("ISSUE_LINK_CREATED", "Issue link created"),
    pair("ISSUE_LINK_DELETED", "Issue link deleted"),
    pair("LABEL_ADDED", "Label added"),
    pair("LABEL_REMOVED", "Label removed"),
    pair("USER_BLOCKED", "User blocked"),
    pair("USER_UNBLOCKED", "User unblocked"),
    pair("PERSONAL_ACCESS_TOKEN_CREATED", "Personal access token created"),
    pair("PERSONAL_ACCESS_TOKEN_REVOKED", "Personal access token revoked"),
    pair("ISSUE_COMMENT_CREATED", "Issue comment created"),
    pair("ISSUE_COMMENT_UPDATED", "Issue comment updated"),
    pair("ISSUE_COMMENT_DELETED", "Issue comment deleted"),
    pair("ISSUE_ATTACHMENT_ADDED", "Issue attachment added"),
    pair("ISSUE_ATTACHMENT_DELETED", "Issue attachment deleted"),
    pair("UNKNOWN", "Unknown", false),
  ],
  userStatuses: [
    pair("INVITED", "Invited"),
    pair("ACTIVE", "Active"),
    pair("BLOCKED", "Blocked"),
    pair("LOCKED", "Locked"),
    pair("UNSPECIFIED", "Unspecified", false),
  ],
};

/**
 * A request value the dictionary does not list is refused the way develop
 * refuses it on all three paths this store checks — create, edit and link: the
 * request DTOs bind priority and link type to their enums, so an unlisted value
 * fails decoding before any mapper runs, and `GatewayValidationExceptionHandler`
 * answers 400 `INVALID_ARGUMENT` "Invalid request parameters" for that
 * `ServerWebInputException` (api-contract-guard, TAS-173). The list here is
 * the served one, so this store accepts exactly what it tells the client is
 * selectable.
 */
function requireListed(dictionary: readonly DictionaryEntry[] | null, value: string): void {
  if (!dictionary?.some((entry) => entry.code === value)) {
    throw new MockApiError("INVALID_ARGUMENT", "Invalid request parameters");
  }
}

/**
 * File names that steer this mock down a failure branch, matched
 * case-insensitively as a substring of the name. **A mock-only seam** — one of
 * two in this file, with `MOCK_PROJECT_TRIGGERS` below — but the alternative was a feature whose four
 * interesting failures could not be reached by anybody, in the one environment
 * where the feature can be reached at all.
 *
 * Three of the four are unreachable by any other means today. The middle leg of
 * an upload goes to an object store that is not deployed, is not CORS-configured
 * and has no browser-reachable address, so "the store refused it", "the store
 * could not be reached" and "the link expired" cannot be produced by using the
 * product — and the fourth, a confirm that fails after the bytes landed, is the
 * one that orphans an object and states the most important sentence in the
 * panel.
 *
 * Triggering on the file name rather than on a flag keeps the seam out of the
 * production API surface: nothing on `TaskaApi` grows a test parameter, and a
 * reader can exercise a failure by renaming a file on their desktop.
 */
export const MOCK_ATTACHMENT_TRIGGERS = {
  /** Leg 2 rejects with no response at all, the way a blocked CORS preflight does. */
  storeUnreachable: "cors-blocked",
  /** Leg 2 answers 500. */
  storeRefused: "store-500",
  /** Leg 1 mints a ticket that is already past its fifteen minutes, so leg 2 answers 403. */
  expiredTicket: "expired-link",
  /** Legs 1 and 2 succeed and leg 3 fails — the case that orphans an object. */
  confirmFails: "confirm-fails",
  /**
   * The upload works, and the later GET of the bytes (`getAttachmentBytes`)
   * rejects with no response — the shape a store without CORS for GET would
   * give — so "Download" has to fall back to opening the link (TAS-253).
   */
  downloadBlocked: "download-blocked",
  /**
   * **Avatar only.** All three legs succeed and the confirm answers with its
   * link as the server does; then the object is dropped from the bucket, so
   * the saved row points at nothing — storage losing the object behind a
   * saved row: a bucket restored without it, an operator's delete. No confirm
   * can leave a row that way any more (backend PR #198, TAS-221, which closed
   * the cross-user and same-key paths that used to), so this trigger is the
   * only way to see the state. From then on `GET /users/me` answers
   * `avatar: null, avatarUnavailable: true` until an upload replaces the row
   * or a removal deletes it (backend PR #193). No new answer shape: it is the
   * state `currentUserProfile` already reads for a lost object.
   */
  avatarObjectLost: "object-lost",
} as const;

// The avatar upload reads the same four failure names out of the same
// `uploadBehaviourFor`, so a file called `cors-blocked.png` fails the middle leg
// there too, and `expired-link` is honoured by both. Named after attachments
// because that is where they were written and where three of the four are
// demonstrated; a second, identical table under a second name would be two
// things to keep in step for no reader's benefit. `avatarObjectLost` is the one
// entry the other way round: only the avatar confirm reads it, and an
// attachment called `object-lost.txt` uploads like any other file.

type MockUploadBehaviour = "ok" | "storeUnreachable" | "storeRefused" | "confirmFails";

/** One presigned upload this mock has handed out and is still willing to honour. */
interface MockUploadTicket {
  objectKey: string;
  issueId: string;
  projectId: string;
  /** Exactly the value signed at leg 1. Leg 2 compares byte for byte, as S3 does. */
  contentType: string;
  /** Epoch ms. Past it, leg 2 answers 403 — the store's answer for a stale signature. */
  expiresAt: number;
  behaviour: MockUploadBehaviour;
}

/** An object that has actually been PUT into this mock's stand-in bucket. */
interface MockStoredObject {
  contentType: string;
  sizeBytes: number;
  checksum: string;
  /**
   * What was PUT, kept so a later download hands back the very bytes that
   * were uploaded (TAS-253) — which is what makes "Download" in mock mode a
   * round trip rather than a placeholder.
   */
  bytes: Uint8Array;
}

/**
 * One presigned **download** link this mock has handed out. Keyed by the URL,
 * like the upload tickets, so `getAttachmentBytes` honours only links this
 * store signed — and a link signed for a row that was deleted since still
 * resolves, as a presigned link on a real store would: it names an object,
 * and a soft delete does not touch the object.
 */
interface MockDownloadTicket {
  objectKey: string;
  fileName: string;
  contentType: string;
  /** Epoch ms. Past it, the store answers 403. */
  expiresAt: number;
}

/**
 * One presigned **avatar** upload this mock has handed out. Separate from
 * `MockUploadTicket` above, and the separation is the point: an avatar ticket
 * is minted by a different route family against a different bucket, and a mock
 * that honoured either link on either leg would let a caller cross the two
 * without anything noticing.
 */
interface MockAvatarTicket {
  objectKey: string;
  userId: string;
  /** Exactly the value signed at leg 1. Leg 2 compares byte for byte, as S3 does. */
  contentType: string;
  /** Epoch ms. Past it, leg 2 answers 403 — the store's answer for a stale signature. */
  expiresAt: number;
  behaviour: MockUploadBehaviour;
  /** `MOCK_ATTACHMENT_TRIGGERS.avatarObjectLost`: the confirm succeeds, then the object is dropped. */
  objectLost: boolean;
}

/**
 * The sentence `ProfileServiceImpl.confirmAvatarUpload` refuses a key with, at
 * backend develop `398285cde074` (PR #198, TAS-221): one sentence, and one
 * `NOT_FOUND`, for a key that is not the caller's and for one of theirs with
 * no object behind it — so the answer does not say whose a key is.
 */
const AVATAR_KEY_NOT_FOUND_MESSAGE = "An object with this key was not found in the storage.";

/** A UUID as Java's `UUID.toString()` prints one: lowercase, canonical, nothing around it. */
const CANONICAL_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Whether leg 1 minted `objectKey` for `userId`: `avatars/{userId}/{uuid}`.
 * `verifyAvatarKeyOwner` parses the suffix and compares its `toString()` back
 * to it, so only the canonical spelling counts — an upper-case or otherwise
 * re-spelt UUID names the same value and is still not a key it handed out.
 */
function avatarKeyMintedFor(userId: string, objectKey: string): boolean {
  const prefix = `avatars/${userId}/`;
  return objectKey.startsWith(prefix) && CANONICAL_UUID_PATTERN.test(objectKey.slice(prefix.length));
}

/**
 * A user's avatar as this store holds it, which is `AvatarResponseDto` plus the
 * one thing a real store keeps and a metadata row does not: the bytes.
 *
 * `downloadUrl` is a **`data:` URL built from what was actually PUT**, and that
 * is a deliberate divergence from the gateway, which signs an `https` link
 * against MinIO. The reason is that this mock has no server to serve bytes
 * back from: a presigned-looking link to `127.0.0.1:9000` would 404 in every
 * environment anybody actually opens this in, so mock mode could demonstrate
 * uploading an avatar and never demonstrate *having* one — and the e2e suite,
 * which is mock-backed by construction, could not tell a picture that replaced
 * the initials from one that failed to load and fell back to them.
 *
 * Nothing reads the URL's shape. `Avatar` puts it in an `<img src>` and falls
 * back to initials when it does not load, which is the same code path either
 * way.
 */
interface MockAvatar {
  id: string;
  userId: string;
  objectKey: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  downloadUrl: string;
}

interface StoredAttachment {
  id: string;
  issueId: string;
  uploadedBy: string;
  objectKey: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  checksum: string;
  createdAt: string;
  /** Soft delete, like the server's: the row stays and stops being listed. */
  deletedAt: string | null;
}

/**
 * An ETag-shaped checksum: 32 lowercase hex characters, deterministic in the
 * bytes. **Not MD5** — the server's value is the object's real ETag and this is
 * an FNV-1a variant, because nothing in the product compares one to the other
 * and shipping a hash implementation to make a mock's field look authentic
 * would be code with no reader. What matters is that it is stable for the same
 * bytes and different for different ones, which is what any consumer of a
 * checksum relies on.
 */
const mockChecksum = (bytes: Uint8Array) => {
  let out = "";
  for (let round = 0; round < 4; round += 1) {
    let hash = 0x811c9dc5 ^ (round * 0x01000193);
    for (let i = 0; i < bytes.length; i += 1) {
      hash ^= bytes[i];
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    out += hash.toString(16).padStart(8, "0");
  }
  return out;
};

/**
 * A second actor for a single-page store (TAS-149). A comment whose body holds
 * this text makes the store archive the comment's project first — as another
 * ADMIN of it would, in another session, a moment before — and then answer the
 * comment as the server answers any write on an archived project: the archived
 * refusal. It is the only way to see, in mock mode, a board that turns
 * read-only under its reader (DESIGN.md §5.7, «Архив пришёл отказом записи»):
 * this store's every archive otherwise comes from the reader's own Edit
 * project, which tells the board at once. Same seam as the attachment triggers
 * above — text the reader can type, nothing on `TaskaApi`.
 */
export const MOCK_PROJECT_TRIGGERS = {
  archivedMeanwhile: "[archived meanwhile]",
  /**
   * In a comment: another member changes the comment's issue — its priority,
   * one step on — just before the reader's next transition of it, as they would
   * in another session after this panel read it. The transition then meets a
   * version the panel never saw: the 409 `ABORTED` of backend TAS-422, which
   * this store otherwise cannot produce for a reader alone.
   */
  changedMeanwhile: "[changed meanwhile]",
  /**
   * In a project description: every other admin of the project steps down to
   * MEMBER, as they would in another session. The members dialog keeps the
   * list it read, so the reader's own step down meets the last-admin refusal
   * (backend TAS-394) — the stale list that refusal exists for.
   */
  adminsLeftMeanwhile: "[admins left meanwhile]",
  /**
   * In an issue type's name: another admin adds a type to the project, as they
   * would in another session, just before the reader's next move in Issue
   * types. The move then sends a set that is no longer the registry's — the
   * 409 `ABORTED` `ISSUE_TYPES_CHANGED` of backend TAS-429, which this store
   * otherwise cannot produce for a reader alone. Once: the type it adds stays.
   */
  issueTypesChangedMeanwhile: "[types changed meanwhile]",
  /**
   * In a project description: every column page of the project refuses —
   * issue-service unavailable, 503 — once the access check has passed. Both
   * «Show more» and a re-read of an expanded column's tail meet it (DESIGN.md
   * §4.9, «Отказ», «Перечитывание»); the board read itself still answers.
   */
  columnPagesRefused: "[pages refused]",
  /**
   * In the name a pending-able command carries — a new or edited workflow's
   * name on a binding change, a new type's name, the deleted type's name on a
   * delete: the server accepts the command and has not finished it when it
   * answers — 503 `UNAVAILABLE` with `WORKFLOW_BINDING_CHANGE_PENDING`,
   * `ISSUE_TYPE_CREATION_PENDING` or `ISSUE_TYPE_DELETION_PENDING` and an
   * `X-Request-Id` (backend TAS-433, TAS-436, TAS-437). As on the server, the
   * command is carried out all the same; the same command sent again with that
   * id answers what it did, once, and the same id with another command is 409
   * `ALREADY_EXISTS`. Only the first send of a command meets it.
   */
  stillApplying: "[still applying]",
  /**
   * In a workflow's name — the one a workflow write would leave it with: a type
   * operation of the project is still pending, so every workflow write is 409
   * `ABORTED`, `details.reason` `ISSUE_TYPE_OPERATION_PENDING`
   * (`WorkflowWriteFence`), whatever else it asks.
   */
  typeOperationPending: "[types busy]",
} as const;

/**
 * The years `BoardServiceImpl.listBoardColumnIssues` takes a cursor instant
 * from — 0001-01-01 to 9999-12-31 UTC, in its epoch seconds, as milliseconds.
 */
const CURSOR_EARLIEST_MS = -62135596800 * 1000;
const CURSOR_LATEST_MS = 253402300799 * 1000;

/**
 * The payload fields a history event names people by, as issue-service reads
 * them for `participants` (`HistoryParticipants.ids`, backend TAS-431 at
 * `cbd3f0af`), plus the `watcherIds` array.
 */
const HISTORY_PARTICIPANT_FIELDS = [
  "previousAssigneeId",
  "assigneeId",
  "reporterId",
  "authorUserId",
  "uploadedBy",
  "createdBy",
  "deletedBy",
  "deletedByUserId",
] as const;

/** The code of the type `issueTypesChangedMeanwhile` has another admin add. */
const TYPE_ADDED_ELSEWHERE = "ADDED_ELSEWHERE";

/**
 * The bytes that were PUT, as something an `<img>` can actually draw — see
 * `MockAvatar` for why this store hands back a `data:` URL where the gateway
 * signs an `https` one.
 *
 * Chunked rather than `btoa(String.fromCharCode(...bytes))`: spreading a
 * megabyte-scale array into an argument list overflows the call stack, and the
 * ceiling this feature allows is two megabytes.
 */
const dataUrlFor = (bytes: Uint8Array, contentType: string) => {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${contentType};base64,${btoa(binary)}`;
};

/** Which failure this file name asks for, or a plain upload. */
const uploadBehaviourFor = (fileName: string): MockUploadBehaviour => {
  const name = fileName.toLowerCase();
  if (name.includes(MOCK_ATTACHMENT_TRIGGERS.storeUnreachable)) return "storeUnreachable";
  if (name.includes(MOCK_ATTACHMENT_TRIGGERS.storeRefused)) return "storeRefused";
  if (name.includes(MOCK_ATTACHMENT_TRIGGERS.confirmFails)) return "confirmFails";
  return "ok";
};

class MockApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    /**
     * `RestErrorResponse.details` (backend PR #199): `null` on every refusal
     * but the two the server fills it for — the account lock's `lockedUntil`,
     * and an archived project's `reason: "PROJECT_ARCHIVED"` (backend PR #159).
     */
    public readonly details: ErrorDetails | null = null,
    /**
     * The `X-Request-Id` of the answer — carried only by the 503 of a pending
     * command (`MOCK_PROJECT_TRIGGERS.stillApplying`), because that is the one
     * refusal whose id the client sends back (`CommandRetry`). Every other
     * mock refusal has none, as before.
     */
    public readonly requestId?: string,
  ) {
    super(message);
  }
}

const now = () => new Date().toISOString();

/**
 * The archived refusal's sentence as the merged backend PR #159 words it. Kept
 * for fidelity only: no reader matches it — `details.reason` is the key
 * (`isProjectArchived`), and the UI prints its own sentence in its place.
 */
const PROJECT_ARCHIVED_MESSAGE = "Project is archived";

const clone = <T>(value: T): T => structuredClone(value);

/**
 * `AUTH_SECURITY_LOCK_DURATION`, 15m in
 * `auth-service/src/main/resources/application.yml`. Copied rather than
 * guessed, because the number is the whole content of the sentence `login`
 * refuses a locked account with, and a mock that invents a different wait is a
 * mock that teaches the wrong thing about the server.
 */
const CREDENTIAL_LOCK_DURATION_MS = 15 * 60 * 1000;

const wait = async <T>(value: T, ms = 140): Promise<T> =>
  new Promise((resolve) => {
    window.setTimeout(() => resolve(clone(value)), ms);
  });

/** The largest `format: int32` value — what the gateway's parameter binding can hold. */
const INT32_MAX = 2147483647;

const makeId = (prefix: string) => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

/** The accounts `GET /users` lists (`UserRepository.searchDirectory`): never a `BLOCKED` one. */
const DIRECTORY_STATUSES: ReadonlySet<string> = new Set(["ACTIVE", "INVITED", "LOCKED"]);

/** A fresh link token in the shape auth-service mints: 32 random bytes, unpadded base64url. */
const mockInviteToken = (): string => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/**
 * auth-service's `PasswordValidator` at its default policy (min 8 and max 128
 * code points, at most 72 UTF-8 bytes, an upper-case letter, a digit and a
 * character that is neither a letter, a digit nor whitespace), in its order and
 * its words — or `null` for a password it accepts. `\p{Lu}` and `\p{Nd}` stand
 * in for Java's `isUpperCase` and `isDigit`; they agree on every character a
 * person types.
 */
function passwordPolicyRefusal(password: unknown): string | null {
  if (typeof password !== "string" || password.trim() === "") return "Password is required";
  const length = [...password].length;
  if (length < 8 || length > 128) return "Password must be at least 8 characters and not exceed 128 characters";
  if (new TextEncoder().encode(password).length > 72) return "Password exceeds the BCrypt limit of 72 UTF-8 bytes";
  if (!/\p{Lu}/u.test(password)) return "Password must have at least 1 upper character";
  if (!/\p{Nd}/u.test(password)) return "Password must have at least 1 digit character";
  if (![...password].some((char) => !/[\p{L}\p{Nd}\s]/u.test(char))) return "Password must have at least 1 special character";
  return null;
}

/**
 * A canonical lowercase UUID **always** — what Java's `UUID.randomUUID()`
 * prints — for the one place a check reads the shape back: an avatar key
 * (`avatarKeyMintedFor`). `makeId` falls back to a prefixed string where
 * `crypto.randomUUID` is missing, which is any page served over plain HTTP
 * from somewhere other than localhost; a key in that shape would be refused by
 * the very check it was minted for.
 */
const mockUuid = (): string => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16));
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const text = hex.join("");
  return `${text.slice(0, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-${text.slice(16, 20)}-${text.slice(20)}`;
};

const byCreatedAt = <T extends { createdAt: string }>(a: T, b: T) =>
  new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();

/**
 * Code-unit order, for a tiebreak on ids: how PostgreSQL orders a `uuid`
 * column — by its bytes — comes out the same as comparing lowercase hex text.
 */
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * `name asc, id asc` — the order both label reads declare since backend PR
 * #200, names compared "by the database's collation". The contract does not
 * name the collation, so this only approximates it: `localeCompare` with the
 * locale pinned to `"en"`, which orders case and accents the way a typical
 * `en_US.UTF-8` database does and — pinned — the same way in every browser
 * this mock runs in, where the runtime's default locale would not.
 */
const byLabelName = <T extends { name: string; id: string }>(a: T, b: T) =>
  a.name.localeCompare(b.name, "en") || byText(a.id, b.id);

/**
 * The search query as the gateway would accept it, or `null` for "the caller
 * asked for no text filter at all".
 *
 * Absent and empty are different answers on this route and must stay different
 * here: omitting `query` is a `200` with everything, `query=` is a `400`. So an
 * empty string is a rejected query rather than a quiet "everything" — the trap
 * that catches an implementation which sets the parameter on every keystroke.
 *
 * Two refusals, in two voices. A **raw** value under the minimum, the empty
 * one included, is the gateway's: it binds `minLength: 3` from the contract and
 * answers "Invalid request parameters" before sign-in (probed 2026-10-19, see
 * `SEARCH_QUERY_MIN_LENGTH`); issue-service's own check counts the same raw
 * characters and is never reached. Then a value that is long enough raw but
 * not once trimmed — `"ab "` — is refused in the **client's** words
 * (`SEARCH_QUERY_TOO_SHORT_MESSAGE`), because that is what `RestTaskaApi`
 * does before sending; the server itself would search the padded text and
 * find nothing. The trimmed value is what gets searched.
 */
const requireSearchQuery = (raw: string | undefined): string | null => {
  if (raw === undefined) return null;
  if (raw.length < SEARCH_QUERY_MIN_LENGTH) {
    throw new MockApiError("INVALID_ARGUMENT", "Invalid request parameters");
  }
  const query = raw.trim();
  if (query.length < SEARCH_QUERY_MIN_LENGTH) {
    throw new MockApiError("INVALID_ARGUMENT", SEARCH_QUERY_TOO_SHORT_MESSAGE);
  }
  return query;
};

/**
 * The reason all three admin user writes require, checked the way the server
 * checks it: blank first, then `@Size(max = 550)`.
 *
 * The blank half is not `@NotBlank` on the backend — the generated DTO gets
 * `@Size(min = 1)` from the contract's `minLength`, which a single space
 * satisfies, and the refusal actually comes from
 * `GrpcRequestValidators.requireNonBlankOrInvalidArgument` a layer deeper. The
 * answer is the same `400 INVALID_ARGUMENT` either way, which is why this
 * measures the trimmed value — and the length is measured on it too, so a
 * reason that is 550 characters of text plus a trailing newline is accepted
 * rather than refused on a character nobody typed on purpose.
 *
 * Nothing in the UI can produce an over-long one (the field carries
 * `maxLength`), so the length half exists for the same reason the mock refuses
 * a non-uuid row id: a hand-made call has to hit the same wall in both modes.
 * `requireAdminWriteReason` in src/api/rest/RestTaskaApi.ts is the other half
 * of that sentence and checks both bounds identically — this used to be the
 * only side that capped, which meant a 600-character reason was refused here
 * and sent there.
 */
const requireAdminWriteReason = (raw: string): string => {
  const reason = raw.trim();
  if (reason === "") {
    throw new MockApiError("INVALID_ARGUMENT", ADMIN_WRITE_REASON_REQUIRED_MESSAGE);
  }
  if (reason.length > ADMIN_WRITE_REASON_MAX_LENGTH) {
    throw new MockApiError("INVALID_ARGUMENT", ADMIN_WRITE_REASON_TOO_LONG_MESSAGE);
  }
  return reason;
};

/**
 * The same guard for the outbox retry, whose contract states a **different**
 * upper bound: `maxLength: 1000` against the user writes' 550.
 *
 * Separate rather than parameterised, exactly as `requireOutboxRetryReason` in
 * src/api/rest/RestTaskaApi.ts is separate and for the same reason: one function
 * taking a limit would read as one rule the backend applies twice, and the
 * backend applies two rules. The blank half is genuinely shared — `minLength: 1`
 * on all four DTOs — so it keeps the shared sentence.
 */
const requireOutboxRetryReason = (raw: string): string => {
  const reason = raw.trim();
  if (reason === "") {
    throw new MockApiError("INVALID_ARGUMENT", ADMIN_WRITE_REASON_REQUIRED_MESSAGE);
  }
  if (reason.length > OUTBOX_RETRY_REASON_MAX_LENGTH) {
    throw new MockApiError("INVALID_ARGUMENT", OUTBOX_RETRY_REASON_TOO_LONG_MESSAGE);
  }
  return reason;
};

/**
 * The planning-field refusals, decided in src/api/planningFields.ts so that this
 * side and `RestTaskaApi` cannot drift, and thrown here with the same code and
 * sentence. All of them are decided by the input alone; the date that clashes
 * with a *stored* one is `updateIssue`'s to refuse, after its version check, as
 * the server does.
 */
const requirePlanningFields = (input: PlanningFieldsInput): void => {
  const refusal = planningFieldRefusal(input);
  if (refusal) {
    throw new MockApiError(refusal.code, refusal.message);
  }
};

/**
 * The id a member write names, as the server would hold it — or the refusal
 * `requireMemberUserId` in src/api/rest/RestTaskaApi.ts throws for the same
 * input, with the same code and the same sentence, before anything is looked
 * up. Lower-cased on the way in because that is what the server's own parse
 * does: `UUID.fromString` accepts either case and the stored form, which every
 * later read answers with, is lower-case. So an upper-case id finds the row a
 * lower-case one would, here as there.
 */
const memberWriteId = (userId: string): string => {
  if (!isUserId(userId)) {
    throw new MockApiError("INVALID_ARGUMENT", MEMBER_USER_ID_REFUSAL_MESSAGE);
  }
  return userId.toLowerCase();
};

/**
 * The registry every project is created with — `ProjectIssueTypeRepository`'s
 * seed (backend #212), which the migration also backfilled into every project
 * that existed before it — in the plain look backend TAS-432 gives it (PR
 * #256, migration 0003): TASK and STORY squares, BUG a circle, none with an
 * icon. A project created at runtime here gets exactly this.
 */
const SEED_ISSUE_TYPES: readonly ProjectIssueType[] = [
  { code: "TASK", name: "Task", color: "blue", shape: "square", icon: null, sortOrder: 10 },
  { code: "BUG", name: "Bug", color: "red", shape: "circle", icon: null, sortOrder: 20 },
  { code: "STORY", name: "Story", color: "green", shape: "square", icon: null, sortOrder: 30 },
];

/**
 * A registry in the server's order: `sortOrder`, then `code` byte-wise
 * (`ORDER BY sort_order, code COLLATE "C"`, backend TAS-418) — which a
 * code-unit compare of upper-case ASCII keys is exactly.
 */
const byRegistryOrder = (a: ProjectIssueType, b: ProjectIssueType) =>
  a.sortOrder - b.sortOrder || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0);

/** A workflow's statuses as its repository reads them (`ORDER BY sort_order`). */
const statusesInSortOrder = (statuses: readonly WorkflowStatus[]) => [...statuses].sort((a, b) => a.sortOrder - b.sortOrder);

/**
 * A request body as the gateway reads it off the wire: a key whose value is
 * `undefined` is not sent at all (`JSON.stringify` drops it), so it is absent
 * here too — which is what keeps "leave it" and "remove the icon" apart.
 */
const sentKeys = (body: Record<string, unknown>) => Object.keys(body).filter((key) => body[key] !== undefined);

/**
 * `CreateProjectIssueTypeRequestDto` as the gateway reads it (`useValidation=
 * true`; backend TAS-432): the colour, the shape and the icon are enums, so a
 * value outside its set fails deserialization, as does an explicit `null`
 * shape (`Nulls.FAIL`); a missing or `null` icon is a type without one, and a
 * missing shape the service's `square`.
 */
const isIssueTypeCreateBody = (input: unknown): input is CreateProjectIssueTypeInput => {
  if (typeof input !== "object" || input === null) return false;
  const body = input as Record<string, unknown>;
  const allowed = ["code", "name", "color", "shape", "icon", "sortOrder", "workflowId"];
  return (
    sentKeys(body).every((key) => allowed.includes(key)) &&
    // `workflowId` is a UUID, and `null` is refused (backend TAS-437).
    (body.workflowId === undefined || (typeof body.workflowId === "string" && UUID_PATTERN.test(body.workflowId))) &&
    isIssueTypeCode(body.code) &&
    typeof body.name === "string" &&
    body.name.trim() !== "" &&
    body.name.length <= ISSUE_TYPE_NAME_MAX_LENGTH &&
    isIssueTypeColor(body.color) &&
    (body.shape === undefined || isIssueTypeShape(body.shape)) &&
    (body.icon === undefined || body.icon === null || isIssueTypeIcon(body.icon)) &&
    (body.sortOrder === undefined || (isInt32(body.sortOrder) && body.sortOrder >= 0))
  );
};

/**
 * `DeleteProjectIssueTypeRequestDto` as the gateway reads it (backend TAS-433,
 * `additionalProperties: false`): `moveIssuesTo` an `IssueTypeDto` code,
 * `statusMappings` status keys onto status keys, `expectedGeneration` a UUID;
 * anything else, `null` included, is "Invalid request parameters".
 */
const isIssueTypeDeleteBody = (input: unknown): input is DeleteProjectIssueTypeInput => {
  if (typeof input !== "object" || input === null) return false;
  const body = input as Record<string, unknown>;
  const allowed = ["moveIssuesTo", "statusMappings", "expectedGeneration"];
  const mapping = body.statusMappings;
  return (
    sentKeys(body).every((key) => allowed.includes(key)) &&
    (body.moveIssuesTo === undefined || isIssueTypeCode(body.moveIssuesTo)) &&
    (body.expectedGeneration === undefined ||
      (typeof body.expectedGeneration === "string" && UUID_PATTERN.test(body.expectedGeneration))) &&
    (mapping === undefined ||
      (typeof mapping === "object" &&
        mapping !== null &&
        !Array.isArray(mapping) &&
        Object.entries(mapping).every(
          ([from, to]) => STATUS_KEY_PATTERN.test(from) && typeof to === "string" && STATUS_KEY_PATTERN.test(to),
        )))
  );
};

/**
 * `PatchProjectIssueTypeRequestDto` as the gateway parses it: the hand-written
 * DTO takes only its five keys, `null` only for `icon` (it removes the icon,
 * backend TAS-432; `Nulls.FAIL` on the rest), and `sortOrder` as a whole
 * number. `color`, `shape` and `icon` are plain strings here: whether a value
 * is in its set is the service's to check, after the role.
 */
const isIssueTypePatchShape = (input: unknown): input is UpdateProjectIssueTypeInput => {
  if (typeof input !== "object" || input === null) return false;
  const body = input as Record<string, unknown>;
  const allowed = ["name", "color", "shape", "icon", "sortOrder"];
  return (
    sentKeys(body).every((key) => allowed.includes(key)) &&
    (body.name === undefined || typeof body.name === "string") &&
    (body.color === undefined || typeof body.color === "string") &&
    (body.shape === undefined || typeof body.shape === "string") &&
    (body.icon === undefined || body.icon === null || typeof body.icon === "string") &&
    (body.sortOrder === undefined || isInt32(body.sortOrder))
  );
};

/**
 * The category whose statuses `includeDone` off excludes — compared exactly, as
 * `BoardServiceImpl` does (`"DONE".equals(status.getCategory())`), and **per
 * type** since backend #205: the keys come from the workflow of the issue's own
 * type, and issue-service leaves out `status_key IN (…)` for that type's
 * issues alone. A workflow with no such status leaves out nothing, and neither
 * does a type whose workflow was not found.
 */
const BOARD_DONE_CATEGORY = "DONE";

/** One type the board was built from, and its workflow's statuses — `undefined` for a workflow not found. */
export interface MockBoardType {
  issueType: string;
  statuses: readonly Pick<WorkflowStatus, "statusKey" | "name" | "category" | "sortOrder">[] | undefined;
}

/**
 * The board, built the way the gateway builds it since backend #205 (TAS-213,
 * `BoardServiceImpl` at develop 562d84de):
 *
 * - the columns are the statuses of every type's workflow that was found,
 *   merged by key — the first type to state a key wins (put-if-absent, in the
 *   order of `types`) — then sorted stably by `sortOrder`;
 * - `includeDone` off drops an issue whose status its **own type's** workflow
 *   files under `DONE`, and keeps every column;
 * - an issue goes into the column of its status only when its own type's
 *   workflow lists that status; otherwise — a status that is a column only
 *   because another type has it, a status nobody has, or a type whose workflow
 *   was not found — it goes into `unplacedIssues`. The inconsistent-state 500
 *   that stood here before #205 is gone from the server, and from here;
 * - a column and `unplacedIssues` are each in `compareBoardIssues` order
 *   (src/api/boardOrder.ts) — `createdAt`, then `id`, whatever the type, as
 *   the contract states it since backend TAS-392;
 * - then the cap (TAS-392): each merged column, and `unplacedIssues` as one
 *   bucket, keeps its first `pageSizePerColumn` issues (50 when not given),
 *   with `totalCount` — every issue it held before the cut — and `hasMore`.
 *
 * A module-level function rather than a method so a test can hand it workflows
 * the seeded store never holds, and a page size small enough to reach the cap.
 * `issues` arrive already narrowed to the types read and by the filters the
 * store owns (assignee, label, priority, query) — the filters come before the
 * cap, so the counts are of matching issues.
 */
export function buildMockBoard(
  projectId: string,
  types: readonly MockBoardType[],
  issues: readonly BoardIssue[],
  params: Pick<BoardParams, "includeDone" | "pageSizePerColumn"> = {},
): Board {
  const pageSize = params.pageSizePerColumn ?? BOARD_DEFAULT_PAGE_SIZE;
  const statusByKey = new Map<string, NonNullable<MockBoardType["statuses"]>[number]>();
  for (const { statuses } of types) {
    for (const status of statuses ?? []) {
      if (!statusByKey.has(status.statusKey)) statusByKey.set(status.statusKey, status);
    }
  }
  const columns: BoardColumn[] = [...statusByKey.values()]
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((status) => ({
      statusKey: status.statusKey,
      name: status.name,
      category: status.category,
      sortOrder: status.sortOrder,
      issues: [],
      totalCount: 0,
      hasMore: false,
    }));
  const byStatusKey = new Map(columns.map((column) => [column.statusKey, column]));
  const unplacedIssues: BoardIssue[] = [];

  for (const issue of [...issues].sort(compareBoardIssues)) {
    const own = types.find((type) => type.issueType === issue.issueType)?.statuses;
    if (
      !params.includeDone &&
      own?.some((status) => status.statusKey === issue.statusKey && status.category === BOARD_DONE_CATEGORY)
    ) {
      continue;
    }
    const placed = own?.some((status) => status.statusKey === issue.statusKey) ? byStatusKey.get(issue.statusKey) : undefined;
    if (placed) placed.issues.push(issue);
    else unplacedIssues.push(issue);
  }

  return {
    projectId,
    columns: columns.map((column) => ({
      ...column,
      issues: column.issues.slice(0, pageSize),
      totalCount: column.issues.length,
      hasMore: column.issues.length > pageSize,
    })),
    unplacedIssues: unplacedIssues.slice(0, pageSize),
    unplacedTotalCount: unplacedIssues.length,
    unplacedHasMore: unplacedIssues.length > pageSize,
  };
}

/** `pageSizePerColumn` when the request states none (`BoardServiceImpl`, backend TAS-392). */
const BOARD_DEFAULT_PAGE_SIZE = 50;
/** The most `pageSizePerColumn` may be. */
const BOARD_MAX_PAGE_SIZE = 200;

/** `WorkflowStatusCategoryDto`, closed on the wire for a write. */
const WORKFLOW_CATEGORIES: readonly string[] = ["TODO", "IN_PROGRESS", "DONE"];
/** `workflow.validation.*` in workflow-service's application.yml at backend PR #208 (`9a04e99`). */
const WORKFLOW_NAME_MAX_LENGTH = 100;
const WORKFLOW_STATUS_KEY_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;

/** `WorkflowCreationDto` after `WorkflowCreationMapper`: names and status keys trimmed, transition keys as sent. */
interface WorkflowCandidate {
  name: string;
  issueTypes: string[];
  statuses: WorkflowStatusInput[];
  transitions: WorkflowTransitionInput[];
}

/** One `WorkflowCreationViolation`; `duplicate` is the edit route's `CONFLICT_VIOLATIONS`. */
interface WorkflowViolation {
  message: string;
  duplicate: boolean;
}

const isInt32 = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= -INT32_MAX - 1 && value <= INT32_MAX;

/** The gateway's bean validation of `CreateWorkflowStatusRequestDto`: four required fields, the category an enum. */
const isWorkflowStatusBody = (status: unknown): status is WorkflowStatusInput => {
  const body = status as Partial<Record<keyof WorkflowStatusInput, unknown>> | null;
  return (
    typeof body === "object" &&
    body !== null &&
    typeof body.statusKey === "string" &&
    typeof body.name === "string" &&
    typeof body.category === "string" &&
    WORKFLOW_CATEGORIES.includes(body.category) &&
    isInt32(body.sortOrder)
  );
};

/** …and of `CreateWorkflowTransitionRequestDto`: `hidden` optional, a boolean when present. */
const isWorkflowTransitionBody = (transition: unknown): transition is WorkflowTransitionInput => {
  const body = transition as Partial<Record<keyof WorkflowTransitionInput, unknown>> | null;
  return (
    typeof body === "object" &&
    body !== null &&
    typeof body.fromStatusKey === "string" &&
    typeof body.toStatusKey === "string" &&
    typeof body.name === "string" &&
    isInt32(body.sortOrder) &&
    (body.hidden === undefined || typeof body.hidden === "boolean")
  );
};

/** `WorkflowCreationMapper.toStatusDto`: key and name trimmed. */
const trimmedStatus = (status: WorkflowStatusInput): WorkflowStatusInput => ({
  statusKey: status.statusKey.trim(),
  name: status.name.trim(),
  category: status.category,
  sortOrder: status.sortOrder,
});

/** `WorkflowCreationMapper.toTransitionDto`: the name trimmed, the two keys **not**, `hidden` false unless sent. */
const trimmedTransition = (transition: WorkflowTransitionInput): WorkflowTransitionInput => ({
  fromStatusKey: transition.fromStatusKey,
  toStatusKey: transition.toStatusKey,
  name: transition.name.trim(),
  sortOrder: transition.sortOrder,
  hidden: transition.hidden === true,
});

/** `findDuplicates`: one violation per value seen more than once, in the order the second sighting comes. */
function duplicatesOf<T>(items: readonly T[], keyOf: (item: T) => string, say: (key: string) => WorkflowViolation) {
  const seen = new Set<string>();
  const reported = new Set<string>();
  const violations: WorkflowViolation[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key) && !reported.has(key)) {
      reported.add(key);
      violations.push(say(key));
    }
    seen.add(key);
  }
  return violations;
}

/**
 * `WorkflowCreationValidator.validateDto` at backend PR #208 (`9a04e99`), in
 * its order and its words. The category check is left out: the gateway refuses
 * a category outside the three before this is reached, so a `null` one cannot
 * arrive here from REST.
 */
function workflowViolations(candidate: WorkflowCandidate): WorkflowViolation[] {
  const violations: WorkflowViolation[] = [];
  const say = (message: string, duplicate = false) => violations.push({ message, duplicate });
  const { name, issueTypes, statuses, transitions } = candidate;
  const pair = (transition: WorkflowTransitionInput) => `from ${transition.fromStatusKey} to ${transition.toStatusKey}`;

  // validateNames
  if (name === "") say("Workflow name must not be blank");
  for (const status of statuses) if (status.name === "") say(`Status name must not be blank for status: ${status.statusKey}`);
  for (const transition of transitions) if (transition.name === "") say(`Transition name must not be blank: ${pair(transition)}`);
  // validateNameLengths
  const max = WORKFLOW_NAME_MAX_LENGTH;
  if (name.length > max) say(`Workflow name exceeds maximum length of ${max}`);
  for (const status of statuses) {
    if (status.name.length > max) say(`Status name exceeds maximum length of ${max} for status: ${status.statusKey}`);
  }
  for (const transition of transitions) {
    if (transition.name.length > max) say(`Transition name exceeds maximum length of ${max}: ${pair(transition)}`);
  }
  // validateIssueTypes
  if (issueTypes.length === 0) say(EMPTY_ISSUE_TYPE_LIST_VIOLATION);
  else violations.push(...duplicatesOf(issueTypes, (code) => code, (code) => ({ message: `Duplicate issue type: ${code}`, duplicate: false })));
  // validateStatusKeys
  for (const status of statuses) {
    if (status.statusKey === "") say("Status key must not be blank");
    else if (!WORKFLOW_STATUS_KEY_PATTERN.test(status.statusKey)) say(`Status key has invalid format: ${status.statusKey}`);
  }
  // validateStatusAndSortOrderUniqueness
  violations.push(
    ...duplicatesOf(statuses, (status) => status.statusKey, (key) => ({ message: `Status key is not unique: ${key}`, duplicate: true })),
    ...duplicatesOf(statuses, (status) => String(status.sortOrder), (order) => ({
      message: `Status sort order is not unique: ${order}`,
      duplicate: false,
    })),
    ...duplicatesOf(transitions, (transition) => String(transition.sortOrder), (order) => ({
      message: `Transition sort order is not unique: ${order}`,
      duplicate: false,
    })),
  );
  // validateTransitionStatusReferences
  const keys = new Set(statuses.map((status) => status.statusKey));
  const reported = new Set<string>();
  for (const transition of transitions) {
    for (const key of [transition.fromStatusKey, transition.toStatusKey]) {
      if (!keys.has(key) && !reported.has(key)) {
        reported.add(key);
        say(`Transition references unknown status key: ${key}`);
      }
    }
  }
  // validateNoSelfTransitions
  for (const transition of transitions) {
    if (transition.fromStatusKey === transition.toStatusKey) {
      say(`Self-transition is not allowed for status: ${transition.fromStatusKey}`);
    }
  }
  // validateNoDuplicateTransitions — the pair as a two-element list, so no separator can collide.
  violations.push(
    ...duplicatesOf(transitions, (transition) => JSON.stringify([transition.fromStatusKey, transition.toStatusKey]), (key) => {
      const [from, to] = JSON.parse(key) as [string, string];
      return { message: `Duplicate transition from '${from}' to '${to}'`, duplicate: true };
    }),
  );
  // validateSortOrders
  for (const status of statuses) {
    if (status.sortOrder < 0) say(`Status sort order must not be negative for status: ${status.statusKey}`);
  }
  for (const transition of transitions) {
    if (transition.sortOrder < 0) say(`Transition sort order must not be negative: ${pair(transition)}`);
  }
  return violations;
}

/** `ISSUE_TYPE_LIST_EMPTY`'s words — a create's violation, and one an edit drops (`checkViolations`). */
const EMPTY_ISSUE_TYPE_LIST_VIOLATION = "Issue type list must contain at least one valid issue type";

/** `buildViolationMessage`: the prefix, then every violation joined with ", ". */
const violationMessage = (prefix: string, violations: readonly WorkflowViolation[]) =>
  `${prefix}${violations.map((violation) => violation.message).join(", ")}`;

/** issue-service's cap on one synchronous workflow migration (`WorkflowIssueMigrationService`, TAS-427). */
const WORKFLOW_MIGRATION_LIMIT = 5000;

/**
 * The gateway's reading of the edit bodies of backend PR #225. Its four DTOs
 * are hand-written (api-gateway `pom.xml` `schemaMappings`): an unknown field
 * is refused (`@JsonAnySetter`), an explicit `null` is refused
 * (`Nulls.FAIL`), a number must be a whole int (`intValueExact`), a category
 * one of the enum's — and, since backend TAS-427 (develop `be5085e5`,
 * `WorkflowMutationControllerTest.dtoBoundariesAreRejectedAtGatewayWithInvalidArgument`),
 * the bounds too: a name of 1–100 characters (`@Size`), `sortOrder ≥ 0`
 * (`@PositiveOrZero`), `version ≥ 1` (`@Min(1)`); the workflow rename's name
 * is also `@NotBlank` and required (`updateProjectWorkflow`). Each of those is
 * "Invalid request parameters" before workflow-service is asked, so before
 * the role. A field that is `undefined` is one JSON would not carry, and is
 * absent.
 */
const WORKFLOW_BODY_FIELDS = {
  version: (value: unknown) => isInt32(value) && value >= 1,
  name: (value: unknown) => typeof value === "string" && value.length >= 1 && value.length <= 100,
  category: (value: unknown) => typeof value === "string" && WORKFLOW_CATEGORIES.includes(value),
  sortOrder: (value: unknown) => isInt32(value) && value >= 0,
  hidden: (value: unknown) => typeof value === "boolean",
  statusMappings: (value: unknown) =>
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((target) => typeof target === "string"),
  // `PatchWorkflowRequestDto.issueTypes` (backend TAS-436): a list of
  // `IssueTypeDto` codes; the gateway refuses a repeat (`uniqueItems`).
  issueTypes: (value: unknown) =>
    Array.isArray(value) && value.every(isIssueTypeCode) && new Set(value).size === value.length,
} as const;

/**
 * The two deletes' query parameters, which the generated interface does
 * validate: `version` an int32 of at least 1, `targetStatusKey` the
 * contract's `pattern`.
 */
const WORKFLOW_QUERY_FIELDS = {
  version: (value: unknown) => isInt32(value) && value >= 1,
  targetStatusKey: (value: unknown) => typeof value === "string" && WORKFLOW_STATUS_KEY_PATTERN.test(value),
} as const;

function fieldsPass<F extends Readonly<Record<string, (value: unknown) => boolean>>>(
  fields: F,
  body: unknown,
  allowed: readonly (keyof F & string)[],
): boolean {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return false;
  return Object.entries(body).every(([key, value]) => {
    if (value === undefined) return true;
    const field = allowed.find((name) => name === key);
    return field !== undefined && fields[field](value);
  });
}

const isWorkflowPatch = (body: unknown, allowed: readonly (keyof typeof WORKFLOW_BODY_FIELDS)[]) =>
  fieldsPass(WORKFLOW_BODY_FIELDS, body, allowed);
const isWorkflowQuery = (params: unknown, allowed: readonly (keyof typeof WORKFLOW_QUERY_FIELDS)[]) =>
  fieldsPass(WORKFLOW_QUERY_FIELDS, params, allowed);

/** `requireStatus`: a status of this workflow, else 404. */
function requireWorkflowStatus(workflow: WorkflowDefinition, statusId: string): WorkflowStatus {
  const status = workflow.statuses.find((item) => item.id === statusId);
  if (!status) throw new MockApiError("NOT_FOUND", "Status not found in this workflow");
  return status;
}

/** `requireTransition`: a transition of this workflow, else 404. */
function requireWorkflowTransition(workflow: WorkflowDefinition, transitionId: string): WorkflowDefinition["transitions"][number] {
  const transition = workflow.transitions.find((item) => item.id === transitionId);
  if (!transition) throw new MockApiError("NOT_FOUND", "Transition not found in this workflow");
  return transition;
}

/** Substring, case-insensitive, over `issue_key` OR `summary` OR `description` — the probe's own OR. */
const matchesSearchQuery = (issue: StoredIssue, query: string | null) => {
  if (!query) return true;
  const needle = query.toLowerCase();
  return (
    issue.issueKey.toLowerCase().includes(needle) ||
    issue.summary.toLowerCase().includes(needle) ||
    issue.description.toLowerCase().includes(needle)
  );
};

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
 * The two implementations have to stay behaviourally interchangeable
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
 * — only through a hand-edited URL. The pairing of operator and class, and the
 * one strict parse the gateway does on a `uuid` column, are `refuseAdminFilters`
 * below; going further would mean keeping two copies of the backend's parsing
 * rules in sync, which is a worse failure than this one: it stops at ordering
 * deliberately, so do not read it as a promise that anything this function
 * accepts the gateway would accept too.
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
  if (columnClass === "UUID") {
    // A `java.util.UUID` against a `uuid` column (TAS-232): the case of the hex
    // digits is not part of the value. Only the canonical form reaches here as
    // a filter value — `listAdminRows` refuses any other, as the gateway does.
    const a = String(left);
    const b = String(right);
    if (!UUID_PATTERN.test(a) || !UUID_PATTERN.test(b)) return null;
    return compareAsText(a.toLowerCase(), b.toLowerCase());
  }
  return compareAsText(left, right);
};

interface ClassifiedAdminFilter {
  column: string;
  operator: AdminFilterOperator;
  value: string;
  columnClass: AdminColumnClass;
}

/**
 * Two of the refusals `listAdminRows` meets on the gateway before any row is
 * read, in its words and in the order its passes run them, at backend PR #184
 * (TAS-232), `ReadOnlyQueryBuilder.buildSafePageableListQueries`.
 *
 * The gateway does not refuse filter by filter. It validates the whole query
 * in passes, and a later pass runs only once every filter has cleared the
 * earlier ones:
 *
 * - `ReadOnlyQueryValidator.validateFilterOperatorCompatibility`, over every
 *   filter: an operator the column's class cannot take — the class's own name
 *   in the sentence, so a `uuid` column says `UUID`. A blank value is skipped
 *   there (`isBlank()`), so it is skipped here too;
 * - then `buildConditionsAndParams`, filter by filter in column-name order:
 *   `parseUuidValue` refuses an `equals` value on a `uuid` column that is not
 *   a UUID in the canonical 8-4-4-4-12 form.
 *
 * So with one filter carrying a bad uuid and another a bad pairing, the
 * pairing is what the gateway reports, whichever was applied first. Both are
 * `INVALID_ARGUMENT`.
 *
 * Not the whole pipeline, and not claimed to be. Two passes run earlier on the
 * gateway and have no counterpart here: `FilterParser` refuses a blank value
 * outright ("Filter value must not be empty for key"), and `validateColumn`
 * refuses a column the table does not have. Everything else about value
 * parsing stays with `compareAsColumn`'s note: this is the pairing rule and
 * the one parse that is strict, not a copy of the validator.
 */
const refuseAdminFilters = (filters: readonly ClassifiedAdminFilter[]) => {
  for (const { column, operator, value, columnClass } of filters) {
    if (value.trim() === "") continue;
    if (operator === "contains" && columnClass !== "TEXT") {
      throw new MockApiError(
        "INVALID_ARGUMENT",
        `Operator 'contains' is not supported for column '${column}' (type: ${columnClass})`,
      );
    }
    if ((operator === "from" || operator === "to") && columnClass !== "TEMPORAL" && columnClass !== "NUMERIC") {
      throw new MockApiError(
        "INVALID_ARGUMENT",
        `Operator '${operator}' is not supported for column '${column}' (type: ${columnClass}). Only temporal and numeric columns support range filters`,
      );
    }
  }
  // Column-name order, as the gateway sorts its filter map before it builds
  // the conditions: by UTF-16 code unit, which is what Java's `String`
  // comparison and `<` on two strings both do.
  const byColumn = [...filters].sort((left, right) =>
    left.column < right.column ? -1 : left.column > right.column ? 1 : 0,
  );
  for (const { column, operator, value, columnClass } of byColumn) {
    // `StringUtils.hasText` guards each operator there, so a blank value is
    // passed over in this pass as well.
    if (value.trim() === "") continue;
    if (operator === "equals" && columnClass === "UUID" && !UUID_PATTERN.test(value)) {
      throw new MockApiError(
        "INVALID_ARGUMENT",
        `Invalid UUID value for column '${column}': expected UUID in 8-4-4-4-12 format`,
      );
    }
  }
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
const inverseViewLinkTypes: Record<string, string> = {
  BLOCKS: "IS_BLOCKED_BY",
  RELATES_TO: "RELATES_TO",
  DUPLICATES: "IS_DUPLICATED_BY",
};

/** The view from the receiving end — for a relation this map does not know, the stored code as it is. */
const inverseViewLinkType = (linkType: string) =>
  Object.hasOwn(inverseViewLinkTypes, linkType) ? inverseViewLinkTypes[linkType] : linkType;

interface StoredIssueLink {
  id: string;
  projectId: string;
  sourceIssueId: string;
  targetIssueId: string;
  linkType: IssueLinkTypeCode;
  createdBy: string;
  createdAt: string;
}

/**
 * A watcher row, stored without the subscriber's name. The name is not a column
 * of the server's row either: since backend TAS-214 issue-service looks it up
 * in auth-service when the *details* read is assembled, and the list route
 * still answers without it. So the name is put on at read time, by the read
 * that carries one (`watcherView`).
 */
type StoredIssueWatcher = Omit<IssueWatcher, "displayName" | "avatarUrl">;

/**
 * A worklog as stored: the entry plus the soft-delete stamp the server's row
 * carries (`issue_worklogs.deleted_at`). Its author is an id and nothing more —
 * no read names them (backend PR #178).
 */
type StoredWorklog = IssueWorklog & { deletedAt: string | null };

/**
 * An issue as this store keeps it: everything but `timeSpentMinutes`, which
 * every answer computes from the live worklogs (`issueView`, `writeAnswer`), so
 * no stored copy of it can drift from the entries it sums.
 */
type StoredIssue = Omit<Issue, "timeSpentMinutes">;

/**
 * `issue.max-future-days` in issue-service's `application.yml` at backend PR
 * #178's head: a work date may be at most this many days past the server's
 * today.
 */
const WORKLOG_MAX_FUTURE_DAYS = 1;

/** A comment as stored. Its author's name is looked up per read, as the server does (`commentView`). */
type StoredIssueComment = Omit<IssueComment, "author">;

/**
 * An account that used to exist and no longer does: its id is still on a
 * watcher row of TAS-106, and nobody can name it. That is the state the
 * gateway answers with a blank name — `IssueMapperUtils.resolveUser` builds a
 * summary with the id and no `displayName` for any id auth-service returns no
 * profile for, which is also every id while auth-service is down — so it is
 * how the mock reaches the panel's fallback for a person the server did not
 * name (TAS-246). Not a member of any project, so the member list cannot name
 * it either.
 */
const FORMER_ACCOUNT_ID = "9e4c2a7d-0b1f-4c83-a6d5-7f2e8b9c1d04";

/** The transactional outbox table, in every service that has one. */
const OUTBOX_TABLE = "outbox_events";

/**
 * The admin audit log's seed (TAS-251): thirty entries across three actors,
 * five actions and four target tables, at fixed instants so a date filter in
 * a test means the same rows every day. Newest first, which is the order the
 * server answers in.
 *
 * The log keeps a snapshot of the actor's name and email, taken when the row
 * was written (backend PR #219, TAS-388), so an actor does not have to be a
 * user the rest of the seed knows: `vera` is a former admin and `migrator` a
 * service account. The snapshot comes in the two shapes the stand has. Rows
 * written since #219 carry the display name and the email. Rows written before
 * it went through changeset `0003-audit-actor-identity`, which renamed
 * `actor_login` to `actor_display_name` rather than refilling it, so they still
 * hold the old login there and no email. Mark has both: one id, "Mark Lee" on
 * his newest rows and "mark" on the older ones. No row has a blank name —
 * the column is `NOT NULL` and admin-service refuses one — so the Audit
 * section's address-only, id-only and dash states are reached by its tests
 * rather than by this seed.
 *
 * Some rows have no request id, some no old value (an invitation creates
 * something) and some no new value (a session revoked is gone); secrets inside
 * the documents are already `"***"`, as the server masks them. The documents
 * are spelt as the audit route spells them, compact and in jsonb's key order
 * (`jsonbCompact`).
 *
 * Every row has an id, as every row on the stand does (backend PR #197): a
 * lowercase UUID, fixed per row so a test can name one, and in no particular
 * relation to the row's time — the server's tiebreak is the id's own order.
 */
function seedAuditEntries(): AuditEntry[] {
  type Actor = Pick<AuditEntry, "actorUserId" | "actorDisplayName" | "actorEmail">;
  // Written since #219: the name and the address as they were at the time.
  const mark: Actor = { actorUserId: MARK_ID, actorDisplayName: "Mark Lee", actorEmail: "mark@example.com" };
  // Written before it: the old login, kept by the rename, and no address.
  const before = {
    mark: { actorUserId: MARK_ID, actorDisplayName: "mark", actorEmail: null },
    vera: { actorUserId: FORMER_ACCOUNT_ID, actorDisplayName: "vera", actorEmail: null },
    migrator: { actorUserId: "5a1c7e93-2d4b-4f60-9b8e-0c3d7a6f1e28", actorDisplayName: "migrator", actorEmail: null },
  } satisfies Record<string, Actor>;
  // The three newest rows postdate #219; everything from the fourth down is
  // older. Both shapes, and all three actors, are on the first page of twenty.
  const writtenSince = 3;
  const userIds = [NINA_ID, OMAR_ID, LEO_ID, PRIYA_ID, TOM_ID];
  type Template = Omit<AuditEntry, "id" | keyof Actor | "createdAt" | "requestId" | "targetId">;
  const templates: Template[] = [
    {
      action: "BLOCK_USER",
      targetService: "auth",
      targetTable: "users",
      reason: "Left the company",
      oldValue: jsonbCompact({ status: "ACTIVE" }),
      newValue: jsonbCompact({ status: "BLOCKED" }),
    },
    {
      action: "UNBLOCK_USER",
      targetService: "auth",
      targetTable: "users",
      reason: "Came back from leave",
      oldValue: jsonbCompact({ status: "BLOCKED" }),
      newValue: jsonbCompact({ status: "ACTIVE" }),
    },
    {
      action: "RESET_CREDENTIAL_LOCKOUT",
      targetService: "auth",
      targetTable: "credentials",
      reason: "Identity confirmed by phone",
      oldValue: jsonbCompact({ status: "LOCKED", failedAttempts: 5, passwordHash: "***" }),
      newValue: jsonbCompact({ status: "ACTIVE", failedAttempts: 0, passwordHash: "***" }),
    },
    {
      action: "RETRY_OUTBOX_EVENT",
      targetService: "project",
      targetTable: "outbox_events",
      reason: "Kafka producer is back",
      oldValue: jsonbCompact({ status: "FAILED", attempts: 5, lastErrorMessage: "Failed to construct kafka producer" }),
      newValue: jsonbCompact({ status: "NEW", attempts: 0, lastErrorMessage: null }),
    },
    {
      action: "RETRY_OUTBOX_EVENT",
      targetService: "issue",
      targetTable: "outbox_events",
      reason: "Stuck in PROCESSING after the deploy",
      oldValue: jsonbCompact({ status: "PROCESSING", attempts: 2 }),
      newValue: jsonbCompact({ status: "NEW", attempts: 0 }),
    },
    {
      action: "CREATE_INVITATION",
      targetService: "auth",
      targetTable: "invitations",
      reason: "New contractor",
      oldValue: null,
      newValue: jsonbCompact({ email: "c****r@example.com", token: "***", expiresAt: "2026-10-16T00:00:00Z" }),
    },
    {
      action: "REVOKE_SESSIONS",
      targetService: "auth",
      targetTable: "sessions",
      reason: "Laptop reported stolen",
      oldValue: jsonbCompact({ activeSessions: 3, refreshToken: "***" }),
      newValue: null,
    },
  ];
  const start = Date.parse("2026-10-09T16:40:00Z");
  return Array.from({ length: 30 }, (_, index) => {
    const template = templates[index % templates.length];
    // Mark does most of it, as the only admin today; Vera's rows are the old
    // ones, from before she left; the migrator only ever retries events.
    const actor: Actor =
      index < writtenSince
        ? mark
        : template.action === "RETRY_OUTBOX_EVENT" && index % 3 === 0
          ? before.migrator
          : index >= 15
            ? before.vera
            : before.mark;
    const targetId =
      template.targetTable === "outbox_events"
        ? `7f0c${String(index).padStart(4, "0")}-3b1a-4c2d-8e9f-0a1b2c3d4e5f`
        : userIds[index % userIds.length];
    return {
      ...template,
      // Reversed digits, so the ids do not sort the way the times do.
      id: `5e7a${String(index).padStart(4, "0").split("").reverse().join("")}-2c4b-4d1e-9f3a-6b8c0d2e4f1a`,
      ...actor,
      targetId,
      // Every fifth row came from somewhere with no request id to keep.
      requestId: index % 5 === 4 ? null : `a0d1${String(index).padStart(4, "0")}-6c2e-4f3a-9b8d-1e2f3a4b5c6d`,
      // About seventeen hours apart, so thirty rows span three weeks and a
      // day holds one or two of them.
      createdAt: new Date(start - index * 17 * 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z"),
    };
  });
}

/**
 * A JSON value with its objects' keys in jsonb's own storage order — shorter
 * keys first, equal lengths by their bytes — which is the order every reader
 * of a `jsonb` column gets them back in, whoever wrote them in what order.
 * `keyGap` and `itemGap` are what goes after a key and between members; the
 * two spellings this store needs are `jsonbText` and `jsonbCompact` below.
 */
function jsonbOrdered(value: unknown, keyGap: string, itemGap: string): string {
  if (Array.isArray(value)) return `[${value.map((item) => jsonbOrdered(item, keyGap, itemGap)).join(itemGap)}]`;
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).sort((a, b) => a.length - b.length || byText(a, b));
    const members = keys.map(
      (key) => `${JSON.stringify(key)}${keyGap}${jsonbOrdered((value as Record<string, unknown>)[key], keyGap, itemGap)}`,
    );
    return `{${members.join(itemGap)}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * A JSON value as PostgreSQL prints a `jsonb` column — which is how the
 * read-only table API hands one over: as **text in a string**, not as a JSON
 * value (probed 2026-10-19 on `admin.admin_audit_log`, request id
 * `940a576d-2d14-483d-9377-7e1b71fbf5ad`).
 *
 * An approximation of `jsonb_out`, close enough to read as the stand does:
 * `": "` after a key and `", "` between members, in jsonb's key order — which
 * is why the probed `{"status": …, "lockedUntil": …, "lastFailedAt": …,
 * "failedAttempts": …}` is not in the order anybody wrote it. Numbers are
 * printed as JavaScript prints them, where PostgreSQL keeps a `numeric`'s own
 * digits; nothing in this seed tells the two apart.
 */
function jsonbText(value: unknown): string {
  return jsonbOrdered(value, ": ", ", ");
}

/**
 * The same document as the audit route sends it: admin-service reads the
 * `jsonb` back into a `JsonNode`, masks it, and prints it with Jackson's
 * `toString()` — compact, but in the key order the column handed over. So the
 * Audit section's detail and the Data section's row card show one entry's keys
 * in one order, as they do on the stand.
 */
function jsonbCompact(value: unknown): string {
  return jsonbOrdered(value, ":", ",");
}

/** `yyyy-MM-dd` and a real day of the calendar — the only date spelling the audit read accepts. */
function isAuditDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const at = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 10) === value;
}

/**
 * The `outbox_events` catalog entry, identical in each service that carries one
 * — auth, project and issue today, and exactly those three, which is what makes
 * the Events section's service selector a real filter over the catalog rather
 * than a hardcoded list (DESIGN.md §5.8).
 *
 * The types are the **live catalog's own spellings**, read from
 * `issue.outbox_events` on the deployed gateway on 2026-08-25 — `text` where
 * the product tables in this seed say `character varying`, and `aggregate_id`
 * a `uuid` rather than text. Both matter: the console picks a column's filter
 * operators and its value control from this string, so a mock that guessed
 * would offer controls the gateway then answers 400 for.
 *
 * No column is sensitive, which mirrors the deployed masking config. `payload`
 * is `jsonb` and therefore OTHER to the classifier: no `contains`, no ranges,
 * and the Events filter list does not offer it at all.
 */
function outboxTable(): AdminTable {
  return {
    name: OUTBOX_TABLE,
    primaryKey: "id",
    columns: [
      { name: "id", type: "uuid", sensitive: false },
      { name: "aggregate_type", type: "text", sensitive: false },
      { name: "aggregate_id", type: "uuid", sensitive: false },
      { name: "event_type", type: "text", sensitive: false },
      { name: "payload", type: "jsonb", sensitive: false },
      { name: "status", type: "text", sensitive: false },
      { name: "created_at", type: "timestamp with time zone", sensitive: false },
      { name: "published_at", type: "timestamp with time zone", sensitive: false },
      { name: "attempts", type: "integer", sensitive: false },
      { name: "last_error_message", type: "text", sensitive: false },
      { name: "processing_started_at", type: "timestamp with time zone", sensitive: false },
      { name: "request_id", type: "text", sensitive: false },
    ],
  };
}

/**
 * How long a row may sit in each state before the backend calls it problematic.
 * These are the *mock's* numbers, not the contract's: the real thresholds are
 * server configuration, and the summary endpoint reports the answer rather than
 * the rule. Minutes rather than the backend's hours so that a seeded row can be
 * both plausibly recent and unambiguously stuck.
 */
const OUTBOX_PROCESSING_TIMEOUT_MINUTES = 5;
const OUTBOX_NEW_OVERDUE_MINUTES = 10;

/**
 * How long a `PROCESSING` row has to have been stuck before the **retry** route
 * will take it — a *third* threshold, and deliberately not equal to the one
 * above it.
 *
 * This is the backend's shape, not a mock convenience. admin-service reads
 * `admin.outbox-retry.stuck-threshold` (default **10m**) to decide eligibility,
 * and reads `admin.outbox.processing-timeouts` (default **5m**, per producing
 * service) to decide what the *summary* calls stuck. So the real gateway has a
 * window in which a row is listed as "Stuck processing" and refused by retry,
 * and this mock has to have one too — otherwise the only implementation a
 * developer clicks through would be the one where the case cannot happen
 * (docs/ai/API-DIVERGENCE.md).
 *
 * The ratio is the backend's; the units are the mock's, like the two above.
 */
const OUTBOX_RETRY_STUCK_MINUTES = 10;

/**
 * admin-service's `OutboxRetryEligibility.isRetryable` (backend PR #195,
 * TAS-200): `FAILED`, or `PROCESSING` with a `processing_started_at` strictly
 * before now minus the retry stuck threshold. One function for both of its
 * callers, as on the server — the summary's `retryable` snapshot and the retry
 * command's own re-check — so the two cannot disagree about a row.
 */
const isOutboxRetryable = (row: AdminRow, nowMs: number): boolean => {
  if (row.status === "FAILED") return true;
  const startedAt = row.processing_started_at;
  return (
    row.status === "PROCESSING" &&
    typeof startedAt === "string" &&
    new Date(startedAt).getTime() < nowMs - OUTBOX_RETRY_STUCK_MINUTES * 60_000
  );
};

/**
 * How many events the mock's summary will list. The real default is 100; a
 * small number here is legitimate because the limit is server config rather
 * than contract, and it is the only way `notAllShown` — and the line the UI
 * draws for it — is reachable from a seed anyone can read.
 */
const OUTBOX_SUMMARY_LIMIT = 5;

/**
 * The backend's own sentences for why a row is problematic, word for word
 * (backend PR #141, TAS-105, merged 2026-08-27). `reason` is prose, not an enum:
 * the UI derives the category from `status` and never parses these — they are
 * seeded verbatim so that the
 * sentence the summary list carries on its category cell (in `title` and in the
 * cell's accessible name) is in mock mode exactly what the gateway will send.
 */
const OUTBOX_REASONS = {
  FAILED: "Event processing failed",
  PROCESSING: "Event stuck in PROCESSING state (exceeded processing timeout)",
  NEW: "Event stuck in NEW state (not picked up for processing)",
} as const;

/** A stable, uuid-shaped id: a row address has to survive a reload and a copied link. */
const outboxUuid = (kind: string, slot: number, index: number) =>
  `${kind}${slot}${String(index + 1).padStart(4, "0")}-0000-4000-8000-${slot}${String(index + 1).padStart(11, "0")}`;

/** One seeded outbox row, before it is turned into columns. */
interface OutboxSeed {
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  status: "NEW" | "PROCESSING" | "PUBLISHED" | "FAILED";
  /** Age of the row itself. Everything in this table is read by age. */
  minutesAgo: number;
  attempts: number;
  payload: string;
  processingMinutesAgo?: number;
  publishedMinutesAgo?: number;
  lastErrorMessage?: string;
}

/**
 * Whichever of the three categories this row falls into, or `null` when it is
 * healthy. The same reading the backend's query makes: `FAILED` always counts,
 * and the other two only once they have been in that state too long.
 */
function outboxProblem(row: AdminRow, nowMs: number): keyof typeof OUTBOX_REASONS | null {
  const olderThan = (value: unknown, minutes: number) =>
    typeof value === "string" && nowMs - new Date(value).getTime() > minutes * 60_000;
  if (row.status === "FAILED") return "FAILED";
  if (row.status === "PROCESSING" && olderThan(row.processing_started_at, OUTBOX_PROCESSING_TIMEOUT_MINUTES)) {
    return "PROCESSING";
  }
  if (row.status === "NEW" && olderThan(row.created_at, OUTBOX_NEW_OVERDUE_MINUTES)) return "NEW";
  return null;
}

export class MockTaskaStore {
  readonly notificationPreferences = new MockNotificationPreferences();
  /** Personal access tokens (TAS-412); Anna, the account the suite signs in with, has two. */
  // Anna has two tokens; Mark holds as many as the policy allows, so his
  // create meets the cap (TAS-402).
  readonly accessTokens = new MockAccessTokens(ANNA_ID, MARK_ID);
  private users: StoredUser[];
  private projects: Project[];
  private membersByProject: Record<string, ProjectMember[]>;
  private issues: StoredIssue[];
  private historyByIssue: Record<string, IssueHistoryEvent[]>;
  private commentsByIssue: Record<string, StoredIssueComment[]>;
  private links: StoredIssueLink[] = [];
  /**
   * Issue subscriptions. Hard-deleted, unlike attachments and labels: the
   * contract's `removed` flag on the unwatch response only makes sense over a
   * store where the row is either there or gone.
   */
  private watchers: StoredIssueWatcher[] = [];
  /** Attachment rows, soft-deleted in place exactly as the server's are. */
  private attachments: StoredAttachment[] = [];
  /** Worklog rows (backend PR #178), soft-deleted in place as the server's are. */
  private worklogs: StoredWorklog[] = [];
  /** Issues another member will change just before the reader's next transition (`MOCK_PROJECT_TRIGGERS.changedMeanwhile`). */
  private readonly changingMeanwhile = new Set<string>();
  /**
   * The stand-in bucket: object key to what was PUT under it. Separate from
   * `attachments` on purpose — an object with no row is precisely the orphan a
   * failed confirm leaves behind, and one store that held both could not
   * represent it.
   */
  private storeObjects = new Map<string, MockStoredObject>();
  /** Presigned uploads handed out and not yet spent, keyed by the URL itself. */
  private uploadTickets = new Map<string, MockUploadTicket>();
  /** Presigned download links handed out, keyed by the URL itself. */
  private downloadTickets = new Map<string, MockDownloadTicket>();
  /**
   * One avatar per user at most, keyed by user id — which is the shape of the
   * server's own table and the reason nothing here has to guard against
   * duplicates: a second confirm replaces the row rather than inserting beside
   * it, and `DELETE` is idempotent because deleting from a map twice is.
   */
  private avatars = new Map<string, MockAvatar>();
  /** Presigned avatar uploads handed out and not yet spent, keyed by the URL. */
  private avatarTickets = new Map<string, MockAvatarTicket>();
  /**
   * The avatar bucket: object key to what was PUT under it, bytes included.
   * Separate from `storeObjects` above for the same reason the tickets are —
   * two buckets, and an attachment key must not resolve as an avatar.
   */
  private avatarObjects = new Map<string, { contentType: string; sizeBytes: number; dataUrl: string }>();
  private projectLabels: ProjectLabel[];
  /**
   * Which labels an issue carries, held as ids against `projectLabels` rather
   * than as copies on the issue. A rename or a recolour then shows everywhere
   * at once, and a soft-deleted label leaves every issue it was on — which is
   * what the gateway does (TAS-119) and what copies would quietly get wrong.
   */
  private labelIdsByIssue: Record<string, string[]> = {};
  private notifications: Notification[];
  /**
   * The shared default workflow, as backend PR #208's migration 0001 leaves it:
   * six transitions, none hidden. Every project runs on it for each type that
   * has no workflow of its own, and no write may change it.
   */
  private workflow: WorkflowDefinition;
  /** The admin audit log (`listAuditEntries`). */
  private auditEntries: AuditEntry[] = seedAuditEntries();
  /**
   * Each project's issue-type registry (backend #212, TAS-385) — project-
   * service's `project_issue_types`. Held in no particular order; every reader
   * goes through `registryOf`, which orders it as the server does. A project
   * created at runtime gets `SEED_ISSUE_TYPES`. **OPS holds only TASK and BUG**,
   * so one board offers fewer types than the seed; **WEB adds EPIC** (purple,
   * the `layers` icon, with a workflow of its own in `workflowOverrides`), so a
   * type that is not one of the seeds — and one drawn by its icon rather than
   * a shape — is always on screen somewhere; **MOB adds INCIDENT**, an amber
   * diamond without an icon (backend TAS-432's third shape).
   */
  private issueTypesByProject: Record<string, ProjectIssueType[]> = {};
  /**
   * Workflows other than the default, by project and issue type — workflow-
   * service's bindings. WEB's EPIC workflow adds `IN_REVIEW` between In
   * Progress and Done — a status key this build does not know, in a category it
   * does. A workflow created through `createProjectWorkflow` is bound here under
   * each of its types as one object, so an add reaches all of them at once.
   */
  private workflowOverrides: Record<string, Partial<Record<string, WorkflowDefinition>>> = {};
  /**
   * Every workflow of a project's own, bound or not — workflow-service's
   * `owner_project_id`. A workflow whose types all moved elsewhere stays here
   * as a donor with its graph (backend TAS-436), listed with no type and
   * editable, until it is deleted.
   */
  private ownedWorkflows: Record<string, WorkflowDefinition[]> = {};
  /**
   * The codes of a project that were deleted at least once — a code created
   * again has an older lifecycle, so a delete with a move must then name the
   * generation it means (`ISSUE_TYPE_GENERATION_REQUIRED`, backend TAS-433).
   */
  private retiredTypeCodes: Record<string, Set<string>> = {};
  /**
   * The commands answered 503 «still being applied»
   * (`MOCK_PROJECT_TRIGGERS.stillApplying`), by the `X-Request-Id` the answer
   * carried: what was asked, and what the finished command answers when it is
   * sent again with that id.
   */
  private pendingCommands = new Map<string, { command: string; answer: unknown }>();
  /**
   * The outbox rows, seeded once on first read rather than in the constructor.
   * Their timestamps are relative to *now* — a row has to be genuinely three
   * hours old for the summary's thresholds and the list's ages to say anything
   * — and freezing them at first read is what keeps a row's `created_at` the
   * same value in the journal, in the summary and on the card of the session
   * that is reading them.
   */
  private outboxEvents: Record<string, AdminRow[]> | null = null;
  /** Every invitation link ever made, newest last — auth-service's `invite_tokens`. */
  private inviteTokens: MockInviteToken[];
  private currentUserId = ANNA_ID;

  constructor() {
    const ts = (day: number, minute: number) =>
      `2026-06-${String(day).padStart(2, "0")}T09:${String(minute).padStart(2, "0")}:00Z`;

    // Mark is the seed's only GLOBAL_ADMIN so both role displays can be reached
    // by signing in; everyone else, Anna included, is a plain USER.
    this.users = [
      {
        id: ANNA_ID,
        email: "anna@example.com",
        displayName: "Anna Ivanova",
        status: "ACTIVE",
        // Deliberately not the colour Anna's own id computes to, and the same
        // goes for Mark and Sofia. A seed that duplicates the computed answer
        // exercises the branch without showing it: the point of seeding three
        // people is that a reader can see which colour came from the server.
        // Anna computes to #ec4899, Mark to #ec4899 and Sofia to #10b981, so
        // all three still state something else after TAS-175 restored the
        // bright palette — the three values below are the §2.2 hues the
        // darkened ones they replace were derived from, position for position.
        // The three people who do state a colour state one from
        // `avatarColorChoices`. This mock does not stand in for some server; it
        // stands in for one that behaves correctly. The "colour came from the
        // server" branch exists for TAS-148, where an admin picks from the set
        // this app itself offers — so a seeded value from outside that set
        // would be demonstrating a case the product does not permit, in the one
        // environment where anybody looks at these colours at all. Same
        // argument as Tom and Priya below: a mock that had depicted reality
        // would not have let TAS-171's flat accent avatars live this long.
        //
        // The five as drawn: Anna amber, Mark sky, Sofia pink, Tom and Priya
        // indigo. Four of those take the dark glyph and indigo takes white, so
        // both branches of `readableTextOn` are on screen at once.
        color: "#f59e0b",
        globalRole: "USER",
      },
      {
        id: MARK_ID,
        email: "mark@example.com",
        displayName: "Mark Lee",
        status: "ACTIVE",
        color: "#0ea5e9",
        globalRole: "GLOBAL_ADMIN",
      },
      {
        id: SOFIA_ID,
        email: "sofia@example.com",
        displayName: "Sofia Reyes",
        status: "ACTIVE",
        color: "#ec4899",
        globalRole: "USER",
      },
      {
        id: TOM_ID,
        email: "tom@example.com",
        displayName: "Tom Becker",
        status: "ACTIVE",
        // Tom and Priya state no colour on purpose. Every seeded person having
        // one meant the only environment a reviewer or an e2e run can reach
        // always took the "server sent a colour" branch — the branch the live
        // gateway does not have — which is how the flat accent avatars of
        // TAS-171 survived as long as they did. Two of the five now exercise
        // the computed branch instead, and they were the pair that collided
        // with each other anyway: both compute to #6366f1, which is DESIGN.md
        // §2.2's birthday bound standing in front of a reader rather than
        // written down in a document.
        globalRole: "USER",
      },
      {
        id: PRIYA_ID,
        email: "priya@example.com",
        displayName: "Priya Nair",
        status: "ACTIVE",
        globalRole: "USER",
      },
      // The three accounts that are not ACTIVE (TAS-186, and Omar with
      // TAS-188). Every status the admin Users section can draw is on screen
      // without anybody having to change a row first, and all three of its
      // actions — Block, Unblock and Reset lockout — are one click away in the
      // only environment a reviewer or an e2e run can reach.
      //
      // Appended rather than inserted: `auth.users` derives its rows from this
      // array by position, so a person added in the middle would have moved
      // every seeded `failed_logins` and `created_at` beneath them.
      //
      // Appending is not free either, and the one thing it does move is worth
      // naming. `seedOutboxEvents` hands `users.map(u => u.id)` to `published`,
      // which round-robins the list across eight auth rows — every change to
      // the length of this array means some of those rows carry a different
      // `aggregate_id` than before. Nothing asserts them and nothing derives
      // from them: they are opaque uuids in a diagnostic table, the row count,
      // the statuses and the ages are unchanged, and the problems summary
      // counts states rather than aggregates. Recorded so the next reader does
      // not go looking for a reason the journal's ids moved.
      //
      // None of the three belongs to a project, which is the honest shape: an
      // invitation that has not been accepted, an account that was shut off and
      // one that cannot get in are exactly the people a board does not have.
      {
        id: LEO_ID,
        email: "leo@example.com",
        displayName: "Leo Fischer",
        status: "INVITED",
        globalRole: "USER",
      },
      {
        id: NINA_ID,
        email: "nina@example.com",
        displayName: "Nina Kowal",
        status: "BLOCKED",
        globalRole: "USER",
      },
      // Locked by his own failed sign-ins rather than by an administrator, so
      // he is the one account whose state nobody in this product created —
      // which is exactly the row Reset lockout exists for. Seeded because no
      // click can produce it: reaching `LOCKED` takes repeated failed sign-ins
      // against the real auth-service, so without this row the third action
      // would be unreachable in the only environment an e2e run has.
      {
        id: OMAR_ID,
        email: "omar@example.com",
        displayName: "Omar Haddad",
        status: "LOCKED",
        globalRole: "USER",
      },
      // Invited and never activated, whose link has expired (TAS-297).
      {
        id: IVY_ID,
        email: "ivy@example.com",
        displayName: "Ivy Chen",
        status: "INVITED",
        globalRole: "USER",
      },
    ];
    const seededAt = Date.now();
    const day = 24 * 60 * 60 * 1000;
    this.inviteTokens = [
      { token: MOCK_INVITE_TOKENS.leo, userId: LEO_ID, createdAt: seededAt - 2 * day, expiresAt: seededAt - 2 * day + INVITE_TOKEN_TTL_MS, usedAt: null },
      { token: MOCK_INVITE_TOKENS.ivy, userId: IVY_ID, createdAt: seededAt - 9 * day, expiresAt: seededAt - 9 * day + INVITE_TOKEN_TTL_MS, usedAt: null },
    ];

    /**
     * One seeded avatar, and one only — Sofia's.
     *
     * Somebody has to have a picture before anybody uploads one, or mock mode
     * can never show what the member-row path actually draws: `listMembers`
     * carries the avatar inline, which is what makes a board of faces one read,
     * and a seed of nobody would leave that code unexercised until a reviewer
     * uploaded something by hand.
     *
     * **Not Anna**, deliberately. She is the account every e2e spec and every
     * screenshot signs in as, and the flow this feature is built for starts at
     * "no avatar": upload it, watch it replace the initials, delete it, watch
     * the initials come back. Seeding the reader's own face would take the
     * first of those four steps away from the only environment that can run it.
     *
     * The PNG is 219 bytes of two-tone head-and-shoulders — recognisably a
     * picture and not a coloured disc, which is the one thing it has to be to
     * prove an image rendered rather than a fill. It is a `data:` URL because
     * this store has no server to serve bytes from; see `MockAvatar`.
     */
    this.avatars.set(SOFIA_ID, {
      id: "3a1d6f70-5f3e-4d2b-9d0c-8c8e2d4b6a11",
      userId: SOFIA_ID,
      objectKey: "seeded-avatar-sofia",
      fileName: "sofia.png",
      contentType: "image/png",
      sizeBytes: 219,
      createdAt: ts(12, 5),
      downloadUrl: SEEDED_AVATAR_PNG,
    });
    // And the object that row points at, in the bucket. A read presigns
    // through a HEAD of the object (see `currentUserProfile`), so a row with
    // nothing behind it is the broken state, not a seeded one.
    this.avatarObjects.set("seeded-avatar-sofia", {
      contentType: "image/png",
      sizeBytes: 219,
      dataUrl: SEEDED_AVATAR_PNG,
    });

    this.projects = [
      // Not `#6366f1`, which is what this key computes to: a seed equal to the
      // computed answer hides the override branch instead of showing it, the
      // same trap the seeded people above avoid. TAS and MOB now demonstrate a
      // stated colour winning; WEB happens to state its computed one, which is
      // honest and costs nothing.
      this.project(
        TASKA_PROJECT_ID,
        "TAS",
        "Taska Platform",
        "Core gateway, auth and issue services",
        "#0052cc",
        [ANNA_ID, MARK_ID, SOFIA_ID, TOM_ID],
        "2026-06-08T09:10:00Z",
      ),
      this.project(
        WEB_PROJECT_ID,
        "WEB",
        "Web App",
        "Customer-facing web client",
        "#0ea5e9",
        [ANNA_ID, SOFIA_ID, PRIYA_ID],
        "2026-06-08T09:11:00Z",
      ),
      this.project(
        MOB_PROJECT_ID,
        "MOB",
        "Mobile",
        "iOS and Android applications",
        "#8b5cf6",
        [MARK_ID, TOM_ID, PRIYA_ID],
        "2026-06-08T09:12:00Z",
      ),
      // OPS states no colour for the same reason as Tom and Priya above: one
      // project has to take the computed path. Its former `#0d9488` was not a
      // member of the palette a computed key draws from either.
      this.project(
        OPS_PROJECT_ID,
        "OPS",
        "Infra and Ops",
        "CI/CD, observability, on-call",
        undefined,
        [ANNA_ID, TOM_ID],
        "2026-06-08T09:13:00Z",
      ),
    ];

    // ADMIN for the first member of each project, MEMBER for the rest — and one
    // exception: **Tom is a VIEWER of Taska Platform**, the only seeded VIEWER
    // who is a member (TAS-226). He is there so an ADMIN meets a VIEWER on
    // Anna's own project, where the assignee chips leave him out: issue-service
    // checks `assign-issue-roles` against the assignee too. And he is chosen
    // because he already holds TAS-104 and TAS-110, which is what a demotion
    // after the assignment looks like — the one chip the panel keeps on screen
    // as the assignment and will not send again. A changed role rather than an
    // added member, so every member list, avatar stack and filter bar the suite
    // measures keeps its size.
    //
    // **Tom is a VIEWER of Mobile too** (TAS-251). The board reads its frame
    // from the project context, which refuses a non-member with 403 as the
    // gateway does, so the read-only board on MOB — MOB-5's links, label,
    // attachment, plan and watcher — is now reached by a real VIEWER signing
    // in as `tom@example.com`, rather than by Anna standing in for one.
    //
    // The store's other reads are still looser than the gateway:
    // `getMembership` answers `VIEWER` for a non-member (`member?.role ??
    // "VIEWER"`), and the per-issue routes let a non-member through. Against
    // the gateway a non-member is refused by `ProjectRoleChecker` on
    // `!isMember` before any role is looked at. Recorded in
    // docs/ai/API-DIVERGENCE.md.
    this.membersByProject = Object.fromEntries(
      this.projects.map((project) => [
        project.id,
        (project.memberIds ?? []).map((userId, index) => ({
          userId,
          role:
            index === 0
              ? "ADMIN"
              : (project.id === TASKA_PROJECT_ID || project.id === MOB_PROJECT_ID) && userId === TOM_ID
                ? "VIEWER"
                : "MEMBER",
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
          hidden: false,
        },
        {
          id: "66666666-6666-6666-6666-666666666666",
          fromStatusId: IN_PROGRESS_STATUS_ID,
          toStatusId: DONE_STATUS_ID,
          name: "Complete",
          sortOrder: 20,
          hidden: false,
        },
        // Backend PR #208's migration 0001 (TAS-381, develop `594f637`) adds
        // this one, "Close" and "Back to To Do" to the two above and "Reopen".
        // This one was an invented "Move to To Do" at 25 before TAS-382.
        {
          id: "88888888-8888-8888-8888-888888888888",
          fromStatusId: IN_PROGRESS_STATUS_ID,
          toStatusId: TODO_STATUS_ID,
          name: "Stop Progress",
          sortOrder: 40,
          hidden: false,
        },
        {
          id: "77777777-7777-7777-7777-777777777777",
          fromStatusId: DONE_STATUS_ID,
          toStatusId: IN_PROGRESS_STATUS_ID,
          name: "Reopen",
          sortOrder: 30,
          hidden: false,
        },
        {
          id: "99999999-9999-9999-9999-999999999999",
          fromStatusId: TODO_STATUS_ID,
          toStatusId: DONE_STATUS_ID,
          name: "Close",
          sortOrder: 50,
          hidden: false,
        },
        {
          id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          fromStatusId: DONE_STATUS_ID,
          toStatusId: TODO_STATUS_ID,
          name: "Back to To Do",
          sortOrder: 60,
          hidden: false,
        },
      ],
    };

    this.workflowOverrides = {
      [WEB_PROJECT_ID]: {
        EPIC: {
          ...this.workflow,
          id: EPIC_WORKFLOW_ID,
          name: "Epic workflow",
          statuses: [
            ...this.workflow.statuses,
            { id: IN_REVIEW_STATUS_ID, statusKey: "IN_REVIEW", name: "In Review", category: "IN_PROGRESS", sortOrder: 25 },
          ],
          transitions: [
            ...this.workflow.transitions,
            {
              id: "99999999-9999-9999-9999-999999999991",
              fromStatusId: IN_PROGRESS_STATUS_ID,
              toStatusId: IN_REVIEW_STATUS_ID,
              name: "Send to review",
              sortOrder: 22,
              hidden: false,
            },
            {
              id: "99999999-9999-9999-9999-999999999992",
              fromStatusId: IN_REVIEW_STATUS_ID,
              toStatusId: DONE_STATUS_ID,
              name: "Approve",
              sortOrder: 27,
              hidden: false,
            },
          ],
        },
      },
      // A workflow with no To Do: workflow-service's create validator does
      // not require one — an MCP or token client can make it — though every
      // edit does. Mobile's INCIDENT runs on it, so the board draws its two
      // columns; the To Do column's "+" switches the type off (the server
      // would refuse the status, `STATUS_NOT_IN_WORKFLOW`, backend TAS-428),
      // and Triage's "+" offers it alone (DESIGN.md §5.5). No issue carries
      // the type in the seed.
      [MOB_PROJECT_ID]: {
        INCIDENT: {
          ...this.workflow,
          id: INCIDENT_WORKFLOW_ID,
          name: "Incident workflow",
          statuses: [
            { id: TRIAGE_STATUS_ID, statusKey: "TRIAGE", name: "Triage", category: "TODO", sortOrder: 5 },
            { id: RESOLVED_STATUS_ID, statusKey: "RESOLVED", name: "Resolved", category: "DONE", sortOrder: 40 },
          ],
          transitions: [
            {
              id: "13131313-1313-1313-1313-131313131301",
              fromStatusId: TRIAGE_STATUS_ID,
              toStatusId: RESOLVED_STATUS_ID,
              name: "Resolve",
              sortOrder: 10,
              hidden: false,
            },
          ],
        },
      },
    };

    this.ownedWorkflows = {
      [WEB_PROJECT_ID]: [this.workflowOverrides[WEB_PROJECT_ID]!.EPIC!],
      [MOB_PROJECT_ID]: [this.workflowOverrides[MOB_PROJECT_ID]!.INCIDENT!],
    };

    for (const project of this.projects) {
      this.issueTypesByProject[project.id] = SEED_ISSUE_TYPES.map((type) => ({ ...type, generation: makeId("generation") }));
    }
    this.issueTypesByProject[OPS_PROJECT_ID] = SEED_ISSUE_TYPES.filter((type) => type.code !== "STORY").map((type) => ({
      ...type,
      generation: makeId("generation"),
    }));
    this.issueTypesByProject[WEB_PROJECT_ID].push({
      code: "EPIC",
      name: "Epic",
      color: "purple",
      // Migration 0003 makes every row that is not an untouched seed a square;
      // the icon is what is drawn.
      shape: "square",
      icon: "layers",
      sortOrder: 40,
      generation: makeId("generation"),
    });
    this.issueTypesByProject[MOB_PROJECT_ID].push({
      code: "INCIDENT",
      name: "Incident",
      color: "amber",
      shape: "diamond",
      icon: null,
      sortOrder: 40,
      generation: makeId("generation"),
    });

    let minute = 10;
    const issue = (
      projectId: string,
      key: string,
      number: number,
      issueType: IssueTypeCode,
      summary: string,
      description: string,
      status: IssueStatusKey,
      priority: IssuePriorityCode,
      assigneeId: string | null,
      reporterId: string,
      day: number,
      // The five planning fields, as one trailing bag rather than as five more
      // positional arguments: most seeds state none of them, and the ones that
      // do are worth being able to read.
      planning: Partial<PlanningFields> = {},
    ): StoredIssue => ({
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
      // `?? null` and not `||`: `storyPoints: 0` is one of the two seeded values
      // this file exists to make clickable, and `0 || null` would seed it as
      // "not estimated".
      storyPoints: planning.storyPoints ?? null,
      startDate: planning.startDate ?? null,
      dueDate: planning.dueDate ?? null,
      originalEstimateMinutes: planning.originalEstimateMinutes ?? null,
      remainingEstimateMinutes: planning.remainingEstimateMinutes ?? null,
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
        // The only seed carrying all five at once, so a reader can see the
        // whole set on one issue: two days of work planned, half of it left.
        {
          storyPoints: 3,
          startDate: "2026-06-15",
          dueDate: "2026-06-26",
          originalEstimateMinutes: 480,
          remainingEstimateMinutes: 240,
        },
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
        // Estimated at **nought**, which is not the same as unestimated. Seeded
        // because every plausible implementation of "show the points if there
        // are any" gets this one wrong and shows nothing.
        { storyPoints: 0 },
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
        // Half a point. `format: double` permits it and the column stores it,
        // so an integer-only formatter truncates this to "1" and nothing fails.
        // The due date stands alone: one end of the window is a legal state.
        { storyPoints: 1.5, dueDate: "2026-07-03" },
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
        // The mirror of TAS-103: started, with no deadline. Between the two,
        // both halves of the stored-date cross-check have something to fire on.
        { startDate: "2026-06-20", originalEstimateMinutes: 120, remainingEstimateMinutes: 90 },
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
        // Estimated but never scheduled, and not started against: the remaining
        // estimate equals the original.
        { storyPoints: 8, originalEstimateMinutes: 960, remainingEstimateMinutes: 960 },
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
      issue(WEB_PROJECT_ID, "WEB", 12, "STORY", "Responsive board layout", "Board columns should collapse gracefully under 900px.", "TODO", "MEDIUM", SOFIA_ID, ANNA_ID, 11, { storyPoints: 13, startDate: "2026-06-22", dueDate: "2026-07-10" }),
      issue(WEB_PROJECT_ID, "WEB", 13, "BUG", "Dark theme contrast on chips", "Type chips fail AA contrast on the dark surface.", "IN_PROGRESS", "HIGH", PRIYA_ID, SOFIA_ID, 12),
      issue(WEB_PROJECT_ID, "WEB", 14, "TASK", "Persist last opened project", "Remember the user's last project on reload.", "DONE", "LOW", ANNA_ID, ANNA_ID, 7),
      issue(MOB_PROJECT_ID, "MOB", 5, "TASK", "Push notification permission flow", "Ask for permission after the first assignment, not on launch.", "TODO", "MEDIUM", TOM_ID, MARK_ID, 10),
      issue(MOB_PROJECT_ID, "MOB", 6, "BUG", "Pull-to-refresh duplicates issues", "List occasionally renders duplicates after refresh.", "IN_PROGRESS", "MEDIUM", MARK_ID, TOM_ID, 11),
      issue(OPS_PROJECT_ID, "OPS", 3, "TASK", "Add board endpoint dashboards", "Grafana panels for /board latency.", "TODO", "LOW", TOM_ID, ANNA_ID, 9),
      // Three values this build does not know, on one project (TAS-173): an
      // EPIC with the URGENT priority, sitting in its own workflow's IN_REVIEW;
      // and a task in BLOCKED_BY_QA, a status no workflow of the project
      // lists, so the board has no column for it. Appended so no seeded id or
      // timestamp above moves, and worded to stay out of every search the e2e
      // suite types.
      issue(WEB_PROJECT_ID, "WEB", 15, "EPIC", "Checkout redesign", "Group the checkout work for the next release.", "IN_REVIEW", "URGENT", SOFIA_ID, ANNA_ID, 13),
      issue(WEB_PROJECT_ID, "WEB", 16, "TASK", "Payment form QA sign-off", "Waiting on QA for the payment form.", "BLOCKED_BY_QA", "MEDIUM", PRIYA_ID, ANNA_ID, 14),
    ];
    // A column longer than one board page (TAS-392): Infra and Ops' Done holds
    // 205 weekly backup checks, so the board — which reads 200 a column — cuts
    // it, counts all 205 and says so at its foot (DESIGN.md §4.9). Oldest
    // first from Jan 5, an hour apart, with valid stamps of their own rather
    // than the seed's minute counter; numbered from 1000 so no key begins with
    // another seed's (OPS-3); worded to stay out of every search the e2e suite
    // types.
    for (let index = 0; index < 205; index += 1) {
      const at = new Date(Date.UTC(2026, 0, 5, 8 + index)).toISOString();
      this.issues.push({
        ...issue(OPS_PROJECT_ID, "OPS", 1000 + index, "TASK", `Nightly backup verified, week ${index + 1}`, "", "DONE", "LOW", null, ANNA_ID, 1),
        createdAt: at,
        updatedAt: at,
      });
    }

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
    // The channel mark (TAS-412, for TAS-411) — **mock only**: no gateway sends
    // one yet. Sofia moved TAS-107 and commented on it through the MCP server
    // with a named token; Mark set TAS-101's priority with a token the server
    // does not name. Every other seeded event and comment has no mark, which
    // is a change made in the UI.
    const viaCursor: ActionVia = { channel: "MCP", tokenName: "Cursor on laptop" };
    const viaToken: ActionVia = { channel: "API_TOKEN", tokenName: null };
    if (tas107) {
      this.pushHistory(tas107.id, "ASSIGNED", ANNA_ID, { previousAssigneeId: null, assigneeId: SOFIA_ID }, ts(16, 43));
      this.pushHistory(tas107.id, "TRANSITIONED", SOFIA_ID, { from: "TODO", to: "IN_PROGRESS" }, ts(17, 14), viaCursor);
      this.comment(tas107, SOFIA_ID, "Picked this up — the token refresh path needs a retry guard first.", ts(17, 20), viaCursor);
      this.comment(tas107, ANNA_ID, "Agreed. Ping me once the guard is in and I will review.", ts(18, 5));
    }
    // An event by somebody who is not on Taska Platform (TAS-398): Priya has
    // an account and is on two other projects, so the details read names her
    // from her profile — the way it names a former member — and the Activity
    // row draws her by that name rather than "Unknown".
    const tas102 = this.issues.find((item) => item.issueKey === "TAS-102");
    if (tas102) {
      this.pushHistory(tas102.id, "UPDATED", PRIYA_ID, { field: "description" }, ts(14, 5));
    }
    if (tas101) {
      this.pushHistory(tas101.id, "TRANSITIONED", MARK_ID, { from: "TODO", to: "IN_PROGRESS" }, ts(13, 31));
      this.pushHistory(tas101.id, "PRIORITY", MARK_ID, { to: "HIGH" }, ts(13, 44), viaToken);
      this.comment(tas101, MARK_ID, "Bumped to high — this blocks the release checklist.", ts(13, 52));
    }

    // Seeded worklogs (TAS-251). TAS-101 has three people's entries, two of them
    // on one day — the tie the server leaves unordered — and TAS-107 has one by
    // an account nobody can name any more, which is what the section draws as
    // "Unknown". Both issues are in Taska Platform, where Anna is the ADMIN who
    // may change anybody's entry, Mark a MEMBER who may change only his own,
    // and Tom a VIEWER who may only read them.
    //
    // Seeding moves neither issue's remaining estimate nor its version: the
    // issues are seeded as they stand *after* this time was logged.
    if (tas101) {
      this.worklog(tas101, SOFIA_ID, 90, "2026-06-12", "Paired on the retry guard.", ts(12, 40));
      this.worklog(tas101, MARK_ID, 120, "2026-06-13", "Traced the release blocker to the gateway timeout.", ts(13, 50));
      this.worklog(tas101, ANNA_ID, 45, "2026-06-13", null, ts(13, 58));
    }
    if (tas107) {
      this.worklog(tas107, FORMER_ACCOUNT_ID, 60, "2026-06-15", "First look at the refresh path.", ts(15, 10));
      // Its history row, by the same account: no profile behind the id, so
      // the details read names nobody (`actor: null`) and Activity says
      // "Unknown" (TAS-398).
      this.pushHistory(tas107.id, "WORKLOG_ADDED", FORMER_ACCOUNT_ID, { worklogSpentMinutes: 60 }, ts(15, 10));
      this.worklog(tas107, SOFIA_ID, 180, "2026-06-17", null, ts(17, 30));
    }
    // A work log longer than one page (TAS-421): the section reads 100 entries
    // a page, so TAS-109's 105 leave five past the first — the «Show more»
    // foot and the total held back until every entry is loaded. Half an hour
    // a day, three people in turn, newest on May 10.
    const tas109 = this.issues.find((item) => item.issueKey === "TAS-109");
    if (tas109) {
      const people = [ANNA_ID, MARK_ID, SOFIA_ID];
      for (let index = 0; index < 105; index += 1) {
        const day = new Date(Date.UTC(2026, 0, 26 + index));
        const workDate = day.toISOString().slice(0, 10);
        this.worklog(tas109, people[index % people.length], 30, workDate, null, `${workDate}T17:00:00Z`);
      }
    }

    // Seeded links so the panel has something to show on first load, and so
    // both directions of the view are reachable: TAS-101 reads "Blocks
    // TAS-102", TAS-102 reads "Is blocked by TAS-101".
    const linkSeed: [string, IssueLinkTypeCode, string][] = [
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

    // Watchers, seeded so every state of the section is reachable by signing in
    // rather than by clicking something first (TAS-193). Anna is ADMIN of TAS
    // and not a member of MOB, so as her:
    //
    // - **TAS-101** — she is watching, alongside Mark and Sofia. The toggle
    //   reads "Watching" on open and the count is three.
    // - **TAS-102** — nobody is watching. The empty state and the unpressed
    //   toggle, which is the pair a screenshot has to show.
    // - **TAS-103** — Mark and Priya are watching and she is not: a populated
    //   list under an unpressed toggle, which is the state that catches a UI
    //   deriving "am I watching" from whether the list is empty.
    // - **MOB-5** — Priya is watching an issue in a project Anna cannot write
    //   to. The read-only view: no add picker, no per-row remove, and a toggle
    //   that shows Anna's own state and cannot change it, because
    //   issue-service's `watch-issue-roles` leaves a VIEWER out (TAS-226).
    // - **TAS-110**, signed in as `tom@example.com` — the seed's VIEWER member,
    //   on the list because Anna put him there: subscribing somebody else checks
    //   only the ADMIN's role. So the toggle reads "Watching" and cannot take
    //   him off, which is the one VIEWER state MOB-5 cannot show (TAS-226).
    //
    // **Priya on TAS-103 is the deliberate one.** She is a member of WEB and
    // MOB and not of TAS, so `GET /projects/{TAS}/members` does not name her
    // and her row draws as "Unknown" — the same sentence the reporter line
    // prints for an id it cannot resolve. Every other seeded watcher is named,
    // so without her that state would be on screen only when a member read
    // fails. It also demonstrates the half of this feature that needs no member
    // list at all: her row can be removed by an ADMIN, because a remove names a
    // `userId` and the row already carries one.
    const watcherSeed: [string, string, string][] = [
      ["TAS-101", ANNA_ID, ANNA_ID],
      ["TAS-101", MARK_ID, MARK_ID],
      // Subscribed by Anna rather than by herself, so `createdBy` differs from
      // `userId` on at least one row — which is what the ADMIN add route does.
      ["TAS-101", SOFIA_ID, ANNA_ID],
      ["TAS-103", MARK_ID, MARK_ID],
      ["TAS-103", PRIYA_ID, ANNA_ID],
      ["MOB-5", PRIYA_ID, PRIYA_ID],
      // Appended, so no row above changes its timestamp.
      ["TAS-110", TOM_ID, ANNA_ID],
      // An account nobody can name any more — see `FORMER_ACCOUNT_ID`.
      ["TAS-106", FORMER_ACCOUNT_ID, ANNA_ID],
    ];
    watcherSeed.forEach(([issueKey, userId, createdBy], index) => {
      const target = this.issues.find((item) => item.issueKey === issueKey);
      if (!target) return;
      this.watchers.push({
        id: makeId("watcher"),
        issueId: target.id,
        projectId: target.projectId,
        userId,
        createdAt: ts(21, 10 + index),
        createdBy,
      });
    });

    // Attachments, seeded so the section is not empty on first load and so all
    // three of its interesting states are reachable by signing in as somebody:
    //
    // - Anna is ADMIN of TAS, so on TAS-101 she sees a delete on **both** rows,
    //   including Mark's — `delete-attachment-roles: ADMIN`;
    // - Mark is a MEMBER of TAS, so signing in as `mark@example.com` (this mock
    //   takes any password) leaves him a delete on his own row and none on
    //   Anna's — `delete-own-attachment-roles: ADMIN,MEMBER`. That contrast is
    //   the whole reason two rows are seeded on one issue and why they have
    //   different uploaders;
    // - Anna is not a member of MOB at all, so MOB-5's attachment is the
    //   read-only view: listed, downloadable, with no upload control and no
    //   delete.
    //
    // Sizes are real-looking and all comfortably under the 2 MB ceiling; the
    // checksums are ETag-shaped literals. No object is seeded into
    // `storeObjects`, because these rows stand for files uploaded long before
    // this session — the bucket is not part of the seed and a download link is
    // signed from the key regardless, exactly as `createPresignedDownloadUrl`
    // would.
    const attachmentSeed: [string, string, string, string, number, string][] = [
      [
        "TAS-101",
        ANNA_ID,
        "login-500-trace.txt",
        "text/plain",
        2411,
        "8f14e45fceea167a5a36dedd4bea2543",
      ],
      [
        "TAS-101",
        MARK_ID,
        "validation-error.png",
        "image/png",
        184320,
        "c9f0f895fb98ab9159f51fd0297e236d",
      ],
      [
        "MOB-5",
        PRIYA_ID,
        "crash-report.json",
        "application/json",
        14877,
        "45c48cce2e2d7fbdea1afc51c7c6ad26",
      ],
    ];
    attachmentSeed.forEach(([issueKey, uploadedBy, fileName, contentType, sizeBytes, checksum], index) => {
      const target = this.issues.find((item) => item.issueKey === issueKey);
      if (!target) return;
      const createdAt = ts(20, 10 + index);
      this.attachments.push({
        id: makeId("attachment"),
        issueId: target.id,
        uploadedBy,
        objectKey: makeId("object"),
        fileName,
        contentType,
        sizeBytes,
        checksum,
        createdAt,
        deletedAt: null,
      });
      // The history row the server writes in the same transaction, so the
      // activity feed's two new sentences are on screen without uploading
      // anything.
      this.pushHistory(
        target.id,
        "ATTACHMENT_UPLOADED",
        uploadedBy,
        { issueId: target.id, uploadedBy, fileName, contentType, sizeBytes },
        createdAt,
      );
    });

    // One row per shape the gateway sends since TAS-243, newest first. The
    // three that open an issue name real TAS issues — Anna's project, and
    // Mark's too — so the route they build lands on a panel rather than on a
    // not-found; the member row names the project and opens its board
    // (TAS-415). The two that open nothing are the two reasons such a row can:
    // about an issue that is gone, and older than the columns.
    const tas104 = this.issues.find((item) => item.issueKey === "TAS-104");
    this.notifications = [
      this.notification("ISSUE_ASSIGNED", "Issue assigned", "TAS-107 was assigned to you", tas107 ?? null, ts(25, 10), null),
      this.notification("ISSUE_COMMENT_CREATED", "New comment", "Mark commented on TAS-101", tas101 ?? null, ts(25, 7), null),
      // Both ids of an issue that no longer exists, so there is no seeded row
      // to take them from: TAS-100 is below the seed's first number, and the
      // id is fixed rather than generated so nothing can ever resolve it.
      this.notification(
        "ISSUE_DELETED",
        "Issue deleted",
        "TAS-100 was deleted",
        { id: DELETED_ISSUE_ID, issueKey: "TAS-100", projectId: TASKA_PROJECT_ID },
        ts(25, 3),
        ts(25, 9),
      ),
      // Written before the gateway stored the three columns: the migration did
      // not backfill them, so all three are null, and the prose names the
      // issue the way the gateway wrote bodies then — by raw uuid. Ugly in the
      // panel, and that ugliness is the gateway's history, not this seed's.
      this.notification("ISSUE_TRANSITIONED", "Status changed", `Issue ${tas104?.id ?? ""} moved to DONE`, null, ts(24, 58), null),
      // Not about an issue: about a project. Since backend TAS-415 (#227) a
      // member row carries the project's id — no issue — and the server's own
      // words, so it opens that board (§4.12). Rows written before it keep a
      // null `projectId`: there was no backfill.
      this.notification(
        "MEMBER_ADDED",
        "You were added to a project",
        "You were added to Taska Platform",
        { id: null, projectId: TASKA_PROJECT_ID },
        ts(24, 50),
        ts(25, 8),
      ),
      // An attachment notification as issue-service writes it since backend
      // PR #191 (TAS-245): `PayloadSerializer` puts all three issue fields on
      // the payload, so the row carries issueKey and projectId beside issueId
      // and opens TAS-101 like any other issue row, and the body names the
      // issue by its key. Read, so it does not move the unread total the other
      // rows already add up to.
      this.notification(
        "ISSUE_ATTACHMENT_ADDED",
        "Attachment added",
        `An attachment was added to ${tas101?.issueKey ?? "TAS-101"}`,
        tas101 ?? null,
        ts(24, 45),
        ts(24, 47),
      ),
    ];
  }

  login(input: LoginInput): AuthTokens {
    const user = this.users.find((item) => item.email === input.email);
    // A credential lockout is the one refusal this route does not answer with
    // "Invalid credentials". The gateway raises `PERMISSION_DENIED` — 403 over
    // REST — with the deadline twice: in the message, as it always has, and
    // since backend PR #199 as `details.lockedUntil`, the one refusal that
    // fills `details` at all (`AuthServiceImpl.accountLockedError`; read by
    // src/lib/accountLock.ts). Every other refusal `AuthServiceImpl.login` can
    // reach is `UNAUTHENTICATED` or, for blank input, `FAILED_PRECONDITION`. So
    // `BLOCKED` and `INVITED` keep the branch below, and only `LOCKED` takes
    // this one.
    //
    // Reproduced here because nothing else can reproduce it: reaching `LOCKED`
    // takes repeated failed sign-ins against the real auth-service, so without
    // this the login screen's lock branch would ship with a green
    // `npm run check` and nothing having run it. Omar is the seeded row.
    if (user?.status === "LOCKED") {
      const until = new Date(Date.now() + CREDENTIAL_LOCK_DURATION_MS);
      // `Instant.toString()` on the server, microseconds and all; three digits
      // here, the most a `Date` holds — the same loss the message carries.
      throw new MockApiError("PERMISSION_DENIED", accountLockedMessage(until), { lockedUntil: until.toISOString() });
    }
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

  /**
   * `POST /auth/invitations/accept`, in the order the stand checks it. First
   * auth-service's gRPC transport, before the service sees the request: a
   * blank token, then a blank password, each refused in the transport's own
   * words — "body.token must not be blank", "body.newPassword must not be
   * blank" (`AuthGrpcService.setPasswordByToken` through
   * `GrpcRequestValidators.requireNonBlank`, `String.isBlank`). Then
   * `AuthServiceImpl.setPasswordByToken`'s (develop `e8a8d316b326`): the
   * password policy, the token's length, then one 401 for every way the link
   * can fail to be live. The service's own "Token required" and "Password is
   * required" sit behind the transport and are never reached on this route.
   * The password is checked before the token is looked up, which is why a weak
   * one does not spend the link.
   *
   * No session is opened, and the signed-in reader — if any — is not touched:
   * the route answers 204 with no tokens, and the client signs in afterwards.
   * This store never checks a password at sign-in, so the activated account
   * then signs in with any.
   */
  acceptInvitation(input: AcceptInvitationInput): void {
    const { token, newPassword } = input;
    // `trim() === ""` approximates Java's `String.isBlank`, and is not it: JS
    // trims U+00A0, U+2007, U+202F and U+FEFF, which `Character.isWhitespace`
    // does not count, and keeps U+001C–U+001F, which it does. Nobody types either into these
    // two fields, so the difference is named here rather than modelled.
    if (typeof token !== "string" || token.trim() === "") {
      throw new MockApiError("INVALID_ARGUMENT", "body.token must not be blank");
    }
    if (typeof newPassword !== "string" || newPassword.trim() === "") {
      throw new MockApiError("INVALID_ARGUMENT", "body.newPassword must not be blank");
    }
    const policy = passwordPolicyRefusal(newPassword);
    if (policy) throw new MockApiError("INVALID_ARGUMENT", policy);
    if (token.length > 256) {
      throw new MockApiError("INVALID_ARGUMENT", "Invite token is too long");
    }
    const found = this.inviteTokens.find((item) => item.token === token);
    const user = found ? this.users.find((item) => item.id === found.userId) : undefined;
    if (!found || user?.status !== "INVITED" || found.usedAt !== null || found.expiresAt <= Date.now()) {
      throw new MockApiError("UNAUTHENTICATED", "Invalid or expired token");
    }
    found.usedAt = Date.now();
    user.status = "ACTIVE";
  }

  /**
   * `GET /users` (backend #204), checked in the order the request meets the
   * checks: the gateway binds the raw parameters against the contract first,
   * before authentication — "Invalid request parameters" for a query under 3
   * or over 100 UTF-16 characters and a page or size out of range — and then
   * auth-service measures the *trimmed* query in code points and refuses it
   * in its own sentence. "  ab " passes the first and fails the second.
   *
   * The rest is `UserRepository.searchDirectory`: `ACTIVE`, `INVITED` and
   * `LOCKED` accounts, a substring of the lower-cased display name or email,
   * ordered `lower(display_name), lower(email), id` — compared here with `<`
   * on the lower-cased strings rather than `localeCompare`, because the
   * database's collation is not stated anywhere this build can read — and
   * `pageSize + 1` rows, so `hasMore` is whether the extra one came back.
   * `%`, `_` and `!` are escaped there and literal here by construction.
   */
  searchUsers(params: SearchUsersParams): DirectoryPage {
    const { query, page = 0, pageSize = 20 } = params;
    if (
      typeof query !== "string" ||
      query.length < 3 ||
      query.length > 100 ||
      !Number.isInteger(page) ||
      page < 0 ||
      page > 1000 ||
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 50
    ) {
      throw new MockApiError("INVALID_ARGUMENT", "Invalid request parameters");
    }
    const needle = query.trim().toLowerCase();
    const length = [...needle].length;
    if (length < 3 || length > 100 || hasIsoControl(needle)) {
      throw new MockApiError("INVALID_ARGUMENT", DIRECTORY_QUERY_REFUSAL_MESSAGE);
    }
    const rows = this.users
      .filter(
        (user) =>
          DIRECTORY_STATUSES.has(user.status) &&
          (user.displayName.toLowerCase().includes(needle) || user.email.toLowerCase().includes(needle)),
      )
      .sort(
        (left, right) =>
          byText(left.displayName.toLowerCase(), right.displayName.toLowerCase()) ||
          byText(left.email.toLowerCase(), right.email.toLowerCase()) ||
          byText(left.id, right.id),
      )
      .slice(page * pageSize, page * pageSize + pageSize + 1);
    return {
      items: rows.slice(0, pageSize).map((user) => {
        const avatar = this.avatars.get(user.id);
        return {
          id: user.id,
          displayName: user.displayName,
          email: user.email,
          avatarUrl: avatar && this.avatarObjects.has(avatar.objectKey) ? avatar.downloadUrl : null,
        };
      }),
      hasMore: rows.length > pageSize,
    };
  }

  /**
   * `POST /auth/invitations` (backend #204), in the order the request meets the
   * checks: the gateway's `GLOBAL_ADMIN_REQUIRED` (403 "User doesn't have
   * permission"), then its binding of the body against the contract (400
   * "Invalid request parameters" for a missing email, one over 320 characters
   * or a name over 128), then `AdminInviteUserServiceImpl` — the address
   * trimmed and lower-cased and refused in its own sentence, the name likewise,
   * and then what the address already belongs to. Every branch and sentence is
   * that service's; see `TaskaApi.inviteUser` for the table.
   *
   * The new link is never returned, as the server never returns it: the only
   * tokens anybody can accept here are the seeded ones (`MOCK_INVITE_TOKENS`).
   */
  inviteUser(input: InviteUserInput): InvitationResult {
    if (this.currentUser().globalRole !== "GLOBAL_ADMIN") {
      throw new MockApiError("PERMISSION_DENIED", "User doesn't have permission");
    }
    const { email: rawEmail, displayName: rawName, resend = false } = input;
    if (
      typeof rawEmail !== "string" ||
      rawEmail.length > INVITE_EMAIL_MAX_LENGTH ||
      (typeof rawName === "string" && rawName.length > INVITE_DISPLAY_NAME_MAX_LENGTH)
    ) {
      throw new MockApiError("INVALID_ARGUMENT", "Invalid request parameters");
    }
    const email = rawEmail.trim().toLowerCase();
    if (email === "" || email.length > INVITE_EMAIL_MAX_LENGTH || !MOCK_EMAIL_PATTERN.test(email)) {
      throw new MockApiError("INVALID_ARGUMENT", "A valid email address is required (maximum 320 characters)");
    }
    const name = typeof rawName !== "string" || rawName.trim() === "" ? email.slice(0, email.indexOf("@")) : rawName.trim();
    if ([...name].length > INVITE_DISPLAY_NAME_MAX_LENGTH || hasIsoControl(name)) {
      throw new MockApiError(
        "INVALID_ARGUMENT",
        "Display name must contain at most 128 characters and no control characters",
      );
    }

    const existing = this.users.find((user) => user.email.trim().toLowerCase() === email);
    if (!existing) {
      const user: StoredUser = {
        id: mockUuid(),
        email,
        displayName: name,
        status: "INVITED",
        globalRole: "USER",
      };
      this.users.push(user);
      return this.queueInvitation(user, true);
    }
    if (existing.status !== "INVITED") {
      // Whatever the status — ACTIVE, LOCKED or BLOCKED — and nothing about the
      // account changes: an invitation is not a password reset.
      throw new MockApiError("ALREADY_EXISTS", "An account with this email already exists");
    }
    const latest = this.inviteTokens.filter((item) => item.userId === existing.id).at(-1);
    if (latest) {
      const valid = latest.usedAt === null && latest.expiresAt > Date.now();
      if (!resend && valid) {
        return this.invitationResult(existing, false, false, latest.expiresAt);
      }
      // From the last link's *making*, whatever became of it since: a resend a
      // moment after a resend is refused even though the first is now dead.
      const allowedAt = latest.createdAt + INVITE_RESEND_COOLDOWN_MS;
      if (Date.now() < allowedAt) {
        const seconds = Math.max(1, Math.floor((allowedAt - Date.now()) / 1000) + 1);
        throw new MockApiError("RESOURCE_EXHAUSTED", "Invitation was sent recently; try again later", {
          retryAfterSeconds: String(seconds),
        });
      }
    }
    return this.queueInvitation(existing, false);
  }

  /** Revoke every live link of this account, make a new one, and say it is queued. */
  private queueInvitation(user: StoredUser, created: boolean): InvitationResult {
    const madeAt = Date.now();
    for (const item of this.inviteTokens) {
      if (item.userId === user.id && item.usedAt === null) item.usedAt = madeAt;
    }
    const token = { token: mockInviteToken(), userId: user.id, createdAt: madeAt, expiresAt: madeAt + INVITE_TOKEN_TTL_MS, usedAt: null };
    this.inviteTokens.push(token);
    return this.invitationResult(user, created, true, token.expiresAt);
  }

  private invitationResult(user: StoredUser, created: boolean, deliveryQueued: boolean, expiresAt: number): InvitationResult {
    // `INVITED` whatever the account is — the gateway's client hard-codes it.
    return { userId: user.id, status: "INVITED", deliveryQueued, expiresAt: new Date(expiresAt).toISOString(), created };
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

  /**
   * `GET /projects`: the reader's own projects, and since backend PR #159
   * (TAS-146) **not the archived ones** — `archived_at IS NULL` in the
   * repository's query, for every caller. Ordered by `created_at`, then `id`
   * (`ProjectRepository`, TAS-394): a new project comes last. Nothing lists an archived project;
   * it is still read by id (`getProject`, `getProjectContext`).
   */
  listProjects(): Project[] {
    return this.memberProjects()
      .filter((project) => !project.archivedAt)
      .sort((a, b) => byText(a.createdAt, b.createdAt) || byText(a.id, b.id))
      .map((project) => this.withCurrentUserRole(project));
  }

  /** Every project the reader is on, archived ones included — what a project-scoped read checks against. */
  private memberProjects(): Project[] {
    return this.projects.filter((project) => project.memberIds?.includes(this.currentUserId));
  }

  createProject(input: CreateProjectInput): Project {
    const key = input.projectKey.trim().toUpperCase();
    if (!key || this.projects.some((project) => project.projectKey === key)) {
      throw new MockApiError("ALREADY_EXISTS", "Project key already exists");
    }
    const name = input.name.trim();
    if (!name || name.length > PROJECT_NAME_MAX_LENGTH) {
      throw new MockApiError("INVALID_ARGUMENT", PROJECT_NAME_REFUSAL);
    }
    const description = input.description?.trim() ?? "";
    if (description.length > PROJECT_DESCRIPTION_MAX_LENGTH) {
      throw new MockApiError("INVALID_ARGUMENT", PROJECT_DESCRIPTION_REFUSAL);
    }
    // The contract's pattern, applied before the value is stored rather than
    // after: `CreateProjectRequestDto.color` is `^#[0-9A-Fa-f]{6}$`, so a
    // gateway would refuse this body and this store must refuse it too — one
    // that accepted "red" would let a screen ship a colour no server takes.
    //
    // An empty colour is "none given" here and not a refusal, unlike on the
    // update below, and the two are consistent rather than in tension: create
    // has no "clear" to distinguish an empty value from an absent one, so both
    // legs treat `""` as a project that stated no colour — `RestTaskaApi`
    // omits a falsy `color` from the body for exactly this reason.
    const color = input.color?.trim() ?? "";
    if (color && !PROJECT_COLOR_PATTERN.test(color)) {
      throw new MockApiError("INVALID_ARGUMENT", PROJECT_COLOR_REFUSAL);
    }
    const project = this.project(
      makeId("project"),
      key,
      name,
      // What was typed, or nothing at all — never an invented description.
      // This used to substitute "Project workspace", which is the *card's*
      // placeholder for a project with no description: the store was keeping
      // the UI's own empty state as data, so no project created here could
      // ever demonstrate the absent case the card draws for (TAS-148).
      description || undefined,
      color || undefined,
      [this.currentUserId],
      now(),
    );
    // Last, as the server lists it: the newest `created_at` (TAS-394).
    this.projects.push(project);
    // `ProjectServiceImpl.createProject` seeds the registry in the same write.
    this.issueTypesByProject[project.id] = SEED_ISSUE_TYPES.map((type) => ({ ...type, generation: makeId("generation") }));
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
    return this.withCurrentUserRole(project);
  }

  /**
   * `PATCH /projects/{projectId}` — backend PR #155 (TAS-145), merged.
   * Reproduces what `ProjectServiceImpl.updateProject` does, including the
   * answers the yml does not state: the refusal is ADMIN-only and
   * `PERMISSION_DENIED`, a missing project is `NOT_FOUND`, an archived one is
   * the archived refusal (backend PR #159) — after the role, so only its ADMIN
   * is told —, a body with nothing in it is a **success** that changes nothing,
   * an explicit `null` clears `description` or `color` while an absent key
   * keeps it, and a blank description is stored as `null`.
   *
   * The order of the first two checks is the server's own and is load-bearing
   * for §4.18: a project this reader cannot see must answer the same way as one
   * that does not exist, so the existence check runs first and a non-member of
   * a real project then takes the 403. One order differs: the gateway judges
   * the body before it looks the project up, and this store judges it after
   * the role and the archive. No UI path sends a body the gateway refuses.
   *
   * `updatedAt` moves only when something actually changed, which is what makes
   * the "nothing to update" case observable rather than merely quiet.
   *
   * **What this store cannot produce: the 409.** The gateway answers `ABORTED`
   * — "Project was concurrently modified by another request, please retry" —
   * when two writes race, and nothing here races: the store's methods run to
   * completion synchronously and only their *resolution* is delayed. Inventing
   * a trigger for it would be inventing a mechanism this store does not have.
   * So the conflict exists against `rest` only, `isConflict` in
   * src/api/errors.ts is what recognises it, and the UI path is covered there.
   */
  updateProject(projectId: string, input: UpdateProjectInput): Project {
    const project = this.projects.find((item) => item.id === projectId);
    if (!project) {
      throw new MockApiError("NOT_FOUND", "Project not found");
    }
    if (this.getMembership(projectId).role !== "ADMIN") {
      throw new MockApiError("PERMISSION_DENIED", "Only a project admin can edit this project");
    }
    this.refuseArchivedProject(project);

    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name || name.length > PROJECT_NAME_MAX_LENGTH) {
        throw new MockApiError("INVALID_ARGUMENT", PROJECT_NAME_REFUSAL);
      }
    }
    if (
      input.description !== undefined &&
      input.description !== null &&
      input.description.length > PROJECT_DESCRIPTION_MAX_LENGTH
    ) {
      throw new MockApiError("INVALID_ARGUMENT", PROJECT_DESCRIPTION_REFUSAL);
    }
    // `""` is refused here and accepted on create: the pattern rejects the
    // empty string, and on this route an empty colour is not a clear. The
    // clear is an explicit `null`, which the pattern never sees (`clear_color`
    // on the proto since PR #155's head `28f5fe1`).
    if (input.color !== undefined && input.color !== null && !PROJECT_COLOR_PATTERN.test(input.color)) {
      throw new MockApiError("INVALID_ARGUMENT", PROJECT_COLOR_REFUSAL);
    }

    // `null` is stored as `null`, so the answer carries `"color": null` the
    // way the gateway's Jackson does rather than dropping the key. A string
    // description is trimmed on the way in, like `createProject` above, and a
    // blank one is stored as `null` — the same clear, as PR #155 merged it.
    const changes: Partial<Project> = {};
    if (input.name !== undefined) changes.name = input.name.trim();
    if (input.description !== undefined) changes.description = input.description?.trim() || null;
    if (input.color !== undefined) changes.color = input.color;

    if (Object.keys(changes).length === 0) {
      // The service logs "nothing to update" and answers 200 with the project
      // as it stands. Not a 400: a caller that sends no changes has asked for
      // nothing and is told nothing changed.
      return this.withCurrentUserRole(project);
    }

    Object.assign(project, changes, { updatedAt: now() });
    // `MOCK_PROJECT_TRIGGERS.adminsLeftMeanwhile`: the other admins stepped down.
    if (input.description?.toLowerCase().includes(MOCK_PROJECT_TRIGGERS.adminsLeftMeanwhile)) {
      for (const member of this.membersByProject[projectId] ?? []) {
        if (member.role === "ADMIN" && member.userId !== this.currentUserId) member.role = "MEMBER";
      }
    }
    return this.withCurrentUserRole(project);
  }

  /**
   * `DELETE /projects/{projectId}` — backend PR #159 (TAS-146), merged and
   * deployed 2026-10-23, reproducing `ProjectServiceImpl` as merged:
   *
   * - a missing project is `NOT_FOUND` "Project not found";
   * - a caller who is not a member, and a member below ADMIN, are both
   *   `PERMISSION_DENIED` "Project ADMIN role is required";
   * - otherwise `archivedAt` is set once, and a second call answers with the
   *   original instant and writes nothing. This route never answers the
   *   archived refusal.
   *
   * The answer carries `currentUserRole: "ADMIN"` — the only role the route
   * lets through. `updatedAt` moves with the first archive and only then: the
   * save that sets `archivedAt` stamps it (`@LastModifiedDate`), and the second
   * call saves nothing.
   *
   * No `PROJECT_ARCHIVED` notification is put in the inbox. The server sends
   * one to every member but the one who archived, and this store's inbox is
   * one list read by whoever is signed in — so the archiver would read their
   * own, which the server never sends them.
   */
  archiveProject(projectId: string): Project {
    const project = this.projects.find((item) => item.id === projectId);
    if (!project) {
      throw new MockApiError("NOT_FOUND", "Project not found");
    }
    const member = this.membersByProject[projectId]?.find((item) => item.userId === this.currentUserId);
    if (member?.role !== "ADMIN") {
      throw new MockApiError("PERMISSION_DENIED", "Project ADMIN role is required");
    }
    if (!project.archivedAt) {
      const at = now();
      project.archivedAt = at;
      project.updatedAt = at;
    }
    return { ...project, currentUserRole: "ADMIN" };
  }

  /**
   * The archived refusal (backend PR #159 as merged), the same on every write
   * of every service: 400 `FAILED_PRECONDITION` "Project is archived" with
   * `details.reason: "PROJECT_ARCHIVED"` — the one field a reader may key on
   * (`isProjectArchived`). No read calls this: an archived project is read
   * like any other.
   */
  private refuseArchivedProject(project: Project | undefined): void {
    if (project?.archivedAt) {
      throw new MockApiError("FAILED_PRECONDITION", PROJECT_ARCHIVED_MESSAGE, { reason: PROJECT_ARCHIVED_REASON });
    }
  }

  /**
   * The archived refusal for the writes that check membership before the
   * archive and the role after it — issue-service's writes, workflow-service's
   * and project-service's member writes (`ProjectWriteGuard`), all three in
   * that order as merged. An outsider is never told a project is archived: on
   * an archived project a non-member is refused as one ("Access denied", the
   * sentence `ProjectRoleChecker` gives), and a member — whatever their role —
   * gets the archived refusal before the role is looked at.
   *
   * Called after the lookups that answer 404 and before every role check a
   * write makes. Most issue writes here check no role and no membership at all
   * on a project that is *not* archived (the looser half `membersByProject`
   * documents), and they keep that; only the archived project is held to the
   * server's order.
   */
  private refuseArchivedWrite(projectId: string): void {
    const project = this.projects.find((item) => item.id === projectId);
    if (!project?.archivedAt) return;
    if (!this.membersByProject[projectId]?.some((member) => member.userId === this.currentUserId)) {
      throw new MockApiError("PERMISSION_DENIED", "Access denied");
    }
    this.refuseArchivedProject(project);
  }

  /**
   * `currentUserRole` (backend TAS-137, PR #152), attached here so `getProject`
   * and `listProjects` answer the same shape — and so does `rest`: PR #152,
   * read at head `1ad6ffad815d`, rewrote `ProjectService.listMyProjects` to
   * join `project_members` and fill the role on every row of `GET /projects`
   * too, not only the single-project read this method used to serve alone. The
   * rest leg derives the whole of `getMembership` from this one field, and a
   * mock that carried it on only one of the two routes would make that
   * derivation untestable against anything but a stub for the other.
   *
   * A copy rather than a stored field, because the role belongs to the reader
   * and not to the project row — written into `this.projects` it would leak
   * one reader's role into every other answer built from that array. Absent
   * for a non-member, which is the mock's own shape: a deployed gateway answers
   * a non-member's project read with 403 rather than a project (see the
   * divergence below), states the reader's role on every 200, and writes an
   * explicit `null` only on the `POST /projects` response
   * (`src/domain/types.ts`). Every reader treats an absent key and a `null`
   * alike.
   *
   * **Known mock divergence: no entry in docs/ai/API-DIVERGENCE.md names
   * `getProject` by route, but the convention behind it is recorded — under the
   * attachments section: this store's project-scoped reads do not check
   * membership.** `getProject` answers this shape even for a
   * non-member — the project row, with no `currentUserRole` — where the real
   * gateway would refuse the read with 403 before this field ever enters it.
   * `listProjects` does not share that gap: it already filters to
   * `project.memberIds.includes(this.currentUserId)`, the same membership
   * `findAllByMemberUserId`'s join enforces on the wire, so every row it
   * returns is one this reader is actually on.
   */
  private withCurrentUserRole(project: Project): Project {
    const role = this.membersByProject[project.id]?.find((member) => member.userId === this.currentUserId)?.role;
    return role ? { ...project, currentUserRole: role } : project;
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
    // The nested summary is rebuilt per read rather than served out of the
    // stored row: an avatar can change without the membership changing, and the
    // server's own row is a join that is evaluated when it is asked for. A row
    // that named nobody still names nobody.
    return (this.membersByProject[projectId] ?? []).map((member) => ({
      ...member,
      user: member.user ? this.userSummary(member.userId) : undefined,
    }));
  }

  /**
   * `POST /projects/{projectId}/members` (TAS-158). Reproduces
   * `ProjectMemberValidatorImpl.validateBeforeAdd` at backend `develop`
   * `1cfe4d79f074` — its order and its sentences, which name ids because the
   * server's do — after the shape check every member write shares (see
   * `memberWriteId`).
   *
   * **An id nobody holds is added, not refused** (TAS-227). The server does not
   * ask auth-service whether the user exists, so any well-formed id is a 201,
   * and the row comes back from `GET …/members` with no name and no email. This
   * store does the same: the row is stored with no `user`, and `listMembers`
   * keeps it that way. Refusing it here would be the one false claim this route
   * could make.
   *
   * `memberIds` moves with the row. It is what `listProjects` filters on — the
   * mock's stand-in for the membership join `GET /projects` makes on the wire —
   * so without it an added person would not see the project and a removed one
   * still would.
   */
  addProjectMember(projectId: string, userId: string, role: ProjectRole): ProjectMemberWriteResult {
    const id = memberWriteId(userId);
    const rows = this.memberRowsForWrite(projectId);
    this.refuseArchivedWrite(projectId);
    if (rows.find((member) => member.userId === this.currentUserId)?.role !== "ADMIN") {
      throw new MockApiError(
        "PERMISSION_DENIED",
        `Actor ${this.currentUserId} is not an admin of project: ${projectId}`,
      );
    }
    if (rows.some((member) => member.userId === id)) {
      throw new MockApiError("ALREADY_EXISTS", `User with id: ${id} already exists in project: ${projectId}`);
    }
    rows.push({
      userId: id,
      role,
      addedAt: now(),
      addedBy: this.currentUserId,
      // Whether a summary exists is decided once, here, and `listMembers`
      // rebuilds it on every read only for a row that has one — which is how an
      // unknown id stays unnamed. Nothing in this store creates a user later.
      user: this.users.some((user) => user.id === id) ? this.userSummary(id) : undefined,
    });
    const project = this.projects.find((item) => item.id === projectId);
    if (project) project.memberIds = [...(project.memberIds ?? []), id];
    return { projectId, userId: id, role };
  }

  /**
   * `PATCH /projects/{projectId}/members/{userId}`. The whole of the server's
   * refusal order lives in `memberForModify`; a `PATCH` that names the role the
   * member already holds is written anyway, as `updateRole` writes it — except
   * for the last ADMIN, whom the server refuses to touch at all.
   */
  changeProjectMemberRole(projectId: string, userId: string, role: ProjectRole): ProjectMemberWriteResult {
    const target = this.memberForModify(projectId, userId);
    target.role = role;
    return { projectId, userId: target.userId, role };
  }

  /**
   * `DELETE /projects/{projectId}/members/{userId}`. Only the membership goes,
   * as on the server: an issue assigned to the person keeps its assignee, and a
   * subscription of theirs keeps its row.
   */
  removeProjectMember(projectId: string, userId: string): void {
    const target = this.memberForModify(projectId, userId);
    this.membersByProject[projectId] = this.memberRowsForWrite(projectId).filter((member) => member !== target);
    const project = this.projects.find((item) => item.id === projectId);
    if (project) project.memberIds = (project.memberIds ?? []).filter((memberId) => memberId !== target.userId);
  }

  /**
   * The rows `getRequiredMembersInProject` reads before any member write, and
   * its one refusal: no rows is `NOT_FOUND`, in the validator's own words that
   * the project does not exist. The server's read is every ADMIN plus the actor
   * and the target, so it comes back empty for a real project only if that
   * project has no ADMIN — and through these routes it cannot lose its last
   * one, while creating a project makes its creator one (`ProjectServiceImpl`).
   * This store reads all of a project's rows, which is the same answer for
   * every project it can hold.
   */
  private memberRowsForWrite(projectId: string): ProjectMember[] {
    const rows = this.membersByProject[projectId];
    if (!rows?.length) {
      throw new MockApiError("NOT_FOUND", `Project: ${projectId} doesn't exist`);
    }
    return rows;
  }

  /**
   * `validateBeforeModify`, shared by the role change and the removal, in the
   * validator's order since backend PR #185 (TAS-229): the actor's role is
   * checked **before** the target's membership, so a non-admin is told
   * `PERMISSION_DENIED` whoever they name — on the project or not — and learns
   * nothing about who is a member. Only an ADMIN can get `NOT_FOUND` for a
   * target who is not on the project. Then the last-admin rule, which is
   * `FAILED_PRECONDITION` (a 400 on the wire) with `details.reason:
   * "LAST_ADMIN"` (backend TAS-394) and counts every ADMIN row the project has,
   * the actor's own included. A project with no rows at all is
   * still `NOT_FOUND`, first, from `memberRowsForWrite`. An archived project
   * answers the archived refusal to any member before the role is checked
   * (`refuseArchivedWrite`, `ProjectWriteGuard` as merged in backend PR #159),
   * so its last ADMIN is told it is archived rather than that they are the
   * last admin.
   */
  private memberForModify(projectId: string, userId: string): ProjectMember {
    const id = memberWriteId(userId);
    const rows = this.memberRowsForWrite(projectId);
    this.refuseArchivedWrite(projectId);
    if (rows.find((member) => member.userId === this.currentUserId)?.role !== "ADMIN") {
      throw new MockApiError(
        "PERMISSION_DENIED",
        `User with id: ${this.currentUserId} is not an admin of project: ${projectId}`,
      );
    }
    const target = rows.find((member) => member.userId === id);
    if (!target) {
      throw new MockApiError(
        "NOT_FOUND",
        `Project member with id ${id} was not found in project with id ${projectId}`,
      );
    }
    if (target.role === "ADMIN" && rows.filter((member) => member.role === "ADMIN").length <= 1) {
      throw new MockApiError("FAILED_PRECONDITION", `Can't modify last admin: ${id} in project: ${projectId}`, {
        reason: LAST_ADMIN_REASON,
      });
    }
    return target;
  }

  /**
   * `GET /projects/{projectId}/context` (backend PR #169, TAS-212), with the
   * access rule project-service's `ProjectServiceImpl.getProjectContext` states
   * since backend PR #186 (TAS-255, head `cc03c0d`):
   *
   * - a missing project is `NOT_FOUND` "Project not found";
   * - a reader with no membership row is `PERMISSION_DENIED` "You don't have
   *   access to this project", whatever their global role — a `GLOBAL_ADMIN`
   *   included — and that is checked before any of the three sub-reads
   *   (members, labels, workflows) starts;
   * - a sub-read that fails fails the whole read with its own status. The
   *   context never answers a part it could not read as an empty list.
   *
   * Unlike `getProject` in this store, which answers a non-member, this read
   * keeps the gateway's access rule. The third point has no counterpart here:
   * this store is one synchronous object, so a single leg cannot fail on its
   * own, and the mock answers either everything or the refusal above.
   *
   * `issueTypes` is the project's registry in the server's order
   * (`registryOf`); `workflows` holds one entry per registry type — its own
   * binding, else the shared default — each without timestamps, and the labels
   * carry only `id`, `name` and `color` — the shapes the context sends, not the
   * shapes the separate routes send.
   */
  /**
   * `GET /meta`. A copy, so nothing a caller does to the answer reaches the
   * dictionaries this store checks its writes against.
   */
  getMeta(): EnumDictionaries {
    const copy = (dictionary: DictionaryEntry[] | null) => dictionary?.map((entry) => ({ ...entry })) ?? null;
    return {
      issueTypes: copy(META.issueTypes),
      priorities: copy(META.priorities),
      linkTypes: copy(META.linkTypes),
      // Read the way the rest leg reads the wire: prefix off, placeholders out.
      linkViewTypes:
        META.linkViewTypes
          ?.map((entry) => ({ ...entry, code: toViewLinkType(entry.code) }))
          .filter((entry) => entry.code !== "") ?? null,
      notificationTypes: copy(META.notificationTypes),
      userStatuses: copy(META.userStatuses),
    };
  }

  /** The project's registry in the server's order (`byRegistryOrder`); `[]` for a project with none. */
  private registryOf(projectId: string): ProjectIssueType[] {
    return [...(this.issueTypesByProject[projectId] ?? [])].sort(byRegistryOrder);
  }

  /** Whether the project's registry holds this key. */
  private inRegistry(projectId: string, code: string): boolean {
    return (this.issueTypesByProject[projectId] ?? []).some((type) => type.code === code);
  }

  /** The workflow an issue of this type follows in this project: its own, or the default. */
  private workflowFor(projectId: string, issueType: string): WorkflowDefinition {
    const overrides = this.workflowOverrides[projectId];
    return (overrides && Object.hasOwn(overrides, issueType) ? overrides[issueType] : undefined) ?? this.workflow;
  }

  getProjectContext(projectId: string): ProjectContext {
    const project = this.projects.find((item) => item.id === projectId);
    if (!project) {
      throw new MockApiError("NOT_FOUND", "Project not found");
    }
    const member = this.membersByProject[projectId]?.find((item) => item.userId === this.currentUserId);
    if (!member) {
      throw new MockApiError("PERMISSION_DENIED", "You don't have access to this project");
    }
    const registry = this.registryOf(projectId);
    return {
      project: this.withCurrentUserRole(project),
      role: member.role,
      members: this.listMembers(projectId),
      labels: this.listProjectLabels(projectId).map(({ id, name, color }) => ({ id, name, color })),
      issueTypes: registry.map((type) => ({ ...type })),
      workflows: Object.fromEntries(
        registry.map(({ code: issueType }) => {
          const { createdAt: _createdAt, updatedAt: _updatedAt, ...workflow } = this.workflowFor(projectId, issueType);
          // `GetWorkflowForProject` reads only the visible transitions, and the
          // context's transitions carry no `hidden` at all (backend PR #208).
          // Both by `sortOrder`, as its repositories read them (`ORDER BY
          // sort_order ASC`): an edit renumbers a row in place (backend PR
          // #225), and the panel's move buttons follow this order.
          const bySortOrder = <T extends { sortOrder: number }>(items: readonly T[]) =>
            [...items].sort((a, b) => a.sortOrder - b.sortOrder);
          const transitions = bySortOrder(workflow.transitions.filter((transition) => !transition.hidden)).map(
            ({ hidden: _hidden, ...transition }) => transition,
          );
          return [issueType, { ...workflow, statuses: bySortOrder(workflow.statuses), transitions }];
        }),
      ),
    };
  }

  /**
   * `GET /projects/{projectId}/workflows` (backend PR #208, TAS-381): the
   * gateway's `getProject` first — "Project not found", then a non-member's
   * "You don't have access to this project", a `GLOBAL_ADMIN` included — and
   * then `ProjectWorkflowListService`: the project's registry types in its
   * order (backend #226), each resolved to the project's own workflow or the
   * shared default, one entry per workflow at the position of its first type.
   * Statuses and every transition, hidden ones included, by `sortOrder`. Since
   * backend TAS-436 (develop `78019ece`) the project's own workflows no type
   * runs on — donors — follow with `issueTypes: []`, in id order, and the
   * shared default is listed only while a type runs on it.
   */
  listProjectWorkflows(projectId: string): ProjectWorkflowEntry[] {
    this.getProject(projectId);
    if (!this.membersByProject[projectId]?.some((member) => member.userId === this.currentUserId)) {
      throw new MockApiError("PERMISSION_DENIED", "You don't have access to this project");
    }
    const entries: ProjectWorkflowEntry[] = [];
    for (const { code: issueType } of this.registryOf(projectId)) {
      const workflow = this.workflowFor(projectId, issueType);
      const entry = entries.find((item) => item.workflow.id === workflow.id);
      if (entry) entry.issueTypes.push(issueType);
      else entries.push({ workflow: this.workflowView(workflow), issueTypes: [issueType], shared: workflow === this.workflow });
    }
    const donors = (this.ownedWorkflows[projectId] ?? [])
      .filter((workflow) => !entries.some((entry) => entry.workflow.id === workflow.id))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const workflow of donors) entries.push({ workflow: this.workflowView(workflow), issueTypes: [], shared: false });
    return entries;
  }

  /**
   * `POST /projects/{projectId}/workflows`, in `WorkflowBindingTransactions.create`'s
   * order (backend TAS-436, develop `78019ece`): the gateway's validation, the
   * whole body (`workflowViolations`, every failure 400 here — a duplicate and
   * an empty type list included, with no reason, as the validator words
   * them), the mapping's keys, the role, a pending type operation, then a
   * type the registry lacks (`WORKFLOW_ISSUE_TYPE_NOT_IN_PROJECT`). The types
   * move here from wherever they run — no 409 for a bound one any more — with
   * their issues (`changeBindings`). The 201 is `ProjectWorkflowDto`: the
   * statuses and every transition by `sortOrder`, the types, `shared: false`,
   * `version` 1.
   */
  createProjectWorkflow(projectId: string, input: CreateProjectWorkflowInput, requestId?: string): ProjectWorkflowEntry {
    const body = input as Partial<Record<keyof CreateProjectWorkflowInput, unknown>>;
    if (
      typeof body.name !== "string" ||
      !Array.isArray(body.issueTypes) ||
      !body.issueTypes.every(isIssueTypeCode) ||
      !Array.isArray(body.statuses) ||
      !body.statuses.every(isWorkflowStatusBody) ||
      !Array.isArray(body.transitions) ||
      !body.transitions.every(isWorkflowTransitionBody) ||
      (body.statusMappings !== undefined && !WORKFLOW_BODY_FIELDS.statusMappings(body.statusMappings))
    ) {
      throw new MockApiError("INVALID_ARGUMENT", "Invalid request parameters");
    }
    const replayed = this.replayCommand(requestId, { kind: "create-workflow", projectId, input });
    if (replayed.done) return replayed.answer as ProjectWorkflowEntry;
    const candidate: WorkflowCandidate = {
      name: input.name.trim(),
      issueTypes: [...input.issueTypes],
      statuses: input.statuses.map(trimmedStatus),
      transitions: input.transitions.map(trimmedTransition),
    };
    // No minimum is checked, as on the server: a workflow with no status, no
    // visible transition or no `TODO` is created here. On the server the
    // project's context then answers 404 for every member when it has no
    // status or no visible transition (`GetWorkflowForProject`,
    // docs/ai/API-DIVERGENCE.md "A workflow with no status or no visible
    // transition makes the project context 404"), and with no `TODO` the
    // issues of its types created with no status land outside their workflow
    // on the board; this store's context
    // reproduces neither. The dialog cannot send such a body — it sends a copy
    // of the shared default.
    const violations = workflowViolations(candidate);
    if (violations.length) {
      throw new MockApiError("INVALID_ARGUMENT", violationMessage("Workflow creation failed: ", violations));
    }
    const mapping = this.workflowStatusMapping(input.statusMappings);
    this.requireWorkflowRole(projectId);
    this.refuseTypeOperationPending(candidate.name);
    this.requireRegisteredTypes(projectId, candidate.issueTypes);
    const stamp = now();
    const statuses = candidate.statuses.map((status) => ({ id: makeId("status"), ...status }));
    const idOf = (key: string) => statuses.find((status) => status.statusKey === key)?.id ?? "";
    const workflow: WorkflowDefinition = {
      id: makeId("workflow"),
      name: candidate.name,
      version: 1,
      createdAt: stamp,
      updatedAt: stamp,
      statuses,
      transitions: candidate.transitions.map((transition) => ({
        id: makeId("transition"),
        fromStatusId: idOf(transition.fromStatusKey),
        toStatusId: idOf(transition.toStatusKey),
        name: transition.name,
        sortOrder: transition.sortOrder,
        hidden: transition.hidden,
      })),
    };
    const apply = this.changeBindings(projectId, workflow, candidate.issueTypes, mapping);
    apply();
    (this.ownedWorkflows[projectId] ??= []).push(workflow);
    const answer = this.workflowAnswer(projectId, workflow);
    this.pendOnTrigger(candidate.name, "WORKFLOW_BINDING_CHANGE_PENDING", "Workflow binding change is durably pending; retry with the same X-Request-Id", {
      kind: "create-workflow",
      projectId,
      input,
    }, answer);
    return answer;
  }

  /**
   * `POST …/workflows/{workflowId}/statuses` — `WorkflowEditService.addStatus`.
   * See `editableWorkflow` for the refusals before the body is looked at.
   */
  addWorkflowStatus(projectId: string, workflowId: string, input: WorkflowStatusInput): ProjectWorkflowEntry {
    if (!isWorkflowStatusBody(input)) throw new MockApiError("INVALID_ARGUMENT", "Invalid request parameters");
    const { workflow, issueTypes } = this.editableWorkflow(projectId, workflowId);
    const status = trimmedStatus(input);
    this.refuseWorkflowUpdate(workflow, issueTypes, { status });
    workflow.statuses.push({ id: makeId("status"), ...status });
    return this.bumpWorkflow(projectId, workflow);
  }

  /** `POST …/workflows/{workflowId}/transitions` — `WorkflowEditService.addTransition`. */
  addWorkflowTransition(projectId: string, workflowId: string, input: WorkflowTransitionInput): ProjectWorkflowEntry {
    if (!isWorkflowTransitionBody(input)) throw new MockApiError("INVALID_ARGUMENT", "Invalid request parameters");
    const { workflow, issueTypes } = this.editableWorkflow(projectId, workflowId);
    const transition = trimmedTransition(input);
    this.refuseWorkflowUpdate(workflow, issueTypes, { transition });
    const idOf = (key: string) => workflow.statuses.find((status) => status.statusKey === key)?.id ?? "";
    workflow.transitions.push({
      id: makeId("transition"),
      fromStatusId: idOf(transition.fromStatusKey),
      toStatusId: idOf(transition.toStatusKey),
      name: transition.name,
      sortOrder: transition.sortOrder,
      hidden: transition.hidden,
    });
    return this.bumpWorkflow(projectId, workflow);
  }

  /**
   * `PATCH …/workflows/{workflowId}`. The gateway's reading first (backend
   * TAS-427, TAS-436): the declared keys only, no `null`, a name of 1–100 not
   * blank, a repeat-free `issueTypes`, a `name` or `issueTypes` at least,
   * `version` with `issueTypes`, and no `statusMappings` without them — each
   * "Invalid request parameters". Without `issueTypes` it is the rename of
   * `WorkflowMutationService` (see `mutableWorkflow`); with them it is
   * `WorkflowBindingTransactions.replace`: an empty set
   * (`WORKFLOW_ISSUE_TYPES_EMPTY`), the role, a pending type operation, a type
   * the registry lacks, a version that moved on, then the whole set as the
   * workflow's (`changeBindings`): a type added moves here, a type left out
   * goes back to the shared default, with their issues. The answer is the
   * workflow with its new types, `version` + 1.
   */
  updateProjectWorkflow(
    projectId: string,
    workflowId: string,
    input: UpdateProjectWorkflowInput,
    requestId?: string,
  ): ProjectWorkflowEntry {
    const body = input as Partial<Record<keyof UpdateProjectWorkflowInput, unknown>>;
    const named = body.name;
    if (
      !isWorkflowPatch(input, ["version", "name", "issueTypes", "statusMappings"]) ||
      (named !== undefined && (typeof named !== "string" || !named.trim())) ||
      (named === undefined && body.issueTypes === undefined) ||
      (body.issueTypes !== undefined && body.version === undefined) ||
      (body.issueTypes === undefined && body.statusMappings !== undefined && Object.keys(body.statusMappings as object).length > 0)
    ) {
      throw new MockApiError("INVALID_ARGUMENT", "Invalid request parameters");
    }
    if (input.issueTypes === undefined) {
      const { workflow, issueTypes } = this.mutableWorkflow(projectId, workflowId, input.version);
      this.refuseTypeOperationPending(named as string);
      const name = (named as string).trim();
      this.validateWorkflowEdit({ ...workflow, name }, issueTypes);
      workflow.name = name;
      return this.bumpWorkflow(projectId, workflow);
    }
    const replayed = this.replayCommand(requestId, { kind: "replace-types", projectId, workflowId, input });
    if (replayed.done) return replayed.answer as ProjectWorkflowEntry;
    if (input.issueTypes.length === 0) {
      throw new MockApiError("INVALID_ARGUMENT", "Workflow must use at least one issue type", {
        reason: "WORKFLOW_ISSUE_TYPES_EMPTY",
      });
    }
    const mapping = this.workflowStatusMapping(input.statusMappings);
    const { workflow } = this.editableWorkflow(projectId, workflowId);
    this.refuseTypeOperationPending(input.name);
    this.requireRegisteredTypes(projectId, input.issueTypes);
    if (input.version !== workflow.version) throw new MockApiError("ABORTED", "Workflow version changed");
    const name = input.name === undefined ? workflow.name : input.name.trim();
    if (name.length > 100) throw new MockApiError("INVALID_ARGUMENT", "Workflow name is too long");
    const apply = this.changeBindings(projectId, workflow, input.issueTypes, mapping);
    apply();
    workflow.name = name;
    const answer = this.bumpWorkflow(projectId, workflow);
    this.pendOnTrigger(name, "WORKFLOW_BINDING_CHANGE_PENDING", "Workflow binding change is durably pending; retry with the same X-Request-Id", {
      kind: "replace-types",
      projectId,
      workflowId,
      input,
    }, answer);
    return answer;
  }

  /**
   * `PATCH …/statuses/{statusId}` — `updateStatus`: one of the three fields at
   * least, a status of this workflow, and the workflow as it would stand
   * checked whole. The key never changes. The arrays are replaced rather than
   * edited in place: WEB's EPIC workflow shares the default's status objects.
   */
  updateWorkflowStatus(
    projectId: string,
    workflowId: string,
    statusId: string,
    input: UpdateWorkflowStatusInput,
  ): ProjectWorkflowEntry {
    if (!UUID_PATTERN.test(statusId) || !isWorkflowPatch(input, ["version", "name", "category", "sortOrder"])) {
      throw new MockApiError("INVALID_ARGUMENT", "Invalid request parameters");
    }
    const { workflow, issueTypes } = this.mutableWorkflow(projectId, workflowId, input.version);
    if (input.name === undefined && input.category === undefined && input.sortOrder === undefined) {
      throw new MockApiError("INVALID_ARGUMENT", "At least one status field is required");
    }
    const old = requireWorkflowStatus(workflow, statusId);
    const changed: WorkflowStatus = {
      ...old,
      name: input.name === undefined ? old.name : input.name.trim(),
      category: input.category ?? old.category,
      sortOrder: input.sortOrder ?? old.sortOrder,
    };
    const statuses = workflow.statuses.map((status) => (status === old ? changed : status));
    this.validateWorkflowEdit({ ...workflow, statuses }, issueTypes);
    workflow.statuses = statuses;
    return this.bumpWorkflow(projectId, workflow);
  }

  /**
   * `DELETE …/statuses/{statusId}` — `deleteStatus`: never `TODO`; the status
   * goes with every transition from or to it; a target must be another status
   * of this workflow; the workflow as it would stand is checked whole; then
   * issue-service moves the issues (`migrateWorkflowIssues`) — refusing when
   * any would be left in a status the workflow no longer has.
   */
  deleteWorkflowStatus(
    projectId: string,
    workflowId: string,
    statusId: string,
    params: DeleteWorkflowStatusParams,
  ): ProjectWorkflowEntry {
    if (!UUID_PATTERN.test(statusId) || !isWorkflowQuery(params, ["version", "targetStatusKey"])) {
      throw new MockApiError("INVALID_ARGUMENT", "Invalid request parameters");
    }
    const { workflow, issueTypes } = this.mutableWorkflow(projectId, workflowId, params.version);
    const old = requireWorkflowStatus(workflow, statusId);
    if (old.statusKey === "TODO") throw new MockApiError("FAILED_PRECONDITION", "The initial TODO status cannot be deleted");
    const statuses = workflow.statuses.filter((status) => status.id !== old.id);
    const transitions = workflow.transitions.filter(
      (transition) => transition.fromStatusId !== old.id && transition.toStatusId !== old.id,
    );
    const validKeys = statuses.map((status) => status.statusKey);
    const target = params.targetStatusKey;
    if (target !== undefined && !validKeys.includes(target)) {
      throw new MockApiError("INVALID_ARGUMENT", "Target status is not in this workflow");
    }
    this.validateWorkflowEdit({ ...workflow, statuses, transitions }, issueTypes);
    // Only the deleted status's issues (`source_status_keys`, TAS-427): an
    // issue already outside the workflow no longer blocks the delete. The
    // targets a refusal names are the statuses the workflow keeps.
    this.migrateWorkflowIssues(
      projectId,
      workflow.id,
      issueTypes,
      validKeys,
      target === undefined ? {} : { [old.statusKey]: target },
      validKeys,
      [old.statusKey],
    );
    workflow.statuses = statuses;
    workflow.transitions = transitions;
    return this.bumpWorkflow(projectId, workflow);
  }

  /** `PATCH …/transitions/{transitionId}` — `updateTransition`: one of the three fields at least. From and To never change. */
  updateWorkflowTransition(
    projectId: string,
    workflowId: string,
    transitionId: string,
    input: UpdateWorkflowTransitionInput,
  ): ProjectWorkflowEntry {
    if (!UUID_PATTERN.test(transitionId) || !isWorkflowPatch(input, ["version", "name", "sortOrder", "hidden"])) {
      throw new MockApiError("INVALID_ARGUMENT", "Invalid request parameters");
    }
    const { workflow, issueTypes } = this.mutableWorkflow(projectId, workflowId, input.version);
    if (input.name === undefined && input.hidden === undefined && input.sortOrder === undefined) {
      throw new MockApiError("INVALID_ARGUMENT", "At least one transition field is required");
    }
    const old = requireWorkflowTransition(workflow, transitionId);
    const changed = {
      ...old,
      name: input.name === undefined ? old.name : input.name.trim(),
      hidden: input.hidden ?? old.hidden,
      sortOrder: input.sortOrder ?? old.sortOrder,
    };
    const transitions = workflow.transitions.map((transition) => (transition === old ? changed : transition));
    this.validateWorkflowEdit({ ...workflow, transitions }, issueTypes);
    workflow.transitions = transitions;
    return this.bumpWorkflow(projectId, workflow);
  }

  /** `DELETE …/transitions/{transitionId}` — `deleteTransition`: the workflow without it, checked whole. */
  deleteWorkflowTransition(
    projectId: string,
    workflowId: string,
    transitionId: string,
    params: DeleteWorkflowTransitionParams,
  ): ProjectWorkflowEntry {
    if (!UUID_PATTERN.test(transitionId) || !isWorkflowQuery(params, ["version"])) {
      throw new MockApiError("INVALID_ARGUMENT", "Invalid request parameters");
    }
    const { workflow, issueTypes } = this.mutableWorkflow(projectId, workflowId, params.version);
    const old = requireWorkflowTransition(workflow, transitionId);
    const transitions = workflow.transitions.filter((transition) => transition !== old);
    this.validateWorkflowEdit({ ...workflow, transitions }, issueTypes);
    workflow.transitions = transitions;
    return this.bumpWorkflow(projectId, workflow);
  }

  /**
   * `DELETE …/workflows/{workflowId}` — `deleteWorkflow`. Every type the
   * workflow leaves falls back to the one general default — the default
   * project's TASK workflow (`WorkflowMutationService`, backend #226) — so the
   * deleted workflow's types all land on it. A mapping's source must be a status of
   * this workflow and its target a status of **both** (so a failure after the
   * issues moved leaves them valid in the old graph too); then the issues
   * move, the bindings go, and the answer is the shared default with the
   * deleted workflow's types and `shared: true`. Nothing is versioned: the
   * workflow is gone.
   */
  deleteProjectWorkflow(projectId: string, workflowId: string, input: DeleteProjectWorkflowInput): ProjectWorkflowEntry {
    if (!isWorkflowPatch(input, ["version", "statusMappings"])) {
      throw new MockApiError("INVALID_ARGUMENT", "Invalid request parameters");
    }
    const { workflow, issueTypes } = this.mutableWorkflow(projectId, workflowId, input.version);
    const fallback = this.workflow;
    const validKeys = fallback.statuses.map((status) => status.statusKey);
    if (!validKeys.includes("TODO") || !fallback.transitions.some((transition) => !transition.hidden)) {
      throw new MockApiError("FAILED_PRECONDITION", "Default workflow is not usable");
    }
    const mapping = input.statusMappings ?? {};
    const sourceKeys = workflow.statuses.map((status) => status.statusKey);
    const targets = Object.values(mapping);
    // The targets only (backend TAS-429): a mapping's source may be an old
    // status outside this workflow, which the contract allows.
    if (!targets.every((key) => validKeys.includes(key)) || !targets.every((key) => sourceKeys.includes(key))) {
      throw new MockApiError(
        "INVALID_ARGUMENT",
        "Map to statuses present in both workflows; add a target status to the current workflow first if needed",
      );
    }
    // Only this workflow's statuses and the keys the mapping names (backend
    // TAS-429, A12): an issue in a status outside both workflows stays where it
    // is, «Outside their workflow», and does not block the delete. The targets a
    // refusal names are the shared default's statuses this workflow also has,
    // in the default's order (`WorkflowMutationService.deleteWorkflow`, TAS-427).
    this.migrateWorkflowIssues(
      projectId,
      workflow.id,
      issueTypes,
      validKeys,
      mapping,
      validKeys.filter((key) => sourceKeys.includes(key)),
      [...new Set([...sourceKeys, ...Object.keys(mapping)])],
    );
    const bindings = this.workflowOverrides[projectId] ?? {};
    for (const code of issueTypes) delete bindings[code];
    this.ownedWorkflows[projectId] = (this.ownedWorkflows[projectId] ?? []).filter((item) => item !== workflow);
    return { workflow: this.workflowView(fallback), issueTypes, shared: true };
  }

  /**
   * `WorkflowMutationService.mutate` before the operation: the workflow as an
   * add finds it (`editableWorkflow` — the role and the archive, a workflow
   * nobody holds, the shared default, another project's); then the version. A
   * version below 1 never gets here — the gateway refuses it, in a body and in
   * the deletes' query alike (TAS-427). A version that is not the stored one
   * is 409 `ABORTED`, whatever else the request says; one left out is not
   * compared.
   */
  private mutableWorkflow(
    projectId: string,
    workflowId: string,
    version: number | undefined,
  ): { workflow: WorkflowDefinition; issueTypes: string[] } {
    const editable = this.editableWorkflow(projectId, workflowId);
    if (version !== undefined && version !== editable.workflow.version) {
      throw new MockApiError("ABORTED", "Workflow version changed");
    }
    return editable;
  }

  /**
   * `WorkflowMutationService.validate`: the workflow as an edit would leave
   * it keeps a `TODO` status and a visible transition, and then passes the
   * create rules with the edit's prefix (`refuseWorkflowUpdate`) — a blank or
   * over-long name, a negative `sortOrder`, and a `sortOrder` another status
   * or transition holds, which is a 400, not a 409.
   */
  private validateWorkflowEdit(
    workflow: Pick<WorkflowDefinition, "name" | "statuses" | "transitions">,
    issueTypes: string[],
  ): void {
    if (
      !workflow.statuses.some((status) => status.statusKey === "TODO") ||
      !workflow.transitions.some((transition) => !transition.hidden)
    ) {
      throw new MockApiError("INVALID_ARGUMENT", "Workflow requires a TODO status and at least one visible transition");
    }
    this.refuseWorkflowUpdate(workflow, issueTypes);
  }

  /**
   * issue-service's `WorkflowIssueMigrationService.migrate`, as the two
   * deletes call it (backend TAS-427, TAS-429, develop `cbd3f0af`): the
   * project's live issues of the workflow's types in one of `sourceKeys` — the
   * deleted status, or the deleted workflow's statuses and the keys its
   * mapping names — whose status the workflow will not keep or a mapping
   * names (`findForWorkflowMigrationBySourceStatuses`). More than
   * 5000 refuses the whole delete first — 400 `FAILED_PRECONDITION`,
   * `details.reason` `WORKFLOW_MIGRATION_LIMIT` and the `limit`. Then any left,
   * after the mapping, in a status outside `validKeys` refuses it with
   * `details.reason` `WORKFLOW_ISSUES_UNMAPPED`, the count, the keys they sit
   * in, and — added by workflow-service — the `targetStatusKeys` a mapping may
   * name, all strings as `RestErrorResponse.details` carries them. Otherwise
   * each mapped issue moves, with a `TRANSITIONED` history entry that says why
   * and the `ISSUE_TRANSITIONED` event's notification.
   */
  private migrateWorkflowIssues(
    projectId: string,
    workflowId: string,
    issueTypes: readonly string[],
    validKeys: readonly string[],
    mapping: Readonly<Record<string, string>>,
    targetStatusKeys: readonly string[],
    sourceKeys: readonly string[],
  ): void {
    if (!sourceKeys.every((key) => STATUS_KEY_PATTERN.test(key))) {
      throw new MockApiError("INVALID_ARGUMENT", "Invalid workflow migration scope or target status");
    }
    const targetOf = (statusKey: string) => (Object.hasOwn(mapping, statusKey) ? mapping[statusKey] : statusKey);
    const found = this.issues.filter(
      (issue) =>
        issue.projectId === projectId &&
        issue.deletedAt === null &&
        issueTypes.includes(issue.issueType) &&
        sourceKeys.includes(issue.status) &&
        (!validKeys.includes(issue.status) || Object.hasOwn(mapping, issue.status)),
    );
    if (found.length > WORKFLOW_MIGRATION_LIMIT) {
      throw new MockApiError(
        "FAILED_PRECONDITION",
        `Synchronous workflow migration is limited to ${WORKFLOW_MIGRATION_LIMIT} issues; reduce the migration scope`,
        { reason: "WORKFLOW_MIGRATION_LIMIT", limit: String(WORKFLOW_MIGRATION_LIMIT) },
      );
    }
    const unmapped = found.filter((issue) => !validKeys.includes(targetOf(issue.status)));
    if (unmapped.length) {
      const statusKeys = [...new Set(unmapped.map((issue) => issue.status))].sort().join(",");
      throw new MockApiError(
        "FAILED_PRECONDITION",
        `Workflow statuses have ${unmapped.length} issues; supply a target status mapping`,
        {
          reason: "WORKFLOW_ISSUES_UNMAPPED",
          issueCount: String(unmapped.length),
          statusKeys,
          targetStatusKeys: targetStatusKeys.join(","),
        },
      );
    }
    for (const issue of found) {
      const target = targetOf(issue.status);
      if (target === issue.status) continue;
      const from = issue.status;
      issue.status = target;
      issue.updatedAt = now();
      issue.version += 1;
      this.pushHistory(issue.id, "TRANSITIONED", this.currentUserId, {
        from,
        to: target,
        reason: "WORKFLOW_CONFIGURATION_CHANGED",
        workflowId,
      });
      // The outbox's `ISSUE_TRANSITIONED`, as `transitionIssue` notifies one.
      this.notifications.unshift(
        this.notification("ISSUE_TRANSITIONED", "Status changed", `${issue.issueKey} moved to ${target}`, issue, now(), null),
      );
    }
  }

  /**
   * `ProjectRoleChecker` with `create-workflow-roles` / `edit-workflow-roles`
   * (both `[ADMIN]`), in its three sentences: a missing project, a reader who
   * is not a member, a member whose role is not in the set — and, between the
   * last two, an archived project's refusal.
   */
  private requireWorkflowRole(projectId: string): void {
    this.getProject(projectId);
    const role = this.membersByProject[projectId]?.find((member) => member.userId === this.currentUserId)?.role;
    if (!role) throw new MockApiError("PERMISSION_DENIED", "Access denied");
    // Between the membership and the role, as workflow-service checks it since
    // backend PR #159.
    this.refuseArchivedWrite(projectId);
    if (role !== "ADMIN") throw new MockApiError("PERMISSION_DENIED", "Not allowed role");
  }

  /**
   * `WorkflowEditService.loadEditableWorkflow`: the role, a workflow nobody
   * holds (404), the shared default (400 `FAILED_PRECONDITION` — not a
   * conflict), then a workflow no type of *this* project is bound to (404).
   * The path is the gateway's to check first: a workflow id that is not a
   * UUID never reaches the service.
   */
  private editableWorkflow(projectId: string, workflowId: string): { workflow: WorkflowDefinition; issueTypes: string[] } {
    if (!UUID_PATTERN.test(workflowId)) throw new MockApiError("INVALID_ARGUMENT", "Invalid request parameters");
    this.requireWorkflowRole(projectId);
    const owned = Object.values(this.ownedWorkflows).flat();
    const workflow = workflowId === this.workflow.id ? this.workflow : owned.find((item) => item.id === workflowId);
    if (!workflow) throw new MockApiError("NOT_FOUND", `Workflow not found: id=${workflowId}`);
    if (workflow === this.workflow) {
      throw new MockApiError(
        "FAILED_PRECONDITION",
        `Default workflow is shared by all projects and cannot be modified: id=${workflowId}. Create a project workflow first`,
      );
    }
    // Owned by this project — bound or a donor (backend TAS-436) — or 404.
    if (!(this.ownedWorkflows[projectId] ?? []).includes(workflow)) {
      throw new MockApiError("NOT_FOUND", `Workflow not found in project: id=${workflowId}`);
    }
    this.refuseTypeOperationPending(workflow.name);
    const issueTypes = Object.entries(this.workflowOverrides[projectId] ?? {})
      .filter(([, item]) => item === workflow)
      .map(([code]) => code);
    return { workflow, issueTypes };
  }

  /**
   * A binding change of workflow-service (backend TAS-436, develop `78019ece`:
   * `WorkflowBindingTransactions.prepare`) and its issues, which issue-service
   * moves (`WorkflowBindingMigrationService.move`). `requested` is the set of
   * types `target` is to have: each runs on its own workflow or the shared
   * default now and moves to `target`; a type `target` has now and `requested`
   * leaves out goes back to the shared default. Then, for the types that
   * actually move, the live issues in a status their destination lacks — or
   * that `mapping` names — more than 5000 refuses the whole change
   * (`WORKFLOW_MIGRATION_LIMIT`); any left, after the mapping, in a status
   * their destination lacks refuses it — `WORKFLOW_ISSUES_UNMAPPED` with the
   * count, the keys they sit in and `targetStatusKeys`, the statuses every
   * such destination has (sorted, as the server's `TreeSet` leaves them), or
   * `WORKFLOW_STATUS_MAPPING_INVALID` (400 `INVALID_ARGUMENT`) when a mapping
   * points one of them nowhere it may go. Nothing is changed by a refusal; the
   * answer is the change to apply: each mapped issue moved with a
   * `TRANSITIONED` entry, the bindings rewritten, and every own workflow a type
   * left one version on.
   */
  private changeBindings(
    projectId: string,
    target: WorkflowDefinition,
    requested: readonly string[],
    mapping: Readonly<Record<string, string>>,
  ): () => void {
    const bindings = (this.workflowOverrides[projectId] ??= {});
    const registry = this.registryOf(projectId).map((type) => type.code);
    const desired = registry.filter((code) => requested.includes(code));
    const moves = registry
      .filter((code) => desired.includes(code) || bindings[code] === target)
      .map((code) => ({
        code,
        source: this.workflowFor(projectId, code),
        destination: desired.includes(code) ? target : this.workflow,
      }))
      .filter((move) => move.source !== move.destination);
    const keysOf = (workflow: WorkflowDefinition) => workflow.statuses.map((status) => status.statusKey);
    const moveOf = (code: string) => moves.find((move) => move.code === code);
    const targetOf = (statusKey: string) => (Object.hasOwn(mapping, statusKey) ? mapping[statusKey] : statusKey);
    const rows = this.issues.filter((issue) => {
      const move = issue.projectId === projectId && issue.deletedAt === null ? moveOf(issue.issueType) : undefined;
      // `findForWorkflowBindingMove`: a status the destination lacks, or one the mapping moves.
      return move !== undefined && (!keysOf(move.destination).includes(issue.status) || targetOf(issue.status) !== issue.status);
    });
    if (rows.length > WORKFLOW_MIGRATION_LIMIT) {
      throw new MockApiError("FAILED_PRECONDITION", "Synchronous workflow migration is limited to 5000 issues", {
        reason: "WORKFLOW_MIGRATION_LIMIT",
        limit: String(WORKFLOW_MIGRATION_LIMIT),
      });
    }
    const unresolved = rows.filter((issue) => !keysOf(moveOf(issue.issueType)!.destination).includes(targetOf(issue.status)));
    if (unresolved.length) {
      const destinations = [...new Set(unresolved.map((issue) => moveOf(issue.issueType)!.destination))];
      const shared = destinations
        .map(keysOf)
        .reduce((common, keys) => common.filter((key) => keys.includes(key)))
        .sort();
      const badMapping = unresolved.some((issue) => Object.hasOwn(mapping, issue.status));
      throw new MockApiError(
        badMapping ? "INVALID_ARGUMENT" : "FAILED_PRECONDITION",
        "Supply a valid target status mapping for the destination workflow",
        {
          reason: badMapping ? "WORKFLOW_STATUS_MAPPING_INVALID" : "WORKFLOW_ISSUES_UNMAPPED",
          issueCount: String(unresolved.length),
          statusKeys: [...new Set(unresolved.map((issue) => issue.status))].sort().join(","),
          targetStatusKeys: shared.join(","),
        },
      );
    }
    return () => {
      for (const issue of rows) {
        const to = targetOf(issue.status);
        if (to === issue.status) continue;
        const from = issue.status;
        issue.status = to;
        issue.updatedAt = now();
        issue.version += 1;
        this.pushHistory(issue.id, "TRANSITIONED", this.currentUserId, {
          from,
          to,
          reason: "WORKFLOW_CONFIGURATION_CHANGED",
          workflowId: moveOf(issue.issueType)!.destination.id,
        });
        this.notifications.unshift(
          this.notification("ISSUE_TRANSITIONED", "Status changed", `${issue.issueKey} moved to ${to}`, issue, now(), null),
        );
      }
      const left = new Set<WorkflowDefinition>();
      for (const move of moves) {
        if (move.destination === this.workflow) delete bindings[move.code];
        else bindings[move.code] = move.destination;
        if (move.source !== this.workflow && move.source !== target) left.add(move.source);
      }
      for (const workflow of left) {
        workflow.version += 1;
        workflow.updatedAt = now();
      }
    };
  }

  /** `validateMappings`: both sides of every mapping a status key, else 400 (backend TAS-436). */
  private workflowStatusMapping(mapping: Record<string, string> | undefined): Record<string, string> {
    const entries = Object.entries(mapping ?? {});
    if (entries.some(([from, to]) => !WORKFLOW_STATUS_KEY_PATTERN.test(from) || !WORKFLOW_STATUS_KEY_PATTERN.test(to))) {
      throw new MockApiError("INVALID_ARGUMENT", "Invalid workflow status mapping");
    }
    return Object.fromEntries(entries);
  }

  /** `requireRegistry`: every requested type the registry holds, else `WORKFLOW_ISSUE_TYPE_NOT_IN_PROJECT` (400). */
  private requireRegisteredTypes(projectId: string, codes: readonly string[]): void {
    if (codes.some((code) => !this.inRegistry(projectId, code))) {
      throw new MockApiError("INVALID_ARGUMENT", "Issue type is not registered in this project", {
        reason: "WORKFLOW_ISSUE_TYPE_NOT_IN_PROJECT",
      });
    }
  }

  /**
   * `WorkflowWriteFence.checkAvailable` as `MOCK_PROJECT_TRIGGERS.typeOperationPending`
   * plays it: a workflow named with the trigger — as it stands or as the write
   * would leave it — meets a pending type operation, 409 `ABORTED`.
   */
  private refuseTypeOperationPending(...names: (string | undefined)[]): void {
    if (names.some((name) => name?.includes(MOCK_PROJECT_TRIGGERS.typeOperationPending))) {
      throw new MockApiError("ABORTED", "A project issue-type operation is pending", {
        reason: "ISSUE_TYPE_OPERATION_PENDING",
      });
    }
  }

  /**
   * A repeat of a command this store answered 503 «still being applied»
   * (`pendOnTrigger`): the same command under the same `X-Request-Id` answers
   * what the finished command did — every time, as the server's journal keeps
   * the receipt; the id with another command is 409 `ALREADY_EXISTS`
   * (`REQUEST_ID_REUSED`). An id this store did not hand out — or none — is a
   * new command.
   */
  private replayCommand(requestId: string | undefined, command: unknown): { done: boolean; answer?: unknown } {
    const pending = requestId === undefined ? undefined : this.pendingCommands.get(requestId);
    if (!pending) return { done: false };
    if (pending.command !== JSON.stringify(command)) {
      throw new MockApiError("ALREADY_EXISTS", "X-Request-Id was used with another command", { reason: "REQUEST_ID_REUSED" });
    }
    return { done: true, answer: clone(pending.answer) };
  }

  /**
   * `MOCK_PROJECT_TRIGGERS.stillApplying`, carried out on a command that has
   * just been applied: its answer is kept under a new request id, and the
   * client is told 503 `UNAVAILABLE` with the pending `reason`, an
   * `operationId` and that id — as the server answers a recoverable command it
   * has accepted and not finished.
   */
  private pendOnTrigger(name: string, reason: string, message: string, command: unknown, answer: unknown): void {
    if (!name.includes(MOCK_PROJECT_TRIGGERS.stillApplying)) return;
    const requestId = makeId("request");
    this.pendingCommands.set(requestId, { command: JSON.stringify(command), answer: clone(answer) });
    throw new MockApiError("UNAVAILABLE", message, { reason, operationId: makeId("operation") }, requestId);
  }

  /**
   * The whole workflow as it would stand after the add, through the create
   * rules with the edit's prefix. 409 `ALREADY_EXISTS` only when every
   * violation is a duplicate key or a duplicate pair, 400 otherwise
   * (`WorkflowEditService.checkViolations`).
   */
  private refuseWorkflowUpdate(
    workflow: Pick<WorkflowDefinition, "name" | "statuses" | "transitions">,
    issueTypes: string[],
    added: { status?: WorkflowStatusInput; transition?: WorkflowTransitionInput } = {},
  ): void {
    const keyOf = (statusId: string) => workflow.statuses.find((status) => status.id === statusId)?.statusKey ?? "";
    const candidate: WorkflowCandidate = {
      name: workflow.name,
      issueTypes,
      statuses: [
        ...workflow.statuses.map(({ statusKey, name, category, sortOrder }) => ({ statusKey, name, category, sortOrder })),
        ...(added.status ? [added.status] : []),
      ],
      transitions: [
        ...workflow.transitions.map((transition) => ({
          fromStatusKey: keyOf(transition.fromStatusId),
          toStatusKey: keyOf(transition.toStatusId),
          name: transition.name,
          sortOrder: transition.sortOrder,
          hidden: transition.hidden,
        })),
        ...(added.transition ? [added.transition] : []),
      ],
    };
    // An edit of a donor — no type left (backend TAS-436) — is not refused for
    // it: `checkViolations` drops `ISSUE_TYPE_LIST_EMPTY`.
    const violations = workflowViolations(candidate).filter(
      (violation) => violation.message !== EMPTY_ISSUE_TYPE_LIST_VIOLATION,
    );
    if (!violations.length) return;
    throw new MockApiError(
      violations.every((violation) => violation.duplicate) ? "ALREADY_EXISTS" : "INVALID_ARGUMENT",
      violationMessage("Workflow update failed: ", violations),
    );
  }

  /** `incrementVersion` (or `updateMetadata`'s `version+1`), then the workflow's answer. */
  private bumpWorkflow(projectId: string, workflow: WorkflowDefinition): ProjectWorkflowEntry {
    workflow.version += 1;
    workflow.updatedAt = now();
    return this.workflowAnswer(projectId, workflow);
  }

  /**
   * A write's answer for a project's own workflow, as every workflow write
   * sends it since backend PR #225: `ProjectWorkflowDto` with the whole
   * workflow, the types bound to it in this project, `shared: false`.
   */
  private workflowAnswer(projectId: string, workflow: WorkflowDefinition): ProjectWorkflowEntry {
    // In the registry's order, as a binding change answers its desired types.
    const bindings = this.workflowOverrides[projectId] ?? {};
    const issueTypes = this.registryOf(projectId)
      .map((type) => type.code)
      .filter((code) => bindings[code] === workflow);
    return { workflow: this.workflowView(workflow), issueTypes, shared: false };
  }

  /**
   * A copy of a stored workflow as the list and every write answer it:
   * statuses and every transition, hidden ones included, by `sortOrder`.
   */
  private workflowView(workflow: WorkflowDefinition): WorkflowDefinition {
    const bySortOrder = <T extends { sortOrder: number }>(items: T[]) => [...items].sort((a, b) => a.sortOrder - b.sortOrder);
    return {
      ...workflow,
      statuses: bySortOrder(workflow.statuses).map((status) => ({ ...status })),
      transitions: bySortOrder(workflow.transitions).map((transition) => ({ ...transition })),
    };
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

  /**
   * `GET /projects/{projectId}/board` (backend #205, TAS-213), built out of this
   * store's own workflows and issues rather than from a fixture, so it moves
   * when the seed does and an e2e run cannot pass against a board the gateway
   * would never answer.
   *
   * The access rule the gateway keeps, in its order: a missing project is
   * `NOT_FOUND` "Project not found", then a reader with no membership row is
   * `PERMISSION_DENIED` "Access denied" (issue-service's own check, any of the
   * three roles passes). An archived project is read like any other.
   *
   * What this method owns is which issues the board is about: the project's
   * live issues of the types read — the registry's, in its order (backend
   * #226), or the one asked for — narrowed by the four filters the server
   * applies (assignee, label, priority, and `query` as a case-insensitive
   * substring of the key, the summary or the description). `buildMockBoard`
   * owns the rest. The workflow of each type is the project's own or the
   * shared default, so in this store every type read has one.
   *
   * A type filter the gateway cannot parse, and a well-formed key the registry
   * does not hold, both answer an empty board — `{columns: [], unplacedIssues:
   * []}` — after the membership check (`BoardController`, `BoardServiceImpl`
   * at backend `be5085e5`).
   *
   * The cards carry what the gateway joins in since #205: the assignee's name
   * and face from the user store (`displayName: null` for an id nobody holds,
   * as the gateway leaves it), and the labels as `id`, `name`, `color`.
   */
  getBoard(projectId: string, params: BoardParams = {}): Board {
    // The gateway's bean validation, before anything else (TAS-392): a page
    // size outside 1–200, and a `query` under the contract's `minLength: 1`.
    // `query` is not trimmed: what the reader typed is what is matched, and the
    // board screen sends none that is blank.
    const pageSize = params.pageSizePerColumn;
    if (
      (pageSize !== undefined && (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > BOARD_MAX_PAGE_SIZE)) ||
      params.query === ""
    ) {
      throw new MockApiError("INVALID_ARGUMENT", "Invalid request parameters");
    }
    const project = this.projects.find((item) => item.id === projectId);
    if (!project) throw new MockApiError("NOT_FOUND", "Project not found");
    if (!this.membersByProject[projectId]?.some((member) => member.userId === this.currentUserId)) {
      throw new MockApiError("PERMISSION_DENIED", "Access denied");
    }
    if (params.issueType && (!isIssueTypeCode(params.issueType) || !this.inRegistry(projectId, params.issueType))) {
      return { projectId, columns: [], unplacedIssues: [], unplacedTotalCount: 0, unplacedHasMore: false };
    }
    const types = this.boardTypes(projectId, params.issueType);
    return buildMockBoard(projectId, types, this.boardIssues(projectId, types, params), params);
  }

  /** The types a board read is about — the registry's in its order, or the one asked for — each with its workflow's statuses. */
  private boardTypes(projectId: string, issueType: string | undefined): MockBoardType[] {
    const typeCodes = issueType ? [issueType] : this.registryOf(projectId).map((type) => type.code);
    return typeCodes.map((code) => ({ issueType: code, statuses: this.workflowFor(projectId, code).statuses }));
  }

  /**
   * The project's live issues of `types`, narrowed by the four filters the
   * server applies — assignee, label, priority, and `query` as a
   * case-insensitive substring of the key, the summary or the description — as
   * cards. The board and a column's page read the same set.
   */
  private boardIssues(
    projectId: string,
    types: readonly MockBoardType[],
    params: Pick<BoardParams, "assigneeId" | "labelId" | "priority" | "query">,
  ): BoardIssue[] {
    const typeCodes = types.map((type) => type.issueType);
    const needle = params.query?.toLowerCase() ?? "";
    return this.issues
      .filter((item) => item.projectId === projectId && item.deletedAt === null)
      .filter((item) => typeCodes.includes(item.issueType))
      .filter((item) => !params.assigneeId || item.assigneeId === params.assigneeId)
      // On the attached ids, exactly like `listIssues`: a soft-deleted label
      // matches nothing rather than the issues it used to be on.
      .filter((item) => !params.labelId || this.labelsForIssue(item.id).some((label) => label.id === params.labelId))
      .filter((item) => !params.priority || item.priority === params.priority)
      .filter(
        (item) =>
          !needle ||
          item.issueKey.toLowerCase().includes(needle) ||
          item.summary.toLowerCase().includes(needle) ||
          item.description.toLowerCase().includes(needle),
      )
      .map((item) => this.boardIssue(item));
  }

  /**
   * `GET /projects/{projectId}/board/columns/{statusKey}/issues` (backend
   * TAS-430, `BoardController` and `BoardServiceImpl.listBoardColumnIssues` at
   * `cbd3f0af`), in the server's order:
   *
   * 1. the gateway's binding — a page size outside 1–200, an empty `query`, an
   *    `afterCreatedAt` that is not an instant or an `afterId` that is not a
   *    UUID: 400 `INVALID_ARGUMENT` "Invalid request parameters";
   * 2. the controller: half a cursor, 400 `BAD_REQUEST`
   *    (`BOARD_CURSOR_PAIR_MESSAGE`); then a type filter it cannot parse is an
   *    empty page once the access check has passed;
   * 3. the service: a blank status key or a cursor instant outside years
   *    1–9999, 400 `BAD_REQUEST` (`BOARD_CURSOR_REFUSAL_MESSAGE`);
   * 4. the board's access check (404, 403). After it nothing is refused for
   *    being unknown: a type the registry does not hold, or a status no type's
   *    workflow has, is an empty page.
   *
   * `MOCK_PROJECT_TRIGGERS.columnPagesRefused` in the project's description
   * makes every page of it refuse once the access check has passed — 503
   * `UNAVAILABLE` — the failure a reader alone cannot otherwise make.
   *
   * The column is `buildMockBoard`'s, by the same rules — an issue counts only
   * when its **own** type's workflow holds the status, and `includeDone` off
   * drops it when that workflow files the status under `DONE` — in
   * `compareBoardIssues` order, uncut. The page is what sorts strictly after
   * the cursor, at most `pageSize` (50 when not given); `totalCount` is the
   * whole column whatever the cursor, and `hasMore` whether any lies past the
   * page.
   */
  getBoardColumnPage(projectId: string, statusKey: string, params: BoardColumnPageParams = {}): BoardColumnPage {
    const pageSize = params.pageSize ?? BOARD_DEFAULT_PAGE_SIZE;
    if (
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > BOARD_MAX_PAGE_SIZE ||
      params.query === "" ||
      (params.afterCreatedAt !== undefined && Number.isNaN(Date.parse(params.afterCreatedAt))) ||
      (params.afterId !== undefined && !UUID_PATTERN.test(params.afterId))
    ) {
      throw new MockApiError("INVALID_ARGUMENT", INVALID_REQUEST_PARAMETERS_MESSAGE);
    }
    if ((params.afterCreatedAt === undefined) !== (params.afterId === undefined)) {
      throw new MockApiError("BAD_REQUEST", BOARD_CURSOR_PAIR_MESSAGE);
    }
    const empty: BoardColumnPage = { statusKey, issues: [], totalCount: 0, hasMore: false };
    const access = () => {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project) throw new MockApiError("NOT_FOUND", "Project not found");
      if (!this.membersByProject[projectId]?.some((member) => member.userId === this.currentUserId)) {
        throw new MockApiError("PERMISSION_DENIED", "Access denied");
      }
      return project;
    };
    if (params.issueType && !isIssueTypeCode(params.issueType)) {
      access();
      return empty;
    }
    const instant = params.afterCreatedAt === undefined ? null : Date.parse(params.afterCreatedAt);
    if (statusKey.trim() === "" || (instant !== null && (instant < CURSOR_EARLIEST_MS || instant > CURSOR_LATEST_MS))) {
      throw new MockApiError("BAD_REQUEST", BOARD_CURSOR_REFUSAL_MESSAGE);
    }
    const project = access();
    if (project.description?.includes(MOCK_PROJECT_TRIGGERS.columnPagesRefused)) {
      throw new MockApiError("UNAVAILABLE", "issue-service is unavailable");
    }
    if (params.issueType && !this.inRegistry(projectId, params.issueType)) {
      return empty;
    }
    const types = this.boardTypes(projectId, params.issueType);
    const board = buildMockBoard(projectId, types, this.boardIssues(projectId, types, params), {
      includeDone: params.includeDone,
      pageSizePerColumn: Number.MAX_SAFE_INTEGER,
    });
    const column = board.columns.find((item) => item.statusKey === statusKey);
    if (!column) return empty;
    const cursor =
      params.afterCreatedAt !== undefined && params.afterId !== undefined
        ? { createdAt: params.afterCreatedAt, id: params.afterId }
        : null;
    const after = cursor ? column.issues.filter((issue) => compareBoardIssues(issue, cursor) > 0) : column.issues;
    return {
      statusKey,
      issues: after.slice(0, pageSize),
      totalCount: column.issues.length,
      hasMore: after.length > pageSize,
    };
  }

  /** An issue as `BoardIssueDto` states it, field by field, with the person and the labels joined in. */
  private boardIssue(issue: StoredIssue): BoardIssue {
    const user = issue.assigneeId ? this.users.find((item) => item.id === issue.assigneeId) : undefined;
    const avatar = issue.assigneeId ? this.avatars.get(issue.assigneeId) : undefined;
    return {
      id: issue.id,
      issueKey: issue.issueKey,
      summary: issue.summary,
      issueType: issue.issueType,
      priority: issue.priority,
      statusKey: issue.status,
      description: issue.description,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
      version: issue.version,
      assignee: issue.assigneeId
        ? {
            id: issue.assigneeId,
            displayName: user?.displayName ?? null,
            avatarUrl: avatar && this.avatarObjects.has(avatar.objectKey) ? avatar.downloadUrl : null,
          }
        : null,
      // By name, then id — the board's order since backend TAS-431, the same
      // as the issue read's (`labelsForIssue`).
      labels: this.labelsForIssue(issue.id),
    };
  }

  /**
   * `GET /project-stats` (backend TAS-211): one entry per project `listProjects`
   * answers — the reader's, archived ones left out — in that order. `issueCount`
   * counts every live issue of any type and status, `memberCount` every member,
   * and `members` is the first five by `addedAt`, then `userId`, in that order
   * and named the way the member read names them.
   */
  getProjectStats(): ProjectStats[] {
    return this.listProjects().map((project) => {
      const members = this.listMembers(project.id);
      return {
        projectId: project.id,
        issueCount: this.issues.filter((item) => item.projectId === project.id && item.deletedAt === null).length,
        memberCount: members.length,
        members: [...members]
          .sort((a, b) => byText(a.addedAt ?? "", b.addedAt ?? "") || byText(a.userId, b.userId))
          .slice(0, 5),
      };
    });
  }

  /**
   * `GET /issues/search`, as the gateway answers it since backend PR #200 put
   * the minimum of three into the contract it generates its controller from,
   * and in the order that PR declares.
   *
   * The semantics that matter, because the e2e suite runs against this and
   * would otherwise pass cases the deployed gateway refuses: a query below
   * `SEARCH_QUERY_MIN_LENGTH` (the empty string included) is an
   * `INVALID_ARGUMENT` — the gateway's "Invalid request parameters" for a raw
   * value under three, see `requireSearchQuery` — an *absent* query is "no
   * text filter"; the match is a case-insensitive substring over `issueKey` OR
   * `summary` OR `description`; every other parameter ANDs onto it; the answer
   * is newest first, `id`
   * descending among equal instants; `totalCount` counts the whole matching set
   * and the page is sliced after; and with no `projectId` the search covers the
   * projects this user can see — not every project in the store.
   */
  searchIssues(params: SearchIssuesParams = {}): Page<IssueSearchHit> {
    const query = requireSearchQuery(params.query);
    // A type filter outside `IssueTypeDto`'s pattern is an empty page before
    // anything is checked (`IssueController`, backend #226); a well-formed key
    // nobody holds simply matches nothing below.
    if (params.issueType !== undefined && params.issueType !== "" && !isIssueTypeCode(params.issueType)) {
      return { items: [], page: params.page ?? 0, pageSize: params.pageSize ?? 0, totalCount: 0 };
    }
    // 20 is the contract's declared default for this route, so the mock pages
    // the way the gateway does when the caller states nothing.
    const page = params.page ?? 0;
    const pageSize = params.pageSize ?? 20;

    // A project that does not exist is a 404 from the gateway, and asking for one
    // this user is not in is the same answer.
    //
    // Measured against `visible`, not through `getProject`: that one checks
    // existence and nothing else, so the scoped branch used to hand a
    // non-member every issue in a project they are not in — a reference
    // implementation stating an access rule in its own comment and not keeping
    // it, and an e2e case that could pass here and be refused by the gateway.
    //
    // Unscoped, the search covers `listProjects` — which leaves archived
    // projects out since backend PR #159, so their issues do not appear in it.
    // Scoped, an archived project of the reader's is searched like any other:
    // its reads stay open.
    const visible = new Set(
      (params.projectId === undefined ? this.listProjects() : this.memberProjects()).map((project) => project.id),
    );
    if (params.projectId !== undefined && !visible.has(params.projectId)) {
      throw new MockApiError("NOT_FOUND", "Project not found");
    }

    const matched = this.issues
      .filter((item) => item.deletedAt === null)
      // One rule either way: the unscoped search covers every visible project,
      // and the scoped one covers a visible project. Neither reaches past them.
      .filter((item) => (params.projectId === undefined ? visible.has(item.projectId) : item.projectId === params.projectId))
      .filter((item) => !params.statusKey || item.status === params.statusKey)
      .filter((item) => !params.assigneeId || item.assigneeId === params.assigneeId)
      .filter((item) => !params.reporterId || item.reporterId === params.reporterId)
      .filter((item) => !params.priority || item.priority === params.priority)
      .filter((item) => !params.issueType || item.issueType === params.issueType)
      .filter((item) => matchesSearchQuery(item, query))
      // `createdAt desc, id desc`, as the route declares since backend PR #200.
      .sort((a, b) => byCreatedAt(b, a) || byText(b.id, a.id));

    const items = matched.slice(page * pageSize, page * pageSize + pageSize).map((item) => this.searchHit(item));
    return {
      items,
      page,
      // What the page actually holds, which is what RestTaskaApi reports too —
      // the two answer identically whether or not the caller stated a size.
      pageSize: params.pageSize ?? items.length,
      totalCount: matched.length,
    };
  }

  /**
   * `IssueDetailsWithHistoryResponseDto`, assembled the way issue-service
   * assembles it at develop `60d62ee` (`IssueDetailsServiceImpl`): the issue,
   * its labels, watchers, links and attachments, every person on them named by
   * the profile read, `isWatching` and a live comment count.
   *
   * A person nobody can name gets a summary with the id and no name, which is
   * what `IssueMapperUtils.resolveUser` builds — never a dropped summary — and a
   * watcher row nobody can name simply carries none, which is what
   * `IssueWatcherMapper.toWatcherProto` does. The mock cannot fail one part of
   * the read on its own, so every part is always present here; the `null` part
   * is reachable only against a fake (src/screens/BoardScreen.test.tsx).
   *
   * Three things match the server rather than this store's other reads. The
   * watchers come newest first (`ORDER BY created_at DESC`, as on the list
   * route). Their `totalCount` is `null`, because the details DTO states no
   * count and the gateway sends none. And a link whose other issue is deleted
   * is left out — the details join filters `other.deleted_at IS NULL`
   * (`IssueLinkRepository`, read at `60d62ee`) — while `listIssueLinks` keeps
   * it, as the list route does.
   */
  getIssue(projectId: string, issueId: string): IssueDetailsWithHistory {
    const issue = this.findIssue(projectId, issueId);
    const watchers = this.watchersNewestFirst(issue.id).map((item) => this.watcherView(item, true));
    const details: IssueDetails = {
      ...this.issueView(issue),
      assignee: issue.assigneeId ? this.personSummary(issue.assigneeId) : null,
      reporter: this.personSummary(issue.reporterId),
      watchers: { watchers, totalCount: null },
      isWatching: watchers.some((item) => item.userId === this.currentUserId),
      links: this.linksOf(issue.id)
        .filter((link) => this.otherEndIsLive(link, issue.id))
        .map((link) => this.linkView(link, issue.id, true)),
      attachments: this.attachmentsOf(issue.id).map((item) => this.attachmentView(item, true)),
      commentCount: (this.commentsByIssue[issue.id] ?? []).length,
    };
    return { issue: details, history: (this.historyByIssue[issue.id] ?? []).map((event) => this.historyView(event)) };
  }

  /**
   * A history event as the details read serves it (backend TAS-398): `actor`
   * is the profile behind `actorUserId` for anybody with an account — a former
   * member of the project included, since profiles are read by id and not
   * through the membership (`IssueDetailsSources`) — and `null` for an id
   * nobody holds. Only this read names the actor; the stored event, which the
   * transition answer's history would be, does not.
   */
  private historyView(event: IssueHistoryEvent): IssueHistoryEvent {
    const hasAccount = this.users.some((user) => user.id === event.actorUserId);
    return {
      ...event,
      actor: hasAccount ? this.personSummary(event.actorUserId) : null,
      participants: this.historyParticipants(event.payload),
    };
  }

  /**
   * `IssueHistoryResponseDto.participants` (backend TAS-431): a profile for
   * each id in the payload's server-owned fields — the ones
   * `HistoryParticipants.ids` reads at `cbd3f0af` — by anybody with an account,
   * a former member of the project included; an id nobody holds is left out
   * and stays in the payload. Ids in free text are never read.
   */
  private historyParticipants(payload: IssueHistoryEvent["payload"]): Record<string, UserSummary> {
    const ids = HISTORY_PARTICIPANT_FIELDS.map((field) => payload[field]);
    const watchers = Array.isArray(payload.watcherIds) ? (payload.watcherIds as unknown[]) : [];
    const named: Record<string, UserSummary> = {};
    for (const id of [...ids, ...watchers]) {
      if (typeof id !== "string" || !UUID_PATTERN.test(id) || Object.hasOwn(named, id)) continue;
      if (this.users.some((user) => user.id === id)) named[id] = this.personSummary(id);
    }
    return named;
  }

  /**
   * `GET /issues/by-key/{issueKey}`, in the order issue-service checks at
   * develop `60d62ee`: the key is matched case-insensitively against issues
   * that are not deleted (`findActiveByKeyIgnoreCase`), a miss is `NOT_FOUND`,
   * and then the reader has to be a member of the issue's project —
   * `IssueAccessGuard` asks `ProjectRoleChecker`, which refuses a non-member
   * with `PERMISSION_DENIED` "Access denied".
   *
   * **Stricter than this store's other reads, and on purpose.** `getIssue`
   * and the rest of the read routes here let a non-member through (see
   * `membersByProject` in the constructor); this one does not, because the
   * by-key route's whole job in the UI is to tell those two answers apart, and a
   * mock that never produced the 403 would leave that branch unexercised.
   * Anna is not on MOB, so `MOB-5` is the 403 and `NOPE-1` the 404.
   */
  getIssueByKey(issueKey: string): Issue {
    const wanted = issueKey.toUpperCase();
    const issue = this.issues.find((item) => item.issueKey.toUpperCase() === wanted && item.deletedAt === null);
    if (!issue) {
      throw new MockApiError("NOT_FOUND", `Issue not found: ${issueKey}`);
    }
    if (!this.membersByProject[issue.projectId]?.some((member) => member.userId === this.currentUserId)) {
      throw new MockApiError("PERMISSION_DENIED", "Access denied");
    }
    // An archived project's issue answers like any other (backend PR #159).
    return this.issueView(issue);
  }

  /**
   * `POST /projects/{projectId}/issues`. A `statusKey` the contract's pattern
   * refuses is the gateway's binding, before anything (400 "Invalid request
   * parameters"); then the type key's pattern (`IssueMapper`, backend #226),
   * the project, the registry in issue-service (`IssueServiceImpl`); then,
   * when a status was named, the workflow of the type — its own or the shared
   * default, as the server resolves it — must hold it (400
   * `FAILED_PRECONDITION`, `details.reason` `STATUS_NOT_IN_WORKFLOW`, backend
   * TAS-428). The issue starts in that status, `TODO` when none was named.
   */
  createIssue(projectId: string, input: CreateIssueInput): Issue {
    if (input.statusKey !== undefined && !STATUS_KEY_PATTERN.test(input.statusKey)) {
      throw new MockApiError("INVALID_ARGUMENT", INVALID_REQUEST_PARAMETERS_MESSAGE);
    }
    if (!isIssueTypeCode(input.issueType)) throw new MockApiError("BAD_REQUEST", INVALID_ISSUE_TYPE_KEY_MESSAGE);
    const project = this.getProject(projectId);
    this.refuseArchivedWrite(projectId);
    if (!this.inRegistry(projectId, input.issueType)) {
      throw new MockApiError("INVALID_ARGUMENT", issueTypeNotDefinedMessage(input.issueType));
    }
    const status = input.statusKey ?? "TODO";
    if (
      input.statusKey !== undefined &&
      !this.workflowFor(projectId, input.issueType).statuses.some((item) => item.statusKey === input.statusKey)
    ) {
      throw new MockApiError("FAILED_PRECONDITION", INITIAL_STATUS_NOT_IN_WORKFLOW_MESSAGE, {
        reason: STATUS_NOT_IN_WORKFLOW_REASON,
      });
    }
    requireListed(META.priorities, input.priority);
    requirePlanningFields(input);
    const planning = resolvePlanningFields(input, emptyPlanningFields());
    const issueNumber =
      Math.max(0, ...this.issues.filter((item) => item.projectId === projectId).map((item) => item.issueNumber)) + 1;
    const issue: StoredIssue = {
      id: makeId("issue"),
      projectId,
      issueNumber,
      issueKey: `${project.projectKey}-${issueNumber}`,
      issueType: input.issueType,
      summary: input.summary.trim(),
      description: input.description.trim(),
      status,
      priority: input.priority,
      assigneeId: null,
      reporterId: this.currentUserId,
      createdAt: now(),
      updatedAt: now(),
      version: 1,
      deletedAt: null,
      labels: [],
      ...planning,
    };
    this.issues.push(issue);
    this.historyByIssue[issue.id] = [];
    this.pushHistory(issue.id, "CREATED", this.currentUserId, {});
    // The reporter watches what they filed, as issue-service subscribes them
    // (`IssueAutoWatchService.watchReporterOnCreate`, on by default).
    this.autoWatch(issue, this.currentUserId, this.currentUserId);
    this.notifications.unshift(
      this.notification("ISSUE_CREATED", "Issue created", `${issue.issueKey} was created`, issue, now(), null),
    );
    return this.issueView(issue);
  }

  /**
   * `PATCH /issues/{issueId}`, in the order issue-service checks it at develop
   * `60d62ee` (`GrpcIssueService.patchIssue`, `IssuePatchServiceImpl`,
   * `IssuePatchExecutor`) — see `TaskaApi.updateIssue`:
   *
   * 1. the refusals the request carries on its face — the version, a blank
   *    summary, the input-only planning fields — before anything is looked up;
   * 2. the issue exists;
   * 3. the version. A stale one is a conflict carrying the issue as it stands,
   *    and nothing is written — not even a refusal for the dates below, which
   *    the server never reaches;
   * 4. the request laid over the stored issue, and the merged start/due pair
   *    checked, refused in the server's own sentence; then, when the request
   *    names a type (backend #226), that type must be in the registry and its
   *    workflow must hold the issue's status (`IssuePatchServiceImpl`);
   * 5. only when the assignee actually changes, to somebody other than `null`
   *    or the caller: that person must hold `assign-issue-roles`;
   * 6. a patch that changes nothing answers the issue as it is — no version
   *    bump, no `updatedAt`, no history.
   *
   * The caller's own role is not checked, like every other issue write in this
   * store (`update-issue-roles`, and `assign-issue-roles` for an assignee
   * change, are the server's).
   *
   * A real write bumps the version by exactly one and records history as this
   * store always has: `PRIORITY` when the priority moved and `UPDATED` for any
   * other field — the server writes `UPDATED` for both, a difference that stays
   * on the backlog — and `ASSIGNED` when the assignee moved, with an
   * `ISSUE_ASSIGNED` notification and a subscription for a new assignee who is
   * somebody (`IssueAutoWatchService.watchAssigneeOnAssign`).
   */
  updateIssue(projectId: string, issueId: string, input: UpdateIssueInput, expectedVersion: number): IssueWriteAnswer {
    const versionRefusal = issueVersionRefusal(expectedVersion);
    if (versionRefusal) throw new MockApiError(versionRefusal.code, versionRefusal.message);
    requirePlanningFields(input);
    const summaryRefusal = blankSummaryRefusal(input);
    if (summaryRefusal) throw new MockApiError(summaryRefusal.code, summaryRefusal.message);
    const typeRefusal = issueTypePatchRefusal(input);
    if (typeRefusal) throw new MockApiError(typeRefusal.code, typeRefusal.message);
    if (input.priority !== undefined) requireListed(META.priorities, input.priority);

    const issue = this.findIssue(projectId, issueId);
    this.refuseArchivedWrite(projectId);
    if (expectedVersion !== issue.version) {
      throw new IssueVersionConflictError(this.writeAnswer(issue), expectedVersion);
    }

    const planning = resolvePlanningFields(input, issue);
    if (planning.startDate !== null && planning.dueDate !== null && planning.startDate > planning.dueDate) {
      throw new MockApiError("INVALID_ARGUMENT", datesOutOfOrderServerMessage(planning.startDate, planning.dueDate));
    }
    // Whenever the key is present, as the server checks it — the same type
    // again included.
    if (input.issueType !== undefined) {
      if (!this.inRegistry(projectId, input.issueType)) {
        throw new MockApiError("INVALID_ARGUMENT", issueTypeNotDefinedMessage(input.issueType));
      }
      const target = this.workflowFor(projectId, input.issueType);
      if (!target.statuses.some((status) => status.statusKey === issue.status)) {
        throw new MockApiError("FAILED_PRECONDITION", STATUS_NOT_IN_TARGET_TYPE_MESSAGE, {
          reason: STATUS_NOT_IN_TARGET_WORKFLOW_REASON,
        });
      }
    }
    const next = {
      issueType: input.issueType ?? issue.issueType,
      summary: input.summary ?? issue.summary,
      // `null` clears it, and a cleared description reads back as `""` — the
      // one spelling of empty `Issue.description` has.
      description: input.description === undefined ? issue.description : (input.description ?? ""),
      priority: input.priority ?? issue.priority,
      assigneeId: input.assigneeId === undefined ? issue.assigneeId : input.assigneeId,
      ...planning,
    };

    const assigneeChanged = next.assigneeId !== issue.assigneeId;
    if (assigneeChanged && next.assigneeId !== null && next.assigneeId !== this.currentUserId) {
      this.getUser(next.assigneeId);
      this.requireAssignableRole(projectId, next.assigneeId);
    }

    const changedPriority = next.priority !== issue.priority;
    const fieldsChanged =
      changedPriority ||
      next.issueType !== issue.issueType ||
      next.summary !== issue.summary ||
      next.description !== issue.description ||
      next.storyPoints !== issue.storyPoints ||
      next.startDate !== issue.startDate ||
      next.dueDate !== issue.dueDate ||
      next.originalEstimateMinutes !== issue.originalEstimateMinutes ||
      next.remainingEstimateMinutes !== issue.remainingEstimateMinutes;
    if (!fieldsChanged && !assigneeChanged) return this.writeAnswer(issue);

    const previousAssigneeId = issue.assigneeId;
    Object.assign(issue, next, { updatedAt: now(), version: issue.version + 1 });
    if (fieldsChanged) {
      this.pushHistory(issue.id, changedPriority ? "PRIORITY" : "UPDATED", this.currentUserId, {
        field: changedPriority ? "priority" : "issue",
        to: changedPriority ? next.priority : undefined,
      });
    }
    if (assigneeChanged) {
      // The server's payload names both ends by id (`createIssueAssignedPayload`).
      this.pushHistory(issue.id, "ASSIGNED", this.currentUserId, {
        previousAssigneeId,
        assigneeId: next.assigneeId,
      });
      if (next.assigneeId) {
        this.autoWatch(issue, next.assigneeId, this.currentUserId);
        this.notifications.unshift(
          this.notification("ISSUE_ASSIGNED", "Issue assigned", `${issue.issueKey} was assigned to you`, issue, now(), null),
        );
      }
    }
    return this.writeAnswer(issue);
  }

  /**
   * The issue as a write answers it: no `labels`, which the server's write
   * answer never fills, and its `timeSpentMinutes`, which it does.
   */
  private writeAnswer(issue: StoredIssue): IssueWriteAnswer {
    const { labels: _labels, ...answer } = issue;
    return { ...answer, timeSpentMinutes: this.timeSpentOn(issue.id) };
  }

  /**
   * A subscription the server makes on the reader's behalf — the reporter on a
   * create, a new assignee on an assignment. Idempotent, as the server's insert
   * is (`ON CONFLICT DO NOTHING`), and it writes no history row, as the server
   * writes none. Until TAS-246 this store did neither — docs/ai/API-DIVERGENCE.md,
   * "Assigning an issue subscribes the assignee, and creating one subscribes the
   * reporter; the contract does not say so, and the mock did neither".
   */
  private autoWatch(issue: StoredIssue, userId: string, actorId: string): void {
    if (this.watchers.some((item) => item.issueId === issue.id && item.userId === userId)) return;
    this.watchers.push({
      id: makeId("watcher"),
      issueId: issue.id,
      projectId: issue.projectId,
      userId,
      createdAt: now(),
      createdBy: actorId,
    });
  }

  /**
   * The assignee half of `assign-issue-roles`. A non-member holds no role in
   * the project, so none of theirs is in that set, and they are refused just as
   * a VIEWER is.
   *
   * **The sentence is this store's**, one for both cases. The gateway's
   * refusals are worded by `ProjectRoleChecker` — `"Access denied"` for a
   * non-member, `"Not allowed role"` for a member with the wrong role (see
   * `requireUploadRole`) — and nothing was read to confirm which of them an
   * assignee draws. Named so nobody takes this one for the server's words.
   */
  private requireAssignableRole(projectId: string, assigneeId: string): void {
    const role = this.membersByProject[projectId]?.find((member) => member.userId === assigneeId)?.role;
    if (role !== "ADMIN" && role !== "MEMBER") {
      throw new MockApiError("PERMISSION_DENIED", "Only an admin or a member of this project can be assigned an issue");
    }
  }

  /**
   * `PUT /issues/{issueId}/transition/{transitionId}`, in issue-service's
   * order (backend TAS-422): a version the gateway cannot use is refused before
   * anything; then the issue (404), the archive, then — with `If-Match` — the
   * version, compared even when the transition would not change the status:
   * 409 `ABORTED` "Issue version does not match expected version",
   * `{currentVersion, currentStatus}` as strings, nothing changed; then
   * whether the transition is available from the issue's status.
   */
  transitionIssue(projectId: string, issueId: string, transitionId: string, expectedVersion?: number): Issue {
    if (expectedVersion !== undefined) {
      const versionRefusal = issueVersionRefusal(expectedVersion);
      if (versionRefusal) throw new MockApiError(versionRefusal.code, versionRefusal.message);
    }
    const issue = this.findIssue(projectId, issueId);
    this.refuseArchivedWrite(projectId);
    this.changeMeanwhile(issue);
    if (expectedVersion !== undefined && expectedVersion !== issue.version) {
      throw new MockApiError("ABORTED", "Issue version does not match expected version", {
        currentVersion: String(issue.version),
        currentStatus: issue.status,
      });
    }
    const workflow = this.workflowFor(projectId, issue.issueType);
    const fromStatus = workflow.statuses.find((status) => status.statusKey === issue.status);
    const transition = workflow.transitions.find(
      (item) => item.id === transitionId && item.fromStatusId === fromStatus?.id,
    );
    const toStatus = workflow.statuses.find((status) => status.id === transition?.toStatusId)?.statusKey;
    if (!transition || !toStatus) {
      throw new MockApiError("FAILED_PRECONDITION", "Transition is not available for the current issue status");
    }
    const from = issue.status;
    issue.status = toStatus;
    issue.updatedAt = now();
    issue.version += 1;
    this.pushHistory(issue.id, "TRANSITIONED", this.currentUserId, { from, to: toStatus });
    this.notifications.unshift(
      this.notification("ISSUE_TRANSITIONED", "Status changed", `${issue.issueKey} moved to ${toStatus}`, issue, now(), null),
    );
    return this.issueView(issue);
  }

  /**
   * `MOCK_PROJECT_TRIGGERS.changedMeanwhile`, carried out: another member of
   * the project sets the issue's priority one step on, as a write from their
   * own session would — the version and `updatedAt` move, and the history says
   * who did it.
   */
  private changeMeanwhile(issue: StoredIssue): void {
    if (!this.changingMeanwhile.delete(issue.id)) return;
    const someoneElse =
      (this.membersByProject[issue.projectId] ?? []).find((member) => member.userId !== this.currentUserId)?.userId ??
      this.currentUserId;
    const order: IssuePriorityCode[] = ["LOW", "MEDIUM", "HIGH"];
    const next = order[(order.indexOf(issue.priority) + 1) % order.length] ?? "MEDIUM";
    issue.priority = next;
    issue.updatedAt = now();
    issue.version += 1;
    this.pushHistory(issue.id, "PRIORITY", someoneElse, { to: next });
  }

  deleteIssue(projectId: string, issueId: string): void {
    const issue = this.findIssue(projectId, issueId);
    this.refuseArchivedWrite(projectId);
    issue.deletedAt = now();
    issue.updatedAt = now();
    issue.version += 1;
    this.pushHistory(issue.id, "UPDATED", this.currentUserId, { field: "deleted" });
  }

  listIssueLinks(projectId: string, issueId: string): IssueLink[] {
    const issue = this.findIssue(projectId, issueId);
    return this.linksOf(issue.id).map((link) => this.linkView(link, issue.id));
  }

  private linksOf(issueId: string): StoredIssueLink[] {
    return this.links
      .filter((link) => link.sourceIssueId === issueId || link.targetIssueId === issueId)
      .sort(byCreatedAt);
  }

  createIssueLink(projectId: string, issueId: string, input: CreateIssueLinkInput): IssueLink {
    requireListed(META.linkTypes, input.linkType);
    const issue = this.findIssue(projectId, issueId);
    this.refuseArchivedWrite(projectId);
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
    this.refuseArchivedWrite(projectId);
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
    return this.projectLabels
      .filter((label) => label.projectId === projectId && label.deletedAt === null)
      .sort(byLabelName);
  }

  createProjectLabel(projectId: string, input: CreateProjectLabelInput): ProjectLabel {
    this.getProject(projectId);
    this.refuseArchivedWrite(projectId);
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
    this.refuseArchivedWrite(projectId);
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
    this.refuseArchivedWrite(projectId);
    const label = this.findProjectLabel(projectId, labelId);
    label.deletedAt = now();
  }

  /**
   * `ProjectIssueTypeService.authorizeWrite` (backend #212): the project, then
   * the role — anybody but the project's ADMIN, a non-member included, gets the
   * one sentence — then the archive (`ProjectWriteGuard`). An outsider is told
   * about the role, never about the archive.
   */
  private requireIssueTypeAdmin(projectId: string): void {
    const project = this.projects.find((item) => item.id === projectId);
    if (!project) throw new MockApiError("NOT_FOUND", "Project not found");
    const role = this.membersByProject[projectId]?.find((member) => member.userId === this.currentUserId)?.role;
    if (role !== "ADMIN") throw new MockApiError("PERMISSION_DENIED", ISSUE_TYPE_ADMIN_REQUIRED_MESSAGE);
    this.refuseArchivedProject(project);
  }

  /** The registry entry itself (not a copy), or 404 in the service's words. */
  private findIssueType(projectId: string, code: string): ProjectIssueType {
    const entry = (this.issueTypesByProject[projectId] ?? []).find((type) => type.code === code);
    if (!entry) throw new MockApiError("NOT_FOUND", ISSUE_TYPE_NOT_FOUND_MESSAGE);
    return entry;
  }

  /**
   * `POST /projects/{projectId}/issue-types` in the server's order: the body
   * (the gateway's bean validation and deserialization — the code's pattern, a
   * blank or over-50 name measured before it is stripped, a colour, a shape or
   * an icon outside its set, a `null` shape, a negative `sortOrder`, a
   * `workflowId` that is not a UUID, an undeclared key), the project, the
   * role, the archive, then a code the project already holds (409). The name
   * is stored stripped, `shape` defaults to `square`, `icon` to none and
   * `sortOrder` to 100 (backend TAS-432).
   *
   * Since backend TAS-437 (develop `78019ece`, `IssueTypeCreationTransactions`
   * and `WorkflowCreatedTypeBindingService`) the type is bound in the same
   * operation: to `workflowId` — the shared default or an own workflow of the
   * project, a donor included, else 400 `INVALID_ARGUMENT`
   * `WORKFLOW_NOT_IN_PROJECT` — or, with none, to the workflow the registry's
   * first type runs on. A project with no type has no such first one and is
   * refused (400 `FAILED_PRECONDITION`). An own workflow it is bound to moves
   * one version on. The 201 is `CreatedProjectIssueTypeDto`: the entry, with a
   * new `generation`, and the `workflowId`.
   */
  createProjectIssueType(projectId: string, input: CreateProjectIssueTypeInput, requestId?: string): CreatedProjectIssueType {
    if (!isIssueTypeCreateBody(input)) throw new MockApiError("INVALID_ARGUMENT", INVALID_REQUEST_PARAMETERS_MESSAGE);
    const replayed = this.replayCommand(requestId, { kind: "create-type", projectId, input });
    if (replayed.done) return replayed.answer as CreatedProjectIssueType;
    this.requireIssueTypeAdmin(projectId);
    if (this.inRegistry(projectId, input.code)) {
      throw new MockApiError("ALREADY_EXISTS", issueTypeExistsMessage(input.code));
    }
    const first = this.registryOf(projectId)[0];
    if (!first) throw new MockApiError("FAILED_PRECONDITION", "Project has no default issue type");
    let target: WorkflowDefinition;
    if (input.workflowId === undefined) target = this.workflowFor(projectId, first.code);
    else if (input.workflowId === this.workflow.id) target = this.workflow;
    else {
      const owned = (this.ownedWorkflows[projectId] ?? []).find((workflow) => workflow.id === input.workflowId);
      if (!owned) {
        throw new MockApiError("INVALID_ARGUMENT", "Workflow is not owned by this project", { reason: "WORKFLOW_NOT_IN_PROJECT" });
      }
      target = owned;
    }
    const entry: ProjectIssueType = {
      code: input.code,
      name: input.name.trim(),
      color: input.color,
      shape: input.shape ?? "square",
      icon: input.icon ?? null,
      sortOrder: input.sortOrder ?? ISSUE_TYPE_DEFAULT_SORT_ORDER,
      generation: makeId("generation"),
    };
    (this.issueTypesByProject[projectId] ??= []).push(entry);
    const bindings = (this.workflowOverrides[projectId] ??= {});
    if (target === this.workflow) delete bindings[entry.code];
    else {
      bindings[entry.code] = target;
      target.version += 1;
      target.updatedAt = now();
    }
    const answer: CreatedProjectIssueType = { ...entry, workflowId: target.id };
    this.pendOnTrigger(entry.name, "ISSUE_TYPE_CREATION_PENDING", "Issue type creation is pending; retry with the same X-Request-Id", {
      kind: "create-type",
      projectId,
      input,
    }, answer);
    return answer;
  }

  /**
   * `PATCH /projects/{projectId}/issue-types/{code}` in the server's order: the
   * gateway's parse (an undeclared key, `null` for anything but `icon`, a
   * fractional `sortOrder`: 400 "Invalid request parameters"); `{}` (400 "At
   * least one field is required", before the role — `{ icon: null }` is not
   * empty); the project, the role, the archive; a code the project does not
   * hold (404); then the merged values (400 "Invalid issue type name, color,
   * icon, shape or sortOrder" — the name measured before it is stripped). A
   * key left out keeps its value; `icon: null` removes the icon (backend
   * TAS-432). The 200 is the saved entry.
   */
  updateProjectIssueType(projectId: string, code: string, input: UpdateProjectIssueTypeInput): ProjectIssueType {
    if (!ISSUE_TYPE_CODE_PATTERN.test(code) || !isIssueTypePatchShape(input)) {
      throw new MockApiError("INVALID_ARGUMENT", INVALID_REQUEST_PARAMETERS_MESSAGE);
    }
    if (sentKeys(input as Record<string, unknown>).length === 0) {
      throw new MockApiError("INVALID_ARGUMENT", ISSUE_TYPE_EMPTY_PATCH_MESSAGE);
    }
    this.requireIssueTypeAdmin(projectId);
    const entry = this.findIssueType(projectId, code);
    const name = input.name ?? entry.name;
    const color = input.color ?? entry.color;
    const shape = input.shape ?? entry.shape;
    const icon = input.icon === undefined ? entry.icon : input.icon;
    const sortOrder = input.sortOrder ?? entry.sortOrder;
    if (
      name.trim() === "" ||
      name.length > ISSUE_TYPE_NAME_MAX_LENGTH ||
      !isIssueTypeColor(color) ||
      !isIssueTypeShape(shape) ||
      (icon !== null && !isIssueTypeIcon(icon)) ||
      sortOrder < 0
    ) {
      throw new MockApiError("INVALID_ARGUMENT", ISSUE_TYPE_INVALID_FIELDS_MESSAGE);
    }
    Object.assign(entry, { name: name.trim(), color, shape, icon, sortOrder });
    return { ...entry };
  }

  /**
   * `DELETE /projects/{projectId}/issue-types/{code}` in the server's order:
   * the project, the role, the archive; a code the project does not hold
   * (404); the only type left (400 `FAILED_PRECONDITION`, `details.reason`
   * `LAST_ISSUE_TYPE`); then a type **live** issues carry — a deleted issue
   * does not count since backend TAS-418 (`includeDeleted=false`) — 400
   * `details.issueCount` as a string. The type's workflow binding goes with
   * it (backend TAS-418 fences bindings by the registry's generation): a
   * workflow left with no type stays as a donor (backend TAS-436), and a code
   * added again runs on the workflow it is created on.
   *
   * With `moveIssuesTo` (backend TAS-433, develop `78019ece`:
   * `IssueTypeDeletionTransactions.begin`, then issue-service's
   * `IssueTypeMoveService.move`): a target that is the type itself or not in
   * the registry is 400 `INVALID_ARGUMENT` `ISSUE_TYPE_TARGET_INVALID`; a
   * mapping or a generation without a target 400; after the role and the
   * code, an `expectedGeneration` that is not the entry's is 409 `ABORTED`
   * `ISSUE_TYPE_CHANGED`, and none for a code deleted once and made again
   * `ISSUE_TYPE_GENERATION_REQUIRED`. Then the issues: a mapping onto a status
   * the target's workflow lacks (400 `ISSUE_TYPE_STATUS_MAPPING_INVALID`),
   * more than 5000 (`WORKFLOW_MIGRATION_LIMIT`), and any left in a status the
   * target's workflow lacks (400 `FAILED_PRECONDITION` `ISSUE_STATUSES_UNMAPPED`,
   * `statusKeys` sorted, `targetStatusKeys` the target workflow's — no count).
   * Otherwise every live issue of the type takes the target and its mapped
   * status, with one `UPDATED` entry, and the type goes.
   */
  deleteProjectIssueType(projectId: string, code: string, input?: DeleteProjectIssueTypeInput, requestId?: string): void {
    if (!ISSUE_TYPE_CODE_PATTERN.test(code) || (input !== undefined && !isIssueTypeDeleteBody(input))) {
      throw new MockApiError("INVALID_ARGUMENT", INVALID_REQUEST_PARAMETERS_MESSAGE);
    }
    const replayed = this.replayCommand(requestId, { kind: "delete-type", projectId, code, input });
    if (replayed.done) return;
    const target = input?.moveIssuesTo;
    const mapping = input?.statusMappings ?? {};
    if (target !== undefined && target === code) {
      throw new MockApiError("INVALID_ARGUMENT", "Target must be a different registered project issue type", {
        reason: "ISSUE_TYPE_TARGET_INVALID",
      });
    }
    if (target === undefined && (Object.keys(mapping).length > 0 || input?.expectedGeneration !== undefined)) {
      throw new MockApiError("INVALID_ARGUMENT", "moveIssuesTo is required for mapping/generation");
    }
    this.requireIssueTypeAdmin(projectId);
    const entry = this.findIssueType(projectId, code);
    const registry = this.issueTypesByProject[projectId] ?? [];
    const live = this.issues.filter((item) => item.projectId === projectId && item.issueType === code && !item.deletedAt);
    if (target !== undefined) {
      const expected = input?.expectedGeneration;
      if (expected !== undefined ? expected !== entry.generation : this.retiredTypeCodes[projectId]?.has(code)) {
        throw new MockApiError(
          "ABORTED",
          expected !== undefined
            ? "Issue type lifecycle changed"
            : "This issue type code was recreated; supply expectedGeneration from the current registry",
          {
            reason: expected !== undefined ? "ISSUE_TYPE_CHANGED" : "ISSUE_TYPE_GENERATION_REQUIRED",
            generation: entry.generation ?? "",
          },
        );
      }
      if (!this.inRegistry(projectId, target)) {
        throw new MockApiError("INVALID_ARGUMENT", "Target issue type is not registered in this project", {
          reason: "ISSUE_TYPE_TARGET_INVALID",
        });
      }
    }
    if (registry.length <= 1) {
      throw new MockApiError("FAILED_PRECONDITION", LAST_ISSUE_TYPE_MESSAGE, { reason: LAST_ISSUE_TYPE_REASON });
    }
    if (target === undefined && live.length > 0) {
      throw new MockApiError("FAILED_PRECONDITION", issueTypeInUseMessage(code, live.length), {
        reason: ISSUE_TYPE_IN_USE_REASON,
        issueCount: String(live.length),
      });
    }
    if (target !== undefined) {
      const valid = statusesInSortOrder(this.workflowFor(projectId, target).statuses).map((status) => status.statusKey);
      const targetOf = (statusKey: string) => (Object.hasOwn(mapping, statusKey) ? mapping[statusKey] : statusKey);
      if (!Object.values(mapping).every((key) => valid.includes(key))) {
        throw new MockApiError("INVALID_ARGUMENT", "Mapped target status is outside the target workflow", {
          reason: "ISSUE_TYPE_STATUS_MAPPING_INVALID",
          targetStatusKeys: valid.join(","),
        });
      }
      if (live.length > WORKFLOW_MIGRATION_LIMIT) {
        throw new MockApiError("FAILED_PRECONDITION", "Synchronous issue type migration is limited to 5000 issues", {
          reason: "WORKFLOW_MIGRATION_LIMIT",
          limit: String(WORKFLOW_MIGRATION_LIMIT),
        });
      }
      const unmapped = [...new Set(live.map((issue) => issue.status))].filter((key) => !valid.includes(targetOf(key))).sort();
      if (unmapped.length) {
        throw new MockApiError("FAILED_PRECONDITION", "Supply mappings for source statuses absent from the target workflow", {
          reason: "ISSUE_STATUSES_UNMAPPED",
          statusKeys: unmapped.join(","),
          targetStatusKeys: valid.join(","),
        });
      }
      for (const issue of live) {
        const from = issue.status;
        Object.assign(issue, { issueType: target, status: targetOf(from), updatedAt: now(), version: issue.version + 1 });
        this.pushHistory(issue.id, "UPDATED", this.currentUserId, {
          field: "issue",
          oldStatusKey: from,
          newStatusKey: issue.status,
          reason: "ISSUE_TYPE_DELETED",
        });
      }
    }
    this.issueTypesByProject[projectId] = registry.filter((type) => type.code !== code);
    const bindings = this.workflowOverrides[projectId];
    if (bindings && Object.hasOwn(bindings, code)) delete bindings[code];
    (this.retiredTypeCodes[projectId] ??= new Set()).add(code);
    this.pendOnTrigger(entry.name, "ISSUE_TYPE_DELETION_PENDING", "Issue type deletion is durably pending; retry the same command", {
      kind: "delete-type",
      projectId,
      code,
      input,
    }, null);
  }

  /**
   * `PUT /projects/{projectId}/issue-types/order` (backend TAS-418) in the
   * server's order: the gateway's bean validation (`codes` missing, empty, or
   * with a value outside `IssueTypeDto`'s pattern: 400 "Invalid request
   * parameters"); a code named twice (400 `INVALID_ARGUMENT`, before the role
   * — the gateway keeps a list, not a set, so the service sees the repeat);
   * the project, the role, the archive; then a set that is not exactly the
   * registry's — a type added or deleted elsewhere since it was read — (409
   * `ABORTED`, `details.reason` `ISSUE_TYPES_CHANGED`, backend TAS-429), and
   * nothing is written. Otherwise every type is renumbered 10, 20, 30… in the
   * order given, and the answer is the whole registry in that order.
   *
   * `MOCK_PROJECT_TRIGGERS.issueTypesChangedMeanwhile` in a type's name makes
   * another admin add a type first, the stale case a reader alone cannot make.
   */
  reorderProjectIssueTypes(projectId: string, codes: unknown): ProjectIssueType[] {
    if (!Array.isArray(codes) || codes.length === 0 || !codes.every(isIssueTypeCode)) {
      throw new MockApiError("INVALID_ARGUMENT", INVALID_REQUEST_PARAMETERS_MESSAGE);
    }
    if (new Set(codes).size !== codes.length) {
      throw new MockApiError("INVALID_ARGUMENT", ISSUE_TYPE_ORDER_REPEATS_MESSAGE);
    }
    this.requireIssueTypeAdmin(projectId);
    this.addTypeMeanwhile(projectId);
    const registry = this.issueTypesByProject[projectId] ?? [];
    if (registry.length !== codes.length || !registry.every((type) => codes.includes(type.code))) {
      throw new MockApiError("ABORTED", ISSUE_TYPES_CHANGED_MESSAGE, { reason: ISSUE_TYPES_CHANGED_REASON });
    }
    codes.forEach((code, index) => {
      const entry = registry.find((type) => type.code === code);
      if (entry) entry.sortOrder = (index + 1) * 10;
    });
    return this.registryOf(projectId).map((type) => ({ ...type }));
  }

  /**
   * `MOCK_PROJECT_TRIGGERS.issueTypesChangedMeanwhile`, carried out: while a
   * type of the project carries the trigger in its name, another admin adds
   * «Added elsewhere» (`ADDED_ELSEWHERE`) last, once — as a create from their
   * own session would, a moment before the reader's move.
   */
  private addTypeMeanwhile(projectId: string): void {
    const registry = (this.issueTypesByProject[projectId] ??= []);
    if (!registry.some((type) => type.name.includes(MOCK_PROJECT_TRIGGERS.issueTypesChangedMeanwhile))) return;
    if (registry.some((type) => type.code === TYPE_ADDED_ELSEWHERE)) return;
    registry.push({
      code: TYPE_ADDED_ELSEWHERE,
      name: "Added elsewhere",
      color: "slate",
      shape: "square",
      icon: null,
      sortOrder: registry.reduce((largest, type) => Math.max(largest, type.sortOrder), 0) + 10,
    });
  }

  listIssueLabels(projectId: string, issueId: string): Label[] {
    const issue = this.findIssue(projectId, issueId);
    return this.labelsForIssue(issue.id);
  }

  addIssueLabel(projectId: string, issueId: string, labelId: string): void {
    const issue = this.findIssue(projectId, issueId);
    this.refuseArchivedWrite(projectId);
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
    this.refuseArchivedWrite(projectId);
    const attached = this.labelIdsByIssue[issue.id] ?? [];
    if (!attached.includes(labelId)) {
      throw new MockApiError("NOT_FOUND", "This issue does not carry that label");
    }
    this.labelIdsByIssue[issue.id] = attached.filter((id) => id !== labelId);
    this.pushHistory(issue.id, "UPDATED", this.currentUserId, { field: "labels" });
  }

  /**
   * `totalCount` is computed from this store's own rows, which is what makes it
   * the *server's* number here rather than a length the caller worked out — the
   * distinction the UI depends on. The route takes no paging parameter, so the
   * list is never short of the total and the two always agree; a client that
   * reads the field is right either way, and one that counts the array is right
   * only by luck.
   *
   * No role check, deliberately. The contract states none for this route, and
   * the read routes of this store are already the looser half of the pair
   * (see `membersByProject` in the constructor and docs/ai/API-DIVERGENCE.md).
   */
  listIssueWatchers(projectId: string, issueId: string): IssueWatchers {
    const issue = this.findIssue(projectId, issueId);
    const watchers = this.watchersNewestFirst(issue.id);
    return { watchers: watchers.map((item) => this.watcherView(item, false)), totalCount: watchers.length };
  }

  /**
   * One issue's subscriptions in the order both server routes answer with,
   * `ORDER BY created_at DESC` (`IssueWatcherRepository`, read at `60d62ee`),
   * which the contract states as `createdAt desc, id desc` since backend PR
   * #200. Equal timestamps keep the later subscription first here rather than
   * the larger id — an approximation only two subscriptions in one millisecond
   * could tell apart.
   */
  private watchersNewestFirst(issueId: string): StoredIssueWatcher[] {
    return this.watchers
      .filter((item) => item.issueId === issueId)
      .sort(byCreatedAt)
      .reverse();
  }

  /**
   * `PUT …/watchers/me`, for an ADMIN or a MEMBER only. The contract states no
   * role for the pair, and issue-service has one: `watch-issue-roles` is
   * `ADMIN,MEMBER`, checked against the reader's own role whenever they watch
   * or unwatch themselves (read at `develop` `1cfe4d7`, TAS-226). This store
   * used to let any reader do both, which is the claim the board's toggle was
   * built on.
   */
  watchIssue(projectId: string, issueId: string): WatchIssueResult {
    this.refuseArchivedWrite(projectId);
    this.requireWatchRole(projectId);
    return this.subscribe(projectId, issueId, this.currentUserId, this.currentUserId);
  }

  /**
   * `DELETE …/watchers/me`, under the same rule as the watch — so a VIEWER is
   * refused even with nothing to remove, and `removed: false` is only ever an
   * ADMIN's or a MEMBER's answer here.
   */
  unwatchIssue(projectId: string, issueId: string): UnwatchIssueResult {
    this.refuseArchivedWrite(projectId);
    this.requireWatchRole(projectId);
    return this.unsubscribe(projectId, issueId, this.currentUserId);
  }

  addIssueWatcher(projectId: string, issueId: string, userId: string): WatchIssueResult {
    this.refuseArchivedWrite(projectId);
    this.requireWatcherRoleFor(projectId, userId);
    // A user this deployment has never heard of is a 404, not a subscription to
    // a ghost. `getUser` is the store's own "does this person exist" check and
    // is what the assignee routes would use.
    this.getUser(userId);
    return this.subscribe(projectId, issueId, userId, this.currentUserId);
  }

  removeIssueWatcher(projectId: string, issueId: string, userId: string): UnwatchIssueResult {
    this.refuseArchivedWrite(projectId);
    this.requireWatcherRoleFor(projectId, userId);
    // No `getUser` here, on purpose, and it is not an oversight. The whole
    // point of `removed` is that unsubscribing somebody who is not subscribed
    // is a `200` rather than a failure, and refusing an unknown user would turn
    // one of those into a 404 — the flattening this route's flag exists to
    // prevent. A row for a deleted account is exactly the row an ADMIN needs to
    // be able to clear.
    return this.unsubscribe(projectId, issueId, userId);
  }

  /**
   * Idempotent, and that is read off the contract rather than assumed:
   * `WatchIssueResponseDto` carries the row and the count and **no flag saying
   * whether anything was created**, where its sibling `UnwatchIssueResponseDto`
   * carries `removed`. A route whose author wanted "already watching" to be
   * distinguishable would have given it the same field. So a second watch
   * returns the first one's row.
   */
  private subscribe(projectId: string, issueId: string, userId: string, actorId: string): WatchIssueResult {
    const issue = this.findIssue(projectId, issueId);
    const existing = this.watchers.find((item) => item.issueId === issue.id && item.userId === userId);
    const watcher: StoredIssueWatcher = existing ?? {
      id: makeId("watcher"),
      issueId: issue.id,
      projectId: issue.projectId,
      userId,
      createdAt: now(),
      createdBy: actorId,
    };
    if (!existing) this.watchers.push(watcher);
    return { watcher: this.watcherView(watcher, false), watchersCount: this.watcherCount(issue.id) };
  }

  /** `removed: false` is a success. See `UnwatchIssueResult`. */
  private unsubscribe(projectId: string, issueId: string, userId: string): UnwatchIssueResult {
    const issue = this.findIssue(projectId, issueId);
    const before = this.watchers.length;
    this.watchers = this.watchers.filter((item) => !(item.issueId === issue.id && item.userId === userId));
    return {
      issueId: issue.id,
      removed: this.watchers.length !== before,
      watchersCount: this.watcherCount(issue.id),
    };
  }

  private watcherCount(issueId: string): number {
    return this.watchers.filter((item) => item.issueId === issueId).length;
  }

  /**
   * The gate on `POST …/watchers` and `DELETE …/watchers/{userId}`, as
   * issue-service's `IssueWatcherServiceImpl.checkMutationRole` applies it —
   * backend PR #194 (TAS-228, head `a33ed5d`) states it in the contract: it
   * depends on whose subscription it is. For **somebody else's** `userId` the
   * actor needs `manage-watchers-roles` — ADMIN. For **their own** it is
   * `watch-issue-roles` — ADMIN or MEMBER — the same rule as the `…/watchers/me`
   * pair, so a MEMBER may subscribe or unsubscribe themselves through either
   * route, and a VIEWER through neither. Only the actor's role is checked,
   * never the subscriber's, so an ADMIN may subscribe a VIEWER.
   *
   * The admin sentence is this store's, not the gateway's — nothing in the
   * backend repository was read for it, unlike `requireUploadRole` below, whose
   * two sentences were. Named so a reader does not take it for a measurement.
   */
  private requireWatcherRoleFor(projectId: string, userId: string): void {
    if (userId === this.currentUserId) {
      this.requireWatchRole(projectId);
      return;
    }
    const { role } = this.getMembership(projectId);
    if (role !== "ADMIN") {
      throw new MockApiError(
        "PERMISSION_DENIED",
        "Only a project admin can change who else watches this issue",
      );
    }
  }

  /**
   * `watch-issue-roles: ADMIN,MEMBER`, the gate on the reader's own
   * `…/watchers/me` pair (TAS-226). The role is the reader's own, and
   * `getMembership` answers VIEWER for a non-member, so the stand-in on MOB is
   * refused here the way a real VIEWER is.
   *
   * **The sentence is this store's, like its neighbour's above**, and nothing
   * was read for it. Against the gateway the refusal comes from
   * `ProjectRoleChecker`, in one of its two sentences — `"Access denied"` for a
   * non-member, `"Not allowed role"` for a member holding the wrong role (see
   * `requireUploadRole`). Nor is the order the server's: it is checked first,
   * before the issue is looked up, as `requireWatcherRoleFor` is.
   */
  private requireWatchRole(projectId: string): void {
    const { role } = this.getMembership(projectId);
    if (role !== "ADMIN" && role !== "MEMBER") {
      throw new MockApiError("PERMISSION_DENIED", "You do not have permission to watch or unwatch this issue");
    }
  }

  listAttachments(projectId: string, issueId: string): IssueAttachment[] {
    const issue = this.findIssue(projectId, issueId);
    return this.attachmentsOf(issue.id).map((item) => this.attachmentView(item));
  }

  private attachmentsOf(issueId: string): StoredAttachment[] {
    return this.attachments.filter((item) => item.issueId === issueId && item.deletedAt === null).sort(byCreatedAt);
  }

  /**
   * Leg 1. Refuses exactly what `S3StorageClient.validateFileParams` refuses,
   * in the server's own words, then checks the upload role, then mints a
   * presigned-shaped URL on `storage.public-url`'s only checked-in value.
   *
   * **The file is judged before the role, and that is the server's order even
   * though the source reads the other way round.** `createUploadUrl` is
   * `checkUserHasRoleForIssue(...).then(storageClient.createPresignedUploadUrl(...))`,
   * and `Mono.then(Mono other)` evaluates its argument **at assembly** — while
   * the chain is still being built, before anything subscribes. `S3StorageClient`
   * calls `validateFileParams` synchronously at the top of
   * `createPresignedUploadUrl`, before it returns a `Mono` at all, so the
   * `DomainException` escapes into the enclosing `flatMap` in
   * `GrpcAttachmentService` and becomes the answer; the role check never
   * subscribes. Verified against backend `f53dca38`.
   *
   * So leg 1's real order is: field validation (the `Mono.zip` of
   * `GrpcRequestValidators` — 400), then the file (400), then the issue
   * (404, `findActiveIssueProjectId`), then the role (403,
   * `ProjectRoleChecker`). `RestTaskaApi.createAttachmentUploadUrl` already
   * refuses the file before it sends anything, so this ordering is what keeps
   * the two answering the same code to the same input rather than `rest`
   * saying `INVALID_ARGUMENT` where `mock` said `PERMISSION_DENIED`.
   *
   * **Leg 3 is genuinely the other way round** and `confirmAttachmentUpload`
   * below is right to check the role first: `confirmUpload` passes no
   * synchronously-validated argument to `.then`, so its role check does run
   * first. The two legs differ, and reading one off the other is the mistake
   * this comment used to make.
   *
   * The URL is built to look like what the deployed stand would hand back —
   * host, bucket, a UUID key and the AWS SigV4 query parameters, including
   * `X-Amz-SignedHeaders=content-type;host`, which is the visible trace of the
   * fact that leg 2 must resend the very same `Content-Type`. It points at a
   * host nothing here serves, and that is the honest shape: this leg does not
   * go through the gateway and no browser on the deployed site can reach it
   * either.
   */
  createAttachmentUploadUrl(
    projectId: string,
    issueId: string,
    input: CreateAttachmentUploadUrlInput,
  ): AttachmentUploadTicket {
    const refusal = attachmentRefusal(input);
    if (refusal) {
      // One code for all three, as the gateway answers this leg: an unusable
      // type is INVALID_ARGUMENT from issue-service, and the empty file and the
      // ceiling are INVALID_ARGUMENT from the gateway's own bean validation
      // (`minimum: 1`, `maximum: 2097152`), before issue-service is asked. This
      // store threw OUT_OF_RANGE for the ceiling until TAS-224, from a reading
      // of backend PR #147's older head `f53dca38`; the head moved to `deeedbf`
      // (2026-09-09) with the `maximum` and `RestErrorMapper`'s OUT_OF_RANGE row
      // before any gateway served this route, and the 2026-09-12 re-pin updated
      // the YAML half but missed the Java half. `MockApiError` carries no
      // status, so the code is the whole of what this side can express;
      // `refuseAttachment` in RestTaskaApi.ts carries the status and states the
      // chain. Leg 3's re-measure below is still OUT_OF_RANGE.
      throw new MockApiError("INVALID_ARGUMENT", refusal);
    }
    const issue = this.findIssue(projectId, issueId);
    this.refuseArchivedWrite(projectId);
    this.requireUploadRole(projectId);

    const objectKey = makeId("object");
    const signedAt = new Date();
    const behaviour = uploadBehaviourFor(input.fileName);
    const query = new URLSearchParams({
      "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
      "X-Amz-Credential": `minioadmin/${signedAt.toISOString().slice(0, 10).replace(/-/g, "")}/us-east-1/s3/aws4_request`,
      "X-Amz-Date": `${signedAt.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`,
      "X-Amz-Expires": String(Math.round(ATTACHMENT_PRESIGNED_TTL_MS / 1000)),
      "X-Amz-SignedHeaders": "content-type;host",
      "X-Amz-Signature": mockChecksum(new TextEncoder().encode(`${objectKey}:${input.contentType}`)),
    });
    const uploadUrl = `${ATTACHMENT_STORE_ORIGIN}/${ATTACHMENT_BUCKET}/${objectKey}?${query.toString()}`;

    this.uploadTickets.set(uploadUrl, {
      objectKey,
      issueId: issue.id,
      projectId,
      contentType: input.contentType,
      // A file whose name asks for it gets a ticket that expired a minute ago,
      // which is the only way anybody can see what a stale link looks like
      // without waiting a quarter of an hour.
      expiresAt: input.fileName.toLowerCase().includes(MOCK_ATTACHMENT_TRIGGERS.expiredTicket)
        ? Date.now() - 60_000
        : Date.now() + ATTACHMENT_PRESIGNED_TTL_MS,
      behaviour,
    });

    return { uploadUrl, objectKey };
  }

  /**
   * Leg 2 — the browser's own PUT, standing in for a server this app cannot
   * reach. Every refusal here is an `ObjectStoreError` rather than a
   * `MockApiError`, because the thing refusing is not the gateway and the panel
   * has to be able to tell.
   */
  putAttachmentBytes(uploadUrl: string, bytes: Uint8Array, contentType: string): void {
    // Before the lookup, and for the same reason `RestTaskaApi` checks before
    // its `fetch`: an unusable link is not a store that said no. Without this
    // the mock would answer 403 to a `""` the REST adapter refuses without
    // sending, and the two would stop being interchangeable on the one input
    // a malformed gateway response can actually produce.
    requireUsableUploadUrl(uploadUrl);
    const ticket = this.uploadTickets.get(uploadUrl);
    if (!ticket) {
      // A URL this store never signed. S3 answers 403 for an unparseable or
      // unknown signature, not 404 — the object is not the thing being denied.
      throw new ObjectStoreError("The file store answered 403.", OBJECT_STORE_REJECTED_CODE, 403);
    }
    if (ticket.behaviour === "storeUnreachable") {
      throw new ObjectStoreError(
        "The file store could not be reached: Failed to fetch",
        OBJECT_STORE_UNREACHABLE_CODE,
        null,
      );
    }
    if (ticket.behaviour === "storeRefused") {
      throw new ObjectStoreError("The file store answered 500.", OBJECT_STORE_REJECTED_CODE, 500);
    }
    if (Date.now() > ticket.expiresAt) {
      throw new ObjectStoreError("The file store answered 403.", OBJECT_STORE_REJECTED_CODE, 403);
    }
    // The signature covers `Content-Type`, so a value that differs by so much
    // as a charset is a signature mismatch and a 403. Reproduced because it is
    // the single easiest rule in this feature to break from the UI side, and
    // the only place it can ever be caught before production.
    if (ticket.contentType !== contentType) {
      throw new ObjectStoreError("The file store answered 403.", OBJECT_STORE_REJECTED_CODE, 403);
    }

    this.storeObjects.set(ticket.objectKey, {
      contentType,
      sizeBytes: bytes.length,
      checksum: mockChecksum(bytes),
      bytes: bytes.slice(),
    });
  }

  /**
   * Leg 3, in the server's own order: the caller has to hold the upload role,
   * the object has to exist, it is re-measured against the ceiling, and only
   * then is a row written. `confirmUpload` re-checks the role rather than
   * trusting leg 1 to have done it — a presigned URL is a bearer token for the
   * bucket and says nothing about who may add a row — and so does this.
   *
   * The insert is **unconditional**, exactly like
   * `AttachmentTransactionExecutor.saveAttachment` against a table with no
   * unique key on `object_key`. So confirming the same object twice produces
   * two rows here as well — deliberately, because that is the hazard the
   * "never retry a confirm" rule exists for, and a mock that quietly
   * de-duplicated would make the rule look like superstition.
   */
  confirmAttachmentUpload(
    projectId: string,
    issueId: string,
    input: ConfirmAttachmentUploadInput,
  ): IssueAttachment {
    const issue = this.findIssue(projectId, issueId);
    this.refuseArchivedWrite(projectId);
    this.requireUploadRole(projectId);
    const ticket = [...this.uploadTickets.values()].find((item) => item.objectKey === input.objectKey);
    if (ticket?.behaviour === "confirmFails") {
      // The object is in the bucket and stays there: nothing sweeps it, and the
      // delete route does not touch storage. This is the orphan.
      throw new MockApiError("UNAVAILABLE", "The attachment could not be recorded. Please try again.");
    }

    const stored = this.storeObjects.get(input.objectKey);
    if (!stored) {
      throw new MockApiError("NOT_FOUND", "Object not found in storage");
    }
    if (stored.sizeBytes > ATTACHMENT_MAX_SIZE_BYTES) {
      // The server deletes the oversized object before refusing, so the key
      // stops resolving for a second attempt too.
      this.storeObjects.delete(input.objectKey);
      throw new MockApiError("OUT_OF_RANGE", attachmentSizeRefusalMessage(stored.sizeBytes));
    }

    const attachment: StoredAttachment = {
      id: makeId("attachment"),
      issueId: issue.id,
      uploadedBy: this.currentUserId,
      objectKey: input.objectKey,
      fileName: input.fileName,
      // The stored row keeps the *request's* content type, not the object's:
      // `saveAttachment` is handed `contentType` from the confirm body and the
      // metadata only contributes size and checksum.
      contentType: input.contentType,
      sizeBytes: stored.sizeBytes,
      checksum: stored.checksum,
      createdAt: now(),
      deletedAt: null,
    };
    this.attachments.push(attachment);
    this.pushHistory(issue.id, "ATTACHMENT_UPLOADED", this.currentUserId, {
      attachmentId: attachment.id,
      issueId: issue.id,
      uploadedBy: attachment.uploadedBy,
      fileName: attachment.fileName,
      contentType: attachment.contentType,
      sizeBytes: attachment.sizeBytes,
      createdAt: attachment.createdAt,
    });
    return this.attachmentView(attachment);
  }

  getAttachmentDownloadUrl(projectId: string, issueId: string, attachmentId: string): AttachmentDownloadUrl {
    const attachment = this.findAttachment(projectId, issueId, attachmentId);
    const query = new URLSearchParams({
      "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
      "X-Amz-Expires": String(Math.round(ATTACHMENT_PRESIGNED_TTL_MS / 1000)),
      "X-Amz-SignedHeaders": "host",
      // Unique per call, like a real presign whose `X-Amz-Date` moves: two
      // links for one row are two tickets, never one overwritten by the other.
      "X-Amz-Signature": mockChecksum(new TextEncoder().encode(`${attachment.objectKey}:get:${makeId("sig")}`)),
      // No `response-content-disposition`, which this link used to carry: the
      // deployed store sets no `Content-Disposition` on the object (measured
      // 2026-10-11), so the link opens inline, and a mock link that claimed
      // otherwise would be a wrong claim about the server (TAS-253).
    });
    const downloadUrl = `${ATTACHMENT_STORE_ORIGIN}/${ATTACHMENT_BUCKET}/${attachment.objectKey}?${query.toString()}`;
    this.downloadTickets.set(downloadUrl, {
      objectKey: attachment.objectKey,
      fileName: attachment.fileName,
      contentType: attachment.contentType,
      expiresAt: Date.now() + ATTACHMENT_PRESIGNED_TTL_MS,
    });
    return { downloadUrl, checksum: attachment.checksum };
  }

  /**
   * The GET of a download link's bytes, standing in for the store the way
   * `putAttachmentBytes` does for the PUT — so the end-to-end suite never
   * fetches `127.0.0.1:9000`. Every refusal is an `ObjectStoreError`.
   *
   * An object this store holds comes back byte for byte as it was PUT. The
   * seeded rows have no object (see the attachment seed), so they come back as
   * a short, deterministic text body under the row's own content type — a
   * placeholder, said so in its own words, rather than a refusal no real store
   * would give for a row that exists.
   */
  getAttachmentBytes(downloadUrl: string): Blob {
    requireUsableDownloadUrl(downloadUrl);
    const ticket = this.downloadTickets.get(downloadUrl);
    if (!ticket) {
      throw new ObjectStoreError("The file store answered 403.", OBJECT_STORE_REJECTED_CODE, 403);
    }
    if (ticket.fileName.toLowerCase().includes(MOCK_ATTACHMENT_TRIGGERS.downloadBlocked)) {
      throw new ObjectStoreError(
        "The file store could not be reached: Failed to fetch",
        OBJECT_STORE_UNREACHABLE_CODE,
        null,
      );
    }
    if (Date.now() > ticket.expiresAt) {
      throw new ObjectStoreError("The file store answered 403.", OBJECT_STORE_REJECTED_CODE, 403);
    }
    const stored = this.storeObjects.get(ticket.objectKey);
    if (stored) {
      return new Blob([stored.bytes.slice()], { type: stored.contentType });
    }
    return new Blob([`Mock copy of ${ticket.fileName}: this seeded attachment has no bytes in the mock store.\n`], {
      type: ticket.contentType,
    });
  }

  /**
   * Soft delete: the split role rule the panel's per-row control is drawn from,
   * and a lookup that refuses nothing.
   *
   * `AttachmentServiceImpl.deleteAttachment` picks its allowed set by comparing
   * `uploadedBy` with the caller: `delete-own-attachment-roles` (ADMIN, MEMBER)
   * for your own file and `delete-attachment-roles` (ADMIN) for anybody else's.
   * A per-row control is only correct if the row it is drawn on would actually
   * accept it, and a mock that accepted everything could not tell a correct gate
   * from a missing one.
   *
   * **The lookup is lenient, and this method is the only place in the store
   * that is.** The server opens on `findByIdAndDeletedAtIsNull` with **no**
   * `switchIfEmpty`, so an attachment that is missing or already soft-deleted
   * skips both `flatMap`s — the role check included — and
   * `GrpcAttachmentService` closes with `.thenReturn(Empty)`, which the gateway
   * renders as 204. The contract documents a 404 there; the implementation does
   * not, and this reproduces the implementation. Reproduce **and** flag: the
   * entry in docs/ai/API-DIVERGENCE.md is the other half of this decision.
   *
   * The behaviour decided it rather than the doctrine. Against a stale list —
   * a second tab, or somebody else's delete — the server answers 204 and the
   * row correctly stays gone, while a mock answering 404 would roll the
   * optimistic removal back and make a file that *is* deleted reappear under an
   * error message. That is the worse of the two behaviours, not merely a
   * different one.
   *
   * **The leniency stops here, deliberately.** `getAttachmentDownloadUrl`
   * resolves through `findAttachment`, which mirrors the server's private
   * `findActiveAttachment` — and that one *does* carry
   * `switchIfEmpty(NOT_FOUND)`. So the download route genuinely 404s on a
   * deleted attachment, the mock is already right there, and pushing this
   * leniency down into `findAttachment` would break it.
   *
   * The object in the bucket is untouched, like the server's.
   */
  deleteAttachment(projectId: string, issueId: string, attachmentId: string): void {
    // Resolved by hand rather than through `findAttachment`, because every way
    // this can come up empty — no such issue, no such attachment, deleted
    // already — is a 204 on the server and none of them reaches the role check.
    const issue = this.issues.find(
      (item) => item.projectId === projectId && item.id === issueId && item.deletedAt === null,
    );
    const attachment = this.attachments.find(
      (item) => item.id === attachmentId && item.issueId === issue?.id && item.deletedAt === null,
    );
    if (!attachment) return;

    // The server looks the attachment up first — a missing one is the 204
    // above, with no check made, archived project or not — and only then the
    // active issue and `checkProjectWriteRole`: membership, then the archive,
    // then the role (backend PR #159, api-contract-guard on TAS-149). So the
    // archived refusal comes here, after the lookup and before the role.
    this.refuseArchivedWrite(projectId);
    const role = this.getMembership(projectId).role;
    const allowed = attachment.uploadedBy === this.currentUserId ? role === "ADMIN" || role === "MEMBER" : role === "ADMIN";
    if (!allowed) {
      throw new MockApiError("PERMISSION_DENIED", "You do not have permission to delete this attachment");
    }
    attachment.deletedAt = now();
    this.pushHistory(attachment.issueId, "ATTACHMENT_DELETED", this.currentUserId, {
      attachmentId: attachment.id,
      issueId: attachment.issueId,
      deletedBy: this.currentUserId,
      fileName: attachment.fileName,
      deletedAt: attachment.deletedAt,
    });
  }

  /**
   * Leg 1 of the avatar upload, in the order the request meets its checks —
   * which is **not** the attachment one's, where the file is judged first. The
   * gateway authenticates the request and bean-validates its body before the
   * avatar call leaves it, and auth-service then runs `verifyUserExists` and
   * only after that — inside a `Mono.defer` — `createPresignedUploadUrl`, whose
   * `S3StorageClient.validateFileParams` judges the file. So:
   *
   * - a `sizeBytes` over 2 MB is the gateway's 400 `INVALID_ARGUMENT`,
   *   "Invalid request parameters", before anything else — the schema's
   *   `maximum` is 2097152 since backend TAS-222, the same number auth-service
   *   enforces, so nothing over it gets further;
   * - then the caller has to exist, which `currentUser()` stands in for;
   * - then the type, `INVALID_ARGUMENT` in `validateFileParams`'s words.
   *
   * An empty file is bean-validated at the gateway too, with the same code as
   * the type arm; this throws `validateFileParams`'s sentence for it, as
   * `RestTaskaApi.refuseAvatar` does, which answers each of these files with
   * the same code. `OUT_OF_RANGE` is the confirm's alone now (leg 3).
   *
   * **There is no role to check here.** The route is scoped to `me`, so the
   * only questions the server can ask are whether the request carries a valid
   * session and whether its user exists.
   *
   * The key it mints is `avatars/{userId}/{uuid}` (`ProfileServiceImpl`,
   * backend PR #198): the caller's own folder, which is how the confirm tells
   * a key handed to this caller from anybody else's.
   */
  createAvatarUploadUrl(input: CreateAvatarUploadUrlInput): AvatarUploadTicket {
    if (input.sizeBytes > AVATAR_MAX_SIZE_BYTES) {
      throw new MockApiError("INVALID_ARGUMENT", AVATAR_GATEWAY_REFUSAL_MESSAGE);
    }
    const user = this.currentUser();
    // Only the type and the empty file can be left: the size was answered above.
    const refusal = avatarRefusal(input);
    if (refusal) throw new MockApiError("INVALID_ARGUMENT", refusal);

    // The server's spelling since backend PR #198: the caller's own folder and a
    // fresh UUID, which is what the confirm checks a key against.
    const objectKey = `avatars/${user.id}/${mockUuid()}`;
    const signedAt = new Date();
    const behaviour = uploadBehaviourFor(input.fileName);
    const query = new URLSearchParams({
      "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
      "X-Amz-Credential": `minioadmin/${signedAt.toISOString().slice(0, 10).replace(/-/g, "")}/us-east-1/s3/aws4_request`,
      "X-Amz-Date": `${signedAt.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`,
      "X-Amz-Expires": String(Math.round(AVATAR_PRESIGNED_TTL_MS / 1000)),
      "X-Amz-SignedHeaders": "content-type;host",
      "X-Amz-Signature": mockChecksum(new TextEncoder().encode(`${objectKey}:${input.contentType}`)),
    });
    const uploadUrl = `${AVATAR_MOCK_STORE_ORIGIN}/${AVATAR_BUCKET}/${objectKey}?${query.toString()}`;

    this.avatarTickets.set(uploadUrl, {
      objectKey,
      userId: user.id,
      contentType: input.contentType,
      // A file whose name asks for it gets a ticket that expired a minute ago,
      // which is the only way anybody can see what a stale link looks like
      // without waiting a quarter of an hour.
      expiresAt: input.fileName.toLowerCase().includes(MOCK_ATTACHMENT_TRIGGERS.expiredTicket)
        ? Date.now() - 60_000
        : Date.now() + AVATAR_PRESIGNED_TTL_MS,
      behaviour,
      objectLost: input.fileName.toLowerCase().includes(MOCK_ATTACHMENT_TRIGGERS.avatarObjectLost),
    });

    return { uploadUrl, objectKey, expiresIn: Math.round(AVATAR_PRESIGNED_TTL_MS / 1000) };
  }

  /**
   * Leg 2 — the browser's own PUT, standing in for a server this app cannot
   * reach. Every refusal is an `ObjectStoreError` rather than a `MockApiError`,
   * because the thing refusing is not the gateway and the caller has to be able
   * to tell.
   *
   * The bytes are kept, not just measured: `confirmAvatarUpload` turns them
   * into the `data:` URL that stands in for a presigned GET (see `MockAvatar`),
   * so what is drawn afterwards is the image that was actually sent.
   */
  putAvatarBytes(uploadUrl: string, bytes: Uint8Array, contentType: string): void {
    // Before the lookup, and for the same reason `RestTaskaApi` checks before
    // its `fetch`: an unusable link is not a store that said no.
    requireUsableUploadUrl(uploadUrl);
    const ticket = this.avatarTickets.get(uploadUrl);
    if (!ticket) {
      // A URL this store never signed — including a perfectly good *attachment*
      // link, which is exactly the crossing the two ticket maps exist to catch.
      // S3 answers 403 for an unparseable or unknown signature, not 404.
      throw new ObjectStoreError("The file store answered 403.", OBJECT_STORE_REJECTED_CODE, 403);
    }
    if (ticket.behaviour === "storeUnreachable") {
      throw new ObjectStoreError(
        "The file store could not be reached: Failed to fetch",
        OBJECT_STORE_UNREACHABLE_CODE,
        null,
      );
    }
    if (ticket.behaviour === "storeRefused") {
      throw new ObjectStoreError("The file store answered 500.", OBJECT_STORE_REJECTED_CODE, 500);
    }
    if (Date.now() > ticket.expiresAt) {
      throw new ObjectStoreError("The file store answered 403.", OBJECT_STORE_REJECTED_CODE, 403);
    }
    // The signature covers `Content-Type`, so a value that differs by so much
    // as a charset is a signature mismatch and a 403.
    if (ticket.contentType !== contentType) {
      throw new ObjectStoreError("The file store answered 403.", OBJECT_STORE_REJECTED_CODE, 403);
    }

    this.avatarObjects.set(ticket.objectKey, {
      contentType,
      sizeBytes: bytes.length,
      dataUrl: dataUrlFor(bytes, contentType),
    });
  }

  /**
   * Leg 3, in `ProfileServiceImpl.confirmAvatarUpload`'s order at backend
   * develop `398285cde074` (PR #198, TAS-221, deployed 2026-10-19):
   *
   * - **the key has to be the caller's** — minted for them by leg 1
   *   (`avatars/{userId}/{uuid}`, `avatarKeyMintedFor`), or exactly the key
   *   their saved row already holds, which is how a row from before PR #198
   *   (Sofia's seeded `seeded-avatar-sofia`) can still be confirmed. Any other
   *   key is `NOT_FOUND`, before anything is read or changed;
   * - the object has to exist — the same `NOT_FOUND` and the same sentence, so
   *   the answer never says whether a key is somebody else's or nobody's;
   * - it is re-measured against the ceiling, an object over it deleted and
   *   refused with `OUT_OF_RANGE`;
   * - **a key the saved row already holds changes nothing**: that row comes
   *   back as it is — same id, same name, a freshly signed link — and nothing
   *   is deleted. So a repeated confirm is safe, which it was not before PR
   *   #198, when the "previous" object deleted was the one being confirmed;
   * - otherwise the row is written — **replacing** whatever the user had
   *   before, because `user_id` is what identifies an avatar and there is only
   *   ever one — then the previous row's object is deleted, and the download
   *   link is presigned last.
   *
   * The profile menu still sends each key once: a failed confirm is retried by
   * choosing the file again, which mints a new key (`UserProfileMenu`).
   */
  confirmAvatarUpload(input: ConfirmAvatarUploadInput): UserAvatar {
    const user = this.currentUser();
    const saved = this.avatars.get(user.id);
    if (!avatarKeyMintedFor(user.id, input.objectKey) && saved?.objectKey !== input.objectKey) {
      throw new MockApiError("NOT_FOUND", AVATAR_KEY_NOT_FOUND_MESSAGE);
    }
    const ticket = [...this.avatarTickets.values()].find((item) => item.objectKey === input.objectKey);
    if (ticket?.behaviour === "confirmFails") {
      // The object stays in the bucket with no row pointing at it. Nothing
      // sweeps those — the same orphan an attachment confirm leaves.
      throw new MockApiError("UNAVAILABLE", "The avatar could not be recorded. Please try again.");
    }

    const stored = this.avatarObjects.get(input.objectKey);
    if (!stored) {
      throw new MockApiError("NOT_FOUND", AVATAR_KEY_NOT_FOUND_MESSAGE);
    }
    if (stored.sizeBytes > AVATAR_MAX_SIZE_BYTES) {
      // The server deletes the oversized object before refusing, so the key
      // stops resolving for a second attempt too.
      this.avatarObjects.delete(input.objectKey);
      throw new MockApiError("OUT_OF_RANGE", avatarSizeRefusalMessage(stored.sizeBytes));
    }

    if (saved?.objectKey === input.objectKey) {
      // `replaceAvatarInDb` hands the saved row back untouched and names no old
      // object to delete. The link is signed again on the server; here it is
      // the same `data:` URL, because the bytes are the same.
      return { ...saved, downloadUrl: stored.dataUrl };
    }

    const avatar: MockAvatar = {
      id: makeId("avatar"),
      userId: user.id,
      objectKey: input.objectKey,
      fileName: input.fileName,
      // The row keeps the *request's* content type, not the object's, exactly
      // as the attachment row does: the metadata only contributes the size.
      contentType: input.contentType,
      sizeBytes: stored.sizeBytes,
      createdAt: now(),
      downloadUrl: stored.dataUrl,
    };
    // Row first, old object second, presign last — the server's order.
    this.avatars.set(user.id, avatar);
    if (saved) this.avatarObjects.delete(saved.objectKey);
    if (ticket?.objectLost) {
      // `MOCK_ATTACHMENT_TRIGGERS.avatarObjectLost`: the answer below is what
      // the server sent, link and all, and *afterwards* storage loses the
      // object. Every later profile read then finds a row with nothing behind
      // it.
      this.avatarObjects.delete(avatar.objectKey);
    }
    return { ...avatar };
  }

  /**
   * Idempotent, in the contract's own words: 204 whether or not there was
   * anything to delete, so this returns the same nothing either way and the
   * caller cannot learn which it was.
   */
  deleteMyAvatar(): void {
    const user = this.currentUser();
    const avatar = this.avatars.get(user.id);
    if (!avatar) return;
    this.avatars.delete(user.id);
    // The bytes go too. A real delete "удаляет запись из БД и файл из
    // хранилища" — which is the one place this family differs from attachments,
    // where the object is deliberately left behind.
    this.avatarObjects.delete(avatar.objectKey);
  }

  /**
   * `GET /users/me` as the gateway answers it since backend PR #193 (TAS-223,
   * head `3bd33cac`, `UserServiceImpl.getMyInfo`): the profile plus the
   * reader's own avatar, read through auth-service's `GetUserProfile`, and
   * always a 200. Three answers:
   *
   * - a row with its object: `avatar` filled, `avatarUnavailable: false`;
   * - no row: `avatar: null`, `avatarUnavailable: false`;
   * - the profile read failed: `avatar: null`, `avatarUnavailable: true`. The
   *   gateway sets that on any gRPC error and logs it. The answer is a 200, so
   *   its request id is only in the `X-Request-Id` header, which
   *   `RestTaskaApi.request` does not read on a success — neither
   *   implementation hands the caller an id for it.
   *
   * The only failure this store can make is a row whose object is gone — the
   * `avatarObjectLost` trigger, standing in for storage losing it, since no
   * confirm can leave a row that way after backend PR #198 — which on the
   * server fails the presign's HEAD on every read until an upload replaces the
   * row or a removal deletes it. A transient failure (auth-service down, a
   * deadline) has no counterpart in one synchronous store.
   */
  currentUserProfile(): User {
    const user = this.currentUser();
    const avatar = this.avatars.get(user.id);
    const usable = avatar && this.avatarObjects.has(avatar.objectKey) ? avatar : null;
    return {
      ...user,
      avatarUrl: usable?.downloadUrl ?? null,
      avatarId: usable?.id ?? null,
      avatarUnavailable: avatar !== undefined && usable === null,
    };
  }

  /**
   * `GET …/worklogs`, as `WorklogServiceImpl.listIssueWorklog` does it at
   * backend PR #178's head: the issue first (404), then the role
   * (`list-worklog-roles: ADMIN,MEMBER,VIEWER`), then the rows by `work_date`
   * descending and `created_at` descending (merged, deployed 2026-10-12).
   */
  /**
   * `GET …/worklogs`, paged since backend TAS-421: `page` ≥ 0 and `pageSize`
   * 1–100 (20 when not sent) or "Invalid request parameters" before anything
   * else; newest first by `workDate`, `createdAt`, then `id`, all descending;
   * `totalCount` every live entry, `hasMore` whether any lies past this page.
   * Each row names its author — a former member too — or `null` for an id no
   * account holds.
   */
  listIssueWorklogs(projectId: string, issueId: string, params: ListWorklogsParams = {}): IssueWorklogPage {
    const page = params.page ?? 0;
    const pageSize = params.pageSize ?? 20;
    if (!Number.isInteger(page) || page < 0 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      throw new MockApiError("INVALID_ARGUMENT", "Invalid request parameters");
    }
    const issue = this.findIssue(projectId, issueId);
    this.requireWorklogRole(projectId, ["ADMIN", "MEMBER", "VIEWER"]);
    const all = this.worklogs
      .filter((item) => item.issueId === issue.id && item.deletedAt === null)
      .sort(
        (a, b) =>
          byText(b.workDate, a.workDate) || byText(b.createdAt, a.createdAt) || byText(b.id, a.id),
      );
    const items = all.slice(page * pageSize, page * pageSize + pageSize).map((item) => ({
      ...this.worklogView(item),
      author: this.users.some((user) => user.id === item.authorUserId) ? this.personSummary(item.authorUserId) : null,
    }));
    return {
      items,
      page,
      pageSize,
      totalCount: all.length,
      hasMore: page * pageSize + items.length < all.length,
    };
  }

  /**
   * `POST …/worklogs`: the body first — the gateway's bean validation
   * (`minimum: 1`, `maxLength: 2000`) and then the service's own checks — then
   * the issue (404), then `add-worklog-roles: ADMIN,MEMBER`. The write moves
   * the issue as `Issue.addWorklogMinutes` does: the remaining estimate down by
   * the minutes, never below 0 and only when there is one, and the version up.
   */
  addIssueWorklog(projectId: string, issueId: string, input: AddIssueWorklogInput): IssueWorklog {
    this.refuseWorklogMinutes(input.spentMinutes);
    if (typeof input.workDate !== "string" || !isDateOnly(input.workDate)) {
      throw new MockApiError("INVALID_ARGUMENT", "WorkDate must be not null");
    }
    this.refuseFutureWorkDate(input.workDate);
    if (typeof input.comment === "string" && input.comment.length > WORKLOG_COMMENT_MAX_LENGTH) {
      throw new MockApiError("INVALID_ARGUMENT", `comment: size must be between 0 and ${WORKLOG_COMMENT_MAX_LENGTH}`);
    }
    const issue = this.findIssue(projectId, issueId);
    this.refuseArchivedWrite(projectId);
    this.requireWorklogRole(projectId, ["ADMIN", "MEMBER"]);

    if (issue.remainingEstimateMinutes !== null) {
      issue.remainingEstimateMinutes = Math.max(0, issue.remainingEstimateMinutes - input.spentMinutes);
    }
    this.touchIssue(issue);
    const worklog = this.worklog(
      issue,
      this.currentUserId,
      input.spentMinutes,
      input.workDate,
      // The server trims the comment and stores a blank one as `null`.
      input.comment?.trim() || null,
      now(),
    );
    this.pushHistory(issue.id, "WORKLOG_ADDED", this.currentUserId, this.worklogPayload(worklog));
    return this.worklogView(worklog);
  }

  /**
   * `PUT …/worklogs/{worklogId}`, a partial update: the body (an empty one is
   * `400`), the issue, the worklog, that the worklog is this issue's (`404`
   * otherwise), then the role — `update-worklog-roles: ADMIN,MEMBER` for your
   * own entry, `manage-worklog-roles: ADMIN` for anybody else's. The gateway
   * enforces `maxLength: 2000` on this comment (`400 INVALID_ARGUMENT`).
   *
   * The issue's version goes up whatever changed; its remaining estimate moves
   * by the difference only when `spentMinutes` was sent
   * (`Issue.updateWorklogMinutes`).
   */
  updateIssueWorklog(projectId: string, issueId: string, worklogId: string, input: UpdateIssueWorklogInput): IssueWorklog {
    const spentMinutes = input.spentMinutes ?? null;
    const workDate = input.workDate ?? null;
    const comment = input.comment ?? null;
    if (spentMinutes === null && workDate === null && comment === null) {
      throw new MockApiError("INVALID_ARGUMENT", "No data provided for update");
    }
    if (spentMinutes !== null) this.refuseWorklogMinutes(spentMinutes);
    if (workDate !== null) {
      if (!isDateOnly(workDate)) throw new MockApiError("INVALID_ARGUMENT", "WorkDate is not a date");
      this.refuseFutureWorkDate(workDate);
    }
    if (typeof input.comment === "string" && input.comment.length > WORKLOG_COMMENT_MAX_LENGTH) {
      throw new MockApiError("INVALID_ARGUMENT", `comment: size must be between 0 and ${WORKLOG_COMMENT_MAX_LENGTH}`);
    }
    const issue = this.findIssue(projectId, issueId);
    const worklog = this.worklogOfIssue(issue, worklogId);
    this.refuseArchivedWrite(projectId);
    this.requireWorklogRole(projectId, worklog.authorUserId === this.currentUserId ? ["ADMIN", "MEMBER"] : ["ADMIN"]);

    if (spentMinutes !== null && issue.remainingEstimateMinutes !== null) {
      issue.remainingEstimateMinutes = Math.max(0, issue.remainingEstimateMinutes + (worklog.spentMinutes - spentMinutes));
    }
    this.touchIssue(issue);
    if (spentMinutes !== null) worklog.spentMinutes = spentMinutes;
    if (workDate !== null) worklog.workDate = workDate;
    // `Worklog.update`: the comment is trimmed and a blank one clears it to `null`.
    if (comment !== null) worklog.comment = comment.trim() || null;
    worklog.updatedAt = now();
    this.pushHistory(issue.id, "WORKLOG_UPDATED", this.currentUserId, this.worklogPayload(worklog));
    return this.worklogView(worklog);
  }

  /**
   * `DELETE …/worklogs/{worklogId}`: the worklog (404), that it is this
   * issue's (404), the role as for an update, then a soft delete that gives the
   * minutes back to the remaining estimate (`Issue.removeWorklogMinutes`) and
   * moves the version.
   */
  deleteIssueWorklog(projectId: string, issueId: string, worklogId: string): void {
    const worklog = this.worklogs.find((item) => item.id === worklogId && item.deletedAt === null);
    if (!worklog) throw new MockApiError("NOT_FOUND", `Worklog with id: ${worklogId} not found`);
    const issue = this.issues.find(
      (item) => item.projectId === projectId && item.id === issueId && item.deletedAt === null,
    );
    if (!issue || worklog.issueId !== issue.id) {
      throw new MockApiError("NOT_FOUND", "Issue doesnt belongs to worklog");
    }
    this.refuseArchivedWrite(projectId);
    this.requireWorklogRole(projectId, worklog.authorUserId === this.currentUserId ? ["ADMIN", "MEMBER"] : ["ADMIN"]);

    worklog.deletedAt = now();
    if (issue.remainingEstimateMinutes !== null) {
      issue.remainingEstimateMinutes += worklog.spentMinutes;
    }
    this.touchIssue(issue);
    this.pushHistory(issue.id, "WORKLOG_DELETED", this.currentUserId, {
      issueId: issue.id,
      worklogId: worklog.id,
      deletedAt: worklog.deletedAt,
      deletedBy: this.currentUserId,
    });
  }

  listComments(projectId: string, issueId: string, params: ListCommentsParams = {}): Page<IssueComment> {
    const issue = this.findIssue(projectId, issueId);
    const page = params.page ?? 0;
    const pageSize = params.pageSize ?? 20;
    // The gateway returns the newest comment first, so "load more" walks backwards in time.
    const comments = [...(this.commentsByIssue[issue.id] ?? [])].sort((a, b) => byCreatedAt(b, a));
    return {
      items: comments.slice(page * pageSize, page * pageSize + pageSize).map((item) => this.commentView(item, true)),
      page,
      pageSize,
      totalCount: comments.length,
    };
  }

  addComment(projectId: string, issueId: string, body: string): IssueComment {
    const issue = this.findIssue(projectId, issueId);
    // `MOCK_PROJECT_TRIGGERS.archivedMeanwhile`: somebody else archived it.
    const project = this.projects.find((item) => item.id === projectId);
    if (project && !project.archivedAt && body.toLowerCase().includes(MOCK_PROJECT_TRIGGERS.archivedMeanwhile)) {
      project.archivedAt = now();
      project.updatedAt = project.archivedAt;
    }
    this.refuseArchivedWrite(projectId);
    const comment = this.comment(issue, this.currentUserId, this.commentBody(body), now());
    this.pushHistory(issue.id, "COMMENT_CREATED", this.currentUserId, { commentId: comment.id });
    // `MOCK_PROJECT_TRIGGERS.changedMeanwhile`: somebody changes this issue
    // just before the reader's next transition of it.
    if (body.toLowerCase().includes(MOCK_PROJECT_TRIGGERS.changedMeanwhile)) this.changingMeanwhile.add(issue.id);
    return this.commentView(comment, false);
  }

  updateComment(projectId: string, issueId: string, commentId: string, body: string): IssueComment {
    const comment = this.findOwnComment(projectId, issueId, commentId);
    comment.body = this.commentBody(body);
    comment.updatedAt = now();
    comment.version += 1;
    this.pushHistory(comment.issueId, "COMMENT_UPDATED", this.currentUserId, { commentId: comment.id });
    return this.commentView(comment, false);
  }

  deleteComment(projectId: string, issueId: string, commentId: string): void {
    const comment = this.findOwnComment(projectId, issueId, commentId);
    this.commentsByIssue[comment.issueId] = (this.commentsByIssue[comment.issueId] ?? []).filter(
      (item) => item.id !== comment.id,
    );
    this.pushHistory(comment.issueId, "COMMENT_DELETED", this.currentUserId, { commentId: comment.id });
  }

  /**
   * `unreadCount` is counted over the whole inbox, before `unreadOnly`,
   * `offset` and `pageSize` narrow the page — which is what the gateway
   * states, and what a count of `items` would get wrong on any inbox longer
   * than one page.
   *
   * The inbox is not per user here: whoever is signed in reads the one seeded
   * list, which is what lets a GLOBAL_ADMIN reach it on `/admin` without a seed
   * of his own.
   */
  /**
   * The owner's inbox row for a token created or revoked (backend TAS-402,
   * notification-service `NotificationMapper`): about no project and no
   * issue, in the server's words, naming the token by its prefix only.
   */
  notifyAccessToken(event: "created" | "revoked", tokenPrefix: string): void {
    const created = event === "created";
    this.notifications.unshift(
      this.notification(
        created ? "PERSONAL_ACCESS_TOKEN_CREATED" : "PERSONAL_ACCESS_TOKEN_REVOKED",
        created ? "Personal access token created" : "Personal access token revoked",
        `Personal access token ${tokenPrefix}... was ${created ? "created." : "revoked."}`,
        null,
        now(),
        null,
      ),
    );
  }

  listNotifications(params: ListNotificationsParams = {}): NotificationPage {
    const offset = params.offset ?? 0;
    const pageSize = params.pageSize ?? 20;
    const notifications = [...this.notifications]
      .filter((notification) => !params.unreadOnly || !notification.readAt)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return {
      items: notifications.slice(offset, offset + pageSize),
      pageSize,
      offset,
      unreadCount: this.notifications.filter((notification) => !notification.readAt).length,
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

  /** How many this call changed, so a repeat answers 0 — the gateway's route is idempotent in the same words. */
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
   * The seed covers what the screen branches on where the stand does:
   * `auth.users` has a `uuid` primary key (its rows open a card) and a column of
   * every class. Every key here is a `uuid` because every table on the stand is
   * keyed by one (read at backend develop `398285cde074`); the console's other
   * branch — a key the gateway's `UUID` path parameter cannot take, whose rows
   * are not linked — has no real table to stand on, and is pinned against a
   * made-up one in src/screens/admin/AdminScreen.test.tsx instead.
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
            outboxTable(),
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
            outboxTable(),
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
            outboxTable(),
          ],
        },
        {
          name: "admin",
          databaseAlias: "taska_admin",
          tables: [
            {
              // admin-service's one table, `taska.admin_audit_log`
              // (`0001-admin-audit-log.sql`), in its column order and with no
              // column marked sensitive — the catalog's `admin` entry names
              // none. Its rows are the Audit section's seed, so the two views
              // of the log agree: the same ids, and each document's keys in
              // jsonb's one order, spaced as each route spaces them (see
              // `jsonbCompact` and the rows in `adminRowsFor`).
              //
              // The actor's two columns as changeset
              // `0003-audit-actor-identity` (backend PR #219, TAS-388) leaves
              // them, read at its merge: `actor_login` renamed in place to
              // `actor_display_name` and retyped `text`, so it keeps the
              // fourth position, and `actor_email varchar(320)` added — which
              // puts it last, after `created_at`.
              name: "admin_audit_log",
              primaryKey: "id",
              columns: [
                { name: "id", type: "uuid", sensitive: false },
                { name: "request_id", type: "text", sensitive: false },
                { name: "actor_user_id", type: "uuid", sensitive: false },
                { name: "actor_display_name", type: "text", sensitive: false },
                { name: "actor_roles", type: "jsonb", sensitive: false },
                { name: "action", type: "text", sensitive: false },
                { name: "target_service", type: "text", sensitive: false },
                { name: "target_table", type: "text", sensitive: false },
                { name: "target_id", type: "text", sensitive: false },
                { name: "old_value", type: "jsonb", sensitive: false },
                { name: "new_value", type: "jsonb", sensitive: false },
                { name: "reason", type: "text", sensitive: false },
                { name: "created_at", type: "timestamp with time zone", sensitive: false },
                { name: "actor_email", type: "character varying", sensitive: false },
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

    // Validated before a row is filtered, as the gateway validates the whole
    // query before it builds the SQL — in its passes, not filter by filter.
    // An empty value is no filter at all: `RestTaskaApi` never sends one.
    refuseAdminFilters(
      (query.filters ?? [])
        .filter((filter) => filter.value !== "")
        .map((filter) => ({ ...filter, columnClass: classifyColumnType(typeOf(filter.column)) })),
    );

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
   * gateway refuses it: the path parameter is typed `UUID`, so a hand-typed
   * `/admin/data/admin/admin_audit_log/audit-001` is a 400 there whatever the
   * table. Serving a card the gateway never could made the mock the more
   * permissive of the two, which is the direction that hides bugs — the
   * console never links such a key, and a hand-typed address has to hit the
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
      // Not NOT_FOUND, and the wording is not ours. The gateway resolves the
      // service key before it looks for anything, and a key it does not know is
      // a rejected *argument* rather than a missing resource: measured
      // 2026-08-25, `400 INVALID_ARGUMENT` with exactly this sentence. The mock
      // is the reference implementation, so it answers what the gateway answers.
      //
      // Until TAS-194 the Events section read one instance of this sentence —
      // `Unknown service: outbox` — as "the problems summary has not deployed
      // yet", because a gateway without that path routed it here. That gateway
      // is gone and the branch with it; this refusal is now only ever about a
      // service key nobody has.
      throw new MockApiError("INVALID_ARGUMENT", `Unknown service: ${serviceName}`);
    }
    const table = service.tables.find((item) => item.name === tableName);
    if (!table) {
      // A different refusal from the one above, and deliberately so. The
      // service key is resolved first and a key the gateway does not know is a
      // rejected argument; a table is a later question, permitted or denied by
      // the gateway's own config, so a table it will not serve comes back as
      // PERMISSION_DENIED. Both are unreachable from the console, which only
      // offers catalog tables — but the mock is the reference implementation,
      // and the two answers are not interchangeable: `AdminError` sorts a
      // refusal ("not this account, or not this table") from a rejected request
      // ("read and refused, here is what to change") into different sentences.
      throw new MockApiError("PERMISSION_DENIED", `Table ${serviceName}.${tableName} is not served`);
    }
    return table;
  }

  /**
   * `POST /admin/users/{userId}/block` (TAS-186).
   *
   * Every refusal below is the backend's own, read out of
   * `AdminUserManagementServiceImpl` on the TAS-107 branch and reproduced word
   * for word — the mock is the reference implementation, and a mock that were
   * the more permissive of the two would teach a screen the gateway cannot
   * serve.
   *
   * The last-active-admin rule is the reason nothing about this operation is
   * optimistic (DESIGN.md §5.8): it is a count across the whole table, and no
   * client holds it.
   */
  blockUser(userId: string, reason: string): UserStatusChange {
    const user = this.adminUser(userId, reason);
    if (user.status !== "ACTIVE" && user.status !== "INVITED") {
      // ABORTED, not FAILED_PRECONDITION, and the difference is the gateway's
      // rather than a taste: `DomainStatus.ABORTED` is what auth-service raises
      // for this one, and `RestErrorMapper` turns it into a 409 carrying the
      // literal string "ABORTED". The refusal below is the other code and the
      // other status. Emitting one code for both would make the mock the only
      // place the two look alike.
      throw new MockApiError("ABORTED", `Cannot block user with current status: ${user.status}`);
    }
    if (user.globalRole === "GLOBAL_ADMIN" && user.status === "ACTIVE" && this.activeGlobalAdmins() <= 1) {
      // FAILED_PRECONDITION, which the gateway maps to **400** rather than 409.
      // The section reads this refusal by its code, not by its status, and this
      // line is why (`isConflict`, src/api/errors.ts).
      throw new MockApiError("FAILED_PRECONDITION", "Cannot block the last active global admin");
    }
    return this.changeUserStatus(user, "BLOCKED");
  }

  /**
   * `POST /admin/users/{userId}/unblock`. Legal from `BLOCKED` and from
   * nothing else, and it always lands on `ACTIVE`.
   *
   * An `INVITED` account that was blocked therefore comes back **active**, not
   * invited: the backend does not restore the invite state, and the section
   * says so in the confirmation rather than pretending otherwise here.
   */
  unblockUser(userId: string, reason: string): UserStatusChange {
    const user = this.adminUser(userId, reason);
    if (user.status !== "BLOCKED") {
      // ABORTED for the same reason as in `blockUser` above.
      throw new MockApiError("ABORTED", `Cannot unblock user with current status: ${user.status}`);
    }
    return this.changeUserStatus(user, "ACTIVE");
  }

  /**
   * `POST /admin/users/{userId}/reset-lockout` (TAS-188), read out of
   * `AdminUserManagementServiceImpl.resetCredentialLockout` at the head of
   * backend PR #146.
   *
   * `LOCKED` is not an administrative state — an account arrives there by
   * failing to sign in `maxFailedAttempts` times, and leaves on its next
   * success — and this is the only *write* that leaves it. Legal
   * from `LOCKED` and from nothing else, and it always
   * lands on `ACTIVE`, which is why the confirmation can state the transition
   * before asking for it.
   *
   * The refusal is `FAILED_PRECONDITION`, which the gateway maps to **400** —
   * the shape `blockUser`'s last-admin guard wears, not the 409 of its
   * transition guard. Reproduced with the server's own sentence, because the
   * dialog prints it.
   *
   * What the server clears — `failedAttempts`, `lockedUntil`, `lastFailedAt` —
   * has no representation in this store, and inventing one would be modelling
   * state no client can read: `UserCredentialStateResponseDto` never reaches
   * REST. The status is the whole of what a client can see change.
   */
  resetCredentialLockout(userId: string, reason: string): UserStatusChange {
    const user = this.adminUser(userId, reason);
    if (user.status !== "LOCKED") {
      throw new MockApiError("FAILED_PRECONDITION", "User is not in LOCKED status");
    }
    return this.changeUserStatus(user, "ACTIVE");
  }

  /**
   * Everything all three writes check before they look at the transition.
   *
   * The body first, so a blank reason on an account nobody has is a `400` and
   * not a `404`. Then the path parameter, which is typed `UUID` and refused
   * before auth-service ever sees it, exactly as `adminRow` refuses a non-uuid
   * row id. Then the account itself.
   *
   * Not "because Spring validates `@Valid @RequestBody` before the controller
   * method runs", which is what this said until TAS-194 and is not what the
   * gateway does. `AdminUserManagementController` takes each body as a
   * `Mono<…RequestDto>` and passes it into
   * `executor.execute(exchange, GLOBAL_ADMIN_REQUIRED, …)`, so the body is
   * subscribed *after* the admin check, while `UUID userId` is bound before the
   * method runs at all. On the wire the path is therefore the first thing
   * refused and the only one refused without a token — measured on the retry
   * route, whose controller has the same shape (see `retryOutboxEvent`).
   *
   * What is reproduced here is the half that is about this endpoint's own
   * checks: the reason before the lookup. The mock has no auth leg to order
   * against, so the id and the reason are in the order the checks read best.
   *
   * None of the three is reachable from the section, which sends a key it read
   * out of the table and a reason the field would not let be blank. They are
   * here because the mock is the reference implementation: a hand-made call has
   * to hit the same wall in both modes.
   */
  private adminUser(userId: string, reason: string): StoredUser {
    requireAdminWriteReason(reason);
    if (!UUID_PATTERN.test(userId)) {
      throw new MockApiError("INVALID_ARGUMENT", `User id ${userId} is not a UUID`);
    }
    return this.getUser(userId);
  }

  /** How many accounts can administer this instance right now. */
  private activeGlobalAdmins(): number {
    return this.users.filter((user) => user.globalRole === "GLOBAL_ADMIN" && user.status === "ACTIVE").length;
  }

  /**
   * The write itself, and the response it produces. `changedAt` is a real
   * instant here and on the gateway too, where it is the changed row's own
   * `updated_at` (see `UserStatusChange`); nothing draws either, because the
   * section refetches the list and reads the timestamp there.
   */
  private changeUserStatus(user: StoredUser, currentStatus: UserStatus): UserStatusChange {
    const previousStatus = user.status;
    user.status = currentStatus;
    return { userId: user.id, previousStatus, currentStatus, changedAt: now() };
  }

  /**
   * The problems summary (`GET /readonly/outbox/problematic-summary`), derived
   * from the same rows the Outbox journal reads — so the two views of the
   * Events section can never contradict each other, which is the whole reason
   * the mock computes this rather than seeding a second, independent answer.
   *
   * In the vendored contract and on the deployed gateway since backend PR #141
   * (TAS-105) merged 2026-08-27 — this comment said the opposite until TAS-194,
   * and the mock is not a stand-in for a missing route any more. What it is is
   * the reference implementation: the same answer, from seeded rows, so the
   * section can be clicked through without a gateway.
   */
  problematicOutboxSummary(): ProblematicOutboxSummary {
    const nowMs = Date.now();
    const events: ProblematicOutboxEvent[] = [];
    const counts: ProblematicOutboxCounts[] = [];

    for (const serviceKey of this.outboxServiceKeys()) {
      const count: ProblematicOutboxCounts = {
        serviceKey,
        overdueNewCount: 0,
        stuckProcessingCount: 0,
        failedCount: 0,
      };
      for (const row of this.outboxRowsFor(serviceKey)) {
        const problem = outboxProblem(row, nowMs);
        if (!problem) continue;
        if (problem === "FAILED") count.failedCount += 1;
        if (problem === "PROCESSING") count.stuckProcessingCount += 1;
        if (problem === "NEW") count.overdueNewCount += 1;
        events.push({
          id: String(row.id),
          aggregateType: String(row.aggregate_type),
          aggregateId: String(row.aggregate_id),
          eventType: String(row.event_type),
          payload: String(row.payload),
          status: String(row.status),
          createdAt: String(row.created_at),
          publishedAt: (row.published_at as string | null) ?? null,
          attempts: Number(row.attempts),
          lastErrorMessage: (row.last_error_message as string | null) ?? null,
          processingStartedAt: (row.processing_started_at as string | null) ?? null,
          requestId: (row.request_id as string | null) ?? null,
          serviceKey,
          reason: OUTBOX_REASONS[problem],
          // A snapshot, as on the server: `retryOutboxEvent` checks again.
          retryable: isOutboxRetryable(row, nowMs),
        });
      }
      // Every service, counted in full, whether or not any of its rows made the
      // list: the counts are the answer to "where is it broken" and the list is
      // only the head of it.
      counts.push(count);
    }

    // Oldest first — the list exists to say when this started — and cut to the
    // server's limit afterwards, so the counts above still cover what was cut.
    events.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    return {
      events: events.slice(0, OUTBOX_SUMMARY_LIMIT),
      counts,
      notAllShown: events.length > OUTBOX_SUMMARY_LIMIT,
    };
  }

  /**
   * `GET /readonly/audit-entries` as the merged backend PR #197 answers it
   * (TAS-160, deployed 2026-10-19) — see `TaskaApi.listAuditEntries` — in the
   * order the request meets each check:
   *
   * - a date in any spelling but `yyyy-MM-dd`, an `actorUserId` that is not a
   *   UUID, a `pageSize` outside 1–100, a page past `int32` and a page or size
   *   that is not a whole number are refused by the gateway's parameter
   *   validation before anything else, the role included: `INVALID_ARGUMENT`
   *   (400), "Invalid request parameters" — probed tokenless for `pageSize` and
   *   `page` on 2026-10-19, see `TaskaApi.listAuditEntries`;
   * - then `GLOBAL_ADMIN` only, `PERMISSION_DENIED` (403), "User doesn't have
   *   permission";
   * - then a `from` after `to`, admin-service's `INVALID_ARGUMENT` (400) in its
   *   own words;
   * - every other filter an exact match, a blank one no filter; dates are whole
   *   UTC days, both inclusive;
   * - newest first, `id` descending among equal instants, paged. A `page`
   *   below 1 here is the first page, because that is what the rest leg makes
   *   of it — it sends `max(0, page - 1)`, so the wire's `minimum: 0` is never
   *   reached from this interface and neither implementation can refuse it.
   */
  listAuditEntries(query: AuditEntriesQuery): AuditEntries {
    const given = (value: string | undefined) => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : undefined;
    };
    const from = given(query.createdAtFrom);
    const to = given(query.createdAtTo);
    const actorUserId = given(query.actorUserId);
    const pageSize = query.pageSize ?? 20;
    const requestedPage = query.page ?? 1;
    if (
      (from !== undefined && !isAuditDate(from)) ||
      (to !== undefined && !isAuditDate(to)) ||
      (actorUserId !== undefined && !UUID_PATTERN.test(actorUserId)) ||
      // `minimum: 1`, `maximum: 100`, `format: int32` — the gateway validates
      // the parameter as the contract declares it, and admin-service's own
      // fallback and clamp are never reached through it.
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100 ||
      !Number.isInteger(requestedPage) ||
      // `page` is `format: int32` on the wire, where it is this page less one:
      // probed 2026-10-19, `page=2147483647` reaches sign-in (401,
      // `36256d82-dcb4-40e3-b861-38be1f590e3e`) and `page=2147483648` does not
      // bind (400, `7f84f3a1-aa67-4c52-b970-a2947433bfe9`).
      requestedPage - 1 > INT32_MAX
    ) {
      throw new MockApiError("INVALID_ARGUMENT", "Invalid request parameters");
    }
    if (this.currentUser().globalRole !== "GLOBAL_ADMIN") {
      throw new MockApiError("PERMISSION_DENIED", "User doesn't have permission");
    }
    if (from !== undefined && to !== undefined && from > to) {
      throw new MockApiError("INVALID_ARGUMENT", "body.createdAtFrom cannot be later than body.createdAtTo");
    }
    const exact = {
      actorUserId,
      action: given(query.action),
      targetService: given(query.targetService),
      targetTable: given(query.targetTable),
      targetId: given(query.targetId),
      requestId: given(query.requestId),
    };
    const matching = this.auditEntries
      .filter((entry) =>
        (Object.keys(exact) as (keyof typeof exact)[]).every(
          (key) => exact[key] === undefined || entry[key] === exact[key],
        ),
      )
      .filter((entry) => {
        // Whole UTC days: the instant's own date, compared as text, which is
        // exact for `yyyy-MM-dd` and needs no clock.
        const day = entry.createdAt?.slice(0, 10) ?? "";
        return (from === undefined || day >= from) && (to === undefined || day <= to);
      })
      // `created_at DESC, id DESC` (`AdminRepositoryCustomImpl.findByFilter`).
      // Ids are lowercase UUIDs, so comparing them as text is the database's
      // byte order.
      .sort(
        (a, b) =>
          Date.parse(b.createdAt ?? "") - Date.parse(a.createdAt ?? "") ||
          ((b.id ?? "") < (a.id ?? "") ? -1 : (b.id ?? "") > (a.id ?? "") ? 1 : 0),
      );

    const currentPage = requestedPage < 1 ? 1 : requestedPage;
    const totalRows = matching.length;
    const totalPages = Math.ceil(totalRows / pageSize);
    const start = (currentPage - 1) * pageSize;
    return {
      entries: matching.slice(start, start + pageSize).map((entry) => ({ ...entry })),
      pagination: {
        currentPage,
        pageSize,
        totalRows,
        totalPages,
        hasNext: currentPage < totalPages,
        hasPrev: currentPage > 1,
      },
    };
  }

  /**
   * `POST /admin/outbox/{service}/{eventId}/retry`, checked and applied the way
   * admin-service checks and applies it (`OutboxRetryServiceImpl` and
   * `OutboxRetryRepositoryImpl`, backend `develop` 2026-09-08).
   *
   * The reason before the event, so a blank reason against an event nobody has
   * is a `400` and not a `404`. Then the id, typed `UUID` in the path and
   * refused before admin-service sees it. Then the event, then eligibility.
   *
   * The gateway's own order is read off
   * `AdminReadOnlyController.retryOutboxEvent` (backend `develop`): `eventId`
   * is a `UUID` argument bound before the method body runs, while the request
   * is a `Mono<RetryOutboxEventRequestDto>` subscribed *inside*
   * `executor.execute(exchange, GLOBAL_ADMIN_REQUIRED, …)`. So the path is
   * refused first, before authentication, and the body only after the admin
   * check — probed on the deployed gateway with no token 2026-09-08: a
   * malformed uuid answers `400 "Invalid request parameters"`, a blank reason
   * answers `401`. It is *not* "the body before the path because Spring
   * validates `@Valid @RequestBody` first", which is what this comment claimed
   * and which describes a blocking controller this route does not have.
   *
   * The two orders differ only for a call malformed in both ways at once, which
   * this section cannot make: it sends an id read out of the table and a reason
   * the field would not let be blank.
   *
   * What the update does, field for field:
   *
   * - `status` → `NEW`;
   * - `last_error_message` → `null`;
   * - `processing_started_at` → `null`;
   * - **`attempts` untouched.** It is not in the backend's `UPDATE`, so the
   *   count carries over and the response reports the number the row already
   *   had. A mock that reset it here would teach the one thing about this
   *   endpoint an operator is most likely to assume and be wrong about.
   *
   * Eligibility is `FAILED`, or `PROCESSING` stuck longer than
   * `OUTBOX_RETRY_STUCK_MINUTES` — which is *not* the threshold the summary uses
   * to call a row stuck, on the backend or here. Everything else is
   * `FAILED_PRECONDITION` in the server's own words, including the `NEW` rows
   * this section's own list is full of.
   */
  retryOutboxEvent(service: string, eventId: string, reason: string): OutboxRetryResult {
    requireOutboxRetryReason(reason);
    if (!UUID_PATTERN.test(eventId)) {
      throw new MockApiError("INVALID_ARGUMENT", `Outbox event id ${eventId} is not a UUID`);
    }
    // The gateway's path enum refuses an unknown service before this, and
    // admin-service refuses it again from its own map of write datasources. The
    // mock speaks the second one's sentence: it is the one a hand-made call to a
    // service that has no outbox would actually meet.
    if (!this.outboxServiceKeys().includes(service)) {
      throw new MockApiError("INVALID_ARGUMENT", `Unsupported outbox service: ${service}`);
    }
    const row = this.outboxRowsFor(service).find((candidate) => String(candidate.id) === eventId);
    if (!row) {
      throw new MockApiError("NOT_FOUND", `Outbox event not found: ${eventId}`);
    }

    // The summary's `retryable` is a snapshot; the row may have moved on since
    // it was read, so the rule is applied again here, as admin-service does.
    if (!isOutboxRetryable(row, Date.now())) {
      throw new MockApiError(
        "FAILED_PRECONDITION",
        `Outbox event with status ${String(row.status)} is not eligible for retry`,
      );
    }

    row.status = "NEW";
    row.last_error_message = null;
    row.processing_started_at = null;
    // Read back out of the row, like the backend's second `findById`, rather
    // than assembled from what was just written: the response is a statement
    // about the row's state, and the two are the same only while nothing else
    // touches it.
    return { eventId, status: String(row.status), attempts: Number(row.attempts) };
  }

  private outboxRowsFor(service: string): AdminRow[] {
    this.outboxEvents ??= this.seedOutboxEvents();
    return this.outboxEvents[service] ?? [];
  }

  /**
   * Which services have an outbox — read back out of the catalog rather than
   * listed a second time. The three `outboxTable()` calls up there are the
   * statement; a parallel array beside them would be a second thing to keep
   * true, and the day they disagreed the summary would count a service whose
   * rows nothing seeds (or miss one it does).
   *
   * Its order is also the id slot, so no two outbox rows can share a key.
   */
  private outboxServiceKeys(): string[] {
    return this.adminCatalog()
      .services.filter((service) => service.tables.some((table) => table.name === OUTBOX_TABLE))
      .map((service) => service.name);
  }

  /**
   * Three services' worth of outbox rows: mostly published traffic, plus the
   * three shapes the Events section exists to show — a NEW row the scheduler
   * never picked up, a PROCESSING row past the timeout, and a FAILED row with
   * its attempts exhausted and the kind of error string a broker actually
   * writes.
   *
   * Two of the recent rows are deliberately *not* problematic: a NEW and a
   * PROCESSING row a couple of minutes old. Without them nothing here would
   * prove the summary applies a threshold rather than counting states.
   *
   * One row sits in the gap between the summary's threshold and the retry
   * route's — listed as stuck, `retryable: false`, refused by retry. See
   * `project`'s `project.member_added` PROCESSING seed; it is what shows that
   * the section follows the server's `retryable` rather than the status.
   *
   * Two of `project`'s rows are the *same* event type in the same state for the
   * same reason, which is the last of its seeds and the one shape a summary of
   * an incident always has. A row is not identified by its type and service,
   * and until TAS-194 nothing here could show that.
   *
   * Every payload here is a JSON document, which is all a `jsonb` column can
   * hold — including one whose values arrive masked, because admin-service
   * masks *inside* the document and the result is still JSON.
   *
   * This seed used to carry one payload that was not JSON at all, an
   * `JsonByteArrayInput{…}` string modelling admin-service's `value.toString()`
   * fall-through for `jsonb`. Backend PR #141 (TAS-105) replaced that with an
   * `instanceof Json → asString()` branch, and the probe
   * docs/ai/API-DIVERGENCE.md required before closing the entry was taken on
   * 2026-09-08: `GET /api/v1/readonly/issue/outbox_events` returned 20 rows and
   * every `payload` was clean JSON, with no `JsonByteArrayInput` anywhere in the
   * response. TAS-194 dropped the seed there, because a mock that keeps sending
   * it teaches a wire format the gateway can no longer produce. The card's rule
   * — parse as JSON and lay it out, anything else print verbatim — is untouched
   * and is not a compensation; it is TAS-167's instruction to escalate rather
   * than repair, and its verbatim branch is tested directly in
   * src/screens/admin/columns.test.ts.
   */
  private seedOutboxEvents(): Record<string, AdminRow[]> {
    const base = Date.now();
    const at = (minutesAgo: number) => {
      const moment = new Date(base - minutesAgo * 60_000);
      moment.setUTCSeconds(0, 0);
      // The wire's own spelling in this section: full ISO-8601, no milliseconds.
      return moment.toISOString().replace(/\.\d{3}Z$/, "Z");
    };
    const slots = this.outboxServiceKeys();
    const rowsOf = (serviceKey: string, seeds: OutboxSeed[]): AdminRow[] => {
      const slot = slots.indexOf(serviceKey);
      return seeds.map((seed, index) => ({
        id: outboxUuid("7e0", slot, index),
        aggregate_type: seed.aggregateType,
        aggregate_id: seed.aggregateId,
        event_type: seed.eventType,
        payload: seed.payload,
        status: seed.status,
        created_at: at(seed.minutesAgo),
        published_at: seed.publishedMinutesAgo === undefined ? null : at(seed.publishedMinutesAgo),
        attempts: seed.attempts,
        last_error_message: seed.lastErrorMessage ?? null,
        processing_started_at: seed.processingMinutesAgo === undefined ? null : at(seed.processingMinutesAgo),
        request_id: outboxUuid("a11", slot, index),
      }));
    };

    const users = this.users;
    const projects = this.projects;
    const issues = this.issues;

    const published = (
      count: number,
      aggregateType: string,
      eventTypes: string[],
      aggregateIds: string[],
      firstMinutesAgo: number,
    ): OutboxSeed[] =>
      Array.from({ length: count }, (_, index) => {
        const minutesAgo = firstMinutesAgo - index * 37;
        const aggregateId = aggregateIds[index % aggregateIds.length] ?? ANNA_ID;
        return {
          eventType: eventTypes[index % eventTypes.length],
          aggregateType,
          aggregateId,
          status: "PUBLISHED",
          minutesAgo,
          attempts: 1,
          processingMinutesAgo: minutesAgo,
          publishedMinutesAgo: minutesAgo,
          payload: JSON.stringify({ aggregateId, occurredAt: at(minutesAgo) }),
        };
      });

    return {
      auth: rowsOf("auth", [
        ...published(
          8,
          "User",
          ["user.registered", "user.password_changed", "session.revoked", "user.role_changed"],
          users.map((user) => user.id),
          2160,
        ),
        {
          eventType: "user.registered",
          aggregateType: "User",
          aggregateId: users[2]?.id ?? SOFIA_ID,
          status: "NEW",
          minutesAgo: 600,
          attempts: 0,
          // The address in full: since backend TAS-395 (#228) the Data section
          // masks no email partially, and a hidden key — the invitation's
          // `rawInviteToken` — is removed from the document rather than starred,
          // so it is simply not there. The card still pretty-prints whatever
          // document arrives by its one rule; it never decides what is secret.
          payload: '{"userId":"16ad2404-96e3-4c51-b00d-55c5d1451d3c","email":"nina.orlova@mail.ru"}',
        },
        {
          eventType: "session.revoked",
          aggregateType: "Session",
          aggregateId: users[1]?.id ?? MARK_ID,
          status: "PROCESSING",
          minutesAgo: 45,
          processingMinutesAgo: 44,
          attempts: 2,
          payload: JSON.stringify({ sessionId: outboxUuid("9c1", 0, 3), reason: "USER_LOGOUT" }),
        },
        {
          eventType: "user.password_changed",
          aggregateType: "User",
          aggregateId: users[0]?.id ?? ANNA_ID,
          status: "FAILED",
          minutesAgo: 180,
          processingMinutesAgo: 178,
          attempts: 5,
          lastErrorMessage:
            "org.apache.kafka.common.errors.TimeoutException: Expiring 1 record(s) for taska.auth.events-0: 60000 ms has passed since batch creation",
          payload: JSON.stringify({ userId: users[0]?.id ?? ANNA_ID, changedAt: at(180) }),
        },
      ]),
      project: rowsOf("project", [
        ...published(
          6,
          "Project",
          ["project.created", "project.updated", "project.member_added"],
          projects.map((project) => project.id),
          1980,
        ),
        {
          eventType: "project.member_added",
          aggregateType: "Project",
          aggregateId: projects[1]?.id ?? WEB_PROJECT_ID,
          status: "NEW",
          minutesAgo: 300,
          attempts: 0,
          payload: JSON.stringify({ projectId: projects[1]?.id ?? WEB_PROJECT_ID, userId: SOFIA_ID, role: "MEMBER" }),
        },
        {
          eventType: "project.archived",
          aggregateType: "Project",
          aggregateId: projects[3]?.id ?? OPS_PROJECT_ID,
          status: "FAILED",
          minutesAgo: 1500,
          processingMinutesAgo: 1498,
          attempts: 5,
          lastErrorMessage: "Connection refused: schema-registry.taska.svc.cluster.local/10.0.4.11:8081",
          payload: JSON.stringify({ projectId: projects[3]?.id ?? OPS_PROJECT_ID, archivedBy: MARK_ID }),
        },
        // The row that lives in the gap between the section's two thresholds,
        // and the reason `OUTBOX_RETRY_STUCK_MINUTES` exists at all: old enough
        // for the summary to call it "Stuck processing" (past 5m) and too young
        // for the retry route to take it (short of 10m). Since backend PR #195
        // (TAS-200) the summary says so itself — `retryable: false` — and the
        // section draws no Retry button for it; a hand-made retry is still a
        // `FAILED_PRECONDITION`, in the server's own words.
        //
        // Its shape is the one that produces this on a real stand: an event
        // created two days ago, requeued by somebody, picked up minutes ago and
        // still going. That is also why `attempts` is 6 — the count survives a
        // retry, so a requeued event carries its history forward.
        //
        // Appended rather than inserted: the id is derived from the position in
        // this array, and a row's address has to survive a reload and a copied
        // link.
        {
          eventType: "project.member_added",
          aggregateType: "Project",
          aggregateId: projects[0]?.id ?? TASKA_PROJECT_ID,
          status: "PROCESSING",
          minutesAgo: 700,
          processingMinutesAgo: 7,
          attempts: 6,
          payload: JSON.stringify({ projectId: projects[0]?.id ?? TASKA_PROJECT_ID, userId: MARK_ID, role: "ADMIN" }),
        },
        // The second `project.archived` failure, and the pair is the point: same
        // service, same event type, same category, same broker error, different
        // event. Everything the Problems row says about one of these it says
        // about the other — which is precisely the shape an outbox incident
        // takes, one fault stopping every event of one kind on one service, and
        // it is what the gateway itself answered on 2026-09-08 (two `FAILED`
        // events on `project` sharing a `lastErrorMessage`, DESIGN.md §5.8).
        //
        // Without it the seed could not reach the case that broke the retry
        // confirmation: two announcements identical to the byte, and a live
        // region that does not change is not read out a second time. The five
        // rows here happened to have five distinct type-and-service pairs, so
        // every test in the suite passed over the defect. Seeded rather than
        // argued about, so the pin in `e2e/admin-events.spec.ts` has a real
        // pair of rows to retry.
        //
        // An hour younger than the archive failure above it, so the two are
        // neighbours in an oldest-first list — the reader sees the collision
        // rather than having to hunt for it — and both still fit inside
        // `OUTBOX_SUMMARY_LIMIT`. What that pushes off the end is the issue
        // service's 7h `FAILED` row; the four rows the mock's own tests name by
        // status and service are all still listed.
        //
        // Appended rather than inserted, for the reason the row above gives:
        // the id is derived from the position in this array.
        {
          eventType: "project.archived",
          aggregateType: "Project",
          aggregateId: projects[2]?.id ?? MOB_PROJECT_ID,
          status: "FAILED",
          minutesAgo: 1440,
          processingMinutesAgo: 1438,
          attempts: 5,
          // The same fault as the other archive failure, word for word: one
          // registry that cannot be reached does not write two different errors.
          lastErrorMessage: "Connection refused: schema-registry.taska.svc.cluster.local/10.0.4.11:8081",
          payload: JSON.stringify({ projectId: projects[2]?.id ?? MOB_PROJECT_ID, archivedBy: MARK_ID }),
        },
      ]),
      issue: rowsOf("issue", [
        ...published(
          20,
          "Issue",
          ["issue.created", "issue.status_changed", "issue.assigned", "issue.commented"],
          issues.map((issue) => issue.id),
          2400,
        ),
        // Young enough to be nobody's problem: a scheduler that runs every
        // minute has not missed these yet, and the summary must not count them.
        {
          eventType: "issue.commented",
          aggregateType: "Issue",
          aggregateId: issues[0]?.id ?? ANNA_ID,
          status: "NEW",
          minutesAgo: 2,
          attempts: 0,
          payload: JSON.stringify({ issueId: issues[0]?.id ?? "", commentId: outboxUuid("cc1", 2, 0) }),
        },
        {
          eventType: "issue.status_changed",
          aggregateType: "Issue",
          aggregateId: issues[1]?.id ?? ANNA_ID,
          status: "PROCESSING",
          minutesAgo: 2,
          processingMinutesAgo: 1,
          attempts: 1,
          payload: JSON.stringify({ issueId: issues[1]?.id ?? "", from: "TODO", to: "IN_PROGRESS" }),
        },
        {
          eventType: "issue.created",
          aggregateType: "Issue",
          aggregateId: issues[2]?.id ?? ANNA_ID,
          status: "NEW",
          minutesAgo: 30,
          attempts: 0,
          payload: JSON.stringify({ issueId: issues[2]?.id ?? "", projectId: TASKA_PROJECT_ID }),
        },
        {
          eventType: "issue.assigned",
          aggregateType: "Issue",
          aggregateId: issues[3]?.id ?? ANNA_ID,
          status: "PROCESSING",
          minutesAgo: 900,
          processingMinutesAgo: 898,
          attempts: 3,
          payload: JSON.stringify({ issueId: issues[3]?.id ?? "", assigneeId: MARK_ID }),
        },
        {
          eventType: "issue.status_changed",
          aggregateType: "Issue",
          aggregateId: issues[4]?.id ?? ANNA_ID,
          status: "FAILED",
          minutesAgo: 420,
          processingMinutesAgo: 418,
          attempts: 5,
          lastErrorMessage:
            "org.apache.kafka.common.errors.RecordTooLargeException: The message is 2097244 bytes when serialized which is larger than 1048576",
          payload: JSON.stringify({ issueId: issues[4]?.id ?? "", from: "IN_PROGRESS", to: "DONE" }),
        },
        {
          eventType: "issue.commented",
          aggregateType: "Issue",
          aggregateId: issues[5]?.id ?? ANNA_ID,
          status: "FAILED",
          minutesAgo: 120,
          processingMinutesAgo: 118,
          attempts: 5,
          lastErrorMessage: "Topic taska.issue.events not present in metadata after 60000 ms",
          payload: JSON.stringify({ issueId: issues[5]?.id ?? "", authorId: SOFIA_ID }),
        },
      ]),
    };
  }

  private adminRowsFor(service: string, table: string): AdminRow[] {
    // One table, three services — and the only one in this seed that is not
    // per-service, which is exactly what the Events section's selector is for.
    if (table === OUTBOX_TABLE) return this.outboxRowsFor(service);

    if (service === "auth" && table === "users") {
      return this.users.map((user, index) => ({
        id: user.id,
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
        // Two digits, so an account the invitation flow appends past the
        // ninth row still reads as a date.
        created_at: `2026-06-${String(index + 1).padStart(2, "0")}T09:00:00Z`,
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

    if (service === "admin" && table === "admin_audit_log") {
      // The Audit section's own entries, column for column — thirty of them,
      // so paging is a real control here too. The three `jsonb` columns arrive
      // as text, the way the stand sends them (`jsonbText`).
      //
      // `actor_roles` is what admin-service wrote, and it writes two shapes
      // (read at backend develop `398285cde074`): the user operations store the
      // actor's one global role, `valueToTree(role)` — a JSON string, so
      // `"\"GLOBAL_ADMIN\""` on the wire — while the outbox retry stores the
      // whole list, `valueToTree(getActorRolesList())`
      // (`GrpcAdminReadonlyService`) — a JSON array, `"[\"GLOBAL_ADMIN\"]"`.
      //
      // The two documents are the audit route's own, re-read: the seed holds
      // them in jsonb's key order already (`jsonbCompact`), so only the spacing
      // changes between the two views and the keys run in one order in both. A
      // document that does not parse is passed on as it is. `created_at` is the
      // seed's own spelling, to the second with `Z`, which is what the probe
      // showed for this column.
      const document = (text: string | null): string | null => {
        if (text === null) return null;
        try {
          return jsonbText(JSON.parse(text));
        } catch {
          return text;
        }
      };
      return this.auditEntries.map((entry) => ({
        id: entry.id,
        request_id: entry.requestId,
        actor_user_id: entry.actorUserId,
        actor_display_name: entry.actorDisplayName,
        actor_roles: entry.action === "RETRY_OUTBOX_EVENT" ? jsonbText(["GLOBAL_ADMIN"]) : jsonbText("GLOBAL_ADMIN"),
        action: entry.action,
        target_service: entry.targetService,
        target_table: entry.targetTable,
        target_id: entry.targetId,
        old_value: document(entry.oldValue),
        new_value: document(entry.newValue),
        reason: entry.reason,
        created_at: entry.createdAt,
        actor_email: entry.actorEmail,
      }));
    }

    return [];
  }

  private project(
    id: string,
    projectKey: string,
    name: string,
    /**
     * Undefined for a project that has none — which is now a state anything
     * created at runtime can be in. Clearing the box stores `null`, and so
     * does a blank one (backend PR #155 as merged); both draw the card's
     * placeholder (§5.6).
     */
    description: string | undefined,
    /**
     * `color` on all three project DTOs since backend PR #155 (TAS-145),
     * merged. The seeded projects state one so the mock keeps showing the
     * palette DESIGN.md §2.2 chose; OPS states none and is coloured from its
     * key, the path every project without a chosen colour takes.
     */
    color: string | undefined,
    memberIds: string[],
    /**
     * Distinct per seed: `GET /projects` orders by `created_at`, then `id`
     * (`ProjectRepository`), and four seeds sharing one instant would be
     * ordered by their ids rather than in the order the screen has always
     * drawn them (TAS-394).
     */
    createdAt: string,
  ): Project {
    return {
      id,
      projectKey,
      name,
      description,
      color,
      memberIds,
      createdBy: memberIds[0] ?? ANNA_ID,
      createdAt,
      updatedAt: "2026-06-18T10:30:00Z",
      archivedAt: null,
    };
  }

  /**
   * `about` is the issue the notification names, the project alone (`id:
   * null`, a member row since backend TAS-415), or `null` for one that names
   * none — which leaves all three of `issueId`, `issueKey` and `projectId`
   * `null`. A third — `issueId` alone —
   * is what an attachment notification written before backend PR #191
   * (TAS-245) still carries on the stand, since that fix did not backfill;
   * `notificationRoute` treats it as inert, and its own tests cover it, so the
   * seed no longer needs a row in that shape. Typed to the kinds this build
   * knows: the mock has no reason to invent a fourth shape.
   */
  private notification(
    notificationType: NotificationType,
    title: string,
    body: string,
    about: { id: string | null; issueKey?: string | null; projectId?: string | null } | null,
    createdAt: string,
    readAt: string | null,
  ): Notification {
    return {
      id: makeId("notification"),
      notificationType,
      title,
      body,
      issueId: about?.id ?? null,
      issueKey: about?.issueKey ?? null,
      projectId: about?.projectId ?? null,
      createdAt,
      readAt,
      sourceEventId: makeId("event"),
    };
  }

  private getUser(userId: string): StoredUser {
    const user = this.users.find((item) => item.id === userId);
    if (!user) {
      throw new MockApiError("NOT_FOUND", "User not found");
    }
    return user;
  }

  /**
   * The nested summary a member row carries — and it is built **at read time**,
   * never stored, because the avatar in it changes without the membership
   * changing. `ProjectMemberDetailsDto` declares the avatar inline, which is
   * what makes a board of faces one request; a summary frozen into
   * `membersByProject` at construction would have been a board that never
   * noticed anybody's new picture.
   *
   * `null` and not `undefined` for a person with no avatar: this row *asked*,
   * inline, and got an answer. See `User.avatarUrl`.
   *
   * Also `null` for a row whose object is gone — the state the
   * `avatarObjectLost` trigger leaves — rather than the bytes this store still
   * happens to hold: there is no object left to presign, and a face the server
   * cannot serve should not be drawn.
   *
   * Both halves are the server's reading too, at backend develop
   * `398285cde074` (TAS-225, `3379696d`). The member read and the project
   * context both name their members through auth-service's
   * `getUserDetailsByIds`: `findUsersWithAvatars` selects the avatar row with
   * its id, so a member with a picture arrives with one, and
   * `enrichWithAvatarUrl` ends in `onErrorResume(… withoutAvatar(user))`, so a
   * presign that fails drops that one member's avatar and the rest of the read
   * stands. Until that commit the read filled no avatar at all and one
   * unreadable object failed the whole answer; this store did neither then
   * either.
   */
  private userSummary(userId: string): ProjectMember["user"] {
    const user = this.getUser(userId);
    const avatar = this.avatars.get(userId);
    return {
      displayName: user.displayName,
      email: user.email,
      color: user.color,
      avatarUrl: avatar && this.avatarObjects.has(avatar.objectKey) ? avatar.downloadUrl : null,
    };
  }

  /**
   * The issue as a reader sees it: the stored record plus its current labels
   * and the minutes logged on it.
   */
  private issueView(issue: StoredIssue): Issue {
    return { ...issue, labels: this.labelsForIssue(issue.id), timeSpentMinutes: this.timeSpentOn(issue.id) };
  }

  /**
   * `timeSpentMinutes` (backend TAS-431): every live worklog minute of the
   * issue. issue-service keeps it as a column it moves with each worklog add,
   * edit and delete (`Issue.addWorklogMinutes` and its two siblings), so on the
   * server too it is the sum of the live entries; here it is summed when an
   * answer is built, whatever page of the work log anybody has read.
   */
  private timeSpentOn(issueId: string): number {
    return this.worklogs
      .filter((item) => item.issueId === issueId && item.deletedAt === null)
      .reduce((total, item) => total + item.spentMinutes, 0);
  }

  /**
   * The issue as `IssueShortResponseDto` states it — ten fields since backend
   * TAS-218 added the project and the status key, listed one by one rather than
   * spread, so the mock can never hand out a description, a label or a version
   * the gateway would not have sent. That narrowness is the whole reason
   * `IssueSearchHit` exists.
   */
  private searchHit(issue: StoredIssue): IssueSearchHit {
    // Backend TAS-418, TAS-432: the type's look from the issue's project
    // registry as it stands now; a type deleted from it since leaves all four
    // `null`, a type without an icon the icon alone.
    const type = (this.issueTypesByProject[issue.projectId] ?? []).find((entry) => entry.code === issue.issueType);
    return {
      id: issue.id,
      issueKey: issue.issueKey,
      issueType: issue.issueType,
      issueTypeName: type?.name ?? null,
      issueTypeColor: type?.color ?? null,
      issueTypeShape: type?.shape ?? null,
      issueTypeIcon: type?.icon ?? null,
      summary: issue.summary,
      priority: issue.priority,
      assigneeId: issue.assigneeId || null,
      // The seventh field, and the only planning field this DTO carries. Stated
      // one by one like its neighbours so the mock can never hand out a date or
      // an estimate the gateway would not have sent.
      storyPoints: issue.storyPoints,
      // The three TAS-218 added: the issue's project and its status key.
      projectId: issue.projectId,
      projectKey: this.projects.find((project) => project.id === issue.projectId)?.projectKey ?? null,
      statusKey: issue.status,
    };
  }

  /**
   * Resolved through `projectLabels` on every read, by name and then id — the
   * order the issue's label route and every issue DTO's `labels` declare since
   * backend PR #200, and the order the project's own list declares too, so
   * the picker below the chips lists them the same way. Never the order they
   * were attached in.
   */
  private labelsForIssue(issueId: string): Label[] {
    const attached = this.labelIdsByIssue[issueId] ?? [];
    return this.projectLabels
      .filter((label) => label.deletedAt === null && attached.includes(label.id))
      .sort(byLabelName)
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

  private findIssue(projectId: string, issueId: string): StoredIssue {
    const issue = this.issues.find((item) => item.projectId === projectId && item.id === issueId && item.deletedAt === null);
    if (!issue) {
      throw new MockApiError("NOT_FOUND", "Issue not found");
    }
    return issue;
  }

  private findAttachment(projectId: string, issueId: string, attachmentId: string): StoredAttachment {
    const issue = this.findIssue(projectId, issueId);
    const attachment = this.attachments.find(
      (item) => item.id === attachmentId && item.issueId === issue.id && item.deletedAt === null,
    );
    if (!attachment) {
      throw new MockApiError("NOT_FOUND", "Attachment not found");
    }
    return attachment;
  }

  /**
   * `upload-attachment-roles: ADMIN,MEMBER`, checked on both legs that reach
   * the gateway — `createUploadUrl` and `confirmUpload` each open with their
   * own `checkUserHasRoleForIssue` against that same set.
   *
   * Nothing in the UI can reach either leg as a VIEWER, because the picker is
   * hidden. That is exactly why the mock enforces it: a hidden control is a
   * courtesy and the server is the authority, so the only place this gate can
   * be proved is the reference implementation — the same argument
   * `deleteAttachment` is written on.
   *
   * **The sentence below is this mock's, and it is kinder than the gateway's.**
   * `ProjectRoleChecker.validateAccess` answers two different `PERMISSION_DENIED`
   * strings and neither of them is this one: `"Access denied"` when the caller
   * is not a member of the project, and `"Not allowed role"` when they are a
   * member holding the wrong role. It refuses on `!isMember` **before** it maps
   * a role or consults `allowedRoles`, so a non-member never reaches the second
   * sentence. Named here so a future reader does not take this wording for the
   * server's — the panel prints whatever comes back, and against the gateway
   * that is one of those two.
   */
  private requireUploadRole(projectId: string): void {
    const { role } = this.getMembership(projectId);
    if (role !== "ADMIN" && role !== "MEMBER") {
      throw new MockApiError("PERMISSION_DENIED", "You do not have permission to attach files to this issue");
    }
  }

  /**
   * The row as the gateway serves it. `objectKey` is dropped here rather than
   * never stored, because that is the shape of the real thing:
   * `IssueAttachmentMapper.toIssueAttachmentDto` reads eight fields off an
   * `AttachmentResponse` that carries ten, leaving the object key and the
   * presigned download URL behind. A mock that exposed the key would let a
   * component be written against a field the gateway does not send.
   */
  private attachmentView(attachment: StoredAttachment, named = false): IssueAttachment {
    return {
      // Only the details read names the uploader (`AttachmentMapper` with the
      // profile map, develop `60d62ee`); the list and the confirm do not.
      uploadedByUser: named ? this.personSummary(attachment.uploadedBy) : null,
      id: attachment.id,
      issueId: attachment.issueId,
      fileName: attachment.fileName,
      contentType: attachment.contentType,
      sizeBytes: attachment.sizeBytes,
      uploadedBy: attachment.uploadedBy,
      checksum: attachment.checksum,
      createdAt: attachment.createdAt,
    };
  }

  /**
   * The stored link as the given issue sees it. Only `viewLinkType` depends on
   * the viewer: `sourceIssueId` and `targetIssueId` keep naming the ends the
   * link was created with, so the caller finds "the other issue" by comparing
   * against the issue it asked about rather than by trusting either field.
   */
  /** Whether the issue at the other end of a link still exists — the details read's join condition. */
  private otherEndIsLive(link: StoredIssueLink, viewerIssueId: string): boolean {
    const otherId = link.sourceIssueId === viewerIssueId ? link.targetIssueId : link.sourceIssueId;
    return this.issues.some((item) => item.id === otherId && item.deletedAt === null);
  }

  private linkView(link: StoredIssueLink, viewerIssueId: string, withTarget = false): IssueLink {
    // The other end, as issue-service's `findIssueLinksWithOtherIssues` joins
    // it — and only on the details read, which is the only one that joins.
    const otherId = link.sourceIssueId === viewerIssueId ? link.targetIssueId : link.sourceIssueId;
    const other = withTarget ? this.issues.find((item) => item.id === otherId) : undefined;
    return {
      target: other
        ? {
            id: other.id,
            issueKey: other.issueKey,
            summary: other.summary,
            projectId: other.projectId,
            statusKey: other.status,
          }
        : null,
      id: link.id,
      projectId: link.projectId,
      sourceIssueId: link.sourceIssueId,
      targetIssueId: link.targetIssueId,
      viewLinkType: link.sourceIssueId === viewerIssueId ? link.linkType : inverseViewLinkType(link.linkType),
      createdBy: link.createdBy,
      createdAt: link.createdAt,
    };
  }

  /**
   * Who somebody is, as issue-service hands it to the gateway: the id always,
   * and the name and picture only when the profile read knew them. An id nobody
   * can name keeps its summary with no name in it (`IssueMapperUtils.resolveUser`)
   * — `null` here, the domain's spelling of the gateway's `""`.
   */
  private personSummary(userId: string): UserSummary {
    const user = this.users.find((item) => item.id === userId);
    const avatar = this.avatars.get(userId);
    return {
      id: userId,
      displayName: user?.displayName || null,
      avatarUrl: user && avatar && this.avatarObjects.has(avatar.objectKey) ? avatar.downloadUrl : null,
    };
  }

  /** A watcher row as a read serves it; `named` for the details read, the only one that names the subscriber. */
  private watcherView(watcher: StoredIssueWatcher, named: boolean): IssueWatcher {
    const person = named ? this.personSummary(watcher.userId) : null;
    return { ...watcher, displayName: person?.displayName ?? null, avatarUrl: person?.avatarUrl ?? null };
  }

  /**
   * A comment as a read serves it. The list names its author
   * (`CommentServiceImpl.enrichWithAuthors`, develop `60d62ee`); the add and the
   * edit answer without one. An author nobody can name gets no summary at all
   * there — the service pairs the comment with a `null` profile.
   */
  private commentView(comment: StoredIssueComment, named: boolean): IssueComment {
    const person = named ? this.personSummary(comment.authorUserId) : null;
    return { ...comment, author: person?.displayName ? person : null };
  }

  // The gateway rejects edits and deletes from anyone but the comment author.
  private findOwnComment(projectId: string, issueId: string, commentId: string): StoredIssueComment {
    const issue = this.findIssue(projectId, issueId);
    this.refuseArchivedWrite(projectId);
    const comment = this.commentsByIssue[issue.id]?.find((item) => item.id === commentId);
    if (!comment) {
      throw new MockApiError("NOT_FOUND", "Comment not found");
    }
    if (comment.authorUserId !== this.currentUserId) {
      throw new MockApiError("PERMISSION_DENIED", "Only the author can modify this comment");
    }
    return comment;
  }

  /**
   * `ProjectRoleChecker`, which every worklog route goes through, and in its
   * own two sentences: `"Access denied"` for somebody who is not a member of
   * the project at all — checked before any role is — and `"Not allowed role"`
   * for a member whose role is not in the set. Stricter than `getMembership`,
   * which answers VIEWER for a non-member: here a non-member is refused even
   * the list, as on the server.
   */
  private requireWorklogRole(projectId: string, allowed: ProjectRole[]): void {
    const { role, isMember } = this.getMembership(projectId);
    if (!isMember) throw new MockApiError("PERMISSION_DENIED", "Access denied");
    if (!allowed.includes(role as ProjectRole)) throw new MockApiError("PERMISSION_DENIED", "Not allowed role");
  }

  /** The gateway's `minimum: 1` and the service's own `> 0`. A fraction never reaches the server as a number. */
  private refuseWorklogMinutes(minutes: unknown): void {
    if (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes <= 0) {
      throw new MockApiError("INVALID_ARGUMENT", "SpentMinutes must be greater than 0");
    }
  }

  /** The service's `workDate.isAfter(LocalDate.now().plusDays(maxFutureDays))`, against the mock's own today. */
  private refuseFutureWorkDate(workDate: string): void {
    if (workDate > addDays(localDateOnly(), WORKLOG_MAX_FUTURE_DAYS)) {
      throw new MockApiError("INVALID_ARGUMENT", "WorkDate is too far in the future");
    }
  }

  /**
   * A worklog of this issue, in the server's two sentences: one that does not
   * exist, and one that belongs to another issue — both `404`.
   */
  private worklogOfIssue(issue: StoredIssue, worklogId: string): StoredWorklog {
    const worklog = this.worklogs.find((item) => item.id === worklogId && item.deletedAt === null);
    if (!worklog) throw new MockApiError("NOT_FOUND", `Worklog with id: ${worklogId} not found`);
    if (worklog.issueId !== issue.id) throw new MockApiError("NOT_FOUND", "Issue doesnt belongs to worklog");
    return worklog;
  }

  /** `Issue.touch()`: what every worklog write does to the issue whatever else it changes. */
  private touchIssue(issue: StoredIssue): void {
    issue.updatedAt = now();
    issue.version += 1;
  }

  private worklog(
    issue: StoredIssue,
    authorUserId: string,
    spentMinutes: number,
    workDate: string,
    comment: string | null,
    createdAt: string,
  ): StoredWorklog {
    const worklog: StoredWorklog = {
      id: makeId("worklog"),
      issueId: issue.id,
      projectId: issue.projectId,
      authorUserId,
      spentMinutes,
      workDate,
      // A blank comment is stored as `null`, as the server stores it.
      comment: comment && comment.trim() ? comment : null,
      createdAt,
      // `updated_at` is `NOT NULL DEFAULT now()` on the server's table, so a
      // fresh row carries the insert instant here too.
      updatedAt: createdAt,
      deletedAt: null,
    };
    this.worklogs.push(worklog);
    return worklog;
  }

  private worklogView(worklog: StoredWorklog): IssueWorklog {
    return {
      id: worklog.id,
      issueId: worklog.issueId,
      projectId: worklog.projectId,
      authorUserId: worklog.authorUserId,
      spentMinutes: worklog.spentMinutes,
      workDate: worklog.workDate,
      comment: worklog.comment,
      createdAt: worklog.createdAt,
      updatedAt: worklog.updatedAt,
    };
  }

  /** `PayloadSerializer.createWorklogPayload`'s keys. */
  private worklogPayload(worklog: StoredWorklog): IssueHistoryEvent["payload"] {
    return {
      issueId: worklog.issueId,
      projectId: worklog.projectId,
      authorUserId: worklog.authorUserId,
      worklogId: worklog.id,
      worklogSpentMinutes: worklog.spentMinutes,
      worklogDate: worklog.workDate,
      ...(worklog.comment !== null ? { worklogComment: worklog.comment } : {}),
    };
  }

  private commentBody(body: string): string {
    const trimmed = body.trim();
    if (!trimmed || trimmed.length > 10000) {
      throw new MockApiError("INVALID_ARGUMENT", "Comment body must be between 1 and 10000 characters");
    }
    return trimmed;
  }

  private comment(issue: StoredIssue, authorUserId: string, body: string, createdAt: string, via?: ActionVia): StoredIssueComment {
    const comment: StoredIssueComment = {
      id: makeId("comment"),
      issueId: issue.id,
      projectId: issue.projectId,
      authorUserId,
      body,
      createdAt,
      // Equal to `createdAt`, never `null`, because that is what the server's
      // insert leaves behind: issue-service's `IssueComment` audits `createdAt`
      // with `@CreatedDate` and `updatedAt` with `@LastModifiedDate`, and
      // Spring Data writes both in the one save (`domain/IssueComment.java`,
      // develop `1cfe4d7`). The `null` that used to sit here was a claim about
      // the gateway the gateway does not make, and it is what hid TAS-233: no
      // test against this mock could reproduce a fresh comment wearing the
      // `edited` badge, because only the stand ever built one.
      updatedAt: createdAt,
      // The insert's version, and the independent witness that this row has not
      // been edited: `updateComment` moves it in step with `updatedAt`, as the
      // server's `SET body = :body, version = version + 1, updated_at = NOW()`
      // does (`repository/IssueCommentRepository.java`). Nothing in the UI
      // reads it for that purpose — one field decides the badge.
      version: 1,
      // Only on a seeded comment that has one (mock only, TAS-411); a comment
      // written in the UI carries no mark.
      ...(via ? { via } : {}),
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
    via?: ActionVia,
  ) {
    const event: IssueHistoryEvent = {
      id: makeId("history"),
      issueId,
      eventType,
      actorUserId,
      occurredAt,
      payload,
      // As on comments: seeded only, and only where the seed says so.
      ...(via ? { via } : {}),
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
  // answers 204 with no tokens, so `rest` cannot produce one either. The
  // contract says how an activated user gets one since backend #204 — an
  // ordinary sign-in afterwards — and the login screen does exactly that.
  async acceptInvitation(input: AcceptInvitationInput): Promise<void> {
    this.store.acceptInvitation(input);
    await wait(null);
  }

  async searchUsers(params: SearchUsersParams): Promise<DirectoryPage> {
    return wait(this.store.searchUsers(params));
  }

  async inviteUser(input: InviteUserInput): Promise<InvitationResult> {
    return wait(this.store.inviteUser(input));
  }

  async refresh(_refreshToken: string): Promise<AuthTokens> {
    return wait(this.store.refresh());
  }

  async logout(): Promise<void> {
    window.localStorage.removeItem(SESSION_KEY);
    await wait(null);
  }

  async getCurrentUser(): Promise<User> {
    return wait(this.store.currentUserProfile());
  }

  async getNotificationPreferences(): Promise<NotificationPreferences> {
    return wait(this.store.notificationPreferences.get(this.store.currentUser()));
  }

  async updateNotificationPreferences(input: NotificationPreferencesPatch): Promise<NotificationPreferences> {
    return wait(this.store.notificationPreferences.update(this.store.currentUser(), input));
  }

  async createTelegramLink(): Promise<TelegramLink> {
    return wait(this.store.notificationPreferences.createLink(this.store.currentUser()));
  }

  async confirmTelegramLink(linkId: string): Promise<NotificationPreferences> {
    return wait(this.store.notificationPreferences.confirm(this.store.currentUser(), linkId));
  }

  async disconnectTelegram(): Promise<NotificationPreferences> {
    return wait(this.store.notificationPreferences.disconnect(this.store.currentUser()));
  }

  async listAccessTokens(): Promise<AccessTokenList> {
    return wait(this.store.accessTokens.list(this.store.currentUser().id));
  }

  // The wait first, so a refusal takes as long to arrive as a success does.
  async createAccessToken(input: CreateAccessTokenInput): Promise<IssuedAccessToken> {
    await wait(null);
    const issued = this.store.accessTokens.create(this.store.currentUser().id, input);
    this.store.notifyAccessToken("created", issued.token.tokenPrefix);
    return issued;
  }

  async revokeAccessToken(tokenId: string): Promise<void> {
    await wait(null);
    const revoked = this.store.accessTokens.revoke(this.store.currentUser().id, tokenId);
    if (revoked) this.store.notifyAccessToken("revoked", revoked.tokenPrefix);
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

  async getMeta(): Promise<EnumDictionaries> {
    return wait(this.store.getMeta());
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

  async updateProject(projectId: string, input: UpdateProjectInput): Promise<Project> {
    return wait(this.store.updateProject(projectId, input));
  }

  async archiveProject(projectId: string): Promise<Project> {
    return wait(this.store.archiveProject(projectId));
  }

  async getProjectContext(projectId: string): Promise<ProjectContext> {
    return wait(this.store.getProjectContext(projectId));
  }

  async getMembership(projectId: string): Promise<ProjectMembership> {
    return wait(this.store.getMembership(projectId));
  }

  async listMembers(projectId: string): Promise<ProjectMember[]> {
    return wait(this.store.listMembers(projectId));
  }

  async addProjectMember(projectId: string, userId: string, role: ProjectRole): Promise<ProjectMemberWriteResult> {
    return wait(this.store.addProjectMember(projectId, userId, role));
  }

  async changeProjectMemberRole(
    projectId: string,
    userId: string,
    role: ProjectRole,
  ): Promise<ProjectMemberWriteResult> {
    return wait(this.store.changeProjectMemberRole(projectId, userId, role));
  }

  async removeProjectMember(projectId: string, userId: string): Promise<void> {
    this.store.removeProjectMember(projectId, userId);
    await wait(null);
  }

  async listIssues(projectId: string, params?: ListIssuesParams): Promise<Page<Issue>> {
    return wait(this.store.listIssues(projectId, params));
  }

  async getBoard(projectId: string, params?: BoardParams): Promise<Board> {
    return wait(this.store.getBoard(projectId, params));
  }

  async getBoardColumnPage(projectId: string, statusKey: string, params?: BoardColumnPageParams): Promise<BoardColumnPage> {
    return wait(this.store.getBoardColumnPage(projectId, statusKey, params));
  }

  async getProjectStats(): Promise<ProjectStats[]> {
    return wait(this.store.getProjectStats());
  }

  async searchIssues(params: SearchIssuesParams): Promise<Page<IssueSearchHit>> {
    return wait(this.store.searchIssues(params));
  }

  async getIssue(projectId: string, issueId: string): Promise<IssueDetailsWithHistory> {
    return wait(this.store.getIssue(projectId, issueId));
  }

  async getIssueByKey(issueKey: string): Promise<Issue> {
    return wait(this.store.getIssueByKey(issueKey));
  }

  async createIssue(projectId: string, input: CreateIssueInput): Promise<Issue> {
    return wait(this.store.createIssue(projectId, input));
  }

  async updateIssue(
    projectId: string,
    issueId: string,
    input: UpdateIssueInput,
    expectedVersion: number,
  ): Promise<IssueWriteAnswer> {
    return wait(this.store.updateIssue(projectId, issueId, input, expectedVersion));
  }

  async transitionIssue(projectId: string, issueId: string, transitionId: string, expectedVersion?: number): Promise<Issue> {
    return wait(this.store.transitionIssue(projectId, issueId, transitionId, expectedVersion));
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

  async createProjectIssueType(
    projectId: string,
    input: CreateProjectIssueTypeInput,
    retry?: CommandRetry,
  ): Promise<CreatedProjectIssueType> {
    return wait(this.store.createProjectIssueType(projectId, input, retry?.requestId));
  }

  async updateProjectIssueType(
    projectId: string,
    code: string,
    input: UpdateProjectIssueTypeInput,
  ): Promise<ProjectIssueType> {
    return wait(this.store.updateProjectIssueType(projectId, code, input));
  }

  async deleteProjectIssueType(
    projectId: string,
    code: string,
    input?: DeleteProjectIssueTypeInput,
    retry?: CommandRetry,
  ): Promise<void> {
    this.store.deleteProjectIssueType(projectId, code, input, retry?.requestId);
    await wait(null);
  }

  async reorderProjectIssueTypes(projectId: string, codes: readonly string[]): Promise<ProjectIssueType[]> {
    return wait(this.store.reorderProjectIssueTypes(projectId, [...codes]));
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

  async listIssueWatchers(projectId: string, issueId: string): Promise<IssueWatchers> {
    return wait(this.store.listIssueWatchers(projectId, issueId));
  }

  async watchIssue(projectId: string, issueId: string): Promise<WatchIssueResult> {
    return wait(this.store.watchIssue(projectId, issueId));
  }

  async unwatchIssue(projectId: string, issueId: string): Promise<UnwatchIssueResult> {
    return wait(this.store.unwatchIssue(projectId, issueId));
  }

  async addIssueWatcher(projectId: string, issueId: string, userId: string): Promise<WatchIssueResult> {
    return wait(this.store.addIssueWatcher(projectId, issueId, userId));
  }

  async removeIssueWatcher(projectId: string, issueId: string, userId: string): Promise<UnwatchIssueResult> {
    return wait(this.store.removeIssueWatcher(projectId, issueId, userId));
  }

  async listAttachments(projectId: string, issueId: string): Promise<IssueAttachment[]> {
    return wait(this.store.listAttachments(projectId, issueId));
  }

  async createAttachmentUploadUrl(
    projectId: string,
    issueId: string,
    input: CreateAttachmentUploadUrlInput,
  ): Promise<AttachmentUploadTicket> {
    return wait(this.store.createAttachmentUploadUrl(projectId, issueId, input));
  }

  /**
   * Reads the blob here rather than in the store because this is the only layer
   * that may be asynchronous — and it reads the *bytes*, not just `size`, so
   * the checksum the confirm reports is a fact about what was actually sent.
   *
   * `wait` is skipped for the failure paths only in the sense that the throw
   * happens before it; there is no artificial slowness here beyond the store's
   * own, which is the same 140ms every other call takes.
   */
  async putAttachmentBytes(uploadUrl: string, body: Blob, contentType: string): Promise<void> {
    const bytes = new Uint8Array(await body.arrayBuffer());
    this.store.putAttachmentBytes(uploadUrl, bytes, contentType);
    await wait(null);
  }

  async confirmAttachmentUpload(
    projectId: string,
    issueId: string,
    input: ConfirmAttachmentUploadInput,
  ): Promise<IssueAttachment> {
    return wait(this.store.confirmAttachmentUpload(projectId, issueId, input));
  }

  async getAttachmentDownloadUrl(
    projectId: string,
    issueId: string,
    attachmentId: string,
  ): Promise<AttachmentDownloadUrl> {
    return wait(this.store.getAttachmentDownloadUrl(projectId, issueId, attachmentId));
  }

  /**
   * The Blob is handed back directly rather than through `wait`, which clones
   * its value; the delay is the same 140ms every other call takes.
   */
  async getAttachmentBytes(downloadUrl: string): Promise<Blob> {
    const blob = this.store.getAttachmentBytes(downloadUrl);
    await wait(null);
    return blob;
  }

  async deleteAttachment(projectId: string, issueId: string, attachmentId: string): Promise<void> {
    this.store.deleteAttachment(projectId, issueId, attachmentId);
    await wait(null);
  }

  async createAvatarUploadUrl(input: CreateAvatarUploadUrlInput): Promise<AvatarUploadTicket> {
    return wait(this.store.createAvatarUploadUrl(input));
  }

  /**
   * Reads the blob here rather than in the store because this is the only layer
   * that may be asynchronous — and it reads the *bytes*, not just `size`,
   * because the store keeps them: what it hands back afterwards is the image
   * that was actually sent.
   */
  async putAvatarBytes(uploadUrl: string, body: Blob, contentType: string): Promise<void> {
    const bytes = new Uint8Array(await body.arrayBuffer());
    this.store.putAvatarBytes(uploadUrl, bytes, contentType);
    await wait(null);
  }

  async confirmAvatarUpload(input: ConfirmAvatarUploadInput): Promise<UserAvatar> {
    return wait(this.store.confirmAvatarUpload(input));
  }

  async deleteMyAvatar(): Promise<void> {
    this.store.deleteMyAvatar();
    await wait(null);
  }

  async listIssueWorklogs(projectId: string, issueId: string, params?: ListWorklogsParams): Promise<IssueWorklogPage> {
    return wait(this.store.listIssueWorklogs(projectId, issueId, params));
  }

  async addIssueWorklog(projectId: string, issueId: string, input: AddIssueWorklogInput): Promise<IssueWorklog> {
    return wait(this.store.addIssueWorklog(projectId, issueId, input));
  }

  async updateIssueWorklog(
    projectId: string,
    issueId: string,
    worklogId: string,
    input: UpdateIssueWorklogInput,
  ): Promise<IssueWorklog> {
    return wait(this.store.updateIssueWorklog(projectId, issueId, worklogId, input));
  }

  async deleteIssueWorklog(projectId: string, issueId: string, worklogId: string): Promise<void> {
    this.store.deleteIssueWorklog(projectId, issueId, worklogId);
    await wait(null);
  }

  async listProjectWorkflows(projectId: string): Promise<ProjectWorkflowEntry[]> {
    return wait(this.store.listProjectWorkflows(projectId));
  }

  async createProjectWorkflow(
    projectId: string,
    input: CreateProjectWorkflowInput,
    retry?: CommandRetry,
  ): Promise<ProjectWorkflowEntry> {
    return wait(this.store.createProjectWorkflow(projectId, input, retry?.requestId));
  }

  async addWorkflowStatus(projectId: string, workflowId: string, input: WorkflowStatusInput): Promise<ProjectWorkflowEntry> {
    return wait(this.store.addWorkflowStatus(projectId, workflowId, input));
  }

  async addWorkflowTransition(
    projectId: string,
    workflowId: string,
    input: WorkflowTransitionInput,
  ): Promise<ProjectWorkflowEntry> {
    return wait(this.store.addWorkflowTransition(projectId, workflowId, input));
  }

  async updateProjectWorkflow(
    projectId: string,
    workflowId: string,
    input: UpdateProjectWorkflowInput,
    retry?: CommandRetry,
  ): Promise<ProjectWorkflowEntry> {
    return wait(this.store.updateProjectWorkflow(projectId, workflowId, input, retry?.requestId));
  }

  async deleteProjectWorkflow(
    projectId: string,
    workflowId: string,
    input: DeleteProjectWorkflowInput,
  ): Promise<ProjectWorkflowEntry> {
    return wait(this.store.deleteProjectWorkflow(projectId, workflowId, input));
  }

  async updateWorkflowStatus(
    projectId: string,
    workflowId: string,
    statusId: string,
    input: UpdateWorkflowStatusInput,
  ): Promise<ProjectWorkflowEntry> {
    return wait(this.store.updateWorkflowStatus(projectId, workflowId, statusId, input));
  }

  async deleteWorkflowStatus(
    projectId: string,
    workflowId: string,
    statusId: string,
    params: DeleteWorkflowStatusParams,
  ): Promise<ProjectWorkflowEntry> {
    return wait(this.store.deleteWorkflowStatus(projectId, workflowId, statusId, params));
  }

  async updateWorkflowTransition(
    projectId: string,
    workflowId: string,
    transitionId: string,
    input: UpdateWorkflowTransitionInput,
  ): Promise<ProjectWorkflowEntry> {
    return wait(this.store.updateWorkflowTransition(projectId, workflowId, transitionId, input));
  }

  async deleteWorkflowTransition(
    projectId: string,
    workflowId: string,
    transitionId: string,
    params: DeleteWorkflowTransitionParams,
  ): Promise<ProjectWorkflowEntry> {
    return wait(this.store.deleteWorkflowTransition(projectId, workflowId, transitionId, params));
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

  async listNotifications(params?: ListNotificationsParams): Promise<NotificationPage> {
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

  async getProblematicOutboxSummary(): Promise<ProblematicOutboxSummary> {
    return wait(this.store.problematicOutboxSummary());
  }

  async listAuditEntries(query: AuditEntriesQuery): Promise<AuditEntries> {
    return wait(this.store.listAuditEntries(query));
  }

  async blockUser(userId: string, reason: string): Promise<UserStatusChange> {
    return wait(this.store.blockUser(userId, reason));
  }

  async unblockUser(userId: string, reason: string): Promise<UserStatusChange> {
    return wait(this.store.unblockUser(userId, reason));
  }

  async resetCredentialLockout(userId: string, reason: string): Promise<UserStatusChange> {
    return wait(this.store.resetCredentialLockout(userId, reason));
  }

  async retryOutboxEvent(
    service: RetryableOutboxService,
    eventId: string,
    reason: string,
  ): Promise<OutboxRetryResult> {
    return wait(this.store.retryOutboxEvent(service, eventId, reason));
  }
}
