import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { taskaApi } from "../../api/client";
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
 * Read-only is the whole design of what lives here today: nothing writes, and
 * no control implies it could. The role gate below hides the area; it does not
 * protect it. The server does that — `/api/v1/readonly/*` is `GLOBAL_ADMIN`-only
 * and enumerates 401/403 — so the sections render whatever the gateway answers
 * rather than assuming a refusal cannot arrive.
 */
export function AdminScreen({ theme, toggleTheme, onLogout, logoutPending }: ScreenProps) {
  const location = useLocation();
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const lastSectionId = useRef<string | null>(null);
  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => taskaApi.getCurrentUser(),
  });

  // `/admin` itself renders for the single tick before its index route
  // redirects into `/admin/data`, and captioning that tick with nothing would
  // make the heading flicker.
  const section = sectionForPath(location.pathname) ?? adminSections[0];

  useEffect(() => {
    // Moving between sections replaces the whole body while the keyboard stays
    // wherever the rail left it, and a screen reader is told nothing at all —
    // so focus goes to the new section's heading (§7). Deliberately *not* on
    // every route change inside the area: choosing a table in the Data catalog
    // also changes the URL, and yanking focus out of the list on every arrow
    // press would make the catalog unusable from the keyboard.
    const previous = lastSectionId.current;
    lastSectionId.current = section.id;
    // Not on arrival: focus that moves before the user has done anything is a
    // jump they did not ask for.
    if (previous === null || previous === section.id) return;
    headingRef.current?.focus();
  }, [section]);

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
      <div className="admin-area">
        <nav aria-label="Administration" className="admin-rail">
          <ul>
            {adminSections.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.id}>
                  {/* NavLink rather than Link: it states `aria-current="page"`
                      from the match itself, so the rail cannot claim a section
                      the router is not showing. Prefix matching is what keeps
                      Data marked while a table is open. */}
                  <NavLink className="admin-rail-link" to={item.path}>
                    <Icon aria-hidden="true" size={15} />
                    {item.label}
                  </NavLink>
                </li>
              );
            })}
          </ul>
          {/* The way out of the area belongs to the area, not to whichever
              section happens to be open — which is why the button that used to
              sit under the content is gone (§5.8). */}
          <div className="admin-rail-foot">
            <Link className="admin-rail-link admin-rail-exit" to="/projects">
              <ArrowLeft aria-hidden="true" size={15} />
              Back to projects
            </Link>
          </div>
        </nav>

        <section aria-labelledby={headingId} className="admin-section">
          <header className="admin-section-head">
            {/* The area names itself, not only the section: «Data» on its own
                reads as one more product screen (§5.8). The crumb is text, not
                a link — `/admin` only redirects here. */}
            <p className="admin-crumb">
              Administration <span aria-hidden="true">›</span>
            </p>
            {/* tabIndex -1 so the effect above can put focus here; it is not in
                the tab order and never takes focus from a pointer. */}
            <h1 className="admin-section-title" id={headingId} ref={headingRef} tabIndex={-1}>
              {section.label}
            </h1>
            {/* Not a request state and not decoration: everything reachable
                from this area today only reads, and TAS-106/107/108 bring
                writing to Users and Events. The marker draws that line before
                the two get mixed, and leaves the section that gains writes. */}
            <p className="admin-readonly">read-only</p>
          </header>
          <Outlet />
        </section>
      </div>
    </main>
  );
}
