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
const { fakeApi, refuseWith, inviteState, loginState, previewState } = vi.hoisted(() => {
  const state: { refusal?: Error } = {};
  /** A sign-in held open by hand, so its in-flight state can be looked at. */
  const loginState = { hold: false, release: () => {}, calls: 0 };
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
  };
  const api = {
    login: async () => {
      loginState.calls += 1;
      if (loginState.hold) await new Promise<void>((resolve) => (loginState.release = resolve));
      if (state.refusal) throw state.refusal;
      return { accessToken: "a", refreshToken: "r" };
    },
    getCurrentUser: async () => {
      inviteState.calls.push("getCurrentUser");
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
      return { email: "leo@example.com", displayName: "Leo Fischer", kind: "INVITATION", expiresAt: "2026-11-01T10:00:00Z" };
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
  };
});

vi.mock("../api/client", () => ({ taskaApi: fakeApi }));

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
    expect(screen.getByRole("button", { name: "Sign in", pressed: true })).toBeVisible();
    expect(screen.getByRole("button", { name: "Accept invite", pressed: false })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "text");

    fireEvent.click(screen.getByRole("button", { name: "Accept invite" }));
    expect(screen.getByRole("button", { name: "Accept invite", pressed: true })).toBeVisible();
    await previewed();
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(screen.getByLabelText("New password")).toHaveAttribute("type", "text");

    fireEvent.click(screen.getByRole("button", { name: "Sign in", pressed: false }));
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: "Show password" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "Accept invite" }));
    expect(screen.getByLabelText("New password")).toHaveAttribute("type", "password");
  });

  it("keeps the submit focusable while signing in — aria-disabled, labelled Signing in — and Enter sends nothing more", async () => {
    loginState.hold = true;
    renderLogin();
    const submit = screen.getAllByRole("button", { name: "Sign in" }).find((button) => button.getAttribute("type") === "submit")!;
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
    Object.assign(previewState, { refusal: undefined, hold: false, release: () => {}, tokens: [] });
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
    fireEvent.click(screen.getByRole("button", { name: "Accept invite" }));
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
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
    Object.assign(previewState, { refusal: undefined, hold: false, release: () => {}, tokens: [] });
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

  it("prints a rejected preview in the server's words, with no retry", async () => {
    previewState.refusal = new ApiError("Invalid request parameters", "INVALID_ARGUMENT", 400, "req-400");
    holdInviteToken(TOKEN);
    renderAuth();

    expect(await screen.findByText("Invalid request parameters")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
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
