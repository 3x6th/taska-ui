import type { IssueLinkType, IssuePriority, IssueStatus, IssueType } from "../domain/types";

export const statusLabels: Record<IssueStatus, string> = {
  TODO: "To Do",
  IN_PROGRESS: "In Progress",
  DONE: "Done",
};

export const statusColors: Record<IssueStatus, string> = {
  TODO: "#9aa0aa",
  IN_PROGRESS: "var(--accent)",
  DONE: "#3fa863",
};

export const typeMeta: Record<IssueType, { label: string; color: string; radius: string }> = {
  TASK: { label: "Task", color: "#4f7cf0", radius: "4px" },
  STORY: { label: "Story", color: "#3fa863", radius: "4px" },
  BUG: { label: "Bug", color: "#e5544b", radius: "50%" },
};

export const priorityMeta: Record<IssuePriority, { label: string; color: string; level: number }> = {
  LOW: { label: "Low", color: "#9aa0aa", level: 1 },
  MEDIUM: { label: "Medium", color: "#e3a008", level: 2 },
  HIGH: { label: "High", color: "#e5544b", level: 3 },
};

/** The three relations a *request* may ask for, in the order the picker shows them. */
export const issueLinkTypes: IssueLinkType[] = ["BLOCKS", "RELATES_TO", "DUPLICATES"];

/**
 * Written labels for the values we know. The response field (`viewLinkType`) is
 * an open string by contract, so this is a lookup with a fallback rather than a
 * `Record<IssueLinkType, string>`: the inverses are values the request enum
 * cannot express but the response can carry.
 */
const issueLinkTypeLabels: Record<string, string> = {
  BLOCKS: "Blocks",
  IS_BLOCKED_BY: "Is blocked by",
  RELATES_TO: "Relates to",
  DUPLICATES: "Duplicates",
  IS_DUPLICATED_BY: "Is duplicated by",
};

/**
 * A relation the UI can print, whatever the server said. A known value gets its
 * written label; anything else is humanised verbatim (`SUPERSEDES` →
 * "Supersedes") rather than dropped or coerced into a relation it is not — the
 * link is real either way, and a row with no label would hide it. An unstated
 * relation reads "Linked", which claims only what the response proves.
 */
export const issueLinkTypeLabel = (viewLinkType: string) => {
  const value = viewLinkType.trim();
  if (!value) return "Linked";
  const known = issueLinkTypeLabels[value.toUpperCase()];
  if (known) return known;
  const words = value.replace(/[_-]+/g, " ").trim().toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Linked";
};

export const initials = (name = "") =>
  name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

export const formatDay = (iso: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(iso));

export const formatDateTime = (iso: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));

export const relativeTime = (iso: string) => {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.max(1, Math.round(diffMs / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "Yesterday" : `${days}d ago`;
};

/**
 * The contract's own spelling for a label colour (`^#[0-9A-Fa-f]{6}$`). Kept
 * here rather than only in the API layer because this is where a colour is
 * turned into CSS, and a value the gateway sent is not a value this build
 * chose — the check is what stops an unexpected one reaching a style attribute.
 */
export const isLabelColor = (value: string) => /^#[0-9a-f]{6}$/i.test(value);

/**
 * Colours offered when a label is created. Deliberately a short list rather
 * than a free colour input: every value here is already legible against both
 * surfaces at §4.5's 16% tint, which a hand-typed one would not be.
 */
export const labelColorChoices = [
  "#0052cc",
  "#0ea5e9",
  "#3fa863",
  "#e3a008",
  "#e5544b",
  "#ec4899",
  "#8b5cf6",
  "#6366f1",
];

/**
 * DESIGN.md §4.5's badge recipe — tinted background, the colour itself as the
 * text — applied to a colour the *server* chose rather than one this build
 * picked. Exactly those two values and no third: the recipe names a fill and a
 * text colour, and every other badge in this app (`key-badge`, `count-pill`,
 * `type-chip`) is drawn without a ring, so a bordered label chip would be the
 * only one shouting in its family.
 *
 * A value the contract's own pattern rejects never reaches CSS: it falls back
 * to the accent, so a malformed colour leaves a readable chip instead of an
 * invisible or unstyled one.
 */
export const labelChipStyle = (color: string) => {
  const value = isLabelColor(color) ? color : "var(--accent)";
  return {
    color: value,
    background: `color-mix(in oklab, ${value} 16%, transparent)`,
  };
};
