import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { taskaApi } from "../api/client";
import {
  STATE_INVALID_REASON,
  apiErrorFacts,
  hasRefusalReason,
  isDisplayNameInvalid,
  isSignupDisabled,
} from "../api/errors";
import { AuthShell } from "../components/AuthShell";
import { ErrorNote } from "../components/ErrorNote";
import { ProviderChoices } from "../components/ProviderChoices";
import type { LoginRedirectState } from "../components/RequireSession";
import { DEFAULT_SIGNED_IN_ROUTE } from "../components/RequireSession";
import type { OAuthSignupState } from "../domain/types";
import { AUTH_METHODS_QUERY_KEY } from "../hooks/useAuthMethods";
import { displayNameProblem, trimDisplayName } from "../lib/displayName";
import {
  exchangeOnce,
  forgetOAuthAttempt,
  forgetOAuthCallback,
  heldOAuthCallback,
  readOAuthAttempt,
} from "../lib/oauthCallback";
import { retryAfterSeconds } from "./admin/users";
import {
  NAME_HINT,
  inAppPath,
  isKnownProvider,
  providerName,
  refusalFromCallbackError,
  refusalFromExchange,
  tooManyAttemptsText,
  type ProviderRefusal,
} from "./authText";
import type { ScreenProps } from "./App";

/** Where a finished provider sign-in goes: the path it began from, or `/projects` when that is not an in-app path. */
const signedInRoute = (returnTo: string) => inAppPath(returnTo) ?? DEFAULT_SIGNED_IN_ROUTE;

/**
 * The router state a provider flow hands back to `/login` with: its refusal,
 * if any, and the page it was to come back to as `from` — so the reader who
 * signs in with a password next still lands there, as the guard promised
 * (§5.1), and a provider pressed again is sent the same `returnTo`.
 */
const backToLogin = (providerRefusal: ProviderRefusal | null, returnTo: string | null | undefined): LoginRedirectState | null => {
  const from = inAppPath(returnTo);
  if (providerRefusal === null && from === undefined) return null;
  return { ...(providerRefusal ? { providerRefusal } : {}), ...(from ? { from } : {}) };
};

/**
 * `/auth/callback` (DESIGN.md §4.31, TAS-426): where a provider sign-in comes
 * back to. Public, outside both session guards, in the login card's shell
 * without tabs.
 *
 * The code or the refusal was taken out of the address before the router
 * mounted (src/lib/oauthCallback.ts) and is **peeked** here, never taken:
 * StrictMode runs an initialiser twice, and a take would leave the second run
 * with nothing. The code is exchanged exactly once — one promise per code,
 * module-level (`exchangeOnce`), a mutation that never retries — because the
 * server claims it atomically and a second request would only be refused.
 *
 * - `SIGNED_IN`: the session is in place; the cache of whoever was here
 *   before goes, and the reader goes on to `returnTo`, replacing this entry.
 * - `SIGNUP_REQUIRED`: the name step, here.
 * - A refusal, of the exchange or on `?error=`: `/login`, replacing this
 *   entry, with the refusal and its request id in router state, and the
 *   attempt's `returnTo` as `from`.
 * - Nothing held — a reload, a typed address: `/login`.
 */
