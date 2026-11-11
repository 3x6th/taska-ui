import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { B2B, COMPANY, INVOICE, MOCK_SERVER_KEY, companyPath, inCompany, openCompanyZone, setHooks, signIn } from "./companiesFixtures";

/*
 * Bank-transfer invoices, their document and refunds in the companies build
 * (TAS-514) against the third e2e server's mock (`MOCK_SERVER_KEY`). Every
 * fixture is Cyberdyne Systems' — Tom's company that pays by bank transfer —
 * and the bank's side is the mock's admin hooks: a statement line recorded,
 * confirmed against an invoice, its unallocated money returned. The owner
 * reads none of that; the invoice, the subscription and the refunds say what
 * happened. The story's acceptance: a partial payment waits for the rest until
 * the due date and is then shown for refund; 25 against 20 covers 20 and
 * returns 5 without losing the subscription; a late first payment is refunded
 * with a new invoice; a late renewal starts a new month from its
 * confirmation; old invoices keep their buyer; only the owner downloads; and
 * the reconciliation target is never a countdown or a promise.
 */

const CY = COMPANY.cyberdyne;
const DAY = 24 * 60 * 60_000;
const renewalPath = companyPath(CY, `/company/billing/${INVOICE.cyberdyneRenewal}`);
const stateBlock = (page: Page) => page.locator(".company-payment-state");
const bank = (page: Page) => page.getByRole("region", { name: "Bank transfer" });
const bankValue = (page: Page, label: string) =>
  bank(page)
    .locator(".company-bank-details > div")
    .filter({ has: page.locator("dt", { hasText: new RegExp(`^${label}$`) }) })
    .locator("dd");
const fact = (page: Page, label: string) =>
  page.locator(".company-invoice-facts > div").filter({ has: page.locator("dt", { hasText: new RegExp(`^${label}$`) }) }).locator("dd");
const refundRow = (page: Page, reason: string) =>
  page.getByRole("region", { name: /^Refunds/ }).locator(".company-refund-row").filter({ has: page.getByText(reason, { exact: true }) });
const paidUntil = (page: Page) =>
  page.locator(".company-plan dl > div").filter({ has: page.locator("dt", { hasText: /^Paid until$/ }) }).locator("time");

/** Tom in Cyberdyne Systems, its open renewal on screen — with `hooks` set first, when there are any. */
async function onRenewal(page: Page, hooks: Record<string, unknown> | null = null) {
  await inCompany(page, "Cyberdyne Systems", CY, "tom@example.com");
  if (hooks !== null) await setHooks(page, hooks);
  await page.goto(renewalPath);
  await expect(page.getByRole("heading", { level: 1, name: /Invoice TSK-2026-00904/ })).toBeVisible();
}

/** The receipt a test records, and its confirmation against the open renewal: the admin's side, as hooks. */
const receipt = (id: string, amountMinor: string, extra: Record<string, unknown> = {}) => ({
  wireReceipts: [{ id, tenantId: CY, amountMinor, ...extra }],
  confirmWire: { [id]: INVOICE.cyberdyneRenewal },
});

/** Reads the open invoice again the way the page does on a return to the tab (B3) — no reload. */
const comeBack = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event("focus")));

