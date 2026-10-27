import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { CreateProjectIssueTypeInput, DeleteProjectIssueTypeInput, UpdateProjectIssueTypeInput } from "../api/TaskaApi";
import { taskaApi } from "../api/client";
import { apiErrorFacts, isCommandPending, isProjectArchived } from "../api/errors";
import {
  ISSUE_TYPE_CODE_MAX_LENGTH,
  ISSUE_TYPE_CODE_PATTERN,
  ISSUE_TYPE_COLORS,
  ISSUE_TYPE_ICONS,
  ISSUE_TYPE_NAME_MAX_LENGTH,
  ISSUE_TYPE_SHAPES,
  LAST_ISSUE_TYPE_REASON,
} from "../api/issueTypes";
import type {
  IssueTypeColor,
  IssueTypeIcon,
  IssueTypeShape,
  ProjectContext,
  ProjectIssueType,
  ProjectRole,
  ProjectWorkflowEntry,
} from "../domain/types";
import { boardKey } from "../lib/boardQuery";
import { issueTypeColorValue, issueTypeFallbackLabel, issueTypeLabel, keyBadgeStyle, statusLabel } from "../lib/format";
import {
  defaultIssueTypeColor,
  inUseCountOf,
  isIssueStatusesUnmapped,
  isIssueTypeInUse,
  isIssueTypeReplaced,
  isIssueTypeTargetInvalid,
  issueTypeCodeOf,
  issueTypeDeleteRefusalText,
  issueTypeMoveSentence,
  issueTypeOrderRefusal,
  issueTypeStatusesSentence,
  movedIssueTypeCodes,
  nextIssueTypeSortOrder,
  withIssueTypeOrder,
} from "../lib/issueTypes";
import { refusalWords } from "../lib/projectArchive";
import { projectContextKey } from "../lib/projectContext";
import {
  isMigrationLimitRefusal,
  migrationLimitSentence,
  namedStatusKeys,
  orderWorkflowEntries,
  statusesInColumnOrder,
  targetStatusKeysOf,
} from "../lib/workflows";
import { ApiNotice } from "./ApiNotice";
import { ColorSwatches } from "./ColorSwatches";
import { ConfirmStrip, PendingNote, TargetSelect, type MoveStep, type Register } from "./ConfirmStrip";
import { ErrorNote } from "./ErrorNote";
import { IssueTypeGlyph, TypeLookChip } from "./IssueBits";
import { Modal } from "./Modal";
import { projectWorkflowsKey, projectWorkflowsOptions } from "./projectWorkflowsQuery";
import { RequestId } from "./RequestId";

/**
 * Issue types (DESIGN.md §4.30, TAS-417): the project's issue-type registry,
 * readable by everyone on the project and written by its ADMIN — add (on the
 * main workflow or one chosen, TAS-437), rename, recolour, change the shape or
 * the icon (or take the icon away, TAS-434), reorder, delete — moving the
 * type's issues to another type first when it has any (TAS-433).
 *
 * The registry is the context's `issueTypes`, the same answer the board draws
 * from, so opening this asks for nothing (§4.30 «Чтения»). Every write lands
 * in that same cache entry, which is how the type filter, New issue, the cards
 * and Workflows follow it.
 */

/** §4.30's swatch names, in the contract's colour order. */
const COLOR_NAMES: Record<IssueTypeColor, string> = {
  blue: "Blue",
  red: "Red",
  green: "Green",
  amber: "Amber",
  purple: "Purple",
  teal: "Teal",
  slate: "Slate",
};

/** §4.30's shape names, in the contract's shape order. */
const SHAPE_NAMES: Record<IssueTypeShape, string> = {
  square: "Square",
  circle: "Circle",
  diamond: "Diamond",
};

/** §4.30's icon names, in the contract's icon order. */
const ICON_NAMES: Record<IssueTypeIcon, string> = {
  "check-square": "Checkbox",
  bug: "Bug",
  "book-open": "Book",
  headset: "Headset",
  megaphone: "Megaphone",
  "file-text": "Document",
  flag: "Flag",
  layers: "Layers",
};

const COLOR_CHOICES = ISSUE_TYPE_COLORS.map((color) => ({
  value: color,
  swatch: issueTypeColorValue(color),
  label: COLOR_NAMES[color],
}));

/** A new type's shape (§4.30): the server's default too. A new type has no icon. */
const DEFAULT_SHAPE: IssueTypeShape = "square";
/** How long a row a write made holds §4.28's highlight. */
const HIGHLIGHT_MS = 2000;

type OpenForm = { kind: "create" } | { kind: "edit"; code: string };

/**
 * A write as it is sent. A create and a delete carry `requestId` only when
 * they repeat a command the server answered «still being applied»
 * (`CommandRetry`); a delete with a move carries the command and the target's
 * label, which its success names.
 */
type TypeWrite =
  | { kind: "create"; input: CreateProjectIssueTypeInput; name: string; requestId?: string }
  | { kind: "edit"; code: string; input: UpdateProjectIssueTypeInput; name: string }
  | {
      kind: "delete";
      code: string;
      name: string;
      index: number;
      move?: { input: DeleteProjectIssueTypeInput; target: string };
      requestId?: string;
    };

/**
 * The delete strip of one type, and what the server has said to it (§4.30):
 * the in-use refusal that made it the move step, then — for the target the
 * reader chose — the statuses that target's workflow lacks, or the migration
 * limit. `attempt` changes when the select must start over (the target left
 * the registry), so the step's fields remount empty.
 */
interface DeleteConfirm {
  code: string;
  inUse?: unknown;
  statuses?: { refusal: unknown; target: string };
  limit?: unknown;
  attempt: number;
}

/**
 * What a write answered: the saved entry — for a create, with the workflow it
 * runs on — or for a delete whether it had already gone.
 */
type WriteAnswer = { entry: ProjectIssueType; workflowId?: string | null } | { alreadyGone: boolean };

interface Notice {
  sentence: string;
  error?: unknown;
  /** `false` keeps the server's words off the slot's second line, leaving the request id (§4.30's stale move). */
  serverWords?: boolean;
}


interface ProjectIssueTypesModalProps {
  projectId: string;
  projectKey: string;
  /** For the eyebrow badge only, as in Members and Workflows. */
  projectColor?: string | null;
  /**
   * The board's reading of the reader's role, from the project context:
   * `undefined` while unread, `null` for no role this build can act on or a
   * failed read. Only an ADMIN gets controls; the server refuses the rest.
   */
  readerRole: ProjectRole | null | undefined;
  /** The project is archived (§5.7): every role reads, nobody writes. */
  archived: boolean;
  /** The registry off the board's context, in the server's order; `undefined` until it answers. */
  issueTypes: readonly ProjectIssueType[] | undefined;
  /**
   * The context's workflows by type: the labels and the column order a delete's
   * status step draws from — the deleted type's for the statuses its issues
   * are in, the target's for where they may go (§4.30 «Статусы»).
   */
  workflows?: ProjectContext["workflows"];
  /** The context read's failure, when it has nothing to show. */
  contextError: unknown;
  onClose: () => void;
}

