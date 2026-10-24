import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { taskaApi } from "../api/client";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { RedirectSignedIn } from "../components/RedirectSignedIn";
import type { LoginRedirectState } from "../components/RequireSession";
import { DEFAULT_SIGNED_IN_ROUTE, RequireSession } from "../components/RequireSession";
import type { Theme } from "../hooks/useTheme";
import { useTheme } from "../hooks/useTheme";
import { holdInviteToken, inviteTokenIn } from "../lib/inviteLink";
import { AdminAuditSection } from "./admin/AdminAuditSection";
import { AdminDataSection } from "./admin/AdminDataSection";
import { AdminEventsProblems } from "./admin/AdminEventsProblems";
import { AdminEventsSection } from "./admin/AdminEventsSection";
import { AdminOutboxSection } from "./admin/AdminOutboxSection";
import { AdminScreen } from "./admin/AdminScreen";
import { AdminSectionPlaceholder } from "./admin/AdminSectionPlaceholder";
import { AdminUsersSection } from "./admin/AdminUsersSection";
import { adminSections } from "./admin/sections";
import { AppFailureScreen } from "./AppFailureScreen";
import { BoardScreen } from "./BoardScreen";
import { IssueKeyScreen } from "./IssueKeyScreen";
import { LoginScreen } from "./LoginScreen";
import { NotFoundScreen } from "./NotFoundScreen";
import { ProjectsScreen } from "./ProjectsScreen";
import { SettingsAppearanceSection } from "./settings/SettingsAppearanceSection";
import { SettingsProfileSection } from "./settings/SettingsProfileSection";
import { SettingsScreen } from "./settings/SettingsScreen";
import { SettingsTokensSection } from "./settings/SettingsTokensSection";

export interface ScreenProps {
  theme: Theme;
  toggleTheme: () => void;
  onLogout: () => void;
  logoutPending: boolean;
}

export function App() {
  const { theme, setTheme, toggleTheme } = useTheme();
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
  // An invitation link that reached a running app (DESIGN.md §4.27): on the
  // hash build, `#/invite?token=…` typed or pasted into this tab is a hash
  // change, not a page load, so `captureInviteLink` in main.tsx never sees it
  // and the router does. Held and taken out of the address the same way, on
  // any path. The first render under it does no harm: every route reads it as
  // an unknown parameter, and the replace lands before anything is asked.
  const routedInviteToken = inviteTokenIn({ search: location.search, hash: "" });

  useEffect(() => {
    if (routedInviteToken === null) return;
    holdInviteToken(routedInviteToken);
    navigate("/invite", { replace: true });
  }, [routedInviteToken, navigate]);

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
    // Around every route and outside every shell (TAS-173): a page that throws
    // while rendering becomes one screen that says so, rather than a blank tab.
    // A new address tries the routes again — the reader may have moved on with
    // Back — and the screen itself offers a full navigation out.
    <ErrorBoundary fallback={(error) => <AppFailureScreen error={error} />} resetKey={location.pathname}>
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
        {/* Public on purpose: the link may be opened under somebody else's
            session. Activating signs out of it first and opens none of its own
            (DESIGN.md §4.27). */}
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
        {/* The short address of an issue, by its key (TAS-246). Behind the guard
            like the issue route it resolves into: a signed-out visitor is sent
            to sign in and comes back here, and the key is looked up only once
            there is somebody to look it up for. */}
        <Route
          path="/browse/:issueKey"
          element={
            <RequireSession>
              <IssueKeyScreen />
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
          {/* The Events section has two views under one section head (§5.8), so
              the head is a layout route and each view is a child of it: the
              Problems / Outbox switch is then rendered once and `aria-current`
              comes from the router rather than from a component asserting it.
              Problems is the index — the section opens on the summary, and there
              is no redirect because the summary *is* the root. */}
          <Route path="/admin/events" element={<AdminEventsSection />}>
            <Route index element={<AdminEventsProblems />} />
            {/* The service is optional so that `/admin/events/outbox` is a real
                address: it resolves into the first service with an outbox and
                redirects there, in the bar rather than silently. */}
            <Route path="/admin/events/outbox/:service?" element={<AdminOutboxSection />} />
            {/* One event of that journal, by its id — the same section with the
                card in place of the table. */}
            <Route path="/admin/events/outbox/:service/:id" element={<AdminOutboxSection />} />
          </Route>
          {/* The one section of this area that writes (§5.8). No child routes:
              an account is a row of a table the Data section already addresses,
              so there is nothing here a deeper address would open — and the two
              writes are dialogs over the list rather than pages of their own. */}
          <Route path="/admin/users" element={<AdminUsersSection />} />
          {/* The audit log (TAS-251). No child routes: an entry has no id, so
              it opens in place under its row rather than at an address. */}
          <Route path="/admin/audit" element={<AdminAuditSection />} />
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
        {/* The reader's own settings (TAS-380, DESIGN.md §5.9): an area with
            sections like /admin, behind the session guard and open to every
            role. An address inside /settings that matches no section falls
            through to the `*` route below, as /admin's do. */}
        <Route
          path="/settings"
          element={
            <RequireSession>
              <SettingsScreen {...screenProps} setTheme={setTheme} />
            </RequireSession>
          }
        >
          <Route index element={<Navigate to="/settings/profile" replace />} />
          <Route path="/settings/profile" element={<SettingsProfileSection />} />
          <Route path="/settings/tokens" element={<SettingsTokensSection />} />
          <Route path="/settings/appearance" element={<SettingsAppearanceSection />} />
        </Route>
        {/* An unknown URL is an answer, not a redirect: bouncing to /projects
            hid the typo and pretended the address was fine (DESIGN.md §4.18).
            It stays outside the guard for the same reason — a signed-out visitor
            asking for a page that does not exist gets told that, not a login
            form implying the page is behind one. */}
        <Route path="*" element={<NotFoundScreen />} />
      </Routes>
    </ErrorBoundary>
  );
}
