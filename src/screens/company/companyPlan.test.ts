import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { Tenant } from "../../api/tenants";
import { TENANTS_QUERY_KEY } from "../../lib/companies";
import { MAX_TIMER_MS, nextBoundary, refreshAfterRefusal } from "./companyPlan";

/*
 * When the plan reads are read again (TAS-512, api-contract-guard B4,
 * art-director G8): which refusals invalidate them, the snapshot only after a
 * quota write, the list once when a READ_ONLY's reasons are not the cached
 * row's — and the owner's boundary.
 */

const NW = "0b6f3c1e-4a2d-4e8b-9c7f-1d2e3f4a5b01";
const refusal = (code: string, reasons: string[] = []) =>
  Object.assign(new Error("words"), { status: code === "QUOTA_EXCEEDED" ? 422 : 403, code, requestId: "rid", details: null, reasons });
const row = (restrictions: string[]): Tenant => ({
  id: NW,
  name: "Northwind",
  ownerId: "anna",
  lifecycle: "ACTIVE",
  restrictions,
  createdAt: null,
  creationDeadline: null,
  version: "3",
});

function clients(listed: string[] = []) {
  const companyClient = new QueryClient();
  const accountClient = new QueryClient();
  accountClient.setQueryData(TENANTS_QUERY_KEY, [row(listed)]);
  const company = vi.spyOn(companyClient, "invalidateQueries");
  const account = vi.spyOn(accountClient, "invalidateQueries");
  const keys = () => company.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey));
  return { companyClient, accountClient, company, account, keys };
}

describe("refreshAfterRefusal (B4)", () => {
  it("a READ_ONLY: the company, the entitlement and the subscription — and the list once its reasons are not the row's", () => {
    const { companyClient, accountClient, account, keys } = clients([]);
    refreshAfterRefusal(refusal("READ_ONLY", ["OVER_QUOTA"]), { companyClient, accountClient, companyId: NW, quotas: false });
    expect(keys()).toEqual([JSON.stringify(["tenant", NW]), JSON.stringify(["company-entitlement"]), JSON.stringify(["company-subscription"])]);
    expect(account).toHaveBeenCalledTimes(1);
    expect(account.mock.calls[0][0]?.queryKey).toEqual(TENANTS_QUERY_KEY);
  });

  it("the same reasons as the row: no list read", () => {
    const { companyClient, accountClient, account } = clients(["OVER_QUOTA"]);
    refreshAfterRefusal(refusal("READ_ONLY", ["OVER_QUOTA"]), { companyClient, accountClient, companyId: NW, quotas: false });
    expect(account).not.toHaveBeenCalled();
  });

  it("the snapshot only after a quota write — an invite, a project, an upload; never a new issue", () => {
    const issue = clients();
    refreshAfterRefusal(refusal("QUOTA_EXCEEDED"), { ...issue, companyId: NW, quotas: false });
    expect(issue.keys()).not.toContain(JSON.stringify(["company-quotas"]));
    const project = clients();
    refreshAfterRefusal(refusal("QUOTA_EXCEEDED"), { ...project, companyId: NW, quotas: true });
    expect(project.keys()).toContain(JSON.stringify(["company-quotas"]));
    // A QUOTA_EXCEEDED is no restriction: the list is not read.
    expect(project.account).not.toHaveBeenCalled();
  });

  it("any other refusal reads nothing again", () => {
    for (const code of ["VALIDATION_FAILED", "SCOPE_DENIED", "PERMISSION_DENIED"]) {
      const { companyClient, accountClient, company, account } = clients();
      refreshAfterRefusal(refusal(code), { companyClient, accountClient, companyId: NW, quotas: true });
      expect(company).not.toHaveBeenCalled();
      expect(account).not.toHaveBeenCalled();
    }
  });
});

describe("the owner's boundary", () => {
  it("the soonest instant ahead, as sent — none past, none unreadable, none beyond a timer's reach", () => {
    const now = Date.parse("2026-11-05T10:00:00Z");
    expect(nextBoundary(["2026-11-05T10:00:05Z", "2026-11-05T10:00:03Z"], now)).toEqual({ at: "2026-11-05T10:00:03Z", inMs: 3_000 });
    expect(nextBoundary(["2026-11-05T09:00:00Z", null, "soon"], now)).toBeNull();
    expect(nextBoundary([new Date(now + MAX_TIMER_MS + 1).toISOString()], now)).toBeNull();
  });
});
