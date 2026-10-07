import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskaApi } from "../api/TaskaApi";
import { IssueKeyScreen } from "./IssueKeyScreen";

/**
 * The short address of an issue (TAS-246): `/browse/{issueKey}` asks the server
 * which issue a key names and goes on to that issue's own address. Pinned here:
 * the key is resolved by the server and never by the client, the redirect
 * replaces the short address in the history, and the three outcomes that are
 * not "found" are told apart — 404 and 403 in code but not on screen (§4.18),
 * anything else as a failure with a way to ask again.
 */
const { fakeApi, answerWith, failWith, lookups, reset } = vi.hoisted(() => {
  const state: { issue: { id: string; projectId: string } | null; failure: Error | null; lookups: string[] } = {
    issue: null,
    failure: null,
    lookups: [],
  };
  const api = {
    hasSession: () => true,
    onSessionExpired: () => () => {},
    getIssueByKey: async (issueKey: string) => {
      state.lookups.push(issueKey);
      if (state.failure) throw state.failure;
      return { ...state.issue, issueKey };
    },
  };
  return {
    fakeApi: api as unknown as TaskaApi,
    answerWith: (issue: { id: string; projectId: string }) => {
      state.issue = issue;
      state.failure = null;
    },
    failWith: (error: Error) => {
      state.failure = error;
    },
    lookups: () => [...state.lookups],
    reset: () => {
      state.issue = null;
      state.failure = null;
      state.lookups = [];
    },
  };
});

vi.mock("../api/client", () => ({ taskaApi: fakeApi }));

