import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Board drag and drop had no end-to-end coverage at all, which is why both of
 * its regressions shipped in silence: columns that refuse every drop because
 * the membership read failed (TAS-163), and a touch gesture the browser claims
 * for scrolling before a drag can start (TAS-164). Like the other suites this
 * runs against MockTaskaApi (playwright.config.ts starts the server with
 * VITE_TASKA_API_MODE=mock), where Anna is an ADMIN of the seeded TAS project.
 *
 * dnd-kit only reacts to a real gesture — press, a run of small moves, release.
 * A single jump from one point to another activates nothing, so every helper
 * below moves in steps on purpose.
 */

const CARD = /TAS-102/;

async function openBoard(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("anna@example.com");
  await page.getByLabel("Password", { exact: true }).fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);

  // Addressed by class, not by role and name: since TAS-148 an ADMIN's card
  // carries an "Edit <name>" button of its own, and a loose match on the
  // project's name finds both.
  await page.locator(".project-card", { hasText: "Taska Platform" }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/board$/);
  await expect(page.getByText("TAS-102", { exact: true })).toBeVisible();
}

const column = (page: Page, name: string) => page.getByRole("region", { name: `${name} column` });

/** The lifted copy dnd-kit renders in its overlay: proof a drag actually began. */
const liftedCard = (page: Page) => page.locator(".drag-overlay-card");

async function centreOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("element has no box");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Press, cross the activation distance, travel to the column, let go. */
async function dragCardTo(page: Page, card: Locator, target: Locator) {
  const from = await centreOf(card);
  const to = await centreOf(target);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 20, from.y, { steps: 5 });
  await page.mouse.move(to.x, from.y, { steps: 15 });
  await page.mouse.up();
}

/**
 * What `onQueryClient` can do to the app's own TanStack Query client:
 *
 * - `drop-every-workflow` — the context answers without any issue type.
 * - `empty-every-workflow` — every workflow stays, with no statuses and no
 *   transitions: what the stand sent on 2026-10-15 (backend TAS-261).
 * - `drop-moves-into-todo` — every workflow keeps its statuses and loses the
 *   transitions that lead into `TODO`: a workflow with statuses and without
 *   one particular move.
 * - `count-drop-moves` — how many drop moves the board has started. A drop
 *   that finds a transition calls `mutate` with `{ movedIssueId, nextStatus,
 *   transitionId }`, and only then does a mutation enter the cache, so zero
 *   means no transition request was even begun.
 */
type QueryClientOp = "drop-every-workflow" | "empty-every-workflow" | "drop-moves-into-todo" | "count-drop-moves";

/**
 * The mock seeds no board in these states, so the tests below reach the live
 * client instead: walk the React fiber tree to the provider that holds it and
 * act on its caches. Everything downstream — the board, the drop, the panel —
 * is the real product.
 */
