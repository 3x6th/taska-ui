import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff } from "lucide-react";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { taskaApi } from "../api/client";
import { apiErrorFacts, isAccountLocked } from "../api/errors";
import type { LoginRedirectState } from "../components/RequireSession";
import { DEFAULT_SIGNED_IN_ROUTE } from "../components/RequireSession";
import { ErrorNote } from "../components/ErrorNote";
import { TaskaLogo } from "../components/TaskaLogo";
import { ThemeToggle } from "../components/ThemeToggle";
import { formatLockDeadline, lockedUntilOf } from "../lib/accountLock";
import {
  forgetInviteToken,
  heldInviteToken,
  inviteTokenFromInput,
  subscribeInviteToken,
} from "../lib/inviteLink";
import type { ScreenProps } from "./App";

type AuthMode = "signin" | "invite";

interface LoginScreenProps extends ScreenProps {
  initialMode: AuthMode;
}

/**
 * The password policy as a person reads it, under New password (DESIGN.md
 * §4.27). The numbers are auth-service's default policy (`validation.password`
 * in its application.yml, backend #204); the stand may configure others, and
 * when it refuses, its own sentence is printed instead of this one.
 */
const PASSWORD_HINT = "At least 8 characters, with an uppercase letter, a digit and a symbol.";

/**
 * What the invite tab says for the server's one 401 (§4.27). The server's own
 * "Invalid or expired token" names no way out, and the 401 covers four causes
 * it does not tell apart — expired, already used, revoked by a newer
 * invitation, an account that is no longer invited.
 */
const INVITE_LINK_DEAD =
  "This invitation link no longer works — it expired, was used, or was replaced by a newer one. If you already set a password, sign in; otherwise ask the person who invited you to send a new invitation.";

/**
 * The login card, both tabs (DESIGN.md §4.27, TAS-208).
 *
 * Accepting an invitation **opens no session**: `POST /auth/invitations/accept`
 * answers 204 with no tokens, and since backend #204 the contract says the
 * client signs in afterwards like anybody else. So a 204 replaces the route
 * with `/login`, says the password is set, and puts focus in Email — and reads
 * nothing about the account, because nobody is signed in to read it. Before
 * TAS-208 this called `GET /users/me` here, which answered 401 with no session
 * and, under somebody else's, opened *their* projects.
 *
 * Somebody else's session is told about on the invite tab and signed out of at
 * submit, before the request — never on landing, which would end a session
 * for a link opened by accident.
 */
