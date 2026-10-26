import {
  BookOpen,
  Bug,
  FileText,
  Flag,
  Headset,
  Layers,
  Megaphone,
  SquareCheckBig,
  X,
  type LucideIcon,
} from "lucide-react";
import { createElement, type CSSProperties } from "react";
import type { IssueSearchHit, IssueTypeColor, IssueTypeIcon, Label } from "../domain/types";
import { useMeta } from "../hooks/useMeta";
import {
  issueTypeColorValue,
  issueTypeEntry,
  issueTypeLabel,
  labelChipStyle,
  priorityLabel,
  priorityVisual,
  readableTextOn,
  statusColor,
  type IssueTypeRegistry,
} from "../lib/format";

/**
 * DESIGN.md §4.6 (TAS-417): the contract's icon key → the `lucide-react` glyph
 * drawn for it. The one table, statically imported so the bundle carries
 * exactly these eight; a value off the wire is read only through
 * `IssueTypeGlyph`, never by indexing.
 */
const issueTypeIcons: Record<IssueTypeIcon, LucideIcon> = {
  "check-square": SquareCheckBig,
  bug: Bug,
  "book-open": BookOpen,
  headset: Headset,
  megaphone: Megaphone,
  "file-text": FileText,
  flag: Flag,
  layers: Layers,
};

/**
 * The glyph for an icon key, read through the table only by value — a key
 * outside the eight draws nothing (§4.6). `chip` is the type chip's stroke:
 * 1.5, absolute, so the 12px glyph is not drawn thinner than its neighbours.
 */
export function IssueTypeGlyph({ icon, size, chip = false }: { icon: IssueTypeIcon | null; size: number; chip?: boolean }) {
  if (icon === null || !Object.hasOwn(issueTypeIcons, icon)) return null;
  return createElement(issueTypeIcons[icon], {
    "aria-hidden": true,
    size,
    ...(chip ? { absoluteStrokeWidth: true, strokeWidth: 1.5 } : {}),
  });
}

/**
 * The 16×16 tile of §4.6 for a look: the fill of the type's colour with its
 * glyph in `readableTextOn` of that fill, the two set together in one inline
 * style (§4.4's pair rule). A colour outside the seven is the neutral fill with
 * a `--fg` glyph, by class; an icon outside the eight leaves the tile without a
 * glyph. Used where a look is drawn without a stored type behind it as well —
 * the Issue types form's live preview.
 */
export function TypeTile({
  color,
  icon,
  title,
  className = "",
}: {
  color: IssueTypeColor | null;
  icon: IssueTypeIcon | null;
  title?: string;
  className?: string;
}) {
  const fill = color === null ? null : issueTypeColorValue(color);
  const style: CSSProperties | undefined = fill ? { backgroundColor: fill, color: readableTextOn(fill) } : undefined;
  return (
    <span className={`type-chip ${fill ? "" : "is-unknown-color"} ${className}`} style={style} title={title}>
      <IssueTypeGlyph chip icon={icon} size={12} />
    </span>
  );
}

/**
 * §4.6 (TAS-417, TAS-418). Takes any key the server sent and where its look
 * comes from: the project's registry — an entry of the context in the cache —
 * or, for a global-search hit, the hit's own `issueTypeName`, `issueTypeColor`
 * and `issueTypeIcon`. A key the registry does not hold, a hit that carries no
 * look, or neither source at all is the same 16px slot filled `--fg-3` with no
 * glyph, so nothing in the row moves. `title` is the label of §6.
 */
export function TypeChip({
  type,
  registry,
  hit,
}: {
  type: string;
  registry?: IssueTypeRegistry;
  hit?: Pick<IssueSearchHit, "issueTypeName" | "issueTypeColor" | "issueTypeIcon">;
}) {
  const title = issueTypeLabel(type, registry, hit?.issueTypeName);
  // A hit whose type has left its registry carries none of the three (TAS-418).
  const hitLook =
    hit && (hit.issueTypeName != null || hit.issueTypeColor != null || hit.issueTypeIcon != null)
      ? { color: hit.issueTypeColor ?? null, icon: hit.issueTypeIcon ?? null }
      : null;
  const look = registry ? issueTypeEntry(type, registry) : hitLook;
  if (!look) return <span className="type-chip is-unknown" title={title} />;
  return <TypeTile color={look.color} icon={look.icon} title={title} />;
}

/**
 * §4.7. A priority this build cannot rank fills none of the bars and is named
 * in words before them (art-director, TAS-173): three empty bars alone would
 * read as lower than Low, and nothing in the app may place an unknown value
 * among the known ones. `nameClassName` is the one difference a host may ask
 * for — the global search draws the name as its row note.
 */
export function PriorityBars({ priority, nameClassName = "priority-name" }: { priority: string; nameClassName?: string }) {
  const served = useMeta()?.priorities;
  const visual = priorityVisual(priority);
  const label = priorityLabel(priority, served);
  // "URGENT priority", but "No priority" rather than "No priority priority".
  const title = typeof priority === "string" && priority.trim() ? `${label} priority` : label;
  const bars = (
    <span className="priority-bars" title={title}>
      {[5, 8, 11].map((height, index) => (
        <span
          key={height}
          style={{
            height,
            backgroundColor: index < visual.level ? visual.color : "var(--border-strong)",
          }}
        />
      ))}
    </span>
  );
  if (visual.known) return bars;
  return (
    <>
      <span className={nameClassName} title={label}>
        {label}
      </span>
      {bars}
    </>
  );
}

/**
 * §4.9's dot, coloured by a workflow status's category — whatever stands
 * beside it says the status in words — and the hollow ring for a category this
 * build cannot colour (§2.2). A Workflows status row and a diagram node draw it
 * (§4.28).
 */
export function CategoryDot({ category }: { category: string }) {
  const color = statusColor(null, category);
  return color ? (
    <span aria-hidden="true" className="status-dot" style={{ background: color }} />
  ) : (
    <span aria-hidden="true" className="status-dot is-unknown" />
  );
}

/**
 * One label, as a pill (§4.5). The name is always text: colour carries no
 * meaning on its own here, as a type chip carries its glyph beside its colour
 * (§4.6), and a label whose name the gateway omitted says so rather than
 * rendering as a bare swatch nobody can read or search for.
 *
 * `onRemove` is what makes the chip interactive; without it this is a plain
 * span, which is why it is safe inside the board card's own button.
 */
export function LabelChip({
  label,
  onRemove,
  removeDisabled,
}: {
  label: Label;
  onRemove?: () => void;
  removeDisabled?: boolean;
}) {
  const name = label.name || "Unnamed label";
  return (
    <span className={`label-chip ${onRemove ? "is-removable" : ""}`} style={labelChipStyle(label.color)} title={name}>
      <span className="label-chip-name">{name}</span>
      {onRemove ? (
        <button
          aria-label={`Remove label ${name}`}
          className="label-chip-remove"
          disabled={removeDisabled}
          onClick={onRemove}
          type="button"
        >
          <X size={11} />
        </button>
      ) : null}
    </span>
  );
}
