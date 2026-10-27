import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TaskaApi } from "../api/TaskaApi";
import { ApiError } from "../api/rest/RestTaskaApi";
import type { OAuthExchangeResult } from "../domain/types";
import { forgetOAuthCallback, holdOAuthCallback, rememberOAuthAttempt } from "../lib/oauthCallback";
import { AuthCallbackScreen } from "./AuthCallbackScreen";

/**
 * `/auth/callback` (TAS-426, DESIGN.md §4.31) against a fake `TaskaApi`: the
 * exchange made exactly once, what each answer leads to, and the name step.
 */
const { fakeApi, exchangeState, signupStep } = vi.hoisted(() => {
  const exchangeState = {
    calls: [] as string[],
    answer: undefined as unknown,
    refusal: undefined as Error | undefined,
    hold: false,
    release: () => {},
  };
  const signupStep = { calls: [] as { signupToken: string; displayName: string }[], refusal: undefined as Error | undefined };
  const api = {
    hasSession: () => false,
    exchangeOAuthCode: async (code: string) => {
      exchangeState.calls.push(code);
      if (exchangeState.hold) await new Promise<void>((resolve) => (exchangeState.release = resolve));
      if (exchangeState.refusal) throw exchangeState.refusal;
      return exchangeState.answer;
    },
    completeOAuthSignup: async (input: { signupToken: string; displayName: string }) => {
      signupStep.calls.push(input);
      if (signupStep.refusal) throw signupStep.refusal;
      return { accessToken: "a", refreshToken: "r", expiresIn: 1 };
    },
    oauthStartUrl: (provider: string, returnTo: string) => `https://api.example/${provider}/start?returnTo=${returnTo}`,
  };
  return { fakeApi: api as unknown as TaskaApi, exchangeState, signupStep };
});

vi.mock("../api/client", () => ({ taskaApi: fakeApi }));

function Where() {
  const location = useLocation();
  return (
    <>
      <output data-testid="where">{location.pathname}</output>
      <output data-testid="where-state">{JSON.stringify(location.state)}</output>
    </>
  );
}

function renderCallback({ strict = false } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(["projects"], [{ id: "somebody-elses" }]);
  const tree = (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/login", "/auth/callback"]} initialIndex={1}>
        <Routes>
          <Route path="/auth/callback" element={<AuthCallbackScreen theme="light" toggleTheme={() => {}} />} />
          <Route path="*" element={null} />
        </Routes>
        <Where />
      </MemoryRouter>
    </QueryClientProvider>
  );
  render(strict ? <StrictMode>{tree}</StrictMode> : tree);
  return queryClient;
}

const signedIn = (returnTo: string): OAuthExchangeResult => ({ status: "SIGNED_IN", returnTo });
const signupRequired = (
  suggestedDisplayName: string | null = "New Person",
  provider = "GITHUB",
  returnTo = "/projects",
): OAuthExchangeResult => ({
  status: "SIGNUP_REQUIRED",
  returnTo,
  signup: { signupToken: "step-1", provider, email: "new@example.com", suggestedDisplayName },
});

afterEach(() => {
  // A held exchange is let go, so its flight does not outlive the case.
  exchangeState.release();
  forgetOAuthCallback();
  window.sessionStorage.clear();
  Object.assign(exchangeState, { calls: [], answer: undefined, refusal: undefined, hold: false, release: () => {} });
  Object.assign(signupStep, { calls: [], refusal: undefined });
});

