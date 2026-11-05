import { QueryClient, useQuery } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";
import { taskaApi } from "../api/client";
import type { Workspace } from "../api/TaskaApi";
import { onRefusedThisVisit, refusedThisVisit, tenantsQueryOptions } from "../lib/companies";
import { companyMarker, type CompanyMarker } from "../lib/companyRestrictions";
import { companyTenantOptions } from "../screens/settings/companyGeneral";
import { useAccountQueryClient, useCompanyAddress } from "../lib/companyAddress";
import { plansQueryOptions } from "../lib/plans";

/*
 * The companies build's hooks (TAS-500): the tab's company session, the
 * reader's companies on the account's client, and the document title. Each is
 * inert in today's build — no company address — and asks the API nothing.
 */

const subscribeWorkspace = (listener: () => void) => taskaApi.onWorkspaceChange(listener);
const workspaceSnapshot = () => taskaApi.currentWorkspace();
const subscribeNothing = () => () => {};
const noWorkspace = () => null;

/**
 * The tab's company session, as `useSyncExternalStore` reads it — and `null`,
 * without asking the API anything, in today's build (no company address), so
 * the shared bar and menu that call it stay what they were there.
 */
export function useWorkspace(): Workspace | null {
  const companies = useCompanyAddress() !== null;
  return useSyncExternalStore(
    companies ? subscribeWorkspace : subscribeNothing,
    companies ? workspaceSnapshot : noWorkspace,
    companies ? workspaceSnapshot : noWorkspace,
  );
}

/** Today's build has no account client; this one is asked nothing and holds nothing (see `useCompanies`). */
const inertClient = new QueryClient();

/**
 * The reader's companies, on the account's client — shared by the switcher,
 * the menu, the picker and the titles. In today's build it is disabled and on a
 * client of its own, so the page's cache does not gain so much as an idle entry.
 */
export function useCompanies() {
  const accountClient = useAccountQueryClient();
  return useQuery({ ...tenantsQueryOptions(taskaApi), enabled: accountClient !== null }, accountClient ?? inertClient);
}

/** The companies whose entry was refused this visit (§4.33). */
export function useRefusedThisVisit(): ReadonlySet<string> {
  return useSyncExternalStore(onRefusedThisVisit, refusedThisVisit, refusedThisVisit);
}

/** The name the reader knows a company by: the list's, else the tab's record, else `null`. */
export function useCompanyName(companyId: string | null): string | null {
  const companies = useCompanies();
  const workspace = useWorkspace();
  if (companyId === null) return null;
  const listed = companies.data?.find((tenant) => tenant.id === companyId)?.name ?? null;
  return listed ?? (workspace?.tenantId === companyId ? workspace.tenantName : null);
}

/**
 * The tab's company's state marker (TAS-512, DESIGN.md §4.34): «blocked»,
 * «paused» or «read-only», or `null`. From what the tab already holds — the
 * company as last read (`["tenant", id]`, never fetched here) or its row of
 * the reader's list, whichever answered last — so it changes in the frame
 * they do, and asks the server nothing (art-director G8). Inert in today's
 * build.
 *
 * With the company read's own options (release-reviewer L-2): an observer's
 * options become the query's, so a bare one would hand the next refetch of
 * `["tenant", id]` — an invalidation's, while this is mounted — the client's
 * default retry, and a definite refusal or another company's answer would be
 * asked again (`retryUnanswered`).
 */
export function useCompanyMarker(companyId: string | null): CompanyMarker | null {
  const companies = useCompanies();
  const tenant = useQuery(
    { ...companyTenantOptions(companyId ?? ""), enabled: false },
    companyId === null ? inertClient : undefined,
  );
  if (companyId === null) return null;
  const row = companies.data?.find((item) => item.id === companyId) ?? null;
  const read = tenant.data ?? null;
  const latest = read !== null && (row === null || tenant.dataUpdatedAt >= companies.dataUpdatedAt) ? read : row;
  return companyMarker(latest?.restrictions);
}

/**
 * «{Company} — Taska», «Choose a company — Taska» or «Taska» (§4.34) — the
 * companies build only. Back to «Taska» when the screen that set it goes, so a
 * page outside every company never carries a company's name.
 */
export function useDocumentTitle(title: string | null): void {
  useEffect(() => {
    if (title === null) return;
    document.title = title;
    return () => {
      document.title = "Taska";
    };
  }, [title]);
}

/**
 * The plan catalogue read ahead, on the account's client, wherever an entry to
 * «Create a company» is drawn (DESIGN.md §4.36 «Входы», TAS-501) — so the form
 * usually opens whole. Public and cached for the client's stale time: an entry
 * drawn again within it asks nothing. Inert in today's build.
 */
export function usePrefetchPlans(active = true): void {
  const accountClient = useAccountQueryClient();
  useEffect(() => {
    if (!active || accountClient === null) return;
    void accountClient.prefetchQuery(plansQueryOptions(taskaApi));
  }, [active, accountClient]);
}
