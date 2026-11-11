import { expect, test, type Locator, type Page } from "@playwright/test";
import { COMPANY, LONG_NAME, PLAN, companyPath, inCompany, openCompanyZone, setHooks, switchCompany } from "./companiesFixtures";

/*
 * Company › Plan and the workspace's explanations of a restriction in the
 * companies build (TAS-512, DESIGN.md §4.40, §4.34, §4.35, §5.10) against the third
 * e2e server's mock: the story's four acceptance criteria — finance only for
 * the owner, with no subscription read for anybody else; a move below usage
 * shows the kept data and READ_ONLY with its reason; exactly the task limit
 * refuses New issue and nothing else; a late answer of the company switched
 * away from is never drawn — and the state marker on the board.
 */

const WEB = "58e93598-ea1a-460d-9d72-f1f201c310e2";
const LNG = "5a1e9c3d-7b2f-4d6a-8e0c-2f4b6d8a0c07";
const HLP = "5a1e9c3d-7b2f-4d6a-8e0c-2f4b6d8a0c03";
const planPath = (companyId: string) => companyPath(companyId, "/company/plan");

/**
 * Opens Company › Plan as a reader does — third in the zone's rail, after
 * General and Members: «Manage company» (the switcher's, or the profile menu's
 * on a phone) and the rail (TAS-522). Moving from General to Plan puts focus
 * on the heading.
 */
async function openPlan(page: Page, companyId: string) {
  await openCompanyZone(page, companyId, "Plan");
  await expect(page).toHaveURL(planPath(companyId));
  await expect(page.getByRole("heading", { level: 1, name: /Plan/ })).toBeFocused();
  await expect(page.getByText(/^The plan /)).toBeVisible();
}

const labels = (page: Page) => page.locator(".company-plan dt");
const fact = (page: Page, label: string) =>
  page.locator(".company-plan dl > div").filter({ has: page.locator("dt", { hasText: new RegExp(`^${label}$`) }) }).locator("dd");
const storedHooks = (page: Page) => page.evaluate(() => JSON.parse(window.localStorage.getItem("taska.mockTenantHooks") ?? "{}") as Record<string, unknown>);

test("AC1: a member of Globex sees its plan and usage — no price, payments or scheduled change — and no subscription read goes out", async ({ page }) => {
  await inCompany(page, "Globex", COMPANY.globex);
  // A read of the subscription would take this refusal, once: it stays untaken.
  await setHooks(page, { refuseNext: { getSubscription: { status: 503, code: "DEPENDENCY_UNAVAILABLE" } } });
  await openPlan(page, COMPANY.globex);
  await expect(page.getByText("The plan Globex is on and what it uses. Its price and payments are shown only to its owner.")).toBeVisible();
  await expect(labels(page)).toHaveText(["Plan", "Projects", "Seats", "Storage", "Issues per project"]);
  await expect(fact(page, "Plan")).toHaveText("Free · version 1");
  // Globex's three projects against the FREE limit of 1 — said as the server counts them, nothing marked.
  await expect(fact(page, "Projects")).toHaveText("3 used · 1 allowedArchived projects count too.");
  await expect(fact(page, "Issues per project")).toHaveText("50 allowedDeleted issues still count.");
  await expect(page.locator(".company-plan")).not.toContainText("€");
  expect(await storedHooks(page)).toMatchObject({ refuseNext: { getSubscription: { code: "DEPENDENCY_UNAVAILABLE" } } });
});

test("AC1: Priya, an admin of Umbrella but not its owner, sees no finance either, and no subscription read goes out", async ({ page }) => {
  await inCompany(page, "Umbrella", COMPANY.umbrella, "priya@example.com");
  await setHooks(page, { refuseNext: { getSubscription: { status: 503, code: "DEPENDENCY_UNAVAILABLE" } } });
  await openPlan(page, COMPANY.umbrella);
  await expect(labels(page)).toHaveText(["Plan", "Projects", "Seats", "Storage", "Issues per project"]);
  await expect(fact(page, "Plan")).toHaveText("Team · version 1");
  await expect(fact(page, "Seats")).toHaveText("4 in use · 25 allowedSuspended members and pending invitations hold seats too.");
  await expect(page.locator(".company-plan")).not.toContainText(/€|Paid until|Scheduled change/);
  expect(await storedHooks(page)).toMatchObject({ refuseNext: { getSubscription: { code: "DEPENDENCY_UNAVAILABLE" } } });
});

