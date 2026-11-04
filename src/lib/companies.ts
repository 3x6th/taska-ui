import type { QueryClient } from "@tanstack/react-query";
import type { TaskaApi } from "../api/TaskaApi";
import { isKnownTenantLifecycle, readAllTenants, type Tenant } from "../api/tenants";

/*
 * The companies build's address and list rules (TAS-500, DESIGN.md §4.33,
 * §4.34, §4.35, §5.1) as pure functions, so the order a tab is routed by and
 * the words a company is described with are pinned by unit tests rather than
 * by whichever screen happens to draw them.
 */

/** The picker (§4.33). Outside every company. */
export const COMPANIES_ROUTE = "/companies";

/** The routes that live outside `/c/{companyId}` (§5.1). Everything else in the app lives inside it. */
export const OUTSIDE_COMPANY_ROUTES: readonly string[] = ["/login", "/invite", "/auth/callback", COMPANIES_ROUTE];

/** Where a company's address opens when nothing more specific was asked for. */
export const COMPANY_HOME = "/projects";

const pathnameOf = (path: string) => path.split(/[?#]/, 1)[0] || "/";

/** `/c/{companyId}` — the prefix every in-company route sits under. */
export function companyPrefix(companyId: string): string {
  return `/c/${encodeURIComponent(companyId)}`;
}

/** `/c/{companyId}{rest}` for an in-company route `rest` (`/projects`, `/browse/WEB-12?x=1`). */
export function companyRoute(companyId: string, rest: string = COMPANY_HOME): string {
  const tail = rest === "" || rest === "/" ? "" : rest.startsWith("/") ? rest : `/${rest}`;
  return `${companyPrefix(companyId)}${tail}`;
}

/**
 * The company an app path names and the route inside it, or `null` for a path
 * outside every company. `/c/{id}` alone is the company's root, `/`.
 */
export function splitCompanyRoute(path: string): { companyId: string; rest: string } | null {
  const match = /^\/c\/([^/?#]+)(.*)$/.exec(path);
  if (!match) return null;
  let companyId: string;
  try {
    companyId = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  if (companyId === "") return null;
  const rest = match[2] === "" ? "/" : match[2].startsWith("/") ? match[2] : `/${match[2]}`;
  return { companyId, rest };
}

/** Whether an app path is one of the four that live outside the companies (§5.1). */
export function isOutsideCompanies(path: string): boolean {
  const pathname = pathnameOf(path);
  return OUTSIDE_COMPANY_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

/**
 * The path an address without a company would open inside one (§5.1:
 * «Адрес без префикса — замена на тот же путь в компании вкладки»), or `null`
 * for one that is not an in-company page: the four outside routes, `/admin`
 * (absent in the companies build, §4.16) and anything unknown answer for
 * themselves.
 */
export function inCompanyRest(path: string): string | null {
  const pathname = pathnameOf(path);
  if (pathname === "/") return COMPANY_HOME;
  const inside = ["/projects", "/browse/", "/settings"];
  return inside.some((root) => pathname === root || pathname.startsWith(root.endsWith("/") ? root : `${root}/`))
    ? path
    : null;
}

/* ---------------------------------------------------------------- the list */

/**
 * The first group is the companies that are working, whatever stops them
 * writing; the second, those that are not — refused this visit, closed, being
 * set up or deleted (§4.33 «Строка состояния»). **A group is an order and a
 * colour, never admission**: every row is a link, and the server answers the
 * entry (api-contract-guard B4).
 */
export function tenantGroup(tenant: Tenant, refusedThisVisit: ReadonlySet<string>): 1 | 2 {
  if (refusedThisVisit.has(tenant.id)) return 2;
  switch (tenant.lifecycle) {
    case "DELETED":
    case "DELETING":
    case "AUTO_CLOSED":
    case "OWNER_CANCELLED":
    case "PROVISIONING":
      return 2;
    default:
      return 1;
  }
}

/** The row's second line (§4.33), the first that applies — or `null` for an active company. */
export function tenantStateLine(tenant: Tenant, refusedThisVisit: ReadonlySet<string>): string | null {
  if (refusedThisVisit.has(tenant.id)) return "You no longer have access";
  if (tenant.lifecycle === "DELETED") return "Deleted";
  if (tenant.lifecycle === "DELETING") return "Being deleted";
  if (tenant.lifecycle === "AUTO_CLOSED" || tenant.lifecycle === "OWNER_CANCELLED") return "Closed";
  if (tenant.lifecycle === "PROVISIONING") return "Being set up";
  if (tenant.restrictions.includes("PLATFORM_BLOCK")) return "Blocked by Taska";
  if (tenant.restrictions.includes("OWNER_PAUSE")) return "Paused by its owner";
  if (tenant.lifecycle === "AWAITING_PAYMENT") return "Awaiting first payment";
  if (tenant.lifecycle === null || tenant.lifecycle === "ACTIVE") return null;
  // A lifecycle this build does not know: the code as it came (§6, TAS-173).
  return isKnownTenantLifecycle(tenant.lifecycle) ? null : tenant.lifecycle;
}

/** The switcher row's one right slot (§4.34): «Blocked», «Paused», «Awaiting payment», or nothing. */
export function switcherStateLabel(tenant: Tenant): string | null {
  if (tenant.restrictions.includes("PLATFORM_BLOCK")) return "Blocked";
  if (tenant.restrictions.includes("OWNER_PAUSE")) return "Paused";
  if (tenant.lifecycle === "AWAITING_PAYMENT") return "Awaiting payment";
  return null;
}

const byName = (a: Tenant, b: Tenant) =>
  (a.name ?? "").localeCompare(b.name ?? "", undefined, { sensitivity: "base" }) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The first group, then the second; by name within each (`sensitivity: 'base'`), then by id. Never by use. */
export function orderTenants(tenants: readonly Tenant[], refusedThisVisit: ReadonlySet<string>): Tenant[] {
  return [...tenants].sort(
    (a, b) => tenantGroup(a, refusedThisVisit) - tenantGroup(b, refusedThisVisit) || byName(a, b),
  );
}

/**
 * Where a tab goes once the reader is signed in, or once it meets an address
 * without a company (§4.33 «Когда», §5.1), the first that applies:
 *
 * 1. the remembered address names a company — there;
 * 2. the `taska.lastCompany` hint names a company in the list — there;
 * 3. exactly one company in the first group — there, even with others in the
 *    second;
 * 4. otherwise the picker, still holding the remembered in-company path.
 *
 * In 2 and 3 a remembered address without a company opens inside the chosen
 * one; with none, the company's Projects.
 */
export function chooseCompanyRoute(input: {
  remembered: string | null;
  hint: string | null;
  tenants: readonly Tenant[];
  refusedThisVisit: ReadonlySet<string>;
}): { route: string } | { picker: true; from: string | null } {
  const { remembered, hint, tenants, refusedThisVisit } = input;
  if (remembered !== null && splitCompanyRoute(remembered) !== null) return { route: remembered };
  const rest = remembered === null ? null : inCompanyRest(remembered);
  if (hint !== null && tenants.some((tenant) => tenant.id === hint)) return { route: companyRoute(hint, rest ?? COMPANY_HOME) };
  const first = tenants.filter((tenant) => tenantGroup(tenant, refusedThisVisit) === 1);
  if (first.length === 1) return { route: companyRoute(first[0].id, rest ?? COMPANY_HOME) };
  return { picker: true, from: rest };
}

/* ----------------------------------------------------- the closed company */

export interface ClosedWords {
  title: string;
  /** `null` — print the server's words in its place (a code outside the table). */
  text: string | null;
}

/**
 * §4.35's table: the reason from the refusal — its code, then its reasons; a
 * code outside the table, or no refusal, takes it from the list row's
 * lifecycle, then its restrictions (a closed company may be answered with a
 * plain `INVALID_STATE` — the contract names no code, ask A2); no row either,
 * the table's last row, the server's words in place of the sentence. `name` is
 * the company's from the reader's list, else «This company».
 */
export function closedCompanyWords(
  name: string | null,
  refusal: { code: string | null; reasons: readonly string[] } | null,
  tenant: Tenant | null,
): ClosedWords {
  const company = name ?? "This company";
  const by = (key: string | null): ClosedWords | null => {
    switch (key) {
      case "MEMBERSHIP_INACTIVE":
        return {
          title: `You no longer have access to ${company}`,
          text: "Your membership was suspended or removed. If that’s a mistake, ask one of the company’s admins.",
        };
      case "PLATFORM_BLOCK":
        return { title: `${company} is blocked`, text: "Taska has blocked this company, so its projects can’t be opened right now." };
      case "OWNER_PAUSE":
        return { title: `${company} is paused`, text: "Its owner has paused it, so its projects can’t be opened right now." };
      case "PROVISIONING":
        return { title: `${company} is still being set up`, text: "Its projects can be opened once setup finishes." };
      case "AUTO_CLOSED":
      case "OWNER_CANCELLED":
        return { title: `${company} is closed`, text: "Its projects can no longer be opened." };
      case "DELETING":
        return { title: `${company} is being deleted`, text: "Its projects can no longer be opened." };
      case "DELETED":
        return { title: `${company} has been deleted`, text: "Its projects can no longer be opened." };
      default:
        return null;
    }
  };
  const first = (keys: readonly (string | null)[]) => keys.map(by).find((words) => words !== null) ?? null;
  return (
    first([refusal?.code ?? null, ...(refusal?.reasons ?? [])]) ??
    first([tenant?.lifecycle ?? null, ...(tenant?.restrictions ?? [])]) ?? { title: `${company} could not be opened`, text: null }
  );
}

/**
 * The document title (§4.34): «{Company} — Taska» under a company, «Choose a
 * company — Taska» on the picker, else «Taska» — which is also what a company
 * the reader's list does not name gets: a title never names a company the
 * screen would call «This company».
 */
export function documentTitleFor(path: { companyName: string | null; inCompany: boolean; picker: boolean }): string {
  if (path.inCompany) return path.companyName === null ? "Taska" : `${path.companyName} — Taska`;
  if (path.picker) return "Choose a company — Taska";
  return "Taska";
}

/* ------------------------------------------------- the account-level list */

/** The reader's companies, on the account's query client (they outlive every company session). */
export const TENANTS_QUERY_KEY = ["tenants"] as const;

export const tenantsQueryOptions = (api: Pick<TaskaApi, "listTenants">) => ({
  queryKey: TENANTS_QUERY_KEY,
  queryFn: () => readAllTenants((params) => api.listTenants(params)),
});

/** The company's name from the list the account client holds, or `null`. */
export function cachedTenantName(client: QueryClient, tenantId: string): string | null {
  return client.getQueryData<Tenant[]>(TENANTS_QUERY_KEY)?.find((tenant) => tenant.id === tenantId)?.name ?? null;
}

/**
 * The companies whose entry was refused `MEMBERSHIP_INACTIVE` in this visit
 * (§4.33's first state line) — a page's memory, not the server's, so it is
 * lost on reload, which asks again.
 */
const refused = new Set<string>();
const refusedListeners = new Set<() => void>();
let refusedSnapshot: ReadonlySet<string> = new Set();

export function markRefusedThisVisit(tenantId: string): void {
  if (refused.has(tenantId)) return;
  refused.add(tenantId);
  refusedSnapshot = new Set(refused);
  for (const listener of [...refusedListeners]) listener();
}

export function refusedThisVisit(): ReadonlySet<string> {
  return refusedSnapshot;
}

export function onRefusedThisVisit(listener: () => void): () => void {
  refusedListeners.add(listener);
  return () => {
    refusedListeners.delete(listener);
  };
}
