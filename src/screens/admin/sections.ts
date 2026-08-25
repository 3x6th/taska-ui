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
   * that is how it stops being true one section at a time: Users writes since
   * TAS-186 and carries no marker, and TAS-106 will bring a retry to Events and
   * take its marker off. Owning it at the area level would have meant rewriting
   * the shell under whichever story landed first.
   */
  readOnly: boolean;
}

export const adminSections: AdminSection[] = [
  { id: "data", label: "Data", path: "/admin/data", icon: Database, stories: [], readOnly: true },
  // Read-only until TAS-106 brings retry, which is the story that flips this
  // flag — and the summary the Problems view is built on arrives with TAS-105,
  // which is a gap in the gateway rather than a placeholder here: the section
  // works, and says so itself when the endpoint is not deployed yet.
  { id: "events", label: "Events", path: "/admin/events", icon: Radio, stories: [], readOnly: true },
  // No stories, so no placeholder: the section is built (TAS-186). It is also
  // the one section in the area that writes, which is why it carries no
  // `read-only` marker — blocking and unblocking an account are its whole
  // point. The two writes come from the backend's TAS-107; against a gateway
  // that has not deployed it yet the list still reads and the confirmation says
  // so in its own words (docs/ai/API-DIVERGENCE.md).
  { id: "users", label: "Users", path: "/admin/users", icon: Users, stories: [], readOnly: false },
  { id: "audit", label: "Audit", path: "/admin/audit", icon: ScrollText, stories: ["TAS-160"], readOnly: false },
];

/** The section a path inside `/admin` belongs to, or `undefined` for `/admin` itself. */
export function sectionForPath(pathname: string): AdminSection | undefined {
  return adminSections.find((section) => pathname === section.path || pathname.startsWith(`${section.path}/`));
}

/** Where a story key is read. The one external link in the product. */
export function jiraUrl(key: string): string {
  return `https://jira.ozero.dev/browse/${key}`;
}
