import { useMutation } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { taskaApi } from "../../api/client";
import { apiErrorFacts } from "../../api/errors";
import { ADMIN_WRITE_REASON_MAX_LENGTH } from "../../api/TaskaApi";
import { Modal } from "../../components/Modal";
import { RequestId } from "../../components/RequestId";
import type { UserStatusChange } from "../../domain/types";
import type { AdminUserTarget, UserAction } from "./users";
import {
  actionAccessibleName,
  actionGerunds,
  actionLabels,
  actionPendingLabels,
  personLabel,
  targetStatus,
  userStatusLabel,
  userWriteFailure,
} from "./users";

interface AdminUserActionModalProps {
  /** Narrowed to a row that has a key: a row with none offers no action at all. */
  user: AdminUserTarget;
  action: UserAction;
  /** The signed-in account, so the modal can say when the target is the reader. */
  currentUserId?: string;
  onClose: () => void;
  onDone: (change: UserStatusChange) => void;
}

/**
 * The confirmation for each of the Users section's three writes (DESIGN.md
 * §4.11, §5.8).
 *
 * It exists because none of the operations can be undone by the reader —
 * unblocking an account that was `INVITED` does not restore the invitation —
 * and because the server requires a reason, which has to be typed somewhere.
 *
 * **Nothing here is optimistic**, which is a deliberate departure from
 * AGENTS.md's rule that mutations are optimistic with rollback, and is recorded
 * as such in §5.8. Optimism is right when the client can predict the answer;
 * here it cannot. Blocking the last active global admin is refused on a count
 * taken across the whole table, and the legality of a transition is the
 * server's to decide. So the button waits, and on failure this modal stays open
 * with the answer in it rather than closing over a change that never happened.
 *
 * Reset-lockout does not weaken that. Its transition looks predictable — always
 * `LOCKED` → `ACTIVE` — but the account may hold no `PASSWORD` credential at
 * all, which the server answers with a 404 no client can foresee, and the row
 * on screen may be stale in the direction that makes it refuse anyway.
 */
