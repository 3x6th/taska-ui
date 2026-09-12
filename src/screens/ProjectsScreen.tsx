import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Search } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { taskaApi } from "../api/client";
import { ApiNotice } from "../components/ApiNotice";
import { Avatar } from "../components/Avatar";
import { ColorSwatches, type ColorChoice } from "../components/ColorSwatches";
import { EditProjectModal } from "../components/EditProjectModal";
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
  // independent facts about one project, and they do not fail together. In
  // hybrid mode the member read is synthesised from `GET /projects/{id}`,
  // which is currently a 500 (TAS-162), while the issue list answers perfectly
  // well — so joining them is how a card ends up claiming zero issues for a
  // project that has nine.
  //
  // Two legs and no third. A `getMembership` fallback used to sit here for
  // rows that state no `currentUserRole`, which against the gateway today is
  // *every* row — backend PR #152 is open — so it fired once per card rather
  // than never, and what it cost depended on the mode. `rest` turned
  // 1 + 2N requests into 1 + 3N, since `getMembership` there is one more
  // `getProject`. `hybrid` with `VITE_TASKA_ASSUME_PROJECT_ADMIN` off turned
  // it into 1 + 4N, since `getMembership` there is that `getProject` plus a
  // `getCurrentUser` of its own. `hybrid` with the flag on — the stand —
  // left it at 1 + 2N, unchanged, because the assumption answers before
  // either request goes out. No mode should pay a request to decide whether
  // to offer a control, and the branch that would have paid one never ran
  // against the gateway the deployed stand talks to — only the free branch
  // did. All of it to decide whether to draw a pencil opening a dialog whose
  // Save cannot succeed until PR #155 deploys either. The row's own field
  // is the only source now; both entry points light up by themselves the
  // day PR #152 lands.
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
  /** The project whose edit dialog is open, by id — see the render below. */
  const [editing, setEditing] = useState<string | null>(null);

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

  // Resolved against the live list every render, and `null` when the row is
  // gone: a project that disappeared between the click and the answer has no
  // dialog to draw, and one that was renamed has a new name to draw with.
  const editingProject = useMemo(
    () => (editing ? (projects.find((project) => project.id === editing) ?? null) : null),
    [editing, projects],
  );

  const projectsUnread = useUnanswered(projectsQuery);
  // One line for the whole grid, not one per card: a gateway that is failing
  // fails for every project at once, and the reader needs the reason once. The
  // cards carry which fact is missing; this carries why. Until now the only
  // trace of a failure here was a `title` attribute — invisible to a touch
  // screen and to a keyboard, and it never carried the message or the request
  // id at all.
  const summaryFailure = summaryQueries.find((query) => query.data?.failure)?.data?.failure;

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
            <button className="primary-button" onClick={() => setCreating(true)} type="button">
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
                onEdit={() => setEditing(project.id)}
                onOpen={() => navigate(`/projects/${project.id}/board`)}
              />
            ))}
          </div>
        )}
      </section>
      {creating ? <NewProjectModal onClose={() => setCreating(false)} onCreated={() => queryClient.invalidateQueries({ queryKey: ["projects"] })} /> : null}
      {/* Held by id rather than by object, so the dialog reads the row the list
          currently holds: its own optimistic patch lands in `["projects"]`, and
          a captured object would go on showing the name it opened with. */}
      {editingProject ? <EditProjectModal project={editingProject} onClose={() => setEditing(null)} /> : null}
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
   * `GET /projects` (backend PR #152). A row that states no role is not a role,
   * so the control is simply absent — its absence is not the permission, which
   * stays the server's (AGENTS.md, DESIGN.md §5.7), and no request is spent
   * here asking for one. Against the gateway today that means no pencil on any
   * card, which is the honest picture while PR #155's `PATCH` is undeployed
   * too; the board's own header keeps its pencil, because the membership query
   * it draws from is already mounted for other reasons.
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
      <button className="project-card" onClick={onOpen} type="button">
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
                user={member.user ? { id: member.userId, displayName: member.user.displayName, color: member.user.color } : null}
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
  const [projectKey, setProjectKey] = useState("API");
  const [name, setName] = useState("API Gateway");
  // Empty, not "REST facade over Taska services". That sentence shipped as the
  // box's initial value — somebody's demo text pre-typed into a form for every
  // reader — and until this build it was also unsendable, because
  // `RestTaskaApi.createProject` dropped `description` on the floor.
  const [description, setDescription] = useState("");
  /**
   * `null` is Automatic: no `color` in the body, so the project computes one
   * from its key. Default because it is the only choice that stays reversible
   * — `PATCH` can change a colour but cannot take one away (TAS-145) — so a
   * project created without one can still pick one later, and a project
   * created with one is committed.
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
          <input className="mono-input" value={projectKey} onChange={(event) => setProjectKey(event.target.value.toUpperCase())} maxLength={6} />
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
        {create.isError ? <div className="form-error">{create.error.message}</div> : null}
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
