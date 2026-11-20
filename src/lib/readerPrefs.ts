/**
 * The reader's own choices of how the product is drawn (TAS-380, DESIGN.md
 * §5.9): where an issue opens, and where the board's columns sit on a wide
 * screen. The theme is the third, and lives in `useTheme` — the same storage
 * rules, the same `<html>` mirror, and the same inline script in `index.html`
 * that applies all three before the first paint. The board's Done window
 * (TAS-532) is stored on the same rules and kept out of the mirror — see
 * `BoardDoneWindow` at the end of this file.
 *
 * **One place each value lives in the page: the `<html>` data attribute.** The
 * CSS reads it — the board and the panel need no React state for any of this —
 * and so does every component that shows the choice. `localStorage` is only
 * what carries it to the next load. That split is what keeps a storage that
 * refuses (private mode, a full quota, a policy) from costing more than the
 * remembering: the choice still applies for as long as the tab is open.
 *
 * **Every storage access is guarded**, as `taska.activityCollapsed` is: a read
 * that throws is the default, a write that throws is a choice not remembered.
 *
 * **An unknown value is the default** — an old build's value, a hand edit, a
 * value a later build adds and this one does not know.
 *
 * The keys, values and defaults are repeated in the inline script in
 * `index.html`, which cannot import this module because it has to run before
 * any module does. `readerPrefs.test.ts` runs that script against these
 * definitions, so the two cannot drift apart quietly.
 */
export interface ReaderPreference<T extends string> {
  /** The `localStorage` key. */
  key: string;
  /** The `<html>` data attribute, as `dataset` names it. */
  attribute: "issueDetails" | "boardColumns";
  values: readonly T[];
  fallback: T;
}

export type IssueDetailsPlacement = "side" | "centered";
export type BoardColumnsAlignment = "left" | "centered";

/** Settings → Appearance → Issue details: `side` is the slide-over, `centered` the window. */
export const issueDetailsPreference: ReaderPreference<IssueDetailsPlacement> = {
  key: "taska.issueDetails",
  attribute: "issueDetails",
  values: ["side", "centered"],
  fallback: "side",
};

/** Settings → Appearance → Board columns. */
export const boardColumnsPreference: ReaderPreference<BoardColumnsAlignment> = {
  key: "taska.boardColumns",
  attribute: "boardColumns",
  values: ["left", "centered"],
  fallback: "left",
};

/** The value if it is one of the preference's, the default otherwise. */
export function normalizePreference<T extends string>(preference: ReaderPreference<T>, value: unknown): T {
  return (preference.values as readonly unknown[]).includes(value) ? (value as T) : preference.fallback;
}

/** `localStorage.getItem`, or `null` when storage refuses to be read. */
export function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** `localStorage.setItem`; a refusal costs the remembering and nothing else. */
export function writeStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Not remembered, and that is all: the page already shows the choice.
  }
}

/** What storage says, normalised. What the inline script in `index.html` applies on load. */
export function storedPreference<T extends string>(preference: ReaderPreference<T>): T {
  return normalizePreference(preference, readStorage(preference.key));
}

/**
 * The choice in force in this page. The attribute when it is there — the
 * inline script set it on load, and `setPreference` since — and storage
 * otherwise, which is only the case where no script ran (a test).
 */
export function currentPreference<T extends string>(preference: ReaderPreference<T>): T {
  const applied = document.documentElement.dataset[preference.attribute];
  return applied === undefined ? storedPreference(preference) : normalizePreference(preference, applied);
}

const listeners = new Set<() => void>();

/** For `useSyncExternalStore`: told whenever `setPreference` changes a choice. */
export function subscribePreferences(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Applies a choice at once and remembers it. Live, with no Save (§5.9): the
 * attribute moves in this call, so the very next frame is drawn the new way.
 */
export function setPreference<T extends string>(preference: ReaderPreference<T>, value: T) {
  const next = normalizePreference(preference, value);
  document.documentElement.dataset[preference.attribute] = next;
  writeStorage(preference.key, next);
  listeners.forEach((listener) => listener());
}

/**
 * The board's Done window (TAS-532, DESIGN.md §4.13 «Окно Done», §6): which
 * issues of a done column the board reads — those updated in the last two
 * weeks (`2w`, the default) or all of them (`all`). A view, not a filter: it
 * is what `doneSince` the board read sends, and «Clear» leaves it alone.
 *
 * A reader pref on the same storage rules as the three above — every access
 * guarded, an unknown value the default — and **not** one of them in two
 * ways. It is not mirrored on `<html>`, because no CSS reads it, and so the
 * inline script in `index.html` does not apply it either: the board reads it
 * synchronously when it sets up its own state, so its first read is already
 * under the window chosen, with no second read and no swapped frame. And it
 * has no row in Settings → Appearance: Appearance is where and how the
 * interface stands, the window is what the board reads; the setting lives on
 * its own control, as `taska.activityCollapsed` does (§4.26). One value for
 * every board and every company; another tab sees a change on its next load.
 */
export type BoardDoneWindow = "2w" | "all";

/** The `localStorage` key of the Done window. */
export const BOARD_DONE_WINDOW_KEY = "taska.boardDoneWindow";

/** The Done window's values, the default first. */
export const BOARD_DONE_WINDOWS: readonly BoardDoneWindow[] = ["2w", "all"];

/** The value if it is a Done window, `2w` otherwise — a missing one, an old build's, a hand edit. */
export function normalizeBoardDoneWindow(value: unknown): BoardDoneWindow {
  return (BOARD_DONE_WINDOWS as readonly unknown[]).includes(value) ? (value as BoardDoneWindow) : BOARD_DONE_WINDOWS[0];
}

/** The Done window storage remembers; `2w` when it holds none it knows or refuses to be read. */
export function storedBoardDoneWindow(): BoardDoneWindow {
  return normalizeBoardDoneWindow(readStorage(BOARD_DONE_WINDOW_KEY));
}

/** Remembers the Done window; a refusal costs the remembering, and the board already reads the choice. */
export function rememberBoardDoneWindow(value: BoardDoneWindow) {
  writeStorage(BOARD_DONE_WINDOW_KEY, normalizeBoardDoneWindow(value));
}
