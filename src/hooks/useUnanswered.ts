import { useState } from "react";

/** The three fields of a react-query result this reads. Narrowed by hand so the
 *  hook does not have to be generic over `UseQueryResult`'s status union. */
export interface QueryFacts {
  data: unknown;
  error: Error | null;
  errorUpdateCount: number;
}

export interface Unanswered {
  /** The read has failed and there is still nothing to show for it. */
  unanswered: boolean;
  /** The failure to report, kept across the refetch that clears `error`. */
  error: Error | null;
}

/**
 * "This read failed and we still have nothing" — the one fact a screen may
 * gate both its wording and its behaviour on.
 *
 * The naive version, `query.isError`, is wrong in both directions, and both
 * were seen on the board:
 *
 * - **It goes false while nothing has arrived.** A query whose `data` is
 *   `undefined` is reset to `status:"pending", error:null` at the *start* of
 *   every refetch (`fetchState` in query-core/query.js). So on each refocus the
 *   explanation vanished for the length of the request while the controls it
 *   was explaining stayed switched off — the board went quietly read-only
 *   again, which is the TAS-163 symptom itself.
 * - **It goes true while everything is on screen.** A background refetch that
 *   fails sets `status:"error"` with the previous `data` retained, so the same
 *   flag claimed writes were off while New, the column `+` buttons and the drop
 *   targets were all live.
 *
 * `errorUpdateCount` is the counter that only ever increases (the `error`
 * branch of the same reducer; nothing decrements it), so pairing it with the
 * absence of `data` gives one fact instead of two independent facets: no data
 * *and* at least one failed attempt. Loading is neither — on a first visit the
 * count is 0, so nothing is claimed while the request is in flight.
 *
 * `error` is remembered for the same reason: react-query nulls it at the start
 * of each refetch, and a banner that keeps its sentence while dropping the
 * gateway's message and request id underneath it is a banner that changes
 * height on a timer.
 */
export function useUnanswered(query: QueryFacts): Unanswered {
  // Adjusting state during render, the sanctioned pattern: React re-renders
  // this component immediately and commits once. An effect would paint the
  // shorter banner first and then grow it.
  const [lastError, setLastError] = useState<Error | null>(null);
  if (query.error && query.error !== lastError) setLastError(query.error);

  return {
    unanswered: query.data === undefined && query.errorUpdateCount > 0,
    error: query.error ?? lastError,
  };
}
