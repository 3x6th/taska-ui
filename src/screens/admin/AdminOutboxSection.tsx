import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Navigate, NavLink, useParams, useSearchParams } from "react-router-dom";
import { taskaApi } from "../../api/client";
import type { AdminRow, AdminTable } from "../../domain/types";
import { AdminError } from "./AdminError";
import { AdminOutboxFilterControl } from "./AdminOutboxFilterControl";
import { AdminRowCard } from "./AdminRowCard";
import { AdminRowsTable } from "./AdminRowsTable";
import { findTable, isAddressableKey } from "./columns";
import { OUTBOX_TABLE, outboxServices } from "./events";
import type { EventsViewState } from "./eventsUrlState";
import {
  DEFAULT_OUTBOX_ORDER,
  DEFAULT_OUTBOX_SORT,
  readEventsViewState,
  readsBackToProblems,
  writeEventsViewState,
} from "./eventsUrlState";
import { everyColumnIsSensitive, sensitiveColumnsOf, statedColumns } from "./masking";

const PAGE_SIZE = 20;

/**
 * The Outbox journal (DESIGN.md §5.8) — `outbox_events` of one service, on the
 * same generic reads the Data section uses: `GET /readonly/catalog` and
 * `GET /readonly/{service}/outbox_events`. Everything the Data table can do the
 * journal inherits, because it *is* that table; only the head and the filters
 * differ.
 *
 * Two deliberate departures from Data, both argued in §5.8:
 *
 * The service is chosen with a segmented control rather than a catalog column,
 * and switching it **keeps the query** except for the page. Data resets on a
 * table switch because the columns change under the filter; here the table is
 * the same everywhere, and "show me FAILED in auth — now in project" is exactly
 * what the control is for.
 *
 * A bare address sorts by `created_at` descending, because a journal is read
 * from the end. That default is stated here rather than left to the server, and
 * it stays out of the URL until a reader chooses something else.
 */
