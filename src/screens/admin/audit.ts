import type { AdminFilter, AuditEntriesQuery, AuditEntry } from "../../domain/types";
import { filterOperators } from "./urlState";
import { namedFilterKey, type NamedFilterDef } from "./namedFilters";

/**
 * The Audit section's pieces that are not drawing (DESIGN.md §5.8, TAS-251):
 * the eight named filters, the URL state they live in, the query they become,
 * and the three readings an entry needs — its time, its key and its documents.
 *
 * The read is `GET /readonly/audit-entries` (backend PR #172, TAS-160); what the
 * server does with each parameter is on `TaskaApi.listAuditEntries`.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `actorUserId` is the one filter the server cannot be trusted to refuse: at
 * the PR #172 head a value that is not a UUID is a **500**, not a 400. So it is
 * checked here and never sent.
 */
export function actorIdProblem(value: string): string | null {
  return UUID_PATTERN.test(value) ? null : "An actor id is a UUID, like 6d774efa-57d8-4ae0-a27e-2984d1dfbbf6.";
}

/** `yyyy-MM-dd` and a real day — the only spelling the server reads for either bound. */
export function isAuditDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const at = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 10) === value;
}

function dayProblem(value: string): string | null {
  return isAuditDay(value) ? null : "A date here is a whole day, written yyyy-MM-dd.";
}

/**
 * The eight, in the order the popover offers them: who, what, where, then when.
 * Every one is an exact match on the server — so "is", never "contains" — and
 * the two dates are whole UTC days with both ends inclusive.
 *
 * `column` is the wire's own parameter name and `operator` only tells the two
 * date bounds apart, so a filter is the same `AdminFilter` the other sections
 * carry and the URL spells it `column:operator:value` like theirs.
 */
export const auditFilters: NamedFilterDef[] = [
  { column: "actorUserId", operator: "equals", label: "Actor id is", control: "text", check: actorIdProblem },
  { column: "action", operator: "equals", label: "Action is", control: "text" },
  { column: "targetService", operator: "equals", label: "Service is", control: "text" },
  { column: "targetTable", operator: "equals", label: "Table is", control: "text" },
  { column: "targetId", operator: "equals", label: "Target id is", control: "text" },
  { column: "requestId", operator: "equals", label: "Request id is", control: "text" },
  { column: "createdAt", operator: "from", label: "From", control: "date", check: dayProblem },
  { column: "createdAt", operator: "to", label: "To", control: "date", check: dayProblem },
];

function definitionOf(filter: Pick<AdminFilter, "column" | "operator">): NamedFilterDef | undefined {
  const key = namedFilterKey(filter);
  return auditFilters.find((candidate) => namedFilterKey(candidate) === key);
}

function boundOf(filters: AdminFilter[], operator: "from" | "to"): string | undefined {
  return filters.find((filter) => filter.column === "createdAt" && filter.operator === operator)?.value;
}

/** The one refusal that is about two filters at once: the server answers 400 for it. */
export function auditFiltersProblem(filters: AdminFilter[]): string | null {
  const from = boundOf(filters, "from");
  const to = boundOf(filters, "to");
  return from !== undefined && to !== undefined && from > to ? "From is after To, so no day could match." : null;
}

export interface AuditViewState {
  page: number;
  /** In the order they were applied, each key at most once, each one sendable. */
  filters: AdminFilter[];
}

/**
 * The view as the URL states it. Anything the section would not send reads as
 * not set — an unknown filter, a value its own check refuses, a second copy of
 * a key — because a hand-edited or truncated link should show the log rather
 * than a diagnostic, and a filter that is not sent must not keep a chip. A
 * `from` after `to` drops both bounds for the same reason: kept, the request
 * would be a 400 the reader did not ask for.
 */
export function readAuditViewState(params: URLSearchParams): AuditViewState {
  const page = Number.parseInt(params.get("page") ?? "", 10);
  const filters: AdminFilter[] = [];
  const seen = new Set<string>();
  for (const raw of params.getAll("filter")) {
    const first = raw.indexOf(":");
    const second = first > 0 ? raw.indexOf(":", first + 1) : -1;
    if (second < 0) continue;
    const operator = raw.slice(first + 1, second);
    if (!filterOperators.includes(operator as AdminFilter["operator"])) continue;
    const filter = {
      column: raw.slice(0, first),
      operator: operator as AdminFilter["operator"],
      value: raw.slice(second + 1).trim(),
    };
    const definition = definitionOf(filter);
    if (!definition || filter.value === "" || definition.check?.(filter.value)) continue;
    if (seen.has(namedFilterKey(filter))) continue;
    seen.add(namedFilterKey(filter));
    filters.push(filter);
  }
  return {
    page: Number.isFinite(page) && page > 0 ? page : 1,
    filters: auditFiltersProblem(filters) ? filters.filter((filter) => filter.column !== "createdAt") : filters,
  };
}

/** Only what differs from the default is written, so the common URL is bare. */
export function writeAuditViewState(state: AuditViewState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.page > 1) params.set("page", String(state.page));
  for (const filter of state.filters) {
    if (filter.value === "") continue;
    params.append("filter", `${filter.column}:${filter.operator}:${filter.value}`);
  }
  return params;
}

/** The request a view becomes: each filter under its own parameter, the bounds as `createdAtFrom`/`To`. */
export function auditQueryFor(view: AuditViewState, pageSize: number): AuditEntriesQuery {
  const query: AuditEntriesQuery = { page: view.page, pageSize };
  for (const filter of view.filters) {
    switch (filter.column) {
      case "actorUserId":
      case "action":
      case "targetService":
      case "targetTable":
      case "targetId":
      case "requestId":
        query[filter.column] = filter.value;
        break;
      case "createdAt":
        if (filter.operator === "from") query.createdAtFrom = filter.value;
        if (filter.operator === "to") query.createdAtTo = filter.value;
        break;
    }
  }
  return query;
}

/**
 * The entry's React key. The DTO has **no id**, so a row is named by what it
 * says; two entries that say exactly the same thing — the same actor doing the
 * same thing to the same row in the same second — are told apart by how many
 * came before, which is stable for as long as the page is.
 */
export function auditEntryKeys(entries: AuditEntry[]): string[] {
  const seen = new Map<string, number>();
  return entries.map((entry) => {
    const base = [
      entry.createdAt,
      entry.actorUserId,
      entry.action,
      entry.targetService,
      entry.targetTable,
      entry.targetId,
      entry.requestId,
    ].join("|");
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}#${count}`;
  });
}

/**
 * The time in UTC, to the second, the way this area writes an instant
 * everywhere it writes one itself (§5.8): ISO-8601 with `Z` and without
 * milliseconds. A value that does not parse is printed exactly as it came.
 */
export function formatAuditTime(value: string): string {
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return value;
  return at.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * A logged document laid out to be read: pretty JSON when the text parses,
 * and the text exactly as it arrived when it does not — a value that is not
 * JSON is the server's to fix and the console's to show (the same rule as
 * `formatJsonValue` for a `jsonb` column). `null` means the log holds nothing.
 *
 * Masked values are already `"***"` inside the document; they print as they
 * are and nothing here restores or measures them.
 */
export function formatAuditDocument(value: string | null): { text: string; json: boolean } | null {
  if (value === null) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return { text: JSON.stringify(parsed, null, 2), json: true };
  } catch {
    return { text: value, json: false };
  }
}
