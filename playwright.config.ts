import { defineConfig } from "@playwright/test";

// A dedicated port so the suite can never attach to a developer's own dev
// server, which usually runs in hybrid mode against the live gateway. The
// e2e server is always mock-backed and always freshly started.
//
// `TASKA_E2E_PORT` moves it, for a second worktree running the gate while
// another checkout runs its own: with `strictPort` and no server reuse, two
// suites on one port do not share a server, the second one simply fails to
// start. Moving the port keeps both properties. The suite takes **two** ports,
// `TASKA_E2E_PORT` and the one above it (the hash-routed server below), so a
// second run has to sit at least two away from the first — 5185 beside the
// default 5183, not 5184.
const PORT = Number(process.env.TASKA_E2E_PORT) || 5183;
// A second server one port up, built the way the Pages build routes: by the
// hash, under a base path. It exists for the specs that are *about* that — the
// invitation link (TAS-208), whose `?token=` the hash router never sees — and
// they address it by absolute URL; every other spec stays on the first.
const HASH_PORT = PORT + 1;
const HASH_BASE = "/taska-ui/";

// CI runs this suite as shards, each on a runner of its own, so a shard takes
// one worker per vCPU ("100%") rather than Playwright's default half. Each
// shard writes a blob, not an HTML report: a per-shard HTML report is a partial
// one nobody downloads, and the merge job turns the blobs into the one report.
// `list` stays so a shard's own log still reads. Locally neither changes.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? "100%" : undefined,
  reporter: process.env.CI ? [["list"], ["blob"]] : "list",
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
  webServer: [
    {
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
    {
      command: `npm run dev -- --port ${HASH_PORT} --strictPort`,
      url: `http://localhost:${HASH_PORT}${HASH_BASE}`,
      reuseExistingServer: false,
      env: {
        VITE_TASKA_API_MODE: "mock",
        VITE_TASKA_API_PROXY_TARGET: "",
        VITE_BASE_PATH: HASH_BASE,
        VITE_ROUTER_MODE: "hash",
      },
    },
  ],
});
