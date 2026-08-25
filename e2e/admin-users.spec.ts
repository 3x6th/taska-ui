import { expect, test, type Page } from "@playwright/test";

// Like the other suites, this runs against MockTaskaApi
// (playwright.config.ts starts the server with VITE_TASKA_API_MODE=mock): any
// seeded ACTIVE user's email signs in with any password. Mark is the seed's
// only GLOBAL_ADMIN, so he is the only one who can reach this section — and
// being the only one is also what makes the last-active-admin refusal reachable
// by clicking.
//
// The seed carries one account of every status since TAS-186: Leo is INVITED,
// Nina is BLOCKED, everybody else is ACTIVE.

async function openUsers(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("mark@example.com");
  await page.getByLabel("Password").fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);

  await page.goto("/admin");
  await page.getByRole("navigation", { name: "Administration" }).getByRole("link", { name: "Users" }).click();
  await expect(page).toHaveURL(/\/admin\/users$/);
  await expect(page.getByRole("heading", { level: 1, name: "Users" })).toBeVisible();
}

test("blocks an account with a reason and the row's status changes to the one the server named", async ({ page }) => {
  await openUsers(page);

  const row = page.getByRole("row").filter({ hasText: "Anna Ivanova" });
  await expect(row.getByText("Active")).toBeVisible();

  await row.getByRole("button", { name: "Block Anna Ivanova" }).click();

  const dialog = page.getByRole("dialog", { name: "Block Anna Ivanova" });
  await expect(dialog).toBeVisible();
  // The transition is named before it is asked for, and the confirmation is off
  // until there is a reason — the server refuses a blank one with a 400, and
  // the boundary is the worst place to learn that.
  await expect(dialog.getByText("ACTIVE → BLOCKED")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Block", exact: true })).toBeDisabled();

  await dialog.getByLabel("Reason").fill("Left the company");
  await dialog.getByRole("button", { name: "Block", exact: true }).click();

  // Nothing was optimistic: the pill flips only once the server has answered,
  // and it flips to the status the *server* named (§5.8).
  await expect(dialog).toHaveCount(0);
  await expect(row.getByText("Blocked")).toBeVisible();
  await expect(row.getByRole("button", { name: "Unblock Anna Ivanova" })).toBeVisible();
});

test("refuses to block the last active global admin and keeps the dialog open", async ({ page }) => {
  await openUsers(page);

  const row = page.getByRole("row").filter({ hasText: "Mark Lee" });
  await row.getByRole("button", { name: "Block Mark Lee" }).click();

  const dialog = page.getByRole("dialog", { name: "Block Mark Lee" });
  // Blocking your own account is not forbidden on the client — the server owns
  // the only rule there is, and the dialog says which account this is instead.
  await expect(dialog.getByText(/account you are signed in as/i)).toBeVisible();
  await dialog.getByLabel("Reason").fill("Testing the guard");
  await dialog.getByRole("button", { name: "Block", exact: true }).click();

  await expect(dialog.getByRole("alert")).toContainText("Cannot block the last active global admin");
  await expect(dialog).toBeVisible();
  await expect(row.getByText("Active")).toBeVisible();
});
