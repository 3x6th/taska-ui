import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { taskaApi } from "../api/client";
import { apiErrorFacts, isAccountLocked } from "../api/errors";
import type { LoginRedirectState } from "../components/RequireSession";
import { DEFAULT_SIGNED_IN_ROUTE } from "../components/RequireSession";
import { RequestId } from "../components/RequestId";
import { TaskaLogo } from "../components/TaskaLogo";
import { ThemeToggle } from "../components/ThemeToggle";
import { accountLockedUntil, formatLockDeadline } from "../lib/accountLock";
import type { ScreenProps } from "./App";

type AuthMode = "signin" | "invite";

interface LoginScreenProps extends ScreenProps {
  initialMode: AuthMode;
}

export function LoginScreen({ theme, toggleTheme, initialMode }: LoginScreenProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const redirect = (location.state ?? null) as LoginRedirectState | null;
  const from = inAppPath(redirect?.from);
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteToken, setInviteToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const noticeRef = useRef<HTMLParagraphElement>(null);

  // Only the session that died without being asked needs explaining: a login
  // form after clicking a private link surprises nobody, and a sentence there
  // is one more thing to read on a screen that already asks for two. And the
  // explanation only belongs over the sign-in form: "Your session expired. Sign
  // in to continue." above a form headed "Activate account" describes neither.
  const notice = mode === "signin" && redirect?.expired ? "Your session expired. Sign in to continue." : null;

  useEffect(() => {
    // The redirect happened without the user asking, and focus would otherwise
    // stay on <body> with nothing announced (§7). A live region would not help:
    // this node mounts with its text already in it, so there is no change to
    // announce — moving focus is what reads the sentence out. Mount-only is
    // correct because the text never changes after the first paint.
    noticeRef.current?.focus();
  }, []);

  const submit = useMutation({
    mutationFn: async () => {
      if (mode === "signin") {
        await taskaApi.login({ email, password });
      } else {
        await taskaApi.acceptInvitation({ token: inviteToken, newPassword });
      }
      return taskaApi.getCurrentUser();
    },
    onSuccess: async (user) => {
      queryClient.setQueryData(["me"], user);
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      // Back to whatever the guard interrupted, and `replace` so Back does not
      // land on the login form of a session that already exists.
      navigate(from ?? DEFAULT_SIGNED_IN_ROUTE, { replace: true });
    },
  });

  return (
    <main className="auth-screen">
      <div className="auth-glow" />
      <div className="auth-card-wrap">
        <TaskaLogo />
        <section className="auth-card">
          {notice ? (
            <p className="auth-notice" ref={noticeRef} tabIndex={-1}>
              {notice}
            </p>
          ) : null}
          <div className="segmented">
            <button className={mode === "signin" ? "is-active" : ""} onClick={() => setMode("signin")} type="button">
              Sign in
            </button>
            <button className={mode === "invite" ? "is-active" : ""} onClick={() => setMode("invite")} type="button">
              Accept invite
            </button>
          </div>

          <form
            className="form-stack"
            onSubmit={(event) => {
              event.preventDefault();
              submit.mutate();
            }}
          >
            {mode === "signin" ? (
              <>
                <label className="field">
                  <span>Email</span>
                  <input
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    type="email"
                    autoComplete="email"
                    placeholder="you@company.com"
                  />
                </label>
                <label className="field">
                  <span>Password</span>
                  <input
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    type="password"
                    autoComplete="current-password"
                    placeholder="••••••••••"
                  />
                </label>
                <button className="primary-button auth-submit" disabled={submit.isPending} type="submit">
                  {submit.isPending ? "Signing in" : "Sign in"}
                </button>
                <div className="auth-hint">Forgot password? Contact your project admin.</div>
              </>
            ) : (
              <>
                <div className="invite-note">You were invited to Taska Platform.</div>
                <label className="field">
                  <span>Invite token</span>
                  <input
                    className="mono-input"
                    value={inviteToken}
                    onChange={(event) => setInviteToken(event.target.value)}
                    autoComplete="one-time-code"
                    placeholder="invite-token-from-email"
                  />
                </label>
                <label className="field">
                  <span>New password</span>
                  <input
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    type="password"
                    autoComplete="new-password"
                    placeholder="At least 12 characters"
                  />
                </label>
                <button className="primary-button auth-submit" disabled={submit.isPending} type="submit">
                  {submit.isPending ? "Activating" : "Activate account"}
                </button>
              </>
            )}
            {submit.isError ? <LoginFailure error={submit.error} mode={mode} /> : null}
          </form>
        </section>
        <div className="auth-footnote">Taska — issue tracking, minus the clutter.</div>
      </div>
      <div className="auth-theme">
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
      </div>
    </main>
  );
}

