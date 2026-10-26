import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectContext, ProjectIssueType } from "../domain/types";
import { projectContextKey } from "../lib/projectContext";
import { ProjectIssueTypesModal } from "./ProjectIssueTypesModal";

/**
 * The Issue types dialog's writes (DESIGN.md §4.30, TAS-417) where the
 * end-to-end suite cannot hold a request open or refuse one: the reorder
 * queue — one PUT per press, in press order, optimistic in the same frame —
 * and what a refusal does to it, and the delete refusals by `details.reason`.
 */

const PROJECT = "2e74e49f-0f29-4e03-b4ec-adc4dbf2382e";

const { api } = vi.hoisted(() => ({
  api: {
    getProjectContext: vi.fn(),
    reorderProjectIssueTypes: vi.fn(),
    deleteProjectIssueType: vi.fn(),
    createProjectIssueType: vi.fn(),
    updateProjectIssueType: vi.fn(),
  },
}));
vi.mock("../api/client", () => ({ taskaApi: api }));

const seeded = (): ProjectIssueType[] => [
  { code: "TASK", name: "Task", color: "blue", icon: "check-square", sortOrder: 10 },
  { code: "BUG", name: "Bug", color: "red", icon: "bug", sortOrder: 20 },
  { code: "STORY", name: "Story", color: "green", icon: "book-open", sortOrder: 30 },
];
let saved: ProjectIssueType[];
const contextOf = (issueTypes: ProjectIssueType[]): ProjectContext =>
  ({
    project: { id: PROJECT, projectKey: "TAS", name: "Taska", createdBy: "u", createdAt: "x", updatedAt: "x", archivedAt: null },
    role: "ADMIN",
    members: [],
    labels: [],
    issueTypes,
    workflows: {},
  }) as unknown as ProjectContext;

/** What the board does: reads the context and hands the dialog its registry. */
function Board() {
  const { data } = useQuery({
    queryKey: projectContextKey(PROJECT),
    queryFn: () => api.getProjectContext(PROJECT),
    staleTime: Infinity,
  });
  return (
    <ProjectIssueTypesModal
      archived={false}
      contextError={null}
      issueTypes={data?.issueTypes}
      onClose={() => {}}
      projectId={PROJECT}
      projectKey="TAS"
      readerRole="ADMIN"
    />
  );
}

const renderDialog = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  queryClient.setQueryData(projectContextKey(PROJECT), contextOf(saved));
  render(
    <QueryClientProvider client={queryClient}>
      <Board />
    </QueryClientProvider>,
  );
  return screen.getByRole("dialog", { name: "Issue types" });
};
const names = (dialog: HTMLElement) =>
  [...within(dialog).getByRole("list", { name: "Issue types" }).querySelectorAll(".issue-type-name")].map(
    (node) => node.textContent,
  );
const refusal = (code: string, message: string, details: Record<string, string> | null = null) =>
  Object.assign(new Error(message), { code, status: 400, details, requestId: "rid-1" });

/** A request held open until the test settles it. */
function held<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.resetAllMocks();
  saved = seeded();
  api.getProjectContext.mockImplementation(async () => contextOf(saved));
});

