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

    // 460 and 459 straddle the height at which the panel's clamp starts taking
    // rows off the list: at 460 the eight-row page still fits exactly, at 459
    // it does not. §4.20 names 460, and nothing failed when it moved — a change
    // to the foot, to the clamp or to a border shifts it silently. Asserted
    // from both sides, the same shape as the row-height/page-size pair the case
    // above holds.
    for (const [width, height] of [[820, 420], [390, 420], [820, 459], [820, 460], [820, 900]] as const) {
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
          listClient: list.clientHeight,
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
      // The edge itself. `.global-search-list` caps at 352 — eight rows of the
      // 44 that §7's touch floor gives them — and the panel's clamp takes that
      // height back below 460.
      if (height === 460) {
        expect(measured.listClient, "460px tall: the eight-row page no longer fits exactly").toBe(352);
      }
      if (height === 459) {
        expect(measured.listClient, "459px tall: the clamp has stopped binding").toBeLessThan(352);
      }
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

  // A third way for something in the top bar to become unreachable, and the
  // one nobody had written: the indicator is on screen and still does not say
  // what it means. The search panel clips to a 13px radius and its rows are
  // square, so the panel's corner ate the top of the active row's selection
  // ring and the stroke stopped where the curve began. That ring is the whole
  // of the keyboard indicator here — `aria-activedescendant` moves no DOM
  // focus, so nothing in this widget is ever `:focus`ed — which is why a
  // cosmetic-looking break is the same class of defect as a clipped row.
  //
  // Measured as radius agreement rather than as painted pixels because that is
  // what actually binds: where the row's own corner describes the same arc as
  // the clip, `overflow: hidden` has nothing left to remove, at any zoom and
  // in any theme.
  test("the active row's selection ring closes where it meets the panel's corner", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "laptop", "runs once; sets its own viewport sizes regardless of project");

    await signIn(page);

    for (const theme of themes) {
      await page.evaluate((value) => window.localStorage.setItem("taska.theme", value), theme);
      await page.reload();
      await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
      // The panel opens under a stationary pointer and a row under it takes the
      // selection on `mouseenter`, so park the pointer before there is anything
      // to hover — otherwise the arrow keys start from wherever the mouse was
      // left rather than from nothing.
      await page.mouse.move(0, 0);

      for (const [width, height] of [[1440, 900], [390, 844]] as const) {
        await page.setViewportSize({ width, height });

        const field = page.getByRole("combobox", { name: /Search issues/ });
        // One hit, which is the arrangement the report came from and the worst
        // of them: the row is the first and the last of the list at once, so a
        // clipped corner is a quarter of the entire indicator.
        await field.fill("tas-104");
        await expect(page.getByRole("option")).toHaveCount(1);
        await field.press("ArrowDown");
        await expect(page.locator(".global-search-option.is-active")).toHaveCount(1);

        const where = `${theme} ${width}x${height}`;
        const geometry = await page.evaluate(() => {
          const pop = document.querySelector(".global-search-pop") as HTMLElement;
          const list = document.querySelector(".global-search-list") as HTMLElement;
          const rows = [...list.querySelectorAll<HTMLElement>(".global-search-option")];
          const popStyle = getComputedStyle(pop);
          const border = parseFloat(popStyle.borderTopWidth);
          const popBox = pop.getBoundingClientRect();
          // `overflow: hidden` clips to the padding box, so the arc the row has
          // to match is the panel's radius less its border.
          const clipRadius = parseFloat(popStyle.borderTopLeftRadius) - border;

          const corner = (row: HTMLElement, edge: "top" | "bottom") => {
            const style = getComputedStyle(row);
            const box = row.getBoundingClientRect();
            return {
              // Zero when the row's edge lies exactly on the clip's. This is
              // what makes the radius load-bearing instead of decorative: a row
              // that stood clear of the corner would not need one.
              offset: edge === "top" ? box.top - popBox.top - border : popBox.bottom - box.bottom - border,
              radii:
                edge === "top"
                  ? [parseFloat(style.borderTopLeftRadius), parseFloat(style.borderTopRightRadius)]
                  : [parseFloat(style.borderBottomLeftRadius), parseFloat(style.borderBottomRightRadius)],
            };
          };

          return {
            clipRadius,
            clips: popStyle.overflow,
            ring: getComputedStyle(rows[0]).boxShadow,
            active: rows[0].classList.contains("is-active"),
            // The list is only at the panel's edge some of the time: a failed
            // projects read puts a notice above it, and the "N matches" foot is
            // below it whenever there are rows. Each corner is checked when it
            // is the list's to answer for.
            top: pop.firstElementChild === list ? corner(rows[0], "top") : null,
            bottom: pop.lastElementChild === list ? corner(rows[rows.length - 1], "bottom") : null,
          };
        });

        // The premises. Without all three there is no ring to clip and this
        // case would pass by measuring nothing.
        expect(geometry.clips, `${where}: the panel no longer clips its contents`).toBe("hidden");
        expect(geometry.active, `${where}: ArrowDown did not select the only row`).toBe(true);
        expect(geometry.ring, `${where}: the active row carries no inset ring`).toContain("inset");
        expect(geometry.top, `${where}: the list is not the panel's first child, so this case measures nothing`).not.toBeNull();

        for (const [edge, corner] of [["top", geometry.top] as const, ["bottom", geometry.bottom] as const]) {
          if (!corner) continue;
          if (Math.abs(corner.offset) > 0.5) continue; // that corner belongs to something else
          for (const radius of corner.radii) {
            expect(
              radius,
              `${where}: the ${edge} row sits on the panel's corner with a ${radius}px radius against a ${geometry.clipRadius}px clip, so the ring is cut there`,
            ).toBeGreaterThanOrEqual(geometry.clipRadius - 0.5);
          }
        }

        await field.press("Escape");
        await field.fill("");
        // Long enough for the empty value to survive the 200ms debounce, so the
        // next viewport starts from no selection rather than continuing this
        // one's.
        await page.waitForTimeout(250);
      }
    }
  });

  // The half of the same defect that no radius can reach: below 820 and under
  // 460px of viewport height the list is shorter than its own page (§4.20), so
  // it scrolls — and `scrollIntoView` puts the row it lands on flush against
  // the scrollport's edge, which is the panel's corner arc. Rounding the first
  // row does not help there, because the row in the corner is whichever one the
  // scroll left there. `scroll-padding-top` keeps the selection clear of the
  // arc instead.
  test("a scrolled list never leaves the selected row inside the panel's corner", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "laptop", "runs once; sets its own viewport sizes regardless of project");

    await signIn(page);
    // 667x375 is phone landscape, which §4.20 names as sitting inside the band
    // where the panel's clamp takes rows off the list.
    await page.setViewportSize({ width: 667, height: 375 });
    await page.mouse.move(0, 0);

    const field = page.getByRole("combobox", { name: /Search issues/ });
    await field.fill("tas-");
    await expect(page.getByRole("option")).toHaveCount(8);
    await page.waitForTimeout(300);

    // Two full laps of the eight rows, because the first lap runs at
    // `scrollTop: 0` and only the second one scrolls.
    let scrolled = false;
    for (let step = 0; step < 16; step += 1) {
      await field.press("ArrowUp");
      await page.waitForTimeout(90);

      const measured = await page.evaluate(() => {
        const pop = document.querySelector(".global-search-pop") as HTMLElement;
        const list = document.querySelector(".global-search-list") as HTMLElement;
        const active = document.querySelector(".global-search-option.is-active") as HTMLElement;
        const popStyle = getComputedStyle(pop);
        return {
          index: [...list.children].indexOf(active),
          fromListTop: active.getBoundingClientRect().top - list.getBoundingClientRect().top,
          rowRadius: parseFloat(getComputedStyle(active).borderTopLeftRadius),
          clipRadius: parseFloat(popStyle.borderTopLeftRadius) - parseFloat(popStyle.borderTopWidth),
          scrollTop: list.scrollTop,
          overflows: list.scrollHeight > list.clientHeight,
        };
      });

      // The premise: if the list ever stops being squeezed here, this case is
      // measuring a list that cannot scroll and proves nothing.
      expect(measured.overflows, "667x375: the list is not short enough to scroll").toBe(true);
      if (measured.scrollTop > 0) scrolled = true;

      const clear = measured.fromListTop >= measured.clipRadius - 0.5 || measured.rowRadius >= measured.clipRadius - 0.5;
      expect(
        clear,
        `667x375: row ${measured.index} sits ${measured.fromListTop.toFixed(1)}px below the list top with a ${measured.rowRadius}px radius, inside the panel's ${measured.clipRadius}px corner`,
      ).toBe(true);
    }
    expect(scrolled, "667x375: the walk never scrolled the list, so the scrolled corner was never reached").toBe(true);
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

  // The other way a panel becomes wrong without ever crossing an edge: it stops
  // belonging to the control that opened it. TAS-179 kept the notifications
  // popover on screen below 820 by re-anchoring it from the bell to the whole
  // bar — and that bar wraps at exactly those widths, so the panel dropped
  // below both of its rows and read as belonging to the search field under the
  // bell rather than to the bell itself.
  //
  // What is pinned here is the anchor, in the two ways it can be lost: the
  // panel's top stays just under the bell's bottom rather than under the bar,
  // and its right edge stays the bell's right edge rather than some other
  // control's. The width may shrink to keep both — on a phone it does — and
  // that is why the edge check runs alongside rather than instead.
  test("the notifications panel hangs from the bell at every width, not from the bar", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "laptop", "runs once; sets its own viewport widths regardless of project");

    await signIn(page);
    await page.getByRole("button", { name: /Taska Platform/ }).click();
    await expect(page).toHaveURL(/\/projects\/[^/]+\/board$/);

    for (const theme of themes) {
      await page.evaluate((value) => window.localStorage.setItem("taska.theme", value), theme);
      await page.reload();
      await expect(page.locator(".counter")).toHaveText(/^\d+ of \d+$/);

      // 1440 is the shape the wrapped widths have to match; 780 is the window
      // the original report came from; 390 is the width where the bell's right
      // edge is 208.5 and the panel has to narrow to stay anchored.
      for (const width of [1440, 820, 780, 390]) {
        await page.setViewportSize({ width, height: 844 });

        const bell = page.locator(".board-topbar").getByRole("button", { name: "Notifications" });
        await bell.click();
        // Past the 160ms entrance: `tk-pop` starts 7px low and mid-animation is
        // not where the panel settles.
        await page.waitForTimeout(300);

        const where = `notifications panel, ${theme} ${width}px`;
        await expectInsideViewport(page, page.locator(".notifications-popover"), where);

        const measured = await page.evaluate(() => {
          const pop = document.querySelector(".notifications-popover") as HTMLElement;
          const trigger = document.querySelector(".notification-wrap button") as HTMLElement;
          const bar = document.querySelector(".board-topbar") as HTMLElement;
          const maxHeight = parseFloat(getComputedStyle(pop).maxHeight);
          return {
            pop: pop.getBoundingClientRect().toJSON(),
            bell: trigger.getBoundingClientRect().toJSON(),
            barBottom: bar.getBoundingClientRect().bottom,
            barHeight: bar.getBoundingClientRect().height,
            // NaN when the computed value is `none`, which is how a deleted
            // clamp shows up here rather than as a quietly taller panel.
            maxHeight,
            viewport: window.innerHeight,
          };
        });

        // §4.12's own offset: `top: 38` under a 32px trigger is 6 below it.
        const gap = measured.pop.y - measured.bell.bottom;
        expect(gap, `${where}: the panel's top is ${gap.toFixed(1)}px below the bell, not the 6 §4.12 asks for`).toBeGreaterThanOrEqual(0);
        expect(gap, `${where}: the panel's top is ${gap.toFixed(1)}px below the bell`).toBeLessThanOrEqual(8);
        // The same fact said the way the report said it. Below 820 the bar is
        // two or three rows tall, so a panel anchored to the bar clears its
        // bottom and one anchored to the bell does not.
        expect(
          measured.pop.y,
          `${where}: the panel starts at ${measured.pop.y.toFixed(1)}, below a ${measured.barHeight.toFixed(1)}px bar rather than under the bell`,
        ).toBeLessThan(measured.barBottom);
        // The horizontal half of the anchor. Losing this is how the panel came
        // to belong to the bar in the first place.
        const rightGap = measured.pop.x + measured.pop.width - measured.bell.right;
        expect(
          Math.abs(rightGap),
          `${where}: the panel's right edge is ${rightGap.toFixed(1)}px from the bell's, so it is anchored to something else`,
        ).toBeLessThanOrEqual(1);
        // The bar wraps at both narrow widths, which is the premise of the
        // whole case: if it ever stops, this is measuring a layout the report
        // was not about.
        if (width <= 820) {
          expect(measured.barHeight, `${where}: the board bar did not wrap`).toBeGreaterThan(52);
          // TAS-179's vertical clamp, kept and re-expressed against the bell.
          // Stated as its consequence rather than its formula: however tall the
          // inbox grows, the panel cannot reach the fold. Above 820 nothing
          // clamps and a short desktop window still overflows — pre-existing,
          // recorded in the backlog, and untouched here.
          expect(measured.maxHeight, `${where}: the panel carries no height clamp at all`).toBeGreaterThan(0);
          expect(
            measured.pop.y + measured.maxHeight,
            `${where}: a full inbox would reach ${(measured.pop.y + measured.maxHeight).toFixed(1)} against a ${measured.viewport}px viewport`,
          ).toBeLessThanOrEqual(measured.viewport);
        }

        await page.keyboard.press("Escape");
        await expect(page.locator(".notifications-popover")).toHaveCount(0);
      }
    }
  });
});