/**
 * What a refused sign-in says.
 *
 * Two branches and one rule between them: the branch is chosen by the response
 * code (`isAccountLocked`, src/api/errors.ts) and never by the wording, so the
 * prose is only ever used to pull the number out of — never to decide what the
 * reader is told.
 *
 * **The fallback is the server's own sentence, verbatim.** When the deadline
 * cannot be read — a reworded message, or one naming a moment that has already
 * passed — this prints `Account is locked until 2026-09-22T11:55:50.398486Z.
 * Try again later.` exactly as it arrived. That is the ugliness TAS-237 was
 * filed about, and it is still the right answer: a hand-written "your account
 * is locked" would throw away information the server did send, and would make a
 * parser that quietly stopped matching indistinguishable from one that works.
 * Unreadable and traceable beats prettier and wrong.
 */
function LoginFailure({ error, mode }: { error: unknown; mode: AuthMode }) {
  const { message, requestId } = apiErrorFacts(error);
  // `mode === "signin"` because this slot answers for more than sign-in, and
  // the argument behind `isAccountLocked` covers one route only. It is sound
  // on `POST /auth/login` by exhausting that method's other refusals
  // (src/api/errors.ts); the invite tab submits `POST /auth/invitations/accept`,
  // which the argument says nothing about, so the conjunct takes the branch
  // away from the tab it was never made for.
  //
  // What the conjunct does not reach is the `getCurrentUser()` that follows a
  // successful login in the same mutation: `validateAccessToken` runs
  // `validateUserStatus` for every authenticated call, and that raises
  // `PERMISSION_DENIED "User is blocked"` (AuthServiceImpl.java:205-213, read
  // at backend head `63f7ea5`). It reaches here, and what keeps it right is
  // the parser rather than the predicate — there is no future instant in that
  // sentence, so `accountLockedUntil` answers `null` and the server's own
  // wording is printed verbatim. Correct, and correct for a reason one layer
  // below the one this branch claims.
  //
  // Read at render rather than held in state, so a lock that expires while the
  // form is still open falls back to the raw sentence on the next paint
  // instead of going on promising a moment that has gone. No timer wakes it —
  // the reader retrying is what re-renders this, and that is the moment it
  // matters.
  const lockedUntil = mode === "signin" && isAccountLocked(error) ? accountLockedUntil(message) : null;

  return (
    <div className="form-error">
      {lockedUntil ? (
        // Two lines, the second centred under the first, per the story. The
        // centring is `.auth-lock`'s own — `.form-error` is shared with the
        // issue composer and the project dialog and sets no alignment for
        // anyone.
        <span className="auth-lock">
          <LockDeadline until={lockedUntil} />
          <span>Try again later.</span>
        </span>
      ) : (
        <span>{message ?? "Sign-in failed."}</span>
      )}
      {/* Owed on both branches and missing from this screen until TAS-237: a
          refusal here is as likely to need looking up in the gateway log as one
          from any dialog, and `EditProjectModal` has paired the id with the
          sentence since §5.6 asked for it. Mock mode never carries one. */}
      {requestId ? <RequestId value={requestId} /> : null}
    </div>
  );
}

/**
 * The first of the two lines: the machine-readable instant in `dateTime`, the
 * deadline in whichever form the reader needs today, and the same moment
 * fully qualified in `title` — `formatLockDeadline` decides all three
 * (`src/lib/accountLock.ts`).
 *
 * Its own function only so the formatted pair can be a `const`; the markup is
 * the same `<span>` `.auth-lock > span` has always selected.
 */
function LockDeadline({ until }: { until: Date }) {
  const { text, title } = formatLockDeadline(until);

  return (
    <span>
      Account is locked until{" "}
      <time dateTime={until.toISOString()} title={title}>
        {text}
      </time>
    </span>
  );
}

/**
 * The redirect target comes from our own router state, but an unchecked one is
 * not a habit worth forming: only a path on this origin is accepted. Comparing
 * resolved origins rather than pattern-matching the string catches the
 * protocol-relative forms — "//host" and "/\host", which browsers normalise to
 * the same thing — without a list of prefixes to keep complete.
 */
function inAppPath(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.startsWith("/")) return undefined;
  try {
    return new URL(value, window.location.origin).origin === window.location.origin ? value : undefined;
  } catch {
    return undefined;
  }
}
