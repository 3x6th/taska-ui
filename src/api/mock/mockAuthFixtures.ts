import type { AuthMethods, OAuthProvider } from "../../domain/types";

/**
 * The knobs and the fake provider behind the mock's sign-up and provider
 * sign-in (TAS-426). Nothing here is on `TaskaApi`: the e2e suite sets the
 * knobs with `page.addInitScript` before the app loads, and a person clicking
 * through the mock sets them in the console. Every value is read at the moment
 * it is needed, so a knob changed between the button's paint and the exchange
 * behaves as a server reconfigured in between would.
 */

/**
 * `localStorage` key for what `GET /auth/methods` answers in mock mode, as the
 * server's JSON (`{"signupEnabled":true,"providers":["GOOGLE"]}`). Unset or
 * unreadable — every path open, which is what the mock is for. **The stand is
 * the opposite**: it answered `{signupEnabled: false, providers: []}` on
 * 2026-10-27 (request 0685d758-b210-4241-bbbc-6196c3792d16), and the specs that
 * pin today's screen set exactly that.
 */
export const MOCK_AUTH_METHODS_KEY = "taska.mockAuthMethods";

/**
 * `localStorage` key for who the fake provider says the reader is, as JSON:
 * `{"email":"leo@example.com","name":"Leo F.","error":"PROVIDER_CANCELLED"}`,
 * every field optional. `email` is the verified address the provider vouches
 * for (Anna when unset); `name` the name it offers for the name step; `error`
 * the reason the gateway's callback would put on `?error=` instead of a code —
 * the provider's own refusals (`PROVIDER_CANCELLED`, `EMAIL_NOT_VERIFIED`,
 * `PROVIDER_UNAVAILABLE`, `STATE_INVALID`) or any other string, which the
 * screen must not print.
 */
export const MOCK_OAUTH_IDENTITY_KEY = "taska.mockOAuth";

/**
 * `sessionStorage` key holding the codes already exchanged in this tab, so a
 * code is single use across page loads as the server's is: opening the same
 * callback address again is refused like a code used twice. The server also
 * refuses one older than 60 seconds; **this one never expires** — the code
 * carries no time, and its one 401 reads the same for both causes.
 */
export const MOCK_OAUTH_CLAIMED_KEY = "taska.mockOAuthClaimed";

/**
 * Text in an address or a name that makes the mock answer as a limit would.
 * The same seam as `MOCK_PROJECT_TRIGGERS`: something a reader can type,
 * nothing on `TaskaApi`. The server's limits themselves — 10 sign-up requests
 * an hour per IP, 240 provider attempts an hour per IP shared by start,
 * callback, exchange and sign-up — are **not modelled**; only their answers
 * are.
 */
export const MOCK_AUTH_TRIGGERS = {
  /** In a sign-up address (`someone+ip-budget@example.com`): the IP's hourly budget is spent, 429. */
  signupIpBudget: "+ip-budget",
  /** In the provider's address: the exchange meets the shared attempt budget, 429, and the code is not spent. */
  oauthBudget: "+oauth-budget",
  /** In the name sent from the name step: the same budget, 429, and the step's token is not spent. */
  oauthSignupBudget: "[oauth budget]",
} as const;

const ALL_PROVIDERS: readonly OAuthProvider[] = ["GOOGLE", "GITHUB", "APPLE"];

const isProvider = (value: unknown): value is OAuthProvider =>
  typeof value === "string" && (ALL_PROVIDERS as readonly string[]).includes(value);

