import { wasAnswered } from "../api/accountCredentials";
import { apiErrorFacts, refusalCode, refusalRetryAfter, refusalViolations } from "../api/errors";
import { formatLockDeadline } from "../lib/accountLock";
import { tooManyAttemptsText } from "./authText";

/*
 * The words of the account's own credentials (TAS-527): the password reset in
 * the sign-in card and Settings › Account. Copy is the art-director's
 * pre-build ruling (its «Copy» table), with the orchestrator's decision 4 for
 * the recovery lead; which refusal a failure is follows api-contract-guard's
 * table (§7) and its Addendum, and is decided here once, from the status, the
 * blueprint's code and the violations' field names — never from the server's
 * words.
 */

/** Under every new password (B5): the blueprint's bound only — never §4.27's stand policy (F7, ask A102). */
export const NEW_PASSWORD_HINT = "At least 12 characters.";

export const FORGOT_LEAD = "Enter the email you sign in with. If it belongs to a Taska account, we’ll send a link to choose a new password.";

/**
 * «Check your email» — the one sentence every 202 gets (B4). The address is the
 * one the reader typed, as it was sent; nothing in it comes from the answer.
 */
export const recoverySentText = (email: string, again: boolean) =>
  `If ${email} belongs to a Taska account, we’ve sent ${again ? "another link" : "a link"} there. Open it to choose a new password.`;

/**
 * Above the new password (orchestrator decision 4, art-director's build
 * review B2): the contract's fact — a completed recovery ends every session
 * and grant of the account (contracts.md, ask Q3) — in Settings' own verbs:
 * tokens are revoked, apps disconnected; and, with a session in this
 * browser, that it is one of them.
 */
export const recoveryLead = (signedInHere: boolean) =>
  signedInHere
    ? "Setting a new password signs you out of Taska on every device, this browser included. It also revokes your access tokens and disconnects your connected apps."
    : "Setting a new password signs you out of Taska on every device. It also revokes your access tokens and disconnects your connected apps.";

/**
 * The ghost under both recovery pages (art-director's build review N3): its
 * address is `/login` either way, which with a session held goes on into the
 * app — so then it says where it goes.
 */
export const backLabel = (signedIn: boolean) => (signedIn ? "Back to Taska" : "Back to sign in");

/** The forgot form's and Resend's press nothing answered (build review N2). */
export const REQUEST_LOST_TEXT = "The server could not be reached, so the link may or may not have been sent. Try again to make sure.";
export const RESEND_LOST_TEXT = "The server could not be reached, so another link may or may not have been sent. Try again to make sure.";

/** The one sentence for every way a link is dead (A101): 401, 422 `CONFIRMATION_EXPIRED`, a `token` violation. */
export const DEAD_LINK_TEXT =
  "This reset link no longer works: it expired or was already used. If you asked for more than one link, open the newest, or request a new one.";

export const NO_LINK_TEXT = "Open the link from your email again to choose a new password.";

/** `/login` after a recovery's 204 (`.auth-notice`, tied to Email). */
export const RECOVERED_NOTICE = "Password reset. Sign in with your email and new password.";

/** The code step's dead code: 422 `CONFIRMATION_EXPIRED` (expired or out of attempts) and 404 (unknown) alike. */
export const DEAD_CODE_TEXT = "This code can’t be used any more. Start over to get a new one.";

export const CODE_HINT = "Didn’t get it? Check your spam folder, or start over to send a new code.";

export const EMAIL_CHANGED_TEXT = "Email changed. Sign in with the new address from now on.";
export const PASSWORD_CHANGED_TEXT = "Password changed.";

/**
 * The code step's first sentence (the «Copy» table): where the code went —
 * the server's mask when it sent one, else the channel — then, when the
 * challenge carries a deadline, until when it works: a clock on the reader's
 * own day, a date and a clock past it. Static: it does not tick.
 */
