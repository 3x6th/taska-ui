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
 * not ask — unless the dialog cannot yet tell whose row is the reader's
 * (`GET /users/me` has not answered), in which case every ADMIN demotion asks,
 * because any of them may be the reader's own.
 */
type PendingConfirm = { kind: "remove"; userId: string } | { kind: "demote"; userId: string; role: ProjectRole };

/**
 * What one row offers an ADMIN, decided for the whole list in one place so the
 * row, the open confirmation and the press that answers it cannot disagree.
 *
 * `frozen` is the last-admin rule, and it is **stricter than the server's**
 * for a row with an account. project-service counts every ADMIN row
 * (`validateBeforeModify`), including a row whose id no account came back for
 * — which TAS-227 lets anybody add. Counted that way, the only real admin next
 * to an unknown-ID admin could demote or remove themselves, and the project
 * would be left with an admin nobody can sign in as: every member write is
 * ADMIN-only and a GLOBAL_ADMIN gets no exemption. So a row *with* an account
 * counts only the ADMIN rows with an account, and a row *without* one keeps the
 * server's count and stays removable. `unnamedAdmins` is how many admin rows
 * with no account sit beside a frozen admin, which is what the note under it
 * has to say.
 */
interface RowControls {
  frozen: { unnamedAdmins: number } | null;
  canChangeRole: boolean;
  canRemove: boolean;
}

