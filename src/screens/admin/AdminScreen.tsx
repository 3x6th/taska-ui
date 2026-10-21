import { useQuery } from "@tanstack/react-query";
import { Outlet, useLocation } from "react-router-dom";
import { taskaApi } from "../../api/client";
import { SectionArea } from "../../components/SectionArea";
import { ThemeToggle } from "../../components/ThemeToggle";
import { TopBar } from "../../components/TopBar";
import type { ScreenProps } from "../App";
import { NotFoundScreen } from "../NotFoundScreen";
import { adminSections, sectionForPath } from "./sections";

/**
 * The administration area (`/admin`, DESIGN.md §5.8) — not a screen but a shell
 * with sections: the rail on the left, the section's own body in the outlet.
 * It stays inside the app shell (§5.1); only the body below the top bar changes.
 *
 * Most of what lives here only reads, and the sections that do say so with the
 * `read-only` marker below; Users is the exception since TAS-186, and blocking
 * an account is its whole point. The role gate below hides the area, it does
 * not protect it. The server does that — `/api/v1/readonly/*` and
 * `/api/v1/admin/*` are both `GLOBAL_ADMIN`-only and both enumerate 401/403 —
 * so the sections render whatever the gateway answers rather than assuming a
 * refusal cannot arrive.
 */
export function AdminScreen({ theme, toggleTheme, onLogout, logoutPending }: ScreenProps) {
  const location = useLocation();
  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => taskaApi.getCurrentUser(),
  });

  // `/admin` itself renders for the single tick before its index route
  // redirects into `/admin/data`, and captioning that tick with nothing would
  // make the heading flicker.
  const section = sectionForPath(location.pathname) ?? adminSections[0];

  // Deciding before `me` settles would flash Page not found on every single
  // load of this area, admins included. Nothing is drawn until the answer is
  // in — not even the top bar, because showing the shell first and replacing it
  // with the not-found screen is the same "a second of plausible chrome" that
  // DESIGN.md §4.18 exists to avoid.
  if (meQuery.isPending) {
    // Drawing nothing is right for the eye and wrong for a screen reader, which
    // would otherwise be told nothing at all — `aria-busy` on an empty landmark
    // announces nothing — so the status text goes out of sight, not out of the
    // accessibility tree.
    return (
      <main className="page-shell" aria-busy="true">
        <p className="visually-hidden" role="status">
          Loading
        </p>
      </main>
    );
  }

  // Not an admin — and an account whose role the server never stated is not an
  // admin either (docs/ai/API-DIVERGENCE.md), same for a profile that failed to
  // load at all. The answer is the one an unknown URL gets, so this area's
  // existence is not confirmed to someone who cannot use it (§4.18). One gate
  // for the whole area, not one per section.
  if (meQuery.data?.globalRole !== "GLOBAL_ADMIN") {
    return <NotFoundScreen />;
  }

  return (
    <main className="page-shell">
      <TopBar
        right={<ThemeToggle theme={theme} onToggle={toggleTheme} />}
        user={meQuery.data}
        userLoading={meQuery.isPending}
        loggingOut={logoutPending}
        onLogout={onLogout}
      />
      {/* The rail, its exit and the heading are the shared area recipe
          (`SectionArea`, TAS-380), which Settings draws too. */}
      <SectionArea
        aside={
          // Not a request state and not decoration: it says this section only
          // reads, and two sections have now left it — Users writes since
          // TAS-186, Events since TAS-194 — while Data still carries it. That
          // they leave one at a time is exactly why it is a field on the
          // section rather than a fixture of the shell.
          section.readOnly ? <p className="admin-readonly">read-only</p> : null
        }
        current={section}
        name="Administration"
        sections={adminSections}
      >
        <Outlet />
      </SectionArea>
    </main>
  );
}
