import { describe, expect, it } from "vitest";
import { absoluteAppUrl, issueKeyRoute, issueRoute } from "./appLinks";

/**
 * TAS-248: a copied link has to open in the app it was copied from, under the
 * same scheme. The e2e server runs browser routing at base `/` only, so the
 * Pages shape — hash routing behind a base path — is pinned here and nowhere
 * else (AGENTS.md: the suite cannot catch hash and base-path regressions).
 */
describe("absoluteAppUrl", () => {
  const PROJECT = "2e74e49f-0f29-4e03-b4ec-adc4dbf2382e";
  const ISSUE = "9c3f7b18-6d21-4a55-8e0b-7f2a1d4c9e30";

  describe("hash routing (the Pages build)", () => {
    const pages = { origin: "https://taska.ozero.dev", base: "/", mode: "hash" } as const;

    it("puts the route after the hash on the custom domain", () => {
      expect(absoluteAppUrl(issueKeyRoute("API-5"), pages)).toBe("https://taska.ozero.dev/#/browse/API-5");
      expect(absoluteAppUrl(issueRoute(PROJECT, ISSUE), pages)).toBe(
        `https://taska.ozero.dev/#/projects/${PROJECT}/issues/${ISSUE}`,
      );
    });

    it("keeps the repository base path in front of the hash", () => {
      const project = { origin: "https://3x6th.github.io", base: "/taska-ui/", mode: "hash" } as const;
      expect(absoluteAppUrl(issueKeyRoute("API-5"), project)).toBe("https://3x6th.github.io/taska-ui/#/browse/API-5");
    });

    it("reads a base without its trailing slash the same way", () => {
      const project = { origin: "https://3x6th.github.io", base: "/taska-ui", mode: "hash" } as const;
      expect(absoluteAppUrl("/browse/API-5", project)).toBe("https://3x6th.github.io/taska-ui/#/browse/API-5");
    });
  });

  describe("browser routing (the dev and e2e servers)", () => {
    const dev = { origin: "http://localhost:5173", base: "/", mode: "browser" } as const;

    it("makes the route the path, with no hash", () => {
      expect(absoluteAppUrl(issueKeyRoute("API-5"), dev)).toBe("http://localhost:5173/browse/API-5");
      expect(absoluteAppUrl(issueRoute(PROJECT, ISSUE), dev)).toBe(
        `http://localhost:5173/projects/${PROJECT}/issues/${ISSUE}`,
      );
    });

    it("keeps a base path, without doubling its slash", () => {
      expect(absoluteAppUrl("/browse/API-5", { ...dev, base: "/sub/" })).toBe("http://localhost:5173/sub/browse/API-5");
    });

    it("accepts a route written without its leading slash", () => {
      expect(absoluteAppUrl("browse/API-5", dev)).toBe("http://localhost:5173/browse/API-5");
    });
  });
});

describe("issueKeyRoute", () => {
  it("escapes a key the way the global search already links it", () => {
    expect(issueKeyRoute("TAS-101")).toBe("/browse/TAS-101");
    expect(issueKeyRoute("A B/1")).toBe("/browse/A%20B%2F1");
  });
});
