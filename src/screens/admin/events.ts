import { apiErrorFacts } from "../../api/errors";
import { OUTBOX_SUMMARY_UNSERVED_MESSAGE } from "../../api/TaskaApi";
import type { AdminCatalog, AdminFilter, AdminFilterOperator } from "../../domain/types";
import { supportsOperator } from "./columns";

/**
 * The table the Events section is about. One name, three services — every
 * service that publishes through a transactional outbox has its own copy of it.
 */
export const OUTBOX_TABLE = "outbox_events";

/**
 * Which services have an outbox at all, in the catalog's own order (DESIGN.md
 * §5.8). Read from the catalog rather than listed here: auth, project and issue
 * are what the gateway serves today, and a fourth service that grows an outbox
 * has to appear in the selector by itself — a hardcoded list would answer the
 * question "which services publish events" with last month's answer.
 */
export function outboxServices(catalog?: AdminCatalog): string[] {
  return (catalog?.services ?? [])
    .filter((service) => (service.tables ?? []).some((table) => table.name === OUTBOX_TABLE))
    .map((service) => service.name);
}

/**
 * The three states a problematic event can be in, keyed by the `status` the
 * summary reports. The category is derived from `status` and never from
 * `reason`: `reason` is a sentence the backend writes for a human, and parsing
 * it would turn prose into a contract it is not (docs/ai/API-DIVERGENCE.md).
 */
const outboxCategories: Record<string, string> = {
  FAILED: "Failed",
  PROCESSING: "Stuck processing",
  NEW: "Overdue NEW",
};

/**
 * What to call a row of this status, or `null` when the value is one this build
 * has never heard of.
 *
 * `null` is the whole point of the signature. `status` is raw table data typed
 * as a bare string by the contract, so a backend that adds a state — or a row
 * that was never meant to be in this list — must render as itself and take
 * nothing down with it (the same principle as `src/components/Unknown.tsx`).
 * The caller prints the status verbatim in its own column either way.
 */
export function outboxCategory(status: string): string | null {
  return outboxCategories[status.trim().toUpperCase()] ?? null;
}

/**
 * Whether this failure is "the gateway has not deployed the summary yet"
 * rather than a failure worth alarming anybody about.
 *
 * The pairing is narrow on purpose. The deployed gateway does not answer 404
 * for the missing path — it takes `outbox` for a service key, routes the call
 * into the generic table read and answers `400 INVALID_ARGUMENT` with one exact
 * sentence (measured 2026-08-25, docs/ai/API-DIVERGENCE.md). Matching the code
 * alone would swallow every genuine rejection this endpoint could ever make;
 * matching a 404 would be reading a signal the gateway does not send. Both
 * halves, or it goes through the normal taxonomy like anything else.
 *
 * This stops matching the day TAS-105 deploys, because the endpoint will
 * answer 200 — the check removes itself without anyone editing it.
 */
export function isSummaryNotDeployed(error: unknown): boolean {
  const { code, message } = apiErrorFacts(error);
  return code === "INVALID_ARGUMENT" && message === OUTBOX_SUMMARY_UNSERVED_MESSAGE;
}

/** How the value of one named filter is typed in. */
export type OutboxFilterControl = "text" | "select" | "datetime" | "integer";

/**
 * One of the nine filters the Outbox journal offers (DESIGN.md §5.8).
 *
 * Named filters, not the Data section's column / operator / value: this table
 * is known, so the useful pairings are known too, and an operator select whose
 * answer is already decided is a control that cannot change anything. `label`
 * therefore carries the operator — "Status is", "Attempts ≥" — and no `match`
 * field is drawn anywhere in this section.
 *
 * `column` and `operator` are the wire's own two halves (`status.equals`,
 * `created_at.from`), so a filter goes to the API layer as the same
 * `AdminFilter` a Data filter does and nothing here hand-builds a query key.
 */
