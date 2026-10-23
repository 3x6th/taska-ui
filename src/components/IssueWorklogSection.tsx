import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { apiErrorFacts, isUndeployedRoute } from "../api/errors";
import { refusalWords } from "../lib/projectArchive";
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
import { Avatar } from "./Avatar";
import { ErrorNote } from "./ErrorNote";
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
  archived = false,
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
  /**
   * The project is archived (DESIGN.md §5.7). Logging is off through the two
   * flags above; this only keeps an entry the reader had typed and not saved —
   * the add form's, or an open editor's — on screen, read-only, when the
   * archive lands under them: their words are work (§5.5).
   */
  archived?: boolean;
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

  const noticeOf = (sentence: string, error: unknown): WorklogNotice => {
    const { requestId } = apiErrorFacts(error);
    // The server's words, or ours for an archived project's refusal (§5.7).
    const message = refusalWords(error);
    return { text: message ? `${sentence} ${message}` : sentence, requestId };
  };
  const failed = (sentence: string, error: unknown) => setNotice(noticeOf(sentence, error));

  const setList = (update: (current: IssueWorklog[]) => IssueWorklog[]) =>
    queryClient.setQueryData<IssueWorklog[]>(issueWorklogsKey(projectId, issueId), (current) =>
      current ? update(current) : current,
    );

  /**
   * After a write: the issue, whose version and remaining estimate moved — and
   * only the issue. The board is not read again: a card draws nothing a worklog
   * changes (TAS-202), and its `version` is never sent anywhere. The issue's
   * re-read is awaited, so a queued edit leaves with the version it brought.
   * Then the list, but only once no other worklog write of this issue is in
   * flight — a re-read landing between two optimistic writes would take the
   * second one's row off the screen.
   */
  const settleIssue = () => queryClient.invalidateQueries({ queryKey: ["issue", projectId, issueId] });
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

  // An entry the archive caught half typed stays, read-only and without its
  // button (§5.7); with nothing typed the form goes with the right to log.
  const keepsDraft = !canLog && archived && (draft.duration.trim() !== "" || draft.comment.trim() !== "");
  const showForm = (canLog || keepsDraft) && !undeployed;
  // The panel's one error box (TAS-192), worded the way this section's write
  // refusals are: its sentence, then the server's. No live region: a failed
  // read is the section's state on opening, not an answer to something the
  // reader did — the same as the comments' read failure.
  const readFailure = worklogsQuery.isError ? noticeOf("The work log could not be loaded.", worklogsQuery.error) : null;

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
            if (canLog) submitAdd();
          }}
        >
          <WorklogFields
            draft={draft}
            idPrefix={`${formId}-add`}
            onChange={setDraft}
            problems={shownAddProblems}
            readOnly={!canLog}
            today={today}
            // A typed duration or comment holds the issue panel open on Esc
            // (§4.10, TAS-380). The date alone is not the reader's text: it
            // starts at today.
            unsaved={draft.duration.trim() !== "" || draft.comment.trim() !== ""}
          />
          {canLog ? (
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
          ) : null}
        </form>
      ) : null}

      {/* One live region that stays mounted and changes its text — the
          attachments section's recipe. The request id sits under it, outside
          the region, so an announcement never reads out a uuid. */}
      <div className={notice ? "worklog-note is-error" : undefined}>
        <p aria-live="polite" className="worklog-note-sentence">
          {notice?.text ?? ""}
        </p>
        {notice?.requestId ? (
          <p className="worklog-note-detail">
            <RequestId value={notice.requestId} />
          </p>
        ) : null}
      </div>

      {undeployed ? (
        // Not an error and not an empty list: the route is not on this gateway
        // yet (backend PR #178), and neither "could not be loaded" nor "No work
        // logged yet" would be true.
        <p className="issue-links-empty is-unavailable">This gateway does not serve work logs yet.</p>
      ) : readFailure ? (
        <ErrorNote requestId={readFailure.requestId}>
          {readFailure.text}
        </ErrorNote>
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
            // An editor the archive caught open stays open, read-only (§5.7).
            const isEditing = (canManage || archived) && !pending && editing?.id === worklog.id;
            const confirming = canManage && confirmingId === worklog.id;
            return (
              <WorklogRow
                author={author}
                canManage={canManage}
                confirmId={`${formId}-confirm-${worklog.id}`}
                confirming={confirming}
                editing={isEditing ? editing : null}
                readOnly={!canManage}
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
  readOnly,
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
  /** An open editor that can no longer save: the archive landed under it (§5.7). */
  readOnly: boolean;
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
      {/* Esc closes an open question from anywhere in the row's text column —
          the strip's two answers, and the Delete that asked, which Shift+Tab
          from Cancel lands on (§4.22). On the strip alone it did nothing there. */}
      <div
        className="worklog-main"
        onKeyDown={(event) => {
          if (confirming && event.key === "Escape") {
            // Used: the issue panel's own Esc skips a press something inside took (§4.10).
            event.preventDefault();
            event.stopPropagation();
            onCancelConfirm();
          }
        }}
      >
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
                event.preventDefault();
                event.stopPropagation();
                onCancelEdit();
              }
            }}
            onSubmit={(event) => {
              event.preventDefault();
              if (!readOnly) onSave();
            }}
          >
            <WorklogFields
              autoFocus
              draft={editing.draft}
              idPrefix={idPrefix}
              onChange={onDraftChange}
              problems={problems}
              readOnly={readOnly}
              today={today}
            />
            <div className="worklog-form-actions">
              <button className="secondary-button compact-button" onClick={onCancelEdit} type="button">
                Cancel
              </button>
              {readOnly ? null : (
                <button className="primary-button compact-button" type="submit">
                  Save
                </button>
              )}
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
          <div className="member-confirm worklog-confirm" id={confirmId}>
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
 *
 * `unsaved` marks every box `data-unsaved-text`, which the issue panel's Esc
 * reads (§4.10, TAS-380): with focus in any of them, Esc leaves the panel, the
 * draft and the focus where they are. The inline editor does not pass it — its
 * own Esc closes the editor first and never reaches the panel.
 */
function WorklogFields({
  draft,
  problems,
  idPrefix,
  today,
  autoFocus = false,
  unsaved = false,
  readOnly = false,
  onChange,
}: {
  draft: WorklogDraft;
  problems: WorklogDraftProblems;
  idPrefix: string;
  today: string;
  autoFocus?: boolean;
  unsaved?: boolean;
  /** The draft stays on screen and cannot change: the project was archived under it (§5.7). */
  readOnly?: boolean;
  onChange: (draft: WorklogDraft) => void;
}) {
  const set = (field: WorklogDraftField) => (value: string) => onChange({ ...draft, [field]: value });
  const noteId = (field: WorklogDraftField) => `${idPrefix}-${field}-note`;
  const unsavedText = unsaved ? "true" : undefined;

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
            data-unsaved-text={unsavedText}
            id={`${idPrefix}-duration`}
            onChange={(event) => set("duration")(event.target.value)}
            placeholder="1h 30m"
            readOnly={readOnly}
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
            data-unsaved-text={unsavedText}
            id={`${idPrefix}-workDate`}
            // The reader's today: work not yet done is not work to log.
            max={today}
            onChange={(event) => set("workDate")(event.target.value)}
            readOnly={readOnly}
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
          data-unsaved-text={unsavedText}
          id={`${idPrefix}-comment`}
          maxLength={WORKLOG_COMMENT_MAX_LENGTH}
          onChange={(event) => set("comment")(event.target.value)}
          readOnly={readOnly}
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
