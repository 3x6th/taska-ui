import { expect, test, type Page } from "@playwright/test";
import { B2B, COMPANY, INVOICE, companyPath, companyRow, inCompany, openCompanyZone, setHooks, signIn } from "./companiesFixtures";

/*
 * Hosted checkout and the confirmed payment status in the companies build
 * (TAS-513) against the third e2e server's mock: Pay opens the mock's stand-in
 * payment page, its outcomes come back through the static return addresses,
 * and the invoice ends at the server's state — never at what an address says.
 * The story's acceptance: a `?success` without settlement never grants paid;
 * a double click or two tabs make one payment; another company's return never
 * swaps the tab's company; 3-D Secure, cancel, a late answer and a reload end
 * at the server's state; the page address never reaches the DOM or the
 * console; checkout off is explained.
 */

const renewalPath = companyPath(COMPANY.umbrella, `/company/billing/${INVOICE.umbrellaRenewal}`);
const renewalRow = (page: Page) => page.locator(".company-invoice-row").filter({ has: page.getByRole("link", { name: "TSK-2026-01008" }) });
const stateBlock = (page: Page) => page.locator(".company-payment-state");
const fact = (page: Page, label: string) =>
  page.locator(".company-invoice-facts > div").filter({ has: page.locator("dt", { hasText: new RegExp(`^${label}$`) }) }).locator("dd");
const mockPage = (page: Page) => page.getByRole("heading", { level: 1, name: "Test checkout — no real payment" });

/** The mock server's checkouts of an invoice — its own record, read from the shared storage. */
const checkoutsOf = (page: Page, invoiceId: string) =>
  page.evaluate((id) => {
    const state = JSON.parse(window.localStorage.getItem("taska.mockServer.v6") ?? "{}") as { checkouts?: Array<{ invoiceId: string }> };
    return (state.checkouts ?? []).filter((checkout) => checkout.invoiceId === id).length;
  }, invoiceId);

const invoiceStateOf = (page: Page, invoiceId: string) =>
  page.evaluate((id) => {
    const state = JSON.parse(window.localStorage.getItem("taska.mockServer.v6") ?? "{}") as { invoices?: Array<{ id: string; state: string }> };
    return state.invoices?.find((invoice) => invoice.id === id)?.state ?? null;
  }, invoiceId);

/** Tom in Umbrella, on Billing, with `hooks` set; the renewal's Pay pressed and the stand-in page open. */
async function payRenewal(page: Page, hooks: Record<string, unknown> = {}) {
  await inCompany(page, "Umbrella", COMPANY.umbrella, "tom@example.com");
  await setHooks(page, hooks);
  await openCompanyZone(page, COMPANY.umbrella, "Billing");
  await expect(renewalRow(page)).toContainText("unpaid");
  await renewalRow(page).getByRole("button", { name: "Pay" }).click();
  await expect(page).toHaveURL(new RegExp(`^${B2B}/mock-checkout/mcs_[0-9a-f]+$`));
  await expect(mockPage(page)).toBeFocused();
}

test("pay: the provider says yes, the invoice reads «Confirming» and then «Paid.» once the server settles — the page address in no DOM and no log", async ({ page }) => {
  const logged: string[] = [];
  page.on("console", (message) => logged.push(message.text()));
  await payRenewal(page, { settlementDelayMs: 2500 });
  await expect(page).toHaveTitle("Test checkout — Taska mock");
  await expect(page.locator(".mock-checkout dl")).toContainText("Umbrella");
  await expect(page.locator(".mock-checkout dl")).toContainText("€20.00");
  await page.getByRole("button", { name: "Payment succeeds" }).click();

  await expect(page).toHaveURL(renewalPath);
  await expect(stateBlock(page)).toContainText("Confirming the payment.");
  await expect(page.getByRole("heading", { level: 1, name: /Invoice TSK-2026-01008/ })).toBeFocused();
  await expect(page.getByRole("button", { name: /^Pay/ })).toHaveCount(0);
  await expect(stateBlock(page)).toHaveText("Paid. Invoice TSK-2026-01008 is paid in full.", { timeout: 15_000 });
  await expect(fact(page, "Status")).toHaveText("Paid");
  const body = await page.evaluate(() => document.body.innerHTML);
  expect(body).not.toContain("/mock-checkout/");
  expect(body).not.toContain("mcs_");
  expect(logged.filter((line) => line.includes("mock-checkout") || line.includes("mcs_"))).toEqual([]);
});

