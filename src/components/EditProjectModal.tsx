import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { taskaApi } from "../api/client";
import { apiErrorFacts, isProjectArchived } from "../api/errors";
import type { UpdateProjectInput } from "../api/TaskaApi";
import type { Project, ProjectContext, ProjectStats } from "../domain/types";
import { PROJECT_STATS_KEY } from "../lib/boardQuery";
import { focusLost } from "../lib/focusTrap";
import { computedProjectColor, keyBadgeStyle, labelColorChoices } from "../lib/format";
import { refusalWords } from "../lib/projectArchive";
import { projectContextKey } from "../lib/projectContext";
import { ColorSwatches, type ColorChoice } from "./ColorSwatches";
import { ErrorNote } from "./ErrorNote";
import { Modal } from "./Modal";

/**
 * The project's own three editable fields — `PATCH /projects/{projectId}`,
 * backend PR #155 (TAS-145). Opened from the card on `/projects` and from the
 * board's header, which is why it lives here rather than inside either screen.
 *
 * ADMIN only, and both callers decide that before rendering this: the board
 * from the `membershipQuery` it already holds, the projects screen from
 * `currentUserRole` on the list row and from nothing else — neither spends a
 * request of its own to find out. Hiding the control is presentation — the
 * gateway refuses the write for everybody else regardless, and a 403 arriving
 * here is shown rather than swallowed.
 *
 * The key is displayed and not editable, and that is the contract rather than a
 * simplification: `UpdateProjectRequestDto` has no `projectKey`, because the
 * key is the prefix of every `issueKey` in the project.
 *
 * It also carries the project's one destructive action, archiving
 * (`DELETE /projects/{projectId}`, backend PR #159, TAS-146), below the form
 * and behind §4.22's confirmation strip (DESIGN.md §4.11, «Опасная зона
 * диалога»). Both callers stay where they are afterwards, and `onArchived` is
 * their say in what follows, called in the same frame as `onClose`: the board
 * turns read-only and puts focus on its archive line, the projects screen hands
 * focus to the card that took the archived one's place and says what happened.
 *
 * Somebody else can archive the project while this dialog is open (§4.11,
 * §5.7, «Архив пришёл отказом записи»). It stays open, read-only: the fields
 * keep what was typed, Save and the danger zone go, Cancel and ✕ stay. The
 * board says so through `project.archivedAt`, which its context read brings;
 * the projects screen through `unlisted`, because an archived project leaves
 * `GET /projects` and its row never carries the date.
 */
