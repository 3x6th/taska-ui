import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskaApi } from "../api/TaskaApi";
import type { Project, ProjectContext } from "../domain/types";
import { projectContextKey } from "../lib/projectContext";
import { EditProjectModal } from "./EditProjectModal";

/**
 * The dialog's two writes, read off the calls it makes rather than off a
 * store: `PATCH` (backend PR #155 at `28f5fe1`, where an explicit `null`
 * clears) and `DELETE` (backend PR #159 at `97464fe`, the archive). Both are
 * undeployed on 2026-10-20, so these pin what the UI sends and does with the
 * answer, not what any gateway has said.
 */
const { fakeApi, calls, reset, refuseArchive } = vi.hoisted(() => {
  const state: {
    updates: { projectId: string; input: Record<string, unknown> }[];
    archives: string[];
    contextReads: string[];
    archiveFailure: Error | null;
  } = { updates: [], archives: [], contextReads: [], archiveFailure: null };

  const api = {
    updateProject: async (projectId: string, input: Record<string, unknown>) => {
      state.updates.push({ projectId, input });
      return {
        id: projectId,
        projectKey: "TAS",
        name: "Taska Platform",
        createdBy: "user-anna",
        createdAt: "2026-08-01T09:00:00Z",
        updatedAt: "2026-10-20T09:00:00Z",
        archivedAt: null,
        description: null,
        color: null,
        ...input,
        currentUserRole: null,
      };
    },
    archiveProject: async (projectId: string) => {
      state.archives.push(projectId);
      if (state.archiveFailure) throw state.archiveFailure;
      return {
        id: projectId,
        projectKey: "TAS",
        name: "Taska Platform",
        createdBy: "user-anna",
        createdAt: "2026-08-01T09:00:00Z",
        updatedAt: "2026-08-01T09:00:00Z",
        archivedAt: "2026-10-20T10:00:00Z",
        description: "Gateway and services",
        color: "#0052cc",
        // The entity mapper sets no role on this answer.
        currentUserRole: null,
      };
    },
    getProjectContext: async (projectId: string) => {
      state.contextReads.push(projectId);
      throw Object.assign(new Error("Project archived"), { status: 400, code: "FAILED_PRECONDITION" });
    },
  };

  return {
    fakeApi: api as unknown as TaskaApi,
    calls: state,
    reset: () => {
      state.updates = [];
      state.archives = [];
      state.contextReads = [];
      state.archiveFailure = null;
    },
    refuseArchive: (error: Error) => {
      state.archiveFailure = error;
    },
  };
});

vi.mock("../api/client", () => ({ taskaApi: fakeApi }));

const baseProject = (extra: Partial<Project> = {}): Project => ({
  id: "project-1",
  projectKey: "TAS",
  name: "Taska Platform",
  createdBy: "user-anna",
  createdAt: "2026-08-01T09:00:00Z",
  updatedAt: "2026-08-01T09:00:00Z",
  archivedAt: null,
  description: "Gateway and services",
  color: "#0052cc",
  currentUserRole: "ADMIN",
  ...extra,
});

function renderDialog(project: Project, onArchived?: () => void) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData<Project[]>(["projects"], [project]);
  queryClient.setQueryData(projectContextKey(project.id), { project } as unknown as ProjectContext);
  queryClient.setQueryData(["issues", project.id, "ALL"], { items: [], page: 0, pageSize: 100, totalCount: 0 });
  queryClient.setQueryData(["project-summaries", project.id], { count: 3, members: [], failure: null });
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <EditProjectModal onArchived={onArchived} onClose={onClose} project={project} />
    </QueryClientProvider>,
  );
  return { queryClient, onClose, dialog: screen.getByRole("dialog", { name: "Edit project" }) };
}

