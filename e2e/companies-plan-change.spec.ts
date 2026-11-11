import { expect, test, type Page } from "@playwright/test";
import { B2B, COMPANY, INVOICE, LONG_NAME, MOCK_SERVER_KEY, companyPath, inCompany, openCompanyZone, setHooks } from "./companiesFixtures";

/*
 * A plan change, its renewal and automatic payments in the companies build
 * (TAS-515) against the third e2e server's mock (`MOCK_SERVER_KEY`). The
 * story's acceptance: paid → Free at once, with the paid period gone; paid →
 * cheaper paid only after its payment, with a new month; Free refused through
 * the real path; a dearer plan scheduled with its invoice; a scheduled change
 * withdrawn by choosing the current plan; renewal cancelled and resumed, and
 * past the period no «Resume renewal» but the current plan for sale; automatic
 * payments turned off, never on; a 412 from a second tab on each command; a
 * lost answer that changes the plan once; nothing of it for a non-owner — and
 * where focus lands after each outcome.
 */

const DAY = 24 * 60 * 60_000;
const DATE = /[A-Z][a-z]{2} \d{1,2}, (\d{4}, )?\d\d:\d\d/;

const fact = (page: Page, label: string) =>
  page.locator(".company-plan dl > div").filter({ has: page.locator("dt", { hasText: new RegExp(`^${label}$`) }) }).locator("dd");
const labels = (page: Page) => page.locator(".company-plan dt");
const zone = (page: Page) => page.locator(".company-plan-zone");
const zoneButton = (page: Page, name: string) => zone(page).locator(".company-general-zone-line").getByRole("button", { name, exact: true });
const said = (page: Page) => page.locator(".settings-column > .visually-hidden[role=status]");
const dialog = (page: Page) => page.getByRole("dialog", { name: "Change plan" });

/** The mock server's own record, from the shared storage. */
const server = (page: Page) =>
  page.evaluate(
    (key) =>
      JSON.parse(window.localStorage.getItem(key) ?? "{}") as {
        tenants: Array<{ id: string; subscription: { planVersionId: string; paidThrough?: string; version: string } }>;
        invoices: Array<{ id: string; tenantId: string; number: string; purpose: string; state: string }>;
        billingReceipts: Record<string, unknown>;
      },
    MOCK_SERVER_KEY,
  );
const subscriptionOf = async (page: Page, tenantId: string) => (await server(page)).tenants.find((tenant) => tenant.id === tenantId)?.subscription;

async function openPlan(page: Page, companyId: string) {
  await openCompanyZone(page, companyId, "Plan");
  await expect(page.getByRole("heading", { level: 1, name: /Plan/ })).toBeFocused();
  await expect(page.getByText(/^The plan .* is on and what it uses\./)).toBeVisible();
}

/** Opens «Change plan»: focus on the first plan that can be chosen, nothing chosen. */
async function openChange(page: Page) {
  await zoneButton(page, "Change plan").click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByRole("radio").first()).toBeVisible();
  await expect(dialog(page).getByRole("radio", { checked: true })).toHaveCount(0);
  await expect(dialog(page).getByText("Choose a plan to see what changes, and when.")).toBeVisible();
  return dialog(page);
}

const answer = (page: Page) => dialog(page).getByRole("button", { name: "Change plan" });

