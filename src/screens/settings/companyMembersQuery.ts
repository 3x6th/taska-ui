import { queryOptions } from "@tanstack/react-query";
import { taskaApi } from "../../api/client";
import { readAllPages } from "../../api/tenantMembers";
import { isIndefinite } from "./companyMembers";

/*
 * Settings › Members' three reads (TAS-502, api-contract-guard §4, §8), on
 * the company session's own query client — so the keys carry no company: a
 * company is a client of its own, and nothing cached under one session is
 * read under another (DESIGN.md §6).
 */

export const COMPANY_MEMBERS_KEY = ["company-members"] as const;
export const COMPANY_INVITATIONS_KEY = ["company-invitations"] as const;
export const COMPANY_QUOTAS_KEY = ["company-quotas"] as const;

/** One retry for an answer that never came; never for a refusal, which says the same the second time. */
const retryUnanswered = (failureCount: number, error: Error) => failureCount < 1 && isIndefinite(error);

/** Every member, all pages, before the first draw (§4.38). */
export const companyMembersOptions = (tenantId: string) =>
  queryOptions({
    queryKey: COMPANY_MEMBERS_KEY,
    queryFn: () => readAllPages((params) => taskaApi.listTenantMembers(tenantId, params)),
    retry: retryUnanswered,
  });

/** A company admin's read only: never asked for anybody else (B8). */
export const companyInvitationsOptions = (tenantId: string) =>
  queryOptions({
    queryKey: COMPANY_INVITATIONS_KEY,
    queryFn: () => readAllPages((params) => taskaApi.listTenantInvitations(tenantId, params)),
    retry: retryUnanswered,
  });

/** The seats — admins only on this page, where the seat line is theirs (§4.38 «Места»). */
export const companyQuotasOptions = (tenantId: string) =>
  queryOptions({
    queryKey: COMPANY_QUOTAS_KEY,
    queryFn: () => taskaApi.getTenantQuotas(tenantId),
    retry: retryUnanswered,
  });
