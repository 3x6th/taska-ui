import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { taskaApi } from "../../api/client";
import { apiErrorFacts, isDisplayNameInvalid } from "../../api/errors";
import { ErrorNote } from "../../components/ErrorNote";
import type { User } from "../../domain/types";
import { displayNameProblem, trimDisplayName } from "../../lib/displayName";
import { ME_QUERY_KEY } from "../../lib/ownAvatarLink";
import { invalidatePeopleNames } from "../../lib/peopleNames";

/**
 * The name in My profile's header, and the one field of the account the reader
 * can change (TAS-425, DESIGN.md §5.9 «Имя»): the name with a pencil right
 * after it, and in its place, while editing, a form — Name, Save, Cancel.
 *
 * `PATCH /users/me` answers in the shape of `GET /users/me`, and the answer
 * replaces the cached account whole: the header, the top bar's avatar and the
 * profile menu change in one frame, and the `["me"]` query's own rule
 * (`keepSignedAvatarLink`) keeps the photo link already drawn for an unchanged
 * avatar, so nothing is downloaded again. Nothing is optimistic: the read-only
 * field already shows the value while the write is out.
 *
 * The check under the field is the server's rule as a person reads it
 * (`displayNameProblem`), one reason at a time; the server still decides, and
 * a 400 is printed as it came.
 */
export function ProfileName({ user, onSaved }: { user: User; onSaved: (displayName: string) => void }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const fieldId = useId();
  const reasonId = useId();
  const refusalId = useId();
  const fieldRef = useRef<HTMLInputElement>(null);
  const pencilRef = useRef<HTMLButtonElement>(null);
  /** Where focus goes once the form has given way to the name again: a ring drawn after a write, as after `Esc`. */
  const focusPencil = useRef<"plain" | "drawn" | null>(null);

  const save = useMutation({
    mutationFn: (displayName: string) => taskaApi.updateMyDisplayName(displayName),
    onSuccess: (answer) => {
      // Through the `["me"]` query's own structural sharing, as any read is.
      queryClient.setQueryData(ME_QUERY_KEY, answer);
      invalidatePeopleNames(queryClient);
      focusPencil.current = "drawn";
      setEditing(false);
      onSaved(answer.displayName);
    },
    onError: (error) => {
      // Nothing answered, so the write may have landed or not (§5.9 «Отказ»):
      // the account is read again, and a second Save of a name it now has is
      // closed without a request by the unchanged-name rule in `submit`.
      if (!answered(error)) void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
    },
  });
  const pending = save.isPending;
  const problem = editing ? displayNameProblem(draft) : null;
  const refusedName = save.isError && isDisplayNameInvalid(save.error);

  useEffect(() => {
    if (editing) {
      const field = fieldRef.current;
      if (!field) return;
      field.focus();
      // The caret at the end, where a correction usually starts.
      field.setSelectionRange(field.value.length, field.value.length);
      return;
    }
    const how = focusPencil.current;
    focusPencil.current = null;
    const pencil = pencilRef.current;
    if (!how || !pencil) return;
    // After a write the reader did not move focus here themselves; a pointer
    // press on Save would otherwise leave it here undrawn (§7, as §5.8 does).
    if (how === "plain") {
      pencil.focus();
      return;
    }
    try {
      pencil.focus({ focusVisible: true });
    } catch {
      pencil.focus();
    }
  }, [editing]);

  const open = () => {
    save.reset();
    setDraft(user.displayName);
    setEditing(true);
  };

  const close = () => {
    if (pending) return;
    save.reset();
    focusPencil.current = "plain";
    setEditing(false);
  };

  const submit = () => {
    if (pending || problem) return;
    const name = trimDisplayName(draft);
    // An unchanged name is a Cancel: nothing to send (§4.28).
    if (name === user.displayName) {
      close();
      return;
    }
    save.mutate(name);
  };

  if (!editing) {
    return (
      <div className="settings-name-row">
        <strong className="settings-profile-name" title={user.displayName}>
          {user.displayName}
        </strong>
        <button
          aria-label="Edit name"
          className="icon-button settings-name-edit"
          onClick={open}
          ref={pencilRef}
          title="Edit"
          type="button"
        >
          <Pencil aria-hidden="true" size={14} />
        </button>
      </div>
    );
  }

  const describedBy = problem ? reasonId : refusedName ? refusalId : undefined;
  return (
    <form
      className="settings-name-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label htmlFor={fieldId}>Name</label>
      <input
        aria-describedby={describedBy}
        aria-invalid={problem || refusedName ? true : undefined}
        autoComplete="name"
        className="settings-name-input"
        id={fieldId}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          // Neither key acts while an IME is composing: Enter there commits the
          // composition, and Esc abandons it.
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter") {
            event.preventDefault();
            submit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            close();
          }
        }}
        readOnly={pending}
        ref={fieldRef}
        spellCheck={false}
        value={draft}
      />
      {problem ? (
        <p className="settings-name-reason" id={reasonId}>
          {problem}
        </p>
      ) : null}
      <div className="settings-name-actions">
        {/* §4.1's two kinds of `aria-disabled`: steadily unavailable while the
            name has a reason (dimmed), in flight while the write is out (not
            dimmed). The handler refuses either way, Enter included. */}
        <button
          aria-disabled={pending || problem ? true : undefined}
          className={`primary-button compact-button${problem ? " is-unavailable" : ""}`}
          type="submit"
        >
          Save
        </button>
        <button
          aria-disabled={pending || undefined}
          className="secondary-button compact-button"
          onClick={close}
          type="button"
        >
          Cancel
        </button>
      </div>
      {save.isError ? <NameRefusal error={save.error} id={refusalId} /> : null}
    </form>
  );
}

/**
 * Whether anything answered the write: an HTTP status on the wire, or — in the
 * mock, which has no status — a domain code standing in for one. A request
 * that never reached the server (the network, nothing answered) carries
 * neither, and the browser's words ("Failed to fetch") are not the server's.
 */
function answered(error: unknown): boolean {
  const { status, code } = apiErrorFacts(error);
  return status !== null || code !== null;
}

/**
 * Why the name was not saved (§5.9 «Отказ», §5.6), in three kinds, the request
 * id under each. A refused request in the server's own sentence — its name
 * rule above all. One that nothing answered says the name may or may not
 * have changed, with no server words: there were none. Anything else in the
 * section's sentence, with the server's words beside it. An alert, as the
 * sign-in forms' refusals are: the answer lands under the buttons, away from
 * focus.
 *
 * A refused request is the 400 on the wire. The mock has no status, so there
 * its codes stand in — the two the gateway maps to 400.
 */
function NameRefusal({ error, id }: { error: unknown; id: string }) {
  const { message, requestId, status, code } = apiErrorFacts(error);
  if (!answered(error)) {
    return (
      <ErrorNote id={id} live="alert" requestId={requestId}>
        The server could not be reached, so your name may or may not have changed. Save again to make sure.
      </ErrorNote>
    );
  }
  const rejected = status !== null ? status === 400 : code === "INVALID_ARGUMENT" || code === "FAILED_PRECONDITION";
  if (rejected && message) {
    return (
      <ErrorNote id={id} live="alert" requestId={requestId}>
        {message}
      </ErrorNote>
    );
  }
  return (
    <ErrorNote id={id} live="alert" requestId={requestId} serverWords={message}>
      Your name was not changed.
    </ErrorNote>
  );
}
