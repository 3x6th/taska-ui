import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2, X } from "lucide-react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { DIRECTORY_QUERY_MAX_LENGTH, DIRECTORY_QUERY_MIN_CODE_POINTS, directoryQueryLength } from "../api/TaskaApi";
import { taskaApi } from "../api/client";
import { apiErrorFacts, isMissingOrForbidden, isProjectArchived } from "../api/errors";
import { refusalWords } from "../lib/projectArchive";
import { PROJECT_ROLES } from "../api/members";
import type { DirectoryUser, GlobalRole, Project, ProjectMember, ProjectRole } from "../domain/types";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useUnanswered } from "../hooks/useUnanswered";
import { PROJECT_STATS_KEY } from "../lib/boardQuery";
import { keyBadgeStyle } from "../lib/format";
import { projectContextKey } from "../lib/projectContext";
import { shortKey } from "../screens/admin/columns";
import { Avatar } from "./Avatar";
import { Modal } from "./Modal";
import { RequestId } from "./RequestId";

/**
 * The board's own retry rule, restated rather than imported because it lives
 * in a screen file that may only export components. Until TAS-251 this dialog
 * and the board observed one `["members", projectId]` query, where two rules
 * for one key would make "does a 404 get retried" depend on which mounted
 * last; the board now reads its members from its context, and the rule stays
 * the same so the two reads fail the same way.
 */
const retryUnlessMissing = (failureCount: number, error: Error) => !isMissingOrForbidden(error) && failureCount < 1;

/** How a role is said. The wire value stays the wire value (DESIGN.md §6). */
const roleLabels: Record<ProjectRole, string> = { ADMIN: "Admin", MEMBER: "Member", VIEWER: "Viewer" };

/** §4.14's debounce, shared with every other server-backed field. */
const PEOPLE_SEARCH_DEBOUNCE_MS = 200;
/** A page of the directory — the route's own default, and what "Show more" adds (§4.22). */
const PEOPLE_SEARCH_PAGE_SIZE = 20;

/**
 * The directory's retry rule: once for a failure that may be passing, never for
 * a refusal — a 4xx is the same answer the second time, one round trip later.
 */
const retryUnlessRefused = (failureCount: number, error: Error) => {
  const { status, code } = apiErrorFacts(error);
  if ((status !== null && status >= 400 && status < 500) || code === "INVALID_ARGUMENT") return false;
  return failureCount < 1;
};

/** What to call a directory row: its name, or its address when the name came back blank. */
const directoryName = (person: DirectoryUser) => person.displayName.trim() || person.email;

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
 *
 * Two refinements keep the rule honest about what the server holds right now:
 *
 * - **Cover has to be settled.** A row whose role write is still out counts
 *   as an admin only if it was one before the write and is one after it. A
 *   promotion in flight is drawn at once, and counted at once it let the only
 *   real admin step down behind a promotion the server might refuse or apply
 *   late — which, beside an admin with no account, is the project nobody can
 *   manage again. Counting it at its pre-write role alone would not do either:
 *   a demotion in flight would then count as cover it is about to stop being.
 * - **The reader's own row always has an account**, whatever the member read
 *   says about it: the reader is signed in. A real account whose display name
 *   comes back blank reads as nameless (`toProjectMember` in RestTaskaApi.ts),
 *   and counted as "no account" the reader's own admin row would stop covering
 *   anybody, and stop being protected as the last admin with one.
 */
interface RowControls {
  frozen: { unnamedAdmins: number } | null;
  canChangeRole: boolean;
  canRemove: boolean;
}

/** A role write still out, by user id, with the role that row held before it. */
type RolesInFlight = Readonly<Record<string, ProjectRole | null>>;

/** Everything the last-admin rule reads, gathered so the row, the strip and the press read the same thing. */
interface AdminGuard {
  members: ProjectMember[];
  rolesInFlight: RolesInFlight;
  currentUserId?: string;
  isProjectAdmin: boolean;
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
  /**
   * The project is archived (backend PR #159, DESIGN.md §5.7): the list stays,
   * every control goes for every role, and one line says why in place of the
   * role's. Off the board's context, like the role.
   */
  archived?: boolean;
  /** `undefined` until `GET /users/me` answers; until then no row is marked as the reader's. */
  currentUserId?: string;
  /**
   * The reader's account-wide role, from the same `GET /users/me`. It decides
   * one sentence only: who to send somebody to when a search finds nobody —
   * Administration › Users for a global admin, a global admin for everybody
   * else, and the second for a role not stated (§4.22).
   */
  globalRole?: GlobalRole;
  onClose: () => void;
}

