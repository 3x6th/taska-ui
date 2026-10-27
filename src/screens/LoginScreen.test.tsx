import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AcceptInvitationInput, TaskaApi } from "../api/TaskaApi";
import { ApiError } from "../api/rest/RestTaskaApi";
import { formatLockDeadline } from "../lib/accountLock";
import { forgetInviteToken, holdInviteToken } from "../lib/inviteLink";
import { LoginScreen } from "./LoginScreen";

/**
 * The sign-in failure as the screen draws it. `e2e/login-lock.spec.ts` covers
 * the lock end to end against the mock, whose refusal carries the deadline in
 * both places at once — so nothing there can tell which of the two the screen
 * read. These cases take the two apart.
 */
const { fakeApi, refuseWith, inviteState, loginState, previewState, methodsState, signupState } = vi.hoisted(() => {
  const state: { refusal?: Error } = {};
  /** A sign-in held open by hand, so its in-flight state can be looked at; `me`, when set, is who signed in. */
  const loginState = { hold: false, release: () => {}, calls: 0, me: undefined as unknown };
  const inviteState = {
    session: false,
    refusal: undefined as Error | undefined,
    /** Resolves the activation by hand, so the in-flight state can be looked at. */
    hold: false,
    release: () => {},
    calls: [] as string[],
    accepted: [] as AcceptInvitationInput[],
  };
  /** `POST /auth/invitations/preview` (TAS-425): what it answers, what it refuses, and the tokens it was asked about. */
  const previewState = {
    refusal: undefined as Error | undefined,
    hold: false,
    release: () => {},
    tokens: [] as string[],
    /** The link's kind (TAS-426): an admin's invitation unless a case says it is a sign-up link. */
    kind: "INVITATION",
  };
  /** `GET /auth/methods` (TAS-426): the stand's answer unless a case opens it. */
  const methodsState = {
    answer: { signupEnabled: false, providers: [] as string[] } as { signupEnabled: boolean; providers: string[] },
    hold: false,
    release: () => {},
    calls: 0,
    refusal: undefined as Error | undefined,
  };
  /** `POST /auth/signup`: what it was sent, and what it answers. */
  const signupState = {
    sent: [] as { email: string; displayName: string }[],
    refusal: undefined as Error | undefined,
    hold: false,
    release: () => {},
  };
  const api = {
    getAuthMethods: async () => {
      methodsState.calls += 1;
      if (methodsState.hold) await new Promise<void>((resolve) => (methodsState.release = resolve));
      if (methodsState.refusal) throw methodsState.refusal;
      return structuredClone(methodsState.answer);
    },
    requestSignup: async (input: { email: string; displayName: string }) => {
      signupState.sent.push(input);
      if (signupState.hold) await new Promise<void>((resolve) => (signupState.release = resolve));
      if (signupState.refusal) throw signupState.refusal;
    },
    oauthStartUrl: (provider: string, returnTo: string) =>
      `https://api.example/auth/oauth/${provider.toLowerCase()}/start?returnTo=${encodeURIComponent(returnTo)}`,
    login: async () => {
      loginState.calls += 1;
      if (loginState.hold) await new Promise<void>((resolve) => (loginState.release = resolve));
      if (state.refusal) throw state.refusal;
      return { accessToken: "a", refreshToken: "r" };
    },
    getCurrentUser: async () => {
      inviteState.calls.push("getCurrentUser");
      if (loginState.me) return loginState.me;
      throw new Error("not reached");
    },
    hasSession: () => inviteState.session,
    logout: async () => {
      inviteState.calls.push("logout");
      inviteState.session = false;
    },
    previewInvitation: async (token: string) => {
      previewState.tokens.push(token);
      if (previewState.hold) await new Promise<void>((resolve) => (previewState.release = resolve));
      if (previewState.refusal) throw previewState.refusal;
      return { email: "leo@example.com", displayName: "Leo Fischer", kind: previewState.kind, expiresAt: "2026-11-01T10:00:00Z" };
    },
    acceptInvitation: async (input: AcceptInvitationInput) => {
      inviteState.calls.push(`acceptInvitation:${String(inviteState.session)}`);
      inviteState.accepted.push(input);
      if (inviteState.hold) await new Promise<void>((resolve) => (inviteState.release = resolve));
      if (inviteState.refusal) throw inviteState.refusal;
    },
  };
  return {
    fakeApi: api as unknown as TaskaApi,
    refuseWith: (refusal: Error | undefined) => {
      state.refusal = refusal;
    },
    inviteState,
    loginState,
    previewState,
    methodsState,
    signupState,
  };
});

vi.mock("../api/client", () => ({ taskaApi: fakeApi }));

// The card remembers the last methods' answer (TAS-426) and a provider press
// remembers its attempt; neither may leak from one case into the next.
afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  Object.assign(methodsState, {
    answer: { signupEnabled: false, providers: [] },
    hold: false,
    release: () => {},
    calls: 0,
    refusal: undefined,
  });
  Object.assign(signupState, { sent: [], refusal: undefined, hold: false, release: () => {} });
  loginState.me = undefined;
});

function renderLogin() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/login"]}>
        <LoginScreen initialMode="signin" logoutPending={false} onLogout={() => {}} theme="light" toggleTheme={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function signIn() {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "omar@example.com" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "anything" } });
  fireEvent.submit(screen.getByLabelText("Email").closest("form")!);
}

describe("LoginScreen, a locked account", () => {
  it("reads the deadline from details.lockedUntil when the sentence carries none (backend PR #199)", async () => {
    // A sentence with no instant in it at all: the prose reader answers `null`
    // for it, so the deadline on screen can only have come from `details`.
    const until = new Date(Date.now() + 15 * 60 * 1000);
    refuseWith(
      new ApiError("Locked.", "PERMISSION_DENIED", 403, "req-lock", undefined, { lockedUntil: until.toISOString() }),
    );
    renderLogin();

    signIn();

    const deadline = await screen.findByText(formatLockDeadline(until).text);
    expect(deadline.tagName).toBe("TIME");
    expect(deadline).toHaveAttribute("dateTime", until.toISOString());
    expect(screen.getByText(/Account is locked until/)).toBeVisible();
    // The sentence is not what was printed: the branch drew the deadline.
    expect(screen.queryByText("Locked.")).not.toBeInTheDocument();
  });

  it("prints the server's sentence when neither details nor the sentence give a future deadline", async () => {
    refuseWith(
      new ApiError("Locked.", "PERMISSION_DENIED", 403, "req-lock", undefined, {
        lockedUntil: "2020-01-01T00:00:00Z",
      }),
    );
    renderLogin();

    signIn();

    expect(await screen.findByText("Locked.")).toBeVisible();
    expect(screen.queryByText(/Account is locked until/)).not.toBeInTheDocument();
  });
});

/**
 * The sign-in tab since TAS-299 (DESIGN.md §4.27): New password's layout and
 * show-password toggle on Password too, and a submit that keeps focus while it
 * is out.
 */
