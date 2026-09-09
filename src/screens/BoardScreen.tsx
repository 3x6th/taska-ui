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
import { Check, ChevronLeft, Download, Eye, EyeOff, Paperclip, Pencil, Plus, Search, Tag, Trash2, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { CreateIssueLinkInput, CreateProjectLabelInput } from "../api/TaskaApi";
import { SEARCH_QUERY_MIN_LENGTH, UNDEPLOYED_ROUTE_MESSAGE } from "../api/TaskaApi";
import {
  ATTACHMENT_ACCEPTED_SUMMARY,
  ATTACHMENT_ACCEPT_ATTRIBUTE,
  ATTACHMENT_MAX_SIZE_BYTES,
  attachmentRefusalKind,
  attachmentUploadFailure,
  type AttachmentRefusalKind,
} from "../api/attachments";
import { taskaApi } from "../api/client";
import { apiErrorFacts, isMissingOrForbidden, isUndeployedRoute } from "../api/errors";
import { ApiNotice } from "../components/ApiNotice";
import { Avatar } from "../components/Avatar";
import { LabelChip, PriorityBars, TypeChip } from "../components/IssueBits";
import { Modal } from "../components/Modal";
import { NotificationsBell } from "../components/NotificationsBell";
import { RequestId } from "../components/RequestId";
import { ThemeToggle } from "../components/ThemeToggle";
import { PendingValue, Unknown } from "../components/Unknown";
import { UserProfileMenu } from "../components/UserProfileMenu";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useUnanswered } from "../hooks/useUnanswered";
import type {
  Issue,
  IssueAttachment,
  IssueComment,
  IssueHistoryEvent,
  IssueLink,
  IssueLinkType,
  IssueSearchHit,
  IssueWatcher,
  IssueWatchers,
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
  formatFileSize,
  isLabelColor,
  issueLinkTypeLabel,
  issueLinkTypes,
  keyBadgeStyle,
  labelColorChoices,
  priorityMeta,
  statusColors,
  statusLabels,
  typeMeta,
} from "../lib/format";
import { shortKey } from "./admin/columns";
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
// DESIGN.md §4.14. The box itself is instant; only the request waits.
const SEARCH_DEBOUNCE_MS = 200;
// The endpoint's ceiling is 100 and the board already holds a page of that
// size, so this is about the *extra* group: how many matches from outside the
// loaded page are worth listing before the number itself is the answer. The
// counter states the whole total either way.
const boardSearchPageSize = 50;

