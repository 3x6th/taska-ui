import { expect, test, type Locator, type Page } from "@playwright/test";

// Like the other suites, this runs against MockTaskaApi
// (playwright.config.ts starts the server with VITE_TASKA_API_MODE=mock): any
// seeded user's email signs in with any password. Mark is the seed's only
// GLOBAL_ADMIN, so he is the only one who can reach this section at all.
//
// The seed carries one column per masking treatment the gateway applies
// (TAS-104), which is what makes the masking assertions here mean something:
// `auth.users.password_hash` arrives as `"***"` (MASK_FULL) and
// `recovery_email` partly starred (MASK_PARTIAL), and `auth.sessions.token_hash`
// does not arrive at all (HIDE).

async function openConsole(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("mark@example.com");
  await page.getByLabel("Password", { exact: true }).fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);

  await page.goto("/admin");
  // /admin is an area with sections now (DESIGN.md §5.8): it redirects into
  // Data, and the heading is the section's.
  await expect(page.getByRole("heading", { level: 1, name: "Data" })).toBeVisible();
  // And on into the catalog's first table, once the catalog has answered. The
  // rail is drawn before that, and a rail click in between can be undone by
  // Data's redirect (see `openUsers` in admin-users.spec.ts).
  await expect(page).toHaveURL(/\/admin\/data\/[^/]+\/[^/]+$/);
}

test("walks the catalog from a service down to a table's rows", async ({ page }) => {
  await openConsole(page);

  // Opens on something rather than an empty frame — and says so in the address.
  await expect(page).toHaveURL(/\/admin\/data\/auth\/users$/);
  await expect(page.getByRole("heading", { name: "auth.users" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "anna@example.com" })).toBeVisible();

  await page.getByRole("link", { name: "admin_audit_log", exact: true }).click();

  await expect(page).toHaveURL(/\/admin\/data\/admin\/admin_audit_log$/);
  await expect(page.getByRole("heading", { name: "admin.admin_audit_log" })).toBeVisible();
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
  // Not `$2b$10$`: the mock stopped sending a raw hash when it started masking
  // the way the gateway masks, so asserting the hash is absent now passes
  // whatever the console does. What still means something is that the masked
  // column prints nothing but the lock — the literal the server sends in its
  // place must not reach the cell either.
  await expect(page.getByRole("cell", { name: "***", exact: true })).toHaveCount(0);
  // And the partial mask is printed, which is the other half of the rule.
  await expect(page.getByRole("cell", { name: /^a\*+m$/ })).toBeVisible();

  // Settled state after a table switch. Note what this does NOT prove: the
  // transient leak that used to happen mid-switch is invisible to Playwright,
  // because `not.toContainText` polls until it holds and a leak lasting one
  // render passes trivially. That case is pinned in
  // src/screens/admin/AdminScreen.test.tsx, which can hold the request open and
  // look at the frame in between. Do not treat this assertion as covering it.
  await page.getByRole("link", { name: "admin_audit_log", exact: true }).click();
  await expect(page.getByRole("heading", { name: "admin.admin_audit_log" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("$2b$10$");
});

test("pages through a table and says where it is", async ({ page }) => {
  await openConsole(page);

  await page.getByRole("link", { name: "admin_audit_log", exact: true }).click();
  await expect(page.getByRole("heading", { name: "admin.admin_audit_log" })).toBeVisible();

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

  await page.getByRole("link", { name: "admin_audit_log", exact: true }).click();
  await expect(page.getByRole("heading", { name: "admin.admin_audit_log" })).toBeVisible();

  const firstCell = page.locator(".admin-table tbody tr td").first();
  const sortById = page.getByRole("button", { name: /^id/i });

  // Concrete ids rather than "the value changed": the header's aria-sort flips
  // from the address the instant it is clicked, while the rows come back from
  // the server a moment later, so comparing before/after can pass on stale
  // rows. The audit table's thirty ids run 5e7a0000-… to 5e7a9200-…, and the
  // key cell shows their first eight characters.
  await sortById.click();
  await expect(page.locator("th", { has: sortById })).toHaveAttribute("aria-sort", "ascending");
  await expect(firstCell).toHaveText(/^5e7a0000…/);

  await sortById.click();
  await expect(page.locator("th", { has: sortById })).toHaveAttribute("aria-sort", "descending");
  await expect(firstCell).toHaveText(/^5e7a9200…/);
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

// A uuid column's Value field shows a whole UUID as its placeholder (§5.8): the
// shape a pasted key has to take. In a 268px popover the field had 220px of
// text room against the ~240 the placeholder needs, so it was clipped mid-glyph
// at every viewport — and a real key overflowed the same way. Measured in the
// field's own computed font rather than against a number written here, at the
// project's viewport, at 390 and at 320, where the popover narrows to the
// window instead of pushing the page sideways.
test("fits a whole UUID in the filter's value field without pushing the page sideways", async ({ page }) => {
  await openConsole(page);
  await expect(page.getByRole("cell", { name: "anna@example.com" })).toBeVisible();

  // The widths below belong to DESIGN.md §2.3's UI font; on the fallback stack
  // they would be measuring something the product does not ship. The link is
  // `display=swap`, so the face can arrive after first paint — poll, and ask
  // the font set rather than `document.fonts.check` (see topbar-popovers).
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          [...document.fonts].some((face) => face.family.includes("Hanken Grotesk") && face.status === "loaded"),
        ),
      {
        message: "the UI webfont never became available, so the width below would be measuring the fallback stack",
        timeout: 10_000,
      },
    )
    .toBe(true);

  await page.getByRole("button", { name: "Filter" }).click();
  await page.getByLabel("Column", { exact: true }).selectOption("id");
  const popover = page.getByRole("dialog", { name: "Filter rows" });
  const value = popover.getByLabel("Value", { exact: true });
  await expect(value).toHaveAttribute("placeholder", "00000000-0000-0000-0000-000000000000");

  const projectWidth = page.viewportSize()?.width ?? 1440;
  for (const width of [...new Set([projectWidth, 390, 320])]) {
    await page.setViewportSize({ width, height: 844 });
    // `tk-pop` starts 7px low; the rect is read where the popover settles.
    await popover.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));

    const fit = await value.evaluate((element) => {
      const input = element as HTMLInputElement;
      const style = getComputedStyle(input);
      const context = document.createElement("canvas").getContext("2d");
      if (!context) throw new Error("no 2d canvas context to measure with");
      context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      if (style.letterSpacing !== "normal") context.letterSpacing = style.letterSpacing;
      return {
        needed: context.measureText(input.placeholder).width,
        room: input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
      };
    });
    expect(fit.needed, `UUID placeholder against the field's text room at ${width}px`).toBeLessThanOrEqual(fit.room);

    const box = await popover.boundingBox();
    expect(box, `filter popover at ${width}px`).not.toBeNull();
    expect(box!.x, `filter popover's left edge at ${width}px`).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width, `filter popover's right edge at ${width}px`).toBeLessThanOrEqual(width);

    const pageOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(pageOverflow, `horizontal page overflow at ${width}px`).toBe(0);
  }
});

