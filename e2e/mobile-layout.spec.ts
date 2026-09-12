import { expect, test, type Page } from "@playwright/test";

// Two phone-portrait regressions reported from an iPhone 17 Pro Max, pinned
// here because both are layout facts a unit test cannot see: they need a real
// box tree at a real width.
//
// Mock-backed like every spec here (playwright.config.ts starts the server with
// VITE_TASKA_API_MODE=mock): any seeded user signs in with any password, Anna
// is a member of three of the seed's four projects, and the Taska Platform
// board answers with a count.

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("anna@example.com");
  await page.getByLabel("Password").fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);
}

// Phone portrait only. Neither failure reaches this suite's other two
// viewports — the filter bar fits on one row from 883px up with "Clear"
// showing (791px without), and 1440 and 1920 are both well past that — so
// running these there would pin a different set of numbers under the same
// name and say nothing about the report.
test.describe("phone portrait", () => {
  test.skip(({ isMobile }) => !isMobile, "phone-portrait layout only");

  test("the board's issue counter stays on one line", async ({ page }) => {
    await signIn(page);
    // Addressed by class, not by role and name: since TAS-148 an ADMIN's card
    // carries an "Edit <name>" button of its own, and a loose match on the
    // project's name finds both.
    await page.locator(".project-card", { hasText: "Taska Platform" }).click();
    await expect(page).toHaveURL(/\/projects\/[^/]+\/board$/);

    const counter = page.locator(".counter");
    // Read it only once the issues query has answered: while it is pending the
    // counter is two skeletons and the word "of", which has no digits to match.
    await expect(counter).toHaveText(/^\d+ of \d+$/);

    // The regression: as a shrinkable flex item in an overflowing bar the
    // counter collapsed to the width of "of" and stacked into three lines,
    // ~50px tall. One line of 11.5px text is ~17px.
    const box = await counter.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.height).toBeLessThan(20);

    // Off the right edge is the same complaint in a different place, so the
    // count has to be readable without scrolling the bar sideways.
    const bar = page.locator(".filterbar");
    const overflow = await bar.evaluate((element) => element.scrollWidth - element.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await expect(counter).toBeInViewport();

    // The bar wraps rather than scrolls, and the columns area still gets the
    // larger share of the shell below the top bar. `columnsHeight >
    // barHeight` used to stand for that and pinned nothing: measured, 594 >
    // 110 leaves so much slack that a bar wrapping into twice as many rows,
    // or a columns area losing half its own height, would both still pass.
    // The two numbers do not move in lockstep, so comparing the columns area
    // against the whole shell is the version that actually catches a bar
    // that has grown to eat the board: whatever the top bar and filter bar
    // wrap into, the columns area is guaranteed at least half of it.
    const shellHeight = (await page.locator(".board-shell").boundingBox())?.height ?? 0;
    const columnsHeight = (await page.locator(".columns-area").boundingBox())?.height ?? 0;
    expect(columnsHeight).toBeGreaterThanOrEqual(shellHeight * 0.5);
  });

  test("the last project card can be scrolled fully into view", async ({ page }) => {
    // Deliberately shorter than the project's 844: three cards fit there
    // without scrolling, and a list that never scrolls proves nothing about a
    // list that can be scrolled to its end. 500 is also the shape of what was
    // reported — a visible area smaller than the shell believes it has, because
    // iOS keeps its toolbars inside `100vh`.
    await page.setViewportSize({ width: 390, height: 500 });
    await signIn(page);

    // Anna is a member of three of the seed's four projects, and the count has
    // to be taken after the skeletons clear: `.project-card` is also the
    // loading placeholder's class, and four of those match a wait for four.
    await expect(page.locator(".skeleton-card")).toHaveCount(0);
    const cards = page.locator(".project-card");
    await expect(cards).toHaveCount(3);

    // The invariant `dvh` restores and `vh` broke: the shell is never taller
    // than the area the reader can see. A taller one clips its own overflow and
    // the foot of the scroller inside it becomes unreachable.
    //
    // Read this for what it is. Headless Chromium has no retractable toolbars,
    // so `100vh` and `100dvh` are the same number here and this cannot fail on
    // the unit alone — the iOS half of the bug is only provable on a real
    // device. What it does hold shut is the composition the fix depends on:
    // one shell no taller than the visible area, one scroll region inside it,
    // and a last card reachable at the end of that region.
    const shell = await page.locator(".page-shell").boundingBox();
    const innerHeight = await page.evaluate(() => window.innerHeight);
    expect(shell?.height).toBeLessThanOrEqual(innerHeight);

    const scroller = page.locator(".projects-page");
    const scrolled = await scroller.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      return element.scrollTop > 0;
    });
    // Guards the guard: if the list ever stops overflowing at this height the
    // assertions below go quiet without saying so.
    expect(scrolled).toBe(true);

    const last = cards.last();
    const box = await last.boundingBox();
    expect(box).not.toBeNull();
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(innerHeight);
    await expect(last).toBeInViewport({ ratio: 1 });
  });
});

