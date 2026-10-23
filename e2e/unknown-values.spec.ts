import { expect, test, type Page } from "@playwright/test";

// TAS-173. The mock's Web App project stands for a backend that has moved on
// without this frontend: it allows EPIC, a type the build has no name or colour
// for, whose workflow adds IN_REVIEW; WEB-15 is an epic in review with the
// URGENT priority, and WEB-16 is a task in BLOCKED_BY_QA, a status no workflow
// of the project lists. The mock's `GET /meta` names EPIC in English ("Epic")
// and URGENT in Russian, so the one is printed by its name and the other as its
// code — URGENT being the witness, since backend #201 named everything in
// English, that the Cyrillic check DESIGN.md §6 keeps for good still works.
// Nothing here may blank the board, and nothing the board read holds may
// vanish from it.
//
// Since TAS-202 the board is the server's own read, which reads TASK, BUG and
// STORY only (backend A4): the epic and its workflow's In Review column are not
// on the board, as they would not be on the stand. The epic is still the
// project's — offered in the type filter and the create form, found by the top
// bar's search, and opened in its panel with its own workflow's moves.

async function openWebBoard(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("anna@example.com");
  await page.getByLabel("Password", { exact: true }).fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);
  await page.locator(".project-card", { hasText: "Web App" }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/board$/);
}

test("draws an unknown status outside its workflow, and loses no issue the board read holds", async ({ page }) => {
  await openWebBoard(page);

  const others = page.getByRole("region", { name: "Outside their workflow" });
  const orphan = others.getByRole("button", { name: /WEB-16/ });
  await expect(orphan).toBeVisible();
  await expect(orphan.locator(".issue-card-status")).toHaveText("BLOCKED_BY_QA");
  // The board's columns are the read's: TASK, BUG and STORY share one
  // workflow here, and the epic's In Review is not one of them.
  await expect(page.locator(".columns-area .board-column:not(.is-plain) .column-head strong")).toHaveText([
    "To Do",
    "In Progress",
    "Done",
  ]);
  await expect(page.getByRole("button", { name: /WEB-15/ })).toHaveCount(0);

  // Every issue counted is an issue drawn: the column pills and the group's
  // add up to X in "X of Y".
  const pills = await page.locator(".columns-area .board-column .count-pill").allInnerTexts();
  const drawn = pills.reduce((sum, count) => sum + Number(count), 0);
  await expect(page.locator(".filterbar .counter")).toHaveText(`${drawn} of ${drawn}`);
  expect(drawn).toBe(4);

  // The type filter offers the new type by its name, and filters by it.
  const typeFilter = page.locator(".filterbar .segmented");
  await expect(typeFilter.getByRole("button")).toHaveText(["All", "Task", "Bug", "Story", "Epic"]);
  await typeFilter.getByRole("button", { name: "Epic" }).click();
  await expect(page.locator(".filterbar .counter")).toHaveText("0 of 4");
  await expect(others).toHaveCount(0);
});

test("opens the epic and the orphan with their status, priority and the reason no move is offered", async ({ page }) => {
  await openWebBoard(page);

  await page.getByRole("region", { name: "Outside their workflow" }).getByRole("button", { name: /WEB-16/ }).click();
  const orphan = page.getByRole("dialog", { name: "WEB-16 issue" });
  await expect(orphan.locator(".status-pill")).toHaveText("BLOCKED_BY_QA");
  await expect(orphan.getByText("BLOCKED_BY_QA is not in this project’s task workflow, so no move is offered.")).toBeVisible();
  await orphan.getByRole("button", { name: "Close" }).click();

  // The epic is not on the board; the top bar's search finds it.
  await page.getByRole("button", { name: "Back to projects" }).click();
  await page.getByRole("combobox", { name: /Search issues/ }).fill("checkout");
  await page.getByRole("option", { name: /WEB-15/ }).click();
  const panel = page.getByRole("dialog", { name: "WEB-15 issue" });
  await expect(panel.locator(".status-pill")).toHaveText("In Review");
  await expect(panel.getByRole("button", { name: "Approve" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "URGENT" })).toHaveClass(/is-active/);
});

test("offers the served priority and the project's new type in the create form", async ({ page }) => {
  await openWebBoard(page);

  await page.getByRole("button", { name: "New" }).click();
  const dialog = page.getByRole("dialog");
  const types = dialog.locator(".segmented").first();
  const priorities = dialog.locator(".segmented").nth(1);
  await expect(types.getByRole("button")).toHaveText(["Task", "Bug", "Story", "Epic"]);
  await expect(priorities.getByRole("button")).toHaveText(["Low", "Medium", "High", "URGENT"]);
  // Exact names: each row sits inside a `<label>`, which also names its first
  // button after the whole row.
  await expect(priorities.getByRole("button", { name: "Medium", exact: true })).toHaveClass(/is-active/);

  await dialog.getByLabel("Summary").fill("Quarterly plan");
  await types.getByRole("button", { name: "Epic", exact: true }).click();
  await priorities.getByRole("button", { name: "URGENT", exact: true }).click();
  await dialog.getByRole("button", { name: "Create issue" }).click();

  const panel = page.locator(".issue-panel");
  await expect(panel.locator(".issue-panel-head .issue-type-label")).toHaveText("Epic");
  await expect(panel.getByRole("button", { name: "URGENT" })).toHaveClass(/is-active/);
});

test("finds the epic from the top bar's search", async ({ page }) => {
  await openWebBoard(page);
  await page.getByRole("button", { name: "Back to projects" }).click();

  const field = page.getByRole("combobox", { name: /Search issues/ });
  await field.fill("checkout");
  const option = page.getByRole("option", { name: /WEB-15/ });
  await expect(option).toBeVisible();
  await expect(option.locator(".global-search-note").filter({ hasText: "URGENT" })).toBeVisible();
  await expect(option.locator(".global-search-note").filter({ hasText: "IN_REVIEW" })).toBeVisible();
});
