/**
 * The geometry of a workflow's transition diagram (DESIGN.md §4.28 "Схема
 * переходов", TAS-382): a pure function of the statuses in column order, the
 * transitions, and the width the card has — no DOM, so every rule below is
 * tested by itself and the same data always draws the same picture.
 *
 * The statuses stand in one column, top to bottom. A transition to a later
 * column runs down the right side, one to an earlier column up the left; each
 * is an orthogonal bracket — a stub out of the node, a vertical on its own
 * lane, a stub into the target — with corners of radius 4.
 *
 * Planning (sides, lanes, ports) does not depend on the width, so it is done
 * once per answer (`planWorkflowDiagram`); fitting turns a plan and a measured
 * width into coordinates, or into "does not fit" (`fitWorkflowDiagram`). There
 * is no scaling and no horizontal scroll: a diagram that does not fit at the
 * narrower lane step is not drawn at all, and the card says so (§4.28).
 */

/** One transition as the diagram needs it: a list row's ids and its hidden flag. */
export interface DiagramTransition {
  id: string;
  fromStatusId: string;
  toStatusId: string;
  hidden: boolean;
}

/** Which side of the column a transition runs on: forward on the right, backward on the left. */
export type DiagramSide = "left" | "right";

/** §2.7: a node is 28 high and the next one starts 44 below it. */
export const DIAGRAM_NODE_HEIGHT = 28;
export const DIAGRAM_NODE_PITCH = 44;
/** The two node widths, and the diagram width from which the wider one is used (414 → 160, 294 → 128). */
export const DIAGRAM_NODE_WIDE = 160;
export const DIAGRAM_NODE_NARROW = 128;
const WIDE_FROM = 360;
/** Two ports per side, this far above and below the node's centre. */
const PORT_OFFSET = 6;
/** The first lane's distance from the node's frame, and the steps tried for the rest, in order. */
const FIRST_LANE = 16;
const LANE_STEPS = [8, 6] as const;
/** What a side with lanes adds past its outermost lane: 16 + 2 = 18 for a side with one. */
const SIDE_MARGIN = 2;
/** No two verticals on one lane come closer than this to each other's [port, port] span. */
const LANE_CLEARANCE = 4;
/** The arrow's tip, and the start of an outgoing stub, this far from the frame — clear of §7's 2 + 2 ring. */
const ARROW_GAP = 5;
/** A filled 6×6 triangle. */
const ARROW_SIZE = 6;
const CORNER = 4;

export type LaneStep = (typeof LANE_STEPS)[number];

/** A transition the diagram draws, placed on its side and lane — the part of the layout the width does not change. */
export interface PlannedEdge {
  id: string;
  fromStatusId: string;
  toStatusId: string;
  hidden: boolean;
  side: DiagramSide;
  /** 0 is the lane nearest the node. */
  lane: number;
  /** The y of the port it leaves and of the port it enters, from the diagram's top. */
  fromY: number;
  toY: number;
}

export interface DiagramPlan {
  /** The statuses in column order, as given. */
  statusIds: string[];
  /** Every drawable transition, in the order given, each on its lane. */
  edges: PlannedEdge[];
  /** How many lanes each side needs. */
  lanes: Record<DiagramSide, number>;
  /**
   * Transitions joining a status the workflow does not list: not drawn, and
   * counted so the card can say so. A transition from a status to itself —
   * which the server refuses — is neither drawn nor counted.
   */
  notDrawn: number;
}

/** A drawn edge: its plan and the one SVG path of its bracket. */
export interface DiagramEdge extends PlannedEdge {
  path: string;
}

/**
 * One arrowhead per port that is entered: every edge into the same port of the
 * same node shares it, as they share the stub it sits on (§4.28).
 */
export interface DiagramArrow {
  key: string;
  path: string;
  edgeIds: string[];
}

export interface DiagramNode {
  id: string;
  top: number;
}

export interface DrawnDiagram {
  kind: "drawn";
  /** The block's size: left lanes + node + right lanes, and `n·44 − 16`. */
  width: number;
  height: number;
  nodeWidth: number;
  /** The x of every node's left edge. */
  nodeLeft: number;
  step: LaneStep;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  arrows: DiagramArrow[];
  notDrawn: number;
}

