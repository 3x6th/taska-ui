import { useEffect, useId, useRef } from "react";
import { apiErrorFacts, isDisplayNameInvalid, isSignupDisabled } from "../api/errors";
import { ErrorNote } from "../components/ErrorNote";
import { ProviderChoices } from "../components/ProviderChoices";
import type { OAuthProvider } from "../domain/types";
import { retryAfterSeconds } from "./admin/users";
import { NAME_HINT, formatCountdown, tooManyAttemptsText } from "./authText";
import type { SignupState } from "./useSignup";

/**
 * The Create account tab (DESIGN.md §4.31): the form, and once the server has
 * taken it, «Check your email» in its place on the same tab. The state is the
 * card's (`useSignup`); this only draws it and moves focus.
 *
 * Nothing here says whether an account exists or whether an email went out —
 * the server answers 202 for every address — and the button says «Continue»,
 * not «Create account», because pressing it creates nothing.
 */
export function SignupPanel({
  signup,
  providers,
  returnTo,
  onProviderStart,
}: {
  signup: SignupState;
  providers: readonly string[];
  returnTo: string;
  onProviderStart: (provider: OAuthProvider) => void;
}) {
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const nameId = useId();
  const nameHintId = useId();
  const emailId = useId();
  const hintId = useId();

  const { takeFocus } = signup;
  useEffect(() => {
    const focus = takeFocus();
    if (focus?.target === "title") titleRef.current?.focus();
    else if (focus?.target === "name") nameRef.current?.focus();
    else if (focus?.target === "email") {
      emailRef.current?.focus();
      // Back from «Check your email» with the address selected, to retype it at once.
      emailRef.current?.select();
    }
  }, [takeFocus]);

  if (signup.sent) {
    const { resend } = signup;
    const resendRefused = resend.isError && !isTooMany(resend.error);
    return (
      <div className="signup-sent">
        <h1 className="auth-title" ref={titleRef} tabIndex={-1}>
          Check your email
        </h1>
        <p className="auth-text">
          If {signup.sent.email} can be used for a new Taska account, we’ve sent {signup.resent ? "another link" : "a link"} there.
          Open it to choose your password.
        </p>
        {/* Two kinds of `aria-disabled` (§4.1): in flight while a resend is
            out, unavailable while the minute runs. The handler refuses both. */}
        <button
          aria-describedby={hintId}
          aria-disabled={signup.counting || resend.isPending || undefined}
          className={`secondary-button auth-retry${signup.counting && !resend.isPending ? " is-waiting" : ""}`}
          onClick={signup.sendAgain}
          type="button"
        >
          {resend.isPending ? "Sending" : "Resend link"}
        </button>
        {resendRefused ? <ResendFailure error={resend.error} key={resend.submittedAt} /> : null}
        <p className="auth-hint" id={hintId}>
          {signup.counting ? (
            <>
              {signup.tooMany ? "Too many attempts. " : null}You can resend in{" "}
              <span className="auth-countdown">{formatCountdown(signup.remaining)}</span>.
            </>
          ) : (
            "Didn’t get it? Check your spam folder, then resend."
          )}
        </p>
        <button className="auth-ghost" onClick={signup.backToForm} type="button">
          Use a different email
        </button>
        {/* Mounted with the view and never re-mounted, so a resend's answer
            is a change to announce; keyed inside, so the same sentence twice
            is said twice. */}
        <p className="visually-hidden" role="status">
          {signup.announcement ? <span key={signup.announcement.key}>{signup.announcement.text}</span> : null}
        </p>
      </div>
    );
  }

  const { request } = signup;
  const nameRefused = request.isError && isDisplayNameInvalid(request.error);
  const emailRefused = request.isError && !nameRefused && isRequestRefusal(request.error);
  return (
    <>
      {/* `noValidate`: the address is the server's to judge, and its sentence
          is the one printed (§4.31) — not the browser's bubble. */}
      <form
        className="form-stack"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          signup.submit();
        }}
      >
        <div className="field">
          <label htmlFor={nameId}>Name</label>
          <input
            aria-describedby={nameHintId}
            aria-invalid={signup.nameProblem || nameRefused ? true : undefined}
            autoComplete="name"
            id={nameId}
            onChange={(event) => signup.setName(event.target.value)}
            ref={nameRef}
            spellCheck={false}
            value={signup.name}
          />
          <p className="auth-field-hint" id={nameHintId}>
            {signup.nameProblem ?? NAME_HINT}
          </p>
        </div>
        <div className="field">
          <label htmlFor={emailId}>Email</label>
          <input
            aria-invalid={emailRefused || undefined}
            autoComplete="email"
            id={emailId}
            onChange={(event) => signup.setEmail(event.target.value)}
            placeholder="you@company.com"
            ref={emailRef}
            type="email"
            value={signup.email}
          />
        </div>
        <button aria-disabled={request.isPending || undefined} className="primary-button auth-submit" type="submit">
          {request.isPending ? "Sending" : "Continue"}
        </button>
        {request.isError ? <SignupFailure error={request.error} key={request.submittedAt} /> : null}
        <p className="auth-hint">Invited by your team? Use the link in your invitation email instead.</p>
      </form>
      <ProviderChoices onStart={onProviderStart} providers={providers} returnTo={returnTo} tab="signup" />
    </>
  );
}

function isTooMany(error: unknown): boolean {
  const { status, code } = apiErrorFacts(error);
  return code === "RESOURCE_EXHAUSTED" || status === 429;
}

/** A 400 — the gateway's binding or the service's own sentence (the mock carries only the code). */
function isRequestRefusal(error: unknown): boolean {
  const { status, code } = apiErrorFacts(error);
  return status === 400 || (status === null && code === "INVALID_ARGUMENT");
}

/**
 * What a refused Continue says (§4.31), as an alert under the button — it
 * answers a press. A 400 is the server's own sentence, and marks the field it
 * names: `DISPLAY_NAME_INVALID` is Name; any other 400 is Email, because the
 * body has two fields and the name's every refusal carries that reason (the
 * name is also checked before the request). Sign-up off, a 429 and the rest
 * are this screen's sentences; the rest keeps the server's words and id.
 */
function SignupFailure({ error }: { error: unknown }) {
  const { message, requestId, status, code } = apiErrorFacts(error);
  if (isSignupDisabled(error)) {
    return (
      <ErrorNote live="alert" requestId={requestId}>
        Taska isn’t open for new accounts right now. Ask a Taska admin to invite you.
      </ErrorNote>
    );
  }
  if (isTooMany(error)) {
    return (
      <ErrorNote live="alert" requestId={requestId}>
        {tooManyAttemptsText(retryAfterSeconds(error))}
      </ErrorNote>
    );
  }
  if (isRequestRefusal(error) && message) {
    return (
      <ErrorNote live="alert" requestId={requestId}>
        {message}
      </ErrorNote>
    );
  }
  return (
    <ErrorNote live="alert" requestId={requestId} serverWords={status !== null || code !== null ? message : null}>
      The sign-up request could not be sent.
    </ErrorNote>
  );
}

/** A refused resend that is not a 429 (§4.31): above the hint, an alert, the server's words and id. */
function ResendFailure({ error }: { error: unknown }) {
  const { message, requestId, status, code } = apiErrorFacts(error);
  return (
    <ErrorNote live="alert" requestId={requestId} serverWords={status !== null || code !== null ? message : null}>
      Resending did not go through.
    </ErrorNote>
  );
}
