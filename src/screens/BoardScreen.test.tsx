import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskaApi } from "../api/TaskaApi";
import { BoardScreen } from "./BoardScreen";

/**
 * The board reads five things and used to show a failure in only one of them.
 * When the project read and the membership read failed — which is exactly what
 * the live gateway does today, TAS-162 — the board still drew: the name fell
 * back to "Project", the key badge vanished, every write control went disabled
 * and drag stopped working, and nothing on screen said why (TAS-163). These
 * tests are about the difference between a board that cannot be written to and
 * a board that will not say whether it can.
 */
const PROJECT_ID = "2e74e49f-0f29-4e03-b4ec-adc4dbf2382e";

const { fakeApi, setMembership, failMembership, failProject, reset } = vi.hoisted(() => {
  const now = "2026-08-01T09:00:00Z";
  const state: {
    membership: { role: "ADMIN" | "MEMBER" | "VIEWER"; isMember: boolean; projectExists: boolean };
    membershipFailure?: Error;
    projectFailure?: Error;
  } = {
    membership: { role: "ADMIN", isMember: true, projectExists: true },
  };

  const api = {
    hasSession: () => true,
    onSessionExpired: () => () => {},
    getCurrentUser: async () => ({
      id: "user-anna",
      login: "anna",
      email: "anna@example.com",
      displayName: "Anna Ivanova",
      status: "ACTIVE" as const,
    }),
    getProject: async (projectId: string) => {
      if (state.projectFailure) throw state.projectFailure;
      return {
        id: projectId,
        projectKey: "TAS",
        name: "Taska Platform",
        createdBy: "user-anna",
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
      };
    },
    getMembership: async () => {
      if (state.membershipFailure) throw state.membershipFailure;
      return state.membership;
    },
    listMembers: async () => [],
    getWorkflow: async () => ({
      id: "workflow",
      name: "Default",
      version: 1,
      createdAt: now,
      updatedAt: now,
      statuses: [{ id: "s1", statusKey: "TODO" as const, name: "To Do", category: "TODO" as const, sortOrder: 10 }],
      transitions: [],
    }),
    listIssues: async () => ({ items: [], page: 0, pageSize: 100, totalCount: 0 }),
    listNotifications: async () => ({ items: [], pageSize: 20, offset: 0 }),
  };

  return {
    fakeApi: api as unknown as TaskaApi,
    setMembership: (role: "ADMIN" | "MEMBER" | "VIEWER") => {
      state.membership = { role, isMember: true, projectExists: true };
    },
    failMembership: (error: Error) => {
      state.membershipFailure = error;
    },
    failProject: (error: Error) => {
      state.projectFailure = error;
    },
    reset: () => {
      state.membership = { role: "ADMIN", isMember: true, projectExists: true };
      state.membershipFailure = undefined;
      state.projectFailure = undefined;
    },
  };
});

vi.mock("../api/client", () => ({ taskaApi: fakeApi }));

function renderBoard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/projects/${PROJECT_ID}/board`]}>
        <Routes>
          <Route
            path="/projects/:projectId/board"
            element={<BoardScreen theme="light" toggleTheme={() => {}} onLogout={() => {}} logoutPending={false} />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/**
 * The board gives a genuine failure one retry (`retryUnlessMissing`), so a
 * banner is a second away rather than a tick away. That budget is deliberate,
 * so the tests wait it out instead of taking it off the screen.
 */
const AFTER_RETRY = { timeout: 3000 };

describe("board failures the user can see", () => {
  beforeEach(() => {
    reset();
    window.localStorage.clear();
  });

  it("says the role could not be determined rather than presenting a silent read-only board", async () => {
    failMembership(Object.assign(new Error("Internal error"), { status: 500, requestId: "6f1c2b40-a1e2-4d55" }));
    renderBoard();

    const alert = await screen.findByRole("alert", undefined, AFTER_RETRY);
    expect(alert).toHaveTextContent(/role in this project could not be determined/i);
    // The gateway's own words and the id that finds this failure in its log.
    expect(alert).toHaveTextContent("Internal error");
    expect(alert).toHaveTextContent("6f1c2b40-a1e2-4d55");
    // Still no write access: a role we could not verify is not a role.
    expect(screen.getByRole("button", { name: "New" })).toBeDisabled();
  });

  it("does not accuse the server when the answer was VIEWER", async () => {
    setMembership("VIEWER");
    renderBoard();

    // Read-only is a permission, not a fault, and gets no banner. Waiting for
    // the board to settle first, so this is the answered state and not the
    // in-flight one that happens to look the same.
    await screen.findByText("To Do");
    expect(screen.getByRole("button", { name: "New" })).toBeDisabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("explains a project that failed to load instead of falling back to the word Project", async () => {
    failProject(Object.assign(new Error("Internal error"), { status: 500, requestId: "c85c0694-7909-4a8a" }));
    renderBoard();

    const alerts = await screen.findAllByRole("alert", undefined, AFTER_RETRY);
    const projectAlert = alerts.find((alert) => /details could not be loaded/i.test(alert.textContent ?? ""));
    expect(projectAlert).toBeDefined();
    expect(projectAlert).toHaveTextContent("c85c0694-7909-4a8a");
    // The fallback title is still there — the banner is what stops it reading
    // as the project's actual name.
    expect(screen.getByText("Project")).toBeVisible();
  });

  it("leaves an editor's board alone", async () => {
    renderBoard();

    await waitFor(() => expect(screen.getByRole("button", { name: "New" })).toBeEnabled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
