import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  CreateProjectWorkflowInput,
  DeleteProjectWorkflowInput,
  DeleteWorkflowStatusParams,
  DeleteWorkflowTransitionParams,
  UpdateProjectWorkflowInput,
  UpdateWorkflowStatusInput,
  UpdateWorkflowTransitionInput,
  WorkflowStatusInput,
  WorkflowTransitionInput,
} from "../api/TaskaApi";
import { UNDEPLOYED_ROUTE_MESSAGE } from "../api/TaskaApi";
import { taskaApi } from "../api/client";
import { apiErrorFacts, isUndeployedRoute } from "../api/errors";
import { refusalWords } from "../lib/projectArchive";
import type {
  ProjectIssueType,
  ProjectRole,
  ProjectWorkflowEntry,
  WorkflowDefinition,
  WorkflowDefinitionTransition,
  WorkflowStatus,
} from "../domain/types";
import { useUnanswered } from "../hooks/useUnanswered";
import { issueTypeInSentence, issueTypeLabel, keyBadgeStyle, statusLabel, type IssueTypeRegistry } from "../lib/format";
import { boardKey } from "../lib/boardQuery";
import { projectContextKey } from "../lib/projectContext";
import {
  INITIAL_STATUS_KEY,
  STATUS_KEY_MAX_LENGTH,
  STATUS_KEY_PATTERN,
  WORKFLOW_NAME_MAX_LENGTH,
  andList,
  categoryLabel,
  defaultCategory,
  defaultPosition,
  defaultTransitionPair,
  firstTargetFrom,
  isIssueCountRefusal,
  issueCountOf,
  issueCountWords,
  namedStatusKeys,
  nextTransitionSortOrder,
  normalizeStatusKey,
  orderWorkflowEntries,
  positionOptions,
  positionValue,
  statusCategoriesOf,
  statusEditPositions,
  statusKeyFromName,
  statusesInBoth,
  statusesInColumnOrder,
  statusesToMap,
  transitionBetween,
  transitionButtonLabel,
  transitionEditPositions,
  transitionPositionValue,
  transitionsInListOrder,
  unreachedStatusIds,
  withWorkflowEntry,
  workflowCopyInput,
} from "../lib/workflows";
import { ApiNotice } from "./ApiNotice";
import { ErrorNote } from "./ErrorNote";
import { CategoryDot, TypeChip } from "./IssueBits";
import { Modal } from "./Modal";
import { RequestId } from "./RequestId";
import { WorkflowDiagram } from "./WorkflowDiagram";
import { projectWorkflowsKey, projectWorkflowsOptions } from "./projectWorkflowsQuery";

/**
 * The one form or confirmation a dialog may have open (§4.28: opening another
 * closes this one, draft and all). A delete strip carries the refusal that
 * turned it into its move step, once one has come.
 */
type OpenForm =
  | { kind: "create" }
  | { kind: "status"; workflowId: string }
  | { kind: "transition"; workflowId: string }
  | { kind: "rename"; workflowId: string }
  | { kind: "delete-workflow"; workflowId: string; refusal?: unknown }
  | { kind: "edit-status"; workflowId: string; statusId: string }
  | { kind: "delete-status"; workflowId: string; statusId: string; refusal?: unknown }
  | { kind: "edit-transition"; workflowId: string; transitionId: string }
  | { kind: "delete-transition"; workflowId: string; transitionId: string };

/**
 * What a write is told in, worded when it is sent: once the write has landed
 * the form that knew the names is gone. `done` goes to the dialog's polite
 * region; `unread` heads the notice when the write succeeded and the list
 * could not be read again. `staleIn` — on a write to a workflow that already
 * exists, its name — is what the notice names when the server says the
 * workflow changed meanwhile (`staleSentence`).
 */
interface Said {
  done: string;
  unread: string;
  staleIn?: string;
}

type WorkflowWrite =
  | { kind: "create"; input: CreateProjectWorkflowInput; said: Said }
  | { kind: "status"; workflowId: string; input: WorkflowStatusInput; said: Said }
  | { kind: "transition"; workflowId: string; input: WorkflowTransitionInput; said: Said }
  | { kind: "rename"; workflowId: string; input: UpdateProjectWorkflowInput; said: Said }
  | { kind: "delete-workflow"; workflowId: string; input: DeleteProjectWorkflowInput; said: Said }
  | { kind: "edit-status"; workflowId: string; statusId: string; input: UpdateWorkflowStatusInput; said: Said }
  | { kind: "delete-status"; workflowId: string; statusId: string; params: DeleteWorkflowStatusParams; said: Said }
  | { kind: "edit-transition"; workflowId: string; transitionId: string; input: UpdateWorkflowTransitionInput; said: Said }
  | {
      kind: "delete-transition";
      workflowId: string;
      transitionId: string;
      params: DeleteWorkflowTransitionParams;
      said: Said;
    };

/** The row or card a successful write found by id in its answer or the re-read list, held for two seconds (§4.28). */
type Highlight = { kind: "card" | "status" | "transition"; id: string };

const HIGHLIGHT_MS = 2000;

/**
 * The trigger a form stands in place of, which is where focus goes back to
 * when it closes without a result. Keyed by workflow as well as row: a status
 * id is unique on the server, but nothing here needs to rely on it.
 */
function triggerKey(form: OpenForm | WorkflowWrite): string {
  switch (form.kind) {
    case "create":
      return "trigger:create";
    case "status":
    case "transition":
    case "rename":
    case "delete-workflow":
      return `trigger:${form.kind}:${form.workflowId}`;
    case "edit-status":
    case "delete-status":
      return `trigger:${form.kind}:${form.workflowId}:${form.statusId}`;
    case "edit-transition":
    case "delete-transition":
      return `trigger:${form.kind}:${form.workflowId}:${form.transitionId}`;
  }
}

/** Whether a write is the one the open form sent, so its answer may change that form. */
const isFormOf = (form: OpenForm | null, sent: WorkflowWrite) => form !== null && triggerKey(form) === triggerKey(sent);

/** A 404 or a 409 says the list on screen is not the server's any more, so it is read again (api-contract-guard). */
const isGoneOrTaken = (error: unknown) => {
  const { status, code } = apiErrorFacts(error);
  return status === 404 || status === 409 || code === "NOT_FOUND" || code === "ALREADY_EXISTS";
};

/**
 * A write to something that exists refused because it no longer stands as
 * the dialog shows it: the workflow's `version` moved on (409 `ABORTED` —
 * never told apart from `ALREADY_EXISTS` by status or message, only by code),
 * or the row or the workflow is gone (404). The gateway's static-resource 404
 * is not this: it is a route not deployed, said in the form.
 */
const isStale = (error: unknown) => {
  const { status, code } = apiErrorFacts(error);
  if (isUndeployedRoute(error, UNDEPLOYED_ROUTE_MESSAGE)) return false;
  return code === "ABORTED" || code === "NOT_FOUND" || status === 404;
};

/**
 * The `version` an edit sends: the one of the workflow on screen, so the
 * server refuses the edit if anybody changed it since. A workflow that came
 * without one (the API layer's 0) sends none rather than a number the
 * gateway's `minimum: 1` would refuse.
 */
const versionOf = (workflow: WorkflowDefinition) => (workflow.version >= 1 ? workflow.version : undefined);

/** The id of what an add or a create made, found in its answer (§4.28). */
function madeId(answer: ProjectWorkflowEntry, sent: WorkflowWrite): string | null {
  const workflow = answer.workflow;
  if (sent.kind === "create") return workflow.id || null;
  const idOf = (key: string) => workflow.statuses.find((status) => status.statusKey === key)?.id;
  if (sent.kind === "status") return idOf(sent.input.statusKey) ?? null;
  if (sent.kind !== "transition") return null;
  const [from, to] = [idOf(sent.input.fromStatusKey), idOf(sent.input.toStatusKey)];
  return workflow.transitions.find((transition) => transition.fromStatusId === from && transition.toStatusId === to)?.id ?? null;
}

