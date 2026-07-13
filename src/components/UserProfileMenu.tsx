import { useEffect, useId, useRef, useState } from "react";
import type { User, UserStatus } from "../domain/types";
import { Avatar } from "./Avatar";

interface UserProfileMenuProps {
  user?: User;
  loading?: boolean;
}

const statusLabels: Record<UserStatus, string> = {
  ACTIVE: "Active",
  BLOCKED: "Blocked",
  INVITED: "Invited",
};

export function UserProfileMenu({ user, loading = false }: UserProfileMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();

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
        disabled={loading || !user}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <Avatar user={user} label="Current user" loading={loading} size="md" />
      </button>

      {open && user ? (
        <section aria-label="Current user profile" className="user-profile-popover" id={popoverId} role="dialog">
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
          </dl>
        </section>
      ) : null}
    </div>
  );
}