export function BoardScreen({ theme, toggleTheme, onLogout, logoutPending }: ScreenProps) {
  const { projectId = "", issueId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<IssueTypeFilter>("ALL");
  const [assigneeFilter, setAssigneeFilter] = useState<AssigneeFilter>("ALL");
  const [labelFilter, setLabelFilter] = useState<LabelFilter>("ALL");
  const [managingLabels, setManagingLabels] = useState(false);
  // What `NotificationsBell` hands to `useTriggerAnchor`: the bell's own box
  // never changes size, only its position, and this is the box whose resizing
  // moves it — the bar wraps to two rows below 820 and to three at 390 when
  // the project data lands. The shared bar passes its own header for the same
  // reason and gets a box that never reflows, which is the difference the
  // component's prop is documented against.
  const topbarRef = useRef<HTMLElement>(null);
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
  // Read by the watchers section and by nothing else so far. Everywhere else a
  // failed member read is *already* legible — the assignee chip row simply has
  // no chips and the reporter line says "Unknown" — but a picker of people to
  // subscribe would be an empty `<select>` under the words "Add a watcher",
  // which reads as "this project has nobody left to add" (§5.6: only a
  // successful read may say there are none). This is what tells the two apart.
  const membersUnread = useUnanswered(membersQuery);
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
      // Three fields, the same three `GET /issues/search` matches on. The
      // description is on every issue this page holds — the list DTO carries
      // it — and simply was not consulted, so a card the server would return
      // for a word in its body was filtered out of the board by the box above
      // it: the local and the server halves of one search disagreeing about
      // what the question was.
      return (
        issue.summary.toLowerCase().includes(normalized) ||
        issue.issueKey.toLowerCase().includes(normalized) ||
        issue.description.toLowerCase().includes(normalized)
      );
    });
  }, [assigneeFilter, issues, query, typeFilter]);

  // The server's half of the same question, and only ever a supplement: the box
  // above stays local and instant, and nothing below is allowed to blank what
  // it has already put on screen.
  //
  // Two things come out of it — the honest total, because `issues.length`
  // counts one loaded page and silently stops being the project's issue count
  // past 100, and the matches that page does not hold (a description beyond it,
  // an issue beyond it).
  const debouncedQuery = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);
  // The label filter is the one filter this endpoint cannot take — there is no
  // `labelId` parameter on it — so with a label chosen the server would answer
  // a wider question than the bar is asking and the counter would quietly
  // report the unlabelled total. Not asking is the honest option; the board
  // falls back to counting its own page, which is what it did before.
  const serverSearchEnabled =
    Boolean(projectId) && labelFilter === "ALL" && debouncedQuery.length >= SEARCH_QUERY_MIN_LENGTH;
  const searchQuery = useQuery({
    queryKey: ["issue-search", projectId, debouncedQuery, typeFilter, assigneeFilter],
    enabled: serverSearchEnabled,
    queryFn: () =>
      taskaApi.searchIssues({
        projectId,
        query: debouncedQuery,
        // The two filters the bar shares with the endpoint, so its answer is
        // about the same set the columns are showing rather than a wider one.
        issueType: typeFilter === "ALL" ? undefined : typeFilter,
        assigneeId: assigneeFilter === "ALL" ? undefined : assigneeFilter,
        pageSize: boardSearchPageSize,
      }),
    retry: retryUnlessMissing,
  });
  const searchUnread = useUnanswered(searchQuery);
  // Whether the server's answer is about the question currently in the box.
  // For the 200ms after a keystroke it is not, and the two halves of "X of Y"
  // are then measured against different queries — deleting a character makes
  // the local half grow while the server's total still describes the longer
  // word, which is how a counter comes to read "8 of 3". Y waits instead; the
  // cards do not, because they are the half that must stay instant.
  const searchInStep = debouncedQuery === query.trim();
  // The hits the columns do not already hold. Compared against what is on
  // screen *now* rather than against the debounced answer, so a card can never
  // be drawn twice while the two are half a keystroke apart.
  const extraHits = useMemo(() => {
    if (!serverSearchEnabled) return [];
    const shown = new Set(filteredIssues.map((issue) => issue.id));
    return (searchQuery.data?.items ?? []).filter((hit) => !shown.has(hit.id));
  }, [filteredIssues, searchQuery.data, serverSearchEnabled]);

  const transitionIssue = useMutation({
    mutationFn: ({ movedIssueId, transitionId }: { movedIssueId: string; nextStatus: IssueStatus; transitionId: string }) =>
      taskaApi.transitionIssue(projectId, movedIssueId, transitionId),
    onMutate: async ({ nextStatus, movedIssueId }) => {
      // Captured, not read again in `onError`. Since TAS-169 `issuesKey`
      // carries the label filter, and react-query hands a pending mutation the
      // options object of the *latest* render — so a filter changed mid-flight
      // would roll back under a key this snapshot never came from: the new
      // filter's page overwritten with cards that need not carry its label,
      // and the old page left holding the optimistic move. `staleTime` is
      // 20_000 (src/main.tsx), so neither corrects itself promptly.
      const key = issuesKey;
      await queryClient.cancelQueries({ queryKey: key });
      const previousIssues = queryClient.getQueryData<Page<Issue>>(key);

      queryClient.setQueryData<Page<Issue>>(key, (current) => {
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

      return { previousIssues, key };
    },
    onError: (_error, _variables, context) => {
      if (context?.previousIssues) {
        queryClient.setQueryData(context.key, context.previousIssues);
      }
    },
    onSuccess: async (_, variables) => {
      await invalidateBoard(queryClient, projectId, variables.movedIssueId);
    },
  });

  const hasFilters = Boolean(query || typeFilter !== "ALL" || assigneeFilter !== "ALL" || labelFilter !== "ALL");
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
      <header className="board-topbar" ref={topbarRef}>
        <button className="icon-button" onClick={() => navigate("/projects")} title="Back to projects" type="button">
          <ChevronLeft size={17} />
        </button>
        {project ? (
          <span className="key-badge" style={keyBadgeStyle(project.projectKey, project.color)}>
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
        {/* The bar's trailing controls, held together as one unwrappable group.
            Below 820 this bar wraps, and wrapped flex lines pack at
            flex-start — so as loose siblings the avatar and "New" could land
            partway along a second row, with the profile popover then hanging
            leftward from wherever the avatar stopped and running off the left
            of the screen. The group keeps them together and `margin-left:auto`
            keeps them flush right on whichever line they land on, which is
            where a reader looks for a profile control anyway. */}
        <div className="topbar-actions">
          <NotificationsBell bar={topbarRef} />
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
        </div>
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
              <Avatar
                user={member.user ? { id: member.userId, displayName: member.user.displayName, color: member.user.color } : null}
                size="sm"
              />
            </button>
          ))}
        </div>
        <span className="divider" />
        {/* A failed label read is said here rather than in the notice stack
            above: the stack is capped at four (§5.6) and this costs the board
            nothing but a filter. Saying nothing would leave a picker offering
            only "All" and looking like a project that has no labels. */}
        {labelsUnread.unanswered ? (
          <span className="filter-error">Labels could not be loaded</span>
        ) : (
          <label className="filter-select">
            <span className="filter-label">Label</span>
            {/* Pending and empty would otherwise be the same picker — one
                holding nothing but "All" — and they are different answers:
                "we have not asked yet" against "this project has no labels".
                `isLoading` rather than `isPending` so a query held disabled
                (no projectId) never claims to be loading. */}
            <select
              disabled={projectLabelsQuery.isLoading}
              onChange={(event) => setLabelFilter(event.target.value)}
              value={projectLabelsQuery.isLoading ? "LOADING" : labelFilter}
            >
              {projectLabelsQuery.isLoading ? (
                <option value="LOADING">Loading labels</option>
              ) : (
                <>
                  <option value="ALL">All</option>
                  {projectLabels.filter((label) => !isPendingLabel(label)).map((label) => (
                    <option key={label.id} value={label.id}>
                      {label.name || "Unnamed label"}
                    </option>
                  ))}
                </>
              )}
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
            statement of the two.

            While a search is running, Y is the *server's* total rather than the
            size of the loaded page — the one number here that was previously a
            quiet lie past 100 issues — and it carries the same three states,
            because a search that has not answered has not answered. */}
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
            <>
              {filteredIssues.length + extraHits.length} of{" "}
              {!serverSearchEnabled ? (
                issues.length
              ) : searchUnread.unanswered ? (
                <Unknown />
              ) : searchQuery.data && searchInStep ? (
                // No `?? issues.length` behind this. Both implementations
                // always state a total, so that branch was unreachable — and
                // had it ever been reached it would have printed the size of
                // one loaded page where a project total belongs, which is the
                // exact substitution this counter was changed to stop making.
                (searchQuery.data.totalCount ?? <Unknown />)
              ) : (
                <PendingValue />
              )}
            </>
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

      {serverSearchEnabled ? (
        <SearchHitsGroup
          error={searchUnread.unanswered ? searchUnread.error : null}
          hits={extraHits}
          loading={searchQuery.isFetching && !searchQuery.data}
          projectId={projectId}
          query={debouncedQuery}
          userById={userById}
        />
      ) : null}

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
          members={members}
          membersAnswered={membersQuery.data !== undefined}
          membersUnknown={membersUnread.unanswered}
          userById={userById}
          canEdit={canEdit}
          isProjectAdmin={isProjectAdmin}
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
          projectColor={project?.color}
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
          projectColor={project?.color}
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
  userById: Map<string, Pick<User, "id" | "displayName" | "color">>;
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
  user?: Pick<User, "id" | "displayName" | "color"> | null;
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

function IssueCardContent({ issue, user }: { issue: Issue; user?: Pick<User, "id" | "displayName" | "color"> | null }) {
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

/**
 * What the server found that the columns above do not hold (DESIGN.md §5.4).
 *
 * Its own group, below the board and outside the `DndContext`, because a hit is
 * an `IssueSearchHit` and has no status. Putting one in a status column would
 * be a claim the server never made, and making it a drop target would offer a
 * transition from a status nobody knows. So these rows do not lift, do not
 * drag, and say in words what they are.
 *
 * Four states, and they are four different sentences: a search still running, a
 * search that failed, a search that found nothing else, and the rows
 * themselves. The board's own filtered cards are on screen throughout — nothing
 * here blanks them, and there is no spinner over anything (§5.6).
 */
function SearchHitsGroup({
  error,
  hits,
  loading,
  projectId,
  query,
  userById,
}: {
  error: Error | null;
  hits: IssueSearchHit[];
  loading: boolean;
  projectId: string;
  query: string;
  userById: Map<string, Pick<User, "id" | "displayName" | "color">>;
}) {
  return (
    <section aria-label="Other matches from the server" className="search-hits">
      {/* The heading explains the rows, so it comes with them. The other three
          answers are one sentence each: a header over an empty group would be
          a band of prose explaining nothing.

          One sentence rather than two. The second used to explain *why* these
          are not in a column — a design decision, told to a reader who did not
          ask, in a paragraph that ran 188 characters and cost a phone 70px of
          the group's whole budget before the first result. The heading and this
          line carry what a reader needs; the reason lives in the comment above
          this component. */}
      {!error && !loading && hits.length > 0 ? (
        <div className="search-hits-head">
          <strong>More matches for “{query}”</strong>
          <span>
            Found by the server across the whole project: matches in descriptions, and issues beyond the page this board
            loaded.
          </span>
        </div>
      ) : null}

      {error ? (
        // Not "nothing else was found". A search that never answered is not an
        // empty result, and the counter above says <Unknown /> for the same
        // reason.
        <ApiNotice error={error} live="polite">
          The rest of this project could not be searched.
        </ApiNotice>
      ) : loading ? (
        <p className="search-hits-state" role="status">
          Searching the rest of this project for “{query}”…
        </p>
      ) : hits.length === 0 ? (
        <p className="search-hits-state" role="status">
          Nothing else in this project matches “{query}”.
        </p>
      ) : (
        <ul className="search-hits-list">
          {hits.map((hit) => {
            const assignee = hit.assigneeId ? userById.get(hit.assigneeId) : null;
            return (
              <li key={hit.id}>
                {/* A link, not a button: it navigates and nothing about it
                    drags, so it has to be middle-clickable and copyable like
                    every other address in this app. */}
                <Link className="search-hit" to={`/projects/${projectId}/issues/${hit.id}`}>
                  <span className="search-hit-meta">
                    <TypeChip type={hit.issueType} />
                    <span className="issue-key">{hit.issueKey}</span>
                    <span>{typeMeta[hit.issueType].label}</span>
                    <PriorityBars priority={hit.priority} />
                  </span>
                  <strong>{hit.summary}</strong>
                  {/* Everything a hit carries and nothing else — no status, no
                      labels, no dates, because the server sent none of them. */}
                  <span className="search-hit-foot">
                    <Avatar user={assignee} size="sm" />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
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

function IssuePanel({
  projectId,
  issueId,
  members,
  membersAnswered,
  membersUnknown,
  userById,
  canEdit,
  isProjectAdmin,
  currentUserId,
  workflows,
  workflowUnknown,
  onClose,
}: {
  projectId: string;
  issueId: string;
  members: ProjectMember[];
  /**
   * Whether the member read has answered *at all*. Distinct from the flag
   * below, and the pair is three states rather than two: answered, failed, and
   * still in flight. `members` is `[]` in the last two alike, so a section that
   * read only the failure flag would tell a reader the project has no members
   * during the second it is still being asked.
   */
  membersAnswered: boolean;
  /**
   * The member read failed and there is nothing to show for it. Only the
   * watchers section reads either of these — see `membersUnread` on the board —
   * because it is the only place where an empty member list would be presented
   * as an answer rather than simply leaving a row bare.
   */
  membersUnknown: boolean;
  userById: Map<string, Pick<User, "id" | "displayName" | "color">>;
  canEdit: boolean;
  /**
   * Narrower than `canEdit`, and only the attachments section reads it: an
   * attachment somebody *else* uploaded may be deleted by an `ADMIN` and by
   * nobody else (`delete-attachment-roles` in issue-service's own config),
   * while your own needs only `ADMIN` or `MEMBER`. Same shape as the label
   * writes TAS-119 gated, and the same standing: hiding the control is
   * presentation, the server decides.
   */
  isProjectAdmin: boolean;
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
    // Not `invalidateBoard`: this path deliberately does not touch
    // `["issue", projectId, issueId]`, because this panel is still mounted for
    // one more tick and refetching the issue that was just deleted would put a
    // 404 on screen on the way out. The search is the other half of the board's
    // counter and has to move with the issue list — same reasoning as the
    // prefix in `invalidateBoard`, and the worse half of it: measured against
    // the mock, deleting the only match left the counter reading "1 of 1" over
    // an empty board, because the deleted issue stayed in the search answer and
    // came back as a row in the group below, linking to a panel that no longer
    // opens. A wrong number is noticed; a plausible one is not.
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["issues", projectId] }),
        queryClient.invalidateQueries({ queryKey: ["issue-search"] }),
      ]);
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
                  user={member.user ? { id: member.userId, displayName: member.user.displayName, color: member.user.color } : null}
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

          {/* Above the other three sections on purpose. It is the only one
              every reader can act on — labels, links and files all need write
              access — and it is the one whose state has to be legible without
              hunting. It also keeps the toggle above the fold at 1440×900 and
              one short scroll away at 390×844. */}
          <IssueWatchersSection
            projectId={projectId}
            issueId={issueId}
            currentUserId={currentUserId}
            members={members}
            membersAnswered={membersAnswered}
            membersUnknown={membersUnknown}
            userById={userById}
            isProjectAdmin={isProjectAdmin}
          />

          <IssueLabelsSection projectId={projectId} issueId={issueId} canEdit={canEdit} />

          <IssueLinksSection projectId={projectId} issueId={issueId} canEdit={canEdit} />

          <IssueAttachmentsSection
            projectId={projectId}
            issueId={issueId}
            canEdit={canEdit}
            isProjectAdmin={isProjectAdmin}
            currentUserId={currentUserId}
            userById={userById}
          />

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
 * Id of the row an optimistic watch puts in the cache before the server has
 * answered, on the same terms as `optimisticLinkId`: no subscription on the
 * server can carry it, and it is deliberately not the empty string, which is
 * what a response omitting `id` produces.
 */
const optimisticWatcherId = "tk-optimistic-watcher";

/**
 * A row's identity, for React and for the map of remove buttons the focus
 * handoff reads. Keyed by the person rather than by the subscription: a row's
 * `id` is `optimisticWatcherId` until the server answers, so two pending adds
 * would share one key. A user has at most one subscription per issue, which
 * makes `userId` the natural key — and `id` is the fallback for a response that
 * omitted it.
 */
function watcherRowKey(watcher: IssueWatcher): string {
  return watcher.userId || watcher.id;
}

/** What the section says about a write, and whether it is a failure. */
interface WatcherNotice {
  tone: "info" | "error";
  text: string;
  /**
   * The refusal the sentence is about, so the line under it can carry the
   * gateway's request id — the one string that finds this failure in its log,
   * and the one every surface of this section used to drop. Absent on the info
   * tone: `removed: false` is a `200` that changed nothing, not a fault, and
   * there is nothing to file about it.
   */
  error?: unknown;
}

/**
 * The five watcher routes (TAS-193): the list, the `…/watchers/me` pair every
 * reader owns, and the two project-`ADMIN` routes that subscribe and
 * unsubscribe somebody else.
 *
 * **Three things here are not obvious and each has cost somebody an hour.**
 *
 * *The count is the server's field, never the array's length.*
 * `ListIssueWatchersResponseDto` states `totalCount` beside `watchers`, and
 * both writes answer with `watchersCount` — so after a toggle the number is
 * right before any refetch lands, and `null` (the server said nothing) stays
 * distinguishable from `0` (nobody is watching). Only the *membership* question
 * — am I in this list — is answered from the array, because the contract offers
 * no `…/watchers/me` read to ask it with.
 *
 * *`removed: false` is a success that changed nothing.* The unwatch pair
 * answers `200` with a flag saying whether a subscription was actually deleted,
 * and an unwatch that deleted nothing is reported as exactly that rather than
 * as a change or as an error. Same class as TAS-194's retry: the server
 * distinguishes "done" from "already so", and flattening the two is how a UI
 * comes to report events that never happened. Its sibling `watchIssue` has no
 * such flag, so a second watch is genuinely indistinguishable from a first and
 * nothing here pretends otherwise.
 *
 * *A watcher carries a `userId` and no name.* It is resolved through the same
 * `userById` map that names the assignee, the reporter and an attachment's
 * uploader — one mechanism, and it fails in one way: `GET /projects/{id}/members`
 * is a 405 on the deployed gateway (TAS-137), so in `rest` mode every watcher
 * draws as "Unknown", exactly as the reporter line already does. That symmetry
 * is the argument for reusing the map rather than inventing a second lookup,
 * and it is *not* a reason to defer the ADMIN half: a remove names a `userId`,
 * which every row already carries, so it needs no name at all; and an add needs
 * a list of candidate people, which is the very list the assignee picker two
 * sections above is built from. Both degrade with that picker and neither
 * degrades further.
 */
function IssueWatchersSection({
  projectId,
  issueId,
  currentUserId,
  members,
  membersAnswered,
  membersUnknown,
  userById,
  isProjectAdmin,
}: {
  projectId: string;
  issueId: string;
  /** `undefined` until `GET /users/me` answers. Until then nothing may claim who is watching. */
  currentUserId?: string;
  members: ProjectMember[];
  /** The member read answered. Three states, not two — see the panel's own prop. */
  membersAnswered: boolean;
  membersUnknown: boolean;
  userById: Map<string, Pick<User, "id" | "displayName" | "color">>;
  /**
   * The gate on `POST …/watchers` and `DELETE …/watchers/{userId}`, both of
   * which the contract marks "только project ADMIN". Presentation only — the
   * server checks again, and in `hybrid` with `VITE_TASKA_ASSUME_PROJECT_ADMIN`
   * this is `true` for everybody (DESIGN.md §5.7).
   */
  isProjectAdmin: boolean;
}) {
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState("");
  const [notice, setNotice] = useState<WatcherNotice | null>(null);

  /**
   * Every row's remove control, keyed the way the rows are, and the heading —
   * which is where focus goes when the last row leaves and there is no
   * neighbour to hand it to. Both exist for the same reason: a button that
   * unmounts under the reader's own focus drops them in `<body>`, one Tab from
   * the top of the document recovers it, and an ADMIN pruning five watchers
   * pays that five times.
   */
  const rowButtons = useRef(new Map<string, HTMLButtonElement>());
  const heading = useRef<HTMLHeadingElement | null>(null);
  /**
   * Where focus goes once the removed row is gone: a row key, `""` for the
   * heading, `null` for "leave it where it is". Recorded here and applied by the
   * effect below rather than moved in the mutation callback, because the row
   * meant to receive it does not exist in the DOM until React has re-rendered
   * without the one that left.
   */
  const focusAfterRemoval = useRef<string | null>(null);

  const watchersKey = useMemo(() => ["issue-watchers", projectId, issueId], [projectId, issueId]);
  const watchersQuery = useQuery({
    queryKey: watchersKey,
    queryFn: () => taskaApi.listIssueWatchers(projectId, issueId),
    retry: retryUnlessMissing,
  });

  const answer = watchersQuery.data;
  const watchers = useMemo(() => answer?.watchers ?? [], [answer]);
  const watching = Boolean(currentUserId) && watchers.some((watcher) => watcher.userId === currentUserId);
  const subscribed = useMemo(() => new Set(watchers.map((watcher) => watcher.userId)), [watchers]);
  const addable = members.filter((member) => !subscribed.has(member.userId));

  /**
   * The count as somebody *said* it. `answer.totalCount` is the list read's
   * field and the write mutations overwrite it with theirs, so this is never
   * `watchers.length` — and it is `null`, drawing no pill at all, when nothing
   * has stated a number yet.
   */
  const count = answer?.totalCount ?? null;

  /**
   * Both halves of what a write tells us, applied to the cache the moment it
   * lands: the server's count, and — for the two removals — whether anything
   * was actually deleted. The count is applied even when it is the number the
   * optimistic update had already guessed, because "the same number, from the
   * server" and "our guess" are different states of this cache and only the
   * first survives the next reader.
   */
  const applyServerCount = (watchersCount: number | null) => {
    if (watchersCount === null) return;
    queryClient.setQueryData<IssueWatchers>(watchersKey, (current) =>
      current ? { ...current, totalCount: watchersCount } : current,
    );
  };

  /**
   * One write, one stale cache. Deliberately **not** `invalidateBoard`: no
   * watcher route changes the issue, and this build knows of no history event
   * or notification type for a subscription — `IssueEventType` has none and
   * neither does `NotificationType` — so refetching the issue after a toggle
   * would be this side asserting that the server wrote something it never
   * mentioned. If the backend turns out to journal these, the invalidation
   * belongs here and the union belongs in `src/domain/types.ts` with it.
   */
  const settle = () => queryClient.invalidateQueries({ queryKey: watchersKey });

  /** The optimistic row for a subscription the server has not confirmed yet. */
  const optimisticRow = (userId: string): IssueWatcher => ({
    id: optimisticWatcherId,
    issueId,
    projectId,
    userId,
    createdAt: "",
    createdBy: currentUserId ?? "",
  });

  const beginWrite = async () => {
    setNotice(null);
    await queryClient.cancelQueries({ queryKey: watchersKey });
    return queryClient.getQueryData<IssueWatchers>(watchersKey);
  };

  const addOptimistically = (userId: string) => {
    queryClient.setQueryData<IssueWatchers>(watchersKey, (current) => {
      if (!current) return current;
      // **Idempotent, and not as a precaution.** Two dispatches for one person
      // land in the same task whenever a double press outruns the mutation's own
      // pending flag — react-query publishes that flag in a microtask, so the
      // second click of a 120ms double-click can still read it as `false`. A
      // second row for a `userId` already here would collide on the React key
      // the rows are given below *and* count one subscription twice. A
      // subscription is set membership: adding it twice is adding it once.
      if (current.watchers.some((watcher) => watcher.userId === userId)) return current;
      return {
        watchers: [...current.watchers, optimisticRow(userId)],
        // A guess, and only until the server's own number replaces it a
        // tick later. `null` stays `null`: a count nobody has stated is not
        // a count this side may start one from.
        totalCount: current.totalCount === null ? null : current.totalCount + 1,
      };
    });
  };

  /**
   * Drop a person's row and take the count down with it — optimistically for
   * the reader's own unwatch, and only on the server's word for the ADMIN
   * removal below, which is why this is not called `removeOptimistically`
   * (its sibling above still is, because it has one caller and one timing).
   */
  const removeRow = (userId: string) => {
    queryClient.setQueryData<IssueWatchers>(watchersKey, (current) => {
      if (!current) return current;
      const watchersLeft = current.watchers.filter((watcher) => watcher.userId !== userId);
      const changed = watchersLeft.length !== current.watchers.length;
      return {
        watchers: watchersLeft,
        totalCount:
          current.totalCount === null || !changed ? current.totalCount : Math.max(0, current.totalCount - 1),
      };
    });
  };

  const rollback = (previous: IssueWatchers | undefined) => {
    if (previous) queryClient.setQueryData(watchersKey, previous);
  };

  const watchIssue = useMutation({
    mutationFn: () => taskaApi.watchIssue(projectId, issueId),
    onMutate: async () => {
      const previous = await beginWrite();
      if (currentUserId) addOptimistically(currentUserId);
      return { previous };
    },
    onSuccess: (result) => applyServerCount(result.watchersCount),
    onError: (error, _variables, context) => {
      rollback(context?.previous);
      setNotice({ error, tone: "error", text: watcherFailureText(error, "You were not subscribed to this issue.") });
    },
    onSettled: settle,
  });

  const unwatchIssue = useMutation({
    mutationFn: () => taskaApi.unwatchIssue(projectId, issueId),
    onMutate: async () => {
      const previous = await beginWrite();
      if (currentUserId) removeRow(currentUserId);
      return { previous };
    },
    onSuccess: (result) => {
      applyServerCount(result.watchersCount);
      // Not an error and not silence. The end state is the one that was asked
      // for, so nothing rolls back; what did not happen is the *removal*, and
      // saying so is the whole reason the server sends this flag.
      if (!result.removed) {
        setNotice({ tone: "info", text: "You were not watching this issue, so nothing was removed." });
      }
    },
    onError: (error, _variables, context) => {
      rollback(context?.previous);
      setNotice({ error, tone: "error", text: watcherFailureText(error, "You are still watching this issue.") });
    },
    onSettled: settle,
  });

  const addWatcher = useMutation({
    mutationFn: (userId: string) => taskaApi.addIssueWatcher(projectId, issueId, userId),
    onMutate: async (userId) => {
      const previous = await beginWrite();
      addOptimistically(userId);
      return { previous };
    },
    onSuccess: (result) => applyServerCount(result.watchersCount),
    onError: (error, userId, context) => {
      rollback(context?.previous);
      // The same sentence in the person its subject requires, and the reader's
      // half is the toggle's own words rather than new prose: an ADMIN can add
      // *themselves* from this picker — `addable` is every member who is not
      // watching yet, which includes them — and the failure that follows is the
      // one `watchIssue` above already has a sentence for.
      const subject = watcherSubject(userById, userId, currentUserId);
      setNotice({
        error,
        tone: "error",
        text: watcherFailureText(
          error,
          subject.reader
            ? "You were not subscribed to this issue."
            : `${subject.name} was not subscribed to this issue.`,
        ),
      });
      // The rollback puts the person back in the picker, so put the choice back
      // with it — unless something else has been chosen since, which is the one
      // thing this must never overwrite. Same rule as the label picker.
      setPicked((current) => (current === "" ? userId : current));
    },
    onSettled: settle,
  });

  /**
   * Where focus goes when a row leaves under it: the row below, or the one
   * above when the last row is the one leaving, or the section heading when
   * nothing is left to hold it.
   *
   * Deliberately **not** "wherever the reader was". A settling write is no
   * licence to move focus across a panel, so the handoff is armed only when
   * focus is still resting on the very control that is about to unmount — which
   * is where the reader who pressed it left it. Anywhere else and this does
   * nothing at all.
   */
  const planFocusHandoff = (userId: string) => {
    const leaving = rowButtons.current.get(userId);
    if (!leaving || document.activeElement !== leaving) return;
    const list = queryClient.getQueryData<IssueWatchers>(watchersKey)?.watchers ?? [];
    const index = list.findIndex((watcher) => watcher.userId === userId);
    if (index < 0) return;
    const neighbour = list[index + 1] ?? list[index - 1];
    focusAfterRemoval.current = neighbour ? watcherRowKey(neighbour) : "";
  };

  /**
   * The one write in this section that is **not** optimistic in the list, and
   * the reason was measured rather than argued. Filtering the row out in
   * `onMutate` reflows the list inside a frame, so the *next* row's ✕ arrives
   * under the cursor before the second click of an ordinary double-click: at
   * 120ms, 200ms and 350ms that took one issue from three watchers to one — two
   * real `DELETE`s, no confirmation, no undo, and not a word to the person who
   * did it. What disappears here is somebody else's subscription, which is why
   * this section pays for the fix now rather than waiting for the panel-wide
   * one — labels, links and attachments all remove a row the same way, and that
   * shape is filed as its own piece of work.
   *
   * The response is still immediate — the row goes `is-pending` on the press
   * and its ✕ stops answering — it simply keeps its place until the server
   * answers. Nothing reaches the cache before that, so there is nothing to roll
   * back: a refusal leaves the list exactly as it was and says why.
   */
  const removeWatcher = useMutation({
    mutationFn: (userId: string) => taskaApi.removeIssueWatcher(projectId, issueId, userId),
    // `beginWrite` for the half of its job that still applies: clearing the
    // notice, and cancelling a refetch that would otherwise land on top of the
    // removal below. Its snapshot is dropped on purpose — a rollback to a list
    // read before *this* `DELETE` would restore a sibling row whose own
    // removal succeeded in between.
    onMutate: () => beginWrite(),
    onSuccess: (result, userId) => {
      planFocusHandoff(userId);
      removeRow(userId);
      applyServerCount(result.watchersCount);
      if (!result.removed) {
        const subject = watcherSubject(userById, userId, currentUserId);
        setNotice({
          tone: "info",
          text: subject.reader
            ? "You were not watching this issue, so nothing was removed."
            : `${subject.name} was not watching this issue, so nothing was removed.`,
        });
      }
    },
    onError: (error, userId) => {
      const subject = watcherSubject(userById, userId, currentUserId);
      setNotice({
        error,
        tone: "error",
        text: watcherFailureText(
          error,
          subject.reader
            ? "You are still watching this issue."
            : `${subject.name} is still watching this issue.`,
        ),
      });
    },
    onSettled: settle,
  });

  /**
   * The handoff itself, after the render that removed the row rather than
   * inside the callback that asked for it.
   *
   * **A plain `focus()`, deliberately, and the option it used to pass was
   * measured rather than reasoned away** (`art-director`, TAS-193). Chromium
   * carries `:focus-visible` across a programmatic move when the element losing
   * focus had it, so the keyboard reader — who pressed Enter on the ✕ and is
   * the reader this handoff exists for — still gets the ring without asking for
   * it. `focusVisible: true` only changed the *pointer* path, and there it
   * drew a second "you are here": the cursor sits over the new neighbour
   * showing its hover fill while the accent ring sits on a ✕ 74px away.
   * `AdminEventsProblems` forces the ring for a different situation — focus
   * returning from a dismissed dialog to a control that may have changed — and
   * that precedent does not reach a list handing one row to the next.
   */
  useEffect(() => {
    const target = focusAfterRemoval.current;
    if (target === null) return;
    focusAfterRemoval.current = null;
    const node = target === "" ? heading.current : rowButtons.current.get(target);
    if (!node?.isConnected) return;
    node.focus();
  }, [watchers]);

  const toggling = watchIssue.isPending || unwatchIssue.isPending;
  // Mutations first, reads second, for the reason the label section states: an
  // observer can hold data *and* a failed background refetch at once, and in
  // that state a refused write would otherwise be explained by whatever the
  // refetch said instead.
  const readError = watchersQuery.data === undefined ? watchersQuery.error : null;

  return (
    <section className="issue-watchers">
      {/* `tabIndex={-1}` makes this reachable by script and by nothing else: it
          is where focus lands when the row that had it was the last one in the
          list. A heading rather than the toggle beside it, because the toggle
          answers Enter with a subscription and a reader who has just pressed ✕
          five times is exactly the reader who would press it again. */}
      <h3 ref={heading} tabIndex={-1}>
        Watchers
        {/* Only when somebody has stated a number. `0` states one; `null` — a
            `200` that omitted `totalCount`, which this contract permits — does
            not, and a pill reading "0" over it would be this side answering a
            question the server declined. */}
        {count !== null ? <span className="count-pill">{count}</span> : null}
      </h3>

      {/* Two answers have to be in before this may be drawn at all, and both for
          the same reason: "Watch" and "Watching" are each a claim about the
          reader's own state, so the control waits until the list says who is
          watching *and* `GET /users/me` says who is reading. A disabled toggle
          with a guessed label would make the claim anyway. `data` rather than
          `isSuccess`, so a failing background refetch leaves it where it was. */}
      {answer && currentUserId ? (
        <div className="watcher-toggle-row">
          <button
            /**
             * `aria-disabled`, never `disabled`, and this is the one line in
             * the section worth defending. A `disabled` button loses focus in
             * Chromium the moment the attribute lands, so pressing Enter on
             * this toggle dropped focus to `<body>` for the length of the
             * request and the *second* Enter went nowhere — a keyboard user
             * could watch an issue and then not unwatch it without tabbing in
             * from the top of the document again. Caught by the keyboard case
             * in `e2e/watchers.spec.ts`, which is why that case exists.
             *
             * The guard moves into the handler with it. Leaving the press live
             * would be worse than a dead 200ms: a `PUT` and a `DELETE` in
             * flight together can be applied by the server in either order, and
             * the loser decides the subscription.
             */
            aria-disabled={toggling || undefined}
            aria-pressed={watching}
            className={`secondary-button compact-button watch-toggle${watching ? " is-watching" : ""}`}
            // The one control in this panel that is not behind `canEdit`: the
            // contract puts no role on `…/watchers/me`, and watching is
            // per-reader.
            onClick={() => {
              if (toggling) return;
              if (watching) unwatchIssue.mutate();
              else watchIssue.mutate();
            }}
            type="button"
          >
            {watching ? <Eye size={13} /> : <EyeOff size={13} />}
            {watching ? "Watching" : "Watch"}
          </button>
          <span className="watcher-toggle-hint">
            {watching ? "You are on this issue's watcher list." : "Add yourself to this issue's watcher list."}
          </span>
        </div>
      ) : null}

      {/* The ADMIN add. Hidden — rather than rendered empty — when the member
          read failed, because an empty picker under "Add a watcher" reads as
          "there is nobody left to add", which is a claim about the project that
          a failed read cannot support (§5.6). The sentence below says which it
          is. */}
      {isProjectAdmin && answer && membersAnswered && addable.length > 0 ? (
        <form
          className="issue-link-form watcher-form"
          onSubmit={(event) => {
            event.preventDefault();
            // The guard the `aria-disabled` below no longer enforces by itself.
            // Both halves of it: nothing chosen, and a `POST` already out for
            // the person who was.
            if (!picked || addWatcher.isPending) return;
            addWatcher.mutate(picked);
            // Reset in the handler that read the value, never in a callback a
            // round trip later — see the label picker for what a late reset
            // takes with it.
            setPicked("");
          }}
        >
          <label className="issue-link-field issue-link-target">
            <span>Add a watcher</span>
            <select onChange={(event) => setPicked(event.target.value)} value={picked}>
              <option value="">Select a member</option>
              {/* Each option worded as the row it is about to become. This read
                  `member.user?.displayName ?? "Unnamed member"` — the same
                  condition the rows call "Unknown", since `toUserMap` drops a
                  membership row precisely for having no `user` — so choosing an
                  "Unnamed member" produced an "Unknown" row and, when the add
                  failed, a sentence about somebody the reader had never seen
                  named. The contract makes that no edge case either:
                  `ProjectMemberResponseDto` states `projectId`, `userId` and
                  `role` and no user summary at all, so a member read shipped as
                  written would put every option in this state at once. */}
              {addable.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {watcherSubject(userById, member.userId, currentUserId).name}
                </option>
              ))}
            </select>
          </label>
          {/* `aria-disabled`, never `disabled` — §4.21's rule, which this
              section stated and then broke twice inside itself. Measured: Enter
              on a button that disables itself in the same tick drops
              `document.activeElement` to `<body>` and leaves it there. The
              handler above carries the guard, and the fade `button:disabled`
              would have drawn is restored in the stylesheet. */}
          <button
            aria-disabled={!picked || addWatcher.isPending || undefined}
            className="secondary-button compact-button"
            type="submit"
          >
            Add
          </button>
        </form>
      ) : null}

      {isProjectAdmin && membersUnknown ? (
        <p className="issue-links-empty">
          This project&rsquo;s members could not be read, so there is nobody to offer here.
        </p>
      ) : null}
      {/* `membersAnswered`, not `!membersUnknown`: a read still in flight is
          neither an answer nor a failure, and this sentence needs a landed one.
          What it may then say is narrower than it looks. In `hybrid` — the
          default, and the mode the deployed stand runs — `listMembers`
          *succeeds* with exactly one element, the reader themselves, because the
          gateway has no member read (TAS-137). So a sentence about "everyone on
          this project" would be told to an ADMIN of a ten-person project on the
          strength of a list of one, and nothing in the UI can tell a synthesised
          answer from a real one. The claim is therefore about the list that came
          back, which is true either way; §5.6's boundary above still keeps a
          *failed* read from producing a sentence at all. */}
      {isProjectAdmin && answer && membersAnswered && addable.length === 0 ? (
        <p className="issue-links-empty">
          {members.length === 0
            ? "No members came back for this project, so there is nobody to add."
            : "Everyone this project's member list names is already watching."}
        </p>
      ) : null}

      {/* One live region that stays mounted and changes its text, the shape §7
          asks for and the attachments section already uses. Polite: every
          sentence here follows something the reader just did.

          The region is the *sentence*, not the box around it — the split
          `ApiNotice` makes internally and the reason it is worth copying while
          the component itself is not. A polite region containing the detail
          line would read a 36-character uuid out loud, which is the defect N6
          has just finished removing from the ✕ label.

          What that buys is narrower than "one region in this section", so it is
          worth stating as itself: **no ancestor of the detail line is a live
          region**, which is what keeps the id out of every announcement, and it
          is what the unit test checks (`closest("[aria-live]")`). It is not a
          count. When the failure carries an id, `RequestId` mounts a
          `role="status"` span *inside* this line — an implicit polite region,
          the second in the box. It is empty until the reader clicks Copy and
          only ever holds "Copied" or "Couldn't copy"; the uuid never enters it.
          A silent region announces nothing, so the reader still hears one
          sentence per failure. */}
      <div className={notice ? `watcher-note${notice.tone === "error" ? " is-error" : ""}` : ""}>
        <p aria-live="polite" className="watcher-note-sentence">
          {notice?.text ?? ""}
        </p>
        <WatcherNoteDetail error={notice?.error} sentence={notice?.text} />
      </div>

      {/* The same two-part body, and deliberately **not** a second live region:
          this box mounts together with its text, which is the shape §7 objects
          to, and a section with two polite regions is worse than one that
          announces a read failure a beat late. Recorded rather than fixed
          here. */}
      {readError ? (
        <div className="watcher-note is-error">
          <p className="watcher-note-sentence">{readError.message}</p>
          <WatcherNoteDetail error={readError} sentence={readError.message} />
        </div>
      ) : null}

      {watchersQuery.isPending ? <p className="issue-links-empty">Loading watchers</p> : null}
      {/* Only a successful read may say nobody is watching. */}
      {answer && watchers.length === 0 ? <p className="issue-links-empty">No one is watching this issue yet</p> : null}

      {watchers.length ? (
        <ul className="watcher-list">
          {watchers.map((watcher) => {
            const person = watcher.userId ? userById.get(watcher.userId) : undefined;
            const mine = Boolean(currentUserId) && watcher.userId === currentUserId;
            // The member map is the only source of names in this section, and
            // there is exactly one person it may fail on whom the UI can name
            // anyway: the reader. A VIEWER who is not a member of the project
            // can still watch an issue in it, and that row used to read
            // "Unknown (you)" — a screen saying it does not know who you are,
            // beside a mark saying it does. `GET /users/me` answered that
            // question before this section drew anything. The rule lives in
            // `watcherSubject` rather than here now, because the sentences
            // below needed the same one and had been given a different one.
            //
            // "You" also makes the "(you)" beside it a tautology, so the mark
            // goes: it exists to pick the reader out of a list of names, and
            // there is no name here to pick out of.
            const { name } = watcherSubject(userById, watcher.userId, currentUserId);
            const pending = watcher.id === optimisticWatcherId;
            const removing = removeWatcher.isPending && removeWatcher.variables === watcher.userId;
            const key = watcherRowKey(watcher);
            return (
              // `is-pending` covers both windows a row can be in flight in: an
              // add the server has not confirmed, and its own removal, which now
              // holds its place until the `DELETE` answers.
              <li className={`watcher-row${pending || removing ? " is-pending" : ""}`} key={key}>
                {/* `label` is the announcement, not the drawing. Without a
                    `user` the circle falls back to §4.4's word for nobody, so
                    a row whose text reads "You" was announced "Unassigned You"
                    — a screen saying in one breath that it knows who this is
                    and that nobody is here — and an unnamed row was announced
                    "Unassigned Unknown". The dashes and the empty glyph do not
                    move: both are gated on `user`, not on this, so §4.4's
                    nobody-circle is still drawn for a person this map cannot
                    name. Only the word a reader hears changes, and it changes
                    to the one already beside it. */}
                <Avatar user={person} label={name} size="sm" />
                <span className="watcher-name">
                  {name}
                  {mine && person ? <span className="watcher-you"> (you)</span> : null}
                </span>
                {isProjectAdmin ? (
                  <button
                    // Two rows for two people this map cannot name would
                    // otherwise share one accessible name, so the id is what
                    // tells them apart — but the whole of it is thirty-six
                    // characters read out one at a time. §5.8's own abbreviation
                    // is enough to disambiguate two rows and is what the admin
                    // tables already say aloud.
                    //
                    // The reader's own unnamed row takes the word the row
                    // itself uses instead of an id that identifies them to
                    // nobody. **Not observed in a browser, and against the mock
                    // it cannot be**: the mock makes the first member of each
                    // project its ADMIN, so an admin is always in the list
                    // `userById` is built from and this arm never runs there.
                    //
                    // Where it *can* run is narrower than "the deployed stand's
                    // 405", which is what this comment said until the sentences
                    // below were fixed to match it. The stand runs `hybrid`,
                    // and `HybridTaskaApi.listMembers` never calls the 405
                    // route: it synthesises one member — the reader, *named* —
                    // so the map names them and this arm stays shut. `rest`
                    // does meet the 405, and there `getMembership` is equally
                    // unmapped, so `isProjectAdmin` is false and there is no ✕
                    // to label. What reaches it is the stand plus a failing
                    // `GET /projects/{id}`: `listMembers` is built on that read
                    // and rejects with it, while
                    // `VITE_TASKA_ASSUME_PROJECT_ADMIN` short-circuits
                    // `getMembership` before any request and keeps the control
                    // on screen — the same coupling API-DIVERGENCE.md records
                    // for TAS-162. A ruling about that case, then, not a
                    // screenshot of it; the unit suite is where it is held.
                    aria-label={
                      person
                        ? `Remove ${person.displayName} from watchers`
                        : mine
                          ? "Remove yourself from watchers"
                          : `Remove watcher ${shortKey(watcher.userId)}`
                    }
                    // In flight, so `aria-disabled` and a handler guard rather
                    // than `disabled` — §4.21's rule, and the reason this row
                    // still has focus to hand on when it goes.
                    aria-disabled={pending || removing || undefined}
                    className="icon-button"
                    // A row whose `userId` the response left blank cannot be
                    // removed: the request would name nobody. That is not a
                    // window, it is permanent, so it keeps a real `disabled` and
                    // the fade that comes with it. The row still shows —
                    // somebody is watching either way.
                    disabled={!watcher.userId}
                    onClick={() => {
                      if (pending || removing) return;
                      removeWatcher.mutate(watcher.userId);
                    }}
                    ref={(node) => {
                      if (node) rowButtons.current.set(key, node);
                      else rowButtons.current.delete(key);
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
      ) : null}
    </section>
  );
}

/**
 * Who a watcher row — and every sentence about one — is about: the name this
 * section is allowed to use for them, and whether that name is the reader
 * themselves.
 *
 * **One function because two of them contradicted each other.** The rows had
 * learned that this map's failure is not total — `GET /users/me` names the
 * reader whatever the member read did — and the sentences had not, so an ADMIN
 * removing their own unnamed row met "You" in the row, "Remove yourself from
 * watchers" on its ✕, and "Unknown is still watching this issue." underneath,
 * all three about the same person. The picker was a third voice: "Unnamed
 * member" for exactly the condition the rows call "Unknown", `toUserMap`
 * dropping a membership row that carries no `user` summary being the single
 * thing both words are about. Every surface in this section asks here now, so
 * there is one word per state and it cannot drift again.
 *
 * Precedence is the rows', unchanged: the member map first — a reader it *can*
 * name sees their own name, exactly as the assignee row and the reporter line
 * show it — then the reader, then §4.21's word for a person nobody here can
 * name.
 *
 * `reader` travels with the name because English will not let a caller recover
 * it: "You" takes a plural verb, so a sentence built by interpolation reads
 * "You was not subscribed to this issue." The three ADMIN notices ask for it
 * and then say what the `…/watchers/me` pair already says about that same
 * state, rather than inflecting a template.
 */
function watcherSubject(
  userById: Map<string, Pick<User, "id" | "displayName" | "color">>,
  userId: string,
  currentUserId?: string,
): { name: string; reader: boolean } {
  // Whether the map *has* them, never whether the name it holds is non-empty:
  // an empty `displayName` is the server's answer about that person, and this
  // section is not the place that overrides it.
  const person = userById.get(userId);
  if (person) return { name: person.displayName, reader: false };
  if (currentUserId && userId === currentUserId) return { name: "You", reader: true };
  return { name: "Unknown", reader: false };
}

/**
 * The second line of a watcher notice: the id that finds this failure in the
 * gateway's log, and — on a branch today's callers cannot reach, see the last
 * paragraph — the gateway's own words.
 *
 * Written here rather than reached for as `ApiNotice`, and that was the
 * argued-out call (`art-director`, TAS-193). The component would fit the read
 * slot and *only* the read slot; the two toggle writes, the add, the remove and
 * the info tone all print through the section's own `.watcher-note` box, and
 * dropping `ApiNotice` in beside them would fix one surface of six and leave a
 * second, differently-shaped error box next to the first. What is worth copying
 * is `ApiNotice`'s split — sentence live, machine strings not — which is what
 * both callers here do.
 *
 * `sentence` is what is already on screen above this line. It is a parameter
 * rather than an assumption because `watcherFailureText` *prefers* the server's
 * own message whenever there is one, so the two are usually the same string and
 * printing it twice would be an echo, not a detail.
 *
 * Which makes `gatewayWords` dead with the two callers this section has, and
 * saying so here saves the next reader looking for a line that cannot render:
 * `watcherFailureText` returns `message` whenever there is one and both call
 * sites hand that same string straight back as `sentence`, so the only words
 * this branch could print are the ones it exists to suppress. The branch stays
 * because the rule killing it lives in another function — a caller that
 * composes its own sentence, or a `watcherFailureText` that stops preferring
 * the server's, and it renders again — and because `null` is also the honest
 * answer for an error that is not an `ApiError` at all.
 */
function WatcherNoteDetail({ error, sentence }: { error: unknown; sentence?: string }) {
  const { message, requestId } = apiErrorFacts(error);
  const gatewayWords = message && message !== sentence ? message : null;
  if (!gatewayWords && !requestId) return null;

  return (
    <p className="watcher-note-detail">
      {gatewayWords ? <span>{gatewayWords}</span> : null}
      {requestId ? <RequestId value={requestId} /> : null}
    </p>
  );
}

/**
 * What to say when a watcher write is refused.
 *
 * The server's own sentence wins whenever it sent one — both implementations
 * do, so this is the ordinary path. The `403` arm is for a gateway that refuses
 * without a message, and it exists because a refusal on these two routes is the
 * one failure the reader can actually act on: the controls were offered because
 * `isProjectAdmin` said so, and the server disagreed.
 *
 * Because the server's sentence wins, it is also the sentence the detail line
 * above must not repeat — `WatcherNoteDetail` takes it as a parameter for
 * exactly that reason, and the two functions have to move together.
 *
 * Deliberately not `isMissingOrForbidden`, which folds 403 into 404 because
 * DESIGN.md §4.18 requires a *screen* not to tell "missing" from "not yours".
 * That rule is about what a visitor may learn from a page they cannot see; here
 * the issue is already open and readable, so the two answers mean different
 * things and are worth different sentences.
 */
function watcherFailureText(error: unknown, fallback: string): string {
  const { message, status, code } = apiErrorFacts(error);
  if (message) return message;
  if (status === 403 || code === "PERMISSION_DENIED") {
    return "The server refused: only a project admin may change who else watches this issue.";
  }
  return fallback;
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
  const attachable = projectLabels.filter(
    (label) => !attached.has(label.id) && !isPendingLabel(label),
  );

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
    onError: (_error, labelId, context) => {
      if (context?.previous) queryClient.setQueryData(labelsKey, context.previous);
      // The rollback puts the label back in the picker, so put the choice back
      // with it — unless something else has been chosen since, which is the
      // one thing this must never overwrite.
      setPicked((current) => (current === "" ? labelId : current));
    },
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

  // Mutations first, reads second. A react-query observer can hold data *and*
  // an error at once — a cached list plus a failed background refetch — and in
  // that state the picker is still populated, so an add that the server refused
  // would otherwise be explained by whatever the refetch said instead. A
  // mutation error is always about the action just taken; a query error is
  // about the background.
  const error =
    (addLabel.error ?? removeLabel.error ?? labelsQuery.error ?? projectLabelsQuery.error)?.message;

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
            if (!picked) return;
            addLabel.mutate(picked);
            // The picker resets here, in the submit handler, and nowhere later.
            // It used to reset in the mutation's `onSuccess`, a round trip after
            // the press — and by then the reset had nothing left to do, because
            // the option just added leaves the picker the moment the optimistic
            // list includes it and the browser drops the selection itself. All
            // a late reset could still reach was a label chosen in the
            // meantime, and it took it silently: choice gone, Add button dead
            // because `picked` was empty again, nothing on screen saying why.
            // `onMutate` is not late enough to be wrong but not early enough to
            // be right either — react-query runs it a microtask after this — so
            // the reset belongs in the same synchronous handler that read the
            // value.
            setPicked("");
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
  canEdit,
}: {
  projectId: string;
  issueId: string;
  canEdit: boolean;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const relationLabelId = useId();
  const [linkType, setLinkType] = useState<IssueLinkType>("BLOCKS");
  const [targetIssueId, setTargetIssueId] = useState("");
  // Refused before the request goes out; the server stays the authority.
  const [localError, setLocalError] = useState<string | null>(null);

  // Its own read of the project, deliberately not the board's page behind the
  // panel. Since TAS-169 the board's key carries its label filter and the
  // server applies it, so borrowing that page would let a filter decide which
  // issues may be linked to and turn every existing link pointing outside it
  // into a bare id. `"ALL"` is the *same cache entry* the board already holds
  // whenever no filter is set, so this costs nothing in the common case and
  // one extra read only while a filter is on and a panel is open. The page is
  // still a page: an issue beyond `pageSize` resolves to its id (see the row
  // below), which is the honest answer on a project this large.
  const projectIssuesQuery = useQuery({
    queryKey: ["issues", projectId, "ALL"],
    queryFn: () => taskaApi.listIssues(projectId, { pageSize: 100 }),
    retry: retryUnlessMissing,
  });
  const issues = useMemo(() => projectIssuesQuery.data?.items ?? [], [projectIssuesQuery.data]);

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
    onError: (_error, input, context) => {
      if (context?.previousLinks) {
        queryClient.setQueryData(linksKey, context.previousLinks);
      }
      setTargetIssueId((current) => (current === "" ? input.targetIssueId : current));
    },
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
  // `projectIssuesQuery` is in here because its failure is otherwise silent:
  // with a filter on it is a different query from the board's, so the board's
  // own notice does not cover it, and the only trace left would be a picker
  // offering nothing and rows showing ids — which is what "this issue has no
  // links worth naming" looks like.
  //
  // Mutations are read before the two queries for the same reason as in
  // `IssueLabelsSection`: with a cached page plus a failed background refetch
  // the picker is still populated, so a refused link would be explained by the
  // refetch rather than by the refusal.
  const error =
    localError ??
    (createLink.error ?? deleteLink.error ?? linksQuery.error ?? projectIssuesQuery.error)?.message;

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
            // Same reason as the label picker above: the reset happens with the
            // press, never on the server's answer, because the optimistic row
            // takes this target out of the picker immediately and anything the
            // answer resets is a choice made after it.
            setTargetIssueId("");
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

/** Which leg of the three-legged upload is in flight, for the row that stands in for it. */
type AttachmentUploadStep = "signing" | "uploading" | "confirming";

/** What that row says while each leg runs. Named for what is happening, not for a percentage. */
const attachmentStepText: Record<AttachmentUploadStep, string> = {
  signing: "Preparing…",
  uploading: "Uploading…",
  confirming: "Saving…",
};

/**
 * A sentence about something the reader just did, and the tone it is said in.
 * `info` is for the two outcomes that are not failures: the confirm that failed
 * in transit while succeeding on the server, and the download tab the browser
 * refused to open when the link itself is fine. Calling either an error would
 * tell the reader the opposite of what happened.
 */
interface AttachmentNotice {
  tone: "error" | "info";
  text: string;
}

/**
 * `GET/POST/DELETE /projects/{projectId}/issues/{issueId}/attachments` and the
 * two extra routes the upload needs — plus one leg that is not a route at all.
 *
 * Three things make this section different from the links and labels sections
 * it sits beside, and each of them shows in the code:
 *
 * 1. **An upload is three calls, and the middle one does not touch Taska.** The
 *    browser PUTs the bytes straight to the object store at a presigned URL. So
 *    a failure has to say *which* leg failed, and a failure with no HTTP status
 *    at all — the shape a blocked cross-origin preflight takes — has to be
 *    named as the network-or-CORS problem it is rather than reported as
 *    "upload failed".
 * 2. **The confirm is not retryable and not optimistic.** `object_key` has no
 *    unique constraint and the insert is unconditional, so a repeat is a
 *    duplicate row, a duplicate history entry and a duplicate outbox event. The
 *    control is disabled for the duration and the call is wrapped in no retry —
 *    and after *any* confirm failure the list is re-read before anybody is told
 *    the file was not attached, because a confirm can succeed on the server and
 *    fail on the way back.
 * 3. **Delete is gated per row, not per section.** Your own attachment needs
 *    `ADMIN` or `MEMBER`; somebody else's needs `ADMIN`.
 *
 * Deletes *are* optimistic with rollback, like every other mutation here: that
 * one is a single call whose outcome the client can predict.
 */
function IssueAttachmentsSection({
  projectId,
  issueId,
  canEdit,
  isProjectAdmin,
  currentUserId,
  userById,
}: {
  projectId: string;
  issueId: string;
  canEdit: boolean;
  isProjectAdmin: boolean;
  currentUserId?: string;
  userById: Map<string, Pick<User, "id" | "displayName" | "color">>;
}) {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ fileName: string; sizeBytes: number; step: AttachmentUploadStep } | null>(null);
  const [notice, setNotice] = useState<AttachmentNotice | null>(null);
  /**
   * A resolved download link the browser would not open for us. Only ever set
   * when `window.open` came back `null`, which is the popup blocker's one
   * honest signal — so the fallback anchor appears exactly when it is needed
   * and never clutters a row that worked.
   */
  const [blockedDownload, setBlockedDownload] = useState<{ id: string; url: string } | null>(null);

  const attachmentsKey = useMemo(() => ["issue-attachments", projectId, issueId], [projectId, issueId]);
  const attachmentsQuery = useQuery({
    queryKey: attachmentsKey,
    queryFn: () => taskaApi.listAttachments(projectId, issueId),
    retry: retryUnlessMissing,
  });
  const attachments = useMemo(() => attachmentsQuery.data ?? [], [attachmentsQuery.data]);

  /**
   * The list, and the panel's issue read for the sake of the activity feed: an
   * upload and a delete each write an `ATTACHMENT_UPLOADED` /
   * `ATTACHMENT_DELETED` history row, so leaving the issue query alone would
   * leave the feed one event behind the list directly above it.
   */
  const settle = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: attachmentsKey }),
      queryClient.invalidateQueries({ queryKey: ["issue", projectId, issueId] }),
    ]);

  const deleteAttachment = useMutation({
    mutationFn: (attachmentId: string) => taskaApi.deleteAttachment(projectId, issueId, attachmentId),
    onMutate: async (attachmentId) => {
      setNotice(null);
      await queryClient.cancelQueries({ queryKey: attachmentsKey });
      const previous = queryClient.getQueryData<IssueAttachment[]>(attachmentsKey);
      queryClient.setQueryData<IssueAttachment[]>(attachmentsKey, (current) =>
        (current ?? []).filter((item) => item.id !== attachmentId),
      );
      return { previous };
    },
    onError: (error, _attachmentId, context) => {
      if (context?.previous) queryClient.setQueryData(attachmentsKey, context.previous);
      setNotice({ tone: "error", text: apiErrorFacts(error).message ?? "The attachment could not be removed." });
    },
    onSettled: settle,
  });

  const download = useMutation({
    mutationFn: (attachment: IssueAttachment) =>
      taskaApi.getAttachmentDownloadUrl(projectId, issueId, attachment.id),
    onMutate: () => {
      setNotice(null);
      setBlockedDownload(null);
    },
    onSuccess: (link, attachment) => {
      if (!link.downloadUrl) {
        setNotice({ tone: "error", text: `No download link came back for ${attachment.fileName}.` });
        return;
      }
      // A presigned GET on the object store, so this leaves the app rather than
      // fetching bytes here: `noopener,noreferrer` because the destination is a
      // server we do not control. `window.open` returning `null` is the popup
      // blocker saying no — the only reliable way to hear it — and the row then
      // offers the link as something to click directly.
      const opened = window.open(link.downloadUrl, "_blank", "noopener,noreferrer");
      if (!opened) {
        setBlockedDownload({ id: attachment.id, url: link.downloadUrl });
        // Said out loud, because otherwise this is the one outcome nobody is
        // told about: `onMutate` has just emptied the live region, pressing
        // Enter opened nothing, and a new tab stop appeared in the row without
        // a word. Not an error — the link is real and good for fifteen minutes.
        setNotice({
          tone: "info",
          text: `Your browser blocked the download tab for ${attachment.fileName}. Use the Open link beside it.`,
        });
      }
    },
    onError: (error) => {
      setNotice({ tone: "error", text: apiErrorFacts(error).message ?? "The download link could not be created." });
    },
  });

  /**
   * The whole upload, written out rather than wrapped in a mutation, because
   * its outcomes do not fit "resolved or rejected": one of them is *"the file
   * was attached even though this failed"*, and another is *"nobody can say
   * either way"*. Each leg is awaited on its own so the sentence names the leg
   * that failed.
   */
  const runUpload = async (file: File) => {
    setNotice(null);
    setBlockedDownload(null);
    const candidate = { fileName: file.name, contentType: file.type, sizeBytes: file.size };

    // The picker's `accept` filters by the operating system's idea of a type
    // and `File.type` is the browser's, so this is not a duplicate of it: a
    // `.zip` reported as `application/x-zip-compressed`, or an extensionless
    // file reported as `application/octet-stream`, gets past `accept` and is
    // stopped here, before a request.
    const refusal = attachmentRefusalKind(candidate);
    if (refusal) {
      setNotice({ tone: "error", text: refusalText(refusal, file) });
      return;
    }

    setPending({ fileName: file.name, sizeBytes: file.size, step: "signing" });

    let ticket;
    try {
      // Leg 1, and the moment the fifteen-minute clock starts. Asked for now
      // rather than when the panel opened, precisely so that clock is short.
      ticket = await taskaApi.createAttachmentUploadUrl(projectId, issueId, candidate);
    } catch (error) {
      setPending(null);
      setNotice({
        tone: "error",
        text: `${file.name} was not attached. ${apiErrorFacts(error).message ?? "The upload could not be prepared."}`,
      });
      return;
    }

    setPending((current) => (current ? { ...current, step: "uploading" } : current));
    try {
      // Leg 2. `candidate.contentType` and not `file.type` re-read — same value
      // today, but this is the one place where sending something even slightly
      // different from what was signed produces a 403 nobody can diagnose.
      await taskaApi.putAttachmentBytes(ticket.uploadUrl, file, candidate.contentType);
    } catch (error) {
      setPending(null);
      setNotice({ tone: "error", text: uploadFailureText(error, file.name) });
      return;
    }

    setPending((current) => (current ? { ...current, step: "confirming" } : current));
    // Counted before the confirm, so the check afterwards asks "is there one
    // *more* of these" rather than "is there one at all" — attachments with the
    // same name are allowed, and the server itself creates duplicates.
    const before = countByName(queryClient.getQueryData<IssueAttachment[]>(attachmentsKey), file.name);
    try {
      // Leg 3. No retry, here or anywhere below it: a repeat is a second row.
      await taskaApi.confirmAttachmentUpload(projectId, issueId, {
        objectKey: ticket.objectKey,
        fileName: file.name,
        contentType: candidate.contentType,
      });
      setPending(null);
      await settle();
      return;
    } catch (error) {
      setPending(null);
      // The confirm failed — but a confirm can succeed on the server and fail
      // on the way back, so nobody is told the file was not attached until the
      // list has been re-read and looked at. Getting this wrong states a
      // falsehood about a file that is sitting right there.
      let landed: IssueAttachment[] | null;
      try {
        landed = await queryClient.fetchQuery({
          queryKey: attachmentsKey,
          queryFn: () => taskaApi.listAttachments(projectId, issueId),
          staleTime: 0,
        });
      } catch {
        landed = null;
      }
      await queryClient.invalidateQueries({ queryKey: ["issue", projectId, issueId] });

      if (landed === null) {
        // Two unknowns and no way to resolve either. Claiming failure here
        // would be a guess with a one-in-two chance of being a lie.
        setNotice({
          tone: "error",
          text: `${file.name} may or may not have been attached: the confirmation failed and the list could not be re-read. Reopen this issue to check.`,
        });
        return;
      }
      if (countByName(landed, file.name) > before) {
        setNotice({
          tone: "info",
          text: `${file.name} was attached after all — the confirmation did not reach us, but the server recorded it.`,
        });
        return;
      }
      setNotice({
        tone: "error",
        text: `${file.name} was not attached. ${apiErrorFacts(error).message ?? "The upload could not be confirmed."}`,
      });
    }
  };

  /**
   * Mutations and the upload first, the query second — the same ordering rule
   * the labels section states: an observer can hold data *and* a failed
   * background refetch at once, and in that state a message about the refetch
   * would explain an action the reader just took.
   */
  const readError = attachmentsQuery.error;
  const undeployed = isUndeployedRoute(readError, UNDEPLOYED_ROUTE_MESSAGE);

  return (
    <section className="issue-attachments">
      <h3>
        Attachments
        {attachments.length ? <span className="count-pill">{attachments.length}</span> : null}
      </h3>

      {canEdit && !undeployed ? (
        <div className="attachment-picker">
          {/* Driven by the button beside it rather than styled directly: a
              `::file-selector-button` keeps the browser's own "No file chosen"
              text, and a visually-hidden but focusable input puts a tab stop
              where nothing is visible. `hidden` takes it out of the tab order
              entirely, and the button is a real button with §4.1's focus ring. */}
          <input
            accept={ATTACHMENT_ACCEPT_ATTRIBUTE}
            className="attachment-input"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Cleared straight away so choosing the same file twice — after a
              // failure, which is exactly when someone would — still fires a
              // change event.
              event.target.value = "";
              if (file) void runUpload(file);
            }}
            ref={fileInput}
            type="file"
          />
          <button
            className="secondary-button compact-button"
            disabled={pending !== null}
            onClick={() => fileInput.current?.click()}
            type="button"
          >
            <Paperclip size={13} />
            Attach a file
          </button>
          {/* Said before a file is chosen, not after it is refused. The list is
              stricter than people expect — no .docx, no GIF, no SVG, nothing
              without an extension — and the picker's own filter cannot be
              trusted to enforce it. */}
          <p className="attachment-hint">
            Up to {formatFileSize(ATTACHMENT_MAX_SIZE_BYTES)}. {ATTACHMENT_ACCEPTED_SUMMARY}.
          </p>
        </div>
      ) : null}

      {/* One live region that stays mounted and changes its text, rather than a
          region that appears together with what it has to announce — §7 records
          the second shape as depending on screen-reader timing, and this
          section is new enough not to have to inherit it. Polite, not assertive:
          the sentence always follows something the reader just did, and an
          `alert` would cut across whatever they are reading. Empty, it carries
          no class and takes no space. */}
      <div aria-live="polite" className={notice ? `attachment-note${notice.tone === "error" ? " is-error" : ""}` : ""}>
        {notice?.text ?? ""}
      </div>

      {/* A 404 from this list has more than one cause — a missing issue, a
          soft-deleted one, and a gateway that has not deployed these routes —
          so it is never read as "this issue is gone" and never hides the
          section. Only the undeployed signature gets its own quiet sentence;
          everything else is shown as the failure it was. */}
      {undeployed ? (
        <p className="issue-links-empty">
          Attachments are not on this gateway yet, so this issue&rsquo;s files cannot be listed (backend TAS-131).
        </p>
      ) : null}
      {readError && !undeployed ? <div className="attachment-note is-error">{readError.message}</div> : null}

      {attachmentsQuery.isPending ? <p className="issue-links-empty">Loading attachments</p> : null}
      {/* Only a successful empty answer may say there are none. */}
      {attachmentsQuery.isSuccess && attachments.length === 0 && !pending ? (
        <p className="issue-links-empty">No attachments yet</p>
      ) : null}

      {attachments.length || pending ? (
        <ul className="attachment-list">
          {attachments.map((attachment) => {
            const uploader = userById.get(attachment.uploadedBy);
            // Two rules, not one. Your own file needs ADMIN or MEMBER; somebody
            // else's needs ADMIN. An attachment whose uploader the response left
            // blank is treated as somebody else's, which is the safer of the two
            // readings. The server checks all of this again regardless.
            const mine = Boolean(currentUserId) && attachment.uploadedBy === currentUserId;
            const canDelete = mine ? canEdit : isProjectAdmin;
            const removing = deleteAttachment.isPending && deleteAttachment.variables === attachment.id;
            return (
              <li className="attachment-row" key={attachment.id || attachment.fileName}>
                <button
                  aria-label={`Download ${attachment.fileName}`}
                  className="attachment-open"
                  // An attachment the response left unaddressable cannot be
                  // asked for: the request would name no attachment. The row
                  // still shows — the file is on the issue either way.
                  disabled={!attachment.id || (download.isPending && download.variables?.id === attachment.id)}
                  onClick={() => download.mutate(attachment)}
                  type="button"
                >
                  <Download className="attachment-icon" size={14} />
                  <span className="attachment-name">{attachment.fileName || "Unnamed file"}</span>
                  <span className="attachment-meta">
                    {formatFileSize(attachment.sizeBytes)}
                    {uploader ? ` · ${uploader.displayName}` : ""}
                    {attachment.createdAt ? ` · ${formatDateTime(attachment.createdAt)}` : ""}
                  </span>
                </button>
                {blockedDownload?.id === attachment.id ? (
                  // The browser refused to open the tab for us. The link is
                  // real and good for fifteen minutes, so it is offered rather
                  // than swallowed.
                  <a className="attachment-blocked-link" href={blockedDownload.url} rel="noopener noreferrer" target="_blank">
                    Open
                  </a>
                ) : null}
                {canDelete ? (
                  <button
                    aria-label={`Delete ${attachment.fileName}`}
                    className="icon-button"
                    disabled={!attachment.id || removing}
                    onClick={() => deleteAttachment.mutate(attachment.id)}
                    type="button"
                  >
                    <Trash2 size={14} />
                  </button>
                ) : null}
              </li>
            );
          })}

          {pending ? (
            // The optimistic row. Not put in the query cache like the label and
            // link sections do, because there is nothing server-shaped to put
            // there yet: no id, no object key, and — until leg 3 answers — no
            // row on the server to reconcile with. DESIGN.md §5.6 asks for no
            // spinner in content, and a named leg says more than a bar that
            // fills instantly under a 2 MB ceiling would.
            <li className="attachment-row is-pending" key="attachment-pending">
              <span className="attachment-open is-inert">
                <Paperclip className="attachment-icon" size={14} />
                <span className="attachment-name">{pending.fileName}</span>
                <span className="attachment-meta">
                  {formatFileSize(pending.sizeBytes)} · {attachmentStepText[pending.step]}
                </span>
              </span>
            </li>
          ) : null}
        </ul>
      ) : null}
    </section>
  );
}

/**
 * What to say about a file this side refused **before leg 1** — the only
 * failures in this section a reader meets without a server having spoken. Two
 * of the three fire in practice: an unaccepted type, and a file over the
 * ceiling.
 *
 * They get their own sentences rather than `attachmentRefusal`'s, which is the
 * server's wording verbatim. Parity was the argument for reusing it and parity
 * is not what it bought: these arms are produced here, and the same refusals
 * arriving *from* the gateway come through `apiErrorFacts` under a
 * `"<name> was not attached. "` prefix, so the two paths already read
 * differently. What the verbatim strings cost is the reader —
 * `"File size 2097153 bytes exceeds maximum allowed size of 2097152 bytes"`
 * corrects in bytes a person who was told "Up to 2 MB" six lines above, and
 * neither string names the file. Every other sentence in this section does.
 *
 * The accepted list is `ATTACHMENT_ACCEPTED_SUMMARY`, the same constant the
 * hint above the picker prints, so the promise and the refusal cannot drift.
 *
 * **"Just over" is not a flourish.** `formatFileSize` is binary and rounds to
 * one decimal, so a file one byte over the ceiling formats as "2 MB" — exactly
 * the same string as the ceiling. Printing both would read "huge.png is 2 MB.
 * The largest file this issue accepts is 2 MB", which is a sentence that
 * argues with itself. The two are compared as they will be *printed*, and the
 * one case where they agree gets a phrasing that is true.
 */
function refusalText(kind: AttachmentRefusalKind, file: File) {
  if (kind === "type") {
    return `${file.name} is not a type this issue accepts. Attach ${ATTACHMENT_ACCEPTED_SUMMARY}.`;
  }
  if (kind === "empty") {
    return `${file.name} is empty, so there is nothing to attach.`;
  }
  const size = formatFileSize(file.size);
  const ceiling = formatFileSize(ATTACHMENT_MAX_SIZE_BYTES);
  return size === ceiling
    ? `${file.name} is just over ${ceiling}, which is the largest file this issue accepts.`
    : `${file.name} is ${size}. The largest file this issue accepts is ${ceiling}.`;
}

/** How many attachments in this list carry that file name. See the confirm path. */
function countByName(attachments: IssueAttachment[] | undefined, fileName: string) {
  return (attachments ?? []).filter((item) => item.fileName === fileName).length;
}

/**
 * What to say when the **middle** leg failed — the PUT that goes straight to
 * the object store and never reaches Taska.
 *
 * The three cases are genuinely different problems and reading them as one
 * "upload failed" is what this function exists to prevent:
 *
 * - **no status at all.** `fetch` rejected without a response, which is what a
 *   cross-origin preflight refusal looks like from script — the spec gives the
 *   page no way to learn that is what happened. Being offline looks identical,
 *   so the sentence names the possibilities instead of choosing one, and says
 *   where the request was going, because "storage" being a different server
 *   from Taska is the fact that makes it make sense.
 * - **403.** The signature stopped being accepted. Fifteen minutes from the
 *   moment the file was chosen, or a `Content-Type` that did not match what was
 *   signed — either way, not a permission problem and not something the same
 *   link will ever survive. Choosing the file again mints a new one.
 * - **anything else.** The store's own status, printed as the store's.
 *
 * And one that is not a failure of the store at all: the link leg 1 handed back
 * was not a link, so nothing was sent. It is here rather than at leg 1 because
 * that is where it is caught — see `requireUsableUploadUrl` — and it must not
 * borrow the CORS sentence, which would name a cause that was never reached.
 */
function uploadFailureText(error: unknown, fileName: string) {
  const failure = attachmentUploadFailure(error);
  if (!failure) {
    return `${fileName} was not uploaded. ${apiErrorFacts(error).message ?? "The upload failed."}`;
  }
  if (failure.kind === "unusable") {
    return `${fileName} was not uploaded: the upload link that came back was unusable, so nothing was sent. Choose the file again to retry.`;
  }
  if (failure.kind === "blocked") {
    return `${fileName} was not uploaded: the browser could not reach the file store. This upload goes straight to storage rather than through Taska, so a network problem or the storage server's cross-origin rules can stop it before it starts.`;
  }
  if (failure.kind === "expired") {
    return `${fileName} was not uploaded: the file store would not accept the upload link. A link lasts 15 minutes from the moment the file is chosen — choose it again to retry.`;
  }
  return `${fileName} was not uploaded: the file store answered ${failure.storeStatus}.`;
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
  userById: Map<string, Pick<User, "id" | "displayName" | "color">>;
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
  author?: Pick<User, "id" | "displayName" | "color">;
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
  user: Pick<User, "id" | "displayName" | "color"> | null;
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
  user?: Pick<User, "id" | "displayName" | "color">;
  userById: Map<string, Pick<User, "id" | "displayName" | "color">>;
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
 * A label the server has not answered for yet, and therefore one no picker may
 * offer. The optimistic row exists so the *list* looks right the instant a
 * label is created — that is all it is for. It is not an address: every route
 * that takes a label id types it `format: uuid`, so submitting the placeholder
 * is "Label not found" from the mock and a 400 from the gateway. A row that
 * cannot be acted on yet is not the same as one that can, and a control that
 * offers it is offering an action that cannot succeed.
 *
 * The window is short — one create round trip — but it is exactly the window
 * in which someone who just made a label reaches for it.
 */
const isPendingLabel = (label: { id: string }) => label.id === optimisticLabelId;

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
  projectColor,
  onClose,
  onLabelDeleted,
}: {
  projectId: string;
  projectKey: string;
  /**
   * Only so the eyebrow badge matches the one in the topbar behind this modal.
   * Passed rather than recomputed from the key: a colour the server stated wins
   * over the computed one (`keyBadgeStyle`), and a modal that skipped the
   * argument would agree with the board only until the first project that has
   * one — TAS-148.
   */
  projectColor?: string;
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
    onError: (_error, input, context) => {
      if (context?.previous) queryClient.setQueryData(labelsKey, context.previous);
      // Put the typed name back with the rolled-back row — unless something has
      // been typed since, which is the one thing this must never overwrite. A
      // name is worth restoring where a picked option was only worth offering:
      // the likeliest failure here is the duplicate-name refusal, and the field
      // the user has to edit to get past it is the one they just lost.
      setName((current) => (current === "" ? input.name : current));
    },
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
    // The close stays on the answer — an early one would shut the editor before
    // the save landed, and a refused save would then report its error with
    // nothing open to fix it in. What it does not stay is unconditional: a row
    // opened during the round trip is not the row this save was about, and
    // closing it would throw away a name being typed right now. Same hazard as
    // the three resets above, answered with a guard instead of a move.
    onSuccess: (_result, input) =>
      setEditing((current) => (current?.id === input.id ? null : current)),
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
  const badge = keyBadgeStyle(projectKey, projectColor);

  return (
    <Modal
      title="Labels"
      // No badge rather than an empty one when the project could not be read
      // (TAS-163): `keyBadgeStyle` withholds the colour in that case, and a
      // pill with neither a key inside it nor a colour on it is a chip someone
      // forgot to fill in, not a quieter way of saying the same thing.
      eyebrow={
        badge ? (
          <span className="key-badge" style={badge}>
            {projectKey}
          </span>
        ) : undefined
      }
      onClose={onClose}
    >
      <form
        className="label-create-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!trimmed) return;
          createLabel.mutate({ name: trimmed, color });
          // Cleared here rather than in the mutation's `onSuccess`, for the
          // reason the label and link pickers carry above: a reset that lands
          // with the server's answer lands on whatever was typed during the
          // round trip and takes it. Third and last of the three inputs that
          // were reset on the answer — `updateLabel` below still closes the
          // rename row from `onSuccess`, which is a mode change rather than a
          // reset of a value this handler read, and moving it would close the
          // editor before the save landed. It shares the hazard all the same,
          // a write arriving late enough to land on something newer, and is
          // guarded there rather than moved.
          setName("");
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
          const pending = isPendingLabel(label);
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

/**
 * The colour choices: one is picked, never several.
 *
 * A group of `aria-pressed` buttons rather than an ARIA radio group, matching
 * the segmented controls elsewhere in this file. `role="radio"` would announce
 * a keyboard contract this does not implement — arrow keys moving the
 * selection within a single tab stop — and a promise of an interaction nobody
 * wrote is worse than the plainer control that behaves as it reads.
 *
 * The ring on the active swatch is not decoration: a checked state that only a
 * colour expressed would be unreadable to exactly the people §4.6 exists for.
 */
function LabelSwatches({ onPick, selected }: { onPick: (color: string) => void; selected: string }) {
  return (
    <div aria-label="Label colour" className="label-swatches" role="group">
      {labelColorChoices.map((choice) => (
        <button
          aria-label={`Colour ${choice}`}
          aria-pressed={selected === choice}
          className={`label-swatch ${selected === choice ? "is-active" : ""}`}
          key={choice}
          onClick={() => onPick(choice)}
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
  projectColor,
  onClose,
  onCreated,
}: {
  projectId: string;
  projectKey: string;
  /** Same reason as `ProjectLabelsModal`: one key, one colour, on every surface. */
  projectColor?: string;
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

  const badge = keyBadgeStyle(projectKey, projectColor);

  return (
    <Modal
      title="New issue"
      // Same as `ProjectLabelsModal`: an unstyled pill would be an empty chip.
      eyebrow={
        badge ? (
          <span className="key-badge" style={badge}>
            {projectKey}
          </span>
        ) : undefined
      }
      onClose={onClose}
    >
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
          // The membership row carries the id, the nested summary does not —
          // and the id is what an avatar's colour is computed from.
          id: member.userId,
          displayName: member.user!.displayName,
          color: member.user!.color,
        },
      ]),
  );
}

function historyText(event: IssueHistoryEvent, userById: Map<string, Pick<User, "id" | "displayName" | "color">>) {
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
  // `PayloadSerializer` puts `fileName` in both attachment payloads, so the
  // sentence can name the file. It is typed `unknown` through the payload's
  // index signature until it is checked, and a payload without it still gets a
  // true sentence rather than the word "undefined".
  if (event.eventType === "ATTACHMENT_UPLOADED") {
    return typeof event.payload.fileName === "string" && event.payload.fileName
      ? `attached ${event.payload.fileName}`
      : "attached a file";
  }
  if (event.eventType === "ATTACHMENT_DELETED") {
    return typeof event.payload.fileName === "string" && event.payload.fileName
      ? `removed ${event.payload.fileName}`
      : "removed a file";
  }
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
    // The bare prefix, deliberately: it catches the board's own search — whose
    // key carries the query text and the active filters — and the top bar's
    // global one, which has no `projectId` in it at all and can therefore be
    // changed by a mutation in any project.
    //
    // Without this the two halves of "X of Y" come from different moments. X is
    // read live off the issues query, which every caller here invalidates; Y is
    // `totalCount` off a search answer nothing invalidated, held for
    // `staleTime` (src/main.tsx) and keyed by a query string the reader has not
    // changed — so re-typing the same query cannot correct it either. Measured
    // against the mock: creating a matching issue printed "2 of 1" and still
    // said "2 of 1" four seconds later.
    queryClient.invalidateQueries({ queryKey: ["issue-search"] }),
  ]);
}
