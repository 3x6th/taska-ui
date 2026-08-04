import { expect, test, type Page } from "@playwright/test";

// Like the smoke suite, this always runs against MockTaskaApi
// (playwright.config.ts starts the server with VITE_TASKA_API_MODE=mock): any
// seeded user's email signs in with any password, and an unseeded project id
// answers NOT_FOUND.

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("anna@example.com");
  await page.getByLabel("Password").fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);
}

test("unknown URL shows the not found screen", async ({ page }) => {
  await signIn(page);

  await page.goto("/definitely/not/a/page");

  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();

  await page.getByRole("link", { name: "Go to projects" }).click();
  await expect(page).toHaveURL(/\/projects$/);
});

test("board of a missing project shows the not found screen", async ({ page }) => {
  await signIn(page);

  // A well-formed id that the mock does not seed: the route matches, the
  // project lookup does not.
  await page.goto("/projects/00000000-0000-0000-0000-000000000000/board");

  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});
