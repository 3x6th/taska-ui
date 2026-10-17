import { replaceEqualDeep } from "@tanstack/react-query";
import type { User } from "../domain/types";

/** The query every screen reads the signed-in account through. */
export const ME_QUERY_KEY = ["me"] as const;

/**
 * How long a link to the reader's own avatar is kept across re-reads of
 * `GET /users/me`: ten minutes, under the fifteen a presigned link lives on
 * auth-service's default `storage.presigned-url-ttl`. The TTL is an
 * env-overridable default on the server that nothing on this side can read, so
 * this is a margin against the default, not a guarantee. A link that expires
 * anyway under a screen left open is not re-signed on a timer: `Avatar` puts
 * the initials back, which §4.4 calls the ordinary state of a screen left open.
 */
export const OWN_AVATAR_LINK_REUSE_MS = 10 * 60 * 1000;

/**
 * When each link this page has drawn for the reader was first adopted. Keyed by
 * the link itself, so it holds nothing about a session — a link is a fact about
 * one signature, whoever is signed in — and pruned as it grows, so it never
 * holds more than the links of the last reuse window.
 */
const adoptedAt = new Map<string, number>();

function isUser(value: unknown): value is User {
  return typeof value === "object" && value !== null && "id" in value && "displayName" in value;
}

function adopt(link: string | null | undefined, now: number) {
  if (typeof link !== "string" || !link || adoptedAt.has(link)) return;
  for (const [known, at] of adoptedAt) {
    if (now - at >= OWN_AVATAR_LINK_REUSE_MS) adoptedAt.delete(known);
  }
  adoptedAt.set(link, now);
}

/**
 * The `structuralSharing` rule of the `["me"]` query (TAS-223), set once on the
 * page's query client (`main.tsx`).
 *
 * `GET /users/me` carries the reader's avatar since backend PR #193, and every
 * read signs a fresh link — the same picture under a new query string, which
 * the browser's cache never recognises. With the app's twenty-second stale time
 * and a refetch on every window focus, drawing each answer's link as it came
 * would download the reader's own face again on every focus. So when the
 * avatar's id is unchanged and the link already held is younger than
 * `OWN_AVATAR_LINK_REUSE_MS`, the held link stays and the `<img src>` with it.
 * A different id — an upload, a removal, another account — or an older link
 * takes the new answer whole.
 *
 * So does a **degraded** answer — `avatarUnavailable: true`, `avatar: null`
 * (backend PR #193): its `avatarId` is `null`, so the ids differ and the held
 * link is not kept across a failure the server reported. Keeping it would do
 * one of two wrong things: draw the picture beside "could not be loaded", or
 * swallow the signal so the menu never says so. The cost is that a
 * *transient* failure — auth-service slow for one read — shows initials until
 * the next good read adopts a link again, and that is the server's answer
 * being drawn as it is.
 *
 * This is cache handling of what the server said, not a compensation: the
 * server's link and the kept one point at the same object, and nothing here is
 * invented or read a second time. Everything else in the answer goes through
 * react-query's own `replaceEqualDeep`, as without the rule.
 */
export function keepSignedAvatarLink(previous: unknown, next: unknown, now = Date.now()): unknown {
  if (
    isUser(previous) &&
    isUser(next) &&
    previous.id === next.id &&
    typeof previous.avatarId === "string" &&
    previous.avatarId === next.avatarId &&
    typeof previous.avatarUrl === "string" &&
    typeof next.avatarUrl === "string"
  ) {
    const since = adoptedAt.get(previous.avatarUrl);
    if (since !== undefined && now - since < OWN_AVATAR_LINK_REUSE_MS) {
      return replaceEqualDeep(previous, { ...next, avatarUrl: previous.avatarUrl });
    }
  }
  if (isUser(next)) adopt(next.avatarUrl, now);
  return replaceEqualDeep(previous, next);
}
