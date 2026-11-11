import { expect, test, type Page } from "@playwright/test";
import { COMPANY, DISPUTE, INVOICE, companyPath, inCompany, openCompanyZone, setHooks } from "./companiesFixtures";

/*
 * A company's disputes, its full refunds told step by step and the dispute's
 * restriction in the companies build (TAS-516) against the third e2e server's
 * mock. Soylent Corp is Tom's company under a payment dispute — Team v2, paid
 * online, the dispute open on the current month's payment, one won on the
 * previous; Cyberdyne Systems' first payment is the bank transfer a full refund
 * is made of. The admin's side is the mock's hooks. The story's acceptance that
 * can be delivered: another company's member gets nothing; approval and sending
 * are never money received; a full refund of the coverage ends it; a won or
 * withdrawn dispute keeps only what was left, automatic payments stay off; a
 * final partial loss with nothing else paid asks for a new full payment; the
 * server's send date, Taska's fee and the banks' crediting are said apart. The
 * owner's own refund request is not delivered (A83, A89, A90): nothing on the
 * page offers one.
 */

const SOY = COMPANY.soylent;
const CY = COMPANY.cyberdyne;
const DATE = String.raw`[A-Z][a-z]{2} \d{1,2}`;
const disputes = (page: Page) => page.getByRole("region", { name: /^Disputes/ });
const disputeRows = (page: Page) => disputes(page).locator(".company-dispute-row");
const refundRow = (page: Page, reason: string) =>
  page.getByRole("region", { name: /^Refunds/ }).locator(".company-refund-row").filter({ has: page.getByText(reason, { exact: true }) });
const stateLines = (page: Page) => page.locator(".company-general-state");
const paidUntil = (page: Page) => page.locator(".company-plan dl > div").filter({ has: page.locator("dt", { hasText: /^Paid until$/ }) }).locator("time");

/** Tom in Soylent Corp, on Billing — with `hooks` set first, when there are any. */
async function soylentBilling(page: Page, hooks: Record<string, unknown> | null = null) {
  await inCompany(page, "Soylent Corp", SOY, "tom@example.com");
  if (hooks !== null) await setHooks(page, hooks);
  await page.goto(companyPath(SOY, "/company/billing"));
  await expect(disputes(page)).toBeVisible();
}

