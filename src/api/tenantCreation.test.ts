import { describe, expect, it } from "vitest";
import { MemoryStorage } from "../test/memoryStorage";
import {
  TENANT_CREATION_KEY,
  clearTenantCreation,
  creationOf,
  newIdempotencyKey,
  openTenantCreation,
  readTenantCreation,
  writeTenantCreation,
  type TenantCreationRecord,
} from "./tenantCreation";

/* The tab's one creation attempt (TAS-501, api-contract-guard §3, B2). */

const record: TenantCreationRecord = {
  v: 1,
  userId: "nina",
  key: "1b4e28ba-2fa1-41d2-883f-0016d3cca427",
  name: "Acme",
  planVersionId: "7d2c4e1a-5b3f-4a6c-9e8d-0f1a2b3c4d01",
  sentAt: "2026-11-04T10:00:00.000Z",
};

describe("the creation record", () => {
  it("is one setItem of the key and the exact body, read back as written", () => {
    const storage = new MemoryStorage();
    writeTenantCreation(storage, record);
    expect(storage.keys()).toEqual([TENANT_CREATION_KEY]);
    expect(JSON.parse(storage.getItem(TENANT_CREATION_KEY) as string)).toEqual(record);
    expect(readTenantCreation(storage)).toEqual(record);
  });

  it("is open until a 202 names the company, and then it is that company's", () => {
    const storage = new MemoryStorage();
    writeTenantCreation(storage, record);
    expect(openTenantCreation(storage, "nina")).toEqual(record);
    writeTenantCreation(storage, { ...record, tenantId: "t1", operationId: "o1" });
    expect(openTenantCreation(storage, "nina")).toBeNull();
    expect(creationOf(storage, "t1")).toMatchObject({ key: record.key, operationId: "o1" });
    expect(creationOf(storage, "t2")).toBeNull();
  });

  it("drops another account's record unread", () => {
    const storage = new MemoryStorage();
    writeTenantCreation(storage, record);
    expect(openTenantCreation(storage, "anna")).toBeNull();
    expect(storage.getItem(TENANT_CREATION_KEY)).toBeNull();
  });

  it("reads anything that is not a record as none, and clears", () => {
    const storage = new MemoryStorage();
    storage.setItem(TENANT_CREATION_KEY, "{not json");
    expect(readTenantCreation(storage)).toBeNull();
    storage.setItem(TENANT_CREATION_KEY, JSON.stringify({ ...record, v: 2 }));
    expect(readTenantCreation(storage)).toBeNull();
    storage.setItem(TENANT_CREATION_KEY, JSON.stringify({ ...record, key: "" }));
    expect(readTenantCreation(storage)).toBeNull();
    writeTenantCreation(storage, record);
    clearTenantCreation(storage);
    expect(storage.length).toBe(0);
  });

  it("mints canonical lowercase UUIDs, a new one each time", () => {
    const keys = new Set(Array.from({ length: 20 }, () => newIdempotencyKey()));
    expect(keys.size).toBe(20);
    for (const key of keys) expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
