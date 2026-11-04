import type { QueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from "react";
import { BrowserRouter, HashRouter, useLocation } from "react-router-dom";
import { ROUTER_MODE } from "../lib/appLinks";
import { companyPrefix, splitCompanyRoute } from "../lib/companies";
import {
  AccountClientContext,
  CompanyAddressContext,
  hrefFor,
  readAppPath,
  rootBase,
  useCompanyAddress,
  type CompanyAddress,
} from "../lib/companyAddress";

/*
 * The address names the company (TAS-500, DESIGN.md §5.1). In the companies
 * build every in-company page lives under `/c/{companyId}`, and the router is
 * given that prefix as its `basename` — so the app's own links and
 * navigations (`to="/projects"`, `navigate("/settings")`) stay inside the
 * company without one of them knowing a company exists. A different company
 * is a different prefix, and a different prefix is a new router: it is keyed
 * by the company, so everything under it mounts afresh and nothing rendered
 * for one company can be on screen under another's.
 *
 * Outside every company — `/login`, `/invite`, `/auth/callback`,
 * `/companies` — the router has no prefix. Crossing the line is `go`: it
 * writes the history entry React Router would have written and announces it
 * the way the browser announces Back, so the router in charge picks it up, or
 * a new one is mounted for the new prefix.
 *
 * Today's build never renders this: `src/main.tsx` keeps its one router.
 */

const companyOf = (path: string) => splitCompanyRoute(path)?.companyId ?? null;

function routerKey(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function CompanyRouter({ children }: { children: ReactNode }) {
  const [companyId, setCompanyId] = useState(() => companyOf(readAppPath()));

  useEffect(() => {
    const follow = () => setCompanyId(companyOf(readAppPath()));
    window.addEventListener("popstate", follow);
    if (ROUTER_MODE === "hash") window.addEventListener("hashchange", follow);
    return () => {
      window.removeEventListener("popstate", follow);
      window.removeEventListener("hashchange", follow);
    };
  }, []);

  const go = useCallback((path: string, options: { replace?: boolean; state?: unknown } = {}) => {
    const current = (window.history.state ?? {}) as { idx?: unknown };
    const index = typeof current.idx === "number" ? current.idx : 0;
    // The shape React Router's own history writes (`usr`, `key`, `idx`), so the
    // router that reads this entry — this one or the next — sees its state.
    const entry = { usr: options.state ?? null, key: routerKey(), idx: options.replace ? index : index + 1 };
    if (options.replace) window.history.replaceState(entry, "", hrefFor(path));
    else window.history.pushState(entry, "", hrefFor(path));
    // As the browser announces Back: the mounted router follows a move within
    // its prefix, and `follow` above remounts one for a new prefix.
    window.dispatchEvent(new PopStateEvent("popstate", { state: entry }));
  }, []);

  const Router = ROUTER_MODE === "hash" ? HashRouter : BrowserRouter;
  const basename = `${rootBase()}${companyId === null ? "" : companyPrefix(companyId)}`;
  const address: CompanyAddress = { companyId, go, href: hrefFor };

  return (
    <CompanyAddressContext.Provider value={address}>
      <Router basename={basename || undefined} key={companyId ?? ""} useTransitions={false}>
        {children}
      </Router>
    </CompanyAddressContext.Provider>
  );
}

/**
 * A link to an app path the router cannot reach by itself — another company,
 * or the picker from inside one: a real `href`, so a modifier, a middle click
 * and "Open link in new tab" open a new tab in that company (§5.1), and a
 * plain click is `go`.
 */
export function AddressLink({
  path,
  state,
  onFollow,
  children,
  ...rest
}: {
  path: string;
  /** Router state for the entry a plain click makes. */
  state?: unknown;
  onFollow?: () => void;
  children: ReactNode;
} & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  const address = useCompanyAddress();
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    rest.onClick?.(event);
    if (event.defaultPrevented || !address) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (rest["aria-disabled"] === true || rest["aria-disabled"] === "true") return;
    onFollow?.();
    address.go(path, { state });
  };
  return (
    <a {...rest} href={address ? address.href(path) : path} onClick={onClick}>
      {children}
    </a>
  );
}

/**
 * Inside a company, one of the four routes outside every company was asked
 * for — `navigate("/login")` from code that does not know about companies.
 * The same entry is moved out of the prefix, router state and all.
 */
export function LeaveCompanyPrefix() {
  const location = useLocation();
  const address = useCompanyAddress();
  useEffect(() => {
    address?.go(`${location.pathname}${location.search}${location.hash}`, { replace: true, state: location.state });
  }, [address, location]);
  return null;
}

/**
 * The account's query client in the companies build: what outlives every
 * company session — the company list, the account on `/companies` — while
 * each company session gets a client of its own (`CompanyGate`, DESIGN.md §6).
 */
export function AccountClientProvider({ client, children }: { client: QueryClient; children: ReactNode }) {
  return <AccountClientContext.Provider value={client}>{children}</AccountClientContext.Provider>;
}

