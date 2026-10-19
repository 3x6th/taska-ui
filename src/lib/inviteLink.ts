import type { RouterMode } from "./appLinks";

/**
 * The invitation link, from the address bar to the form (TAS-208, DESIGN.md
 * §4.27).
 *
 * The email carries `<accept-url>?token=<43 characters>` — a query, never a
 * fragment: notification-service refuses an accept URL with a `#` in it at
 * startup (`InvitationEmailQueue`, backend #204). The Pages build routes by the
 * hash, so on `https://taska.ozero.dev/?token=…` the router sees `/` and the
 * token sits in `location.search` where no route reads it. So it is taken out
 * **before the router mounts** (`captureInviteLink`, called from
 * src/main.tsx), in either router mode and on any path, and the address is
 * replaced with the `/invite` route, token-free. A token in the query *inside*
 * the hash (`#/invite?token=…`) is taken the same way; one that arrives there
 * after the app is running — a hash change does not reload the page — is the
 * router's to see, and `App` hands it here.
 *
 * The token then lives **in memory only**: not in the URL, where it would sit
 * in the history and in every copied link, and not in router state, which the
 * browser keeps across a reload. A reload therefore shows the token field
 * again, which §4.27 accepts.
 */

let held: string | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

/** The token a link brought, while nothing has spent or dropped it. */
export function heldInviteToken(): string | null {
  return held;
}

/** For `useSyncExternalStore`: the form re-reads `heldInviteToken` when this fires. */
export function subscribeInviteToken(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function holdInviteToken(token: string): void {
  held = token;
  notify();
}

/** After the link has been spent: what it carried is no use to anybody now. */
export function forgetInviteToken(): void {
  if (held === null) return;
  held = null;
  notify();
}

/**
 * The non-blank `token` of a query string, or `null`. `URLSearchParams` decodes
 * it, which is right: the token is unpadded base64url, and nothing in it needs
 * encoding in the first place.
 */
function tokenOf(query: string): string | null {
  const token = new URLSearchParams(query).get("token")?.trim();
  return token ? token : null;
}

/** The query part of a hash route — `#/invite?token=x` → `?token=x`. */
function hashQuery(hash: string): string {
  const at = hash.indexOf("?");
  return at < 0 ? "" : hash.slice(at);
}

/** The token a location carries, in its own query first and then in the query inside its hash. */
export function inviteTokenIn(location: Pick<Location, "search" | "hash">): string | null {
  return tokenOf(location.search) ?? tokenOf(hashQuery(location.hash));
}

/**
 * Where the address bar goes once the token is out of it: the app's `/invite`
 * route under the build's own scheme and base, and nothing else — the email
 * link carries no other parameter, so there is nothing else to keep. Pure, so
 * both schemes are testable without building the app twice.
 */
export function inviteRouteUrl(base: string, mode: RouterMode): string {
  const root = base.endsWith("/") ? base : `${base}/`;
  return mode === "hash" ? `${root}#/invite` : `${root}invite`;
}

/** The two browser objects `captureInviteLink` touches, so a test can stand in for both. */
export interface LandingWindow {
  location: Pick<Location, "search" | "hash">;
  history: Pick<History, "replaceState">;
}

/**
 * Called once, before the router mounts. Answers whether a token was taken.
 * `replaceState`, not a navigation: the page is already loaded, and the entry
 * the link created should simply stop saying what it said.
 */
export function captureInviteLink(page: LandingWindow, base: string, mode: RouterMode): boolean {
  const token = inviteTokenIn(page.location);
  if (token === null) return false;
  holdInviteToken(token);
  page.history.replaceState(null, "", inviteRouteUrl(base, mode));
  return true;
}

/**
 * What the token field makes of what was typed or pasted (§4.27): a whole
 * invitation link gives up its token, from its query or from the query inside
 * its hash; anything else is taken as the token itself, trimmed. Without this a
 * pasted link would reach the server as a 300-character token and come back
 * "Invite token is too long" — about the format, not about the link.
 */
export function inviteTokenFromInput(value: string): string {
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed);
    return inviteTokenIn(url) ?? trimmed;
  } catch {
    return trimmed;
  }
}
