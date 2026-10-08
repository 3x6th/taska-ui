import { expect, test, type Locator, type Page } from "@playwright/test";

// Mock-backed like every spec here (playwright.config.ts starts the server with
// VITE_TASKA_API_MODE=mock): any seeded user signs in with any password.
//
// TAS-248: "Share" in the issue panel's head copies the issue's two addresses,
// and each copied link opens the same issue's panel. The links are read back
// from the real clipboard, so the permission is granted rather than the API
// stubbed.
//
// This server routes in browser mode at base `/`, so the links here have no
// hash. The Pages shape — `https://taska.ozero.dev/#/browse/API-5` — cannot be
// produced by this server at all and is pinned in `src/lib/appLinks.test.ts`.

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("anna@example.com");
  await page.getByLabel("Password").fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);
}

async function openIssue(page: Page, issueKey: string): Promise<Locator> {
  // By class, not by role and name: an ADMIN's project card also carries an
  // "Edit <name>" button, and a loose match on the name finds both.
  await page.locator(".project-card", { hasText: "Taska Platform" }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/board$/);
  await page.locator(".issue-card", { hasText: issueKey }).click();
  const panel = page.getByRole("complementary", { name: `${issueKey} issue` });
  await expect(panel).toBeVisible();
  return panel;
}

const readClipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText());

test("copies both links, and each one opens the same issue", async ({ page, baseURL }) => {
  await signIn(page);
  const panel = await openIssue(page, "TAS-101");
  const issueAddress = page.url();

  await panel.getByRole("button", { name: "Share issue TAS-101" }).click();
  const dialog = panel.getByRole("dialog", { name: "Share TAS-101" });
  await expect(dialog).toBeVisible();
  const status = dialog.getByRole("status");

  await dialog.getByRole("button", { name: "Copy short link" }).click();
  await expect(status).toHaveText("Short link copied");
  const shortLink = await readClipboard(page);
  expect(shortLink).toBe(`${baseURL}/browse/TAS-101`);
  await expect(dialog.getByRole("textbox", { name: "Short link" })).toHaveValue(shortLink);

  await dialog.getByRole("button", { name: "Copy full link" }).click();
  await expect(status).toHaveText("Full link copied");
  const fullLink = await readClipboard(page);
  // The full link is the address the open panel is at.
  expect(fullLink).toBe(issueAddress);
  await expect(dialog.getByRole("textbox", { name: "Full link" })).toHaveValue(fullLink);

  // The full link, followed inside the running app. Not with `page.goto`: the
  // mock store is rebuilt on every page load and mints new issue ids when it
  // is, so a cold load of *any* full link 404s against the mock. That is the
  // mock's, not the link's — the gateway's ids are stable — and the router
  // reading the address is the part under test either way.
  await panel.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page).toHaveURL(/\/board$/);
  await page.evaluate((address) => {
    window.history.pushState(null, "", address);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, fullLink);
  await expect(page).toHaveURL(fullLink);
  await expect(page.getByRole("complementary", { name: "TAS-101 issue" })).toBeVisible();

  // The short link, cold: a key is stable across loads, and `/browse` resolves
  // it into the issue's own address.
  await page.goto(shortLink);
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+\/issues\/[^/]+$/);
  await expect(page.getByRole("complementary", { name: "TAS-101 issue" })).toBeVisible();
});

test("opens from the keyboard, keeps a sane Tab order with §7's ring, and closes three ways", async ({ page }) => {
  await signIn(page);
  const panel = await openIssue(page, "TAS-101");
  const share = panel.getByRole("button", { name: "Share issue TAS-101" });
  const dialog = panel.getByRole("dialog", { name: "Share TAS-101" });
  const shortField = dialog.getByRole("textbox", { name: "Short link" });
  const copyShort = dialog.getByRole("button", { name: "Copy short link" });
  const fullField = dialog.getByRole("textbox", { name: "Full link" });
  const copyFull = dialog.getByRole("button", { name: "Copy full link" });

  await share.focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await expect(share).toHaveAttribute("aria-expanded", "true");

  // Trigger → each field and its button, in reading order.
  for (const control of [shortField, copyShort, fullField, copyFull]) {
    await page.keyboard.press("Tab");
    await expect(control).toBeFocused();
    // §7's ring in §2's accent — never the browser's own `auto` outline.
    const ring = await control.evaluate((element) => {
      const style = getComputedStyle(element);
      const probe = document.createElement("span");
      probe.style.color = "var(--accent)";
      element.parentElement!.append(probe);
      const accent = getComputedStyle(probe).color;
      probe.remove();
      return { style: style.outlineStyle, width: style.outlineWidth, offset: style.outlineOffset, matches: style.outlineColor === accent };
    });
    expect(ring).toEqual({ style: "solid", width: "2px", offset: "2px", matches: true });
  }

  // Escape: closed, and focus back on the trigger.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(share).toBeFocused();
  await expect(share).toHaveAttribute("aria-expanded", "false");

  // Space opens it too; tabbing past its last control closes it, so it never
  // hangs over the controls focus has moved on to.
  await page.keyboard.press(" ");
  await expect(dialog).toBeVisible();
  for (let step = 0; step < 5; step += 1) await page.keyboard.press("Tab");
  await expect(panel.getByRole("button", { name: "Delete", exact: true })).toBeFocused();
  await expect(dialog).toBeHidden();

  // A press outside closes it.
  await share.click();
  await expect(dialog).toBeVisible();
  await panel.getByRole("heading", { name: "Planning" }).click();
  await expect(dialog).toBeHidden();
});

test("hangs inside the panel and the screen at every width", async ({ page }) => {
  await signIn(page);
  const panel = await openIssue(page, "TAS-101");
  const share = panel.getByRole("button", { name: "Share issue TAS-101" });
  await share.click();
  const dialog = panel.getByRole("dialog", { name: "Share TAS-101" });
  await expect(dialog).toBeVisible();

  const width = page.viewportSize()?.width ?? 0;
  const pop = (await dialog.boundingBox())!;
  const aside = (await panel.boundingBox())!;
  const trigger = (await share.boundingBox())!;
  expect(pop.x).toBeGreaterThanOrEqual(aside.x);
  expect(pop.x + pop.width).toBeLessThanOrEqual(aside.x + aside.width);
  expect(pop.x + pop.width).toBeLessThanOrEqual(width);
  // Under its trigger, not somewhere else in the head.
  expect(pop.x).toBeLessThanOrEqual(trigger.x);
  expect(pop.x + pop.width).toBeGreaterThanOrEqual(trigger.x + trigger.width);
  expect(pop.y).toBeGreaterThanOrEqual(trigger.y + trigger.height);

  // Both Copy buttons whole on screen, beside a field that still shows text.
  for (const name of ["Short link", "Full link"]) {
    const field = (await dialog.getByRole("textbox", { name }).boundingBox())!;
    const copy = (await dialog.getByRole("button", { name: `Copy ${name.toLowerCase()}` }).boundingBox())!;
    expect(field.width).toBeGreaterThan(150);
    expect(copy.x + copy.width).toBeLessThanOrEqual(pop.x + pop.width);
  }
});
