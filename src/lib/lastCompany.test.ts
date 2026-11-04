import { describe, expect, it } from "vitest";
import { MemoryStorage } from "../test/memoryStorage";
import { LAST_COMPANY_KEY, clearLastCompany, readLastCompany, writeLastCompany } from "./lastCompany";

describe("taska.lastCompany, a hint for a new tab (TAS-500, DESIGN.md §5.1)", () => {
  it("is the account's own: another account on the device reads nothing", () => {
    const storage = new MemoryStorage();
    writeLastCompany(storage, "anna", "northwind");
    expect(JSON.parse(storage.getItem(LAST_COMPANY_KEY) as string)).toEqual({ userId: "anna", companyId: "northwind" });
    expect(readLastCompany(storage, "anna")).toBe("northwind");
    expect(readLastCompany(storage, "sofia")).toBeNull();
    clearLastCompany(storage);
    expect(readLastCompany(storage, "anna")).toBeNull();
  });

  it("is absent, never a throw, for anything that is not one or a storage that refuses", () => {
    const storage = new MemoryStorage();
    for (const raw of ["{", "null", "[]", '{"userId":"anna"}', '{"userId":"anna","companyId":""}']) {
      storage.setItem(LAST_COMPANY_KEY, raw);
      expect(readLastCompany(storage, "anna")).toBeNull();
    }
    const refusing = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    } as unknown as Storage;
    expect(readLastCompany(refusing, "anna")).toBeNull();
    expect(() => writeLastCompany(refusing, "anna", "x")).not.toThrow();
    expect(() => clearLastCompany(refusing)).not.toThrow();
  });
});
