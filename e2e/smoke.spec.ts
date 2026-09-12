import { expect, test } from "@playwright/test";

// The suite always runs against MockTaskaApi (playwright.config.ts starts the
// server with VITE_TASKA_API_MODE=mock): any seeded user's email signs in with
// any password, and the board renders the seeded TAS issues.

test("signs in and reaches the project list", async ({ page }) => {
  await page.goto("/login");

  await page.getByLabel("Email").fill("anna@example.com");
  await page.getByLabel("Password").fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();

  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  // Addressed by class, not by role and name: since TAS-148 an ADMIN's card
  // carries an "Edit <name>" button of its own, and a loose match on the
  // project's name finds both (exact: true finds neither, since the card's
  // accessible name is its whole content and includes "loading members"
  // while the summary queries are in flight). The role check is what the
  // class locator gives up, so it comes back explicitly.
  const card = page.locator(".project-card", { hasText: "Taska Platform" });
  await expect(card).toBeVisible();
  await expect(card).toHaveRole("button");
});

test("opens a project board with its seeded issues", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("anna@example.com");
  await page.getByLabel("Password").fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();

  await page.locator(".project-card", { hasText: "Taska Platform" }).click();

  await expect(page).toHaveURL(/\/projects\/[^/]+\/board$/);
  await expect(page.getByText("TAS-101", { exact: true })).toBeVisible();
});

test("rejects an unknown account with a visible error", async ({ page }) => {
  await page.goto("/login");

  await page.getByLabel("Email").fill("nobody@example.com");
  await page.getByLabel("Password").fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();

  await expect(page.getByText("Invalid credentials")).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});
