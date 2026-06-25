import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, ChevronLeft, Plus, Search, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { taskaApi } from "../api/client";
import { Avatar } from "../components/Avatar";
import { PriorityBars, TypeChip } from "../components/IssueBits";
import { Modal } from "../components/Modal";
import { ThemeToggle } from "../components/ThemeToggle";
import type {
  Issue,
  IssueHistoryEvent,
  IssuePriority,
  IssueStatus,
  IssueType,
  ProjectMember,
  User,
  WorkflowStatus,
} from "../domain/types";
import { formatDateTime, formatDay, priorityMeta, relativeTime, statusColors, statusLabels, typeMeta } from "../lib/format";
import type { ScreenProps } from "./App";

type IssueTypeFilter = IssueType | "ALL";
type AssigneeFilter = string | "ALL";

const issueTypes: IssueTypeFilter[] = ["ALL", "TASK", "BUG", "STORY"];
const priorities: IssuePriority[] = ["LOW", "MEDIUM", "HIGH"];

const transitionLabels: Record<IssueStatus, Array<{ to: IssueStatus; label: string }>> = {
  TODO: [{ to: "IN_PROGRESS", label: "Start progress" }],
  IN_PROGRESS: [
    { to: "DONE", label: "Mark done" },
    { to: "TODO", label: "Move to To Do" },
  ],
  DONE: [{ to: "IN_PROGRESS", label: "Reopen" }],
};

