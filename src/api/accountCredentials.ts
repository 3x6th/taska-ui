/*
 * The account's own credentials (TAS-527): a password reset by email, a
 * password change, and an email change confirmed with a code — the B2B
 * blueprint's five routes (`docs/contract/b2b/b2b-openapi.yaml` at develop
 * `758f8fc6`, unchanged at `43d6c89d`), none of them on the stand. The
 * companies build only; today's build refuses every one without a request.
 *
 * What a wire answer is narrowed to, and the bodies built field by field in
 * the blueprint's order — so a retry of one press with its key sends the same
 * bytes (api-contract-guard §7). Narrowed once, in `src/api/webSession.ts`,
 * for both implementations.
 */

/**
 * `DeliveryAcknowledgement` (202 from `POST /auth/password-recovery`) as this
 * build reads it: the wait before another request may be sent, in whole
 * seconds ≥ 0, or `null` when the answer carried none it could read. **Nothing
 * else of it is kept** — the schema says the same answer comes for every
 * identity (no account enumeration), so the screen branches on nothing but
 * this number (api-contract-guard §4, art-director B4). The 202 itself is the
 * acknowledgement: a body that does not hold `accepted: true` is read as one
 * all the same, rather than drawn differently.
 */
export interface DeliveryAcknowledgement {
  retryAfterSeconds: number | null;
}

/**
 * `ConfirmationChallenge` (201 from `POST /account/email-changes`) as the code
 * step draws it. `purpose` is not kept: an answer whose purpose is not
 * `CHANGE_EMAIL` is no answer to this request and is refused as malformed.
 * `delivery` is kept as sent — a value this build does not know draws the
 * neutral sentence (§6).
 */
export interface EmailChangeChallenge {
  challengeId: string;
  /** An ISO instant, or `null` for one the answer did not carry or that does not parse. */
  expiresAt: string | null;
  delivery: "EMAIL" | "TELEGRAM" | (string & {}) | null;
  maskedDestination: string | null;
}

const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

/** Any 202 is the acknowledgement; only its wait is read (see `DeliveryAcknowledgement`). */
export function toDeliveryAcknowledgement(wire: unknown): DeliveryAcknowledgement {
  const value = typeof wire === "object" && wire !== null ? (wire as Record<string, unknown>).retryAfterSeconds : undefined;
  return { retryAfterSeconds: typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null };
}

/** The challenge, or `null` for an answer that is not one for an email change. */
export function toEmailChangeChallenge(wire: unknown): EmailChangeChallenge | null {
  if (typeof wire !== "object" || wire === null) return null;
  const row = wire as Record<string, unknown>;
  const challengeId = text(row.challengeId);
  if (challengeId === null || row.purpose !== "CHANGE_EMAIL") return null;
  const expiresAt = text(row.expiresAt);
  return {
    challengeId,
    expiresAt: expiresAt !== null && Number.isFinite(Date.parse(expiresAt)) ? expiresAt : null,
    delivery: text(row.delivery),
    maskedDestination: text(row.maskedDestination),
  };
}

/* ------------------------------------------------------------------ bodies */

/** `PasswordResetStartRequest`. */
export interface PasswordRecoveryRequestBody {
  email: string;
}

/** `PasswordResetCompleteRequest`. */
export interface PasswordRecoveryCompleteBody {
  token: string;
  newPassword: string;
}

/** `PasswordChangeRequest`. */
export interface PasswordChangeBody {
  currentPassword: string;
  newPassword: string;
}

/** `EmailChangeStartRequest` — `currentPassword` is optional in the blueprint, and left out rather than sent `null`. */
export interface EmailChangeStartBody {
  newEmail: string;
  currentPassword?: string;
}

/** `EmailChangeCompleteRequest`. */
export interface EmailChangeConfirmBody {
  challengeId: string;
  code: string;
}

export const recoveryRequestBody = (email: string): PasswordRecoveryRequestBody => ({ email });

export const recoveryCompleteBody = (token: string, newPassword: string): PasswordRecoveryCompleteBody => ({ token, newPassword });

export const passwordChangeBody = (currentPassword: string, newPassword: string): PasswordChangeBody => ({
  currentPassword,
  newPassword,
});

export const emailChangeStartBody = (newEmail: string, currentPassword: string | null): EmailChangeStartBody =>
  currentPassword === null ? { newEmail } : { newEmail, currentPassword };

export const emailChangeConfirmBody = (challengeId: string, code: string): EmailChangeConfirmBody => ({ challengeId, code });

/* ----------------------------------------------------- the cross-tab signal */

/**
 * `localStorage` `taska.accountRevision` (api-contract-guard §6, orchestrator
 * decision 8): written after the server took a new password or a new email,
 * so every other tab of the same account re-reads `GET /users/me`. **Data
 * free** — a nonce and the account's id, never the address, the password or
 * anything the server answered: the address on screen is always the one the
 * re-read brings.
 */
export const ACCOUNT_REVISION_KEY = "taska.accountRevision";

export interface AccountRevision {
  nonce: string;
  userId: string;
}

/** The signal as another tab wrote it, or `null` for a value that is not one. */
export function toAccountRevision(raw: string | null): AccountRevision | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const nonce = text((parsed as Record<string, unknown>).nonce);
    const userId = text((parsed as Record<string, unknown>).userId);
    return nonce !== null && userId !== null ? { nonce, userId } : null;
  } catch {
    return null;
  }
}
