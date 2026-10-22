import { describe, expect, it } from "vitest";
import {
  DIAGRAM_NODE_NARROW,
  DIAGRAM_NODE_WIDE,
  diagramHeight,
  diagramSideWidth,
  fitWorkflowDiagram,
  planWorkflowDiagram,
  type DiagramTransition,
  type DrawnDiagram,
  type PlannedEdge,
} from "./workflowDiagram";

/**
 * The geometry of §4.28's diagram (TAS-382), with no DOM: sides, ports, lanes,
 * the fit at a measured width, and the path data. The card's inner width is
 * 414 at 1440, 294 at 390 and 279 at 375 (§4.28).
 */

const ids = (count: number) => Array.from({ length: count }, (_, index) => `s${index}`);

const move = (from: string, to: string, hidden = false): DiagramTransition => ({
  id: `${from}>${to}`,
  fromStatusId: from,
  toStatusId: to,
  hidden,
});

/** Every ordered pair of distinct statuses: the most lanes a workflow of this size can need. */
function complete(count: number) {
  const statusIds = ids(count);
  return {
    statusIds,
    transitions: statusIds.flatMap((from) => statusIds.filter((to) => to !== from).map((to) => move(from, to))),
  };
}

/** A workflow as a team would build it: a line forward, a few ways back, one hidden. */
const realistic = {
  statusIds: ids(6),
  transitions: [
    move("s0", "s1"),
    move("s1", "s2"),
    move("s2", "s3"),
    move("s3", "s4"),
    move("s4", "s5"),
    move("s2", "s1"),
    move("s3", "s1"),
    move("s1", "s0"),
    move("s5", "s0", true),
    move("s0", "s5"),
    move("s4", "s3"),
  ],
};

const drawn = (layout: ReturnType<typeof fitWorkflowDiagram>): DrawnDiagram => {
  if (layout.kind !== "drawn") throw new Error(`expected a drawn diagram, got ${layout.kind}`);
  return layout;
};

const centre = (statusIds: string[], id: string) => statusIds.indexOf(id) * 44 + 14;

/** The node interval an edge covers, top index first. */
const reach = (statusIds: string[], edge: PlannedEdge) => {
  const [a, b] = [statusIds.indexOf(edge.fromStatusId), statusIds.indexOf(edge.toStatusId)];
  return [Math.min(a, b), Math.max(a, b)] as const;
};

describe("the plan of a workflow diagram (§4.28)", () => {
  it("is the same for the same input, and does not depend on the order the transitions come in", () => {
    const { statusIds, transitions } = complete(6);
    const lanesOf = (plan: ReturnType<typeof planWorkflowDiagram>) =>
      Object.fromEntries(plan.edges.map((edge) => [edge.id, `${edge.side}:${edge.lane}`]));

    expect(planWorkflowDiagram(statusIds, transitions)).toEqual(planWorkflowDiagram(statusIds, transitions));
    expect(lanesOf(planWorkflowDiagram(statusIds, [...transitions].reverse()))).toEqual(
      lanesOf(planWorkflowDiagram(statusIds, transitions)),
    );
  });

  it("runs a forward transition down the right and a backward one up the left", () => {
    const plan = planWorkflowDiagram(realistic.statusIds, realistic.transitions);
    for (const edge of plan.edges) {
      const [from, to] = [plan.statusIds.indexOf(edge.fromStatusId), plan.statusIds.indexOf(edge.toStatusId)];
      expect(edge.side, edge.id).toBe(to > from ? "right" : "left");
      // Down on the right, up on the left.
      expect(Math.sign(edge.toY - edge.fromY), edge.id).toBe(edge.side === "right" ? 1 : -1);
    }
  });

  it("leaves and enters by one port per direction on each side, ±6 from the node's centre", () => {
    const plan = planWorkflowDiagram(realistic.statusIds, realistic.transitions);
    for (const edge of plan.edges) {
      const [from, to] = [centre(plan.statusIds, edge.fromStatusId), centre(plan.statusIds, edge.toStatusId)];
      if (edge.side === "right") expect([edge.fromY, edge.toY], edge.id).toEqual([from + 6, to - 6]);
      else expect([edge.fromY, edge.toY], edge.id).toEqual([from - 6, to + 6]);
    }
  });

  for (const [name, graph] of [
    ["complete 6", complete(6)],
    ["complete 7", complete(7)],
    ["realistic", realistic],
  ] as const) {
    it(`puts an edge that spans another always on an outer lane than it — ${name}`, () => {
      const plan = planWorkflowDiagram(graph.statusIds, graph.transitions);
      for (const outer of plan.edges) {
        for (const inner of plan.edges) {
          if (outer === inner || outer.side !== inner.side) continue;
          const [[outerTop, outerBottom], [innerTop, innerBottom]] = [reach(plan.statusIds, outer), reach(plan.statusIds, inner)];
          const spans = outerTop <= innerTop && innerBottom <= outerBottom && outerBottom - outerTop > innerBottom - innerTop;
          if (spans) expect(outer.lane, `${outer.id} spans ${inner.id}`).toBeGreaterThan(inner.lane);
        }
      }
    });
  }

  it("never puts two edges on one lane closer than 4 to each other's span", () => {
    const plan = planWorkflowDiagram(complete(7).statusIds, complete(7).transitions);
    for (const a of plan.edges) {
      for (const b of plan.edges) {
        if (a === b || a.side !== b.side || a.lane !== b.lane) continue;
        const [aTop, aBottom] = [Math.min(a.fromY, a.toY), Math.max(a.fromY, a.toY)];
        const [bTop, bBottom] = [Math.min(b.fromY, b.toY), Math.max(b.fromY, b.toY)];
        expect(aBottom + 4 <= bTop || bBottom + 4 <= aTop, `${a.id} and ${b.id} on lane ${a.lane}`).toBe(true);
      }
    }
  });

  it("counts a transition to a status the workflow does not list as not drawn, and ignores one to itself", () => {
    const plan = planWorkflowDiagram(ids(3), [
      move("s0", "s1"),
      move("s0", "gone"),
      move("gone", "s2"),
      move("s1", "s1"),
      move("lost", "lost"),
    ]);
    expect(plan.edges.map((edge) => edge.id)).toEqual(["s0>s1"]);
    expect(plan.notDrawn).toBe(2);
  });
});