async function onQueryClient(page: Page, op: QueryClientOp): Promise<number> {
  return page.evaluate((op) => {
    interface Fiber {
      child?: Fiber;
      sibling?: Fiber;
      alternate?: Fiber;
      memoizedProps?: { value?: unknown };
    }
    interface Workflowish {
      statuses: { id: string; statusKey: string }[];
      transitions: { toStatusId: string }[];
    }
    interface Queryish {
      state: { data?: { workflows?: Record<string, Workflowish> } };
      setState: (state: unknown) => void;
    }
    interface QueryClientish {
      getQueryCache: () => { findAll: (filter: unknown) => Queryish[] };
      getMutationCache: () => { getAll: () => { state: { variables?: unknown } }[] };
    }

    const root = document.getElementById("root");
    const key = root && Object.keys(root).find((name) => name.startsWith("__reactContainer$"));
    const start = key ? (root as unknown as Record<string, Fiber>)[key] : undefined;
    const seen = new Set<Fiber>();
    const stack: Fiber[] = start ? [start] : [];

    while (stack.length) {
      const node = stack.pop()!;
      if (seen.has(node)) continue;
      seen.add(node);
      const value = node.memoizedProps?.value as Partial<QueryClientish> | undefined;
      if (typeof value?.getQueryCache === "function") {
        const client = value as QueryClientish;
        if (op === "count-drop-moves") {
          return client
            .getMutationCache()
            .getAll()
            .filter(({ state }) => typeof state.variables === "object" && state.variables !== null && "movedIssueId" in state.variables)
            .length;
        }
        for (const query of client.getQueryCache().findAll({ queryKey: ["project-context"] })) {
          const workflows =
            op === "drop-every-workflow"
              ? {}
              : Object.fromEntries(
                  Object.entries(query.state.data?.workflows ?? {}).map(([type, workflow]) => {
                    if (op === "empty-every-workflow") return [type, { ...workflow, statuses: [], transitions: [] }];
                    const todo = new Set(workflow.statuses.filter((status) => status.statusKey === "TODO").map((status) => status.id));
                    return [type, { ...workflow, transitions: workflow.transitions.filter((move) => !todo.has(move.toStatusId)) }];
                  }),
                );
          query.setState({ ...query.state, data: { ...query.state.data, workflows }, dataUpdatedAt: Date.now() });
        }
        return 0;
      }
      // React keeps two fiber trees and swaps them, so the walk follows
      // `alternate` as well or it can search the one that is not current.
      for (const next of [node.child, node.sibling, node.alternate]) {
        if (next) stack.push(next);
      }
    }
    throw new Error("no QueryClient on this page");
  }, op);
}

test.describe("dragging a card with a mouse", () => {
  // The phone viewport cannot show two columns at once, so its drag is driven
  // by touch in the block below rather than being reproduced badly here.
  test.skip(({ isMobile }) => Boolean(isMobile), "covered by the touch tests");

  test("moves an issue into the column it is dropped on", async ({ page }) => {
    await openBoard(page);

    const todo = column(page, "To Do");
    const inProgress = column(page, "In Progress");
    const card = todo.getByRole("button", { name: CARD });
    await expect(card).toBeVisible();

    const from = await centreOf(card);
    const to = await centreOf(inProgress);

    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    // Past the 8px activation distance first, then across the board.
    await page.mouse.move(from.x + 20, from.y, { steps: 5 });
    await page.mouse.move(to.x, from.y, { steps: 15 });

    // The column has to accept the card. It is `useDroppable({disabled})` that
    // broke on the live gateway, and this is the assertion that would have
    // caught it: no highlight means no drop target.
    await expect(inProgress).toHaveClass(/is-over/);
    await expect(liftedCard(page)).toBeVisible();

    await page.mouse.up();

    await expect(inProgress.getByRole("button", { name: CARD })).toBeVisible();
    await expect(todo.getByRole("button", { name: CARD })).toHaveCount(0);

    // Not merely moved on screen and quietly rolled back: the panel reads the
    // issue back from the API, and "Complete" is only offered from
    // In Progress. The retry is the product working as intended — dnd-kit
    // swallows the click that lands within a breath of a drop, so that letting
    // go of a card does not also open it.
    await expect(async () => {
      await inProgress.getByRole("button", { name: CARD }).click();
      await expect(page.getByRole("button", { name: "Complete" })).toBeVisible({ timeout: 1000 });
    }).toPass();
  });

  // §5.3 (TAS-202, backend TAS-392): the column's order is the server's —
  // oldest first, then id, whatever the type — and the dropped card goes where
  // the server will put it, so the re-read after the move does not reorder it.
  test("places a dropped card in the server's order, which the re-read keeps", async ({ page }) => {
    await openBoard(page);
    const todo = column(page, "To Do");
    const keys = () => todo.locator("button.issue-card .issue-key").allInnerTexts();
    await expect.poll(keys).toEqual(["TAS-102", "TAS-103", "TAS-106", "TAS-108", "TAS-110"]);

    await dragCardTo(page, column(page, "In Progress").getByRole("button", { name: /TAS-105/ }), todo);

    // TAS-105 is a bug created between TAS-103 and TAS-106: there, in the
    // middle — not after the tasks, as a type rank would have put it.
    const placed = ["TAS-102", "TAS-103", "TAS-105", "TAS-106", "TAS-108", "TAS-110"];
    await expect.poll(keys).toEqual(placed);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);
    expect(await keys()).toEqual(placed);
  });

  test("leaves the card where it was when it is dropped outside every column", async ({ page }) => {
    await openBoard(page);

    const todo = column(page, "To Do");
    const card = todo.getByRole("button", { name: CARD });
    const from = await centreOf(card);

    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 20, from.y, { steps: 5 });
    // Up into the filter bar, which is not a droppable.
    await page.mouse.move(from.x, 10, { steps: 15 });
    await page.mouse.up();

    await expect(todo.getByRole("button", { name: CARD })).toBeVisible();
  });
});

