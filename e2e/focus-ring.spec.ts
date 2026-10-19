import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * One focus ring for the whole product (DESIGN.md §4.1, §7; TAS-299).
 *
 * A Tab walk and a Shift+Tab walk over every screen the product has, in both
 * themes, at 1440. At every stop:
 *
 * - never the browser's own ring — `outline-style: auto` is Chrome drawing in
 *   the reader's system accent, outside §2 altogether;
 * - one of the four indicators §7 allows: a `solid 2px` outline in the
 *   computed `--accent`; an editable text field's border in `--accent` (§4.3);
 *   a `.search-box` ancestor ringed by `:focus-within`; or `.user-profile-logout`,
 *   whose `--danger` ring §7 records;
 * - the ring, inflated by its offset and width, inside every ancestor that
 *   clips (`overflow` other than `visible`), to half a pixel. A ring only
 *   scrolled out of view is not a clipped one, so a stop that fails is
 *   centred in its scroller and measured again before it counts.
 *
 * A walk ends when focus comes back to where it began or leaves the part of the
 * screen under test — a dialog, a popover, the issue panel.
 *
 * Mock-backed like every spec here (playwright.config.ts): any seeded user signs
 * in with any password. Anna is the ADMIN of Taska Platform and Tom its VIEWER;
 * Mark is the seed's GLOBAL_ADMIN. Run on the laptop project only: the viewport
 * is the ruling's 1440, and the rule under test does not depend on it.
 */

type Theme = "light" | "dark";

interface Stop {
  /** What the stop is, for a reader of a failure. */
  label: string;
  /** What identifies the stop between presses, so a walk knows it has come round. */
  key: string;
  inside: boolean;
  /** Whether the browser counts this focus as keyboard focus, which is when a ring is owed. */
  focusVisible: boolean;
  problem: string | null;
}

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);
  // The cards, not their skeletons: a walk over a loading page measures less.
  await expect(page.locator(".project-card", { hasText: "Taska Platform" })).toBeVisible();
}

async function openBoard(page: Page) {
  await page.locator(".project-card", { hasText: "Taska Platform" }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/board$/);
  // Real cards, not `.skeleton-card`s, and the project's context answered —
  // the label picker is enabled once it has — so the walk meets the board as
  // it stays, with every control the role is given.
  await expect(page.locator("button.issue-card").first()).toBeVisible();
  await expect(page.locator(".filter-select select")).toBeEnabled();
}

async function openPanel(page: Page, issueKey: string): Promise<Locator> {
  await page.locator(".issue-card", { hasText: issueKey }).click();
  const panel = page.getByRole("complementary", { name: `${issueKey} issue` });
  await expect(panel).toBeVisible();
  // Every section's read has landed, so the walk meets the panel as it stays.
  await expect(panel.getByText("Loading comments")).toHaveCount(0);
  return panel;
}

/** Opens a control from the keyboard, so focus that follows is keyboard focus. */
async function pressOpen(page: Page, trigger: Locator) {
  await trigger.focus();
  await page.keyboard.press("Enter");
}

/**
 * The stop focus is on, judged against §7 in the page. `scope` is the part of
 * the screen under test, or `null` for the whole page.
 */
