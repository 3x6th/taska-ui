import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { taskaApi } from "../api/client";
import { apiErrorFacts, isMissingOrForbidden } from "../api/errors";
import { PROJECT_ROLES, isUserId, normalizeUserId } from "../api/members";
import type { Project, ProjectMember, ProjectRole } from "../domain/types";
import { useUnanswered } from "../hooks/useUnanswered";
import { keyBadgeStyle } from "../lib/format";
import { shortKey } from "../screens/admin/columns";
import { Avatar } from "./Avatar";
import { Modal } from "./Modal";
import { RequestId } from "./RequestId";

/**
 * The board's own retry rule for `["members", projectId]`, restated rather than
 * imported because it lives in a screen file that may only export components.
 * It has to be the same rule and not merely a similar one: this dialog and the
 * board observe one query, and react-query runs a refetch with the options of
 * whichever observer set them last, so two rules for one key would make "does
 * a 404 get retried" depend on which of the two mounted most recently.
 */
const retryUnlessMissing = (failureCount: number, error: Error) => !isMissingOrForbidden(error) && failureCount < 1;

/** How a role is said. The wire value stays the wire value (DESIGN.md §6). */
const roleLabels: Record<ProjectRole, string> = { ADMIN: "Admin", MEMBER: "Member", VIEWER: "Viewer" };

/**
 * Who a row, a control or a sentence is about, worded once so the three cannot
 * disagree — the defect `watcherSubject` exists for in the issue panel.
 *
 * `name` opens a sentence and `inSentence` sits inside one; they differ only
 * for a row the member read could not name, which is spoken as its short id
 * (§5.8's `shortKey`) rather than as thirty-six characters or as a name nobody
 * stated.
 */
interface MemberSubject {
  name: string;
  inSentence: string;
  self: boolean;
}

function subjectOf(member: Pick<ProjectMember, "userId" | "user">, currentUserId?: string): MemberSubject {
  const self = currentUserId !== undefined && member.userId === currentUserId;
  if (member.user) return { name: member.user.displayName, inSentence: member.user.displayName, self };
  const id = shortKey(member.userId);
  return { name: `The member with ID ${id}`, inSentence: `the member with ID ${id}`, self };
}

/** What the dialog says about a write, and whether it is a failure. */
interface MemberNotice {
  tone: "info" | "error";
  text: string;
  /** The refusal behind the sentence, so the line under it can carry the server's words and request id. */
  error?: unknown;
}

/**
 * An inline confirmation in progress. Two writes ask before they go, and only
 * these two, because they are the two whose effect the reader cannot undo from
 * where they stand: removing a member, and taking away one's own admin role —
 * after which nobody in this dialog can give it back but another admin.
 * Changing somebody *else's* role is undone with the same select, so it does
 * not ask.
 */
type PendingConfirm = { kind: "remove"; userId: string } | { kind: "demote-self"; userId: string; role: ProjectRole };

interface ProjectMembersModalProps {
  projectId: string;
  projectKey: string;
  /** For the eyebrow badge only, so it matches the one in the board header (see `ProjectLabelsModal`). */
  projectColor?: string | null;
  /**
   * The board's reading of the reader's role, from the membership query it
   * already holds — so this dialog spends no request deciding what to offer.
   * Presentation only: the server refuses all three writes for anybody else.
   */
  isProjectAdmin: boolean;
  /** `undefined` until `GET /users/me` answers; until then no row is marked as the reader's. */
  currentUserId?: string;
  onClose: () => void;
}

/**
 * The project's members, and for its ADMIN the three writes on them (TAS-158):
 * add somebody by user id, change a member's role, remove a member.
 *
 * **Every reader of the board can open this**; only an ADMIN sees controls in
 * it. The member list is not a secret from a VIEWER — the assignee filter
 * already draws everyone — and a dialog that answered "who is on this project"
 * for some readers and not others would be hiding the one thing a VIEWER is
 * most likely to need to ask an admin about.
 *
 * **Adding is by exact user id, because nothing else exists yet.** The gateway
 * has no user search (TAS-204), so the field takes an id and the role beside
 * it. When search lands, the field becomes the place a person is looked up by
 * name or email; what changes is where `candidate` below comes from, not the
 * dialog around it.
 *
 * Three things are easy to get wrong here, and each has a comment where it is
 * handled:
 *
 * - **An id nobody holds is a successful add** (TAS-227). The row comes back
 *   from the member read with no name and no email, and is drawn as exactly
 *   that — the id, and a sentence saying no account came back for it — rather
 *   than as a person this client invented.
 * - **The last ADMIN cannot be demoted or removed.** The server refuses both
 *   with `FAILED_PRECONDITION`; the dialog does not offer them for that row and
 *   says why in words, and still reads the refusal properly when a stale list
 *   let one through.
 * - **An ADMIN may change or remove their own row** when another ADMIN exists.
 *   Afterwards the reader's role is read again, so the controls leave with it;
 *   after removing themselves the reader is taken to their projects, because
 *   this board is no longer one they can read.
 */
