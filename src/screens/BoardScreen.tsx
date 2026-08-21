import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Check, ChevronLeft, Pencil, Plus, Search, Tag, Trash2, X } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { CreateIssueLinkInput, CreateProjectLabelInput } from "../api/TaskaApi";
import { taskaApi } from "../api/client";
import { isMissingOrForbidden } from "../api/errors";
import { ApiNotice } from "../components/ApiNotice";
import { Avatar } from "../components/Avatar";
import { LabelChip, PriorityBars, TypeChip } from "../components/IssueBits";
import { Modal } from "../components/Modal";
import { ThemeToggle } from "../components/ThemeToggle";
import { PendingValue, Unknown } from "../components/Unknown";
import { UserProfileMenu } from "../components/UserProfileMenu";
import { useUnanswered } from "../hooks/useUnanswered";
import type {
  Issue,
  IssueComment,
  IssueHistoryEvent,
  IssueLink,
  IssueLinkType,
  Label,
  Page,
  IssuePriority,
  IssueStatus,
  IssueType,
  ProjectLabel,
  ProjectMember,
  User,
  Workflow,
  WorkflowStatus,
  WorkflowTransition,
} from "../domain/types";
import {
  formatDateTime,
  formatDay,
  isLabelColor,
  issueLinkTypeLabel,
  issueLinkTypes,
  labelColorChoices,
  priorityMeta,
  relativeTime,
  statusColors,
  statusLabels,
  typeMeta,
} from "../lib/format";
import type { ScreenProps } from "./App";
import { NotFoundScreen } from "./NotFoundScreen";

type IssueTypeFilter = IssueType | "ALL";
type AssigneeFilter = string | "ALL";
/** A project label's id, or every issue whatever it carries. */
type LabelFilter = string | "ALL";
type WorkflowsByIssueType = Partial<Record<IssueType, Workflow>>;

const concreteIssueTypes: IssueType[] = ["TASK", "BUG", "STORY"];
const issueTypes: IssueTypeFilter[] = ["ALL", ...concreteIssueTypes];
// "Missing or not yours" is an answer, not a transient failure. Without this,
// the app-wide `retry: 1` (src/main.tsx) spends a full retryDelay re-asking a
// question already answered, and the board shows a second of plausible chrome —
// project name, filters, empty columns — for a project the viewer must not see,
// before §4.18 replaces it. `failureCount < 1` reproduces the global budget, so
// genuine failures (network, 5xx) still get their one retry.
// `error: Error` is not decoration: react-query infers each query's TError from
// this signature, and `unknown` here would make every `query.error` unknown.
const retryUnlessMissing = (failureCount: number, error: Error) =>
  !isMissingOrForbidden(error) && failureCount < 1;
const priorities: IssuePriority[] = ["LOW", "MEDIUM", "HIGH"];
// The gateway caps `pageSize` for comments at 50.
const commentsPageSize = 50;

