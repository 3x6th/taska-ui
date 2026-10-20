import { X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

interface ModalProps {
  title: string;
  eyebrow?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * What Tab can land on inside the dialog, in document order. Disabled controls
 * and anything taken out of the order (`tabIndex=-1`: the results box of the
 * members dialog, programmatically focused headings) are not stops; neither is
 * anything not drawn.
 */
const TABBABLE = [
  "a[href]",
  "button:not(:disabled)",
  "input:not(:disabled):not([type='hidden'])",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  "summary",
  "[tabindex]",
].join(",");

function tabbables(dialog: HTMLElement): HTMLElement[] {
  // `checkVisibility` is false under `display: none`, which takes an element
  // out of the Tab order without saying so on the element itself. Where it is
  // not implemented the element counts as drawn.
  // Sorted, not trusted: a selector list is answered in document order by the
  // spec, and not by every implementation (jsdom groups it by selector).
  return [...dialog.querySelectorAll<HTMLElement>(TABBABLE)]
    .filter((element) => element.tabIndex >= 0 && (element.checkVisibility?.() ?? true))
    .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
}

/**
 * Tab and Shift+Tab wrap inside the dialog (§7, TAS-299). Without it Tab walked
 * out of every modal into the board or the admin page under the scrim —
 * measured on invite, create, labels and members — and taking the backdrop out
 * of the order alone only moved where the walk left. Only the two ends are
 * handled: between them the browser's own order stands, including from a
 * heading the dialog focused from script, which is inside and not a stop.
 */
function trapTab(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) return;
  const dialog = event.currentTarget;
  const stops = tabbables(dialog);
  const current = document.activeElement;
  if (stops.length === 0) {
    event.preventDefault();
    return;
  }
  const first = stops[0];
  const last = stops[stops.length - 1];
  // On the dialog itself there is no "next" of the dialog's own to defer to.
  const onDialog = current === dialog || !(current instanceof Node) || !dialog.contains(current);
  if (onDialog || (event.shiftKey ? current === first : current === last)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }
}

export function Modal({ title, eyebrow, onClose, children, footer }: ModalProps) {
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
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-footer">{footer}</footer> : null}
      </section>
    </div>
  );
}
