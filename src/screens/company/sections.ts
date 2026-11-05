import { Building2, Gauge, Users } from "lucide-react";
import type { AreaSection } from "../../components/SectionArea";

/** The Company zone's own address (TAS-522, DESIGN.md §5.10): it only redirects into General. */
export const COMPANY_ZONE = "/company";

/**
 * The sections of the Company zone (TAS-522, DESIGN.md §5.10), the B2B build
 * only: first the company itself («General», TAS-504, §4.39), then its people
 * («Members», TAS-502, §4.38), then its plan («Plan», TAS-512, §4.40); the
 * sections to come stand after Plan. One list feeds the rail and the heading;
 * the routes in `App` name the same paths. Every role of the company sees all
 * of them — what a reader may change is each section's own business.
 */
export const companySections: readonly AreaSection[] = [
  { id: "general", label: "General", path: "/company/general", icon: Building2 },
  { id: "members", label: "Members", path: "/company/members", icon: Users },
  { id: "plan", label: "Plan", path: "/company/plan", icon: Gauge },
];

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
