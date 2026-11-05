import { expect, test, type Page } from "@playwright/test";
import { COMPANY, LONG_NAME, PLAN, companyPath, inCompany, setHooks, switchCompany } from "./companiesFixtures";

/*
 * Settings › Plan and the workspace's explanations of a restriction in the
 * companies build (TAS-512, DESIGN.md §4.40, §4.34, §4.35) against the third
 * e2e server's mock: the story's four acceptance criteria — finance only for
 * the owner, with no subscription read for anybody else; a move below usage
 * shows the kept data and READ_ONLY with its reason; exactly the task limit
 * refuses New issue and nothing else; a late answer of the company switched
 * away from is never drawn — and the state marker on the board.
 */

const WEB = "58e93598-ea1a-460d-9d72-f1f201c310e2";
const LNG = "5a1e9c3d-7b2f-4d6a-8e0c-2f4b6d8a0c07";
const HLP = "5a1e9c3d-7b2f-4d6a-8e0c-2f4b6d8a0c03";
const planPath = (companyId: string) => companyPath(companyId, "/settings/plan");

/** Opens Settings › Plan from the rail's «Company» group, as a reader does — third, after General and Members. */
async function openPlan(page: Page, companyId: string) {
  await page.goto(companyPath(companyId, "/settings/profile"));
  const group = page.getByRole("navigation", { name: "Settings" }).getByRole("group", { name: "Company" });
  await expect(group.getByRole("link")).toHaveText(["General", "Members", "Plan"]);
  await group.getByRole("link", { name: "Plan" }).click();
  await expect(page).toHaveURL(planPath(companyId));
  await expect(page.getByRole("heading", { level: 1, name: /Plan/ })).toBeFocused();
  await expect(page.getByText(/^The plan /)).toBeVisible();
}

const labels = (page: Page) => page.locator(".company-plan dt");
const fact = (page: Page, label: string) =>
  page.locator(".company-plan dl > div").filter({ has: page.locator("dt", { hasText: new RegExp(`^${label}$`) }) }).locator("dd");
const storedHooks = (page: Page) => page.evaluate(() => JSON.parse(window.localStorage.getItem("taska.mockTenantHooks") ?? "{}") as Record<string, unknown>);

test("AC1: a member of Globex sees its plan and usage — no price, payments or announced terms — and no subscription read goes out", async ({ page }) => {
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
  await expect(page.locator(".company-plan")).not.toContainText(/€|Paid until|Announced/);
  expect(await storedHooks(page)).toMatchObject({ refuseNext: { getSubscription: { code: "DEPENDENCY_UNAVAILABLE" } } });
});

test("the owner of Umbrella sees the money: price, paid until, automatic payments and Team v2 announced for its paid-through", async ({ page }) => {
  await inCompany(page, "Umbrella", COMPANY.umbrella, "tom@example.com");
  await openPlan(page, COMPANY.umbrella);
  await expect(page.getByText("The plan Umbrella is on and what it uses.", { exact: true })).toBeVisible();
  await expect(labels(page)).toHaveText([
    "Plan",
    "Price",
    "Paid until",
    "Automatic payments",
    "Announced change",
    "Projects",
    "Seats",
    "Storage",
    "Issues per project",
  ]);
  await expect(fact(page, "Price")).toHaveText("€15 a month");
  await expect(fact(page, "Automatic payments")).toHaveText("On");
  await expect(fact(page, "Announced change")).toContainText(/^From [A-Z][a-z]{2} \d{1,2}, (\d{4}, )?\d\d:\d\d: Team · version 2, €20 a month/);
  await expect(fact(page, "Announced change")).toContainText("5 projects · 50 seats · 5 GB storage · unlimited issues");
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
    "Everything in it can still be read, and admins can still remove members and revoke invitations. This version of Taska can’t take payments or change plans yet.",
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
  await page.getByRole("button", { name: /Open profile/ }).click();
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Plan" }).click();
  await expect(page).toHaveURL(planPath(COMPANY.northwind));
  // Northwind's own plan, once its own slow read answers — and past Umbrella's delay, nothing of Umbrella's.
  await expect(fact(page, "Plan")).toHaveText("Free · version 1", { timeout: 10_000 });
  await page.waitForTimeout(3_000);
  await expect(page.locator("body")).not.toContainText(/€15|Team · version|Announced change/);
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
