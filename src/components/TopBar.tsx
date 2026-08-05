import type { ReactNode } from "react";
import type { User } from "../domain/types";
import { TaskaLogo } from "./TaskaLogo";
import { UserProfileMenu } from "./UserProfileMenu";

/**
 * The app shell's top bar (DESIGN.md §5.1): logo, a slot for the screen's own
 * controls, and the profile menu. Lived inside `ProjectsScreen` until a second
 * screen — `/admin` — needed the same header; moved here unchanged so both use
 * one bar rather than two that drift apart. The board keeps its own header: it
 * carries search, notifications and the create button inline.
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
      <TaskaLogo compact />
      <div className="topbar-spacer" />
      {right}
      <UserProfileMenu user={user} loading={userLoading} loggingOut={loggingOut} onLogout={onLogout} />
    </header>
  );
}
