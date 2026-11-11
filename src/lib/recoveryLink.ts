import type { RouterMode } from "./appLinks";

/**
 * The password-recovery link, from the address bar to the form (TAS-527,
 * api-contract-guard §3 and F2, the companies build only).
 *
 * The blueprint does not say what the link looks like (ask A99); the
 * backend's precedent is a configured page URL with `?token=` added
 * (`InvitationEmailQueue`), so this build — and the mock's mail — reads
 * `https://taska.ozero.dev/reset-password?token=<base64url>`: a real path at
 * the app's base, never a fragment. The Pages build routes by the hash, so its
 * router would never see that path, and the invitation capture would take the
 * `?token=` as an invitation's. So this runs first, **before the router mounts
 * and before `captureInviteLink`** (src/main.tsx), on that path only — and its
 * trailing-slash form, as `CALLBACK_PATHS` has — and the address becomes the
 * app's own `/reset-password` route, token-free.
 *
 * The token lives **in memory only**: not in the URL, where it would sit in
 * the history and in a copied link, not in storage and not in router state,
 * which the browser keeps across a reload. A reload therefore shows «Open the
 * link from your email again» — safe, because the link stays valid until it
 * is used. It is forgotten once the password is set, and once the server says
 * the link is dead.
 */

export const FORGOT_PASSWORD_ROUTE = "/forgot-password";
export const RESET_PASSWORD_ROUTE = "/reset-password";

let held: string | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

/** The token a link brought, while nothing has spent or dropped it. */
export function heldRecoveryToken(): string | null {
  return held;
}

/** For `useSyncExternalStore`: the form re-reads `heldRecoveryToken` when this fires. */
export function subscribeRecoveryToken(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function holdRecoveryToken(token: string): void {
  held = token;
  notify();
}

/** After the link was spent, or refused as dead: what it carried is no use to anybody now. */
export function forgetRecoveryToken(): void {
  if (held === null) return;
  held = null;
  notify();
}

/** The non-blank `token` of a query string, or `null`. */
export function recoveryTokenOf(query: string): string | null {
  const token = new URLSearchParams(query).get("token")?.trim();
  return token ? token : null;
}

/**
 * Where the address bar goes once the token is out of it: the app's
 * `/reset-password` route under the build's scheme and base. Pure, so both
 * schemes are testable without building the app twice.
 */
export function recoveryRouteUrl(base: string, mode: RouterMode): string {
  const root = base.endsWith("/") ? base : `${base}/`;
  return mode === "hash" ? `${root}#${RESET_PASSWORD_ROUTE}` : `${root}${RESET_PASSWORD_ROUTE.slice(1)}`;
}

/** The browser objects `captureRecoveryLink` touches, so a test can stand in for them. */
export interface RecoveryLandingWindow {
  location: Pick<Location, "pathname" | "search">;
  history: Pick<History, "replaceState">;
}

/**
 * Called once, before the router mounts and before the invitation's capture.
 * Answers whether the page landed on the recovery path. On it, whatever the
 * query holds, the address becomes the in-app route — with nothing held when
 * no token came, which the page answers with «Open the link from your email
 * again». `replaceState`, not a navigation: the entry the link made simply
 * stops saying what it said.
 */
export function captureRecoveryLink(page: RecoveryLandingWindow, base: string, mode: RouterMode): boolean {
  const root = base.endsWith("/") ? base : `${base}/`;
  const path = `${root}${RESET_PASSWORD_ROUTE.slice(1)}`;
  if (page.location.pathname !== path && page.location.pathname !== `${path}/`) return false;
  const token = recoveryTokenOf(page.location.search);
  if (token !== null) holdRecoveryToken(token);
  page.history.replaceState(null, "", recoveryRouteUrl(base, mode));
  return true;
}
