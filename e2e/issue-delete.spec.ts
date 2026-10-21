import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Deleting an issue asks first (DESIGN.md §4.10, TAS-299): §4.22's strip, in a
 * fixed zone between the panel's head and its body. One press used to delete.
 *
 * Mock-backed like every spec here (playwright.config.ts): any seeded user signs
 * in with any password, and Anna is the ADMIN of Taska Platform. In its In
 * Progress column TAS-101 is followed by TAS-105, which is where focus lands
 * once TAS-101 is gone.
 *
 * A refusal is not reached here: the mock answers this route's only refusal —
 * a role issue-service's `delete-issue-roles` does not hold — for a reader the
 * board never offers Delete to. Its path is pinned in
 * src/screens/BoardScreen.test.tsx against a fake that refuses.
 */

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("anna@example.com");
  await page.getByLabel("Password", { exact: true }).fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);
}

async function openIssue(page: Page, issueKey: string): Promise<Locator> {
  await page.locator(".project-card", { hasText: "Taska Platform" }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/board$/);
  await expect(page.locator(".filter-select select")).toBeEnabled();
  await page.locator("button.issue-card", { hasText: issueKey }).click();
  const panel = page.getByRole("dialog", { name: `${issueKey} issue` });
  await expect(panel).toBeVisible();
  return panel;
}

const SENTENCE =
  "TAS-101 will be deleted for everyone, with its comments, attachments, work log and links. This cannot be undone.";

test("asks before deleting, and Cancel and Esc close the question without closing the panel", async ({ page }) => {
  await signIn(page);
  const panel = await openIssue(page, "TAS-101");
  const remove = panel.getByRole("button", { name: "Delete issue TAS-101" });
  const zone = panel.locator(".issue-delete-zone");

  await remove.click();
  await expect(zone).toBeVisible();
  await expect(zone.getByText(SENTENCE)).toBeVisible();
  await expect(remove).toHaveAttribute("aria-expanded", "true");
  const cancel = zone.getByRole("button", { name: "Cancel" });
  await expect(cancel).toBeFocused();

  // Between the head and the body, outside the scroll, and one line under
  // the fixed part: the head's own goes while the zone is open.
  const head = panel.locator(".issue-panel-head");
  const body = panel.locator(".issue-panel-body");
  const [headBox, zoneBox, bodyBox] = await Promise.all([head.boundingBox(), zone.boundingBox(), body.boundingBox()]);
  expect(zoneBox!.y).toBeCloseTo(headBox!.y + headBox!.height, 0);
  expect(bodyBox!.y).toBeCloseTo(zoneBox!.y + zoneBox!.height, 0);
  await expect(head).toHaveCSS("border-bottom-color", "rgba(0, 0, 0, 0)");
  // The strip runs from the type chip's left edge to Close's right edge.
  const strip = zone.locator(".issue-delete-confirm");
  const [chipBox, closeBox, stripBox] = await Promise.all([
    head.locator(".type-chip").boundingBox(),
    head.getByRole("button", { name: "Close", exact: true }).boundingBox(),
    strip.boundingBox(),
  ]);
  expect(stripBox!.x).toBeCloseTo(chipBox!.x, 0);
  expect(stripBox!.x + stripBox!.width).toBeCloseTo(closeBox!.x + closeBox!.width, 0);

  await cancel.click();
  await expect(zone).toHaveCount(0);
  await expect(remove).toBeFocused();

  // Esc in the strip, and Esc on Delete — two Shift+Tabs back from Cancel,
  // past Close, which stands between the head's Delete and the zone.
  await page.keyboard.press("Enter");
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(zone).toHaveCount(0);
  await expect(remove).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(head.getByRole("button", { name: "Close", exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(remove).toBeFocused();
  await expect(zone).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(zone).toHaveCount(0);
  await expect(remove).toBeFocused();

  await expect(panel).toBeVisible();
  await expect(page).toHaveURL(/\/issues\//);
  await expect(page.locator("button.issue-card", { hasText: "TAS-101" })).toHaveCount(1);
});

test("deletes on the answer: the card goes, the panel closes for good, and focus takes the card's place", async ({
  page,
}) => {
  await signIn(page);
  const panel = await openIssue(page, "TAS-101");
  const counter = page.locator(".counter");
  await expect(counter).toHaveText("10 of 10");

  await panel.getByRole("button", { name: "Delete issue TAS-101" }).click();
  await panel.getByRole("button", { name: "Delete issue", exact: true }).click();

  await expect(panel).toBeHidden();
  await expect(page).toHaveURL(/\/board$/);
  await expect(page.locator("button.issue-card", { hasText: "TAS-101" })).toHaveCount(0);
  await expect(counter).toHaveText("9 of 9");
  // The card that took its place in the same column.
  await expect(page.locator("button.issue-card", { hasText: "TAS-105" })).toBeFocused();
  // Said for a reader who sees neither the panel close nor the card go.
  await expect(page.locator(".board-shell > p.visually-hidden[role='status']")).toHaveText("TAS-101 deleted.");

  // `replace`: Back does not open the issue that was just deleted.
  await page.goBack();
  await expect(page).not.toHaveURL(/\/issues\//);
  await expect(page.getByRole("dialog", { name: "TAS-101 issue" })).toHaveCount(0);
});
