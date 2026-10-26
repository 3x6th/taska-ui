import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { CreateProjectIssueTypeInput, UpdateProjectIssueTypeInput } from "../api/TaskaApi";
import { taskaApi } from "../api/client";
import { apiErrorFacts } from "../api/errors";
import {
  ISSUE_TYPE_CODE_MAX_LENGTH,
  ISSUE_TYPE_CODE_PATTERN,
  ISSUE_TYPE_COLORS,
  ISSUE_TYPE_ICONS,
  ISSUE_TYPE_NAME_MAX_LENGTH,
  LAST_ISSUE_TYPE_REASON,
} from "../api/issueTypes";
import type { IssueTypeColor, IssueTypeIcon, ProjectContext, ProjectIssueType, ProjectRole } from "../domain/types";
import { boardKey } from "../lib/boardQuery";
import { issueTypeColorValue, issueTypeFallbackLabel, issueTypeLabel, keyBadgeStyle } from "../lib/format";
import {
  defaultIssueTypeColor,
  issueTypeCodeOf,
  issueTypeDeleteRefusalText,
  movedIssueTypeCodes,
  nextIssueTypeSortOrder,
  withIssueTypeOrder,
} from "../lib/issueTypes";
import { refusalWords } from "../lib/projectArchive";
import { projectContextKey } from "../lib/projectContext";
import { ApiNotice } from "./ApiNotice";
import { ColorSwatches } from "./ColorSwatches";
import { ErrorNote } from "./ErrorNote";
import { IssueTypeGlyph, TypeTile } from "./IssueBits";
import { Modal } from "./Modal";
import { projectWorkflowsKey } from "./projectWorkflowsQuery";
import { RequestId } from "./RequestId";

/**
 * Issue types (DESIGN.md §4.30, TAS-417): the project's issue-type registry,
 * readable by everyone on the project and written by its ADMIN — add, rename,
 * recolour, change the icon, reorder, delete an unused one.
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

/** A new type's icon (§4.30). */
const DEFAULT_ICON: IssueTypeIcon = "file-text";
/** How long a row a write made holds §4.28's highlight. */
const HIGHLIGHT_MS = 2000;
/** The registry's dialog sentence when a move is refused (§4.30). */
const ORDER_REFUSED_SENTENCE = "The new order was not saved. The list now shows the saved order.";

type OpenForm = { kind: "create" } | { kind: "edit"; code: string };

type TypeWrite =
  | { kind: "create"; input: CreateProjectIssueTypeInput; name: string }
  | { kind: "edit"; code: string; input: UpdateProjectIssueTypeInput; name: string }
  | { kind: "delete"; code: string; name: string; index: number };

/** What a write answered: the saved entry, or for a delete whether it had already gone. */
type WriteAnswer = { entry: ProjectIssueType } | { alreadyGone: boolean };

interface Notice {
  sentence: string;
  error?: unknown;
}

