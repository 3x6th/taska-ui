/**
 * Absolute addresses of the app's own pages, built the way the running app
 * routes them — so a copied link opens where it was copied from (TAS-248).
 *
 * The app runs under two schemes, chosen at build time and nowhere else:
 *
 * - **hash** — the GitHub Pages build (`deploy-pages.yml` defaults
 *   `VITE_ROUTER_MODE` to `hash`). Pages serves one `index.html` and cannot
 *   rewrite deep paths to it, so the route lives after `#`, behind the base
 *   path: `https://taska.ozero.dev/#/browse/API-5`.
 * - **browser** — the dev server and the e2e server: the route is the path
 *   itself, `http://localhost:5173/browse/API-5`.
 *
 * `ROUTER_MODE` is what `src/main.tsx` picks the router by, so the router and
 * these links read one value and cannot disagree. The host is the page's own
 * origin and the base is Vite's `BASE_URL` — nothing here names a host.
 */
export type RouterMode = "hash" | "browser";

export const ROUTER_MODE: RouterMode = import.meta.env.VITE_ROUTER_MODE === "hash" ? "hash" : "browser";

export interface AppLocation {
  /** `window.location.origin`: scheme, host and port, no trailing slash. */
  origin: string;
  /** Vite's `BASE_URL`: the absolute path the app is served under, `/` or `/repo/`. */
  base: string;
  mode: RouterMode;
}

/**
 * The absolute URL of an in-app `route` (`/browse/API-5`) under `location`.
 * Pure, so both schemes are testable without building the app twice.
 *
 * In browser mode the base is kept as well. `BrowserRouter` takes no
 * `basename` today, so only a base of `/` actually routes in that mode — and
 * with `/` the two readings give the same string. Keeping the base is the
 * reading that stays right if the router is ever given one.
 */
export function absoluteAppUrl(route: string, { origin, base, mode }: AppLocation): string {
  const root = base.endsWith("/") ? base : `${base}/`;
  const path = route.startsWith("/") ? route : `/${route}`;
  return mode === "hash" ? `${origin}${root}#${path}` : `${origin}${root.slice(0, -1)}${path}`;
}

/** `absoluteAppUrl` for the page this code is running in. */
export function appUrl(route: string): string {
  return absoluteAppUrl(route, {
    origin: window.location.origin,
    base: import.meta.env.BASE_URL,
    mode: ROUTER_MODE,
  });
}

/** The short address of an issue, resolved by `IssueKeyScreen` (TAS-246). */
export function issueKeyRoute(issueKey: string): string {
  return `/browse/${encodeURIComponent(issueKey)}`;
}

/** The issue's own address: its board with the panel open. */
export function issueRoute(projectId: string, issueId: string): string {
  return `/projects/${projectId}/issues/${issueId}`;
}
