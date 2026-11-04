import type { QueryClient } from "@tanstack/react-query";
import { createContext, useContext } from "react";
import { useLocation } from "react-router-dom";
import { ROUTER_MODE } from "./appLinks";
import { companyPrefix } from "./companies";

/*
 * The companies build's address context (TAS-500): what `CompanyRouter`
 * (src/components/CompanyRouter.tsx) provides, read by the hooks below. Kept
 * apart from the components so a hook can be imported anywhere.
 */

export interface CompanyAddress {
  /** The company the address names; `null` outside every company. */
  companyId: string | null;
  /**
   * Navigates to an app path, across the company prefix if need be — a push by
   * default, so Back returns to the page and company left (§4.34).
   */
  go: (path: string, options?: { replace?: boolean; state?: unknown }) => void;
  /** The `href` an app path has under this build's routing scheme. */
  href: (path: string) => string;
}

export const CompanyAddressContext = createContext<CompanyAddress | null>(null);

/** The companies build's address, or `null` in today's build — which is how a component tells the two apart. */
export function useCompanyAddress(): CompanyAddress | null {
  return useContext(CompanyAddressContext);
}

export const rootBase = () => import.meta.env.BASE_URL.replace(/\/+$/, "");

/** The app path the window is at: the route after `#` under hash routing, the path under the base otherwise. */
export function readAppPath(): string {
  if (ROUTER_MODE === "hash") {
    const route = window.location.hash.replace(/^#/, "");
    return route === "" ? "/" : route.startsWith("/") ? route : `/${route}`;
  }
  const base = rootBase();
  const pathname = window.location.pathname;
  const inside = base !== "" && pathname.startsWith(base) ? pathname.slice(base.length) || "/" : pathname;
  return `${inside}${window.location.search}`;
}

/** The `href` of an app path under this build's routing scheme. */
export function hrefFor(path: string): string {
  if (ROUTER_MODE === "hash") return `${window.location.pathname}${window.location.search}#${path}`;
  return `${rootBase()}${path}`;
}

/** The app path of the page, company prefix included — what a sign-in returns to (§4.33 «Когда»). */
export function useAppPath(): string {
  const location = useLocation();
  const address = useCompanyAddress();
  const prefix = address?.companyId ? companyPrefix(address.companyId) : "";
  return `${prefix}${location.pathname === "/" && prefix ? "" : location.pathname}${location.search}`;
}

export const AccountClientContext = createContext<QueryClient | null>(null);

/** The account's query client in the companies build; `null` in today's build. */
export function useAccountQueryClient(): QueryClient | null {
  return useContext(AccountClientContext);
}
