import { useIsMutating } from "@tanstack/react-query";
import { Building2, Check, ChevronsUpDown, Plus } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { apiErrorFacts } from "../api/errors";
import { useDismissOnOutside } from "../hooks/useDismissOnOutside";
import {
  COMPANIES_ROUTE,
  CREATE_COMPANY_ROUTE,
  companyRoute,
  orderTenants,
  switcherStateLabel,
  tenantGroup,
} from "../lib/companies";
import { useCompanies, useCompanyMarker, useCompanyName, usePrefetchPlans, useRefusedThisVisit } from "../hooks/useCompanies";
import { AddressLink } from "./CompanyRouter";
import { useAppPath, useCompanyAddress } from "../lib/companyAddress";
import { ErrorNote } from "./ErrorNote";

/**
 * Set by a switch from the popover: the bar of the company switched to is a
 * new one (the router is keyed by the company), and its trigger takes focus
 * when it mounts — the name on it is the announcement (DESIGN.md §4.34).
 */
let focusTriggerOnMount = false;

/**
 * DESIGN.md §4.34 «Переключатель компании» (TAS-500, the companies build
 * only): in the shared bar after the logo, at 768 and wider (the CSS hides it
 * below — the profile menu's «Switch company» is the way there). The company
 * is the tab's, and switching changes this tab alone.
 */
export function CompanySwitcher() {
  const address = useCompanyAddress();
  const companyId = address?.companyId ?? null;
  const companies = useCompanies();
  const name = useCompanyName(companyId);
  // TAS-512 (§4.34): «blocked», «paused» or «read-only», so a member learns of it before a write is refused.
  const marker = useCompanyMarker(companyId);
  const refused = useRefusedThisVisit();
  // A write of this tab in flight: the other companies wait (api-contract-guard §4).
  const writing = useIsMutating() > 0;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverId = useId();
  const appPath = useAppPath();

  useDismissOnOutside(open, rootRef, () => setOpen(false), triggerRef);
  // «Create a company» is drawn while the popover is open (TAS-501, §4.36 «Входы»).
  usePrefetchPlans(open);

  useEffect(() => {
    if (!focusTriggerOnMount) return;
    focusTriggerOnMount = false;
    triggerRef.current?.focus();
  }, []);

  const rows = companies.data ? orderTenants(companies.data, refused).filter((tenant) => tenantGroup(tenant, refused) === 1) : null;
  const known = name !== null;
  const unread = !known && companies.isPending;

  return (
    <div className="company-switcher" ref={rootRef}>
      <button
        aria-controls={open ? popoverId : undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`${name ?? "Company"}${marker ? `, ${marker}` : ""}, switch company`}
        className="company-switcher-trigger"
        disabled={unread}
        onClick={() => setOpen((value) => !value)}
        ref={triggerRef}
        title={name ?? undefined}
        type="button"
      >
        {unread ? (
          <span aria-hidden="true" className="value-skeleton company-switcher-skeleton" />
        ) : (
          <span className={known ? "company-switcher-name" : "company-switcher-name is-unknown"}>{name ?? "Company"}</span>
        )}
        {marker && !unread ? (
          <span aria-hidden="true" className="company-marker">
            {marker}
          </span>
        ) : null}
        <ChevronsUpDown aria-hidden="true" className="company-switcher-chevron" size={13} />
      </button>

      {open ? (
        <section aria-label="Companies" className="company-switcher-popover" id={popoverId} role="dialog">
          {rows === null && companies.isError ? (
            <div className="company-switcher-failure">
              <ErrorNote requestId={apiErrorFacts(companies.error).requestId}>Your companies could not be loaded.</ErrorNote>
            </div>
          ) : rows === null ? null : (
            <ul className="company-switcher-list">
              {rows.map((tenant) => {
                const current = tenant.id === companyId;
                const blocked = writing && !current;
                const label = current ? null : switcherStateLabel(tenant);
                const rowName = tenant.name ?? "Unnamed company";
                return (
                  <li key={tenant.id}>
                    <AddressLink
                      aria-current={current ? "true" : undefined}
                      aria-disabled={blocked ? "true" : undefined}
                      className="company-switcher-row"
                      onFollow={() => {
                        setOpen(false);
                        if (current) triggerRef.current?.focus();
                        else focusTriggerOnMount = true;
                      }}
                      path={companyRoute(tenant.id)}
                    >
                      <span className="company-switcher-row-name" title={rowName}>
                        {rowName}
                      </span>
                      {current ? (
                        <Check aria-hidden="true" className="company-switcher-mark" size={14} />
                      ) : label && !blocked ? (
                        <span className="company-switcher-state">{label}</span>
                      ) : null}
                    </AddressLink>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="company-switcher-footer">
            <AddressLink className="user-profile-link" path={COMPANIES_ROUTE} state={{ focusHeading: true }}>
              <Building2 aria-hidden="true" size={15} />
              All companies
            </AddressLink>
            {/* Leaves the company like «All companies», so a write in flight does not hold it (§4.34);
                Cancel on the form comes back to this address (§4.36). */}
            <AddressLink className="user-profile-link" path={CREATE_COMPANY_ROUTE} state={{ from: appPath }}>
              <Plus aria-hidden="true" size={15} />
              Create a company
            </AddressLink>
          </div>
        </section>
      ) : null}
    </div>
  );
}
