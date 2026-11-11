import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MalformedAnswerError } from "../../api/accountCredentials";
import type { TaskaApi } from "../../api/TaskaApi";
import { companiesHarness } from "../../test/companiesHarness";
import { SettingsAccountSection } from "./SettingsAccountSection";

/*
 * Settings › Account (TAS-527, art-director B1, B6–B13): the two rows from
 * `["me"]` and nothing else on first paint; the email change in two steps by
 * code, the password cleared on the 201; the password change; one form at a
 * time; the success line; the focus table.
 */

const CHALLENGE = { challengeId: "c-1", expiresAt: null, delivery: "EMAIL", maskedDestination: "a•••@example.com" };

const { fakeApi, state } = vi.hoisted(() => {
  const state = {
    calls: [] as string[],
    meFails: false,
    meHeld: null as Promise<void> | null,
    email: "anna@example.com",
    starts: [] as Array<{ newEmail: string; currentPassword: string | null; key: string }>,
    confirms: [] as Array<{ challengeId: string; code: string; key: string }>,
    changes: [] as Array<{ currentPassword: string; newPassword: string; key: string }>,
    answers: [] as Array<() => Promise<unknown>>,
  };
  const next = <T,>(fallback: () => Promise<T>) => {
    const answer = state.answers.shift();
    return (answer ? answer() : fallback()) as Promise<T>;
  };
  const api = {
    getCurrentUser: async () => {
      state.calls.push("getCurrentUser");
      if (state.meHeld) await state.meHeld;
      if (state.meFails) throw Object.assign(new Error("down"), { status: 503, code: "DEPENDENCY_UNAVAILABLE", requestId: "rid-me" });
      return { id: "anna", email: state.email, displayName: "Anna", status: "ACTIVE" };
    },
    requestAccountEmailChange: (newEmail: string, currentPassword: string | null, key: string) => {
      state.calls.push("requestAccountEmailChange");
      state.starts.push({ newEmail, currentPassword, key });
      return next(() => Promise.resolve({ challengeId: "c-1", expiresAt: null, delivery: "EMAIL", maskedDestination: "a•••@example.com" }));
    },
    confirmAccountEmailChange: (challengeId: string, code: string, key: string) => {
      state.calls.push("confirmAccountEmailChange");
      state.confirms.push({ challengeId, code, key });
      return next(() => Promise.resolve(undefined));
    },
    changeAccountPassword: (currentPassword: string, newPassword: string, key: string) => {
      state.calls.push("changeAccountPassword");
      state.changes.push({ currentPassword, newPassword, key });
      return next(() => Promise.resolve(undefined));
    },
  };
  return { fakeApi: api as unknown as TaskaApi, state };
});

vi.mock("../../api/client", () => ({ taskaApi: fakeApi }));

const refusal = (status: number | null, code: string | null, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(status === null ? "Failed to fetch" : "the server's words"), {
    status,
    code,
    requestId: status === null ? undefined : "rid-1",
    details: null,
    ...extra,
  });

function Forgot() {
  const location = useLocation();
  return <p data-testid="forgot">{JSON.stringify(location.state)}</p>;
}

function open() {
  const harness = companiesHarness({ companyId: "northwind", path: "/settings/account" });
  render(
    <Routes>
      <Route element={<SettingsAccountSection />} path="/settings/account" />
      <Route element={<Forgot />} path="/forgot-password" />
    </Routes>,
    { wrapper: harness.wrapper },
  );
  return harness;
}

beforeEach(() => {
  state.calls = [];
  state.meFails = false;
  state.meHeld = null;
  state.email = "anna@example.com";
  state.starts = [];
  state.confirms = [];
  state.changes = [];
  state.answers = [];
});

const emailRow = () => screen.getByRole("heading", { name: "Email" }).closest("li") as HTMLElement;
const passwordRow = () => screen.getByRole("heading", { name: "Password" }).closest("li") as HTMLElement;

