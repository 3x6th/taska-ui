import type { User } from "../domain/types";
import { avatarColor, initials } from "../lib/format";

interface AvatarProps {
  /**
   * `id` is here because it is what the fill is computed from — see
   * `avatarColor`. Every caller that knows who this is passes one; only the
   * unassigned and loading circles are drawn without a user at all.
   */
  user?: Pick<User, "id" | "displayName" | "color"> | null;
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
  const name = loading ? "Loading user" : (user?.displayName ?? label ?? "Unassigned");
  return (
    <span
      className={`avatar ${sizeClass[size]} ${!user && !loading ? "avatar-empty" : ""} ${loading ? "avatar-loading" : ""} ${className}`}
      // Not while loading: a skeleton that has already been painted someone's
      // colour is claiming to know whose circle it is.
      style={user && !loading ? { backgroundColor: avatarColor(user.id, user.color) } : undefined}
      title={name}
      aria-label={name}
      aria-busy={loading || undefined}
    >
      {user && !loading ? initials(name) : ""}
    </span>
  );
}
