import { expect, test, type Locator, type Page } from "@playwright/test";

// Mock-backed like every spec here (playwright.config.ts starts the server with
// VITE_TASKA_API_MODE=mock): any seeded user signs in with any password, and the
// seed ships issue links so the panel has something to show on first load —
// TAS-101 blocks TAS-102, and TAS-110 duplicates TAS-101. Anna is an ADMIN of
// the Taska Platform project and not a member of Mobile, which is how both the
// editable and the read-only view are reached below.
//
// What this file is NOT: a statement about the gateway. Every relation it
// asserts comes from `MockTaskaStore`, whose inverse view (`BLOCKS` read from
// the other end as `IS_BLOCKED_BY`) is this repository's reading of the
// contract's `viewLinkType`, not observed behaviour — see
// docs/ai/API-DIVERGENCE.md. Read these as pinning what the UI does with such a
// response, never as evidence that the server sends one.

async function openIssuePanel(page: Page, issueKey: string): Promise<Locator> {
  await page.goto("/login");
  await page.getByLabel("Email").fill("anna@example.com");
  await page.getByLabel("Password").fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();

  await page.getByRole("button", { name: /Taska Platform/ }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/board$/);

  await page.locator(".issue-card", { hasText: issueKey }).click();
  await expect(page.getByRole("complementary", { name: `${issueKey} issue` })).toBeVisible();

  return page.locator(".issue-links");
}

test("shows the links seeded for an issue", async ({ page }) => {
  const links = await openIssuePanel(page, "TAS-101");

  await expect(links.getByRole("heading", { name: /Links/ })).toBeVisible();
  await expect(links.getByRole("button", { name: /Blocks TAS-102/ })).toBeVisible();
  // The relation is stated in words, not left as a wire value.
  await expect(links).not.toContainText("RELATES_TO");
});

// Closing and reopening the panel remounts the section, which refetches from
// the store. A `page.reload()` would not do here: MockTaskaStore lives in
// memory and is rebuilt on every page load, so a reload would discard the very
// link the round trip is supposed to prove and the assertion would be about
// the seed instead.
async function reopenIssuePanel(page: Page, issueKey: string): Promise<Locator> {
  // Exact: the backdrop behind the panel is also a button, named "Close issue".
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("complementary", { name: `${issueKey} issue` })).toHaveCount(0);
  await page.locator(".issue-card", { hasText: issueKey }).click();
  await expect(page.getByRole("complementary", { name: `${issueKey} issue` })).toBeVisible();
  return page.locator(".issue-links");
}

test("adds a link, sees it appear, removes it and sees it go", async ({ page }) => {
  let links = await openIssuePanel(page, "TAS-101");

  await links.getByRole("button", { name: "Relates to", exact: true }).click();

  const picker = links.locator("select");
  const option = picker.locator("option", { hasText: "TAS-105" });
  const value = await option.getAttribute("value");
  await picker.selectOption(value!);
  await links.getByRole("button", { name: "Link", exact: true }).click();

  await expect(links.getByRole("button", { name: /Relates to TAS-105/ })).toBeVisible();
  // An issue already linked is not offered again.
  await expect(picker.locator("option", { hasText: "TAS-105" })).toHaveCount(0);
  // The optimistic row carries no link id, so its remove control is disabled
  // until the server's answer replaces it. Waiting for the control to come
  // alive is what separates "the cache was written" from "the link exists".
  await expect(links.getByRole("button", { name: "Remove link to TAS-105" })).toBeEnabled();

  links = await reopenIssuePanel(page, "TAS-101");
  await expect(links.getByRole("button", { name: /Relates to TAS-105/ })).toBeVisible();

  await links.getByRole("button", { name: "Remove link to TAS-105" }).click();
  await expect(links.getByRole("button", { name: /Relates to TAS-105/ })).toHaveCount(0);

  links = await reopenIssuePanel(page, "TAS-101");
  await expect(links.getByRole("button", { name: /Relates to TAS-105/ })).toHaveCount(0);
  await expect(links.locator("select").locator("option", { hasText: "TAS-105" })).toHaveCount(1);
  // The seeded link is untouched by the round trip.
  await expect(links.getByRole("button", { name: /Blocks TAS-102/ })).toBeVisible();
});

test("keeps no state from the issue it was just looking at", async ({ page }) => {
  // Following a link is the first navigation in this app that swaps the panel's
  // issue without leaving the panel. Anything it remembers per issue — a comment
  // draft above all, which would otherwise be posted onto an issue it was not
  // written for — has to go with it.
  //
  // TAS-102 is opened once first on purpose. With its issue already in the
  // query cache the panel has no loading frame to render on arrival, so the
  // comment thread is never unmounted along the way — which is the only
  // condition under which the leak is visible, and the reason a test that skips
  // this step passes either way.
  await openIssuePanel(page, "TAS-102");
  await expect(page.locator(".comment-composer textarea")).toBeVisible();

  const links = await reopenIssuePanel(page, "TAS-101");
  await page.locator(".comment-composer textarea").fill("draft-marker-101");
  // Same for the links form: it must not carry a half-filled relation over.
  await links.getByRole("button", { name: "Duplicates", exact: true }).click();

  await links.getByRole("button", { name: /Blocks TAS-102/ }).click();
  await expect(page.getByRole("complementary", { name: "TAS-102 issue" })).toBeVisible();

  await expect(page.locator(".comment-composer textarea")).toHaveValue("");
  await expect(page.locator(".issue-panel")).not.toContainText("draft-marker-101");
  await expect(page.locator(".issue-links .segmented button.is-active")).toHaveText("Blocks");
});

test("walks to the linked issue from the keyboard and shows the relation from that end", async ({ page }) => {
  const links = await openIssuePanel(page, "TAS-101");

  const row = links.getByRole("button", { name: /Blocks TAS-102/ });
  await row.focus();
  await expect(row).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page.getByRole("complementary", { name: "TAS-102 issue" })).toBeVisible();
  // The mock answers each end with the relation as *that* end sees it, so the
  // blocked issue reads "Is blocked by" — a value the request enum cannot
  // express. What is pinned here is that the UI prints whatever string it is
  // given; whether the gateway inverts anything at all is unverified
  // (docs/ai/API-DIVERGENCE.md).
  await expect(page.locator(".issue-links").getByRole("button", { name: /Is blocked by TAS-101/ })).toBeVisible();
});

test("says so quietly when an issue has no links", async ({ page }) => {
  const links = await openIssuePanel(page, "TAS-104");

  await expect(links.getByText("No links yet")).toBeVisible();
});

test("a viewer reads the links and is offered no way to change them", async ({ page }) => {
  // Anna is not a member of the Mobile project, so the mock answers VIEWER for
  // it. The board is reachable by URL, which is the point: hiding the controls
  // is a UI courtesy and the server stays the authority.
  await page.goto("/login");
  await page.getByLabel("Email").fill("anna@example.com");
  await page.getByLabel("Password").fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);

  await page.goto("/projects/f315c5cf-3333-47d1-8d22-79f07c2ec99b/board");
  await page.locator(".issue-card", { hasText: "MOB-5" }).click();
  await expect(page.getByRole("complementary", { name: "MOB-5 issue" })).toBeVisible();

  const links = page.locator(".issue-links");
  await expect(links.getByRole("button", { name: /Blocks MOB-6/ })).toBeVisible();
  await expect(links.locator("select")).toHaveCount(0);
  await expect(links.getByRole("button", { name: "Link", exact: true })).toHaveCount(0);
  await expect(links.getByRole("button", { name: /^Remove link/ })).toHaveCount(0);
});
