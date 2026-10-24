import { X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { tabbables, trapTab } from "../lib/focusTrap";

interface ModalProps {
  title: string;
  eyebrow?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /**
   * The body as a Tab stop of its own, named by the title: for a dialog whose
   * reader may have nothing focusable in it to scroll by (Workflows for anybody
   * but an ADMIN, DESIGN.md §4.28). Its ring is §7's exception 1, drawn inside
   * the edge the modal clips at.
   */
  focusableBody?: boolean;
  /**
   * A write begun in this dialog is in flight: `Esc` does nothing until it
   * answers (DESIGN.md §4.11, as §4.28), so it never looks like it cancelled a
   * write that is still going. ✕ and the scrim still close; the write is not
   * cancelled by them either.
   */
  busy?: boolean;
}

export function Modal({ title, eyebrow, onClose, children, footer, focusableBody = false, busy = false }: ModalProps) {
  const dialogRef = useRef<HTMLElement>(null);
  /**
   * The control the dialog was opened from, so closing hands focus back to it
   * (§7). Read during the first render rather than in an effect: by the time
   * any effect here runs, a field's `autoFocus` has already moved focus inside.
   */
  const [opener] = useState(() => {
    const active = document.activeElement;
    return active instanceof HTMLElement && active !== document.body ? active : null;
  });

  // The trap above holds focus only once it is inside, and a dialog whose
  // content asks for none (a confirmation, release-reviewer TAS-299) left it
  // on the button that opened it, under the scrim. So on mount the first stop
  // takes it — unless the content has already placed it: `autoFocus` lands
  // during commit, and a child's own effect runs before this one, so either
  // wins.
  //
  // The cleanup is the way back, and it acts only when focus went with the
  // dialog, to `<body>`. A caller that put focus somewhere on purpose (the
  // admin row's next action after a 409, the Users section's trigger after a
  // write) or content mounted by the close that took it has already decided,
  // and keeps it — and StrictMode's rehearsal unmount, which leaves focus
  // inside the dialog, is not a close. A trigger that went with the close is
  // detached, and focusing it does nothing.
  //
  // A plain `focus()`: measured in Chromium, the ring comes back drawn after
  // Esc or a keyboard Cancel and undrawn after a pointer press — the browser's
  // own modality, as TAS-193 ruled for focus handed on.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.contains(document.activeElement)) tabbables(dialog)[0]?.focus();
    return () => {
      const active = document.activeElement;
      if (!opener || (active && active !== document.body)) return;
      opener.focus();
    };
  }, [opener]);

  /**
   * `Esc` (DESIGN.md §4.11, TAS-397): one listener for every dialog of the
   * product, which closes exactly one thing — the innermost — in §4.10's
   * order. The inner layers come first by where they listen, not by when they
   * registered: a results list, a question strip or an inner editor handles
   * `Esc` in React or on `document`, calls `preventDefault()` and leaves the
   * dialog open; this listens on `window`, where the event arrives last, and
   * skips what was prevented. Then, in order: nothing during IME composition;
   * nothing while the dialog holds text-work (§5.5) — a field marks itself
   * `data-unsaved-text="true"`, as in the issue panel, and keeps the mark when
   * an archive makes it `readOnly`; nothing while a write begun here is in
   * flight (`busy`); otherwise the dialog closes, as ✕ does, a read-only one
   * included. Where focus goes then is the cleanup above's and the screen's.
   *
   * The text holds the key wherever focus is in the dialog, not only in the
   * field: one `Esc` from a priority button or a colour swatch would otherwise
   * throw away the words the reader came back to (art-director, TAS-209).
   * Cancel, ✕ and the scrim are the ways to discard, and they ask for nothing.
   *
   * Read through refs, so the listener is bound once rather than on every
   * render of a form being typed into.
   */
  const onCloseRef = useRef(onClose);
  const busyRef = useRef(busy);
  useEffect(() => {
    onCloseRef.current = onClose;
    busyRef.current = busy;
  });
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      if (dialog.querySelector('[data-unsaved-text="true"]')) return;
      if (busyRef.current) return;
      event.preventDefault();
      onCloseRef.current();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  return (
    <div className="modal-layer" role="presentation">
      {/* Out of the Tab order (§7, TAS-299): a click on the scrim closes, and
          the keyboard's ways out are Close and Esc. As a stop it was reached by
          Shift+Tab from Close and drew its ring around the whole viewport. */}
      <button className="modal-backdrop" onClick={onClose} aria-label="Close modal" tabIndex={-1} type="button" />
      <section className="modal" role="dialog" aria-modal="true" aria-label={title} onKeyDown={trapTab} ref={dialogRef}>
        <header className="modal-header">
          <div className="modal-title-row">
            {eyebrow}
            <h2>{title}</h2>
          </div>
          {/* `aria-label` as well as `title`, and the label is what §7 asks for:
              an icon-only button carries one. `title` is the weakest source in
              the accessible-name order — it is what a name falls back to, and it
              is dropped outright by some assistive technology — so it stays for
              the pointer tooltip and stops being the only name. The string is
              unchanged, so nothing that addresses this button by name moves. */}
          <button aria-label="Close" className="icon-button" onClick={onClose} title="Close" type="button">
            <X size={16} />
          </button>
        </header>
        {/* One element either way, so a role that arrives after the dialog
            opened turns the stop on without remounting what is inside. A
            region rather than a bare `div`: a name on an element with no role
            is one assistive technology is allowed to drop. */}
        <div
          aria-label={focusableBody ? title : undefined}
          className={focusableBody ? "modal-body is-scroller" : "modal-body"}
          role={focusableBody ? "region" : undefined}
          tabIndex={focusableBody ? 0 : undefined}
        >
          {children}
        </div>
        {footer ? <footer className="modal-footer">{footer}</footer> : null}
      </section>
    </div>
  );
}
