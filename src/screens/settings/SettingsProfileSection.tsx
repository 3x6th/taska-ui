import { useQuery } from "@tanstack/react-query";
import { ImageUp } from "lucide-react";
import { useRef } from "react";
import { taskaApi } from "../../api/client";
import { AVATAR_ACCEPTED_SUMMARY, AVATAR_ACCEPT_ATTRIBUTE, AVATAR_MAX_SIZE_BYTES } from "../../api/avatars";
import { apiErrorFacts } from "../../api/errors";
import { ApiNotice } from "../../components/ApiNotice";
import { Avatar } from "../../components/Avatar";
import { RequestId } from "../../components/RequestId";
import { useMeta } from "../../hooks/useMeta";
import { useOwnPhoto } from "../../hooks/useOwnPhoto";
import { formatFileSize, globalRoleLabel, userStatusLabel } from "../../lib/format";
import { SettingsNotificationsSection } from "./SettingsNotificationsSection";

/**
 * Settings → My profile (TAS-380, art-director's ruling 4): who the reader is,
 * and their photo. The photo controls lived in the profile menu until this
 * story (TAS-220); the three-leg upload, the optimistic remove, the cache
 * writes and every sentence came here unchanged (`useOwnPhoto`).
 *
 * Read-only apart from the photo: nothing here invites editing, so the account
 * fields are plain text in a `<dl>`, with no inputs and no "can't edit" line.
 * No role gate — a VIEWER owns their face as an ADMIN does.
 *
 * The reader's own face comes with the profile: `GET /users/me` carries the
 * avatar since backend PR #193 (TAS-223), so this page spends no request of its
 * own on it. `null` there means no photo *or* a profile read the gateway could
 * not make, and since that PR's head `3bd33cac` the answer says which:
 * `avatarUnavailable: true` for the failed read. Both draw initials and offer
 * Upload; the failed read adds one quiet line. No request id for it (the answer
 * is a 200, whose id travels only in a header the client reads on failures),
 * and no retry control: the gateway answers the next read on its own. Only a
 * link may say there is a photo to remove (§5.6), so "Remove photo" is not
 * offered in the failed-read state either.
 */
