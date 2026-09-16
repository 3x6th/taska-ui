import { useState } from "react";
import type { User } from "../domain/types";
import { avatarColor, initials, readableTextOn } from "../lib/format";

interface AvatarProps {
  /**
   * `id` is here because it is what the fill is computed from — see
   * `avatarColor`. Every caller that knows who this is passes one; only the
   * unassigned and loading circles are drawn without a user at all.
   *
   * `avatarUrl` is what turns the circle into a picture. The contract puts it
   * on the member row for anybody on a project — which the deployed member read
   * does not fill yet, see `User.avatarUrl` — and one read of
   * `GET /users/{userId}/avatar` fetches it for the reader themselves; absent
   * or `null`, this draws exactly what it drew before TAS-220.
   */
  user?: Pick<User, "id" | "displayName" | "color" | "avatarUrl"> | null;
  label?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
  loading?: boolean;
}

const sizeClass = {
  sm: "avatar-sm",
  md: "avatar-md",
  lg: "avatar-lg",
};

export function Avatar({ user, label, size = "md", className = "", loading = false }: AvatarProps) {
  /**
   * The one link this component has decided not to trust again.
   *
   * A download URL is presigned and lives fifteen minutes, so a board left open
   * over lunch is holding links that have expired — an **ordinary state**, not
   * an error, and the reason this falls back rather than showing a broken-image
   * glyph or an empty hole. Keyed by the URL itself so that a *new* link for the
   * same person is tried: the natural implementation, a boolean, would remember
   * "this person's picture is broken" and refuse the replacement they just
   * uploaded.
   */
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const name = loading ? "Loading user" : (user?.displayName ?? label ?? "Unassigned");
  // Not while loading: a skeleton that has already been painted someone's
  // colour is claiming to know whose circle it is.
  const fill = user && !loading ? avatarColor(user.id, user.color) : null;
  const src = !loading && user?.avatarUrl && user.avatarUrl !== failedUrl ? user.avatarUrl : null;
  return (
    <span
      // `avatar-with-image` only while a picture is actually being drawn, so a
      // link that fails to load gives the circle back its full fill along with
      // its initials: the inset exists to keep the fill from ringing a
      // photograph's edge, and with no photograph there is no edge to ring.
      className={`avatar ${sizeClass[size]} ${!user && !loading ? "avatar-empty" : ""} ${loading ? "avatar-loading" : ""} ${src ? "avatar-with-image" : ""} ${className}`}
      // The glyph travels with the fill and is computed from it (TAS-175), so
      // the two are set together or not at all: half of this pair — a fill with
      // the stylesheet's white still under it — is the unreadable case.
      //
      // The fill stays under the image rather than being dropped when there is
      // one, which is the whole reason a slow load is a coloured circle and
      // never a blank one — and the reason a picture with transparency sits on
      // this person's colour instead of on whatever is behind the avatar.
      style={fill ? { backgroundColor: fill, color: readableTextOn(fill) } : undefined}
      title={name}
      aria-label={name}
      aria-busy={loading || undefined}
    >
      {src ? (
        // `alt=""`, because the name is already on the wrapper as `aria-label`
        // and `title` (§4.4) — a second copy would make every avatar read its
        // owner's name twice. Decorative in the accessibility tree, load-bearing
        // on screen.
        //
        // No entrance animation: §3 forbids a 0% frame that hides content, and
        // an image that fades in is an image that is missing for the length of
        // the fade on a machine that has paused animation.
        <img alt="" className="avatar-image" onError={() => setFailedUrl(src)} src={src} />
      ) : null}
      {/* Initials only when there is no picture to cover them. A picture that
          is still arriving deliberately shows the bare fill instead: letters
          that appear and are then covered a moment later are a flicker, and a
          transparent PNG would leave them showing through underneath. */}
      {user && !loading && !src ? initials(name) : ""}
    </span>
  );
}
