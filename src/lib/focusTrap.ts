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
 * of the order alone only moved where the walk left.
 *
 * The browser's own order stands for as long as it has a stop of the dialog's
 * to go to, in the direction pressed; where it has none, the press wraps. That
 * is not the same as "only at the first and the last stop": focus also sits on
 * places script put it that are not stops (`tabIndex=-1`) — a heading the
 * dialog focused, the archive line or the refusal an archive sends focus to
 * (DESIGN.md §5.7) — and from one of those after the last stop, the browser's
 * next was the page under the scrim (art-director, TAS-149). Ahead and behind
 * are read off document order, which is the order the browser walks here:
 * nothing in the product sets a positive `tabIndex`. A stop that contains the
 * focused element counts as behind it and one it contains as ahead, which is
 * also how the browser's walk treats them.
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
  // On the dialog itself — or anywhere outside it — there is no "next" of the
  // dialog's own to defer to.
  const inside = current instanceof Node && current !== dialog && dialog.contains(current);
  const ahead =
    inside && stops.some((stop) => current.compareDocumentPosition(stop) & Node.DOCUMENT_POSITION_FOLLOWING);
  const behind =
    inside && stops.some((stop) => current.compareDocumentPosition(stop) & Node.DOCUMENT_POSITION_PRECEDING);
  if (!inside || (event.shiftKey ? !behind : !ahead)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }
}
