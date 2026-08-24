import { expect, test, type Page } from "@playwright/test";

// Clicking a notification rendered the not-found screen for every notification
// the deployed gateway actually sends (TAS-183). The mock used to seed frontend
// routes, so the whole defect lived in the gap between what the mock sent and
// what the gateway sends; the seed now carries the gateway's own shapes, which
// is what makes this spec able to fail.
//
// The three cases are unit-tested (src/domain/notifications.test.ts,
// src/screens/BoardScreen.test.tsx). This is the one thing neither can see: a
// real router deciding whether the destination is a screen or a 404 — and,
// since TAS-185 put the same bell in the shared bar, deciding it from a screen
// that has no project of its own.

async function signIn(page: Page, email = "anna@example.com") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);
}

// `exact` matters: the seeded board has an issue card whose summary mentions
// notifications, and the default substring match picks it up as well.
async function openBell(page: Page) {
  await page.getByRole("button", { name: "Notifications", exact: true }).click();
  await expect(page.locator(".notifications-popover")).toBeVisible();
}

async function openNotifications(page: Page) {
  await signIn(page);
  await page.getByRole("button", { name: /Taska Platform/ }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/board$/);

  await openBell(page);
}

test("a notification opens the issue it is about, not the not found screen", async ({ page }) => {
  await openNotifications(page);

  // The seed's first row: the gateway's own `/issues/{uuid}` path, which is not
  // a route this app has and used to be navigated to verbatim.
  await page.locator(".notification-item").first().click();

  await expect(page).toHaveURL(/\/projects\/[^/]+\/issues\/[^/]+$/);
  await expect(page.getByText("TAS-107", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /not found/i })).toHaveCount(0);
});

test("a notification whose id is only in its body opens the same way", async ({ page }) => {
  await openNotifications(page);

  await page.locator(".notification-item").nth(1).click();

  await expect(page).toHaveURL(/\/projects\/[^/]+\/issues\/[^/]+$/);
  await expect(page.getByText("TAS-101", { exact: true })).toBeVisible();
});

test("a notification with nothing behind it marks read and leaves the reader where they were", async ({ page }) => {
  await openNotifications(page);

  const board = page.url();
  const row = page.locator(".notification-item").nth(2);
  await expect(row).toHaveClass(/is-inert/);
  // `cursor: default` is the whole of what the class does, and there is no
  // cursor at 390 or on the keyboard path, so the row has to say it in words.
  await expect(row).toContainText("Nothing to open");
  await expect(page.locator(".notification-item", { hasText: "Nothing to open" })).toHaveCount(1);
  await row.click();

  // Still on the board, and the panel is still open — a row that goes nowhere
  // is not a row that closes the panel behind a reader who wanted to read on.
  await expect(page.locator(".notifications-popover")).toBeVisible();
  expect(page.url()).toBe(board);
});

// The same three rows from the two screens that have no `projectId` at all
// (TAS-185). The inbox is the user's — `GET /api/v1/notifications` takes no
// project — so the bell hangs in the shared bar as well, and the destination
// has to be built without anything the screen around it knows. It is:
// `notificationTarget` returns either an absolute `/projects/…` route or an
// issue id, and the issue id is resolved by reading the issue's own
// `projectId`. This is the pin on that, from a router rather than from a unit
// test, because "there is no project in scope" is exactly the kind of thing a
// component test supplies by accident.
test("a notification opens its issue from /projects, where no project is open", async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

  await openBell(page);
  // The seed's first row: an id in the gateway's own `/issues/{uuid}` path and
  // nothing else, so the project can only come from reading the issue.
  await page.locator(".notification-item").first().click();

  await expect(page).toHaveURL(/\/projects\/[^/]+\/issues\/[^/]+$/);
  // The slide-over rather than the key on its own: arriving here from
  // `/projects` mounts the board under the panel, so the key is on the card
  // behind it as well and `getByText` matches both.
  await expect(page.getByLabel("TAS-107 issue")).toBeVisible();
  await expect(page.getByRole("heading", { name: /not found/i })).toHaveCount(0);
});

