import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Link, useNavigate } from "react-router-dom";
import { taskaApi } from "../api/client";
import { apiErrorFacts, reportable } from "../api/errors";
import { AuthShell } from "../components/AuthShell";
import { ErrorNote } from "../components/ErrorNote";
import type { LoginRedirectState } from "../components/RequireSession";
import { useMutation } from "../hooks/useMutation";
import { usePressKeys } from "../hooks/usePressKeys";
import { forgetFreeUsed } from "../lib/companies";
import { FORGOT_PASSWORD_ROUTE, forgetRecoveryToken, heldRecoveryToken, subscribeRecoveryToken } from "../lib/recoveryLink";
import {
  DEAD_LINK_TEXT,
  NEW_PASSWORD_HINT,
  NO_LINK_TEXT,
  backLabel,
  isDeadLink,
  recoveryLead,
  violationLines,
  type FormField,
} from "./accountText";
import { CredentialRefusal, PasswordField } from "./credentialFields";
import type { ScreenProps } from "./App";

const FIELDS: readonly FormField[] = [{ name: "newPassword", label: "New password" }];

/**
 * `/reset-password` (TAS-527, art-director B3, B5, B7, B8, B12, B13): the
 * token from the email's link — taken out of the address before the router
 * mounted (`captureRecoveryLink`) and held in memory — and a new password.
 * Outside every company, in the sign-in card's frame, and **not** behind
 * `RedirectSignedIn`: a link opened in a browser somebody is signed in to
 * works, and says so in its lead.
 *
 * Sent with no credential. On the 204 the server has ended every session of
 * the account (contracts.md); this browser's is signed out here too — with the
 * query cache — and the reader lands on `/login` with the notice and focus in
 * Email. No `GET /users/me`: nobody is signed in to read it.
 *
 * A dead link — a 401, a 422 `CONFIRMATION_EXPIRED`, a `token` violation
 * (A101) — takes the field and the button away; the token is forgotten and
 * «Request a new link» stands in their place. A reload without a token says
 * to open the link again: the link stays good until it is used.
 */