export function BoardScreen({ theme, toggleTheme }: ScreenProps) {
  const { projectId = "", issueId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<IssueTypeFilter>("ALL");
  const [assigneeFilter, setAssigneeFilter] = useState<AssigneeFilter>("ALL");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [activeIssueId, setActiveIssueId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
  );

  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    enabled: Boolean(projectId),
    queryFn: () => taskaApi.getProject(projectId),
  });
  const membershipQuery = useQuery({
    queryKey: ["membership", projectId],
    enabled: Boolean(projectId),
    queryFn: () => taskaApi.getMembership(projectId),
  });
  const membersQuery = useQuery({
    queryKey: ["members", projectId],
    enabled: Boolean(projectId),
    queryFn: () => taskaApi.listMembers(projectId),
  });
  const workflowQuery = useQuery({
    queryKey: ["workflow", projectId],
    enabled: Boolean(projectId),
    queryFn: () => taskaApi.getWorkflow(projectId),
  });
  const issuesQuery = useQuery({
    queryKey: ["issues", projectId],
    enabled: Boolean(projectId),
    queryFn: () => taskaApi.listIssues(projectId, { pageSize: 100 }),
  });
  const notificationsQuery = useQuery({
    queryKey: ["notifications"],
    queryFn: () => taskaApi.listNotifications(),
  });

  const project = projectQuery.data;
  const members = membersQuery.data ?? [];
  const issues = issuesQuery.data?.items ?? [];
  const canEdit = membershipQuery.data?.role !== "VIEWER";

  const userById = useMemo(() => toUserMap(members), [members]);
  const statuses = useMemo(
    () => [...(workflowQuery.data?.statuses ?? fallbackStatuses)].sort((a, b) => a.sortOrder - b.sortOrder),
    [workflowQuery.data],
  );

  const filteredIssues = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return issues.filter((issue) => {
      if (typeFilter !== "ALL" && issue.issueType !== typeFilter) return false;
      if (assigneeFilter !== "ALL" && issue.assigneeId !== assigneeFilter) return false;
      if (!normalized) return true;
      return issue.summary.toLowerCase().includes(normalized) || issue.issueKey.toLowerCase().includes(normalized);
    });
  }, [assigneeFilter, issues, query, typeFilter]);

  const transitionIssue = useMutation({
    mutationFn: ({ nextStatus, movedIssueId }: { movedIssueId: string; nextStatus: IssueStatus }) =>
      taskaApi.transitionIssue(projectId, movedIssueId, nextStatus),
    onSuccess: async (_, variables) => {
      await invalidateBoard(queryClient, projectId, variables.movedIssueId);
    },
  });

  const markAllRead = useMutation({
    mutationFn: () => taskaApi.markAllNotificationsRead(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const hasFilters = Boolean(query || typeFilter !== "ALL" || assigneeFilter !== "ALL");
  const unreadCount = notificationsQuery.data?.items.filter((item) => !item.readAt).length ?? 0;
  const activeIssue = activeIssueId ? issues.find((item) => item.id === activeIssueId) : undefined;

  const handleDragStart = (event: DragStartEvent) => {
    setActiveIssueId(String(event.active.id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveIssueId(null);
    const overId = event.over?.id;
    const activeId = String(event.active.id);
    if (!overId) return;
    const nextStatus = String(overId) as IssueStatus;
    const issue = issues.find((item) => item.id === activeId);
    if (!issue || issue.status === nextStatus) return;
    transitionIssue.mutate({ movedIssueId: issue.id, nextStatus });
  };

  return (
    <main className="board-shell">
      <header className="board-topbar">
        <button className="icon-button" onClick={() => navigate("/projects")} title="Back to projects" type="button">
          <ChevronLeft size={17} />
        </button>
        {project ? (
          <span
            className="key-badge"
            style={{
              color: project.color ?? "var(--accent)",
              background: `color-mix(in oklab, ${project.color ?? "var(--accent)"} 16%, transparent)`,
            }}
          >
            {project.projectKey}
          </span>
        ) : null}
        <strong className="board-project-name">{project?.name ?? "Project"}</strong>
        <span className="muted-label">Board</span>
        <div className="topbar-spacer" />
        <label className="search-box">
          <Search size={15} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search issues" />
        </label>
        <div className="notification-wrap">
          <button className="icon-button" onClick={() => setNotificationsOpen((value) => !value)} title="Notifications" type="button">
            <Bell size={16} />
            {unreadCount ? <span className="notification-dot" /> : null}
          </button>
          {notificationsOpen ? (
            <NotificationsPopover
              notifications={notificationsQuery.data?.items ?? []}
              onMarkAll={() => markAllRead.mutate()}
              onOpen={(link) => {
                setNotificationsOpen(false);
                navigate(link);
              }}
            />
          ) : null}
        </div>
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
        <button className="primary-button board-new" disabled={!canEdit} onClick={() => setCreating(true)} type="button">
          <Plus size={15} />
          New
        </button>
      </header>

      <section className="filterbar">
        <div className="segmented compact">
          {issueTypes.map((type) => (
            <button key={type} className={typeFilter === type ? "is-active" : ""} onClick={() => setTypeFilter(type)} type="button">
              {type === "ALL" ? "All" : typeMeta[type].label}
            </button>
          ))}
        </div>
        <span className="divider" />
        <span className="filter-label">Assignee</span>
        <button
          className={`assignee-all ${assigneeFilter === "ALL" ? "is-active" : ""}`}
          onClick={() => setAssigneeFilter("ALL")}
          type="button"
        >
          All
        </button>
        <div className="assignee-row">
          {members.map((member) => (
            <button
              className={`avatar-filter ${assigneeFilter === member.userId ? "is-active" : ""}`}
              key={member.userId}
              onClick={() => setAssigneeFilter(member.userId)}
              type="button"
            >
              <Avatar user={member.user ? { displayName: member.user.displayName, color: member.user.color } : null} size="sm" />
            </button>
          ))}
        </div>
        <div className="topbar-spacer" />
        {hasFilters ? (
          <button
            className="clear-button"
            onClick={() => {
              setQuery("");
              setTypeFilter("ALL");
              setAssigneeFilter("ALL");
            }}
            type="button"
          >
            <X size={13} />
            Clear
          </button>
        ) : null}
        <span className="counter">
          {filteredIssues.length} of {issues.length}
        </span>
      </section>

      <DndContext sensors={sensors} onDragCancel={() => setActiveIssueId(null)} onDragEnd={handleDragEnd} onDragStart={handleDragStart}>
        <section className="columns-area">
          {workflowQuery.isLoading || issuesQuery.isLoading
            ? statuses.map((status) => <ColumnSkeleton key={status.statusKey} status={status} />)
            : statuses.map((status) => (
                <BoardColumn
                  key={status.statusKey}
                  status={status}
                  issues={filteredIssues.filter((issue) => issue.status === status.statusKey)}
                  userById={userById}
                  canEdit={canEdit}
                  onAdd={() => setCreating(true)}
                  onOpenIssue={(id) => navigate(`/projects/${projectId}/issues/${id}`)}
                />
              ))}
        </section>
        <DragOverlay dropAnimation={null} zIndex={1000}>
          {activeIssue ? (
            <div className="issue-card drag-overlay-card">
              <IssueCardContent issue={activeIssue} user={activeIssue.assigneeId ? userById.get(activeIssue.assigneeId) : null} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {issueId ? (
        <IssuePanel
          issueId={issueId}
          projectId={projectId}
          members={members}
          userById={userById}
          canEdit={canEdit}
          onClose={() => navigate(`/projects/${projectId}/board`)}
        />
      ) : null}

      {creating ? (
        <CreateIssueModal
          projectKey={project?.projectKey ?? ""}
          onClose={() => setCreating(false)}
          onCreated={(issue) => {
            setCreating(false);
            navigate(`/projects/${projectId}/issues/${issue.id}`);
          }}
          projectId={projectId}
        />
      ) : null}
    </main>
  );
}

const fallbackStatuses: WorkflowStatus[] = [
  { id: "fallback-todo", statusKey: "TODO", name: "To Do", category: "TODO", sortOrder: 10 },
  { id: "fallback-progress", statusKey: "IN_PROGRESS", name: "In Progress", category: "IN_PROGRESS", sortOrder: 20 },
  { id: "fallback-done", statusKey: "DONE", name: "Done", category: "DONE", sortOrder: 30 },
];

function BoardColumn({
  status,
  issues,
  userById,
  canEdit,
  onAdd,
  onOpenIssue,
}: {
  status: WorkflowStatus;
  issues: Issue[];
  userById: Map<string, Pick<User, "displayName" | "color">>;
  canEdit: boolean;
  onAdd: () => void;
  onOpenIssue: (issueId: string) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: status.statusKey, disabled: !canEdit });

  return (
    <div className={`board-column ${isOver ? "is-over" : ""}`} ref={setNodeRef}>
      <div className="column-head">
        <span className="status-dot" style={{ background: statusColors[status.statusKey] }} />
        <strong>{status.name}</strong>
        <span className="count-pill">{issues.length}</span>
        <button className="icon-button mini" disabled={!canEdit} onClick={onAdd} title="Create issue" type="button">
          <Plus size={13} />
        </button>
      </div>
      <div className="issue-list">
        {issues.map((issue) => (
          <IssueCard key={issue.id} issue={issue} user={issue.assigneeId ? userById.get(issue.assigneeId) : null} onOpen={onOpenIssue} />
        ))}
        {issues.length === 0 ? <div className="empty-column">Drop issues here</div> : null}
      </div>
    </div>
  );
}

function IssueCard({
  issue,
  user,
  onOpen,
}: {
  issue: Issue;
  user?: Pick<User, "displayName" | "color"> | null;
  onOpen: (issueId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: issue.id });

  return (
    <button
      className={`issue-card ${isDragging ? "is-dragging" : ""}`}
      onClick={() => onOpen(issue.id)}
      ref={setNodeRef}
      type="button"
      {...listeners}
      {...attributes}
    >
      <IssueCardContent issue={issue} user={user} />
    </button>
  );
}

function IssueCardContent({ issue, user }: { issue: Issue; user?: Pick<User, "displayName" | "color"> | null }) {
  return (
    <>
      <span className="issue-card-meta">
        <TypeChip type={issue.issueType} />
        <span className="issue-key">{issue.issueKey}</span>
        <span>{typeMeta[issue.issueType].label}</span>
        <PriorityBars priority={issue.priority} />
      </span>
      <strong>{issue.summary}</strong>
      <p>{issue.description}</p>
      <span className="issue-card-foot">
        <span>{formatDay(issue.createdAt)}</span>
        <Avatar user={user} size="sm" />
      </span>
    </>
  );
}

function ColumnSkeleton({ status }: { status: WorkflowStatus }) {
  return (
    <div className="board-column">
      <div className="column-head">
        <span className="status-dot" style={{ background: statusColors[status.statusKey] }} />
        <strong>{status.name}</strong>
      </div>
      <div className="issue-list">
        <div className="issue-card skeleton-card" />
        <div className="issue-card skeleton-card" />
      </div>
    </div>
  );
}

function NotificationsPopover({
  notifications,
  onMarkAll,
  onOpen,
}: {
  notifications: Array<{ id: string; title: string; body: string; createdAt: string; readAt: string | null; link: string }>;
  onMarkAll: () => void;
  onOpen: (link: string) => void;
}) {
  const queryClient = useQueryClient();
  const markRead = useMutation({
    mutationFn: (notificationId: string) => taskaApi.markNotificationRead(notificationId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  return (
    <section className="notifications-popover">
      <header>
        <strong>Notifications</strong>
        <button onClick={onMarkAll} type="button">
          Mark all read
        </button>
      </header>
      <div className="notification-list">
        {notifications.map((notification) => (
          <button
            className="notification-item"
            key={notification.id}
            onClick={() => {
              markRead.mutate(notification.id);
              onOpen(notification.link);
            }}
            type="button"
          >
            <span className={`read-dot ${notification.readAt ? "" : "is-unread"}`} />
            <span>
              <strong>{notification.title}</strong>
              <em>{notification.body}</em>
              <small>{relativeTime(notification.createdAt)}</small>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function IssuePanel({
  projectId,
  issueId,
  members,
  userById,
  canEdit,
  onClose,
}: {
  projectId: string;
  issueId: string;
  members: ProjectMember[];
  userById: Map<string, Pick<User, "displayName" | "color">>;
  canEdit: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const issueQuery = useQuery({
    queryKey: ["issue", projectId, issueId],
    queryFn: () => taskaApi.getIssue(projectId, issueId),
  });
  const issue = issueQuery.data?.issue;
  const history = issueQuery.data?.history ?? [];
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    setSummary(issue?.summary ?? "");
    setDescription(issue?.description ?? "");
  }, [issue?.description, issue?.summary]);

  const updateIssue = useMutation({
    mutationFn: (patch: { summary?: string; description?: string; priority?: IssuePriority }) => taskaApi.updateIssue(projectId, issueId, patch),
    onSuccess: () => invalidateBoard(queryClient, projectId, issueId),
  });
  const assignIssue = useMutation({
    mutationFn: (assigneeId: string | null) => taskaApi.assignIssue(projectId, issueId, assigneeId),
    onSuccess: () => invalidateBoard(queryClient, projectId, issueId),
  });
  const transitionIssue = useMutation({
    mutationFn: (nextStatus: IssueStatus) => taskaApi.transitionIssue(projectId, issueId, nextStatus),
    onSuccess: () => invalidateBoard(queryClient, projectId, issueId),
  });
  const deleteIssue = useMutation({
    mutationFn: () => taskaApi.deleteIssue(projectId, issueId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["issues", projectId] });
      navigate(`/projects/${projectId}/board`);
    },
  });

  if (!issue) {
    return (
      <div className="panel-layer">
        <button className="panel-backdrop" onClick={onClose} aria-label="Close issue" type="button" />
        <aside className="issue-panel">
          <div className="panel-loading">Loading issue</div>
        </aside>
      </div>
    );
  }

  const reporter = userById.get(issue.reporterId);
  const selectedAssignee = issue.assigneeId ? userById.get(issue.assigneeId) : null;

  return (
    <div className="panel-layer">
      <button className="panel-backdrop" onClick={onClose} aria-label="Close issue" type="button" />
      <aside className="issue-panel" aria-label={`${issue.issueKey} issue`}>
        <header className="issue-panel-head">
          <TypeChip type={issue.issueType} />
          <span className="issue-key">{issue.issueKey}</span>
          <span>{typeMeta[issue.issueType].label}</span>
          <div className="topbar-spacer" />
          <button className="icon-button" disabled={!canEdit} onClick={() => deleteIssue.mutate()} title="Delete" type="button">
            <Trash2 size={15} />
          </button>
          <button className="icon-button" onClick={onClose} title="Close" type="button">
            <X size={16} />
          </button>
        </header>
        <div className="issue-panel-body">
          <textarea
            className="summary-textarea"
            disabled={!canEdit}
            onBlur={() => {
              if (summary.trim() && summary !== issue.summary) updateIssue.mutate({ summary: summary.trim() });
            }}
            onChange={(event) => setSummary(event.target.value)}
            rows={2}
            value={summary}
          />

          <div className="transition-row">
            <span className="status-pill" style={{ color: statusColors[issue.status] }}>
              {statusLabels[issue.status]}
            </span>
            <span className="arrow">→</span>
            {transitionLabels[issue.status].map((transition) => (
              <button
                className="secondary-button compact-button"
                disabled={!canEdit || transitionIssue.isPending}
                key={transition.to}
                onClick={() => transitionIssue.mutate(transition.to)}
                type="button"
              >
                {transition.label}
              </button>
            ))}
          </div>

          <div className="meta-grid">
            <span>Assignee</span>
            <div className="chip-row">
              <AssigneeChip active={!selectedAssignee} label="None" onClick={() => assignIssue.mutate(null)} user={null} disabled={!canEdit} />
              {members.map((member) => (
                <AssigneeChip
                  active={issue.assigneeId === member.userId}
                  disabled={!canEdit}
                  key={member.userId}
                  label={member.user?.displayName.split(" ")[0] ?? "User"}
                  onClick={() => assignIssue.mutate(member.userId)}
                  user={member.user ? { displayName: member.user.displayName, color: member.user.color } : null}
                />
              ))}
            </div>
            <span>Priority</span>
            <div className="segmented compact fit">
              {priorities.map((priority) => (
                <button
                  className={issue.priority === priority ? "is-active" : ""}
                  disabled={!canEdit}
                  key={priority}
                  onClick={() => updateIssue.mutate({ priority })}
                  type="button"
                >
                  {priorityMeta[priority].label}
                </button>
              ))}
            </div>
            <span>Reporter</span>
            <div className="person-line">
              <Avatar user={reporter} size="sm" />
              <strong>{reporter?.displayName ?? "Unknown"}</strong>
            </div>
            <span>Created</span>
            <strong className="soft-strong">{formatDateTime(issue.createdAt)}</strong>
          </div>

          <label className="description-field">
            <span>Description</span>
            <textarea
              disabled={!canEdit}
              onBlur={() => {
                if (description !== issue.description) updateIssue.mutate({ description });
              }}
              onChange={(event) => setDescription(event.target.value)}
              rows={5}
              value={description}
            />
          </label>

          <section className="activity">
            <h3>Activity</h3>
            {history
              .slice()
              .reverse()
              .map((event, index) => (
                <ActivityItem
                  event={event}
                  key={event.id}
                  isLast={index === history.length - 1}
                  user={userById.get(event.actorUserId)}
                  userById={userById}
                />
              ))}
          </section>
        </div>
      </aside>
    </div>
  );
}

function AssigneeChip({
  user,
  label,
  active,
  disabled,
  onClick,
}: {
  user: Pick<User, "displayName" | "color"> | null;
  label: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button className={`assignee-chip ${active ? "is-active" : ""}`} disabled={disabled} onClick={onClick} type="button">
      <Avatar user={user} size="sm" />
      <span>{label}</span>
    </button>
  );
}

function ActivityItem({
  event,
  user,
  userById,
  isLast,
}: {
  event: IssueHistoryEvent;
  user?: Pick<User, "displayName" | "color">;
  userById: Map<string, Pick<User, "displayName" | "color">>;
  isLast: boolean;
}) {
  return (
    <div className="activity-item">
      {!isLast ? <span className="activity-line" /> : null}
      <Avatar user={user} size="sm" />
      <div>
        <p>
          <strong>{user?.displayName ?? "Someone"}</strong> {historyText(event, userById)}
        </p>
        <time>{formatDateTime(event.occurredAt)}</time>
      </div>
    </div>
  );
}

function CreateIssueModal({
  projectId,
  projectKey,
  onClose,
  onCreated,
}: {
  projectId: string;
  projectKey: string;
  onClose: () => void;
  onCreated: (issue: Issue) => void;
}) {
  const queryClient = useQueryClient();
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [issueType, setIssueType] = useState<IssueType>("TASK");
  const [priority, setPriority] = useState<IssuePriority>("MEDIUM");

  const createIssue = useMutation({
    mutationFn: () => taskaApi.createIssue(projectId, { issueType, priority, summary, description }),
    onSuccess: async (issue) => {
      await invalidateBoard(queryClient, projectId, issue.id);
      onCreated(issue);
    },
  });

  return (
    <Modal title="New issue" eyebrow={<span className="key-badge">{projectKey}</span>} onClose={onClose}>
      <form
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (summary.trim()) createIssue.mutate();
        }}
      >
        <label className="field">
          <span>Summary</span>
          <input value={summary} onChange={(event) => setSummary(event.target.value)} autoFocus />
        </label>
        <label className="field">
          <span>Description</span>
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} />
        </label>
        <div className="form-two">
          <label>
            <span>Type</span>
            <div className="segmented compact">
              {(["TASK", "BUG", "STORY"] as IssueType[]).map((type) => (
                <button className={issueType === type ? "is-active" : ""} key={type} onClick={() => setIssueType(type)} type="button">
                  {typeMeta[type].label}
                </button>
              ))}
            </div>
          </label>
          <label>
            <span>Priority</span>
            <div className="segmented compact">
              {priorities.map((item) => (
                <button className={priority === item ? "is-active" : ""} key={item} onClick={() => setPriority(item)} type="button">
                  {priorityMeta[item].label}
                </button>
              ))}
            </div>
          </label>
        </div>
        {createIssue.isError ? <div className="form-error">{createIssue.error.message}</div> : null}
        <div className="modal-actions">
          <button className="secondary-button" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="primary-button" disabled={!summary.trim() || createIssue.isPending} type="submit">
            Create issue
          </button>
        </div>
      </form>
    </Modal>
  );
}

function toUserMap(members: ProjectMember[]) {
  return new Map(
    members
      .filter((member) => member.user)
      .map((member) => [
        member.userId,
        {
          displayName: member.user!.displayName,
          color: member.user!.color,
        },
      ]),
  );
}

function historyText(event: IssueHistoryEvent, userById: Map<string, Pick<User, "displayName" | "color">>) {
  if (event.eventType === "CREATED") return "created this issue";
  if (event.eventType === "TRANSITIONED") {
    const from = event.payload.from ? statusLabels[event.payload.from] : "another status";
    const to = event.payload.to && isIssueStatus(event.payload.to) ? statusLabels[event.payload.to] : event.payload.to;
    return `moved ${from} to ${to}`;
  }
  if (event.eventType === "ASSIGNED") {
    if (!event.payload.to || typeof event.payload.to !== "string") return "cleared the assignee";
    return `assigned ${userById.get(event.payload.to)?.displayName ?? "someone"}`;
  }
  if (event.eventType === "PRIORITY") {
    const priority = event.payload.to && isPriority(event.payload.to) ? priorityMeta[event.payload.to].label : "priority";
    return `set priority to ${priority}`;
  }
  return "updated this issue";
}

function isIssueStatus(value: string): value is IssueStatus {
  return value === "TODO" || value === "IN_PROGRESS" || value === "DONE";
}

function isPriority(value: string): value is IssuePriority {
  return value === "LOW" || value === "MEDIUM" || value === "HIGH";
}

async function invalidateBoard(queryClient: ReturnType<typeof useQueryClient>, projectId: string, issueId?: string) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["issues", projectId] }),
    issueId ? queryClient.invalidateQueries({ queryKey: ["issue", projectId, issueId] }) : Promise.resolve(),
    queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  ]);
}
