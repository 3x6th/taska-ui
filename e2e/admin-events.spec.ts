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
  // Services come from the response's own counts, not from the catalog.
  await expect(matrix.getByRole("rowheader")).toHaveText(["auth", "project", "issue"]);
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
  const cell = page
    .getByRole("table", { name: "Problematic events, oldest first" })
    .locator("tbody tr")
    .first()
    .locator("td")
    .first();
  expect(await cell.evaluate((node) => getComputedStyle(node).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
});
