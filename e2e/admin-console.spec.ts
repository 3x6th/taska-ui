import { expect, test, type Page } from "@playwright/test";

// Like the other suites, this runs against MockTaskaApi
// (playwright.config.ts starts the server with VITE_TASKA_API_MODE=mock): any
// seeded user's email signs in with any password. Mark is the seed's only
// GLOBAL_ADMIN, so he is the only one who can reach this section at all.
//
// The seed's `auth.users` table carries a column the catalog marks sensitive,
// which is what makes the masking assertions here mean something.

async function openConsole(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("mark@example.com");
  await page.getByLabel("Password").fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);

  await page.goto("/admin");
  // /admin is an area with sections now (DESIGN.md §5.8): it redirects into
  // Data, and the heading is the section's.
  await expect(page.getByRole("heading", { level: 1, name: "Data" })).toBeVisible();
}

test("walks the catalog from a service down to a table's rows", async ({ page }) => {
  await openConsole(page);

  // Opens on something rather than an empty frame — and says so in the address.
  await expect(page).toHaveURL(/\/admin\/data\/auth\/users$/);
  await expect(page.getByRole("heading", { name: "auth.users" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "anna@example.com" })).toBeVisible();

  await page.getByRole("link", { name: "audit_log", exact: true }).click();

  await expect(page).toHaveURL(/\/admin\/data\/admin\/audit_log$/);
  await expect(page.getByRole("heading", { name: "admin.audit_log" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: /action/i })).toBeVisible();
});

