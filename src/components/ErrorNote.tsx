import type { ReactNode, Ref } from "react";
import { RequestId } from "./RequestId";

/**
 * A refusal stated beside the thing that was refused (TAS-192): a write in the
 * issue panel, a dialog that would not save, a sign-in that failed.
 *
 * The box is the one TAS-190 drew for the attachments section, after §5.6:
 * `--surface` ground, a `--border` edge, the `--danger` stripe on the left, and
 * the sentence in `--fg` — 17.88:1 light / 15.73:1 dark. It replaces
 * `.form-error`, which set the sentence itself in `--danger` on a 12% `--danger`
 * tint and measured 3.17:1 light / 4.43:1 dark on `--surface`, under §7's 4.5:1
 * for anything that is not meta. The CSS is the same selector group as the
 * attachments, watchers, members and work log boxes, so the panel has one error
 * look.
 *
 * Not `ApiNotice`, which is the screen-level banner on the danger tint and takes
 * an `error` to print the server's words beside its own sentence. The callers
 * here mostly print the server's words *as* the sentence, so they hand over
 * the request id by itself.
 *
 * `live` goes on the sentence and never on the box — `ApiNotice`'s rule — so an
 * announcement never reads out the uuid under it. Whether there is one is the
 * caller's, and moving to this box changed no caller's answer. The box mounts
 * together with its text, so a caller that has to be announced reliably does
 * not use it: the comment thread's write refusal (TAS-259) keeps one polite
 * sentence mounted and draws `.error-note`'s box around it, as the work log
 * does with its own.
 */
export function ErrorNote({
  children,
  requestId,
  serverWords,
  live,
  id,
  ref,
  archiveNote = false,
}: {
  children: ReactNode;
  /** The gateway's `X-Request-Id`, on its own line under the sentence. Mock mode never carries one. */
  requestId?: string | null;
  /**
   * The server's own words, for a caller whose sentence is its own (the
   * invitation refusals, §5.8): on the detail line, before the id, and outside
   * the live region with it — what is announced is the caller's sentence.
   */
  serverWords?: string | null;
  live?: "alert" | "polite";
  /** On the sentence, for a field that is described by it (`aria-describedby`). */
  id?: string;
  /** The box, for a caller that scrolls it into view when it lands (the issue panel's delete, TAS-299). */
  ref?: Ref<HTMLDivElement>;
  /**
   * This refusal is a dialog's `PROJECT_ARCHIVED` one, standing in for the
   * dialog's archive line (DESIGN.md §5.7, «Архив пришёл отказом записи»): it
   * carries the line's `data-archive-note="modal"` and its `tabIndex=-1`, a
   * place script puts focus and Tab never stops — where focus goes when the
   * archive takes the control that had it, because focus never leaves an open
   * dialog. Only that refusal: one of another kind says nothing about the
   * archive, the line stays under it, and the line is the target.
   */
  archiveNote?: boolean;
}) {
  return (
    <div
      className="error-note"
      data-archive-note={archiveNote ? "modal" : undefined}
      ref={ref}
      tabIndex={archiveNote ? -1 : undefined}
    >
      <p className="error-note-sentence" id={id} role={live === "alert" ? "alert" : live === "polite" ? "status" : undefined}>
        {children}
      </p>
      {requestId || serverWords ? (
        <p className="error-note-detail">
          {serverWords ? <span>{serverWords}</span> : null}
          {requestId ? <RequestId value={requestId} /> : null}
        </p>
      ) : null}
    </div>
  );
}