test("the owner's Billing: Automatic payments → Disputes → Invoices → Refunds; an open dispute says what a reversal does, never that access comes back", async ({
  page,
}) => {
  await inCompany(page, "Soylent Corp", SOY, "tom@example.com");
  await openCompanyZone(page, SOY);
  // The dispute's line, to the owner: no «until it’s settled» — and the way to Billing.
  await expect(stateLines(page).first()).toHaveText("A payment is disputed. Nothing in it can be changed, and no automatic payments are taken. See Billing");
  await expect(page.locator(".company-general-states").getByRole("link", { name: "See Billing" })).toHaveCount(1);
  await page.locator(".company-general-states").getByRole("link", { name: "See Billing" }).click();
  await expect(page).toHaveURL(companyPath(SOY, "/company/billing"));
  await expect(disputes(page)).toBeVisible();
  await expect(page.getByRole("heading", { level: 2 })).toHaveText(["Automatic payments", "Disputes2", "Invoices2", "Refunds1"]);
  // Off until a new consent, which this version cannot take — and no «Turn on».
  await expect(page.getByRole("region", { name: "Automatic payments" })).toContainText(
    "You pay Soylent Corp’s invoices here yourself. Automatic payments stay off until you set them up, which this version of Taska can’t do yet.",
  );
  await expect(page.getByRole("button", { name: /Turn on/ })).toHaveCount(0);

  const [current, previous] = [disputeRows(page).nth(0), disputeRows(page).nth(1)];
  await expect(current).toContainText(new RegExp(`^Disputed paymentOpened ${DATE}`));
  await expect(current).toContainText("If the payment is reversed, even in part, the whole period it paid for is withdrawn.");
  await expect(current.locator(".company-marker").first()).toHaveText("open");
  await expect(previous).toContainText(new RegExp(`Opened ${DATE} · Closed ${DATE}`));
  await expect(previous).toContainText("What’s left of the period it paid for still counts. It isn’t extended for the time the dispute took.");
  await expect(previous.locator(".company-marker").first()).toHaveText("upheld");
  // No invoice, no amount, no read-only, no refund promised, nothing to press.
  await expect(disputes(page)).not.toContainText(/TSK-|€|read-only|refund/i);
  await expect(disputes(page).getByRole("link")).toHaveCount(0);
  await expect(disputes(page).getByRole("button")).toHaveCount(0);

  // The declined full refund: requested, then declined — never approved, sent or refunded.
  const declined = refundRow(page, "Billing error");
  await expect(declined).toContainText("€20.00");
  await expect(declined).toContainText(new RegExp(`Online payment · Requested ${DATE} · Declined ${DATE}`));
  await expect(declined).not.toContainText(/Approved|Sent|Refunded/);
  await expect(declined.locator(".company-refund-consequence")).toHaveCount(0);
  await expect(
    page.getByText("Refunds go back to the account the money came from. The dates below are Taska’s — when the money shows in that account depends on the banks."),
  ).toBeVisible();
  // No refund can be asked for here (A83).
  await expect(page.getByRole("button", { name: /refund/i })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /refund/i })).toHaveCount(0);

  // Under review: the same sentence, never a request to the owner.
  await setHooks(page, { disputeReview: [DISPUTE.soylentCurrent] });
  await page.reload();
  await expect(disputeRows(page).nth(0).locator(".company-marker").first()).toHaveText("in review");
  await expect(disputeRows(page).nth(0)).toContainText("If the payment is reversed, even in part, the whole period it paid for is withdrawn.");
});

test("withdrawn: the restriction goes, only what was left still counts — Paid until unchanged, automatic payments stay off", async ({ page }) => {
  await inCompany(page, "Soylent Corp", SOY, "tom@example.com");
  await openCompanyZone(page, SOY, "Plan");
  const before = await paidUntil(page).getAttribute("datetime");
  await setHooks(page, { disputeOutcome: { [DISPUTE.soylentCurrent]: "WITHDRAWN_CONFIRMED" } });
  await page.goto(companyPath(SOY, "/company/billing"));
  const row = disputeRows(page).nth(0);
  await expect(row.locator(".company-marker").first()).toHaveText("withdrawn");
  await expect(row).toContainText(new RegExp(`Opened ${DATE} · Closed ${DATE}`));
  await expect(row).toContainText("What’s left of the period it paid for still counts. It isn’t extended for the time the dispute took.");
  await expect(page.getByRole("region", { name: "Automatic payments" })).toContainText("Off");
  await page.goto(companyPath(SOY, "/company/plan"));
  await expect(paidUntil(page)).toHaveAttribute("datetime", before ?? "");
  await expect(page.getByText("A payment is disputed.")).toHaveCount(0);
});

