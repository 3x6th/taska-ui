import { QueryClient, useQuery } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";
import { taskaApi } from "../api/client";
import type { Workspace } from "../api/TaskaApi";
import { onRefusedThisVisit, refusedThisVisit, tenantsQueryOptions } from "../lib/companies";
import { useAccountQueryClient, useCompanyAddress } from "../lib/companyAddress";

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

