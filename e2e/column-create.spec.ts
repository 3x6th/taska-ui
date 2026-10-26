import { expect, test } from "@playwright/test";

// The column "+" until backend TAS-428 (DESIGN.md §4.9, §5.5 P3′): the server
// creates every issue in TODO, so only the To Do column offers a "+", and its
// form — "New issue in To Do" — switches off a type whose workflow has no To Do.
// Against the mock: Mobile's INCIDENT runs on such a workflow (Triage,
// Resolved), and Mark is Mobile's ADMIN. Nothing here is evidence about the
// gateway.

test("only To Do offers a +, and its form names the column and switches off a type without it", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("mark@example.com");
  await page.getByLabel("Password", { exact: true }).fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);
  await page.locator(".project-card", { hasText: "Mobile" }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/board$/);

  const todo = page.getByRole("region", { name: "To Do column" });
  const plus = todo.getByRole("button", { name: "Create issue in To Do" });
  await expect(plus).toBeVisible();
  await expect(plus).toHaveAttribute("title", "Create issue in To Do");
  for (const name of ["Triage", "In Progress", "Done", "Resolved"]) {
    await expect(page.getByRole("region", { name: `${name} column` }).getByRole("button", { name: /^Create issue/ })).toHaveCount(0);
  }
  // The heads stay on one line with or without a "+" (§4.9: 35 high).
  const heights = await page
    .locator(".columns-area .board-column > .column-head")
    .evaluateAll((heads) => heads.map((head) => Math.round(head.getBoundingClientRect().height)));
  expect(new Set(heights).size).toBe(1);

  await plus.click();
  const dialog = page.getByRole("dialog", { name: "New issue in To Do" });
  await expect(dialog.getByRole("heading", { name: "New issue in To Do" })).toBeVisible();
  const type = dialog.getByRole("combobox", { name: "Type" });
  await expect(type).toHaveValue("TASK");
  const incident = type.locator("option", { hasText: "Incident" });
  await expect(incident).toHaveText("Incident — no To Do status");
  // `disabled` on an <option> is a property Playwright's enabled check does not read.
  await expect(incident).toHaveJSProperty("disabled", true);
  await expect(type.locator("option", { hasText: "Bug" })).toHaveJSProperty("disabled", false);

  await dialog.getByLabel("Summary").fill("Rotate the on-call pager");
  await dialog.getByRole("button", { name: "Create issue" }).click();
  await expect(todo.locator(".issue-card", { hasText: "Rotate the on-call pager" })).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();

  // "New" is as it was: no status in its title, and every type on offer.
  await page.getByRole("button", { name: "New", exact: true }).click();
  const fresh = page.getByRole("dialog", { name: "New issue" });
  await expect(fresh).toBeVisible();
  await expect(fresh.getByRole("combobox", { name: "Type" }).locator("option", { hasText: "Incident" })).toHaveJSProperty(
    "disabled",
    false,
  );
});
