import { infiniteQueryOptions, type InfiniteData } from "@tanstack/react-query";
import { taskaApi } from "../api/client";
import { isMissingOrForbidden, isUndeployedRoute } from "../api/errors";
import { UNDEPLOYED_ROUTE_MESSAGE } from "../api/TaskaApi";
import type { IssueWorklogPage } from "../domain/types";

/** The cache key of an issue's work log. Every worklog write settles through it. */
export const issueWorklogsKey = (projectId: string, issueId: string) => ["worklogs", projectId, issueId] as const;

/**
 * Entries a page: the contract's ceiling (backend TAS-421). A work log longer
 * than this is rare, and the section then says so at its foot (DESIGN.md §4.24).
 */
export const WORKLOG_PAGE_SIZE = 100;

/** The work log as the cache holds it: the pages read so far, in order. */
export type IssueWorklogPages = InfiniteData<IssueWorklogPage, number>;

/**
 * The work log read (TAS-251; paged since backend TAS-421), shared by the panel
 * — which starts its first page beside the issue read, so it costs no round of
 * its own — and the section that draws it. The next page is asked for only
 * when the last one said `hasMore: true`; an unstated `hasMore` is never read as
 * "there is more" nor as "this is all".
 *
 * No retry for the two answers that will not change on a second asking: the
 * gateway not serving the route yet (the static-resource 404 of a gateway
 * that predates #178) and a refusal. Everything else keeps the app's one retry.
 */
export function issueWorklogsOptions(projectId: string, issueId: string) {
  return infiniteQueryOptions({
    queryKey: issueWorklogsKey(projectId, issueId),
    initialPageParam: 0,
    queryFn: ({ pageParam }) => taskaApi.listIssueWorklogs(projectId, issueId, { page: pageParam, pageSize: WORKLOG_PAGE_SIZE }),
    getNextPageParam: (lastPage, _pages, lastPageParam) => (lastPage.hasMore === true ? lastPageParam + 1 : undefined),
    retry: (failureCount: number, error: Error) =>
      !isUndeployedRoute(error, UNDEPLOYED_ROUTE_MESSAGE) && !isMissingOrForbidden(error) && failureCount < 1,
  });
}
