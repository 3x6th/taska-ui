import type { AdminFilter, AdminFilterOperator } from "../../domain/types";

/*
 * The named-filter vocabulary `AdminNamedFilterControl` draws, in a file of its
 * own so the control's module exports only the component.
 */

/**
 * How the value of one named filter is typed in. `datetime` is a UTC instant
 * written as ISO-8601 without milliseconds; `date` is a UTC calendar day,
 * `yyyy-MM-dd`, kept exactly as the field gives it.
 */
export type NamedFilterControl = "text" | "select" | "datetime" | "integer" | "date";

/**
 * One filter offered by name — "Status is", "Attempts ≥", "Actor id is" —
 * rather than as the Data section's column / match / value. `column` and
 * `operator` are the identity the URL and the API layer carry.
 */
export interface NamedFilterDef {
  column: string;
  operator: AdminFilterOperator;
  label: string;
  control: NamedFilterControl;
  /** The only legal values, for a `select`. */
  options?: string[];
  /**
   * What is wrong with a value, or `null` when it may be sent. For a value the
   * server would refuse — or, worse, answer with a 500 — the popover says so
   * and does not apply it.
   */
  check?: (value: string) => string | null;
}

/** The identity of a named filter — `column.operator`, the wire key it becomes. */
export function namedFilterKey(filter: { column: string; operator: AdminFilterOperator }): string {
  return `${filter.column}.${filter.operator}`;
}

/**
 * What an applied filter says on its chip: the filter's name and the value,
 * with no operator between them — the name already contains it. Falls back to
 * the key for a filter the section does not know, which cannot arrive from the
 * UI and is here so that nothing renders a blank chip.
 */
export function namedFilterChipLabel(definitions: NamedFilterDef[], filter: AdminFilter): string {
  const key = namedFilterKey(filter);
  const definition = definitions.find((candidate) => namedFilterKey(candidate) === key);
  return `${definition?.label ?? key} ${filter.value}`;
}