test("the owner of Umbrella sees the money: price, paid until and automatic payments — nothing scheduled until the owner schedules it", async ({ page }) => {
  await inCompany(page, "Umbrella", COMPANY.umbrella, "tom@example.com");
  await openPlan(page, COMPANY.umbrella);
  await expect(page.getByText("The plan Umbrella is on and what it uses.", { exact: true })).toBeVisible();
  // TAS-515: no Team v1 → v2 «announcement» — develop writes the scheduled fields for the owner's own change only.
  await expect(labels(page)).toHaveText(["Plan", "Price", "Paid until", "Automatic payments", "Projects", "Seats", "Storage", "Issues per project"]);
  await expect(fact(page, "Price")).toHaveText("€15 a month");
  await expect(fact(page, "Automatic payments")).toHaveText("On");
  await expect(fact(page, "Issues per project")).toHaveText("No limit");
});

test("AC2: moved to FREE below its usage, the long-named company keeps its data and reads READ_ONLY with the reason — not a failed change", async ({
  page,
}) => {
  await inCompany(page, "Consolidated", COMPANY.longName, "priya@example.com");
  await setHooks(page, { applyPlan: { [COMPANY.longName]: PLAN.free } });
  await openPlan(page, COMPANY.longName);
  await expect(fact(page, "Plan")).toHaveText("Free · version 1");
  await expect(page.getByText("It’s over its plan’s limits.")).toBeVisible();
  await expect(page.locator(".company-general-states")).toContainText(
    "It’s over its plan’s limits. Nothing in it can be changed until it’s back within them.",
  );
  await expect(page.locator(".company-general-states")).toContainText(
    "Everything in it can still be read, and admins can still remove members and revoke invitations.",
  );
  // A FREE owner: no price, no paid period — and nothing failed.
  await expect(labels(page)).toHaveText(["Plan", "Projects", "Seats", "Storage", "Issues per project"]);
  await expect(page.locator(".company-plan .error-note")).toHaveCount(0);
  await expect(fact(page, "Seats")).toHaveText("2 in use · 5 allowedSuspended members and pending invitations hold seats too.");

  // The data is kept and readable; a write names the reason.
  await page.goto(companyPath(COMPANY.longName, `/projects/${LNG}/board`));
  await expect(page.locator(".issue-card", { hasText: "Label printer queue stalls after 500 jobs" })).toBeVisible();
  await expect(page.locator(".board-topbar .company-marker")).toHaveText(`${LONG_NAME} is read-only`);
  await page.getByRole("button", { name: "New", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New issue" });
  await dialog.getByLabel("Summary").fill("Kept as typed");
  await dialog.getByRole("button", { name: "Create issue" }).click();
  await expect(dialog.getByRole("alert")).toHaveText(`${LONG_NAME} is over its plan’s limits, so nothing in it can be changed.`);
  await expect(dialog.getByLabel("Summary")).toHaveValue("Kept as typed");
});

test("AC3: Northwind's WEB at its 50 issues refuses New issue with the plan's sentence — editing, moving and commenting go on", async ({ page }) => {
  await inCompany(page, "Northwind", COMPANY.northwind);
  await page.goto(companyPath(COMPANY.northwind, `/projects/${WEB}/board`));
  // At the limit nothing is disabled, hidden or marked.
  const create = page.getByRole("button", { name: "New", exact: true });
  await expect(create).toBeEnabled();
  await expect(page.locator(".board-topbar .company-marker")).toHaveCount(0);
  await create.click();
  const dialog = page.getByRole("dialog", { name: "New issue" });
  const summary = dialog.getByLabel("Summary");
  await summary.fill("One issue too many");
  await dialog.getByRole("button", { name: "Create issue" }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "WEB has reached its plan’s limit on issues, so this issue was not created. Deleted issues still count, and existing issues can still be edited, moved and commented on.",
  );
  // The draft stays, the form stays editable, the button stays — and focus with it.
  await expect(summary).toHaveValue("One issue too many");
  await expect(summary).toBeEditable();
  await expect(dialog.getByRole("button", { name: "Create issue" })).toBeFocused();
  await dialog.getByRole("button", { name: "Cancel" }).click();

  await page.locator(".issue-card", { hasText: "WEB-12" }).click();
  const panel = page.getByRole("dialog", { name: "WEB-12 issue" });
  await expect(panel).not.toHaveAttribute("aria-busy", "true");
  const comments = panel.locator(".comments");
  const before = await comments.locator(".comment-item").count();
  await comments.getByPlaceholder("Leave a comment").fill("Still allowed at the limit");
  await comments.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(comments.locator(".comment-item")).toHaveCount(before + 1);
  // Moved through its workflow, as ever.
  const move = panel.getByRole("group", { name: "Status" }).getByRole("button").first();
  const name = (await move.getAttribute("aria-label")) ?? (await move.innerText());
  const target = name.replace(/^.*, move to /i, "").replace(/^Move to /i, "");
  await move.click();
  await expect(page.getByRole("region", { name: `${target} column` }).locator(".issue-card", { hasText: "WEB-12" })).toHaveCount(1);
  await expect(panel.locator(".error-note")).toHaveCount(0);
});

test("a new project past Northwind's limit is refused with the plan's sentence; the draft and focus stay", async ({ page }) => {
  await inCompany(page, "Northwind", COMPANY.northwind);
  await page.getByRole("button", { name: "New project" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByRole("textbox", { name: "Key", exact: true }).fill("OPS");
  await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("Operations");
  const create = dialog.getByRole("button", { name: "Create project" });
  await create.click();
  await expect(dialog.locator(".error-note")).toContainText(
    "Northwind has reached its plan’s limit on projects, so this project was not created. Archived projects count too.",
  );
  await expect(dialog.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Operations");
  await expect(create).toBeFocused();
});

test("AC4: a late billing answer of Umbrella is never drawn once the tab is in Northwind", async ({ page, isMobile }) => {
  await inCompany(page, "Umbrella", COMPANY.umbrella, "tom@example.com");
  await openPlan(page, COMPANY.umbrella);
  await expect(fact(page, "Price")).toHaveText("€15 a month");
  await setHooks(page, { delayMs: { getSubscription: 2500, getEntitlement: 2500 } });
  // Read again, slowly — and leave before the answers come.
  await page.reload();
  await expect(page.locator(".company-plan-loading")).toBeVisible();
  await switchCompany(page, "Northwind", isMobile);
  await expect(page).toHaveURL(companyPath(COMPANY.northwind));
  // Within the page: a reload would drop Umbrella's late answers by itself.
  await openCompanyZone(page, COMPANY.northwind, "Plan");
  await expect(page).toHaveURL(planPath(COMPANY.northwind));
  // Northwind's own plan, once its own slow read answers — and past Umbrella's delay, nothing of Umbrella's.
  await expect(fact(page, "Plan")).toHaveText("Free · version 1", { timeout: 10_000 });
  await page.waitForTimeout(3_000);
  await expect(page.locator("body")).not.toContainText(/€15|Team · version|Scheduled change/);
  await expect(fact(page, "Seats")).toHaveText(/ in use · 5 allowed/);
});

test("the board carries the company's state: «paused» for Initech, «read-only» for a disputed Northwind — nothing switched off", async ({ page }) => {
  await inCompany(page, "Initech", COMPANY.initech);
  await page.goto(companyPath(COMPANY.initech, `/projects/${HLP}/board`));
  await expect(page.locator(".board-topbar .company-marker")).toHaveText("Initech is paused");
  await expect(page.getByRole("button", { name: "New", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: /Open profile/ }).click();
  await expect(page.locator(".user-profile-company .company-marker")).toHaveText("Initech is paused");
  await page.keyboard.press("Escape");

  await setHooks(page, { paymentDispute: { [COMPANY.northwind]: true } });
  await page.goto(companyPath(COMPANY.northwind, `/projects/${WEB}/board`));
  await expect(page.locator(".board-topbar .company-marker")).toHaveText("Northwind is read-only");
  await page.getByRole("button", { name: "New", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New issue" });
  await dialog.getByLabel("Summary").fill("Disputed");
  await dialog.getByRole("button", { name: "Create issue" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("A payment for Northwind is disputed, so nothing in it can be changed until it’s settled.");
});

test("Plan › «Try again» in flight keeps the page — no skeleton, every failed read's box, the button aria-disabled with focus — then focus on what is left, and on the heading once whole", async ({
  page,
}) => {
  await inCompany(page, "Umbrella", COMPANY.umbrella, "tom@example.com");
  await setHooks(page, {
    refuseNext: { getEntitlement: { status: 409, code: "INVALID_STATE" }, getTenantQuotas: { status: 409, code: "INVALID_STATE" } },
  });
  await openPlan(page, COMPANY.umbrella);
  const planNote = page.getByText("This company’s plan could not be loaded.");
  const usageNote = page.getByText("Usage could not be loaded.");
  await expect(planNote).toBeVisible();
  await expect(usageNote).toBeVisible();
  const retry = page.getByRole("button", { name: "Try again" });
  await expect(retry).toHaveCount(1);
  const arrived = await labels(page).allTextContents();

  // The plan heals and Usage fails again — both slowly, so the flight can be looked at.
  await setHooks(page, {
    refuseNext: { getTenantQuotas: { status: 409, code: "INVALID_STATE" } },
    delayMs: { getEntitlement: 1500, getTenantQuotas: 1500 },
  });
  await retry.focus();
  await page.keyboard.press("Enter");
  await expect(retry).toHaveAttribute("aria-disabled", "true");
  await expect(page.locator(".company-plan-loading")).toHaveCount(0);
  await expect(planNote).toBeVisible();
  await expect(usageNote).toBeVisible();
  await expect(labels(page)).toHaveText(arrived);
  await expect(retry).toHaveText("Try again");
  await expect(retry).toBeFocused();
  expect(await retry.evaluate((node) => getComputedStyle(node).cursor)).toBe("progress");

  // Answered: the plan's rows, Usage's box again — and «Try again» under it, with focus.
  await expect(fact(page, "Plan")).toHaveText("Team · version 1");
  await expect(planNote).toHaveCount(0);
  await expect(usageNote).toBeVisible();
  await expect(page.locator(".company-plan-failure").filter({ has: usageNote }).getByRole("button", { name: "Try again" })).toHaveCount(1);
  await expect(retry).toBeFocused();
  await expect(retry).not.toHaveAttribute("aria-disabled");

  // All healed: the page is whole, focus on its heading.
  await setHooks(page, null);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: /Plan/ })).toBeFocused();
  await expect(retry).toHaveCount(0);
  await expect(fact(page, "Seats")).toHaveText(/ in use · 25 allowed/);
});

/**
 * The refusal's sentence and the focused submit both inside the modal body's
 * visible rect (§4.40 «Отказы квоты», art-director B2) — measured in one
 * evaluate, after the fonts, so nothing moves between the reads.
 */
async function expectRefusalInView(dialog: Locator, submit: string) {
  const rects = await dialog.evaluate(async (node, name) => {
    await document.fonts.ready;
    const box = (element: Element | null | undefined) => {
      const rect = element?.getBoundingClientRect();
      return rect ? { top: rect.top, bottom: rect.bottom } : null;
    };
    const button = [...node.querySelectorAll("button")].find((item) => item.textContent?.trim() === name);
    return {
      body: box(node.querySelector(".modal-body")),
      note: box(node.querySelector(".error-note")),
      button: box(button),
      viewport: window.innerHeight,
    };
  }, submit);
  expect(rects.body && rects.note && rects.button).toBeTruthy();
  const { body, note, button } = rects as { body: { top: number; bottom: number }; note: { top: number; bottom: number }; button: { top: number; bottom: number } };
  expect(body.bottom).toBeLessThanOrEqual(rects.viewport);
  for (const part of [note, button]) {
    expect(part.top).toBeGreaterThanOrEqual(body.top);
    expect(part.bottom).toBeLessThanOrEqual(body.bottom);
  }
}

for (const size of [
  { width: 320, height: 568, phone: true },
  { width: 1440, height: 810, phone: false },
]) {
  test(`at ${size.width}×${size.height} a refused New issue brings its sentence and Create issue into the modal body's view, focus on it`, async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile !== size.phone, size.phone ? "a phone size" : "a desktop size");
    await page.setViewportSize({ width: size.width, height: size.height });
    await inCompany(page, "Northwind", COMPANY.northwind);
    await page.goto(companyPath(COMPANY.northwind, `/projects/${WEB}/board`));
    await page.getByRole("button", { name: "New", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "New issue" });
    await dialog.getByLabel("Summary").fill("One issue too many");
    const create = dialog.getByRole("button", { name: "Create issue" });
    await create.click();
    await expect(dialog.getByRole("alert")).toContainText("WEB has reached its plan’s limit on issues, so this issue was not created.");
    await expect(create).toBeFocused();
    await expectRefusalInView(dialog, "Create issue");
  });
}

test("at 320×568 a refused New project brings its sentence and Create project into the modal body's view, focus on it", async ({ page, isMobile }) => {
  test.skip(!isMobile, "a phone size");
  await page.setViewportSize({ width: 320, height: 568 });
  await inCompany(page, "Northwind", COMPANY.northwind);
  await page.getByRole("button", { name: "New project" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByRole("textbox", { name: "Key", exact: true }).fill("OPS");
  await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("Operations");
  const create = dialog.getByRole("button", { name: "Create project" });
  await create.click();
  await expect(dialog.locator(".error-note")).toContainText("Northwind has reached its plan’s limit on projects, so this project was not created.");
  await expect(create).toBeFocused();
  await expectRefusalInView(dialog, "Create project");
});

test("a refused write re-reads the company without a reload: the marker says «read-only», and Plan the dispute (B4)", async ({ page, isMobile }) => {
  await inCompany(page, "Northwind", COMPANY.northwind);
  await openPlan(page, COMPANY.northwind);
  await expect(page.getByText("A payment is disputed.")).toHaveCount(0);
  await setHooks(page, { paymentDispute: { [COMPANY.northwind]: true } });

  // Inside the app from here on: nothing is reloaded.
  await page.getByRole("link", { name: "Back to projects" }).click();
  await expect(page).toHaveURL(companyPath(COMPANY.northwind));
  await page.getByRole("button", { name: "New project" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByRole("textbox", { name: "Key", exact: true }).fill("OPS");
  await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("Operations");
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect(dialog.locator(".error-note")).toContainText("A payment for Northwind is disputed, so nothing in it can be changed until it’s settled.");
  await dialog.getByRole("button", { name: "Cancel" }).click();

  // The refusal's reasons were not the list row's: the list was read again, and the marker is there.
  if (isMobile) {
    await page.getByRole("button", { name: /Open profile/ }).click();
    await expect(page.locator(".user-profile-company .company-marker")).toHaveText("Northwind is read-only");
    await page.keyboard.press("Escape");
  } else {
    await expect(page.locator(".company-switcher-trigger .company-marker")).toHaveText("read-only");
  }
  // The company was invalidated with it: Plan reads it again and says the dispute.
  await openCompanyZone(page, COMPANY.northwind, "Plan");
  await expect(page).toHaveURL(planPath(COMPANY.northwind));
  await expect(page.getByText("A payment is disputed.")).toBeVisible();
});
