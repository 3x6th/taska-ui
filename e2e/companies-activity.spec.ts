import { expect, test, type Page } from "@playwright/test";
import { ANNA, COMPANY, companyPath, inCompany, openCompanyZone } from "./companiesFixtures";

/*
 * Company › Activity in the companies build (TAS-524, DESIGN.md §4.41, §5.10)
 * against the third e2e server's mock — a route the frontend proposed on
 * TAS-523, not in the blueprint: the owner reads the log from the rail,
 * newest first, the platform administrator's record marked; the author and
 * kind filters live in the address; «Show more» appends and ends; a member
 * has no rail item and meets the server's 403 at the address; an action in
 * Members shows on the next entry; and the build without the flag has no
 * such page.
 */

const activityPath = (companyId: string) => companyPath(companyId, "/company/activity");
const rail = (page: Page) => page.getByRole("navigation", { name: "Company" });
const list = (page: Page) => page.getByRole("list", { name: "Activity" });
const sentences = (page: Page) => list(page).locator(".company-activity-sentence");
const said = (page: Page) => page.locator('.company-activity > [role="status"]');

/** Opens Activity as its owner does: the zone, then the rail's fourth item; the heading takes focus. */
async function openActivity(page: Page, companyId: string) {
  await openCompanyZone(page, companyId, "General");
  const item = rail(page).getByRole("link", { name: "Activity" });
  await expect(rail(page).getByRole("link")).toHaveText(["General", "Members", "Plan", "Activity", "Back to projects"]);
  await item.click();
  await expect(page).toHaveURL(activityPath(companyId));
  await expect(item).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { level: 1, name: /Activity/ })).toBeFocused();
}

test("the owner opens Activity from the rail: records newest first with author, action, target and time, Mark's marked", async ({ page }) => {
  await inCompany(page, "Northwind", COMPANY.northwind);
  await openActivity(page, COMPANY.northwind);
  await expect(page.getByText("Who changed what in Northwind, newest first.")).toBeVisible();
  await expect(sentences(page)).toHaveText([
    "A Taska administrator resent the invitation to kai@example.com.",
    "Anna Ivanova invited kai@example.com as a Member.",
    "Someone left the company.",
    "Anna Ivanova suspended Omar Haddad.",
    "Anna Ivanova invited zoe@example.com as an Admin.",
    "Anna Ivanova created the company.",
  ]);
  // Every row carries its time; the newest is the administrator's resend.
  await expect(list(page).locator("time")).toHaveCount(6);
  await expect(list(page).locator("time").last()).toHaveAttribute("datetime", "2026-05-01T09:00:00Z");
  // The author is the filter's link, described once.
  const author = list(page).getByRole("link", { name: "Anna Ivanova" }).first();
  await expect(author).toHaveAttribute("title", "Shows only this person’s actions.");
  await expect(page.getByText("No older activity.")).toBeVisible();
  // Silent on entry, and never wider than the screen.
  await expect(said(page)).toBeEmpty();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});

