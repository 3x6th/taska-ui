import { useMutation } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { taskaApi } from "../../api/client";
import { apiErrorFacts } from "../../api/errors";
import { INVITE_DISPLAY_NAME_MAX_LENGTH, INVITE_EMAIL_MAX_LENGTH } from "../../api/TaskaApi";
import { ErrorNote } from "../../components/ErrorNote";
import { Modal } from "../../components/Modal";
import type { InvitationResult } from "../../domain/types";
import type { AdminUserTarget } from "./users";
import { inviteFailure, personLabel, stillInvitedText, tooSoonText } from "./users";

/**
 * §4.11's `Cmd/Ctrl+Enter`, bound in the dialog itself. `Esc` is `Modal`'s since
 * TAS-397 — it closes, except while the invitation is out (`busy`); the address
 * is a short value, not text-work, so it does not hold `Esc`. Read through a
 * ref so the listener is bound once rather than per keystroke.
 */
function useDialogKeys(submit: () => void) {
  const keys = useRef({ submit });
  useEffect(() => {
    keys.current = { submit };
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        keys.current.submit();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
}

/**
 * Why an invitation was refused, in §5.8's words: the 409 and the 429 are this
 * route's own, the rest is the Users section's taxonomy. The server's words and
 * the request id go under the sentence — except for a 400, whose sentence *is*
 * the server's, verbatim.
 *
 * `existsText` differs between the two dialogs: inviting an address that has an
 * account is "nothing to invite", resending to a row that has meanwhile set a
 * password is "nothing to resend".
 */
function InviteRefusal({ error, email, existsText }: { error: unknown; email: string; existsText: string }) {
  const { message, requestId } = apiErrorFacts(error);
  const failure = inviteFailure(error);
  const sentence =
    failure === "tooSoon"
      ? tooSoonText(error, email)
      : failure === "exists"
        ? existsText
        : failure === "rejected"
          ? (message ?? "The gateway would not accept this request.")
          : failure === "refused"
            ? "The server refused this. As far as the gateway is concerned, you are not a global admin."
            : failure === "server"
              ? "The gateway failed while inviting. Nothing is wrong with what was asked for — this is a fault on the server, and the request id below is what identifies it in the gateway log."
              : "The admin API could not be reached, so the invitation may or may not have been made. The list behind this dialog says which, once it can be read again.";
  // The server's words only when a server answered: on the 400 they already
  // are the sentence, and with nothing reached the "message" is the browser's
  // own ("Failed to fetch"), which is not the gateway's to be quoted as.
  const serverWords = failure === "rejected" || failure === "unreachable" ? null : message;
  return (
    <ErrorNote live="alert" requestId={requestId} serverWords={serverWords}>
      {sentence}
    </ErrorNote>
  );
}

/**
 * "Invite user" (DESIGN.md §5.8, TAS-204): `POST /auth/invitations`, which
 * makes an `INVITED` account and queues an email with a link to set a
 * password. It adds the person to no project — the members dialog does that,
 * and finds them straight away.
 *
 * **Nothing is optimistic**, as nothing in this section is: the outcome is one
 * of four the server names, and only two of them close the dialog. The labels
 * do not change while the request is out; the button is `aria-disabled`.
 *
 * The one 200 that sent nothing — the person is already invited and their link
 * still works — keeps the dialog open and turns the primary into "Send new
 * link", which asks again with `resend`. Editing the address goes back to an
 * ordinary invitation.
 */
export function AdminInviteUserModal({
  onClose,
  onDone,
}: {
  onClose: () => void;
  /**
   * An invitation that queued an email, the address it was made for as the
   * server holds it, and whether it was the "Send new link" that followed a
   * live link — whose outcome is not "did not have a working link".
   */
  onDone: (result: InvitationResult, email: string, resent: boolean) => void;
}) {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  /** The live link the last answer reported, while the address is the one it was about. */
  const [stillInvited, setStillInvited] = useState<{ expiresAt: string } | null>(null);
  const emailId = useId();
  const nameId = useId();
  const emailHintId = useId();
  const nameHintId = useId();
  // As the server will hold it: trimmed and lower-cased (`DirectoryInput.email`),
  // so every sentence names the account the way the list will.
  const address = email.trim().toLowerCase();
  const canSubmit = address !== "";
  /** The address in the field now, for an answer that lands after it changed. */
  const addressNow = useRef(address);
  useEffect(() => {
    addressNow.current = address;
  });

  // The request carries its own address and its own `resend`, and the answer
  // is read against them — not against the field, which may have changed while
  // the request was out.
  const run = useMutation({
    mutationFn: (sent: { email: string; address: string; displayName: string; resend: boolean }) =>
      taskaApi.inviteUser({
        email: sent.email,
        displayName: sent.displayName || undefined,
        resend: sent.resend || undefined,
      }),
    onSuccess: (result, sent) => {
      if (!result.created && !result.deliveryQueued) {
        // Said only about the address it is about: an edit while the request
        // was out has already turned this back into an ordinary invitation.
        if (sent.address === addressNow.current) setStillInvited({ expiresAt: result.expiresAt });
        return;
      }
      // Made, whatever the field says now — so it is reported, under the
      // address it was made for.
      onDone(result, sent.address, sent.resend);
    },
  });

  const submit = () => {
    if (!canSubmit || run.isPending) return;
    run.mutate({ email: email.trim(), address, displayName: displayName.trim(), resend: stillInvited !== null });
  };
  useDialogKeys(submit);

  return (
    <Modal busy={run.isPending} onClose={onClose} title="Invite user">
      <form
        className="form-stack admin-invite-form"
        // The server judges the address, in its own sentence (§5.8); the
        // browser's bubble would answer first and in other words.
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <p className="admin-write-note">
          This creates a Taska account and emails a link to set a password. It doesn’t add them to any project — do
          that from a project’s Members dialog, where invited people show up straight away.
        </p>
        <div className="field">
          <label htmlFor={emailId}>Email</label>
          <input
            aria-describedby={emailHintId}
            autoComplete="off"
            autoFocus
            id={emailId}
            maxLength={INVITE_EMAIL_MAX_LENGTH}
            onChange={(event) => {
              setEmail(event.target.value);
              // A different address is a different question: back to an
              // ordinary invitation, and the last answer goes with it.
              setStillInvited(null);
              run.reset();
            }}
            spellCheck={false}
            type="email"
            value={email}
          />
          <p className="admin-field-hint" id={emailHintId}>
            {canSubmit ? "" : "Enter an email address."}
          </p>
        </div>
        <div className="field">
          <label htmlFor={nameId}>Display name (optional)</label>
          <input
            aria-describedby={nameHintId}
            autoComplete="off"
            id={nameId}
            maxLength={INVITE_DISPLAY_NAME_MAX_LENGTH}
            onChange={(event) => setDisplayName(event.target.value)}
            value={displayName}
          />
          <p className="admin-field-hint" id={nameHintId}>
            Used only for a new account. Left empty, the part of the email before @ is used.
          </p>
        </div>

        {/* Not a refusal, so no stripe (§5.8) — and a polite region that stays
            mounted, so the change from nothing to this is what is announced:
            focus is on the button, which is about to say "Send new link". */}
        <p className={stillInvited ? "admin-invite-standing" : "visually-hidden"} role="status">
          {stillInvited ? stillInvitedText(stillInvited.expiresAt, address) : ""}
        </p>

        {run.isError ? (
          <InviteRefusal
            email={run.variables?.address ?? address}
            error={run.error}
            existsText="This email already belongs to a Taska account, so there is nothing to invite."
          />
        ) : null}

        <div className="modal-actions">
          <button className="secondary-button" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            aria-describedby={emailHintId}
            aria-disabled={!canSubmit || run.isPending || undefined}
            className="primary-button"
            type="submit"
          >
            {stillInvited ? "Send new link" : "Send invitation"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * "Resend invitation" (§5.8): a new link for an `INVITED` row, which revokes the
 * one sent earlier — that cannot be undone, hence the question. The Users
 * confirmation recipe without the reason field: the route takes none.
 *
 * A 409 here means the account stopped being INVITED between the list and the
 * press — activated, locked or blocked; the list is read again (`onStale`) so
 * the row stops offering this. "Send new link" stays where it is, steadily
 * `aria-disabled` (TAS-299): it is the button the reader just pressed, so
 * removing it would drop focus, and moving focus would compete with the alert;
 * a press and `Cmd/Ctrl+Enter` send nothing more, because the answer could
 * only be the same 409.
 */
export function AdminResendInviteModal({
  user,
  onClose,
  onDone,
  onStale,
}: {
  /** Narrowed to a row with a key and an address: a row without either offers no resend. */
  user: AdminUserTarget & { email: string };
  onClose: () => void;
  onDone: (result: InvitationResult) => void;
  onStale: () => void;
}) {
  const name = personLabel(user);
  const run = useMutation({
    mutationFn: () => taskaApi.inviteUser({ email: user.email, resend: true }),
    onSuccess: onDone,
    onError: (error) => {
      if (inviteFailure(error) === "exists") onStale();
    },
  });

  /** The 409: nothing is waiting for a link any more, and nothing can be resent. */
  const spent = run.isError && inviteFailure(run.error) === "exists";

  const submit = () => {
    if (run.isPending || spent) return;
    run.mutate();
  };
  useDialogKeys(submit);

  return (
    <Modal busy={run.isPending} onClose={onClose} title="Resend invitation">
      <form
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="admin-write-target">
          <p className="admin-write-target-name">{name}</p>
          {user.email !== name ? <p className="admin-write-target-line">{user.email}</p> : null}
        </div>
        <p className="admin-write-note">
          A new link is emailed to {user.email}. The link sent earlier stops working.
        </p>

        {run.isError ? (
          <InviteRefusal
            email={user.email}
            error={run.error}
            // A 409 is any account that is not INVITED — ACTIVE, LOCKED or
            // BLOCKED — so it says what that means, not which of them it is.
            existsText={`${name}’s account is no longer waiting for activation, so there is nothing to resend.`}
          />
        ) : null}

        <div className="modal-actions">
          {/* Focus starts on the answer that changes nothing, as in every
              confirmation here (§4.22): the dialog has no field, and a second
              Enter should not revoke a link. */}
          <button autoFocus className="secondary-button" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            aria-disabled={run.isPending || spent || undefined}
            className={spent ? "primary-button admin-resend-submit is-spent" : "primary-button admin-resend-submit"}
            type="submit"
          >
            Send new link
          </button>
        </div>
      </form>
    </Modal>
  );
}
