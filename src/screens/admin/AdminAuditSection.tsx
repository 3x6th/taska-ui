import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useId, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { taskaApi } from "../../api/client";
import { isMissingOrForbidden, isRouteNotServed } from "../../api/errors";
import { UNDEPLOYED_ROUTE_MESSAGE } from "../../api/TaskaApi";
import { RequestId } from "../../components/RequestId";
import type { AuditEntry } from "../../domain/types";
import { AdminError } from "./AdminError";
import { AdminNamedFilterControl } from "./AdminNamedFilterControl";
import { AdminPager } from "./AdminPager";
import {
  auditEntryKeys,
  auditFilters,
  auditFiltersProblem,
  auditQueryFor,
  formatAuditDocument,
  formatAuditTime,
  readAuditViewState,
  writeAuditViewState,
  type AuditViewState,
} from "./audit";
import { shortKey } from "./columns";
import { jiraUrl } from "./sections";

const PAGE_SIZE = 20;
const COLUMNS = 7;

/**
 * The Audit section (DESIGN.md §5.8, TAS-251) — who changed what through the
 * admin area, and why, from `GET /readonly/audit-entries` (backend PR #172,
 * TAS-160). It only reads.
 *
 * Built from the area's parts: the named-filter chips the Outbox journal uses,
 * the Users table's named columns, the shared pager, and the URL as the home of
 * the page and every filter. What it adds is the detail under a row — the old
 * and the new value side by side — because an entry has **no id** to give an
 * address to, so it opens in place rather than as a card of its own.
 *
 * Two server facts decide what is drawn, both on `TaskaApi.listAuditEntries`:
 * the route is not served yet (a static-resource 404 or a 501), which is said
 * as a notice rather than as a failure or an empty log; and at the PR head the
 * server ignores paging, so a page may hold every row — drawn as it came.
 */
