import { expect, test, type Page } from "@playwright/test";

// Like the other suites, this runs against MockTaskaApi
// (playwright.config.ts starts the server with VITE_TASKA_API_MODE=mock): any
// seeded user's email signs in with any password. Mark is the seed's only
// GLOBAL_ADMIN; Anna is a plain USER.

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);
}

test("a global admin finds the administration entry in the profile menu and it opens the section", async ({ page }) => {
  await signIn(page, "mark@example.com");

  await page.getByRole("button", { name: "Open profile for Mark Lee" }).click();

  const entry = page.getByRole("link", { name: "Administration" });
  await expect(entry).toBeVisible();
  // A page, so it is a link with a real href — middle-clickable and copyable.
  await expect(entry).toHaveAttribute("href", "/admin");

  await entry.click();

  // /admin is an area, and a bare visit resolves into its first section
  // (DESIGN.md §5.8) — visibly, in the address bar.
  await expect(page).toHaveURL(/\/admin\/data/);
  await expect(page.getByRole("heading", { level: 1, name: "Data" })).toBeVisible();
  // The route changed, so this proves the previous screen — popover and all —
  // was replaced, not that selecting an item closes the popover (§4.16). That
  // behaviour is pinned in src/components/UserProfileMenu.test.tsx, where
  // nothing navigates away from under it.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // The same shell as the project list, and a way back out of it — which now
  // lives in the section rail, not under the content.
  await expect(page.getByRole("button", { name: "Open profile for Mark Lee" })).toBeVisible();
  await page
    .getByRole("navigation", { name: "Administration" })
    .getByRole("link", { name: "Back to projects" })
    .click();
  await expect(page).toHaveURL(/\/projects$/);
});

test("a plain user has no administration entry in the menu", async ({ page }) => {
  await signIn(page, "anna@example.com");

  await page.getByRole("button", { name: "Open profile for Anna Ivanova" }).click();

  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();
  // Absent from the markup, not merely hidden: nothing named Administration
  // exists anywhere in the document.
  await expect(page.getByText("Administration")).toHaveCount(0);
});

test("a plain user who types /admin gets the same answer as an unknown URL", async ({ page }) => {
  await signIn(page, "anna@example.com");

  await page.goto("/admin");

  // Not "no access": the section's existence is not confirmed to someone who
  // cannot use it (DESIGN.md §4.18). The gate answers before anything of the
  // area renders, so the address does not even resolve into a section.
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Administration" })).toHaveCount(0);
  await expect(page).toHaveURL(/\/admin$/);
});

test("a signed-out visitor to /admin is asked to sign in and lands where they asked", async ({ page }) => {
  await page.goto("/admin");

  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel("Email").fill("mark@example.com");
  await page.getByLabel("Password").fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();

  await expect(page).toHaveURL(/\/admin/);
  await expect(page.getByRole("heading", { level: 1, name: "Data" })).toBeVisible();
});
