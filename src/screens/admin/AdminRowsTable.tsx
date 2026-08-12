import { ChevronRight, Lock } from "lucide-react";
import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { AdminRow, AdminRows, AdminSortOrder, AdminTable } from "../../domain/types";
import { useCopied } from "../../hooks/useCopied";
import { formatCell, isAlignedType } from "./columns";

interface AdminRowsTableProps {
  rows: AdminRows;
  /**
   * The catalog entry for the table the *rows* say they came from, never for
   * the current selection. The two differ while a table switch is in flight,
   * and the masking rules have to come from the same place as the values.
   */
  table: AdminTable;
  sortable: Set<string>;
  sort: string | null;
  order: AdminSortOrder;
  onSort: (column: string) => void;
  onPage: (page: number) => void;
  /** Said in the body when there are no rows, with the table itself kept. */
  empty: string;
  /**
   * Where a row opens, or `null` when it cannot be opened at all — the gateway
   * takes the row id as a `UUID`, so a table keyed by a code or a number has no
   * addressable rows (§5.8). Returning `null` is not a styling choice: a link
   * that is certain to be refused is worse than no link.
   */
  rowHref: (row: AdminRow) => string | null;
}

/**
 * The rows themselves (DESIGN.md §5.8). Denser than anything else in the
 * product because this is reading raw records, not working with issues: 30px
 * rows, a sticky header, the primary key frozen against the horizontal scroll,
 * and the pagination in the table's own sticky footer.
 */
