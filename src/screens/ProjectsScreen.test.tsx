import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskaApi } from "../api/TaskaApi";
import { ProjectsScreen } from "./ProjectsScreen";

/**
 * Every card on this screen states two numbers it did not fetch itself, and
 * the failure mode that shipped (TAS-163) was that both numbers lied: one
 * project the gateway would not answer for rejected the batch that fetched all
 * of them, and each card then printed "0 issues" — a claim about the project,
 * not an admission about the request. So these tests are entirely about which
 * project's failure reaches which card, and about zero never standing in for
 * unknown.
 */
const { fakeApi, failIssuesFor, failMembersFor, reset } = vi.hoisted(() => {
  const state = { issueFailures: new Set<string>(), memberFailures: new Set<string>() };
  const now = "2026-08-01T09:00:00Z";

  const project = (id: string, projectKey: string, name: string) => ({
    id,
    projectKey,
    name,
    createdBy: "user-anna",
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  });

  const issueCounts: Record<string, number> = { "project-a": 9, "project-b": 4, "project-c": 0 };

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
    listProjects: async () => [
      project("project-a", "AAA", "Alpha"),
      project("project-b", "BBB", "Beta"),
      project("project-c", "CCC", "Gamma"),
    ],
    listIssues: async (projectId: string) => {
      if (state.issueFailures.has(projectId)) throw new Error(`Internal error for ${projectId}`);
      return { items: [], page: 0, pageSize: 100, totalCount: issueCounts[projectId] ?? 0 };
    },
    listMembers: async (projectId: string) => {
      if (state.memberFailures.has(projectId)) throw new Error(`Internal error for ${projectId}`);
      return [
        {
          userId: "user-anna",
          role: "ADMIN" as const,
          addedAt: now,
          addedBy: "user-anna",
          user: { displayName: "Anna Ivanova", email: "anna@example.com" },
        },
      ];
    },
  };

  return {
    fakeApi: api as unknown as TaskaApi,
    failIssuesFor: (projectId: string) => state.issueFailures.add(projectId),
    failMembersFor: (projectId: string) => state.memberFailures.add(projectId),
    reset: () => {
      state.issueFailures.clear();
      state.memberFailures.clear();
    },
  };
});

vi.mock("../api/client", () => ({ taskaApi: fakeApi }));

function renderProjects() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/projects"]}>
        <ProjectsScreen theme="light" toggleTheme={() => {}} onLogout={() => {}} logoutPending={false} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The card is a button; its name starts with the project key badge. */
const card = (name: string) => screen.getByRole("button", { name: new RegExp(name) });

describe("project cards state what they know", () => {
  beforeEach(() => {
    reset();
    window.localStorage.clear();
  });

  it("keeps one project's failure out of every other project's card", async () => {
    failIssuesFor("project-b");
    renderProjects();

    // The project that answered still shows its own count.
    expect(await within(await screen.findByRole("button", { name: /Alpha/ })).findByText("9")).toBeVisible();
    expect(within(card("Gamma")).getByText("0")).toBeVisible();

    // And the one that did not is the only card missing a number.
    const beta = card("Beta");
    expect(within(beta).getByText("—")).toBeVisible();
    expect(within(beta).queryByText("0")).not.toBeInTheDocument();
  });

  it("says unknown rather than zero, in words a screen reader can hear", async () => {
    failIssuesFor("project-a");
    failMembersFor("project-a");
    renderProjects();

    const alpha = await screen.findByRole("button", { name: /Alpha/ });
    // Not "0 issues" and not "0 members": the accessible name carries the word.
    expect(alpha).toHaveAccessibleName(/unknown issues/);
    expect(alpha).toHaveAccessibleName(/unknown members/);
    expect(alpha).not.toHaveAccessibleName(/0 issues/);
    expect(alpha).not.toHaveAccessibleName(/0 members/);
  });

  it("still counts the issues when only the member list failed", async () => {
    // The live shape of TAS-162: `listMembers` goes through GET /projects/{id}
    // and 500s, while the issue list answers fine. Joining the two used to
    // throw the good answer away with the bad one.
    failMembersFor("project-a");
    renderProjects();

    const alpha = await screen.findByRole("button", { name: /Alpha/ });
    expect(within(alpha).getByText("9")).toBeVisible();
    expect(alpha).toHaveAccessibleName(/unknown members/);
  });

  it("prints a real zero for a project that genuinely has no issues", async () => {
    renderProjects();

    const gamma = await screen.findByRole("button", { name: /Gamma/ });
    expect(gamma).toHaveAccessibleName(/0 issues/);
    expect(within(gamma).queryByText("—")).not.toBeInTheDocument();
  });
});
