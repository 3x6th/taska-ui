// Deliberate duck typing: the two error classes this has to read are not
// related. MockApiError (mock/MockTaskaApi.ts) carries only `code`; ApiError
// (rest/RestTaskaApi.ts) carries `code`, the HTTP `status` and the gateway's
// `requestId`. Introducing one shared error type is its own piece of work and
// stays in the backlog — these helpers only read what both shapes may carry, in
// one place, so a screen never has to know which implementation answered it.

/**
 * Everything a failure can tell the person looking at it. Every field is
 * `null` when the error did not carry it, so a caller never has to repeat the
 * `instanceof` / `typeof` dance that used to sit inline in each screen — and,
 * more importantly, so mock mode and rest mode reach the same sentences. A
 * screen that reads only `status` says nothing useful in mock mode; one that
 * reads only `code` says nothing useful against the gateway.
 */
export interface ApiErrorFacts {
  /** The server's own wording, when it sent any. */
  message: string | null;
  /** `X-Request-Id` — what identifies this failure in the gateway log. REST only. */
  requestId: string | null;
  /** HTTP status. REST only: the mock never went over a wire. */
  status: number | null;
  /** Domain code. Both implementations carry one. */
  code: string | null;
}

export function apiErrorFacts(error: unknown): ApiErrorFacts {
  if (!(error instanceof Error)) return { message: null, requestId: null, status: null, code: null };
  const { code, status, requestId } = error as Partial<{ code: unknown; status: unknown; requestId: unknown }>;
  return {
    message: error.message || null,
    requestId: typeof requestId === "string" && requestId ? requestId : null,
    status: typeof status === "number" ? status : null,
    code: typeof code === "string" ? code : null,
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
 * TAS-196 removed that compensation. This is the predicate working as designed
 * rather than a reason to distrust it.
 *
 * Matched as a substring rather than by equality because the tail of the
 * message is the request path, which differs per call — and by the same token
 * it says nothing about *which* route was asked for, which is what lets this
 * arm serve every undeployed family at once. Each family stops matching the
 * day its routes deploy — and that is all the deployment does. A check that
 * goes quiet reports nothing to anyone, so the note does not remove itself: the
 * admin one stopped matching the moment PR #146's routes deployed, and still
 * had to be deleted by hand, in TAS-196, as recorded above.
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
 * body. Backend PR #152's `GET /projects/{id}/members` meets this signature
 * first — only `POST` is mapped on that path — and PR #155's
 * `PATCH /projects/{id}` meets it a second time, for the same reason; the
 * second is what this predicate is widened for, and nothing yet calls it for
 * the first.
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
 * covers: a gateway that answers 409 with a code this build has not seen.
 */
export function isConflict(error: unknown): boolean {
  const { code, status } = apiErrorFacts(error);
  return status === 409 || code === "FAILED_PRECONDITION" || code === "ABORTED";
}
