import { expect, test, type Page } from "@playwright/test";

// A notification states the issue it is about (TAS-243): `issueId` and
// `projectId` are on the wire, the route is built from them, and nothing is
// read between the press and the destination. The seed carries one row per
// shape the gateway sends — two that open an issue, and four that open
// nothing for the four reasons a row can: not about an issue, about a
// deleted one, older than the ids, and — until TAS-245 — an attachment
// notification, which carries issueId alone because issue-service's
// PayloadSerializer never backfills issueKey or projectId for it.
//
// Which rows get a route is unit-tested (src/domain/notifications.test.ts), and
// so are the optimistic writes (src/screens/BoardScreen.test.tsx). This is what
// neither can see: a real router deciding whether the destination is a screen
// or a 404 — from the board, and from the two screens that have no project of
// their own since TAS-185 put the same bell in the shared bar.

async function signIn(page: Page, email = "anna@example.com") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);
}

// Anchored at both ends: the seeded board has an issue card whose summary
// begins "Notifications inbox", and the name now carries the unread count.
const BELL = { name: /^Notifications(, \d+ unread)?$/ };

async function openBell(page: Page) {
  await page.getByRole("button", BELL).click();
  await expect(page.locator(".notifications-popover")).toBeVisible();
}

async function openNotifications(page: Page) {
  await signIn(page);
  // Addressed by class, not by role and name: since TAS-148 an ADMIN's card
  // carries an "Edit <name>" button of its own, and a loose match on the
  // project's name finds both.
  await page.locator(".project-card", { hasText: "Taska Platform" }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/board$/);

  await openBell(page);
}

// A pathname, for the one check that reads `location` itself; `toHaveURL`
// matches the whole URL, origin included, so it takes the unanchored form.
const ISSUE_PATH = /^\/projects\/[^/]+\/issues\/[^/]+$/;
const ISSUE_URL = /\/projects\/[^/]+\/issues\/[^/]+$/;

test("a notification opens the issue it names, in the same click", async ({ page }) => {
  await openNotifications(page);

  await page.locator(".notification-item", { hasText: "TAS-107 was assigned to you" }).click();

  // Read the moment the click returns rather than waited for: the route is
  // built from the notification, so it is already there. The read that used to
  // resolve the project took the mock's 140ms, and would fail this.
  expect(await page.evaluate(() => window.location.pathname)).toMatch(ISSUE_PATH);
  await expect(page.getByText("TAS-107", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /not found/i })).toHaveCount(0);
  // The click closed the panel, and the row it pressed was still marked read.
  await expect(page.getByRole("button", BELL)).toHaveAccessibleName("Notifications, 2 unread");
});

test("rows with nothing to open say so, mark read, and leave the reader where they were", async ({ page }) => {
  await openNotifications(page);

  // Four reasons, one row each: not about an issue, a deleted issue, an issue
  // notification from before the gateway stated the issue, and — until
  // TAS-245 — an attachment notification that carries issueId alone.
  const inert = page.locator(".notification-item.is-inert");
  await expect(inert).toHaveCount(4);
  for (const text of ["Sofia added you to Taska Platform", "TAS-100 was deleted", "moved to DONE", "An attachment was added to"]) {
    // `cursor: default` is the whole of what the class does, and there is no
    // cursor at 390 or on the keyboard path, so the row has to say it in words.
    await expect(inert.filter({ hasText: text })).toContainText("Nothing to open");
  }
  // A row that does open something must not say it.
  await expect(page.locator(".notification-item", { hasText: "Nothing to open" })).toHaveCount(4);

  // The pre-migration row, which still has the issue's uuid in its prose: the
  // one a body-mining resolver would have opened.
  const board = page.url();
  const legacy = inert.filter({ hasText: "moved to DONE" });
  await expect(legacy.locator(".read-dot.is-unread")).toHaveCount(1);
  await legacy.click();

  // Still on the board, and the panel is still open — a row that goes nowhere
  // is not a row that closes the panel behind a reader who wanted to read on.
  await expect(page.locator(".notifications-popover")).toBeVisible();
  expect(page.url()).toBe(board);
  // And it did mark itself read.
  await expect(legacy.locator(".read-dot.is-unread")).toHaveCount(0);
  await expect(page.getByRole("button", BELL)).toHaveAccessibleName("Notifications, 2 unread");
});

