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
 * The third thing worth pinning is where a hit goes. It carries no
 * `projectId`, so it opens through its key — `/browse/{issueKey}`, which the
 * server resolves (TAS-246) — and is never routed by guessing a project from
 * the key's prefix, which is what this widget did until then.
 */
const { fakeApi, seedHits, failSearch, holdSearch, projectReads, reset } = vi.hoisted(() => {
  interface Hit {
    id: string;
    issueKey: string;
    issueType: "TASK" | "BUG" | "STORY";
    summary: string;
    priority: "LOW" | "MEDIUM" | "HIGH";
    assigneeId: string | null;
    /**
     * The one planning field `IssueShortResponseDto` carries
     * (docs/contract/openapi.yml, backend develop `21a0d9d177a1`, merged PR
     * #148) — no dates and no estimates. Stated here rather than left out
     * because the fake is cast to `TaskaApi`, so a hit missing a field the
     * domain declares is a shape gap nothing would report; and `null` is the
     * honest seed for a search that does not show points.
     */
    storyPoints: number | null;
  }
  const now = "2026-08-01T09:00:00Z";
  const state: {
    hits: Hit[];
    totalCount: number;
    failure?: Error;
    held: boolean;
    /** Every project-list read, so a test can say the widget no longer needs one. */
    projectReads: number;
  } = {
    hits: [],
    totalCount: 0,
    held: false,
    projectReads: 0,
  };

  const api = {
    hasSession: () => true,
    onSessionExpired: () => () => {},
    listProjects: async () => {
      state.projectReads += 1;
      return [{ id: "project-tas", projectKey: "TAS", name: "TAS", createdBy: "user-anna", createdAt: now, updatedAt: now, archivedAt: null }];
    },
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
    projectReads: () => state.projectReads,
    reset: () => {
      state.hits = [];
      state.totalCount = 0;
      state.failure = undefined;
      state.held = false;
      state.projectReads = 0;
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
  storyPoints: null,
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

    // Through the issue's short address, which the server resolves — a key
    // with a hyphen in its project part included, which a prefix split had to
    // guess at.
    expect(screen.getByTestId("address")).toHaveTextContent("/browse/kappa-test-1");
    // The question has been answered, so the field stops holding it.
    expect(box).toHaveValue("");
  });

  it("opens the first result when Enter is pressed with nothing walked to", async () => {
    seedHits([hit("TAS-101", "First")]);
    const box = renderSearch();
    fireEvent.change(box, { target: { value: "board" } });
    await screen.findByRole("listbox");

    fireEvent.keyDown(box, { key: "Enter" });

    expect(screen.getByTestId("address")).toHaveTextContent("/browse/TAS-101");
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

  it("opens a hit from a project this client has never read, without asking for the project list", async () => {
    seedHits([hit("ZZZ-9", "From a project this client has never read")]);
    const box = renderSearch();

    fireEvent.change(box, { target: { value: "board" } });

    // Linkable: which project `ZZZ-9` lives in is the server's to say, when it
    // is opened — not this list's to know in advance.
    const option = await screen.findByRole("option");
    expect(option).not.toHaveAttribute("aria-disabled");
    expect(within(option).queryByText(/Project (unknown|not loaded)/)).not.toBeInTheDocument();

    fireEvent.keyDown(box, { key: "Enter" });
    expect(screen.getByTestId("address")).toHaveTextContent("/browse/ZZZ-9");
    expect(projectReads()).toBe(0);
  });

  it("encodes a key for the address rather than trusting it to be a path segment", async () => {
    seedHits([hit("A/B 1", "An odd key")]);
    const box = renderSearch();
    fireEvent.change(box, { target: { value: "board" } });
    await screen.findByRole("option");

    fireEvent.keyDown(box, { key: "Enter" });

    expect(screen.getByTestId("address")).toHaveTextContent("/browse/A%2FB%201");
  });

  it("draws a hit with no key and does not offer it", async () => {
    seedHits([hit("", "No key at all", "no-key")]);
    const box = renderSearch();
    fireEvent.change(box, { target: { value: "board" } });

    const option = await screen.findByRole("option");
    expect(option).toHaveAttribute("aria-disabled", "true");
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
