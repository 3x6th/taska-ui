import { expect, test, type Page } from "@playwright/test";
import { B2B, COMPANY, companyPath, companyRow, inCompany, setHooks, signIn } from "./companiesFixtures";

/*
 * Settings › General in the companies build (TAS-504, DESIGN.md §4.39, §4.35)
 * against the third e2e server's mock: the story's four acceptance criteria —
 * the owner renames the company and only the name changes; a transfer leaves
 * the former owner an admin without the owner's controls; FREE is not handed
 * over and a refusal changes nothing; resuming lifts neither a block nor an
 * ended paid period — and api-contract-guard B2: with the content-read flag
 * off, a pause closes the projects and never the company.
 */

const DAY = 24 * 60 * 60_000;
const generalPath = (companyId: string) => companyPath(companyId, "/settings/company");

/** Opens Settings › General from the rail's «Company» group, as a reader does. */
async function openGeneral(page: Page, companyId: string) {
  await page.goto(companyPath(companyId, "/settings/profile"));
  const rail = page.getByRole("navigation", { name: "Settings" });
  const group = rail.getByRole("group", { name: "Company" });
  // TAS-512: Plan stands third (§5.9).
  await expect(group.getByRole("link")).toHaveText(["General", "Members", "Plan"]);
  await group.getByRole("link", { name: "General" }).click();
  await expect(page).toHaveURL(generalPath(companyId));
  await expect(page.getByRole("heading", { level: 1, name: /General/ })).toBeVisible();
  await expect(page.getByText(/^Only the owner of/)).toBeVisible();
}

const facts = (page: Page, label: string) => page.locator(".company-general-facts > div").filter({ has: page.locator("dt", { hasText: label }) }).locator("dd");
const said = (page: Page) => page.locator('.company-general > [role="status"]');
const stateLines = (page: Page) => page.locator(".company-general-state");
const pauseStrip = (page: Page) => page.locator(".company-general-pause-confirm");

test("AC1: the owner renames Northwind, and the name changes everywhere it is drawn — the lead, the switcher, the menu, the title", async ({
  page,
  isMobile,
}) => {
  await inCompany(page, "Northwind", COMPANY.northwind);
  await openGeneral(page, COMPANY.northwind);
  await expect(facts(page, "Owner")).toHaveText("You");
  // FREE: no paid period, so no «Paid until» — and never the word «Free».
  await expect(page.locator(".company-general-facts dt")).toHaveText(["Name", "Owner"]);
  await page.getByRole("button", { name: "Rename company" }).click();
  const field = page.getByRole("textbox", { name: "Company name" });
  await expect(field).toBeFocused();
  await field.fill("  Northwind Traders ");
  await field.press("Enter");
  await expect(facts(page, "Name")).toHaveText("Northwind Traders");
  await expect(page.getByText("Only the owner of Northwind Traders can rename it, pause it or transfer it.")).toBeVisible();
  await expect(said(page)).toHaveText("The company is now called Northwind Traders.");
  await expect(page.getByRole("button", { name: "Rename company" })).toBeFocused();
  await expect(page).toHaveTitle("Northwind Traders — Taska");
  if (!isMobile) await expect(page.getByRole("button", { name: "Northwind Traders, switch company" })).toBeVisible();
  await page.getByRole("button", { name: /Open profile/ }).click();
  await expect(page.locator(".user-profile-company")).toHaveText("Northwind Traders");
  await page.keyboard.press("Escape");
  // The picker's row, read again after the write.
  await page.goto(`${B2B}/companies`);
  await expect(companyRow(page, /^Northwind Traders/)).toBeVisible();
});

