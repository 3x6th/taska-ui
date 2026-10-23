import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { taskaApi } from "../api/client";
import { ApiNotice } from "../components/ApiNotice";
import { Avatar } from "../components/Avatar";
import { ColorSwatches, type ColorChoice } from "../components/ColorSwatches";
import { EditProjectModal } from "../components/EditProjectModal";
import { ErrorNote } from "../components/ErrorNote";
import { Modal } from "../components/Modal";
import { ThemeToggle } from "../components/ThemeToggle";
import { TopBar } from "../components/TopBar";
import { PendingValue, Unknown } from "../components/Unknown";
import type { Project, ProjectMember } from "../domain/types";
import { useUnanswered } from "../hooks/useUnanswered";
import { computedProjectColor, keyBadgeStyle, labelColorChoices } from "../lib/format";
import type { ScreenProps } from "./App";

/** `null` is "the server did not say", which a card must never round down to 0. */
interface ProjectSummary {
  count: number | null;
  members: ProjectMember[] | null;
  /**
   * Why a `null` above is `null`. The query itself resolves either way — one
   * half of a card is worth drawing without the other — so this is the only
   * route the gateway's own words and its request id have out of here, and
   * without it the screen could say "unknown" and nothing more.
   */
  failure: Error | null;
}

async function loadSummary(projectId: string): Promise<ProjectSummary> {
  // `allSettled`, not `all`: the issue count and the member list are two
  // independent facts about one project, and they do not fail together. When
  // `GET /projects/{id}` was a 500 (TAS-162), the member read that `hybrid`
  // then synthesised from it failed while the issue list answered perfectly
  // well — so joining them is how a card ends up claiming zero issues for a
  // project that has nine. They are two separate gateway reads now, and still
  // fail apart: on the stand one unreadable avatar object fails the whole member
  // read with a 404, 403 or 503 (see `TaskaApi.listMembers`) while the issue
  // list answers.
  //
  // Two legs and no third. A `getMembership` fallback used to sit here for
  // rows that state no `currentUserRole` — every row, before backend TAS-137
  // deployed — so it fired once per card rather than never, and in `rest` it
  // turned 1 + 2N requests into 1 + 3N. No mode should pay a request to decide
  // whether to offer a control, all of it to draw a pencil opening a dialog
  // whose Save could not succeed until PR #155 deployed either. The row's own
  // field is the only source.
  const [issues, members] = await Promise.allSettled([
    taskaApi.listIssues(projectId, { pageSize: 100 }),
    taskaApi.listMembers(projectId),
  ]);
  const rejection = [issues, members].find((result) => result.status === "rejected")?.reason;

  return {
    count: issues.status === "fulfilled" ? (issues.value.totalCount ?? issues.value.items.length) : null,
    members: members.status === "fulfilled" ? members.value : null,
    failure: rejection instanceof Error ? rejection : null,
  };
}

