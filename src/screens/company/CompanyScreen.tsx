import { useQuery } from "@tanstack/react-query";
import { Outlet, useLocation } from "react-router-dom";
import { taskaApi } from "../../api/client";
import { SectionArea } from "../../components/SectionArea";
import { ThemeToggle } from "../../components/ThemeToggle";
import { TopBar } from "../../components/TopBar";
import type { ScreenProps } from "../App";
import { companySectionForPath, companySections } from "./sections";

/**
 * The Company zone (`/company`, TAS-522, DESIGN.md §5.10) — the B2B build
 * only: the tab's company's own console, the platform administration's mirror
 * inside one company. An area with sections on the shared recipe
 * (`SectionArea`), inside the app shell with the same top bar as Settings.
 *
 * No role gate: every member of the company sees every section, and what a
 * reader may change is decided by each section from its own reads (§4.38,
 * §4.39, §4.40) — the server stays the authority. A paused or blocked company
 * does not close it (§4.35): `CompanyGate` replaces only the content routes,
 * so the owner reaches «Resume company».
 *
 * The sections' bodies are the ones Settings drew until TAS-522, unchanged —
 * which is why the area keeps Settings' class: its narrow-width heading insets
 * (§5.9) are the zone's too, and the sections find the heading they hand focus
 * to under it.
 */
export function CompanyScreen({ theme, toggleTheme, onLogout, logoutPending }: ScreenProps) {
  const location = useLocation();
  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => taskaApi.getCurrentUser(),
  });
  // `/company` itself renders for the single tick before its index route
  // redirects into General; the heading names that section meanwhile.
  const section = companySectionForPath(location.pathname) ?? companySections[0];

  return (
    <main className="page-shell">
      <TopBar
        right={<ThemeToggle theme={theme} onToggle={toggleTheme} />}
        user={meQuery.data}
        userLoading={meQuery.isPending}
        loggingOut={logoutPending}
        onLogout={onLogout}
      />
      <SectionArea className="settings-area" current={section} name="Company" sections={companySections}>
        <Outlet />
      </SectionArea>
    </main>
  );
}
