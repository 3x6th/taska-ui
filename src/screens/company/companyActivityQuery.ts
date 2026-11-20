import { queryOptions } from "@tanstack/react-query";
import { taskaApi } from "../../api/client";
import { apiErrorFacts, isWorkspaceClosed } from "../../api/errors";
import { ACTIVITY_PAGE_SIZE, activityKindsParam, type ListTenantActivityParams } from "../../api/tenantActivity";
import { ForeignCompanyAnswerError } from "../../api/tenants";
import { refetchFailedOnFocus } from "../../lib/queryClient";

/*
 * Company › Activity's read (TAS-524, api-contract-guard B1, B4, B7), on the
 * company session's own query client — so the key carries no company — and
 * its filters as the address holds them (§5.8 «Состояние — в URL»).
 */

export const COMPANY_ACTIVITY_KEY = ["company-activity"] as const;

/** The section's filters: the author's id (a UUID, or nothing) and the kinds as the address has them. */
export interface ActivityFilters {
  actorUserId: string | null;
  kinds: string[];
}

/** The address's two query keys — the wire's names (§4.41 «Адрес»). */
export const ACTOR_PARAM = "actorUserId";
export const KIND_PARAM = "kind";

/** A UUID, either case — the only author id that is sent (B7). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isActivityActorId = (value: string | null | undefined): value is string => typeof value === "string" && UUID.test(value);

/**
 * The filters an address holds. An author id that is not a UUID is not a
 * filter (`badActor` says the address carries one, to be removed with
 * `replace`); the kinds are kept as they stand — the server validates them.
 */
export function readActivityFilters(search: URLSearchParams): ActivityFilters & { badActor: boolean } {
  const actor = search.get(ACTOR_PARAM);
  const kinds = search.getAll(KIND_PARAM).filter((kind) => kind !== "");
  return { actorUserId: isActivityActorId(actor) ? actor : null, kinds, badActor: actor !== null && !isActivityActorId(actor) };
}

/** The address with `filters` written over the section's two keys; every other key kept as it was. */
export function writeActivityFilters(search: URLSearchParams, filters: ActivityFilters): URLSearchParams {
  const next = new URLSearchParams(search);
  next.delete(ACTOR_PARAM);
  next.delete(KIND_PARAM);
  if (filters.actorUserId !== null) next.set(ACTOR_PARAM, filters.actorUserId);
  for (const kind of filters.kinds) next.append(KIND_PARAM, kind);
  return next;
}

export const isFiltered = (filters: ActivityFilters) => filters.actorUserId !== null || filters.kinds.length > 0;

/** One filter is one key: the kinds as the wire sends them. */
export const activityKey = (filters: ActivityFilters) =>
  [...COMPANY_ACTIVITY_KEY, filters.actorUserId, activityKindsParam(filters.kinds)] as const;

/** The parameters of a page: always 50, the filters, and a cursor for a continuation (B1). */
export function activityParams(filters: ActivityFilters, cursor?: string): ListTenantActivityParams {
  return {
    limit: ACTIVITY_PAGE_SIZE,
    ...(filters.actorUserId !== null ? { actorUserId: filters.actorUserId } : {}),
    ...(filters.kinds.length > 0 ? { kinds: filters.kinds } : {}),
    ...(cursor !== undefined ? { cursor } : {}),
  };
}

/**
 * One retry, for an answer that never came — no status, 408 or 5xx (B3) —
 * and never for a 429, whose wait the screen says; nor for a refusal, an
 * answer about another company (B3) or one from a company session the tab
 * has left.
 */
export function retryActivity(failureCount: number, error: unknown): boolean {
  if (failureCount >= 1 || isWorkspaceClosed(error) || error instanceof ForeignCompanyAnswerError) return false;
  const { status } = apiErrorFacts(error);
  return status === null || status === 408 || status >= 500;
}

/**
 * The first page — the only page a query holds (B4): every entry, «Try
 * again», «Start again» and a change of filter read it again, and the pages
 * «Show more» added are the section's own, dropped rather than re-read.
 * Stale at once, so a re-entry draws the cached first page and reads it anew;
 * a failed one is read again on return to the tab (`refetchFailedOnFocus`,
 * the client's default), which a failed continuation never is — it is not
 * this query's.
 */
export const companyActivityOptions = (companyId: string, filters: ActivityFilters) =>
  queryOptions({
    queryKey: activityKey(filters),
    queryFn: () => taskaApi.listTenantActivity(companyId, activityParams(filters)),
    staleTime: 0,
    retry: retryActivity,
    // The client's rule, carried by the query: a reconnect or a return to the tab reads only a failed first page, never drops «Show more» pages.
    refetchOnReconnect: refetchFailedOnFocus,
    refetchOnWindowFocus: refetchFailedOnFocus,
    // A re-read is a new first page, never the old one with its continuation's place kept.
    structuralSharing: false,
  });
