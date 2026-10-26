import { expect, test, type Page } from "@playwright/test";

/**
 * Settings (TAS-380, DESIGN.md §5.9): the reader's appearance choices, applied
 * the moment they are pressed and before the first paint of the next load,
 * and what each does to the board and the issue panel.
 *
 * Mock-backed like every spec here (playwright.config.ts): any seeded user
 * signs in with any password. Taska Platform's board has three columns and no
 * "Outside their workflow"; Web App's has three and the group, which a Bug
 * filter takes away (`unknown-values.spec.ts`). Since TAS-202 the columns are
 * the board read's, which leaves the epic's In Review out (backend A4).
 */

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("anna@example.com");
  await page.getByLabel("Password", { exact: true }).fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);
}

/** The three attributes the inline script in index.html and Appearance set. */
const htmlAttributes = (page: Page) =>
  page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    issueDetails: document.documentElement.dataset.issueDetails,
    boardColumns: document.documentElement.dataset.boardColumns,
  }));

async function openBoard(page: Page, project: string) {
  await page.getByRole("link", { name: "Taska — all projects" }).click();
  await page.locator(".project-card", { hasText: project }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/board$/);
  await expect(page.locator("button.issue-card").first()).toBeVisible();
}

const option = (page: Page, row: string, label: string) =>
  page.getByRole("group", { name: row }).getByRole("button", { name: label, exact: true });

test("applies each Appearance choice as it is pressed, and keeps it across a reload", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: /Open profile/ }).click();
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/settings\/profile$/);
  await page.getByRole("link", { name: "Appearance" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Appearance/);

  expect(await htmlAttributes(page)).toEqual({ theme: "light", issueDetails: "side", boardColumns: "left" });

  await option(page, "Issue details", "Centered window").click();
  await option(page, "Board columns", "Centered").click();
  await option(page, "Theme", "Dark").click();
  expect(await htmlAttributes(page)).toEqual({ theme: "dark", issueDetails: "centered", boardColumns: "centered" });
  await expect(option(page, "Issue details", "Centered window")).toHaveAttribute("aria-pressed", "true");
  // The top bar's toggle is the same state.
  await expect(page.getByRole("button", { name: "Switch to light theme" })).toBeVisible();

  // Before anything is drawn on the next load: read off the document as soon
  // as it exists, ahead of the app's own module.
  await page.reload();
  expect(await htmlAttributes(page)).toEqual({ theme: "dark", issueDetails: "centered", boardColumns: "centered" });
  await expect(option(page, "Board columns", "Centered")).toHaveAttribute("aria-pressed", "true");
  await expect(option(page, "Theme", "Dark")).toHaveAttribute("aria-pressed", "true");
});

test("sets every choice on <html> before the app's own script runs", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("taska.theme", "dark");
    window.localStorage.setItem("taska.issueDetails", "centered");
    window.localStorage.setItem("taska.boardColumns", "sideways");
  });
  // The module is held back, so whatever is on <html> now was put there by the
  // inline script in <head>.
  await page.route("**/src/main.tsx", (route) => route.abort());
  await page.goto("/login");
  expect(await htmlAttributes(page)).toEqual({ theme: "dark", issueDetails: "centered", boardColumns: "left" });
});

