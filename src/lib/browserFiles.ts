/**
 * The two ways the attachments panel hands a file to the browser, written once
 * so each can be tested without a panel around it (TAS-253).
 *
 * **Opening** goes to the presigned link on the store, in a new tab, and never
 * to a `blob:` URL on this origin: an HTML attachment opened from a blob would
 * run as Taska. **Saving** is the opposite case — the bytes are fetched, wrapped
 * in a same-origin object URL and handed to an `<a download>`, which makes the
 * browser save rather than navigate, so nothing in the file ever runs here.
 */

/**
 * A new, empty tab, opened **synchronously inside the click** — the only moment
 * every browser still counts as the reader's own gesture. Safari stops counting
 * it after the first `await`, so the panel opens the tab first and points it at
 * the link once the link has arrived (`sendTabTo`).
 *
 * Opened without the `noopener` feature, and that is the whole fix for the
 * false "blocked" notice this replaced: by the HTML spec `window.open(…,
 * "noopener")` **always** returns `null`, so the old code read every tab that
 * did open as one the popup blocker had stopped. Here `null` is the blocker's
 * signal and nothing else. The tab's way back to this page is cut by hand
 * (`opener = null`) before anything is loaded into it, which is what `noopener`
 * was there for: a store's page must not be able to reach `window.opener`.
 */
export function openBlankTab(): Window | null {
  const tab = window.open("", "_blank");
  if (!tab) return null;
  try {
    tab.opener = null;
  } catch {
    // A browser that will not let the property be written still opened the
    // tab; the link is on the store we sign for, not an arbitrary page.
  }
  return tab;
}

/**
 * Points a tab opened by `openBlankTab` at `url`. `replace`, so the blank page
 * is not left behind in the tab's history for Back to land on. `false` when
 * the tab is no longer there to navigate — the reader closed it while the link
 * was being signed — so the caller can offer the link instead.
 */
export function sendTabTo(tab: Window, url: string): boolean {
  try {
    if (tab.closed) return false;
    tab.location.replace(url);
    return true;
  } catch {
    return false;
  }
}

/** Closes a tab opened for a link that never came. Never throws. */
export function closeTab(tab: Window | null): void {
  try {
    tab?.close();
  } catch {
    // Already gone.
  }
}

/**
 * How long the object URL outlives the click. Not zero: Firefox has been known
 * to cancel a download whose blob URL was revoked in the same task as the click
 * that started it, and a 2 MB blob held for a few more seconds costs nothing.
 */
export const OBJECT_URL_REVOKE_DELAY_MS = 4000;

/**
 * Saves `blob` under `fileName` through a temporary `<a download>`, then
 * revokes the object URL. The anchor is attached for the click — Firefox
 * ignores a click on a detached one — and removed straight after.
 */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName || "attachment";
  anchor.rel = "noopener";
  anchor.hidden = true;
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), OBJECT_URL_REVOKE_DELAY_MS);
  }
}
