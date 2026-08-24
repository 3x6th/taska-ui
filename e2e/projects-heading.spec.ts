import { expect, test, type Page } from "@playwright/test";

// The "Filter projects" field and "New project" sit on one centred row, and
// they shipped 2px apart — §4.14 pins the field at 32, `.primary-button`
// defaults to 34. Cheap to pin and invisible to a unit test, which cannot see
// a computed box. This file runs on all three viewport projects, so 1920 and
// 1440 cover the side-by-side row and 390 covers the <=820 block where
// `.projects-heading` becomes a column and the row goes full width.
//
// Mock-backed like every spec here: any seeded user signs in with any password.

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("anna@example.com");
  await page.getByLabel("Password").fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);
}

test("the filter field and the New project button are the same height", async ({ page }) => {
  await signIn(page);
  // Both controls render before the projects query answers, but waiting for
  // the skeletons to clear keeps the measurement off a mid-render frame.
  await expect(page.locator(".skeleton-card")).toHaveCount(0);
  // The row is 12.5px/600 text in a webfont; measuring before it swaps in
  // reads a different product (TAS-181).
  await page.evaluate(() => document.fonts.ready);

  const field = await page.locator(".projects-heading-actions .search-box").boundingBox();
  const button = await page.locator(".projects-heading-actions .primary-button").boundingBox();
  expect(field).not.toBeNull();
  expect(button).not.toBeNull();

  expect(button?.height, "the button is not the field's height").toBe(field?.height);
  // Equal heights on a row that stopped centring them would still read as the
  // reported defect, so pin the shared centre line too.
  const fieldCentre = (field?.y ?? 0) + (field?.height ?? 0) / 2;
  const buttonCentre = (button?.y ?? 0) + (button?.height ?? 0) / 2;
  expect(Math.abs(fieldCentre - buttonCentre)).toBeLessThanOrEqual(0.5);
});
