import { expect, test } from "@playwright/test";

test("opens connected apps and disconnects an app", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("anna@example.com");
  await page.getByLabel("Password", { exact: true }).fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);
  await page.goto("/settings/connected-apps");
  await expect(page.getByText("claude.ai")).toBeVisible();
  // How to connect one (TAS-414), under the list with the build's MCP address.
  const guide = page.getByRole("region", { name: "Connect Claude" });
  await expect(guide.getByText("http://localhost:8087/mcp", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Disconnect Claude" }).click();
  await expect(page.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.getByRole("button", { name: "Disconnect app" }).click();
  await expect(page.getByText("No apps are connected yet.")).toBeVisible();
  await expect(guide).toBeVisible();
  await guide.getByRole("link", { name: "create an access token" }).click();
  await expect(page).toHaveURL(/\/settings\/tokens$/);
});
