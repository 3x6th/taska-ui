import { useQuery } from "@tanstack/react-query";
import { taskaApi } from "../api/client";
import type { EnumDictionaries } from "../domain/types";

export const META_QUERY_KEY = ["meta"] as const;

/**
 * `GET /meta`, once per session (TAS-173). The dictionaries change only with a
 * gateway release, so the answer is never stale for the life of the page and
 * nothing refetches it — not a focus, not a reconnect, not a remount.
 * `queryClient.clear()` on sign-out and on an expired session is what drops it.
 *
 * `retryOnMount: false` is load-bearing. Every type chip and priority picker
 * reads this, and react-query re-asks a failed query for each observer that
 * mounts on it — so without it a `/meta` that failed would be asked again for
 * every card the board draws. A failure is silent (D5): every reader falls back
 * to the build's own words and sets, which is what the UI did before the route
 * existed.
 *
 * No `cache:` option on the request and no `If-None-Match` by hand: the route
 * answers with an `ETag` (`Cache-Control: no-cache, private`), so the browser
 * keeps the 200, revalidates it, and hands this code the stored body when the
 * server says 304 — the Fetch spec's default mode, not yet observed on the
 * stand. A conditional header set from JavaScript would make the 304 reach the
 * client as a failed request instead.
 */
export const metaQueryOptions = {
  queryKey: META_QUERY_KEY,
  queryFn: () => taskaApi.getMeta(),
  staleTime: Infinity,
  gcTime: Infinity,
  retryOnMount: false,
  refetchOnMount: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
} as const;

/** The dictionaries, or `undefined` while they are on the way or after they failed. */
export const useMeta = (): EnumDictionaries | undefined => useQuery(metaQueryOptions).data;
