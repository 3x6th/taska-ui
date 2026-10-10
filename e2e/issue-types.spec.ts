import { expect, test } from "@playwright/test";

// The board offers the issue types the project context lists a workflow for,
// and nothing else (TAS-251, backend TAS-212). In the mock seed Infra and Ops
// allows only Task and Bug, so Story is offered neither by the type filter nor
// by the create form there.

test("a project that allows two issue types offers only those two", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("anna@example.com");
  await page.getByLabel("Password").fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);

  await page.locator(".project-card", { hasText: "Infra and Ops" }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/board$/);

  const typeFilter = page.locator(".filterbar .segmented");
  await expect(typeFilter.getByRole("button")).toHaveText(["All", "Task", "Bug"]);

  await page.getByRole("button", { name: "New" }).click();
  const dialog = page.getByRole("dialog");
  const types = dialog.locator(".segmented").first();
  await expect(types.getByRole("button")).toHaveText(["Task", "Bug"]);
  await expect(types.getByRole("button").first()).toHaveClass(/is-active/);
});
