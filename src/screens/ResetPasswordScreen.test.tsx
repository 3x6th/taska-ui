import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskaApi } from "../api/TaskaApi";
import { forgetRecoveryToken, heldRecoveryToken, holdRecoveryToken } from "../lib/recoveryLink";
import { companiesHarness } from "../test/companiesHarness";
import { ResetPasswordScreen } from "./ResetPasswordScreen";

/*
 * `/reset-password` (TAS-527): the held token and a new password; the dead
 * link's one sentence; the 204 signing this browser out and landing on
 * `/login` with the notice.
 */

const TOKEN = "734qwQC1pVarpZcKWJqanuMK2lp1-u61hNRvhIQr9Qc";

const { fakeApi, state } = vi.hoisted(() => {
  const state = {
    session: false,
    calls: [] as Array<{ token: string; password: string; key: string }>,
    answers: [] as Array<() => Promise<unknown>>,
    loggedOut: 0,
  };
  const api = {
    hasSession: () => state.session,
    logout: async () => {
      state.loggedOut += 1;
      state.session = false;
    },
    completePasswordRecovery: (token: string, password: string, key: string) => {
      state.calls.push({ token, password, key });
      const next = state.answers.shift();
      return next ? next() : Promise.resolve(undefined);
    },
  };
  return { fakeApi: api as unknown as TaskaApi, state };
});

vi.mock("../api/client", () => ({ taskaApi: fakeApi }));

const refusal = (status: number | null, code: string | null, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(status === null ? "Failed to fetch" : "the server's words"), {
    status,
    code,
    requestId: status === null ? undefined : "rid-1",
    details: null,
    ...extra,
  });

function Login() {
  const location = useLocation();
  return <p data-testid="login">{JSON.stringify(location.state)}</p>;
}

function open() {
  const harness = companiesHarness({ path: "/reset-password" });
  harness.client.setQueryData(["me"], { id: "anna" });
  const view = render(
    <Routes>
      <Route element={<ResetPasswordScreen theme="light" toggleTheme={() => {}} />} path="/reset-password" />
      <Route element={<Login />} path="/login" />
    </Routes>,
    { wrapper: harness.wrapper },
  );
  return { ...view, client: harness.client };
}

