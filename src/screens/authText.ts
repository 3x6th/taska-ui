import {
  ACCOUNT_BLOCKED_REASON,
  ACCOUNT_LOCKED_REASON,
  EMAIL_NOT_VERIFIED_REASON,
  PROVIDER_CANCELLED_REASON,
  PROVIDER_UNAVAILABLE_REASON,
  SIGNUP_DISABLED_REASON,
  STATE_INVALID_REASON,
  apiErrorFacts,
  hasRefusalReason,
} from "../api/errors";
import type { OAuthProvider } from "../domain/types";
import { DEFAULT_SIGNED_IN_ROUTE } from "../components/RequireSession";
import { retryAfterSeconds } from "./admin/users";

/**
 * The words of sign-up and provider sign-in (TAS-426, DESIGN.md §4.31) that
 * depend on a value: which refusal a failure is, what it says, the `{wait}`
 * of a 429, the resend countdown, and where a provider flow comes back to.
 */

/** Under Name, while the name has no reason to refuse it (§4.27, §4.31) — the invite tab, Create account and the name step. */
export const NAME_HINT = "Shown to the people you work with. You can change it later in Settings.";

/** The provider as a word — for the three this build knows; a code it does not know is printed as it came (§6). */
export function providerName(provider: string | null | undefined): string | null {
  if (provider === "GOOGLE") return "Google";
  if (provider === "GITHUB") return "GitHub";
  if (provider === "APPLE") return "Apple";
  return provider ? provider : null;
}

/** The three this build can draw a button for, by code. */
export const isKnownProvider = (value: unknown): value is OAuthProvider =>
  value === "GOOGLE" || value === "GITHUB" || value === "APPLE";

/**
 * `{wait}` (§4.31): under 90 seconds in seconds ("1 second", "45 seconds"),
 * otherwise in whole minutes rounded up ("2 minutes"); no number at all — "a
 * few minutes". A static phrase, said once: it does not tick.
 */
export function formatWait(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return "a few minutes";
  if (seconds < 90) {
    const whole = Math.ceil(seconds);
    return `${whole} ${whole === 1 ? "second" : "seconds"}`;
  }
  return `${Math.ceil(seconds / 60)} minutes`;
}

/** `Too many attempts. Try again in {wait}.` — every 429 of sign-up and provider sign-in (§4.31). */
export function tooManyAttemptsText(seconds: number | null): string {
  return `Too many attempts. Try again in ${formatWait(seconds)}.`;
}

/** The resend countdown, m:ss — "0:42", "12:40" (§4.31). Whole seconds, rounded up, never negative. */
export function formatCountdown(milliseconds: number): string {
  const total = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * The redirect target comes from our own router state, but an unchecked one is
 * not a habit worth forming: only a path on this origin is accepted. Comparing
 * resolved origins rather than pattern-matching the string catches the
 * protocol-relative forms — "//host" and "/\host", which browsers normalise to
 * the same thing — without a list of prefixes to keep complete.
 */
export function inAppPath(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.startsWith("/")) return undefined;
  try {
    return new URL(value, window.location.origin).origin === window.location.origin ? value : undefined;
  } catch {
    return undefined;
  }
}

/** The public routes a provider flow must never come back to: they are where it starts and ends. */
const NOT_A_RETURN: readonly string[] = ["/login", "/invite", "/auth/callback"];

/**
 * `returnTo` for a provider's start (guard §4): the router path the guard
 * remembered — pathname and search, the same string in both router modes,
 * never an absolute URL and never a `#/…` route — or `/projects`, sent
 * explicitly. Never one of the auth routes.
 */
