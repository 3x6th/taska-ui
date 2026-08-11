import type { AdminFilter, AdminFilterOperator, AdminSortOrder } from "../../domain/types";

/**
 * The Data section's view state, which lives in the URL rather than in React
 * (DESIGN.md §5.8): service and table in the path, everything below in the
 * query. Admin work is "look at this" — the link has to open the same rows for
 * the next person and survive a reload.
 *
 * Sort is here for the same reason page and filter are, and because it is what
 * makes the reset free: navigating to another table is a plain link with no
 * query, so a sort or filter that belonged to the previous table's columns
 * cannot survive the move.
 */
export interface AdminViewState {
  page: number;
  sort: string | null;
  order: AdminSortOrder;
  filter: AdminFilter | null;
}

export const filterOperators: AdminFilterOperator[] = ["equals", "contains", "from", "to"];

export const operatorLabels: Record<AdminFilterOperator, string> = {
  equals: "is",
  contains: "contains",
  from: "from",
  to: "to",
};

/**
 * Spellings this app has used for an operator but no longer writes. The admin
 * URL is shareable by design (§5.8), so a link sent last week must keep
 * filtering: dropping the filter would show unfiltered rows under a chip that
 * still read as applied, which is exactly the silent-wrong-answer case the URL
 * state exists to avoid. Only reading accepts these — `writeViewState` emits
 * the current spelling, so an old link that is opened and re-shared heals.
 */
const legacyOperators: Record<string, AdminFilterOperator> = {
  eq: "equals",
};

/**
 * `column:operator:value`. Only the first two separators are structural, so a
 * value may contain colons — a timestamp does, and it is the value most likely
 * to be filtered on.
 */
function decodeFilter(raw: string | null): AdminFilter | null {
  if (!raw) return null;
  const first = raw.indexOf(":");
  if (first <= 0) return null;
  const second = raw.indexOf(":", first + 1);
  if (second < 0) return null;
  const spelled = raw.slice(first + 1, second);
  const operator = filterOperators.includes(spelled as AdminFilterOperator)
    ? (spelled as AdminFilterOperator)
    : legacyOperators[spelled];
  if (!operator) return null;
  const value = raw.slice(second + 1);
  // A filter with no value is not a filter (§5.8). The API layer already drops
  // it from the request, which is what made it dangerous: the chip read as
  // applied and the empty state said "No rows match this filter" over a table
  // nothing had narrowed.
  if (value === "") return null;
  return { column: raw.slice(0, first), operator, value };
}

/** Anything unreadable in the query reads as "not set" rather than as an error:
 *  a hand-edited or truncated URL should show the table, not a diagnostic. */
export function readViewState(params: URLSearchParams): AdminViewState {
  const page = Number.parseInt(params.get("page") ?? "", 10);
  const sort = params.get("sort");
  return {
    page: Number.isFinite(page) && page > 0 ? page : 1,
    sort: sort ? sort : null,
    order: params.get("order") === "desc" ? "desc" : "asc",
    filter: decodeFilter(params.get("filter")),
  };
}

/** Only what differs from the default is written, so the common URL is bare. */
export function writeViewState(state: AdminViewState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.page > 1) params.set("page", String(state.page));
  if (state.sort) {
    params.set("sort", state.sort);
    if (state.order === "desc") params.set("order", "desc");
  }
  if (state.filter && state.filter.column && state.filter.value !== "") {
    params.set("filter", `${state.filter.column}:${state.filter.operator}:${state.filter.value}`);
  }
  return params;
}