/** Whether a refusal is `code` — the gateway writes the gRPC name. */
const refusedWith = (error: unknown, code: string) => apiErrorFacts(error).code === code;

export function ProjectIssueTypesModal({
  projectId,
  projectKey,
  projectColor,
  readerRole,
  archived,
  issueTypes: registry,
  workflows,
  contextError,
  onClose,
}: ProjectIssueTypesModalProps) {
  const queryClient = useQueryClient();
  const contextKey = projectContextKey(projectId);
  const isAdmin = readerRole === "ADMIN" && !archived;
  const readOnlyReader = archived || readerRole === "MEMBER" || readerRole === "VIEWER" || readerRole === null;
  const types = registry ?? [];

  const [openedForm, setForm] = useState<OpenForm | null>(null);
  // A form whose row went with a re-read, or a reader who stopped being able
  // to write, is not drawn, so it is not open.
  const form =
    isAdmin && openedForm && (openedForm.kind === "create" || types.some((entry) => entry.code === openedForm.code))
      ? openedForm
      : null;
  const [openedConfirm, setConfirm] = useState<DeleteConfirm | null>(null);
  const confirm =
    isAdmin && openedConfirm && types.some((entry) => entry.code === openedConfirm.code) ? openedConfirm : null;
  /**
   * A create or a delete the server answered «still being applied» (§4.28
   * «Ещё применяется», §4.30): the command as sent and the 503's request id.
   * Its form or strip stays with every field frozen; its button repeats it.
   */
  const [pending, setPending] = useState<{ sent: TypeWrite; requestId: string | null } | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [highlight, setHighlight] = useState<string | null>(null);
  /** The code a create was refused for as taken (409), shown as the Code field's reason while it is still typed. */
  const [takenCode, setTakenCode] = useState<string | null>(null);

  /**
   * Where focus goes after the next render — the first of these keys that
   * names a node. Looked up among the nodes registered below, because the node
   * a write lands on is drawn by its answer (Workflows' rule, §4.28).
   */
  const pendingFocus = useRef<string[] | null>(null);
  const focusables = useRef(new Map<string, HTMLElement>());
  const register: Register = (key) => (node) => {
    if (node) focusables.current.set(key, node);
    else focusables.current.delete(key);
  };
  useEffect(() => {
    const keys = pendingFocus.current;
    if (!keys) return;
    pendingFocus.current = null;
    const node = keys.map((key) => focusables.current.get(key)).find(Boolean);
    node?.focus();
  });
  /**
   * A move's focus waits for the move itself: the cache tells the board a
   * tick after this dialog's own state has rendered, and the row React then
   * moves loses focus on the way (§4.30). So the same button of the moved row
   * is focused once the list stands in the order pressed.
   */
  const moveFocus = useRef<{ key: string; code: string; index: number } | null>(null);
  const shownOrder = (registry ?? []).map((entry) => entry.code).join(" ");
  useEffect(() => {
    const pending = moveFocus.current;
    if (!pending || registry?.[pending.index]?.code !== pending.code) return;
    moveFocus.current = null;
    focusables.current.get(pending.key)?.focus();
  }, [shownOrder, registry]);

  useEffect(() => {
    if (!highlight) return;
    const timer = window.setTimeout(() => setHighlight(null), HIGHLIGHT_MS);
    return () => window.clearTimeout(timer);
  }, [highlight]);

  // The slot's box scrolls into view when it takes a sentence (§4.22's recipe).
  useEffect(() => {
    if (notice) focusables.current.get("notice")?.scrollIntoView({ block: "nearest" });
  }, [notice]);

  /**
   * The controls can go from under the focus without the reader asking — an
   * archive or a lower role read back after a refusal. Focus never leaves an
   * open dialog (§5.7): the archive line takes it, else the body, which is a
   * Tab stop for a reader without controls. Only when it has actually fallen.
   */
  const dialogBody = useRef<HTMLDivElement>(null);
  const hadControls = useRef(isAdmin);
  useEffect(() => {
    if (hadControls.current && !isAdmin) {
      const active = document.activeElement;
      if (!active || active === document.body) {
        const root = dialogBody.current;
        const target =
          root?.querySelector<HTMLElement>('[data-archive-note="modal"]') ??
          root?.closest<HTMLElement>(".modal-body") ??
          null;
        target?.focus();
      }
    }
    hadControls.current = isAdmin;
  }, [isAdmin]);

  /** The registry in the context cache, changed by `change` — every surface that draws a type follows. */
  const setRegistry = (change: (current: ProjectIssueType[]) => ProjectIssueType[]) =>
    queryClient.setQueryData<ProjectContext>(contextKey, (context) =>
      context ? { ...context, issueTypes: change(context.issueTypes) } : context,
    );
  /** The reads a create, a delete or a reorder can change besides the registry: columns, cards, Workflows. */
  const invalidateDependents = () => {
    void queryClient.invalidateQueries({ queryKey: boardKey(projectId) });
    void queryClient.invalidateQueries({ queryKey: projectWorkflowsKey(projectId) });
  };
  const labelOf = (code: string) => issueTypeLabel(code, registry);

  const write = useMutation({
    mutationFn: async (sent: TypeWrite): Promise<WriteAnswer> => {
      const retry = sent.kind !== "edit" && sent.requestId ? { requestId: sent.requestId } : undefined;
      switch (sent.kind) {
        case "create": {
          const { workflowId, ...entry } = retry
            ? await taskaApi.createProjectIssueType(projectId, sent.input, retry)
            : await taskaApi.createProjectIssueType(projectId, sent.input);
          // The registry entry alone goes to the cache; `workflowId` is said.
          return { entry, workflowId };
        }
        case "edit":
          return { entry: await taskaApi.updateProjectIssueType(projectId, sent.code, sent.input) };
        case "delete":
          try {
            // The first press sends no body (§4.30 «Первое нажатие»).
            if (sent.move || retry) await taskaApi.deleteProjectIssueType(projectId, sent.code, sent.move?.input, retry);
            else await taskaApi.deleteProjectIssueType(projectId, sent.code);
            return { alreadyGone: false };
          } catch (error) {
            // Gone already — deleted elsewhere meanwhile — takes the success path (§4.30).
            if (refusedWith(error, "NOT_FOUND")) return { alreadyGone: true };
            throw error;
          }
      }
    },
    // Mutation-level, so it finishes after the dialog has closed: ✕ and the
    // scrim stay usable in flight and cancel nothing.
    onSuccess: (answer, sent) => {
      setNotice(null);
      setPending(null);
      if (sent.kind === "delete") {
        const remaining = types.filter((entry) => entry.code !== sent.code);
        setRegistry((current) => current.filter((entry) => entry.code !== sent.code));
        void queryClient.invalidateQueries({ queryKey: contextKey });
        invalidateDependents();
        // Issues moved to another type (§4.30 «Чтения»): every issue of the
        // project read so far may now show the wrong type.
        if (sent.move) void queryClient.invalidateQueries({ queryKey: ["issue", projectId] });
        setConfirm(null);
        const gone = "alreadyGone" in answer && answer.alreadyGone;
        setAnnouncement(
          gone
            ? `${sent.name} was already deleted.`
            : sent.move
              ? `Type ${sent.name} deleted. Its issues are now ${sent.move.target}.`
              : `Type ${sent.name} deleted.`,
        );
        // The row that took its place, else the one before it, else Add type.
        // A lone type left has no Delete (§4.30), so then Add type.
        const next = remaining[sent.index]?.code;
        const previous = remaining[sent.index - 1]?.code;
        pendingFocus.current =
          remaining.length >= 2 ? [`delete:${next}`, `delete:${previous}`, "trigger:add"] : ["trigger:add"];
        return;
      }
      if (!("entry" in answer)) return;
      const { entry } = answer;
      setForm(null);
      setTakenCode(null);
      setHighlight(entry.code);
      if (sent.kind === "create") {
        // Sent with the largest `sortOrder` + 10, so it is the last (§4.30).
        setRegistry((current) => [...current.filter((item) => item.code !== entry.code), entry]);
        // Named from the list as it was when the form sent it, before it is read again.
        const listed = queryClient.getQueryData<ProjectWorkflowEntry[]>(projectWorkflowsKey(projectId));
        const workflow = listed?.find((item) => "workflowId" in answer && item.workflow.id === answer.workflowId);
        void queryClient.invalidateQueries({ queryKey: contextKey });
        invalidateDependents();
        setAnnouncement(
          `Type ${issueTypeLabel(entry.code, [entry])} added. It uses ${workflow?.workflow.name.trim() || "the shared workflow"}.`,
        );
        pendingFocus.current = ["trigger:add"];
      } else {
        // A name, a colour, a shape or an icon: the answer is the whole entry, and no read follows.
        setRegistry((current) => current.map((item) => (item.code === entry.code ? entry : item)));
        setAnnouncement(`Type ${issueTypeLabel(entry.code, [entry])} saved.`);
        pendingFocus.current = [`edit:${entry.code}`];
      }
    },
    onError: (error, sent) => {
      // «Ещё применяется» (§4.28, §4.30): the server has the command and
      // finishes it. The form or the strip stays, frozen; its button repeats
      // the command with the 503's request id.
      if (sent.kind !== "edit" && isCommandPending(error)) {
        setPending({ sent, requestId: apiErrorFacts(error).requestId });
        pendingFocus.current = ["submit"];
        return;
      }
      setPending(null);
      if (sent.kind === "delete" && !sent.move && isIssueTypeInUse(error)) {
        // Not a refusal to report: the strip stays and becomes its move step
        // (§4.30 «Шаг переноса (тип)»), focus on its select.
        setConfirm((current) => (current?.code === sent.code ? { ...current, inUse: error } : current));
        pendingFocus.current = ["step"];
        return;
      }
      // A refusal that takes the dialog's controls away — the role, the
      // archive (§4.30 «403 на любой записи», §5.7) — is said in the slot,
      // which outlives the strip, as a first press's is.
      const losesControls = refusedWith(error, "PERMISSION_DENIED") || isProjectArchived(error);
      if (sent.kind === "delete" && sent.move && !losesControls) {
        const target = sent.move.input.moveIssuesTo;
        if (isIssueTypeReplaced(error)) {
          // The type is not the one the dialog read: the strip closes, the
          // registry is read again, and the slot says nothing moved.
          setConfirm(null);
          void queryClient.invalidateQueries({ queryKey: contextKey });
          setNotice({
            sentence: `Issue types changed elsewhere, so ${sent.name} was not deleted and no issue moved. The list now shows the current types.`,
            error,
            serverWords: false,
          });
          pendingFocus.current = [`delete:${sent.code}`, "trigger:add", "notice"];
          return;
        }
        if (isIssueStatusesUnmapped(error) && target !== undefined) {
          setConfirm((current) =>
            current?.code === sent.code ? { ...current, statuses: { refusal: error, target }, limit: undefined } : current,
          );
          pendingFocus.current = ["status-step", "submit"];
          return;
        }
        if (isMigrationLimitRefusal(error)) {
          setConfirm((current) => (current?.code === sent.code ? { ...current, limit: error } : current));
          pendingFocus.current = ["cancel"];
          return;
        }
        if (isIssueTypeTargetInvalid(error)) {
          // The target left the registry: read it again, start the select over.
          void queryClient.invalidateQueries({ queryKey: contextKey });
          setConfirm((current) =>
            current?.code === sent.code ? { ...current, statuses: undefined, attempt: current.attempt + 1 } : current,
          );
          pendingFocus.current = ["step"];
          return;
        }
        // Anything else is said in the strip, which stays (§4.30 «Отказы шага»).
        pendingFocus.current = ["submit"];
        return;
      }
      if (sent.kind === "delete") {
        // In the slot, the strip closed, focus back on the row's Delete (§4.30).
        setConfirm(null);
        setNotice({ sentence: issueTypeDeleteRefusalText(error, sent.name), error });
        // Delete is offered only with two types or more, so the server's
        // "last type" means this registry is stale: read it again.
        if (apiErrorFacts(error).details?.reason === LAST_ISSUE_TYPE_REASON) {
          void queryClient.invalidateQueries({ queryKey: contextKey });
        }
        pendingFocus.current = [`delete:${sent.code}`, "notice"];
        return;
      }
      if (sent.kind === "create" && refusedWith(error, "ALREADY_EXISTS")) {
        // The reason belongs to the Code field, not to a box over the actions.
        setTakenCode(sent.input.code);
        write.reset();
        pendingFocus.current = ["code", "submit"];
        return;
      }
      if (sent.kind === "edit" && refusedWith(error, "NOT_FOUND")) {
        setForm(null);
        write.reset();
        void queryClient.invalidateQueries({ queryKey: contextKey });
        setNotice({ sentence: `${sent.name} is no longer one of this project's issue types.`, error });
        pendingFocus.current = ["trigger:add", "notice"];
        return;
      }
      if (refusedWith(error, "PERMISSION_DENIED")) {
        // The context is read again (the board's refusal listener), and the
        // role line may take the form away: the refusal is said in the slot,
        // which outlives it (§4.30 «403 на любой записи»).
        setForm(null);
        write.reset();
        setNotice({ sentence: sent.kind === "create" ? "The type was not added." : "The type was not saved.", error });
        pendingFocus.current = ["trigger:add", "notice"];
        return;
      }
      pendingFocus.current = ["submit"];
    },
  });

  /**
   * Move up / Move down (§4.30, backend TAS-418): one `PUT …/order` per press
   * with the whole order as it stands once the move is made — optimistic in
   * the context cache in the same frame, so the filter and New issue follow —
   * and the writes go one at a time in the order pressed. Any refusal stops
   * what is still queued, reads the context again and says so in the slot —
   * a stale set (409 `ABORTED`, `ISSUE_TYPES_CHANGED`, backend TAS-429) in a
   * sentence of its own (`issueTypeOrderRefusal`); the board and Workflows are
   * read again once the queue is empty.
   */
  const orderQueue = useRef<string[][]>([]);
  const orderRunning = useRef(false);
  const [orderInFlight, setOrderInFlight] = useState(false);
  const runOrders = async () => {
    if (orderRunning.current) return;
    orderRunning.current = true;
    setOrderInFlight(true);
    let wrote = false;
    while (orderQueue.current.length > 0) {
      const codes = orderQueue.current.shift() as string[];
      try {
        const saved = await taskaApi.reorderProjectIssueTypes(projectId, codes);
        wrote = true;
        // A later press already drew its own order; its answer will land.
        if (orderQueue.current.length === 0) setRegistry(() => saved);
      } catch (error) {
        orderQueue.current = [];
        setNotice({ ...issueTypeOrderRefusal(error), error });
        await queryClient.invalidateQueries({ queryKey: contextKey });
      }
    }
    if (wrote) invalidateDependents();
    orderRunning.current = false;
    setOrderInFlight(false);
  };
  const move = (index: number, direction: "up" | "down") => {
    if (write.isPending) return;
    const codes = movedIssueTypeCodes(types, index, direction);
    if (!codes) return;
    const code = types[index].code;
    void queryClient.cancelQueries({ queryKey: contextKey });
    setRegistry((current) => withIssueTypeOrder(current, codes));
    setNotice(null);
    setAnnouncement(`${labelOf(code)} moved to position ${codes.indexOf(code) + 1} of ${codes.length}.`);
    // The node React moves loses focus: put it back on the same button.
    moveFocus.current = { key: `${direction}:${code}`, code, index: codes.indexOf(code) };
    orderQueue.current.push(codes);
    void runOrders();
  };

  const inFlight = write.isPending;
  const busy = inFlight || orderInFlight;

  /**
   * A pending command whose form or strip goes away still goes through: the
   * context, the board and the workflows are read again, so what the server
   * finishes reaches the screen without the repeat (§4.28 «Ещё применяется»).
   */
  const settlePending = () => {
    if (!pending) return;
    setPending(null);
    void queryClient.invalidateQueries({ queryKey: contextKey });
    invalidateDependents();
  };
  /** Closing the dialog over a pending command reads what it changes again too (§4.28 «Ещё применяется»). */
  const pendingOnClose = useRef(false);
  useEffect(() => {
    pendingOnClose.current = pending !== null;
  });
  useEffect(
    () => () => {
      if (!pendingOnClose.current) return;
      void queryClient.invalidateQueries({ queryKey: projectContextKey(projectId) });
      void queryClient.invalidateQueries({ queryKey: boardKey(projectId) });
      void queryClient.invalidateQueries({ queryKey: projectWorkflowsKey(projectId) });
    },
    [queryClient, projectId],
  );
  /** The open form's or strip's command, while the server is still applying it. */
  const pendingCreate = pending?.sent.kind === "create" && form?.kind === "create" ? pending : null;
  const pendingDelete = pending?.sent.kind === "delete" && confirm && pending.sent.code === confirm.code ? pending : null;
  /** Repeats the pending command exactly as sent, with the 503's request id. */
  const repeatPending = (held: { sent: TypeWrite; requestId: string | null }) => {
    if (inFlight) return;
    write.mutate({ ...held.sent, requestId: held.requestId ?? undefined } as TypeWrite);
  };

  const openForm = (next: OpenForm) => {
    if (busy) return;
    write.reset();
    settlePending();
    setTakenCode(null);
    setNotice(null);
    setConfirm(null);
    setForm(next);
  };
  const closeForm = () => {
    if (inFlight || !form) return;
    write.reset();
    settlePending();
    setTakenCode(null);
    pendingFocus.current = [form.kind === "create" ? "trigger:add" : `edit:${form.code}`];
    setForm(null);
  };
  const toggleConfirm = (code: string) => {
    if (busy) return;
    write.reset();
    settlePending();
    setForm(null);
    setNotice(null);
    const opening = confirm?.code !== code;
    // The strip's Cancel takes focus first (§4.22); closed again, focus stays on Delete.
    if (opening) pendingFocus.current = ["cancel"];
    setConfirm(opening ? { code, attempt: 0 } : null);
  };
  const cancelConfirm = () => {
    if (inFlight || !confirm) return;
    write.reset();
    settlePending();
    pendingFocus.current = [`delete:${confirm.code}`];
    setConfirm(null);
  };

  /**
   * §4.11's inner layers of `Esc`, in §4.30's order: the delete strip, then
   * the form, then the dialog (`Modal`, on `window`, after this). In flight,
   * nothing — `Modal`'s `busy` holds the dialog then.
   */
  const onEscape = useRef((_event: KeyboardEvent) => {});
  useEffect(() => {
    onEscape.current = (event) => {
      if (busy) return;
      if (confirm) {
        event.preventDefault();
        cancelConfirm();
      } else if (form) {
        event.preventDefault();
        closeForm();
      }
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
  const formError = write.isError && form && write.variables && write.variables.kind === form.kind ? write.error : null;

  return (
    <Modal
      busy={busy}
      eyebrow={
        badge ? (
          <span className="key-badge" style={badge}>
            {projectKey}
          </span>
        ) : undefined
      }
      focusableBody={readOnlyReader}
      onClose={onClose}
      title="Issue types"
    >
      <div className="issue-types-panel" ref={dialogBody}>
        {/* One polite region, mounted from the start so its first sentence is
            heard (§7): what a write did. */}
        <p aria-live="polite" className="visually-hidden">
          {announcement}
        </p>

        {isAdmin ? (
          form?.kind === "create" ? (
            <IssueTypeForm
              error={formError}
              frozen={inFlight || pendingCreate !== null}
              inFlight={inFlight}
              key="create"
              mode={{ kind: "create" }}
              onCancel={closeForm}
              onSubmit={({ code, name, color, shape, icon, workflowId }) => {
                if (pendingCreate) {
                  repeatPending(pendingCreate);
                  return;
                }
                write.mutate({
                  kind: "create",
                  // `shape` always, `icon` only when one was chosen (§4.30, backend
                  // TAS-432); `workflowId` only when the list named one (TAS-437).
                  input: {
                    code,
                    name,
                    color,
                    shape,
                    ...(icon !== null ? { icon } : {}),
                    sortOrder: nextIssueTypeSortOrder(types),
                    ...(workflowId ? { workflowId } : {}),
                  },
                  name: issueTypeLabel(code, [{ code, name, color, shape, icon, sortOrder: 0 }]),
                });
              }}
              projectId={projectId}
              register={register}
              registry={types}
              takenCode={takenCode}
            />
          ) : (
            <AddTypeButton busy={busy} onOpen={() => openForm({ kind: "create" })} register={register} />
          )
        ) : null}

        {/* Why there are no controls, as far as the server said it (§4.22's
            rule): nothing while the role is still being read. */}
        {archived ? (
          <p className="issue-types-note" data-archive-note="modal" tabIndex={-1}>
            This project is archived, so its issue types cannot be changed.
          </p>
        ) : readerRole === "MEMBER" || readerRole === "VIEWER" ? (
          <p className="issue-types-note">Only a project admin can change issue types.</p>
        ) : readerRole === null ? (
          <p className="issue-types-note">Your role on this project is unknown, so issue types cannot be changed here.</p>
        ) : null}

        <p className="issue-types-note issue-types-intro">
          Types appear in this order across the project. New issues start as the first one.
        </p>

        {/* The dialog's one notice slot (§4.30, §4.22's recipe): one polite
            region that stays mounted and changes its text; the server's words
            and the request id under it, outside the region. */}
        <NoticeSlot notice={notice} register={register} />

        {registry ? (
          registry.length === 0 ? (
            <p className="issue-types-empty">This project has no issue types yet, so no issue can be created in it.</p>
          ) : (
            <ol aria-label="Issue types" className="issue-type-list">
              {registry.map((entry, index) =>
                form?.kind === "edit" && form.code === entry.code ? (
                  <li className="issue-type-row is-editing" key={entry.code}>
                    <IssueTypeForm
                      error={formError}
                      frozen={inFlight}
                      inFlight={inFlight}
                      mode={{ kind: "edit", entry }}
                      onCancel={closeForm}
                      onSubmit={(_values, changes) =>
                        write.mutate({ kind: "edit", code: entry.code, input: changes, name: labelOf(entry.code) })
                      }
                      projectId={projectId}
                      register={register}
                      registry={types}
                      takenCode={null}
                    />
                  </li>
                ) : (
                  <IssueTypeRow
                    busy={busy}
                    confirming={confirm?.code === entry.code}
                    count={registry.length}
                    entry={entry}
                    highlighted={highlight === entry.code}
                    index={index}
                    isAdmin={isAdmin}
                    key={entry.code}
                    label={labelOf(entry.code)}
                    onEdit={() => openForm({ kind: "edit", code: entry.code })}
                    onMove={(direction) => move(index, direction)}
                    onToggleDelete={() => toggleConfirm(entry.code)}
                    orderBusy={inFlight}
                    register={register}
                    renderStrip={(id) =>
                      confirm?.code === entry.code ? (
                        <DeleteTypeStrip
                          confirm={confirm}
                          entry={entry}
                          error={
                            write.isError && write.variables?.kind === "delete" && write.variables.code === entry.code
                              ? write.error
                              : null
                          }
                          frozen={inFlight || pendingDelete !== null}
                          id={id}
                          inFlight={inFlight}
                          key={`${entry.code}:${confirm.attempt}`}
                          name={labelOf(entry.code)}
                          onCancel={cancelConfirm}
                          onSend={(move) => {
                            if (inFlight) return;
                            if (pendingDelete) {
                              repeatPending(pendingDelete);
                              return;
                            }
                            write.mutate({ kind: "delete", code: entry.code, name: labelOf(entry.code), index, move });
                          }}
                          refusedTarget={
                            write.variables?.kind === "delete" && write.variables.move ? write.variables.move.target : ""
                          }
                          register={register}
                          registry={types}
                          workflows={workflows}
                        />
                      ) : null
                    }
                  />
                ),
              )}
            </ol>
          )
        ) : contextError ? (
          // A state found on opening, not an answer to anything the reader
          // did, so not announced (§5.6). Reopening the dialog asks again.
          <ApiNotice error={contextError} live="off">
            This project&rsquo;s issue types could not be loaded.
          </ApiNotice>
        ) : (
          <div aria-busy="true" className="issue-type-list">
            <p className="visually-hidden" role="status">
              Loading issue types
            </p>
            {[0, 1, 2].map((row) => (
              <div aria-hidden="true" className="issue-type-row is-skeleton" key={row}>
                <span className="value-skeleton issue-type-skeleton-tile" />
                <span className="issue-type-text">
                  <span className="value-skeleton issue-type-skeleton-name" />
                  <span className="value-skeleton issue-type-skeleton-code" />
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

/** "Add type" (§4.30): `aria-disabled` while a write is out, so it keeps focus and answers nothing. */
function AddTypeButton({ busy, onOpen, register }: { busy: boolean; onOpen: () => void; register: Register }) {
  return (
    <button
      aria-disabled={busy || undefined}
      className="secondary-button compact-button issue-types-add"
      onClick={onOpen}
      ref={register("trigger:add")}
      type="button"
    >
      <Plus size={13} />
      Add type
    </button>
  );
}

/**
 * The dialog's one notice slot (§4.30, §4.22's recipe): a polite region that
 * stays mounted and changes its text; the server's words and the request id
 * under it, outside the region. A place script may put focus, never a Tab stop.
 */
function NoticeSlot({ notice, register }: { notice: Notice | null; register: Register }) {
  return (
    <div
      className={notice ? "issue-types-slot member-note is-error" : "issue-types-slot"}
      ref={register("notice")}
      tabIndex={notice ? -1 : undefined}
    >
      <p aria-live="polite" className="member-note-sentence">
        {notice?.sentence ?? ""}
      </p>
      <NoteDetail error={notice?.error} serverWords={notice?.serverWords ?? true} />
    </div>
  );
}

/** The slot's second line: the server's words — §5.7's for an archive — unless left off, and the request id. */
function NoteDetail({ error, serverWords }: { error: unknown; serverWords: boolean }) {
  const { requestId } = apiErrorFacts(error);
  const message = error && serverWords ? refusalWords(error) : null;
  if (!message && !requestId) return null;
  return (
    <p className="member-note-detail">
      {message ? <span>{message}</span> : null}
      {requestId ? <RequestId value={requestId} /> : null}
    </p>
  );
}

/**
 * One type (§4.30): chip 14 · name over code · the `default` marker on the
 * first · for an ADMIN, Move up, Move down, Edit and Delete. The ends' moves
 * are `aria-disabled` and stay, so focus never falls out of the list; a lone
 * type has no Delete, an empty slot keeps the column, and a line says why.
 */
function IssueTypeRow({
  entry,
  label,
  index,
  count,
  isAdmin,
  busy,
  orderBusy,
  confirming,
  highlighted,
  register,
  onMove,
  onEdit,
  onToggleDelete,
  renderStrip,
}: {
  entry: ProjectIssueType;
  label: string;
  index: number;
  count: number;
  isAdmin: boolean;
  /** Any write of the dialog is out, a reorder included. */
  busy: boolean;
  /** Moves wait only for a form's or a delete's write; presses during a reorder join its queue. */
  orderBusy: boolean;
  confirming: boolean;
  highlighted: boolean;
  register: Register;
  onMove: (direction: "up" | "down") => void;
  onEdit: () => void;
  onToggleDelete: () => void;
  /** The delete strip under the row, with the id its Delete controls; `null` while it is closed. */
  renderStrip: (id: string) => ReactNode;
}) {
  const ids = useId();
  const confirmId = `${ids}-confirm`;
  const first = index === 0;
  const last = index === count - 1;
  const deletable = count >= 2;
  const moveButton = (direction: "up" | "down") => {
    const edge = direction === "up" ? first : last;
    return (
      <button
        aria-disabled={edge || orderBusy || undefined}
        aria-label={`Move ${label} ${direction}`}
        className={`icon-button issue-type-action${edge ? " is-unavailable" : ""}`}
        onClick={() => {
          if (!edge && !orderBusy) onMove(direction);
        }}
        ref={register(`${direction}:${entry.code}`)}
        // The ends say their limit themselves (§4.30): no title there.
        title={edge ? undefined : direction === "up" ? "Move up" : "Move down"}
        type="button"
      >
        {direction === "up" ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
      </button>
    );
  };

  return (
    <li className={`issue-type-row${highlighted ? " is-highlighted" : ""}`}>
      <TypeLookChip color={entry.color} icon={entry.icon} shape={entry.shape} title={label} />
      <span className="issue-type-text">
        <span className="issue-type-name-line">
          <span className="issue-type-name" title={label}>
            {label}
          </span>
          {first ? (
            <span className="workflow-marker" title="New issues start as this type">
              default
            </span>
          ) : null}
        </span>
        <span className="issue-type-code">{entry.code}</span>
      </span>
      {isAdmin ? (
        <span className="issue-type-actions">
          {moveButton("up")}
          {moveButton("down")}
          <button
            aria-disabled={busy || undefined}
            aria-label={`Edit ${label}`}
            className="icon-button issue-type-action"
            onClick={() => {
              if (!busy) onEdit();
            }}
            ref={register(`edit:${entry.code}`)}
            title="Edit"
            type="button"
          >
            <Pencil size={14} />
          </button>
          {deletable ? (
            <button
              aria-controls={confirming ? confirmId : undefined}
              aria-disabled={busy || undefined}
              aria-expanded={confirming}
              aria-label={`Delete ${label}`}
              className="icon-button issue-type-action issue-type-delete"
              onClick={onToggleDelete}
              ref={register(`delete:${entry.code}`)}
              title="Delete"
              type="button"
            >
              <Trash2 size={14} />
            </button>
          ) : (
            <span aria-hidden="true" className="issue-type-action-slot" />
          )}
        </span>
      ) : null}
      {isAdmin && !deletable ? (
        <p className="issue-type-row-note">A project needs at least one issue type, so this one cannot be deleted.</p>
      ) : null}
      {confirming ? renderStrip(confirmId) : null}
    </li>
  );
}

/**
 * The delete strip of a type (§4.30, backend TAS-433): §4.22's question first,
 * sent with no body. A type live issues have is refused `ISSUE_TYPE_IN_USE`,
 * and the strip becomes its move step — another type for those issues, chosen
 * from the registry with nothing chosen beforehand, sent with the entry's
 * `generation`. A target whose workflow lacks a status the issues are in adds
 * a select per status (`ISSUE_STATUSES_UNMAPPED`), for that target only:
 * choosing another target takes them away. More issues than the server moves
 * at once is a dead end, said once.
 */
function DeleteTypeStrip({
  id,
  entry,
  name,
  registry,
  workflows,
  confirm,
  refusedTarget,
  inFlight,
  frozen,
  error,
  register,
  onCancel,
  onSend,
}: {
  id: string;
  entry: ProjectIssueType;
  name: string;
  registry: readonly ProjectIssueType[];
  workflows: ProjectContext["workflows"] | undefined;
  confirm: DeleteConfirm;
  /** The label of the target the last refused move named — what `ISSUE_TYPE_TARGET_INVALID` is about. */
  refusedTarget: string;
  inFlight: boolean;
  /** In flight, or the strip's command held for its repeat: a select keeps what it shows. */
  frozen: boolean;
  error: Error | null;
  register: Register;
  onCancel: () => void;
  onSend: (move?: { input: DeleteProjectIssueTypeInput; target: string }) => void;
}) {
  const [target, setTarget] = useState("");
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const typeOptions = registry
    .filter((item) => item.code !== entry.code)
    .map((item) => ({ key: item.code, label: issueTypeLabel(item.code, registry) }));
  const chosenTarget = typeOptions.some((option) => option.key === target) ? target : "";
  const targetLabel = chosenTarget ? issueTypeLabel(chosenTarget, registry) : "";
  const count = confirm.inUse ? inUseCountOf(confirm.inUse) : null;
  const statuses = confirm.statuses && confirm.statuses.target === chosenTarget ? confirm.statuses : null;
  // Where the issues may go: exactly the keys the server named, in the
  // target workflow's column order and with its labels; a key it lacks last.
  const targetStatuses = workflows?.[chosenTarget]?.statuses ?? [];
  const named = statuses ? targetStatusKeysOf(statuses.refusal) : [];
  const statusOptions = [
    ...statusesInColumnOrder(targetStatuses)
      .filter((status) => named.includes(status.statusKey))
      .map((status) => status.statusKey),
    ...named.filter((key) => !targetStatuses.some((status) => status.statusKey === key)),
  ].map((key) => ({ key, label: statusLabel(key, targetStatuses) }));
  const sources = statuses ? namedStatusKeys(apiErrorFacts(statuses.refusal).details) : [];
  const chosenStatus = (key: string) => (statusOptions.some((option) => option.key === mapping[key]) ? mapping[key] : "");
  const answerLabel = confirm.inUse ? "Move and delete" : "Delete type";

  const say = (refusal: Error) =>
    isCommandPending(refusal) ? (
      <PendingNote error={refusal} label={answerLabel} />
    ) : (
      <ErrorNote live="alert" requestId={apiErrorFacts(refusal).requestId} serverWords={refusalWords(refusal)}>
        {isIssueTypeTargetInvalid(refusal)
          ? `${refusedTarget || "That type"} is no longer one of this project’s types. Choose another.`
          : `${name} was not deleted.`}
      </ErrorNote>
    );

  let step: MoveStep | undefined;
  if (confirm.limit) {
    step = { refusal: confirm.limit, sentence: migrationLimitSentence(confirm.limit, name), fields: null, blocked: true };
  } else if (confirm.inUse) {
    step = {
      refusal: statuses ? statuses.refusal : confirm.inUse,
      sentence: statuses ? issueTypeStatusesSentence(count, targetLabel) : issueTypeMoveSentence(count, name),
      blocked: !chosenTarget || sources.some((key) => chosenStatus(key) === ""),
      fields: (
        <>
          <TargetSelect
            focusKey="step"
            frozen={frozen}
            label="Move them to"
            onChange={(code) => {
              setTarget(code);
              setMapping({});
            }}
            options={typeOptions}
            placeholder="Choose a type"
            register={register}
            value={chosenTarget}
          />
          {sources.map((key, index) => (
            <TargetSelect
              focusKey={index === 0 ? "status-step" : undefined}
              frozen={frozen}
              key={key}
              label={`Move ${statusLabel(key, workflows?.[entry.code]?.statuses ?? [])} issues to`}
              onChange={(status) => setMapping((current) => ({ ...current, [key]: status }))}
              options={statusOptions}
              register={register}
              value={chosenStatus(key)}
            />
          ))}
        </>
      ),
    };
  }

  // A refusal the step answers — the in-use count, a target's statuses, the
  // limit — is said by the step, never again over the actions, even once the
  // reader has chosen another target and the statuses are gone.
  const answered = [confirm.inUse, confirm.statuses?.refusal, confirm.limit];

  return (
    <ConfirmStrip
      answerLabel={answerLabel}
      className="issue-type-confirm"
      error={error && !answered.includes(error) ? error : null}
      id={id}
      inFlight={inFlight}
      onAnswer={
        confirm.limit
          ? null
          : () => {
              if (!confirm.inUse) {
                onSend();
                return;
              }
              onSend({
                input: {
                  moveIssuesTo: chosenTarget,
                  ...(entry.generation ? { expectedGeneration: entry.generation } : {}),
                  ...(statuses ? { statusMappings: Object.fromEntries(sources.map((key) => [key, chosenStatus(key)])) } : {}),
                },
                target: targetLabel,
              });
            }
      }
      onCancel={onCancel}
      register={register}
      sayRefusal={say}
      sentence={`${name} will be deleted from this project for everyone. If issues have this type, you will choose another type for them first.`}
      step={step}
    />
  );
}

type FormMode = { kind: "create" } | { kind: "edit"; entry: ProjectIssueType };

/**
 * What New type's «Workflow» select offers (§4.30, TAS-437), from the list
 * Workflows reads (`["project-workflows", projectId]`, read on opening the
 * form when it is not in the cache): the project's own workflows in that
 * dialog's order, donors included, then the shared default when the list
 * carries it — and `main`, the one the registry's first type runs on, named
 * «(same as {First})» and chosen until the reader picks another. Until the
 * list has answered — or when it could not be read (`failed`) — there is no
 * option but `sameAsFirst`, sent without a `workflowId`: the server takes the
 * same main workflow, and the form does not wait.
 */
function useWorkflowChoice(projectId: string, registry: readonly ProjectIssueType[], creating: boolean) {
  const query = useQuery({ ...projectWorkflowsOptions(projectId), enabled: creating });
  const first = registry[0]?.code;
  const firstLabel = first ? issueTypeLabel(first, registry) : "";
  const entries = query.data ? orderWorkflowEntries(query.data, registry.map((entry) => entry.code)) : null;
  const main = entries?.find((entry) => first !== undefined && entry.issueTypes.includes(first)) ?? null;
  const options = entries
    ? [...entries.filter((entry) => !entry.shared), ...entries.filter((entry) => entry.shared)].map((entry) => {
        const name = entry.workflow.name.trim() || "Unnamed workflow";
        const same = entry === main ? `same as ${firstLabel}` : "";
        return {
          id: entry.workflow.id,
          label: entry.shared ? `${name} (${same ? `shared, ${same}` : "shared"})` : same ? `${name} (${same})` : name,
        };
      })
    : [];
  return {
    options,
    main: main?.workflow.id ?? null,
    sameAsFirst: `Same as ${firstLabel}`,
    failed: !query.data && query.isError,
  };
}

/**
 * The add and edit form (§4.30): a box with the live chip and its heading,
 * Name and Code side by side (Code only when creating), the seven colours and
 * the three shapes side by side, «No icon» and the eight icons, the reason the
 * submit is off, the refusal, Cancel and the submit. No optimism: the answer is
 * what the list draws.
 *
 * A chosen icon is drawn instead of the shape (§4.6), so while one is chosen
 * the Shape group is steadily unavailable — its choice is kept, and sent: a
 * create always states its shape, an edit the shape if it changed.
 */
function IssueTypeForm({
  mode,
  projectId,
  registry,
  takenCode,
  inFlight,
  frozen,
  error,
  register,
  onCancel,
  onSubmit,
}: {
  mode: FormMode;
  projectId: string;
  registry: readonly ProjectIssueType[];
  /** A code the server refused as taken (409), said as the Code field's reason while it is typed. */
  takenCode: string | null;
  inFlight: boolean;
  /** In flight, or a create held for its repeat (§4.28 «Ещё применяется»): every field keeps what it shows. */
  frozen: boolean;
  error: Error | null;
  register: Register;
  onCancel: () => void;
  /**
   * The whole form (`icon: null` — «No icon»; `workflowId` the chosen
   * workflow, or none while only the main one is offered), and — for an edit
   * — only what differs from the saved entry, which is all a PATCH sends:
   * «No icon» on a type that has one is `icon: null` (backend TAS-432).
   */
  onSubmit: (
    values: {
      code: string;
      name: string;
      color: IssueTypeColor;
      shape: IssueTypeShape;
      icon: IssueTypeIcon | null;
      workflowId?: string;
    },
    changes: UpdateProjectIssueTypeInput,
  ) => void;
}) {
  const ids = useId();
  const editing = mode.kind === "edit" ? mode.entry : null;
  const workflowChoice = useWorkflowChoice(projectId, registry, mode.kind === "create");
  const [pickedWorkflow, setPickedWorkflow] = useState<string | null>(null);
  // The main workflow while the select is untouched — and it follows a
  // reorder; the reader's pick for as long as the list still offers it.
  const workflowId =
    pickedWorkflow !== null && workflowChoice.options.some((option) => option.id === pickedWorkflow)
      ? pickedWorkflow
      : workflowChoice.main;
  const [name, setName] = useState(editing?.name ?? "");
  const [typedCode, setTypedCode] = useState<string | null>(null);
  const [color, setColor] = useState<IssueTypeColor | null>(editing ? editing.color : defaultIssueTypeColor(registry));
  // A saved shape this build cannot draw is shown as the square it is drawn
  // as (§4.6), and is not sent back unless another shape is chosen.
  const savedShape = editing ? (editing.shape ?? DEFAULT_SHAPE) : DEFAULT_SHAPE;
  const [shape, setShape] = useState<IssueTypeShape>(savedShape);
  // `null` is «No icon» — a new type's default, and a saved icon this build
  // cannot draw, which is drawn as its shape (§4.6).
  const [icon, setIcon] = useState<IssueTypeIcon | null>(editing ? editing.icon : null);
  const shapeUnavailable = icon !== null;
  // Derived from the name until edited by hand (§4.30, as Add status).
  const code = editing ? editing.code : (typedCode ?? issueTypeCodeOf(name));
  const trimmed = name.trim();
  const cyrillic = /\p{Script=Cyrillic}/u.test(name);

  const reason = editing
    ? null
    : code !== "" && (takenCode === code || registry.some((entry) => entry.code === code))
      ? `${code} is already a type in this project.`
      : code !== "" && !ISSUE_TYPE_CODE_PATTERN.test(code)
        ? "A code starts with a letter and has 2–32 capital letters, digits or underscores."
        : null;
  const changes: UpdateProjectIssueTypeInput = editing
    ? {
        ...(trimmed !== editing.name ? { name: trimmed } : {}),
        ...(color !== null && color !== editing.color ? { color } : {}),
        ...(shape !== savedShape ? { shape } : {}),
        ...(icon !== editing.icon ? { icon } : {}),
      }
    : {};
  const blocked =
    trimmed === "" ||
    code === "" ||
    reason !== null ||
    color === null ||
    (editing !== null && Object.keys(changes).length === 0);
  const reasonId = `${ids}-reason`;
  const shapeNoteId = `${ids}-shape-note`;
  const codeHintId = `${ids}-code-hint`;
  const refused = editing ? "The type was not saved." : "The type was not added.";
  const heading = editing ? `Edit ${issueTypeLabel(editing.code, registry)}` : "New type";

  return (
    <form
      aria-labelledby={`${ids}-title`}
      className="issue-type-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (inFlight || blocked || color === null) return;
        onSubmit({ code, name: trimmed, color, shape, icon, ...(workflowId ? { workflowId } : {}) }, changes);
      }}
    >
      <div className="issue-type-form-head">
        <TypeLookChip color={color} icon={icon} shape={shape} />
        <h3 id={`${ids}-title`}>{heading}</h3>
      </div>
      <div className="form-two issue-type-form-two">
        <div className="workflow-field">
          <label htmlFor={`${ids}-name`}>Name</label>
          <input
            aria-describedby={cyrillic && code ? `${ids}-cyrillic` : undefined}
            autoFocus
            id={`${ids}-name`}
            maxLength={ISSUE_TYPE_NAME_MAX_LENGTH}
            onChange={(event) => {
              if (!frozen) setName(event.target.value);
            }}
            readOnly={frozen}
            value={name}
          />
          {cyrillic && code ? (
            <p className="workflow-field-note" id={`${ids}-cyrillic`}>
              Names in Cyrillic are not shown in Taska, so this type will read as {issueTypeFallbackLabel(code)}.
            </p>
          ) : null}
        </div>
        <div className="workflow-field">
          {editing ? (
            <>
              <span>Code</span>
              <span className="issue-type-code-static">{editing.code}</span>
              <p className="workflow-field-note">A code cannot be changed.</p>
            </>
          ) : (
            <>
              <label htmlFor={`${ids}-code`}>Code</label>
              <input
                aria-describedby={codeHintId}
                className="mono-input"
                id={`${ids}-code`}
                maxLength={ISSUE_TYPE_CODE_MAX_LENGTH}
                onChange={(event) => {
                  if (!frozen) setTypedCode(issueTypeCodeOf(event.target.value));
                }}
                readOnly={frozen}
                ref={register("code")}
                spellCheck={false}
                value={code}
              />
              <p className="workflow-field-note" id={codeHintId}>
                Capital letters, digits and underscores. A code cannot be changed later.
              </p>
            </>
          )}
        </div>
      </div>
      <div className="form-two issue-type-form-two">
        <div className="workflow-field">
          <span id={`${ids}-colour`}>Colour</span>
          <ColorSwatches
            choices={COLOR_CHOICES}
            groupLabel="Colour"
            onPick={(value) => {
              if (value !== null && !frozen) setColor(value as IssueTypeColor);
            }}
            selected={color}
          />
        </div>
        <div className="workflow-field">
          <span>Shape</span>
          {/* The note is each button's description rather than the group's:
              a focused button announces it, a group's is read unreliably. */}
          <div aria-label="Shape" className="issue-type-icons" role="group">
            {ISSUE_TYPE_SHAPES.map((option) => (
              <button
                aria-describedby={shapeUnavailable ? shapeNoteId : undefined}
                aria-disabled={shapeUnavailable || undefined}
                aria-label={SHAPE_NAMES[option]}
                aria-pressed={shape === option}
                className={`issue-type-icon-option${shape === option ? " is-active" : ""}`}
                key={option}
                onClick={() => {
                  if (!shapeUnavailable && !frozen) setShape(option);
                }}
                title={SHAPE_NAMES[option]}
                type="button"
              >
                <span aria-hidden="true" className={`type-chip is-${option}`} />
              </button>
            ))}
          </div>
          {shapeUnavailable ? (
            <p className="workflow-field-note" id={shapeNoteId}>
              A type with an icon shows the icon instead of a shape.
            </p>
          ) : null}
        </div>
      </div>
      <div className="workflow-field">
        <span>Icon</span>
        <div aria-label="Icon" className="issue-type-icons" role="group">
          <button
            aria-label="No icon"
            aria-pressed={icon === null}
            className={`issue-type-icon-option${icon === null ? " is-active" : ""}`}
            onClick={() => {
              if (!frozen) setIcon(null);
            }}
            title="No icon"
            type="button"
          >
            <span aria-hidden="true" className="issue-type-no-icon" />
          </button>
          {ISSUE_TYPE_ICONS.map((option) => (
            <button
              aria-label={ICON_NAMES[option]}
              aria-pressed={icon === option}
              className={`issue-type-icon-option${icon === option ? " is-active" : ""}`}
              key={option}
              onClick={() => {
                if (!frozen) setIcon(option);
              }}
              title={ICON_NAMES[option]}
              type="button"
            >
              <IssueTypeGlyph icon={option} size={15} />
            </button>
          ))}
        </div>
      </div>
      {mode.kind === "create" && registry.length > 0 ? (
        // «Workflow» (§4.30, TAS-437): after the look, before the actions —
        // the chip carries how the type looks, the submit what it does.
        <div className="workflow-field">
          <label htmlFor={`${ids}-workflow`}>Workflow</label>
          <select
            aria-describedby={workflowChoice.failed ? `${ids}-workflow-note` : undefined}
            id={`${ids}-workflow`}
            onChange={(event) => {
              if (!frozen) setPickedWorkflow(event.target.value);
            }}
            value={workflowId ?? ""}
          >
            {workflowChoice.main === null ? <option value="">{workflowChoice.sameAsFirst}</option> : null}
            {workflowChoice.options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          {workflowChoice.failed ? (
            <p className="workflow-field-note" id={`${ids}-workflow-note`}>
              Other workflows could not be loaded, so only this one is offered.
            </p>
          ) : null}
        </div>
      ) : null}
      {reason ? (
        <p className="admin-write-hint issue-type-hint" id={reasonId}>
          {reason}
        </p>
      ) : null}
      {error ? (
        isCommandPending(error) ? (
          <PendingNote error={error} label="Add type" />
        ) : (
          <ErrorNote live="alert" requestId={apiErrorFacts(error).requestId} serverWords={refusalWords(error)}>
            {refused}
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
          aria-describedby={reason ? reasonId : undefined}
          aria-disabled={inFlight || blocked || undefined}
          className={`primary-button compact-button${blocked && !inFlight ? " is-unavailable" : ""}`}
          ref={register("submit")}
          type="submit"
        >
          {editing ? "Save changes" : "Add type"}
        </button>
      </div>
    </form>
  );
}
