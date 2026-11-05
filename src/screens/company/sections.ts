import { Building2, Gauge, ScrollText, Users } from "lucide-react";
import type { AreaSection } from "../../components/SectionArea";

/** The Company zone's own address (TAS-522, DESIGN.md §5.10): it only redirects into General. */
export const COMPANY_ZONE = "/company";

/**
 * The company's log («Activity», TAS-524, §4.41) — `ScrollText`, the Audit's
 * icon (§5.8). Always the last section: the ones to come stand between Plan
 * and it, as Audit is last in the administration's rail.
 */
export const ACTIVITY_SECTION: AreaSection = { id: "activity", label: "Activity", path: "/company/activity", icon: ScrollText };

/**
 * The sections of the Company zone (TAS-522, DESIGN.md §5.10), the B2B build
 * only: first the company itself («General», TAS-504, §4.39), then its people
 * («Members», TAS-502, §4.38), then its plan («Plan», TAS-512, §4.40), and
 * last its log («Activity», TAS-524, §4.41); the sections to come stand
 * between Plan and Activity. One list feeds the rail and the heading; the
 * routes in `App` name the same paths. Every role of the company sees the
 * first three — what a reader may change is each section's own business —
 * and the rail draws «Activity» only for a reader the tab knows to be its
 * owner or an Admin, or while it is open (`railSections`).
 */
export const companySections: readonly AreaSection[] = [
  { id: "general", label: "General", path: "/company/general", icon: Building2 },
  { id: "members", label: "Members", path: "/company/members", icon: Users },
  { id: "plan", label: "Plan", path: "/company/plan", icon: Gauge },
  ACTIVITY_SECTION,
];

/** The rail's items: every section, «Activity» only when `activity` (§4.41 «Где»). Not disabled — absent. */
export const railSections = (activity: boolean): readonly AreaSection[] =>
  activity ? companySections : companySections.filter((section) => section.id !== ACTIVITY_SECTION.id);

/**
 * Where the sections lived before they had a zone (TAS-502, TAS-504, TAS-512 —
 * the «Company» group of Settings) and where each lives now: the old address
 * is replaced by the new one, its query and hash kept (§5.10 «Маршруты»).
 */
export const movedCompanySections: readonly { from: string; to: string }[] = [
  { from: "/settings/company", to: "/company/general" },
  { from: "/settings/members", to: "/company/members" },
  { from: "/settings/plan", to: "/company/plan" },
];

/** Whether `pathname` is inside the zone — `/company` itself or any of its sections. */
export const inCompanyZone = (pathname: string) => pathname === COMPANY_ZONE || pathname.startsWith(`${COMPANY_ZONE}/`);

/** The section a path inside `/company` belongs to, or `undefined` for `/company` itself. */
export function companySectionForPath(pathname: string): AreaSection | undefined {
  return companySections.find((section) => pathname === section.path || pathname.startsWith(`${section.path}/`));
}
