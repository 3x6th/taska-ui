import { expect, test, type Page } from "@playwright/test";

// Mock-backed like every spec here (playwright.config.ts starts the server with
// VITE_TASKA_API_MODE=mock): any seeded user signs in with any password.
//
// TAS-246, the frontend half of backend TAS-214. Two things are pinned:
//
// - the short address of an issue, `/browse/{issueKey}`, resolved by the server
//   (`GET /issues/by-key/{issueKey}`) and never by guessing a project from the
//   key's prefix. Anna is not a member of Mobile, so `MOB-5` is the 403; `NOPE-1`
//   is the 404. Both draw §4.18's one sentence — the difference is kept in
//   `data-reason`, not on screen;
// - the panel drawn from its one read: people named by the read itself, a
//   watcher nobody can name drawn as "Unknown" rather than as a blank (TAS-106
//   carries the seed's one former account), and empty parts said as empty.
//
// Nothing here is evidence about the gateway: every answer comes from
// `MockTaskaStore`. A part the server did not send at all is reachable only in
// the unit suite (src/screens/BoardScreen.test.tsx), because the mock cannot
// fail one part of its own read.

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("anna@example.com");
  await page.getByLabel("Password").fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);
}

const panelOf = (page: Page, issueKey: string) => page.getByRole("complementary", { name: `${issueKey} issue` });

test("opens an issue from its key, in its own project, whatever the key's case", async ({ page }) => {
  await signIn(page);

  await page.goto("/browse/tas-101");

  // The short address is replaced by the issue's own.
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+\/issues\/[^/]+$/);
  await expect(panelOf(page, "TAS-101")).toBeVisible();
  // And Back does not land on a page that only ever redirects.
  await page.goBack();
  await expect(page).toHaveURL(/\/projects$/);
});

test("answers a key nobody has with the not-found screen", async ({ page }) => {
  await signIn(page);

  await page.goto("/browse/NOPE-1");

  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await expect(page.getByRole("main")).toHaveAttribute("data-reason", "missing");
  await page.getByRole("link", { name: "Go to projects" }).click();
  await expect(page).toHaveURL(/\/projects$/);
});

test("answers a key in a project the reader is not on with the same screen and the same words", async ({ page }) => {
  await signIn(page);

  await page.goto("/browse/MOB-5");

  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await expect(page.getByRole("main")).toHaveAttribute("data-reason", "forbidden");
  // §4.18: nothing on screen says the key names an issue somewhere.
  await expect(page.getByText(/doesn.t exist, or you don.t have access to it/)).toBeVisible();
  await expect(page.getByText("Access denied")).toHaveCount(0);
});

test("sends a signed-out visitor to sign in and back to the issue", async ({ page }) => {
  await page.goto("/browse/TAS-102");
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel("Email").fill("anna@example.com");
  await page.getByLabel("Password").fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();

  await expect(panelOf(page, "TAS-102")).toBeVisible();
});

test("draws the panel's people, links and files from its one read", async ({ page }) => {
  await signIn(page);
  await page.goto("/browse/TAS-101");
  const panel = panelOf(page, "TAS-101");
  await expect(panel).toBeVisible();

  // Watchers named by their rows, attachments by their uploaders, and the
  // link's other end by the server's own target.
  await expect(panel.locator(".issue-watchers").getByText("Mark Lee")).toBeVisible();
  await expect(panel.locator(".issue-attachments").getByText(/Mark Lee/)).toBeVisible();
  await expect(panel.locator(".issue-links").getByRole("button", { name: /TAS-102/ }).first()).toBeVisible();
});

test("draws a watcher nobody can name as Unknown, never as a blank row", async ({ page }) => {
  await signIn(page);
  await page.goto("/browse/TAS-106");
  const watchers = panelOf(page, "TAS-106").locator(".issue-watchers");

  await expect(watchers.locator(".watcher-row")).toHaveCount(1);
  await expect(watchers.locator(".watcher-name")).toHaveText("Unknown");
});

test("says each empty part is empty", async ({ page }) => {
  await signIn(page);
  await page.goto("/browse/TAS-108");
  const panel = panelOf(page, "TAS-108");
  await expect(panel).toBeVisible();

  await expect(panel.getByText("No labels yet")).toBeVisible();
  await expect(panel.getByText("No links yet")).toBeVisible();
  await expect(panel.getByText("No attachments yet")).toBeVisible();
  await expect(panel.getByText("No one is watching this issue yet")).toBeVisible();
  await expect(panel.getByText(/could not be loaded with this issue/)).toHaveCount(0);
});