export function ProjectsScreen({ theme, toggleTheme, onLogout, logoutPending }: ScreenProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  /**
   * The project whose edit dialog is open: the last row the list held for it,
   * and where its card stood in the grid then. Kept up to date below while the
   * row is listed, and kept as it was once the row has gone — see the render.
   */
  const [editing, setEditing] = useState<{ row: Project; index: number } | null>(null);
  /**
   * The page's one status line (DESIGN.md §4.11, «Успех» from `/projects`):
   * "{KEY} archived. It no longer appears in Projects." Mounted from the first
   * frame and visually hidden, so the sentence that lands in it is announced.
   * Held until the next archive or until the reader leaves the page.
   */
  const [status, setStatus] = useState("");
  /**
   * The project focus goes to once an archived card has left the grid — after
   * this page's archive, or after the dialog of a card somebody else archived
   * is closed; `null` for "New project".
   */
  const focusAfterArchive = useRef<{ id: string | null } | null>(null);
  const newProjectButton = useRef<HTMLButtonElement>(null);

  const [filter, setFilter] = useState("");

  const meQuery = useQuery({ queryKey: ["me"], queryFn: () => taskaApi.getCurrentUser() });
  const projectsQuery = useQuery({ queryKey: ["projects"], queryFn: () => taskaApi.listProjects() });
  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data]);

  /**
   * Filtered on the client, and correct by construction rather than as a
   * compromise: `GET /projects` returns the whole list unpaginated, so there is
   * no second page for a filter here to be wrong about. Name **and** key,
   * because the key is what the reader knows a project by on every card and in
   * every issue key. No endpoint for this exists and none is needed — the one
   * search route the gateway has is for issues.
   */
  const visibleProjects = useMemo(() => {
    const normalized = filter.trim().toLowerCase();
    if (!normalized) return projects;
    return projects.filter(
      (project) =>
        project.name.toLowerCase().includes(normalized) || project.projectKey.toLowerCase().includes(normalized),
    );
  }, [filter, projects]);
  const filtering = filter.trim().length > 0;

  // One query per project rather than a single `Promise.all` across all of
  // them. The batch rejected as a whole, so one project the gateway would not
  // answer for erased the counts of every other project in the list — and each
  // card then stated "0 issues", which is a claim about the project rather than
  // an admission about the request (TAS-163). The `project-summaries` prefix is
  // kept so the existing invalidation after a create still matches.
  const summaryQueries = useQueries({
    queries: projects.map((project) => ({
      queryKey: ["project-summaries", project.id],
      queryFn: () => loadSummary(project.id),
    })),
  });

  // Position-free access to the per-project queries. `summaryQueries` is built
  // over the *unfiltered* list, so once the grid can render a subset an index
  // into it is one project's counts printed on another project's card.
  const summaryByProject = useMemo(
    () => new Map(projects.map((project, index) => [project.id, summaryQueries[index]])),
    [projects, summaryQueries],
  );

  /**
   * The open dialog's row, resolved against the live list every render, so
   * its own optimistic patch and a rename from elsewhere both reach it.
   *
   * When the row leaves `["projects"]` under the open dialog — somebody else
   * archived the project, and a refetch (this dialog's own refused Save
   * included) no longer lists it — the dialog does not vanish under the
   * reader. It stays on the last row seen, read-only, until it is closed
   * (DESIGN.md §4.11, «Архив пришёл отказом Save на `/projects`»). Looked up in
   * the unfiltered list, so a rename that takes the card out of the filter is
   * not mistaken for that; its place in the grid is the filtered one, which is
   * where focus has to go on close. Updated during render — the pattern
   * `GlobalSearch` uses — so no frame draws the stale row.
   */
  const listedRow = editing ? projects.find((project) => project.id === editing.row.id) : undefined;
  const listedIndex = editing ? visibleProjects.findIndex((project) => project.id === editing.row.id) : -1;
  if (
    editing &&
    listedRow &&
    (listedRow !== editing.row || (listedIndex >= 0 && listedIndex !== editing.index))
  ) {
    setEditing({ row: listedRow, index: listedIndex >= 0 ? listedIndex : editing.index });
  }
  const editingProject = editing ? (listedRow ?? editing.row) : null;
  // Only against a list that answered: no data is not "the row left".
  const editingUnlisted = editing !== null && listedRow === undefined && projectsQuery.data !== undefined;

  const projectsUnread = useUnanswered(projectsQuery);
  // One line for the whole grid, not one per card: a gateway that is failing
  // fails for every project at once, and the reader needs the reason once. The
  // cards carry which fact is missing; this carries why. Until now the only
  // trace of a failure here was a `title` attribute — invisible to a touch
  // screen and to a keyboard, and it never carried the message or the request
  // id at all.
  const summaryFailure = summaryQueries.find((query) => query.data?.failure)?.data?.failure;

  /**
   * An archived project leaves the grid in the frame the dialog closes in —
   * the dialog takes it out of `["projects"]` before it closes — so this only
   * decides where focus goes and what is said. Focus: the card that takes the
   * archived one's place, else the one before it, else "New project", read
   * off the grid as it stands, filter included. Nothing animates.
   */
  const projectArchived = (archived: Project) => {
    const index = visibleProjects.findIndex((project) => project.id === archived.id);
    const remaining = visibleProjects.filter((project) => project.id !== archived.id);
    const next = index < 0 ? undefined : (remaining[index] ?? remaining[index - 1]);
    focusAfterArchive.current = { id: next?.id ?? null };
    setStatus(`${archived.projectKey} archived. It no longer appears in Projects.`);
  };
  /**
   * Closing the dialog. Over a row that has left the list, focus goes where it
   * goes after an archive — the card now in that card's place, else the one
   * before it, else "New project" — and nothing is said: the dialog already
   * said it (§4.11). Otherwise the dialog hands focus back to its opener itself.
   */
  const closeEditor = () => {
    if (editing && editingUnlisted) {
      const next = visibleProjects[editing.index] ?? visibleProjects[editing.index - 1];
      focusAfterArchive.current = { id: next?.id ?? null };
    }
    setEditing(null);
  };
  // After the commit that took the card away, and after the dialog's own
  // cleanup, which hands focus to its opener only when focus fell to <body> —
  // and that opener, the archived card's pencil, has gone with the card.
  useEffect(() => {
    const target = focusAfterArchive.current;
    if (!target) return;
    focusAfterArchive.current = null;
    // Matched on the data attribute rather than built into a selector, so an
    // id needs no escaping.
    const card = [...document.querySelectorAll<HTMLButtonElement>("button.project-card")].find(
      (node) => target.id !== null && node.dataset.projectId === target.id,
    );
    (card ?? newProjectButton.current)?.focus();
  });

  return (
    <main className="page-shell">
      <TopBar
        right={<ThemeToggle theme={theme} onToggle={toggleTheme} />}
        user={meQuery.data}
        userLoading={meQuery.isPending}
        loggingOut={logoutPending}
        onLogout={onLogout}
      />
      <section className="projects-page">
        <p className="visually-hidden" role="status">
          {status}
        </p>
        <div className="projects-heading">
          <div>
            <h1>Projects</h1>
            {/* The count says what is on screen and, when that is not all of
                them, what it is out of. "2 projects" under an active filter
                would be a claim about the account rather than about the
                filter. */}
            <p>
              {projectsUnread.unanswered ? (
                <Unknown />
              ) : filtering ? (
                `${visibleProjects.length} of ${projects.length}`
              ) : (
                projects.length
              )}{" "}
              projects · {meQuery.data?.displayName ?? "Member"}
            </p>
          </div>
          <div className="projects-heading-actions">
            <label className="search-box">
              <Search aria-hidden="true" size={15} />
              <span className="visually-hidden">Filter projects by name or key</span>
              <input
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Filter projects"
                type="text"
                value={filter}
              />
            </label>
            <button className="primary-button" onClick={() => setCreating(true)} ref={newProjectButton} type="button">
              <Plus size={15} />
              New project
            </button>
          </div>
        </div>

        {projectsUnread.unanswered ? (
          <ApiNotice error={projectsUnread.error}>The project list could not be loaded.</ApiNotice>
        ) : summaryFailure ? (
          <ApiNotice error={summaryFailure} live="polite">
            Some project details could not be loaded, so their counts show as unknown.
          </ApiNotice>
        ) : null}

        {/* Not while the read has already failed: a retry puts the query back
            into `pending`, and four skeleton cards under a banner saying the
            list could not be loaded is the same lie in a different shape. */}
        {projectsQuery.isPending && !projectsUnread.unanswered ? (
          <div className="project-grid">
            {Array.from({ length: 4 }).map((_, index) => (
              <div className="project-card skeleton-card" key={index} />
            ))}
          </div>
        ) : filtering && visibleProjects.length === 0 ? (
          // A filter that matches nothing is not an account with no projects,
          // and the two must not read the same (§5.6).
          <p className="projects-empty">No projects match “{filter.trim()}”.</p>
        ) : (
          <div className="project-grid">
            {visibleProjects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                // Keyed by project id rather than by position: the queries were
                // built over the unfiltered list, so a filtered index would put
                // one project's counts on another's card.
                summary={summaryByProject.get(project.id)?.data}
                // Loading is not unknown (§5.6). Without this the numbers spent
                // every visit as em dashes before appearing, which said a
                // request that was about to succeed had already failed.
                pending={summaryByProject.get(project.id)?.isPending ?? true}
                onEdit={() => setEditing({ row: project, index: visibleProjects.indexOf(project) })}
                onOpen={() => navigate(`/projects/${project.id}/board`)}
              />
            ))}
          </div>
        )}
      </section>
      {creating ? <NewProjectModal onClose={() => setCreating(false)} onCreated={() => queryClient.invalidateQueries({ queryKey: ["projects"] })} /> : null}
      {/* The row the list currently holds, while it holds one: the dialog's own
          optimistic patch lands in `["projects"]`, and a captured object would
          go on showing the name it opened with. */}
      {editingProject ? (
        <EditProjectModal
          onArchived={() => projectArchived(editingProject)}
          onClose={closeEditor}
          project={editingProject}
          unlisted={editingUnlisted}
        />
      ) : null}
    </main>
  );
}

