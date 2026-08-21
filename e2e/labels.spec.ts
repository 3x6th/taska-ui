import { expect, test, type Locator, type Page } from "@playwright/test";

// Mock-backed like every spec here (playwright.config.ts starts the server with
// VITE_TASKA_API_MODE=mock): any seeded user signs in with any password, and
// the seed ships project labels so both the picker and the chips have something
// to show on first load — TAS-101 carries "backend" and "tech-debt", TAS-104
// carries none, and MOB-5 carries "ios" in a project Anna is not a member of,
// which is how the read-only view is reached below.
//
// What this file is NOT: a statement about the gateway. Every rule it leans on
// — a name unique per project, a soft delete that reaches every issue, the
// `labelId` filter — is `MockTaskaStore` reading TAS-119 and TAS-120, not
// observed behaviour (docs/ai/API-DIVERGENCE.md). Read these as pinning what
// the UI does, never as evidence that the deployed gateway does the same.

const MOBILE_PROJECT_ID = "f315c5cf-3333-47d1-8d22-79f07c2ec99b";

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("anna@example.com");
  await page.getByLabel("Password").fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);
}

async function openBoard(page: Page) {
  await signIn(page);
  await page.getByRole("button", { name: /Taska Platform/ }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/board$/);
}

async function openIssuePanel(page: Page, issueKey: string): Promise<Locator> {
  await openBoard(page);
  await page.locator(".issue-card", { hasText: issueKey }).click();
  await expect(page.getByRole("complementary", { name: `${issueKey} issue` })).toBeVisible();
  return page.locator(".issue-labels");
}

test("shows the labels an issue carries, on its card and on its panel", async ({ page }) => {
  await openBoard(page);

  // The card draws `issue.labels` from the list read; the panel reads the
  // issue's own label route. Both have to agree, which is the point of
  // asserting the same label in both places.
  const card = page.locator(".issue-card", { hasText: "TAS-101" });
  await expect(card.locator(".label-chip", { hasText: "backend" })).toBeVisible();

  await card.click();
  const labels = page.locator(".issue-labels");
  await expect(labels.getByRole("heading", { name: /Labels/ })).toBeVisible();
  await expect(labels.locator(".label-chip", { hasText: "backend" })).toBeVisible();
  await expect(labels.locator(".label-chip", { hasText: "tech-debt" })).toBeVisible();
});

test("adds a label to an issue, sees the card follow, then takes it off again", async ({ page }) => {
  const labels = await openIssuePanel(page, "TAS-104");

  // A successful empty answer says so; it is not left blank.
  await expect(labels.getByText("No labels yet")).toBeVisible();

  const picker = labels.locator("select");
  const option = picker.locator("option", { hasText: "frontend" });
  const value = await option.getAttribute("value");
  expect(value).toBeTruthy();
  await picker.selectOption(value ?? "");
  await labels.getByRole("button", { name: "Add", exact: true }).click();

  await expect(labels.locator(".label-chip", { hasText: "frontend" })).toBeVisible();
  // A label already on the issue is not offered again.
  await expect(picker.locator("option", { hasText: "frontend" })).toHaveCount(0);

  // The board behind the panel is invalidated by the same write, so the card
  // gains the chip without a reload.
  await page.getByRole("button", { name: "Close", exact: true }).click();
  const card = page.locator(".issue-card", { hasText: "TAS-104" });
  await expect(card.locator(".label-chip", { hasText: "frontend" })).toBeVisible();

  await card.click();
  await page.locator(".issue-labels").getByRole("button", { name: "Remove label frontend" }).click();
  await expect(page.locator(".issue-labels .label-chip", { hasText: "frontend" })).toHaveCount(0);

  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(card.locator(".label-chip", { hasText: "frontend" })).toHaveCount(0);
});

test("filters the board down to one label and back", async ({ page }) => {
  await openBoard(page);

  const counter = page.locator(".counter");
  // Read it only once the issues query has answered: while it is pending the
  // counter says "loading of loading", and capturing that would compare the
  // cleared board against a state it is never going back to.
  await expect(counter).toHaveText(/^\d+ of \d+$/);
  const before = await counter.textContent();

  const filter = page.locator(".filter-select select");
  await filter.selectOption({ label: "needs-design" });

  // The server applies this one (`labelId`), so the board is re-read rather
  // than re-filtered: every card left has to carry the label.
  await expect(page.locator(".issue-card")).toHaveCount(1);
  await expect(page.locator(".issue-card", { hasText: "TAS-103" })).toBeVisible();

  await page.getByRole("button", { name: /Clear/ }).click();
  await expect(counter).toHaveText(before ?? "");
});

