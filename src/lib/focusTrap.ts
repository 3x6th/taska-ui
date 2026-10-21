import type { KeyboardEvent } from "react";

/**
 * What Tab can land on inside a dialog, in document order. Disabled controls
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

export function tabbables(dialog: HTMLElement): HTMLElement[] {
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
 *
 * Shared by `Modal` and the issue panel (`IssuePanelFrame`, TAS-380): one trap,
 * so the two dialogs of the product cannot come to disagree about where Tab
 * goes at their edges.
 */
export function trapTab(event: KeyboardEvent<HTMLElement>) {
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