// 821-882px is not a phone width — it is the band between the old 820px
// breakpoint that used to hide `.topbar-spacer` and the point the filtered
// bar stops fitting on one row (883px with "Clear" showing, measured on
// `.filterbar` in styles.css). The unfiltered bar never wraps above 820, so
// this band only ever shows up with a filter active. Nothing in the "phone
// portrait" describe above can see it: that block only runs on the "mobile"
// project, whose viewport is 390px wide. This describe runs on one non-mobile
// project instead and sets its own viewport widths, the mirror image of how
// the block above picks its one project.
test.describe("filter bar wrap band, 821-882px", () => {
  async function measureBar(page: Page) {
    const bar = page.locator(".filterbar");
    const counter = page.locator(".counter");

    const overflow = await bar.evaluate((element) => element.scrollWidth - element.clientWidth);
    const paddingRight = await bar.evaluate((element) => parseFloat(getComputedStyle(element).paddingRight));

    const barBox = await bar.boundingBox();
    const counterBox = await counter.boundingBox();
    if (!barBox || !counterBox) throw new Error("filterbar or counter rendered with no box");

    return {
      height: barBox.height,
      overflow,
      // Distance from the counter's own right edge to the bar's content-box
      // right edge (the border-box edge minus the bar's own padding) — zero
      // when the counter is genuinely flush right, whichever row it landed on.
      rightGap: barBox.x + barBox.width - paddingRight - (counterBox.x + counterBox.width),
    };
  }

  test("the counter stays flush right and the bar never scrolls sideways, 830-940px, filtered or not", async (
    { page },
    testInfo,
  ) => {
    // Dynamic rather than a describe-level `test.skip`, because Playwright's
    // condition callback only receives fixtures, not `testInfo` — the project
    // name is only reachable from inside a running test. "laptop" is an
    // arbitrary pick between the two non-mobile projects: the point is
    // running once, not running on a laptop specifically, the same way
    // "mobile" in the describe above is not a claim the other bug is
    // phone-specific.
    test.skip(testInfo.project.name !== "laptop", "runs once; sets its own viewport widths regardless of project");

    await signIn(page);
    await page.locator(".project-card", { hasText: "Taska Platform" }).click();
    await expect(page).toHaveURL(/\/projects\/[^/]+\/board$/);
    await expect(page.locator(".counter")).toHaveText(/^\d+ of \d+$/);

    const typeAll = page.locator(".filterbar .segmented button", { hasText: "All" });
    const typeBug = page.locator(".filterbar .segmented button", { hasText: "Bug" });
    const clearButton = page.getByRole("button", { name: /Clear/ });

    for (const width of [830, 880, 940]) {
      await page.setViewportSize({ width, height: 900 });

      const unfiltered = await measureBar(page);
      expect(
        unfiltered.overflow,
        `${width}px unfiltered: bar overflows horizontally by ${unfiltered.overflow}px`,
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(unfiltered.rightGap),
        `${width}px unfiltered: counter sits ${unfiltered.rightGap.toFixed(1)}px from the bar's content right edge`,
      ).toBeLessThanOrEqual(20);

      // Filtering by type is local (DESIGN.md §5.4), but the click still goes
      // through a render; the "Clear" button mounting is the honest signal
      // that `hasFilters` flipped and the bar has re-laid-out around it.
      await typeBug.click();
      await expect(clearButton).toBeVisible();

      const filtered = await measureBar(page);
      expect(
        filtered.overflow,
        `${width}px filtered: bar overflows horizontally by ${filtered.overflow}px`,
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(filtered.rightGap),
        `${width}px filtered: counter sits ${filtered.rightGap.toFixed(1)}px from the bar's content right edge`,
      ).toBeLessThanOrEqual(20);

      // 940 is comfortably past both wrap points (791 / 883), filtered and
      // not, so §2.7's 46 is a hard floor here rather than a "some row wraps
      // and it grows" case.
      if (width === 940) {
        expect(unfiltered.height, "940px unfiltered: the bar is not one row of §2.7's floor").toBe(46);
        expect(filtered.height, "940px filtered: the bar is not one row of §2.7's floor").toBe(46);
      }

      await typeAll.click();
      await expect(clearButton).toHaveCount(0);
    }
  });
});
