import { expect, test, type Locator, type Page } from "@playwright/test";

// Reported from a narrow window: the board's top bar wraps below 820px, a
// wrapped flex line packs at flex-start, and the avatar stopped being the
// right-hand end of the bar. Its popover is anchored `right: 0` to that
// trigger, so 276px of panel then hung leftward from wherever the avatar
// landed and ran off the left edge of the screen — the part of it nobody could
// reach.
//
// Three panels share the assumption that their trigger is flush right, and all
// three are checked here at the widths where it stops being true: the profile
// menu (276), the notifications popover (312) and the global search dropdown
// (420). What is pinned is the invariant rather than the fix — a panel never
// crosses either edge of the viewport — so a future layout that moves a trigger
// again fails here rather than in someone's window.

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("anna@example.com");
  await page.getByLabel("Password").fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);
}

async function expectInsideViewport(page: Page, panel: Locator, what: string) {
  await expect(panel).toBeVisible();
  const box = await panel.boundingBox();
  const width = page.viewportSize()?.width ?? 0;
  if (!box) throw new Error(`${what} rendered with no box`);

  expect(box.x, `${what}: left edge at ${box.x.toFixed(1)}px, off the left of the screen`).toBeGreaterThanOrEqual(0);
  expect(
    box.x + box.width,
    `${what}: right edge at ${(box.x + box.width).toFixed(1)}px, past the ${width}px viewport`,
  ).toBeLessThanOrEqual(width + 1);
}

// 390 is phone portrait. 780 is the case the report came from: a desktop window
// narrowed just past the 820px breakpoint, where the bar wraps but nothing else
// about the screen says "phone".
const widths = [390, 780];
// Geometry does not depend on the palette, but the check was asked for in both
// and a token that only exists in one theme would show up here.
const themes = ["light", "dark"] as const;

test.describe("top bar popovers stay on screen when the bar wraps", () => {
  test("on the projects bar: the profile menu and the global search dropdown", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "laptop", "runs once; sets its own viewport widths regardless of project");

    await signIn(page);

    for (const theme of themes) {
      await page.evaluate((value) => window.localStorage.setItem("taska.theme", value), theme);
      await page.reload();
      await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

      for (const width of widths) {
        await page.setViewportSize({ width, height: 844 });

        const profileTrigger = page.getByRole("button", { name: /Open profile/ });
        await profileTrigger.click();
        await expectInsideViewport(page, page.getByRole("dialog", { name: "Current user profile" }), `profile popover, ${theme} ${width}px`);
        await page.keyboard.press("Escape");

        const field = page.getByRole("combobox", { name: /Search issues/ });
        await field.fill("board");
        await expectInsideViewport(page, page.locator(".global-search-pop"), `search dropdown, ${theme} ${width}px`);
        await field.press("Escape");
        await field.fill("");
      }
    }
  });

  test("on the board bar, which is the one that wraps: notifications and the profile menu", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "laptop", "runs once; sets its own viewport widths regardless of project");

    await signIn(page);
    await page.getByRole("button", { name: /Taska Platform/ }).click();
    await expect(page).toHaveURL(/\/projects\/[^/]+\/board$/);

    for (const theme of themes) {
      await page.evaluate((value) => window.localStorage.setItem("taska.theme", value), theme);
      await page.reload();
      await expect(page.locator(".counter")).toHaveText(/^\d+ of \d+$/);

      for (const width of widths) {
        await page.setViewportSize({ width, height: 844 });

        // The bar has wrapped at both of these widths, which is the premise of
        // the whole case: if it ever stops wrapping here, this spec is
        // measuring a layout the report was not about.
        const barHeight = (await page.locator(".board-topbar").boundingBox())?.height ?? 0;
        expect(barHeight, `${theme} ${width}px: the board bar did not wrap`).toBeGreaterThan(52);

        // Scoped to the bar: a seeded issue card is titled "Notifications inbox:
        // mark all as read", and it is a button too.
        await page.locator(".board-topbar").getByRole("button", { name: "Notifications" }).click();
        await expectInsideViewport(page, page.locator(".notifications-popover"), `notifications popover, ${theme} ${width}px`);
        await page.keyboard.press("Escape");
        await expect(page.locator(".notifications-popover")).toHaveCount(0);

        await page.getByRole("button", { name: /Open profile/ }).click();
        await expectInsideViewport(page, page.getByRole("dialog", { name: "Current user profile" }), `profile popover, ${theme} ${width}px`);
        await page.keyboard.press("Escape");
      }
    }
  });

  test("the avatar is the right-hand end of the bar on whichever row it lands", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "laptop", "runs once; sets its own viewport widths regardless of project");

    await signIn(page);
    await page.getByRole("button", { name: /Taska Platform/ }).click();
    await expect(page.locator(".counter")).toHaveText(/^\d+ of \d+$/);

    for (const width of [390, 780, 1200]) {
      await page.setViewportSize({ width, height: 844 });

      const bar = page.locator(".board-topbar");
      const barBox = await bar.boundingBox();
      const paddingRight = await bar.evaluate((element) => parseFloat(getComputedStyle(element).paddingRight));
      const avatarBox = await page.getByRole("button", { name: /Open profile/ }).boundingBox();
      if (!barBox || !avatarBox) throw new Error("bar or profile trigger rendered with no box");

      // Distance from the avatar's right edge to the bar's content-box right
      // edge — zero when it is genuinely flush right, whichever row the wrap
      // put it on. This is what the profile popover's `right: 0` depends on.
      const rightGap = barBox.x + barBox.width - paddingRight - (avatarBox.x + avatarBox.width);
      expect(Math.abs(rightGap), `${width}px: the avatar sits ${rightGap.toFixed(1)}px from the bar's content right edge`).toBeLessThanOrEqual(2);
    }
  });
});
