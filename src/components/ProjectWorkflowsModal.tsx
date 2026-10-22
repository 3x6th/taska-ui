import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { CreateProjectWorkflowInput, WorkflowStatusInput, WorkflowTransitionInput } from "../api/TaskaApi";
import { UNDEPLOYED_ROUTE_MESSAGE } from "../api/TaskaApi";
import { taskaApi } from "../api/client";
import { apiErrorFacts, isUndeployedRoute } from "../api/errors";
import type {
  DictionaryEntry,
  IssueTypeCode,
  ProjectRole,
  ProjectWorkflowEntry,
  WorkflowDefinition,
  WorkflowStatus,
} from "../domain/types";
import { useMeta } from "../hooks/useMeta";
import { useUnanswered } from "../hooks/useUnanswered";
import { issueTypeInSentence, issueTypeLabel, keyBadgeStyle, statusLabel } from "../lib/format";
import { projectContextKey } from "../lib/projectContext";
import {
  STATUS_KEY_MAX_LENGTH,
  STATUS_KEY_PATTERN,
  WORKFLOW_NAME_MAX_LENGTH,
  andList,
  categoryLabel,
  defaultCategory,
  defaultPosition,
  defaultTransitionPair,
  firstTargetFrom,
  nextTransitionSortOrder,
  normalizeStatusKey,
  orderWorkflowEntries,
  positionOptions,
  positionValue,
  statusCategoriesOf,
  statusKeyFromName,
  statusesInColumnOrder,
  transitionBetween,
  transitionButtonLabel,
  transitionsInListOrder,
  unreachedStatusIds,
  workflowCopyInput,
} from "../lib/workflows";
import { ApiNotice } from "./ApiNotice";
import { ErrorNote } from "./ErrorNote";
import { CategoryDot, TypeChip } from "./IssueBits";
import { Modal } from "./Modal";
import { WorkflowDiagram } from "./WorkflowDiagram";
import { projectWorkflowsKey, projectWorkflowsOptions } from "./projectWorkflowsQuery";

/** The one form a dialog may have open (§4.28: opening another closes this one, draft and all). */
type OpenForm = { kind: "create" } | { kind: "status"; workflowId: string } | { kind: "transition"; workflowId: string };

/**
 * What a write is told in, worded when it is sent: once the write has landed
 * the form that knew the names is gone. `done` goes to the dialog's polite
 * region; `unread` heads the notice when the write succeeded and the list
 * could not be read again.
 */
interface Said {
  done: string;
  unread: string;
}

type WorkflowWrite =
  | { kind: "create"; input: CreateProjectWorkflowInput; said: Said }
  | { kind: "status"; workflowId: string; input: WorkflowStatusInput; said: Said }
  | { kind: "transition"; workflowId: string; input: WorkflowTransitionInput; said: Said };

/** The row or card a successful write found by id in the re-read list, held for two seconds (§4.28). */
type Highlight = { kind: "card" | "status" | "transition"; id: string };

const HIGHLIGHT_MS = 2000;

/** The trigger a form stands in place of, which is where focus goes back to when it closes without a result. */
const triggerKey = (form: OpenForm | WorkflowWrite) =>
  form.kind === "create" ? "trigger:create" : `trigger:${form.kind}:${form.workflowId}`;

/** A 404 or a 409 says the list on screen is not the server's any more, so it is read again (api-contract-guard). */
const isGoneOrTaken = (error: unknown) => {
  const { status, code } = apiErrorFacts(error);
  return status === 404 || status === 409 || code === "NOT_FOUND" || code === "ALREADY_EXISTS";
};

/**
 * The id of what a write made, out of its 201 — and nothing else is read from
 * one (§4.28): an add answers only the visible transitions, a create no types
 * and no `shared` (backend PR #208 at `9a04e99`, docs/ai/API-DIVERGENCE.md), so
 * the list on screen is always the re-read one.
 */
function madeId(answer: WorkflowDefinition, sent: WorkflowWrite): string | null {
  if (sent.kind === "create") return answer.id || null;
  const idOf = (key: string) => answer.statuses.find((status) => status.statusKey === key)?.id;
  if (sent.kind === "status") return idOf(sent.input.statusKey) ?? null;
  const [from, to] = [idOf(sent.input.fromStatusKey), idOf(sent.input.toStatusKey)];
  return answer.transitions.find((transition) => transition.fromStatusId === from && transition.toStatusId === to)?.id ?? null;
}

/** Room for §7's ring when a node is scrolled into the body's view: its 2px offset and 2px width. */
const RING_ROOM = 4;

/**
 * Focus that moves only the dialog's body. A plain `focus()` scrolls every
 * scrollable ancestor into line, and `.modal` is one — `overflow: hidden`
 * still scrolls from script — so a focus move after a write once scrolled the
 * box itself and cut the header off (TAS-382). The box is kept free of
 * overflow (`.workflows-panel` in styles.css); this keeps the guarantee where
 * it is relied on: focus without scrolling, then the body's own `scrollTop`.
 */
