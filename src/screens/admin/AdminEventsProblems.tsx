import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { taskaApi } from "../../api/client";
import type { RetryableOutboxService } from "../../api/TaskaApi";
import type { OutboxRetryResult, ProblematicOutboxEvent } from "../../domain/types";
import { AdminError } from "./AdminError";
import { AdminOutboxRetryModal } from "./AdminOutboxRetryModal";
import { canRetryOutboxEvent, eventAge, outboxCategory } from "./events";
import { BACK_TO_PROBLEMS } from "./eventsUrlState";

/** How long a retried row stays marked, matching the Users section (§5.8). */
const FLASH_MS = 2000;

/** The identity of a row in this list: the summary is every service at once. */
const eventKey = (event: Pick<ProblematicOutboxEvent, "serviceKey" | "id">) => `${event.serviceKey}:${event.id}`;

/** A row narrowed to one the retry route can address. See `canRetryOutboxEvent`. */
type RetryableEvent = ProblematicOutboxEvent & { serviceKey: RetryableOutboxService };

/**
 * Problems — the Events section's landing view (DESIGN.md §5.8), and since
 * TAS-194 the one place in this section that writes.
 *
 * `GET /readonly/outbox/problematic-summary` with no parameters: the counters
 * are always for every service, and the list is the oldest events up to the
 * server's own limit. There is no paging and there will not be — a hundred
 * stuck events is something to fix, not something to leaf through, and the full
 * breakdown is the Outbox journal one tab away.
 */