/**
 * What a card draws: the diagram; nothing, when no transition can be drawn;
 * or "does not fit", when it is too wide for the card at either lane step.
 */
export type WorkflowDiagramLayout = DrawnDiagram | { kind: "empty"; notDrawn: number } | { kind: "unfit"; notDrawn: number };

/** The height a diagram of `count` statuses takes, whatever the width — reserved before the width is known. */
export function diagramHeight(count: number): number {
  return count > 0 ? count * DIAGRAM_NODE_PITCH - (DIAGRAM_NODE_PITCH - DIAGRAM_NODE_HEIGHT) : 0;
}

/** The node width for a diagram this wide (§4.28: 160 from 360, else 128). */
export function diagramNodeWidth(width: number): number {
  return width >= WIDE_FROM ? DIAGRAM_NODE_WIDE : DIAGRAM_NODE_NARROW;
}

/** How wide one side is with `lanes` lanes at `step`: `L ? 18 + step·(L−1) : 0`. */
export function diagramSideWidth(lanes: number, step: number): number {
  return lanes ? FIRST_LANE + SIDE_MARGIN + step * (lanes - 1) : 0;
}

const centreY = (index: number) => index * DIAGRAM_NODE_PITCH + DIAGRAM_NODE_HEIGHT / 2;

/**
 * Sides, ports and lanes for a workflow (§4.28 "Порты и стрелки", "Дорожки").
 *
 * A forward transition leaves its source by the lower right port and enters
 * its target by the upper right one; a backward one leaves by the upper left
 * port and enters by the lower left. So every port carries one direction, and
 * edges through one port share its stub and its arrow.
 *
 * Lanes are given side by side: shortest span first, then the higher top, then
 * the order given; each edge takes the lowest lane where no edge already there
 * comes within 4 of its [port, port] span. Shorter first is what puts an edge
 * that spans another always outside it — its span holds the other's, so it
 * meets every edge the other met and the other as well. Crossings are left only
 * between partly overlapping pairs, and are always a stub across a vertical.
 */
export function planWorkflowDiagram(statusIds: readonly string[], transitions: readonly DiagramTransition[]): DiagramPlan {
  const column = new Map(statusIds.map((id, index) => [id, index]));
  let notDrawn = 0;
  const placed: (PlannedEdge & { order: number; span: number; top: number; bottom: number })[] = [];
  transitions.forEach((transition, order) => {
    if (transition.fromStatusId === transition.toStatusId) return;
    const from = column.get(transition.fromStatusId);
    const to = column.get(transition.toStatusId);
    if (from === undefined || to === undefined) {
      notDrawn += 1;
      return;
    }
    const forward = to > from;
    const fromY = centreY(from) + (forward ? PORT_OFFSET : -PORT_OFFSET);
    const toY = centreY(to) + (forward ? -PORT_OFFSET : PORT_OFFSET);
    placed.push({
      id: transition.id,
      fromStatusId: transition.fromStatusId,
      toStatusId: transition.toStatusId,
      hidden: transition.hidden,
      side: forward ? "right" : "left",
      lane: 0,
      fromY,
      toY,
      order,
      span: Math.abs(to - from),
      top: Math.min(fromY, toY),
      bottom: Math.max(fromY, toY),
    });
  });

  const lanes: Record<DiagramSide, number> = { left: 0, right: 0 };
  for (const side of ["left", "right"] as const) {
    const queue = placed
      .filter((edge) => edge.side === side)
      .sort((a, b) => a.span - b.span || a.top - b.top || a.order - b.order);
    const occupied: (typeof placed)[] = [];
    for (const edge of queue) {
      const clear = (lane: typeof placed) =>
        lane.every((other) => edge.bottom + LANE_CLEARANCE <= other.top || other.bottom + LANE_CLEARANCE <= edge.top);
      let lane = 0;
      while (occupied[lane] && !clear(occupied[lane])) lane += 1;
      (occupied[lane] ??= []).push(edge);
      edge.lane = lane;
    }
    lanes[side] = occupied.length;
  }

  return {
    statusIds: [...statusIds],
    edges: placed.map(({ id, fromStatusId, toStatusId, hidden, side, lane, fromY, toY }) => ({
      id,
      fromStatusId,
      toStatusId,
      hidden,
      side,
      lane,
      fromY,
      toY,
    })),
    lanes,
    notDrawn,
  };
}

