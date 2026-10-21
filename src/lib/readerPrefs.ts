/**
 * The reader's own choices of how the product is drawn (TAS-380, DESIGN.md
 * §5.9): where an issue opens, and where the board's columns sit on a wide
 * screen. The theme is the third, and lives in `useTheme` — the same storage
 * rules, the same `<html>` mirror, and the same inline script in `index.html`
 * that applies all three before the first paint.
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
