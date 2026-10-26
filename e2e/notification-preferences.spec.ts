import { expect, test, type Page } from "@playwright/test";
import type { NotificationPreferences } from "../src/domain/types";

interface Fixture {
  row: NotificationPreferences;
  failPatch: boolean;
  holdRead: boolean;
  failRead: boolean;
  failConfirm: boolean;
  failDisconnect: boolean;
  patches: unknown[];
  confirmations: string[];
  reads: number;
}

type FixtureWindow = Window & { taskaNotificationFixture: Fixture };

// This is a browser-only API fixture, injected in place of client.ts. No
// production timer claims that /start occurred, and no test contacts Telegram.
// It is served as plain JavaScript, so it carries no type annotations.
const injectedClient = `
import { MockTaskaApi } from "/src/api/mock/MockTaskaApi.ts";

export const taskaApi = new MockTaskaApi();

const base = () => ({
  emailEnabled: true,
  telegramEnabled: false,
  email: "anna@example.com",
  telegramAvailable: true,
  telegramStatus: "NOT_CONNECTED",
  telegramUsername: null,
  telegramName: null,
  telegramLinkId: null,
  telegramLinkExpiresAt: null,
  telegramError: null,
});

const f = (window.taskaNotificationFixture = {
  row: base(),
  failPatch: false,
  failConfirm: false,
  failDisconnect: false,
  holdRead: false,
  failRead: false,
  patches: [],
  confirmations: [],
  reads: 0,
});

const failure = () =>
  Object.assign(new Error("Fixture refusal"), { status: 503, code: "UNAVAILABLE", requestId: "fixture-request-id" });
// No binding and no link; the email choice is the reader's and survives.
const unbound = () => ({ ...base(), emailEnabled: f.row.emailEnabled });
const settle = () => new Promise((resolve) => setTimeout(resolve, 120));

taskaApi.getNotificationPreferences = async () => {
  f.reads++;
  if (f.holdRead) await new Promise(() => {});
  if (f.failRead) throw failure();
  const expiresAt = f.row.telegramLinkExpiresAt;
  if (expiresAt && Date.parse(expiresAt) <= Date.now()) f.row = unbound();
  return { ...f.row };
};

taskaApi.updateNotificationPreferences = async (input) => {
  f.patches.push(input);
  await settle();
  if (f.failPatch) throw failure();
  f.row = { ...f.row, ...input };
  return { ...f.row };
};

taskaApi.createTelegramLink = async () => {
  const linkId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 600000).toISOString();
  f.row = {
    ...f.row,
    telegramStatus: "PENDING",
    telegramEnabled: false,
    telegramLinkId: linkId,
    telegramLinkExpiresAt: expiresAt,
  };
  return { linkId, url: "https://t.me/TaskaFixtureBot?start=fixture_opaque_token", expiresAt, preferences: { ...f.row } };
};

taskaApi.confirmTelegramLink = async (id) => {
  f.confirmations.push(id);
  await settle();
  if (f.failConfirm) {
    f.row = unbound();
    throw Object.assign(new Error("Link expired"), { status: 409, code: "ABORTED" });
  }
  f.row = {
    ...f.row,
    telegramStatus: "CONNECTED",
    telegramEnabled: true,
    telegramLinkId: null,
    telegramLinkExpiresAt: null,
  };
  return { ...f.row };
};

taskaApi.disconnectTelegram = async () => {
  if (f.failDisconnect) throw failure();
  f.row = unbound();
  return { ...f.row };
};
`;

const fixture = async (page: Page, input: Partial<Fixture>) =>
  page.evaluate((input) => Object.assign((window as unknown as FixtureWindow).taskaNotificationFixture, input), input);

const row = async (page: Page, input: Partial<NotificationPreferences>) =>
  page.evaluate(
    (input) => Object.assign((window as unknown as FixtureWindow).taskaNotificationFixture.row, input),
    input,
  );

/** What the fixture has recorded so far, read back from the page. */
const recorded = (page: Page) => page.evaluate(() => (window as unknown as FixtureWindow).taskaNotificationFixture);

/** A return to the tab: what makes TanStack Query read the choices again. */
const refresh = (page: Page) =>
  page.evaluate(() => {
    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });

