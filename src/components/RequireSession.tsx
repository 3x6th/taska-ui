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
    // A bare visit to "/" lands here too, as the /projects it redirects into,
    // and needs no special case: /projects is where a visitor with nothing
    // specific in mind goes anyway, so returning them there is the same
    // destination under a different name.
    const from = location.pathname + location.search;
    return <Navigate to="/login" replace state={{ from } satisfies LoginRedirectState} />;
  }

  return children;
}