export function LoginScreen({ theme, toggleTheme, initialMode }: LoginScreenProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const redirect = (location.state ?? null) as LoginRedirectState | null;
  const from = inAppPath(redirect?.from);
  const capturedToken = useSyncExternalStore(subscribeInviteToken, heldInviteToken);
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [typedToken, setTypedToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  // Read once: a session held when the form opened is the one the notice is
  // about, and the press that signs out of it is what retires the notice —
  // not a re-read that might race the sign-out.
  const [signedInElsewhere, setSignedInElsewhere] = useState(() => taskaApi.hasSession());
  const [activated, setActivated] = useState(Boolean(redirect?.activated));
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const newPasswordRef = useRef<HTMLInputElement>(null);
  const noticeId = useId();
  const tokenHintId = useId();
  const passwordHintId = useId();
  const newPasswordId = useId();
  const typedTokenId = useId();

  // A link that arrives while the card is already up — a hash change on the
  // Pages build, handed over by `App` — lands on the tab it is for. Adjusted
  // during render, which commits once, rather than in an effect that would
  // paint the sign-in tab first.
  const [tokenSeen, setTokenSeen] = useState(capturedToken);
  if (tokenSeen !== capturedToken) {
    setTokenSeen(capturedToken);
    if (capturedToken !== null) setMode("invite");
  }

  // Only the session that died without being asked needs explaining: a login
  // form after clicking a private link surprises nobody, and a sentence there
  // is one more thing to read on a screen that already asks for two. And the
  // explanation only belongs over the sign-in form: "Your session expired. Sign
  // in to continue." above a form headed "Activate account" describes neither.
  const expiredNotice = mode === "signin" && redirect?.expired ? "Your session expired. Sign in to continue." : null;
  const activatedNotice = mode === "signin" && activated ? "Password set. Sign in with your email and new password." : null;
  const foreignSessionNotice =
    mode === "invite" && signedInElsewhere
      ? "You’re signed in on this browser. Activating this invitation signs you out first."
      : null;

  // Where the reader starts, decided from what brought them here: on mount,
  // and again on an arrival that did not remount this screen — `/invite` to
  // `/login` after an activation is one, wherever the two routes render the
  // same component in the same place. A fresh object per request, so asking
  // for the same field twice still moves focus.
  const [focusRequest, setFocusRequest] = useState<{ target: "notice" | "email" | "newPassword" } | null>(() => {
    const target = expiredNotice
      ? "notice"
      : activatedNotice
        ? "email"
        : initialMode === "invite" && heldInviteToken()
          ? "newPassword"
          : null;
    return target ? { target } : null;
  });
  const [arrival, setArrival] = useState(location.key);
  if (arrival !== location.key) {
    setArrival(location.key);
    if (redirect?.activated) {
      setMode("signin");
      setActivated(true);
      setNewPassword("");
      setFocusRequest({ target: "email" });
    }
  }
  useEffect(() => {
    // The expiry redirect happened without the user asking, and focus would
    // otherwise stay on <body> with nothing announced (§7). A live region
    // would not help: that node mounts with its text already in it, so there
    // is no change to announce — moving focus is what reads the sentence out.
    // After an activation the sentence is tied to Email instead, and focus
    // there reads both (§4.27). A captured link needs only the password.
    if (focusRequest?.target === "notice") noticeRef.current?.focus();
    else if (focusRequest?.target === "email") emailRef.current?.focus();
    else if (focusRequest?.target === "newPassword") newPasswordRef.current?.focus();
  }, [focusRequest]);

  // Read once, then taken out of the history entry: router state outlives a
  // reload, and a reload of `/login` would otherwise say "Password set" again
  // and take focus to Email a second time, for an activation long past. The
  // notice itself is this screen's state from here on, and goes the way §4.27
  // says it goes.
  const activatedArrival = Boolean(redirect?.activated);
  useEffect(() => {
    if (activatedArrival) navigate(location.pathname, { replace: true, state: null });
  }, [activatedArrival, location.pathname, navigate]);

  const switchTo = (next: AuthMode) => {
    setMode(next);
    setActivated(false);
    submit.reset();
  };

  const submit = useMutation({
    mutationFn: async (): Promise<"signedIn" | "activated"> => {
      if (mode === "signin") {
        await taskaApi.login({ email, password });
        queryClient.setQueryData(["me"], await taskaApi.getCurrentUser());
        return "signedIn";
      }
      // Out of somebody else's session first, and before the request rather
      // than after it: a 401 from the activation must not read as that
      // session dying (§5.1), and nothing cached for it belongs to whoever is
      // activating. The notice above said this would happen.
      if (taskaApi.hasSession()) {
        await taskaApi.logout();
        queryClient.clear();
        setSignedInElsewhere(false);
      }
      await taskaApi.acceptInvitation({
        token: capturedToken ?? inviteTokenFromInput(typedToken),
        newPassword,
      });
      return "activated";
    },
    onMutate: () => setActivated(false),
    onSuccess: async (outcome) => {
      if (outcome === "activated") {
        // The link is spent, and nobody is signed in: the sign-in form, with
        // a sentence saying so. `replace`, so Back does not return to a form
        // whose link no longer works.
        forgetInviteToken();
        navigate("/login", { replace: true, state: { activated: true } satisfies LoginRedirectState });
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      // Back to whatever the guard interrupted, and `replace` so Back does not
      // land on the login form of a session that already exists.
      navigate(from ?? DEFAULT_SIGNED_IN_ROUTE, { replace: true });
    },
  });

  const passwordRefused = mode === "invite" && submit.isError && isPasswordRefusal(submit.error);
  const notice = expiredNotice ?? activatedNotice ?? foreignSessionNotice;

  return (
    <main className="auth-screen">
      <div className="auth-glow" />
      <div className="auth-card-wrap">
        <TaskaLogo />
        <section className="auth-card">
          {notice ? (
            <p
              className="auth-notice"
              id={noticeId}
              ref={noticeRef}
              // Focusable only as the expiry's own announcement; the other two
              // are read through the control they describe, or simply read.
              tabIndex={expiredNotice ? -1 : undefined}
            >
              {notice}
            </p>
          ) : null}
          <div className="segmented">
            <button className={mode === "signin" ? "is-active" : ""} onClick={() => switchTo("signin")} type="button">
              Sign in
            </button>
            <button className={mode === "invite" ? "is-active" : ""} onClick={() => switchTo("invite")} type="button">
              Accept invite
            </button>
          </div>

          <form
            className="form-stack"
            onSubmit={(event) => {
              event.preventDefault();
              // The guard `aria-disabled` on the invite button does not
              // enforce by itself.
              if (submit.isPending) return;
              submit.mutate();
            }}
          >
            {mode === "signin" ? (
              <>
                <label className="field">
                  <span>Email</span>
                  <input
                    aria-describedby={activatedNotice ? noticeId : undefined}
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    ref={emailRef}
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
                {submit.isError ? <LoginFailure error={submit.error} mode={mode} /> : null}
                <p className="auth-hint">Forgot your password? Taska has no password reset yet.</p>
              </>
            ) : (
              <>
                <p className="invite-note">Choose a password to activate your Taska account.</p>
                {/* No token field at all once the link brought one (§4.27): the
                    reader cannot correct it, and 43 characters invite study. */}
                {capturedToken === null ? (
                  <div className="field">
                    <label htmlFor={typedTokenId}>Invitation token</label>
                    <input
                      aria-describedby={tokenHintId}
                      autoComplete="off"
                      className="mono-input"
                      id={typedTokenId}
                      onChange={(event) => setTypedToken(event.target.value)}
                      spellCheck={false}
                      value={typedToken}
                    />
                    <p className="auth-field-hint" id={tokenHintId}>
                      Open the link in your invitation email — it fills this in.
                    </p>
                  </div>
                ) : null}
                <div className="field">
                  <label htmlFor={newPasswordId}>New password</label>
                  <div className="password-field">
                    <input
                      aria-describedby={passwordHintId}
                      aria-invalid={passwordRefused || undefined}
                      autoComplete="new-password"
                      id={newPasswordId}
                      onChange={(event) => setNewPassword(event.target.value)}
                      ref={newPasswordRef}
                      type={showNewPassword ? "text" : "password"}
                      value={newPassword}
                    />
                    {/* Required, not a nicety (§4.27): there is one field, no
                        reset, and a typo here locks the account for good. */}
                    <button
                      aria-label="Show password"
                      aria-pressed={showNewPassword}
                      className="icon-button password-toggle"
                      onClick={() => setShowNewPassword((shown) => !shown)}
                      type="button"
                    >
                      {showNewPassword ? <EyeOff aria-hidden="true" size={14} /> : <Eye aria-hidden="true" size={14} />}
                    </button>
                  </div>
                  <p className="auth-field-hint" id={passwordHintId}>
                    {PASSWORD_HINT}
                  </p>
                </div>
                {/* `aria-disabled`, not `disabled` (§4.21): a button that
                    disabled itself would drop the keyboard reader's focus to
                    <body> for the length of the request. */}
                <button aria-disabled={submit.isPending || undefined} className="primary-button auth-submit" type="submit">
                  {submit.isPending ? "Activating" : "Activate account"}
                </button>
                {submit.isError ? <InviteFailure error={submit.error} /> : null}
                {/* Not under the dead-link alert, which already says to ask
                    for a new invitation — twice in a row would be the same
                    advice in two voices. */}
                {submit.isError && isDeadLink(submit.error) ? null : (
                  <p className="auth-hint">Link expired? Ask the person who invited you to send a new one.</p>
                )}
              </>
            )}
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
 * Whether the activation was refused for the password rather than the link —
 * the one refusal whose field can be pointed at (`aria-invalid`, §4.27).
 *
 * **Keyed on the sentence**, which this file otherwise avoids, and the reason
 * is that nothing else carries it: all six 400s of the route share
 * `INVALID_ARGUMENT`, and the policy's four begin "Password" where the token's
 * two begin "Token" and "Invite token" (`PasswordValidator`,
 * `AuthServiceImpl.setPasswordByToken`, develop `e8a8d316b326`). A reworded
 * sentence costs only the field marker: the sentence itself is still printed.
 */
function isPasswordRefusal(error: unknown): boolean {
  const { code, status, message } = apiErrorFacts(error);
  return (code === "INVALID_ARGUMENT" || status === 400) && message !== null && message.startsWith("Password");
}

/**
 * What a refused activation says (§4.27): the 401 in this screen's own words,
 * every other refusal in the server's, and the request id under either. An
 * alert, because the reader is looking at a button that just stopped saying
 * "Activating" and the answer is not where focus is.
 */
function InviteFailure({ error }: { error: unknown }) {
  const { message, requestId } = apiErrorFacts(error);
  return (
    <ErrorNote live="alert" requestId={requestId}>
      {isDeadLink(error) ? INVITE_LINK_DEAD : (message ?? "The invitation could not be activated.")}
    </ErrorNote>
  );
}

/** The activation's one 401 — the link is dead, whichever of the four ways (§4.27). */
function isDeadLink(error: unknown): boolean {
  const { status, code } = apiErrorFacts(error);
  return status === 401 || code === "UNAUTHENTICATED";
}

/**
 * What a refused sign-in says.
 *
 * Two branches and one rule between them: the branch is chosen by the response
 * code (`isAccountLocked`, src/api/errors.ts) and never by the wording. The
 * deadline comes from `details.lockedUntil` since backend PR #199, and from the
 * prose only when that is missing (`lockedUntilOf`, src/lib/accountLock.ts) —
 * either way, never to decide what the reader is told.
 *
 * **The fallback is the server's own sentence, verbatim.** When the deadline
 * cannot be read — no usable `details` and a reworded message, or a moment
 * that has already passed — this prints `Account is locked until
 * 2026-09-22T11:55:50.398486Z. Try again later.` exactly as it arrived. That is the ugliness TAS-237 was
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
  // the reader rather than the predicate — that refusal carries no
  // `details` and no future instant in its sentence, so `lockedUntilOf`
  // answers `null` and the server's own wording is printed verbatim. Correct,
  // and correct for a reason one layer below the one this branch claims.
  //
  // Read at render rather than held in state, so a lock that expires while the
  // form is still open falls back to the raw sentence on the next paint
  // instead of going on promising a moment that has gone. No timer wakes it —
  // the reader retrying is what re-renders this, and that is the moment it
  // matters.
  const lockedUntil = mode === "signin" && isAccountLocked(error) ? lockedUntilOf(error) : null;

  // The request id is owed on both branches and was missing from this screen
  // until TAS-237: a refusal here is as likely to need looking up in the
  // gateway log as one from any dialog, and `EditProjectModal` has paired the
  // id with the sentence since §5.6 asked for it. Mock mode never carries one.
  return (
    <ErrorNote requestId={requestId}>
      {lockedUntil ? (
        // Two lines, the second centred under the first, per the story. The
        // centring is `.auth-lock`'s own — `ErrorNote` is shared with the issue
        // panel and the project dialogs and sets no alignment for anyone.
        <span className="auth-lock">
          <LockDeadline until={lockedUntil} />
          <span>Try again later.</span>
        </span>
      ) : (
        (message ?? "Sign-in failed.")
      )}
    </ErrorNote>
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
