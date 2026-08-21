import { expect, test, type Locator, type Page } from "@playwright/test";

// Mock-backed like every spec here (playwright.config.ts starts the server with
// VITE_TASKA_API_MODE=mock): any seeded user signs in with any password, and
// the seed ships project labels so both the picker and the chips have something
// to show on first load — TAS-101 carries "backend" and "tech-debt", TAS-104
// carries none, and MOB-5 carries "ios" in a project Anna is not a member of,
// which is how the read-only view is reached below.
//
// What this file is NOT: a statement about the gateway. Every rule it leans on
// — a name unique per project, a soft delete that reaches every issue, the
// `labelId` filter — is `MockTaskaStore` reading TAS-119 and TAS-120, not
// observed behaviour (docs/ai/API-DIVERGENCE.md). Read these as pinning what
// the UI does, never as evidence that the deployed gateway does the same.

const MOBILE_PROJECT_ID = "f315c5cf-3333-47d1-8d22-79f07c2ec99b";

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("anna@example.com");
  await page.getByLabel("Password").fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);
}

async function openBoard(page: Page) {
  await signIn(page);
  await page.getByRole("button", { name: /Taska Platform/ }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/board$/);
}

async function openIssuePanel(page: Page, issueKey: string): Promise<Locator> {
  await openBoard(page);
  await page.locator(".issue-card", { hasText: issueKey }).click();
  await expect(page.getByRole("complementary", { name: `${issueKey} issue` })).toBeVisible();
  return page.locator(".issue-labels");
}

test("shows the labels an issue carries, on its card and on its panel", async ({ page }) => {
  await openBoard(page);

  // The card draws `issue.labels` from the list read; the panel reads the
  // issue's own label route. Both have to agree, which is the point of
  // asserting the same label in both places.
  const card = page.locator(".issue-card", { hasText: "TAS-101" });
  await expect(card.locator(".label-chip", { hasText: "backend" })).toBeVisible();

  await card.click();
  const labels = page.locator(".issue-labels");
  await expect(labels.getByRole("heading", { name: /Labels/ })).toBeVisible();
  await expect(labels.locator(".label-chip", { hasText: "backend" })).toBeVisible();
  await expect(labels.locator(".label-chip", { hasText: "tech-debt" })).toBeVisible();
});

test("adds a label to an issue, sees the card follow, then takes it off again", async ({ page }) => {
  const labels = await openIssuePanel(page, "TAS-104");

  // A successful empty answer says so; it is not left blank.
  await expect(labels.getByText("No labels yet")).toBeVisible();

  const picker = labels.locator("select");
  const option = picker.locator("option", { hasText: "frontend" });
  const value = await option.getAttribute("value");
  expect(value).toBeTruthy();
  await picker.selectOption(value ?? "");
  await labels.getByRole("button", { name: "Add", exact: true }).click();

  await expect(labels.locator(".label-chip", { hasText: "frontend" })).toBeVisible();
  // A label already on the issue is not offered again.
  await expect(picker.locator("option", { hasText: "frontend" })).toHaveCount(0);

  // The board behind the panel is invalidated by the same write, so the card
  // gains the chip without a reload.
  await page.getByRole("button", { name: "Close", exact: true }).click();
  const card = page.locator(".issue-card", { hasText: "TAS-104" });
  await expect(card.locator(".label-chip", { hasText: "frontend" })).toBeVisible();

  await card.click();
  await page.locator(".issue-labels").getByRole("button", { name: "Remove label frontend" }).click();
  await expect(page.locator(".issue-labels .label-chip", { hasText: "frontend" })).toHaveCount(0);

  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(card.locator(".label-chip", { hasText: "frontend" })).toHaveCount(0);
});

test("filters the board down to one label and back", async ({ page }) => {
  await openBoard(page);

  const counter = page.locator(".counter");
  // Read it only once the issues query has answered: while it is pending the
  // counter says "loading of loading", and capturing that would compare the
  // cleared board against a state it is never going back to.
  await expect(counter).toHaveText(/^\d+ of \d+$/);
  const before = await counter.textContent();

  const filter = page.locator(".filter-select select");
  await filter.selectOption({ label: "needs-design" });

  // The server applies this one (`labelId`), so the board is re-read rather
  // than re-filtered: every card left has to carry the label.
  await expect(page.locator(".issue-card")).toHaveCount(1);
  await expect(page.locator(".issue-card", { hasText: "TAS-103" })).toBeVisible();

  await page.getByRole("button", { name: /Clear/ }).click();
  await expect(counter).toHaveText(before ?? "");
});

test("creates a project label, renames it, and deletes it", async ({ page }) => {
  await openBoard(page);

  await page.getByRole("button", { name: "Manage labels" }).click();
  const modal = page.getByRole("dialog", { name: "Labels" });
  await expect(modal).toBeVisible();

  await modal.getByLabel("New label").fill("release-blocker");
  await modal.getByRole("button", { name: "Add label" }).click();
  await expect(modal.locator(".label-chip", { hasText: "release-blocker" })).toBeVisible();

  // The optimistic row carries a placeholder id and offers no controls until
  // the server has answered; waiting for the edit control to come alive is what
  // separates "the cache was written" from "the label exists".
  const editButton = modal.getByRole("button", { name: "Edit release-blocker" });
  await expect(editButton).toBeEnabled();
  await editButton.click();

  const rename = modal.getByLabel("Rename release-blocker");
  await rename.fill("ship-blocker");
  await modal.getByRole("button", { name: "Save label" }).click();
  await expect(modal.locator(".label-chip", { hasText: "ship-blocker" })).toBeVisible();

  // The new label reaches the issue picker, which is the only reason a project
  // label exists at all.
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.locator(".issue-card", { hasText: "TAS-104" }).click();
  await expect(
    page.locator(".issue-labels select").locator("option", { hasText: "ship-blocker" }),
  ).toHaveCount(1);

  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Manage labels" }).click();
  await page.getByRole("dialog", { name: "Labels" }).getByRole("button", { name: "Delete ship-blocker" }).click();
  await expect(page.locator(".label-manage-row", { hasText: "ship-blocker" })).toHaveCount(0);
});

test("a viewer reads the labels and is offered no way to change them", async ({ page }) => {
  // Anna is not a member of the Mobile project, so the mock answers VIEWER for
  // it. The board is reachable by URL, which is the point: hiding the controls
  // is a UI courtesy and the server stays the authority.
  await signIn(page);
  await page.goto(`/projects/${MOBILE_PROJECT_ID}/board`);

  // Reading is a VIEWER's right (TAS-119), so the filter and the chips stay.
  await expect(page.locator(".filter-select select")).toBeVisible();
  await expect(page.getByRole("button", { name: "Manage labels" })).toHaveCount(0);

  await page.locator(".issue-card", { hasText: "MOB-5" }).click();
  const labels = page.locator(".issue-labels");
  await expect(labels.locator(".label-chip", { hasText: "ios" })).toBeVisible();
  await expect(labels.locator("select")).toHaveCount(0);
  await expect(labels.getByRole("button", { name: "Add", exact: true })).toHaveCount(0);
  await expect(labels.getByRole("button", { name: /^Remove label/ })).toHaveCount(0);
});
