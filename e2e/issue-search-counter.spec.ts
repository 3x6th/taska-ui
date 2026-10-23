import { expect, test, type Page } from "@playwright/test";

// The board's "X of Y" since TAS-202 (DESIGN.md §5.4): both halves come from one
// complete board read — X every card the filters leave drawn, Y every card the
// read holds — and the field is a local filter of this board, answered on the
// first character with no request. A write re-reads the board, and both halves
// move together.
//
// There are unit tests for this in BoardScreen.test.tsx. This spec exists
// anyway, because a defect that only exists inside a cache window cannot be
// seen from a harness that has none: it runs the real app, with its own
// query client and its `staleTime`.

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("anna@example.com");
  await page.getByLabel("Password", { exact: true }).fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);
}

async function openBoard(page: Page) {
  // Addressed by class, not by role and name: since TAS-148 an ADMIN's card
  // carries an "Edit <name>" button of its own, and a loose match on the
  // project's name finds both.
  await page.locator(".project-card", { hasText: "Taska Platform" }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/board$/);
  await expect(page.locator(".counter")).toHaveText(/^\d+ of \d+$/);
}

const filterField = (page: Page) => page.getByRole("textbox", { name: "Filter issues by key, summary or description" });

// Viewport-independent: this is about which read a number came from. Run once,
// the same way the filter bar's wrap band picks a single project.
test.describe("the board counter after a mutation", () => {
  test("filters locally, asking the server nothing", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "laptop", "runs once; the counter's honesty does not depend on the viewport");

    await signIn(page);
    await openBoard(page);
    await expect(filterField(page)).toHaveAttribute("placeholder", "Filter issues");

    const asked: string[] = [];
    page.on("request", (request) => asked.push(request.url()));
    // One character is enough, and "ro" matches a description word too.
    await filterField(page).fill("r");
    await filterField(page).fill("rotation");
    await expect(page.locator(".counter")).toHaveText("1 of 10");
    await page.waitForTimeout(500);
    // The mock answers in-process, so a request here is anything that left
    // the page for the dev server's API proxy — none should.
    expect(asked.filter((url) => url.includes("/api/"))).toEqual([]);
  });

  test("a created match moves both halves", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "laptop", "runs once; the counter's honesty does not depend on the viewport");

    await signIn(page);
    await openBoard(page);

    const counter = page.locator(".counter");
    await filterField(page).fill("rotation");
    // One seeded issue matches, out of the board's ten.
    await expect(counter).toHaveText("1 of 10");

    await page.getByRole("button", { name: "New" }).click();
    const dialog = page.getByRole("dialog", { name: "New issue" });
    await dialog.getByLabel("Summary").fill("Token rotation follow-up");
    await dialog.getByRole("button", { name: "Create issue" }).click();
    await expect(page).toHaveURL(/\/issues\//);

    // Both halves, from the board read again after the create.
    await expect(counter).toHaveText("2 of 11");
    // And it is not a number on its way through: `staleTime` is 20s.
    await page.waitForTimeout(2500);
    await expect(counter).toHaveText("2 of 11");
  });

  test("a deleted match takes its card and its count with it", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "laptop", "runs once; the counter's honesty does not depend on the viewport");

    await signIn(page);
    await openBoard(page);

    const counter = page.locator(".counter");
    await filterField(page).fill("rotation");
    await expect(counter).toHaveText("1 of 10");

    await page.getByRole("button", { name: /TAS-105/ }).click();
    await expect(page.locator(".issue-panel")).toBeVisible();
    // Delete asks first since TAS-299; the answer is the strip's.
    await page.getByRole("button", { name: "Delete issue TAS-105" }).click();
    await page.getByRole("button", { name: "Delete issue", exact: true }).click();

    // Exact, so the board's own "TAS-105 deleted." for a screen reader is not counted.
    await expect(counter).toHaveText("0 of 9");
    await expect(page.getByText("TAS-105", { exact: true })).toHaveCount(0);
  });
});
