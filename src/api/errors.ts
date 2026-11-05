import type { IssueWriteAnswer } from "./TaskaApi";

// Deliberate duck typing: the error classes this has to read are not related.
// MockApiError (mock/MockTaskaApi.ts) carries `code` and `details`; ApiError
// (rest/RestTaskaApi.ts) carries `code`, `details`, the HTTP `status` and the
// gateway's `requestId`. These helpers only read what every shape may carry,
// in one place, so a screen never has to know which implementation answered it.
//
// `IssueVersionConflictError` below is the first error class both
// implementations throw (TAS-246, for `PATCH /issues/{issueId}`). It is shared
// because the failure carries a payload — the issue as the server now has it —
// that a screen has to read, and a payload is not something duck typing should
// be trusted to find. The rest stay per implementation; folding them together
// is still its own piece of work.

/**
 * `PATCH /issues/{issueId}` refused the write because the issue had moved on:
 * the `If-Match` version was not the one the server holds. The gateway answers
 * **409** with the issue as it now stands in the body (`IssueResponseDto`) and
 * no `code` — the body *is* the issue, not a `{code, message}` — so this class
 * carries none either. Thrown by both `RestTaskaApi` and `MockTaskaStore`, with
 * `status` fixed at 409 in both, so `isConflict` and `apiErrorFacts` read a
 * mock conflict exactly as they read a gateway one.
 *
 * `current` is that body as `IssueWriteAnswer`: the issue without `labels`,
 * because the PATCH answer's labels are always `[]` whatever the issue carries
 * (issue-service `toPatchIssueResponseProto` uses the label-less
 * `toIssueProto(issue)`, read at backend `60d62ee`).
 */
export class IssueVersionConflictError extends Error {
  readonly status = 409 as const;

  constructor(
    readonly current: IssueWriteAnswer,
    readonly expectedVersion: number,
    readonly requestId?: string,
  ) {
    super(`Version conflict: sent ${expectedVersion}, the issue is at ${current.version}`);
    this.name = "IssueVersionConflictError";
  }
}

/** Whether a write was refused for a stale version, with the server's current issue to read. */
export const isIssueVersionConflict = (error: unknown): error is IssueVersionConflictError =>
  error instanceof IssueVersionConflictError;

/**
 * The answer belonged to a company session this tab has since left (TAS-500,
 * the B2B build only; api-contract-guard §4). Every request captures the tab's
 * context epoch when it is made; the epoch moves on a switch, a closed company,
 * a re-selected session and on signing in or out, and an answer that arrives
 * for an older epoch — success or failure alike — is replaced by this, and the
 * old request's `AbortController` is aborted. Thrown by both implementations,
 * from the one session layer they share (`src/api/webSession.ts`).
 *
 * **Every error surface ignores it**, and nothing here can be mistaken for a
 * gateway's refusal: it carries no `code`, `status`, `details` or `requestId`,
 * and `apiErrorFacts` reads it as having no facts at all — not even a message,
 * since the sentence is the client's and never the server's. So
 * `isMissingOrForbidden`, `isConflict`, `isUndeployedRoute`, `isAccountLocked`
 * and every `hasRefusalReason` predicate answer `false` for it (unit-tested).
 * What the reader is told about a closed company comes from
 * `onWorkspaceClosed`, never from a screen's error.
 */
export class WorkspaceClosedError extends Error {
  constructor() {
    super("This answer belongs to a company session the tab has left");
    this.name = "WorkspaceClosedError";
  }
}

/** Whether a failure is only "this answer is from a company session the tab has left" — ignore it. */
export const isWorkspaceClosed = (error: unknown): error is WorkspaceClosedError => error instanceof WorkspaceClosedError;

/**
 * The failure a screen may show, or `null` for a `WorkspaceClosedError` —
 * which no screen shows, ever: its message is the client's, and the shell says
 * what happened to the company (DESIGN.md §4.35). For the places that print an
 * error's own message.
 */
