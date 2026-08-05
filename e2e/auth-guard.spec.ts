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
  // The owner asked for this screen to say nothing here: the guard explains
  // itself with the form, not with a sentence. Pinned so it cannot drift back.
  await expect(page.locator(".auth-notice")).toHaveCount(0);

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

test("the not-found screen's way out sends a signed-out visitor through the guard and on to the project list", async ({
  page,
}) => {
  // The only spec that reaches the guard by a click instead of a page load.
  // Every other one here uses page.goto(), which hands the URL to the server
  // and starts a fresh document; this one stays inside the running app, so it
  // is the case where the guard is React Router's <Navigate>, not a boot-time
  // redirect. The path matters because the Not-found screen's own primary
  // action points at /projects, which makes it the likeliest way a signed-out
  // visitor meets the guard in the product.
  await page.goto("/definitely/not/a/page");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();

  // Marked on the live document: a reload would replace <html> and take the
  // attribute with it, so its survival below is the proof that nothing left
  // the app.
  await page.evaluate(() => {
    document.documentElement.dataset.e2eDocument = "not-found";
  });

  await page.getByRole("link", { name: "Go to projects" }).click();

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator("html")).toHaveAttribute("data-e2e-document", "not-found");

  await page.getByLabel("Email").fill("anna@example.com");
  await page.getByLabel("Password").fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();

  // /projects was what the click asked for, so that is what sign-in opens.
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
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