test("keeps an issue's links whole while the board is filtered by label", async ({ page }) => {
  // The regression this pins: the board's issue page is keyed by the label
  // filter and read from the server, so a panel that borrowed that page let a
  // board filter decide which issues could be linked to, and turned every link
  // pointing outside the filter into a bare id. The links section reads the
  // project unfiltered instead.
  await openBoard(page);

  const filter = page.locator(".filter-select select");
  await filter.selectOption({ label: "backend" });
  // Two issues carry it, so the page behind the panel holds two of the ten.
  await expect(page.locator(".issue-card")).toHaveCount(2);

  await page.locator(".issue-card", { hasText: "TAS-101" }).click();
  await expect(page.getByRole("complementary", { name: "TAS-101 issue" })).toBeVisible();

  const links = page.locator(".issue-links");
  // Neither seeded target carries "backend" — TAS-102 carries "frontend",
  // TAS-110 carries "tech-debt" — and both still read as issues.
  await expect(links.getByRole("button", { name: /Blocks TAS-102/ })).toBeVisible();
  await expect(links.getByRole("button", { name: /Is duplicated by TAS-110/ })).toBeVisible();
  // The unresolved form is a real state (an issue beyond the page), so the
  // rows above are not enough on their own: nothing here may be in it.
  await expect(links.locator(".issue-key.is-unresolved")).toHaveCount(0);

  // And what may be linked to is still the project, not the filter.
  const picker = links.locator("select");
  await expect(picker.locator("option", { hasText: "TAS-103" })).toHaveCount(1);
  await expect(picker.locator("option", { hasText: "TAS-104" })).toHaveCount(1);
  // Seven of the project's ten: the issue itself and its two existing targets
  // are not offered. The eighth option is the "Select an issue" placeholder.
  await expect(picker.locator("option")).toHaveCount(8);

  // The filter itself is untouched by any of this — it is the columns' filter
  // and it is correct there.
  await expect(filter).not.toHaveValue("ALL");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.locator(".issue-card")).toHaveCount(2);
});

test("creates a project label, renames it, and deletes it", async ({ page }) => {
  await openBoard(page);

  await page.getByRole("button", { name: "Manage labels" }).click();
  const modal = page.getByRole("dialog", { name: "Labels" });
  await expect(modal).toBeVisible();

  await modal.getByLabel("New label").fill("release-blocker");
  await modal.getByRole("button", { name: "Add label" }).click();
  await expect(modal.locator(".label-chip", { hasText: "release-blocker" })).toBeVisible();

  // The optimistic row carries a placeholder id and offers no controls until
  // the server has answered; waiting for the edit control to come alive is what
  // separates "the cache was written" from "the label exists".
  const editButton = modal.getByRole("button", { name: "Edit release-blocker" });
  await expect(editButton).toBeEnabled();
  await editButton.click();

  const rename = modal.getByLabel("Rename release-blocker");
  await rename.fill("ship-blocker");
  await modal.getByRole("button", { name: "Save label" }).click();
  await expect(modal.locator(".label-chip", { hasText: "ship-blocker" })).toBeVisible();

  // The new label reaches the issue picker, which is the only reason a project
  // label exists at all.
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.locator(".issue-card", { hasText: "TAS-104" }).click();
  await expect(
    page.locator(".issue-labels select").locator("option", { hasText: "ship-blocker" }),
  ).toHaveCount(1);

  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Manage labels" }).click();
  await page.getByRole("dialog", { name: "Labels" }).getByRole("button", { name: "Delete ship-blocker" }).click();
  await expect(page.locator(".label-manage-row", { hasText: "ship-blocker" })).toHaveCount(0);
});