test.describe("on a wide screen", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "the ruling's 1920×1080");
    await page.addInitScript(() => {
      window.localStorage.setItem("taska.issueDetails", "centered");
      window.localStorage.setItem("taska.boardColumns", "centered");
    });
  });

  test("opens an issue in a 480 window, centred, 6vh from the top and the bottom", async ({ page }) => {
    await signIn(page);
    await openBoard(page, "Taska Platform");
    await page.locator("button.issue-card", { hasText: "TAS-101" }).click();
    const panel = page.getByRole("dialog", { name: "TAS-101 issue" });
    await expect(panel).toBeVisible();
    // Past the 160ms entrance, which moves the box by 7px.
    await expect
      .poll(async () => (await panel.boundingBox())?.y, { timeout: 2000 })
      .toBeCloseTo(1080 * 0.06, 0);

    const box = (await panel.boundingBox())!;
    expect(box.width).toBeCloseTo(480, 0);
    expect(box.x + box.width / 2).toBeCloseTo(1920 / 2, 0);
    expect(box.y).toBeCloseTo(64.8, 0);
    expect(1080 - (box.y + box.height)).toBeCloseTo(64.8, 0);
    const look = await panel.evaluate((element) => {
      const style = getComputedStyle(element);
      return { radius: style.borderTopLeftRadius, overflow: style.overflow, borderRight: style.borderRightWidth };
    });
    expect(look).toEqual({ radius: "15px", overflow: "hidden", borderRight: "1px" });
    // The body is the one scroller, inside a box that does not grow.
    await expect(panel.locator(".issue-panel-body")).toHaveCSS("overflow-y", "auto");
  });

  test("centres three workflow columns, and keeps the bars on the 18 gutter", async ({ page }) => {
    await signIn(page);
    await openBoard(page, "Taska Platform");
    const columns = page.locator(".columns-area > .board-column");
    await expect(columns).toHaveCount(3);
    // The real columns, not the three skeletons, which share the count.
    await expect(page.locator(".skeleton-card")).toHaveCount(0);

    const flow = 3 * 312 + 2 * 14;
    const first = (await columns.first().boundingBox())!;
    expect(first.x).toBeCloseTo((1920 - flow) / 2, 0);
    // Full-width planes stay where they were.
    const filterbar = page.locator(".filterbar");
    const firstControl = (await filterbar.locator(".filter-type-group").boundingBox())!;
    expect(firstControl.x).toBeCloseTo(18, 0);
    const back = (await page.locator(".board-topbar > .icon-button").first().boundingBox())!;
    expect(back.x).toBeCloseTo(18, 0);
  });

  test("hangs «Outside their workflow» to the right of the columns, moving them only to keep it on screen", async ({
    page,
  }) => {
    await signIn(page);
    await openBoard(page, "Web App");
    const others = page.getByRole("region", { name: "Outside their workflow" });
    await expect(others).toBeVisible();
    // Web App's registry reads the shared three and the epic's In Review
    // (backend #226), so four columns of flow, five with the group.
    const columns = page.locator(".columns-area > .board-column:not(.other-statuses)");
    await expect(columns).toHaveCount(4);

    // The formula of art-director's ruling 2. At 2400 there is room, so the
    // group hangs off the centred columns and moves nothing.
    const flow = 4 * 312 + 3 * 14;
    const all = 5 * 312 + 4 * 14;
    const placed = (width: number, group: boolean) =>
      group ? Math.max(18, Math.min((width - flow) / 2, width - all - 18)) : Math.max(18, (width - flow) / 2);
    await page.setViewportSize({ width: 2400, height: 1080 });
    await expect.poll(async () => (await columns.first().boundingBox())!.x).toBeCloseTo(placed(2400, true), 0);
    expect(placed(2400, true)).toBeCloseTo(placed(2400, false), 0);
    const last = (await columns.last().boundingBox())!;
    const group = (await others.boundingBox())!;
    expect(group.x).toBeCloseTo(last.x + 312 + 14, 0);
    expect(group.x + group.width).toBeLessThanOrEqual(2400 - 18 + 0.5);

    // At 1920 there is not: the columns move left by exactly what keeps the
    // group on screen, and come back by that much when a filter takes the
    // group away. A text filter, not a type: since TAS-392 a type filter is the
    // server's and changes the columns too (§5.4), which would move them for
    // another reason. "Checkout" keeps WEB-15 and drops the group's WEB-16.
    await page.setViewportSize({ width: 1920, height: 1080 });
    await expect.poll(async () => (await columns.first().boundingBox())!.x).toBeCloseTo(placed(1920, true), 0);
    const group1920 = (await others.boundingBox())!;
    expect(group1920.x + group1920.width).toBeCloseTo(1920 - 18, 0);
    await page.getByRole("textbox", { name: "Filter issues by key, summary or description" }).fill("checkout");
    await expect(others).toHaveCount(0);
    await expect(columns).toHaveCount(4);
    await expect.poll(async () => (await columns.first().boundingBox())!.x).toBeCloseTo(placed(1920, false), 0);
    expect(placed(1920, false) - placed(1920, true)).toBeCloseTo(29, 0);
  });
});

test("ignores both layout choices on a phone, and says so on Appearance", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "the ≤820 rule, at 390");
  await page.addInitScript(() => {
    window.localStorage.setItem("taska.issueDetails", "centered");
    window.localStorage.setItem("taska.boardColumns", "centered");
  });
  await signIn(page);

  await page.goto("/settings/appearance");
  await expect(page.getByText("On a phone, issues always open from the side and columns start at the left.")).toBeVisible();
  // Still the reader's to change, for a wider screen.
  await expect(option(page, "Issue details", "Side panel")).toBeEnabled();

  await openBoard(page, "Taska Platform");
  const area = page.locator(".columns-area");
  await expect(area).toHaveCSS("padding-left", "12px");
  await page.locator("button.issue-card", { hasText: "TAS-101" }).click();
  const panel = page.getByRole("dialog", { name: "TAS-101 issue" });
  await expect(panel).toBeVisible();
  await expect(panel).toHaveCSS("position", "absolute");
  await expect
    .poll(async () => {
      const box = await panel.boundingBox();
      return box ? Math.round(box.x + box.width) : null;
    })
    .toBe(390);
  expect((await panel.boundingBox())!.y).toBe(0);
});

test("hides the phone line on a wider screen", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "above 820");
  await signIn(page);
  await page.goto("/settings/appearance");
  await expect(page.getByRole("group", { name: "Theme" })).toBeVisible();
  await expect(page.getByText("On a phone, issues always open from the side")).toBeHidden();
});
