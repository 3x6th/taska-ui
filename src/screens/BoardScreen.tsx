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
import {
  infiniteQueryOptions,
  keepPreviousData,
  queryOptions,
  replaceEqualDeep,
  useInfiniteQuery,
  useMutation,
  usePrefetchInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Download, ExternalLink, Eye, EyeOff, Paperclip, Pencil, Plus, Search, Shapes, Tag, Trash2, Upload, Users, Workflow as WorkflowIcon, X } from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type FocusEvent,
  type KeyboardEvent,
} from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { CreateIssueLinkInput, CreateProjectLabelInput, IssueWriteAnswer, UpdateIssueInput } from "../api/TaskaApi";
import {
  ATTACHMENT_ACCEPTED_SUMMARY,
  ATTACHMENT_ACCEPT_ATTRIBUTE,
  ATTACHMENT_MAX_SIZE_BYTES,
  attachmentRefusalKind,
  type AttachmentRefusalKind,
} from "../api/attachments";
import { ObjectStoreError, isUsableDownloadUrl, objectStoreUploadFailure } from "../api/objectStore";
import { taskaApi } from "../api/client";
import {
  apiErrorFacts,
  isIssueVersionConflict,
  isMissingOrForbidden,
  isProjectArchived,
  isTransitionConflict,
  IssueVersionConflictError,
} from "../api/errors";
import { isDatesOutOfOrderRefusal } from "../api/issuePatch";
import { STATUS_NOT_IN_TARGET_WORKFLOW_REASON } from "../api/issueTypes";
import { ApiNotice } from "../components/ApiNotice";
import { Avatar } from "../components/Avatar";
import { ColorSwatches } from "../components/ColorSwatches";
import { EditProjectModal } from "../components/EditProjectModal";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { ErrorNote } from "../components/ErrorNote";
import { LabelChip, PriorityBars, TypeChip } from "../components/IssueBits";
import { IssuePanelFrame } from "../components/IssuePanelFrame";
import { useIssuePanelHead } from "../components/issuePanelFrameContext";
import { IssueShare } from "../components/IssueShare";
import { IssueWorklogSection } from "../components/IssueWorklogSection";
import { issueWorklogsOptions } from "../components/issueWorklogsQuery";
import { Modal } from "../components/Modal";
import { NotificationsBell } from "../components/NotificationsBell";
import { ProjectIssueTypesModal } from "../components/ProjectIssueTypesModal";
import { ProjectMembersModal } from "../components/ProjectMembersModal";
import { ProjectWorkflowsModal } from "../components/ProjectWorkflowsModal";
import { RequestId } from "../components/RequestId";
import { ThemeToggle } from "../components/ThemeToggle";
import { PendingValue, Unknown } from "../components/Unknown";
import { UserProfileMenu } from "../components/UserProfileMenu";
import { useMeta } from "../hooks/useMeta";
import { carriesFiles, closeTab, openBlankTab, saveBlob, sendTabTo } from "../lib/browserFiles";
import { focusLost, tabbables } from "../lib/focusTrap";
import { personFor, type NamedBy, type Person } from "../lib/people";
import { BOARD_PAGE_SIZE_PER_COLUMN, NO_BOARD_FILTERS, boardKey, boardQueryOptions, type BoardFilters } from "../lib/boardQuery";
import { boardCards, boardHasMore, boardIssueCount, moveCardOnBoard, withCardVersion, withoutCardOnBoard } from "../lib/boardCards";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { allowedIssueTypes, projectContextKey, workflowFor } from "../lib/projectContext";
import { archivedOnDay, PROJECT_ARCHIVED_SENTENCE, refusalWords, rereadContextAfterRefusal } from "../lib/projectArchive";
import { useUnanswered } from "../hooks/useUnanswered";
import type {
  Board,
  BoardColumn as BoardColumnData,
  BoardIssue,
  DictionaryEntry,
  Issue,
  IssueAttachment,
  IssueComment,
  IssueDetailsWithHistory,
  IssueHistoryEvent,
  IssueLink,
  IssueLinkTypeCode,
  IssueWatcher,
  IssueWatchers,
  Label,
  IssuePriorityCode,
  IssueStatusKey,
  IssueTypeCode,
  ProjectContext,
  ProjectIssueType,
  ProjectMember,
  ProjectWorkflow,
  User,
  WorkflowStatus,
  WorkflowTransition,
} from "../domain/types";
import {
  actionViaText,
  commentWasEdited,
  formatDateTime,
  formatDay,
  formatFileSize,
  isKnownPriority,
  isLabelColor,
  issueLinkTypeLabel,
  issueLinkTypes,
  issuePriorities,
  issueTypeInSentence,
  issueTypeLabel,
  keyBadgeStyle,
  labelColorChoices,
  priorityLabel,
  statusColor,
  statusLabel,
  type IssueTypeRegistry,
} from "../lib/format";
import { selectableCodes } from "../lib/enumLabel";
import { transitionButtonLabel } from "../lib/workflows";
import {
  PLANNING_DATE_INCOMPLETE_CREATE_MESSAGE,
  PLANNING_EMPTY_PLACEHOLDER,
  PLANNING_ESTIMATE_HINT,
  formatDuration,
  formatStoryPoints,
  isIncompleteDateEntry,
  parseDuration,
  parseStoryPoints,
  planningDateIncompleteEditMessage,
  planningDateOrderAdvice,
  planningDrafts,
  planningInput,
  reseedPlanningDrafts,
  rollbackPlanningDrafts,
  samePlanningDrafts,
  type PlanningDateField,
  type PlanningDrafts,
} from "../lib/planning";
import { shortKey } from "./admin/columns";
import type { ScreenProps } from "./App";
import { NotFoundScreen } from "./NotFoundScreen";

/**
 * One issue type, or `null` for every type. Not an `"ALL"` sentinel any more
 * (TAS-173): the types are codes the server sends, and one spelled `ALL` would
 * have been the filter that shows everything.
 */
type IssueTypeFilter = IssueTypeCode | null;
type AssigneeFilter = string | "ALL";
/** A project label's id, or every issue whatever it carries. */
type LabelFilter = string | "ALL";
type WorkflowsByIssueType = ProjectContext["workflows"];
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
// The gateway caps `pageSize` for comments at 50.
const commentsPageSize = 50;

/*
 * The issue panel's reads (TAS-246): one for the issue and everything drawn
 * around it, one for the comments. Backend TAS-214 put the labels, watchers,
 * links and attachments on `GET /issues/{issueId}`, so the four section reads
 * the panel used to start beside the issue read (TAS-242) are gone, and opening
 * a panel is two requests whatever it holds.
 *
 * The four sections still keep their own optimistic writes, and those now
 * write into the issue's own cache entry — through `issuePartCache` — rather
 * than into four entries of their own. One entry for one read is the whole
 * point: a section that held a copy of its part would have to be told when the
 * issue was re-read, and the day it was not, two answers from two moments
 * would be on screen side by side.
 */
function issueDetailsOptions(projectId: string, issueId: string) {
  return queryOptions({
    queryKey: ["issue", projectId, issueId],
    queryFn: () => taskaApi.getIssue(projectId, issueId),
    /**
     * An answer about an **older** version of the issue never replaces a newer
     * one. A re-read that set out before a write landed can come back after the
     * write's answer was merged (`mergeWriteAnswer`), and without this it would
     * put the pre-write issue back on screen — and its version into the next
     * `If-Match`, which the server then refuses as a conflict nobody caused.
     *
     * Strictly older: an *equal* version is accepted, because the writes that
     * bump nothing — labels, watchers, links, attachments, comments — change
     * what a re-read carries without changing its version, and those re-reads
     * are how their settles land.
     *
     * This runs on `setQueryData` too, not only on a fetched answer
     * (query-core's `Query.setData` goes through `replaceData`, which calls
     * this). Harmless today — every manual write here keeps or raises the
     * version — but a future rollback that restores a *lower* version would be
     * dropped here without a word. Restore through a re-read instead.
     *
     * And on every observer's `select`ed value, which is why the version is
     * read defensively: the sections select a part — a list, a flag — that has
     * no `issue` in it, and those are shared the ordinary way.
     */
    structuralSharing: (previous: unknown, next: unknown) => {
      const before = detailsVersion(previous);
      const after = detailsVersion(next);
      if (before !== undefined && after !== undefined && after < before) return previous;
      return replaceEqualDeep(previous, next);
    },
  });
}

/** The issue's version, when `value` is a details read; `undefined` for anything else. */
function detailsVersion(value: unknown): number | undefined {
  const version = (value as { issue?: { version?: unknown } } | null | undefined)?.issue?.version;
  return typeof version === "number" ? version : undefined;
}

/**
 * A write's answer laid over the panel's cached read (TAS-246).
 *
 * Takes the issue's own fields from the answer — which is the server's word on
 * them, version included, so the next write's `If-Match` is right without a
 * re-read — and keeps everything only the details read carries: the labels
 * (the write answer's are always `[]`, see `IssueWriteAnswer`), the watchers,
 * links, attachments, `isWatching`, the comment count, the reporter and the
 * history. The re-read `invalidateBoard` starts brings those up to date.
 *
 * The assignee summary is dropped when the id moved: the cached summary names
 * the *previous* assignee, and `personFor` would print that name under the new
 * id. `null` sends it to the member list instead until the re-read names them.
 */
function mergeWriteAnswer(data: IssueDetailsWithHistory, answer: IssueWriteAnswer): IssueDetailsWithHistory {
  const issue = data.issue;
  return {
    ...data,
    issue: {
      ...issue,
      summary: answer.summary,
      description: answer.description,
      priority: answer.priority,
      assigneeId: answer.assigneeId,
      status: answer.status,
      storyPoints: answer.storyPoints,
      startDate: answer.startDate,
      dueDate: answer.dueDate,
      originalEstimateMinutes: answer.originalEstimateMinutes,
      remainingEstimateMinutes: answer.remainingEstimateMinutes,
      updatedAt: answer.updatedAt,
      version: answer.version,
      assignee: answer.assigneeId === issue.assigneeId ? issue.assignee : null,
    },
  };
}

/** The four parts of the detail read a panel section draws and writes. */
interface IssuePartValues {
  watchers: IssueWatchers;
  labels: Label[];
  links: IssueLink[];
  attachments: IssueAttachment[];
}
type IssuePart = keyof IssuePartValues;

/**
 * One section's view of the issue read: its part, `null` when the server did
 * not send the part (`IssueDetails`), and `undefined` until the issue has
 * answered. The sections mount only after it has, so the third state is the
 * type's rather than the screen's.
 */
function useIssuePart<K extends IssuePart>(projectId: string, issueId: string, part: K) {
  return useQuery({
    ...issueDetailsOptions(projectId, issueId),
    select: (data) => data.issue[part] as IssuePartValues[K] | null,
  });
}

/**
 * A section's writes against its part of the issue read — the four things an
 * optimistic write does to a cache, said about a part instead of a key.
 *
 * `cancel` and `settle` are about the whole issue read, because that is the
 * only request there is: cancelling a re-read that would land on top of an
 * optimistic change, and re-reading once the write has answered. A settle
 * therefore also refreshes the issue's history, which every one of these
 * writes appends to.
 */
function issuePartCache<K extends IssuePart>(
  queryClient: ReturnType<typeof useQueryClient>,
  projectId: string,
  issueId: string,
  part: K,
) {
  const { queryKey } = issueDetailsOptions(projectId, issueId);
  type Value = IssuePartValues[K];
  const write = (data: IssueDetailsWithHistory, value: Value | null): IssueDetailsWithHistory => ({
    ...data,
    issue: { ...data.issue, [part]: value },
  });
  return {
    /** The part as cached: `undefined` before the issue answered, `null` when the server did not send it. */
    get: (): Value | null | undefined => {
      const data = queryClient.getQueryData(queryKey);
      return data ? (data.issue[part] as Value | null) : undefined;
    },
    /**
     * Change the part. The updater sees `undefined` for a part the server did
     * not send, as it used to see an entry that had not loaded, and returning
     * `undefined` leaves the cache alone.
     */
    set: (update: (current: Value | undefined) => Value | undefined) => {
      queryClient.setQueryData(queryKey, (data) => {
        if (!data) return data;
        const next = update((data.issue[part] as Value | null) ?? undefined);
        return next === undefined ? data : write(data, next);
      });
    },
    /** Put back exactly what `get` returned before a write — `null` included. */
    restore: (previous: Value | null | undefined) => {
      if (previous === undefined) return;
      queryClient.setQueryData(queryKey, (data) => (data ? write(data, previous) : data));
    },
    cancel: () => queryClient.cancelQueries({ queryKey }),
    settle: () => queryClient.invalidateQueries({ queryKey }),
  };
}

/** Whether the issue read came back without one of the four parts (`IssueDetails`). */
function hasMissingPart(data: IssueDetailsWithHistory | undefined) {
  if (!data) return false;
  const { labels, watchers, links, attachments, isWatching } = data.issue;
  return (
    labels === null ||
    watchers === null ||
    links === null ||
    attachments === null ||
    // On this gateway a part that failed arrives as `[]` rather than `null`,
    // so the four checks above rarely fire. The watcher list is the one part
    // that can be caught anyway: the server says the reader is watching and the
    // list is empty. The watchers section draws that as a part that did not
    // load, and reopening has to re-ask for it as it does for the others.
    (isWatching === true && watchers.watchers.length === 0)
  );
}

/**
 * What a section says when the server sent the issue without its part. Not
 * "none": an absent part is a source that failed on the server's side
 * (`IssueDetails`), and "No labels yet" would be a claim about the issue the
 * answer never made.
 */
function partUnavailableText(what: string) {
  return `The ${what} could not be loaded with this issue. Reopen it to try again.`;
}

function issueCommentsOptions(projectId: string, issueId: string) {
  return infiniteQueryOptions({
    queryKey: ["comments", projectId, issueId],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => taskaApi.listComments(projectId, issueId, { page: pageParam, pageSize: commentsPageSize }),
    getNextPageParam: (lastPage, pages) => {
      const loaded = pages.reduce((total, page) => total + page.items.length, 0);
      return lastPage.items.length > 0 && loaded < (lastPage.totalCount ?? loaded) ? pages.length : undefined;
    },
  });
}

