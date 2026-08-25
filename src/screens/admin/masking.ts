import type { AdminTable } from "../../domain/types";

/**
 * The fail-closed rules the two table sections share — Data (`AdminDataSection`)
 * and the Events section's Outbox journal, which is the same generic grid
 * pinned to one table (DESIGN.md §5.8).
 *
 * They live here rather than in either screen because they are the rules that
 * must not diverge: a second copy of "which columns hold secrets" is a second
 * chance to answer it wrongly, and the wrong answer prints a value the catalog
 * said to hide.
 */

/** The names the catalog marks as holding secrets. Empty when it says nothing. */
export function sensitiveColumnsOf(table: AdminTable | undefined): Set<string> {
  return new Set(table?.columns.filter((column) => column.sensitive).map((column) => column.name) ?? []);
}

/**
 * Whether *every* column of a table is marked sensitive, which is the other end
 * of the fail-closed rule and a state that has to be entered loudly.
 *
 * `sensitive` is optional in the contract, and `RestTaskaApi` reads a missing
 * flag as `true` — so a gateway that stops sending the field turns a
 * *successful* read into a table where every column is locked, the key included,
 * with no sort, no filter form and no row links. That is indistinguishable on
 * screen from a table which genuinely holds nothing but secrets, and a state we
 * cannot tell apart from a real one must not be entered silently.
 *
 * A real table whose every column — including its primary key — is a secret does
 * not exist, so there is nothing to guard against a false positive here.
 */
export function everyColumnIsSensitive(table: AdminTable | undefined, sensitive: Set<string>): boolean {
  return table !== undefined && table.columns.length > 0 && sensitive.size === table.columns.length;
}

/**
 * What the server said it will sort or filter on, or every column when it said
 * nothing.
 *
 * The gateway does not populate `sortableColumns`/`filterableColumns` yet — they
 * are unfinished on the backend (docs/ai/API-DIVERGENCE.md), and taking the
 * empty lists literally would mean no sorting and no filtering at all against a
 * real gateway while both work fully against the mock. Falling back to every
 * column is safe: the server validates the sort column itself and accepts a
 * filter on any column it has. When it starts stating the lists, they win and
 * this fallback stops applying on its own.
 */
export function statedColumns(list: string[] | undefined, columns: string[]): string[] {
  return list && list.length > 0 ? list : columns;
}