test("a wire invoice: its bank details verbatim, Copy copies the server's exact value and says so, focus stays — and no Pay", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: B2B });
  await inCompany(page, "Cyberdyne Systems", CY, "tom@example.com");
  await openCompanyZone(page, CY, "Billing");
  const row = page.locator(".company-invoice-row").filter({ has: page.getByRole("link", { name: "TSK-2026-00904" }) });
  await expect(row).toContainText("Renewal · Due");
  await expect(row).toContainText("Bank transfer");
  await expect(row.getByRole("button", { name: "Pay" })).toHaveCount(0);
  await row.getByRole("link", { name: "TSK-2026-00904" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Invoice TSK-2026-00904/ })).toBeFocused();

  await expect(stateBlock(page)).toHaveText(
    "Waiting for the bank transfer. If you’ve already sent it, there’s nothing more to do — this invoice shows it once Taska has matched it.",
  );
  await expect(page.getByRole("button", { name: /^Pay/ })).toHaveCount(0);
  await expect(bank(page).locator(".company-bank-lead")).toHaveText(/^Send €20\.00 to this account\. It has to arrive by [A-Z][a-z]{2} \d{1,2}, \d\d:\d\d\.$/);
  await expect(bankValue(page, "Beneficiary")).toHaveText("Taska Mock S.L. (test only)");
  await expect(bankValue(page, "IBAN")).toHaveText("XX00 MOCK 0000 0000 0000 0000");
  await expect(bankValue(page, "BIC")).toHaveText("MOCKESM0XXX");
  await expect(bankValue(page, "Bank")).toHaveText("Mock Bank");
  await expect(bankValue(page, "Amount")).toHaveText("€20.00");
  // The reference exactly as the server sent it — not the number — and the rule beside it.
  await expect(bankValue(page, "Reference").locator(".company-bank-value")).toHaveText("TASKA-TSK-2026-00904");
  await expect(bankValue(page, "Reference")).toContainText("Use this, not the invoice number.");
  // The target from the company's capabilities (86 400 s), never a countdown, a start or an end.
  await expect(bank(page).locator(".company-bank-note")).toContainText(
    "Taska matches bank transfers to invoices by hand, and aims to do it within 24 hours of the money arriving. Until then this invoice shows as unpaid — don’t send it again.",
  );
  await expect(bank(page).locator(".company-bank-note")).toContainText("For the due date, what counts is when the money arrives, not when Taska matches it.");
  await expect(bank(page).locator(".company-bank-note")).toContainText(/it still renews Cyberdyne Systems, but the new month starts when Taska matches it\./);
  await expect(page.locator(".company-invoice")).not.toContainText(/remaining|left to match|since/i);

  // The keyboard path (B15): Download PDF, then the four Copy controls in SEPA order.
  await page.getByRole("button", { name: "Download PDF of invoice TSK-2026-00904" }).focus();
  for (const name of ["Copy beneficiary name", "Copy IBAN", "Copy BIC", "Copy reference"]) {
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name })).toBeFocused();
  }

  // Copy: the electronic IBAN as received, the status said once, focus kept on the control.
  const copyIban = page.getByRole("button", { name: "Copy IBAN" });
  await copyIban.click();
  await expect(copyIban).toBeFocused();
  await expect(bank(page).locator(".company-bank-copy-status")).toHaveText("IBAN copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("XX00MOCK0000000000000000");
  const copyReference = page.getByRole("button", { name: "Copy reference" });
  await copyReference.click();
  await expect(bank(page).locator(".company-bank-copy-status")).toHaveText("Reference copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("TASKA-TSK-2026-00904");
  // Cleared after two seconds: the region empties, and takes no room.
  await expect(bank(page).locator(".company-bank-copy-status")).toHaveText("", { timeout: 5000 });
});

test("the reconciliation target omitted by the server: the sentence says no number — never a 24-hour default", async ({ page }) => {
  await onRenewal(page, { reconciliationTargetSeconds: null });
  await expect(bank(page).locator(".company-bank-note")).toContainText(
    "Taska matches bank transfers to invoices by hand once the money arrives. Until then this invoice shows as unpaid — don’t send it again.",
  );
  await expect(bank(page).locator(".company-bank-note")).not.toContainText(/hour|minute|day/);
  // Another target is said as it came.
  await setHooks(page, { reconciliationTargetSeconds: 5400 });
  await page.reload();
  await expect(bank(page).locator(".company-bank-note")).toContainText("within 1 hour 30 minutes of the money arriving");
});

