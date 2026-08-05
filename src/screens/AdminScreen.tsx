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
    // `.page-shell` alone: the page background and nothing on it. Drawing
    // nothing is right for the eye and wrong for a screen reader, which would
    // otherwise be told nothing at all — `aria-busy` on an empty landmark
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
      <section className="admin-page">
        {/* One block child, so the 980 column centres structurally and every
            child — including inline-level ones like the link below — starts on
            the same x as the project list's heading. */}
        <div>
          <h1>Administration</h1>
          <AdminBody />
          {/* The way out lives in the shell, not in the body TAS-155 replaces:
              the logo is not a link and the top bar carries no back control, so
              swapping the body would otherwise leave this screen with no route
              back into the app. */}
          <Link to="/projects" className="secondary-button admin-back">
            Back to projects
          </Link>
        </div>
      </section>
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
    <p>
      This section is still being built. There is nothing to administer here yet — the read-only view of the
      platform&rsquo;s data lands in a later change.
    </p>
  );
}