/**
 * A plan at a measured width (§4.28 "Ширина"): the node width the width
 * allows, then lane step 8, then 6, and "unfit" when neither leaves the block
 * within the width. Coordinates are whole pixels from the block's top left.
 */
export function fitWorkflowDiagram(plan: DiagramPlan, width: number): WorkflowDiagramLayout {
  if (!plan.edges.length) return { kind: "empty", notDrawn: plan.notDrawn };
  const nodeWidth = diagramNodeWidth(width);
  for (const step of LANE_STEPS) {
    const left = diagramSideWidth(plan.lanes.left, step);
    const right = diagramSideWidth(plan.lanes.right, step);
    const blockWidth = left + nodeWidth + right;
    if (blockWidth > width) continue;
    return {
      kind: "drawn",
      width: blockWidth,
      height: diagramHeight(plan.statusIds.length),
      nodeWidth,
      nodeLeft: left,
      step,
      nodes: plan.statusIds.map((id, index) => ({ id, top: index * DIAGRAM_NODE_PITCH })),
      edges: plan.edges.map((edge) => ({ ...edge, path: bracketPath(edge, left, nodeWidth, step) })),
      arrows: arrowsOf(plan.edges, left, nodeWidth),
      notDrawn: plan.notDrawn,
    };
  }
  return { kind: "unfit", notDrawn: plan.notDrawn };
}

/** The x of the node frame on this side, and which way is outward from it. */
function frameOf(side: DiagramSide, nodeLeft: number, nodeWidth: number) {
  return side === "right" ? { frame: nodeLeft + nodeWidth, out: 1 } : { frame: nodeLeft, out: -1 };
}

/**
 * The bracket: out of the source's port from 5 past the frame, along to the
 * lane, down or up it, and back in to the arrow's base, 11 past the target's
 * frame. Each corner is a quarter circle of radius 4, and every one of them
 * turns clockwise on screen (right then down, down then left; left then up,
 * up then right), so every arc has sweep 1.
 */
function bracketPath(edge: PlannedEdge, nodeLeft: number, nodeWidth: number, step: number): string {
  const { frame, out } = frameOf(edge.side, nodeLeft, nodeWidth);
  const lane = frame + out * (FIRST_LANE + step * edge.lane);
  const flow = edge.toY > edge.fromY ? 1 : -1;
  const arc = (x: number, y: number) => `A${CORNER} ${CORNER} 0 0 1 ${x} ${y}`;
  return [
    `M${frame + out * ARROW_GAP} ${edge.fromY}`,
    `H${lane - out * CORNER}`,
    arc(lane, edge.fromY + flow * CORNER),
    `V${edge.toY - flow * CORNER}`,
    arc(lane - out * CORNER, edge.toY),
    `H${frame + out * (ARROW_GAP + ARROW_SIZE)}`,
  ].join(" ");
}

/** One filled triangle per entered port, its tip 5 from the frame and pointing at it. */
function arrowsOf(edges: readonly PlannedEdge[], nodeLeft: number, nodeWidth: number): DiagramArrow[] {
  const byPort = new Map<string, DiagramArrow>();
  for (const edge of edges) {
    const key = `${edge.toStatusId}:${edge.side}`;
    const known = byPort.get(key);
    if (known) {
      known.edgeIds.push(edge.id);
      continue;
    }
    const { frame, out } = frameOf(edge.side, nodeLeft, nodeWidth);
    const tip = frame + out * ARROW_GAP;
    const base = tip + out * ARROW_SIZE;
    const half = ARROW_SIZE / 2;
    byPort.set(key, {
      key,
      path: `M${tip} ${edge.toY} L${base} ${edge.toY - half} L${base} ${edge.toY + half} Z`,
      edgeIds: [edge.id],
    });
  }
  return [...byPort.values()];
}