describe("moving a type", () => {
  it("sends one PUT per press with the whole order, one at a time in press order, drawn in the same frame", async () => {
    const first = held<ProjectIssueType[]>();
    const second = held<ProjectIssueType[]>();
    api.reorderProjectIssueTypes.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const dialog = renderDialog();

    fireEvent.click(within(dialog).getByRole("button", { name: "Move Story up" }));
    await waitFor(() => expect(names(dialog)).toEqual(["Task", "Story", "Bug"]));
    expect(api.reorderProjectIssueTypes).toHaveBeenCalledTimes(1);
    expect(api.reorderProjectIssueTypes).toHaveBeenLastCalledWith(PROJECT, ["TASK", "STORY", "BUG"]);

    // A second press while the first is out: drawn at once, sent after it.
    fireEvent.click(within(dialog).getByRole("button", { name: "Move Story up" }));
    await waitFor(() => expect(names(dialog)).toEqual(["Story", "Task", "Bug"]));
    expect(api.reorderProjectIssueTypes).toHaveBeenCalledTimes(1);

    await act(async () => first.resolve(seeded()));
    await waitFor(() => expect(api.reorderProjectIssueTypes).toHaveBeenCalledTimes(2));
    expect(api.reorderProjectIssueTypes).toHaveBeenLastCalledWith(PROJECT, ["STORY", "TASK", "BUG"]);
    // The first answer is not drawn over the second press.
    expect(names(dialog)).toEqual(["Story", "Task", "Bug"]);

    await act(async () =>
      second.resolve([
        { ...seeded()[2], sortOrder: 10 },
        { ...seeded()[0], sortOrder: 20 },
        { ...seeded()[1], sortOrder: 30 },
      ]),
    );
    expect(names(dialog)).toEqual(["Story", "Task", "Bug"]);
    expect(within(dialog).getByText("Story moved to position 1 of 3.")).toBeInTheDocument();
  });

  it("stops the queue on a refusal, reads the context again and says the saved order is back", async () => {
    const first = held<ProjectIssueType[]>();
    api.reorderProjectIssueTypes.mockReturnValueOnce(first.promise);
    const dialog = renderDialog();

    fireEvent.click(within(dialog).getByRole("button", { name: "Move Bug down" }));
    await waitFor(() => expect(names(dialog)).toEqual(["Task", "Story", "Bug"]));
    fireEvent.click(within(dialog).getByRole("button", { name: "Move Bug up" }));
    await waitFor(() => expect(names(dialog)).toEqual(["Task", "Bug", "Story"]));

    // The registry changed elsewhere: the stale set's refusal, no reason.
    const reads = api.getProjectContext.mock.calls.length;
    await act(async () =>
      first.reject(refusal("INVALID_ARGUMENT", "codes must contain every current issue type exactly once")),
    );

    expect(
      await within(dialog).findByText("The new order was not saved. The list now shows the saved order."),
    ).toBeVisible();
    expect(within(dialog).getByText("codes must contain every current issue type exactly once")).toBeVisible();
    expect(api.getProjectContext.mock.calls.length).toBe(reads + 1);
    // The queued press was never sent, and the list is the server's again.
    expect(api.reorderProjectIssueTypes).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(names(dialog)).toEqual(["Task", "Bug", "Story"]));
  });
});

describe("a refused delete", () => {
  it("names how many issues have the type, in the slot, with the server's words, and focus back on Delete", async () => {
    api.deleteProjectIssueType.mockRejectedValueOnce(
      refusal("FAILED_PRECONDITION", "Issue type BUG has 3 issues", { reason: "ISSUE_TYPE_IN_USE", issueCount: "3" }),
    );
    const dialog = renderDialog();

    const remove = within(dialog).getByRole("button", { name: "Delete Bug" });
    fireEvent.click(remove);
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete type" }));

    expect(
      await within(dialog).findByText("Bug was not deleted: 3 issues have this type. Change their type first."),
    ).toBeVisible();
    expect(within(dialog).getByText("Issue type BUG has 3 issues")).toBeVisible();
    expect(within(dialog).getByText("rid-1")).toBeInTheDocument();
    await waitFor(() => expect(remove).toHaveFocus());
    expect(names(dialog)).toEqual(["Task", "Bug", "Story"]);
  });

  it("reads the context again on LAST_ISSUE_TYPE: Delete was offered from a registry that was stale", async () => {
    api.deleteProjectIssueType.mockRejectedValueOnce(
      refusal("FAILED_PRECONDITION", "Cannot delete the last issue type", { reason: "LAST_ISSUE_TYPE" }),
    );
    const dialog = renderDialog();
    const reads = api.getProjectContext.mock.calls.length;

    fireEvent.click(within(dialog).getByRole("button", { name: "Delete Bug" }));
    saved = [seeded()[1]];
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete type" }));

    expect(await within(dialog).findByText("Bug was not deleted: a project needs at least one issue type.")).toBeVisible();
    await waitFor(() => expect(api.getProjectContext.mock.calls.length).toBe(reads + 1));
    // The lone type now offers no Delete, and says why.
    await waitFor(() => expect(names(dialog)).toEqual(["Bug"]));
    expect(within(dialog).queryByRole("button", { name: "Delete Bug" })).not.toBeInTheDocument();
    expect(within(dialog).getByText("A project needs at least one issue type, so this one cannot be deleted.")).toBeVisible();
  });
});
