import { describe, expect, it } from "vitest";
import type { AdminCatalog } from "../../domain/types";
import {
  isSummaryNotDeployed,
  outboxCategory,
  outboxFilterChipLabel,
  outboxFilters,
  outboxServices,
} from "./events";

describe("outbox event categories", () => {
  it("names the three states the summary reports", () => {
    expect(outboxCategory("FAILED")).toBe("Failed");
    expect(outboxCategory("PROCESSING")).toBe("Stuck processing");
    expect(outboxCategory("NEW")).toBe("Overdue NEW");
  });

  // `status` is raw table data typed as a bare string by the contract. A
  // backend that adds a state, or a row nobody expected in this list, must
  // render as itself and take nothing down with it.
  it("has no name for a status it has never heard of, and says so with null", () => {
    expect(outboxCategory("QUARANTINED")).toBeNull();
    expect(outboxCategory("")).toBeNull();
    expect(outboxCategory("PUBLISHED")).toBeNull();
  });

  it("reads the value the way a database would spell it", () => {
    expect(outboxCategory(" failed ")).toBe("Failed");
  });
});

describe("outbox services from the catalog", () => {
  const catalog = (services: { name: string; tables: string[] }[]): AdminCatalog => ({
    services: services.map((service) => ({
      name: service.name,
      databaseAlias: `taska_${service.name}`,
      tables: service.tables.map((table) => ({ name: table, primaryKey: "id", columns: [] })),
    })),
  });

  it("offers exactly the services that have an outbox, in the catalog's order", () => {
    expect(
      outboxServices(
        catalog([
          { name: "auth", tables: ["users", "outbox_events"] },
          { name: "admin", tables: ["audit_log"] },
          { name: "issue", tables: ["issues", "outbox_events"] },
        ]),
      ),
    ).toEqual(["auth", "issue"]);
  });

  it("offers none before the catalog answers", () => {
    expect(outboxServices(undefined)).toEqual([]);
    expect(outboxServices({ services: [] })).toEqual([]);
  });
});

describe("the nine named filters", () => {
  it("offers each wire key exactly once", () => {
    const keys = outboxFilters.map((filter) => `${filter.column}.${filter.operator}`);

    expect(keys).toHaveLength(9);
    expect(new Set(keys).size).toBe(9);
  });

  // `payload` is jsonb, which the gateway classifies as OTHER: no `contains`,
  // no ranges, and an exact match on a whole document is not something anybody
  // types.
  it("does not offer payload", () => {
    expect(outboxFilters.some((filter) => filter.column === "payload")).toBe(false);
  });

  it("names the operator inside the label, so no Match control is needed", () => {
    expect(outboxFilterChipLabel({ column: "status", operator: "equals", value: "FAILED" })).toBe("Status is FAILED");
    expect(outboxFilterChipLabel({ column: "attempts", operator: "from", value: "3" })).toBe("Attempts ≥ 3");
    expect(outboxFilterChipLabel({ column: "created_at", operator: "to", value: "2026-01-01T00:00:00Z" })).toBe(
      "Created to 2026-01-01T00:00:00Z",
    );
  });
});

/**
 * The deployed gateway does not answer 404 for the summary it does not have: it
 * reads `outbox` as a service key, routes the call into the generic table read
 * and rejects that. Measured 2026-08-25 — docs/ai/API-DIVERGENCE.md.
 */
describe("the summary the gateway does not serve yet", () => {
  const rejection = (message: string) => Object.assign(new Error(message), { code: "INVALID_ARGUMENT", status: 400 });

  it("recognises the exact rejection the live gateway sends", () => {
    expect(isSummaryNotDeployed(rejection("Unknown service: outbox"))).toBe(true);
  });

  it("does not swallow any other rejection from the same endpoint", () => {
    // The narrowness is the point. Matching the code alone would dress every
    // genuine 400 from this route up as a missing deployment.
    expect(isSummaryNotDeployed(rejection("Unknown service: outboxes"))).toBe(false);
    expect(isSummaryNotDeployed(Object.assign(new Error("Not found"), { code: "NOT_FOUND", status: 404 }))).toBe(false);
    expect(isSummaryNotDeployed(new Error("Unknown service: outbox"))).toBe(false);
    expect(isSummaryNotDeployed(undefined)).toBe(false);
  });
});
