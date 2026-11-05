import { useQuery } from "@tanstack/react-query";
import { Check, ChevronRight, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { taskaApi } from "../api/client";
import { apiErrorFacts } from "../api/errors";
import { AuthShell } from "../components/AuthShell";
import { useCompanies, useDocumentTitle, usePrefetchPlans, useRefusedThisVisit, useWorkspace } from "../hooks/useCompanies";
import { AddressLink } from "../components/CompanyRouter";
import { ErrorNote } from "../components/ErrorNote";
import {
  COMPANY_HOME,
  CREATE_COMPANY_ROUTE,
  companyRoute,
  documentTitleFor,
  inCompanyRest,
  orderTenants,
  tenantGroup,
  tenantStateLine,
} from "../lib/companies";
import type { ScreenProps } from "./App";
import { leftStatus } from "./company/companyMembersText";

/** What a navigation to `/companies` may carry (§4.33). */
export interface CompaniesRouteState {
  /** An in-company address the tab could not open without a company: «Choose a company to open the link.» */
  from?: string | null;
  /** Arrived from inside the app or from signing in — the heading takes focus (§7 exception 4). */
  focusHeading?: boolean;
  /** Arrived by signing in: a read that fails is announced, as the answer to that press. */
  afterSignIn?: boolean;
  /** Arrived by leaving a company (TAS-502, §4.38): the hidden status says «You left {Company}.» */
  left?: { name: string | null };
}

/**
 * DESIGN.md §4.33 «Выбор компании» (TAS-500, the companies build only):
 * `/companies` in the login card's shell. Every company of the reader is a
 * link — the server, not the list, answers whether it can be entered — first
 * the working ones, then the closed, by name. Signed in as, and Log out, at
 * the foot. Since TAS-501 «Create a company» (§4.36): a row under the list,
 * or the card's primary when there is no working company to choose.
 */
export function CompaniesScreen({ theme, toggleTheme, onLogout, logoutPending }: ScreenProps) {
  const location = useLocation();
  const state = (location.state ?? {}) as CompaniesRouteState;
  const from = typeof state.from === "string" ? inCompanyRest(state.from) : null;
  const companies = useCompanies();
  const me = useQuery({ queryKey: ["me"], queryFn: () => taskaApi.getCurrentUser() });
  const workspace = useWorkspace();
  const refused = useRefusedThisVisit();
  const heading = useRef<HTMLHeadingElement>(null);
  /** How many times «Try again» was pressed — a failure that answers one is announced and remounted (§4.27). */
  const [retries, setRetries] = useState(0);
  /** «You left {Company}.» — put into the region after it mounted, so it is announced (§5.6). */
  const [leftSaid, setLeftSaid] = useState<string | null>(null);

  useDocumentTitle(documentTitleFor({ companyName: null, inCompany: false, picker: true }));
  useEffect(() => {
    if (state.focusHeading || state.afterSignIn) heading.current?.focus();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- after mount, so the status region speaks it.
    if (state.left) setLeftSaid(leftStatus(state.left.name ?? null));
    // On arrival only: the first screen of a tab takes no focus (§4.33 «Фокус»).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tenants = companies.data ? orderTenants(companies.data, refused) : null;
  const empty = tenants !== null && tenants.length === 0;
  const working = tenants !== null && tenants.some((tenant) => tenantGroup(tenant, refused) === 1);
  usePrefetchPlans(tenants !== null);
  const createPrimary = (
    <AddressLink className="primary-button auth-submit companies-create-primary" path={CREATE_COMPANY_ROUTE}>
      Create a company
    </AddressLink>
  );
  const failed = companies.isError && tenants === null;
  const userId = me.data?.id ?? null;

  return (
    <AuthShell theme={theme} toggleTheme={toggleTheme}>
      <div className="companies-card">
        <h1 className="auth-title" ref={heading} tabIndex={-1}>
          {empty ? "You’re not in a company yet" : "Choose a company"}
        </h1>
        {from !== null && !empty ? <p className="companies-subtitle">Choose a company to open the link.</p> : null}

        {failed ? (
          <div className="companies-failure">
            <ErrorNote
              key={retries}
              live={retries > 0 || state.afterSignIn ? "alert" : undefined}
              requestId={apiErrorFacts(companies.error).requestId}
              serverWords={apiErrorFacts(companies.error).message}
            >
              Your companies could not be loaded.
            </ErrorNote>
            <button
              aria-disabled={companies.isFetching || undefined}
              className="secondary-button auth-retry"
              onClick={() => {
                if (companies.isFetching) return;
                setRetries((count) => count + 1);
                void companies.refetch();
              }}
              type="button"
            >
              Try again
            </button>
          </div>
        ) : tenants === null ? (
          <p className="companies-loading" role="status">
            Loading your companies
          </p>
        ) : empty ? (
          <>
            <p className="auth-text companies-empty">
              Work in Taska happens inside a company. Create one, or ask a company admin to invite you.
            </p>
            {createPrimary}
          </>
        ) : (
          <>
            <ul aria-label="Companies" className="company-list">
              {tenants.map((tenant) => {
                const current = workspace?.tenantId === tenant.id;
                const line = tenantStateLine(tenant, refused);
                const name = tenant.name ?? "Unnamed company";
                return (
                  <li key={tenant.id}>
                    <AddressLink
                      aria-current={current ? "true" : undefined}
                      className={tenantGroup(tenant, refused) === 1 ? "company-row" : "company-row is-closed"}
                      path={companyRoute(tenant.id, from ?? COMPANY_HOME)}
                      // A company that has never opened continues in this card (§4.37, §3).
                      state={{ continuedShell: true }}
                    >
                      <span className="company-row-text">
                        <span className="company-row-name" title={name}>
                          {name}
                        </span>
                        {line ? <span className="company-row-state">{line}</span> : null}
                      </span>
                      {userId !== null && tenant.ownerId === userId ? <span className="company-row-owner">Owner</span> : null}
                      {current ? (
                        <Check aria-hidden="true" className="company-row-mark" size={14} />
                      ) : (
                        <ChevronRight aria-hidden="true" className="company-row-chevron" size={14} />
                      )}
                    </AddressLink>
                  </li>
                );
              })}
            </ul>
            {/* Not a company, so outside the list and its count (§4.33 «Создать»). */}
            {working ? (
              <AddressLink className="company-create-row" path={CREATE_COMPANY_ROUTE}>
                <Plus aria-hidden="true" className="company-create-icon" size={15} />
                Create a company
              </AddressLink>
            ) : (
              createPrimary
            )}
          </>
        )}

        <p className="visually-hidden" role="status">
          {leftSaid ?? ""}
        </p>

        <footer className="companies-footer">
          {/* Its place is kept from the first frame, empty until the address is
              known, so the card does not jump when it arrives (§4.33). */}
          <p aria-hidden={me.data ? undefined : true} className="auth-hint companies-signed-in">
            {me.data ? `Signed in as ${me.data.email}` : "\u00a0"}
          </p>
          <button className="auth-ghost" disabled={logoutPending} onClick={onLogout} type="button">
            {logoutPending ? "Logging out…" : "Log out"}
          </button>
        </footer>
      </div>
    </AuthShell>
  );
}
