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

// Renamed from "stay on screen when the bar wraps": three of these are about a
// panel crossing an edge of the viewport, and one is about a panel clipping its
// own contents against a cap of its own. What they have in common is narrower
// than the bar wrapping and wider than staying on screen — every one of them is
// a way for something in the top bar to become unreachable at a narrow or short
// viewport, with `body { overflow: hidden }` and no gesture that recovers it.
test.describe("the top bar's panels stay reachable at narrow and short viewports", () => {
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

  // The list caps at a page of hits, and the rows grow to §7's touch floor
  // below 820 — two numbers set in different rules that have to agree, and did
  // not: at 44px rows the page of eight measured 352 against a 340 cap, so the
  // last row was clipped by 12px with no way to reach it. Nothing scrolls it
  // into view, because `aria-activedescendant` moves no DOM focus and there is
  // no `scrollIntoView` anywhere in `src/` — and one ArrowUp from the
  // unselected state wraps straight onto that row.
  test("a full page of results is never clipped by the list's own cap", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "laptop", "runs once; sets its own viewport widths regardless of project");

    await signIn(page);

    for (const width of [390, 820, 1440]) {
      await page.setViewportSize({ width, height: 900 });

      const field = page.getByRole("combobox", { name: /Search issues/ });
      await field.fill("tas-");
      // Ten seeded issues carry this in their key and a page is eight, so this
      // fills the page — which is the whole premise: a query returning fewer
      // than eight cannot reach the cap and would pass this test against a
      // clipped list. "board", the obvious choice, returns five and did.
      //
      // Waiting on the count rather than on the listbox: for the 200ms the
      // field is debounced the query key has not changed yet, so the previous
      // answer is legitimately still on screen and a listbox assertion passes
      // against it.
      await expect(page.getByRole("option")).toHaveCount(8);

      const measured = await page.evaluate(() => {
        const list = document.querySelector(".global-search-list") as HTMLElement;
        const options = [...list.querySelectorAll(".global-search-option")];
        const last = options[options.length - 1].getBoundingClientRect();
        return {
          clientHeight: list.clientHeight,
          scrollHeight: list.scrollHeight,
          rowHeight: options[0].getBoundingClientRect().height,
          clippedBy: last.bottom - list.getBoundingClientRect().bottom,
        };
      });

      expect(
        measured.scrollHeight,
        `${width}px: ${measured.rowHeight}px rows overflow the list by ${measured.scrollHeight - measured.clientHeight}px`,
      ).toBeLessThanOrEqual(measured.clientHeight);
      expect(measured.clippedBy, `${width}px: the last option is clipped by ${measured.clippedBy}px`).toBeLessThanOrEqual(0);
      // Guards the guard: if the rows ever stop meeting §7's touch floor the
      // assertion above goes quiet by getting easier.
      if (width <= 820) expect(measured.rowHeight, `${width}px: rows are under §7's 44`).toBeGreaterThanOrEqual(44);

      await field.press("Escape");
      await field.fill("");
    }
  });

  // The other half of the same invariant, and the half nobody had written: the
  // width clamp keeps a panel inside the left and right edges, and nothing kept
  // it inside the bottom one. At 820x420 the search panel ran to 448.7 against
  // a 420 viewport — the last row and the foot below the fold, unreachable,
  // because the shell clips its own overflow and this panel is not in the
  // scrolling region.
  test("a panel never crosses the bottom edge of a short viewport either", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "laptop", "runs once; sets its own viewport sizes regardless of project");

    await signIn(page);

    for (const [width, height] of [[820, 420], [390, 420], [820, 900]] as const) {
      await page.setViewportSize({ width, height });

      const field = page.getByRole("combobox", { name: /Search issues/ });
      await field.fill("tas-");
      await expect(page.getByRole("option")).toHaveCount(8);
      // Past the 160ms entrance: `tk-pop` starts 7px low, and a box measured
      // mid-animation is not the box the layout settles at.
      await page.waitForTimeout(300);

      // The selection, not just the box. This assertion is here because its
      // absence is what let the previous round go green: the panel was inside
      // the viewport and the foot was visible at exactly these sizes, while the
      // row ArrowUp lands on hung out of the squeezed list with nothing to
      // scroll it — a clamp on the panel had taken height off the list without
      // the page size that the list's cap came from following it.
      await field.press("ArrowUp");
      await page.waitForTimeout(120);

      const measured = await page.evaluate(() => {
        const pop = document.querySelector(".global-search-pop") as HTMLElement;
        const foot = document.querySelector(".global-search-foot") as HTMLElement;
        const list = document.querySelector(".global-search-list") as HTMLElement;
        const active = document.querySelector(".global-search-option.is-active") as HTMLElement;
        const box = pop.getBoundingClientRect();
        const listBox = list.getBoundingClientRect();
        const rowBox = active.getBoundingClientRect();
        return {
          bottom: box.bottom,
          viewport: window.innerHeight,
          // The foot carries "showing N of M" and is the line a squeezed panel
          // would clip first; the rows can be scrolled, it cannot.
          footBottom: foot.getBoundingClientRect().bottom,
          activeIndex: [...list.children].indexOf(active),
          // 1 when the whole row is inside the list, less when any of it is not.
          visibleFraction:
            (Math.min(rowBox.bottom, listBox.bottom) - Math.max(rowBox.top, listBox.top)) / rowBox.height,
        };
      });

      expect(
        measured.bottom,
        `${width}x${height}: the panel runs ${(measured.bottom - measured.viewport).toFixed(1)}px past the bottom of the screen`,
      ).toBeLessThanOrEqual(measured.viewport);
      expect(measured.footBottom, `${width}x${height}: the panel's foot is below the fold`).toBeLessThanOrEqual(measured.viewport);
      // Guards the guard: one ArrowUp from the unselected state wraps to the
      // last option, which is the one a squeezed list hides. If it ever stops
      // landing there, this stops testing the case it was written for.
      expect(measured.activeIndex, `${width}x${height}: ArrowUp did not wrap to the last option`).toBe(7);
      expect(
        measured.visibleFraction,
        `${width}x${height}: only ${(measured.visibleFraction * 100).toFixed(0)}% of the selected row is inside the list, and nothing can scroll to the rest`,
      ).toBeCloseTo(1, 2);

      await field.press("Escape");
      await field.fill("");
      // Long enough for the empty value to survive the 200ms debounce. Without
      // the wait the query key never changes, so the selection is never reset
      // and the next viewport's ArrowUp continues the walk from 7 to 6 instead
      // of wrapping — which is what the assertion above caught on its first
      // run, doing exactly the job it was added for.
      await page.waitForTimeout(250);
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
