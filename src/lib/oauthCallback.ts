import type { RouterMode } from "./appLinks";

/**
 * The provider sign-in's return, from the address bar to the exchange
 * (TAS-426, DESIGN.md §4.31).
 *
 * The gateway's callback sends the browser to `/auth/callback?code=…` or
 * `/auth/callback?error=…` **at the root of the UI's origin** — it drops the
 * base path, whatever the build's — with a one-time code that lives 60
 * seconds. On GitHub Pages that path is a copy of `index.html` in
 * `dist/auth/callback/` (vite.config.ts), which Pages answers with a 301 to
 * `/auth/callback/?code=…`, query kept, then 200. The Pages build routes by
 * the hash, so its router would never see the path: the code is taken out
 * here, **before the router mounts and before any request** (`captureOAuthCallback`,
 * called from src/main.tsx), and the address becomes the app's own
 * `/auth/callback` route, code-free.
 *
 * Only on that path — `?code=` anywhere else is somebody else's parameter —
 * and only into memory: not the URL, where it would sit in the session
 * history, and not storage. `error` wins over `code` when an edited address
 * carries both; the backend never sends the two together.
 *
 * `replaceState` rewrites the entry, so Back does not return to the code. A
 * provider's own pages in between are entries of their own, and what they
 * keep is theirs; the code is in none of them, as it is made after them.
 */

/** A callback refusal and its display metadata, held only until the login handoff (TAS-457). */
export interface OAuthCallbackError {
  error: string;
  requestId: string | null;
  retryAfterSeconds: number | null;
}

/** What the address brought: a code to exchange, a refusal, or nothing usable. */
export type HeldOAuthCallback = { code: string } | OAuthCallbackError | null;

let held: HeldOAuthCallback = null;

/** The two paths the landing answers on: the file, and Pages' directory redirect to it. */
const CALLBACK_PATHS: ReadonlySet<string> = new Set(["/auth/callback", "/auth/callback/"]);

/** What a landing brought, while nothing has spent or dropped it. Peeked, never taken: StrictMode reads twice. */
export function heldOAuthCallback(): HeldOAuthCallback {
  return held;
}

export function holdOAuthCallback(value: HeldOAuthCallback): void {
  held = value;
}

/** After the code was exchanged, or the refusal shown: what it carried is no use to anybody now. */
export function forgetOAuthCallback(): void {
  held = null;
}

/**
 * The address bar once the code is out of it: the app's `/auth/callback`
 * route under the build's scheme and base. Pure, so both schemes are testable
 * without building the app twice.
 */
export function oauthCallbackRouteUrl(base: string, mode: RouterMode): string {
  const root = base.endsWith("/") ? base : `${base}/`;
  return mode === "hash" ? `${root}#/auth/callback` : `${root}auth/callback`;
}

/** The browser objects `captureOAuthCallback` touches, so a test can stand in for them. */
export interface CallbackLandingWindow {
  location: Pick<Location, "pathname" | "search">;
  history: Pick<History, "replaceState">;
}

/** Query waits are whole positive seconds, never a partial parse or a rounded unsafe integer. */
function callbackRetryAfter(value: string | null): number | null {
  if (value === null || !/^[1-9][0-9]*$/.test(value)) return null;
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : null;
}

/**
 * Called once, before the router mounts. Answers whether the page landed on
 * the callback path. On it, whatever the query holds, the address becomes the
 * in-app route — with nothing held when neither `code` nor `error` came, which
 * the callback screen answers by going to sign-in.
 */
export function captureOAuthCallback(page: CallbackLandingWindow, base: string, mode: RouterMode): boolean {
  if (!CALLBACK_PATHS.has(page.location.pathname)) return false;
  const query = new URLSearchParams(page.location.search);
  const error = query.get("error");
  const code = query.get("code");
  holdOAuthCallback(
    error !== null
      ? {
          error,
          requestId: query.get("requestId") || null,
          retryAfterSeconds: callbackRetryAfter(query.get("retryAfter")),
        }
      : code ? { code } : null,
  );
  page.history.replaceState(null, "", oauthCallbackRouteUrl(base, mode));
  return true;
}

/**
 * The exchange in flight, by code (guard B1). The server claims a code
 * atomically, so a second request for it is not a retry but a guaranteed
 * refusal that would replace the session the first one made — and React gives
 * it every chance to happen: StrictMode runs the effect twice, a remount runs
 * it again. One promise per code, module-level so it outlives any component,
 * dropped once it settles: by then the code is spent and nobody holds it.
 */
let flight: { code: string; promise: Promise<unknown> } | null = null;

export function exchangeOnce<T>(code: string, exchange: (code: string) => Promise<T>): Promise<T> {
  if (flight !== null && flight.code === code) return flight.promise as Promise<T>;
  const promise = exchange(code);
  const current = { code, promise };
  flight = current;
  const settle = () => {
    if (flight === current) flight = null;
  };
  promise.then(settle, settle);
  return promise;
}

/**
 * `sessionStorage` `taska.oauthAttempt` (DESIGN.md §4.31): which provider a
 * press started and from which tab, so the return can name the provider and
 * a refusal lands on the tab the reader left from — and the page the press
 * was to come back to, so a refusal that lands on `/login` still remembers
 * it for the next sign-in. Per tab, as the attempt is. Every access is
 * guarded — storage may be refused outright — and a value that is not the
 * shape is no attempt at all.
 */
export const OAUTH_ATTEMPT_KEY = "taska.oauthAttempt";

export interface OAuthAttempt {
  provider: string;
  tab: string;
  /** The `returnTo` the start was sent; `null` when an attempt stored without one is read back. */
  returnTo: string | null;
}

export function rememberOAuthAttempt(attempt: OAuthAttempt): void {
  try {
    window.sessionStorage.setItem(OAUTH_ATTEMPT_KEY, JSON.stringify(attempt));
  } catch {
    // Nowhere to keep it: the return then speaks without the provider's name.
  }
}

export function readOAuthAttempt(): OAuthAttempt | null {
  try {
    const raw = window.sessionStorage.getItem(OAUTH_ATTEMPT_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { provider, tab, returnTo } = parsed as Record<string, unknown>;
    if (typeof provider !== "string" || typeof tab !== "string") return null;
    return { provider, tab, returnTo: typeof returnTo === "string" ? returnTo : null };
  } catch {
    return null;
  }
}

export function forgetOAuthAttempt(): void {
  try {
    window.sessionStorage.removeItem(OAUTH_ATTEMPT_KEY);
  } catch {
    // Nothing to forget.
  }
}
