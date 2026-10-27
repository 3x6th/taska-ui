import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { PROJECT_STATS_KEY } from "./boardQuery";

/**
 * Every cached read that names people by the name their account carries
 * (TAS-425): a project's members and the board's context, the project cards'
 * member previews, the board's assignees, an issue's people, its comments'
 * authors and its work log's (each entry carries its author's name since
 * backend TAS-421, and `personFor` prefers it), the people directory and the
 * admin Users list. The server joins the profile into each of them when it is
 * asked, so after a rename each is simply asked again.
 *
 * Invalidation only — nothing is read here. A query on screen is re-read by
 * react-query as invalidation always does; one that is not is marked stale and
 * read when a screen next asks for it, which it would have done anyway.
 */
const PEOPLE_NAME_QUERY_KEYS: readonly QueryKey[] = [
  ["members"],
  ["project-context"],
  PROJECT_STATS_KEY,
  ["board"],
  ["issue"],
  ["comments"],
  // `issueWorklogsKey`'s first segment (src/components/issueWorklogsQuery.ts).
  ["worklogs"],
  ["user-directory"],
  ["admin", "users"],
];

export function invalidatePeopleNames(queryClient: QueryClient): void {
  for (const queryKey of PEOPLE_NAME_QUERY_KEYS) void queryClient.invalidateQueries({ queryKey });
}
