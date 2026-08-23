import { useEffect, useState } from "react";

/**
 * The value as it was `delayMs` ago, once it has stopped changing.
 *
 * This exists for one job and should keep it: turning a field the reader types
 * into at most one request per pause. What it must **not** be used for is the
 * text the reader is looking at — the board filters its loaded issues on the
 * live value, instantly, and only the server query reads the debounced one
 * (DESIGN.md §4.14 puts the debounce at 200ms).
 *
 * The initial value is not delayed: on mount the returned value already is the
 * one passed in, so nothing has to render an empty first frame.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
