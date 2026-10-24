import { apiErrorFacts } from "./errors";

/**
 * Personal access tokens (TAS-412, for backend TAS-402): the values the create
 * form offers and the two refusals it names.
 *
 * **Provisional, every one of them.** Nothing here is in the contract or on
 * the gateway: backend develop `92a00dbc` has no token routes at all, so the
 * expiry list, the name's ceiling and the two refusals below are what this
 * build proposes until ADR TAS-400 and TAS-402 say otherwise. The request and
 * response shapes are `RestTaskaApi`'s, and the one note that calls them
 * provisional is there (docs/ai/API-DIVERGENCE.md, "TAS-412").
 */

/** The lifetimes a token may be created with, in days — 1 year is 365. */
export const ACCESS_TOKEN_EXPIRY_DAYS = [7, 30, 90, 365] as const;

export type AccessTokenExpiryDays = (typeof ACCESS_TOKEN_EXPIRY_DAYS)[number];

/** The lifetime the form starts on. */
export const DEFAULT_ACCESS_TOKEN_EXPIRY_DAYS: AccessTokenExpiryDays = 30;

/** A name is required, trimmed, and at most this long. */
export const ACCESS_TOKEN_NAME_MAX_LENGTH = 100;

/**
 * The two grants a token may be asked for. Write always comes with read: a
 * token that may change issues but not see them is not one this build offers.
 */
export type AccessTokenScopes = ["read"] | ["read", "write"];

/**
 * The 403 a request made *with* a personal access token gets for something a
 * token may not do — managing tokens among it, which is JWT-session only
 * (TAS-402). Flat `{code, message}` like every gateway refusal, with this code.
 */
export const INSUFFICIENT_SCOPE_CODE = "insufficient_scope";

/** Whether the refusal is the token-scope 403 (`INSUFFICIENT_SCOPE_CODE`). */
export function isInsufficientScope(error: unknown): boolean {
  return apiErrorFacts(error).code === INSUFFICIENT_SCOPE_CODE;
}

/**
 * Whether creating a token was refused for being too frequent: HTTP 429, or
 * the gRPC code the gateway names a 429 with. The pair is the invitation
 * resend's (`src/screens/admin/users.ts`), the one rate limit this build
 * already reads; the mock carries only the code.
 */
export function isRateLimited(error: unknown): boolean {
  const { status, code } = apiErrorFacts(error);
  return status === 429 || code === "RESOURCE_EXHAUSTED";
}