async function toCodeStep() {
  fireEvent.click(await screen.findByRole("button", { name: "Change email" }));
  fireEvent.change(screen.getByLabelText("New email"), { target: { value: " anna.new@example.com " } });
  fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "hunter2" } });
  fireEvent.click(screen.getByRole("button", { name: "Send code" }));
  return screen.findByLabelText("Code");
}

describe("Settings › Account at rest", () => {
  it("draws both rows from the account alone — one read, which the shell shares", async () => {
    open();
    expect(screen.getByText("This email and password sign you in to every company you belong to.")).toBeInTheDocument();
    expect(await within(emailRow()).findByText("anna@example.com")).toBeInTheDocument();
    expect(within(passwordRow()).getByText("Changing it needs your current password.")).toBeInTheDocument();
    expect(state.calls).toEqual(["getCurrentUser"]);
  });

  it("while the account is read: the address's bar and no Change email; the password row whole", () => {
    state.meHeld = new Promise(() => {});
    open();
    expect(emailRow().querySelector(".value-skeleton")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Change email" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change password" })).toBeInTheDocument();
  });

  it("an account that could not be read: one sentence, no Change email, and the password row still works", async () => {
    state.meFails = true;
    open();
    expect(await screen.findByText("Your email could not be loaded.", undefined, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change email" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));
    expect(screen.getByLabelText("Current password")).toHaveFocus();
  });
});

