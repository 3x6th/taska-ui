import { X } from "lucide-react";
import type { ReactNode } from "react";
import { apiErrorFacts } from "../api/errors";
import { refusalWords } from "../lib/projectArchive";
import { RequestId } from "./RequestId";

/**
 * One failure, stated where it happened.
 *
 * DESIGN.md §5.6 asks for a toast carrying `error.message` and
 * `error.requestId`. There is no toast component — the gap is recorded in §5.6
 * itself — so this keeps the inline form the screens already used rather than
 * inventing one component to satisfy the letter of the spec. What §5.6 is
 * really asking for is the part that was missing everywhere: a sentence the
 * reader can act on, the server's own words, and the id that identifies the
 * failure in its log.
 *
 * Three decisions worth keeping:
 *
 * 1. **Only the sentence is a live region.** `role="alert"` is assertive and
 *    atomic, so putting the whole block in one meant a screen reader was
 *    interrupted to hear a raw UUID read out — once per banner, and the board
 *    can raise five. The machine strings stay plain selectable text.
 * 2. **The message and the request id share one line.** Two lines per banner is
 *    what let a stack of them push the board off a phone screen.
 * 3. **The sentence is `--fg`, not `--danger`.** Red-on-red measures 2.95:1 in
 *    light, under every floor in §7; §5.6 asks for an accent bar or icon, which
 *    is what carries "this is an error" here (see `.api-notice` in styles.css).
 */
export function ApiNotice({
  children,
  error,
  live = "alert",
  dismiss,
}: {
  children: ReactNode;
  error?: unknown;
  /**
   * `alert` interrupts, `polite` waits for a gap. A screen that has failed at
   * its main job interrupts; one that is merely missing a count does not.
   * `off` is a state found on arrival rather than an answer to anything the
   * reader did — a read that failed as the page opened (§5.6) — and is not
   * announced at all (Settings → My profile, TAS-380).
   */
  live?: "alert" | "polite" | "off";
  /** Events — a rejected drop, a rolled-back move — can be dismissed. States cannot. */
  dismiss?: { label: string; onDismiss: () => void };
}) {
  const { requestId } = apiErrorFacts(error);
  // The server's words — or, for a write refused because the project was
  // archived meanwhile, ours in their place (DESIGN.md §5.7).
  const message = refusalWords(error);

  return (
    <div className="api-notice">
      <div className="api-notice-body">
        <p className="api-notice-sentence" role={live === "off" ? undefined : live === "alert" ? "alert" : "status"}>
          {children}
        </p>
        {message || requestId ? (
          <p className="api-notice-detail">
            {message ? <span>{message}</span> : null}
            {requestId ? <RequestId value={requestId} /> : null}
          </p>
        ) : null}
      </div>
      {dismiss ? (
        <button aria-label={dismiss.label} className="icon-button" onClick={dismiss.onDismiss} type="button">
          <X size={15} />
        </button>
      ) : null}
    </div>
  );
}