test("AC2: Tom hands Umbrella to Priya — the modal stays in flight through the re-entry, then Tom is an admin without the zone", async ({
  page,
}) => {
  await inCompany(page, "Umbrella", COMPANY.umbrella, "tom@example.com");
  await openGeneral(page, COMPANY.umbrella);
  await expect(facts(page, "Paid until")).toHaveText(/^[A-Z][a-z]{2} \d{1,2}, (\d{4}, )?\d\d:\d\d$/);
  await page.getByRole("button", { name: "Transfer ownership" }).click();
  const dialog = page.getByRole("dialog", { name: "Transfer ownership" });
  const select = dialog.getByRole("combobox", { name: "New owner" });
  await expect(select).toBeFocused();
  // Anna is suspended in Umbrella, and Tom is the reader: only Priya can be chosen.
  await expect(select.locator("option")).toHaveText(["Choose a member", "Priya Nair · priya@example.com"]);
  await select.selectOption({ label: "Priya Nair · priya@example.com" });
  await expect(dialog.getByText("Priya Nair becomes the owner of Umbrella.")).toBeVisible();
  await expect(dialog.getByText("Automatic payments you set up are turned off. Priya Nair sets up their own.")).toBeVisible();
  // The re-entry is slowed, so the chain can be watched: the modal never gives way to an owner's page.
  await setHooks(page, { delayMs: { createTenantSession: 700 } });
  await dialog.getByRole("button", { name: "Transfer ownership" }).click();
  await expect(dialog.getByRole("button", { name: "Transfer ownership" })).toHaveAttribute("aria-disabled", "true");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: /Pause company|Transfer ownership|Rename company/ })).toHaveCount(0);
  await expect(page.getByText("Paid until")).toHaveCount(0);
  await expect(facts(page, "Owner")).toHaveText("Priya Nair");
  await expect(said(page)).toHaveText("Priya Nair now owns Umbrella. You’re still an admin.");
  await expect(page.getByRole("heading", { level: 1, name: /General/ })).toBeFocused();
  // A reload asks the server again and repeats nothing.
  await page.reload();
  await expect(page.getByText(/^Only the owner of Umbrella/)).toBeVisible();
  await expect(said(page)).toHaveText("");
  await expect(page.getByRole("button", { name: "Transfer ownership" })).toHaveCount(0);
  // Members: Priya owns it, Tom is still an admin there.
  await page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Members" }).click();
  const memberRow = (name: string) => page.locator(".company-member-row:not(.is-invitation)").filter({ hasText: name });
  await expect(memberRow("Priya Nair")).toContainText("Owner");
  await expect(memberRow("Tom Becker")).toContainText("Admin");
});

