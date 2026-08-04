import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskaApi } from "../api/TaskaApi";
import { App } from "./App";

/**
 * The expiry path — a rejected session announced by the API, answered once in
 * `App` by clearing the cache and returning to the login form with an
 * explanation — has no coverage anywhere else: `RestTaskaApi.test.ts` stops at
 * the announcement, and the mock-backed Playwright suite structurally cannot
 * reach it, because the mock has no server to reject anything
 * (docs/ai/API-DIVERGENCE.md). So it is pinned here, against a fake `TaskaApi`
 * whose session can be killed on demand.
 */
const { fakeApi, expireSession, signIn } = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const state = { signedIn: true };
  const now = "2026-08-04T10:00:00Z";

  const api = {
    hasSession: () => state.signedIn,
    onSessionExpired: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    login: async () => {
      state.signedIn = true;
      return { accessToken: "access", refreshToken: "refresh", expiresIn: 3600 };
    },
    getCurrentUser: async () => ({
      id: "3f1f5a2e-0000-4000-8000-000000000001",
      login: "anna",
      email: "anna@example.com",
      displayName: "Anna Ivanova",
      status: "ACTIVE" as const,
    }),
    // Enough of a project to render the board shell; the board's contents are
    // not what this file is about, so every collection is empty.
    getProject: async (projectId: string) => ({
      id: projectId,
      projectKey: "TAS",
      name: "Taska Platform",
      createdBy: "3f1f5a2e-0000-4000-8000-000000000001",
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    }),
    getMembership: async () => ({ role: "ADMIN" as const, isMember: true, projectExists: true }),
    listMembers: async () => [],
    getWorkflow: async () => ({
      id: "workflow",
      name: "Default",
      version: 1,
      createdAt: now,
      updatedAt: now,
      statuses: [],
      transitions: [],
    }),
    listIssues: async () => ({ items: [], page: 0, pageSize: 100, totalCount: 0 }),
    listNotifications: async () => ({ items: [], pageSize: 20, offset: 0 }),
    listProjects: async () => [],
  };

  return {
    fakeApi: api as unknown as TaskaApi,
    signIn: () => {
      state.signedIn = true;
    },
    // What a real implementation does, in the order it does it: the credentials
    // are gone *before* the listeners hear about it. Announcing first would send
    // the user to a login form that still sees a session and bounces back.
    expireSession: () => {
      state.signedIn = false;
      for (const listener of [...listeners]) listener();
    },
  };
});

vi.mock("../api/client", () => ({ taskaApi: fakeApi }));

const BOARD = "/projects/2e74e49f-0f29-4e03-b4ec-adc4dbf2382e/board";

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{location.pathname}</span>;
}

describe("App session expiry", () => {
  beforeEach(() => {
    signIn();
    window.localStorage.clear();
  });

  const renderApp = (path: string) => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[path]}>
          <App />
          <LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    return queryClient;
  };

  const signInThroughTheForm = () => {
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "anna@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct-horse" } });
    // "Sign in" names two controls — the mode tab and the submit button.
    const buttons = screen.getAllByRole("button", { name: "Sign in" }) as HTMLButtonElement[];
    fireEvent.click(buttons.find((button) => button.type === "submit")!);
  };

  it("sends the user to the login form, explains why, and drops the dead session's cache", async () => {
    const queryClient = renderApp(BOARD);
    await screen.findByLabelText("Open profile for Anna Ivanova");
    expect(queryClient.getQueryCache().getAll().length).toBeGreaterThan(0);

    act(() => {
      expireSession();
    });

    const notice = await screen.findByText("Your session expired. Sign in to continue.");
    expect(screen.getByTestId("location")).toHaveTextContent("/login");
    expect(screen.getByLabelText("Password")).toBeVisible();
    // Answers cached under the dead session must not survive into the next one.
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    // Nobody asked for this navigation, so focus moves to the sentence that
    // explains it — otherwise a screen reader is told nothing at all (§7).
    expect(notice).toHaveFocus();
  });

  it("returns to the page the session died on once the user signs in again", async () => {
    renderApp(BOARD);
    await screen.findByLabelText("Open profile for Anna Ivanova");

    act(() => {
      expireSession();
    });
    await screen.findByText("Your session expired. Sign in to continue.");

    signInThroughTheForm();

    // Not the generic project list: the board the user was reading when the
    // session died.
    await screen.findByLabelText("Open profile for Anna Ivanova");
    expect(screen.getByTestId("location")).toHaveTextContent(BOARD);
  });

  it("does not offer the expiry explanation over the invite form", async () => {
    renderApp(BOARD);
    await screen.findByLabelText("Open profile for Anna Ivanova");

    act(() => {
      expireSession();
    });
    await screen.findByText("Your session expired. Sign in to continue.");

    fireEvent.click(screen.getByRole("button", { name: "Accept invite" }));

    // "Your session expired. Sign in to continue." above a form headed
    // "Activate account" describes neither of them.
    expect(screen.queryByText("Your session expired. Sign in to continue.")).not.toBeInTheDocument();
  });
});