test("a viewer reads the labels and is offered no way to change them", async ({ page }) => {
  // Anna is not a member of the Mobile project, so the mock answers VIEWER for
  // it. The board is reachable by URL, which is the point: hiding the controls
  // is a UI courtesy and the server stays the authority.
  await signIn(page);
  await page.goto(`/projects/${MOBILE_PROJECT_ID}/board`);

  // Reading is a VIEWER's right (TAS-119), so the filter and the chips stay.
  await expect(page.locator(".filter-select select")).toBeVisible();
  await expect(page.getByRole("button", { name: "Manage labels" })).toHaveCount(0);

  await page.locator(".issue-card", { hasText: "MOB-5" }).click();
  const labels = page.locator(".issue-labels");
  await expect(labels.locator(".label-chip", { hasText: "ios" })).toBeVisible();
  await expect(labels.locator("select")).toHaveCount(0);
  await expect(labels.getByRole("button", { name: "Add", exact: true })).toHaveCount(0);
  await expect(labels.getByRole("button", { name: /^Remove label/ })).toHaveCount(0);
});

/**
 * The remove control's hit area and the row gap are one coupled fact, and this
 * test exists because that coupling was got wrong twice inside a single review
 * cycle: first as a symmetric 25px box that never reached DESIGN.md §1's 28
 * floor, then as a 28px box left in a 6px row gap, where two stacked controls
 * overlapped by 2px and — no `z-index` anywhere — the later sibling took the
 * shared band, so a tap aimed at one row detached the label on the row below.
 * Destructive, unconfirmed, no undo. Both times the only thing that caught it
 * was a hand-driven browser probe, and nothing in this suite would have
 * noticed someone collapsing `column-gap`/`row-gap` back into one `gap`.
 *
 * The sentence whose absence caused both failures: a 28×28 target on a 20px
 * chip has to grow 4px above and below it, two of those extensions share one
 * row gap, so a row gap under 8 cannot satisfy §1 no matter what the inset
 * says. The inset and the gap can only be read together, which is why this
 * asserts the geometry they produce rather than either number.
 *
 * Driving five adds in a row is what turned up the picker reset this branch
 * carried — a selection made while an add was in flight was thrown away
 * silently. That is fixed, and pinned by the test below this one; the wait
 * inside the loop here stays regardless, because the board card gaining the
 * chip is the honest signal that the write landed, and the optimistic chip in
 * the panel is not.
 *
 * Tolerance. Chromium resolves a point hit test as a 1×1px rect, so at any
 * shared edge the lower box starts winning ~0.95px before its own top — on two
 * bare divs with no gap and no pseudo-elements too. That is an engine constant
 * the whole product carries, not this rule's business, so the sweep below
 * ignores the last pixel of each box. A test that goes red on a browser
 * constant is worse than no test.
 */
const ENGINE_POINT_BAND = 1;
const FLOAT_SLACK = 0.01;
const MIN_TARGET = 28;