export function AdminOutboxSection() {
  const params = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const catalogQuery = useQuery({
    queryKey: ["admin", "catalog"],
    queryFn: () => taskaApi.getAdminCatalog(),
  });

  const catalog = catalogQuery.data;
  // Which services have an outbox at all — from the catalog, never a list kept
  // here (§5.8).
  const services = useMemo(() => outboxServices(catalog), [catalog]);
  const service = params.service ?? null;
  // `…/outbox/:service/:id` — one event instead of the journal, in the same
  // section body.
  const rowId = params.id ?? null;
  // The catalog entry for the selected service's copy of the table. Undefined
  // while the catalog loads, and for a service that has no outbox — both mean
  // "we do not know which columns hold secrets", which is the fail-closed case.
  const selectedTable = useMemo(
    () => findTable(catalog, service ? { service, table: OUTBOX_TABLE } : null),
    [catalog, service],
  );
  // What the URL *says*. Not what we act on: it is user input, and one of its
  // fields decides which column the server is asked to order or match on.
  const asked = readEventsViewState(searchParams);
  const view = useMemo(() => withoutSensitive(asked, selectedTable), [asked, selectedTable]);
  // The sort as the *request* spells it. `null` in the URL means the journal's
  // own default rather than "let the server decide" — a bare link has to open
  // the same rows for the next reader as it did for this one — and the default
  // is subject to the same fail-closed rule as a chosen one: a `created_at` the
  // catalog called sensitive is not ordered by either.
  const wantedSort = view.sort ?? DEFAULT_OUTBOX_SORT;
  const sort = selectedTable && !sensitiveColumnsOf(selectedTable).has(wantedSort) ? wantedSort : null;
  const order = view.sort ? view.order : DEFAULT_OUTBOX_ORDER;

  const rowsQuery = useQuery({
    queryKey: ["admin", "outbox-rows", service, view.page, sort, order, view.filters],
    queryFn: () =>
      taskaApi.listAdminRows({
        service: service!,
        table: OUTBOX_TABLE,
        page: view.page,
        pageSize: PAGE_SIZE,
        sort: sort ?? undefined,
        order: sort ? order : undefined,
        filters: view.filters,
      }),
    // A card asks for its own row and nothing else. The journal's rows stay in
    // the client, which is what makes Back instant.
    //
    // Waits for the catalog rather than racing it. Every request this journal
    // makes names a sort column and may name filter columns, and which of those
    // are secrets is the catalog's answer — asking before it lands would either
    // send a sort we cannot yet vouch for or throw the first response away when
    // it arrives. The cost is one round trip on a cold deep link; the catalog is
    // shared with the rest of the area and is usually already in the cache.
    enabled: Boolean(service) && rowId === null && catalog !== undefined,
    // Paging swaps the whole table for a spinner otherwise, and the row a
    // person was reading jumps as it comes back.
    placeholderData: (previous) => previous,
  });

  // Everything about the rows on screen is read from the response's own `meta`,
  // never from the current selection: during a service switch `placeholderData`
  // still holds the previous service's rows, and masking them by the incoming
  // service's rules would print what the catalog said to hide.
  const shown = rowsQuery.data;
  const shownTable = useMemo(
    () => (shown ? findTable(catalog, { service: shown.meta.service, table: shown.meta.table }) : undefined),
    [catalog, shown],
  );
  // Fail closed, exactly as Data does it: the sensitive set is a join between
  // the rows response and the catalog, and if the join misses we do not know
  // which columns hold secrets. No catalog entry, no values.
  const maskingIsKnown = !shown || shownTable !== undefined;
  const sensitiveColumns = useMemo(() => sensitiveColumnsOf(shownTable), [shownTable]);
  const everyColumnSensitive = everyColumnIsSensitive(shownTable, sensitiveColumns);

  const update = (changes: Partial<EventsViewState>) => {
    // Replace rather than push: paging and filtering would otherwise pile up
    // history entries, and Back would walk them one at a time instead of
    // leaving the journal.
    setSearchParams(writeEventsViewState({ ...view, ...changes }), { replace: true });
  };

  const toggleSort = (column: string) => {
    // The first press on the column the journal is already sorted by flips it —
    // and writes the choice into the address, where "created_at descending" was
    // until then only implied. Every press writes an explicit `sort`, so the
    // default stops being guessed the moment a reader has an opinion.
    if (sort === column) {
      update({ sort: column, order: order === "asc" ? "desc" : "asc", page: 1 });
    } else {
      update({ sort: column, order: "asc", page: 1 });
    }
  };

  if (catalogQuery.isPending) {
    return <p className="admin-note">Loading the catalog…</p>;
  }

  // Only when there is nothing to fall back on: react-query keeps `data` when a
  // *background* refetch fails, and replacing a working journal with an alert
  // because a window-focus refresh lost the network is the worse answer.
  if (catalogQuery.isError && catalog === undefined) {
    return <AdminError error={catalogQuery.error} onRetry={() => void catalogQuery.refetch()} />;
  }

  if (services.length === 0) {
    return <p className="admin-note">No service in this catalog has an {OUTBOX_TABLE} table.</p>;
  }

  // `/admin/events/outbox` with no service resolves into the first one that has
  // an outbox — in the address bar rather than silently (§5.8). The query rides
  // along: a link shared with a filter on it has to arrive filtered.
  if (!service) {
    const query = searchParams.toString();
    return <Navigate replace to={`/admin/events/outbox/${services[0]}${query ? `?${query}` : ""}`} />;
  }

  // The card replaces the journal in the section body; the view tabs above stay
  // (§5.8). Where it goes back to is part of its address, not of history — from
  // the journal, back to that journal's page and filters; from the summary,
  // back to the summary; from a bare deep link, into the journal the event
  // lives in.
  if (rowId) {
    const journalQuery = writeEventsViewState(view).toString();
    return (
      <AdminRowCard
        back={
          readsBackToProblems(searchParams)
            ? { to: "/admin/events", label: "Problems" }
            : {
                to: `/admin/events/outbox/${service}${journalQuery ? `?${journalQuery}` : ""}`,
                label: `${service}.${OUTBOX_TABLE}`,
              }
        }
        catalogTable={selectedTable}
        rowId={rowId}
        service={service}
        table={OUTBOX_TABLE}
      />
    );
  }

  const rows = shown;
  // Specifically "the rows on screen came from a different service than the one
  // selected", not "a request is in flight": filtering and paging refetch
  // constantly and must stay usable.
  const switchingService = Boolean(rows && rows.meta.service !== service);
  // A page past the end — a stale link, a hand-edited address, a journal that
  // has been drained since — otherwise leaves the reader on "Page 999 of 3".
  // Only while the rows on screen belong to the service being asked about;
  // during a switch `placeholderData` still holds the previous one's pagination.
  if (rows && !switchingService && rows.pagination.totalPages >= 1 && view.page > rows.pagination.totalPages) {
    const query = writeEventsViewState({ ...view, page: rows.pagination.totalPages }).toString();
    const path = `/admin/events/outbox/${service}`;
    return <Navigate replace to={query ? `${path}?${query}` : path} />;
  }

  const columns = rows?.meta.columns ?? [];
  // A column whose values we refuse to show must not be sortable or filterable
  // either: ordering by it leaks its order, and filtering on it turns the table
  // into a match oracle for the value we just hid.
  const sortable = new Set(
    statedColumns(rows?.meta.sortableColumns, columns).filter((column) => !sensitiveColumns.has(column)),
  );
  const filterable = statedColumns(rows?.meta.filterableColumns, columns).filter(
    (column) => !sensitiveColumns.has(column),
  );
  const busy = rowsQuery.isFetching;
  // What a service link carries with it: everything the reader is currently
  // asking, except the page. The same string for every segment, so it is built
  // once rather than per link.
  const switchingQuery = writeEventsViewState({ ...view, page: 1 }).toString();
  const switchQuery = switchingQuery ? `?${switchingQuery}` : "";
  // Where an event opens. Null when the gateway could not address it anyway —
  // the row id is a `UUID` in the path — computed from the table the *rows*
  // came from, like the masking, so a row can never be linked under another
  // service's key. The journal's query rides along and the card's Back link
  // brings it home.
  const rowHref = (row: AdminRow) => {
    if (!rows || !shownTable || !isAddressableKey(shownTable)) return null;
    const key = row[shownTable.primaryKey];
    if (typeof key !== "string" || key === "") return null;
    const query = writeEventsViewState(view).toString();
    const path = `/admin/events/outbox/${rows.meta.service}/${encodeURIComponent(key)}`;
    return query ? `${path}?${query}` : path;
  };

  return (
    <div aria-busy={busy} className="admin-plane admin-events-plane">
      <div className="admin-plane-head">
        {/* Path navigation, not state — so links, not buttons, and
            `aria-current` from the router's own match. Each one carries the
            query it is switching under, minus the page: the table and its
            columns are the same in every service, so the filter a reader is
            holding is still the question they are asking (§5.8). */}
        <nav aria-label="Outbox service" className="admin-seg">
          {services.map((name) => (
            <NavLink className="admin-seg-link" key={name} to={`/admin/events/outbox/${name}${switchQuery}`}>
              {name}
            </NavLink>
          ))}
        </nav>
        {rows ? (
          <p className="admin-count">
            {rows.pagination.totalRows} {rows.pagination.totalRows === 1 ? "event" : "events"}
          </p>
        ) : null}
        <div className="admin-plane-spacer" />
        {filterable.length > 0 ? (
          <AdminOutboxFilterControl
            filterableColumns={filterable}
            filters={view.filters}
            onChange={(filters) => update({ filters, page: 1 })}
          />
        ) : null}
      </div>

      {!services.includes(service) ? (
        // A service that has no outbox, reached by hand. The selector above
        // still works, so this is a sentence rather than a dead end.
        <p className="admin-note" role="status">
          The catalog lists no {OUTBOX_TABLE} table in {service}.
        </p>
      ) : rowsQuery.isError && (rows === undefined || switchingService) ? (
        // `rows === undefined` alone would make this unreachable after the first
        // successful load: `placeholderData` keeps the previous service's rows
        // forever, so a failed request would leave them on screen and say
        // nothing.
        <AdminError error={rowsQuery.error} onRetry={() => void rowsQuery.refetch()} />
      ) : rowsQuery.isPending ? (
        <p className="admin-note" role="status">
          Loading events…
        </p>
      ) : !maskingIsKnown ? (
        <div className="admin-note" role="alert">
          <p>
            The catalog does not describe {rows?.meta.service}.{rows?.meta.table}, so these events cannot be shown
            without risking a column that should have stayed hidden.
          </p>
        </div>
      ) : everyColumnSensitive ? (
        <div className="admin-note" role="alert">
          <p>
            The catalog marks every column of {rows?.meta.service}.{rows?.meta.table} as sensitive, including its key.
            That is far more likely to mean the catalog stopped stating which columns hold secrets than that this table
            is all secret, so every column is being treated as one.
          </p>
        </div>
      ) : rows && shownTable ? (
        <AdminRowsTable
          empty={view.filters.length > 0 ? "No events match these filters." : "This service has published nothing yet."}
          onPage={(page) => update({ page })}
          onSort={toggleSort}
          order={order}
          rowHref={rowHref}
          rows={rows}
          sort={sort}
          sortable={sortable}
          table={shownTable}
        />
      ) : null}
    </div>
  );
}

/**
 * Strip a sort or a filter that names a `sensitive` column, so neither can reach
 * the gateway however it got into the address — the same rule the Data section
 * applies, over a list of filters instead of one.
 *
 * `table` undefined means the catalog has not answered yet, or has no entry for
 * this service: in both cases we do not know which columns hold secrets, and
 * the answer is to ask for neither rather than to assume none. This reads the
 * URL rather than rewriting it, so the address a person copied stays what they
 * copied and a legitimate filter comes back on its own once the catalog lands.
 */
function withoutSensitive(view: EventsViewState, table: AdminTable | undefined): EventsViewState {
  const sensitive = sensitiveColumnsOf(table);
  const known = table !== undefined;
  const sortAllowed = view.sort !== null && known && !sensitive.has(view.sort);
  const filters = known ? view.filters.filter((filter) => !sensitive.has(filter.column)) : [];
  if (sortAllowed && filters.length === view.filters.length) return view;
  return { ...view, sort: sortAllowed ? view.sort : null, filters };
}
