import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { TaskaApi } from "../api/TaskaApi";
import type { IssueComment, IssueHistoryEvent, Notification } from "../domain/types";
import { BoardScreen } from "./BoardScreen";
import { ATTACHMENT_MAX_SIZE_BYTES } from "../api/attachments";
import { ObjectStoreError } from "../api/objectStore";
import { tabbables } from "../lib/focusTrap";
import { PLANNING_ESTIMATE_HINT } from "../lib/planning";

/**
 * The board reads five things and used to show a failure in only one of them.
 * When the project read and the membership read failed — which is exactly what
 * the live gateway did at the time, TAS-162 — the board still drew: the name fell
 * back to "Project", the key badge vanished, every write control went disabled
 * and drag stopped working, and nothing on screen said why (TAS-163). These
 * tests are about the difference between a board that cannot be written to and
 * a board that will not say whether it can — and about the two ways the first
 * attempt at saying it got the answer wrong.
 */
const PROJECT_ID = "2e74e49f-0f29-4e03-b4ec-adc4dbf2382e";
/** Somewhere other than the open board, so a route built from the board's own id would be visibly wrong. */
const OTHER_PROJECT_ID = "9c3f7b18-6d21-4a55-8e0b-7f2a1d4c9e30";

const {
  fakeApi,
  seedMembers,
  seedAttachments,
  failAttachmentsRead,
  holdAttachmentsRead,
  seedDownloadUrl,
  failUpload,
  failBytes,
  bytesReads,
  uploadLog,
  confirmCalls,
  listedAttachments,
  deletedAttachments,
  seedComments,
  deletedComments,
  failCommentDelete,
  failDelete,
  failIssueDelete,
  holdDelete,
  releaseDelete,
  heldDeleteCount,
  seedNotifications,
  seedUnreadCount,
  readNotifications,
  failMarkRead,
  failMarkAll,
  holdNotificationWrites,
  releaseNotificationWrites,
  heldNotificationWriteCount,
  holdIssueUpdates,
  heldIssueUpdateCount,
  releaseIssueUpdates,
  updateCalls,
  conflictNextUpdate,
  failNextUpdate,
  seedIssueLabels,
  seedIssueVersion,
  emptyPartsOnRead,
  setMembership,
  seedArchivedAt,
  seedAssignee,
  assignCalls,
  failMembership,
  holdMembership,
  failProject,
  holdProject,
  failIssues,
  holdBoard,
  boardReads,
  holdTransition,
  settleTransition,
  heldTransitionCount,
  transitionCalls,
  seedBoardNames,
  failWorkflow,
  seedLabels,
  holdLabelCreate,
  failNextCreate,
  failMembers,
  holdMembers,
  memberReads,
  projectReads,
  seedWatchers,
  failWatchersRead,
  holdWatchersRead,
  failLabelsRead,
  failLinksRead,
  failCommentsRead,
  failWatcherWrite,
  holdWatcherWrites,
  releaseWatcherWrites,
  watcherCalls,
  setUnwatchAnswer,
  watchedUserIds,
  holdIssue,
  releaseIssue,
  heldIssueCount,
  failIssue,
  sectionReads,
  seedSummaries,
  seedWatcherNames,
  seedLinks,
  seedIssueTypes,
  seedContextWorkflowParts,
  seedHistory,
  seedMeta,
  seedExtraIssues,
  seedWorkflowsByType,
  metaReads,
  createCalls,
  reset,
} = vi.hoisted(() => {
  const now = "2026-08-01T09:00:00Z";

  /**
   * The five planning fields, as `Issue` declares them — `null` being the only
   * "not set" for all five. Spelled out in the fixtures below rather than left
   * off them: the fake is cast to `TaskaApi`, so an issue missing a field the
   * domain declares typechecks, renders, and tells nobody. `storyPoints: 3`
   * with a `null` remaining estimate is the pair the panel's Planning block is
   * asserted on, because `0`, `null` and "not sent" are three different
   * answers and only one of them is empty.
   */
  const planning = {
    storyPoints: null as number | null,
    startDate: null as string | null,
    dueDate: null as string | null,
    originalEstimateMinutes: null as number | null,
    remainingEstimateMinutes: null as number | null,
  };

  const makeIssue = (id: string, issueKey: string, summary: string, description: string) => ({
    id,
    projectId: PROJECT_ID,
    issueNumber: Number(issueKey.split("-")[1]),
    issueKey,
    issueType: "TASK" as const,
    summary,
    description,
    status: "TODO" as const,
    priority: "MEDIUM" as const,
    assigneeId: null,
    reporterId: "user-anna",
    createdAt: now,
    updatedAt: now,
    version: 1,
    deletedAt: null,
    labels: [] as { id: string; name: string; color: string }[],
    ...planning,
  });

  const state: {
    /** `role: null` is an answered read that named no role this build knows — not a failure, and not a VIEWER. */
    membership: { role: "ADMIN" | "MEMBER" | "VIEWER" | null; isMember: boolean; projectExists: boolean };
    /** `project.archivedAt` on the context read (backend PR #159, TAS-149). */
    archivedAt: string | null;
    membershipFailure?: Error;
    membershipHeld: boolean;
    projectFailure?: Error;
    projectHeld: boolean;
    /** The issue types the project allows — the types its context sends a workflow for. Any code (TAS-173). */
    issueTypes: string[];
    /**
     * The statuses and transitions the context's workflow carries, when a test
     * needs other than the default one status and no transition — an empty
     * pair is what the stand sent on 2026-10-15 (backend TAS-261).
     */
    contextWorkflowParts?: {
      statuses: { id: string; statusKey: string; name: string; category: string; sortOrder: number }[];
      transitions: { id: string; fromStatusId: string; toStatusId: string; name: string; sortOrder: number }[];
    };
    /** A workflow of its own for one type, where a test needs types to differ (TAS-173). */
    workflowsByType: Record<string, NonNullable<typeof state.contextWorkflowParts>>;
    /** What `GET /meta` answers (TAS-173): the dictionaries, or a failure. */
    meta: Record<string, { code: string; name: string; selectable?: boolean }[] | null> | Error;
    metaReads: number;
    /**
     * Issues beside the seeded one, carrying whatever type, status and
     * priority a test gives them — the panel reads them too (TAS-173).
     */
    extraIssues: ({ id: string; issueKey: string } & Record<string, unknown>)[];
    /** What every create asked for. */
    createCalls: Record<string, unknown>[];
    issuesFailure?: Error;
    /** Every board read that went out, answered or not. */
    boardReads: number;
    /** The board read held open: the window before it answers. */
    boardHeld: boolean;
    /**
     * The board's drop moves (`transitionIssue`): every one that was sent, and
     * the ones held open — the optimistic window is one tick long against a
     * fake that answers at once, and nothing can be asserted inside it.
     */
    transitionCalls: { issueId: string; transitionId: string }[];
    transitionHeld: boolean;
    transitionSettlers: { resolve: () => void; reject: (error: Error) => void }[];
    /**
     * The names the board read joins in, by user id (backend #205). An id not
     * here is an assignee the server could not name — `displayName: null`.
     */
    boardNames: Record<string, string>;
    workflowFailure?: Error;
    labels: { id: string; name: string; color: string }[];
    labelCreateHeld: boolean;
    /** The next issue or label create is refused with this error, and creates nothing. */
    createFailure?: Error;
    /** The notifications popover: what the bell lists, what it managed to mark read, and the two writes failing or waiting. */
    notifications: Notification[];
    /** The server's unread total when a test needs it to differ from the rows — it counts the whole inbox, not the page. */
    unreadCount?: number;
    readNotifications: string[];
    markReadFailure?: Error;
    markAllFailure?: Error;
    /** Both writes held open until the test says so: an optimistic change is only visible in the window before the answer. */
    notificationWritesHeld: boolean;
    notificationWriteReleases: (() => void)[];
    /** Issues created during a test, the ones deleted and the fields edited, so the list moves the way a server's would. */
    created: ReturnType<typeof makeIssue>[];
    deleted: Set<string>;
    /** The next issue delete is refused with this, and deletes nothing. */
    issueDeleteFailure?: Error;
    edits: Record<string, Record<string, unknown>>;
    /** An update held open, so a test can decide when its answer — and the refetch behind it — lands. */
    issueUpdatesHeld: boolean;
    issueUpdateReleases: (() => void)[];
    /**
     * The panel issue's version, which every edit that changes something bumps
     * — the number the panel has to send back as `If-Match` (TAS-246) — and
     * every edit the panel sent, with the version it sent it at.
     */
    version: number;
    updateCalls: { patch: Record<string, unknown>; expectedVersion: number }[];
    /** The next edit answers 409: the issue moved on elsewhere, with `current` laid over it. */
    conflictNext: { current: Record<string, unknown>; requestId?: string } | null;
    /** The next edit is refused with this error, and changes nothing. */
    updateFailure?: Error;
    /** The labels the issue read carries. */
    issueLabels: { id: string; name: string; color: string }[];
    /**
     * A part that failed on the server and arrived as `[]` anyway — what the
     * gateway does (`IssueDetails`), as against `…Failure` above, which is the
     * `null` a nullable mapper would send.
     */
    watchersPartEmpty: boolean;
    attachmentsPartEmpty: boolean;
    /** The panel's attachments section: what it lists, and how each leg answers. */
    /**
     * `GET /projects/{id}/members`. Empty for every other case here — the
     * assignee row is not what they are about — and seeded only where a name
     * has to be resolved from an id, which is how an attachment's byline works.
     *
     * `user` is optional because the server may not name the person. It is no
     * longer true that it would name *nobody*: this comment reasoned from
     * `ProjectMemberResponseDto` — which is what the two member **writes**
     * answer with, `projectId`, `userId` and `role` — and the member read
     * (backend TAS-137, in docs/contract/openapi.yml) answers with
     * `ProjectMemberDetailsDto`, which does carry `displayName` and `email`.
     * What survives the correction is the row this fixture is: that schema
     * marks neither field required, and `RestTaskaApi` turns a row with no
     * display name into a row with no `user` rather than one with a blank name
     * (TAS-219). `toUserMap` drops such a row, which is the state the watchers
     * section had two different words for.
     */
    members: { userId: string; role: "ADMIN" | "MEMBER" | "VIEWER" | null; addedAt: string; addedBy: string; user?: { displayName: string; email: string } }[];
    /** Who the panel's issue is assigned to. */
    assigneeId: string | null;
    attachments: {
      id: string;
      issueId: string;
      fileName: string;
      contentType: string;
      sizeBytes: number;
      uploadedBy: string;
      checksum: string | null;
      createdAt: string;
    }[];
    attachmentsFailure?: Error;
    /** The list re-read held open, so a test can read the cache the mutation left rather than the answer that replaced it. */
    attachmentsHeld: boolean;
    uploadUrlFailure?: Error;
    putFailure?: Error;
    /**
     * A confirm that rejects. `landsAnyway` is the case the panel exists to get
     * right: the row *is* on the server and only the answer was lost, so the
     * list has to be re-read before anybody is told otherwise.
     */
    confirmFailure?: Error;
    confirmLandsAnyway: boolean;
    confirmCalls: number;
    downloadUrl: string;
    /** The GET of a link's bytes (TAS-253): refused with this, or answered with a text blob. */
    bytesFailure?: Error;
    bytesReads: string[];
    /** Every leg 1 and leg 3, in the order they were sent, so a queue can be seen to run one file at a time. */
    uploadLog: string[];
    deleted_attachments: string[];
    /**
     * A delete that refuses, and one held open. Both are needed to reach the
     * rollback: without the refusal `onError` never runs, and without the hold
     * the optimistic window is one tick long and nothing can be asserted inside
     * it.
     */
    deleteFailure?: Error;
    deleteHeld: boolean;
    deleteReleases: (() => void)[];
    /** `GET /projects/{id}/members` failing. */
    membersFailure?: Error;
    membersHeld: boolean;
    /** Every member read that went out, answered or not, so a retried read can be told from a single one. */
    membersReads: number;
    /** Every plain `GET /projects/{id}` that went out — none since the board reads its frame from the context. */
    projectReads: number;
    /**
     * The watchers section. `watchers` and `watchersTotal` are held apart
     * deliberately: the whole point of the count is that it is a field the
     * server states rather than the length of the array beside it, and a
     * fixture where the two always agreed could not tell the two readings
     * apart.
     */
    watchers: { id: string; issueId: string; projectId: string; userId: string; createdAt: string; createdBy: string }[];
    watchersTotal: number | null;
    /** What every watcher *write* states as the count after it. */
    watchersCountAfterWrite: number | null;
    /** What both delete routes report in `removed`. */
    unwatchRemoved: boolean;
    watchersFailure?: Error;
    /** The list re-read held open, so a test can read what a write left in the cache rather than the refetch that replaces it. */
    watchersHeld: boolean;
    /** A refused ADMIN add or remove. The `me` pair is left alone: its refusals are not what the gating is about. */
    watcherWriteFailure?: Error;
    /**
     * The four writes held open, and every dispatch counted. Both exist for the
     * same class of defect: the guards in this section live entirely in the
     * window between the press and the answer, and against a fake that resolves
     * on the next tick that window is not something a test can stand in.
     */
    watcherWritesHeld: boolean;
    watcherWriteReleases: (() => void)[];
    watcherCalls: { watch: number; unwatch: number; add: string[]; remove: string[] };
    /**
     * The panel's own issue read (`getIssue`), held open or failing. TAS-242 is
     * entirely about the window before it answers, and against a fake that
     * answers on the next tick that window is not something a test can stand in.
     */
    issueHeld: boolean;
    issueReleases: (() => void)[];
    issueFailure?: Error;
    /**
     * The three sections with no state of their own to fail through
     * (`attachmentsFailure` already exists above for the attachments section's
     * write tests, and the watchers section has `watchersFailure`). These back
     * only "keeps a section read that failed first…" below.
     */
    labelsFailure?: Error;
    linksFailure?: Error;
    commentsFailure?: Error;
    /**
     * Every read the panel's sections sent of their own, answered or not. Since
     * TAS-246 the four list reads are never sent by the panel — their parts
     * ride on the issue read — so these stay at zero, and `issue` counts the
     * one read that carries them.
     */
    sectionReads: { watchers: number; labels: number; links: number; attachments: number; comments: number; issue: number };
    /**
     * Who the issue read names, keyed by id — `UserSummary.displayName` as the
     * server sent it, `""` included, which is how a gateway whose auth-service
     * is down answers. Absent ids get no summary at all.
     */
    summaries: Record<string, string>;
    /** Who the issue's watcher rows name, the same way. */
    watcherNames: Record<string, string>;
    /** The issue read's links, as the server resolved them — `target` included. */
    links: unknown[];
    /** The issue read's history, oldest first, as the server sends it. Empty unless a test is about the feed. */
    history: IssueHistoryEvent[];
    /** The thread `listComments` answers with — empty unless a test is about comments (TAS-259). */
    comments: IssueComment[];
    /** Every comment `deleteComment` was asked to remove, in order. */
    deletedComments: string[];
    /** What `deleteComment` refuses with, before it removes anything. */
    commentDeleteFailure?: Error;
  } = {
    membership: { role: "ADMIN", isMember: true, projectExists: true },
    archivedAt: null,
    membershipHeld: false,
    projectHeld: false,
    issueTypes: ["TASK", "BUG", "STORY"],
    workflowsByType: {},
    meta: { issueTypes: null, priorities: null, linkTypes: null, notificationTypes: null, userStatuses: null },
    metaReads: 0,
    extraIssues: [],
    createCalls: [],
    boardReads: 0,
    boardHeld: false,
    transitionCalls: [],
    transitionHeld: false,
    transitionSettlers: [],
    boardNames: {},
    labels: [],
    labelCreateHeld: false,
    notifications: [],
    readNotifications: [],
    notificationWritesHeld: false,
    notificationWriteReleases: [],
    issueUpdatesHeld: false,
    issueUpdateReleases: [],
    version: 1,
    updateCalls: [],
    conflictNext: null,
    issueLabels: [],
    watchersPartEmpty: false,
    attachmentsPartEmpty: false,
    created: [],
    deleted: new Set<string>(),
    edits: {},
    members: [],
    assigneeId: null,
    attachments: [],
    confirmLandsAnyway: false,
    confirmCalls: 0,
    downloadUrl: "https://store.example/taska-attachments/obj?X-Amz-Signature=abc",
    bytesReads: [],
    uploadLog: [],
    deleted_attachments: [],
    attachmentsHeld: false,
    deleteHeld: false,
    deleteReleases: [],
    membersHeld: false,
    membersReads: 0,
    projectReads: 0,
    watchers: [],
    watchersTotal: null,
    watchersCountAfterWrite: null,
    unwatchRemoved: true,
    watchersHeld: false,
    watcherWritesHeld: false,
    watcherWriteReleases: [],
    watcherCalls: { watch: 0, unwatch: 0, add: [], remove: [] },
    issueHeld: false,
    issueReleases: [],
    sectionReads: { watchers: 0, labels: 0, links: 0, attachments: 0, comments: 0, issue: 0 },
    summaries: {},
    watcherNames: {},
    links: [],
    history: [],
    comments: [],
    deletedComments: [],
  };

  /** The held half of an issue update — same shape as the watcher writes below. */
  const issueUpdateWindow = async () => {
    if (!state.issueUpdatesHeld) return;
    await new Promise<void>((resolve) => state.issueUpdateReleases.push(resolve));
  };

  /** The held half of a watcher write: counted on the way in, answered when the test says so. */
  const watcherWriteWindow = async () => {
    if (!state.watcherWritesHeld) return;
    await new Promise<void>((resolve) => state.watcherWriteReleases.push(resolve));
  };

  /**
   * The panel's issue as the server holds it, without the parts only the
   * details read carries — the one shape both the read and the edit answer
   * with, so an edit's answer never disagrees with the read about a field it
   * did not touch.
   */
  const panelIssue = (projectId: string, issueId: string) => ({
    id: issueId,
    projectId,
    issueNumber: 102,
    issueKey: "TAS-102",
    issueType: "TASK" as const,
    summary: "Wire the board to the gateway",
    description: "",
    status: "TODO" as const,
    priority: "MEDIUM" as const,
    reporterId: "user-anna",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    // Four of the five set and the fifth `null`, which is what the panel's
    // Planning block is read on: `480` has to come back as a duration,
    // a date has to come back as the day it is, and the empty one has to
    // come back empty rather than as a nought.
    storyPoints: 3,
    startDate: "2026-06-15",
    dueDate: "2026-06-26",
    originalEstimateMinutes: 480,
    remainingEstimateMinutes: null,
    ...(state.extraIssues.find((item) => item.id === issueId) ?? {}),
    ...(state.edits[issueId] ?? {}),
    assigneeId: state.assigneeId,
    version: state.version,
    labels: state.issueLabels,
  });

  /**
   * The issues as this fixture's server holds them. The description of the
   * seeded one is not empty: the board's own box filters descriptions too,
   * and a fixture with none could not tell whether it does. The others are
   * built from a neutral base and laid over with the test's fields, so a
   * deliberately malformed one (a key that is not a string) reaches the board
   * rather than failing in this fixture.
   */
  const storedIssues = () => {
    const seeded = makeIssue("issue-1", "TAS-102", "Wire the board to the gateway", "Point the columns at the deployed gateway.");
    const extras = state.extraIssues.map((extra) => ({ ...makeIssue(extra.id, "TAS-0", "", ""), ...extra }));
    return [seeded, ...extras, ...state.created]
      .filter((issue) => !state.deleted.has(issue.id))
      .map((issue) => ({ ...issue, ...(state.edits[issue.id] ?? {}) }) as ReturnType<typeof makeIssue> & Record<string, unknown>);
  };

  /** The workflow this fixture's context sends for a type: the default one status, or the test's own. */
  const contextWorkflow = (issueType: string) => {
    const workflow = {
      id: "workflow",
      name: "Default",
      version: 1,
      statuses: [{ id: "s1", statusKey: "TODO" as string, name: "To Do", category: "TODO" as string, sortOrder: 10 }],
      transitions: [] as { id: string; fromStatusId: string; toStatusId: string; name: string; sortOrder: number }[],
      ...state.contextWorkflowParts,
    };
    return Object.hasOwn(state.workflowsByType, issueType) ? { ...workflow, ...state.workflowsByType[issueType] } : workflow;
  };

  const api = {
    hasSession: () => true,
    onSessionExpired: () => () => {},
    getMeta: async () => {
      state.metaReads += 1;
      if (state.meta instanceof Error) throw state.meta;
      return state.meta;
    },
    getCurrentUser: async () => ({
      id: "user-anna",
      email: "anna@example.com",
      displayName: "Anna Ivanova",
      status: "ACTIVE" as const,
    }),
    getProject: async (projectId: string) => {
      state.projectReads += 1;
      if (state.projectHeld) return new Promise(() => {});
      if (state.projectFailure) throw state.projectFailure;
      return {
        id: projectId,
        projectKey: "TAS",
        name: "Taska Platform",
        createdBy: "user-anna",
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
      };
    },
    // The Workflows dialog's read (TAS-382): what the dialog does with it is
    // ProjectWorkflowsModal.test.tsx's; here it only has to open.
    listProjectWorkflows: async () => [],
    // The board's one frame read since TAS-251, composed from the same state
    // the five separate reads below were. All or nothing, as on the server: a
    // failure or a hold of any part is a failure or a hold of the whole, so
    // each knob these tests turn now turns the one read.
    getProjectContext: async (projectId: string) => {
      state.membersReads += 1;
      if (state.projectHeld || state.membershipHeld || state.membersHeld) return new Promise(() => {});
      const failure = state.projectFailure ?? state.membershipFailure ?? state.membersFailure ?? state.workflowFailure;
      if (failure) throw failure;
      return {
        project: {
          id: projectId,
          projectKey: "TAS",
          name: "Taska Platform",
          createdBy: "user-anna",
          createdAt: now,
          updatedAt: now,
          archivedAt: state.archivedAt,
          currentUserRole: state.membership.role,
        },
        role: state.membership.role,
        members: state.members,
        labels: state.labels,
        workflows: Object.fromEntries(state.issueTypes.map((issueType) => [issueType, contextWorkflow(issueType)])),
      };
    },
    getMembership: async () => {
      // A request that never settles: the only way to hold a query in the
      // refetch window the banner has to survive.
      if (state.membershipHeld) return new Promise(() => {});
      if (state.membershipFailure) throw state.membershipFailure;
      return state.membership;
    },
    listMembers: async () => {
      state.membersReads += 1;
      if (state.membersHeld) return new Promise(() => {});
      if (state.membersFailure) throw state.membersFailure;
      return state.members;
    },
    listIssues: async () => {
      if (state.issuesFailure) throw state.issuesFailure;
      const items = storedIssues();
      return { items, page: 0, pageSize: 100, totalCount: items.length };
    },
    // The board's one issue read since TAS-202, built the way the gateway
    // builds it (backend #205): the workflows of TASK, BUG and STORY — the
    // ones this fixture's context sends, whatever the project allows, since
    // workflow-service ignores that — merged by key, first type winning, then
    // by `sortOrder`; an issue in a status its own type's workflow lacks goes
    // to `unplacedIssues`; an issue of any other type is not read at all
    // (backend A4). Cards carry the assignee the server joined in.
    getBoard: async (projectId: string) => {
      state.boardReads += 1;
      if (state.boardHeld) return new Promise(() => {});
      if (state.issuesFailure) throw state.issuesFailure;
      const types = ["TASK", "BUG", "STORY"];
      const statusesOf = (type: string) => contextWorkflow(type).statuses;
      const byKey = new Map<string, { statusKey: string; name: string; category: string; sortOrder: number }>();
      for (const type of types) for (const status of statusesOf(type)) if (!byKey.has(status.statusKey)) byKey.set(status.statusKey, status);
      const columns = [...byKey.values()]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map(({ statusKey, name, category, sortOrder }) => ({ statusKey, name, category, sortOrder, issues: [] as unknown[] }));
      const unplacedIssues: unknown[] = [];
      for (const issue of storedIssues()) {
        if (typeof issue.issueType === "string" && !types.includes(issue.issueType)) continue;
        const assigneeId = issue.assigneeId as string | null;
        const card = {
          id: issue.id,
          issueKey: issue.issueKey,
          summary: issue.summary,
          issueType: issue.issueType,
          priority: issue.priority,
          statusKey: issue.status,
          description: issue.description,
          createdAt: issue.createdAt,
          updatedAt: issue.updatedAt,
          version: issue.version,
          assignee: assigneeId
            ? { id: assigneeId, displayName: state.boardNames[assigneeId] ?? null, avatarUrl: null }
            : null,
          labels: issue.labels ?? [],
        };
        const own = statusesOf(String(issue.issueType)).some((status) => status.statusKey === issue.status);
        const column = own ? columns.find((item) => item.statusKey === issue.status) : undefined;
        if (column) column.issues.push(card);
        else unplacedIssues.push(card);
      }
      return { projectId, columns, unplacedIssues };
    },
    // The board's drop move. Held, it settles when the test says so; landed, it
    // moves the issue to the status the transition leads to, the way the next
    // board read would find it on a server.
    transitionIssue: async (_projectId: string, issueId: string, transitionId: string) => {
      state.transitionCalls.push({ issueId, transitionId });
      if (state.transitionHeld) {
        await new Promise<void>((resolve, reject) => state.transitionSettlers.push({ resolve, reject }));
      }
      const workflow = contextWorkflow("TASK");
      const to = workflow.transitions.find((item) => item.id === transitionId)?.toStatusId;
      const target = workflow.statuses.find((item) => item.id === to);
      if (target) state.edits[issueId] = { ...state.edits[issueId], status: target.statusKey };
      return panelIssue(PROJECT_ID, issueId);
    },
    // Both of these move the board the next read answers, the way a server would.
    createIssue: async (_projectId: string, input: { summary: string; description: string }) => {
      state.createCalls.push({ ...input });
      if (state.createFailure) {
        const failure = state.createFailure;
        state.createFailure = undefined;
        throw failure;
      }
      const created = makeIssue(`issue-${state.created.length + 2}`, `TAS-20${state.created.length}`, input.summary, input.description);
      state.created = [...state.created, created];
      return created;
    },
    deleteIssue: async (_projectId: string, issueId: string) => {
      if (state.issueDeleteFailure) {
        const failure = state.issueDeleteFailure;
        state.issueDeleteFailure = undefined;
        throw failure;
      }
      state.deleted.add(issueId);
    },
    // A PATCH since TAS-246: it takes the version the panel is editing, answers
    // a stale one with a conflict carrying the issue as it stands, bumps the
    // version on every change, and answers with the issue as the read draws it
    // — without labels, which the gateway's write answer never fills.
    updateIssue: async (projectId: string, issueId: string, patch: Record<string, unknown>, expectedVersion: number) => {
      state.updateCalls.push({ patch: { ...patch }, expectedVersion });
      await issueUpdateWindow();
      const { IssueVersionConflictError } = await import("../api/errors");
      const answer = () => {
        const { labels: _labels, ...issue } = panelIssue(projectId, issueId);
        return issue;
      };
      if (state.updateFailure) {
        const failure = state.updateFailure;
        state.updateFailure = undefined;
        throw failure;
      }
      if (state.conflictNext) {
        const { current, requestId } = state.conflictNext;
        state.conflictNext = null;
        state.version += 1;
        state.edits[issueId] = { ...state.edits[issueId], ...current };
        throw new IssueVersionConflictError(answer(), expectedVersion, requestId);
      }
      if (expectedVersion !== state.version) throw new IssueVersionConflictError(answer(), expectedVersion);
      const { assigneeId, ...fields } = patch;
      if ("assigneeId" in patch) state.assigneeId = (assigneeId as string | null) ?? null;
      state.edits[issueId] = {
        ...state.edits[issueId],
        ...fields,
        ...("description" in fields ? { description: fields.description ?? "" } : {}),
      };
      state.version += 1;
      return answer();
    },
    // The board has no search layer since TAS-202; this is here so a test can
    // say it is never asked.
    searchIssues: async () => ({ items: [], page: 0, pageSize: 50, totalCount: 0 }),
    // Copies, like a server's answer: the cache must never hold the objects
    // the writes below replace.
    listNotifications: async () => ({
      items: state.notifications.map((item) => ({ ...item })),
      pageSize: 20,
      offset: 0,
      unreadCount: state.unreadCount ?? state.notifications.filter((item) => !item.readAt).length,
    }),
    markNotificationRead: async (notificationId: string) => {
      state.readNotifications.push(notificationId);
      if (state.notificationWritesHeld) {
        await new Promise<void>((resolve) => state.notificationWriteReleases.push(resolve));
      }
      if (state.markReadFailure) throw state.markReadFailure;
      state.notifications = state.notifications.map((item) =>
        item.id === notificationId ? { ...item, readAt: item.readAt ?? "2026-08-01T09:00:00Z" } : item,
      );
      return state.notifications.find((item) => item.id === notificationId);
    },
    markAllNotificationsRead: async () => {
      if (state.notificationWritesHeld) {
        await new Promise<void>((resolve) => state.notificationWriteReleases.push(resolve));
      }
      if (state.markAllFailure) throw state.markAllFailure;
      const updatedCount = state.notifications.filter((item) => !item.readAt).length;
      state.notifications = state.notifications.map((item) => ({ ...item, readAt: item.readAt ?? "2026-08-01T09:00:00Z" }));
      state.unreadCount = undefined;
      return { updatedCount };
    },
    // The board reads the project's labels for its filter. The tests about the
    // five reads above say nothing about labels, so this answers successfully
    // with none — `seedLabels` is what the label tests use to put something in
    // it, rather than every other assertion growing a sixth state.
    listProjectLabels: async () => state.labels,
    createProjectLabel: async (_projectId: string, input: { name: string; color: string }) => {
      // A create that never settles. The defect this covers lives entirely in
      // the window between the optimistic row appearing and the server
      // answering, and against the mock that window is 140ms of real time — a
      // test that raced it would be passing on a stopwatch. Holding the
      // promise makes the window the whole test instead.
      if (state.labelCreateHeld) return new Promise(() => {});
      if (state.createFailure) {
        const failure = state.createFailure;
        state.createFailure = undefined;
        throw failure;
      }
      const label = { id: `label-${state.labels.length + 1}`, name: input.name, color: input.color };
      state.labels = [...state.labels, label];
      return label;
    },
    // The panel's one read since TAS-246: the issue, and the four parts the
    // sections used to read for themselves, composed from the same state the
    // section writes below move. A section "read failure" is now a part the
    // server did not send (`null`), and a "held" section read is a re-read of
    // the issue that never lands.
    getIssue: async (projectId: string, issueId: string) => {
      state.sectionReads.issue += 1;
      if (state.issueHeld) await new Promise<void>((resolve) => state.issueReleases.push(resolve));
      if (state.issueFailure) throw state.issueFailure;
      if (state.sectionReads.issue > 1 && (state.watchersHeld || state.attachmentsHeld)) return new Promise(() => {});
      const summary = (id: string | null) =>
        id && id in state.summaries ? { id, displayName: state.summaries[id] || null, avatarUrl: null } : null;
      return {
        issue: {
          ...panelIssue(projectId, issueId),
          labels: state.labelsFailure ? null : state.issueLabels,
          assignee: summary(state.assigneeId),
          reporter: summary("user-anna"),
          // No count: the details DTO states none, so neither implementation
          // does (TAS-246). Only a watcher write says how many.
          watchers: state.watchersFailure
            ? null
            : {
                watchers: state.watchersPartEmpty
                  ? []
                  : state.watchers.map((watcher) => ({
                      ...watcher,
                      displayName: state.watcherNames[watcher.userId] || null,
                      avatarUrl: null,
                    })),
                totalCount: null,
              },
          // From the issue's core query on the server, which does not fail
          // with the watcher part — so it stays true when the part arrived as
          // `[]`.
          isWatching: state.watchersFailure ? null : state.watchers.some((watcher) => watcher.userId === "user-anna"),
          links: state.linksFailure ? null : state.links,
          attachments: state.attachmentsFailure
            ? null
            : state.attachmentsPartEmpty
              ? []
              : state.attachments
                .filter((item) => !state.deleted_attachments.includes(item.id))
                .map((item) => ({
                  ...item,
                  uploadedByUser: summary(item.uploadedBy),
                })),
          commentCount: 0,
        },
        history: state.history,
      };
    },
    listIssueLabels: async () => {
      state.sectionReads.labels += 1;
      if (state.labelsFailure) throw state.labelsFailure;
      return [];
    },
    listIssueLinks: async () => {
      state.sectionReads.links += 1;
      if (state.linksFailure) throw state.linksFailure;
      return [];
    },
    /**
     * The watchers section's five calls. The list answers with the array *and*
     * the count as two independent facts, because that is what the contract
     * sends and what the section is required not to conflate.
     */
    listIssueWatchers: async () => {
      state.sectionReads.watchers += 1;
      // A re-read that never lands, so a test can read what a write left in
      // the cache rather than the refetch that would replace it.
      if (state.watchersHeld) return new Promise(() => {});
      if (state.watchersFailure) throw state.watchersFailure;
      return { watchers: state.watchers, totalCount: state.watchersTotal };
    },
    watchIssue: async () => {
      state.watcherCalls.watch += 1;
      await watcherWriteWindow();
      const watcher = {
        id: `watcher-${state.watchers.length + 1}`,
        issueId: "issue-1",
        projectId: PROJECT_ID,
        userId: "user-anna",
        createdAt: now,
        createdBy: "user-anna",
      };
      state.watchers = [...state.watchers, watcher];
      return { watcher, watchersCount: state.watchersCountAfterWrite };
    },
    unwatchIssue: async () => {
      state.watcherCalls.unwatch += 1;
      await watcherWriteWindow();
      state.watchers = state.watchers.filter((watcher) => watcher.userId !== "user-anna");
      return { issueId: "issue-1", removed: state.unwatchRemoved, watchersCount: state.watchersCountAfterWrite };
    },
    addIssueWatcher: async (_projectId: string, _issueId: string, userId: string) => {
      state.watcherCalls.add.push(userId);
      await watcherWriteWindow();
      // Refused *before* the row is touched: a server that says no has added
      // nothing, which is what makes the disappearing row correct.
      if (state.watcherWriteFailure) throw state.watcherWriteFailure;
      const watcher = {
        id: `watcher-${state.watchers.length + 1}`,
        issueId: "issue-1",
        projectId: PROJECT_ID,
        userId,
        createdAt: now,
        createdBy: "user-anna",
      };
      state.watchers = [...state.watchers, watcher];
      return { watcher, watchersCount: state.watchersCountAfterWrite };
    },
    removeIssueWatcher: async (_projectId: string, _issueId: string, userId: string) => {
      state.watcherCalls.remove.push(userId);
      await watcherWriteWindow();
      if (state.watcherWriteFailure) throw state.watcherWriteFailure;
      state.watchers = state.watchers.filter((watcher) => watcher.userId !== userId);
      return { issueId: "issue-1", removed: state.unwatchRemoved, watchersCount: state.watchersCountAfterWrite };
    },
    // The attachments section's five reachable calls. `putAttachmentBytes`
    // takes a Blob and answers nothing, exactly as the real middle leg does.
    listAttachments: async () => {
      state.sectionReads.attachments += 1;
      // A re-read that never lands. `onSettled` invalidates this list after
      // every delete, so a refetch would put a rolled-back row on screen by
      // itself — and a test that let it would pass with the rollback deleted.
      if (state.attachmentsHeld) return new Promise(() => {});
      if (state.attachmentsFailure) throw state.attachmentsFailure;
      return state.attachments.filter((item) => !state.deleted_attachments.includes(item.id));
    },
    createAttachmentUploadUrl: async (_projectId: string, _issueId: string, input: { fileName: string }) => {
      state.uploadLog.push(`sign ${input.fileName}`);
      if (state.uploadUrlFailure) throw state.uploadUrlFailure;
      return { uploadUrl: "https://store.example/obj?X-Amz-Signature=abc", objectKey: "obj-1" };
    },
    putAttachmentBytes: async () => {
      if (state.putFailure) throw state.putFailure;
    },
    confirmAttachmentUpload: async (
      _projectId: string,
      issueId: string,
      input: { objectKey: string; fileName: string; contentType: string },
    ) => {
      state.confirmCalls += 1;
      state.uploadLog.push(`confirm ${input.fileName}`);
      const created = {
        id: `attachment-${state.attachments.length + 1}`,
        issueId,
        fileName: input.fileName,
        contentType: input.contentType,
        sizeBytes: 11,
        uploadedBy: "user-anna",
        checksum: null,
        createdAt: now,
      };
      if (state.confirmFailure) {
        // The server-side half of the write happening while the answer is lost
        // — the only way to reach the panel's "attached after all" sentence.
        if (state.confirmLandsAnyway) state.attachments = [...state.attachments, created];
        throw state.confirmFailure;
      }
      state.attachments = [...state.attachments, created];
      return created;
    },
    getAttachmentDownloadUrl: async () => ({ downloadUrl: state.downloadUrl, checksum: null }),
    getAttachmentBytes: async (downloadUrl: string) => {
      state.bytesReads.push(downloadUrl);
      if (state.bytesFailure) throw state.bytesFailure;
      return new Blob(["trace body"], { type: "text/plain" });
    },

    deleteAttachment: async (_projectId: string, _issueId: string, attachmentId: string) => {
      if (state.deleteHeld) await new Promise<void>((resolve) => state.deleteReleases.push(resolve));
      // Refused *before* the row is touched: a server that says no has removed
      // nothing, which is what makes the reappearing row correct.
      if (state.deleteFailure) throw state.deleteFailure;
      state.deleted_attachments.push(attachmentId);
    },
    // The work log section (TAS-251) reads its own list; these cases are not
    // about it, so it answers with none.
    listIssueWorklogs: async () => [],
    listComments: async () => {
      state.sectionReads.comments += 1;
      if (state.commentsFailure) throw state.commentsFailure;
      return { items: state.comments, page: 0, pageSize: 50, totalCount: state.comments.length };
    },
    deleteComment: async (_projectId: string, _issueId: string, commentId: string) => {
      if (state.commentDeleteFailure) throw state.commentDeleteFailure;
      state.deletedComments.push(commentId);
      state.comments = state.comments.filter((comment) => comment.id !== commentId);
    },
  };

  return {
    fakeApi: api as unknown as TaskaApi,
    setMembership: (role: "ADMIN" | "MEMBER" | "VIEWER" | null) => {
      state.membership = { role, isMember: true, projectExists: true };
    },
    /** What the next context read says about the archive. */
    seedArchivedAt: (archivedAt: string | null) => {
      state.archivedAt = archivedAt;
    },
    seedAssignee: (assigneeId: string | null) => {
      state.assigneeId = assigneeId;
    },
    /** Every assignment the panel sent — an edit carrying `assigneeId`, since TAS-246. */
    assignCalls: () =>
      state.updateCalls.filter((call) => "assigneeId" in call.patch).map((call) => call.patch.assigneeId as string | null),
    updateCalls: () => state.updateCalls.map((call) => ({ ...call, patch: { ...call.patch } })),
    /** The next edit answers 409 with the issue moved on elsewhere, `current` laid over it. */
    conflictNextUpdate: (current: Record<string, unknown>, requestId?: string) => {
      state.conflictNext = { current, requestId };
    },
    failNextUpdate: (error: Error) => {
      state.updateFailure = error;
    },
    seedIssueLabels: (labels: { id: string; name: string; color: string }[]) => {
      state.issueLabels = labels;
    },
    /** The issue read sends these parts as `[]` whatever is stored, the way the gateway sends a part that failed. */
    emptyPartsOnRead: (parts: { watchers?: boolean; attachments?: boolean }) => {
      state.watchersPartEmpty = parts.watchers ?? false;
      state.attachmentsPartEmpty = parts.attachments ?? false;
    },
    /** What the server's issue is at — what the next read answers, and what an edit must send. */
    seedIssueVersion: (version: number) => {
      state.version = version;
    },
    failMembership: (error: Error) => {
      state.membershipFailure = error;
    },
    holdMembership: (held: boolean) => {
      state.membershipHeld = held;
    },
    failProject: (error: Error) => {
      state.projectFailure = error;
    },
    holdProject: (held: boolean) => {
      state.projectHeld = held;
    },
    failIssues: (error: Error | undefined) => {
      state.issuesFailure = error;
    },
    holdBoard: (held: boolean) => {
      state.boardHeld = held;
    },
    boardReads: () => state.boardReads,
    holdTransition: (held: boolean) => {
      state.transitionHeld = held;
    },
    /** Lands the oldest held drop move, or refuses it with `error`. */
    settleTransition: (error?: Error) => {
      const held = state.transitionSettlers.shift();
      if (error) held?.reject(error);
      else held?.resolve();
    },
    heldTransitionCount: () => state.transitionSettlers.length,
    transitionCalls: () => state.transitionCalls.map((call) => ({ ...call })),
    /** The names the board read joins in for these assignees. */
    seedBoardNames: (names: Record<string, string>) => {
      state.boardNames = names;
    },
    failWorkflow: (error: Error) => {
      state.workflowFailure = error;
    },
    seedLabels: (labels: { id: string; name: string; color: string }[]) => {
      state.labels = labels;
    },
    seedMembers: (members: typeof state.members) => {
      state.members = members;
    },
    seedAttachments: (attachments: typeof state.attachments) => {
      state.attachments = attachments;
    },
    failAttachmentsRead: (error: Error) => {
      state.attachmentsFailure = error;
    },
    holdAttachmentsRead: (held: boolean) => {
      state.attachmentsHeld = held;
    },
    seedDownloadUrl: (url: string) => {
      state.downloadUrl = url;
    },
    failUpload: (where: "sign" | "put" | "confirm", error: Error, landsAnyway = false) => {
      if (where === "sign") state.uploadUrlFailure = error;
      if (where === "put") state.putFailure = error;
      if (where === "confirm") {
        state.confirmFailure = error;
        state.confirmLandsAnyway = landsAnyway;
      }
    },
    confirmCalls: () => state.confirmCalls,
    failBytes: (error: Error | undefined) => {
      state.bytesFailure = error;
    },
    bytesReads: () => [...state.bytesReads],
    uploadLog: () => [...state.uploadLog],

    listedAttachments: () => state.attachments.filter((item) => !state.deleted_attachments.includes(item.id)),
    deletedAttachments: () => state.deleted_attachments,
    failIssueDelete: (error: Error) => {
      state.issueDeleteFailure = error;
    },
    failDelete: (error: Error) => {
      state.deleteFailure = error;
    },
    holdDelete: (held: boolean) => {
      state.deleteHeld = held;
    },
    /** Lands the oldest held delete. */
    releaseDelete: () => {
      state.deleteReleases.shift()?.();
    },
    heldDeleteCount: () => state.deleteReleases.length,
    holdLabelCreate: (held: boolean) => {
      state.labelCreateHeld = held;
    },
    /** The next issue or label create answers with this refusal. */
    failNextCreate: (error: Error) => {
      state.createFailure = error;
    },
    failMembers: (error: Error) => {
      state.membersFailure = error;
    },
    /** A member read that never settles — the third state, between answered and failed. */
    holdMembers: (held: boolean) => {
      state.membersHeld = held;
    },
    memberReads: () => state.membersReads,
    projectReads: () => state.projectReads,
    /** The list read's two answers, stated apart so a test can make them disagree. */
    seedWatchers: (watchers: typeof state.watchers, totalCount: number | null, countAfterWrite: number | null = null) => {
      state.watchers = watchers;
      state.watchersTotal = totalCount;
      state.watchersCountAfterWrite = countAfterWrite;
    },
    /** `undefined` lets the read succeed again, for a test that reopens the panel. */
    failWatchersRead: (error: Error | undefined) => {
      state.watchersFailure = error;
    },
    holdWatchersRead: (held: boolean) => {
      state.watchersHeld = held;
    },
    /** The other two sections with no read state of their own — see the type above. */
    failLabelsRead: (error: Error | undefined) => {
      state.labelsFailure = error;
    },
    failLinksRead: (error: Error | undefined) => {
      state.linksFailure = error;
    },
    failCommentsRead: (error: Error | undefined) => {
      state.commentsFailure = error;
    },
    failWatcherWrite: (error: Error) => {
      state.watcherWriteFailure = error;
    },
    /** Every watcher write held open from here on. */
    holdWatcherWrites: (held: boolean) => {
      state.watcherWritesHeld = held;
    },
    /** Answers everything held, in the order it was asked. */
    releaseWatcherWrites: () => {
      const waiting = state.watcherWriteReleases;
      state.watcherWriteReleases = [];
      waiting.forEach((resolve) => resolve());
    },
    /** Dispatches, not results: what the component asked the server to do. */
    watcherCalls: () => ({
      watch: state.watcherCalls.watch,
      unwatch: state.watcherCalls.unwatch,
      add: [...state.watcherCalls.add],
      remove: [...state.watcherCalls.remove],
    }),
    /** What both delete routes report in `removed`. */
    setUnwatchAnswer: (removed: boolean) => {
      state.unwatchRemoved = removed;
    },
    watchedUserIds: () => state.watchers.map((watcher) => watcher.userId),
    seedNotifications: (items: typeof state.notifications) => {
      state.notifications = items;
    },
    seedUnreadCount: (count: number) => {
      state.unreadCount = count;
    },
    readNotifications: () => state.readNotifications,
    failMarkRead: (error: Error) => {
      state.markReadFailure = error;
    },
    failMarkAll: (error: Error) => {
      state.markAllFailure = error;
    },
    holdNotificationWrites: (held: boolean) => {
      state.notificationWritesHeld = held;
    },
    /** Answers every held write, in the order it was asked. */
    releaseNotificationWrites: () => {
      const waiting = state.notificationWriteReleases;
      state.notificationWriteReleases = [];
      waiting.forEach((resolve) => resolve());
    },
    heldNotificationWriteCount: () => state.notificationWriteReleases.length,
    /** Every issue update held open from here on, answer and refetch alike. */
    holdIssueUpdates: (held: boolean) => {
      state.issueUpdatesHeld = held;
    },
    /** How many updates are waiting — a release before the call arrives releases nothing. */
    heldIssueUpdateCount: () => state.issueUpdateReleases.length,
    /** Answers everything held, in the order it was asked. */
    releaseIssueUpdates: () => {
      const waiting = state.issueUpdateReleases;
      state.issueUpdateReleases = [];
      waiting.forEach((resolve) => resolve());
    },
    /** The panel's issue read held open from here on. */
    holdIssue: (held: boolean) => {
      state.issueHeld = held;
    },
    /** Lets every held issue read continue; each then answers, or throws `failIssue`'s error. */
    releaseIssue: () => {
      const waiting = state.issueReleases;
      state.issueReleases = [];
      waiting.forEach((resolve) => resolve());
    },
    heldIssueCount: () => state.issueReleases.length,
    failIssue: (error: Error) => {
      state.issueFailure = error;
    },
    sectionReads: () => ({ ...state.sectionReads }),
    /** What the issue read names people as: `""` is the auth-service-down answer. */
    seedSummaries: (names: Record<string, string>) => {
      state.summaries = names;
    },
    seedWatcherNames: (names: Record<string, string>) => {
      state.watcherNames = names;
    },
    seedLinks: (links: unknown[]) => {
      state.links = links;
    },
    seedIssueTypes: (issueTypes: typeof state.issueTypes) => {
      state.issueTypes = issueTypes;
    },
    seedContextWorkflowParts: (parts: NonNullable<typeof state.contextWorkflowParts>) => {
      state.contextWorkflowParts = parts;
    },
    seedHistory: (history: IssueHistoryEvent[]) => {
      state.history = history;
    },
    seedComments: (comments: IssueComment[]) => {
      state.comments = comments;
    },
    deletedComments: () => [...state.deletedComments],
    failCommentDelete: (error: Error | undefined) => {
      state.commentDeleteFailure = error;
    },
    seedMeta: (meta: typeof state.meta) => {
      state.meta = meta;
    },
    seedExtraIssues: (issues: typeof state.extraIssues) => {
      state.extraIssues = issues;
    },
    seedWorkflowsByType: (workflows: typeof state.workflowsByType) => {
      state.workflowsByType = workflows;
    },
    metaReads: () => state.metaReads,
    createCalls: () => state.createCalls,
    reset: () => {
      state.issueTypes = ["TASK", "BUG", "STORY"];
      state.workflowsByType = {};
      state.meta = { issueTypes: null, priorities: null, linkTypes: null, notificationTypes: null, userStatuses: null };
      state.metaReads = 0;
      state.extraIssues = [];
      state.createCalls = [];
      state.contextWorkflowParts = undefined;
      state.membership = { role: "ADMIN", isMember: true, projectExists: true };
      state.archivedAt = null;
      state.membershipFailure = undefined;
      state.membershipHeld = false;
      state.projectFailure = undefined;
      state.projectHeld = false;
      state.issuesFailure = undefined;
      state.boardReads = 0;
      state.boardHeld = false;
      state.transitionCalls = [];
      state.transitionHeld = false;
      state.transitionSettlers = [];
      state.boardNames = {};
      state.workflowFailure = undefined;
      state.labels = [];
      state.labelCreateHeld = false;
      state.createFailure = undefined;
      state.notifications = [];
      state.unreadCount = undefined;
      state.readNotifications = [];
      state.markReadFailure = undefined;
      state.markAllFailure = undefined;
      state.notificationWritesHeld = false;
      state.notificationWriteReleases = [];
      state.issueUpdatesHeld = false;
      state.issueUpdateReleases = [];
      state.version = 1;
      state.updateCalls = [];
      state.conflictNext = null;
      state.updateFailure = undefined;
      state.issueLabels = [];
      state.watchersPartEmpty = false;
      state.attachmentsPartEmpty = false;
      state.created = [];
      state.deleted = new Set<string>();
      state.issueDeleteFailure = undefined;
      state.edits = {};
      state.members = [];
      state.assigneeId = null;
      state.attachments = [];
      state.attachmentsFailure = undefined;
      state.attachmentsHeld = false;
      state.uploadUrlFailure = undefined;
      state.putFailure = undefined;
      state.confirmFailure = undefined;
      state.confirmLandsAnyway = false;
      state.confirmCalls = 0;
      state.deleted_attachments = [];
      state.bytesFailure = undefined;
      state.bytesReads = [];
      state.uploadLog = [];
      state.downloadUrl = "https://store.example/taska-attachments/obj?X-Amz-Signature=abc";
      state.deleteFailure = undefined;
      state.deleteHeld = false;
      state.deleteReleases = [];
      state.membersFailure = undefined;
      state.membersHeld = false;
      state.membersReads = 0;
      state.projectReads = 0;
      state.watchers = [];
      state.watchersTotal = null;
      state.watchersCountAfterWrite = null;
      state.unwatchRemoved = true;
      state.watchersFailure = undefined;
      state.watchersHeld = false;
      state.watcherWriteFailure = undefined;
      state.watcherWritesHeld = false;
      state.watcherWriteReleases = [];
      state.watcherCalls = { watch: 0, unwatch: 0, add: [], remove: [] };
      state.issueHeld = false;
      state.issueReleases = [];
      state.issueFailure = undefined;
      state.labelsFailure = undefined;
      state.linksFailure = undefined;
      state.commentsFailure = undefined;
      state.sectionReads = { watchers: 0, labels: 0, links: 0, attachments: 0, comments: 0, issue: 0 };
      state.summaries = {};
      state.watcherNames = {};
      state.links = [];
      state.history = [];
      state.comments = [];
      state.deletedComments = [];
      state.commentDeleteFailure = undefined;
    },
  };
});