function Landed() {
  const location = useLocation();
  return (
    <p data-testid="landed">
      {location.pathname} {useNavigationType()}
    </p>
  );
}

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/browse/:issueKey" element={<IssueKeyScreen />} />
          <Route path="/projects/:projectId/issues/:issueId" element={<Landed />} />
          <Route path="/projects" element={<p>Projects</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const refusal = (status: number, code: string, message: string) => Object.assign(new Error(message), { status, code });

describe("the short address of an issue", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    reset();
  });

  it("resolves the key through the server and opens the issue in its own project, replacing the short address", async () => {
    answerWith({ id: "issue-5", projectId: "project-api" });
    renderAt("/browse/API-5");

    expect(await screen.findByTestId("landed")).toHaveTextContent("/projects/project-api/issues/issue-5 REPLACE");
    expect(lookups()).toEqual(["API-5"]);
  });

  it("says nothing on screen but the plane while the key is being looked up, and says it in words", async () => {
    failWith(refusal(500, "INTERNAL", "never shown"));
    const pending = new Promise(() => {});
    vi.spyOn(fakeApi, "getIssueByKey").mockReturnValueOnce(pending as never);
    renderAt("/browse/API-5");

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Opening API-5");
    expect(status).toHaveClass("visually-hidden");
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it.each([
    [404, "NOT_FOUND", "Issue not found: API-404", "missing"],
    [403, "PERMISSION_DENIED", "Access denied", "forbidden"],
  ])("answers a %s with the not-found screen, telling the two apart only in code", async (status, code, message, reason) => {
    failWith(refusal(status, code, message));
    renderAt("/browse/API-404");

    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeVisible();
    expect(screen.getByRole("main")).toHaveAttribute("data-reason", reason);
    // One sentence for both (§4.18): a "no access" here would confirm the key
    // names an issue in somebody else's project.
    expect(screen.getByText(/doesn.t exist, or you don.t have access to it/)).toBeVisible();
    expect(screen.queryByText(message)).toBeNull();
    // An answer, not a transient failure: asked once.
    expect(lookups()).toHaveLength(1);
  });

  it("reads the mock's code without a status as the same answer", async () => {
    failWith(Object.assign(new Error("Access denied"), { code: "PERMISSION_DENIED" }));
    renderAt("/browse/MOB-5");

    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeVisible();
    expect(screen.getByRole("main")).toHaveAttribute("data-reason", "forbidden");
  });

  it("states any other failure as a failure, with the server's words, and asks again on request", async () => {
    failWith(Object.assign(refusal(503, "UNAVAILABLE", "issue-service is unavailable"), { requestId: "req-246" }));
    renderAt("/browse/API-5");

    // After the one retry a genuine failure gets — a 503 is not an answer.
    expect(await screen.findByRole("heading", { name: "API-5 could not be opened" }, { timeout: 3000 })).toBeVisible();
    expect(lookups()).toHaveLength(2);
    expect(screen.getByText("issue-service is unavailable")).toBeVisible();
    expect(screen.getByRole("button", { name: /Copy request id req-246/ })).toBeVisible();
    expect(screen.getByRole("link", { name: "Go to projects" })).toHaveAttribute("href", "/projects");
    expect(screen.queryByRole("heading", { name: "Page not found" })).toBeNull();

    answerWith({ id: "issue-5", projectId: "project-api" });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(screen.getByTestId("landed")).toHaveTextContent("/projects/project-api/issues/issue-5"));
    expect(lookups()).toHaveLength(3);
  });

  /**
   * art-director, TAS-246: "Try again" used to put the screen back to the
   * plane — react-query resets a no-data query to `pending` on a refetch — so
   * the button unmounted under the reader's focus and a second failure came
   * back unfocused and unannounced. Pinned: the screen stays mounted, focus
   * stays on the button, the button is `aria-disabled` and inert while its
   * request is out, a repeat is said once in the persistent status region, the
   * request id moves in place, and a press does not also wait for the hidden
   * retry the first lookup got.
   */
  it("keeps the failure screen and the reader's focus through a retry that fails again, and says so", async () => {
    failWith(Object.assign(refusal(503, "UNAVAILABLE", "issue-service is unavailable"), { requestId: "req-1" }));
    renderAt("/browse/API-5");

    const heading = await screen.findByRole("heading", { name: "API-5 could not be opened" }, { timeout: 3000 });
    const main = screen.getByRole("main");
    const status = document.querySelector(".issue-key-status");
    expect(status).toHaveAttribute("role", "status");
    expect(status).toHaveTextContent("");
    expect(lookups()).toHaveLength(2);

    let failAgain: () => void = () => {};
    const lookup = vi.spyOn(fakeApi, "getIssueByKey").mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          failAgain = () => reject(Object.assign(refusal(503, "UNAVAILABLE", "still unavailable"), { requestId: "req-2" }));
        }),
    );
    const button = screen.getByRole("button", { name: "Try again" });
    button.focus();
    fireEvent.click(button);

    await waitFor(() => expect(button).toHaveAttribute("aria-disabled", "true"));
    expect(button).not.toBeDisabled();
    expect(button).toHaveFocus();
    expect(button).toHaveTextContent("Try again");
    expect(screen.getByRole("main")).toBe(main);
    expect(screen.getByRole("heading", { name: "API-5 could not be opened" })).toBe(heading);
    // Inert while out: a second press sends nothing.
    fireEvent.click(button);
    expect(lookup).toHaveBeenCalledTimes(1);

    await act(async () => failAgain());

    await waitFor(() => expect(status).toHaveTextContent("API-5 still could not be opened."));
    expect(button).not.toHaveAttribute("aria-disabled");
    expect(button).toHaveFocus();
    expect(screen.getByRole("main")).toBe(main);
    expect(screen.getByRole("heading", { name: "API-5 could not be opened" })).toBe(heading);
    // The server's words and the request id move in place, outside the region.
    const copy = screen.getByRole("button", { name: /Copy request id req-2/ });
    expect(screen.getByText("still unavailable")).toBeVisible();
    expect(status?.contains(copy)).toBe(false);
    // No hidden retry behind the press: the first lookup's two, and this one.
    expect(lookups()).toHaveLength(2);
    expect(lookup).toHaveBeenCalledTimes(1);

    // The next press empties the region before it is filled again.
    answerWith({ id: "issue-5", projectId: "project-api" });
    fireEvent.click(button);
    expect(status).toHaveTextContent("");
    await waitFor(() => expect(screen.getByTestId("landed")).toHaveTextContent("/projects/project-api/issues/issue-5"));
  });
});
