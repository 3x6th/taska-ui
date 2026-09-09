import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { taskaApi } from "../../api/client";
import { apiErrorFacts } from "../../api/errors";
import { OUTBOX_RETRY_REASON_MAX_LENGTH, type RetryableOutboxService } from "../../api/TaskaApi";
import { Modal } from "../../components/Modal";
import { RequestId } from "../../components/RequestId";
import type { OutboxRetryResult, ProblematicOutboxEvent } from "../../domain/types";
import { OUTBOX_PROBLEMS_KEY, OUTBOX_TABLE } from "./events";
// The section's five-way failure classification, shared rather than copied.
// It lives in `users.ts` because the Users section was the first to need it and
// the tests that pin its ordering are written against that section's refusals —
// but nothing in it is about users: it reads `isConflict` and `apiErrorFacts`
// and returns §5.8's taxonomy. Copying seven lines here would have been two
// copies of the one subtle thing in it, which is that `isConflict` has to run
// before the `4xx` arm because `FAILED_PRECONDITION` arrives on a 400 — the
// exact shape this dialog's most important refusal wears.
import { userWriteFailure } from "./users";

/**
 * Whether this dialog was still on screen when the server answered.
 *
 * A retry dismissed while in flight is not cancelled, and the answer is not
 * dropped either: query-core keeps a mutation running once its observer
 * unmounts, and the `onSuccess` given to `useMutation` — unlike the callbacks
 * handed to `mutate`, which it skips when nobody is listening — fires either
 * way. So a confirmation can arrive seconds after Cancel, with the operator
 * somewhere else entirely.
 *
 * Everything that speaks to the *section* still happens on that path: the list
 * is asked again, the row is marked, the live region says what the server said.
 * What must not happen is a focus *move*. Taking someone's focus after they
 * dismissed a dialog and moved on is worse than not confirming at all — it is
 * defensible only on the reading that they are still sitting there doing
 * nothing, which is the reading every focus steal is built on — and a live
 * region is exactly the channel for a result nobody is waiting at (DESIGN.md
 * §7).
 *
 * A focus *rescue* is a different act and the section does make one: if the
 * refetch this answer sets off removes the very button the dismissal put focus
 * back on, focus is put on the list rather than left on `<body>`. That is not a
 * move to somewhere the section prefers — it is the section undoing a loss it
 * caused, and it is skipped the moment the operator has gone anywhere at all.
 * The section is the one that owns focus, so this is what it is told with; the
 * conditions are in `AdminEventsProblems`.
 */
export type OutboxRetryArrival = "while-open" | "after-dismissal";

interface AdminOutboxRetryModalProps {
  /**
   * Narrowed to a service the retry path will carry. `canRetryOutboxEvent`
   * decides that in the list, so this component never has to answer "what if it
   * is not one of the three" — the button does not exist in that case.
   */
  event: ProblematicOutboxEvent & { serviceKey: RetryableOutboxService };
  onClose: () => void;
  /** The server's answer, and whether this dialog was still there to receive it. */
  onDone: (result: OutboxRetryResult, arrival: OutboxRetryArrival) => void;
}

/**
 * The confirmation for `POST /admin/outbox/{service}/{eventId}/retry` (DESIGN.md
 * §4.11, §5.8) — the Events section's one write.
 *
 * It is the Users section's dialog in every structural respect, deliberately:
 * the operation cannot be undone from here, the server requires a reason for
 * its audit log, and the reason has to be typed somewhere. What differs is the
 * length of the reason the contract allows (1000 here against the user writes'
 * 550, `OUTBOX_RETRY_REASON_MAX_LENGTH`) and the sentences, which are about a
 * queue rather than about a person.
 *
 * **Nothing here is optimistic**, the same departure from AGENTS.md the Users
 * section records in §5.8 and for a stronger reason. Eligibility is a race the
 * client cannot run: whether a `PROCESSING` row has been stuck long enough is a
 * threshold in the server's configuration, and the row on screen is as old as
 * the last summary read. So the button waits, and a failure leaves this dialog
 * open with the answer in it rather than closing over a change that may not have
 * happened.
 *
 * **And "may not" is the exact truth, which is why no failure here says
 * nothing happened.** admin-service commits the `UPDATE` and *then* writes the
 * audit row, so a fault after the write — or a connection lost on the way back —
 * is a failure reported over a retry that already ran. The two arms that can
 * carry that ambiguity say so in words, the way the attachments confirm path
 * does (`src/screens/BoardScreen.tsx`).
 */