test("a wrapped label row keeps every remove control clear of the rows around it", async ({ page }) => {
  await openBoard(page);

  // TAS-101 seeds two labels on one row, so the wrapped case does not exist
  // until it is built. Three more on top of the four the project seeds is seven
  // chips, which is the fewest that wraps on every viewport this suite runs,
  // the widest included — and the panel is the only place a chip carries a
  // remove control at all, so this is the only place the geometry can be read.
  await page.getByRole("button", { name: "Manage labels" }).click();
  const modal = page.getByRole("dialog", { name: "Labels" });
  const guards = ["wrap-guard-a", "wrap-guard-b", "wrap-guard-c"];
  for (const guard of guards) {
    await modal.getByLabel("New label").fill(guard);
    await modal.getByRole("button", { name: "Add label" }).click();
    // The optimistic row carries a placeholder id; an enabled edit control is
    // what says the server answered and the next name may be typed.
    await expect(modal.getByRole("button", { name: `Edit ${guard}` })).toBeEnabled();
    await expect(modal.getByLabel("New label")).toHaveValue("");
  }
  await page.getByRole("button", { name: "Close", exact: true }).click();

  const card = page.locator(".issue-card", { hasText: "TAS-101" });
  await card.click();
  const labels = page.locator(".issue-labels");
  await expect(labels).toBeVisible();
  for (const name of ["frontend", "needs-design", ...guards]) {
    await labels.locator("select").selectOption({ label: name });
    await labels.getByRole("button", { name: "Add", exact: true }).click();
    await expect(labels.getByRole("button", { name: `Remove label ${name}` })).toBeVisible();
    // The panel's chip is optimistic and says nothing about the write landing.
    // The card behind the panel gains it only once the add settled and the
    // board re-read, which is what this waits for: measuring geometry against
    // chips the server has not confirmed would be measuring a guess.
    await expect(card.locator(".label-chip", { hasText: name })).toBeAttached();
  }
  await expect(labels.getByRole("button", { name: /^Remove label/ })).toHaveCount(7);

  const probe = await page.evaluate(
    ({ band }) => {
      const row = document.querySelector(".label-chip-row");
      if (!row) return null;

      // The clickable box is the `::after` extension rather than the drawn
      // button, so it is read from the pseudo-element's own computed insets —
      // this test must not carry a second copy of the numbers it is checking.
      const controls = [...row.querySelectorAll(".label-chip-remove")].map((button) => {
        const box = button.getBoundingClientRect();
        const after = getComputedStyle(button, "::after");
        const chip = button.closest(".label-chip");
        return {
          name: chip?.querySelector(".label-chip-name")?.textContent ?? "?",
          hit: {
            top: box.top + parseFloat(after.top),
            bottom: box.bottom - parseFloat(after.bottom),
            left: box.left + parseFloat(after.left),
            right: box.right - parseFloat(after.right),
          },
        };
      });

      const byTop = new Map<number, typeof controls>();
      for (const control of controls) {
        const key = Math.round(control.hit.top);
        const bucket = byTop.get(key);
        if (bucket) bucket.push(control);
        else byTop.set(key, [control]);
      }
      const rows = [...byTop.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, items]) => items.sort((a, b) => a.hit.left - b.hit.left));

      const rowIndexAt = (y: number) => rows.findIndex((items) => y >= items[0].hit.top && y < items[0].hit.bottom);

      const boundaries = rows.slice(0, -1).map((items, index) => ({
        rows: `${index + 1}|${index + 2}`,
        overlap: items[0].hit.bottom - rows[index + 1][0].hit.top,
      }));

      const exclusive = rows.map((items, index) => {
        const above = index > 0 ? rows[index - 1][0].hit.bottom : -Infinity;
        const below = index < rows.length - 1 ? rows[index + 1][0].hit.top : Infinity;
        return {
          row: index + 1,
          height: Math.min(items[0].hit.bottom, below) - Math.max(items[0].hit.top, above),
        };
      });

      // Walk the band around each boundary across the whole width of the row,
      // and record every point that sits inside one row's control but answers
      // with a control belonging to another row. A point answering with no
      // control at all is the space between two chips, and is not a wrong
      // target — only a control stealing another row's area is.
      const bounds = row.getBoundingClientRect();
      const sweeps = rows.slice(0, -1).map((upper, index) => {
        const lower = rows[index + 1];
        const wrong: { x: number; y: number; expected: string; got: string }[] = [];
        let probed = 0;
        for (let x = bounds.left + 1; x < bounds.right; x += 3) {
          for (let y = upper[0].hit.bottom - 5; y <= lower[0].hit.top + 5; y += 0.25) {
            const owner = rowIndexAt(y);
            if (owner < 0) continue;
            // The last pixel of a box belongs to the engine, not to this rule.
            if (y >= rows[owner][0].hit.bottom - band) continue;
            const chip = document.elementFromPoint(x, y)?.closest(".label-chip-remove")?.closest(".label-chip");
            if (!chip) continue;
            probed += 1;
            const got = rowIndexAt(chip.getBoundingClientRect().top + 4);
            if (got !== owner && wrong.length < 5) {
              wrong.push({
                x: +x.toFixed(2),
                y: +y.toFixed(2),
                expected: `row ${owner + 1}`,
                got: `row ${got + 1} "${chip.querySelector(".label-chip-name")?.textContent ?? "?"}"`,
              });
            }
          }
        }
        return { rows: `${index + 1}|${index + 2}`, probed, wrong };
      });

      return {
        rowCount: rows.length,
        sizes: controls.map((c) => ({
          name: c.name,
          width: +(c.hit.right - c.hit.left).toFixed(2),
          height: +(c.hit.bottom - c.hit.top).toFixed(2),
        })),
        boundaries,
        exclusive,
        sweeps,
      };
    },
    { band: ENGINE_POINT_BAND },
  );

  expect(probe, "the panel rendered no label chip row to measure").not.toBeNull();
  if (!probe) return;

  // Without a wrap there is nothing here to prove, so a layout change that
  // stopped wrapping must fail loudly rather than pass an empty test.
  expect(probe.rowCount, "the chip row did not wrap, so nothing was measured").toBeGreaterThan(1);

  for (const size of probe.sizes) {
    expect(size.width, `remove control for "${size.name}" is narrower than §1's floor`).toBeGreaterThanOrEqual(
      MIN_TARGET - FLOAT_SLACK,
    );
    expect(size.height, `remove control for "${size.name}" is shorter than §1's floor`).toBeGreaterThanOrEqual(
      MIN_TARGET - FLOAT_SLACK,
    );
  }

  // The regression itself: two stacked controls sharing any area at all means
  // one row's tap detaches the other row's label.
  for (const boundary of probe.boundaries) {
    expect(
      boundary.overlap,
      `remove controls on rows ${boundary.rows} overlap by ${boundary.overlap.toFixed(2)}px`,
    ).toBeLessThanOrEqual(FLOAT_SLACK);
  }

  // And the floor survives the wrap: a middle row measured 24px at the row gap
  // this replaced, which is below both §1's 28 and the 25 that preceded it.
  for (const row of probe.exclusive) {
    expect(
      row.height,
      `row ${row.row} keeps only ${row.height.toFixed(2)}px of height no other row's control claims`,
    ).toBeGreaterThanOrEqual(MIN_TARGET - FLOAT_SLACK);
  }

  expect(probe.sweeps.length, "the row did not wrap, so no boundary was walked").toBeGreaterThan(0);
  for (const sweep of probe.sweeps) {
    expect(sweep.probed, `no control was under the probe around rows ${sweep.rows}`).toBeGreaterThan(0);
    expect(
      sweep.wrong,
      `around rows ${sweep.rows}, points inside one row's control answered with another row's`,
    ).toEqual([]);
  }
});

