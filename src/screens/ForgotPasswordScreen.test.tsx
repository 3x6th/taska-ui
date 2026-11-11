import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskaApi } from "../api/TaskaApi";
import { companiesHarness } from "../test/companiesHarness";
import { ForgotPasswordScreen } from "./ForgotPasswordScreen";

/*
 * `/forgot-password` (TAS-527, art-director B4, B7, B12, B13): one sentence
 * for every 202, the typed address and the wait the only variables; a key per
 * press, the lost press's key on its retry; the refusals in the form's slot.
 */

const { fakeApi, state } = vi.hoisted(() => {
  const state = {
    calls: [] as Array<{ email: string; key: string }>,
    answers: [] as Array<() => Promise<unknown>>,
  };
  const api = {
    hasSession: () => false,
    requestPasswordRecovery: (email: string, key: string) => {
      state.calls.push({ email, key });
      const next = state.answers.shift();
      return next ? next() : Promise.resolve({ retryAfterSeconds: 60 });
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

const props = { theme: "light" as const, toggleTheme: () => {} };

function Where() {
  const location = useLocation();
  return <div data-testid="state">{JSON.stringify(location.state)}</div>;
}

function open(state: unknown = null) {
  const { wrapper } = companiesHarness({ path: "/forgot-password", state });
  return render(
    <Routes>
      <Route
        element={
          <>
            <ForgotPasswordScreen {...props} />
            <Where />
          </>
        }
        path="/forgot-password"
      />
    </Routes>,
    { wrapper },
  );
}

beforeEach(() => {
  state.calls = [];
  state.answers = [];
});

async function send(email: string) {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
}

describe("the reset request", () => {
  it("starts from the address the reader came with, focused, and drops it from the history entry", async () => {
    open({ email: "anna@example.com" });
    expect(screen.getByLabelText("Email")).toHaveValue("anna@example.com");
    expect(screen.getByLabelText("Email")).toHaveFocus();
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("null"));
    expect(screen.getByRole("heading", { level: 1, name: "Reset your password" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to sign in" })).toHaveAttribute("href", "/login");
  });

  it("an empty address sends nothing: the reason in the hint slot, the field marked and focused", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(state.calls).toEqual([]);
    const field = screen.getByLabelText("Email");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription("Enter your email.");
    expect(field).toHaveFocus();
  });

  it("every 202 is the same view: the typed address, trimmed, and nothing of the answer but its wait (B4)", async () => {
    const views: string[] = [];
    for (const email of ["anna@example.com", "nobody@nowhere.test"]) {
      const { container, unmount } = open();
      await send(`  ${email} `);
      await screen.findByRole("heading", { name: "Check your email" });
      expect(screen.getByRole("heading", { name: "Check your email" })).toHaveFocus();
      views.push(container.innerHTML.replaceAll(email, "{email}").replace(/id="[^"]*"/g, "").replace(/aria-describedby="[^"]*"/g, ""));
      unmount();
    }
    expect(views[0]).toBe(views[1]);
    expect(state.calls.map((call) => call.email)).toEqual(["anna@example.com", "nobody@nowhere.test"]);
    expect(views[0]).toContain("If {email} belongs to a Taska account, we’ve sent a link there.");
  });

  it("the wait: the answer's seconds count down; none named is the minute; zero is none", async () => {
    state.answers.push(() => Promise.resolve({ retryAfterSeconds: 0 }));
    open();
    await send("anna@example.com");
    await screen.findByText("Didn’t get it? Check your spam folder, then resend.");
    expect(screen.getByRole("button", { name: "Resend link" })).not.toHaveAttribute("aria-disabled");

    state.answers.push(() => Promise.resolve({ retryAfterSeconds: null }));
    fireEvent.click(screen.getByRole("button", { name: "Use a different email" }));
    expect(screen.getByLabelText("Email")).toHaveFocus();
    await send("anna@example.com");
    await screen.findByText(/You can resend in/);
    expect(screen.getByText("1:00")).toHaveClass("auth-countdown");
    expect(screen.getByRole("button", { name: "Resend link" })).toHaveAttribute("aria-disabled", "true");
  });

  it("a press nothing answered is sent again with its key; an answered one, or an edit, makes a new key", async () => {
    state.answers.push(() => Promise.reject(new TypeError("Failed to fetch")));
    open();
    await send("anna@example.com");
    expect(await screen.findByText("The reset link could not be sent.")).toBeInTheDocument();
    state.answers.push(() => Promise.reject(refusal(503, "DEPENDENCY_UNAVAILABLE")));
    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
    await waitFor(() => expect(state.calls).toHaveLength(2));
    expect(state.calls[1].key).toBe(state.calls[0].key);
    await screen.findByText("rid-1");
    // Answered (503): the next press is a new intent.
    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
    await waitFor(() => expect(state.calls).toHaveLength(3));
    expect(state.calls[2].key).not.toBe(state.calls[1].key);
  });

  it("refusals: a violation marks Email in the server's words; a 429 says the wait; the rest the form's sentence, the server's words and the id", async () => {
    state.answers.push(() =>
      Promise.reject(refusal(400, "VALIDATION_FAILED", { violations: [{ field: "email", code: "INVALID", message: "The email address is not valid." }] })),
    );
    open();
    await send("nope");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The email address is not valid.");
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Email")).toHaveAccessibleDescription("The email address is not valid.");

    state.answers.push(() => Promise.reject(refusal(429, "RATE_LIMITED", { retryAfterSeconds: 42 })));
    await send("anna@example.com");
    await screen.findByText("Too many attempts. Try again in 42 seconds.");
    expect(screen.getByLabelText("Email")).not.toHaveAttribute("aria-invalid");

    state.answers.push(() => Promise.reject(refusal(503, "DEPENDENCY_UNAVAILABLE")));
    await send("anna@example.com");
    await screen.findByText("The reset link could not be sent.");
    expect(screen.getByText("the server's words")).toBeInTheDocument();
  });
});

describe("«Check your email»", () => {
  it("Resend sends the same address with a new key, says so in the hidden status, and counts again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      open();
      await send("anna@example.com");
      await screen.findByRole("heading", { name: "Check your email" });
      const resend = screen.getByRole("button", { name: "Resend link" });
      // Unavailable while the minute runs: the handler refuses.
      fireEvent.click(resend);
      expect(state.calls).toHaveLength(1);
      await act(async () => {
        vi.advanceTimersByTime(61_000);
      });
      await screen.findByText("Didn’t get it? Check your spam folder, then resend.");
      fireEvent.click(screen.getByRole("button", { name: "Resend link" }));
      await waitFor(() => expect(state.calls).toHaveLength(2));
      expect(state.calls[1]).toEqual({ email: "anna@example.com", key: expect.not.stringMatching(state.calls[0].key) });
      await screen.findByText(/we’ve sent another link there/, { selector: ".auth-text" });
      expect(screen.getByRole("status")).toHaveTextContent(
        "If anna@example.com belongs to a Taska account, we’ve sent another link there. Open it to choose a new password.",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("a 429 on Resend counts down from the server's wait, and says it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      state.answers.push(() => Promise.resolve({ retryAfterSeconds: 0 }));
      state.answers.push(() => Promise.reject(refusal(429, "RATE_LIMITED", { retryAfterSeconds: 760 })));
      open();
      await send("anna@example.com");
      await screen.findByRole("heading", { name: "Check your email" });
      fireEvent.click(screen.getByRole("button", { name: "Resend link" }));
      await screen.findByText(/Too many attempts\. You can resend in/);
      expect(screen.getByText("12:40")).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("Too many attempts. Try again in 13 minutes.");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
