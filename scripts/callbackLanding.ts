import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Plugin } from "vite";

/**
 * Where the provider sign-in lands on GitHub Pages (TAS-426, DESIGN.md §4.31).
 *
 * The backend sends the browser back to `/auth/callback?code=…` at the root of
 * the UI's origin, whatever the build's base. Pages serves files, not routes:
 * without a file there the return is Pages' 404. `auth/callback/index.html`
 * is that file — Pages answers `/auth/callback?code=…` with a 301 to
 * `/auth/callback/?code=…`, query kept (measured on another Pages site,
 * 2026-10-27), then 200 with this copy — and src/main.tsx takes the code out
 * of the address before the router mounts. No `404.html`: an unknown address
 * stays a 404.
 *
 * A copy of the **built** `index.html`, byte for byte, made after the bundle is
 * written — never of the source page, whose script tag points at `src/` — and
 * read back to prove it. It works only with `VITE_BASE_PATH=/`: the built page
 * loads its assets from `${base}assets/…`, which from `/auth/callback/` must be
 * absolute at the root.
 */
export const CALLBACK_LANDING_PATH = "auth/callback/index.html";

/** Copies `<outDir>/index.html` to the landing path and throws unless the two are byte-equal. */
export function writeCallbackLanding(outDir: string): string {
  const source = join(outDir, "index.html");
  const target = join(outDir, CALLBACK_LANDING_PATH);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  if (!readFileSync(source).equals(readFileSync(target))) {
    throw new Error(`${CALLBACK_LANDING_PATH} is not byte-equal to the built index.html`);
  }
  return target;
}

/** The build step: after every file is written, the landing copy. Build only — the dev server serves the page itself. */
export function callbackLanding(): Plugin {
  let outDir = "dist";
  return {
    name: "taska-oauth-callback-landing",
    apply: "build",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    writeBundle() {
      writeCallbackLanding(outDir);
    },
  };
}
