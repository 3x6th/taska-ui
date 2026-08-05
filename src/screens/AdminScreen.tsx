import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { taskaApi } from "../api/client";
import { isMissingOrForbidden } from "../api/errors";
import { ThemeToggle } from "../components/ThemeToggle";
import { TopBar } from "../components/TopBar";
import type { AdminCatalog, AdminFilterOperator, AdminSortOrder, AdminTable } from "../domain/types";
import type { ScreenProps } from "./App";
import { NotFoundScreen } from "./NotFoundScreen";

const PAGE_SIZE = 20;

const operatorLabels: Record<AdminFilterOperator, string> = {
  eq: "is",
  contains: "contains",
  from: "from",
  to: "to",
};

/**
 * The administration section (`/admin`) — a read-only window onto the services'
 * own tables, over `GET /readonly/metadata` and `GET /readonly/{service}/{table}`.
 *
 * Read-only is the whole design: nothing here writes, and no control implies it
 * could. The role gate below hides the section; it does not protect it. The
 * server does that — both endpoints are `GLOBAL_ADMIN`-only and enumerate
 * 401/403 — so this screen renders whatever they answer rather than assuming a
 * refusal cannot arrive.
 */
export function AdminScreen({ theme, toggleTheme, onLogout, logoutPending }: ScreenProps) {
  const meQuery = useQuery({ queryKey: ["me"], queryFn: () => taskaApi.getCurrentUser() });

  // Deciding before `me` settles would flash Page not found on every single
  // load of this screen, admins included. Nothing is drawn until the answer is
  // in — not even the top bar, because showing the shell first and replacing it
  // with the not-found screen is the same "a second of plausible chrome" that
  // DESIGN.md §4.18 exists to avoid.
  if (meQuery.isPending) {
    // Drawing nothing is right for the eye and wrong for a screen reader, which
    // would otherwise be told nothing at all — `aria-busy` on an empty landmark
    // announces nothing — so the status text goes out of sight, not out of the
    // accessibility tree.
    return (
      <main className="page-shell" aria-busy="true">
        <p className="visually-hidden" role="status">
          Loading
        </p>
      </main>
    );
  }

  // Not an admin — and an account whose role the server never stated is not an
  // admin either (docs/ai/API-DIVERGENCE.md), same for a profile that failed to
  // load at all. The answer is the one an unknown URL gets, so this section's
  // existence is not confirmed to someone who cannot use it (§4.18).
  if (meQuery.data?.globalRole !== "GLOBAL_ADMIN") {
    return <NotFoundScreen />;
  }

  return (
    <main className="page-shell">
      <TopBar
        right={<ThemeToggle theme={theme} onToggle={toggleTheme} />}
        user={meQuery.data}
        userLoading={meQuery.isPending}
        loggingOut={logoutPending}
        onLogout={onLogout}
      />
      <section className="admin-page">
        {/* One block child, so the content column centres structurally and every
            child — including inline-level ones like the link below — starts on
            the same x as the project list's heading. */}
        <div>
          <h1>Administration</h1>
          <AdminConsole />
          {/* The way out lives in the shell, not in the console: the logo is not
              a link and the top bar carries no back control. */}
          <Link to="/projects" className="secondary-button admin-back">
            Back to projects
          </Link>
        </div>
      </section>
    </main>
  );
}