vi.mock("../api/client", () => ({ taskaApi: fakeApi }));

function Whereabouts() {
  // And how the router got there: a delete closes the panel by replacing its
  // route, so Back does not open the issue it just deleted (§4.10).
  return (
    <span data-navigation={useNavigationType()} data-testid="whereabouts">
      {useLocation().pathname}
    </span>
  );
}

function renderBoard(initialPath = `/projects/${PROJECT_ID}/board`) {
  // `staleTime` is the app's own (src/main.tsx) rather than react-query's
  // default of 0, so this harness caches the way production does. That is all
  // it is: **it is not what makes the counter tests below bind.** The 2×2 was
  // run — with `20_000` and with `0`, against the fix and against its absence —
  // and the two tests fail without the fix under either value. At 0 react-query
  // still refetches only on a trigger, and `BoardScreen` stays mounted with the
  // same observer for the whole test, so nothing ever re-observes the key.
  //
  // What makes them bind is the fixture: a server total that differs from the
  // loaded page's. The first draft seeded them equal, so "1 of 1" was what the
  // counter read both before the search had answered and after, and the test
  // asserted the pre-search state and measured nothing. The defect never
  // depended on a cache window either — it was a missing invalidation, which is
  // also why re-typing the query could not clear it.
  //
  // The line stays because the harness should mirror production, and because it
  // is now the only thing here that would catch a refetch-on-observe
  // regression.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 20_000 } } });
  const board = <BoardScreen theme="light" toggleTheme={() => {}} onLogout={() => {}} logoutPending={false} />;
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        {/* Where the router actually went. The notification tests are about a
            destination rather than about what renders there, and the
            destination can be a project this fixture draws no board for. */}
        <Whereabouts />
        <Routes>
          <Route path="/projects/:projectId/board" element={board} />
          {/* The same screen with the panel open, which is how the app routes
              it too. Rendering straight at this URL puts the panel's label
              picker and the board's side by side without a drag-enabled card
              having to be clicked first. */}
          <Route path="/projects/:projectId/issues/:issueId" element={board} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return queryClient;
}

/**
 * The board gives a genuine failure one retry (`retryUnlessMissing`), so a
 * banner is a second away rather than a tick away. That budget is deliberate,
 * so the tests wait it out instead of taking it off the screen.
 */
const AFTER_RETRY = { timeout: 3000 };

/** The board's one frame read since TAS-251: project, role, members, labels and workflows. */
const membershipKey = ["project-context", PROJECT_ID];

/**
 * An archived project's board (TAS-149, backend PR #159; DESIGN.md §5.7,
 * «Архивный проект»): readable by every member, writable by none. The signal
 * is `archivedAt` on the context read and nothing else; a refusal only makes
 * the board read the context again.
 */
