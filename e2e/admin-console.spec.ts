import { expect, test, type Page } from "@playwright/test";

// Like the other suites, this runs against MockTaskaApi
// (playwright.config.ts starts the server with VITE_TASKA_API_MODE=mock): any
// seeded user's email signs in with any password. Mark is the seed's only
// GLOBAL_ADMIN, so he is the only one who can reach this section at all.
//
// The seed's `auth.users` table carries a column the catalog marks sensitive,
// which is what makes the masking assertions here mean something.

async function openConsole(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("mark@example.com");
  await page.getByLabel("Password").fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);

  await page.goto("/admin");
  // /admin is an area with sections now (DESIGN.md §5.8): it redirects into
  // Data, and the heading is the section's.
  await expect(page.getByRole("heading", { level: 1, name: "Data" })).toBeVisible();
}

test("walks the catalog from a service down to a table's rows", async ({ page }) => {
  await openConsole(page);

  // Opens on something rather than an empty frame — and says so in the address.
  await expect(page).toHaveURL(/\/admin\/data\/auth\/users$/);
  await expect(page.getByRole("heading", { name: "auth.users" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "anna@example.com" })).toBeVisible();

  await page.getByRole("link", { name: "audit_log", exact: true }).click();

  await expect(page).toHaveURL(/\/admin\/data\/admin\/audit_log$/);
  await expect(page.getByRole("heading", { name: "admin.audit_log" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: /action/i })).toBeVisible();
});

