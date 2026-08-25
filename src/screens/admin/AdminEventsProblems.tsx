import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { taskaApi } from "../../api/client";
import type { ProblematicOutboxEvent } from "../../domain/types";
import { relativeTime } from "../../lib/format";
import { AdminError } from "./AdminError";
import { isSummaryNotDeployed, outboxCategory } from "./events";
import { BACK_TO_PROBLEMS } from "./eventsUrlState";
import { jiraUrl } from "./sections";

/**
 * Problems — the Events section's landing view (DESIGN.md §5.8).
 *
 * `GET /readonly/outbox/problematic-summary` with no parameters: the counters
 * are always for every service, and the list is the oldest events up to the
 * server's own limit. There is no paging and there will not be — a hundred
 * stuck events is something to fix, not something to leaf through, and the full
 * breakdown is the Outbox journal one tab away.
 */
export function AdminEventsProblems() {
  const summaryQuery = useQuery({
    queryKey: ["admin", "outbox", "problems"],
    queryFn: () => taskaApi.getProblematicOutboxSummary(),
    // No retries. The failure this endpoint actually produces today is the
    // gateway saying it does not have the path (below), and asking three more
    // times cannot change that answer — it only delays the note that explains
    // it. A genuine fault keeps the "Try again" button, which is a retry a
    // person chose.
    retry: false,
  });

  if (summaryQuery.isPending) {
    return (
      <p className="admin-note" role="status">
        Loading the summary…
      </p>
    );
  }

  if (summaryQuery.isError) {
    // Not an alert, and not red. The gateway has not deployed this endpoint
    // yet, which is a fact about the calendar rather than a fault: the section's
    // other view works, and nothing here is broken (docs/ai/API-DIVERGENCE.md).
    // Every other failure goes through the section's normal taxonomy.
    if (isSummaryNotDeployed(summaryQuery.error)) {
      return (
        <p className="admin-note admin-events-unserved" role="status">
          The gateway does not serve the problems summary yet. It arrives with{" "}
          <a className="admin-note-link" href={jiraUrl("TAS-105")} rel="noreferrer" target="_blank">
            TAS-105
          </a>
          ; until then the Outbox journal beside this tab reads the same events straight from the tables.
        </p>
      );
    }
    return <AdminError error={summaryQuery.error} onRetry={() => void summaryQuery.refetch()} />;
  }

  const { counts, events, notAllShown } = summaryQuery.data;

  return (
    <div className="admin-plane admin-events-plane">
      {/* The counters first: they are the answer to the question people come to
          this section with, and the list below is only where it started. */}
      {counts.length > 0 ? (
        <section className="admin-events-block">
          <h2 className="admin-table-name">Counts by service</h2>
          {/* Focusable and named like the Data table's container (§5.8): a
              table with nothing tabbable inside it cannot be scrolled sideways
              from the keyboard at all in Safari or Firefox. */}
          <div aria-label="Counts by service" className="admin-table-scroll admin-matrix-scroll" role="region" tabIndex={0}>
            <table aria-label="Problem counts by service" className="admin-table admin-matrix">
              <thead>
                <tr>
                  <th scope="col">service</th>
                  {/* The three categories, in the order they cost somebody
                      something: exhausted, timed out, never picked up. */}
                  <th scope="col">Failed</th>
                  <th scope="col">Stuck processing</th>
                  <th scope="col">Overdue NEW</th>
                </tr>
              </thead>
              <tbody>
                {counts.map((count) => (
                  <tr key={count.serviceKey}>
                    <th className="admin-cell-mono" scope="row">
                      {count.serviceKey}
                    </th>
                    <Count value={count.failedCount} />
                    <Count value={count.stuckProcessingCount} />
                    <Count value={count.overdueNewCount} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="admin-events-block admin-events-list">
        <h2 className="admin-table-name">Oldest events</h2>
        {/* Not an alert: being cut short is what this endpoint does when there
            is a lot wrong, and the counters above already covered the rest. */}
        {notAllShown ? (
          <p className="admin-events-truncated">
            Showing the oldest {events.length} events; the counts above cover the rest.
          </p>
        ) : null}

        {events.length === 0 ? (
          // The matrix stays whatever this says — zeros are the answer, and
          // "all clear" with numbers is a statement while "all clear" without
          // them is a splash screen.
          <p className="admin-events-empty">No problematic events.</p>
        ) : (
          <div aria-label="Problematic events" className="admin-table-scroll" role="region" tabIndex={0}>
            <table aria-label="Problematic events, oldest first" className="admin-table">
              <thead>
                <tr>
                  <th scope="col">service</th>
                  <th scope="col">category</th>
                  <th scope="col">age</th>
                  <th scope="col">event type</th>
                  <th scope="col">aggregate type</th>
                  <th scope="col">aggregate id</th>
                  <th scope="col">status</th>
                  <th scope="col">attempts</th>
                  <th scope="col">last error</th>
                  {/* Empty to the eye, named for a screen reader: a visible
                      header over a chevron would caption the one column that is
                      not data. */}
                  <th className="admin-open-head">
                    <span className="visually-hidden">Open event</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {/* In the server's order, which is oldest first. Nothing here
                    sorts: the order is the endpoint's semantics — it says when
                    this started — and re-sorting would misdescribe what the
                    server cut off the end. */}
                {events.map((event) => (
                  <EventRow event={event} key={`${event.serviceKey}:${event.id}`} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * One number in the matrix. Zero is `--fg-3` and anything else is `--fg` at 600
 * — and neither is coloured green or red: a 3 under "Failed" is already the
 * message, and a red 3 is decoration on top of it (§1).
 */
function Count({ value }: { value: number }) {
  return <td className={`admin-cell-mono admin-matrix-count${value === 0 ? " is-zero" : ""}`}>{value}</td>;
}

function EventRow({ event }: { event: ProblematicOutboxEvent }) {
  const navigate = useNavigate();
  // The same card the journal opens, and it comes back here rather than to the
  // journal — where the reader came from is part of the card's address (§5.8).
  const href = `/admin/events/outbox/${encodeURIComponent(event.serviceKey)}/${encodeURIComponent(event.id)}?from=${BACK_TO_PROBLEMS}`;
  const category = outboxCategory(event.status);

  return (
    <tr
      className="admin-row-opens"
      onClick={(clickEvent) => {
        if ((clickEvent.target as HTMLElement).closest("a, button")) return;
        if (window.getSelection()?.toString()) return;
        // A modifier means "not here": ⌘/Ctrl for a new tab, Shift for a new
        // window, Alt to download. The link in the last cell is a real link and
        // does all of that itself.
        if (clickEvent.metaKey || clickEvent.ctrlKey || clickEvent.shiftKey || clickEvent.altKey) return;
        void navigate(href);
      }}
    >
      <td className="admin-cell-mono">{event.serviceKey}</td>
      {/* Derived from `status`, never from `reason` — and a status this build
          has never seen leaves the category blank rather than guessing. The raw
          value is two columns along, so nothing is lost by not naming it. */}
      <td className={category ? undefined : "admin-cell-null"}>{category ?? "—"}</td>
      <td className="admin-cell-mono">
        {/* The relative age is what is read, but the exact instant is what gets
            pasted into a query — so it stays in `title` for the pointer and in
            the cell's accessible name for a screen reader (§5.8). */}
        <time dateTime={event.createdAt} title={event.createdAt}>
          {relativeTime(event.createdAt)}
          <span className="visually-hidden">, {event.createdAt}</span>
        </time>
      </td>
      <td>{event.eventType}</td>
      <td>{event.aggregateType}</td>
      <td className="admin-cell-mono">{event.aggregateId}</td>
      <td className="admin-cell-mono">{event.status}</td>
      <td className="admin-cell-mono">{event.attempts}</td>
      {/* The broker's own wording, which can be a whole stack frame. Truncated
          for width, with the text itself left whole — so `title` has it for the
          pointer, the accessible name has it for a screen reader, and the card
          has it laid out. A truncation the value cannot be read back out of is
          lost data, not saved space (§5.8). */}
      {event.lastErrorMessage ? (
        <td className="admin-events-error" title={event.lastErrorMessage}>
          <span>{event.lastErrorMessage}</span>
        </td>
      ) : (
        <td className="admin-cell-null">—</td>
      )}
      <td className="admin-open-cell">
        {/* The keyboard's path to the card: a row cannot be a control without
            lying about what a table row is (§5.8). */}
        <Link aria-label={`Open event ${event.id}`} className="admin-open-row" to={href}>
          <ChevronRight aria-hidden="true" size={14} />
        </Link>
      </td>
    </tr>
  );
}
