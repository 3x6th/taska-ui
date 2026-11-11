import { useMemo, useRef } from "react";
import { apiErrorFacts } from "../api/errors";
import { newIdempotencyKey } from "../api/tenantCreation";

/**
 * One `Idempotency-Key` per press-intent (TAS-527, the orchestrator's
 * decision 7, api-contract-guard Q4/Q5): a press whose answer never came — no
 * HTTP status — is retried by the next press with **the same key and the same
 * body**, so the server answers it once; any answer with a status, any edit,
 * «Start over» or «Send again» makes the next press a new intent with a new
 * key. The body is compared, in memory, as the exact string that was sent:
 * pressed again with anything changed, it is a new key.
 *
 * In memory only, like the form's fields, and gone with the component.
 */
export function usePressKeys() {
  const pending = useRef<{ key: string; body: string } | null>(null);
  return useMemo(
    () => ({
      /** The key for a press sending `body`: the lost press's, when nothing answered it and the body is the same; else a new one. */
      take(body: unknown): string {
        const sent = JSON.stringify(body);
        const held = pending.current;
        if (held !== null && held.body === sent) return held.key;
        const key = newIdempotencyKey();
        pending.current = { key, body: sent };
        return key;
      },
      /** The press was answered — a success, or a refusal with a status: the next press is a new intent. */
      answered(error?: unknown): void {
        if (error === undefined || apiErrorFacts(error).status !== null) pending.current = null;
      },
      /** An edit, «Start over», «Send again»: a new intent, whatever came back before. */
      drop(): void {
        pending.current = null;
      },
    }),
    [],
  );
}
