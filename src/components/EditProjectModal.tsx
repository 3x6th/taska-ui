import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useMemo, useState } from "react";
import { taskaApi } from "../api/client";
import type { UpdateProjectInput } from "../api/TaskaApi";
import type { Project } from "../domain/types";
import { computedProjectColor, keyBadgeStyle, labelColorChoices } from "../lib/format";
import { ColorSwatches, type ColorChoice } from "./ColorSwatches";
import { Modal } from "./Modal";

/**
 * The project's own three editable fields — `PATCH /projects/{projectId}`,
 * backend PR #155 (TAS-145). Opened from the card on `/projects` and from the
 * board's header, which is why it lives here rather than inside either screen.
 *
 * ADMIN only, and both callers decide that before rendering this: the board
 * from the `membershipQuery` it already holds, the projects screen from
 * `currentUserRole` on the list row or a `getMembership` fallback. Hiding the
 * control is presentation — the gateway refuses the write for everybody else
 * regardless, and a 403 arriving here is shown rather than swallowed.
 *
 * The key is displayed and not editable, and that is the contract rather than a
 * simplification: `UpdateProjectRequestDto` has no `projectKey`, because the
 * key is the prefix of every `issueKey` in the project.
 */
export function EditProjectModal({ project, onClose }: { project: Project; onClose: () => void }) {
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
  const noticeId = useId();

  /**
   * A colour is a one-way door until the backend half of TAS-145 lands: an
   * absent `color` and an explicit `null` are the same "keep" on the PATCH, and
   * `""` fails the schema's hex pattern, so nothing a client can send means
   * "go back to computing it". Once the *server* holds a colour, Automatic is
   * therefore offered and refused rather than quietly dropped — a picker that
   * hid the option would leave the reader wondering where it went, and one that
   * offered it would spend a request on a 400.
   *
   * Read from `project.color`, never from the `color` state: a choice made in
   * this dialog and not yet saved is still undoable, so picking a colour must
   * not close the door before Save does.
   */
  const automaticLocked = Boolean(project.color);

  const choices = useMemo<ColorChoice[]>(
    () => [
      {
        value: null,
        // The colour the badge behind this dialog is drawing right now, from
        // the one place that rule lives.
        swatch: computedProjectColor(project.projectKey),
        label: "Automatic colour, from the project key",
        disabled: automaticLocked,
      },
      ...labelColorChoices.map((choice) => ({ value: choice, swatch: choice, label: `Colour ${choice}` })),
    ],
    [automaticLocked, project.projectKey],
  );

  /**
   * Only what actually changed, which is what PATCH semantics ask for and also
   * what keeps the two asymmetric fields honest.
   *
   * `description` is compared against `project.description ?? ""` so that
   * clearing a box that held something sends `""` — the one value that removes
   * a description — while a box that was already empty on a project that never
   * had one sends nothing at all. `color` is only ever a hex here: `null` means
   * "leave it alone", because there is no request that means "remove it".
   */
  const changes = useMemo<UpdateProjectInput>(() => {
    const input: UpdateProjectInput = {};
    const trimmedName = name.trim();
    if (trimmedName && trimmedName !== project.name) input.name = trimmedName;
    const trimmedDescription = description.trim();
    if (trimmedDescription !== (project.description ?? "")) input.description = trimmedDescription;
    if (color && color !== project.color) input.color = color;
    return input;
  }, [color, description, name, project.color, project.description, project.name]);

  const hasChanges = Object.keys(changes).length > 0;
  const nameIsBlank = name.trim().length === 0;

  const save = useMutation({
    mutationFn: () => taskaApi.updateProject(project.id, changes),
    /**
     * Optimistic across both caches that hold this project, because both are on
     * screen: the card behind this dialog comes from `["projects"]`, the
     * board's own header from `["project", id]`. Patching one and waiting for
     * the other would make the rename appear in one place and not the other.
     */
    onMutate: async (): Promise<{ list?: Project[]; single?: Project }> => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: ["projects"] }),
        queryClient.cancelQueries({ queryKey: ["project", project.id] }),
      ]);
      const list = queryClient.getQueryData<Project[]>(["projects"]);
      const single = queryClient.getQueryData<Project>(["project", project.id]);
      const patch = (current: Project) => ({ ...current, ...changes });

      queryClient.setQueryData<Project[]>(["projects"], (current) =>
        current?.map((item) => (item.id === project.id ? patch(item) : item)),
      );
      queryClient.setQueryData<Project>(["project", project.id], (current) => (current ? patch(current) : current));
      return { list, single };
    },
    // Both snapshots back, and the dialog stays open carrying the reason. A
    // rollback nobody is told about is what DESIGN.md §5.6 calls out: the card
    // would simply slide back to its old name with no explanation.
    onError: (_error, _variables, context) => {
      if (context?.list) queryClient.setQueryData(["projects"], context.list);
      if (context?.single) queryClient.setQueryData(["project", project.id], context.single);
    },
    // The server's own row wins over the optimistic patch — it carries
    // `updatedAt`, and on a gateway that has PR #155 it is the only proof of
    // what was actually stored.
    //
    // With one exception, and it is about the reader rather than the project:
    // `currentUserRole` (backend PR #152) is not a field this response is
    // *about*, and the two PRs are separate, so a merged gateway may well
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
      queryClient.setQueryData<Project>(["project", project.id], (current) => (current ? merge(current) : saved));
      onClose();
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["projects"] }),
        queryClient.invalidateQueries({ queryKey: ["project", project.id] }),
      ]);
    },
  });

  // No eyebrow badge, unlike the other project-scoped modals (§4.11). There the
  // key is context — which project am I creating an issue in — and here it is
  // content, with a labelled row of its own three lines down. Two copies of one
  // pill inside 480px is the kind of thing §1 asks not to draw.
  const badge = keyBadgeStyle(project.projectKey, project.color);

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
          <ColorSwatches
            choices={choices}
            describedBy={automaticLocked ? noticeId : undefined}
            groupLabel="Project colour"
            onPick={setColor}
            selected={color}
          />
          {automaticLocked ? (
            <p className="field-note" id={noticeId}>
              A colour cannot be set back to automatic yet — TAS-145.
            </p>
          ) : null}
        </div>

        {save.isError ? <div className="form-error">{save.error.message}</div> : null}

        <div className="modal-actions">
          <button className="secondary-button" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="primary-button" disabled={!hasChanges || nameIsBlank || save.isPending} type="submit">
            Save changes
          </button>
        </div>
      </form>
    </Modal>
  );
}