// The head that carries a filter (Data, Events, Audit) wraps, and the filter
// group keeps the right edge of whatever line it lands on, no wider than the
// head — so the popover, anchored to the group's right edge and 6 below it,
// always opens inside the plane (§5.8). Before, a group that wrapped to a line
// of its own sat at that line's left and took the popover off the left of the
// screen (-209 at 320 on Events), a row of chips that could not wrap ran past
// the right edge, and a 220-capped UUID chip on Data put its remove button off
// screen at 390. The page does not scroll sideways, so each of those was
// unreachable, not merely untidy. Phone widths, so the phone project only.
const SEEDED_USER_ID = "6d774efa-57d8-4ae0-a27e-2984d1dfbbf6"; // Anna in the mock seed

test.describe("the filter group and its popover stay on the plane", () => {
  test.skip(({ isMobile }) => !isMobile, "phone widths only");

  const cases = [
    {
      name: "Events with no filter at 320",
      width: 320,
      url: "/admin/events/outbox/auth",
      opener: "Filter",
      dialog: "Filter events",
    },
    {
      name: "Events with one filter at 390",
      width: 390,
      url: "/admin/events/outbox/auth?filter=status%3Aequals%3ANEW",
      opener: "Filter",
      dialog: "Filter events",
    },
    {
      name: "Events with three filters at 390",
      width: 390,
      url:
        "/admin/events/outbox/auth?filter=status%3Aequals%3ANEW&filter=event_type%3Aequals%3AUserCreated" +
        "&filter=attempts%3Afrom%3A3",
      opener: "Filter",
      dialog: "Filter events",
    },
    {
      name: "Audit with two filters at 320",
      width: 320,
      url: "/admin/audit?filter=action%3Aequals%3ARESET_CREDENTIAL_LOCKOUT&filter=createdAt%3Afrom%3A2026-10-01",
      opener: "Filter",
      dialog: "Filter audit entries",
    },
    // Opened from the chip: with a filter applied, Data has no "+ Filter".
    {
      name: "Data with a UUID filter at 390",
      width: 390,
      url: `/admin/data/auth/users?filter=id%3Aequals%3A${SEEDED_USER_ID}`,
      opener: `id is ${SEEDED_USER_ID}`,
      dialog: "Filter rows",
    },
    {
      name: "Data with a UUID filter at 320",
      width: 320,
      url: `/admin/data/auth/users?filter=id%3Aequals%3A${SEEDED_USER_ID}`,
      opener: `id is ${SEEDED_USER_ID}`,
      dialog: "Filter rows",
    },
  ];

  for (const { name, width, url, opener, dialog } of cases) {
    test(name, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await openConsole(page);
      await page.goto(url);

      const group = page.locator(".admin-plane-head > .admin-filter");
      const head = group.locator("xpath=..");
      // The count is part of the head's first line, so the layout is final
      // only once it is there.
      await expect(head.locator(".admin-count")).toBeVisible();
      await expect(group).toBeVisible();

      const rectOf = async (locator: Locator, what: string) => {
        const rect = await locator.boundingBox();
        expect(rect, what).not.toBeNull();
        return rect!;
      };
      const pageOverflow = () =>
        page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

      const headRect = await rectOf(head, "the plane head");
      const groupRect = await rectOf(group, "the filter group");
      // Half a pixel for subpixel layout; the defect was hundreds of pixels.
      expect(groupRect.x + groupRect.width, "the filter group's right edge against the head's").toBeLessThanOrEqual(
        headRect.x + headRect.width + 0.5,
      );
      for (const remove of await group.locator(".admin-filter-chip-remove").all()) {
        const removeRect = await rectOf(remove, "a chip's remove button");
        expect(removeRect.x, "a chip's remove button, left edge").toBeGreaterThanOrEqual(0);
        expect(removeRect.x + removeRect.width, "a chip's remove button, right edge").toBeLessThanOrEqual(width);
      }
      expect(await pageOverflow(), "horizontal page overflow with the popover closed").toBe(0);

      await page.getByRole("button", { name: opener, exact: true }).click();
      const popover = page.getByRole("dialog", { name: dialog });
      await expect(popover).toBeVisible();
      // `tk-pop` starts 7px low; the rect is read where the popover settles.
      await popover.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));

      const popoverRect = await rectOf(popover, "the filter popover");
      expect(popoverRect.x, "the filter popover's left edge").toBeGreaterThanOrEqual(0);
      expect(popoverRect.x + popoverRect.width, "the filter popover's right edge").toBeLessThanOrEqual(width);
      // Below the whole group, not over its second row of chips.
      const openGroupRect = await rectOf(group, "the filter group with the popover open");
      expect(popoverRect.y, "the filter popover's top against the group's bottom").toBeGreaterThanOrEqual(
        openGroupRect.y + openGroupRect.height,
      );
      expect(await pageOverflow(), "horizontal page overflow with the popover open").toBe(0);
    });
  }
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