async function inspect(page: Page, scope: string | null): Promise<Stop | null> {
  return page.evaluate((scopeSelector) => {
    const element = document.activeElement as HTMLElement | null;
    if (!element || element === document.body || element === document.documentElement) return null;

    const resolve = (value: string) => {
      const probe = document.createElement("span");
      probe.style.color = value;
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    };
    const accent = resolve("var(--accent)");
    const danger = resolve("var(--danger)");
    const name = (element.getAttribute("aria-label") ?? element.textContent ?? element.getAttribute("placeholder") ?? "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 48);
    const label = `${element.tagName.toLowerCase()}${[...element.classList].map((name) => `.${name}`).join("")} "${name}"`;
    const container = scopeSelector ? document.querySelector(scopeSelector) : document.body;
    const inside = Boolean(container?.contains(element));

    const style = getComputedStyle(element);
    const ringed = (target: HTMLElement, color: string) => {
      const own = getComputedStyle(target);
      return own.outlineStyle === "solid" && own.outlineWidth === "2px" && own.outlineColor === color;
    };
    const editable =
      (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) && element.matches(":read-write");
    const box = element.closest<HTMLElement>(".search-box");

    let problem: string | null = null;
    let ringOwner: HTMLElement | null = null;
    if (style.outlineStyle === "auto") {
      problem = `the browser's own ring (outline: auto ${style.outlineColor})`;
    } else if (ringed(element, accent)) {
      ringOwner = element;
    } else if (element.matches(".user-profile-logout") && ringed(element, danger)) {
      ringOwner = element;
    } else if (box && ringed(box, accent)) {
      ringOwner = box;
    } else if (editable && style.borderTopColor === accent) {
      ringOwner = null;
    } else {
      problem = `no ring: outline ${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}, border ${style.borderTopColor}`;
    }

    // Clipping: the ring, inflated by offset and width, inside every clipping
    // ancestor's box (0.5px tolerance).
    const clipOf = (owner: HTMLElement) => {
      const own = getComputedStyle(owner);
      const reach = Math.max(0, parseFloat(own.outlineOffset) + parseFloat(own.outlineWidth));
      const rect = owner.getBoundingClientRect();
      for (let ancestor = owner.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const clip = getComputedStyle(ancestor);
        if (clip.overflowX === "visible" && clip.overflowY === "visible") continue;
        const edge = ancestor.getBoundingClientRect();
        const cut = [
          edge.left - (rect.left - reach),
          edge.top - (rect.top - reach),
          rect.right + reach - edge.right,
          rect.bottom + reach - edge.bottom,
        ];
        if (cut.some((amount) => amount > 0.5)) {
          const where = ancestor.className || ancestor.tagName.toLowerCase();
          return `ring clipped by ${where} (${cut.map((amount) => amount.toFixed(1)).join(" / ")} past left / top / right / bottom)`;
        }
      }
      return null;
    };
    if (!problem && ringOwner) {
      problem = clipOf(ringOwner);
      if (problem) {
        // Scrolled out is not clipped: centred in its scrollers, a ring that
        // still does not fit is one the layout cuts.
        ringOwner.scrollIntoView({ block: "center", inline: "center" });
        problem = clipOf(ringOwner);
      }
    }

    // An identity that survives a scroller moving under it, which a position
    // would not: the walk knows it has come round by this.
    const registry = window as unknown as { tabWalkIds?: WeakMap<Element, string>; tabWalkNext?: number };
    registry.tabWalkIds ??= new WeakMap();
    let key = registry.tabWalkIds.get(element);
    if (key === undefined) {
      registry.tabWalkNext = (registry.tabWalkNext ?? 0) + 1;
      key = String(registry.tabWalkNext);
      registry.tabWalkIds.set(element, key);
    }
    return { label, key, inside, focusVisible: element.matches(":focus-visible"), problem };
  }, scope);
}

/**
 * Walks with Tab or Shift+Tab and returns every stop that broke §7. Starts from
 * `from` when given — focused from script, then counted only once focus has
 * come back to it by key — or from the page itself. `scope` bounds the walk:
 * it ends when focus leaves it, or comes round to the first stop again.
 */
async function walk(
  page: Page,
  { scope = null, from, back = false, max = 160 }: { scope?: string | null; from?: Locator; back?: boolean; max?: number },
) {
  const seen = new Set<string>();
  const failures: string[] = [];
  const count = (stop: Stop) => {
    seen.add(stop.key);
    if (stop.problem) failures.push(`${stop.label}: ${stop.problem}`);
  };
  let startKey: string | undefined;
  let entered = false;
  if (from) {
    await from.focus();
    const start = await inspect(page, scope);
    startKey = start?.key;
    // Counted now only if the browser already treats it as keyboard focus — a
    // text field always is; otherwise when the walk comes back round to it.
    if (start?.inside && start.focusVisible) {
      count(start);
      entered = true;
    }
  } else {
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  }
  let previous = startKey;
  for (let step = 0; step < max; step += 1) {
    await page.keyboard.press(back ? "Shift+Tab" : "Tab");
    const stop = await inspect(page, scope);
    if (!stop) {
      if (entered && scope) break;
      continue;
    }
    if (!stop.inside) {
      if (entered) break;
      continue;
    }
    entered = true;
    // Tab inside one control — a date field's day, month and year — is one
    // stop, judged as focus lands on it.
    if (stop.key === previous) continue;
    previous = stop.key;
    if (seen.has(stop.key)) break;
    count(stop);
    if (stop.key === startKey) break;
  }
  return { stops: seen.size, failures };
}

/**
 * Both walks over one part of a screen, with the stop count kept as evidence.
 * `reopen` puts a popover back between the two, for one that closes when Tab
 * leaves it (§4.23's Share).
 */
async function walkBoth(
  page: Page,
  name: string,
  options: {
    scope?: string | null;
    first?: () => Locator;
    last?: () => Locator;
    max?: number;
    reopen?: () => Promise<void>;
  } = {},
) {
  const forward = await walk(page, { scope: options.scope, from: options.first?.(), max: options.max });
  await options.reopen?.();
  const backward = await walk(page, { scope: options.scope, from: options.last?.(), back: true, max: options.max });
  test.info().annotations.push({
    type: "tab-walk",
    description: `${name}: ${forward.stops} stops by Tab, ${backward.stops} by Shift+Tab`,
  });
  expect(forward.stops, `${name}: the Tab walk found nothing to stop on`).toBeGreaterThan(0);
  expect(backward.stops, `${name}: the Shift+Tab walk found nothing to stop on`).toBeGreaterThan(0);
  expect([...new Set([...forward.failures, ...backward.failures])], name).toEqual([]);
}

/** The first and last Tab stop inside `scope`, as the browser orders them. */
const firstIn = (page: Page, scope: string) => page.locator(scope).locator(TABBABLE).first();
const lastIn = (page: Page, scope: string) => page.locator(scope).locator(TABBABLE).last();
const TABBABLE = [
  "a[href]",
  "button:not(:disabled):not([tabindex='-1'])",
  "input:not(:disabled):not([type='hidden']):not([tabindex='-1'])",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  "summary",
  "[tabindex='0']",
]
  .map((selector) => `${selector}:visible`)
  .join(", ");

for (const theme of ["light", "dark"] as Theme[]) {
  test.describe(`the focus ring, ${theme}`, () => {
    test.beforeEach(async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "laptop", "the ruling's 1440; the ring does not depend on the viewport");
      await page.addInitScript((value) => window.localStorage.setItem("taska.theme", value), theme);
    });

    test("sign in and accept invite", async ({ page }) => {
      await page.goto("/login");
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await walkBoth(page, "/login, Sign in");
      await page.getByRole("button", { name: "Accept invite" }).click();
      await walkBoth(page, "/login, Accept invite");
    });

    test("projects, the profile menu, notifications and the global search", async ({ page }) => {
      await signIn(page, "anna@example.com");
      await walkBoth(page, "/projects");

      await pressOpen(page, page.locator(".user-profile-trigger"));
      await expect(page.locator(".user-profile-popover")).toBeVisible();
      await walkBoth(page, "profile menu", {
        scope: ".user-profile-popover",
        first: () => firstIn(page, ".user-profile-popover"),
        last: () => lastIn(page, ".user-profile-popover"),
      });
      await page.keyboard.press("Escape");

      await pressOpen(page, page.getByRole("button", { name: /^Notifications/ }));
      await expect(page.locator(".notifications-popover")).toBeVisible();
      await walkBoth(page, "notifications", {
        scope: ".notifications-popover",
        first: () => firstIn(page, ".notifications-popover"),
        last: () => lastIn(page, ".notifications-popover"),
      });
      await page.keyboard.press("Escape");

      const search = page.getByRole("combobox", { name: "Search issues in every project" });
      await search.focus();
      await page.keyboard.type("gateway");
      await expect(page.getByRole("listbox", { name: "Issue search results" })).toBeVisible();
      await walkBoth(page, "global search", {
        scope: ".topbar .search-box",
        first: () => search,
        last: () => search,
        max: 8,
      });
    });

    test("the board as an ADMIN, and its dialogs", async ({ page }) => {
      await signIn(page, "anna@example.com");
      await openBoard(page);
      await walkBoth(page, "board, ADMIN");

      for (const [name, trigger] of [
        ["New issue", page.locator(".board-new")],
        ["Manage labels", page.getByRole("button", { name: "Manage labels" })],
        ["Members", page.getByRole("button", { name: "Members", exact: true })],
        ["Edit project", page.getByRole("button", { name: "Edit project" })],
      ] as const) {
        await pressOpen(page, trigger);
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        // Its reads answered, so the walk meets every row the dialog will hold.
        await expect(dialog).not.toContainText(/Loading/);
        if (name === "Members") await expect(dialog.getByRole("button", { name: /^Remove / }).first()).toBeVisible();
        await walkBoth(page, `${name} dialog`, {
          scope: ".modal",
          first: () => firstIn(page, ".modal"),
          last: () => lastIn(page, ".modal"),
        });
        await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
        await expect(dialog).toBeHidden();
      }
    });

    test("the board as a VIEWER", async ({ page }) => {
      await signIn(page, "tom@example.com");
      await openBoard(page);
      await walkBoth(page, "board, VIEWER");
    });

    test("the issue panel as an ADMIN, with Share open and with the delete question open", async ({ page }) => {
      await signIn(page, "anna@example.com");
      await openBoard(page);
      await openPanel(page, "TAS-101");
      await walkBoth(page, "issue panel, ADMIN", {
        scope: ".issue-panel",
        first: () => firstIn(page, ".issue-panel"),
        last: () => lastIn(page, ".issue-panel"),
      });

      const share = page.getByRole("button", { name: "Share issue TAS-101" });
      const openShare = async () => {
        await pressOpen(page, share);
        await expect(page.locator(".issue-share-popover")).toBeVisible();
      };
      await openShare();
      await walkBoth(page, "Share popover", {
        scope: ".issue-share-popover",
        first: () => firstIn(page, ".issue-share-popover"),
        last: () => lastIn(page, ".issue-share-popover"),
        // Tab past its last control closes it (§4.23).
        reopen: async () => {
          if (!(await page.locator(".issue-share-popover").isVisible())) await openShare();
        },
      });
      if (await page.locator(".issue-share-popover").isVisible()) await page.keyboard.press("Escape");

      await pressOpen(page, page.getByRole("button", { name: "Delete issue TAS-101" }));
      await expect(page.locator(".issue-delete-zone")).toBeVisible();
      await walkBoth(page, "delete question", {
        scope: ".issue-delete-zone",
        first: () => firstIn(page, ".issue-delete-zone"),
        last: () => lastIn(page, ".issue-delete-zone"),
      });
    });

    test("the issue panel as a VIEWER", async ({ page }) => {
      await signIn(page, "tom@example.com");
      await openBoard(page);
      await openPanel(page, "TAS-101");
      await walkBoth(page, "issue panel, VIEWER", {
        scope: ".issue-panel",
        first: () => firstIn(page, ".issue-panel"),
        last: () => lastIn(page, ".issue-panel"),
      });
    });

    test("administration: Data, Events, Outbox and Audit", async ({ page }) => {
      await signIn(page, "mark@example.com");
      for (const [name, path] of [
        ["Data", "/admin/data/auth/users"],
        ["Events", "/admin/events"],
        ["Outbox", "/admin/events/outbox/auth"],
        ["Audit", "/admin/audit"],
      ] as const) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1, name: new RegExp(name === "Outbox" ? "Events" : name) })).toBeVisible();
        // Every read of the section answered, so the walk meets what stays.
        await expect(page.locator(".admin-section")).not.toContainText(/Loading|Reading/);
        await walkBoth(page, `/admin, ${name}`);
      }
    });

    test("administration: Users and its dialogs", async ({ page }) => {
      await signIn(page, "mark@example.com");
      await page.goto("/admin/users");
      await expect(page.getByRole("button", { name: "Invite user" })).toBeVisible();
      await walkBoth(page, "/admin, Users");

      for (const [name, trigger] of [
        ["Invite", page.getByRole("button", { name: "Invite user" })],
        ["Resend", page.getByRole("button", { name: "Resend invite to Leo Fischer" })],
        ["Block", page.getByRole("button", { name: "Block Anna Ivanova" })],
        ["Unblock", page.getByRole("button", { name: /^Unblock / }).first()],
        ["Reset lockout", page.getByRole("button", { name: /^Reset lockout for / }).first()],
      ] as const) {
        await pressOpen(page, trigger);
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        await walkBoth(page, `${name} dialog`, {
          scope: ".modal",
          first: () => firstIn(page, ".modal"),
          last: () => lastIn(page, ".modal"),
        });
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
      }
    });

    test("a key that resolves to nothing, and a page that is not there", async ({ page }) => {
      await signIn(page, "anna@example.com");
      await page.goto("/browse/NOPE-1");
      await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
      await walkBoth(page, "/browse, a key nobody has");

      await page.goto("/definitely/not/a/page");
      await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
      await walkBoth(page, "Not found");
    });
  });
}
