import { expect, test, type Page } from "@playwright/test";
import { B2B, COMPANY, companyPath, companyRow, inCompany, setHooks, signIn } from "./companiesFixtures";

/*
 * TAS-501's acceptance criteria against the companies build (DESIGN.md §4.36,
 * §4.37, §5.6): a FREE company is created by the allowance the server grants
 * and a refusal draws no company; a paid one spends no FREE and opens no
 * projects before its first payment; a repeated press or a reload returns the
 * same company, and a closed creation is not resumed; a timely payment
 * confirmed late reopens the auto-closed company only on the server's answer.
 *
 * The mock's accounts (src/api/mock/MockTenantServer.ts): Nina has no company
 * and her FREE allowance; Anna used hers on Northwind; Tom has his, and Stark
 * Industries awaiting payment, Wayne Enterprises cancelled, Massive Dynamic
 * closed.
 */

const COMPANY_ADDRESS = new RegExp(`^${B2B}/c/[0-9a-f-]{36}/projects$`);
const nameField = (page: Page) => page.getByLabel("Company name");
const freePlan = (page: Page) => page.getByRole("radio", { name: "Free" });
const teamPlan = (page: Page) => page.getByRole("radio", { name: /^Team/ });
const setupHeading = (page: Page) => page.getByRole("heading", { level: 1 });

async function openForm(page: Page, email: string) {
  await signIn(page, email);
  await expect(page).toHaveURL(`${B2B}/companies`);
  await page.getByRole("link", { name: "Create a company" }).click();
  await expect(page).toHaveURL(`${B2B}/companies/new`);
  await expect(freePlan(page)).toBeVisible();
}

const tabRecord = (page: Page) =>
  page.evaluate(() => JSON.parse(window.sessionStorage.getItem("taska.tenantCreation") ?? "null") as Record<string, string> | null);

test("AC1: Nina creates a free company and lands in its Projects — no projects yet, focus on New project, «… is ready.»", async ({
  page,
  isMobile,
}) => {
  await signIn(page, "nina@example.com");
  await expect(page.getByRole("heading", { level: 1, name: "You’re not in a company yet" })).toBeVisible();
  // Provisioning finishes in the creation's own answer.
  await setHooks(page, { provisioning: { stepMs: 0 } });
  await page.getByRole("link", { name: "Create a company" }).click();
  await expect(page).toHaveURL(`${B2B}/companies/new`);
  await expect(page).toHaveTitle("Create a company — Taska");
  // One card, its contents changed in place.
  await expect(page.locator(".auth-card")).toHaveCount(1);
  await expect(nameField(page)).toBeFocused();
  // The published plans only, the free one chosen, a paid one never.
  await expect(page.getByRole("radio")).toHaveCount(2);
  await expect(freePlan(page)).toBeChecked();
  await expect(teamPlan(page)).not.toBeChecked();
  await expect(page.getByText("1 project · 5 members · 100 MB storage · 50 issues per project")).toBeVisible();
  await expect(page.getByText("€20 a month")).toBeVisible();
  await expect(page.getByText("5 projects · 50 members · 5 GB storage · unlimited issues")).toBeVisible();
  await expect(page.getByText("Nothing is charged now. The company opens once its first payment is confirmed.")).toBeVisible();

  // An empty name is said, and nothing is sent.
  await page.getByRole("button", { name: "Create company" }).click();
  await expect(page.getByText("Enter a company name.")).toBeVisible();
  await expect(nameField(page)).toHaveAttribute("aria-invalid", "true");
  await expect(nameField(page)).toBeFocused();
  await expect(page).toHaveURL(`${B2B}/companies/new`);

  await nameField(page).fill("  Acme  ");
  await nameField(page).press("Enter");
  await expect(page).toHaveURL(COMPANY_ADDRESS);
  await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
  await expect(page.getByText("No projects yet.")).toBeVisible();
  await expect(page.getByRole("button", { name: "New project" })).toBeFocused();
  await expect(page.locator(".projects-page > [role=status]")).toHaveText("Acme is ready.");
  await expect(page).toHaveTitle("Acme — Taska");
  if (!isMobile) await expect(page.locator(".company-switcher-name")).toHaveText("Acme");
  // Nothing of the attempt is left to replay.
  expect(await tabRecord(page)).toBeNull();
  // Back does not return to the sent form.
  await page.goBack();
  await expect(page).toHaveURL(`${B2B}/companies`);
  await expect(companyRow(page, /^Acme/)).toHaveText("AcmeOwner");
});

