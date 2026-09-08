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
   * TAS-186 and carries no marker, and TAS-194 will bring the retry to Events
   * and take its marker off — the gateway route it calls is already deployed
   * (backend TAS-106), so the story that flips this flag is a frontend one.
   * Owning it at the area level would have meant rewriting the shell under
   * whichever story landed first.
   */
  readOnly: boolean;
}

export const adminSections: AdminSection[] = [
  { id: "data", label: "Data", path: "/admin/data", icon: Database, stories: [], readOnly: true },
  // Read-only until TAS-194 brings the retry write into this section, which is
  // the story that flips this flag. The gateway half is already there:
  // `POST /api/v1/admin/outbox/{service}/{eventId}/retry` came with the
  // backend's TAS-106 (backend PR #143, merged 2026-09-03) and is in both the
  // vendored snapshot and the deployed gateway's own generated spec — what is
  // missing is the UI, not the route, which is why the backend key cannot be
  // the one named here.
  //
  // The summary the Problems view is built on answers too: measured 2026-09-08
  // with a GLOBAL_ADMIN token, `GET /api/v1/readonly/outbox/problematic-summary`
  // is a 200 with `{counts, events, notAllShown}` (backend PR #141, TAS-105,
  // merged 2026-08-27). So the section's "not deployed yet" note is inert
  // rather than wrong — `isSummaryNotDeployed` matches the old gateway
  // signature by exact equality and a 200 cannot trigger it — and it stays
  // until TAS-194 removes it with the rest of that compensation
  // (docs/ai/API-DIVERGENCE.md).
  { id: "events", label: "Events", path: "/admin/events", icon: Radio, stories: [], readOnly: true },
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
