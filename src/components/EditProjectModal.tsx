import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useMemo, useRef, useState } from "react";
import { taskaApi } from "../api/client";
import { apiErrorFacts, isUndeployedRoute } from "../api/errors";
import type { UpdateProjectInput } from "../api/TaskaApi";
import { UNDEPLOYED_ROUTE_MESSAGE } from "../api/TaskaApi";
import type { Project, ProjectContext } from "../domain/types";
import { computedProjectColor, formatDay, keyBadgeStyle, labelColorChoices } from "../lib/format";
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
 * and behind §4.22's confirmation strip. `onArchived` is the caller's say in
 * where the reader goes next: the board leaves for `/projects`, because every
 * read it would make after this one is refused; the projects screen stays.
 */
export function EditProjectModal({
  project,
  onClose,
  onArchived,
}: {
  project: Project;
  onClose: () => void;
  onArchived?: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
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
        // the one place that rule lives. Always offered: since backend PR
        // #155's head `28f5fe1` an explicit `null` clears a stored colour, so
        // picking this on a coloured project is a change Save can send.
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
   * reading `null` and a legacy `""` alike as "none". A box emptied on a
   * project that had one sends `null` — the clear since PR #155's head
   * `28f5fe1` — and an empty box on a project that had none sends nothing, so
   * a `""` row is never rewritten to `null` behind the reader's back.
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
    // `updatedAt`, and on a gateway that has PR #155 it is the only proof of
    // what was actually stored.
    //
    // With one exception, and it is about the reader rather than the project:
    // `currentUserRole` (backend TAS-137, PR #152) is not a field this response
    // is *about*, and the two PRs are separate, so a merged gateway may well
    // answer a write with an explicit `currentUserRole: null` simply because
    // the update path did not compute one. Spread in, that would take the edit
    // control off the card this dialog just saved, until the refetch below put
    // it back — a flicker that says something false about the reader's
    // standing. Kept from the row the list already holds instead.
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
   * refuses everybody else regardless (a member below ADMIN 403, a non-member
   * 404).
   */
  const canArchive = project.currentUserRole === "ADMIN";
  const [askingArchive, setAskingArchive] = useState(false);
  const archiveTrigger = useRef<HTMLButtonElement>(null);
  const archiveConfirmId = useId();

  /**
   * Not optimistic, like the issue panel's Delete (§4.10): the question strip
   * is on screen while the request is out, and a refusal has to be said in a
   * dialog that is still open. So there is nothing to roll back.
   *
   * On success, one write to the cache and no refetch:
   *
   * - `["projects"]` takes the server's row, `archivedAt` and all, keeping the
   *   reader's `currentUserRole` from the row already held — the answer carries
   *   `currentUserRole: null` (the entity mapper sets none), and spread in it
   *   would take the edit control off the card;
   * - every board-scoped query of this project is **removed**, not
   *   invalidated — the context, issues, search, panel reads — because each of
   *   them would refetch into a 400 "Project archived". Matched by the id in
   *   second position, the rule `ProjectMembersModal.leaveProject` set out.
   *   `project-summaries` is kept: it is the card's own count, true as of a
   *   moment ago, and the projects screen would otherwise refetch it at once.
   *
   * `onArchived` (the board's navigation) runs before the removal, as in
   * `leaveProject`: `navigate` only schedules the route change, and a query
   * dropped from under a still-mounted observer is not rebuilt until it renders
   * again.
   */
  const archive = useMutation({
    mutationFn: () => taskaApi.archiveProject(project.id),
    onSuccess: (archived) => {
      queryClient.setQueryData<Project[]>(["projects"], (current) =>
        current?.map((item) =>
          item.id === archived.id ? { ...item, ...archived, currentUserRole: item.currentUserRole } : item,
        ),
      );
      onClose();
      onArchived?.();
      queryClient.removeQueries({
        predicate: (query) => query.queryKey[1] === archived.id && query.queryKey[0] !== "project-summaries",
      });
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

  // No eyebrow badge, unlike the other project-scoped modals (§4.11). There the
  // key is context — which project am I creating an issue in — and here it is
  // content, with a labelled row of its own three lines down. Two copies of one
  // pill inside 480px is the kind of thing §1 asks not to draw.
  const badge = keyBadgeStyle(project.projectKey, project.color);

  // Read through `apiErrorFacts` rather than off the error, so this block says
  // the same things in mock mode and against the gateway: `MockApiError`
  // carries no `requestId`, `ApiError` does, and neither shape is this
  // component's business to know.
  const { message, requestId } = apiErrorFacts(save.error);

  return (
    <Modal title="Edit project" onClose={onClose}>
      <form
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          // An all-absent body is a 200 that changes nothing, so this is not a
          // guard against a refusal — it is a request not worth sending. The
          // button is disabled for the same reason and this is the keyboard
          // path's copy of it.
          if (hasChanges && !nameIsBlank) save.mutate();
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
            value={name}
          />
        </label>

        <label className="field">
          <span>Description</span>
          <textarea
            maxLength={2000}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What this project is for"
            rows={3}
            value={description}
          />
        </label>

        <div className="field">
          <span>Colour</span>
          <ColorSwatches choices={choices} groupLabel="Project colour" onPick={setColor} selected={color} />
        </div>

        {save.isError ? (
          // A 405 here means backend PR #155 has not deployed this PATCH yet
          // (see `TaskaApi.updateProject`) — nothing the reader did
          // wrong, so it reads as a quiet note rather than the red box every
          // other refusal gets, and never as a protocol sentence to act on.
          //
          // Quiet, but not meta: this line is the only account of a save that
          // did not happen, and the optimistic patch has already rolled back on
          // the card behind the scrim by the time it is read. So it carries
          // `.save-failed-note`'s own `--fg-2` rather than `.field-note`'s
          // `--fg-3`, and `role="status"` — pressing Save has to answer a
          // screen reader with something, and until PR #155 deploys this is
          // what every admin gets.
          isUndeployedRoute(save.error, UNDEPLOYED_ROUTE_MESSAGE) ? (
            <p className="field-note save-failed-note" role="status">
              Project edits are not on this gateway yet, so this change was not saved.
            </p>
          ) : (
            // The two refusals this dialog can actually receive are a 409
            // telling the reader to retry and a 403, and for both the gateway
            // log is the only place to learn what happened — so the id travels
            // with the sentence, as it does in every other failure block in
            // this product.
            <ErrorNote requestId={requestId}>{message ?? "The gateway refused this change."}</ErrorNote>
          )
        ) : null}

        {/* Why Save is off, said where the reader is looking rather than left
            to be worked out: a disabled button cannot take focus, so a tooltip
            on it would never be read. `.admin-write-hint` is the line this
            product already wrote for exactly this. Only for the blank name —
            "nothing has changed yet" is self-evident from the form and does not
            need a sentence under it. */}
        {nameIsBlank ? <p className="admin-write-hint">A project needs a name, so Save is off until there is one.</p> : null}

        <div className="modal-actions">
          <button className="secondary-button" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="primary-button" disabled={!hasChanges || nameIsBlank || save.isPending} type="submit">
            Save changes
          </button>
        </div>
      </form>

      {/* Outside the form, so Enter in a field never reaches it, and below
          Save so the dialog's ordinary path ends before the destructive one
          begins. */}
      {canArchive ? (
        <section aria-label="Archive project" className="project-archive">
          {project.archivedAt ? (
            // Archiving again is a 200 that changes nothing, so it is not
            // offered; the fact is stated instead.
            <p className="project-archive-note">
              Archived on {formatDay(project.archivedAt)}. Its issues no longer open, and Taska has no way to restore
              it yet.
            </p>
          ) : (
            <div className="project-archive-row">
              <p className="project-archive-note">
                Archiving keeps {project.projectKey} in the project list, but its board and issues stop opening.
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
                onKeyDown={(event) => {
                  if (askingArchive && event.key === "Escape") {
                    event.stopPropagation();
                    if (!archiving) cancelArchive();
                  }
                }}
                ref={archiveTrigger}
                type="button"
              >
                Archive project
              </button>
            </div>
          )}

          {askingArchive ? (
            // §4.22's strip, as the issue panel's Delete draws it (§4.10).
            <div
              className="member-confirm project-archive-confirm"
              id={archiveConfirmId}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.stopPropagation();
                  if (!archiving) cancelArchive();
                }
              }}
            >
              <p className="member-confirm-sentence" id={`${archiveConfirmId}-sentence`}>
                {project.projectKey} will be archived for everyone. Its board and issues stop opening, and there is no
                way to restore it from Taska.
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
            // The same reading of a 405 as Save's above: backend PR #159 has
            // not deployed this DELETE, nothing changed, and that is not a
            // refusal to act on. Everything else is the server's words and
            // the id that finds them in the gateway log.
            isUndeployedRoute(archive.error, UNDEPLOYED_ROUTE_MESSAGE) ? (
              <p className="field-note save-failed-note" role="status">
                Archiving is not on this gateway yet, so this project was not archived.
              </p>
            ) : (
              <ErrorNote live="alert" requestId={archiveFailure.requestId} serverWords={archiveFailure.message}>
                This project was not archived.
              </ErrorNote>
            )
          ) : null}
        </section>
      ) : null}
    </Modal>
  );
}
