import { useCallback, useEffect, useState } from "react";

export type CopyState = "idle" | "copied" | "failed";

/**
 * Copy a value to the clipboard and say what happened for two seconds (§5.8).
 *
 * Shared by the request id and the primary key because the honesty rule is the
 * same in both places and is easy to get wrong in both directions. Only a
 * *successful* write may say "Copied": a refused permission or an insecure
 * origin must not claim the value is on the clipboard when it is not, because
 * the reader is about to paste it into a gateway log query and a false
 * confirmation costs them the search. And a *failed* write may not stay silent
 * either — silence makes the click indistinguishable from a dead control, so
 * the failure gets its own answer rather than none.
 */
export function useCopied(): [CopyState, (value: string) => void] {
  const [state, setState] = useState<CopyState>("idle");

  useEffect(() => {
    if (state === "idle") return;
    const timer = window.setTimeout(() => setState("idle"), 2000);
    return () => window.clearTimeout(timer);
  }, [state]);

  const copy = useCallback((value: string) => {
    const written = navigator.clipboard?.writeText(value);
    // No clipboard at all — an insecure origin, or a browser that withholds it.
    // Nothing was written, and the caller has to say so.
    if (!written) {
      setState("failed");
      return;
    }
    void written.then(() => setState("copied")).catch(() => setState("failed"));
  }, []);

  return [state, copy];
}
