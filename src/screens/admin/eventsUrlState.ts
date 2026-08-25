import type { AdminFilter, AdminFilterOperator, AdminSortOrder } from "../../domain/types";
import { findOutboxFilter, outboxFilterKey } from "./events";
import { filterOperators } from "./urlState";

/**
 * The Outbox journal's view state, which lives in the URL like everything else
 * in this area (DESIGN.md §5.8): the service in the path, page, sort and every
 * applied filter in the query.
 *
 * Deliberately its own module rather than a widened `urlState.ts`. The Data
 * section carries exactly one filter and its links are already out there, so
 * teaching that reader to return a list would have changed the type every Data
 * caller reads for the sake of a screen Data does not have. The two share the
 * `column:operator:value` spelling, which is the part a person copying a link
 * between the two sections would notice.
 */
export interface EventsViewState {
  page: number;
  /**
   * `null` means "the URL says nothing", which is not the same as "no sort":
   * the journal then reads newest first (below). Keeping the two apart is what
   * lets a bare address mean the default while an explicit sort stays in the
   * link that was shared.
   */
  sort: string | null;
  order: AdminSortOrder;
  /** In the order they were applied, each wire key at most once. */
  filters: AdminFilter[];
}

/**
 * A journal is read from the end (§5.8), so a bare `/admin/events/outbox/auth`
 * means newest first — stated here rather than left to the server, and written
 * into the address only once a reader chooses something else.
 */
export const DEFAULT_OUTBOX_SORT = "created_at";
export const DEFAULT_OUTBOX_ORDER: AdminSortOrder = "desc";

/**
 * `column:operator:value`, the same spelling the Data section writes: only the
 * first two separators are structural, so a value may contain colons — and the
 * value most likely to be filtered on here, a timestamp, does.
 *
 * A filter this section does not offer is read as no filter at all. It could
 * only arrive from a hand-edited address, and the alternative is worse than
 * dropping it: the journal would narrow its rows with nothing on screen naming
 * the reason and no cross to take it off again.
 */
function decodeFilter(raw: string): AdminFilter | null {
  const first = raw.indexOf(":");
  if (first <= 0) return null;
  const second = raw.indexOf(":", first + 1);
  if (second < 0) return null;
  const operator = raw.slice(first + 1, second) as AdminFilterOperator;
  if (!filterOperators.includes(operator)) return null;
  const value = raw.slice(second + 1);
  // A filter with no value is not a filter (§5.8): the request would drop it
  // and the chip would still read as applied over unnarrowed rows.
  if (value === "") return null;
  const filter = { column: raw.slice(0, first), operator, value };
  return findOutboxFilter(filter) ? filter : null;
}

/**
 * Anything unreadable reads as "not set" rather than as an error: a truncated
 * or hand-edited link should show the journal, not a diagnostic.
 */
export function readEventsViewState(params: URLSearchParams): EventsViewState {
  const page = Number.parseInt(params.get("page") ?? "", 10);
  const sort = params.get("sort");
  const filters: AdminFilter[] = [];
  const seen = new Set<string>();
  for (const raw of params.getAll("filter")) {
    const filter = decodeFilter(raw);
    // One value per key, first one wins. Not a UI convenience: the gateway
    // reads a repeated query key as a single value, so a second `status.equals`
    // would be silently ignored on the wire while its chip claimed to be
    // narrowing the table.
    if (!filter || seen.has(outboxFilterKey(filter))) continue;
    seen.add(outboxFilterKey(filter));
    filters.push(filter);
  }
  return {
    page: Number.isFinite(page) && page > 0 ? page : 1,
    sort: sort ? sort : null,
    order: params.get("order") === "desc" ? "desc" : "asc",
    filters,
  };
}

/** Only what differs from the default is written, so the common URL is bare. */
export function writeEventsViewState(state: EventsViewState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.page > 1) params.set("page", String(state.page));
  if (state.sort) {
    params.set("sort", state.sort);
    if (state.order === "desc") params.set("order", "desc");
  }
  for (const filter of state.filters) {
    if (!filter.column || filter.value === "") continue;
    // `append`, not `set`: several filters combine as AND, and each is its own
    // `filter=` parameter so the address stays readable and every one of them
    // can be removed on its own.
    params.append("filter", `${filter.column}:${filter.operator}:${filter.value}`);
  }
  return params;
}

/**
 * Where an event card goes back to. Part of the card's *address*, not of the
 * browser's history (§5.8): a pasted link and a reload have to give the same
 * way out as the click that opened it, and history gives neither.
 *
 * Only the summary needs saying. A card opened from the journal carries the
 * journal's own query, which is the way back; a bare deep link has no query at
 * all and lands in that service's journal, which is where the row lives.
 */
export const BACK_TO_PROBLEMS = "problems";

export function readsBackToProblems(params: URLSearchParams): boolean {
  return params.get("from") === BACK_TO_PROBLEMS;
}
