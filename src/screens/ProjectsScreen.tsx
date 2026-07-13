import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { taskaApi } from "../api/client";
import { Avatar } from "../components/Avatar";
import { Modal } from "../components/Modal";
import { TaskaLogo } from "../components/TaskaLogo";
import { ThemeToggle } from "../components/ThemeToggle";
import type { Project, ProjectMember, User } from "../domain/types";
import type { ScreenProps } from "./App";

interface ProjectSummary {
  count: number;
  members: ProjectMember[];
}

export function ProjectsScreen({ theme, toggleTheme }: ScreenProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);

  const meQuery = useQuery({ queryKey: ["me"], queryFn: () => taskaApi.getCurrentUser() });
  const projectsQuery = useQuery({ queryKey: ["projects"], queryFn: () => taskaApi.listProjects() });
  const projects = projectsQuery.data ?? [];

  const summariesQuery = useQuery({
    queryKey: ["project-summaries", projects.map((project) => project.id).join(",")],
    enabled: projects.length > 0,
    queryFn: async () => {
      const entries = await Promise.all(
        projects.map(async (project) => {
          const [issues, members] = await Promise.all([
            taskaApi.listIssues(project.id, { pageSize: 100 }),
            taskaApi.listMembers(project.id),
          ]);
          return [project.id, { count: issues.totalCount ?? issues.items.length, members }] as const;
        }),
      );
      return Object.fromEntries(entries) as Record<string, ProjectSummary>;
    },
  });

  const summaries = summariesQuery.data ?? {};

  return (
    <main className="page-shell">
      <TopBar right={<ThemeToggle theme={theme} onToggle={toggleTheme} />} user={meQuery.data} userLoading={meQuery.isPending} />
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
            {projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                summary={summaries[project.id]}
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

function TopBar({
  right,
  user,
  userLoading,
}: {
  right: React.ReactNode;
  user?: Pick<User, "displayName" | "color">;
  userLoading: boolean;
}) {
  return (
    <header className="topbar">
      <TaskaLogo compact />
      <div className="topbar-spacer" />
      {right}
      <Avatar user={user} label="Current user" loading={userLoading} size="md" />
    </header>
  );
}

function ProjectCard({ project, summary, onOpen }: { project: Project; summary?: ProjectSummary; onOpen: () => void }) {
  const members = summary?.members ?? [];
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
          {members.slice(0, 4).map((member) => (
            <Avatar key={member.userId} user={member.user ? { displayName: member.user.displayName, color: member.user.color } : null} size="sm" />
          ))}
          <span className="member-count">{members.length} members</span>
        </div>
        <span className="issue-count">
          <strong>{summary?.count ?? 0}</strong> issues
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
