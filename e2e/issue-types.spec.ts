import { expect, test, type Locator, type Page } from "@playwright/test";

// TAS-417: a project's issue types are its registry (backend #212, TAS-418;
// DESIGN.md §4.30). The board offers them in the registry's order in the type
// filter and in New issue, draws each by its name, colour and icon, and an
// ADMIN adds, edits, reorders and deletes them in the Issue types dialog. In
// the mock seed Taska Platform holds the three seeds, Infra and Ops only Task
// and Bug (and no bug yet), and Web App adds Epic with a workflow of its own.

async function signIn(page: Page, email = "anna@example.com") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);
}

async function openBoard(page: Page, project: string, email?: string) {
  await signIn(page, email);
  await page.locator(".project-card", { hasText: project }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/board$/);
  // The context has answered: the type filter offers the registry.
  await expect(page.getByRole("combobox", { name: "Type" })).toBeEnabled();
}

async function openIssueTypes(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Issue types" }).click();
  const dialog = page.getByRole("dialog", { name: "Issue types" });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** The names on the dialog's rows, in their order. */
const rowNames = (dialog: Locator) => dialog.getByRole("list", { name: "Issue types" }).locator(".issue-type-name");

test("a project that holds two issue types offers only those two, in the registry's order", async ({ page }) => {
  await openBoard(page, "Infra and Ops");

  await expect(page.getByRole("combobox", { name: "Type" }).locator("option")).toHaveText(["All", "Task", "Bug"]);

  await page.getByRole("button", { name: "New" }).click();
  const dialog = page.getByRole("dialog");
  const types = dialog.getByRole("combobox", { name: "Type" });
  await expect(types.locator("option")).toHaveText(["Task", "Bug"]);
  // The first type of the registry is the default.
  await expect(types).toHaveValue("TASK");
});

test("an ADMIN adds a type; it is offered in the filter and New issue, and an issue of it lands on the board with its tile", async ({
  page,
}) => {
  await openBoard(page, "Taska Platform");
  const dialog = await openIssueTypes(page);
  await expect(rowNames(dialog)).toHaveText(["Task", "Bug", "Story"]);

  await dialog.getByRole("button", { name: "Add type" }).click();
  const form = dialog.getByRole("form", { name: "New type" });
  await form.getByLabel("Name").fill("Customer request");
  // Derived from the name until typed by hand.
  await expect(form.getByLabel("Code")).toHaveValue("CUSTOMER_REQUEST");
  // The first colour no type wears yet is chosen for a new one (Task blue, Bug red, Story green).
  await expect(form.getByRole("button", { name: "Amber" })).toHaveAttribute("aria-pressed", "true");
  await form.getByRole("button", { name: "Teal" }).click();
  await form.getByRole("group", { name: "Icon" }).getByRole("button", { name: "Headset" }).click();
  await form.getByRole("button", { name: "Add type" }).click();

  // Last, as created with the largest sortOrder + 10; the form gives way to its trigger.
  await expect(rowNames(dialog)).toHaveText(["Task", "Bug", "Story", "Customer request"]);
  await expect(dialog.getByRole("button", { name: "Add type" })).toBeFocused();
  await dialog.getByRole("button", { name: "Close" }).click();

  const filter = page.getByRole("combobox", { name: "Type" });
  await expect(filter.locator("option")).toHaveText(["All", "Task", "Bug", "Story", "Customer request"]);

  await page.getByRole("button", { name: "New" }).click();
  const create = page.getByRole("dialog");
  await create.getByLabel("Summary").fill("Export my data");
  await create.getByRole("combobox", { name: "Type" }).selectOption("CUSTOMER_REQUEST");
  await create.getByRole("button", { name: "Create issue" }).click();

  const panel = page.locator(".issue-panel");
  await expect(panel.locator(".issue-panel-head .issue-type-label")).toHaveText("Customer request");
  await panel.getByRole("button", { name: "Close", exact: true }).click();

  // On the board, in To Do, with the type's tile: teal, its glyph drawn.
  const card = page.getByRole("region", { name: "To Do column" }).locator("button.issue-card", { hasText: "Export my data" });
  await expect(card).toBeVisible();
  const chip = card.locator(".type-chip");
  await expect(chip).toHaveAttribute("title", "Customer request");
  await expect(chip).toHaveCSS("background-color", "rgb(13, 148, 136)");
  await expect(chip.locator("svg")).toHaveCount(1);
  await expect(card.locator(".issue-type-label")).toHaveText("Customer request");

  // And the filter finds it.
  await filter.selectOption("CUSTOMER_REQUEST");
  await expect(page.locator("button.issue-card")).toHaveCount(1);
});

test("an ADMIN renames and recolours a type, and every card of it follows", async ({ page }) => {
  await openBoard(page, "Taska Platform");
  const dialog = await openIssueTypes(page);

  await dialog.getByRole("button", { name: "Edit Bug" }).click();
  const form = dialog.getByRole("form", { name: "Edit Bug" });
  // A code is not an input once made.
  await expect(form.getByRole("textbox", { name: "Code" })).toHaveCount(0);
  await expect(form.getByText("BUG", { exact: true })).toBeVisible();
  const save = form.getByRole("button", { name: "Save changes" });
  // Nothing changed yet, so nothing to save.
  await expect(save).toHaveAttribute("aria-disabled", "true");
  await form.getByLabel("Name").fill("Defect");
  await form.getByRole("button", { name: "Purple" }).click();
  await save.click();

  await expect(rowNames(dialog)).toHaveText(["Task", "Defect", "Story"]);
  await expect(dialog.getByRole("button", { name: "Edit Defect" })).toBeFocused();
  await dialog.getByRole("button", { name: "Close" }).click();

  // TAS-101 is a bug: its card is named and painted by the registry now.
  const card = page.locator("button.issue-card", { hasText: "TAS-101" });
  await expect(card.locator(".issue-type-label")).toHaveText("Defect");
  await expect(card.locator(".type-chip")).toHaveCSS("background-color", "rgb(139, 92, 246)");
  await expect(page.getByRole("combobox", { name: "Type" }).locator("option")).toHaveText([
    "All",
    "Task",
    "Defect",
    "Story",
  ]);
});

test("an ADMIN reorders types from the keyboard; focus stays on the button, and the default follows the first", async ({
  page,
}) => {
  await openBoard(page, "Taska Platform");
  const dialog = await openIssueTypes(page);

  const up = dialog.getByRole("button", { name: "Move Story up" });
  await up.focus();
  await page.keyboard.press("Enter");
  await expect(rowNames(dialog)).toHaveText(["Task", "Story", "Bug"]);
  await expect(up).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(rowNames(dialog)).toHaveText(["Story", "Task", "Bug"]);
  // At the top: unavailable, never removed, so focus stays put.
  await expect(up).toBeFocused();
  await expect(up).toHaveAttribute("aria-disabled", "true");
  await expect(dialog.locator(".issue-type-row").first().getByText("default", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Story moved to position 1 of 3.")).toBeAttached();
  // The other end's Move down is unavailable too.
  await expect(dialog.getByRole("button", { name: "Move Bug down" })).toHaveAttribute("aria-disabled", "true");
  // Esc does nothing while a write is out (§4.30): wait for both to land.
  await expect(dialog.getByRole("button", { name: "Add type" })).not.toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  await expect(page.getByRole("combobox", { name: "Type" }).locator("option")).toHaveText(["All", "Story", "Task", "Bug"]);
  await page.getByRole("button", { name: "New" }).click();
  await expect(page.getByRole("dialog").getByRole("combobox", { name: "Type" })).toHaveValue("STORY");

});

test("a delete is refused while issues have the type, saying how many, and goes through for an unused one", async ({
  page,
}) => {
  await openBoard(page, "Taska Platform");
  const dialog = await openIssueTypes(page);

  const remove = dialog.getByRole("button", { name: "Delete Bug" });
  await remove.click();
  const strip = dialog.locator(".issue-type-confirm");
  await expect(strip).toContainText("Bug will be deleted from this project for everyone.");
  await expect(strip.getByRole("button", { name: "Cancel" })).toBeFocused();
  await strip.getByRole("button", { name: "Delete type" }).click();

  // TAS-101, TAS-105 and TAS-110 are live bugs; the count is the server's.
  await expect(dialog.getByText("Bug was not deleted: 3 issues have this type. Change their type first.")).toBeVisible();
  await expect(dialog.getByText("Issue type BUG has 3 issues")).toBeVisible();
  await expect(strip).toHaveCount(0);
  await expect(remove).toBeFocused();
  await expect(rowNames(dialog)).toHaveText(["Task", "Bug", "Story"]);

  // Infra and Ops holds Task and Bug and no bug: Bug goes, and Task — the one
  // left — offers no Delete and says why.
  await dialog.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Back to projects" }).click();
  await page.locator(".project-card", { hasText: "Infra and Ops" }).click();
  await expect(page.getByRole("combobox", { name: "Type" })).toBeEnabled();
  const ops = await openIssueTypes(page);
  await ops.getByRole("button", { name: "Delete Bug" }).click();
  await ops.getByRole("button", { name: "Delete type" }).click();
  await expect(rowNames(ops)).toHaveText(["Task"]);
  await expect(ops.getByText("Type Bug deleted.")).toBeAttached();
  await expect(ops.getByRole("button", { name: "Delete Task" })).toHaveCount(0);
  await expect(ops.getByText("A project needs at least one issue type, so this one cannot be deleted.")).toBeVisible();
  // Focus has somewhere to go: Add type.
  await expect(ops.getByRole("button", { name: "Add type" })).toBeFocused();
  await ops.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("combobox", { name: "Type" }).locator("option")).toHaveText(["All", "Task"]);
});

for (const [role, email] of [
  ["MEMBER", "mark@example.com"],
  ["VIEWER", "tom@example.com"],
] as const) {
  test(`a ${role} reads the types with no way to change them`, async ({ page }) => {
    await openBoard(page, "Taska Platform", email);
    const dialog = await openIssueTypes(page);

    await expect(rowNames(dialog)).toHaveText(["Task", "Bug", "Story"]);
    await expect(dialog.getByText("Only a project admin can change issue types.")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Add type" })).toHaveCount(0);
    await expect(dialog.getByRole("list", { name: "Issue types" }).getByRole("button")).toHaveCount(0);
    // The body is the Tab stop that scrolls it, as in Workflows.
    await expect(dialog.getByRole("region", { name: "Issue types" })).toHaveAttribute("tabindex", "0");
  });
}

test("the panel changes an issue's type in one write, and offers no type whose workflow lacks the issue's status", async ({
  page,
}) => {
  await openBoard(page, "Web App");

  // WEB-15 is an epic In Review: only Epic's workflow has that status.
  await page.locator("button.issue-card", { hasText: "WEB-15" }).click();
  const epicPanel = page.getByRole("dialog", { name: "WEB-15 issue" });
  const epicType = epicPanel.getByRole("combobox", { name: "Type" });
  await expect(epicType).toHaveValue("EPIC");
  await expect(epicType.locator("option")).toHaveText([
    "Task — no In Review status",
    "Bug — no In Review status",
    "Story — no In Review status",
    "Epic",
  ]);
  await expect(epicType.locator("option:disabled")).toHaveCount(3);
  await epicPanel.getByRole("button", { name: "Close" }).click();

  // WEB-14 is a task in Done, which every workflow here has.
  await page.locator("button.issue-card", { hasText: "WEB-14" }).click();
  const panel = page.getByRole("dialog", { name: "WEB-14 issue" });
  const type = panel.getByRole("combobox", { name: "Type" });
  await expect(type.locator("option:disabled")).toHaveCount(0);
  await type.selectOption("EPIC");
  await expect(panel.locator(".issue-panel-head .issue-type-label")).toHaveText("Epic");
  await expect(panel.locator(".issue-panel-head .type-chip")).toHaveCSS("background-color", "rgb(139, 92, 246)");
  // The write landed: the card on the board is an epic now.
  await expect(page.locator("button.issue-card", { hasText: "WEB-14" }).locator(".issue-type-label")).toHaveText("Epic");
  await expect(panel.getByRole("alert")).toHaveCount(0);
});

test("lays the dialog out at 375 without sideways scrolling, every row's controls in reach", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "a phone width, once");
  await page.setViewportSize({ width: 375, height: 812 });
  await openBoard(page, "Taska Platform");
  const dialog = await openIssueTypes(page);
  await expect(rowNames(dialog)).toHaveCount(3);
  await page.evaluate(() => document.fonts.ready);

  const layout = await dialog.evaluate((element) => {
    const body = element.querySelector(".modal-body") as HTMLElement;
    const rows = [...element.querySelectorAll<HTMLElement>(".issue-type-row")].map((row) => {
      const text = row.querySelector(".issue-type-text")!.getBoundingClientRect();
      const actions = row.querySelector(".issue-type-actions")!.getBoundingClientRect();
      return { textWidth: text.width, actionsRight: actions.right, height: row.getBoundingClientRect().height };
    });
    return {
      modalWidth: element.getBoundingClientRect().width,
      overflow: body.scrollWidth - body.clientWidth,
      bodyRight: body.getBoundingClientRect().right,
      rows,
    };
  });
  await page.screenshot({ path: testInfo.outputPath("issue-types-375.png") });

  expect(layout.modalWidth).toBeLessThanOrEqual(375);
  expect(layout.overflow).toBeLessThanOrEqual(0);
  for (const row of layout.rows) {
    // One line for the controls, at least 44 high (§4.30) and every row the
    // same — the first one's `default` marker does not make it taller — with
    // the four buttons inside the body.
    expect(row.height).toBeGreaterThanOrEqual(44);
    expect(row.height).toBeCloseTo(layout.rows[1].height, 1);
    expect(row.actionsRight).toBeLessThanOrEqual(layout.bodyRight);
    expect(row.textWidth).toBeGreaterThan(100);
  }

  // The form fits too.
  await dialog.getByRole("button", { name: "Add type" }).click();
  const fits = await dialog.evaluate((element) => {
    const body = element.querySelector(".modal-body") as HTMLElement;
    return body.scrollWidth - body.clientWidth;
  });
  expect(fits).toBeLessThanOrEqual(0);
});