export function reportable<E>(error: E | null | undefined): E | null {
  return error === undefined || error === null || isWorkspaceClosed(error) ? null : error;
}

/**
 * An operation the B2B build does not offer (TAS-500, api-contract-guard §2,
 * B5, B8), refused by the client without a request in both implementations:
 * the legacy `POST /auth/login` and `/auth/refresh` (the account signs in with
 * `signIn` instead), the provider sign-in's exchange and name step (the
 * blueprint has not described their B2B answer — ask A8), issuing an access
 * token (an unbound token is what contracts §2 forbids — TAS-509), and the
 * administration console with the invitation route (a GLOBAL_ADMIN session
 * needs the emailed code — TAS-510). `TaskaApi.getTenancy` tells the screens,
 * which hide the controls; this is what a caller that did not ask meets.
 *
 * Like `WorkspaceClosedError` it carries no gateway field, and `apiErrorFacts`
 * reads none from it: it is not a refusal anybody's server made.
 */
export class TenancyUnavailableError extends Error {
  constructor(readonly operation: string) {
    super(`${operation} is not offered in the companies build`);
    this.name = "TenancyUnavailableError";
  }
}

export const isTenancyUnavailable = (error: unknown): error is TenancyUnavailableError =>
  error instanceof TenancyUnavailableError;

/**
 * Everything a failure can tell the person looking at it. Every field is
 * `null` when the error did not carry it, so a caller never has to repeat the
 * `instanceof` / `typeof` dance that used to sit inline in each screen — and,
 * more importantly, so mock mode and rest mode reach the same sentences. A
 * screen that reads only `status` says nothing useful in mock mode; one that
 * reads only `code` says nothing useful against the gateway.
 *
 * `IssueVersionConflictError` is the exception to three of the lines below.
 * Its `message` is the client's own ("Version conflict: sent 4, the issue is
 * at 7"): the gateway's 409 body is the issue, with no wording and no code at
 * all. Its `status` is 409 in mock mode too, and its `code` is `null` in both.
 * A screen states a conflict in a sentence of its own (`issueConflictText` in
 * BoardScreen) and never presents `message` as the server's words.
 */
export interface ApiErrorFacts {
  /** The server's own wording, when it sent any. Not for `IssueVersionConflictError`, whose message the client wrote. */
  message: string | null;
  /** `X-Request-Id` — what identifies this failure in the gateway log. REST only. */
  requestId: string | null;
  /** HTTP status. REST only, since the mock never went over a wire — except `IssueVersionConflictError`, 409 in both. */
  status: number | null;
  /** Domain code. Both implementations carry one — except `IssueVersionConflictError`, which carries none. */
  code: string | null;
  /**
   * `RestErrorResponse.details`, the refusal's machine-readable parameters
   * (backend PR #199) — read through `errorDetails`, so only a plain object of
   * strings, and `null` for anything else. Read one key with `Object.hasOwn`.
   */
  details: ErrorDetails | null;
}

/**
 * `RestErrorResponse.details` (backend PR #199, TAS-239, merged and deployed
 * 2026-10-19): `{string: string}`, nullable, filled by two refusals today —
 * the account lock's `lockedUntil` (`src/lib/accountLock.ts`) and an archived
 * project's `reason` (`isProjectArchived`, backend PR #159) — and `null` on
 * every other error the gateway answers.
 */
export type ErrorDetails = Readonly<Record<string, string>>;

/**
 * The details a body carried, or `null` — and **only** a plain object whose
 * every value is a string counts, because that is all the schema promises and
 * everything else is a value nobody can read a key out of safely: `null`, an
 * array, a number, an object holding an object, a class instance.
 *
 * The answer is a fresh frozen copy, built with `Object.fromEntries`, so a key
 * spelt `__proto__` arrives as the ordinary own property `JSON.parse` made it
 * rather than becoming a prototype. It still inherits from `Object.prototype`
 * like any object, so a caller reads one key with `Object.hasOwn` — never with
 * `in` or a bare index, which would find `constructor` on every answer.
 */
