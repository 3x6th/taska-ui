import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { taskaApi } from "../api/client";
import { RedirectSignedIn } from "../components/RedirectSignedIn";
import type { LoginRedirectState, RootRedirectState } from "../components/RequireSession";
import { DEFAULT_SIGNED_IN_ROUTE, RequireSession } from "../components/RequireSession";
import type { Theme } from "../hooks/useTheme";
import { useTheme } from "../hooks/useTheme";
import { BoardScreen } from "./BoardScreen";
import { LoginScreen } from "./LoginScreen";
import { NotFoundScreen } from "./NotFoundScreen";
import { ProjectsScreen } from "./ProjectsScreen";

export interface ScreenProps {
  theme: Theme;
  toggleTheme: () => void;
  onLogout: () => void;
  logoutPending: boolean;
}

export function App() {
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const logout = useMutation({
    mutationFn: () => taskaApi.logout(),
    onSuccess: () => {
      queryClient.clear();
      navigate("/login", { replace: true });
    },
  });
  const screenProps = {
    theme,
    toggleTheme,
    onLogout: () => logout.mutate(),
    logoutPending: logout.isPending,
  };

  const from = location.pathname + location.search;
  const onAuthRoute = location.pathname === "/login" || location.pathname === "/invite";

  useEffect(() => {
    // A session dies in one place — a 401 the refresh could not repair — so it
    // is answered in one place too, instead of every screen reading its own
    // error. Resubscribed on navigation so `from` is the page the user was
    // actually looking at at that moment.
    if (onAuthRoute) return;
    return taskaApi.onSessionExpired(() => {
      // Cached answers belong to a session that no longer exists.
      queryClient.clear();
      navigate("/login", { replace: true, state: { from, expired: true } satisfies LoginRedirectState });
    });
  }, [from, onAuthRoute, navigate, queryClient]);

  return (
    <Routes>
      {/* `bare` marks this as "opened the app", not "asked for the project
          list": both end up at /projects and only this redirect can tell them
          apart, so the guard reads the marker instead of guessing from the URL
          (RequireSession). */}
      <Route
        path="/"
        element={<Navigate to={DEFAULT_SIGNED_IN_ROUTE} replace state={{ bare: true } satisfies RootRedirectState} />}
      />
      <Route
        path="/login"
        element={
          <RedirectSignedIn>
            <LoginScreen {...screenProps} initialMode="signin" />
          </RedirectSignedIn>
        }
      />
      {/* Public on purpose: accepting an invitation has to work while signed in
          as somebody else. */}
      <Route path="/invite" element={<LoginScreen {...screenProps} initialMode="invite" />} />
      <Route
        path="/projects"
        element={
          <RequireSession>
            <ProjectsScreen {...screenProps} />
          </RequireSession>
        }
      />
      <Route
        path="/projects/:projectId/board"
        element={
          <RequireSession>
            <BoardScreen {...screenProps} />
          </RequireSession>
        }
      />
      <Route
        path="/projects/:projectId/issues/:issueId"
        element={
          <RequireSession>
            <BoardScreen {...screenProps} />
          </RequireSession>
        }
      />
      {/* An unknown URL is an answer, not a redirect: bouncing to /projects
          hid the typo and pretended the address was fine (DESIGN.md §4.18).
          It stays outside the guard for the same reason — a signed-out visitor
          asking for a page that does not exist gets told that, not a login
          form implying the page is behind one. */}
      <Route path="*" element={<NotFoundScreen />} />
    </Routes>
  );
}