test("a copied link opens the same table, page and filter", async ({ page }) => {
  await openConsole(page);

  await page.goto("/admin/data/auth/users?filter=email:contains:anna@");

  await expect(page.getByRole("heading", { name: "auth.users" })).toBeVisible();
  await expect(page.locator(".admin-table tbody tr")).toHaveCount(1);
  await expect(page.getByRole("cell", { name: "anna@example.com" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove filter on email" })).toBeVisible();
});

test("never renders the value of a column the catalog marked sensitive", async ({ page }) => {
  await openConsole(page);

  await expect(page.getByRole("columnheader", { name: /password_hash/i })).toBeVisible();
  // The column is named — hiding its existence would misrepresent the schema —
  // but no row shows what is in it.
  await expect(page.getByText("hidden").first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText("$2b$10$");

  // Settled state after a table switch. Note what this does NOT prove: the
  // transient leak that used to happen mid-switch is invisible to Playwright,
  // because `not.toContainText` polls until it holds and a leak lasting one
  // render passes trivially. That case is pinned in
  // src/screens/admin/AdminScreen.test.tsx, which can hold the request open and
  // look at the frame in between. Do not treat this assertion as covering it.
  await page.getByRole("link", { name: "audit_log", exact: true }).click();
  await expect(page.getByRole("heading", { name: "admin.audit_log" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("$2b$10$");
});

test("pages through a table and says where it is", async ({ page }) => {
  await openConsole(page);

  await page.getByRole("link", { name: "audit_log", exact: true }).click();
  await expect(page.getByRole("heading", { name: "admin.audit_log" })).toBeVisible();

  const firstCell = page.locator(".admin-table tbody tr td").first();
  const onPageOne = await firstCell.innerText();

  await expect(page.getByText(/Page 1 of \d+/)).toBeVisible();
  // Nowhere to go back to from the first page.
  await expect(page.getByRole("button", { name: "Previous" })).toBeDisabled();

  await page.getByRole("button", { name: "Next" }).click();

  await expect(page.getByText(/Page 2 of \d+/)).toBeVisible();
  // The page is in the address, so this view is linkable like any other.
  await expect(page).toHaveURL(/page=2/);
  await expect(page.getByRole("button", { name: "Previous" })).toBeEnabled();
  expect(await firstCell.innerText()).not.toBe(onPageOne);
});

test("sorts by a column and reverses on a second press", async ({ page }) => {
  await openConsole(page);

  await page.getByRole("link", { name: "audit_log", exact: true }).click();
  await expect(page.getByRole("heading", { name: "admin.audit_log" })).toBeVisible();

  const firstCell = page.locator(".admin-table tbody tr td").first();
  const sortById = page.getByRole("button", { name: /^id/i });

  // Concrete ids rather than "the value changed": the header's aria-sort flips
  // from the address the instant it is clicked, while the rows come back from
  // the server a moment later, so comparing before/after can pass on stale
  // rows. The seed's audit_log runs audit-001..audit-047.
  await sortById.click();
  await expect(page.locator("th", { has: sortById })).toHaveAttribute("aria-sort", "ascending");
  await expect(firstCell).toHaveText("audit-001");

  await sortById.click();
  await expect(page.locator("th", { has: sortById })).toHaveAttribute("aria-sort", "descending");
  await expect(firstCell).toHaveText("audit-047");
});

test("filters a table down and back", async ({ page }) => {
  await openConsole(page);

  // The caption renders from the selection before any rows arrive, so waiting
  // on it is not enough — wait for a row.
  await expect(page.getByRole("cell", { name: "anna@example.com" })).toBeVisible();
  const rows = page.locator(".admin-table tbody tr");
  const before = await rows.count();
  expect(before).toBeGreaterThan(1);

  await page.getByRole("button", { name: "Filter" }).click();
  await page.getByLabel("Column", { exact: true }).selectOption("email");
  await page.getByLabel("Match", { exact: true }).selectOption("contains");
  await page.getByLabel("Value", { exact: true }).fill("anna@");
  await page.getByRole("button", { name: "Apply" }).click();

  await expect(rows).toHaveCount(1);
  await expect(page.getByRole("cell", { name: "anna@example.com" })).toBeVisible();

  // The applied filter is a chip, and its cross is what removes it — there is
  // no separate Clear row any more (§5.8).
  await page.getByRole("button", { name: "Remove filter on email" }).click();
  await expect(rows).toHaveCount(before);
});

test("a filter that matches nothing says so instead of looking broken", async ({ page }) => {
  await openConsole(page);

  await expect(page.getByRole("heading", { name: "auth.users" })).toBeVisible();

  await page.getByRole("button", { name: "Filter" }).click();
  await page.getByLabel("Column", { exact: true }).selectOption("email");
  await page.getByLabel("Match", { exact: true }).selectOption("contains");
  await page.getByLabel("Value", { exact: true }).fill("nobody-here-at-all");
  await page.getByRole("button", { name: "Apply" }).click();

  await expect(page.getByText("No rows match this filter.")).toBeVisible();
});

test("opens one row and comes back to the page and filter it was opened from", async ({ page }) => {
  await openConsole(page);

  // A filtered second page, so the way back has something to lose: without the
  // table's query travelling with the row address, Back lands on page 1 of an
  // unfiltered table and the reader has to find their place again.
  await page.goto("/admin/data/auth/sessions?filter=revoked:equals:false&page=2");
  await expect(page.getByText("Page 2 of 2")).toBeVisible();
  const key = await page.locator(".admin-table tbody tr td").first().innerText();

  await page.getByRole("link", { name: /^Open row / }).first().click();

  await expect(page).toHaveURL(/\/admin\/data\/auth\/sessions\/[0-9a-f-]{36}\?/);
  // The card is the section body: the table is gone, the rail and the catalog
  // are not.
  await expect(page.locator(".admin-table")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Tables" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Administration" })).toBeVisible();
  // The key in full, and copyable — the table shortens it, the card does not.
  await expect(page.getByRole("button", { name: /^Copy [0-9a-f-]{36}$/ })).toBeVisible();
  await expect(page.getByText("ip_address", { exact: true })).toBeVisible();

  // Named "Back to …" rather than the table's name alone: the chevron is
  // aria-hidden, so the bare name sounded exactly like the card's own heading.
  await page.getByRole("link", { name: "Back to auth.sessions" }).click();

  await expect(page).toHaveURL(/page=2/);
  await expect(page).toHaveURL(/filter=revoked%3Aequals%3Afalse/);
  await expect(page.getByText("Page 2 of 2")).toBeVisible();
  await expect(page.locator(".admin-table tbody tr td").first()).toHaveText(key);
});

test("does not offer a row link where the gateway could not take one", async ({ page }) => {
  await openConsole(page);

  // audit_log is keyed by a code rather than a uuid, and the gateway parses the
  // row id as a UUID — so those rows have no address, and the console says so
  // by not linking them.
  await page.getByRole("link", { name: "audit_log", exact: true }).click();
  await expect(page.getByRole("heading", { name: "admin.audit_log" })).toBeVisible();

  await expect(page.getByRole("link", { name: /^Open row / })).toHaveCount(0);
});

// The gateway parses the row id in the path as a UUID, so this address is a 400
// there whatever the row behind it. The mock refuses it the same way, or mock
// mode would teach a card the deployed console can never open.
test("refuses a row address the gateway could not parse, instead of serving a card", async ({ page }) => {
  await openConsole(page);

  await page.goto("/admin/data/admin/audit_log/audit-001");

  await expect(page.getByRole("alert")).toContainText("would not accept this request");
  // Not "could not be reached": nothing is down, the request was read and
  // refused.
  await expect(page.getByRole("alert")).not.toContainText("could not be reached");
  await expect(page.locator(".admin-card")).toHaveCount(0);
});

// Nothing in this block is chrome. The sentence sends the reader to the
// gateway's own line for what to change, and the request id beside it is how
// the fault gets filed — so neither may sit at --fg-3, which measures 2.91:1 on
// --bg in light and is under §7's 3:1 floor even for the meta it is meant for.
// Colours are compared to each other and to the theme's own --fg-3 rather than
// to a hex, so this holds in both themes and survives a change of palette: what
// is pinned is the ranking, not the value.
test("keeps every line of a gateway failure above the meta colour", async ({ page }) => {
  await openConsole(page);

  await page.goto("/admin/data/admin/audit_log/audit-001");

  const alert = page.getByRole("alert");
  await expect(alert).toContainText("would not accept this request");
  const message = alert.locator(".admin-error-detail");
  await expect(message).toBeVisible();

  const sentenceColour = await alert.locator("p").first().evaluate((node) => getComputedStyle(node).color);
  const messageColour = await message.evaluate((node) => getComputedStyle(node).color);
  // Mock mode cannot produce the three-line version of this block at all: only
  // the REST client reads X-Request-Id off a response, so there is no seeded
  // failure and no URL that will render a request id here. Do not go looking
  // for one and conclude the code is broken — the line is put on the live
  // document to read the rule that will paint it against the deployed gateway,
  // and taken off again.
  const paleAndRequestId = await message.evaluate((node) => {
    const requestIdLine = document.createElement("p");
    requestIdLine.className = "admin-error-detail admin-request-id-line";
    node.after(requestIdLine);
    // The theme's own --fg-3, resolved by the live document rather than written
    // out as a hex, so the assertion below reads the same in dark.
    const pale = document.createElement("span");
    pale.style.color = "var(--fg-3)";
    node.append(pale);
    const read = { requestId: getComputedStyle(requestIdLine).color, pale: getComputedStyle(pale).color };
    requestIdLine.remove();
    pale.remove();
    return read;
  });

  expect(messageColour).toBe(sentenceColour);
  expect(paleAndRequestId.requestId).toBe(messageColour);
  expect(messageColour).not.toBe(paleAndRequestId.pale);
});

// The copy button on a key sits inside a row whose own hover already lifts the
// cells under it, so an opaque hover token suits at most one of the planes this
// one rule lands on: --surface-3 matches the lifted row exactly and leaves no
// delta at all on the rows whose key is most worth copying, and --surface-2
// inverts against it in dark. A translucent mix of --fg composites the right
// way over each of them, and the request id under a gateway failure carries the
// same rule on a different plane again. Values are compared to the planes they
// land on and to each other, never to a hex, so this reads the same in dark.
test("keeps a hover visible on whichever plane it lands on", async ({ page }) => {
  await openConsole(page);

  const cell = page.locator(".admin-table tbody .admin-cell-frozen").first();
  const key = cell.locator(".admin-key");
  await key.hover();

  const keyHover = await key.evaluate((node) => getComputedStyle(node).backgroundColor);
  // The row lifts under its own hover while the pointer is on the key, so this
  // is the pair that was identical — a hover that changed nothing.
  expect(keyHover).not.toBe(await cell.evaluate((node) => getComputedStyle(node).backgroundColor));
  // Translucent, which is the whole point: an opaque colour can only be a step
  // in the right direction on one plane, and this rule serves three.
  expect(keyHover).not.toMatch(/^rgb\(/);

  await page.goto("/admin/data/admin/audit_log/audit-001");
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("would not accept this request");
  // Mock mode cannot produce a request id (see the test above), so the line is
  // built on the live document to hover the rule that will carry it against the
  // deployed gateway.
  await alert.locator(".admin-error-detail").evaluate((node) => {
    const line = document.createElement("p");
    line.className = "admin-error-detail admin-request-id-line";
    const button = document.createElement("button");
    button.className = "admin-request-id";
    button.type = "button";
    button.textContent = "c85c0694-7909-4a8a";
    line.append(button);
    node.after(line);
  });
  const requestId = page.locator(".admin-request-id");
  await requestId.hover();

  // One hover for the section: the id sits on the page plane rather than on a
  // lifted row, and the rule does not have to know which.
  expect(await requestId.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe(keyHover);
});

// The value is entered with the control the column's type calls for (§5.8), and
// a timestamp is read as UTC — the same clock the column beside it prints in.
test("filters a timestamp with the picker, in the digits the column shows", async ({ page }) => {
  await openConsole(page);

  await page.getByRole("link", { name: "sessions", exact: true }).click();
  await expect(page.getByRole("heading", { name: "auth.sessions" })).toBeVisible();

  await page.getByRole("button", { name: "Filter" }).click();
  await page.getByLabel("Column", { exact: true }).selectOption("expires_at");
  await page.getByLabel("Match", { exact: true }).selectOption("from");
  // The field says which clock its digits are on, because the column does not.
  await page.getByLabel("Value UTC").fill("2026-09-10T08:00");
  await page.getByRole("button", { name: "Apply" }).click();

  // The digits typed, the digits on the chip and the digits in the address are
  // the same digits — and no `.000`.
  await expect(page.getByRole("button", { name: "expires_at from 2026-09-10T08:00:00Z" })).toBeVisible();
  await expect(page).toHaveURL(/filter=expires_at%3Afrom%3A2026-09-10T08%3A00%3A00Z/);
  await expect(page.getByText("27 rows")).toBeVisible();

  // A boolean column is a choice, not a text field, and its single legal
  // operator is stated rather than put in a dropdown that cannot change it.
  await page.getByRole("button", { name: "expires_at from 2026-09-10T08:00:00Z" }).click();
  await page.getByLabel("Column", { exact: true }).selectOption("revoked");
  await expect(page.getByLabel("Match", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Value", { exact: true }).locator("option")).toHaveText(["true", "false"]);
  // Read as one sentence, not two boxes: the flex gap between the label and the
  // answer is invisible to anything reading the text, so without an explicit
  // space in the markup this line reaches a screen reader as "Matchis".
  expect(await page.locator(".admin-filter-fixed").textContent()).toBe("Match is");
});

test("says a row is missing instead of showing the not-found screen", async ({ page }) => {
  await openConsole(page);

  await page.goto("/admin/data/auth/sessions/0f3d5cb0-0000-0000-0000-000000000000");

  await expect(page.getByText("No row with this key in auth.sessions.")).toBeVisible();
  // The address is a real one, so this is not §4.18 — and the section keeps
  // working around the message.
  await expect(page.getByRole("heading", { name: "Page not found" })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Tables" })).toBeVisible();
});

test("finds a table through the catalog search", async ({ page }) => {
  await openConsole(page);

  const catalog = page.getByRole("navigation", { name: "Tables" });
  await page.getByLabel("Search tables").fill("audit");

  await expect(catalog.getByRole("link", { name: "audit_log", exact: true })).toBeVisible();
  await expect(catalog.getByRole("link", { name: "users", exact: true })).toHaveCount(0);

  await page.getByLabel("Search tables").fill("nothing like this");
  await expect(page.getByText("Nothing matches")).toBeVisible();
});

test("stands in for a section that has no endpoints yet", async ({ page }) => {
  await openConsole(page);

  await page.getByRole("navigation", { name: "Administration" }).getByRole("link", { name: "Events" }).click();

  await expect(page).toHaveURL(/\/admin\/events$/);
  await expect(page.getByRole("heading", { name: "Events — under construction" })).toBeVisible();
  await expect(page.getByRole("link", { name: "TAS-105" })).toHaveAttribute(
    "href",
    "https://jira.ozero.dev/browse/TAS-105",
  );
});

test("a plain user cannot reach the console at all", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("anna@example.com");
  await page.getByLabel("Password").fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);

  await page.goto("/admin");

  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  // No fragment of the console leaks through the refusal.
  await expect(page.locator(".admin-table")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("$2b$10$");
});