export function errorDetails(value: unknown): ErrorDetails | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const entries = Object.entries(value);
  if (!entries.every(([, item]) => typeof item === "string")) return null;
  return Object.freeze(Object.fromEntries(entries) as Record<string, string>);
}

export function apiErrorFacts(error: unknown): ApiErrorFacts {
  // The two client-made errors of the companies build state no fact a screen
  // may print as the server's — see `WorkspaceClosedError`.
  if (!(error instanceof Error) || error instanceof WorkspaceClosedError || error instanceof TenancyUnavailableError) {
    return { message: null, requestId: null, status: null, code: null, details: null };
  }
  const { code, status, requestId, details } = error as Partial<{
    code: unknown;
    status: unknown;
    requestId: unknown;
    details: unknown;
  }>;
  return {
    message: error.message || null,
    requestId: typeof requestId === "string" && requestId ? requestId : null,
    status: typeof status === "number" ? status : null,
    code: typeof code === "string" ? code : null,
    details: errorDetails(details),
  };
}

/**
 * The single question DESIGN.md §4.18 asks: is this failure "missing or not
 * yours", which the UI must not tell apart.
 */
export function isMissingOrForbidden(error: unknown): boolean {
  const { code, status } = apiErrorFacts(error);
  return code === "NOT_FOUND" || code === "PERMISSION_DENIED" || status === 404 || status === 403;
}

/** `details.reason` on the archived-project refusal (backend PR #159, TAS-146). */
export const PROJECT_ARCHIVED_REASON = "PROJECT_ARCHIVED";

/**
 * Whether a write was refused because its project is archived — backend PR
 * #159 (TAS-146), merged and deployed 2026-10-23: HTTP 400,
 * `{"code":"FAILED_PRECONDITION","message":"Project is archived",
 * "details":{"reason":"PROJECT_ARCHIVED"}}`, from every write on an archived
 * project — issues, comments, attachments, labels, links, work log, watchers,
 * workflows, members and `PATCH /projects/{id}` — and from no read.
 *
 * **`details.reason` is the key, and the only one.** `FAILED_PRECONDITION` by
 * itself is not: the last-admin refusal of a member write is a 400
 * `FAILED_PRECONDITION` too, and so are a label's and a transition's refusals.
 * The message is prose and never matched. The code is checked beside the
 * reason only because the two arrive together and a `reason` on any other code
 * is not this refusal. Read as an own property, as `errorDetails` asks.
 *
 * Not a signal that the project is archived — the board reads that off
 * `archivedAt` in its context, and a refusal only makes it read the context
 * again (DESIGN.md §5.7, «Архив пришёл отказом записи»).
 */
export function isProjectArchived(error: unknown): boolean {
  return hasRefusalReason(error, "FAILED_PRECONDITION", PROJECT_ARCHIVED_REASON);
}

/**
 * Whether a refusal carries this `code` **and** this `details.reason`, the
 * reason read as an own property (`errorDetails`). The pair is the whole key:
 * a reason on another code is not this refusal, and the code alone is shared by
 * refusals that mean different things — every `FAILED_PRECONDITION` reason
 * below is a 400. The server's message is prose and never matched.
 */
export function hasRefusalReason(error: unknown, code: string, reason: string): boolean {
  const facts = apiErrorFacts(error);
  return (
    facts.code === code &&
    facts.details !== null &&
    Object.hasOwn(facts.details, "reason") &&
    facts.details.reason === reason
  );
}

/**
 * The three `details.reason`s of a 503 `UNAVAILABLE` that is not a failure: a
 * recoverable command the server has accepted and not finished (backend
 * TAS-433, TAS-436, TAS-437, develop `78019ece` — `WorkflowBindingCoordinator`,
 * `IssueTypeCreationCoordinator`, `IssueTypeDeletionTransactions`). The
 * server finishes it by itself; the same command sent again with the answer's
 * `X-Request-Id` (`CommandRetry`) is answered once, with what it did.
 */
