import { X } from "lucide-react";
import type { IssuePriority, IssueType, Label } from "../domain/types";
import { labelChipStyle, priorityMeta, typeMeta } from "../lib/format";

export function TypeChip({ type }: { type: IssueType }) {
  const meta = typeMeta[type];
  return (
    <span
      className="type-chip"
      style={{
        backgroundColor: meta.color,
        borderRadius: meta.radius,
      }}
      title={meta.label}
    />
  );
}

export function PriorityBars({ priority }: { priority: IssuePriority }) {
  const meta = priorityMeta[priority];
  return (
    <span className="priority-bars" title={`${meta.label} priority`}>
      {[5, 8, 11].map((height, index) => (
        <span
          key={height}
          style={{
            height,
            backgroundColor: index < meta.level ? meta.color : "var(--border-strong)",
          }}
        />
      ))}
    </span>
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
