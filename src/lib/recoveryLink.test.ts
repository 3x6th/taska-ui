import { afterEach, describe, expect, it, vi } from "vitest";
import { captureInviteLink, forgetInviteToken, heldInviteToken } from "./inviteLink";
import {
  captureRecoveryLink,
  forgetRecoveryToken,
  heldRecoveryToken,
  recoveryRouteUrl,
  recoveryTokenOf,
  subscribeRecoveryToken,
} from "./recoveryLink";

const TOKEN = "734qwQC1pVarpZcKWJqanuMK2lp1-u61hNRvhIQr9Qc";

/** A page as the two captures see it: the path, the query, the hash — and the address bar they write, recorded. */
function landing(pathname: string, search: string, hash = "") {
  const location = { pathname, search, hash };
  const replaceState = vi.fn((_state: unknown, _title: string, url: string) => {
    const parsed = new URL(url, "http://localhost");
    location.pathname = parsed.pathname;
    location.search = parsed.search;
    location.hash = parsed.hash;
  });
  return { page: { location, history: { replaceState } }, replaceState };
}

afterEach(() => {
  forgetRecoveryToken();
  forgetInviteToken();
});

/**
 * The recovery link — `{base}reset-password?token=…`, a real path (ask A99) —
 * is taken before the router mounts and before the invitation's capture, which
 * would read its `?token=` as an invitation's (TAS-527, api-contract-guard F2).
 */
describe("captureRecoveryLink", () => {
  it("takes the token on the path, holds it in memory, and lands on the route with no token left — both schemes", () => {
    const hash = landing("/reset-password", `?token=${TOKEN}`);
    expect(captureRecoveryLink(hash.page, "/", "hash")).toBe(true);
    expect(heldRecoveryToken()).toBe(TOKEN);
    expect(hash.replaceState).toHaveBeenCalledWith(null, "", "/#/reset-password");

    forgetRecoveryToken();
    const browser = landing("/reset-password/", `?token=${TOKEN}&utm=mail`);
    expect(captureRecoveryLink(browser.page, "/", "browser")).toBe(true);
    expect(heldRecoveryToken()).toBe(TOKEN);
    expect(browser.replaceState).toHaveBeenCalledWith(null, "", "/reset-password");
  });

  it("only at the base, and only that path", () => {
    expect(captureRecoveryLink(landing("/repo/reset-password", `?token=${TOKEN}`).page, "/repo/", "hash")).toBe(true);
    for (const [path, base] of [
      ["/login", "/"],
      ["/reset-passwords", "/"],
      ["/c/x/reset-password", "/"],
      ["/reset-password", "/repo/"],
      ["/", "/"],
    ]) {
      forgetRecoveryToken();
      const { page, replaceState } = landing(path, `?token=${TOKEN}`);
      expect(captureRecoveryLink(page, base, "browser"), path).toBe(false);
      expect(replaceState).not.toHaveBeenCalled();
      expect(heldRecoveryToken()).toBeNull();
    }
  });

  it("on the path with no token, the address still becomes the route — with nothing held", () => {
    const { page, replaceState } = landing("/reset-password", "?token=");
    expect(captureRecoveryLink(page, "/", "hash")).toBe(true);
    expect(heldRecoveryToken()).toBeNull();
    expect(replaceState).toHaveBeenCalledWith(null, "", "/#/reset-password");
  });

  it("runs before the invitation's capture, which then finds nothing — and nothing is stored anywhere", () => {
    const { page } = landing("/reset-password", `?token=${TOKEN}`);
    captureRecoveryLink(page, "/", "hash");
    expect(captureInviteLink(page, "/", "hash")).toBe(false);
    expect(heldInviteToken()).toBeNull();
    expect(heldRecoveryToken()).toBe(TOKEN);
    expect(JSON.stringify({ ...window.localStorage })).not.toContain(TOKEN);
    expect(JSON.stringify({ ...window.sessionStorage })).not.toContain(TOKEN);
  });

  it("tells a subscriber when the token comes and goes", () => {
    const listener = vi.fn();
    const off = subscribeRecoveryToken(listener);
    captureRecoveryLink(landing("/reset-password", `?token=${TOKEN}`).page, "/", "browser");
    forgetRecoveryToken();
    forgetRecoveryToken();
    off();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("builds the route and reads a token as the invitation's capture does", () => {
    expect(recoveryRouteUrl("/repo", "hash")).toBe("/repo/#/reset-password");
    expect(recoveryRouteUrl("/repo/", "browser")).toBe("/repo/reset-password");
    expect(recoveryTokenOf(`?token=%20${TOKEN}%20`)).toBe(TOKEN);
    expect(recoveryTokenOf("?token=")).toBeNull();
  });
});