function focusInBody(node: HTMLElement) {
  node.focus({ preventScroll: true });
  const body = node.closest(".modal-body");
  if (!(body instanceof HTMLElement)) return;
  const view = body.getBoundingClientRect();
  const box = node.getBoundingClientRect();
  if (box.top - RING_ROOM < view.top) body.scrollTop -= view.top - (box.top - RING_ROOM);
  else if (box.bottom + RING_ROOM > view.bottom) body.scrollTop += box.bottom + RING_ROOM - view.bottom;
}

interface ProjectWorkflowsModalProps {
  projectId: string;
  projectKey: string;
  /** For the eyebrow badge only, as in Members. */
  projectColor?: string | null;
  /**
   * The board's reading of the reader's role, from the project context: the
   * three-way value Members takes (`undefined` while unread, `null` for no
   * role this build can act on or a failed read). Only an ADMIN gets controls;
   * presentation only — the server refuses all three writes for anybody else.
   */
  readerRole: ProjectRole | null | undefined;
  /** The board's issue types in its own order (`allowedIssueTypes`), which orders the project's own cards. */
  issueTypeOrder: readonly IssueTypeCode[];
  onClose: () => void;
}

/**
 * The project's workflows (TAS-382, DESIGN.md §4.28, backend PR #208): every
 * workflow its issue types run on, each once, with its statuses and every
 * transition — the hidden ones the board never offers included — and for an
 * ADMIN the three writes the server has: a new workflow, a status, a
 * transition. Nothing is renamed, moved or removed: there is no route for it.
 *
 * **Every reader can open it**; the list is the board's own configuration and
 * no secret. The shared default is read-only for everybody — the server
 * refuses a write to it — so its card carries no control at all.
 *
 * **A new workflow is a verbatim copy of the shared default**, not editable
 * before it is sent: the server accepts a workflow with no status or no visible
 * transition, and then the project's context answers 404 to every member; one
 * with no `TODO` puts new issues of its types in Other statuses
 * (docs/ai/API-DIVERGENCE.md). Statuses and transitions are added afterwards,
 * one at a time, and every add is re-validated whole on the server.
 *
 * **No write is optimistic**, deliberately against §1's rule (§4.28 "В
 * полёте"): each one changes the board of every member, and a rollback would
 * take a row back out and reopen the form in front of the reader. The form
 * stays in flight until the list has been read again; the context is
 * invalidated at the same moment and not waited for — the board under the
 * scrim takes its new columns and moves from it and reports its own failures.
 */