describe("the email change", () => {
  it("step 1: New email focused; empty fields send nothing, the first empty focused, each with its reason", async () => {
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Change email" }));
    expect(screen.getByLabelText("New email")).toHaveFocus();
    expect(screen.getByLabelText("New email")).toHaveAttribute("autocomplete", "email");
    fireEvent.click(screen.getByRole("button", { name: "Send code" }));
    expect(state.starts).toEqual([]);
    expect(screen.getByLabelText("New email")).toHaveAccessibleDescription("Enter the new email address.");
    expect(screen.getByLabelText("Current password")).toHaveAccessibleDescription("Enter your current password.");
    expect(screen.getByLabelText("New email")).toHaveFocus();
  });

  it("the 201: the code step, the password gone from the form, the sentence describing the code", async () => {
    open();
    const code = await toCodeStep();
    expect(state.starts).toEqual([{ newEmail: "anna.new@example.com", currentPassword: "hunter2", key: expect.any(String) }]);
    expect(code).toHaveFocus();
    expect(code).toHaveAttribute("inputmode", "numeric");
    expect(code).toHaveAttribute("autocomplete", "one-time-code");
    expect(code).not.toHaveAttribute("maxlength");
    expect(code).toHaveAccessibleDescription("We sent a code to a•••@example.com. Didn’t get it? Check your spam folder, or start over to send a new code.");
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(document.body.innerHTML).not.toContain("hunter2");
  });

  it("the 201 leaves nothing of the password in the mutation cache (release-reviewer 5)", async () => {
    const { client } = open();
    await toCodeStep();
    await waitFor(() =>
      expect(JSON.stringify(client.getMutationCache().getAll().map((mutation) => mutation.state.variables))).not.toContain("hunter2"),
    );
  });

  it("a malformed 201 is answered: the form's own sentence, no «could not be reached», and the next press a new key (guard 4)", async () => {
    state.answers.push(() => Promise.reject(new MalformedAnswerError()));
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Change email" }));
    fireEvent.change(screen.getByLabelText("New email"), { target: { value: "anna.new@example.com" } });
    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "hunter2" } });
    fireEvent.click(screen.getByRole("button", { name: "Send code" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Your email was not changed.");
    expect(alert).not.toHaveTextContent(/could not be reached/);
    expect(alert.closest(".error-note")?.querySelector(".error-note-detail")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Send code" }));
    await screen.findByLabelText("Code");
    expect(state.starts[1].key).not.toBe(state.starts[0].key);
  });

  it("the 204: the code sent stripped, the form closed, the line said, focus on Change email with the ring", async () => {
    open();
    const code = await toCodeStep();
    fireEvent.change(code, { target: { value: " 1234-5678 " } });
    fireEvent.click(screen.getByRole("button", { name: "Change email" }));
    await screen.findByText("Email changed. Sign in with the new address from now on.");
    expect(state.confirms).toEqual([{ challengeId: "c-1", code: "12345678", key: expect.any(String) }]);
    expect(screen.getByRole("status")).toHaveTextContent("Email changed. Sign in with the new address from now on.");
    await waitFor(() => expect(screen.getByRole("button", { name: "Change email" })).toHaveFocus());
    // Nothing optimistic: the row still shows what the account said.
    expect(within(emailRow()).getByText("anna@example.com")).toBeInTheDocument();
    // The next trigger press clears the line.
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("a wrong code: the server's words, Code marked; a dead code: one sentence focused, Start over and Cancel", async () => {
    state.answers.push(
      () => Promise.resolve(CHALLENGE),
      () => Promise.reject(refusal(400, "VALIDATION_FAILED", { violations: [{ field: "code", code: "MISMATCH", message: "The code is not correct." }] })),
      () => Promise.reject(refusal(422, "CONFIRMATION_EXPIRED")),
    );
    open();
    const code = await toCodeStep();
    fireEvent.change(code, { target: { value: "00000000" } });
    fireEvent.submit(code.closest("form") as HTMLFormElement);
    expect(await screen.findByRole("alert")).toHaveTextContent("The code is not correct.");
    expect(code).toHaveAttribute("aria-invalid", "true");
    expect(code).toHaveValue("00000000");

    fireEvent.click(screen.getByRole("button", { name: "Change email" }));
    const dead = await screen.findByText("This code can’t be used any more. Start over to get a new one.");
    expect(dead.closest(".settings-account-dead")).toHaveFocus();
    expect(screen.queryByLabelText("Code")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start over" })).toHaveClass("primary-button");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("Start over: step 1 with the address kept, the password to type again, focus there, and a new key", async () => {
    open();
    await toCodeStep();
    fireEvent.click(screen.getByRole("button", { name: "Start over" }));
    expect(screen.getByLabelText("New email")).toHaveValue("anna.new@example.com");
    expect(screen.getByLabelText("Current password")).toHaveValue("");
    expect(screen.getByLabelText("Current password")).toHaveFocus();
    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "hunter2" } });
    fireEvent.click(screen.getByRole("button", { name: "Send code" }));
    await screen.findByLabelText("Code");
    expect(state.starts).toHaveLength(2);
    expect(state.starts[1].key).not.toBe(state.starts[0].key);
    expect(state.starts[1]).toMatchObject({ newEmail: "anna.new@example.com", currentPassword: "hunter2" });
  });

  it("a lost answer: «may or may not», and the next press sends the same key and body", async () => {
    state.answers.push(() => Promise.reject(new TypeError("Failed to fetch")));
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Change email" }));
    fireEvent.change(screen.getByLabelText("New email"), { target: { value: "anna.new@example.com" } });
    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "hunter2" } });
    fireEvent.click(screen.getByRole("button", { name: "Send code" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The server could not be reached, so the code may or may not have been sent. Send it again to make sure.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Send code" }));
    await screen.findByLabelText("Code");
    expect(state.starts[1]).toEqual(state.starts[0]);
  });

  it("an address in use: no sentence of the client's — the server's words, the form's sentence, the id", async () => {
    state.answers.push(() => Promise.reject(refusal(409, "INVALID_STATE")));
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Change email" }));
    fireEvent.change(screen.getByLabelText("New email"), { target: { value: "sofia@example.com" } });
    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "hunter2" } });
    fireEvent.click(screen.getByRole("button", { name: "Send code" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Your email was not changed.");
    expect(screen.getByText("the server's words")).toBeInTheDocument();
    expect(screen.getByText("rid-1")).toBeInTheDocument();
  });

  it("Esc is Cancel: the form closes with what was typed, and focus is on its trigger", async () => {
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Change email" }));
    fireEvent.change(screen.getByLabelText("New email"), { target: { value: "x@example.com" } });
    fireEvent.keyDown(screen.getByLabelText("New email"), { key: "Escape" });
    expect(screen.queryByLabelText("New email")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Change email" })).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "Change email" }));
    expect(screen.getByLabelText("New email")).toHaveValue("");
  });

  it("«Forgot your current password?» goes to /forgot-password with the account's address in router state", async () => {
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Change email" }));
    fireEvent.click(screen.getByRole("link", { name: "Forgot your current password?" }));
    expect(screen.getByTestId("forgot")).toHaveTextContent('{"email":"anna@example.com"}');
  });
});

describe("the password change", () => {
  it("Current password focused, a hidden username for the password manager, the new one's bound only", async () => {
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Change password" }));
    expect(screen.getByLabelText("Current password")).toHaveFocus();
    const username = document.querySelector('input[autocomplete="username"]') as HTMLInputElement;
    expect(username).toHaveValue("anna@example.com");
    expect(username.hidden).toBe(true);
    expect(screen.getByLabelText("New password")).toHaveAccessibleDescription("At least 12 characters.");
    expect(screen.getAllByRole("button", { name: "Show password" })).toHaveLength(2);
  });

  it("violations on both fields: two lines, each with its label, both fields marked", async () => {
    state.answers.push(() =>
      Promise.reject(
        refusal(400, "VALIDATION_FAILED", {
          violations: [
            { field: "newPassword", code: "INVALID", message: "Too short." },
            { field: "currentPassword", code: "MISMATCH", message: "The current password is not correct." },
          ],
        }),
      ),
    );
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Change password" }));
    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "wrong" } });
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "short" } });
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Current password: The current password is not correct.New password: Too short.");
    expect(screen.getByLabelText("Current password")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("New password")).toHaveAccessibleDescription("At least 12 characters. New password: Too short.");
  });

  it("two violations of one field: two lines, one id — on the first that names it (N5)", async () => {
    state.answers.push(() =>
      Promise.reject(
        refusal(400, "VALIDATION_FAILED", {
          violations: [
            { field: "newPassword", code: "TOO_SHORT", message: "Too short." },
            { field: "newPassword", code: "WEAK", message: "Too weak." },
          ],
        }),
      ),
    );
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Change password" }));
    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "old" } });
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "short" } });
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));
    const alert = await screen.findByRole("alert");
    const lines = alert.querySelectorAll(".error-note-line");
    expect([...lines].map((line) => line.textContent)).toEqual(["New password: Too short.", "New password: Too weak."]);
    expect(lines[0].id).not.toBe("");
    expect(lines[1].id).toBe("");
    expect(document.querySelectorAll(`[id="${lines[0].id}"]`)).toHaveLength(1);
    expect(screen.getByLabelText("New password")).toHaveAccessibleDescription("At least 12 characters. New password: Too short.");
  });

  it("the 204: fields cleared, form closed, «Password changed.», focus on its trigger", async () => {
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Change password" }));
    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "old one" } });
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "a long new password" } });
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));
    await screen.findByText("Password changed.");
    expect(state.changes).toEqual([{ currentPassword: "old one", newPassword: "a long new password", key: expect.any(String) }]);
    await waitFor(() => expect(screen.getByRole("button", { name: "Change password" })).toHaveFocus());
    expect(document.body.innerHTML).not.toContain("a long new password");
  });

  it("one form at a time: the other trigger closes the open one and drops what was typed", async () => {
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Change password" }));
    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "typed" } });
    fireEvent.click(screen.getByRole("button", { name: "Change email" }));
    expect(screen.getByLabelText("New email")).toBeInTheDocument();
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));
    expect(screen.getByLabelText("Current password")).toHaveValue("");
  });
});
