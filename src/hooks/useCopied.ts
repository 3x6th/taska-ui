import { useCallback, useEffect, useState } from "react";

export type CopyState = "idle" | "copied" | "failed";

/**
 * Put `value` on the clipboard. Resolves only once it is there, and rejects
 * otherwise — including when there is no clipboard at all: an insecure origin,
 * or a browser that withholds it. Nothing was written then, and the caller has
 * to say so.
 *
 * The one place the product talks to the clipboard, so the rule below holds
 * for every caller: `useCopied` here, and the share popover in the issue panel
 * (TAS-248), which needs its own answer shape but not its own copy of this.
 */
export function writeClipboard(value: string): Promise<void> {
  try {
    return navigator.clipboard?.writeText(value) ?? Promise.reject(new Error("No clipboard on this page"));
  } catch (error) {
    // A browser that refuses by throwing rather than by rejecting.
    return Promise.reject(error);
  }
}

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
    writeClipboard(value).then(
      () => setState("copied"),
      () => setState("failed"),
    );
  }, []);

  return [state, copy];
}
