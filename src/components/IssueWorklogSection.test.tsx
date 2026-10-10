import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskaApi } from "../api/TaskaApi";
import type { IssueWorklog } from "../domain/types";
import { IssueWorklogSection } from "./IssueWorklogSection";

/**
 * What the section does with answers the mock never gives: a write the server
 * refuses (the optimistic row has to go back), and the gateway's
 * static-resource 404 while backend PR #178 is undeployed.
 */
const PROJECT = "p-1";
const ISSUE = "i-1";
const ANNA = "u-anna";

const { fakeApi, state } = vi.hoisted(() => {
  const state = {
    worklogs: [] as IssueWorklog[],
    listFailure: null as Error | null,
    writeFailure: null as Error | null,
    updates: [] as unknown[],
  };
  const api = {
    listIssueWorklogs: async () => {
      if (state.listFailure) throw state.listFailure;
      return state.worklogs;
    },
    addIssueWorklog: async () => {
      if (state.writeFailure) throw state.writeFailure;
      throw new Error("not used");
    },
    updateIssueWorklog: async (_p: string, _i: string, _w: string, input: unknown) => {
      state.updates.push(input);
      if (state.writeFailure) throw state.writeFailure;
      throw new Error("not used");
    },
    deleteIssueWorklog: async () => {
      if (state.writeFailure) throw state.writeFailure;
    },
  };
  return { fakeApi: api as unknown as TaskaApi, state };
});

vi.mock("../api/client", () => ({ taskaApi: fakeApi }));

const entry: IssueWorklog = {
  id: "w-1",
  issueId: ISSUE,
  projectId: PROJECT,
  authorUserId: ANNA,
  spentMinutes: 45,
  workDate: "2026-06-13",
  comment: "Pairing",
  createdAt: "2026-06-13T09:00:00Z",
  updatedAt: "2026-06-13T09:00:00Z",
};

const refusal = (message: string, status: number, code: string) =>
  Object.assign(new Error(message), { status, code, requestId: "req-251" });

function renderSection(props: Partial<{ canLog: boolean; isProjectAdmin: boolean }> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <IssueWorklogSection
        canLog={props.canLog ?? true}
        currentUserId={ANNA}
        isProjectAdmin={props.isProjectAdmin ?? true}
        issueId={ISSUE}
        prefetched={false}
        projectId={PROJECT}
        userById={new Map([[ANNA, { id: ANNA, displayName: "Anna Ivanova" }]])}
        writeScope={`issue-write:${ISSUE}`}
      />
    </QueryClientProvider>,
  );
}

describe("the work log section", () => {
  beforeEach(() => {
    state.worklogs = [entry];
    state.listFailure = null;
    state.writeFailure = null;
    state.updates = [];
  });

  it("says the gateway does not serve work logs yet, and offers no form, on the static-resource 404", async () => {
    state.listFailure = refusal("No static resource api/v1/projects/p-1/issues/i-1/worklogs.", 404, "NOT_FOUND");
    renderSection();

    expect(await screen.findByText("This gateway does not serve work logs yet.")).toBeVisible();
    expect(screen.queryByText("No work logged yet")).toBeNull();
    expect(screen.queryByText("The work log could not be loaded.")).toBeNull();
    expect(screen.queryByRole("form", { name: "Log work" })).toBeNull();
  });

  it("takes a refused add back off the list and puts the entry back in the boxes", async () => {
    state.writeFailure = refusal("Not allowed role", 403, "PERMISSION_DENIED");
    renderSection();
    await screen.findByText("Pairing");

    const form = screen.getByRole("form", { name: "Log work" });
    fireEvent.change(within(form).getByLabelText("Time spent"), { target: { value: "2h" } });
    fireEvent.click(within(form).getByRole("button", { name: "Log work" }));

    expect(await screen.findByText("Your work log entry was not saved. Not allowed role")).toBeVisible();
    await waitFor(() => expect(document.querySelectorAll(".worklog-row")).toHaveLength(1));
    expect(within(form).getByLabelText("Time spent")).toHaveValue("2h");
    expect(screen.getByText("req-251")).toBeVisible();
  });

  it("marks Log work aria-disabled while the duration is empty", async () => {
    renderSection();
    await screen.findByText("Pairing");
    const form = screen.getByRole("form", { name: "Log work" });
    const button = within(form).getByRole("button", { name: "Log work" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    fireEvent.change(within(form).getByLabelText("Time spent"), { target: { value: "2h" } });
    expect(button).not.toHaveAttribute("aria-disabled");
  });

  it("puts a refused delete back", async () => {
    state.writeFailure = refusal("Not allowed role", 403, "PERMISSION_DENIED");
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: /^Delete 45m logged/ }));
    fireEvent.click(screen.getByRole("button", { name: "Delete entry" }));

    expect(await screen.findByText("The work log entry was not deleted. Not allowed role")).toBeVisible();
    expect(screen.getByText("Pairing")).toBeVisible();
  });

  it("sends nothing for an edit that changed nothing", async () => {
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: /^Edit 45m logged/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByRole("button", { name: "Save" })).toBeNull());
    expect(state.updates).toEqual([]);
  });

  it("puts a refused edit back and reopens the editor with what was typed", async () => {
    state.writeFailure = refusal("Worklog with id: w-1 not found", 404, "NOT_FOUND");
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: /^Edit 45m logged/ }));
    const editor = screen.getByRole("form", { name: /^Edit 45m logged/ });
    fireEvent.change(within(editor).getByLabelText("Time spent"), { target: { value: "1h" } });
    fireEvent.click(within(editor).getByRole("button", { name: "Save" }));

    expect(await screen.findByText(/Your change to the work log entry was not saved/)).toBeVisible();
    expect(state.updates).toEqual([{ spentMinutes: 60 }]);
    expect(screen.getByText("45m logged")).toBeVisible();
    expect(within(screen.getByRole("form", { name: /^Edit 45m logged/ })).getByLabelText("Time spent")).toHaveValue("1h");
  });

  it("offers a VIEWER no form and no row actions", async () => {
    renderSection({ canLog: false, isProjectAdmin: false });
    await screen.findByText("Pairing");
    expect(screen.queryByRole("form")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
