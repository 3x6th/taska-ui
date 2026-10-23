import { QueryClient, type Query } from "@tanstack/react-query";
import { keepSignedAvatarLink, ME_QUERY_KEY } from "./ownAvatarLink";

/**
 * How long an answer is fresh: a remount within it reads the cache and asks
 * nothing. The bell's open re-reads past it (DESIGN.md §4.12).
 */
export const STALE_TIME_MS = 20_000;

/**
 * The focus policy (TAS-202, DESIGN.md §6): coming back to the tab re-reads
 * **only the reads that failed**, so a failed read heals on return and a
 * screen that loaded costs nothing. Every successful read stays as it was;
 * other people's changes arrive with navigation, with the reader's own writes
 * and with a reload, and the bell re-reads its inbox when it is opened.
 *
 * What it costs: a screen left open over a long absence is stale until one of
 * those happens, and an expired session is found on the next interaction
 * rather than on return. Before it, every query on a screen was re-read on
 * every return past `staleTime` — 2N + 3 requests on `/projects` with N
 * projects.
 *
 * A query that states its own `refetchOnWindowFocus` keeps it — `GET /meta`
 * never re-reads, the Telegram link in Settings → Notifications always does.
 */
export const refetchFailedOnFocus = (query: Query) => query.state.status === "error";

/**
 * The one query client this app runs on, and the one the request-count test
 * runs on (src/screens/ScreenRequests.test.tsx), so the policy the test pins
 * is the policy the page has rather than a copy of it.
 */
export function createQueryClient(): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: STALE_TIME_MS,
        retry: 1,
        refetchOnWindowFocus: refetchFailedOnFocus,
      },
    },
  });
  // On the key rather than at each `useQuery(["me"])`, so every reader of the
  // account — five screens, the members dialog's `fetchQuery`, the login form's
  // `setQueryData` — keeps the reader's avatar link the same way (TAS-223).
  queryClient.setQueryDefaults(ME_QUERY_KEY, { structuralSharing: keepSignedAvatarLink });
  return queryClient;
}
