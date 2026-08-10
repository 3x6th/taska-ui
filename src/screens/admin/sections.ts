import { Database, Radio, ScrollText, Users, type LucideIcon } from "lucide-react";

/**
 * The sections of the administration area (DESIGN.md §5.8). All four are drawn,
 * including the ones the backend has not built yet: the shape of the area is
 * itself information, and an admin who sees Audit as a placeholder knows more
 * than an admin who sees nothing at all.
 *
 * One list feeds the rail, the routes and the placeholders, so a section can
 * never exist in the navigation without a route or the other way round.
 */
export interface AdminSection {
  id: string;
  label: string;
  path: string;
  icon: LucideIcon;
  /**
   * The Jira stories that will replace the placeholder with a real section.
   * Empty for a section that already works — that emptiness is what says
   * "no placeholder here".
   */
  stories: string[];
}

export const adminSections: AdminSection[] = [
  { id: "data", label: "Data", path: "/admin/data", icon: Database, stories: [] },
  { id: "events", label: "Events", path: "/admin/events", icon: Radio, stories: ["TAS-105"] },
  { id: "users", label: "Users", path: "/admin/users", icon: Users, stories: ["TAS-107", "TAS-108"] },
  { id: "audit", label: "Audit", path: "/admin/audit", icon: ScrollText, stories: ["TAS-160"] },
];

/** The section a path inside `/admin` belongs to, or `undefined` for `/admin` itself. */
export function sectionForPath(pathname: string): AdminSection | undefined {
  return adminSections.find((section) => pathname === section.path || pathname.startsWith(`${section.path}/`));
}

/** Where a story key is read. The one external link in the product. */
export function jiraUrl(key: string): string {
  return `https://jira.ozero.dev/browse/${key}`;
}
