import { expect, test, type Locator, type Page } from "@playwright/test";

// Mock-backed like every spec here (playwright.config.ts starts the server with
// VITE_TASKA_API_MODE=mock): any seeded user signs in with any password.
//
// **Nothing below is evidence about the gateway.** The worklog routes are on
// backend PR #178 (TAS-118), open and undeployed on 2026-10-10, and every
// answer this file reacts to comes from `MockTaskaStore`, which reproduces the
// Java at the PR's head (docs/ai/API-DIVERGENCE.md). Read these as pinning
// what the UI does with such answers.
//
// The seed: TAS-101 carries three entries — Sofia 1h 30m on Jun 12, Mark 2h
// and Anna 45m on Jun 13, 4h 15m in all — and a remaining estimate of 4h.
// TAS-107 carries one by an account nobody can name. Anna is an ADMIN of
// Taska Platform (any entry), Mark a MEMBER (his own), Tom a VIEWER (none).

async function signIn(page: Page, email = "anna@example.com") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);
}

async function openIssuePanel(page: Page, issueKey: string): Promise<Locator> {
  await page.locator(".project-card", { hasText: "Taska Platform" }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/board$/);
  await page.locator(".issue-card", { hasText: issueKey }).click();
  const panel = page.getByRole("complementary", { name: `${issueKey} issue` });
  await expect(panel).toBeVisible();
  return panel;
}

// Closing and reopening remounts the section, which reads the store again. A
// reload would not do: the store lives in memory and is rebuilt on every load.
async function reopenIssuePanel(page: Page, issueKey: string): Promise<Locator> {
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("complementary", { name: `${issueKey} issue` })).toHaveCount(0);
  await page.locator(".issue-card", { hasText: issueKey }).click();
  const panel = page.getByRole("complementary", { name: `${issueKey} issue` });
  await expect(panel).toBeVisible();
  return panel;
}

const workLog = (panel: Locator) => panel.locator(".issue-worklogs");
const rows = (section: Locator) => section.locator(".worklog-row");
const rowBy = (section: Locator, name: string) => rows(section).filter({ hasText: name });

test("an ADMIN logs work, and the issue's remaining estimate and version follow", async ({ page }) => {
  await signIn(page);
  const panel = await openIssuePanel(page, "TAS-101");
  const section = workLog(panel);

  await expect(rows(section)).toHaveCount(3);
  await expect(section.locator(".worklog-total")).toHaveText("4h 15m logged");
  // Same day, newest logged first — the tiebreak the server does not apply.
  await expect(rows(section).nth(0)).toContainText("Anna Ivanova");
  await expect(rows(section).nth(1)).toContainText("Mark Lee");
  await expect(rows(section).nth(2)).toContainText("Sofia Reyes");
  await expect(panel.getByLabel("Remaining estimate")).toHaveValue("4h");

  const form = section.getByRole("form", { name: "Log work" });
  await form.getByLabel("Time spent").fill("soon");
  await form.getByRole("button", { name: "Log work" }).click();
  await expect(form.getByText("Write the time in hours and minutes, e.g. 1h 30m, 90m or 1.5h.")).toBeVisible();
  await expect(form.getByLabel("Time spent")).toBeFocused();
  await expect(rows(section)).toHaveCount(3);

  await form.getByLabel("Time spent").fill("1.5h");
  await form.getByLabel("Comment").fill("Wrote the regression test.");
  await form.getByRole("button", { name: "Log work" }).click();

  await expect(rows(section)).toHaveCount(4);
  await expect(section.locator(".worklog-total")).toHaveText("5h 45m logged");
  await expect(rows(section).first()).toContainText("Wrote the regression test.");
  await expect(form.getByLabel("Time spent")).toHaveValue("");
  // The server moved the issue: the panel re-read it, so the planning box
  // shows what is left, and the next edit carries the version the write left —
  // a conflict here would mean the panel kept the old one.
  await expect(panel.getByLabel("Remaining estimate")).toHaveValue("2h 30m");
  await panel.getByRole("button", { name: "Low" }).click();
  await expect(panel.getByRole("button", { name: "Low" })).toHaveClass(/is-active/);
  await expect(panel.getByText(/was changed elsewhere/)).toHaveCount(0);
  await expect(panel.locator(".activity")).toContainText("logged 1h 30m");

  const reopened = workLog(await reopenIssuePanel(page, "TAS-101"));
  await expect(rows(reopened)).toHaveCount(4);
  await expect(reopened.locator(".worklog-total")).toHaveText("5h 45m logged");
});

