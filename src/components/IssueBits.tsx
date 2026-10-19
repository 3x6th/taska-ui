import { X } from "lucide-react";
import type { Label } from "../domain/types";
import { useMeta } from "../hooks/useMeta";
import { issueTypeLabel, issueTypeVisual, labelChipStyle, priorityLabel, priorityVisual } from "../lib/format";

/**
 * §4.6. Takes any code the server sent (TAS-173): a type this build has no
 * colour for is the same 14px square in `--fg-3` — no shift in the row, and
 * neutral rather than a hollow box that reads as a checkbox — named in `title`
 * by the one label rule (`issueTypeLabel`).
 */
export function TypeChip({ type }: { type: string }) {
  const served = useMeta()?.issueTypes;
  const visual = issueTypeVisual(type);
  return (
    <span
      className={`type-chip ${visual.known ? "" : "is-unknown"}`}
      style={{
        backgroundColor: visual.color,
        borderRadius: visual.radius,
      }}
      title={issueTypeLabel(type, served)}
    />
  );
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
 * One label, as a pill (§4.5). The name is always text: colour carries no
 * meaning on its own here for the same reason the BUG type chip is a circle
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