export function AdminOutboxRetryModal({ event, onClose, onDone }: AdminOutboxRetryModalProps) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const hintId = useId();
  // Whitespace-only is blank, and it never reaches the wire: the server answers
  // 400 for it and both implementations refuse it first, so the only place it
  // can be discovered is here. Hence a disabled button with the explanation
  // beside the field — a disabled control cannot take focus, so its own tooltip
  // would never be read.
  const trimmed = reason.trim();
  const canSubmit = trimmed !== "";

  /**
   * Whether this dialog is still on screen — a ref rather than state because
   * nothing renders from it and its one reader runs *after* the last render,
   * quite possibly after this component has stopped existing.
   *
   * Written in two places on purpose. The effect's cleanup is the general
   * answer: it covers every way this dialog can leave, including a route change
   * that unmounts the section from under it. `dismiss` writes it as well
   * because the question is asked from outside React's lifecycle, and the
   * answer should not depend on when the re-render that removes this dialog
   * happens to be flushed. The effect body re-arms it so that StrictMode's
   * mount → unmount → mount in development does not leave a live dialog
   * permanently marked as gone.
   */
  const onScreen = useRef(true);
  useEffect(() => {
    onScreen.current = true;
    return () => {
      onScreen.current = false;
    };
  }, []);

  const run = useMutation({
    mutationFn: () => taskaApi.retryOutboxEvent(event.serviceKey, event.id, trimmed),
    onSuccess: (result) => onDone(result, onScreen.current ? "while-open" : "after-dismissal"),
  });

  const submit = () => {
    if (!canSubmit || run.isPending) return;
    run.mutate();
  };

  /**
   * Dismissal — `Esc`, Cancel, the close button, the backdrop.
   *
   * While a retry is in flight this dialog is the only thing watching it, so
   * leaving takes the answer with it: the request is not cancelled, and the row
   * behind this dialog may be `NEW` a moment later with the list still showing
   * what it was. The list is therefore asked again on the way out, and the
   * answer, whatever it turns out to be, arrives as a row that changed or a row
   * that did not.
   *
   * Invalidating rather than disabling Cancel or swallowing `Esc`: a modal that
   * cannot be dismissed while a request hangs is a modal that can trap someone
   * for as long as the gateway does, and §4.11 gives `Esc` unconditionally.
   *
   * The answer still arrives, late — see `OutboxRetryArrival` for what the
   * section may and may not do with one that nobody is waiting at.
   */
  const dismiss = () => {
    onScreen.current = false;
    if (run.isPending) void queryClient.invalidateQueries({ queryKey: OUTBOX_PROBLEMS_KEY });
    onClose();
  };

  // Read through a ref for the reason `AdminUserActionModal` gives: the handler
  // closes over the draft, which changes on every keystroke, and rebinding a
  // document listener per character is a cost with no upside.
  const keyboard = useRef({ submit, dismiss });
  useEffect(() => {
    keyboard.current = { submit, dismiss };
  });

  useEffect(() => {
    // §4.11: `Esc` cancels, `Cmd/Ctrl+Enter` confirms. Bound here rather than in
    // `Modal`, which carries neither — putting them there would change the
    // board's modals under a story that is not about them (§7 tracks that gap).
    const onKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === "Escape") {
        keyboard.current.dismiss();
        return;
      }
      if (keyEvent.key === "Enter" && (keyEvent.metaKey || keyEvent.ctrlKey)) {
        keyEvent.preventDefault();
        keyboard.current.submit();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <Modal onClose={dismiss} title="Retry outbox event">
      <form
        className="form-stack"
        onSubmit={(formEvent) => {
          formEvent.preventDefault();
          submit();
        }}
      >
        <div className="admin-write-target">
          {/* What is being retried, identified the way this section identifies
              an event everywhere else: the type for a person, the address for a
              machine. The id is what the request carries, so it is on screen in
              full — a confirmation that cannot be checked against the row is not
              a confirmation. */}
          <p className="admin-write-target-name">{event.eventType}</p>
          <p className="admin-write-target-line">
            {event.serviceKey}.{OUTBOX_TABLE}
          </p>
          <p className="admin-write-target-line admin-write-target-id">{event.id}</p>
          {/* The transition, in the server's own values. `NEW` is not a guess:
              admin-service's UPDATE sets exactly that. The arrow is punctuation
              and is hidden from the accessibility tree — read out, "FAILED → NEW"
              is two words with a pause where a preposition should be. */}
          <p className="admin-write-transition">
            <span aria-hidden="true">{event.status} → NEW</span>
            <span className="visually-hidden">
              from {event.status} to NEW
            </span>
          </p>
        </div>

        {/* Every sentence here is a fact the reader cannot see anywhere else,
            and each is printed only when it is true. */}
        <p className="admin-write-note">
          Retrying puts the event back into <strong>NEW</strong> so its service picks it up again, and clears the last
          error. The attempt count is <strong>not</strong> reset — this event has {event.attempts}{" "}
          {event.attempts === 1 ? "attempt" : "attempts"} against it and will still have {event.attempts} afterwards.
        </p>
        {/* Only for the status where the client genuinely cannot predict the
            answer. The list calls a PROCESSING row stuck after the producing
            service's timeout; the retry route wants a longer one of its own, and
            neither number is visible from here (docs/ai/API-DIVERGENCE.md). Said
            before the press rather than only in the refusal after it.

            Two sentences, because it sits under the four-line note above it and
            at 390 the pair was nine lines of 12px prose before the field. The
            three facts are all still here: the status, that the server's
            threshold is both longer and its own, and that the refusal changes
            nothing. */}
        {event.status.trim().toUpperCase() === "PROCESSING" ? (
          <p className="admin-write-note">
            This event is still processing. The server calls one stuck later than this list does, by a threshold of
            its own — so a recently stuck event is refused, unchanged.
          </p>
        ) : null}

        <label className="field">
          <span>Reason</span>
          <textarea
            aria-describedby={hintId}
            autoFocus
            maxLength={OUTBOX_RETRY_REASON_MAX_LENGTH}
            onChange={(changeEvent) => setReason(changeEvent.target.value)}
            required
            rows={3}
            value={reason}
          />
        </label>
        {/* One line doing two jobs, as in the Users dialog: while the field is
            empty it says why the button is off, and once it is not it counts
            down to the server's limit — which is this route's own 1000, not the
            user writes' 550.

            Word for word the Users sentence otherwise, and the one clause that
            used to differ came out: it said the reason goes into the admin audit
            log, which is just as true of the user writes and is said by neither.
            It also cost two lines against that dialog's one, so the actions row
            moved 17px on the first keystroke as the hint became the counter —
            measured at 1440 with the entrance settled, 511 then 494, and 494
            either way now. The drift and the reflow were the same clause. */}
        <p className="admin-write-hint" id={hintId}>
          {canSubmit
            ? `${OUTBOX_RETRY_REASON_MAX_LENGTH - trimmed.length} of ${OUTBOX_RETRY_REASON_MAX_LENGTH} characters left`
            : `A reason is required — the server refuses a retry without one. Up to ${OUTBOX_RETRY_REASON_MAX_LENGTH} characters.`}
        </p>

        {run.isError ? <RetryFailure error={run.error} /> : null}

        <div className="modal-actions">
          <button className="secondary-button" onClick={dismiss} type="button">
            Cancel
          </button>
          <button className="primary-button" disabled={!canSubmit || run.isPending} type="submit">
            {run.isPending ? "Retrying…" : "Retry"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Why the retry failed, in the words of §5.8's taxonomy — the same five cases
 * the Users dialog words, and no sixth.
 *
 * Two of the five carry an extra sentence this dialog needs and that one does
 * not: the write may have landed anyway. That is not defensive phrasing, it is
 * the shape of the endpoint — the row is updated, then read back, then audited,
 * and only then answered — so a 5xx and a dropped connection are both compatible
 * with a queue that has already moved. Telling an operator "nothing happened"
 * there is the one sentence that could send them looking in the wrong place.
 *
 * Pressing Retry again after either is safe and is left available on purpose:
 * if the first one landed, the row is `NEW` and the second is refused with
 * "not eligible for retry", which is the server answering the question.
 *
 * `AdminError` is deliberately not reused, for the reason the Users dialog
 * records: its sentences describe *reading a table*, and it carries a "Try
 * again" button that would be a second copy of the submit button below it.
 */
function RetryFailure({ error }: { error: unknown }) {
  const failure = userWriteFailure(error);
  const { code, message, requestId } = apiErrorFacts(error);
  /**
   * The one arm that promises the row did not move, and it is reached on the
   * code rather than on the taxonomy's `conflict` — narrower than
   * `userWriteFailure` on purpose.
   *
   * `isConflict` also admits a bare 409 and `ABORTED`, which are right for the
   * Users writes: their transition guard answers exactly that. This route emits
   * neither today — its one refusal is `FAILED_PRECONDITION` on a 400 — and the
   * guarantee below is not a general property of a conflict. It holds because
   * admin-service checks eligibility before the `UPDATE` and again in the
   * `UPDATE`'s own `WHERE`, so *that* refusal provably moved nothing. A future
   * 409 from this path would arrive with no such proof behind it, and would
   * rather be read as the plain rejection it is than be handed a promise this
   * dialog cannot keep.
   */
  const notEligible = failure === "conflict" && code === "FAILED_PRECONDITION";

  return (
    <div className="admin-write-failure" role="alert">
      <p>
        {notEligible
          ? // The refusal this route makes most often, and the one an operator
            // is most likely to meet without having done anything wrong: only a
            // failed event, or one stuck in PROCESSING past the server's own
            // threshold, can be retried. The server's own sentence below says
            // which of those it was.
            //
            // The last clause is the one that separates this arm from the two
            // below it, and it is exact rather than reassuring — see above for
            // why it is spoken only here.
            "The server would not retry this event. Nothing is wrong with the request — it retries a failed event, or one stuck in processing past a threshold of its own, and this one is neither. The event is as it was."
          : failure === "refused"
            ? "The server refused this. Either you are not a global admin as far as the gateway is concerned, or that event is no longer in this service's outbox."
            : failure === "server"
              ? "The gateway failed while retrying this event. Nothing is wrong with what was asked for — this is a fault on the server, and the request id below is what identifies it in the gateway log. The retry may still have gone through: the event is updated before the answer is sent, so read the list again rather than assuming nothing happened."
              : failure === "unreachable"
                ? "The admin API could not be reached, so this event may or may not have been retried. The list behind this dialog says which, once it can be read again."
                : // `rejected`, and the fall-through for a conflict that is not the
                  // eligibility refusal: it was read and refused, whatever the code.
                  "The gateway would not accept this request. Nothing is down: it read what was asked for and refused it, and what to change is in its own words below."}
      </p>
      {message ? <p className="admin-error-detail">{message}</p> : null}
      {/* The same reasoning as the section's read failures (§5.8): this area's
          reader is the one person who will take the id to the gateway log. */}
      {requestId ? (
        <p className="admin-error-detail">
          <RequestId value={requestId} />
        </p>
      ) : null}
    </div>
  );
}
