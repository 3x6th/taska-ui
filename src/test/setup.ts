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

// jsdom implements no layout, so it ships no `scrollIntoView` either — and the
// global search scrolls its active option into view, because a combobox keeps
// DOM focus on the input and the browser will never scroll the selection for
// it. A no-op is the honest stub rather than a lie: there is no viewport here
// for a row to be inside or outside of, so what this call does is only
// answerable in a real browser, and it is answered there
// (`e2e/topbar-popovers.spec.ts` measures the selected row against the list's
// own box at three viewport sizes). Guarding the call in the component instead
// would be production code shaped by a test environment.
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
