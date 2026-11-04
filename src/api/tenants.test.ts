import { describe, expect, it, vi } from "vitest";
import { isKnownRestrictionCode, isKnownTenantLifecycle, readAllTenants, toTenant, toTenantPage, type TenantPage } from "./tenants";

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
