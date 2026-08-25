import { describe, expect, it } from "vitest";
import type { AdminCatalog } from "../../domain/types";
import {
  availableOutboxFilters,
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

  // The nine pairings are written against the columns `outbox_events` has
  // today. The gateway decides an operator's legality from the column's type
  // and answers 400 for the rest, so a catalog that drifts must take filters
  // away rather than leave the section drawing one that cannot succeed.
  describe("against the catalog's own column types", () => {
    const liveTypes: Record<string, string> = {
      status: "text",
      event_type: "text",
      aggregate_type: "text",
      aggregate_id: "uuid",
      request_id: "text",
      created_at: "timestamp with time zone",
      last_error_message: "text",
      attempts: "integer",
    };
    const columns = Object.keys(liveTypes);
    const keysOf = (types: Record<string, string>) =>
      availableOutboxFilters(columns, (column) => types[column]).map(
        (filter) => `${filter.column}.${filter.operator}`,
      );

    it("offers all nine against the types the gateway serves today", () => {
      expect(keysOf(liveTypes)).toHaveLength(9);
    });

    it("drops a range filter when the column stops being one the gateway can range over", () => {
      // `created_at` spelled as something the classifier does not know is
      // OTHER, and OTHER takes only `equals` — so both halves of the date range
      // go, and nothing else does.
      const keys = keysOf({ ...liveTypes, created_at: "timestamptz" });

      expect(keys).not.toContain("created_at.from");
      expect(keys).not.toContain("created_at.to");
      expect(keys).toContain("status.equals");
    });

    it("drops Attempts ≥ when the column is not numeric, and Error contains when it is not text", () => {
      expect(keysOf({ ...liveTypes, attempts: "character varying" })).not.toContain("attempts.from");
      expect(keysOf({ ...liveTypes, last_error_message: "bytea" })).not.toContain("last_error_message.contains");
    });

    it("offers nothing for a column the server will not filter on", () => {
      // Sensitive columns are stripped before this list is built, so a masked
      // column cannot become a match oracle through the filter form.
      expect(keysOf(liveTypes).filter((key) => key.startsWith("request_id"))).toHaveLength(1);
      expect(
        availableOutboxFilters(
          columns.filter((column) => column !== "request_id"),
          (column) => liveTypes[column],
        ).map((filter) => filter.column),
      ).not.toContain("request_id");
    });

    it("falls back to equals alone when the catalog states no type", () => {
      expect(keysOf({})).toEqual([
        "status.equals",
        "event_type.equals",
        "aggregate_type.equals",
        "aggregate_id.equals",
        "request_id.equals",
      ]);
    });
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
