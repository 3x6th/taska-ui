import { Eye, EyeOff } from "lucide-react";
import type { KeyboardEvent, ReactNode, Ref } from "react";
import { apiErrorFacts } from "../api/errors";
import { ErrorNote } from "../components/ErrorNote";
import { answered, isTooMany, tooManyText, violationLines, type FormField } from "./accountText";

/*
 * The two pieces the password-reset pages and Settings › Account share
 * (TAS-527): a password field with its show-password toggle, and the refusal
 * under a form's buttons.
 */

/**
 * A password field with §4.27's toggle (art-director B8): the `<label for>`
 * wraps nothing, so the field's name is its label alone; the 28 ghost button
 * inside the box, `Eye`/`EyeOff` 14, «Show password» and `aria-pressed`; the
 * input keeps 40 on the right. `after` is what stands under it — the hint or
 * the reason, and the «Forgot your current password?» link.
 */
export function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  shown,
  onToggle,
  describedBy,
  invalid,
  readOnly,
  inputRef,
  onKeyDown,
  after,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  shown: boolean;
  onToggle: () => void;
  describedBy?: string;
  invalid: boolean;
  readOnly?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  after?: ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="password-field">
        <input
          aria-describedby={describedBy || undefined}
          aria-invalid={invalid || undefined}
          autoComplete={autoComplete}
          id={id}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          readOnly={readOnly}
          ref={inputRef}
          spellCheck={false}
          type={shown ? "text" : "password"}
          value={value}
        />
        <button aria-label="Show password" aria-pressed={shown} className="icon-button password-toggle" onClick={onToggle} type="button">
          {shown ? <EyeOff aria-hidden="true" size={14} /> : <Eye aria-hidden="true" size={14} />}
        </button>
      </div>
      {after}
    </div>
  );
}

/**
 * The refusal under a form's buttons (art-director B6, B12; api-contract-guard
 * §7), an alert — it answers a press — mounted afresh per attempt by the
 * caller's `key`, with the request id under it:
 *
 * - a 400 with `violations`: the server's words, one line each, in the form's
 *   field order (`violationLines`); a line that names a field carries the id
 *   the field is described by. No sentence of the client's — none for a wrong
 *   current password, none for an address in use (A98, A100);
 * - a 429: `Too many attempts. Try again in {wait}.`;
 * - no HTTP status: `lost` — the press may or may not have landed — with no
 *   words, there were none; or `failed` when the form has no such sentence;
 * - anything else: `failed`, with the server's words beside it.
 */
export function CredentialRefusal({
  error,
  fields,
  lineId,
  failed,
  lost = null,
}: {
  error: unknown;
  fields: readonly FormField[];
  /** The id of the line that names a field — what the field's `aria-describedby` points at. */
  lineId: (field: string) => string;
  failed: string;
  lost?: string | null;
}) {
  const { message, requestId } = apiErrorFacts(error);
  const lines = violationLines(error, fields);
  if (lines.length > 0) {
    return (
      <ErrorNote live="alert" requestId={requestId}>
        {lines.map((line, index) => (
          <span className="error-note-line" id={line.field === null ? undefined : lineId(line.field)} key={index}>
            {line.text}
          </span>
        ))}
      </ErrorNote>
    );
  }
  if (isTooMany(error)) {
    return (
      <ErrorNote live="alert" requestId={requestId}>
        {tooManyText(error)}
      </ErrorNote>
    );
  }
  if (!answered(error)) {
    return (
      <ErrorNote live="alert" requestId={requestId}>
        {lost ?? failed}
      </ErrorNote>
    );
  }
  return (
    <ErrorNote live="alert" requestId={requestId} serverWords={message}>
      {failed}
    </ErrorNote>
  );
}
