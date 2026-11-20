import { QueryClient, useQuery } from "@tanstack/react-query";
import { Outlet, useLocation } from "react-router-dom";
import { taskaApi } from "../../api/client";
import { SectionArea } from "../../components/SectionArea";
import { ThemeToggle } from "../../components/ThemeToggle";
import { TopBar } from "../../components/TopBar";
import { tenantsQueryOptions } from "../../lib/companies";
import { useAccountQueryClient, useCompanyAddress } from "../../lib/companyAddress";
import type { ScreenProps } from "../App";
import { companyTenantOptions } from "./companyGeneral";
import { companyMembersOptions } from "./companyMembersQuery";
import { ACTIVITY_SECTION, companySectionForPath, companySections, railSections } from "./sections";

/** A client nothing is asked on — for the rail's look at the account's cache in a build without one. */
const inertClient = new QueryClient();

/**
 * The Company zone (`/company`, TAS-522, DESIGN.md §5.10) — the B2B build
 * only: the tab's company's own console, the platform administration's mirror
 * inside one company. An area with sections on the shared recipe
 * (`SectionArea`), inside the app shell with the same top bar as Settings.
 *
 * No role gate: every member of the company sees General, Members and Plan,
 * and what a reader may change is decided by each section from its own reads
 * (§4.38, §4.39, §4.40) — the server stays the authority. The one exception
 * is the rail's «Activity» (TAS-524, §4.41, api-contract-guard B6), drawn
 * only for a reader the tab already knows to be the owner or an Admin — and
 * always while its address is open; its address is never gated. A paused or
 * blocked company does not close the zone (§4.35): `CompanyGate` replaces only
 * the content routes, so the owner reaches «Resume company».
 *
 * The sections' bodies are the ones Settings drew until TAS-522, unchanged —
 * which is why the area keeps Settings' class: its narrow-width heading insets
 * (§5.9) are the zone's too, and the sections find the heading they hand focus
 * to under it.
 */
export function CompanyScreen({ theme, toggleTheme, onLogout, logoutPending }: ScreenProps) {
  const location = useLocation();
  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => taskaApi.getCurrentUser(),
  });
  // `/company` itself renders for the single tick before its index route
  // redirects into General; the heading names that section meanwhile.
  const section = companySectionForPath(location.pathname) ?? companySections[0];
  const activity = useKnownCompanyAdmin(meQuery.data?.id ?? null) || section.id === ACTIVITY_SECTION.id;

  return (
    <main className="page-shell">
      <TopBar
        right={<ThemeToggle theme={theme} onToggle={toggleTheme} />}
        user={meQuery.data}
        userLoading={meQuery.isPending}
        loggingOut={logoutPending}
        onLogout={onLogout}
      />
      <SectionArea className="settings-area" current={section} name="Company" sections={railSections(activity)}>
        <Outlet />
      </SectionArea>
    </main>
  );
}

/**
 * Whether the tab already knows the reader is the company's owner or one of
 * its Admins (api-contract-guard B6) — **from what it holds, never by asking**:
 * the reader's own row of the cached members list (ACTIVE, and TENANT_ADMIN
 * or the owner), else `Tenant.ownerId` of a company the tab has read — its
 * `getTenant` answer, else its row of the reader's list. The three are
 * watched with `enabled: false`, so the rail costs no request. A known
 * member, or a reader the tab knows nothing about, is not (ask A26 removes the
 * gap: a non-owner admin sees the item once Members has been read).
 */
function useKnownCompanyAdmin(meId: string | null): boolean {
  const companyId = useCompanyAddress()?.companyId ?? null;
  const accountClient = useAccountQueryClient();
  const members = useQuery({ ...companyMembersOptions(companyId ?? ""), enabled: false });
  const tenant = useQuery({ ...companyTenantOptions(companyId ?? ""), enabled: false });
  const companies = useQuery({ ...tenantsQueryOptions(taskaApi), enabled: false }, accountClient ?? inertClient);
  if (companyId === null || meId === null) return false;
  const row = members.data?.find((member) => member.userId === meId);
  if (row !== undefined) return row.state === "ACTIVE" && (row.role === "TENANT_ADMIN" || row.isOwner);
  const ownerId = tenant.data?.ownerId ?? companies.data?.find((item) => item.id === companyId)?.ownerId ?? null;
  return ownerId === meId;
}
