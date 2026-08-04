import { defineConfig } from "@playwright/test";

// A dedicated port so the suite can never attach to a developer's own dev
// server, which usually runs in hybrid mode against the live gateway. The
// e2e server is always mock-backed and always freshly started.
const PORT = 5183;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  // The AGENTS.md verification matrix: desktop 16:9, laptop 16:10, phone
  // portrait. All three run in Chromium; engine coverage is not the goal here.
  projects: [
    { name: "desktop", use: { viewport: { width: 1920, height: 1080 } } },
    { name: "laptop", use: { viewport: { width: 1440, height: 900 } } },
    {
      name: "mobile",
      use: {
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    // Every variable the suite depends on is pinned here rather than inherited
    // from the developer's .env, so the run is hermetic by construction:
    // Playwright passes these over process.env, and Vite's loadEnv applies
    // process.env last, above every .env file. Empty proxy target means the
    // dev server mounts no /api proxy at all — without it the e2e server
    // still forwards to the live gateway, one stray request away from the
    // team's real backend.
    env: {
      VITE_TASKA_API_MODE: "mock",
      VITE_TASKA_API_PROXY_TARGET: "",
      VITE_BASE_PATH: "/",
      VITE_ROUTER_MODE: "browser",
    },
  },
});