function ProjectCard({
  project,
  summary,
  pending,
  onEdit,
  onOpen,
}: {
  project: Project;
  summary?: ProjectSummary;
  pending: boolean;
  onEdit: () => void;
  onOpen: () => void;
}) {
  const members = summary?.members ?? null;
  const count = summary?.count ?? null;
  /**
   * ADMIN only, and from the list row alone: `currentUserRole` on
   * `GET /projects` (backend TAS-137, PR #152). A row that states no role is
   * not a role, so the control is simply absent — its absence is not the
   * permission, which stays the server's (AGENTS.md, DESIGN.md §5.7), and no
   * request is spent here asking for one. Before TAS-137 deployed no row on the
   * stand stated one, so no card carried a pencil. Now every `GET /projects`
   * item carries the reader's role (read at `develop` `1cfe4d79f074`), so on
   * the stand an ADMIN's cards show the pencil, and Save reaches PR #155's
   * `PATCH`, deployed since 2026-10-23. The board's own header draws its pencil
   * from the context read it already mounts for other reasons.
   */
  const canEdit = project.currentUserRole === "ADMIN";
  /**
   * A sibling of the card rather than a child of it, because the card *is* a
   * `<button>` and a button inside a button is not markup a browser will keep.
   * The shell gives the two a shared box to be positioned in and carries the
   * hover lift for both, so the edit control does not sit still while the card
   * it belongs to rises 2px out from under it.
   */
  return (
    <div className={`project-card-shell ${canEdit ? "is-editable" : ""}`}>
      <button className="project-card" data-project-id={project.id} onClick={onOpen} type="button">
        <div className="project-card-head">
          <span className="key-badge" style={keyBadgeStyle(project.projectKey, project.color)}>
            {project.projectKey}
          </span>
          <strong>{project.name}</strong>
        </div>
        {/* `??` is not enough here and has not been since a description became
            clearable: `""` is a description the server genuinely holds, and it
            slips straight past a nullish check to render an empty paragraph
            where the placeholder belongs (§5.6 — an empty state says so). */}
        <p>{project.description?.trim() || "Project workspace"}</p>
        <div className="project-card-foot">
          <div className="avatar-stack">
            {(members ?? []).slice(0, 4).map((member) => (
              <Avatar
                key={member.userId}
                user={
                  member.user
                    ? {
                        id: member.userId,
                        displayName: member.user.displayName,
                        color: member.user.color,
                        // Declared inline on the member row (backend TAS-137),
                        // so a card showing four faces still costs one member
                        // read. The server fills it since TAS-225 (see
                        // `User.avatarUrl`); a member without one draws initials.
                        avatarUrl: member.user.avatarUrl,
                      }
                    : null
                }
                size="sm"
              />
            ))}
            {/* Three states, not two: a number, a request still in flight, and a
                request that failed. The `title` that used to stand in for the
                third was hover-only — unreachable from a touch screen and from a
                keyboard — and it called a pending read "Not loaded" as well. */}
            <span className="member-count">
              {pending ? <PendingValue /> : members ? members.length : <Unknown />} members
            </span>
          </div>
          <span className="issue-count">
            <strong>{pending ? <PendingValue /> : count === null ? <Unknown /> : count}</strong> issues
          </span>
        </div>
      </button>
      {canEdit ? (
        // Named with the project in it, because on a grid of cards "Edit
        // project" alone is the same name eight times over and a list of
        // buttons is one of the ways this page is read (§7).
        <button
          aria-label={`Edit ${project.name}`}
          className="icon-button project-card-edit"
          onClick={onEdit}
          title={`Edit ${project.name}`}
          type="button"
        >
          <Pencil size={14} />
        </button>
      ) : null}
    </div>
  );
}

function NewProjectModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const queryClient = useQueryClient();
  // All three empty. Key and Name used to open as "API" and "API Gateway", and
  // the description as "REST facade over Taska services" — demo text pre-typed
  // for every reader (TAS-148). Once Key took focus on open (TAS-299) the caret
  // landed after "API", so typing a key appended to it: "APIWEB". Create stays
  // disabled until both are at least two characters (`canSubmit`).
  const [projectKey, setProjectKey] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  /**
   * `null` is Automatic: no `color` in the body, so the project computes one
   * from its key. Default because it states nothing the reader did not choose;
   * either choice is reversible, as `PATCH` clears a colour with an explicit
   * `null` (backend PR #155, TAS-145).
   */
  const [color, setColor] = useState<string | null>(null);
  const automaticHintId = useId();

  const canSubmit = useMemo(() => projectKey.trim().length >= 2 && name.trim().length >= 2, [name, projectKey]);

  const choices = useMemo<ColorChoice[]>(
    () => [
      {
        value: null,
        // Follows the key box as it is typed, so the swatch shows the colour
        // this project would actually wear rather than a stand-in for one.
        swatch: computedProjectColor(projectKey),
        label: "Automatic colour, from the project key",
      },
      ...labelColorChoices.map((choice) => ({ value: choice, swatch: choice, label: `Colour ${choice}` })),
    ],
    [projectKey],
  );

  const create = useMutation({
    // Both trimmed and both omitted when empty: a blank description is a value
    // the server would store, and "no description" is not the same project as
    // one whose description is a space.
    mutationFn: () =>
      taskaApi.createProject({
        projectKey: projectKey.trim(),
        name: name.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(color ? { color } : {}),
      }),
    onSuccess: async () => {
      onCreated();
      await queryClient.invalidateQueries({ queryKey: ["project-summaries"] });
      onClose();
    },
  });

  return (
    <Modal title="New project" onClose={onClose}>
      <form
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) create.mutate();
        }}
      >
        <label className="field">
          <span>Key</span>
          {/* The first field takes focus, as in every form dialog (§7): `Modal`'s
              fallback to Close is for content with nothing to fill in. */}
          <input
            autoFocus
            className="mono-input"
            value={projectKey}
            onChange={(event) => setProjectKey(event.target.value.toUpperCase())}
            maxLength={6}
          />
        </label>
        <label className="field">
          <span>Name</span>
          <input maxLength={255} value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="field">
          <span>Description</span>
          <textarea
            maxLength={2000}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What this project is for"
            rows={3}
            value={description}
          />
        </label>
        <div className="field">
          <span>Colour</span>
          <ColorSwatches
            choices={choices}
            describedBy={automaticHintId}
            groupLabel="Project colour"
            onPick={setColor}
            selected={color}
          />
          {/* What the first swatch is, said once for both dialogs. It is the
              default and the only one whose meaning is not its colour, and
              until now the dashed ring was explained by a `title` and an
              aria-label — nothing at all on a touch screen. `--fg-3` because
              this genuinely is meta about a field (§7), and `aria-describedby`
              rather than a loose paragraph so it is announced on entering the
              group instead of read past. */}
          <p className="field-note" id={automaticHintId}>
            The first swatch is Automatic: the project takes its colour from its key.
          </p>
        </div>
        {create.isError ? <ErrorNote>{create.error.message}</ErrorNote> : null}
        <div className="modal-actions">
          <button className="secondary-button" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="primary-button" disabled={!canSubmit || create.isPending} type="submit">
            Create project
          </button>
        </div>
      </form>
    </Modal>
  );
}
