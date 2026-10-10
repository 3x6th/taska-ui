import { expect, test, type Page } from "@playwright/test";

// The Audit section (TAS-251) against MockTaskaApi, which seeds thirty audit
// entries at fixed instants (newest 2026-10-09T16:40:00Z, about seventeen hours
// apart) and answers `GET /readonly/audit-entries` as the server is meant to:
// paged newest first, exact filters, whole-UTC-day bounds, GLOBAL_ADMIN only.
// Mark is the seed's only GLOBAL_ADMIN.

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);
}

async function openAudit(page: Page) {
  await signIn(page, "mark@example.com");
  await page.goto("/admin");
  await page.getByRole("navigation", { name: "Administration" }).getByRole("link", { name: "Audit" }).click();
  await expect(page).toHaveURL(/\/admin\/audit$/);
  await expect(page.getByRole("table", { name: "Audit entries" })).toBeVisible();
}

const entryRows = (page: Page) => page.getByRole("table", { name: "Audit entries" }).locator("tbody > tr.admin-row-opens");

async function applyFilter(page: Page, label: string, value: string) {
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Filter audit entries" });
  await dialog.getByLabel("Filter").selectOption({ label });
  await dialog.getByLabel(/^Value/).fill(value);
  await dialog.getByRole("button", { name: "Apply" }).click();
  return dialog;
}

test("pages through the log with the page in the URL, and a reload keeps it", async ({ page }) => {
  await openAudit(page);

  await expect(page.getByText("30 entries")).toBeVisible();
  await expect(page.getByText("Page 1 of 2")).toBeVisible();
  await expect(entryRows(page)).toHaveCount(20);
  await expect(entryRows(page).first()).toContainText("2026-10-09T16:40:00Z");

  await page.getByRole("button", { name: "Next" }).click();
  await expect(page).toHaveURL(/\/admin\/audit\?page=2$/);
  await expect(entryRows(page)).toHaveCount(10);

  await page.reload();
  await expect(page.getByText("Page 2 of 2")).toBeVisible();
  await expect(entryRows(page)).toHaveCount(10);
});

test("filters by name, keeps every filter in the URL, and a shared link arrives filtered", async ({ page }) => {
  await openAudit(page);

  await applyFilter(page, "Action is", "RESET_CREDENTIAL_LOCKOUT");
  await expect(page).toHaveURL(/filter=action%3Aequals%3ARESET_CREDENTIAL_LOCKOUT/);
  await expect(page.getByRole("button", { name: "Action is RESET_CREDENTIAL_LOCKOUT", exact: true })).toBeVisible();
  // The seed holds four of them; waiting on the count is waiting on the answer.
  await expect(page.getByText("4 entries")).toBeVisible();
  await expect(entryRows(page)).toHaveCount(4);
  for (let index = 0; index < 4; index += 1) {
    await expect(entryRows(page).nth(index)).toContainText("RESET_CREDENTIAL_LOCKOUT");
  }

  // One whole UTC day, both ends inclusive: 2026-10-08 holds exactly one of
  // the four, at 06:40Z.
  await applyFilter(page, "From", "2026-10-08");
  await applyFilter(page, "To", "2026-10-08");
  await expect(page).toHaveURL(/createdAt%3Afrom%3A2026-10-08/);
  await expect(page.getByText("1 entry", { exact: true })).toBeVisible();
  await expect(entryRows(page)).toHaveCount(1);
  await expect(entryRows(page).first()).toContainText("2026-10-08T06:40:00Z");

  const shared = page.url();
  await page.goto(shared);
  await expect(page.getByRole("button", { name: "From 2026-10-08", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "To 2026-10-08", exact: true })).toBeVisible();
  await expect(entryRows(page)).toHaveCount(1);
});

test("refuses an actor id that is not a UUID and a From after To, in the popover", async ({ page }) => {
  await openAudit(page);

  const dialog = await applyFilter(page, "Actor id is", "mark");
  await expect(dialog.getByRole("alert")).toContainText("actor id is a UUID");
  await expect(page).toHaveURL(/\/admin\/audit$/);
  await page.keyboard.press("Escape");

  await applyFilter(page, "To", "2026-10-01");
  const second = await applyFilter(page, "From", "2026-10-05");
  await expect(second.getByRole("alert")).toContainText("From is after To");
  await expect(page).not.toHaveURL(/createdAt%3Afrom/);
});

test("opens an entry from the keyboard and shows the old and new values", async ({ page }) => {
  await openAudit(page);
  await applyFilter(page, "Action is", "BLOCK_USER");

  const toggle = entryRows(page).first().getByRole("button", { name: /^Changes of BLOCK_USER at / });
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");

  const old = page.getByRole("figure", { name: "Old value" });
  const next = page.getByRole("figure", { name: "New value" });
  await expect(old.locator("pre")).toHaveText(JSON.stringify({ status: "ACTIVE" }, null, 2));
  await expect(next.locator("pre")).toHaveText(JSON.stringify({ status: "BLOCKED" }, null, 2));

  // Side by side where there is room for two documents, one above the other on
  // a phone — measured, because the point of the layout is the comparison.
  const oldBox = (await old.boundingBox())!;
  const nextBox = (await next.boundingBox())!;
  const viewport = page.viewportSize()!;
  if (viewport.width >= 900) {
    expect(Math.abs(oldBox.y - nextBox.y)).toBeLessThan(2);
    expect(nextBox.x).toBeGreaterThan(oldBox.x + oldBox.width - 1);
  } else {
    expect(nextBox.y).toBeGreaterThan(oldBox.y + oldBox.height - 1);
  }
  // The comparison stays inside the visible width of the table's box.
  expect(nextBox.x + nextBox.width).toBeLessThanOrEqual(viewport.width + 1);

  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(old).toHaveCount(0);
});

test("is not there at all for an account that is not a global admin", async ({ page }) => {
  await signIn(page, "anna@example.com");
  await page.goto("/admin/audit");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});
