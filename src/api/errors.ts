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
 * Whether the server read the request, understood it, and refused it because
 * the *state* does not allow it — a business conflict rather than a bad
 * request. The admin Users section has two of them: blocking the last active
 * global admin, and a transition the account's current status does not permit
 * (DESIGN.md §5.8).
 *
 * **The code arm is load-bearing, not a mock accommodation**, and this is the
 * sentence that stops a future cleanup from breaking the feature's single most
 * important refusal. The two refusals do not share a status. Read out of
 * `RestErrorMapper.mapGrpcCodeToHttpStatus`, `GatewayErrorHandler` and
 * `DomainStatus` on the backend's `feature/TAS-107`:
 *
 * - "Cannot block/unblock user with current status: X" is `ABORTED`, which
 *   maps to HTTP **409**;
 * - "Cannot block the last active global admin" is `FAILED_PRECONDITION`,
 *   which maps to HTTP **400**.
 *
 * `GatewayErrorHandler` puts the gRPC code's own name in the response body, so
 * on REST those `code` strings arrive verbatim. Match on the status alone and
 * the last-admin refusal — the one this whole section is careful about — falls
 * through to "the gateway would not accept this request", which is the wrong
 * sentence about the wrong thing.
 *
 * The mock never went over a wire and carries only a code, and it emits the
 * same two the gateway does, so one predicate serves both implementations
 * (docs/ai/API-DIVERGENCE.md). The status arm stays for the case neither of
 * these covers: a gateway that answers 409 with a code this build has not seen.
 */
export function isConflict(error: unknown): boolean {
  const { code, status } = apiErrorFacts(error);
  return status === 409 || code === "FAILED_PRECONDITION" || code === "ABORTED";
}
