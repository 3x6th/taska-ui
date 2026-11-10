import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { taskaApi } from "../../api/client";
import { SectionArea } from "../../components/SectionArea";
import { ThemeToggle } from "../../components/ThemeToggle";
import { TopBar } from "../../components/TopBar";
import type { ScreenProps } from "../App";
import { useCompanies } from "../../hooks/useCompanies";
import { useCompanyAddress } from "../../lib/companyAddress";
import { companyTenantOptions } from "./companyGeneral";
import type { CompanyZoneOutlet } from "./companyZone";
import { companySectionForPath, companySections, railSections } from "./sections";

/**
 * The Company zone (`/company`, TAS-522, DESIGN.md §5.10) — the B2B build
 * only: the tab's company's own console, the platform administration's mirror
 * inside one company. An area with sections on the shared recipe
 * (`SectionArea`), inside the app shell with the same top bar as Settings.
 *
 * One role gate (TAS-513, art-director B1): Billing is in the rail for the
 * company's owner only — `ownerId` of the company as last read, else of its
 * list row, never fetched here — and leaves it in the frame a transfer lands.
 * Every member sees the other sections, and what a reader may change is
 * decided by each section from its own reads (§4.38, §4.39, §4.40) — the
 * server stays the authority. A paused or blocked company
 * does not close it (§4.35): `CompanyGate` replaces only the content routes,
 * so the owner reaches «Resume company».
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
  const companyId = useCompanyAddress()?.companyId ?? "";
  const companies = useCompanies();
  // Observed, not asked for: the sections read the company themselves (useCompanyMarker's way).
  const tenant = useQuery({ ...companyTenantOptions(companyId), enabled: false });
  const row = companies.data?.find((item) => item.id === companyId) ?? null;
  const latest = tenant.data !== undefined && (row === null || tenant.dataUpdatedAt >= companies.dataUpdatedAt) ? tenant.data : row;
  const owner = meQuery.data?.id !== undefined && latest?.ownerId === meQuery.data.id;
  const [headingItem, setHeadingItem] = useState<string | null>(null);
  const [headingDescribedBy, setHeadingDescribedBy] = useState<string | null>(null);
  const outlet = useMemo<CompanyZoneOutlet>(() => ({ setHeadingItem, setHeadingDescribedBy }), []);
  // One list per answer, so the rail's scroll-into-view runs when Billing joins it and not on every render (N7).
  const rail = useMemo(() => railSections(owner), [owner]);

  return (
    <main className="page-shell">
      <TopBar
        right={<ThemeToggle theme={theme} onToggle={toggleTheme} />}
        user={meQuery.data}
        userLoading={meQuery.isPending}
        loggingOut={logoutPending}
        onLogout={onLogout}
      />
      <SectionArea
        className="settings-area"
        current={section}
        headingDescribedBy={headingDescribedBy}
        item={headingItem}
        name="Company"
        sections={rail}
      >
        <Outlet context={outlet} />
      </SectionArea>
    </main>
  );
}
