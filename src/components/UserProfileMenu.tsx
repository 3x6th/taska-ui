import { useEffect, useId, useRef, useState } from "react";
import { LogOut, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import type { GlobalRole, User, UserStatus } from "../domain/types";
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
};

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
  // The entry exists only for an account the server called GLOBAL_ADMIN. A
  // gateway that states no role counts as not an admin, which is lossy in the
  // safe direction (docs/ai/API-DIVERGENCE.md).
  const isGlobalAdmin = user?.globalRole === "GLOBAL_ADMIN";

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

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
                    <span className={`user-status is-${user.status.toLowerCase()}`}>{statusLabels[user.status]}</span>
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
