import {
  useMutation as useQueryMutation,
  type DefaultError,
  type QueryClient,
  type UseMutationOptions,
  type UseMutationResult,
} from "@tanstack/react-query";
import { isWorkspaceClosed } from "../api/errors";

/**
 * react-query's `useMutation`, with one difference: a write whose answer
 * belongs to a company session the tab has left (`WorkspaceClosedError`,
 * TAS-500) runs neither `onError` nor `onSettled`. There is nothing to roll
 * back on screen — the company's tree and its query client have gone with the
 * session — and nothing to tell the reader: the shell says what happened, once
 * (DESIGN.md §4.35). Every mutation in the app is made with this one, so no
 * handler has to remember the check.
 *
 * In today's build the error never occurs and this is react-query's hook.
 */
export function useMutation<TData = unknown, TError = DefaultError, TVariables = void, TOnMutateResult = unknown>(
  options: UseMutationOptions<TData, TError, TVariables, TOnMutateResult>,
  queryClient?: QueryClient,
): UseMutationResult<TData, TError, TVariables, TOnMutateResult> {
  const { onError, onSettled } = options;
  // Only the handlers there are: an `undefined` key would shadow a default.
  return useQueryMutation(
    {
      ...options,
      ...(onError ? { onError: (error, ...rest) => (isWorkspaceClosed(error) ? undefined : onError(error, ...rest)) } : {}),
      ...(onSettled
        ? { onSettled: (data, error, ...rest) => (isWorkspaceClosed(error) ? undefined : onSettled(data, error, ...rest)) }
        : {}),
    },
    queryClient,
  );
}
