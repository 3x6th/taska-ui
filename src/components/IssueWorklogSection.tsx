import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { apiErrorFacts, isUndeployedRoute } from "../api/errors";
import type { AddIssueWorklogInput, UpdateIssueWorklogInput } from "../api/TaskaApi";
import { UNDEPLOYED_ROUTE_MESSAGE, WORKLOG_COMMENT_MAX_LENGTH } from "../api/TaskaApi";
import { taskaApi } from "../api/client";
import type { IssueWorklog, User } from "../domain/types";
import { personFor } from "../lib/people";
import { formatDuration } from "../lib/planning";
import {
  WORKLOG_DURATION_HINT,
  addInputOf,
  applyWorklogUpdate,
  draftOf,
  formatWorkDate,
  hasProblems,
  localDateOnly,
  sortWorklogs,
  totalSpentMinutes,
  updateInputOf,
  worklogDraftProblems,
  type WorklogDraft,
  type WorklogDraftField,
  type WorklogDraftProblems,
} from "../lib/worklog";
import { ApiNotice } from "./ApiNotice";
import { Avatar } from "./Avatar";
import { issueWorklogsKey, issueWorklogsOptions } from "./issueWorklogsQuery";
import { RequestId } from "./RequestId";

type Person = Pick<User, "id" | "displayName" | "color" | "avatarUrl">;

/** The id an optimistic entry carries until the server answers. No server row can have it. */
const optimisticWorklogPrefix = "tk-optimistic-worklog-";

/** The worklog writes of one issue, so the section can tell whether another is still in flight. */
const worklogMutationKey = (issueId: string) => ["worklog-write", issueId] as const;

const emptyDraft = (today: string): WorklogDraft => ({ duration: "", workDate: today, comment: "" });

/** The order the boxes are checked and focused in, which is the order they sit in. */
const draftFields: WorklogDraftField[] = ["duration", "workDate", "comment"];

interface WorklogNotice {
  text: string;
  requestId: string | null;
}

/**
 * The issue panel's work log (TAS-251, backend PR #178): who logged how much
 * time on which day, a total for the entries listed, and a form to log more.
 *
 * Gated as issue-service gates it (`issue.allowed-roles` at the PR head): every
 * member reads it; ADMIN and MEMBER log time and change their own entries; only
 * an ADMIN changes somebody else's. Hiding a control is presentation — the
 * server decides.
 *
 * **Every write moves the issue.** The server raises the issue's `version` and
 * moves its remaining estimate on each add, edit and delete, so a successful
 * write re-reads the issue before the panel's next edit leaves — otherwise that
 * edit's `If-Match` would carry the old version and come back a conflict
 * nobody caused. The writes join the panel's issue-write queue (`writeScope`)
 * for the same reason: an edit made while a worklog write is in flight waits
 * for the re-read and sends the version it brought.
 */
