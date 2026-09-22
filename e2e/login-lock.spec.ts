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

/**
 * The browser's clock while a lock is attempted, because the mock's deadline
 * is fifteen minutes out from whatever `Date.now()` says and the screen now
 * reads the *day* of it (`formatLockDeadline`). On the real clock that makes
 * the rendered shape a function of the time of day the suite happens to run
 * at: between 23:45 and midnight the deadline crosses into tomorrow and the
 * sentence gains a date. Pinned, both shapes are reachable on purpose and
 * neither is reachable by accident.
 *
 * 09:30Z is 12:30 in Moscow and 05:30 in New York — a long way from midnight
 * in both zones the suite names, so the ordinary same-day shape is what the
 * ordinary tests get, on any machine and at any hour.
 */
const ORDINARY_HOUR = "2026-09-22T09:30:00Z";

/**
 * 23:50 in Moscow, so the deadline is 00:05 on the 23rd for a reader there —
 * and 20:50Z against 21:05Z, which is one and the same UTC day. A screen
 * comparing `toISOString()` days would call that today and print the bare
 * clock, so the two describes below that pin this hour are what say the
 * comparison is made on the local day.
 */
const BEFORE_LOCAL_MIDNIGHT = "2026-09-22T20:50:00Z";

async function attemptLockedSignIn(page: Page, now = ORDINARY_HOUR) {
  // Before the first navigation: `setFixedTime` freezes `Date.now` and `new
  // Date()` for every document that follows, and leaves timers running, which
  // the mock's own latency needs.
  await page.clock.setFixedTime(new Date(now));
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
    // read out of the wrong field. Measured against the pinned clock rather
    // than this process's own: the page's `Date.now` is the fixed one, and
    // Node's is not.
    const waitMs = Date.parse(instant!) - Date.parse(ORDINARY_HOUR);
    expect(waitMs).toBeGreaterThan(0);
    expect(waitMs).toBeLessThanOrEqual(15 * 60 * 1000);

    // This deadline lands on the reader's own day, so the short form is
    // unambiguous and the full local date-time stays in `title` — which the
    // reader with a mouse can reach and, as the case below records, the reader
    // on a phone cannot.
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

// A lock that ends after the reader's own midnight, which is the one case the
// short clock cannot carry alone — and, until TAS-237's review, the one the
// `title` was supposed to answer. On a phone it answers nothing: there is no
// hover, a `<time>` takes no focus, and no keyboard route reaches a `title`
// either, so `Account is locked until 00:05` was all a phone reader got.
//
// This lives here rather than in a unit test for the same reason the zone
// claim does (see the note over `formatLockTime`'s cases in
// `src/lib/accountLock.test.ts`): the pair below separates a local-day
// comparison from a UTC one only in a zone somebody controls, and
// `timezoneId` plus a pinned clock is the only place in this repository where
// both are parameters.
test.describe("when the lock runs past the reader's midnight", () => {
  test.use({ timezoneId: "Europe/Moscow", locale: "en-US" });

  test("the date is in the sentence itself, not only in the title", async ({ page }) => {
    const lines = await attemptLockedSignIn(page, BEFORE_LOCAL_MIDNIGHT);

    // Anchored at both ends, because the zone token is the thing that must not
    // be here: at 12px/600 `… Sep 23, 00:05 GMT+3` needs 238.4px and the line
    // box is `0.9 × viewport − 74`, so it took a third line at every viewport
    // at or below 347. None of this suite's three projects is that narrow —
    // the phone one is 390 — so the wrap was measured in the browser and what
    // is pinned here is the string that avoids it.
    await expect(lines.first()).toHaveText("Account is locked until Sep 23, 00:05");
    await expect(lines.nth(1)).toHaveText("Try again later.");

    // The machine-readable instant is untouched by any of this.
    await expect(page.locator(".auth-lock time")).toHaveAttribute("datetime", ISO_INSTANT);

    // And the zone is where it went: `title`, on this branch exactly as on the
    // ordinary one. It repeats nothing — the visible sentence never carries a
    // zone token — and it is the only place this reader is told whose midnight
    // "Sep 23" is.
    await expect(page.locator(".auth-lock time")).toHaveAttribute("title", "Sep 23, 00:05 GMT+3");
  });
});

// The locale, which is a different setting from the zone and was being handed
// to the browser along with it until TAS-237's review measured what that
// costs. `Intl` takes the runtime's zone whether or not a locale is passed, so
// pinning `en-US` gives up nothing the story asked for — while leaving it
// unpinned gave up the calendar: this exact sentence rendered
// `۱ مهر، ۰۰:۰۵` here, a Solar Hijri date inside an English sentence in a
// document whose `<html lang>` is `en`.
//
// Here rather than in a unit test for the reason the zone claim is here: this
// repository's Vitest runner reports `en-US`, so in that process a pinned
// locale and an unpinned one produce the same string, and a case asserting the
// pin could not fail. `locale` is a parameter only in Playwright.
test.describe("in a browser set to a non-Gregorian locale", () => {
  test.use({ timezoneId: "Europe/Moscow", locale: "fa-IR" });

  test("the sentence keeps the product's calendar and the reader keeps their zone", async ({ page }) => {
    const lines = await attemptLockedSignIn(page, BEFORE_LOCAL_MIDNIGHT);

    // Gregorian, Latin digits, English month — the same bytes the `en-US`
    // browser one block up gets.
    await expect(lines.first()).toHaveText("Account is locked until Sep 23, 00:05");
    await expect(lines.nth(1)).toHaveText("Try again later.");

    // And the zone is still Moscow's, which is the half that must *not* be
    // pinned: 20:50Z reads as the 23rd here and would read as the 22nd in New
    // York. A `timeZone` option anywhere in `src/lib/accountLock.ts` fails this
    // line in one direction, and a locale-dependent formatter fails the two
    // above in the other.
    await expect(page.locator(".auth-lock time")).toHaveAttribute("title", "Sep 23, 00:05 GMT+3");
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
