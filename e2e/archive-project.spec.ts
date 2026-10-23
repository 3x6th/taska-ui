import { expect, test, type Page } from "@playwright/test";

// Archiving a project (TAS-149): `DELETE /api/v1/projects/{id}`, backend PR #159
// (TAS-146), merged and deployed on 2026-10-23. An archived project leaves
// `GET /projects`, stays readable — board, issues, comments — and refuses every
// write with 400 FAILED_PRECONDITION, `details.reason: "PROJECT_ARCHIVED"`.
// The board reads `archivedAt` off its context and offers no write to anybody
// (DESIGN.md §4.11 «Опасная зона диалога», §5.7 «Архивный проект»).
//
// Mock-backed like every spec here (playwright.config.ts): any seeded user signs
// in with any password. On Taska Platform, Anna is the ADMIN, Mark a MEMBER and
// Tom the VIEWER; Anna is also the ADMIN of Web App and Infra and Ops.
//
// The mock's store lives in the page, so a reload forgets an archive: every
// step after one stays in the app — the board is reached by link
// (`openInApp`), and a second account signs in through the app's own Log out.
//
// What this file cannot see without a wire: a request id. `MockApiError`
// carries none, so the id beside the refusal is pinned in
// src/screens/BoardScreen.test.tsx and src/components/EditProjectModal.test.tsx.

async function signIn(page: Page, email = "anna@example.com") {
  await page.goto("/login");
  await submitSignIn(page, email);
}

async function submitSignIn(page: Page, email: string) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.locator(".skeleton-card")).toHaveCount(0);
}

/** Another account, in the same page and so the same mock store. */
async function switchAccount(page: Page, from: string, to: string) {
  await page.getByRole("button", { name: `Open profile for ${from}` }).click();
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await submitSignIn(page, to);
}

/** A link followed inside the app — what a notification, a search hit or a pasted address does without a reload. */
async function openInApp(page: Page, path: string) {
  await page.evaluate((target) => {
    window.history.pushState({}, "", target);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, path);
}

/**
 * Another ADMIN archiving a project in another session, a moment before: the
 * archive goes straight into this page's mock store, through the module the
 * app itself loaded (the suite runs the Vite dev server, so `/src/api/client.ts`
 * is the app's own instance), and nothing on screen is told. The board learns
 * of it the way it would against the gateway — from the refusal of its next
 * write and the context read that follows.
 */
async function archiveElsewhere(page: Page, projectKey: string) {
  await page.evaluate(async (key) => {
    const clientModule = "/src/api/client.ts";
    const { taskaApi } = (await import(/* @vite-ignore */ clientModule)) as {
      taskaApi: {
        listProjects(): Promise<{ id: string; projectKey: string }[]>;
        archiveProject(projectId: string): Promise<unknown>;
      };
    };
    const project = (await taskaApi.listProjects()).find((item) => item.projectKey === key);
    if (!project) throw new Error(`No project ${key} to archive`);
    await taskaApi.archiveProject(project.id);
  }, projectKey);
}

const ARCHIVED_REFUSAL = "This project has been archived, so nothing in it can be changed.";

/** The card is a button and so is its edit control, so name them apart. */
const projectCard = (page: Page, name: string) => page.locator(".project-card", { hasText: name });

/** A project's board path, read off its card. */
async function boardPathOf(page: Page, name: string) {
  await projectCard(page, name).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/board$/);
  const path = new URL(page.url()).pathname;
  await page.getByRole("button", { name: "Back to projects" }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.locator(".skeleton-card")).toHaveCount(0);
  return path;
}

async function archiveFromCard(page: Page, name: string, key: string) {
  await page.getByRole("button", { name: `Edit ${name}` }).click();
  const dialog = page.getByRole("dialog", { name: "Edit project" });
  await dialog.getByRole("button", { name: "Archive project" }).click();
  await dialog.getByRole("button", { name: `Archive ${key}` }).click();
  await expect(dialog).toBeHidden();
}

