import type { IssuePriority, IssueType } from "../domain/types";
import { priorityMeta, typeMeta } from "../lib/format";

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
