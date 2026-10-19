import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureInviteLink,
  forgetInviteToken,
  heldInviteToken,
  inviteRouteUrl,
  inviteTokenFromInput,
  inviteTokenIn,
  subscribeInviteToken,
} from "./inviteLink";

const TOKEN = "Lk3vQ9xW2mTz8RbN4cYp7HfJ1sDg6EaU5oKiVwXqZrM";

/** A page as `captureInviteLink` sees it, with the address bar it would write recorded. */
function landing(search: string, hash = "") {
  const replaceState = vi.fn();
  return { page: { location: { search, hash }, history: { replaceState } }, replaceState };
}

afterEach(() => {
  forgetInviteToken();
});

/**
 * The email's link is `<accept-url>?token=…` (backend #204), and on the Pages
 * build the router reads only the hash — so the token has to be taken before
 * the router mounts, in either mode and on any path (DESIGN.md §4.27).
 */
describe("captureInviteLink", () => {
  it("takes the token from the query on the hash build, and lands on #/invite with no token left", () => {
    const { page, replaceState } = landing(`?token=${TOKEN}`);

    expect(captureInviteLink(page, "/", "hash")).toBe(true);

    expect(heldInviteToken()).toBe(TOKEN);
    expect(replaceState).toHaveBeenCalledWith(null, "", "/#/invite");
  });

  it("takes it from the query inside the hash, on any route", () => {
    const { page, replaceState } = landing("", `#/login?token=${TOKEN}`);

    expect(captureInviteLink(page, "/taska-ui/", "hash")).toBe(true);

    expect(heldInviteToken()).toBe(TOKEN);
    expect(replaceState).toHaveBeenCalledWith(null, "", "/taska-ui/#/invite");
  });

  it("lands on the path route in browser mode, whatever path the link named", () => {
    const { page, replaceState } = landing(`?token=${TOKEN}&utm=mail`);

    expect(captureInviteLink(page, "/", "browser")).toBe(true);

    expect(replaceState).toHaveBeenCalledWith(null, "", "/invite");
  });

  it("leaves an address with no token, or a blank one, alone", () => {
    for (const [search, hash] of [
      ["", ""],
      ["?page=2", "#/projects"],
      ["?token=", ""],
      ["?token=%20%20", "#/invite?token="],
    ]) {
      const { page, replaceState } = landing(search, hash);
      expect(captureInviteLink(page, "/", "hash")).toBe(false);
      expect(replaceState).not.toHaveBeenCalled();
    }
    expect(heldInviteToken()).toBeNull();
  });

  it("tells a subscriber when a token arrives and when it is forgotten", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeInviteToken(listener);
    const { page } = landing(`?token=${TOKEN}`);

    captureInviteLink(page, "/", "hash");
    forgetInviteToken();
    // Forgetting nothing says nothing.
    forgetInviteToken();
    unsubscribe();

    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("inviteTokenIn and inviteRouteUrl", () => {
  it("prefers the page's own query to the one in the hash", () => {
    expect(inviteTokenIn({ search: "?token=first", hash: "#/invite?token=second" })).toBe("first");
  });

  it("builds /invite under the base in both schemes", () => {
    expect(inviteRouteUrl("/", "hash")).toBe("/#/invite");
    expect(inviteRouteUrl("/repo", "hash")).toBe("/repo/#/invite");
    expect(inviteRouteUrl("/", "browser")).toBe("/invite");
  });
});

/**
 * A pasted invitation link is accepted (§4.27): sent whole, the server would
 * answer "Invite token is too long" — about the format, not about the link.
 */
describe("inviteTokenFromInput", () => {
  it.each([
    ["the Pages link", `https://taska.ozero.dev/?token=${TOKEN}`],
    ["a hash-route link", `https://taska.ozero.dev/#/invite?token=${TOKEN}`],
    ["a link with spaces around it", `  http://localhost:3001/login?token=${TOKEN} `],
    ["the token itself", ` ${TOKEN} `],
  ])("reads %s as the token", (_case, value) => {
    expect(inviteTokenFromInput(value)).toBe(TOKEN);
  });

  it("keeps a URL with no token as typed, for the server to judge", () => {
    expect(inviteTokenFromInput("https://taska.ozero.dev/#/projects")).toBe("https://taska.ozero.dev/#/projects");
  });
});
