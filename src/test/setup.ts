import "@testing-library/jest-dom/vitest";

// jsdom ships no matchMedia, and `useTheme` reads it on the very first render,
// so any test that mounts a screen crashes without this. It reports "no
// preference", which is the light theme — the same default the app uses when a
// browser has no stated preference.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
}