test("lost in part, nothing else paid: read-only until a new full payment — «See Plan» once, a past Paid until, Team on offer; nothing more refunded", async ({
  page,
}) => {
  await soylentBilling(page, { disputeOutcome: { [DISPUTE.soylentCurrent]: "LOST_PARTIAL_COVERAGE_REVOKED" } });
  const row = disputeRows(page).nth(0);
  await expect(row.locator(".company-marker").first()).toHaveText("part reversed");
  await expect(row.locator(".company-refund-consequence")).toHaveText(
    "The whole period it paid for was withdrawn — no part of it is kept. Nothing more is refunded for it. A new full payment is needed before anything in Soylent Corp can be changed again. See Plan",
  );
  await expect(disputes(page).getByRole("link")).toHaveCount(1);
  // No refund came with it: the declined one is still the only row.
  await expect(page.getByRole("heading", { name: /^Refunds/ })).toHaveText("Refunds1");
  // The keyboard: from the page's heading, «See Plan» first — there is no «Turn off» with automatic payments off — then the invoices.
  await page.getByRole("heading", { level: 1 }).focus();
  await page.keyboard.press("Tab");
  await expect(disputes(page).getByRole("link", { name: "See Plan" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "TSK-2026-00952" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(companyPath(SOY, "/company/plan"));
  await expect(page.getByRole("heading", { level: 1, name: /Plan/ })).toBeFocused();
  await expect(stateLines(page).first()).toHaveText(
    "Its paid period has ended. Nothing in it can be changed until it’s paid for again. There’s no grace period, and it doesn’t move to a free plan on its own. See Billing",
  );
  // The previous month's end, in the past — never a remainder of the revoked one.
  expect(Date.parse((await paidUntil(page).getAttribute("datetime")) ?? "")).toBeLessThan(Date.now());
  await page.getByRole("button", { name: "Change plan" }).click();
  await expect(page.getByRole("dialog", { name: "Change plan" }).getByRole("radio", { name: /^Team/ })).toBeVisible();
});

test("lost in full: the whole period withdrawn, nothing more refunded — and no new-payment sentence, which is the part reversal's", async ({ page }) => {
  await soylentBilling(page, { disputeOutcome: { [DISPUTE.soylentCurrent]: "LOST_FULL_REFUND" } });
  const row = disputeRows(page).nth(0);
  await expect(row.locator(".company-marker").first()).toHaveText("reversed");
  await expect(row.locator(".company-refund-consequence")).toHaveText("The whole period it paid for was withdrawn — no part of it is kept. Nothing more is refunded for it.");
  await expect(disputes(page).getByRole("link")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /^Refunds/ })).toHaveText("Refunds1");
});

test("a full refund of a bank-transfer payment, step by step: approval and sending are never money received; confirmed, its period no longer counts", async ({
  page,
}) => {
  const id = "9a3c2e77-6f4d-4e3a-9b5c-0000000009e1";
  const refund = { subscriptionRefund: { [id]: { tenantId: CY, invoiceId: INVOICE.cyberdyneInitial, reasonCode: "SERVICE_FAILURE" } } };
  const ends = "If the refund goes through, the period this payment paid for ends and automatic payments turn off.";
  const fee = "Taska pays the bank fee, so the full amount is sent back.";
  await inCompany(page, "Cyberdyne Systems", CY, "tom@example.com");
  await setHooks(page, refund);
  await page.goto(companyPath(CY, "/company/billing"));
  const row = refundRow(page, "Service problem");
  const meta = row.locator(".company-refund-meta");
  const marker = row.locator(".company-refund-status .company-marker, .company-invoice-marker-inline").filter({ visible: true });
  await expect(row).toContainText("€20.00");
  await expect(meta).toContainText(new RegExp(`^Bank transfer · Requested ${DATE}`));
  // No send date before its evidence: none is the client's own.
  await expect(meta).not.toContainText("aims to send");
  await expect(row.locator(".company-refund-consequence")).toHaveText(`${ends} ${fee}`);
  await expect(marker).toHaveText("requested");

  const step = async (hooks: Record<string, unknown>, word: string) => {
    await setHooks(page, { ...refund, refundEvidence: [id], ...hooks });
    await page.reload();
    await expect(marker).toHaveText(word);
  };
  await step({}, "requested");
  await expect(meta).toContainText(new RegExp(`^Bank transfer · Requested ${DATE} · Taska aims to send it by ${DATE}`));
  await step({ refundState: { [id]: "APPROVED" } }, "approved");
  await expect(meta).toContainText(new RegExp(`^Bank transfer · Requested ${DATE} · Approved ${DATE} · Taska aims to send it by ${DATE}`));
  await step({ refundState: { [id]: "SUBMITTING" } }, "sending");
  await expect(meta).toContainText(new RegExp(`· Approved ${DATE} · Being sent`));
  await expect(meta).not.toContainText(/\bSent\b/);
  await step({ refundState: { [id]: "UNKNOWN" } }, "checking");
  await expect(meta).toContainText(new RegExp(`· Approved ${DATE} · Taska is checking whether it went through`));
  await expect(meta).not.toContainText(/\bSent\b/);
  await expect(row.locator(".company-refund-consequence")).toHaveText(`${ends} ${fee}`);
  await expect(row).not.toContainText(/arriv|receiv|credit/i);
  await step({ refundState: { [id]: "CONFIRMED" } }, "refunded");
  await expect(meta).toContainText(new RegExp(`^Bank transfer · Requested ${DATE} · Approved ${DATE} · Sent ${DATE} · Refunded ${DATE}`));
  await expect(row.locator(".company-refund-consequence")).toHaveText("The period this payment paid for no longer counts.");
  // It was the only period: the company is read-only now, as its owner is told.
  await openCompanyZone(page, CY);
  await expect(stateLines(page).first()).toContainText("Its paid period has ended.");
});

test("the disputes that failed to load — a READ_ONLY too — say so with the request id in their place, the one Try again under them; the page waits for them", async ({
  page,
}) => {
  await inCompany(page, "Soylent Corp", SOY, "tom@example.com");
  await setHooks(page, { refuseNext: { listDisputes: { status: 403, code: "READ_ONLY", reasons: ["PAYMENT_DISPUTE"] } } });
  await page.goto(companyPath(SOY, "/company/billing"));
  const note = page.locator(".company-billing-failure").filter({ hasText: "Disputes could not be loaded." });
  await expect(note).toBeVisible();
  await expect(note.locator(".request-id")).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(1);
  await expect(note.getByRole("button", { name: "Try again" })).toBeVisible();
  // Everything else is on the page as it would be; nothing turned read-only by it.
  await expect(page.getByRole("link", { name: "TSK-2026-00952" })).toBeVisible();
  await note.getByRole("button", { name: "Try again" }).click();
  await expect(disputes(page)).toBeVisible();
  await expect(page.locator(".company-billing-failure")).toHaveCount(0);

  // Slow: the whole page waits for them, so the group never lands above a list already drawn.
  await setHooks(page, { delayMs: { listDisputes: 1500 } });
  await page.reload();
  await expect(page.locator(".company-billing-loading")).toBeVisible();
  await expect(page.getByRole("link", { name: "TSK-2026-00952" })).toBeVisible({ timeout: 10_000 });
  await expect(disputes(page)).toHaveCount(1);
});

test("a company admin who is not the owner: the member's wording, Billing one line — and no listDisputes is sent", async ({ page }) => {
  await inCompany(page, "Soylent Corp", SOY, "priya@example.com");
  await setHooks(page, { refuseNext: { listDisputes: { status: 503, code: "DEPENDENCY_UNAVAILABLE" } } });
  await openCompanyZone(page, SOY);
  await expect(stateLines(page).first()).toHaveText("A payment is disputed. Nothing in it can be changed.");
  await expect(page.locator(".company-general-states").getByRole("link")).toHaveCount(0);
  await page.goto(companyPath(SOY, "/company/billing"));
  await expect(page.getByText("Invoices and payments for Soylent Corp are shown only to its owner.")).toBeVisible();
  await expect(page.getByText(/disput/i)).toHaveCount(0);
  const hooks = await page.evaluate(() => JSON.parse(window.localStorage.getItem("taska.mockTenantHooks") ?? "{}") as { refuseNext?: Record<string, unknown> });
  expect(Object.keys(hooks.refuseNext ?? {})).toEqual(["listDisputes"]);
});
