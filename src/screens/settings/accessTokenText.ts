import { activeTokenLimitOf, isActiveTokenLimit, isRateLimited, isSessionRequired } from "../../api/accessTokens";
import { apiErrorFacts } from "../../api/errors";
import type { AccessToken } from "../../domain/types";
import { formatDayWithYearIfOther } from "../../lib/format";
import { retryAfterSeconds } from "../admin/users";

/**
 * The words of Settings → Access tokens (TAS-412) that depend on a value: a
 * token's access, its dates, a lifetime, and the refusals said in plain text.
 */

export const TOO_MANY_TOKENS_TEXT = "Too many tokens were created recently.";
export const SESSION_ONLY_CREATE_TEXT = "Tokens can be created only from a signed-in session, not with another token.";
export const SESSION_ONLY_REVOKE_TEXT = "Tokens can be revoked only from a signed-in session, not with another token.";

/**
 * "Read" or "Read and write" for the two grants this build asks for; anything
 * else the server lists is printed as it came (TAS-173), never dropped and
 * never read as one of the two.
 */
export function accessTokenAccessLabel(scopes: readonly string[]): string {
  const distinct = [...new Set(scopes)];
  if (distinct.length === 1 && distinct[0] === "read") return "Read";
  if (distinct.length === 2 && distinct.includes("read") && distinct.includes("write")) return "Read and write";
  return distinct.length ? distinct.join(", ") : "No access stated";
}

/** "7 days", "30 days", "90 days" — and a policy's own maximum the same way: "60 days", "1 day". */
export function expiryLabel(days: number): string {
  return `${days} ${days === 1 ? "day" : "days"}`;
}

/** `formatDayWithYearIfOther`, or `null` for a date nobody can read — never a thrown `RangeError`. */
function dayOf(iso: string | null, now: Date): string | null {
  if (!iso || Number.isNaN(Date.parse(iso))) return null;
  return formatDayWithYearIfOther(iso, now);
}

/** Whether a token's lifetime has run out. A date nobody can read is not a claim that it has. */
export function accessTokenExpired(token: Pick<AccessToken, "expiresAt">, now: Date = new Date()): boolean {
  const at = Date.parse(token.expiresAt);
  return !Number.isNaN(at) && at <= now.getTime();
}

/**
 * The row's dates in one line: "Created Oct 1 · Expires Oct 31 · Last used
 * Oct 20". Past its lifetime the middle part reads "Expired Oct 31"; a token
 * never used says so. A date the answer did not carry is left out, not
 * printed as "Invalid Date".
 */
export function accessTokenDatesText(token: AccessToken, now: Date = new Date()): string {
  const created = dayOf(token.createdAt, now);
  const lastUsed = dayOf(token.lastUsedAt, now);
  return [
    created ? `Created ${created}` : null,
    accessTokenExpiryText(token, now),
    token.lastUsedAt === null ? "Never used" : lastUsed ? `Last used ${lastUsed}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** "Expires Oct 31", "Expired Oct 31", or `null` for a date the answer did not carry. */
export function accessTokenExpiryText(token: Pick<AccessToken, "expiresAt">, now: Date = new Date()): string | null {
  const expires = dayOf(token.expiresAt, now);
  return expires ? `${accessTokenExpired(token, now) ? "Expired" : "Expires"} ${expires}` : null;
}

/** The day a lifetime chosen now ends on, for the create form's line under the choice. */
export function expiryDayFromNow(days: number, now: Date = new Date()): string {
  return formatDayWithYearIfOther(new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString(), now);
}

/**
 * The 429's sentence, with the wait the server stated in
 * `details.retryAfterSeconds` (up to an hour: five attempts an hour, backend
 * TAS-402) said in whole minutes, rounded up — "1 minute", "57 minutes", never
 * "3412 seconds" — and no countdown; "later" when it stated none.
 */
export function tooManyTokensText(error: unknown): string {
  const seconds = retryAfterSeconds(error);
  const minutes = seconds === null ? null : Math.max(1, Math.ceil(seconds / 60));
  const wait =
    minutes === null ? "Try again later." : `Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
  return `${TOO_MANY_TOKENS_TEXT} ${wait}`;
}

/**
 * The cap on active tokens (400 `FAILED_PRECONDITION`, `ACTIVE_TOKEN_LIMIT`),
 * with the number the server stated in `details.limit`; without one the
 * sentence says the same thing without a number of this build's own.
 */
export function activeTokenLimitText(error: unknown): string {
  const limit = activeTokenLimitOf(error);
  return limit === null
    ? "You already have as many active tokens as you can. Revoke one to create another."
    : `You already have ${limit} active ${limit === 1 ? "token" : "tokens"}. Revoke one to create another.`;
}

/**
 * Why a token was not created: the refusals with a sentence of their own —
 * creating too often (429), the cap on active tokens, and asking with a token
 * rather than a signed-in session (403 `SESSION_REQUIRED`) — and otherwise the
 * server's own words, which is what every other refusal in the product shows.
 */
export function createRefusalText(error: unknown): string {
  if (isRateLimited(error)) return tooManyTokensText(error);
  if (isActiveTokenLimit(error)) return activeTokenLimitText(error);
  if (isSessionRequired(error)) return SESSION_ONLY_CREATE_TEXT;
  return apiErrorFacts(error).message ?? "The token was not created.";
}

/** The server's words under "The token … was not revoked.", in plain words for the session-only 403. */
export function revokeRefusalWords(error: unknown): string | null {
  if (isSessionRequired(error)) return SESSION_ONLY_REVOKE_TEXT;
  return apiErrorFacts(error).message;
}