test("AC3: Northwind is FREE — its transfer is refused, nothing changes, and the modal says so", async ({ page }) => {
  await inCompany(page, "Northwind", COMPANY.northwind);
  await openGeneral(page, COMPANY.northwind);
  await page.getByRole("button", { name: "Transfer ownership" }).click();
  const dialog = page.getByRole("dialog", { name: "Transfer ownership" });
  await dialog.getByRole("combobox", { name: "New owner" }).selectOption({ label: "Sofia Reyes · sofia@example.com" });
  await dialog.getByRole("button", { name: "Transfer ownership" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Northwind was not transferred.");
  await expect(dialog.getByRole("combobox", { name: "New owner" })).toHaveValue(/.+/);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Transfer ownership" })).toBeFocused();
  await expect(facts(page, "Owner")).toHaveText("You");
  await expect(page.getByRole("button", { name: "Pause company" })).toBeVisible();
});

test("AC4: Initech — renaming is refused under the pause; Sofia resumes; past its paid period the pause goes and PAYMENT_EXPIRED stays", async ({
  page,
}) => {
  await inCompany(page, "Initech", COMPANY.initech, "sofia@example.com");
  await openGeneral(page, COMPANY.initech);
  await expect(stateLines(page)).toHaveText(["Paused by its owner. No one can change anything in it while it’s paused."]);
  await page.getByRole("button", { name: "Rename company" }).click();
  await page.getByRole("textbox", { name: "Company name" }).fill("Initrode");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".company-general-rename-form").getByRole("alert")).toHaveText("Initech is paused. Resume it to rename it.");
  await expect(page.getByRole("textbox", { name: "Company name" })).toHaveValue("Initrode");
  await page.getByRole("button", { name: "Cancel" }).click();

  await expect(page.getByText("Resuming lets everyone work in Initech again. It takes no payment and doesn’t extend the paid period.")).toBeVisible();
  const resume = page.getByRole("button", { name: "Resume company" });
  await resume.click();
  await expect(said(page)).toHaveText("Initech is no longer paused.");
  await expect(stateLines(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Pause company" })).toBeFocused();

  // Paused again, and the clock past the paid period: resuming leaves the period ended.
  await page.getByRole("button", { name: "Pause company" }).click();
  await expect(pauseStrip(page)).toContainText("Pausing doesn’t extend the paid period — it still ends");
  await pauseStrip(page).getByRole("button", { name: "Pause company" }).click();
  await expect(said(page)).toHaveText("Initech is paused.");
  await setHooks(page, { clockOffsetMs: 33 * DAY });
  await page.reload();
  // TAS-512: the financial line explained to the owner (§4.39) — and «what still works» only once nothing but it is left.
  const expired = "Its paid period has ended. Nothing in it can be changed until you renew it. There’s no grace period, and it doesn’t move to a free plan on its own.";
  await expect(stateLines(page)).toHaveText(["Paused by its owner. No one can change anything in it while it’s paused.", expired]);
  await page.getByRole("button", { name: "Resume company" }).click();
  await expect(said(page)).toHaveText("Initech is no longer paused.");
  await expect(stateLines(page)).toHaveText([
    expired,
    "Everything in it can still be read, and admins can still remove members and revoke invitations. This version of Taska can’t take payments or change plans yet.",
  ]);
});

test("Hooli is blocked: the owner is told only Taska can lift it, and every command is refused in the block's words", async ({ page }) => {
  await inCompany(page, "Hooli", COMPANY.hooli, "priya@example.com");
  await openGeneral(page, COMPANY.hooli);
  await expect(stateLines(page)).toHaveText(["Blocked by Taska. No one can change anything in it, and only Taska can lift the block."]);
  await page.getByRole("button", { name: "Pause company" }).click();
  await expect(pauseStrip(page).getByRole("button", { name: "Cancel" })).toBeFocused();
  await pauseStrip(page).getByRole("button", { name: "Pause company" }).click();
  await expect(said(page)).toHaveText("Taska has blocked Hooli, so it was not paused.");
  await expect(page.getByRole("button", { name: "Pause company" })).toBeFocused();
  await page.getByRole("button", { name: "Rename company" }).click();
  await page.getByRole("textbox", { name: "Company name" }).fill("Hooli XYZ");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".company-general-rename-form").getByRole("alert")).toHaveText("Taska has blocked Hooli, so it can’t be renamed.");
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Transfer ownership" }).click();
  const dialog = page.getByRole("dialog", { name: "Transfer ownership" });
  await dialog.getByRole("combobox", { name: "New owner" }).selectOption({ label: "Sofia Reyes · sofia@example.com" });
  await dialog.getByRole("button", { name: "Transfer ownership" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Taska has blocked Hooli, so it was not transferred.");
});

test("B2: with the read flag off, Initech's owner is told on Projects, reaches General and resumes; a member is told without the button", async ({
  page,
  browser,
}) => {
  await signIn(page, "sofia@example.com");
  await expect(page).toHaveURL(`${B2B}/companies`);
  await setHooks(page, { contentReadUnderRestriction: false });
  await companyRow(page, /^Initech/).click();
  await expect(page.getByRole("heading", { level: 1, name: "Initech is paused" })).toBeFocused();
  await expect(page.getByText("Its projects can’t be opened while it’s paused. You can resume it in its settings.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Log out" })).toHaveCount(0);
  await page.getByRole("link", { name: "Open company settings" }).click();
  await expect(page).toHaveURL(generalPath(COMPANY.initech));
  await page.getByRole("button", { name: "Resume company" }).click();
  await expect(said(page)).toHaveText("Initech is no longer paused.");
  await page.getByRole("link", { name: "Back to projects" }).click();
  await expect(page.locator("button.project-card").first()).toBeVisible();

  // Anna, a member, in a browser of her own where Initech is still paused.
  const context = await browser.newContext();
  const anna = await context.newPage();
  await signIn(anna, "anna@example.com");
  await expect(anna).toHaveURL(`${B2B}/companies`);
  await setHooks(anna, { contentReadUnderRestriction: false });
  await anna.goto(companyPath(COMPANY.initech));
  await expect(anna.getByRole("heading", { level: 1, name: "Initech is paused" })).toBeVisible();
  await expect(anna.getByText("Its owner has paused it, so its projects can’t be opened right now.")).toBeVisible();
  await expect(anna.getByRole("link", { name: "Open company settings" })).toHaveCount(0);
  // Settings is never replaced: General tells her the same, with no controls.
  await anna.goto(generalPath(COMPANY.initech));
  await expect(anna.locator(".company-general-state")).toHaveText(["Paused by its owner. No one can change anything in it while it’s paused."]);
  await expect(anna.getByRole("button", { name: /Resume company|Pause company/ })).toHaveCount(0);
  await context.close();
});
