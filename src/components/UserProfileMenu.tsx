import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
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
import type { GlobalRole, User, UserStatus } from "../domain/types";
import { useDismissOnOutside } from "../hooks/useDismissOnOutside";
import { formatFileSize } from "../lib/format";
import { Avatar } from "./Avatar";

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

/** Which leg of the upload is in flight, for the line the button shows. */
type AvatarUploadStep = "signing" | "uploading" | "confirming";

const stepLabels: Record<AvatarUploadStep, string> = {
  signing: "Preparing…",
  uploading: "Uploading…",
  confirming: "Saving…",
};

interface PhotoNotice {
  tone: "info" | "error";
  text: string;
}

export function UserProfileMenu({ user, loading = false, loggingOut = false, onLogout }: UserProfileMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const popoverId = useId();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<AvatarUploadStep | null>(null);
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
   * (backend PR #150 puts one nowhere near the profile read), so the reader's
   * own face cannot ride on a list the way every other person's does — a member
   * row carries theirs inline.
   *
   * One request per signed-in session in practice: the key holds no screen in
   * it, so the board's copy of this menu and the top bar's are the same query,
   * and react-query's default `staleTime` in src/main.tsx keeps it from being
   * re-asked as the reader moves between them.
   *
   * Not retried for the two answers that are already final. "Missing or not
   * yours" is an answer, and so is the static-resource 404 the four avatar
   * routes give today — retrying either spends a second request to be told the
   * same thing, on every screen, for every reader, until the backend deploys.
   */
  const avatarQuery = useQuery({
    queryKey: avatarKey,
    enabled: Boolean(user?.id),
    queryFn: () => taskaApi.getUserAvatarUrl(user!.id),
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
  // Only a successful read may say there is a photo to remove (§5.6). A read
  // that failed — the undeployed gateway included — offers no Remove rather
  // than an ineffective one.
  const hasPhoto = typeof avatarQuery.data === "string" && avatarQuery.data.length > 0;
  const busy = step !== null;

  /**
   * Every screen holding a member list is holding this person's avatar too —
   * `ProjectMemberDetailsDto` carries it inline — so a photo that changed here
   * has changed there. Both holders are named because they are two keys, not
   * one: the board's `["members", projectId]` and the project cards'
   * `["project-summaries", projectId]`, which carries the avatar stack. Missing
   * the second leaves the reader looking at their old initials on the very
   * screen they uploaded from.
   *
   * The cost is bounded and worth stating: `invalidateQueries` refetches only
   * *active* queries, so this is one member read on the board and one summary
   * read per visible card on `/projects` — paid once, on an action the reader
   * took, rather than on every render.
   */
  const refreshMemberFaces = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["members"] }),
      queryClient.invalidateQueries({ queryKey: ["project-summaries"] }),
    ]);

  /**
   * Optimistic with rollback, unlike the upload below it, and the asymmetry is
   * the same one the attachments panel draws: a delete is a single call whose
   * outcome the client can predict, so the circle goes back to initials at
   * once. An upload is three legs, one of them to a server that is not Taska,
   * and its outcome is genuinely unknown until it lands.
   */
  const remove = useMutation({
    mutationFn: () => taskaApi.deleteMyAvatar(),
    onMutate: async () => {
      setNotice(null);
      await queryClient.cancelQueries({ queryKey: avatarKey });
      const previous = queryClient.getQueryData<string | null>(avatarKey);
      queryClient.setQueryData<string | null>(avatarKey, null);
      return { previous };
    },
    onError: (error, _variables, context) => {
      queryClient.setQueryData(avatarKey, context?.previous);
      setNotice({ tone: "error", text: writeFailureText(error, "removed") });
    },
    // Nothing is announced on success. The contract calls this idempotent —
    // 204 whether or not there was an avatar — so "your photo was removed" is a
    // sentence this client cannot actually stand behind, and the circle going
    // back to initials is the report.
    onSettled: async () => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: avatarKey }), refreshMemberFaces()]);
    },
  });

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
   * What the reader gets instead is the step, on the button they pressed.
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

    setStep("signing");
    let ticket;
    try {
      // Leg 1, and the moment the fifteen-minute clock starts — which is why it
      // is asked for when the file is chosen rather than when the menu opens.
      ticket = await taskaApi.createAvatarUploadUrl(candidate);
    } catch (error) {
      setStep(null);
      setNotice({ tone: "error", text: writeFailureText(error, "saved") });
      return;
    }

    setStep("uploading");
    try {
      // Leg 2. `candidate.contentType` and not `file.type` re-read — the same
      // value today, but this is the one place where sending something even
      // slightly different from what was signed is a 403 nobody can diagnose.
      await taskaApi.putAvatarBytes(ticket.uploadUrl, file, candidate.contentType);
    } catch (error) {
      setStep(null);
      setNotice({ tone: "error", text: uploadFailureText(error) });
      return;
    }

    setStep("confirming");
    try {
      // Leg 3. Safe to send again after a failure, unlike the attachment
      // confirm: there is one avatar per user and a repeat replaces rather than
      // inserting a second row. Nothing retries automatically anyway — the
      // person choosing the file again is the retry.
      const saved = await taskaApi.confirmAvatarUpload({
        objectKey: ticket.objectKey,
        fileName: file.name,
        contentType: candidate.contentType,
      });
      setStep(null);
      // The confirm answers with the link, so the new face is on screen without
      // a follow-up read. The invalidation behind it is for the other holders
      // of this query, not for this one.
      queryClient.setQueryData<string | null>(avatarKey, saved.downloadUrl);
      await Promise.all([queryClient.invalidateQueries({ queryKey: avatarKey }), refreshMemberFaces()]);
    } catch (error) {
      setStep(null);
      setNotice({ tone: "error", text: writeFailureText(error, "saved") });
    }
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
                {/* Driven by the button beside it rather than styled directly:
                    `::file-selector-button` keeps the browser's own "No file
                    chosen" text, and a visually hidden but focusable input puts
                    a tab stop where nothing is visible. `hidden` takes it out of
                    the tab order entirely. */}
                <input
                  accept={AVATAR_ACCEPT_ATTRIBUTE}
                  className="avatar-input"
                  hidden
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    // Cleared straight away so choosing the same file twice —
                    // after a refusal, which is exactly when someone would —
                    // still fires a change event.
                    event.target.value = "";
                    if (file) void runUpload(file);
                  }}
                  ref={fileInput}
                  type="file"
                />
                <div className="user-profile-photo-actions">
                  <button
                    className="secondary-button compact-button"
                    disabled={busy || remove.isPending}
                    onClick={() => fileInput.current?.click()}
                    type="button"
                  >
                    <ImageUp aria-hidden="true" size={13} />
                    {step ? stepLabels[step] : hasPhoto ? "Replace photo" : "Upload a photo"}
                  </button>
                  {/* No confirmation dialog, deliberately: this is undone by
                      uploading again, which is not what the admin section's
                      confirmations are for. */}
                  {hasPhoto ? (
                    <button
                      className="link-button user-profile-photo-remove"
                      disabled={busy || remove.isPending}
                      onClick={() => remove.mutate()}
                      type="button"
                    >
                      Remove photo
                    </button>
                  ) : null}
                </div>
                {/* Said before a file is chosen rather than after it is refused,
                    and it states the ceiling the server actually enforces —
                    2 MB, not the 5 MB its own schema declares
                    (src/api/avatars.ts). */}
                <p className="user-profile-photo-hint">
                  Up to {formatFileSize(AVATAR_MAX_SIZE_BYTES)}. {AVATAR_ACCEPTED_SUMMARY}.
                </p>
                {/* One live region that stays mounted and changes its text,
                    rather than one that appears together with what it has to
                    announce — §7 records the second shape as depending on
                    screen-reader timing. Polite, not assertive: every sentence
                    here follows something the reader just did. Empty, it
                    carries no class and takes no space. */}
                <div
                  aria-live="polite"
                  className={notice ? `user-profile-photo-note${notice.tone === "error" ? " is-error" : ""}` : ""}
                >
                  {notice?.text ?? ""}
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
 * The undeployed arm is the one every reader meets today: all four avatar
 * routes answer Spring's static-resource 404, so without this the menu would
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
