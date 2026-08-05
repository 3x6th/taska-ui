import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { taskaApi } from "../api/client";
import type { LoginRedirectState } from "../components/RequireSession";
import { DEFAULT_SIGNED_IN_ROUTE } from "../components/RequireSession";
import { TaskaLogo } from "../components/TaskaLogo";
import { ThemeToggle } from "../components/ThemeToggle";
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
            {submit.isError ? <div className="form-error">{submit.error.message}</div> : null}
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
