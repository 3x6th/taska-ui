import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskaApi } from "../api/TaskaApi";
import type { User } from "../domain/types";
import { App } from "./App";

/**
 * `/admin` decides what to render from an asynchronous answer, which is the
 * whole risk: a user who is not a GLOBAL_ADMIN must get the not-found screen
 * (DESIGN.md §4.18), and nobody — admin included — may see it flash while
 * `GET /users/me` is still in flight. Both need a `me` that can be held open on
 * demand, so this runs the real routes against a fake `TaskaApi` rather than
 * rendering the screen in isolation.
 */
const { fakeApi, setCurrentUser, failMe, holdMe, releaseMe } = vi.hoisted(() => {
  const state: { user?: User; failure?: Error; gate?: Promise<void>; release?: () => void } = {};

  const api = {
    hasSession: () => true,
    onSessionExpired: () => () => {},
    getCurrentUser: async () => {
      if (state.gate) await state.gate;
      if (state.failure) throw state.failure;
      if (!state.user) throw new Error("the test did not say who is signed in");
      return state.user;
    },
    listProjects: async () => [],
    listNotifications: async () => ({ items: [], pageSize: 20, offset: 0 }),
  };

  return {
    fakeApi: api as unknown as TaskaApi,
    setCurrentUser: (user: User) => {
      state.user = user;
      state.failure = undefined;
    },
    // `GET /users/me` failing with something that is not a 401: a 5xx, a
    // network drop, a CORS refusal — none of which end the session, so the
    // screen is left deciding with no role in hand.
    failMe: () => {
      state.user = undefined;
      state.failure = new Error("the profile request failed");
    },
    // Keeps `me` pending until `releaseMe()`, which is the only way to observe
    // what the screen renders before it settles.
    holdMe: () => {
      state.gate = new Promise<void>((resolve) => {
        state.release = resolve;
      });
    },
    releaseMe: () => {
      state.release?.();
      state.gate = undefined;
      state.release = undefined;
    },
  };
});

vi.mock("../api/client", () => ({ taskaApi: fakeApi }));

const anna: User = {
  id: "3f1f5a2e-0000-4000-8000-000000000001",
  login: "anna",
  email: "anna@example.com",
  displayName: "Anna Ivanova",
  status: "ACTIVE",
};

function renderAdmin() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/admin"]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("/admin", () => {
  beforeEach(() => {
    releaseMe();
    setCurrentUser(anna);
    window.localStorage.clear();
  });

  it("opens the section for a global admin", async () => {
    setCurrentUser({ ...anna, globalRole: "GLOBAL_ADMIN" });
    renderAdmin();

    expect(await screen.findByRole("heading", { name: "Administration" })).toBeVisible();
    // The same app shell as the project list, profile menu included.
    expect(screen.getByLabelText("Open profile for Anna Ivanova")).toBeVisible();
    expect(screen.getByRole("link", { name: "Back to projects" })).toHaveAttribute("href", "/projects");
  });

  it("answers a plain user exactly as an unknown URL does", async () => {
    setCurrentUser({ ...anna, globalRole: "USER" });
    renderAdmin();

    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeVisible();
    // Nothing of the section leaks: not its heading, not its chrome.
    expect(screen.queryByRole("heading", { name: "Administration" })).not.toBeInTheDocument();
  });

  it("treats an account with no stated role as not an admin", async () => {
    setCurrentUser(anna);
    renderAdmin();

    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeVisible();
  });

  // A failed `me` reaches the screen as no data, exactly like a plain user, and
  // is answered the same way on purpose: the screen never learned that this
  // account is an admin, and an error state here would confirm the section
  // exists to someone who may not be allowed to know (§4.18). The server stays
  // the authority either way.
  it("answers a profile that failed to load as not an admin", async () => {
    failMe();
    renderAdmin();

    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Administration" })).not.toBeInTheDocument();
  });

  it("shows nothing at all until the profile answers, rather than flashing not found", async () => {
    setCurrentUser({ ...anna, globalRole: "GLOBAL_ADMIN" });
    holdMe();
    renderAdmin();

    // Several turns of the microtask queue: enough for react-query to have
    // resolved anything that was resolvable, and the answer still is not here.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.queryByRole("heading", { name: "Page not found" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Administration" })).not.toBeInTheDocument();

    await act(async () => {
      releaseMe();
    });

    expect(await screen.findByRole("heading", { name: "Administration" })).toBeVisible();
  });

  it("does not flash not found on the way to answering a plain user", async () => {
    setCurrentUser({ ...anna, globalRole: "USER" });
    holdMe();
    renderAdmin();

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole("heading", { name: "Page not found" })).not.toBeInTheDocument();

    await act(async () => {
      releaseMe();
    });

    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeVisible();
  });
});
