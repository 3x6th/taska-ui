import { expect, test, type Locator, type Page } from "@playwright/test";

// Mock-backed like every spec here (playwright.config.ts starts the server with
// VITE_TASKA_API_MODE=mock): any seeded user signs in with any password. Anna is
// an ADMIN of Taska Platform, so the composer and her own comment's Edit button
// are both live. TAS-102 carries no seeded comment, which is why the thread
// this file writes into is the only one on screen; TAS-107 carries two.
//
// This file is TAS-233's regression, and it can only see that defect because
// the mock's comment factory now stamps `updatedAt` equal to `createdAt` on
// insert, the way issue-service's `@CreatedDate` / `@LastModifiedDate` pair
// does. While the mock answered `updatedAt: null` there was no way to reach the
// bug from here at all: only the stand ever produced a comment that had never
// been edited and still carried an `updatedAt`.
//
// What it is NOT: evidence about the gateway. The stamps asserted below come
// from `MockTaskaStore`. The *shape* they are in was read off the backend at
// develop `1cfe4d7` — the stand's own commit — and is recorded in
// docs/ai/API-DIVERGENCE.md. Read these as pinning what the UI does with such a
// response, never as proof that the server sends one.

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("anna@example.com");
  await page.getByLabel("Password").fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);
}

async function openComments(page: Page, issueKey: string): Promise<Locator> {
  // Addressed by class, not by role and name: since TAS-148 an ADMIN's card
  // carries an "Edit <name>" button of its own, and a loose match on the
  // project's name finds both.
  await page.locator(".project-card", { hasText: "Taska Platform" }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/board$/);

  await page.locator(".issue-card", { hasText: issueKey }).click();
  await expect(page.getByRole("complementary", { name: `${issueKey} issue` })).toBeVisible();

  return page.locator(".comments");
}

// Closing and reopening the panel remounts the section, which refetches from
// the store. A `page.reload()` would not do: `MockTaskaStore` lives in memory
// and is rebuilt on every page load, so a reload would discard the very comment
// the round trip is meant to prove.
async function reopenComments(page: Page, issueKey: string): Promise<Locator> {
  // Exact: the backdrop behind the panel is also a button, named "Close issue".
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("complementary", { name: `${issueKey} issue` })).toHaveCount(0);
  await page.locator(".issue-card", { hasText: issueKey }).click();
  await expect(page.getByRole("complementary", { name: `${issueKey} issue` })).toBeVisible();
  return page.locator(".comments");
}

/** The `edited` badge, which is the only `em` a comment row draws. */
const badge = (row: Locator) => row.locator(".comment-head em");

/**
 * The one row on TAS-102, addressed by position rather than by its text. A
 * `hasText` filter would stop matching the moment the row enters edit mode: the
 * body moves into a textarea's `value`, which is not text content, and the
 * filter would then find nothing to press Save on.
 */
const onlyRow = (comments: Locator) => comments.locator(".comment-item");

test("a comment just posted is not marked edited", async ({ page }) => {
  await signIn(page);
  const comments = await openComments(page, "TAS-102");
  await expect(comments.getByText("No comments yet")).toBeVisible();

  await comments.getByPlaceholder("Leave a comment").fill("Retry guard is in review.");
  await comments.getByRole("button", { name: "Comment", exact: true }).click();

  const row = onlyRow(comments);
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Retry guard is in review.");
  // The whole of TAS-233. The server answers this comment with an `updatedAt`
  // — equal to its `createdAt`, because the insert stamped both — and before
  // the fix that was enough to draw the badge on a comment one second old.
  await expect(badge(row)).toHaveCount(0);
  // Not a cache artifact: the row is read back from the store, stamps and all.
  const reopened = onlyRow(await reopenComments(page, "TAS-102"));
  await expect(reopened).toContainText("Retry guard is in review.");
  await expect(badge(reopened)).toHaveCount(0);
});

test("the badge appears once the comment is actually edited, and stays", async ({ page }) => {
  await signIn(page);
  const comments = await openComments(page, "TAS-102");

  await comments.getByPlaceholder("Leave a comment").fill("Retry guard is in review.");
  await comments.getByRole("button", { name: "Comment", exact: true }).click();

  const row = onlyRow(comments);
  await expect(row).toContainText("Retry guard is in review.");
  await expect(badge(row)).toHaveCount(0);

  await row.getByRole("button", { name: "Edit", exact: true }).click();
  await row.locator("textarea").fill("Retry guard is merged.");
  await row.getByRole("button", { name: "Save", exact: true }).click();

  await expect(row).toContainText("Retry guard is merged.");
  await expect(badge(row)).toHaveText("edited");
  // The store moved `updatedAt` past `createdAt` and the badge followed, so
  // this survives the remount that discards every local state but the store's.
  const reopened = onlyRow(await reopenComments(page, "TAS-102"));
  await expect(reopened).toContainText("Retry guard is merged.");
  await expect(badge(reopened)).toHaveText("edited");
});

test("a seeded thread nobody has touched carries no badge on either comment", async ({ page }) => {
  await signIn(page);
  const comments = await openComments(page, "TAS-107");

  // Two seeded comments, both with the stamps an insert leaves. This is the
  // case the old predicate got wrong on every thread in the product, not only
  // on a comment the reader had just written.
  await expect(comments.locator(".comment-item")).toHaveCount(2);
  await expect(comments.locator(".comment-item em")).toHaveCount(0);
});
