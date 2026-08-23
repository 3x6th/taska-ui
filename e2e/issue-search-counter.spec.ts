import { expect, test, type Page } from "@playwright/test";

// The board's "X of Y" reads its two halves from two caches. X is live off the
// issues query, which every mutation invalidates; Y is `totalCount` off a
// search answer keyed by the query text and the filters — none of which a
// mutation changes, and which `staleTime` (src/main.tsx) then holds. Creating a
// matching issue printed "2 of 1" and stayed there for as long as anyone
// watched, and re-typing the same query could not correct it, because the key
// was already the one in the cache.
//
// There are unit tests for this in BoardScreen.test.tsx. This spec exists
// anyway, and the reason is worth writing down: the first version of those unit
// tests passed against the bug, because the test harness built its QueryClient
// without the app's `staleTime` and react-query's default of 0 refetches
// everything the moment it is observed again. A defect that only exists inside
// a cache window cannot be seen from a harness that has no cache window. This
// one runs the real app.

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("anna@example.com");
  await page.getByLabel("Password").fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);
}

async function openBoard(page: Page) {
  await page.getByRole("button", { name: /Taska Platform/ }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/board$/);
  await expect(page.locator(".counter")).toHaveText(/^\d+ of \d+$/);
}

// Viewport-independent: this is about which cache a number came from. Run once,
// the same way the filter bar's wrap band picks a single project.
test.describe("the board counter after a mutation", () => {
  test("a created match moves both halves and does not strand the total", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "laptop", "runs once; the counter's honesty does not depend on the viewport");

    await signIn(page);
    await openBoard(page);

    const counter = page.locator(".counter");
    await page.getByPlaceholder("Search issues").fill("rotation");
    // One seeded issue matches, and the server agrees.
    await expect(counter).toHaveText("1 of 1");

    await page.getByRole("button", { name: "New" }).click();
    const dialog = page.getByRole("dialog", { name: "New issue" });
    await dialog.getByLabel("Summary").fill("Token rotation follow-up");
    await dialog.getByRole("button", { name: "Create issue" }).click();
    await expect(page).toHaveURL(/\/issues\//);

    // Both halves, immediately. Measured against the bug this read "2 of 1".
    await expect(counter).toHaveText("2 of 2");
    // And it is not a number on its way through: `staleTime` is 20s, so a
    // total that was going to strand is still stranded well after this.
    await page.waitForTimeout(2500);
    await expect(counter).toHaveText("2 of 2");
  });

  test("a deleted match takes its own row out of the results with it", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "laptop", "runs once; the counter's honesty does not depend on the viewport");

    await signIn(page);
    await openBoard(page);

    const counter = page.locator(".counter");
    await page.getByPlaceholder("Search issues").fill("rotation");
    await expect(counter).toHaveText("1 of 1");

    await page.getByRole("button", { name: /TAS-105/ }).click();
    await expect(page.locator(".issue-panel")).toBeVisible();
    await page.getByRole("button", { name: "Delete" }).click();

    // The mirror image, and the worse of the two: against the bug this read
    // "1 of 1" over an empty board — the deleted issue survived as a search hit
    // in the group below, linking to a panel that no longer opens.
    await expect(counter).toHaveText("0 of 0");
    await expect(page.getByText("TAS-105")).toHaveCount(0);
    await expect(page.getByText(/Nothing else in this project matches/)).toBeVisible();
  });
});
