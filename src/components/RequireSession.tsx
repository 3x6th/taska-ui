import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { taskaApi } from "../api/client";

/** What the login screen is told about the navigation that sent the user there. */
export interface LoginRedirectState {
  /** The in-app path to return to after signing in. */
  from?: string;
  /** True when the user did not leave on their own — the session was rejected. */
  expired?: boolean;
}

/** Where a signed-in user goes when nothing more specific was requested. */
export const DEFAULT_SIGNED_IN_ROUTE = "/projects";

/**
 * Marks the redirect that `/` performs into the default route, so the guard can
 * tell "the visitor opened the app" from "the visitor asked for the project
 * list". The two arrive at the same URL and only the source knows which is which.
 */
export interface RootRedirectState {
  bare?: boolean;
}

/**
 * The private-route guard (DESIGN.md §5.1). Wraps every screen that needs a
 * session; `*` (Page not found) and `/invite` stay outside it on purpose.
 *
 * `hasSession()` is read during render rather than mirrored into state: it is a
 * synchronous read of the credentials this client holds, every navigation
 * re-renders, and a stale mirror is exactly how a signed-out user ends up
 * looking at an empty board. The server stays authoritative — this only decides
 * whether it is worth asking.
 */
export function RequireSession({ children }: { children: ReactNode }) {
  const location = useLocation();

  if (!taskaApi.hasSession()) {
    // A bare visit to the app root lands here too, and sending `from` for it
    // would make "/" claim the user asked for a particular page. Only the root
    // redirect knows it is one, so it says so in `state` — a typed or linked
    // /projects keeps its explanation, which matters because /projects is where
    // the Not-found screen's own primary action points.
    const bare = (location.state as RootRedirectState | null)?.bare === true;
    const requested = location.pathname + location.search;
    const from = bare ? undefined : requested;
    return <Navigate to="/login" replace state={{ from } satisfies LoginRedirectState} />;
  }

  return children;
}
