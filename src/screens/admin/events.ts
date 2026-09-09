import { isRetryableOutboxService, type RetryableOutboxService } from "../../api/TaskaApi";
import type { AdminCatalog, AdminFilter, AdminFilterOperator, ProblematicOutboxEvent } from "../../domain/types";
import { supportsOperator } from "./columns";

/**
 * The table the Events section is about. One name, three services — every
 * service that publishes through a transactional outbox has its own copy of it.
 */
export const OUTBOX_TABLE = "outbox_events";

/**
 * The Problems view's one query, named here rather than in the view because two
 * files ask for it to be read again: the list itself after a retry it saw
 * answered, and the retry dialog when it is dismissed over an answer nobody
 * will see. A key spelled twice is a key that can drift, and the failure it
 * would produce — a list that quietly stops refreshing — looks like nothing at
 * all.
 */
export const OUTBOX_PROBLEMS_KEY = ["admin", "outbox", "problems"];

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
 * Whether this row may be offered a Retry button at all (DESIGN.md §5.8).
 *
 * Two questions, both of which the client can answer without asking, and
 * neither of which is a permission — the server decides, and hiding a control
 * has never been a right (§5.7). This exists for the same reason `actionFor`
 * exists in the Users section: a button certain to be refused is worse than no
 * button.
 *
 * **The service** has to be one the retry path will carry
 * (`RETRYABLE_OUTBOX_SERVICES`, a closed enum in the contract). On today's data
 * this is never false — the summary's own `counts` name exactly those three —
 * and it is here for the day a fourth outbox appears in the response before it
 * appears in the contract.
 *
 * **The status** has to be one admin-service will act on: `FAILED`, or
 * `PROCESSING`. Everything else is `FAILED_PRECONDITION`, and that emphatically
 * includes `NEW` — a third of the rows this very list draws. The Problems view
 * shows an overdue `NEW` row because nothing has *picked it up*; retry's job is
 * to put a row back into `NEW`, which for that row would be a no-op the server
 * refuses rather than performs. An unknown status is treated as ineligible, the
 * same way `outboxCategory` refuses to name one (TAS-173).
 *
 * **`PROCESSING` is a maybe, and it is deliberately allowed through.** The
 * server retries a stuck `PROCESSING` row only once it is older than
 * `admin.outbox-retry.stuck-threshold` (10m by default) — a *longer* wait than
 * the one that put it in this list (`admin.outbox.processing-timeouts`, 5m).
 * Both are server configuration this client never sees, so it cannot compute the
 * answer and must not hardcode either number. A row in the gap between them gets
 * a button and a refusal, in the server's own words, with the dialog left open;
 * that is honest, where a client-side clock guessing at a deployment's config
 * would not be. Recorded in docs/ai/API-DIVERGENCE.md.
 *
 * A **type predicate**, not a boolean, and that is what saves the caller a cast.
 * The service key it narrows to is the one `retryOutboxEvent` requires
 * (`RetryableOutboxService`), so a row that has not been through this guard
 * cannot be handed to the API method at all — the rule is held by the compiler
 * rather than by everybody remembering it.
 */
export function canRetryOutboxEvent<T extends Pick<ProblematicOutboxEvent, "serviceKey" | "status">>(
  event: T,
): event is T & { serviceKey: RetryableOutboxService } {
  if (!isRetryableOutboxService(event.serviceKey)) return false;
  const status = event.status.trim().toUpperCase();
  return status === "FAILED" || status === "PROCESSING";
}

/**
 * How long ago this event was created, as a **duration** (DESIGN.md §5.8):
 * minutes up to an hour, hours up to two days, days beyond that. `25h ago`,
 * `3d ago`.
 *
 * Not `relativeTime` from `src/lib/format.ts`, which is the product's calendar
 * voice and says "Yesterday". That voice is right in comments, notifications
 * and card meta and wrong here for two reasons: this column is set in
 * monospace with tabular figures precisely so values can be compared down it,
 * and "Yesterday" does not compare with "15h ago"; and it covers twelve to
 * thirty-six hours in one word, on the top row — the row the list is sorted
 * oldest-first to put there. `relativeTime` and its other call sites are
 * deliberately untouched.
 *
 * The boundaries are the ones the tests pin: 59 minutes is minutes, 60 is
 * hours, 47 hours is hours, 48 is days. A moment in the future — a clock skew
 * between the service and the reader — floors at `0m ago` rather than counting
 * backwards.
 */
export function eventAge(iso: string): string {
  const elapsed = Date.now() - new Date(iso).getTime();
  const minutes = Math.max(0, Math.floor(elapsed / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
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