export function AuthCallbackScreen({ theme, toggleTheme }: Pick<ScreenProps, "theme" | "toggleTheme">) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [landing] = useState(heldOAuthCallback);
  const [attempt] = useState(readOAuthAttempt);
  const [step, setStep] = useState<{ signup: OAuthSignupState; returnTo: string } | null>(null);

  const exchange = useMutation({
    mutationFn: (code: string) => exchangeOnce(code, (held) => taskaApi.exchangeOAuthCode(held)),
    retry: false,
  });
  const { mutateAsync } = exchange;

  // Whether this screen is still the one on screen when the answer lands.
  // StrictMode unmounts and remounts it once; the ref follows both.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Asked once per code: a re-run of this effect — StrictMode's second run, a
  // new `navigate` — finds the code already in hand and asks nothing. The
  // answer is acted on only while this screen is still mounted.
  const asked = useRef<string | null>(null);
  const code = landing !== null && "code" in landing ? landing.code : null;
  useEffect(() => {
    if (code === null || asked.current === code) return;
    asked.current = code;
    mutateAsync(code).then(
      (result) => {
        forgetOAuthCallback();
        if (!mounted.current) return;
        if (result.status === "SIGNED_IN") {
          forgetOAuthAttempt();
          // Whatever was cached belongs to the session before this one, if any.
          queryClient.clear();
          navigate(signedInRoute(result.returnTo), { replace: true });
          return;
        }
        setStep({ signup: result.signup, returnTo: result.returnTo });
      },
      (error: unknown) => {
        forgetOAuthCallback();
        if (!mounted.current) return;
        forgetOAuthAttempt();
        if (isSignupDisabled(error)) void queryClient.invalidateQueries({ queryKey: AUTH_METHODS_QUERY_KEY });
        const providerRefusal = refusalFromExchange(error, attempt?.provider ?? null, attempt?.tab ?? null);
        navigate("/login", { replace: true, state: backToLogin(providerRefusal, attempt?.returnTo) });
      },
    );
  }, [attempt, code, mutateAsync, navigate, queryClient]);

  // The callback refused before there was a code (§4.31): straight on to
  // `/login` with the refusal — whose value is not kept unless it is one of
  // the seven, since anybody can type it into the address.
  useEffect(() => {
    if (landing === null || !("error" in landing)) return;
    forgetOAuthCallback();
    forgetOAuthAttempt();
  }, [landing]);

  if (landing === null) return <Navigate replace to="/login" />;
  if ("error" in landing) {
    const providerRefusal: ProviderRefusal = refusalFromCallbackError(
      landing.error,
      attempt?.provider ?? null,
      attempt?.tab ?? null,
    );
    return <Navigate replace state={backToLogin(providerRefusal, attempt?.returnTo)} to="/login" />;
  }

  return (
    <AuthShell theme={theme} toggleTheme={toggleTheme}>
      {step ? (
        <NameStep returnTo={step.returnTo} signup={step.signup} />
      ) : (
        // No spinner and no skeleton (§4.31): the outcome is unknown, and a
        // form's skeleton would flash at everybody who simply signs in.
        <p className="auth-exchanging" role="status">
          {providerName(attempt?.provider) ? `Signing you in with ${providerName(attempt?.provider)}` : "Signing you in"}
        </p>
      )}
    </AuthShell>
  );
}

/**
 * The name step (§4.31): the provider vouched for an address that has no
 * account, and sign-up is open. One field to fill — the name, offered by the
 * provider when it had one — and one write, never retried.
 */
