import type { User } from "../domain/types";
import { initials } from "../lib/format";

interface AvatarProps {
  user?: Pick<User, "displayName" | "color"> | null;
  label?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const sizeClass = {
  sm: "avatar-sm",
  md: "avatar-md",
  lg: "avatar-lg",
};

export function Avatar({ user, label, size = "md", className = "" }: AvatarProps) {
  const name = user?.displayName ?? label ?? "Unassigned";
  return (
    <span
      className={`avatar ${sizeClass[size]} ${!user ? "avatar-empty" : ""} ${className}`}
      style={user?.color ? { backgroundColor: user.color } : undefined}
      title={name}
      aria-label={name}
    >
      {user ? initials(name) : ""}
    </span>
  );
}