async function setPassword(value: string) {
  fireEvent.change(screen.getByLabelText("New password"), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Set new password" }));
}

beforeEach(() => {
  state.session = false;
  state.calls = [];
  state.answers = [];
  state.loggedOut = 0;
});
afterEach(() => forgetRecoveryToken());

describe("with a link", () => {
  it("asks for the password alone, focused, under the lead and the blueprint's bound — no request on arrival", () => {
    holdRecoveryToken(TOKEN);
    open();
    expect(screen.getByRole("heading", { level: 1, name: "Choose a new password" })).toBeInTheDocument();
    expect(
      screen.getByText("Setting a new password signs you out of Taska on every device and disconnects your access tokens and connected apps."),
    ).toBeInTheDocument();
    const field = screen.getByLabelText("New password");
    expect(field).toHaveFocus();
    expect(field).toHaveAttribute("autocomplete", "new-password");
    expect(field).toHaveAccessibleDescription("At least 12 characters.");
    expect(screen.getByRole("button", { name: "Show password" })).toHaveAttribute("aria-pressed", "false");
    expect(state.calls).toEqual([]);
  });

  it("says this browser is included when it holds a session", () => {
    holdRecoveryToken(TOKEN);
    state.session = true;
    open();
    expect(screen.getByText(/on every device, this browser included, and disconnects/)).toBeInTheDocument();
  });

  it("an empty password sends nothing; the reason stands in the hint", () => {
    holdRecoveryToken(TOKEN);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Set new password" }));
    expect(state.calls).toEqual([]);
    expect(screen.getByLabelText("New password")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("New password")).toHaveAccessibleDescription("Enter a new password.");
  });

  it("the 204: signs this browser out, clears what it read, forgets the link, and lands on /login with the notice", async () => {
    holdRecoveryToken(TOKEN);
    state.session = true;
    const { client } = open();
    await setPassword("a long new password");
    await waitFor(() => expect(screen.getByTestId("login")).toHaveTextContent('{"recovered":true}'));
    expect(state.calls).toEqual([{ token: TOKEN, password: "a long new password", key: expect.any(String) }]);
    expect(state.loggedOut).toBe(1);
    expect(client.getQueryData(["me"])).toBeUndefined();
    expect(heldRecoveryToken()).toBeNull();
  });

  it("no session in this browser: no sign-out, the same landing", async () => {
    holdRecoveryToken(TOKEN);
    open();
    await setPassword("a long new password");
    await waitFor(() => expect(screen.getByTestId("login")).toBeInTheDocument());
    expect(state.loggedOut).toBe(0);
  });

  for (const [name, error] of [
    ["a 401 of any code", refusal(401, "TOKEN_REVOKED")],
    ["a 422 CONFIRMATION_EXPIRED", refusal(422, "CONFIRMATION_EXPIRED")],
    ["a violation on token", refusal(400, "VALIDATION_FAILED", { violations: [{ field: "token", code: "INVALID", message: "bad" }] })],
  ] as const) {
    it(`a dead link — ${name}: the field and the button go, the link is forgotten, and focus is on the one sentence`, async () => {
      holdRecoveryToken(TOKEN);
      state.answers.push(() => Promise.reject(error));
      open();
      await setPassword("a long new password");
      const sentence = await screen.findByText(
        "This reset link no longer works: it expired or was already used. If you asked for more than one link, open the newest, or request a new one.",
      );
      expect(sentence.closest(".auth-refusal-block")).toHaveFocus();
      // Not live: focus brings it.
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.getByText("rid-1")).toBeInTheDocument();
      expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Request a new link" })).toHaveAttribute("href", "/forgot-password");
      expect(heldRecoveryToken()).toBeNull();
    });
  }

  it("another 422 is no dead link: the form's sentence, the server's words, the id", async () => {
    holdRecoveryToken(TOKEN);
    state.answers.push(() => Promise.reject(refusal(422, "QUOTA_EXCEEDED")));
    open();
    await setPassword("a long new password");
    expect(await screen.findByRole("alert")).toHaveTextContent("Your password was not reset.");
    expect(screen.getByText("the server's words")).toBeInTheDocument();
    expect(heldRecoveryToken()).toBe(TOKEN);
  });

  it("a violation on newPassword: the server's words, the field marked and described by them", async () => {
    holdRecoveryToken(TOKEN);
    state.answers.push(() =>
      Promise.reject(refusal(400, "VALIDATION_FAILED", { violations: [{ field: "newPassword", code: "INVALID", message: "The new password must be 12 to 128 characters." }] })),
    );
    open();
    await setPassword("short");
    expect(await screen.findByRole("alert")).toHaveTextContent("The new password must be 12 to 128 characters.");
    const field = screen.getByLabelText("New password");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription("At least 12 characters. The new password must be 12 to 128 characters.");
  });

  it("no answer: «may or may not», and the retry carries the same key and body", async () => {
    holdRecoveryToken(TOKEN);
    state.answers.push(() => Promise.reject(new TypeError("Failed to fetch")));
    open();
    await setPassword("a long new password");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The server could not be reached, so your password may or may not have been reset. Try again to make sure.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Set new password" }));
    await waitFor(() => expect(state.calls).toHaveLength(2));
    expect(state.calls[1]).toEqual(state.calls[0]);
  });
});

describe("without a link (a reload)", () => {
  it("says to open the link again, offers a new one, asks nothing and takes no focus", () => {
    open();
    expect(screen.getByText("Open the link from your email again to choose a new password.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Request a new link" })).toHaveAttribute("href", "/forgot-password");
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(document.body);
    expect(state.calls).toEqual([]);
  });
});