describe("AuthCallbackScreen, the exchange", () => {
  it("sends the code exactly once under StrictMode's double effects, and says only who it is signing in with meanwhile", async () => {
    rememberOAuthAttempt({ provider: "GOOGLE", tab: "signin", returnTo: "/projects/p-1/board" });
    holdOAuthCallback({ code: "the-code" });
    exchangeState.hold = true;
    exchangeState.answer = signedIn("/projects/p-1/board");
    renderCallback({ strict: true });

    // `.auth-exchanging` rather than the role: the probe's `<output>`s are statuses too.
    const line = await waitFor(() => document.querySelector(".auth-exchanging")!);
    expect(line).toHaveAttribute("role", "status");
    expect(line).toHaveTextContent("Signing you in with Google");
    expect(document.querySelector(".value-skeleton, [aria-busy]")).toBeNull();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();

    await act(async () => exchangeState.release());

    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/projects/p-1/board"));
    expect(exchangeState.calls).toEqual(["the-code"]);
  });

  it("says «Signing you in» when the attempt was not remembered", async () => {
    holdOAuthCallback({ code: "c-plain" });
    exchangeState.hold = true;
    renderCallback();
    await waitFor(() => expect(document.querySelector(".auth-exchanging")).toHaveTextContent(/^Signing you in$/));
  });

  it("drops the cache of whoever was here before, and goes on to /projects when returnTo is not an in-app path", async () => {
    holdOAuthCallback({ code: "c-evil" });
    exchangeState.answer = signedIn("https://evil.example/x");
    const queryClient = renderCallback();

    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/projects"));
    expect(queryClient.getQueryData(["projects"])).toBeUndefined();
    expect(window.sessionStorage.getItem("taska.oauthAttempt")).toBeNull();
  });

  it("takes a refusal to /login with its reason, provider, tab and request id, and the page it was to return to, never retrying it", async () => {
    rememberOAuthAttempt({ provider: "GITHUB", tab: "signup", returnTo: "/projects/p-1/board?q=1" });
    holdOAuthCallback({ code: "c-blocked" });
    exchangeState.refusal = new ApiError("Account is blocked", "PERMISSION_DENIED", 403, "req-ex", undefined, {
      reason: "ACCOUNT_BLOCKED",
    });
    renderCallback({ strict: true });

    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/login"));
    expect(JSON.parse(screen.getByTestId("where-state").textContent!)).toEqual({
      providerRefusal: {
        reason: "ACCOUNT_BLOCKED",
        provider: "GITHUB",
        tab: "signup",
        message: null,
        requestId: "req-ex",
        retryAfterSeconds: null,
        lockedUntil: null,
      },
      // The next password sign-in still goes back where the guard sent the reader from.
      from: "/projects/p-1/board?q=1",
    });
    expect(exchangeState.calls).toEqual(["c-blocked"]);
  });

  it("takes ?error= to /login without a request, keeping only a known reason", async () => {
    holdOAuthCallback({ error: "EMAIL_NOT_VERIFIED" });
    renderCallback();
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/login"));
    expect(JSON.parse(screen.getByTestId("where-state").textContent!).providerRefusal.reason).toBe("EMAIL_NOT_VERIFIED");
    expect(exchangeState.calls).toEqual([]);
  });

  it("carries the attempt's returnTo to /login as from with an ?error= refusal, and nothing that is not an in-app path", async () => {
    rememberOAuthAttempt({ provider: "APPLE", tab: "signin", returnTo: "/projects/p-2/board" });
    holdOAuthCallback({ error: "ACCOUNT_BLOCKED" });
    renderCallback();
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/login"));
    expect(JSON.parse(screen.getByTestId("where-state").textContent!)).toMatchObject({
      providerRefusal: { reason: "ACCOUNT_BLOCKED", provider: "APPLE" },
      from: "/projects/p-2/board",
    });
  });

  it("drops a returnTo that is not an in-app path rather than carry it to /login", async () => {
    rememberOAuthAttempt({ provider: "APPLE", tab: "signin", returnTo: "https://evil.example/x" });
    holdOAuthCallback({ error: "ACCOUNT_BLOCKED" });
    renderCallback();
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/login"));
    expect(JSON.parse(screen.getByTestId("where-state").textContent!)).not.toHaveProperty("from");
  });

  it("goes to /login with nothing held — a reload, a typed address", async () => {
    renderCallback();
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/login"));
    expect(screen.getByTestId("where-state")).toHaveTextContent("null");
  });
});

