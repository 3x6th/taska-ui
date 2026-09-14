import { useMutation, useQuery, useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
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
import { apiErrorFacts, isMissingOrForbidden, isUndeployedRoute } from "../api/errors";
import { objectStoreUploadFailure } from "../api/objectStore";
import { UNDEPLOYED_ROUTE_MESSAGE } from "../api/TaskaApi";
import type { GlobalRole, ProjectMember, User, UserStatus } from "../domain/types";
import { useDismissOnOutside } from "../hooks/useDismissOnOutside";
import { formatFileSize } from "../lib/format";
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
 * `GatewayUserStatus`, which has **no** `LOCKED`. Backend PR #146 made the state
 * reachable without adding it there, so a locked account whose pre-lock token
 * still works — `validateUserStatus` in `AuthServiceImpl` rejects `BLOCKED` and
 * `INVITED`, and says nothing about `LOCKED` — reads back as `UNSPECIFIED`
 * today (docs/ai/API-DIVERGENCE.md).
 *
 * A bare lookup printed an empty badge for that: `undefined` in a place typed
 * `string`, which renders as nothing and says nothing. Adding `LOCKED` to the
 * union does not fix it, because `LOCKED` is not the value that arrives.
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

/**
 * How long the reader's own avatar link is trusted before a mount asks for a
 * fresh one: ten minutes, under the fifteen a presigned link lives on
 * auth-service's default `storage.presigned-url-ttl`.
 *
 * Far longer than the app's twenty-second default, because this read is not a
 * cheap confirmation of what is already on screen. Every answer is a freshly
 * *signed* link — the same picture under a new query string — so the browser's
 * cache never recognises it, and every refetch downloads the image again.
 * Shorter than the link's lifetime so that a mount never draws a link with less
 * than five minutes left. A link that expires under a menu that stays mounted
 * is not re-signed on a timer: `Avatar` puts the initials back, which §4.4
 * calls the ordinary state of a screen left open. The TTL is an env-overridable
 * default on the server and nothing on this side can read the deployed value,
 * so this is a margin against the default, not a guarantee.
 */
const OWN_AVATAR_STALE_MS = 10 * 60 * 1000;

/**
 * Every query client whose page has seen the reader's own avatar read answered
 * with the undeployed-route signature. Once a client is in here, that read is
 * never made again on it — so a stand without the routes pays for one 404 per
 * page load rather than one per navigation, which is what the owner asked of
 * this gateway. A reload is the only thing that asks again.
 *
 * **Why the fact lives here and not in the query's own state.** Anything the
 * cache holds is forgotten twice over in this app: `App.tsx` calls
 * `queryClient.clear()` on every sign-out and every expired session, and a
 * query nobody is observing is garbage-collected after five minutes. Both are
 * right for answers about a *session*, and this is not one — it is a fact about
 * the gateway, the same for whoever signs in next on this page. Keyed by the
 * client because `main.tsx` makes exactly one per page load, so the entry lives
 * exactly as long as the page; and a test that renders with a fresh client
 * inherits nothing from the case before it, where a module-level flag would.
 *
 * **Why `enabled`, and as a function.** react-query 5.101 accepts a function
 * for `enabled`, `staleTime` and `retryOnMount`, and only `enabled` covers every
 * path that would run the read again. A failed query with no data counts as
 * stale before `staleTime` is even looked at, so neither a long stale time nor
 * `'static'` stops the next mount; `retryOnMount: false` stops the mount and
 * nothing else. A query whose observers are all disabled is skipped by
 * `invalidateQueries` and `resetQueries` as well, and by a refetch on reconnect.
 * As a function it is read at the moment react-query decides, not at the last
 * render — so a second copy of this menu that mounts in the same tick as the
 * 404 lands already sees it. A sentinel "undeployed" answer with a stale time
 * that never expires was the other candidate: it stops every refetch too, but
 * it is cache state, and dies with the cache on the next sign-out.
 *
 * Only this signature goes in. Any other failed read stays out and recovers on
 * the next mount, the way react-query's `retryOnMount` default has it.
 */
const clientsWithoutAvatarRoutes = new WeakSet<QueryClient>();

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
 * The two cached shapes that draw somebody's face on a member row, as their
 * screens hold them: the board's `["members", projectId]` is the list itself,
 * and the project cards' `["project-summaries", projectId]` is
 * `ProjectsScreen`'s summary, whose `members` is `null` when that half of the
 * card did not load. Only `members` is read here; the rest of a summary is
 * spread through untouched.
 */
type MemberFaceHolder = ProjectMember[] | { members: ProjectMember[] | null };

const MEMBER_FACE_FAMILIES: readonly QueryKey[] = [["members"], ["project-summaries"]];

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

  const avatarKey = ["avatar", user?.id ?? ""];
  /**
   * **The one avatar in this product that costs a request**, and it is spent
   * here because there is nowhere cheaper: `GET /users/me` carries no avatar
   * (backend PR #150 put it on routes of its own), so the reader's own face
   * cannot ride on a list the way every other person's does — a member row
   * carries theirs inline.
   *
   * A successful answer is trusted for `OWN_AVATAR_STALE_MS` and never re-read
   * on a window focus, because a re-read re-signs the link and re-downloads the
   * picture. `refetchOnMount` keeps its default, so a mount past ten minutes —
   * the next screen after a long stay — does read, and draws a link with its
   * lifetime ahead of it. A *failed* read holds no answer to trust, and
   * react-query asks again on the next mount whatever the stale time says
   * (`retryOnMount`, left at its default) — which is how an ordinary failure
   * recovers. The undeployed route is the one failure that does not get asked
   * again: see `clientsWithoutAvatarRoutes`. The key holds no screen in it, so
   * the board's copy of this menu and the top bar's are the same query and
   * never pay for any of that twice on one screen.
   *
   * Not retried for the two answers that are already final. "Missing or not
   * yours" is an answer, and so is the static-resource 404 the four avatar
   * routes give today — retrying either spends a second request to be told the
   * same thing, on every screen, for every reader, until the backend deploys.
   */
  const avatarQuery = useQuery({
    queryKey: avatarKey,
    enabled: () => Boolean(user?.id) && !clientsWithoutAvatarRoutes.has(queryClient),
    queryFn: async () => {
      try {
        return await taskaApi.getUserAvatarUrl(user!.id);
      } catch (error) {
        // Recorded before the query settles into its error, so every decision
        // react-query makes from here on already reads it.
        if (isUndeployedRoute(error, UNDEPLOYED_ROUTE_MESSAGE)) clientsWithoutAvatarRoutes.add(queryClient);
        throw error;
      }
    },
    staleTime: OWN_AVATAR_STALE_MS,
    refetchOnWindowFocus: false,
    retry: (failureCount: number, error: Error) =>
      !isMissingOrForbidden(error) &&
      !isUndeployedRoute(error, UNDEPLOYED_ROUTE_MESSAGE) &&
      failureCount < 1,
  });

  /**
   * `avatarQuery.data` is passed through **without** a `?? null`, so the three
   * states stay three: a string is a picture, `null` is the server saying there
   * is none, and `undefined` is nobody having got an answer yet. `Avatar` draws
   * the last two the same way today — see `User.avatarUrl` for why they are
   * still not collapsed here.
   */
  const person = user ? { ...user, avatarUrl: avatarQuery.data } : undefined;
  /**
   * Three different answers from one read, and the band draws each its own way.
   *
   * The undeployed route is not a failure of anything: the feature is not on
   * this gateway, and this read has already said so — so the band says that and
   * offers nothing, rather than an "Upload a photo" whose every use ends in a
   * refusal after the file picker. Any other failed read *is* a failure, and
   * says so with its request id. And only a read that succeeded may say there
   * is a photo to remove (§5.6): a failed one offers no Remove rather than an
   * ineffective one — including a background re-read that failed while an older
   * answer is still in the cache.
   *
   * The undeployed answer is read from `clientsWithoutAvatarRoutes` rather than
   * from `avatarQuery.error`, because it has to outlive that error: after a
   * sign-out clears the cache, the next menu on this page has no error to look
   * at and makes no read to get one, and must still draw the same band.
   */
  const readUndeployed = clientsWithoutAvatarRoutes.has(queryClient);
  const readFailed = avatarQuery.isError && !readUndeployed;
  const hasPhoto = !avatarQuery.isError && typeof avatarQuery.data === "string" && avatarQuery.data.length > 0;

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
      await queryClient.cancelQueries({ queryKey: avatarKey });
      const previous = queryClient.getQueryData<string | null>(avatarKey);
      queryClient.setQueryData<string | null>(avatarKey, null);
      const faces = user ? await writeOwnFace(queryClient, user.id, null) : [];
      return { previous, faces };
    },
    onError: (error, _variables, context) => {
      queryClient.setQueryData(avatarKey, context?.previous);
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
      // The confirm answers with the link, so the new face goes on screen
      // without a follow-up read — in this menu and on every member row the
      // cache already holds for this person.
      await queryClient.cancelQueries({ queryKey: avatarKey });
      queryClient.setQueryData<string | null>(avatarKey, saved.downloadUrl);
      if (user) await writeOwnFace(queryClient, user.id, saved.downloadUrl);
    } else {
      // An answer that carried no link is the one case that costs a read, and
      // it is a read of this avatar alone: whatever it says is then written to
      // the member rows the same way a link from the confirm would have been. A
      // re-read that fails leaves them as they were, and the band says the photo
      // could not be loaded.
      await queryClient.invalidateQueries({ queryKey: avatarKey });
      const reread = queryClient.getQueryState<string | null>(avatarKey);
      if (user && reread?.status === "success" && reread.data !== undefined) {
        await writeOwnFace(queryClient, user.id, reread.data);
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
                {readUndeployed ? (
                  // The band and its divider stay, so the menu keeps its shape
                  // on every gateway; what goes is every control whose only
                  // possible answer is the refusal this read already received.
                  // The hint's own quiet line and not the error tint: nothing
                  // failed that the reader did or can fix.
                  <p className="user-profile-photo-hint">Profile photos are not on this gateway yet.</p>
                ) : (
                  <>
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
                        refused, and it states the ceiling the server actually
                        enforces — 2 MB, not the 5 MB its own schema declares
                        (src/api/avatars.ts). While an upload is in flight the
                        same line carries its progress instead: one line, so
                        nothing below it moves either. */}
                    <p className="user-profile-photo-hint">
                      {uploading
                        ? "Uploading…"
                        : `Up to ${formatFileSize(AVATAR_MAX_SIZE_BYTES)}. ${AVATAR_ACCEPTED_SUMMARY}.`}
                    </p>
                    {/* A state of the menu rather than an answer to something
                        the reader just did, so not a live region: it is usually
                        already true when the popover opens, and a region that
                        mounts together with its text is the shape §7 records as
                        depending on screen-reader timing. */}
                    {readFailed ? (
                      <div className="user-profile-photo-note is-error">
                        <p className="user-profile-photo-note-sentence">{readFailureText(avatarQuery.error)}</p>
                        <PhotoNoteDetail error={avatarQuery.error} />
                      </div>
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
                  </>
                )}
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
 * `listMembers` for every project on the page — 2N requests, 3N in hybrid — to
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
 * What to say when the reader's own avatar could not be read, for any reason
 * but the undeployed route — which is not a failure and draws no sentence of
 * this kind (the band says the feature is not on the gateway instead).
 *
 * Once the routes deploy, the likeliest cause is a 404 from the download
 * presign, which HEADs the object first: a row pointing at an object that is
 * gone, which is what a same-key re-confirm leaves behind (see
 * `confirmAvatarUpload` on TaskaApi). An upload replaces that row, which is why
 * Upload stays on offer beside this sentence and Remove does not.
 */
function readFailureText(error: unknown) {
  const message = apiErrorFacts(error).message;
  return message ? `Your photo could not be loaded. ${message}` : "Your photo could not be loaded.";
}

/**
 * What to say when the **gateway** refused — leg 1, leg 3, or the delete.
 *
 * The undeployed arm is the fallback now rather than the first thing a reader
 * meets: when this menu's own avatar read has already answered with Spring's
 * static-resource 404, the band offers no control that could get here. It is
 * still reachable — a file chosen while that read is in flight, or a gateway
 * that deploys the read before the writes — and without it the menu would
 * print "No static resource /api/v1/users/me/avatar/upload-url" at somebody who
 * did nothing wrong. `EditProjectModal` reads the same predicate for the same
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
