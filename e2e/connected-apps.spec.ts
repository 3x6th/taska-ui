import { expect, test } from "@playwright/test";

test("opens connected apps and disconnects an app", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("anna@example.com");
  await page.getByLabel("Password", { exact: true }).fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);
  await page.goto("/settings/connected-apps");
  await expect(page.getByText("claude.ai")).toBeVisible();
  await page.getByRole("button", { name: "Disconnect Claude" }).click();
  await expect(page.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.getByRole("button", { name: "Disconnect app" }).click();
  await expect(page.getByText("No connected apps.")).toBeVisible();
});
