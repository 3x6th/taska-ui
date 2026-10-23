import { useId, useRef, useState, type MouseEvent } from "react";
import { LogOut, Settings, ShieldCheck } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import type { User } from "../domain/types";
import { useDismissOnOutside } from "../hooks/useDismissOnOutside";
import { useMeta } from "../hooks/useMeta";
import { globalRoleLabel, userStatusLabel } from "../lib/format";
import { Avatar } from "./Avatar";

interface UserProfileMenuProps {
  user?: User;
  loading?: boolean;
  loggingOut?: boolean;
  onLogout: () => void;
}

/** Whether `pathname` is inside the area at `root` — the area itself or any of its sections. */
const insideArea = (pathname: string, root: string) => pathname === root || pathname.startsWith(`${root}/`);

export function UserProfileMenu({ user, loading = false, loggingOut = false, onLogout }: UserProfileMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverId = useId();
  const location = useLocation();
  const meta = useMeta();
  // The entry exists only for an account the server called GLOBAL_ADMIN. A
  // gateway that states no role counts as not an admin, which is lossy in the
  // safe direction (docs/ai/API-DIVERGENCE.md).
  const isGlobalAdmin = user?.globalRole === "GLOBAL_ADMIN";

  // Escape and a press outside, from the hook the notifications popover and the
  // global search dropdown share (§4.16, §7). This used to be the only copy in
  // the product, which is exactly why the other two shipped without it. Escape
  // hands focus back to the trigger (TAS-380): the row that had it went with
  // the popover.
  useDismissOnOutside(open, rootRef, () => setOpen(false), triggerRef);

  /**
   * A plain click on one of the two link rows closes the popover. A modified
   * click opens the page in a new tab and leaves this one as it is, so the
   * menu it was opened from stays open.
   *
   * Closing the popover unmounts the item that had focus, so it goes back to
   * the trigger (§7). What this actually covers is the case where no route
   * change follows — opening the menu while already on that page and choosing
   * it again. On a real navigation the route swap unmounts this trigger a tick
   * later and focus ends up on <body> anyway; that is true of every in-app
   * link, not of these rows, and is recorded in docs/ai/BACKLOG.md rather than
   * patched here.
   */
  const followLink = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    setOpen(false);
    triggerRef.current?.focus();
  };

  const person = user;

  return (
    <div className="user-profile-menu" ref={rootRef}>
      <button
        aria-controls={open ? popoverId : undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={user ? `Open profile for ${user.displayName}` : "Open profile"}
        className="user-profile-trigger"
        // Enabled as soon as the query settles, whether or not it produced a
        // user. Requiring `user` meant that a profile which failed to load —
        // a 5xx, a network drop, a CORS refusal, none of which clear the
        // tokens — took Log out down with it, and with /login bouncing anyone
        // holding tokens the only way out was to clear site data.
        disabled={loading}
        onClick={() => setOpen((value) => !value)}
        ref={triggerRef}
        type="button"
      >
        <Avatar user={person} label="Current user" loading={loading} size="md" />
      </button>

      {open ? (
        <section aria-label="Current user profile" className="user-profile-popover" id={popoverId} role="dialog">
          {person ? (
            <>
              <header className="user-profile-head">
                <Avatar user={person} size="lg" />
                <div>
                  <strong>{person.displayName}</strong>
                  {/* The address the account signs in with and the one thing
                      a namesake cannot share (§4.16, TAS-389): whole, never
                      cut, so it is not repeated in the list below. */}
                  <span>{person.email}</span>
                </div>
              </header>
              <dl className="user-profile-details">
                <div>
                  <dt>Status</dt>
                  <dd>
                    {/* An unmodelled value keeps the quiet base pill: the
                        modifier simply does not match a rule, which is the
                        right answer for a status this build cannot interpret.
                        The label is the one rule every dictionary follows
                        (`userStatusLabel`): the build's word, a served English
                        name, or the value as received — and "—" for the
                        `null` an absent status arrives as (TAS-173), which
                        used to throw on `toLowerCase` and take the menu down. */}
                    <span className={`user-status is-${(person.status ?? "").toLowerCase()}`}>
                      {userStatusLabel(person.status, meta?.userStatuses)}
                    </span>
                  </dd>
                </div>
                {/* A gateway that does not state the role gets no row at all:
                    "Unknown" would read as a fact about the account rather than
                    about the response. */}
                {person.globalRole ? (
                  <div>
                    <dt>Role</dt>
                    <dd>{globalRoleLabel(person.globalRole)}</dd>
                  </div>
                ) : null}
              </dl>
            </>
          ) : (
            // Nothing invented about who this is — only that we could not find
            // out, and that leaving is still possible.
            <p className="user-profile-unknown">Your profile could not be loaded.</p>
          )}
          {/* One divider above the three rows — this block's own top border —
              and none between them: Log out is already set apart by
              `--danger` (§4.16, art-director's ruling 6 on TAS-380). */}
          <div className="user-profile-actions">
            {/* Every reader, and even when the profile did not load: Appearance
                needs no profile, and My profile says for itself that it could
                not read one. A link, as Administration is: it navigates, so it
                has to be middle-clickable and copyable. */}
            <Link
              aria-current={insideArea(location.pathname, "/settings") ? "page" : undefined}
              className="user-profile-link"
              onClick={followLink}
              to="/settings"
            >
              <Settings aria-hidden="true" size={15} />
              Settings
            </Link>
            {isGlobalAdmin ? (
              // Absent — not disabled, not hidden — for everyone else; hiding it
              // is not the permission control, the server is
              // (`/api/v1/readonly/*` is GLOBAL_ADMIN-only and enumerates
              // 401/403).
              <Link
                // Opened from /admin itself, the entry leads nowhere new, and
                // saying so is one attribute. Any section counts: /admin is an
                // area that redirects into /admin/data (§5.8), so an exact
                // match would be true for a single tick and never again.
                aria-current={insideArea(location.pathname, "/admin") ? "page" : undefined}
                className="user-profile-link"
                onClick={followLink}
                to="/admin"
              >
                <ShieldCheck aria-hidden="true" size={15} />
                Administration
              </Link>
            ) : null}
            <button className="user-profile-logout" disabled={loggingOut} onClick={onLogout} type="button">
              <LogOut aria-hidden="true" size={15} />
              {loggingOut ? "Logging out…" : "Log out"}
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
