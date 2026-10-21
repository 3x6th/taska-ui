import { X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { refuseStrayFileDrop } from "../lib/browserFiles";
import { trapTab } from "../lib/focusTrap";
import { IssuePanelFrameContext, type IssuePanelHeadState } from "./issuePanelFrameContext";

/**
 * The issue panel's one frame (TAS-380, art-director's ruling 7, DESIGN.md
 * §4.10): the layer, the scrim, the dialog and its 52px head with Close, around
 * every state the panel has — loading, a read that failed, a render that
 * failed, and the loaded issue. Each state fills the head through
 * `useIssuePanelHead`. One frame gives three guarantees: the entrance plays
 * once, Close exists in every state, and the Close that took first focus is
 * the same node when loading turns into loaded.
 *
 * Where it stands — a slide-over at the right edge or a window in the middle —
 * is the reader's choice (Settings → Appearance), read by the stylesheet off
 * `<html data-issue-details>`; nothing here knows which.
 *
 * **A dialog, in both placements and at every width:** `role="dialog"` with
 * `aria-modal`, named "{KEY} issue". It used to be an `aside` with no role:
 * focus stayed on the card behind the scrim and Esc did nothing.
 *
 * **Focus.** Close takes it when the frame mounts — the one control every state
 * has, and not a destructive one; the browser decides whether the ring shows,
 * by how the panel was opened. Tab and Shift+Tab wrap inside (`trapTab`, the
 * trap `Modal` uses). On the way out it goes back to the element that had it
 * when the panel opened, if that is still in the page; else to `fallbackFocus`
 * — the board's card for this issue, else its back button. A delete has its
 * own order (§4.10), which the board applies after this and which therefore
 * wins.
 *
 * **Esc closes one thing, the innermost** (§4.10). Whatever closes something
 * smaller on Esc — the Share popover, the delete question, a comment's or a
 * work log entry's question — calls `preventDefault()`, and this listener,
 * on `window`, runs after every `document` listener and every React handler
 * and skips such a press. That order comes from where it listens, not from
 * when anything registered. A field holding unsaved text marks itself with
 * `data-unsaved-text`, and Esc with focus in it leaves the panel, the text and
 * the focus where they are. A press during IME composition is the input
 * method's.
 */
export function IssuePanelFrame({
  onClose,
  fallbackFocus,
  children,
}: {
  onClose: () => void;
  /** Where focus goes on close when the element that opened the panel is gone. */
  fallbackFocus: () => HTMLElement | null;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [start, setStart] = useState<HTMLElement | null>(null);
  const [actions, setActions] = useState<HTMLElement | null>(null);
  const [head, setHead] = useState<IssuePanelHeadState>({ label: "Issue", busy: false, asking: false });
  /**
   * What had focus when the panel opened. Read during the first render, as
   * `Modal` reads it: by the time any effect runs here, Close has it.
   */
  const [opener] = useState(() => {
    const active = document.activeElement;
    return active instanceof HTMLElement && active !== document.body ? active : null;
  });
  // Read through refs so the two listeners below are bound once per frame.
  const onCloseRef = useRef(onClose);
  const fallbackRef = useRef(fallbackFocus);
  useEffect(() => {
    onCloseRef.current = onClose;
    fallbackRef.current = fallbackFocus;
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.contains(document.activeElement)) closeRef.current?.focus();
    return () => {
      // Only when focus went with the panel, to <body>: StrictMode's rehearsal
      // unmount leaves it on Close, and is not a close.
      const active = document.activeElement;
      if (active && active !== document.body) return;
      // A link in the panel opened another issue: the next panel is already in
      // the page and takes focus itself.
      if (document.querySelector(".issue-panel")) return;
      const target = opener?.isConnected ? opener : fallbackRef.current();
      target?.focus();
    };
  }, [opener]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.dataset.unsavedText === "true" && dialogRef.current?.contains(active)) {
        return;
      }
      event.preventDefault();
      onCloseRef.current();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  const slots = useMemo(() => ({ start, actions, setHead }), [start, actions]);

  return (
    <div className="panel-layer">
      {/* Out of the Tab order: a click on the scrim closes, and the keyboard's
          ways out are Close and Esc (§7). */}
      <button className="panel-backdrop" onClick={onClose} aria-label="Close issue" tabIndex={-1} type="button" />
      {/* A file let go over the panel outside the attachments section must not
          navigate the tab away to it (TAS-253) — in any state. */}
      <div
        aria-busy={head.busy || undefined}
        aria-label={head.label}
        aria-modal="true"
        className="issue-panel"
        onDragOver={refuseStrayFileDrop}
        onDrop={refuseStrayFileDrop}
        onKeyDown={trapTab}
        ref={dialogRef}
        role="dialog"
      >
        {/* The head's bottom line moves under the delete zone while it is open,
            so there is one line under the fixed part of the panel, not two
            (§1 rule 2, §4.10). The two slots are `display: contents`: what a
            state puts in them lays out in the head's own row. */}
        <header className={head.asking ? "issue-panel-head is-asking" : "issue-panel-head"}>
          <span className="issue-panel-head-slot" ref={setStart} />
          <div className="topbar-spacer" />
          <span className="issue-panel-head-slot" ref={setActions} />
          {/* Named as well as titled (§7): `title` is the weakest source of an
              accessible name and some assistive technology drops it. */}
          <button aria-label="Close" className="icon-button" onClick={onClose} ref={closeRef} title="Close" type="button">
            <X size={16} />
          </button>
        </header>
        <IssuePanelFrameContext value={slots}>{children}</IssuePanelFrameContext>
      </div>
    </div>
  );
}
