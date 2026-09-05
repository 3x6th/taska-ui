import { useId, useRef, useState } from "react";
import { LogOut, ShieldCheck } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import type { GlobalRole, User, UserStatus } from "../domain/types";
import { useDismissOnOutside } from "../hooks/useDismissOnOutside";
import { Avatar } from "./Avatar";

interface UserProfileMenuProps {
  user?: User;
  loading?: boolean;
  loggingOut?: boolean;
  onLogout: () => void;
}

const statusLabels: Record<UserStatus, string> = {
  ACTIVE: "Active",
  BLOCKED: "Blocked",
  INVITED: "Invited",
  LOCKED: "Locked",
};

/**
 * The written status, or the raw value for anything this build has never heard
 * of — the same rule `userStatusLabel` follows in the admin Users section, for
 * a different reason. There the value is a database cell, so it was never
 * promised to be an enum member. Here it is typed `UserStatus` and can still
 * arrive outside it: `GET /users/me` answers the gateway's own
 * `GatewayUserStatus`, which has **no** `LOCKED`. So once backend PR #146
 * deploys and the state can exist, a locked account whose pre-lock token still
 * works — `validateUserStatus` in that PR's `AuthServiceImpl` rejects `BLOCKED`
 * and `INVITED`, and says nothing about `LOCKED` — will read back as
 * `UNSPECIFIED`.
 *
 * A bare lookup printed an empty badge for that: `undefined` in a place typed
 * `string`, which renders as nothing and says nothing. Adding `LOCKED` to the
 * union does not fix it, because `LOCKED` is not the value that arrives.
 */
function statusLabel(status: string): string {
  const labels: Record<string, string | undefined> = statusLabels;
  return labels[status] ?? status;
}

// The account-wide role, not the project one. It is shown, never acted on.
const globalRoleLabels: Record<GlobalRole, string> = {
  USER: "User",
  GLOBAL_ADMIN: "Global admin",
};

export function UserProfileMenu({ user, loading = false, loggingOut = false, onLogout }: UserProfileMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverId = useId();
  const location = useLocation();
  // The entry exists only for an account the server called GLOBAL_ADMIN. A
  // gateway that states no role counts as not an admin, which is lossy in the
  // safe direction (docs/ai/API-DIVERGENCE.md).
  const isGlobalAdmin = user?.globalRole === "GLOBAL_ADMIN";

  // Escape and a press outside, from the hook the notifications popover and the
  // global search dropdown share (§4.16, §7). This used to be the only copy in
  // the product, which is exactly why the other two shipped without it.
  useDismissOnOutside(open, rootRef, () => setOpen(false));

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
        <Avatar user={user} label="Current user" loading={loading} size="md" />
      </button>

      {open ? (
        <section aria-label="Current user profile" className="user-profile-popover" id={popoverId} role="dialog">
          {user ? (
            <>
              <header className="user-profile-head">
                <Avatar user={user} size="lg" />
                <div>
                  <strong>{user.displayName}</strong>
                  <span>@{user.login}</span>
                </div>
              </header>
              <dl className="user-profile-details">
                <div>
                  <dt>Email</dt>
                  <dd>{user.email}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>
                    {/* An unmodelled value keeps the quiet base pill: the
                        modifier simply does not match a rule, which is the
                        right answer for a status this build cannot interpret. */}
                    <span className={`user-status is-${user.status.toLowerCase()}`}>{statusLabel(user.status)}</span>
                  </dd>
                </div>
                {/* A gateway that does not state the role gets no row at all:
                    "Unknown" would read as a fact about the account rather than
                    about the response. */}
                {user.globalRole ? (
                  <div>
                    <dt>Role</dt>
                    <dd>{globalRoleLabels[user.globalRole]}</dd>
                  </div>
                ) : null}
              </dl>
            </>
          ) : (
            // Nothing invented about who this is — only that we could not find
            // out, and that leaving is still possible.
            <p className="user-profile-unknown">Your profile could not be loaded.</p>
          )}
          <div className="user-profile-actions">
            {isGlobalAdmin ? (
              // A real link, not a button: it navigates, so it has to be
              // middle-clickable and copyable, same reasoning as the not-found
              // screen's way out. Absent — not disabled, not hidden — for
              // everyone else; hiding it is not the permission control, the
              // server is (`/api/v1/readonly/*` is GLOBAL_ADMIN-only and
              // enumerates 401/403).
              <Link
                // Opened from /admin itself, the entry leads nowhere new, and
                // saying so is one attribute. Any section counts: /admin is an
                // area that redirects into /admin/data (§5.8), so an exact
                // match would be true for a single tick and never again.
                aria-current={
                  location.pathname === "/admin" || location.pathname.startsWith("/admin/") ? "page" : undefined
                }
                className="user-profile-admin"
                onClick={(event) => {
                  // A modified click opens /admin in a new tab and leaves this
                  // page as it is, so the menu it was opened from stays open.
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  setOpen(false);
                  // Closing the popover unmounts the item that had focus, so it
                  // goes back to the trigger (§7). What this actually covers is
                  // the case where no route change follows — opening the menu
                  // while already on /admin and choosing Administration. On a
                  // real navigation the route swap unmounts this trigger a tick
                  // later and focus ends up on <body> anyway; that is true of
                  // every in-app link, not of this entry, and is recorded in
                  // docs/ai/BACKLOG.md rather than patched here.
                  triggerRef.current?.focus();
                }}
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
