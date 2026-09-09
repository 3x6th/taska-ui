import { expect, test, type Locator, type Page } from "@playwright/test";

// Mock-backed like every spec here (playwright.config.ts starts the server with
// VITE_TASKA_API_MODE=mock): any seeded user signs in with any password.
//
// **Nothing below is evidence about the gateway.** The five watcher routes are
// deployed, and that is measured rather than taken from the backend PR: `GET
// …/watchers` answered `200 {totalCount, watchers[]}` on 2026-09-08, and on
// 2026-09-09 all five were probed with an invalid uuid and no credentials —
// four answer `400 INVALID_ARGUMENT`, `POST …/watchers` answers `415
// UNSUPPORTED_MEDIA_TYPE`, and a `…/watchers-nope` control answers the
// static-resource `404`. But every answer *this file* reacts to comes from
// `MockTaskaStore`, including the two the product depends on most: `removed`
// on an unwatch that deletes nothing, and the `PERMISSION_DENIED` on the two
// project-ADMIN routes. Read these as pinning what the UI does with such a
// response, never as proof that the server sends one.
//
// The seed is arranged so each state is one sign-in away. Anna is an ADMIN of
// Taska Platform: TAS-101 has her plus two others watching, TAS-102 has nobody,
// and TAS-103 has two people who are not her — one of whom (Priya) is not a
// member of the project at all, so the member read cannot name her and her row
// draws as "Unknown". Mark is a MEMBER, which is how the ungated toggle is told
// apart from the two controls that are gated.

async function signIn(page: Page, email = "anna@example.com") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);
}

async function openIssuePanel(page: Page, issueKey: string): Promise<Locator> {
  await page.getByRole("button", { name: /Taska Platform/ }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/board$/);

  await page.locator(".issue-card", { hasText: issueKey }).click();
  await expect(page.getByRole("complementary", { name: `${issueKey} issue` })).toBeVisible();

  return page.locator(".issue-watchers");
}

// Remounting the section is what proves the store answered rather than the
// cache. A `page.reload()` would not do: `MockTaskaStore` lives in memory and is
// rebuilt on every page load, so a reload would discard the very subscription
// the round trip is meant to prove.
async function reopenIssuePanel(page: Page, issueKey: string): Promise<Locator> {
  // Exact: the backdrop behind the panel is also a button, named "Close issue".
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("complementary", { name: `${issueKey} issue` })).toHaveCount(0);
  await page.locator(".issue-card", { hasText: issueKey }).click();
  await expect(page.getByRole("complementary", { name: `${issueKey} issue` })).toBeVisible();
  return page.locator(".issue-watchers");
}

