import { expect, test, type Locator, type Page } from "@playwright/test";

// TAS-257: the issue panel's Activity heading folds the feed away, and the
// choice is the reader's, not the issue's — one key in the browser, kept the
// way the theme is, so it holds across issues and across a reload until the
// heading is pressed again.
//
// Mock-backed like every spec here (playwright.config.ts starts the server with
// VITE_TASKA_API_MODE=mock): any seeded user signs in with any password. TAS-107
// is seeded with a history of its own (created, assigned, moved), so its feed
// has rows to fold; TAS-102 is the "different issue". Each test gets a fresh
// browser context, so its storage starts empty and the feed starts expanded,
// and nothing folded here leaks into another spec's `.activity` assertions.

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("anna@example.com");
  await page.getByLabel("Password", { exact: true }).fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);
}

async function openBoard(page: Page) {
  // By class, not by role and name: an ADMIN's project card carries an
  // "Edit <name>" button of its own (TAS-148), and a loose name match finds both.
  await page.locator(".project-card", { hasText: "Taska Platform" }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/board$/);
}

async function openIssue(page: Page, issueKey: string): Promise<Locator> {
  await page.locator(".issue-card", { hasText: issueKey }).click();
  const panel = page.getByRole("dialog", { name: `${issueKey} issue` });
  await expect(panel).toBeVisible();
  return panel;
}

async function closeIssue(page: Page, issueKey: string) {
  // Exact: the backdrop behind the panel is also a button, named "Close issue".
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("dialog", { name: `${issueKey} issue` })).toHaveCount(0);
}

/** The heading's one button: chevron, "Activity" and the count, so the name starts with the word. */
const toggleOf = (panel: Locator) => panel.getByRole("button", { name: /^Activity/ });
const itemsOf = (panel: Locator) => panel.locator(".activity-item");
const stored = (page: Page) => page.evaluate(() => window.localStorage.getItem("taska.activityCollapsed"));

test("the activity feed folds from its heading and stays folded on another issue and after a reload", async ({ page }) => {
  await signIn(page);
  await openBoard(page);
  let panel = await openIssue(page, "TAS-107");
  let toggle = toggleOf(panel);

  // Expanded by default, as before.
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(itemsOf(panel).first()).toBeVisible();
  expect(await itemsOf(panel).count()).toBeGreaterThan(0);

  await toggle.click();

  // Folded: the rows are gone, and the heading with its count stays.
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(itemsOf(panel)).toHaveCount(0);
  await expect(toggle.locator(".count-pill")).toBeVisible();
  expect(await stored(page)).toBe("1");

  // A different issue opens folded too.
  await closeIssue(page, "TAS-107");
  panel = await openIssue(page, "TAS-102");
  await expect(toggleOf(panel)).toHaveAttribute("aria-expanded", "false");
  await expect(itemsOf(panel)).toHaveCount(0);

  // And so does the first one after a reload. Closed first, so the reload lands
  // on the board and the issue is opened the way a reader opens it.
  await closeIssue(page, "TAS-102");
  await page.reload();
  panel = await openIssue(page, "TAS-107");
  toggle = toggleOf(panel);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(itemsOf(panel)).toHaveCount(0);

  await toggle.click();

  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(itemsOf(panel).first()).toBeVisible();
  expect(await stored(page)).toBeNull();
});

test("the activity heading folds and opens from the keyboard", async ({ page }) => {
  await signIn(page);
  await openBoard(page);
  const panel = await openIssue(page, "TAS-107");
  const toggle = toggleOf(panel);
  await expect(toggle).toHaveAttribute("aria-expanded", "true");

  await toggle.focus();
  await expect(toggle).toBeFocused();
  await page.keyboard.press("Space");

  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(itemsOf(panel)).toHaveCount(0);
  // The same button, still holding focus, so the next key undoes it.
  await expect(toggle).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(itemsOf(panel).first()).toBeVisible();
});
