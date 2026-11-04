import { useQuery } from "@tanstack/react-query";
import { Outlet, useLocation } from "react-router-dom";
import { taskaApi } from "../../api/client";
import { SectionArea } from "../../components/SectionArea";
import { ThemeToggle } from "../../components/ThemeToggle";
import { TopBar } from "../../components/TopBar";
import type { Theme } from "../../hooks/useTheme";
import { useCompanyAddress } from "../../lib/companyAddress";
import type { ScreenProps } from "../App";
import { companySettingsGroup, settingsSectionForPath, settingsSections, type SettingsOutletContext } from "./sections";

interface SettingsScreenProps extends ScreenProps {
  setTheme: (theme: Theme) => void;
}

/**
 * Settings (`/settings`, TAS-380, DESIGN.md §5.9): the reader's own profile and
 * the way the product is drawn for them. An area with sections, on the shared
 * recipe `/admin` uses (`SectionArea`), inside the app shell with the same top
 * bar.
 *
 * Every role may use it, so there is no gate and nothing waits for the profile
 * before drawing: Appearance needs no profile at all, and My profile says for
 * itself while it loads or if it could not.
 */
export function SettingsScreen({ theme, toggleTheme, setTheme, onLogout, logoutPending }: SettingsScreenProps) {
  const location = useLocation();
  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => taskaApi.getCurrentUser(),
  });
  // The B2B build adds the «Company» group (TAS-502, §5.9), for every role.
  const groups = useCompanyAddress() !== null ? [companySettingsGroup] : [];
  // `/settings` itself renders for the single tick before its index route
  // redirects into My profile; the heading names that section meanwhile.
  const section = settingsSectionForPath(location.pathname, groups) ?? settingsSections[0];

  return (
    <main className="page-shell">
      <TopBar
        right={<ThemeToggle theme={theme} onToggle={toggleTheme} />}
        user={meQuery.data}
        userLoading={meQuery.isPending}
        loggingOut={logoutPending}
        onLogout={onLogout}
      />
      <SectionArea className="settings-area" current={section} groups={groups} name="Settings" sections={settingsSections}>
        <Outlet context={{ theme, setTheme } satisfies SettingsOutletContext} />
      </SectionArea>
    </main>
  );
}
