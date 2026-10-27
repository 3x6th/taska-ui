import { expect, test, type Page } from "@playwright/test";

// The column "+" (DESIGN.md §4.9, §5.5; backend TAS-428): on every column of
// the board, opening "New issue in {Status}" with a type whose workflow lacks
// that status switched off, and creating the issue in the column's status.
// Against the mock: Web App's EPIC runs on a workflow with In Review that its
// other types lack (Anna is its ADMIN); Mobile's INCIDENT on one with Triage
// and Resolved and no To Do (Mark is its ADMIN). Nothing here is evidence
// about the gateway.

async function openBoard(page: Page, email: string, project: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);
  await page.locator(".project-card", { hasText: project }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/board$/);
}

const column = (page: Page, name: string) => page.getByRole("region", { name: `${name} column` });

test("+ on In Review creates the issue in In Review, with a type that lacks the status switched off", async ({ page }) => {
  await openBoard(page, "anna@example.com", "Web App");

  for (const name of ["To Do", "In Progress", "In Review", "Done"]) {
    const plus = column(page, name).getByRole("button", { name: `Create issue in ${name}` });
    await expect(plus).toBeVisible();
    await expect(plus).toHaveAttribute("title", `Create issue in ${name}`);
  }
  // «Outside their workflow» has none.
  await expect(page.getByRole("region", { name: "Outside their workflow" }).getByRole("button", { name: /^Create issue/ })).toHaveCount(0);

  await column(page, "In Review").getByRole("button", { name: "Create issue in In Review" }).click();
  const dialog = page.getByRole("dialog", { name: "New issue in In Review" });
  await expect(dialog.getByRole("heading", { name: "New issue in In Review" })).toBeVisible();
  const type = dialog.getByRole("combobox", { name: "Type" });
  // The first type of the registry whose workflow has In Review.
  await expect(type).toHaveValue("EPIC");
  const task = type.locator("option", { hasText: "Task" });
  await expect(task).toHaveText("Task — no In Review status");
  // `disabled` on an <option> is a property Playwright's enabled check does not read.
  await expect(task).toHaveJSProperty("disabled", true);
  await expect(type.locator("option", { hasText: "Epic" })).toHaveJSProperty("disabled", false);

  await dialog.getByLabel("Summary").fill("Review the release notes");
  await dialog.getByRole("button", { name: "Create issue" }).click();

  // The issue opens, and its card stands where "+" was pressed.
  await expect(page).toHaveURL(/\/projects\/[^/]+\/issues\/[^/]+$/);
  await expect(column(page, "In Review").locator(".issue-card", { hasText: "Review the release notes" })).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(column(page, "To Do").locator(".issue-card", { hasText: "Review the release notes" })).toHaveCount(0);
});

test("each column's form switches off the types without its status, and New offers every type as before", async ({ page }) => {
  await openBoard(page, "mark@example.com", "Mobile");

  // The heads stay on one line, each with its "+" (§4.9: 35 high).
  const heights = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.querySelectorAll(".columns-area .board-column > .column-head")].map((head) =>
      Math.round(head.getBoundingClientRect().height),
    );
  });
  expect(heights.length).toBeGreaterThan(1);
  expect(new Set(heights).size).toBe(1);

  await column(page, "To Do").getByRole("button", { name: "Create issue in To Do" }).click();
  const todo = page.getByRole("dialog", { name: "New issue in To Do" });
  const todoType = todo.getByRole("combobox", { name: "Type" });
  await expect(todoType).toHaveValue("TASK");
  await expect(todoType.locator("option", { hasText: "Incident" })).toHaveText("Incident — no To Do status");
  await expect(todoType.locator("option", { hasText: "Incident" })).toHaveJSProperty("disabled", true);
  await todo.getByRole("button", { name: "Cancel" }).click();

  // Triage is Incident's own: the one type on offer there, and the issue lands in it.
  await column(page, "Triage").getByRole("button", { name: "Create issue in Triage" }).click();
  const triage = page.getByRole("dialog", { name: "New issue in Triage" });
  const triageType = triage.getByRole("combobox", { name: "Type" });
  await expect(triageType).toHaveValue("INCIDENT");
  await expect(triageType.locator("option", { hasText: "Task" })).toHaveJSProperty("disabled", true);
  await triage.getByLabel("Summary").fill("Rotate the on-call pager");
  await triage.getByRole("button", { name: "Create issue" }).click();
  await expect(column(page, "Triage").locator(".issue-card", { hasText: "Rotate the on-call pager" })).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();

  // "New" is as it was: no status in its title, and every type on offer.
  await page.getByRole("button", { name: "New", exact: true }).click();
  const fresh = page.getByRole("dialog", { name: "New issue" });
  await expect(fresh).toBeVisible();
  await expect(fresh.getByRole("combobox", { name: "Type" }).locator("option", { hasText: "Incident" })).toHaveJSProperty(
    "disabled",
    false,
  );
});