export const PENDING_COMMAND_REASONS: readonly string[] = [
  "WORKFLOW_BINDING_CHANGE_PENDING",
  "ISSUE_TYPE_CREATION_PENDING",
  "ISSUE_TYPE_DELETION_PENDING",
];

/**
 * Whether a write was answered «still being applied» — `UNAVAILABLE` with one
 * of `PENDING_COMMAND_REASONS` — rather than refused. The pair is the key, as
 * everywhere here: `ISSUE_TYPE_DELETION_PENDING` also refuses an issue create
 * as a 400 `FAILED_PRECONDITION`, which is a refusal (DESIGN.md §5.5).
 */
export function isCommandPending(error: unknown): boolean {
  return PENDING_COMMAND_REASONS.some((reason) => hasRefusalReason(error, "UNAVAILABLE", reason));
}

/** `details.reason` on the refused role change or removal of a project's only admin (backend TAS-394). */
export const LAST_ADMIN_REASON = "LAST_ADMIN";

/**
 * Whether a member write was refused because its target is the project's last
 * admin — 400 `FAILED_PRECONDITION`, `details.reason: "LAST_ADMIN"` since
 * backend TAS-394 (`ProjectMemberValidatorImpl`). Only the reason says so: the
 * archived refusal and any other precondition share the code, and reading one
 * of them as last-admin would tell the reader they are the project's only admin
 * (DESIGN.md §4.22).
 */
export function isLastAdmin(error: unknown): boolean {
  return hasRefusalReason(error, "FAILED_PRECONDITION", LAST_ADMIN_REASON);
}

/** `details.reason` on every refusal of a display name (TAS-425, common-lib `DisplayNames`). */
export const DISPLAY_NAME_INVALID_REASON = "DISPLAY_NAME_INVALID";

/**
 * Whether a write was refused for the name it carried — 400
 * `INVALID_ARGUMENT`, `details.reason: "DISPLAY_NAME_INVALID"` from
 * `PATCH /users/me`, `PATCH /admin/users/{userId}` and
 * `POST /auth/invitations/accept` (backend develop `78019ece`). The reason is
 * what points at the name field (`aria-invalid`); every other 400 of those
 * routes — a password, a token — shares the code and must not (DESIGN.md
 * §4.27, §5.8, §5.9).
 */
export function isDisplayNameInvalid(error: unknown): boolean {
  return hasRefusalReason(error, "INVALID_ARGUMENT", DISPLAY_NAME_INVALID_REASON);
}

/**
 * The `details.reason`s of the sign-up and provider sign-in refusals (backend
 * TAS-423, TAS-424, develop `9fcf0253`). The same seven strings are what the
 * gateway's callback puts on `/auth/callback?error=` (`OAuthErrors.REASONS`);
 * on an answer each is read only beside its code (`hasRefusalReason`):
 *
 * - `STATE_INVALID` — 401 `UNAUTHENTICATED`: a code or a sign-up step that is
 *   unknown, used or expired (on `?error=`: the browser's state cookie);
 * - `ACCOUNT_BLOCKED`, `ACCOUNT_LOCKED`, `SIGNUP_DISABLED` — 403
 *   `PERMISSION_DENIED`. A provider's `ACCOUNT_LOCKED` carries no
 *   `lockedUntil`; `SIGNUP_DISABLED` is also `POST /auth/signup`'s first
 *   refusal;
 * - `PROVIDER_UNAVAILABLE` — 503 `UNAVAILABLE`. A 5xx **without** a reason is
 *   auth-service or its database, not the provider, and is never read as this;
 * - `PROVIDER_CANCELLED`, `EMAIL_NOT_VERIFIED` — `?error=` only.
 *
 * Never `isAccountLocked` for any of them: that predicate is sound on
 * `POST /auth/login` alone, by exhausting that route's other refusals.
 */
