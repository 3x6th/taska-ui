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
import { isIssueTypeShape } from "../api/issueTypes";
import type { IssueSearchHit, IssueTypeColor, IssueTypeIcon, IssueTypeShape, Label } from "../domain/types";
import { useMeta } from "../hooks/useMeta";
import {
  issueTypeColorValue,
  issueTypeEntry,
  issueTypeLabel,
  labelChipStyle,
  priorityLabel,
  priorityVisual,
  statusColor,
  type IssueTypeRegistry,
} from "../lib/format";

/**
 * DESIGN.md §4.6 (TAS-417, TAS-434): the contract's icon key → the
 * `lucide-react` glyph drawn for it. The one table, statically imported so the
 * bundle carries exactly these eight; a value off the wire is read only
 * through `IssueTypeGlyph` and `hasIssueTypeGlyph`, never by indexing.
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

/** Whether an icon key off the wire is one of the eight this build draws (§4.6). */
const hasIssueTypeGlyph = (icon: IssueTypeIcon | null | undefined): icon is IssueTypeIcon =>
  typeof icon === "string" && Object.hasOwn(issueTypeIcons, icon);

/**
 * The glyph for an icon key, read through the table only by value — a key
 * outside the eight draws nothing (§4.6). `chip` is the type chip's stroke:
 * 1.7, absolute, so the 14px glyph is not drawn thinner than its neighbours
 * (§2.7).
 */
export function IssueTypeGlyph({ icon, size, chip = false }: { icon: IssueTypeIcon | null; size: number; chip?: boolean }) {
  if (!hasIssueTypeGlyph(icon)) return null;
  return createElement(issueTypeIcons[icon], {
    "aria-hidden": true,
    size,
    ...(chip ? { absoluteStrokeWidth: true, strokeWidth: 1.7 } : {}),
  });
}

/** What a type is drawn with (§4.6): the registry entry's three, or a global-search hit's. */
export interface TypeLook {
  color: IssueTypeColor | null;
  shape: IssueTypeShape | null;
  icon: IssueTypeIcon | null;
}

/**
 * The 14×14 chip of §4.6 for a look — one of two things, never both:
 *
 * - the type's **icon**, when it is one of the eight: a 14px line glyph whose
 *   stroke is the type's colour, with no fill and no tile, and no shape;
 * - otherwise its **shape**, filled with the type's colour: a square (radius
 *   4), a circle, or a diamond (an 11×11 square at radius 2, turned 45°, on
 *   `::before`). A shape outside the three — or none at all — is the square,
 *   the neutral figure and the server's default; the client never guesses a
 *   circle.
 *
 * The colour is one inline custom property, `--type-fill`, which the shape
 * fills with and the glyph strokes with; a colour outside the seven sets none,
 * and the stylesheet falls back to `--fg-3`. No text sits on the fill, so no
 * glyph colour is chosen from it (§4.4's pair is not needed). Used where a look
 * is drawn without a stored type behind it as well — the Issue types form's
 * live preview.
 */
export function TypeLookChip({ color, shape, icon, title }: TypeLook & { title?: string }) {
  const fill = color === null ? null : issueTypeColorValue(color);
  const style = fill ? ({ "--type-fill": fill } as CSSProperties) : undefined;
  if (hasIssueTypeGlyph(icon)) {
    return (
      <span className="type-chip is-icon" style={style} title={title}>
        <IssueTypeGlyph chip icon={icon} size={14} />
      </span>
    );
  }
  const figure: IssueTypeShape = isIssueTypeShape(shape) ? shape : "square";
  return <span className={`type-chip is-${figure}`} style={style} title={title} />;
}

/**
 * §4.6 (TAS-417, TAS-418, TAS-434). Takes any key the server sent and where
 * its look comes from: the project's registry — an entry of the context in the
 * cache — or, for a global-search hit, the hit's own `issueTypeName`,
 * `issueTypeColor`, `issueTypeShape` and `issueTypeIcon`. A key the registry
 * does not hold, a hit that carries no look, or neither source at all is the
 * same 14px slot as a `--fg-3` square, so nothing in the row moves. `title` is
 * the label of §6.
 */
export function TypeChip({
  type,
  registry,
  hit,
}: {
  type: string;
  registry?: IssueTypeRegistry;
  hit?: Pick<IssueSearchHit, "issueTypeName" | "issueTypeColor" | "issueTypeShape" | "issueTypeIcon">;
}) {
  const title = issueTypeLabel(type, registry, hit?.issueTypeName);
  // A hit whose type has left its registry carries none of the four (TAS-418, TAS-432).
  const hitLook: TypeLook | null =
    hit &&
    (hit.issueTypeName != null || hit.issueTypeColor != null || hit.issueTypeShape != null || hit.issueTypeIcon != null)
      ? { color: hit.issueTypeColor ?? null, shape: hit.issueTypeShape ?? null, icon: hit.issueTypeIcon ?? null }
      : null;
  const look = registry ? issueTypeEntry(type, registry) : hitLook;
  if (!look) return <TypeLookChip color={null} icon={null} shape={null} title={title} />;
  return <TypeLookChip color={look.color} icon={look.icon} shape={look.shape} title={title} />;
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
 * meaning on its own here, as a type chip always has its type's name beside it
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
