import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureOAuthCallback,
  exchangeOnce,
  forgetOAuthAttempt,
  forgetOAuthCallback,
  heldOAuthCallback,
  oauthCallbackRouteUrl,
  readOAuthAttempt,
  rememberOAuthAttempt,
  type CallbackLandingWindow,
} from "./oauthCallback";

/** A landing page as `captureOAuthCallback` sees it, with the address it is replaced by recorded. */
function landing(pathname: string, search: string): CallbackLandingWindow & { replaced: string[] } {
  const replaced: string[] = [];
  return {
    location: { pathname, search },
    history: { replaceState: (_data: unknown, _unused: string, url?: string | URL | null) => replaced.push(String(url)) },
    replaced,
  };
}

/**
 * The provider sign-in's return (TAS-426, DESIGN.md §4.31): the code taken out
 * of the address before the router mounts — only on the callback path — and
 * exchanged once whatever React does.
 */
describe("captureOAuthCallback", () => {
  afterEach(() => {
    forgetOAuthCallback();
  });

  it.each([
    ["/auth/callback", "browser", "/", "/auth/callback"],
    ["/auth/callback/", "browser", "/", "/auth/callback"],
    ["/auth/callback", "hash", "/", "/#/auth/callback"],
    ["/auth/callback/", "hash", "/", "/#/auth/callback"],
    ["/auth/callback", "hash", "/taska-ui/", "/taska-ui/#/auth/callback"],
  ] as const)("takes the code on %s and replaces the address with the %s route under %s", (path, mode, base, route) => {
    const page = landing(path, "?code=one-time-code");

    expect(captureOAuthCallback(page, base, mode)).toBe(true);

    expect(heldOAuthCallback()).toEqual({ code: "one-time-code" });
    expect(page.replaced).toEqual([route]);
    expect(page.replaced[0]).not.toContain("code");
  });

  it("takes the error, which wins over a code an edited address also carries", () => {
    const page = landing("/auth/callback", "?code=abc&error=ACCOUNT_BLOCKED");
    captureOAuthCallback(page, "/", "hash");
    expect(heldOAuthCallback()).toEqual({ error: "ACCOUNT_BLOCKED" });
  });

  it("holds nothing for a landing with neither, and still leaves the address for the in-app route", () => {
    const page = landing("/auth/callback/", "");
    expect(captureOAuthCallback(page, "/", "hash")).toBe(true);
    expect(heldOAuthCallback()).toBeNull();
    expect(page.replaced).toEqual(["/#/auth/callback"]);
  });

  it.each(["/", "/login", "/projects", "/auth/callbacks", "/x/auth/callback", "/auth"])(
    "never takes ?code= on another path (%s)",
    (path) => {
      const page = landing(path, "?code=abc");
      expect(captureOAuthCallback(page, "/", "hash")).toBe(false);
      expect(heldOAuthCallback()).toBeNull();
      expect(page.replaced).toEqual([]);
    },
  );

  it("builds the in-app route for both schemes, with or without the base's slash", () => {
    expect(oauthCallbackRouteUrl("/", "hash")).toBe("/#/auth/callback");
    expect(oauthCallbackRouteUrl("/base", "hash")).toBe("/base/#/auth/callback");
    expect(oauthCallbackRouteUrl("/", "browser")).toBe("/auth/callback");
  });
});

describe("exchangeOnce", () => {
  it("asks once for a code however many times it is asked for, and again only after it settled", async () => {
    let release: (value: string) => void = () => {};
    const exchange = vi.fn(() => new Promise<string>((resolve) => (release = resolve)));

    const first = exchangeOnce("code-1", exchange);
    const second = exchangeOnce("code-1", exchange);
    expect(second).toBe(first);
    expect(exchange).toHaveBeenCalledTimes(1);

    release("signed in");
    await expect(first).resolves.toBe("signed in");
    await expect(second).resolves.toBe("signed in");

    // Settled: the flight is gone, and nobody holds the code any more.
    void exchangeOnce("code-1", exchange);
    expect(exchange).toHaveBeenCalledTimes(2);
  });

  it("keeps a refusal to the one request too, and keys the flight by code", async () => {
    const exchange = vi.fn((code: string) => Promise.reject(new Error(`refused ${code}`)));
    const first = exchangeOnce("code-a", exchange);
    const again = exchangeOnce("code-a", exchange);
    const other = exchangeOnce("code-b", exchange);
    await expect(first).rejects.toThrow("refused code-a");
    await expect(again).rejects.toThrow("refused code-a");
    await expect(other).rejects.toThrow("refused code-b");
    expect(exchange).toHaveBeenCalledTimes(2);
  });
});

describe("the remembered attempt", () => {
  afterEach(() => {
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("keeps the provider and the tab in sessionStorage, and forgets them", () => {
    rememberOAuthAttempt({ provider: "GITHUB", tab: "signup" });
    expect(JSON.parse(window.sessionStorage.getItem("taska.oauthAttempt")!)).toEqual({ provider: "GITHUB", tab: "signup" });
    expect(readOAuthAttempt()).toEqual({ provider: "GITHUB", tab: "signup" });
    forgetOAuthAttempt();
    expect(readOAuthAttempt()).toBeNull();
  });

  it("reads anything that is not the shape as no attempt, and survives storage that refuses", () => {
    window.sessionStorage.setItem("taska.oauthAttempt", "{");
    expect(readOAuthAttempt()).toBeNull();
    window.sessionStorage.setItem("taska.oauthAttempt", JSON.stringify({ provider: 1 }));
    expect(readOAuthAttempt()).toBeNull();

    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(() => rememberOAuthAttempt({ provider: "GOOGLE", tab: "signin" })).not.toThrow();
    expect(readOAuthAttempt()).toBeNull();
  });
});
