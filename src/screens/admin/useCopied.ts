import { useCallback, useEffect, useState } from "react";

/**
 * Copy a value to the clipboard and say so for two seconds (§5.8).
 *
 * Shared by the request id and the primary key because the honesty rule is the
 * same in both places and is easy to get wrong: only a *successful* write says
 * "Copied". A refused clipboard permission or an insecure origin must not claim
 * the value is on the clipboard when it is not — the reader is about to paste it
 * into a gateway log query, and a false confirmation costs them the search.
 */
export function useCopied(): [boolean, (value: string) => void] {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = useCallback((value: string) => {
    void navigator.clipboard
      ?.writeText(value)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  }, []);

  return [copied, copy];
}
