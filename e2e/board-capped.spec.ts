import { expect, test, type Locator, type Page } from "@playwright/test";

// The board read is cut at 200 a column since backend TAS-392, and the four
// filters go to the server, which applies them before the cut (DESIGN.md §4.9,
// §5.4); «Show more» reads the column's next page since backend TAS-430.
// Against the mock, like every spec here: Infra and Ops' Done holds 205 weekly
// backup checks (the seed's one column longer than a page), and WEB's EPIC has
// a workflow of its own. Nothing here is evidence about the gateway.

async function openBoard(page: Page, project: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("anna@example.com");
  await page.getByLabel("Password", { exact: true }).fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);
  await page.locator(".project-card", { hasText: project }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/board$/);
}

const column = (page: Page, name: string) => page.getByRole("region", { name: `${name} column` });
const counter = (page: Page) => page.locator(".counter");
const filterField = (page: Page) => page.getByRole("textbox", { name: "Filter issues by key, summary or description" });

test("a column longer than a page counts every issue, draws 200, and Show more draws the rest", async ({ page }) => {
  await openBoard(page, "Infra and Ops");
  const done = column(page, "Done");

  await expect(done.locator(".issue-card")).toHaveCount(200);
  // The pill and "X of Y" count issues, never the cards drawn.
  await expect(done.locator(".column-head .count-pill")).toHaveText("205");
  await expect(counter(page)).toHaveText("206 of 206");
  const foot = done.locator(".issue-list > .list-more");
  await expect(foot.locator(".list-more-count")).toHaveText("200 of 205 shown");
  const more = foot.getByRole("button", { name: "Show more Done issues" });
  await expect(more).toHaveText("Show more");
  // The foot is the last thing in the list, after the cards.
  expect(await foot.evaluate((node) => node === node.parentElement?.lastElementChild)).toBe(true);

  await more.click();

  // The rest of the column, in its order, no card twice; focus on the first
  // new one — week 201 — and the foot gone.
  await expect(done.locator(".issue-card")).toHaveCount(205);
  await expect(done.locator(".list-more")).toHaveCount(0);
  const keys = await done.locator(".issue-card").evaluateAll((cards) => cards.map((card) => card.getAttribute("data-issue-id")));
  expect(new Set(keys).size).toBe(205);
  const first = done.locator(".issue-card").nth(200);
  await expect(first).toContainText("week 201");
  await expect(first).toBeFocused();
  await expect(done.locator(".column-head .count-pill")).toHaveText("205");
  await expect(counter(page)).toHaveText("206 of 206");
});

test("a filter is the server's: true counts under it, and the foot only while the column is still cut", async ({ page }) => {
  await openBoard(page, "Infra and Ops");
  const done = column(page, "Done");
  await expect(done.locator(".column-head .count-pill")).toHaveText("205");

  // Every check matches "backup": still cut, still 205 of them.
  await filterField(page).fill("backup");
  await expect(counter(page)).toHaveText("205 of 206");
  await expect(done.locator(".list-more-count")).toHaveText("200 of 205 shown");

  // "week 1" is week 1, weeks 10–19 and weeks 100–199: 111, all drawn.
  await filterField(page).fill("week 1");
  await expect(counter(page)).toHaveText("111 of 206");
  await expect(done.locator(".column-head .count-pill")).toHaveText("111");
  await expect(done.locator(".issue-card")).toHaveCount(111);
  await expect(done.locator(".list-more")).toHaveCount(0);
  await expect(page.locator(".columns-area")).not.toHaveAttribute("aria-busy", "true");
});

test("the type filter changes the columns to that type's workflow", async ({ page }) => {
  await openBoard(page, "Web App");
  const heads = page.locator(".columns-area .board-column:not(.other-statuses) > .column-head strong");
  // Every type together: EPIC's workflow brings In Review.
  await expect(heads).toHaveText(["To Do", "In Progress", "In Review", "Done"]);

  await page.getByRole("combobox", { name: "Type" }).selectOption("TASK");

  // The task workflow's own statuses; no empty column of another type's.
  await expect(heads).toHaveText(["To Do", "In Progress", "Done"]);
  await expect(page.getByRole("region", { name: "In Review column" })).toHaveCount(0);
  // Every column of the narrowed board keeps its "+" (§4.9, backend TAS-428).
  await expect(column(page, "To Do").getByRole("button", { name: "Create issue in To Do" })).toBeVisible();
  await expect(column(page, "Done").getByRole("button", { name: "Create issue in Done" })).toBeVisible();

  await page.getByRole("combobox", { name: "Type" }).selectOption("EPIC");
  await expect(heads).toHaveText(["To Do", "In Progress", "In Review", "Done"]);
  await expect(column(page, "In Review").locator(".issue-card", { hasText: "WEB-15" })).toBeVisible();
});

