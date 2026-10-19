import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { TaskaApi } from "../api/TaskaApi";
import { ApiError } from "../api/rest/RestTaskaApi";
import { formatLockDeadline } from "../lib/accountLock";
import { LoginScreen } from "./LoginScreen";

/**
 * The sign-in failure as the screen draws it. `e2e/login-lock.spec.ts` covers
 * the lock end to end against the mock, whose refusal carries the deadline in
 * both places at once — so nothing there can tell which of the two the screen
 * read. These cases take the two apart.
 */
const { fakeApi, refuseWith } = vi.hoisted(() => {
  const state: { refusal?: Error } = {};
  const api = {
    login: async () => {
      if (state.refusal) throw state.refusal;
      return { accessToken: "a", refreshToken: "r" };
    },
    getCurrentUser: async () => {
      throw new Error("not reached");
    },
  };
  return {
    fakeApi: api as unknown as TaskaApi,
    refuseWith: (refusal: Error) => {
      state.refusal = refusal;
    },
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