// DESIGN.md §7: the count belongs in the trigger's accessible name, and unread
// is never said by colour alone.
test("the bell's name carries the unread count, and mark all read clears it", async ({ page }) => {
  await signIn(page);
  const bell = page.getByRole("button", BELL);
  await expect(bell).toHaveAccessibleName("Notifications, 3 unread");
  await expect(page.locator(".notification-dot")).toBeVisible();

  await openBell(page);
  // Each unread row says so in its name, first, and a read row does not.
  const assigned = page.locator(".notification-item", { hasText: "TAS-107 was assigned to you" });
  await expect(assigned).toHaveAccessibleName(/^Unread: Issue assigned /);
  const added = page.locator(".notification-item", { hasText: "Sofia added you" });
  await expect(added).toHaveAccessibleName(/^Added to a project /);

  await page.getByRole("button", { name: "Mark all read" }).click();

  await expect(page.locator(".notification-dot")).toHaveCount(0);
  await expect(bell).toHaveAccessibleName("Notifications");
  await expect(page.locator(".read-dot.is-unread")).toHaveCount(0);
  await expect(assigned).toHaveAccessibleName(/^Issue assigned /);

  // The server's answer, not only the optimistic one: closed and reopened,
  // the panel re-reads the inbox and it is still all read.
  await page.keyboard.press("Escape");
  await expect(page.locator(".notifications-popover")).toHaveCount(0);
  await openBell(page);
  await expect(page.locator(".notification-item").first()).toBeVisible();
  await expect(page.locator(".read-dot.is-unread")).toHaveCount(0);
  await expect(bell).toHaveAccessibleName("Notifications");
});

// The inbox is the user's — `GET /api/v1/notifications` takes no project — so
// the bell hangs in the shared bar as well (TAS-185), and the destination has
// to be built without anything the screen around it knows. It is: the route
// comes from the notification's own `projectId` and `issueId`. This is the pin
// on that from a router rather than from a unit test, because "there is no
// project in scope" is exactly the kind of thing a component test supplies by
// accident.
test("a notification opens its issue from /projects, where no project is open", async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

  await openBell(page);
  await page.locator(".notification-item", { hasText: "TAS-107 was assigned to you" }).click();

  await expect(page).toHaveURL(ISSUE_URL);
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
  // The comment row this time, so a kind that is about the issue without being
  // the issue itself opens the same way.
  await page.locator(".notification-item", { hasText: "Mark commented on TAS-101" }).click();

  await expect(page).toHaveURL(ISSUE_URL);
  await expect(page.getByLabel("TAS-101 issue")).toBeVisible();
});

// A notification the product makes, rather than one the seed wrote: creating
// an issue raises an ISSUE_CREATED carrying the new issue's ids, and the route
// built from them has to survive being followed from a screen that has no
// project. It is absolute — `/projects/…` — or it would resolve against
// whatever screen the bell was opened from.
test("a notification the product just made opens from /projects too", async ({ page }) => {
  await signIn(page);
  await page.locator(".project-card", { hasText: "Taska Platform" }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/board$/);

  await page.getByRole("button", { name: "New" }).click();
  const dialog = page.getByRole("dialog", { name: "New issue" });
  await dialog.getByLabel("Summary").fill("Rotate the gateway signing key");
  await dialog.getByRole("button", { name: "Create issue" }).click();
  await expect(page).toHaveURL(/\/issues\//);

  // Out of the project entirely, which is the whole point. In the app rather
  // than through `page.goto`: the mock's store is a module in this page, so a
  // reload would re-seed it and take the notification that was just made with
  // it.
  // Exact, or the panel's backdrop ("Close issue") matches too.
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Back to projects" }).click();
  await expect(page).toHaveURL(/\/projects$/);

  await openBell(page);
  const row = page.locator(".notification-item").first();
  await expect(row).toContainText("Issue created");
  await row.click();

  await expect(page).toHaveURL(ISSUE_URL);
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
  await page.getByRole("button", BELL).focus();
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
