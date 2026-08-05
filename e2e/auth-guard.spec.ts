import { expect, test } from "@playwright/test";

// Like the other suites, this runs against MockTaskaApi
// (playwright.config.ts starts the server with VITE_TASKA_API_MODE=mock): any
// seeded user's email signs in with any password, and a fresh browser context
// starts with no session in localStorage.

// The seeded Taska Platform project, the one holding TAS-101.
const BOARD = "/projects/2e74e49f-0f29-4e03-b4ec-adc4dbf2382e/board";

test("a signed-out deep link asks for a sign-in and then opens the page that was asked for", async ({ page }) => {
  await page.goto(BOARD);

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel("Email")).toBeVisible();

  await page.getByLabel("Email").fill("anna@example.com");
  await page.getByLabel("Password").fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();

  // The originally requested board, not the generic project list.
  await expect(page).toHaveURL(new RegExp(`${BOARD}$`));
  await expect(page.getByText("TAS-101", { exact: true })).toBeVisible();
});

test("the project list is not reachable without a session, and sign-in opens it", async ({ page }) => {
  await page.goto("/projects");

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel("Password")).toBeVisible();

  await page.getByLabel("Email").fill("anna@example.com");
  await page.getByLabel("Password").fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();

  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
});

test("a bare visit to the app root also asks for a sign-in and then lands on the project list", async ({ page }) => {
  // "/" redirects into /projects, so it reaches the guard as that page and
  // returns there after signing in — the same destination the previous test
  // gets by name. Both entry points are covered because they are the two ways
  // into the app that carry no page of their own.
  await page.goto("/");

  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel("Email").fill("anna@example.com");
  await page.getByLabel("Password").fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();

  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
});

test("an unknown URL still answers with the not found screen while signed out", async ({ page }) => {
  await page.goto("/definitely/not/a/page");

  // Criterion 4, and the case that catches a guard placed too high in the tree:
  // a page that does not exist must not be reported as a page behind a login.
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await expect(page).toHaveURL(/\/definitely\/not\/a\/page$/);
});

test("a signed-in visitor is sent on from the login form", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("anna@example.com");
  await page.getByLabel("Password").fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);

  await page.goto("/login");

  await expect(page).toHaveURL(/\/projects$/);
});
