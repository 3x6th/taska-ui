import { expect, test, type Page } from "@playwright/test";

// Like the other suites, this runs against MockTaskaApi
// (playwright.config.ts starts the server with VITE_TASKA_API_MODE=mock): any
// seeded ACTIVE user's email signs in with any password. Mark is the seed's
// only GLOBAL_ADMIN, so he is the only one who can reach this section — and
// being the only one is also what makes the last-active-admin refusal reachable
// by clicking.
//
// The seed carries one account of every status: Leo is INVITED and Nina is
// BLOCKED since TAS-186, Omar is LOCKED since TAS-188, and everybody else is
// ACTIVE. Omar is the only row that offers the third action — the server
// refuses Block from LOCKED, so nothing else can reach it. He is seeded rather
// than produced: `LOCKED` is not on the backend's `develop` and arrives with
// PR #146 alongside these three endpoints, so the mock is the only place the
// state can be seen at all until that merges.

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

test("resets the lockout on a locked account, which is the one action that row offers", async ({ page }) => {
  await openUsers(page);

  const row = page.getByRole("row").filter({ hasText: "Omar Haddad" });
  await expect(row.getByText("Locked")).toBeVisible();
  // Not Block and not Unblock: the server refuses both from LOCKED, so the row
  // carries the third write or none at all.
  await expect(row.getByRole("button", { name: /^(Block|Unblock) Omar Haddad$/ })).toHaveCount(0);

  await row.getByRole("button", { name: "Reset lockout for Omar Haddad" }).click();

  const dialog = page.getByRole("dialog", { name: "Reset lockout for Omar Haddad" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("LOCKED → ACTIVE")).toBeVisible();
  // The question an admin actually has, answered before they ask it.
  await expect(dialog.getByText(/does not change the password/i)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Reset lockout", exact: true })).toBeDisabled();

  await dialog.getByLabel("Reason").fill("Called in, identity confirmed");
  await dialog.getByRole("button", { name: "Reset lockout", exact: true }).click();

  await expect(dialog).toHaveCount(0);
  await expect(row.getByText("Active")).toBeVisible();
  // And the row now offers what an active account offers, with focus back on
  // it — *drawn*. The confirm was a pointer press, so a plain programmatic
  // `focus()` here matches `:focus-visible` false and the operator would get
  // focus back with nothing on screen saying where it went (§7).
  const back = row.getByRole("button", { name: "Block Omar Haddad" });
  await expect(back).toBeVisible();
  await expect(back).toBeFocused();
  expect(await page.evaluate(() => document.activeElement?.matches(":focus-visible"))).toBe(true);
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
