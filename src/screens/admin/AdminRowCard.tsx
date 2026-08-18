import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, Lock } from "lucide-react";
import { Link } from "react-router-dom";
import { taskaApi } from "../../api/client";
import type { AdminTable } from "../../domain/types";
import { useCopied } from "../../hooks/useCopied";
import { AdminError } from "./AdminError";
import { formatCell, isAlignedType, isWithheld } from "./columns";

interface AdminRowCardProps {
  service: string;
  table: string;
  rowId: string;
  /**
   * The catalog entry for this table, or `undefined` when the catalog does not
   * describe it. Undefined is not a rendering detail — it is the fail-closed
   * case: without the catalog nothing here knows which columns hold secrets.
   */
  catalogTable: AdminTable | undefined;
  /** The table's own `page`/`sort`/`filter`, so Back returns to the view the reader left. */
  backQuery: string;
}

/**
 * One row, by its primary key (DESIGN.md §5.8).
 *
 * The body of the section rather than a modal: this address has to open from a
 * pasted link for the next admin, and a modal restored from a URL arrives on
 * top of nothing. The rail and the catalog column stay where they are — the
 * reader has not left the table, they are looking at one of its rows.
 */
export function AdminRowCard({ service, table, rowId, catalogTable, backQuery }: AdminRowCardProps) {
  const rowQuery = useQuery({
    queryKey: ["admin", "row", service, table, rowId],
    queryFn: () => taskaApi.getAdminRow({ service, table, id: rowId }),
    // A row that is not there will not appear on a retry, and three failed
    // attempts only make the answer slower.
    retry: false,
  });

  const name = `${service}.${table}`;
  const backTo = `/admin/data/${service}/${table}${backQuery ? `?${backQuery}` : ""}`;

  return (
    <div className="admin-plane">
      <div className="admin-plane-head">
        {/* Carries the query it came with: returning from a row on page 7 of a
            filtered table has to land back on page 7 of that filter (§5.8).
            Named "Back to …" because the chevron is `aria-hidden`: without it
            the link's whole accessible name is the table's, which is also the
            heading thirty pixels below — two identical words, neither of which
            says this one is the way out. The visible text stays the name. */}
        <Link aria-label={`Back to ${name}`} className="admin-back-link" to={backTo}>
          <ChevronLeft aria-hidden="true" size={14} />
          {name}
        </Link>
      </div>

      {rowQuery.isPending ? (
        <p className="admin-note" role="status">
          Loading the row…
        </p>
      ) : isRowMissing(rowQuery.error) ? (
        // Not §4.18. The address is a real one — this section, this service,
        // this table — and only the row it names is absent, so the answer stays
        // inside the section with the rail and the catalog still working.
        <p className="admin-note" role="status">
          No row with this key in {name}.
        </p>
      ) : rowQuery.isError ? (
        <AdminError error={rowQuery.error} onRetry={() => void rowQuery.refetch()} />
      ) : !catalogTable ? (
        // Fail closed, exactly as the table does: the row arrived, but nothing
        // here knows which of its columns the catalog marks sensitive, and
        // "none of them" is the one guess that cannot be taken back.
        <div className="admin-note" role="alert">
          <p>
            The catalog does not describe {name}, so this row cannot be shown without risking a column that should have
            stayed hidden.
          </p>
        </div>
      ) : (
        <article className="admin-card">
          <header className="admin-card-head">
            {/* h2, like the table plane's caption it replaces: the card is the
                body of the section, not a level below one. */}
            <h2 className="admin-card-table">{name}</h2>
            {/* In full, unlike the table's frozen cell: shortening exists to
                keep that column narrow, and this card is where a reader goes
                for the whole value. */}
            <CardKey value={rowId} />
          </header>

          {/* The catalog's columns, in the catalog's order — the same list the
              masking rules come from. A key the row carries but the catalog
              does not name is not rendered: an undescribed column is one we
              cannot prove is safe to print. */}
          <dl className="admin-card-fields">
            {catalogTable.columns.map((column) => {
              const value = rowQuery.data?.[column.name];
              return (
                <div className="admin-card-field" key={column.name}>
                  {/* The same split as the table: the term carries the lock
                      that says the column is masked, so a partly starred value
                      below it cannot read as what is stored. */}
                  <dt>
                    {column.name}
                    {column.sensitive ? (
                      <span className="admin-masked-head" title="masked column">
                        <Lock aria-hidden="true" size={10} />
                        <span className="visually-hidden">{", masked column"}</span>
                      </span>
                    ) : null}
                  </dt>
                  <dd
                    className={[
                      "admin-card-value",
                      isAlignedType(column.type) ? "admin-cell-mono" : "",
                      (value === null || value === undefined) && !isWithheld(column.sensitive, value)
                        ? "admin-card-null"
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {isWithheld(column.sensitive, value) ? (
                      // No lock here, unlike the table: the term sits directly
                      // above the value, and two identical padlocks 38px apart
                      // read as a stutter rather than as two statements. The
                      // table keeps its cell lock because there the column's
                      // own label is far away in the frozen header.
                      <span aria-label="withheld by the server" className="admin-hidden-cell">
                        hidden
                      </span>
                    ) : (
                      formatCell(value)
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        </article>
      )}
    </div>
  );
}

/**
 * The row's key, copied by clicking it — the same bargain as the table's frozen
 * cell (§5.8), minus the shortening: nothing here is competing for width. The
 * confirmation is a two-second tint plus a live region rather than a word beside
 * it, so the card does not reflow while it is being read.
 */
function CardKey({ value }: { value: string }) {
  const [copyState, copy] = useCopied();

  return (
    <p className="admin-card-key">
      <button
        aria-label={`Copy ${value}`}
        className={copyState === "idle" ? "admin-key" : `admin-key is-${copyState}`}
        onClick={() => copy(value)}
        type="button"
      >
        {value}
      </button>
      <span className="visually-hidden" role="status">
        {copyState === "copied" ? "Copied" : copyState === "failed" ? "Couldn’t copy" : ""}
      </span>
    </p>
  );
}

/**
 * A row that is not there, as opposed to a refusal or a fault. The two error
 * classes in this codebase are unrelated (see src/api/errors.ts): the REST one
 * carries an HTTP `status`, the mock carries a `code`. `isMissingOrForbidden`
 * cannot be used here — it folds 403 in with 404 on purpose, and a refusal is
 * about the account, not about this row.
 */
function isRowMissing(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const { code, status } = error as Partial<{ code: unknown; status: unknown }>;
  return status === 404 || code === "NOT_FOUND";
}