describe("AuthCallbackScreen, the name step", () => {
  let codes = 0;
  const openStep = async (suggested: string | null = "New Person", provider = "GITHUB", returnTo = "/projects") => {
    codes += 1;
    holdOAuthCallback({ code: `c-step-${codes}` });
    exchangeState.answer = signupRequired(suggested, provider, returnTo);
    renderCallback();
    await screen.findByRole("heading", { name: "Finish creating your account" });
  };

  it("names the provider in words, shows the address read-only, and starts in Name with the offered name", async () => {
    await openStep();

    expect(screen.getByText("You’re signing up with your GitHub account.")).toBeVisible();
    const email = screen.getByLabelText("Email");
    expect(email).toHaveValue("new@example.com");
    expect(email).toHaveAttribute("readonly");
    expect(email).toHaveAttribute("autocomplete", "email");
    const name = screen.getByLabelText("Name");
    expect(name).toHaveValue("New Person");
    await waitFor(() => expect(name).toHaveFocus());
    expect(name).toHaveAccessibleDescription("Shown to the people you work with. You can change it later in Settings.");
    expect(screen.getByRole("button", { name: "Create account" })).toHaveAttribute("type", "submit");
    expect(screen.getByRole("button", { name: "Back to sign in" })).toBeVisible();
  });

  it("holds a name with a reason, sends the trimmed name once, and goes on signed in", async () => {
    await openStep(null);
    const name = screen.getByLabelText("Name");
    expect(name).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(name).toHaveAccessibleDescription("Enter a name.");
    expect(signupStep.calls).toEqual([]);

    fireEvent.change(name, { target: { value: "  Rosa  " } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/projects"));
    expect(signupStep.calls).toEqual([{ signupToken: "step-1", displayName: "Rosa" }]);
  });

  it("keeps the form for the name's refusal and the 429, and says an unreasoned failure in its own words", async () => {
    await openStep();
    signupStep.refusal = new ApiError("Display name must contain…", "INVALID_ARGUMENT", 400, "req-n", undefined, {
      reason: "DISPLAY_NAME_INVALID",
    });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Display name must contain…");
    expect(screen.getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");

    signupStep.refusal = new ApiError("Too many", "RESOURCE_EXHAUSTED", 429, "req-t", undefined, { retryAfterSeconds: "45" });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Too many attempts. Try again in 45 seconds."));

    signupStep.refusal = new ApiError("Internal error", "INTERNAL", 500, "req-5");
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Your account was not created."));
    expect(screen.getByText("Internal error")).toBeVisible();
    expect(screen.getByLabelText("Name")).toHaveValue("New Person");
    expect(screen.getByTestId("where")).toHaveTextContent("/auth/callback");
  });

  it("takes the form away when the step expired, with the sentence focused, the provider's button and the way back", async () => {
    await openStep();
    signupStep.refusal = new ApiError("Invalid signup token", "UNAUTHENTICATED", 401, "req-x", undefined, {
      reason: "STATE_INVALID",
    });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "This sign-up step expired after 15 minutes, so your account was not created. Continue with GitHub again to start over.",
    );
    await waitFor(() => expect(alert.closest(".auth-refusal")).toHaveFocus());
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continue with GitHub" })).toHaveAttribute(
      "href",
      "https://api.example/GITHUB/start?returnTo=/projects",
    );
    fireEvent.click(screen.getByRole("button", { name: "Back to sign in" }));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/login"));
  });

  it("says the account was chosen without naming a provider it was not told", async () => {
    await openStep("New Person", "");
    expect(screen.getByText("You’re signing up with the account you chose.")).toBeVisible();
  });

  it("sends a reader whose expired step names no provider it can draw back to sign in, with no provider button", async () => {
    await openStep("New Person", "OKTA");
    signupStep.refusal = new ApiError("Invalid signup token", "UNAUTHENTICATED", 401, "req-x", undefined, {
      reason: "STATE_INVALID",
    });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This sign-up step expired after 15 minutes, so your account was not created. Go back to sign in to start over.",
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back to sign in" })).toBeVisible();
  });

  it("keeps the page the flow was to return to on the way back to sign in", async () => {
    await openStep("New Person", "GITHUB", "/projects/p-3/board");
    fireEvent.click(screen.getByRole("button", { name: "Back to sign in" }));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/login"));
    expect(JSON.parse(screen.getByTestId("where-state").textContent!)).toEqual({ from: "/projects/p-3/board" });
  });

  it("takes a refusal that spent the step to /login with it", async () => {
    await openStep();
    signupStep.refusal = new ApiError("Signup is disabled", "PERMISSION_DENIED", 403, "req-off", undefined, {
      reason: "SIGNUP_DISABLED",
    });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/login"));
    expect(JSON.parse(screen.getByTestId("where-state").textContent!).providerRefusal).toMatchObject({
      reason: "SIGNUP_DISABLED",
      provider: "GITHUB",
      requestId: "req-off",
    });
    expect(JSON.parse(screen.getByTestId("where-state").textContent!).from).toBe("/projects");
  });
});
