import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CALLBACK_LANDING_PATH, writeCallbackLanding } from "../scripts/callbackLanding";

/**
 * The provider sign-in's landing on Pages (TAS-426): `auth/callback/index.html`
 * is the built `index.html`, byte for byte. The build step asserts it after
 * writing; this pins the step on a directory of its own, with bytes a text
 * round trip would not keep.
 */
describe("the callback landing build step", () => {
  let outDir = "";

  afterEach(() => {
    if (outDir) rmSync(outDir, { recursive: true, force: true });
  });

  it("copies the built index.html to auth/callback/index.html, byte-equal", () => {
    outDir = mkdtempSync(join(tmpdir(), "taska-landing-"));
    const built = Buffer.concat([
      Buffer.from('<!doctype html><script type="module" src="/assets/index-abc.js"></script>\r\n'),
      Buffer.from([0xef, 0xbb, 0xbf, 0xe2, 0x80, 0x94, 0x0a]),
    ]);
    writeFileSync(join(outDir, "index.html"), built);

    const target = writeCallbackLanding(outDir);

    expect(target).toBe(join(outDir, CALLBACK_LANDING_PATH));
    expect(readFileSync(target).equals(built)).toBe(true);
    // A landing file, not a catch-all: an unknown address stays Pages' 404.
    expect(existsSync(join(outDir, "404.html"))).toBe(false);
  });

  it("stops the build when there is no built page to copy", () => {
    outDir = mkdtempSync(join(tmpdir(), "taska-landing-"));
    expect(() => writeCallbackLanding(outDir)).toThrow();
  });
});
