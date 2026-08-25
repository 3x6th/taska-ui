import type { AdminPagination } from "../../domain/types";

/**
 * The pagination footer of an admin table (DESIGN.md §5.8) — inside the table's
 * own scroll container and stuck to its bottom edge, so paging never requires
 * scrolling to the end of the rows first.
 *
 * Shown **always**, even on a single page: "Page 1 of 1" is the answer to "am I
 * seeing all of it?", and a footer that comes and goes changes the height of
 * the working area every time a filter narrows the result. The buttons are
 * simply disabled when there is nowhere to go.
 *
 * Its own file since TAS-186, because the Users section needs the same footer
 * under a table of its own — one that has no sortable header and no filter, so
 * it cannot borrow `AdminRowsTable` whole. Copying eleven lines of pager into a
 * second section is how two footers start disagreeing about what page 0 means.
 */
export function AdminPager({
  pagination,
  onPage,
}: {
  pagination: AdminPagination;
  onPage: (page: number) => void;
}) {
  return (
    <div className="admin-pager">
      <button
        className="secondary-button"
        disabled={!pagination.hasPrev}
        onClick={() => onPage(Math.max(1, pagination.currentPage - 1))}
        type="button"
      >
        Previous
      </button>
      {/* `Math.max(1, …)`: the gateway answers `totalPages: 0` for an empty
          table, and "Page 1 of 0" reads as a rendering fault rather than as an
          answer to "am I seeing all of it?", which is what §5.8 keeps this
          footer for. An empty table is one page of nothing — the row count
          beside the table name already says which. */}
      <span aria-live="polite">
        Page {pagination.currentPage} of {Math.max(1, pagination.totalPages)}
      </span>
      <button
        className="secondary-button"
        disabled={!pagination.hasNext}
        onClick={() => onPage(pagination.currentPage + 1)}
        type="button"
      >
        Next
      </button>
    </div>
  );
}