export function EditProjectModal({
  project,
  onClose,
  onArchived,
  unlisted = false,
}: {
  project: Project;
  onClose: () => void;
  /** The archive went through; `archivedAt` is the one field taken from its answer. */
  onArchived?: (archivedAt: string) => void;
  /**
   * The row this dialog was opened on has left `["projects"]` — archived, or
   * the reader is no longer a member — and `project` is the last one seen.
   */
  unlisted?: boolean;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  /** What the description box opened with: text that differs from it is text-work, and holds `Esc` (§4.11). */
  const [openedDescription] = useState(description);
  /**
   * `null` is "Automatic" — the project states no colour and the client
   * computes one from the key. Seeded from what the server actually holds, so
   * a project with a colour opens on that colour and one without opens on
   * Automatic.
   *
   * Seeded raw, without `isLabelColor`. A stored colour outside these eight
   * simply matches no swatch and none draws as checked, which is the honest
   * picture — coercing it to `null` would show Automatic as the selected state
   * for a project that has a colour, and coercing it to a palette value would
   * put a checkmark on a colour the project is not wearing. Nothing unguarded
   * reaches a `style` either way: the badge goes through `keyBadgeStyle`, and
   * the comparison below means an untouched colour is never sent back.
   */
  const [color, setColor] = useState<string | null>(project.color ?? null);

  const choices = useMemo<ColorChoice[]>(
    () => [
      {
        value: null,
        // The colour the badge behind this dialog is drawing right now, from
        // the one place that rule lives. Always offered: an explicit `null`
        // clears a stored colour (backend PR #155), so picking this on a
        // coloured project is a change Save can send.
        swatch: computedProjectColor(project.projectKey),
        label: "Automatic colour, from the project key",
      },
      ...labelColorChoices.map((choice) => ({ value: choice, swatch: choice, label: `Colour ${choice}` })),
    ],
    [project.projectKey],
  );

  /**
   * Only what actually changed, which is what PATCH semantics ask for: an
   * absent key is "keep", so anything sent is a change the reader made.
   *
   * `description` compares the trimmed box against what the server holds,
   * reading `null` and `""` alike as "none". A box emptied on a project that
   * had one sends `null` — the clear (backend PR #155) — and an empty box on a
   * project that had none sends nothing.
   *
   * `color` is `null` for Automatic, and is sent whenever it differs from what
   * the server holds — so Automatic on a coloured project sends `color: null`,
   * which clears it, and an untouched colour is never sent back.
   */
  const changes = useMemo<UpdateProjectInput>(() => {
    const input: UpdateProjectInput = {};
    const trimmedName = name.trim();
    if (trimmedName && trimmedName !== project.name) input.name = trimmedName;
    const trimmedDescription = description.trim();
    const held = project.description ?? "";
    if (trimmedDescription !== held) input.description = trimmedDescription === "" ? null : trimmedDescription;
    if (color !== (project.color ?? null)) input.color = color;
    return input;
  }, [color, description, name, project.color, project.description, project.name]);

  const hasChanges = Object.keys(changes).length > 0;
  const nameIsBlank = name.trim().length === 0;
  /** Archived under the dialog, or gone from the list it was opened from: nothing here writes any more. */
  const archived = Boolean(project.archivedAt);
  const readOnly = archived || unlisted;

  const contextKey = projectContextKey(project.id);
  const save = useMutation({
    mutationFn: () => taskaApi.updateProject(project.id, changes),
    /**
     * Optimistic across both caches that hold this project, because both are on
     * screen: the card behind this dialog comes from `["projects"]`, the
     * board's own header from the project inside its context read (TAS-251).
     * Patching one and waiting for the other would make the rename appear in
     * one place and not the other.
     */
    onMutate: async (): Promise<{ list?: Project[]; single?: ProjectContext }> => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: ["projects"] }),
        queryClient.cancelQueries({ queryKey: contextKey }),
      ]);
      const list = queryClient.getQueryData<Project[]>(["projects"]);
      const single = queryClient.getQueryData<ProjectContext>(contextKey);
      const patch = (current: Project) => ({ ...current, ...changes });

      queryClient.setQueryData<Project[]>(["projects"], (current) =>
        current?.map((item) => (item.id === project.id ? patch(item) : item)),
      );
      queryClient.setQueryData<ProjectContext>(contextKey, (current) =>
        current ? { ...current, project: patch(current.project) } : current,
      );
      return { list, single };
    },
    // Both snapshots back, and the dialog stays open carrying the reason. A
    // rollback nobody is told about is what DESIGN.md §5.6 calls out: the card
    // would simply slide back to its old name with no explanation.
    onError: (_error, _variables, context) => {
      if (context?.list) queryClient.setQueryData(["projects"], context.list);
      if (context?.single) queryClient.setQueryData(contextKey, context.single);
    },
    // The server's own row wins over the optimistic patch — it carries
    // `updatedAt`, and it is the only proof of what was actually stored (a
    // blank description comes back `null`, for one).
    //
    // With one exception, and it is about the reader rather than the project:
    // `currentUserRole` is not a field this response is *about*. PR #155 as
    // merged answers `"ADMIN"`, the only role the route lets through, but the
    // reader's standing is the reads' to state, and a write answer that ever
    // came back without it would take the edit control off the card this
    // dialog just saved. Kept from the row the list already holds instead.
    onSuccess: (saved) => {
      const merge = (current: Project) => ({ ...current, ...saved, currentUserRole: current.currentUserRole });
      queryClient.setQueryData<Project[]>(["projects"], (current) =>
        current?.map((item) => (item.id === saved.id ? merge(item) : item)),
      );
      // No fallback to `saved` here, unlike the list: a context is more than its
      // project, and one nobody read is not one to build out of a write answer.
      queryClient.setQueryData<ProjectContext>(contextKey, (current) =>
        current ? { ...current, project: merge(current.project) } : current,
      );
      onClose();
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["projects"] }),
        queryClient.invalidateQueries({ queryKey: contextKey }),
      ]);
    },
  });

  // --- archiving (backend PR #159, TAS-146) ---------------------------------

  /**
   * ADMIN only, from the row this dialog was opened with — `currentUserRole`
   * on the list row or on the board's context project. Both callers already
   * gate the dialog itself on ADMIN; this is the same rule said where the
   * control is, so a third caller cannot offer it by accident. The server
   * refuses everybody else regardless (403 for a non-member and a member below
   * ADMIN).
   *
   * Never for a project already archived: neither caller opens this dialog for
   * one (the board offers no Edit project on it, `/projects` does not list it),
   * and archiving again is a 200 that changes nothing. Nor once the dialog has
   * gone read-only under the reader — archived, or gone from the list — when
   * the zone leaves with Save (§4.11).
   */
  const canArchive = project.currentUserRole === "ADMIN" && !readOnly;
  const [askingArchive, setAskingArchive] = useState(false);
  const archiveTrigger = useRef<HTMLButtonElement>(null);
  const archiveConfirmId = useId();

  /**
   * Not optimistic, like the issue panel's Delete (§4.10): the question strip
   * is on screen while the request is out, and a refusal has to be said in a
   * dialog that is still open. So there is nothing to roll back.
   *
   * On success (§4.11's «Успех»), all of it before the dialog closes, so the
   * caller's next render draws the outcome and never a writable frame first:
   *
   * - only `archivedAt` is taken from the answer, into the board's context
   *   project if that is cached — never the role, which is the reads' to state;
   * - the row leaves `["projects"]`, because `GET /projects` no longer lists
   *   it, and its card's entry leaves the stats answer (`["project-stats"]`) with
   *   it — filtered out of the cache, not read again;
   * - the board's other queries are kept: an archived project's reads stay
   *   open (backend PR #159), so nothing here has gone stale except the
   *   project itself;
   * - then the context and the list are read again, to agree with the server.
   */
  const archive = useMutation({
    mutationFn: () => taskaApi.archiveProject(project.id),
    onSuccess: ({ archivedAt }) => {
      // `archivedAt` is what the route exists to set. A 200 without it would be
      // the server saying nothing happened, and nothing here makes one up.
      if (!archivedAt) {
        void queryClient.invalidateQueries({ queryKey: contextKey });
        void queryClient.invalidateQueries({ queryKey: ["projects"] });
        onClose();
        return;
      }
      queryClient.setQueryData<ProjectContext>(contextKey, (current) =>
        current ? { ...current, project: { ...current.project, archivedAt } } : current,
      );
      queryClient.setQueryData<Project[]>(["projects"], (current) => current?.filter((item) => item.id !== project.id));
      queryClient.setQueryData<ProjectStats[]>(PROJECT_STATS_KEY, (current) =>
        current?.filter((entry) => entry.projectId !== project.id),
      );
      onArchived?.(archivedAt);
      onClose();
      void queryClient.invalidateQueries({ queryKey: contextKey });
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    // The question closes and focus goes back to the control that asked it;
    // the reason is said under it (§4.22's refusals).
    onError: () => {
      setAskingArchive(false);
      archiveTrigger.current?.focus();
    },
  });
  const archiving = archive.isPending;
  const archiveFailure = apiErrorFacts(archive.error);

  const cancelArchive = () => {
    setAskingArchive(false);
    archiveTrigger.current?.focus();
  };

  /**
   * The question strip is the innermost layer while it is open (§4.11's `Esc`
   * order): `Esc` closes it and hands focus to the trigger wherever focus is in
   * the dialog, and does nothing while the archive is out. It listens on
   * `document`, ahead of `Modal`'s `window` listener, and takes the key with
   * `preventDefault()` so the dialog stays — the issue panel's delete strip
   * does the same (§4.10).
   */
  const archiveEscape = useRef({ archiving: false, cancelArchive });
  useEffect(() => {
    archiveEscape.current = { archiving: archive.isPending, cancelArchive };
  });
  useEffect(() => {
    if (!askingArchive) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      event.preventDefault();
      if (!archiveEscape.current.archiving) archiveEscape.current.cancelArchive();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [askingArchive]);

  // No eyebrow badge, unlike the other project-scoped modals (§4.11). There the
  // key is context — which project am I creating an issue in — and here it is
  // content, with a labelled row of its own three lines down. Two copies of one
  // pill inside 480px is the kind of thing §1 asks not to draw.
  const badge = keyBadgeStyle(project.projectKey, project.color);

  // Read through `apiErrorFacts` rather than off the error, so this block says
  // the same things in mock mode and against the gateway: `MockApiError`
  // carries no `requestId`, `ApiError` does, and neither shape is this
  // component's business to know. The words are the server's — or, for a
  // project archived while this dialog was open, ours (§5.7).
  const { requestId } = apiErrorFacts(save.error);
  const message = refusalWords(save.error);
  /**
   * The refused Save said the project was archived (§5.7): that refusal says
   * what the archive line would, so it stands in for the line and is where
   * focus goes. A refusal of any other kind — a 409, a 403 — says nothing
   * about the archive, and the line stays under it.
   */
  const archiveRefused = isProjectArchived(save.error);

  /**
   * Where focus goes when the dialog turns read-only, or its Save is refused,
   * and the control that had it went with that — Save leaves with the write
   * (DESIGN.md §4.11, «Архив пришёл отказом Save на `/projects`»; §5.7): the
   * `PROJECT_ARCHIVED` refusal, else the archive line. The dialog does this
   * itself because on `/projects` there is no board behind it that would, and
   * a focus left on `<body>` under the scrim is one the next Tab starts over
   * from the top of the page with. On the board this runs first — a child's
   * effect — and the board's own finds focus already inside and leaves it.
   *
   * Only focus that was lost: a reader still in a field keeps their place.
   */
  const refusalRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const target = archiveRefused ? refusalRef.current : lineRef.current;
    if (!target) return;
    if (focusLost()) target.focus();
  }, [archiveRefused, readOnly, save.isError]);

  return (
    <Modal busy={save.isPending || archive.isPending} onClose={onClose} title="Edit project">
      <form
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          // An all-absent body is a 200 that changes nothing, so this is not a
          // guard against a refusal — it is a request not worth sending. The
          // button is disabled for the same reason and this is the keyboard
          // path's copy of it. Read-only, there is no Save, and Enter in a
          // field is the one way left to ask for it.
          if (!readOnly && hasChanges && !nameIsBlank) save.mutate();
        }}
      >
        {/* Read-only, and said in words rather than implied by a greyed-out
            box: a disabled input invites the reader to work out why, and the
            reason here is a fact about the product rather than a state of this
            dialog. */}
        <dl className="form-static-field">
          <dt>Key</dt>
          <dd className="project-key-static">
            {/* The key stays text inside the badge. The colour is the tint
                behind it and never the glyph (§4.5), so nothing here depends
                on the colour being seen. */}
            <span className="key-badge" style={badge}>
              {project.projectKey}
            </span>
            <span className="field-note">Prefixes every issue key in this project, so it cannot change.</span>
          </dd>
        </dl>

        <label className="field">
          <span>Name</span>
          <input
            autoFocus
            maxLength={255}
            onChange={(event) => setName(event.target.value)}
            readOnly={readOnly}
            value={name}
          />
        </label>

        <label className="field">
          <span>Description</span>
          <textarea
            // Text-work while it differs from what the dialog opened with: `Esc`
            // leaves the dialog open (§4.11), and the mark stays when an archive
            // makes the box read-only (§5.7).
            data-unsaved-text={description !== openedDescription ? "true" : undefined}
            maxLength={2000}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What this project is for"
            readOnly={readOnly}
            rows={3}
            value={description}
          />
        </label>

        <div className="field">
          <span>Colour</span>
          <ColorSwatches
            choices={choices}
            groupLabel="Project colour"
            onPick={setColor}
            selected={color}
            unavailable={readOnly}
          />
        </div>

        {save.isError ? (
          // The two refusals this dialog usually receives are a 409 telling
          // the reader to retry and a 403, and for both the gateway log is the
          // only place to learn what happened — so the id travels with the
          // sentence, as it does in every other failure block in this product.
          // A 405 is not special any more: PR #155 deployed (401 without a
          // token on 2026-10-23), so one would be a refusal like any other.
          // A `PROJECT_ARCHIVED` one is a focus target: where focus goes when
          // the archive it brought takes Save away from under it (§5.7).
          <ErrorNote archiveNote={archiveRefused} ref={refusalRef} requestId={requestId}>
            {message ?? "The gateway refused this change."}
          </ErrorNote>
        ) : null}
        {readOnly && !archiveRefused ? (
          // Why nothing here writes any more, said once: not while this
          // dialog's `PROJECT_ARCHIVED` refusal is on screen, because then that
          // one says it (§5.7, one fact, one place); under a refusal of any
          // other kind, which does not. Where focus goes when the change took
          // the control that had it, like the board's own line.
          <p className="modal-archive-note" data-archive-note="modal" ref={lineRef} tabIndex={-1}>
            {archived
              ? "This project is archived, so it cannot be edited."
              : "This project no longer appears in Projects, so it cannot be edited here."}
          </p>
        ) : null}

        {/* Why Save is off, said where the reader is looking rather than left
            to be worked out: a disabled button cannot take focus, so a tooltip
            on it would never be read. `.admin-write-hint` is the line this
            product already wrote for exactly this. Only for the blank name —
            "nothing has changed yet" is self-evident from the form and does not
            need a sentence under it. */}
        {nameIsBlank && !readOnly ? (
          <p className="admin-write-hint">A project needs a name, so Save is off until there is one.</p>
        ) : null}

        <div className="modal-actions">
          <button className="secondary-button" onClick={onClose} type="button">
            Cancel
          </button>
          {readOnly ? null : (
            <button className="primary-button" disabled={!hasChanges || nameIsBlank || save.isPending} type="submit">
              Save changes
            </button>
          )}
        </div>
      </form>

      {/* Outside the form, so Enter in a field never reaches it, and below
          Save so the dialog's ordinary path ends before the destructive one
          begins. */}
      {canArchive ? (
        <section aria-label="Archive project" className="project-archive">
          <div className="project-archive-row">
            <p className="project-archive-note">
              Archiving hides {project.projectKey} from Projects and makes its board read-only.
            </p>
            <button
              aria-controls={askingArchive ? archiveConfirmId : undefined}
              aria-expanded={askingArchive}
              className="secondary-button compact-button project-archive-trigger"
              onClick={() => {
                if (archiving) return;
                archive.reset();
                setAskingArchive((open) => !open);
              }}
              ref={archiveTrigger}
              type="button"
            >
              Archive project
            </button>
          </div>

          {askingArchive ? (
            // §4.22's strip, as the issue panel's Delete draws it (§4.10).
            <div
              className="member-confirm project-archive-confirm"
              id={archiveConfirmId}
            >
              <p className="member-confirm-sentence" id={`${archiveConfirmId}-sentence`}>
                {project.projectKey} will be archived for everyone. Taska cannot restore it.
              </p>
              <div className="member-confirm-actions">
                {/* Both `aria-disabled` while the request is out (§4.1's
                    in-flight recipe): labels unchanged, the handlers refuse. */}
                <button
                  aria-disabled={archiving || undefined}
                  autoFocus
                  className="secondary-button compact-button"
                  onClick={() => {
                    if (!archiving) cancelArchive();
                  }}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  aria-describedby={`${archiveConfirmId}-sentence`}
                  aria-disabled={archiving || undefined}
                  className="secondary-button compact-button member-confirm-accept"
                  onClick={() => {
                    if (!archiving) archive.mutate();
                  }}
                  type="button"
                >
                  Archive {project.projectKey}
                </button>
              </div>
            </div>
          ) : null}

          {archive.isError ? (
            // The server's words and the id that finds them in the gateway
            // log. No line of its own for a 405 any more: the route deployed.
            <ErrorNote live="alert" requestId={archiveFailure.requestId} serverWords={archiveFailure.message}>
              This project was not archived.
            </ErrorNote>
          ) : null}
        </section>
      ) : null}
    </Modal>
  );
}