export function codeSentText(
  challenge: { delivery: string | null; maskedDestination: string | null; expiresAt: string | null },
  now = new Date(),
): string {
  const { delivery, maskedDestination } = challenge;
  const where =
    maskedDestination !== null
      ? delivery === "TELEGRAM"
        ? `We sent a code to ${maskedDestination} in Telegram.`
        : `We sent a code to ${maskedDestination}.`
      : delivery === "EMAIL"
        ? "We sent a code by email."
        : delivery === "TELEGRAM"
          ? "We sent a code to your Telegram."
          : "We sent you a code.";
  const until = challenge.expiresAt === null ? null : new Date(challenge.expiresAt);
  if (until === null || !Number.isFinite(until.getTime())) return where;
  return `${where} It works until ${formatLockDeadline(until, now).text}.`;
}

/**
 * What a typed or pasted code is sent as (api-contract-guard Q6, precedent
 * `inviteTokenFromInput`): every whitespace character — the no-break space
 * included — and every dash taken out, and nothing else changed: no
 * truncation, no other digits converted, nothing refused. The server's 400
 * decides what is a code.
 */
export function normalizeCode(value: string): string {
  return value.replace(/[\s\p{Pd}−]/gu, "");
}

/* ----------------------------------------------------------- the refusals */

/**
 * Whether anything answered: an HTTP status — or an answer this build could
 * not read (`MalformedAnswerError`), which the server did send. A request that
 * never reached the server has neither.
 */
export const answered = (error: unknown): boolean => wasAnswered(error);

/** A 429 — or the blueprint's code for one. Its wait is `refusalRetryAfter`. */
export const isTooMany = (error: unknown): boolean => apiErrorFacts(error).status === 429 || refusalCode(error) === "RATE_LIMITED";

/** `Too many attempts. Try again in {wait}.` from the refusal's own wait (`Retry-After`). */
export const tooManyText = (error: unknown) => tooManyAttemptsText(refusalRetryAfter(error));

/**
 * A dead recovery link (api-contract-guard Addendum): a 401 of any code, a 422
 * `CONFIRMATION_EXPIRED`, or a violation named exactly `token`. Any other 422
 * is not one.
 */
export function isDeadLink(error: unknown): boolean {
  const { status } = apiErrorFacts(error);
  if (status === 401) return true;
  if (status === 422 && refusalCode(error) === "CONFIRMATION_EXPIRED") return true;
  return status === 400 && refusalViolations(error).some((violation) => violation.field === "token");
}

/** A dead code (orchestrator decision 3): 422 `CONFIRMATION_EXPIRED` and 404 `RESOURCE_NOT_FOUND`, and nothing else. */
export function isDeadCode(error: unknown): boolean {
  const { status } = apiErrorFacts(error);
  const code = refusalCode(error);
  return (status === 422 && code === "CONFIRMATION_EXPIRED") || (status === 404 && code === "RESOURCE_NOT_FOUND");
}

/** One field of a form, by its contract name, with the label the form gives it. */
export interface FormField {
  name: string;
  label: string;
}

/** One line of a refusal's violations: the field it marks — only an exact contract name — and its words. */
export interface ViolationLine {
  field: string | null;
  text: string;
}

/**
 * A 400's `Problem.violations` as the ErrorNote prints them (art-director B6,
 * with the guard's precision): the server's words verbatim, one line each, in
 * the form's field order — a field the form does not have after them, in the
 * server's order — and, with two lines or more, each of the form's prefixed
 * with its label. A line marks a field only when the violation names it
 * exactly. Empty for anything that is not a 400 with violations.
 */
export function violationLines(error: unknown, fields: readonly FormField[]): ViolationLine[] {
  if (apiErrorFacts(error).status !== 400) return [];
  const rank = (field: string) => {
    const index = fields.findIndex((item) => item.name === field);
    return index < 0 ? fields.length : index;
  };
  const ordered = refusalViolations(error)
    .map((violation, index) => ({ violation, index }))
    .sort((a, b) => rank(a.violation.field) - rank(b.violation.field) || a.index - b.index);
  const several = ordered.length >= 2;
  return ordered.map(({ violation }) => {
    const known = fields.find((item) => item.name === violation.field) ?? null;
    return {
      field: known?.name ?? null,
      text: several && known !== null ? `${known.label}: ${violation.message}` : violation.message,
    };
  });
}

/** The fields a refusal named exactly (`violationLines`), for `aria-invalid`. */
export function violatedFields(error: unknown, fields: readonly FormField[]): ReadonlySet<string> {
  return new Set(violationLines(error, fields).flatMap((line) => (line.field === null ? [] : [line.field])));
}
