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
  /**
   * Whether the section only reads (§5.8). Per section, not per area, because
   * that is how it will stop being true: TAS-106 brings a retry to Events and
   * TAS-107/TAS-108 bring block and unblock to Users, and each flips its own
   * flag. Owning it at the area level would mean rewriting the shell under
   * whichever story lands first.
   */
  readOnly: boolean;
}

export const adminSections: AdminSection[] = [
  { id: "data", label: "Data", path: "/admin/data", icon: Database, stories: [], readOnly: true },
  { id: "events", label: "Events", path: "/admin/events", icon: Radio, stories: ["TAS-105"], readOnly: true },
  {
    id: "users",
    label: "Users",
    path: "/admin/users",
    icon: Users,
    stories: ["TAS-107", "TAS-108"],
    readOnly: true,
  },
  { id: "audit", label: "Audit", path: "/admin/audit", icon: ScrollText, stories: ["TAS-160"], readOnly: true },
];

/** The section a path inside `/admin` belongs to, or `undefined` for `/admin` itself. */
export function sectionForPath(pathname: string): AdminSection | undefined {
  return adminSections.find((section) => pathname === section.path || pathname.startsWith(`${section.path}/`));
}

/** Where a story key is read. The one external link in the product. */
export function jiraUrl(key: string): string {
  return `https://jira.ozero.dev/browse/${key}`;
}
