import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { User } from "../domain/types";
import { keepSignedAvatarLink, ME_QUERY_KEY, OWN_AVATAR_LINK_REUSE_MS } from "./ownAvatarLink";

/**
 * `GET /users/me` signs a fresh avatar link on every read (TAS-223), so the
 * `["me"]` query keeps the one it holds while the avatar is the same one and
 * the link is young enough. Each case uses links of its own: the rule
 * remembers when a link was first adopted, by the link.
 */
describe("keeping the reader's own avatar link across re-reads", () => {
  const anna = (avatarUrl: string | null, avatarId: string | null, extra: Partial<User> = {}): User => ({
    id: "user-anna",
    login: "anna",
    email: "anna@example.com",
    displayName: "Anna Ivanova",
    status: "ACTIVE",
    avatarUrl,
    avatarId,
    ...extra,
  });

  it("keeps the held link for the same avatar inside the window, and the object itself when nothing else moved", () => {
    const start = 1_000_000;
    const first = keepSignedAvatarLink(undefined, anna("https://s/a.png?sig=same-1", "av-1"), start) as User;

    const again = keepSignedAvatarLink(first, anna("https://s/a.png?sig=same-2", "av-1"), start + 60_000);

    // Not merely an equal value: the same object, so nothing downstream re-renders.
    expect(again).toBe(first);
  });

  it("keeps the link but takes the rest of a changed answer", () => {
    const start = 2_000_000;
    const first = keepSignedAvatarLink(undefined, anna("https://s/a.png?sig=rest-1", "av-1"), start) as User;

    const renamed = keepSignedAvatarLink(
      first,
      anna("https://s/a.png?sig=rest-2", "av-1", { displayName: "Anna I." }),
      start + 60_000,
    ) as User;

    expect(renamed).toMatchObject({ displayName: "Anna I.", avatarUrl: "https://s/a.png?sig=rest-1" });
  });

  it("takes the new link once the held one is ten minutes old", () => {
    const start = 3_000_000;
    const first = keepSignedAvatarLink(undefined, anna("https://s/a.png?sig=old-1", "av-1"), start) as User;

    const later = keepSignedAvatarLink(
      first,
      anna("https://s/a.png?sig=old-2", "av-1"),
      start + OWN_AVATAR_LINK_REUSE_MS,
    ) as User;

    expect(later.avatarUrl).toBe("https://s/a.png?sig=old-2");
  });

  it("takes the new answer whole for a different avatar, a removal, or another account", () => {
    const start = 4_000_000;
    const first = keepSignedAvatarLink(undefined, anna("https://s/a.png?sig=id-1", "av-1"), start) as User;

    expect(keepSignedAvatarLink(first, anna("https://s/b.png?sig=id-2", "av-2"), start + 1)).toMatchObject({
      avatarUrl: "https://s/b.png?sig=id-2",
      avatarId: "av-2",
    });
    expect(keepSignedAvatarLink(first, anna(null, null), start + 1)).toMatchObject({ avatarUrl: null, avatarId: null });
    expect(
      keepSignedAvatarLink(first, anna("https://s/a.png?sig=id-3", "av-1", { id: "user-tom" }), start + 1),
    ).toMatchObject({ id: "user-tom", avatarUrl: "https://s/a.png?sig=id-3" });
  });

  it("takes a degraded answer whole: a failed profile read does not keep the held link", () => {
    // Backend PR #193: `avatar: null, avatarUnavailable: true` when the
    // gateway's profile read failed. Keeping the held picture would draw it
    // beside "could not be loaded", or hide that the read failed at all.
    const start = 5_000_000;
    const first = keepSignedAvatarLink(
      undefined,
      anna("https://s/a.png?sig=degraded-1", "av-1", { avatarUnavailable: false }),
      start,
    ) as User;
    const degraded = anna(null, null, { avatarUnavailable: true });

    const next = keepSignedAvatarLink(first, degraded, start + 60_000) as User;

    expect(next).toEqual(degraded);
    expect(next.avatarUrl).toBeNull();
  });

  it("adopts the next good answer's link after a degraded one, with the flag back to false", () => {
    const start = 6_000_000;
    const first = keepSignedAvatarLink(
      undefined,
      anna("https://s/a.png?sig=recover-1", "av-1", { avatarUnavailable: false }),
      start,
    ) as User;
    const degraded = keepSignedAvatarLink(first, anna(null, null, { avatarUnavailable: true }), start + 1) as User;

    const recovered = keepSignedAvatarLink(
      degraded,
      anna("https://s/a.png?sig=recover-2", "av-1", { avatarUnavailable: false }),
      start + 2,
    ) as User;

    // The new signature, not the one held before the failure: the degraded
    // answer broke the chain, so nothing was kept to return to.
    expect(recovered).toMatchObject({
      avatarUrl: "https://s/a.png?sig=recover-2",
      avatarId: "av-1",
      avatarUnavailable: false,
    });
  });

  it("does not keep a link it never saw adopted", () => {
    // A profile written straight into the cache by something that bypassed the
    // rule — the login form's `setQueryData` on a fresh client — has no known
    // age, so the next answer's link is drawn rather than one of unknown age.
    const unseen = anna("https://s/a.png?sig=unseen-1", "av-1");

    const next = keepSignedAvatarLink(unseen, anna("https://s/a.png?sig=unseen-2", "av-1")) as User;

    expect(next.avatarUrl).toBe("https://s/a.png?sig=unseen-2");
  });

  it("applies to every write of the key once set as its default, as main.tsx sets it", () => {
    const client = new QueryClient();
    client.setQueryDefaults(ME_QUERY_KEY, { structuralSharing: keepSignedAvatarLink });

    client.setQueryData(ME_QUERY_KEY, anna("https://s/a.png?sig=client-1", "av-1"));
    client.setQueryData(ME_QUERY_KEY, anna("https://s/a.png?sig=client-2", "av-1"));

    expect(client.getQueryData<User>(ME_QUERY_KEY)?.avatarUrl).toBe("https://s/a.png?sig=client-1");
  });
});
