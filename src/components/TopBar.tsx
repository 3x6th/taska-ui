import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { DEFAULT_SIGNED_IN_ROUTE } from "./RequireSession";
import type { User } from "../domain/types";
import { GlobalSearch } from "./GlobalSearch";
import { TaskaLogo } from "./TaskaLogo";
import { UserProfileMenu } from "./UserProfileMenu";

/**
 * The app shell's top bar (DESIGN.md §5.1): logo, the global issue search, a
 * slot for the screen's own controls, and the profile menu. Lived inside
 * `ProjectsScreen` until a second screen — `/admin` — needed the same header;
 * moved here unchanged so both use one bar rather than two that drift apart.
 * The board keeps its own header, and its own search box with it: that one
 * filters the issues already on the board, instantly and without a request,
 * where this one asks the server about every project. Two questions, two
 * fields — merging them would cost the board its instant answer.
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
      {/* §4.13 fixes the order after the spacer: search, then notifications,
          then the theme toggle. `right` carries the screen's own controls and
          so stays behind it. Every screen using this bar is behind the session
          guard, which is what makes an unconditional search here safe. */}
      <GlobalSearch />
      {/* One group, and the reason is positional rather than cosmetic: the
          profile control belongs in the top-right corner, which is where a
          reader reaches for it, and its popover hangs from that corner. Held
          together and pinned right, that stays true on whichever row a bar
          ends up putting them — this one is fixed at 52 and does not wrap
          (§2.7), the board's does, and the guarantee should not depend on
          which bar it is. */}
      <div className="topbar-actions">
        {right}
        <UserProfileMenu user={user} loading={userLoading} loggingOut={loggingOut} onLogout={onLogout} />
      </div>
    </header>
  );
}