export function AdminUserActionModal({
  user,
  action,
  currentUserId,
  onClose,
  onDone,
}: AdminUserActionModalProps) {
  const [reason, setReason] = useState("");
  const hintId = useId();
  const name = personLabel(user);
  const from = user.status;
  const to = targetStatus(action);
  const verb = actionLabels[action];
  // Whitespace-only is blank. The server answers 400 for it — through
  // `GrpcRequestValidators.requireNonBlankOrInvalidArgument` rather than the
  // DTO's own `@Size(min = 1)`, which a single space passes — and every
  // implementation refuses it before the request, so the only place it can be
  // discovered is here. Which is why the button is disabled and the hint says
  // why, rather than leaving a control that answers with an error.
  const trimmed = reason.trim();
  const canSubmit = trimmed !== "";

  const run = useMutation({
    mutationFn: () => {
      if (action === "block") return taskaApi.blockUser(user.id, trimmed);
      if (action === "unblock") return taskaApi.unblockUser(user.id, trimmed);
      return taskaApi.resetCredentialLockout(user.id, trimmed);
    },
    onSuccess: onDone,
  });

  const submit = () => {
    if (!canSubmit || run.isPending) return;
    run.mutate();
  };

  // Read through a ref for the same reason `useDismissOnOutside` does it: the
  // handler below closes over the draft, which changes on every keystroke, and
  // rebinding a document listener per character is a cost with no upside. The
  // ref is refreshed in an effect rather than during render, which is where a
  // ref may be written at all.
  const keyboard = useRef({ submit, onClose });
  useEffect(() => {
    keyboard.current = { submit, onClose };
  });

  useEffect(() => {
    // §4.11: `Esc` cancels, `Cmd/Ctrl+Enter` confirms. Bound here rather than
    // inside `Modal`, which carries neither today — putting them there would
    // change the board's two modals under a story that is not about them, and
    // §7 already tracks that gap. This is what the modal can do inside its own
    // story.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        keyboard.current.onClose();
        return;
      }
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        keyboard.current.submit();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <Modal onClose={onClose} title={actionAccessibleName(action, name)}>
      <form
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="admin-user-target">
          <p className="admin-user-target-name">{name}</p>
          {/* Whichever of the two the name above is not, so the account is
              identifiable from the dialog alone: a confirmation naming one
              "Anna Ivanova" out of two people is not a confirmation. */}
          {user.email && user.email !== name ? <p className="admin-user-target-line">{user.email}</p> : null}
          {user.login && user.login !== name ? <p className="admin-user-target-line">@{user.login}</p> : null}
          {/* The transition being asked for, in the server's own values. The
              arrow is punctuation and is hidden from the accessibility tree —
              read out, "ACTIVE → BLOCKED" is two words with a pause where a
              preposition should be. */}
          <p className="admin-user-transition">
            <span aria-hidden="true">
              {from ?? "—"} → {to}
            </span>
            <span className="visually-hidden">
              from {userStatusLabel(from)} to {userStatusLabel(to)}
            </span>
          </p>
        </div>

        {/* Every sentence here is a fact the reader cannot see anywhere else,
            and each is printed only when it is true. */}
        {action === "block" && from === "INVITED" ? (
          <p className="admin-user-note">
            This account was invited and has never signed in. Unblocking it later makes it active — the invitation
            is not restored.
          </p>
        ) : null}
        {/* What "locked" means, because nothing on screen says it and the two
            things an admin will assume are both wrong: nobody blocked this
            account, and this does not give it a new password. The failed-attempt
            count and the lock expiry cannot be shown — the gateway drops them
            before REST — so the sentence is the whole of what can be said. */}
        {action === "reset" ? (
          <p className="admin-user-note">
            This account locked itself after too many failed sign-ins. Resetting clears the failed-attempt count.
            It does <strong>not</strong> change the password — whoever signs in next needs the existing one.
          </p>
        ) : null}
        {currentUserId && user.id === currentUserId ? (
          <p className="admin-user-note">
            This is the account you are signed in as.{" "}
            {action === "reset"
              ? "Clearing its lockout leaves this session alone: no token is revoked by it."
              : "Whether that is allowed is the server’s decision, and the only rule it has is that the last active global admin cannot be blocked."}
          </p>
        ) : null}

        <label className="field">
          <span>Reason</span>
          <textarea
            aria-describedby={hintId}
            autoFocus
            maxLength={ADMIN_WRITE_REASON_MAX_LENGTH}
            onChange={(event) => setReason(event.target.value)}
            required
            rows={3}
            value={reason}
          />
        </label>
        {/* One line doing two jobs: while the field is empty it says why the
            button is off, and once it is not it counts down to the server's
            limit. A disabled button cannot take focus, so its own tooltip would
            never be read — the explanation has to live beside the field. */}
        <p className="admin-user-hint" id={hintId}>
          {canSubmit
            ? `${ADMIN_WRITE_REASON_MAX_LENGTH - trimmed.length} of ${ADMIN_WRITE_REASON_MAX_LENGTH} characters left`
            : `A reason is required — the server refuses a change without one. Up to ${ADMIN_WRITE_REASON_MAX_LENGTH} characters.`}
        </p>

        {run.isError ? <ActionFailure action={action} error={run.error} /> : null}

        <div className="modal-actions">
          <button className="secondary-button" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="primary-button" disabled={!canSubmit || run.isPending} type="submit">
            {run.isPending ? actionPendingLabels[action] : verb}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Why the write failed, in the words of §5.8's taxonomy.
 *
 * It carried a sixth sentence until TAS-196 — "this gateway does not serve
 * blocking and unblocking yet", with a link to the backend story that would.
 * Backend PR #146 deployed all three routes, so there is no such failure left to
 * word and the branch is gone rather than left unreachable.
 *
 * `AdminError` is deliberately not reused. Its four sentences describe *reading
 * a table* — "the table is not one it will serve", "failed while reading this
 * table" — and it carries a "Try again" button, which here would be a second
 * copy of the submit button one line below it. What is shared is the taxonomy,
 * the classifier and the request-id affordance, not the prose.
 */
function ActionFailure({ action, error }: { action: UserAction; error: unknown }) {
  const failure = userWriteFailure(error);
  const { message, requestId } = apiErrorFacts(error);

  return (
    <div className="admin-user-failure" role="alert">
      <p>
        {failure === "conflict" ? (
          action === "reset" ? (
            "The server would not make this change. Nothing is wrong with the request — a lockout can only be reset while the account is locked, and this one is not, or is no longer."
          ) : (
            "The server would not make this change. Nothing is wrong with the request — the account's own status, or the number of active global admins left, does not allow it."
          )
        ) : failure === "refused" ? (
          action === "reset" ? (
            // Reset-lockout answers 404 for two different things — no such
            // user, and a locked account with no password credential behind it
            // — with one status and one code. Neither is worth guessing at, so
            // the sentence covers both and the server's own wording, printed
            // below, says which.
            "The server refused this. Either this account is not a global admin as far as the gateway is concerned, or what the reset needed — the account, or the password credential the lockout belongs to — is no longer there."
          ) : (
            "The server refused this. Either this account is not a global admin as far as the gateway is concerned, or that user is no longer there."
          )
        ) : failure === "server" ? (
          `The gateway failed while ${actionGerunds[action]} this account. Nothing is wrong with what was asked for — this is a fault on the server, and the request id below is what identifies it in the gateway log.`
        ) : failure === "rejected" ? (
          "The gateway would not accept this request. Nothing is down: it read what was asked for and refused it, and what to change is in its own words below."
        ) : (
          "The admin API could not be reached, so this account may or may not have changed. The list behind this dialog says which, once it can be read again."
        )}
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
