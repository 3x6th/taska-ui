import type { AdminCatalog, AdminFilterOperator, AdminTable } from "../../domain/types";

/** `from`/`to` become a timestamp comparison server-side; the others do not. */
export function isRangeOperator(operator: AdminFilterOperator) {
  return operator === "from" || operator === "to";
}

/** Whether the catalog's column type is one a timestamp comparison can be made against. */
export function isTemporal(type?: string) {
  if (!type) return false;
  const normalized = type.toLowerCase();
  return normalized.includes("timestamp") || normalized.includes("date") || normalized.includes("time");
}

/**
 * Whether a column's values are the kind people compare down the column —
 * identifiers, timestamps, numbers, JSON — and therefore want the monospace
 * face and tabular figures (DESIGN.md §5.8, §2.3).
 *
 * The split is per column and comes from the catalog's declared type, not from
 * a class on the table: `email` and `display_name` are prose and stay in the UI
 * font. Monospace applied to a whole table of names would be atmosphere, which
 * `docs/ai/REFERENCE-LOCK.md` rules out in as many words; aligning a column of
 * ids is work.
 *
 * A type the catalog does not state, or one this list does not recognise, falls
 * back to the UI font on purpose: that is the quieter default, and it fails
 * towards prose rather than towards terminal cosplay.
 */
export function isAlignedType(type?: string) {
  if (!type) return false;
  const normalized = type.toLowerCase();
  if (isTemporal(normalized)) return true;
  return [
    "uuid",
    "json",
    "int",
    "serial",
    "numeric",
    "decimal",
    "float",
    "double",
    "real",
    "money",
    "bytea",
  ].some((needle) => normalized.includes(needle));
}

/** The catalog's first table, used only to put a real address in the bar. */
export function defaultSelection(catalog?: AdminCatalog) {
  const service = catalog?.services?.find((item) => (item.tables ?? []).length > 0);
  const table = service?.tables?.[0];
  return service && table ? { service: service.name, table: table.name } : null;
}

export function findTable(
  catalog?: AdminCatalog,
  current?: { service: string; table: string } | null,
): AdminTable | undefined {
  if (!current) return undefined;
  return catalog?.services
    ?.find((service) => service.name === current.service)
    ?.tables?.find((table) => table.name === current.table);
}

/**
 * These tables are whatever the services hold, so a cell is `unknown` and the
 * console has to be honest about all of it: null is not the string "null", and
 * an object is not "[object Object]".
 */
export function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}
