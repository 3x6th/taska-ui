import type { AccessToken, AccessTokenList, AccessTokenPolicy, IssuedAccessToken } from "../../domain/types";
import type { CreateAccessTokenInput } from "../TaskaApi";

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const failure = (code: string, message: string, details: Record<string, string> | null = null) =>
  Object.assign(new Error(message), { code, details });

/** `PersonalAccessTokenService`: `tsk_pat_` and 32 random bytes as unpadded base64url — 43 characters. */
const SECRET_PREFIX = "tsk_pat_";
const SECRET_BYTES = 32;
/** How much of the secret the list keeps showing: the prefix and four characters, `tsk_pat_3fA9`. */
const SHOWN_PREFIX_LENGTH = SECRET_PREFIX.length + 4;

/**
 * The server's defaults (`PersonalTokenProperties`, `PersonalTokenCreationLimiter`
 * at develop `be5085e5`): a lifetime of at most 90 days, 30 when none is
 * asked for, ten unexpired tokens at once, and five create attempts an hour.
 */
const POLICY: AccessTokenPolicy = { maxLifetimeDays: 90, maxActiveTokens: 10 };
const DEFAULT_LIFETIME_DAYS = 30;
const ATTEMPTS_PER_WINDOW = 5;
const WINDOW_MS = HOUR;

/** `byte[]` → base64url without padding, as `Base64.getUrlEncoder().withoutPadding()` writes it. */
function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function randomSecret(): string {
  const bytes = new Uint8Array(SECRET_BYTES);
  crypto.getRandomValues(bytes);
  return SECRET_PREFIX + base64url(bytes);
}

/** Code-unit order, as the database compares the two keys the list is ordered by. */
const byCodeUnits = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Personal access tokens in memory (TAS-412), as backend TAS-401/402 serve them
 * at develop `be5085e5`:
 *
 * - **List** — the account's tokens that are not revoked, expired ones
 *   included, `createdAt` then `id`, both newest first; and the policy.
 * - **Create**, refused in the gateway's and auth-service's order: the
 *   limiter first — five attempts an hour per account in one fixed window,
 *   **every attempt counted**, refused ones included, so it runs before the
 *   body is looked at (429 `RESOURCE_EXHAUSTED` "Token issuance rate limit
 *   reached; try later", the wait in whole seconds, rounded up, as a string in
 *   `details.retryAfterSeconds`); then the body's shape ("Invalid request
 *   parameters"); the trimmed name; the scopes; the lifetime against the
 *   policy; then the cap on unexpired tokens (400 `FAILED_PRECONDITION`
 *   "Active token limit reached", `{reason: "ACTIVE_TOKEN_LIMIT", limit}`).
 *   The answer carries the secret once.
 * - **Revoke** — 204 for any id: unknown, another account's, already revoked.
 *
 * **The secret is not kept.** `create` makes it, cuts the shown prefix off it,
 * stores the token without it and hands it back once — so nothing here could
 * show it again, which is the whole promise of the dialog that displays it.
 *
 * Mock-only: the seeded tokens. The session here is always a signed-in one, so
 * the session-only 403 is not reachable.
 */
export class MockAccessTokens {
  private readonly tokens = new Map<string, AccessToken[]>();
  /** The limiter's fixed window per account: when it ends, and how many attempts it has seen. */
  private readonly windows = new Map<string, { endsAt: number; attempts: number }>();

  /**
   * `seedUserId` gets two tokens; `atCapUserId`, if given, as many unexpired
   * tokens as the policy allows and one expired one — so the cap refusal can
   * be reached by clicking (the limiter's five attempts an hour would stop
   * anybody short of ten), and the expired row shows that it does not count.
   */
  constructor(seedUserId?: string, atCapUserId?: string) {
    const now = Date.now();
    const iso = (offset: number) => new Date(now + offset).toISOString();
    if (atCapUserId) {
      const hex = (index: number) => index.toString(16).padStart(2, "0");
      this.tokens.set(atCapUserId, [
        {
          id: "8e1d2b63-5c9f-4a54-8b52-3f6e9d7c2f00",
          name: "Old laptop",
          tokenPrefix: "tsk_pat_oL4p",
          scopes: ["read"],
          createdAt: iso(-120 * DAY),
          expiresAt: iso(-30 * DAY),
          lastUsedAt: iso(-40 * DAY),
        },
        ...Array.from({ length: POLICY.maxActiveTokens }, (_, index) => ({
          id: `8e1d2b63-5c9f-4a54-8b52-3f6e9d7c2f${hex(index + 1)}`,
          name: `CI runner ${index + 1}`,
          tokenPrefix: `tsk_pat_Ci${hex(index + 1)}`,
          scopes: ["read", "write"],
          createdAt: iso(-(20 - index) * DAY),
          expiresAt: iso((70 + index) * DAY),
          lastUsedAt: null,
        })),
      ]);
    }
    if (!seedUserId) return;
    // One read-and-write token in use, one read-only one never used.
    this.tokens.set(seedUserId, [
      {
        id: "7d0c1a52-4b8e-4f43-9a41-2f5d8c6b1e01",
        name: "Claude Code on laptop",
        tokenPrefix: "tsk_pat_3fA9",
        scopes: ["read", "write"],
        createdAt: iso(-12 * DAY),
        expiresAt: iso(18 * DAY),
        lastUsedAt: iso(-2 * 60 * 60 * 1000),
      },
      {
        id: "7d0c1a52-4b8e-4f43-9a41-2f5d8c6b1e02",
        name: "Weekly report script",
        tokenPrefix: "tsk_pat_Qm7x",
        scopes: ["read"],
        createdAt: iso(-3 * DAY),
        expiresAt: iso(87 * DAY),
        lastUsedAt: null,
      },
    ]);
  }

