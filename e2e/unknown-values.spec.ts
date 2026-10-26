import { expect, test, type Page } from "@playwright/test";

// TAS-173, TAS-417. The mock's Web App project stands for a backend that has
// moved on without this frontend: its registry holds EPIC — a type beyond the
// three every project is seeded with, purple with the `layers` glyph — whose
// workflow adds IN_REVIEW, a status key this build has no word for; WEB-15 is
// an epic in review with the URGENT priority, and WEB-16 is a task in
// BLOCKED_BY_QA, a status no workflow of the project lists. The mock's
// `GET /meta` names URGENT in Russian, so it is printed as its code — the
// witness, since backend #201 named everything in English, that the Cyrillic
// check DESIGN.md §6 keeps for good still works. Types are named by the
// registry, never by `/meta`. Nothing here may blank the board, and nothing
// the board read holds may vanish from it.
//
// Since backend #226 the board reads every registry type in the registry's
// order: the epic sits on its own workflow's In Review column.

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
  // workflow here, and the epic's adds In Review, where the epic is.
  await expect(page.locator(".columns-area .board-column:not(.is-plain) .column-head strong")).toHaveText([
    "To Do",
    "In Progress",
    "In Review",
    "Done",
  ]);
  await expect(
    page.getByRole("region", { name: "In Review column" }).getByRole("button", { name: /WEB-15/ }),
  ).toBeVisible();

  // Every issue counted is an issue drawn: the column pills and the group's
  // add up to X in "X of Y".
  const pills = await page.locator(".columns-area .board-column .count-pill").allInnerTexts();
  const drawn = pills.reduce((sum, count) => sum + Number(count), 0);
  await expect(page.locator(".filterbar .counter")).toHaveText(`${drawn} of ${drawn}`);
  expect(drawn).toBe(5);

  // The type filter offers the registry's types by their names, in its order,
  // and filters by one.
  const typeFilter = page.getByRole("combobox", { name: "Type" });
  await expect(typeFilter.locator("option")).toHaveText(["All", "Task", "Bug", "Story", "Epic"]);
  await typeFilter.selectOption("EPIC");
  await expect(page.locator(".filterbar .counter")).toHaveText("1 of 5");
  await expect(others).toHaveCount(0);
});

test("opens the epic and the orphan with their status, priority and the reason no move is offered", async ({ page }) => {
  await openWebBoard(page);

  await page.getByRole("region", { name: "Outside their workflow" }).getByRole("button", { name: /WEB-16/ }).click();
  const orphan = page.getByRole("dialog", { name: "WEB-16 issue" });
  await expect(orphan.locator(".status-pill")).toHaveText("BLOCKED_BY_QA");
  await expect(
    orphan.getByText("BLOCKED_BY_QA is not in this project’s Task workflow, so no move is offered.", { exact: true }),
  ).toBeVisible();
  await orphan.getByRole("button", { name: "Close" }).click();

  await page.getByRole("region", { name: "In Review column" }).getByRole("button", { name: /WEB-15/ }).click();
  const panel = page.getByRole("dialog", { name: "WEB-15 issue" });
  await expect(panel.locator(".status-pill")).toHaveText("In Review");
  await expect(panel.getByRole("button", { name: "Approve" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "URGENT" })).toHaveClass(/is-active/);
});

test("offers the served priority and the project's new type in the create form", async ({ page }) => {
  await openWebBoard(page);

  await page.getByRole("button", { name: "New" }).click();
  const dialog = page.getByRole("dialog");
  const types = dialog.getByRole("combobox", { name: "Type" });
  const priorities = dialog.locator(".segmented").first();
  await expect(types.locator("option")).toHaveText(["Task", "Bug", "Story", "Epic"]);
  await expect(types).toHaveValue("TASK");
  await expect(priorities.getByRole("button")).toHaveText(["Low", "Medium", "High", "URGENT"]);
  // Exact names: each row sits inside a `<label>`, which also names its first
  // button after the whole row.
  await expect(priorities.getByRole("button", { name: "Medium", exact: true })).toHaveClass(/is-active/);

  await dialog.getByLabel("Summary").fill("Quarterly plan");
  await types.selectOption("EPIC");
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
