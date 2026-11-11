import { describe, expect, it, vi } from "vitest";
import {
  isKnownRestrictionCode,
  isKnownTenantLifecycle,
  readAllPlans,
  readAllTenants,
  tenantNameProblem,
  toCreateTenantResult,
  toMoney,
  toPlanVersion,
  toPlanVersionPage,
  toQuotaLimit,
  toSubscription,
  toTenant,
  toTenantOperation,
  toTenantPage,
  trimTenantName,
  withoutControlCharacters,
  type TenantPage,
} from "./tenants";

const wire = {
  id: "0b6f3c1e-4a2d-4e8b-9c7f-1d2e3f4a5b01",
  name: "Northwind",
  ownerId: "6d774efa-57d8-4ae0-a27e-2984d1dfbbf6",
  lifecycle: "ACTIVE",
  restrictions: ["OWNER_PAUSE"],
  createdAt: "2026-05-01T09:00:00Z",
  version: "3",
  ownerVersion: "1",
};

describe("a company as the list sends it (TAS-500)", () => {
  it("reads every field the screens use and leaves ownerVersion behind", () => {
    expect(toTenant(wire)).toEqual({
      id: wire.id,
      name: "Northwind",
      ownerId: wire.ownerId,
      lifecycle: "ACTIVE",
      restrictions: ["OWNER_PAUSE"],
      createdAt: "2026-05-01T09:00:00Z",
      creationDeadline: null,
      version: "3",
    });
  });

  it("keeps a lifecycle or restriction this build does not know as its string — never dropped, never a throw", () => {
    const tenant = toTenant({ ...wire, lifecycle: "HIBERNATING", restrictions: ["TAX_HOLD", "OWNER_PAUSE"] });
    expect(tenant?.lifecycle).toBe("HIBERNATING");
    expect(tenant?.restrictions).toEqual(["TAX_HOLD", "OWNER_PAUSE"]);
    expect(isKnownTenantLifecycle("HIBERNATING")).toBe(false);
    expect(isKnownTenantLifecycle("AUTO_CLOSED")).toBe(true);
    expect(isKnownRestrictionCode("TAX_HOLD")).toBe(false);
    expect(isKnownRestrictionCode("PLATFORM_BLOCK")).toBe(true);
  });

  it("states null for what is not what the schema promises, and drops a row nobody could enter", () => {
    expect(toTenant({ id: wire.id, name: 7, lifecycle: null, restrictions: [1, "", "OVER_QUOTA"], creationDeadline: "2026-06-01T00:00:00Z" })).toEqual({
      id: wire.id,
      name: null,
      ownerId: null,
      lifecycle: null,
      restrictions: ["OVER_QUOTA"],
      createdAt: null,
      creationDeadline: "2026-06-01T00:00:00Z",
      version: null,
    });
    expect(toTenant({ ...wire, id: "" })).toBeNull();
    expect(toTenant(null)).toBeNull();
    expect(toTenantPage({ items: [wire, { name: "no id" }, "x"], nextCursor: "" })).toEqual({ items: [toTenant(wire)], nextCursor: null });
    expect(toTenantPage(undefined)).toEqual({ items: [], nextCursor: null });
  });
});

describe("reading every company (DESIGN.md §4.33)", () => {
  const page = (ids: string[], nextCursor: string | null): TenantPage => ({
    items: ids.map((id) => toTenant({ ...wire, id })!),
    nextCursor,
  });

  it("asks 100 at a time and follows nextCursor until it is absent", async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce(page(["a", "b"], "c1"))
      .mockResolvedValueOnce(page(["c"], null));
    expect((await readAllTenants(list)).map((tenant) => tenant.id)).toEqual(["a", "b", "c"]);
    expect(list.mock.calls).toEqual([[{ limit: 100 }], [{ cursor: "c1", limit: 100 }]]);
  });

  it("stops on a cursor the server repeats rather than spinning", async () => {
    const list = vi.fn().mockResolvedValue(page(["a"], "same"));
    await readAllTenants(list);
    expect(list).toHaveBeenCalledTimes(2);
  });
});