test("a failure: «The payment didn’t go through.» and Pay again", async ({ page }) => {
  await payRenewal(page);
  await page.getByRole("button", { name: "Payment fails" }).click();
  await expect(page).toHaveURL(renewalPath);
  await expect(stateBlock(page)).toHaveText(
    "The payment didn’t go through. The invoice is still unpaid. You can pay it again with the same card or another one.",
  );
  await expect(page.getByRole("button", { name: "Pay €20.00" })).toBeVisible();
  expect(await invoiceStateOf(page, INVOICE.umbrellaRenewal)).toBe("OPEN");
});

test("a cancel: «You left the payment page.», and «Return to payment» opens the same checkout — never a new one", async ({ page }) => {
  await payRenewal(page);
  const first = await page.locator(".mock-checkout-id").textContent();
  await page.getByRole("button", { name: "Cancel and go back" }).click();
  await expect(page).toHaveURL(renewalPath);
  await expect(stateBlock(page)).toHaveText("You left the payment page. The invoice is still unpaid.");
  await expect(page.getByRole("button", { name: /^Pay/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Return to payment" }).click();
  await expect(mockPage(page)).toBeVisible();
  await expect(page.locator(".mock-checkout-id")).toHaveText(first ?? "");
  expect(await checkoutsOf(page, INVOICE.umbrellaRenewal)).toBe(1);
});

test("the bank doesn’t answer: no Pay while it is UNKNOWN, and the late answer ends at «Paid.»", async ({ page }) => {
  await payRenewal(page, { settlementDelayMs: 0 });
  await page.getByRole("button", { name: "Bank doesn’t answer (unknown)" }).click();
  await expect(page).toHaveURL(renewalPath);
  await expect(stateBlock(page)).toContainText("We’re confirming this payment with the bank.");
  await expect(page.getByRole("button", { name: /^Pay/ })).toHaveCount(0);
  // A reload is the same: the record, not the page, knows there is a payment out.
  await page.reload();
  await expect(stateBlock(page)).toContainText("We’re confirming this payment with the bank.");
  await expect(page.getByRole("button", { name: /^Pay/ })).toHaveCount(0);
  await setHooks(page, { settlementDelayMs: 0, resolveCheckout: { [INVOICE.umbrellaRenewal]: "SUCCEEDED" } });
  await expect(stateBlock(page)).toHaveText("Paid. Invoice TSK-2026-01008 is paid in full.", { timeout: 15_000 });
});

test("a double click, and two tabs pressing at once, make one checkout", async ({ page }) => {
  await inCompany(page, "Umbrella", COMPANY.umbrella, "tom@example.com");
  await openCompanyZone(page, COMPANY.umbrella, "Billing");
  const second = await page.context().newPage();
  await second.goto(companyPath(COMPANY.umbrella, "/company/billing"));
  await expect(renewalRow(second).getByRole("button", { name: "Pay" })).toBeVisible();
  await expect(renewalRow(page).getByRole("button", { name: "Pay" })).toBeVisible();
  const press = () => {
    const button = document.querySelector<HTMLButtonElement>(".company-invoice-row .company-billing-pay");
    button?.click();
    button?.click();
  };
  await Promise.all([page.evaluate(press), second.evaluate(press)]);
  await expect(page).toHaveURL(/\/mock-checkout\//);
  await expect.poll(() => checkoutsOf(page, INVOICE.umbrellaRenewal)).toBe(1);
  const url = page.url();
  // The other tab either went to the same page or no longer offers Pay — never a second checkout.
  await expect
    .poll(async () => second.url() === url || (await renewalRow(second).getByRole("button", { name: "Pay" }).count()) === 0)
    .toBe(true);
  expect(await checkoutsOf(page, INVOICE.umbrellaRenewal)).toBe(1);
  await second.close();
});

test("a return address that says «success» is never a payment: no record — nothing to show; an open checkout — «Confirming», never «Paid»", async ({ page }) => {
  await inCompany(page, "Umbrella", COMPANY.umbrella, "tom@example.com");
  await page.goto(`${B2B}/billing/return?success=true&redirect_status=succeeded`);
  await expect(page).toHaveURL(`${B2B}/billing/return`);
  await expect(page.getByText("We can’t find a payment started in this browser — open Billing to see its state.")).toBeVisible();
  expect(await invoiceStateOf(page, INVOICE.umbrellaRenewal)).toBe("OPEN");

  await page.goto(companyPath(COMPANY.umbrella, "/company/billing"));
  await renewalRow(page).getByRole("button", { name: "Pay" }).click();
  await expect(mockPage(page)).toBeVisible();
  // The provider never answered; somebody types the success address.
  await page.goto(`${B2B}/billing/return?success=1`);
  await expect(page).toHaveURL(renewalPath);
  await expect(stateBlock(page)).toContainText("Confirming the payment.");
  await page.waitForTimeout(3500);
  await expect(stateBlock(page)).not.toContainText("Paid");
  await expect(fact(page, "Status")).toHaveText("Confirming");
  expect(await invoiceStateOf(page, INVOICE.umbrellaRenewal)).toBe("OPEN");
});

test("a return in a tab working in another company never switches it: it says whose payment it is", async ({ page }) => {
  await payRenewal(page);
  const other = await page.context().newPage();
  await other.goto(companyPath(COMPANY.stark, "/projects"));
  await expect(other.getByRole("heading", { level: 1, name: /Stark Industries/ })).toBeVisible();
  await other.goto(`${B2B}/billing/return`);
  await expect(other.getByText(/^This payment belongs to Umbrella\.$/)).toBeVisible();
  await expect(other.getByRole("link", { name: "Umbrella" })).toHaveAttribute("href", `/c/${COMPANY.umbrella}/company/billing/${INVOICE.umbrellaRenewal}`);
  await expect(other).toHaveURL(`${B2B}/billing/return`);
  const tab = await other.evaluate(() => JSON.parse(window.sessionStorage.getItem("taska.tab") ?? "{}") as { tenantId?: string });
  expect(tab.tenantId).toBe(COMPANY.stark);
  await other.close();
});

test("checkout off is explained under Pay, nothing opens, and focus stays on Pay", async ({ page }) => {
  await inCompany(page, "Umbrella", COMPANY.umbrella, "tom@example.com");
  await setHooks(page, { checkoutOff: { status: 503, code: "POLICY_NOT_CONFIGURED" } });
  await openCompanyZone(page, COMPANY.umbrella, "Billing");
  const pay = renewalRow(page).getByRole("button", { name: "Pay" });
  await pay.click();
  await expect(renewalRow(page).getByRole("alert")).toHaveText(
    "Online payment isn’t available for this company yet, so the payment page wasn’t opened and nothing was charged.",
  );
  await expect(pay).toBeFocused();
  await expect(page).toHaveURL(companyPath(COMPANY.umbrella, "/company/billing"));
  expect(await checkoutsOf(page, INVOICE.umbrellaRenewal)).toBe(0);
});

test("a member who is not the owner has no Billing, and no billing request goes out — even at its address", async ({ page }) => {
  await inCompany(page, "Umbrella", COMPANY.umbrella, "priya@example.com");
  // A billing read would take one of these refusals, once: they stay untaken.
  await setHooks(page, {
    refuseNext: {
      listInvoices: { status: 503, code: "DEPENDENCY_UNAVAILABLE" },
      getInvoice: { status: 503, code: "DEPENDENCY_UNAVAILABLE" },
    },
  });
  await openCompanyZone(page, COMPANY.umbrella, "Plan");
  const rail = page.getByRole("navigation", { name: "Company" });
  await expect(rail.getByRole("link", { name: "Billing" })).toHaveCount(0);
  await page.goto(companyPath(COMPANY.umbrella, "/company/billing"));
  await expect(page.getByText("Invoices and payments for Umbrella are shown only to its owner.")).toBeVisible();
  await page.goto(renewalPath);
  await expect(page.getByText("Invoices and payments for Umbrella are shown only to its owner.")).toBeVisible();
  const hooks = await page.evaluate(() => JSON.parse(window.localStorage.getItem("taska.mockTenantHooks") ?? "{}") as { refuseNext?: Record<string, unknown> });
  expect(Object.keys(hooks.refuseNext ?? {}).sort()).toEqual(["getInvoice", "listInvoices"]);
});

test("the never-opened card: Pay its first invoice, and the company opens once the server confirms it", async ({ page }) => {
  await signIn(page, "tom@example.com");
  await setHooks(page, { settlementDelayMs: 1500 });
  await companyRow(page, /^Stark Industries/).click();
  await expect(page).toHaveURL(companyPath(COMPANY.stark));
  await expect(page.getByText("Invoice TSK-2026-01006 · €20.00")).toBeVisible();
  await page.getByRole("button", { name: "Pay €20.00" }).click();
  await expect(mockPage(page)).toBeVisible();
  await page.getByRole("button", { name: "Payment succeeds" }).click();

  await expect(page).toHaveURL(companyPath(COMPANY.stark));
  await expect(page.locator(".company-payment-state")).toContainText("Confirming the payment.");
  await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Stark Industries is ready.")).toBeAttached();
  expect(await invoiceStateOf(page, INVOICE.starkInitial)).toBe("PAID");
});