export function IssueWorklogSection({
  projectId,
  issueId,
  canLog,
  isProjectAdmin,
  currentUserId,
  userById,
  prefetched,
  writeScope,
}: {
  projectId: string;
  issueId: string;
  /** `add-worklog-roles` and `update-`/`delete-worklog-roles` for your own entries: ADMIN, MEMBER. */
  canLog: boolean;
  /** `manage-worklog-roles`: changing somebody else's entry, ADMIN only. */
  isProjectAdmin: boolean;
  currentUserId?: string;
  userById: Map<string, Person>;
  /** The panel started this read before the section mounted; whatever it answered is not asked again on mount. */
  prefetched: boolean;
  /** The panel's issue-write queue (see above). */
  writeScope: string;
}) {
  const queryClient = useQueryClient();
  const formId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const today = localDateOnly();

  const read = issueWorklogsOptions(projectId, issueId);
  const worklogsQuery = useQuery({ ...read, retryOnMount: !prefetched });
  const undeployed = worklogsQuery.isError && isUndeployedRoute(worklogsQuery.error, UNDEPLOYED_ROUTE_MESSAGE);
  const worklogs = useMemo(() => sortWorklogs(worklogsQuery.data ?? []), [worklogsQuery.data]);
  const total = totalSpentMinutes(worklogs);

  const [draft, setDraft] = useState<WorklogDraft>(() => emptyDraft(today));
  const [addAttempted, setAddAttempted] = useState(false);
  const [editing, setEditing] = useState<{ id: string; draft: WorklogDraft; attempted: boolean } | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<WorklogNotice | null>(null);

  /**
   * Where focus goes after the next render: back to a row's own Edit or Delete
   * button once its editor or its confirmation closes, or to the heading once
   * a deleted row has left with the button that removed it.
   */
  const pendingFocus = useRef<string | null>(null);
  const focusables = useRef(new Map<string, HTMLElement>());
  const registerFocusable = (key: string) => (node: HTMLElement | null) => {
    if (node) focusables.current.set(key, node);
    else focusables.current.delete(key);
  };
  useEffect(() => {
    const key = pendingFocus.current;
    if (!key) return;
    pendingFocus.current = null;
    (key === "heading" ? headingRef.current : focusables.current.get(key))?.focus();
  });

  const failed = (sentence: string, error: unknown) => {
    const { message, requestId } = apiErrorFacts(error);
    setNotice({ text: message ? `${sentence} ${message}` : sentence, requestId });
  };

  const setList = (update: (current: IssueWorklog[]) => IssueWorklog[]) =>
    queryClient.setQueryData<IssueWorklog[]>(issueWorklogsKey(projectId, issueId), (current) =>
      current ? update(current) : current,
    );

  /**
   * After a write: the issue (its version and remaining estimate moved) and the
   * board's page (which holds the same issue). Only the issue's own re-read is
   * awaited, so a queued edit leaves with the version it brought; the board's
   * page is invalidated without waiting. Then the list, but only once no other
   * worklog write of this issue is in flight — a re-read landing between two
   * optimistic writes would take the second one's row off the screen.
   */
  const settleIssue = () => {
    void queryClient.invalidateQueries({ queryKey: ["issues", projectId] });
    return queryClient.invalidateQueries({ queryKey: ["issue", projectId, issueId] });
  };
  const settleList = () => {
    if (queryClient.isMutating({ mutationKey: worklogMutationKey(issueId) }) > 1) return;
    void queryClient.invalidateQueries({ queryKey: read.queryKey });
  };

  const optimisticCount = useRef(0);
  const addWorklog = useMutation({
    mutationKey: worklogMutationKey(issueId),
    scope: { id: writeScope },
    mutationFn: ({ input }: { input: AddIssueWorklogInput; draft: WorklogDraft; optimisticId: string }) =>
      taskaApi.addIssueWorklog(projectId, issueId, input),
    onMutate: async ({ input, optimisticId }) => {
      setNotice(null);
      await queryClient.cancelQueries({ queryKey: read.queryKey });
      const stamp = new Date().toISOString();
      setList((current) => [
        ...current,
        {
          id: optimisticId,
          issueId,
          projectId,
          authorUserId: currentUserId ?? "",
          spentMinutes: input.spentMinutes,
          workDate: input.workDate,
          comment: input.comment ?? null,
          createdAt: stamp,
          updatedAt: stamp,
        },
      ]);
    },
    onError: (error, { draft: sent, optimisticId }) => {
      setList((current) => current.filter((item) => item.id !== optimisticId));
      // The reader's entry goes back in the boxes — unless they have started a
      // new one since, which is theirs too and is not overwritten.
      setDraft((current) =>
        current.duration === "" && current.comment === "" ? sent : current,
      );
      failed("Your work log entry was not saved.", error);
    },
    onSuccess: async (saved, { optimisticId }) => {
      setList((current) => current.map((item) => (item.id === optimisticId ? saved : item)));
      await settleIssue();
    },
    onSettled: settleList,
  });

  const updateWorklog = useMutation({
    mutationKey: worklogMutationKey(issueId),
    scope: { id: writeScope },
    mutationFn: ({ worklog, input }: { worklog: IssueWorklog; input: UpdateIssueWorklogInput; draft: WorklogDraft }) =>
      taskaApi.updateIssueWorklog(projectId, issueId, worklog.id, input),
    onMutate: async ({ worklog, input }) => {
      setNotice(null);
      await queryClient.cancelQueries({ queryKey: read.queryKey });
      setList((current) => current.map((item) => (item.id === worklog.id ? applyWorklogUpdate(item, input) : item)));
    },
    onError: (error, { worklog, draft: sent }) => {
      setList((current) => current.map((item) => (item.id === worklog.id ? worklog : item)));
      // Back into the editor with what the reader typed: the change is their
      // work, and a refusal is no reason to make them type it again.
      setEditing({ id: worklog.id, draft: sent, attempted: false });
      failed("Your change to the work log entry was not saved.", error);
    },
    onSuccess: async (saved) => {
      setList((current) => current.map((item) => (item.id === saved.id ? saved : item)));
      await settleIssue();
    },
    onSettled: settleList,
  });

  const deleteWorklog = useMutation({
    mutationKey: worklogMutationKey(issueId),
    scope: { id: writeScope },
    mutationFn: (worklog: IssueWorklog) => taskaApi.deleteIssueWorklog(projectId, issueId, worklog.id),
    onMutate: async (worklog) => {
      setNotice(null);
      await queryClient.cancelQueries({ queryKey: read.queryKey });
      setList((current) => current.filter((item) => item.id !== worklog.id));
    },
    onError: (error, worklog) => {
      setList((current) => (current.some((item) => item.id === worklog.id) ? current : [...current, worklog]));
      failed("The work log entry was not deleted.", error);
    },
    onSuccess: settleIssue,
    onSettled: settleList,
  });

  const addProblems = worklogDraftProblems(draft, today);
  const shownAddProblems: WorklogDraftProblems = addAttempted ? addProblems : {};

  const submitAdd = () => {
    if (hasProblems(addProblems)) {
      setAddAttempted(true);
      const first = draftFields.find((field) => addProblems[field]);
      if (first) document.getElementById(`${formId}-add-${first}`)?.focus();
      return;
    }
    optimisticCount.current += 1;
    addWorklog.mutate({
      input: addInputOf(draft),
      draft,
      optimisticId: `${optimisticWorklogPrefix}${optimisticCount.current}`,
    });
    setDraft(emptyDraft(today));
    setAddAttempted(false);
  };

  const startEdit = (worklog: IssueWorklog) => {
    setNotice(null);
    setConfirmingId(null);
    setEditing({ id: worklog.id, draft: draftOf(worklog), attempted: false });
  };
  const closeEdit = (worklogId: string) => {
    setEditing(null);
    pendingFocus.current = `edit:${worklogId}`;
  };
  const submitEdit = (worklog: IssueWorklog) => {
    if (!editing) return;
    const problems = worklogDraftProblems(editing.draft, today, worklog.workDate);
    if (hasProblems(problems)) {
      setEditing({ ...editing, attempted: true });
      const first = draftFields.find((field) => problems[field]);
      if (first) document.getElementById(`${formId}-edit-${first}`)?.focus();
      return;
    }
    const input = updateInputOf(worklog, editing.draft);
    // Nothing changed is nothing to send: the server refuses an empty update.
    if (Object.keys(input).length > 0) updateWorklog.mutate({ worklog, input, draft: editing.draft });
    closeEdit(worklog.id);
  };

  const openConfirm = (worklog: IssueWorklog) => {
    setNotice(null);
    setEditing(null);
    setConfirmingId((current) => (current === worklog.id ? null : worklog.id));
  };
  const cancelConfirm = (worklogId: string) => {
    setConfirmingId(null);
    pendingFocus.current = `delete:${worklogId}`;
  };
  const acceptConfirm = (worklog: IssueWorklog) => {
    setConfirmingId(null);
    pendingFocus.current = "heading";
    deleteWorklog.mutate(worklog);
  };

  const showForm = canLog && !undeployed;

  return (
    <section aria-labelledby={`${formId}-heading`} className="issue-worklogs">
      <div className="worklog-heading">
        {/* Focusable only from script: where focus lands when a deleted row
            leaves with the button that removed it. */}
        <h3 id={`${formId}-heading`} ref={headingRef} tabIndex={-1}>
          Work log
          {worklogs.length ? <span className="count-pill">{worklogs.length}</span> : null}
        </h3>
        {worklogs.length ? <p className="worklog-total">{formatDuration(total)} logged</p> : null}
      </div>

      {showForm ? (
        <form
          aria-label="Log work"
          className="worklog-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            submitAdd();
          }}
        >
          <WorklogFields
            draft={draft}
            idPrefix={`${formId}-add`}
            onChange={setDraft}
            problems={shownAddProblems}
            today={today}
          />
          <div className="worklog-form-actions">
            {/* `aria-disabled`, never `disabled` (§4.22): an empty duration reads as
                unavailable, and a click still shows what is missing. */}
            <button
              aria-disabled={draft.duration.trim() === "" || undefined}
              className="primary-button compact-button"
              type="submit"
            >
              Log work
            </button>
          </div>
        </form>
      ) : null}

      {/* One live region that stays mounted and changes its text — the
          attachments section's recipe. The request id sits under it, outside
          the region, so an announcement never reads out a uuid. */}
      <div className={notice ? "worklog-note is-error" : undefined}>
        <p aria-live="polite" className="worklog-note-sentence">
          {notice?.text ?? ""}
        </p>
        {notice?.requestId ? <RequestId value={notice.requestId} /> : null}
      </div>

      {undeployed ? (
        // Not an error and not an empty list: the route is not on this gateway
        // yet (backend PR #178), and neither "could not be loaded" nor "No work
        // logged yet" would be true.
        <p className="issue-links-empty is-unavailable">This gateway does not serve work logs yet.</p>
      ) : worklogsQuery.isError ? (
        <ApiNotice error={worklogsQuery.error} live="polite">
          The work log could not be loaded.
        </ApiNotice>
      ) : null}

      {worklogsQuery.isPending ? <p className="issue-links-empty">Loading work log</p> : null}
      {worklogsQuery.isSuccess && worklogs.length === 0 ? <p className="issue-links-empty">No work logged yet</p> : null}

      {worklogs.length ? (
        <ul className="worklog-list">
          {worklogs.map((worklog) => {
            const pending = worklog.id.startsWith(optimisticWorklogPrefix);
            const mine = Boolean(currentUserId) && worklog.authorUserId === currentUserId;
            const canManage = !pending && (mine ? canLog : isProjectAdmin);
            const author = personFor(worklog.authorUserId, null, userById);
            const isEditing = canManage && editing?.id === worklog.id;
            const confirming = canManage && confirmingId === worklog.id;
            return (
              <WorklogRow
                author={author}
                canManage={canManage}
                confirmId={`${formId}-confirm-${worklog.id}`}
                confirming={confirming}
                editing={isEditing ? editing : null}
                idPrefix={`${formId}-edit`}
                key={worklog.id}
                onAcceptConfirm={() => acceptConfirm(worklog)}
                onCancelConfirm={() => cancelConfirm(worklog.id)}
                onCancelEdit={() => closeEdit(worklog.id)}
                onDraftChange={(next) => setEditing((current) => (current ? { ...current, draft: next } : current))}
                onOpenConfirm={() => openConfirm(worklog)}
                onSave={() => submitEdit(worklog)}
                onStartEdit={() => startEdit(worklog)}
                pending={pending}
                registerFocusable={registerFocusable}
                today={today}
                worklog={worklog}
              />
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

function WorklogRow({
  worklog,
  author,
  pending,
  canManage,
  editing,
  confirming,
  confirmId,
  idPrefix,
  today,
  registerFocusable,
  onStartEdit,
  onCancelEdit,
  onDraftChange,
  onSave,
  onOpenConfirm,
  onCancelConfirm,
  onAcceptConfirm,
}: {
  worklog: IssueWorklog;
  author: Person | undefined;
  pending: boolean;
  canManage: boolean;
  editing: { draft: WorklogDraft; attempted: boolean } | null;
  confirming: boolean;
  confirmId: string;
  idPrefix: string;
  today: string;
  registerFocusable: (key: string) => (node: HTMLElement | null) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onDraftChange: (draft: WorklogDraft) => void;
  onSave: () => void;
  onOpenConfirm: () => void;
  onCancelConfirm: () => void;
  onAcceptConfirm: () => void;
}) {
  const duration = formatDuration(worklog.spentMinutes);
  const day = formatWorkDate(worklog.workDate);
  // §4.15's word for a person nobody here can name — the comments and the
  // watchers say the same.
  const name = author?.displayName ?? "Unknown";
  const what = `${duration} logged on ${day} by ${name}`;
  const problems = editing?.attempted ? worklogDraftProblems(editing.draft, today, worklog.workDate) : {};

  return (
    <li className={`worklog-row${pending ? " is-pending" : ""}`}>
      <Avatar size="sm" user={author} />
      <div className="worklog-main">
        <p className="worklog-head">
          <strong>{name}</strong>
          <span className="worklog-duration">{duration}</span>
          <time dateTime={worklog.workDate}>{day}</time>
        </p>

        {editing ? (
          <form
            aria-label={`Edit ${what}`}
            className="worklog-form is-editing"
            noValidate
            onKeyDown={(event: KeyboardEvent) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                onCancelEdit();
              }
            }}
            onSubmit={(event) => {
              event.preventDefault();
              onSave();
            }}
          >
            <WorklogFields
              autoFocus
              draft={editing.draft}
              idPrefix={idPrefix}
              onChange={onDraftChange}
              problems={problems}
              today={today}
            />
            <div className="worklog-form-actions">
              <button className="secondary-button compact-button" onClick={onCancelEdit} type="button">
                Cancel
              </button>
              <button className="primary-button compact-button" type="submit">
                Save
              </button>
            </div>
          </form>
        ) : (
          <>
            {worklog.comment ? <p className="worklog-comment">{worklog.comment}</p> : null}
            {canManage ? (
              <div className="comment-actions">
                <button
                  aria-label={`Edit ${what}`}
                  className="link-button"
                  onClick={onStartEdit}
                  ref={registerFocusable(`edit:${worklog.id}`)}
                  type="button"
                >
                  Edit
                </button>
                <button
                  aria-controls={confirming ? confirmId : undefined}
                  aria-expanded={confirming}
                  aria-label={`Delete ${what}`}
                  className="link-button"
                  onClick={onOpenConfirm}
                  ref={registerFocusable(`delete:${worklog.id}`)}
                  type="button"
                >
                  Delete
                </button>
              </div>
            ) : null}
          </>
        )}

        {confirming ? (
          // §4.22's inline confirmation: the sentence, Cancel first and focused,
          // and the answer that destroys something edged in `--danger`.
          <div
            className="member-confirm worklog-confirm"
            id={confirmId}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                onCancelConfirm();
              }
            }}
          >
            <p className="member-confirm-sentence" id={`${confirmId}-sentence`}>
              Delete {duration} logged on {day}? The time goes back to the remaining estimate.
            </p>
            <div className="member-confirm-actions">
              <button autoFocus className="secondary-button compact-button" onClick={onCancelConfirm} type="button">
                Cancel
              </button>
              <button
                aria-describedby={`${confirmId}-sentence`}
                className="secondary-button compact-button member-confirm-accept"
                onClick={onAcceptConfirm}
                type="button"
              >
                Delete entry
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </li>
  );
}

/**
 * The three boxes of an entry, shared by the add form and the inline editor.
 * A box that is wrong says so under itself, in place of its hint, and is
 * described by that sentence; the problems are only passed in once the reader
 * has tried to save, so nobody is scolded for a box they have not reached yet.
 */
function WorklogFields({
  draft,
  problems,
  idPrefix,
  today,
  autoFocus = false,
  onChange,
}: {
  draft: WorklogDraft;
  problems: WorklogDraftProblems;
  idPrefix: string;
  today: string;
  autoFocus?: boolean;
  onChange: (draft: WorklogDraft) => void;
}) {
  const set = (field: WorklogDraftField) => (value: string) => onChange({ ...draft, [field]: value });
  const noteId = (field: WorklogDraftField) => `${idPrefix}-${field}-note`;

  return (
    <>
      <div className="worklog-form-row">
        <div className="worklog-field worklog-field-duration">
          <label htmlFor={`${idPrefix}-duration`}>Time spent</label>
          <input
            aria-describedby={noteId("duration")}
            aria-invalid={problems.duration ? true : undefined}
            autoComplete="off"
            autoFocus={autoFocus}
            id={`${idPrefix}-duration`}
            onChange={(event) => set("duration")(event.target.value)}
            placeholder="1h 30m"
            type="text"
            value={draft.duration}
          />
          <p className={problems.duration ? "worklog-field-error" : "planning-hint"} id={noteId("duration")}>
            {problems.duration ?? WORKLOG_DURATION_HINT}
          </p>
        </div>
        <div className="worklog-field worklog-field-date">
          <label htmlFor={`${idPrefix}-workDate`}>Date</label>
          <input
            aria-describedby={problems.workDate ? noteId("workDate") : undefined}
            aria-invalid={problems.workDate ? true : undefined}
            id={`${idPrefix}-workDate`}
            // The reader's today: work not yet done is not work to log.
            max={today}
            onChange={(event) => set("workDate")(event.target.value)}
            type="date"
            value={draft.workDate}
          />
          {problems.workDate ? (
            <p className="worklog-field-error" id={noteId("workDate")}>
              {problems.workDate}
            </p>
          ) : null}
        </div>
      </div>
      <div className="worklog-field">
        <label htmlFor={`${idPrefix}-comment`}>
          Comment <span className="worklog-optional">optional</span>
        </label>
        <textarea
          aria-describedby={problems.comment ? noteId("comment") : undefined}
          aria-invalid={problems.comment ? true : undefined}
          id={`${idPrefix}-comment`}
          maxLength={WORKLOG_COMMENT_MAX_LENGTH}
          onChange={(event) => set("comment")(event.target.value)}
          rows={2}
          value={draft.comment}
        />
        {problems.comment ? (
          <p className="worklog-field-error" id={noteId("comment")}>
            {problems.comment}
          </p>
        ) : null}
      </div>
    </>
  );
}