/** A ref callback that files a node under a key, for `pendingFocus` to find. */
type Register = (key: string) => (node: HTMLElement | null) => void;

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
  const [openedConfirm, setConfirm] = useState<string | null>(null);
  const confirm = isAdmin && openedConfirm && types.some((entry) => entry.code === openedConfirm) ? openedConfirm : null;
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
      switch (sent.kind) {
        case "create":
          return { entry: await taskaApi.createProjectIssueType(projectId, sent.input) };
        case "edit":
          return { entry: await taskaApi.updateProjectIssueType(projectId, sent.code, sent.input) };
        case "delete":
          try {
            await taskaApi.deleteProjectIssueType(projectId, sent.code);
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
      if (sent.kind === "delete") {
        const remaining = types.filter((entry) => entry.code !== sent.code);
        setRegistry((current) => current.filter((entry) => entry.code !== sent.code));
        void queryClient.invalidateQueries({ queryKey: contextKey });
        invalidateDependents();
        setConfirm(null);
        const gone = "alreadyGone" in answer && answer.alreadyGone;
        setAnnouncement(gone ? `${sent.name} was already deleted.` : `Type ${sent.name} deleted.`);
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
        void queryClient.invalidateQueries({ queryKey: contextKey });
        invalidateDependents();
        setAnnouncement(`Type ${issueTypeLabel(entry.code, [entry])} added.`);
        pendingFocus.current = ["trigger:add"];
      } else {
        // A name, a colour or an icon: the answer is the whole entry, and no read follows.
        setRegistry((current) => current.map((item) => (item.code === entry.code ? entry : item)));
        setAnnouncement(`Type ${issueTypeLabel(entry.code, [entry])} saved.`);
        pendingFocus.current = [`edit:${entry.code}`];
      }
    },
    onError: (error, sent) => {
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
   * and the writes go one at a time in the order pressed. Any refusal — the
   * stale set's 400 `INVALID_ARGUMENT` among them, which carries no reason
   * (backend ask A10) and is never told apart by its words — stops what is
   * still queued, reads the context again and says so in the slot; the board
   * and Workflows are read again once the queue is empty.
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
        setNotice({ sentence: ORDER_REFUSED_SENTENCE, error });
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

  const openForm = (next: OpenForm) => {
    if (busy) return;
    write.reset();
    setTakenCode(null);
    setNotice(null);
    setConfirm(null);
    setForm(next);
  };
  const closeForm = () => {
    if (inFlight || !form) return;
    write.reset();
    setTakenCode(null);
    pendingFocus.current = [form.kind === "create" ? "trigger:add" : `edit:${form.code}`];
    setForm(null);
  };
  const toggleConfirm = (code: string) => {
    if (busy) return;
    write.reset();
    setForm(null);
    setNotice(null);
    const opening = confirm !== code;
    // The strip's Cancel takes focus first (§4.22); closed again, focus stays on Delete.
    if (opening) pendingFocus.current = ["cancel"];
    setConfirm(opening ? code : null);
  };
  const cancelConfirm = () => {
    if (inFlight || !confirm) return;
    pendingFocus.current = [`delete:${confirm}`];
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
              inFlight={inFlight}
              key="create"
              mode={{ kind: "create" }}
              onCancel={closeForm}
              onSubmit={(input) =>
                write.mutate({
                  kind: "create",
                  input: { ...input, sortOrder: nextIssueTypeSortOrder(types) },
                  name: issueTypeLabel(input.code, [{ ...input, sortOrder: 0 }]),
                })
              }
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
                      inFlight={inFlight}
                      mode={{ kind: "edit", entry }}
                      onCancel={closeForm}
                      onSubmit={(_values, changes) =>
                        write.mutate({ kind: "edit", code: entry.code, input: changes, name: labelOf(entry.code) })
                      }
                      register={register}
                      registry={types}
                      takenCode={null}
                    />
                  </li>
                ) : (
                  <IssueTypeRow
                    busy={busy}
                    confirming={confirm === entry.code}
                    count={registry.length}
                    entry={entry}
                    highlighted={highlight === entry.code}
                    index={index}
                    inFlight={inFlight}
                    isAdmin={isAdmin}
                    key={entry.code}
                    label={labelOf(entry.code)}
                    onAcceptDelete={() => {
                      if (inFlight) return;
                      write.mutate({ kind: "delete", code: entry.code, name: labelOf(entry.code), index });
                    }}
                    onCancelDelete={cancelConfirm}
                    onEdit={() => openForm({ kind: "edit", code: entry.code })}
                    onMove={(direction) => move(index, direction)}
                    onToggleDelete={() => toggleConfirm(entry.code)}
                    orderBusy={inFlight}
                    register={register}
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
      <NoteDetail error={notice?.error} />
    </div>
  );
}

/** The slot's second line: the server's words — §5.7's for an archive — and the request id. */
function NoteDetail({ error }: { error: unknown }) {
  const { requestId } = apiErrorFacts(error);
  const message = error ? refusalWords(error) : null;
  if (!message && !requestId) return null;
  return (
    <p className="member-note-detail">
      {message ? <span>{message}</span> : null}
      {requestId ? <RequestId value={requestId} /> : null}
    </p>
  );
}

/**
 * One type (§4.30): tile 16 · name over code · the `default` marker on the
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
  inFlight,
  orderBusy,
  confirming,
  highlighted,
  register,
  onMove,
  onEdit,
  onToggleDelete,
  onCancelDelete,
  onAcceptDelete,
}: {
  entry: ProjectIssueType;
  label: string;
  index: number;
  count: number;
  isAdmin: boolean;
  /** Any write of the dialog is out, a reorder included. */
  busy: boolean;
  /** A form's or a delete's write is out. */
  inFlight: boolean;
  /** Moves wait only for a form's or a delete's write; presses during a reorder join its queue. */
  orderBusy: boolean;
  confirming: boolean;
  highlighted: boolean;
  register: Register;
  onMove: (direction: "up" | "down") => void;
  onEdit: () => void;
  onToggleDelete: () => void;
  onCancelDelete: () => void;
  onAcceptDelete: () => void;
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
      <TypeTile color={entry.color} icon={entry.icon} title={label} />
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
      {confirming ? (
        <div className="member-confirm issue-type-confirm" id={confirmId}>
          <p className="member-confirm-sentence" id={`${confirmId}-sentence`}>
            {label} will be deleted from this project for everyone. A type cannot be deleted while any issue has it.
          </p>
          <div className="member-confirm-actions">
            <button
              aria-disabled={inFlight || undefined}
              className="secondary-button compact-button"
              onClick={onCancelDelete}
              ref={register("cancel")}
              type="button"
            >
              Cancel
            </button>
            <button
              aria-describedby={`${confirmId}-sentence`}
              aria-disabled={inFlight || undefined}
              className="secondary-button compact-button member-confirm-accept"
              onClick={onAcceptDelete}
              type="button"
            >
              Delete type
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

type FormMode = { kind: "create" } | { kind: "edit"; entry: ProjectIssueType };

/**
 * The add and edit form (§4.30): a box with the live tile and its heading,
 * Name and Code side by side (Code only when creating), the seven colours and
 * the eight icons, the reason the submit is off, the refusal, Cancel and the
 * submit. No optimism: the answer is what the list draws.
 */
function IssueTypeForm({
  mode,
  registry,
  takenCode,
  inFlight,
  error,
  register,
  onCancel,
  onSubmit,
}: {
  mode: FormMode;
  registry: readonly ProjectIssueType[];
  /** A code the server refused as taken (409), said as the Code field's reason while it is typed. */
  takenCode: string | null;
  inFlight: boolean;
  error: Error | null;
  register: Register;
  onCancel: () => void;
  /** The whole form, and — for an edit — only what differs from the saved entry, which is all a PATCH sends. */
  onSubmit: (
    values: { code: string; name: string; color: IssueTypeColor; icon: IssueTypeIcon },
    changes: UpdateProjectIssueTypeInput,
  ) => void;
}) {
  const ids = useId();
  const editing = mode.kind === "edit" ? mode.entry : null;
  const [name, setName] = useState(editing?.name ?? "");
  const [typedCode, setTypedCode] = useState<string | null>(null);
  const [color, setColor] = useState<IssueTypeColor | null>(editing ? editing.color : defaultIssueTypeColor(registry));
  const [icon, setIcon] = useState<IssueTypeIcon | null>(editing ? editing.icon : DEFAULT_ICON);
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
        ...(icon !== null && icon !== editing.icon ? { icon } : {}),
      }
    : {};
  const blocked =
    trimmed === "" ||
    code === "" ||
    reason !== null ||
    color === null ||
    icon === null ||
    (editing !== null && Object.keys(changes).length === 0);
  const reasonId = `${ids}-reason`;
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
        if (inFlight || blocked || color === null || icon === null) return;
        onSubmit({ code, name: trimmed, color, icon }, changes);
      }}
    >
      <div className="issue-type-form-head">
        <TypeTile color={color} icon={icon} />
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
            onChange={(event) => setName(event.target.value)}
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
                onChange={(event) => setTypedCode(issueTypeCodeOf(event.target.value))}
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
      <div className="workflow-field">
        <span id={`${ids}-colour`}>Colour</span>
        <ColorSwatches
          choices={COLOR_CHOICES}
          groupLabel="Colour"
          onPick={(value) => {
            if (value !== null) setColor(value as IssueTypeColor);
          }}
          selected={color}
        />
      </div>
      <div className="workflow-field">
        <span>Icon</span>
        <div aria-label="Icon" className="issue-type-icons" role="group">
          {ISSUE_TYPE_ICONS.map((option) => {
            return (
              <button
                aria-label={ICON_NAMES[option]}
                aria-pressed={icon === option}
                className={`issue-type-icon-option${icon === option ? " is-active" : ""}`}
                key={option}
                onClick={() => setIcon(option)}
                title={ICON_NAMES[option]}
                type="button"
              >
                <IssueTypeGlyph icon={option} size={15} />
              </button>
            );
          })}
        </div>
      </div>
      {reason ? (
        <p className="admin-write-hint issue-type-hint" id={reasonId}>
          {reason}
        </p>
      ) : null}
      {error ? (
        <ErrorNote live="alert" requestId={apiErrorFacts(error).requestId} serverWords={refusalWords(error)}>
          {refused}
        </ErrorNote>
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
