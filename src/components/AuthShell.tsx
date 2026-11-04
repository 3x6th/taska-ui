import { createContext, useContext, useState, type ReactNode } from "react";
import { Outlet, useLocation } from "react-router-dom";
import type { Theme } from "../hooks/useTheme";
import { COMPANIES_ROUTE } from "../lib/companies";
import { TaskaLogo } from "./TaskaLogo";
import { ThemeToggle } from "./ThemeToggle";

/** Set inside `AuthShellFrame`: a screen's own `AuthShell` is then the frame's card, not a second shell. */
const InsideFrame = createContext(false);

/**
 * The login card's frame (DESIGN.md §4.27): the glow, the logo, the card, the
 * footnote and the theme toggle. Shared by `/login`, `/invite` and, since
 * TAS-426, `/auth/callback`, which is drawn in the same shell without tabs
 * (§4.31) — so the return from a provider looks like the page it left.
 *
 * In the companies build `/login` and `/companies` share one frame
 * (`AuthShellFrame`), so after signing in the picker replaces the contents of
 * the same card in place (§4.33) — and the frame that is already there is the
 * one a screen's `AuthShell` renders into.
 */
export function AuthShell({ theme, toggleTheme, children }: { theme: Theme; toggleTheme: () => void; children: ReactNode }) {
  if (useContext(InsideFrame)) return children;
  return (
    <AuthShellBox entrance="login" theme={theme} toggleTheme={toggleTheme}>
      {children}
    </AuthShellBox>
  );
}

function AuthShellBox({
  entrance,
  theme,
  toggleTheme,
  children,
}: {
  entrance: "login" | "app";
  theme: Theme;
  toggleTheme: () => void;
  children: ReactNode;
}) {
  return (
    <main className="auth-screen">
      <div className="auth-glow" />
      {/* The 500 ms entrance is the sign-in card's alone (§3); the picker,
          opened from inside the app several times a day, enters on the token. */}
      <div className={entrance === "app" ? "auth-card-wrap is-app-entrance" : "auth-card-wrap"}>
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

/**
 * The one frame `/login` and `/companies` share in the companies build — a
 * layout route, so moving between them keeps the card mounted and only its
 * contents change. Its entrance is decided by the route it opened on: the
 * sign-in card's 500 ms on `/login`, the token's on `/companies` (§3, B6).
 */
export function AuthShellFrame({ theme, toggleTheme }: { theme: Theme; toggleTheme: () => void }) {
  const location = useLocation();
  const [entrance] = useState<"login" | "app">(() => (location.pathname === COMPANIES_ROUTE ? "app" : "login"));
  return (
    <InsideFrame.Provider value={true}>
      <AuthShellBox entrance={entrance} theme={theme} toggleTheme={toggleTheme}>
        <Outlet />
      </AuthShellBox>
    </InsideFrame.Provider>
  );
}
