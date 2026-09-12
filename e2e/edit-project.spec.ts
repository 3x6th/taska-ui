import { expect, test, type Page } from "@playwright/test";

// Editing a project — name, description, colour — and creating one with a
// description (TAS-148).
//
// Mock-backed like every spec here (playwright.config.ts starts the server with
// VITE_TASKA_API_MODE=mock): any seeded user signs in with any password. Anna
// is the first member of Taska Platform, which makes her its ADMIN, and that is
// what puts the edit control on the card and in the board header.
//
// What this file is NOT: a statement about the gateway.
// `PATCH /api/v1/projects/{id}` is backend PR #155 and was **open and
// undeployed** on 2026-09-12, where the path answers 405. Every rule leaned on
// here — ADMIN only, an empty description clears, an empty colour does not — is
// `MockTaskaStore` reading that PR's Java, not observed behaviour. Read these
// as pinning what the UI does.

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("anna@example.com");
  await page.getByLabel("Password").fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);
}

/** The card is a button and so is its edit control, so name them apart. */
const projectCard = (page: Page, name: string) => page.locator(".project-card", { hasText: name });

test("renames a project and recolours it, and the list follows without a reload", async ({ page }) => {
  await signIn(page);
  await expect(page.locator(".skeleton-card")).toHaveCount(0);

  const badge = projectCard(page, "Taska Platform").locator(".key-badge");
  const before = await badge.evaluate((node) => getComputedStyle(node).backgroundColor);

  await page.getByRole("button", { name: "Edit Taska Platform" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit project" });
  await expect(dialog).toBeVisible();

  // The key is stated and cannot be typed into: `UpdateProjectRequestDto`
  // carries no `projectKey`, because the key prefixes every issue key here.
  await expect(dialog.locator(".project-key-static .key-badge")).toHaveText("TAS");
  await expect(dialog.getByText(/Prefixes every issue key/)).toBeVisible();

  await dialog.getByLabel("Name").fill("Taska Core");
  await dialog.getByLabel("Description").fill("Gateway, auth and issues");
  // A colour the seed does not already wear, so the badge has to change.
  await dialog.getByRole("button", { name: "Colour #3fa863" }).click();
  await dialog.getByRole("button", { name: "Save changes" }).click();

  await expect(dialog).toBeHidden();
  const renamed = projectCard(page, "Taska Core");
  await expect(renamed).toBeVisible();
  await expect(renamed).toContainText("Gateway, auth and issues");
  await expect
    .poll(() => renamed.locator(".key-badge").evaluate((node) => getComputedStyle(node).backgroundColor))
    .not.toBe(before);

  // The board reads the same project from its own query, and its header badge
  // has to agree with the card that opened it.
  await renamed.click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/board$/);
  await expect(page.locator(".board-project-name")).toHaveText("Taska Core");
});

test("clears a description, and the card falls back to its placeholder rather than to nothing", async ({ page }) => {
  await signIn(page);
  await expect(page.locator(".skeleton-card")).toHaveCount(0);

  const card = projectCard(page, "Web App");
  await expect(card).toContainText("Customer-facing web client");

  await page.getByRole("button", { name: "Edit Web App" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit project" });
  await dialog.getByLabel("Description").fill("");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog).toBeHidden();

  // `""` is a description the server genuinely holds — it is what clearing one
  // sends — and it slips straight past a nullish check. Without the blank-aware
  // condition this line is an empty paragraph.
  await expect(card).toContainText("Project workspace");
});

test("offers no way back to an automatic colour once one is set, and says why", async ({ page }) => {
  await signIn(page);
  await expect(page.locator(".skeleton-card")).toHaveCount(0);

  // Taska Platform states #0052cc in the seed, so its door is already shut.
  await page.getByRole("button", { name: "Edit Taska Platform" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit project" });

  const automatic = dialog.getByRole("button", { name: /Automatic colour/ });
  await expect(automatic).toBeDisabled();
  await expect(dialog.getByText(/cannot be set back to automatic yet/)).toBeVisible();
});

test("creates a project with a description and a colour, and the card shows both", async ({ page }) => {
  await signIn(page);
  await expect(page.locator(".skeleton-card")).toHaveCount(0);

  await page.getByRole("button", { name: "New project" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });

  // The description box ships empty. It used to arrive pre-filled with "REST
  // facade over Taska services" — somebody's demo text typed into a form for
  // every reader — and until TAS-148 it reached no server either.
  await expect(dialog.getByLabel("Description")).toHaveValue("");

  // `exact`, because the Automatic swatch is named after the project key too
  // and a substring match finds both.
  await dialog.getByLabel("Key", { exact: true }).fill("DOC");
  await dialog.getByLabel("Name").fill("Documentation");
  await dialog.getByLabel("Description").fill("Guides and references");
  await dialog.getByRole("button", { name: "Colour #ec4899" }).click();
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect(dialog).toBeHidden();

  const card = projectCard(page, "Documentation");
  await expect(card).toBeVisible();
  // The description reached the server and came back, in place of the
  // placeholder a project without one draws.
  await expect(card).toContainText("Guides and references");
  await expect(card).not.toContainText("Project workspace");
});

test("shows no edit control to a reader who is not this project's admin", async ({ page }) => {
  // Mark is a MEMBER of Taska Platform and the ADMIN of Mobile, so one session
  // covers both answers — and the difference is the role, not the screen.
  await page.goto("/login");
  await page.getByLabel("Email").fill("mark@example.com");
  await page.getByLabel("Password").fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.locator(".skeleton-card")).toHaveCount(0);

  // Absent from the markup rather than hidden by a style — and the server
  // refuses the PATCH either way (DESIGN.md §5.7).
  await expect(page.getByRole("button", { name: "Edit Taska Platform" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit Mobile" })).toHaveCount(1);

  // Same rule on the board, read from the membership query that screen holds.
  await projectCard(page, "Taska Platform").click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/board$/);
  await expect(page.getByRole("button", { name: "Edit project" })).toHaveCount(0);
});

test("opens the dialog from the board header and reaches Save from the keyboard", async ({ page }) => {
  await signIn(page);
  await expect(page.locator(".skeleton-card")).toHaveCount(0);
  await projectCard(page, "Infra and Ops").click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/board$/);

  await page.getByRole("button", { name: "Edit project" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit project" });
  await expect(dialog).toBeVisible();

  // Infra and Ops states no colour in the seed, so this is the other half of
  // the door: Automatic is the selected state and still offered.
  const automatic = dialog.getByRole("button", { name: /Automatic colour/ });
  await expect(automatic).toBeEnabled();
  await expect(automatic).toHaveAttribute("aria-pressed", "true");

  // Every control is reachable and operable without a pointer (§7): the name
  // box has focus on open, and tabbing forward arrives at the swatches.
  await expect(dialog.getByLabel("Name")).toBeFocused();
  await dialog.getByLabel("Name").fill("Infra");
  await page.keyboard.press("Tab");
  await expect(dialog.getByLabel("Description")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(automatic).toBeFocused();

  await dialog.getByRole("button", { name: "Save changes" }).press("Enter");
  await expect(dialog).toBeHidden();
  await expect(page.locator(".board-project-name")).toHaveText("Infra");
});
