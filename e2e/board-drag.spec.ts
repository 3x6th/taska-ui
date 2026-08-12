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
  await page.getByLabel("Password").fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);

  await page.getByRole("button", { name: /Taska Platform/ }).click();
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