describe("LoginScreen, signing in", () => {
  afterEach(() => {
    forgetInviteToken();
    refuseWith(undefined);
    Object.assign(loginState, { hold: false, release: () => {}, calls: 0 });
  });

  it("names the field exactly Password, with the toggle beside the field rather than inside its label", () => {
    renderLogin();
    const field = screen.getByLabelText("Password");
    const toggle = screen.getByRole("button", { name: "Show password" });

    // A label wrapping the button would have named the field "Password Show password".
    expect(field).toHaveAccessibleName("Password");
    expect(toggle.closest("label")).toBeNull();
    expect(field.closest(".password-field")).toBe(toggle.closest(".password-field"));
    expect(field).toHaveAttribute("type", "password");
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(toggle);
    expect(field).toHaveAttribute("type", "text");
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(toggle);
    expect(field).toHaveAttribute("type", "password");
  });

  it("says which tab is the current one, and hides a shown password again on every tab change", async () => {
    // A caught link, so the invite tab carries New password (TAS-425: without
    // one it asks for the token first).
    holdInviteToken(TOKEN);
    renderLogin();
    expect(screen.getByRole("tab", { name: "Sign in", selected: true })).toBeVisible();
    expect(screen.getByRole("tab", { name: "Accept invite", selected: false })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "text");

    fireEvent.click(screen.getByRole("tab", { name: "Accept invite" }));
    expect(screen.getByRole("tab", { name: "Accept invite", selected: true })).toBeVisible();
    await previewed();
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(screen.getByLabelText("New password")).toHaveAttribute("type", "text");

    fireEvent.click(screen.getByRole("tab", { name: "Sign in", selected: false }));
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: "Show password" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("tab", { name: "Accept invite" }));
    expect(screen.getByLabelText("New password")).toHaveAttribute("type", "password");
  });

  it("keeps the submit focusable while signing in — aria-disabled, labelled Signing in — and Enter sends nothing more", async () => {
    loginState.hold = true;
    renderLogin();
    // One control by that name and role since TAS-426: the tab is a `tab`.
    const submit = screen.getByRole("button", { name: "Sign in" });
    submit.focus();

    signIn();

    const pending = await screen.findByRole("button", { name: "Signing in" });
    expect(pending).toBe(submit);
    expect(pending).toHaveAttribute("aria-disabled", "true");
    expect(pending).not.toBeDisabled();
    expect(pending).toHaveFocus();
    // A second press, and Enter in a field, while it is out.
    fireEvent.click(pending);
    fireEvent.submit(screen.getByLabelText("Email").closest("form")!);
    expect(loginState.calls).toBe(1);
    refuseWith(new ApiError("Invalid credentials", "UNAUTHENTICATED", 401));
    await act(async () => loginState.release());
    expect(await screen.findByText("Invalid credentials")).toBeVisible();
  });
});

const TOKEN = "Lk3vQ9xW2mTz8RbN4cYp7HfJ1sDg6EaU5oKiVwXqZrM";

function Where() {
  const location = useLocation();
  return (
    <>
      <output data-testid="where">{location.pathname}</output>
      <output data-testid="where-state">{JSON.stringify(location.state)}</output>
    </>
  );
}

/** Both auth routes, as `App` mounts them, so an activation can be followed onto `/login`. */
function renderAuth(path = "/invite", queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })) {
  const screenProps = { logoutPending: false, onLogout: () => {}, theme: "light" as const, toggleTheme: () => {} };
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/login" element={<LoginScreen {...screenProps} initialMode="signin" />} />
          <Route path="/invite" element={<LoginScreen {...screenProps} initialMode="invite" />} />
        </Routes>
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return queryClient;
}

/** The caught layout once the preview has answered: Email filled, Name editable. */
async function previewed() {
  await waitFor(() => expect(screen.getByLabelText("Email")).toHaveValue("leo@example.com"));
}

async function activate(password = "Correct-horse-1") {
  await previewed();
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: "Activate account" }));
}

/**
 * The invite tab (TAS-208, DESIGN.md §4.27). `e2e/invite.spec.ts` walks the
 * same paths against the mock; these pin the screen's half of each one —
 * what it calls, in which order, and what it says.
 */