test("12 of 20: Received and what is left, the rule; past the due date it is to be refunded; then a refund row, and the money goes back", async ({ page }) => {
  const partial = receipt("r-partial", "1200");
  await onRenewal(page, partial);
  await expect(stateBlock(page)).toHaveText(
    /^Part of the bank transfer has arrived\. The invoice is paid once all of it has\. If the rest doesn’t arrive by [A-Z][a-z]{2} \d{1,2}, \d\d:\d\d, the €12\.00 that arrived is refunded\.$/,
  );
  await expect(fact(page, "Status")).toHaveText("Part paid");
  await expect(fact(page, "Received")).toHaveText("€12.00Counts only once all €20.00 has arrived.");
  await expect(fact(page, "Left to pay")).toHaveText("€8.00");
  await expect(page.locator(".company-invoice-facts")).not.toContainText("Paid so far");
  await expect(bankValue(page, "Amount")).toHaveText("€8.00The rest of €20.00 — €12.00 has already arrived.");
  await expect(bank(page).locator(".company-bank-lead")).toHaveText(/^Send €8\.00 to this account\./);

  // The due date passes without the rest: EXPIRED on the server, the €12 to be refunded — no bank details any more.
  const expired = { ...partial, clockOffsetMs: 5 * DAY };
  await setHooks(page, expired);
  await page.reload();
  await expect(page.locator(".company-invoice-closed")).toHaveText("This invoice can no longer be paid. The €12.00 that arrived for it is to be refunded.");
  await expect(bank(page)).toHaveCount(0);
  await expect(fact(page, "Status")).toHaveText("Expired");
  await expect(fact(page, "Received")).toHaveText("€12.00");
  await expect(page.getByRole("button", { name: "Download PDF of invoice TSK-2026-00904" })).toBeVisible();

  // The admin returns it: a refund row on Billing, of its own — no invoice named.
  await setHooks(page, { ...expired, returnUnallocated: ["r-partial"] });
  await page.goto(companyPath(CY, "/company/billing"));
  await expect(page.getByRole("heading", { name: /^Refunds/ })).toHaveText("Refunds2");
  await expect(
    page.getByText("Refunds go back to the account the money came from. The dates below are Taska’s — when the money shows in that account depends on the banks."),
  ).toBeVisible();
  const row = refundRow(page, "Bank transfer not completed in time");
  await expect(row).toContainText("€12.00");
  await expect(row).toContainText(/Bank transfer · Requested [A-Z][a-z]{2} \d{1,2}/);
  await expect(row.locator(".company-refund-status .company-marker")).toHaveText("requested");
  await expect(row).not.toContainText("TSK-2026-00904");

  // Its evidence complete: «Taska aims to send it by» — a send date, never an arrival; then confirmed.
  await setHooks(page, { ...expired, returnUnallocated: ["r-partial"], evidenceComplete: ["r-partial"], refundProgress: { "r-partial": "APPROVED" } });
  await page.reload();
  // TAS-516 (T3): the history, each step from its own field — requested, approved, then the server's send date.
  await expect(refundRow(page, "Bank transfer not completed in time")).toContainText(
    /Bank transfer · Requested [A-Z][a-z]{2} \d{1,2} · Approved [A-Z][a-z]{2} \d{1,2} · Taska aims to send it by [A-Z][a-z]{2} \d{1,2}/,
  );
  await setHooks(page, { ...expired, returnUnallocated: ["r-partial"], evidenceComplete: ["r-partial"], refundProgress: { "r-partial": "CONFIRMED" } });
  await page.reload();
  await expect(refundRow(page, "Bank transfer not completed in time")).toContainText(
    /Bank transfer · Requested [A-Z][a-z]{2} \d{1,2} · Approved [A-Z][a-z]{2} \d{1,2} · Refunded [A-Z][a-z]{2} \d{1,2}/,
  );
  await expect(refundRow(page, "Bank transfer not completed in time").locator(".company-refund-status .company-marker")).toHaveText("refunded");
  await page.goto(renewalPath);
  await expect(page.locator(".company-invoice-closed")).toHaveText("This invoice can no longer be paid.");
  await expect(page.locator(".company-invoice-facts")).not.toContainText("Received");
});

test("25 against 20: Paid €20, the paid period moves on and stays — and a refund row «Overpayment €5»", async ({ page }) => {
  await inCompany(page, "Cyberdyne Systems", CY, "tom@example.com");
  await openCompanyZone(page, CY, "Plan");
  const before = await paidUntil(page).getAttribute("datetime");
  expect(before).not.toBeNull();

  await page.goto(renewalPath);
  await expect(stateBlock(page)).toContainText("Waiting for the bank transfer.");
  await setHooks(page, receipt("r-over", "2500"));
  // Settled while the page was open: read again on the return to the tab, and said once.
  await comeBack(page);
  await expect(stateBlock(page)).toHaveText("Paid. Invoice TSK-2026-00904 is paid in full.");
  await expect(fact(page, "Status")).toHaveText("Paid");
  await expect(fact(page, "Amount")).toHaveText("€20.00");
  await expect(bank(page)).toHaveCount(0);
  await expect(page.locator(".company-invoice-facts")).not.toContainText(/Received|Left to pay/);

  // An early renewal: a month from the current end — the subscription never lapses.
  await page.goto(companyPath(CY, "/company/plan"));
  await expect(paidUntil(page)).not.toHaveAttribute("datetime", before ?? "");
  const after = await paidUntil(page).getAttribute("datetime");
  expect(Date.parse(after ?? "") - Date.parse(before ?? "")).toBe(30 * DAY);

  await setHooks(page, { ...receipt("r-over", "2500"), returnUnallocated: ["r-over"] });
  await page.goto(companyPath(CY, "/company/billing"));
  const row = refundRow(page, "Overpayment");
  await expect(row).toContainText("€5.00");
  await expect(row).toContainText("Bank transfer · Requested");
  const invoiceRow = page.locator(".company-invoice-row").filter({ has: page.getByRole("link", { name: "TSK-2026-00904" }) });
  await expect(invoiceRow).toContainText("€20.00");
  await expect(invoiceRow.locator(".company-invoice-status .company-marker")).toHaveText("paid");
});

