import { useMutation, useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { ImageUp, LogOut, ShieldCheck } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { taskaApi } from "../api/client";
import {
  AVATAR_ACCEPTED_SUMMARY,
  AVATAR_ACCEPT_ATTRIBUTE,
  AVATAR_MAX_SIZE_BYTES,
  avatarRefusalKind,
  type AvatarRefusalKind,
} from "../api/avatars";
import { apiErrorFacts, isUndeployedRoute } from "../api/errors";
import { objectStoreUploadFailure } from "../api/objectStore";
import { UNDEPLOYED_ROUTE_MESSAGE } from "../api/TaskaApi";
import type { GlobalRole, ProjectMember, User, UserStatus } from "../domain/types";
import { useDismissOnOutside } from "../hooks/useDismissOnOutside";
import { formatFileSize } from "../lib/format";
import { ME_QUERY_KEY } from "../lib/ownAvatarLink";
import { Avatar } from "./Avatar";
import { RequestId } from "./RequestId";

interface UserProfileMenuProps {
  user?: User;
  loading?: boolean;
  loggingOut?: boolean;
  onLogout: () => void;
}

const statusLabels: Record<UserStatus, string> = {
  ACTIVE: "Active",
  BLOCKED: "Blocked",
  INVITED: "Invited",
  LOCKED: "Locked",
};

/**
 * The written status, or the raw value for anything this build has never heard
 * of — the same rule `userStatusLabel` follows in the admin Users section, for
 * a different reason. There the value is a database cell, so it was never
 * promised to be an enum member. Here it is typed `UserStatus` and can still
 * arrive outside it: `GET /users/me` answers the gateway's own
 * `GatewayUserStatus`. Since backend TAS-197 (`04546f1`, deployed) that enum
 * has `LOCKED`, so a locked account whose pre-lock token still works — it does
 * while TAS-198 (backend PR #174) is open — reads `LOCKED` and gets the label
 * below. The fallback stays for what is still possible: `UNSPECIFIED` is a
 * member of that enum too, and the contract types `status` as a bare string
 * (TAS-173). A value the gateway's mapper does not know at all is no longer one
 * of them — it fails every authenticated request with a 500 instead (read at
 * `60d62ee`).
 *
 * A bare lookup printed an empty badge for an unknown value: `undefined` in a
 * place typed `string`, which renders as nothing and says nothing.
 */
function statusLabel(status: string): string {
  const labels: Record<string, string | undefined> = statusLabels;
  return labels[status] ?? status;
}

// The account-wide role, not the project one. It is shown, never acted on.
const globalRoleLabels: Record<GlobalRole, string> = {
  USER: "User",
  GLOBAL_ADMIN: "Global admin",
};

interface PhotoNotice {
  tone: "info" | "error";
  text: string;
  /**
   * The failure behind an error sentence, kept for its request id (§5.6). The
   * sentence already quotes whatever the server said, so the id is the one
   * thing the error still has to add.
   */
  error?: unknown;
}

/**
 * The cached shapes that draw somebody's face on a member row, as their
 * screens hold them: the members dialog's `["members", projectId]` is the list
 * itself; the board's `["project-context", projectId]` (TAS-251) and the
 * project cards' `["project-summaries", projectId]` hold it under `members` —
 * the summary's `null` when that half of the card did not load. Only `members`
 * is read here; the rest of either holder is spread through untouched.
 */
type MemberFaceHolder = ProjectMember[] | { members: ProjectMember[] | null };

const MEMBER_FACE_FAMILIES: readonly QueryKey[] = [["members"], ["project-context"], ["project-summaries"]];

/** One cached list the reader's row was rewritten in, and the face it carried before. */
interface OwnFaceWrite {
  queryKey: QueryKey;
  avatarUrl: string | null | undefined;
}

export function UserProfileMenu({ user, loading = false, loggingOut = false, onLogout }: UserProfileMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadButtonRef = useRef<HTMLButtonElement>(null);
  const popoverId = useId();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<PhotoNotice | null>(null);
  // The entry exists only for an account the server called GLOBAL_ADMIN. A
  // gateway that states no role counts as not an admin, which is lossy in the
  // safe direction (docs/ai/API-DIVERGENCE.md).
  const isGlobalAdmin = user?.globalRole === "GLOBAL_ADMIN";

  // Escape and a press outside, from the hook the notifications popover and the
  // global search dropdown share (§4.16, §7). This used to be the only copy in
  // the product, which is exactly why the other two shipped without it.
  useDismissOnOutside(open, rootRef, () => setOpen(false));

  /**
   * The reader's own face comes with the profile: `GET /users/me` carries the
   * avatar since backend PR #193 (TAS-223), so this menu spends no request of
   * its own on it — it used to read `GET /users/{userId}/avatar` on mount.
   * `null` there means no photo *or* a profile read the gateway could not make,
   * and since that PR's head `3bd33cac` the answer says which:
   * `avatarUnavailable: true` for the failed read. Both draw initials and
   * offer Upload; the failed read adds one quiet line saying the photo could
   * not be loaded. No request id — the server sends none with it — and no
   * retry control: the gateway answers the next read on its own, and for a
   * row whose object is gone (TAS-221) only an upload or a removal changes the
   * answer at all. A gateway older than that PR sends no flag, and no flag is
   * no line. The `["me"]` query keeps a link it already holds while the
   * avatar's id is unchanged (`keepSignedAvatarLink`), so a re-read on focus
   * does not download the picture again.
   *
   * Only a link may say there is a photo to remove (§5.6), so "Remove photo"
   * is not offered in the failed-read state either: the server has not said
   * there is anything there to remove (§4.16).
   */
  const person = user;
  const hasPhoto = typeof user?.avatarUrl === "string" && user.avatarUrl.length > 0;
  const avatarUnavailable = user?.avatarUnavailable === true;

  /**
   * Optimistic with rollback, unlike the upload below it, and the asymmetry is
   * the same one the attachments panel draws: a delete is a single call whose
   * outcome the client can predict, so the circle goes back to initials at
   * once — in this menu and on every member row the cache holds for this
   * person. An upload is three legs, one of them to a server that is not Taska,
   * and its outcome is genuinely unknown until it lands.
   *
   * Nothing is read again afterwards, on either outcome. Success leaves exactly
   * what was written, and a refusal puts back exactly what was there.
   */
  const remove = useMutation({
    mutationFn: () => taskaApi.deleteMyAvatar(),
    onMutate: async () => {
      setNotice(null);
      await queryClient.cancelQueries({ queryKey: ME_QUERY_KEY });
      const previous = queryClient.getQueryData<User>(ME_QUERY_KEY);
      // `avatarUnavailable: false` is the answer the next read gives once the
      // row is gone: the profile reads, and says "none".
      queryClient.setQueryData<User>(ME_QUERY_KEY, (me) =>
        me ? { ...me, avatarUrl: null, avatarId: null, avatarUnavailable: false } : me,
      );
      const faces = user ? await writeOwnFace(queryClient, user.id, null) : [];
      return { previous, faces };
    },
    onError: (error, _variables, context) => {
      // Back to the profile as it was — but only onto the same account, so a
      // refusal that lands after a sign-out cannot write the old face back.
      if (context?.previous) {
        const previous = context.previous;
        queryClient.setQueryData<User>(ME_QUERY_KEY, (me) => (me?.id === previous.id ? previous : me));
      }
      if (user && context) restoreOwnFaces(queryClient, user.id, context.faces);
      setNotice({ tone: "error", text: writeFailureText(error, "removed"), error });
    },
    // Nothing is announced on success. The contract calls this idempotent —
    // 204 whether or not there was an avatar — so "your photo was removed" is a
    // sentence this client cannot actually stand behind, and the circle going
    // back to initials is the report.
  });

  const writing = uploading || remove.isPending;

  /**
   * A write in this band can blur the button that just started it, for two
   * different reasons that land on one symptom. Removing unmounts the
   * "Remove photo" button — `hasPhoto` drops to `false` inside `onMutate`,
   * above — and this popover is a `role="dialog"` with no focus trap, so
   * without a fix the next Tab would restart at the top of the document,
   * behind the still-open dialog, rather than continuing inside the menu. A
   * plain upload never unmounts anything, but the button that started it is
   * the one holding focus when `uploading` becomes `true`: `disabled` arrives
   * on that same render, and Chromium blurs a focused element the instant
   * `disabled` appears on it — the behaviour DESIGN.md §4.21 is written
   * against. Both paths end at `<body>`, and one mechanism closes both,
   * because the upload button is the one control in this band that is
   * mounted on every path that can write.
   *
   * So this is keyed on the *write* settling — `writing` going from `true` to
   * `false` — rather than on `hasPhoto`, which moves only on the remove path
   * and never on the upload one: a first upload takes it `false → true`, a
   * replace leaves it at `true` throughout, and neither is the `true → false`
   * a `hasPhoto`-keyed effect looks for. `.focus()` on a still-disabled button
   * is a no-op, so this still waits for both writes to clear before moving
   * focus, which is the same render the button re-enables on.
   * `wasWriteInFlight` is updated on every run regardless of `open`, so a
   * write that settles while the menu is closed does not steal focus back on
   * reopening it — by the time `open` flips back to `true` the ref has already
   * caught up to the settled state, and there is no `true → false` transition
   * left to see.
   */
  const wasWriteInFlight = useRef(writing);
  useEffect(() => {
    if (open && wasWriteInFlight.current && !writing) {
      uploadButtonRef.current?.focus();
    }
    wasWriteInFlight.current = writing;
  }, [writing, open]);

  /**
   * The whole upload, written out rather than wrapped in a mutation, because
   * each leg fails differently and the sentence has to name the leg: the
   * gateway would not sign it, the *store* would not take the bytes, or the
   * gateway would not record it.
   *
   * Deliberately **not** optimistic, which is the one place this feature steps
   * away from the repository's default. There is no local state to roll back to
   * or from — the picture is a file the browser has, not a field — and the
   * middle leg goes to a server this app does not control, so a face shown
   * before the confirm would be a claim about a bucket nobody has written to
   * yet. The attachments panel makes the same call for the same choreography.
   * What the reader gets instead is one word of progress on the line under the
   * controls, while the button they pressed keeps its own label — three labels
   * in turn changed its width, and moved "Remove photo" beside it each time.
   */
  const runUpload = async (file: File) => {
    setNotice(null);
    const candidate = { fileName: file.name, contentType: file.type, sizeBytes: file.size };

    // The picker's `accept` filters by the operating system's idea of a type
    // and `File.type` is the browser's, so this is not a duplicate of it — and
    // both refusals here are decidable without a request, which is why neither
    // ever becomes one.
    const refusal = avatarRefusalKind(candidate);
    if (refusal) {
      setNotice({ tone: "error", text: refusalText(refusal, file) });
      return;
    }

    setUploading(true);
    let ticket;
    try {
      // Leg 1, and the moment the fifteen-minute clock starts — which is why it
      // is asked for when the file is chosen rather than when the menu opens.
      ticket = await taskaApi.createAvatarUploadUrl(candidate);
    } catch (error) {
      setUploading(false);
      setNotice({ tone: "error", text: writeFailureText(error, "saved"), error });
      return;
    }

    try {
      // Leg 2. `candidate.contentType` and not `file.type` re-read — the same
      // value today, but this is the one place where sending something even
      // slightly different from what was signed is a 403 nobody can diagnose.
      await taskaApi.putAvatarBytes(ticket.uploadUrl, file, candidate.contentType);
    } catch (error) {
      setUploading(false);
      setNotice({ tone: "error", text: uploadFailureText(error), error });
      return;
    }

    let saved;
    try {
      // Leg 3, sent once per ticket and never again with the same key — not
      // even after it fails. The server does not check that a key was minted
      // for this reader, and a second confirm of the key the saved row already
      // holds deletes that very object before presigning a link to it (see
      // `confirmAvatarUpload` on TaskaApi). Nothing retries here: the person
      // choosing the file again is the retry, and that mints a new ticket and a
      // new key.
      saved = await taskaApi.confirmAvatarUpload({
        objectKey: ticket.objectKey,
        fileName: file.name,
        contentType: candidate.contentType,
      });
    } catch (error) {
      setUploading(false);
      setNotice({ tone: "error", text: writeFailureText(error, "saved"), error });
      return;
    }

    if (saved.downloadUrl) {
      // The confirm answers with the link and the avatar's id, so the new face
      // goes on screen without a follow-up read — on the profile, and on every
      // member row the cache already holds for this person. The upload
      // replaced the row, so a failed read the profile reported before is
      // over: the presign that just succeeded is the one that was failing.
      const link = saved.downloadUrl;
      await queryClient.cancelQueries({ queryKey: ME_QUERY_KEY });
      queryClient.setQueryData<User>(ME_QUERY_KEY, (me) =>
        me ? { ...me, avatarUrl: link, avatarId: saved.id, avatarUnavailable: false } : me,
      );
      if (user) await writeOwnFace(queryClient, user.id, link);
    } else {
      // An answer that carried no link is the one case that costs a read: the
      // profile again, which states the avatar since TAS-223. Whatever it says
      // is then written to the member rows the same way a link from the confirm
      // would have been. A re-read that fails leaves them as they were, and so
      // does one that answers `avatarUnavailable: true`: its `null` is
      // "unknown", and writing it onto the rows would state "no photo".
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      const reread = queryClient.getQueryState<User>(ME_QUERY_KEY);
      if (
        user &&
        reread?.status === "success" &&
        reread.data?.avatarUrl !== undefined &&
        reread.data.avatarUnavailable !== true
      ) {
        await writeOwnFace(queryClient, user.id, reread.data.avatarUrl);
      }
    }
    setUploading(false);
  };

  return (
    <div className="user-profile-menu" ref={rootRef}>
      <button
        aria-controls={open ? popoverId : undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={user ? `Open profile for ${user.displayName}` : "Open profile"}
        className="user-profile-trigger"
        // Enabled as soon as the query settles, whether or not it produced a
        // user. Requiring `user` meant that a profile which failed to load —
        // a 5xx, a network drop, a CORS refusal, none of which clear the
        // tokens — took Log out down with it, and with /login bouncing anyone
        // holding tokens the only way out was to clear site data.
        disabled={loading}
        onClick={() => setOpen((value) => !value)}
        ref={triggerRef}
        type="button"
      >
        <Avatar user={person} label="Current user" loading={loading} size="md" />
      </button>

      {open ? (
        <section aria-label="Current user profile" className="user-profile-popover" id={popoverId} role="dialog">
          {person ? (
            <>
              <header className="user-profile-head">
                <Avatar user={person} size="lg" />
                <div>
                  <strong>{person.displayName}</strong>
                  <span>@{person.login}</span>
                </div>
              </header>
              <dl className="user-profile-details">
                <div>
                  <dt>Email</dt>
                  <dd>{person.email}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>
                    {/* An unmodelled value keeps the quiet base pill: the
                        modifier simply does not match a rule, which is the
                        right answer for a status this build cannot interpret. */}
                    <span className={`user-status is-${person.status.toLowerCase()}`}>
                      {statusLabel(person.status)}
                    </span>
                  </dd>
                </div>
                {/* A gateway that does not state the role gets no row at all:
                    "Unknown" would read as a fact about the account rather than
                    about the response. */}
                {person.globalRole ? (
                  <div>
                    <dt>Role</dt>
                    <dd>{globalRoleLabels[person.globalRole]}</dd>
                  </div>
                ) : null}
              </dl>
              {/* Your own face, so no role decides any of this: a VIEWER of
                  every project in the product still owns it. The server is
                  still the authority — all four routes are authenticated — but
                  there is no permission here to mirror in the UI. */}
              <div className="user-profile-photo">
                {/* Driven by the button beside it rather than styled
                    directly: `::file-selector-button` keeps the browser's
                    own "No file chosen" text, and a visually hidden but
                    focusable input puts a tab stop where nothing is
                    visible. `hidden` takes it out of the tab order
                    entirely. */}
                <input
                  accept={AVATAR_ACCEPT_ATTRIBUTE}
                  className="avatar-input"
                  hidden
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    // Cleared straight away so choosing the same file twice
                    // — after a refusal, which is exactly when someone
                    // would — still fires a change event.
                    event.target.value = "";
                    if (file) void runUpload(file);
                  }}
                  ref={fileInput}
                  type="file"
                />
                <div className="user-profile-photo-actions">
                  <button
                    className="secondary-button compact-button"
                    disabled={writing}
                    onClick={() => fileInput.current?.click()}
                    ref={uploadButtonRef}
                    type="button"
                  >
                    <ImageUp aria-hidden="true" size={13} />
                    {hasPhoto ? "Replace photo" : "Upload a photo"}
                  </button>
                  {/* No confirmation dialog, deliberately: this is undone by
                      uploading again, which is not what the admin section's
                      confirmations are for. */}
                  {hasPhoto ? (
                    <button
                      className="user-profile-photo-remove"
                      disabled={writing}
                      onClick={() => remove.mutate()}
                      type="button"
                    >
                      Remove photo
                    </button>
                  ) : null}
                </div>
                {/* Said before a file is chosen rather than after it is
                    refused, and it states the server's ceiling — 2 MB, which
                    the schema and auth-service agree on since TAS-222
                    (src/api/avatars.ts). While an upload is in flight the
                    same line carries its progress instead: one line, so
                    nothing below it moves either. */}
                <p className="user-profile-photo-hint">
                  {uploading
                    ? "Uploading…"
                    : `Up to ${formatFileSize(AVATAR_MAX_SIZE_BYTES)}. ${AVATAR_ACCEPTED_SUMMARY}.`}
                </p>
                {/* The profile read behind `GET /users/me` failed, and the
                    server said so (`avatarUnavailable`, backend PR #193).
                    It describes the menu as it opened, not an answer to
                    something the reader did, so it is not a live region —
                    and it yields to anything newer: a write's notice, or
                    an upload in flight, which is the way out of it. Quiet
                    tone, no request id (the answer carries none), no retry. */}
                {avatarUnavailable && !notice && !uploading ? (
                  <p className="user-profile-photo-note">Your photo could not be loaded.</p>
                ) : null}
                {/* One live region that stays mounted and changes its text,
                    rather than one that appears together with what it has
                    to announce — §7 records the second shape as depending
                    on screen-reader timing. Polite, not assertive: every
                    sentence here follows something the reader just did.
                    The region is the sentence alone, and the request id
                    line beside it is outside it, which is the watchers
                    box's split (§4.21) for its reason: a polite region
                    holding the id would read a uuid aloud. Empty, the box
                    carries no class and draws nothing. */}
                <div
                  className={notice ? `user-profile-photo-note${notice.tone === "error" ? " is-error" : ""}` : ""}
                >
                  <p aria-live="polite" className="user-profile-photo-note-sentence">
                    {notice?.text ?? ""}
                  </p>
                  <PhotoNoteDetail error={notice?.error} />
                </div>
              </div>
            </>
          ) : (
            // Nothing invented about who this is — only that we could not find
            // out, and that leaving is still possible.
            <p className="user-profile-unknown">Your profile could not be loaded.</p>
          )}
          <div className="user-profile-actions">
            {isGlobalAdmin ? (
              // A real link, not a button: it navigates, so it has to be
              // middle-clickable and copyable, same reasoning as the not-found
              // screen's way out. Absent — not disabled, not hidden — for
              // everyone else; hiding it is not the permission control, the
              // server is (`/api/v1/readonly/*` is GLOBAL_ADMIN-only and
              // enumerates 401/403).
              <Link
                // Opened from /admin itself, the entry leads nowhere new, and
                // saying so is one attribute. Any section counts: /admin is an
                // area that redirects into /admin/data (§5.8), so an exact
                // match would be true for a single tick and never again.
                aria-current={
                  location.pathname === "/admin" || location.pathname.startsWith("/admin/") ? "page" : undefined
                }
                className="user-profile-admin"
                onClick={(event) => {
                  // A modified click opens /admin in a new tab and leaves this
                  // page as it is, so the menu it was opened from stays open.
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  setOpen(false);
                  // Closing the popover unmounts the item that had focus, so it
                  // goes back to the trigger (§7). What this actually covers is
                  // the case where no route change follows — opening the menu
                  // while already on /admin and choosing Administration. On a
                  // real navigation the route swap unmounts this trigger a tick
                  // later and focus ends up on <body> anyway; that is true of
                  // every in-app link, not of this entry, and is recorded in
                  // docs/ai/BACKLOG.md rather than patched here.
                  triggerRef.current?.focus();
                }}
                to="/admin"
              >
                <ShieldCheck aria-hidden="true" size={15} />
                Administration
              </Link>
            ) : null}
            <button className="user-profile-logout" disabled={loggingOut} onClick={onLogout} type="button">
              <LogOut aria-hidden="true" size={15} />
              {loggingOut ? "Logging out…" : "Log out"}
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

/** The members `holder` carries, or `null` for a list that is not there. */
function membersIn(holder: MemberFaceHolder | undefined): ProjectMember[] | null {
  if (!holder) return null;
  return Array.isArray(holder) ? holder : holder.members;
}

/**
 * `holder` with the row for `userId` showing `avatarUrl` — or `undefined` when
 * nothing in it would change, which `setQueryData` reads as "leave this query
 * alone". A list the reader is not on, a summary whose member half failed, and
 * a row that already shows this face are therefore not touched at all, rather
 * than rewritten with themselves and marked fresh.
 */
function withOwnFace(
  holder: MemberFaceHolder | undefined,
  userId: string,
  avatarUrl: string | null | undefined,
): MemberFaceHolder | undefined {
  const members = membersIn(holder);
  if (!holder || !members) return undefined;
  let changed = false;
  const next = members.map((member) => {
    if (member.userId !== userId || !member.user || member.user.avatarUrl === avatarUrl) return member;
    changed = true;
    return { ...member, user: { ...member.user, avatarUrl } };
  });
  if (!changed) return undefined;
  return Array.isArray(holder) ? next : { ...holder, members: next };
}

/**
 * Writes `avatarUrl` onto the reader's own row in every cached member list, and
 * answers with what each of those rows carried before, so a refusal can put it
 * back.
 *
 * **A cache write and not an invalidation**, and the cost is the reason.
 * Invalidating `["project-summaries"]` on `/projects` re-runs `listIssues` *and*
 * `listMembers` for every project on the page — 2N requests — to
 * change one face on a write the reader made themselves. Everything the rows
 * need is already in hand: the confirm's `downloadUrl` for an upload, `null`
 * for a removal.
 *
 * Reads already in flight for these lists are cancelled first, so one that left
 * before the write cannot land after it and draw the old face — but only for a
 * list that already holds data. Cancelling a *first* read reverts it to nothing
 * and leaves it idle, which would strand a board still loading its members; a
 * list with no data has no row to rewrite anyway, and its own answer is the one
 * it should draw.
 */
async function writeOwnFace(
  queryClient: QueryClient,
  userId: string,
  avatarUrl: string | null,
): Promise<OwnFaceWrite[]> {
  const before: OwnFaceWrite[] = [];
  for (const family of MEMBER_FACE_FAMILIES) {
    await queryClient.cancelQueries({ queryKey: family, predicate: (query) => query.state.data !== undefined });
    for (const [queryKey, holder] of queryClient.getQueriesData<MemberFaceHolder>({ queryKey: family })) {
      const row = membersIn(holder)?.find((member) => member.userId === userId && member.user);
      if (row?.user && row.user.avatarUrl !== avatarUrl) before.push({ queryKey, avatarUrl: row.user.avatarUrl });
    }
    queryClient.setQueriesData<MemberFaceHolder>({ queryKey: family }, (holder) =>
      withOwnFace(holder, userId, avatarUrl),
    );
  }
  return before;
}

/**
 * Puts back what `writeOwnFace` replaced: the reader's face in each list it
 * changed, and nothing else — so a list that has been refreshed since keeps
 * everything its newer answer brought.
 */
function restoreOwnFaces(queryClient: QueryClient, userId: string, before: OwnFaceWrite[]) {
  for (const { queryKey, avatarUrl } of before) {
    queryClient.setQueryData<MemberFaceHolder>(queryKey, (holder) => withOwnFace(holder, userId, avatarUrl));
  }
}

/**
 * The request id under a photo sentence (§5.6), on a line of its own and
 * outside the live region, as `WatcherNoteDetail` sets it on the board.
 *
 * The id alone, never the gateway's words — the one place this parts from that
 * detail line. Every sentence in this band already quotes the server's message,
 * so a second copy here would be an echo. And nothing at all for a failure that
 * carries no id: a store that refused the PUT, the mock, a refusal decided
 * before any request was sent. An empty "Request ID:" promises something to
 * copy and has nothing.
 */
function PhotoNoteDetail({ error }: { error: unknown }) {
  const { requestId } = apiErrorFacts(error);
  if (!requestId) return null;
  return (
    <p className="user-profile-photo-note-detail">
      <RequestId value={requestId} />
    </p>
  );
}

/**
 * Why this file cannot be a photo, in the reader's terms rather than the
 * server's. The API layer throws `S3StorageClient.validateFileParams`'s own
 * sentence so a mock refusal and a gateway refusal read alike; neither of these
 * two arms ever travels over the wire, and a person holding an image is owed
 * its name and a size they can compare with the limit stated just above.
 */
function refusalText(kind: AvatarRefusalKind, file: File) {
  if (kind === "type") {
    return `${file.name} is not a type this product accepts. Choose a ${AVATAR_ACCEPTED_SUMMARY} image.`;
  }
  if (kind === "empty") {
    return `${file.name} is empty, so there is nothing to upload.`;
  }
  const size = formatFileSize(file.size);
  const ceiling = formatFileSize(AVATAR_MAX_SIZE_BYTES);
  return size === ceiling
    ? `${file.name} is just over ${ceiling}, which is the largest photo this product accepts.`
    : `${file.name} is ${size}. The largest photo this product accepts is ${ceiling}.`;
}

/**
 * What to say when the **gateway** refused — leg 1, leg 3, or the delete.
 *
 * The undeployed arm is for a gateway without the avatar write routes, which
 * answers Spring's static-resource 404: without it the menu would print "No
 * static resource /api/v1/users/me/avatar/upload-url" at somebody who did
 * nothing wrong. `EditProjectModal` reads the same predicate for the same
 * reason (TAS-148).
 */
function writeFailureText(error: unknown, verb: "saved" | "removed") {
  if (isUndeployedRoute(error, UNDEPLOYED_ROUTE_MESSAGE)) {
    return `Profile photos are not on this gateway yet, so nothing was ${verb}.`;
  }
  const message = apiErrorFacts(error).message;
  return verb === "saved"
    ? `Your photo was not saved. ${message ?? "The gateway refused it."}`
    : `Your photo was not removed. ${message ?? "The gateway refused it."}`;
}

/**
 * What to say when the **middle** leg failed — the PUT that goes straight to
 * the object store and never reaches Taska. Four genuinely different problems,
 * the same four the attachments panel names, and reading them as one "upload
 * failed" is what this exists to prevent.
 */
function uploadFailureText(error: unknown) {
  const failure = objectStoreUploadFailure(error);
  if (!failure) {
    return `Your photo was not uploaded. ${apiErrorFacts(error).message ?? "The upload failed."}`;
  }
  if (failure.kind === "unusable") {
    return "Your photo was not uploaded: the upload link that came back was unusable, so nothing was sent. Choose the photo again to retry.";
  }
  if (failure.kind === "blocked") {
    return "Your photo was not uploaded: the browser could not reach the file store. This upload goes straight to storage rather than through Taska, so a network problem or the storage server's cross-origin rules can stop it before it starts.";
  }
  if (failure.kind === "expired") {
    return "Your photo was not uploaded: the file store would not accept the upload link. A link lasts 15 minutes from the moment the photo is chosen — choose it again to retry.";
  }
  return `Your photo was not uploaded: the file store answered ${failure.storeStatus}.`;
}