test("paid → Free applies at once: Paid until goes, and with it the Renewal and Automatic payments rows", async ({ page }) => {
  await inCompany(page, "Umbrella", COMPANY.umbrella, "tom@example.com");
  await openPlan(page, COMPANY.umbrella);
  await expect(labels(page)).toContainText(["Plan", "Price", "Paid until", "Automatic payments"]);
  await expect(zone(page)).toContainText("Move Umbrella to another plan. You’ll see what changes, and when, before you confirm.");

  const change = await openChange(page);
  await expect(change.getByText(/^Umbrella is on Team · version 1, €15 a month, paid until /)).toBeVisible();
  // Published plans by price; nothing preselected; the answer unavailable until a choice.
  await expect(change.getByRole("radio")).toHaveCount(4);
  await expect(answer(page)).toHaveAttribute("aria-disabled", "true");
  await expect(change.getByRole("radio", { name: "Free" })).toBeFocused();
  await change.getByRole("radio", { name: "Free" }).check();
  await expect(change.locator(".company-plan-change-consequences")).toContainText("Umbrella moves to Free as soon as you confirm.");
  await expect(change.locator(".company-plan-change-consequences")).toContainText(
    /Its paid period ends now\. The rest of it, until .+, isn’t kept or refunded — moving back to a paid plan later needs a new payment and starts a new month\./,
  );
  await expect(change.locator(".company-plan-change-consequences")).toContainText("Automatic payments turn off.");
  await answer(page).click();

  await expect(dialog(page)).toHaveCount(0);
  await expect(said(page)).toHaveText("Umbrella is now on Free.");
  await expect(zoneButton(page, "Change plan")).toBeFocused();
  await expect(fact(page, "Plan")).toHaveText("Free · version 1");
  await expect(labels(page)).toHaveText(["Plan", "Projects", "Seats", "Storage", "Issues per project"]);
  await expect(zone(page).getByRole("button")).toHaveCount(1);
  expect((await subscriptionOf(page, COMPANY.umbrella))?.paidThrough).toBeUndefined();
});

test("Free once the allowance is used is refused through the real path — the row says so, nothing chosen, focus on the answer", async ({ page }) => {
  await inCompany(page, "Consolidated", COMPANY.longName, "priya@example.com");
  await openPlan(page, COMPANY.longName);
  const change = await openChange(page);
  await change.getByRole("radio", { name: "Free" }).check();
  await answer(page).click();
  await expect(change.getByRole("alert")).toHaveText(`You’ve used your one free company, so ${LONG_NAME} can’t move to Free.`);
  await expect(change.getByRole("radio", { name: "Free" })).toBeDisabled();
  await expect(change.getByText("You’ve used your one free company. Deleting it doesn’t bring it back.")).toBeVisible();
  await expect(change.getByRole("radio", { checked: true })).toHaveCount(0);
  await expect(answer(page)).toBeFocused();
  // The plan as it was.
  await change.getByRole("button", { name: "Cancel" }).click();
  await expect(zoneButton(page, "Change plan")).toBeFocused();
  await expect(fact(page, "Plan")).toHaveText("Team · version 2");
});