export const STATE_INVALID_REASON = "STATE_INVALID";
export const ACCOUNT_BLOCKED_REASON = "ACCOUNT_BLOCKED";
export const ACCOUNT_LOCKED_REASON = "ACCOUNT_LOCKED";
export const SIGNUP_DISABLED_REASON = "SIGNUP_DISABLED";
export const PROVIDER_UNAVAILABLE_REASON = "PROVIDER_UNAVAILABLE";
export const PROVIDER_CANCELLED_REASON = "PROVIDER_CANCELLED";
export const EMAIL_NOT_VERIFIED_REASON = "EMAIL_NOT_VERIFIED";

/** 403 `PERMISSION_DENIED` `SIGNUP_DISABLED` — from `POST /auth/signup`, the exchange or the name step. */
export function isSignupDisabled(error: unknown): boolean {
  return hasRefusalReason(error, "PERMISSION_DENIED", SIGNUP_DISABLED_REASON);
}

/**
 * Whether this failure means "the gateway does not have this route yet" rather
 * than "the thing you asked for is not there".
 *
 * One signature answers this: the 404 an unmapped *path* gets. Both halves
 * are required, and the pairing is narrow on purpose. An unmapped path falls
 * through to Spring's static-resource handler, which answers **404** with a
 * message beginning `No static resource …` — measured 2026-09-06 against
 * `GET /api/v1/projects/{uuid}/issues/{uuid}/attachments`, where a deployed
 * neighbour (`…/comments`) answers `401` for the same unauthenticated request
 * and the attachment routes answer this. A deployed route's own 404 says
 * something about the resource — `Issue not found`, `User not found` — so the
 * message is the whole distinction; matching the status alone would read a
 * missing issue as a missing deployment.
 *
 * The attachments panel was this predicate's first caller. The admin user
 * writes were next, measured the same way on 2026-08-25 against
 * `POST /api/v1/admin/users/not-a-uuid/block`; backend PR #146 mapped all three
 * of those paths and they answer `400 INVALID_ARGUMENT` as of 2026-09-08, so
 * TAS-196 removed that compensation. The attachment routes followed: they
 * merged with backend PR #147 and are deployed — their list route answered
 * `401` without a token on 2026-09-16 — and TAS-224 removed the panel's
 * branch. `UserProfileMenu` still reads it
 * for the avatar routes, and `AdminAuditSection` for a gateway older than
 * backend PR #197 — the 501 a mapped-but-empty audit route would have answered
 * at that PR's predecessor (#172) never shipped, and the sibling predicate that
 * read it went with it in TAS-265. This is the predicate working as designed
 * rather than a reason to distrust it.
 *
 * Matched as a substring rather than by equality because the tail of the
 * message is the request path, which differs per call — and by the same token
 * it says nothing about *which* route was asked for, which is what lets it
 * serve every undeployed family at once. Each family stops matching the day
 * its routes deploy — and that is all the deployment does. A check that goes
 * quiet reports nothing to anyone, so the note does not remove itself: the
 * admin one stopped matching the moment PR #146's routes deployed, and still
 * had to be deleted by hand, in TAS-196, and the attachments one in TAS-224, as
 * recorded above.
 *
 * `undeployedMessage` is **required and has no default**, which is the point of
 * taking it as a parameter at all. The measured string is pinned once, as
 * `UNDEPLOYED_ROUTE_MESSAGE` in src/api/TaskaApi.ts, beside the two other
 * gateway sentences this build branches on; a default here would be a second
 * copy of it, and two copies of a measurement are two chances to drift — which
 * is the very thing moving this predicate out of the Users section was meant to
 * stop. Every caller passes the constant, so the constant is what is matched.
 *
 * **No 405 arm any more** (TAS-149, api-contract-guard). A path Spring mapped
 * for other methods only answers 405 `METHOD_NOT_ALLOWED`, and TAS-148 read
 * that as "not deployed yet" too: `GET /projects/{id}/members` met it while
 * backend PR #152 was undeployed, and PR #155's `PATCH /projects/{id}` until it
 * deployed (401 without a token on 2026-10-23). Every route this build calls
 * is now mapped for the method it calls it with, so no route answers it a 405
 * — yet every caller of this predicate took the "not on this gateway yet"
 * branch on one, which by now could only be a bug of ours calling a mapped
 * path with the wrong method. Such a 405 is the ordinary refusal it is.
 *
 * It lives here rather than beside any of its callers because it is a fact
 * about the *gateway*, in the same family as `isMissingOrForbidden`. It is
 * never true against the mock: `MockApiError` carries no HTTP status, so mock
 * mode cannot reproduce the signature at all and does not try to.
 */