describe("editing a project's colour and description", () => {
  beforeEach(() => reset());

  it("offers Automatic on a coloured project and sends color: null for it", async () => {
    const { dialog } = renderDialog(baseProject());
    const automatic = within(dialog).getByRole("button", { name: /Automatic colour/ });

    // Never disabled any more: an explicit null clears a stored colour.
    expect(automatic).toBeEnabled();
    expect(within(dialog).queryByText(/cannot be set back to automatic/)).not.toBeInTheDocument();

    fireEvent.click(automatic);
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(calls.updates).toHaveLength(1));
    expect(calls.updates[0].input).toEqual({ color: null });
  });

  it("sends nothing for a colour left alone", () => {
    const { dialog } = renderDialog(baseProject());

    expect(within(dialog).getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  it("clears a description with null when the box that held one is emptied", async () => {
    const { dialog } = renderDialog(baseProject());
    fireEvent.change(within(dialog).getByLabelText("Description"), { target: { value: "   " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(calls.updates).toHaveLength(1));
    expect(calls.updates[0].input).toEqual({ description: null });
  });

  it("does not rewrite a legacy blank description to null behind the reader's back", () => {
    const { dialog } = renderDialog(baseProject({ description: "" }));

    expect(within(dialog).getByLabelText("Description")).toHaveValue("");
    expect(within(dialog).getByRole("button", { name: "Save changes" })).toBeDisabled();
  });
});

describe("archiving a project from the dialog", () => {
  beforeEach(() => reset());

  const askAndAnswer = (dialog: HTMLElement) => {
    const trigger = within(dialog).getByRole("button", { name: "Archive project" });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    // Cancel takes focus first (§4.22), and the sentence says the consequence.
    expect(within(dialog).getAllByRole("button", { name: "Cancel" }).at(-1)).toHaveFocus();
    expect(within(dialog).getByText("TAS will be archived for everyone. Taska cannot restore it.")).toBeVisible();
    fireEvent.click(within(dialog).getByRole("button", { name: "Archive TAS" }));
  };

  it("asks first, sends one DELETE, keeps the reader's role and drops the board's queries without a refetch", async () => {
    const onArchived = vi.fn();
    const { dialog, queryClient, onClose } = renderDialog(baseProject(), onArchived);

    askAndAnswer(dialog);

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(calls.archives).toEqual(["project-1"]);
    expect(onArchived).toHaveBeenCalledTimes(1);

    const row = queryClient.getQueryData<Project[]>(["projects"])?.[0];
    expect(row?.archivedAt).toBe("2026-10-20T10:00:00Z");
    // The answer carries `currentUserRole: null`; the card keeps its pencil.
    expect(row?.currentUserRole).toBe("ADMIN");

    // Removed rather than invalidated: nothing here asks the context again,
    // which the server would refuse.
    expect(queryClient.getQueryCache().find({ queryKey: projectContextKey("project-1") })).toBeUndefined();
    expect(queryClient.getQueryCache().find({ queryKey: ["issues", "project-1", "ALL"] })).toBeUndefined();
    expect(calls.contextReads).toEqual([]);
    // The card's own counts stay, true as of a moment ago.
    expect(queryClient.getQueryData(["project-summaries", "project-1"])).toBeDefined();
  });

  it("wears the strip's danger edge on the trigger while its question is open", () => {
    const { dialog } = renderDialog(baseProject());
    const trigger = within(dialog).getByRole("button", { name: "Archive project" });

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    // `aria-expanded="true"` is what `.project-archive-trigger[aria-expanded="true"]` paints.
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("names the year of an archive from another year", () => {
    const { dialog } = renderDialog(baseProject({ archivedAt: "2024-03-05T12:00:00Z" }));

    expect(within(dialog).getByText(/^Archived on Mar 5, 2024\./)).toBeVisible();
  });

  it("closes the question on Cancel without sending anything", () => {
    const { dialog } = renderDialog(baseProject());
    const trigger = within(dialog).getByRole("button", { name: "Archive project" });
    fireEvent.click(trigger);
    fireEvent.click(within(dialog).getAllByRole("button", { name: "Cancel" }).at(-1)!);

    expect(within(dialog).queryByRole("button", { name: "Archive TAS" })).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
    expect(calls.archives).toEqual([]);
  });

  it("reads a 405 as this gateway not shipping the archive yet, and changes nothing", async () => {
    refuseArchive(
      Object.assign(new Error("Request method 'DELETE' is not supported."), { status: 405, code: "METHOD_NOT_ALLOWED" }),
    );
    const onArchived = vi.fn();
    const { dialog, queryClient, onClose } = renderDialog(baseProject(), onArchived);

    askAndAnswer(dialog);

    expect(await within(dialog).findByText(/Archiving is not on this gateway yet/)).toBeVisible();
    expect(within(dialog).queryByText(/not supported/)).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(onArchived).not.toHaveBeenCalled();
    expect(queryClient.getQueryData<Project[]>(["projects"])?.[0].archivedAt).toBeNull();
    expect(queryClient.getQueryCache().find({ queryKey: projectContextKey("project-1") })).toBeDefined();
  });

  it("shows any other refusal with the server's words and the request id", async () => {
    refuseArchive(
      Object.assign(new Error("User must have the role ADMIN"), {
        status: 403,
        code: "PERMISSION_DENIED",
        requestId: "8a1d3f20-archive",
      }),
    );
    const { dialog } = renderDialog(baseProject());

    askAndAnswer(dialog);

    expect(await within(dialog).findByText("This project was not archived.")).toBeVisible();
    expect(within(dialog).getByText("User must have the role ADMIN")).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Copy request id 8a1d3f20-archive" })).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Archive project" })).toHaveFocus();
  });

  it.each([["MEMBER" as const], ["VIEWER" as const], [null], [undefined]])(
    "offers no archive to a reader whose role is %s",
    (role) => {
      const { dialog } = renderDialog(baseProject({ currentUserRole: role }));

      expect(within(dialog).queryByRole("button", { name: /Archive/ })).not.toBeInTheDocument();
    },
  );

  it("states an archived project as archived and does not offer it again", () => {
    const { dialog } = renderDialog(baseProject({ archivedAt: new Date().toISOString() }));

    // No year for this year's date (`formatDayWithYearIfOther`).
    expect(
      within(dialog).getByText(/^Archived on [A-Z][a-z]{2} \d{1,2}\. Its board and issues no longer open, and Taska cannot restore it\.$/),
    ).toBeVisible();
    expect(within(dialog).queryByRole("button", { name: /Archive/ })).not.toBeInTheDocument();
  });
});
