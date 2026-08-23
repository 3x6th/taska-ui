import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskaApi } from "../api/TaskaApi";
import { GlobalSearch } from "./GlobalSearch";

/**
 * The top bar's search across every project (TAS-179).
 *
 * Two things are being pinned here and they are different in kind. One is the
 * combobox contract from §7 — arrows through the options, Enter to open,
 * Escape to close, focus that never leaves the field — which is what makes
 * this operable without a mouse at all. The other is the honesty rule the rest
 * of this app is built on: empty, loading, failed and none-found are four
 * answers, and a search that failed is never drawn as a search that found
 * nothing.
 *
 * The third thing worth pinning is the compensation. A hit carries no
 * `projectId` (docs/ai/API-DIVERGENCE.md), so the route is resolved from the
 * `issueKey` prefix against the projects list — and a prefix that resolves to
 * nothing must produce a row that is not a link rather than a guessed route.
 */
const { fakeApi, seedHits, failSearch, holdSearch, seedProjects, reset } = vi.hoisted(() => {
  interface Hit {
    id: string;
    issueKey: string;
    issueType: "TASK" | "BUG" | "STORY";
    summary: string;
    priority: "LOW" | "MEDIUM" | "HIGH";
    assigneeId: string | null;
  }
  const now = "2026-08-01T09:00:00Z";
  const state: {
    hits: Hit[];
    totalCount: number;
    failure?: Error;
    held: boolean;
    projects: { id: string; projectKey: string }[];
  } = {
    hits: [],
    totalCount: 0,
    held: false,
    projects: [
      { id: "project-tas", projectKey: "TAS" },
      // A lower-case key with a hyphen in it, which the deployed gateway has:
      // splitting `kappa-test-1` on the first hyphen would look for a project
      // called `kappa`.
      { id: "project-kappa", projectKey: "kappa-test" },
    ],
  };

  const api = {
    hasSession: () => true,
    onSessionExpired: () => () => {},
    listProjects: async () =>
      state.projects.map((project) => ({
        ...project,
        name: project.projectKey,
        createdBy: "user-anna",
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
      })),
    searchIssues: async () => {
      if (state.held) return new Promise(() => {});
      if (state.failure) throw state.failure;
      return { items: state.hits, page: 0, pageSize: 8, totalCount: state.totalCount };
    },
  };

  return {
    fakeApi: api as unknown as TaskaApi,
    seedHits: (hits: Hit[], totalCount = hits.length) => {
      state.hits = hits;
      state.totalCount = totalCount;
    },
    failSearch: (error: Error) => {
      state.failure = error;
    },
    holdSearch: () => {
      state.held = true;
    },
    seedProjects: (projects: { id: string; projectKey: string }[]) => {
      state.projects = projects;
    },
    reset: () => {
      state.hits = [];
      state.totalCount = 0;
      state.failure = undefined;
      state.held = false;
      state.projects = [
        { id: "project-tas", projectKey: "TAS" },
        { id: "project-kappa", projectKey: "kappa-test" },
      ];
    },
  };
});

vi.mock("../api/client", () => ({ taskaApi: fakeApi }));

function Address() {
  const location = useLocation();
  return <p data-testid="address">{location.pathname}</p>;
}

function renderSearch() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/projects"]}>
        <GlobalSearch />
        <Address />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return screen.getByRole("combobox", { name: /Search issues/ });
}

const hit = (issueKey: string, summary: string, id = issueKey.toLowerCase()) => ({
  id,
  issueKey,
  issueType: "BUG" as const,
  summary,
  priority: "HIGH" as const,
  assigneeId: null,
});