export function ProjectMembersModal({
  projectId,
  projectKey,
  projectColor,
  isProjectAdmin,
  currentUserId,
  onClose,
}: ProjectMembersModalProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [draft, setDraft] = useState("");
  const [role, setRole] = useState<ProjectRole>("MEMBER");
  /**
   * Adds the server has not answered for yet. Held here rather than written
   * into `["members", projectId]`, because the board draws that list too: an
   * optimistic row there would put a nameless avatar into the assignee filter
   * behind the scrim for the length of the request, as a person a reader could
   * filter the board by before the server had agreed they exist.
   */
  const [pendingAdds, setPendingAdds] = useState<{ userId: string; role: ProjectRole }[]>([]);
  /** Rows whose role write is out, so their select stops answering until it lands. */
  const [rolesInFlight, setRolesInFlight] = useState<string[]>([]);
  const [pendingConfirm, setConfirm] = useState<PendingConfirm | null>(null);
  /**
   * A question is only open while the reader may still answer it. Their role
   * can stop being ADMIN with a strip open — a 403 on another write re-reads
   * it — and a strip left behind would offer a write the server will refuse, and
   * make `Esc` spend a press cancelling something nobody can see.
   */
  const confirm = isProjectAdmin ? pendingConfirm : null;
  const [notice, setNotice] = useState<MemberNotice | null>(null);
  const fieldId = useId();
  const roleId = useId();
  const hintId = useId();

  /**
   * Where focus came from, read during the first render — before anything in
   * this dialog has taken it — so closing can hand it back (§7). Read here and
   * not in an effect: by the time an effect runs, `autoFocus` has already moved
   * focus to the id field.
   */
  const [opener] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null));
  const heading = useRef<HTMLHeadingElement | null>(null);
  const field = useRef<HTMLInputElement | null>(null);
  /** Every row's remove toggle and role select, by user id, for the focus handoffs below. */
  const toggles = useRef(new Map<string, HTMLButtonElement>());
  const selects = useRef(new Map<string, HTMLSelectElement>());
  /** A row id, `""` for the heading, `null` for nothing to do. See the effect that applies it. */
  const focusAfterRemoval = useRef<string | null>(null);

  const membersKey = useMemo(() => ["members", projectId], [projectId]);
  const membersQuery = useQuery({
    queryKey: membersKey,
    queryFn: () => taskaApi.listMembers(projectId),
    retry: retryUnlessMissing,
  });
  const membersUnread = useUnanswered(membersQuery);
  const members = membersQuery.data;
  const adminCount = useMemo(() => (members ?? []).filter((member) => member.role === "ADMIN").length, [members]);

  const close = () => {
    onClose();
    if (opener?.isConnected) opener.focus();
  };

  /**
   * Everything that draws members goes stale with a write: the board's filter
   * and this dialog read `["members", projectId]`, the project card on
   * `/projects` reads `["project-summaries", projectId]`. A write about the
   * reader's own row also changes the reader's role, which three more reads
   * carry — the membership the board gates on, the project it draws, and the
   * list rows whose edit control depends on it.
   *
   * `mayBeSelf` rather than `self`: before `GET /users/me` has answered, no row
   * can be ruled out as the reader's, and re-reading a role that did not change
   * costs one request where failing to re-read one that did leaves an ADMIN's
   * controls on a board that has stopped being theirs.
   */
  const refresh = (mayBeSelf: boolean) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: membersKey }),
      queryClient.invalidateQueries({ queryKey: ["project-summaries", projectId] }),
      ...(mayBeSelf
        ? [
            queryClient.invalidateQueries({ queryKey: ["membership", projectId] }),
            queryClient.invalidateQueries({ queryKey: ["project", projectId] }),
            queryClient.invalidateQueries({ queryKey: ["projects"] }),
          ]
        : []),
    ]);

  const mayBeSelf = (userId: string) => currentUserId === undefined || userId === currentUserId;

  /**
   * A 403 on any of the three means the role this dialog was drawn from is no
   * longer the reader's — it changed between the read and the press. The
   * membership is read again so the controls leave with the role, instead of
   * staying to be refused a second time.
   */
  const forgetRoleIfRefused = (error: unknown) => {
    if (isForbidden(error)) {
      void queryClient.invalidateQueries({ queryKey: ["membership", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
    }
  };

  const addMember = useMutation({
    mutationFn: (input: { userId: string; role: ProjectRole }) =>
      taskaApi.addProjectMember(projectId, input.userId, input.role),
    onMutate: (input) => {
      setNotice(null);
      setPendingAdds((current) =>
        current.some((row) => row.userId === input.userId) ? current : [...current, input],
      );
    },
    // The answer is the membership and not the person — no name, no email — so
    // the row that replaces the pending one comes from reading the list again.
    // Awaited before the pending row goes, so it never leaves a gap where
    // neither row is on screen.
    onSuccess: async (_result, input) => {
      await refresh(false);
      setPendingAdds((current) => current.filter((row) => row.userId !== input.userId));
    },
    onError: (error, input) => {
      setPendingAdds((current) => current.filter((row) => row.userId !== input.userId));
      // The typed id comes back to the field — unless something has been typed
      // since, which this must never overwrite — so the reader can correct it
      // rather than find it again. Not for "already a member": there is nothing
      // to correct, and the re-read below puts that person in the list.
      if (!isAlreadyMember(error)) setDraft((current) => (current === "" ? input.userId : current));
      forgetRoleIfRefused(error);
      setNotice({ tone: "error", text: addFailureText(error), error });
      // A 409 means the list this form checked against was stale, and any other
      // refusal may be about a list that has moved too.
      void refresh(false);
    },
  });

  const changeRole = useMutation({
    mutationFn: (input: { userId: string; role: ProjectRole }) =>
      taskaApi.changeProjectMemberRole(projectId, input.userId, input.role),
    onMutate: async (input) => {
      setNotice(null);
      setRolesInFlight((current) => [...current, input.userId]);
      await queryClient.cancelQueries({ queryKey: membersKey });
      const previous = queryClient.getQueryData<ProjectMember[]>(membersKey)?.find(
        (member) => member.userId === input.userId,
      )?.role;
      queryClient.setQueryData<ProjectMember[]>(membersKey, (current) =>
        current?.map((member) => (member.userId === input.userId ? { ...member, role: input.role } : member)),
      );
      return { previous };
    },
    onSuccess: (_result, input) => {
      if (input.userId === currentUserId && input.role !== "ADMIN") {
        setNotice({
          tone: "info",
          text: `You are now a ${roleLabels[input.role]} of this project, so only an admin can change its members.`,
        });
      }
    },
    onError: (error, input, context) => {
      // This row only, and only while it still shows the role this write put
      // there. Restoring a whole-list snapshot would also restore a row some
      // other write has changed or removed since.
      if (context && context.previous !== undefined) {
        queryClient.setQueryData<ProjectMember[]>(membersKey, (current) =>
          current?.map((member) =>
            member.userId === input.userId && member.role === input.role
              ? { ...member, role: context.previous ?? null }
              : member,
          ),
        );
      }
      forgetRoleIfRefused(error);
      const member = members?.find((row) => row.userId === input.userId) ?? { userId: input.userId };
      setNotice({ tone: "error", text: roleFailureText(error, subjectOf(member, currentUserId)), error });
    },
    onSettled: async (_result, _error, input) => {
      setRolesInFlight((current) => current.filter((userId) => userId !== input.userId));
      await refresh(mayBeSelf(input.userId));
    },
  });

  const removeMember = useMutation({
    mutationFn: (userId: string) => taskaApi.removeProjectMember(projectId, userId),
    onMutate: async (userId) => {
      setNotice(null);
      await queryClient.cancelQueries({ queryKey: membersKey });
      const list = queryClient.getQueryData<ProjectMember[]>(membersKey);
      const index = list?.findIndex((member) => member.userId === userId) ?? -1;
      queryClient.setQueryData<ProjectMember[]>(membersKey, (current) =>
        current?.filter((member) => member.userId !== userId),
      );
      return { row: index >= 0 ? list?.[index] : undefined, index };
    },
    onSuccess: (_result, userId) => {
      if (userId !== currentUserId) return;
      // The reader removed themselves, and this board is not theirs any more:
      // every read under it now answers 403. Taken off their project list first
      // so `/projects` does not draw the card for a beat before its refetch
      // lands, and replaced in history so Back does not lead into a board that
      // would only say "not found".
      queryClient.setQueryData<Project[]>(["projects"], (current) =>
        current?.filter((project) => project.id !== projectId),
      );
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      navigate("/projects", { replace: true });
    },
    onError: (error, userId, context) => {
      const member = context?.row ?? { userId };
      const subject = subjectOf(member, currentUserId);
      if (isMissing(error)) {
        // The end state is the one that was asked for, so nothing comes back.
        // What did not happen is the removal, and that is worth a sentence.
        setNotice({ tone: "info", text: notMemberText(subject) });
        return;
      }
      if (context?.row) {
        const row = context.row;
        queryClient.setQueryData<ProjectMember[]>(membersKey, (current) => {
          if (!current || current.some((member) => member.userId === row.userId)) return current;
          const next = [...current];
          next.splice(Math.min(context.index, next.length), 0, row);
          return next;
        });
      }
      forgetRoleIfRefused(error);
      setNotice({ tone: "error", text: removeFailureText(error, subject), error });
    },
    onSettled: async (_result, error, userId) => {
      // Leaving the project is the one success after which nothing here is
      // worth re-reading: the board is being unmounted, and against the gateway
      // every one of these reads would answer 403.
      if (!error && userId === currentUserId) return;
      await refresh(mayBeSelf(userId));
    },
  });

  // --- the add form -------------------------------------------------------

  /**
   * The person the field names. Today that is an id and nothing more; when user
   * search lands (TAS-204) this is where a chosen search result arrives, and the
   * checks below — already a member, already being added — keep working on it
   * unchanged.
   */
  const candidate = normalizeUserId(draft);
  const typed = candidate !== "";
  const wellFormed = isUserId(candidate);
  const existing = wellFormed ? members?.find((member) => member.userId === candidate) : undefined;
  const beingAdded = wellFormed && pendingAdds.some((row) => row.userId === candidate);
  const canAdd = wellFormed && !existing && !beingAdded;

  /**
   * Why Add is off, said under the field rather than left for the reader to
   * work out: an `aria-disabled` button reads as unavailable and explains
   * nothing. Nothing is said about an empty field — the form explains itself.
   */
  const problem = !typed
    ? null
    : !wellFormed
      ? "This is not a user ID yet: an ID is 32 hexadecimal digits in groups of 8-4-4-4-12."
      : existing
        ? existing.user
          ? `${existing.user.displayName} is already a member of this project.`
          : "This user ID is already a member of this project."
        : beingAdded
          ? "This user ID is being added."
          : null;

  const submitAdd = () => {
    // The guard the `aria-disabled` on Add no longer enforces by itself.
    if (!canAdd) return;
    addMember.mutate({ userId: candidate, role });
    // Cleared here rather than when the answer lands, for the reason the label
    // and watcher pickers give: a reset a round trip later lands on whatever
    // was typed in the meantime and takes it.
    setDraft("");
  };

  // --- confirmations ------------------------------------------------------

  const openRemoveConfirm = (userId: string) => {
    setNotice(null);
    setConfirm(confirm?.kind === "remove" && confirm.userId === userId ? null : { kind: "remove", userId });
  };

  /** Back to the control that asked, which is where a reader who pressed Cancel or Esc expects to be. */
  const cancelConfirm = () => {
    if (!confirm) return;
    const trigger = confirm.kind === "remove" ? toggles.current.get(confirm.userId) : selects.current.get(confirm.userId);
    setConfirm(null);
    trigger?.focus();
  };

  /**
   * Where focus goes when a removed row leaves with the button that removed it:
   * the next row's remove toggle, or the one before, or the list's heading when
   * no row left offers one. Planned before the write rather than inside it,
   * because the neighbour has to be read off the list as it stood when the
   * reader pressed — and applied by the effect below, once React has drawn the
   * list without the row. A removal of the reader's own row plans nothing: that
   * success leaves the board.
   */
  const planFocusHandoff = (userId: string) => {
    if (userId === currentUserId) return;
    const list = members ?? [];
    const index = list.findIndex((member) => member.userId === userId);
    if (index < 0) return;
    const after = list.slice(index + 1);
    const before = list.slice(0, index).reverse();
    const neighbour = [...after, ...before].find((member) => toggles.current.has(member.userId));
    focusAfterRemoval.current = neighbour ? neighbour.userId : "";
  };

  const acceptConfirm = () => {
    if (!confirm) return;
    if (confirm.kind === "demote-self") {
      const { userId, role: nextRole } = confirm;
      setConfirm(null);
      selects.current.get(userId)?.focus();
      changeRole.mutate({ userId, role: nextRole });
      return;
    }
    const { userId } = confirm;
    setConfirm(null);
    planFocusHandoff(userId);
    removeMember.mutate(userId);
  };

  useEffect(() => {
    const target = focusAfterRemoval.current;
    if (target === null) return;
    focusAfterRemoval.current = null;
    const node = target === "" ? heading.current : toggles.current.get(target);
    if (node?.isConnected) node.focus();
  }, [members]);

  // --- keyboard and focus -------------------------------------------------

  /**
   * §4.11's `Esc`, bound here because `Modal` carries none (§7 keeps that gap
   * open for every dialog, and closing it for all of them is not this story).
   * An open confirmation is the nearer thing to cancel, so it goes first and the
   * dialog stays; the next `Esc` closes the dialog. There is no `Cmd/Ctrl+Enter`:
   * this dialog has no single action to confirm, and the add form already
   * submits on Enter.
   *
   * Read through a ref, refreshed after every render, so the listener is bound
   * once rather than on every keystroke in the field.
   */
  const onEscape = useRef(() => {});
  useEffect(() => {
    onEscape.current = () => (confirm ? cancelConfirm() : close());
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onEscape.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  /**
   * A reader with nothing to type still needs focus inside the dialog, or the
   * keyboard is left on the board behind the scrim. An ADMIN's field takes it
   * through `autoFocus`; everybody else lands on the list's heading, which is
   * not a Tab stop and exists to be focused from here.
   */
  useEffect(() => {
    if (!field.current) heading.current?.focus();
  }, []);

  /**
   * When the reader's own role stops being ADMIN — their own demotion, or a 403
   * that re-read it — every control in the dialog unmounts, the focused one
   * with it, and focus falls to `<body>` behind the scrim. It is caught here
   * and put on the heading. Only when it has actually fallen: a reader who was
   * somewhere else keeps their place.
   */
  const wasAdmin = useRef(isProjectAdmin);
  useEffect(() => {
    if (wasAdmin.current && !isProjectAdmin) {
      const active = document.activeElement;
      if (!active || active === document.body) heading.current?.focus();
    }
    wasAdmin.current = isProjectAdmin;
  }, [isProjectAdmin]);

  const badge = keyBadgeStyle(projectKey, projectColor);
  const count = members?.length;

  return (
    <Modal
      title="Members"
      eyebrow={
        badge ? (
          <span className="key-badge" style={badge}>
            {projectKey}
          </span>
        ) : undefined
      }
      onClose={close}
    >
      <div className="members-panel">
        {isProjectAdmin ? (
          <form
            className="member-add-form"
            onSubmit={(event) => {
              event.preventDefault();
              submitAdd();
            }}
          >
            <div className="field">
              <label htmlFor={fieldId}>Add by user ID</label>
              <input
                aria-describedby={hintId}
                autoComplete="off"
                autoFocus
                className="mono-input"
                id={fieldId}
                onChange={(event) => setDraft(event.target.value)}
                ref={field}
                spellCheck={false}
                value={draft}
              />
            </div>
            {/* One line in one place: the standing explanation of why this is an
                id and not a name, replaced by the reason Add is off whenever
                there is one. Not a live region — it would speak on every
                keystroke — so it is tied to the field and to Add instead. */}
            <p className="member-add-hint" id={hintId}>
              {problem ?? "Search by name or email is not available yet, so people are added by user ID."}
            </p>
            <div className="member-add-actions">
              {/* A sibling label rather than one wrapped around the select:
                  wrapped, the options' text joins the select's accessible name
                  in Chromium, and "Role Admin Member Viewer" is not a name. */}
              <span className="member-role-field">
                <label htmlFor={roleId}>Role</label>
                <select id={roleId} onChange={(event) => setRole(event.target.value as ProjectRole)} value={role}>
                  {PROJECT_ROLES.map((option) => (
                    <option key={option} value={option}>
                      {roleLabels[option]}
                    </option>
                  ))}
                </select>
              </span>
              {/* `aria-disabled`, never `disabled` (§4.21): the handler clears the
                  field as it dispatches, so a button that disabled itself would
                  drop the keyboard reader's focus to `<body>` on every add. */}
              <button
                aria-describedby={hintId}
                aria-disabled={!canAdd || undefined}
                className="primary-button compact-button"
                type="submit"
              >
                Add
              </button>
            </div>
          </form>
        ) : null}

        {/* One polite region that stays mounted and changes its text (§7), and
            only the sentence is in it: the detail line carries a request id,
            which is for copying, not for hearing. */}
        <div className={notice ? `member-note${notice.tone === "error" ? " is-error" : ""}` : undefined}>
          <p aria-live="polite" className="member-note-sentence">
            {notice?.text ?? ""}
          </p>
          <MemberNoteDetail error={notice?.error} />
        </div>

        <section className="member-list-section">
          <h3 className="members-heading" ref={heading} tabIndex={-1}>
            Current members
            {count !== undefined ? <span className="count-pill">{count}</span> : null}
          </h3>

          {isProjectAdmin ? null : (
            <p className="member-readonly-note">Only a project admin can add, change or remove members.</p>
          )}

          {membersUnread.unanswered ? (
            <div className="member-note is-error">
              <p className="member-note-sentence">This project&rsquo;s members could not be loaded.</p>
              <MemberNoteDetail error={membersUnread.error} />
            </div>
          ) : membersQuery.isPending ? (
            <p className="issue-links-empty">Loading members</p>
          ) : members && members.length === 0 && pendingAdds.length === 0 ? (
            <p className="issue-links-empty">No members came back for this project.</p>
          ) : null}

          {(members && members.length > 0) || pendingAdds.length > 0 ? (
            <ul className="member-list">
              {(members ?? []).map((member) => {
                const subject = subjectOf(member, currentUserId);
                const lastAdmin = member.role === "ADMIN" && adminCount <= 1;
                const confirming = confirm?.userId === member.userId ? confirm : null;
                return (
                  <MemberRow
                    confirm={confirming}
                    isProjectAdmin={isProjectAdmin}
                    key={member.userId}
                    lastAdmin={lastAdmin}
                    member={member}
                    onAcceptConfirm={acceptConfirm}
                    onCancelConfirm={cancelConfirm}
                    onPickRole={(nextRole) => {
                      if (rolesInFlight.includes(member.userId)) return;
                      if (subject.self && member.role === "ADMIN" && nextRole !== "ADMIN") {
                        setNotice(null);
                        setConfirm({ kind: "demote-self", userId: member.userId, role: nextRole });
                        return;
                      }
                      // Picking the current role back while asking is the reader
                      // answering the question themselves.
                      if (confirming?.kind === "demote-self") {
                        setConfirm(null);
                        return;
                      }
                      changeRole.mutate({ userId: member.userId, role: nextRole });
                    }}
                    onToggleRemove={() => openRemoveConfirm(member.userId)}
                    roleInFlight={rolesInFlight.includes(member.userId)}
                    selectRef={(node) => {
                      if (node) selects.current.set(member.userId, node);
                      else selects.current.delete(member.userId);
                    }}
                    subject={subject}
                    toggleRef={(node) => {
                      if (node) toggles.current.set(member.userId, node);
                      else toggles.current.delete(member.userId);
                    }}
                  />
                );
              })}
              {pendingAdds
                .filter((row) => !members?.some((member) => member.userId === row.userId))
                .map((row) => (
                  <li className="member-row is-pending" key={`pending-${row.userId}`}>
                    <Avatar label="Being added" size="sm" user={null} />
                    <span className="member-who">
                      <span className="member-id">{row.userId}</span>
                      <span className="member-line">Adding as {roleLabels[row.role]}…</span>
                    </span>
                  </li>
                ))}
            </ul>
          ) : null}
        </section>
      </div>
    </Modal>
  );
}

interface MemberRowProps {
  member: ProjectMember;
  subject: MemberSubject;
  isProjectAdmin: boolean;
  lastAdmin: boolean;
  roleInFlight: boolean;
  confirm: PendingConfirm | null;
  onPickRole: (role: ProjectRole) => void;
  onToggleRemove: () => void;
  onAcceptConfirm: () => void;
  onCancelConfirm: () => void;
  selectRef: (node: HTMLSelectElement | null) => void;
  toggleRef: (node: HTMLButtonElement | null) => void;
}

/**
 * One member. The row a VIEWER sees and the row an ADMIN sees are the same row
 * with the controls left out, so the two cannot drift into describing a person
 * differently.
 */
function MemberRow({
  member,
  subject,
  isProjectAdmin,
  lastAdmin,
  roleInFlight,
  confirm,
  onPickRole,
  onToggleRemove,
  onAcceptConfirm,
  onCancelConfirm,
  selectRef,
  toggleRef,
}: MemberRowProps) {
  const confirmId = useId();
  const cancelButton = useRef<HTMLButtonElement | null>(null);
  const named = Boolean(member.user);

  // Into the question as soon as it is asked, on the button that changes
  // nothing — so a second Enter from the keyboard cancels rather than removes.
  useEffect(() => {
    if (confirm) cancelButton.current?.focus();
  }, [confirm]);

  /**
   * A role select for every ADMIN view of a row that can change: a known
   * person, not the last admin. A row the member read could not name gets
   * only its remove control — there is no account behind it to give a role to
   * — and a role the server did not state is drawn as that, not as a guess.
   */
  const canChangeRole = isProjectAdmin && named && !lastAdmin && member.role !== null;
  const canRemove = isProjectAdmin && !lastAdmin;
  // While asking, the select shows the answer being asked about, so it does
  // not look as though the pick was ignored.
  const shownRole = confirm?.kind === "demote-self" ? confirm.role : member.role;

  const confirmSentence =
    confirm?.kind === "demote-self"
      ? `You will stop being an admin of this project, and only another admin can make you one again.`
      : subject.self
        ? "You will lose access to this project and go back to your projects."
        : named
          ? `${subject.name} will lose access to this project.`
          : "The membership for this ID will be removed.";
  const confirmLabel =
    confirm?.kind === "demote-self" ? `Make me ${roleLabels[confirm.role]}` : subject.self ? "Remove me" : "Remove";

  return (
    <li className="member-row">
      {/* `label` is what the circle announces when there is no person to draw:
          the same word as the row, never §4.4's "Unassigned". */}
      <Avatar
        label={named ? undefined : subject.self ? "You" : "Unknown"}
        size="sm"
        user={
          member.user
            ? {
                id: member.userId,
                displayName: member.user.displayName,
                color: member.user.color,
                avatarUrl: member.user.avatarUrl,
              }
            : null
        }
      />
      <span className="member-who">
        <span className="member-name">
          {named ? member.user?.displayName : subject.self ? "You" : "Unknown"}
          {subject.self && named ? <span className="member-you"> (you)</span> : null}
        </span>
        {named ? (
          member.user?.email ? <span className="member-line">{member.user.email}</span> : null
        ) : (
          <>
            {/* The whole id, selectable: for a row like this it is the only
                handle anyone has, and the one thing worth pasting into a
                question to whoever added it. */}
            <span className="member-id">{member.userId}</span>
            <span className="member-line">No account came back for this ID.</span>
          </>
        )}
      </span>

      {canChangeRole ? (
        <select
          aria-busy={roleInFlight || undefined}
          // In flight, so `aria-disabled` and a guard in the handler rather than
          // `disabled`, which would drop the focus of the reader who just used it.
          aria-disabled={roleInFlight || undefined}
          aria-label={subject.self ? "Your role" : `Role of ${subject.inSentence}`}
          className="member-role-select"
          onChange={(event) => onPickRole(event.target.value as ProjectRole)}
          ref={selectRef}
          value={shownRole ?? ""}
        >
          {PROJECT_ROLES.map((option) => (
            <option key={option} value={option}>
              {roleLabels[option]}
            </option>
          ))}
        </select>
      ) : (
        <span className="member-role-label">{member.role ? roleLabels[member.role] : "Unknown role"}</span>
      )}

      {canRemove ? (
        <button
          aria-controls={confirm?.kind === "remove" ? confirmId : undefined}
          aria-expanded={confirm?.kind === "remove"}
          aria-label={subject.self ? "Remove yourself from this project" : `Remove ${subject.inSentence} from this project`}
          className="icon-button"
          onClick={onToggleRemove}
          ref={toggleRef}
          type="button"
        >
          <Trash2 size={14} />
        </button>
      ) : null}

      {isProjectAdmin && lastAdmin ? (
        <p className="member-row-note">
          {subject.self
            ? "You are this project’s only admin, so your role cannot change and you cannot be removed until someone else is an admin."
            : `${subject.name} is this project’s only admin, so this role cannot change and they cannot be removed until someone else is an admin.`}
        </p>
      ) : null}

      {confirm ? (
        <div className="member-confirm" id={confirmId}>
          <p className="member-confirm-sentence" id={`${confirmId}-sentence`}>
            {confirmSentence}
          </p>
          <div className="member-confirm-actions">
            <button className="secondary-button compact-button" onClick={onCancelConfirm} ref={cancelButton} type="button">
              Cancel
            </button>
            <button
              aria-describedby={`${confirmId}-sentence`}
              className="secondary-button compact-button member-confirm-accept"
              onClick={onAcceptConfirm}
              type="button"
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

/**
 * The second line of a notice: the server's own words and the id that finds
 * the failure in the gateway log. The sentence above it is always this
 * dialog's, because it has to say what did *not* happen after an optimistic
 * change was put back — and the server's words, which name ids rather than
 * people, belong under it rather than in its place.
 */
function MemberNoteDetail({ error }: { error: unknown }) {
  const { message, requestId } = apiErrorFacts(error);
  if (!message && !requestId) return null;
  return (
    <p className="member-note-detail">
      {message ? <span>{message}</span> : null}
      {requestId ? <RequestId value={requestId} /> : null}
    </p>
  );
}

/**
 * The refusals, read from either implementation. The code is the half the mock
 * carries; the status is the half a gateway answer carries even when its body
 * did not parse. `FAILED_PRECONDITION` is read by code alone, because its
 * status is a 400 that an ordinary bad request shares (see `isConflict`).
 */
function isAlreadyMember(error: unknown): boolean {
  const { code, status } = apiErrorFacts(error);
  return code === "ALREADY_EXISTS" || status === 409;
}

function isLastAdmin(error: unknown): boolean {
  return apiErrorFacts(error).code === "FAILED_PRECONDITION";
}

function isForbidden(error: unknown): boolean {
  const { code, status } = apiErrorFacts(error);
  return code === "PERMISSION_DENIED" || status === 403;
}

function isMissing(error: unknown): boolean {
  const { code, status } = apiErrorFacts(error);
  return code === "NOT_FOUND" || status === 404;
}

const REFUSED_NOT_ADMIN =
  "The server refused: only a project admin can change members, and your role on this project may have changed.";

function addFailureText(error: unknown): string {
  if (isAlreadyMember(error)) return "This user ID is already a member of this project.";
  if (isForbidden(error)) return REFUSED_NOT_ADMIN;
  if (isMissing(error)) return "This project could not be found, so nobody was added.";
  return "Nobody was added to this project.";
}

function roleFailureText(error: unknown, subject: MemberSubject): string {
  if (isLastAdmin(error)) {
    return subject.self
      ? "You are this project’s only admin, so your role did not change."
      : `${subject.name} is this project’s only admin, so the role did not change.`;
  }
  if (isForbidden(error)) return REFUSED_NOT_ADMIN;
  if (isMissing(error)) return notMemberText(subject);
  return subject.self ? "Your role did not change." : `The role did not change for ${subject.inSentence}.`;
}

function removeFailureText(error: unknown, subject: MemberSubject): string {
  if (isLastAdmin(error)) {
    return subject.self
      ? "You are this project’s only admin, so you were not removed."
      : `${subject.name} is this project’s only admin, so they were not removed.`;
  }
  if (isForbidden(error)) return REFUSED_NOT_ADMIN;
  return subject.self ? "You were not removed from this project." : `${subject.name} was not removed from this project.`;
}

function notMemberText(subject: MemberSubject): string {
  return subject.self
    ? "You are not a member of this project any more, so nothing changed."
    : `${subject.name} is not a member of this project any more, so nothing changed.`;
}
