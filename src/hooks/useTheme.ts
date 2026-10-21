import { useEffect, useState } from "react";
import { readStorage, writeStorage } from "../lib/readerPrefs";

export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "taska.theme";

/**
 * The theme on first render: the stored choice, else the system's
 * (`prefers-color-scheme`, §4.17). The same rule, the same key and the same
 * guards as the inline script in `index.html`, which has already put this value
 * on `<html>` before the first paint — so this only has to agree with it.
 */
export function initialTheme(): Theme {
  const stored = readStorage(THEME_STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

/**
 * The one theme state of the app (§4.17): the top bar's toggle and Settings →
 * Appearance → Theme (TAS-380) both write it. Storage is guarded the way every
 * reader preference is (`src/lib/readerPrefs.ts`): a refusal costs the
 * remembering, never the switch.
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    writeStorage(THEME_STORAGE_KEY, theme);
  }, [theme]);

  return {
    theme,
    setTheme,
    toggleTheme: () => setTheme((value) => (value === "light" ? "dark" : "light")),
  };
}
