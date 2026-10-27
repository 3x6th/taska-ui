import { queryOptions } from "@tanstack/react-query";
import { taskaApi } from "../api/client";
import { isMissingOrForbidden, isUndeployedRoute } from "../api/errors";
import { UNDEPLOYED_ROUTE_MESSAGE } from "../api/TaskaApi";
import { isTypeOperationPending } from "../lib/workflows";

/**
 * The cache key of a project's workflow list (TAS-382, backend PR #208). Every
 * workflow write settles through it — and through `projectContextKey`, which
 * is where the board reads its columns and moves from.
 */
export const projectWorkflowsKey = (projectId: string) => ["project-workflows", projectId] as const;

/**
 * The Workflows dialog's read. The work log's retry rule (`issueWorklogsOptions`):
 * no second asking for the answers that will not change on one — the gateway
 * not serving the route yet, a refusal, and a type operation of the project
 * still being applied (409 `ABORTED` `ISSUE_TYPE_OPERATION_PENDING`, backend
 * TAS-436), which the dialog says and asks the reader to reopen after (§4.28)
 * — and the app's one retry for everything else.
 */
export function projectWorkflowsOptions(projectId: string) {
  return queryOptions({
    queryKey: projectWorkflowsKey(projectId),
    queryFn: () => taskaApi.listProjectWorkflows(projectId),
    retry: (failureCount: number, error: Error) =>
      !isUndeployedRoute(error, UNDEPLOYED_ROUTE_MESSAGE) &&
      !isMissingOrForbidden(error) &&
      !isTypeOperationPending(error) &&
      failureCount < 1,
  });
}