/**
 * A board with no workflow for the card's type.
 *
 * Since TAS-251 the workflow comes in the project context, with the role, the
 * members and the labels, and the server answers all of it or none — so "the
 * role arrived and the workflow did not" is no longer a state the board can be
 * in. What can happen is the context answering without the card's type: the
 * project allows fewer issue types than its issues have (backend TAS-212). The
 * mock seeds no such issue on a board the drag can reach, so this drives the
 * app's own TanStack Query cache instead: it walks the React fiber to the live
 * client and takes every workflow out of the context it holds. Everything
 * downstream of that — the board, the drop, the panel — is the real product.
 *
 * Why it has to be an end-to-end test at all: with a fallback workflow the
 * drop *succeeded* here, because the four ids the fallback carried were copied
 * from this mock's own seed. Against the deployed gateway the same drop posts a
 * transition id nobody described. So what is asserted below is that no move is
 * attempted, and the mock accepting the id is exactly what made the old
 * behaviour invisible.
 */
test.describe("a board with no workflow for the card's type", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "the drag below needs two columns on screen");

  async function failWorkflowRead(page: Page) {
    await onQueryClient(page, "drop-every-workflow");
  }

  test("refuses the drop instead of posting a transition the server never described", async ({ page }) => {
    await openBoard(page);
    await failWorkflowRead(page);

    const todo = column(page, "To Do");
    const inProgress = column(page, "In Progress");
    const card = todo.getByRole("button", { name: CARD });
    const from = await centreOf(card);
    const to = await centreOf(inProgress);

    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 20, from.y, { steps: 5 });
    await page.mouse.move(to.x, from.y, { steps: 15 });
    await page.mouse.up();

    // Nothing moved, optimistically or otherwise, and the board says why.
    await expect(page.getByRole("alert").filter({ hasText: /was not moved/ })).toBeVisible();
    await expect(todo.getByRole("button", { name: CARD })).toBeVisible();
    await expect(inProgress.getByRole("button", { name: CARD })).toHaveCount(0);
    // Not the rollback banner either: a rollback would mean a request went out.
    await expect(page.getByRole("alert").filter({ hasText: /could not be saved/ })).toHaveCount(0);
  });

  test("offers no transition button that would post one either", async ({ page }) => {
    await openBoard(page);
    await failWorkflowRead(page);

    await column(page, "To Do").getByRole("button", { name: CARD }).click();
    const panel = page.getByRole("dialog", { name: "TAS-102 issue" });
    await expect(panel).toBeVisible();
    // Answered, not the skeleton: the panel carries the key's name while it
    // loads too (TAS-380), and the absences below are true of the skeleton.
    await expect(panel).not.toHaveAttribute("aria-busy", "true");

    // No move at all. Counted in the row rather than looked up by name: since
    // TAS-382 a move is named "{name}, move to {To}" (§4.1), so an exact
    // lookup of "Start Progress" would find nothing whether or not the button
    // were there.
    await expect(panel.getByRole("group", { name: "Status" })).toBeVisible();
    await expect(panel.getByRole("group", { name: "Status" }).getByRole("button")).toHaveCount(0);
    // The registry's name, printed as the project wrote it (DESIGN.md §6).
    await expect(page.getByText(/This project has no workflow for Task issues, so no move is\s+offered\./)).toBeVisible();
  });
});