test("a late renewal (D247): the invoice expired, the money confirmed after it — Paid, a new month from the confirmation", async ({ page }) => {
  await inCompany(page, "Cyberdyne Systems", CY, "tom@example.com");
  const late = { clockOffsetMs: 6 * DAY };
  await setHooks(page, late);
  await page.goto(renewalPath);
  await expect(page.locator(".company-invoice-closed")).toHaveText("This invoice can no longer be paid.");
  await page.goto(companyPath(CY, "/company/plan"));
  const lapsed = await paidUntil(page).getAttribute("datetime");

  await setHooks(page, { ...late, ...receipt("r-late", "2000") });
  await page.goto(renewalPath);
  await expect(fact(page, "Status")).toHaveText("Paid");
  await expect(page.locator(".company-invoice-closed")).toHaveCount(0);
  await page.goto(companyPath(CY, "/company/plan"));
  const renewed = await paidUntil(page).getAttribute("datetime");
  // From the confirmation (the mock's clock, six days on), not from the lapsed end.
  expect(Date.parse(renewed ?? "") - Date.parse(lapsed ?? "")).toBeGreaterThan(30 * DAY);
  expect(Math.abs(Date.parse(renewed ?? "") - (Date.now() + 6 * DAY + 30 * DAY))).toBeLessThan(DAY);
});

test("a late first payment: the old invoice can no longer be paid and names its replacement, and the money's refund has its own row", async ({ page }) => {
  await inCompany(page, "Cyberdyne Systems", CY, "tom@example.com");
  await page.goto(companyPath(CY, `/company/billing/${INVOICE.cyberdyneLateInitial}`));
  await expect(page.locator(".company-invoice-closed")).toHaveText("This invoice can no longer be paid. It was replaced by invoice TSK-2026-00902.");
  await expect(fact(page, "For")).toHaveText("First payment");
  await expect(bank(page)).toHaveCount(0);
  await page.getByRole("link", { name: "TSK-2026-00902" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Invoice TSK-2026-00902/ })).toBeFocused();
  await expect(fact(page, "Status")).toHaveText("Paid");
  await page.goto(companyPath(CY, "/company/billing"));
  const row = refundRow(page, "First payment arrived late");
  await expect(row).toContainText("€20.00");
  await expect(row).toContainText(/Bank transfer · Requested [A-Z][a-z]{2} \d{1,2} · Approved [A-Z][a-z]{2} \d{1,2} · Sent [A-Z][a-z]{2} \d{1,2} · Refunded [A-Z][a-z]{2} \d{1,2}/);
});

test("Items and the billing details as issued — a rename leaves an old invoice's buyer as it was", async ({ page }) => {
  await inCompany(page, "Cyberdyne Systems", CY, "tom@example.com");
  await page.goto(companyPath(CY, `/company/billing/${INVOICE.cyberdynePlanChange}`));
  const items = page.getByRole("region", { name: "Items" });
  await expect(items.locator(".company-item-row")).toHaveText(["Business planNet $35.81 · VAT $7.52$43.33", "Total$43.33"]);
  await expect(items.locator(".company-items-fx")).toHaveText(/^Converted at 1 EUR = 1\.0832 USD, from Mock FX desk on [A-Z][a-z]{2} \d{1,2}, \d\d:\d\d\.$/);
  await page.goto(companyPath(CY, `/company/billing/${INVOICE.cyberdyneInitial}`));
  await expect(page.getByRole("region", { name: "Items" }).locator(".company-item-row")).toHaveText([
    "Team plan€15.00",
    "Additional seatsQuantity 5€4.00",
    "Storage add-on€1.00",
    "Total€20.00",
  ]);
  const details = page.getByRole("region", { name: "Billing details" });
  await expect(details).toContainText("As they were when this invoice was issued.");
  await expect(details.locator("dd").first().locator(".company-snapshot-line")).toHaveText([
    "Cyberdyne Systems",
    "Tax ID XX-CYB-0001",
    "14 Mock Avenue",
    "Floor 3",
    "28013 Madrid",
    "Spain",
    "accounts@cyberdyne.example",
  ]);
  await expect(details.locator("dd").nth(1)).toContainText("Taska Mock S.L. (test only)Registration MOCK-0000");

  await openCompanyZone(page, CY, "General");
  await page.getByRole("button", { name: "Rename company" }).click();
  const field = page.getByRole("textbox", { name: "Company name" });
  await field.fill("Cyberdyne Labs");
  await field.press("Enter");
  await expect(page.getByText("Only the owner of Cyberdyne Labs can rename it, pause it or transfer it.")).toBeVisible();
  await page.goto(companyPath(CY, `/company/billing/${INVOICE.cyberdyneInitial}`));
  await expect(page.getByRole("region", { name: "Billing details" }).locator(".company-snapshot-line").first()).toHaveText("Cyberdyne Systems");
  await expect(page.locator(".company-invoice")).not.toContainText("Cyberdyne Labs");
});