describe("LoginScreen, accepting an invitation", () => {
  afterEach(() => {
    forgetInviteToken();
    Object.assign(inviteState, { session: false, refusal: undefined, hold: false, calls: [], accepted: [] });
    Object.assign(previewState, { refusal: undefined, hold: false, release: () => {}, tokens: [], kind: "INVITATION" });
  });

  it("shows no token field for a captured link, starts in New password, and says nothing false", async () => {
    holdInviteToken(TOKEN);
    renderAuth();

    expect(screen.queryByLabelText("Invitation token")).not.toBeInTheDocument();
    expect(screen.getByText("Confirm your name and choose a password to activate your Taska account.")).toBeVisible();
    await waitFor(() => expect(screen.getByLabelText("New password")).toHaveFocus());
    expect(screen.getByLabelText("New password")).toHaveAccessibleDescription(
      "At least 8 characters, with an uppercase letter, a digit and a symbol.",
    );
    expect(screen.getByLabelText("New password")).not.toHaveAttribute("placeholder");
    expect(screen.getByText("Link expired? Ask the person who invited you to send a new one.")).toBeVisible();
    // The three sentences TAS-208 was filed about.
    expect(document.body).not.toHaveTextContent("Taska Platform");
    expect(document.body).not.toHaveTextContent("12 characters");
    expect(document.body).not.toHaveTextContent("project admin");
  });

  it("activates, reads no account, and hands over to the sign-in form with a notice and focus in Email", async () => {
    holdInviteToken(TOKEN);
    renderAuth();

    await activate();

    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/login"));
    // The invited name goes with the password, as the preview gave it.
    expect(inviteState.accepted).toEqual([{ token: TOKEN, newPassword: "Correct-horse-1", displayName: "Leo Fischer" }]);
    expect(inviteState.calls).not.toContain("getCurrentUser");
    const notice = screen.getByText("Password set. Sign in with your email and new password.");
    expect(notice).toBeVisible();
    // Not a live region: focus in Email reads it, through the description.
    expect(notice).not.toHaveAttribute("role");
    expect(notice).not.toHaveAttribute("aria-live");
    await waitFor(() => expect(screen.getByLabelText("Email")).toHaveFocus());
    expect(screen.getByLabelText("Email")).toHaveAccessibleDescription(
      "Password set. Sign in with your email and new password.",
    );
    expect(screen.getByText("Forgot your password? Taska has no password reset yet.")).toBeVisible();

    // Read once and taken out of the history entry, so a reload of `/login`
    // does not say "Password set" again — while the notice stays up here.
    await waitFor(() => expect(screen.getByTestId("where-state")).toHaveTextContent("null"));
    expect(screen.getByText("Password set. Sign in with your email and new password.")).toBeVisible();
    expect(screen.getByLabelText("Email")).toHaveFocus();

    // The notice goes with the next tab change.
    fireEvent.click(screen.getByRole("tab", { name: "Accept invite" }));
    fireEvent.click(screen.getByRole("tab", { name: "Sign in" }));
    expect(screen.queryByText("Password set. Sign in with your email and new password.")).not.toBeInTheDocument();
  });

  it("warns about somebody else's session, and signs out of it at submit — before the request, not on landing", async () => {
    inviteState.session = true;
    holdInviteToken(TOKEN);
    const queryClient = renderAuth();
    queryClient.setQueryData(["projects"], [{ id: "theirs" }]);

    expect(
      screen.getByText("You’re signed in on this browser. Activating this invitation signs you out first."),
    ).toBeVisible();
    expect(inviteState.calls).toEqual([]);

    await activate();

    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/login"));
    expect(inviteState.calls).toEqual(["logout", "acceptInvitation:false"]);
    expect(queryClient.getQueryData(["projects"])).toBeUndefined();
  });

  it("says the link no longer works in its own words on a 401, as an alert", async () => {
    inviteState.refusal = new ApiError("Invalid or expired token", "UNAUTHENTICATED", 401, "req-401");
    holdInviteToken(TOKEN);
    renderAuth();

    await activate();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/^This invitation link no longer works — it expired, was used, or was replaced/);
    expect(screen.queryByText("Invalid or expired token")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy request id req-401" })).toBeVisible();
    expect(screen.getByTestId("where")).toHaveTextContent("/invite");
    // The alert already says to ask for a new invitation; the hint under it
    // would say it again.
    expect(screen.queryByText("Link expired? Ask the person who invited you to send a new one.")).not.toBeInTheDocument();
  });

  it("drops the state of an activation it arrived with on mount too, keeping the notice", async () => {
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const screenProps = { logoutPending: false, onLogout: () => {}, theme: "light" as const, toggleTheme: () => {} };
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[{ pathname: "/login", state: { activated: true } }]}>
          <Routes>
            <Route path="/login" element={<LoginScreen {...screenProps} initialMode="signin" />} />
          </Routes>
          <Where />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByText("Password set. Sign in with your email and new password.")).toBeVisible();
    await waitFor(() => expect(screen.getByTestId("where-state")).toHaveTextContent("null"));
    expect(screen.getByText("Password set. Sign in with your email and new password.")).toBeVisible();
    expect(screen.getByLabelText("Email")).toHaveFocus();
  });

  it("prints a password refusal verbatim, marks the field and keeps what was typed", async () => {
    inviteState.refusal = new ApiError("Password must have at least 1 special character", "INVALID_ARGUMENT", 400);
    holdInviteToken(TOKEN);
    renderAuth();

    await activate("Correcthorse1");

    expect(await screen.findByRole("alert")).toHaveTextContent("Password must have at least 1 special character");
    expect(screen.getByLabelText("New password")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("New password")).toHaveValue("Correcthorse1");
    // Any refusal but the dead link keeps the hint under the button.
    expect(screen.getByText("Link expired? Ask the person who invited you to send a new one.")).toBeVisible();
  });

  it("marks the field for the transport's blank-password refusal, and not for its blank-token one", async () => {
    // auth-service's gRPC transport refuses a blank field before the service
    // sees the request, in its own words (TAS-299); the stand never says the
    // service's "Password is required" here.
    inviteState.refusal = new ApiError("body.newPassword must not be blank", "INVALID_ARGUMENT", 400);
    holdInviteToken(TOKEN);
    renderAuth();

    await activate("   ");

    expect(await screen.findByRole("alert")).toHaveTextContent("body.newPassword must not be blank");
    expect(screen.getByLabelText("New password")).toHaveAttribute("aria-invalid", "true");

    inviteState.refusal = new ApiError("body.token must not be blank", "INVALID_ARGUMENT", 400);
    await activate("Correct-horse-1");
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("body.token must not be blank"));
    expect(screen.getByLabelText("New password")).not.toHaveAttribute("aria-invalid");
  });

  it("keeps the button focusable while the request is out — aria-disabled, labelled Activating", async () => {
    inviteState.hold = true;
    holdInviteToken(TOKEN);
    renderAuth();

    await activate();

    const button = await screen.findByRole("button", { name: "Activating" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
    // A second press while it is out sends nothing.
    fireEvent.click(button);
    expect(inviteState.accepted).toHaveLength(1);
    await act(async () => inviteState.release());
  });

  it("shows and hides the new password with a pressed-state toggle", () => {
    holdInviteToken(TOKEN);
    renderAuth();
    const field = screen.getByLabelText("New password");
    const toggle = screen.getByRole("button", { name: "Show password" });

    expect(field).toHaveAttribute("type", "password");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    expect(field).toHaveAttribute("type", "text");
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(toggle);
    expect(field).toHaveAttribute("type", "password");
  });

  it("asks for the token when no link brought one, previews it on Continue, and takes a whole pasted link", async () => {
    renderAuth();
    const field = screen.getByLabelText("Invitation token");

    expect(field).not.toHaveAttribute("placeholder");
    expect(field).toHaveAccessibleDescription("Open the link in your invitation email — it fills this in.");
    expect(screen.getByText("Confirm your name and choose a password to activate your Taska account.")).toBeVisible();
    // Nothing asked for until the link has said whose it is.
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Activate account" })).not.toBeInTheDocument();
    expect(screen.getByText("Link expired? Ask the person who invited you to send a new one.")).toBeVisible();

    fireEvent.change(field, { target: { value: `https://taska.ozero.dev/?token=${TOKEN}` } });
    // Typing alone asks nothing: no debounce.
    expect(previewState.tokens).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    // The typed token becomes a caught one: the field goes, focus is in New password.
    await waitFor(() => expect(screen.getByLabelText("New password")).toHaveFocus());
    expect(previewState.tokens).toEqual([TOKEN]);
    expect(screen.queryByLabelText("Invitation token")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveValue("leo@example.com");
    expect(screen.getByLabelText("Name")).toHaveValue("Leo Fischer");

    await activate();

    await waitFor(() =>
      expect(inviteState.accepted).toEqual([{ token: TOKEN, newPassword: "Correct-horse-1", displayName: "Leo Fischer" }]),
    );
    // Asked once: the caught layout was drawn from Continue's answer.
    expect(previewState.tokens).toEqual([TOKEN]);
  });

  it("says Checking while a typed token is out, and answers a refusal under Continue as an alert, the token kept", async () => {
    previewState.hold = true;
    renderAuth();
    const field = screen.getByLabelText("Invitation token");
    fireEvent.change(field, { target: { value: "dead-token" } });
    fireEvent.submit(field.closest("form")!);

    const button = await screen.findByRole("button", { name: "Checking" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(button);
    expect(previewState.tokens).toEqual(["dead-token"]);

    previewState.refusal = new ApiError("Invalid or expired token", "UNAUTHENTICATED", 401, "req-preview");
    await act(async () => previewState.release());

    expect(await screen.findByRole("alert")).toHaveTextContent(/^This invitation link no longer works/);
    expect(screen.getByRole("button", { name: "Copy request id req-preview" })).toBeVisible();
    expect(screen.getByLabelText("Invitation token")).toHaveValue("dead-token");
    expect(screen.getByLabelText("Invitation token")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "Continue" })).toBeVisible();
    // The alert already says to ask for a new invitation.
    expect(screen.queryByText("Link expired? Ask the person who invited you to send a new one.")).not.toBeInTheDocument();
  });

  it.each([
    [408, "Request timeout"],
    [429, "Too many requests"],
  ])("answers a typed token's %i as a link that could not be checked, not as a bad token", async (status, words) => {
    previewState.refusal = new ApiError(words, "UNAVAILABLE", status, `req-${status}`);
    renderAuth();
    const field = screen.getByLabelText("Invitation token");
    fireEvent.change(field, { target: { value: TOKEN } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("This invitation could not be checked.");
    expect(screen.getByText(words)).toBeVisible();
    expect(screen.getByRole("button", { name: `Copy request id req-${status}` })).toBeVisible();
    expect(field).not.toHaveAttribute("aria-invalid");
    expect(screen.getByText("Link expired? Ask the person who invited you to send a new one.")).toBeVisible();
  });
});

/**
 * The preview of a caught link (TAS-425, DESIGN.md §4.27): the form drawn in
 * its final shape while the preview is out, Email and Name from its answer,
 * and the form taken away by a refusal.
 */
describe("LoginScreen, the invitation's preview", () => {
  afterEach(() => {
    forgetInviteToken();
    Object.assign(inviteState, { session: false, refusal: undefined, hold: false, calls: [], accepted: [] });
    Object.assign(previewState, { refusal: undefined, hold: false, release: () => {}, tokens: [], kind: "INVITATION" });
  });

  it("draws the final form while the preview is out — skeletons in Email and Name, Activate in flight — and fills it", async () => {
    previewState.hold = true;
    holdInviteToken(TOKEN);
    renderAuth();

    const email = screen.getByLabelText("Email");
    const name = screen.getByLabelText("Name");
    expect(previewState.tokens).toEqual([TOKEN]);
    expect(email).toHaveAttribute("readonly");
    expect(email).toHaveAttribute("type", "email");
    expect(email).toHaveAttribute("autocomplete", "username");
    expect(name).toHaveAttribute("readonly");
    expect(email.closest(".field")).toHaveAttribute("aria-busy", "true");
    expect(name.closest(".field")).toHaveAttribute("aria-busy", "true");
    expect(document.querySelectorAll(".invite-value-field .value-skeleton")).toHaveLength(2);
    await waitFor(() => expect(screen.getByLabelText("New password")).toHaveFocus());

    // Activate and Enter send nothing yet.
    const activateButton = screen.getByRole("button", { name: "Activate account" });
    expect(activateButton).toHaveAttribute("aria-disabled", "true");
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "Correct-horse-1" } });
    fireEvent.click(activateButton);
    fireEvent.submit(activateButton.closest("form")!);
    expect(inviteState.accepted).toEqual([]);

    await act(async () => previewState.release());

    await waitFor(() => expect(email).toHaveValue("leo@example.com"));
    expect(email).toHaveAttribute("readonly");
    expect(name).toHaveValue("Leo Fischer");
    expect(name).not.toHaveAttribute("readonly");
    expect(name).toHaveAttribute("autocomplete", "name");
    expect(name).toHaveAccessibleDescription("Shown to the people you work with. You can change it later in Settings.");
    expect(document.querySelectorAll(".invite-value-field .value-skeleton")).toHaveLength(0);
    expect(email.closest(".field")).not.toHaveAttribute("aria-busy");
    // Focus did not move when the answer landed.
    expect(screen.getByLabelText("New password")).toHaveFocus();
    expect(activateButton).not.toHaveAttribute("aria-disabled");
  });

  it("sends the changed name trimmed, and holds Activate on the name while it has a reason against it", async () => {
    holdInviteToken(TOKEN);
    renderAuth();
    await previewed();
    const name = screen.getByLabelText("Name");

    fireEvent.change(name, { target: { value: "   " } });
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAccessibleDescription("Enter a name.");
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "Correct-horse-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Activate account" }));
    expect(name).toHaveFocus();
    expect(inviteState.accepted).toEqual([]);

    fireEvent.change(name, { target: { value: "Leo\tF." } });
    expect(name).toHaveAccessibleDescription("Remove the tab or line break from the name.");

    fireEvent.change(name, { target: { value: "  Leo F.  " } });
    expect(name).not.toHaveAttribute("aria-invalid");
    fireEvent.click(screen.getByRole("button", { name: "Activate account" }));
    await waitFor(() =>
      expect(inviteState.accepted).toEqual([{ token: TOKEN, newPassword: "Correct-horse-1", displayName: "Leo F." }]),
    );
  });

  it("marks Name for the server's name refusal, and prints its sentence", async () => {
    inviteState.refusal = new ApiError(
      "Display name must contain 1 to 128 characters and no control characters or line breaks",
      "INVALID_ARGUMENT",
      400,
      "req-name",
      undefined,
      { reason: "DISPLAY_NAME_INVALID" },
    );
    holdInviteToken(TOKEN);
    renderAuth();

    await activate();

    expect(await screen.findByRole("alert")).toHaveTextContent(/^Display name must contain 1 to 128 characters/);
    expect(screen.getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("New password")).not.toHaveAttribute("aria-invalid");
  });

  it("takes the form away for a dead link: the dead-link sentence and its id, not announced, focus brought to it", async () => {
    inviteState.session = true;
    previewState.hold = true;
    holdInviteToken(TOKEN);
    renderAuth();
    await waitFor(() => expect(screen.getByLabelText("New password")).toHaveFocus());
    expect(screen.getByText("You’re signed in on this browser. Activating this invitation signs you out first.")).toBeVisible();

    previewState.refusal = new ApiError("Invalid or expired token", "UNAUTHENTICATED", 401, "req-dead");
    await act(async () => previewState.release());

    const sentence = await screen.findByText(/^This invitation link no longer works/);
    expect(sentence).not.toHaveAttribute("role");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy request id req-dead" })).toBeVisible();
    for (const label of ["Email", "Name", "New password"]) expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Activate account" })).not.toBeInTheDocument();
    expect(screen.queryByText("Confirm your name and choose a password to activate your Taska account.")).not.toBeInTheDocument();
    expect(screen.queryByText(/Link expired\?/)).not.toBeInTheDocument();
    expect(screen.queryByText(/signed in on this browser/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    const block = document.querySelector(".invite-preview-refusal");
    expect(block).toHaveAttribute("tabindex", "-1");
    expect(block).toHaveFocus();
    // The landing touched nobody's session.
    expect(inviteState.calls).toEqual([]);
  });

  it.each([
    [400, "INVALID_ARGUMENT", "Invalid request parameters"],
    [403, "PERMISSION_DENIED", "Forbidden"],
    [413, "INVALID_ARGUMENT", "Payload too large"],
  ])("prints a rejected preview (%i) in the server's words, with no retry", async (status, code, words) => {
    previewState.refusal = new ApiError(words, code, status, `req-${status}`);
    holdInviteToken(TOKEN);
    renderAuth();

    expect(await screen.findByText(words)).toBeVisible();
    expect(screen.getByRole("button", { name: `Copy request id req-${status}` })).toBeVisible();
    expect(screen.queryByText("This invitation could not be checked.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
  });

  it.each([
    [408, "Request timeout"],
    [429, "Too many requests"],
    [502, "Bad gateway"],
  ])("takes a %i on arrival as a link that could not be checked, with the server's words, the id and Try again", async (status, words) => {
    previewState.refusal = new ApiError(words, "UNAVAILABLE", status, `req-${status}`);
    holdInviteToken(TOKEN);
    renderAuth();

    expect(await screen.findByText("This invitation could not be checked.")).toBeVisible();
    expect(screen.getByText(words)).toBeVisible();
    expect(screen.getByRole("button", { name: `Copy request id req-${status}` })).toBeVisible();
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
    // Found on arrival, not an answer to anything done.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("announces the refusal that answers Try again, and the same sentence again on the next", async () => {
    previewState.refusal = new TypeError("Failed to fetch");
    holdInviteToken(TOKEN);
    renderAuth();

    const arrival = await screen.findByText("This invitation could not be checked.");
    expect(arrival).not.toHaveAttribute("role");
    // Nothing answered, so no words are the server's.
    expect(screen.queryByText("Failed to fetch")).not.toBeInTheDocument();

    // Held while the retry is out: the refusal stays as it was, unannounced.
    previewState.hold = true;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByRole("button", { name: "Checking" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    previewState.refusal = new ApiError("Service unavailable", "UNAVAILABLE", 503, "req-503");
    await act(async () => previewState.release());

    const first = await screen.findByRole("alert");
    expect(first).toHaveTextContent("This invitation could not be checked.");
    expect(screen.getByText("Service unavailable")).toBeVisible();
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();

    previewState.hold = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(previewState.tokens).toHaveLength(3));
    // The same sentence, mounted afresh so that it is said again.
    await waitFor(() => expect(screen.getByRole("alert")).not.toBe(first));
    expect(screen.getByRole("alert")).toHaveTextContent("This invitation could not be checked.");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("offers Try again for a link that could not be checked, says Checking while it is out, and brings the form back", async () => {
    previewState.refusal = new ApiError("Service unavailable", "UNAVAILABLE", 503, "req-503");
    holdInviteToken(TOKEN);
    renderAuth();

    expect(await screen.findByText("This invitation could not be checked.")).toBeVisible();
    expect(screen.getByText("Service unavailable")).toBeVisible();
    expect(screen.getByRole("button", { name: "Copy request id req-503" })).toBeVisible();

    previewState.refusal = undefined;
    previewState.hold = true;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    const checking = await screen.findByRole("button", { name: "Checking" });
    expect(checking).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(checking);
    expect(previewState.tokens).toEqual([TOKEN, TOKEN]);

    await act(async () => previewState.release());

    await waitFor(() => expect(screen.getByLabelText("New password")).toHaveFocus());
    expect(screen.getByLabelText("Email")).toHaveValue("leo@example.com");
  });
});

const OPEN = { signupEnabled: true, providers: ["GOOGLE", "GITHUB", "APPLE"] };

/** The card on one route with a router entry of its own — state included — and the location probe. */
function renderEntry(
  entry: string | { pathname: string; state: unknown },
  queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } }),
) {
  const screenProps = { logoutPending: false, onLogout: () => {}, theme: "light" as const, toggleTheme: () => {} };
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/login" element={<LoginScreen {...screenProps} initialMode="signin" />} />
          <Route path="/invite" element={<LoginScreen {...screenProps} initialMode="invite" />} />
        </Routes>
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return queryClient;
}

const tabNames = () => screen.getAllByRole("tab").map((tab) => tab.textContent);

/**
 * The tabs since TAS-426 (DESIGN.md §4.27 «Табы», §4.31): a tablist, never
 * more than two, chosen by the route and by `GET /auth/methods`.
 */
describe("LoginScreen, tabs", () => {
  afterEach(() => {
    forgetInviteToken();
  });

  it("with sign-up off and no providers is today's card: Sign in and Accept invite, no Create account, no provider", async () => {
    renderEntry("/login");
    await waitFor(() => expect(methodsState.calls).toBe(1));

    expect(tabNames()).toEqual(["Sign in", "Accept invite"]);
    expect(screen.queryByText("Create account")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByText("or")).not.toBeInTheDocument();
  });

  it("names the tabs by role, keeps one in the Tab order, and moves focus and choice with the arrows, Home and End", async () => {
    renderEntry("/login");
    const tablist = screen.getByRole("tablist");
    const signIn = screen.getByRole("tab", { name: "Sign in" });
    const invite = screen.getByRole("tab", { name: "Accept invite" });
    const panel = screen.getByRole("tabpanel");

    // The tab and the submit share their words and not their role.
    expect(screen.getByRole("button", { name: "Sign in" })).toHaveAttribute("type", "submit");
    expect(signIn).toHaveAttribute("aria-selected", "true");
    expect(signIn).toHaveAttribute("tabindex", "0");
    expect(invite).toHaveAttribute("tabindex", "-1");
    expect(signIn).toHaveAttribute("aria-controls", panel.id);
    expect(panel).toHaveAttribute("aria-labelledby", signIn.id);
    expect(signIn).not.toHaveAttribute("aria-pressed");

    signIn.focus();
    fireEvent.keyDown(tablist, { key: "ArrowRight" });
    expect(invite).toHaveFocus();
    expect(invite).toHaveAttribute("aria-selected", "true");
    expect(invite).toHaveAttribute("tabindex", "0");
    expect(signIn).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", invite.id);
    expect(screen.getByLabelText("Invitation token")).toBeVisible();

    fireEvent.keyDown(tablist, { key: "ArrowRight" });
    expect(signIn).toHaveFocus();
    fireEvent.keyDown(tablist, { key: "End" });
    expect(invite).toHaveFocus();
    fireEvent.keyDown(tablist, { key: "Home" });
    expect(signIn).toHaveFocus();
    fireEvent.keyDown(tablist, { key: "ArrowLeft" });
    expect(invite).toHaveFocus();
    expect(invite).toHaveAttribute("aria-selected", "true");
  });

  it("offers Create account in place of Accept invite on /login while sign-up is open, and never a third tab", async () => {
    methodsState.answer = OPEN;
    renderEntry("/login");

    await waitFor(() => expect(tabNames()).toEqual(["Sign in", "Create account"]));
    expect(screen.queryByRole("tab", { name: "Accept invite" })).not.toBeInTheDocument();
  });

  it("keeps Sign in and Accept invite on /invite whatever the methods say", async () => {
    methodsState.answer = OPEN;
    renderEntry("/invite");
    await waitFor(() => expect(methodsState.calls).toBe(1));

    expect(tabNames()).toEqual(["Sign in", "Accept invite"]);
    // No provider buttons on the invite tab.
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("draws no provider button anywhere on /invite — its Sign in tab included — while /login draws them", async () => {
    methodsState.answer = OPEN;
    window.localStorage.setItem("taska.authMethods", JSON.stringify(OPEN));
    renderEntry("/invite");
    await waitFor(() => expect(methodsState.calls).toBe(1));

    fireEvent.click(screen.getByRole("tab", { name: "Sign in" }));
    expect(screen.getByRole("button", { name: "Sign in" })).toHaveAttribute("type", "submit");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByText("or")).not.toBeInTheDocument();
  });

  it("draws its first frame from the stored answer, and the server's answer replaces it and is stored", async () => {
    window.localStorage.setItem("taska.authMethods", JSON.stringify({ signupEnabled: true, providers: ["GITHUB"] }));
    methodsState.hold = true;
    renderEntry("/login");

    expect(tabNames()).toEqual(["Sign in", "Create account"]);
    expect(screen.getByRole("link", { name: "Continue with GitHub" })).toBeVisible();

    await act(async () => methodsState.release());

    await waitFor(() => expect(tabNames()).toEqual(["Sign in", "Accept invite"]));
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem("taska.authMethods")!)).toEqual({ signupEnabled: false, providers: [] });
  });

  it("keeps the stored answer when the read fails, and today's card without one", async () => {
    window.localStorage.setItem("taska.authMethods", JSON.stringify({ signupEnabled: true, providers: ["APPLE", "NOPE"] }));
    methodsState.refusal = new ApiError("Service unavailable", "UNAVAILABLE", 503);
    renderEntry("/login");
    await waitFor(() => expect(methodsState.calls).toBe(1));

    expect(tabNames()).toEqual(["Sign in", "Create account"]);
    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(["Continue with Apple"]);
    // No spinner and no error line for it.
    expect(screen.queryByText("Service unavailable")).not.toBeInTheDocument();
  });

  it("opens Sign in when the answer takes the open tab away, and brings focus that was in the panel to its tab", async () => {
    window.localStorage.setItem("taska.authMethods", JSON.stringify(OPEN));
    methodsState.hold = true;
    renderEntry("/login");
    fireEvent.click(screen.getByRole("tab", { name: "Create account" }));
    screen.getByLabelText("Name").focus();

    await act(async () => methodsState.release());

    await waitFor(() => expect(screen.getByRole("tab", { name: "Sign in" })).toHaveAttribute("aria-selected", "true"));
    expect(screen.getByRole("tab", { name: "Sign in" })).toHaveFocus();
    expect(tabNames()).toEqual(["Sign in", "Accept invite"]);
  });
});

describe("LoginScreen, the sign-in refusal", () => {
  afterEach(() => {
    refuseWith(undefined);
  });

  it("is an alert, mounted afresh for every attempt so the same refusal is said again", async () => {
    refuseWith(new ApiError("Invalid credentials", "UNAUTHENTICATED", 401, "req-cred"));
    renderLogin();

    signIn();
    const first = await screen.findByRole("alert");
    expect(first).toHaveTextContent("Invalid credentials");

    signIn();
    await waitFor(() => expect(screen.getByRole("alert")).not.toBe(first));
    expect(screen.getByRole("alert")).toHaveTextContent("Invalid credentials");
  });
});

/**
 * The provider buttons (§4.31): real links to the start, under Sign in and
 * Create account, in the client's order.
 */
describe("LoginScreen, provider buttons", () => {
  // jsdom cannot navigate; the links' own default is stopped where the
  // document would have followed it, after the screen's handler has run.
  const stopNavigation = (event: Event) => event.preventDefault();
  afterEach(() => {
    document.removeEventListener("click", stopNavigation);
  });

  it("draws the providers the answer lists in Google, GitHub, Apple order, linked to the start with the remembered path", async () => {
    methodsState.answer = { signupEnabled: false, providers: ["APPLE", "GOOGLE"] };
    renderEntry({ pathname: "/login", state: { from: "/projects/p-1/board?q=x" } });

    await waitFor(() => expect(screen.getAllByRole("link")).toHaveLength(2));
    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["Continue with Google", "Continue with Apple"]);
    expect(links[0]).toHaveAttribute(
      "href",
      `https://api.example/auth/oauth/google/start?returnTo=${encodeURIComponent("/projects/p-1/board?q=x")}`,
    );
    // The marks are decoration; the words are the name.
    expect(links[0].querySelector(".provider-mark")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("or")).toBeVisible();
  });

  it("sends /projects when nothing was remembered, and never an auth route", async () => {
    methodsState.answer = { signupEnabled: false, providers: ["GOOGLE"] };
    renderEntry({ pathname: "/login", state: { from: "/invite?token=x" } });

    const link = await screen.findByRole("link", { name: "Continue with Google" });
    expect(link).toHaveAttribute("href", "https://api.example/auth/oauth/google/start?returnTo=%2Fprojects");
  });

  it("puts every button in flight on a press, remembers the attempt, refuses a second press, and lets go on pageshow from the bfcache", async () => {
    document.addEventListener("click", stopNavigation);
    methodsState.answer = OPEN;
    renderEntry("/login");
    const google = await screen.findByRole("link", { name: "Continue with Google" });

    fireEvent.click(google);

    for (const link of screen.getAllByRole("link")) expect(link).toHaveAttribute("aria-disabled", "true");
    expect(JSON.parse(window.sessionStorage.getItem("taska.oauthAttempt")!)).toEqual({
      provider: "GOOGLE",
      tab: "signin",
      returnTo: "/projects",
    });
    // A second start would replace the first one's state cookie.
    const second = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    screen.getByRole("link", { name: "Continue with GitHub" }).dispatchEvent(second);
    expect(second.defaultPrevented).toBe(true);
    expect(JSON.parse(window.sessionStorage.getItem("taska.oauthAttempt")!).provider).toBe("GOOGLE");

    act(() => {
      const shown = new Event("pageshow") as Event & { persisted?: boolean };
      Object.defineProperty(shown, "persisted", { value: true });
      window.dispatchEvent(shown);
    });
    for (const link of screen.getAllByRole("link")) expect(link).not.toHaveAttribute("aria-disabled");
  });

  it("leaves a press with a modifier to the browser", async () => {
    document.addEventListener("click", stopNavigation);
    methodsState.answer = OPEN;
    renderEntry("/login");
    const google = await screen.findByRole("link", { name: "Continue with Google" });

    fireEvent.click(google, { metaKey: true });

    expect(google).not.toHaveAttribute("aria-disabled");
    expect(window.sessionStorage.getItem("taska.oauthAttempt")).toBeNull();
  });
});

