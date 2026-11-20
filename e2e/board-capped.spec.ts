import { expect, test, type Locator, type Page } from "@playwright/test";

// The board read is cut at 200 a column since backend TAS-392, and the four
// filters go to the server, which applies them before the cut (DESIGN.md §4.9,
// §5.4); «Show more» reads the column's next page since backend TAS-430. A done
// column runs by its last change and is cut by the Done window since backend
// TAS-525 (TAS-532, §4.13, §5.3).
// Against the mock, like every spec here: Infra and Ops' Done holds 205 weekly
// backup checks (the seed's one column longer than a page) touched in the last
// 205 hours, week 205 last — so the column runs week 205 to week 1, the reverse
// of their creation — and three restore drills touched 20 to 80 days ago, which
// only «All» shows; WEB's EPIC has a workflow of its own. Nothing here is
// evidence about the gateway.

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

/** The keys a column draws, top to bottom. */
const keysIn = (target: Locator) =>
  target.locator(".issue-card .issue-key").evaluateAll((keys) => keys.map((key) => key.textContent?.trim() ?? ""));
/** OPS-{from} down to OPS-{to}: the weekly checks in the done column's order. */
const opsKeys = (from: number, to: number) => Array.from({ length: from - to + 1 }, (_, index) => `OPS-${from - index}`);
const doneWindow = (page: Page, name: "2 weeks" | "All") =>
  page.getByRole("group", { name: "Done issues" }).getByRole("button", { name, exact: true });

test("a column longer than a page counts every issue, draws 200, and Show more draws the rest", async ({ page }) => {
  await openBoard(page, "Infra and Ops");
  const done = column(page, "Done");

  await expect(done.locator(".issue-card")).toHaveCount(200);
  // A done column, under «2 weeks»: the last change first — week 205 to week 6.
  await expect(doneWindow(page, "2 weeks")).toHaveAttribute("aria-pressed", "true");
  expect(await keysIn(done)).toEqual(opsKeys(1204, 1005));
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

  // The rest of the column, in its order — the cursor is the last card's
  // `updatedAt` (backend TAS-525; the `createdAt` one was the gateway's 400,
  // TAS-532) — no card twice, none skipped; focus on the first new one — week
  // 5 — and the foot gone.
  await expect(done.locator(".issue-card")).toHaveCount(205);
  await expect(done.locator(".list-more")).toHaveCount(0);
  const ids = await done.locator(".issue-card").evaluateAll((cards) => cards.map((card) => card.getAttribute("data-issue-id")));
  expect(new Set(ids).size).toBe(205);
  expect(await keysIn(done)).toEqual(opsKeys(1204, 1000));
  const first = done.locator(".issue-card").nth(200);
  await expect(first).toContainText("week 5");
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
// member changes OPS-1002 — past the first 200 — before the next move (the
// mock's «[changed meanwhile]» comment): the first drag meets the 409, the
// board is read again — the card, changed last, now heads the done column —
// and the second drag goes out with the new version.
test("a card read with Show more moves after a change made elsewhere, with the version the re-read brought", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "the drag below needs two columns on screen");
  await openBoard(page, "Infra and Ops");
  const done = column(page, "Done");
  await done.getByRole("button", { name: "Show more Done issues" }).click();
  await expect(done.locator(".issue-card")).toHaveCount(205);
  const card = done.locator(".issue-card", { hasText: "OPS-1002" });

  await card.click();
  const panel = page.getByRole("dialog", { name: "OPS-1002 issue" });
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
      "OPS-1002 was not moved: it was changed elsewhere after this board was read. The board now shows the latest version.",
    ),
  ).toBeVisible();
  await expect(done.locator(".issue-card", { hasText: "OPS-1002" })).toHaveCount(1);
  // The re-read — the board and Done's tail — lands in two of the mock's beats.
  await page.waitForTimeout(600);
  // Changed last, so first in a column ordered by the last change.
  await expect(done.locator(".issue-card").first()).toContainText("OPS-1002");
  await expect(done.locator(".issue-card")).toHaveCount(205);

  await dragCardTo(page, done.locator(".issue-card", { hasText: "OPS-1002" }), inProgress);

  await expect(inProgress.locator(".issue-card", { hasText: "OPS-1002" })).toBeVisible();
  await expect(done.locator(".issue-card", { hasText: "OPS-1002" })).toHaveCount(0);
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