test("Download PDF saves the invoice's PDF; a refusal is said with its id and focus stays; a non-owner has no button and sends nothing", async ({ page, browser }) => {
  await onRenewal(page);
  const button = page.getByRole("button", { name: "Download PDF of invoice TSK-2026-00904" });
  await expect(button).toHaveText("Download PDF");
  const saved = page.waitForEvent("download");
  await button.click();
  const file = await saved;
  expect(file.suggestedFilename()).toBe("TSK-2026-00904.pdf");
  const bytes = await readFile((await file.path()) ?? "");
  expect(bytes.subarray(0, 8).toString("latin1")).toBe("%PDF-1.4");
  expect(bytes.toString("latin1")).toContain("not a tax document");
  await expect(page.locator(".company-invoice > .visually-hidden[role=status]").filter({ hasText: /downloaded/ })).toHaveText("Invoice TSK-2026-00904 downloaded.");
  await expect(button).toBeFocused();

  await setHooks(page, { documentOff: true });
  await button.click();
  const note = page.locator(".company-invoice-refusal .error-note");
  await expect(note.locator(".error-note-sentence")).toHaveText("Invoice PDFs aren’t available for Cyberdyne Systems yet.");
  await expect(note.locator(".request-id")).toBeVisible();
  await expect(button).toBeFocused();
  await setHooks(page, { documentType: "text/html" });
  await button.click();
  await expect(note.locator(".error-note-sentence")).toHaveText("Taska couldn’t download the PDF. Try again.");

  // Priya administers Cyberdyne but does not own it: no Billing, no button — and no request (the hooks stay untaken).
  const other = await browser.newContext({ viewport: page.viewportSize() });
  const priya = await other.newPage();
  await inCompany(priya, "Cyberdyne Systems", CY, "priya@example.com");
  await setHooks(priya, {
    refuseNext: {
      getInvoiceDocument: { status: 503, code: "DEPENDENCY_UNAVAILABLE" },
      listRefunds: { status: 503, code: "DEPENDENCY_UNAVAILABLE" },
      getTenantCapabilities: { status: 503, code: "DEPENDENCY_UNAVAILABLE" },
    },
  });
  await priya.goto(renewalPath);
  await expect(priya.getByText("Invoices and payments for Cyberdyne Systems are shown only to its owner.")).toBeVisible();
  await expect(priya.getByRole("button", { name: /Download PDF/ })).toHaveCount(0);
  await priya.goto(companyPath(CY, "/company/billing"));
  await expect(priya.getByText("Invoices and payments for Cyberdyne Systems are shown only to its owner.")).toBeVisible();
  const hooks = await priya.evaluate(() => JSON.parse(window.localStorage.getItem("taska.mockTenantHooks") ?? "{}") as { refuseNext?: Record<string, unknown> });
  expect(Object.keys(hooks.refuseNext ?? {}).sort()).toEqual(["getInvoiceDocument", "getTenantCapabilities", "listRefunds"]);
  await other.close();
});

