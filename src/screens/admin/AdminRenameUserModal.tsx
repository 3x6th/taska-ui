import { useMutation } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { taskaApi } from "../../api/client";
import { isDisplayNameInvalid } from "../../api/errors";
import { Modal } from "../../components/Modal";
import type { UserDisplayNameChange } from "../../domain/types";
import { displayNameProblem, trimDisplayName } from "../../lib/displayName";
import { AdminWriteTarget, UserWriteFailureNote } from "./AdminUserActionModal";
import type { AdminUserTarget } from "./users";

interface AdminRenameUserModalProps {
  user: AdminUserTarget;
  onClose: () => void;
  onDone: (change: UserDisplayNameChange) => void;
}

/**
 * "Rename user" (TAS-425, DESIGN.md §5.8 «Users: переименование»):
 * `PATCH /admin/users/{userId}` with the name, for any account in any status.
 *
 * Nothing optimistic, for the status writes' reason: the server decides —
 * the name rule, the caller's role, whether the account is still there — and
 * the row takes the name the server answered with. No reason field: the
 * server writes the old and the new name to the audit log itself.
 *
 * A name is a value, not text being worked on, so `Esc` closes the dialog
 * whatever the field holds (§4.11); while the write is out it does nothing,
 * and ✕ and the scrim close without cancelling the write.
 */
export function AdminRenameUserModal({ user, onClose, onDone }: AdminRenameUserModalProps) {
  const current = user.displayName ?? "";
  const [draft, setDraft] = useState(current);
  const fieldId = useId();
  const reasonId = useId();
  const fieldRef = useRef<HTMLInputElement>(null);
  const problem = displayNameProblem(draft);

  const run = useMutation({
    mutationFn: (displayName: string) => taskaApi.updateUserDisplayName(user.id, displayName),
    onSuccess: onDone,
  });
  const refusedName = run.isError && isDisplayNameInvalid(run.error);

  const submit = () => {
    if (problem || run.isPending) return;
    const name = trimDisplayName(draft);
    // The same name is no change: the dialog closes and nothing is sent.
    if (name === current) {
      onClose();
      return;
    }
    run.mutate(name);
  };

  // Read through a ref, as the confirmation does: the document listener below
  // is bound once, not per keystroke.
  const keyboard = useRef({ submit });
  useEffect(() => {
    keyboard.current = { submit };
  });

  useEffect(() => {
    // §4.11's `Cmd/Ctrl+Enter`, from anywhere in the dialog. Plain Enter is the
    // form's own submit, from the field.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.isComposing) {
        event.preventDefault();
        keyboard.current.submit();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Focus in the field with the caret at the end. An effect of this component
  // runs after `Modal`'s own, which has already put focus on the dialog's first
  // stop, so this is the one that stays.
  useEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  }, []);

  return (
    <Modal busy={run.isPending} onClose={onClose} title="Rename user">
      <form
        className="form-stack admin-rename-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <AdminWriteTarget user={user} />

        <div className="field">
          <label htmlFor={fieldId}>Name</label>
          <input
            aria-describedby={problem ? reasonId : undefined}
            aria-invalid={problem || refusedName ? true : undefined}
            autoComplete="off"
            id={fieldId}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Enter while an IME is composing commits the composition, and
              // must not also send the form.
              if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault();
            }}
            readOnly={run.isPending}
            ref={fieldRef}
            spellCheck={false}
            value={draft}
          />
          {problem ? (
            <p className="admin-field-hint" id={reasonId}>
              {problem}
            </p>
          ) : null}
        </div>

        {run.isError ? <UserWriteFailureNote action="rename" error={run.error} /> : null}

        <div className="modal-actions">
          <button
            aria-disabled={run.isPending || undefined}
            className="secondary-button admin-rename-cancel"
            onClick={() => {
              if (!run.isPending) onClose();
            }}
            type="button"
          >
            Cancel
          </button>
          {/* §4.1's two kinds of `aria-disabled`: steadily unavailable while the
              name has a reason (dimmed), in flight while the write is out. */}
          <button
            aria-disabled={run.isPending || problem ? true : undefined}
            className={`primary-button admin-rename-submit${problem ? " is-unavailable" : ""}`}
            type="submit"
          >
            Rename
          </button>
        </div>
      </form>
    </Modal>
  );
}
