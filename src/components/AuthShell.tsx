import type { ReactNode } from "react";
import type { Theme } from "../hooks/useTheme";
import { TaskaLogo } from "./TaskaLogo";
import { ThemeToggle } from "./ThemeToggle";

/**
 * The login card's frame (DESIGN.md §4.27): the glow, the logo, the card, the
 * footnote and the theme toggle. Shared by `/login`, `/invite` and, since
 * TAS-426, `/auth/callback`, which is drawn in the same shell without tabs
 * (§4.31) — so the return from a provider looks like the page it left.
 */
export function AuthShell({ theme, toggleTheme, children }: { theme: Theme; toggleTheme: () => void; children: ReactNode }) {
  return (
    <main className="auth-screen">
      <div className="auth-glow" />
      <div className="auth-card-wrap">
        <TaskaLogo />
        <section className="auth-card">{children}</section>
        <div className="auth-footnote">Taska — issue tracking, minus the clutter.</div>
      </div>
      <div className="auth-theme">
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
      </div>
    </main>
  );
}
