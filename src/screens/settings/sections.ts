import { KeyRound, Link2, Palette, UserRound, Users } from "lucide-react";
import type { AreaSection, AreaSectionGroup } from "../../components/SectionArea";
import type { Theme } from "../../hooks/useTheme";

/**
 * The sections of Settings (TAS-380, DESIGN.md §5.9). One list feeds the rail
 * and the heading; the routes in `App` name the same three paths. Access
 * tokens (TAS-412) sits second, beside the profile it belongs with.
 */
export const settingsSections: readonly AreaSection[] = [
  { id: "profile", label: "My profile", path: "/settings/profile", icon: UserRound },
  { id: "tokens", label: "Access tokens", path: "/settings/tokens", icon: KeyRound },
  { id: "connected-apps", label: "Connected apps", path: "/settings/connected-apps", icon: Link2 },
  { id: "appearance", label: "Appearance", path: "/settings/appearance", icon: Palette },
];

/**
 * The B2B build's «Company» group (TAS-502, DESIGN.md §5.9): sections about the
 * tab's company rather than the reader — Members now, TAS-504 and TAS-512
 * later. Every role of the company sees it; without the flag it is not drawn
 * and its route does not exist.
 */
export const companySettingsGroup: AreaSectionGroup = {
  id: "company",
  label: "Company",
  sections: [{ id: "members", label: "Members", path: "/settings/members", icon: Users }],
};

/** The section a path inside `/settings` belongs to, or `undefined` for `/settings` itself. */
export function settingsSectionForPath(
  pathname: string,
  groups: readonly AreaSectionGroup[] = [],
): AreaSection | undefined {
  return [...settingsSections, ...groups.flatMap((group) => group.sections)].find(
    (section) => pathname === section.path || pathname.startsWith(`${section.path}/`),
  );
}

/**
 * What the area hands its sections through the outlet: the app's one theme
 * state, which Appearance shares with the top bar's toggle (§4.17).
 */
export interface SettingsOutletContext {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}
