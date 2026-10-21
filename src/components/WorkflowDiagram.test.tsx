import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowDefinition, WorkflowDefinitionTransition, WorkflowStatus } from "../domain/types";
import { WorkflowDiagram } from "./WorkflowDiagram";

/**
 * The diagram of a workflow's transitions (TAS-382, DESIGN.md §4.28). jsdom
 * lays nothing out, so the card's width is what these tests say it is: the
 * wrapper's `getBoundingClientRect` answers `width`, and `ResizeObserver` is a
 * fake that reports a new one when `resize` is called. The geometry itself is
 * pinned in `src/lib/workflowDiagram.test.ts`; what is pinned here is what the
 * reader gets — the nodes, the keyboard, the pin, the words, the states.
 */

let width = 414;
const observers = new Set<() => void>();

beforeEach(() => {
  width = 414;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const measured = this.classList.contains("workflow-diagram") ? width : 0;
    return { width: measured, height: 0, top: 0, left: 0, right: measured, bottom: 0, x: 0, y: 0, toJSON: () => ({}) };
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      callback: () => void;
      constructor(callback: () => void) {
        this.callback = callback;
      }
      observe() {
        observers.add(this.callback);
      }
      unobserve() {}
      disconnect() {
        observers.delete(this.callback);
      }
    },
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  observers.clear();
});

const resize = (next: number) =>
  act(() => {
    width = next;
    observers.forEach((callback) => callback());
  });

const status = (id: string, statusKey: string, name: string, category: string, sortOrder: number): WorkflowStatus => ({
  id,
  statusKey,
  name,
  category,
  sortOrder,
});

const move = (id: string, fromStatusId: string, toStatusId: string, hidden = false): WorkflowDefinitionTransition => ({
  id,
  fromStatusId,
  toStatusId,
  name: "",
  sortOrder: 10,
  hidden,
});

/** Four columns — Review sorts between In Progress and Done — and one hidden way back. */
const statuses = [
  status("s-todo", "TODO", "To Do", "TODO", 10),
  status("s-done", "DONE", "Done", "DONE", 30),
  status("s-progress", "IN_PROGRESS", "In Progress", "IN_PROGRESS", 20),
  status("s-review", "REVIEW", "Review", "QA", 25),
];

const transitions = [
  move("t1", "s-todo", "s-progress"),
  move("t2", "s-progress", "s-review"),
  move("t3", "s-review", "s-done"),
  move("t4", "s-review", "s-progress"),
  move("t5", "s-done", "s-todo", true),
];

