import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { taskaApi } from "../api/client";
import { ApiNotice } from "../components/ApiNotice";
import { Avatar } from "../components/Avatar";
import { Modal } from "../components/Modal";
import { ThemeToggle } from "../components/ThemeToggle";
import { TopBar } from "../components/TopBar";
import { PendingValue, Unknown } from "../components/Unknown";
import type { Project, ProjectMember } from "../domain/types";
import { useUnanswered } from "../hooks/useUnanswered";
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
  // hybrid mode the member read is synthesised from `GET /projects/{id}`, which
  // is currently a 500 (TAS-162), while the issue list answers perfectly well —
  // so joining them is how a card ends up claiming zero issues for a project
  // that has nine.
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

  const meQuery = useQuery({ queryKey: ["me"], queryFn: () => taskaApi.getCurrentUser() });
  const projectsQuery = useQuery({ queryKey: ["projects"], queryFn: () => taskaApi.listProjects() });
  const projects = projectsQuery.data ?? [];

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
            <p>
              {projectsUnread.unanswered ? <Unknown /> : projects.length} projects ·{" "}
              {meQuery.data?.displayName ?? "Member"}
            </p>
          </div>
          <button className="primary-button" onClick={() => setCreating(true)} type="button">
            <Plus size={15} />
            New project
          </button>
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
        ) : (
          <div className="project-grid">
            {projects.map((project, index) => (
              <ProjectCard
                key={project.id}
                project={project}
                // Same order as the queries were built in, one per project.
                summary={summaryQueries[index]?.data}
                // Loading is not unknown (§5.6). Without this the numbers spent
                // every visit as em dashes before appearing, which said a
                // request that was about to succeed had already failed.
                pending={summaryQueries[index]?.isPending ?? true}
                onOpen={() => navigate(`/projects/${project.id}/board`)}
              />
            ))}
          </div>
        )}
      </section>
      {creating ? <NewProjectModal onClose={() => setCreating(false)} onCreated={() => queryClient.invalidateQueries({ queryKey: ["projects"] })} /> : null}
    </main>
  );
}

function ProjectCard({
  project,
  summary,
  pending,
  onOpen,
}: {
  project: Project;
  summary?: ProjectSummary;
  pending: boolean;
  onOpen: () => void;
}) {
  const members = summary?.members ?? null;
  const count = summary?.count ?? null;
  return (
    <button className="project-card" onClick={onOpen} type="button">
      <div className="project-card-head">
        <span
          className="key-badge"
          style={{
            color: project.color ?? "var(--accent)",
            background: `color-mix(in oklab, ${project.color ?? "var(--accent)"} 16%, transparent)`,
          }}
        >
          {project.projectKey}
        </span>
        <strong>{project.name}</strong>
      </div>
      <p>{project.description ?? "Project workspace"}</p>
      <div className="project-card-foot">
        <div className="avatar-stack">
          {(members ?? []).slice(0, 4).map((member) => (
            <Avatar key={member.userId} user={member.user ? { displayName: member.user.displayName, color: member.user.color } : null} size="sm" />
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
  );
}

function NewProjectModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const queryClient = useQueryClient();
  const [projectKey, setProjectKey] = useState("API");
  const [name, setName] = useState("API Gateway");
  const [description, setDescription] = useState("REST facade over Taska services");

  const canSubmit = useMemo(() => projectKey.trim().length >= 2 && name.trim().length >= 2, [name, projectKey]);

  const create = useMutation({
    mutationFn: () => taskaApi.createProject({ projectKey, name, description }),
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
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="field">
          <span>Description</span>
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} />
        </label>
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
