import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskaApi } from "../api/TaskaApi";
import type { Project, ProjectContext } from "../domain/types";
import { projectContextKey } from "../lib/projectContext";
import { EditProjectModal } from "./EditProjectModal";

/**
 * The dialog's two writes, read off the calls it makes rather than off a
 * store: `PATCH` (backend PR #155, where an explicit `null` clears) and
 * `DELETE` (backend PR #159, the archive), both merged and deployed.
 */
const { fakeApi, calls, reset, refuseArchive, refuseUpdate } = vi.hoisted(() => {
  const state: {
    updates: { projectId: string; input: Record<string, unknown> }[];
    archives: string[];
    contextReads: string[];
    archiveFailure: Error | null;
    updateFailure: Error | null;
  } = { updates: [], archives: [], contextReads: [], archiveFailure: null, updateFailure: null };

  const api = {
    updateProject: async (projectId: string, input: Record<string, unknown>) => {
      state.updates.push({ projectId, input });
      if (state.updateFailure) throw state.updateFailure;
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
        currentUserRole: "ADMIN",
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
        // A role a caller must not take from a write answer: the reads state
        // the reader's role, and this is not the one the cache holds.
        currentUserRole: "VIEWER",
      };
    },
    getProjectContext: async (projectId: string) => {
      state.contextReads.push(projectId);
      // An archived project's reads stay open (backend PR #159).
      return {
        project: {
          id: projectId,
          projectKey: "TAS",
          name: "Taska Platform",
          createdBy: "user-anna",
          createdAt: "2026-08-01T09:00:00Z",
          updatedAt: "2026-08-01T09:00:00Z",
          archivedAt: "2026-10-20T10:00:00Z",
          currentUserRole: "ADMIN",
        },
        role: "ADMIN",
        members: [],
        labels: [],
        workflows: {},
      };
    },
    listProjects: async () => [],
  };

  return {
    fakeApi: api as unknown as TaskaApi,
    calls: state,
    reset: () => {
      state.updates = [];
      state.archives = [];
      state.contextReads = [];
      state.archiveFailure = null;
      state.updateFailure = null;
    },
    refuseArchive: (error: Error) => {
      state.archiveFailure = error;
    },
    refuseUpdate: (error: Error) => {
      state.updateFailure = error;
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

function renderDialog(project: Project, onArchived?: (archivedAt: string) => void) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const other: Project = { ...project, id: "project-2", projectKey: "WEB", name: "Web App" };
  queryClient.setQueryData<Project[]>(["projects"], [project, other]);
  queryClient.setQueryData(projectContextKey(project.id), { project, role: "ADMIN" } as unknown as ProjectContext);
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

  it("sends nothing for an empty box on a project that has no description", () => {
    const { dialog } = renderDialog(baseProject({ description: null }));

    expect(within(dialog).getByLabelText("Description")).toHaveValue("");
    expect(within(dialog).getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  // Backend PR #155 deployed (401 without a token on 2026-10-23), so a 405 has
  // no line of its own any more: it is a refusal like any other.
  it("shows a 405 as the ordinary refusal, with the server's words", async () => {
    refuseUpdate(
      Object.assign(new Error("Request method 'PATCH' is not supported."), { status: 405, code: "METHOD_NOT_ALLOWED" }),
    );
    const { dialog } = renderDialog(baseProject());
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Renamed" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));

    expect(await within(dialog).findByText("Request method 'PATCH' is not supported.")).toBeVisible();
    expect(within(dialog).queryByText(/not on this gateway yet/)).not.toBeInTheDocument();
  });

  // Archived while the dialog was open (§5.7): our sentence in place of the
  // server's, the request id as usual — and keyed on `details.reason` alone.
  it("says a save was refused because the project was archived, with the request id", async () => {
    refuseUpdate(
      Object.assign(new Error("Project is archived"), {
        status: 400,
        code: "FAILED_PRECONDITION",
        details: { reason: "PROJECT_ARCHIVED" },
        requestId: "4b2e9a10-archived",
      }),
    );
    const { dialog } = renderDialog(baseProject());
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Renamed" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));

    expect(await within(dialog).findByText("This project has been archived, so nothing in it can be changed.")).toBeVisible();
    expect(within(dialog).queryByText("Project is archived")).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Copy request id 4b2e9a10-archived" })).toBeVisible();
  });
});

/**
 * Archived by somebody else while the dialog is open (DESIGN.md §4.11, §5.7,
 * «Архив пришёл отказом записи» and «…отказом Save на `/projects`»): it stays
 * open, read-only, with what was typed — Save and the danger zone go, Cancel
 * and ✕ stay, and one line says why unless the dialog's own refusal does.
 */
describe("a project archived under the open dialog", () => {
  beforeEach(() => reset());

  const archivedRefusal = () =>
    Object.assign(new Error("Project is archived"), {
      status: 400,
      code: "FAILED_PRECONDITION",
      details: { reason: "PROJECT_ARCHIVED" },
      requestId: "4b2e9a10-archived",
    });

  /** The dialog, and a way to hand it the project and the flag its caller would. */
  function renderLive(project: Project) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = (next: Project, unlisted = false) => (
      <QueryClientProvider client={queryClient}>
        <EditProjectModal onClose={vi.fn()} project={next} unlisted={unlisted} />
      </QueryClientProvider>
    );
    const { rerender } = render(view(project));
    return {
      dialog: screen.getByRole("dialog", { name: "Edit project" }),
      update: (next: Project, unlisted = false) => rerender(view(next, unlisted)),
    };
  }

  const expectReadOnly = (dialog: HTMLElement, typed: string) => {
    expect(within(dialog).getByLabelText("Name")).toHaveValue(typed);
    expect(within(dialog).getByLabelText("Name")).toHaveAttribute("readonly");
    expect(within(dialog).getByLabelText("Description")).toHaveAttribute("readonly");
    expect(within(dialog).queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("region", { name: "Archive project" })).not.toBeInTheDocument();
    for (const swatch of within(within(dialog).getByRole("group", { name: "Project colour" })).getAllByRole("button")) {
      expect(swatch).toHaveAttribute("aria-disabled", "true");
    }
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Close" })).toBeVisible();
  };

  it("on the board: keeps what was typed, read-only, and says the project is archived", () => {
    const { dialog, update } = renderLive(baseProject());
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Typed on" } });

    update(baseProject({ archivedAt: "2026-10-20T10:00:00Z" }));

    expectReadOnly(dialog, "Typed on");
    const line = within(dialog).getByText("This project is archived, so it cannot be edited.");
    expect(line).toHaveAttribute("tabindex", "-1");
    // A press of a swatch picks nothing, and Enter in a box sends nothing.
    fireEvent.click(within(dialog).getByRole("button", { name: /Automatic colour/ }));
    expect(within(dialog).getByRole("button", { name: /Automatic colour/ })).toHaveAttribute("aria-pressed", "false");
    fireEvent.submit(within(dialog).getByLabelText("Name").closest("form")!);
    expect(calls.updates).toEqual([]);
  });

  it("on /projects: says the project no longer appears there once its row has left", () => {
    const { dialog, update } = renderLive(baseProject());
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Typed on" } });

    update(baseProject(), true);

    expectReadOnly(dialog, "Typed on");
    expect(
      within(dialog).getByText("This project no longer appears in Projects, so it cannot be edited here."),
    ).toBeVisible();
  });

  it("lets its own refusal say it, with the request id, and draws no line beside it", async () => {
    refuseUpdate(archivedRefusal());
    const { dialog, update } = renderLive(baseProject());
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Renamed" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
    const sentence = await within(dialog).findByText("This project has been archived, so nothing in it can be changed.");

    update(baseProject(), true);

    expectReadOnly(dialog, "Renamed");
    expect(sentence).toBeVisible();
    expect(sentence.closest(".error-note")).toHaveAttribute("tabindex", "-1");
    expect(within(dialog).getByRole("button", { name: "Copy request id 4b2e9a10-archived" })).toBeVisible();
    expect(within(dialog).queryByText(/so it cannot be edited/)).not.toBeInTheDocument();
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

  it("says what archiving does, beside the control that does it", () => {
    const { dialog } = renderDialog(baseProject());

    expect(within(dialog).getByText("Archiving hides TAS from Projects and makes its board read-only.")).toBeVisible();
  });

  it("asks first, sends one DELETE, and takes only archivedAt from the answer", async () => {
    const onArchived = vi.fn();
    const { dialog, queryClient, onClose } = renderDialog(baseProject(), onArchived);

    askAndAnswer(dialog);

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(calls.archives).toEqual(["project-1"]);
    expect(onArchived).toHaveBeenCalledTimes(1);
    expect(onArchived).toHaveBeenCalledWith("2026-10-20T10:00:00Z");
    // Told before the dialog closes, so the caller's next render draws both.
    expect(onArchived.mock.invocationCallOrder[0]).toBeLessThan(onClose.mock.invocationCallOrder[0]);

    // Into the board's context, and nothing else from the answer: not its role.
    const context = queryClient.getQueryData<ProjectContext>(projectContextKey("project-1"));
    expect(context?.project.archivedAt).toBe("2026-10-20T10:00:00Z");
    expect(context?.project.currentUserRole).toBe("ADMIN");
    expect(context?.project.name).toBe("Taska Platform");
  });

  it("drops the row and its counts from Projects, and keeps the board's own reads", async () => {
    const { dialog, queryClient, onClose } = renderDialog(baseProject(), vi.fn());

    askAndAnswer(dialog);
    await waitFor(() => expect(onClose).toHaveBeenCalled());

    // `GET /projects` no longer lists it, so neither does the cache — no
    // archived row of our own making.
    expect(queryClient.getQueryData<Project[]>(["projects"])?.map((row) => row.id)).toEqual(["project-2"]);
    expect(queryClient.getQueryData(["project-summaries", "project-1"])).toBeUndefined();
    // An archived project's reads stay open, so the board keeps what it holds.
    expect(queryClient.getQueryData(["issues", "project-1", "ALL"])).toBeDefined();
    // And the context and the list go stale, to be read again by whoever
    // shows them — the board does at once — and agree with the server.
    expect(queryClient.getQueryState(projectContextKey("project-1"))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(["projects"])?.isInvalidated).toBe(true);
  });

  it("wears the strip's danger edge on the trigger while its question is open", () => {
    const { dialog } = renderDialog(baseProject());
    const trigger = within(dialog).getByRole("button", { name: "Archive project" });

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    // `aria-expanded="true"` is what `.project-archive-trigger[aria-expanded="true"]` paints.
    expect(trigger).toHaveAttribute("aria-expanded", "true");
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

  it("changes nothing on a refusal", async () => {
    refuseArchive(Object.assign(new Error("Project ADMIN role is required"), { status: 403, code: "PERMISSION_DENIED" }));
    const onArchived = vi.fn();
    const { dialog, queryClient, onClose } = renderDialog(baseProject(), onArchived);

    askAndAnswer(dialog);

    expect(await within(dialog).findByText("This project was not archived.")).toBeVisible();
    expect(onClose).not.toHaveBeenCalled();
    expect(onArchived).not.toHaveBeenCalled();
    expect(queryClient.getQueryData<Project[]>(["projects"])).toHaveLength(2);
    expect(queryClient.getQueryData<ProjectContext>(projectContextKey("project-1"))?.project.archivedAt).toBeNull();
  });

  it("shows any other refusal with the server's words and the request id", async () => {
    refuseArchive(
      Object.assign(new Error("Project ADMIN role is required"), {
        status: 403,
        code: "PERMISSION_DENIED",
        requestId: "8a1d3f20-archive",
      }),
    );
    const { dialog } = renderDialog(baseProject());

    askAndAnswer(dialog);

    expect(await within(dialog).findByText("This project was not archived.")).toBeVisible();
    expect(within(dialog).getByText("Project ADMIN role is required")).toBeVisible();
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

  // Neither caller opens the dialog for one; said here so a third cannot offer it.
  it("offers no archive for a project already archived", () => {
    const { dialog } = renderDialog(baseProject({ archivedAt: "2026-10-20T10:00:00Z" }));

    expect(within(dialog).queryByRole("region", { name: "Archive project" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /Archive/ })).not.toBeInTheDocument();
  });
});