test("a notification opens its issue from /admin, which is not even a project screen", async ({ page }) => {
  // Mark is the seed's only GLOBAL_ADMIN, and a member of TAS — so the issue
  // this opens is one he may read, and a refusal here would be about the
  // notification rather than about the account.
  await signIn(page, "mark@example.com");
  await page.goto("/admin/data");
  await expect(page.getByRole("heading", { level: 1, name: "Data" })).toBeVisible();

  await openBell(page);
  await page.locator(".notification-item").nth(1).click();

  // The body-UUID row this time, so both resolutions are covered away from the
  // board: link-shaped on /projects above, prose-shaped here.
  await expect(page).toHaveURL(/\/projects\/[^/]+\/issues\/[^/]+$/);
  await expect(page.getByLabel("TAS-101 issue")).toBeVisible();
});

// The third branch, and the one the extraction could plausibly have broken
// without any of the above noticing: `kind: "route"` navigates to the link
// verbatim instead of reading anything. It is safe only because the link is an
// absolute `/projects/…` path — a relative one would resolve against whatever
// screen the bell was opened from, which used to be a board and now can be
// `/projects`. The seed carries the gateway's own shapes and none of them is
// this one, so the notification is made the way the product makes it: creating
// an issue seeds an ISSUE_CREATED notification carrying a real route.
test("a notification that already carries a route opens from /projects too", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: /Taska Platform/ }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/board$/);

  await page.getByRole("button", { name: "New" }).click();
  const dialog = page.getByRole("dialog", { name: "New issue" });
  await dialog.getByLabel("Summary").fill("Rotate the gateway signing key");
  await dialog.getByRole("button", { name: "Create issue" }).click();
  await expect(page).toHaveURL(/\/issues\//);

  // Out of the project entirely, which is the whole point: the route in the
  // link has to survive being followed from a screen that has no project. In
  // the app rather than through `page.goto`: the mock's store is a module in
  // this page, so a reload would re-seed it and take the notification that was
  // just made with it.
  // Exact, or the panel's backdrop ("Close issue") matches too.
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Back to projects" }).click();
  await expect(page).toHaveURL(/\/projects$/);

  await openBell(page);
  const row = page.locator(".notification-item").first();
  await expect(row).toContainText("Issue created");
  await row.click();

  await expect(page).toHaveURL(/\/projects\/[^/]+\/issues\/[^/]+$/);
  await expect(page.locator(".issue-panel")).toContainText("Rotate the gateway signing key");
  await expect(page.getByRole("heading", { name: /not found/i })).toHaveCount(0);
});