export function SettingsProfileSection() {
  const meta = useMeta();
  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => taskaApi.getCurrentUser(),
  });
  const user = meQuery.data;
  const photo = useOwnPhoto(user);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadButtonRef = useRef<HTMLButtonElement>(null);
  const hasPhoto = typeof user?.avatarUrl === "string" && user.avatarUrl.length > 0;
  const avatarUnavailable = user?.avatarUnavailable === true;
  const { writing, uploading, notice } = photo;
  const requestId = apiErrorFacts(notice?.error).requestId;

  if (!user) {
    return (
      <div className="settings-plane">
        <div className="settings-column">
          {meQuery.isError ? (
            // A state found on arrival, not an answer to anything the reader
            // did, so it is not announced (§5.6) — the sentence, the server's
            // words and the id that finds it in the gateway log.
            <ApiNotice error={meQuery.error} live="off">
              Your profile could not be loaded.
            </ApiNotice>
          ) : (
            // §5.6: shaped like what it stands in for, no spinner, and no
            // action row — there is nobody to upload a face for yet.
            <div aria-busy="true" className="settings-profile is-skeleton">
              <p className="visually-hidden" role="status">
                Loading your profile
              </p>
              <div aria-hidden="true" className="settings-profile-head">
                <Avatar loading size="xl" />
                <div className="settings-profile-identity">
                  <span className="value-skeleton settings-skeleton-name" />
                  <span className="value-skeleton settings-skeleton-email" />
                </div>
              </div>
              <hr className="settings-divider" />
              <dl aria-hidden="true" className="settings-details">
                {["Status", "Role"].map((term) => (
                  <div key={term}>
                    <dt>{term}</dt>
                    <dd>
                      <span className="value-skeleton settings-skeleton-value" />
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>
      </div>
    );
  }

  /**
   * §4.1's in-flight recipe while a write is out (ruling 4): `aria-disabled`
   * rather than `disabled`, so the button that started an upload keeps focus —
   * Chromium blurs a focused element the instant `disabled` lands on it — and
   * the label stays, nothing dims, the cursor says the request is out, and the
   * handler is what refuses a second press.
   */
  const chooseFile = () => {
    if (writing) return;
    fileInput.current?.click();
  };
  const removePhoto = () => {
    if (writing) return;
    // The removal is optimistic, so this button unmounts with the picture a
    // moment from now: focus moves to Upload first, and never falls to <body>.
    uploadButtonRef.current?.focus();
    photo.remove();
  };

  return (
    <div className="settings-plane">
      <div className="settings-column">
        <div className="settings-profile">
          <header className="settings-profile-head">
            <Avatar size="xl" user={user} />
            <div className="settings-profile-identity">
              <strong className="settings-profile-name">{user.displayName}</strong>
              <span className="settings-profile-email">{user.email}</span>
              <div className="settings-photo">
                {/* Driven by the button beside it rather than styled directly:
                    `::file-selector-button` keeps the browser's own "No file
                    chosen" text, and a visually hidden but focusable input puts
                    a tab stop where nothing is visible. `hidden` takes it out
                    of the tab order entirely. */}
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
                    if (file) void photo.upload(file);
                  }}
                  ref={fileInput}
                  type="file"
                />
                <div className="settings-photo-actions">
                  <button
                    aria-disabled={writing || undefined}
                    className="secondary-button compact-button"
                    onClick={chooseFile}
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
                      aria-disabled={writing || undefined}
                      className="settings-photo-remove"
                      onClick={removePhoto}
                      type="button"
                    >
                      Remove photo
                    </button>
                  ) : null}
                </div>
                {/* Said before a file is chosen rather than after it is
                    refused, and it states the server's ceiling — 2 MB, which
                    the schema and auth-service agree on since TAS-222
                    (src/api/avatars.ts). While an upload is in flight the same
                    line carries its progress instead: one line, so nothing
                    below it moves either. */}
                <p className="settings-photo-hint">
                  {uploading
                    ? "Uploading…"
                    : `Up to ${formatFileSize(AVATAR_MAX_SIZE_BYTES)}. ${AVATAR_ACCEPTED_SUMMARY}.`}
                </p>
                {/* The profile read behind `GET /users/me` failed, and the
                    server said so (`avatarUnavailable`). It describes the page
                    as it opened, not an answer to something the reader did, so
                    it is not a live region — and it yields to anything newer: a
                    write's refusal, or an upload in flight, which is the way out
                    of it. */}
                {avatarUnavailable && !notice && !uploading ? (
                  <p className="settings-photo-unavailable">Your photo could not be loaded.</p>
                ) : null}
                {/* One live region that stays mounted and changes its text,
                    rather than one that appears together with what it has to
                    announce (§7). Polite: every sentence follows something the
                    reader just did. The region is the sentence alone; the
                    request id is a line beside it, outside it, so a uuid is
                    never read aloud. Empty, the box carries only its own class,
                    which takes it out of the flow; with a refusal it wears the
                    `.admin-write-failure` recipe and is laid out in flow. The
                    page resets it on leaving, so a refusal does not outlive
                    the visit it answered. */}
                <div className={notice ? "settings-photo-live admin-write-failure" : "settings-photo-live"}>
                  <p aria-live="polite" className="settings-photo-sentence">
                    {notice?.text ?? ""}
                  </p>
                  {requestId ? (
                    <p className="settings-photo-detail">
                      <RequestId value={requestId} />
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          </header>
          <hr className="settings-divider" />
          {/* Name and email are not repeated: the header carries them. */}
          <dl className="settings-details">
            <div>
              <dt>Status</dt>
              <dd>
                {/* The menu's pill and the one label rule (`userStatusLabel`):
                    an unmodelled value keeps the quiet base pill, and an absent
                    status reads "—". */}
                <span className={`user-status is-${(user.status ?? "").toLowerCase()}`}>
                  {userStatusLabel(user.status, meta?.userStatuses)}
                </span>
              </dd>
            </div>
            {/* No row at all when the server did not state the role: "Unknown"
                would read as a fact about the account. */}
            {user.globalRole ? (
              <div>
                <dt>Role</dt>
                <dd>{globalRoleLabel(user.globalRole)}</dd>
              </div>
            ) : null}
          </dl>
          <SettingsNotificationsSection key={user.id} userId={user.id} />
        </div>
      </div>
    </div>
  );
}