interface ProjectMembersModalProps {
  projectId: string;
  projectKey: string;
  /** For the eyebrow badge only, so it matches the one in the board header (see `ProjectLabelsModal`). */
  projectColor?: string | null;
  /**
   * The board's reading of the reader's role, from the membership query it
   * already holds — so this dialog spends no request deciding what to offer.
   * One value with three kinds of answer, the way the board reads it since
   * TAS-226: `undefined` while that read has not answered; `null` when it
   * failed or answered with no role this build knows — the two cases the board
   * puts a banner up for; otherwise the role the server stated.
   *
   * Only `ADMIN` gets controls. Presentation only: the server refuses all three
   * writes for anybody else.
   */
  readerRole: ProjectRole | null | undefined;
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
  readerRole,
  currentUserId,
  onClose,
}: ProjectMembersModalProps) {
  const isProjectAdmin = readerRole === "ADMIN";
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
  /** Set once the reader's own removal has gone through, so nothing afterwards re-reads the board they left. */
  const leftProject = useRef(false);

  const membersKey = useMemo(() => ["members", projectId], [projectId]);
  const membersQuery = useQuery({
    queryKey: membersKey,
    queryFn: () => taskaApi.listMembers(projectId),
    retry: retryUnlessMissing,
  });
  const membersUnread = useUnanswered(membersQuery);
  const members = membersQuery.data;
  const readerKnown = currentUserId !== undefined;

  /**
   * A question is only open while its row still offers the control that asked
   * it. The list can move under an open strip — a refetch, or the reader's own
   * write on another row — until the last-admin rule forbids what the strip
   * would send, or the row is gone; the role can stop being ADMIN too, when a
   * 403 re-reads it. A strip left behind would offer a write the server refuses,
   * or one that leaves the project with nobody who can manage it (see
   * `RowControls`), and would make `Esc` spend a press on it.
   *
   * So it is closed here, during render — the pattern `useUnanswered` uses,
   * which commits once instead of painting the stale strip first — and the
   * reader is told why, unless a sentence about something else is already up
   * (a 403's own, for one). Where focus goes when the strip leaves under it is
   * the effect further down.
   */
  const confirmOffered = pendingConfirm !== null && offersConfirm(pendingConfirm, members, isProjectAdmin);
  if (pendingConfirm !== null && !confirmOffered) {
    setConfirm(null);
    if (notice === null) setNotice({ tone: "info", text: isProjectAdmin ? LIST_CHANGED_TEXT : ROLE_CHANGED_TEXT });
  }
  const confirm = confirmOffered ? pendingConfirm : null;

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
    onSuccess: async (_result, userId) => {
      if (userId === currentUserId) {
        leaveProject();
        return;
      }
      if (readerKnown) return;
      // Nobody could tell whose row this was when it was asked — `GET /users/me`
      // had not answered — so it is asked now, through the board's own `["me"]`
      // entry, which joins a read still in flight rather than starting another.
      // A reader who removed themselves leaves exactly as above; one who removed
      // somebody else carries on with the ordinary refresh in `onSettled`.
      const me = await queryClient
        .fetchQuery({ queryKey: ["me"], queryFn: () => taskaApi.getCurrentUser() })
        .catch(() => null);
      if (me?.id === userId) {
        leaveProject();
        return;
      }
      if (!me) {
        // Still nobody to compare with. The board's own no-access state is the
        // answer then, and it is reachable only without cached data:
        // `useUnanswered` counts a kept answer as an answer, so a refetch that
        // 403s under cached data changes nothing on screen. Resetting drops the
        // two reads the board gates on and asks again — a reader who removed
        // themselves meets §4.18, anybody else gets the board back one read
        // later.
        await Promise.all([
          queryClient.resetQueries({ queryKey: ["project", projectId] }),
          queryClient.resetQueries({ queryKey: ["membership", projectId] }),
        ]);
      }
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
    onSettled: async (_result, _error, userId) => {
      // Leaving the project is the one success after which nothing here is
      // worth re-reading: the board is being unmounted, and against the gateway
      // every one of these reads would answer 403.
      if (leftProject.current) return;
      await refresh(mayBeSelf(userId));
    },
  });

  /**
   * The reader removed themselves, and this board is not theirs any more: every
   * read under it now answers 403.
   *
   * Taken off their project list first, so `/projects` does not draw the card
   * for a beat before its refetch lands, and replaced in history, so Back does
   * not lead into a board that would only say "not found".
   *
   * Then every read this project's board keeps is dropped, not invalidated. An
   * invalidated read keeps its data, and `useUnanswered` counts kept data as an
   * answer — so a board re-entered within the cache's lifetime, from history, a
   * notification or a search hit, would draw itself as the ADMIN board it was,
   * with controls whose every write is a 403. Dropped, it asks from nothing and
   * meets its own no-access state (§4.18), as on a first visit.
   *
   * Matched by position rather than listed by name: every board-scoped key puts
   * the project id second — `project`, `membership`, `members`, `workflows`,
   * `project-labels`, `issues`, `issue-search`, `issue`, `issue-watchers`,
   * `issue-labels`, `issue-links`, `issue-attachments`, `comments`, and the
   * projects screen's `project-summaries` — and a list would be one more thing
   * to keep in step with BoardScreen. The global search's own key puts
   * `"all-projects"` there instead, and `["projects"]` has no second element, so
   * neither is touched.
   *
   * After `navigate`, which only schedules the route change: nothing re-renders
   * the board between the two calls, and a query dropped from under a mounted
   * observer is only rebuilt when that observer renders again.
   */
  const leaveProject = () => {
    leftProject.current = true;
    queryClient.setQueryData<Project[]>(["projects"], (current) =>
      current?.filter((project) => project.id !== projectId),
    );
    void queryClient.invalidateQueries({ queryKey: ["projects"] });
    navigate("/projects", { replace: true });
    queryClient.removeQueries({ predicate: (query) => query.queryKey[1] === projectId });
  };

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
   * Where focus goes when a row is about to leave with the button that removed
   * it: the next row's remove toggle, or the one before, or the list's heading
   * when no row left offers one. Moved at once, before the write, because the
   * removal is drawn at once too — there is no later moment at which the
   * neighbour is a better target — and a removal of the reader's own row moves
   * it nowhere, because that success leaves the board. (A row that only *may* be
   * the reader's, before `GET /users/me` answers, still hands focus on: if it
   * turns out to be theirs, the board is left anyway.)
   */
  const handFocusOn = (userId: string) => {
    if (userId === currentUserId) return;
    const list = members ?? [];
    const index = list.findIndex((member) => member.userId === userId);
    if (index < 0) return;
    const after = list.slice(index + 1);
    const before = list.slice(0, index).reverse();
    const neighbour = [...after, ...before].find((member) => toggles.current.has(member.userId));
    (neighbour ? toggles.current.get(neighbour.userId) : heading.current)?.focus();
  };

  const acceptConfirm = () => {
    if (!confirm) return;
    // Checked again against the list as the cache holds it at the press, not as
    // this render drew it: the strip is closed as soon as a render sees the
    // guard flip, but a press can land between the cache moving and that render.
    // Nothing is sent then, and the reader is told why.
    if (!offersConfirm(confirm, queryClient.getQueryData<ProjectMember[]>(membersKey), isProjectAdmin)) {
      setConfirm(null);
      setNotice({ tone: "info", text: LIST_CHANGED_TEXT });
      heading.current?.focus();
      return;
    }
    if (confirm.kind === "demote") {
      const { userId, role: nextRole } = confirm;
      setConfirm(null);
      selects.current.get(userId)?.focus();
      changeRole.mutate({ userId, role: nextRole });
      return;
    }
    const { userId } = confirm;
    setConfirm(null);
    handFocusOn(userId);
    removeMember.mutate(userId);
  };

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
   * Two things can unmount the control that holds focus without the reader
   * asking: their own role stops being ADMIN — their own demotion, or a 403 that
   * re-read it — and every control goes; or an open confirmation is closed
   * because the list moved under it (above). Either way focus falls to `<body>`
   * behind the scrim, and it is caught here and put on the heading. Only when it
   * has actually fallen: a reader who was somewhere else keeps their place, and
   * Cancel and the answers move it themselves before the strip goes.
   */
  const hadControls = useRef({ admin: isProjectAdmin, confirm: false });
  useEffect(() => {
    const before = hadControls.current;
    if ((before.admin && !isProjectAdmin) || (before.confirm && confirm === null)) {
      const active = document.activeElement;
      if (!active || active === document.body) heading.current?.focus();
    }
    hadControls.current = { admin: isProjectAdmin, confirm: confirm !== null };
  }, [confirm, isProjectAdmin]);

  const badge = keyBadgeStyle(projectKey, projectColor);
  const count = members?.length;
  const counts = adminCounts(members ?? []);

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

          {/* Why there are no controls, said only as far as the server said it
              (DESIGN.md §4.21 and §5.7, TAS-226): the admin rule is the reason
              for a reader the server named a MEMBER or a VIEWER, and for a role
              nobody stated it would be inventing the answer — so that reader is
              told the role is unknown, which the board's banner also says, under
              this dialog's scrim. Nothing while the role is still being read. */}
          {readerRole === "MEMBER" || readerRole === "VIEWER" ? (
            <p className="member-readonly-note">Only a project admin can add, change or remove members.</p>
          ) : readerRole === null ? (
            <p className="member-readonly-note">Your role on this project is unknown, so members cannot be changed here.</p>
          ) : null}

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
                const controls = rowControls(member, counts, isProjectAdmin);
                const confirming = confirm?.userId === member.userId ? confirm : null;
                return (
                  <MemberRow
                    confirm={confirming}
                    controls={controls}
                    isProjectAdmin={isProjectAdmin}
                    key={member.userId}
                    member={member}
                    onAcceptConfirm={acceptConfirm}
                    onCancelConfirm={cancelConfirm}
                    onPickRole={(nextRole) => {
                      if (rolesInFlight.includes(member.userId)) return;
                      // An admin stepping down asks first, and so does every
                      // ADMIN demotion while the reader is unknown: any of them
                      // may be their own.
                      if (member.role === "ADMIN" && nextRole !== "ADMIN" && (subject.self || !readerKnown)) {
                        setNotice(null);
                        setConfirm({ kind: "demote", userId: member.userId, role: nextRole });
                        return;
                      }
                      // Picking the current role back while asking is the reader
                      // answering the question themselves.
                      if (confirming?.kind === "demote") {
                        setConfirm(null);
                        return;
                      }
                      changeRole.mutate({ userId: member.userId, role: nextRole });
                    }}
                    onToggleRemove={() => openRemoveConfirm(member.userId)}
                    readerKnown={readerKnown}
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
  controls: RowControls;
  /** Whether `GET /users/me` has answered, which decides how a question about this row is worded. */
  readerKnown: boolean;
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
  controls,
  readerKnown,
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
  const { frozen, canChangeRole, canRemove } = controls;

  // Into the question as soon as it is asked, on the button that changes
  // nothing — so a second Enter from the keyboard cancels rather than removes.
  useEffect(() => {
    if (confirm) cancelButton.current?.focus();
  }, [confirm]);

  // While asking, the select shows the answer being asked about, so it does
  // not look as though the pick was ignored.
  const shownRole = confirm?.kind === "demote" ? confirm.role : member.role;

  /**
   * Worded for who the row is. Before `GET /users/me` answers, a named row may
   * be the reader's own, so the question names the person and then says what
   * happens if that person is the one reading — rather than asserting either.
   * A row with no account is never the reader's: they are signed in.
   */
  const confirmSentence =
    confirm?.kind === "demote"
      ? subject.self
        ? "You will stop being an admin of this project, and only another admin can make you one again."
        : `${subject.name} will stop being an admin of this project.${
            readerKnown ? "" : " If that is you, only another admin can make you one again."
          }`
      : subject.self
        ? "You will lose access to this project and go back to your projects."
        : named
          ? `${subject.name} will lose access to this project.${
              readerKnown ? "" : " If that is you, you will go back to your projects."
            }`
          : "The membership for this ID will be removed.";
  const confirmLabel =
    confirm?.kind === "demote"
      ? subject.self
        ? `Make me ${roleLabels[confirm.role]}`
        : `Change to ${roleLabels[confirm.role]}`
      : subject.self
        ? "Remove me"
        : "Remove";

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

      {isProjectAdmin && frozen ? <p className="member-row-note">{frozenNoteText(subject, frozen.unnamedAdmins)}</p> : null}

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

/** How many ADMIN rows the list holds, and how many of them have an account. */
function adminCounts(members: ProjectMember[]): { admins: number; adminsWithAccount: number } {
  const admins = members.filter((member) => member.role === "ADMIN");
  return { admins: admins.length, adminsWithAccount: admins.filter((member) => member.user).length };
}

/** See `RowControls` for why a row with an account and a row without are counted differently. */
function rowControls(
  member: ProjectMember,
  counts: { admins: number; adminsWithAccount: number },
  isProjectAdmin: boolean,
): RowControls {
  const frozen =
    member.role !== "ADMIN"
      ? null
      : member.user
        ? counts.adminsWithAccount <= 1
          ? { unnamedAdmins: counts.admins - counts.adminsWithAccount }
          : null
        : counts.admins <= 1
          ? { unnamedAdmins: 0 }
          : null;
  return {
    frozen,
    // A role select only for a person: a row with no account has nobody to give
    // a role to, and a role the server did not state has no current value to
    // show — both keep their removal.
    canChangeRole: isProjectAdmin && Boolean(member.user) && frozen === null && member.role !== null,
    canRemove: isProjectAdmin && frozen === null,
  };
}

/**
 * Whether the row a question is about still offers the control that asked it,
 * judged against `members` — the rendered list during render, and the cache's
 * own copy at the moment of the press. A demotion has to still be a demotion:
 * a row that is no longer ADMIN has nothing left to step down from.
 */
function offersConfirm(confirm: PendingConfirm, members: ProjectMember[] | undefined, isProjectAdmin: boolean): boolean {
  const member = members?.find((row) => row.userId === confirm.userId);
  if (!members || !member) return false;
  const controls = rowControls(member, adminCounts(members), isProjectAdmin);
  return confirm.kind === "remove" ? controls.canRemove : controls.canChangeRole && member.role === "ADMIN";
}

/** Said when an open question closes because the list moved, or a press found it had. */
const LIST_CHANGED_TEXT = "The member list changed before you confirmed, so nothing was sent.";
/** And when what moved was the reader's own role, which took every control with it. */
const ROLE_CHANGED_TEXT = "Your role on this project changed before you confirmed, so nothing was sent.";

/**
 * The note under a row whose role cannot change and which cannot be removed.
 * Two sentences, because there are two reasons: the server's own — this is the
 * project's only ADMIN — and this dialog's stricter one, where the other admin
 * rows are ids no account came back for, which the server would count and
 * nobody can sign in as.
 */
function frozenNoteText(subject: MemberSubject, unnamedAdmins: number): string {
  if (unnamedAdmins === 0) {
    return subject.self
      ? "You are this project’s only admin, so your role cannot change and you cannot be removed until someone else is an admin."
      : `${subject.name} is this project’s only admin, so this role cannot change and they cannot be removed until someone else is an admin.`;
  }
  const others = unnamedAdmins === 1 ? "the other admin is an ID" : "the other admins are IDs";
  return subject.self
    ? `You are this project’s only admin with an account — ${others} no account came back for — so your role cannot change and you cannot be removed until someone with an account is an admin.`
    : `${subject.name} is this project’s only admin with an account — ${others} no account came back for — so this role cannot change and they cannot be removed until someone with an account is an admin.`;
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
