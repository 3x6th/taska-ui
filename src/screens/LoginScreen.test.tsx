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
const { fakeApi, refuseWith, inviteState, loginState } = vi.hoisted(() => {
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

  it("says which tab is the current one, and hides a shown password again on every tab change", () => {
    renderLogin();
    expect(screen.getByRole("button", { name: "Sign in", pressed: true })).toBeVisible();
    expect(screen.getByRole("button", { name: "Accept invite", pressed: false })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "text");

    fireEvent.click(screen.getByRole("button", { name: "Accept invite" }));
    expect(screen.getByRole("button", { name: "Accept invite", pressed: true })).toBeVisible();
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

function activate(password = "Correct-horse-1") {
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
  });

  it("shows no token field for a captured link, starts in New password, and says nothing false", async () => {
    holdInviteToken(TOKEN);
    renderAuth();

    expect(screen.queryByLabelText("Invitation token")).not.toBeInTheDocument();
    expect(screen.getByText("Choose a password to activate your Taska account.")).toBeVisible();
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

    activate();

    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/login"));
    expect(inviteState.accepted).toEqual([{ token: TOKEN, newPassword: "Correct-horse-1" }]);
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

    activate();

    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/login"));
    expect(inviteState.calls).toEqual(["logout", "acceptInvitation:false"]);
    expect(queryClient.getQueryData(["projects"])).toBeUndefined();
  });

  it("says the link no longer works in its own words on a 401, as an alert", async () => {
    inviteState.refusal = new ApiError("Invalid or expired token", "UNAUTHENTICATED", 401, "req-401");
    holdInviteToken(TOKEN);
    renderAuth();

    activate();

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

    activate("Correcthorse1");

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

    activate("   ");

    expect(await screen.findByRole("alert")).toHaveTextContent("body.newPassword must not be blank");
    expect(screen.getByLabelText("New password")).toHaveAttribute("aria-invalid", "true");

    inviteState.refusal = new ApiError("body.token must not be blank", "INVALID_ARGUMENT", 400);
    activate("Correct-horse-1");
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("body.token must not be blank"));
    expect(screen.getByLabelText("New password")).not.toHaveAttribute("aria-invalid");
  });

  it("keeps the button focusable while the request is out — aria-disabled, labelled Activating", async () => {
    inviteState.hold = true;
    holdInviteToken(TOKEN);
    renderAuth();

    activate();

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

  it("asks for the token when no link brought one, and takes a whole pasted link", async () => {
    renderAuth();
    const field = screen.getByLabelText("Invitation token");

    expect(field).not.toHaveAttribute("placeholder");
    expect(field).toHaveAccessibleDescription("Open the link in your invitation email — it fills this in.");
    fireEvent.change(field, { target: { value: `https://taska.ozero.dev/?token=${TOKEN}` } });
    activate();

    await waitFor(() => expect(inviteState.accepted).toEqual([{ token: TOKEN, newPassword: "Correct-horse-1" }]));
  });
});