export function ResetPasswordScreen({ theme, toggleTheme }: Pick<ScreenProps, "theme" | "toggleTheme">) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const token = useSyncExternalStore(subscribeRecoveryToken, heldRecoveryToken);
  // Read once: the lead is about the session held when the page opened.
  const [signedInHere] = useState(() => taskaApi.hasSession());
  const [password, setPassword] = useState("");
  const [shown, setShown] = useState(false);
  const [missing, setMissing] = useState(false);
  const [dead, setDead] = useState<{ requestId: string | null } | null>(null);
  /**
   * The 204 is in hand and the page is on its way to `/login` (art-director's
   * build review B1): the form stays in flight — «Setting password» — through
   * the sign-out's round trip, and no other view of this page is drawn.
   */
  const [leaving, setLeaving] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const deadRef = useRef<HTMLDivElement>(null);
  const passwordId = useId();
  const hintId = useId();
  const lineId = useId();
  const keys = usePressKeys();

  const complete = useMutation({
    mutationFn: ({ link, newPassword, key }: { link: string; newPassword: string; key: string }) =>
      taskaApi.completePasswordRecovery(link, newPassword, key),
    retry: false,
    // Nothing of the token or the password outlives this page in the
    // mutation cache (release-reviewer 5).
    gcTime: 0,
    onSuccess: async () => {
      setLeaving(true);
      keys.answered();
      // The server has ended every session of the account; this browser's
      // goes too, and what it read with it.
      if (taskaApi.hasSession()) await taskaApi.logout();
      queryClient.removeQueries();
      forgetFreeUsed();
      navigate("/login", { replace: true, state: { recovered: true } satisfies LoginRedirectState });
      // Only once the page is leaving: forgotten earlier, the token's absence
      // would draw «Open the link from your email again» for the sign-out's
      // whole round trip (B1).
      forgetRecoveryToken();
      setPassword("");
    },
    onError: (error) => {
      keys.answered(error);
      if (!isDeadLink(error)) return;
      forgetRecoveryToken();
      setPassword("");
      setShown(false);
      setDead({ requestId: apiErrorFacts(error).requestId });
    },
  });

  // Arriving with a link: the one field it needs. A reload without one moves nothing.
  const arrivedWithToken = useRef(token !== null);
  useEffect(() => {
    if (arrivedWithToken.current) passwordRef.current?.focus();
  }, []);

  // The dead link takes the field and the button — and focus, wherever it was in the form.
  useEffect(() => {
    if (dead !== null) deadRef.current?.focus();
  }, [dead]);

  const pending = complete.isPending || leaving;
  // Read during render, like the guard: the way back says where it goes.
  const back = backLabel(taskaApi.hasSession());

  const submit = () => {
    if (pending || token === null) return;
    if (password === "") {
      setMissing(true);
      passwordRef.current?.focus();
      return;
    }
    complete.mutate({ link: token, newPassword: password, key: keys.take({ token, newPassword: password }) });
  };

  if (dead !== null) {
    return (
      <AuthShell entrance="app" theme={theme} toggleTheme={toggleTheme}>
        <div className="form-stack">
          {/* The field, the button and the lead go; the title stays (N1). */}
          <h1 className="auth-title">Choose a new password</h1>
          {/* A state the press led to, which takes focus: not live (B12). */}
          <div className="auth-refusal-block" ref={deadRef} tabIndex={-1}>
            <ErrorNote requestId={dead.requestId}>{DEAD_LINK_TEXT}</ErrorNote>
          </div>
          <Link className="primary-button auth-submit auth-link-button" to={FORGOT_PASSWORD_ROUTE}>
            Request a new link
          </Link>
          <Link className="auth-ghost" to="/login">
            {back}
          </Link>
        </div>
      </AuthShell>
    );
  }

  if (token === null && !leaving) {
    return (
      <AuthShell entrance="app" theme={theme} toggleTheme={toggleTheme}>
        <div className="form-stack">
          <h1 className="auth-title">Choose a new password</h1>
          {/* A state found on arrival: not live, and no request id — nothing was asked. */}
          <p className="auth-text">{NO_LINK_TEXT}</p>
          <Link className="secondary-button auth-retry auth-link-button" to={FORGOT_PASSWORD_ROUTE}>
            Request a new link
          </Link>
          <Link className="auth-ghost" to="/login">
            {back}
          </Link>
        </div>
      </AuthShell>
    );
  }

  const refusal = reportable(complete.error);
  const marked = refusal !== null && violationLines(refusal, FIELDS).some((line) => line.field === "newPassword");
  const describedBy = [hintId, marked ? `${lineId}-newPassword` : null].filter(Boolean).join(" ");
  return (
    <AuthShell entrance="app" theme={theme} toggleTheme={toggleTheme}>
      <form
        className="form-stack"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <h1 className="auth-title">Choose a new password</h1>
        <p className="auth-lead">{recoveryLead(signedInHere)}</p>
        <PasswordField
          after={
            <p className="auth-field-hint" id={hintId}>
              {missing ? "Enter a new password." : NEW_PASSWORD_HINT}
            </p>
          }
          autoComplete="new-password"
          describedBy={describedBy}
          id={passwordId}
          inputRef={passwordRef}
          invalid={missing || marked}
          label="New password"
          onChange={(value) => {
            setPassword(value);
            setMissing(false);
            keys.drop();
          }}
          onToggle={() => setShown((value) => !value)}
          shown={shown}
          value={password}
        />
        <button aria-disabled={pending || undefined} className="primary-button auth-submit" type="submit">
          {pending ? "Setting password" : "Set new password"}
        </button>
        {refusal !== null ? (
          <CredentialRefusal
            error={refusal}
            failed="Your password was not reset."
            fields={FIELDS}
            key={complete.submittedAt}
            lineId={(field) => `${lineId}-${field}`}
            lost="The server could not be reached, so your password may or may not have been reset. Try again to make sure."
          />
        ) : null}
        <Link className="auth-ghost" to="/login">
          {back}
        </Link>
      </form>
    </AuthShell>
  );
}
