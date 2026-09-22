import { expect, test, type Page } from "@playwright/test";

// Runs against MockTaskaApi like every other suite here (playwright.config.ts
// starts the server with VITE_TASKA_API_MODE=mock). Omar is the seeded LOCKED
// account, and since TAS-237 the mock refuses him in the gateway's own shape —
// `PERMISSION_DENIED` carrying `Account is locked until <ISO>. Try again later.`
// — because that refusal is otherwise unreachable outside production: reaching
// LOCKED takes repeated failed sign-ins against the real auth-service.
const LOCKED_ACCOUNT = "omar@example.com";

/** The ISO instant pattern, as `src/lib/accountLock.ts` pins it. */
const ISO_INSTANT = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/;

async function attemptLockedSignIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(LOCKED_ACCOUNT);
  await page.getByLabel("Password").fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();

  const lines = page.locator(".auth-lock > span");
  await expect(lines).toHaveCount(2);
  return lines;
}

/**
 * The deadline as a clock in a named zone — what the reader in that zone
 * should be looking at. Not a copy of the production formatter: that one is
 * given no `timeZone` at all and takes the browser's, so naming one here is
 * what turns "it formatted something" into "it used the reader's zone".
 */
function clockIn(instant: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(new Date(instant));
}

// The reporter's own zone, and the one the story's worked example is written
// in: the backend sends 11:55:50Z and they expect 14:55.
test.describe("in UTC+3, the zone TAS-237 was reported from", () => {
  test.use({ timezoneId: "Europe/Moscow", locale: "en-US" });

  test("a locked account is refused with the deadline on the reader's clock, over two lines", async ({ page }) => {
    const lines = await attemptLockedSignIn(page);

    // Criterion: two lines, HH:mm, and no ISO anywhere near the reader.
    await expect(lines.first()).toHaveText(/^Account is locked until \d{2}:\d{2}$/);
    await expect(lines.nth(1)).toHaveText("Try again later.");
    await expect(page.locator(".form-error")).not.toHaveText(ISO_INSTANT);

    // The machine-readable instant is still on the page, on the <time> that
    // carries the visible clock — so the two can be compared rather than the
    // rendering being taken on trust.
    const deadline = page.locator(".auth-lock time");
    const instant = await deadline.getAttribute("datetime");
    expect(instant).toMatch(ISO_INSTANT);
    await expect(deadline).toHaveText(clockIn(instant!, "Europe/Moscow"));

    // 15m is AUTH_SECURITY_LOCK_DURATION; the bound only has to be loose
    // enough to survive the round trip and tight enough to catch a deadline
    // read out of the wrong field.
    const waitMs = Date.parse(instant!) - Date.now();
    expect(waitMs).toBeGreaterThan(0);
    expect(waitMs).toBeLessThanOrEqual(15 * 60 * 1000);

    // The full local date-time is in `title`, where the short form's one
    // ambiguity — a lock that ends after midnight — is answered.
    await expect(deadline).toHaveAttribute("title", /\w{3} \d{1,2}, \d{2}:\d{2}/);

    // The refusal is still a refusal: no session, no navigation.
    await expect(page).toHaveURL(/\/login$/);

    // Mock mode carries no `X-Request-Id` — MockApiError never went over a
    // wire — so the id line the REST path now gets is correctly absent here.
    // Pinned so its appearance in mock mode would be noticed rather than
    // welcomed.
    await expect(page.locator(".form-error .request-id-line")).toHaveCount(0);
  });

  test("the second line is centred against the first", async ({ page }) => {
    const lines = await attemptLockedSignIn(page);

    // The story asks for this by name. Read off the computed style rather than
    // from a screenshot so it survives a stylesheet rewrite, and read off the
    // block rather than `.form-error`, which is shared with the issue composer
    // and the project dialog and must stay left-aligned for them.
    await expect(lines.first()).toHaveCSS("text-align", "center");
    await expect(lines.nth(1)).toHaveCSS("text-align", "center");
    await expect(page.locator(".form-error").first()).not.toHaveCSS("text-align", "center");
  });
});

// The same lock read from a zone eight hours off the reporter's. Adding three
// hours in code would pass every assertion above and fail this one, which is
// the only reason this test exists.
test.describe("in UTC-4, where a hard-coded +3 would be wrong", () => {
  test.use({ timezoneId: "America/New_York", locale: "en-US" });

  test("the same deadline renders on that reader's clock instead", async ({ page }) => {
    const lines = await attemptLockedSignIn(page);
    const deadline = page.locator(".auth-lock time");
    const instant = await deadline.getAttribute("datetime");

    await expect(deadline).toHaveText(clockIn(instant!, "America/New_York"));
    await expect(deadline).not.toHaveText(clockIn(instant!, "Europe/Moscow"));
    await expect(lines.nth(1)).toHaveText("Try again later.");
  });
});

// The branch the parser falls back to, reached the only way mock mode can
// reach it: a refusal that is not a lockout at all. The sentence is the
// server's, verbatim — which is what the lock branch does too when the
// deadline cannot be read.
test("a sign-in refused for any other reason still prints the server's own sentence", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("nina@example.com");
  await page.getByLabel("Password").fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();

  await expect(page.locator(".form-error")).toHaveText("Invalid credentials");
  await expect(page.locator(".auth-lock")).toHaveCount(0);
  await expect(page).toHaveURL(/\/login$/);
});