/** What a write's success lights for two seconds — one highlight per write, none for a removed row. */
function highlightOf(answer: ProjectWorkflowEntry, sent: WorkflowWrite): Highlight | null {
  switch (sent.kind) {
    case "create": {
      const id = madeId(answer, sent);
      return id ? { kind: "card", id } : null;
    }
    case "status":
    case "transition": {
      const id = madeId(answer, sent);
      return id ? { kind: sent.kind, id } : null;
    }
    case "rename":
      return { kind: "card", id: sent.workflowId };
    // The shared card that took the deleted workflow's types back.
    case "delete-workflow":
      return answer.workflow.id ? { kind: "card", id: answer.workflow.id } : null;
    case "edit-status":
      return { kind: "status", id: sent.statusId };
    case "edit-transition":
      return { kind: "transition", id: sent.transitionId };
    default:
      return null;
  }
}

/**
 * Where focus goes after a write lands, first match wins. A new status is a
 * column nothing can reach yet, so its next step is its card's Add
 * transition; an edit goes back to the control that opened it; a removed row
 * hands focus to its list's Add trigger, which is always there below it.
 */
function focusAfter(answer: ProjectWorkflowEntry, sent: WorkflowWrite): string[] {
  switch (sent.kind) {
    case "create": {
      const id = madeId(answer, sent);
      return id ? [`heading:${id}`, "trigger:create"] : ["trigger:create"];
    }
    case "status":
    case "transition":
      return [`trigger:transition:${sent.workflowId}`];
    case "delete-status":
      return [`trigger:status:${sent.workflowId}`];
    case "delete-transition":
      return [`trigger:transition:${sent.workflowId}`];
    case "delete-workflow":
      return [`heading:${answer.workflow.id}`, "trigger:create", "notice"];
    default:
      return [triggerKey(sent)];
  }
}

/** Whether what a form or a strip is about is still on screen; one whose row went with a re-read is closed. */
function formTargetExists(form: OpenForm, entries: readonly ProjectWorkflowEntry[]): boolean {
  if (form.kind === "create") return true;
  const workflow = entries.find((entry) => entry.workflow.id === form.workflowId)?.workflow;
  if (!workflow) return false;
  if (form.kind === "edit-status" || form.kind === "delete-status") {
    return workflow.statuses.some((status) => status.id === form.statusId);
  }
  if (form.kind === "edit-transition" || form.kind === "delete-transition") {
    return workflow.transitions.some((transition) => transition.id === form.transitionId);
  }
  return true;
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
   * presentation only — the server refuses every write for anybody else.
   */
  readerRole: ProjectRole | null | undefined;
  /**
   * The project is archived (backend PR #159, DESIGN.md §5.7): the cards and
   * diagrams stay, every form, strip and trigger goes for every role, and one
   * line says why in place of the role's.
   */
  archived?: boolean;
  /**
   * The project's issue-type registry off the board's context (TAS-417), or
   * `undefined` before it has answered: the names, the chips and the order of
   * the project's own cards — and nothing read for them here.
   */
  issueTypes: readonly ProjectIssueType[] | undefined;
  onClose: () => void;
}

/**
 * The project's workflows (TAS-382, TAS-416, DESIGN.md §4.28, backend PRs #208
 * and #225): every workflow its issue types run on, each once, with its
 * statuses and every transition — the hidden ones the board never offers
 * included — and for an ADMIN, on the project's own workflows, every write the
 * server has: a new workflow, renamed or deleted; a status added, changed,
 * moved or deleted; a transition added, renamed, moved, hidden or deleted.
 *
 * **Every reader can open it**; the list is the board's own configuration and
 * no secret. The shared default is read-only for everybody — the server
 * refuses a write to it — so its card carries no control at all.
 *
 * **A new workflow is a verbatim copy of the shared default**, not editable
 * before it is sent (docs/ai/API-DIVERGENCE.md); it is edited afterwards, one
 * row at a time, and every edit is re-validated whole on the server, which
 * keeps a `TODO` status and a visible transition in every workflow.
 *
 * **Every edit sends the version on screen.** A refusal for a version that
 * moved on (409 `ABORTED`) — or for a row that is gone — closes the form, reads
 * the list again and says so in one notice; nothing is retried by itself.
 *
 * **No write is optimistic**, deliberately against §1's rule (§4.28 "В
 * полёте"): each one changes the board of every member, and a rollback would
 * take a row back out and reopen the form in front of the reader. The form
 * stays in flight until the answer is on screen — an edit's own answer, which
 * is the whole workflow since backend PR #225, or the re-read list after a
 * create or a workflow delete, which move types on or off the shared default.
 * The context is invalidated at the same moment and not waited for — the board
 * under the scrim takes its new columns and moves from it and reports its own
 * failures.
 */
