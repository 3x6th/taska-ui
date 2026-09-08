import { expect, test, type Page } from "@playwright/test";

// Like the other suites, this runs against MockTaskaApi
// (playwright.config.ts starts the server with VITE_TASKA_API_MODE=mock): any
// seeded user's email signs in with any password. Mark is the seed's only
// GLOBAL_ADMIN, so he is the only one who can reach this section at all.
//
// The mock seeds `outbox_events` in auth, project and issue only, with a
// handful of problematic rows in each and a summary limit of five — which is
// what makes the service selector, the counts and the truncation line real
// here rather than staged.

async function openEvents(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("mark@example.com");
  await page.getByLabel("Password").fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);

  await page.goto("/admin/events");
  await expect(page.getByRole("heading", { level: 1, name: "Events" })).toBeVisible();
}

test("opens on the summary, with the counts and the oldest events", async ({ page }) => {
  await openEvents(page);

  // The summary is the root of the section — no redirect, because it is where
  // the question "what broke" is answered.
  await expect(page).toHaveURL(/\/admin\/events$/);
  await expect(page.getByRole("navigation", { name: "Events views" }).getByRole("link", { name: "Problems" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  const matrix = page.getByRole("table", { name: "Problem counts by service" });
  // Services come from the response's own counts, not from the catalog — and in
  // the matrix's own order, sorted by key. The mock answers in catalog order
  // (auth, project, issue), so alphabetical here is the sort doing its job: the
  // response order is unspecified, and rows that reshuffle between refetches
  // would be worse than any fixed order (§5.8).
  await expect(matrix.getByRole("rowheader")).toHaveText(["auth", "issue", "project"]);
  await expect(matrix.getByRole("columnheader")).toHaveText([
    "service",
    "Failed",
    "Stuck processing",
    "Overdue NEW",
  ]);

  const list = page.getByRole("table", { name: "Problematic events, oldest first" });
  // Category is derived from status, and both are on screen: the raw value in
  // its own column, the reading of it beside the service.
  const category = list.getByRole("cell", { name: "Failed, Event processing failed", exact: true }).first();
  await expect(category).toBeVisible();
  // The visible word stays the one-word category; the server's own sentence is
  // on the same cell, in `title` and in its accessible name, because it is a
  // field of the summary with no column and no card to live in (§5.8). The
  // exact name above is the assertion that matters: it pins the punctuation,
  // which is not free — a hidden ", …" appended to visible text is announced
  // with the space before the comma.
  await expect(category.locator("[aria-hidden=true]")).toHaveText("Failed");
  await expect(category).toHaveAttribute("title", "Event processing failed");
  await expect(list.getByRole("cell", { name: "FAILED", exact: true }).first()).toBeVisible();
  await expect(list.getByRole("cell", { name: "project", exact: true }).first()).toBeVisible();

  // The list is cut short by the server's limit, and says so as a statement
  // rather than as an alert.
  await expect(page.getByText(/Showing the oldest 5 events; the counts above cover the rest\./)).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("crosses to the journal, which offers only the services that have an outbox", async ({ page }) => {
  await openEvents(page);

  await page.getByRole("navigation", { name: "Events views" }).getByRole("link", { name: "Outbox" }).click();

  // `/admin/events/outbox` resolves into the first service with an outbox, and
  // the substitution is visible in the address rather than silent.
  await expect(page).toHaveURL(/\/admin\/events\/outbox\/auth$/);
  const selector = page.getByRole("navigation", { name: "Outbox service" });
  // From the catalog: exactly the services whose catalog entry has the table.
  await expect(selector.getByRole("link")).toHaveText(["auth", "project", "issue"]);
  await expect(selector.getByRole("link", { name: "auth" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("columnheader", { name: /aggregate_id/ })).toBeVisible();
});

test("narrows the journal by status, and the link carries the filter", async ({ page }) => {
  await openEvents(page);
  await page.goto("/admin/events/outbox/auth");
  const rows = page.locator(".admin-table tbody tr");
  await expect(rows.first()).toBeVisible();
  const before = await rows.count();
  expect(before).toBeGreaterThan(1);

  // Filters are offered by name — there is no Match control anywhere in this
  // section, because the operator is part of the name.
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(page.getByLabel("Match", { exact: true })).toHaveCount(0);
  await page.getByLabel("Filter", { exact: true }).selectOption("status.equals");
  await page.getByLabel("Value", { exact: true }).selectOption("FAILED");
  await page.getByRole("button", { name: "Apply" }).click();

  await expect(rows).toHaveCount(1);
  await expect(page.getByRole("cell", { name: "FAILED" })).toBeVisible();
  await expect(page).toHaveURL(/filter=status%3Aequals%3AFAILED/);

  // The state is the address, so a reload is not a reset.
  await page.reload();
  await expect(rows).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Remove filter Status is FAILED" })).toBeVisible();

  await page.getByRole("button", { name: "Remove filter Status is FAILED" }).click();
  await expect(rows).toHaveCount(before);
});

// The deliberate difference from the Data section (§5.8): the table and its
// columns are the same in every service, so the question a reader is holding
// survives the switch — only the page cannot.
test("keeps the filter when the service changes, and resets the page", async ({ page }) => {
  await openEvents(page);

  await page.goto("/admin/events/outbox/issue?page=2");
  await expect(page.getByText("Page 2 of 2")).toBeVisible();
  await page.getByRole("navigation", { name: "Outbox service" }).getByRole("link", { name: "auth" }).click();
  await expect(page).toHaveURL(/\/admin\/events\/outbox\/auth$/);

  await page.goto("/admin/events/outbox/issue?filter=status%3Aequals%3AFAILED");
  await expect(page.locator(".admin-table tbody tr")).toHaveCount(2);
  await page.getByRole("navigation", { name: "Outbox service" }).getByRole("link", { name: "auth" }).click();

  await expect(page).toHaveURL(/\/admin\/events\/outbox\/auth\?filter=status%3Aequals%3AFAILED/);
  await expect(page.getByRole("button", { name: "Remove filter Status is FAILED" })).toBeVisible();
  await expect(page.locator(".admin-table tbody tr")).toHaveCount(1);
});

test("opens an event from the journal and comes back to the same query", async ({ page }) => {
  await openEvents(page);

  await page.goto("/admin/events/outbox/auth?filter=status%3Aequals%3AFAILED");
  await expect(page.locator(".admin-table tbody tr")).toHaveCount(1);
  await page.getByRole("link", { name: /^Open row / }).first().click();

  await expect(page).toHaveURL(/\/admin\/events\/outbox\/auth\/[0-9a-f-]{36}\?filter=/);
  await expect(page.locator(".admin-table")).toHaveCount(0);
  // The payload is a JSON column, so a document that parses is laid out to be
  // read rather than printed on one line.
  await expect(page.locator(".admin-card-json")).toBeVisible();
  await expect(page.getByText("last_error_message", { exact: true })).toBeVisible();

  // The card is an address: a reload has to give the same card and the same
  // way back.
  await page.reload();
  await expect(page.getByRole("link", { name: "Back to auth.outbox_events" })).toBeVisible();

  await page.getByRole("link", { name: "Back to auth.outbox_events" }).click();
  await expect(page).toHaveURL(/filter=status%3Aequals%3AFAILED/);
  await expect(page.locator(".admin-table tbody tr")).toHaveCount(1);
});

// Where a card goes back to is part of its address rather than of history, so
// an event opened from the summary returns to the summary even after a reload.
test("an event opened from the summary returns to the summary", async ({ page }) => {
  await openEvents(page);

  await page.getByRole("link", { name: /^Open event / }).first().click();

  await expect(page).toHaveURL(/\/admin\/events\/outbox\/[a-z]+\/[0-9a-f-]{36}\?from=problems$/);
  await page.reload();

  const back = page.getByRole("link", { name: "Back to Problems" });
  await expect(back).toBeVisible();
  await back.click();
  await expect(page).toHaveURL(/\/admin\/events$/);
  await expect(page.getByRole("table", { name: "Problem counts by service" })).toBeVisible();
});

/**
 * Retrying a stuck event (TAS-194) — the section's one write, end to end
 * against the mock's own rules rather than a stubbed answer.
 *
 * The mock reproduces admin-service's eligibility: `FAILED` and long-stuck
 * `PROCESSING` may be retried, `NEW` may not. So the two halves below — a
 * button that works and a button that is absent — are the backend's rule
 * arriving through the whole stack, not a fixture arranged to look like it.
 */
test("retries a failed event, and offers nothing on one the server would refuse", async ({ page }) => {
  await openEvents(page);

  const list = page.getByRole("table", { name: "Problematic events, oldest first" });
  const rows = list.locator("tbody tr");
  await expect(rows.first()).toBeVisible();

  // Every row that is `NEW` has no button, and every `FAILED` one does. Read off
  // the rendered table rather than from a seeded id, so the seed can grow.
  const newRows = rows.filter({ has: page.getByRole("cell", { name: "NEW", exact: true }) });
  await expect(newRows.first()).toBeVisible();
  await expect(newRows.first().getByRole("button", { name: /^Retry event / })).toHaveCount(0);

  const retryButtons = list.getByRole("button", { name: /^Retry event / });
  const before = await retryButtons.count();
  expect(before).toBeGreaterThan(0);
  const retry = retryButtons.first();
  await expect(retry).toBeVisible();
  await retry.click();

  const dialog = page.getByRole("dialog", { name: "Retry outbox event" });
  await expect(dialog.getByText(/→ NEW/)).toBeVisible();
  // The button waits for a reason, and the line under the field says why.
  const confirm = dialog.getByRole("button", { name: "Retry", exact: true });
  await expect(confirm).toBeDisabled();
  await expect(dialog.getByText(/A reason is required/)).toBeVisible();

  await dialog.getByLabel("Reason").fill("Kafka is back");
  // The countdown is to this route's own 1000, not the admin user writes' 550.
  await expect(dialog.getByText("987 of 1000 characters left")).toBeVisible();
  await expect(confirm).toBeEnabled();
  await confirm.click();

  await expect(page.getByRole("dialog")).toHaveCount(0);
  // No toast in this product (§5.6), so the confirmation is the live region and
  // the row itself. The mock puts the row back into NEW, which is a state this
  // list still shows — so the event stays, one category to the left.
  await expect(page.getByText(/ is now NEW\./)).toBeAttached();
  // Focus is not dropped. The control that opened the dialog is gone — the row
  // is `NEW` now and offers no retry — so it lands on the list's own region,
  // which is one Tab from the next stuck row instead of from the top of the
  // document (§7).
  await expect(page.getByRole("region", { name: "Problematic events" })).toBeFocused();
  // One fewer button than before: the mock put that row back into `NEW`, which
  // this list still shows — one category to the left — and a `NEW` row offers
  // no retry, because the server would refuse it. That the count moves at all is
  // the proof the write reached the store rather than only the screen.
  await expect(retryButtons).toHaveCount(before - 1);
});

/**
 * The refusal, and the reason it is not a bug in this screen.
 *
 * The summary calls a `PROCESSING` row stuck after the producing service's own
 * timeout; the retry route wants a longer wait of its own. Between the two, a
 * row is listed as stuck and refused — and the client cannot tell, because both
 * thresholds are server configuration (docs/ai/API-DIVERGENCE.md). The mock
 * seeds one row in that gap on purpose, so the whole path is exercised here:
 * the warning before the press, and the server's own sentence after it.
 */
test("keeps the dialog open when the server refuses, with its own words in it", async ({ page }) => {
  await openEvents(page);

  const list = page.getByRole("table", { name: "Problematic events, oldest first" });
  const stuck = list
    .locator("tbody tr")
    .filter({ has: page.getByRole("cell", { name: "PROCESSING", exact: true }) })
    .filter({ has: page.getByRole("cell", { name: "project", exact: true }) });
  await stuck.getByRole("button", { name: /^Retry event / }).click();

  const dialog = page.getByRole("dialog", { name: "Retry outbox event" });
  // Said before the press, not only after it.
  await expect(dialog.getByText(/still being processed/)).toBeVisible();
  await dialog.getByLabel("Reason").fill("It looks stuck to me");
  await dialog.getByRole("button", { name: "Retry", exact: true }).click();

  // Open, not closed over a change that did not happen (§5.8).
  const alert = dialog.getByRole("alert");
  await expect(alert).toBeVisible();
  await expect(alert).toContainText(/would not retry this event/i);
  // The server's own sentence, printed as it arrived — nothing here branches on
  // its wording.
  await expect(alert).toContainText("is not eligible for retry");
  // And the reason survives, so a second attempt does not start from nothing.
  await expect(dialog.getByLabel("Reason")).toHaveValue("It looks stuck to me");
});

// The whole dialog has to be reachable and dismissable from the keyboard: it is
// a write, and §4.11 gives it Esc to cancel.
test("opens the retry dialog from the keyboard and cancels it with Escape", async ({ page }) => {
  await openEvents(page);

  const retry = page.getByRole("button", { name: /^Retry event / }).first();
  await retry.focus();
  await expect(retry).toBeFocused();
  // A visible ring, and the row it belongs to lit up: on a table this wide the
  // button is off the right edge and a ring alone would not say which row.
  expect(await retry.evaluate((node) => getComputedStyle(node).outlineWidth)).not.toBe("0px");

  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Retry outbox event" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // Focus comes back to the control that opened it (§7).
  await expect(retry).toBeFocused();
});

// A row that opens has to open from the keyboard too: the row itself cannot be
// a control, so the link in the last cell is the whole path (§5.8) — and the
// row it belongs to lights up, because on a wide table that link is off the
// right edge of the scroll container.
test("reaches an event's link from the keyboard, visibly", async ({ page }) => {
  await openEvents(page);

  const openLink = page.getByRole("link", { name: /^Open event / }).first();
  await page.getByRole("link", { name: "Outbox" }).focus();
  for (let step = 0; step < 10; step += 1) {
    if (await openLink.evaluate((node) => node === document.activeElement)) break;
    await page.keyboard.press("Tab");
  }

  await expect(openLink).toBeFocused();
  expect(await openLink.evaluate((node) => getComputedStyle(node).outlineWidth)).not.toBe("0px");

  // Compared against the row *below* rather than against transparency: the
  // service column is frozen now, so its cells carry an opaque background at
  // rest and "not transparent" would pass whether or not the row lit up. What
  // has to be true is that the focused row differs from an unfocused one.
  const firstCells = page.getByRole("table", { name: "Problematic events, oldest first" }).locator("tbody tr td:first-child");
  const background = (index: number) =>
    firstCells.nth(index).evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(await background(0)).not.toBe(await background(1));
});
