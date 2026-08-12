import { Copy } from "lucide-react";
import { useCopied } from "../hooks/useCopied";

/**
 * The gateway's `X-Request-Id` for a failure, offered for copying.
 *
 * The id is going somewhere else — a gateway log, a message to the backend —
 * so it is copied by clicking it rather than selected by hand (DESIGN.md §5.8).
 * It stays readable as text either way: the button carries the id itself, so a
 * browser without clipboard permission loses the convenience, not the value.
 *
 * Written once and shared by the admin console and the board rather than
 * reimplemented per screen: the honesty rules here (never claim "Copied" for a
 * refused clipboard, never answer a click with silence) are easy to get wrong,
 * and a second, weaker copy of them is how one screen ends up lying while the
 * other does not. It renders inline, with no colour or size of its own, so each
 * caller's own type carries it — the admin block sets 11.5px, the board's
 * one-line detail sets 11px, and neither needs a variant here.
 */
export function RequestId({ value }: { value: string }) {
  const [copyState, copy] = useCopied();

  return (
    <span className="request-id-line">
      <span>Request ID:</span>
      <button
        aria-label={`Copy request id ${value}`}
        className="request-id"
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
      <span className="copied-note" role="status">
        {copyState === "copied" ? "Copied" : copyState === "failed" ? "Couldn’t copy" : ""}
      </span>
    </span>
  );
}