/**
 * A board whose workflow arrived present but empty — named and versioned, no
 * statuses, no transitions. The stand sent exactly that for every issue type on
 * 2026-10-15 (backend TAS-261), and the drop then said "no transition from In
 * Progress to Done in this workflow": a claim about the workflow the server
 * never made, since the same workflow read on its own route has that move.
 * Nothing compensates: the board says what the server sent and sends nothing.
 */
test.describe("a board whose workflow came without statuses", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "the drag below needs two columns on screen");

  test("refuses the drop in its own words and starts no transition", async ({ page }) => {
    await openBoard(page);
    await onQueryClient(page, "empty-every-workflow");

    const todo = column(page, "To Do");
    const inProgress = column(page, "In Progress");
    await dragCardTo(page, todo.getByRole("button", { name: CARD }), inProgress);

    await expect(
      page.getByRole("alert").filter({ hasText: "TAS-102 was not moved: the server sent this project's task workflow without statuses." }),
    ).toBeVisible();
    // Not the sentence for a workflow that lacks this one move.
    await expect(page.getByText(/no transition from/)).toHaveCount(0);
    await expect(todo.getByRole("button", { name: CARD })).toBeVisible();
    await expect(inProgress.getByRole("button", { name: CARD })).toHaveCount(0);
    expect(await onQueryClient(page, "count-drop-moves")).toBe(0);
  });

  test("says so in the panel instead of leaving the row bare", async ({ page }) => {
    await openBoard(page);
    await onQueryClient(page, "empty-every-workflow");

    await column(page, "To Do").getByRole("button", { name: CARD }).click();
    const panel = page.getByRole("dialog", { name: "TAS-102 issue" });
    await expect(panel).toBeVisible();

    await expect(
      panel.getByText("The server sent this project’s task workflow without statuses, so no move is offered."),
    ).toBeVisible();
    // Counted in the row, for the reason given in the block above.
    await expect(panel.getByRole("group", { name: "Status" })).toBeVisible();
    await expect(panel.getByRole("group", { name: "Status" }).getByRole("button")).toHaveCount(0);
  });

  test("still names the missing move when the workflow has statuses but not that transition", async ({ page }) => {
    // Since TAS-382 the mock's default workflow carries backend PR #208's six
    // transitions, which join every pair of its three statuses — so the
    // missing move is made here: every workflow keeps its statuses and loses
    // the moves back into To Do.
    await openBoard(page);
    await onQueryClient(page, "drop-moves-into-todo");
    const TASK = /TAS-107/;
    const doing = column(page, "In Progress");
    await expect(doing.getByRole("button", { name: TASK })).toBeVisible();

    await dragCardTo(page, doing.getByRole("button", { name: TASK }), column(page, "To Do"));

    await expect(
      page.getByRole("alert").filter({ hasText: "TAS-107: no transition from In Progress to To Do in this workflow" }),
    ).toBeVisible();
    await expect(page.getByText(/without statuses/)).toHaveCount(0);
    await expect(doing.getByRole("button", { name: TASK })).toBeVisible();
    expect(await onQueryClient(page, "count-drop-moves")).toBe(0);

    // The probe can see a move: the one legal drop from here starts exactly one.
    await dragCardTo(page, doing.getByRole("button", { name: TASK }), column(page, "Done"));
    await expect(column(page, "Done").getByRole("button", { name: TASK })).toBeVisible();
    expect(await onQueryClient(page, "count-drop-moves")).toBe(1);
  });
});

/**
 * §5.7's read-only board, on the real thing rather than in jsdom. Tom is a
 * VIEWER of the Mobile project (since TAS-251 a real one: the board's context
 * read refuses a non-member) and the board is reachable by URL — hiding
 * controls is a courtesy, and the server stays the authority.
 *
 * This is the permission path, not the failure path: the role arrived and said
 * no. What shipped first still let the card lift and track the cursor across
 * every column before the drop did nothing and said nothing, which is the exact
 * bug TAS-163 exists to kill.
 */
