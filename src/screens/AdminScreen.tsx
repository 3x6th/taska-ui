import { useQuery } from "@tanstack/react-query";
import { useId, useMemo, useState } from "react";
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
  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => taskaApi.getCurrentUser(),
  });

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
  const filterId = useId();
  const catalogQuery = useQuery({
    queryKey: ["admin", "catalog"],
    queryFn: () => taskaApi.getAdminCatalog(),
  });
  const [selection, setSelection] = useState<{
    service: string;
    table: string;
  } | null>(null);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<string | null>(null);
  const [order, setOrder] = useState<AdminSortOrder>("asc");
  const [draftFilter, setDraftFilter] = useState({
    column: "",
    operator: "eq" as AdminFilterOperator,
    value: "",
  });
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
    () =>
      shown
        ? findTable(catalog, {
            service: shown.meta.service,
            table: shown.meta.table,
          })
        : undefined,
    [catalog, shown],
  );
  // Fail closed. The sensitive set is a *join* between the rows response and
  // the catalog, and nothing in the contract obliges the two endpoints to spell
  // a service or table identically. If the join misses we do not know which
  // columns hold secrets — and "no columns are sensitive" is the one answer we
  // must not default to, because it is indistinguishable on screen from a
  // genuinely harmless table. No catalog entry, no values.
  const maskingIsKnown = !shown || shownTable !== undefined;
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

  // Only when there is nothing to fall back on. react-query keeps `data` when a
  // *background* refetch fails, and replacing a working console with an alert
  // because a window-focus refresh lost the network is a worse answer than the
  // slightly stale table already on screen.
  if (catalogQuery.isError && catalog === undefined) {
    return <AdminError error={catalogQuery.error} onRetry={() => void catalogQuery.refetch()} />;
  }

  const services = catalog?.services ?? [];
  if (services.length === 0) {
    return <p className="admin-note">This gateway lists no services to read.</p>;
  }
  if (services.every((service) => (service.tables ?? []).length === 0)) {
    return <p className="admin-note">This gateway lists no tables to read.</p>;
  }

  const rows = shown;
  const columns = rows?.meta.columns ?? [];
  // The gateway does not populate `sortableColumns`/`filterableColumns` yet —
  // they are unfinished on the backend (docs/ai/API-DIVERGENCE.md), and taking
  // the empty lists literally would mean no sorting and no filtering at all
  // against a real gateway while both work fully against the mock. Falling back
  // to every column is safe: the server validates the sort column itself and
  // accepts a filter on any column it has. When it starts stating the lists,
  // they win and this fallback stops applying on its own.
  const stated = (list: string[] | undefined) => (list && list.length > 0 ? list : columns);
  // A column whose values we refuse to show must not be sortable or filterable
  // either: ordering by it leaks its order, and filtering on it turns the table
  // into a match oracle for the value we just hid.
  const sortable = new Set(stated(rows?.meta.sortableColumns).filter((column) => !sensitiveColumns.has(column)));
  const filterable = stated(rows?.meta.filterableColumns).filter((column) => !sensitiveColumns.has(column));
  // `from`/`to` are cast to a timestamp server-side, so offering them on a text
  // column produces a database error the UI cannot explain rather than an empty
  // result. The catalog states each column's type, so only offer the range
  // operators where they can actually work.
  const draftColumnType = shownTable?.columns.find((column) => column.name === draftFilter.column)?.type;
  const operators = (Object.keys(operatorLabels) as AdminFilterOperator[]).filter(
    (operator) => !isRangeOperator(operator) || isTemporal(draftColumnType),
  );
  const busy = rowsQuery.isFetching;
  // Specifically "the rows on screen are from a different table than the one
  // selected", not "a request is in flight". Filtering and paging refetch
  // constantly and must stay usable; only a table *switch* leaves the filter
  // form describing columns the incoming rows will not have.
  const switchingTable = Boolean(
    shown && current && (shown.meta.service !== current.service || shown.meta.table !== current.table),
  );

  return (
    <>
      <nav aria-label="Tables" className="admin-tables">
        {services.map((service) => (
          <div key={service.name} className="admin-service">
            <h2>{service.name}</h2>
            <ul>
              {(service.tables ?? []).map((serviceTable) => {
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
        // `isFetching`, not `isPending`: after the first load `placeholderData`
        // keeps the previous rows, so the query is never "pending" again and
        // nothing would otherwise say the table on screen is out of date.
        <div className="admin-result" aria-busy={busy}>
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
              // Mid-switch the form still describes the table on screen while
              // the selection has already moved on, so applying it would send
              // one table's column against another's rows.
              inert={switchingTable || undefined}
            >
              {/* Explicitly associated rather than wrapping: a <label> that
                  wraps a <select> takes every option's text into its accessible
                  name, so the control announces "Column None id email …". */}
              <label htmlFor={`${filterId}-column`}>
                <span>Column</span>
              </label>
              <select
                id={`${filterId}-column`}
                onChange={(event) => {
                  const column = event.target.value;
                  const type = shownTable?.columns.find((item) => item.name === column)?.type;
                  // Moving from a timestamp column to a text one strands the
                  // operator on a value the new column cannot take, and the
                  // select would show a blank because the option is gone.
                  const operator =
                    isRangeOperator(draftFilter.operator) && !isTemporal(type) ? "eq" : draftFilter.operator;
                  setDraftFilter({ ...draftFilter, column, operator });
                }}
                value={draftFilter.column}
              >
                <option value="">None</option>
                {filterable.map((column) => (
                  <option key={column} value={column}>
                    {column}
                  </option>
                ))}
              </select>
              <label htmlFor={`${filterId}-match`}>
                <span>Match</span>
              </label>
              <select
                id={`${filterId}-match`}
                onChange={(event) =>
                  setDraftFilter({
                    ...draftFilter,
                    operator: event.target.value as AdminFilterOperator,
                  })
                }
                value={draftFilter.operator}
              >
                {operators.map((operator) => (
                  <option key={operator} value={operator}>
                    {operatorLabels[operator]}
                  </option>
                ))}
              </select>
              <label htmlFor={`${filterId}-value`}>
                <span>Value</span>
              </label>
              <input
                id={`${filterId}-value`}
                onChange={(event) => setDraftFilter({ ...draftFilter, value: event.target.value })}
                value={draftFilter.value}
              />
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

          {rowsQuery.isError && rows === undefined ? (
            <AdminError error={rowsQuery.error} onRetry={() => void rowsQuery.refetch()} />
          ) : rowsQuery.isPending ? (
            <p className="admin-note" role="status">
              Loading rows…
            </p>
          ) : !maskingIsKnown ? (
            // Fail closed: the rows arrived, but the catalog has no entry for
            // the table they claim to be from, so nothing here knows which
            // columns hold secrets. Showing the rows anyway would be a guess in
            // the one direction that cannot be taken back.
            <div className="admin-note" role="alert">
              <p>
                The catalog does not describe {rows?.meta.service}.{rows?.meta.table}, so this table cannot be shown
                without risking a column that should have stayed hidden.
              </p>
            </div>
          ) : rows && rows.rows.length === 0 ? (
            <p className="admin-note" role="status">
              {filter ? "No rows match this filter." : "This table is empty."}
            </p>
          ) : (
            <div className="admin-table-scroll">
              <table className="admin-table" aria-label={rows ? `${rows.meta.service}.${rows.meta.table}` : undefined}>
                <thead>
                  <tr>
                    {columns.map((column) => {
                      const isSorted = sort === column;
                      const canSort = sortable.has(column);
                      return (
                        <th
                          // Only a sortable column has a sort state; "none" on a
                          // column that can never be sorted claims otherwise.
                          aria-sort={
                            !canSort ? undefined : isSorted ? (order === "asc" ? "ascending" : "descending") : "none"
                          }
                          key={column}
                        >
                          {canSort ? (
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
                            // length, which leaks one. The label distinguishes a
                            // withheld cell from one whose content happens to be
                            // the word "hidden", and deliberately avoids the
                            // word "value" so it cannot collide with the filter
                            // form's own labels.
                            <span aria-label="hidden by the catalog" className="admin-hidden-cell">
                              hidden
                            </span>
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
  // Every error response carries X-Request-Id, and the gateway exposes it
  // cross-origin. This screen's audience is the one person who will go and read
  // the gateway log, so it is the one screen where showing it earns its space.
  const requestId = error instanceof Error ? (error as { requestId?: unknown }).requestId : undefined;
  return (
    <div className="admin-note" role="alert">
      <p>
        {refused
          ? "The server refused this. Either this account is not a global admin as far as the gateway is concerned, or the table is not one it will serve."
          : "The read-only admin API could not be reached."}
      </p>
      {error instanceof Error && error.message ? <p className="admin-error-detail">{error.message}</p> : null}
      {typeof requestId === "string" && requestId ? (
        <p className="admin-error-detail">Request ID: {requestId}</p>
      ) : null}
      <button className="secondary-button" onClick={onRetry} type="button">
        Try again
      </button>
    </div>
  );
}

/** `from`/`to` become a timestamp comparison server-side; the others do not. */
function isRangeOperator(operator: AdminFilterOperator) {
  return operator === "from" || operator === "to";
}

/** Whether the catalog's column type is one a timestamp comparison can be made against. */
function isTemporal(type?: string) {
  if (!type) return false;
  const normalized = type.toLowerCase();
  return normalized.includes("timestamp") || normalized.includes("date") || normalized.includes("time");
}

function defaultSelection(catalog?: AdminCatalog) {
  const service = catalog?.services?.find((item) => (item.tables ?? []).length > 0);
  const table = service?.tables?.[0];
  return service && table ? { service: service.name, table: table.name } : null;
}

function findTable(
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
function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}