// §4.13 «Окно Done» (TAS-532): «2 weeks» by default, «All» one press away,
// remembered across a reload; the bar's count and a done column's pill and
// foot follow it, and «Show more» under «All» reaches the drills.
test("the Done window switches the done column, and is remembered across a reload", async ({ page }) => {
  await openBoard(page, "Infra and Ops");
  const done = column(page, "Done");
  await expect(done.locator(".column-head .count-pill")).toHaveText("205");
  await expect(counter(page)).toHaveText("206 of 206");

  await doneWindow(page, "All").click();

  await expect(doneWindow(page, "All")).toHaveAttribute("aria-pressed", "true");
  await expect(doneWindow(page, "2 weeks")).toHaveAttribute("aria-pressed", "false");
  // Focus stays on the button pressed; nothing to clear, as it is no filter.
  await expect(doneWindow(page, "All")).toBeFocused();
  await expect(page.getByRole("button", { name: "Clear" })).toHaveCount(0);
  await expect(done.locator(".column-head .count-pill")).toHaveText("208");
  await expect(counter(page)).toHaveText("209 of 209");
  await expect(done.locator(".list-more-count")).toHaveText("200 of 208 shown");

  await page.reload();
  await expect(done.locator(".issue-card")).toHaveCount(200);
  await expect(doneWindow(page, "All")).toHaveAttribute("aria-pressed", "true");
  await expect(done.locator(".column-head .count-pill")).toHaveText("208");

  await done.getByRole("button", { name: "Show more Done issues" }).click();
  await expect(done.locator(".issue-card")).toHaveCount(208);
  expect(await keysIn(done)).toEqual([...opsKeys(1204, 1000), "OPS-6", "OPS-5", "OPS-4"]);

  // Back to «2 weeks»: read under it already, so one frame, from its first page.
  await doneWindow(page, "2 weeks").click();
  await expect(done.locator(".column-head .count-pill")).toHaveText("205");
  await expect(counter(page)).toHaveText("206 of 206");
  await expect(done.locator(".issue-card")).toHaveCount(200);
  await page.reload();
  await expect(done.locator(".issue-card")).toHaveCount(200);
  await expect(doneWindow(page, "2 weeks")).toHaveAttribute("aria-pressed", "true");
});

// §4.9 «Пустая колонка DONE под «2 weeks»»: empty of what the window kept, and
// said so; under «All» the drills the filter finds are there.
test("a done column the window leaves empty says so, and «All» brings back what it cut", async ({ page }) => {
  await openBoard(page, "Infra and Ops");
  const done = column(page, "Done");
  await expect(done.locator(".issue-card")).toHaveCount(200);

  await filterField(page).fill("restore drill");
  await expect(counter(page)).toHaveText("0 of 206");
  await expect(done.locator(".empty-column")).toHaveText("No issues updated in the last 2 weeks");
  await expect(done.getByText("Drop issues here")).toHaveCount(0);

  await doneWindow(page, "All").click();
  await expect(counter(page)).toHaveText("3 of 209");
  expect(await keysIn(done)).toEqual(["OPS-6", "OPS-5", "OPS-4"]);
  await expect(done.locator(".empty-column")).toHaveCount(0);
  // «Clear» resets the filter and leaves the window as it is.
  await page.getByRole("button", { name: "Clear" }).click();
  await expect(counter(page)).toHaveText("209 of 209");
  await expect(doneWindow(page, "All")).toHaveAttribute("aria-pressed", "true");
});

// §5.3 (TAS-532): a card moved into a done column is its newest change — first
// at once, and first again once the board has been read after the move.
test("an issue moved into Done is first in that column at once and after the board is read again", async ({ page, isMobile }) => {
  test.skip(isMobile, "the drag below needs two columns on screen");
  await openBoard(page, "Taska Platform");
  const todo = column(page, "To Do");
  const done = column(page, "Done");
  await expect(done.locator(".issue-card")).toHaveCount(2);
  const before = await keysIn(done);

  await dragCardTo(page, todo.locator(".issue-card", { hasText: "TAS-110" }), done);

  await expect(done.locator(".issue-card")).toHaveCount(3);
  expect(await keysIn(done)).toEqual(["TAS-110", ...before]);
  // The move and the re-read after it — two of the mock's beats.
  await page.waitForTimeout(600);
  await expect(page.locator(".columns-area")).not.toHaveAttribute("aria-busy", "true");
  expect(await keysIn(done)).toEqual(["TAS-110", ...before]);
  await expect(todo.locator(".issue-card", { hasText: "TAS-110" })).toHaveCount(0);
});
