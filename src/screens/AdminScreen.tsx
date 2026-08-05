import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { taskaApi } from "../api/client";
import { ThemeToggle } from "../components/ThemeToggle";
import { TopBar } from "../components/TopBar";
import type { ScreenProps } from "./App";
import { NotFoundScreen } from "./NotFoundScreen";

/**
 * The administration section (`/admin`). Today it is a shell around a
 * placeholder: TAS-155 replaces `AdminBody` with the read-only console, and
 * nothing above it should have to change for that.
 */
export function AdminScreen({ theme, toggleTheme, onLogout, logoutPending }: ScreenProps) {
  const meQuery = useQuery({ queryKey: ["me"], queryFn: () => taskaApi.getCurrentUser() });

  // Deciding before `me` settles would flash Page not found on every single
  // load of this screen, admins included. Nothing is drawn until the answer is
  // in — not even the top bar, because showing the shell first and replacing it
  // with the not-found screen is the same "a second of plausible chrome" that
  // DESIGN.md §4.18 exists to avoid.
  if (meQuery.isPending) {
    // `.page-shell` alone: the page background and nothing on it.
    return <main className="page-shell" aria-busy="true" />;
  }

  // Not an admin — and an account whose role the server never stated is not an
  // admin either (docs/ai/API-DIVERGENCE.md), same for a profile that failed to
  // load at all. The answer is the one an unknown URL gets, so this section's
  // existence is not confirmed to someone who cannot use it (§4.18).
  //
  // This is not the permission control. `/api/v1/readonly/*` is
  // GLOBAL_ADMIN-only and enumerates 401/403 in the contract; the server refuses
  // regardless of what this screen decides to render.
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
      <AdminBody />
    </main>
  );
}

/**
 * Deliberately short-lived: TAS-155 swaps this out for the read-only console.
 * It says what is true — the section exists and has nothing in it yet — and
 * invents no feature list, no counters, and no sample rows.
 */
function AdminBody() {
  return (
    <section className="admin-page">
      <h1>Administration</h1>
      <p>
        This section is still being built. There is nothing to administer here yet — the read-only view of the
        platform&rsquo;s data lands in a later change.
      </p>
      <Link to="/projects" className="secondary-button admin-back">
        Back to projects
      </Link>
    </section>
  );
}
