import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { taskaApi } from "../../api/client";
import type { RetryableOutboxService } from "../../api/TaskaApi";
import type { OutboxRetryResult, ProblematicOutboxEvent } from "../../domain/types";
import { AdminError } from "./AdminError";
import { AdminOutboxRetryModal, type OutboxRetryArrival } from "./AdminOutboxRetryModal";
import { canRetryOutboxEvent, eventAge, outboxCategory, OUTBOX_PROBLEMS_KEY } from "./events";
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
    queryKey: OUTBOX_PROBLEMS_KEY,
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
   *
   * **Dismissed while the retry was still in flight, and answered afterwards** —
   * the answer moves nothing and then rescues what it took, which is a third
   * case rather than a variant of the second. The answer is not lost:
   * query-core runs the mutation to the end with nobody observing it, so a
   * confirmation can land seconds after Cancel, by which time the operator may
   * be somewhere else. The list is still asked again and the live region still
   * says what the server said; the *move* is withheld, because it is the one
   * part of the confirmation that reaches out and takes something
   * (`OutboxRetryArrival`).
   *
   * Withholding it outright was wrong, and on the likeliest path of all. Doing
   * nothing for two seconds after Cancel is the most ordinary thing an operator
   * does next, and on that path dismissal has put focus back on the Retry
   * button, the refetch turns that row `NEW`, `canRetryOutboxEvent` drops the
   * button — and focus falls to `<body>`, where the next Tab restarts at the
   * top of the document. That is the same §7 failure the successful path moves
   * focus to avoid; the guard against the steal traded it for a loss. What
   * closes both is a rescue rather than a move: `rescueFrom` below.
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

  /**
   * The Retry button a late answer found focus resting on — armed when that
   * answer lands, read once the list it asked for has landed too.
   *
   * Three conditions, and each one is what keeps the rescue from being the
   * steal it was built to avoid:
   *
   * - focus was on *this* trigger when the answer arrived, so nothing is taken
   *   from anywhere the operator went of their own accord;
   * - the refetch removed that trigger, so the loss is this section's doing;
   * - focus is on `<body>` when it is read again — still nowhere. Anything else
   *   means the operator moved in the meantime, and where they are is theirs.
   *
   * Note what is *not* among them: that the armed button belongs to the row the
   * answer is about. `trigger.current` is whichever dialog was open last, so
   * dismiss A, open and dismiss B, then let A's answer land, and the arm holds
   * B's button. That is deliberate, and it is the thing most likely to be
   * "fixed" by a later reader. The arm records *where focus is* when this
   * section is about to pull the list out from under it — not which event was
   * retried — and the two come apart exactly where it matters: one read serves
   * every row, so the refetch A's answer sets off can come back with B already
   * `NEW` and take B's button, with focus sitting on it. Pairing the arm with
   * the answered event would refuse the rescue there and leave focus on
   * `<body>`, the §7 loss this exists to close. Keyed on focus is what makes it
   * a rescue rather than a move.
   *
   * A ref rather than state because nothing renders from it, and because it is
   * written from a callback that outlives the dialog that owned the mutation.
   */
  const rescueFrom = useRef<HTMLButtonElement | null>(null);
  /**
   * The list the arm above is waiting for, named by the only thing both sides
   * can see: the `dataUpdatedAt` the cache carried at the moment of arming. The
   * rescue answers to the first read that beats it and to no other.
   *
   * Read off `queryClient` rather than off `summaryQuery`, and that is not a
   * style choice. The arm is set from a mutation callback, whose closure holds
   * the render's `summaryQuery` — and on this path that render is behind the
   * cache by a whole read. Measured: at the moment of arming the cache says
   * `…904` and the closure says `…865`, because the read the dismissal asked
   * for has already landed in the cache and its notification, which query-core
   * delivers on a `setTimeout(…, 0)`, has not yet reached React. Arming against
   * the closure's number would arm against `…865`, the very read whose late
   * commit is the one that must not count.
   */
  const armedAt = useRef(0);

  useEffect(() => {
    if (flashed === null) return;
    const timer = window.setTimeout(() => setFlashed(null), FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [flashed]);

  /**
   * The rescue, and the whole of it is *when* it runs: after the commit that
   * removed the button, not after the promise that asked for the read.
   *
   * `invalidateQueries().then(…)` is the obvious place and the inert one. That
   * promise resolves as a microtask off the fetch, while the render that drops
   * the button reaches React through query-core's own `setTimeout(…, 0)`
   * notification — so asked there, `isConnected` is still `true`, focus is
   * still on a button that has not left yet, and the rescue never fires. It
   * would fail silently, with everything green.
   *
   * A passive effect is not a bet on that race. React runs it after the DOM
   * mutation of the commit it belongs to, so by the time this reads the
   * document, the answer the refetch brought is already on screen: if the
   * button was going to go, it is gone.
   *
   * One read per arm, and it has to be *the* read — the one the write asked
   * for. Two different things have to be true for that, and each was got wrong
   * on its own before this shape settled.
   *
   * The effect must **run** on that read. `[summaryQuery.data]` alone does not
   * guarantee it: React Query's structural sharing hands back the *same*
   * reference when a refetch is deeply equal to what it replaced, so a retry
   * that leaves the summary unchanged never re-ran this at all and left the arm
   * standing for whatever came next — a `refetchOnWindowFocus` minutes away.
   * `dataUpdatedAt` moves on every read that answers with data, equal or not,
   * which is why it is in the list.
   *
   * And the arm must **survive** the runs that are not that read. Keying on
   * `dataUpdatedAt` without that half is worse than not keying on it, because
   * on this exact path there is always an earlier read in the way: the
   * dismissal asked the list again, that read has already landed in the cache
   * when the retry is answered, and its notification reaches React *after* the
   * arm is set. It would spend the arm with the button still connected, and the
   * write's own read would then remove that button with nothing armed — focus
   * on `<body>`, the loss this whole block exists to close. So the arm carries
   * the number it was set at (`armedAt`) and only a strictly greater
   * `dataUpdatedAt` may read it. Measured, not reasoned about: without the
   * comparison the two tests that defend the second and third conditions stop
   * failing when those conditions are deleted.
   *
   * What that leaves, said plainly rather than claimed away.
   *
   * **The arm is bounded by the write's own read**, which is the very next one
   * to answer. `invalidateQueries` runs two lines after the arm is set, and the
   * only other read that could get in front of it is the dismissal's, which is
   * in one of two states by then and harmless in both: already answered, in
   * which case `armedAt` *is* its `dataUpdatedAt` and `<=` excludes it exactly
   * (measured — that run arrives with a delta of 0); or still in flight, in
   * which case the invalidation cancels it, because `refetchQueries` defaults
   * `cancelRefetch` to `true`, and it never sets `dataUpdatedAt` at all
   * (measured — three reads asked, one run of this effect, the rescue fired).
   * Whatever that read finds — button gone, button still there, operator moved
   * — the arm is spent, so it cannot be carried into a read that has nothing to
   * do with the write.
   *
   * **Except by a read that fails.** A failure moves `errorUpdatedAt` and not
   * `dataUpdatedAt`, so it does not re-run this and does not spend the arm,
   * which then stands until a read *does* answer. That is still a rescue and
   * not a steal — all three conditions are asked again at the moment it is
   * read, so a late one fires only with the armed button gone and focus still
   * nowhere — but it is a late one, and a block that implied otherwise would be
   * worth nothing. The arm is bounded by an answer, not by a clock.
   *
   * The one soft edge is that `dataUpdatedAt` is a millisecond clock, so a read
   * answering inside the same millisecond as the arm would be read as the arm's
   * own and skipped, costing that rescue and deferring it to the next answer.
   * It needs the write's read to land in the same millisecond as the dismissal's,
   * with a retry round trip in between; the margin measured in jsdom, where
   * there is no network at all, is 4–12ms.
   */
  useEffect(() => {
    const button = rescueFrom.current;
    // Nothing armed, or the read has not answered yet: a read that has not
    // answered cannot have removed anything.
    if (!button || !summaryQuery.data) return;
    // Answered, but not by the read the arm is waiting for — an older one whose
    // commit is only now reaching React. It cannot have removed the button the
    // write is about to remove, and spending the arm on it would disarm the
    // rescue one read early.
    if (summaryQuery.dataUpdatedAt <= armedAt.current) return;
    rescueFrom.current = null;
    // The refetch left the button alone — focus is still on it, and there is
    // nothing here to rescue.
    if (button.isConnected) return;
    // It went, and unless the operator has moved since the answer landed, focus
    // went with it to `<body>`.
    if (document.activeElement !== document.body) return;
    focusListAfterWrite();
    // Keyed on the answered read, never on `isFetching`: that would add a
    // render that cannot decide anything — while a read is out, the button is
    // still there by definition — and would leave the fast path, where the
    // fetch settles before query-core's first notification, without a change to
    // key on at all. `data` stays beside `dataUpdatedAt` because it is what the
    // body above reads; `dataUpdatedAt` is what gets this run at all, and
    // `armedAt` is what decides whether the run is the one being waited for.
  }, [summaryQuery.dataUpdatedAt, summaryQuery.data]);

  const onRetried = (event: RetryableEvent, result: OutboxRetryResult, arrival: OutboxRetryArrival) => {
    setFlashed(eventKey(event));
    // The server's own word for the state, not "NEW" assumed: the endpoint
    // reports what the row is now, and a backend that grows another state
    // should be quoted rather than second-guessed.
    setAnnouncement(`${event.eventType} on ${event.serviceKey} is now ${result.status}.`);
    // The two things that belong to the dialog, done only while there is one.
    // Closing it is the second of them: an answer to a dismissed dialog can
    // arrive while a *different* row's dialog is open, and closing that over an
    // answer about another event would be the same intrusion as the focus move,
    // in the same tick.
    if (arrival === "while-open") {
      setPending(null);
      focusListAfterWrite();
    } else if (trigger.current !== null && document.activeElement === trigger.current) {
      // Dismissed, and the operator has not moved since: focus is back on the
      // button that opened the dialog. If the invalidation below removes it —
      // which is what a successful retry does to it — that focus is what will
      // be lost, and this is the arm that gets it back (`rescueFrom`).
      rescueFrom.current = trigger.current;
      // Both halves of the arm, set together and before the invalidation two
      // lines down, so the read that invalidation asks for is the first one
      // able to beat this number. See `armedAt`.
      armedAt.current = queryClient.getQueryState(OUTBOX_PROBLEMS_KEY)?.dataUpdatedAt ?? 0;
    }
    // The list is what the section believes, so it is asked again — on both
    // paths, because a row that moved is worth knowing about whether or not
    // anyone was still watching the dialog when it did. The response is a
    // confirmation, not a source of rows.
    void queryClient.invalidateQueries({ queryKey: OUTBOX_PROBLEMS_KEY });
  };

  if (summaryQuery.isPending) {
    return (
      <p className="admin-note" role="status">
        Loading the summary…
      </p>
    );
  }

  /**
   * A failed read replaces the view only when there is nothing to replace it
   * *with* — the first load, or a failure after the cache was dropped.
   *
   * `isError` alone would not have been that test. query-core sets
   * `status: "error"` on a failed **background** refetch while keeping the data
   * it already has, and the refetch this view does most often is the one that
   * follows a successful retry: a blip there would have swapped the whole
   * section — the flashed row and the live region's confirmation with it — for
   * a read-failure card, over a write that landed. And this query does not retry
   * itself (see above), so nothing would have put it back.
   */
  const summary = summaryQuery.data;
  if (!summary) {
    return <AdminError error={summaryQuery.error} onRetry={() => void summaryQuery.refetch()} />;
  }

  const { counts, events, notAllShown } = summary;
  // A read that failed over rows that are still on screen: the failure is stated
  // above them rather than instead of them, because the list is the last thing
  // the server actually said and "Try again" is the same button either way.
  const staleError = summaryQuery.isError ? summaryQuery.error : null;
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

      {staleError ? <AdminError error={staleError} onRetry={() => void summaryQuery.refetch()} /> : null}

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
          onDone={(result, arrival) => onRetried(pending, result, arrival)}
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
