import { expect, test, type Page } from "@playwright/test";

// Mock-backed like every spec here (playwright.config.ts starts the server with
// VITE_TASKA_API_MODE=mock): any seeded user signs in with any password, and
// Anna is a member of three of the seed's four projects. "board" is a word the
// seed puts in more than one of them, which is what makes it a cross-project
// question rather than a board filter.

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("anna@example.com");
  await page.getByLabel("Password").fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);
}

const searchField = (page: Page) => page.getByRole("combobox", { name: /Search issues/ });

test("finds issues in every project from the top bar and opens one with the keyboard", async ({ page }) => {
  await signIn(page);

  const field = searchField(page);
  await field.fill("board");

  const list = page.getByRole("listbox", { name: "Issue search results" });
  await expect(list).toBeVisible();

  // More than one project answers — this is the search with no `projectId`,
  // not the board's own box, and the reader is not on a board at all.
  const keys = await list.getByRole("option").locator(".global-search-key").allInnerTexts();
  expect(keys.length).toBeGreaterThan(1);
  expect(new Set(keys.map((key) => key.split("-")[0])).size).toBeGreaterThan(1);

  // Focus stays on the field for the whole life of a combobox: the arrows move
  // `aria-activedescendant`, and nothing else is ever the active element.
  await field.press("ArrowDown");
  await expect(field).toHaveAttribute("aria-activedescendant", /.+/);
  await expect(field).toBeFocused();

  await field.press("Enter");

  // The route was built from the issue key's prefix resolved against the
  // projects list — the search response carries no projectId at all.
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+\/issues\/[^/]+$/);
  // The slide-over for that issue, which is what the route resolves to (§5.1).
  await expect(page.locator(".issue-panel")).toBeVisible();
});

test("opens a result with the pointer, from the administration area as well", async ({ page }) => {
  // Mark is the seed's only GLOBAL_ADMIN, so this is also the check that the
  // field is on the shared bar rather than on one screen.
  await page.goto("/login");
  await page.getByLabel("Email").fill("mark@example.com");
  await page.getByLabel("Password").fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);

  await page.goto("/admin/data");
  const field = searchField(page);
  await expect(field).toBeVisible();

  await field.fill("board");
  const options = page.getByRole("listbox", { name: "Issue search results" }).getByRole("option");
  await expect(options.first()).toBeVisible();
  await options.first().click();

  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+\/issues\/[^/]+$/);
});

test("says the query is too short instead of asking a question the gateway refuses", async ({ page }) => {
  await signIn(page);

  const field = searchField(page);
  // Two characters is what the contract permits and the runtime refuses with a
  // 400. The mock refuses it identically, so this case would fail loudly if the
  // UI ever sent it.
  await field.fill("bo");

  await expect(page.getByText(/at least 3 characters/i)).toBeVisible();
  await expect(page.getByRole("listbox")).toHaveCount(0);
});

test("closes on Escape and on a click outside, and clears on the second Escape", async ({ page }) => {
  await signIn(page);

  const field = searchField(page);
  await field.fill("board");
  await expect(page.getByRole("listbox")).toBeVisible();

  await field.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(field).toHaveValue("board");
  await field.press("Escape");
  await expect(field).toHaveValue("");

  await field.fill("board");
  await expect(page.getByRole("listbox")).toBeVisible();
  // A raw mouse press rather than a click on an element: at phone width the
  // dropdown covers most of the page, so every named target worth clicking is
  // underneath it. The bottom-left corner is outside it at every viewport this
  // suite runs.
  const viewport = page.viewportSize();
  await page.mouse.click(5, (viewport?.height ?? 600) - 5);
  await expect(page.getByRole("listbox")).toHaveCount(0);
});

test("filters the project list by name and by key, and says what it is showing", async ({ page }) => {
  await signIn(page);
  await expect(page.locator(".skeleton-card")).toHaveCount(0);
  await expect(page.locator(".project-card")).toHaveCount(3);

  const filter = page.getByPlaceholder("Filter projects");
  await filter.fill("web");
  await expect(page.locator(".project-card")).toHaveCount(1);
  await expect(page.getByText(/^1 of 3 projects/)).toBeVisible();

  // The key, not only the name — it is what the cards are labelled with.
  await filter.fill("ops");
  // Addressed by class, not by role and name: since TAS-148 an ADMIN's card
  // carries an "Edit <name>" button of its own, and a loose match on the
  // project's name finds both (exact: true finds neither, since the card's
  // accessible name is its whole content and includes "loading members"
  // while the summary queries are in flight). The role check is what the
  // class locator gives up, so it comes back explicitly.
  const card = page.locator(".project-card", { hasText: "Infra and Ops" });
  await expect(card).toBeVisible();
  await expect(card).toHaveRole("button");

  await filter.fill("no such project");
  await expect(page.getByText(/No projects match/)).toBeVisible();
  await expect(page.getByText(/^0 of 3 projects/)).toBeVisible();
});
