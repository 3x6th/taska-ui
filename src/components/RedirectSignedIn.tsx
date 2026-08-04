import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { taskaApi } from "../api/client";
import { DEFAULT_SIGNED_IN_ROUTE } from "./RequireSession";

/**
 * The mirror of `RequireSession`: a visitor who already holds a session has no
 * business on the login form, so `/login` sends them on to their projects.
 *
 * Wraps `/login` only. `/invite` stays reachable while signed in, because
 * accepting an invitation as somebody else is a real thing to do.
 */
export function RedirectSignedIn({ children }: { children: ReactNode }) {
  if (taskaApi.hasSession()) {
    return <Navigate to={DEFAULT_SIGNED_IN_ROUTE} replace />;
  }

  return children;
}
