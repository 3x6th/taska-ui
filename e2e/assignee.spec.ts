import { expect, test, type Locator, type Page } from "@playwright/test";

// The assignee chips on the issue panel (TAS-226). Mock-backed like every spec
// here — playwright.config.ts starts the server with VITE_TASKA_API_MODE=mock,
// so any seeded user signs in with any password and no request leaves the
// process. Nothing below is evidence about the gateway: the rule these chips
// follow, `assign-issue-roles` checked against the assignee as well as against
// whoever assigns, was read out of issue-service, and the refusals behind it
// come from `MockTaskaStore` here.
//
// What the seed gives these tests (src/api/mock/MockTaskaApi.ts): Anna is the
// ADMIN of Taska Platform, Mark and Sofia are its MEMBERs, and Tom is its
// VIEWER — the one seeded VIEWER who is a member. So Tom is offered no chip,
// except on the two issues he already holds, TAS-104 and TAS-110, where he is
// the assignment rather than an offer.

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("anna@example.com");
  await page.getByLabel("Password").fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);
}

async function openIssuePanel(page: Page, issueKey: string): Promise<Locator> {
  // Addressed by class, not by role and name: since TAS-148 an ADMIN's card
  // carries an "Edit <name>" button of its own, and a loose match on the
  // project's name finds both.
  await page.locator(".project-card", { hasText: "Taska Platform" }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/board$/);

  await page.locator(".issue-card", { hasText: issueKey }).click();
  const panel = page.getByRole("complementary", { name: `${issueKey} issue` });
  await expect(panel).toBeVisible();
  return panel;
}

/** Each chip's own word, in order. The avatar beside it is a sibling, not part of it. */
function chipLabels(panel: Locator): Locator {
  return panel.locator(".meta-grid .assignee-chip span:last-child");
}

test("offers an admin only the members the server takes as an assignee", async ({ page }) => {
  await signIn(page);
  const panel = await openIssuePanel(page, "TAS-102");

  // Tom is on the project and a VIEWER, so he is not offered.
  await expect(chipLabels(panel)).toHaveText(["None", "Anna", "Mark", "Sofia"]);

  // The board's assignee filter is a read, not an offer, and keeps him: it asks
  // who holds an issue rather than who may be given one.
  await expect(page.locator(".filterbar .avatar-filter")).toHaveCount(4);
  await expect(page.locator(".filterbar .avatar-filter [aria-label='Tom Becker']")).toHaveCount(1);
});

test("keeps a VIEWER who already holds an issue as its assignee, with no way to send it again", async ({ page }) => {
  await signIn(page);
  const panel = await openIssuePanel(page, "TAS-110");

  // Still who holds the issue — dropping the chip would draw it unassigned.
  await expect(chipLabels(panel)).toHaveText(["None", "Anna", "Mark", "Sofia", "Tom"]);
  const tom = panel.locator(".assignee-chip", { hasText: "Tom" });
  await expect(tom).toHaveClass(/is-active/);
  // Pressing an active chip sends the assignment again, and for a VIEWER that is
  // the request the server refuses.
  await expect(tom).toBeDisabled();

  // Everyone the server does take is still an offer.
  await expect(panel.locator(".assignee-chip", { hasText: "Mark" })).toBeEnabled();
});

test("unassigns an issue with None, and the card and a reopened panel agree", async ({ page }) => {
  // TAS-246: "None" is a request now — a PATCH with `assigneeId: null` — where
  // the old assign route required an id and the chip could only be drawn off.
  await signIn(page);
  const panel = await openIssuePanel(page, "TAS-102");

  const none = panel.locator(".assignee-chip", { hasText: "None" });
  await expect(panel.locator(".assignee-chip", { hasText: "Anna" })).toHaveClass(/is-active/);
  await expect(none).toBeEnabled();
  await none.click();

  // Not optimistic: the chip moves when the server's answer lands, and is off
  // again because pressing it would change nothing — `aria-disabled`, not
  // `disabled`, so the press below that sends nothing is the chip's own doing.
  await expect(none).toHaveClass(/is-active/);
  await expect(none).toHaveAttribute("aria-disabled", "true");
  // The property, not `toBeEnabled()`: Playwright counts `aria-disabled` as
  // disabled, and what is pinned here is that no real `disabled` is set.
  await expect(none).toHaveJSProperty("disabled", false);
  // The card behind the panel lost its assignee with the board's re-read.
  await expect(page.locator(".issue-card", { hasText: "TAS-102" }).locator(".avatar")).toHaveClass(/avatar-empty/);

  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.locator(".issue-card", { hasText: "TAS-102" }).click();
  const reopened = page.getByRole("complementary", { name: "TAS-102 issue" });
  await expect(reopened.locator(".assignee-chip", { hasText: "None" })).toHaveClass(/is-active/);
});

test("keeps focus on None after unassigning from the keyboard, and draws the token ring", async ({ page }) => {
  // A real `disabled` landing on the chip that has focus is what Chromium
  // answers by moving focus to <body> (DESIGN.md §4.21) — and the answer to
  // this very press is what makes the issue unassigned. So the chip goes
  // `aria-disabled` instead, and focus stays where the reader left it.
  await signIn(page);
  const panel = await openIssuePanel(page, "TAS-102");
  const none = panel.locator(".assignee-chip", { hasText: "None" });
  await expect(panel.locator(".assignee-chip", { hasText: "Anna" })).toHaveClass(/is-active/);

  // Reached by Tab, so `:focus-visible` holds, and the ring is the token one
  // (§4.1, §7) rather than the browser's own.
  await panel.locator(".assignee-chip", { hasText: "Anna" }).focus();
  await page.keyboard.press("Shift+Tab");
  await expect(none).toBeFocused();
  await expect(none).toHaveCSS("outline-style", "solid");
  await expect(none).toHaveCSS("outline-width", "2px");
  await expect(none).toHaveCSS("outline-offset", "2px");

  await page.keyboard.press("Enter");
  await expect(none).toHaveClass(/is-active/);
  await expect(none).toHaveAttribute("aria-disabled", "true");
  await expect(none).toBeFocused();
  // Not faded: it is the value the field now holds.
  await expect(none).toHaveCSS("opacity", "1");

  // And a press on it now sends nothing: the card keeps no assignee and the
  // chip stays where it is, focused.
  await page.keyboard.press("Enter");
  await expect(none).toBeFocused();
  await expect(page.locator(".issue-card", { hasText: "TAS-102" }).locator(".avatar")).toHaveClass(/avatar-empty/);
});
