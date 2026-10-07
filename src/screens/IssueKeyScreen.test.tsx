import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
});