test("AC1: Anna's free plan is refused — the free row stays, disabled, saying why; the paid one is offered; no company is drawn", async ({
  page,
}) => {
  await openForm(page, "anna@example.com");
  await nameField(page).fill("Northwind Labs");
  await page.getByRole("button", { name: "Create company" }).click();
  await expect(page.getByRole("alert")).toHaveText("This company was not created.");
  await expect(freePlan(page)).toBeDisabled();
  await expect(freePlan(page)).not.toBeChecked();
  await expect(page.getByText("You’ve used your one free company. Deleting it doesn’t bring it back.")).toBeVisible();
  await expect(teamPlan(page)).toBeEnabled();
  await expect(teamPlan(page)).not.toBeChecked();
  // Focus stays on the button, now unavailable until a plan is chosen.
  const create = page.getByRole("button", { name: "Create company" });
  await expect(create).toBeFocused();
  await expect(create).toHaveAttribute("aria-disabled", "true");
  await expect(page).toHaveURL(`${B2B}/companies/new`);
  await expect(nameField(page)).toHaveValue("Northwind Labs");
  expect(await tabRecord(page)).toBeNull();

  // The reader's list is what it was.
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page).toHaveURL(`${B2B}/companies`);
  await expect(page.getByRole("list", { name: "Companies" }).getByRole("link")).toHaveText([
    "Globex",
    "InitechPaused by its owner",
    "NorthwindOwner",
  ]);
  // Known in memory until sign-out: the form opens with the free row used and nothing chosen.
  await page.getByRole("link", { name: "Create a company" }).click();
  await expect(freePlan(page)).toBeDisabled();
  await expect(teamPlan(page)).not.toBeChecked();
});

test("AC2: a paid creation spends no FREE and lands on «Awaiting first payment» with its deadline — no Projects, search or bell", async ({
  page,
}) => {
  await openForm(page, "nina@example.com");
  await nameField(page).fill("Stark Labs");
  await teamPlan(page).check();
  await page.getByRole("button", { name: "Create company" }).click();
  await expect(page).toHaveURL(COMPANY_ADDRESS);
  const heading = setupHeading(page);
  await expect(heading).toHaveText("Stark LabsAwaiting first payment");
  await expect(page).toHaveTitle("Stark Labs — Taska");
  await expect(page.getByText(/^Its projects and invitations open once the first payment is confirmed\. If it isn’t paid by /)).toBeVisible();
  await expect(page.locator(".company-setup time")).toHaveAttribute("datetime", /^\d{4}-\d{2}-\d{2}T/);
  await expect(page.getByText("This version of Taska can’t take payments yet.")).toBeVisible();
  // The owner may cancel it.
  await expect(page.getByRole("button", { name: "Cancel creation" })).toBeVisible();
  // Not the app shell: no Projects, no New project, no search, no bell.
  await expect(page.getByRole("heading", { name: "Projects" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "New project" })).toHaveCount(0);
  await expect(page.locator(".page-shell, .board-shell, .topbar, .global-search")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /notification/i })).toHaveCount(0);

  // A reload asks the server again and lands on the same card; the picker has it in the first group.
  await page.reload();
  await expect(setupHeading(page)).toHaveText("Stark LabsAwaiting first payment");
  await page.getByRole("link", { name: "All companies" }).click();
  await expect(page).toHaveURL(`${B2B}/companies`);
  await expect(companyRow(page, /^Stark Labs/)).toHaveText("Stark LabsAwaiting first paymentOwner");

  // FREE is still hers.
  await page.getByRole("link", { name: "Create a company" }).click();
  await expect(freePlan(page)).toBeEnabled();
  await expect(freePlan(page)).toBeChecked();
});