describe("the top bar's global search", () => {
  beforeEach(() => {
    reset();
    window.localStorage.clear();
  });

  it("says nothing until the query reaches the minimum the gateway enforces", async () => {
    const box = renderSearch();

    fireEvent.change(box, { target: { value: "bo" } });

    // Two characters is what the contract permits and the runtime refuses, so
    // the field says so rather than sending a request that would 400.
    expect(await screen.findByText(/at least 3 characters/i)).toBeVisible();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("lists what the server found and says how many more there are", async () => {
    seedHits([hit("TAS-101", "Login form validation fails"), hit("kappa-test-1", "Mapper drops a field")], 42);
    const box = renderSearch();

    fireEvent.change(box, { target: { value: "board" } });

    const list = await screen.findByRole("listbox", { name: "Issue search results" });
    const options = within(list).getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveTextContent("TAS-101");
    expect(options[0]).toHaveTextContent("Login form validation fails");
    // The one number a dropdown of eight could not otherwise state.
    expect(screen.getByText("Showing 2 of 42 matches.")).toBeVisible();
  });

  it("opens the active result with Enter, having walked to it with the arrows", async () => {
    seedHits([hit("TAS-101", "First"), hit("kappa-test-1", "Second")]);
    const box = renderSearch();
    fireEvent.change(box, { target: { value: "board" } });
    await screen.findByRole("listbox");

    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "ArrowDown" });

    // Focus never leaves the field; the active option is named by id instead.
    const second = screen.getAllByRole("option")[1];
    expect(box).toHaveAttribute("aria-activedescendant", second.id);
    expect(second).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(box, { key: "Enter" });

    // The project came from the issue key's prefix — split on the *last*
    // hyphen, or `kappa-test-1` would have looked for a project called `kappa`.
    expect(screen.getByTestId("address")).toHaveTextContent("/projects/project-kappa/issues/kappa-test-1");
    // The question has been answered, so the field stops holding it.
    expect(box).toHaveValue("");
  });

  it("opens the first result when Enter is pressed with nothing walked to", async () => {
    seedHits([hit("TAS-101", "First")]);
    const box = renderSearch();
    fireEvent.change(box, { target: { value: "board" } });
    await screen.findByRole("listbox");

    fireEvent.keyDown(box, { key: "Enter" });

    expect(screen.getByTestId("address")).toHaveTextContent("/projects/project-tas/issues/tas-101");
  });

  it("closes on Escape, clears on the second, and closes on a press outside", async () => {
    seedHits([hit("TAS-101", "First")]);
    const box = renderSearch();
    fireEvent.change(box, { target: { value: "board" } });
    await screen.findByRole("listbox");
    expect(box).toHaveAttribute("aria-expanded", "true");

    fireEvent.keyDown(box, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(box).toHaveAttribute("aria-expanded", "false");
    // The panel first, the question second — the field keeps its text through
    // the press that only took the panel away.
    expect(box).toHaveValue("board");
    fireEvent.keyDown(box, { key: "Escape" });
    expect(box).toHaveValue("");

    fireEvent.change(box, { target: { value: "board" } });
    await screen.findByRole("listbox");
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
  });

  it("renders a hit whose project it cannot resolve without a link rather than guessing one", async () => {
    seedProjects([{ id: "project-tas", projectKey: "TAS" }]);
    seedHits([hit("ZZZ-9", "From a project this client has never read")]);
    const box = renderSearch();

    fireEvent.change(box, { target: { value: "board" } });

    const option = await screen.findByRole("option");
    expect(option).toHaveAttribute("aria-disabled", "true");
    expect(within(option).getByText("Project unknown")).toBeVisible();

    // And Enter does not invent a route for it.
    fireEvent.keyDown(box, { key: "Enter" });
    expect(screen.getByTestId("address")).toHaveTextContent("/projects");
  });

  it("says a search failed rather than showing it as no results", async () => {
    failSearch(Object.assign(new Error("Internal error"), { status: 500, requestId: "9c0b41ee-2f10-4a55" }));
    const box = renderSearch();

    fireEvent.change(box, { target: { value: "board" } });

    expect(await screen.findByText(/could not be run/i)).toBeVisible();
    // Four states, four sentences: this is not "no issues match".
    expect(screen.queryByText(/No issues match/i)).not.toBeInTheDocument();
    // With the gateway's own words and the id its log knows the failure by.
    expect(screen.getByText("Internal error")).toBeVisible();
    expect(screen.getByRole("button", { name: /Copy request id 9c0b41ee-2f10-4a55/ })).toBeVisible();
  });

  it("says a search is running rather than saying it found nothing", async () => {
    holdSearch();
    const box = renderSearch();

    fireEvent.change(box, { target: { value: "board" } });

    expect(await screen.findByText(/Searching every project/i)).toBeVisible();
    expect(screen.queryByText(/No issues match/i)).not.toBeInTheDocument();
  });

  it("says nothing matched when the server answered with nothing", async () => {
    seedHits([]);
    const box = renderSearch();

    fireEvent.change(box, { target: { value: "board" } });

    expect(await screen.findByText(/No issues match “board”/)).toBeVisible();
  });
});
