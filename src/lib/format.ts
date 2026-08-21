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
 * Colours offered when a label is created. A fixed list rather than a free
 * colour input so the set can be measured once and recorded: none of these
 * eight clears 4.5:1 in both themes at §4.5's 16% tint — DESIGN.md §9 carries
 * the measured table, §7 the recorded gap (TAS-142). Adding a ninth value is
 * not made safe by this list existing.
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

/**
 * DESIGN.md §2.2's avatar palette. A list of hexes rather than tokens for the
 * same reason `labelColorChoices` is one: the values are not theme-dependent,
 * and a component may not hold a hex (AGENTS.md), so the one place they are
 * allowed to live is here.
 */
export const avatarColorChoices = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ec4899"];

/**
 * FNV-1a over the string's code units. A named algorithm rather than a sum of
 * characters because the requirement is stability, not distribution: the same
 * id has to land on the same colour across reloads, rebuilds, and the mock/rest
 * split, so nothing here may depend on insertion order, list position, or
 * `Math.random`. `Math.imul` keeps the 32-bit multiply from losing precision
 * once the accumulator passes 2^53.
 */
const hash32 = (value: string) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

const fromPalette = (palette: string[], seed: string) => palette[hash32(seed) % palette.length];

/**
 * The colour an avatar is filled with. Seeded by **user id**, never by the name
 * or the initials: a display name can be edited, and a colour that moved when
 * someone fixed their surname would be noise rather than identity — while two
 * people who share initials have to differ somehow, which is the entire reason
 * the fill is coloured at all.
 *
 * A colour the server stated still wins, when there is one and the contract's
 * own pattern accepts it. The gateway has no `color` on a user (it is a label
 * field only), so in practice this computes; the mock states colours, and its
 * seeded people keep the ones DESIGN.md picked for them.
 */
export const avatarColor = (userId: string, color?: string) =>
  color && isLabelColor(color) ? color : fromPalette(avatarColorChoices, userId);

/**
 * DESIGN.md §4.5's project-key badge — the same tint-and-text recipe as
 * `labelChipStyle`, given a colour the build computes rather than one the
 * server sent.
 *
 * Seeded by **project key**, which is the one identifier the contract promises
 * cannot move: it is embedded in every `issueKey` (TAS-145), so a renamed
 * project keeps its colour, and the badge and the keys on its cards agree.
 */
export const keyBadgeStyle = (projectKey: string, color?: string) => {
  const value = color && isLabelColor(color) ? color : fromPalette(labelColorChoices, projectKey);
  return {
    color: value,
    background: `color-mix(in oklab, ${value} 16%, transparent)`,
  };
};
