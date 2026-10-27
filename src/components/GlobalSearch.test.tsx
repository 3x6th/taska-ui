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
 * The third thing worth pinning is where a hit goes. Since backend TAS-218 a
 * hit names its project and opens straight to it. One that does not — most
 * fixtures below, which predate it — opens through its key,
 * `/browse/{issueKey}`, which the server resolves (TAS-246), and is never
 * routed by guessing a project from the key's prefix, which is what this
 * widget did until then.
 */
const { fakeApi, seedHits, failSearch, holdSearch, projectReads, contextReads, reset } = vi.hoisted(() => {
  interface Hit {
    id: string;
    issueKey: string;
    /** Any code: the search route can carry a type or a priority this build has no name for (TAS-173). */
    issueType: string;
    summary: string;
    priority: string;
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
    /** The three TAS-218 added; absent in the fixtures that stand for an older gateway. */
    projectId?: string | null;
    projectKey?: string | null;
    statusKey?: string | null;
    /**
     * The type's look from the hit's project registry (backend TAS-418,
     * TAS-432); absent or null for a type not in it, the icon alone null
     * for a type without one.
     */
    issueTypeName?: string | null;
    issueTypeColor?: string | null;
    issueTypeShape?: string | null;
    issueTypeIcon?: string | null;
  }
  const now = "2026-08-01T09:00:00Z";
  const state: {
    hits: Hit[];
    totalCount: number;
    failure?: Error;
    held: boolean;
    /** Every project-list read, so a test can say the widget no longer needs one. */
    projectReads: number;
    /** Every project-context read: a type is drawn from the hit, never from a context read per hit (TAS-418). */
    contextReads: number;
  } = {
    hits: [],
    totalCount: 0,
    held: false,
    projectReads: 0,
    contextReads: 0,
  };

  const api = {
    hasSession: () => true,
    onSessionExpired: () => () => {},
    // `GET /meta` (TAS-173): Russian names, as the stand answered before
    // backend #201 and as the permanent Cyrillic check still has to handle,
    // plus an English one for a type this build does not know — what a hit of
    // that type is called.
    getMeta: async () => ({
      issueTypes: [
        { code: "TASK", name: "Задача" },
        { code: "EPIC", name: "Epic" },
      ],
      priorities: [
        { code: "HIGH", name: "Высокий" },
        { code: "URGENT", name: "Срочный" },
      ],
      linkTypes: null,
      notificationTypes: null,
      userStatuses: null,
    }),
    listProjects: async () => {
      state.projectReads += 1;
      return [{ id: "project-tas", projectKey: "TAS", name: "TAS", createdBy: "user-anna", createdAt: now, updatedAt: now, archivedAt: null }];
    },
    getProjectContext: async () => {
      state.contextReads += 1;
      throw new Error("Global search must not read a project context");
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
    contextReads: () => state.contextReads,
    reset: () => {
      state.hits = [];
      state.totalCount = 0;
      state.failure = undefined;
      state.held = false;
      state.projectReads = 0;
      state.contextReads = 0;
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

    // Two characters is below the contract's `minLength: 3`, which the gateway
    // refuses with a 400 before sign-in, so the field says so rather than
    // sending a request that would 400.
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

  it("opens a hit that names its project straight to it, and says its status", async () => {
    seedHits([
      { ...hit("TAS-101", "Named project"), projectId: "project-tas", projectKey: "TAS", statusKey: "IN_PROGRESS" },
      { ...hit("TAS-102", "A status this build has no name for"), projectId: "project-tas", statusKey: "BLOCKED" },
    ]);
    const box = renderSearch();
    fireEvent.change(box, { target: { value: "board" } });

    const [first, second] = await screen.findAllByRole("option");
    expect(within(first).getByText("In Progress")).toBeVisible();
    // Verbatim, never trusted into a known status (TAS-173).
    expect(within(second).getByText("BLOCKED")).toBeVisible();

    fireEvent.keyDown(box, { key: "Enter" });
    // No short address and no lookup: the hit said where it lives.
    expect(screen.getByTestId("address")).toHaveTextContent("/projects/project-tas/issues/tas-101");
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

  // TAS-173: a hit of a type, a priority and a status this build does not know
  // is a row like any other — named by the one label rule, never indexed into a
  // table that has no entry for it, which is what took the top bar down.
  it("draws a hit of an unknown priority and status by the label rule, and its type from the hit's own look", async () => {
    seedHits([
      {
        ...hit("WEB-15", "Checkout redesign"),
        issueType: "EPIC",
        issueTypeName: "Epic",
        issueTypeColor: "purple",
        issueTypeShape: "square",
        issueTypeIcon: "layers",
        priority: "URGENT",
        projectId: "project-web",
        statusKey: "IN_REVIEW",
      },
    ]);
    const box = renderSearch();

    fireEvent.change(box, { target: { value: "checkout" } });

    const option = await screen.findByRole("option", { name: /WEB-15/ });
    // The type by the hit's own name (backend TAS-418), the priority as its
    // code — /meta names it in Russian — lowercased only where the word is
    // the build's.
    expect(await within(option).findByText("Epic, URGENT priority")).toHaveClass("visually-hidden");
    expect(within(option).getByText("URGENT")).toHaveClass("global-search-note");
    expect(within(option).getByText("IN_REVIEW")).toHaveClass("global-search-note");
    const chip = option.querySelector(".type-chip") as HTMLElement;
    expect(chip).toHaveAttribute("title", "Epic");
    // The hit's icon instead of its shape (§4.6, TAS-434), stroked in §2.2's purple.
    expect(chip).toHaveClass("is-icon");
    expect(chip).not.toHaveClass("is-square");
    expect(chip.style.getPropertyValue("--type-fill")).toBe("#8b5cf6");
    expect(chip.querySelector("svg")).not.toBeNull();
    expect(contextReads()).toBe(0);
  });

  it("names a hit's type by the Cyrillic rule and draws one with no look neutral, never asking /meta or a context", async () => {
    seedHits([
      // /meta names TASK "Задача"; the hit's own name wins, and is English.
      { ...hit("TAS-1", "Renamed"), issueType: "TASK", issueTypeName: "Chore", issueTypeColor: "teal", issueTypeShape: "diamond", issueTypeIcon: null },
      // A Cyrillic name on a seeded key: the build's word.
      { ...hit("TAS-2", "Russian"), id: "b", issueType: "BUG", issueTypeName: "Ошибка", issueTypeColor: "red", issueTypeShape: "circle", issueTypeIcon: null },
      // A type deleted from the registry since: the look is absent, the key is printed.
      { ...hit("TAS-3", "Orphan"), id: "c", issueType: "REQUEST" },
    ]);
    const box = renderSearch();

    fireEvent.change(box, { target: { value: "anything" } });

    const [renamed, russian, orphan] = await within(
      await screen.findByRole("listbox", { name: "Issue search results" }),
    ).findAllByRole("option");
    expect(within(renamed).getByText("Chore, high priority")).toBeInTheDocument();
    expect(within(russian).getByText("Bug, high priority")).toBeInTheDocument();
    expect(within(orphan).getByText("REQUEST, high priority")).toBeInTheDocument();
    // The hit's own shape, no glyph (TAS-432 puts the shape on the hit).
    expect(renamed.querySelector(".type-chip")).toHaveClass("is-diamond");
    expect(russian.querySelector(".type-chip")).toHaveClass("is-circle");
    expect(russian.querySelector(".type-chip svg")).toBeNull();
    // No look at all: the neutral square — no colour set, so the sheet's `--fg-3`.
    const neutral = orphan.querySelector(".type-chip") as HTMLElement;
    expect(neutral).toHaveClass("is-square");
    expect(neutral.style.getPropertyValue("--type-fill")).toBe("");
    expect(neutral.querySelector("svg")).toBeNull();
    expect(contextReads()).toBe(0);
  });

  it("stands in for a row it cannot draw, and still opens it", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    seedHits([
      { ...hit("TAS-101", "Fine"), projectId: "project-tas" },
      { ...hit("TAS-102", { text: "not a string" } as unknown as string), projectId: "project-tas" },
    ]);
    const box = renderSearch();

    fireEvent.change(box, { target: { value: "board" } });

    const list = await screen.findByRole("listbox", { name: "Issue search results" });
    const options = within(list).getAllByRole("option");
    expect(options[0]).toHaveTextContent("Fine");
    expect(options[1]).toHaveTextContent("TAS-102This result could not be shown.");
    // An empty, hidden chip slot keeps the key in its column; no type is claimed.
    expect(options[1].querySelector(".type-chip")).toHaveClass("is-placeholder");
    expect(options[1].querySelector(".type-chip")).toHaveAttribute("aria-hidden", "true");
    fireEvent.click(options[1]);
    expect(screen.getByTestId("address")).toHaveTextContent("/projects/project-tas/issues/tas-102");
    consoleError.mockRestore();
  });
});
