import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { taskaApi } from "../api/client";
import { RedirectSignedIn } from "../components/RedirectSignedIn";
import type { LoginRedirectState } from "../components/RequireSession";
import { DEFAULT_SIGNED_IN_ROUTE, RequireSession } from "../components/RequireSession";
import type { Theme } from "../hooks/useTheme";
import { useTheme } from "../hooks/useTheme";
import { AdminDataSection } from "./admin/AdminDataSection";
import { AdminScreen } from "./admin/AdminScreen";
import { AdminSectionPlaceholder } from "./admin/AdminSectionPlaceholder";
import { adminSections } from "./admin/sections";
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
      <Route path="/" element={<Navigate to={DEFAULT_SIGNED_IN_ROUTE} replace />} />
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
      {/* Behind the session guard like any other private page; who may actually
          see it is decided inside the screen, which answers a non-admin with
          the not-found screen rather than confirming the area exists.

          An area with sections rather than a screen (DESIGN.md §5.8), so the
          shell — gate, top bar, rail, section heading — is the parent route and
          each section is a child of it. An address inside /admin that matches
          no section falls through to the `*` route below and gets the
          full-screen answer, which is why there is no catch-all here. */}
      <Route
        path="/admin"
        element={
          <RequireSession>
            <AdminScreen {...screenProps} />
          </RequireSession>
        }
      >
        <Route index element={<Navigate to="/admin/data" replace />} />
        {/* The service and the table are optional so that `/admin/data` is a
            real address: it resolves to the catalog's first table and redirects
            into it, in the bar rather than silently. */}
        <Route path="/admin/data/:service?/:table?" element={<AdminDataSection />} />
        {/* One row of that table, by its primary key (§5.8). The same section:
            the card replaces the table in the body while the rail and the
            catalog column stay, so this is a deeper address rather than another
            screen. */}
        <Route path="/admin/data/:service/:table/:id" element={<AdminDataSection />} />
        {/* Every section is drawn, including the ones with no endpoints yet
            (§4.19) — the shape of the area is itself information. */}
        {adminSections
          .filter((section) => section.stories.length > 0)
          .map((section) => (
            <Route
              key={section.id}
              path={section.path}
              element={<AdminSectionPlaceholder section={section} />}
            />
          ))}
      </Route>
      {/* An unknown URL is an answer, not a redirect: bouncing to /projects
          hid the typo and pretended the address was fine (DESIGN.md §4.18).
          It stays outside the guard for the same reason — a signed-out visitor
          asking for a page that does not exist gets told that, not a login
          form implying the page is behind one. */}
      <Route path="*" element={<NotFoundScreen />} />
    </Routes>
  );
}