describe("the fit at a measured width (§4.28 \"Ширина\")", () => {
  const fit = (count: number, width: number) => {
    const { statusIds, transitions } = complete(count);
    return fitWorkflowDiagram(planWorkflowDiagram(statusIds, transitions), width);
  };

  it("draws a complete graph of up to six statuses at 294 with lanes 8 apart", () => {
    for (const count of [2, 3, 4, 5, 6]) {
      const layout = drawn(fit(count, 294));
      expect(layout.step, `${count} statuses`).toBe(8);
      expect(layout.width).toBeLessThanOrEqual(294);
    }
    // At 375's 279, six need the narrower step.
    expect(drawn(fit(6, 279)).step).toBe(6);
  });

  it("does not draw a complete graph of seven at 294 or 279: twelve lanes a side are 296 at step 6", () => {
    // §4.28's reference says seven fit 294 at step 6. Twelve lanes are the
    // fewest seven statuses can have — twelve transitions pass between the
    // third and the fourth node on each side — and §4.28's own formula makes
    // that 18 + 6·11 = 84 a side, 84 + 128 + 84 = 296. It fitted the card's
    // earlier 296; at 294 the line stands in for it.
    const { statusIds, transitions } = complete(7);
    expect(planWorkflowDiagram(statusIds, transitions).lanes).toEqual({ left: 12, right: 12 });
    expect(fit(7, 294).kind).toBe("unfit");
    expect(fit(7, 279).kind).toBe("unfit");
    expect(drawn(fit(7, 296))).toMatchObject({ step: 6, width: 296 });
    expect(drawn(fit(7, 414))).toMatchObject({ step: 8, width: 372 });
  });

  it("draws a complete graph of up to eight at 414 with lanes 6 apart, and not nine", () => {
    expect(drawn(fit(8, 414))).toMatchObject({ step: 6, nodeWidth: DIAGRAM_NODE_WIDE });
    expect(fit(9, 414).kind).toBe("unfit");
  });

  it("takes the 160 node from a width of 360 and the 128 node below it", () => {
    expect(drawn(fit(3, 414)).nodeWidth).toBe(DIAGRAM_NODE_WIDE);
    expect(drawn(fit(3, 360)).nodeWidth).toBe(DIAGRAM_NODE_WIDE);
    expect(drawn(fit(3, 359)).nodeWidth).toBe(DIAGRAM_NODE_NARROW);
    expect(drawn(fit(3, 294)).nodeWidth).toBe(DIAGRAM_NODE_NARROW);
  });

  it("sizes the block as left lanes + node + right lanes, and n·44 − 16 high whatever the width", () => {
    const { statusIds, transitions } = complete(4);
    const plan = planWorkflowDiagram(statusIds, transitions);
    for (const width of [414, 294]) {
      const layout = drawn(fitWorkflowDiagram(plan, width));
      const [left, right] = [diagramSideWidth(plan.lanes.left, layout.step), diagramSideWidth(plan.lanes.right, layout.step)];
      expect(layout.width).toBe(left + layout.nodeWidth + right);
      expect(layout.nodeLeft).toBe(left);
      expect(layout.height).toBe(4 * 44 - 16);
      expect(layout.nodes.map((node) => node.top)).toEqual([0, 44, 88, 132]);
    }
    expect(diagramHeight(4)).toBe(160);
    expect(diagramSideWidth(0, 8)).toBe(0);
    expect(diagramSideWidth(1, 8)).toBe(18);
    expect(diagramSideWidth(3, 6)).toBe(30);
  });

  it("has nothing to draw when no transition joins two listed statuses, and says how many it left out", () => {
    const plan = planWorkflowDiagram(ids(2), [move("s0", "gone")]);
    expect(fitWorkflowDiagram(plan, 414)).toEqual({ kind: "empty", notDrawn: 1 });
  });
});