/** Press, cross the activation distance, travel to the column, let go — board-drag.spec.ts's gesture. */
async function dragCardTo(page: Page, card: Locator, target: Locator) {
  await card.scrollIntoViewIfNeeded();
  const from = await card.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error("no box to drag between");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 20, from.y + from.height / 2, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, from.y + from.height / 2, { steps: 15 });
  await page.mouse.up();
}

// §4.9 «Перечитывание» (release-reviewer, TAS-438): a re-read reads an expanded
// column's tail again, so a kept card carries the server's `version`. Another
// member changes OPS-1202 — past the first 200 — before the next move (the
// mock's «[changed meanwhile]» comment): the first drag meets the 409, the
// board is read again, and the second drag goes out with the new version.
test("a card read with Show more moves after a change made elsewhere, with the version the re-read brought", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "the drag below needs two columns on screen");
  await openBoard(page, "Infra and Ops");
  const done = column(page, "Done");
  await done.getByRole("button", { name: "Show more Done issues" }).click();
  await expect(done.locator(".issue-card")).toHaveCount(205);
  const card = done.locator(".issue-card", { hasText: "OPS-1202" });

  await card.click();
  const panel = page.getByRole("dialog", { name: "OPS-1202 issue" });
  const comments = panel.locator(".comments");
  await comments.getByPlaceholder("Leave a comment").fill("Checking the restore [changed meanwhile]");
  await comments.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(comments.locator(".comment-item")).toHaveCount(1);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(panel).toHaveCount(0);

  const inProgress = column(page, "In Progress");
  await dragCardTo(page, card, inProgress);
  await expect(
    page.getByText(
      "OPS-1202 was not moved: it was changed elsewhere after this board was read. The board now shows the latest version.",
    ),
  ).toBeVisible();
  await expect(done.locator(".issue-card", { hasText: "OPS-1202" })).toHaveCount(1);
  // The re-read — the board and Done's tail — lands in two of the mock's beats.
  await page.waitForTimeout(600);

  await dragCardTo(page, done.locator(".issue-card", { hasText: "OPS-1202" }), inProgress);

  await expect(inProgress.locator(".issue-card", { hasText: "OPS-1202" })).toBeVisible();
  await expect(done.locator(".issue-card", { hasText: "OPS-1202" })).toHaveCount(0);
  await expect(done.locator(".column-head .count-pill")).toHaveText("204");
});

// §4.9 «Отказ» (art-director, TAS-438): the box goes above the row and would
// push the focused «Show more» out of the list's view; it is brought back, the
// box over it in view too. The mock refuses every page of a project whose
// description carries «[pages refused]». And §7 exception 1: in the column's
// scroller the ring is drawn inside the button, or its right edge is cut.
test("a refused Show more keeps the button and the box in the list's view, the ring inside the button", async ({ page }) => {
  await openBoard(page, "Infra and Ops");
  await page.getByRole("button", { name: "Edit project", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "Edit project" });
  await edit.getByLabel("Description").fill("CI/CD [pages refused]");
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(edit).toBeHidden();

  const done = column(page, "Done");
  const more = done.getByRole("button", { name: "Show more Done issues" });
  await more.click();
  await expect(done.getByText("More Done issues could not be loaded.")).toBeVisible();
  await expect(more).toBeFocused();

  const placed = await done.evaluate(async (section) => {
    await document.fonts.ready;
    const list = section.querySelector(".issue-list") as HTMLElement;
    const frame = list.getBoundingClientRect();
    const top = frame.top + list.clientTop;
    const bottom = top + list.clientHeight;
    const inside = (selector: string) => {
      const box = (section.querySelector(selector) as HTMLElement).getBoundingClientRect();
      return box.top >= top - 0.5 && box.bottom <= bottom + 0.5;
    };
    return { button: inside(".list-more-button"), box: inside(".issue-list > .error-note") };
  });
  expect(placed).toEqual({ button: true, box: true });

  // From the keyboard, so the ring is drawn: inside the button.
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(more).toBeFocused();
  await expect(more).toHaveCSS("outline-offset", "-2px");
});