async function signIn(page: Page, initialFixture?: Partial<Fixture>) {
  await page.route("**/src/api/client.ts", (route) =>
    route.fulfill({ contentType: "text/javascript", body: injectedClient }),
  );
  await page.route("https://t.me/**", (route) => route.abort("blockedbyclient"));
  await page.goto("/login");
  await page.getByLabel("Email").fill("anna@example.com");
  await page.getByLabel("Password", { exact: true }).fill("mock-password");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);
  if (initialFixture) await fixture(page, initialFixture);
  // A client-side route keeps the in-memory test fixture and QueryClient.
  await page.getByRole("button", { name: /Open profile/ }).click();
  await page.getByRole("link", { name: "Settings" }).click();
  if (!initialFixture?.holdRead && !initialFixture?.failRead) {
    await expect(page.getByRole("switch", { name: "Email" })).toBeVisible();
  }
}

const email = (page: Page) => page.getByRole("switch", { name: "Email" });
const tg = (page: Page) => page.getByRole("switch", { name: "Telegram" });

async function patch(page: Page, channel: "Email" | "Telegram", enabled: boolean) {
  const control = page.getByRole("switch", { name: channel });
  await control.click();
  await expect(control).toHaveAttribute("aria-checked", String(enabled));
  await expect(control).not.toHaveAttribute("aria-disabled");
}

async function candidate(page: Page) {
  await page.getByRole("button", { name: "Connect Telegram" }).click();
  const open = page.getByRole("link", { name: "Open Telegram bot" });
  await expect(open).toHaveAttribute("href", "https://t.me/TaskaFixtureBot?start=fixture_opaque_token");
  // An <a> in the secondary recipe (§4.1): no link underline.
  await expect(open).toHaveCSS("text-decoration-line", "none");
  await expect(page.getByRole("button", { name: "Confirm Telegram account" })).toHaveCount(0);
  const linkId = (await recorded(page)).row.telegramLinkId;
  // Explicit test event, standing for the bot webhook after /start.
  await row(page, { telegramStatus: "AWAITING_CONFIRMATION", telegramName: "Anna Telegram", telegramUsername: "anna_tg" });
  await refresh(page);
  await expect(page.getByText("Anna Telegram · @anna_tg")).toBeVisible();
  return linkId;
}

test("connects the candidate, selects all four channel combinations, and disconnects", async ({ page }) => {
  await signIn(page);
  await expect(email(page)).toHaveAttribute("aria-checked", "true");
  await expect(tg(page)).toHaveAttribute("aria-checked", "false");
  await expect(tg(page)).toHaveAttribute("aria-disabled", "true");
  const linkId = await candidate(page);
  await page.getByRole("button", { name: "Confirm Telegram account" }).click();
  await expect(tg(page)).toHaveAttribute("aria-checked", "true");
  await expect(email(page)).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("heading", { name: "Notifications" })).toBeFocused();
  expect((await recorded(page)).confirmations).toEqual([linkId]);
  await patch(page, "Email", false);
  await expect(tg(page)).toHaveAttribute("aria-checked", "true");
  await patch(page, "Telegram", false);
  await expect(email(page)).toHaveAttribute("aria-checked", "false");
  await patch(page, "Email", true);
  await expect(tg(page)).toHaveAttribute("aria-checked", "false");
  await page.getByRole("button", { name: "Disconnect Telegram" }).click();
  await expect(page.getByRole("button", { name: "Connect Telegram" })).toBeVisible();
  await expect(email(page)).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText(/Notifications in Taska are always kept/)).toBeVisible();
});

test("rolls back failed toggles and keeps a refused disconnect connected", async ({ page }) => {
  await signIn(page);
  await fixture(page, { failPatch: true });
  await email(page).click();
  await expect(
    page.getByText("Taska could not confirm the notification change. Check the current choices."),
  ).toBeVisible();
  await expect(email(page)).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("button", { name: "Copy request id fixture-request-id" })).toBeVisible();
  await fixture(page, { failPatch: false });
  await candidate(page);
  await page.getByRole("button", { name: "Confirm Telegram account" }).click();
  await expect(tg(page)).toHaveAttribute("aria-checked", "true");
  await fixture(page, { failDisconnect: true });
  await page.getByRole("button", { name: "Disconnect Telegram" }).click();
  await expect(
    page.getByText("Taska could not confirm the Telegram disconnection. Check the current connection."),
  ).toBeVisible();
  await expect(tg(page)).toHaveAttribute("aria-checked", "true");
});

