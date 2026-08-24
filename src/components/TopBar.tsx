import { useRef, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { DEFAULT_SIGNED_IN_ROUTE } from "./RequireSession";
import type { User } from "../domain/types";
import { GlobalSearch } from "./GlobalSearch";
import { NotificationsBell } from "./NotificationsBell";
import { TaskaLogo } from "./TaskaLogo";
import { UserProfileMenu } from "./UserProfileMenu";

/**
 * The app shell's top bar (DESIGN.md §5.1): logo, the global issue search, the
 * notifications bell, a slot for the screen's own controls, and the profile
 * menu. Lived inside `ProjectsScreen` until a second screen — `/admin` — needed
 * the same header; moved here unchanged so both use one bar rather than two
 * that drift apart.
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
 *
 * The bell arrived here in TAS-185, and the reason is the contract rather than
 * symmetry: `GET /api/v1/notifications` is "inbox уведомлений текущего
 * пользователя" and takes no project, so an inbox reachable only from inside
 * some project's board was reachable from the wrong place — its commonest entry
 * is an issue assigned to you in a project you do not have open. The board
 * keeps its own bell and never renders this bar, so there is one bell on
 * screen, never two.
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
  // `NotificationsBell` asks its caller to name the box whose reflow moves the
  // bell, rather than searching for one (TAS-181). This bar's honest answer is
  // itself: it is fixed at 52 and never wraps, so nothing here ever moves the
  // bell and the hook's viewport observer is what republishes the anchor. The
  // ref is passed anyway because "the bar the bell is in" is the relationship
  // the prop states, and a bar that opted out would be a bar that has to
  // remember to opt back in the day §2.7 stops holding.
  const barRef = useRef<HTMLElement>(null);

  return (
    <header className="topbar" ref={barRef}>
      <Link aria-label="Taska — all projects" className="topbar-home" to={DEFAULT_SIGNED_IN_ROUTE}>
        <TaskaLogo compact />
      </Link>
      <div className="topbar-spacer" />
      {/* §4.13 fixes the order after the spacer: search, then notifications,
          then the theme toggle — the last two inside the pinned group below,
          which is where the theme toggle already arrives as `right`. Every
          screen using this bar is behind the session guard, which is what makes
          an unconditional search here safe. */}
      <GlobalSearch />
      {/* One group, and the reason is positional rather than cosmetic: the
          profile control belongs in the top-right corner, which is where a
          reader reaches for it, and its popover hangs from that corner. Held
          together and pinned right, that stays true on whichever row a bar
          ends up putting them — this one is fixed at 52 and does not wrap
          (§2.7), the board's does, and the guarantee should not depend on
          which bar it is. */}
      <div className="topbar-actions">
        {/* First in the group, which is §4.13's order and also what the
            notifications panel's width clamp is measured against: the bell is
            the one trigger in the bar whose own right edge is nowhere near the
            screen's. */}
        <NotificationsBell bar={barRef} />
        {right}
        <UserProfileMenu user={user} loading={userLoading} loggingOut={loggingOut} onLogout={onLogout} />
      </div>
    </header>
  );
}
