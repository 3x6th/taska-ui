import { expect, test, type Page } from "@playwright/test";

/**
 * The Workflows dialog (TAS-382, DESIGN.md §4.28) against MockTaskaApi, which
 * plays backend PR #208's routes and migration 0001 (develop `594f637`). Anna is
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

/**
 * Only the dialog's body ever scrolls, never its box. A focus move after a
 * write once scrolled `.modal` itself — `overflow: hidden` still scrolls from
 * script — and cut the header off, because the rows' visually-hidden spans had
 * given the box overflow of its own (TAS-382, the orchestrator's browser
 * check). Checked after every write; on the laptop the body overflows by then,
 * so there the check is not vacuous.
 */
async function expectOnlyTheBodyScrolls(page: Page, project: string) {
  const box = await page.locator(".modal").evaluate((modal) => {
    const body = modal.querySelector(".modal-body") as HTMLElement;
    return {
      scrollTop: modal.scrollTop,
      overflow: modal.scrollHeight - modal.clientHeight,
      bodyOverflow: body.scrollHeight - body.clientHeight,
    };
  });
  expect(box.scrollTop).toBe(0);
  expect(box.overflow).toBeLessThanOrEqual(1);
  if (project === "laptop") expect(box.bodyOverflow).toBeGreaterThan(0);
}

test("an ADMIN makes a workflow, adds a status and a transition, and the board has the column and the move", async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  await openBoardAs(page, "anna@example.com");
  const dialog = await openWorkflows(page);

  await dialog.getByRole("button", { name: "New workflow" }).click();
  const create = dialog.getByRole("form", { name: "New workflow" });
  await create.getByRole("textbox", { name: "Name" }).fill("Development");
  await create.getByRole("checkbox", { name: "Task" }).check();
  await create.getByRole("button", { name: "Create workflow" }).click();

  const heading = dialog.getByRole("heading", { level: 3, name: "Development" });
  await expect(heading).toBeFocused();
  await expectOnlyTheBodyScrolls(page, project);
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
  await expectOnlyTheBodyScrolls(page, project);
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
  await expectOnlyTheBodyScrolls(page, project);
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
  // The diagram's nodes are its only buttons, and they write nothing (§4.28).
  await expect(shared.getByRole("group", { name: "Diagram of Default workflow" }).getByRole("button")).toHaveCount(3);
  await expect(shared.locator("button:not(.workflow-diagram-node)")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "New workflow" })).toBeVisible();
});

/**
 * §4.28's diagram on the seed's shared default: three statuses and all six
 * moves between them, none hidden. On every viewport the block fits its card
 * without scrolling or scaling, and it is one Tab stop between New workflow
 * and the card's (absent) writes.
 */
test("the shared default's diagram draws every move, fits its card, and is one Tab stop with a pin", async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  await openBoardAs(page, "anna@example.com");
  const dialog = await openWorkflows(page);
  const shared = dialog.locator("section", { has: page.getByRole("heading", { level: 3, name: "Default workflow" }) });
  const diagram = shared.getByRole("group", { name: "Diagram of Default workflow" });
  const nodes = diagram.getByRole("button");

  await expect(nodes).toHaveText(["To Do", "In Progress", "Done"]);
  await expect(nodes.nth(0)).toHaveAccessibleDescription("Leads to In Progress and Done. Reached from In Progress and Done.");
  await expect(nodes.nth(1)).toHaveAccessibleDescription("Leads to To Do and Done. Reached from To Do and Done.");
  await expect(nodes.nth(2)).toHaveAccessibleDescription("Leads to To Do and In Progress. Reached from To Do and In Progress.");
  await expect(diagram.locator("svg .workflow-diagram-line")).toHaveCount(6);
  await expect(shared.getByText(/Too many transitions|Dashed arrows|not drawn/)).toHaveCount(0);

  // B4: inside the card's content box, centred, and nothing scrolls sideways.
  const fit = await shared.evaluate((card) => {
    const block = card.querySelector(".workflow-diagram-block") as HTMLElement;
    const wrapper = card.querySelector(".workflow-diagram") as HTMLElement;
    const [outer, inner] = [wrapper.getBoundingClientRect(), block.getBoundingClientRect()];
    const body = card.closest(".modal-body") as HTMLElement;
    return {
      left: inner.left - outer.left,
      right: outer.right - inner.right,
      sideways: body.scrollWidth - body.clientWidth,
      height: inner.height,
    };
  });
  expect(fit.left).toBeGreaterThanOrEqual(0);
  expect(fit.right).toBeGreaterThanOrEqual(0);
  expect(Math.abs(fit.left - fit.right)).toBeLessThanOrEqual(1);
  expect(fit.sideways).toBeLessThanOrEqual(0);
  expect(fit.height).toBe(3 * 44 - 16);

  // Close → New workflow → the diagram, on its first node.
  await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "New workflow" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(nodes.nth(0)).toBeFocused();
  await expect(nodes.nth(0)).toHaveClass(/is-active/);

  await page.keyboard.press("ArrowDown");
  await expect(nodes.nth(1)).toBeFocused();
  await expect(nodes.nth(1)).toHaveClass(/is-active/);
  await page.keyboard.press("Enter");
  await expect(nodes.nth(1)).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("End");
  await expect(nodes.nth(2)).toBeFocused();
  await page.keyboard.press("Space");
  await expect(nodes.nth(2)).toHaveAttribute("aria-pressed", "true");
  await expect(nodes.nth(1)).toHaveAttribute("aria-pressed", "false");

  // Out of the diagram and back: the pinned node is the stop, and the pin
  // holds the highlight with focus gone.
  await page.keyboard.press("Tab");
  await expect(nodes.nth(2)).not.toBeFocused();
  await expect(nodes.nth(2)).toHaveClass(/is-active/);
  await page.keyboard.press("Shift+Tab");
  await expect(nodes.nth(2)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(nodes.nth(2)).toHaveAttribute("aria-pressed", "false");

  if (project === "mobile") {
    // A tap pins; a touch is not a hover.
    await nodes.nth(0).tap();
    await expect(nodes.nth(0)).toHaveAttribute("aria-pressed", "true");
    await nodes.nth(0).tap();
    await expect(nodes.nth(0)).toHaveAttribute("aria-pressed", "false");
  } else {
    // A mouse over a node lights it ahead of the pin; a second click unpins
    // with nothing left lit once the mouse has gone.
    await nodes.nth(0).click();
    await expect(nodes.nth(0)).toHaveAttribute("aria-pressed", "true");
    await nodes.nth(2).hover();
    await expect(nodes.nth(2)).toHaveClass(/is-active/);
    await expect(nodes.nth(0)).not.toHaveClass(/is-active/);
    await nodes.nth(0).click();
    await expect(nodes.nth(0)).toHaveAttribute("aria-pressed", "false");
    await page.mouse.move(0, 0);
    await expect(diagram.locator(".is-active")).toHaveCount(0);
  }

  // Esc is the dialog's, not the diagram's.
  await nodes.nth(0).focus();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
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