export function isUndeployedRoute(error: unknown, undeployedMessage: string): boolean {
  const { status, message } = apiErrorFacts(error);
  return status === 404 && message !== null && message.includes(undeployedMessage);
}

/**
 * Whether the server read the request, understood it, and refused it because
 * the *state* does not allow it — a business conflict rather than a bad
 * request. The admin Users section has three of them: blocking the last active
 * global admin, a transition the account's current status does not permit, and
 * a lockout reset asked for on an account that is not locked (DESIGN.md §5.8).
 *
 * **The code arm is load-bearing, not a mock accommodation**, and this is the
 * sentence that stops a future cleanup from breaking the feature's most
 * important refusals. The three do not share a status, and two of the three
 * never reach a 409 at all. Read out of
 * `RestErrorMapper.mapGrpcCodeToHttpStatus`, `GatewayErrorHandler` and
 * `DomainStatus` on the backend at `01a5af4`, where `ABORTED -> CONFLICT` and
 * `FAILED_PRECONDITION -> BAD_REQUEST` are both unchanged:
 *
 * - "Cannot block/unblock user with current status: X" is `ABORTED`, which
 *   maps to HTTP **409**;
 * - "Cannot block the last active global admin" is `FAILED_PRECONDITION`,
 *   which maps to HTTP **400**;
 * - "User is not in LOCKED status" — the reset-lockout refusal, and the least
 *   obvious of the three — is also `FAILED_PRECONDITION` on **400**, so it
 *   reaches the modal through the `code` arm and through nothing else.
 *
 * `GatewayErrorHandler` puts the gRPC code's own name in the response body, so
 * on REST those `code` strings arrive verbatim. Match on the status alone and
 * two of the three — including the last-admin refusal this whole section is
 * careful about — fall through to "the gateway would not accept this request",
 * which is the wrong sentence about the wrong thing.
 *
 * The mock never went over a wire and carries only a code, and it emits the
 * same codes the gateway does, so one predicate serves both implementations
 * (docs/ai/API-DIVERGENCE.md). The status arm stays for the case none of these
 * covers: a gateway that answers 409 with a code this build has not seen — and
 * it is the arm the issue write's version conflict takes, a 409 whose body is
 * the issue and carries no code at all (`IssueVersionConflictError`, which
 * fixes `status` at 409 in mock mode too so the two read alike).
 */
export function isConflict(error: unknown): boolean {
  const { code, status } = apiErrorFacts(error);
  return status === 409 || code === "FAILED_PRECONDITION" || code === "ABORTED";
}

/**
 * Whether a transition was refused because the issue moved on since it was
 * read (backend TAS-422): 409 `ABORTED`, "Issue version does not match
 * expected version" with `details.currentVersion` and `details.currentStatus`.
 * The code alone is the key — never the words, and never the details: without
 * `If-Match` the server's own retry can end `ABORTED` too ("Issue status was
 * modified concurrently"), with no details, and it means the same thing to the
 * reader. Not `isConflict`, which also answers yes to `FAILED_PRECONDITION`,
 * the refusal of a transition that is not available from the issue's status.
 */
