import { useEffect, useId, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { taskaApi } from "../api/client";
import { apiErrorFacts, refusalRetryAfter, reportable } from "../api/errors";
import { AuthShell } from "../components/AuthShell";
import { ErrorNote } from "../components/ErrorNote";
import { useMutation } from "../hooks/useMutation";
import { usePressKeys } from "../hooks/usePressKeys";
import {
  FORGOT_LEAD,
  REQUEST_LOST_TEXT,
  RESEND_LOST_TEXT,
  answered,
  backLabel,
  isTooMany,
  recoverySentText,
  violationLines,
  type FormField,
} from "./accountText";
import { formatCountdown, tooManyAttemptsText } from "./authText";
import { CredentialRefusal } from "./credentialFields";
import type { ScreenProps } from "./App";

/** Router state of a move to `/forgot-password`: the address typed where the reader came from — read once, then dropped. */
export interface ForgotPasswordState {
  email?: string;
}

/**
 * The wait before «Resend link» opens when the answer named none it could
 * read (api-contract-guard Q1: the field is required, so a missing one is the
 * server's schema break; §4.31's minute is the client's default then). Zero is
 * no wait at all.
 */
export const DEFAULT_RESEND_WAIT_S = 60;

const FIELDS: readonly FormField[] = [{ name: "email", label: "Email" }];

/**
 * `/forgot-password` (TAS-527, art-director B3, B4, B7, B12, B13): the
 * request for a reset link, and «Check your email» in its place — outside
 * every company, in the sign-in card's frame, reachable signed in or not.
 *
 * **Nothing here says whether an account exists or whether a mail went out**
 * (B4): the server answers every address with the same 202, and the sent view
 * is drawn from the address the reader typed and the answer's wait alone — the
 * same DOM, byte for byte, for an unknown address and a real one.
 *
 * One `Idempotency-Key` per press; a press nothing answered is retried with
 * its key and its body (decision 7). The requests are never repeated by
 * themselves: a second send is a second mail.
 */
export function ForgotPasswordScreen({ theme, toggleTheme }: Pick<ScreenProps, "theme" | "toggleTheme">) {
  const location = useLocation();
  const navigate = useNavigate();
  const [arrived] = useState(() => {
    const email = (location.state as ForgotPasswordState | null)?.email;
    return typeof email === "string" ? email : "";
  });
  const [email, setEmail] = useState(arrived);
  const [missing, setMissing] = useState(false);
  /** What the last accepted request sent — «Check your email» is about it, and Resend sends it again. */
  const [sent, setSent] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const [tooMany, setTooMany] = useState(false);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(0);
  const [announcement, setAnnouncement] = useState<{ key: number; text: string } | null>(null);
  const [focus, setFocus] = useState<{ target: "email" | "email-select" | "title" } | null>({ target: "email" });
  const emailRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const emailId = useId();
  const reasonId = useId();
  const lineId = useId();
  const hintId = useId();
  const requestKeys = usePressKeys();
  const resendKeys = usePressKeys();

  // Read once, then taken out of the history entry: router state outlives a
  // reload, and the address is only a start (art-director N2).
  const carried = location.state !== null && location.state !== undefined;
  useEffect(() => {
    if (carried) navigate(location.pathname, { replace: true, state: null });
  }, [carried, location.pathname, navigate]);

  useEffect(() => {
    if (focus === null) return;
    if (focus.target === "title") {
      titleRef.current?.focus();
      return;
    }
    const field = emailRef.current;
    if (!field) return;
    field.focus();
    if (focus.target === "email-select") {
      field.select();
      return;
    }
    // The caret at the end of a prefilled address — where `type=email` lets
    // a script put it at all: it has no selection API, and asked, it throws.
    try {
      field.setSelectionRange(field.value.length, field.value.length);
    } catch {
      // The browser's own caret, then.
    }
  }, [focus]);

  const startCountdown = (seconds: number | null) => {
    const at = Date.now();
    setNow(at);
    setResendAt(at + (seconds ?? DEFAULT_RESEND_WAIT_S) * 1000);
  };
  const counting = sent !== null && now < resendAt;

  // Once a second while the wait runs, on the second's edge (§4.31's countdown).
  useEffect(() => {
    if (!counting) return;
    let timer = 0;
    const tick = () => {
      const current = Date.now();
      setNow(current);
      const left = resendAt - current;
      if (left > 0) timer = window.setTimeout(tick, left % 1000 || 1000);
    };
    timer = window.setTimeout(tick, (resendAt - Date.now()) % 1000 || 1000);
    return () => window.clearTimeout(timer);
  }, [counting, resendAt]);

  const request = useMutation({
    mutationFn: ({ address, key }: { address: string; key: string }) => taskaApi.requestPasswordRecovery(address, key),
    retry: false,
    onSuccess: (answer, { address }) => {
      requestKeys.answered();
      setSent(address);
      setResent(false);
      setTooMany(false);
      setAnnouncement(null);
      startCountdown(answer.retryAfterSeconds);
      setFocus({ target: "title" });
    },
    onError: (error) => requestKeys.answered(error),
  });

  const resend = useMutation({
    mutationFn: ({ address, key }: { address: string; key: string }) => taskaApi.requestPasswordRecovery(address, key),
    retry: false,
    onSuccess: (answer, { address }) => {
      resendKeys.answered();
      setResent(true);
      setTooMany(false);
      startCountdown(answer.retryAfterSeconds);
      setAnnouncement((last) => ({ key: (last?.key ?? 0) + 1, text: recoverySentText(address, true) }));
    },
    onError: (error) => {
      resendKeys.answered(error);
      if (!isTooMany(error)) return;
      // The countdown starts again from the server's wait — without one, the
      // minute — and the status says the same wait the hint counts (§4.31).
      const seconds = refusalRetryAfter(error) ?? DEFAULT_RESEND_WAIT_S;
      setTooMany(true);
      startCountdown(seconds);
      setAnnouncement((last) => ({ key: (last?.key ?? 0) + 1, text: tooManyAttemptsText(seconds) }));
    },
  });

  const submit = () => {
    if (request.isPending) return;
    const address = email.trim();
    if (address === "") {
      setMissing(true);
      setFocus({ target: "email" });
      return;
    }
    request.mutate({ address, key: requestKeys.take({ email: address }) });
  };

  const sendAgain = () => {
    if (sent === null || counting || resend.isPending) return;
    resend.reset();
    resend.mutate({ address: sent, key: resendKeys.take({ email: sent }) });
  };

  // Read during render, like the guard: with a session held, `/login` goes on
  // into the app, and the ghost says so (N3).
  const back = backLabel(taskaApi.hasSession());

  const useDifferentEmail = () => {
    setSent(null);
    setAnnouncement(null);
    resend.reset();
    request.reset();
    requestKeys.drop();
    resendKeys.drop();
    setFocus({ target: "email-select" });
  };

  if (sent !== null) {
    const resendRefusal = reportable(resend.error);
    const resendFailed = resend.isError && resendRefusal !== null && !isTooMany(resendRefusal);
    return (
      <AuthShell entrance="app" theme={theme} toggleTheme={toggleTheme}>
        <div className="signup-sent">
          <h1 className="auth-title" ref={titleRef} tabIndex={-1}>
            Check your email
          </h1>
          <p className="auth-text">{recoverySentText(sent, resent)}</p>
          {/* §4.1's two kinds of `aria-disabled`: in flight while a resend is
              out, unavailable while the wait runs. The handler refuses both. */}
          <button
            aria-describedby={hintId}
            aria-disabled={counting || resend.isPending || undefined}
            className={`secondary-button auth-retry${counting && !resend.isPending ? " is-waiting" : ""}`}
            onClick={sendAgain}
            type="button"
          >
            {resend.isPending ? "Sending" : "Resend link"}
          </button>
          {resendFailed ? (
            // Nothing answered: the link may or may not have gone (N2); a
            // refusal: §4.31's sentence, the server's words and the id.
            <ErrorNote
              key={resend.submittedAt}
              live="alert"
              requestId={apiErrorFacts(resendRefusal).requestId}
              serverWords={answered(resendRefusal) ? apiErrorFacts(resendRefusal).message : null}
            >
              {answered(resendRefusal) ? "Resending did not go through." : RESEND_LOST_TEXT}
            </ErrorNote>
          ) : null}
          <p className="auth-hint" id={hintId}>
            {counting ? (
              <>
                {tooMany ? "Too many attempts. " : null}You can resend in{" "}
                <span className="auth-countdown">{formatCountdown(resendAt - now)}</span>.
              </>
            ) : (
              "Didn’t get it? Check your spam folder, then resend."
            )}
          </p>
          <div className="auth-ghosts">
            <button className="auth-ghost" onClick={useDifferentEmail} type="button">
              Use a different email
            </button>
            <Link className="auth-ghost" to="/login">
              {back}
            </Link>
          </div>
          {/* Mounted with the view and never re-mounted, so a resend's answer is
              a change to announce; keyed inside, so the same sentence twice is
              said twice (§4.31). */}
          <p className="visually-hidden" role="status">
            {announcement ? <span key={announcement.key}>{announcement.text}</span> : null}
          </p>
        </div>
      </AuthShell>
    );
  }

  const refusal = reportable(request.error);
  const marked = refusal !== null && violationLines(refusal, FIELDS).some((line) => line.field === "email");
  const describedBy = [missing ? reasonId : null, marked ? `${lineId}-email` : null].filter(Boolean).join(" ");
  return (
    <AuthShell entrance="app" theme={theme} toggleTheme={toggleTheme}>
      {/* `noValidate`: the address is the server's to judge, and its words are
          the ones printed — not the browser's bubble (§4.31). */}
      <form
        className="form-stack"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <h1 className="auth-title">Reset your password</h1>
        <p className="auth-lead">{FORGOT_LEAD}</p>
        <div className="field">
          <label htmlFor={emailId}>Email</label>
          <input
            aria-describedby={describedBy || undefined}
            aria-invalid={missing || marked || undefined}
            autoComplete="email"
            id={emailId}
            onChange={(event) => {
              setEmail(event.target.value);
              setMissing(false);
              requestKeys.drop();
            }}
            placeholder="you@company.com"
            ref={emailRef}
            type="email"
            value={email}
          />
          {missing ? (
            <p className="auth-field-hint" id={reasonId}>
              Enter your email.
            </p>
          ) : null}
        </div>
        {/* `aria-disabled`, not `disabled` (§4.21): focus stays on the button. */}
        <button aria-disabled={request.isPending || undefined} className="primary-button auth-submit" type="submit">
          {request.isPending ? "Sending" : "Send reset link"}
        </button>
        {refusal !== null ? (
          <CredentialRefusal
            error={refusal}
            failed="The reset link could not be sent."
            fields={FIELDS}
            key={request.submittedAt}
            lineId={(field) => `${lineId}-${field}`}
            lost={REQUEST_LOST_TEXT}
          />
        ) : null}
        <Link className="auth-ghost" to="/login">
          {back}
        </Link>
      </form>
    </AuthShell>
  );
}