export function AdminAuditSection() {
  const [searchParams, setSearchParams] = useSearchParams();
  const view = readAuditViewState(searchParams);
  const query = auditQueryFor(view, PAGE_SIZE);
  const entriesQuery = useQuery({
    queryKey: ["admin", "audit", query],
    queryFn: () => taskaApi.listAuditEntries(query),
    // Paging otherwise swaps the whole table for a message and the row someone
    // was reading jumps as it comes back.
    placeholderData: (previous) => previous,
    // Neither a route that is not there nor a refusal changes on a second ask.
    retry: (failureCount, error) =>
      !isRouteNotServed(error, UNDEPLOYED_ROUTE_MESSAGE) && !isMissingOrForbidden(error) && failureCount < 1,
  });
  /** The entry whose detail is open — by its composite key, since it has no id. */
  const [open, setOpen] = useState<string | null>(null);
  const detailIdBase = useId();

  const update = (changes: Partial<AuditViewState>) => {
    // Replace rather than push, as every view change in this area does: Back
    // leaves the log instead of walking its filters one by one.
    setOpen(null);
    setSearchParams(writeAuditViewState({ ...view, ...changes }), { replace: true });
  };

  const data = entriesQuery.data;
  const notServed = entriesQuery.isError && isRouteNotServed(entriesQuery.error, UNDEPLOYED_ROUTE_MESSAGE);

  // A page past the end — a stale link, a narrower filter since. `totalPages
  // >= 1` for the reason the Users section records: an empty answer can say
  // `totalPages: 0`, and the redirect would resolve to where it already is.
  const pastTheEnd =
    data !== undefined &&
    !entriesQuery.isPlaceholderData &&
    data.pagination.totalPages >= 1 &&
    view.page > data.pagination.totalPages;
  if (data && pastTheEnd) {
    const next = writeAuditViewState({ ...view, page: data.pagination.totalPages }).toString();
    return <Navigate replace to={next ? `/admin/audit?${next}` : "/admin/audit"} />;
  }

  const entries = data?.entries ?? [];
  const keys = auditEntryKeys(entries);

  return (
    <div aria-busy={entriesQuery.isFetching} className="admin-plane admin-audit-plane">
      <div className="admin-plane-head">
        <h2 className="visually-hidden">Audit entries</h2>
        {data && !notServed ? (
          <p className="admin-count">
            {data.pagination.totalRows} {data.pagination.totalRows === 1 ? "entry" : "entries"}
          </p>
        ) : null}
        <div className="admin-plane-spacer" />
        <AdminNamedFilterControl
          definitions={auditFilters}
          dialogLabel="Filter audit entries"
          filters={view.filters}
          onChange={(filters) => update({ filters, page: 1 })}
          validate={auditFiltersProblem}
        />
      </div>

      {notServed ? (
        // Not an error wall and not an empty table: nothing failed and nothing
        // was found empty — the gateway has no audit log to read yet.
        <div className="admin-note" role="status">
          <p>
            This gateway does not serve the audit log yet, so there are no entries to show — which is not the same as
            an empty log. It opens with{" "}
            <a className="admin-placeholder-link" href={jiraUrl("TAS-160")} rel="noreferrer" target="_blank">
              TAS-160
            </a>
            .
          </p>
        </div>
      ) : entriesQuery.isError && data === undefined ? (
        <AdminError error={entriesQuery.error} onRetry={() => void entriesQuery.refetch()} />
      ) : entriesQuery.isPending ? (
        <p className="admin-note" role="status">
          Loading the audit log…
        </p>
      ) : (
        // Focusable and named like every table in this area (§7): it scrolls
        // sideways on a phone, and the keyboard has to be able to follow.
        <div aria-label="Audit entries" className="admin-table-scroll" role="region" tabIndex={0}>
          <table aria-label="Audit entries" className="admin-table admin-audit-table">
            <thead>
              <tr>
                <th scope="col">time (UTC)</th>
                <th scope="col">actor</th>
                <th scope="col">action</th>
                <th scope="col">target</th>
                <th scope="col">reason</th>
                <th scope="col">request id</th>
                <th className="admin-open-head" scope="col">
                  <span className="visually-hidden">Changes</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 ? (
                <tr>
                  <td aria-live="polite" className="admin-empty-cell" colSpan={COLUMNS}>
                    {view.filters.length > 0 ? "No entries match these filters." : "The audit log has no entries."}
                  </td>
                </tr>
              ) : null}
              {entries.map((entry, index) => {
                const key = keys[index];
                const expanded = open === key;
                const detailId = `${detailIdBase}-${index}`;
                return (
                  <AuditRow
                    detailId={detailId}
                    entry={entry}
                    expanded={expanded}
                    key={key}
                    onToggle={() => setOpen(expanded ? null : key)}
                  />
                );
              })}
            </tbody>
          </table>
          {data ? <AdminPager onPage={(page) => update({ page })} pagination={data.pagination} /> : null}
        </div>
      )}
    </div>
  );
}

/** A dash for a value the log does not hold, pale like every absent value in this area (§5.8). */
function Absent() {
  return <span className="admin-card-null">—</span>;
}

