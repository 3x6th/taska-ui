import type { AdminCatalog, AdminFilterOperator, AdminTable } from "../../domain/types";
import { classifyColumnType } from "../../lib/adminColumnTypes";
import { filterOperators } from "./urlState";

/**
 * Which operators this column may be filtered with (DESIGN.md §5.8). The
 * gateway validates the same pairing and answers 400, so this is not a
 * convenience: it is the only way not to send a request that cannot succeed.
 *
 * `contains` is text-only (it becomes `ILIKE`), `from`/`to` are for temporal
 * and numeric columns (both become a typed range comparison), and `equals`
 * works everywhere.
 */
export function operatorsForType(type?: string): AdminFilterOperator[] {
  const columnClass = classifyColumnType(type);
  return filterOperators.filter((operator) => {
    if (operator === "contains") return columnClass === "TEXT";
    if (operator === "from" || operator === "to") return columnClass === "TEMPORAL" || columnClass === "NUMERIC";
    return true;
  });
}

/** Whether a column may carry a value the operator's own parser will accept. */
export function supportsOperator(type: string | undefined, operator: AdminFilterOperator): boolean {
  return operatorsForType(type).includes(operator);
}

/** Which control the filter's Value field is, for a column of this type. */
export type AdminValueControl = "text" | "number" | "boolean" | "datetime";

/**
 * The control the value is entered with (DESIGN.md §5.8). Not cosmetics: the
 * gateway parses the value against the column's type and answers 400 when it
 * cannot — `ReadOnlyQueryBuilder` runs `new BigDecimal(value)` for a numeric
 * column and takes only `true`/`false` for a boolean one, and a timestamp goes
 * through `OffsetDateTime.parse`. A free text field for any of those is a 400
 * the reader was given no help avoiding.
 *
 * A type the gateway does not classify — `uuid`, `inet`, `jsonb` — keeps the
 * free field, because there the server really does take the string as written.
 */
export function valueControlForType(type?: string): AdminValueControl {
  switch (classifyColumnType(type)) {
    case "TEMPORAL":
      return "datetime";
    case "NUMERIC":
      return "number";
    case "BOOLEAN":
      return "boolean";
    default:
      return "text";
  }
}

/**
 * Whether a row of this table can be addressed at all. `GET
 * /readonly/{service}/{table}/{id}` types `id` as a `UUID` in the gateway, so a
 * table keyed by a number or a code is refused before admin-service sees it —
 * §5.8 therefore makes a row clickable only when the catalog names a primary
 * key *and* says that column is a `uuid`.
 *
 * A key the catalog marks sensitive is refused too, for the other reason: the
 * row address *contains* the key, so linking a masked key would print in the
 * URL bar, in the link's accessible name and in browser history exactly the
 * value the table just refused to show.
 */
export function isAddressableKey(table?: AdminTable): boolean {
  if (!table?.primaryKey) return false;
  const keyColumn = table.columns.find((column) => column.name === table.primaryKey);
  if (!keyColumn || keyColumn.sensitive) return false;
  return keyColumn.type?.trim().toLowerCase() === "uuid";
}

/**
 * Whether the catalog's column type reads as a moment in time.
 *
 * Deliberately looser than `classifyColumnType`, and deliberately kept apart
 * from it: this one only feeds the typography rule below, where a type spelled
 * `timestamptz` by some future catalog should still get tabular figures. The
 * filter operators may not use it — there, being generous means offering an
 * operator the gateway refuses.
 */
function looksTemporal(type: string) {
  return type.includes("timestamp") || type.includes("date") || type.includes("time");
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
  if (looksTemporal(normalized)) return true;
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

/**
 * The literal a fully masked value arrives as. `admin-service` replaces the
 * whole value with it, so this is a protocol constant rather than a guess
 * about content.
 */
const fullyMaskedValue = "***";

/**
 * Whether this cell has to be shown as withheld rather than printed.
 *
 * `admin-service` masks sensitive columns server-side in three ways and the
 * catalog does not say which one a column got — it says only `sensitive:
 * true`. So the treatment has to be read off the value that arrived, which is
 * the one place the distinction survives:
 *
 * - `HIDE` deletes the key from the row, so it arrives as `undefined`;
 * - `MASK_FULL` replaces the value with `"***"`;
 * - `MASK_PARTIAL` keeps the first and last character and stars the middle.
 *
 * The first two are the same fact to a reader — nothing came back — and both
 * get the lock. The third is a value: degraded, but real. `n****a@mail.ru`
 * answers "which mailbox is this?", and hiding it behind a lock throws away
 * the entire point of having asked for a partial mask. The column's own header
 * carries the lock that says the column is masked, so a partly starred value
 * cannot be mistaken for what is stored.
 *
 * `null` is neither case: an absent value rather than a withheld one, and it
 * reads as the same `—` as any other null. Only a missing *key* means the
 * server took the column away, and JSON keeps those two apart for us.
 *
 * The last clause is the one that is not about display. A sensitive value is
 * printed only when it carries evidence of having been masked — a `*` — and a
 * sensitive column that arrives in clear is withheld here anyway. That is not
 * hypothetical: printing whatever the gateway sends is exactly the regression
 * `AdminScreen.test.tsx` pins, where a password hash reached the screen. The
 * catalog said the column holds secrets; if the value contradicts that, the
 * catalog is the one we believe. `maskPartial` on the backend stars every
 * result it produces — a value of two characters or fewer, and `null` itself,
 * come back as `"***"` — so this rule cannot withhold a genuinely masked cell.
 */
export function isWithheld(sensitive: boolean, value: unknown): boolean {
  if (!sensitive) return false;
  if (value === undefined) return true;
  // An absent value is not a withheld one, and the column header already says
  // the column is masked.
  if (value === null) return false;
  if (value === fullyMaskedValue) return true;
  // A non-string on a secret column cannot be checked for masking at all, so
  // it does not get printed.
  return typeof value !== "string" || !value.includes("*");
}