export function BoardScreen({ theme, toggleTheme, onLogout, logoutPending }: ScreenProps) {
  const { projectId = "", issueId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<IssueTypeFilter>("ALL");
  const [assigneeFilter, setAssigneeFilter] = useState<AssigneeFilter>("ALL");
  const [labelFilter, setLabelFilter] = useState<LabelFilter>("ALL");
  const [managingLabels, setManagingLabels] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [activeIssueId, setActiveIssueId] = useState<string | null>(null);
  // A drop with no legal transition must say so — the board has no toast, so
  // silence here means the card just snaps back unexplained.
  const [dragNotice, setDragNotice] = useState<string | null>(null);
  // Split by input type instead of one PointerSensor (TAS-164). Pointer events
  // give a sensor no way to stop the browser claiming a touch gesture for
  // scrolling, and the only reliable counter — `touch-action: none` on the
  // card — is not available here: cards fill the column, so it would leave
  // nowhere on a phone to start a scroll (DESIGN.md §5.2). A long press does
  // the same job without taking scrolling away. Below the delay the gesture
  // still belongs to the browser; the tolerance is kept under a browser's own
  // touch slop (~8px) so the drag can never activate after a scroll has
  // already started, which is the one state where both would happen at once.
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 250,
        tolerance: 5,
      },
    }),
  );

  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    enabled: Boolean(projectId),
    queryFn: () => taskaApi.getProject(projectId),
    retry: retryUnlessMissing,
  });
  const membershipQuery = useQuery({
    queryKey: ["membership", projectId],
    enabled: Boolean(projectId),
    queryFn: () => taskaApi.getMembership(projectId),
    retry: retryUnlessMissing,
  });
  const membersQuery = useQuery({
    queryKey: ["members", projectId],
    enabled: Boolean(projectId),
    queryFn: () => taskaApi.listMembers(projectId),
    retry: retryUnlessMissing,
  });
  const workflowQuery = useQuery({
    queryKey: ["workflows", projectId],
    enabled: Boolean(projectId),
    retry: retryUnlessMissing,
    queryFn: async () => {
      const entries = await Promise.all(
        concreteIssueTypes.map(async (issueType) => [
          issueType,
          await taskaApi.getWorkflow(projectId, issueType),
        ] as const),
      );
      return Object.fromEntries(entries) as WorkflowsByIssueType;
    },
  });
  const projectLabelsQuery = useQuery({
    queryKey: ["project-labels", projectId],
    enabled: Boolean(projectId),
    queryFn: () => taskaApi.listProjectLabels(projectId),
    retry: retryUnlessMissing,
  });
  // The one filter the *server* applies, so it belongs in the key rather than
  // in the predicate below with the other three. With `pageSize: 100` a
  // client-side label filter would quietly only filter the hundred issues this
  // page happens to hold, and answer "the ones carrying this label among those"
  // to a question that asked about the project.
  const issuesKey = useMemo(() => ["issues", projectId, labelFilter], [projectId, labelFilter]);
  const issuesQuery = useQuery({
    queryKey: issuesKey,
    enabled: Boolean(projectId),
    queryFn: () =>
      taskaApi.listIssues(projectId, {
        pageSize: 100,
        labelId: labelFilter === "ALL" ? undefined : labelFilter,
      }),
    retry: retryUnlessMissing,
  });
  const notificationsQuery = useQuery({
    queryKey: ["notifications"],
    queryFn: () => taskaApi.listNotifications(),
  });
  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => taskaApi.getCurrentUser(),
  });

  const project = projectQuery.data;
  // Memoized so the `?? []` fallback does not produce a new array identity on
  // every render and invalidate the memos below.
  const members = useMemo(() => membersQuery.data ?? [], [membersQuery.data]);
  const issues = useMemo(() => issuesQuery.data?.items ?? [], [issuesQuery.data]);
  const projectLabels = useMemo(() => projectLabelsQuery.data ?? [], [projectLabelsQuery.data]);
  const canEdit = membershipQuery.data?.role === "ADMIN" || membershipQuery.data?.role === "MEMBER";
  // Narrower than `canEdit` on purpose: TAS-119 lets a MEMBER put labels on an
  // issue but reserves creating, renaming and deleting the project's labels for
  // its ADMIN. The server enforces both; this only decides what is offered.
  const isProjectAdmin = membershipQuery.data?.role === "ADMIN";
  // Each of these is the same single fact as the behaviour beside it, never a
  // second opinion about the same query: `canEdit` is "the membership answer
  // says so", and `roleUnread.unanswered` is "there is no membership answer and
  // asking has failed". Deriving the two from different facets of the query —
  // `data?.role` for one, `isError` for the other — is what made the banner
  // disappear on every refetch while the controls stayed off, and made it
  // appear over a board that was fully writable (see `useUnanswered`).
  const projectUnread = useUnanswered(projectQuery);
  const roleUnread = useUnanswered(membershipQuery);
  const issuesUnread = useUnanswered(issuesQuery);
  const workflowUnread = useUnanswered(workflowQuery);
  const labelsUnread = useUnanswered(projectLabelsQuery);
  // "The server never told us your role" and "you are a VIEWER" are different
  // states, and only one of them is a permission. Both end in a board nobody
  // can write to — the server stays the authority, so write access we could
  // not verify is not ours to grant (AGENTS.md) — but a read-only board
  // presented without a word is what made TAS-163 invisible. This says which
  // of the two it is; it never invents a role.
  const roleUnknown = roleUnread.unanswered;
  // Failure is not zero. With no issue list, "0" in a column head, "0 of 0" in
  // the filter bar and "Drop issues here" in every column are three claims
  // about the project made by a request that never answered — the last of them
  // an invitation to drop a card into a column whose contents are unknown
  // (§5.6: empty and error have to be distinguishable).
  const issuesUnknown = issuesUnread.unanswered;
  // The fallback workflow below is a *loading* default and would be a lie as a
  // *failure* default: its transition ids are this repository's own mock seed,
  // so a board whose workflow could not be read would present three columns as
  // if the server had described them and post a transition id the gateway has
  // never heard of. The columns stay — their keys are the contract's own
  // statuses and the issues have to go somewhere — but nothing may be moved on
  // a workflow nobody sent, and this is what says so.
  const workflowUnknown = workflowUnread.unanswered;

  const userById = useMemo(() => toUserMap(members), [members]);
  const statuses = useMemo(
    () => mergeWorkflowStatuses(workflowQuery.data),
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
    mutationFn: ({ movedIssueId, transitionId }: { movedIssueId: string; nextStatus: IssueStatus; transitionId: string }) =>
      taskaApi.transitionIssue(projectId, movedIssueId, transitionId),
    onMutate: async ({ nextStatus, movedIssueId }) => {
      await queryClient.cancelQueries({ queryKey: issuesKey });
      const previousIssues = queryClient.getQueryData<Page<Issue>>(issuesKey);

      queryClient.setQueryData<Page<Issue>>(issuesKey, (current) => {
        if (!current) return current;
        return {
          ...current,
          items: current.items.map((item) =>
            item.id === movedIssueId
              ? {
                  ...item,
                  status: nextStatus,
                  updatedAt: new Date().toISOString(),
                  version: item.version + 1,
                }
              : item,
          ),
        };
      });

      return { previousIssues };
    },
    onError: (_error, _variables, context) => {
      if (context?.previousIssues) {
        queryClient.setQueryData(issuesKey, context.previousIssues);
      }
    },
    onSuccess: async (_, variables) => {
      await invalidateBoard(queryClient, projectId, variables.movedIssueId);
    },
  });

  const markAllRead = useMutation({
    mutationFn: () => taskaApi.markAllNotificationsRead(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const hasFilters = Boolean(query || typeFilter !== "ALL" || assigneeFilter !== "ALL" || labelFilter !== "ALL");
  const unreadCount = notificationsQuery.data?.items.filter((item) => !item.readAt).length ?? 0;
  const activeIssue = activeIssueId ? issues.find((item) => item.id === activeIssueId) : undefined;

  const handleDragStart = (event: DragStartEvent) => {
    // Both event notices are about the drag that came before this one. Picking
    // a card up is the moment they stop being news, and a mutation error never
    // clears itself — one failed drop used to leave a permanent block of the
    // board's own height behind it.
    setDragNotice(null);
    if (transitionIssue.isError) transitionIssue.reset();
    setActiveIssueId(String(event.active.id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const overId = event.over?.id;
    const activeId = String(event.active.id);
    if (!overId) {
      setActiveIssueId(null);
      return;
    }
    const nextStatus = String(overId) as IssueStatus;
    const issue = issues.find((item) => item.id === activeId);
    if (!issue || issue.status === nextStatus) {
      setActiveIssueId(null);
      return;
    }
    const workflow = workflowQuery.data?.[issue.issueType];
    // No fallback on this path, ever. The only transition ids this repository
    // owns are the mock's seed, and posting one to a gateway that never
    // described it invents a transition — the drop is refused instead, whether
    // the workflow read failed or has simply not answered yet.
    if (!workflow) {
      setDragNotice(`${issue.issueKey} was not moved: this project's workflow could not be loaded.`);
      setActiveIssueId(null);
      return;
    }
    const transition = findTransition(issue.status, nextStatus, workflow.statuses, workflow.transitions);
    if (transition) {
      transitionIssue.mutate({ movedIssueId: issue.id, nextStatus, transitionId: transition.id });
    } else {
      setDragNotice(
        `${issue.issueKey}: no transition from ${statusLabels[issue.status]} to ${statusLabels[nextStatus]} in this workflow`,
      );
    }
    setActiveIssueId(null);
  };

  // A board URL can point at a project that does not exist or is not ours; the
  // `*` fallback route never sees it, because the path itself is valid.
  // DESIGN.md §4.18 answers both with the same screen. This sits below every
  // hook on purpose — returning earlier would make the hook order conditional.
  //
  // Read from the same fact as every banner below rather than from `isError`:
  // a refetch of a query with no data resets it to `pending` with the error
  // cleared, and this branch would then hand back the project's own chrome —
  // its name, its filters, its columns — to someone the gateway has already
  // said may not see it, until the answer came back and took it away again.
  if (projectUnread.unanswered && isMissingOrForbidden(projectUnread.error)) {
    return <NotFoundScreen />;
  }

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
        <UserProfileMenu
          user={meQuery.data}
          loading={meQuery.isPending}
          loggingOut={logoutPending}
          onLogout={onLogout}
        />
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
        <span className="divider" />
        {/* A failed label read is said here rather than in the notice stack
            above: the stack is capped at four (§5.6) and this costs the board
            nothing but a filter. Saying nothing would leave a picker offering
            only "All" and looking like a project that has no labels. */}
        {labelsUnread.unanswered ? (
          <span className="filter-note">Labels could not be loaded</span>
        ) : (
          <label className="filter-select">
            <span className="filter-label">Label</span>
            <select onChange={(event) => setLabelFilter(event.target.value)} value={labelFilter}>
              <option value="ALL">All</option>
              {projectLabels.map((label) => (
                <option key={label.id} value={label.id}>
                  {label.name || "Unnamed label"}
                </option>
              ))}
            </select>
          </label>
        )}
        {isProjectAdmin ? (
          <button className="icon-button" onClick={() => setManagingLabels(true)} title="Manage labels" type="button">
            <Tag size={15} />
          </button>
        ) : null}
        <div className="topbar-spacer" />
        {hasFilters ? (
          <button
            className="clear-button"
            onClick={() => {
              setQuery("");
              setTypeFilter("ALL");
              setAssigneeFilter("ALL");
              setLabelFilter("ALL");
            }}
            type="button"
          >
            <X size={13} />
            Clear
          </button>
        ) : null}
        {/* Three states again, and for the same reason as the cards on the
            projects screen: "0 of 0" from a request that has not answered is a
            claim about the project, not a count. Unknown first — a retry of a
            failed read is `pending` again, and the failure is the stabler
            statement of the two. */}
        <span className="counter">
          {issuesUnknown ? (
            <>
              <Unknown /> of <Unknown />
            </>
          ) : issuesQuery.isPending ? (
            <>
              <PendingValue /> of <PendingValue />
            </>
          ) : (
            `${filteredIssues.length} of ${issues.length}`
          )}
        </span>
      </section>

      {/* One container, capped, so the board keeps most of the plane whatever
          fails. As five loose siblings these took 54% of a 900px viewport and
          75% of a 640px one, and at 390x640 the columns collapsed to 24px
          behind an overflow nothing could scroll to. Four is now the ceiling —
          the two event notices below are both cleared when a drag starts, and
          one drag raises at most one of them — but the cap is what makes the
          count stop mattering. */}
      {projectUnread.unanswered ||
      roleUnknown ||
      issuesUnknown ||
      workflowUnknown ||
      transitionIssue.isError ||
      dragNotice ? (
        // Labelled and focusable: with no request id in any of them the stack
        // can outgrow its cap with nothing focusable inside, and only Chrome
        // focuses a scroller of its own accord — in Firefox and Safari the
        // banners below the fold would be unreachable from the keyboard.
        <section aria-label="Board problems" className="board-notices" tabIndex={0}>
          {projectUnread.unanswered ? (
            <ApiNotice error={projectUnread.error}>
              This project&apos;s details could not be loaded, so its name and key are missing above.
            </ApiNotice>
          ) : null}
          {roleUnknown ? (
            <ApiNotice error={roleUnread.error}>
              Your role could not be loaded, so editing is off — a failed read, not a read-only project.
            </ApiNotice>
          ) : null}
          {issuesUnknown ? (
            <ApiNotice error={issuesUnread.error}>The issues on this board could not be loaded.</ApiNotice>
          ) : null}
          {workflowUnknown ? (
            <ApiNotice error={workflowUnread.error}>
              This project&apos;s workflow could not be loaded, so no card can be moved.
            </ApiNotice>
          ) : null}
          {/* The two below are events, not states of the screen: a rollback and
              a refused drop. An event that cannot be dismissed is how a stack
              this tall becomes permanent. */}
          {transitionIssue.isError ? (
            <ApiNotice
              dismiss={{ label: "Dismiss the failed move", onDismiss: () => transitionIssue.reset() }}
              error={transitionIssue.error}
            >
              The move could not be saved, so the card went back where it was.
            </ApiNotice>
          ) : null}
          {dragNotice ? (
            <ApiNotice dismiss={{ label: "Dismiss the refused move", onDismiss: () => setDragNotice(null) }}>
              {dragNotice}
            </ApiNotice>
          ) : null}
        </section>
      ) : null}

      <DndContext sensors={sensors} onDragCancel={() => setActiveIssueId(null)} onDragEnd={handleDragEnd} onDragStart={handleDragStart}>
        <section className="columns-area">
          {/* A read that has already failed goes back to `isLoading` on every
              retry, so without the first clause the columns explained by the
              banner above would swap themselves for skeletons on a timer. */}
          {!issuesUnknown && (workflowQuery.isLoading || issuesQuery.isLoading)
            ? statuses.map((status) => <ColumnSkeleton key={status.statusKey} status={status} />)
            : statuses.map((status) => (
                <BoardColumn
                  key={status.statusKey}
                  status={status}
                  issues={filteredIssues.filter((issue) => issue.status === status.statusKey)}
                  issuesUnknown={issuesUnknown}
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
          // Remount when the panel changes issue. Since TAS-157 a link row can
          // swap `issueId` while this instance stays mounted, and without the
          // key every piece of per-issue state — the comment draft above all,
          // which would be posted onto the issue it was not written for —
          // survives the navigation. This is not the reseed the drafts inside
          // the panel avoid: those must not remount on a *refetch*, and
          // `issueId` cannot change mid-edit.
          key={issueId}
          issueId={issueId}
          projectId={projectId}
          issues={issues}
          members={members}
          userById={userById}
          canEdit={canEdit}
          currentUserId={meQuery.data?.id}
          workflows={workflowQuery.data}
          workflowUnknown={workflowUnknown}
          onClose={() => navigate(`/projects/${projectId}/board`)}
        />
      ) : null}

      {managingLabels ? (
        <ProjectLabelsModal
          projectId={projectId}
          projectKey={project?.projectKey ?? ""}
          onClose={() => setManagingLabels(false)}
          // A filter pointing at a label that no longer exists would ask the
          // gateway for the issues of a deleted label and get an empty board
          // back — an answer indistinguishable from "nothing carries it".
          onLabelDeleted={(labelId) => setLabelFilter((current) => (current === labelId ? "ALL" : current))}
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

/**
 * The columns to draw before the workflow has been read, and after a read that
 * failed. These are safe to invent because they are not inventions: the three
 * keys are `IssueStatus` from the contract, the issues already carry one each,
 * and a board has to put them somewhere. Only the labels and the order are
 * ours.
 *
 * There is deliberately no matching `fallbackTransitions` any more. It used to
 * sit beside this and carry four ids copied from the mock's seed, which the
 * drop path and the panel's transition buttons both read whenever
 * `workflowQuery.data` was undefined — so a board whose workflow read failed
 * offered moves the gateway had never described and posted their ids as if it
 * had. A status is a fact the issue already states; a transition is a claim
 * about the server, and this file has no honest source for one.
 */
const fallbackStatuses: WorkflowStatus[] = [
  { id: "fallback-todo", statusKey: "TODO", name: "To Do", category: "TODO", sortOrder: 10 },
  { id: "fallback-progress", statusKey: "IN_PROGRESS", name: "In Progress", category: "IN_PROGRESS", sortOrder: 20 },
  { id: "fallback-done", statusKey: "DONE", name: "Done", category: "DONE", sortOrder: 30 },
];

function BoardColumn({
  status,
  issues,
  issuesUnknown,
  userById,
  canEdit,
  onAdd,
  onOpenIssue,
}: {
  status: WorkflowStatus;
  issues: Issue[];
  /** The issue list never arrived: this column knows nothing about its contents. */
  issuesUnknown: boolean;
  userById: Map<string, Pick<User, "displayName" | "color">>;
  canEdit: boolean;
  onAdd: () => void;
  onOpenIssue: (issueId: string) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: status.statusKey, disabled: !canEdit });

  // A named section rather than a bare div: each column is a landmark a screen
  // reader can jump between, and the drop target stops being anonymous.
  return (
    <section aria-label={`${status.name} column`} className={`board-column ${isOver ? "is-over" : ""}`} ref={setNodeRef}>
      <div className="column-head">
        <span className="status-dot" style={{ background: statusColors[status.statusKey] }} />
        <strong>{status.name}</strong>
        <span className="count-pill">{issuesUnknown ? <Unknown /> : issues.length}</span>
        <button className="icon-button mini" disabled={!canEdit} onClick={onAdd} title="Create issue" type="button">
          <Plus size={13} />
        </button>
      </div>
      <div className="issue-list">
        {issues.map((issue) => (
          <IssueCard
            key={issue.id}
            issue={issue}
            user={issue.assigneeId ? userById.get(issue.assigneeId) : null}
            canEdit={canEdit}
            onOpen={onOpenIssue}
          />
        ))}
        {/* Three different empty columns. A column whose contents are unknown
            must not invite a card, and the dashed frame §5.6 gives the empty
            state is exactly that invitation; a reader who cannot drop one must
            not be told to either (§5.7) — the same promise the card itself has
            stopped making. */}
        {issuesUnknown ? (
          <div className="empty-column is-unknown">Not loaded</div>
        ) : issues.length === 0 ? (
          <div className="empty-column">{canEdit ? "Drop issues here" : "No issues"}</div>
        ) : null}
      </div>
    </section>
  );
}

function IssueCard({
  issue,
  user,
  canEdit,
  onOpen,
}: {
  issue: Issue;
  user?: Pick<User, "displayName" | "color"> | null;
  canEdit: boolean;
  onOpen: (issueId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: issue.id, disabled: !canEdit });

  // Neither `listeners` nor `attributes` when this board cannot be written to
  // (§5.7). `attributes` does carry `aria-disabled`, but it also carries
  // `aria-roledescription="draggable"` and an `aria-describedby` telling the
  // reader to press the space bar — an instruction no sensor here implements,
  // for a gesture the server would refuse. Both objects are ours to spread or
  // not, so a viewer's card is simply a button that opens an issue: nothing
  // lifts, nothing is announced as draggable, nothing is promised.
  return (
    <button
      className={`issue-card ${canEdit ? "" : "is-static"} ${isDragging ? "is-dragging" : ""}`}
      onClick={() => onOpen(issue.id)}
      ref={setNodeRef}
      type="button"
      {...(canEdit ? listeners : null)}
      {...(canEdit ? attributes : null)}
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
      {issue.labels.length ? (
        <span className="issue-card-labels">
          {issue.labels.map((label) => (
            <LabelChip key={label.id || label.name} label={label} />
          ))}
        </span>
      ) : null}
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
  issues,
  members,
  userById,
  canEdit,
  currentUserId,
  workflows,
  workflowUnknown,
  onClose,
}: {
  projectId: string;
  issueId: string;
  /** The board's `["issues", projectId]` page — the links section resolves its
   *  targets from it rather than fetching each linked issue again. */
  issues: Issue[];
  members: ProjectMember[];
  userById: Map<string, Pick<User, "displayName" | "color">>;
  canEdit: boolean;
  currentUserId?: string;
  workflows?: WorkflowsByIssueType;
  /** The workflow read failed; these buttons are the keyboard path a drag has. */
  workflowUnknown: boolean;
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

  // Reseed the drafts whenever the server copy changes. Done during render
  // rather than from an effect: the effect version cost an extra render pass
  // on every refetch. A key-based remount would reset focus mid-edit, which
  // this does not.
  const serverSummary = issue?.summary ?? "";
  const serverDescription = issue?.description ?? "";
  const [synced, setSynced] = useState<{ summary: string; description: string } | null>(null);
  if (!synced || synced.summary !== serverSummary || synced.description !== serverDescription) {
    setSynced({ summary: serverSummary, description: serverDescription });
    setSummary(serverSummary);
    setDescription(serverDescription);
  }

  const workflow = issue ? workflows?.[issue.issueType] : undefined;
  // These buttons are the drag's keyboard equivalent (§5.3), so they answer to
  // the same rule as the drop: only the server's own transitions, never the
  // fallback's. Offering a move built from an invented id would post that id.
  const availableTransitions =
    issue && workflow ? resolveTransitions(issue.status, workflow.statuses, workflow.transitions) : [];

  const updateIssue = useMutation({
    mutationFn: (patch: { summary?: string; description?: string; priority?: IssuePriority }) => taskaApi.updateIssue(projectId, issueId, patch),
    onSuccess: () => invalidateBoard(queryClient, projectId, issueId),
  });
  const assignIssue = useMutation({
    mutationFn: (assigneeId: string | null) => taskaApi.assignIssue(projectId, issueId, assigneeId),
    onSuccess: () => invalidateBoard(queryClient, projectId, issueId),
  });
  const transitionIssue = useMutation({
    mutationFn: (transitionId: string) => taskaApi.transitionIssue(projectId, issueId, transitionId),
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
          <div className={`panel-loading ${issueQuery.isError ? "form-error" : ""}`}>
            {issueQuery.isError ? issueQuery.error.message : "Loading issue"}
          </div>
        </aside>
      </div>
    );
  }

  const reporter = userById.get(issue.reporterId);

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
            {availableTransitions.length ? <span className="arrow">→</span> : null}
            {/* Said here as well as on the board behind this panel: the panel
                covers the notice stack, and an empty row beside a status pill
                reads as "this issue has nowhere to go" rather than "we do not
                know where it can go". */}
            {workflowUnknown ? (
              <span className="transition-note">The workflow could not be loaded, so no move is offered.</span>
            ) : null}
            {availableTransitions.map((transition) => (
              <button
                className="secondary-button compact-button"
                disabled={!canEdit || transitionIssue.isPending}
                key={transition.id}
                onClick={() => transitionIssue.mutate(transition.id)}
                type="button"
              >
                {transition.name}
              </button>
            ))}
          </div>

          <div className="meta-grid">
            <span>Assignee</span>
            <div className="chip-row">
              <AssigneeChip active={!issue.assigneeId} label="None" onClick={() => undefined} user={null} disabled />
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

          {updateIssue.isError || assignIssue.isError || transitionIssue.isError || deleteIssue.isError ? (
            <div className="form-error">
              {(updateIssue.error ?? assignIssue.error ?? transitionIssue.error ?? deleteIssue.error)?.message}
            </div>
          ) : null}

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

          <IssueLabelsSection projectId={projectId} issueId={issueId} canEdit={canEdit} />

          <IssueLinksSection projectId={projectId} issueId={issueId} issues={issues} canEdit={canEdit} />

          <CommentsSection
            projectId={projectId}
            issueId={issueId}
            canComment={canEdit}
            currentUserId={currentUserId}
            userById={userById}
          />

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

/**
 * `GET/POST/DELETE /projects/{projectId}/issues/{issueId}/labels`, read beside
 * the project's own list so the picker only offers labels this issue does not
 * already carry.
 *
 * The section owns its labels query rather than reading `issue.labels` off the
 * panel's detail response, for the same reason the links section owns its own:
 * the writes here are about *this* list, and an optimistic add against a field
 * of the issue would mean rewriting the issue to show one chip. The detail
 * read's copy is not wasted — it is what the board's cards draw.
 */
function IssueLabelsSection({
  projectId,
  issueId,
  canEdit,
}: {
  projectId: string;
  issueId: string;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState("");

  const labelsKey = ["issue-labels", projectId, issueId];
  const labelsQuery = useQuery({
    queryKey: labelsKey,
    queryFn: () => taskaApi.listIssueLabels(projectId, issueId),
    retry: retryUnlessMissing,
  });
  // Same key the board and the manage modal use, so all three share one read.
  const projectLabelsQuery = useQuery({
    queryKey: ["project-labels", projectId],
    queryFn: () => taskaApi.listProjectLabels(projectId),
    retry: retryUnlessMissing,
  });

  const labels = useMemo(() => labelsQuery.data ?? [], [labelsQuery.data]);
  const projectLabels = useMemo(() => projectLabelsQuery.data ?? [], [projectLabelsQuery.data]);
  const attached = useMemo(() => new Set(labels.map((label) => label.id)), [labels]);
  const attachable = projectLabels.filter((label) => !attached.has(label.id));

  // One write, three stale caches: this list, the panel's issue, and the board
  // cards that draw `issue.labels` from the list read behind them.
  const settle = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: labelsKey }),
      queryClient.invalidateQueries({ queryKey: ["issues", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["issue", projectId, issueId] }),
    ]);

  const addLabel = useMutation({
    mutationFn: (labelId: string) => taskaApi.addIssueLabel(projectId, issueId, labelId),
    onMutate: async (labelId) => {
      await queryClient.cancelQueries({ queryKey: labelsKey });
      const previous = queryClient.getQueryData<Label[]>(labelsKey);
      // No placeholder id, unlike the links section: the label came out of a
      // list this component is holding, so the optimistic chip *is* the label
      // and there is nothing for the server's answer to reconcile.
      const chosen = projectLabels.find((label) => label.id === labelId);
      if (chosen) {
        queryClient.setQueryData<Label[]>(labelsKey, (current) => [
          ...(current ?? []),
          { id: chosen.id, name: chosen.name, color: chosen.color },
        ]);
      }
      return { previous };
    },
    onError: (_error, _labelId, context) => {
      if (context?.previous) queryClient.setQueryData(labelsKey, context.previous);
    },
    onSuccess: () => setPicked(""),
    onSettled: settle,
  });

  const removeLabel = useMutation({
    mutationFn: (labelId: string) => taskaApi.removeIssueLabel(projectId, issueId, labelId),
    onMutate: async (labelId) => {
      await queryClient.cancelQueries({ queryKey: labelsKey });
      const previous = queryClient.getQueryData<Label[]>(labelsKey);
      queryClient.setQueryData<Label[]>(labelsKey, (current) =>
        (current ?? []).filter((label) => label.id !== labelId),
      );
      return { previous };
    },
    onError: (_error, _labelId, context) => {
      if (context?.previous) queryClient.setQueryData(labelsKey, context.previous);
    },
    onSettled: settle,
  });

  const error = (labelsQuery.error ?? projectLabelsQuery.error ?? addLabel.error ?? removeLabel.error)?.message;

  return (
    <section className="issue-labels">
      <h3>
        Labels
        {labels.length ? <span className="count-pill">{labels.length}</span> : null}
      </h3>

      {canEdit ? (
        <form
          className="issue-label-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (picked) addLabel.mutate(picked);
          }}
        >
          <label className="issue-link-field issue-link-target">
            <span>Add label</span>
            <select
              disabled={attachable.length === 0}
              onChange={(event) => setPicked(event.target.value)}
              value={picked}
            >
              <option value="">Select a label</option>
              {attachable.map((label) => (
                <option key={label.id} value={label.id}>
                  {label.name || "Unnamed label"}
                </option>
              ))}
            </select>
          </label>
          <button className="secondary-button compact-button" disabled={!picked || addLabel.isPending} type="submit">
            Add
          </button>
        </form>
      ) : null}

      {/* Only a successful read may say the project has none — an empty picker
          after a failed one would read as "there are no labels to add". */}
      {canEdit && projectLabelsQuery.isSuccess && projectLabels.length === 0 ? (
        <p className="issue-links-empty">This project has no labels yet.</p>
      ) : null}

      {error ? <div className="form-error">{error}</div> : null}

      {labelsQuery.isPending ? <p className="issue-links-empty">Loading labels</p> : null}
      {labelsQuery.isSuccess && labels.length === 0 ? <p className="issue-links-empty">No labels yet</p> : null}

      {labels.length ? (
        <div className="label-chip-row">
          {labels.map((label) => (
            <LabelChip
              key={label.id || label.name}
              label={label}
              // A label the response left unaddressable cannot be removed: the
              // request would name no label. The chip still shows — the label
              // is on the issue either way.
              onRemove={canEdit && label.id ? () => removeLabel.mutate(label.id) : undefined}
              removeDisabled={removeLabel.isPending && removeLabel.variables === label.id}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

/**
 * `GET/POST/DELETE /issues/{issueId}/links`. Two things are worth knowing here:
 *
 * 1. Which issue a row points at is decided by comparing both ends against the
 *    issue on screen, never by trusting `targetIssueId` — the response is the
 *    link as *this* issue sees it, and the issue on the receiving side of a
 *    `BLOCKS` is the link's `targetIssueId`, not its own.
 * 2. `viewLinkType` is an open string (see `IssueLink`), so it is only ever
 *    passed to `issueLinkTypeLabel`, which prints an unknown relation instead
 *    of dropping the row.
 */
/**
 * Id of the row an optimistic create puts in the cache before the server has
 * answered. No link on the server can carry it, and it is deliberately not the
 * empty string: that is what a response omitting `id` produces, and "not real
 * yet" and "real but unaddressable" are different states.
 */
const optimisticLinkId = "tk-optimistic-link";

function IssueLinksSection({
  projectId,
  issueId,
  issues,
  canEdit,
}: {
  projectId: string;
  issueId: string;
  issues: Issue[];
  canEdit: boolean;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const relationLabelId = useId();
  const [linkType, setLinkType] = useState<IssueLinkType>("BLOCKS");
  const [targetIssueId, setTargetIssueId] = useState("");
  // Refused before the request goes out; the server stays the authority.
  const [localError, setLocalError] = useState<string | null>(null);

  const linksKey = ["issue-links", projectId, issueId];
  const linksQuery = useQuery({
    queryKey: linksKey,
    queryFn: () => taskaApi.listIssueLinks(projectId, issueId),
    // Same predicate as every other board query. It matters more here than it
    // looks: this gateway has already been seen answering an empty collection
    // with NOT_FOUND (`GET /projects`, docs/ai/API-DIVERGENCE.md), and if the
    // link routes share the habit, an issue with no links would spend a retry
    // delay before showing a red error where a quiet line belongs.
    retry: retryUnlessMissing,
  });
  const links = useMemo(() => linksQuery.data ?? [], [linksQuery.data]);

  // Both ends of a link change when one is written, and the user can walk
  // straight to the other end — so the whole project's links are refetched, not
  // just this issue's.
  const invalidateLinks = () => queryClient.invalidateQueries({ queryKey: ["issue-links", projectId] });

  const createLink = useMutation({
    mutationFn: (input: CreateIssueLinkInput) => taskaApi.createIssueLink(projectId, issueId, input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: linksKey });
      const previousLinks = queryClient.getQueryData<IssueLink[]>(linksKey);
      queryClient.setQueryData<IssueLink[]>(linksKey, (current) => [
        ...(current ?? []),
        {
          // A marker of its own rather than an empty id: an empty id is what a
          // server that omitted the field gives us, and the two states mean
          // different things — this row has no link behind it *yet*, that one
          // has a link nobody can address.
          id: optimisticLinkId,
          projectId,
          sourceIssueId: issueId,
          targetIssueId: input.targetIssueId,
          viewLinkType: input.linkType,
          createdBy: "",
          createdAt: new Date().toISOString(),
        },
      ]);
      return { previousLinks };
    },
    onError: (_error, _input, context) => {
      if (context?.previousLinks) {
        queryClient.setQueryData(linksKey, context.previousLinks);
      }
    },
    onSuccess: () => setTargetIssueId(""),
    onSettled: invalidateLinks,
  });

  const deleteLink = useMutation({
    mutationFn: (linkId: string) => taskaApi.deleteIssueLink(projectId, issueId, linkId),
    onMutate: async (linkId) => {
      await queryClient.cancelQueries({ queryKey: linksKey });
      const previousLinks = queryClient.getQueryData<IssueLink[]>(linksKey);
      queryClient.setQueryData<IssueLink[]>(linksKey, (current) =>
        (current ?? []).filter((link) => link.id !== linkId),
      );
      return { previousLinks };
    },
    onError: (_error, _linkId, context) => {
      if (context?.previousLinks) {
        queryClient.setQueryData(linksKey, context.previousLinks);
      }
    },
    onSettled: invalidateLinks,
  });

  const issueById = useMemo(() => new Map(issues.map((item) => [item.id, item])), [issues]);
  const linkedIssueIds = useMemo(
    () => new Set(links.map((link) => otherEndOf(link, issueId))),
    [links, issueId],
  );
  const linkable = issues.filter((item) => item.id !== issueId && !linkedIssueIds.has(item.id));
  const error = localError ?? (linksQuery.error ?? createLink.error ?? deleteLink.error)?.message;

  return (
    <section className="issue-links">
      <h3>
        Links
        {links.length ? <span className="count-pill">{links.length}</span> : null}
      </h3>

      {canEdit ? (
        <form
          className="issue-link-form"
          onSubmit={(event) => {
            event.preventDefault();
            setLocalError(null);
            if (!targetIssueId) return;
            if (targetIssueId === issueId) {
              setLocalError("An issue cannot be linked to itself.");
              return;
            }
            createLink.mutate({ targetIssueId, linkType });
          }}
        >
          <div className="issue-link-field">
            <span id={relationLabelId}>Relation</span>
            <div aria-labelledby={relationLabelId} className="segmented compact fit" role="group">
              {issueLinkTypes.map((type) => (
                <button
                  aria-pressed={linkType === type}
                  className={linkType === type ? "is-active" : ""}
                  key={type}
                  onClick={() => setLinkType(type)}
                  type="button"
                >
                  {issueLinkTypeLabel(type)}
                </button>
              ))}
            </div>
          </div>
          <label className="issue-link-field issue-link-target">
            <span>Issue</span>
            <select onChange={(event) => setTargetIssueId(event.target.value)} value={targetIssueId}>
              <option value="">Select an issue</option>
              {linkable.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.issueKey} — {item.summary}
                </option>
              ))}
            </select>
          </label>
          <button
            className="secondary-button compact-button"
            disabled={!targetIssueId || createLink.isPending}
            type="submit"
          >
            Link
          </button>
        </form>
      ) : null}

      {error ? <div className="form-error">{error}</div> : null}

      {linksQuery.isPending ? <p className="issue-links-empty">Loading links</p> : null}
      {/* Only a *successful* empty answer may say this. An errored query also
          has no data, and "nothing is linked here" is a claim a failed request
          never made — one a reader would act on. */}
      {linksQuery.isSuccess && links.length === 0 ? <p className="issue-links-empty">No links yet</p> : null}

      <ul className="issue-link-list">
        {links.map((link) => {
          const otherId = otherEndOf(link, issueId);
          const other = issueById.get(otherId);
          const pending = link.id === optimisticLinkId;
          return (
            <li className="issue-link-row" key={link.id || `${link.sourceIssueId}:${link.targetIssueId}`}>
              {otherId ? (
                <button
                  className="issue-link-open"
                  // The link states its own project, and these routes are
                  // issue-scoped on the wire, so a link may point outside the
                  // board being viewed. The mock cannot produce one, which is
                  // exactly why this must not be assumed away.
                  onClick={() => navigate(`/projects/${link.projectId || projectId}/issues/${otherId}`)}
                  type="button"
                >
                  <span className="issue-link-relation">{issueLinkTypeLabel(link.viewLinkType)}</span>
                  {/* The key is what a person recognises; an issue outside the
                      loaded page has none, and its raw id is still truer than a
                      blank row — it just has to be allowed to ellipsize. */}
                  <span className={`issue-key ${other ? "" : "is-unresolved"}`}>
                    {other?.issueKey ?? otherId}
                  </span>
                  {other ? <span className="issue-link-summary">{other.summary}</span> : null}
                </button>
              ) : (
                // `IssueLinkResponseDto` marks nothing required, so a link can
                // arrive naming neither of its ends. There is nowhere to go:
                // the row says what it knows rather than offering a click that
                // resolves to no issue.
                <span className="issue-link-open is-inert">
                  <span className="issue-link-relation">{issueLinkTypeLabel(link.viewLinkType)}</span>
                  <span className="issue-link-summary">Unknown issue</span>
                </span>
              )}
              {canEdit ? (
                <button
                  aria-label={`Remove link to ${other?.issueKey ?? (otherId || "an unknown issue")}`}
                  className="icon-button"
                  // Scoped to this row: one delete in flight is no reason for
                  // every other row to stop answering. `isPending` has to be in
                  // the test — `variables` holds the last mutation's argument
                  // after it settles, so a failed delete would otherwise leave
                  // its restored row disabled for good.
                  disabled={pending || !link.id || (deleteLink.isPending && deleteLink.variables === link.id)}
                  onClick={() => {
                    setLocalError(null);
                    deleteLink.mutate(link.id);
                  }}
                  type="button"
                >
                  <X size={14} />
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * The end of the link that is not the issue being looked at. `sourceIssueId`
 * and `targetIssueId` name the ends the link was *created* with, so on the
 * receiving side of a `BLOCKS` the issue on screen is the target and the row
 * must point at the source.
 */
function otherEndOf(link: IssueLink, issueId: string) {
  return link.targetIssueId === issueId ? link.sourceIssueId : link.targetIssueId;
}

function CommentsSection({
  projectId,
  issueId,
  canComment,
  currentUserId,
  userById,
}: {
  projectId: string;
  issueId: string;
  canComment: boolean;
  currentUserId?: string;
  userById: Map<string, Pick<User, "displayName" | "color">>;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  const commentsQuery = useInfiniteQuery({
    queryKey: ["comments", projectId, issueId],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => taskaApi.listComments(projectId, issueId, { page: pageParam, pageSize: commentsPageSize }),
    getNextPageParam: (lastPage, pages) => {
      const loaded = pages.reduce((total, page) => total + page.items.length, 0);
      return lastPage.items.length > 0 && loaded < (lastPage.totalCount ?? loaded) ? pages.length : undefined;
    },
  });

  // Comment mutations also append to the issue history, so the activity feed has to refetch.
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["comments", projectId, issueId] }),
      queryClient.invalidateQueries({ queryKey: ["issue", projectId, issueId] }),
    ]);

  const addComment = useMutation({
    mutationFn: (body: string) => taskaApi.addComment(projectId, issueId, body),
    onSuccess: async () => {
      setDraft("");
      await refresh();
    },
  });
  const updateComment = useMutation({
    mutationFn: ({ commentId, body }: { commentId: string; body: string }) =>
      taskaApi.updateComment(projectId, issueId, commentId, body),
    onSuccess: async () => {
      setEditingId(null);
      await refresh();
    },
  });
  const deleteComment = useMutation({
    mutationFn: (commentId: string) => taskaApi.deleteComment(projectId, issueId, commentId),
    onSuccess: refresh,
  });

  const comments = commentsQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const totalCount = commentsQuery.data?.pages[0]?.totalCount ?? comments.length;
  const mutationError = addComment.error ?? updateComment.error ?? deleteComment.error;

  return (
    <section className="comments">
      <h3>
        Comments
        {totalCount ? <span className="count-pill">{totalCount}</span> : null}
      </h3>

      {canComment ? (
        <form
          className="comment-composer"
          onSubmit={(event) => {
            event.preventDefault();
            if (draft.trim()) addComment.mutate(draft.trim());
          }}
        >
          <textarea
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Leave a comment"
            rows={3}
            value={draft}
          />
          <div className="comment-composer-actions">
            <button className="primary-button compact-button" disabled={!draft.trim() || addComment.isPending} type="submit">
              Comment
            </button>
          </div>
        </form>
      ) : null}

      {commentsQuery.isError ? <div className="form-error">{commentsQuery.error.message}</div> : null}
      {mutationError ? <div className="form-error">{mutationError.message}</div> : null}

      {commentsQuery.isPending ? <p className="comments-empty">Loading comments</p> : null}
      {!commentsQuery.isPending && comments.length === 0 ? <p className="comments-empty">No comments yet</p> : null}

      {comments.map((comment) => (
        <CommentItem
          // Entering or leaving edit mode remounts the row, which reseeds the
          // draft from the current comment body. Same reset the component used
          // to do from an effect, without the cascading render.
          key={`${comment.id}:${editingId === comment.id}`}
          comment={comment}
          author={userById.get(comment.authorUserId)}
          canManage={canComment && comment.authorUserId === currentUserId}
          editing={editingId === comment.id}
          pending={updateComment.isPending || deleteComment.isPending}
          onStartEdit={() => setEditingId(comment.id)}
          onCancelEdit={() => setEditingId(null)}
          onSave={(body) => updateComment.mutate({ commentId: comment.id, body })}
          onDelete={() => deleteComment.mutate(comment.id)}
        />
      ))}

      {commentsQuery.hasNextPage ? (
        <button
          className="secondary-button compact-button"
          disabled={commentsQuery.isFetchingNextPage}
          onClick={() => commentsQuery.fetchNextPage()}
          type="button"
        >
          {commentsQuery.isFetchingNextPage ? "Loading" : "Load older comments"}
        </button>
      ) : null}
    </section>
  );
}

function CommentItem({
  comment,
  author,
  canManage,
  editing,
  pending,
  onStartEdit,
  onCancelEdit,
  onSave,
  onDelete,
}: {
  comment: IssueComment;
  author?: Pick<User, "displayName" | "color">;
  canManage: boolean;
  editing: boolean;
  pending: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: (body: string) => void;
  onDelete: () => void;
}) {
  // Seeded once per mount. The parent's key includes the editing flag, so
  // toggling edit mode remounts this row with a fresh draft.
  const [body, setBody] = useState(comment.body);

  return (
    <article className="comment-item">
      <Avatar user={author} size="sm" />
      <div className="comment-main">
        <p className="comment-head">
          <strong>{author?.displayName ?? "Unknown"}</strong>
          <time>{formatDateTime(comment.createdAt)}</time>
          {comment.updatedAt ? <em>edited</em> : null}
        </p>

        {editing ? (
          <>
            <textarea onChange={(event) => setBody(event.target.value)} rows={3} value={body} autoFocus />
            <div className="comment-actions">
              <button
                className="primary-button compact-button"
                disabled={!body.trim() || body.trim() === comment.body || pending}
                onClick={() => onSave(body.trim())}
                type="button"
              >
                Save
              </button>
              <button className="secondary-button compact-button" onClick={onCancelEdit} type="button">
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="comment-text">{comment.body}</p>
            {canManage ? (
              <div className="comment-actions">
                <button className="link-button" onClick={onStartEdit} type="button">
                  Edit
                </button>
                <button className="link-button" disabled={pending} onClick={onDelete} type="button">
                  Delete
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </article>
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

/**
 * Id the optimistic row of a create carries until the server answers with the
 * real one. Same idea as `optimisticLinkId`, and deliberately not the empty
 * string: a label whose `id` the response omitted is real but unaddressable,
 * which is a different state from one that does not exist yet.
 */
const optimisticLabelId = "tk-optimistic-label";

/**
 * `POST/PATCH/DELETE /projects/{projectId}/labels` — the project's own list,
 * which is what the issue picker draws from.
 *
 * ADMIN-only by TAS-119, which is why the board only offers the button that
 * opens this. That is presentation: the gateway refuses the three writes for
 * everyone else regardless, and nothing here treats the hidden button as the
 * permission.
 */
function ProjectLabelsModal({
  projectId,
  projectKey,
  onClose,
  onLabelDeleted,
}: {
  projectId: string;
  projectKey: string;
  onClose: () => void;
  onLabelDeleted: (labelId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [color, setColor] = useState(labelColorChoices[0]);
  const [editing, setEditing] = useState<{ id: string; name: string; color: string } | null>(null);

  const labelsKey = ["project-labels", projectId];
  const labelsQuery = useQuery({
    queryKey: labelsKey,
    queryFn: () => taskaApi.listProjectLabels(projectId),
    retry: retryUnlessMissing,
  });
  const labels = useMemo(() => labelsQuery.data ?? [], [labelsQuery.data]);

  // A rename or a recolour changes every chip drawn from these labels, and a
  // delete takes the label off every issue that carried it (the contract's
  // soft delete), so the issue lists and the board go with them.
  const settle = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: labelsKey }),
      queryClient.invalidateQueries({ queryKey: ["issue-labels", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["issues", projectId] }),
    ]);

  const createLabel = useMutation({
    mutationFn: (input: CreateProjectLabelInput) => taskaApi.createProjectLabel(projectId, input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: labelsKey });
      const previous = queryClient.getQueryData<ProjectLabel[]>(labelsKey);
      queryClient.setQueryData<ProjectLabel[]>(labelsKey, (current) => [
        ...(current ?? []),
        {
          id: optimisticLabelId,
          projectId,
          name: input.name,
          color: input.color,
          createdBy: "",
          createdAt: new Date().toISOString(),
          deletedAt: null,
        },
      ]);
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(labelsKey, context.previous);
    },
    onSuccess: () => setName(""),
    onSettled: settle,
  });

  const updateLabel = useMutation({
    mutationFn: (input: { id: string; name: string; color: string }) =>
      // Both fields every time: the contract requires `name` and `color` on the
      // PATCH, so a recolour resends the name it is keeping.
      taskaApi.updateProjectLabel(projectId, input.id, { name: input.name, color: input.color }),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: labelsKey });
      const previous = queryClient.getQueryData<ProjectLabel[]>(labelsKey);
      queryClient.setQueryData<ProjectLabel[]>(labelsKey, (current) =>
        (current ?? []).map((label) =>
          label.id === input.id ? { ...label, name: input.name, color: input.color } : label,
        ),
      );
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(labelsKey, context.previous);
    },
    onSuccess: () => setEditing(null),
    onSettled: settle,
  });

  const deleteLabel = useMutation({
    mutationFn: (labelId: string) => taskaApi.deleteProjectLabel(projectId, labelId),
    onMutate: async (labelId) => {
      await queryClient.cancelQueries({ queryKey: labelsKey });
      const previous = queryClient.getQueryData<ProjectLabel[]>(labelsKey);
      queryClient.setQueryData<ProjectLabel[]>(labelsKey, (current) =>
        (current ?? []).filter((label) => label.id !== labelId),
      );
      return { previous };
    },
    onError: (_error, _labelId, context) => {
      if (context?.previous) queryClient.setQueryData(labelsKey, context.previous);
    },
    onSuccess: (_result, labelId) => onLabelDeleted(labelId),
    onSettled: settle,
  });

  const error = (labelsQuery.error ?? createLabel.error ?? updateLabel.error ?? deleteLabel.error)?.message;
  const trimmed = name.trim();

  return (
    <Modal title="Labels" eyebrow={<span className="key-badge">{projectKey}</span>} onClose={onClose}>
      <form
        className="label-create-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (trimmed) createLabel.mutate({ name: trimmed, color });
        }}
      >
        <label className="field">
          <span>New label</span>
          <input
            autoFocus
            maxLength={50}
            onChange={(event) => setName(event.target.value)}
            placeholder="backend"
            value={name}
          />
        </label>
        <LabelSwatches onPick={setColor} selected={color} />
        <button className="primary-button" disabled={!trimmed || createLabel.isPending} type="submit">
          Add label
        </button>
      </form>

      {error ? <div className="form-error">{error}</div> : null}

      {labelsQuery.isPending ? <p className="issue-links-empty">Loading labels</p> : null}
      {labelsQuery.isSuccess && labels.length === 0 ? (
        <p className="issue-links-empty">This project has no labels yet.</p>
      ) : null}

      <ul className="label-manage-list">
        {labels.map((label) => {
          const pending = label.id === optimisticLabelId;
          const isEditing = editing?.id === label.id;
          return (
            <li className="label-manage-row" key={label.id || label.name}>
              {isEditing ? (
                <form
                  className="label-edit-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const next = editing.name.trim();
                    if (next) updateLabel.mutate({ id: editing.id, name: next, color: editing.color });
                  }}
                >
                  <input
                    aria-label={`Rename ${label.name || "label"}`}
                    maxLength={50}
                    onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                    value={editing.name}
                  />
                  <LabelSwatches
                    onPick={(next) => setEditing({ ...editing, color: next })}
                    selected={editing.color}
                  />
                  <button
                    aria-label="Save label"
                    className="icon-button"
                    disabled={!editing.name.trim() || updateLabel.isPending}
                    type="submit"
                  >
                    <Check size={15} />
                  </button>
                  <button aria-label="Cancel" className="icon-button" onClick={() => setEditing(null)} type="button">
                    <X size={15} />
                  </button>
                </form>
              ) : (
                <>
                  <LabelChip label={label} />
                  <div className="topbar-spacer" />
                  <button
                    aria-label={`Edit ${label.name || "label"}`}
                    className="icon-button"
                    // Nothing may be addressed on a row the server has not
                    // answered for yet, and nothing may be addressed on a label
                    // whose id never arrived.
                    disabled={pending || !label.id}
                    onClick={() =>
                      setEditing({
                        id: label.id,
                        name: label.name,
                        // A colour the contract's pattern rejects cannot be sent
                        // back on the PATCH — it would be a 400 — so the editor
                        // opens on a colour that can.
                        color: isLabelColor(label.color) ? label.color : labelColorChoices[0],
                      })
                    }
                    type="button"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    aria-label={`Delete ${label.name || "label"}`}
                    className="icon-button"
                    disabled={pending || !label.id || (deleteLabel.isPending && deleteLabel.variables === label.id)}
                    onClick={() => deleteLabel.mutate(label.id)}
                    type="button"
                  >
                    <Trash2 size={14} />
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}

/** The colour choices, as a radio group: one colour is picked, never several. */
function LabelSwatches({ onPick, selected }: { onPick: (color: string) => void; selected: string }) {
  return (
    <div aria-label="Label colour" className="label-swatches" role="radiogroup">
      {labelColorChoices.map((choice) => (
        <button
          aria-checked={selected === choice}
          aria-label={`Colour ${choice}`}
          className={`label-swatch ${selected === choice ? "is-active" : ""}`}
          key={choice}
          onClick={() => onPick(choice)}
          role="radio"
          style={{ background: choice }}
          type="button"
        />
      ))}
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
    const fromStatus = event.payload.from ?? event.payload.fromStatus;
    const toStatus = event.payload.to ?? event.payload.toStatus;
    const from = fromStatus ? statusLabels[fromStatus] : "another status";
    const to = toStatus && isIssueStatus(toStatus) ? statusLabels[toStatus] : toStatus;
    return `moved ${from} to ${to}`;
  }
  if (event.eventType === "ASSIGNED") {
    const assigneeId = event.payload.to ?? event.payload.assigneeId;
    if (!assigneeId || typeof assigneeId !== "string") return "cleared the assignee";
    return `assigned ${userById.get(assigneeId)?.displayName ?? "someone"}`;
  }
  if (event.eventType === "PRIORITY") {
    const priority = event.payload.to && isPriority(event.payload.to) ? priorityMeta[event.payload.to].label : "priority";
    return `set priority to ${priority}`;
  }
  if (event.eventType === "UPDATED" && event.payload.newPriority && isPriority(event.payload.newPriority)) {
    return `set priority to ${priorityMeta[event.payload.newPriority].label}`;
  }
  if (event.eventType === "DELETED") return "deleted this issue";
  if (event.eventType === "COMMENT_CREATED") return "commented on this issue";
  if (event.eventType === "COMMENT_UPDATED") return "edited a comment";
  if (event.eventType === "COMMENT_DELETED") return "deleted a comment";
  return "updated this issue";
}

function isIssueStatus(value: string): value is IssueStatus {
  return value === "TODO" || value === "IN_PROGRESS" || value === "DONE";
}

function isPriority(value: string): value is IssuePriority {
  return value === "LOW" || value === "MEDIUM" || value === "HIGH";
}

function resolveTransitions(
  fromStatus: IssueStatus,
  statuses: WorkflowStatus[],
  transitions: WorkflowTransition[],
) {
  const fromStatusId = statuses.find((status) => status.statusKey === fromStatus)?.id;
  const statusById = new Map(statuses.map((status) => [status.id, status.statusKey]));

  return transitions.flatMap((transition) => {
    const toStatus = statusById.get(transition.toStatusId);
    return transition.fromStatusId === fromStatusId && toStatus
      ? [{ ...transition, toStatus }]
      : [];
  });
}

function findTransition(
  fromStatus: IssueStatus,
  toStatus: IssueStatus,
  statuses: WorkflowStatus[],
  transitions: WorkflowTransition[],
) {
  return resolveTransitions(fromStatus, statuses, transitions).find((transition) => transition.toStatus === toStatus);
}

function mergeWorkflowStatuses(workflows?: WorkflowsByIssueType) {
  if (!workflows) return fallbackStatuses;

  const statusByKey = new Map<IssueStatus, WorkflowStatus>();
  concreteIssueTypes.forEach((issueType) => {
    workflows[issueType]?.statuses.forEach((status) => {
      const current = statusByKey.get(status.statusKey);
      if (!current || status.sortOrder < current.sortOrder) {
        statusByKey.set(status.statusKey, status);
      }
    });
  });

  return [...statusByKey.values()].sort((a, b) => a.sortOrder - b.sortOrder);
}

async function invalidateBoard(queryClient: ReturnType<typeof useQueryClient>, projectId: string, issueId?: string) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["issues", projectId] }),
    issueId ? queryClient.invalidateQueries({ queryKey: ["issue", projectId, issueId] }) : Promise.resolve(),
    // Every link names two issues, so anything that creates or removes one
    // changes what the other end's panel should show. Deleting an issue is the
    // case that bites: without this, its rows survive in a cached list and
    // point at a panel that no longer opens.
    queryClient.invalidateQueries({ queryKey: ["issue-links", projectId] }),
    queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  ]);
}
