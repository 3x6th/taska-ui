import { expect, test, type Page } from "@playwright/test";

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