test("paid → cheaper paid: an invoice, Pay through the mock's checkout, and the new plan only once it settles — a new month", async ({ page }) => {
  await inCompany(page, "Umbrella", COMPANY.umbrella, "tom@example.com");
  await setHooks(page, { settlementDelayMs: 1500 });
  await openPlan(page, COMPANY.umbrella);
  const change = await openChange(page);
  await change.getByRole("radio", { name: /^Starter/ }).check();
  // paid → paid is neutral before the answer (guard B2).
  await expect(change.locator(".company-plan-change-consequences p")).toHaveText([
    "Taska shows when Starter starts, and what there is to pay, once you confirm.",
    "Nothing is charged when you confirm.",
  ]);
  await answer(page).click();

  await expect(dialog(page)).toHaveCount(0);
  await expect(said(page)).toHaveText("Invoice TSK-2026-01009 for Starter is ready in Billing. Umbrella moves to Starter once it’s paid.");
  const link = fact(page, "Pending change").getByRole("link", { name: "TSK-2026-01009" });
  await expect(link).toBeFocused();
  await expect(fact(page, "Pending change")).toHaveText("Starter · version 1, €10 a monthStarts once invoice TSK-2026-01009 is paid. Until then, Umbrella stays on Team.");
  await expect(fact(page, "Plan")).toHaveText("Team · version 1");

  await link.click();
  await expect(page.getByRole("heading", { level: 1, name: /Invoice TSK-2026-01009/ })).toBeFocused();
  await expect(page.getByText("Paying this invoice moves Umbrella to Starter. Until Starter starts, it stays on Team.")).toBeVisible();
  await page.getByRole("button", { name: "Pay €10.00" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Test checkout — no real payment" })).toBeFocused();
  await page.getByRole("button", { name: "Payment succeeds" }).click();
  await expect(page.locator(".company-payment-state")).toContainText("Confirming the payment.");
  await expect(page.locator(".company-payment-state")).toHaveText("Paid. Invoice TSK-2026-01009 is paid in full. Umbrella is now on Starter.", { timeout: 15_000 });

  await page.getByRole("navigation", { name: "Company" }).getByRole("link", { name: "Plan" }).click();
  await expect(fact(page, "Plan")).toHaveText("Starter · version 1");
  await expect(labels(page)).not.toContainText(["Pending change"]);
  // A month from the payment — not what was left of Team v1's period.
  const through = Date.parse((await subscriptionOf(page, COMPANY.umbrella))?.paidThrough ?? "");
  expect(through - Date.now()).toBeGreaterThan(29 * DAY);
  expect(through - Date.now()).toBeLessThanOrEqual(30 * DAY);
});

test("a dearer plan is scheduled from the next period, with its invoice in Billing; the old renewal is void", async ({ page }) => {
  await inCompany(page, "Umbrella", COMPANY.umbrella, "tom@example.com");
  await openPlan(page, COMPANY.umbrella);
  const change = await openChange(page);
  await change.getByRole("radio", { name: /^Business/ }).check();
  await answer(page).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(said(page)).toHaveText(
    new RegExp(`^Business starts ${DATE.source}\\. Nothing is charged now — pay its invoice in Billing before then, or Umbrella becomes read-only on that date\\.$`),
  );
  await expect(zoneButton(page, "Change plan")).toBeFocused();
  // What happens if it isn't paid by then is on the row (art-director blocker 2) — this session knows its invoice.
  await expect(fact(page, "Scheduled change")).toHaveText(
    new RegExp(
      `^Business · version 1, €40 a monthFrom ${DATE.source} · 20 projects · 200 seats · 50 GB storage · unlimited issuesIt starts only if invoice TSK-2026-01009 is paid by then\\. If it isn’t, Umbrella becomes read-only on that date\\.$`,
    ),
  );
  await expect(fact(page, "Scheduled change").getByRole("link", { name: "TSK-2026-01009" })).toHaveAttribute(
    "href",
    new RegExp(`/company/billing/[0-9a-f-]{36}$`),
  );
  await expect(fact(page, "Plan")).toHaveText("Team · version 1");

  // Its invoice is in Billing — the change's; the renewal of the old plan is VOID (the mock's A65).
  await page.getByRole("navigation", { name: "Company" }).getByRole("link", { name: "Billing" }).click();
  const row = page.locator(".company-invoice-row").filter({ hasText: "Plan change" });
  await expect(row).toContainText("TSK-2026-01009");
  await expect(row).toContainText("€40.00");
  await expect(page.locator(".company-invoice-row").filter({ has: page.getByRole("link", { name: "TSK-2026-01008" }) })).toContainText("void");
  await row.getByRole("link", { name: "TSK-2026-01009" }).click();
  await expect(page.getByText("Paying this invoice moves Umbrella to Business. Until Business starts, it stays on Team.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Pay €40.00" })).toBeVisible();
});

test("choosing the plan it is on while a change is scheduled withdraws it", async ({ page }) => {
  await inCompany(page, "Consolidated", COMPANY.longName, "priya@example.com");
  await openPlan(page, COMPANY.longName);
  let change = await openChange(page);
  // The current plan, while nothing is scheduled: «Current plan», not offered.
  await expect(change.getByRole("radio", { name: /^Team/ })).toBeDisabled();
  await change.getByRole("radio", { name: /^Business/ }).check();
  await answer(page).click();
  await expect(fact(page, "Scheduled change")).toContainText("Business · version 1, €40 a month");

  change = await openChange(page);
  await expect(change.getByRole("radio", { name: /^Business/ })).toBeDisabled();
  await expect(change.getByText(new RegExp(`^Already scheduled from ${DATE.source}$`))).toBeVisible();
  await change.getByRole("radio", { name: /^Team/ }).check();
  await expect(change.locator(".company-plan-change-consequences")).toHaveText(
    new RegExp(
      `^${LONG_NAME} stays on Team\\. The change to Business from ${DATE.source} is dropped — unless it’s already paid for; then it still starts on that date\\.$`,
    ),
  );
  await answer(page).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(said(page)).toHaveText(`The change to Business is dropped. ${LONG_NAME} stays on Team.`);
  await expect(labels(page)).not.toContainText(["Scheduled change"]);
  await expect(zoneButton(page, "Change plan")).toBeFocused();
});

test("a withdrawal whose subscription re-read is refused claims nothing about a payment (N1)", async ({ page }) => {
  await inCompany(page, "Consolidated", COMPANY.longName, "priya@example.com");
  await openPlan(page, COMPANY.longName);
  let change = await openChange(page);
  await change.getByRole("radio", { name: /^Business/ }).check();
  await answer(page).click();
  await expect(fact(page, "Scheduled change")).toContainText("Business · version 1");

  change = await openChange(page);
  await change.getByRole("radio", { name: /^Team/ }).check();
  // The dialog's own read has answered; the one after the command is refused, once.
  await setHooks(page, { refuseNext: { getSubscription: { status: 409, code: "INVALID_STATE" } } });
  await answer(page).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(said(page)).toHaveText(`${LONG_NAME}’s plan change was accepted.`);
  await expect(said(page)).not.toContainText("paid");
  await expect(page.getByText("The plan could not be refreshed. The last loaded details are shown.")).toBeVisible();
  await expect(zoneButton(page, "Change plan")).toBeFocused();
});

test("cancel renewal asks first, keeps what is paid, and turns into Resume renewal — which undoes it", async ({ page }) => {
  await inCompany(page, "Umbrella", COMPANY.umbrella, "tom@example.com");
  await openPlan(page, COMPANY.umbrella);
  await expect(zone(page)).toContainText(new RegExp(`Cancelling renewal keeps Umbrella on Team until ${DATE.source}, then makes it read-only\\.`));
  const trigger = zoneButton(page, "Cancel renewal");
  await trigger.click();
  const band = page.locator(".company-plan-band");
  await expect(band.getByRole("button", { name: "Keep renewal" })).toBeFocused();
  await expect(band).toContainText(
    "It doesn’t move to the free plan on its own. To keep renewing and pay by hand instead, turn off automatic payments in Billing.",
  );
  await page.keyboard.press("Escape");
  await expect(band).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await trigger.click();
  await band.getByRole("button", { name: "Cancel renewal" }).click();
  await expect(said(page)).toHaveText(new RegExp(`^Umbrella’s renewal is cancelled\\. It stays on Team until ${DATE.source}, then becomes read-only\\.$`));
  await expect(fact(page, "Renewal")).toHaveText("CancelledWhen the paid period ends, Umbrella becomes read-only. It doesn’t move to a free plan on its own.");
  await expect(fact(page, "Paid until")).toBeVisible();
  const resume = zoneButton(page, "Resume renewal");
  await expect(resume).toBeFocused();
  await expect(zone(page)).toContainText(new RegExp(`Resuming renewal keeps Umbrella on its plan after ${DATE.source}\\. It takes no payment now\\.`));

  await resume.click();
  await expect(said(page)).toHaveText(new RegExp(`^Umbrella renews again when its paid period ends, ${DATE.source}\\.$`));
  await expect(zoneButton(page, "Cancel renewal")).toBeFocused();
  await expect(labels(page)).not.toContainText(["Renewal"]);
});

test("past its paid period a cancelled renewal is read-only, offers no Resume renewal, and sells the plan it is on again", async ({ page }) => {
  await inCompany(page, "Consolidated", COMPANY.longName, "priya@example.com");
  await setHooks(page, { clockOffsetMs: 51 * DAY });
  await openPlan(page, COMPANY.longName);
  await expect(page.getByText("Its paid period has ended.")).toBeVisible();
  await expect(zone(page)).toContainText(new RegExp(`Renewal is cancelled, and the paid period ended ${DATE.source}\\. To use ${LONG_NAME} again, change its plan\\.`));
  await expect(zone(page).getByRole("button", { name: "Resume renewal" })).toHaveCount(0);
  await expect(fact(page, "Renewal")).toHaveText("Cancelled");

  const change = await openChange(page);
  const team = change.getByRole("radio", { name: /^Team/ });
  await expect(team).toBeEnabled();
  await team.check();
  await expect(change.locator(".company-plan-change-consequences p").first()).toHaveText(
    `Team starts once it’s paid for, with a month from the payment. Until then, ${LONG_NAME} stays on Team.`,
  );
  await answer(page).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(fact(page, "Pending change")).toContainText(/^Team · version 2, €20 a monthStarts once invoice TSK-2026-\d{5} is paid\./);
  await expect(fact(page, "Pending change").getByRole("link")).toBeFocused();
});

test("Turn off asks first, then the group says Off — and nothing anywhere turns them on", async ({ page }) => {
  await inCompany(page, "Umbrella", COMPANY.umbrella, "tom@example.com");
  await openCompanyZone(page, COMPANY.umbrella, "Billing");
  await expect(page.getByText("Automatic payments and invoices for Umbrella.")).toBeVisible();
  const group = page.getByRole("region", { name: "Automatic payments" });
  await expect(group).toContainText("OnTaska takes Umbrella’s payments automatically. You can still pay any invoice here yourself.");
  await group.getByRole("button", { name: "Turn off automatic payments" }).click();
  const band = page.locator(".company-autopay-band");
  await expect(band.getByRole("button", { name: "Keep them on" })).toBeFocused();
  await expect(band).toContainText(new RegExp(`If Umbrella isn’t paid for by ${DATE.source}, it becomes read-only\\. This version of Taska can’t turn them back on\\.`));
  await band.getByRole("button", { name: "Turn off", exact: true }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Automatic payments" })).toBeFocused();
  await expect(said(page)).toHaveText("Automatic payments are off for Umbrella.");
  await expect(group).toContainText(
    "OffYou pay Umbrella’s invoices here yourself. Automatic payments stay off until you set them up, which this version of Taska can’t do yet.",
  );
  await expect(page.getByRole("button", { name: /Turn on/ })).toHaveCount(0);
  await expect(page.getByText(/Turn on/)).toHaveCount(0);

  await page.getByRole("navigation", { name: "Company" }).getByRole("link", { name: "Plan" }).click();
  await expect(fact(page, "Automatic payments")).toHaveText("Off");
  await expect(page.getByRole("button", { name: /Turn on/ })).toHaveCount(0);
});

test("a 412 from a second tab on Change plan and Cancel renewal: said, read again, and a new press goes through", async ({ page }) => {
  await inCompany(page, "Umbrella", COMPANY.umbrella, "tom@example.com");
  await openPlan(page, COMPANY.umbrella);
  const other = await page.context().newPage();
  await other.goto(companyPath(COMPANY.umbrella, "/company/billing"));
  const otherGroup = other.getByRole("region", { name: "Automatic payments" });

  // Change plan: the dialog is open with a choice; the other tab turns automatic payments off.
  const change = await openChange(page);
  await change.getByRole("radio", { name: /^Starter/ }).check();
  await otherGroup.getByRole("button", { name: "Turn off automatic payments" }).click();
  await other.locator(".company-autopay-band").getByRole("button", { name: "Turn off", exact: true }).click();
  await expect(otherGroup).toContainText("Off");
  await answer(page).click();
  await expect(change.getByRole("alert")).toHaveText(
    "Umbrella’s plan details changed while you were deciding, so its plan wasn’t changed. Check what happens now and confirm again.",
  );
  await expect(change.getByRole("heading", { name: "Change plan" })).toBeFocused();
  await expect(change.getByRole("radio", { name: /^Starter/ })).toBeChecked();
  await answer(page).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(fact(page, "Pending change")).toContainText("Starter · version 1");

  // Cancel renewal: the band is open; the other tab changes the plan again.
  await zoneButton(page, "Cancel renewal").click();
  await other.goto(companyPath(COMPANY.umbrella, "/company/plan"));
  await other.locator(".company-plan-zone").getByRole("button", { name: "Change plan" }).click();
  await other.getByRole("dialog", { name: "Change plan" }).getByRole("radio", { name: /^Business/ }).check();
  await other.getByRole("dialog", { name: "Change plan" }).getByRole("button", { name: "Change plan" }).click();
  await expect(other.getByRole("dialog", { name: "Change plan" })).toHaveCount(0);
  await page.locator(".company-plan-band").getByRole("button", { name: "Cancel renewal" }).click();
  await expect(zone(page).locator(".error-note")).toContainText(
    "Umbrella’s plan details changed while you were deciding, so renewal wasn’t cancelled. Check it and try again.",
  );
  await expect(zoneButton(page, "Cancel renewal")).toBeFocused();
  await zoneButton(page, "Cancel renewal").click();
  await page.locator(".company-plan-band").getByRole("button", { name: "Cancel renewal" }).click();
  await expect(said(page)).toHaveText(/^Umbrella’s renewal is cancelled\./);
  await other.close();
});

test("a 412 from a second tab on Turn off and Resume renewal: said, read again, and a new press goes through", async ({ page }) => {
  await inCompany(page, "Umbrella", COMPANY.umbrella, "tom@example.com");
  await openCompanyZone(page, COMPANY.umbrella, "Billing");
  const group = page.getByRole("region", { name: "Automatic payments" });
  const other = await page.context().newPage();
  await other.goto(companyPath(COMPANY.umbrella, "/company/plan"));

  // Turn off: the band is open; the other tab cancels the renewal.
  await group.getByRole("button", { name: "Turn off automatic payments" }).click();
  await zoneButton(other, "Cancel renewal").click();
  await other.locator(".company-plan-band").getByRole("button", { name: "Cancel renewal" }).click();
  await expect(said(other)).toHaveText(/^Umbrella’s renewal is cancelled\./);
  await page.locator(".company-autopay-band").getByRole("button", { name: "Turn off", exact: true }).click();
  await expect(group.locator(".error-note")).toContainText(
    "Umbrella’s plan details changed while you were deciding, so automatic payments weren’t turned off. Check them and try again.",
  );
  await expect(group.getByRole("button", { name: "Turn off automatic payments" })).toBeFocused();
  await group.getByRole("button", { name: "Turn off automatic payments" }).click();
  await page.locator(".company-autopay-band").getByRole("button", { name: "Turn off", exact: true }).click();
  await expect(said(page)).toHaveText("Automatic payments are off for Umbrella.");

  // Resume renewal: the other tab schedules a plan change first.
  await page.getByRole("navigation", { name: "Company" }).getByRole("link", { name: "Plan" }).click();
  await expect(zoneButton(page, "Resume renewal")).toBeVisible();
  await zoneButton(other, "Change plan").click();
  await other.getByRole("dialog", { name: "Change plan" }).getByRole("radio", { name: /^Business/ }).check();
  await other.getByRole("dialog", { name: "Change plan" }).getByRole("button", { name: "Change plan" }).click();
  await expect(other.getByRole("dialog", { name: "Change plan" })).toHaveCount(0);
  await zoneButton(page, "Resume renewal").click();
  await expect(zone(page).locator(".error-note")).toContainText("Umbrella’s plan details changed elsewhere, so renewal wasn’t resumed. Check it and try again.");
  await expect(zoneButton(page, "Resume renewal")).toBeFocused();
  await zoneButton(page, "Resume renewal").click();
  await expect(said(page)).toHaveText(/^Umbrella renews again when its paid period ends/);
  await expect(zoneButton(page, "Cancel renewal")).toBeFocused();
  await other.close();
});

test("an answer that never came: the next press sends the same key, and the server changes the plan once", async ({ page }) => {
  await inCompany(page, "Umbrella", COMPANY.umbrella, "tom@example.com");
  await setHooks(page, { loseAnswer: ["changeSubscriptionPlan"] });
  await openPlan(page, COMPANY.umbrella);
  const change = await openChange(page);
  await change.getByRole("radio", { name: /^Starter/ }).check();
  await answer(page).click();
  await expect(change.getByRole("alert")).toContainText("Taska couldn’t confirm the plan change. Press Change plan again — it won’t be applied twice.");
  await expect(answer(page)).toBeFocused();
  await answer(page).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(said(page)).toHaveText(/^Invoice TSK-2026-01009 for Starter is ready in Billing\./);
  const state = await server(page);
  expect(Object.keys(state.billingReceipts).filter((key) => key.startsWith(`${COMPANY.umbrella}:`))).toHaveLength(1);
  expect(state.invoices.filter((invoice) => invoice.tenantId === COMPANY.umbrella && invoice.purpose === "PLAN_CHANGE")).toHaveLength(1);
});

test("a non-owner has no zone, no group and sends no billing request — even at Billing's address", async ({ page }) => {
  await inCompany(page, "Umbrella", COMPANY.umbrella, "priya@example.com");
  const untaken = {
    getSubscription: { status: 503, code: "DEPENDENCY_UNAVAILABLE" },
    listInvoices: { status: 503, code: "DEPENDENCY_UNAVAILABLE" },
    changeSubscriptionPlan: { status: 503, code: "DEPENDENCY_UNAVAILABLE" },
    cancelSubscriptionRenewal: { status: 503, code: "DEPENDENCY_UNAVAILABLE" },
    resumeSubscriptionRenewal: { status: 503, code: "DEPENDENCY_UNAVAILABLE" },
    setAutopayConsent: { status: 503, code: "DEPENDENCY_UNAVAILABLE" },
  };
  await setHooks(page, { refuseNext: untaken });
  await openPlan(page, COMPANY.umbrella);
  await expect(page.getByRole("button", { name: "Change plan" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /renewal/ })).toHaveCount(0);
  await expect(page.locator(".company-plan-zone")).toHaveCount(0);
  await page.goto(companyPath(COMPANY.umbrella, "/company/billing"));
  await expect(page.getByText("Invoices and payments for Umbrella are shown only to its owner.")).toBeVisible();
  await expect(page.getByText("Automatic payments")).toHaveCount(0);
  await page.goto(`${B2B}/c/${COMPANY.umbrella}/company/billing/${INVOICE.umbrellaRenewal}`);
  await expect(page.getByText("Invoices and payments for Umbrella are shown only to its owner.")).toBeVisible();
  const hooks = await page.evaluate(() => JSON.parse(window.localStorage.getItem("taska.mockTenantHooks") ?? "{}") as { refuseNext?: Record<string, unknown> });
  expect(Object.keys(hooks.refuseNext ?? {}).sort()).toEqual(Object.keys(untaken).sort());
});

test("a scheduled change that is already paid for is not dropped by choosing the plan it is on — it still starts (guard M-2)", async ({ page }) => {
  await inCompany(page, "Consolidated", COMPANY.longName, "priya@example.com");
  await setHooks(page, { settlementDelayMs: 500 });
  await openPlan(page, COMPANY.longName);
  let change = await openChange(page);
  await change.getByRole("radio", { name: /^Business/ }).check();
  await answer(page).click();
  const link = fact(page, "Scheduled change").getByRole("link", { name: /^TSK-2026-\d{5}$/ });
  await link.click();
  await page.getByRole("button", { name: "Pay €40.00" }).click();
  await page.getByRole("button", { name: "Payment succeeds" }).click();
  await expect(page.locator(".company-payment-state")).toContainText("Paid.", { timeout: 15_000 });

  await page.getByRole("navigation", { name: "Company" }).getByRole("link", { name: "Plan" }).click();
  change = await openChange(page);
  await change.getByRole("radio", { name: /^Team/ }).check();
  await expect(change.locator(".company-plan-change-consequences")).toContainText("is dropped — unless it’s already paid for; then it still starts on that date.");
  await answer(page).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(said(page)).toHaveText(new RegExp(`^The change to Business is already paid for, so it still starts ${DATE.source}\\.$`));
  await expect(zoneButton(page, "Change plan")).toBeFocused();
  await expect(fact(page, "Scheduled change")).toContainText("Business · version 1, €40 a month");
});

test("a Pending change another tab superseded goes once this tab reads the subscription again (guard M-1)", async ({ page }) => {
  await inCompany(page, "Umbrella", COMPANY.umbrella, "tom@example.com");
  await openPlan(page, COMPANY.umbrella);
  let change = await openChange(page);
  await change.getByRole("radio", { name: /^Starter/ }).check();
  await answer(page).click();
  await expect(fact(page, "Pending change")).toContainText("Starter · version 1");

  const other = await page.context().newPage();
  await other.goto(companyPath(COMPANY.umbrella, "/company/plan"));
  await zoneButton(other, "Change plan").click();
  await other.getByRole("dialog", { name: "Change plan" }).getByRole("radio", { name: /^Business/ }).check();
  await other.getByRole("dialog", { name: "Change plan" }).getByRole("button", { name: "Change plan" }).click();
  await expect(other.getByRole("dialog", { name: "Change plan" })).toHaveCount(0);
  await other.close();

  // Opening «Change plan» reads the subscription again; the superseded row goes with it.
  change = await openChange(page);
  await change.getByRole("button", { name: "Cancel" }).click();
  await expect(fact(page, "Scheduled change")).toContainText("Business · version 1");
  await expect(labels(page)).not.toContainText(["Pending change"]);
});

test("a 412 on Turn off whose re-read finds them off already is said as done, with focus on the group's heading", async ({ page }) => {
  await inCompany(page, "Umbrella", COMPANY.umbrella, "tom@example.com");
  await openCompanyZone(page, COMPANY.umbrella, "Billing");
  const group = page.getByRole("region", { name: "Automatic payments" });
  await group.getByRole("button", { name: "Turn off automatic payments" }).click();
  const other = await page.context().newPage();
  await other.goto(companyPath(COMPANY.umbrella, "/company/billing"));
  const otherGroup = other.getByRole("region", { name: "Automatic payments" });
  await otherGroup.getByRole("button", { name: "Turn off automatic payments" }).click();
  await other.locator(".company-autopay-band").getByRole("button", { name: "Turn off", exact: true }).click();
  await expect(otherGroup).toContainText("Off");
  await other.close();
  await page.locator(".company-autopay-band").getByRole("button", { name: "Turn off", exact: true }).click();
  await expect(said(page)).toHaveText("Automatic payments are already off for Umbrella.");
  await expect(page.getByRole("heading", { level: 2, name: "Automatic payments" })).toBeFocused();
  await expect(group.locator(".error-note")).toHaveCount(0);
  await expect(page.locator(".company-autopay-band")).toHaveCount(0);
  await expect(group).toContainText("Off");
});

test("closed after an answer that never came, «Change plan» reopens on it — the choice, its sentence and focus — and the press repeats it", async ({ page }) => {
  await inCompany(page, "Umbrella", COMPANY.umbrella, "tom@example.com");
  await setHooks(page, { loseAnswer: ["changeSubscriptionPlan"] });
  await openPlan(page, COMPANY.umbrella);
  let change = await openChange(page);
  await change.getByRole("radio", { name: /^Starter/ }).check();
  await answer(page).click();
  await expect(change.getByRole("alert")).toContainText("Taska couldn’t confirm the plan change.");
  await change.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog(page)).toHaveCount(0);

  await zoneButton(page, "Change plan").click();
  change = dialog(page);
  await expect(change.getByRole("radio", { name: /^Starter/ })).toBeChecked();
  await expect(change.getByRole("radio", { name: /^Starter/ })).toBeFocused();
  // Drawn again, not announced again.
  await expect(change.locator(".error-note")).toContainText("Taska couldn’t confirm the plan change. Press Change plan again — it won’t be applied twice.");
  await expect(change.getByRole("alert")).toHaveCount(0);
  await answer(page).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(said(page)).toHaveText(/^Invoice TSK-2026-01009 for Starter is ready in Billing\./);
  const state = await server(page);
  expect(state.invoices.filter((invoice) => invoice.tenantId === COMPANY.umbrella && invoice.purpose === "PLAN_CHANGE")).toHaveLength(1);
});