function NameStep({ signup, returnTo }: { signup: OAuthSignupState; returnTo: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState(signup.suggestedDisplayName ?? "");
  const [nameChecked, setNameChecked] = useState(signup.suggestedDisplayName !== null);
  const nameRef = useRef<HTMLInputElement>(null);
  const expiredRef = useRef<HTMLDivElement>(null);
  const emailId = useId();
  const nameId = useId();
  const nameHintId = useId();
  const provider = providerName(signup.provider);
  const nameProblem = nameChecked ? displayNameProblem(name) : null;

  const complete = useMutation({
    mutationFn: (displayName: string) => taskaApi.completeOAuthSignup({ signupToken: signup.signupToken, displayName }),
    retry: false,
    onSuccess: () => {
      forgetOAuthAttempt();
      queryClient.clear();
      // A new account belongs to no project: `/projects` draws its empty state.
      navigate(signedInRoute(returnTo), { replace: true });
    },
    onError: (error) => {
      if (stepStays(error) || isStepExpired(error)) return;
      // Spent by the server's re-check (403, a 503 with a reason): the step is
      // over, and the refusal is told on `/login` like the exchange's.
      forgetOAuthAttempt();
      if (isSignupDisabled(error)) void queryClient.invalidateQueries({ queryKey: AUTH_METHODS_QUERY_KEY });
      const providerRefusal = refusalFromExchange(error, signup.provider, null);
      navigate("/login", { replace: true, state: backToLogin(providerRefusal, returnTo) });
    },
  });

  const expired = complete.isError && isStepExpired(complete.error);
  // The way back keeps the page the flow was to return to, as a refusal does.
  const backToSignIn = () => navigate("/login", { replace: true, state: backToLogin(null, returnTo) });

  // Focus in Name when the step opens; on the expired step's sentence when the
  // form is taken away under the reader (§4.31).
  useEffect(() => {
    if (expired) expiredRef.current?.focus();
    else nameRef.current?.focus();
  }, [expired]);

  if (expired) {
    // With a provider this build can draw, the way out is its button; without
    // one there is no button to name, and the way out is sign-in (§4.31).
    const restart = isKnownProvider(signup.provider) ? signup.provider : null;
    return (
      <div className="auth-step-expired">
        <div className="auth-refusal" ref={expiredRef} tabIndex={-1}>
          <ErrorNote live="alert">
            {restart
              ? `This sign-up step expired after 15 minutes, so your account was not created. Continue with ${providerName(restart)} again to start over.`
              : "This sign-up step expired after 15 minutes, so your account was not created. Go back to sign in to start over."}
          </ErrorNote>
        </div>
        {restart ? <ProviderChoices divider={false} providers={[restart]} returnTo={returnTo} tab="signin" /> : null}
        <button className="auth-ghost" onClick={backToSignIn} type="button">
          Back to sign in
        </button>
      </div>
    );
  }

  const nameRefused = complete.isError && isDisplayNameInvalid(complete.error);
  return (
    <form
      className="form-stack"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (complete.isPending) return;
        if (displayNameProblem(name) !== null) {
          setNameChecked(true);
          nameRef.current?.focus();
          return;
        }
        complete.mutate(trimDisplayName(name));
      }}
    >
      <div className="invite-note">
        <h1 className="invite-note-title">Finish creating your account</h1>
        <p>{provider ? `You’re signing up with your ${provider} account.` : "You’re signing up with the account you chose."}</p>
      </div>
      {/* §4.27's read-only Email: an input, so a password manager or the
          browser's autofill knows the account; the provider vouched for it. */}
      <div className="field">
        <label htmlFor={emailId}>Email</label>
        <div className="invite-value-field">
          <input autoComplete="email" id={emailId} readOnly type="email" value={signup.email} />
        </div>
      </div>
      <div className="field">
        <label htmlFor={nameId}>Name</label>
        <input
          aria-describedby={nameHintId}
          aria-invalid={nameProblem || nameRefused ? true : undefined}
          autoComplete="name"
          id={nameId}
          onChange={(event) => {
            setName(event.target.value);
            setNameChecked(true);
          }}
          ref={nameRef}
          spellCheck={false}
          value={name}
        />
        <p className="auth-field-hint" id={nameHintId}>
          {nameProblem ?? NAME_HINT}
        </p>
      </div>
      <button aria-disabled={complete.isPending || undefined} className="primary-button auth-submit" type="submit">
        {complete.isPending ? "Creating account" : "Create account"}
      </button>
      {complete.isError && stepStays(complete.error) ? (
        <NameStepFailure error={complete.error} key={complete.submittedAt} />
      ) : null}
      <button className="auth-ghost" onClick={backToSignIn} type="button">
        Back to sign in
      </button>
    </form>
  );
}

/** 401 `STATE_INVALID` on the name step: the step is older than 15 minutes, or used. */
function isStepExpired(error: unknown): boolean {
  return hasRefusalReason(error, "UNAUTHENTICATED", STATE_INVALID_REASON);
}

/**
 * The refusals that leave the step usable, so the form stays (§4.31): the
 * name's and the attempt budget's, which come before the token is claimed;
 * and a failure without a reason — no answer, a 5xx, a 408, an edge 400 —
 * after which the token may well be unspent. A refusal *with* a reason that is
 * not the name's spends the step, and goes to `/login`.
 */
function stepStays(error: unknown): boolean {
  if (isDisplayNameInvalid(error)) return true;
  const { status, code, details } = apiErrorFacts(error);
  if (code === "RESOURCE_EXHAUSTED" || status === 429) return true;
  return !(details && Object.hasOwn(details, "reason"));
}

/** What a refused «Create account» says on the name step (§4.31), as an alert under the button. */
function NameStepFailure({ error }: { error: unknown }) {
  const { message, requestId, status, code } = apiErrorFacts(error);
  if (isDisplayNameInvalid(error) && message) {
    return (
      <ErrorNote live="alert" requestId={requestId}>
        {message}
      </ErrorNote>
    );
  }
  if (code === "RESOURCE_EXHAUSTED" || status === 429) {
    return (
      <ErrorNote live="alert" requestId={requestId}>
        {tooManyAttemptsText(retryAfterSeconds(error))}
      </ErrorNote>
    );
  }
  return (
    <ErrorNote live="alert" requestId={requestId} serverWords={status !== null || code !== null ? message : null}>
      Your account was not created.
    </ErrorNote>
  );
}
