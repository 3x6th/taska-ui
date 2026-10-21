import { Palette, UserRound } from "lucide-react";
import type { AreaSection } from "../../components/SectionArea";
import type { Theme } from "../../hooks/useTheme";

/**
 * The sections of Settings (TAS-380, DESIGN.md §5.9). One list feeds the rail
 * and the heading; the routes in `App` name the same two paths.
 */
export const settingsSections: readonly AreaSection[] = [
  { id: "profile", label: "My profile", path: "/settings/profile", icon: UserRound },
  { id: "appearance", label: "Appearance", path: "/settings/appearance", icon: Palette },
];

/** The section a path inside `/settings` belongs to, or `undefined` for `/settings` itself. */
export function settingsSectionForPath(pathname: string): AreaSection | undefined {
  return settingsSections.find((section) => pathname === section.path || pathname.startsWith(`${section.path}/`));
}

/**
 * What the area hands its sections through the outlet: the app's one theme
 * state, which Appearance shares with the top bar's toggle (§4.17).
 */
export interface SettingsOutletContext {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}