test("filters by author from a row's link and by kind from the popover — in the address, as chips, each with its ×", async ({ page }) => {
  await inCompany(page, "Northwind", COMPANY.northwind);
  await openActivity(page, COMPANY.northwind);

  await list(page).getByRole("link", { name: "Anna Ivanova" }).nth(1).click();
  await expect(page).toHaveURL(`${activityPath(COMPANY.northwind)}?actorUserId=${ANNA}`);
  const authorChip = page.locator(".company-activity-chip-label");
  await expect(authorChip).toHaveText("By Anna Ivanova");
  await expect(authorChip).toBeFocused();
  await expect(sentences(page)).toHaveCount(4);
  await expect(list(page).getByRole("link")).toHaveCount(0);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Remove filter By Anna Ivanova" })).toBeFocused();

  await page.getByRole("button", { name: "Filter", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Filter activity" });
  await expect(dialog.getByLabel("Action")).toHaveValue("TENANT_CREATED");
  await dialog.getByLabel("Action").selectOption("INVITATION_CREATED");
  await dialog.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(`${activityPath(COMPANY.northwind)}?actorUserId=${ANNA}&kind=INVITATION_CREATED`);
  const kindChip = page.getByRole("button", { name: "Action is Invitation sent", exact: true });
  await expect(kindChip).toBeFocused();
  await expect(sentences(page)).toHaveText(["Anna Ivanova invited kai@example.com as a Member.", "Anna Ivanova invited zoe@example.com as an Admin."]);
  await expect(page.getByText("No older activity matches these filters.")).toBeVisible();

  // A kind with nothing for this author: the empty phrase, said.
  await kindChip.click();
  await dialog.getByLabel("Action").selectOption("OWNERSHIP_TRANSFERRED");
  await dialog.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText("No activity matches these filters.", { exact: true }).first()).toBeVisible();
  await expect(said(page)).toHaveText("No activity matches these filters.");

  await page.getByRole("button", { name: "Remove filter Action is Ownership transferred" }).click();
  await expect(page).toHaveURL(`${activityPath(COMPANY.northwind)}?actorUserId=${ANNA}`);
  await expect(page.getByRole("button", { name: "Filter", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Remove filter By Anna Ivanova" }).click();
  await expect(page).toHaveURL(activityPath(COMPANY.northwind));
  await expect(page.getByRole("button", { name: "Filter", exact: true })).toBeFocused();
  await expect(sentences(page)).toHaveCount(6);
});

test("«Show more» on the long-named company appends a page and focuses its first row, then the end line", async ({ page }) => {
  await inCompany(page, "Consolidated", COMPANY.longName, "priya@example.com");
  await openActivity(page, COMPANY.longName);
  await expect(sentences(page)).toHaveCount(50);
  const more = page.getByRole("button", { name: "Show more activity" });
  await expect(more).toHaveText("Show more");
  await more.click();
  await expect(sentences(page)).toHaveCount(100);
  const firstNew = list(page).locator("li").nth(50);
  await expect(firstNew).toBeFocused();
  await expect(firstNew).toContainText("Priya Nair invited contractor-24@example.com as a Member.");
  await more.click();
  await expect(sentences(page)).toHaveCount(124);
  await expect(list(page).locator("li").nth(100)).toBeFocused();
  await expect(more).toHaveCount(0);
  await expect(page.getByText("No older activity.")).toBeVisible();
  await expect(sentences(page).last()).toHaveText("Priya Nair created the company.");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});

test("a member has no rail item, and the address answers the server's 403 with its id — never an empty log", async ({ page }) => {
  await inCompany(page, "Globex", COMPANY.globex);
  await openCompanyZone(page, COMPANY.globex, "General");
  await expect(rail(page).getByRole("link")).toHaveText(["General", "Members", "Plan", "Back to projects"]);

  await page.goto(activityPath(COMPANY.globex));
  await expect(page.locator(".company-activity .api-notice-sentence")).toHaveText("Only the admins and the owner of Globex can see its activity.");
  await expect(page.getByRole("button", { name: /^Copy request id [0-9a-f-]{36}$/ })).toBeVisible();
  await expect(list(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Filter", exact: true })).toHaveCount(0);
  await expect(page.getByText(/No activity/)).toHaveCount(0);
  // The rail names the section the reader stands in.
  await expect(rail(page).getByRole("link", { name: "Activity" })).toHaveAttribute("aria-current", "page");
});

test("an invitation sent in Members shows on the next entry to Activity", async ({ page }) => {
  await inCompany(page, "Umbrella", COMPANY.umbrella, "tom@example.com");
  await openActivity(page, COMPANY.umbrella);
  await expect(sentences(page).first()).toHaveText("Priya Nair invited lena@example.com as a Member.");

  await rail(page).getByRole("link", { name: "Members" }).click();
  await page.getByRole("button", { name: "Invite a member" }).click();
  const dialog = page.getByRole("dialog", { name: "Invite a member" });
  await dialog.getByLabel("Email").fill("lin@example.com");
  await dialog.getByRole("button", { name: "Send invitation" }).click();
  await expect(dialog).toHaveCount(0);

  await rail(page).getByRole("link", { name: "Activity" }).click();
  await expect(sentences(page).first()).toHaveText("Tom Becker invited lin@example.com as a Member.");
  await expect(sentences(page).nth(1)).toHaveText("Priya Nair invited lena@example.com as a Member.");
});

test("the build without the flag has no /company/activity", async ({ page }) => {
  // The first e2e server: the stand's build, flag off.
  await page.goto("/login");
  await page.getByLabel("Email").fill("anna@example.com");
  await page.getByLabel("Password", { exact: true }).fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);
  await page.goto("/company/activity");
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
});
