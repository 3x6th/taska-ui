import { createContext, useContext, useState, type ReactNode } from "react";
import { Outlet, useLocation } from "react-router-dom";
import type { Theme } from "../hooks/useTheme";
import { COMPANIES_ROUTE, CREATE_COMPANY_ROUTE, isContinuedShell } from "../lib/companies";
import { TaskaLogo } from "./TaskaLogo";
import { ThemeToggle } from "./ThemeToggle";

/** Set inside `AuthShellFrame`: a screen's own `AuthShell` is then the frame's card, not a second shell. */
const InsideFrame = createContext(false);

/**
 * How the card enters (§3): the sign-in card's 500 ms (`login`), the token's
 * `tk-pop` (`app`) for the picker, «Create a company» and the never-opened
 * card (TAS-500, TAS-501), or not at all (`none`) — a card that continues the
 * one just on screen across the company prefix, which remounts the router but
 * must not enter twice (§3: «второго входа нет»).
 */
export type AuthShellEntrance = "login" | "app" | "none";

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
export function AuthShell({
  theme,
  toggleTheme,
  entrance = "login",
  children,
}: {
  theme: Theme;
  toggleTheme: () => void;
  entrance?: AuthShellEntrance;
  children: ReactNode;
}) {
  if (useContext(InsideFrame)) return children;
  return (
    <AuthShellBox entrance={entrance} theme={theme} toggleTheme={toggleTheme}>
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
  entrance: AuthShellEntrance;
  theme: Theme;
  toggleTheme: () => void;
  children: ReactNode;
}) {
  return (
    <main className="auth-screen">
      <div className="auth-glow" />
      {/* The 500 ms entrance is the sign-in card's alone (§3); the picker,
          opened from inside the app several times a day, enters on the token. */}
      <div
        className={
          entrance === "app" ? "auth-card-wrap is-app-entrance" : entrance === "none" ? "auth-card-wrap is-continued" : "auth-card-wrap"
        }
      >
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
 * The one frame `/login`, `/companies` and `/companies/new` share in the
 * companies build — a layout route, so moving between them keeps the card
 * mounted and only its contents change. Its entrance is decided by the route
 * it opened on: the sign-in card's 500 ms on `/login`, the token's on the
 * other two (§3, B6) — and none when it continues a card just left across the
 * company prefix (TAS-501).
 */
export function AuthShellFrame({ theme, toggleTheme }: { theme: Theme; toggleTheme: () => void }) {
  const location = useLocation();
  const [entrance] = useState<AuthShellEntrance>(() =>
    isContinuedShell(location.state)
      ? "none"
      : location.pathname === COMPANIES_ROUTE || location.pathname === CREATE_COMPANY_ROUTE
        ? "app"
        : "login",
  );
  return (
    <InsideFrame.Provider value={true}>
      <AuthShellBox entrance={entrance} theme={theme} toggleTheme={toggleTheme}>
        <Outlet />
      </AuthShellBox>
    </InsideFrame.Provider>
  );
}
