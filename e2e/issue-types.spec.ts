import { expect, test, type Locator, type Page } from "@playwright/test";

// TAS-417: a project's issue types are its registry (backend #212, TAS-418;
// DESIGN.md §4.30). The board offers them in the registry's order in the type
// filter and in New issue, draws each by its name, colour and shape — or its
// icon instead of the shape (TAS-434, backend TAS-432; §4.6) — and an ADMIN
// adds, edits, reorders and deletes them in the Issue types dialog. In the mock
// seed Taska Platform holds the three seeds as plain shapes (Task and Story
// squares, Bug a circle), Infra and Ops only Task and Bug (and no bug yet), and
// Web App adds Epic, drawn by its `layers` icon, with a workflow of its own.

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

/** A chip's figure as drawn: its class, box, radius, paint, the `::before` diamond, and any glyph. */
const chipLook = (chip: Locator) =>
  chip.evaluate((element) => {
    const style = getComputedStyle(element);
    const before = getComputedStyle(element, "::before");
    const box = element.getBoundingClientRect();
    return {
      figure: ["is-square", "is-circle", "is-diamond", "is-icon"].filter((name) => element.classList.contains(name)),
      width: box.width,
      height: box.height,
      radius: style.borderRadius,
      background: style.backgroundColor,
      color: style.color,
      beforeContent: before.content,
      beforeBackground: before.backgroundColor,
      beforeTransform: before.transform,
      beforeWidth: before.width,
      glyphs: element.querySelectorAll("svg").length,
    };
  });

const TRANSPARENT = "rgba(0, 0, 0, 0)";

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