test("AC3: a lost answer and a reload return the same company — never a second one", async ({ page }) => {
  await openForm(page, "nina@example.com");
  // The creation commits, and its answer never arrives.
  await setHooks(page, { loseAnswer: ["createTenant"] });
  await nameField(page).fill("Twice Co");
  await teamPlan(page).check();
  await page.getByRole("button", { name: "Create company" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Taska couldn’t confirm the company was created. Try again — it won’t create a second one.",
  );
  // The attempt stays open: its values are locked and its key kept.
  await expect(nameField(page)).toHaveAttribute("readonly", "");
  const sent = await tabRecord(page);
  expect(sent).toMatchObject({ name: "Twice Co", key: expect.stringMatching(/^[0-9a-f-]{36}$/) });
  expect(sent).not.toHaveProperty("tenantId");

  // The reload restores it and replays it by itself, with the same key.
  await page.reload();
  await expect(page).toHaveURL(COMPANY_ADDRESS);
  await expect(setupHeading(page)).toHaveText("Twice CoAwaiting first payment");
  expect(await tabRecord(page)).toMatchObject({ key: sent?.key, tenantId: expect.any(String) });
  await page.getByRole("link", { name: "All companies" }).click();
  await expect(page.getByRole("list", { name: "Companies" }).getByRole("link", { name: /^Twice Co/ })).toHaveCount(1);
});

test("AC3: Cancel while the creation is out — the answer still lands: the company is in the list, and the next form is a new attempt", async ({
  page,
}) => {
  await signIn(page, "tom@example.com");
  await expect(page).toHaveURL(`${B2B}/companies`);
  // The creation's answer is held 2.5 s (release-reviewer's probe).
  await setHooks(page, { delayMs: { createTenant: 2500 } });
  await page.getByRole("link", { name: "Create a company" }).click();
  await nameField(page).fill("Raced Co");
  await teamPlan(page).check();
  await page.getByRole("button", { name: "Create company" }).click();
  await expect(page.getByRole("button", { name: "Creating company" })).toBeVisible();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page).toHaveURL(`${B2B}/companies`);
  // The answer arrives on the picker: the company is listed, and the tab stays where the reader went.
  await expect(companyRow(page, /^Raced Co/)).toHaveText("Raced CoAwaiting first paymentOwner", { timeout: 6000 });
  await expect(page).toHaveURL(`${B2B}/companies`);
  expect(await tabRecord(page)).toMatchObject({ name: "Raced Co", tenantId: expect.any(String) });
  // Reopening the form starts a new attempt — nothing replays into Raced Co.
  await page.getByRole("link", { name: "Create a company" }).click();
  await expect(nameField(page)).toHaveValue("");
  await expect(page.getByRole("button", { name: "Create company" })).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page).toHaveURL(`${B2B}/companies/new`);
});

test("AC3: cancelling is the owner's, behind its question; then «Cancelled», and «Create a company» opens an empty form", async ({
  page,
}) => {
  await signIn(page, "tom@example.com");
  await expect(page).toHaveURL(`${B2B}/companies`);
  await companyRow(page, /^Stark Industries/).click();
  await expect(page).toHaveURL(companyPath(COMPANY.stark));
  const heading = setupHeading(page);
  await expect(heading).toHaveText("Stark IndustriesAwaiting first payment");
  // From inside the app: the heading takes focus.
  await expect(heading).toBeFocused();

  const trigger = page.getByRole("button", { name: "Cancel creation" });
  await trigger.click();
  await expect(page.getByText("This company will be cancelled and can’t be reopened.")).toBeVisible();
  const keep = page.getByRole("button", { name: "Keep it" });
  await expect(keep).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(keep).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await trigger.click();
  await page.locator(".company-cancel-confirm").getByRole("button", { name: "Cancel creation" }).click();
  await expect(heading).toHaveText("Stark IndustriesCancelled");
  await expect(heading).toBeFocused();
  await expect(page.getByText("It was cancelled before its first payment, so it never opened.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel creation" })).toHaveCount(0);

  // A new attempt, never the old one resumed: an empty form.
  await page.getByRole("link", { name: "Create a company" }).click();
  await expect(page).toHaveURL(`${B2B}/companies/new`);
  await expect(nameField(page)).toHaveValue("");
  await expect(nameField(page)).toBeFocused();
  await expect(freePlan(page)).toBeChecked();
  // Cancel goes back where the form was opened from.
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page).toHaveURL(companyPath(COMPANY.stark));
  await expect(setupHeading(page)).toHaveText("Stark IndustriesCancelled");
  await page.getByRole("link", { name: "All companies" }).click();
  await expect(companyRow(page, /^Stark Industries/)).toHaveText("Stark IndustriesCancelledOwner");
  await expect(companyRow(page, /^Stark Industries/)).toHaveClass(/is-closed/);
});