/**
 * The project's members, and for its ADMIN the three writes on them (TAS-158):
 * add somebody found by name or email, change a member's role, remove a member.
 *
 * **Every reader of the board can open this**; only an ADMIN sees controls in
 * it. The member list is not a secret from a VIEWER — the assignee filter
 * already draws everyone — and a dialog that answered "who is on this project"
 * for some readers and not others would be hiding the one thing a VIEWER is
 * most likely to need to ask an admin about.
 *
 * **People are found, not typed** (§4.22, TAS-297). The field searches the
 * people directory (`GET /users`, backend #204) by name or email, and a person
 * is chosen from the results before Add will send anything; there is no way to
 * add by id any more. Who is already on the project is marked from the list
 * this dialog already holds, so marking costs no request.
 *
 * Three things are easy to get wrong here, and each has a comment where it is
 * handled:
 *
 * - **An id nobody holds is a successful add** (TAS-227). Search cannot produce
 *   one, but rows added by id before it still exist: they come back from the
 *   member read with no name and no email, and are drawn as exactly that — the
 *   id, and a sentence saying no account came back for it — rather than as a
 *   person this client invented.
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
  archived = false,
  currentUserId,
  globalRole,
  onClose,
}: ProjectMembersModalProps) {
  const isProjectAdmin = readerRole === "ADMIN" && !archived;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  /** What is typed in the search field. Kept while a person is chosen, so "Choose someone else" brings the search back. */
  const [draft, setDraft] = useState("");
  /** The person Add will send, once one is chosen from the results. */
  const [chosen, setChosen] = useState<DirectoryUser | null>(null);
  /** Whether the results are showing; `Esc` closes them and leaves the text (§4.22). */
  const [listOpen, setListOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [role, setRole] = useState<ProjectRole>("MEMBER");
  /**
   * Adds the server has not answered for yet, with the person as the search
   * named them. Held here rather than written into a cached member list,
   * because the board draws its members too: an optimistic row there would put
   * somebody into the assignee filter behind the scrim for the length of the
   * request, as a person a reader could filter the board by before the server
   * had agreed they are on the project.
   */
  const [pendingAdds, setPendingAdds] = useState<{ user: DirectoryUser; role: ProjectRole }[]>([]);
  /**
   * Rows whose role write is out, with the role each held before it: their
   * select stops answering until it lands, and none of them counts as another
   * admin's cover meanwhile (`RowControls`).
   */
  const [rolesInFlight, setRolesInFlight] = useState<RolesInFlight>({});
  const [pendingConfirm, setConfirm] = useState<PendingConfirm | null>(null);
  const [notice, setNotice] = useState<MemberNotice | null>(null);
  /**
   * The notice sits above the list, and the refusal it explains is usually about
   * a row further down — so on a list long enough to scroll, a rolled-back write
   * would say why out of sight. It is brought into view when it changes.
   * `nearest` moves nothing when it is already visible, and there is no
   * `behavior`: an instant jump has nothing to degrade under reduced motion.
   */
  const noticeBox = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (notice) noticeBox.current?.scrollIntoView({ block: "nearest" });
  }, [notice]);
  const fieldId = useId();
  const roleId = useId();
  const hintId = useId();
  const listId = useId();

  // Closing hands focus back to the Members button through `Modal`, which does
  // it for every dialog since TAS-299; this one used to do it itself.
  const heading = useRef<HTMLHeadingElement | null>(null);
  const field = useRef<HTMLInputElement | null>(null);
  const addButton = useRef<HTMLButtonElement | null>(null);
  const resultsList = useRef<HTMLUListElement | null>(null);
  /** Set when the next render should put focus back in the search field — after it remounts in place of a choice. */
  const focusFieldNext = useRef(false);
  /** The text as typed, for the one callback that must not overwrite it: a refused add (see `addMember`). */
  const draftNow = useRef(draft);
  useEffect(() => {
    draftNow.current = draft;
  });
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
  const guard = (list: ProjectMember[] | undefined): AdminGuard | undefined =>
    list && { members: list, rolesInFlight, currentUserId, isProjectAdmin };
  const confirmOffered = pendingConfirm !== null && offersConfirm(pendingConfirm, guard(members));
  if (pendingConfirm !== null && !confirmOffered) {
    setConfirm(null);
    if (notice === null) {
      setNotice({
        tone: "info",
        // An archive that landed under the open question took the controls,
        // not the reader's role.
        text: isProjectAdmin ? LIST_CHANGED_TEXT : archived ? ARCHIVED_BEFORE_CONFIRM_TEXT : ROLE_CHANGED_TEXT,
      });
    }
  }
  const confirm = confirmOffered ? pendingConfirm : null;

  /**
   * Everything that draws members goes stale with a write: this dialog reads
   * `["members", projectId]`, the board reads its members — and the reader's
   * role, which a write about the reader's own row changes — from its context
   * read (TAS-251), and the project card on `/projects` reads its count and
   * faces from `["project-stats"]` (TAS-202). A write about the reader's own row also
   * changes the list rows whose edit control depends on the role.
   *
   * `mayBeSelf` rather than `self`: before `GET /users/me` has answered, no row
   * can be ruled out as the reader's, and re-reading a role that did not change
   * costs one request where failing to re-read one that did leaves an ADMIN's
   * controls on a board that has stopped being theirs.
   */
  const refresh = (mayBeSelf: boolean) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: membersKey }),
      queryClient.invalidateQueries({ queryKey: projectContextKey(projectId) }),
      queryClient.invalidateQueries({ queryKey: PROJECT_STATS_KEY }),
      ...(mayBeSelf ? [queryClient.invalidateQueries({ queryKey: ["projects"] })] : []),
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
      void queryClient.invalidateQueries({ queryKey: projectContextKey(projectId) });
    }
  };

  const addMember = useMutation({
    mutationFn: (input: { user: DirectoryUser; role: ProjectRole }) =>
      taskaApi.addProjectMember(projectId, input.user.id, input.role),
    onMutate: (input) => {
      setNotice(null);
      setPendingAdds((current) =>
        current.some((row) => row.user.id === input.user.id) ? current : [...current, input],
      );
    },
    // The answer is the membership and not the person — no name, no email — so
    // the row that replaces the pending one comes from reading the list again.
    // Awaited before the pending row goes, so it never leaves a gap where
    // neither row is on screen.
    onSuccess: async (_result, input) => {
      await refresh(false);
      setPendingAdds((current) => current.filter((row) => row.user.id !== input.user.id));
    },
    onError: (error, input) => {
      setPendingAdds((current) => current.filter((row) => row.user.id !== input.user.id));
      // The person comes back as the choice — unless something has been typed
      // or chosen since, which this must never overwrite — so the reader can
      // send it again rather than search again. Not for "already a member":
      // there is nothing to resend, and the re-read below puts them in the list.
      if (!isAlreadyMember(error) && draftNow.current === "") setChosen((current) => current ?? input.user);
      forgetRoleIfRefused(error);
      setNotice({ tone: "error", text: addFailureText(error, directoryName(input.user)), error });
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
      // Read before the optimistic write below, and recorded with the row, so
      // the guard can tell a promotion still in flight from an admin who is one.
      const previous = queryClient.getQueryData<ProjectMember[]>(membersKey)?.find(
        (member) => member.userId === input.userId,
      )?.role;
      setRolesInFlight((current) => ({ ...current, [input.userId]: previous ?? null }));
      await queryClient.cancelQueries({ queryKey: membersKey });
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
      setRolesInFlight(({ [input.userId]: _settled, ...rest }) => rest);
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
      await leaveIfReaderIsGone(userId);
    },
    onError: async (error, userId, context) => {
      const member = context?.row ?? { userId };
      const subject = subjectOf(member, currentUserId);
      if (isMissing(error)) {
        // The end state is the one that was asked for, so nothing comes back.
        // What did not happen is the removal, and that is worth a sentence —
        // with the server's own words and request id under it, as every other
        // refusal has.
        //
        // The reader's own row answered 404 is the reader removed by somebody
        // else first, and this arm takes them out of the project. That is the
        // stand today: until backend PR #185 (TAS-229) deploys, the validator
        // looks for the target before it checks the actor, so a reader removed
        // a moment earlier is told `Project member with id … was not found`.
        //
        // Once #185 is deployed the actor check runs first, and that reader is
        // refused 403 instead — their own row is the actor row the check reads
        // — and lands in the 403 arm below, which re-reads their role. A 404 on
        // the reader's own row then comes only from the validator's empty read,
        // `Project: … doesn't exist`: the project has no rows left for the
        // reader or any admin. Leaving is the right answer to that as well.
        if (await leaveIfReaderIsGone(userId)) return;
        setNotice({ tone: "info", text: notMemberText(subject), error });
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
   * After a row is gone from the server — removed by this press, or found
   * already gone by it — whether that row was the reader's, and if so, leaving.
   * Answers whether the reader left.
   *
   * When nobody could tell whose row it was at the press — `GET /users/me` had
   * not answered — it is asked now, through the board's own `["me"]` entry,
   * which joins a read still in flight rather than starting another. If that
   * cannot be read either, the board's own no-access state is the answer, and it
   * is reachable only without cached data: `useUnanswered` counts a kept answer
   * as an answer, so a refetch that 403s under cached data changes nothing on
   * screen. Resetting drops the two reads the board gates on and asks again — a
   * reader who removed themselves meets §4.18, anybody else gets the board back
   * one read later.
   */
  const leaveIfReaderIsGone = async (userId: string): Promise<boolean> => {
    if (userId === currentUserId) {
      leaveProject();
      return true;
    }
    if (readerKnown) return false;
    const me = await queryClient
      .fetchQuery({ queryKey: ["me"], queryFn: () => taskaApi.getCurrentUser() })
      .catch(() => null);
    if (me?.id === userId) {
      leaveProject();
      return true;
    }
    if (!me) {
      await queryClient.resetQueries({ queryKey: projectContextKey(projectId) });
    }
    return false;
  };

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
   * the project id second — `project-context`, `members`, `board`,
   * `project-workflows`, `issue`, `comments`, `worklogs` — and a list would be
   * one more thing to keep in step with BoardScreen. The global search's own key
   * puts `"all-projects"` there instead, and `["projects"]` and
   * `["project-stats"]` have no second element, so neither is touched: the
   * list is rewritten above and re-read, and the stats answer is only ever drawn
   * for a project the list holds.
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
   * The search (§4.22): debounced at §4.14's 200, trimmed, and never sent under
   * three code points — the API layer refuses that too, and `enabled` reads the
   * same constant. One page of twenty at a time, "Show more" for the next; the
   * previous answer stays on screen while the next question is out, so the row
   * of controls under it does not jump.
   */
  const trimmed = draft.trim();
  const debounced = useDebouncedValue(trimmed, PEOPLE_SEARCH_DEBOUNCE_MS);
  const typedEnough = directoryQueryLength(trimmed) >= DIRECTORY_QUERY_MIN_CODE_POINTS;
  const boxOpen = isProjectAdmin && chosen === null && listOpen && trimmed !== "";
  const search = useInfiniteQuery({
    queryKey: ["user-directory", debounced],
    queryFn: ({ pageParam }) =>
      taskaApi.searchUsers({ query: debounced, page: pageParam, pageSize: PEOPLE_SEARCH_PAGE_SIZE }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.hasMore ? pages.length : undefined),
    enabled: boxOpen && directoryQueryLength(debounced) >= DIRECTORY_QUERY_MIN_CODE_POINTS,
    placeholderData: keepPreviousData,
    retry: retryUnlessRefused,
  });
  const searchUnread = useUnanswered(search);
  const people = useMemo(() => search.data?.pages.flatMap((page) => page.items) ?? [], [search.data]);
  const searchFailed = searchUnread.unanswered || search.isFetchNextPageError;
  const showPeople = boxOpen && typedEnough && people.length > 0;

  const memberIds = useMemo(() => new Set((members ?? []).map((member) => member.userId)), [members]);
  /** Why a result cannot be chosen, in the words its row says it — or `null` when it can be. */
  const inertNote = (person: DirectoryUser) =>
    memberIds.has(person.id)
      ? "Already a member"
      : pendingAdds.some((row) => row.user.id === person.id)
        ? "Being added"
        : null;

  // A new question deselects: an active row held over from the previous query
  // would put Enter on a person the reader is no longer looking at. Adjusted
  // during render, as `GlobalSearch` does, so the stale selection never paints.
  const [activeFor, setActiveFor] = useState(debounced);
  if (activeFor !== debounced) {
    setActiveFor(debounced);
    setActiveIndex(-1);
  }

  // The combobox keeps DOM focus in the field, so nothing scrolls the active
  // row into a list taller than its box by itself (§4.20's rule, `GlobalSearch`).
  useEffect(() => {
    if (activeIndex < 0) return;
    resultsList.current?.children[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  // Back into the field once it is mounted again in place of a choice.
  useEffect(() => {
    if (!focusFieldNext.current) return;
    focusFieldNext.current = false;
    field.current?.focus();
  });

  const optionId = (index: number) => `${listId}-option-${index}`;
  const active = showPeople && activeIndex >= 0 ? people[activeIndex] : undefined;

  const choose = (index: number) => {
    const person = people[index];
    // Members and people being added are passed over by the arrows' choice and
    // the pointer's alike: their row says why.
    if (!person || inertNote(person) !== null) return;
    setChosen(person);
    setListOpen(false);
    // To Add, which stays mounted under the field the choice replaces (§4.22).
    addButton.current?.focus();
  };

  const chooseSomeoneElse = () => {
    setChosen(null);
    setListOpen(true);
    focusFieldNext.current = true;
  };

  const move = (delta: number) => {
    if (!people.length) return;
    setActiveIndex((current) => {
      const next = current + delta;
      if (next < 0) return people.length - 1;
      if (next >= people.length) return 0;
      return next;
    });
  };

  const onFieldKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!listOpen) {
        setListOpen(true);
        return;
      }
      move(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Enter") {
      // Never the form's submit from here: Add is the only thing that sends,
      // and it is off until somebody is chosen.
      event.preventDefault();
      // Only rows that answer the question as it now stands: while the next
      // answer is out, the rows on screen are the previous question's.
      if (!showPeople || search.isPlaceholderData) return;
      if (activeIndex >= 0) {
        choose(activeIndex);
        return;
      }
      const first = people.findIndex((person) => inertNote(person) === null);
      if (first >= 0) choose(first);
    }
  };

  const showMore = async () => {
    if (search.isFetchingNextPage) return;
    const before = people.length;
    const result = await search.fetchNextPage();
    if (result.isError) return;
    // The first new row becomes the active one, so the arrows carry on from
    // where the reader asked for more; with nothing left to ask for, the button
    // goes and focus returns to the field rather than to <body>.
    setActiveIndex(before);
    if (!result.hasNextPage) field.current?.focus();
  };

  /** What Add would send, if anything: a chosen person not already on the list, and not already on the way. */
  const canAdd =
    chosen !== null && !memberIds.has(chosen.id) && !pendingAdds.some((row) => row.user.id === chosen.id);

  /**
   * The line under the search, tied to the field and to Add and never live —
   * it would speak on every keystroke and every arrow (§4.22). It says what
   * Add would do, or why the active row cannot be chosen, or how to start.
   */
  const activeNote = active ? inertNote(active) : null;
  const hint = chosen
    ? `${directoryName(chosen)} will be added as ${roleLabels[role]}.`
    : active && activeNote === "Already a member"
      ? `${directoryName(active)} is already a member of this project.`
      : active && activeNote === "Being added"
        ? `${directoryName(active)} is being added to this project.`
        : "Search by name or email, then choose a person from the results.";

  /**
   * The one polite region in the results box, mounted with the form and never
   * remounted, so a change of words is what gets announced (§7). It says the
   * states in words, and only the count when there are rows — the rows say the
   * rest.
   */
  const searchState = !boxOpen
    ? ""
    : !typedEnough
      ? `Type at least ${DIRECTORY_QUERY_MIN_CODE_POINTS} characters to search.`
      : searchFailed
        ? "People search could not be run."
        : people.length > 0
          ? search.hasNextPage
            ? `Showing the first ${people.length}.`
            : `${people.length} ${people.length === 1 ? "person" : "people"}.`
          : search.data !== undefined && !search.isPlaceholderData
            ? `No one matches “${debounced}”.`
            : "Searching people…";
  const noMatch = boxOpen && typedEnough && !searchFailed && people.length === 0 && search.data !== undefined && !search.isPlaceholderData;

  const submitAdd = () => {
    // The guard the `aria-disabled` on Add no longer enforces by itself.
    if (!canAdd || chosen === null) return;
    addMember.mutate({ user: chosen, role });
    // Cleared here rather than when the answer lands, for the reason the label
    // and watcher pickers give: a reset a round trip later lands on whatever
    // was typed in the meantime and takes it. The field comes back empty and
    // takes focus (§4.22).
    setChosen(null);
    setDraft("");
    setListOpen(false);
    focusFieldNext.current = true;
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
    if (!offersConfirm(confirm, guard(queryClient.getQueryData<ProjectMember[]>(membersKey)))) {
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
   * This dialog's inner layers of §4.11's `Esc` (TAS-397): an open question
   * first, then the open results (their text stays). Each takes the key with
   * `preventDefault()` and the dialog stays; with neither open the key is left
   * to `Modal`, which closes the dialog — on `window`, after this `document`
   * listener has had it. There is no `Cmd/Ctrl+Enter`: this dialog has no
   * single action to confirm, and the add form already submits on Enter.
   *
   * Read through a ref, refreshed after every render, so the listener is bound
   * once rather than on every keystroke in the field.
   */
  const onEscape = useRef((_event: KeyboardEvent) => {});
  useEffect(() => {
    onEscape.current = (event) => {
      if (confirm) {
        event.preventDefault();
        cancelConfirm();
      } else if (boxOpen) {
        event.preventDefault();
        setListOpen(false);
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

  return (
    <Modal
      // A member write in flight holds `Esc` (§4.11); ✕ and the scrim still close.
      busy={addMember.isPending || changeRole.isPending || removeMember.isPending}
      title="Members"
      eyebrow={
        badge ? (
          <span className="key-badge" style={badge}>
            {projectKey}
          </span>
        ) : undefined
      }
      onClose={onClose}
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
            <div className="member-search-field">
              {/* Not a `.field`: that rule styles every span inside it as a
                  label, and the choice below is made of spans. The label and the
                  input join `.field`'s recipe by selector instead. A label only
                  while there is a field to label; over a choice it names the
                  group. */}
              {chosen ? (
                <span className="member-search-label" id={`${fieldId}-label`}>
                  Add people
                </span>
              ) : (
                <label className="member-search-label" htmlFor={fieldId}>
                  Add people
                </label>
              )}
              {chosen ? (
                // The choice, in the field's place and in its box (§4.22):
                // who will be added, and the way back to the search.
                <div aria-labelledby={`${fieldId}-label`} className="member-chosen" role="group">
                  <span aria-hidden="true">
                    <Avatar
                      size="sm"
                      user={{ id: chosen.id, displayName: directoryName(chosen), avatarUrl: chosen.avatarUrl }}
                    />
                  </span>
                  <span className="member-who">
                    <span className="member-name" title={directoryName(chosen)}>
                      {directoryName(chosen)}
                    </span>
                    <span className="member-line" title={chosen.email}>
                      {chosen.email}
                    </span>
                  </span>
                  <button
                    aria-label="Choose someone else"
                    className="icon-button member-chosen-clear"
                    onClick={chooseSomeoneElse}
                    title="Choose someone else"
                    type="button"
                  >
                    <X aria-hidden="true" size={14} />
                  </button>
                </div>
              ) : (
                <input
                  aria-activedescendant={showPeople && activeIndex >= 0 ? optionId(activeIndex) : undefined}
                  aria-autocomplete="list"
                  // Both follow the listbox, not the box: the states that are
                  // one sentence are not a listbox, and an `aria-controls`
                  // pointing at an id that is not there is the same mistake
                  // read from the other end (`GlobalSearch`).
                  aria-controls={showPeople ? listId : undefined}
                  aria-describedby={hintId}
                  aria-expanded={showPeople}
                  autoComplete="off"
                  autoFocus
                  className="member-search-input"
                  id={fieldId}
                  maxLength={DIRECTORY_QUERY_MAX_LENGTH}
                  onChange={(event) => {
                    setDraft(event.target.value);
                    setListOpen(true);
                  }}
                  onKeyDown={onFieldKeyDown}
                  placeholder="Name or email"
                  ref={field}
                  role="combobox"
                  spellCheck={false}
                  type="text"
                  value={draft}
                />
              )}

              {/* In the dialog's flow, not a popover (§4.22): a popover would be
                  a second elevation inside the modal's, and would cover the
                  list its "Already a member" marks are about. Always mounted,
                  and empty and heightless while closed, so its one live region
                  is never mounted together with its words.

                  `tabIndex={-1}`: Chromium makes a scrolling box keyboard-
                  focusable on its own once its rows overflow the 242, which put
                  a Tab stop between the field and Show more, drawn with the
                  system's `outline: auto`, and let the arrows scroll the box
                  instead of moving the active row. Focus belongs in the field
                  for the life of the combobox; the box scrolls through
                  `scrollIntoView` on the active row. */}
              <div
                className={`member-search${boxOpen ? " is-open" : ""}${boxOpen && searchFailed ? " is-error" : ""}`}
                // A press inside the box but off a row, a link or a button —
                // its state sentence, its empty space — leaves focus in the
                // field, as a press on a row already does (§4.22, TAS-299).
                // Two guards: a link, a button (RequestId's copy) and the
                // server's words in `.member-note-detail` take the press as
                // usual, the last so they can still be selected by hand, which
                // RequestId's own fallback relies on; and a press on the box's
                // scrollbar is left alone, so the gutter still drags.
                onMouseDown={(event) => {
                  if ((event.target as Element).closest("a, button, .member-note-detail")) return;
                  if (
                    event.target === event.currentTarget &&
                    event.nativeEvent.offsetX >= event.currentTarget.clientWidth
                  ) {
                    return;
                  }
                  event.preventDefault();
                }}
                tabIndex={-1}
              >
                <p
                  aria-live="polite"
                  className={showPeople && !searchFailed ? "visually-hidden" : "member-search-state"}
                >
                  {searchState}
                </p>
                {noMatch ? (
                  <p className="member-search-state member-search-way">
                    {globalRole === "GLOBAL_ADMIN" ? (
                      <>
                        People need a Taska account first. Invite them from{" "}
                        <Link className="admin-note-link" to="/admin/users">
                          Administration › Users
                        </Link>
                        .
                      </>
                    ) : (
                      "People need a Taska account first — a global admin can invite them."
                    )}
                  </p>
                ) : null}
                {boxOpen && searchFailed ? (
                  <MemberNoteDetail error={searchUnread.error ?? search.error} />
                ) : null}
                {showPeople ? (
                  <ul aria-label="People" className="member-search-list" id={listId} ref={resultsList} role="listbox">
                    {people.map((person, index) => {
                      const note = inertNote(person);
                      const isActive = index === activeIndex;
                      return (
                        <li
                          aria-disabled={note !== null || undefined}
                          aria-selected={isActive}
                          className={`member-search-option${isActive ? " is-active" : ""}`}
                          id={optionId(index)}
                          key={person.id}
                          onClick={() => choose(index)}
                          // Focus stays in the field for the life of the
                          // combobox; a press on a row must not take it away
                          // and close the list under the click.
                          onMouseDown={(event) => event.preventDefault()}
                          onMouseEnter={() => setActiveIndex(index)}
                          role="option"
                        >
                          <span aria-hidden="true">
                            <Avatar
                              size="sm"
                              user={{ id: person.id, displayName: directoryName(person), avatarUrl: person.avatarUrl }}
                            />
                          </span>
                          <span className="member-who">
                            <span className="member-name" title={directoryName(person)}>
                              {directoryName(person)}
                            </span>
                            <span className="member-line" title={person.email}>
                              {person.email}
                            </span>
                          </span>
                          {/* Words, not a fade (§4.22): an opacity would take the
                              name under 4.5:1 in light. */}
                          {note ? <span className="member-search-note">{note}</span> : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>
            </div>

            {showPeople && search.hasNextPage ? (
              <button
                aria-disabled={search.isFetchingNextPage || undefined}
                className="secondary-button compact-button member-search-more"
                onClick={() => void showMore()}
                type="button"
              >
                Show more
              </button>
            ) : null}

            {/* One line in one place, tied to the field and to Add. Not a live
                region: it would speak on every keystroke. */}
            <p className="member-add-hint" id={hintId}>
              {hint}
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
                  choice as it dispatches, so a button that disabled itself would
                  drop the keyboard reader's focus to `<body>` on every add. */}
              <button
                aria-describedby={hintId}
                aria-disabled={!canAdd || undefined}
                className="primary-button compact-button"
                ref={addButton}
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
        <div className={notice ? `member-note${notice.tone === "error" ? " is-error" : ""}` : undefined} ref={noticeBox}>
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
          {archived ? (
            // Every role, ADMIN included, and in place of the role's line (§5.7).
            // `tabIndex=-1`: where the board puts focus if the archive took the
            // control that had it — focus never leaves an open dialog.
            <p className="member-readonly-note" data-archive-note="modal" tabIndex={-1}>
              This project is archived, so its members cannot be changed.
            </p>
          ) : readerRole === "MEMBER" || readerRole === "VIEWER" ? (
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
                const controls = rowControls(member, { members: members ?? [], rolesInFlight, currentUserId, isProjectAdmin });
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
                      if (Object.hasOwn(rolesInFlight, member.userId)) return;
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
                    roleInFlight={Object.hasOwn(rolesInFlight, member.userId)}
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
                .filter((row) => !members?.some((member) => member.userId === row.user.id))
                .map((row) => (
                  // The person as the search named them, under §4.4's dashed
                  // circle until the member read names them itself (§4.22).
                  <li className="member-row is-pending" key={`pending-${row.user.id}`}>
                    <Avatar label="Being added" size="sm" user={null} />
                    <span className="member-who">
                      <span className="member-name">{directoryName(row.user)}</span>
                      <span className="member-line">{row.user.email}</span>
                      <span className="member-line">Adding as {roleLabels[row.role]}</span>
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
  // The reader's own row stands for an account even when the read named nobody
  // on it: they are signed in (see `RowControls`).
  const withAccount = named || subject.self;
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
  // The sentence above already says who; the answer only has to say what.
  const confirmLabel =
    confirm?.kind === "demote" ? `Change to ${roleLabels[confirm.role]}` : subject.self ? "Remove me" : "Remove";

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
        ) : withAccount ? (
          // The reader's own row with no name on it: their id, and no sentence
          // saying no account came back — they are signed in to that account.
          <span className="member-id">{member.userId}</span>
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
      ) : isProjectAdmin ? (
        // Where the button would be, so this row's role sits in the same column
        // as the selects around it.
        <span aria-hidden="true" className="member-remove-slot" />
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
  const { requestId } = apiErrorFacts(error);
  // The server's words, or ours for an archived project's refusal (§5.7).
  const message = refusalWords(error);
  if (!message && !requestId) return null;
  return (
    <p className="member-note-detail">
      {message ? <span>{message}</span> : null}
      {requestId ? <RequestId value={requestId} /> : null}
    </p>
  );
}

/** Whether a row stands for an account: the member read named it, or it is the signed-in reader's own. */
function hasAccount(member: ProjectMember, currentUserId: string | undefined): boolean {
  return Boolean(member.user) || (currentUserId !== undefined && member.userId === currentUserId);
}

/** An ADMIN now, and — if its role write is still out — an ADMIN before that write too. */
function isSettledAdmin(member: ProjectMember, rolesInFlight: RolesInFlight): boolean {
  if (member.role !== "ADMIN") return false;
  return !Object.hasOwn(rolesInFlight, member.userId) || rolesInFlight[member.userId] === "ADMIN";
}

/**
 * See `RowControls` for why a row with an account and a row without are counted
 * differently, and why only settled admins are cover. A row is frozen when it is
 * an ADMIN and no *other* row covers it: a settled admin, with an account when
 * this row has one.
 */
function rowControls(member: ProjectMember, guard: AdminGuard): RowControls {
  const { members, rolesInFlight, currentUserId, isProjectAdmin } = guard;
  const withAccount = hasAccount(member, currentUserId);
  const cover = members.filter(
    (other) =>
      other.userId !== member.userId &&
      isSettledAdmin(other, rolesInFlight) &&
      (!withAccount || hasAccount(other, currentUserId)),
  ).length;
  const unnamedAdmins = members.filter(
    (other) => other.role === "ADMIN" && !hasAccount(other, currentUserId),
  ).length;
  const frozen = member.role === "ADMIN" && cover === 0 ? { unnamedAdmins: withAccount ? unnamedAdmins : 0 } : null;
  return {
    frozen,
    // A role select only for a person: a row with no account has nobody to give
    // a role to, and a role the server did not state has no current value to
    // show — both keep their removal.
    canChangeRole: isProjectAdmin && withAccount && frozen === null && member.role !== null,
    canRemove: isProjectAdmin && frozen === null,
  };
}

/**
 * Whether the row a question is about still offers the control that asked it,
 * judged against the guard's list — the rendered one during render, and the
 * cache's own copy at the moment of the press. A demotion has to still be a
 * demotion: a row that is no longer ADMIN has nothing left to step down from.
 */
function offersConfirm(confirm: PendingConfirm, guard: AdminGuard | undefined): boolean {
  const member = guard?.members.find((row) => row.userId === confirm.userId);
  if (!guard || !member) return false;
  const controls = rowControls(member, guard);
  return confirm.kind === "remove" ? controls.canRemove : controls.canChangeRole && member.role === "ADMIN";
}

/** Said when an open question closes because the list moved, or a press found it had. */
const LIST_CHANGED_TEXT = "The member list changed before you confirmed, so nothing was sent.";
/** And when what moved was the reader's own role, which took every control with it. */
const ROLE_CHANGED_TEXT = "Your role on this project changed before you confirmed, so nothing was sent.";
/** And when the project was archived under the open question. */
const ARCHIVED_BEFORE_CONFIRM_TEXT = "This project was archived before you confirmed, so nothing was sent.";

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

/**
 * The last-admin refusal: `FAILED_PRECONDITION` with no reason. An archived
 * project's refusal shares the code (backend PR #159) and is told apart by
 * `details.reason` alone — read as last-admin it would tell the reader they
 * are the project's only admin.
 */
function isLastAdmin(error: unknown): boolean {
  return apiErrorFacts(error).code === "FAILED_PRECONDITION" && !isProjectArchived(error);
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

function addFailureText(error: unknown, name: string): string {
  if (isAlreadyMember(error)) return `${name} is already a member of this project.`;
  if (isForbidden(error)) return REFUSED_NOT_ADMIN;
  if (isMissing(error)) return `This project could not be found, so ${name} was not added.`;
  return `${name} was not added to this project.`;
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