// The panel says an inert row "keeps its focus ring", and until TAS-185 nothing
// in the stylesheet drew one — the rows fell through to Chrome's `outline: auto`,
// which is 1px, unoffset, and derived from the *operating system's* accent
// colour rather than from §2. The rule that fixed it had to be drawn inward:
// these rows are full-bleed inside a panel that clips to a 13px radius, so an
// outward offset lost 4px from the left, 4 from the right and 4 from the bottom
// of the last row, leaving one edge as the whole indicator.
//
// "Mark all read" is walked too, and it is the reason this says "everything the
// keyboard reaches" rather than "every row": it is the panel's *first* Tab stop,
// so a rule that closed the bar and left it on the UA outline would have moved
// the inconsistency into the popover rather than ended it. Its geometry is the
// opposite of the rows' — inset by the header's padding, and the only ring here
// with a corner in a quadrant the panel rounds — so the two offsets are checked
// by the same measurement rather than by two rules of thumb.
//
// Pinned as "the ring is inside the panel", which is what a reader can see,
// rather than as the offset that currently achieves it.
test("everything the keyboard reaches in the panel carries a ring the panel does not clip", async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

  // From the keyboard throughout: `:focus-visible` is the only thing under test
  // and a click is exactly the interaction that does not match it.
  await page.getByRole("button", { name: "Notifications", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".notifications-popover")).toBeVisible();

  // The panel paints before its own read lands, so the rows arrive a tick after
  // it is visible. Waiting on them rather than on the panel, or the walk below
  // tabs straight past an empty list and out of the popover.
  await expect(page.locator(".notification-item").first()).toBeVisible();
  const rows = await page.locator(".notification-item").count();
  expect(rows, "the seed stopped providing rows to walk").toBeGreaterThan(0);

  // One for the header's action, then one per row.
  for (let index = 0; index < rows + 1; index += 1) {
    await page.keyboard.press("Tab");
    const measured = await page.evaluate(() => {
      const pop = document.querySelector(".notifications-popover") as HTMLElement;
      const el = document.activeElement as HTMLElement;
      if (!pop.contains(el)) return null;
      const style = getComputedStyle(el);
      const panel = getComputedStyle(pop);
      const spread = parseFloat(style.outlineOffset) + parseFloat(style.outlineWidth);
      const b = el.getBoundingClientRect();
      const p = pop.getBoundingClientRect();
      const border = parseFloat(panel.borderTopWidth);
      // The clip is a *rounded* rect, so the radius is the panel's own less its
      // border — the inner curve `overflow: hidden` actually cuts on.
      const radius = parseFloat(panel.borderTopLeftRadius) - border;
      const box = { left: b.left - spread, right: b.right + spread, top: b.top - spread, bottom: b.bottom + spread };
      const content = { left: p.left + border, right: p.right - border, top: p.top + border, bottom: p.bottom - border };

      // Any corner of the ring that lands inside one of the panel's four corner
      // quadrants is held against the arc rather than against the box: a point
      // can be inside the content rectangle and still outside the rounded clip.
      //
      // Two ways to be clear of it, and the second is the one this panel uses —
      // the same pair `topbar-popovers.spec.ts` holds the search panel to.
      // Either the corner sits inside the arc, which is how a control inset by
      // its container's padding clears it ("Mark all read"); or the element's
      // own corner *describes* the arc, which is how a full-bleed row clears it,
      // and then there is nothing for `overflow: hidden` to remove at any zoom
      // or in any theme. Measured as radius agreement rather than as painted
      // pixels, because a ring that follows a curve has no rectangular corner
      // to measure — which is exactly what the first version of this assertion
      // got wrong, reporting 4.97px of overshoot at a corner the ring had
      // already stopped having.
      const corners = ["borderTopLeftRadius", "borderTopRightRadius", "borderBottomLeftRadius", "borderBottomRightRadius"] as const;
      let worst = 0;
      [
        [content.left + radius, content.top + radius, -1, -1],
        [content.right - radius, content.top + radius, 1, -1],
        [content.left + radius, content.bottom - radius, -1, 1],
        [content.right - radius, content.bottom - radius, 1, 1],
      ].forEach(([cx, cy, xs, ys], index) => {
        const x = xs < 0 ? box.left : box.right;
        const y = ys < 0 ? box.top : box.bottom;
        if ((x - cx) * xs <= 0 || (y - cy) * ys <= 0) return;
        if (parseFloat(style[corners[index]]) >= radius - 0.5) return;
        worst = Math.max(worst, Math.hypot(x - cx, y - cy) - radius);
      });

      return {
        what: el.className || el.textContent?.trim().slice(0, 20) || el.tagName,
        style: style.outlineStyle,
        offset: style.outlineOffset,
        // How far the ring's outermost edge falls outside the panel's content
        // box on each side. Positive is clipped.
        left: content.left - box.left,
        right: box.right - content.right,
        top: content.top - box.top,
        bottom: box.bottom - content.bottom,
        pastArc: worst,
      };
    });
    if (!measured) throw new Error(`Tab ${index} left the panel before the walk finished`);

    const where = `stop ${index} (${measured.what})`;
    expect(measured.style, `${where}: draws no focus outline at all`).not.toBe("none");
    // The accent, not the operating system's. `outline: auto` computes to the
    // `auto` style and to a colour Chrome takes from System Settings, so this
    // catches the fall-through however that colour happens to be set today.
    expect(measured.style, `${where}: falls through to the browser's own outline`).toBe("solid");
    for (const [side, over] of [
      ["left", measured.left],
      ["right", measured.right],
      ["top", measured.top],
      ["bottom", measured.bottom],
    ] as const) {
      expect(over, `${where}: the ring's ${side} edge is ${over.toFixed(1)}px outside the panel, where the clip removes it`).toBeLessThanOrEqual(0.5);
    }
    expect(
      measured.pastArc,
      `${where}: a corner of the ring is ${measured.pastArc.toFixed(1)}px past the arc the panel's radius cuts, and the element's own corner does not describe that arc, so the clip takes it`,
    ).toBeLessThanOrEqual(0.5);
  }
});