/**
 * A label chosen while the previous add is still in flight used to be thrown
 * away without a word. `addLabel` reset the picker in `onSuccess`, a round trip
 * after the user pressed Add — and by then the reset had nothing left to do,
 * because the option for the label just added leaves the picker the moment the
 * optimistic list includes it and the browser drops the selection itself. All
 * the late reset could still hit was a choice made in the meantime. The symptom
 * was the worst kind: the selection vanished, the Add button went dead because
 * `picked` was empty again, and nothing on screen said why — a failure
 * indistinguishable from nothing happening. Against the mock the window is the
 * seeded 140ms; against the gateway it is a full round trip.
 *
 * Both halves of the window are driven from one task below, so the add cannot
 * settle between pressing Add and choosing again. That is the point being
 * pinned — the interleaving, not the way the events are produced — and leaving
 * it to two round-trips of Playwright timing would make this a test of how fast
 * the machine is.
 *
 * `IssueLinksSection` carried the identical shape with its own picker and is
 * fixed in the same commit; this pins the labels half, which is the one this
 * story owns.
 */
test("keeps a label chosen while the previous add is still in flight", async ({ page }) => {
  const labels = await openIssuePanel(page, "TAS-104");
  const picker = labels.locator("select");
  const addButton = labels.getByRole("button", { name: "Add", exact: true });

  const second = await picker.locator("option", { hasText: "frontend" }).getAttribute("value");
  expect(second).toBeTruthy();

  await picker.selectOption({ label: "backend" });
  await page.evaluate((next) => {
    const add = [...document.querySelectorAll<HTMLButtonElement>(".issue-labels button")].find(
      (button) => button.textContent?.trim() === "Add",
    );
    const select = document.querySelector<HTMLSelectElement>(".issue-labels select");
    add?.click();
    if (select) {
      select.value = next;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, second ?? "");

  // Let the first add land: the card behind the panel gains its chip only once
  // the write settled and the board re-read, so this is past the window.
  const card = page.locator(".issue-card", { hasText: "TAS-104" });
  await expect(card.locator(".label-chip", { hasText: "backend" })).toBeAttached();

  // The second choice is still there, and still submittable.
  await expect(picker).toHaveValue(second ?? "");
  await expect(addButton).toBeEnabled();
  await addButton.click();
  await expect(labels.getByRole("button", { name: "Remove label frontend" })).toBeVisible();
  await expect(card.locator(".label-chip", { hasText: "frontend" })).toBeAttached();
});