const refusalState = (reason: string, extra: Record<string, unknown> = {}) => ({
  providerRefusal: {
    reason,
    provider: "GOOGLE",
    tab: "signin",
    message: null,
    requestId: null,
    retryAfterSeconds: null,
    lockedUntil: null,
    ...extra,
  },
});

/** A provider sign-in that came back refused (§4.31): over the tabs, a state on arrival. */
describe("LoginScreen, a provider's refusal on arrival", () => {
  it("draws it over the tabs with its request id, focused and not live, and takes it out of the history entry", async () => {
    renderEntry({ pathname: "/login", state: refusalState("ACCOUNT_BLOCKED", { requestId: "req-blocked" }) });

    const sentence = screen.getByText("The Taska account for this email is blocked. Ask a Taska admin to unblock it.");
    const box = sentence.closest(".auth-refusal");
    expect(box).toHaveAttribute("tabindex", "-1");
    await waitFor(() => expect(box).toHaveFocus());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(sentence).not.toHaveAttribute("role");
    expect(box).not.toHaveAttribute("aria-live");
    expect(screen.getByRole("button", { name: "Copy request id req-blocked" })).toBeVisible();
    // Above the tabs.
    expect(box!.compareDocumentPosition(screen.getByRole("tablist")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await waitFor(() => expect(screen.getByTestId("where-state")).toHaveTextContent("null"));
    expect(sentence).toBeVisible();

    // Gone with the next tab change.
    fireEvent.click(screen.getByRole("tab", { name: "Accept invite" }));
    expect(screen.queryByText(/is blocked/)).not.toBeInTheDocument();
  });

  it("keeps the page it was to return to when it drops the refusal, and the next sign-in goes there", async () => {
    loginState.me = { id: "u-anna", email: "anna@example.com", displayName: "Anna Ivanova" };
    methodsState.answer = { signupEnabled: false, providers: ["GOOGLE"] };
    renderEntry({
      pathname: "/login",
      state: { ...refusalState("ACCOUNT_BLOCKED"), from: "/projects/p-1/board?q=x" },
    });

    await waitFor(() => expect(JSON.parse(screen.getByTestId("where-state").textContent!)).toEqual({ from: "/projects/p-1/board?q=x" }));
    // A provider pressed again is sent the same page.
    expect(await screen.findByRole("link", { name: "Continue with Google" })).toHaveAttribute(
      "href",
      `https://api.example/auth/oauth/google/start?returnTo=${encodeURIComponent("/projects/p-1/board?q=x")}`,
    );

    signIn();

    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/projects/p-1/board"));
  });

  it("says the exchange's expired code and the callback's stale state in different words", () => {
    renderEntry({ pathname: "/login", state: refusalState("CODE_INVALID") });
    expect(
      screen.getByText("That sign-in could not be finished — it took too long or was already used. Try again from this page."),
    ).toBeVisible();
  });

  it("says a provider's lock in two lines with no time made up", () => {
    renderEntry({ pathname: "/login", state: refusalState("ACCOUNT_LOCKED") });
    const lines = [...document.querySelectorAll(".auth-refusal .auth-lock > span")].map((line) => line.textContent);
    expect(lines).toEqual(["Account is locked after too many failed sign-ins.", "Try again later."]);
    expect(document.querySelector(".auth-refusal time")).toBeNull();
  });

  it("keeps the server's words and id for a sign-in that could not be finished, and prints an unknown reason in the detail line", () => {
    renderEntry({ pathname: "/login", state: refusalState("FAILED", { message: "Upstream timed out", requestId: "req-5xx" }) });
    expect(screen.getByText("Sign-in with Google could not be finished.")).toBeVisible();
    expect(screen.getByText("Upstream timed out")).toBeVisible();
    expect(screen.getByRole("button", { name: "Copy request id req-5xx" })).toBeVisible();
  });

  it("draws nothing for a cancelled sign-in, on the tab it began on", async () => {
    window.localStorage.setItem("taska.authMethods", JSON.stringify(OPEN));
    methodsState.answer = OPEN;
    renderEntry({ pathname: "/login", state: refusalState("PROVIDER_CANCELLED", { tab: "signup" }) });

    expect(screen.getByRole("tab", { name: "Create account" })).toHaveAttribute("aria-selected", "true");
    expect(document.querySelector(".auth-refusal")).toBeNull();
    expect(document.querySelector(".error-note")).toBeNull();
    await waitFor(() => expect(screen.getByTestId("where-state")).toHaveTextContent("null"));
  });

  it("goes with the next press of a provider", async () => {
    document.addEventListener("click", (event) => event.preventDefault(), { once: true });
    methodsState.answer = OPEN;
    renderEntry({ pathname: "/login", state: refusalState("PROVIDER_UNAVAILABLE") });
    expect(screen.getByText("Google sign-in isn’t available right now. Try again in a moment, or sign in another way.")).toBeVisible();

    fireEvent.click(await screen.findByRole("link", { name: "Continue with GitHub" }));

    expect(screen.queryByText(/isn’t available right now/)).not.toBeInTheDocument();
  });
});

/** Create account and «Check your email» (§4.31). */
describe("LoginScreen, Create account", () => {
  const openCreateAccount = async () => {
    methodsState.answer = OPEN;
    renderEntry("/login");
    fireEvent.click(await screen.findByRole("tab", { name: "Create account" }));
  };

  const fill = (name: string, email: string) => {
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: name } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  };

  it("asks for a name and an address, says what the button does not do, and holds a name with a reason", async () => {
    await openCreateAccount();
    const name = screen.getByLabelText("Name");
    const email = screen.getByLabelText("Email");

    expect(name).toHaveAttribute("autocomplete", "name");
    expect(name).toHaveAccessibleDescription("Shown to the people you work with. You can change it later in Settings.");
    // An untouched name is not yet wrong.
    expect(name).not.toHaveAttribute("aria-invalid");
    expect(email).toHaveAttribute("type", "email");
    expect(email).toHaveAttribute("autocomplete", "email");
    expect(email).toHaveAttribute("placeholder", "you@company.com");
    expect(screen.getByRole("button", { name: "Continue" })).toHaveAttribute("type", "submit");
    expect(screen.getByText("Invited by your team? Use the link in your invitation email instead.")).toBeVisible();
    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Continue with Google",
      "Continue with GitHub",
      "Continue with Apple",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAccessibleDescription("Enter a name.");
    expect(name).toHaveFocus();
    expect(signupState.sent).toEqual([]);
  });

  it("sends the name trimmed, and on 202 says «Check your email» in the form's place with focus on it", async () => {
    signupState.hold = true;
    await openCreateAccount();
    fill("  Rosa Diaz ", "rosa@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    const pending = await screen.findByRole("button", { name: "Sending" });
    expect(pending).toHaveAttribute("aria-disabled", "true");
    fireEvent.submit(pending.closest("form")!);
    expect(signupState.sent).toEqual([{ email: "rosa@example.com", displayName: "Rosa Diaz" }]);

    await act(async () => signupState.release());

    const title = await screen.findByRole("heading", { name: "Check your email" });
    await waitFor(() => expect(title).toHaveFocus());
    expect(
      screen.getByText(
        "If rosa@example.com can be used for a new Taska account, we’ve sent a link there. Open it to choose your password.",
      ),
    ).toBeVisible();
    const resend = screen.getByRole("button", { name: "Resend link" });
    expect(resend).toHaveAttribute("aria-disabled", "true");
    expect(resend).toHaveClass("is-waiting");
    expect(resend).toHaveAccessibleDescription("You can resend in 1:00.");
    // A press while the minute runs sends nothing.
    fireEvent.click(resend);
    expect(signupState.sent).toHaveLength(1);
    // No provider buttons here.
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    // A persistent, hidden status region, empty until a resend says something.
    expect(document.querySelector(".signup-sent [role='status']")).toHaveTextContent("");
  });

  it("keeps «Check your email» across a tab change, and goes back to the form with both values and the address selected", async () => {
    await openCreateAccount();
    fill("Rosa Diaz", "rosa@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: "Check your email" });

    // By the arrows, as a keyboard reader walks the tabs: coming back to the
    // panel does not pull focus off the tab again.
    const tablist = screen.getByRole("tablist");
    screen.getByRole("tab", { name: "Create account" }).focus();
    fireEvent.keyDown(tablist, { key: "ArrowLeft" });
    fireEvent.keyDown(tablist, { key: "ArrowRight" });
    expect(screen.getByRole("heading", { name: "Check your email" })).toBeVisible();
    await act(async () => {});
    expect(screen.getByRole("tab", { name: "Create account" })).toHaveFocus();

    // An email field has no selection range to read back (HTML: `selectionStart`
    // does not apply to it), so the call that selects it is what is checked.
    const select = vi.spyOn(HTMLInputElement.prototype, "select");
    fireEvent.click(screen.getByRole("button", { name: "Use a different email" }));
    const email = screen.getByLabelText("Email") as HTMLInputElement;
    await waitFor(() => expect(email).toHaveFocus());
    expect(select.mock.contexts).toContain(email);
    select.mockRestore();
    expect(email).toHaveValue("rosa@example.com");
    expect(screen.getByLabelText("Name")).toHaveValue("Rosa Diaz");
  });

  it("says sign-up is off in its own words, as an alert, and reads the methods again", async () => {
    await openCreateAccount();
    const reads = methodsState.calls;
    signupState.refusal = new ApiError("Signup is disabled", "PERMISSION_DENIED", 403, "req-off", undefined, {
      reason: "SIGNUP_DISABLED",
    });
    fill("Rosa Diaz", "rosa@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Taska isn’t open for new accounts right now. Ask a Taska admin to invite you.",
    );
    await waitFor(() => expect(methodsState.calls).toBe(reads + 1));
  });

  /** Continue refused as closed, and the re-read methods closing too: the tab goes, the sentence moves. */
  const closedByRefusal = async (providers: string[] = []) => {
    await openCreateAccount();
    signupState.refusal = new ApiError("Signup is disabled", "PERMISSION_DENIED", 403, "req-off", undefined, {
      reason: "SIGNUP_DISABLED",
    });
    methodsState.answer = { signupEnabled: false, providers };
    fill("Rosa Diaz", "rosa@example.com");
    const send = screen.getByRole("button", { name: "Continue" });
    send.focus();
    fireEvent.click(send);
    await waitFor(() => expect(tabNames()).toEqual(["Sign in", "Accept invite"]));
    return screen.getByText(SIGNUP_CLOSED).closest(".auth-refusal");
  };
  const SIGNUP_CLOSED = "Taska isn’t open for new accounts right now. Ask a Taska admin to invite you.";

  it("moves that sentence and its id above the tabs when the methods it re-read take the tab away, and brings focus to it", async () => {
    const box = await closedByRefusal();

    expect(box).toHaveAttribute("tabindex", "-1");
    await waitFor(() => expect(box).toHaveFocus());
    expect(screen.getByRole("tab", { name: "Sign in" })).not.toHaveFocus();
    expect(screen.getByRole("tab", { name: "Sign in" })).toHaveAttribute("aria-selected", "true");
    // Not live: the alert under Continue already said it.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(box).not.toHaveAttribute("aria-live");
    expect(screen.getByRole("button", { name: "Copy request id req-off" })).toBeVisible();
    // Above the tabs.
    expect(box!.compareDocumentPosition(screen.getByRole("tablist")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("drops the moved sentence with the next provider press", async () => {
    await closedByRefusal(["GOOGLE"]);
    document.addEventListener("click", (event) => event.preventDefault(), { once: true });
    fireEvent.click(screen.getByRole("link", { name: "Continue with Google" }));
    expect(screen.queryByText(SIGNUP_CLOSED)).not.toBeInTheDocument();
  });

  it("drops the moved sentence with the next sign-in", async () => {
    await closedByRefusal();
    signIn();
    expect(screen.queryByText(SIGNUP_CLOSED)).not.toBeInTheDocument();
  });

  it("drops the moved sentence with the next tab change", async () => {
    await closedByRefusal();
    fireEvent.click(screen.getByRole("tab", { name: "Accept invite" }));
    expect(screen.queryByText(SIGNUP_CLOSED)).not.toBeInTheDocument();
  });

  it("leaves the tab's removal to the Sign in tab when no refusal caused it", async () => {
    window.localStorage.setItem("taska.authMethods", JSON.stringify(OPEN));
    methodsState.hold = true;
    renderEntry("/login");
    fireEvent.click(screen.getByRole("tab", { name: "Create account" }));
    screen.getByLabelText("Name").focus();

    await act(async () => methodsState.release());

    await waitFor(() => expect(screen.getByRole("tab", { name: "Sign in" })).toHaveFocus());
    expect(document.querySelector(".auth-refusal")).toBeNull();
  });

  it("drops a provider's refusal with the next Continue", async () => {
    window.localStorage.setItem("taska.authMethods", JSON.stringify(OPEN));
    methodsState.answer = OPEN;
    renderEntry({ pathname: "/login", state: refusalState("PROVIDER_UNAVAILABLE", { tab: "signup" }) });
    expect(screen.getByText("Google sign-in isn’t available right now. Try again in a moment, or sign in another way.")).toBeVisible();

    fill("Rosa Diaz", "rosa@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.queryByText(/isn’t available right now/)).not.toBeInTheDocument();
  });

  it("prints a name refusal in the server's words and marks Name; any other 400 marks Email", async () => {
    await openCreateAccount();
    signupState.refusal = new ApiError(
      "Display name must contain 1 to 128 characters and no control characters or line breaks",
      "INVALID_ARGUMENT",
      400,
      "req-name",
      undefined,
      { reason: "DISPLAY_NAME_INVALID" },
    );
    fill("Rosa Diaz", "rosa@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/^Display name must contain/);
    expect(screen.getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Email")).not.toHaveAttribute("aria-invalid");

    signupState.refusal = new ApiError("A valid email address is required (maximum 320 characters)", "INVALID_ARGUMENT", 400);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "rosa" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/^A valid email address is required/));
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Name")).not.toHaveAttribute("aria-invalid");
    // What was typed stays.
    expect(screen.getByLabelText("Email")).toHaveValue("rosa");
  });

  it("says a 429 with its wait, and a failure without an answer in its own words with the server's beside them", async () => {
    await openCreateAccount();
    signupState.refusal = new ApiError("Too many requests", "RESOURCE_EXHAUSTED", 429, "req-429", undefined, {
      retryAfterSeconds: "2400",
    });
    fill("Rosa Diaz", "rosa@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many attempts. Try again in 40 minutes.");

    signupState.refusal = new ApiError("Service unavailable", "UNAVAILABLE", 503, "req-503");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("The sign-up request could not be sent."));
    expect(screen.getByText("Service unavailable")).toBeVisible();
    expect(screen.getByRole("button", { name: "Copy request id req-503" })).toBeVisible();
  });
});

/** Resend on «Check your email» (§4.31): the minute, the second link, and a 429's wait. */
describe("LoginScreen, Resend link", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Moves the clock the countdown reads past the wait; the next tick (within a second) sees it. */
  const jumpPast = (seconds: number) => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + seconds * 1000);
  };

  it("sends the same request again after the minute, says so in the status, and counts down from a 429's number", async () => {
    methodsState.answer = OPEN;
    renderEntry("/login");
    fireEvent.click(await screen.findByRole("tab", { name: "Create account" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Rosa Diaz" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "rosa@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const resend = await screen.findByRole("button", { name: "Resend link" });
    const status = document.querySelector(".signup-sent [role='status']")!;

    jumpPast(61);
    await waitFor(() => expect(resend).toHaveAccessibleDescription("Didn’t get it? Check your spam folder, then resend."), {
      timeout: 2500,
    });
    expect(resend).not.toHaveAttribute("aria-disabled");
    expect(resend).not.toHaveClass("is-waiting");

    fireEvent.click(resend);
    await waitFor(() =>
      expect(status).toHaveTextContent(
        "If rosa@example.com can be used for a new Taska account, we’ve sent another link there. Open it to choose your password.",
      ),
    );
    expect(signupState.sent).toEqual([
      { email: "rosa@example.com", displayName: "Rosa Diaz" },
      { email: "rosa@example.com", displayName: "Rosa Diaz" },
    ]);
    expect(screen.getByText(/we’ve sent another link there\. Open it to choose your password\.$/, { selector: ".auth-text" })).toBeVisible();
    expect(resend).toHaveAccessibleDescription("You can resend in 1:00.");
    // The same node keeps the region; the sentence inside it is new each time.
    expect(document.querySelector(".signup-sent [role='status']")).toBe(status);

    jumpPast(122);
    await waitFor(() => expect(resend).not.toHaveAttribute("aria-disabled"), { timeout: 2500 });
    signupState.refusal = new ApiError("Too many requests", "RESOURCE_EXHAUSTED", 429, "req-429", undefined, {
      retryAfterSeconds: "760",
    });
    fireEvent.click(resend);

    await waitFor(() => expect(status).toHaveTextContent("Too many attempts. Try again in 13 minutes."));
    expect(resend).toHaveAccessibleDescription("Too many attempts. You can resend in 12:40.");
    expect(resend).toHaveAttribute("aria-disabled", "true");
    // A 429 is not a refusal box: the hint and the status say it.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says a 429 without a number with the same wait the hint counts down — the minute", async () => {
    methodsState.answer = OPEN;
    renderEntry("/login");
    fireEvent.click(await screen.findByRole("tab", { name: "Create account" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Rosa Diaz" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "rosa@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const resend = await screen.findByRole("button", { name: "Resend link" });
    const status = document.querySelector(".signup-sent [role='status']")!;

    jumpPast(61);
    await waitFor(() => expect(resend).not.toHaveAttribute("aria-disabled"), { timeout: 2500 });
    signupState.refusal = new ApiError("Too many requests", "RESOURCE_EXHAUSTED", 429, "req-429");
    fireEvent.click(resend);

    await waitFor(() => expect(status).toHaveTextContent("Too many attempts. Try again in 60 seconds."));
    expect(resend).toHaveAccessibleDescription("Too many attempts. You can resend in 1:00.");
  });

  it("says a resend that did not go through in its own words, as an alert above the hint", async () => {
    methodsState.answer = OPEN;
    renderEntry("/login");
    fireEvent.click(await screen.findByRole("tab", { name: "Create account" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Rosa Diaz" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "rosa@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const resend = await screen.findByRole("button", { name: "Resend link" });

    jumpPast(61);
    await waitFor(() => expect(resend).not.toHaveAttribute("aria-disabled"), { timeout: 2500 });
    signupState.refusal = new ApiError("Service unavailable", "UNAVAILABLE", 503, "req-503");
    fireEvent.click(resend);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Resending did not go through.");
    expect(screen.getByText("Service unavailable")).toBeVisible();
    const hint = document.getElementById(resend.getAttribute("aria-describedby")!)!;
    expect(alert.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

/** A link of kind `SIGNUP` on the invite tab (§4.31): the words swap in place. */
describe("LoginScreen, a sign-up link", () => {
  afterEach(() => {
    forgetInviteToken();
    Object.assign(inviteState, { session: false, refusal: undefined, hold: false, calls: [], accepted: [] });
    Object.assign(previewState, { refusal: undefined, hold: false, release: () => {}, tokens: [], kind: "INVITATION" });
  });

  it("keeps the invitation's words while the preview is out, and swaps them in place once it says SIGNUP", async () => {
    previewState.kind = "SIGNUP";
    previewState.hold = true;
    holdInviteToken(TOKEN);
    renderAuth();

    expect(screen.getByRole("tab", { name: "Accept invite" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Confirm your name and choose a password to activate your Taska account.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Activate account" })).toBeVisible();

    await act(async () => previewState.release());

    await waitFor(() => expect(screen.getByLabelText("Email")).toHaveValue("leo@example.com"));
    expect(screen.getByRole("tab", { name: "Create account" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "Finish creating your account" })).toBeVisible();
    expect(screen.getByText("Confirm your name and choose a password.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Create account" })).toHaveAttribute("type", "submit");
    expect(screen.getByText("Link expired? Create your account again to get a new one.")).toBeVisible();
    expect(screen.queryByText(/activate your Taska account/)).not.toBeInTheDocument();
  });

  it("says Creating account while the activation is out, and a sign-up link's own 401", async () => {
    previewState.kind = "SIGNUP";
    inviteState.hold = true;
    inviteState.refusal = new ApiError("Invalid or expired token", "UNAUTHENTICATED", 401, "req-401");
    holdInviteToken(TOKEN);
    renderAuth();
    await previewed();
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "Correct-horse-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("button", { name: "Creating account" })).toHaveAttribute("aria-disabled", "true");
    await act(async () => inviteState.release());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This sign-up link no longer works — it expired, was used, or was replaced by a newer one. If you already set a password, sign in; otherwise create your account again.",
    );
  });

  it("keeps an unknown kind in the invitation's words", async () => {
    previewState.kind = "OAUTH_SIGNUP";
    inviteState.session = true;
    holdInviteToken(TOKEN);
    renderAuth();
    await previewed();

    expect(screen.getByRole("tab", { name: "Accept invite" })).toBeVisible();
    expect(screen.getByText("Confirm your name and choose a password to activate your Taska account.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Activate account" })).toBeVisible();
    expect(screen.getByText("You’re signed in on this browser. Activating this invitation signs you out first.")).toBeVisible();
  });

  it("swaps the foreign-session line for a sign-up link's own, in the same commit as its other words", async () => {
    previewState.kind = "SIGNUP";
    previewState.hold = true;
    inviteState.session = true;
    holdInviteToken(TOKEN);
    renderAuth();

    // While the preview is out the link is an invitation, as everywhere else.
    expect(screen.getByText("You’re signed in on this browser. Activating this invitation signs you out first.")).toBeVisible();

    await act(async () => previewState.release());

    await waitFor(() => expect(screen.getByRole("tab", { name: "Create account" })).toBeVisible());
    expect(screen.getByRole("heading", { name: "Finish creating your account" })).toBeVisible();
    expect(screen.getByText("You’re signed in on this browser. Creating your account signs you out first.")).toBeVisible();
    expect(screen.queryByText(/Activating this invitation/)).not.toBeInTheDocument();
  });

  it("says a dead link of unknown kind in words for either kind while sign-up is open", async () => {
    methodsState.answer = OPEN;
    previewState.refusal = new ApiError("Invalid or expired token", "UNAUTHENTICATED", 401, "req-dead");
    holdInviteToken(TOKEN);
    renderAuth();

    expect(
      await screen.findByText(
        "This link no longer works — it expired, was used, or was replaced by a newer one. If you already set a password, sign in; otherwise ask for a new invitation or create your account again.",
      ),
    ).toBeVisible();
  });
});

describe("LoginScreen, a Try again that ends refused", () => {
  afterEach(() => {
    forgetInviteToken();
    Object.assign(previewState, { refusal: undefined, hold: false, release: () => {}, tokens: [], kind: "INVITATION" });
  });

  it("brings focus to the refusal when the answer takes Try again away with it", async () => {
    previewState.refusal = new ApiError("Service unavailable", "UNAVAILABLE", 503, "req-503");
    holdInviteToken(TOKEN);
    renderAuth();
    const retry = await screen.findByRole("button", { name: "Try again" });
    retry.focus();

    previewState.refusal = new ApiError("Invalid or expired token", "UNAUTHENTICATED", 401, "req-dead");
    fireEvent.click(retry);

    expect(await screen.findByRole("alert")).toHaveTextContent(/^This invitation link no longer works/);
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    await waitFor(() => expect(document.querySelector(".invite-preview-refusal")).toHaveFocus());
  });
});