describe("the paths (§4.28 \"Порты и стрелки\")", () => {
  it("draws a forward bracket from 5 past the frame to lane 16, with radius-4 corners, into an arrow tipped 5 from the target", () => {
    // Node 128 at x 0…128; one lane on the right, at 144.
    const layout = drawn(fitWorkflowDiagram(planWorkflowDiagram(ids(2), [move("s0", "s1")]), 294));
    expect(layout).toMatchObject({ width: 146, nodeLeft: 0 });
    expect(layout.edges[0].path).toBe("M133 20 H140 A4 4 0 0 1 144 24 V48 A4 4 0 0 1 140 52 H139");
    expect(layout.arrows).toEqual([{ key: "s1:right", path: "M133 52 L139 49 L139 55 Z", edgeIds: ["s0>s1"] }]);
  });

  it("draws a backward bracket up the left the same way, mirrored", () => {
    // One lane on the left: the node starts at 18, the lane is at 2.
    const layout = drawn(fitWorkflowDiagram(planWorkflowDiagram(ids(2), [move("s1", "s0")]), 294));
    expect(layout).toMatchObject({ width: 146, nodeLeft: 18 });
    expect(layout.edges[0].path).toBe("M13 52 H6 A4 4 0 0 1 2 48 V24 A4 4 0 0 1 6 20 H7");
    expect(layout.arrows[0].path).toBe("M13 20 L7 17 L7 23 Z");
  });

  it("gives every entered port one arrow, shared by the edges that enter it", () => {
    const layout = drawn(
      fitWorkflowDiagram(planWorkflowDiagram(ids(3), [move("s0", "s2"), move("s1", "s2"), move("s2", "s0"), move("s1", "s0")]), 414),
    );
    expect(layout.arrows.map((arrow) => [arrow.key, arrow.edgeIds])).toEqual([
      ["s2:right", ["s0>s2", "s1>s2"]],
      ["s0:left", ["s2>s0", "s1>s0"]],
    ]);
  });

  it("puts the next lane 8 out at step 8 and 6 out at step 6", () => {
    // Two edges overlapping on the right: lanes 0 and 1.
    const plan = planWorkflowDiagram(ids(3), [move("s0", "s1"), move("s0", "s2")]);
    const laneX = (layout: DrawnDiagram, id: string) => {
      const match = /A4 4 0 0 1 (\d+) /.exec(layout.edges.find((edge) => edge.id === id)?.path ?? "");
      return Number(match?.[1]);
    };
    const wide = drawn(fitWorkflowDiagram(plan, 414));
    expect([laneX(wide, "s0>s1"), laneX(wide, "s0>s2")]).toEqual([160 + 16, 160 + 24]);
    // 128 + 18 + 6 fits 152 only at step 6.
    const tight = drawn(fitWorkflowDiagram(plan, 152));
    expect(tight.step).toBe(6);
    expect([laneX(tight, "s0>s1"), laneX(tight, "s0>s2")]).toEqual([128 + 16, 128 + 22]);
  });
});
