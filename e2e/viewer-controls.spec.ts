import { expect, test, type Locator, type Page } from "@playwright/test";

// TAS-236, DESIGN.md §5.7: a VIEWER's write controls are not on the page — New,
// each column's "+", the panel's transition buttons and its Delete — rather than
// on it and disabled, the way the comment composer already was not.
//
// Mock-backed like every spec here (playwright.config.ts): any seeded user signs
// in with any password. On Taska Platform, Anna is the ADMIN, Mark a MEMBER and
// Tom the seeded VIEWER (TAS-226). TAS-102 sits in To Do, where the workflow
// offers "Start Progress". Hiding is presentation only — the server refuses a
// VIEWER's write either way — and nothing here is evidence about the gateway.

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);
}

async function openIssue(page: Page, issueKey: string): Promise<Locator> {
  // Addressed by class: since TAS-148 an ADMIN's card carries an "Edit <name>"
  // button of its own, and a loose match on the name finds both.
  await page.locator(".project-card", { hasText: "Taska Platform" }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/board$/);
  await page.locator(".issue-card", { hasText: issueKey }).click();
  const panel = page.getByRole("complementary", { name: `${issueKey} issue` });
  await expect(panel).toBeVisible();
  return panel;
}

/** The issue's own Delete, in the panel's head — not a comment's or an attachment's. Named with the key since TAS-299. */
const issueDelete = (panel: Locator) => panel.locator(".issue-panel-head").getByRole("button", { name: /^Delete issue / });

test("a VIEWER is shown no New, no column +, no transition button and no Delete", async ({ page }) => {
  await signIn(page, "tom@example.com");
  const panel = await openIssue(page, "TAS-102");

  // Absent, not disabled: each is a count of zero, which a disabled control
  // would fail. The board draws them, disabled, until the role answers, so
  // these also wait for that answer.
  await expect(page.getByRole("button", { name: "New", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create issue" })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Start Progress" })).toHaveCount(0);
  await expect(issueDelete(panel)).toHaveCount(0);
  // No arrow pointing at moves that are not offered.
  await expect(panel.locator(".transition-row .arrow")).toHaveCount(0);

  // What a VIEWER keeps: the status, the share links and the way out.
  await expect(panel.locator(".status-pill")).toHaveText("To Do");
  await expect(panel.getByRole("button", { name: "Share issue TAS-102" })).toBeEnabled();
  await expect(panel.getByRole("button", { name: "Close", exact: true })).toBeEnabled();
});

test("a VIEWER reads the summary and the description in full, read-only rather than disabled", async ({ page }) => {
  await signIn(page, "tom@example.com");
  const panel = await openIssue(page, "TAS-102");

  // §4.3, §5.7 (TAS-299): read-only keeps the text at full contrast, lets it be
  // selected and keeps the box in the Tab order; `disabled` dimmed it to .58.
  for (const box of [panel.locator(".summary-textarea"), panel.getByRole("textbox", { name: "Description" })]) {
    await expect(box).toHaveJSProperty("readOnly", true);
    await expect(box).toBeEnabled();
    await expect(box).toHaveCSS("opacity", "1");
    await expect(box).toHaveCSS("cursor", "default");
    await expect(box).toHaveCSS("resize", "none");
    await box.focus();
    await expect(box).toBeFocused();
    // The ring, not the accent frame that would say "type here".
    await expect(box).toHaveCSS("outline-style", "solid");
    await expect(box).toHaveCSS("outline-width", "2px");
  }
  // The description loses the field's fill.
  await expect(panel.getByRole("textbox", { name: "Description" })).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  // No typing hints under boxes nobody here can type in.
  await expect(panel.getByText("e.g. 8h, 1h 30m, 45m")).toHaveCount(0);
});

for (const [email, role] of [
  ["anna@example.com", "an ADMIN"],
  ["mark@example.com", "a MEMBER"],
] as const) {
  test(`${role} keeps every one of them, and the move still goes`, async ({ page }) => {
    await signIn(page, email);
    const panel = await openIssue(page, "TAS-102");

    await expect(page.getByRole("button", { name: "New", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Create issue" }).first()).toBeEnabled();
    await expect(issueDelete(panel)).toBeEnabled();

    // The transition button is the drag's keyboard path (§5.3), so it is pressed
    // rather than only seen.
    const move = panel.getByRole("button", { name: "Start Progress" });
    await expect(move).toBeEnabled();
    await move.click();
    await expect(panel.locator(".status-pill")).toHaveText("In Progress");
  });
}
