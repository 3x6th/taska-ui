import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskaApi } from "../api/TaskaApi";
import { companiesHarness } from "../test/companiesHarness";
import { LoginScreen } from "./LoginScreen";

/*
 * The sign-in card in the companies build (TAS-500): after the password, the
 * account and the company list are read side by side (api-contract-guard N3),
 * then the reader goes where §4.33 «Когда» says; a GLOBAL_ADMIN meets the note.
 */

const { fakeApi, state } = vi.hoisted(() => {
  const state = {
    calls: [] as string[],
    release: [] as (() => void)[],
    admin: false,
  };
  const held = <T,>(name: string, value: T) => {
    state.calls.push(name);
    return new Promise<T>((resolve) => state.release.push(() => resolve(value)));
  };
  const api = {
    getAuthMethods: async () => ({ signupEnabled: false, providers: ["GOOGLE"] }),
    hasSession: () => false,
    lastCompanyHint: () => null,
    oauthStartUrl: () => "https://api.example/start",
    signIn: async () => {
      state.calls.push("signIn");
      return state.admin ? { status: "ADMIN_MFA_REQUIRED" as const, requestId: null } : { status: "SIGNED_IN" as const, userId: "anna" };
    },
    getCurrentUser: () => held("getCurrentUser", { id: "anna", email: "anna@example.com", displayName: "Anna", status: "ACTIVE" }),
    listTenants: () =>
      held("listTenants", {
        items: [{ id: "n", name: "Northwind", ownerId: "anna", lifecycle: "ACTIVE", restrictions: [], createdAt: "2026-05-01T09:00:00Z", version: "1" }],
        nextCursor: null,
      }),
  };
  return { fakeApi: api as unknown as TaskaApi, state };
});

vi.mock("../api/client", () => ({ taskaApi: fakeApi }));

const props = { theme: "light" as const, toggleTheme: () => {}, onLogout: () => {}, logoutPending: false };

beforeEach(() => {
  state.calls = [];
  state.release = [];
  state.admin = false;
});

async function submit() {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "anna@example.com" } });
  fireEvent.change(screen.getByLabelText("Password", { selector: "input" }), { target: { value: "x" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
}

describe("signing in to the companies build", () => {
  it("reads the account and the list in parallel, then enters the one company", async () => {
    const { wrapper, go } = companiesHarness({ path: "/login" });
    render(<LoginScreen {...props} initialMode="signin" />, { wrapper });
    // No provider buttons in this build, whatever the methods say.
    await waitFor(() => expect(screen.getByLabelText("Email")).toBeInTheDocument());
    expect(screen.queryByRole("link", { name: /Google/ })).not.toBeInTheDocument();
    await submit();
    await waitFor(() => expect(state.calls).toEqual(["signIn", "getCurrentUser", "listTenants"]));
    // Both are out before either has answered: depth two after the password.
    expect(state.release).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Signing in" })).toBeInTheDocument();
    for (const release of state.release) release();
    // A company that has never opened would continue in this card (TAS-501): the state says so; the app shell ignores it.
    await waitFor(() => expect(go).toHaveBeenCalledWith("/c/n/projects", { replace: true, state: { continuedShell: true } }));
  });

  it("a GLOBAL_ADMIN gets the emailed-code note in the refusal slot, and nothing more is read", async () => {
    state.admin = true;
    const { wrapper, go } = companiesHarness({ path: "/login" });
    render(<LoginScreen {...props} initialMode="signin" />, { wrapper });
    await waitFor(() => expect(screen.getByLabelText("Email")).toBeInTheDocument());
    await submit();
    expect(
      await screen.findByText("Administrator accounts sign in with a code sent by email. This version of Taska can’t ask for it yet."),
    ).toBeInTheDocument();
    expect(state.calls).toEqual(["signIn"]);
    expect(go).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Email")).toHaveValue("anna@example.com");
  });
});
