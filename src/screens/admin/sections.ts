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
   * TAS-186 and Events since TAS-194, and Data still does not. Owning it at the
   * area level would have meant rewriting the shell under whichever story landed
   * first, and would now be false for half the area.
   */
  readOnly: boolean;
}

export const adminSections: AdminSection[] = [
  { id: "data", label: "Data", path: "/admin/data", icon: Database, stories: [], readOnly: true },
  // No longer read-only (TAS-194): the Problems view retries a stuck outbox
  // event through `POST /api/v1/admin/outbox/{service}/{eventId}/retry`, which
  // came with the backend's TAS-106 (backend PR #143, merged 2026-09-03) and is
  // in both the vendored snapshot and the deployed gateway's own generated spec.
  // The marker came off in the same diff as the button, which is the only order
  // in which this flag can be true — it describes what the section does, not
  // what a story intends to add.
  //
  // The Problems view's read answers too: measured 2026-09-08 with a
  // GLOBAL_ADMIN token, `GET /api/v1/readonly/outbox/problematic-summary` is a
  // 200 with `{counts, events, notAllShown}` (backend PR #141, TAS-105, merged
  // 2026-08-27). The section's old "the gateway does not serve this yet" note
  // described a gateway that stopped existing on that date and came out here.
  { id: "events", label: "Events", path: "/admin/events", icon: Radio, stories: [], readOnly: false },
  // No stories, so no placeholder: the section is built (TAS-186). It is also
  // the one section in the area that writes, which is why it carries no
  // `read-only` marker — blocking an account, unblocking it and resetting its
  // lockout are its whole point. All three routes are on the deployed gateway
  // since backend PR #146 (measured 2026-09-08, TAS-196), so the writes now
  // reach the service instead of falling through to a 404.
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