export function AdminRowsTable({
  rows,
  table,
  sortable,
  sort,
  order,
  onSort,
  onPage,
  empty,
  rowHref,
}: AdminRowsTableProps) {
  const navigate = useNavigate();
  const columns = rows.meta.columns;
  const name = `${rows.meta.service}.${rows.meta.table}`;
  // Whether this table has openable rows at all, which is what decides the
  // extra column. Asked of the page as a whole rather than per row, so one row
  // with a null key cannot take the column away from the rest.
  const opens = rows.rows.some((row) => rowHref(row) !== null);

  const sensitiveColumns = useMemo(
    () => new Set(table.columns.filter((column) => column.sensitive).map((column) => column.name)),
    [table],
  );
  // Monospace is per column and comes from the catalog's type: ids, timestamps,
  // numbers and JSON are compared down the column and want tabular figures;
  // `email` and `display_name` are prose and stay in the UI font (§5.8). An
  // unknown or missing type falls back to prose.
  const alignedColumns = useMemo(
    () => new Set(table.columns.filter((column) => isAlignedType(column.type)).map((column) => column.name)),
    [table],
  );
  // Only the first column can be frozen against a horizontal scroll: sticking a
  // later one to `left: 0` would park it on top of the columns before it. In
  // every catalog seen so far the primary key is first, which is the case the
  // rule is about — when it is not, the table simply scrolls whole.
  const frozenColumn = columns[0] === table.primaryKey ? table.primaryKey : undefined;

  const cellClass = (column: string, value: unknown) =>
    [
      alignedColumns.has(column) ? "admin-cell-mono" : "",
      column === frozenColumn ? "admin-cell-frozen" : "",
      // The dash that stands in for an absent value is chrome, not content, and
      // §5.8 gives it `--fg-3` in the table exactly as on the card. Marked on
      // the cell rather than inside `formatCell`, which stays a pure string and
      // keeps telling `null` apart from the string "null".
      (value === null || value === undefined) && !sensitiveColumns.has(column) ? "admin-cell-null" : "",
    ]
      .filter(Boolean)
      .join(" ");

  return (
    // The scroll container is focusable and named on purpose (§7): a table with
    // no sortable column has nothing tabbable inside it, and without this it
    // cannot be scrolled sideways from the keyboard at all in Safari or Firefox.
    <div aria-label={`${name} rows`} className="admin-table-scroll" role="region" tabIndex={0}>
      {/* Named as well as the region around it: table-navigation mode announces
          the table itself, and an anonymous one tells the reader nothing about
          which table they have landed in. */}
      <table aria-label={name} className="admin-table">
        <thead>
          <tr>
            {columns.map((column) => {
              const isSorted = sort === column;
              const canSort = sortable.has(column);
              return (
                <th
                  className={column === frozenColumn ? "admin-cell-frozen" : undefined}
                  // Only a sortable column has a sort state; "none" on a column
                  // that can never be sorted claims otherwise.
                  aria-sort={
                    !canSort ? undefined : isSorted ? (order === "asc" ? "ascending" : "descending") : "none"
                  }
                  key={column}
                >
                  {canSort ? (
                    <button className="admin-sort" onClick={() => onSort(column)} type="button">
                      {column}
                      <span aria-hidden="true">{isSorted ? (order === "asc" ? " ↑" : " ↓") : ""}</span>
                    </button>
                  ) : (
                    column
                  )}
                </th>
              );
            })}
            {/* The column that carries the row's own link. Named for a screen
                reader and empty to the eye: a visible header over a chevron
                would caption the one column that is not the table's data. */}
            {opens ? (
              <th className="admin-open-head">
                <span className="visually-hidden">Open row</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.rows.length === 0 ? (
            <tr>
              {/* `aria-live`, not `role="status"`: the role would replace the
                  cell role, and in table-navigation mode the message would
                  stop being part of the grid it is explaining. */}
              <td aria-live="polite" className="admin-empty-cell" colSpan={columns.length || 1}>
                {empty}
              </td>
            </tr>
          ) : null}
          {rows.rows.map((row, index) => {
            const href = rowHref(row);
            const key = formatCell(row[table.primaryKey]);
            return (
              // The whole row is the pointer target (§5.8), and the link in the
              // last cell is the same move for the keyboard — the row itself
              // cannot be the control without lying to a screen reader about
              // what a table row is. A click that lands on the key's copy
              // button, or that ends a text selection, is not a navigation.
              <tr
                className={href ? "admin-row-opens" : undefined}
                key={String(row[table.primaryKey] ?? index)}
                onClick={(event) => {
                  if (!href) return;
                  if ((event.target as HTMLElement).closest("a, button")) return;
                  if (window.getSelection()?.toString()) return;
                  // A modifier says "not here": ⌘/Ctrl for a new tab, Shift for
                  // a new window, Alt to download. Routing in-app anyway would
                  // take the one gesture an admin uses to keep the table open
                  // while reading a row — the link in the last cell is a real
                  // link and does all of that itself.
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  void navigate(href);
                }}
              >
                {columns.map((column) => (
                  <td className={cellClass(column, row[column]) || undefined} key={column}>
                    {column === frozenColumn && !sensitiveColumns.has(column) ? (
                      <PrimaryKeyCell value={formatCell(row[column])} />
                    ) : sensitiveColumns.has(column) ? (
                      // The catalog says this column holds secrets. Say that it
                      // exists and stop there — not a masked length, which leaks
                      // one. The label distinguishes a withheld cell from one
                      // whose content happens to be the word "hidden", and
                      // deliberately avoids the word "value" so it cannot collide
                      // with the filter form's own labels.
                      <span aria-label="hidden by the catalog" className="admin-hidden-cell">
                        <Lock aria-hidden="true" size={11} />
                        hidden
                      </span>
                    ) : (
                      formatCell(row[column])
                    )}
                  </td>
                ))}
                {opens ? (
                  <td className="admin-open-cell">
                    {href ? (
                      <Link aria-label={`Open row ${key}`} className="admin-open-row" to={href}>
                        <ChevronRight aria-hidden="true" size={14} />
                      </Link>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Always, even on a single page (§5.8): "Page 1 of 1" answers "am I
          seeing all of it?", and a footer that comes and goes changes the
          height of the working area every time a filter narrows the result.
          Inside the scroll container and stuck to its bottom edge, so paging
          does not require scrolling to the end of the rows first. */}
      <div className="admin-pager">
        <button
          className="secondary-button"
          disabled={!rows.pagination.hasPrev}
          onClick={() => onPage(Math.max(1, rows.pagination.currentPage - 1))}
          type="button"
        >
          Previous
        </button>
        {/* `Math.max(1, …)`: the gateway answers `totalPages: 0` for an empty
            table, and "Page 1 of 0" reads as a rendering fault rather than as
            an answer to "am I seeing all of it?", which is what §5.8 keeps this
            footer for. An empty table is one page of nothing — the row count
            beside the table name already says which. */}
        <span aria-live="polite">
          Page {rows.pagination.currentPage} of {Math.max(1, rows.pagination.totalPages)}
        </span>
        <button
          className="secondary-button"
          disabled={!rows.pagination.hasNext}
          onClick={() => onPage(rows.pagination.currentPage + 1)}
          type="button"
        >
          Next
        </button>
      </div>
    </div>
  );
}

/** Longer than this and the frozen column stops being narrow enough to freeze. */
const KEY_LIMIT = 12;
const KEY_SHOWN = 8;

/**
 * The primary key, shortened (§5.8). A 36-character uuid made the frozen column
 * the widest in the table and pushed the real content off the right edge — the
 * exact complaint this section was rebuilt to fix.
 *
 * Shortening a value the reader may need in full is only acceptable if the full
 * one stays reachable: it is in `title` for a pointer, in the accessible name
 * for a screen reader, and on the clipboard in one click for the case that
 * actually happens — pasting it into a query somewhere else.
 */
function PrimaryKeyCell({ value }: { value: string }) {
  const [copyState, copy] = useCopied();
  const short = value.length > KEY_LIMIT ? `${value.slice(0, KEY_SHOWN)}…` : value;

  if (short === value) return <>{value}</>;

  return (
    <>
      <button
        aria-label={`Copy ${value}`}
        className={copyState === "idle" ? "admin-key" : `admin-key is-${copyState}`}
        onClick={() => copy(value)}
        title={value}
        type="button"
      >
        {short}
      </button>
      {/* The confirmation takes no width. An inline "Copied" widened the frozen
          column by 45px for two seconds and shifted every column twice, in a
          table whose whole point is that the eye runs down a column — so the
          eye gets a tint on the key itself and the screen reader gets this.
          A failure is announced in words either way: a red tint alone would
          leave a colour-blind reader with a click that did nothing. */}
      <span className="visually-hidden" role="status">
        {copyState === "copied" ? "Copied" : copyState === "failed" ? "Couldn’t copy" : ""}
      </span>
    </>
  );
}