export function AdminEventsProblems() {
  const queryClient = useQueryClient();
  const summaryQuery = useQuery({
    queryKey: ["admin", "outbox", "problems"],
    queryFn: () => taskaApi.getProblematicOutboxSummary(),
    /**
     * No automatic retry — kept through TAS-194, on a different argument from
     * the one that first put it here.
     *
     * The original reason was that the gateway did not serve this path and
     * asking again could not change that. It serves it now (backend PR #141,
     * measured 2026-09-08), so that argument is gone and this line was re-decided
     * rather than inherited.
     *
     * What replaces it: of the failures this route can produce, only two could
     * heal on their own — a 5xx and a lost connection — and both arrive on the
     * screen somebody opens *because* a queue is broken, quite possibly while
     * the gateway itself is the thing that is broken. The global default is one
     * silent retry with a second of backoff (src/main.tsx), and a second of
     * "Loading the summary…" bought against one chance in a few is a bad trade
     * on this screen in particular. A 401 or a 403 could never heal, and asking
     * twice about a refusal is only slower.
     *
     * The retry that matters is the one a person chooses and can see: the "Try
     * again" button `AdminError` draws below. This is also now the query a
     * successful write invalidates, and holding the confirmation open for a
     * backoff would be the same cost paid at a worse moment.
     *
     * The honest cost: the catalog and rows queries in this area take the global
     * default, so this is the one admin read that differs. That inconsistency is
     * smaller than an incident screen that waits.
     */
    retry: false,
  });

  /**
   * The row a retry was confirmed for, marked for two seconds. Keyed by
   * `service:id` because the summary is every service at once and an id is only
   * unique within one.
   *
   * There is **no optimistic override** of the row's own fields, deliberately —
   * the Users section keeps one and this does not. There, the list is paged and
   * cached and a row survives the write, so the pill would otherwise contradict
   * the change for as long as the refetch took. Here the whole view is one
   * request: it comes back entire, there is no page to be stale, and an override
   * would mean the client re-deriving three fields (status, reason and the last
   * error, all of which the retry changes) that the server is about to state.
   * The mark plus the announcement is the confirmation; the list is the truth.
   */
  const [flashed, setFlashed] = useState<string | null>(null);
  /**
   * Mounted from the first render with an empty string rather than appearing
   * together with its text: a live region that arrives at the same moment as
   * its content depends on the screen reader's timing (§7).
   */
  const [announcement, setAnnouncement] = useState("");
  const [pending, setPending] = useState<RetryableEvent | null>(null);
  // The button the dialog was opened from, so focus goes back to it when the
  // dialog is dismissed (§7).
  const trigger = useRef<HTMLButtonElement | null>(null);
  // The list's own scroll region — focusable and named already, because a table
  // with nothing tabbable in it cannot be scrolled sideways from the keyboard.
  // It is also where focus lands after a *successful* retry; see below.
  const listRegion = useRef<HTMLDivElement | null>(null);

  /**
   * Where focus goes when the dialog closes, and it is not one answer.
   *
   * **Dismissed** — `Esc`, Cancel, the close button — goes back to the Retry
   * button that opened it, which is certainly still there. Plain `focus()`: the
   * reader moved focus themselves inside the interaction that asked for it, so
   * `:focus-visible` follows from the modality the browser has already recorded
   * and the ring appears on its own.
   *
   * **After a successful retry** it goes to the list region instead, because the
   * trigger is gone by construction. The server answers `NEW`, this list offers
   * no retry on a `NEW` row, and so the very control that opened the dialog is
   * removed by the refetch that follows. Measured: without this, focus ends up
   * on `<body>` and the next Tab restarts at the top of the document — the
   * failure §7 is about, on a screen where the next thing an operator wants is
   * the next stuck row.
   *
   * That is also the one difference from the Users section's version of this,
   * whose row keeps a control in the same place and so can simply return to it.
   *
   * `focusVisible` is asked for on that path, and the reasoning is the Users
   * section's own measurement: after a pointer press a plain programmatic
   * `focus()` matches `:focus-visible` false in Chromium, which would hand the
   * operator focus with nothing on screen saying where it went. The option is
   * not implemented everywhere, hence the fallback — an undrawn ring beats
   * losing focus altogether.
   */
  const focusTrigger = () => {
    const button = trigger.current;
    if (button?.isConnected) button.focus();
  };

  const focusListAfterWrite = () => {
    const region = listRegion.current;
    if (!region?.isConnected) return;
    try {
      region.focus({ focusVisible: true });
    } catch {
      region.focus();
    }
  };

  useEffect(() => {
    if (flashed === null) return;
    const timer = window.setTimeout(() => setFlashed(null), FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [flashed]);

  const onRetried = (event: RetryableEvent, result: OutboxRetryResult) => {
    setFlashed(eventKey(event));
    // The server's own word for the state, not "NEW" assumed: the endpoint
    // reports what the row is now, and a backend that grows another state
    // should be quoted rather than second-guessed.
    setAnnouncement(`${event.eventType} on ${event.serviceKey} is now ${result.status}.`);
    setPending(null);
    focusListAfterWrite();
    // The list is what the section believes, so it is asked again. The response
    // is a confirmation, not a source of rows.
    void queryClient.invalidateQueries({ queryKey: ["admin", "outbox", "problems"] });
  };

  if (summaryQuery.isPending) {
    return (
      <p className="admin-note" role="status">
        Loading the summary…
      </p>
    );
  }

  if (summaryQuery.isError) {
    return <AdminError error={summaryQuery.error} onRetry={() => void summaryQuery.refetch()} />;
  }

  const { counts, events, notAllShown } = summaryQuery.data;
  // Sorted by service key, here rather than in the API layer: the response's
  // order is unspecified — the backend collects the counts per service
  // concurrently — and a matrix that reshuffled its rows between two refetches
  // would be worse than any fixed order. A presentation sort, not a data one,
  // and deliberately *not* applied to the events list, whose order is the
  // endpoint's own semantics: it says when this started (§5.8).
  const sortedCounts = [...counts].sort((left, right) => left.serviceKey.localeCompare(right.serviceKey));

  return (
    <div className="admin-plane admin-events-plane">
      {/* There is no toast in this product (§5.6 records the gap), so a retry is
          confirmed by the row itself: it is marked for two seconds and this says
          it in words for a reader who sees neither the mark nor the list
          reordering underneath it. */}
      <p className="visually-hidden" role="status">
        {announcement}
      </p>

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
                {sortedCounts.map((count) => (
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
          <div
            aria-label="Problematic events"
            className="admin-table-scroll"
            ref={listRegion}
            role="region"
            tabIndex={0}
          >
            <table aria-label="Problematic events, oldest first" className="admin-table">
              <thead>
                <tr>
                  {/* Frozen against the horizontal scroll, exactly as the Data
                      table freezes its primary key (§5.8): this list is wider
                      than the plane, and "where" is the answer this view
                      exists to give — a row scrolled sideways past its service
                      name has stopped answering it. */}
                  <th className="admin-cell-frozen" scope="col">
                    service
                  </th>
                  <th scope="col">category</th>
                  <th scope="col">age</th>
                  <th scope="col">event type</th>
                  <th scope="col">aggregate type</th>
                  <th scope="col">aggregate id</th>
                  <th scope="col">status</th>
                  <th scope="col">attempts</th>
                  <th scope="col">last error</th>
                  {/* Both empty to the eye and named for a screen reader: a
                      visible header over a button or a chevron would caption the
                      two columns that are not data. */}
                  <th className="admin-events-action-head" scope="col">
                    <span className="visually-hidden">Retry</span>
                  </th>
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
                  <EventRow
                    event={event}
                    key={eventKey(event)}
                    marked={flashed !== null && flashed === eventKey(event)}
                    onRetry={(button, retryable) => {
                      trigger.current = button;
                      setPending(retryable);
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {pending ? (
        <AdminOutboxRetryModal
          event={pending}
          onClose={() => {
            setPending(null);
            focusTrigger();
          }}
          onDone={(result) => onRetried(pending, result)}
        />
      ) : null}
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

/**
 * A cell that is read differently from how it is drawn: the short thing for the
 * eye, the whole thing for a screen reader.
 *
 * The two strings are two separate elements rather than a visible word followed
 * by a hidden tail, because the accessible name is assembled from the nodes and
 * Chromium puts a space *between* them — a hidden `", …"` after visible text
 * announces as "Failed , Event processing failed", with the pause in the wrong
 * place. Building the spoken string in one node is what keeps the punctuation
 * where it was written. Both cells that do this in this table go through here,
 * so the trap is documented once instead of being rediscovered.
 */
function Spoken({ visible, spoken }: { visible: string; spoken: string }) {
  return (
    <>
      <span aria-hidden="true">{visible}</span>
      <span className="visually-hidden">{spoken}</span>
    </>
  );
}

function EventRow({
  event,
  marked,
  onRetry,
}: {
  event: ProblematicOutboxEvent;
  marked: boolean;
  onRetry: (button: HTMLButtonElement, event: RetryableEvent) => void;
}) {
  const navigate = useNavigate();
  // The same card the journal opens, and it comes back here rather than to the
  // journal — where the reader came from is part of the card's address (§5.8).
  const href = `/admin/events/outbox/${encodeURIComponent(event.serviceKey)}/${encodeURIComponent(event.id)}?from=${BACK_TO_PROBLEMS}`;
  const category = outboxCategory(event.status);
  // One button or none, the rule the Users section's action cell follows: the
  // server decides what may be retried, the client repeats the part of that rule
  // it can know, and a control certain to be refused is worse than no control.
  // No cast: `canRetryOutboxEvent` is a type predicate, so the narrowing that
  // makes this row addressable by the retry route is the compiler's rather than
  // a promise made in a comment.
  const retryable: RetryableEvent | null = canRetryOutboxEvent(event) ? event : null;

  return (
    <tr
      className={marked ? "admin-row-opens is-changed" : "admin-row-opens"}
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
      <td className="admin-cell-mono admin-cell-frozen">{event.serviceKey}</td>
      {/* Derived from `status`, never from `reason` — and a status this build
          has never seen leaves the category blank rather than guessing. The raw
          value is two columns along, so nothing is lost by not naming it.

          The server's own sentence rides on this cell rather than in a column
          of its own (§5.8): the three reasons restate the three categories
          almost word for word, so a column would pay list width for a
          duplicate — while `title` and the cell's accessible name cost nothing
          and are where a reader goes when the one-word category is not enough.
          The card is not an option: it renders the table's catalog columns, and
          `reason` is a field of the summary that a row opened by its own
          address does not have. An unknown status keeps the sentence the same
          way, which is the case where it explains the most. */}
      <td className={category ? undefined : "admin-cell-null"} title={event.reason || undefined}>
        {event.reason ? (
          // Announced as "Failed, Event processing failed": the category names
          // the column, the sentence says what the server saw. Without a
          // category there is no category to announce, so the sentence stands
          // alone rather than being read out after a dash — the dash is chrome.
          <Spoken spoken={category ? `${category}, ${event.reason}` : event.reason} visible={category ?? "—"} />
        ) : (
          (category ?? "—")
        )}
      </td>
      <td className="admin-cell-mono">
        {/* A duration, not a calendar word (§5.8, `eventAge`). The age is what
            is read down the column, but the exact instant is what gets pasted
            into a query — so it stays in `title` for the pointer and in the
            cell's accessible name for a screen reader. */}
        <time dateTime={event.createdAt} title={event.createdAt}>
          <Spoken spoken={`${eventAge(event.createdAt)}, ${event.createdAt}`} visible={eventAge(event.createdAt)} />
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
      <td className="admin-events-action-cell">
        {/* One button or nothing (§5.8's rule for the Users action cell, and
            the same reason). A `NEW` row gets nothing: the server refuses to
            retry one, since "back to NEW" is where it already is. A status this
            build has never heard of gets nothing either — it prints verbatim two
            columns back and offers no action (TAS-173). Hiding the control is
            not the permission; the server is (§5.7). */}
        {retryable ? (
          <button
            // "Retry event 7e0…", not "Retry": five buttons in a list all called
            // Retry are five buttons a screen reader cannot tell apart. The id
            // is what names an event in the neighbouring link too, so the two
            // controls on a row name the same thing the same way.
            aria-label={`Retry event ${event.id}`}
            // The product's secondary button (§4.1) at the area's row density —
            // the same `.admin-row-action` the Users section's cell uses, not a
            // second copy of it.
            className="secondary-button admin-row-action"
            onClick={(clickEvent) => onRetry(clickEvent.currentTarget, retryable)}
            type="button"
          >
            Retry
          </button>
        ) : null}
      </td>
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