test("the never-opened card with a wire first invoice: its bank details, no Pay — and a late payment is refunded beside a new invoice", async ({ page }) => {
  await signIn(page, "nina@example.com");
  await expect(page).toHaveURL(`${B2B}/companies`);
  // Who picks the method of an issued invoice is the server (A78): this mock's hook, for any company.
  await setHooks(page, { issueMethod: { "*": "WIRE" } });
  await page.getByRole("link", { name: "Create a company" }).click();
  await page.getByLabel("Company name").fill("Acme Wire");
  await page.getByRole("radio", { name: /^Team/ }).check();
  await page.getByRole("button", { name: "Create company" }).click();
  await expect(page).toHaveURL(new RegExp(`^${B2B}/c/[0-9a-f-]{36}/projects$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Acme WireAwaiting first payment");
  const tenantId = new URL(page.url()).pathname.split("/")[2];

  await expect(page.getByText(/^Invoice TSK-2026-01009 · €20\.00 · Bank transfer$/)).toBeVisible();
  await expect(stateBlock(page)).toContainText("Waiting for the bank transfer.");
  await expect(page.getByRole("button", { name: /^Pay/ })).toHaveCount(0);
  await expect(bankValue(page, "Reference").locator(".company-bank-value")).toHaveText("TASKA-TSK-2026-01009");
  await expect(bank(page).locator(".company-bank-note")).toContainText(
    /If it arrives after [A-Z][a-z]{2} \d{1,2}, \d\d:\d\d, it’s refunded and Taska issues a new invoice\. Acme Wire still closes if it isn’t paid by [A-Z][a-z]{2} \d{1,2}, \d\d:\d\d\./,
  );
  await expect(page.getByRole("button", { name: "Download PDF of invoice TSK-2026-01009" })).toBeVisible();

  // The money arrives a day after its due date while the creation is still open (D238).
  const invoiceId = await page.evaluate(
    ({ id, key }) =>
      (JSON.parse(window.localStorage.getItem(key) ?? "{}") as { invoices: Array<{ id: string; tenantId: string }> }).invoices.find(
        (invoice) => invoice.tenantId === id,
      )?.id,
    { id: tenantId, key: MOCK_SERVER_KEY },
  );
  await setHooks(page, {
    issueMethod: { "*": "WIRE" },
    clockOffsetMs: 8 * DAY,
    wireReceipts: [{ id: "r-first", tenantId, amountMinor: "2000" }],
    confirmWire: { "r-first": invoiceId },
    returnUnallocated: ["r-first"],
  });
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Acme WireAwaiting first payment");
  await expect(page.getByText(/^Invoice TSK-2026-01010 · €20\.00 · Bank transfer$/)).toBeVisible();
  await expect(page.locator(".company-setup-refund")).toHaveText(
    "The €20.00 that arrived after an earlier invoice was due is to be refunded to the account it came from.",
  );
  await expect(bankValue(page, "Reference").locator(".company-bank-value")).toHaveText("TASKA-TSK-2026-01010");
});

test("a first transfer matched while the company's own read lags: «matched», Taska is opening it — no slot line, amount, PDF or bank details", async ({ page }) => {
  await signIn(page, "nina@example.com");
  await expect(page).toHaveURL(`${B2B}/companies`);
  await setHooks(page, { issueMethod: { "*": "WIRE" } });
  await page.getByRole("link", { name: "Create a company" }).click();
  await page.getByLabel("Company name").fill("Acme Matched");
  await page.getByRole("radio", { name: /^Team/ }).check();
  await page.getByRole("button", { name: "Create company" }).click();
  await expect(page).toHaveURL(new RegExp(`^${B2B}/c/[0-9a-f-]{36}/projects$`));
  await expect(page.getByText(/^Invoice TSK-2026-01009 · €20\.00 · Bank transfer$/)).toBeVisible();
  const tenantId = new URL(page.url()).pathname.split("/")[2];
  const invoiceId = await page.evaluate(
    ({ id, key }) =>
      (JSON.parse(window.localStorage.getItem(key) ?? "{}") as { invoices: Array<{ id: string; tenantId: string }> }).invoices.find(
        (invoice) => invoice.tenantId === id,
      )?.id,
    { id: tenantId, key: MOCK_SERVER_KEY },
  );
  // The admin confirms a full, timely transfer; the company's own read is slow to say it opened.
  await setHooks(page, {
    issueMethod: { "*": "WIRE" },
    wireReceipts: [{ id: "r-full", tenantId, amountMinor: "2000" }],
    confirmWire: { "r-full": invoiceId },
    delayMs: { getTenant: 15_000 },
  });
  await comeBack(page);
  await expect(stateBlock(page)).toHaveText(
    "Your bank transfer has been matched. Taska is opening Acme Matched. This page opens it when it’s ready — don’t send the transfer again.",
  );
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Acme MatchedAwaiting first payment");
  await expect(page.getByText(/· Bank transfer$/)).toHaveCount(0);
  await expect(page.getByText(/€0\.00/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Download PDF/ })).toHaveCount(0);
  await expect(bank(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Pay/ })).toHaveCount(0);
});
