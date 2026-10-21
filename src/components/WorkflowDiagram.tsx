import { useCallback, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { WorkflowDefinition } from "../domain/types";
import { statusLabel } from "../lib/format";
import { diagramHeight, fitWorkflowDiagram, planWorkflowDiagram, type PlannedEdge } from "../lib/workflowDiagram";
import { andList, statusesInColumnOrder, transitionsInListOrder } from "../lib/workflows";
import { CategoryDot } from "./IssueBits";

/** Focus inside the diagram, and whether it came from the keyboard — the only focus that highlights. */
interface Focus {
  id: string;
  visible: boolean;
}

/**
 * A workflow's transitions as a picture (DESIGN.md §4.28 "Схема переходов",
 * TAS-382): its statuses in column order, one node each, and every transition
 * between two of them as a bracket — forward ones on the right, backward ones
 * on the left. Read-only: nothing here writes, and the Statuses and
 * Transitions lists under it stay whole, because they are the way through the
 * same facts for the keyboard, a screen reader and a phone.
 *
 * **Measured, not scaled.** The card's width is read before the first paint and
 * on every change (`ResizeObserver`); a diagram too wide for it at either lane
 * step is not drawn at all, and a line says the list has every transition. The
 * height does not depend on the width, so it is held from the first frame.
 *
 * **One node is active at a time**: the one the mouse is over, else the one
 * with keyboard focus, else the pinned one. Its transitions turn accent and
 * come to the front; the rest dim as one group; the statuses it has no
 * transition with recede. A press pins a node and a second press unpins it —
 * `aria-pressed` says which is pinned. Focus from a pointer press does not
 * count as focus here: it would hold a node lit that its second press had just
 * unpinned.
 *
 * **One Tab stop** (roving `tabIndex`): the pinned node, else the first; while
 * focus is inside, the focused one. ↑/↓ move to a neighbour without wrapping,
 * Home/End to the ends. Esc is left to the dialog.
 */
export function WorkflowDiagram({ workflow, name }: { workflow: WorkflowDefinition; name: string }) {
  const descriptionIds = useId();
  const statuses = useMemo(() => statusesInColumnOrder(workflow.statuses), [workflow.statuses]);
  const plan = useMemo(
    () =>
      planWorkflowDiagram(
        statuses.map((status) => status.id),
        transitionsInListOrder(workflow),
      ),
    [statuses, workflow],
  );

  const [width, setWidth] = useState<number | null>(null);
  // A ref callback with a cleanup (React 19): the state it sets during commit
  // is applied before the browser paints, so the first frame already holds
  // the diagram or the line that stands in for it.
  const measure = useCallback((element: HTMLDivElement | null) => {
    if (!element) return;
    const read = () => setWidth(element.getBoundingClientRect().width);
    read();
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const layout = useMemo(() => (width === null ? null : fitWorkflowDiagram(plan, width)), [plan, width]);

  const [pinned, setPinned] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [focus, setFocus] = useState<Focus | null>(null);
  const nodes = useRef<(HTMLButtonElement | null)[]>([]);

  // Nothing to picture: the section lines below say it (§4.28 "Состояния").
  if (statuses.length < 2 || workflow.transitions.length === 0) return null;
  if (!plan.edges.length) {
    return plan.notDrawn ? (
      <div className="workflow-diagram">
        <NotDrawnLine count={plan.notDrawn} />
      </div>
    ) : null;
  }

  const label = (statusKey: string) => statusLabel(statusKey, workflow.statuses);
  // A status that left the list since it was pinned, hovered or focused is no
  // longer any of those: the pin survives a re-read only while its status does.
  const listed = (id: string | null | undefined) => (id && plan.statusIds.includes(id) ? id : null);
  const pin = listed(pinned);
  const focused = listed(focus?.id);
  const active = listed(hovered) ?? (focus?.visible ? focused : null) ?? pin;
  const stop = focused ?? pin ?? plan.statusIds[0];

  const touches = (edge: PlannedEdge, id: string | null) => id !== null && (edge.fromStatusId === id || edge.toStatusId === id);
  const neighbours = new Set(
    plan.edges.filter((edge) => touches(edge, active)).flatMap((edge) => [edge.fromStatusId, edge.toStatusId]),
  );

  const columnOf = (id: string) => plan.statusIds.indexOf(id);
  const named = (edges: PlannedEdge[], end: (edge: PlannedEdge) => string) =>
    andList(
      [...edges]
        .sort((a, b) => columnOf(end(a)) - columnOf(end(b)))
        .map((edge) => {
          const status = statuses.find((item) => item.id === end(edge));
          return `${status ? label(status.statusKey) : ""}${edge.hidden ? " (hidden)" : ""}`;
        }),
    );
  const describe = (id: string) => {
    const out = plan.edges.filter((edge) => edge.fromStatusId === id);
    const into = plan.edges.filter((edge) => edge.toStatusId === id);
    return `${out.length ? `Leads to ${named(out, (edge) => edge.toStatusId)}.` : "No transition leads out."}${
      into.length ? ` Reached from ${named(into, (edge) => edge.fromStatusId)}.` : " No transition leads here."
    }`;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number, id: string) => {
    // A key pressed on a node focused by a pointer makes it keyboard focus.
    if (!focus?.visible) setFocus({ id, visible: true });
    const last = plan.statusIds.length - 1;
    const target =
      event.key === "ArrowDown"
        ? Math.min(index + 1, last)
        : event.key === "ArrowUp"
          ? Math.max(index - 1, 0)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (target === null) return;
    // Inside the reader's focusable body these keys would scroll it (§4.28).
    event.preventDefault();
    nodes.current[target]?.focus();
  };

  return (
    <div className="workflow-diagram" ref={measure}>
      {layout === null ? (
        // Before the width is read: the height the diagram will take at any
        // width, so nothing below it moves when it is drawn.
        <div className="workflow-diagram-block" style={{ height: diagramHeight(plan.statusIds.length) }} />
      ) : layout.kind === "unfit" ? (
        <p className="workflows-note">
          Too many transitions to draw at this width; the Transitions list below has all of them.
        </p>
      ) : layout.kind === "drawn" ? (
        <>
          <div
            aria-label={`Diagram of ${name}`}
            className="workflow-diagram-block"
            role="group"
            style={{ width: layout.width, height: layout.height }}
          >
            {/* The picture alone is hidden from assistive technology; the
                nodes and their descriptions say what it shows. Colours come
                from classes on tokens, and the dimmed rest is one group so
                overlapping stubs fade together. */}
            <svg aria-hidden="true" className="workflow-diagram-edges" height={layout.height} width={layout.width}>
              {[false, true].map((lit) => (
                <g
                  className={lit ? "workflow-diagram-lit" : `workflow-diagram-rest${active ? " is-dimmed" : ""}`}
                  key={lit ? "lit" : "rest"}
                >
                  {layout.edges
                    .filter((edge) => touches(edge, active) === lit)
                    .map((edge) => (
                      <path className={`workflow-diagram-line${edge.hidden ? " is-hidden" : ""}`} d={edge.path} key={edge.id} />
                    ))}
                  {layout.arrows
                    .filter((arrow) => layout.edges.some((edge) => arrow.edgeIds.includes(edge.id) && touches(edge, active)) === lit)
                    .map((arrow) => (
                      <path className="workflow-diagram-arrow" d={arrow.path} key={arrow.key} />
                    ))}
                </g>
              ))}
            </svg>
            {layout.nodes.map((node, index) => {
              const status = statuses[index];
              const text = label(status.statusKey);
              const far = active !== null && node.id !== active && !neighbours.has(node.id);
              return (
                <button
                  aria-describedby={`${descriptionIds}-${index}`}
                  aria-pressed={pin === node.id}
                  className={`workflow-diagram-node${node.id === active ? " is-active" : ""}${far ? " is-far" : ""}`}
                  key={node.id}
                  onBlur={() => setFocus(null)}
                  onClick={() => setPinned((current) => (current === node.id ? null : node.id))}
                  onFocus={(event) => setFocus({ id: node.id, visible: event.currentTarget.matches(":focus-visible") })}
                  onKeyDown={(event) => onKeyDown(event, index, node.id)}
                  onPointerEnter={(event) => {
                    if (event.pointerType === "mouse") setHovered(node.id);
                  }}
                  onPointerLeave={(event) => {
                    if (event.pointerType === "mouse") setHovered((current) => (current === node.id ? null : current));
                  }}
                  ref={(element) => {
                    nodes.current[index] = element;
                  }}
                  style={{ top: node.top, left: layout.nodeLeft, width: layout.nodeWidth }}
                  tabIndex={node.id === stop ? 0 : -1}
                  title={text}
                  type="button"
                >
                  <CategoryDot category={status.category} />
                  <span className="workflow-diagram-node-name">{text}</span>
                </button>
              );
            })}
            {layout.nodes.map((node, index) => (
              <span className="visually-hidden" id={`${descriptionIds}-${index}`} key={node.id}>
                {describe(node.id)}
              </span>
            ))}
          </div>
          {layout.edges.some((edge) => edge.hidden) ? (
            // The key to a shape, not a fact: the descriptions say "(hidden)".
            <p aria-hidden="true" className="workflows-note">
              Dashed arrows are hidden transitions.
            </p>
          ) : null}
          {layout.notDrawn ? <NotDrawnLine count={layout.notDrawn} /> : null}
        </>
      ) : null}
    </div>
  );
}

/** The transitions the diagram leaves out because one end is a status the workflow does not list (§4.28). */
function NotDrawnLine({ count }: { count: number }) {
  return (
    <p className="workflows-note">
      {count === 1
        ? "1 transition is not drawn: it joins a status this workflow does not list."
        : `${count} transitions are not drawn: they join a status this workflow does not list.`}
    </p>
  );
}