export function ProjectWorkflowsModal({
  projectId,
  projectKey,
  projectColor,
  readerRole,
  issueTypeOrder,
  onClose,
}: ProjectWorkflowsModalProps) {
  const queryClient = useQueryClient();
  const served = useMeta()?.issueTypes;
  const workflowsQuery = useQuery(projectWorkflowsOptions(projectId));
  const unread = useUnanswered(workflowsQuery);
  const undeployed = unread.unanswered && isUndeployedRoute(unread.error, UNDEPLOYED_ROUTE_MESSAGE);
  const listed = workflowsQuery.data;
  const entries = useMemo(() => orderWorkflowEntries(listed ?? [], issueTypeOrder), [listed, issueTypeOrder]);
  const categories = useMemo(() => statusCategoriesOf(listed ?? []), [listed]);
  const shared = entries.find((entry) => entry.shared);
  const isAdmin = readerRole === "ADMIN";
  const canCreate = isAdmin && Boolean(shared?.issueTypes.length);

  const [form, setForm] = useState<OpenForm | null>(null);
  const [highlight, setHighlight] = useState<Highlight | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [unreadAfterWrite, setUnreadAfterWrite] = useState<{ sentence: string; error: unknown } | null>(null);
  /** Statuses this dialog added, so Add transition can offer the one nothing leads to yet. */
  const [addedStatusIds, setAddedStatusIds] = useState<string[]>([]);

  /**
   * Where focus goes after the next render — a form's trigger once it closes,
   * the new card's heading, the submit after a refusal. Looked up by key among
   * the nodes registered below, because the node a write lands on is drawn by
   * the re-read rather than by the write.
   */
  const pendingFocus = useRef<string | null>(null);
  const focusables = useRef(new Map<string, HTMLElement>());
  const register = (key: string) => (node: HTMLElement | null) => {
    if (node) focusables.current.set(key, node);
    else focusables.current.delete(key);
  };
  useEffect(() => {
    const key = pendingFocus.current;
    if (!key) return;
    pendingFocus.current = null;
    const node = focusables.current.get(key);
    if (node) focusInBody(node);
  });

  useEffect(() => {
    if (!highlight) return;
    const timer = window.setTimeout(() => setHighlight(null), HIGHLIGHT_MS);
    return () => window.clearTimeout(timer);
  }, [highlight]);

  const write = useMutation({
    mutationFn: (sent: WorkflowWrite) => {
      if (sent.kind === "create") return taskaApi.createProjectWorkflow(projectId, sent.input);
      if (sent.kind === "status") return taskaApi.addWorkflowStatus(projectId, sent.workflowId, sent.input);
      return taskaApi.addWorkflowTransition(projectId, sent.workflowId, sent.input);
    },
    onError: (error) => {
      if (isGoneOrTaken(error)) void queryClient.invalidateQueries({ queryKey: projectWorkflowsKey(projectId) });
      pendingFocus.current = "submit";
    },
    // Mutation-level, so it runs to the end after the dialog has closed: Close
    // and the scrim stay usable in flight and cancel neither the write nor the
    // re-read (§4.28). The returned promise is what keeps the form in flight
    // until the list has answered.
    onSuccess: async (answer, sent) => {
      const id = madeId(answer, sent);
      const listKey = projectWorkflowsKey(projectId);
      void queryClient.invalidateQueries({ queryKey: projectContextKey(projectId) });
      const asked = Date.now();
      await queryClient.invalidateQueries({ queryKey: listKey });
      const state = queryClient.getQueryState(listKey);
      const rereadFailed = state?.status === "error" && state.errorUpdatedAt >= asked;

      setForm(null);
      if (sent.kind === "status" && id) setAddedStatusIds((current) => [...current, id]);
      if (rereadFailed) {
        // A 201 is what happened, so never "was not added" (§4.28): the notice
        // says the write landed and the list could not show it. The polite
        // region stays quiet — the notice is the one announcement — and
        // nothing is highlighted, because nothing new is drawn.
        setUnreadAfterWrite({ sentence: sent.said.unread, error: state.error });
        pendingFocus.current = triggerKey(sent);
        return;
      }
      setUnreadAfterWrite(null);
      setAnnouncement(sent.said.done);
      setHighlight(id ? { kind: sent.kind === "create" ? "card" : sent.kind, id } : null);
      // A new status is a column nothing can reach yet, so focus goes where
      // the next step is: its card's Add transition.
      pendingFocus.current =
        sent.kind === "create" ? (id ? `heading:${id}` : "trigger:create") : `trigger:transition:${sent.workflowId}`;
    },
  });
  const inFlight = write.isPending;

  const openForm = (next: OpenForm) => {
    if (inFlight) return;
    write.reset();
    setUnreadAfterWrite(null);
    setForm(next);
  };
  const closeForm = () => {
    if (inFlight || !form) return;
    write.reset();
    pendingFocus.current = triggerKey(form);
    setForm(null);
  };
  const send = (sent: WorkflowWrite) => {
    if (inFlight) return;
    setAnnouncement("");
    write.mutate(sent);
  };

  /**
   * §4.11's `Esc`, bound here because `Modal` carries none (the gap §7 keeps
   * open, as Members does). The nearer thing first: an open form, unless its
   * write is out — then nothing at all, since Esc must not look like it
   * cancelled a write that is still going; otherwise the dialog. Never during
   * IME composition, where Esc belongs to the input method.
   */
  const onEscape = useRef(() => {});
  useEffect(() => {
    onEscape.current = () => {
      if (inFlight) return;
      if (form) closeForm();
      else onClose();
    };
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      event.preventDefault();
      onEscape.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const badge = keyBadgeStyle(projectKey, projectColor);
  const readOnlyReader = readerRole === "MEMBER" || readerRole === "VIEWER" || readerRole === null;
  /** The refusal of the open form's write, if the last write was this form's. */
  const formError = write.isError ? write.error : null;

  const formProps = { inFlight, error: formError, onCancel: closeForm, register };

  return (
    <Modal
      eyebrow={
        badge ? (
          <span className="key-badge" style={badge}>
            {projectKey}
          </span>
        ) : undefined
      }
      focusableBody={readOnlyReader}
      onClose={onClose}
      title="Workflows"
    >
      <div className="workflows-panel">
        {/* One polite region, mounted from the start so its first sentence is
            heard (§7): what a write did, said once. */}
        <p aria-live="polite" className="visually-hidden">
          {announcement}
        </p>

        {/* Why there are no controls, only as far as the server said it
            (§4.22's rule, TAS-226): the admin rule for a role it named, an
            unknown role for none — and nothing while the role is still being
            read. */}
        {readerRole === "MEMBER" || readerRole === "VIEWER" ? (
          <p className="workflows-note">Only a project admin can change workflows.</p>
        ) : readerRole === null ? (
          <p className="workflows-note">Your role on this project is unknown, so workflows cannot be changed here.</p>
        ) : null}

        {isAdmin && listed && listed.length > 0 ? (
          canCreate && shared ? (
            form?.kind === "create" ? (
              <NewWorkflowForm {...formProps} served={served} shared={shared} send={send} />
            ) : (
              <AddTrigger
                focusKey="trigger:create"
                inFlight={inFlight}
                label="New workflow"
                onOpen={() => openForm({ kind: "create" })}
                register={register}
                unavailable={null}
              />
            )
          ) : (
            <p className="workflows-note">Every issue type in this project already has its own workflow.</p>
          )
        ) : null}

        {unreadAfterWrite ? (
          <ApiNotice error={unreadAfterWrite.error} live="polite">
            {unreadAfterWrite.sentence}
          </ApiNotice>
        ) : null}

        {/* Data first: a list on screen stays when a later read of it fails —
            a focus refetch, or the re-read after a write, which says so
            above. Only a read with nothing to show is reported as one. */}
        {listed ? (
          listed.length === 0 ? (
            <p className="workflows-empty">This project has no issue types, so it runs on no workflow.</p>
          ) : (
            <div className="workflow-list">
              {entries.map((entry) => (
                <WorkflowCard
                  addedStatusIds={addedStatusIds}
                  categories={categories}
                  entry={entry}
                  form={form}
                  formProps={formProps}
                  highlight={highlight}
                  inFlight={inFlight}
                  isAdmin={isAdmin}
                  key={entry.workflow.id}
                  onOpenForm={openForm}
                  register={register}
                  send={send}
                  served={served}
                />
              ))}
            </div>
          )
        ) : undeployed ? (
          // Not a failure the reader can do anything about, and nothing from
          // the context is put in its place: the board's workflows are not the
          // list (no hidden transitions, no shared flag), and drawing them here
          // would be the compensation AGENTS.md rules out.
          <p className="workflows-empty">Workflows are not on this gateway yet, so they cannot be shown here.</p>
        ) : unread.unanswered ? (
          // A state found on opening, not an answer to anything the reader
          // did, so not announced (§5.6). Reopening the dialog asks again.
          <ApiNotice error={unread.error} live="off">
            This project&rsquo;s workflows could not be loaded.
          </ApiNotice>
        ) : (
          <div aria-busy="true" className="workflow-list">
            <p className="visually-hidden" role="status">
              Loading workflows
            </p>
            <WorkflowSkeleton />
          </div>
        )}
      </div>
    </Modal>
  );
}

/** A ref callback that files a node under a key, for `pendingFocus` to find. */
type Register = (key: string) => (node: HTMLElement | null) => void;

/** What every form gets from the dialog: the write's state, the way out, and where its submit is filed. */
interface FormProps {
  inFlight: boolean;
  error: Error | null;
  onCancel: () => void;
  register: Register;
}

function WorkflowCard({
  entry,
  categories,
  addedStatusIds,
  isAdmin,
  inFlight,
  form,
  formProps,
  highlight,
  served,
  register,
  onOpenForm,
  send,
}: {
  entry: ProjectWorkflowEntry;
  categories: string[];
  addedStatusIds: string[];
  isAdmin: boolean;
  inFlight: boolean;
  form: OpenForm | null;
  formProps: FormProps;
  highlight: Highlight | null;
  served: readonly DictionaryEntry[] | null | undefined;
  register: Register;
  onOpenForm: (form: OpenForm) => void;
  send: (sent: WorkflowWrite) => void;
}) {
  const headingId = useId();
  const { workflow, issueTypes, shared } = entry;
  const name = workflow.name.trim() || "Unnamed workflow";
  const statuses = statusesInColumnOrder(workflow.statuses);
  const transitions = transitionsInListOrder(workflow);
  const unreached = unreachedStatusIds(workflow);
  const hasTodo = statuses.some((status) => status.statusKey === "TODO");
  const statusName = (statusId: string) => {
    const status = workflow.statuses.find((item) => item.id === statusId);
    return status ? statusLabel(status.statusKey, workflow.statuses) : null;
  };
  // Only a workflow of the project's own, and only for its ADMIN: the shared
  // default answers every write 400 `FAILED_PRECONDITION`, which is not a
  // conflict and is not offered to be had (§4.28, §5.7).
  const editable = isAdmin && !shared;
  const formHere = form && form.kind !== "create" && form.workflowId === workflow.id ? form.kind : null;
  const lit = (kind: Highlight["kind"], id: string) => highlight?.kind === kind && highlight.id === id;

  return (
    <section aria-labelledby={headingId} className={`workflow-card${lit("card", workflow.id) ? " is-highlighted" : ""}`}>
      <div className="workflow-card-head">
        {/* Focusable only from script: where focus lands when this card is new. */}
        <h3 id={headingId} ref={register(`heading:${workflow.id}`)} tabIndex={-1}>
          {name}
        </h3>
        {shared ? <span className="workflow-marker">shared</span> : null}
      </div>

      <div className="workflow-types">
        <span className="workflow-types-label">Used by</span>
        {issueTypes.length ? (
          // As the server sent them, not narrowed to the types the board
          // offers: the list may name one the project does not allow
          // (docs/ai/BACKLOG.md), and hiding it would misstate the binding.
          <ul className="workflow-type-list">
            {issueTypes.map((code) => (
              <li className="workflow-type" key={code}>
                <TypeChip type={code} />
                <span>{issueTypeLabel(code, served)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <span className="workflow-types-none">No issue type uses it.</span>
        )}
      </div>

      {shared ? (
        <p className="workflows-note">
          Shared by every Taska project, so it cannot be changed here.
          {isAdmin && issueTypes.length ? " A new workflow starts as a copy of it." : null}
        </p>
      ) : null}

      {/* A picture over the lists, never in their place (§4.28): the lists
          below stay whole, and are the keyboard's, the reader's and the
          phone's way through the same facts. */}
      <WorkflowDiagram name={name} workflow={workflow} />

      <h4 className="workflow-section-heading">Statuses</h4>
      {statuses.length ? (
        <ol aria-label={`Statuses of ${name}`} className="workflow-rows">
          {statuses.map((status) => (
            <li className={`workflow-status${lit("status", status.id) ? " is-highlighted" : ""}`} key={status.id}>
              <div className="workflow-status-line">
                <CategoryDot category={status.category} />
                <span className="workflow-status-name">{statusLabel(status.statusKey, workflow.statuses)}</span>
                <span className="workflow-status-key" title={status.statusKey}>
                  {status.statusKey}
                </span>
                <span className="workflow-status-category">{categoryLabel(status.category)}</span>
              </div>
              {unreached.has(status.id) ? <p className="workflow-status-note">No transition on the board leads here.</p> : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="workflows-note">The server sent this workflow without statuses.</p>
      )}
      {statuses.length && !hasTodo ? (
        // A fact about the data, so `--fg` rather than meta (§4.28):
        // issue-service creates every issue in `TODO` whatever its workflow.
        <p className="workflow-fact">
          {`New issues always start in TODO, which this workflow does not have, so new ${
            issueTypes.length ? `${andList(issueTypes.map((code) => issueTypeInSentence(code, served)))} ` : ""
          }issues will land in Other statuses on the board.`}
        </p>
      ) : null}
      {editable ? (
        formHere === "status" ? (
          <AddStatusForm {...formProps} categories={categories} send={send} workflow={workflow} />
        ) : (
          <AddTrigger
            inFlight={inFlight}
            label="Add status"
            focusKey={`trigger:status:${workflow.id}`}
            onOpen={() => onOpenForm({ kind: "status", workflowId: workflow.id })}
            register={register}
            unavailable={
              categories.length ? null : "The server sent no status categories, so a status cannot be added here."
            }
          />
        )
      ) : null}

      <h4 className="workflow-section-heading">Transitions</h4>
      {transitions.length ? (
        <ul aria-label={`Transitions of ${name}`} className="workflow-rows">
          {transitions.map((transition) => {
            const from = statusName(transition.fromStatusId);
            const to = statusName(transition.toStatusId);
            // The words on the issue's move button (§4.1): an unnamed
            // transition is drawn there as "Move to {To}", so it is here too.
            const shown = transitionButtonLabel(transition.name, to ?? "Unknown status").text;
            return (
              <li
                className={`workflow-transition${lit("transition", transition.id) ? " is-highlighted" : ""}`}
                key={transition.id}
              >
                <span className="workflow-transition-pair">
                  <StatusWord name={from} />
                  <span aria-hidden="true" className="arrow">
                    →
                  </span>
                  <span className="visually-hidden"> to </span>
                  <StatusWord name={to} />
                </span>
                <span className="workflow-transition-name" title={shown}>
                  <span className="visually-hidden">, named </span>
                  {shown}
                </span>
                {transition.hidden ? (
                  <>
                    <span className="visually-hidden">, </span>
                    <span className="workflow-marker">hidden</span>
                  </>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="workflows-note">No transitions yet, so issues cannot move between these statuses.</p>
      )}
      {transitions.some((transition) => transition.hidden) ? (
        <p className="workflows-note">Hidden transitions are not offered on the board.</p>
      ) : null}
      {editable ? (
        formHere === "transition" ? (
          <AddTransitionForm {...formProps} addedStatusIds={addedStatusIds} send={send} workflow={workflow} />
        ) : (
          <AddTrigger
            inFlight={inFlight}
            label="Add transition"
            focusKey={`trigger:transition:${workflow.id}`}
            onOpen={() => onOpenForm({ kind: "transition", workflowId: workflow.id })}
            register={register}
            unavailable={null}
          />
        )
      ) : null}
    </section>
  );
}

/** A status named in a transition row, or "Unknown status" for an id the workflow does not list — the row stays. */
function StatusWord({ name }: { name: string | null }) {
  return name === null ? <span className="workflow-status-unknown">Unknown status</span> : <span>{name}</span>;
}

/**
 * "New workflow" above the cards, "Add status" or "Add transition" under a list. `aria-disabled` in both of
 * §4.1's senses: while another write is out it answers nothing and looks as it
 * did; when the answer gave it nothing to work with, it is steadily unavailable
 * and says why under it.
 */
function AddTrigger({
  label,
  inFlight,
  unavailable,
  onOpen,
  focusKey,
  register,
}: {
  label: string;
  inFlight: boolean;
  unavailable: string | null;
  onOpen: () => void;
  focusKey: string;
  register: Register;
}) {
  const hintId = useId();
  return (
    <>
      <button
        aria-describedby={unavailable ? hintId : undefined}
        aria-disabled={inFlight || unavailable ? true : undefined}
        className={`secondary-button compact-button workflow-add${unavailable ? " is-unavailable" : ""}`}
        onClick={() => {
          if (!unavailable) onOpen();
        }}
        ref={register(focusKey)}
        type="button"
      >
        <Plus size={13} />
        {label}
      </button>
      {unavailable ? (
        <p className="admin-write-hint workflow-hint" id={hintId}>
          {unavailable}
        </p>
      ) : null}
    </>
  );
}

/**
 * The bottom of every form: the reason the submit is off when it is not an
 * empty field, the refusal of the last attempt, and Cancel beside the submit.
 * An empty field turns the submit off with no sentence (§4.28); a write in
 * flight turns both buttons off without a fade (§4.1).
 */
function FormFoot({
  submitLabel,
  refusedSentence,
  reason,
  blocked,
  describedBy,
  inFlight,
  error,
  onCancel,
  register,
}: FormProps & {
  submitLabel: string;
  refusedSentence: string;
  reason: string | null;
  /** An empty required field, or a reason. */
  blocked: boolean;
  /** The ids of the lines that describe the submit. */
  describedBy: string;
}) {
  const reasonId = useId();
  const facts = apiErrorFacts(error);
  return (
    <>
      {reason ? (
        <p className="admin-write-hint workflow-hint" id={reasonId}>
          {reason}
        </p>
      ) : null}
      {error ? (
        isUndeployedRoute(error, UNDEPLOYED_ROUTE_MESSAGE) ? (
          // The list answered and the write did not: a gateway serving one of
          // the routes and not the other. Quiet, as Edit project's own line,
          // and a status so pressing the button answers something.
          <p className="field-note save-failed-note" role="status">
            Workflow changes are not on this gateway yet, so this was not saved.
          </p>
        ) : (
          <ErrorNote live="alert" requestId={facts.requestId} serverWords={facts.message}>
            {refusedSentence}
          </ErrorNote>
        )
      ) : null}
      <div className="workflow-form-actions">
        <button
          aria-disabled={inFlight || undefined}
          className="secondary-button compact-button"
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
        <button
          aria-describedby={[describedBy, reason ? reasonId : ""].filter(Boolean).join(" ") || undefined}
          aria-disabled={inFlight || blocked || undefined}
          className={`primary-button compact-button${blocked && !inFlight ? " is-unavailable" : ""}`}
          ref={register("submit")}
          type="submit"
        >
          {submitLabel}
        </button>
      </div>
    </>
  );
}

/**
 * New workflow (§4.28): a name and the types to move, and nothing else — the
 * statuses and transitions are the shared default's, copied as the list sent
 * them. Only a type that runs on the shared default now is offered: one with a
 * workflow of its own would be refused 409.
 */
function NewWorkflowForm({
  shared,
  served,
  send,
  ...formProps
}: FormProps & {
  shared: ProjectWorkflowEntry;
  served: readonly DictionaryEntry[] | null | undefined;
  send: (sent: WorkflowWrite) => void;
}) {
  const ids = useId();
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  // Re-read against the list on every render, so a type that has left the
  // shared default since the box was ticked is not sent.
  const chosen = shared.issueTypes.filter((code) => picked.includes(code));
  const sharedName = shared.workflow.name.trim() || "the shared workflow";
  const blocked = name.trim() === "" || chosen.length === 0;

  return (
    <form
      aria-labelledby={`${ids}-title`}
      className="workflow-form workflow-new"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (formProps.inFlight || blocked) return;
        const trimmed = name.trim();
        const types = andList(chosen.map((code) => issueTypeLabel(code, served)));
        send({
          kind: "create",
          input: workflowCopyInput(shared.workflow, trimmed, chosen),
          said: {
            done: `Workflow ${trimmed} created for ${types}.`,
            unread: `Workflow ${trimmed} was created, but this list could not be read again. Reopen Workflows to see it.`,
          },
        });
      }}
    >
      <h3 id={`${ids}-title`}>New workflow</h3>
      <div className="workflow-field">
        <label htmlFor={`${ids}-name`}>Name</label>
        <input
          autoFocus
          id={`${ids}-name`}
          maxLength={WORKFLOW_NAME_MAX_LENGTH}
          onChange={(event) => setName(event.target.value)}
          value={name}
        />
      </div>
      <fieldset aria-describedby={`${ids}-copy`} className="workflow-types-field">
        <legend>Issue types</legend>
        <div className="workflow-type-options">
          {shared.issueTypes.map((code) => (
            <label className="workflow-type-option" key={code}>
              <input
                checked={picked.includes(code)}
                onChange={(event) =>
                  setPicked((current) =>
                    event.target.checked ? [...current, code] : current.filter((item) => item !== code),
                  )
                }
                type="checkbox"
              />
              <TypeChip type={code} />
              <span>{issueTypeLabel(code, served)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <p className="workflows-note" id={`${ids}-copy`}>
        Starts as a copy of {sharedName}, so issues of the types you move keep their status.
      </p>
      <FormFoot
        {...formProps}
        blocked={blocked}
        describedBy=""
        reason={null}
        refusedSentence="The workflow was not created."
        submitLabel="Create workflow"
      />
    </form>
  );
}

/**
 * Add status (§4.28). The key follows the name until it is typed in by hand;
 * the category is one the list already carries; the position is a free number
 * between two neighbours, never a renumbering — see `positionOptions`.
 */
function AddStatusForm({
  workflow,
  categories,
  send,
  ...formProps
}: FormProps & {
  workflow: WorkflowDefinition;
  categories: string[];
  send: (sent: WorkflowWrite) => void;
}) {
  const ids = useId();
  const [name, setName] = useState("");
  const [typedKey, setTypedKey] = useState<string | null>(null);
  const [category, setCategory] = useState(() => defaultCategory(categories) ?? "");
  const [pickedPosition, setPickedPosition] = useState<string | null>(null);

  const statuses = statusesInColumnOrder(workflow.statuses);
  const key = (typedKey ?? statusKeyFromName(name)).trim();
  const options = positionOptions(workflow.statuses);
  // Recomputed with the category until the reader picks a position themselves.
  const position = pickedPosition ?? positionValue(defaultPosition(workflow.statuses, category));
  const option = options.find((item) => positionValue(item.position) === position);
  const todo = statuses.find((status) => status.statusKey === "TODO");
  const label = (status: WorkflowStatus) => statusLabel(status.statusKey, workflow.statuses);

  const reason = statuses.some((status) => status.statusKey === key)
    ? `${key} is already a status in this workflow.`
    : key && !STATUS_KEY_PATTERN.test(key)
      ? "A key starts with a letter and has 2–64 capital letters, digits or underscores."
      : null;
  const blocked = name.trim() === "" || key === "" || category === "" || option?.sortOrder == null || reason !== null;

  return (
    <form
      aria-label="Add status"
      className="workflow-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (formProps.inFlight || blocked || option?.sortOrder == null) return;
        const trimmed = name.trim();
        send({
          kind: "status",
          workflowId: workflow.id,
          input: { statusKey: key, name: trimmed, category, sortOrder: option.sortOrder },
          said: {
            done: `Status ${trimmed} added. Add a transition so issues can move into it.`,
            unread: `Status ${trimmed} was added, but this list could not be read again. Reopen Workflows to see it.`,
          },
        });
      }}
    >
      {/* Labels by `htmlFor`, so the note under a field describes it rather
          than becoming part of its name. */}
      <div className="form-two workflow-form-two">
        <div className="workflow-field">
          <label htmlFor={`${ids}-name`}>Name</label>
          <input
            autoFocus
            id={`${ids}-name`}
            maxLength={WORKFLOW_NAME_MAX_LENGTH}
            onChange={(event) => setName(event.target.value)}
            value={name}
          />
        </div>
        <div className="workflow-field">
          <label htmlFor={`${ids}-key`}>Key</label>
          <input
            aria-describedby={`${ids}-key-note`}
            className="mono-input"
            id={`${ids}-key`}
            maxLength={STATUS_KEY_MAX_LENGTH}
            onChange={(event) => setTypedKey(normalizeStatusKey(event.target.value))}
            value={typedKey ?? statusKeyFromName(name)}
          />
          <p className="workflow-field-note" id={`${ids}-key-note`}>
            Capital letters, digits and underscores.
          </p>
        </div>
      </div>
      <div className="workflow-field">
        <span id={`${ids}-category`}>Category</span>
        {/* `aria-pressed`, the product's segmented convention (TAS-299). */}
        <div aria-labelledby={`${ids}-category`} className="segmented fit" role="group">
          {categories.map((code) => (
            <button
              aria-pressed={category === code}
              className={category === code ? "is-active" : ""}
              key={code}
              onClick={() => setCategory(code)}
              type="button"
            >
              {categoryLabel(code)}
            </button>
          ))}
        </div>
      </div>
      <div className="workflow-field">
        <label htmlFor={`${ids}-position`}>Position</label>
        <select
          aria-describedby={position === "start" && todo ? `${ids}-position-note` : undefined}
          id={`${ids}-position`}
          onChange={(event) => setPickedPosition(event.target.value)}
          value={position}
        >
          {options.map((item) => {
            const value = positionValue(item.position);
            const text = item.after ? `After ${label(item.after)}` : "At the start";
            return (
              <option disabled={item.sortOrder === null} key={value} value={value}>
                {item.sortOrder === null ? `${text} (no space left)` : text}
              </option>
            );
          })}
        </select>
        {position === "start" && todo ? (
          <p className="workflow-field-note" id={`${ids}-position-note`}>
            New issues will still start in {label(todo)}.
          </p>
        ) : null}
      </div>
      <p className="workflows-note" id={`${ids}-final`}>
        A status cannot be renamed, moved or removed once added.
      </p>
      <FormFoot
        {...formProps}
        blocked={blocked}
        describedBy={`${ids}-final`}
        reason={reason}
        refusedSentence="The status was not added."
        submitLabel="Add status"
      />
    </form>
  );
}

/**
 * Add transition (§4.28): two statuses and a name. Always visible — there is
 * no hidden flag here, because the board does not offer a hidden transition —
 * and numbered after every transition the list holds, the hidden ones
 * included.
 */
function AddTransitionForm({
  workflow,
  addedStatusIds,
  send,
  ...formProps
}: FormProps & {
  workflow: WorkflowDefinition;
  addedStatusIds: string[];
  send: (sent: WorkflowWrite) => void;
}) {
  const ids = useId();
  const [pair, setPair] = useState(() => defaultTransitionPair(workflow, addedStatusIds));
  const [typedName, setTypedName] = useState<string | null>(null);

  const statuses = statusesInColumnOrder(workflow.statuses);
  const label = (status: WorkflowStatus) => statusLabel(status.statusKey, workflow.statuses);
  const from = statuses.find((status) => status.id === pair.fromStatusId);
  const to = statuses.find((status) => status.id === pair.toStatusId && status.id !== pair.fromStatusId);
  const name = typedName ?? (to ? `Move to ${label(to)}` : "");
  const existing = from && to ? transitionBetween(workflow, from.id, to.id) : undefined;
  const reason = existing && from && to ? `${label(from)} → ${label(to)} already exists as “${existing.name}”.` : null;
  const blocked = !from || !to || name.trim() === "" || reason !== null;

  return (
    <form
      aria-label="Add transition"
      className="workflow-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (formProps.inFlight || blocked || !from || !to) return;
        const trimmed = name.trim();
        send({
          kind: "transition",
          workflowId: workflow.id,
          input: {
            fromStatusKey: from.statusKey,
            toStatusKey: to.statusKey,
            name: trimmed,
            sortOrder: nextTransitionSortOrder(workflow.transitions),
            hidden: false,
          },
          said: {
            done: `Transition ${trimmed} added: ${label(from)} to ${label(to)}.`,
            unread: `Transition ${trimmed} was added, but this list could not be read again. Reopen Workflows to see it.`,
          },
        });
      }}
    >
      <div className="form-two workflow-form-two">
        <div className="workflow-field">
          <label htmlFor={`${ids}-from`}>From</label>
          <select
            autoFocus
            id={`${ids}-from`}
            onChange={(event) => {
              const next = event.target.value;
              setPair((current) => ({
                fromStatusId: next,
                toStatusId: current.toStatusId === next ? firstTargetFrom(workflow, next) : current.toStatusId,
              }));
            }}
            value={from?.id ?? ""}
          >
            {statuses.map((status) => (
              <option key={status.id} value={status.id}>
                {label(status)}
              </option>
            ))}
          </select>
        </div>
        <div className="workflow-field">
          <label htmlFor={`${ids}-to`}>To</label>
          <select
            id={`${ids}-to`}
            onChange={(event) => {
              const next = event.target.value;
              setPair((current) => ({ ...current, toStatusId: next }));
            }}
            value={to?.id ?? ""}
          >
            {statuses
              .filter((status) => status.id !== from?.id)
              .map((status) => (
                <option key={status.id} value={status.id}>
                  {label(status)}
                </option>
              ))}
          </select>
        </div>
      </div>
      <div className="workflow-field">
        <label htmlFor={`${ids}-name`}>Name</label>
        <input
          aria-describedby={`${ids}-name-note`}
          id={`${ids}-name`}
          maxLength={WORKFLOW_NAME_MAX_LENGTH}
          onChange={(event) => setTypedName(event.target.value)}
          value={name}
        />
        <p className="workflow-field-note" id={`${ids}-name-note`}>
          Shown on the move button of an issue.
        </p>
      </div>
      <p className="workflows-note" id={`${ids}-final`}>
        A transition cannot be renamed or removed once added.
      </p>
      <FormFoot
        {...formProps}
        blocked={blocked}
        describedBy={`${ids}-final`}
        reason={reason}
        refusedSentence="The transition was not added."
        submitLabel="Add transition"
      />
    </form>
  );
}

/**
 * §4.28's loading state: one card's frame with §5.6's pulse in it — a name, a
 * "Used by" line and three status rows — rather than a spinner. Hidden from
 * assistive technology; the status line above it says what is happening.
 */
function WorkflowSkeleton() {
  return (
    <div aria-hidden="true" className="workflow-card workflow-skeleton">
      <span className="value-skeleton workflow-skeleton-name" />
      <span className="value-skeleton workflow-skeleton-types" />
      {[0, 1, 2].map((row) => (
        <span className="workflow-skeleton-row" key={row}>
          <span className="value-skeleton workflow-skeleton-dot" />
          <span className="value-skeleton workflow-skeleton-line" />
        </span>
      ))}
    </div>
  );
}
