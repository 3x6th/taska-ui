import type { AccessToken, IssuedAccessToken } from "../../domain/types";
import { ACCESS_TOKEN_EXPIRY_DAYS, ACCESS_TOKEN_NAME_MAX_LENGTH } from "../accessTokens";
import type { CreateAccessTokenInput } from "../TaskaApi";

const DAY = 24 * 60 * 60 * 1000;
const failure = (code: string, message: string) => Object.assign(new Error(message), { code });

/** What a secret looks like: the proposal's `tsk_pat_` and 32 characters of base62. */
const SECRET_PREFIX = "tsk_pat_";
const SECRET_BODY_LENGTH = 32;
/** How much of the secret the list keeps showing: the prefix and four characters, `tsk_pat_3fA9`. */
const SHOWN_PREFIX_LENGTH = SECRET_PREFIX.length + 4;
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/**
 * **Mock only**: how many tokens one account may create in a minute before the
 * mock answers the 429. The gateway's limit is not specified anywhere (TAS-402);
 * this number exists so the refusal can be reached by clicking.
 */
const CREATES_PER_MINUTE = 5;

function randomSecret(): string {
  const bytes = new Uint8Array(SECRET_BODY_LENGTH);
  crypto.getRandomValues(bytes);
  return SECRET_PREFIX + Array.from(bytes, (byte) => BASE62[byte % BASE62.length]).join("");
}

/**
 * Personal access tokens in memory (TAS-412), behaviourally what `RestTaskaApi`
 * expects of backend TAS-402: a list per account, a create that answers with a
 * fresh secret, a revoke that takes the token out at once.
 *
 * **The secret is not kept.** `create` makes it, cuts the shown prefix off it,
 * stores the token without it and hands it back once — so nothing here could
 * show it again, which is the whole promise of the dialog that displays it.
 *
 * Mock-only facts, none of them claims about the gateway: the two seeded
 * tokens, the expired tokens staying listed until revoked, the newest-first
 * order, and the 429 after `CREATES_PER_MINUTE` creates. The refusal codes
 * are the gateway's flat `{code, message}` codes this build already knows
 * (`INVALID_ARGUMENT`, `NOT_FOUND`, `RESOURCE_EXHAUSTED`); the session here is
 * always a signed-in one, so the `insufficient_scope` 403 is not reachable.
 */
export class MockAccessTokens {
  private readonly tokens = new Map<string, AccessToken[]>();
  private readonly createdAt = new Map<string, number[]>();

  constructor(seedUserId?: string) {
    if (!seedUserId) return;
    const now = Date.now();
    const iso = (offset: number) => new Date(now + offset).toISOString();
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

  /** Newest first; two made in the same millisecond, the later one first (reversed, then a stable sort). */
  list(userId: string): AccessToken[] {
    return structuredClone(
      [...(this.tokens.get(userId) ?? [])].reverse().sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
  }

  create(userId: string, input: CreateAccessTokenInput): IssuedAccessToken {
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (!name || name.length > ACCESS_TOKEN_NAME_MAX_LENGTH) {
      throw failure("INVALID_ARGUMENT", `Name must be 1-${ACCESS_TOKEN_NAME_MAX_LENGTH} characters`);
    }
    const scopes = Array.isArray(input.scopes) ? input.scopes.join(",") : "";
    if (scopes !== "read" && scopes !== "read,write") {
      throw failure("INVALID_ARGUMENT", "Scopes must be read, or read and write");
    }
    if (!(ACCESS_TOKEN_EXPIRY_DAYS as readonly number[]).includes(input.expiresInDays)) {
      throw failure("INVALID_ARGUMENT", `expiresInDays must be one of ${ACCESS_TOKEN_EXPIRY_DAYS.join(", ")}`);
    }
    const now = Date.now();
    const recent = (this.createdAt.get(userId) ?? []).filter((at) => now - at < 60_000);
    if (recent.length >= CREATES_PER_MINUTE) {
      throw failure("RESOURCE_EXHAUSTED", "Too many access tokens created; try again later");
    }
    this.createdAt.set(userId, [...recent, now]);

    const secret = randomSecret();
    const token: AccessToken = {
      id: crypto.randomUUID(),
      name,
      tokenPrefix: secret.slice(0, SHOWN_PREFIX_LENGTH),
      scopes: scopes === "read" ? ["read"] : ["read", "write"],
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + input.expiresInDays * DAY).toISOString(),
      lastUsedAt: null,
    };
    this.tokens.set(userId, [...(this.tokens.get(userId) ?? []), token]);
    return { token: structuredClone(token), secret };
  }

  revoke(userId: string, tokenId: string): void {
    const current = this.tokens.get(userId) ?? [];
    if (!current.some((token) => token.id === tokenId)) throw failure("NOT_FOUND", "Access token not found");
    this.tokens.set(
      userId,
      current.filter((token) => token.id !== tokenId),
    );
  }
}
