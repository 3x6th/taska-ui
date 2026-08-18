import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { DEFAULT_SIGNED_IN_ROUTE } from "./RequireSession";
import type { User } from "../domain/types";
import { TaskaLogo } from "./TaskaLogo";
import { UserProfileMenu } from "./UserProfileMenu";

/**
 * The app shell's top bar (DESIGN.md §5.1): logo, a slot for the screen's own
 * controls, and the profile menu. Lived inside `ProjectsScreen` until a second
 * screen — `/admin` — needed the same header; moved here unchanged so both use
 * one bar rather than two that drift apart. The board keeps its own header: it
 * carries search, notifications and the create button inline.
 *
 * The logo is the way back to the project list, which is the convention every
 * reader arrives with: the console's own "Back to projects" sits at the foot of
 * a rail the reader has to look down to find, and nothing at the top of the
 * page went anywhere. It stays a plain `<div>` on the login screen, where there
 * is no session to go back to and the route would only bounce to `/login`.
 */
export function TopBar({
  right,
  user,
  userLoading,
  loggingOut,
  onLogout,
}: {
  right: ReactNode;
  user?: User;
  userLoading: boolean;
  loggingOut: boolean;
  onLogout: () => void;
}) {
  return (
    <header className="topbar">
      <Link aria-label="Taska — all projects" className="topbar-home" to={DEFAULT_SIGNED_IN_ROUTE}>
        <TaskaLogo compact />
      </Link>
      <div className="topbar-spacer" />
      {right}
      <UserProfileMenu user={user} loading={userLoading} loggingOut={loggingOut} onLogout={onLogout} />
    </header>
  );
}