/* ------------------------------------------------ creating a company (TAS-501) */

const plan = {
  kind: "PAID",
  id: "7d2c4e1a-5b3f-4a6c-9e8d-0f1a2b3c4d02",
  code: "team",
  version: "2",
  name: "Team",
  price: { amountMinor: "2000", currency: "EUR", exponent: 2 },
  period: "CALENDAR_MONTH",
  limits: [
    { kind: "PROJECT", limit: "5", unlimited: false },
    { kind: "TASK_LIFETIME", unlimited: true },
  ],
  capabilities: ["projects.basic"],
  state: "PUBLISHED",
  publishedAt: "2026-05-01T00:00:00Z",
};

describe("a plan as the catalogue sends it (api-contract-guard §1, §9 parity)", () => {
  it("reads what the form draws, leaves capabilities unread, and keeps money a string", () => {
    expect(toPlanVersion(plan)).toEqual({
      id: plan.id,
      kind: "PAID",
      code: "team",
      name: "Team",
      version: "2",
      price: { amountMinor: "2000", currency: "EUR", exponent: 2 },
      period: "CALENDAR_MONTH",
      limits: [
        { kind: "PROJECT", limit: "5", unlimited: false },
        { kind: "TASK_LIFETIME", limit: null, unlimited: true },
      ],
      state: "PUBLISHED",
    });
    expect(toPlanVersion(plan)).not.toHaveProperty("capabilities");
  });

  it("keeps a period, state, currency or quota kind this build does not know as its string", () => {
    const read = toPlanVersion({
      ...plan,
      period: "CALENDAR_QUARTER",
      state: "SCHEDULED",
      price: { amountMinor: "100", currency: "GBP", exponent: 2 },
      limits: [{ kind: "API_CALLS", limit: "1000", unlimited: false }],
    });
    expect(read).toMatchObject({ period: "CALENDAR_QUARTER", state: "SCHEDULED", price: { currency: "GBP" } });
    expect(read?.limits).toEqual([{ kind: "API_CALLS", limit: "1000", unlimited: false }]);
  });

  it("reads kind as an open string, and a plan without one has none (TAS-513 re-pin, TAS-501 A16)", () => {
    expect(toPlanVersion({ ...plan, kind: "FREE" })?.kind).toBe("FREE");
    expect(toPlanVersion({ ...plan, kind: "TRIAL" })?.kind).toBe("TRIAL");
    const { kind: _kind, ...withoutKind } = plan;
    expect(toPlanVersion(withoutKind)?.kind).toBeNull();
    expect(toPlanVersion({ ...plan, kind: 1 })?.kind).toBeNull();
  });

  it("refuses money that is not a decimal string of minor units — never a float", () => {
    expect(toMoney({ amountMinor: 20, currency: "EUR", exponent: 2 })).toBeNull();
    expect(toMoney({ amountMinor: "20.00", currency: "EUR", exponent: 2 })).toBeNull();
    expect(toMoney({ amountMinor: "020", currency: "EUR", exponent: 2 })).toBeNull();
    expect(toMoney({ amountMinor: "0", currency: "EUR", exponent: 2.5 })).toBeNull();
    expect(toMoney({ amountMinor: "9223372036854775807", currency: "EUR", exponent: 2 })?.amountMinor).toBe("9223372036854775807");
    expect(toQuotaLimit({ kind: "SEAT", unlimited: false })).toBeNull();
    expect(toQuotaLimit({ kind: "SEAT", limit: "5", unlimited: true })).toEqual({ kind: "SEAT", limit: null, unlimited: true });
  });

  it("a page ends where nextCursor is absent, and every page is read", async () => {
    expect(toPlanVersionPage({ items: [plan, { name: "no id" }] })).toEqual({ items: [toPlanVersion(plan)], nextCursor: null });
    const list = vi
      .fn()
      .mockResolvedValueOnce({ items: [toPlanVersion(plan)!], nextCursor: "p2" })
      .mockResolvedValueOnce({ items: [toPlanVersion({ ...plan, id: "other" })!], nextCursor: null });
    expect((await readAllPlans(list)).map((item) => item.id)).toEqual([plan.id, "other"]);
    expect(list.mock.calls).toEqual([[{ limit: 100 }], [{ cursor: "p2", limit: 100 }]]);
  });
});