export function ProjectWorkflowsModal({
  projectId,
  projectKey,
  projectColor,
  readerRole,
  archived = false,
  issueTypes: registry,
  onClose,
}: ProjectWorkflowsModalProps) {
  const queryClient = useQueryClient();
  const workflowsQuery = useQuery(projectWorkflowsOptions(projectId));
  const unread = useUnanswered(workflowsQuery);
  const undeployed = unread.unanswered && isUndeployedRoute(unread.error, UNDEPLOYED_ROUTE_MESSAGE);
  const listed = workflowsQuery.data;
  const entries = useMemo(
    () => orderWorkflowEntries(listed ?? [], (registry ?? []).map((entry) => entry.code)),
    [listed, registry],
  );
  const categories = useMemo(() => statusCategoriesOf(listed ?? []), [listed]);
  const shared = entries.find((entry) => entry.shared);
  const isAdmin = readerRole === "ADMIN" && !archived;
  const canCreate = isAdmin && Boolean(shared?.issueTypes.length);

  const [openedForm, setForm] = useState<OpenForm | null>(null);
  // A form whose row went with a re-read is not drawn, so it is not open.
  const form = openedForm && formTargetExists(openedForm, entries) ? openedForm : null;
  const [highlight, setHighlight] = useState<Highlight | null>(null);
  const [announcement, setAnnouncement] = useState("");
  /**
   * The one notice over the cards about a write: one that landed and whose
   * re-read failed, or one refused because the workflow had changed elsewhere
   * and was read again.
   */
  const [notice, setNotice] = useState<{ sentence: string; error: unknown } | null>(null);
  /** Statuses this dialog added, so Add transition can offer the one nothing leads to yet. */
  const [addedStatusIds, setAddedStatusIds] = useState<string[]>([]);

  /**
   * Where focus goes after the next render — a form's trigger once it closes,
   * the new card's heading, the submit after a refusal — the first of these
   * keys that names a node. Looked up among the nodes registered below,
   * because the node a write lands on is drawn by its answer.
   */
  const pendingFocus = useRef<string[] | null>(null);
  const focusables = useRef(new Map<string, HTMLElement>());
  const register = (key: string) => (node: HTMLElement | null) => {
    if (node) focusables.current.set(key, node);
    else focusables.current.delete(key);
  };
  useEffect(() => {
    const keys = pendingFocus.current;
    if (!keys) return;
    pendingFocus.current = null;
    const node = keys.map((key) => focusables.current.get(key)).find(Boolean);
    if (node) focusInBody(node);
  });

  useEffect(() => {
    if (!highlight) return;
    const timer = window.setTimeout(() => setHighlight(null), HIGHLIGHT_MS);
    return () => window.clearTimeout(timer);
  }, [highlight]);

  const listKey = projectWorkflowsKey(projectId);
  /** The list read again, and whether that read failed. */
  const reread = async () => {
    const asked = Date.now();
    await queryClient.invalidateQueries({ queryKey: listKey });
    const state = queryClient.getQueryState(listKey);
    return { failed: state?.status === "error" && state.errorUpdatedAt >= asked, error: state?.error };
  };

  const write = useMutation({
    mutationFn: (sent: WorkflowWrite): Promise<ProjectWorkflowEntry> => {
      switch (sent.kind) {
        case "create":
          return taskaApi.createProjectWorkflow(projectId, sent.input);
        case "status":
          return taskaApi.addWorkflowStatus(projectId, sent.workflowId, sent.input);
        case "transition":
          return taskaApi.addWorkflowTransition(projectId, sent.workflowId, sent.input);
        case "rename":
          return taskaApi.updateProjectWorkflow(projectId, sent.workflowId, sent.input);
        case "delete-workflow":
          return taskaApi.deleteProjectWorkflow(projectId, sent.workflowId, sent.input);
        case "edit-status":
          return taskaApi.updateWorkflowStatus(projectId, sent.workflowId, sent.statusId, sent.input);
        case "delete-status":
          return taskaApi.deleteWorkflowStatus(projectId, sent.workflowId, sent.statusId, sent.params);
        case "edit-transition":
          return taskaApi.updateWorkflowTransition(projectId, sent.workflowId, sent.transitionId, sent.input);
        case "delete-transition":
          return taskaApi.deleteWorkflowTransition(projectId, sent.workflowId, sent.transitionId, sent.params);
      }
    },
    // Awaited by the mutation, so a stale write stays in flight until the list
    // it is reloaded into has answered.
    onError: async (error, sent) => {
      if (sent.kind !== "create" && sent.said.staleIn !== undefined && isStale(error)) {
        // The form was drawn from a workflow the server no longer has: close
        // it, read the list again, and say what happened once, in the
        // server's words with its request id. The draft goes with the form —
        // kept, it would be checked against rows that may be gone.
        // The board read the same workflow, so it is read again too, as after a success.
        void queryClient.invalidateQueries({ queryKey: projectContextKey(projectId) });
        void queryClient.invalidateQueries({ queryKey: boardKey(projectId) });
        const { failed } = await reread();
        setForm(null);
        setNotice({ sentence: staleSentence(sent.said.staleIn, failed), error });
        pendingFocus.current = [`heading:${sent.workflowId}`, "notice"];
        return;
      }
      if (isGoneOrTaken(error)) void queryClient.invalidateQueries({ queryKey: listKey });
      if ((sent.kind === "delete-status" || sent.kind === "delete-workflow") && isIssueCountRefusal(error)) {
        // The strip becomes its move step, which says the refusal itself.
        setForm((current) => (current && isFormOf(current, sent) ? { ...current, refusal: error } : current));
        // Its first field — or, with nowhere to move the issues and so no
        // answer, its Cancel.
        pendingFocus.current = ["step", "submit", "cancel"];
        return;
      }
      pendingFocus.current = ["submit"];
    },
    // Mutation-level, so it runs to the end after the dialog has closed: Close
    // and the scrim stay usable in flight and cancel neither the write nor the
    // re-read (§4.28). The returned promise is what keeps the form in flight
    // until the answer is on screen.
    onSuccess: async (answer, sent) => {
      void queryClient.invalidateQueries({ queryKey: projectContextKey(projectId) });
      // The board's columns and its «Outside their workflow» group come from
      // the workflows too, so the board is read again with the context (TAS-202).
      void queryClient.invalidateQueries({ queryKey: boardKey(projectId) });

      // An edit answers the whole workflow, and that is what is drawn. A create
      // and a workflow delete also move types on or off the shared default,
      // which their answer does not describe: the list is read again for those.
      let placed = false;
      if (sent.kind !== "create" && sent.kind !== "delete-workflow") {
        await queryClient.cancelQueries({ queryKey: listKey });
        const current = queryClient.getQueryData<ProjectWorkflowEntry[]>(listKey);
        const next = current ? withWorkflowEntry(current, answer) : null;
        if (next) {
          queryClient.setQueryData(listKey, next);
          placed = true;
        }
      }
      const unreadAfter = placed ? null : await reread();

      setForm(null);
      if (sent.kind === "status") {
        const id = madeId(answer, sent);
        if (id) setAddedStatusIds((current) => [...current, id]);
      }
      if (unreadAfter?.failed) {
        // A 2xx is what happened, so never "was not added" (§4.28): the notice
        // says the write landed and the list could not show it. The polite
        // region stays quiet — the notice is the one announcement — and
        // nothing is highlighted, because nothing new is drawn.
        setNotice({ sentence: sent.said.unread, error: unreadAfter.error });
        pendingFocus.current = [triggerKey(sent), "notice"];
        return;
      }
      setNotice(null);
      setAnnouncement(sent.said.done);
      setHighlight(highlightOf(answer, sent));
      pendingFocus.current = focusAfter(answer, sent);
    },
  });
  const inFlight = write.isPending;

  const openForm = (next: OpenForm) => {
    if (inFlight) return;
    write.reset();
    setNotice(null);
    setForm(next);
  };
  const closeForm = () => {
    if (inFlight || !form) return;
    write.reset();
    pendingFocus.current = [triggerKey(form)];
    setForm(null);
  };
  const send = (sent: WorkflowWrite) => {
    if (inFlight) return;
    setAnnouncement("");
    write.mutate(sent);
  };

  /**
   * This dialog's inner layer of §4.11's `Esc` (TAS-397): an open form or
   * strip closes, focus back on the control that opened it, and the dialog
   * stays — unless its write is out, when `Esc` does nothing at all, since it
   * must not look like it cancelled a write that is still going (`Modal`'s
   * `busy` holds the dialog then). With nothing open the key is left to
   * `Modal`, which closes the dialog — on `window`, after this `document`
   * listener has had it.
   */
  const onEscape = useRef((_event: KeyboardEvent) => {});
  useEffect(() => {
    onEscape.current = (event) => {
      if (!form || inFlight) return;
      event.preventDefault();
      closeForm();
    };
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      onEscape.current(event);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const badge = keyBadgeStyle(projectKey, projectColor);
  const readOnlyReader = archived || readerRole === "MEMBER" || readerRole === "VIEWER" || readerRole === null;
  /** The refusal of the open form's write, if the last write was this form's. */
  const formError = write.isError && form && write.variables && isFormOf(form, write.variables) ? write.error : null;

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
      busy={inFlight}
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
        {archived ? (
          // Every role, ADMIN included, and in place of the role's line (§5.7).
          // `tabIndex=-1`: where the board puts focus if the archive took the
          // control that had it — focus never leaves an open dialog.
          <p className="workflows-note" data-archive-note="modal" tabIndex={-1}>
            This project is archived, so its workflows cannot be changed.
          </p>
        ) : readerRole === "MEMBER" || readerRole === "VIEWER" ? (
          <p className="workflows-note">Only a project admin can change workflows.</p>
        ) : readerRole === null ? (
          <p className="workflows-note">Your role on this project is unknown, so workflows cannot be changed here.</p>
        ) : null}

        {isAdmin && listed && listed.length > 0 ? (
          canCreate && shared ? (
            form?.kind === "create" ? (
              <NewWorkflowForm {...formProps} registry={registry} shared={shared} send={send} />
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

        {notice ? <WriteNotice error={notice.error} register={register} sentence={notice.sentence} /> : null}

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
                  registry={registry}
                  shared={shared}
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

/**
 * The notice over the cards about a write (`notice`), in a box focus can land
 * on from script when the card it is about has gone — never a Tab stop.
 */
function WriteNotice({ sentence, error, register }: { sentence: string; error: unknown; register: Register }) {
  return (
    <div className="workflows-notice" ref={register("notice")} tabIndex={-1}>
      <ApiNotice error={error} live="polite">
        {sentence}
      </ApiNotice>
    </div>
  );
}

/** What every form gets from the dialog: the write's state, the way out, and where its submit is filed. */
interface FormProps {
  inFlight: boolean;
  error: Error | null;
  onCancel: () => void;
  register: Register;
}

/** What a card's rows need to open their own forms and strips. */
interface RowControls {
  form: OpenForm | null;
  inFlight: boolean;
  register: Register;
  onOpenForm: (form: OpenForm) => void;
}

function WorkflowCard({
  entry,
  shared,
  categories,
  addedStatusIds,
  isAdmin,
  inFlight,
  form,
  formProps,
  highlight,
  registry,
  register,
  onOpenForm,
  send,
}: {
  entry: ProjectWorkflowEntry;
  /** The shared default's entry, which a delete sends this workflow's types back to. */
  shared: ProjectWorkflowEntry | undefined;
  categories: string[];
  addedStatusIds: string[];
  isAdmin: boolean;
  inFlight: boolean;
  form: OpenForm | null;
  formProps: FormProps;
  highlight: Highlight | null;
  registry: IssueTypeRegistry;
  register: Register;
  onOpenForm: (form: OpenForm) => void;
  send: (sent: WorkflowWrite) => void;
}) {
  const headingId = useId();
  const ids = useId();
  const { workflow, issueTypes } = entry;
  const name = workflow.name.trim() || "Unnamed workflow";
  const statuses = statusesInColumnOrder(workflow.statuses);
  const transitions = transitionsInListOrder(workflow);
  const unreached = unreachedStatusIds(workflow);
  const hasTodo = statuses.some((status) => status.statusKey === INITIAL_STATUS_KEY);
  const label = (status: WorkflowStatus) => statusLabel(status.statusKey, workflow.statuses);
  const statusName = (statusId: string) => {
    const status = workflow.statuses.find((item) => item.id === statusId);
    return status ? label(status) : null;
  };
  // Only a workflow of the project's own, and only for its ADMIN: the shared
  // default answers every write 400 `FAILED_PRECONDITION`, which is not a
  // conflict and is not offered to be had (§4.28, §5.7).
  const editable = isAdmin && !entry.shared;
  const formHere = editable && form && form.kind !== "create" && form.workflowId === workflow.id ? form : null;
  const lit = (kind: Highlight["kind"], id: string) => highlight?.kind === kind && highlight.id === id;
  const controls: RowControls = { form: formHere, inFlight, register, onOpenForm };
  const typesInWords = andList(issueTypes.map((code) => issueTypeLabel(code, registry)));
  const sharedName = shared?.workflow.name.trim() || "the shared workflow";
  const deleteStripId = `${ids}-delete`;
  const renaming = formHere?.kind === "rename";

  return (
    <section
      aria-label={renaming ? name : undefined}
      aria-labelledby={renaming ? undefined : headingId}
      className={`workflow-card${lit("card", workflow.id) ? " is-highlighted" : ""}`}
    >
      {renaming ? (
        <RenameWorkflowForm {...formProps} name={name} send={send} workflow={workflow} />
      ) : (
        <div className="workflow-card-head">
          {/* Focusable only from script: where focus lands when this card is new. */}
          <h3 id={headingId} ref={register(`heading:${workflow.id}`)} tabIndex={-1}>
            {name}
          </h3>
          {entry.shared ? <span className="workflow-marker">shared</span> : null}
          {editable ? (
            <span className="workflow-row-actions workflow-card-actions">
              <RowAction
                focusKey={`trigger:rename:${workflow.id}`}
                icon={<Pencil size={14} />}
                inFlight={inFlight}
                label={`Rename ${name}`}
                onClick={() => onOpenForm({ kind: "rename", workflowId: workflow.id })}
                register={register}
                title="Rename"
              />
              <RowAction
                controls={formHere?.kind === "delete-workflow" ? deleteStripId : undefined}
                destructive
                expanded={formHere?.kind === "delete-workflow"}
                focusKey={`trigger:delete-workflow:${workflow.id}`}
                icon={<Trash2 size={14} />}
                inFlight={inFlight}
                label={`Delete ${name}`}
                onClick={() => onOpenForm({ kind: "delete-workflow", workflowId: workflow.id })}
                register={register}
                title="Delete"
              />
            </span>
          ) : null}
        </div>
      )}
      {formHere?.kind === "delete-workflow" ? (
        <DeleteWorkflowStrip
          {...formProps}
          id={deleteStripId}
          name={name}
          refusal={formHere.refusal}
          send={send}
          shared={shared?.workflow}
          sharedName={sharedName}
          typeCount={issueTypes.length}
          typesInWords={typesInWords}
          workflow={workflow}
        />
      ) : null}

      <div className="workflow-types">
        <span className="workflow-types-label">Used by</span>
        {issueTypes.length ? (
          // As the server sent them, not narrowed to the types the board
          // offers: the list may name one the project does not allow
          // (docs/ai/BACKLOG.md), and hiding it would misstate the binding.
          <ul className="workflow-type-list">
            {issueTypes.map((code) => (
              <li className="workflow-type" key={code}>
                <TypeChip registry={registry} type={code} />
                <span>{issueTypeLabel(code, registry)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <span className="workflow-types-none">No issue type uses it.</span>
        )}
      </div>

      {entry.shared ? (
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
            <StatusRow
              categories={categories}
              controls={controls}
              editable={editable}
              formProps={formProps}
              key={status.id}
              label={label(status)}
              lit={lit("status", status.id)}
              send={send}
              status={status}
              unreached={unreached.has(status.id)}
              workflow={workflow}
              workflowName={name}
            />
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
            issueTypes.length ? `${andList(issueTypes.map((code) => issueTypeInSentence(code, registry)))} ` : ""
          }issues will land outside their workflow on the board.`}
        </p>
      ) : null}
      {editable ? (
        formHere?.kind === "status" ? (
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
          {transitions.map((transition) => (
            <TransitionRow
              controls={controls}
              editable={editable}
              formProps={formProps}
              from={statusName(transition.fromStatusId)}
              key={transition.id}
              lit={lit("transition", transition.id)}
              send={send}
              to={statusName(transition.toStatusId)}
              transition={transition}
              workflow={workflow}
              workflowName={name}
            />
          ))}
        </ul>
      ) : (
        <p className="workflows-note">No transitions yet, so issues cannot move between these statuses.</p>
      )}
      {transitions.some((transition) => transition.hidden) ? (
        <p className="workflows-note">Hidden transitions are not offered on the board.</p>
      ) : null}
      {editable ? (
        formHere?.kind === "transition" ? (
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

/**
 * The notice a stale write is reported in (`isStale`): what happened, that
 * nothing went through, and whether the list on screen is the server's now.
 */
const staleSentence = (workflowName: string, rereadFailed: boolean) =>
  rereadFailed
    ? `${workflowName} was changed elsewhere, so nothing was saved, and this list could not be read again. Reopen Workflows to see it.`
    : `${workflowName} was changed elsewhere, so it has been reloaded. Nothing was saved.`;

/**
 * One status: its line — and, for an ADMIN on a workflow of the project's own,
 * Edit and Delete — or the Edit status form in the line's place, or the line
 * with its delete strip under it. `TODO` offers no Delete: the server never
 * deletes it (§4.1's last-admin precedent: the control is absent, a slot holds
 * its place, a line says why).
 */
function StatusRow({
  status,
  label,
  workflow,
  workflowName,
  categories,
  unreached,
  lit,
  editable,
  controls,
  formProps,
  send,
}: {
  status: WorkflowStatus;
  label: string;
  workflow: WorkflowDefinition;
  workflowName: string;
  categories: string[];
  unreached: boolean;
  lit: boolean;
  editable: boolean;
  controls: RowControls;
  formProps: FormProps;
  send: (sent: WorkflowWrite) => void;
}) {
  const stripId = useId();
  const { form, inFlight, register, onOpenForm } = controls;
  const editing = form?.kind === "edit-status" && form.statusId === status.id ? form : null;
  const deleting = form?.kind === "delete-status" && form.statusId === status.id ? form : null;
  const initial = status.statusKey === INITIAL_STATUS_KEY;

  return (
    <li className={`workflow-status${lit ? " is-highlighted" : ""}`}>
      {editing ? (
        <EditStatusForm
          {...formProps}
          categories={categories}
          label={label}
          send={send}
          status={status}
          workflow={workflow}
          workflowName={workflowName}
        />
      ) : (
        <>
          <div className="workflow-status-line">
            <CategoryDot category={status.category} />
            <span className="workflow-status-name">{label}</span>
            <span className="workflow-status-key" title={status.statusKey}>
              {status.statusKey}
            </span>
            <span className="workflow-status-category">{categoryLabel(status.category)}</span>
            {editable ? (
              <span className="workflow-row-actions">
                <RowAction
                  focusKey={`trigger:edit-status:${workflow.id}:${status.id}`}
                  icon={<Pencil size={14} />}
                  inFlight={inFlight}
                  label={`Edit ${label}`}
                  onClick={() => onOpenForm({ kind: "edit-status", workflowId: workflow.id, statusId: status.id })}
                  register={register}
                  title="Edit"
                />
                {initial ? (
                  // Where Delete would be, so the Edit buttons stay in one column.
                  <span aria-hidden="true" className="workflow-row-action-slot" />
                ) : (
                  <RowAction
                    controls={deleting ? stripId : undefined}
                    destructive
                    expanded={Boolean(deleting)}
                    focusKey={`trigger:delete-status:${workflow.id}:${status.id}`}
                    icon={<Trash2 size={14} />}
                    inFlight={inFlight}
                    label={`Delete ${label}`}
                    onClick={() => onOpenForm({ kind: "delete-status", workflowId: workflow.id, statusId: status.id })}
                    register={register}
                    title="Delete"
                  />
                )}
              </span>
            ) : null}
          </div>
          {unreached ? <p className="workflow-status-note">No transition on the board leads here.</p> : null}
          {editable && initial ? (
            <p className="workflow-status-note">New issues start here, so it cannot be deleted.</p>
          ) : null}
        </>
      )}
      {deleting ? (
        <DeleteStatusStrip
          {...formProps}
          id={stripId}
          label={label}
          refusal={deleting.refusal}
          send={send}
          status={status}
          workflow={workflow}
          workflowName={workflowName}
        />
      ) : null}
    </li>
  );
}

/**
 * One transition: "{From} → {To}", its name, `hidden` — and, for an ADMIN on a
 * workflow of the project's own, Edit and Delete — or the Edit transition form
 * in its place, or the row with its delete strip under it.
 */
function TransitionRow({
  transition,
  from,
  to,
  workflow,
  workflowName,
  lit,
  editable,
  controls,
  formProps,
  send,
}: {
  transition: WorkflowDefinitionTransition;
  from: string | null;
  to: string | null;
  workflow: WorkflowDefinition;
  workflowName: string;
  lit: boolean;
  editable: boolean;
  controls: RowControls;
  formProps: FormProps;
  send: (sent: WorkflowWrite) => void;
}) {
  const stripId = useId();
  const { form, inFlight, register, onOpenForm } = controls;
  const editing = form?.kind === "edit-transition" && form.transitionId === transition.id ? form : null;
  const deleting = form?.kind === "delete-transition" && form.transitionId === transition.id ? form : null;
  // The words on the issue's move button (§4.1): an unnamed transition is
  // drawn there as "Move to {To}", so it is here too.
  const shown = transitionButtonLabel(transition.name, to ?? "Unknown status").text;
  const pairInWords = `${from ?? "Unknown status"} to ${to ?? "Unknown status"}`;

  return (
    <li className={`workflow-transition${lit ? " is-highlighted" : ""}${editing ? " is-editing" : ""}`}>
      {editing ? (
        <EditTransitionForm
          {...formProps}
          from={from}
          pairInWords={pairInWords}
          send={send}
          to={to}
          transition={transition}
          workflow={workflow}
          workflowName={workflowName}
        />
      ) : (
        <>
          <TransitionPair from={from} to={to} />
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
          {editable ? (
            <span className="workflow-row-actions">
              <RowAction
                focusKey={`trigger:edit-transition:${workflow.id}:${transition.id}`}
                icon={<Pencil size={14} />}
                inFlight={inFlight}
                label={`Edit ${pairInWords}`}
                onClick={() =>
                  onOpenForm({ kind: "edit-transition", workflowId: workflow.id, transitionId: transition.id })
                }
                register={register}
                title="Edit"
              />
              <RowAction
                controls={deleting ? stripId : undefined}
                destructive
                expanded={Boolean(deleting)}
                focusKey={`trigger:delete-transition:${workflow.id}:${transition.id}`}
                icon={<Trash2 size={14} />}
                inFlight={inFlight}
                label={`Delete ${pairInWords}`}
                onClick={() =>
                  onOpenForm({ kind: "delete-transition", workflowId: workflow.id, transitionId: transition.id })
                }
                register={register}
                title="Delete"
              />
            </span>
          ) : null}
        </>
      )}
      {deleting ? (
        <ConfirmStrip
          {...formProps}
          answerLabel="Delete transition"
          id={stripId}
          onAnswer={() =>
            send({
              kind: "delete-transition",
              workflowId: workflow.id,
              transitionId: transition.id,
              params: { version: versionOf(workflow) },
              said: {
                done: `Transition ${pairInWords} deleted.`,
                unread: `Transition ${pairInWords} was deleted, but this list could not be read again. Reopen Workflows to see it.`,
                staleIn: workflowName,
              },
            })
          }
          refusedSentence="The transition was not deleted."
          sentence={
            <>
              Delete {from ?? "Unknown status"}
              <span aria-hidden="true"> → </span>
              <span className="visually-hidden"> to </span>
              {to ?? "Unknown status"}?
            </>
          }
        />
      ) : null}
    </li>
  );
}

/** "{From} → {To}", read "{From} to {To}". */
function TransitionPair({ from, to }: { from: string | null; to: string | null }) {
  return (
    <span className="workflow-transition-pair">
      <StatusWord name={from} />
      <span aria-hidden="true" className="arrow">
        →
      </span>
      <span className="visually-hidden"> to </span>
      <StatusWord name={to} />
    </span>
  );
}

/** A status named in a transition row, or "Unknown status" for an id the workflow does not list — the row stays. */
function StatusWord({ name }: { name: string | null }) {
  return name === null ? <span className="workflow-status-unknown">Unknown status</span> : <span>{name}</span>;
}

/**
 * Edit or Delete on a row or a card head: a ghost icon button with §1's 28×28
 * (§4.1, as the Labels rows), named for what it acts on, `title` the verb.
 * Delete is §4.1's destructive ghost — `--danger` only under the pointer and
 * while its question is open (`aria-expanded`), as Members' remove. While a
 * write is out it is `aria-disabled` and answers nothing (§4.1, in flight).
 */
function RowAction({
  label,
  title,
  icon,
  onClick,
  inFlight,
  focusKey,
  register,
  destructive = false,
  expanded,
  controls,
}: {
  label: string;
  title: string;
  icon: ReactNode;
  onClick: () => void;
  inFlight: boolean;
  focusKey: string;
  register: Register;
  destructive?: boolean;
  expanded?: boolean;
  controls?: string;
}) {
  return (
    <button
      aria-controls={controls}
      aria-disabled={inFlight || undefined}
      aria-expanded={destructive ? Boolean(expanded) : undefined}
      aria-label={label}
      className={`icon-button workflow-row-action${destructive ? " is-destructive" : ""}`}
      onClick={() => {
        if (!inFlight) onClick();
      }}
      ref={register(focusKey)}
      title={title}
      type="button"
    >
      {icon}
    </button>
  );
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
 * A refusal of the open form's or strip's write: the gateway that serves the
 * list and not this route says so quietly; anything else is `ErrorNote` with
 * the dialog's sentence, the server's words and the request id (§4.28).
 */
function WriteRefusal({ error, refusedSentence }: { error: Error; refusedSentence: string }) {
  const facts = apiErrorFacts(error);
  return isUndeployedRoute(error, UNDEPLOYED_ROUTE_MESSAGE) ? (
    // The list answered and the write did not: a gateway serving one of
    // the routes and not the other. Quiet, as Edit project's own line,
    // and a status so pressing the button answers something.
    <p className="field-note save-failed-note" role="status">
      Workflow changes are not on this gateway yet, so this was not saved.
    </p>
  ) : (
    <ErrorNote live="alert" requestId={facts.requestId} serverWords={refusalWords(error)}>
      {refusedSentence}
    </ErrorNote>
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
  return (
    <>
      {reason ? (
        <p className="admin-write-hint workflow-hint" id={reasonId}>
          {reason}
        </p>
      ) : null}
      {error ? <WriteRefusal error={error} refusedSentence={refusedSentence} /> : null}
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
 * A row form or a strip opened below the fold is brought into the body's view
 * once, on opening — the whole box, so its Save or its answer is on screen
 * (art-director, TAS-416) — as §4.22 brings its notice: `nearest`, no
 * `behavior`, so reduced motion has nothing to take away.
 */
function useRevealOnOpen<T extends HTMLElement>() {
  const box = useRef<T>(null);
  useEffect(() => {
    box.current?.scrollIntoView({ block: "nearest" });
  }, []);
  return box;
}

/**
 * §4.22's confirmation strip, in a card: the question, Cancel first and
 * focused, and the answer edged in `--danger`. A delete refused for the issues
 * it would leave behind becomes a step in the same strip (`step`): its own
 * sentence, said as an alert, then the fields that move the issues and the
 * answer that sends them. A step is a question, so it does not print the
 * server's words, which instruct an API client (art-director, TAS-416) —
 * except a step with nowhere to move the issues and so no answer, which reads
 * sentence, why, then the server's words and the request id, then Cancel.
 * Any other refusal is said above the actions, as a form's is.
 */
function ConfirmStrip({
  id,
  sentence,
  answerLabel,
  onAnswer,
  refusedSentence,
  step,
  inFlight,
  error,
  onCancel,
  register,
}: FormProps & {
  id: string;
  sentence: ReactNode;
  answerLabel: string;
  /** Leaves the answer out when there is nothing it could send. */
  onAnswer: (() => void) | null;
  refusedSentence: string;
  step?: {
    refusal: unknown;
    sentence: string;
    fields: ReactNode;
    /** A field still empty: the answer is steadily unavailable, with no sentence (§4.28). */
    blocked: boolean;
  };
}) {
  const sentenceId = `${id}-sentence`;
  const box = useRevealOnOpen<HTMLDivElement>();
  // Only a step with no answer prints the refusal it came from.
  const deadEnd = step && !onAnswer ? step : null;
  const stepFacts = deadEnd ? apiErrorFacts(deadEnd.refusal) : null;
  const stepWords = deadEnd ? refusalWords(deadEnd.refusal) : null;
  const blocked = step?.blocked ?? false;
  // The step says its refusal itself; only a later one of another kind is said again.
  const otherError = error && (!step || error !== step.refusal) ? error : null;

  return (
    <div className={`member-confirm workflow-confirm${step ? " is-step" : ""}`} id={id} ref={box}>
      {step ? (
        <div className="workflow-confirm-step">
          <p className="member-confirm-sentence" id={sentenceId} role="alert">
            {step.sentence}
          </p>
          {step.fields}
          {stepWords || stepFacts?.requestId ? (
            <p className="error-note-detail workflow-confirm-detail">
              {stepWords ? <span>{stepWords}</span> : null}
              {stepFacts?.requestId ? <RequestId value={stepFacts.requestId} /> : null}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="member-confirm-sentence" id={sentenceId}>
          {sentence}
        </p>
      )}
      {otherError ? (
        <div className="workflow-confirm-refusal">
          <WriteRefusal error={otherError} refusedSentence={refusedSentence} />
        </div>
      ) : null}
      <div className="member-confirm-actions">
        <button
          aria-disabled={inFlight || undefined}
          autoFocus={!step}
          className="secondary-button compact-button"
          onClick={onCancel}
          ref={register("cancel")}
          type="button"
        >
          Cancel
        </button>
        {onAnswer ? (
          <button
            aria-describedby={sentenceId}
            aria-disabled={inFlight || blocked || undefined}
            className={`secondary-button compact-button member-confirm-accept${blocked && !inFlight ? " is-unavailable" : ""}`}
            onClick={() => {
              if (!inFlight && !blocked) onAnswer();
            }}
            ref={register("submit")}
            type="button"
          >
            {answerLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A select of statuses an issue can be moved to, with nothing chosen until the
 * reader chooses: a delete moves every issue in the status, and the strip's
 * answer stays steadily unavailable until a target is named. A change while
 * the write is out is ignored, as every field of the dialog's (§4.28).
 */
function TargetSelect({
  label,
  options,
  value,
  onChange,
  inFlight,
  register,
  focusKey,
}: {
  label: string;
  options: readonly { key: string; label: string }[];
  value: string;
  onChange: (key: string) => void;
  inFlight: boolean;
  register: Register;
  /** The step's first field is where focus goes when the step appears. */
  focusKey?: string;
}) {
  const fieldId = useId();
  return (
    <div className="workflow-field">
      <label htmlFor={fieldId}>{label}</label>
      <select
        id={fieldId}
        onChange={(event) => {
          if (!inFlight) onChange(event.target.value);
        }}
        ref={focusKey ? register(focusKey) : undefined}
        value={value}
      >
        <option disabled value="">
          Choose a status
        </option>
        {options.map((option) => (
          <option key={option.key} value={option.key}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * "{KEY} is not a status of {workflow}, so its issues cannot be moved from
 * here." — issues a refusal names in `details.statusKeys` that sit in a status
 * the workflow does not have: no target of a delete reaches them, so the strip
 * that says this offers no answer.
 */
const strandedSentence = (keys: readonly string[], workflowName: string) =>
  `${andList(keys)} ${keys.length === 1 ? "is not a status" : "are not statuses"} of ${workflowName}, so ${
    keys.length === 1 ? "its" : "their"
  } issues cannot be moved from here.`;

/**
 * Delete status (§4.28): the status and every transition from or to it. A
 * status with issues is refused with their count, and the strip then asks
 * where they go — any other status of this workflow — and sends the delete
 * again with that target. issue-service counts every issue of the workflow's
 * types in a status it will not keep, those already outside the workflow
 * included; when `details.statusKeys` names such a status, a target cannot
 * help, and the strip says so and offers no answer, as the workflow's does.
 */
function DeleteStatusStrip({
  id,
  status,
  label,
  workflow,
  workflowName,
  refusal,
  send,
  ...formProps
}: FormProps & {
  id: string;
  status: WorkflowStatus;
  label: string;
  workflow: WorkflowDefinition;
  workflowName: string;
  refusal: unknown;
  send: (sent: WorkflowWrite) => void;
}) {
  const [target, setTarget] = useState("");
  const others = statusesInColumnOrder(workflow.statuses).filter((item) => item.id !== status.id);
  const options = others.map((item) => ({ key: item.statusKey, label: statusLabel(item.statusKey, workflow.statuses) }));
  const chosen = options.find((option) => option.key === target);
  const count = refusal ? issueCountOf(refusal) : null;
  const stranded = refusal
    ? namedStatusKeys(apiErrorFacts(refusal).details).filter((key) => key !== status.statusKey)
    : [];
  const left = `${count === null ? "Issues" : issueCountWords(count)} would be left in a status this workflow no longer has.`;

  return (
    <ConfirmStrip
      {...formProps}
      answerLabel={refusal ? "Move and delete" : "Delete status"}
      id={id}
      onAnswer={
        stranded.length
          ? null
          : () =>
              send({
                kind: "delete-status",
                workflowId: workflow.id,
                statusId: status.id,
                params: { version: versionOf(workflow), ...(refusal && chosen ? { targetStatusKey: chosen.key } : {}) },
                said: {
                  done:
                    refusal && chosen
                      ? `Status ${label} deleted. Its issues moved to ${chosen.label}.`
                      : `Status ${label} deleted, with its transitions.`,
                  unread: `Status ${label} was deleted, but this list could not be read again. Reopen Workflows to see it.`,
                  staleIn: workflowName,
                },
              })
      }
      refusedSentence="The status was not deleted."
      sentence={`Delete ${label}? Its transitions are deleted with it.`}
      step={
        refusal
          ? {
              refusal,
              sentence: stranded.length ? left : `${left} Move ${label}’s issues to delete it.`,
              blocked: !chosen,
              fields: stranded.length ? (
                <p className="workflow-confirm-note">{strandedSentence(stranded, workflowName)}</p>
              ) : (
                <TargetSelect
                  inFlight={formProps.inFlight}
                  label="Move its issues to"
                  onChange={setTarget}
                  focusKey="step"
                  options={options}
                  register={formProps.register}
                  value={chosen ? target : ""}
                />
              ),
            }
          : undefined
      }
    />
  );
}

/**
 * Delete workflow (§4.28): its types go back to the shared default. Issues in
 * a status the shared default does not have are refused with their count and
 * their statuses (`details.statusKeys`), and the strip then asks, per such
 * status, which status of **both** workflows they go to — or says there is
 * none, and offers no answer. A refusal that names no status is said as one.
 *
 * When every type has a workflow of its own the list leaves the shared
 * default out, and its statuses are not known here. The sources still are —
 * each named status is one the shared default lacks — so the targets offered
 * are this workflow's other statuses, under a line that says the server takes
 * only one both workflows have; it judges, in its own words.
 */
function DeleteWorkflowStrip({
  id,
  workflow,
  name,
  shared,
  sharedName,
  typeCount,
  typesInWords,
  refusal,
  send,
  ...formProps
}: FormProps & {
  id: string;
  workflow: WorkflowDefinition;
  name: string;
  shared: WorkflowDefinition | undefined;
  sharedName: string;
  typeCount: number;
  typesInWords: string;
  refusal: unknown;
  send: (sent: WorkflowWrite) => void;
}) {
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const toMap = refusal ? statusesToMap(workflow, apiErrorFacts(refusal).details) : null;
  // A refusal that names no status to map is not one a mapping answers: it is
  // said as a refusal, and the question stays as it was.
  const step = toMap && (toMap.mappable.length > 0 || toMap.unmappable.length > 0) ? toMap : null;
  const sources = new Set(step?.mappable.map((status) => status.statusKey) ?? []);
  // A source is a status the shared default lacks, so without the shared
  // default's statuses the candidates are the others of this workflow.
  const candidates = shared
    ? statusesInBoth(workflow, shared)
    : statusesInColumnOrder(workflow.statuses).filter((status) => !sources.has(status.statusKey));
  const targets = candidates.map((status) => ({
    key: status.statusKey,
    label: statusLabel(status.statusKey, workflow.statuses),
  }));
  const chosen = (key: string) => (targets.some((target) => target.key === mapping[key]) ? mapping[key] : "");
  const sent = step ? Object.fromEntries(step.mappable.map((status) => [status.statusKey, chosen(status.statusKey)])) : {};
  const blocked = step ? step.mappable.some((status) => chosen(status.statusKey) === "") : false;
  const count = refusal ? issueCountOf(refusal) : null;
  // Every candidate gone is a true "no status in common" either way: without
  // the shared default, each remaining status was named as one it lacks.
  const nowhere = step && step.unmappable.length === 0 && targets.length === 0;
  const answerable = !step || (step.unmappable.length === 0 && targets.length > 0);
  const left = `${count === null ? "Issues" : issueCountWords(count)} would be left in statuses ${sharedName} does not have.`;
  const one = typeCount === 1;
  const back = typesInWords
    ? `${typesInWords} ${one ? "goes" : "go"} back to ${sharedName}.`
    : `Its issue types go back to ${sharedName}.`;

  return (
    <ConfirmStrip
      {...formProps}
      answerLabel={step ? "Move and delete" : "Delete workflow"}
      id={id}
      onAnswer={
        answerable
          ? () =>
              send({
                kind: "delete-workflow",
                workflowId: workflow.id,
                input: { version: versionOf(workflow), ...(step ? { statusMappings: sent } : {}) },
                said: {
                  done: `Workflow ${name} deleted. ${typesInWords ? `${typesInWords} ${one ? "uses" : "use"}` : "Its issue types use"} ${sharedName} again.`,
                  unread: `Workflow ${name} was deleted, but this list could not be read again. Reopen Workflows to see it.`,
                  staleIn: name,
                },
              })
          : null
      }
      refusedSentence="The workflow was not deleted."
      sentence={`Delete ${name}? ${back}`}
      step={
        step
          ? {
              refusal,
              // Without the shared default its line already says "Choose".
              sentence: answerable && shared ? `${left} Choose where each status’s issues go.` : left,
              blocked,
              fields: (
                <>
                  {step.unmappable.length ? (
                    <p className="workflow-confirm-note">{strandedSentence(step.unmappable, name)}</p>
                  ) : nowhere ? (
                    <p className="workflow-confirm-note">
                      {`${name} shares no status with ${sharedName}, so these issues have nowhere to go. Add one of ${sharedName}’s statuses to ${name} first.`}
                    </p>
                  ) : (
                    <>
                      {shared ? null : (
                        <p className="workflow-confirm-note">
                          The shared workflow is not in this list, so its statuses are not known here. Choose one it also has:
                          the server moves issues only to a status both workflows have.
                        </p>
                      )}
                      {step.mappable.map((status, index) => (
                        <TargetSelect
                          inFlight={formProps.inFlight}
                          key={status.id}
                          label={`Move ${statusLabel(status.statusKey, workflow.statuses)} issues to`}
                          onChange={(key) => setMapping((current) => ({ ...current, [status.statusKey]: key }))}
                          focusKey={index === 0 ? "step" : undefined}
                          options={targets}
                          register={formProps.register}
                          value={chosen(status.statusKey)}
                        />
                      ))}
                    </>
                  )}
                </>
              ),
            }
          : undefined
      }
    />
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
  registry,
  send,
  ...formProps
}: FormProps & {
  shared: ProjectWorkflowEntry;
  registry: IssueTypeRegistry;
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
        const types = andList(chosen.map((code) => issueTypeLabel(code, registry)));
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
              <TypeChip registry={registry} type={code} />
              <span>{issueTypeLabel(code, registry)}</span>
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
 * Rename (§4.28): the card's heading becomes a Name field with Cancel and
 * Save. A name left as it was sends nothing and closes the form; an empty one
 * turns Save off.
 */
function RenameWorkflowForm({
  workflow,
  name: shownName,
  send,
  ...formProps
}: FormProps & {
  workflow: WorkflowDefinition;
  name: string;
  send: (sent: WorkflowWrite) => void;
}) {
  const ids = useId();
  const box = useRevealOnOpen<HTMLFormElement>();
  const [name, setName] = useState(workflow.name);
  const trimmed = name.trim();
  const blocked = trimmed === "";

  return (
    <form
      aria-label={`Rename ${shownName}`}
      ref={box}
      className="workflow-form workflow-rename"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (formProps.inFlight || blocked) return;
        if (trimmed === workflow.name.trim()) {
          formProps.onCancel();
          return;
        }
        send({
          kind: "rename",
          workflowId: workflow.id,
          input: { version: versionOf(workflow), name: trimmed },
          said: {
            done: `Workflow renamed to ${trimmed}.`,
            unread: `Workflow ${trimmed} was renamed, but this list could not be read again. Reopen Workflows to see it.`,
            staleIn: shownName,
          },
        });
      }}
    >
      <div className="workflow-field">
        <label htmlFor={`${ids}-name`}>Name</label>
        <input
          autoFocus
          id={`${ids}-name`}
          maxLength={WORKFLOW_NAME_MAX_LENGTH}
          onChange={(event) => setName(event.target.value)}
          readOnly={formProps.inFlight}
          value={name}
        />
      </div>
      <FormFoot
        {...formProps}
        blocked={blocked}
        describedBy=""
        reason={null}
        refusedSentence="The workflow was not renamed."
        submitLabel="Save"
      />
    </form>
  );
}

/** The Category segments of a status form (§4.2's open set, `aria-pressed`). The edit form ignores a press in flight. */
function CategoryField({
  categories,
  category,
  onChange,
  inFlight = false,
}: {
  categories: string[];
  category: string;
  onChange: (category: string) => void;
  inFlight?: boolean;
}) {
  const labelId = useId();
  return (
    <div className="workflow-field">
      <span id={labelId}>Category</span>
      {/* `aria-pressed`, the product's segmented convention (TAS-299). */}
      <div aria-labelledby={labelId} className="segmented fit" role="group">
        {categories.map((code) => (
          <button
            aria-pressed={category === code}
            className={category === code ? "is-active" : ""}
            key={code}
            onClick={() => {
              if (!inFlight) onChange(code);
            }}
            type="button"
          >
            {categoryLabel(code)}
          </button>
        ))}
      </div>
    </div>
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
  const todo = statuses.find((status) => status.statusKey === INITIAL_STATUS_KEY);
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
      <CategoryField categories={categories} category={category} onChange={setCategory} />
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
      <FormFoot
        {...formProps}
        blocked={blocked}
        describedBy=""
        reason={reason}
        refusedSentence="The status was not added."
        submitLabel="Add status"
      />
    </form>
  );
}

/**
 * Edit status (§4.28): Add status's form in the row's place, filled in — the
 * name, the category, and the position among the **other** statuses, the one it
 * holds now chosen. The key is shown and never edited: the server keeps it.
 * Save sends only what changed, with the workflow's version; nothing changed
 * sends nothing and closes the form.
 */
function EditStatusForm({
  status,
  label: shownLabel,
  workflow,
  workflowName,
  categories,
  send,
  ...formProps
}: FormProps & {
  status: WorkflowStatus;
  label: string;
  workflow: WorkflowDefinition;
  workflowName: string;
  categories: string[];
  send: (sent: WorkflowWrite) => void;
}) {
  const ids = useId();
  const box = useRevealOnOpen<HTMLFormElement>();
  const [name, setName] = useState(status.name);
  const [category, setCategory] = useState(status.category);
  const { options, current } = statusEditPositions(workflow.statuses, status.id);
  const [position, setPosition] = useState(positionValue(current));
  const option = options.find((item) => positionValue(item.position) === position);
  const others = workflow.statuses.filter((item) => item.id !== status.id);
  const todo = others.find((item) => item.statusKey === INITIAL_STATUS_KEY);
  const label = (item: WorkflowStatus) => statusLabel(item.statusKey, workflow.statuses);

  const trimmed = name.trim();
  const changes: UpdateWorkflowStatusInput = {
    ...(trimmed !== status.name.trim() ? { name: trimmed } : {}),
    ...(category !== status.category ? { category } : {}),
    ...(option && !option.current && option.sortOrder !== null ? { sortOrder: option.sortOrder } : {}),
  };
  const blocked = trimmed === "" || option?.sortOrder == null;
  const renamed = changes.name ?? status.name;

  return (
    <form
      aria-label={`Edit ${shownLabel}`}
      ref={box}
      className="workflow-form workflow-row-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (formProps.inFlight || blocked) return;
        if (!Object.keys(changes).length) {
          formProps.onCancel();
          return;
        }
        send({
          kind: "edit-status",
          workflowId: workflow.id,
          statusId: status.id,
          input: { version: versionOf(workflow), ...changes },
          said: {
            done: `Status ${renamed} saved.`,
            unread: `Status ${renamed} was saved, but this list could not be read again. Reopen Workflows to see it.`,
            staleIn: workflowName,
          },
        });
      }}
    >
      <div className="form-two workflow-form-two">
        <div className="workflow-field">
          <label htmlFor={`${ids}-name`}>Name</label>
          <input
            autoFocus
            id={`${ids}-name`}
            maxLength={WORKFLOW_NAME_MAX_LENGTH}
            onChange={(event) => setName(event.target.value)}
            readOnly={formProps.inFlight}
            value={name}
          />
        </div>
        <div className="workflow-field">
          <label htmlFor={`${ids}-key`}>Key</label>
          {/* Read-only (§4.3): selectable and in the Tab order, never typed in. */}
          <input
            aria-describedby={`${ids}-key-note`}
            className="mono-input workflow-readonly-input"
            id={`${ids}-key`}
            readOnly
            value={status.statusKey}
          />
          <p className="workflow-field-note" id={`${ids}-key-note`}>
            A status keeps its key.
          </p>
        </div>
      </div>
      <CategoryField categories={categories} category={category} inFlight={formProps.inFlight} onChange={setCategory} />
      <div className="workflow-field">
        <label htmlFor={`${ids}-position`}>Position</label>
        <select
          aria-describedby={position === "start" && todo ? `${ids}-position-note` : undefined}
          id={`${ids}-position`}
          onChange={(event) => {
            if (!formProps.inFlight) setPosition(event.target.value);
          }}
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
      <FormFoot
        {...formProps}
        blocked={blocked}
        describedBy=""
        reason={null}
        refusedSentence="The status was not changed."
        submitLabel="Save"
      />
    </form>
  );
}

/**
 * Edit transition (§4.28): in the row's place, "{From} → {To}" as it is — the
 * server never changes them — then the name, the place among the moves that
 * leave the same status (the order of the move buttons on an issue there), and
 * Hidden. Save sends only what changed, with the workflow's version.
 */
function EditTransitionForm({
  transition,
  from,
  to,
  pairInWords,
  workflow,
  workflowName,
  send,
  ...formProps
}: FormProps & {
  transition: WorkflowDefinitionTransition;
  from: string | null;
  to: string | null;
  pairInWords: string;
  workflow: WorkflowDefinition;
  workflowName: string;
  send: (sent: WorkflowWrite) => void;
}) {
  const ids = useId();
  const box = useRevealOnOpen<HTMLFormElement>();
  const [name, setName] = useState(transition.name);
  const [hidden, setHidden] = useState(transition.hidden);
  const { options, current } = transitionEditPositions(workflow, transition.id);
  const [position, setPosition] = useState(transitionPositionValue(current));
  const option = options.find((item) => transitionPositionValue(item.position) === position);
  const toWords = to ?? "Unknown status";
  const siblingName = (item: WorkflowDefinitionTransition) => {
    const target = workflow.statuses.find((status) => status.id === item.toStatusId);
    return transitionButtonLabel(item.name, target ? statusLabel(target.statusKey, workflow.statuses) : "Unknown status").text;
  };

  const trimmed = name.trim();
  const changes: UpdateWorkflowTransitionInput = {
    ...(trimmed !== transition.name.trim() ? { name: trimmed } : {}),
    ...(option && !option.current && option.sortOrder !== null ? { sortOrder: option.sortOrder } : {}),
    ...(hidden !== transition.hidden ? { hidden } : {}),
  };
  // An unnamed transition that stays unnamed sends no name, so it may still be hidden or moved.
  const blocked = (trimmed === "" && changes.name !== undefined) || option?.sortOrder == null;
  const shown = transitionButtonLabel(changes.name ?? transition.name, toWords).text;

  return (
    <form
      aria-label={`Edit ${pairInWords}`}
      ref={box}
      className="workflow-form workflow-row-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (formProps.inFlight || blocked) return;
        if (!Object.keys(changes).length) {
          formProps.onCancel();
          return;
        }
        send({
          kind: "edit-transition",
          workflowId: workflow.id,
          transitionId: transition.id,
          input: { version: versionOf(workflow), ...changes },
          said: {
            done: `Transition ${shown} saved: ${pairInWords}.`,
            unread: `Transition ${shown} was saved, but this list could not be read again. Reopen Workflows to see it.`,
            staleIn: workflowName,
          },
        });
      }}
    >
      <p className="workflow-form-pair">
        <TransitionPair from={from} to={to} />
      </p>
      <div className="workflow-field">
        <label htmlFor={`${ids}-name`}>Name</label>
        <input
          aria-describedby={`${ids}-name-note`}
          autoFocus
          id={`${ids}-name`}
          maxLength={WORKFLOW_NAME_MAX_LENGTH}
          onChange={(event) => setName(event.target.value)}
          readOnly={formProps.inFlight}
          value={name}
        />
        <p className="workflow-field-note" id={`${ids}-name-note`}>
          Shown on the move button of an issue.
        </p>
      </div>
      {options.length > 1 ? (
        <div className="workflow-field">
          <label htmlFor={`${ids}-position`}>Position</label>
          <select
            aria-describedby={`${ids}-position-note`}
            id={`${ids}-position`}
            onChange={(event) => {
              if (!formProps.inFlight) setPosition(event.target.value);
            }}
            value={position}
          >
            {options.map((item) => {
              const value = transitionPositionValue(item.position);
              const text = item.after ? `After ${siblingName(item.after)}` : "First";
              return (
                <option disabled={item.sortOrder === null} key={value} value={value}>
                  {item.sortOrder === null ? `${text} (no space left)` : text}
                </option>
              );
            })}
          </select>
          <p className="workflow-field-note" id={`${ids}-position-note`}>
            The order of the move buttons on {from === null ? "an issue in this status" : `a ${from} issue`}.
          </p>
        </div>
      ) : null}
      <div className="workflow-field">
        <label className="workflow-type-option">
          <input
            aria-describedby={`${ids}-hidden-note`}
            checked={hidden}
            onChange={(event) => {
              if (!formProps.inFlight) setHidden(event.target.checked);
            }}
            type="checkbox"
          />
          <span>Hidden</span>
        </label>
        <p className="workflow-field-note" id={`${ids}-hidden-note`}>
          A hidden transition is not offered on the board.
        </p>
      </div>
      <FormFoot
        {...formProps}
        blocked={blocked}
        describedBy=""
        reason={null}
        refusedSentence="The transition was not changed."
        submitLabel="Save"
      />
    </form>
  );
}

/**
 * Add transition (§4.28): two statuses and a name. Always visible — a
 * transition is hidden afterwards, from its Edit — and numbered after every
 * transition the list holds, the hidden ones included.
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
      <FormFoot
        {...formProps}
        blocked={blocked}
        describedBy=""
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
