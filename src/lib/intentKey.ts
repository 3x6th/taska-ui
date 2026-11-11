import { apiErrorFacts, isWorkspaceClosed } from "../api/errors";

/*
 * The key of an intent (TAS-502, api-contract-guard §4; since TAS-528 also
 * New issue's key per draft, H1): one `Idempotency-Key` per intent, sent
 * again only when the same intent is retried after an answer that never came
 * or said nothing about the request. Moved here from Settings › Members'
 * rules (TAS-528, art-director N2) so the board and `src/lib` do not import a
 * settings screen.
 */

/**
 * An answer that never came, or one that says nothing about the request: no
 * status, 408, 429 and 5xx. Its retry is the same intent and goes with the
 * same key and the same body (api-contract-guard §4); after anything else the
 * next press is a new intent with a new key.
 */
export function isIndefinite(error: unknown): boolean {
  if (isWorkspaceClosed(error)) return false;
  const { status } = apiErrorFacts(error);
  return status === null || status === 408 || status === 429 || status >= 500;
}

/** An intent sent, and whether its answer left it open — what `keyFor` reads. */
export interface SentIntent {
  signature: string;
  key: string;
  open: boolean;
}

const newKey = () =>
  globalThis.crypto?.randomUUID?.() ??
  "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));

/** The key for an intent: the previous one when the same intent is retried after an indefinite answer, else a fresh one. */
export function keyFor(previous: SentIntent | null, signature: string): string {
  return previous !== null && previous.open && previous.signature === signature ? previous.key : newKey();
}
