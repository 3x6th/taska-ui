import { apiErrorFacts, refusalCode, refusalRetryAfter } from "../api/errors";
import { formatWait } from "./authText";
import { retryAfterSeconds } from "./admin/users";

/*
 * What a refused «Create company» means (TAS-501, DESIGN.md §4.36 «Отказы»,
 * api-contract-guard §3 and §5), as one pure function: the sentence, whether
 * the server's own words and the request id go under it, and — the part that
 * matters for idempotency — whether the attempt is **closed** (the next press
 * mints a new key) or **still open** (the same key, the same body, the fields
 * locked). A refusal never draws a company.
 */

export type CreationRefusalKind =
  /** 409 FREE_ELIGIBILITY_USED: the free row turns «used», the choice is cleared. */
  | "free-used"
  /** 400 VALIDATION_FAILED: the name or the plan — the server does not say which (ask A13); the catalogue is read again. */
  | "name-or-plan"
  /** 404 TENANT_NOT_FOUND on a replay: the company the key made is gone. */
  | "gone"
  /** Any other definitive refusal: 403, 409 IDEMPOTENCY_CONFLICT, 422, a code outside the dictionary. */
  | "refused"
  /** 429: the same key after the wait. */
  | "too-many"
  /** 503 POLICY_NOT_CONFIGURED / DEPENDENCY_UNAVAILABLE: the same key later. */
  | "unavailable"
  /** 5xx, 408, 401, no answer at all: the outcome is unknown — the same key, it creates nothing twice. */
  | "unknown";

export interface CreationRefusal {
  kind: CreationRefusalKind;
  /** Closed: the record goes, the fields unlock, the next press is a new attempt with a new key. */
  closesAttempt: boolean;
  text: string;
  /** The server's words — only where §4.36 says so (a backend title may say «tenant», §4.33 «Слово»). */
  serverWords: string | null;
  requestId: string | null;
}

export const CREATION_REFUSED_TEXT = "This company was not created.";
export const CREATION_NAME_OR_PLAN_TEXT = "Taska didn’t accept this name or plan. Check the name, or choose the plan again.";
export const CREATION_UNAVAILABLE_TEXT = "Taska can’t create a company right now. Try again later.";
export const CREATION_UNKNOWN_TEXT = "Taska couldn’t confirm the company was created. Try again — it won’t create a second one.";
export const CREATION_GONE_TEXT = "That company no longer exists.";

export function creationRefusal(error: unknown): CreationRefusal {
  const { status, code, message, requestId } = apiErrorFacts(error);
  const b2b = refusalCode(error) ?? code;
  const closed = (kind: CreationRefusalKind, text: string): CreationRefusal => ({
    kind,
    closesAttempt: true,
    text,
    serverWords: null,
    requestId,
  });
  const open = (kind: CreationRefusalKind, text: string, serverWords: string | null = null): CreationRefusal => ({
    kind,
    closesAttempt: false,
    text,
    serverWords,
    requestId,
  });

  if (status === 429 || b2b === "RATE_LIMITED") {
    const seconds = refusalRetryAfter(error) ?? retryAfterSeconds(error);
    return open("too-many", `Too many attempts. Try again in ${formatWait(seconds)}.`);
  }
  if (b2b === "POLICY_NOT_CONFIGURED" || b2b === "DEPENDENCY_UNAVAILABLE") return open("unavailable", CREATION_UNAVAILABLE_TEXT);
  // No answer, a server failure, a timeout, or a 401 the session layer could
  // not repair: nothing says whether the company exists — the same key asks.
  if (status === null || status >= 500 || status === 408 || status === 401) {
    return open("unknown", CREATION_UNKNOWN_TEXT, status === null ? null : message);
  }
  if (b2b === "FREE_ELIGIBILITY_USED") return closed("free-used", CREATION_REFUSED_TEXT);
  if (b2b === "VALIDATION_FAILED") return closed("name-or-plan", CREATION_NAME_OR_PLAN_TEXT);
  if (b2b === "TENANT_NOT_FOUND") return closed("gone", CREATION_GONE_TEXT);
  return closed("refused", CREATION_REFUSED_TEXT);
}