/** Storage that may be missing or refuse access (a sandboxed frame, a locked-down profile): never a throw. */
function readStorage(storage: () => Storage, key: string): string | null {
  try {
    return storage().getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(storage: () => Storage, key: string, value: string): void {
  try {
    storage().setItem(key, value);
  } catch {
    // Nothing to remember it in; the mock simply forgets.
  }
}

const local = () => window.localStorage;
const session = () => window.sessionStorage;

/** What the mock's `GET /auth/methods` answers, narrowed as the REST mapper narrows the server's. */
export function readMockAuthMethods(): AuthMethods {
  const raw = readStorage(local, MOCK_AUTH_METHODS_KEY);
  if (raw === null) return { signupEnabled: true, providers: ALL_PROVIDERS };
  try {
    const parsed: unknown = JSON.parse(raw);
    const record = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
    const listed = Array.isArray(record.providers) ? record.providers : [];
    const providers: OAuthProvider[] = [];
    for (const item of listed) if (isProvider(item) && !providers.includes(item)) providers.push(item);
    return { signupEnabled: record.signupEnabled === true, providers };
  } catch {
    return { signupEnabled: true, providers: ALL_PROVIDERS };
  }
}

export interface MockOAuthIdentity {
  email: string;
  name: string | null;
  error: string | null;
}

/** Who the fake provider vouches for; Anna, signed in as every spec signs in, when nothing says otherwise. */
export function readMockOAuthIdentity(): MockOAuthIdentity {
  const fallback: MockOAuthIdentity = { email: "anna@example.com", name: null, error: null };
  const raw = readStorage(local, MOCK_OAUTH_IDENTITY_KEY);
  if (raw === null) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    const record = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
    return {
      email: typeof record.email === "string" ? record.email : fallback.email,
      name: typeof record.name === "string" ? record.name : null,
      error: typeof record.error === "string" ? record.error : null,
    };
  } catch {
    return fallback;
  }
}

/** Whether a code with this nonce was already exchanged in this tab. */
export function isMockOAuthCodeClaimed(nonce: string): boolean {
  const raw = readStorage(session, MOCK_OAUTH_CLAIMED_KEY);
  if (raw === null) return false;
  try {
    const claimed: unknown = JSON.parse(raw);
    return Array.isArray(claimed) && claimed.includes(nonce);
  } catch {
    return false;
  }
}

export function claimMockOAuthCode(nonce: string): void {
  const raw = readStorage(session, MOCK_OAUTH_CLAIMED_KEY);
  let claimed: unknown[] = [];
  try {
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    if (Array.isArray(parsed)) claimed = parsed;
  } catch {
    claimed = [];
  }
  writeStorage(session, MOCK_OAUTH_CLAIMED_KEY, JSON.stringify([...claimed, nonce]));
}

/**
 * What the fake provider's code carries. The server's is 43 random characters
 * pointing at a grant it keeps for 60 seconds; this store forgets everything
 * on a page load — and the callback *is* a page load — so the grant travels in
 * the code itself. No time is in it.
 */
export interface MockOAuthGrant {
  /** A fresh value per attempt, so two attempts as the same person are two codes. */
  nonce: string;
  provider: OAuthProvider;
  email: string;
  name: string | null;
  returnTo: string;
}

const toBase64Url = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const fromBase64Url = (text: string): Uint8Array | null => {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  try {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
};

export function encodeMockOAuthCode(grant: MockOAuthGrant): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(grant)));
}

/** The grant a code carries, or `null` for one this mock never made — the server's 401 `STATE_INVALID`. */
export function decodeMockOAuthCode(code: unknown): MockOAuthGrant | null {
  if (typeof code !== "string") return null;
  const bytes = fromBase64Url(code);
  if (bytes === null) return null;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (typeof parsed !== "object" || parsed === null) return null;
    const { nonce, provider, email, name, returnTo } = parsed as Record<string, unknown>;
    if (typeof nonce !== "string" || !nonce || !isProvider(provider) || typeof email !== "string") return null;
    if (typeof returnTo !== "string") return null;
    return { nonce, provider, email, name: typeof name === "string" ? name : null, returnTo };
  } catch {
    return null;
  }
}

/** A nonce for a code; `crypto.randomUUID` is missing on plain HTTP away from localhost. */
export function mockOAuthNonce(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    // fall through
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** The default the server stores for a `returnTo` it does not accept, and for none. */
export const MOCK_DEFAULT_RETURN_TO = "/projects";

/**
 * `OAuthUrls.returnTo` as the guard read it (backend develop `9fcf0253`): a
 * path that starts with `/` but not `//`, at most 1024 characters, that parses
 * as a relative URI with no authority, whose decoded path holds no `%` or `\`,
 * and with no `\` or control character anywhere. Anything else — or nothing —
 * silently becomes `/projects`. Approximated with the WHATWG parser where the
 * server uses `java.net.URI`; the two can disagree at the edges, and the
 * server decides.
 */
export function mockReturnTo(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 1024) return MOCK_DEFAULT_RETURN_TO;
  if (!value.startsWith("/") || value.startsWith("//")) return MOCK_DEFAULT_RETURN_TO;
  if (/[\\\p{Cc}]/u.test(value)) return MOCK_DEFAULT_RETURN_TO;
  try {
    const parsed = new URL(value, "http://mock.invalid");
    if (parsed.host !== "mock.invalid") return MOCK_DEFAULT_RETURN_TO;
    const path = decodeURIComponent(parsed.pathname);
    if (path.includes("%") || path.includes("\\")) return MOCK_DEFAULT_RETURN_TO;
  } catch {
    return MOCK_DEFAULT_RETURN_TO;
  }
  return value;
}