function AuditRow({
  entry,
  expanded,
  detailId,
  onToggle,
}: {
  entry: AuditEntry;
  expanded: boolean;
  detailId: string;
  onToggle: () => void;
}) {
  const time = entry.createdAt ? formatAuditTime(entry.createdAt) : null;
  const target = [entry.targetService, entry.targetTable].filter(Boolean).join(".");
  // Said whole in the button's name: "Show changes" seven times over is seven
  // buttons a screen reader cannot tell apart.
  const subject = `${entry.action ?? "entry"}${time ? ` at ${time}` : ""}`;
  return (
    <>
      <tr
        className={expanded ? "admin-row-opens is-open" : "admin-row-opens"}
        // The pointer path; the button in the last cell is the keyboard's
        // (§5.8: a `<tr>` cannot be a control). The button's own click is
        // stopped there so one press does not toggle twice.
        onClick={() => {
          // Selecting text to copy ends in a click on the row; it is not a toggle.
          if (window.getSelection()?.toString()) return;
          onToggle();
        }}
      >
        <td className="admin-cell-mono">
          {time ? <time dateTime={entry.createdAt ?? undefined}>{time}</time> : <Absent />}
        </td>
        <td title={entry.actorUserId ?? undefined}>{entry.actorLogin ?? <Absent />}</td>
        <td className="admin-cell-mono">{entry.action ?? <Absent />}</td>
        <td className="admin-cell-mono" title={entry.targetId ? `${target} · ${entry.targetId}` : undefined}>
          {target || entry.targetId ? (
            <>
              {target}
              {entry.targetId ? (
                <>
                  <span className="admin-audit-sep" aria-hidden="true">
                    {" · "}
                  </span>
                  <span className="visually-hidden">, row </span>
                  {shortKey(entry.targetId)}
                </>
              ) : null}
            </>
          ) : (
            <Absent />
          )}
        </td>
        <td className="admin-audit-reason" title={entry.reason ?? undefined}>
          {entry.reason ?? <Absent />}
        </td>
        <td className="admin-cell-mono" title={entry.requestId ?? undefined}>
          {entry.requestId ? shortKey(entry.requestId) : <Absent />}
        </td>
        <td className="admin-open-cell">
          <button
            aria-controls={expanded ? detailId : undefined}
            aria-expanded={expanded}
            aria-label={`Changes of ${subject}`}
            className="admin-open-row"
            onClick={(event) => {
              event.stopPropagation();
              onToggle();
            }}
            type="button"
          >
            {expanded ? <ChevronDown aria-hidden="true" size={14} /> : <ChevronRight aria-hidden="true" size={14} />}
          </button>
        </td>
      </tr>
      {expanded ? (
        <tr className="admin-audit-detail-row">
          <td className="admin-audit-detail-cell" colSpan={COLUMNS}>
            <AuditDetail entry={entry} id={detailId} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

/**
 * The entry in full: the values the row shortens, and the old and the new
 * value side by side — the reason anyone opens an audit entry. Side by side
 * from the readable width up, one above the other below it.
 */
function AuditDetail({ entry, id }: { entry: AuditEntry; id: string }) {
  return (
    <section aria-label={`Changes of ${entry.action ?? "entry"}`} className="admin-audit-detail" id={id}>
      <dl className="admin-audit-facts">
        <div>
          <dt>actor id</dt>
          <dd className="admin-cell-mono">{entry.actorUserId ?? <Absent />}</dd>
        </div>
        <div>
          <dt>target id</dt>
          <dd className="admin-cell-mono">{entry.targetId ?? <Absent />}</dd>
        </div>
        <div>
          <dt>reason</dt>
          <dd>{entry.reason ?? <Absent />}</dd>
        </div>
      </dl>
      {/* Outside the list, because the shared affordance names itself
          ("Request ID:") and a term above it would say it twice. Absent when
          the log kept none — the row's own column already says so. */}
      {entry.requestId ? (
        <p className="admin-audit-request">
          <RequestId value={entry.requestId} />
        </p>
      ) : null}
      <div className="admin-audit-values">
        <AuditDocument label="Old value" value={entry.oldValue} />
        <AuditDocument label="New value" value={entry.newValue} />
      </div>
    </section>
  );
}

function AuditDocument({ label, value }: { label: string; value: string | null }) {
  const document = formatAuditDocument(value);
  const headingId = useId();
  return (
    <figure aria-labelledby={headingId} className="admin-audit-value">
      <figcaption className="admin-audit-value-head" id={headingId}>
        {label}
        {document && !document.json ? <span className="admin-audit-raw"> · not JSON, shown as sent</span> : null}
      </figcaption>
      {document ? (
        <pre className="admin-card-json">{document.text}</pre>
      ) : (
        <p className="admin-audit-none">
          <Absent /> <span className="visually-hidden">nothing logged</span>
        </p>
      )}
    </figure>
  );
}