function AdminConsole() {
  const catalogQuery = useQuery({ queryKey: ["admin", "catalog"], queryFn: () => taskaApi.getAdminCatalog() });
  const [selection, setSelection] = useState<{ service: string; table: string } | null>(null);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<string | null>(null);
  const [order, setOrder] = useState<AdminSortOrder>("asc");
  const [draftFilter, setDraftFilter] = useState({ column: "", operator: "eq" as AdminFilterOperator, value: "" });
  const [filter, setFilter] = useState<typeof draftFilter | null>(null);

  const catalog = catalogQuery.data;
  // Nothing is chosen on the first render, so the first table in the catalog
  // stands in — an admin console that opens on an empty frame and asks you to
  // pick before showing anything is a worse answer than showing something.
  const current = selection ?? defaultSelection(catalog);

  const rowsQuery = useQuery({
    queryKey: ["admin", "rows", current?.service, current?.table, page, sort, order, filter],
    queryFn: () =>
      taskaApi.listAdminRows({
        service: current!.service,
        table: current!.table,
        page,
        pageSize: PAGE_SIZE,
        sort: sort ?? undefined,
        order: sort ? order : undefined,
        filters: filter && filter.column ? [filter] : undefined,
      }),
    enabled: Boolean(current),
    // Paging swaps the whole table for a spinner otherwise, and the row a
    // person was reading jumps as it comes back.
    placeholderData: (previous) => previous,
  });

  // Everything about the table on screen is read from the response's own
  // `meta`, never from the current selection. While a new table loads,
  // `placeholderData` still holds the previous one's rows — and deriving the
  // sensitive-column set from the *selection* instead meant that switching from
  // a table with a secret column to one without rendered the old rows with the
  // new table's rules, printing a password hash in clear for a frame. What is
  // drawn and how it is masked have to come from the same place.
  const shown = rowsQuery.data;
  const shownTable = useMemo(
    () => (shown ? findTable(catalog, { service: shown.meta.service, table: shown.meta.table }) : undefined),
    [catalog, shown],
  );
  const sensitiveColumns = useMemo(
    () => new Set(shownTable?.columns.filter((column) => column.sensitive).map((column) => column.name) ?? []),
    [shownTable],
  );

  const selectTable = (service: string, tableName: string) => {
    setSelection({ service, table: tableName });
    // A sort or filter that made sense for the last table is meaningless for
    // this one — its columns are different, and the server would reject or
    // ignore them.
    setPage(1);
    setSort(null);
    setOrder("asc");
    setDraftFilter({ column: "", operator: "eq", value: "" });
    setFilter(null);
  };

  const toggleSort = (column: string) => {
    if (sort === column) {
      setOrder(order === "asc" ? "desc" : "asc");
    } else {
      setSort(column);
      setOrder("asc");
    }
    setPage(1);
  };

  if (catalogQuery.isPending) {
    return <p className="admin-note">Loading the catalog…</p>;
  }

  if (catalogQuery.isError) {
    return <AdminError error={catalogQuery.error} onRetry={() => void catalogQuery.refetch()} />;
  }

  const services = catalog?.services ?? [];
  if (services.length === 0) {
    return <p className="admin-note">This gateway lists no services to read.</p>;
  }

  const rows = shown;
  const columns = rows?.meta.columns ?? [];
  const sortable = new Set(rows?.meta.sortableColumns ?? []);
  const filterable = rows?.meta.filterableColumns ?? [];

  return (
    <>
      <nav aria-label="Tables" className="admin-tables">
        {services.map((service) => (
          <div key={service.name} className="admin-service">
            <h2>{service.name}</h2>
            <ul>
              {service.tables.map((serviceTable) => {
                const active = current?.service === service.name && current.table === serviceTable.name;
                return (
                  <li key={serviceTable.name}>
                    <button
                      aria-current={active ? "true" : undefined}
                      className={`admin-table-button${active ? " is-active" : ""}`}
                      onClick={() => selectTable(service.name, serviceTable.name)}
                      type="button"
                    >
                      {serviceTable.name}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {current ? (
        <div className="admin-result">
          <div className="admin-result-head">
            {/* The table that is actually on screen, which during a switch is
                still the previous one. Naming the selection here would caption
                one table's rows with another table's name. */}
            <h2>{rows ? `${rows.meta.service}.${rows.meta.table}` : `${current.service}.${current.table}`}</h2>
            {rows ? (
              <p className="admin-count">
                {rows.pagination.totalRows} {rows.pagination.totalRows === 1 ? "row" : "rows"}
              </p>
            ) : null}
          </div>

          {filterable.length > 0 ? (
            <form
              className="admin-filter"
              onSubmit={(event) => {
                event.preventDefault();
                setFilter(draftFilter.column ? draftFilter : null);
                setPage(1);
              }}
            >
              <label>
                <span>Column</span>
                <select
                  onChange={(event) => setDraftFilter({ ...draftFilter, column: event.target.value })}
                  value={draftFilter.column}
                >
                  <option value="">None</option>
                  {filterable.map((column) => (
                    <option key={column} value={column}>
                      {column}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Match</span>
                <select
                  onChange={(event) =>
                    setDraftFilter({ ...draftFilter, operator: event.target.value as AdminFilterOperator })
                  }
                  value={draftFilter.operator}
                >
                  {(Object.keys(operatorLabels) as AdminFilterOperator[]).map((operator) => (
                    <option key={operator} value={operator}>
                      {operatorLabels[operator]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Value</span>
                <input
                  onChange={(event) => setDraftFilter({ ...draftFilter, value: event.target.value })}
                  value={draftFilter.value}
                />
              </label>
              <button className="secondary-button" type="submit">
                Apply
              </button>
              {filter ? (
                <button
                  className="link-button"
                  onClick={() => {
                    setDraftFilter({ column: "", operator: "eq", value: "" });
                    setFilter(null);
                    setPage(1);
                  }}
                  type="button"
                >
                  Clear
                </button>
              ) : null}
            </form>
          ) : null}

          {rowsQuery.isError ? (
            <AdminError error={rowsQuery.error} onRetry={() => void rowsQuery.refetch()} />
          ) : rowsQuery.isPending ? (
            <p className="admin-note">Loading rows…</p>
          ) : rows && rows.rows.length === 0 ? (
            <p className="admin-note">
              {filter ? "No rows match this filter." : "This table is empty."}
            </p>
          ) : (
            <div className="admin-table-scroll">
              <table className="admin-table">
                <thead>
                  <tr>
                    {columns.map((column) => {
                      const isSorted = sort === column;
                      return (
                        <th aria-sort={isSorted ? (order === "asc" ? "ascending" : "descending") : "none"} key={column}>
                          {sortable.has(column) ? (
                            <button className="admin-sort" onClick={() => toggleSort(column)} type="button">
                              {column}
                              <span aria-hidden="true">{isSorted ? (order === "asc" ? " ↑" : " ↓") : ""}</span>
                            </button>
                          ) : (
                            column
                          )}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {rows?.rows.map((row, index) => (
                    <tr key={String(row[shownTable?.primaryKey ?? "id"] ?? index)}>
                      {columns.map((column) => (
                        <td key={column}>
                          {sensitiveColumns.has(column) ? (
                            // The catalog says this column holds secrets. Say
                            // that it exists and stop there — not a masked
                            // length, which leaks one.
                            <span className="admin-hidden-cell">hidden</span>
                          ) : (
                            formatCell(row[column])
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {rows && rows.pagination.totalPages > 1 ? (
            <div className="admin-pager">
              <button
                className="secondary-button"
                disabled={!rows.pagination.hasPrev}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
                type="button"
              >
                Previous
              </button>
              <span aria-live="polite">
                Page {rows.pagination.currentPage} of {rows.pagination.totalPages}
              </span>
              <button
                className="secondary-button"
                disabled={!rows.pagination.hasNext}
                onClick={() => setPage((value) => value + 1)}
                type="button"
              >
                Next
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

/**
 * The read-only endpoints may simply not be on this gateway yet — TAS-103 is
 * still in progress — so a failure here is a normal state of the world rather
 * than a broken screen, and saying which failure it was is more useful than a
 * generic apology.
 */
function AdminError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const refused = isMissingOrForbidden(error);
  return (
    <div className="admin-note" role="alert">
      <p>
        {refused
          ? "The server would not serve this. Either the read-only admin API is not deployed on this gateway yet, or it refused this account."
          : "The read-only admin API could not be reached."}
      </p>
      {error instanceof Error && error.message ? <p className="admin-error-detail">{error.message}</p> : null}
      <button className="secondary-button" onClick={onRetry} type="button">
        Try again
      </button>
    </div>
  );
}

function defaultSelection(catalog?: AdminCatalog) {
  const service = catalog?.services.find((item) => item.tables.length > 0);
  const table = service?.tables[0];
  return service && table ? { service: service.name, table: table.name } : null;
}

function findTable(catalog?: AdminCatalog, current?: { service: string; table: string } | null): AdminTable | undefined {
  if (!current) return undefined;
  return catalog?.services
    .find((service) => service.name === current.service)
    ?.tables.find((table) => table.name === current.table);
}

/**
 * These tables are whatever the services hold, so a cell is `unknown` and the
 * console has to be honest about all of it: null is not the string "null", and
 * an object is not "[object Object]".
 */
function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}
