import { describe, expect, it } from "vitest";
import type { AdminCatalog } from "../../domain/types";
import {
  availableOutboxFilters,
  canRetryOutboxEvent,
  eventAge,
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

/**
 * The age column is a **duration**, not the product's calendar voice (§5.8):
 * the column is set in monospace with tabular figures so values compare down
 * it, and "Yesterday" neither compares with "15h ago" nor distinguishes 13
 * hours from 35 — on the top row, which is the one the list is sorted
 * oldest-first to put there.
 */
describe("event age", () => {
  const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

  it("counts minutes up to the hour", () => {
    expect(eventAge(minutesAgo(0))).toBe("0m ago");
    expect(eventAge(minutesAgo(1))).toBe("1m ago");
    expect(eventAge(minutesAgo(59))).toBe("59m ago");
  });

  it("turns over to hours at exactly an hour", () => {
    expect(eventAge(minutesAgo(60))).toBe("1h ago");
    expect(eventAge(minutesAgo(90))).toBe("1h ago");
  });

  it("stays in hours right up to two days, then counts days", () => {
    // The boundary the ruling names: 47 hours reads as hours because "1d ago"
    // would round away half of the window this list exists to show, and 48 is
    // where days start saying more than a three-digit hour count.
    expect(eventAge(minutesAgo(47 * 60))).toBe("47h ago");
    expect(eventAge(minutesAgo(47 * 60 + 59))).toBe("47h ago");
    expect(eventAge(minutesAgo(48 * 60))).toBe("2d ago");
    expect(eventAge(minutesAgo(71 * 60))).toBe("2d ago");
    expect(eventAge(minutesAgo(72 * 60))).toBe("3d ago");
  });

  it("floors a moment in the future instead of counting backwards", () => {
    // Clock skew between a service and the reader is not an error worth
    // rendering as one, and "-3m ago" is nonsense in any theme.
    expect(eventAge(minutesAgo(-3))).toBe("0m ago");
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
 * Which rows may be offered a Retry button (TAS-194). Two independent gates —
 * the service has to be one the retry path will carry, the status has to be one
 * admin-service will act on — and both exist for the reason the Users section's
 * `actionFor` exists: a control certain to be refused is worse than none.
 *
 * These are the *server's* rules repeated, never a permission. The gateway is
 * `GLOBAL_ADMIN`-only and refuses everything below regardless (DESIGN.md §5.7).
 */
describe("which problematic events may be retried", () => {
  const event = (serviceKey: string, status: string) => ({ serviceKey, status });

  it("offers a retry for a failed event on any service the path can carry", () => {
    for (const service of ["auth", "project", "issue"]) {
      expect(canRetryOutboxEvent(event(service, "FAILED"))).toBe(true);
    }
  });

  /**
   * `PROCESSING` is a maybe and is deliberately allowed through. admin-service
   * retries one only after it has been stuck longer than
   * `admin.outbox-retry.stuck-threshold` (10m), while the summary lists it as
   * stuck after the producing service's own timeout (5m) — two numbers this
   * client never sees. A row in the gap gets a button and the server's own
   * refusal, which is honest; a hardcoded threshold here would be a guess about
   * somebody's deployment config (docs/ai/API-DIVERGENCE.md).
   */
  it("offers a retry for a processing event, because only the server knows if it is stuck enough", () => {
    expect(canRetryOutboxEvent(event("project", "PROCESSING"))).toBe(true);
  });

  /**
   * The case the list makes most tempting and the server refuses outright.
   * Retry's whole action is to put a row back into `NEW`; an overdue `NEW` row
   * is already there, so the request is `FAILED_PRECONDITION` rather than a
   * no-op — which is exactly why no button is drawn for it.
   */
  it("offers nothing for an overdue NEW event, which the server will not retry", () => {
    expect(canRetryOutboxEvent(event("auth", "NEW"))).toBe(false);
  });

  it("offers nothing for a status this build has never heard of", () => {
    // The same rule `outboxCategory` follows (TAS-173): an unknown value prints
    // verbatim and offers no action rather than being coerced into a known one.
    expect(canRetryOutboxEvent(event("auth", "QUARANTINED"))).toBe(false);
    expect(canRetryOutboxEvent(event("auth", "PUBLISHED"))).toBe(false);
    expect(canRetryOutboxEvent(event("auth", ""))).toBe(false);
  });

  /**
   * The guard that cannot fire today and is the reason the enum is not read out
   * of the catalog: the summary's own `counts` name exactly the three services
   * the contract lists. It is here for the day a fourth outbox reaches the
   * response before it reaches the path enum, and the honest answer then is an
   * absent button rather than a request the gateway refuses at the boundary.
   */
  it("offers nothing for a service the retry path cannot carry", () => {
    expect(canRetryOutboxEvent(event("notification", "FAILED"))).toBe(false);
    expect(canRetryOutboxEvent(event("", "FAILED"))).toBe(false);
    // Not case-insensitive, unlike the status: `service` is a path enum whose
    // three members are lowercase, and admin-service lowercases before its own
    // lookup — but the contract states the three in lowercase and this build
    // does not invent a spelling the enum has never declared.
    expect(canRetryOutboxEvent(event("AUTH", "FAILED"))).toBe(false);
  });

  it("reads the status the way a database column would spell it", () => {
    expect(canRetryOutboxEvent(event("auth", " failed "))).toBe(true);
  });
});
