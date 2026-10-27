import { useId, type ReactNode } from "react";
import { apiErrorFacts } from "../api/errors";
import { refusalWords } from "../lib/projectArchive";
import { useRevealOnOpen } from "../hooks/useRevealOnOpen";
import type { StepOption } from "../lib/workflows";
import { RequestId } from "./RequestId";

/**
 * §4.22's confirmation strip and the move steps it turns into (DESIGN.md
 * §4.28, §4.30), shared by Workflows and Issue types so a delete that has to
 * move issues first reads the same in both: the question, Cancel first, the
 * answer edged in `--danger`, and — once the server says where the issues are
 * — a step with its own sentence and selects.
 */

/** A ref callback that files a node under a key, for a dialog's `pendingFocus` to find. */
export type Register = (key: string) => (node: HTMLElement | null) => void;

/** What a strip gets from its dialog: the write's state, the way out, and where its buttons are filed. */
export interface StripProps {
  inFlight: boolean;
  error: Error | null;
  onCancel: () => void;
  register: Register;
}

/**
 * «Ещё применяется» (DESIGN.md §4.28, backend TAS-433/436/437): a 503 that is
 * not a refusal — the server accepted the command and finishes it by itself.
 * Quiet, as the undeployed-route line, a status rather than an alert, with
 * the request id under it; pressing the same button again sends the same
 * command with that id.
 */
export function PendingNote({ error, label }: { error: unknown; label: string }) {
  const { requestId } = apiErrorFacts(error);
  return (
    <div className="pending-note">
      <p className="field-note save-failed-note" role="status">
        {`The server has not finished this change yet. Press ${label} again in a few seconds to finish it; nothing is applied twice.`}
      </p>
      {requestId ? (
        <p className="error-note-detail">
          <RequestId value={requestId} />
        </p>
      ) : null}
    </div>
  );
}

/**
 * A select of where moved issues go, with nothing chosen until the reader
 * chooses: a delete moves every issue named, and the answer stays steadily
 * unavailable until a target is named. A change while the write is out — or
 * while a pending command is held for its repeat — is ignored, as every field
 * of the dialog's (§4.28).
 */
export function TargetSelect({
  label,
  options,
  value,
  onChange,
  frozen,
  register,
  focusKey,
  placeholder = "Choose a status",
}: {
  label: string;
  options: readonly StepOption[];
  value: string;
  onChange: (key: string) => void;
  frozen: boolean;
  register: Register;
  /** The step's first field is where focus goes when the step appears. */
  focusKey?: string;
  placeholder?: string;
}) {
  const fieldId = useId();
  return (
    <div className="workflow-field">
      <label htmlFor={fieldId}>{label}</label>
      <select
        id={fieldId}
        onChange={(event) => {
          if (!frozen) onChange(event.target.value);
        }}
        ref={focusKey ? register(focusKey) : undefined}
        value={value}
      >
        <option disabled value="">
          {placeholder}
        </option>
        {options.map((option) => (
          <option key={option.key} value={option.key}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** A move step: the refusal it answers, its sentence, its fields, and whether its answer still waits on a field. */
export interface MoveStep {
  refusal: unknown;
  sentence: string;
  fields: ReactNode;
  /** A field still empty: the answer is steadily unavailable, with no sentence (§4.28). */
  blocked: boolean;
}

/**
 * The column of a move step (§4.28): the sentence, said as an alert, then the
 * fields. A step is a question, so it does not print the server's words, which
 * instruct an API client (art-director, TAS-416) — except a step with nowhere
 * to move the issues and so no answer (`deadEnd`), which reads sentence, why,
 * then the server's words and the request id.
 */
export function StepColumn({ step, deadEnd, sentenceId }: { step: MoveStep; deadEnd: boolean; sentenceId?: string }) {
  const facts = deadEnd ? apiErrorFacts(step.refusal) : null;
  const words = deadEnd ? refusalWords(step.refusal) : null;
  return (
    <div className="workflow-confirm-step">
      <p className="member-confirm-sentence" id={sentenceId} role="alert">
        {step.sentence}
      </p>
      {step.fields}
      {words || facts?.requestId ? (
        <p className="error-note-detail workflow-confirm-detail">
          {words ? <span>{words}</span> : null}
          {facts?.requestId ? <RequestId value={facts.requestId} /> : null}
        </p>
      ) : null}
    </div>
  );
}

/**
 * §4.22's confirmation strip: the question, Cancel first and focused, and the
 * answer edged in `--danger`. A delete refused for the issues it would leave
 * behind becomes a step in the same strip (`step`, `StepColumn`). Any other
 * refusal is said above the actions by `sayRefusal`, as a form's is — the
 * dialog's sentence, the server's words and the request id, or the quiet line
 * of a command still being applied.
 */
export function ConfirmStrip({
  id,
  className,
  sentence,
  answerLabel,
  onAnswer,
  sayRefusal,
  step,
  inFlight,
  error,
  onCancel,
  register,
}: StripProps & {
  id: string;
  /** The strip's place in its dialog: `workflow-confirm` in a card, `issue-type-confirm` under a type. */
  className: string;
  sentence: ReactNode;
  answerLabel: string;
  /** Leaves the answer out when there is nothing it could send. */
  onAnswer: (() => void) | null;
  sayRefusal: (error: Error) => ReactNode;
  step?: MoveStep;
}) {
  const sentenceId = `${id}-sentence`;
  const box = useRevealOnOpen<HTMLDivElement>();
  const blocked = step?.blocked ?? false;
  // The step says its refusal itself; only a later one of another kind is said again.
  const otherError = error && (!step || error !== step.refusal) ? error : null;

  return (
    <div className={`member-confirm ${className}${step ? " is-step" : ""}`} id={id} ref={box}>
      {step ? (
        <StepColumn deadEnd={!onAnswer} sentenceId={sentenceId} step={step} />
      ) : (
        <p className="member-confirm-sentence" id={sentenceId}>
          {sentence}
        </p>
      )}
      {otherError ? <div className="workflow-confirm-refusal">{sayRefusal(otherError)}</div> : null}
      <div className="member-confirm-actions">
        <button
          aria-disabled={inFlight || undefined}
          autoFocus={!step}
          className="secondary-button compact-button"
          onClick={onCancel}
          ref={register("cancel")}
          type="button"
        >
          Cancel
        </button>
        {onAnswer ? (
          <button
            aria-describedby={sentenceId}
            aria-disabled={inFlight || blocked || undefined}
            className={`secondary-button compact-button member-confirm-accept${blocked && !inFlight ? " is-unavailable" : ""}`}
            onClick={() => {
              if (!inFlight && !blocked) onAnswer();
            }}
            ref={register("submit")}
            type="button"
          >
            {answerLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}