export interface OutboxFilterDef {
  column: string;
  operator: AdminFilterOperator;
  label: string;
  control: OutboxFilterControl;
  /** The only legal values, for a `select`. */
  options?: string[];
}

/**
 * The four states an outbox row can be in. A single select, not a multiselect:
 * the contract takes one value per key and reads a repeated key as one value,
 * so "FAILED or NEW" is not something the wire can carry — and inventing it on
 * the client would mean two requests merged behind the reader's back. Raised on
 * TAS-167; until the contract offers it, the journal does not pretend.
 */
export const outboxStatuses = ["NEW", "PROCESSING", "PUBLISHED", "FAILED"];

/**
 * The nine, in the order the popover offers them: what the row *is*, then when
 * it happened, then what went wrong with it.
 *
 * `payload` is deliberately absent. It is `jsonb`, which the gateway classifies
 * as OTHER — no `contains`, no ranges — so the only filter it could take is an
 * exact match on a whole document, which nobody types.
 */
export const outboxFilters: OutboxFilterDef[] = [
  { column: "status", operator: "equals", label: "Status is", control: "select", options: outboxStatuses },
  { column: "event_type", operator: "equals", label: "Event type is", control: "text" },
  { column: "aggregate_type", operator: "equals", label: "Aggregate type is", control: "text" },
  { column: "aggregate_id", operator: "equals", label: "Aggregate id is", control: "text" },
  { column: "request_id", operator: "equals", label: "Request id is", control: "text" },
  { column: "created_at", operator: "from", label: "Created from", control: "datetime" },
  { column: "created_at", operator: "to", label: "Created to", control: "datetime" },
  { column: "last_error_message", operator: "contains", label: "Error contains", control: "text" },
  { column: "attempts", operator: "from", label: "Attempts ≥", control: "integer" },
];

/**
 * The identity of a filter — the wire key it becomes. Two of the nine share a
 * column (`created_at` from and to), so the column alone does not identify one,
 * and `column.operator` is exactly what the gateway splits on.
 */
export function outboxFilterKey(filter: { column: string; operator: AdminFilterOperator }): string {
  return `${filter.column}.${filter.operator}`;
}

export function findOutboxFilter(filter: {
  column: string;
  operator: AdminFilterOperator;
}): OutboxFilterDef | undefined {
  const key = outboxFilterKey(filter);
  return outboxFilters.find((candidate) => outboxFilterKey(candidate) === key);
}

/**
 * Which of the nine this table can actually be asked for, given what the server
 * says it will filter on and what the catalog says each column is.
 *
 * The nine pairings above are written against the columns `outbox_events` has
 * today, and the type check is what keeps them honest if that stops being true.
 * The gateway decides an operator's legality from the column's type and answers
 * 400 for the rest — so a catalog that spells `created_at` as something the
 * classifier does not recognise, or a service whose `attempts` is text, would
 * otherwise leave this section drawing a filter that cannot succeed. The Data
 * section applies the same guard to its own form; the two differ only in where
 * the pairing comes from.
 *
 * A column with no stated type falls to `equals` alone, which is the safe
 * direction: fewer filters, none of them refused.
 */
export function availableOutboxFilters(
  filterableColumns: string[],
  typeOf: (column: string) => string | undefined,
): OutboxFilterDef[] {
  return outboxFilters.filter(
    (definition) =>
      filterableColumns.includes(definition.column) &&
      supportsOperator(typeOf(definition.column), definition.operator),
  );
}

/**
 * What an applied filter says on its chip: the filter's name and the value,
 * with no operator between them — the name already contains it. Falls back to
 * the wire key for a filter this build does not know, which cannot arrive from
 * the UI and is here so that nothing renders a blank chip.
 */
export function outboxFilterChipLabel(filter: AdminFilter): string {
  const definition = findOutboxFilter(filter);
  return `${definition?.label ?? outboxFilterKey(filter)} ${filter.value}`;
}