export function isTransitionConflict(error: unknown): boolean {
  return apiErrorFacts(error).code === "ABORTED";
}

/**
 * Whether `POST /auth/login` refused because the account is locked out by its
 * own failed sign-ins — the refusal TAS-237 is about, and the one whose
 * `details.lockedUntil` (backend PR #199), or failing that whose message,
 * `src/lib/accountLock.ts` reads a deadline out of.
 *
 * **On this route the signature means nothing else**, which is what makes a
 * two-field check enough for a branch that changes what the reader is told.
 * `login` is a PUBLIC route, so the gateway's admin-role 403 — the other
 * producer of `PERMISSION_DENIED` in this system — is unreachable here; and
 * every other refusal `AuthServiceImpl.login` can raise is `FAILED_PRECONDITION`
 * (blank email or password) or `UNAUTHENTICATED` (unknown email, no credential
 * row, `BLOCKED`, `INVITED`, wrong password). Read at backend head `63f7ea5` on
 * 2026-09-22, by exhausting the alternatives rather than by matching the words:
 * the sentence is prose the backend has reworded once already (PR #162), and a
 * branch keyed on prose is a branch that silently stops running.
 *
 * Deliberately **not** `isMissingOrForbidden`. That one answers DESIGN.md
 * §4.18's question — "missing or not yours", which the UI must not tell apart —
 * and widening it to carry this would make one predicate mean two things and
 * put every `NOT_FOUND` in the world through a lock parser.
 *
 * `status === null` is accepted beside `403` for the reason `isConflict`
 * already records: `MockApiError` never went over a wire and carries only a
 * code, and mock mode has to be able to reproduce this refusal or the branch
 * ships unexercised.
 */
export function isAccountLocked(error: unknown): boolean {
  const { code, status } = apiErrorFacts(error);
  return code === "PERMISSION_DENIED" && (status === 403 || status === null);
}

/**
 * The blueprint's `ErrorCode` (TAS-500, `docs/contract/b2b/b2b-openapi.yaml` at
 * develop `758f8fc6`): the `code` of a `Problem`. Disjoint from the gRPC names
 * the gateway's legacy envelope carries (`NOT_FOUND`, `PERMISSION_DENIED`, …),
 * so a code is one or the other and never both.
 */
export const B2B_ERROR_CODES = [
  "AUTHENTICATION_REQUIRED",
  "MFA_REQUIRED",
  "TOKEN_REVOKED",
  "TENANT_REQUIRED",
  "TENANT_MISMATCH",
  "TENANT_NOT_FOUND",
  "MEMBERSHIP_INACTIVE",
  "SCOPE_DENIED",
  "SESSION_REQUIRED",
  "ADMIN_GRANT_REQUIRED",
  "ADMIN_SCOPE_DENIED",
  "RESOURCE_NOT_FOUND",
  "VERSION_CONFLICT",
  "IDEMPOTENCY_CONFLICT",
  "QUOTA_EXCEEDED",
  "CAPABILITY_DISABLED",
  "READ_ONLY",
  "OWNER_REQUIRED",
  "LAST_ADMIN",
  "OWNER_MEMBERSHIP_PROTECTED",
  "INVITATION_EXPIRED",
  "INVITATION_EMAIL_MISMATCH",
  "FREE_ELIGIBILITY_USED",
  "PAYMENT_PENDING",
  "INVALID_STATE",
  "CONFIRMATION_REQUIRED",
  "CONFIRMATION_EXPIRED",
  "RATE_LIMITED",
  "DEPENDENCY_UNAVAILABLE",
  "POLICY_NOT_CONFIGURED",
  "VALIDATION_FAILED",
] as const;
export type B2bErrorCode = (typeof B2B_ERROR_CODES)[number];

