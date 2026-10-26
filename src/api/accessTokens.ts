import { apiErrorFacts, hasRefusalReason } from "./errors";
import type { AccessTokenPolicy } from "../domain/types";

/**
 * Personal access tokens (TAS-412, against backend TAS-401/402 as merged at
 * develop `be5085e5`, in `docs/contract/openapi.yml`): the lifetimes the create
 * form offers and the refusals it names. Every refusal is read off its code and
 * `details.reason`, never off the server's prose.
 */

/**
 * The lifetimes the form offers, in days, before the policy has its say:
 * `policy.maxLifetimeDays` (90 by default on the server) cuts them, and the
 * maximum itself joins them when it is not one of them (`accessTokenLifetimes`).
 * "1 year" is gone: the server refuses a lifetime past its policy, which on the
 * stand made that choice a 400 on every click.
 */
export const ACCESS_TOKEN_LIFETIME_PRESETS = [7, 30, 90] as const;

/** The lifetime the form starts on, when the policy allows it — the server's own default. */
export const DEFAULT_ACCESS_TOKEN_LIFETIME_DAYS = 30;

/** A name is required, trimmed, and at most this long. */
export const ACCESS_TOKEN_NAME_MAX_LENGTH = 100;

/**
 * The two grants a token may be asked for. Write always comes with read: the
 * server refuses write without read ("Token scopes must be read or read,write").
 */
export type AccessTokenScopes = ["read"] | ["read", "write"];

/**
 * The lifetimes the form offers under `policy`: the presets no longer than
 * `maxLifetimeDays`, then the maximum itself when it is not a preset — so a
 * policy of 60 offers 7, 30 and 60 days, and one of 365 offers 7, 30, 90 and
 * 365. No policy (an answer without one) offers nothing: the form then sends
 * no lifetime, and the server applies its default.
 */
export function accessTokenLifetimes(policy: AccessTokenPolicy | null): number[] {
  if (!policy) return [];
  const max = policy.maxLifetimeDays;
  const presets = ACCESS_TOKEN_LIFETIME_PRESETS.filter((days) => days <= max);
  return (presets as readonly number[]).includes(max) ? [...presets] : [...presets, max];
}

/** The lifetime the form starts on: the server's default of 30 when offered, else the longest offered, else none. */
export function defaultAccessTokenLifetime(lifetimes: readonly number[]): number | null {
  if (lifetimes.includes(DEFAULT_ACCESS_TOKEN_LIFETIME_DAYS)) return DEFAULT_ACCESS_TOKEN_LIFETIME_DAYS;
  return lifetimes.length ? Math.max(...lifetimes) : null;
}

/** `details.reason` of the refusal a token request gets on a session-only route (backend TAS-402). */
export const SESSION_REQUIRED_REASON = "SESSION_REQUIRED";

/**
 * Whether the refusal is the session-only 403: a request made **with** a
 * personal access token to a route only a signed-in session may use —
 * managing tokens among them. `PERMISSION_DENIED` with `details.reason`
 * `SESSION_REQUIRED` (`GatewayContextFactory`). The browser never holds a
 * token, so this is parity with the contract more than a state the screen
 * meets.
 */
export function isSessionRequired(error: unknown): boolean {
  return hasRefusalReason(error, "PERMISSION_DENIED", SESSION_REQUIRED_REASON);
}

/** `details.reason` of a create refused because the account holds as many active tokens as the policy allows. */
export const ACTIVE_TOKEN_LIMIT_REASON = "ACTIVE_TOKEN_LIMIT";

/**
 * Whether a create was refused for the cap on active tokens — 400
 * `FAILED_PRECONDITION` "Active token limit reached", `details.reason`
 * `ACTIVE_TOKEN_LIMIT` and `details.limit` (backend TAS-402). Expired tokens
 * do not count towards it.
 */
export function isActiveTokenLimit(error: unknown): boolean {
  return hasRefusalReason(error, "FAILED_PRECONDITION", ACTIVE_TOKEN_LIMIT_REASON);
}

/** `details.limit` of the active-token cap as a number when it came as a whole one, else `null`. */
export function activeTokenLimitOf(error: unknown): number | null {
  const { details } = apiErrorFacts(error);
  const limit = details && Object.hasOwn(details, "limit") ? details.limit : "";
  return /^\d+$/.test(limit) ? Number(limit) : null;
}

/**
 * Whether creating a token was refused for being too frequent: HTTP 429, or
 * the gRPC code the gateway names a 429 with — `RESOURCE_EXHAUSTED` "Token
 * issuance rate limit reached; try later", five attempts an hour per account
 * (refused ones counted), with the wait in `details.retryAfterSeconds` and
 * `Retry-After`. The mock carries the code and no status.
 */
export function isRateLimited(error: unknown): boolean {
  const { status, code } = apiErrorFacts(error);
  return status === 429 || code === "RESOURCE_EXHAUSTED";
}
