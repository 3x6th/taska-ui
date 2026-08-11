import { Copy } from "lucide-react";
import { isMissingOrForbidden } from "../../api/errors";
import { useCopied } from "./useCopied";

/**
 * These four cases read very differently to the person looking at them, and
 * conflating them wastes the one reader who can act: a refusal is about this
 * account or this table, a rejected request is about what was asked for, a
 * server error is the gateway's own problem and worth reporting with its
 * request id, and only a genuine transport failure is "could not be reached".
 *
 * The fourth is the one that swallows the others when a branch is missing, and
 * it is the most expensive: "the API could not be reached" is a claim about the
 * infrastructure, and it gets escalated as an outage. This screen has already
 * made that mistake once with 5xx (docs/ai/API-DIVERGENCE.md); since TAS-103
 * the gateway validates filter operators and values by type, so a 400 is the
 * designed answer to a mistyped number rather than a rarity.
 */
export function AdminError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const refused = isMissingOrForbidden(error);
  const status = error instanceof Error ? (error as { status?: unknown }).status : undefined;
  const code = error instanceof Error ? (error as { code?: unknown }).code : undefined;
  const serverBroke = typeof status === "number" && status >= 500;
  // Status from the REST implementation, code from the mock — the two error
  // classes are unrelated (src/api/errors.ts), and both have to reach the same
  // four sentences or mock and rest stop being interchangeable on screen.
  const rejected = (typeof status === "number" && status >= 400 && status < 500) || code === "INVALID_ARGUMENT";
  // Every error response carries X-Request-Id, and the gateway exposes it
  // cross-origin — confirmed on a live 500. This area's audience is the one
  // person who will go and read the gateway log, so it is the one place where
  // showing it earns its space (§5.8).
  const requestId = error instanceof Error ? (error as { requestId?: unknown }).requestId : undefined;
  return (
    <div className="admin-note" role="alert">
      <p>
        {refused
          ? "The server refused this. Either this account is not a global admin as far as the gateway is concerned, or the table is not one it will serve."
          : serverBroke
            ? "The gateway failed while reading this table. Nothing is wrong with what was asked for — this is a fault on the server, and the request id below is what identifies it in the gateway log."
            : rejected
              ? "The gateway would not accept this request. Nothing is down: it read what was asked for and refused it, and what to change is in its own words below."
              : "The read-only admin API could not be reached."}
      </p>
      {error instanceof Error && error.message ? <p className="admin-error-detail">{error.message}</p> : null}
      {typeof requestId === "string" && requestId ? <RequestId value={requestId} /> : null}
      <button className="secondary-button" onClick={onRetry} type="button">
        Try again
      </button>
    </div>
  );
}

/**
 * The id is going somewhere else — a gateway log, a message to the backend —
 * so it is copied by clicking it rather than selected by hand (§5.8). It stays
 * readable as text either way: the button carries the id itself, so a browser
 * without clipboard permission loses the convenience, not the value.
 */
function RequestId({ value }: { value: string }) {
  const [copyState, copy] = useCopied();

  return (
    <p className="admin-error-detail admin-request-id-line">
      <span>Request ID:</span>
      <button
        aria-label={`Copy request id ${value}`}
        className="admin-request-id"
        onClick={() => copy(value)}
        type="button"
      >
        {value}
        <Copy aria-hidden="true" size={14} />
      </button>
      {/* A live region rather than a tooltip: the answer is the only evidence
          the click did anything, and it has to reach a screen reader as well as
          an eye. A refused clipboard says so instead of saying nothing —
          silence here is indistinguishable from a dead button, and the id
          itself is still on screen to select by hand. */}
      <span className="admin-copied" role="status">
        {copyState === "copied" ? "Copied" : copyState === "failed" ? "Couldn’t copy" : ""}
      </span>
    </p>
  );
}
