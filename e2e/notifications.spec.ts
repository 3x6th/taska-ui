import { expect, test, type Page } from "@playwright/test";

// Clicking a notification rendered the not-found screen for every notification
// the deployed gateway actually sends (TAS-183). The mock used to seed frontend
// routes, so the whole defect lived in the gap between what the mock sent and
// what the gateway sends; the seed now carries the gateway's own shapes, which
// is what makes this spec able to fail.
//
// The three cases are unit-tested (src/domain/notifications.test.ts,
// src/screens/BoardScreen.test.tsx). This is the one thing neither can see: a
// real router deciding whether the destination is a screen or a 404.

async function openNotifications(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("anna@example.com");
  await page.getByLabel("Password").fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await page.getByRole("button", { name: /Taska Platform/ }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/board$/);

  // `exact` matters: the seeded board has an issue card whose summary mentions
  // notifications, and the default substring match picks it up as well.
  await page.getByRole("button", { name: "Notifications", exact: true }).click();
  await expect(page.locator(".notifications-popover")).toBeVisible();
}

test("a notification opens the issue it is about, not the not found screen", async ({ page }) => {
  await openNotifications(page);

  // The seed's first row: the gateway's own `/issues/{uuid}` path, which is not
  // a route this app has and used to be navigated to verbatim.
  await page.locator(".notification-item").first().click();

  await expect(page).toHaveURL(/\/projects\/[^/]+\/issues\/[^/]+$/);
  await expect(page.getByText("TAS-107", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /not found/i })).toHaveCount(0);
});

test("a notification whose id is only in its body opens the same way", async ({ page }) => {
  await openNotifications(page);

  await page.locator(".notification-item").nth(1).click();

  await expect(page).toHaveURL(/\/projects\/[^/]+\/issues\/[^/]+$/);
  await expect(page.getByText("TAS-101", { exact: true })).toBeVisible();
});

test("a notification with nothing behind it marks read and leaves the reader where they were", async ({ page }) => {
  await openNotifications(page);

  const board = page.url();
  const row = page.locator(".notification-item").nth(2);
  await expect(row).toHaveClass(/is-inert/);
  // `cursor: default` is the whole of what the class does, and there is no
  // cursor at 390 or on the keyboard path, so the row has to say it in words.
  await expect(row).toContainText("Nothing to open");
  await expect(page.locator(".notification-item", { hasText: "Nothing to open" })).toHaveCount(1);
  await row.click();

  // Still on the board, and the panel is still open — a row that goes nowhere
  // is not a row that closes the panel behind a reader who wanted to read on.
  await expect(page.locator(".notifications-popover")).toBeVisible();
  expect(page.url()).toBe(board);
});