test("an ADMIN edits an entry in place and deletes somebody else's after confirming", async ({ page }) => {
  await signIn(page);
  const panel = await openIssuePanel(page, "TAS-101");
  const section = workLog(panel);

  await rowBy(section, "Anna Ivanova").getByRole("button", { name: /^Edit 45m logged/ }).click();
  const editor = section.getByRole("form", { name: /^Edit 45m logged/ });
  await expect(editor.getByLabel("Time spent")).toBeFocused();
  await editor.getByLabel("Time spent").fill("1h");
  await editor.getByLabel("Comment").fill("Reviewed the fix.");
  await editor.getByRole("button", { name: "Save" }).click();

  const anna = rowBy(section, "Anna Ivanova");
  await expect(anna).toContainText("1h");
  await expect(anna).toContainText("Reviewed the fix.");
  await expect(section.locator(".worklog-total")).toHaveText("4h 30m logged");
  // Focus goes back to the button that opened the editor.
  await expect(anna.getByRole("button", { name: /^Edit 1h logged/ })).toBeFocused();

  // Escape abandons the editor and keeps the stored entry.
  await anna.getByRole("button", { name: /^Edit 1h logged/ }).click();
  await section.getByRole("form", { name: /^Edit 1h logged/ }).getByLabel("Time spent").fill("9h");
  await page.keyboard.press("Escape");
  await expect(anna).toContainText("1h");
  await expect(section.locator(".worklog-total")).toHaveText("4h 30m logged");

  // Mark's entry: an ADMIN may delete it. Cancel first, then for real.
  const mark = rowBy(section, "Mark Lee");
  await mark.getByRole("button", { name: /^Delete 2h logged/ }).click();
  await expect(mark.getByRole("button", { name: "Cancel" })).toBeFocused();
  await mark.getByRole("button", { name: "Cancel" }).click();
  await expect(mark.getByRole("button", { name: /^Delete 2h logged/ })).toBeFocused();

  await mark.getByRole("button", { name: /^Delete 2h logged/ }).click();
  await mark.getByRole("button", { name: "Delete entry" }).click();
  await expect(rowBy(section, "Mark Lee")).toHaveCount(0);
  await expect(section.locator(".worklog-total")).toHaveText("2h 30m logged");
  await expect(section.getByRole("heading", { name: /Work log/ })).toBeFocused();

  const reopened = workLog(await reopenIssuePanel(page, "TAS-101"));
  await expect(rows(reopened)).toHaveCount(2);
  await expect(rowBy(reopened, "Anna Ivanova")).toContainText("Reviewed the fix.");
});

test("a MEMBER may change only their own entry", async ({ page }) => {
  await signIn(page, "mark@example.com");
  const section = workLog(await openIssuePanel(page, "TAS-101"));

  await expect(rows(section)).toHaveCount(3);
  await expect(section.getByRole("form", { name: "Log work" })).toBeVisible();
  await expect(rowBy(section, "Mark Lee").getByRole("button", { name: /^Edit / })).toBeVisible();
  await expect(rowBy(section, "Anna Ivanova").getByRole("button")).toHaveCount(0);
  await expect(rowBy(section, "Sofia Reyes").getByRole("button")).toHaveCount(0);
});

test("a VIEWER reads the work log and is offered no way to change it", async ({ page }) => {
  await signIn(page, "tom@example.com");
  const section = workLog(await openIssuePanel(page, "TAS-101"));

  await expect(rows(section)).toHaveCount(3);
  await expect(section.locator(".worklog-total")).toHaveText("4h 15m logged");
  await expect(section.getByRole("form")).toHaveCount(0);
  await expect(section.getByRole("button")).toHaveCount(0);
  await expect(section.getByLabel("Time spent")).toHaveCount(0);
});

test("an entry by somebody nobody can name is drawn as Unknown", async ({ page }) => {
  await signIn(page);
  const section = workLog(await openIssuePanel(page, "TAS-107"));

  await expect(rows(section)).toHaveCount(2);
  await expect(rows(section).nth(1)).toContainText("Unknown");
  await expect(rows(section).nth(1)).toContainText("First look at the refresh path.");
  await expect(section.locator(".worklog-total")).toHaveText("4h logged");
});