test.describe("a board this account may only read", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "the drag below needs two columns on screen");

  const MOBILE_BOARD = "/projects/f315c5cf-3333-47d1-8d22-79f07c2ec99b/board";
  const VIEWER_CARD = /MOB-5/;

  async function openViewerBoard(page: Page) {
    await page.goto("/login");
    await page.getByLabel("Email").fill("tom@example.com");
    await page.getByLabel("Password", { exact: true }).fill("mock-accepts-anything");
    await page.locator("form button[type=submit]").click();
    await expect(page).toHaveURL(/\/projects$/);

    await page.goto(MOBILE_BOARD);
    await expect(page.getByText("MOB-5", { exact: true })).toBeVisible();
  }

  test("offers a card no drag at all, and says nothing about a space bar", async ({ page }) => {
    await openViewerBoard(page);

    const card = page.getByRole("button", { name: VIEWER_CARD });
    // dnd-kit's `attributes` announce a draggable and point at instructions for
    // picking it up with the space bar. Neither is attached here: there is no
    // keyboard sensor to honour them, and the gesture would be refused anyway.
    await expect(card).not.toHaveAttribute("aria-roledescription");
    await expect(card).not.toHaveAttribute("aria-describedby");
    // Not `aria-disabled` either — the card is a working button that opens the
    // issue, and disabling it would take reading away with writing.
    await expect(card).not.toHaveAttribute("aria-disabled");
    // Not on the page at all for a VIEWER (§5.7, TAS-236; e2e/viewer-controls.spec.ts).
    await expect(page.getByRole("button", { name: "New", exact: true })).toHaveCount(0);
    // And the empty column stops asking for a card it would not accept.
    await expect(column(page, "Done").getByText("No issues")).toBeVisible();
    await expect(page.getByText("Drop issues here")).toHaveCount(0);
  });

  test("does not lift the card, highlight a column or move anything", async ({ page }) => {
    await openViewerBoard(page);

    const todo = column(page, "To Do");
    const inProgress = column(page, "In Progress");
    const card = todo.getByRole("button", { name: VIEWER_CARD });
    const from = await centreOf(card);
    const to = await centreOf(inProgress);

    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 20, from.y, { steps: 5 });
    await page.mouse.move(to.x, from.y, { steps: 15 });

    await expect(liftedCard(page)).toHaveCount(0);
    await expect(inProgress).not.toHaveClass(/is-over/);

    await page.mouse.up();

    await expect(todo.getByRole("button", { name: VIEWER_CARD })).toBeVisible();
    await expect(inProgress.getByRole("button", { name: VIEWER_CARD })).toHaveCount(0);
    // A refusal, not a fault: nothing here failed, so nothing is announced.
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("still opens the issue from the card it would not drag", async ({ page }) => {
    await openViewerBoard(page);

    await page.getByRole("button", { name: VIEWER_CARD }).click();
    const panel = page.getByRole("dialog", { name: "MOB-5 issue" });
    await expect(panel).toBeVisible();
    // Answered, not the skeleton: the panel carries the key's name while it
    // loads too (TAS-380), and the absence below is true of the skeleton.
    await expect(panel).not.toHaveAttribute("aria-busy", "true");
    // The keyboard path a writer would use is closed to a reader: the button
    // equivalent of the drag is no more available than the drag, and since
    // TAS-236 it is not drawn at all (§5.7).
    await expect(page.getByRole("button", { name: "Start Progress" })).toHaveCount(0);
  });
});

