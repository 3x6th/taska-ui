import type { User } from "../domain/types";
import { initials } from "../lib/format";

interface AvatarProps {
  user?: Pick<User, "displayName" | "color"> | null;
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
      style={user?.color ? { backgroundColor: user.color } : undefined}
      title={name}
      aria-label={name}
      aria-busy={loading || undefined}
    >
      {user && !loading ? initials(name) : ""}
    </span>
  );
}