  /** `createdAt`, then `id`, both newest first; the policy beside them. */
  list(userId: string): AccessTokenList {
    const tokens = [...(this.tokens.get(userId) ?? [])].sort(
      (a, b) => byCodeUnits(b.createdAt, a.createdAt) || byCodeUnits(b.id, a.id),
    );
    return structuredClone({ tokens, policy: POLICY });
  }

  create(userId: string, input: CreateAccessTokenInput): IssuedAccessToken {
    const now = Date.now();
    this.acquire(userId, now);

    const body = input as Partial<Record<keyof CreateAccessTokenInput, unknown>>;
    const { name, scopes, expiresInDays } = body;
    // `CreatePersonalAccessTokenRequestDto` as the gateway binds it: a name of
    // 1–100, one or two unique scopes of the enum, a whole lifetime of at least 1.
    if (
      typeof name !== "string" ||
      name.length < 1 ||
      name.length > 100 ||
      !Array.isArray(scopes) ||
      scopes.length < 1 ||
      scopes.length > 2 ||
      new Set(scopes).size !== scopes.length ||
      !scopes.every((scope) => scope === "read" || scope === "write") ||
      (expiresInDays !== undefined && (typeof expiresInDays !== "number" || !Number.isInteger(expiresInDays) || expiresInDays < 1))
    ) {
      throw failure("INVALID_ARGUMENT", "Invalid request parameters");
    }
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 100) throw failure("INVALID_ARGUMENT", "Token name must contain 1 to 100 characters");
    const asked = [...scopes].sort().join(",");
    if (asked !== "read" && asked !== "read,write") {
      throw failure("INVALID_ARGUMENT", "Token scopes must be read or read,write");
    }
    const days = expiresInDays ?? DEFAULT_LIFETIME_DAYS;
    if (days > POLICY.maxLifetimeDays) {
      throw failure("INVALID_ARGUMENT", "Token lifetime is outside policy", {
        maxLifetimeDays: String(POLICY.maxLifetimeDays),
      });
    }
    const held = this.tokens.get(userId) ?? [];
    if (held.filter((token) => Date.parse(token.expiresAt) > now).length >= POLICY.maxActiveTokens) {
      throw failure("FAILED_PRECONDITION", "Active token limit reached", {
        reason: "ACTIVE_TOKEN_LIMIT",
        limit: String(POLICY.maxActiveTokens),
      });
    }

    const secret = randomSecret();
    const token: AccessToken = {
      id: crypto.randomUUID(),
      name: trimmed,
      tokenPrefix: secret.slice(0, SHOWN_PREFIX_LENGTH),
      scopes: asked === "read" ? ["read"] : ["read", "write"],
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + days * DAY).toISOString(),
      lastUsedAt: null,
    };
    this.tokens.set(userId, [...held, token]);
    return { token: structuredClone(token), secret };
  }

  /**
   * Takes the token out at once and answers with it, for the notification it
   * raises; any other id — unknown, another account's, already revoked — is the
   * same 204 with nothing revoked, so `null`.
   */
  revoke(userId: string, tokenId: string): AccessToken | null {
    const current = this.tokens.get(userId) ?? [];
    const token = current.find((item) => item.id === tokenId);
    if (!token) return null;
    this.tokens.set(
      userId,
      current.filter((item) => item !== token),
    );
    return structuredClone(token);
  }

  /**
   * `PersonalTokenCreationLimiter.acquire`: a fixed window that opens on the
   * first attempt and lasts an hour; the sixth attempt in it is refused with
   * the time until it closes, in whole seconds rounded up and never under 1.
   */
  private acquire(userId: string, now: number): void {
    let window = this.windows.get(userId);
    if (!window || window.endsAt <= now) {
      window = { endsAt: now + WINDOW_MS, attempts: 0 };
      this.windows.set(userId, window);
    }
    if (window.attempts >= ATTEMPTS_PER_WINDOW) {
      const seconds = Math.max(1, Math.ceil((window.endsAt - now) / 1000));
      throw failure("RESOURCE_EXHAUSTED", "Token issuance rate limit reached; try later", {
        retryAfterSeconds: String(seconds),
      });
    }
    window.attempts += 1;
  }
}
