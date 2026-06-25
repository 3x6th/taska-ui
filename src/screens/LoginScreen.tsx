import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { taskaApi } from "../api/client";
import { TaskaLogo } from "../components/TaskaLogo";
import { ThemeToggle } from "../components/ThemeToggle";
import type { ScreenProps } from "./App";

type AuthMode = "signin" | "invite";

interface LoginScreenProps extends ScreenProps {
  initialMode: AuthMode;
}

export function LoginScreen({ theme, toggleTheme, initialMode }: LoginScreenProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState("anna@example.com");
  const [password, setPassword] = useState("CorrectHorse123!");
  const [inviteToken, setInviteToken] = useState("invite-token-from-email");
  const [newPassword, setNewPassword] = useState("CorrectHorse123!");

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
      navigate("/projects");
    },
  });

  return (
    <main className="auth-screen">
      <div className="auth-glow" />
      <div className="auth-card-wrap">
        <TaskaLogo />
        <section className="auth-card">
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
                  <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" />
                </label>
                <label className="field">
                  <span>Password</span>
                  <input
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    type="password"
                    autoComplete="current-password"
                  />
                </label>
                <button className="primary-button auth-submit" disabled={submit.isPending} type="submit">
                  {submit.isPending ? "Signing in" : "Sign in"}
                </button>
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
                  />
                </label>
                <label className="field">
                  <span>New password</span>
                  <input
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    type="password"
                    autoComplete="new-password"
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
      </div>
      <div className="auth-theme">
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
      </div>
    </main>
  );
}