test("an ADMIN adds a type; it is offered in the filter and New issue, and an issue of it lands on the board with its icon", async ({
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

  // On the board, in To Do, drawn by its icon instead of a shape (§4.6): the
  // glyph stroked teal, no fill, no tile.
  const card = page.getByRole("region", { name: "To Do column" }).locator("button.issue-card", { hasText: "Export my data" });
  await expect(card).toBeVisible();
  const chip = card.locator(".type-chip");
  await expect(chip).toHaveAttribute("title", "Customer request");
  expect(await chipLook(chip)).toMatchObject({
    figure: ["is-icon"],
    width: 14,
    height: 14,
    background: TRANSPARENT,
    color: "rgb(13, 148, 136)",
    glyphs: 1,
  });
  await expect(chip.locator("svg")).toHaveAttribute("width", "14");
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

  // TAS-101 is a bug: its card is named and painted by the registry now, still its circle.
  const card = page.locator("button.issue-card", { hasText: "TAS-101" });
  await expect(card.locator(".issue-type-label")).toHaveText("Defect");
  await expect(card.locator(".type-chip")).toHaveCSS("background-color", "rgb(139, 92, 246)");
  await expect(card.locator(".type-chip")).toHaveCSS("border-radius", "50%");
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
  // Epic is drawn by its icon: the glyph stroked purple, no fill.
  const headChip = panel.locator(".issue-panel-head .type-chip");
  await expect(headChip).toHaveCSS("color", "rgb(139, 92, 246)");
  await expect(headChip).toHaveCSS("background-color", TRANSPARENT);
  await expect(headChip.locator("svg")).toHaveCount(1);
  // §5.5: the chosen type's chip inside the select, 8 from its left, centred in its 30.
  const placed = await panel.locator(".type-select").evaluate((field) => {
    const chip = field.querySelector(".type-chip")!.getBoundingClientRect();
    const select = field.querySelector("select")!;
    const box = select.getBoundingClientRect();
    return {
      left: chip.left - box.left,
      centre: chip.top + chip.height / 2 - (box.top + box.height / 2),
      width: chip.width,
      paddingLeft: getComputedStyle(select).paddingLeft,
    };
  });
  expect(placed).toMatchObject({ left: 8, width: 14, paddingLeft: "28px" });
  expect(Math.abs(placed.centre)).toBeLessThanOrEqual(0.5);
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

  // The form fits too, the nine icons on one row (§4.30: 26 buttons below 480,
  // 264 in the column), Colour over Shape.
  await dialog.getByRole("button", { name: "Add type" }).click();
  await expect(dialog.getByRole("form", { name: "New type" })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const form = await dialog.evaluate((element) => {
    const body = element.querySelector(".modal-body") as HTMLElement;
    const icons = element.querySelector('[role="group"][aria-label="Icon"]') as HTMLElement;
    const shapes = element.querySelector('[role="group"][aria-label="Shape"]') as HTMLElement;
    const colours = element.querySelector('[role="group"][aria-label="Colour"]') as HTMLElement;
    const buttons = [...icons.querySelectorAll("button")].map((button) => button.getBoundingClientRect());
    return {
      overflow: body.scrollWidth - body.clientWidth,
      iconWidth: icons.getBoundingClientRect().width,
      iconColumn: (icons.parentElement as HTMLElement).getBoundingClientRect().width,
      iconRows: new Set(buttons.map((box) => Math.round(box.top))).size,
      iconButtons: buttons.map((box) => [box.width, box.height]),
      shapeButtons: [...shapes.querySelectorAll("button")].map((button) => button.getBoundingClientRect().width),
      shapeBelowColour: shapes.getBoundingClientRect().top > colours.getBoundingClientRect().bottom,
    };
  });
  await page.screenshot({ path: testInfo.outputPath("issue-types-form-375.png") });
  expect(form.overflow).toBeLessThanOrEqual(0);
  expect(form.iconRows).toBe(1);
  expect(form.iconButtons).toHaveLength(9);
  for (const [width, height] of [...form.iconButtons, ...form.shapeButtons.map((width) => [width, width])]) {
    expect(width).toBeCloseTo(26, 1);
    expect(height).toBeCloseTo(26, 1);
  }
  expect(form.shapeButtons).toHaveLength(3);
  expect(form.iconWidth).toBeCloseTo(264, 1);
  expect(form.iconWidth).toBeLessThanOrEqual(form.iconColumn);
  expect(form.shapeBelowColour).toBe(true);
});

test("draws Task, Bug and Story as plain 14px shapes on the board, and the card is no taller for it", async ({ page }) => {
  await openBoard(page, "Taska Platform");
  await page.evaluate(() => document.fonts.ready);

  // TAS-102 a task, TAS-101 a bug, TAS-103 a story — one evaluate, after the fonts.
  const cards = await page.evaluate(() =>
    ["TAS-102", "TAS-101", "TAS-103"].map((key) => {
      const card = [...document.querySelectorAll("button.issue-card")].find((node) =>
        node.querySelector(".issue-key")?.textContent === key,
      ) as HTMLElement;
      const chip = card.querySelector(".type-chip") as HTMLElement;
      const style = getComputedStyle(chip);
      const box = chip.getBoundingClientRect();
      return {
        key,
        figure: ["is-square", "is-circle", "is-diamond", "is-icon"].filter((name) => chip.classList.contains(name)),
        size: [box.width, box.height],
        radius: style.borderRadius,
        background: style.backgroundColor,
        glyphs: chip.querySelectorAll("svg").length,
        margin: style.marginTop,
        meta: (card.querySelector(".issue-card-meta") as HTMLElement).getBoundingClientRect().height,
        line: (card.querySelector(".issue-key") as HTMLElement).getBoundingClientRect().height,
      };
    }),
  );
  expect(cards).toMatchObject([
    { key: "TAS-102", figure: ["is-square"], size: [14, 14], radius: "4px", background: "rgb(79, 124, 240)", glyphs: 0 },
    { key: "TAS-101", figure: ["is-circle"], size: [14, 14], radius: "50%", background: "rgb(229, 84, 75)", glyphs: 0 },
    { key: "TAS-103", figure: ["is-square"], size: [14, 14], radius: "4px", background: "rgb(63, 168, 99)", glyphs: 0 },
  ]);
  for (const card of cards) {
    // The chip sits inside the meta row's line box with no negative margin:
    // the row — and so the card — is as high as the key's own line (§4.6).
    expect(card.margin).toBe("0px");
    expect(card.size[1]).toBeLessThanOrEqual(card.line);
    expect(Math.abs(card.meta - card.line)).toBeLessThan(0.01);
  }
});

test("an ADMIN adds a diamond without an icon, and the Shape group is unavailable while an icon is chosen", async ({
  page,
}) => {
  await openBoard(page, "Taska Platform");
  const dialog = await openIssueTypes(page);

  await dialog.getByRole("button", { name: "Add type" }).click();
  const form = dialog.getByRole("form", { name: "New type" });
  const shapes = form.getByRole("group", { name: "Shape" });
  const icons = form.getByRole("group", { name: "Icon" });
  // No icon and a square by default.
  await expect(icons.getByRole("button").first()).toHaveAccessibleName("No icon");
  await expect(icons.getByRole("button", { name: "No icon" })).toHaveAttribute("aria-pressed", "true");
  await expect(shapes.getByRole("button", { name: "Square" })).toHaveAttribute("aria-pressed", "true");

  // An icon makes the Shape group steadily unavailable — kept, said why — and No icon brings it back.
  await icons.getByRole("button", { name: "Flag" }).click();
  const note = form.getByText("A type with an icon shows the icon instead of a shape.");
  await expect(note).toBeVisible();
  for (const name of ["Square", "Circle", "Diamond"]) {
    await expect(shapes.getByRole("button", { name })).toHaveAttribute("aria-disabled", "true");
  }
  await expect(shapes.getByRole("button", { name: "Circle" })).toHaveCSS("opacity", "0.58");
  // Playwright will not press an `aria-disabled` button on its own; the press is
  // forced to show that it changes nothing.
  await shapes.getByRole("button", { name: "Circle" }).click({ force: true });
  await expect(shapes.getByRole("button", { name: "Square" })).toHaveAttribute("aria-pressed", "true");
  await expect(form.locator(".issue-type-form-head .type-chip svg")).toHaveCount(1);
  await icons.getByRole("button", { name: "No icon" }).click();
  await expect(note).toHaveCount(0);
  await expect(shapes.getByRole("button", { name: "Diamond" })).not.toHaveAttribute("aria-disabled", "true");

  await form.getByLabel("Name").fill("Incident");
  await shapes.getByRole("button", { name: "Diamond" }).click();
  await expect(shapes.getByRole("button", { name: "Diamond" })).toHaveAttribute("aria-pressed", "true");
  await form.getByRole("button", { name: "Add type" }).click();

  await expect(rowNames(dialog)).toHaveText(["Task", "Bug", "Story", "Incident"]);
  // Amber, the first colour no type wore: an 11×11 square turned 45° on `::before`, no glyph.
  const row = dialog.locator(".issue-type-row", { hasText: "INCIDENT" });
  expect(await chipLook(row.locator(".type-chip"))).toMatchObject({
    figure: ["is-diamond"],
    width: 14,
    height: 14,
    background: TRANSPARENT,
    beforeBackground: "rgb(227, 160, 8)",
    beforeWidth: "11px",
    glyphs: 0,
  });
  const turned = await row.locator(".type-chip").evaluate((element) => {
    const { a, b } = new DOMMatrix(getComputedStyle(element, "::before").transform);
    return Math.round((Math.atan2(b, a) * 180) / Math.PI);
  });
  expect(turned).toBe(45);

  // And on a card of it.
  await dialog.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "New" }).click();
  const create = page.getByRole("dialog");
  await create.getByLabel("Summary").fill("Payments are down");
  await create.getByRole("combobox", { name: "Type" }).selectOption("INCIDENT");
  // §5.5: the select carries the diamond too.
  await expect(create.locator(".type-select .type-chip")).toHaveClass(/is-diamond/);
  await create.getByRole("button", { name: "Create issue" }).click();
  await page.locator(".issue-panel").getByRole("button", { name: "Close", exact: true }).click();
  const card = page.locator("button.issue-card", { hasText: "Payments are down" });
  expect(await chipLook(card.locator(".type-chip"))).toMatchObject({ figure: ["is-diamond"], glyphs: 0 });
});

