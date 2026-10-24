import { expect, test, type Page } from "@playwright/test";

// The email line under the profile name (DESIGN.md §4.16 and §5.9, TAS-389;
// e2e asked for in TAS-396): `--fg-2`, whole and never cut — a cut address is
// a different address — so a long one wraps anywhere instead, inside its
// column. Against MockTaskaApi like every suite here; any seeded user signs in
// with any password.
//
// The seed's addresses are short enough never to wrap, so the line is
// lengthened in place to the 51 characters art-director measured with (the
// menu's text column is 202 wide on every viewport). What is measured is the
// line's CSS. One `evaluate` after the fonts load, so a font swap cannot land
// between two readings.

const LONG_EMAIL = "maximilian.featherstonehaugh.montgomery@example.com";

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("anna@example.com");
  await page.getByLabel("Password", { exact: true }).fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);
}

/** Lengthens the email line under `selector` and reports how it lays out against its column. */
function measureEmailLine(page: Page, selector: string, email: string) {
  return page.evaluate(
    ([lineSelector, address]) => {
      const line = document.querySelector<HTMLElement>(lineSelector)!;
      const lineHeight = parseFloat(getComputedStyle(line).lineHeight);
      const single = line.getBoundingClientRect().height;
      line.textContent = address;
      const box = line.getBoundingClientRect();
      const column = line.parentElement!.getBoundingClientRect();
      return {
        lines: Math.round(box.height / lineHeight),
        singleLines: Math.round(single / lineHeight),
        insideColumn: box.left >= column.left - 0.5 && box.right <= column.right + 0.5,
        overflows: line.scrollWidth > line.clientWidth + 0.5,
        textOverflow: getComputedStyle(line).textOverflow,
        text: line.textContent,
      };
    },
    [selector, email] as const,
  );
}

test("the profile menu's email line wraps a long address whole, inside its column", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: /Open profile/ }).click();
  const dialog = page.getByRole("dialog", { name: "Current user profile" });
  await expect(dialog.getByText("anna@example.com", { exact: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);

  const header = await dialog.locator(".user-profile-head").boundingBox();
  const line = await measureEmailLine(page, ".user-profile-head > div > span", LONG_EMAIL);
  const grown = await dialog.locator(".user-profile-head").boundingBox();

  expect(line.singleLines).toBe(1);
  expect(line.lines).toBe(2);
  expect(line.insideColumn).toBe(true);
  expect(line.overflows).toBe(false);
  expect(line.textOverflow).not.toBe("ellipsis");
  expect(line.text).toBe(LONG_EMAIL);
  // The header grows with the second line (62 → 79 measured) rather than
  // clipping it.
  expect(grown!.height).toBeGreaterThan(header!.height + 10);
});

test("the settings profile's email line wraps a long address whole, inside its column", async ({ page }) => {
  await signIn(page);
  await page.goto("/settings/profile");
  await expect(page.locator(".settings-profile-email")).toHaveText("anna@example.com");
  await page.evaluate(() => document.fonts.ready);

  const line = await measureEmailLine(page, ".settings-profile-email", LONG_EMAIL);

  expect(line.singleLines).toBe(1);
  expect(line.insideColumn).toBe(true);
  expect(line.overflows).toBe(false);
  expect(line.textOverflow).not.toBe("ellipsis");
  expect(line.text).toBe(LONG_EMAIL);
  // The phone is where the column is narrow enough to need the second line.
  if (page.viewportSize()!.width <= 390) expect(line.lines).toBeGreaterThanOrEqual(2);
});
