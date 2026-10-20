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
 * 2026-10-19): `{string: string}`, nullable, filled by exactly one refusal
 * today — the account lock's `lockedUntil` (`src/lib/accountLock.ts`) — and
 * `null` on every other error the gateway answers.
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
  if (!(error instanceof Error)) return { message: null, requestId: null, status: null, code: null, details: null };
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

/**
 * The gRPC codes `RestErrorMapper.mapGrpcCodeToHttpStatus` turns into a 4xx,
 * read at backend `develop` `e8a8d316b326`: INVALID_ARGUMENT and OUT_OF_RANGE
 * and FAILED_PRECONDITION → 400, UNAUTHENTICATED → 401, PERMISSION_DENIED →
 * 403, NOT_FOUND → 404, ALREADY_EXISTS and ABORTED → 409, RESOURCE_EXHAUSTED →
 * 429. The mock carries only the code, so this is how its refusals are read the
 * same way as the gateway's statuses.
 */
const CLIENT_REFUSAL_CODES = new Set([
  "INVALID_ARGUMENT",
  "OUT_OF_RANGE",
  "FAILED_PRECONDITION",
  "UNAUTHENTICATED",
  "PERMISSION_DENIED",
  "NOT_FOUND",
  "ALREADY_EXISTS",
  "ABORTED",
  "RESOURCE_EXHAUSTED",
]);

/**
 * Whether the server answered with a 4xx — a refusal it will give again,
 * rather than a failure worth one retry. Read off the status when there is one
 * (rest, hybrid), off the code when there is not (mock). A 400
 * `FAILED_PRECONDITION` "Project archived" (backend PR #159) is the case that
 * made this a question: the board used to spend its one retry re-asking it.
 */
export function isClientRefusal(error: unknown): boolean {
  const { code, status } = apiErrorFacts(error);
  if (status !== null) return status >= 400 && status < 500;
  return code !== null && CLIENT_REFUSAL_CODES.has(code);
}

/**
 * Whether this failure means "the gateway does not have this route yet" rather
 * than "the thing you asked for is not there".
 *
 * Two signatures answer this, and they are different evidence rather than two
 * readings of one status: a 404 here means nobody mapped the *path*; a 405
 * means somebody mapped it, for a *different method*. Only the second can be
 * confused with a genuine client error, which is why it carries a requirement
 * the first does not need — each arm is documented where it is checked, below.
 *
 * **The 404 arm.** Both halves are required, and the pairing is narrow on
 * purpose. An unmapped path falls through to Spring's static-resource
 * handler, which answers **404** with a message beginning `No static resource
 * …` — measured 2026-09-06 against
 * `GET /api/v1/projects/{uuid}/issues/{uuid}/attachments`, where a deployed
 * neighbour (`…/comments`) answers `401` for the same unauthenticated request
 * and the attachment routes answer this. A deployed route's own 404 says
 * something about the resource — `Issue not found`, `User not found` — so the
 * message is the whole distinction; matching the status alone would read a
 * missing issue as a missing deployment.
 *
 * The attachments panel was this arm's first caller. The admin user writes
 * were next, measured the same way on 2026-08-25 against
 * `POST /api/v1/admin/users/not-a-uuid/block`; backend PR #146 mapped all three
 * of those paths and they answer `400 INVALID_ARGUMENT` as of 2026-09-08, so
 * TAS-196 removed that compensation. The attachment routes followed: they
 * merged with backend PR #147 and are deployed — their list route answered
 * `401` without a token on 2026-09-16 — and TAS-224 removed the panel's
 * branch. `UserProfileMenu` still reads this arm
 * for the avatar routes, and `AdminAuditSection` for a gateway older than
 * backend PR #197 — the 501 a mapped-but-empty audit route would have answered
 * at that PR's predecessor (#172) never shipped, and the sibling predicate that
 * read it went with it in TAS-265. This is the predicate working as designed
 * rather than a reason to distrust it.
 *
 * Matched as a substring rather than by equality because the tail of the
 * message is the request path, which differs per call — and by the same token
 * it says nothing about *which* route was asked for, which is what lets this
 * arm serve every undeployed family at once. Each family stops matching the
 * day its routes deploy — and that is all the deployment does. A check that
 * goes quiet reports nothing to anyone, so the note does not remove itself: the
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
 * The 405 arm below takes no such parameter: `code` is not free text a caller
 * has to measure and pin, it is one of a small fixed set the gateway already
 * names.
 *
 * **The 405 arm** (TAS-148). A path Spring *does* recognise, but only for
 * other methods, answers **405** with `code: "METHOD_NOT_ALLOWED"` in the
 * body. `GET /projects/{id}/members` met this signature first, while backend
 * PR #152 was undeployed and only `POST` was mapped on that path — it answers
 * `401` without a token since TAS-137 deployed (measured 2026-09-16) — and PR
 * #155's `PATCH /projects/{id}` meets it a second time, for the same reason.
 * The second is what this predicate was widened for; nothing ever called it
 * for the first.
 *
 * What the `code` conjunct buys is narrower than it looks, and worth stating
 * exactly because the obvious reading of it is false. It is **not** that this
 * gateway answers 405 for other reasons: it cannot. `GatewayWebExceptionHandler`
 * is an `@Order(-2)` `WebExceptionHandler`, so every unhandled exception in the
 * chain — the router's `MethodNotAllowedException` included — reaches
 * `GatewayErrorHandler`, where a `ResponseStatusException` takes the code from
 * the status name and no gRPC code maps to 405 at all
 * (`RestErrorMapper.mapGrpcCodeToHttpStatus`; permission-denied is 403). Read
 * at `origin/develop` on 2026-09-12. So every 405 *this gateway* emits carries
 * `METHOD_NOT_ALLOWED`, and that includes one caused by a bug of ours calling a
 * mapped path with the wrong method — which would read here as "not deployed
 * yet", and is the one way this arm can be wrong.
 *
 * What it does buy: that the 405 came from our gateway rather than from
 * something in front of it. A proxy answering with a non-JSON body leaves
 * `RestTaskaApi.request` with no `code` to read and falling back to `UNKNOWN`,
 * and that failure has nothing to say about what the gateway has shipped.
 *
 * It lives here rather than beside either of its callers because it is a fact
 * about the *gateway*, in the same family as `isMissingOrForbidden`. It is
 * never true against the mock: `MockApiError` carries no HTTP status, so mock
 * mode cannot reproduce either signature at all and does not try to.
 */
export function isUndeployedRoute(error: unknown, undeployedMessage: string): boolean {
  const { status, message, code } = apiErrorFacts(error);
  const unmappedPath = status === 404 && message !== null && message.includes(undeployedMessage);
  const mappedForOtherMethods = status === 405 && code === "METHOD_NOT_ALLOWED";
  return unmappedPath || mappedForOtherMethods;
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
