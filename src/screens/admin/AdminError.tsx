import { Copy } from "lucide-react";
import { isMissingOrForbidden } from "../../api/errors";
import { useCopied } from "./useCopied";

/**
 * These three cases read very differently to the person looking at them, and
 * conflating them wastes the one reader who can act: a refusal is about this
 * account or this table, a server error is the gateway's own problem and worth
 * reporting with its request id, and only a genuine transport failure is
 * "could not be reached".
 */
export function AdminError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const refused = isMissingOrForbidden(error);
  const status = error instanceof Error ? (error as { status?: unknown }).status : undefined;
  const serverBroke = typeof status === "number" && status >= 500;
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
  const [copied, copy] = useCopied();

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
      {/* A live region rather than a tooltip: the confirmation is the only
          evidence the click did anything, and it has to reach a screen reader
          as well as an eye. */}
      <span className="admin-copied" role="status">
        {copied ? "Copied" : ""}
      </span>
    </p>
  );
}
