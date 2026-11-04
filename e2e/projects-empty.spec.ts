import { expect, test, type Page } from "@playwright/test";

/*
 * DESIGN.md §5.6 «Projects без проектов» (TAS-501), on the first server — the
 * stand's build, without companies: a reader with no projects at all gets one
 * line, «No projects yet.», and no second primary; a filter that matches
 * nothing keeps its own sentence. Anna is the ADMIN of her three projects
 * (archive-project.spec.ts), so she archives them from their cards; the mock's
 * store lives in the page, so everything stays in the app.
 */

async function archive(page: Page, name: string, key: string) {
  await page.getByRole("button", { name: `Edit ${name}` }).click();
  const dialog = page.getByRole("dialog", { name: "Edit project" });
  await dialog.getByRole("button", { name: "Archive project" }).click();
  await dialog.getByRole("button", { name: `Archive ${key}` }).click();
  await expect(dialog).toBeHidden();
}

test("with no projects at all, Projects says «No projects yet.» once, and New project is the action", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("anna@example.com");
  await page.getByLabel("Password", { exact: true }).fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.locator(".skeleton-card")).toHaveCount(0);

  await page.getByPlaceholder("Filter projects").fill("nothing like it");
  await expect(page.getByText("No projects match “nothing like it”.")).toBeVisible();
  await expect(page.getByText("No projects yet.")).toHaveCount(0);
  await page.getByPlaceholder("Filter projects").fill("");

  await archive(page, "Taska Platform", "TAS");
  await archive(page, "Web App", "WEB");
  await archive(page, "Infra and Ops", "OPS");
  await expect(page.locator("button.project-card")).toHaveCount(0);
  const empty = page.getByText("No projects yet.");
  await expect(empty).toBeVisible();
  await expect(empty).toHaveCSS("font-size", "13px");
  await expect(page.getByRole("button", { name: "New project" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "New project" })).toBeFocused();
});
