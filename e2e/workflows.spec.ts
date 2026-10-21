import { expect, test, type Page } from "@playwright/test";

/**
 * The Workflows dialog (TAS-382, DESIGN.md §4.28) against MockTaskaApi, which
 * plays backend PR #208 ahead of the stand (docs/ai/API-DIVERGENCE.md). Anna is
 * the ADMIN of Taska Platform, Mark one of its MEMBERs and Tom its VIEWER.
 *
 * What the ADMIN path proves is the acceptance of the story end to end: a
 * workflow made from the shared default, a status and a transition added to
 * it, and the column and the move on the board at once — the board reads both
 * from the project context the dialog invalidates, not from anything the
 * dialog hands it.
 */

async function openBoardAs(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);
  await page.locator(".project-card", { hasText: "Taska Platform" }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/board$/);
  await expect(page.locator("button.issue-card").first()).toBeVisible();
}

async function openWorkflows(page: Page) {
  await page.getByRole("button", { name: "Workflows" }).click();
  const dialog = page.getByRole("dialog", { name: "Workflows" });
  await expect(dialog.getByRole("heading", { level: 3, name: "Default workflow" })).toBeVisible();
  return dialog;
}

test("an ADMIN makes a workflow, adds a status and a transition, and the board has the column and the move", async ({ page }) => {
  await openBoardAs(page, "anna@example.com");
  const dialog = await openWorkflows(page);

  await dialog.getByRole("button", { name: "New workflow" }).click();
  const create = dialog.getByRole("form", { name: "New workflow" });
  await create.getByRole("textbox", { name: "Name" }).fill("Development");
  await create.getByRole("checkbox", { name: "Task" }).check();
  await create.getByRole("button", { name: "Create workflow" }).click();

  const heading = dialog.getByRole("heading", { level: 3, name: "Development" });
  await expect(heading).toBeFocused();
  // `has` is resolved inside each section, so the heading is named unscoped.
  const own = dialog.locator("section", { has: page.getByRole("heading", { level: 3, name: "Development" }) });
  await expect(own.getByRole("button", { name: "Add status" })).toBeVisible();
  // Task left the shared default; Bug and Story stay on it.
  const shared = dialog.locator("section", { has: page.getByRole("heading", { level: 3, name: "Default workflow" }) });
  await expect(shared.locator(".workflow-type")).toHaveText(["Bug", "Story"]);

  await own.getByRole("button", { name: "Add status" }).click();
  const addStatus = own.getByRole("form", { name: "Add status" });
  await addStatus.getByRole("textbox", { name: "Name" }).fill("Code Review");
  await expect(addStatus.getByRole("textbox", { name: "Key" })).toHaveValue("CODE_REVIEW");
  await expect(addStatus.getByRole("combobox", { name: "Position" })).toHaveValue(/^after:/);
  await addStatus.getByRole("button", { name: "Add status" }).click();

  const addTransitionTrigger = own.getByRole("button", { name: "Add transition" });
  await expect(addTransitionTrigger).toBeFocused();
  await expect(own.getByRole("list", { name: "Statuses of Development" }).getByRole("listitem")).toHaveCount(4);
  await expect(own.getByText("No transition on the board leads here.")).toBeVisible();

  await addTransitionTrigger.click();
  const addTransition = own.getByRole("form", { name: "Add transition" });
  // Into the status just added, from the one before it.
  await expect(addTransition.getByRole("combobox", { name: "From" }).locator("option:checked")).toHaveText("In Progress");
  await expect(addTransition.getByRole("combobox", { name: "To" }).locator("option:checked")).toHaveText("Code Review");
  await expect(addTransition.getByRole("textbox", { name: "Name" })).toHaveValue("Move to Code Review");
  await addTransition.getByRole("button", { name: "Add transition" }).click();

  await expect(addTransitionTrigger).toBeFocused();
  await expect(own.getByRole("list", { name: "Transitions of Development" })).toContainText(
    "In Progress→ to Code Review, named Move to Code Review",
  );
  await expect(own.getByText("No transition on the board leads here.")).toHaveCount(0);

  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toBeHidden();

  // The column, at once.
  await expect(page.getByRole("region", { name: "Code Review column" })).toBeVisible();

  // And the move: TAS-107 is a task in In Progress.
  await page.getByRole("region", { name: "In Progress column" }).getByRole("button", { name: /TAS-107/ }).click();
  const panel = page.getByRole("dialog", { name: "TAS-107 issue" });
  await expect(panel).not.toHaveAttribute("aria-busy", "true");
  const move = panel.getByRole("group", { name: "Status" }).getByRole("button", { name: "Move to Code Review", exact: true });
  await move.click();
  await expect(panel.locator(".status-pill")).toHaveText("Code Review");
});

test("the shared default offers no write, even to an ADMIN", async ({ page }) => {
  await openBoardAs(page, "anna@example.com");
  const dialog = await openWorkflows(page);

  const shared = dialog.locator("section", { has: page.getByRole("heading", { level: 3, name: "Default workflow" }) });
  await expect(shared.getByText("shared", { exact: true })).toBeVisible();
  await expect(shared.getByRole("button")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "New workflow" })).toBeVisible();
});

for (const [email, role] of [
  ["mark@example.com", "MEMBER"],
  ["tom@example.com", "VIEWER"],
] as const) {
  test(`a ${role} reads the workflows with no write control, and scrolls them from the keyboard`, async ({ page }) => {
    await openBoardAs(page, email);
    const dialog = await openWorkflows(page);

    await expect(dialog.getByText("Only a project admin can change workflows.")).toBeVisible();
    await expect(dialog.getByRole("button", { name: /New workflow|Add status|Add transition/ })).toHaveCount(0);
    // First focus on Close; the body is the next stop.
    await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("region", { name: "Workflows" })).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("button", { name: "Workflows" })).toBeFocused();
  });
}
