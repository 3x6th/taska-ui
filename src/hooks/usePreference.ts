import { useCallback, useSyncExternalStore } from "react";
import { currentPreference, setPreference, subscribePreferences, type ReaderPreference } from "../lib/readerPrefs";

/**
 * A reader preference (`src/lib/readerPrefs.ts`) as React state: the value in
 * force on `<html>`, and a setter that applies and remembers it. An external
 * store rather than `useState`, because the attribute is the value and nothing
 * should hold a second copy of it that could disagree.
 */
export function usePreference<T extends string>(preference: ReaderPreference<T>): [T, (value: T) => void] {
  const value = useSyncExternalStore(subscribePreferences, () => currentPreference(preference));
  const set = useCallback((next: T) => setPreference(preference, next), [preference]);
  return [value, set];
}
