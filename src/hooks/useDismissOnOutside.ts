import { useEffect, useRef, type RefObject } from "react";

/**
 * The two ways out of a transient overlay that DESIGN.md requires of all of
 * them: `Escape`, and a press anywhere outside it (§4.12, §4.16, §7).
 *
 * Written once because there are three of these — the profile menu, the
 * notifications popover and the global search dropdown — and the version that
 * only existed inside the profile menu was the reason the other two shipped
 * without it. §7 already records that as a gap.
 *
 * Three details are deliberate rather than incidental:
 *
 * - **`pointerdown`, not `click`.** It closes on the press rather than on the
 *   release, which is what makes it feel immediate, and it survives a press
 *   that drags a little before it lifts — a `click` never fires then, and the
 *   overlay would stay open under a finger that has clearly moved on.
 * - **The ref goes around the trigger as well as the panel.** That is what
 *   stops the classic fight with a toggle button: pressing the trigger of an
 *   open overlay lands *inside* the ref, so this does nothing and the trigger's
 *   own `onClick` closes it — one close, not a close and a reopen on the same
 *   press.
 * - **Nothing is listening while the overlay is shut.** The effect subscribes
 *   on open and tears down on close, so a closed popover costs the document
 *   no handlers at all.
 *
 * `onDismiss` is read through a ref so that an inline arrow at the call site —
 * which every one of them is — does not resubscribe both listeners on every
 * render of the screen around it.
 */
export function useDismissOnOutside(
  /** Whether the overlay is on screen. Nothing is bound while this is false. */
  open: boolean,
  /** The element that counts as "inside": the panel *and* its trigger. */
  ref: RefObject<HTMLElement | null>,
  onDismiss: () => void,
) {
  const dismiss = useRef(onDismiss);

  useEffect(() => {
    dismiss.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) dismiss.current();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss.current();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, ref]);
}
