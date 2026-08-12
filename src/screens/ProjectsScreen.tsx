import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { taskaApi } from "../api/client";
import { Avatar } from "../components/Avatar";
import { Modal } from "../components/Modal";
import { ThemeToggle } from "../components/ThemeToggle";
import { TopBar } from "../components/TopBar";
import type { Project, ProjectMember } from "../domain/types";
import type { ScreenProps } from "./App";

/** `null` is "the server did not say", which a card must never round down to 0. */
interface ProjectSummary {
  count: number | null;
  members: ProjectMember[] | null;
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

  return {
    count: issues.status === "fulfilled" ? (issues.value.totalCount ?? issues.value.items.length) : null,
    members: members.status === "fulfilled" ? members.value : null,
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
              {projects.length} projects · {meQuery.data?.displayName ?? "Member"}
            </p>
          </div>
          <button className="primary-button" onClick={() => setCreating(true)} type="button">
            <Plus size={15} />
            New project
          </button>
        </div>

        {projectsQuery.isLoading ? (
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

/**
 * An em dash is what this interface already says for "the server did not tell
 * us" (AdminScreen's `formatCell`); the word behind it is for the screen
 * reader, which would otherwise hear a bare "issues".
 */
function Unknown() {
  return (
    <>
      <span aria-hidden="true">—</span>
      <span className="visually-hidden">unknown</span>
    </>
  );
}

function ProjectCard({ project, summary, onOpen }: { project: Project; summary?: ProjectSummary; onOpen: () => void }) {
  // `undefined` — still loading — reads the same as a failure here: neither is
  // a number, and neither is zero.
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
          <span className="member-count" title={members ? undefined : "Not loaded"}>
            {members ? members.length : <Unknown />} members
          </span>
        </div>
        <span className="issue-count" title={count === null ? "Not loaded" : undefined}>
          <strong>{count === null ? <Unknown /> : count}</strong> issues
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
