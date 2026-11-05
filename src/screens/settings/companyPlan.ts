import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { taskaApi } from "../../api/client";
import { refusalCode } from "../../api/errors";
import type { Tenant } from "../../api/tenants";
import { TENANTS_QUERY_KEY } from "../../lib/companies";
import { reasonsDifferFrom } from "../../lib/companyRestrictions";
import { COMPANY_SUBSCRIPTION_KEY, companyTenantKey } from "./companyGeneral";
import { COMPANY_QUOTAS_KEY, retryUnanswered } from "./companyMembersQuery";

/*
 * Settings › Plan (TAS-512, DESIGN.md §4.40) — its reads and when they are
 * read again, on the company session's own query client (so the keys carry
 * no company except `["tenant", companyId]`, TAS-501's). The page reads five
 * things in parallel for the owner and four for everybody else
 * (api-contract-guard §2, art-director G1): the company, its entitlement, its
 * quota snapshot, the public catalogue on the account's client, and — for the
 * owner only — its subscription (B1).
 */

/** Every member's plan read (`getEntitlement`); never asked with `read` (B8). */
export const COMPANY_ENTITLEMENT_KEY = ["company-entitlement"] as const;

export const companyEntitlementOptions = (companyId: string) =>
  queryOptions({
    queryKey: COMPANY_ENTITLEMENT_KEY,
    queryFn: () => taskaApi.getEntitlement(companyId),
    retry: retryUnanswered,
  });

/** The quota snapshot (`getTenantQuotas`) — the same key and options Members reads its seats by (§4.38). */
export const companyPlanQuotasOptions = (companyId: string) =>
  queryOptions({
    queryKey: COMPANY_QUOTAS_KEY,
    queryFn: () => taskaApi.getTenantQuotas(companyId),
    retry: retryUnanswered,
  });

/** The writes whose quota refusal re-reads the snapshot too (B4): inviting, a new project, an upload — never a new issue. */
export interface CompanyMutationMeta {
  quotaWrite?: boolean;
}

export const QUOTA_WRITE_META = { quotaWrite: true } satisfies CompanyMutationMeta;

/**
 * What a refused write makes the tab read again (api-contract-guard B4,
 * art-director G8): a `READ_ONLY`, `CAPABILITY_DISABLED` or `QUOTA_EXCEEDED`
 * may mean the plan or its restrictions moved, so the company, its
 * entitlement and the owner's subscription are invalidated — re-read where a
 * page shows them, otherwise when one next does; the snapshot only after a
 * refused invite, project or upload (`quotas`), not a new issue. A
 * `READ_ONLY` whose known reasons are not the cached list row's re-reads the
 * list and the company once, so the state marker appears after the first
 * refused write. Never a poll: one refusal, one invalidation.
 */
export function refreshAfterRefusal(
  error: unknown,
  context: { companyClient: QueryClient; accountClient: QueryClient | null; companyId: string; quotas: boolean },
): void {
  const code = refusalCode(error);
  if (code !== "READ_ONLY" && code !== "CAPABILITY_DISABLED" && code !== "QUOTA_EXCEEDED") return;
  const { companyClient, accountClient, companyId, quotas } = context;
  void companyClient.invalidateQueries({ queryKey: companyTenantKey(companyId) });
  void companyClient.invalidateQueries({ queryKey: COMPANY_ENTITLEMENT_KEY });
  void companyClient.invalidateQueries({ queryKey: COMPANY_SUBSCRIPTION_KEY });
  if (quotas) void companyClient.invalidateQueries({ queryKey: COMPANY_QUOTAS_KEY });
  if (code !== "READ_ONLY" || accountClient === null) return;
  const row = accountClient.getQueryData<Tenant[]>(TENANTS_QUERY_KEY)?.find((tenant) => tenant.id === companyId);
  if (reasonsDifferFrom(error, row?.restrictions)) void accountClient.invalidateQueries({ queryKey: TENANTS_QUERY_KEY });
}

/** `setTimeout`'s largest delay; a boundary further off is not waited for — a reload or a navigation reads it. */
export const MAX_TIMER_MS = 2_147_483_647;

/** The re-read again after the boundary's first (B4): once at the instant, once 60 s later, then never. */
export const BOUNDARY_AGAIN_MS = 60_000;

/**
 * The next boundary the owner's page waits for: the earliest of `paidThrough`
 * and `scheduledEffectiveAt` still ahead of `now` — the instant as sent, and
 * how far off it is in ms — or `null` (none ahead, or further than a timer
 * can wait).
 */
export function nextBoundary(instants: readonly (string | null)[], now: number = Date.now()): { at: string; inMs: number } | null {
  let soonest: { at: string; inMs: number } | null = null;
  for (const at of instants) {
    if (at === null) continue;
    const time = Date.parse(at);
    if (!Number.isFinite(time) || time <= now) continue;
    if (soonest === null || time - now < soonest.inMs) soonest = { at, inMs: time - now };
  }
  return soonest !== null && soonest.inMs <= MAX_TIMER_MS ? soonest : null;
}