describe("an archived project's board", () => {
  const ISSUE_PATH = `/projects/${PROJECT_ID}/issues/issue-1`;
  const openPanel = async () => within(await screen.findByRole("dialog", { name: "TAS-102 issue" }));
  const archivedRefusal = () =>
    Object.assign(new Error("Project is archived"), {
      status: 400,
      code: "FAILED_PRECONDITION",
      details: { reason: "PROJECT_ARCHIVED" },
      requestId: "7c41e2d9-archived",
    });

  beforeEach(() => {
    reset();
    window.localStorage.clear();
  });

  it.each([["ADMIN" as const], ["MEMBER" as const], ["VIEWER" as const]])(
    "reads, and offers no write, to a %s",
    async (role) => {
      setMembership(role);
      seedArchivedAt("2026-10-20T10:00:00Z");
      renderBoard();

      const line = await screen.findByText(/^Archived on Oct 20\./);
      expect(line.closest("p")).toHaveTextContent("Archived on Oct 20. This board and its issues are read-only.");
      // Outside the problems region: an archived project is not a failure.
      expect(screen.queryByRole("region", { name: "Board problems" })).not.toBeInTheDocument();
      // Its issues are there, and none of them can be dragged.
      expect(await screen.findByRole("button", { name: /TAS-102/ })).toHaveClass("is-static");
      // The VIEWER's set, for every role, ADMIN included.
      expect(screen.queryByRole("button", { name: "New" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Edit project" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Manage labels" })).not.toBeInTheDocument();
      // The reads stay.
      expect(screen.getByRole("button", { name: "Members" })).toBeVisible();
      expect(screen.getByRole("button", { name: "Workflows" })).toBeVisible();
    },
  );

  it("names the year of an archive from another year", async () => {
    seedArchivedAt("2024-03-05T12:00:00Z");
    renderBoard();

    expect(await screen.findByText("Archived on Mar 5, 2024.")).toBeVisible();
  });

  it("does not say the role is unstated on an archived project", async () => {
    setMembership(null);
    seedArchivedAt("2026-10-20T10:00:00Z");
    renderBoard();

    await screen.findByText(/^Archived on/);
    expect(screen.queryByText(/Your role came back empty or unrecognised/)).not.toBeInTheDocument();
  });

  it("opens an issue read-only, with the archive in the transition slot", async () => {
    seedArchivedAt("2026-10-20T10:00:00Z");
    renderBoard(ISSUE_PATH);
    const panel = await openPanel();

    const note = panel.getByText("This project was archived on Oct 20, so this issue is read-only.");
    expect(note).toHaveAttribute("tabindex", "-1");
    expect(panel.queryByRole("button", { name: /Delete issue/ })).not.toBeInTheDocument();
    expect(panel.queryByPlaceholderText("Leave a comment")).not.toBeInTheDocument();
    expect(panel.queryByRole("form", { name: "Log work" })).not.toBeInTheDocument();
    // The text stays readable, selectable and copyable (§4.3): `readOnly`.
    expect(document.querySelector("textarea.summary-textarea")).toHaveAttribute("readonly");
    expect(panel.getByRole("button", { name: /Watch/ })).toBeDisabled();
  });

  it("turns read-only from a re-read after a refused write, and says so with the request id", async () => {
    renderBoard(ISSUE_PATH);
    const panel = await openPanel();
    expect(screen.queryByText(/^Archived on/)).not.toBeInTheDocument();

    // Archived elsewhere while the panel was open: the server refuses, and its
    // next context read says so.
    failNextUpdate(archivedRefusal());
    seedArchivedAt("2026-10-20T10:00:00Z");
    fireEvent.click(panel.getByRole("button", { name: "Low" }));

    expect(await panel.findByRole("alert")).toHaveTextContent(
      "This project has been archived, so nothing in it can be changed.",
    );
    expect(panel.queryByText("Project is archived")).not.toBeInTheDocument();
    expect(panel.getByRole("button", { name: "Copy request id 7c41e2d9-archived" })).toBeVisible();
    // The board turned read-only from the context it read again.
    expect(await screen.findByText(/^Archived on Oct 20\./)).toBeVisible();
    expect(await panel.findByText("This project was archived on Oct 20, so this issue is read-only.")).toBeVisible();
  });

  it("keeps a comment the archive caught unsent, read-only", async () => {
    renderBoard(ISSUE_PATH);
    const panel = await openPanel();
    const composer = panel.getByPlaceholderText("Leave a comment");
    fireEvent.change(composer, { target: { value: "Half a thought" } });

    failNextUpdate(archivedRefusal());
    seedArchivedAt("2026-10-20T10:00:00Z");
    fireEvent.click(panel.getByRole("button", { name: "Low" }));
    await screen.findByText(/^Archived on/);

    const kept = await panel.findByDisplayValue("Half a thought");
    expect(kept).toHaveAttribute("readonly");
    expect(panel.queryByRole("button", { name: "Comment" })).not.toBeInTheDocument();
  });

  it("does not read a refusal without the reason as an archive", async () => {
    renderBoard(ISSUE_PATH);
    const panel = await openPanel();
    failNextUpdate(
      Object.assign(new Error("Transition is not available for the current issue status"), {
        status: 400,
        code: "FAILED_PRECONDITION",
      }),
    );
    seedArchivedAt("2026-10-20T10:00:00Z");
    fireEvent.click(panel.getByRole("button", { name: "Low" }));

    expect(await panel.findByRole("alert")).toHaveTextContent("Transition is not available for the current issue status");
    // Nothing asked the context again, so nothing on screen says archived.
    expect(screen.queryByText(/^Archived on/)).not.toBeInTheDocument();
  });

  /**
   * Archived by somebody else while a dialog of the board's was open (§5.7,
   * «Архив пришёл отказом записи», art-director's B1/B3/B4 on TAS-149). The
   * dialogs stay open and go read-only like Members and Workflows; focus never
   * leaves an open one; unsaved panel text keeps its Esc hold.
   */
  describe("with a dialog open when the archive arrives", () => {
    /** The board's next context read says archived — as after another session's archive. */
    const archiveArrives = async (queryClient: QueryClient) => {
      seedArchivedAt("2026-10-20T10:00:00Z");
      await queryClient.invalidateQueries({ queryKey: membershipKey });
      await screen.findByText(/^Archived on Oct 20\./);
    };
    const boardLine = () => screen.getByText(/^Archived on Oct 20\./).closest("p");
    const openNewIssue = async () => {
      await waitFor(() => expect(screen.getByRole("button", { name: "New" })).toBeEnabled());
      fireEvent.click(screen.getByRole("button", { name: "New" }));
      return within(await screen.findByRole("dialog", { name: "New issue" }));
    };
    const openLabels = async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Manage labels" }));
      return within(await screen.findByRole("dialog", { name: "Labels" }));
    };

    it("keeps New issue open with what was typed, read-only, and says why above the footer", async () => {
      const queryClient = renderBoard();
      const dialog = await openNewIssue();
      fireEvent.change(dialog.getByLabelText("Summary"), { target: { value: "A drafted issue" } });
      fireEvent.change(dialog.getByLabelText("Description"), { target: { value: "Words worth keeping" } });
      fireEvent.change(dialog.getByLabelText("Story points"), { target: { value: "3" } });

      await archiveArrives(queryClient);

      expect(await dialog.findByText("This project is archived, so issues cannot be created in it.")).toBeVisible();
      for (const [field, value] of [
        ["Summary", "A drafted issue"],
        ["Description", "Words worth keeping"],
        ["Story points", "3"],
      ]) {
        expect(dialog.getByLabelText(field)).toHaveValue(value);
        expect(dialog.getByLabelText(field)).toHaveAttribute("readonly");
      }
      expect(dialog.queryByRole("button", { name: "Create issue" })).not.toBeInTheDocument();
      // The choices stay legible and reachable, and a press does nothing. (Not
      // "Low" or "Task": the first segment of each is named by its `<label>`.)
      const high = dialog.getByRole("button", { name: "High" });
      fireEvent.click(high);
      expect(high).toHaveAttribute("aria-pressed", "false");
      expect(dialog.getByRole("button", { name: "Medium" })).toHaveAttribute("aria-pressed", "true");
      for (const segment of [high, dialog.getByRole("button", { name: "Bug" })]) {
        for (const choice of within(segment.parentElement!).getAllByRole("button")) {
          expect(choice).toHaveAttribute("aria-disabled", "true");
        }
      }
      // The ways out stay.
      expect(dialog.getByRole("button", { name: "Cancel" })).toBeVisible();
      expect(dialog.getByRole("button", { name: "Close" })).toBeVisible();
      // And Enter in a box asks for nothing.
      fireEvent.submit(dialog.getByLabelText("Summary").closest("form")!);
      expect(createCalls()).toEqual([]);
    });

    it("lets a refused create say it in place of the line, and keeps focus in the dialog", async () => {
      const queryClient = renderBoard();
      const dialog = await openNewIssue();
      fireEvent.change(dialog.getByLabelText("Summary"), { target: { value: "A drafted issue" } });
      failNextCreate(archivedRefusal());
      seedArchivedAt("2026-10-20T10:00:00Z");
      const create = dialog.getByRole("button", { name: "Create issue" });
      create.focus();
      fireEvent.click(create);

      const sentence = await dialog.findByText("This project has been archived, so nothing in it can be changed.");
      await screen.findByText(/^Archived on Oct 20\./);
      await waitFor(() => expect(dialog.queryByRole("button", { name: "Create issue" })).not.toBeInTheDocument());
      // One fact, one place: the refusal says it, so the line does not.
      expect(dialog.queryByText("This project is archived, so issues cannot be created in it.")).not.toBeInTheDocument();
      // Create issue went from under focus; focus stays inside, on the refusal —
      // not on the board's line under the scrim.
      await waitFor(() => expect(sentence.closest(".error-note")).toHaveFocus());
      expect(boardLine()).not.toHaveFocus();
      expect(dialog.getByLabelText("Summary")).toHaveValue("A drafted issue");
      void queryClient;
    });

    it("puts the line in the New label form's place, drops the row actions, and keeps focus inside", async () => {
      seedLabels([{ id: "label-backend", name: "backend", color: "#0052cc" }]);
      const queryClient = renderBoard();
      const dialog = await openLabels();
      const edit = await dialog.findByRole("button", { name: "Edit backend" });
      edit.focus();

      await archiveArrives(queryClient);

      const line = await dialog.findByText("This project is archived, so its labels cannot be changed.");
      expect(dialog.queryByLabelText("New label")).not.toBeInTheDocument();
      expect(dialog.queryByRole("button", { name: "Add label" })).not.toBeInTheDocument();
      expect(dialog.queryByRole("button", { name: "Edit backend" })).not.toBeInTheDocument();
      expect(dialog.queryByRole("button", { name: "Delete backend" })).not.toBeInTheDocument();
      // The list itself stays.
      expect(dialog.getByText("backend")).toBeVisible();
      // The pencil in focus went, and focus went to the dialog's own line.
      await waitFor(() => expect(line).toHaveFocus());
      expect(line).toHaveAttribute("tabindex", "-1");
      expect(boardLine()).not.toHaveFocus();
    });

    it("keeps a rename the archive caught open, read-only and without its Save", async () => {
      seedLabels([{ id: "label-backend", name: "backend", color: "#0052cc" }]);
      const queryClient = renderBoard();
      const dialog = await openLabels();
      fireEvent.click(await dialog.findByRole("button", { name: "Edit backend" }));
      fireEvent.change(dialog.getByLabelText("Rename backend"), { target: { value: "backend-api" } });

      await archiveArrives(queryClient);

      await dialog.findByText("This project is archived, so its labels cannot be changed.");
      const rename = dialog.getByLabelText("Rename backend");
      expect(rename).toHaveValue("backend-api");
      expect(rename).toHaveAttribute("readonly");
      expect(dialog.queryByRole("button", { name: "Save label" })).not.toBeInTheDocument();
      expect(dialog.getByRole("button", { name: "Cancel" })).toBeVisible();
      for (const swatch of within(dialog.getByRole("group", { name: "Label colour" })).getAllByRole("button")) {
        expect(swatch).toHaveAttribute("aria-disabled", "true");
      }
    });

    it("lets a refused label create say it, with no line beside it", async () => {
      const queryClient = renderBoard();
      const dialog = await openLabels();
      failNextCreate(archivedRefusal());
      seedArchivedAt("2026-10-20T10:00:00Z");
      fireEvent.change(dialog.getByLabelText("New label"), { target: { value: "release" } });
      fireEvent.click(dialog.getByRole("button", { name: "Add label" }));

      expect(await dialog.findByText("This project has been archived, so nothing in it can be changed.")).toBeVisible();
      await screen.findByText(/^Archived on Oct 20\./);
      await waitFor(() => expect(dialog.queryByLabelText("New label")).not.toBeInTheDocument());
      expect(dialog.queryByText("This project is archived, so its labels cannot be changed.")).not.toBeInTheDocument();
      void queryClient;
    });

    it("keeps the board's Edit project open with what was typed, without Save or the danger zone", async () => {
      const queryClient = renderBoard();
      fireEvent.click(await screen.findByRole("button", { name: "Edit project" }));
      const dialog = within(await screen.findByRole("dialog", { name: "Edit project" }));
      expect(dialog.getByRole("button", { name: "Archive project" })).toBeVisible();
      fireEvent.change(dialog.getByLabelText("Description"), { target: { value: "Typed and kept" } });

      await archiveArrives(queryClient);

      expect(await dialog.findByText("This project is archived, so it cannot be edited.")).toBeVisible();
      expect(dialog.getByLabelText("Description")).toHaveValue("Typed and kept");
      expect(dialog.getByLabelText("Description")).toHaveAttribute("readonly");
      expect(dialog.getByLabelText("Name")).toHaveAttribute("readonly");
      expect(dialog.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
      expect(dialog.queryByRole("region", { name: "Archive project" })).not.toBeInTheDocument();
      for (const swatch of within(dialog.getByRole("group", { name: "Project colour" })).getAllByRole("button")) {
        expect(swatch).toHaveAttribute("aria-disabled", "true");
      }
      expect(dialog.getByRole("button", { name: "Cancel" })).toBeVisible();
    });

    it("hands focus to the board's archive line when such a dialog closes, its opener gone", async () => {
      const queryClient = renderBoard();
      const dialog = await openLabels();

      await archiveArrives(queryClient);
      await dialog.findByText("This project is archived, so its labels cannot be changed.");
      expect(screen.queryByRole("button", { name: "Manage labels" })).not.toBeInTheDocument();
      fireEvent.click(dialog.getByRole("button", { name: "Close" }));

      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Labels" })).not.toBeInTheDocument());
      await waitFor(() => expect(boardLine()).toHaveFocus());
    });

    it("keeps the Esc hold on summary and description text the archive caught unsaved", async () => {
      const queryClient = renderBoard(ISSUE_PATH);
      const panel = await openPanel();
      const summary = document.querySelector<HTMLTextAreaElement>("textarea.summary-textarea")!;
      const description = panel.getByLabelText("Description");
      fireEvent.change(description, { target: { value: "Half a description" } });
      summary.focus();
      fireEvent.change(summary, { target: { value: "Wire the board to the gateway, typed on" } });

      await archiveArrives(queryClient);
      await panel.findByText("This project was archived on Oct 20, so this issue is read-only.");

      for (const [box, value] of [
        [summary, "Wire the board to the gateway, typed on"],
        [description, "Half a description"],
      ] as const) {
        expect(box).toHaveAttribute("readonly");
        expect(box).toHaveValue(value);
        expect(box).toHaveAttribute("data-unsaved-text", "true");
      }
      // Esc in kept text leaves the panel, the text and the focus where they are (§4.10).
      expect(summary).toHaveFocus();
      fireEvent.keyDown(summary, { key: "Escape" });
      description.focus();
      fireEvent.keyDown(description, { key: "Escape" });
      expect(screen.getByRole("dialog", { name: "TAS-102 issue" })).toBeInTheDocument();
      expect(summary).toHaveValue("Wire the board to the gateway, typed on");
    });

    // Only a `PROJECT_ARCHIVED` refusal stands in for a dialog's archive line
    // (art-director's round 2 on TAS-149, decision 4 refused). One of another
    // kind says nothing about the archive: the line stays under it, and the
    // line — never that refusal, which the reader may have read already — is
    // where focus goes.
    const otherRefusal = () =>
      Object.assign(new Error("Summary is too long"), { status: 400, code: "VALIDATION_ERROR", requestId: "2a9d-other" });

    it("keeps New issue's line under a refusal of another kind, and puts lost focus on the line", async () => {
      const queryClient = renderBoard();
      const dialog = await openNewIssue();
      fireEvent.change(dialog.getByLabelText("Summary"), { target: { value: "A drafted issue" } });
      failNextCreate(otherRefusal());
      const create = dialog.getByRole("button", { name: "Create issue" });
      create.focus();
      fireEvent.click(create);
      const sentence = await dialog.findByText("Summary is too long");
      expect(create).toHaveFocus();

      await archiveArrives(queryClient);

      const line = await dialog.findByText("This project is archived, so issues cannot be created in it.");
      const refusal = sentence.closest(".error-note")!;
      expect(refusal).not.toHaveAttribute("data-archive-note");
      expect(refusal).not.toHaveAttribute("tabindex");
      expect(line).toHaveAttribute("data-archive-note", "modal");
      // Under the refusal, not in its place.
      expect(refusal.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(dialog.queryByRole("button", { name: "Create issue" })).not.toBeInTheDocument();
      await waitFor(() => expect(line).toHaveFocus());
      expect(boardLine()).not.toHaveFocus();
    });

    it("keeps the Labels line beside a refusal of another kind, and puts lost focus on the line", async () => {
      const queryClient = renderBoard();
      const dialog = await openLabels();
      failNextCreate(Object.assign(new Error("A label named release already exists"), { status: 409, code: "CONFLICT" }));
      fireEvent.change(dialog.getByLabelText("New label"), { target: { value: "release" } });
      fireEvent.click(dialog.getByRole("button", { name: "Add label" }));
      const sentence = await dialog.findByText("A label named release already exists");
      dialog.getByLabelText("New label").focus();

      await archiveArrives(queryClient);

      const line = await dialog.findByText("This project is archived, so its labels cannot be changed.");
      expect(sentence).toBeVisible();
      expect(sentence.closest(".error-note")).not.toHaveAttribute("data-archive-note");
      expect(dialog.queryByLabelText("New label")).not.toBeInTheDocument();
      await waitFor(() => expect(line).toHaveFocus());
      expect(boardLine()).not.toHaveFocus();
    });

    // A Planning value typed and not sent would stand in a read-only box as if
    // the issue held it (§5.7): the turn puts it back to the stored one, as a
    // refused write does (§5.5). Free text is the reader's work and stays.
    it("puts unsent planning drafts back to the stored values when the archive arrives", async () => {
      const queryClient = renderBoard(ISSUE_PATH);
      const panel = await openPanel();
      const points = await panel.findByLabelText("Story points");
      const estimate = panel.getByLabelText("Original estimate");
      expect(points).toHaveValue("3");
      fireEvent.change(estimate, { target: { value: "2h" } });
      points.focus();
      fireEvent.change(points, { target: { value: "13" } });

      await archiveArrives(queryClient);
      await panel.findByText("This project was archived on Oct 20, so this issue is read-only.");

      expect(points).toHaveValue("3");
      expect(estimate).toHaveValue("8h");
      for (const box of [points, estimate]) {
        expect(box).toHaveAttribute("readonly");
        // Nothing unsaved is left in it, so Esc there closes the panel as anywhere.
        expect(box).not.toHaveAttribute("data-unsaved-text");
      }
      // Leaving the box sends nothing: there is nothing left to send, and no write.
      fireEvent.blur(points);
      expect(updateCalls()).toEqual([]);
    });
  });
});

describe("board failures the user can see", () => {
  beforeEach(() => {
    reset();
    window.localStorage.clear();
  });

  it("says the role could not be loaded rather than presenting a silent read-only board", async () => {
    failMembership(Object.assign(new Error("Internal error"), { status: 500, requestId: "6f1c2b40-a1e2-4d55" }));
    renderBoard();

    const alert = await screen.findByRole("alert", undefined, AFTER_RETRY);
    expect(alert).toHaveTextContent(/project could not be loaded/i);
    expect(alert).toHaveTextContent(/editing is off/i);
    // The gateway's own words and the id that finds this failure in its log sit
    // beside the sentence, not inside its live region: `role="alert"` is
    // assertive and atomic, and a screen reader should not be interrupted to
    // hear a UUID spelled out.
    expect(alert).not.toHaveTextContent("Internal error");
    expect(screen.getByText("Internal error")).toBeVisible();
    expect(screen.getByRole("button", { name: /Copy request id 6f1c2b40-a1e2-4d55/ })).toBeVisible();
    // Still no write access: a role we could not verify is not a role.
    expect(screen.getByRole("button", { name: "New" })).toBeDisabled();
  });

  // The first fix read `membershipQuery.isError`, and react-query resets a
  // query with no data to `status:"pending", error:null` at the *start* of
  // every refetch. So the explanation disappeared on each refocus while the
  // controls it explained stayed off — the silent read-only board of TAS-163,
  // back on a timer.
  it("keeps saying so while it retries, instead of going quiet on every refetch", async () => {
    failMembership(Object.assign(new Error("Internal error"), { status: 500 }));
    const queryClient = renderBoard();
    await screen.findByRole("alert", undefined, AFTER_RETRY);

    holdMembership(true);
    void queryClient.refetchQueries({ queryKey: membershipKey });

    // The window this is about: react-query has thrown the error away and put
    // the query back into `pending`, with no data to show for it.
    await waitFor(() => expect(queryClient.getQueryState(membershipKey)?.status).toBe("pending"));
    expect(queryClient.getQueryState(membershipKey)?.error).toBeNull();

    expect(screen.getByRole("alert")).toHaveTextContent(/project could not be loaded/i);
    expect(screen.getByRole("button", { name: "New" })).toBeDisabled();
    // And the gateway's words are kept across the gap, so the banner does not
    // shrink and grow while the request is in flight.
    expect(screen.getByText("Internal error")).toBeVisible();
  });

  // The other direction of the same mistake: `isError` is *also* true when a
  // background refetch fails while the previous answer is still cached. The
  // board was then fully writable — New, the column "+", the drop targets —
  // under a banner announcing that writing was off.
  it("does not claim writes are off while a cached role still says otherwise", async () => {
    const queryClient = renderBoard();
    await waitFor(() => expect(screen.getByRole("button", { name: "New" })).toBeEnabled());

    failMembership(new Error("Internal error"));
    void queryClient.refetchQueries({ queryKey: membershipKey });
    await waitFor(() => expect(queryClient.getQueryState(membershipKey)?.status).toBe("error"), AFTER_RETRY);

    // Data was retained, so the role is not unknown and nothing changed.
    expect(screen.getByRole("button", { name: "New" })).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not accuse the server when the answer was VIEWER", async () => {
    setMembership("VIEWER");
    renderBoard();

    // Read-only is a permission, not a fault, and gets no banner. New is drawn,
    // disabled, while the role is on the way and hidden once it says VIEWER
    // (§5.7, TAS-236) — so its going is what says this is the answered state
    // and not the in-flight one.
    await waitFor(() => expect(screen.queryByRole("button", { name: "New" })).not.toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  // An answered read that names no role this build can act on — the project
  // read's `currentUserRole` absent, `null` or unrecognised. Until TAS-226 the
  // rest leg floored that to VIEWER, and the board went read-only as silently
  // as TAS-163's did, from a request that had not even failed.
  it("says so when the role came back as nothing it recognises, and keeps writes off", async () => {
    setMembership(null);
    renderBoard();

    const alert = await screen.findByRole("alert");
    // Its own sentence: "could not be loaded" would be false about a read that
    // answered, and "read-only" would be the VIEWER it is not.
    expect(alert).toHaveTextContent(/came back empty or unrecognised/i);
    expect(alert).not.toHaveTextContent(/could not be loaded/i);
    expect(screen.getByRole("button", { name: "New" })).toBeDisabled();
    // Nothing failed, so there is no message or request id to print under it.
    expect(screen.queryByRole("button", { name: /Copy request id/ })).not.toBeInTheDocument();
  });

  it("keeps that banner and the switched-off controls in step across a refetch", async () => {
    setMembership(null);
    const queryClient = renderBoard();
    await screen.findByRole("alert");

    // In flight, the query keeps the answer it is replacing — so both halves
    // stay, because both read that one answer.
    holdMembership(true);
    void queryClient.refetchQueries({ queryKey: membershipKey });
    await waitFor(() => expect(queryClient.getQueryState(membershipKey)?.fetchStatus).toBe("fetching"));
    expect(screen.getByRole("alert")).toHaveTextContent(/came back empty or unrecognised/i);
    expect(screen.getByRole("button", { name: "New" })).toBeDisabled();

    // And an answer that names a role takes both away together.
    holdMembership(false);
    setMembership("ADMIN");
    void queryClient.refetchQueries({ queryKey: membershipKey });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "New" })).toBeEnabled();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  it("explains a project that failed to load instead of falling back to the word Project", async () => {
    failProject(Object.assign(new Error("Internal error"), { status: 500, requestId: "c85c0694-7909-4a8a" }));
    renderBoard();

    const alerts = await screen.findAllByRole("alert", undefined, AFTER_RETRY);
    const projectAlert = alerts.find((alert) => /project could not be loaded/i.test(alert.textContent ?? ""));
    expect(projectAlert).toBeDefined();
    expect(screen.getByRole("button", { name: /Copy request id c85c0694-7909-4a8a/ })).toBeVisible();
    // The fallback title is still there — the banner is what stops it reading
    // as the project's actual name.
    expect(screen.getByText("Project")).toBeVisible();
  });

  it("leaves an editor's board alone", async () => {
    renderBoard();

    await waitFor(() => expect(screen.getByRole("button", { name: "New" })).toBeEnabled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  // §4.18's screen has the same failure mode as the banners: reading `isError`
  // handed the project's own chrome — its name, its filters, its columns —
  // back to a visitor the gateway had already refused, for the length of every
  // refetch.
  it("keeps a refused project refused while it asks again", async () => {
    failProject(Object.assign(new Error("Project not found"), { status: 404, code: "NOT_FOUND" }));
    const queryClient = renderBoard();
    await screen.findByRole("heading", { name: /not found/i }, AFTER_RETRY);

    holdProject(true);
    void queryClient.refetchQueries({ queryKey: membershipKey });
    await waitFor(() => expect(queryClient.getQueryState(membershipKey)?.status).toBe("pending"));

    expect(screen.getByRole("heading", { name: /not found/i })).toBeVisible();
    expect(screen.queryByRole("button", { name: "New" })).not.toBeInTheDocument();
  });
});

// A board with no issue list said "0" in the column head, "0 of 0" in the
// filter bar and "Drop issues here" in every column — three claims about the
// project, made by a request that never answered, one of them an invitation to
// drop a card into a column whose contents are unknown.
describe("a board that could not read its issues", () => {
  beforeEach(() => {
    reset();
    window.localStorage.clear();
  });

  it("counts nothing rather than counting zero", async () => {
    failIssues(Object.assign(new Error("Internal error"), { status: 500 }));
    renderBoard();

    const alert = await screen.findByRole("alert", undefined, AFTER_RETRY);
    expect(alert).toHaveTextContent(/issues on this board could not be loaded/i);

    const column = screen.getByRole("region", { name: "To Do column" });
    expect(within(column).queryByText("0")).not.toBeInTheDocument();
    expect(within(column).getAllByText("—").length).toBeGreaterThan(0);
    // The dashes carry the word for a screen reader, in both places.
    expect(within(column).getAllByText("unknown").length).toBeGreaterThan(0);
    expect(screen.queryByText("0 of 0")).not.toBeInTheDocument();

    // And no column offers itself as a target for a card.
    expect(screen.queryByText("Drop issues here")).not.toBeInTheDocument();
    expect(within(column).getByText("Not loaded")).toBeVisible();
  });

  it("still counts a genuine zero", async () => {
    renderBoard();

    const column = await screen.findByRole("region", { name: "To Do column" });
    // One seeded issue, and the counter states it.
    expect(within(column).getByText("1")).toBeVisible();
    expect(screen.getByText("1 of 1")).toBeVisible();
  });

  // "0 of 0" from a request that has not answered is the same claim as "0 of 0"
  // from one that failed. §5.6: loading is a skeleton.
  it("counts nothing while the issues are still on their way", async () => {
    renderBoard();

    expect(await screen.findByText("Board")).toBeVisible();
    expect(screen.queryByText("0 of 0")).not.toBeInTheDocument();
    // Then the real numbers arrive.
    expect(await screen.findByText("1 of 1")).toBeVisible();
  });
});

/**
 * The board read itself (TAS-202, DESIGN.md §4.9): the columns are the board's
 * own; until it has answered, and after it failed, the columns are predicted
 * from the context; a failed board read — a 404 included — is a banner over
 * "Not loaded" columns, never the not-found screen; and a card's face is the
 * assignee the server joined in.
 */
describe("the board read", () => {
  beforeEach(() => {
    reset();
    window.localStorage.clear();
  });

  const twoStatuses = {
    statuses: [
      { id: "s1", statusKey: "TODO", name: "To Do", category: "TODO", sortOrder: 10 },
      { id: "s2", statusKey: "IN_PROGRESS", name: "In Progress", category: "IN_PROGRESS", sortOrder: 20 },
    ],
    transitions: [],
  };

  it("keeps the skeleton, in the context's predicted columns, until the board has answered", async () => {
    seedContextWorkflowParts(twoStatuses);
    holdBoard(true);
    renderBoard();

    await screen.findByText("Taska Platform");
    await waitFor(() =>
      expect([...document.querySelectorAll(".columns-area .board-column strong")].map((node) => node.textContent)).toEqual([
        "To Do",
        "In Progress",
      ]),
    );
    expect(document.querySelectorAll(".skeleton-card").length).toBeGreaterThan(0);
    // Pending, not zero.
    expect(screen.queryByText("0 of 0")).not.toBeInTheDocument();
  });

  it("draws the predicted columns not loaded, one banner and Unknown of Unknown when the board read fails", async () => {
    seedContextWorkflowParts(twoStatuses);
    seedExtraIssues([{ id: "issue-2", issueKey: "TAS-160", summary: "Waiting on QA", status: "BLOCKED_BY_QA" }]);
    failIssues(Object.assign(new Error("Internal error"), { status: 500, requestId: "9b1e-board" }));
    renderBoard();

    const alert = await screen.findByRole("alert", undefined, AFTER_RETRY);
    expect(alert).toHaveTextContent("The issues on this board could not be loaded.");
    expect(screen.getByRole("button", { name: /Copy request id 9b1e-board/ })).toBeVisible();
    expect(screen.getByRole("region", { name: "To Do column" })).toBeVisible();
    expect(screen.getByRole("region", { name: "In Progress column" })).toBeVisible();
    expect(screen.getAllByText("Not loaded")).toHaveLength(2);
    expect(screen.getAllByText("unknown").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByRole("region", { name: "Outside their workflow" })).not.toBeInTheDocument();
  });

  it("takes a 404 from the board as that failure, and not as a project that is not there", async () => {
    failIssues(Object.assign(new Error("Project not found"), { status: 404, code: "NOT_FOUND" }));
    renderBoard();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The issues on this board could not be loaded.");
    expect(screen.getByText("Taska Platform")).toBeVisible();
    expect(screen.getByText("Not loaded")).toBeVisible();
  });

  it("draws a card's assignee as the server named them, in the colour of their member row", async () => {
    seedMembers([
      { userId: "user-tom", role: "MEMBER", addedAt: "2026-08-01T09:00:00Z", addedBy: "user-anna", user: { displayName: "Tom Baker", email: "tom@example.com" } },
    ]);
    seedBoardNames({ "user-tom": "Tom Baker" });
    seedExtraIssues([
      { id: "issue-2", issueKey: "TAS-103", summary: "Named", assigneeId: "user-tom" },
      // A person the server could not name — its profile read failed.
      { id: "issue-3", issueKey: "TAS-104", summary: "Unnamed", assigneeId: "user-ghost" },
    ]);
    renderBoard();

    const named = await screen.findByRole("button", { name: /TAS-103/ });
    const face = within(named).getByLabelText("Tom Baker");
    expect(face).toHaveTextContent("TB");

    const unnamed = screen.getByRole("button", { name: /TAS-104/ });
    const ghost = within(unnamed).getByLabelText("Unknown assignee");
    // Somebody is assigned: a filled circle, not the dashed empty one, and no
    // initials of a name nobody sent.
    expect(ghost).not.toHaveClass("avatar-empty");
    expect(ghost).toHaveTextContent("");
    expect(ghost.getAttribute("style")).toContain("background-color");

    // Nobody assigned is still the dashed circle.
    const seeded = screen.getByRole("button", { name: /TAS-102/ });
    expect(within(seeded).getByLabelText("Unassigned")).toHaveClass("avatar-empty");
  });
});

/**
 * The board's four filters since TAS-202 (DESIGN.md §5.4): all local, over one
 * complete board read — no request for any filter or keystroke, a result on
 * the first character with no debounce and no minimum length — and "X of Y"
 * with X every card drawn, columns and «Outside their workflow» together, and
 * Y every card the read holds.
 */
describe("the board's filters", () => {
  beforeEach(() => {
    reset();
    window.localStorage.clear();
  });

  const filter = async (text: string) => {
    const box = await screen.findByRole("textbox", { name: "Filter issues by key, summary or description" });
    fireEvent.change(box, { target: { value: text } });
    return box;
  };

  it("is a filter of this board, named as one", async () => {
    renderBoard();

    const box = await screen.findByRole("textbox", { name: "Filter issues by key, summary or description" });
    expect(box).toHaveAttribute("placeholder", "Filter issues");
  });

  it("keeps a card whose description matches, on the first character, with nothing on the wire", async () => {
    const searches = vi.spyOn(fakeApi, "searchIssues");
    renderBoard();
    await screen.findByRole("button", { name: /TAS-102/ });
    const reads = boardReads();

    // "deployed" is in TAS-102's description and in neither its summary nor
    // its key.
    await filter("deployed");
    expect(screen.getByRole("button", { name: /TAS-102/ })).toBeVisible();
    expect(screen.getByText("1 of 1")).toBeVisible();
    // One character is a question too: no minimum length.
    await filter("z");
    expect(screen.queryByRole("button", { name: /TAS-102/ })).not.toBeInTheDocument();
    expect(screen.getByText("0 of 1")).toBeVisible();

    expect(boardReads()).toBe(reads);
    expect(searches).not.toHaveBeenCalled();
    searches.mockRestore();
  });

  it("combines type, assignee, label and text, locally, and counts what it draws out of the whole board", async () => {
    seedMembers([
      { userId: "user-tom", role: "MEMBER", addedAt: "2026-08-01T09:00:00Z", addedBy: "user-anna", user: { displayName: "Tom Baker", email: "tom@example.com" } },
    ]);
    seedBoardNames({ "user-tom": "Tom Baker" });
    seedLabels([{ id: "label-ui", name: "ui", color: "#0052cc" }]);
    seedExtraIssues([
      { id: "issue-2", issueKey: "TAS-103", issueType: "BUG", summary: "Chip contrast", assigneeId: "user-tom", labels: [{ id: "label-ui", name: "ui", color: "#0052cc" }] },
      { id: "issue-3", issueKey: "TAS-104", issueType: "BUG", summary: "Chip spacing", assigneeId: "user-tom", labels: [] },
      // No description at all: matched on its key and its summary only.
      { id: "issue-4", issueKey: "TAS-105", issueType: "STORY", summary: "Board chips", description: null },
    ]);
    renderBoard();
    await screen.findByRole("button", { name: /TAS-103/ });
    const reads = boardReads();
    expect(screen.getByText("4 of 4")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Bug" }));
    expect(screen.getByText("2 of 4")).toBeVisible();
    fireEvent.click(within(document.querySelector(".assignee-row") as HTMLElement).getByRole("button", { name: "Tom Baker" }));
    expect(screen.getByText("2 of 4")).toBeVisible();
    fireEvent.change(screen.getByRole("combobox", { name: "Label" }), { target: { value: "label-ui" } });
    expect(screen.getByText("1 of 4")).toBeVisible();
    expect(screen.getByRole("button", { name: /TAS-103/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: /TAS-104/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    await filter("chips");
    expect(screen.getByText("1 of 4")).toBeVisible();
    expect(screen.getByRole("button", { name: /TAS-105/ })).toBeVisible();

    expect(boardReads()).toBe(reads);
  });

  it("counts «Outside their workflow» in X and the whole read in Y", async () => {
    seedExtraIssues([{ id: "issue-2", issueKey: "TAS-160", summary: "Waiting on QA", status: "BLOCKED_BY_QA" }]);
    renderBoard();

    const group = await screen.findByRole("region", { name: "Outside their workflow" });
    expect(within(group).getByRole("button", { name: /TAS-160/ })).toBeVisible();
    expect(screen.getByText("2 of 2")).toBeVisible();

    await filter("qa");
    expect(screen.getByText("1 of 2")).toBeVisible();
    // The group leaves with the last card the filters keep in it.
    await filter("wire");
    expect(screen.getByText("1 of 2")).toBeVisible();
    expect(screen.queryByRole("region", { name: "Outside their workflow" })).not.toBeInTheDocument();
  });

  it("moves both halves when a matching issue is created", async () => {
    renderBoard();
    await screen.findByRole("button", { name: /TAS-102/ });
    await filter("deployed");
    expect(screen.getByText("1 of 1")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "New" }));
    // Scoped to the modal: each column head carries a "+" whose title is also
    // "Create issue".
    const dialog = await screen.findByRole("dialog", { name: "New issue" });
    fireEvent.change(within(dialog).getByLabelText("Summary"), { target: { value: "Second deployed gateway task" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create issue" }));

    // The board is read again after the create, and both halves come from it.
    expect(await screen.findByText("2 of 2")).toBeVisible();
  });

  it("moves X when a summary is edited out of its match, and keeps Y", async () => {
    renderBoard(`/projects/${PROJECT_ID}/issues/issue-1`);
    await screen.findByRole("region", { name: "To Do column" });
    // "wire" is in the seeded summary and in neither its description nor its key.
    await filter("wire");
    expect(await screen.findByText("1 of 1")).toBeVisible();

    const summary = document.querySelector(".summary-textarea") as HTMLTextAreaElement;
    fireEvent.change(summary, { target: { value: "Connect the board to the live gateway" } });
    fireEvent.blur(summary);

    expect(await screen.findByText("0 of 1")).toBeVisible();
  });

  it("moves both halves when the matching issue is deleted", async () => {
    renderBoard(`/projects/${PROJECT_ID}/issues/issue-1`);
    await screen.findByRole("region", { name: "To Do column" });
    await filter("deployed");
    expect(await screen.findByText("1 of 1")).toBeVisible();

    fireEvent.click(await screen.findByRole("button", { name: "Delete issue TAS-102" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete issue" }));

    expect(await screen.findByText("0 of 0")).toBeVisible();
  });
});

/**
 * DESIGN.md §4.12 has asked for both ways out of this popover since before it
 * shipped — «Закрытие: Esc, клик вне» — and until now the bell was the only
 * one. §7 carried it as a written defect rather than an oversight. The
 * behaviour is `useDismissOnOutside`, shared with the profile menu and the
 * global search, so what these three assertions actually protect is the one
 * copy all of them use.
 *
 * The bell itself is `src/components/NotificationsBell.tsx` since TAS-185, and
 * these stay here rather than moving with it: they are about the bell as it is
 * mounted, and this file already has the fake `TaskaApi` and the router it
 * needs. The shared bar mounts the same component, so a regression here is a
 * regression on `/projects` and `/admin` too.
 */
describe("the notifications popover", () => {
  beforeEach(() => {
    reset();
    window.localStorage.clear();
  });

  const openBell = async () => {
    const bell = await screen.findByRole("button", { name: "Notifications" });
    fireEvent.click(bell);
    return bell;
  };

  it("closes on Escape and on a press outside, and still toggles from its own bell", async () => {
    renderBoard();

    const bell = await openBell();
    expect(screen.getByRole("button", { name: "Mark all read" })).toBeVisible();
    expect(bell).toHaveAttribute("aria-expanded", "true");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("button", { name: "Mark all read" })).not.toBeInTheDocument();

    fireEvent.click(bell);
    expect(screen.getByRole("button", { name: "Mark all read" })).toBeVisible();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("button", { name: "Mark all read" })).not.toBeInTheDocument();

    // The press that would otherwise close it and let the toggle reopen it in
    // the same click. The ref wraps the bell, so the outside handler never
    // runs and the toggle closes it exactly once.
    fireEvent.click(bell);
    expect(screen.getByRole("button", { name: "Mark all read" })).toBeVisible();
    fireEvent.pointerDown(bell);
    fireEvent.click(bell);
    expect(screen.queryByRole("button", { name: "Mark all read" })).not.toBeInTheDocument();
    expect(bell).toHaveAttribute("aria-expanded", "false");
  });
});

/**
 * A notification states the issue it is about (TAS-243): `issueId` and
 * `projectId` are on the wire, and the route is built from those two alone.
 * Which rows get a route is `notificationRoute`'s job and is tested in
 * src/domain/notifications.test.ts. These are about what the popover then
 * does: go there in the same click, with nothing read in between, or stay put
 * and say the row opens nothing.
 *
 * The popover lives in `src/components/NotificationsBell.tsx` since TAS-185 and
 * is reached from two bars. Nothing here depends on which one: the route comes
 * from the notification, never from the screen. Following it from a screen
 * that has no project is pinned in e2e/notifications.spec.ts, which is the
 * only place a real router can say so.
 */
describe("a notification that is pressed", () => {
  beforeEach(() => {
    reset();
    window.localStorage.clear();
  });

  const ISSUE_ID = "be54f4ca-3b2f-4d81-9f0a-1c7c0a5e11d2";

  const notification = (over: Partial<Notification> & { id: string; body: string }): Notification => ({
    notificationType: "ISSUE_ASSIGNED",
    title: "Issue assigned",
    issueId: null,
    issueKey: null,
    projectId: null,
    createdAt: "2026-08-01T08:00:00Z",
    readAt: null,
    sourceEventId: `event-${over.id}`,
    ...over,
  });

  const openBell = async () => {
    fireEvent.click(await screen.findByRole("button", { name: /^Notifications(, \d+ unread)?$/ }));
  };

  const where = () => screen.getByTestId("whereabouts").textContent;

  it("opens the issue it names, in the project it names, in the same click", async () => {
    // A project other than the open board's on purpose: a route built from the
    // board's own `projectId` would look right in every other test.
    seedNotifications([
      notification({
        id: "n1",
        body: "TAS-107 was assigned to you",
        issueId: ISSUE_ID,
        issueKey: "OTH-9",
        projectId: OTHER_PROJECT_ID,
      }),
    ]);
    renderBoard();
    await openBell();

    // A row that opens something does not carry the dead-end line.
    expect(screen.queryByText(/Nothing to open/)).not.toBeInTheDocument();
    fireEvent.click(await screen.findByText("TAS-107 was assigned to you"));

    // No `waitFor`: the destination is there when the click returns, which is
    // the proof that nothing was read on the way. The read that used to stand
    // here resolved the project; the notification states it now.
    expect(where()).toBe(`/projects/${OTHER_PROJECT_ID}/issues/${ISSUE_ID}`);
    // Navigating closes the panel, the way it always did.
    expect(screen.queryByRole("button", { name: "Mark all read" })).not.toBeInTheDocument();
    // And the mark still lands, though the panel that asked for it is gone:
    // the write's callbacks are the mutation's own, not the panel's.
    await waitFor(() => expect(readNotifications()).toContain("n1"));
    await waitFor(() => expect(screen.getByRole("button", { name: /^Notifications/ })).toHaveAccessibleName("Notifications"));
  });

  it.each([
    [
      "not about an issue",
      { notificationType: "MEMBER_ADDED", title: "Added to a project", body: "Sofia added you to Taska Platform" },
    ],
    [
      // The ids arrived with a migration that did not backfill, and the body
      // of a row that old names the issue by uuid — which must not be mined.
      "an issue notification from before the gateway stated the issue",
      { notificationType: "ISSUE_TRANSITIONED", title: "Status changed", body: `Задача ${ISSUE_ID} переведена в статус DONE` },
    ],
    [
      "about an issue that has been deleted",
      {
        notificationType: "ISSUE_DELETED",
        title: "Issue deleted",
        body: "TAS-100 was deleted",
        issueId: ISSUE_ID,
        issueKey: "TAS-100",
        projectId: PROJECT_ID,
      },
    ],
  ] as const)("marks a notification %s read and stays where it is", async (_case, over) => {
    seedNotifications([notification({ id: "n3", ...over })]);
    renderBoard();
    await openBell();

    const row = await screen.findByText(over.body);
    fireEvent.click(row);

    await waitFor(() => expect(readNotifications()).toContain("n3"));
    expect(where()).toBe(`/projects/${PROJECT_ID}/board`);
    // Still open: a row that goes nowhere does not close the panel behind a
    // reader who wanted to read on.
    expect(screen.getByRole("button", { name: "Mark all read" })).toBeVisible();
    // And it does not offer itself as something that opens. The class carries
    // `cursor: default`, which is worth nothing on a phone or on the keyboard
    // path, so the row says it in words — inside the button, where it reaches
    // the accessible name.
    const button = row.closest("button");
    expect(button).toHaveClass("is-inert");
    expect(button).toHaveTextContent(/Nothing to open/);
  });
});

/**
 * What is unread, and who says so. The count is the server's — `unreadCount`
 * covers the whole inbox, the page holds twenty — and DESIGN.md §7 wants it in
 * the trigger's accessible name as well as in the dot. The two writes that
 * change it are optimistic (AGENTS.md): the dots move on the press, and a
 * refusal puts them back and says so.
 */
describe("what the bell and its rows say is unread", () => {
  beforeEach(() => {
    reset();
    window.localStorage.clear();
  });

  const notification = (id: string, readAt: string | null, title = `Notification ${id}`): Notification => ({
    id,
    notificationType: "MEMBER_ADDED",
    title,
    body: `Body of ${id}`,
    issueId: null,
    issueKey: null,
    projectId: null,
    createdAt: "2026-08-01T08:00:00Z",
    readAt,
    sourceEventId: `event-${id}`,
  });

  const bell = () => screen.getByRole("button", { name: /^Notifications(, \d+ unread)?$/ });
  const dot = () => document.querySelector(".notification-dot");
  const unreadRows = () => document.querySelectorAll(".notification-item .read-dot.is-unread").length;

  it("takes the count from the server rather than from the rows it was sent", async () => {
    // One row on the page and it is read; the inbox holds five unread
    // elsewhere. Counting the page would say nothing is unread.
    seedNotifications([notification("n1", "2026-08-01T08:30:00Z")]);
    seedUnreadCount(5);
    renderBoard();

    await waitFor(() => expect(bell()).toHaveAccessibleName("Notifications, 5 unread"));
    expect(dot()).not.toBeNull();
  });

  it("says nothing about a count, and draws no dot, when nothing is unread", async () => {
    seedNotifications([notification("n1", "2026-08-01T08:30:00Z")]);
    renderBoard();

    fireEvent.click(await screen.findByRole("button", { name: "Notifications" }));
    // The row is the sign the read has landed; the name is the same before it
    // does, so asserting on the name alone would prove nothing.
    await screen.findByText("Body of n1");
    expect(bell()).toHaveAccessibleName("Notifications");
    expect(dot()).toBeNull();
  });

  it("says a row is unread in words, not only in the colour of its dot", async () => {
    seedNotifications([notification("n1", null, "Fresh"), notification("n2", "2026-08-01T08:30:00Z", "Seen")]);
    renderBoard();
    fireEvent.click(await screen.findByRole("button", { name: "Notifications, 1 unread" }));

    // `\s*` because jsdom's name computation trims each node and knows no
    // layout; Chromium, which does, separates the flex items with a space
    // (pinned in e2e/notifications.spec.ts).
    expect(await screen.findByRole("button", { name: /^Unread:\s*Fresh/ })).toBeVisible();
    // A read row says nothing about it: read is what a reader assumes.
    expect(screen.getByRole("button", { name: /^Seen/ })).not.toHaveAccessibleName(/unread/i);
  });

  it("marks one read on the press, before the server answers", async () => {
    seedNotifications([notification("n1", null), notification("n2", null)]);
    holdNotificationWrites(true);
    const client = renderBoard();
    fireEvent.click(await screen.findByRole("button", { name: "Notifications, 2 unread" }));

    fireEvent.click(await screen.findByText("Body of n1"));
    await waitFor(() => expect(heldNotificationWriteCount()).toBe(1));

    // The server has not answered, and the row, the count and the name have
    // all moved anyway.
    expect(unreadRows()).toBe(1);
    expect(bell()).toHaveAccessibleName("Notifications, 1 unread");

    releaseNotificationWrites();
    // Settled by a re-read of the inbox, and the re-read agrees.
    await waitFor(() => expect(client.isMutating() + client.isFetching({ queryKey: ["notifications"] })).toBe(0));
    expect(readNotifications()).toContain("n1");
    expect(unreadRows()).toBe(1);
    expect(bell()).toHaveAccessibleName("Notifications, 1 unread");
  });

  it("puts a row back and says so when the server refuses to mark it", async () => {
    seedNotifications([notification("n1", null)]);
    failMarkRead(Object.assign(new Error("Notification not found"), { status: 404, requestId: "5e1a9c07-22bd" }));
    renderBoard();
    fireEvent.click(await screen.findByRole("button", { name: "Notifications, 1 unread" }));

    fireEvent.click(await screen.findByText("Body of n1"));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/could not be marked read/i);
    expect(screen.getByText("Notification not found")).toBeVisible();
    expect(unreadRows()).toBe(1);
    expect(bell()).toHaveAccessibleName("Notifications, 1 unread");
  });

  it("marks everything read on the press, before the server answers", async () => {
    seedNotifications([notification("n1", null), notification("n2", null), notification("n3", "2026-08-01T08:30:00Z")]);
    holdNotificationWrites(true);
    const client = renderBoard();
    fireEvent.click(await screen.findByRole("button", { name: "Notifications, 2 unread" }));
    await screen.findByText("Body of n1");

    fireEvent.click(screen.getByRole("button", { name: "Mark all read" }));
    await waitFor(() => expect(heldNotificationWriteCount()).toBe(1));

    expect(unreadRows()).toBe(0);
    expect(bell()).toHaveAccessibleName("Notifications");
    expect(dot()).toBeNull();

    releaseNotificationWrites();
    // Settled by a re-read of the inbox, and the re-read agrees.
    await waitFor(() => expect(client.isMutating() + client.isFetching({ queryKey: ["notifications"] })).toBe(0));
    expect(unreadRows()).toBe(0);
    expect(bell()).toHaveAccessibleName("Notifications");
  });

  it("puts every dot back and says so when marking everything read fails", async () => {
    seedNotifications([notification("n1", null), notification("n2", null)]);
    failMarkAll(Object.assign(new Error("Internal error"), { status: 500, requestId: "3d9b7a12-44ef-4c08" }));
    renderBoard();
    fireEvent.click(await screen.findByRole("button", { name: "Notifications, 2 unread" }));
    await screen.findByText("Body of n1");

    fireEvent.click(screen.getByRole("button", { name: "Mark all read" }));

    // A rollback on its own would be silent: every dot back on, and nothing
    // saying why. The panel says why, with the server's words and its id.
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/Notifications could not be marked read/);
    expect(screen.getByText("Internal error")).toBeVisible();
    expect(screen.getByRole("button", { name: /Copy request id 3d9b7a12-44ef-4c08/ })).toBeVisible();
    expect(unreadRows()).toBe(2);
    expect(bell()).toHaveAccessibleName("Notifications, 2 unread");
    expect(dot()).not.toBeNull();
  });
});

/**
 * A workflow that could not be read used to be indistinguishable from one that
 * had not arrived: both left `workflowQuery.data` undefined, and the fallback
 * filled the gap with four transition ids copied from this repository's own
 * mock seed. The board then offered moves the server had never described, and a
 * drop posted one of those ids to a gateway that has never heard of it
 * (api-contract-guard, TAS-163). The columns are still drawn — their keys come
 * from the contract's `IssueStatus` — but nothing may be moved.
 */
describe("a board that could not read its workflow", () => {
  beforeEach(() => {
    reset();
    window.localStorage.clear();
  });

  it("says so, and still draws the board's own columns and cards", async () => {
    failWorkflow(Object.assign(new Error("Internal error"), { status: 500, requestId: "0b41d8a2-77c4-4a1f" }));
    renderBoard();

    const alerts = await screen.findAllByRole("alert", undefined, AFTER_RETRY);
    // One banner since TAS-251: the workflow is a part of the context read, and
    // a part failing fails the whole of it on the server.
    expect(alerts.some((alert) => /labels and workflow are missing/i.test(alert.textContent ?? ""))).toBe(true);
    expect(screen.getByRole("button", { name: /Copy request id 0b41d8a2-77c4-4a1f/ })).toBeVisible();

    // The board is still a board: its columns come from its own read since
    // TAS-202, and the issue sits where that read put it.
    expect(within(screen.getByRole("region", { name: "To Do column" })).getByText(/TAS-102/)).toBeVisible();
    expect(screen.getByText("1 of 1")).toBeVisible();
  });

  it("draws the three contract statuses, not loaded, when the board read failed too", async () => {
    failWorkflow(Object.assign(new Error("Internal error"), { status: 500 }));
    failIssues(Object.assign(new Error("Internal error"), { status: 500 }));
    renderBoard();

    await screen.findAllByRole("alert", undefined, AFTER_RETRY);
    await waitFor(() => expect(screen.getByRole("region", { name: "In Progress column" })).toBeVisible(), AFTER_RETRY);
    expect(screen.getAllByText("Not loaded")).toHaveLength(3);
  });

  // The refusal of the drop itself, and the keyboard half of the same defect —
  // the panel's transition buttons — are in e2e/board-drag.spec.ts: both need a
  // real drag or the whole issue panel, and both are only meaningful against an
  // API that would accept the invented id, which the mock does.
});

/**
 * The board's own drop move (TAS-202, DESIGN.md §5.3): the card goes to its
 * place in the target column the moment it is dropped, by the comparator the
 * server's order is modelled on, and goes back to the board it came from if the
 * server refuses — with the board read again, because a move that timed out may
 * have been applied. Both live in the window between the drop and the answer,
 * which a fake that answers on the next tick has none of: the move is held open
 * here, and the board read stays held after it so that what is on screen is the
 * cache's doing and not a re-read's.
 *
 * The drop is a real gesture — press, cross the activation distance, travel,
 * release — over rectangles of our own, since jsdom has no layout for dnd-kit
 * to find a column in. Moves out of the panel, with their buttons, are
 * e2e/board-drag.spec.ts's.
 */
describe("a card dropped on another column", () => {
  const workflow = {
    statuses: [
      { id: "s-todo", statusKey: "TODO", name: "To Do", category: "TODO", sortOrder: 10 },
      { id: "s-progress", statusKey: "IN_PROGRESS", name: "In Progress", category: "IN_PROGRESS", sortOrder: 20 },
      { id: "s-done", statusKey: "DONE", name: "Done", category: "DONE", sortOrder: 30 },
    ],
    transitions: [{ id: "t-start", fromStatusId: "s-todo", toStatusId: "s-progress", name: "Start Progress", sortOrder: 10 }],
  };
  /**
   * In Progress holds, in the order the server sends it, two tasks and a bug.
   * The seeded TAS-102 is a task made on 2026-08-01, so by the comparator it
   * belongs between the two tasks and ahead of the bug — neither first nor
   * last, which is the only place a placement by the comparator is told from
   * an append or a prepend.
   */
  const inProgress = [
    { id: "issue-old", issueKey: "TAS-201", summary: "Oldest task", status: "IN_PROGRESS", createdAt: "2026-07-01T09:00:00Z" },
    { id: "issue-new", issueKey: "TAS-203", summary: "Newest task", status: "IN_PROGRESS", createdAt: "2026-09-01T09:00:00Z" },
    { id: "issue-bug", issueKey: "TAS-204", summary: "A bug", issueType: "BUG", status: "IN_PROGRESS", createdAt: "2026-06-01T09:00:00Z" },
  ];
  const BEFORE = ["TAS-201", "TAS-203", "TAS-204"];
  const AFTER = ["TAS-201", "TAS-102", "TAS-203", "TAS-204"];

  beforeEach(() => {
    reset();
    window.localStorage.clear();
    seedContextWorkflowParts(workflow);
    seedExtraIssues(inProgress);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    // dnd-kit keeps a capturing `click` listener on the document for 50 ms
    // after a drag ends, so the click that would follow a drop is not read as a
    // press. Out-waited here, or it swallows the first click of the next test.
    await new Promise((resolve) => setTimeout(resolve, 60));
  });

  const column = (name: string) => screen.getByRole("region", { name: `${name} column` });
  /** The keys of the cards a column draws, top to bottom. */
  const keysIn = (name: string) =>
    within(column(name))
      .queryAllByRole("button", { name: /TAS-\d+/ })
      .map((card) => /TAS-\d+/.exec(card.textContent ?? "")![0]);

  /**
   * Drags `card` onto the In Progress column. The rectangles are ours: the
   * card at the left edge, the columns side by side, a drop at the middle of
   * In Progress.
   */
  async function dropOnInProgress(card: HTMLElement) {
    const rect = (left: number, width: number) =>
      ({ x: left, y: 0, left, top: 0, right: left + width, bottom: 600, width, height: 600, toJSON: () => ({}) }) as DOMRect;
    const columns: Record<string, DOMRect> = { TODO: rect(0, 250), IN_PROGRESS: rect(300, 250), DONE: rect(600, 250) };
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      // The card, and the overlay copy of it that dnd-kit measures while the
      // drag is on: the wrapper it renders, and the card inside.
      if (this === card || this.matches(".drag-overlay-card") || this.firstElementChild?.matches(".drag-overlay-card")) {
        return rect(10, 100);
      }
      const key = this.getAttribute("data-status-key");
      return key !== null && Object.hasOwn(columns, key) ? columns[key] : rect(0, 0);
    });

    fireEvent.mouseDown(card, { button: 0, clientX: 60, clientY: 30 });
    // Past the activation distance, then to the middle of In Progress.
    fireEvent.mouseMove(document, { clientX: 80, clientY: 30 });
    await waitFor(() => expect(document.querySelector(".drag-overlay-card")).not.toBeNull());
    fireEvent.mouseMove(document, { clientX: 420, clientY: 30 });
    await waitFor(() => expect(column("In Progress")).toHaveClass("is-over"));
    fireEvent.mouseUp(document, { clientX: 420, clientY: 30 });
  }

  const refusal = () => Object.assign(new Error("Transition is not available for the current issue status"), { status: 409 });

  it("puts the card where the comparator gives it in the target column, before any re-read", async () => {
    holdTransition(true);
    renderBoard();
    const card = await screen.findByRole("button", { name: /TAS-102/ });
    expect(keysIn("In Progress")).toEqual(BEFORE);
    const reads = boardReads();

    await dropOnInProgress(card);

    // The move is out and unanswered; nothing has re-read the board.
    await waitFor(() => expect(heldTransitionCount()).toBe(1));
    expect(transitionCalls()).toEqual([{ issueId: "issue-1", transitionId: "t-start" }]);
    expect(keysIn("In Progress")).toEqual(AFTER);
    expect(keysIn("To Do")).toEqual([]);
    expect(boardReads()).toBe(reads);

    // Landed, the board is read again and the card stays where it was put.
    settleTransition();
    await waitFor(() => expect(boardReads()).toBe(reads + 1));
    await waitFor(() => expect(keysIn("In Progress")).toContain("TAS-102"));
  });

  it("puts the board back as it was when the server refuses, and reads it again", async () => {
    holdTransition(true);
    renderBoard();
    const card = await screen.findByRole("button", { name: /TAS-102/ });
    await dropOnInProgress(card);
    await waitFor(() => expect(heldTransitionCount()).toBe(1));
    expect(keysIn("In Progress")).toEqual(AFTER);
    const reads = boardReads();
    // The re-read the refusal starts must not answer: what is on screen next is
    // the snapshot the cache was given back, not a fresh board.
    holdBoard(true);

    settleTransition(refusal());

    await waitFor(() => expect(keysIn("To Do")).toEqual(["TAS-102"]));
    expect(keysIn("In Progress")).toEqual(BEFORE);
    // And the board was asked for again: the refusal says the move was not
    // made, a timeout would not.
    await waitFor(() => expect(boardReads()).toBe(reads + 1));
  });
});

/**
 * The context lists a workflow only for the issue types the project allows
 * (backend TAS-212), so a type can be missing — or every type can (TAS-251).
 */
describe("a project that allows fewer issue types", () => {
  beforeEach(() => {
    reset();
    window.localStorage.clear();
  });

  it("offers only the allowed types in the filter and in the create form", async () => {
    seedIssueTypes(["BUG", "TASK"]);
    renderBoard();

    await waitFor(() => expect(screen.getByRole("button", { name: "New" })).toBeEnabled());
    // The type filter's segmented row — the first "All"; the second is the assignee filter's.
    const filter = screen.getAllByRole("button", { name: "All" })[0].parentElement as HTMLElement;
    // In the board's order, whatever order the server listed them in.
    expect(within(filter).getAllByRole("button").map((button) => button.textContent)).toEqual(["All", "Task", "Bug"]);

    fireEvent.click(screen.getByRole("button", { name: "New" }));
    const dialog = await screen.findByRole("dialog");
    // By text: the row sits inside a `<label>`, which names its first button "Type".
    const types = within(dialog).getByText("Task").parentElement as HTMLElement;
    expect(within(types).getAllByRole("button").map((button) => button.textContent)).toEqual(["Task", "Bug"]);
    expect(within(types).getByText("Task")).toHaveClass("is-active");
  });

  it("says why an issue of a type the project no longer allows offers no move", async () => {
    seedIssueTypes(["BUG"]);
    renderBoard(`/projects/${PROJECT_ID}/issues/issue-1`);

    const panel = await screen.findByRole("dialog", { name: "TAS-102 issue" });
    expect(await within(panel).findByText(/no workflow for task issues/i)).toBeVisible();
    expect(within(panel).queryByText(/could not be loaded, so no move/i)).not.toBeInTheDocument();
  });

  it("keeps its columns and switches creating off when the project allows no type at all", async () => {
    seedIssueTypes([]);
    renderBoard();

    // The board's own columns: the server builds them from the workflows of
    // TASK, BUG and STORY whatever the project allows, so the issues still have
    // a place.
    expect(await screen.findByRole("region", { name: "To Do column" })).toBeVisible();
    await waitFor(() => expect(within(screen.getByRole("region", { name: "To Do column" })).getByText(/TAS-102/)).toBeVisible());
    expect(screen.getByRole("button", { name: "New" })).toBeDisabled();
    // Nothing failed, so nothing says it did.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

/**
 * TAS-173: an issue type, a priority or a status the backend has and this build
 * does not must not take the board down, and must not vanish from it. The
 * project below allows EPIC — a type with no name or colour here — with a
 * workflow that adds IN_REVIEW, and holds three issues: the seeded task, an
 * URGENT epic in review, and a task in BLOCKED_BY_QA, which no workflow lists.
 *
 * Since TAS-202 the board is the server's read, and the server reads TASK, BUG
 * and STORY only (backend A4): the epic is in the context and in its own
 * panel, and on no column of the board.
 */
describe("values this build does not know", () => {
  const epicWorkflow = {
    statuses: [
      { id: "s-todo", statusKey: "TODO", name: "To Do", category: "TODO", sortOrder: 10 },
      { id: "s-progress", statusKey: "IN_PROGRESS", name: "In Progress", category: "IN_PROGRESS", sortOrder: 20 },
      { id: "s-review", statusKey: "IN_REVIEW", name: "In Review", category: "IN_PROGRESS", sortOrder: 25 },
      { id: "s-done", statusKey: "DONE", name: "Done", category: "DONE", sortOrder: 30 },
    ],
    transitions: [{ id: "t-approve", fromStatusId: "s-review", toStatusId: "s-done", name: "Approve", sortOrder: 10 }],
  };
  const stand = {
    issueTypes: [
      { code: "TASK", name: "Задача" },
      { code: "EPIC", name: "Epic" },
    ],
    priorities: [
      { code: "LOW", name: "Низкий" },
      { code: "MEDIUM", name: "Средний" },
      { code: "HIGH", name: "Высокий" },
      { code: "URGENT", name: "Срочный" },
    ],
    linkTypes: null,
    notificationTypes: null,
    userStatuses: null,
  };
  const epic = { id: "issue-epic", issueKey: "TAS-150", summary: "Checkout redesign", issueType: "EPIC", status: "IN_REVIEW", priority: "URGENT" };
  const orphan = { id: "issue-orphan", issueKey: "TAS-151", summary: "Payment form QA sign-off", status: "BLOCKED_BY_QA" };

  beforeEach(() => {
    reset();
    window.localStorage.clear();
    seedIssueTypes(["TASK", "BUG", "STORY", "EPIC"]);
    seedWorkflowsByType({ EPIC: epicWorkflow });
    seedExtraIssues([epic, orphan]);
    seedMeta(stand);
  });

  it("offers an unknown type in the filter, and leaves its issues and its workflow's columns to the server's read", async () => {
    renderBoard();

    await screen.findByRole("button", { name: /TAS-151/ });
    // The board reads TASK, BUG and STORY (backend A4): no In Review column,
    // no epic on it, and Y counts what the read holds.
    expect(screen.queryByRole("region", { name: "In Review column" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /TAS-150/ })).not.toBeInTheDocument();
    expect(screen.getByText("2 of 2")).toBeVisible();
    // The type is still the project's, by its English /meta name.
    const filter = screen.getAllByRole("button", { name: "All" })[0].parentElement as HTMLElement;
    expect(within(filter).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "All",
      "Task",
      "Bug",
      "Story",
      "Epic",
    ]);
  });

  it("draws an unknown priority on a card by its code, before three empty bars", async () => {
    seedExtraIssues([{ id: "issue-urgent", issueKey: "TAS-152", summary: "Hotfix", priority: "URGENT" }]);
    renderBoard();

    const card = await screen.findByRole("button", { name: /TAS-152/ });
    // Its /meta name is Russian, so the code it came as.
    expect(within(card).getByText("URGENT")).toHaveClass("priority-name");
    expect(within(card).getByTitle("URGENT priority")).toHaveClass("priority-bars");
  });

  it("prints a type code verbatim when /meta failed", async () => {
    seedMeta(new Error("Internal error"));
    renderBoard();

    await screen.findByRole("button", { name: /TAS-151/ });
    const filter = screen.getAllByRole("button", { name: "All" })[0].parentElement as HTMLElement;
    expect(within(filter).getByRole("button", { name: "EPIC" })).toBeVisible();
    // Silent (D5): a failed /meta raises no notice anywhere.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("puts an issue outside its own workflow in one trailing group, and counts what it draws", async () => {
    renderBoard();

    const group = await screen.findByRole("region", { name: "Outside their workflow" });
    const card = within(group).getByRole("button", { name: /TAS-151/ });
    // Its status in words, beside the date, since the group's head cannot say it.
    expect(within(card).getByText("BLOCKED_BY_QA")).toHaveClass("issue-card-status");
    // Not a drag source, even for an ADMIN, and no "+": nothing can be put here.
    expect(card).toHaveClass("is-static");
    expect(card).not.toHaveAttribute("aria-roledescription");
    expect(within(group).queryByRole("button", { name: "Create issue" })).not.toBeInTheDocument();
    expect(group.querySelector(".status-dot")).toBeNull();

    // Every pill, the group's included, adds up to X.
    const pills = screen
      .getAllByRole("region")
      .filter((region) => region.classList.contains("board-column"))
      .map((region) => Number(region.querySelector(".count-pill")?.textContent));
    expect(pills.reduce((sum, count) => sum + count, 0)).toBe(2);
    expect(screen.getByText("2 of 2")).toBeVisible();
    // A card in a column is still draggable.
    const placed = within(screen.getByRole("region", { name: "To Do column" })).getByRole("button", { name: /TAS-102/ });
    await waitFor(() => expect(placed).toHaveAttribute("aria-roledescription", "draggable"));
  });

  it("names a card's status by this board's column when another type has it, and keeps it outside", async () => {
    // BUG's workflow has In Review; TASK's does not. A task in IN_REVIEW is
    // outside its own workflow though the board draws the column.
    seedWorkflowsByType({
      BUG: {
        statuses: [
          { id: "s1", statusKey: "TODO", name: "To Do", category: "TODO", sortOrder: 10 },
          { id: "s-review", statusKey: "IN_REVIEW", name: "In Review", category: "IN_PROGRESS", sortOrder: 25 },
        ],
        transitions: [],
      },
    });
    seedExtraIssues([{ id: "issue-review", issueKey: "TAS-153", summary: "Reviewed task", status: "IN_REVIEW" }]);
    renderBoard();

    const group = await screen.findByRole("region", { name: "Outside their workflow" });
    const card = within(group).getByRole("button", { name: /TAS-153/ });
    expect(within(card).getByText("In Review")).toHaveClass("issue-card-status");
    expect(within(screen.getByRole("region", { name: "In Review column" })).queryByRole("button", { name: /TAS-153/ })).toBeNull();
  });

  it("does not draw the group when no issue needs it, or when the filters leave it empty", async () => {
    seedExtraIssues([epic]);
    renderBoard();
    await screen.findByRole("button", { name: /TAS-102/ });
    expect(screen.queryByRole("region", { name: "Outside their workflow" })).not.toBeInTheDocument();
  });

  it("draws a hollow dot for a status whose key and category are both unknown", async () => {
    seedWorkflowsByType({
      TASK: {
        statuses: [
          { id: "s1", statusKey: "TODO", name: "To Do", category: "TODO", sortOrder: 10 },
          { id: "s-qa", statusKey: "QA", name: "Проверка", category: "REVIEW", sortOrder: 15 },
        ],
        transitions: [],
      },
    });
    seedExtraIssues([]);
    renderBoard();

    // A Russian workflow name is passed over for the key itself.
    const column = await screen.findByRole("region", { name: "QA column" });
    expect(column.querySelector(".status-dot")).toHaveClass("is-unknown");
  });

  it("opens an epic in review with its status, its priority active and its own transitions", async () => {
    renderBoard(`/projects/${PROJECT_ID}/issues/issue-epic`);

    const panel = await screen.findByRole("dialog", { name: "TAS-150 issue" });
    expect(await within(panel).findByText("In Review")).toHaveClass("status-pill");
    // Named by where it goes as well as by what it is called (§4.1, TAS-382).
    expect(within(panel).getByRole("button", { name: "Approve, move to Done" })).toBeVisible();
    const priority = within(panel).getByRole("button", { name: "URGENT" });
    expect(priority).toHaveClass("is-active");
    expect(within(panel).getAllByRole("button", { name: /^(Low|Medium|High|URGENT)$/ }).map((b) => b.textContent)).toEqual([
      "Low",
      "Medium",
      "High",
      "URGENT",
    ]);
  });

  it("keeps a priority /meta does not list on the panel, appended last and active", async () => {
    seedMeta(new Error("Internal error"));
    renderBoard(`/projects/${PROJECT_ID}/issues/issue-epic`);

    const panel = await screen.findByRole("dialog", { name: "TAS-150 issue" });
    const segments = (await within(panel).findByRole("button", { name: "URGENT" })).parentElement as HTMLElement;
    expect(within(segments).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Low",
      "Medium",
      "High",
      "URGENT",
    ]);
    expect(within(segments).getByRole("button", { name: "URGENT" })).toHaveClass("is-active");
  });

  it("says why an issue in a status its workflow does not list offers no move", async () => {
    renderBoard(`/projects/${PROJECT_ID}/issues/issue-orphan`);

    const panel = await screen.findByRole("dialog", { name: "TAS-151 issue" });
    expect(
      await within(panel).findByText("BLOCKED_BY_QA is not in this project’s task workflow, so no move is offered."),
    ).toBeVisible();
    // Neutral: neither the key nor a category gives it a colour.
    expect(within(panel).getByText("BLOCKED_BY_QA", { selector: ".status-pill" })).toHaveAttribute(
      "style",
      expect.stringContaining("var(--fg-2)"),
    );
  });

  it("says the same to a VIEWER, whose own transition buttons are hidden besides", async () => {
    // TAS-236 hides a VIEWER's moves; this note is about the issue, not about
    // the reader, so it stays for every role.
    setMembership("VIEWER");
    renderBoard(`/projects/${PROJECT_ID}/issues/issue-orphan`);

    const panel = await screen.findByRole("dialog", { name: "TAS-151 issue" });
    expect(
      await within(panel).findByText("BLOCKED_BY_QA is not in this project’s task workflow, so no move is offered."),
    ).toBeVisible();
  });

  it("says an issue with no status at all offers no move", async () => {
    seedExtraIssues([{ ...orphan, status: "" }]);
    renderBoard(`/projects/${PROJECT_ID}/issues/issue-orphan`);

    const panel = await screen.findByRole("dialog", { name: "TAS-151 issue" });
    expect(await within(panel).findByText("This issue has no status, so no move is offered.")).toBeVisible();
    expect(within(panel).getByText("No status", { selector: ".status-pill" })).toBeVisible();
  });

  it("writes history about unknown values as they came", async () => {
    seedHistory([
      {
        id: "h-1",
        issueId: "issue-epic",
        eventType: "TRANSITIONED",
        actorUserId: "user-anna",
        occurredAt: "2026-08-01T10:00:00Z",
        payload: { from: "BLOCKED_BY_QA", to: "IN_REVIEW" },
      },
      {
        id: "h-2",
        issueId: "issue-epic",
        eventType: "PRIORITY",
        actorUserId: "user-anna",
        occurredAt: "2026-08-01T11:00:00Z",
        payload: { to: "URGENT" },
      },
    ]);
    renderBoard(`/projects/${PROJECT_ID}/issues/issue-epic`);

    const panel = await screen.findByRole("dialog", { name: "TAS-150 issue" });
    // The from-key verbatim, the to-key by its workflow's English name.
    expect(await within(panel).findByText(/moved BLOCKED_BY_QA to In Review/)).toBeVisible();
    expect(within(panel).getByText(/set priority to URGENT/)).toBeVisible();
  });

  it("offers /meta's priorities in the create form, Medium first chosen, and stacks the pickers for a code", async () => {
    renderBoard();
    await waitFor(() => expect(screen.getByRole("button", { name: "New" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "New" }));
    const dialog = await screen.findByRole("dialog");

    const priorities = (await within(dialog).findByRole("button", { name: "URGENT" })).parentElement as HTMLElement;
    expect(within(priorities).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Low",
      "Medium",
      "High",
      "URGENT",
    ]);
    expect(within(priorities).getByRole("button", { name: "Medium" })).toHaveClass("is-active");
    const types = within(dialog).getByRole("button", { name: "Epic" }).parentElement as HTMLElement;
    expect(within(types).getAllByRole("button").map((button) => button.textContent)).toEqual(["Task", "Bug", "Story", "Epic"]);
    expect(dialog.querySelector(".form-two")).toHaveClass("is-stacked");

    fireEvent.click(within(priorities).getByRole("button", { name: "URGENT" }));
    fireEvent.click(within(types).getByRole("button", { name: "Epic" }));
    fireEvent.change(within(dialog).getByLabelText("Summary"), { target: { value: "Quarterly plan" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create issue" }));
    await waitFor(() => expect(createCalls()).toHaveLength(1));
    expect(createCalls()[0]).toMatchObject({ issueType: "EPIC", priority: "URGENT" });
  });

  it("offers the contract's three when /meta failed, side by side, and says nothing about it", async () => {
    seedMeta(new Error("Internal error"));
    seedIssueTypes(["TASK", "BUG"]);
    seedExtraIssues([]);
    renderBoard();
    await waitFor(() => expect(screen.getByRole("button", { name: "New" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "New" }));
    const dialog = await screen.findByRole("dialog");

    const priorities = within(dialog).getByRole("button", { name: "Medium" }).parentElement as HTMLElement;
    expect(within(priorities).getAllByRole("button").map((button) => button.textContent)).toEqual(["Low", "Medium", "High"]);
    expect(dialog.querySelector(".form-two")).not.toHaveClass("is-stacked");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("asks for the dictionaries once, however many chips and pickers read them", async () => {
    renderBoard(`/projects/${PROJECT_ID}/issues/issue-epic`);
    await screen.findByRole("dialog", { name: "TAS-150 issue" });
    await screen.findByRole("region", { name: "Outside their workflow" });
    expect(metaReads()).toBe(1);
  });

  // `retryOnMount: false` in `useMeta` is what this pins (release-reviewer F2
  // on 64742b3): react-query re-asks a failed query for every observer that
  // mounts on it, so without the flag each card the filter brings back, and
  // the panel's chips and pickers, would send `GET /meta` again.
  it("does not ask again for dictionaries that failed, as cards and the panel mount", async () => {
    seedMeta(new Error("Internal error"));
    renderBoard();
    await screen.findByRole("button", { name: /TAS-151/ });
    await waitFor(() => expect(metaReads()).toBe(1));

    const filter = screen.getAllByRole("button", { name: "All" })[0].parentElement as HTMLElement;
    fireEvent.click(within(filter).getByRole("button", { name: "Bug" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /TAS-151/ })).not.toBeInTheDocument());
    fireEvent.click(within(filter).getByRole("button", { name: "All" }));
    fireEvent.click(await screen.findByRole("button", { name: /TAS-151/ }));

    const panel = await screen.findByRole("dialog", { name: "TAS-151 issue" });
    expect(await within(panel).findByRole("button", { name: "Medium" })).toHaveClass("is-active");
    expect(metaReads()).toBe(1);
  });

  // The group waits for the columns (release-reviewer F2 on 64742b3): the
  // skeleton stands until both the context and the board have answered
  // (§4.9), and the group with it.
  it("draws no group while the context read is still out, though the board is in", async () => {
    holdProject(true);
    renderBoard();

    // X of Y is drawn from the board read alone, so this is the board landing.
    expect(await screen.findByText("2 of 2")).toBeVisible();
    expect(document.querySelectorAll(".skeleton-card").length).toBeGreaterThan(0);
    expect(screen.queryByRole("region", { name: "Outside their workflow" })).not.toBeInTheDocument();
  });
});

/**
 * TAS-173's error boundaries on the board: one issue that cannot be drawn
 * costs its card and, opened, its panel — never the board.
 */
describe("an issue the board cannot draw", () => {
  let consoleError: MockInstance;

  beforeEach(() => {
    reset();
    window.localStorage.clear();
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it("stands in for the card with its key and a sentence, still counted and still opening the issue", async () => {
    // An object where text belongs is what a React child cannot be.
    seedExtraIssues([{ id: "issue-bad", issueKey: "TAS-160", summary: { text: "not a string" } as unknown as string }]);
    renderBoard();

    const column = await screen.findByRole("region", { name: "To Do column" });
    const stand = await within(column).findByRole("button", { name: /TAS-160/ });
    expect(stand).toHaveTextContent("TAS-160This card could not be shown.");
    expect(stand).toHaveClass("issue-card", "is-static");
    // The neighbour is untouched, and the pill and the counter count both.
    expect(within(column).getByRole("button", { name: /TAS-102/ })).toBeVisible();
    expect(column.querySelector(".count-pill")).toHaveTextContent("2");
    expect(screen.getByText("2 of 2")).toBeVisible();

    fireEvent.click(stand);
    expect(screen.getByTestId("whereabouts")).toHaveTextContent(`/projects/${PROJECT_ID}/issues/issue-bad`);
  });

  it("stands in for the panel with a closable head and the error's message, and leaves the board", async () => {
    seedExtraIssues([{ id: "issue-bad", issueKey: { key: "TAS-161" } as unknown as string }]);
    renderBoard(`/projects/${PROJECT_ID}/issues/issue-bad`);

    // Named "Issue" while it loads too, so wait for the failure itself: the
    // key this issue carries is not a string, and is not printed anywhere.
    const panel = await screen.findByRole("dialog", { name: "Issue" });
    expect(await within(panel).findByText("This issue could not be shown.")).toHaveAttribute("role", "status");
    expect(within(panel).queryByText(/Loading issue/)).toBeNull();
    expect(within(panel).getByText(/Objects are not valid as a React child/)).toBeVisible();
    expect(screen.getByRole("region", { name: "To Do column" })).toBeVisible();

    fireEvent.click(within(panel).getByRole("button", { name: "Close" }));
    expect(screen.getByTestId("whereabouts")).toHaveTextContent(`/projects/${PROJECT_ID}/board`);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

/**
 * A workflow can arrive present but empty: named and versioned, with no
 * statuses and no transitions. That is what the stand sent for every issue type
 * on 2026-10-15 (backend TAS-261), and the panel showed the status pill and
 * nothing else — "nowhere to go", when the server had only left the moves out.
 * The drop's half of the same refusal, and the drop's genuine "no transition
 * from X to Y", are in e2e/board-drag.spec.ts, beside the other refused drops:
 * a drop needs a real drag.
 */
describe("a workflow the server sent without statuses", () => {
  beforeEach(() => {
    reset();
    window.localStorage.clear();
  });

  it("says so in the transition row and offers no move", async () => {
    seedContextWorkflowParts({ statuses: [], transitions: [] });
    renderBoard(`/projects/${PROJECT_ID}/issues/issue-1`);

    const panel = await screen.findByRole("dialog", { name: "TAS-102 issue" });
    const note = await within(panel).findByText(
      "The server sent this project’s task workflow without statuses, so no move is offered.",
    );
    expect(note).toBeVisible();
    // The third refusal, not either of the other two: the read did not fail,
    // and the project does allow tasks.
    expect(within(panel).queryByText(/could not be loaded, so no move/i)).not.toBeInTheDocument();
    expect(within(panel).queryByText(/no workflow for task issues/i)).not.toBeInTheDocument();
    // No button in the row, so nothing here can post a transition.
    expect(within(note.parentElement as HTMLElement).queryAllByRole("button")).toEqual([]);
  });

  it("keeps quiet about statuses when the workflow has them and simply no move from here", async () => {
    // Statuses and a transition, none of it from To Do — a real workflow with
    // nowhere to go from this status, which is not what the note is about.
    seedContextWorkflowParts({
      statuses: [
        { id: "s-todo", statusKey: "TODO", name: "To Do", category: "TODO", sortOrder: 10 },
        { id: "s-done", statusKey: "DONE", name: "Done", category: "DONE", sortOrder: 30 },
      ],
      transitions: [{ id: "t-reopen", fromStatusId: "s-done", toStatusId: "s-todo", name: "Reopen", sortOrder: 10 }],
    });
    renderBoard(`/projects/${PROJECT_ID}/issues/issue-1`);

    const panel = await screen.findByRole("dialog", { name: "TAS-102 issue" });
    // The columns are this workflow's two statuses, so the context has answered
    // and the absence below is about an answered workflow, not a pending one.
    expect(await screen.findByRole("region", { name: "Done column" })).toBeVisible();
    expect(screen.queryByRole("region", { name: "In Progress column" })).not.toBeInTheDocument();
    expect(within(panel).queryByText(/without statuses/i)).not.toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: "Reopen" })).not.toBeInTheDocument();
  });
});

/**
 * A context 403 or 404 goes to §4.18's screen exactly as the server says it
 * (TAS-251). The context's member enrichment can fail the same way for one
 * unreadable avatar object; that is a backend bug asked on TAS-212 and left
 * uncompensated (AGENTS.md, "No compensations for the backend"), so the board
 * asks no second read to tell the two apart.
 */
describe("a context read refused with 404 or 403", () => {
  beforeEach(() => {
    reset();
    window.localStorage.clear();
  });

  for (const [status, code] of [
    [404, "NOT_FOUND"],
    [403, "PERMISSION_DENIED"],
  ] as const) {
    it(`shows the not-found screen and reads nothing else about the project (${status})`, async () => {
      failMembers(Object.assign(new Error("Refused"), { status, code }));
      renderBoard();

      expect(await screen.findByRole("heading", { name: /not found/i }, AFTER_RETRY)).toBeVisible();
      // The refusal is not retried, and no project read second-guesses it.
      expect(memberReads()).toBe(1);
      expect(projectReads()).toBe(0);
    });
  }

  it("keeps the board with a banner for a failure that is not a refusal", async () => {
    failMembers(Object.assign(new Error("Internal error"), { status: 500, code: "INTERNAL" }));
    renderBoard();

    expect(await screen.findByRole("alert", undefined, AFTER_RETRY)).toHaveTextContent(/could not be loaded/i);
    expect(screen.queryByRole("heading", { name: /not found/i })).not.toBeInTheDocument();
    expect(projectReads()).toBe(0);
  });
});

// §5.7: a VIEWER gets no drag. The first attempt left `useDraggable`'s
// `attributes` on the card, on the grounds that they carry `aria-disabled` —
// but they also carry `aria-roledescription="draggable"` and an
// `aria-describedby` telling the reader to press the space bar, for a gesture
// no sensor here implements and the server would refuse anyway.
describe("a card on a board that cannot be written to", () => {
  beforeEach(() => {
    reset();
    window.localStorage.clear();
  });

  it("is an ordinary button, announced as nothing else", async () => {
    setMembership("VIEWER");
    renderBoard();

    const card = await screen.findByRole("button", { name: /TAS-102/ });
    expect(card).not.toHaveAttribute("aria-roledescription");
    expect(card).not.toHaveAttribute("aria-describedby");
    expect(card).not.toHaveAttribute("aria-disabled");
    expect(card).not.toHaveAttribute("aria-pressed");
    // The one thing it still does.
    expect(card).toBeEnabled();
  });

  it("is a draggable one when the role allows it", async () => {
    renderBoard();

    const card = await screen.findByRole("button", { name: /TAS-102/ });
    await waitFor(() => expect(card).toHaveAttribute("aria-roledescription", "draggable"));
  });
});

/**
 * TAS-236, §5.7: a VIEWER's write controls are not on the page — New, each
 * column's "+", the panel's transition buttons and its Delete — the way the
 * comment composer already was not. Hidden, not disabled: a disabled control
 * is an offer the reader cannot take. A role nobody stated is not a VIEWER
 * (TAS-226): there the controls stay, switched off, under the board's banner.
 */
describe("the write controls a role is shown", () => {
  const ISSUE_PATH = `/projects/${PROJECT_ID}/issues/issue-1`;
  // A To Do issue with one move out of it, so a transition button exists to be
  // hidden or shown.
  const workflowWithAMove = {
    statuses: [
      { id: "s-todo", statusKey: "TODO", name: "To Do", category: "TODO", sortOrder: 10 },
      { id: "s-progress", statusKey: "IN_PROGRESS", name: "In Progress", category: "IN_PROGRESS", sortOrder: 20 },
    ],
    transitions: [{ id: "t-start", fromStatusId: "s-todo", toStatusId: "s-progress", name: "Start Progress", sortOrder: 10 }],
  };
  const openPanel = async () => within(await screen.findByRole("dialog", { name: "TAS-102 issue" }));
  const columnHeads = () => screen.getAllByRole("region", { name: / column$/ });

  beforeEach(() => {
    reset();
    window.localStorage.clear();
    seedContextWorkflowParts(workflowWithAMove);
  });

  it("puts none of them on the page for a VIEWER", async () => {
    setMembership("VIEWER");
    renderBoard(ISSUE_PATH);
    const panel = await openPanel();

    // The workflow's two columns are drawn, so the context — and the role in
    // it — has answered; every absence below is about that answer.
    expect(await screen.findByRole("region", { name: "In Progress column" })).toBeVisible();
    await waitFor(() => expect(screen.queryByRole("button", { name: "New" })).not.toBeInTheDocument());
    for (const column of columnHeads()) {
      expect(within(column).queryByRole("button", { name: "Create issue" })).not.toBeInTheDocument();
    }
    expect(panel.queryByRole("button", { name: "Start Progress, move to In Progress" })).not.toBeInTheDocument();
    expect(panel.queryByRole("button", { name: /^Delete issue/ })).not.toBeInTheDocument();
    // No arrow pointing at moves that are not there, and no note either: the
    // issue has somewhere to go, this reader just cannot send it.
    expect(document.querySelector(".transition-row .arrow")).toBeNull();
    expect(document.querySelector(".transition-row .transition-note")).toBeNull();
    // What a VIEWER keeps: reading, sharing and closing.
    expect(panel.getByRole("button", { name: "Share issue TAS-102" })).toBeEnabled();
    expect(panel.getByRole("button", { name: "Close" })).toBeEnabled();
  });

  for (const role of ["ADMIN", "MEMBER"] as const) {
    it(`keeps every one of them working for ${role === "ADMIN" ? "an" : "a"} ${role}`, async () => {
      setMembership(role);
      renderBoard(ISSUE_PATH);
      const panel = await openPanel();

      await waitFor(() => expect(screen.getByRole("button", { name: "New" })).toBeEnabled());
      for (const column of columnHeads()) {
        expect(within(column).getByRole("button", { name: "Create issue" })).toBeEnabled();
      }
      expect(await panel.findByRole("button", { name: "Start Progress, move to In Progress" })).toBeEnabled();
      expect(panel.getByRole("button", { name: "Delete issue TAS-102" })).toBeEnabled();
      expect(document.querySelector(".transition-row .arrow")).not.toBeNull();
    });
  }

  it("keeps them on the page, switched off, when the role came back as nothing it recognises", async () => {
    setMembership(null);
    renderBoard(ISSUE_PATH);
    const panel = await openPanel();

    expect(await screen.findByRole("alert")).toHaveTextContent(/came back empty or unrecognised/i);
    expect(screen.getByRole("button", { name: "New" })).toBeDisabled();
    for (const column of columnHeads()) {
      expect(within(column).getByRole("button", { name: "Create issue" })).toBeDisabled();
    }
    expect(await panel.findByRole("button", { name: "Start Progress, move to In Progress" })).toBeDisabled();
    const remove = panel.getByRole("button", { name: "Delete issue TAS-102" });
    expect(remove).toBeDisabled();
    // A switched-off Delete asks nothing (§4.10).
    fireEvent.click(remove);
    expect(panel.queryByRole("button", { name: "Delete issue" })).not.toBeInTheDocument();
    expect(document.querySelector(".issue-delete-zone")).toBeNull();
  });
});

/**
 * TAS-299, §4.10: the panel's Delete asks first, in §4.22's strip, in a fixed
 * zone between the head and the body. One press used to delete the issue. The
 * e2e twin is e2e/issue-delete.spec.ts.
 */
describe("deleting an issue from its panel", () => {
  const ISSUE_PATH = `/projects/${PROJECT_ID}/issues/issue-1`;
  const SENTENCE =
    "TAS-102 will be deleted for everyone, with its comments, attachments, work log and links. This cannot be undone.";
  // Two more To Do cards after the panel's issue, so the card that takes its
  // place in the column is known.
  const neighbours = [
    { id: "issue-7", issueKey: "TAS-107", summary: "Rotate the signing keys", status: "TODO" },
    { id: "issue-8", issueKey: "TAS-108", summary: "Cache the workflow", status: "TODO" },
  ];
  const openPanel = async () => within(await screen.findByRole("dialog", { name: "TAS-102 issue" }));
  const zone = () => document.querySelector<HTMLElement>(".issue-delete-zone");
  const cardOf = (id: string) => document.querySelector<HTMLElement>(`.issue-card[data-issue-id="${id}"]`);
  const boardStatus = () =>
    [...document.querySelectorAll(".board-shell > p.visually-hidden[role='status']")].map((node) => node.textContent);
  let spies: MockInstance[] = [];
  /**
   * The next delete waits until the returned function is called, and then
   * deletes as the fake server does — so the re-read behind it agrees.
   */
  const holdIssueDelete = () => {
    const deleteForReal = fakeApi.deleteIssue.bind(fakeApi);
    let answer: () => void = () => {};
    spies.push(
      vi.spyOn(fakeApi, "deleteIssue").mockImplementation(
        (projectId, issueId) =>
          new Promise<void>((resolve, reject) => {
            answer = () => void deleteForReal(projectId, issueId).then(resolve, reject);
          }),
      ),
    );
    return () => answer();
  };

  beforeEach(() => {
    reset();
    window.localStorage.clear();
  });

  afterEach(() => {
    spies.forEach((spy) => spy.mockRestore());
    spies = [];
  });

  it("asks first: the strip opens between the head and the body with Cancel focused, and nothing is sent", async () => {
    const deletes = vi.spyOn(fakeApi, "deleteIssue");
    spies.push(deletes);
    renderBoard(ISSUE_PATH);
    const panel = await openPanel();
    const remove = panel.getByRole("button", { name: "Delete issue TAS-102" });
    expect(remove).toHaveAttribute("title", "Delete");
    expect(remove).toHaveAttribute("aria-expanded", "false");
    expect(remove).not.toHaveAttribute("aria-controls");

    fireEvent.click(remove);

    const strip = zone();
    expect(strip).not.toBeNull();
    // Outside the scroll: between the head and the body, in neither of them,
    // and the head's own line gives way to the zone's.
    expect(strip?.previousElementSibling).toHaveClass("issue-panel-head", "is-asking");
    expect(strip?.nextElementSibling).toHaveClass("issue-panel-body");
    expect(within(strip!).getByText(SENTENCE)).toBeVisible();
    expect(remove).toHaveAttribute("aria-expanded", "true");
    expect(remove).toHaveAttribute("aria-controls", strip?.firstElementChild?.id);
    expect(within(strip!).getByRole("button", { name: "Cancel" })).toHaveFocus();
    expect(within(strip!).getByRole("button", { name: "Delete issue" })).toHaveAccessibleDescription(SENTENCE);
    expect(deletes).not.toHaveBeenCalled();

    // A second press on Delete closes the question.
    fireEvent.click(remove);
    expect(zone()).toBeNull();
    expect(remove).toHaveAttribute("aria-expanded", "false");
  });

  it("closes the question on Cancel, on Esc in the strip and on Esc on Delete, with focus on Delete and the panel open", async () => {
    const deletes = vi.spyOn(fakeApi, "deleteIssue");
    spies.push(deletes);
    renderBoard(ISSUE_PATH);
    const panel = await openPanel();
    const remove = panel.getByRole("button", { name: "Delete issue TAS-102" });

    fireEvent.click(remove);
    fireEvent.click(within(zone()!).getByRole("button", { name: "Cancel" }));
    expect(zone()).toBeNull();
    expect(remove).toHaveFocus();

    fireEvent.click(remove);
    fireEvent.keyDown(within(zone()!).getByRole("button", { name: "Cancel" }), { key: "Escape" });
    expect(zone()).toBeNull();
    expect(remove).toHaveFocus();

    // Shift+Tab from Cancel lands on Delete, and Esc there closes it too.
    fireEvent.click(remove);
    remove.focus();
    fireEvent.keyDown(remove, { key: "Escape" });
    expect(zone()).toBeNull();
    expect(remove).toHaveFocus();

    expect(screen.getByRole("dialog", { name: "TAS-102 issue" })).toBeInTheDocument();
    expect(screen.getByTestId("whereabouts")).toHaveTextContent(`/projects/${PROJECT_ID}/issues/issue-1`);
    expect(deletes).not.toHaveBeenCalled();
  });

  it("closes Share when it asks, and closes the question when Share opens", async () => {
    renderBoard(ISSUE_PATH);
    const panel = await openPanel();
    const share = panel.getByRole("button", { name: "Share issue TAS-102" });
    const remove = panel.getByRole("button", { name: "Delete issue TAS-102" });

    fireEvent.click(share);
    expect(screen.getByRole("dialog", { name: "Share TAS-102" })).toBeVisible();
    fireEvent.click(remove);
    expect(screen.queryByRole("dialog", { name: "Share TAS-102" })).not.toBeInTheDocument();
    expect(zone()).not.toBeNull();

    fireEvent.click(share);
    expect(screen.getByRole("dialog", { name: "Share TAS-102" })).toBeVisible();
    expect(zone()).toBeNull();
  });

  it("holds both answers aria-disabled while the request is out, and Esc and Cancel do nothing then", async () => {
    const answer = holdIssueDelete();
    seedExtraIssues(neighbours);
    renderBoard(ISSUE_PATH);
    const panel = await openPanel();
    fireEvent.click(panel.getByRole("button", { name: "Delete issue TAS-102" }));
    const strip = zone()!;
    const cancel = within(strip).getByRole("button", { name: "Cancel" });
    const accept = within(strip).getByRole("button", { name: "Delete issue" });

    fireEvent.click(accept);
    await waitFor(() => expect(accept).toHaveAttribute("aria-disabled", "true"));
    expect(cancel).toHaveAttribute("aria-disabled", "true");
    // Labels unchanged, and nothing the reader presses now changes the answer.
    expect(accept).toHaveTextContent("Delete issue");
    fireEvent.click(cancel);
    fireEvent.keyDown(accept, { key: "Escape" });
    expect(zone()).not.toBeNull();

    answer();
    await waitFor(() => expect(screen.getByTestId("whereabouts")).toHaveTextContent(`/projects/${PROJECT_ID}/board`));
  });

  it("keeps the strip when Share opens while the delete is out — its answers are the only sign of the request", async () => {
    const answer = holdIssueDelete();
    renderBoard(ISSUE_PATH);
    const panel = await openPanel();
    fireEvent.click(panel.getByRole("button", { name: "Delete issue TAS-102" }));
    const accept = within(zone()!).getByRole("button", { name: "Delete issue" });
    fireEvent.click(accept);
    await waitFor(() => expect(accept).toHaveAttribute("aria-disabled", "true"));

    fireEvent.click(panel.getByRole("button", { name: "Share issue TAS-102" }));
    expect(screen.getByRole("dialog", { name: "Share TAS-102" })).toBeVisible();
    expect(zone()).not.toBeNull();
    expect(accept).toHaveAttribute("aria-disabled", "true");

    answer();
    await waitFor(() => expect(screen.getByTestId("whereabouts")).toHaveTextContent(`/projects/${PROJECT_ID}/board`));
  });

  it("takes the card off in the same frame, before any re-read of the board has answered", async () => {
    seedExtraIssues(neighbours);
    renderBoard(ISSUE_PATH);
    const panel = await openPanel();
    await waitFor(() => expect(cardOf("issue-7")).not.toBeNull());
    // From here every read of the board waits for ever, so a card that goes can
    // only have gone from the cache the delete wrote itself.
    holdBoard(true);

    fireEvent.click(panel.getByRole("button", { name: "Delete issue TAS-102" }));
    fireEvent.click(within(zone()!).getByRole("button", { name: "Delete issue" }));

    await waitFor(() => expect(cardOf("issue-1")).toBeNull());
    await waitFor(() => expect(cardOf("issue-7")).toHaveFocus());
    expect(screen.getByText("2 of 2")).toBeVisible();
  });

  it("leaves a panel the reader has moved on from alone, and no focus target behind, when the delete answers late", async () => {
    const answer = holdIssueDelete();
    seedExtraIssues(neighbours);
    renderBoard(ISSUE_PATH);
    const panel = await openPanel();
    fireEvent.click(panel.getByRole("button", { name: "Delete issue TAS-102" }));
    fireEvent.click(within(zone()!).getByRole("button", { name: "Delete issue" }));

    // Closed while the request is out, and another issue opened.
    fireEvent.click(panel.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.getByTestId("whereabouts")).toHaveTextContent(`/projects/${PROJECT_ID}/board`));
    fireEvent.click(cardOf("issue-8")!);
    const other = within(await screen.findByRole("dialog", { name: "TAS-108 issue" }));

    answer();
    // The card goes and the board says so — and the open panel stays open.
    await waitFor(() => expect(cardOf("issue-1")).toBeNull());
    expect(boardStatus()).toEqual(["TAS-102 deleted."]);
    expect(screen.getByTestId("whereabouts")).toHaveTextContent(`/projects/${PROJECT_ID}/issues/issue-8`);

    // Closing it later goes nowhere the old delete chose.
    fireEvent.click(other.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.getByTestId("whereabouts")).toHaveTextContent(`/projects/${PROJECT_ID}/board`));
    expect(cardOf("issue-7")).not.toHaveFocus();
  });

  it("on success takes the card off the board at once, replaces the panel's route, focuses the card that took its place and says so", async () => {
    seedExtraIssues(neighbours);
    renderBoard(ISSUE_PATH);
    const panel = await openPanel();
    await waitFor(() => expect(cardOf("issue-1")).not.toBeNull());
    expect(boardStatus()).toEqual([""]);

    fireEvent.click(panel.getByRole("button", { name: "Delete issue TAS-102" }));
    fireEvent.click(within(zone()!).getByRole("button", { name: "Delete issue" }));

    const whereabouts = screen.getByTestId("whereabouts");
    await waitFor(() => expect(whereabouts).toHaveTextContent(`/projects/${PROJECT_ID}/board`));
    expect(whereabouts).toHaveAttribute("data-navigation", "REPLACE");
    await waitFor(() => expect(cardOf("issue-1")).toBeNull());
    // The next card in the same column, which took its place.
    expect(cardOf("issue-7")).toHaveFocus();
    expect(boardStatus()).toEqual(["TAS-102 deleted."]);
    expect(screen.queryByRole("dialog", { name: "TAS-102 issue" })).not.toBeInTheDocument();
  });

  it("falls back to the card before it, then to the column's +, for the last card of a column", async () => {
    seedExtraIssues([{ ...neighbours[0] }]);
    renderBoard(`/projects/${PROJECT_ID}/issues/issue-7`);
    const panel = within(await screen.findByRole("dialog", { name: "TAS-107 issue" }));
    fireEvent.click(panel.getByRole("button", { name: "Delete issue TAS-107" }));
    fireEvent.click(within(zone()!).getByRole("button", { name: "Delete issue" }));
    await waitFor(() => expect(cardOf("issue-7")).toBeNull());
    // Nothing after it in the column: the card before it.
    await waitFor(() => expect(cardOf("issue-1")).toHaveFocus());
  });

  it("goes to the column's + when the column is left empty", async () => {
    renderBoard(ISSUE_PATH);
    const panel = await openPanel();
    fireEvent.click(panel.getByRole("button", { name: "Delete issue TAS-102" }));
    fireEvent.click(within(zone()!).getByRole("button", { name: "Delete issue" }));

    const column = await screen.findByRole("region", { name: "To Do column" });
    await waitFor(() => expect(within(column).getByRole("button", { name: "Create issue" })).toHaveFocus());
  });

  it("takes a 404 as already deleted: the same path, in its own words", async () => {
    failIssueDelete(Object.assign(new Error("Issue with id: issue-1"), { code: "NOT_FOUND", status: 404 }));
    seedExtraIssues(neighbours);
    renderBoard(ISSUE_PATH);
    const panel = await openPanel();
    fireEvent.click(panel.getByRole("button", { name: "Delete issue TAS-102" }));
    fireEvent.click(within(zone()!).getByRole("button", { name: "Delete issue" }));

    await waitFor(() => expect(screen.getByTestId("whereabouts")).toHaveTextContent(`/projects/${PROJECT_ID}/board`));
    expect(screen.getByTestId("whereabouts")).toHaveAttribute("data-navigation", "REPLACE");
    expect(boardStatus()).toEqual(["TAS-102 was already deleted."]);
    await waitFor(() => expect(cardOf("issue-7")).toHaveFocus());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("on a refusal closes the strip, gives focus to Delete, says why in the panel's slot and reads the board again", async () => {
    const scrolls = vi.spyOn(Element.prototype, "scrollIntoView");
    const reads = vi.spyOn(fakeApi, "getBoard");
    spies.push(scrolls, reads);
    failIssueDelete(
      Object.assign(new Error("User doesn't have permission"), {
        code: "PERMISSION_DENIED",
        status: 403,
        requestId: "6f1c2d3e-0000-4000-8000-000000000299",
      }),
    );
    renderBoard(ISSUE_PATH);
    const panel = await openPanel();
    const remove = panel.getByRole("button", { name: "Delete issue TAS-102" });
    await waitFor(() => expect(reads).toHaveBeenCalled());
    const readsBefore = reads.mock.calls.length;

    fireEvent.click(remove);
    fireEvent.click(within(zone()!).getByRole("button", { name: "Delete issue" }));

    const alert = await panel.findByRole("alert");
    expect(alert).toHaveTextContent("User doesn't have permission");
    // The id under the sentence, outside the live region (§5.5).
    expect(alert).not.toHaveTextContent("6f1c2d3e");
    expect(panel.getByText("6f1c2d3e-0000-4000-8000-000000000299", { exact: false })).toBeVisible();
    expect(zone()).toBeNull();
    expect(remove).toHaveFocus();
    expect(remove).toHaveAttribute("aria-expanded", "false");
    // The slot is brought into view, where the eye is not.
    expect(scrolls.mock.contexts).toContain(alert.closest(".error-note"));
    await waitFor(() => expect(reads.mock.calls.length).toBeGreaterThan(readsBefore));
    // Nothing was taken off the board and the panel stays.
    expect(cardOf("issue-1")).not.toBeNull();
    expect(screen.getByTestId("whereabouts")).toHaveTextContent(`/projects/${PROJECT_ID}/issues/issue-1`);
    expect(boardStatus()).toEqual([""]);
  });
});

/**
 * TAS-259: a comment's Delete asks first, in §4.22's strip, the way the work
 * log's does. One press used to delete — and since the Activity feed folds
 * (TAS-257), folding it near the foot of the panel moves the thread under the
 * pointer, so a second press could land on Delete. The e2e twin is in
 * e2e/comments.spec.ts.
 */
describe("deleting a comment from the issue panel", () => {
  const ISSUE_PATH = `/projects/${PROJECT_ID}/issues/issue-1`;
  const anna: IssueComment = {
    id: "comment-1",
    issueId: "issue-1",
    projectId: PROJECT_ID,
    authorUserId: "user-anna",
    author: null,
    body: "Retry guard is in review.",
    createdAt: "2026-08-01T09:30:00Z",
    updatedAt: "2026-08-01T09:30:00Z",
    version: 1,
  };
  const openRow = async () => {
    const panel = within(await screen.findByRole("dialog", { name: "TAS-102 issue" }));
    const row = (await panel.findByText(anna.body)).closest(".comment-item") as HTMLElement;
    return { panel, row: within(row) };
  };

  beforeEach(() => {
    reset();
    window.localStorage.clear();
    seedComments([anna]);
  });

  it("deletes nothing on the first press, and closes its question on Cancel and on Esc", async () => {
    renderBoard(ISSUE_PATH);
    const { row } = await openRow();
    const remove = await row.findByRole("button", { name: "Delete" });
    expect(remove).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(remove);
    expect(remove).toHaveAttribute("aria-expanded", "true");
    const cancel = row.getByRole("button", { name: "Cancel" });
    // The strip is what `aria-controls` names, and Cancel is where focus goes.
    expect(document.getElementById(remove.getAttribute("aria-controls") ?? "")).toContainElement(cancel);
    expect(cancel).toHaveFocus();
    expect(row.getByText(/will be removed from this issue for everyone/)).toBeVisible();
    expect(deletedComments()).toEqual([]);

    fireEvent.keyDown(cancel, { key: "Escape" });
    expect(row.queryByRole("button", { name: "Delete comment" })).not.toBeInTheDocument();
    expect(remove).toHaveAttribute("aria-expanded", "false");
    expect(remove).not.toHaveAttribute("aria-controls");
    expect(remove).toHaveFocus();

    fireEvent.click(remove);
    fireEvent.click(row.getByRole("button", { name: "Cancel" }));
    expect(row.queryByRole("button", { name: "Delete comment" })).not.toBeInTheDocument();
    expect(remove).toHaveFocus();

    expect(deletedComments()).toEqual([]);
    expect(row.getByText(anna.body)).toBeVisible();
  });

  it("deletes from the strip's answer, and gives focus to the heading the row leaves under", async () => {
    renderBoard(ISSUE_PATH);
    const { panel, row } = await openRow();

    fireEvent.click(await row.findByRole("button", { name: "Delete" }));
    fireEvent.click(row.getByRole("button", { name: "Delete comment" }));

    expect(panel.getByRole("heading", { name: /^Comments/ })).toHaveFocus();
    await waitFor(() => expect(deletedComments()).toEqual(["comment-1"]));
    expect(await panel.findByText("No comments yet")).toBeVisible();
  });

  it("closes its question on Esc from the Delete that asked, where Shift+Tab from Cancel lands", async () => {
    renderBoard(ISSUE_PATH);
    const { row } = await openRow();
    const remove = await row.findByRole("button", { name: "Delete" });

    fireEvent.click(remove);
    expect(row.getByRole("button", { name: "Delete comment" })).toBeVisible();
    remove.focus();
    fireEvent.keyDown(remove, { key: "Escape" });

    expect(row.queryByRole("button", { name: "Delete comment" })).not.toBeInTheDocument();
    expect(remove).toHaveAttribute("aria-expanded", "false");
    expect(remove).toHaveFocus();
    expect(deletedComments()).toEqual([]);
  });

  it("closes the question when the reader turns to editing instead, and it stays closed after", async () => {
    renderBoard(ISSUE_PATH);
    const { panel, row } = await openRow();

    fireEvent.click(await row.findByRole("button", { name: "Delete" }));
    fireEvent.click(row.getByRole("button", { name: "Edit" }));

    expect(panel.queryByRole("button", { name: "Delete comment" })).not.toBeInTheDocument();
    const save = panel.getByRole("button", { name: "Save" });
    expect(save).toBeVisible();

    // Leaving the editor must not bring the question back: opening it dropped
    // the question rather than hiding it behind the editor.
    const editor = save.closest(".comment-item") as HTMLElement;
    fireEvent.click(within(editor).getByRole("button", { name: "Cancel" }));
    expect(panel.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete comment" })).not.toBeInTheDocument();
    expect(deletedComments()).toEqual([]);
  });

  it("says a refused delete through one polite region that was there before it", async () => {
    failCommentDelete(Object.assign(new Error("Comment not found or already deleted"), { status: 404, code: "NOT_FOUND" }));
    renderBoard(ISSUE_PATH);
    const { row } = await openRow();
    // Mounted and empty before anything happens, with no box around it.
    const region = document.querySelector(".comments [aria-live='polite']") as HTMLElement;
    expect(region).toBeEmptyDOMElement();
    expect(region.closest(".error-note")).toBeNull();

    fireEvent.click(await row.findByRole("button", { name: "Delete" }));
    fireEvent.click(row.getByRole("button", { name: "Delete comment" }));

    // The same node takes the text — a change a screen reader announces — and
    // the box is drawn around it.
    await waitFor(() => expect(region).toHaveTextContent("Comment not found or already deleted"));
    expect(document.querySelector(".comments [aria-live='polite']")).toBe(region);
    expect(region.closest(".error-note")).not.toBeNull();
    expect(row.getByText(anna.body)).toBeVisible();
  });
});

/**
 * The panel's Planning block (TAS-189). One test, and it is about the reading
 * rather than the writing: minutes have to arrive as a duration, a calendar day
 * has to arrive as the day it is, and an unset field has to arrive **empty**.
 *
 * The last of those three is the whole point of the feature and the one an
 * implementation gets wrong for free: `remainingEstimateMinutes` is `null` on
 * this fixture, and a field drawn from `value || 0` — or a formatter asked to
 * print `null` — puts `0m` there, which is a claim about the issue that nobody
 * made. The editing paths are covered against the real mock in
 * e2e/planning-fields.spec.ts, where the API layer's refusals are the ones
 * under test.
 */
describe("the planning fields on an issue panel", () => {
  beforeEach(() => {
    reset();
    window.localStorage.clear();
  });

  it("reads the four the issue carries and leaves the fifth empty", async () => {
    renderBoard(`/projects/${PROJECT_ID}/issues/issue-1`);
    await screen.findByRole("dialog", { name: "TAS-102 issue" });

    expect(await screen.findByLabelText("Story points")).toHaveValue("3");
    // Verbatim, as `DateOnly`: the box holds the day, not a moment in a
    // timezone that could move it to the 14th.
    expect(screen.getByLabelText("Start date")).toHaveValue("2026-06-15");
    expect(screen.getByLabelText("Due date")).toHaveValue("2026-06-26");
    // 480 minutes on the wire, eight hours to the reader.
    expect(screen.getByLabelText("Original estimate")).toHaveValue("8h");

    const remaining = screen.getByLabelText("Remaining estimate");
    expect(remaining).toHaveValue("");
    expect(remaining).toHaveAttribute("placeholder", "—");
  });

  it("shows a viewer the values and lets them change none", async () => {
    setMembership("VIEWER");
    renderBoard(`/projects/${PROJECT_ID}/issues/issue-1`);
    await screen.findByRole("dialog", { name: "TAS-102 issue" });

    // Read-only, not disabled and not hidden: a reader without write access
    // still has to be able to read the plan (§5.7, which names `readOnly` for
    // inline editing), and the server stays the authority either way.
    // `disabled` was the first answer and was wrong twice over — it dims the
    // values to a contrast the em dash cannot survive, and it takes five boxes
    // out of the tab order, so the reader who most needs to copy a date out of
    // here is the one who cannot reach it.
    expect(await screen.findByLabelText("Story points")).toHaveValue("3");
    for (const label of ["Story points", "Start date", "Due date", "Original estimate", "Remaining estimate"]) {
      const field = screen.getByLabelText(label);
      expect(field).toHaveAttribute("readonly");
      expect(field).not.toBeDisabled();
      // Still reachable, which is the half of §5.7 that `disabled` broke.
      field.focus();
      expect(field).toHaveFocus();
    }
    // The typing hints are for a reader who can type (TAS-299): a read-only
    // estimate box has no syntax to explain, and describes nothing.
    expect(screen.queryByText(PLANNING_ESTIMATE_HINT)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Original estimate")).not.toHaveAttribute("aria-describedby");
    expect(screen.getByLabelText("Remaining estimate")).not.toHaveAttribute("aria-describedby");
  });

  it("gives a viewer the summary and the description read-only, not disabled (TAS-299)", async () => {
    setMembership("VIEWER");
    renderBoard(`/projects/${PROJECT_ID}/issues/issue-1`);
    await screen.findByRole("dialog", { name: "TAS-102 issue" });

    // §4.3, §5.7: full contrast, selectable, in the Tab order — the same terms
    // the planning fields have had since TAS-189. `disabled` dimmed both to .58.
    const summary = document.querySelector(".summary-textarea") as HTMLTextAreaElement;
    const description = screen.getByRole("textbox", { name: "Description" });
    for (const box of [summary, description]) {
      expect(box).toHaveAttribute("readonly");
      expect(box).not.toBeDisabled();
      box.focus();
      expect(box).toHaveFocus();
    }
    expect(summary).toHaveValue("Wire the board to the gateway");

    // A blur from a read-only box writes nothing.
    fireEvent.blur(summary);
    fireEvent.blur(description);
    expect(updateCalls()).toHaveLength(0);
  });

  it("keeps a draft in one field while the answer to another lands", async () => {
    renderBoard(`/projects/${PROJECT_ID}/issues/issue-1`);
    await screen.findByRole("dialog", { name: "TAS-102 issue" });

    // The estimate is committed and its answer held, so the refetch it triggers
    // lands *after* the second field has been typed into — which is the window
    // the defect lived in and a tick too narrow to race.
    holdIssueUpdates(true);
    const estimate = await screen.findByLabelText("Original estimate");
    // Typed as bare minutes on purpose: the draft says `240` and the server's
    // answer reads `4h`, so the box changing is proof the *refetch* reseeded it
    // rather than proof of what was typed into it.
    fireEvent.change(estimate, { target: { value: "240" } });
    fireEvent.blur(estimate);

    const points = screen.getByLabelText("Story points");
    fireEvent.change(points, { target: { value: "7" } });

    // The write has to have *reached* the fake before it can be answered:
    // `mutate` dispatches on a microtask, and releasing an empty queue releases
    // nothing.
    await waitFor(() => expect(heldIssueUpdateCount()).toBe(1));
    releaseIssueUpdates();
    await waitFor(() => expect(screen.getByLabelText("Original estimate")).toHaveValue("4h"));
    // And the story points draft is still the reader's. Reseeding the block
    // wholesale put `3` back here, silently, mid-edit.
    expect(points).toHaveValue("7");
  });
});

/**
 * The assignee chips (TAS-226). issue-service checks `assign-issue-roles`
 * (ADMIN, MEMBER) against the assignee as well as against whoever assigns, so
 * a chip for anybody else was an offer the server refuses. The one exception
 * is the current assignee, who is the assignment whatever their role has
 * become since.
 */
describe("the assignee chips on an issue panel", () => {
  const ISSUE_PATH = `/projects/${PROJECT_ID}/issues/issue-1`;

  const row = (userId: string, displayName: string, role: "ADMIN" | "MEMBER" | "VIEWER" | null) => ({
    userId,
    role,
    addedAt: "2026-08-01T09:00:00Z",
    addedBy: "user-anna",
    user: { displayName, email: `${displayName.split(" ")[0].toLowerCase()}@example.com` },
  });

  /** The words on the chips, in order — the avatar beside each is not part of it. */
  const chipLabels = () =>
    [...document.querySelectorAll(".meta-grid .assignee-chip span:last-child")].map((node) => node.textContent);

  const openPanel = async () => within(await screen.findByRole("dialog", { name: "TAS-102 issue" }));

  beforeEach(() => {
    reset();
    window.localStorage.clear();
  });

  it("offers only the members the server takes as an assignee", async () => {
    seedMembers([
      row("user-anna", "Anna Ivanova", "ADMIN"),
      row("user-mark", "Mark Lee", "MEMBER"),
      row("user-tom", "Tom Becker", "VIEWER"),
      // A role the server did not state in a form this build knows: not a
      // VIEWER, and not assignable either — nobody said it may be.
      row("user-omar", "Omar Haddad", null),
    ]);
    renderBoard(ISSUE_PATH);
    await openPanel();

    await waitFor(() => expect(chipLabels()).toEqual(["None", "Anna", "Mark"]));
    // The board's filter is a read and keeps all four: it asks who holds an
    // issue, not who may be given one.
    expect(document.querySelectorAll(".filterbar .avatar-filter")).toHaveLength(4);
  });

  it("keeps a demoted assignee on screen as the assignment, and will not send it again", async () => {
    seedMembers([row("user-anna", "Anna Ivanova", "ADMIN"), row("user-tom", "Tom Becker", "VIEWER")]);
    seedAssignee("user-tom");
    renderBoard(ISSUE_PATH);
    const panel = await openPanel();

    await waitFor(() => expect(chipLabels()).toEqual(["None", "Anna", "Tom"]));
    const tom = panel.getByRole("button", { name: /^Tom Becker/ });
    expect(tom).toHaveClass("is-active");
    // Pressing an active chip sends the assignment again, and for a VIEWER that
    // is the request the server refuses.
    expect(tom).toBeDisabled();
    fireEvent.click(tom);
    expect(assignCalls()).toEqual([]);

    // The chip beside it is still an offer.
    fireEvent.click(panel.getByRole("button", { name: /^Anna Ivanova/ }));
    await waitFor(() => expect(assignCalls()).toEqual(["user-anna"]));
  });
});

/**
 * The panel's edits under optimistic locking (TAS-246): `PATCH` with the
 * version the panel holds, one write at a time, and a version conflict shown as
 * the issue that won rather than retried behind the reader's back.
 */
describe("issue edits under optimistic locking", () => {
  const ISSUE_PATH = `/projects/${PROJECT_ID}/issues/issue-1`;
  const ISSUE_KEY = ["issue", PROJECT_ID, "issue-1"];

  const openPanel = async () => within(await screen.findByRole("dialog", { name: "TAS-102 issue" }));

  beforeEach(() => {
    reset();
    window.localStorage.clear();
  });

  it("runs two quick edits one after the other, the second at the version the first left", async () => {
    renderBoard(ISSUE_PATH);
    const panel = await openPanel();
    holdIssueUpdates(true);

    fireEvent.click(panel.getByRole("button", { name: "Low" }));
    fireEvent.click(panel.getByRole("button", { name: "High" }));

    // The second is queued behind the first rather than sent beside it.
    await waitFor(() => expect(heldIssueUpdateCount()).toBe(1));
    expect(updateCalls()).toHaveLength(1);
    releaseIssueUpdates();

    await waitFor(() => expect(heldIssueUpdateCount()).toBe(1));
    releaseIssueUpdates();
    await waitFor(() => expect(updateCalls()).toHaveLength(2));
    expect(updateCalls().map((call) => call.expectedVersion)).toEqual([1, 2]);
    expect(updateCalls().map((call) => call.patch)).toEqual([{ priority: "LOW" }, { priority: "HIGH" }]);
    await waitFor(() => expect(panel.getByRole("button", { name: "High" })).toHaveClass("is-active"));
  });

  it("shows the issue that won a priority conflict, says so, and does not try again", async () => {
    renderBoard(ISSUE_PATH);
    const panel = await openPanel();
    conflictNextUpdate({ priority: "HIGH" }, "req-409");
    const readsBefore = sectionReads().issue;

    fireEvent.click(panel.getByRole("button", { name: "Low" }));

    const sentence = await panel.findByRole("alert");
    expect(sentence).toHaveTextContent(
      "Your change to the priority was not saved: this issue was changed elsewhere after you opened it. The panel now shows the latest version.",
    );
    // The server's answer is on screen at once, from the conflict's own body.
    expect(panel.getByRole("button", { name: "High" })).toHaveClass("is-active");
    // The id that finds this in the gateway log, outside the live region.
    const copy = panel.getByRole("button", { name: /Copy request id req-409/ });
    expect(sentence.contains(copy)).toBe(false);
    // Re-read, and never re-sent.
    await waitFor(() => expect(sectionReads().issue).toBeGreaterThan(readsBefore));
    expect(updateCalls()).toHaveLength(1);
  });

  it("keeps the reader's description through a conflict and sends it again, at the new version, on the next blur", async () => {
    renderBoard(ISSUE_PATH);
    const panel = await openPanel();
    conflictNextUpdate({ description: "Their words" });

    const box = panel.getByRole("textbox", { name: "Description" });
    fireEvent.change(box, { target: { value: "My words" } });
    fireEvent.blur(box);

    expect(await panel.findByRole("alert")).toHaveTextContent(
      "Your description was not saved: this issue was changed elsewhere after you opened it. Your text is still in the box — leave the box to save it over the latest version.",
    );
    // The re-read lands, and the reader's text is still what the box holds.
    await waitFor(() => expect(sectionReads().issue).toBeGreaterThan(1));
    expect(box).toHaveValue("My words");

    fireEvent.blur(box);
    await waitFor(() => expect(updateCalls()).toHaveLength(2));
    expect(updateCalls()[1]).toEqual({ patch: { description: "My words" }, expectedVersion: 2 });
    // The next write started, so the conflict line went with it.
    await waitFor(() => expect(panel.queryByRole("alert")).toBeNull());
  });

  it("unassigns with None, which is a request now", async () => {
    seedMembers([
      { userId: "user-anna", role: "ADMIN", addedAt: "2026-08-01T09:00:00Z", addedBy: "user-anna", user: { displayName: "Anna Ivanova", email: "anna@example.com" } },
    ]);
    seedAssignee("user-anna");
    renderBoard(ISSUE_PATH);
    const panel = await openPanel();

    const none = await panel.findByRole("button", { name: /None$/ });
    await waitFor(() => expect(panel.getByRole("button", { name: /^Anna Ivanova/ })).toHaveClass("is-active"));
    expect(none).toBeEnabled();
    fireEvent.click(none);

    await waitFor(() => expect(updateCalls()).toEqual([{ patch: { assigneeId: null }, expectedVersion: 1 }]));
    await waitFor(() => expect(none).toHaveClass("is-active"));
    // Off again, since unassigning an unassigned issue would change nothing —
    // but `aria-disabled`, never `disabled`: the press that unassigned it may
    // have come from the keyboard, and a real `disabled` landing on the
    // focused chip drops focus to <body> (§4.21). The handler refuses instead.
    expect(none).toHaveAttribute("aria-disabled", "true");
    expect(none).not.toBeDisabled();
    fireEvent.click(none);
    expect(updateCalls()).toHaveLength(1);
  });

  it("keeps None a real disabled for a reader who cannot edit", async () => {
    setMembership("VIEWER");
    renderBoard(ISSUE_PATH);
    const panel = await openPanel();

    const none = await panel.findByRole("button", { name: /None$/ });
    expect(none).toBeDisabled();
    expect(none).not.toHaveAttribute("aria-disabled");
  });

  it("does not send an edit made before a conflict landed, and sends the next one at the version the conflict left", async () => {
    // Anna has v3 open; Boris changes the description (v4). Anna leaves the
    // summary (A, sent at 3) and, while A is out, the description (B, queued).
    // A is refused. B was written over v3's text and, if it went out at v4,
    // would succeed and lay Anna's words over Boris's unseen.
    seedIssueVersion(3);
    renderBoard(ISSUE_PATH);
    const panel = await openPanel();
    conflictNextUpdate({ description: "Boris's words" }, "req-409");
    holdIssueUpdates(true);

    const summaryBox = document.querySelector(".summary-textarea") as HTMLTextAreaElement;
    const descriptionBox = panel.getByRole("textbox", { name: "Description" });
    fireEvent.change(summaryBox, { target: { value: "Anna's summary" } });
    fireEvent.blur(summaryBox);
    fireEvent.change(descriptionBox, { target: { value: "Anna's words" } });
    fireEvent.blur(descriptionBox);
    await waitFor(() => expect(heldIssueUpdateCount()).toBe(1));
    expect(updateCalls()).toEqual([{ patch: { summary: "Anna's summary" }, expectedVersion: 3 }]);

    holdIssueUpdates(false);
    releaseIssueUpdates();

    // One line for both, because neither was saved; B is answered as a
    // conflict without a request, under the id of the request that found it.
    const sentence = await panel.findByRole("alert");
    await waitFor(() =>
      expect(sentence).toHaveTextContent(
        "Your summary and description were not saved: this issue was changed elsewhere after you opened it. Your text is still in both boxes — leave each box to save it over the latest version.",
      ),
    );
    expect(panel.getByRole("button", { name: /Copy request id req-409/ })).toBeInTheDocument();
    expect(updateCalls()).toHaveLength(1);
    expect(summaryBox).toHaveValue("Anna's summary");
    expect(descriptionBox).toHaveValue("Anna's words");

    // An edit made now, with the conflict on screen, goes out at v4.
    fireEvent.blur(descriptionBox);
    await waitFor(() => expect(updateCalls()).toHaveLength(2));
    expect(updateCalls()[1]).toEqual({ patch: { description: "Anna's words" }, expectedVersion: 4 });
    // The description was sent again; the summary is still unsaved in its box.
    await waitFor(() =>
      expect(panel.getByRole("alert")).toHaveTextContent(
        "Your summary was not saved: this issue was changed elsewhere after you opened it. Your text is still in the box — leave the box to save it over the latest version.",
      ),
    );
  });

  it("names a choice and a text in one line when a pick was queued behind a refused summary", async () => {
    renderBoard(ISSUE_PATH);
    const panel = await openPanel();
    conflictNextUpdate({ summary: "Their summary" });
    holdIssueUpdates(true);

    const summaryBox = document.querySelector(".summary-textarea") as HTMLTextAreaElement;
    fireEvent.change(summaryBox, { target: { value: "My summary" } });
    fireEvent.blur(summaryBox);
    fireEvent.click(panel.getByRole("button", { name: "Low" }));
    await waitFor(() => expect(heldIssueUpdateCount()).toBe(1));
    holdIssueUpdates(false);
    releaseIssueUpdates();

    await waitFor(() =>
      expect(panel.getByRole("alert")).toHaveTextContent(
        "Your change to the priority and your summary were not saved: this issue was changed elsewhere after you opened it. The panel now shows the latest version, and your text is still in the box — leave the box to save it over the latest version.",
      ),
    );
    expect(updateCalls()).toHaveLength(1);
    expect(summaryBox).toHaveValue("My summary");
  });

  it("does not send a second quick pick of a field whose first pick was refused as a conflict", async () => {
    renderBoard(ISSUE_PATH);
    const panel = await openPanel();
    conflictNextUpdate({ priority: "HIGH" });
    holdIssueUpdates(true);

    fireEvent.click(panel.getByRole("button", { name: "Low" }));
    fireEvent.click(panel.getByRole("button", { name: "High" }));
    await waitFor(() => expect(heldIssueUpdateCount()).toBe(1));
    holdIssueUpdates(false);
    releaseIssueUpdates();

    expect(await panel.findByRole("alert")).toHaveTextContent(
      "Your change to the priority was not saved: this issue was changed elsewhere after you opened it. The panel now shows the latest version.",
    );
    // Neither pick was made: the panel shows the server's High, and the
    // second press never left.
    await waitFor(() => expect(panel.getByRole("button", { name: "High" })).toHaveClass("is-active"));
    expect(updateCalls()).toEqual([{ patch: { priority: "LOW" }, expectedVersion: 1 }]);

    // A pick made after the conflict was shown is an ordinary edit.
    fireEvent.click(panel.getByRole("button", { name: "Low" }));
    await waitFor(() => expect(updateCalls()).toHaveLength(2));
    expect(updateCalls()[1]).toEqual({ patch: { priority: "LOW" }, expectedVersion: 2 });
    await waitFor(() => expect(panel.getByRole("button", { name: "Low" })).toHaveClass("is-active"));
    // The choice line was news until the reader acted again.
    expect(panel.queryByRole("alert")).toBeNull();
  });

  it("keeps a summary conflict line through a write of another field, while the text is still unsaved", async () => {
    renderBoard(ISSUE_PATH);
    const panel = await openPanel();
    conflictNextUpdate({ summary: "Their summary" });

    const summaryBox = document.querySelector(".summary-textarea") as HTMLTextAreaElement;
    fireEvent.change(summaryBox, { target: { value: "My summary" } });
    fireEvent.blur(summaryBox);
    const summaryLine =
      "Your summary was not saved: this issue was changed elsewhere after you opened it. Your text is still in the box — leave the box to save it over the latest version.";
    expect(await panel.findByRole("alert")).toHaveTextContent(summaryLine);

    fireEvent.click(panel.getByRole("button", { name: "Low" }));
    await waitFor(() => expect(panel.getByRole("button", { name: "Low" })).toHaveClass("is-active"));
    expect(updateCalls()[1]).toEqual({ patch: { priority: "LOW" }, expectedVersion: 2 });
    // The priority was saved; the summary was not, and is still in the box.
    expect(panel.getByRole("alert")).toHaveTextContent(summaryLine);
    expect(summaryBox).toHaveValue("My summary");

    // Sending it again is what retires the line.
    fireEvent.blur(summaryBox);
    await waitFor(() => expect(updateCalls()).toHaveLength(3));
    expect(updateCalls()[2]).toEqual({ patch: { summary: "My summary" }, expectedVersion: 3 });
    await waitFor(() => expect(panel.queryByRole("alert")).toBeNull());
  });

  it("drops a summary conflict line when the reader puts the stored text back", async () => {
    renderBoard(ISSUE_PATH);
    const panel = await openPanel();
    conflictNextUpdate({ summary: "Their summary" });

    const summaryBox = document.querySelector(".summary-textarea") as HTMLTextAreaElement;
    fireEvent.change(summaryBox, { target: { value: "My summary" } });
    fireEvent.blur(summaryBox);
    expect(await panel.findByRole("alert")).toHaveTextContent("Your summary was not saved");

    fireEvent.change(summaryBox, { target: { value: "Their summary" } });
    fireEvent.blur(summaryBox);
    await waitFor(() => expect(panel.queryByRole("alert")).toBeNull());
    expect(updateCalls()).toHaveLength(1);
  });

  it("states a later delete's own refusal after a conflict, never the conflict's internal message", async () => {
    renderBoard(ISSUE_PATH);
    const panel = await openPanel();
    conflictNextUpdate({ priority: "HIGH" });

    fireEvent.click(panel.getByRole("button", { name: "Low" }));
    expect(await panel.findByRole("alert")).toHaveTextContent("Your change to the priority was not saved");

    failIssueDelete(Object.assign(new Error("You cannot delete this issue"), { code: "PERMISSION_DENIED", status: 403 }));
    fireEvent.click(panel.getByRole("button", { name: "Delete issue TAS-102" }));
    fireEvent.click(panel.getByRole("button", { name: "Delete issue" }));

    await waitFor(() => expect(panel.getByRole("alert")).toHaveTextContent("You cannot delete this issue"));
    expect(panel.getByRole("alert")).not.toHaveTextContent("Version conflict");
  });

  it("keeps a newer cached issue over an older re-read, and takes an equal one with new labels", async () => {
    const queryClient = renderBoard(ISSUE_PATH);
    await openPanel();
    type Details = { issue: { version: number; priority: string; labels: unknown[] | null } };

    // A write answered version 5 while a re-read that set out before it still
    // carries version 1 — the server here is still at 1.
    queryClient.setQueryData<Details>(ISSUE_KEY, (data) =>
      data ? { ...data, issue: { ...data.issue, version: 5, priority: "HIGH" } } : data,
    );
    await queryClient.refetchQueries({ queryKey: ISSUE_KEY });
    expect(queryClient.getQueryData<Details>(ISSUE_KEY)?.issue).toMatchObject({ version: 5, priority: "HIGH" });

    // The same version is accepted: label and watcher writes bump nothing, and
    // their re-reads are how they land.
    seedIssueVersion(5);
    seedIssueLabels([{ id: "label-1", name: "backend", color: "#0052cc" }]);
    await queryClient.refetchQueries({ queryKey: ISSUE_KEY });
    expect(queryClient.getQueryData<Details>(ISSUE_KEY)?.issue).toMatchObject({
      version: 5,
      labels: [{ id: "label-1", name: "backend", color: "#0052cc" }],
    });
  });

  it("never lets a write's answer take the labels off the panel", async () => {
    seedIssueLabels([{ id: "label-1", name: "backend", color: "#0052cc" }]);
    const queryClient = renderBoard(ISSUE_PATH);
    const panel = await openPanel();
    expect(await panel.findByText("backend")).toBeVisible();

    // The re-read after the write is held, so what is on screen is the write's
    // answer merged into the cache — and that answer carries no labels.
    holdIssue(true);
    fireEvent.click(panel.getByRole("button", { name: "Low" }));
    await waitFor(() => expect(panel.getByRole("button", { name: "Low" })).toHaveClass("is-active"));

    expect(panel.getByText("backend")).toBeVisible();
    expect(queryClient.getQueryData<{ issue: { version: number } }>(ISSUE_KEY)?.issue.version).toBe(2);
    releaseIssue();
  });

  it("rolls back only the field a refused edit sent, and words the date-order refusal as advice", async () => {
    renderBoard(ISSUE_PATH);
    const panel = await openPanel();
    failNextUpdate(
      Object.assign(new Error("Start date: 2026-07-01 must not be after Due date: 2026-06-26"), {
        code: "INVALID_ARGUMENT",
        status: 400,
      }),
    );

    const start = panel.getByLabelText("Start date");
    const points = panel.getByLabelText("Story points");
    fireEvent.change(start, { target: { value: "2026-07-01" } });
    fireEvent.blur(start);
    // A draft in another box, typed while the refused write is out.
    fireEvent.change(points, { target: { value: "8" } });

    expect(await panel.findByRole("alert")).toHaveTextContent(
      "The start date cannot be later than this issue's current due date — move the due date first",
    );
    await waitFor(() => expect(start).toHaveValue("2026-06-15"));
    expect(points).toHaveValue("8");
  });
});

/**
 * A create is optimistic, so a new label is drawn the instant it is asked for,
 * carrying `optimisticLabelId` until the server answers with a real one. That
 * placeholder is for the *list*: it is not an address, and every route that
 * takes a label id types it `format: uuid`, so submitting it is "Label not
 * found" from the mock and a 400 from the gateway.
 *
 * Both pickers offered it anyway for the length of the round trip — the board's
 * filter and the panel's "Add label" — which is a control offering an action
 * that cannot succeed, to the one person most likely to take it: whoever just
 * made the label. Held rather than raced, so the window is the whole test.
 */
describe("a label the server has not answered for yet", () => {
  beforeEach(() => {
    reset();
    window.localStorage.clear();
  });

  const optionNames = (select: HTMLElement) =>
    Array.from((select as HTMLSelectElement).options).map((option) => option.textContent);

  it("is drawn in the manage list, and offered by neither picker", async () => {
    seedLabels([{ id: "label-backend", name: "backend", color: "#0052cc" }]);
    holdLabelCreate(true);
    renderBoard(`/projects/${PROJECT_ID}/issues/issue-1`);

    const boardPicker = await screen.findByLabelText("Label");
    const panelPicker = await screen.findByLabelText("Add label");
    await waitFor(() => expect(optionNames(boardPicker)).toEqual(["All", "backend"]));
    expect(optionNames(panelPicker)).toEqual(["Select a label", "backend"]);

    fireEvent.click(screen.getByRole("button", { name: "Manage labels" }));
    fireEvent.change(await screen.findByLabelText("New label"), { target: { value: "release" } });
    fireEvent.click(screen.getByRole("button", { name: "Add label" }));

    // Drawn at once, which is the whole point of the optimistic row — and
    // marked as a row nothing may be done to yet, which the modal already did.
    const pendingRow = await screen.findByRole("button", { name: "Edit release" });
    expect(pendingRow).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete release" })).toBeDisabled();

    // Neither picker grew an option for it.
    expect(optionNames(boardPicker)).toEqual(["All", "backend"]);
    expect(optionNames(panelPicker)).toEqual(["Select a label", "backend"]);
  });

  it("is offered by both the moment the server answers", async () => {
    seedLabels([{ id: "label-backend", name: "backend", color: "#0052cc" }]);
    renderBoard(`/projects/${PROJECT_ID}/issues/issue-1`);

    const boardPicker = await screen.findByLabelText("Label");
    const panelPicker = await screen.findByLabelText("Add label");
    await waitFor(() => expect(optionNames(boardPicker)).toEqual(["All", "backend"]));

    fireEvent.click(screen.getByRole("button", { name: "Manage labels" }));
    fireEvent.change(await screen.findByLabelText("New label"), { target: { value: "release" } });
    fireEvent.click(screen.getByRole("button", { name: "Add label" }));

    // The guard is about an id that does not exist yet, not about hiding a new
    // label: once the create settles, both pickers carry it.
    await waitFor(() => expect(optionNames(boardPicker)).toEqual(["All", "backend", "release"]));
    await waitFor(() => expect(optionNames(panelPicker)).toEqual(["Select a label", "backend", "release"]));
  });
});


/**
 * The attachments section (TAS-190). Five things are pinned here and nowhere
 * else, because each of them is a sentence the panel says about a fact only the
 * panel can know:
 *
 * - a 404 from the list has more than one cause, so it must not be read as
 *   "this issue is gone" and must not take the section off the screen;
 * - a confirm that fails is never repeated, and the list is re-read before
 *   anybody is told the file was not attached;
 * - the middle leg does not touch Taska, so a failure with no HTTP status is
 *   named as the network-or-CORS problem it is;
 * - delete is drawn per row, on two different rules;
 * - and a delete the server refuses puts the row back and says why, because a
 *   file the reader believes is gone is worse than an error they can read.
 */
describe("issue attachments", () => {
  const ISSUE_PATH = `/projects/${PROJECT_ID}/issues/issue-1`;

  const attachment = (over: Partial<ReturnType<typeof baseAttachment>> = {}) => ({ ...baseAttachment(), ...over });
  function baseAttachment() {
    return {
      id: "attachment-seed",
      issueId: "issue-1",
      fileName: "login-500-trace.txt",
      contentType: "text/plain",
      sizeBytes: 2411,
      uploadedBy: "user-anna",
      checksum: null as string | null,
      createdAt: "2026-08-01T09:00:00Z",
    };
  }

  const section = async () => {
    const heading = await screen.findByRole("heading", { name: /attachments/i });
    const found = heading.closest("section");
    if (!found) throw new Error("no attachments section");
    return within(found);
  };

  /**
   * Hands a file to the input the "Attach a file" button drives. The input is
   * `hidden` and has no accessible name on purpose — it is not a tab stop, the
   * button is — so it is reached by class rather than by role, which is the one
   * place in this file that is allowed to.
   */
  const chooseFile = (name = "notes.txt", type = "text/plain", sizeBytes?: number) => {
    const fileInput = document.querySelector<HTMLInputElement>(".attachment-input");
    if (!fileInput) throw new Error("no file input");
    // A real byte array when a size is asked for, because `File.size` is read
    // off the parts and the size arm of the refusal is decided on it.
    const parts = sizeBytes === undefined ? ["trace body"] : [new Uint8Array(sizeBytes)];
    fireEvent.change(fileInput, { target: { files: [new File(parts, name, { type })] } });
  };

  beforeEach(() => {
    reset();
    window.localStorage.clear();
  });

  it("lists what is attached, with its size, uploader and time", async () => {
    // The byline resolves a user id through the project's member list, like
    // every other name in the panel. Without a member list there is no name to
    // print, and the row prints the size and the time rather than "Unknown" —
    // which is what a failed member read, or an uploader the list does not
    // name, looks like.
    seedMembers([
      { userId: "user-anna", role: "ADMIN", addedAt: "2026-08-01T09:00:00Z", addedBy: "user-anna", user: { displayName: "Anna Ivanova", email: "anna@example.com" } },
    ]);
    seedAttachments([attachment()]);
    renderBoard(ISSUE_PATH);

    const panel = await section();
    const row = await panel.findByRole("button", { name: "Open login-500-trace.txt in a new tab" });
    expect(row).toHaveTextContent("login-500-trace.txt");
    expect(row).toHaveTextContent("2.4 KB");
    expect(row).toHaveTextContent("Anna Ivanova");
  });

  it("keeps the section and says so when the issue read came back without its attachments", async () => {
    // Since TAS-246 the list rides on the issue read, and issue-service leaves
    // the part out when its own source fails rather than failing the read.
    // Dropping the section over that would hide a whole feature over one part,
    // and "No attachments yet" would be a claim the answer never made.
    failAttachmentsRead(Object.assign(new Error("Issue not found"), { status: 404, code: "NOT_FOUND" }));
    renderBoard(ISSUE_PATH);

    const panel = await section();
    expect(await panel.findByText(/attachments could not be loaded with this issue/i)).toBeVisible();
    expect(panel.queryByText("No attachments yet")).toBeNull();
    expect(panel.getByRole("heading", { name: /attachments/i })).toBeVisible();
    // A failed list is not a reason to take the upload away: the write is its
    // own request, and the server answers it on its own terms.
    expect(panel.getByRole("button", { name: /attach a file/i })).toBeVisible();
  });

  it("refuses a file the server's allowlist would refuse, before any request", async () => {
    renderBoard(ISSUE_PATH);
    await section();
    // The `.zip` Windows browsers report differently. `accept` lets it through
    // the picker; the allowlist does not.
    chooseFile("bundle.zip", "application/x-zip-compressed");

    const panel = await section();
    // The file by name and the way out, not the MIME string the server would
    // have answered with. This arm never reaches a server, so there is no
    // wording to be verbatim with — see `refusalText`.
    const refusal = await panel.findByText(/bundle\.zip is not a type this issue accepts/);
    expect(refusal).toHaveTextContent(/Attach JPEG, PNG or WebP images, PDF/);
    expect(refusal).not.toHaveTextContent(/application\/x-zip-compressed/);
    // Nothing was uploaded and nothing was confirmed.
    expect(confirmCalls()).toBe(0);
  });

  it("states an over-size file in the units the picker states the limit in", async () => {
    renderBoard(ISSUE_PATH);
    await section();
    // One byte over, which is the likeliest way to meet this ceiling and the
    // case that breaks the obvious sentence: `formatFileSize` prints both this
    // file and the limit as "2 MB", so naming the two sizes would read "is 2
    // MB. The largest … is 2 MB".
    chooseFile("huge.png", "image/png", ATTACHMENT_MAX_SIZE_BYTES + 1);

    const panel = await section();
    const refusal = await panel.findByText(/huge\.png is just over 2 MB/);
    expect(refusal).toHaveTextContent(/largest file this issue accepts/);
    // Never the server's byte arithmetic, which contradicts the hint above it.
    expect(refusal).not.toHaveTextContent(/2097153/);
    expect(confirmCalls()).toBe(0);
  });

  it("names the size when it differs from the limit as printed", async () => {
    renderBoard(ISSUE_PATH);
    await section();
    chooseFile("huge.png", "image/png", 3 * 1024 * 1024);

    const panel = await section();
    expect(await panel.findByText("huge.png is 3 MB. The largest file this issue accepts is 2 MB.")).toBeVisible();
  });

  it("runs the three legs and shows the new row", async () => {
    renderBoard(ISSUE_PATH);
    await section();
    chooseFile();

    const panel = await section();
    expect(await panel.findByRole("button", { name: "Download notes.txt" })).toBeVisible();
    expect(confirmCalls()).toBe(1);
  });

  it("names a blocked cross-origin PUT as a network-or-CORS problem, not as 'upload failed'", async () => {
    // The shape a refused preflight takes: no status anywhere, because the
    // browser does not tell script why.
    failUpload("put", new ObjectStoreError("The file store could not be reached: Failed to fetch", "STORAGE_UNREACHABLE", null));
    renderBoard(ISSUE_PATH);
    await section();
    chooseFile();

    const panel = await section();
    const message = await panel.findByText(/could not reach the file store/i);
    expect(message).toHaveTextContent(/straight to storage rather than through Taska/i);
    expect(confirmCalls()).toBe(0);
  });

  it("reads a store 403 as an expired upload link rather than as a permission failure", async () => {
    failUpload("put", new ObjectStoreError("The file store answered 403.", "STORAGE_REJECTED", 403));
    renderBoard(ISSUE_PATH);
    await section();
    chooseFile();

    const panel = await section();
    expect(await panel.findByText(/15 minutes from the moment the file is chosen/i)).toBeVisible();
  });

  it("re-reads the list after a failed confirm and does not claim the file was lost when it was not", async () => {
    // The confirm succeeded on the server and the answer never came back. This
    // is the sentence the whole "refetch before speaking" rule exists for.
    failUpload("confirm", Object.assign(new Error("Service unavailable"), { status: 503, code: "UNAVAILABLE" }), true);
    renderBoard(ISSUE_PATH);
    await section();
    chooseFile();

    const panel = await section();
    expect(await panel.findByText(/was attached after all/i)).toBeVisible();
    // And the row it is telling the truth about is on screen.
    expect(await panel.findByRole("button", { name: "Download notes.txt" })).toBeVisible();
    // Never repeated: a second confirm is a second row on the server.
    expect(confirmCalls()).toBe(1);
  });

  it("decides a failed confirm from the attachments' own route, so a part that failed cannot say 'not attached'", async () => {
    // The gateway sends an attachments part that failed as `[]` — one object
    // missing from storage is enough — so the issue read would have counted no
    // new row and told the reader to upload the file again (release-reviewer,
    // TAS-246). The list route fails as a request when it fails.
    emptyPartsOnRead({ attachments: true });
    failUpload("confirm", Object.assign(new Error("Service unavailable"), { status: 503, code: "UNAVAILABLE" }), true);
    renderBoard(ISSUE_PATH);
    await section();
    chooseFile();

    const panel = await section();
    expect(await panel.findByText(/was attached after all/i)).toBeVisible();
    expect(panel.queryByText(/was not attached/i)).toBeNull();
    expect(sectionReads().attachments).toBe(1);
    // And what the list route found is what the section draws.
    expect(await panel.findByRole("button", { name: "Download notes.txt" })).toBeVisible();
    expect(confirmCalls()).toBe(1);
  });

  it("says the file was not attached only when the re-read agrees", async () => {
    failUpload("confirm", Object.assign(new Error("Service unavailable"), { status: 503, code: "UNAVAILABLE" }), false);
    renderBoard(ISSUE_PATH);
    await section();
    chooseFile();

    const panel = await section();
    expect(await panel.findByText(/notes\.txt was not attached/i)).toBeVisible();
    expect(confirmCalls()).toBe(1);
    expect(listedAttachments()).toHaveLength(0);
  });

  /**
   * A stand-in for the tab `window.open("", "_blank")` hands back: blank until
   * the panel points it at the link. `opener` starts as this page, the way a
   * real one does, so the test can see the panel cut it.
   */
  const fakeTab = () => {
    const replace = vi.fn((_url: string) => {});
    const close = vi.fn(() => {});
    return { opener: window as Window | null, closed: false, location: { replace }, close };
  };

  it("opens the link in a new tab without telling a reader whose tab opened that it was blocked", async () => {
    // The defect TAS-253 fixes: `window.open(url, "_blank", "noopener")`
    // returns `null` by spec, so every tab that *did* open was reported as one
    // the popup blocker had stopped.
    seedAttachments([attachment()]);
    const tab = fakeTab();
    const open = vi.fn((_url?: string, _target?: string, _features?: string) => tab as unknown as Window);
    vi.stubGlobal("open", open);
    renderBoard(ISSUE_PATH);

    const panel = await section();
    fireEvent.click(await panel.findByRole("button", { name: "Open login-500-trace.txt in a new tab" }));

    // Opened inside the click, blank, and with no feature string — `noopener`
    // is what made the answer `null` — and cut from this page by hand.
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0]).toEqual(["", "_blank"]);
    expect(tab.opener).toBeNull();
    // Then pointed at the fresh presigned link, once it came back.
    await waitFor(() => expect(tab.location.replace).toHaveBeenCalledWith(expect.stringContaining("X-Amz-Signature=")));
    expect(panel.queryByText(/did not open a tab/)).toBeNull();
    expect(panel.queryByRole("link", { name: "Open" })).toBeNull();
    // Open never fetches the bytes: it is the store's link, in the store's tab.
    expect(bytesReads()).toEqual([]);
    vi.unstubAllGlobals();
  });

  it("offers the link to click when the browser genuinely refused the tab", async () => {
    seedAttachments([attachment()]);
    // Without `noopener`, `null` is the popup blocker's one honest signal.
    vi.stubGlobal("open", vi.fn(() => null));
    renderBoard(ISSUE_PATH);

    const panel = await section();
    fireEvent.click(await panel.findByRole("button", { name: "Open login-500-trace.txt in a new tab" }));

    const fallback = await panel.findByRole("link", { name: "Open" });
    expect(fallback).toHaveAttribute("href", expect.stringContaining("X-Amz-Signature="));
    expect(fallback).toHaveAttribute("rel", "noopener noreferrer");
    // And it is announced, because otherwise a keyboard reader presses Enter,
    // nothing opens, and an unannounced tab stop appears in the row.
    expect(
      await panel.findByText("Your browser did not open a tab for login-500-trace.txt. Use the Open link beside it."),
    ).toBeVisible();
    vi.unstubAllGlobals();
  });

  it("closes the waiting tab and says why when no link comes back", async () => {
    seedAttachments([attachment()]);
    const tab = fakeTab();
    vi.stubGlobal("open", vi.fn(() => tab as unknown as Window));
    renderBoard(ISSUE_PATH);
    const panel = await section();
    await panel.findByRole("button", { name: "Open login-500-trace.txt in a new tab" });
    seedDownloadUrl("");

    fireEvent.click(panel.getByRole("button", { name: "Open login-500-trace.txt in a new tab" }));

    expect(await panel.findByText("No link came back for login-500-trace.txt.")).toBeVisible();
    expect(tab.close).toHaveBeenCalled();
    expect(tab.location.replace).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("never loads a javascript: link into the waiting tab or the fallback link", async () => {
    seedAttachments([attachment()]);
    const tab = fakeTab();
    vi.stubGlobal("open", vi.fn(() => tab as unknown as Window));
    renderBoard(ISSUE_PATH);
    const panel = await section();
    await panel.findByRole("button", { name: "Open login-500-trace.txt in a new tab" });
    seedDownloadUrl("javascript:alert(document.domain)");

    fireEvent.click(panel.getByRole("button", { name: "Open login-500-trace.txt in a new tab" }));
    expect(await panel.findByText("No link came back for login-500-trace.txt.")).toBeVisible();
    expect(tab.close).toHaveBeenCalled();
    expect(tab.location.replace).not.toHaveBeenCalled();

    // Download: the same link neither reaches the byte GET's fallback tab nor an anchor.
    fireEvent.click(panel.getByRole("button", { name: "Download login-500-trace.txt" }));
    await waitFor(() => expect(panel.getAllByText("No link came back for login-500-trace.txt.").length).toBeGreaterThan(0));
    expect(tab.location.replace).not.toHaveBeenCalled();
    expect(bytesReads()).toEqual([]);
    expect(document.querySelector('a[href^="javascript:"]')).toBeNull();

    // And with the browser refusing the tab, no fallback link is offered either.
    vi.stubGlobal("open", vi.fn(() => null));
    fireEvent.click(panel.getByRole("button", { name: "Open login-500-trace.txt in a new tab" }));
    await panel.findByText("No link came back for login-500-trace.txt.");
    expect(panel.queryByRole("link", { name: "Open" })).toBeNull();
    vi.unstubAllGlobals();
  });

  it("saves the file under its own name from the fetched bytes", async () => {
    seedAttachments([attachment()]);
    const open = vi.fn(() => null);
    vi.stubGlobal("open", open);
    // jsdom has neither; `src/lib/browserFiles.test.ts` covers the revoke.
    const original = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };
    const createObjectURL = vi.fn((_blob: Blob) => "blob:taska/1");
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = vi.fn((_url: string) => {});
    const clicked: { href: string; download: string }[] = [];
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        clicked.push({ href: this.href, download: this.download });
      });
    renderBoard(ISSUE_PATH);

    const panel = await section();
    fireEvent.click(await panel.findByRole("button", { name: "Download login-500-trace.txt" }));

    await waitFor(() => expect(clicked).toEqual([{ href: "blob:taska/1", download: "login-500-trace.txt" }]));
    expect(bytesReads()).toEqual([expect.stringContaining("X-Amz-Signature=")]);
    expect(createObjectURL.mock.calls[0][0]).toBeInstanceOf(Blob);
    // No tab, and nothing said: the file is in the reader's downloads.
    expect(open).not.toHaveBeenCalled();
    expect(panel.queryByText(/could not be saved/)).toBeNull();
    // The temporary anchor does not stay in the document.
    expect(document.querySelector("a[download]")).toBeNull();
    click.mockRestore();
    Object.assign(URL, original);
    vi.unstubAllGlobals();
  });

  it("opens the link instead, as information, when the store will not hand over the bytes", async () => {
    seedAttachments([attachment()]);
    failBytes(new ObjectStoreError("The file store could not be reached: Failed to fetch", "STORAGE_UNREACHABLE", null));
    const tab = fakeTab();
    vi.stubGlobal("open", vi.fn(() => tab as unknown as Window));
    renderBoard(ISSUE_PATH);

    const panel = await section();
    fireEvent.click(await panel.findByRole("button", { name: "Download login-500-trace.txt" }));

    await waitFor(() => expect(tab.location.replace).toHaveBeenCalledWith(expect.stringContaining("X-Amz-Signature=")));
    const note = await panel.findByText(
      "login-500-trace.txt could not be saved directly, so it opened in a new tab instead. Save it from there.",
    );
    // Information, not an error: the reader still gets the file.
    expect(note).not.toHaveClass("is-error");
    vi.unstubAllGlobals();
  });

  it("offers the link when the bytes failed and the browser refused the fallback tab too", async () => {
    seedAttachments([attachment()]);
    failBytes(new ObjectStoreError("The file store answered 403.", "STORAGE_REJECTED", 403));
    vi.stubGlobal("open", vi.fn(() => null));
    renderBoard(ISSUE_PATH);

    const panel = await section();
    fireEvent.click(await panel.findByRole("button", { name: "Download login-500-trace.txt" }));

    expect(await panel.findByRole("link", { name: "Open" })).toHaveAttribute("href", expect.stringContaining("X-Amz-Signature="));
    expect(await panel.findByText(/could not be saved directly, and your browser did not open a tab for it/)).not.toHaveClass(
      "is-error",
    );
    vi.unstubAllGlobals();
  });

  it("does not fall back on an error that is not the store's: it reaches the error notice and no tab opens", async () => {
    seedAttachments([attachment()]);
    failBytes(new TypeError("boom"));
    const open = vi.fn();
    vi.stubGlobal("open", open);
    renderBoard(ISSUE_PATH);

    const panel = await section();
    fireEvent.click(await panel.findByRole("button", { name: "Download login-500-trace.txt" }));

    expect(await panel.findByText("boom")).toHaveClass("is-error");
    expect(open).not.toHaveBeenCalled();
    expect(panel.queryByText(/could not be saved directly/)).toBeNull();
    vi.unstubAllGlobals();
  });

  /** A drag of files from the desktop, as the section receives it. */
  const filesDrag = (files: File[]) => ({ dataTransfer: { types: ["Files"], files, dropEffect: "none" } });

  it("uploads dropped files one after another and refuses the one the server would refuse", async () => {
    renderBoard(ISSUE_PATH);
    const panel = await section();
    const target = (await screen.findByRole("heading", { name: /attachments/i })).closest("section")!;
    const files = [
      new File(["one"], "first.txt", { type: "text/plain" }),
      new File(["GIF89a"], "cat.gif", { type: "image/gif" }),
      new File(["two"], "second.txt", { type: "text/plain" }),
    ];

    fireEvent.dragEnter(target, filesDrag(files));
    // The drop state is drawn while files are held over the section.
    expect(target).toHaveClass("is-drop-target");
    expect(target.querySelector(".attachment-drop-overlay")).toHaveTextContent("Drop to attach");
    fireEvent.dragOver(target, filesDrag(files));
    fireEvent.drop(target, filesDrag(files));
    expect(target).not.toHaveClass("is-drop-target");

    // The GIF is refused by name, before any request; the other two land.
    expect(await panel.findByText(/cat\.gif is not a type this issue accepts/)).toBeVisible();
    expect(await panel.findByRole("button", { name: "Open first.txt in a new tab" })).toBeVisible();
    expect(await panel.findByRole("button", { name: "Open second.txt in a new tab" })).toBeVisible();
    // One at a time: the second file is not signed until the first is confirmed.
    expect(uploadLog()).toEqual(["sign first.txt", "confirm first.txt", "sign second.txt", "confirm second.txt"]);
  });

  it("keeps the drop state steady while the pointer crosses the section's children", async () => {
    renderBoard(ISSUE_PATH);
    const target = (await screen.findByRole("heading", { name: /attachments/i })).closest("section")!;
    const drag = filesDrag([new File(["x"], "a.txt", { type: "text/plain" })]);

    fireEvent.dragEnter(target, drag);
    fireEvent.dragEnter(target.querySelector(".attachment-picker")!, drag);
    fireEvent.dragLeave(target, drag);
    expect(target).toHaveClass("is-drop-target");
    fireEvent.dragLeave(target.querySelector(".attachment-picker")!, drag);
    expect(target).not.toHaveClass("is-drop-target");
  });

  it("ignores a drag that carries no files", async () => {
    renderBoard(ISSUE_PATH);
    const target = (await screen.findByRole("heading", { name: /attachments/i })).closest("section")!;
    fireEvent.dragEnter(target, { dataTransfer: { types: ["text/plain"], files: [] } });
    expect(target).not.toHaveClass("is-drop-target");
  });

  it("takes no drop from a VIEWER, and still stops the browser navigating to the file", async () => {
    setMembership("VIEWER");
    renderBoard(ISSUE_PATH);
    const panel = await section();
    const target = (await screen.findByRole("heading", { name: /attachments/i })).closest("section")!;
    const drag = filesDrag([new File(["x"], "a.txt", { type: "text/plain" })]);

    fireEvent.dragEnter(target, drag);
    expect(target).not.toHaveClass("is-drop-target");
    // `fireEvent` answers `false` when the handler prevented the default —
    // the browser's own handling of an unhandled drop is to open the file.
    expect(fireEvent.dragOver(target, drag)).toBe(false);
    expect(fireEvent.drop(target, drag)).toBe(false);
    expect(drag.dataTransfer.dropEffect).toBe("none");
    expect(uploadLog()).toEqual([]);
    expect(panel.queryByText(/Waiting|Preparing/)).toBeNull();
  });

  it("refuses a file dropped elsewhere on the panel instead of letting the tab navigate to it", async () => {
    renderBoard(ISSUE_PATH);
    await section();
    const description = screen.getByRole("dialog", { name: "TAS-102 issue" }).querySelector(".issue-panel-head")!;
    const drag = filesDrag([new File(["x"], "a.txt", { type: "text/plain" })]);
    expect(fireEvent.dragOver(description, drag)).toBe(false);
    expect(drag.dataTransfer.dropEffect).toBe("none");
    expect(fireEvent.drop(description, drag)).toBe(false);
    expect(uploadLog()).toEqual([]);
  });

  it("takes several files from the button too, which is the drop's keyboard equivalent", async () => {
    renderBoard(ISSUE_PATH);
    const panel = await section();
    const input = document.querySelector<HTMLInputElement>(".attachment-input")!;
    expect(input).toHaveAttribute("multiple");
    fireEvent.change(input, {
      target: { files: [new File(["a"], "a.txt", { type: "text/plain" }), new File(["b"], "b.txt", { type: "text/plain" })] },
    });
    expect(await panel.findByRole("button", { name: "Open b.txt in a new tab" })).toBeVisible();
    expect(confirmCalls()).toBe(2);
  });

  it("removes an attachment optimistically", async () => {
    seedAttachments([attachment()]);
    holdDelete(true);
    renderBoard(ISSUE_PATH);

    const panel = await section();
    await panel.findByRole("button", { name: "Download login-500-trace.txt" });
    fireEvent.click(panel.getByRole("button", { name: "Delete login-500-trace.txt" }));
    await waitFor(() => expect(heldDeleteCount()).toBe(1));

    // Gone while the delete is still in flight. Held on purpose: against a
    // fake that answers on the next tick, the row would also have disappeared
    // because the server no longer lists it, and the test could not tell an
    // optimistic removal from a fast one.
    await waitFor(() => expect(panel.queryByRole("button", { name: "Download login-500-trace.txt" })).toBeNull());
    expect(deletedAttachments()).toEqual([]);

    releaseDelete();
    await waitFor(() => expect(deletedAttachments()).toEqual(["attachment-seed"]));
    expect(panel.queryByRole("button", { name: "Download login-500-trace.txt" })).toBeNull();
  });

  it("puts the row back and says why when the server refuses the delete", async () => {
    seedAttachments([attachment()]);
    // The refusal this can actually meet: `delete-attachment-roles` is ADMIN
    // and `delete-own-attachment-roles` is ADMIN or MEMBER, so a role that
    // changed between the list being drawn and the button being pressed is a
    // 403 on a control that was correctly offered. The server is the authority
    // either way — hiding the button is a courtesy, not the rule.
    failDelete(
      Object.assign(new Error("You do not have permission to delete this attachment"), {
        status: 403,
        code: "PERMISSION_DENIED",
      }),
    );
    holdDelete(true);
    renderBoard(ISSUE_PATH);

    const panel = await section();
    await panel.findByRole("button", { name: "Download login-500-trace.txt" });

    // From here the list re-read never answers, so what is on screen below is
    // the cache the mutation left behind. Without this the `onSettled`
    // invalidation would restore the row on its own and this test would pass
    // with `onError`'s rollback deleted — which is exactly what it is for.
    holdAttachmentsRead(true);
    fireEvent.click(panel.getByRole("button", { name: "Delete login-500-trace.txt" }));
    await waitFor(() => expect(heldDeleteCount()).toBe(1));
    await waitFor(() => expect(panel.queryByRole("button", { name: "Download login-500-trace.txt" })).toBeNull());

    releaseDelete();

    // Back, with the server's own sentence beside it. Both halves matter: a
    // row that stayed gone would be a file the reader believes was deleted,
    // and a row that came back silently would be one they think still is.
    expect(await panel.findByRole("button", { name: "Download login-500-trace.txt" })).toBeVisible();
    expect(await panel.findByText("You do not have permission to delete this attachment")).toBeVisible();
    expect(deletedAttachments()).toEqual([]);
  });

  it("draws delete on your own row for a MEMBER and on nobody else's", async () => {
    setMembership("MEMBER");
    seedAttachments([
      attachment(),
      attachment({ id: "attachment-mark", fileName: "validation-error.png", uploadedBy: "user-mark" }),
    ]);
    renderBoard(ISSUE_PATH);

    const panel = await section();
    // `delete-own-attachment-roles: ADMIN,MEMBER` — Anna uploaded this one.
    expect(await panel.findByRole("button", { name: "Delete login-500-trace.txt" })).toBeVisible();
    // `delete-attachment-roles: ADMIN` — and this reader is not one.
    expect(panel.queryByRole("button", { name: "Delete validation-error.png" })).toBeNull();
  });

  it("draws delete on both rows for an ADMIN", async () => {
    setMembership("ADMIN");
    seedAttachments([
      attachment(),
      attachment({ id: "attachment-mark", fileName: "validation-error.png", uploadedBy: "user-mark" }),
    ]);
    renderBoard(ISSUE_PATH);

    const panel = await section();
    expect(await panel.findByRole("button", { name: "Delete login-500-trace.txt" })).toBeVisible();
    expect(panel.getByRole("button", { name: "Delete validation-error.png" })).toBeVisible();
  });

  it("offers a VIEWER the list and the download and neither write", async () => {
    setMembership("VIEWER");
    seedAttachments([attachment()]);
    renderBoard(ISSUE_PATH);

    const panel = await section();
    expect(await panel.findByRole("button", { name: "Download login-500-trace.txt" })).toBeVisible();
    expect(panel.queryByRole("button", { name: /attach a file/i })).toBeNull();
    expect(panel.queryByRole("button", { name: /^Delete / })).toBeNull();
  });

  it("states the limit and the accepted types before a file is chosen", async () => {
    renderBoard(ISSUE_PATH);

    const panel = await section();
    const hint = await panel.findByText(/Up to 2 MB\./);
    // The list refuses more than people expect, so it is on screen rather than
    // discovered by being refused.
    expect(hint).toHaveTextContent(/JPEG, PNG or WebP images, PDF/);
    expect(hint).toHaveTextContent(/ZIP/);
  });
});

/**
 * The watchers section (TAS-193). What is pinned here is the handful of facts
 * that live only in this component:
 *
 * - the count on screen is the number the *server* stated, never the length of
 *   the array it happened to send, and a write states one without a refetch;
 * - an unwatch that removed nothing is reported as exactly that — not as a
 *   change, and not as a failure;
 * - the toggle is live for an ADMIN or a MEMBER only — the server's
 *   `watch-issue-roles` (TAS-226) — and shows everybody else their subscription
 *   without a way to change it, while the two ADMIN controls are gated on ADMIN;
 * - a refused ADMIN add puts the row back and says why;
 * - and a member read that failed does not get presented as a project with
 *   nobody left to add.
 */
describe("issue watchers", () => {
  const ISSUE_PATH = `/projects/${PROJECT_ID}/issues/issue-1`;
  const ANNA = "user-anna";
  const SOFIA = "user-sofia";

  const watcher = (userId: string, id = `watcher-${userId}`) => ({
    id,
    issueId: "issue-1",
    projectId: PROJECT_ID,
    userId,
    createdAt: "2026-09-02T10:15:00Z",
    createdBy: userId,
  });

  const member = (userId: string, displayName: string) => ({
    userId,
    role: "MEMBER" as const,
    addedAt: "2026-08-01T09:00:00Z",
    addedBy: ANNA,
    user: { displayName, email: `${displayName.split(" ")[0].toLowerCase()}@example.com` },
  });

  /**
   * A membership row that names nobody — a row whose `displayName` the server
   * left out, which `RestTaskaApi` maps to a member with no `user` at all
   * (TAS-219), and which `toUserMap` then drops. It is the picker's half of the
   * state the rows call "Unknown".
   */
  const nameless = (userId: string) => ({
    userId,
    role: "MEMBER" as const,
    addedAt: "2026-08-01T09:00:00Z",
    addedBy: ANNA,
  });

  /**
   * A refusal with nothing to say, which is the **only** way to reach the
   * section's own failure sentences: `watcherFailureText` returns the server's
   * message whenever there is one, and no implementation ships an error without
   * one — `RestTaskaApi` falls back to `Request failed with {status}` and
   * `MockApiError` always carries a string. So the two sentences below are
   * rulings about a branch today's clients cannot produce, and only the
   * `removed: false` notice — which does not go through `watcherFailureText` at
   * all — is reachable in a browser.
   */
  const silentRefusal = () => Object.assign(new Error(""), { status: 500, code: "INTERNAL" });

  const section = async () => {
    const heading = await screen.findByRole("heading", { name: /watchers/i });
    const found = heading.closest("section");
    if (!found) throw new Error("no watchers section");
    return within(found);
  };

  beforeEach(() => {
    reset();
    window.localStorage.clear();
  });

  it("draws no count at all — not the rows it sent, and not a count a write states", async () => {
    // The issue read states no count (TAS-246), and a component reading
    // `watchers.length` would put a 2 here — or, on the gateway, a "0" over a
    // part that failed and arrived as `[]`. A write's own count is not drawn
    // either: the next re-read would take it away again. No pill until the
    // read carries one (backend ask A3).
    seedWatchers([watcher(SOFIA), watcher("user-tom")], 7, 7);
    renderBoard(ISSUE_PATH);

    const panel = await section();
    await waitFor(() => expect(document.querySelectorAll(".issue-watchers .watcher-row")).toHaveLength(2));
    expect(document.querySelector(".issue-watchers .count-pill")).toBeNull();

    holdWatchersRead(true);
    fireEvent.click(await panel.findByRole("button", { name: "Watch" }));
    await waitFor(() => expect(watchedUserIds()).toContain(ANNA));
    expect(document.querySelectorAll(".issue-watchers .watcher-row")).toHaveLength(3);
    expect(document.querySelector(".issue-watchers .count-pill")).toBeNull();
    expect(panel.queryByText("7")).toBeNull();
  });

  it("reads the toggle from the list and flips it on a press", async () => {
    seedWatchers([watcher(SOFIA)], 1, 2);
    renderBoard(ISSUE_PATH);

    const panel = await section();
    const toggle = await panel.findByRole("button", { name: "Watch" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(toggle);

    // The optimistic flip, and then the row the server confirmed.
    expect(await panel.findByRole("button", { name: "Watching" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(watchedUserIds()).toContain(ANNA));
  });

  it("says an unwatch removed nothing, without calling it a failure", async () => {
    seedWatchers([watcher(ANNA)], 1, 1);
    setUnwatchAnswer(false);
    renderBoard(ISSUE_PATH);

    const panel = await section();
    fireEvent.click(await panel.findByRole("button", { name: "Watching" }));

    // The box, not the sentence inside it: the tone is drawn on the box, and
    // `.watcher-note-sentence` happens to contain "watcher-note" as a substring,
    // so asserting on the text node's own class would pass whatever the box
    // said.
    const notice = (await panel.findByText(/were not watching this issue/i)).parentElement!;
    // The distinction the server drew has to survive to the screen: this is a
    // 200 that changed nothing, so it is not dressed as an error.
    expect(notice).not.toHaveClass("is-error");
    expect(notice).toHaveClass("watcher-note");
    // Nothing to file about a 200, so no detail line under it.
    expect(notice.querySelector(".watcher-note-detail")).toBeNull();
  });

  it("says nothing when an unwatch did remove something", async () => {
    seedWatchers([watcher(ANNA)], 1, 0);
    renderBoard(ISSUE_PATH);

    const panel = await section();
    fireEvent.click(await panel.findByRole("button", { name: "Watching" }));

    await panel.findByRole("button", { name: "Watch" });
    expect(panel.queryByText(/nothing was removed/i)).toBeNull();
  });

  it("shows a VIEWER their subscription, gives them no way to change it, and says why", async () => {
    // This case used to assert an enabled toggle, on the belief that the
    // contract's silence about `…/watchers/me` meant no role. issue-service's
    // `watch-issue-roles` is ADMIN and MEMBER, and refuses a VIEWER (TAS-226).
    setMembership("VIEWER");
    seedMembers([member(SOFIA, "Sofia Reyes")]);
    seedWatchers([watcher(SOFIA)], 1);
    renderBoard(ISSUE_PATH);

    const panel = await section();
    const toggle = await panel.findByRole("button", { name: "Watch" });
    // A real `disabled` — §4.21's exception for a control that is not coming
    // back — while the state it would change stays on screen.
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(panel.getByText("As a viewer, you cannot add yourself to this issue's watcher list.")).toBeVisible();
    // The hint is linked, not just adjacent: a screen reader announces it as
    // the toggle's description rather than as an unrelated line of text.
    expect(toggle).toHaveAccessibleDescription(
      "As a viewer, you cannot add yourself to this issue's watcher list.",
    );
    // No invitation the server would refuse.
    expect(panel.queryByText(/^Add yourself/)).toBeNull();
    expect(panel.queryByLabelText("Add a watcher")).toBeNull();
    expect(panel.queryByRole("button", { name: /^Remove / })).toBeNull();

    fireEvent.click(toggle);
    expect(watcherCalls()).toMatchObject({ watch: 0, unwatch: 0 });
  });

  it("tells a VIEWER already on the list that they cannot take themselves off it", async () => {
    // Reachable on the server: an ADMIN may subscribe a VIEWER — only the
    // ADMIN's role is checked — and a MEMBER who watched can be demoted after.
    setMembership("VIEWER");
    seedMembers([member(ANNA, "Anna Ivanova")]);
    seedWatchers([watcher(ANNA)], 1);
    renderBoard(ISSUE_PATH);

    const panel = await section();
    const toggle = await panel.findByRole("button", { name: "Watching" });
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(
      panel.getByText("You are on this issue's watcher list. As a viewer, you cannot remove yourself."),
    ).toBeVisible();

    fireEvent.click(toggle);
    expect(watcherCalls()).toMatchObject({ watch: 0, unwatch: 0 });
  });

  it("keeps the toggle off while the role is unknown, without calling the reader a viewer", async () => {
    // An answered read with no role this build knows. The board's banner says
    // why; this line must not say "viewer", which is exactly what is unknown.
    setMembership(null);
    seedWatchers([watcher(SOFIA)], 1);
    renderBoard(ISSUE_PATH);

    const panel = await section();
    const toggle = await panel.findByRole("button", { name: "Watch" });
    expect(toggle).toBeDisabled();
    expect(panel.getByText("You are not on this issue's watcher list.")).toBeVisible();
    expect(panel.queryByText(/viewer/i)).toBeNull();
  });

  it("keeps the toggle off after a failed role read, and says nothing about a role there", async () => {
    failMembership(Object.assign(new Error("Internal error"), { status: 500 }));
    seedWatchers([watcher(ANNA)], 1);
    renderBoard(ISSUE_PATH);

    // Past the retry, so this is the failed state and not the in-flight one
    // that happens to look the same.
    await screen.findByText(/project could not be loaded/i, undefined, AFTER_RETRY);
    const panel = await section();
    expect(await panel.findByRole("button", { name: "Watching" })).toBeDisabled();
    expect(panel.getByText("You are on this issue's watcher list.")).toBeVisible();
    expect(panel.queryByText(/viewer/i)).toBeNull();
  });

  it("leaves the toggle live for a MEMBER", async () => {
    setMembership("MEMBER");
    seedWatchers([], 0, 1);
    renderBoard(ISSUE_PATH);

    const panel = await section();
    const toggle = await panel.findByRole("button", { name: "Watch" });
    expect(toggle).toBeEnabled();
    expect(panel.getByText("Add yourself to this issue's watcher list.")).toBeVisible();

    fireEvent.click(toggle);
    await waitFor(() => expect(watcherCalls().watch).toBe(1));
  });

  it("offers an admin the picker and a remove per row", async () => {
    seedMembers([member(SOFIA, "Sofia Reyes"), member("user-tom", "Tom Becker")]);
    seedWatchers([watcher(SOFIA)], 1, 2);
    renderBoard(ISSUE_PATH);

    const panel = await section();
    expect(await panel.findByRole("button", { name: "Remove Sofia Reyes from watchers" })).toBeVisible();
    // Sofia is already watching, so only Tom is on offer.
    const picker = panel.getByLabelText("Add a watcher");
    await waitFor(() =>
      expect([...picker.querySelectorAll("option")].map((option) => option.textContent)).toEqual([
        "Select a member",
        "Tom Becker",
      ]),
    );
  });

  it("puts the row back and reports the refusal when the server says no to an add", async () => {
    seedMembers([member("user-tom", "Tom Becker")]);
    seedWatchers([], 0);
    failWatcherWrite(
      Object.assign(new Error("Not allowed role"), { status: 403, code: "PERMISSION_DENIED" }),
    );
    renderBoard(ISSUE_PATH);

    const panel = await section();
    const picker = await panel.findByLabelText("Add a watcher");
    fireEvent.change(picker, { target: { value: "user-tom" } });
    fireEvent.click(panel.getByRole("button", { name: "Add" }));

    // The server's own sentence, not one invented here.
    const sentence = await panel.findByText("Not allowed role");
    expect(sentence.parentElement).toHaveClass("is-error");
    // Said once. `watcherFailureText` prefers the server's message, so the
    // sentence *is* the message here and the detail line has nothing left to
    // add — this error carries no request id.
    expect(sentence.parentElement!.querySelector(".watcher-note-detail")).toBeNull();
    // And the optimistic row is gone again: a watcher the reader believes was
    // added is worse than a refusal they can read.
    await waitFor(() => expect(panel.queryByRole("button", { name: /^Remove Tom/ })).toBeNull());
    expect(watchedUserIds()).toEqual([]);
  });

  it("puts the gateway's request id under the sentence, outside the announcement", async () => {
    // **This case is the only place the id can be produced at all.** Only the
    // REST client reads `X-Request-Id` off a response; `MockApiError` carries no
    // such field, so mock mode — which is the whole e2e suite — cannot render
    // this line, and a browser run finding it absent is the mock working as
    // designed rather than the code being broken.
    seedMembers([member("user-tom", "Tom Becker")]);
    seedWatchers([], 0);
    failWatcherWrite(
      Object.assign(new Error("Not allowed role"), {
        status: 403,
        code: "PERMISSION_DENIED",
        requestId: "7f0e6d5c-1b2a-4c3d-9e8f-0a1b2c3d4e5f",
      }),
    );
    renderBoard(ISSUE_PATH);

    const panel = await section();
    const picker = await panel.findByLabelText("Add a watcher");
    fireEvent.change(picker, { target: { value: "user-tom" } });
    fireEvent.click(panel.getByRole("button", { name: "Add" }));

    const sentence = await panel.findByText("Not allowed role");
    const detail = sentence.parentElement!.querySelector(".watcher-note-detail");
    expect(detail).not.toBeNull();
    expect(detail).toHaveTextContent("7f0e6d5c-1b2a-4c3d-9e8f-0a1b2c3d4e5f");
    // The id is copyable, which is the only reason it is on screen: it goes to
    // a gateway log or a ticket, never back into this UI.
    expect(
      within(detail as HTMLElement).getByRole("button", {
        name: "Copy request id 7f0e6d5c-1b2a-4c3d-9e8f-0a1b2c3d4e5f",
      }),
    ).toBeVisible();
    // And it stays out of the announcement: the sentence is the live region
    // and no ancestor of the detail line is one, so a screen reader is never
    // made to spell out a uuid. That is the whole claim — not "one region in
    // the section": `RequestId` mounts a `role="status"` span inside the
    // detail, which is a polite region too, and it is empty here and only ever
    // holds "Copied" or "Couldn't copy".
    expect(sentence).toHaveAttribute("aria-live", "polite");
    expect(detail!.closest("[aria-live]")).toBeNull();
  });

  it("names the reader in their own row when the member list cannot", async () => {
    // A reader can be on the list without being in the member map — their own
    // row names nobody, or the member read came back without them — and then
    // the map has no row to name them from. The one person it may never fail on
    // is the reader: `GET /users/me` named them before this section drew a row.
    // A VIEWER can be on the list without having watched anything: an ADMIN
    // may subscribe them, and that checks only the ADMIN's role.
    setMembership("VIEWER");
    seedMembers([member(SOFIA, "Sofia Reyes")]);
    seedWatchers([watcher(ANNA), watcher(SOFIA)], 2);
    renderBoard(ISSUE_PATH);

    const panel = await section();
    expect(await panel.findByText("You")).toBeVisible();
    // Not "Unknown (you)" — a screen saying it does not know who you are, next
    // to a mark saying it does.
    expect(panel.queryByText("Unknown")).toBeNull();
    // The mark itself goes with the name it was annotating: it exists to pick
    // the reader out of a list of names, and "You (you)" picks nothing.
    expect(panel.queryByText("(you)")).toBeNull();
    expect(panel.getByText("Sofia Reyes")).toBeVisible();
    // The circle beside the name says the same word. Left to its own fallback
    // it says §4.4's "Unassigned", and the row announced "Unassigned You" —
    // the name and the mark beside it disagreeing about whether anyone is
    // there. The dashes stay: this row still has no user to colour.
    expect(panel.getByLabelText("You")).toHaveClass("avatar", "avatar-empty");
  });

  it("claims nothing about the member list while the read is still in flight", async () => {
    // Neither an answer nor a failure. `members` is `[]` in this state exactly
    // as it is after a failed read, and a section reading only the failure flag
    // would tell the reader this project has no members for as long as the
    // request takes.
    holdMembers(true);
    seedWatchers([watcher(SOFIA)], 1);
    renderBoard(ISSUE_PATH);

    const panel = await section();
    await panel.findByText("Unknown");
    expect(panel.queryByText(/no members to add/i)).toBeNull();
    expect(panel.queryByText(/already watching/i)).toBeNull();
    expect(panel.queryByText(/members could not be read/i)).toBeNull();
    expect(panel.queryByLabelText("Add a watcher")).toBeNull();
  });

  it("does not present a failed member read as a project with nobody to add", async () => {
    // Since TAS-251 the members are one part of the context read, which the
    // server answers whole or not at all — so a failed member read is a failed
    // role read too, and nobody is an ADMIN who could be offered the picker.
    // What must still hold is §5.6: no empty picker under "Add a watcher", and
    // no sentence claiming there is nobody left to add. (The 404 case that
    // used to sit beside this — a member read refused while the project read
    // answered — cannot happen any more: a 404 on the context is the project's
    // own, and §4.18 answers it; see "keeps a refused project refused".)
    failMembers(Object.assign(new Error("Internal error"), { status: 500, code: "INTERNAL" }));
    seedWatchers([watcher(SOFIA)], 1);
    renderBoard(ISSUE_PATH);

    await screen.findByText(/project could not be loaded/i, undefined, AFTER_RETRY);
    const panel = await section();
    // Asked twice: a 500 is a genuine failure and gets its one retry.
    expect(memberReads()).toBe(2);
    expect(panel.queryByLabelText("Add a watcher")).toBeNull();
    expect(panel.queryByText(/no members to add/i)).toBeNull();
    expect(panel.queryByRole("button", { name: `Remove watcher ${SOFIA}` })).toBeNull();
  });

  it("draws a watcher the member list cannot name without dropping the row", async () => {
    seedMembers([member(ANNA, "Anna Ivanova")]);
    seedWatchers([watcher(ANNA), watcher("user-priya")], 2);
    renderBoard(ISSUE_PATH);

    const panel = await section();
    // The same word the reporter line above already prints for an id this map
    // cannot resolve — and the circle beside it announces that word rather
    // than "Unassigned", which would have made the row read "Unassigned
    // Unknown" to a screen reader.
    expect(await panel.findByText("Unknown")).toBeVisible();
    expect(panel.getByLabelText("Unknown")).toHaveClass("avatar", "avatar-empty");
    expect(panel.getByText(/Anna Ivanova/)).toBeVisible();
  });

  it("says one word for a member it cannot name, in the picker and in the sentence about them", async () => {
    // Two words for one state, which is what made the contradiction below
    // visible: the option said "Unnamed member" and every other surface said
    // "Unknown", about the one condition both are for — a membership row with
    // no user summary, which is exactly the row `toUserMap` drops.
    seedMembers([nameless("user-priya")]);
    seedWatchers([], 0);
    failWatcherWrite(silentRefusal());
    renderBoard(ISSUE_PATH);

    const panel = await section();
    const picker = await panel.findByLabelText("Add a watcher");
    await waitFor(() =>
      expect([...picker.querySelectorAll("option")].map((option) => option.textContent)).toEqual([
        "Select a member",
        "Unknown",
      ]),
    );

    fireEvent.change(picker, { target: { value: "user-priya" } });
    fireEvent.click(panel.getByRole("button", { name: "Add" }));

    expect(await panel.findByText("Unknown was not subscribed to this issue.")).toBeVisible();
  });

  it("offers the reader the word their own row uses, and refuses them in the person it takes", async () => {
    // The same nameless membership row, except that it is the reader's own —
    // and an ADMIN may add themselves from this picker, since `addable` is
    // everyone not watching yet. Interpolating the row's word into the third
    // person sentence would have produced "You was not subscribed to this
    // issue.", so the notice says what the toggle above already says.
    seedMembers([nameless(ANNA)]);
    seedWatchers([], 0);
    failWatcherWrite(silentRefusal());
    renderBoard(ISSUE_PATH);

    const panel = await section();
    const picker = await panel.findByLabelText("Add a watcher");
    await waitFor(() =>
      expect([...picker.querySelectorAll("option")].map((option) => option.textContent)).toEqual([
        "Select a member",
        "You",
      ]),
    );

    fireEvent.change(picker, { target: { value: ANNA } });
    fireEvent.click(panel.getByRole("button", { name: "Add" }));

    expect(await panel.findByText("You were not subscribed to this issue.")).toBeVisible();
  });

  it("tells the reader their own removal removed nothing, in the person the row is written in", async () => {
    // **The one sentence of the three a browser can reach**: it is set without
    // `watcherFailureText`, so no server message can win over it.
    //
    // The fixture is an ADMIN whom the member list cannot name — since TAS-251
    // the members and the role come in one read, so the reader is missing from
    // the map because the list did not name them (auth-service's `""`), not
    // because a separate member read failed. The ✕ stays on screen through it.
    seedWatchers([watcher(ANNA)], 1, 1);
    setUnwatchAnswer(false);
    renderBoard(ISSUE_PATH);

    const panel = await section();
    fireEvent.click(await panel.findByRole("button", { name: "Remove yourself from watchers" }, AFTER_RETRY));

    const notice = (await panel.findByText("You were not watching this issue, so nothing was removed.")).parentElement!;
    // A 200 that changed nothing, said in the neutral tone — the same sentence
    // and the same tone the `…/watchers/me` unwatch gives for the same answer.
    expect(notice).not.toHaveClass("is-error");
  });

  it("says a refused removal of the reader's own row about the person the row names", async () => {
    // The contradiction this pass came back for: the row read "You", its ✕ said
    // "Remove yourself from watchers", and the sentence under both said
    // "Unknown is still watching this issue." about that same person. The
    // member list names nobody here, the reader included.
    seedWatchers([watcher(ANNA)], 1);
    failWatcherWrite(silentRefusal());
    renderBoard(ISSUE_PATH);

    const panel = await section();
    fireEvent.click(await panel.findByRole("button", { name: "Remove yourself from watchers" }, AFTER_RETRY));

    expect(await panel.findByText("You are still watching this issue.")).toBeVisible();
    // And the row it is about is still there, still reading the same word: the
    // ADMIN removal only leaves the list on the server's word, and a refusal is
    // not one.
    expect(panel.getByText("You")).toBeVisible();
  });

  it("reads a list without the reader, beside the server's own 'you are watching', as a part that did not load", async () => {
    // What a failed watcher part looks like on this gateway: `[]`, while
    // `isWatching` — from the issue's core query — still says true. Offering
    // "Watch" over that would offer a subscription the reader already has.
    seedWatchers([watcher(ANNA), watcher(SOFIA)], 2);
    emptyPartsOnRead({ watchers: true });
    renderBoard(ISSUE_PATH);

    const panel = await section();
    expect(await panel.findByText(/watchers could not be loaded with this issue/i)).toBeVisible();
    expect(panel.queryByRole("button", { name: /^Watch/ })).toBeNull();
    expect(panel.queryByText("No one is watching this issue yet")).toBeNull();
  });

  it("does not read its own optimistic unwatch as a part that did not load", async () => {
    // The reader leaving the list is the one way a correct list goes without
    // them while the cached `isWatching` still says true — so the write moves
    // the flag with the row.
    seedWatchers([watcher(ANNA)], 1, 0);
    holdWatcherWrites(true);
    renderBoard(ISSUE_PATH);

    const panel = await section();
    fireEvent.click(await panel.findByRole("button", { name: "Watching" }));
    expect(await panel.findByRole("button", { name: "Watch" })).toBeVisible();
    expect(panel.queryByText(/could not be loaded/i)).toBeNull();
    releaseWatcherWrites();
  });

  it("says the watchers did not come with the issue, and offers no toggle over a state nobody knows", async () => {
    failWatchersRead(Object.assign(new Error("Issue not found"), { status: 404, code: "NOT_FOUND" }));
    renderBoard(ISSUE_PATH);

    const panel = await section();
    expect(await panel.findByText(/watchers could not be loaded with this issue/i)).toBeVisible();
    expect(panel.queryByText("No one is watching this issue yet")).toBeNull();
    // "Watch" and "Watching" are each a claim about the reader's own state, and
    // neither is supported by a read that failed.
    expect(panel.queryByRole("button", { name: /^Watch/ })).toBeNull();
  });

  /**
   * The four cases below are about the window between a press and its answer.
   * Everything in this section that is deliberate about that window — the row
   * that keeps its place, the guard on the toggle, the optimistic row that must
   * not appear twice — was, until these, held by nothing: each could be deleted
   * and the suite stayed green (release-reviewer F1–F5, TAS-193).
   */
  it("keeps a row in place while its own removal is in flight, so a double press cannot take the next one", async () => {
    seedMembers([member(SOFIA, "Sofia Reyes"), member("user-tom", "Tom Becker")]);
    seedWatchers([watcher(SOFIA), watcher("user-tom"), watcher(ANNA)], 3, 2);
    holdWatcherWrites(true);
    renderBoard(ISSUE_PATH);

    const panel = await section();
    const sofia = await panel.findByRole("button", { name: "Remove Sofia Reyes from watchers" });
    fireEvent.click(sofia);

    // The row is still on screen, and this is the whole fix: filtering it out
    // here reflowed the list inside a frame and put Tom's ✕ under the cursor in
    // time for the second click of an ordinary double-click.
    await waitFor(() => expect(sofia).toHaveAttribute("aria-disabled", "true"));
    expect(sofia).toBeVisible();
    expect(sofia.closest("li")).toHaveClass("watcher-row", "is-pending");

    // The second click, on the button that is still where it was. Inert, and
    // inert by the handler rather than by `disabled` — the attribute states it,
    // the guard enforces it.
    fireEvent.click(sofia);
    expect(sofia).not.toBeDisabled();

    releaseWatcherWrites();
    await waitFor(() => expect(panel.queryByRole("button", { name: /^Remove Sofia/ })).toBeNull());
    expect(watcherCalls().remove).toEqual([SOFIA]);
    expect(watchedUserIds()).toEqual(["user-tom", ANNA]);
    // And nothing was said about a person nobody pressed anything about.
    expect(panel.queryByText(/Tom Becker/)).toBeVisible();
  });

  it("hands focus to the next row when the one holding it is removed", async () => {
    seedMembers([member(SOFIA, "Sofia Reyes"), member("user-tom", "Tom Becker")]);
    seedWatchers([watcher(SOFIA), watcher("user-tom")], 2, 1);
    renderBoard(ISSUE_PATH);

    const panel = await section();
    const sofia = await panel.findByRole("button", { name: "Remove Sofia Reyes from watchers" });
    // Focused first, because the handoff is armed only when focus is resting on
    // the control that is about to unmount — a settling write is no licence to
    // move focus across the panel.
    sofia.focus();
    fireEvent.click(sofia);

    await waitFor(() => expect(panel.queryByRole("button", { name: /^Remove Sofia/ })).toBeNull());
    // Not `<body>`, which is where it lands with no handoff: an ADMIN pruning
    // five rows would tab in from the top of the document five times.
    expect(document.activeElement).toBe(panel.getByRole("button", { name: "Remove Tom Becker from watchers" }));
  });

  it("hands focus to the heading when the row that had it was the last one", async () => {
    seedMembers([member(SOFIA, "Sofia Reyes")]);
    seedWatchers([watcher(SOFIA)], 1, 0);
    renderBoard(ISSUE_PATH);

    const panel = await section();
    const sofia = await panel.findByRole("button", { name: "Remove Sofia Reyes from watchers" });
    sofia.focus();
    fireEvent.click(sofia);

    await waitFor(() => expect(panel.getByText(/No one is watching this issue yet/)).toBeVisible());
    // The heading rather than the toggle beside it: the toggle answers Enter
    // with a subscription, and the reader who has just pressed ✕ is the reader
    // who would press it again.
    expect(document.activeElement).toBe(panel.getByRole("heading", { name: /Watchers/ }));
  });

  it("refuses a second toggle press while the first write is still out", async () => {
    seedWatchers([], 0, 1);
    holdWatcherWrites(true);
    renderBoard(ISSUE_PATH);

    const panel = await section();
    const toggle = await panel.findByRole("button", { name: "Watch" });
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-disabled", "true"));

    // `aria-disabled` states the window; it does not enforce it, and that is the
    // point of it (a real `disabled` would take the focus with it). So the
    // second press reaches the handler, where `if (toggling) return;` is the
    // only thing standing between a `PUT` and a `DELETE` racing to decide the
    // subscription — the label has already flipped to "Watching", so without the
    // guard this press unsubscribes what the first one has not finished
    // subscribing.
    fireEvent.click(toggle);
    releaseWatcherWrites();

    await waitFor(() => expect(toggle).not.toHaveAttribute("aria-disabled"));
    expect(watcherCalls()).toMatchObject({ watch: 1, unwatch: 0 });
  });

  it("draws no pill for a count nobody has stated, and no write invents the first one", async () => {
    // The issue read states no count, and the optimistic add must not start
    // one from nothing.
    seedWatchers([watcher(SOFIA)], null);
    renderBoard(ISSUE_PATH);

    const panel = await section();
    const toggle = await panel.findByRole("button", { name: "Watch" });
    expect(document.querySelector(".issue-watchers .count-pill")).toBeNull();

    // Held from here, so the pill below cannot have come from a refetch.
    holdWatchersRead(true);
    fireEvent.click(toggle);

    await panel.findByRole("button", { name: "Watching" });
    // The optimistic add counts from a number nobody has stated, which is not a
    // thing that can be counted from: `(totalCount ?? 0) + 1` would put a 1 here.
    expect(document.querySelector(".issue-watchers .count-pill")).toBeNull();
  });


  it("puts one row on screen when two presses land in one task", async () => {
    seedMembers([member(ANNA, "Anna Ivanova")]);
    seedWatchers([], 0, 1);
    holdWatcherWrites(true);
    renderBoard(ISSUE_PATH);

    const panel = await section();
    const toggle = await panel.findByRole("button", { name: "Watch" });
    // Nothing awaited between the two: this is the *same task*, which is the one
    // place the toggle's own `if (toggling) return;` cannot help — react-query
    // publishes `isPending` in a microtask, so both presses read it as `false`
    // and both dispatch. Measured: `watchIssue` is called twice. That much is
    // harmless (`PUT …/watchers/me` has no "was it new" flag and a second call
    // is indistinguishable from the first), and the dangerous pairing — a `PUT`
    // and a `DELETE` racing — cannot happen here, because the second press only
    // becomes an unwatch once the label has flipped, which takes the render that
    // publishes the flag.
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    releaseWatcherWrites();

    await waitFor(() => expect(toggle).not.toHaveAttribute("aria-disabled"));
    expect(watcherCalls().watch).toBe(2);
    // What must not double is the *list*. Both dispatches run `addOptimistically`
    // for the same person, and without its membership guard that is two rows
    // sharing one React key — "Encountered two children with the same key" —
    // and a count that has counted one subscription twice.
    expect(document.querySelectorAll(".issue-watchers .watcher-row")).toHaveLength(1);
    expect(panel.getAllByText(/Anna Ivanova/)).toHaveLength(1);
  });

  it("names a row it cannot put a name to by a short id rather than a whole uuid", async () => {
    const unnamed = "fdf35fa6-e68b-4dbe-8a48-5867d7f08ce9";
    seedWatchers([watcher(unnamed)], 1);
    renderBoard(ISSUE_PATH);

    const panel = await section();
    // Two unnamed rows still differ, and a reader is not read thirty-six
    // characters one at a time to hear it (§5.8's own abbreviation).
    expect(await panel.findByRole("button", { name: "Remove watcher fdf35fa6" })).toBeVisible();
    expect(panel.queryByRole("button", { name: `Remove watcher ${unnamed}` })).toBeNull();
  });
});

/**
 * TAS-242, and TAS-246 on top of it. The sections mount under the panel's
 * `if (!issue)` guard, so a read a section started for itself waited for the
 * issue: two rounds. TAS-242 started the five section reads beside the issue
 * read; TAS-246 removed four of them, because backend TAS-214 put labels,
 * watchers, links and attachments on the issue read itself. What is left is
 * the shape these tests pin: **two requests, in one round** — the issue and its
 * comments — and nothing a section asks for on its own.
 */
describe("the issue panel before its issue has answered", () => {
  const ISSUE_PATH = `/projects/${PROJECT_ID}/issues/issue-1`;
  /** The panel's whole request budget: the issue read and the comments read, once each, and no section list read. */
  const twoReads = { watchers: 0, labels: 0, links: 0, attachments: 0, comments: 1, issue: 1 };
  const sectionLoadingLine = /^Loading (watchers|labels|links|attachments|comments)$/;

  beforeEach(() => {
    reset();
    window.localStorage.clear();
  });

  it("opens with two requests — the issue and its comments — both out before the issue answers", async () => {
    holdIssue(true);
    renderBoard(ISSUE_PATH);

    // The issue has been asked and has not answered — and the comments read is
    // already out beside it. No section has asked for a list of its own.
    await waitFor(() => expect(heldIssueCount()).toBe(1));
    expect(sectionReads()).toEqual(twoReads);

    releaseIssue();
    const panel = await screen.findByRole("dialog", { name: "TAS-102 issue" });
    // Every section drew its answer out of the one read.
    expect(await within(panel).findByText("No comments yet")).toBeVisible();
    expect(within(panel).getByText("No one is watching this issue yet")).toBeVisible();
    expect(within(panel).getByText("No labels yet")).toBeVisible();
    expect(within(panel).getByText("No links yet")).toBeVisible();
    expect(within(panel).getByText("No attachments yet")).toBeVisible();
    expect(within(panel).queryByText(sectionLoadingLine)).toBeNull();
    expect(sectionReads()).toEqual(twoReads);
  });

  it("names the reporter from the issue read, and falls back for a name the server left blank", async () => {
    seedSummaries({ "user-anna": "Anna from the issue read" });
    renderBoard(ISSUE_PATH);
    const panel = await screen.findByRole("dialog", { name: "TAS-102 issue" });
    // No member list was seeded, so this name can only have come from the read.
    expect(await within(panel).findByText("Anna from the issue read")).toBeVisible();
  });

  it("draws a blank name from the server as the panel draws anybody it cannot name", async () => {
    // `""` is what the gateway answers when auth-service is down. Not a name:
    // the member list is asked instead, and without it the word is "Unknown".
    seedSummaries({ "user-anna": "" });
    renderBoard(ISSUE_PATH);
    const panel = await screen.findByRole("dialog", { name: "TAS-102 issue" });
    const reporterLine = (await within(panel).findByText("Reporter")).nextElementSibling as HTMLElement;
    expect(within(reporterLine).getByText("Unknown")).toBeVisible();
  });

  it("falls back to the member list for a blank name it can resolve there", async () => {
    seedSummaries({ "user-anna": "" });
    seedMembers([
      {
        userId: "user-anna",
        role: "ADMIN",
        addedAt: "2026-08-01T09:00:00Z",
        addedBy: "user-anna",
        user: { displayName: "Anna Ivanova", email: "anna@example.com" },
      },
    ]);
    renderBoard(ISSUE_PATH);
    const panel = await screen.findByRole("dialog", { name: "TAS-102 issue" });
    const reporterLine = (await within(panel).findByText("Reporter")).nextElementSibling as HTMLElement;
    expect(await within(reporterLine).findByText("Anna Ivanova")).toBeVisible();
  });

  it("draws the panel's skeleton in place of a line of text, and says it is loading in words", async () => {
    holdIssue(true);
    renderBoard(ISSUE_PATH);

    // Named by its key from the first frame the board knows it (TAS-380,
    // art-director's B1): Close takes focus while the panel loads, so this is
    // the name a screen reader announces, and a rename later is not announced.
    const pending = await screen.findByRole("dialog", { name: "TAS-102 issue" });
    expect(pending).toHaveAttribute("aria-busy", "true");
    // The words are for a screen reader; the eye gets the skeleton.
    const status = within(pending).getByRole("status");
    expect(status).toHaveTextContent("Loading issue");
    expect(status).toHaveClass("visually-hidden");
    // The old line — plain text as the panel's only content — is gone.
    expect(document.querySelector(".panel-loading")).toBeNull();
    // Shaped like the panel: the head's bars beside a real Close, and the
    // body, both hidden from assistive technology and drawn from the
    // pending-value bars §5.6's pulse lives on.
    const shapes = pending.querySelectorAll(".is-skeleton");
    expect(shapes).toHaveLength(2);
    shapes.forEach((shape) => expect(shape).toHaveAttribute("aria-hidden", "true"));
    expect(pending.querySelector(".issue-panel-head .is-skeleton .value-skeleton")).not.toBeNull();
    expect(pending.querySelector(".issue-panel-body.is-skeleton .meta-grid .value-skeleton")).not.toBeNull();
    // Close exists while loading (TAS-380), and it is where focus starts.
    const close = within(pending).getByRole("button", { name: "Close" });
    expect(close).toHaveFocus();

    releaseIssue();
    const loaded = await screen.findByRole("dialog", { name: "TAS-102 issue" });
    await waitFor(() => expect(loaded).not.toHaveAttribute("aria-busy"));
    // The same element, not a new one: the panel slides in once (§4.10), not
    // again when its issue lands — and Close is the same node, still focused.
    expect(loaded).toBe(pending);
    expect(within(loaded).getByRole("button", { name: "Close" })).toBe(close);
    expect(close).toHaveFocus();
    expect(loaded).not.toHaveAttribute("aria-busy");
    expect(loaded.querySelector(".is-skeleton")).toBeNull();
  });

  it("states a failed issue read with the server's words and its request id, and no skeleton left standing", async () => {
    // The panel's one read is the whole panel since TAS-246, so its failure is
    // stated as a screen's is: a sentence, then the server's words and the id
    // that finds it in the gateway log, outside the live region.
    failIssue(Object.assign(new Error("Issue not found"), { status: 404, code: "NOT_FOUND", requestId: "req-panel" }));
    renderBoard(ISSUE_PATH);

    const sentence = await screen.findByRole("alert");
    expect(sentence).toHaveTextContent("This issue could not be opened.");
    const message = screen.getByText("Issue not found");
    expect(message.closest(".api-notice-detail")).not.toBeNull();
    const copy = screen.getByRole("button", { name: /Copy request id req-panel/ });
    expect(sentence.contains(copy)).toBe(false);
    const panel = message.closest('[role="dialog"]');
    expect(panel).not.toHaveAttribute("aria-busy");
    expect(panel?.querySelector(".is-skeleton")).toBeNull();
    expect(screen.queryByRole("status", { name: "Loading issue" })).toBeNull();
  });

  /**
   * One case per part the issue read can come back without. issue-service
   * leaves a part unset when its own source fails (`fetchWithFallback`), and
   * the section has to say so in its own place — not as the panel's failure,
   * and not as "none". Each row's `otherEmptyTexts` is the other sections' own
   * empty state, so a case fails both when its section stops saying it and when
   * a neighbour's answer gets swallowed by it.
   */
  const missingPartCases: {
    name: "watchers" | "labels" | "links" | "attachments";
    drop: (error: Error) => void;
    otherEmptyTexts: string[];
  }[] = [
    {
      name: "watchers",
      drop: failWatchersRead,
      otherEmptyTexts: ["No comments yet", "No labels yet", "No links yet", "No attachments yet"],
    },
    {
      name: "labels",
      drop: failLabelsRead,
      otherEmptyTexts: ["No one is watching this issue yet", "No comments yet", "No links yet", "No attachments yet"],
    },
    {
      name: "links",
      drop: failLinksRead,
      otherEmptyTexts: ["No one is watching this issue yet", "No comments yet", "No labels yet", "No attachments yet"],
    },
    {
      name: "attachments",
      drop: failAttachmentsRead,
      otherEmptyTexts: ["No one is watching this issue yet", "No comments yet", "No labels yet", "No links yet"],
    },
  ];

  it.each(missingPartCases)(
    "says the $name did not come with the issue, inside that section and nowhere else",
    async ({ name, drop, otherEmptyTexts }) => {
      drop(new Error("not sent"));
      renderBoard(ISSUE_PATH);

      const panel = await screen.findByRole("dialog", { name: "TAS-102 issue" });
      const line = await within(panel).findByText(`The ${name} could not be loaded with this issue. Reopen it to try again.`);
      expect(line).toBeVisible();
      // One recipe in all four sections (art-director, TAS-246): the empty
      // line's slot, set apart by `is-unavailable`, and no live region — a
      // state of the section, not a refusal of anything the reader did. The
      // error boxes stay for write refusals and are not used for this.
      expect(line).toHaveClass("issue-links-empty", "is-unavailable");
      expect(line.closest("[aria-live], [role='alert'], [role='status']")).toBeNull();
      expect(panel.querySelector(".watcher-note.is-error, .attachment-note.is-error")).toBeNull();
      otherEmptyTexts.forEach((text) => expect(within(panel).getByText(text)).toBeVisible());
      expect(panel.querySelector(".panel-loading")).toBeNull();
      expect(sectionReads()).toEqual(twoReads);
    },
  );

  it("keeps a comments read that failed first inside its section, and does not send it twice", async () => {
    holdIssue(true);
    failCommentsRead(Object.assign(new Error("Comments are unavailable"), { status: 404, code: "NOT_FOUND" }));
    const queryClient = renderBoard(ISSUE_PATH);

    // The comments' answer is in — a failure — while the panel is still waiting
    // on the issue. The panel keeps waiting: it is not the panel's failure.
    await waitFor(() => expect(queryClient.getQueryState(["comments", PROJECT_ID, "issue-1"])?.status).toBe("error"));
    expect(await screen.findByRole("dialog", { name: "TAS-102 issue" })).toHaveAttribute("aria-busy", "true");

    releaseIssue();
    const panel = await screen.findByRole("dialog", { name: "TAS-102 issue" });
    expect(await within(panel).findByText("Comments are unavailable")).toBeVisible();
    ["No one is watching this issue yet", "No labels yet", "No links yet", "No attachments yet"].forEach((text) =>
      expect(within(panel).getByText(text)).toBeVisible(),
    );
    // react-query re-asks an errored read for every observer that mounts on
    // it; the panel's own ask was the one this section was owed.
    expect(sectionReads()).toEqual(twoReads);
  });

  it("asks again when the panel is reopened after a part did not come", async () => {
    failWatchersRead(new Error("not sent"));
    renderBoard(ISSUE_PATH);
    const first = await screen.findByRole("dialog", { name: "TAS-102 issue" });
    expect(await within(first).findByText(/watchers could not be loaded/)).toBeVisible();

    fireEvent.click(within(first).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "TAS-102 issue" })).toBeNull());

    // The server recovers; reopening is how a reader asks again.
    failWatchersRead(undefined);
    fireEvent.click(await screen.findByRole("button", { name: /TAS-102/ }));
    const second = await screen.findByRole("dialog", { name: "TAS-102 issue" });
    expect(await within(second).findByText("No one is watching this issue yet")).toBeVisible();
    expect(within(second).queryByText(/watchers could not be loaded/)).toBeNull();
    expect(sectionReads().issue).toBe(2);
    expect(sectionReads().watchers).toBe(0);
  });
});

/**
 * TAS-246: what the panel draws from names and targets the issue read carries
 * itself (backend TAS-214), where it used to resolve every one of them against
 * the member list and the project's issue page.
 */
describe("people and link targets from the issue read", () => {
  const ISSUE_PATH = `/projects/${PROJECT_ID}/issues/issue-1`;

  beforeEach(() => {
    reset();
    window.localStorage.clear();
  });

  it("names a watcher by its own row, with no member list behind it", async () => {
    seedWatchers(
      [{ id: "w-1", issueId: "issue-1", projectId: PROJECT_ID, userId: "user-zoe", createdAt: "2026-09-02T10:15:00Z", createdBy: "user-zoe" }],
      1,
    );
    seedWatcherNames({ "user-zoe": "Zoe Park" });
    renderBoard(ISSUE_PATH);

    const panel = await screen.findByRole("dialog", { name: "TAS-102 issue" });
    expect(await within(panel).findByText("Zoe Park")).toBeVisible();
  });

  it("draws a watcher row the server left unnamed as Unknown, not as a blank", async () => {
    seedWatchers(
      [{ id: "w-1", issueId: "issue-1", projectId: PROJECT_ID, userId: "user-gone", createdAt: "2026-09-02T10:15:00Z", createdBy: "user-anna" }],
      1,
    );
    seedWatcherNames({ "user-gone": "" });
    renderBoard(ISSUE_PATH);

    const panel = await screen.findByRole("dialog", { name: "TAS-102 issue" });
    const list = (await within(panel).findByRole("heading", { name: /watchers/i })).closest("section") as HTMLElement;
    expect(await within(list).findByText("Unknown")).toBeVisible();
  });

  it("names an attachment's uploader from the read", async () => {
    seedAttachments([
      {
        id: "attachment-1",
        issueId: "issue-1",
        fileName: "trace.txt",
        contentType: "text/plain",
        sizeBytes: 2048,
        uploadedBy: "user-zoe",
        checksum: null,
        createdAt: "2026-09-01T09:10:00Z",
      },
    ]);
    seedSummaries({ "user-zoe": "Zoe Park" });
    renderBoard(ISSUE_PATH);

    const panel = await screen.findByRole("dialog", { name: "TAS-102 issue" });
    expect(await within(panel).findByText(/Zoe Park/)).toBeVisible();
  });

  it("draws a link's other end from the server's target and opens it in the target's own project", async () => {
    seedLinks([
      {
        id: "link-1",
        projectId: PROJECT_ID,
        sourceIssueId: "issue-1",
        targetIssueId: "issue-far",
        viewLinkType: "BLOCKS",
        createdBy: "user-anna",
        createdAt: "2026-09-01T09:10:00Z",
        target: { id: "issue-far", issueKey: "WEB-9", summary: "In another project", projectId: OTHER_PROJECT_ID, statusKey: "TODO" },
      },
    ]);
    renderBoard(ISSUE_PATH);

    const panel = await screen.findByRole("dialog", { name: "TAS-102 issue" });
    // The row itself, not its remove control ("Remove link to WEB-9").
    const row = (await within(panel).findAllByRole("button", { name: /WEB-9/ })).find((button) =>
      button.classList.contains("issue-link-open"),
    ) as HTMLElement;
    expect(row).toHaveTextContent("In another project");

    fireEvent.click(row);

    await waitFor(() =>
      expect(screen.getByTestId("whereabouts")).toHaveTextContent(`/projects/${OTHER_PROJECT_ID}/issues/issue-far`),
    );
  });

  // Backend #201: a row names its relation from `linkViewTypes`, whose codes
  // include the inverses, and never from `linkTypes` — where an inverse is not
  // listed and its outward relation's name is the nearest thing to borrow.
  it("names a relation from /meta's view types, and never lends an inverse the outward name", async () => {
    const link = (id: string, viewLinkType: string, issueKey: string) => ({
      id,
      projectId: PROJECT_ID,
      sourceIssueId: "issue-1",
      targetIssueId: `issue-${id}`,
      viewLinkType,
      createdBy: "user-anna",
      createdAt: "2026-09-01T09:10:00Z",
      target: { id: `issue-${id}`, issueKey, summary: "Elsewhere", projectId: PROJECT_ID, statusKey: "TODO" },
    });
    seedLinks([link("a", "SUPERSEDES", "TAS-301"), link("b", "IS_SUPERSEDED_BY", "TAS-302")]);
    seedMeta({
      issueTypes: null,
      priorities: null,
      linkTypes: [{ code: "SUPERSEDES", name: "Supersedes (request)", selectable: true }],
      linkViewTypes: [{ code: "SUPERSEDES", name: "Supersedes", selectable: true }],
      notificationTypes: null,
      userStatuses: null,
    });
    renderBoard(ISSUE_PATH);

    const panel = await screen.findByRole("dialog", { name: "TAS-102 issue" });
    const rowFor = async (key: string) =>
      (await within(panel).findAllByRole("button", { name: new RegExp(key) })).find((button) =>
        button.classList.contains("issue-link-open"),
      ) as HTMLElement;
    expect((await rowFor("TAS-301")).querySelector(".issue-link-relation")).toHaveTextContent(/^Supersedes$/);
    // Not listed as a view type: printed as the code, not as "Supersedes (request)".
    expect((await rowFor("TAS-302")).querySelector(".issue-link-relation")).toHaveTextContent(/^IS_SUPERSEDED_BY$/);
  });
});

/**
 * TAS-248: Share sits in the loaded panel's head beside Delete and Close. It
 * only reads, so it is not gated by role — a VIEWER, who has no Delete since
 * TAS-236, gets it live — and it needs the issue's key, so the skeleton's head
 * has none. The popover itself is pinned in `src/components/IssueShare.test.tsx`.
 */
describe("sharing an issue from its panel", () => {
  const ISSUE_PATH = `/projects/${PROJECT_ID}/issues/issue-1`;

  beforeEach(() => {
    reset();
    window.localStorage.clear();
  });

  it("offers a VIEWER the share links, with no Delete beside them", async () => {
    setMembership("VIEWER");
    renderBoard(ISSUE_PATH);
    const panel = within(await screen.findByRole("dialog", { name: "TAS-102 issue" }));

    const share = panel.getByRole("button", { name: "Share issue TAS-102" });
    await waitFor(() => expect(panel.queryByRole("button", { name: /^Delete issue/ })).not.toBeInTheDocument());
    expect(share).toBeEnabled();
    // In the head, before Close — and Delete, for a reader who has one.
    const head = share.closest(".issue-panel-head") as HTMLElement;
    expect(within(head).getAllByRole("button").map((button) => button.getAttribute("title"))).toEqual([
      "Share",
      "Close",
    ]);

    fireEvent.click(share);
    const dialog = panel.getByRole("dialog", { name: "Share TAS-102" });
    const valueOf = (name: string) => (within(dialog).getByRole("textbox", { name }) as HTMLInputElement).value;
    expect(valueOf("Short link")).toMatch(/\/browse\/TAS-102$/);
    // The issue's own ids, from the issue read.
    expect(valueOf("Full link")).toMatch(new RegExp(`/projects/${PROJECT_ID}/issues/issue-1$`));
  });

  it("has nothing to share while the issue has not answered", async () => {
    holdIssue(true);
    renderBoard(ISSUE_PATH);

    const pending = await screen.findByRole("dialog", { name: "TAS-102 issue" });
    expect(pending).toHaveAttribute("aria-busy", "true");
    expect(within(pending).queryByRole("button", { name: /^Share/ })).toBeNull();

    releaseIssue();
    const loaded = await screen.findByRole("dialog", { name: "TAS-102 issue" });
    expect(await within(loaded).findByRole("button", { name: "Share issue TAS-102" })).toBeVisible();
  });
});

/**
 * The activity feed folds away from its own heading (TAS-257), and the choice
 * belongs to the reader rather than to an issue: one key in the browser, the
 * way the theme is kept, so it holds across a remount until it is undone.
 */
describe("the activity feed's disclosure", () => {
  const ISSUE_PATH = `/projects/${PROJECT_ID}/issues/issue-1`;
  const STORAGE_KEY = "taska.activityCollapsed";

  const openPanel = async () => within(await screen.findByRole("dialog", { name: "TAS-102 issue" }));
  const toggleIn = (panel: ReturnType<typeof within>) => panel.findByRole("button", { name: /^Activity/ });
  const items = () => [...document.querySelectorAll(".activity .activity-item")];

  /** Storage spies a test installs, restored even when an assertion fails first. */
  let spies: MockInstance[] = [];

  beforeEach(() => {
    reset();
    window.localStorage.clear();
    // Oldest first, as the server sends it; the feed draws it newest first.
    seedHistory([
      { id: "history-1", issueId: "issue-1", eventType: "CREATED", actorUserId: "user-anna", occurredAt: "2026-08-01T09:00:00Z", payload: {} },
      {
        id: "history-2",
        issueId: "issue-1",
        eventType: "TRANSITIONED",
        actorUserId: "user-anna",
        occurredAt: "2026-08-01T10:00:00Z",
        payload: { from: "TODO", to: "IN_PROGRESS" },
      },
    ]);
  });

  afterEach(() => {
    spies.forEach((spy) => spy.mockRestore());
    spies = [];
    window.localStorage.clear();
  });

  it("folds the feed from its heading and keeps it folded across a remount until it is opened again", async () => {
    renderBoard(ISSUE_PATH);
    const toggle = await toggleIn(await openPanel());

    // Expanded by default, newest first, and the heading names the count.
    expect(toggle.closest("h3")).not.toBeNull();
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(within(toggle).getByText("2")).toHaveClass("count-pill");
    expect(items()).toHaveLength(2);
    expect(items()[0]).toHaveTextContent(/moved/);
    expect(items()[1]).toHaveTextContent(/created this issue/);
    const list = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
    expect(list).not.toBeNull();
    expect(list).toContainElement(items()[0] as HTMLElement);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();

    fireEvent.click(toggle);

    // Folded: the feed is gone, not hidden; the heading and its count stay.
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).not.toHaveAttribute("aria-controls");
    expect(items()).toHaveLength(0);
    expect(document.querySelector(".activity-list")).toBeNull();
    expect(within(toggle).getByText("2")).toHaveClass("count-pill");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("1");

    // A fresh mount — another issue opened, or the page reloaded — starts folded.
    cleanup();
    renderBoard(ISSUE_PATH);
    const again = await toggleIn(await openPanel());
    expect(again).toHaveAttribute("aria-expanded", "false");
    expect(items()).toHaveLength(0);

    fireEvent.click(again);

    expect(again).toHaveAttribute("aria-expanded", "true");
    expect(items()).toHaveLength(2);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("still folds and opens when the browser refuses storage, and opens expanded", async () => {
    const refuse = () => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    };
    spies = [
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(refuse),
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(refuse),
      vi.spyOn(Storage.prototype, "removeItem").mockImplementation(refuse),
    ];
    // React reports an error thrown in a click handler to the window rather
    // than to the test, after the state it set has already landed — so the
    // toggle alone would look right with the write unguarded. This is what
    // would see it.
    const reported: unknown[] = [];
    const onError = (event: ErrorEvent) => {
      reported.push(event.error);
      event.preventDefault();
    };
    window.addEventListener("error", onError);
    try {
      renderBoard(ISSUE_PATH);
      const toggle = await toggleIn(await openPanel());
      expect(toggle).toHaveAttribute("aria-expanded", "true");

      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(items()).toHaveLength(0);

      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute("aria-expanded", "true");
      expect(items()).toHaveLength(2);
      expect(reported).toEqual([]);
    } finally {
      window.removeEventListener("error", onError);
    }
  });

  it("says so when the issue has no history, without a count, and folds that line away too", async () => {
    seedHistory([]);
    renderBoard(ISSUE_PATH);
    const panel = await openPanel();
    const toggle = await toggleIn(panel);

    expect(toggle.querySelector(".count-pill")).toBeNull();
    expect(items()).toHaveLength(0);
    const line = panel.getByText("No activity yet");
    expect(line).toBeVisible();
    expect(document.getElementById(toggle.getAttribute("aria-controls") ?? "")).toContainElement(line);

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(panel.queryByText("No activity yet")).toBeNull();
  });
});

/**
 * The issue panel is a dialog (TAS-380, art-director's ruling 7, DESIGN.md
 * §4.10): `role="dialog"` with `aria-modal` in both placements, first focus on
 * Close, Tab held inside, focus handed back on the way out, and Esc closing
 * exactly one thing — the innermost. It used to be an `aside`: focus stayed on
 * the card behind the scrim and Esc did nothing.
 */
describe("the issue panel as a dialog", () => {
  const ISSUE_PATH = `/projects/${PROJECT_ID}/issues/issue-1`;
  /** The panel once its issue has answered: it carries the key's name while it loads, too. */
  const panel = async () => {
    const dialog = await screen.findByRole("dialog", { name: "TAS-102 issue" });
    await waitFor(() => expect(dialog).not.toHaveAttribute("aria-busy"));
    return dialog;
  };
  const card = () => document.querySelector<HTMLElement>('.issue-card[data-issue-id="issue-1"]')!;
  const where = () => screen.getByTestId("whereabouts");
  /** Esc as a browser sends it: on what has focus, bubbling to `window`. */
  const pressEscape = (init: KeyboardEventInit = {}) =>
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape", ...init });

  /** Opens TAS-102 from its card, the way a keyboard reader does. */
  const openFromCard = async () => {
    renderBoard();
    await waitFor(() => expect(card()).not.toBeNull());
    card().focus();
    fireEvent.click(card());
    return panel();
  };

  beforeEach(() => {
    reset();
    window.localStorage.clear();
  });

  it("is a modal dialog named by its key, with focus on Close from the first frame", async () => {
    const dialog = await openFromCard();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog.tagName).not.toBe("ASIDE");
    const close = within(dialog).getByRole("button", { name: "Close" });
    expect(close).toHaveFocus();
    // The scrim is a way out for the pointer, not a Tab stop.
    expect(screen.getByRole("button", { name: "Close issue" })).toHaveAttribute("tabindex", "-1");
  });

  it("wraps Tab and Shift+Tab inside the panel", async () => {
    const dialog = await openFromCard();
    await within(dialog).findByText("No comments yet");
    // The trap's own idea of a stop — the one `Modal` uses too.
    const stops = tabbables(dialog);
    expect(stops[0]).toBe(within(dialog).getByRole("button", { name: "Share issue TAS-102" }));
    const first = stops[0];
    const last = stops[stops.length - 1];

    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
  });

  it.each([
    ["Close", () => fireEvent.click(within(screen.getByRole("dialog", { name: "TAS-102 issue" })).getByRole("button", { name: "Close" }))],
    ["Esc", () => pressEscape()],
    ["the scrim", () => fireEvent.click(screen.getByRole("button", { name: "Close issue" }))],
  ])("hands focus back to the card that opened it, on %s", async (_way, close) => {
    await openFromCard();
    close();
    await waitFor(() => expect(where()).toHaveTextContent(`/projects/${PROJECT_ID}/board`));
    expect(screen.queryByRole("dialog", { name: "TAS-102 issue" })).not.toBeInTheDocument();
    expect(card()).toHaveFocus();
  });

  it("falls back to the issue's card when nothing on the board opened it", async () => {
    renderBoard(ISSUE_PATH);
    await panel();
    // Opened from the address: focus was on <body>, so there is no opener.
    pressEscape();
    await waitFor(() => expect(where()).toHaveTextContent(`/projects/${PROJECT_ID}/board`));
    expect(card()).toHaveFocus();
  });

  it("falls back to the board's back button when the card is not on the board either", async () => {
    renderBoard(ISSUE_PATH);
    const dialog = await panel();
    // TAS-102 is a task; with only bugs on the board its card is gone.
    fireEvent.click(screen.getByRole("button", { name: "Bug" }));
    await waitFor(() => expect(card()).toBeNull());
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(where()).toHaveTextContent(`/projects/${PROJECT_ID}/board`));
    expect(screen.getByRole("button", { name: "Back to projects" })).toHaveFocus();
  });

  describe("Esc closes one thing, the innermost", () => {
    it("closes Share first, with focus back on Share and the panel open", async () => {
      const dialog = await openFromCard();
      const share = within(dialog).getByRole("button", { name: "Share issue TAS-102" });
      fireEvent.click(share);
      within(screen.getByRole("dialog", { name: "Share TAS-102" })).getAllByRole("button")[0].focus();

      pressEscape();

      expect(screen.queryByRole("dialog", { name: "Share TAS-102" })).not.toBeInTheDocument();
      expect(share).toHaveFocus();
      expect(where()).toHaveTextContent(`/projects/${PROJECT_ID}/issues/issue-1`);
    });

    it("closes the delete question next, from anywhere in the panel, with focus on Delete", async () => {
      const dialog = await openFromCard();
      const remove = within(dialog).getByRole("button", { name: "Delete issue TAS-102" });
      fireEvent.click(remove);
      expect(document.querySelector(".issue-delete-zone")).not.toBeNull();
      // Focus moved into the body, away from the strip's own buttons.
      dialog.querySelector<HTMLTextAreaElement>(".summary-textarea")!.focus();

      pressEscape();

      expect(document.querySelector(".issue-delete-zone")).toBeNull();
      expect(remove).toHaveFocus();
      expect(where()).toHaveTextContent(`/projects/${PROJECT_ID}/issues/issue-1`);
    });

    it("keeps the panel, the text and the focus when the field has unsaved text", async () => {
      const dialog = await openFromCard();
      const summary = dialog.querySelector<HTMLTextAreaElement>(".summary-textarea")!;
      summary.focus();
      fireEvent.change(summary, { target: { value: "Wire the board to the gateway, and test it" } });

      pressEscape();

      expect(where()).toHaveTextContent(`/projects/${PROJECT_ID}/issues/issue-1`);
      expect(summary).toHaveValue("Wire the board to the gateway, and test it");
      expect(summary).toHaveFocus();
    });

    it.each([
      ["a comment being written", (dialog: HTMLElement) => within(dialog).getByPlaceholderText("Leave a comment")],
      ["a planning value", (dialog: HTMLElement) => within(dialog).getByLabelText("Story points")],
    ])("keeps them for %s too", async (_what, field) => {
      const dialog = await openFromCard();
      await within(dialog).findByText("No comments yet");
      const box = field(dialog) as HTMLInputElement;
      box.focus();
      fireEvent.change(box, { target: { value: "5" } });

      pressEscape();

      expect(where()).toHaveTextContent(`/projects/${PROJECT_ID}/issues/issue-1`);
      expect(box).toHaveValue("5");
      expect(box).toHaveFocus();
    });

    it("keeps them for a work log entry being typed, from any of its boxes", async () => {
      const dialog = await openFromCard();
      const form = await within(dialog).findByRole("form", { name: "Log work" });
      const spent = within(form).getByLabelText("Time spent");
      spent.focus();
      fireEvent.change(spent, { target: { value: "1h 30m" } });
      fireEvent.change(within(form).getByLabelText(/^Comment/), { target: { value: "Paired on the retry guard" } });

      pressEscape();
      expect(where()).toHaveTextContent(`/projects/${PROJECT_ID}/issues/issue-1`);
      expect(spent).toHaveValue("1h 30m");
      expect(spent).toHaveFocus();

      // The date box belongs to the same draft, though it is not text of its own.
      const date = within(form).getByLabelText("Date");
      date.focus();
      pressEscape();
      expect(where()).toHaveTextContent(`/projects/${PROJECT_ID}/issues/issue-1`);
      expect(within(form).getByLabelText(/^Comment/)).toHaveValue("Paired on the retry guard");
      expect(date).toHaveFocus();
    });

    it("closes the panel from an empty work log entry", async () => {
      const dialog = await openFromCard();
      const form = await within(dialog).findByRole("form", { name: "Log work" });
      within(form).getByLabelText("Time spent").focus();

      pressEscape();

      await waitFor(() => expect(where()).toHaveTextContent(`/projects/${PROJECT_ID}/board`));
    });

    it("closes the panel from a field whose text is the saved one", async () => {
      const dialog = await openFromCard();
      dialog.querySelector<HTMLTextAreaElement>(".summary-textarea")!.focus();

      pressEscape();

      await waitFor(() => expect(where()).toHaveTextContent(`/projects/${PROJECT_ID}/board`));
    });

    it("ignores Esc while an input method is composing", async () => {
      await openFromCard();

      pressEscape({ isComposing: true });

      expect(where()).toHaveTextContent(`/projects/${PROJECT_ID}/issues/issue-1`);
    });
  });
});

/**
 * TAS-382 on the board: the Workflows trigger in the bar for every role
 * (§4.28), and the panel's moves named by where they go (§4.1) — since
 * backend PR #208's migration 0001, a transition called "Close" sits in the
 * same panel as the panel's own Close.
 */
describe("the Workflows trigger and the panel's moves", () => {
  beforeEach(() => {
    reset();
    window.localStorage.clear();
  });

  for (const role of ["ADMIN", "MEMBER", "VIEWER", null] as const) {
    it(`puts Workflows in the bar for ${role ?? "a role nobody stated"}`, async () => {
      setMembership(role);
      renderBoard();
      const trigger = await screen.findByRole("button", { name: "Workflows" });
      expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
      expect(trigger).toHaveAttribute("title", "Workflows");
    });
  }

  it("opens the dialog, and closing it hands focus back to the trigger", async () => {
    setMembership("MEMBER");
    renderBoard();
    const trigger = await screen.findByRole("button", { name: "Workflows" });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Workflows" });
    expect(await within(dialog).findByText("This project has no issue types, so it runs on no workflow.")).toBeVisible();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Workflows" })).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("carries the project's full name in a title, for the phone bar that cuts it short", async () => {
    renderBoard();
    await waitFor(() => expect(document.querySelector(".board-project-name")).toHaveAttribute("title", "Taska Platform"));
  });

  it("names each move by its target unless its name already says it, inside a group named Status", async () => {
    setMembership("ADMIN");
    seedContextWorkflowParts({
      statuses: [
        { id: "s-todo", statusKey: "TODO", name: "To Do", category: "TODO", sortOrder: 10 },
        { id: "s-progress", statusKey: "IN_PROGRESS", name: "In Progress", category: "IN_PROGRESS", sortOrder: 20 },
        { id: "s-done", statusKey: "DONE", name: "Done", category: "DONE", sortOrder: 30 },
      ],
      transitions: [
        { id: "t-start", fromStatusId: "s-todo", toStatusId: "s-progress", name: "move to in progress", sortOrder: 10 },
        { id: "t-close", fromStatusId: "s-todo", toStatusId: "s-done", name: "Close", sortOrder: 50 },
      ],
    });
    renderBoard(`/projects/${PROJECT_ID}/issues/issue-1`);
    const panel = within(await screen.findByRole("dialog", { name: "TAS-102 issue" }));

    const group = await panel.findByRole("group", { name: "Status" });
    const close = within(group).getByRole("button", { name: "Close, move to Done" });
    expect(close).toHaveTextContent(/^Close$/);
    expect(close).not.toHaveAttribute("title");
    expect(within(group).getByRole("button", { name: "move to in progress" })).not.toHaveAttribute("aria-label");
    // The panel's own Close keeps its name and is the only control that has it.
    expect(panel.getAllByRole("button", { name: "Close" })).toHaveLength(1);
  });
});