test("AC4: Massive Dynamic, closed, reopens on a late confirmation only when the server answers so", async ({ page }) => {
  await signIn(page, "tom@example.com");
  await companyRow(page, /^Massive Dynamic/).click();
  await expect(page).toHaveURL(companyPath(COMPANY.massive));
  await expect(setupHeading(page)).toHaveText("Massive DynamicClosed");
  await expect(
    page.getByText(/^Its first payment wasn’t confirmed by .+, so it closed without opening\. If it was paid in time, it reopens once Taska confirms the payment\.$/),
  ).toBeVisible();
  await expect(page.getByText(/can no longer be opened/)).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Create a company" })).toBeVisible();
  // The card's own re-read on arrival answers first.
  await page.waitForTimeout(500);

  // The server confirms the payment; the card does not decide that by itself.
  await setHooks(page, { latePaymentConfirmed: [COMPANY.massive] });
  await page.waitForTimeout(600);
  await expect(setupHeading(page)).toHaveText("Massive DynamicClosed");
  // Back in the tab, the reader's list is read again — and the company opens.
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
  await expect(page.getByText("No projects yet.")).toBeVisible();
  await expect(page).toHaveURL(companyPath(COMPANY.massive));
});

test("being set up moves on by itself — no spinner — and opens the company when the server says it is ready", async ({ page }) => {
  await signIn(page, "nina@example.com");
  await setHooks(page, { provisioning: { stepMs: 1000 } });
  await page.getByRole("link", { name: "Create a company" }).click();
  await nameField(page).fill("Slow Co");
  await page.getByRole("button", { name: "Create company" }).click();
  await expect(page).toHaveURL(COMPANY_ADDRESS);
  await expect(setupHeading(page)).toHaveText("Slow CoBeing set up");
  await expect(page.getByRole("status").filter({ hasText: "Taska is setting it up. This page opens it when it’s ready." })).toBeVisible();
  await expect(page.locator(".spinner, [role=progressbar], progress")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("No projects yet.")).toBeVisible();
  await expect(page.getByRole("button", { name: "New project" })).toBeFocused();
  await expect(page.locator(".projects-page > [role=status]")).toHaveText("Slow Co is ready.");
});

test("the switcher's «Create a company» opens the form, and Cancel comes back to the company", async ({ page, isMobile }) => {
  test.skip(isMobile, "the switcher is not in the bar below 768; the picker's entry is covered above");
  await inCompany(page, "Northwind", COMPANY.northwind);
  await page.locator(".company-switcher-trigger").click();
  const create = page.getByRole("dialog", { name: "Companies" }).getByRole("link", { name: "Create a company" });
  await expect(create).toHaveAttribute("href", "/companies/new");
  await create.click();
  await expect(page).toHaveURL(`${B2B}/companies/new`);
  // Entered from inside the app, on the token, not the sign-in card's 500 ms.
  await expect(page.locator(".auth-card-wrap.is-app-entrance")).toHaveCount(1);
  await expect(nameField(page)).toBeFocused();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page).toHaveURL(companyPath(COMPANY.northwind));
  await expect(page.locator("button.project-card .key-badge")).toHaveText(["TAS", "WEB", "MOB"]);
});