test.describe("dragging a card with a finger", () => {
  test.skip(({ hasTouch }) => !hasTouch, "only the phone project emulates touch");

  /**
   * Playwright's own touchscreen can tap and nothing else, so the gesture is
   * driven through CDP — the same input pipeline a real finger reaches, which
   * matters here: whether the browser hands the gesture to the page or keeps it
   * for scrolling is exactly what is under test, and a synthetic
   * `dispatchEvent` would decide that question for us.
   */
  async function finger(page: Page) {
    const cdp = await page.context().newCDPSession(page);
    let at = { x: 0, y: 0 };

    return {
      async press(point: { x: number; y: number }, holdMs: number) {
        at = point;
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [at] });
        if (holdMs) await page.waitForTimeout(holdMs);
      },
      async moveTo(point: { x: number; y: number }, steps = 14) {
        const start = at;
        for (let step = 1; step <= steps; step += 1) {
          at = {
            x: start.x + ((point.x - start.x) * step) / steps,
            y: start.y + ((point.y - start.y) * step) / steps,
          };
          await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [at] });
          await page.waitForTimeout(16);
        }
      },
      async release() {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await cdp.detach();
      },
    };
  }

  /**
   * At 390px only one column fits, so the board is parked between two of them
   * before the gesture starts. This positions the board; it does not stand in
   * for any part of the drag.
   */
  async function parkBetweenColumns(page: Page) {
    const area = page.locator(".columns-area");
    await area.evaluate((element) => {
      element.scrollLeft = 190;
    });
    await expect
      .poll(() => area.evaluate((element) => element.scrollLeft))
      .toBe(190);
  }

  /** The visible sliver of a card that is half scrolled off the left edge. */
  async function grabPoint(card: Locator) {
    const box = await card.boundingBox();
    if (!box) throw new Error("card has no box");
    return { x: Math.max(box.x, 0) + 45, y: box.y + box.height / 2 };
  }

  test("a long press starts a drag and the card lands in the column under the finger", async ({ page }) => {
    await openBoard(page);
    await parkBetweenColumns(page);

    const todo = column(page, "To Do");
    const inProgress = column(page, "In Progress");
    const card = todo.getByRole("button", { name: CARD });

    const touch = await finger(page);
    // Comfortably past the 250ms activation delay.
    await touch.press(await grabPoint(card), 450);
    await expect(liftedCard(page)).toBeVisible();

    await touch.moveTo(await centreOf(inProgress));
    await expect(inProgress).toHaveClass(/is-over/);
    // The board must not scroll under a drag: the sensor takes the gesture over
    // once it has activated.
    await expect(page.locator(".columns-area")).toHaveJSProperty("scrollLeft", 190);

    await touch.release();

    await expect(inProgress.getByRole("button", { name: CARD })).toBeVisible();
    await expect(todo.getByRole("button", { name: CARD })).toHaveCount(0);
  });

  test("a plain swipe still scrolls the board instead of picking a card up", async ({ page }) => {
    await openBoard(page);

    const area = page.locator(".columns-area");
    await expect(area).toHaveJSProperty("scrollLeft", 0);

    const todo = column(page, "To Do");
    const card = todo.getByRole("button", { name: CARD });
    const from = await centreOf(card);

    const touch = await finger(page);
    // No hold: a swipe that starts immediately is a scroll, not a drag.
    await touch.press(from, 0);
    await touch.moveTo({ x: from.x - 220, y: from.y }, 10);
    await touch.release();

    await expect.poll(() => area.evaluate((element) => element.scrollLeft)).toBeGreaterThan(100);
    await expect(liftedCard(page)).toHaveCount(0);
    await expect(todo.getByRole("button", { name: CARD })).toBeVisible();
  });
});

test("a card can be moved without dragging at all", async ({ page }) => {
  // AGENTS.md and DESIGN.md §5.3: drag always has a button equivalent, and it
  // is the only path a keyboard has.
  await openBoard(page);

  await page.getByRole("button", { name: CARD }).click();
  await page.getByRole("button", { name: "Start Progress" }).click();

  await expect(page.getByRole("button", { name: "Complete" })).toBeVisible();
  // Exact, or the panel backdrop ("Close issue") matches too.
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(column(page, "In Progress").getByRole("button", { name: CARD })).toBeVisible();
});