test("an ADMIN takes a type's icon away, and its cards draw its shape again", async ({ page }) => {
  await openBoard(page, "Web App");
  const card = page.locator("button.issue-card", { hasText: "WEB-15" });
  expect(await chipLook(card.locator(".type-chip"))).toMatchObject({ figure: ["is-icon"], glyphs: 1 });

  const dialog = await openIssueTypes(page);
  await dialog.getByRole("button", { name: "Edit Epic" }).click();
  const form = dialog.getByRole("form", { name: "Edit Epic" });
  await expect(form.getByRole("group", { name: "Icon" }).getByRole("button", { name: "Layers" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await form.getByRole("group", { name: "Icon" }).getByRole("button", { name: "No icon" }).click();
  await form.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog.getByRole("button", { name: "Edit Epic" })).toBeFocused();
  expect(await chipLook(dialog.locator(".issue-type-row", { hasText: "EPIC" }).locator(".type-chip"))).toMatchObject({
    figure: ["is-square"],
    glyphs: 0,
  });
  await dialog.getByRole("button", { name: "Close" }).click();

  // The card follows from the cache: a purple square, no glyph.
  expect(await chipLook(card.locator(".type-chip"))).toMatchObject({
    figure: ["is-square"],
    radius: "4px",
    background: "rgb(139, 92, 246)",
    glyphs: 0,
  });
});

for (const width of [1440, 375]) {
  test(`gives the Issue types row's text column what the 14 chip leaves at ${width}`, async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== (width === 1440 ? "laptop" : "mobile"),
      "each width once, in the project that has it",
    );
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 812 });
    await openBoard(page, "Taska Platform");
    const dialog = await openIssueTypes(page);
    await expect(rowNames(dialog)).toHaveCount(3);
    await page.evaluate(() => document.fonts.ready);

    const rows = await dialog.evaluate((element) =>
      [...element.querySelectorAll<HTMLElement>(".issue-type-row")].map((row) => {
        const box = row.getBoundingClientRect();
        const chip = row.querySelector(".type-chip")!.getBoundingClientRect();
        const text = row.querySelector(".issue-type-text")!.getBoundingClientRect();
        const actions = row.querySelector(".issue-type-actions")!.getBoundingClientRect();
        return { row: box.width, height: box.height, chip: chip.width, text: text.width, actions: actions.width };
      }),
    );
    testInfo.annotations.push({ type: "measure", description: JSON.stringify(rows) });
    for (const row of rows) {
      expect(row.chip).toBeCloseTo(14, 1);
      // Chip 14 · gap 8 · text · gap 8 · the four buttons.
      expect(row.text).toBeCloseTo(row.row - 14 - 8 - 8 - row.actions, 1);
      // Sub-pixel at a device scale of 3 (44.99998 measured).
      expect(row.height).toBeCloseTo(45, 1);
    }
  });
}