describe("a creation's answer (202 CreateTenantResponse)", () => {
  const operation = {
    id: "9a1b2c3d-0000-4000-8000-000000000001",
    type: "TENANT_PROVISION",
    state: "PENDING",
    createdAt: "2026-11-04T10:00:00Z",
    updatedAt: "2026-11-04T10:00:00Z",
    tenantId: wire.id,
  };

  it("reads the company and the operation; an absent deadline is null; an unknown state is kept", () => {
    const result = toCreateTenantResult({ tenant: { ...wire, lifecycle: "PROVISIONING" }, operation });
    expect(result?.tenant).toMatchObject({ id: wire.id, lifecycle: "PROVISIONING", creationDeadline: null });
    expect(result?.operation).toEqual({ ...operation, resourceId: null, failureCode: null });
    expect(toTenantOperation({ ...operation, state: "COMPENSATING", failureCode: "DEPENDENCY_UNAVAILABLE" })).toMatchObject({
      state: "COMPENSATING",
      failureCode: "DEPENDENCY_UNAVAILABLE",
    });
  });

  it("is no answer without the company or the operation", () => {
    expect(toCreateTenantResult({ tenant: wire })).toBeNull();
    expect(toCreateTenantResult({ operation })).toBeNull();
    expect(toCreateTenantResult(null)).toBeNull();
  });
});

describe("the one name rule, shared by the form and the mock (DESIGN.md §4.36, ask A13)", () => {
  it("is trimmed, 1–120 code points, with no control character", () => {
    expect(tenantNameProblem("Acme")).toBeNull();
    expect(tenantNameProblem("")).toBe("empty");
    expect(tenantNameProblem(" Acme")).toBe("untrimmed");
    expect(tenantNameProblem("Ac\u0007me")).toBe("control");
    expect(tenantNameProblem("x".repeat(120))).toBeNull();
    expect(tenantNameProblem("x".repeat(121))).toBe("too-long");
    // Code points, not UTF-16 units: 120 emoji are 240 units and still a name.
    expect(tenantNameProblem("🙂".repeat(120))).toBeNull();
    expect(trimTenantName("  Acme \n")).toBe("Acme");
    expect(withoutControlCharacters("Ac\tme\u0000")).toBe("Acme");
  });
});


describe("the owner's subscription (TAS-504, api-contract-guard §1, M2)", () => {
  it("reads paidThrough as sent, null when absent — and drops one Date cannot read, so «Paid until» never throws", () => {
    expect(toSubscription({ tenantId: "t", planVersionId: "p", version: "2", paidThrough: "2026-12-20T09:00:00Z", autopayState: "CONSENTED", renewalCancelled: false })).toEqual({
      tenantId: "t",
      planVersionId: "p",
      version: "2",
      paidThrough: "2026-12-20T09:00:00Z",
      autopayState: "CONSENTED",
      renewalCancelled: false,
      // TAS-512: the announced terms, absent here.
      scheduledPlanVersionId: null,
      scheduledEffectiveAt: null,
    });
    expect(toSubscription({ autopayState: "PAUSED_BY_BANK" })).toMatchObject({ paidThrough: null, autopayState: "PAUSED_BY_BANK", renewalCancelled: null });
    for (const paidThrough of ["not a date", "", 42, null, "2026-13-45T99:00:00Z"]) {
      expect(toSubscription({ paidThrough }).paidThrough, String(paidThrough)).toBeNull();
    }
    expect(toSubscription(null)).toMatchObject({ tenantId: null, paidThrough: null });
  });

  it("TAS-515 F4: `version` is the blueprint's decimal or nothing — it is the If-Match of every subscription command", () => {
    expect(toSubscription({ version: "12" }).version).toBe("12");
    for (const version of ["", "01", "1.5", "-1", "v2", "12345678901234567890", 3, null]) {
      expect(toSubscription({ version }).version, String(version)).toBeNull();
    }
  });
});