const workflowOf = (overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition => ({
  id: "wf",
  name: "Development",
  version: 1,
  createdAt: "",
  updatedAt: "",
  statuses,
  transitions,
  ...overrides,
});

function renderDiagram(workflow = workflowOf()) {
  const view = render(<WorkflowDiagram name={workflow.name} workflow={workflow} />);
  return { ...view, rerenderWith: (next: WorkflowDefinition) => view.rerender(<WorkflowDiagram name={next.name} workflow={next} />) };
}

const group = () => screen.getByRole("group", { name: "Diagram of Development" });
const node = (name: string) => within(group()).getByRole("button", { name });
const nodeNames = () => within(group()).getAllByRole("button").map((button) => button.textContent);
const tabStops = () => within(group()).getAllByRole("button").filter((button) => button.tabIndex === 0);

describe("the diagram's nodes and words", () => {
  it("draws one node per status in column order, the picture hidden and nothing focusable inside it", () => {
    renderDiagram();

    expect(nodeNames()).toEqual(["To Do", "In Progress", "Review", "Done"]);
    const svg = group().querySelector("svg") as SVGSVGElement;
    expect(svg).toHaveAttribute("aria-hidden", "true");
    // B1/B2: no marker, no colour written on the picture, nothing to focus in it.
    expect(svg.querySelector("marker, [tabindex], a, button")).toBeNull();
    for (const element of svg.querySelectorAll("*")) {
      expect(element.getAttribute("fill"), element.outerHTML).toBeNull();
      expect(element.getAttribute("stroke"), element.outerHTML).toBeNull();
      expect(element.getAttribute("style"), element.outerHTML).toBeNull();
    }
    // Five transitions, each into a port no other one enters: five arrows.
    expect(svg.querySelectorAll(".workflow-diagram-line")).toHaveLength(5);
    expect(svg.querySelectorAll(".workflow-diagram-line.is-hidden")).toHaveLength(1);
    expect(svg.querySelectorAll(".workflow-diagram-arrow")).toHaveLength(5);
  });

  it("describes each node by where it leads and where it is reached from, hidden ones marked", () => {
    renderDiagram();

    expect(node("To Do")).toHaveAccessibleDescription("Leads to In Progress. Reached from Done (hidden).");
    expect(node("In Progress")).toHaveAccessibleDescription("Leads to Review. Reached from To Do and Review.");
    expect(node("Review")).toHaveAccessibleDescription("Leads to In Progress and Done. Reached from In Progress.");
    expect(node("Done")).toHaveAccessibleDescription("Leads to To Do (hidden). Reached from Review.");
  });

  it("says when nothing leads out of or into a status", () => {
    renderDiagram(workflowOf({ transitions: [move("t1", "s-todo", "s-done")] }));

    expect(node("To Do")).toHaveAccessibleDescription("Leads to Done. No transition leads here.");
    expect(node("In Progress")).toHaveAccessibleDescription("No transition leads out. No transition leads here.");
    expect(node("Done")).toHaveAccessibleDescription("No transition leads out. Reached from To Do.");
  });

  it("keys the dashes under the picture, hidden from assistive technology, only when one is drawn", () => {
    const { rerenderWith } = renderDiagram();
    const legend = screen.getByText("Dashed arrows are hidden transitions.");
    expect(legend).toHaveAttribute("aria-hidden", "true");

    rerenderWith(workflowOf({ transitions: transitions.filter((transition) => !transition.hidden) }));
    expect(screen.queryByText("Dashed arrows are hidden transitions.")).toBeNull();
  });

  it("names the node by its status's label with the full name in its title, and prints no key or category", () => {
    renderDiagram();
    expect(node("Review")).toHaveAttribute("title", "Review");
    expect(group()).not.toHaveTextContent("REVIEW");
    expect(group()).not.toHaveTextContent("QA");
  });
});

describe("the keyboard and the pin", () => {
  it("is one Tab stop — the first node — and ↑/↓/Home/End move along it without wrapping", () => {
    renderDiagram();
    expect(tabStops()).toEqual([node("To Do")]);

    node("To Do").focus();
    // Default prevented: inside the reader's focusable body these would scroll it.
    expect(fireEvent.keyDown(node("To Do"), { key: "ArrowDown" })).toBe(false);
    expect(node("In Progress")).toHaveFocus();
    expect(tabStops()).toEqual([node("In Progress")]);

    fireEvent.keyDown(node("In Progress"), { key: "End" });
    expect(node("Done")).toHaveFocus();
    fireEvent.keyDown(node("Done"), { key: "ArrowDown" });
    expect(node("Done")).toHaveFocus();
    fireEvent.keyDown(node("Done"), { key: "Home" });
    expect(node("To Do")).toHaveFocus();
    fireEvent.keyDown(node("To Do"), { key: "ArrowUp" });
    expect(node("To Do")).toHaveFocus();

    // Esc and the rest are not the diagram's.
    expect(fireEvent.keyDown(node("To Do"), { key: "Escape" })).toBe(true);
    expect(fireEvent.keyDown(node("To Do"), { key: "ArrowRight" })).toBe(true);
  });

  it("pins a node on a press, unpins it on the next, moves the pin on another, and makes the pinned one the Tab stop", () => {
    renderDiagram();
    const pressed = () => within(group()).getAllByRole("button").map((button) => button.getAttribute("aria-pressed"));
    expect(pressed()).toEqual(["false", "false", "false", "false"]);

    fireEvent.click(node("Review"));
    expect(pressed()).toEqual(["false", "false", "true", "false"]);
    fireEvent.click(node("Done"));
    expect(pressed()).toEqual(["false", "false", "false", "true"]);
    fireEvent.click(node("Done"));
    expect(pressed()).toEqual(["false", "false", "false", "false"]);

    fireEvent.click(node("Review"));
    act(() => node("Review").blur());
    expect(tabStops()).toEqual([node("Review")]);
  });

  it("keeps the pin through a re-read while its status is listed, and drops it when it is not", () => {
    const { rerenderWith } = renderDiagram();
    fireEvent.click(node("Review"));

    rerenderWith(workflowOf({ statuses: [...statuses] }));
    expect(node("Review")).toHaveAttribute("aria-pressed", "true");

    rerenderWith(
      workflowOf({
        statuses: statuses.filter((item) => item.id !== "s-review"),
        transitions: [move("t1", "s-todo", "s-progress")],
      }),
    );
    expect(within(group()).getAllByRole("button").map((button) => button.getAttribute("aria-pressed"))).toEqual([
      "false",
      "false",
      "false",
    ]);
  });
});

describe("the highlight", () => {
  it("lights the active node's transitions on top, dims the rest as one group, and lets unrelated statuses recede", () => {
    renderDiagram();
    const svg = group().querySelector("svg") as SVGSVGElement;
    const rest = svg.querySelector(".workflow-diagram-rest") as SVGGElement;
    const lit = svg.querySelector(".workflow-diagram-lit") as SVGGElement;
    expect(rest).not.toHaveClass("is-dimmed");
    expect(lit.children).toHaveLength(0);

    fireEvent.click(node("To Do"));
    // To Do → In Progress, and Done → To Do (hidden): two lines and their two arrows.
    expect(lit.querySelectorAll(".workflow-diagram-line")).toHaveLength(2);
    expect(lit.querySelectorAll(".workflow-diagram-arrow")).toHaveLength(2);
    expect(rest).toHaveClass("is-dimmed");
    expect(rest.querySelectorAll(".workflow-diagram-line")).toHaveLength(3);
    // The group, never a path, carries the dimming.
    expect(svg.querySelectorAll("path.is-dimmed, path[opacity]")).toHaveLength(0);
    // Lit drawn after the rest, so on top.
    expect(svg.lastElementChild).toBe(lit);

    expect(node("To Do")).toHaveClass("is-active");
    expect(node("Review")).toHaveClass("is-far");
    for (const neighbour of ["In Progress", "Done"]) {
      expect(node(neighbour)).not.toHaveClass("is-far");
      expect(node(neighbour)).not.toHaveClass("is-active");
    }
  });

  it("follows the mouse over a node ahead of the pin, and ignores a touch's pointer", () => {
    renderDiagram();
    fireEvent.click(node("To Do"));

    fireEvent.pointerEnter(node("Review"), { pointerType: "touch" });
    expect(node("To Do")).toHaveClass("is-active");

    fireEvent.pointerEnter(node("Review"), { pointerType: "mouse" });
    expect(node("Review")).toHaveClass("is-active");
    expect(node("To Do")).not.toHaveClass("is-active");

    fireEvent.pointerLeave(node("Review"), { pointerType: "mouse" });
    expect(node("To Do")).toHaveClass("is-active");
  });

  it("does not hold a node lit by the focus a press gave it once the press has unpinned it", () => {
    renderDiagram();
    // A pointer press: focus without :focus-visible, which jsdom never sets.
    node("Review").focus();
    fireEvent.click(node("Review"));
    expect(node("Review")).toHaveClass("is-active");
    fireEvent.click(node("Review"));
    expect(node("Review")).not.toHaveClass("is-active");
    expect(group().querySelector(".is-active, .is-far")).toBeNull();
  });

  it("lights the node keyboard focus is on", () => {
    renderDiagram();
    node("To Do").focus();
    fireEvent.keyDown(node("To Do"), { key: "ArrowDown" });
    // A key on the node is keyboard focus; the move lands on In Progress.
    fireEvent.keyDown(node("In Progress"), { key: "Shift" });
    expect(node("In Progress")).toHaveClass("is-active");
  });
});

describe("the diagram's states (§4.28 \"Состояния\")", () => {
  it("draws nothing for no status, one status, or no transition — the section lines say it", () => {
    for (const workflow of [
      workflowOf({ statuses: [], transitions: [] }),
      workflowOf({ statuses: [statuses[0]], transitions: [move("x", "s-todo", "s-gone")] }),
      workflowOf({ transitions: [] }),
    ]) {
      const { container, unmount } = render(<WorkflowDiagram name={workflow.name} workflow={workflow} />);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });

  it("counts a transition to a status the workflow does not list under the diagram, and ignores one to itself", () => {
    const { rerenderWith } = renderDiagram(
      workflowOf({ transitions: [...transitions, move("x1", "s-gone", "s-done"), move("x2", "s-done", "s-done")] }),
    );
    expect(group()).toBeVisible();
    expect(screen.getByText("1 transition is not drawn: it joins a status this workflow does not list.")).toBeVisible();

    rerenderWith(workflowOf({ transitions: [...transitions, move("x1", "s-gone", "s-done"), move("x3", "s-todo", "s-lost")] }));
    expect(screen.getByText("2 transitions are not drawn: they join a status this workflow does not list.")).toBeVisible();
  });

  it("says the count in place of the diagram when it is all there is", () => {
    renderDiagram(workflowOf({ transitions: [move("x1", "s-gone", "s-done")] }));
    expect(screen.queryByRole("group")).toBeNull();
    expect(screen.getByText("1 transition is not drawn: it joins a status this workflow does not list.")).toBeVisible();
  });

  it("stands a line in for a diagram too wide for the card, and draws it again when the card widens", () => {
    // Every pair among seven statuses: 296 wide at the narrower step.
    const seven = Array.from({ length: 7 }, (_, index) => status(`c${index}`, `S${index}`, `Step ${index}`, "IN_PROGRESS", index));
    const every = seven.flatMap((from) => seven.filter((to) => to !== from).map((to) => move(`${from.id}>${to.id}`, from.id, to.id)));
    width = 294;
    renderDiagram(workflowOf({ statuses: seven, transitions: every }));

    expect(screen.getByText("Too many transitions to draw at this width; the Transitions list below has all of them.")).toBeVisible();
    expect(screen.queryByRole("group")).toBeNull();

    resize(414);
    expect(group()).toHaveStyle({ width: "372px", height: `${7 * 44 - 16}px` });
    expect(screen.queryByText(/Too many transitions/)).toBeNull();

    resize(279);
    expect(screen.getByText(/Too many transitions/)).toBeVisible();
  });

  it("sizes the block to its lanes and nodes, n·44 − 16 high, with the narrow node under 360", () => {
    width = 294;
    renderDiagram();
    expect(group()).toHaveStyle({ height: `${4 * 44 - 16}px` });
    expect(node("To Do")).toHaveStyle({ width: "128px", top: "0px" });
    expect(node("Done")).toHaveStyle({ top: "132px" });
  });
});