export const isB2bErrorCode = (value: unknown): value is B2bErrorCode =>
  typeof value === "string" && (B2B_ERROR_CODES as readonly string[]).includes(value);

/**
 * The one classifier of a companies-build refusal (api-contract-guard B6): the
 * `Problem.code` when it is one of the blueprint's, otherwise the legacy
 * envelope's `details.reason` when *that* is one — because the blueprint is
 * silent on how the existing data routes will word a tenant refusal once
 * TAS-316 scopes them (ask A6), and either envelope may carry it. Anything
 * else is `null`: an unknown code never closes a company or reads as one of
 * these. The reason is read as an own property, as `errorDetails` asks.
 *
 * Not inert in today's build, though nothing there calls it: the stand's
 * `LAST_ADMIN` refusal (400 `FAILED_PRECONDITION`, `details.reason`
 * `LAST_ADMIN`, backend TAS-394) carries one of the blueprint's codes as its
 * reason, so this answers `LAST_ADMIN` for it. Only the companies build's
 * session layer reads it, and `LAST_ADMIN` closes nothing there.
 */
export function refusalCode(error: unknown): B2bErrorCode | null {
  const { code, details } = apiErrorFacts(error);
  if (isB2bErrorCode(code)) return code;
  const reason = details !== null && Object.hasOwn(details, "reason") ? details.reason : null;
  return isB2bErrorCode(reason) ? reason : null;
}

/**
 * `Problem.reasons` — the restrictions behind a `READ_ONLY` or
 * `CAPABILITY_DISABLED` refusal (`PLATFORM_BLOCK`, `OWNER_PAUSE`, `PAYMENT_*`,
 * `OVER_QUOTA`, `PENDING_FIRST_PAYMENT`, or a code this build does not know,
 * kept as it came). Empty when the error carried none — every error but a
 * `Problem`'s.
 */
export function refusalReasons(error: unknown): readonly string[] {
  if (!(error instanceof Error) || error instanceof WorkspaceClosedError || error instanceof TenancyUnavailableError) {
    return [];
  }
  return toReasons((error as { reasons?: unknown }).reasons);
}

/**
 * The wait a refusal asked for, in whole seconds (TAS-501, api-contract-guard
 * N1): `retryAfterSeconds` on `ApiError` — the blueprint's `Retry-After`
 * header on a 429 (contracts §6) — and on the companies mock's
 * `MockProblemError`. `null` when the refusal named none, or for the two
 * client-made errors, which are no server's.
 */
export function refusalRetryAfter(error: unknown): number | null {
  if (!(error instanceof Error) || error instanceof WorkspaceClosedError || error instanceof TenancyUnavailableError) {
    return null;
  }
  const value = (error as { retryAfterSeconds?: unknown }).retryAfterSeconds;
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * `Problem.violations` — the fields a `VALIDATION_FAILED` refused (TAS-502),
 * from `ApiError` and the companies mock's `MockProblemError` alike. Empty for
 * every other error and for the two client-made ones.
 */
export function refusalViolations(error: unknown): readonly FieldViolation[] {
  if (!(error instanceof Error) || error instanceof WorkspaceClosedError || error instanceof TenancyUnavailableError) {
    return [];
  }
  return toFieldViolations((error as { violations?: unknown }).violations);
}

/** `Problem.reasons` as a body carried it: the strings, in order; anything else dropped. */
export function toReasons(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item !== "") : [];
}

/** `FieldViolation` — one field the server refused, in its own words (`Problem.violations`). */
export interface FieldViolation {
  field: string;
  code: string;
  message: string;
}

/** `Problem.violations` as a body carried it: only entries with all three strings. */
export function toFieldViolations(value: unknown): FieldViolation[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): FieldViolation[] => {
    if (typeof item !== "object" || item === null) return [];
    const { field, code, message } = item as Record<string, unknown>;
    return typeof field === "string" && typeof code === "string" && typeof message === "string"
      ? [{ field, code, message }]
      : [];
  });
}