/** Every write control the board and an open issue could offer, absent for whoever is reading. */
async function expectNoWrites(page: Page) {
  await expect(page.getByRole("button", { name: "New", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit project" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Manage labels" })).toHaveCount(0);
  await expect(page.locator(".column-head button")).toHaveCount(0);
  await expect(page.locator(".issue-card").first()).toHaveClass(/is-static/);
}

test("an ADMIN archives a project from its card: the card leaves, focus moves on, and the page says so", async ({
  page,
}) => {
  await signIn(page);
  await expect(page.getByText(/^3\s+projects/)).toBeVisible();

  await page.getByRole("button", { name: "Edit Web App" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit project" });
  await expect(dialog.getByText("Archiving hides WEB from Projects and makes its board read-only.")).toBeVisible();
  const trigger = dialog.getByRole("button", { name: "Archive project" });
  await trigger.click();

  // The consequence, said before anything is sent — and Cancel is where focus
  // lands, so a stray Enter does not archive.
  await expect(dialog.getByText("WEB will be archived for everyone. Taska cannot restore it.")).toBeVisible();
  const confirmCancel = dialog.locator(".project-archive-confirm").getByRole("button", { name: "Cancel" });
  await expect(confirmCancel).toBeFocused();

  // Esc closes the question, not the dialog, and hands focus back.
  await page.keyboard.press("Escape");
  await expect(dialog.locator(".project-archive-confirm")).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await dialog.getByRole("button", { name: /^Archive WEB$/ }).click();
  await expect(dialog).toBeHidden();

  // `GET /projects` no longer lists it: the card is gone, and the count with it.
  await expect(projectCard(page, "Web App")).toHaveCount(0);
  await expect(page.getByText(/^2\s+projects/)).toBeVisible();
  await expect(page.getByText("Archived", { exact: true })).toHaveCount(0);
  // The card that took its place has focus, and the page said what happened.
  await expect(projectCard(page, "Infra and Ops")).toBeFocused();
  await expect(page.getByRole("status").filter({ hasText: "WEB archived" })).toHaveText(
    "WEB archived. It no longer appears in Projects.",
  );
});

test("archiving from the board stays on it, read-only, with focus on the archive line", async ({ page }) => {
  await signIn(page);
  await projectCard(page, "Infra and Ops").click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/board$/);
  const boardUrl = page.url();
  await expect(page.locator(".board-project-name")).toHaveText("Infra and Ops");
  await expect(page.locator(".issue-card").first()).not.toHaveClass(/is-static/);

  await page.getByRole("button", { name: "Edit project" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit project" });
  await dialog.getByRole("button", { name: "Archive project" }).click();
  await dialog.getByRole("button", { name: /^Archive OPS$/ }).click();
  await expect(dialog).toBeHidden();

  // Still here: an archived project's board reads.
  expect(page.url()).toBe(boardUrl);
  const line = page.locator(".board-archive-line");
  await expect(line).toHaveText(/^Archived on [A-Z][a-z]{2} \d{1,2}\. This board and its issues are read-only\.$/);
  await expect(line).toBeFocused();
  // Not a problem of the board's, and no pill beside the name.
  await expect(page.getByRole("region", { name: "Board problems" })).toHaveCount(0);
  await expect(page.locator(".board-topbar").getByText("Archived")).toHaveCount(0);
  await expectNoWrites(page);

  // An issue opens, read-only, with the archive in the transition slot.
  await page.locator(".issue-card", { hasText: "OPS-3" }).click();
  const panel = page.getByRole("dialog", { name: "OPS-3 issue" });
  await expect(panel.getByText(/^This project was archived on [A-Z][a-z]{2} \d{1,2}, so this issue is read-only\.$/)).toBeVisible();
  await expect(panel.getByRole("button", { name: /Delete issue/ })).toHaveCount(0);
  await expect(panel.getByPlaceholder("Leave a comment")).toHaveCount(0);
  await page.getByRole("button", { name: "Close", exact: true }).click();

  // And it has left Projects.
  await page.getByRole("button", { name: "Back to projects" }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.locator(".skeleton-card")).toHaveCount(0);
  await expect(projectCard(page, "Infra and Ops")).toHaveCount(0);
});

test("a link to an archived project opens a read-only board with its issues", async ({ page }) => {
  await signIn(page);
  const webBoard = await boardPathOf(page, "Web App");
  await archiveFromCard(page, "Web App", "WEB");
  await expect(projectCard(page, "Web App")).toHaveCount(0);

  await openInApp(page, webBoard);

  await expect(page.locator(".board-project-name")).toHaveText("Web App");
  await expect(page.locator(".board-archive-line")).toBeVisible();
  // Arriving on it is not a change under anybody: the line does not take focus.
  await expect(page.locator(".board-archive-line")).not.toBeFocused();
  await expect(page.locator(".issue-card", { hasText: "WEB-" }).first()).toBeVisible();
  await expectNoWrites(page);
});

test("an archived project offers no write to a MEMBER or a VIEWER either", async ({ page }) => {
  await signIn(page);
  const taskaBoard = await boardPathOf(page, "Taska Platform");
  await archiveFromCard(page, "Taska Platform", "TAS");

  for (const [from, email] of [
    ["Anna Ivanova", "mark@example.com"],
    ["Mark Lee", "tom@example.com"],
  ] as const) {
    await switchAccount(page, from, email);
    // Gone from their Projects too.
    await expect(projectCard(page, "Taska Platform")).toHaveCount(0);

    await openInApp(page, taskaBoard);
    await expect(page.locator(".board-archive-line")).toBeVisible();
    await expectNoWrites(page);
    // No "role is unstated" banner and no role sentence: the archive is the reason.
    await expect(page.getByRole("region", { name: "Board problems" })).toHaveCount(0);

    await page.locator(".issue-card", { hasText: "TAS-102" }).click();
    const panel = page.getByRole("dialog", { name: "TAS-102 issue" });
    await expect(panel.getByText(/so this issue is read-only\.$/)).toBeVisible();
    await expect(panel.getByRole("group", { name: "Status" }).getByRole("button")).toHaveCount(0);
    await expect(panel.getByRole("button", { name: /Delete issue/ })).toHaveCount(0);
    await expect(panel.getByPlaceholder("Leave a comment")).toHaveCount(0);
    await page.getByRole("button", { name: "Close", exact: true }).click();

    await page.getByRole("button", { name: "Back to projects" }).click();
    await expect(page).toHaveURL(/\/projects$/);
    await expect(page.locator(".skeleton-card")).toHaveCount(0);
  }
});

test("a write refused because the project was archived meanwhile says so, keeps the text and turns the board read-only", async ({
  page,
}) => {
  await signIn(page);
  await projectCard(page, "Taska Platform").click();
  await page.locator(".issue-card", { hasText: "TAS-102" }).click();
  const panel = page.getByRole("dialog", { name: "TAS-102 issue" });

  // The mock's stand-in for another ADMIN archiving it a moment before
  // (`MOCK_PROJECT_TRIGGERS.archivedMeanwhile`).
  const text = "Ready for review [archived meanwhile]";
  const composer = panel.getByPlaceholder("Leave a comment");
  await composer.fill(text);
  await panel.getByRole("button", { name: "Comment", exact: true }).click();

  // Our sentence where the reader acted, not the server's.
  await expect(panel.getByText("This project has been archived, so nothing in it can be changed.")).toBeVisible();
  await expect(panel.getByText("Project is archived")).toHaveCount(0);
  // The board read its context again and turned read-only from it.
  await expect(page.locator(".board-archive-line")).toBeAttached();
  const note = panel.getByText(/^This project was archived on [A-Z][a-z]{2} \d{1,2}, so this issue is read-only\.$/);
  await expect(note).toBeVisible();
  // The reader's words stay, read-only; the button that could send them went,
  // and focus went to the panel's archive line rather than to the page.
  await expect(composer).toHaveValue(text);
  await expect(composer).not.toBeEditable();
  await expect(panel.getByRole("button", { name: "Comment", exact: true })).toHaveCount(0);
  await expect(note).toBeFocused();
});

for (const [role, email] of [
  ["MEMBER", "mark@example.com"],
  ["VIEWER", "tom@example.com"],
] as const) {
  test(`a ${role} is offered no Archive control on Taska Platform`, async ({ page }) => {
    await signIn(page, email);

    // Absent from the markup rather than hidden — and the server refuses the
    // DELETE either way (DESIGN.md §5.7).
    await expect(page.getByRole("button", { name: "Edit Taska Platform" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Archive/ })).toHaveCount(0);

    await projectCard(page, "Taska Platform").click();
    await expect(page).toHaveURL(/\/projects\/[^/]+\/board$/);
    await expect(page.locator(".board-project-name")).toHaveText("Taska Platform");
    await expect(page.getByRole("button", { name: "Edit project" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Archive/ })).toHaveCount(0);
  });
}

// A dialog open when somebody else archives the project (DESIGN.md §4.11, §5.7,
// «Архив пришёл отказом записи»; art-director B1–B4 on TAS-149). The dialog
// stays open and goes read-only; its own refusal says why; and focus, when the
// control that had it goes, stays inside the dialog — never on the board's
// line under the scrim.
test.describe("a dialog open when the project is archived elsewhere", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  async function openTaskaBoard(page: Page) {
    await projectCard(page, "Taska Platform").click();
    await expect(page).toHaveURL(/\/projects\/[^/]+\/board$/);
    await expect(page.locator(".issue-card").first()).toBeVisible();
  }

  test("New issue keeps the draft read-only, says the refusal, and keeps focus inside", async ({ page }) => {
    await openTaskaBoard(page);
    await page.getByRole("button", { name: "New", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "New issue" });
    const summary = dialog.getByLabel("Summary");
    await summary.fill("A drafted issue");

    await archiveElsewhere(page, "TAS");
    await dialog.getByRole("button", { name: "Create issue" }).click();

    const refusal = dialog.locator(".error-note");
    await expect(refusal).toContainText(ARCHIVED_REFUSAL);
    await expect(page.locator(".board-archive-line")).toBeAttached();
    await expect(dialog.getByRole("button", { name: "Create issue" })).toHaveCount(0);
    await expect(summary).toHaveValue("A drafted issue");
    await expect(summary).not.toBeEditable();
    await expect(dialog.getByRole("button", { name: "High", exact: true })).toHaveAttribute("aria-disabled", "true");
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeVisible();
    // One fact, one place: the refusal says it, so the line does not.
    await expect(dialog.getByText("This project is archived, so issues cannot be created in it.")).toHaveCount(0);
    await expect(refusal).toBeFocused();
    await expect(page.locator(".board-archive-line")).not.toBeFocused();
  });

  test("Labels loses its form and row actions, and keeps focus on its refusal", async ({ page }) => {
    await openTaskaBoard(page);
    await page.getByRole("button", { name: "Manage labels" }).click();
    const dialog = page.getByRole("dialog", { name: "Labels" });
    await expect(dialog.locator(".label-manage-row").first()).toBeVisible();
    await dialog.getByLabel("New label").fill("release");

    await archiveElsewhere(page, "TAS");
    await dialog.getByRole("button", { name: "Add label" }).click();

    const refusal = dialog.locator(".error-note");
    await expect(refusal).toContainText(ARCHIVED_REFUSAL);
    await expect(dialog.getByLabel("New label")).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Add label" })).toHaveCount(0);
    await expect(dialog.locator(".label-manage-row .icon-button")).toHaveCount(0);
    await expect(dialog.locator(".label-manage-row").first()).toBeVisible();
    await expect(dialog.getByText("This project is archived, so its labels cannot be changed.")).toHaveCount(0);
    await expect(refusal).toBeFocused();

    // Closed, it has no opener left to hand focus back to: the board's line takes it.
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator(".board-archive-line")).toBeFocused();
  });

  test("the board's Edit project keeps what was typed, loses Save and the danger zone, and keeps focus", async ({
    page,
  }) => {
    await openTaskaBoard(page);
    await page.getByRole("button", { name: "Edit project" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit project" });
    const description = dialog.getByLabel("Description");
    await description.fill("Typed and kept");

    await archiveElsewhere(page, "TAS");
    await dialog.getByRole("button", { name: "Save changes" }).click();

    const refusal = dialog.locator(".error-note");
    await expect(refusal).toContainText(ARCHIVED_REFUSAL);
    await expect(dialog.getByRole("button", { name: "Save changes" })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Archive project" })).toHaveCount(0);
    await expect(description).toHaveValue("Typed and kept");
    await expect(description).not.toBeEditable();
    await expect(dialog.getByLabel("Name")).not.toBeEditable();
    await expect(dialog.getByRole("button", { name: /Automatic colour/ })).toHaveAttribute("aria-disabled", "true");
    await expect(dialog.getByText("This project is archived, so it cannot be edited.")).toHaveCount(0);
    await expect(refusal).toBeFocused();
  });

  test("on Projects, the Edit dialog outlives the refetch that drops its row, then hands focus on", async ({ page }) => {
    await page.getByRole("button", { name: "Edit Web App" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit project" });
    const name = dialog.getByLabel("Name");
    await name.fill("Web App Renamed");

    await archiveElsewhere(page, "WEB");
    await dialog.getByRole("button", { name: "Save changes" }).click();

    await expect(dialog.locator(".error-note")).toContainText(ARCHIVED_REFUSAL);
    // The list read again and no longer lists it: the card goes, the dialog stays.
    await expect(projectCard(page, "Web App")).toHaveCount(0);
    await expect(page.getByText(/^2\s+projects/)).toBeVisible();
    await expect(dialog).toBeVisible();
    await expect(name).toHaveValue("Web App Renamed");
    await expect(name).not.toBeEditable();
    await expect(dialog.getByRole("button", { name: "Save changes" })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Archive project" })).toHaveCount(0);
    await expect(dialog.getByText(/no longer appears in Projects/)).toHaveCount(0);

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expect(projectCard(page, "Infra and Ops")).toBeFocused();
    // The dialog said it; the page does not say it again.
    await expect(page.getByRole("status").filter({ hasText: "archived" })).toHaveCount(0);
  });

  test("summary text the archive caught unsaved keeps the panel open on Esc", async ({ page }) => {
    await openTaskaBoard(page);
    await page.locator(".issue-card", { hasText: "TAS-102" }).click();
    const panel = page.getByRole("dialog", { name: "TAS-102 issue" });
    const summary = panel.locator("textarea.summary-textarea");
    await summary.click();
    await page.keyboard.press("End");
    await page.keyboard.type(" typed on");

    await archiveElsewhere(page, "TAS");
    // Leaving the box sends it; the refusal makes the board read its context again.
    await page.keyboard.press("Tab");
    await expect(panel.getByText(/^This project was archived on [A-Z][a-z]{2} \d{1,2}, so this issue is read-only\.$/)).toBeVisible();
    await expect(summary).toHaveValue(/ typed on$/);
    await expect(summary).not.toBeEditable();

    await summary.focus();
    await page.keyboard.press("Escape");
    await expect(panel).toBeVisible();
    await expect(summary).toHaveValue(/ typed on$/);
  });
});
