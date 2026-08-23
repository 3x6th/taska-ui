import { useLayoutEffect, type RefObject } from "react";

/**
 * Publishes an open popover's trigger position onto the trigger's own wrapper,
 * as two custom properties in viewport pixels, so that CSS can hold the panel
 * inside the screen without giving up the anchor.
 *
 * - `--trigger-right` — the wrapper's right edge measured from the left of the
 *   viewport, which is what a panel anchored `right: 0` has to spend going
 *   leftward before it runs off the screen.
 * - `--trigger-bottom` — the wrapper's bottom edge measured from the top of the
 *   viewport, which is where a panel anchored `top: 38px` starts and therefore
 *   what its height has to be clamped against.
 *
 * Why this exists at all. The bar's trailing controls are one group pinned
 * right (§4.13) and the bell is that group's *first* child, so its right edge
 * is a long way from the screen's — 208.5 of 390 on a phone. A 312px panel
 * anchored to it crosses the left edge, and the previous answer to that
 * (TAS-179) re-anchored the panel to the whole bar below 820. The bar wraps at
 * that width, so the panel then dropped below both of its rows and read as
 * belonging to the search field rather than to the bell (TAS-181). Keeping the
 * anchor and narrowing the panel needs one number CSS cannot see: where the
 * trigger ended up. This is that number, and nothing else moves — the panel is
 * still `top: 38px; right: 0` against its own trigger at every width, exactly
 * as §4.12 writes it.
 *
 * CSS anchor positioning is the standard answer to the same question, and is
 * deliberately not used yet: its fallback path would be the defect itself in
 * every engine that has not shipped it, and Playwright runs Chromium only, so
 * the fallback would also be the untested path.
 *
 * `useLayoutEffect`, so the properties are set in the same commit that mounts
 * the panel and the browser lays it out once, at its final width.
 *
 * **Republished from a `ResizeObserver` on the bar, not from `window.resize`.**
 * The first version of this listened for resizes only, and that missed the
 * ordinary path: at 390 the board bar grows from 97 to 141 when the project
 * data lands, because the key badge and the real name arrive and the bar takes
 * a third row. No resize event is fired for that, so the trigger moved 44px
 * down under an already-open panel and the clamp kept the number it was born
 * with — measured at 390x560, a full inbox reaching 592 against the fold.
 * `main` did not have that failure because its clamp was a percentage of the
 * bar, which self-corrected; a published constant only self-corrects if
 * something republishes it. The bar covers the rewrap and the document element
 * covers the viewport, which is what `resize` used to cover.
 *
 * Observing the wrapper itself would not do: its size never changes, only its
 * position, and `ResizeObserver` reports the first and not the second. That is
 * also the residual — a trigger that moves while every observed box keeps its
 * size would still go unnoticed. On these two bars the trailing group is
 * `flex: none` and pinned right, so the bell moves only when the bar rewraps
 * or the viewport changes, and both are observed.
 *
 * Both properties are removed on close: they describe a position that is only
 * true while the panel is open, and a stale one left on the element would be
 * read by the next open before the effect runs.
 */
export function useTriggerAnchor(
  /** Whether the panel is on screen. Nothing is measured or bound while this is false. */
  open: boolean,
  /** The positioned wrapper the panel is anchored to — the trigger's box, not the panel's. */
  ref: RefObject<HTMLElement | null>,
) {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!open || !element) return;

    const publish = () => {
      const box = element.getBoundingClientRect();
      element.style.setProperty("--trigger-right", `${box.right}px`);
      element.style.setProperty("--trigger-bottom", `${box.bottom}px`);
    };

    publish();
    const observer = new ResizeObserver(publish);
    // Both bars are `<header>` elements — the shared `TopBar` and the board's
    // own — so one selector reaches whichever one a caller's trigger lives in.
    const bar = element.closest("header");
    if (bar) observer.observe(bar);
    observer.observe(document.documentElement);
    return () => {
      observer.disconnect();
      element.style.removeProperty("--trigger-right");
      element.style.removeProperty("--trigger-bottom");
    };
  }, [open, ref]);
}