// No case here for a table whose rows cannot be linked: every table on the
// stand is keyed by a uuid, so the mock seeds none, and that branch is pinned on
// a made-up table in src/screens/admin/AdminScreen.test.tsx.

// The gateway parses the row id in the path as a UUID, so this hand-typed
// address is a 400 there whatever the table. The mock refuses it the same way,
// or mock mode would teach a card the deployed console can never open.
test("refuses a row address the gateway could not parse, instead of serving a card", async ({ page }) => {
  await openConsole(page);

  await page.goto("/admin/data/admin/admin_audit_log/audit-001");

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

  await page.goto("/admin/data/admin/admin_audit_log/audit-001");

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
    // The line keeps this block's own type (.admin-error-detail); the affordance
    // inside it is shared with the board, so its classes carry no screen name.
    requestIdLine.className = "admin-error-detail";
    requestIdLine.append(Object.assign(document.createElement("span"), { className: "request-id-line" }));
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

  await page.goto("/admin/data/admin/admin_audit_log/audit-001");
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("would not accept this request");
  // Mock mode cannot produce a request id (see the test above), so the line is
  // built on the live document to hover the rule that will carry it against the
  // deployed gateway.
  await alert.locator(".admin-error-detail").evaluate((node) => {
    const line = document.createElement("p");
    line.className = "admin-error-detail";
    const wrap = document.createElement("span");
    wrap.className = "request-id-line";
    const button = document.createElement("button");
    button.className = "request-id";
    button.type = "button";
    button.textContent = "c85c0694-7909-4a8a";
    wrap.append(button);
    line.append(wrap);
    node.after(line);
  });
  const requestId = page.locator(".request-id");
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

  await expect(catalog.getByRole("link", { name: "admin_audit_log", exact: true })).toBeVisible();
  await expect(catalog.getByRole("link", { name: "users", exact: true })).toHaveCount(0);

  await page.getByLabel("Search tables").fill("nothing like this");
  await expect(page.getByText("Nothing matches")).toBeVisible();
});

// Audit was the last placeholder (§4.19) and stopped being one with TAS-251:
// it reads its own log and says for itself when the gateway does not serve it.
// The placeholder must be gone rather than merely unreachable.
test("no longer stands in for Audit, the last section that had no endpoints", async ({ page }) => {
  await openConsole(page);

  await page.getByRole("navigation", { name: "Administration" }).getByRole("link", { name: "Audit" }).click();

  await expect(page).toHaveURL(/\/admin\/audit$/);
  await expect(page.getByRole("table", { name: "Audit entries" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /under construction/ })).toHaveCount(0);
});

test("a plain user cannot reach the console at all", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("anna@example.com");
  await page.getByLabel("Password", { exact: true }).fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);

  await page.goto("/admin");

  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  // No fragment of the console leaks through the refusal.
  await expect(page.locator(".admin-table")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("$2b$10$");
});