test("reconciles an expired candidate and stops polling once it is gone", async ({ page }) => {
  await signIn(page);
  await candidate(page);
  await fixture(page, { failConfirm: true });
  await page.getByRole("button", { name: "Confirm Telegram account" }).click();
  await expect(
    page.getByText("Taska could not confirm the Telegram connection. Check the current connection."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect Telegram" })).toBeVisible();
  await expect(tg(page)).toHaveAttribute("aria-checked", "false");
  const reads = (await recorded(page)).reads;
  await page.waitForTimeout(3300);
  expect((await recorded(page)).reads).toBe(reads);
});

test("observes a link's expiry and /stop when returning to the profile", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Connect Telegram" }).click();
  await expect(page.getByRole("link", { name: "Open Telegram bot" })).toBeVisible();
  await row(page, { telegramLinkExpiresAt: "2020-01-01T00:00:00Z" });
  await refresh(page);
  await expect(page.getByRole("button", { name: "Connect Telegram" })).toBeVisible();
  await candidate(page);
  await page.getByRole("button", { name: "Confirm Telegram account" }).click();
  await expect(tg(page)).toHaveAttribute("aria-checked", "true");
  await row(page, { telegramStatus: "NOT_CONNECTED", telegramEnabled: false, telegramName: null, telegramUsername: null });
  await refresh(page);
  await expect(page.getByRole("button", { name: "Connect Telegram" })).toBeVisible();
  await expect(tg(page)).toHaveAttribute("aria-checked", "false");
});

// The screenshots go to each test's own output directory, never into the
// repository; motion is reduced so a frame is never caught mid-transition.
for (const theme of ["light", "dark"] as const) {
  test.describe(`in the ${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.addInitScript((theme) => window.localStorage.setItem("taska.theme", theme), theme);
    });

    test("keeps the notification switches operable by keyboard and inside the viewport", async ({ page }, testInfo) => {
      await signIn(page);
      await email(page).focus();
      await page.keyboard.press("Space");
      await expect(email(page)).toHaveAttribute("aria-checked", "false");
      await expect(email(page)).not.toHaveAttribute("aria-disabled");
      await expect(email(page)).toBeFocused();
      await expect(email(page)).toHaveCSS("outline-style", "solid");
      const region = page.getByRole("region", { name: "Notifications" });
      const box = (await region.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
      await candidate(page);
      await region.scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath("candidate.png"), fullPage: true });
      await page.getByRole("button", { name: "Confirm Telegram account" }).click();
      await expect(tg(page)).toHaveAttribute("aria-checked", "true");
      await patch(page, "Email", true);
      await region.scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath("connected.png"), fullPage: true });
      await row(page, {
        telegramStatus: "UNAVAILABLE",
        telegramEnabled: false,
        telegramError: "TELEGRAM_DELIVERY_UNAVAILABLE",
      });
      await refresh(page);
      // One note, the code's sentence; the description stays the account.
      await expect(page.getByText(/The bot cannot reach your Telegram account/)).toBeVisible();
      await expect(page.getByText(/The connected bot cannot deliver notifications/)).toHaveCount(0);
      await expect(page.getByText("TELEGRAM_DELIVERY_UNAVAILABLE", { exact: true })).toHaveCount(0);
      await expect(region.locator(".settings-row-description", { hasText: "Anna Telegram · @anna_tg" })).toBeVisible();
      await expect(tg(page)).toHaveAttribute("data-unavailable", "true");
      await expect(tg(page)).toHaveCSS("opacity", "0.58");
      await expect(page.getByRole("button", { name: "Disconnect Telegram" })).toBeVisible();
      await region.scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath("unavailable.png"), fullPage: true });
    });

    test("shows a shaped loading state on mobile", async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "mobile", "phone evidence");
      await signIn(page, { holdRead: true });
      const region = page.getByRole("region", { name: "Notifications" });
      await expect(region.getByRole("status")).toHaveText("Loading notification choices");
      await region.scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath("loading.png"), fullPage: true });
    });

    test("spaces a failed read, its request id and Try again at every width", async ({ page }, testInfo) => {
      const mobile = testInfo.project.name === "mobile";
      await signIn(page, { failRead: true });
      const region = page.getByRole("region", { name: "Notifications" });
      await expect(region.getByText("Your notification choices could not be loaded.")).toBeVisible();
      // The request id is the page's first mono text, and its web font swaps
      // in late enough to re-wrap the notice: wait for it, then take every
      // rectangle in one pass so nothing can reflow between two reads.
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      const layout = await region.evaluate((section) => {
        const rect = (selector: string) => section.querySelector(selector)!.getBoundingClientRect();
        const lead = rect(".settings-lead");
        const notice = rect(".api-notice");
        const retry = rect(".settings-notification-retry");
        return {
          underLead: notice.top - lead.bottom,
          underNotice: retry.top - notice.bottom,
          retryHeight: retry.height,
        };
      });
      expect(layout.underLead).toBeCloseTo(14, 0);
      expect(layout.underNotice).toBeCloseTo(8, 0);
      if (mobile) {
        expect(layout.retryHeight).toBeGreaterThanOrEqual(44);
        const copy = (await region.getByRole("button", { name: "Copy request id fixture-request-id" }).boundingBox())!;
        expect(copy.height).toBeGreaterThanOrEqual(44);
      }
      await region.scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath("read-error.png"), fullPage: true });
    });

    test("rolls back a refused switch and keeps its request id reachable on mobile", async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "mobile", "phone evidence");
      await signIn(page);
      const region = page.getByRole("region", { name: "Notifications" });
      await fixture(page, { failPatch: true });
      await email(page).click();
      await expect(
        region.getByText("Taska could not confirm the notification change. Check the current choices."),
      ).toBeVisible();
      await expect(email(page)).toHaveAttribute("aria-checked", "true");
      await expect(email(page)).not.toHaveAttribute("aria-disabled");
      const copy = (await region.getByRole("button", { name: "Copy request id fixture-request-id" }).boundingBox())!;
      expect(copy.height).toBeGreaterThanOrEqual(44);
      await region.scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath("write-error.png"), fullPage: true });
    });
  });
}

// §4.29 (TAS-202, art-director on the owner's remark): the switch is drawn at
// the pill's scale, 32×18, and below 820 its `::before` widens what a finger
// can hit to 44×44 without changing what is drawn. The zone is measured, and
// then hit: each of its corners, asked of the page, has to land on the switch
// rather than on the row around it.
test("gives each switch a 44×44 target on a phone while drawing it at 32×18", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "the ≤820 touch target");
  await signIn(page);
  for (const control of [email(page), tg(page)]) {
    await control.scrollIntoViewIfNeeded();
    const measured = await control.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const before = getComputedStyle(element, "::before");
      const border = parseFloat(style.borderTopWidth);
      // `inset` on an absolute `::before` is measured from the padding box.
      const zone = {
        left: rect.left + border + parseFloat(before.left),
        top: rect.top + border + parseFloat(before.top),
        right: rect.right - border - parseFloat(before.right),
        bottom: rect.bottom - border - parseFloat(before.bottom),
      };
      const inside = 0.5;
      const corners = [
        [zone.left + inside, zone.top + inside],
        [zone.right - inside, zone.top + inside],
        [zone.left + inside, zone.bottom - inside],
        [zone.right - inside, zone.bottom - inside],
      ];
      return {
        drawn: { width: rect.width, height: rect.height },
        zone: { width: zone.right - zone.left, height: zone.bottom - zone.top },
        cornersHit: corners.map(([x, y]) => document.elementFromPoint(x, y)?.closest("[role='switch']") === element),
      };
    });
    expect(measured.drawn.width).toBeCloseTo(32, 0);
    expect(measured.drawn.height).toBeCloseTo(18, 0);
    expect(measured.zone.width).toBeGreaterThanOrEqual(44);
    expect(measured.zone.height).toBeGreaterThanOrEqual(44);
    expect(measured.cornersHit).toEqual([true, true, true, true]);
  }
});
