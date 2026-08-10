import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Navigate, useParams, useSearchParams } from "react-router-dom";
import { taskaApi } from "../../api/client";
import type { AdminTable } from "../../domain/types";
import { AdminCatalogColumn } from "./AdminCatalogColumn";
import { AdminError } from "./AdminError";
import { AdminFilterControl } from "./AdminFilterControl";
import { AdminRowsTable } from "./AdminRowsTable";
import { defaultSelection, findTable } from "./columns";
import type { AdminViewState } from "./urlState";
import { readViewState, writeViewState } from "./urlState";

const PAGE_SIZE = 20;

/**
 * The Data section (DESIGN.md §5.8) — a read-only window onto the services' own
 * tables, over `GET /readonly/metadata` and `GET /readonly/{service}/{table}`.
 *
 * Everything selectable is in the URL: the service and the table in the path,
 * the page, the sort and the filter in the query. A link to a table opens the
 * same rows for the next admin and survives a reload — and the table that used
 * to be substituted silently when nothing was chosen is now substituted into
 * the address bar, where it can be seen.
 */
export function AdminDataSection() {
  const params = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const catalogQuery = useQuery({
    queryKey: ["admin", "catalog"],
    queryFn: () => taskaApi.getAdminCatalog(),
  });

  const catalog = catalogQuery.data;
  const selection = params.service && params.table ? { service: params.service, table: params.table } : null;
  // Nothing is chosen on a bare `/admin/data`, so the first table in the
  // catalog stands in — an admin console that opens on an empty frame and asks
  // you to pick before showing anything is a worse answer than showing
  // something. It is redirected into the URL below rather than held in state.
  const fallback = defaultSelection(catalog);
  const current = selection ?? fallback;
  // What the URL *says*. Not what we act on: it is user input, and on this
  // screen one of its fields decides which column the server is asked to order
  // or match on.
  const asked = readViewState(searchParams);
  // The catalog entry for the *selected* table, which is the right source here
  // even though rendering uses the shown one: this decides the request, and the
  // request is about the selection.
  const selectedTable = useMemo(() => findTable(catalog, current), [catalog, current]);
  // A column whose values we refuse to show must not be sortable or filterable
  // either — ordering by it leaks its order, and filtering on it turns the
  // table into a match oracle for the value we just hid. Hiding the controls
  // enforced that only for people who use the controls; `?sort=password_hash`
  // in the address bar went straight through to the gateway. Fail closed: until
  // the catalog says which columns are sensitive, none of them may be sorted or
  // filtered on.
  const view = useMemo(() => withoutSensitive(asked, selectedTable), [asked, selectedTable]);

  const rowsQuery = useQuery({
    queryKey: [
      "admin",
      "rows",
      current?.service,
      current?.table,
      view.page,
      view.sort,
      view.order,
      view.filter,
    ],
    queryFn: () =>
      taskaApi.listAdminRows({
        service: current!.service,
        table: current!.table,
        page: view.page,
        pageSize: PAGE_SIZE,
        sort: view.sort ?? undefined,
        order: view.sort ? view.order : undefined,
        filters: view.filter && view.filter.column ? [view.filter] : undefined,
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

  const update = (changes: Partial<AdminViewState>) => {
    // Replace rather than push: paging and sorting a table would otherwise pile
    // up history entries, and Back would walk them one at a time instead of
    // leaving the table. The address stays correct either way, which is what
    // the link and the reload depend on.
    setSearchParams(writeViewState({ ...view, ...changes }), { replace: true });
  };

  const toggleSort = (column: string) => {
    if (view.sort === column) {
      update({ order: view.order === "asc" ? "desc" : "asc", page: 1 });
    } else {
      update({ sort: column, order: "asc", page: 1 });
    }
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
  if (!selection && fallback) {
    return <Navigate replace to={`/admin/data/${fallback.service}/${fallback.table}`} />;
  }

  const rows = shown;
  // A page past the end — a stale link, a hand-edited address, a table that has
  // shrunk since — otherwise renders "This table is empty", which is a lie
  // about the table, and takes the pager with it, so there is no way back.
  // Land on the last real page instead and say nothing: the address was wrong,
  // not the reader.
  if (rows && rows.pagination.totalPages >= 1 && view.page > rows.pagination.totalPages) {
    const query = writeViewState({ ...view, page: rows.pagination.totalPages }).toString();
    const path = `/admin/data/${rows.meta.service}/${rows.meta.table}`;
    return <Navigate replace to={query ? `${path}?${query}` : path} />;
  }
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
  // `isFetching`, not `isPending`: after the first load `placeholderData` keeps
  // the previous rows, so the query is never "pending" again and nothing would
  // otherwise say the table on screen is out of date.
  const busy = rowsQuery.isFetching;
  // Specifically "the rows on screen are from a different table than the one
  // selected", not "a request is in flight". Filtering and paging refetch
  // constantly and must stay usable; only a table *switch* leaves the filter
  // form describing columns the incoming rows will not have.
  const switchingTable = Boolean(
    rows && current && (rows.meta.service !== current.service || rows.meta.table !== current.table),
  );

  return (
    <div className="admin-data">
      <AdminCatalogColumn services={services} />

      <div aria-busy={busy} className="admin-plane">
        <div className="admin-plane-head">
          {/* The table that is actually on screen, which during a switch is
              still the previous one. Naming the selection here would caption
              one table's rows with another table's name. */}
          <h2 className="admin-table-name">
            {rows ? `${rows.meta.service}.${rows.meta.table}` : `${current!.service}.${current!.table}`}
          </h2>
          {rows ? (
            <p className="admin-count">
              {rows.pagination.totalRows} {rows.pagination.totalRows === 1 ? "row" : "rows"}
            </p>
          ) : null}
          <div className="admin-plane-spacer" />
          {filterable.length > 0 ? (
            <AdminFilterControl
              columns={filterable}
              filter={view.filter}
              onChange={(filter) => update({ filter, page: 1 })}
              switching={switchingTable}
              typeOf={(column) => shownTable?.columns.find((item) => item.name === column)?.type}
            />
          ) : null}
        </div>

        {/* `rows === undefined` alone made this unreachable after the first
            successful load: `placeholderData` keeps the previous table's rows
            forever, so a failed request left those rows on screen and said
            nothing — the reader clicks a table and simply never gets it. That
            is the path that fails in production today, since the live gateway
            500s on every table (TAS-156). `switchingTable` is the honest test:
            the rows on screen belong to a different table than the one asked
            for, so they are not an answer to this request. */}
        {rowsQuery.isError && (rows === undefined || switchingTable) ? (
          <AdminError error={rowsQuery.error} onRetry={() => void rowsQuery.refetch()} />
        ) : rowsQuery.isPending ? (
          <p className="admin-note" role="status">
            Loading rows…
          </p>
        ) : !maskingIsKnown ? (
          // Fail closed: the rows arrived, but the catalog has no entry for the
          // table they claim to be from, so nothing here knows which columns
          // hold secrets. Showing the rows anyway would be a guess in the one
          // direction that cannot be taken back.
          <div className="admin-note" role="alert">
            <p>
              The catalog does not describe {rows?.meta.service}.{rows?.meta.table}, so this table cannot be shown
              without risking a column that should have stayed hidden.
            </p>
          </div>
        ) : rows && shownTable ? (
          // An empty result empties the table; it does not destroy it. Removing
          // the header took away the column names the reader had just filtered
          // on, and removing the footer moved everything on the page — the same
          // reason §5.8 gives for keeping the footer on a single page.
          <AdminRowsTable
            empty={view.filter ? "No rows match this filter." : "This table is empty."}
            onPage={(page) => update({ page })}
            onSort={toggleSort}
            order={view.order}
            rows={rows}
            sort={view.sort}
            sortable={sortable}
            table={shownTable}
          />
        ) : null}
      </div>
    </div>
  );
}

/**
 * Strip a sort or a filter that names a `sensitive` column, so neither can
 * reach the gateway however it got into the address.
 *
 * `table` undefined means the catalog has not answered yet, or has no entry for
 * this table — in both cases we do not know which columns hold secrets, and the
 * answer is to ask for neither rather than to assume none. Once the catalog
 * lands, a legitimate sort or filter comes back on its own, because this reads
 * the URL rather than replacing it: the address a person copied stays what they
 * copied, and only what we *ask for* is narrowed.
 */
function withoutSensitive(view: AdminViewState, table: AdminTable | undefined): AdminViewState {
  const sensitive = new Set(table?.columns.filter((column) => column.sensitive).map((column) => column.name) ?? []);
  const known = table !== undefined;
  const sortAllowed = view.sort !== null && known && !sensitive.has(view.sort);
  const filterAllowed = view.filter !== null && known && !sensitive.has(view.filter.column);
  if (sortAllowed && filterAllowed) return view;
  return {
    ...view,
    sort: sortAllowed ? view.sort : null,
    filter: filterAllowed ? view.filter : null,
  };
}
