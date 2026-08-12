import { apiErrorFacts, isMissingOrForbidden } from "../../api/errors";
import { RequestId } from "../../components/RequestId";

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
  // Status from the REST implementation, code from the mock — the two error
  // classes are unrelated, which is why one shared reader (src/api/errors.ts)
  // pulls both: either half alone leaves one API mode with nothing to say, and
  // the four sentences below stop being interchangeable on screen.
  const { message, requestId, status, code } = apiErrorFacts(error);
  const serverBroke = status !== null && status >= 500;
  const rejected = (status !== null && status >= 400 && status < 500) || code === "INVALID_ARGUMENT";
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
      {message ? <p className="admin-error-detail">{message}</p> : null}
      {/* Every error response carries X-Request-Id, and the gateway exposes it
          cross-origin — confirmed on a live 500. This area's audience is the
          one person who will go and read the gateway log, so it is where
          showing it earns its space (§5.8). The affordance itself is shared
          with the board (`src/components/RequestId.tsx`); the line around it
          keeps this block's own type. */}
      {requestId ? (
        <p className="admin-error-detail">
          <RequestId value={requestId} />
        </p>
      ) : null}
      <button className="secondary-button" onClick={onRetry} type="button">
        Try again
      </button>
    </div>
  );
}