export function BoardScreen({ theme, toggleTheme, onLogout, logoutPending }: ScreenProps) {
  const { projectId = "", issueId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<IssueTypeFilter>(null);
  const [assigneeFilter, setAssigneeFilter] = useState<AssigneeFilter>("ALL");
  const [labelFilter, setLabelFilter] = useState<LabelFilter>("ALL");
  const [managingLabels, setManagingLabels] = useState(false);
  const [managingMembers, setManagingMembers] = useState(false);
  const [editingProject, setEditingProject] = useState(false);
  const [managingWorkflows, setManagingWorkflows] = useState(false);
  const [managingIssueTypes, setManagingIssueTypes] = useState(false);
  // What `NotificationsBell` hands to `useTriggerAnchor`: the bell's own box
  // never changes size, only its position, and this is the box whose resizing
  // moves it — the bar wraps to two rows below 820 and to three at 390 when
  // the project data lands. The shared bar passes its own header for the same
  // reason and gets a box that never reflows, which is the difference the
  // component's prop is documented against.
  const topbarRef = useRef<HTMLElement>(null);
  const [creating, setCreating] = useState(false);
  /**
   * The column whose "+" opened the create form (§5.5, P3′), or `null` for
   * "New". Until backend TAS-428 the server creates every issue in `TODO`, so
   * only that column offers a "+" (§4.9).
   */
  const [creatingIn, setCreatingIn] = useState<ColumnStatus | null>(null);
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

  // The board's whole frame in one read since TAS-251 (backend TAS-212): the
  // project, the reader's role, the members, the labels and one workflow per
  // issue type of the project's registry, and the registry itself (TAS-417).
  // It replaced seven requests — the project,
  // the project again for the role, the members, three workflows and the
  // labels — and it is all or nothing on the server, so every part below is
  // answered, or none is.
  const contextQuery = useQuery({
    queryKey: projectContextKey(projectId),
    enabled: Boolean(projectId),
    queryFn: () => taskaApi.getProjectContext(projectId),
    retry: retryUnlessMissing,
  });
  // The four filters as they go to the server (TAS-392, §5.4): the text after
  // a 200ms pause, trimmed, and only when it is not blank. A filter over a
  // capped column on the client would lie about the counts. Emptied — by
  // Clear, or by the reader — it is no filter at once: waiting out the pause
  // would read the old text once more under whatever else changed with it.
  const typedQuery = query.trim();
  const pausedQuery = useDebouncedValue(typedQuery, 200);
  const settledQuery = typedQuery === "" ? "" : pausedQuery;
  const filters = useMemo<BoardFilters>(
    () => ({
      issueType: typeFilter,
      assigneeId: assigneeFilter === "ALL" ? null : assigneeFilter,
      labelId: labelFilter === "ALL" ? null : labelFilter,
      query: settledQuery || null,
    }),
    [typeFilter, assigneeFilter, labelFilter, settledQuery],
  );
  // The board's issues in one read since TAS-202 (backend #205, TAS-213), in
  // parallel with the context: the columns, the cards in them and the cards
  // outside their own type's workflow, each cut at 200 with its true count
  // (TAS-392) and read under the filters. A new combination keeps the board
  // already drawn until it answers (`keepPreviousData`, §5.4); one already read
  // and fresh, and "Clear", ask nothing. The context still brings the name, the
  // role, the people, the labels and the workflows the moves are resolved
  // against; the columns are the board's.
  const boardQuery = useQuery({
    ...boardQueryOptions(projectId, filters),
    enabled: Boolean(projectId),
    placeholderData: keepPreviousData,
  });
  // The board without filters, held by its own observer whatever the filters
  // are: its sum is `Y`, and the link picker offers its cards (§5.4). The same
  // entry as `boardQuery` when nothing is filtered, so it costs no request
  // then; while filtered, a write re-reads it beside the filtered one.
  const wholeBoardQuery = useQuery({ ...boardQueryOptions(projectId, NO_BOARD_FILTERS), enabled: Boolean(projectId) });
  // The board drawn is an earlier answer while the read under new filters is
  // out — the typing pause included (§5.4): the cards do not lift, and a drop
  // made in it is not sent.
  const awaitingFilter = typedQuery !== settledQuery || boardQuery.isPlaceholderData;
  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => taskaApi.getCurrentUser(),
  });

  const context = contextQuery.data;
  const project = context?.project;
  // Memoized so the `?? []` fallback does not produce a new array identity on
  // every render and invalidate the memos below.
  const members = useMemo(() => context?.members ?? [], [context]);
  const board = boardQuery.data;
  // Every card the board read drew — the columns' and the group's — which is
  // what a card is looked up in.
  const cards = useMemo(() => (board ? boardCards(board) : []), [board]);
  const projectLabels = useMemo(() => context?.labels ?? [], [context]);
  const workflows = context?.workflows;
  // The project's issue-type registry (TAS-417), in the server's order: every
  // type's name, colour and icon, and the order the filter, the create form
  // and the panel offer them in. `undefined` until the context answers.
  const registry = context?.issueTypes;
  const offeredIssueTypes = useMemo(() => allowedIssueTypes(context), [context]);
  // A type that leaves the registry resets the filter to "All" (§5.4) — during
  // render, like `useUnanswered`, so the board never draws a frame filtered by
  // a type the select no longer offers.
  if (typeFilter !== null && context && !offeredIssueTypes.includes(typeFilter)) setTypeFilter(null);
  // `undefined` until the context answers, and `null` once it has answered
  // with no role this build can act on (`ProjectContext.role`). Every
  // permission below and the unstated-role banner read this one value.
  const role = context?.role;
  // The project was archived (backend PR #159, TAS-149): read off the same
  // context read as the role, and the only signal — a refusal never stands in
  // for it (§5.7, «Архивный проект»). Every role, ADMIN included, then gets the
  // VIEWER's board: each permission below is off, and the controls a VIEWER
  // has hidden are hidden. An archived project's reads stay open, so nothing
  // else on the board changes.
  const archivedAt = project?.archivedAt ?? null;
  const archived = archivedAt !== null;
  const canEdit = !archived && (role === "ADMIN" || role === "MEMBER");
  // Creating needs a type to create, and a project that allows none has none.
  const canCreate = canEdit && offeredIssueTypes.length > 0;
  // Narrower than `canEdit` on purpose: TAS-119 lets a MEMBER put labels on an
  // issue but reserves creating, renaming and deleting the project's labels for
  // its ADMIN. The server enforces both; this only decides what is offered.
  const isProjectAdmin = !archived && role === "ADMIN";
  // issue-service's `watch-issue-roles` (ADMIN, MEMBER), which it checks against
  // the reader's own role when they watch or unwatch themselves — a rule the
  // contract does not state (TAS-226). The same two roles as `canEdit` today,
  // and a name of its own because it is a separate rule on the server that can
  // move without the other.
  const canWatch = !archived && (role === "ADMIN" || role === "MEMBER");
  // A reader the server *named* a VIEWER, as against one it named nothing. Only
  // this reader may be told that their role is the reason a control is off —
  // and only this reader's write controls are hidden rather than switched off
  // (§5.7, TAS-236): New, the column "+", the transition buttons and Delete.
  // A role that is unknown or unstated (TAS-226) is not a VIEWER, so those
  // stay on screen, disabled, under the board's banner.
  const isProjectViewer = role === "VIEWER";
  // Whose write controls are hidden rather than switched off: a VIEWER's, and
  // anybody's on an archived project — there is nothing to wait for there.
  const hidesWrites = isProjectViewer || archived;
  // Each of these is the same single fact as the behaviour beside it, never a
  // second opinion about the same query: `canEdit` is "the membership answer
  // says so", and `roleUnread.unanswered` is "there is no membership answer and
  // asking has failed". Deriving the two from different facets of the query —
  // `data?.role` for one, `isError` for the other — is what made the banner
  // disappear on every refetch while the controls stayed off, and made it
  // appear over a board that was fully writable (see `useUnanswered`).
  //
  // Since TAS-251 the project, the role, the members, the labels and the
  // workflow are one read, so they are one fact: each name below is that
  // read's answer, kept apart only for what each one switches off.
  const contextUnread = useUnanswered(contextQuery);
  // A 404 or 403 from the context is the server saying the project is not
  // there or not ours, and §4.18 says so. It no longer stands in for an
  // unreadable avatar: the context names its members through auth-service as
  // `GET /members` does, and since TAS-225 a presign that fails drops that one
  // member's avatar rather than the whole read (read at backend develop
  // `398285cde074`). The board does not second-guess either answer.
  const projectGone = contextUnread.unanswered && isMissingOrForbidden(contextUnread.error);
  const roleUnread = contextUnread;
  const issuesUnread = useUnanswered(boardQuery);
  const workflowUnread = contextUnread;
  const labelsUnread = contextUnread;
  // Read by the watchers section and by nothing else so far. Everywhere else a
  // failed member read is *already* legible — the assignee chip row simply has
  // no chips and the reporter line says "Unknown" — but a picker of people to
  // subscribe would be an empty `<select>` under the words "Add a watcher",
  // which reads as "this project has nobody left to add" (§5.6: only a
  // successful read may say there are none). This is what tells the two apart.
  const membersUnread = contextUnread;
  // "The server never told us your role" and "you are a VIEWER" are different
  // states, and only one of them is a permission. Both end in a board nobody
  // can write to — the server stays the authority, so write access we could
  // not verify is not ours to grant (AGENTS.md) — but a read-only board
  // presented without a word is what made TAS-163 invisible. This says which
  // of the two it is; it never invents a role.
  const roleUnknown = roleUnread.unanswered;
  // The other way to have no role: the read answered and named none this build
  // can act on. Until TAS-226 the rest leg turned that into VIEWER, so the board
  // went read-only in silence — TAS-163 again, through a 200. It is read off
  // `role`, the value `canEdit` reads, so no refetch can put the banner and the
  // controls out of step: a refetch keeps `data`, and both with it, and an
  // answer that states a role moves both in the same render.
  // Not on an archived project: the banner says "not a read-only project", and
  // that one is exactly that (§5.7).
  const roleUnstated = role === null && !archived;
  // Failure is not zero. With no board read, "0" in a column head, "0 of 0" in
  // the filter bar and "Drop issues here" in every column are three claims
  // about the project made by a request that never answered — the last of them
  // an invitation to drop a card into a column whose contents are unknown
  // (§5.6: empty and error have to be distinguishable). A 404 from the board
  // is this failure too: only the context's 403 or 404 is the not-found screen
  // (§4.9).
  const issuesUnknown = issuesUnread.unanswered;
  // A board whose workflow could not be read still has its columns — they come
  // from the board read (TAS-202) — but no transition this repository could
  // name is one the server described, so nothing may be moved on a workflow
  // nobody sent, and this is what says so.
  const workflowUnknown = workflowUnread.unanswered;

  const userById = useMemo(() => toUserMap(members), [members]);
  // The columns on screen: the board's own, as sent (§4.9) — or, until it has
  // answered and after it failed, the ones predicted from the context, never
  // used to place a card.
  // Predicted, under a type filter, from that type's workflow alone (§4.9):
  // the server builds such a board's columns from it (§5.4).
  const columns = useMemo<ColumnStatus[]>(
    () => board?.columns ?? predictColumns(workflows, typeFilter === null ? offeredIssueTypes : [typeFilter]),
    [board, workflows, offeredIssueTypes, typeFilter],
  );
  /** Each column of the read, by status key: its cards, its count and whether it has more (§4.9). */
  const columnsByKey = useMemo(() => new Map((board?.columns ?? []).map((column) => [column.statusKey, column])), [board]);
  // The server's `unplacedIssues` (§4.9, «Outside their workflow»): drawn as
  // sent, never recomputed here.
  const outsideIssues = useMemo(() => board?.unplacedIssues ?? [], [board]);
  /** `X` in "X of Y": the issues that match the filters — the sum of the count pills, `null` if any is unknown (§5.4). */
  const shownCount = board ? boardIssueCount(board) : null;
  /** `Y`: the same sum over the board without filters. */
  const wholeCount = wholeBoardQuery.data ? boardIssueCount(wholeBoardQuery.data) : null;

  const transitionIssue = useMutation({
    // One move at a time per project (TAS-422): each one reads, as it leaves,
    // the version the one before it brought back.
    scope: { id: `board-move:${projectId}` },
    /**
     * With `If-Match` (backend TAS-422): the newer of the card's version and
     * the open panel's — both came from the server, and a drag right after a
     * panel edit would otherwise be refused against the reader's own write.
     */
    mutationFn: ({ movedIssueId, transitionId }: BoardMove) =>
      taskaApi.transitionIssue(projectId, movedIssueId, transitionId, latestKnownVersion(queryClient, projectId, movedIssueId)),
    onMutate: async ({ nextStatus, movedIssueId }) => {
      // Captured, not read again in `onError`: react-query hands a pending
      // mutation the options of the *latest* render, and the rollback must land
      // on the boards this snapshot came from — every board read of the
      // project in the cache, one per combination of filters (TAS-392).
      const key = boardKey(projectId);
      await queryClient.cancelQueries({ queryKey: key });
      const previousBoards = queryClient.getQueriesData<Board>({ queryKey: key });
      // The card goes where the server will put it (§5.3, art-director's B1):
      // into the target column at the place `compareBoardIssues` gives it, so
      // the re-read after a successful move does not reorder it — and not at
      // all into a column it would sort past the end of (§4.9), the counts
      // moving by one either way. No version: nothing optimistic may invent
      // one — the answer brings the real one.
      const stamp = new Date().toISOString();
      queryClient.setQueriesData<Board>({ queryKey: key }, (current) =>
        current ? moveCardOnBoard(current, movedIssueId, nextStatus, stamp) : current,
      );
      return { previousBoards, key };
    },
    onError: (_error, _variables, context) => {
      for (const [entry, previous] of context?.previousBoards ?? []) queryClient.setQueryData(entry, previous);
      // And the board is read again (release-reviewer, TAS-202): a refusal says
      // the move was not made, a timeout does not — the server may have applied
      // it and lost the answer. On return to the tab only a read that failed is
      // made again (`refetchFailedOnFocus`), so nothing else would heal that;
      // the snapshot stands until this read answers.
      void queryClient.invalidateQueries({ queryKey: context?.key ?? boardKey(projectId) });
    },
    onSuccess: async (answer, { movedIssueId }) => {
      // The version the move left, at once (TAS-422): a second move of the
      // card queued behind this one leaves with it, before any re-read.
      queryClient.setQueriesData<Board>({ queryKey: boardKey(projectId) }, (current) =>
        current ? withCardVersion(current, movedIssueId, answer.version, answer.updatedAt) : current,
      );
      await invalidateBoard(queryClient, projectId);
    },
  });

  /**
   * What the board says about a delete the panel made (§4.10, TAS-299), for a
   * reader who sees neither the panel close nor the card go: one visually
   * hidden polite region, mounted with the board and empty until then, so the
   * change of its text is what is announced (§7 on regions that mount with
   * their words).
   */
  const [boardStatus, setBoardStatus] = useState("");
  const boardRef = useRef<HTMLElement>(null);
  /** The last place focus can go when the issue panel closes (§4.10). */
  const backButtonRef = useRef<HTMLButtonElement>(null);
  /** Where focus goes once the panel has closed after a delete, in order of preference; read by the effect below. */
  const deleteFocusChain = useRef<DeleteFocusStep[] | null>(null);
  /**
   * The issue the route shows now, for a delete that answers after the reader
   * has already left its panel: that answer must not close whatever is open by
   * then, nor leave a focus target behind for a later close.
   */
  const shownIssueId = useRef(issueId);
  useEffect(() => {
    shownIssueId.current = issueId;
  }, [issueId]);

  /**
   * A write refused because the project was archived meanwhile (§5.7, «Архив
   * пришёл отказом записи») makes the board read its context again, and the
   * board turns read-only from the `archivedAt` that read brings — never from
   * the refusal. Heard here, once, for every mutation the board, its panel and
   * its dialogs make, by `details.reason` and nothing else; the writes that are
   * not mutations (the attachment legs) call `rereadContextAfterRefusal` too.
   *
   * A write refused with `PERMISSION_DENIED` reads the context again the same
   * way (TAS-209, api-contract-guard's N2): the role the board gated on is the
   * one the server has just disagreed with — demoted to VIEWER or removed while
   * the board was open — so the board takes the role, or the refusal of the
   * read, from that read rather than from the stale one. The refusal itself is
   * still said where it landed, with its request id; the re-read only changes
   * what the board offers next.
   */
  useEffect(() => {
    if (!projectId) return;
    return queryClient.getMutationCache().subscribe((event) => {
      if (event.type !== "updated" || event.action.type !== "error") return;
      rereadContextAfterRefusal(queryClient, projectId, event.action.error);
    });
  }, [projectId, queryClient]);

  /**
   * The board's archive line, and where focus goes when the board turns
   * read-only under the reader (§4.11, §5.7): after archiving from Edit
   * project, always — the line's reading is the announcement; after a refusal
   * brought the archive, only if the control in focus went or was switched
   * off, and then to the nearest open layer: inside an open dialog, its
   * `PROJECT_ARCHIVED` refusal, else its own archive line, else its first
   * stop; else the open panel's line; else the board's.
   *
   * **Focus never leaves an open dialog** (art-director, TAS-149). Under its
   * scrim the board's ring cannot be seen, and the next Tab would walk the
   * board while the dialog still stands over it. The dialogs here stay open
   * and turn read-only, so their own effects — child effects, which run before
   * this one — have drawn the line or the refusal by the time this looks; and
   * Edit project places its own (it is opened from `/projects` too, where no
   * board would), so it is never found without focus here. Labels places its
   * own as well, because it can change after the turn: its refusal may land
   * after the context read that turned it, and take the place of the line
   * focus was put on (see `ProjectLabelsModal`).
   */
  const archiveLineRef = useRef<HTMLParagraphElement>(null);
  const focusArchiveLine = useRef(false);
  // `null` until the context has answered: a board that opens archived has not
  // turned read-only under anybody, and its opening takes no focus.
  const archiveState = project ? (archived ? "archived" : "open") : null;
  const previousArchiveState = useRef(archiveState);
  useEffect(() => {
    const turned = previousArchiveState.current === "open" && archiveState === "archived";
    previousArchiveState.current = archiveState;
    if (!turned) return;
    const asked = focusArchiveLine.current;
    focusArchiveLine.current = false;
    // Asked for by Edit project's own archive, which closes that dialog in the
    // same frame: the board's line, and no dialog is left to look inside.
    if (asked) {
      archiveLineRef.current?.focus();
      return;
    }
    if (!focusLost()) return;
    const dialog = document.querySelector<HTMLElement>(".modal[aria-modal='true']");
    if (dialog) {
      const inside =
        // The dialog's `PROJECT_ARCHIVED` refusal or, without one, its archive
        // line: one of the two, never both, carries the mark. A refusal of
        // another kind does not — it is about something else, and may be one
        // the reader has already read.
        dialog.querySelector<HTMLElement>("[data-archive-note='modal']") ??
        // A dialog with neither: its first stop, rather than anything behind it.
        tabbables(dialog)[0];
      inside?.focus();
      return;
    }
    const panelLine = document.querySelector<HTMLElement>("[data-archive-note='panel']");
    (panelLine ?? archiveLineRef.current)?.focus();
  }, [archiveState]);

  /**
   * Where focus goes when a board dialog closes and `Modal` had no opener to
   * hand it back to (§4.11, TAS-397: the opener, else the screen's rule, else
   * the board's back button, as the panel's §4.10). New issue, Labels and Edit
   * project stay open when the project is archived under them, and the
   * controls that opened them leave the board with the archive; closed then,
   * focus lands on the board's archive line rather than on `<body>`, where the
   * next Tab would start over from the top. Otherwise — an opener gone for
   * another reason, a role re-read that took "New" with it — the back button.
   */
  const dialogOpen = creating || managingLabels || editingProject || managingMembers || managingWorkflows;
  const dialogWasOpen = useRef(dialogOpen);
  useEffect(() => {
    const closed = dialogWasOpen.current && !dialogOpen;
    dialogWasOpen.current = dialogOpen;
    if (!closed || !focusLost()) return;
    (archived ? archiveLineRef.current : backButtonRef.current)?.focus();
  }, [archived, dialogOpen]);

  /**
   * The panel deleted an issue, or found it already gone (§4.10). The card
   * leaves the board's cache now rather than after the re-read — and "X of Y"
   * with it — and the panel closes by replacing its route, so Back does not
   * open a 404. Focus lands where the card stood: the card that takes its
   * place in the same column, else the one before it, else the column's "+",
   * else "New". The board is read again behind it.
   */
  const issueDeleted = (deleted: Pick<Issue, "id" | "issueKey">, alreadyGone: boolean) => {
    // Where the board draws it — a column, the group, or nowhere (filtered
    // out, past a column's page, or a re-read apart from the panel).
    const column = (board?.columns ?? []).find((item) => item.issues.some((issue) => issue.id === deleted.id));
    const siblings = column ? column.issues : outsideIssues;
    const index = siblings.findIndex((item) => item.id === deleted.id);
    const chain: DeleteFocusStep[] = [];
    if (index !== -1) {
      const next = siblings[index + 1];
      const previous = siblings[index - 1];
      if (next) chain.push({ card: next.id });
      if (previous) chain.push({ card: previous.id });
    }
    if (column) chain.push({ add: column.statusKey });
    chain.push("new");
    // Only while its panel is still the one open (release-reviewer, TAS-299
    // round 1): a panel the reader closed, or left for another issue, while
    // the request was out has handed focus on already.
    const stillOpen = shownIssueId.current === deleted.id;
    if (stillOpen) deleteFocusChain.current = chain;

    // Off every board read of the project, its count one down (TAS-392).
    queryClient.setQueriesData<Board>({ queryKey: boardKey(projectId) }, (current) =>
      current ? withoutCardOnBoard(current, deleted.id) : current,
    );
    setBoardStatus(alreadyGone ? `${deleted.issueKey} was already deleted.` : `${deleted.issueKey} deleted.`);
    if (stillOpen) navigate(`/projects/${projectId}/board`, { replace: true });
    void queryClient.invalidateQueries({ queryKey: boardKey(projectId) });
    // The top bar's search, if it is open, may be holding the issue as a hit.
    void queryClient.invalidateQueries({ queryKey: ["issue-search"] });
  };

  // After the delete's navigation has closed the panel: the first step of the
  // chain that is on the board and can take focus. Drawn, because focus the
  // reader did not move themselves is otherwise invisible after a pointer
  // press (see `focusTrigger` in the admin Users section).
  useEffect(() => {
    // A panel open again means the chain, if any, belongs to a close that
    // already happened another way: it never outlives the next route.
    if (issueId) {
      deleteFocusChain.current = null;
      return;
    }
    const chain = deleteFocusChain.current;
    if (!chain) return;
    deleteFocusChain.current = null;
    const root = boardRef.current;
    if (!root) return;
    const target = chain
      .map((step) => findDeleteFocusTarget(root, step))
      .find((element): element is HTMLButtonElement => element !== null && !element.disabled);
    if (!target) return;
    try {
      target.focus({ focusVisible: true });
    } catch {
      target.focus();
    }
  }, [issueId]);

  const hasFilters = Boolean(query || typeFilter !== null || assigneeFilter !== "ALL" || labelFilter !== "ALL");
  // The skeleton stands until both reads have arrived (§4.9). Not after a
  // failed board read: a retry goes back to `isLoading`, and without the
  // first clause the "Not loaded" columns the banner explains would swap
  // themselves for skeletons on a timer.
  const columnsLoading = !issuesUnknown && (contextQuery.isLoading || boardQuery.isLoading);
  // Only once the board is drawn and only when something is in it: not while
  // the columns are skeletons, and not on a failed read, where every column
  // already says it does not know.
  // While its count is above 0 (§4.9) — a count the server did not state, while
  // it drew any.
  const outsideShown =
    !issuesUnknown &&
    !columnsLoading &&
    board !== undefined &&
    (board.unplacedTotalCount === null ? outsideIssues.length > 0 : board.unplacedTotalCount > 0);
  /** The key off the board's own read, when it holds the open issue — the read error's head names it. */
  const boardIssueKey = issueId ? knownKey(cards.find((item) => item.id === issueId)?.issueKey) : undefined;
  const activeIssue = activeIssueId ? cards.find((item) => item.id === activeIssueId) : undefined;

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
    const nextStatus: IssueStatusKey = String(overId);
    const issue = cards.find((item) => item.id === activeId);
    if (!issue || issue.statusKey === nextStatus) {
      setActiveIssueId(null);
      return;
    }
    // A drag that began before the filter changed and ends while the board is
    // still updating (§5.4): the card stays, nothing is sent — there was no
    // request, so no request id — and the reader is told to move it again.
    if (awaitingFilter) {
      setDragNotice(`${issue.issueKey} was not moved: the board was still updating for the new filter. Move it again.`);
      setActiveIssueId(null);
      return;
    }
    const workflow = workflowFor(workflows, issue.issueType);
    // In running text the build's own word is lowercased and anything else is
    // printed as it came: "bug issues", "EPIC issues" (TAS-173).
    const typeWord = issueTypeInSentence(issue.issueType, registry);
    // No fallback on this path, ever. The only transition ids this repository
    // owns are the mock's seed, and posting one to a gateway that never
    // described it invents a transition — the drop is refused instead, whether
    // the workflow read failed or has simply not answered yet.
    if (!workflow) {
      // Two different refusals. A context that answered without this issue's
      // type is a project that no longer allows it (TAS-251) — an old issue of
      // a type taken away — and "could not be loaded" would be false there.
      setDragNotice(
        workflows
          ? `${issue.issueKey} was not moved: this project has no workflow for ${typeWord} issues.`
          : `${issue.issueKey} was not moved: this project's workflow could not be loaded.`,
      );
      setActiveIssueId(null);
      return;
    }
    // The third refusal: a workflow did arrive, with nothing in it (TAS-261).
    // "No transition from X to Y in this workflow" would be false here — the
    // server did not say this move is missing; it sent a workflow no move can
    // be resolved from.
    if (sentWithoutStatuses(workflow)) {
      setDragNotice(
        `${issue.issueKey} was not moved: the server sent this project's ${typeWord} workflow without statuses.`,
      );
      setActiveIssueId(null);
      return;
    }
    const transition = findTransition(issue.statusKey, nextStatus, workflow.statuses, workflow.transitions);
    if (transition) {
      transitionIssue.mutate({ movedIssueId: issue.id, issueKey: issue.issueKey, nextStatus, transitionId: transition.id });
    } else {
      // Named by the issue's own workflow first, then by the columns on screen
      // — the target may be a column another type's workflow put there.
      const named = [...workflow.statuses, ...columns];
      setDragNotice(
        `${issue.issueKey}: no transition from ${statusLabel(issue.statusKey, named)} to ${statusLabel(nextStatus, named)} in this workflow`,
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
  if (projectGone) {
    return <NotFoundScreen />;
  }

  return (
    <main className="board-shell" ref={boardRef}>
      <p className="visually-hidden" role="status">
        {boardStatus}
      </p>
      <header className="board-topbar" ref={topbarRef}>
        <button
          className="icon-button"
          onClick={() => navigate("/projects")}
          ref={backButtonRef}
          title="Back to projects"
          type="button"
        >
          <ChevronLeft size={17} />
        </button>
        {project ? (
          <span className="key-badge" style={keyBadgeStyle(project.projectKey, project.color)}>
            {project.projectKey}
          </span>
        ) : null}
        {/* The full name in `title`: on a phone this is the part of the bar
            that gives way to the Workflows button, into an ellipsis (§4.28). */}
        <strong className="board-project-name" title={project?.name}>
          {project?.name ?? "Project"}
        </strong>
        <span className="muted-label">Board</span>
        {/* Beside the key and the name it edits, and before the spacer so it
            stays with them on the row they wrap onto below 820 (§4.13). Not in
            the trailing group: that group's order is fixed and its last member
            is the anchor the profile popover hangs from.

            `project &&` as well as the role, because the dialog is built from a
            project rather than from an id — there is nothing to edit until the
            read lands, and a button that opens an empty form is worse than one
            that arrives a moment later. */}
        {isProjectAdmin && project ? (
          <button
            aria-label="Edit project"
            className="icon-button"
            onClick={() => setEditingProject(true)}
            title="Edit project"
            type="button"
          >
            <Pencil size={15} />
          </button>
        ) : null}
        {/* Every role, from the first frame (§4.28): the dialog reads its own
            list, and only the controls inside it are gated. Here rather than in
            the filter bar, which holds filters and the people they filter. */}
        <button
          aria-haspopup="dialog"
          aria-label="Workflows"
          className="icon-button"
          onClick={() => setManagingWorkflows(true)}
          title="Workflows"
          type="button"
        >
          <WorkflowIcon size={15} />
        </button>
        <div className="topbar-spacer" />
        {/* A filter of this board, not a search of the product (§4.13, §5.4):
            sent with the board read after a 200ms pause, trimmed — the server
            filters before it cuts a column at 200 (TAS-392). The product's
            search is the top bar's on /projects (§4.20). */}
        <label className="search-box">
          <Search aria-hidden="true" size={15} />
          <span className="visually-hidden">Filter issues by key, summary or description</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter issues" />
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
          {hidesWrites ? null : (
            <button
              className="primary-button board-new"
              disabled={!canCreate}
              onClick={() => {
                setCreatingIn(null);
                setCreating(true);
              }}
              type="button"
            >
              <Plus size={15} />
              New
            </button>
          )}
          <UserProfileMenu
            user={meQuery.data}
            loading={meQuery.isPending}
            loggingOut={logoutPending}
            onLogout={onLogout}
          />
        </div>
      </header>

      <section className="filterbar">
        {/* The type select and the Issue types trigger, one unwrappable group
            (§4.13, TAS-417): a select, not segments, because the set and the
            length of its names are an admin's data. Labels and order are the
            registry's; no tiles in a native option. Its states are the label
            picker's: pending while the context is read, a line when it failed. */}
        <div className="filter-type-group">
          {contextUnread.unanswered ? (
            <span className="filter-error">Types could not be loaded</span>
          ) : (
            <label className="filter-select filter-type">
              <span className="filter-label">Type</span>
              <select
                disabled={contextQuery.isLoading}
                onChange={(event) => setTypeFilter(event.target.value === "" ? null : event.target.value)}
                // "" for All: a registry key is never blank (`toProjectIssueTypes`).
                value={contextQuery.isLoading ? "LOADING" : (typeFilter ?? "")}
              >
                {contextQuery.isLoading ? (
                  <option value="LOADING">Loading types</option>
                ) : (
                  <>
                    <option value="">All</option>
                    {(registry ?? []).map((entry) => (
                      <option key={entry.code} value={entry.code}>
                        {issueTypeLabel(entry.code, registry)}
                      </option>
                    ))}
                  </>
                )}
              </select>
            </label>
          )}
          {/* Every role, from the first frame, an archived project included
              (§4.30, §5.7): the registry is read by all and written by its
              ADMIN, and only the controls inside the dialog are gated. */}
          <button
            aria-haspopup="dialog"
            aria-label="Issue types"
            className="icon-button"
            onClick={() => setManagingIssueTypes(true)}
            title="Issue types"
            type="button"
          >
            <Shapes size={15} />
          </button>
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
                user={
                  member.user
                    ? {
                        id: member.userId,
                        displayName: member.user.displayName,
                        color: member.user.color,
                        // Already on the row this filter is built from, so
                        // carrying it costs nothing and *not* carrying it would
                        // give one person a face on a card and initials in the
                        // filter beside it.
                        avatarUrl: member.user.avatarUrl,
                      }
                    : null
                }
                size="sm"
              />
            </button>
          ))}
        </div>
        {/* Right after the people it lists in full (TAS-158), for every reader:
            who is on a project is not an admin's secret, and only the controls
            inside are gated. An icon button like "Manage labels" beside it, and
            named in `aria-label` as well as `title` (§7). */}
        <button
          aria-label="Members"
          className="icon-button"
          onClick={() => setManagingMembers(true)}
          title="Members"
          type="button"
        >
          <Users size={15} />
        </button>
        <span className="divider" />
        {/* Labels arrive with the project's context (TAS-251), so a failed
            read is reported once, by the banner above, with the server's words
            and the request id. This line only says why there is no picker —
            a consequence of that failure rather than a second report of it, in
            `--fg-2` and with no `--danger` (§4.13, TAS-299). Saying nothing
            would leave a picker offering only "All" and looking like a project
            that has no labels. */}
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
              disabled={contextQuery.isLoading}
              onChange={(event) => setLabelFilter(event.target.value)}
              value={contextQuery.isLoading ? "LOADING" : labelFilter}
            >
              {contextQuery.isLoading ? (
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
              setTypeFilter(null);
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

            X is the issues that match the filters — the sum of the count
            pills, columns and «Outside their workflow» together; Y is the same
            sum over the board without filters (§5.4, TAS-392). Neither is the
            number of cards loaded: a column cut at its page says so at its
            foot. An unknown count makes its sum unknown. */}
        <span className="counter">
          {issuesUnknown ? (
            <>
              <Unknown /> of <Unknown />
            </>
          ) : boardQuery.isPending ? (
            <>
              <PendingValue /> of <PendingValue />
            </>
          ) : (
            <>
              {shownCount === null ? <Unknown /> : shownCount} of{" "}
              {wholeCount !== null ? (
                wholeCount
              ) : wholeBoardQuery.isPending ? (
                <PendingValue />
              ) : (
                <Unknown />
              )}
            </>
          )}
        </span>
      </section>

      {/* The archive line (§5.7): above the notices and outside them — an
          archived project is not a failure. A state found on opening, not an
          answer to anything, so not a live region; `tabIndex=-1` makes it the
          place focus is put when the board turns read-only under the reader. */}
      {archivedAt ? (
        <p className="board-archive-line" ref={archiveLineRef} tabIndex={-1}>
          <strong>Archived on {archivedOnDay(archivedAt)}.</strong> This board and its issues are read-only.
        </p>
      ) : null}

      {/* One container, capped, so the board keeps most of the plane whatever
          fails. As five loose siblings these took 54% of a 900px viewport and
          75% of a 640px one, and at 390x640 the columns collapsed to 24px
          behind an overflow nothing could scroll to. Four is now the ceiling —
          the two event notices below are both cleared when a drag starts, and
          one drag raises at most one of them — but the cap is what makes the
          count stop mattering. */}
      {contextUnread.unanswered ||
      roleUnstated ||
      issuesUnknown ||
      transitionIssue.isError ||
      dragNotice ? (
        // Labelled and focusable: with no request id in any of them the stack
        // can outgrow its cap with nothing focusable inside, and only Chrome
        // focuses a scroller of its own accord — in Firefox and Safari the
        // banners below the fold would be unreachable from the keyboard.
        <section aria-label="Board problems" className="board-notices" tabIndex={0}>
          {/* One banner for the one read (TAS-251). The server answers the
              project, the role, the members, the labels and the workflow
              together or not at all, so they fail together and are said
              together — three banners for one failure would be three claims
              about three reads that no longer exist. */}
          {contextUnread.unanswered ? (
            <ApiNotice error={contextUnread.error}>
              This project could not be loaded, so its name, people, labels and workflow are missing and editing is off
              — a failed read, not a read-only project.
            </ApiNotice>
          ) : null}
          {/* Its own sentence, because the one above would be false here: the
              read did not fail, it answered without a role this app knows. No
              `error` to print either — there was no failure to carry one. */}
          {roleUnstated ? (
            <ApiNotice>
              Your role came back empty or unrecognised, so editing is off — an unknown role, not a read-only
              project.
            </ApiNotice>
          ) : null}
          {issuesUnknown ? (
            <ApiNotice error={issuesUnread.error}>The issues on this board could not be loaded.</ApiNotice>
          ) : null}
          {/* The two below are events, not states of the screen: a rollback and
              a refused drop. An event that cannot be dismissed is how a stack
              this tall becomes permanent. */}
          {transitionIssue.isError ? (
            <ApiNotice
              dismiss={{ label: "Dismiss the failed move", onDismiss: () => transitionIssue.reset() }}
              error={transitionIssue.error}
            >
              {/* 409 `ABORTED` (TAS-422, §5.5 P13′): the card went back and the
                  board was read again; the server's words and the request id
                  follow, as for any refused move. */}
              {isTransitionConflict(transitionIssue.error) && transitionIssue.variables
                ? `${transitionIssue.variables.issueKey} was not moved: it was changed elsewhere after this board was read. The board now shows the latest version.`
                : "The move could not be saved, so the card went back where it was."}
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
        {/* The two counts the centred alignment is computed from (Settings →
            Appearance → Board columns, §5.2, art-director's ruling 2): the
            board's columns — the predicted ones while loading and after a
            failed read — and the same plus «Outside their workflow» when that
            group is drawn. The stylesheet centres the first set and hangs the
            group to its right; in the default Left alignment, and at 820 and
            below, nothing reads them. */}
        {/* Busy while the read under new filters is out — the typing pause
            included — and the earlier answer stands (§5.4): no skeleton, no
            dimming, no spinner. */}
        <section
          aria-busy={awaitingFilter || undefined}
          className="columns-area"
          style={boardColumnCounts(columns.length, outsideShown)}
        >
          {columnsLoading
            ? columns.map((status) => <ColumnSkeleton key={status.statusKey} status={status} />)
            : columns.map((status) => (
                <BoardColumn
                  key={status.statusKey}
                  status={status}
                  issues={columnsByKey.get(status.statusKey)?.issues ?? []}
                  totalCount={columnsByKey.get(status.statusKey)?.totalCount ?? null}
                  hasMore={columnsByKey.get(status.statusKey)?.hasMore ?? null}
                  issuesUnknown={issuesUnknown}
                  awaitingFilter={awaitingFilter}
                  userById={userById}
                  canEdit={canEdit}
                  canCreate={canCreate}
                  offersCreate={!hidesWrites}
                  onAdd={() => {
                    setCreatingIn(status);
                    setCreating(true);
                  }}
                  onOpenIssue={(id) => navigate(`/projects/${projectId}/issues/${id}`)}
                  registry={registry}
                />
              ))}
          {outsideShown ? (
            <OutsideWorkflowGroup
              columns={columns}
              issues={outsideIssues}
              totalCount={board?.unplacedTotalCount ?? null}
              hasMore={board?.unplacedHasMore ?? null}
              onOpenIssue={(id) => navigate(`/projects/${projectId}/issues/${id}`)}
              registry={registry}
              userById={userById}
            />
          ) : null}
        </section>
        <DragOverlay dropAnimation={null} zIndex={1000}>
          {activeIssue ? (
            <div className="issue-card drag-overlay-card">
              <IssueCardContent issue={activeIssue} registry={registry} userById={userById} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {issueId ? (
        // One frame for every state of the panel (TAS-380, art-director's
        // ruling 7): the layer, the scrim, the dialog and its head with Close
        // sit outside the boundary, so a render failure inside keeps the same
        // Close and does not play the entrance again.
        <IssuePanelFrame
          // Focus goes back to what opened the panel; when that is gone, to
          // this issue's card, and when that is gone too, to the way back.
          fallbackFocus={() =>
            (boardRef.current ? findDeleteFocusTarget(boardRef.current, { card: issueId }) : null) ??
            backButtonRef.current
          }
          key={issueId}
          onClose={() => navigate(`/projects/${projectId}/board`)}
        >
          {/* The panel's own boundary (TAS-173): an issue the panel cannot draw
              leaves the board behind it standing, with a head that can be
              closed. Keyed with the panel, so the next issue starts clean. */}
          <ErrorBoundary
            fallback={(error) => (
              <IssuePanelFailure error={error} issueKey={boardIssueKey} issueId={issueId} projectId={projectId} />
            )}
            key={issueId}
          >
            <IssuePanel
              // Remount when the panel changes issue. Since TAS-157 a link row
              // can swap `issueId` while this instance stays mounted, and
              // without the key every piece of per-issue state — the comment
              // draft above all, which would be posted onto the issue it was
              // not written for — survives the navigation. This is not the
              // reseed the drafts inside the panel avoid: those must not
              // remount on a *refetch*, and `issueId` cannot change mid-edit.
              key={issueId}
              issueId={issueId}
              boardIssueKey={boardIssueKey}
              projectId={projectId}
              members={members}
              membersAnswered={context !== undefined}
              membersUnknown={membersUnread.unanswered}
              userById={userById}
              canEdit={canEdit}
              isProjectAdmin={isProjectAdmin}
              canWatch={canWatch}
              isProjectViewer={isProjectViewer}
              archivedAt={archivedAt}
              currentUserId={meQuery.data?.id}
              workflows={workflows}
              issueTypes={registry}
              workflowUnknown={workflowUnknown}
              onDeleted={issueDeleted}
            />
          </ErrorBoundary>
        </IssuePanelFrame>
      ) : null}

      {managingLabels ? (
        <ProjectLabelsModal
          archived={archived}
          projectId={projectId}
          projectKey={project?.projectKey ?? ""}
          projectColor={project?.color}
          onClose={() => setManagingLabels(false)}
          // A filter pointing at a label that no longer exists would match
          // nothing, and an empty board under it reads as "nothing carries it".
          onLabelDeleted={(labelId) => setLabelFilter((current) => (current === labelId ? "ALL" : current))}
        />
      ) : null}

      {managingMembers ? (
        <ProjectMembersModal
          currentUserId={meQuery.data?.id}
          globalRole={meQuery.data?.globalRole}
          onClose={() => setManagingMembers(false)}
          projectColor={project?.color}
          projectId={projectId}
          projectKey={project?.projectKey ?? ""}
          // The same `role` every permission above reads, with a failed read
          // folded into `null`: the dialog tells a role nobody stated from a
          // role the server named, as the board's two banners do.
          readerRole={roleUnknown ? null : role}
          archived={archived}
        />
      ) : null}

      {managingWorkflows ? (
        <ProjectWorkflowsModal
          issueTypes={registry}
          onClose={() => setManagingWorkflows(false)}
          projectColor={project?.color}
          projectId={projectId}
          projectKey={project?.projectKey ?? ""}
          // Members' reading of the role: a failed context read folded into
          // `null`, so the dialog says the role is unknown rather than nothing.
          readerRole={roleUnknown ? null : role}
          archived={archived}
        />
      ) : null}

      {managingIssueTypes ? (
        <ProjectIssueTypesModal
          archived={archived}
          contextError={contextUnread.unanswered ? contextUnread.error : null}
          issueTypes={registry}
          onClose={() => setManagingIssueTypes(false)}
          projectColor={project?.color}
          projectId={projectId}
          projectKey={project?.projectKey ?? ""}
          // Members' reading of the role: a failed context read folded into
          // `null`, so the dialog says the role is unknown rather than nothing.
          readerRole={roleUnknown ? null : role}
        />
      ) : null}

      {/* `project &&` a second time, and not merely as a type narrowing: the
          read can fail or be refetched while the dialog is open, and a dialog
          built from a project that is no longer in hand would be editing
          fields nobody can vouch for. */}
      {editingProject && project ? (
        <EditProjectModal
          // The reader stays: an archived project's board still reads, and in
          // this frame it turns read-only from the context the dialog has just
          // patched. Focus then goes to the archive line (the effect above).
          onArchived={() => {
            focusArchiveLine.current = true;
          }}
          onClose={() => setEditingProject(false)}
          project={project}
        />
      ) : null}

      {creating ? (
        <CreateIssueModal
          archived={archived}
          inStatus={creatingIn}
          filteredType={typeFilter}
          workflows={workflows}
          issueTypes={registry ?? []}
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
 * One step of where focus goes after a delete (§4.10): a card by its issue id,
 * a column's "+" by the column's status key, or "New".
 */
type DeleteFocusStep = { card: string } | { add: string } | "new";

/**
 * The board's element for one step, or `null` when it is not drawn. Matched by
 * the data attributes rather than built into a selector, so an id needs no
 * escaping.
 */
function findDeleteFocusTarget(root: HTMLElement, step: DeleteFocusStep): HTMLButtonElement | null {
  if (step === "new") return root.querySelector<HTMLButtonElement>(".board-new");
  if ("card" in step) {
    return (
      [...root.querySelectorAll<HTMLButtonElement>("button.issue-card")].find(
        (card) => card.dataset.issueId === step.card,
      ) ?? null
    );
  }
  const column = [...root.querySelectorAll<HTMLElement>(".board-column")].find(
    (section) => section.dataset.statusKey === step.add,
  );
  return column?.querySelector<HTMLButtonElement>(".column-head button") ?? null;
}

/** A key worth printing: a non-empty string, which a value the board cannot draw is not (TAS-173). */
function knownKey(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * `--board-cols` and `--board-cols-all` for `.columns-area` (§5.2, TAS-380):
 * what the centred alignment's formula in the stylesheet reads. Strings, so
 * React writes them as they are rather than guessing at a unit.
 */
function boardColumnCounts(boardColumns: number, outsideShown: boolean): CSSProperties {
  return {
    "--board-cols": String(boardColumns),
    "--board-cols-all": String(boardColumns + (outsideShown ? 1 : 0)),
  } as CSSProperties;
}

/** What a column is drawn from: a board column's status, or a predicted one (§4.9). */
type ColumnStatus = Pick<BoardColumnData, "statusKey" | "name" | "category" | "sortOrder">;

/**
 * The status issue-service creates every issue in (`IssueServiceImpl`), and so
 * the one column a "+" may sit on until a create can name its status (backend
 * TAS-428, DESIGN.md §4.9).
 */
const CREATE_STATUS_KEY = "TODO";

/**
 * The delete's 404: the issue is not there any more — deleted elsewhere in
 * the meantime — which is the outcome the reader asked for, so it takes the
 * success path with its own sentence (§4.10).
 */
function isIssueGone(error: unknown): boolean {
  const { code, status } = apiErrorFacts(error);
  return code === "NOT_FOUND" || status === 404;
}

/**
 * The predicted columns of last resort (§4.9): before the context and the
 * board have answered, and after both failed. Skeletons and "Not loaded"
 * columns only — never a place a card is put, since every card is placed by
 * the board read. The three keys are `IssueStatus` from the contract; only the
 * labels and the order are ours.
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
  totalCount,
  hasMore,
  issuesUnknown,
  awaitingFilter,
  userById,
  canEdit,
  canCreate,
  offersCreate,
  onAdd,
  onOpenIssue,
  registry,
}: {
  status: ColumnStatus;
  issues: BoardIssue[];
  /** The column's issues that match the filters — its count pill (§4.9); `null` when the server did not say. */
  totalCount: number | null;
  /** Whether issues of the column lie past the ones drawn: the foot says so (§4.9). */
  hasMore: boolean | null;
  /** The board read never arrived: this column knows nothing about its contents. */
  issuesUnknown: boolean;
  /** An earlier answer is drawn while the read under new filters is out: the cards do not lift (§5.4). */
  awaitingFilter: boolean;
  userById: ReadonlyMap<string, Person>;
  /** The project's issue-type registry, which names and draws each card's type (§4.6). */
  registry: IssueTypeRegistry;
  canEdit: boolean;
  /** `canEdit`, and a project that allows at least one issue type. */
  canCreate: boolean;
  /** Whether the "+" is drawn at all: not for a VIEWER (§5.7), who gets no New either. */
  offersCreate: boolean;
  onAdd: () => void;
  onOpenIssue: (issueId: string) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: status.statusKey, disabled: !canEdit });
  const name = statusLabel(status.statusKey, [status]);

  // A named section rather than a bare div: each column is a landmark a screen
  // reader can jump between, and the drop target stops being anonymous.
  return (
    <section
      aria-label={`${name} column`}
      className={`board-column ${isOver ? "is-over" : ""}`}
      data-status-key={status.statusKey}
      ref={setNodeRef}
    >
      <div className="column-head">
        <StatusDot status={status} />
        <strong>{name}</strong>
        {/* The issues that match the filters, never the cards drawn (§4.9). */}
        <span className="count-pill">{issuesUnknown || totalCount === null ? <Unknown /> : totalCount}</span>
        {/* Only on the To Do column, by its key (§4.9): until backend TAS-428
            the server creates every issue in TODO, and a "+" on another column
            would put the issue somewhere other than where it was pressed.
            Nothing stands in for it on the others. */}
        {offersCreate && status.statusKey === CREATE_STATUS_KEY ? (
          <button
            aria-label={`Create issue in ${name}`}
            className="icon-button mini"
            disabled={!canCreate}
            onClick={onAdd}
            title={`Create issue in ${name}`}
            type="button"
          >
            <Plus size={13} />
          </button>
        ) : null}
      </div>
      <div className="issue-list">
        {issues.map((issue) => (
          <ErrorBoundary
            fallback={() => <IssueCardFailure issue={issue} onOpen={onOpenIssue} />}
            key={issue.id}
            resetKey={issue}
          >
            <IssueCard
              issue={issue}
              registry={registry}
              userById={userById}
              canEdit={canEdit && !awaitingFilter}
              onOpen={onOpenIssue}
            />
          </ErrorBoundary>
        ))}
        {!issuesUnknown && hasMore === true ? <ColumnFoot drawn={issues.length} total={totalCount} /> : null}
        {/* Three different empty columns. A column whose contents are unknown
            must not invite a card, and the dashed frame §5.6 gives the empty
            state is exactly that invitation; a reader who cannot drop one must
            not be told to either (§5.7) — the same promise the card itself has
            stopped making. */}
        {issuesUnknown ? (
          <div className="empty-column is-unknown">Not loaded</div>
        ) : issues.length === 0 && hasMore !== true ? (
          <div className="empty-column">{canEdit ? "Drop issues here" : "No issues"}</div>
        ) : null}
      </div>
    </section>
  );
}

/**
 * The foot of a column cut at its page (§4.9, «Колонка не целиком»): the last
 * item of the list, how many of how many are drawn — `{total}` is the count
 * pill's number. No «Show more»: nothing continues a column in its own order
 * yet (backend A1, TAS-430), so the sentence says how to find the rest. Not a
 * live region; the same for every role and on an archived project.
 */
function ColumnFoot({ drawn, total }: { drawn: number; total: number | null }) {
  return (
    <div className="list-more">
      <p className="list-more-note">
        {drawn} of {total === null ? <Unknown /> : total} shown. Filter to find the rest.
      </p>
    </div>
  );
}

/**
 * A column's dot (§4.9). Coloured by the key when this build knows it, by the
 * workflow's `category` when that is one of the three, and otherwise a hollow
 * ring in `--fg-2` (art-director, TAS-173) — distinct from To Do's filled grey,
 * and not a colour nobody chose.
 */
function StatusDot({ status }: { status: Pick<WorkflowStatus, "statusKey" | "category"> }) {
  const color = statusColor(status.statusKey, status.category);
  return color ? (
    <span className="status-dot" style={{ background: color }} />
  ) : (
    <span className="status-dot is-unknown" />
  );
}

/**
 * «Outside their workflow» (§4.9, TAS-173, TAS-202): exactly the board read's
 * `unplacedIssues` — the issues whose status is not in their own type's
 * workflow, even where it stands as a column for another type. One trailing
 * group after the last column, never a column per status: §9's `plain`
 * variant with no dot and no "+", and not a drop target. Its cards do not lift
 * for anyone; they open the issue, whose panel says why no move is offered.
 * Each card names its status in the footer, since the group heading cannot —
 * by the column of that key on this board when there is one, else by §6.
 */
function OutsideWorkflowGroup({
  columns,
  issues,
  totalCount,
  hasMore,
  userById,
  onOpenIssue,
  registry,
}: {
  columns: readonly ColumnStatus[];
  issues: BoardIssue[];
  /** `unplacedTotalCount`: the group's count pill (§4.9). */
  totalCount: number | null;
  /** `unplacedHasMore`: the group's foot (§4.9). */
  hasMore: boolean | null;
  userById: ReadonlyMap<string, Person>;
  registry: IssueTypeRegistry;
  onOpenIssue: (issueId: string) => void;
}) {
  return (
    <section aria-label="Outside their workflow" className="board-column is-plain other-statuses">
      <div className="column-head">
        <strong>Outside their workflow</strong>
        <span className="count-pill">{totalCount === null ? <Unknown /> : totalCount}</span>
      </div>
      <div className="issue-list">
        {issues.map((issue) => (
          <ErrorBoundary
            fallback={() => <IssueCardFailure issue={issue} onOpen={onOpenIssue} />}
            key={issue.id}
            resetKey={issue}
          >
            <IssueCard
              canEdit={false}
              issue={issue}
              onOpen={onOpenIssue}
              registry={registry}
              statusNote={statusLabel(issue.statusKey, columns)}
              userById={userById}
            />
          </ErrorBoundary>
        ))}
        {hasMore === true ? <ColumnFoot drawn={issues.length} total={totalCount} /> : null}
      </div>
    </section>
  );
}

/**
 * A card whose issue could not be drawn (TAS-173): the §4.8 box, its key and
 * one sentence, and nothing else read from the issue — whatever threw is in
 * there. Still the button that opens the issue, and still counted in its
 * column's pill and in "X of Y": the issue exists, only its card failed. It
 * does not lift; the boundary tries the real card again when the issue's data
 * changes.
 */
function IssueCardFailure({ issue, onOpen }: { issue: Pick<BoardIssue, "id" | "issueKey">; onOpen: (issueId: string) => void }) {
  return (
    <button
      className="issue-card is-static issue-card-failure"
      data-issue-id={issue.id}
      onClick={() => onOpen(issue.id)}
      type="button"
    >
      {typeof issue.issueKey === "string" && issue.issueKey ? <span className="issue-key">{issue.issueKey}</span> : null}
      <span className="issue-card-failure-text">This card could not be shown.</span>
    </button>
  );
}

function IssueCard({
  issue,
  registry,
  userById,
  canEdit,
  onOpen,
  statusNote,
}: {
  issue: BoardIssue;
  registry: IssueTypeRegistry;
  userById: ReadonlyMap<string, Person>;
  canEdit: boolean;
  onOpen: (issueId: string) => void;
  /** The status in words, beside the date — for a card that sits in no column of its status. */
  statusNote?: string;
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
      // Where the board finds the card that takes a deleted one's place (§4.10).
      data-issue-id={issue.id}
      onClick={() => onOpen(issue.id)}
      ref={setNodeRef}
      type="button"
      {...(canEdit ? listeners : null)}
      {...(canEdit ? attributes : null)}
    >
      <IssueCardContent issue={issue} registry={registry} statusNote={statusNote} userById={userById} />
    </button>
  );
}

/**
 * A card's face (§4.8, art-director's N3): the assignee the board read joined
 * in, drawn from that answer — the name and the picture the server sent — with
 * the colour of the context's member row of the same id when there is one, so
 * a person's circle does not change colour between the card and the filter
 * row; else the id's palette colour.
 *
 * An assignee the server could not name (`displayName: null`, backend A2) is
 * still somebody: a filled circle in the id's palette, no initials, called
 * "Unknown assignee" — never the dashed empty circle, which says nobody is
 * assigned. No card is ever named from anywhere but the board read.
 */
function CardFace({ assignee, userById }: { assignee: BoardIssue["assignee"]; userById: ReadonlyMap<string, Person> }) {
  if (!assignee) return <Avatar size="sm" />;
  if (assignee.displayName === null) {
    return <Avatar hideInitials label="Unknown assignee" size="sm" user={{ id: assignee.id, displayName: "Unknown assignee", avatarUrl: null }} />;
  }
  return (
    <Avatar
      size="sm"
      user={{
        id: assignee.id,
        displayName: assignee.displayName,
        color: userById.get(assignee.id)?.color,
        avatarUrl: assignee.avatarUrl,
      }}
    />
  );
}

function IssueCardContent({
  issue,
  registry,
  userById,
  statusNote,
}: {
  issue: BoardIssue;
  registry: IssueTypeRegistry;
  userById: ReadonlyMap<string, Person>;
  statusNote?: string;
}) {
  const typeName = issueTypeLabel(issue.issueType, registry);
  return (
    <>
      <span className="issue-card-meta">
        <TypeChip registry={registry} type={issue.issueType} />
        <span className="issue-key">{issue.issueKey}</span>
        <span className="issue-type-label" title={typeName}>
          {typeName}
        </span>
        <PriorityBars priority={issue.priority} />
      </span>
      <strong>{issue.summary}</strong>
      <p>{issue.description ?? ""}</p>
      {issue.labels.length ? (
        <span className="issue-card-labels">
          {issue.labels.map((label) => (
            <LabelChip key={label.id || label.name} label={label} />
          ))}
        </span>
      ) : null}
      <span className="issue-card-foot">
        {statusNote === undefined ? (
          <span>{formatDay(issue.createdAt)}</span>
        ) : (
          <span className="issue-card-when" title={statusNote}>
            {formatDay(issue.createdAt)} · <span className="issue-card-status">{statusNote}</span>
          </span>
        )}
        <CardFace assignee={issue.assignee} userById={userById} />
      </span>
    </>
  );
}

function ColumnSkeleton({ status }: { status: ColumnStatus }) {
  return (
    <div className="board-column">
      <div className="column-head">
        <StatusDot status={status} />
        <strong>{statusLabel(status.statusKey, [status])}</strong>
      </div>
      <div className="issue-list">
        <div className="issue-card skeleton-card" />
        <div className="issue-card skeleton-card" />
      </div>
    </div>
  );
}

/**
 * The panel's body while its issue is on the way (TAS-242), in place of the
 * line "Loading issue" it used to show. §5.6: shaped like what it stands in
 * for. The title, the status pill, the meta grid, the planning rows and the
 * description sit where the panel will put them, because the containers are
 * the panel's own classes, and only the values are bars. The head's bars are
 * drawn by the panel into the frame's head, beside its real Close (TAS-380).
 *
 * Every bar is a `.value-skeleton`, so the pulse is the one the board's
 * pending counts already use, and so is its entry in the reduced-motion block
 * — no second literal animation. Hidden from assistive technology: the panel
 * says "Loading issue" in words beside it, and a stack of empty shapes has
 * nothing to add to that.
 */
function IssuePanelSkeleton() {
  const field = (
    <div className="planning-field">
      <span className="value-skeleton panel-skeleton-label" />
      <span className="value-skeleton panel-skeleton-value is-field" />
    </div>
  );
  // The two estimates carry their syntax hint under the box.
  const estimate = (
    <div className="planning-field">
      <span className="value-skeleton panel-skeleton-label" />
      <span className="value-skeleton panel-skeleton-value is-field" />
      <span className="value-skeleton panel-skeleton-hint" />
    </div>
  );
  return (
    <div aria-hidden="true" className="issue-panel-body is-skeleton">
      <div className="panel-skeleton-title">
        <span className="value-skeleton panel-skeleton-line" />
        <span className="value-skeleton panel-skeleton-line is-short" />
      </div>
      <div className="transition-row">
        <span className="value-skeleton panel-skeleton-pill" />
      </div>
      <div className="meta-grid">
        <span className="value-skeleton panel-skeleton-label" />
        <span className="value-skeleton panel-skeleton-control" />
        <span className="value-skeleton panel-skeleton-label" />
        <span className="value-skeleton panel-skeleton-control is-short" />
        <span className="value-skeleton panel-skeleton-label" />
        <span className="value-skeleton panel-skeleton-value" />
        <span className="value-skeleton panel-skeleton-label" />
        <span className="value-skeleton panel-skeleton-value is-short" />
      </div>
      <div className="issue-planning">
        <span className="value-skeleton panel-skeleton-label is-heading" />
        <div className="planning-grid">
          <div className="planning-row is-three">
            {field}
            {estimate}
            {estimate}
          </div>
          <div className="planning-row">
            {field}
            {field}
          </div>
        </div>
      </div>
      <div className="description-field">
        <span className="value-skeleton panel-skeleton-label" />
        <span className="value-skeleton panel-skeleton-box" />
      </div>
    </div>
  );
}

/**
 * The panel when the issue it holds could not be drawn (TAS-173, art-director's
 * ruling 4), inside the same frame as every other state (TAS-380): the head
 * keeps its Close and shows only what is safe to read — the key, when the
 * panel's cache or the board's read holds it as a string. The sentence sits
 * where §4.10's read failure sits, with the error's message as its detail.
 * Polite rather than an alert: the reader asked to open something, nothing
 * they did was refused.
 */
function IssuePanelFailure({
  error,
  issueId,
  issueKey,
  projectId,
}: {
  error: Error;
  issueId: string;
  /** The key off the board's read, if it holds this issue. */
  issueKey?: string;
  projectId: string;
}) {
  const queryClient = useQueryClient();
  const cachedKey = queryClient.getQueryData(issueDetailsOptions(projectId, issueId).queryKey)?.issue?.issueKey;
  const key = knownKey(cachedKey) ?? issueKey;
  const head = useIssuePanelHead({ label: key ? `${key} issue` : "Issue" });
  return (
    <>
      {key ? head.start(<span className="issue-key">{key}</span>) : null}
      <div className="panel-loading">
        <ApiNotice error={error} live="polite">
          This issue could not be shown.
        </ApiNotice>
      </div>
    </>
  );
}

function IssuePanel({
  projectId,
  issueId,
  boardIssueKey,
  members,
  membersAnswered,
  membersUnknown,
  userById,
  canEdit,
  isProjectAdmin,
  canWatch,
  isProjectViewer,
  archivedAt,
  currentUserId,
  workflows,
  issueTypes: registry,
  workflowUnknown,
  onDeleted,
}: {
  projectId: string;
  issueId: string;
  /** The key off the board's read, if it holds this issue: what the head shows when the read fails. */
  boardIssueKey?: string;
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
  userById: Map<string, Pick<User, "id" | "displayName" | "color" | "avatarUrl">>;
  canEdit: boolean;
  /**
   * Narrower than `canEdit`, and read by two sections, not one. The
   * attachments section gates its delete button on it: an attachment
   * somebody *else* uploaded may be deleted by an `ADMIN` and by nobody else
   * (`delete-attachment-roles` in issue-service's own config), while your own
   * needs only `ADMIN` or `MEMBER`. Since TAS-193 the watchers section gates
   * its add-picker and its per-row remove on it too — see that section's own
   * prop doc for which routes those actually check. Same shape as the label
   * writes TAS-119 gated, and the same standing: hiding a control is
   * presentation, the server decides.
   */
  isProjectAdmin: boolean;
  /** `watch-issue-roles`, for the watch toggle only — see `canWatch` on the board. */
  canWatch: boolean;
  /** The server named this reader a VIEWER, the one case the toggle's hint may give the role as its reason. */
  isProjectViewer: boolean;
  /**
   * When the project was archived, off the board's context, or `null` (§5.7).
   * Every write here is then off through the flags above; this hides the
   * VIEWER's set besides — the moves and Delete — and puts the transition
   * slot's line in their place.
   */
  archivedAt: string | null;
  currentUserId?: string;
  workflows?: WorkflowsByIssueType;
  /**
   * The project's issue-type registry off the board's context (TAS-417), in
   * its order, or `undefined` before it answers: the type's name and look in
   * the head, and the Type select's options.
   */
  issueTypes?: readonly ProjectIssueType[];
  /** The workflow read failed; these buttons are the keyboard path a drag has. */
  workflowUnknown: boolean;
  /**
   * The server answered the delete — or said the issue was already gone. The
   * board takes it from here: the card, the route, the focus and the words.
   */
  onDeleted: (issue: Pick<Issue, "id" | "issueKey" | "status">, alreadyGone: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const meta = useMeta();
  const issueQuery = useQuery({
    ...issueDetailsOptions(projectId, issueId),
    // A cached answer that came without one of its parts is a success to
    // react-query and would be served again for the length of `staleTime`.
    // Reopening the panel is how a reader asks again — the sections' own
    // sentence says so — so here, and only on the panel's observer, a missing
    // part makes the cached answer stale. The sections' observers mount after
    // the read has answered and must not re-ask it themselves: that would be a
    // third request on every first open of an issue with a part missing.
    refetchOnMount: (query) => (hasMissingPart(query.state.data) ? "always" : true),
  });
  /**
   * Whether the comments read was already in the cache when this panel first
   * rendered — fixed once, before the prefetch below runs. A comments read the
   * panel started itself must not be asked again by the section when it
   * mounts, including when it *failed*: react-query re-asks an errored read for
   * every observer that mounts on it (`retryOnMount`), so a failure that landed
   * before the issue answered would otherwise go out twice (TAS-242).
   *
   * Fixed once per panel, which is once per issue only because the board
   * remounts the panel on every `issueId` (`key={issueId}` where it is drawn).
   */
  const [commentsPrefetched] = useState(
    () => queryClient.getQueryState(issueCommentsOptions(projectId, issueId).queryKey) === undefined,
  );
  // Started beside the issue read rather than when the comments section mounts
  // under the `if (!issue)` guard below: it needs only the two ids, and waiting
  // for the issue would cost the panel a second round (TAS-242). The issue read
  // and this are the panel's two requests (TAS-246).
  usePrefetchInfiniteQuery(issueCommentsOptions(projectId, issueId));
  /**
   * The work log (TAS-251, backend PR #178) on the same terms as the comments
   * above: its first page (TAS-421) started beside the issue read, so it is a
   * third request in the same round rather than a round of its own, and not
   * asked again by the section when it mounts.
   */
  const [worklogsPrefetched] = useState(
    () => queryClient.getQueryState(issueWorklogsOptions(projectId, issueId).queryKey) === undefined,
  );
  usePrefetchInfiniteQuery(issueWorklogsOptions(projectId, issueId));
  const issue = issueQuery.data?.issue;
  const history = issueQuery.data?.history ?? [];
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  /**
   * The panel's own refusal of a date box the reader has half typed — the one
   * thing this panel says that no request produced, which is why it is state
   * here and not a mutation's error.
   *
   * It exists because the refusal is otherwise *silent*: `commitDate` puts the
   * stored day back into the box and sends nothing, and until TAS-231 that was
   * the entire response — the reader watched their entry disappear and was told
   * nothing about it. The revert itself is right and stays (a `""` from a
   * half-typed box would be read as *clear the date* and erase a stored day);
   * the silence is the defect.
   *
   * The *field* is held rather than the sentence, because the sentence names
   * the box it is about (`planningDateIncompleteEditMessage`) and there are two
   * of them.
   *
   * `seq` counts the refusals. Refuse the same box twice — half-type the start
   * date, leave it, half-type it again — and the sentence is identical, so
   * React updates nothing, the live region below emits no mutation, and the
   * second refusal is announced to nobody: exactly as silent as the bug this
   * fixes (art-director measured the zero mutations on the first version of
   * this, where the two sentences were identical for *either* box). The count
   * is the node's `key`, which turns a repeat into a remount.
   */
  const [dateNotice, setDateNotice] = useState<{ field: PlanningDateField; seq: number } | null>(null);
  /**
   * Every write drops the date line, both when it starts and if it fails.
   *
   * When it starts, because this panel shows one line and a refusal about an
   * entry that never became a request must not be left standing as the caption
   * on the answer to something else — including a write of another field, and
   * including one that succeeds.
   *
   * If it fails, because a write that was already in flight when the reader
   * half-typed a date is answered *after* the date line went up, and this slot
   * is the only account a refused write gets: DESIGN.md §5.6 specifies a toast
   * and records that there is none. A write whose refusal loses the slot is
   * silent, which is the defect this story exists to remove.
   */
  const clearDateNotice = () => setDateNotice(null);
  // One prefix for the Planning block's five label/field pairs and the two
  // hints. Explicit `for`/`id` rather than a wrapping `<label>`: the hint has
  // to sit under the box without joining the label's accessible name, and a
  // wrapped label would read as "Original estimate e.g. 8h, 1h 30m, 45m".
  const planningId = useId();
  /** The Type row's label, which names its select (§5.5). */
  const typeRowId = useId();

  /**
   * A write refused because the issue had moved on (TAS-246), held apart from
   * the mutation's own error for two reasons. Its sentence is not the error's
   * message, and it outlives the mutation that raised it: the panel's writes
   * share one queue (`issueWriteScope`), and a write queued behind the refused
   * one becomes the observer's current mutation, taking the refused one's error
   * off `updateIssue.error` while the reader still needs to be told.
   *
   * `fields` is every field the line is about: what the refused write sent,
   * plus what an earlier conflict left unsaved. A choice — a priority, an
   * assignee, a planning value — is only news until the reader acts again, so
   * the next write that starts drops it. Free text is the reader's work and
   * stays in its box, so the line about it stays too, until that field is sent
   * again or its box goes back to the stored text (`keepUnsentText`,
   * `settleText`); a newer refusal of another kind takes the slot outright,
   * because the slot holds one refusal (DESIGN.md §5.5).
   *
   * `seq` remounts the line for every conflict, as `dateNotice`'s does for a
   * repeat.
   */
  const [conflict, setConflict] = useState<IssueConflict | null>(null);
  const clearConflict = () => setConflict(null);
  /** The box went back to the stored text, so nothing of the reader's is left unsaved in it. */
  const settleText = (field: FreeTextField) =>
    setConflict((previous) => {
      if (!previous?.fields.includes(field)) return previous;
      const fields = previous.fields.filter((held) => held !== field);
      return fields.length ? { ...previous, fields } : null;
    });

  // Reseed the drafts whenever the server copy changes. Done during render
  // rather than from an effect: the effect version cost an extra render pass
  // on every refetch. A key-based remount would reset focus mid-edit, which
  // this does not.
  const serverSummary = issue?.summary ?? "";
  const serverDescription = issue?.description ?? "";
  // The five planning fields ride the same pattern and for the same reason: a
  // reader types faster than the network answers, so the input holds a draft
  // (DESIGN.md §6, the inline-editing exception). They are one object rather
  // than five `useState`s because they reseed together and are compared
  // together — `samePlanningDrafts` is the comparison, and adding a sixth field
  // fails the typecheck there instead of being silently left out of this test.
  const serverPlanning = planningDrafts(issue);
  const [planning, setPlanning] = useState<PlanningDrafts>(serverPlanning);
  const [synced, setSynced] = useState<{ summary: string; description: string; planning: PlanningDrafts } | null>(null);
  if (
    !synced ||
    synced.summary !== serverSummary ||
    synced.description !== serverDescription ||
    !samePlanningDrafts(synced.planning, serverPlanning)
  ) {
    // Field by field, against the server copy the drafts were last seeded
    // from. One planning field is written per request and the panel refetches
    // the issue afterwards, so the answer to a write of the due date lands
    // while the reader may be halfway through the estimate beside it —
    // reseeding the block wholesale would throw those keystrokes away, and the
    // reader would watch a box they are typing in revert for no reason they
    // can see. `reseedPlanningDrafts` takes only the fields whose *server*
    // value moved; the summary and the description are re-read on the same
    // terms, rather than whenever anything in the condition above changed.
    //
    // A box whose text a conflict left unsaved is not reseeded at all: the
    // line under "Planning" says the reader's text is still in it, and a
    // re-read bringing yet another writer's text must not make that untrue.
    const previous = synced;
    const unsaved = conflict?.fields ?? [];
    setSynced({ summary: serverSummary, description: serverDescription, planning: serverPlanning });
    if ((!previous || previous.summary !== serverSummary) && !unsaved.includes("summary")) setSummary(serverSummary);
    if ((!previous || previous.description !== serverDescription) && !unsaved.includes("description")) {
      setDescription(serverDescription);
    }
    setPlanning((current) => reseedPlanningDrafts(current, previous?.planning ?? null, serverPlanning));
  }
  /**
   * The project was archived while the panel was open (DESIGN.md §5.7): the
   * planning boxes go `readOnly`, and a value typed into one and not yet sent
   * would then stand there as if the issue held it — and nothing can send it
   * any more. So the turn puts every planning draft back to the stored value,
   * as a refused write puts its own field back (§5.5). Free text is not
   * touched: the reader's words are work and stay, read-only, marked
   * `data-unsaved-text`. During render, for the reseed's reason above.
   */
  const [planningArchived, setPlanningArchived] = useState(archivedAt !== null);
  if (planningArchived !== (archivedAt !== null)) {
    setPlanningArchived(archivedAt !== null);
    if (archivedAt !== null) setPlanning(serverPlanning);
  }
  /**
   * So too a date box holding an entry the browser has not yet made a date of
   * (§5.7, TAS-397: `validity.badInput`): it shows the stored date or the empty
   * mask. The draft reset above cannot reach it — the segments never reached
   * React, so a stored "no date" renders the same `""` before and after and
   * leaves `12/--/----` standing, read-only. Written to the control after the
   * turn commits, as `commitDate` writes it; no line, no motion, no
   * announcement, and the box loses `data-unsaved-text` with its draft.
   */
  const startDateBox = useRef<HTMLInputElement>(null);
  const dueDateBox = useRef<HTMLInputElement>(null);
  const storedDates = useRef({ startDate: serverPlanning.startDate, dueDate: serverPlanning.dueDate });
  useEffect(() => {
    storedDates.current = { startDate: serverPlanning.startDate, dueDate: serverPlanning.dueDate };
  });
  useEffect(() => {
    if (!planningArchived) return;
    const boxes = [
      ["startDate", startDateBox.current],
      ["dueDate", dueDateBox.current],
    ] as const;
    for (const [field, box] of boxes) {
      if (box && isIncompleteDateEntry(box)) box.value = storedDates.current[field];
    }
  }, [planningArchived]);

  /**
   * The type the reader just picked, until its write is answered (§5.5,
   * TAS-417): the head's tile and name and the transition slot follow it in
   * the same frame, as the select does. The answer — or its refusal — puts the
   * issue's own type back in charge.
   */
  const [pendingType, setPendingType] = useState<IssueTypeCode | null>(null);
  const shownType = pendingType ?? issue?.issueType;
  const workflow = issue ? workflowFor(workflows, shownType ?? issue.issueType) : undefined;
  // These buttons are the drag's keyboard equivalent (§5.3), so they answer to
  // the same rule as the drop: only the server's own transitions, never the
  // fallback's. Offering a move built from an invented id would post that id.
  //
  // A VIEWER is offered none (§5.7, TAS-236), so the arrow goes with them; the
  // notes below about why no move is offered are about the issue, not the
  // reader, and stay for every role.
  //
  // On an archived project nobody is offered one either, ADMIN included
  // (§5.7), and the slot's own line says why instead of the notes below.
  const hidesWrites = isProjectViewer || archivedAt !== null;
  const availableTransitions =
    issue && workflow && !hidesWrites ? resolveTransitions(issue.status, workflow.statuses, workflow.transitions) : [];
  // The issue's status as its own workflow describes it, when it does: the name
  // the project chose and the category its colour comes from (TAS-173).
  const workflowStatus = issue ? workflow?.statuses.find((status) => status.statusKey === issue.status) : undefined;

  /**
   * Every write that starts drops the date line and what a conflict line says
   * about a choice; a conflict's free text stays unless this write sends it
   * again (`keepUnsentText`). A transition or a delete sends no field, so it
   * passes `{}`.
   */
  const writeStarts = (sent: UpdateIssueInput) => {
    clearDateNotice();
    setConflict((previous) => keepUnsentText(previous, sent));
  };
  /** A refusal of any other kind is the newest one, and the slot holds one (DESIGN.md §5.5). */
  const refusalLands = () => {
    clearDateNotice();
    clearConflict();
  };
  const { queryKey: issueKey } = issueDetailsOptions(projectId, issueId);

  /**
   * How many version conflicts have landed on this panel. Every edit carries
   * the count as it stood when the reader acted (`editIssue`), and an edit
   * made before the latest conflict is never sent.
   *
   * The version an edit sends is read when its request leaves (below), and a
   * conflict merges the server's version into the cache. So without this, an
   * edit queued behind the refused one — or two quick picks of one field —
   * would leave at the version the conflict brought, succeed, and lay the
   * reader's change over the very change the conflict was about, before the
   * reader had seen it (release-reviewer and api-contract-guard, TAS-246 pass 2).
   * A ref and not state: `mutationFn` has to read the count as it is when the
   * request would leave, not as it was at the last render.
   */
  const conflictEpoch = useRef(0);

  /**
   * `PATCH /issues/{issueId}` with the version the cache holds **when the
   * request leaves**, not when the reader acted (TAS-246).
   *
   * The panel's writes run one at a time (`scope`): a second edit made while
   * the first is in flight has its `onMutate` run at once and waits for its
   * request until the first has settled — and the first's `onSuccess` has
   * merged the new version into the cache by then, so the second reads it here
   * and does not conflict with its own predecessor.
   *
   * If the first was refused as a conflict instead, the second was asked for
   * over a version of the issue the reader never saw, and is answered as a
   * conflict of its own without being sent (`conflictEpoch`).
   *
   * No optimistic cache write: the drafts in the boxes already show what the
   * reader typed, and the server's answer is merged the moment it lands.
   */
  const updateIssue = useMutation({
    scope: { id: issueWriteScope(issueId) },
    mutationFn: ({ patch, epoch }: IssueEdit) => {
      const cached = queryClient.getQueryData(issueKey)?.issue;
      if (cached === undefined) throw new Error("This issue is not loaded, so there is no version to edit.");
      // Never sent, so no request id: `onError` keeps the one of the
      // conflict that made this write stale.
      if (epoch < conflictEpoch.current) throw new IssueVersionConflictError(cached, cached.version);
      return taskaApi.updateIssue(projectId, issueId, patch, cached.version);
    },
    // See `clearDateNotice`: every one of this panel's writes clears the date
    // line when it starts, this one included, and this is the case that needs
    // it — the reader who leaves the half-typed box alone and edits the
    // estimate beside it.
    onMutate: ({ patch }) => writeStarts(patch),
    // The picked type stops standing in for the issue's own once its write is
    // answered, whichever way — unless a later pick has replaced it.
    onSettled: (_answer, _error, { patch }) => {
      if (patch.issueType !== undefined) setPendingType((current) => (current === patch.issueType ? null : current));
    },
    onSuccess: (answer) => {
      // Synchronous, and before anything is awaited: a write queued behind
      // this one reads its version from the cache the moment this returns.
      queryClient.setQueryData(issueKey, (data) => (data ? mergeWriteAnswer(data, answer) : data));
      // Not awaited, so the queue is not held behind four re-reads.
      void invalidateBoard(queryClient, projectId);
    },
    // Rollback (§5.5). The summary and the description recover on their own —
    // the value the reader typed is still the best thing to show while they fix
    // it, and the field is free text either way. A refused planning field is
    // not: it was refused *because* it is not a value this issue can hold, so
    // leaving `2026-07-01` in a date box that the server still reads as
    // `2026-06-15` would show a state that does not exist. The stored reading
    // comes back and the message below says why. Reseeding on render cannot do
    // this on its own: a refused write changes nothing on the server, so
    // `synced` still matches and nothing would reseed.
    //
    // Only the field this request carried, though — the mutation's own
    // variables are the record of which one that was. Reverting all five would
    // undo drafts the server never saw, including whichever box the reader
    // moved on to while the refusal was in flight.
    onError: (error, { patch: sent, epoch }) => {
      if (!isIssueVersionConflict(error)) {
        // And this refusal takes the slot even if a date line went up while
        // the request was in flight — see `clearDateNotice` — or a conflict
        // line was still standing for a box.
        refusalLands();
        // A type change the server refused because the target workflow lacks
        // the status (backend TAS-418): the options were pre-disabled from
        // the context's workflows, so those were stale — read them again. The
        // slot prints the server's words; nothing branches on them.
        if (sent.issueType !== undefined && apiErrorFacts(error).details?.reason === STATUS_NOT_IN_TARGET_WORKFLOW_REASON) {
          void queryClient.invalidateQueries({ queryKey: projectContextKey(projectId) });
        }
        setPlanning((current) => rollbackPlanningDrafts(current, sent, planningDrafts(issueQuery.data?.issue)));
        return;
      }
      clearDateNotice();
      // Answered here without a request (`mutationFn`): the conflict that made
      // this write stale has already merged the issue and asked for a re-read,
      // and is already counted.
      const unsent = epoch < conflictEpoch.current;
      // The issue moved on. Show it as it now is — the answer carries it — and
      // never send the write again by ourselves: whether the reader's change
      // still makes sense over somebody else's is theirs to decide.
      const current = error.current;
      if (!unsent) {
        conflictEpoch.current += 1;
        queryClient.setQueryData(issueKey, (data) => (data ? mergeWriteAnswer(data, current) : data));
      }
      setPlanning((drafts) => rollbackPlanningDrafts(drafts, sent, planningDrafts(current)));
      // Free text is the exception, and the reason the sentence for it differs:
      // the reader's words are not a value the issue failed to hold, they are
      // work. They stay in the box, and `synced` is moved to the server's text
      // so the render-time reseed leaves them there; the next blur sends them
      // again, now with the version this answer carried.
      if (sent.summary !== undefined || sent.description !== undefined) {
        setSynced((previous) =>
          previous
            ? {
                ...previous,
                ...(sent.summary !== undefined ? { summary: current.summary } : {}),
                ...(sent.description !== undefined ? { description: current.description } : {}),
              }
            : previous,
        );
        if (sent.summary !== undefined) setSummary(sent.summary);
        if (typeof sent.description === "string") setDescription(sent.description);
      }
      // Added to what the line already says rather than replacing it: text an
      // earlier conflict left unsaved is still unsaved, and an edit refused
      // here without a request is the same news as the one that refused it.
      const refused = Object.keys(sent) as ConflictField[];
      setConflict((previous) => ({
        fields: [...(previous?.fields ?? []).filter((field) => !refused.includes(field)), ...refused],
        // The request that found the conflict is the one the gateway log has.
        error: unsent && previous ? previous.error : error,
        seq: (previous?.seq ?? 0) + 1,
      }));
      if (!unsent) void invalidateBoard(queryClient, projectId);
    },
  });
  /** An edit, stamped with the conflicts the reader had been shown when they made it. */
  const editIssue = (patch: UpdateIssueInput) => updateIssue.mutate({ patch, epoch: conflictEpoch.current });
  const transitionIssue = useMutation({
    // In the same queue as the edits: a transition bumps the version, so an
    // edit queued behind it has to read the version it left.
    scope: { id: issueWriteScope(issueId) },
    /**
     * With the version the cache holds when the request leaves (`If-Match`,
     * backend TAS-422), as an edit is sent. A transition asked for before the
     * latest conflict landed is never sent: it was chosen over a version the
     * server has already refused (`conflictEpoch`).
     */
    mutationFn: ({ transitionId, epoch }: IssueTransitionWrite) => {
      const cached = queryClient.getQueryData(issueKey)?.issue;
      if (cached === undefined) throw new Error("This issue is not loaded, so there is no version to move.");
      if (epoch < conflictEpoch.current) throw new UnsentTransition();
      return taskaApi.transitionIssue(projectId, issueId, transitionId, cached.version);
    },
    onMutate: () => writeStarts({}),
    onError: (error) => {
      const unsent = error instanceof UnsentTransition;
      if (!unsent && !isTransitionConflict(error)) {
        refusalLands();
        return;
      }
      // 409 `ABORTED` (DESIGN.md §5.5, P13′): the status was not changed. The
      // choice template with "status"; the issue is read again, so the panel
      // and its transitions show it as it now is, and the board with it. Never
      // retried, least of all with `details.currentVersion`.
      clearDateNotice();
      if (!unsent) {
        conflictEpoch.current += 1;
        // The issue and the board, once each: `invalidateBoard` re-reads every
        // issue of the project, this one among them.
        void invalidateBoard(queryClient, projectId);
      }
      setConflict((previous) => ({
        // Free text an earlier conflict left unsaved is still unsaved.
        fields: [...(previous?.fields ?? []).filter((field) => field !== "status"), "status"],
        // The request that found the conflict is the one the gateway log has.
        error: unsent && previous ? previous.error : error,
        seq: (previous?.seq ?? 0) + 1,
      }));
    },
    onSuccess: (answer) => {
      queryClient.setQueryData(issueKey, (data) =>
        data
          ? {
              ...data,
              issue: { ...data.issue, status: answer.status, version: answer.version, updatedAt: answer.updatedAt },
            }
          : data,
      );
      void invalidateBoard(queryClient, projectId);
    },
  });
  /**
   * Delete asks first (§4.10, TAS-299), in §4.22's strip in a fixed zone
   * between the head and the body. One press used to delete — the hazard
   * TAS-259 removed from comments, here with a whole issue behind it.
   * `asking` is the strip; Share and the strip close each other.
   */
  const [asking, setAsking] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const deleteConfirmId = useId();
  /** The panel's one refusal slot, scrolled to when a delete is refused. */
  const panelNoticeRef = useRef<HTMLDivElement>(null);
  /**
   * Not optimistic, by the argument §5.8 makes for the Users writes: a refused
   * delete of a panel that had already closed would have nowhere left to be
   * said. The strip waits, its two buttons `aria-disabled`, and the board is
   * told only once the server has answered (`onDeleted`).
   *
   * A 404 is the issue already gone — deleted elsewhere in the meantime — and
   * takes the success path with its own sentence. Not `invalidateBoard`, and
   * not here at all: the board removes the card and reads itself again, and
   * this path deliberately leaves `["issue", projectId, issueId]`
   * alone, because this panel is still mounted for one more tick and a re-read
   * of the issue just deleted would put a 404 on screen on the way out.
   */
  const deleteIssue = useMutation({
    mutationFn: async (): Promise<{ alreadyGone: boolean }> => {
      try {
        await taskaApi.deleteIssue(projectId, issueId);
        return { alreadyGone: false };
      } catch (error) {
        if (isIssueGone(error)) return { alreadyGone: true };
        throw error;
      }
    },
    onMutate: () => {
      writeStarts({});
      // The slot holds one refusal, and the newest: an edit's or a move's that
      // is already standing must not sit in front of this one's (§5.5).
      if (updateIssue.isError) updateIssue.reset();
      if (transitionIssue.isError) transitionIssue.reset();
    },
    onError: () => {
      refusalLands();
      // The strip closes and focus goes back to the Delete that asked. Moved
      // before the strip unmounts, so it never falls to <body> in between.
      deleteButton.current?.focus();
      setAsking(false);
      // The board shows what the server actually did. A refusal says nothing
      // was deleted — issue-service checks the role before the soft delete, in
      // one transaction with the history and outbox writes (backend PR #206,
      // TAS-300) — but a timeout, a 5xx or a dropped connection leaves the
      // outcome unknown, so on any failure the board is read again, as on
      // success.
      void queryClient.invalidateQueries({ queryKey: boardKey(projectId) });
    },
    onSuccess: ({ alreadyGone }) => {
      const deleted = queryClient.getQueryData(issueKey)?.issue ?? issue;
      if (deleted) onDeleted(deleted, alreadyGone);
    },
  });
  const deleting = deleteIssue.isPending;
  // Shown where every refusal of this panel is shown, and scrolled into view
  // there: the reader's eye is on the head, and the slot may be below the fold.
  const deleteRefusal = deleteIssue.error;
  useEffect(() => {
    if (deleteRefusal) panelNoticeRef.current?.scrollIntoView({ block: "nearest" });
  }, [deleteRefusal]);
  /**
   * Cancel and Esc: the question closes and the panel stays, with focus back
   * on the Delete that asked (§4.22) — moved before the strip unmounts, so it
   * never falls to <body> in between.
   */
  const cancelDelete = () => {
    deleteButton.current?.focus();
    setAsking(false);
  };
  /**
   * Esc while the question is open closes the question, wherever focus is in
   * the panel, and leaves the panel open (§4.10's Esc order, TAS-380): one
   * press closes one thing. `preventDefault()` is what tells the panel's own
   * listener — on `window`, after this one — that the press was used. While
   * the delete is out, Esc does nothing at all; and when Share is open, Share
   * is the inner one and its own dismissal takes the press.
   */
  useEffect(() => {
    if (!asking) return;
    const closeQuestion = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing || shareOpen) return;
      event.preventDefault();
      if (deleting) return;
      deleteButton.current?.focus();
      setAsking(false);
    };
    document.addEventListener("keydown", closeQuestion);
    return () => document.removeEventListener("keydown", closeQuestion);
  }, [asking, shareOpen, deleting]);

  const loading = !issue && !issueQuery.isError;
  /**
   * The frame's head and name in each state (TAS-380, art-director's ruling
   * 7). The name is "{KEY} issue" as soon as the key is known, from the board
   * page or from the issue; "Issue" only when neither has it. Close takes
   * focus while the panel loads, so that first name is the one a screen reader
   * announces, and a later rename is not announced again. Loading: a skeleton
   * of the key beside the real Close. A read that failed: the key if the
   * board's read holds it. Share and Delete only once the issue has loaded.
   */
  const head = useIssuePanelHead({
    label: issue ? `${issue.issueKey} issue` : boardIssueKey ? `${boardIssueKey} issue` : "Issue",
    busy: loading,
    asking: Boolean(issue) && asking && !hidesWrites,
  });

  if (!issue) {
    if (loading) {
      // The words are for a screen reader only and the eye gets the skeleton
      // (§5.6) — the same split, and the same reason, as the admin area's
      // pending screen: `aria-busy` alone announces nothing.
      return (
        <>
          {head.start(
            <span aria-hidden="true" className="issue-panel-head-slot is-skeleton">
              <span className="value-skeleton panel-skeleton-chip" />
              <span className="value-skeleton panel-skeleton-key" />
              <span className="value-skeleton panel-skeleton-type" />
            </span>,
          )}
          <p className="visually-hidden" role="status">
            Loading issue
          </p>
          <IssuePanelSkeleton />
        </>
      );
    }
    // The panel's one read is the whole panel since TAS-246, so its failure is
    // stated the way a screen's is (`IssueKeyScreen`): a sentence, the server's
    // words, and the request id that finds it in the gateway log.
    return (
      <>
        {boardIssueKey ? head.start(<span className="issue-key">{boardIssueKey}</span>) : null}
        <div className="panel-loading">
          <ApiNotice error={issueQuery.error}>This issue could not be opened.</ApiNotice>
        </div>
      </>
    );
  }

  // Named by the issue read itself since TAS-246; the member list is the
  // fallback for a summary the server could not fill (`personFor`).
  const reporter = personFor(issue.reporterId, issue.reporter, userById);
  // Every word the panel says about a code: the type's from the registry by
  // §6's type rule (TAS-417), the rest by the one label rule (TAS-173).
  const typeShown = shownType ?? issue.issueType;
  const typeName = issueTypeLabel(typeShown, registry);
  const typeWord = issueTypeInSentence(typeShown, registry);
  const statusName = statusLabel(issue.status, workflow?.statuses);
  // The status as the issue's saved type names it, for the Type select's
  // unavailable options — the workflow it is a status of.
  const savedStatusName = statusLabel(issue.status, workflowFor(workflows, issue.issueType)?.statuses);
  /**
   * The Type select's options (§5.5, TAS-417): the registry in its order, and
   * the issue's own type last, by its key, when the registry does not hold it.
   * A type whose workflow lacks the issue's status is offered but off — the
   * server would refuse the change (`STATUS_NOT_IN_TARGET_WORKFLOW`); a type
   * with no workflow in the context, or an issue with no status, is left to
   * the server.
   */
  const typeOptions = [
    ...(registry ?? []).map((entry) => entry.code),
    ...(registry?.some((entry) => entry.code === issue.issueType) ? [] : [issue.issueType]),
  ].map((code) => {
    const target = workflowFor(workflows, code);
    const unavailable =
      code !== issue.issueType && Boolean(issue.status) && target !== undefined
        ? !target.statuses.some((status) => status.statusKey === issue.status)
        : false;
    const name = issueTypeLabel(code, registry);
    return { code, unavailable, label: unavailable ? `${name} — no ${savedStatusName} status` : name };
  });
  // What `GET /meta` lists, or the contract's three while it has not answered
  // (art-director's ruling 5) — and the issue's own value always: a priority
  // the list does not carry is still this issue's, so it is appended last and
  // drawn active rather than leaving the control with nothing selected.
  const offeredPriorities = selectableCodes(meta?.priorities, issuePriorities);
  const priorityChoices: IssuePriorityCode[] =
    issue.priority && !offeredPriorities.includes(issue.priority) ? [...offeredPriorities, issue.priority] : offeredPriorities;

  /**
   * Put a draft back the way the server has it: a half-typed date the browser
   * could not read (`commitDate`), which is a different thing from the
   * rollback of a write that was refused.
   */
  const revertPlanning = (field: keyof PlanningDrafts) =>
    setPlanning((current) => ({ ...current, [field]: serverPlanning[field] }));

  /**
   * Enter commits by blurring rather than by writing directly, so the mouse and
   * the keyboard take the same path and there is one commit rule instead of
   * two.
   *
   * Escape no longer abandons the draft (TAS-380, §4.10's Esc order): with a
   * typed value that differs from the stored one, Esc leaves the panel, the
   * text and the focus where they are — the field says so through
   * `data-unsaved-text`, which the panel's own Esc reads. With nothing unsaved,
   * Esc closes the panel like anywhere else in it.
   */
  const planningKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
    }
  };
  /** `data-unsaved-text` for a box whose draft is not the stored value (§4.10's Esc order). */
  const unsavedPlanning = (field: keyof PlanningDrafts) =>
    canEdit && planning[field] !== serverPlanning[field] ? "true" : undefined;

  const draftOf = (field: keyof PlanningDrafts) => (value: string) =>
    setPlanning((current) => ({ ...current, [field]: value }));

  /**
   * Send one field and only that field. The body carries the single key that
   * changed, and since TAS-246 the wire is a merge patch that leaves the other
   * four alone on the server — nothing is re-sent and nothing is read first.
   *
   * Nothing is sent when the parsed draft already equals the stored value. The
   * draft is normalised to the stored reading instead, so `3.0` becomes `3` and
   * ` 8H ` becomes `8h` without spending a request that would change nothing.
   * A draft that parsed to `NaN` is never equal to anything, so it is always
   * sent and always refused — by `planningFieldRefusal`, in its words. This
   * component deliberately states no bound, no format and no message of its
   * own: two rulebooks for one field is how they come to disagree.
   */
  const commitStoryPoints = () => {
    if (!canEdit) return;
    const next = parseStoryPoints(planning.storyPoints);
    if (next === issue.storyPoints) {
      draftOf("storyPoints")(next === null ? "" : formatStoryPoints(next));
      return;
    }
    editIssue({ storyPoints: next });
  };

  // This and `commitDate` take the field beside the event rather than
  // returning a handler built during render: an edit reads `conflictEpoch`,
  // and the React Compiler lint reads a ref behind a handler built during
  // render as a ref read during render.
  const commitEstimate = (field: "originalEstimateMinutes" | "remainingEstimateMinutes") => {
    if (!canEdit) return;
    const next = parseDuration(planning[field]);
    if (next === issue[field]) {
      draftOf(field)(next === null ? "" : formatDuration(next));
      return;
    }
    editIssue(
      field === "originalEstimateMinutes" ? { originalEstimateMinutes: next } : { remainingEstimateMinutes: next },
    );
  };

  /**
   * Put the date refusal in the slot, and drop whatever a write had left there.
   *
   * The `reset()` calls are the other half of `clearDateNotice`. A mutation
   * holds its error until the next attempt, so a refusal the reader has already
   * read would otherwise wait behind this line and come back the moment it
   * clears — announced a second time by `role="alert"`, with no attempt behind
   * it. An error line that reappears without an action is a ghost and not a
   * record, so the older refusal is dropped rather than queued (TAS-231,
   * art-director). With `clearDateNotice` on both sides of every write, neither
   * source is ever *left* holding something the other has replaced — with the
   * one-tick exception `panelNotice` sets out below, where a render can still
   * read the error this function has already dropped, and where asking the date
   * line first is what keeps that tick off the screen.
   *
   * Only a *failed* write is reset. One still in flight keeps its state, so
   * nothing here re-enables a control that is waiting on the server, and its
   * own refusal still reaches the slot — through `onError`, which clears this
   * line in turn.
   */
  const refuseDate = (field: PlanningDateField) => {
    if (updateIssue.isError) updateIssue.reset();
    if (transitionIssue.isError) transitionIssue.reset();
    if (deleteIssue.isError) deleteIssue.reset();
    // The conflict line too, for the same reason: it is a refusal already read.
    clearConflict();
    // A fresh `seq` on every refusal, including a repeat of the same sentence:
    // see the state's own comment for why identical text has to remount.
    setDateNotice((current) => ({ field, seq: (current?.seq ?? 0) + 1 }));
  };

  /**
   * A date needs no parsing: `<input type="date">` holds exactly `YYYY-MM-DD`,
   * which is `DateOnly` (an empty box is `""`). It is passed through as the
   * string it is — a `Date` here would hand a moment in time to a field that
   * means a calendar day.
   */
  const commitDate = (field: "startDate" | "dueDate", event: FocusEvent<HTMLInputElement>) => {
    if (!canEdit) return;
    // A half-typed date is not a cleared one. `<input type="date">` reports
    // `value === ""` both when the reader emptied it and when only some of its
    // segments are filled, and the second reads as `null` — *clear the stored
    // date* — so tabbing out of a date the reader was halfway through typing
    // would erase the day the issue actually has. `validity.badInput` is the
    // only thing that tells the two apart: the browser sets it exactly when the
    // control holds an entry it cannot turn into a date. Nothing is sent, the
    // stored value comes back into the box — and, since TAS-231, the panel says
    // so: the revert on its own was a value disappearing with no account of it
    // anywhere on screen, which is the half of this the tester reported.
    if (isIncompleteDateEntry(event.currentTarget)) {
      // Written to the control as well as to the draft. React cannot clear a
      // partial entry on its own: the `value` prop it holds is `""` before and
      // after — the segments the reader typed never reached it — so a stored
      // date of nothing would re-render to the same `""` and leave `12/--/----`
      // standing in the box. Assigning the value is what discards the bad
      // input, and it is assigned the same string the draft below reverts to,
      // so the two do not drift.
      event.currentTarget.value = serverPlanning[field];
      revertPlanning(field);
      // The sentence the revert used to leave unsaid. Said through the panel's
      // own error slot rather than beside the box, because that slot is where
      // every other refusal of a planning field already lands — including the
      // date-order advice this is most likely to be confused with, and a reader
      // who learns to look in one place should not have to learn a second.
      refuseDate(field);
      return;
    }
    // Whatever happens below — a write, or a draft merely normalised because it
    // already matched the stored day — this box now holds a date the browser
    // could read, so the sentence about it is spent.
    clearDateNotice();
    const draft = planning[field].trim();
    const next = draft === "" ? null : draft;
    if (next === issue[field]) {
      draftOf(field)(next ?? "");
      return;
    }
    editIssue(field === "startDate" ? { startDate: next } : { dueDate: next });
  };

  /**
   * One slot and one sentence, held by whichever refusal is newest.
   *
   * This reads as a priority and is nearly not one: the two sources cannot both
   * be left holding something. Every write clears the date line when it starts
   * and if it fails (`clearDateNotice`), and a date refusal resets a failed
   * write as it takes the slot (`refuseDate`).
   *
   * The order still earns its keep for one tick. The query client notifies its
   * observers on a macrotask, so the render that puts this line up can still
   * read the error `refuseDate` dropped a moment earlier — and the date line
   * being asked first is what keeps that tick off the screen.
   *
   * What the chain below does *not* order is two writes that have both failed
   * since the last attempt — it keeps the first of a fixed order rather than
   * the newer refusal. That is this panel's pre-existing rule for the write
   * side and is left exactly as it was.
   *
   * A version conflict sits between the two (TAS-246): it is a write's refusal,
   * but held in its own state (`conflict`), and its sentence is the panel's
   * rather than the error's message. A refused date write gets the panel's
   * advice instead of the server's sentence (`writeFailureText`).
   *
   * So a conflict is never read off `updateIssue.error`, whatever `conflict`
   * holds. That error stays on the mutation until the next edit, and read here
   * it would stand in front of a later transition's or delete's own refusal,
   * or come back as a line the reader had already settled.
   */
  const editRefusal = isIssueVersionConflict(updateIssue.error) ? null : updateIssue.error;
  // A transition's conflict likewise (TAS-422): held in `conflict`, never read off the mutation.
  const transitionRefusal =
    isTransitionConflict(transitionIssue.error) || transitionIssue.error instanceof UnsentTransition
      ? null
      : transitionIssue.error;
  const writeError = editRefusal ?? transitionRefusal ?? deleteIssue.error;
  const shownError: unknown = dateNotice ? null : (conflict?.error ?? writeError);
  const panelNotice = dateNotice
    ? planningDateIncompleteEditMessage(dateNotice.field)
    : conflict
      ? issueConflictText(conflict.fields)
      : writeError
        ? writeFailureText(writeError, editRefusal === writeError ? updateIssue.variables?.patch : undefined)
        : null;
  // The id that finds the refusal in the gateway log, beside the sentence and
  // outside its live region — `WatcherNoteDetail`'s rule: an assertive region
  // must not spell out a uuid. Mock mode never carries one.
  const shownRequestId = apiErrorFacts(shownError).requestId;
  const noticeKey = dateNotice ? `date-${dateNotice.seq}` : conflict ? `conflict-${conflict.seq}` : "write";

  return (
    <>
      {head.start(
        <>
          <TypeChip registry={registry} type={typeShown} />
          <span className="issue-key">{issue.issueKey}</span>
          <span className="issue-type-label" title={typeName}>
            {typeName}
          </span>
        </>,
      )}
      {head.actions(
        <>
          {/* Read-only, so not gated by role (TAS-248). Only in the loaded
              head: the skeleton's has no key to share yet. Opening it closes
              the delete question, as opening the question closes it. */}
          <IssueShare
            issueId={issue.id}
            issueKey={issue.issueKey}
            onOpenChange={(open) => {
              setShareOpen(open);
              // Not while the delete is out: the strip's aria-disabled
              // answers are the only sign of the request (art-director N1).
              if (open && !deleting) setAsking(false);
            }}
            open={shareOpen}
            projectId={issue.projectId}
          />
          {/* Hidden from a VIEWER rather than shut (§5.7, TAS-236); for a role
              nobody stated it stays, disabled (TAS-226), and asks nothing.
              §4.1's ghost-destructive: `--danger` under the pointer and while
              its question is open. A second press closes the question; Esc
              closes it too, from anywhere in the panel (above). */}
          {hidesWrites ? null : (
            <button
              aria-controls={asking ? deleteConfirmId : undefined}
              aria-expanded={asking}
              aria-label={`Delete issue ${issue.issueKey}`}
              className="icon-button issue-delete"
              disabled={!canEdit}
              onClick={() => {
                if (!canEdit || deleting) return;
                setShareOpen(false);
                setAsking((open) => !open);
              }}
              ref={deleteButton}
              title="Delete"
              type="button"
            >
              <Trash2 aria-hidden="true" size={15} />
            </button>
          )}
        </>,
      )}
      {/* Not once the project is archived under an open question: its answer
          is a write nothing here offers any more. */}
      {asking && !hidesWrites ? (
        // Between the head and the body and outside the scroll (§4.10): the
        // head is one row of 52 and cannot take a sentence, and at the top of
        // a scrolled body the question would be off screen. The body gives up
        // the height rather than being covered. No entrance animation.
        <div className="issue-delete-zone">
          <div className="member-confirm issue-delete-confirm" id={deleteConfirmId}>
            <p className="member-confirm-sentence" id={`${deleteConfirmId}-sentence`}>
              {issue.issueKey} will be deleted for everyone, with its comments, attachments, work log and links. This
              cannot be undone.
            </p>
            <div className="member-confirm-actions">
              {/* Both `aria-disabled` while the request is out (§4.1's
                  in-flight recipe): no fade, the labels unchanged, and the
                  handlers refuse — Cancel included, because the answer is
                  already on its way. */}
              <button
                aria-disabled={deleting || undefined}
                autoFocus
                className="secondary-button compact-button"
                onClick={() => {
                  if (!deleting) cancelDelete();
                }}
                type="button"
              >
                Cancel
              </button>
              <button
                aria-describedby={`${deleteConfirmId}-sentence`}
                aria-disabled={deleting || undefined}
                className="secondary-button compact-button member-confirm-accept"
                onClick={() => {
                  if (!deleting) deleteIssue.mutate();
                }}
                type="button"
              >
                Delete issue
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <div className="issue-panel-body">
        {/* `readOnly` rather than `disabled` without write access (§4.3,
            §5.7, TAS-299): the text keeps full contrast, selects, copies and
            keeps its Tab stop. The commits early-return on the same flag,
            because a read-only control still fires `blur`. */}
        <textarea
          className="summary-textarea"
          // Unsaved text holds the panel open on Esc (§4.10, TAS-380) — and
          // keeps holding it once an archive has made the box read-only with
          // the reader's words still in it (§5.7): they are still unsaved.
          data-unsaved-text={(canEdit || archivedAt !== null) && summary !== issue.summary ? "true" : undefined}
          onBlur={() => {
            if (!canEdit) return;
            if (summary.trim() && summary !== issue.summary) editIssue({ summary: summary.trim() });
            // Put back to the stored text: nothing of the reader's is left
            // unsaved here, so a conflict line about it has nothing to say.
            else if (summary === issue.summary) settleText("summary");
          }}
          onChange={(event) => setSummary(event.target.value)}
          readOnly={!canEdit}
          rows={2}
          value={summary}
        />

        {/* A group named for what it is about (§4.1, TAS-382): the moves and
            the pill of the status they leave. On the row itself — a
            `display: contents` wrapper loses the group role in Safari. */}
        <div aria-label="Status" className="transition-row" role="group">
          {/* §4.5's pill. A status this build cannot colour — an unknown key
              in an unknown category — takes the neutral `--fg-2` rather than
              a colour nobody chose (art-director, TAS-173). */}
          <span
            className="status-pill"
            style={{ color: statusColor(issue.status, workflowStatus?.category) ?? "var(--fg-2)" }}
          >
            {statusName}
          </span>
          {availableTransitions.length ? <span className="arrow">→</span> : null}
          {/* Said here as well as on the board behind this panel: the panel
              covers the notice stack, and an empty row beside a status pill
              reads as "this issue has nowhere to go" rather than "we do not
              know where it can go". */}
          {archivedAt ? (
            // The archive displaces every other line of the slot (§5.7): it is
            // the reason for every one of them. Focusable from script only —
            // where focus goes when the panel turns read-only under the
            // reader and the control they were on went with it.
            <span className="transition-note" data-archive-note="panel" tabIndex={-1}>
              This project was archived on {archivedOnDay(archivedAt)}, so this issue is read-only.
            </span>
          ) : workflowUnknown ? (
            <span className="transition-note">The workflow could not be loaded, so no move is offered.</span>
          ) : workflows && !workflow ? (
            // The context answered without this issue's type: the project no
            // longer allows it (TAS-251). Not a failure, and not "nowhere to go".
            <span className="transition-note">
              This project has no workflow for {typeWord} issues, so no move is offered.
            </span>
          ) : workflow && sentWithoutStatuses(workflow) ? (
            // A workflow arrived with nothing in it (TAS-261) — the drop's
            // third refusal, read off the same predicate.
            <span className="transition-note">
              The server sent this project&rsquo;s {typeWord} workflow without statuses, so no move is offered.
            </span>
          ) : workflow && !issue.status ? (
            // The issue arrived with no status (TAS-173): there is nothing to
            // move it from.
            <span className="transition-note">This issue has no status, so no move is offered.</span>
          ) : workflow && !workflowStatus ? (
            // A status the issue's own workflow does not list — the card sits
            // in «Outside their workflow» — so no transition can start from it.
            <span className="transition-note">
              {statusName} is not in this project&rsquo;s {typeWord} workflow, so no move is offered.
            </span>
          ) : null}
          {availableTransitions.map((transition) => {
            // The name an admin gave it, and where it goes (§4.1): "Close"
            // since backend PR #208's migration is also the panel's own Close.
            const { text, ariaLabel } = transitionButtonLabel(
              transition.name,
              statusLabel(transition.toStatus, workflow?.statuses),
            );
            return (
              <button
                aria-label={ariaLabel}
                className="secondary-button compact-button"
                disabled={!canEdit || transitionIssue.isPending}
                key={transition.id}
                onClick={() => transitionIssue.mutate({ transitionId: transition.id, epoch: conflictEpoch.current })}
                type="button"
              >
                {text}
              </button>
            );
          })}
        </div>

        <div className="meta-grid">
          <span>Assignee</span>
          <div className="chip-row">
            {/* "None" unassigns, since TAS-246: the edit is a PATCH, whose
                `assigneeId` is nullable, where the old assign route required
                an id and could not clear one (docs/ai/API-DIVERGENCE.md,
                "Closed by TAS-246: an assignee could not be cleared — by
                contract"). On an unassigned issue it is the field's current
                value and a press changes nothing, so the handler sends
                nothing — but it is `aria-disabled`, not `disabled`, and not
                faded: the answer to a keyboard press on it is what makes the
                issue unassigned, and a real `disabled` landing on the button
                that has focus drops focus to `<body>` (§4.21, §5.5). A real
                `disabled` is only for a reader who cannot edit (§5.7). */}
            <AssigneeChip
              active={!issue.assigneeId}
              ariaDisabled={canEdit && issue.assigneeId == null}
              disabled={!canEdit}
              label="None"
              onClick={() => {
                if (canEdit && issue.assigneeId != null) editIssue({ assigneeId: null });
              }}
              user={null}
            />
            {/* Offered only to the people the server takes as an assignee
                (`canBeAssigned`), where every member used to get a chip and a
                VIEWER's was a request the server refuses.

                The current assignee stays whatever their role is now: somebody
                assigned and then demoted is still who holds the issue, and
                dropping the chip would draw it as unassigned. That chip is the
                assignment, not an offer — `disabled`, because pressing an
                active chip sends the assignment again, and for this person
                that is the refused request. The board's assignee filter keeps
                everyone: it asks who holds an issue, not who may. */}
            {members
              .filter((member) => canBeAssigned(member) || member.userId === issue.assigneeId)
              .map((member) => {
                const assignable = canBeAssigned(member);
                return (
                  <AssigneeChip
                    active={issue.assigneeId === member.userId}
                    disabled={!canEdit || !assignable}
                    key={member.userId}
                    label={member.user?.displayName.split(" ")[0] ?? "User"}
                    onClick={() => {
                      if (canEdit && assignable) editIssue({ assigneeId: member.userId });
                    }}
                    user={
                      member.user
                        ? {
                            id: member.userId,
                            displayName: member.user.displayName,
                            color: member.user.color,
                            // Same row, same reason as the filter above: the
                            // picture is already in hand.
                            avatarUrl: member.user.avatarUrl,
                          }
                        : null
                    }
                  />
                );
              })}
          </div>
          <span id={typeRowId}>Type</span>
          {canEdit ? (
            // §5.5 (TAS-417): one field, one PATCH, on `change`, in the
            // panel's queue — the tile of the chosen type inside the field.
            <span className="type-select">
              <TypeChip registry={registry} type={typeShown} />
              <select
                aria-labelledby={typeRowId}
                onChange={(event) => {
                  const picked = event.target.value;
                  if (picked === typeShown) return;
                  setPendingType(picked);
                  editIssue({ issueType: picked });
                }}
                value={typeShown}
              >
                {typeOptions.map((option) => (
                  <option disabled={option.unavailable} key={option.code} value={option.code}>
                    {option.label}
                  </option>
                ))}
              </select>
            </span>
          ) : (
            // Not a disabled select (§4.3's argument): the type as text, in a
            // row as tall as the select, so the grid holds when a role arrives.
            <span className="type-static">
              <TypeChip registry={registry} type={typeShown} />
              <strong>{typeName}</strong>
            </span>
          )}
          <span>Priority</span>
          <div className="segmented compact fit">
            {priorityChoices.map((priority) => (
              <button
                aria-pressed={issue.priority === priority}
                className={issue.priority === priority ? "is-active" : ""}
                disabled={!canEdit}
                key={priority}
                onClick={() => editIssue({ priority })}
                type="button"
              >
                {priorityLabel(priority, meta?.priorities)}
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

        {/* The five planning fields (TAS-189), right under the meta they
            belong with and above the description, because they are read in
            the same glance as assignee and priority.

            Every box is an inline edit on the terms §4.3 and §5.5 set for the
            summary: no edit mode, commit on blur or Enter. Esc with unsaved
            text keeps the panel, the text and the focus (§4.10, TAS-380).
            The one departure from the summary is deliberate — these commit on
            blur rather than on a debounce, because a half-typed duration or a
            half-picked date is a value the server would refuse, and a debounce
            would send it.

            An empty box shows `—` and never `0`: for the three text fields
            that is the placeholder below, and for the two dates it is the
            browser's own empty date mask, which `type="date"` draws instead of
            any placeholder we set — so `data-empty` hands the CSS the one fact
            it cannot see, and the mask is set in `--fg-3` like every other
            placeholder in the product (§4.3). Both read as "not set"; neither
            reads as a number nobody entered.

            A reader without write access gets `readOnly` rather than
            `disabled` (§5.7). The values are the point of the block for them
            too: `disabled` would dim the lot, drop the em dash under 2:1, and
            take five focusable boxes out of the tab order, so the one reader
            most likely to be copying a date out of here could not reach it.
            The commits below early-return on the same flag, because a
            read-only control can still fire `blur`. */}
        <section className="issue-planning">
          <h3>Planning</h3>
          <div className="planning-grid">
            {/* Two rows rather than a column pair: the three short boxes read
                across the top and the two dates share the row below, which is
                the shape the values have. A 2×3 grid left an empty cell under
                the fifth field — an orphan the eye reads as a missing sixth
                field — and cost the panel a row of height for it. */}
            <div className="planning-row is-three">
              <div className="planning-field">
                <label htmlFor={`${planningId}-story-points`}>Story points</label>
                <input
                  id={`${planningId}-story-points`}
                  // Not `type="number"`: 1.5 is a legal value (`format: double`)
                  // and a spinner on a story-point field invites clicking it to
                  // a number nobody meant. `inputMode` still brings up the
                  // decimal keypad on a phone.
                  inputMode="decimal"
                  onBlur={commitStoryPoints}
                  onChange={(event) => draftOf("storyPoints")(event.target.value)}
                  data-unsaved-text={unsavedPlanning("storyPoints")}
                  onKeyDown={planningKeyDown}
                  placeholder={PLANNING_EMPTY_PLACEHOLDER}
                  readOnly={!canEdit}
                  type="text"
                  value={planning.storyPoints}
                />
              </div>
              <div className="planning-field">
                <label htmlFor={`${planningId}-original-estimate`}>Original estimate</label>
                <input
                  aria-describedby={canEdit ? `${planningId}-original-estimate-hint` : undefined}
                  id={`${planningId}-original-estimate`}
                  onBlur={() => commitEstimate("originalEstimateMinutes")}
                  onChange={(event) => draftOf("originalEstimateMinutes")(event.target.value)}
                  data-unsaved-text={unsavedPlanning("originalEstimateMinutes")}
                  onKeyDown={planningKeyDown}
                  placeholder={PLANNING_EMPTY_PLACEHOLDER}
                  readOnly={!canEdit}
                  type="text"
                  value={planning.originalEstimateMinutes}
                />
                {/* On screen rather than in a `title`: a tooltip does not fire
                    on a touch device, so the one place the duration syntax was
                    stated was the one place half the readers cannot reach.
                    A typing hint, so only for a reader who can type here: a
                    read-only box has nothing to say how to enter (TAS-299). */}
                {canEdit ? (
                  <p className="planning-hint" id={`${planningId}-original-estimate-hint`}>
                    {PLANNING_ESTIMATE_HINT}
                  </p>
                ) : null}
              </div>
              <div className="planning-field">
                <label htmlFor={`${planningId}-remaining-estimate`}>Remaining estimate</label>
                <input
                  aria-describedby={canEdit ? `${planningId}-remaining-estimate-hint` : undefined}
                  id={`${planningId}-remaining-estimate`}
                  onBlur={() => commitEstimate("remainingEstimateMinutes")}
                  onChange={(event) => draftOf("remainingEstimateMinutes")(event.target.value)}
                  data-unsaved-text={unsavedPlanning("remainingEstimateMinutes")}
                  onKeyDown={planningKeyDown}
                  placeholder={PLANNING_EMPTY_PLACEHOLDER}
                  readOnly={!canEdit}
                  type="text"
                  value={planning.remainingEstimateMinutes}
                />
                {canEdit ? (
                  <p className="planning-hint" id={`${planningId}-remaining-estimate-hint`}>
                    {PLANNING_ESTIMATE_HINT}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="planning-row">
              <div className="planning-field">
                <label htmlFor={`${planningId}-start-date`}>Start date</label>
                <input
                  // The browser draws its own `dd.mm.yyyy` mask in an empty
                  // date box, at the text colour, which reads as a value
                  // somebody entered. This is what lets the CSS put it at
                  // `--fg-3` — where §4.3 puts a placeholder — so an empty
                  // date reads as empty next to the `—` in the boxes above.
                  data-empty={planning.startDate === ""}
                  id={`${planningId}-start-date`}
                  onBlur={(event) => commitDate("startDate", event)}
                  onChange={(event) => draftOf("startDate")(event.target.value)}
                  data-unsaved-text={unsavedPlanning("startDate")}
                  onKeyDown={planningKeyDown}
                  readOnly={!canEdit}
                  ref={startDateBox}
                  type="date"
                  value={planning.startDate}
                />
              </div>
              <div className="planning-field">
                <label htmlFor={`${planningId}-due-date`}>Due date</label>
                <input
                  data-empty={planning.dueDate === ""}
                  id={`${planningId}-due-date`}
                  onBlur={(event) => commitDate("dueDate", event)}
                  onChange={(event) => draftOf("dueDate")(event.target.value)}
                  data-unsaved-text={unsavedPlanning("dueDate")}
                  onKeyDown={planningKeyDown}
                  readOnly={!canEdit}
                  ref={dueDateBox}
                  type="date"
                  value={planning.dueDate}
                />
              </div>
            </div>
          </div>
        </section>

        {/* `role="alert"` because this line is the *only* account of a
            refused write, and a planning field puts its stored value back at
            the same moment (§5.5) — so without a live region a screen-reader
            reader watches the box revert with nothing said. Same treatment as
            the admin write dialogs. Since TAS-231 it carries the half-typed
            date refusal too, which is the same shape of event without a
            request behind it: a box reverts, and this is what says why.

            The `key` is that refusal's sequence number, so a repeat of the
            same sentence remounts this node instead of re-rendering identical
            text — a live region that emits no mutation announces nothing, and
            the second refusal would be as silent as the first bug. A version
            conflict carries one for the same reason. A write's other refusals
            need no counter: the mutation drops the error as the next attempt
            starts, so the node goes away and comes back on its own.

            The live region is the sentence, not the box: the request id under
            it is plain text, as in `WatcherNoteDetail` and `ApiNotice`, so an
            assertive announcement never reads a uuid out. The box is
            `ErrorNote`, the panel's one error look (TAS-192). */}
        {panelNotice ? (
          <ErrorNote key={noticeKey} live="alert" ref={panelNoticeRef} requestId={shownRequestId}>
            {panelNotice}
          </ErrorNote>
        ) : null}

        <label className="description-field">
          <span>Description</span>
          {/* `readOnly`, as the summary above and for the same reasons. */}
          <textarea
            // As the summary's: held over an archive too (§5.7).
            data-unsaved-text={(canEdit || archivedAt !== null) && description !== issue.description ? "true" : undefined}
            onBlur={() => {
              if (!canEdit) return;
              if (description !== issue.description) editIssue({ description });
              else settleText("description");
            }}
            onChange={(event) => setDescription(event.target.value)}
            readOnly={!canEdit}
            rows={5}
            value={description}
          />
        </label>

        {/* Above the other three sections on purpose: it is the one whose
            state has to be legible without hunting, and that state — whether
            you are watching — is about the reader rather than the issue, so
            it matters to every reader. Not every reader can change it: since
            TAS-226 the toggle follows the server's `watch-issue-roles`, and a
            VIEWER sees their subscription without a way to change it. It
            also keeps the toggle above the fold at 1440×900 and one short
            scroll away at 390×844. */}
        <IssueWatchersSection
          projectId={projectId}
          issueId={issueId}
          currentUserId={currentUserId}
          members={members}
          membersAnswered={membersAnswered}
          membersUnknown={membersUnknown}
          userById={userById}
          isProjectAdmin={isProjectAdmin}
          canWatch={canWatch}
          isProjectViewer={isProjectViewer}
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

        <IssueWorklogSection
          projectId={projectId}
          issueId={issueId}
          canLog={canEdit}
          isProjectAdmin={isProjectAdmin}
          archived={archivedAt !== null}
          currentUserId={currentUserId}
          userById={userById}
          prefetched={worklogsPrefetched}
          writeScope={issueWriteScope(issueId)}
        />

        <CommentsSection
          projectId={projectId}
          issueId={issueId}
          canComment={canEdit}
          archived={archivedAt !== null}
          currentUserId={currentUserId}
          userById={userById}
          prefetched={commentsPrefetched}
        />

        <ActivitySection
          history={history}
          priorities={meta?.priorities}
          statuses={workflow?.statuses}
          userById={userById}
        />
      </div>
    </>
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
 * The five watcher routes (TAS-193): the list, the `…/watchers/me` pair a reader
 * uses on their own subscription — an ADMIN or a MEMBER only, by the server's
 * `watch-issue-roles` (TAS-226) — and the two project-`ADMIN` routes that
 * subscribe and unsubscribe somebody else.
 *
 * **Three things here are not obvious and each has cost somebody an hour.**
 *
 * *There is no count, and the array's length is not one.* Since TAS-246 the
 * section reads the issue's own read, whose DTO states no count, and a part
 * that failed arrives there as `[]` — so the heading draws no number at all,
 * not even one a write states, until the read carries one (backend ask A3,
 * docs/ai/BACKLOG.md's role-lists line). Only the *membership* question — am I
 * in this list — is answered from the array, because the contract offers no
 * `…/watchers/me` read to ask it with.
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
 * uploader — one mechanism, and it fails in one way: when
 * `GET /projects/{id}/members` fails, or names nobody for that id, the watcher
 * draws as "Unknown", exactly as the reporter line does. That symmetry
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
  canWatch,
  isProjectViewer,
}: {
  projectId: string;
  issueId: string;
  /** `undefined` until `GET /users/me` answers. Until then nothing may claim who is watching. */
  currentUserId?: string;
  members: ProjectMember[];
  /** The member read answered. Three states, not two — see the panel's own prop. */
  membersAnswered: boolean;
  membersUnknown: boolean;
  userById: Map<string, Pick<User, "id" | "displayName" | "color" | "avatarUrl">>;
  /**
   * The gate on `POST …/watchers` and `DELETE …/watchers/{userId}` as this
   * section uses them: to add or remove *somebody else*, which the server allows
   * an ADMIN only. For the reader's own `userId` both routes take
   * `watch-issue-roles` instead (the same rule as `canWatch` below; backend PR
   * #194, TAS-228, head `a33ed5d`, states it in the contract), but a MEMBER
   * manages their own subscription through the `me` toggle, so this section
   * renders both controls only for an ADMIN. Presentation only — the server
   * checks again (DESIGN.md §5.7).
   */
  isProjectAdmin: boolean;
  /**
   * The gate on the reader's own `…/watchers/me` pair: issue-service's
   * `watch-issue-roles`, ADMIN and MEMBER. False for a VIEWER, and false while
   * the role is unknown — not yet read, failed, or stated as nothing this build
   * knows — because a subscription change the server may refuse is not this
   * section's to offer. Presentation only, like the one above.
   */
  canWatch: boolean;
  /**
   * The server named this reader a VIEWER. Only then may the toggle's hint give
   * the role as its reason; an unknown role is explained by the board's banner,
   * and calling it VIEWER here would invent the answer that banner says is
   * missing.
   */
  isProjectViewer: boolean;
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

  // The panel's issue read carries the watchers since TAS-246.
  const watchersCache = issuePartCache(queryClient, projectId, issueId, "watchers");
  const watchersQuery = useIssuePart(projectId, issueId, "watchers");
  // The server's own answer to "am I watching", which comes from the issue's
  // core query rather than from the watcher list, and so survives the list
  // failing. Kept in step with the reader's own writes by `setIsWatching`.
  const isWatchingQuery = useQuery({
    ...issueDetailsOptions(projectId, issueId),
    select: (data) => data.issue.isWatching,
  });
  const { queryKey: issueKey } = issueDetailsOptions(projectId, issueId);
  const setIsWatching = (value: boolean | null) =>
    queryClient.setQueryData(issueKey, (data) => (data ? { ...data, issue: { ...data.issue, isWatching: value } } : data));

  // `null` is a part the server did not send — said below, never drawn as
  // "nobody is watching". So is a list that leaves out a reader the server
  // says is watching: on this gateway a part that failed arrives as `[]`
  // (`IssueDetails`), and that contradiction is the one way to tell. Offering
  // "Watch" over it would invite a subscription the reader already has.
  const listed = watchersQuery.data;
  const readerMissing =
    isWatchingQuery.data === true &&
    Boolean(currentUserId) &&
    !(listed?.watchers ?? []).some((watcher) => watcher.userId === currentUserId);
  const unavailable = listed === null || readerMissing;
  const answer = unavailable ? undefined : (listed ?? undefined);
  const watchers = useMemo(() => answer?.watchers ?? [], [answer]);
  const watching = Boolean(currentUserId) && watchers.some((watcher) => watcher.userId === currentUserId);
  /** `watcherSubject` for a person, with their row's own name when they have a row. */
  const subjectOf = (userId: string) =>
    watcherSubject(
      userById,
      userId,
      currentUserId,
      watchers.find((watcher) => watcher.userId === userId),
    );
  const subscribed = useMemo(() => new Set(watchers.map((watcher) => watcher.userId)), [watchers]);
  const addable = members.filter((member) => !subscribed.has(member.userId));

  /**
   * One write, and the issue read re-asked — which since TAS-246 is where the
   * watcher list lives. Still deliberately **not** `invalidateBoard`: no
   * watcher route changes the issue or the board's cards, and this build knows
   * of no history event or notification type for a subscription.
   */
  const settle = () => watchersCache.settle();

  /** The optimistic row for a subscription the server has not confirmed yet. */
  const optimisticRow = (userId: string): IssueWatcher => ({
    id: optimisticWatcherId,
    issueId,
    projectId,
    userId,
    createdAt: "",
    createdBy: currentUserId ?? "",
    // Not guessed from the member list: the row is named the way every
    // unnamed row is (`personFor`), and the server's name arrives with the
    // re-read that settles this write.
    displayName: null,
    avatarUrl: null,
  });

  /**
   * Clears the notice, cancels a re-read that would land on top of the write,
   * and snapshots what a rollback has to put back: the list, and the server's
   * `isWatching` beside it — which the reader's own writes move with the list,
   * so that an optimistic unwatch is not read as the contradiction above.
   */
  const beginWrite = async () => {
    setNotice(null);
    await watchersCache.cancel();
    return { watchers: watchersCache.get(), isWatching: queryClient.getQueryData(issueKey)?.issue.isWatching };
  };

  const addOptimistically = (userId: string) => {
    watchersCache.set((current) => {
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
        // First, where the server will put it: both watcher reads answer
        // newest first, so a row appended here would jump to the top when the
        // re-read lands.
        watchers: [optimisticRow(userId), ...current.watchers],
        // Left as it is (`null` off the issue read): no count is drawn here.
        totalCount: current.totalCount,
      };
    });
  };

  /**
   * Drop a person's row — optimistically for the reader's own unwatch, and only
   * on the server's word for the ADMIN removal below, which is why this is not
   * called `removeOptimistically` (its sibling above still is, because it has
   * one caller and one timing).
   */
  const removeRow = (userId: string) => {
    watchersCache.set((current) =>
      current ? { ...current, watchers: current.watchers.filter((watcher) => watcher.userId !== userId) } : current,
    );
  };

  const rollback = (previous: { watchers: IssueWatchers | null | undefined; isWatching: boolean | null | undefined } | undefined) => {
    if (!previous) return;
    watchersCache.restore(previous.watchers);
    if (previous.isWatching !== undefined) setIsWatching(previous.isWatching);
  };

  const watchIssue = useMutation({
    mutationFn: () => taskaApi.watchIssue(projectId, issueId),
    onMutate: async () => {
      const previous = await beginWrite();
      if (currentUserId) addOptimistically(currentUserId);
      setIsWatching(true);
      return { previous };
    },
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
      setIsWatching(false);
      return { previous };
    },
    onSuccess: (result) => {
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
      if (userId === currentUserId) setIsWatching(true);
      return { previous };
    },
    onError: (error, userId, context) => {
      rollback(context?.previous);
      // The same sentence in the person its subject requires, and the reader's
      // half is the toggle's own words rather than new prose: an ADMIN can add
      // *themselves* from this picker — `addable` is every member who is not
      // watching yet, which includes them — and the failure that follows is the
      // one `watchIssue` above already has a sentence for.
      const subject = subjectOf(userId);
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
    const list = watchersCache.get()?.watchers ?? [];
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
      if (userId === currentUserId) setIsWatching(false);
      if (!result.removed) {
        const subject = subjectOf(userId);
        setNotice({
          tone: "info",
          text: subject.reader
            ? "You were not watching this issue, so nothing was removed."
            : `${subject.name} was not watching this issue, so nothing was removed.`,
        });
      }
    },
    onError: (error, userId) => {
      const subject = subjectOf(userId);
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
  const toggleHintId = useId();
  // The line beside the toggle, and the only place a reader is told why it is
  // off. Whether they are on the list is true for every reader and always said.
  // The invitation is only for a role the server lets through, and the reason —
  // the role — only for a reader the server named a VIEWER. An unknown role gets
  // the state and nothing more: the board's banner says why, and "viewer" here
  // would be inventing the answer that banner reports missing.
  const toggleHint = watching
    ? canWatch || !isProjectViewer
      ? "You are on this issue's watcher list."
      : "You are on this issue's watcher list. As a viewer, you cannot remove yourself."
    : canWatch
      ? "Add yourself to this issue's watcher list."
      : isProjectViewer
        ? "As a viewer, you cannot add yourself to this issue's watcher list."
        : "You are not on this issue's watcher list.";

  return (
    <section className="issue-watchers">
      {/* `tabIndex={-1}` makes this reachable by script and by nothing else: it
          is where focus lands when the row that had it was the last one in the
          list. A heading rather than the toggle beside it, because the toggle
          answers Enter with a subscription and a reader who has just pressed ✕
          five times is exactly the reader who would press it again. */}
      <h3 ref={heading} tabIndex={-1}>
        {/* No count pill until the issue read states one: backend ask A3, the role-lists line in docs/ai/BACKLOG.md. */}
        Watchers
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
             * `aria-disabled`, never `disabled`, while a write is in flight,
             * and this is the one line in the section worth defending. A
             * `disabled` button loses focus in Chromium the moment the
             * attribute lands, so pressing Enter on this toggle dropped focus
             * to `<body>` for the length of the request and the *second* Enter
             * went nowhere — a keyboard user could watch an issue and then not
             * unwatch it without tabbing in from the top of the document again.
             * Caught by the keyboard case in `e2e/watchers.spec.ts`, which is
             * why that case exists.
             *
             * The guard moves into the handler with it. Leaving the press live
             * would be worse than a dead 200ms: a `PUT` and a `DELETE` in
             * flight together can be applied by the server in either order, and
             * the loser decides the subscription.
             */
            aria-describedby={toggleHintId}
            aria-disabled={toggling || undefined}
            aria-pressed={watching}
            className={`secondary-button compact-button watch-toggle${watching ? " is-watching" : ""}`}
            // The other kind of off, and a real `disabled` with §4.1's fade:
            // §4.21's exception for a control that is not coming back. Until
            // TAS-226 this toggle was live for every reader, on the belief that
            // the contract's silence about `…/watchers/me` meant no role — and
            // issue-service refuses a VIEWER both halves (`watch-issue-roles`).
            // The in-flight rule above is about focus taken from a control the
            // reader has just pressed, and this one could not have been. While
            // the role is still being read it is off the same way, like every
            // write control on the board; nothing can be focused on a button
            // that was never enabled, so lifting it takes nothing away.
            disabled={!canWatch}
            onClick={() => {
              if (!canWatch || toggling) return;
              if (watching) unwatchIssue.mutate();
              else watchIssue.mutate();
            }}
            type="button"
          >
            {watching ? <Eye size={13} /> : <EyeOff size={13} />}
            {watching ? "Watching" : "Watch"}
          </button>
          <span className="watcher-toggle-hint" id={toggleHintId}>{toggleHint}</span>
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
                  {subjectOf(member.userId).name}
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
          What it may then say is narrower than it looks. It was narrowed in
          TAS-193, while `hybrid` answered the member read itself with a list of
          one — the reader — that nothing in the UI could tell from a real
          answer. Since TAS-224 the list is the gateway's own, and the sentence
          stays about the list that came back rather than about the project: that
          claim is true of any answer, and widening it is a decision about copy,
          not a consequence of the read. §5.6's boundary above still keeps a
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

      {/* A part that did not load says so where "nobody is watching" would
          sit, in the one recipe all four sections share (art-director,
          TAS-246): a state of the section rather than a refusal of something
          the reader did, so no error box and no live region. */}
      {unavailable ? <p className="issue-links-empty is-unavailable">{partUnavailableText("watchers")}</p> : null}

      {/* Only a part the server sent may say nobody is watching. */}
      {answer && watchers.length === 0 ? <p className="issue-links-empty">No one is watching this issue yet</p> : null}

      {watchers.length ? (
        <ul className="watcher-list">
          {watchers.map((watcher) => {
            const person = personFor(watcher.userId, watcher, userById);
            const mine = Boolean(currentUserId) && watcher.userId === currentUserId;
            // The member map is the only source of names in this section, and
            // there is exactly one person it may fail on whom the UI can name
            // anyway: the reader. It misses them when the member read fails —
            // one unreadable avatar object fails it on the stand — or when
            // their own row names nobody, and that row used to read "Unknown
            // (you)" — a screen saying it does not know who you are, beside a
            // mark saying it does. `GET /users/me` answered that question
            // before this section drew anything. The rule lives in
            // `watcherSubject` rather than here now, because the sentences
            // below needed the same one and had been given a different one.
            //
            // "You" also makes the "(you)" beside it a tautology, so the mark
            // goes: it exists to pick the reader out of a list of names, and
            // there is no name here to pick out of.
            const { name, named, reader } = watcherSubject(userById, watcher.userId, currentUserId, watcher);
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
                    name.

                    What moves is the circle's word, and not only for the reader
                    who hears it: `Avatar` sets `title` from the same expression
                    as `aria-label`, so the hover tooltip on an unnamed row now
                    reads "You" or "Unknown" where it read "Unassigned". That is
                    the same improvement rather than a second one — the circle
                    stops contradicting the text beside it — and it asks for no
                    screenshot either, because a tooltip needs a pointer held on
                    the circle to exist at all, so a static capture of this row
                    is unchanged. */}
                <Avatar user={person} label={name} size="sm" />
                <span className="watcher-name">
                  {name}
                  {mine && person ? <span className="watcher-you"> (you)</span> : null}
                </span>
                {isProjectAdmin ? (
                  <button
                    // Three arms for `watcherSubject`'s three states, in its
                    // order and on its own flags. This was the last of the
                    // section's four wordings — row, picker option, notice,
                    // this label — still deciding for itself which state it is
                    // in, by re-reading the member map; the four agreed today
                    // and it is the precedence, not the wording, that a second
                    // copy gets wrong first. `person` above stays because
                    // `Avatar` needs the *object* for its fill, not a name.
                    //
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
                    // Where it *can* run: whenever the member read
                    // (`GET /projects/{id}/members`) fails while the project
                    // read succeeds with ADMIN — two separate gateway reads in
                    // every mode but `mock` since TAS-224, which took out the
                    // synthesis that used to tie the first to the second. On
                    // the stand one way that happens is a single unreadable
                    // avatar object, which fails the whole member read with a
                    // 404, 403 or 503 (see `TaskaApi.listMembers`). A ruling
                    // about that case, then, not a screenshot of it; the unit
                    // suite is where it is held.
                    aria-label={
                      named
                        ? `Remove ${name} from watchers`
                        : reader
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
 * Precedence: the name the watcher row itself carries (backend TAS-214), then
 * the member map — a reader either *can* name sees their own name, exactly as
 * the assignee row and the reporter line show it — then the reader, then
 * §4.21's word for a person nobody here can name.
 *
 * `reader` travels with the name because English will not let a caller recover
 * it: "You" takes a plural verb, so a sentence built by interpolation reads
 * "You was not subscribed to this issue." The three ADMIN notices ask for it
 * and then say what the `…/watchers/me` pair already says about that same
 * state, rather than inflecting a template.
 *
 * `named` travels for the ✕'s label, the one surface that cannot use `name` at
 * all — it says "Remove watcher {shortKey}" for a person nobody here can name,
 * so it needs the *state* and not the word. It is asked for rather than
 * re-derived from `userById` because that re-derivation was the last copy of
 * this precedence living outside this function, and precedence is what a second
 * copy gets wrong first: the two agree today, and would not have agreed through
 * the change that taught the rows to name a reader the map cannot.
 *
 * `named`, not "has a name" — an empty `displayName` from the server is
 * `named: true`, for the reason the lookup below gives.
 */
function watcherSubject(
  userById: Map<string, Pick<User, "id" | "displayName" | "color" | "avatarUrl">>,
  userId: string,
  currentUserId?: string,
  row?: NamedBy,
): { name: string; named: boolean; reader: boolean } {
  // The row's own name first, since TAS-246 — the server's answer about the
  // person, carried with the read being drawn — then the member map, through
  // the one function every person on the panel is resolved by. For the map,
  // whether it *has* them, never whether the name it holds is non-empty: an
  // empty `displayName` on a member row is the server's answer about that
  // person, and this section is not the place that overrides it.
  const person = personFor(userId, row, userById);
  if (person) return { name: person.displayName, named: true, reader: false };
  if (currentUserId && userId === currentUserId) return { name: "You", named: false, reader: true };
  return { name: "Unknown", named: false, reader: false };
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
  const { requestId } = apiErrorFacts(error);
  // The same words `watcherFailureText` prefers, so the two compare equal.
  const message = refusalWords(error);
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
  const { status, code } = apiErrorFacts(error);
  // The server's words, or ours for an archived project's refusal (§5.7).
  const message = refusalWords(error);
  if (message) return message;
  if (status === 403 || code === "PERMISSION_DENIED") {
    return "The server refused: only a project admin may change who else watches this issue.";
  }
  return fallback;
}

/**
 * The issue's labels — read off the panel's issue read since TAS-246, written
 * through `POST/DELETE /projects/{projectId}/issues/{issueId}/labels` — beside
 * the project's own list, so the picker only offers labels this issue does not
 * already carry. The optimistic chip is written into the issue read's own
 * entry (`issuePartCache`), so the panel never holds two copies of one list.
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

  const labelsCache = issuePartCache(queryClient, projectId, issueId, "labels");
  const labelsQuery = useIssuePart(projectId, issueId, "labels");
  const unavailable = labelsQuery.data === null;
  // The board's own context read, so the board, this picker and the manage
  // modal draw one list from one request (TAS-251) — the board behind the
  // panel has already asked, and this observer only reads its answer — which
  // `refetchOnMount: false` makes true past `staleTime` as well, so opening a
  // panel does not read the context again (release-reviewer, TAS-202).
  const projectLabelsQuery = useQuery({
    queryKey: projectContextKey(projectId),
    queryFn: () => taskaApi.getProjectContext(projectId),
    retry: retryUnlessMissing,
    select: (context: ProjectContext) => context.labels,
    refetchOnMount: false,
  });

  const labels = useMemo(() => labelsQuery.data ?? [], [labelsQuery.data]);
  const projectLabels = useMemo(() => projectLabelsQuery.data ?? [], [projectLabelsQuery.data]);
  const attached = useMemo(() => new Set(labels.map((label) => label.id)), [labels]);
  const attachable = projectLabels.filter(
    (label) => !attached.has(label.id) && !isPendingLabel(label),
  );

  // One write, two stale caches: the panel's issue, which carries this list,
  // and the board cards that draw their labels from the board read behind them.
  const settle = () =>
    Promise.all([labelsCache.settle(), queryClient.invalidateQueries({ queryKey: boardKey(projectId) })]);

  const addLabel = useMutation({
    mutationFn: (labelId: string) => taskaApi.addIssueLabel(projectId, issueId, labelId),
    onMutate: async (labelId) => {
      await labelsCache.cancel();
      const previous = labelsCache.get();
      // No placeholder id, unlike the links section: the label came out of a
      // list this component is holding, so the optimistic chip *is* the label
      // and there is nothing for the server's answer to reconcile.
      const chosen = projectLabels.find((label) => label.id === labelId);
      if (chosen) {
        labelsCache.set((current) => [...(current ?? []), { id: chosen.id, name: chosen.name, color: chosen.color }]);
      }
      return { previous };
    },
    onError: (_error, labelId, context) => {
      labelsCache.restore(context?.previous);
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
      await labelsCache.cancel();
      const previous = labelsCache.get();
      labelsCache.set((current) => (current ?? []).filter((label) => label.id !== labelId));
      return { previous };
    },
    onError: (_error, _labelId, context) => {
      labelsCache.restore(context?.previous);
    },
    onSettled: settle,
  });

  // Mutations first, reads second. A react-query observer can hold data *and*
  // an error at once — a cached list plus a failed background refetch — and in
  // that state the picker is still populated, so an add that the server refused
  // would otherwise be explained by whatever the refetch said instead. A
  // mutation error is always about the action just taken; a query error is
  // about the background.
  const failure = addLabel.error ?? removeLabel.error ?? projectLabelsQuery.error;
  const error = failure ? (refusalWords(failure) ?? failure.message) : undefined;

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

      {/* The request id on its own line under the sentence, inside the box
          (§5.6, «Request id отказа — один рецепт», TAS-397). */}
      {error ? <ErrorNote requestId={failure ? apiErrorFacts(failure).requestId : null}>{error}</ErrorNote> : null}

      {unavailable ? <p className="issue-links-empty is-unavailable">{partUnavailableText("labels")}</p> : null}
      {labelsQuery.data && labels.length === 0 ? <p className="issue-links-empty">No labels yet</p> : null}

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
 * The issue's links — read off the panel's issue read since TAS-246, written
 * through `POST/DELETE /issues/{issueId}/links`. Three things are worth knowing
 * here:
 *
 * 1. Which issue a row points at is decided by comparing both ends against the
 *    issue on screen, never by trusting `targetIssueId` — the response is the
 *    link as *this* issue sees it, and the issue on the receiving side of a
 *    `BLOCKS` is the link's `targetIssueId`, not its own.
 * 2. The other end is named by the server (`IssueLink.target`, backend
 *    TAS-214): its key, its summary and its project. A row the server did not
 *    resolve — an optimistic row, an older gateway — falls back to the project
 *    page the picker holds, and then to the bare id.
 * 3. `viewLinkType` is an open string (see `IssueLink`), so it is only ever
 *    passed to `issueLinkTypeLabel`, which prints an unknown relation instead
 *    of dropping the row — named from `/meta`'s `linkViewTypes` (backend
 *    #201), and never from `linkTypes`, which the picker reads: an inverse
 *    must not borrow its outward relation's name.
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
  const meta = useMeta();
  // The relations `GET /meta` lists, or the contract's three until it answers
  // (TAS-173): a relation the backend adds is offered the day it is served.
  // The choice is derived rather than stored as the first value, so a list
  // that arrives after the panel opened still settles on a relation it offers.
  const offeredLinkTypes = selectableCodes(meta?.linkTypes, issueLinkTypes);
  const [pickedLinkType, setLinkType] = useState<IssueLinkTypeCode | null>(null);
  const linkType =
    pickedLinkType !== null && offeredLinkTypes.includes(pickedLinkType) ? pickedLinkType : offeredLinkTypes[0];
  const [targetIssueId, setTargetIssueId] = useState("");
  // Refused before the request goes out; the server stays the authority.
  const [localError, setLocalError] = useState<string | null>(null);

  // The board's own read behind the panel (TAS-202): the entry with no filter
  // in it (TAS-392), so the bar's filter does not narrow what an issue may be
  // linked to. It costs nothing: the board keeps that entry read. It is cut at
  // 200 a status, so an issue missing from it may be past a cut — the picker
  // says so — or of a type the registry no longer holds, or of another
  // project; a link row resolves to the server's own `target` or to its id.
  //
  // `refetchOnMount: false`: opening a panel past `staleTime` must not read the
  // whole board again for a picker (release-reviewer, TAS-202). This observer
  // takes whatever board the screen holds; the screen's own read, the reader's
  // writes and the focus policy are what keep it current.
  // The board without filters (§5.4): the board's filter does not narrow what
  // an issue may be linked to. Its columns are cut at 200 (TAS-392), so an
  // issue past one is not offered, and the line under the picker says so.
  const projectIssuesQuery = useQuery({ ...boardQueryOptions(projectId, NO_BOARD_FILTERS), refetchOnMount: false });
  const issues = useMemo(() => (projectIssuesQuery.data ? boardCards(projectIssuesQuery.data) : []), [projectIssuesQuery.data]);
  const pickerCut = projectIssuesQuery.data ? boardHasMore(projectIssuesQuery.data) : false;

  const linksCache = issuePartCache(queryClient, projectId, issueId, "links");
  const linksQuery = useIssuePart(projectId, issueId, "links");
  const unavailable = linksQuery.data === null;
  const links = useMemo(() => linksQuery.data ?? [], [linksQuery.data]);

  // Both ends of a link change when one is written, and the user can walk
  // straight to the other end — so every issue read of the project is marked
  // stale, not just this one, and the open one is re-read.
  const invalidateLinks = () => queryClient.invalidateQueries({ queryKey: ["issue", projectId] });

  const createLink = useMutation({
    mutationFn: (input: CreateIssueLinkInput) => taskaApi.createIssueLink(projectId, issueId, input),
    onMutate: async (input) => {
      await linksCache.cancel();
      const previousLinks = linksCache.get();
      linksCache.set((current) => [
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
          // Resolved by the re-read that settles this write; until then the
          // row names its target from the picker's page, as it always did.
          target: null,
        },
      ]);
      return { previousLinks };
    },
    onError: (_error, input, context) => {
      linksCache.restore(context?.previousLinks);
      setTargetIssueId((current) => (current === "" ? input.targetIssueId : current));
    },
    onSettled: invalidateLinks,
  });

  const deleteLink = useMutation({
    mutationFn: (linkId: string) => taskaApi.deleteIssueLink(projectId, issueId, linkId),
    onMutate: async (linkId) => {
      await linksCache.cancel();
      const previousLinks = linksCache.get();
      linksCache.set((current) => (current ?? []).filter((link) => link.id !== linkId));
      return { previousLinks };
    },
    onError: (_error, _linkId, context) => {
      linksCache.restore(context?.previousLinks);
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
  const failure = createLink.error ?? deleteLink.error ?? projectIssuesQuery.error;
  const error = localError ?? (failure ? (refusalWords(failure) ?? failure.message) : undefined);

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
              {offeredLinkTypes.map((type) => (
                <button
                  aria-pressed={linkType === type}
                  className={linkType === type ? "is-active" : ""}
                  key={type}
                  onClick={() => setLinkType(type)}
                  type="button"
                >
                  {issueLinkTypeLabel(type, meta?.linkTypes)}
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
          {/* A state, not a live region (§5.4). */}
          {pickerCut ? (
            <p className="issue-link-cut">
              Only the first {BOARD_PAGE_SIZE_PER_COLUMN} issues of each status are listed here.
            </p>
          ) : null}
        </form>
      ) : null}

      {/* The request id under the sentence (§5.6, TAS-397) — only for the
          server's refusal: a check made here before sending has no id. */}
      {error ? (
        <ErrorNote requestId={localError === null && failure ? apiErrorFacts(failure).requestId : null}>{error}</ErrorNote>
      ) : null}

      {unavailable ? <p className="issue-links-empty is-unavailable">{partUnavailableText("links")}</p> : null}
      {/* Only a part the server sent may say this. A part it did not send has
          no rows either, and "nothing is linked here" is a claim that answer
          never made — one a reader would act on. */}
      {linksQuery.data && links.length === 0 ? <p className="issue-links-empty">No links yet</p> : null}

      <ul className="issue-link-list">
        {links.map((link) => {
          const otherId = otherEndOf(link, issueId);
          // The server's own resolution first; the project page only for a row
          // it did not resolve.
          const other = link.target ?? issueById.get(otherId);
          const otherProjectId = link.target?.projectId || link.projectId || projectId;
          const pending = link.id === optimisticLinkId;
          return (
            <li className="issue-link-row" key={link.id || `${link.sourceIssueId}:${link.targetIssueId}`}>
              {otherId ? (
                <button
                  className="issue-link-open"
                  // The other end states its own project (`target.projectId`),
                  // and these routes are issue-scoped on the wire, so a link
                  // may point outside the board being viewed. The mock cannot
                  // produce one, which is exactly why this must not be assumed
                  // away. Before TAS-214 the row had only the link's own
                  // `projectId`, which names the project of the issue it was
                  // created from, not necessarily of the other end.
                  onClick={() => navigate(`/projects/${otherProjectId}/issues/${otherId}`)}
                  type="button"
                >
                  <span className="issue-link-relation">{issueLinkTypeLabel(link.viewLinkType, meta?.linkViewTypes)}</span>
                  {/* The key is what a person recognises; an issue outside the
                      board's read has none, and its raw id is still truer than a
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
                  <span className="issue-link-relation">{issueLinkTypeLabel(link.viewLinkType, meta?.linkViewTypes)}</span>
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
 * `info` is for the outcomes that are not failures: the confirm that failed in
 * transit while succeeding on the server, the tab the browser refused to open
 * when the link itself is fine, and a download that could not be saved
 * directly and was opened instead. Calling any of them an error would tell the
 * reader the opposite of what happened.
 */
interface AttachmentNotice {
  tone: "error" | "info";
  text: string;
  /**
   * The gateway's `X-Request-Id` of the refusal, printed under the sentence in
   * its box (§5.6, «Request id отказа — один рецепт», TAS-397). Never for the
   * object store's own leg, which no gateway answered, and never in mock mode.
   */
  requestId?: string | null;
}

/** A file waiting its turn behind the upload in flight (TAS-253). */
interface WaitingUpload {
  key: number;
  fileName: string;
  sizeBytes: number;
}

/**
 * `GET/POST/DELETE /projects/{projectId}/issues/{issueId}/attachments` and the
 * two extra routes the upload needs — plus two legs that are not routes at all.
 *
 * Four things make this section different from the links and labels sections
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
 *    call is wrapped in no retry — and after *any* confirm failure the list is
 *    re-read before anybody is told the file was not attached, because a
 *    confirm can succeed on the server and fail on the way back. Several files
 *    (a multi-select, or a drop) go one after another, never side by side.
 * 3. **Delete is gated per row, not per section.** Your own attachment needs
 *    `ADMIN` or `MEMBER`; somebody else's needs `ADMIN`.
 * 4. **A row has two actions, and they are different on purpose** (TAS-253).
 *    *Open* shows the file in a new tab from the store's own link — the object
 *    carries no `Content-Disposition`, so images, PDFs and text display there.
 *    *Download* saves it under its own name: the bytes are fetched and handed
 *    to an `<a download>`. Neither ever puts the file on a `blob:` URL that is
 *    *opened* on this origin, where an HTML attachment would run as Taska.
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
  userById: Map<string, Pick<User, "id" | "displayName" | "color" | "avatarUrl">>;
}) {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ fileName: string; sizeBytes: number; step: AttachmentUploadStep } | null>(null);
  /**
   * The files behind the one in flight, shown as rows of their own so a drop
   * of five is visibly five. The `File`s themselves live in `queue`; this is
   * only what the rows draw.
   */
  const [waiting, setWaiting] = useState<WaitingUpload[]>([]);
  const queue = useRef<{ key: number; file: File }[]>([]);
  const draining = useRef(false);
  const nextQueueKey = useRef(0);
  /**
   * Every sentence the last action produced. Usually one; a drop of several
   * files says one per file that did not go cleanly, and they stay together
   * until the reader does something new.
   */
  const [notices, setNotices] = useState<(AttachmentNotice & { seq: number })[]>([]);
  /**
   * A sequence number of the notice's own, which keys it in the hidden status
   * below: errors are listed ahead of information, so an index would shift
   * under a notice that is already there, React would rewrite its node, and a
   * sentence already announced would be announced again.
   */
  const nextNoticeSeq = useRef(0);
  const say = (notice: AttachmentNotice) => setNotices([{ ...notice, seq: nextNoticeSeq.current++ }]);
  const addNotice = (notice: AttachmentNotice) => {
    const numbered = { ...notice, seq: nextNoticeSeq.current++ };
    setNotices((current) => [...current, numbered]);
  };
  /**
   * A resolved link the browser would not open a tab for. Only ever set when
   * `window.open` genuinely came back `null` (see `openBlankTab`), so the
   * fallback anchor appears exactly when it is needed and never clutters a row
   * that worked.
   */
  const [fallbackLink, setFallbackLink] = useState<{ id: string; url: string } | null>(null);
  /** Whether files are being dragged over the section right now. */
  const [dropActive, setDropActive] = useState(false);
  /**
   * `dragenter` and `dragleave` fire for every child the pointer crosses, so a
   * boolean flips off and on as the pointer moves over a row. Counting the
   * enters against the leaves is what keeps the drop state steady.
   */
  const dragDepth = useRef(0);

  // The panel's issue read carries the attachments since TAS-246.
  const attachmentsCache = issuePartCache(queryClient, projectId, issueId, "attachments");
  const attachmentsQuery = useIssuePart(projectId, issueId, "attachments");
  const unavailable = attachmentsQuery.data === null;
  const attachments = useMemo(() => attachmentsQuery.data ?? [], [attachmentsQuery.data]);

  /**
   * The issue read, which is both the list and — for the activity feed — the
   * history an upload and a delete each append an `ATTACHMENT_UPLOADED` /
   * `ATTACHMENT_DELETED` row to. One re-read keeps the two in step.
   */
  const settle = () => attachmentsCache.settle();

  const deleteAttachment = useMutation({
    mutationFn: (attachmentId: string) => taskaApi.deleteAttachment(projectId, issueId, attachmentId),
    onMutate: async (attachmentId) => {
      setNotices([]);
      await attachmentsCache.cancel();
      const previous = attachmentsCache.get();
      attachmentsCache.set((current) => (current ?? []).filter((item) => item.id !== attachmentId));
      return { previous };
    },
    onError: (error, _attachmentId, context) => {
      attachmentsCache.restore(context?.previous);
      say({
        tone: "error",
        text: refusalWords(error) ?? "The attachment could not be removed.",
        requestId: apiErrorFacts(error).requestId,
      });
    },
    onSettled: settle,
  });

  /**
   * **Open**: a fresh presigned link, shown in a new tab.
   *
   * The tab is opened by the click handler *before* this runs (`openBlankTab`),
   * because the link is only known after a request, and Safari no longer counts
   * the click as the reader's once an `await` has passed. So `tab` is either a
   * blank tab waiting for its link, or `null` — and `null` now means one thing
   * only: the browser refused to open it.
   */
  const open = useMutation({
    mutationFn: ({ attachment }: { attachment: IssueAttachment; tab: Window | null }) =>
      taskaApi.getAttachmentDownloadUrl(projectId, issueId, attachment.id),
    onMutate: () => {
      setNotices([]);
      setFallbackLink(null);
    },
    onSuccess: (link, { attachment, tab }) => {
      if (!isUsableDownloadUrl(link.downloadUrl)) {
        closeTab(tab);
        say({ tone: "error", text: `No link came back for ${attachment.fileName}.` });
        return;
      }
      if (tab && sendTabTo(tab, link.downloadUrl)) return;
      // Either the blocker said no, or the reader closed the waiting tab. The
      // link is real and good for fifteen minutes, so it is offered rather
      // than swallowed — and said out loud, because otherwise a keyboard reader
      // presses Enter, nothing opens, and a new tab stop appears without a word.
      setFallbackLink({ id: attachment.id, url: link.downloadUrl });
      say({
        tone: "info",
        text: `Your browser did not open a tab for ${attachment.fileName}. Use the Open link beside it.`,
      });
    },
    onError: (error, { tab }) => {
      closeTab(tab);
      const { message, requestId } = apiErrorFacts(error);
      say({ tone: "error", text: message ?? "The link to this file could not be created.", requestId });
    },
  });

  const openAttachment = (attachment: IssueAttachment) => {
    if (open.isPending && open.variables?.attachment.id === attachment.id) return;
    // Synchronously, inside the click — see `open` above.
    const tab = openBlankTab();
    open.mutate({ attachment, tab });
  };

  /**
   * **Download**: the bytes behind a fresh link, saved under the file's own
   * name. If the store will not hand the bytes to script — a network failure,
   * or a store whose CORS stops allowing the GET — the link is opened in a tab
   * instead, where the reader can save it, and that is said as information
   * rather than as an error: they still get the file.
   */
  const download = useMutation({
    mutationFn: async (attachment: IssueAttachment) => {
      const link = await taskaApi.getAttachmentDownloadUrl(projectId, issueId, attachment.id);
      // The same rule the byte GET applies, here because the fallback below
      // hands the link to a tab and an anchor, not to a fetch.
      if (!isUsableDownloadUrl(link.downloadUrl)) return { kind: "no-link" as const };
      try {
        const blob = await taskaApi.getAttachmentBytes(link.downloadUrl);
        return { kind: "saved" as const, blob };
      } catch (error) {
        if (!(error instanceof ObjectStoreError)) throw error;
        return { kind: "fallback" as const, url: link.downloadUrl };
      }
    },
    onMutate: () => {
      setNotices([]);
      setFallbackLink(null);
    },
    onSuccess: (outcome, attachment) => {
      if (outcome.kind === "no-link") {
        say({ tone: "error", text: `No link came back for ${attachment.fileName}.` });
        return;
      }
      if (outcome.kind === "saved") {
        saveBlob(outcome.blob, attachment.fileName);
        return;
      }
      // Two requests have passed since the click, so the browser may well
      // refuse a tab now; a refusal is the genuine `null` and gets the link.
      const tab = openBlankTab();
      if (tab && sendTabTo(tab, outcome.url)) {
        say({
          tone: "info",
          text: `${attachment.fileName} could not be saved directly, so it opened in a new tab instead. Save it from there.`,
        });
        return;
      }
      setFallbackLink({ id: attachment.id, url: outcome.url });
      say({
        tone: "info",
        text: `${attachment.fileName} could not be saved directly, and your browser did not open a tab for it. Use the Open link beside it.`,
      });
    },
    onError: (error) => {
      const { message, requestId } = apiErrorFacts(error);
      say({ tone: "error", text: message ?? "The link to this file could not be created.", requestId });
    },
  });

  /**
   * The whole upload of one file, written out rather than wrapped in a
   * mutation, because its outcomes do not fit "resolved or rejected": one of
   * them is *"the file was attached even though this failed"*, and another is
   * *"nobody can say either way"*. Each leg is awaited on its own so the
   * sentence names the leg that failed. Sentences are *added*, so a queue of
   * files reports each one rather than the last.
   */
  const runUpload = async (file: File) => {
    const candidate = { fileName: file.name, contentType: file.type, sizeBytes: file.size };

    // The picker's `accept` filters by the operating system's idea of a type
    // and `File.type` is the browser's, so this is not a duplicate of it: a
    // `.zip` reported as `application/x-zip-compressed`, or an extensionless
    // file reported as `application/octet-stream`, gets past `accept` and is
    // stopped here, before a request. A dropped file has no `accept` at all.
    const refusal = attachmentRefusalKind(candidate);
    if (refusal) {
      addNotice({ tone: "error", text: refusalText(refusal, file) });
      return;
    }

    setPending({ fileName: file.name, sizeBytes: file.size, step: "signing" });

    let ticket;
    try {
      // Leg 1, and the moment the fifteen-minute clock starts. Asked for now
      // rather than when the panel opened — or when a queue of files was
      // dropped — precisely so that clock is short.
      ticket = await taskaApi.createAttachmentUploadUrl(projectId, issueId, candidate);
    } catch (error) {
      setPending(null);
      // Not a mutation, so the board's listener does not hear it (§5.7).
      rereadContextAfterRefusal(queryClient, projectId, error);
      addNotice({
        tone: "error",
        text: `${file.name} was not attached. ${refusalWords(error) ?? "The upload could not be prepared."}`,
        requestId: apiErrorFacts(error).requestId,
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
      // The object store's refusal has no gateway behind it, so no request id;
      // anything else that failed here is said with the id it carries.
      addNotice({
        tone: "error",
        text: uploadFailureText(error, file.name),
        requestId: error instanceof ObjectStoreError ? null : apiErrorFacts(error).requestId,
      });
      return;
    }

    setPending((current) => (current ? { ...current, step: "confirming" } : current));
    // Counted before the confirm, so the check afterwards asks "is there one
    // *more* of these" rather than "is there one at all" — attachments with the
    // same name are allowed, and the server itself creates duplicates.
    const before = countByName(attachmentsCache.get() ?? undefined, file.name);
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
      //
      // Re-read with the attachments' own route, not the issue read, and only
      // here. On this gateway the issue read sends a part that failed as `[]`
      // (`IssueDetails`) — one missing object in storage is enough to fail it —
      // so it could turn "may or may not have been attached" into "was not
      // attached", and the reader would upload the file a second time. The
      // list route fails as a request when it fails, which is the answer this
      // decision needs. What it finds is put on screen, since it is the newest
      // word on the list.
      let landed: IssueAttachment[] | null;
      try {
        landed = await taskaApi.listAttachments(projectId, issueId);
      } catch {
        landed = null;
      }
      if (landed !== null) {
        const verified = landed;
        attachmentsCache.set(() => verified);
      }

      if (landed === null) {
        // Two unknowns and no way to resolve either. Claiming failure here
        // would be a guess with a one-in-two chance of being a lie.
        addNotice({
          tone: "error",
          text: `${file.name} may or may not have been attached: the confirmation failed and the list could not be re-read. Reopen this issue to check.`,
          requestId: apiErrorFacts(error).requestId,
        });
        return;
      }
      if (countByName(landed, file.name) > before) {
        addNotice({
          tone: "info",
          text: `${file.name} was attached after all — the confirmation did not reach us, but the server recorded it.`,
        });
        return;
      }
      rereadContextAfterRefusal(queryClient, projectId, error);
      addNotice({
        tone: "error",
        text: `${file.name} was not attached. ${refusalWords(error) ?? "The upload could not be confirmed."}`,
        requestId: apiErrorFacts(error).requestId,
      });
    }
  };

  /** Uploads whatever is queued, one file at a time, until the queue is empty. */
  const drain = async () => {
    draining.current = true;
    try {
      let next = queue.current.shift();
      while (next) {
        const { key, file } = next;
        setWaiting((current) => current.filter((item) => item.key !== key));
        await runUpload(file);
        next = queue.current.shift();
      }
    } finally {
      draining.current = false;
    }
  };

  /**
   * The one way files get into this section — chosen with the button or
   * dropped — and the queue behind it (TAS-253). A file the server would
   * refuse is refused here, by name, before it ever takes a place in the
   * queue; the rest go one after another, because each confirm must be
   * answered before the next is sent (see the section's own comment). Files
   * added while a queue is running join the end of it, and the sentences from
   * the files already done stay on screen.
   */
  const enqueue = (files: File[]) => {
    if (!files.length) return;
    if (!draining.current) {
      setNotices([]);
      setFallbackLink(null);
    }
    const accepted: { key: number; file: File }[] = [];
    for (const file of files) {
      const refusal = attachmentRefusalKind({ fileName: file.name, contentType: file.type, sizeBytes: file.size });
      if (refusal) {
        addNotice({ tone: "error", text: refusalText(refusal, file) });
        continue;
      }
      nextQueueKey.current += 1;
      accepted.push({ key: nextQueueKey.current, file });
    }
    if (!accepted.length) return;
    queue.current.push(...accepted);
    setWaiting((current) => [
      ...current,
      ...accepted.map(({ key, file }) => ({ key, fileName: file.name, sizeBytes: file.size })),
    ]);
    if (!draining.current) void drain();
  };

  /**
   * The drop target (TAS-253). Only a drag that carries files is taken, and
   * every such drag has its default prevented — over a section that can take
   * the file, so the drop lands here; over one that cannot (a VIEWER, or a role
   * nobody stated), so the browser does not navigate away to the file. The
   * "Attach a file" button stays the keyboard and button equivalent.
   */
  const onDragEnter = (event: ReactDragEvent<HTMLElement>) => {
    if (!carriesFiles(event.dataTransfer)) return;
    event.preventDefault();
    if (!canEdit) return;
    dragDepth.current += 1;
    setDropActive(true);
  };
  const onDragOver = (event: ReactDragEvent<HTMLElement>) => {
    if (!carriesFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = canEdit ? "copy" : "none";
  };
  const onDragLeave = (event: ReactDragEvent<HTMLElement>) => {
    if (!carriesFiles(event.dataTransfer) || !canEdit) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDropActive(false);
  };
  const onDrop = (event: ReactDragEvent<HTMLElement>) => {
    if (!carriesFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragDepth.current = 0;
    setDropActive(false);
    if (!canEdit) return;
    enqueue(Array.from(event.dataTransfer.files));
  };

  const errorNotices = notices.filter((notice) => notice.tone === "error");
  const infoNotices = notices.filter((notice) => notice.tone === "info");

  return (
    <section
      className={`issue-attachments${dropActive ? " is-drop-target" : ""}`}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <h3>
        Attachments
        {attachments.length ? <span className="count-pill">{attachments.length}</span> : null}
      </h3>

      {/* The drop state: the section's own outline in the accent, and one line
          saying what letting go does. `aria-hidden` because it only exists
          while a pointer drags files — nobody reaches it any other way, and
          the button below is the path everyone else takes. Drawn over the
          section rather than in place of it, so nothing under the pointer
          moves while the files are held over it. */}
      {dropActive ? (
        <div aria-hidden="true" className="attachment-drop-overlay">
          <Upload size={16} />
          Drop to attach
        </div>
      ) : null}

      {canEdit ? (
        <div className="attachment-picker">
          {/* Driven by the button beside it rather than styled directly: a
              `::file-selector-button` keeps the browser's own "No file chosen"
              text, and a visually-hidden but focusable input puts a tab stop
              where nothing is visible. `hidden` takes it out of the tab order
              entirely, and the button is a real button with §4.1's focus ring.
              `multiple`, so the button can do everything a drop can. */}
          <input
            accept={ATTACHMENT_ACCEPT_ATTRIBUTE}
            className="attachment-input"
            hidden
            multiple
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              // Cleared straight away so choosing the same file twice — after a
              // failure, which is exactly when someone would — still fires a
              // change event.
              event.target.value = "";
              enqueue(files);
            }}
            ref={fileInput}
            type="file"
          />
          <button className="secondary-button compact-button" onClick={() => fileInput.current?.click()} type="button">
            <Paperclip size={13} />
            Attach a file
          </button>
          {/* Said before a file is chosen, not after it is refused. The list is
              stricter than people expect — no .docx, no GIF, no SVG, nothing
              without an extension — and the picker's own filter cannot be
              trusted to enforce it. The drop is mentioned here, once, because
              nothing else on screen says the section takes one. */}
          <p className="attachment-hint">
            Up to {formatFileSize(ATTACHMENT_MAX_SIZE_BYTES)}. {ATTACHMENT_ACCEPTED_SUMMARY}.<span className="attachment-drop-hint"> You can also drop files here.</span>
          </p>
        </div>
      ) : null}

      {/* What the last action said, for a screen reader: one visually hidden
          `role="status"` that stays mounted and changes its words, rather than
          a region that appears together with them — §7 records that shape as
          depending on screen-reader timing. Polite, not assertive: every
          sentence follows something the reader just did. Only the sentences:
          the boxes below carry request ids, and no ancestor of an id may be a
          live region (§5.6, TAS-397), so the boxes are plain content.

          One `<span>` per sentence, keyed by the notice's own sequence number:
          a sentence that arrives is a node added, which is what is announced,
          and one already there is not touched by the arrival of another — a
          single joined string would be rewritten whole, and a queue of files
          would read the earlier refusals out again with each later one.
          Taking the sentences away (a new action) adds nothing, so it is
          silent. */}
      <p className="visually-hidden" role="status">
        {[...errorNotices, ...infoNotices].map((notice) => (
          <span key={notice.seq}>
            {notice.text}{" "}
          </span>
        ))}
      </p>
      {/* Errors first, then information, each in §5.6's box, the refusal's
          request id on the box's detail line; empty, it takes no space. */}
      <div className="attachment-notes">
        {errorNotices.map((notice, index) => (
          <div className="attachment-note is-error" key={`error-${index}`}>
            {notice.text}
            {notice.requestId ? (
              <p className="error-note-detail">
                <RequestId value={notice.requestId} />
              </p>
            ) : null}
          </div>
        ))}
        {infoNotices.map((notice, index) => (
          <p className="attachment-note" key={`info-${index}`}>
            {notice.text}
          </p>
        ))}
      </div>

      {/* A part that did not load says so where "No attachments yet" would
          sit, in the recipe the four sections share (art-director, TAS-246),
          and never hides the section: the upload is its own request. */}
      {unavailable ? <p className="issue-links-empty is-unavailable">{partUnavailableText("attachments")}</p> : null}

      {/* Only a part the server sent may say there are none. */}
      {attachmentsQuery.data && attachments.length === 0 && !pending && !waiting.length ? (
        <p className="issue-links-empty">No attachments yet</p>
      ) : null}

      {attachments.length || pending || waiting.length ? (
        <ul className="attachment-list">
          {attachments.map((attachment) => {
            const uploader = personFor(attachment.uploadedBy, attachment.uploadedByUser, userById);
            const name = attachment.fileName || "Unnamed file";
            // Two rules, not one. Your own file needs ADMIN or MEMBER; somebody
            // else's needs ADMIN. An attachment whose uploader the response left
            // blank is treated as somebody else's, which is the safer of the two
            // readings. The server checks all of this again regardless.
            const mine = Boolean(currentUserId) && attachment.uploadedBy === currentUserId;
            const canDelete = mine ? canEdit : isProjectAdmin;
            const removing = deleteAttachment.isPending && deleteAttachment.variables === attachment.id;
            // In flight for this row. `aria-disabled` rather than `disabled`
            // while a request is out: pressing Enter on a button that disables
            // itself drops focus to `<body>` (§4.21). The handlers ignore a
            // second press instead.
            const opening = open.isPending && open.variables?.attachment.id === attachment.id;
            const downloading = download.isPending && download.variables?.id === attachment.id;
            // An attachment the response left unaddressable cannot be asked
            // for: the request would name no attachment. The row still shows —
            // the file is on the issue either way — with its two actions off.
            const unaddressable = !attachment.id;
            return (
              <li className="attachment-row" key={attachment.id || attachment.fileName}>
                <button
                  aria-disabled={opening || undefined}
                  aria-label={`Open ${name} in a new tab`}
                  className="attachment-open"
                  disabled={unaddressable}
                  onClick={() => openAttachment(attachment)}
                  title="Open in a new tab"
                  type="button"
                >
                  <ExternalLink className="attachment-icon" size={14} />
                  <span className="attachment-name">{name}</span>
                  <span className="attachment-meta">
                    {formatFileSize(attachment.sizeBytes)}
                    {uploader ? ` · ${uploader.displayName}` : ""}
                    {attachment.createdAt ? ` · ${formatDateTime(attachment.createdAt)}` : ""}
                  </span>
                </button>
                {fallbackLink?.id === attachment.id ? (
                  // The browser did not open a tab for us. The link is real and
                  // good for fifteen minutes, so it is offered rather than
                  // swallowed — as a plain link, which a blocker lets through.
                  <a className="attachment-blocked-link" href={fallbackLink.url} rel="noopener noreferrer" target="_blank">
                    Open
                  </a>
                ) : null}
                <button
                  aria-disabled={downloading || undefined}
                  aria-label={`Download ${name}`}
                  className="icon-button attachment-action"
                  disabled={unaddressable}
                  onClick={() => {
                    if (!downloading) download.mutate(attachment);
                  }}
                  title="Download"
                  type="button"
                >
                  <Download size={14} />
                </button>
                {canDelete ? (
                  <button
                    aria-label={`Delete ${name}`}
                    className="icon-button attachment-action"
                    disabled={unaddressable || removing}
                    onClick={() => deleteAttachment.mutate(attachment.id)}
                    title="Delete"
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

          {waiting.map((item) => (
            // The files queued behind it, in the order they will go.
            <li className="attachment-row is-pending" key={`attachment-waiting-${item.key}`}>
              <span className="attachment-open is-inert">
                <Paperclip className="attachment-icon" size={14} />
                <span className="attachment-name">{item.fileName}</span>
                <span className="attachment-meta">
                  {formatFileSize(item.sizeBytes)} · Waiting…
                </span>
              </span>
            </li>
          ))}
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
  const failure = objectStoreUploadFailure(error);
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
  archived,
  currentUserId,
  userById,
  prefetched,
}: {
  projectId: string;
  issueId: string;
  canComment: boolean;
  /**
   * The project is archived (§5.7). Writing is off through `canComment`, and
   * the draft stays whichever way it went; this only tells the focus rule
   * below that the board's archive turn is placing focus itself.
   */
  archived: boolean;
  currentUserId?: string;
  userById: Map<string, Pick<User, "id" | "displayName" | "color" | "avatarUrl">>;
  /**
   * The panel started this read before the section mounted, so whatever that
   * read answered — a failure too — is not asked again on mount. See
   * `commentsPrefetched` in `IssuePanel`.
   */
  prefetched: boolean;
}) {
  const queryClient = useQueryClient();
  const sectionId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  // The comment whose Delete has asked (TAS-259). One at a time, and never
  // together with an open editor — the work log's rule.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  // The panel has usually started this read already (`issueCommentsOptions`).
  const commentsRead = issueCommentsOptions(projectId, issueId);
  const commentsQuery = useInfiniteQuery({ ...commentsRead, retryOnMount: !prefetched });

  // Comment mutations also append to the issue history, so the activity feed has to refetch.
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: commentsRead.queryKey }),
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
  const mutationWords = mutationError ? (refusalWords(mutationError) ?? mutationError.message) : "";
  const mutationRequestId = mutationError ? apiErrorFacts(mutationError).requestId : null;
  // The composer stays for a draft the right to comment left unsent — an archive,
  // or a refusal that read the role again and found a VIEWER (§5.7) — read-only
  // and without its button; otherwise it goes with the right to comment. The
  // reader's words are work (§5.5), whichever way the right went.
  const keepsDraft = !canComment && draft !== "";

  /**
   * The Comment button goes with the right to comment, and if it had focus —
   * the reader pressed it, and the refusal that took the right away answered —
   * focus goes with it, to `<body>`. A role turn (a refusal that read the
   * context again and found a VIEWER or nobody) puts it on the read-only box
   * that keeps the draft instead (§5.7), the control that is still the
   * reader's place. An archive turn does not: the board places focus itself,
   * on the panel's archive line, the nearest open layer (§5.7), and this must
   * not take it first — child effects run before the board's. A reader whose
   * focus is somewhere real keeps it either way. Acted on at the turn only,
   * never on a panel that opens without the right.
   */
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const couldComment = useRef(canComment);
  useEffect(() => {
    const turned = couldComment.current && !canComment;
    couldComment.current = canComment;
    if (turned && !archived && focusLost()) draftRef.current?.focus();
  }, [archived, canComment]);

  /**
   * Delete asks first (TAS-259), in §4.22's strip under the row, as the work
   * log's does. One press used to delete — and since the Activity feed folds
   * (TAS-257), folding it near the foot of the panel shifts the thread by the
   * feed's height, so a second press could land on a comment's Delete.
   */
  const openConfirm = (commentId: string) => {
    setEditingId(null);
    setConfirmingId((current) => (current === commentId ? null : commentId));
  };
  const acceptConfirm = (commentId: string) => {
    setConfirmingId(null);
    // The row leaves with the button that removed it once the thread is read
    // again, so focus goes to the heading now rather than to a button that is
    // about to be disabled and then gone.
    headingRef.current?.focus();
    deleteComment.mutate(commentId);
  };

  return (
    <section aria-labelledby={`${sectionId}-heading`} className="comments">
      {/* Focusable only from script: where focus lands after a confirmed delete. */}
      <h3 id={`${sectionId}-heading`} ref={headingRef} tabIndex={-1}>
        Comments
        {totalCount ? <span className="count-pill">{totalCount}</span> : null}
      </h3>

      {canComment || keepsDraft ? (
        <form
          className="comment-composer"
          onSubmit={(event) => {
            event.preventDefault();
            if (canComment && draft.trim()) addComment.mutate(draft.trim());
          }}
        >
          <textarea
            // A comment being written holds the panel open on Esc (§4.10).
            data-unsaved-text={draft !== "" ? "true" : undefined}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Leave a comment"
            readOnly={!canComment}
            ref={draftRef}
            rows={3}
            value={draft}
          />
          {canComment ? (
            <div className="comment-composer-actions">
              <button className="primary-button compact-button" disabled={!draft.trim() || addComment.isPending} type="submit">
                Comment
              </button>
            </div>
          ) : null}
        </form>
      ) : null}

      {commentsQuery.isError ? (
        <ErrorNote requestId={apiErrorFacts(commentsQuery.error).requestId}>{commentsQuery.error.message}</ErrorNote>
      ) : null}
      {/* A write's refusal, announced since TAS-259: a confirmed delete moves
          focus to the heading, so without a word a refusal would just appear.
          One polite region that stays mounted and changes its text — the work
          log's recipe, the shape §7 records as reliable — rather than
          `ErrorNote`, which mounts together with its text. `.error-note`'s box
          is drawn around it only while it has something to say; empty, the
          wrapper has no class and the sentence no margin, so it takes no
          space. The request id is the box's detail line, a sibling of the
          sentence and outside its region (§5.6, TAS-397). */}
      <div className={mutationError ? "error-note" : undefined}>
        <p aria-live="polite" className="error-note-sentence">
          {mutationWords}
        </p>
        {mutationRequestId ? (
          <p className="error-note-detail">
            <RequestId value={mutationRequestId} />
          </p>
        ) : null}
      </div>

      {commentsQuery.isPending ? <p className="comments-empty">Loading comments</p> : null}
      {!commentsQuery.isPending && comments.length === 0 ? <p className="comments-empty">No comments yet</p> : null}

      {comments.map((comment) => (
        <CommentItem
          // Entering or leaving edit mode remounts the row, which reseeds the
          // draft from the current comment body. Same reset the component used
          // to do from an effect, without the cascading render.
          key={`${comment.id}:${editingId === comment.id}`}
          comment={comment}
          author={personFor(comment.authorUserId, comment.author, userById)}
          canManage={canComment && comment.authorUserId === currentUserId}
          // An edit the archive caught open stays open, read-only (§5.7):
          // `canManage` goes, `editing` does not.
          editing={editingId === comment.id}
          confirming={confirmingId === comment.id}
          confirmId={`${sectionId}-confirm-${comment.id}`}
          pending={updateComment.isPending || deleteComment.isPending}
          onStartEdit={() => {
            setConfirmingId(null);
            setEditingId(comment.id);
          }}
          onCancelEdit={() => setEditingId(null)}
          onSave={(body) => updateComment.mutate({ commentId: comment.id, body })}
          onOpenConfirm={() => openConfirm(comment.id)}
          onCancelConfirm={() => setConfirmingId(null)}
          onAcceptConfirm={() => acceptConfirm(comment.id)}
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
  confirming,
  confirmId,
  pending,
  onStartEdit,
  onCancelEdit,
  onSave,
  onOpenConfirm,
  onCancelConfirm,
  onAcceptConfirm,
}: {
  comment: IssueComment;
  author?: Pick<User, "id" | "displayName" | "color" | "avatarUrl">;
  canManage: boolean;
  editing: boolean;
  /** This row's Delete has asked, and its strip is open. */
  confirming: boolean;
  confirmId: string;
  pending: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: (body: string) => void;
  onOpenConfirm: () => void;
  onCancelConfirm: () => void;
  onAcceptConfirm: () => void;
}) {
  // Seeded once per mount. The parent's key includes the editing flag, so
  // toggling edit mode remounts this row with a fresh draft.
  const [body, setBody] = useState(comment.body);
  const deleteButton = useRef<HTMLButtonElement>(null);
  // Cancel and Esc give focus back to the Delete that asked (§4.22). Moved
  // before the strip unmounts, so it never falls to <body> in between.
  const cancelConfirm = () => {
    deleteButton.current?.focus();
    onCancelConfirm();
  };
  const when = formatDateTime(comment.createdAt);
  const asking = canManage && confirming && !editing;
  // "via MCP (Cursor on laptop)" — nothing for a comment written in the UI (TAS-412).
  const via = actionViaText(comment.via);

  return (
    <article className="comment-item">
      {/* An author nobody can name is "Unknown", circle included: without the
          label `Avatar` names the empty circle "Unassigned" (§4.26). */}
      <Avatar user={author} label="Unknown" size="sm" />
      {/* Esc closes an open question from anywhere in the comment's text
          column — the strip's two answers, and the Delete that asked, which
          Shift+Tab from Cancel lands on (§4.22). On the strip alone it did
          nothing there. */}
      <div
        className="comment-main"
        onKeyDown={(event) => {
          if (asking && event.key === "Escape") {
            // Used: the panel's own Esc skips a press something inside took (§4.10).
            event.preventDefault();
            event.stopPropagation();
            cancelConfirm();
          }
        }}
      >
        <p className="comment-head">
          <strong>{author?.displayName ?? "Unknown"}</strong>
          {via ? <span className="via-mark">{via}</span> : null}
          <time>{when}</time>
          {/* Not `comment.updatedAt &&`: the server stamps that field on insert
              too, so the presence of a value says only that the row exists
              (TAS-233). `commentWasEdited` is the one rule for this badge. */}
          {commentWasEdited(comment) ? <em>edited</em> : null}
        </p>

        {editing ? (
          <>
            <textarea
              // A comment being edited holds the panel open on Esc (§4.10).
              data-unsaved-text={body !== "" ? "true" : undefined}
              onChange={(event) => setBody(event.target.value)}
              // Only after an archive landed mid-edit (§5.7): the reader's
              // text stays, and nothing can send it.
              readOnly={!canManage}
              rows={3}
              value={body}
              autoFocus
            />
            <div className="comment-actions">
              {canManage ? (
                <button
                  className="primary-button compact-button"
                  disabled={!body.trim() || body.trim() === comment.body || pending}
                  onClick={() => onSave(body.trim())}
                  type="button"
                >
                  Save
                </button>
              ) : null}
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
                <button
                  aria-controls={confirming ? confirmId : undefined}
                  aria-expanded={confirming}
                  className="link-button"
                  disabled={pending}
                  onClick={onOpenConfirm}
                  ref={deleteButton}
                  type="button"
                >
                  Delete
                </button>
              </div>
            ) : null}
          </>
        )}

        {asking ? (
          // §4.22's inline confirmation, as the work log draws it: the
          // sentence, Cancel first and focused, and the answer that destroys
          // something edged in `--danger`. Nothing is sent until that answer.
          <div className="member-confirm comment-confirm" id={confirmId}>
            <p className="member-confirm-sentence" id={`${confirmId}-sentence`}>
              Your comment from {when} will be removed from this issue for everyone.
            </p>
            <div className="member-confirm-actions">
              <button autoFocus className="secondary-button compact-button" onClick={cancelConfirm} type="button">
                Cancel
              </button>
              <button
                aria-describedby={`${confirmId}-sentence`}
                className="secondary-button compact-button member-confirm-accept"
                onClick={onAcceptConfirm}
                type="button"
              >
                Delete comment
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </article>
  );
}

/**
 * Whether the server will take this member as an assignee. issue-service checks
 * `assign-issue-roles` (ADMIN, MEMBER) against the assignee as well as against
 * whoever assigns (read at `develop` `1cfe4d7`, TAS-226), and the contract
 * states neither half. A `null` role is not assignable here: the server said
 * nothing this build can act on, and an assignability nobody stated is not the
 * client's to offer. The server stays the authority either way.
 */
function canBeAssigned(member: ProjectMember): boolean {
  return member.role === "ADMIN" || member.role === "MEMBER";
}

function AssigneeChip({
  user,
  label,
  active,
  disabled,
  ariaDisabled = false,
  onClick,
}: {
  user: Pick<User, "id" | "displayName" | "color" | "avatarUrl"> | null;
  label: string;
  active: boolean;
  disabled: boolean;
  /** Pressable, focusable, and announced as unavailable; `onClick` has to refuse the press itself. */
  ariaDisabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      aria-disabled={ariaDisabled || undefined}
      className={`assignee-chip ${active ? "is-active" : ""}`}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <Avatar user={user} size="sm" />
      <span>{label}</span>
    </button>
  );
}

/**
 * Where the reader's choice to fold the activity feed away is kept (TAS-257):
 * `"1"` while it is collapsed, and no key at all while it is expanded, which is
 * the default. One choice for every issue, the way the theme is one choice for
 * every screen (`taska.theme`), so it survives a reload and a different issue.
 */
const activityCollapsedKey = "taska.activityCollapsed";

/**
 * Storage that refuses (private mode, a full quota, a policy) costs the
 * remembering and nothing else: the feed opens expanded, and the toggle still
 * works for as long as the panel is up.
 */
function readActivityCollapsed() {
  try {
    return window.localStorage.getItem(activityCollapsedKey) === "1";
  } catch {
    return false;
  }
}

function writeActivityCollapsed(collapsed: boolean) {
  try {
    if (collapsed) window.localStorage.setItem(activityCollapsedKey, "1");
    else window.localStorage.removeItem(activityCollapsedKey);
  } catch {
    // Not remembered, and that is all: the state on screen is already right.
  }
}

/**
 * The issue's history, newest first, behind a disclosure in its own heading
 * (TAS-257). The heading stays an `h3` — it is the section's place in the
 * panel's outline — and the one button inside it is the whole of its text, so
 * a click anywhere on the words, Enter or Space folds the feed. A folded feed
 * is not rendered at all; the heading and its count stay. An issue with no
 * history says so inside the open list, in the empty line the other sections
 * use. No open or close animation (DESIGN.md §1, a quiet interface).
 */
function ActivitySection({
  history,
  userById,
  statuses,
  priorities,
}: {
  history: IssueHistoryEvent[];
  userById: Map<string, Pick<User, "id" | "displayName" | "color" | "avatarUrl">>;
  /** The issue's workflow statuses, which name a status the build has no word for. */
  statuses?: readonly WorkflowStatus[];
  /** `GET /meta`'s priorities, which name a priority the build has no word for. */
  priorities?: readonly DictionaryEntry[] | null;
}) {
  const [expanded, setExpanded] = useState(() => !readActivityCollapsed());
  const listId = useId();

  return (
    <section className="activity">
      <h3>
        <button
          aria-controls={expanded ? listId : undefined}
          aria-expanded={expanded}
          onClick={() => {
            const next = !expanded;
            setExpanded(next);
            writeActivityCollapsed(!next);
          }}
          type="button"
        >
          {expanded ? <ChevronDown aria-hidden="true" size={14} /> : <ChevronRight aria-hidden="true" size={14} />}
          Activity
          {history.length ? <span className="count-pill">{history.length}</span> : null}
        </button>
      </h3>
      {expanded ? (
        <div className="activity-list" id={listId}>
          {history.length === 0 ? <p className="issue-links-empty">No activity yet</p> : null}
          {history
            .slice()
            .reverse()
            .map((event, index) => (
              <ActivityItem
                event={event}
                key={event.id}
                isLast={index === history.length - 1}
                names={{ statuses, priorities }}
                // The server's summary of the actor first — a former member
                // included — then the member list, then nobody (TAS-398, §4.26).
                user={personFor(event.actorUserId, event.actor, userById)}
                userById={userById}
              />
            ))}
        </div>
      ) : null}
    </section>
  );
}

function ActivityItem({
  event,
  user,
  userById,
  names,
  isLast,
}: {
  event: IssueHistoryEvent;
  user?: Pick<User, "id" | "displayName" | "color" | "avatarUrl">;
  userById: Map<string, Pick<User, "id" | "displayName" | "color" | "avatarUrl">>;
  names: HistoryNames;
  isLast: boolean;
}) {
  // The channel mark (TAS-412) is meta, so it rides on the time's line —
  // "Aug 1, 12:00 · via MCP (Cursor on laptop)" — and the sentence stays whole
  // (§4.26). The plain space before the hidden dot is what a screen reader
  // keeps between the two. An event without one draws exactly as before.
  const via = actionViaText(event.via);
  const time = <time>{formatDateTime(event.occurredAt)}</time>;
  return (
    <div className="activity-item">
      {!isLast ? <span className="activity-line" /> : null}
      {/* "Unknown", word and circle alike, when neither the server nor the
          member list names the actor — never "Someone", and never the
          "Unassigned" an unlabelled empty circle says (§4.26). */}
      <Avatar user={user} label="Unknown" size="sm" />
      <div>
        <p>
          <strong>{user?.displayName ?? "Unknown"}</strong> {historyText(event, userById, names)}
        </p>
        {via ? (
          <div className="activity-meta">
            {time} <span aria-hidden="true"> · </span>
            <span className="via-mark">{via}</span>
          </div>
        ) : (
          time
        )}
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
  archived,
  projectId,
  projectKey,
  projectColor,
  onClose,
  onLabelDeleted,
}: {
  /**
   * The project was archived while this dialog was open (DESIGN.md §5.7,
   * «Архив пришёл отказом записи»; the board offers no Labels on an archived
   * project, so this is only ever that). The list stays; the New label form
   * and every row's actions go, an open rename keeps what was typed,
   * read-only, and one line says why — unless a refusal of this dialog's
   * already does.
   */
  archived: boolean;
  projectId: string;
  projectKey: string;
  /**
   * Only so the eyebrow badge matches the one in the topbar behind this modal.
   * Passed rather than recomputed from the key: a colour the server stated wins
   * over the computed one (`keyBadgeStyle`), and a modal that skipped the
   * argument would agree with the board only until the first project that has
   * one — TAS-148.
   */
  projectColor?: string | null;
  onClose: () => void;
  onLabelDeleted: (labelId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [color, setColor] = useState(labelColorChoices[0]);
  const [editing, setEditing] = useState<{ id: string; name: string; color: string } | null>(null);

  // The board's context read (TAS-251): the labels are one part of it, and the
  // optimistic writes below patch that part in place. The rows are `Label` —
  // `id`, `name` and `color` — because that is all the context carries, and an
  // optimistic row invents nothing the server's answer would not have.
  const labelsKey = projectContextKey(projectId);
  const labelsQuery = useQuery({
    queryKey: labelsKey,
    queryFn: () => taskaApi.getProjectContext(projectId),
    retry: retryUnlessMissing,
    select: (context: ProjectContext) => context.labels,
  });
  const labels = useMemo(() => labelsQuery.data ?? [], [labelsQuery.data]);
  /** Rewrite the context's labels and nothing else of it. */
  const patchLabels = (write: (current: Label[]) => Label[]) =>
    queryClient.setQueryData<ProjectContext>(labelsKey, (current) =>
      current ? { ...current, labels: write(current.labels) } : current,
    );

  // A rename or a recolour changes every chip drawn from these labels, and a
  // delete takes the label off every issue that carried it (the contract's
  // soft delete), so the issue reads and the board go with them.
  const settle = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: labelsKey }),
      // The open panel's chips come from its issue read since TAS-246.
      queryClient.invalidateQueries({ queryKey: ["issue", projectId] }),
      queryClient.invalidateQueries({ queryKey: boardKey(projectId) }),
    ]);

  const createLabel = useMutation({
    mutationFn: (input: CreateProjectLabelInput) => taskaApi.createProjectLabel(projectId, input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: labelsKey });
      const previous = queryClient.getQueryData<ProjectContext>(labelsKey);
      patchLabels((current) => [...current, { id: optimisticLabelId, name: input.name, color: input.color }]);
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
      const previous = queryClient.getQueryData<ProjectContext>(labelsKey);
      patchLabels((current) =>
        current.map((label) => (label.id === input.id ? { ...label, name: input.name, color: input.color } : label)),
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
      const previous = queryClient.getQueryData<ProjectContext>(labelsKey);
      patchLabels((current) => current.filter((label) => label.id !== labelId));
      return { previous };
    },
    onError: (_error, _labelId, context) => {
      if (context?.previous) queryClient.setQueryData(labelsKey, context.previous);
    },
    onSuccess: (_result, labelId) => onLabelDeleted(labelId),
    onSettled: settle,
  });

  const refusal = createLabel.error ?? updateLabel.error ?? deleteLabel.error;
  const failure = labelsQuery.error ?? refusal;
  const error = failure ? (refusalWords(failure) ?? failure.message) : undefined;
  /**
   * The note on screen is this dialog's `PROJECT_ARCHIVED` refusal, which says
   * what the archive line would (§5.7): then it stands in for the line, and is
   * where focus goes. A refusal of any other kind — a duplicate name, a 403 —
   * says nothing about the archive, and the line stays.
   */
  const archiveRefused = isProjectArchived(failure);

  /**
   * Where focus goes when the archive takes the control that had it (§5.7):
   * this dialog's `PROJECT_ARCHIVED` refusal, else its line — placed here, as
   * Edit project places its own, and not left to the board's archive effect
   * alone. That effect runs once, on the turn, and this dialog can change
   * after it: every write here settles by re-reading the context and the
   * board *before* its refusal is dispatched (`settle` is `onSettled`, which
   * the mutation awaits), so a context answer that renders first turns the
   * dialog read-only with the line, the board's effect focuses the line, and
   * the refusal that lands with the board's answer then takes the line's place
   * — and the focus with it, to `<body>` under the scrim (the PR #103 CI
   * failure: context and board are two reads, and either may answer first).
   *
   * Only focus that was lost, and only once archived: a reader still in an
   * open rename keeps their place, and before the turn the form is still there
   * to be in.
   */
  const refusalRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (!archived) return;
    const target = archiveRefused ? refusalRef.current : lineRef.current;
    if (!target) return;
    if (focusLost()) target.focus();
  }, [archived, archiveRefused]);

  /**
   * The rename editor is this dialog's inner layer (§4.11's `Esc` order,
   * TAS-397): `Esc` — wherever focus is in the dialog — and Cancel close it,
   * and focus goes back to the row's Edit, the control that opened it. Once
   * archived the row has no Edit, and focus goes where the archive put it
   * above: the refusal, else the line. `Esc` listens on `document`, ahead of
   * `Modal`'s `window` listener, and takes the key with `preventDefault()`.
   */
  const newLabelRef = useRef<HTMLInputElement>(null);
  const editButtons = useRef(new Map<string, HTMLButtonElement>());
  const renameReturn = useRef<string | null>(null);
  const closeRename = () => {
    if (editing) renameReturn.current = editing.id;
    setEditing(null);
  };
  useEffect(() => {
    const labelId = renameReturn.current;
    if (editing || labelId === null) return;
    renameReturn.current = null;
    (editButtons.current.get(labelId) ?? (archiveRefused ? refusalRef.current : lineRef.current))?.focus();
  }, [editing, archiveRefused]);
  const renameEscape = useRef(closeRename);
  useEffect(() => {
    renameEscape.current = closeRename;
  });
  const renaming = editing !== null;
  useEffect(() => {
    if (!renaming) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      event.preventDefault();
      renameEscape.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [renaming]);

  const trimmed = name.trim();
  /**
   * Add label is two kinds of unavailable in one button (§4.1): with no name,
   * natively `disabled`, before the press; with a name typed while the previous
   * create is still out, «in flight» — `aria-disabled`, not dimmed,
   * `cursor: progress`, label unchanged — and the submit refuses before it
   * clears anything, so the typed name stays. Refused rather than queued: the
   * create's rollback restores its own start snapshot, which would erase a
   * second optimistic row.
   */
  const addInFlight = trimmed !== "" && createLabel.isPending;
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
      // A label write in flight holds `Esc` (§4.11); ✕ and the scrim still close.
      busy={createLabel.isPending || updateLabel.isPending || deleteLabel.isPending}
      onClose={onClose}
    >
      {archived ? (
        // In the New label form's place, and only while no `PROJECT_ARCHIVED`
        // refusal of this dialog's is on screen: then that one says it (§5.7,
        // one fact, one place). A refusal of another kind does not, and the
        // line stays — here, where the form stood, above it. A place focus is
        // put, never a Tab stop — see the board's archive effect.
        archiveRefused ? null : (
          <p className="modal-archive-note" data-archive-note="modal" ref={lineRef} tabIndex={-1}>
            This project is archived, so its labels cannot be changed.
          </p>
        )
      ) : (
        <form
          className="label-create-form"
          onSubmit={(event) => {
            event.preventDefault();
            // Enter is refused the same way as the button (see `addInFlight`).
            if (!trimmed || createLabel.isPending) return;
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
            // And the field takes focus, as Add does in Members (§4.1, §4.22):
            // the button just pressed turns `disabled` with the field empty,
            // which dropped focus to `<body>` (measured 2026-10-24).
            newLabelRef.current?.focus();
          }}
        >
          <label className="field">
            <span>New label</span>
            <input
              autoFocus
              maxLength={50}
              onChange={(event) => setName(event.target.value)}
              placeholder="backend"
              ref={newLabelRef}
              value={name}
            />
          </label>
          <LabelSwatches onPick={setColor} selected={color} />
          <button
            aria-disabled={addInFlight || undefined}
            className="primary-button"
            disabled={!trimmed}
            type="submit"
          >
            Add label
          </button>
        </form>
      )}

      {error ? (
        <ErrorNote
          archiveNote={archiveRefused}
          ref={refusalRef}
          // Under the sentence, inside the box (§5.6, TAS-397).
          requestId={failure ? apiErrorFacts(failure).requestId : null}
        >
          {error}
        </ErrorNote>
      ) : null}

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
                    if (next && !archived) updateLabel.mutate({ id: editing.id, name: next, color: editing.color });
                  }}
                >
                  {/* A rename the archive caught open keeps what was typed,
                      read-only, and loses its Save; its Cancel stays (§5.7). */}
                  <input
                    aria-label={`Rename ${label.name || "label"}`}
                    maxLength={50}
                    onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                    readOnly={archived}
                    value={editing.name}
                  />
                  <LabelSwatches
                    onPick={(next) => setEditing({ ...editing, color: next })}
                    selected={editing.color}
                    unavailable={archived}
                  />
                  {archived ? null : (
                    <button
                      aria-label="Save label"
                      className="icon-button"
                      disabled={!editing.name.trim() || updateLabel.isPending}
                      type="submit"
                    >
                      <Check size={15} />
                    </button>
                  )}
                  <button aria-label="Cancel" className="icon-button" onClick={closeRename} type="button">
                    <X size={15} />
                  </button>
                </form>
              ) : archived ? (
                // The row's actions go with the archive (§5.7); the label stays.
                <LabelChip label={label} />
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
                    ref={(node) => {
                      if (!node || !label.id) return;
                      editButtons.current.set(label.id, node);
                      return () => {
                        editButtons.current.delete(label.id);
                      };
                    }}
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
 * The control itself is `ColorSwatches` (src/components/ColorSwatches.tsx),
 * shared with the project colour picker TAS-148 added — same eight hexes, same
 * single choice, same ring for the checked state, so §8's "pass a prop, do not
 * fork the component" applies. What is left here is the label-shaped contract
 * over it: a colour is always chosen, never `null`, because a label has no
 * "automatic".
 */
function LabelSwatches({
  onPick,
  selected,
  unavailable = false,
}: {
  onPick: (color: string) => void;
  selected: string;
  /** Archived under the dialog: `ColorSwatches`' steadily-unavailable state. */
  unavailable?: boolean;
}) {
  return (
    <ColorSwatches
      choices={labelColorChoices.map((choice) => ({ value: choice, swatch: choice, label: `Colour ${choice}` }))}
      groupLabel="Label colour"
      // None of the options above carries a `null`, so this only narrows the
      // shared type back to what a label can hold. Ignored rather than coerced
      // to a default: a value this group cannot produce should do nothing, not
      // silently pick the first colour.
      onPick={(value) => {
        if (value !== null) onPick(value);
      }}
      selected={selected}
      unavailable={unavailable}
    />
  );
}

function CreateIssueModal({
  archived,
  inStatus,
  filteredType,
  workflows,
  issueTypes,
  projectId,
  projectKey,
  projectColor,
  onClose,
  onCreated,
}: {
  /**
   * The project was archived while the form was open (DESIGN.md §5.7, «Архив
   * пришёл отказом записи»; the board offers no New on an archived project).
   * The form stays with what was typed, read-only: Create issue goes, the
   * pickers are `aria-disabled`, Cancel and ✕ stay, and one line says why —
   * unless the refused create already does.
   */
  archived: boolean;
  /**
   * The project's issue-type registry (TAS-417), in its order: only these are
   * offered, and the first is the default. Empty means nothing can be created,
   * and the form says so rather than offering a type the server did not list
   * (TAS-251).
   */
  issueTypes: readonly ProjectIssueType[];
  /**
   * The column whose "+" opened the form (§5.5, P3′), or `null` for "New". The
   * server creates in `TODO` until backend TAS-428, so the form names the
   * column in its title and switches off a type whose workflow lacks its
   * status: such an issue would land in «Outside their workflow», not where
   * "+" was pressed.
   */
  inStatus: ColumnStatus | null;
  /** The type the board is filtered by: the "+" form's default when it can take it. */
  filteredType: IssueTypeCode | null;
  /** The context's workflows by type — what says whether a type has the column's status. */
  workflows: ProjectContext["workflows"] | undefined;
  projectId: string;
  projectKey: string;
  /** Same reason as `ProjectLabelsModal`: one key, one colour, on every surface. */
  projectColor?: string | null;
  onClose: () => void;
  onCreated: (issue: Issue) => void;
}) {
  const queryClient = useQueryClient();
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const meta = useMeta();
  const statusName = inStatus ? statusLabel(inStatus.statusKey, [inStatus]) : null;
  /**
   * A type the "+" form switches off (§5.5): its workflow is in the context
   * and has no status of the column's key. A type with no workflow entry is
   * left on — the server decides.
   */
  const lacksStatus = (code: IssueTypeCode) => {
    if (!inStatus) return false;
    const workflow = workflows?.[code];
    return workflow !== undefined && !workflow.statuses.some((status) => status.statusKey === inStatus.statusKey);
  };
  const enabledTypes = issueTypes.filter((entry) => !lacksStatus(entry.code));
  // The default (§5.5): the first type of the registry from "New"; from "+",
  // the type the board is filtered by, else the first type of the registry that
  // has the column's status. The reader's pick is kept for as long as it can
  // still be made, so a reorder that lands while the form is open moves only a
  // default nobody chose.
  const [pickedType, setIssueType] = useState<IssueTypeCode | null>(null);
  const defaultType = inStatus
    ? ((filteredType !== null && enabledTypes.some((entry) => entry.code === filteredType) ? filteredType : null) ??
      enabledTypes[0]?.code ??
      issueTypes[0]?.code ??
      null)
    : (issueTypes[0]?.code ?? null);
  const issueType =
    pickedType !== null && enabledTypes.some((entry) => entry.code === pickedType) ? pickedType : defaultType;
  /** Every type switched off — the context and the board disagree (§5.5): nothing can be created here. */
  const noTypeHasStatus = inStatus !== null && issueTypes.length > 0 && enabledTypes.length === 0;
  // The priorities `GET /meta` lists, or the contract's three until it has
  // answered (TAS-173, art-director's ruling 5). Medium by default when it is
  // offered, the first otherwise; the reader's pick is kept for as long as the
  // set still offers it, so a list that lands after the form opened moves only
  // a default nobody chose.
  const offeredPriorities = selectableCodes(meta?.priorities, issuePriorities);
  const [pickedPriority, setPriority] = useState<IssuePriorityCode | null>(null);
  const priority =
    pickedPriority !== null && offeredPriorities.includes(pickedPriority)
      ? pickedPriority
      : offeredPriorities.includes("MEDIUM")
        ? "MEDIUM"
        : offeredPriorities[0];
  // Stacked rather than side by side once the priority picker holds a value
  // this build has no word for: its label is the code, and a half-width
  // segmented control runs out of room for it (art-director's ruling 5). The
  // type is a select since TAS-417 and takes any name in its own width.
  const stackPickers = offeredPriorities.some((code) => !isKnownPriority(code));
  // The five planning fields, all optional (TAS-189). Held as drafts for the
  // same reason the panel holds them that way — the boxes are typed into — and
  // reduced to a request body by `planningInput`, which omits what was left
  // empty and passes on what was typed, including what it could not read.
  const [planning, setPlanning] = useState<PlanningDrafts>(() => planningDrafts(null));
  /**
   * The form's refusal of a date box the reader has half typed — the same fault
   * the panel answers for, answered here in this surface's own words.
   *
   * Held as state rather than left to the browser because native validation is
   * what this form used to do, and what it does is refuse to fire `submit` at
   * all: no handler runs, nothing is created, and the only account of it is a
   * tooltip drawn in the *browser's* language beside a box the reader may have
   * scrolled past. "Create issue" simply appears dead, and the way out a reader
   * finds by themselves is to empty both dates — which is one of the ways an
   * issue gets created with no plan (TAS-231). `noValidate` on the form below
   * is what hands the decision back to this component; nothing else on it had a
   * constraint for the browser to enforce, so nothing else changes hands.
   *
   * Three parts, because the sentence and the mark do not have the same
   * lifetime and pretending they did is what put a red line over a box that
   * was fine (art-director, TAS-231). `field` and `marked` are the *mark* —
   * `aria-invalid` and `aria-describedby` on one box — and they follow
   * `badInput` on that box exactly, because changing an attribute moves
   * nothing on screen and so is free to happen at any moment, including with a
   * finger down on a button. `seq` is the *announcement*: a fresh one remounts
   * the live region, so the same sentence twice over is still heard. The
   * sentence itself is the slowest of the three, and `checkDates` and
   * `relaxDates` between them are the whole of why.
   */
  const [dateNotice, setDateNotice] = useState<{ field: PlanningDateField; seq: number; marked: boolean } | null>(null);
  /** The panel's `clearDateNotice`, for the same two reasons — see it. */
  const clearDateNotice = () => setDateNotice(null);
  /**
   * Take the mark off the box without touching the sentence. Attributes only:
   * no node is added or removed, nothing reflows, and the action row below the
   * slot does not move — which is what makes this safe to do on a keystroke,
   * where withdrawing the *line* is not (`checkDates`).
   */
  const unmarkDate = () => setDateNotice((current) => (current?.marked ? { ...current, marked: false } : current));
  /**
   * The one box the mark is on, if any — see the state above for the "if".
   * None once archived: the line it points at is not shown then.
   */
  const markedDate = dateNotice?.marked && !archived ? dateNotice.field : null;
  /** The estimate fields' `for`/`id`/`aria-describedby` prefix — see the panel's. */
  const planningId = useId();
  /**
   * The message slot's own id, because on this surface the offending box points
   * at the sentence: `aria-describedby` is what carries "that date" to a reader
   * who cannot see which box the focus landed in.
   */
  const noticeId = useId();
  /**
   * The two date controls themselves. Refs and not drafts, because the state
   * being judged is the control's and not the draft's: a half-typed box holds
   * `""` exactly as an empty one does, so nothing in `planning` can tell them
   * apart (`isIncompleteDateEntry`).
   */
  const startDateRef = useRef<HTMLInputElement>(null);
  const dueDateRef = useRef<HTMLInputElement>(null);
  /**
   * The first box the browser cannot read a day out of — named as well as
   * handed over. The element is where focus goes; the field name is what marks
   * that one box `aria-invalid` and describes it by the sentence, which the
   * panel cannot do because there the entry is already gone and the box holds a
   * stored value that is perfectly valid.
   */
  const incompleteDateEntry = (): { field: PlanningDateField; box: HTMLInputElement } | null => {
    const start = startDateRef.current;
    if (start && isIncompleteDateEntry(start)) return { field: "startDate", box: start };
    const due = dueDateRef.current;
    if (due && isIncompleteDateEntry(due)) return { field: "dueDate", box: due };
    return null;
  };
  const draftOf = (field: keyof PlanningDrafts) => (value: string) =>
    setPlanning((current) => ({ ...current, [field]: value }));
  /**
   * Which date boxes hold an entry the browser has not made a date of yet
   * (`validity.badInput`). A half-typed box is text-work like any other — the
   * reader has typed into it and `Esc` must not throw it away (§4.11) — but
   * its draft is `""`, exactly as an empty box's is, so nothing in `planning`
   * can say so, and React's `onChange` does not fire for it. Read from the
   * control on `keyup` and `input`, the two events `relaxDates` already reads
   * the same fault on, and returned as is when nothing changed so a keystroke
   * inside a box that is still half typed renders nothing.
   */
  const [halfTyped, setHalfTyped] = useState({ startDate: false, dueDate: false });
  const readHalfTyped = () => {
    const next = {
      startDate: startDateRef.current ? isIncompleteDateEntry(startDateRef.current) : false,
      dueDate: dueDateRef.current ? isIncompleteDateEntry(dueDateRef.current) : false,
    };
    setHalfTyped((current) => (current.startDate === next.startDate && current.dueDate === next.dueDate ? current : next));
  };

  const createIssue = useMutation({
    mutationFn: (type: IssueTypeCode) =>
      taskaApi.createIssue(projectId, { issueType: type, priority, summary, description, ...planningInput(planning) }),
    // The panel's rule, on this form's one write: the slot holds a single line,
    // so a date refusal must not caption the answer to a create, and a create
    // that is refused must not be silent behind one (TAS-231, art-director).
    onMutate: clearDateNotice,
    onError: clearDateNotice,
    onSuccess: async (issue) => {
      await invalidateBoard(queryClient, projectId);
      onCreated(issue);
    },
  });

  /**
   * Take the slot, and drop a refused create as it goes — the panel's
   * `refuseDate`, for the same reason. Without the reset, the server's refusal
   * of an earlier attempt would be waiting behind this line and would come back
   * the moment the dates are legible again: an error re-announced with no
   * attempt behind it, which is a ghost rather than a record.
   */
  const refuseDate = (field: PlanningDateField, { announceAgain = false }: { announceAgain?: boolean } = {}) => {
    if (createIssue.isError) createIssue.reset();
    // A fresh `seq` remounts the line so that the same sentence twice over is
    // still a change to the live region — see the panel's state comment — and
    // it is spent only on a refusal that is *news*. `checkDates` re-judges both
    // boxes whenever either is left, so tabbing start → due → start with one of
    // them half typed used to bump the count on every exit, including the exits
    // from the box that is fine: art-director's MutationObserver counted three
    // inserted nodes for one unchanged fault, which is one sentence read out
    // three times. The panel never had this, because there the refusal only
    // fires on the box at fault (TAS-231).
    //
    // Returning `current` untouched is a React bail-out, so an unchanged
    // refusal also moves nothing — and this slot sits above the action row,
    // where movement is a thing the reader's pointer can feel (`checkDates`).
    // `marked` is in that condition for the same reason it exists: a box that
    // was fixed and then broken again is at fault afresh, and the mark it shed
    // on the way back (`relaxDates`) has to come back with it.
    //
    // **`announceAgain` is the submit path opting out of the bail-out**, and
    // it is not a nicety. This used to say a repeat submit was heard anyway
    // "because it moves focus into that box" — but `incomplete.box.focus()` is
    // a no-op when focus is already there, and after the first refusal it is,
    // put there by that very line. Measured on all three viewports: Enter in a
    // half-typed start box inserted one node into the live region and moved
    // focus; the second Enter inserted none and moved nothing, so a reader who
    // cannot see the line got no answer at all to a button they had pressed
    // (release-reviewer, TAS-231) — this story's own bug class, one surface
    // further in. Announcing unconditionally is safe here and nowhere else:
    // the sentence is identical, so the node is the same height and the row
    // does not move, and submit runs on `click`, after `mouseup`, so there is
    // no press in flight for it to move out from under.
    //
    // The bail-out compares `field` alone, which is sound only because
    // `PLANNING_DATE_INCOMPLETE_CREATE_MESSAGE` is a constant: on this surface
    // the same field always means the same sentence. If this form's message is
    // ever parameterised by field the way the panel's is, the comparison has
    // to take the text in too, or a changed sentence would be swallowed by a
    // bail-out that only ever looked at which box it was about (art-director,
    // TAS-231).
    setDateNotice((current) =>
      !announceAgain && current?.field === field && current.marked ? current : { field, seq: (current?.seq ?? 0) + 1, marked: true },
    );
  };

  /**
   * Leaving a date box can put the line up. It can never take it down, and that
   * asymmetry is the whole of this function.
   *
   * Blur arrives on **mousedown**, one event ahead of the `click` it belongs to.
   * This slot sits directly above `.modal-actions`, so a blur that empties it
   * lifts both buttons out from under the pointer between the press and the
   * release — 46.4px at 1440 and 63.8px at 390, against a 34px button — and the
   * `click` never happens. The press that is lost that way is exactly the
   * corrective one: the reader finishes the date this line asked them to finish,
   * presses "Create issue", and nothing is created and nothing is said. That is
   * the dead button this story exists to remove, handed back one interaction
   * later on the recovery path, and "Cancel" went the same way
   * (release-reviewer, TAS-231).
   *
   * So the line is dropped only where no press is waiting on it: when a create
   * starts and when one fails (`onMutate`, `onError` — the second because a
   * refused create has to be able to take the slot back), when submit has
   * re-judged both boxes and found nothing left to refuse, and — `relaxDates`
   * below — on a keystroke, which is the one moment the reader's hands are
   * provably inside the date control rather than on their way to a button.
   *
   * What this does **not** buy, because the measurement cuts both ways: the
   * line's *appearance* moves that row too, so the first press after a
   * half-typed date is still swallowed. The difference is what the reader is
   * left with. There they get the sentence that accounts for the press, which
   * is the point of the story; here they would get silence, which is the bug.
   *
   * Both boxes are re-judged whenever either is left, rather than only the one
   * being left: a reader who fixes the start date while the due date is still
   * half typed has not fixed the form. The `else` is the mark and not the
   * sentence: if a box was emptied by some route that fires neither a keystroke
   * nor an `input` — none was reachable when this was measured, but `marked` is
   * a claim about the DOM and it costs one comparison to keep it exactly true
   * at every event this form already handles — the line may stand, and it will
   * stand over no marked box rather than over a box that is fine.
   */
  const checkDates = () => {
    // Nothing to refuse on a form that can no longer create — and a refusal
    // here would `reset()` the refused create whose sentence is on screen.
    if (archived) return;
    const incomplete = incompleteDateEntry();
    if (incomplete) refuseDate(incomplete.field);
    else unmarkDate();
  };

  /**
   * Typing lowers the line and never raises it — the exact mirror of
   * `checkDates`, and the other half of a rule that would be a bug on its own.
   *
   * Blur alone left a refusal standing over a field that had stopped being
   * wrong. Nothing but submit, `onMutate` or `onError` took it down, so the
   * sentence "finish it, or clear it" survived the reader doing precisely
   * that: art-director cleared the box — `badInput false`, `value ""`, both
   * dates empty, the form pristine — moved focus away, waited, and the red line
   * and `aria-invalid="true"` were still there. A stale *imperative*, in
   * `--danger`, 8px under the evidence it had been obeyed (DESIGN.md §1.4).
   *
   * Both handlers are needed, and this is the part that is not guessable, so it
   * was measured on a live date box rather than reasoned about — one keystroke
   * per line, `type|value|badInput`:
   *
   * ```
   * keyup||true            ← half typed; input/change never fire, value stays ""
   * keyup||true
   * input|0002-09-12|false ← the keystroke that completes it
   * change|0002-09-12|false
   * keyup|0002-09-12|false
   * ```
   *
   * `input` and `change` never fire while `badInput` is true, so `onChange`
   * alone cannot see a box being emptied back to nothing — which is exactly the
   * route in art-director's report. `keyup` fires on every keystroke including
   * Backspace and carries the live `badInput`, so it is required rather than
   * belt-and-braces. `onChange` is required too, for every route that replaces
   * the value without a keystroke — the browser's own calendar popup above all,
   * which fires `input` and no `keyup` (art-director's model; the native picker
   * is browser chrome and cannot be driven from a headless run, so that leg is
   * carried rather than re-measured here).
   *
   * Safe to lower here, where `checkDates` is not, because neither `input` nor
   * `keyup` can fire between `mousedown` and `mouseup` on `.modal-actions` —
   * only `blur` can. The row moves up on the keystroke that makes the date
   * legible — measured across that one keystroke, with focus never leaving the
   * box: 47.0px at 1920, 46.9px at 1440, 64.2px at 390 — so it moves with the
   * reader's hands still in the date control and their eyes on it. That is an
   * acknowledgement of the keystroke, not a button stepping aside from a press
   * already in flight.
   */
  const relaxDates = () => {
    if (!dateNotice) return;
    const incomplete = incompleteDateEntry();
    // The sentence goes only when there is nothing left on the form to refuse.
    if (!incomplete) {
      clearDateNotice();
      return;
    }
    // Something is still half typed, so the line stays — but if it is the
    // *other* box, this one has stopped being the one at fault and must stop
    // carrying the mark for it. Left in, that mark is the wrong-box case of
    // art-director's finding: start fixed and still `aria-invalid="true"`,
    // due half typed and bare.
    const marked = incomplete.field === dateNotice.field;
    if (marked !== dateNotice.marked) setDateNotice({ ...dateNotice, marked });
  };

  const badge = keyBadgeStyle(projectKey, projectColor);
  /**
   * One slot and one sentence, held by whichever refusal is newest — the
   * panel's rule, the same mechanism, and the same one-tick reason for asking
   * the date line first. The line is dropped when a create starts and if it
   * fails, and a refused create is dropped when the line takes the slot, so
   * neither is ever left standing over the other.
   *
   * Archived, the date line is not shown: it asks the reader to finish or
   * clear a box that can no longer be typed in, and there is no create left
   * for it to stand in front of.
   */
  const formNotice =
    dateNotice && !archived
      ? PLANNING_DATE_INCOMPLETE_CREATE_MESSAGE
      : createIssue.isError
        ? (refusalWords(createIssue.error) ?? createIssue.error.message)
        : null;
  /**
   * The slot holds this form's `PROJECT_ARCHIVED` refusal, which says what the
   * archive line would (§5.7): it stands in for the line and is where focus
   * goes. A refusal of any other kind leaves the line under it. The date line
   * is never shown once archived, so whenever the create's error is this, the
   * slot is showing it.
   */
  const archiveRefused = isProjectArchived(createIssue.error) && !(dateNotice && !archived);

  /** Text-work holds `Esc` (§4.11): a box with something typed in it, archived to `readOnly` or not. */
  const unsavedText = (value: string) => (value !== "" ? "true" : undefined);

  return (
    <Modal
      busy={createIssue.isPending}
      title={statusName ? `New issue in ${statusName}` : "New issue"}
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
        // The form answers for its own dates — see `dateNotice` above for what
        // the browser did with them instead, and why that read as a dead
        // button. This is the whole of what `noValidate` turns off here: no
        // field on this form carries `required`, a `pattern`, a `min`, a `max`
        // or a `type` the browser validates the text of, so the one constraint
        // it was enforcing is the two date boxes' `badInput` — the fault this
        // component now answers for itself.
        //
        // What it buys is narrower than it looks, and was measured rather than
        // reasoned: release-reviewer took the attribute off and all 48 cases in
        // e2e/planning-fields.spec.ts stayed green, because the blur path puts
        // the sentence up either way. What it removes is the *second* account
        // of one fault — a tooltip the browser draws itself, in the browser's
        // language, beside a box the reader may have scrolled past — and the
        // silent refusal to fire `submit` that made this button read as dead
        // before the line existed.
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          // No Create issue once archived, and Enter in a field is the one
          // way left to ask for it.
          if (archived) return;
          // Before the summary check, because this is the refusal the reader
          // cannot otherwise account for: an empty summary disables the button
          // they just pressed, and a half-typed date does not.
          const incomplete = incompleteDateEntry();
          if (incomplete) {
            // `announceAgain`, because a press is a press: the second identical
            // submit has to be answered as loudly as the first, and the focus
            // move below cannot do it twice — see `refuseDate`.
            refuseDate(incomplete.field, { announceAgain: true });
            // Said *and* pointed at. The sentence says "that date" and the form
            // has two, and a reader on the keyboard — who reached the button
            // without passing the date again — would otherwise have to hunt for
            // which. Focus is the part of this that survives without sight; the
            // `aria-invalid` and `aria-describedby` the refusal puts on that
            // same box are what make the sentence findable once focus is there.
            // It carries the *first* refusal and only the first — on a repeat
            // it lands where focus already is and does nothing at all.
            incomplete.box.focus();
            return;
          }
          clearDateNotice();
          if (summary.trim() && issueType && !noTypeHasStatus) createIssue.mutate(issueType);
        }}
      >
        {/* Every box `readOnly` once archived: the reader's words stay, legible
            and copyable, and nothing invites more (§4.3, §5.7). */}
        <label className="field">
          <span>Summary</span>
          <input
            autoFocus
            data-unsaved-text={unsavedText(summary)}
            onChange={(event) => setSummary(event.target.value)}
            readOnly={archived}
            value={summary}
          />
        </label>
        <label className="field">
          <span>Description</span>
          <textarea
            data-unsaved-text={unsavedText(description)}
            onChange={(event) => setDescription(event.target.value)}
            readOnly={archived}
            rows={4}
            value={description}
          />
        </label>
        <div className={`form-two ${stackPickers ? "is-stacked" : ""}`}>
          <label>
            <span>Type</span>
            {issueTypes.length && issueType ? (
              // §5.5 (TAS-417): the panel's select, at 30, with the chosen
              // type's tile inside the field.
              <span className="type-select">
                <TypeChip registry={issueTypes} type={issueType} />
                <select
                  // §4.1's steadily-unavailable `aria-disabled` once archived:
                  // the choice stays legible and reachable, a change does nothing.
                  aria-disabled={archived || undefined}
                  onChange={(event) => {
                    if (!archived) setIssueType(event.target.value);
                  }}
                  value={issueType}
                >
                  {issueTypes.map((entry) =>
                    lacksStatus(entry.code) ? (
                      <option disabled key={entry.code} value={entry.code}>
                        {`${issueTypeLabel(entry.code, issueTypes)} — no ${statusName} status`}
                      </option>
                    ) : (
                      <option key={entry.code} value={entry.code}>
                        {issueTypeLabel(entry.code, issueTypes)}
                      </option>
                    ),
                  )}
                </select>
              </span>
            ) : (
              <p className="muted-label">This project allows no issue types.</p>
            )}
          </label>
          <label>
            <span>Priority</span>
            <div className="segmented compact">
              {offeredPriorities.map((item) => (
                <button
                  aria-disabled={archived || undefined}
                  aria-pressed={priority === item}
                  className={priority === item ? "is-active" : ""}
                  key={item}
                  onClick={() => {
                    if (!archived) setPriority(item);
                  }}
                  type="button"
                >
                  {priorityLabel(item, meta?.priorities)}
                </button>
              ))}
            </div>
          </label>
        </div>
        {/* A `fieldset` because that is what a named group of related fields is
            in HTML, and a `legend` is the only label a screen reader reads as
            the group's own. Same five fields, same order and same parsing as
            the panel (the helpers are shared), so what a reader learns on one
            surface holds on the other. All optional: an empty box is omitted
            from the request rather than sent as a zero. */}
        <fieldset className="planning-fieldset">
          <legend>Planning</legend>
          {/* Same two rows as the panel, and they fit: at 390 the modal's body
              leaves 326, so a third of it is 100 — wider than the 96 the
              shortest of these boxes needs, and the dates keep the half-width
              row of their own that a date control was measured to need. */}
          <div className="planning-grid">
            <div className="planning-row is-three">
              <label className="field">
                <span>Story points</span>
                <input
                  data-unsaved-text={unsavedText(planning.storyPoints)}
                  inputMode="decimal"
                  onChange={(event) => draftOf("storyPoints")(event.target.value)}
                  placeholder={PLANNING_EMPTY_PLACEHOLDER}
                  readOnly={archived}
                  type="text"
                  value={planning.storyPoints}
                />
              </label>
              {/* The two estimates take the panel's structure rather than this
                  form's wrapping `<label>`: the hint under the box has to be
                  described-by, not part of the field's name. */}
              <div className="field">
                <label htmlFor={`${planningId}-original-estimate`}>Original estimate</label>
                <input
                  aria-describedby={`${planningId}-original-estimate-hint`}
                  data-unsaved-text={unsavedText(planning.originalEstimateMinutes)}
                  id={`${planningId}-original-estimate`}
                  onChange={(event) => draftOf("originalEstimateMinutes")(event.target.value)}
                  placeholder={PLANNING_EMPTY_PLACEHOLDER}
                  readOnly={archived}
                  type="text"
                  value={planning.originalEstimateMinutes}
                />
                <p className="planning-hint" id={`${planningId}-original-estimate-hint`}>
                  {PLANNING_ESTIMATE_HINT}
                </p>
              </div>
              <div className="field">
                <label htmlFor={`${planningId}-remaining-estimate`}>Remaining estimate</label>
                <input
                  aria-describedby={`${planningId}-remaining-estimate-hint`}
                  data-unsaved-text={unsavedText(planning.remainingEstimateMinutes)}
                  id={`${planningId}-remaining-estimate`}
                  onChange={(event) => draftOf("remainingEstimateMinutes")(event.target.value)}
                  placeholder={PLANNING_EMPTY_PLACEHOLDER}
                  readOnly={archived}
                  type="text"
                  value={planning.remainingEstimateMinutes}
                />
                <p className="planning-hint" id={`${planningId}-remaining-estimate-hint`}>
                  {PLANNING_ESTIMATE_HINT}
                </p>
              </div>
            </div>
            <div className="planning-row">
              <label className="field">
                <span>Start date</span>
                {/* As on the panel: an empty date box draws the browser's own
                    mask, and `data-empty` is what lets it be set in `--fg-3`
                    instead of reading as a date somebody picked. */}
                <input
                  // Marked and described only while this box is the one the
                  // browser cannot read — which is a thing this surface can say
                  // and the panel cannot, because there the same box has
                  // already been put back to a stored value that is perfectly
                  // valid and marking it would be a false statement.
                  //
                  // "While" is measured and not assumed, because the mark and
                  // the sentence come down at different moments. The sentence
                  // is held up until a keystroke leaves both boxes legible
                  // (`relaxDates`); the mark goes as soon as *this* box is
                  // legible, even with the other one still half typed, because
                  // an attribute moves nothing and can be withdrawn at any
                  // moment. Measured after that fix, on the route art-director
                  // reported: half-type start → blur → fix start with due still
                  // half typed leaves start at `badInput false` and
                  // `aria-invalid null`, the line standing and pointing at no
                  // box, until the next blur re-judges and puts it on due.
                  // Before it, that same route left start marked and due — the
                  // box actually at fault — bare.
                  aria-describedby={markedDate === "startDate" ? noticeId : undefined}
                  aria-invalid={markedDate === "startDate" ? true : undefined}
                  data-empty={planning.startDate === ""}
                  data-unsaved-text={unsavedText(planning.startDate) ?? (halfTyped.startDate ? "true" : undefined)}
                  // On blur as well as on submit, so the reader hears about it
                  // at the moment the panel would have told them — when they
                  // leave the box — rather than only once they have pressed a
                  // button that then refuses. `onChange` cannot stand in for
                  // it: a date box fires no `input` event while its value is
                  // still unreadable, which is exactly the state being judged.
                  onBlur={checkDates}
                  onChange={(event) => {
                    draftOf("startDate")(event.target.value);
                    relaxDates();
                    readHalfTyped();
                  }}
                  // Both, and `relaxDates` says why: `keyup` is the only one of
                  // the two that fires while the entry is unreadable, and
                  // `input` is the only one the calendar popup fires at all.
                  onKeyUp={() => {
                    relaxDates();
                    readHalfTyped();
                  }}
                  readOnly={archived}
                  ref={startDateRef}
                  type="date"
                  value={planning.startDate}
                />
              </label>
              <label className="field">
                <span>Due date</span>
                <input
                  aria-describedby={markedDate === "dueDate" ? noticeId : undefined}
                  aria-invalid={markedDate === "dueDate" ? true : undefined}
                  data-empty={planning.dueDate === ""}
                  data-unsaved-text={unsavedText(planning.dueDate) ?? (halfTyped.dueDate ? "true" : undefined)}
                  onBlur={checkDates}
                  onChange={(event) => {
                    draftOf("dueDate")(event.target.value);
                    relaxDates();
                    readHalfTyped();
                  }}
                  onKeyUp={() => {
                    relaxDates();
                    readHalfTyped();
                  }}
                  readOnly={archived}
                  ref={dueDateRef}
                  type="date"
                  value={planning.dueDate}
                />
              </label>
            </div>
          </div>
        </fieldset>
        {/* The `key` is the date refusal's sequence number, so the same
            sentence twice over remounts this node rather than re-rendering
            identical text: a live region that emits no mutation announces
            nothing, and the second refusal would be as silent as the bug this
            story removes. The `id` is what the offending date box describes
            itself by — the sentence's, so the description is the sentence. */}
        {formNotice ? (
          <ErrorNote
            // Where focus goes when the archive this refused create brought
            // takes Create issue away from under it (§5.7) — this refusal only.
            archiveNote={archiveRefused}
            id={noticeId}
            key={dateNotice && !archived ? dateNotice.seq : "write"}
            live="alert"
            // The create's refusal only: the date line is this form's own check
            // and has no id (§5.6, TAS-397). Outside the alert, under it.
            requestId={dateNotice && !archived ? null : apiErrorFacts(createIssue.error).requestId}
          >
            {formNotice}
          </ErrorNote>
        ) : null}
        {archived && !archiveRefused ? (
          // Above the footer, and under a refusal of another kind if one is
          // on screen; not while this form's `PROJECT_ARCHIVED` refusal is —
          // then that one says it (§5.7, one fact, one place).
          <p className="modal-archive-note" data-archive-note="modal" tabIndex={-1}>
            This project is archived, so issues cannot be created in it.
          </p>
        ) : null}
        {noTypeHasStatus && !archived ? (
          <p className="modal-unavailable-note">{`No issue type in this project has a ${statusName} status.`}</p>
        ) : null}
        <div className="modal-actions">
          <button className="secondary-button" onClick={onClose} type="button">
            Cancel
          </button>
          {archived ? null : noTypeHasStatus ? (
            // §4.1's "steadily unavailable": reachable, dimmed, and a press
            // does nothing — the line above says why.
            <button aria-disabled="true" className="primary-button is-unavailable" type="button">
              Create issue
            </button>
          ) : (
            <button className="primary-button" disabled={!summary.trim() || !issueType || createIssue.isPending} type="submit">
              Create issue
            </button>
          )}
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
          // Straight off the member row, which declares it inline
          // (`ProjectMemberDetailsDto.avatar`, docs/contract/openapi.yml) — so
          // every face this map draws costs nothing beyond the one member read
          // the board already makes. The server fills it since TAS-225 (see
          // `User.avatarUrl`), and the reader's own new face shows through the
          // profile menu's cache write before the next member refetch brings
          // it. Nothing here ever asks
          // `GET /users/{userId}/avatar`, which would be one request per person
          // on the board.
          avatarUrl: member.user!.avatarUrl,
        },
      ]),
  );
}

/** What names a code in the activity feed beyond the build's own words (TAS-173). */
interface HistoryNames {
  statuses?: readonly WorkflowStatus[];
  priorities?: readonly DictionaryEntry[] | null;
}

function historyText(
  event: IssueHistoryEvent,
  userById: Map<string, Pick<User, "id" | "displayName" | "color" | "avatarUrl">>,
  names: HistoryNames = {},
) {
  if (event.eventType === "CREATED") return "created this issue";
  if (event.eventType === "TRANSITIONED") {
    const fromStatus = event.payload.from ?? event.payload.fromStatus;
    const toStatus = event.payload.to ?? event.payload.toStatus;
    // A key this build has no word for is printed as it came — "moved
    // BLOCKED_BY_QA to Done" — never dropped and never indexed (TAS-173).
    const from = typeof fromStatus === "string" && fromStatus ? statusLabel(fromStatus, names.statuses) : "another status";
    const to = typeof toStatus === "string" && toStatus ? statusLabel(toStatus, names.statuses) : "another status";
    return `moved ${from} to ${to}`;
  }
  if (event.eventType === "ASSIGNED") {
    const assigneeId = event.payload.to ?? event.payload.assigneeId;
    if (!assigneeId || typeof assigneeId !== "string") return "cleared the assignee";
    return `assigned ${userById.get(assigneeId)?.displayName ?? "someone"}`;
  }
  if (event.eventType === "PRIORITY") {
    const to = event.payload.to;
    return typeof to === "string" && to ? `set priority to ${priorityLabel(to, names.priorities)}` : "changed the priority";
  }
  if (event.eventType === "UPDATED" && typeof event.payload.newPriority === "string" && event.payload.newPriority) {
    return `set priority to ${priorityLabel(event.payload.newPriority, names.priorities)}`;
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
  // `worklogSpentMinutes` is in the added and updated payloads
  // (`PayloadSerializer.createWorklogPayload`, backend PR #178); the deleted
  // one carries only ids.
  if (event.eventType === "WORKLOG_ADDED") {
    const minutes = event.payload.worklogSpentMinutes;
    return typeof minutes === "number" && minutes > 0 ? `logged ${formatDuration(minutes)}` : "logged work";
  }
  if (event.eventType === "WORKLOG_UPDATED") return "edited a work log entry";
  if (event.eventType === "WORKLOG_DELETED") return "deleted a work log entry";
  return "updated this issue";
}

function resolveTransitions(
  fromStatus: IssueStatusKey,
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
  fromStatus: IssueStatusKey,
  toStatus: IssueStatusKey,
  statuses: WorkflowStatus[],
  transitions: WorkflowTransition[],
) {
  return resolveTransitions(fromStatus, statuses, transitions).find((transition) => transition.toStatus === toStatus);
}

/**
 * A workflow the context sent present but empty: its `id`, `name` and
 * `version` filled, its `statuses` list empty. Measured on the stand on
 * 2026-10-15 for every issue type (backend TAS-261: project-service's mapper
 * drops the repeated fields), while the same workflow read on its own route
 * has three statuses and three transitions.
 *
 * With no statuses no transition can be resolved, so the board has nothing to
 * offer — but an empty transition row reads as "this issue has nowhere to
 * go", and "no transition from X to Y" as a fact about the workflow; neither
 * is what the server said. The drop and the panel both read this one
 * predicate, so they refuse together and in the same words. Nothing fills the
 * gap: no read of the per-type route, no synthesised transition (AGENTS.md,
 * "No compensations for the backend").
 */
function sentWithoutStatuses(workflow: ProjectWorkflow) {
  return workflow.statuses.length === 0;
}

/**
 * The columns predicted from the context, for the skeleton and for a board
 * read that failed (§4.9) — never for placing a card. The server's own rule
 * (`BoardServiceImpl.mergeStatusesByKey`): every status of every workflow, the
 * first type to state a key winning, walked in the order the board offers the
 * types (`allowedIssueTypes`, the registry's order since backend #226), then
 * sorted stably by `sortOrder`. A type this build has no name for is walked
 * too (TAS-173); where the board read differs, its answer replaces this once,
 * like "3 → N" in §5.2.
 */
function predictColumns(workflows: WorkflowsByIssueType | undefined, issueTypes: readonly IssueTypeCode[]): ColumnStatus[] {
  if (!workflows) return fallbackStatuses;

  const statusByKey = new Map<string, WorkflowStatus>();
  issueTypes.forEach((issueType) => {
    workflowFor(workflows, issueType)?.statuses.forEach((status) => {
      if (!statusByKey.has(status.statusKey)) statusByKey.set(status.statusKey, status);
    });
  });

  // A project that allows no issue type sends no workflow at all.
  if (statusByKey.size === 0) return fallbackStatuses;
  return [...statusByKey.values()].sort((a, b) => a.sortOrder - b.sortOrder);
}

/** One drop on the board: the card, its key for the refusal's sentence, where it goes and by which transition. */
interface BoardMove {
  movedIssueId: string;
  issueKey: string;
  nextStatus: IssueStatusKey;
  transitionId: string;
}

/**
 * The version a board move sends as `If-Match` (TAS-422): the newest the
 * reader's screen holds for the issue — its card in any of the board's cached
 * reads, or the open panel's issue. Both are server answers; neither is ever
 * invented. `undefined` only for an issue no cache holds a version of, which
 * then moves without the header.
 */
function latestKnownVersion(
  queryClient: ReturnType<typeof useQueryClient>,
  projectId: string,
  issueId: string,
): number | undefined {
  const versions: number[] = [];
  for (const [, board] of queryClient.getQueriesData<Board>({ queryKey: boardKey(projectId) })) {
    if (!board) continue;
    for (const card of [...board.columns.flatMap((column) => column.issues), ...board.unplacedIssues]) {
      if (card.id === issueId && typeof card.version === "number") versions.push(card.version);
    }
  }
  const panel = queryClient.getQueryData<{ issue?: { version?: unknown } }>(["issue", projectId, issueId])?.issue?.version;
  if (typeof panel === "number") versions.push(panel);
  return versions.length ? Math.max(...versions) : undefined;
}

/**
 * The queue the issue panel's writes share (TAS-246) — react-query runs the
 * mutations of one `scope` one after another. Every edit and transition of one
 * issue goes through it, because each bumps the version the next one has to
 * send.
 */
const issueWriteScope = (issueId: string) => `issue-write:${issueId}`;

/**
 * One edit of the panel's issue: the field it sends, and how many version
 * conflicts the panel had shown when the reader made it — see `conflictEpoch`.
 */
interface IssueEdit {
  patch: UpdateIssueInput;
  epoch: number;
}

/** The two fields a conflict leaves the reader's own words in, rather than the server's value. */
type FreeTextField = "summary" | "description";
const isFreeTextField = (field: keyof UpdateIssueInput | "status"): field is FreeTextField =>
  field === "summary" || field === "description";

/**
 * One transition of the panel's issue (TAS-422): which, and how many version
 * conflicts the panel had shown when the reader chose it — see `conflictEpoch`.
 */
interface IssueTransitionWrite {
  transitionId: string;
  epoch: number;
}

/** A transition chosen before the latest conflict landed: refused here, never sent (`conflictEpoch`). */
class UnsentTransition extends Error {
  constructor() {
    super("This move was chosen before the issue changed elsewhere, so it was not sent.");
  }
}

/** What a conflict line can be about: a field an edit sends, or the status a transition moves (TAS-422). */
type ConflictField = keyof UpdateIssueInput | "status";

/** What the panel's conflict line is about — see the `conflict` state in `IssuePanel`. */
interface IssueConflict {
  fields: ConflictField[];
  /** The refusal that found the conflict: an edit's 409, or a transition's `ABORTED`. */
  error: Error;
  seq: number;
}

/**
 * A conflict line as it stands once another write starts: the choices go — the
 * panel already shows them as they now are, and the reader has acted since —
 * and free text stays unless `sent` carries it again. The same object when
 * nothing changes, so a write that starts re-renders nothing here.
 */
function keepUnsentText(conflict: IssueConflict | null, sent: UpdateIssueInput): IssueConflict | null {
  if (!conflict) return conflict;
  const fields = conflict.fields.filter((field) => isFreeTextField(field) && !(field in sent));
  if (fields.length === conflict.fields.length) return conflict;
  return fields.length ? { ...conflict, fields } : null;
}

/**
 * What the conflict sentence calls each field a write can carry, in the
 * panel's order — the status first, above everything else (TAS-422).
 */
const issueFieldNames: Record<ConflictField, string> = {
  status: "status",
  summary: "summary",
  description: "description",
  issueType: "type",
  priority: "priority",
  assigneeId: "assignee",
  storyPoints: "story points",
  startDate: "start date",
  dueDate: "due date",
  originalEstimateMinutes: "original estimate",
  remainingEstimateMinutes: "remaining estimate",
};

/** "a", "a and b", "a, b and c". */
function joinWithAnd(words: string[]): string {
  return words.length < 2 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/**
 * What the panel says when a write is refused because the issue changed after
 * the reader opened it (TAS-246). Two outcomes, worded differently because
 * they are not the same: a choice — a priority, an assignee, a planning value
 * — is simply not made, and the panel already shows the issue as it now is;
 * free text is the reader's work, kept in its box, and saved by leaving the box
 * again.
 *
 * The panel writes one field at a time, so `fields` is usually one. It is more
 * when an edit was made before a conflict landed and is refused without being
 * sent (`conflictEpoch`), or when text an earlier conflict left unsaved is
 * still in its box — and then one sentence names them all, in the panel's
 * order, because the slot holds one sentence.
 */
function issueConflictText(fields: ConflictField[]): string {
  const stale = "this issue was changed elsewhere after you opened it.";
  const named = (Object.keys(issueFieldNames) as ConflictField[]).filter((field) => fields.includes(field));
  const texts = named.filter(isFreeTextField);
  const choices = named.filter((field) => !isFreeTextField(field)).map((field) => `the ${issueFieldNames[field]}`);
  const change = `change${choices.length > 1 ? "s" : ""} to ${joinWithAnd(choices.length ? choices : ["the issue"])}`;
  const subject = !texts.length
    ? `Your ${change}`
    : choices.length
      ? `Your ${change} and your ${joinWithAnd(texts)}`
      : `Your ${joinWithAnd(texts)}`;
  const verb = choices.length + texts.length > 1 ? "were" : "was";
  const kept = `still in ${texts.length > 1 ? "both boxes — leave each box" : "the box — leave the box"} to save it over the latest version.`;
  const tail = !texts.length
    ? "The panel now shows the latest version."
    : choices.length
      ? `The panel now shows the latest version, and your text is ${kept}`
      : `Your text is ${kept}`;
  return `${subject} ${verb} not saved: ${stale} ${tail}`;
}

/**
 * A refused write in the panel's words where it has some, and the server's
 * where it does not. The one rewrite is the date order: the server answers a
 * date that, laid over the other stored date, would put the start after the
 * due date with a sentence that is true and says nothing about what to do, and
 * the panel — which saves one box at a time — knows which box to move first.
 *
 * A version conflict is the panel's sentence too, never the error's own
 * message ("Version conflict: sent 4, the issue is at 7" is for a log, not a
 * reader). The panel reads conflicts off its `conflict` state and not through
 * here, so this is the guard for whatever reads a write's error next.
 */
function writeFailureText(error: Error, sent: UpdateIssueInput | undefined): string {
  // An archive that landed while the panel was open (§5.7): our sentence in
  // place of the server's, the request id beside it as usual.
  if (isProjectArchived(error)) return PROJECT_ARCHIVED_SENTENCE;
  if (isIssueVersionConflict(error)) return issueConflictText(sent ? (Object.keys(sent) as (keyof UpdateIssueInput)[]) : []);
  if (sent && isDatesOutOfOrderRefusal(error)) {
    if (sent.startDate !== undefined && sent.dueDate === undefined) return planningDateOrderAdvice("startDate");
    if (sent.dueDate !== undefined && sent.startDate === undefined) return planningDateOrderAdvice("dueDate");
  }
  return error.message;
}

async function invalidateBoard(queryClient: ReturnType<typeof useQueryClient>, projectId: string) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: boardKey(projectId) }),
    // Every issue read of the project, the open one among them. Since TAS-246
    // an issue read carries its links, and a link row prints the other end's
    // key, summary and status (`LinkedIssue`) — so an edit or a move of one
    // issue changes what every issue linked to it shows, and their reads go
    // stale with it. (Deleting an issue does not come through here; see
    // `deleteIssue` in the panel.)
    //
    // The prefix alone, and never beside the issue's own key: the prefix
    // already matches the open panel's read, so naming that key as well
    // invalidates it twice in one settle, and the second refetch cancels the
    // first after its request has left (`getIssue` takes no signal) — two
    // identical reads per write, measured on the stand on 2026-10-07 and
    // pinned in IssuePanelRequests.test.tsx.
    queryClient.invalidateQueries({ queryKey: ["issue", projectId] }),
    queryClient.invalidateQueries({ queryKey: ["notifications"] }),
    // The top bar's search (`GlobalSearch`), whose key has no `projectId` in
    // it and whose hits a write in any project can change. Only re-read while
    // it is open; the board itself has no search layer since TAS-202.
    queryClient.invalidateQueries({ queryKey: ["issue-search"] }),
  ]);
}