export function oauthReturnTo(from: unknown): string {
  const path = inAppPath(from);
  if (path === undefined) return DEFAULT_SIGNED_IN_ROUTE;
  const pathname = path.split(/[?#]/, 1)[0].replace(/\/+$/, "");
  return NOT_A_RETURN.includes(pathname) ? DEFAULT_SIGNED_IN_ROUTE : path;
}

/**
 * Which row of §4.31's refusal table a provider sign-in's failure is. The
 * seven `?error=` reasons are their own rows; an exchange's refusal is one of
 * them when its (code, `details.reason`) pair says so, and otherwise:
 *
 * - `CODE_INVALID` — the exchange's 401 `STATE_INVALID`: the code expired or
 *   was used. Not `?error=STATE_INVALID`, which is the browser's state cookie
 *   and has its own sentence;
 * - `TOO_MANY` — a 429;
 * - `FAILED` — no reason: a 5xx, a 408, an unreadable answer, no answer;
 * - `UNKNOWN` — a reason this build has no row for, or an `?error=` value
 *   that is not one of the seven.
 */
export type ProviderRefusalReason =
  | typeof PROVIDER_CANCELLED_REASON
  | typeof STATE_INVALID_REASON
  | typeof EMAIL_NOT_VERIFIED_REASON
  | typeof ACCOUNT_BLOCKED_REASON
  | typeof ACCOUNT_LOCKED_REASON
  | typeof SIGNUP_DISABLED_REASON
  | typeof PROVIDER_UNAVAILABLE_REASON
  | "CODE_INVALID"
  | "TOO_MANY"
  | "FAILED"
  | "UNKNOWN";

/**
 * A provider sign-in's refusal as it travels to `/login` — in router state,
 * read once and then cleared (guard B5), so the request id survives the
 * redirect and a reload does not say it again.
 */
export interface ProviderRefusal {
  reason: ProviderRefusalReason;
  /** The provider the attempt was with (`taska.oauthAttempt`), or `null`. */
  provider: string | null;
  /** The tab the attempt began on (`taska.oauthAttempt`), or `null`. */
  tab: string | null;
  /**
   * `FAILED`: the server's own words, when it answered. `UNKNOWN` from an
   * exchange: the reason or code, for the mono detail line. Never anything
   * from `?error=`, which anybody can type into the address.
   */
  message: string | null;
  requestId: string | null;
  retryAfterSeconds: number | null;
  /** `ACCOUNT_LOCKED` with a deadline — none today (TAS-444); taken if one ever comes. */
  lockedUntil: string | null;
}

const CALLBACK_REASONS: readonly string[] = [
  PROVIDER_CANCELLED_REASON,
  STATE_INVALID_REASON,
  EMAIL_NOT_VERIFIED_REASON,
  ACCOUNT_BLOCKED_REASON,
  ACCOUNT_LOCKED_REASON,
  SIGNUP_DISABLED_REASON,
  PROVIDER_UNAVAILABLE_REASON,
];

const emptyRefusal = (reason: ProviderRefusalReason, provider: string | null, tab: string | null): ProviderRefusal => ({
  reason,
  provider,
  tab,
  message: null,
  requestId: null,
  retryAfterSeconds: null,
  lockedUntil: null,
});

/** `?error=` → a row: one of the seven, or `UNKNOWN` — whose value is never kept, so never printed. */
export function refusalFromCallbackError(value: string, provider: string | null, tab: string | null): ProviderRefusal {
  return emptyRefusal(
    CALLBACK_REASONS.includes(value) ? (value as ProviderRefusalReason) : "UNKNOWN",
    provider,
    tab,
  );
}

/**
 * An exchange's (or a spent name step's) failure → a row, keyed on the
 * (code, `details.reason`) pair and never on the status class: a reasonless
 * 503 is auth-service down, not `PROVIDER_UNAVAILABLE`.
 */
export function refusalFromExchange(error: unknown, provider: string | null, tab: string | null): ProviderRefusal {
  const { status, code, message, requestId, details } = apiErrorFacts(error);
  const base = { ...emptyRefusal("FAILED", provider, tab), requestId };
  const pairs: [string, string, ProviderRefusalReason][] = [
    ["UNAUTHENTICATED", STATE_INVALID_REASON, "CODE_INVALID"],
    ["PERMISSION_DENIED", ACCOUNT_BLOCKED_REASON, ACCOUNT_BLOCKED_REASON],
    ["PERMISSION_DENIED", ACCOUNT_LOCKED_REASON, ACCOUNT_LOCKED_REASON],
    ["PERMISSION_DENIED", SIGNUP_DISABLED_REASON, SIGNUP_DISABLED_REASON],
    ["UNAVAILABLE", PROVIDER_UNAVAILABLE_REASON, PROVIDER_UNAVAILABLE_REASON],
  ];
  for (const [pairCode, pairReason, reason] of pairs) {
    if (hasRefusalReason(error, pairCode, pairReason)) {
      const lockedUntil =
        reason === ACCOUNT_LOCKED_REASON && details && Object.hasOwn(details, "lockedUntil") ? details.lockedUntil : null;
      return { ...base, reason, lockedUntil };
    }
  }
  if (code === "RESOURCE_EXHAUSTED" || status === 429) {
    return { ...base, reason: "TOO_MANY", retryAfterSeconds: retryAfterSeconds(error) };
  }
  const reason = details && Object.hasOwn(details, "reason") ? details.reason : null;
  if (reason) return { ...base, reason: "UNKNOWN", message: reason };
  // Words only from something that answered: a request that never reached the
  // server has the browser's ("Failed to fetch"), and an answer this build
  // could not read has this build's — neither is the server's.
  return { ...base, message: status !== null || code !== null ? message : null };
}

/**
 * The sentence for a row (§4.31's table), or `null` for a cancelled sign-in,
 * which says nothing: the screen is as it was before the press. The locked
 * account is two lines and is drawn by the caller (`.auth-lock`).
 */
export function providerRefusalText(refusal: Pick<ProviderRefusal, "reason" | "provider" | "retryAfterSeconds">): string | null {
  const name = providerName(refusal.provider);
  switch (refusal.reason) {
    case PROVIDER_CANCELLED_REASON:
      return null;
    case STATE_INVALID_REASON:
      return "That sign-in attempt is no longer valid: it expired, a newer one replaced it, or it began in another browser. Try again from this page.";
    case EMAIL_NOT_VERIFIED_REASON:
      return name
        ? `Your ${name} account has no verified email address, so Taska can’t use it. Verify an email with ${name}, or sign in another way.`
        : "The account you chose has no verified email address, so Taska can’t use it. Verify an email there, or sign in another way.";
    case ACCOUNT_BLOCKED_REASON:
      return "The Taska account for this email is blocked. Ask a Taska admin to unblock it.";
    case ACCOUNT_LOCKED_REASON:
      return "Account is locked after too many failed sign-ins. Try again later.";
    case SIGNUP_DISABLED_REASON:
      return "No Taska account uses this email, and new accounts need an invitation. Ask a Taska admin to invite you.";
    case PROVIDER_UNAVAILABLE_REASON:
      return name
        ? `${name} sign-in isn’t available right now. Try again in a moment, or sign in another way.`
        : "This sign-in method isn’t available right now. Try again in a moment, or sign in another way.";
    case "CODE_INVALID":
      return "That sign-in could not be finished — it took too long or was already used. Try again from this page.";
    case "TOO_MANY":
      return tooManyAttemptsText(refusal.retryAfterSeconds);
    case "FAILED":
      return name ? `Sign-in with ${name} could not be finished.` : "Sign-in could not be finished.";
    case "UNKNOWN":
      return name ? `Sign-in with ${name} did not finish. Try again from this page.` : "Sign-in did not finish. Try again from this page.";
  }
}

/** A router-state value read back as a refusal, or `null` for anything that is not one. */
export function providerRefusalFromState(value: unknown): ProviderRefusal | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const reasons: readonly string[] = [...CALLBACK_REASONS, "CODE_INVALID", "TOO_MANY", "FAILED", "UNKNOWN"];
  if (typeof record.reason !== "string" || !reasons.includes(record.reason)) return null;
  const text = (key: string) => (typeof record[key] === "string" ? (record[key] as string) : null);
  return {
    reason: record.reason as ProviderRefusalReason,
    provider: text("provider"),
    tab: text("tab"),
    message: text("message"),
    requestId: text("requestId"),
    retryAfterSeconds: typeof record.retryAfterSeconds === "number" ? record.retryAfterSeconds : null,
    lockedUntil: text("lockedUntil"),
  };
}

/**
 * The deadline of a provider's `ACCOUNT_LOCKED`, when one ever comes and is
 * still ahead — none does today (TAS-444), and the screen then says the
 * deadline-free two lines rather than make a time up.
 */
export function refusalLockDeadline(refusal: Pick<ProviderRefusal, "reason" | "lockedUntil">, now = Date.now()): Date | null {
  if (refusal.reason !== ACCOUNT_LOCKED_REASON || refusal.lockedUntil === null) return null;
  const instant = Date.parse(refusal.lockedUntil);
  return Number.isFinite(instant) && instant > now ? new Date(instant) : null;
}
