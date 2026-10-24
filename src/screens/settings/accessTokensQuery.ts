import { queryOptions } from "@tanstack/react-query";
import { taskaApi } from "../../api/client";
import { isMissingOrForbidden, isUndeployedRoute } from "../../api/errors";
import { UNDEPLOYED_ROUTE_MESSAGE } from "../../api/TaskaApi";

/**
 * The reader's tokens, keyed by account like their notification choices: one
 * account's tokens are never drawn under another's, whatever the cache still
 * holds. The list carries no secret — only `AccessToken`s are ever stored here.
 */
export const accessTokensKey = (userId: string) => ["access-tokens", userId] as const;

/**
 * `GET /users/me/access-tokens` (TAS-412). No retry for the two answers a
 * second asking will not change: the gateway not having the route yet (the
 * static-resource 404 of every gateway before TAS-402) and a refusal.
 */
export function accessTokensOptions(userId: string) {
  return queryOptions({
    queryKey: accessTokensKey(userId),
    queryFn: () => taskaApi.listAccessTokens(),
    retry: (failureCount: number, error: Error) =>
      !isUndeployedRoute(error, UNDEPLOYED_ROUTE_MESSAGE) && !isMissingOrForbidden(error) && failureCount < 1,
  });
}
