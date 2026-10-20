import { expect, test, type Page } from "@playwright/test";

// Archiving a project (TAS-149): `DELETE /api/v1/projects/{id}`, backend PR #159
// (TAS-146) at head `97464fe`.
//
// Mock-backed like every spec here (playwright.config.ts): any seeded user signs
// in with any password. On Taska Platform, Anna is the ADMIN, Mark a MEMBER and
// Tom the VIEWER; Anna is also the ADMIN of Web App and Infra and Ops.
//
// What this file is NOT: a statement about the gateway. The route was **open
// and undeployed** on 2026-10-20, where the method answers 405, and that 405
// path cannot be reached against the mock at all (`isUndeployedRoute` needs an
// HTTP status) — it is pinned in src/components/EditProjectModal.test.tsx. So
// are two things this suite cannot see without a wire: the request id on an
// archived board's refusal (`MockApiError` carries none —
// src/screens/BoardScreen.test.tsx has it), and that nothing asks for the
// project's context after archiving (the mock makes no network request for a
// listener to count — EditProjectModal.test.tsx counts the calls instead).
//
// The mock refuses an archived project's board the way the PR's head does: the
// context composes issue-service's labels read, which refuses with
// FAILED_PRECONDITION "Project archived". TAS-146 asks whether reads should be
// allowed; this file changes when it answers.

async function signIn(page: Page, email = "anna@example.com") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.locator(".skeleton-card")).toHaveCount(0);
}

/** The card is a button and so is its edit control, so name them apart. */
const projectCard = (page: Page, name: string) => page.locator(".project-card", { hasText: name });

test("an ADMIN archives a project after confirming, and its card says Archived", async ({ page }) => {
  await signIn(page);
  const card = projectCard(page, "Web App");
  await expect(card.locator(".project-archived-badge")).toHaveCount(0);

  await page.getByRole("button", { name: "Edit Web App" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit project" });
  const trigger = dialog.getByRole("button", { name: "Archive project" });
  await trigger.click();

  // The consequence, said before anything is sent — and Cancel is where focus
  // lands, so a stray Enter does not archive.
  await expect(dialog.getByText(/Its board and issues stop opening, and there is no way to restore it/)).toBeVisible();
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

  // Still listed — nothing hides an archived project — and marked as one.
  await expect(card).toBeVisible();
  await expect(card.locator(".project-archived-badge")).toHaveText("Archived");
  // The reader is still its ADMIN: the answer's `currentUserRole: null` was not
  // spread over the row.
  await expect(page.getByRole("button", { name: "Edit Web App" })).toBeVisible();
});

test("opening an archived project's board shows the refusal, not a blank board", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Edit Web App" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit project" });
  await dialog.getByRole("button", { name: "Archive project" }).click();
  await dialog.getByRole("button", { name: /^Archive WEB$/ }).click();
  await expect(dialog).toBeHidden();

  await projectCard(page, "Web App").click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/board$/);

  // The generic frame-read failure, carrying the server's own sentence. The UI
  // matches on neither the code nor the words.
  const notices = page.getByRole("region", { name: "Board problems" });
  await expect(notices.getByText(/This project could not be loaded/)).toBeVisible();
  await expect(notices.getByText("Project archived").first()).toBeVisible();
});

test("archiving from the board leaves for the project list", async ({ page }) => {
  await signIn(page);
  await projectCard(page, "Infra and Ops").click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/board$/);
  await expect(page.locator(".board-project-name")).toHaveText("Infra and Ops");

  await page.getByRole("button", { name: "Edit project" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit project" });
  await dialog.getByRole("button", { name: "Archive project" }).click();
  await dialog.getByRole("button", { name: /^Archive OPS$/ }).click();

  // Every read the board would make next is refused, so it does not stay.
  await expect(page).toHaveURL(/\/projects$/);
  await expect(projectCard(page, "Infra and Ops").locator(".project-archived-badge")).toHaveText("Archived");
  // `replace`: Back does not reopen the board that would now be refused.
  await page.goBack();
  await expect(page).not.toHaveURL(/\/board$/);
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
