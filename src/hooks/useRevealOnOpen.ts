import { useEffect, useRef } from "react";

/**
 * A row form or a strip opened below the fold is brought into the body's view
 * once, on opening — the whole box, so its Save or its answer is on screen
 * (art-director, TAS-416) — as §4.22 brings its notice: `nearest`, no
 * `behavior`, so reduced motion has nothing to take away.
 */
export function useRevealOnOpen<T extends HTMLElement>() {
  const box = useRef<T>(null);
  useEffect(() => {
    box.current?.scrollIntoView({ block: "nearest" });
  }, []);
  return box;
}