test("reads the toggle and the count from the server's own answer", async ({ page }) => {
  await signIn(page);
  const watchers = await openIssuePanel(page, "TAS-101");

  await expect(watchers.getByRole("heading", { name: /Watchers/ })).toBeVisible();
  // Three seeded rows, and the count says three because the server said three —
  // not because three rows were counted.
  await expect(watchers.locator(".count-pill")).toHaveText("3");
  await expect(watchers.getByRole("button", { name: "Watching", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(watchers.locator(".watcher-row")).toHaveCount(3);
  // The reader's own row is marked, so the toggle and the list cannot be read
  // as saying different things.
  await expect(watchers.getByText("(you)")).toBeVisible();
});

test("watches an issue nobody watches, and the state survives a reopen", async ({ page }) => {
  await signIn(page);
  let watchers = await openIssuePanel(page, "TAS-102");

  await expect(watchers.getByText("No one is watching this issue yet")).toBeVisible();
  const toggle = watchers.getByRole("button", { name: "Watch", exact: true });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  // Nobody has stated a number for an empty list — the mock states 0 — so the
  // pill is on screen reading zero rather than absent.
  await expect(watchers.locator(".count-pill")).toHaveText("0");

  await toggle.click();

  await expect(watchers.getByRole("button", { name: "Watching", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(watchers.locator(".count-pill")).toHaveText("1");
  await expect(watchers.locator(".watcher-row")).toHaveCount(1);

  watchers = await reopenIssuePanel(page, "TAS-102");
  await expect(watchers.getByRole("button", { name: "Watching", exact: true })).toBeVisible();
  await expect(watchers.locator(".count-pill")).toHaveText("1");
});

test("keeps a populated list under an unpressed toggle", async ({ page }) => {
  await signIn(page);
  const watchers = await openIssuePanel(page, "TAS-103");

  // The state that catches a UI deriving "am I watching" from whether the list
  // is empty: two people are watching and neither of them is the reader.
  await expect(watchers.locator(".count-pill")).toHaveText("2");
  await expect(watchers.getByRole("button", { name: "Watch", exact: true })).toHaveAttribute("aria-pressed", "false");
  await expect(watchers.getByText("(you)")).toHaveCount(0);
  // Priya is not a member of this project, so `GET /projects/{id}/members`
  // cannot name her — the state every watcher is in against the deployed
  // gateway, where that read is a 405 (TAS-137). The row is drawn anyway.
  await expect(watchers.getByText("Unknown")).toBeVisible();
});

test("unwatches, and says so when there was nothing to remove", async ({ page }) => {
  await signIn(page);
  const watchers = await openIssuePanel(page, "TAS-101");

  await watchers.getByRole("button", { name: "Watching", exact: true }).click();
  await expect(watchers.getByRole("button", { name: "Watch", exact: true })).toBeVisible();
  await expect(watchers.locator(".count-pill")).toHaveText("2");
  // A removal that removed something says nothing at all.
  await expect(watchers.locator(".watcher-note")).toHaveCount(0);

  // An ADMIN can clear a row that is not their own, and this is the half of the
  // feature that needs no member list: a remove names a `userId`, which every
  // row already carries.
  await watchers.getByRole("button", { name: /^Remove / }).first().click();
  await expect(watchers.locator(".count-pill")).toHaveText("1");
});

test("takes one watcher on a double-click of one row's remove, not two", async ({ page }) => {
  await signIn(page);
  const watchers = await openIssuePanel(page, "TAS-101");
  await expect(watchers.locator(".watcher-row")).toHaveCount(3);

  const first = watchers.getByRole("button", { name: /^Remove / }).first();
  const second = (await watchers.getByRole("button", { name: /^Remove / }).nth(1).getAttribute("aria-label"))!;

  // Raw mouse presses at one fixed point rather than `locator.click()` twice,
  // because the defect is about hit-testing: a hand does not re-find the
  // button between the two presses of a double-click, it presses the same
  // *place* again. The row used to be filtered out of the list on the first
  // press, the list reflowed inside a frame, and the second press landed on the
  // next row's ✕ — two `DELETE`s for two people out of one gesture, with no
  // confirmation, no undo and nothing on screen naming the second person.
  const box = (await first.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();

  // The in-flight row, which is what the fix is: it holds its place, so the
  // second press below is still over the same control. Waiting for the state
  // rather than for a duration is also what puts the press inside the mock's
  // 140ms answer instead of racing it.
  await expect(watchers.locator(".watcher-row.is-pending")).toHaveCount(1);
  await page.mouse.down();
  await page.mouse.up();

  await expect(watchers.locator(".watcher-row")).toHaveCount(2);
  // Nothing else happens after the write settles: a second `DELETE` would have
  // answered inside this wait, and the mock's own list is what the reopened
  // panel would read.
  await page.waitForTimeout(400);
  await expect(watchers.locator(".watcher-row")).toHaveCount(2);
  await expect(watchers.getByRole("button", { name: second })).toBeVisible();
  await expect(watchers.locator(".count-pill")).toHaveText("2");
});

test("removes a row from the keyboard and hands focus to the next one", async ({ page }) => {
  await signIn(page);
  const watchers = await openIssuePanel(page, "TAS-101");

  const first = watchers.getByRole("button", { name: /^Remove / }).first();
  const next = (await watchers.getByRole("button", { name: /^Remove / }).nth(1).getAttribute("aria-label"))!;
  await first.focus();
  await page.keyboard.press("Enter");

  await expect(watchers.locator(".watcher-row")).toHaveCount(2);
  // §4.21's `aria-disabled` rule applies to this control too — a real
  // `disabled` while the `DELETE` is out drops focus to `<body>` in Chromium
  // the moment the attribute lands — and the row that leaves hands focus on
  // rather than taking it with it.
  await expect(watchers.getByRole("button", { name: next })).toBeFocused();
});

test("offers an admin a picker of members who are not watching yet", async ({ page }) => {
  await signIn(page);
  let watchers = await openIssuePanel(page, "TAS-103");

  const picker = watchers.getByLabel("Add a watcher");
  // Mark is already watching, so he is not on offer; Anna, Sofia and Tom are.
  await expect(picker.locator("option")).toHaveText([
    "Select a member",
    "Anna Ivanova",
    "Sofia Reyes",
    "Tom Becker",
  ]);

  const sofia = picker.locator("option", { hasText: "Sofia Reyes" });
  await picker.selectOption((await sofia.getAttribute("value"))!);
  await watchers.getByRole("button", { name: "Add", exact: true }).click();

  await expect(watchers.getByRole("button", { name: "Remove Sofia Reyes from watchers" })).toBeEnabled();
  await expect(watchers.locator(".count-pill")).toHaveText("3");
  // Somebody the ADMIN subscribed is not the ADMIN's own subscription: the
  // toggle above is untouched.
  await expect(watchers.getByRole("button", { name: "Watch", exact: true })).toHaveAttribute("aria-pressed", "false");

  watchers = await reopenIssuePanel(page, "TAS-103");
  await expect(watchers.getByRole("button", { name: "Remove Sofia Reyes from watchers" })).toBeVisible();
});

test("leaves a MEMBER the toggle and neither admin control", async ({ page }) => {
  await signIn(page, "mark@example.com");
  const watchers = await openIssuePanel(page, "TAS-101");

  // The one control in the panel that is not behind write access: the contract
  // puts no role on `…/watchers/me`.
  const toggle = watchers.getByRole("button", { name: "Watching", exact: true });
  await expect(toggle).toBeEnabled();
  await expect(watchers.getByLabel("Add a watcher")).toHaveCount(0);
  await expect(watchers.getByRole("button", { name: /^Remove / })).toHaveCount(0);

  await toggle.click();
  await expect(watchers.getByRole("button", { name: "Watch", exact: true })).toHaveAttribute("aria-pressed", "false");
  await expect(watchers.locator(".count-pill")).toHaveText("2");
});

test("drives the whole toggle from the keyboard", async ({ page }) => {
  await signIn(page);
  const watchers = await openIssuePanel(page, "TAS-102");

  const toggle = watchers.getByRole("button", { name: "Watch", exact: true });
  // Reached *by keyboard*, not by `focus()`. Chromium matches `:focus-visible`
  // on the interaction modality, so a programmatic focus after a pointer press
  // draws no ring at all and the assertion below would be measuring the wrong
  // thing — the same trap `admin-users.spec.ts` records.
  await toggle.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(toggle).toBeFocused();
  // §4.1's ring, on the control this feature is mostly about.
  expect(await page.evaluate(() => document.activeElement?.matches(":focus-visible"))).toBe(true);
  expect(await toggle.evaluate((node) => getComputedStyle(node).outlineWidth)).not.toBe("0px");

  await page.keyboard.press("Enter");
  await expect(watchers.getByRole("button", { name: "Watching", exact: true })).toHaveAttribute("aria-pressed", "true");

  // **The regression this case exists for.** The toggle used to carry
  // `disabled` while the write was in flight, and Chromium drops focus from a
  // button the moment that attribute lands — so the press below went to
  // `<body>` and a keyboard user could watch an issue and then not unwatch it
  // without tabbing in from the top of the document again. It is `aria-disabled`
  // now, which announces the same thing and keeps the focus.
  // Located by class, because the accessible name is the thing that just
  // changed — which is the point of the toggle and would make a name-based
  // locator here assert about the wrong element.
  await expect(watchers.locator(".watch-toggle")).toBeFocused();

  // The press is deliberately inert until the write settles: a `PUT` and a
  // `DELETE` in flight together can be applied by the server in either order.
  // Waiting for the flag to clear is what a person does by reflex and what this
  // has to do explicitly.
  await expect(watchers.locator(".watch-toggle")).not.toHaveAttribute("aria-disabled", "true");

  await page.keyboard.press("Enter");
  await expect(watchers.getByRole("button", { name: "Watch", exact: true })).toHaveAttribute("aria-pressed", "false");
});
