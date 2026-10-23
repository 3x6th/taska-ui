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
  return { linkId, url: "https://t.me/TaskaFixtureBot?start=fixture_opaque_token", expiresAt };
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
    page.getByText("Taska could not confirm the notification change. Check the current choices below."),
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
    page.getByText("Taska could not confirm the Telegram disconnection. Check the current connection below."),
  ).toBeVisible();
  await expect(tg(page)).toHaveAttribute("aria-checked", "true");
});

test("reconciles an expired candidate and stops polling once it is gone", async ({ page }) => {
  await signIn(page);
  await candidate(page);
  await fixture(page, { failConfirm: true });
  await page.getByRole("button", { name: "Confirm Telegram account" }).click();
  await expect(
    page.getByText("Taska could not confirm the Telegram connection. Check the current connection below."),
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

for (const theme of ["light", "dark"] as const) {
  test(`uses switches by keyboard, fits the viewport and captures ${theme} appearance`, async ({ page }, testInfo) => {
    const evidence = (name: string) => `docs/ai/evidence/TAS-387/${testInfo.project.name}-${theme}-${name}.png`;
    await page.addInitScript((theme) => window.localStorage.setItem("taska.theme", theme), theme);
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
    await page.screenshot({ path: evidence("candidate"), fullPage: true });
    await page.getByRole("button", { name: "Confirm Telegram account" }).click();
    await expect(tg(page)).toHaveAttribute("aria-checked", "true");
    await patch(page, "Email", true);
    await region.scrollIntoViewIfNeeded();
    await page.screenshot({ path: evidence("connected"), fullPage: true });
    await row(page, { telegramStatus: "UNAVAILABLE", telegramEnabled: false, telegramError: "TELEGRAM_DELIVERY_UNAVAILABLE" });
    await refresh(page);
    await expect(page.getByText(/The bot cannot reach your Telegram account/)).toBeVisible();
    await expect(page.getByText("TELEGRAM_DELIVERY_UNAVAILABLE", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Disconnect Telegram" })).toBeVisible();
    await region.scrollIntoViewIfNeeded();
    await page.screenshot({ path: evidence("unavailable"), fullPage: true });
  });
}

for (const theme of ["light", "dark"] as const) {
  for (const state of ["loading", "read-error", "write-error"] as const) {
    test(`captures mobile ${theme} ${state} notification choices`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "mobile", "additional mobile state evidence");
      await page.addInitScript((theme) => window.localStorage.setItem("taska.theme", theme), theme);
      await signIn(page, { holdRead: state === "loading", failRead: state === "read-error" });
      const region = page.getByRole("region", { name: "Notifications" });
      if (state === "loading") {
        await expect(region.getByRole("status")).toHaveText("Loading notification choices");
      }
      if (state === "read-error") {
        await expect(region.getByText("Your notification choices could not be loaded.")).toBeVisible();
        const retry = (await region.getByRole("button", { name: "Try again" }).boundingBox())!;
        const notice = (await region.locator(".api-notice").boundingBox())!;
        expect(retry.height).toBeGreaterThanOrEqual(44);
        expect(retry.y).toBeGreaterThanOrEqual(notice.y + notice.height + 8);
      }
      if (state === "write-error") {
        await fixture(page, { failPatch: true });
        await email(page).click();
        await expect(
          region.getByText("Taska could not confirm the notification change. Check the current choices below."),
        ).toBeVisible();
        await expect(email(page)).toHaveAttribute("aria-checked", "true");
        await expect(email(page)).not.toHaveAttribute("aria-disabled");
      }
      if (state !== "loading") {
        const copy = (await region.getByRole("button", { name: "Copy request id fixture-request-id" }).boundingBox())!;
        expect(copy.height).toBeGreaterThanOrEqual(44);
      }
      await region.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `docs/ai/evidence/TAS-387/mobile-${theme}-${state}.png`, fullPage: true });
    });
  }
}
