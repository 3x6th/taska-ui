import { queryOptions } from "@tanstack/react-query";
import { taskaApi } from "../api/client";
import { isMissingOrForbidden, isUndeployedRoute } from "../api/errors";
import { UNDEPLOYED_ROUTE_MESSAGE } from "../api/TaskaApi";

/** The cache key of an issue's work log. Every worklog write settles through it. */
export const issueWorklogsKey = (projectId: string, issueId: string) => ["worklogs", projectId, issueId] as const;

/**
 * The work log read (TAS-251, backend PR #178), shared by the panel — which
 * starts it beside the issue read, so it costs no round of its own — and the
 * section that draws it.
 *
 * No retry for the two answers that will not change on a second asking: the
 * gateway not serving the route yet (the static-resource 404, until #178
 * deploys) and a refusal. Everything else keeps the app's one retry.
 */
export function issueWorklogsOptions(projectId: string, issueId: string) {
  return queryOptions({
    queryKey: issueWorklogsKey(projectId, issueId),
    queryFn: () => taskaApi.listIssueWorklogs(projectId, issueId),
    retry: (failureCount: number, error: Error) =>
      !isUndeployedRoute(error, UNDEPLOYED_ROUTE_MESSAGE) && !isMissingOrForbidden(error) && failureCount < 1,
  });
}