test("a copied link opens the same table, page and filter", async ({ page }) => {
  await openConsole(page);

  await page.goto("/admin/data/auth/users?filter=email:contains:anna@");

  await expect(page.getByRole("heading", { name: "auth.users" })).toBeVisible();
  await expect(page.locator(".admin-table tbody tr")).toHaveCount(1);
  await expect(page.getByRole("cell", { name: "anna@example.com" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove filter on email" })).toBeVisible();
});

test("never renders the value of a column the catalog marked sensitive", async ({ page }) => {
  await openConsole(page);

  await expect(page.getByRole("columnheader", { name: /password_hash/i })).toBeVisible();
  // The column is named — hiding its existence would misrepresent the schema —
  // but no row shows what is in it.
  await expect(page.getByText("hidden").first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText("$2b$10$");

  // Settled state after a table switch. Note what this does NOT prove: the
  // transient leak that used to happen mid-switch is invisible to Playwright,
  // because `not.toContainText` polls until it holds and a leak lasting one
  // render passes trivially. That case is pinned in
  // src/screens/admin/AdminScreen.test.tsx, which can hold the request open and
  // look at the frame in between. Do not treat this assertion as covering it.
  await page.getByRole("link", { name: "audit_log", exact: true }).click();
  await expect(page.getByRole("heading", { name: "admin.audit_log" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("$2b$10$");
});

test("pages through a table and says where it is", async ({ page }) => {
  await openConsole(page);

  await page.getByRole("link", { name: "audit_log", exact: true }).click();
  await expect(page.getByRole("heading", { name: "admin.audit_log" })).toBeVisible();

  const firstCell = page.locator(".admin-table tbody tr td").first();
  const onPageOne = await firstCell.innerText();

  await expect(page.getByText(/Page 1 of \d+/)).toBeVisible();
  // Nowhere to go back to from the first page.
  await expect(page.getByRole("button", { name: "Previous" })).toBeDisabled();

  await page.getByRole("button", { name: "Next" }).click();

  await expect(page.getByText(/Page 2 of \d+/)).toBeVisible();
  // The page is in the address, so this view is linkable like any other.
  await expect(page).toHaveURL(/page=2/);
  await expect(page.getByRole("button", { name: "Previous" })).toBeEnabled();
  expect(await firstCell.innerText()).not.toBe(onPageOne);
});

test("sorts by a column and reverses on a second press", async ({ page }) => {
  await openConsole(page);

  await page.getByRole("link", { name: "audit_log", exact: true }).click();
  await expect(page.getByRole("heading", { name: "admin.audit_log" })).toBeVisible();

  const firstCell = page.locator(".admin-table tbody tr td").first();
  const sortById = page.getByRole("button", { name: /^id/i });

  // Concrete ids rather than "the value changed": the header's aria-sort flips
  // from the address the instant it is clicked, while the rows come back from
  // the server a moment later, so comparing before/after can pass on stale
  // rows. The seed's audit_log runs audit-001..audit-047.
  await sortById.click();
  await expect(page.locator("th", { has: sortById })).toHaveAttribute("aria-sort", "ascending");
  await expect(firstCell).toHaveText("audit-001");

  await sortById.click();
  await expect(page.locator("th", { has: sortById })).toHaveAttribute("aria-sort", "descending");
  await expect(firstCell).toHaveText("audit-047");
});

test("filters a table down and back", async ({ page }) => {
  await openConsole(page);

  // The caption renders from the selection before any rows arrive, so waiting
  // on it is not enough — wait for a row.
  await expect(page.getByRole("cell", { name: "anna@example.com" })).toBeVisible();
  const rows = page.locator(".admin-table tbody tr");
  const before = await rows.count();
  expect(before).toBeGreaterThan(1);

  await page.getByRole("button", { name: "Filter" }).click();
  await page.getByLabel("Column", { exact: true }).selectOption("email");
  await page.getByLabel("Match", { exact: true }).selectOption("contains");
  await page.getByLabel("Value", { exact: true }).fill("anna@");
  await page.getByRole("button", { name: "Apply" }).click();

  await expect(rows).toHaveCount(1);
  await expect(page.getByRole("cell", { name: "anna@example.com" })).toBeVisible();

  // The applied filter is a chip, and its cross is what removes it — there is
  // no separate Clear row any more (§5.8).
  await page.getByRole("button", { name: "Remove filter on email" }).click();
  await expect(rows).toHaveCount(before);
});

test("a filter that matches nothing says so instead of looking broken", async ({ page }) => {
  await openConsole(page);

  await expect(page.getByRole("heading", { name: "auth.users" })).toBeVisible();

  await page.getByRole("button", { name: "Filter" }).click();
  await page.getByLabel("Column", { exact: true }).selectOption("email");
  await page.getByLabel("Match", { exact: true }).selectOption("contains");
  await page.getByLabel("Value", { exact: true }).fill("nobody-here-at-all");
  await page.getByRole("button", { name: "Apply" }).click();

  await expect(page.getByText("No rows match this filter.")).toBeVisible();
});

test("finds a table through the catalog search", async ({ page }) => {
  await openConsole(page);

  const catalog = page.getByRole("navigation", { name: "Tables" });
  await page.getByLabel("Search tables").fill("audit");

  await expect(catalog.getByRole("link", { name: "audit_log", exact: true })).toBeVisible();
  await expect(catalog.getByRole("link", { name: "users", exact: true })).toHaveCount(0);

  await page.getByLabel("Search tables").fill("nothing like this");
  await expect(page.getByText("Nothing matches")).toBeVisible();
});

test("stands in for a section that has no endpoints yet", async ({ page }) => {
  await openConsole(page);

  await page.getByRole("navigation", { name: "Administration" }).getByRole("link", { name: "Events" }).click();

  await expect(page).toHaveURL(/\/admin\/events$/);
  await expect(page.getByRole("heading", { name: "Events — under construction" })).toBeVisible();
  await expect(page.getByRole("link", { name: "TAS-105" })).toHaveAttribute(
    "href",
    "https://jira.ozero.dev/browse/TAS-105",
  );
});

test("a plain user cannot reach the console at all", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("anna@example.com");
  await page.getByLabel("Password").fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);

  await page.goto("/admin");

  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  // No fragment of the console leaks through the refusal.
  await expect(page.locator(".admin-table")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("$2b$10$");
});
