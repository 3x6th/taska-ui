import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
const { fakeApi, expireSession, signIn, signOut, metaReads, breakNotFound, notFoundThrows } = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const state = { signedIn: true, metaReads: 0, notFoundThrows: false };
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
    // The login card's methods (TAS-426): the stand's answer, so the card is today's.
    getAuthMethods: async () => ({ signupEnabled: false, providers: [] }),
    getMeta: async () => {
      state.metaReads += 1;
      return { issueTypes: null, priorities: null, linkTypes: null, notificationTypes: null, userStatuses: null };
    },
    getCurrentUser: async () => ({
      id: "3f1f5a2e-0000-4000-8000-000000000001",
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
    listIssues: async () => ({ items: [], page: 0, pageSize: 100, totalCount: 0 }),
    listNotifications: async () => ({ items: [], pageSize: 20, offset: 0, unreadCount: 0 }),
    listProjects: async () => [],
  };

  return {
    fakeApi: api as unknown as TaskaApi,
    signIn: () => {
      state.signedIn = true;
    },
    signOut: () => {
      state.signedIn = false;
    },
    metaReads: () => state.metaReads,
    /** Makes the `*` route throw while rendering, the way a screen meeting a value it cannot draw would. */
    breakNotFound: (throws: boolean) => {
      state.notFoundThrows = throws;
    },
    notFoundThrows: () => state.notFoundThrows,
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
// The `*` route's screen, wrapped so a test can make it throw. Everything else
// about it is the real screen.
vi.mock("./NotFoundScreen", async (importActual) => {
  const actual = await importActual<typeof import("./NotFoundScreen")>();
  return {
    ...actual,
    NotFoundScreen: (props: Parameters<typeof actual.NotFoundScreen>[0]) => {
      if (notFoundThrows()) throw new Error("Cannot read properties of undefined (reading 'label')");
      return <actual.NotFoundScreen {...props} />;
    },
  };
});

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
    // The tab of the same name is a `tab` since TAS-426, so this is the submit.
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
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
    // The one entry there is the login card's own `GET /auth/methods`, read
    // without a session after the clear (TAS-426).
    expect(queryClient.getQueryCache().getAll().map((query) => query.queryKey[0])).toEqual(["auth-methods"]);
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

    fireEvent.click(screen.getByRole("tab", { name: "Accept invite" }));

    // "Your session expired. Sign in to continue." above a form headed
    // "Activate account" describes neither of them.
    expect(screen.queryByText("Your session expired. Sign in to continue.")).not.toBeInTheDocument();
  });
});

/**
 * TAS-173, art-director's ruling 4: a page that throws while rendering is one
 * screen that says so — outside the shell, since the top bar may be what
 * failed — and never a blank tab. Its way out is a full navigation, not a
 * router push back into the state that failed.
 */
describe("App error boundary", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    signIn();
    window.localStorage.clear();
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    breakNotFound(false);
    consoleError.mockRestore();
  });

  const renderAt = (path: string) =>
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );

  it("replaces a page that throws with the failure screen, the message and both ways out", () => {
    breakNotFound(true);
    renderAt("/no-such-page");

    const heading = screen.getByRole("heading", { level: 1, name: "This page could not be shown" });
    expect(heading).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Taska hit an error while drawing this page. Reloading usually clears it; if it comes back, the line below is what to report.",
    );
    // The message, and not the stack.
    expect(screen.getByText("Cannot read properties of undefined (reading 'label')")).toBeVisible();
    expect(screen.queryByText(/at NotFoundScreen/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeVisible();
    // A real link to the app's own address: a full navigation out of this tree.
    expect(screen.getByRole("link", { name: "Go to projects" })).toHaveAttribute(
      "href",
      `${window.location.origin}/projects`,
    );
    expect(screen.queryByText("Page not found")).not.toBeInTheDocument();
  });

  it("draws the page itself when nothing throws", () => {
    renderAt("/no-such-page");
    expect(screen.getByRole("heading", { name: "Page not found" })).toBeVisible();
    expect(screen.queryByText("This page could not be shown")).not.toBeInTheDocument();
  });
});

/**
 * TAS-173: `GET /meta` is read once per session, started by the session guard
 * so it leaves with the page's first reads, and never asked for by a visitor
 * with no session — a 401 from it would end one.
 */
describe("App dictionaries", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("asks for the dictionaries once on a private page, and not at all without a session", async () => {
    const before = metaReads();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { unmount } = render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/projects"]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(metaReads()).toBe(before + 1));
    unmount();

    signOut();
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/projects"]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByLabelText("Password")).toBeVisible();
    expect(metaReads()).toBe(before + 1);
    signIn();
  });
});
