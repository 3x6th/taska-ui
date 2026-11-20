import { describe, expect, it } from "vitest";
import { MemoryStorage } from "../../test/memoryStorage";
import { apiErrorFacts, refusalCode } from "../errors";
import { createLocalLockManager } from "../webSession";
import { MOCK_DISPUTE_IDS, MOCK_INVOICE_IDS, MOCK_PLAN_IDS, MOCK_SERVER_KEY, MOCK_TENANT_HOOKS_KEY, MOCK_TENANT_IDS } from "./MockTenantServer";
import { MOCK_COMPANY_ROUTES, createCompaniesMockApi } from "./mockCompanies";

/*
 * The companies mock's full refunds of a subscription payment and its disputes
 * (TAS-516, api-contract-guard's pre-build ruling §4 with its addendum): Soylent
 * Corp's fixtures; the owner's `listDisputes`; the admin's hooks — a dispute
 * opened, under review, won, withdrawn or lost, a full refund requested, its
 * evidence completed and moved along L07's chain only — and what each one does
 * to the restriction, the paid-through and automatic payments. Nothing refunds
 * on a lost dispute, nothing extends a period or turns automatic payments on.
 */

const SOY = MOCK_TENANT_IDS.soylent;
const CY = MOCK_TENANT_IDS.cyberdyne;
const CURRENT = MOCK_DISPUTE_IDS.soylentCurrent;
const DAY = 24 * 60 * 60_000;
const money = (amountMinor: string, currency = "EUR") => ({ amountMinor, currency, exponent: 2 });
const caught = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error("expected a refusal");
    },
    (error: unknown) => error,
  );
const facts = (error: unknown) => ({ status: apiErrorFacts(error).status, code: refusalCode(error) });

interface StateShape {
  invoiceSeq: number;
  tenants: Array<{ id: string; restrictions: string[]; entitlementVersion: number }>;
  periods: Array<{ tenantId: string; invoiceId: string; state: string; endsAt: string }>;
  paymentFacts: Array<{ tenantId: string; invoiceId: string; method: string }>;
  disputes: Array<Record<string, unknown> & { id: string }>;
  refunds: Array<Record<string, unknown> & { id: string }>;
}

async function signedIn(email: string, companyId: string, hooks: Record<string, unknown> = {}) {
  const local = new MemoryStorage();
  local.setItem(MOCK_TENANT_HOOKS_KEY, JSON.stringify(hooks));
  const api = createCompaniesMockApi({ local, session: new MemoryStorage(), locks: createLocalLockManager(), events: null, latencyMs: 0, ownershipWaitMs: 25 });
  await api.signIn({ email, password: "x" });
  await api.enterCompany(companyId);
  const setHooks = (value: Record<string, unknown>) =>
    local.setItem(MOCK_TENANT_HOOKS_KEY, JSON.stringify({ ...JSON.parse(local.getItem(MOCK_TENANT_HOOKS_KEY) ?? "{}"), ...value }));
  const state = () => JSON.parse(local.getItem(MOCK_SERVER_KEY) ?? "{}") as StateShape;
  return { api, local, setHooks, state };
}

const inSoylent = (hooks: Record<string, unknown> = {}) => signedIn("tom@example.com", SOY, hooks);

describe("the route (guard §4.3)", () => {
  it("is the session layer's, as for the REST leg", () => {
    expect(MOCK_COMPANY_ROUTES.listDisputes).toBe("session");
  });

  it("the owner's: oldest first by (openedAt, id); a company admin is refused OWNER_REQUIRED; never refused by the dispute's own restriction", async () => {
    const { api } = await inSoylent();
    expect((await api.getTenant(SOY)).restrictions).toEqual(["PAYMENT_DISPUTE"]);
    const page = await api.listDisputes(SOY);
    expect(page.items.map((dispute) => [dispute.id, dispute.state, dispute.finalOutcome, dispute.resolvedAt !== null])).toEqual([
      [MOCK_DISPUTE_IDS.soylentPrevious, "WON", "WON", true],
      [CURRENT, "OPEN", null, false],
    ]);
    expect(page.nextCursor).toBeNull();
    const priya = await signedIn("priya@example.com", SOY);
    expect(facts(await caught(priya.api.listDisputes(SOY)))).toEqual({ status: 403, code: "OWNER_REQUIRED" });
  });

  it("keyset pages bound to the reader and the company; limit 1–100; refuseNext, loseAnswer and delayMs take it", async () => {
    const { api, setHooks } = await inSoylent();
    const first = await api.listDisputes(SOY, { limit: 1 });
    expect(first.items.map((dispute) => dispute.id)).toEqual([MOCK_DISPUTE_IDS.soylentPrevious]);
    const second = await api.listDisputes(SOY, { cursor: first.nextCursor ?? "", limit: 1 });
    expect(second).toEqual({ items: [expect.objectContaining({ id: CURRENT })], nextCursor: null });
    expect(facts(await caught(api.listDisputes(SOY, { limit: 0 })))).toEqual({ status: 400, code: "VALIDATION_FAILED" });
    expect(facts(await caught(api.listDisputes(SOY, { limit: 101 })))).toEqual({ status: 400, code: "VALIDATION_FAILED" });
    const other = await signedIn("tom@example.com", CY);
    expect(facts(await caught(other.api.listDisputes(CY, { cursor: first.nextCursor ?? "" })))).toEqual({ status: 400, code: "VALIDATION_FAILED" });
    setHooks({ refuseNext: { listDisputes: { status: 503, code: "DEPENDENCY_UNAVAILABLE" } } });
    expect(facts(await caught(api.listDisputes(SOY)))).toEqual({ status: 503, code: "DEPENDENCY_UNAVAILABLE" });
    setHooks({ loseAnswer: ["listDisputes"] });
    expect(await caught(api.listDisputes(SOY))).toBeInstanceOf(TypeError);
    setHooks({ delayMs: { listDisputes: 20 } });
    const started = Date.now();
    expect((await api.listDisputes(SOY)).items).toHaveLength(2);
    expect(Date.now() - started).toBeGreaterThanOrEqual(15);
  });

  it("a company still being set up: 409", async () => {
    const { api, local } = await inSoylent();
    const stored = JSON.parse(local.getItem(MOCK_SERVER_KEY) as string) as { tenants: Array<{ id: string; lifecycle: string }> };
    for (const tenant of stored.tenants) if (tenant.id === SOY) tenant.lifecycle = "PROVISIONING";
    local.setItem(MOCK_SERVER_KEY, JSON.stringify(stored));
    expect(facts(await caught(api.listDisputes(SOY)))).toEqual({ status: 409, code: "INVALID_STATE" });
  });
});

describe("Soylent Corp's fixtures (guard §4.6)", () => {
  it("Team v2, online, its previous period ended and the current one ~12 days on, autopay off — 00951 and 00952 without moving the sequence", async () => {
    const { api, state } = await inSoylent();
    const sub = await api.getSubscription(SOY);
    expect(sub).toMatchObject({ planVersionId: MOCK_PLAN_IDS.team, autopayState: "DISABLED", renewalCancelled: false });
    const left = Date.parse(sub.paidThrough ?? "") - Date.now();
    expect(left).toBeGreaterThan(11 * DAY);
    expect(left).toBeLessThanOrEqual(12 * DAY);
    expect((await api.listInvoices(SOY)).items.map((invoice) => [invoice.number, invoice.purpose, invoice.state, invoice.paymentMethod, invoice.planVersionId])).toEqual([
      ["TSK-2026-00952", "RENEWAL", "PAID", "PSP", MOCK_PLAN_IDS.team],
      ["TSK-2026-00951", "RENEWAL", "PAID", "PSP", MOCK_PLAN_IDS.team],
    ]);
    expect(state().invoiceSeq).toBe(1009);
    const periods = state().periods.filter((period) => period.tenantId === SOY);
    expect(periods.map((period) => [period.invoiceId, period.state])).toEqual([
      [MOCK_INVOICE_IDS.soylentPrevious, "GRANTED"],
      [MOCK_INVOICE_IDS.soylentCurrent, "GRANTED"],
    ]);
    expect(Date.parse(periods[0].endsAt)).toBeLessThan(Date.now());
    // One declined full refund of the previous payment.
    expect((await api.listRefunds(SOY)).items.map((refund) => [refund.kind, refund.state, refund.reasonCode, refund.sourceMethod, refund.decidedAt !== null, refund.feeBearer])).toEqual([
      ["SUBSCRIPTION_FULL", "REJECTED", "BILLING_ERROR", "PSP", true, null],
    ]);
  });

  it("no payment fact, period or dispute ever reaches an owner's answer beyond the contract's fields", async () => {
    const { api } = await inSoylent();
    const serialised = JSON.stringify([await api.listDisputes(SOY), await api.getSubscription(SOY), await api.listInvoices(SOY), await api.getTenant(SOY)]);
    for (const leaked of ["paymentId", "periods", "invoiceId", '"amount"', "confirmedMoneyFactId", "1a2b3c4d-5e6f-4a7b-8c9d"]) expect(serialised).not.toContain(leaked);
  });
});

describe("a dispute's life (guard §4.4, L07)", () => {
  it("under review: NEEDS_REVIEW, the restriction stays; won: lifted, the paid-through untouched, autopay stays off — immutable", async () => {
    const { api, setHooks } = await inSoylent();
    const before = await api.getSubscription(SOY);
    setHooks({ disputeReview: [CURRENT] });
    expect((await api.listDisputes(SOY)).items[1]).toMatchObject({ state: "NEEDS_REVIEW", finalOutcome: null, resolvedAt: null });
    expect((await api.getTenant(SOY)).restrictions).toEqual(["PAYMENT_DISPUTE"]);
    setHooks({ disputeOutcome: { [CURRENT]: "WON" } });
    expect((await api.listDisputes(SOY)).items[1]).toMatchObject({ state: "WON", finalOutcome: "WON", resolvedAt: expect.any(String) });
    expect((await api.getTenant(SOY)).restrictions).toEqual([]);
    const after = await api.getSubscription(SOY);
    expect(after.paidThrough).toBe(before.paidThrough);
    expect(after.autopayState).toBe("DISABLED");
    // Terminal: another outcome changes nothing.
    setHooks({ disputeOutcome: { [CURRENT]: "LOST_FULL_REFUND" } });
    expect((await api.listDisputes(SOY)).items[1]).toMatchObject({ state: "WON", finalOutcome: "WON" });
    expect((await api.getSubscription(SOY)).paidThrough).toBe(before.paidThrough);
  });

  it("withdrawn: the same — what was left still counts, nothing extended, nothing turned back on", async () => {
    const { api, setHooks } = await inSoylent({ disputeOutcome: { [CURRENT]: "WITHDRAWN_CONFIRMED" } });
    const before = (await api.getSubscription(SOY)).paidThrough;
    expect((await api.listDisputes(SOY)).items[1]).toMatchObject({ state: "WITHDRAWN", finalOutcome: "WITHDRAWN_CONFIRMED" });
    expect((await api.getTenant(SOY)).restrictions).toEqual([]);
    setHooks({ disputeReview: [CURRENT] });
    expect((await api.listDisputes(SOY)).items[1]).toMatchObject({ state: "WITHDRAWN" });
    expect((await api.getSubscription(SOY)).paidThrough).toBe(before);
  });

  it("lost in part: the whole current period revoked — paid-through back to the previous end, in the past, PAYMENT_EXPIRED; invoice PAID, no refund", async () => {
    const { api, setHooks, state } = await inSoylent();
    const versionBefore = state().tenants.find((tenant) => tenant.id === SOY)?.entitlementVersion ?? 0;
    setHooks({ disputeOutcome: { [CURRENT]: "LOST_PARTIAL_COVERAGE_REVOKED" } });
    expect((await api.listDisputes(SOY)).items[1]).toMatchObject({ state: "LOST", finalOutcome: "LOST_PARTIAL_COVERAGE_REVOKED" });
    expect(state().disputes.find((dispute) => dispute.id === CURRENT)).toMatchObject({ confirmedMoneyFactId: expect.any(String) });
    expect((await api.getTenant(SOY)).restrictions).toEqual(["PAYMENT_EXPIRED"]);
    const sub = await api.getSubscription(SOY);
    const previousEnd = state().periods.find((period) => period.invoiceId === MOCK_INVOICE_IDS.soylentPrevious)?.endsAt;
    expect(sub.paidThrough).toBe(previousEnd);
    expect(Date.parse(sub.paidThrough ?? "")).toBeLessThan(Date.now());
    // Develop's revocation also cancels the renewal (A93); the plan stays Team v2 on both reads (guard Q4).
    expect(sub).toMatchObject({ autopayState: "DISABLED", renewalCancelled: true, planVersionId: MOCK_PLAN_IDS.team });
    expect((await api.getEntitlement(SOY)).planVersionId).toBe(MOCK_PLAN_IDS.team);
    expect(state().tenants.find((tenant) => tenant.id === SOY)?.entitlementVersion).toBeGreaterThan(versionBefore);
    expect(state().periods.find((period) => period.invoiceId === MOCK_INVOICE_IDS.soylentCurrent)?.state).toBe("REVOKED");
    expect((await api.listInvoices(SOY)).items.map((invoice) => invoice.state)).toEqual(["PAID", "PAID"]);
    expect((await api.listRefunds(SOY)).items.map((refund) => refund.state)).toEqual(["REJECTED"]);
  });

  it("a dispute opened on a payment whose period has ended sets no restriction — autopay still goes off; a WIRE payment is ignored (PSP-only)", async () => {
    const { api, setHooks } = await inSoylent({ disputeOutcome: { [CURRENT]: "WON" } });
    expect((await api.getTenant(SOY)).restrictions).toEqual([]);
    setHooks({ disputeOpen: { "6c9f3b2d-7e4a-4f6b-8d1c-2b3c4d5e6f09": { tenantId: SOY, invoiceId: MOCK_INVOICE_IDS.soylentPrevious } } });
    expect((await api.listDisputes(SOY)).items.map((dispute) => dispute.state)).toEqual(["WON", "WON", "OPEN"]);
    expect((await api.getTenant(SOY)).restrictions).toEqual([]);
    // On the current payment: the restriction, at once — and, NEEDS_REVIEW from the start when asked.
    setHooks({ disputeOpen: { "6c9f3b2d-7e4a-4f6b-8d1c-2b3c4d5e6f0a": { tenantId: SOY, invoiceId: MOCK_INVOICE_IDS.soylentCurrent, state: "NEEDS_REVIEW" } } });
    expect((await api.listDisputes(SOY)).items.at(-1)).toMatchObject({ state: "NEEDS_REVIEW" });
    expect((await api.getTenant(SOY)).restrictions).toEqual(["PAYMENT_DISPUTE"]);
    const cy = await signedIn("tom@example.com", CY, { disputeOpen: { "6c9f3b2d-7e4a-4f6b-8d1c-2b3c4d5e6f0b": { tenantId: CY, invoiceId: MOCK_INVOICE_IDS.cyberdyneInitial } } });
    expect((await cy.api.listDisputes(CY)).items).toEqual([]);
    expect((await cy.api.getTenant(CY)).restrictions).toEqual([]);
  });

  it("the restriction follows current coverage: once the disputed period has ended, no open dispute backs it", async () => {
    const { api, setHooks } = await inSoylent();
    setHooks({ clockOffsetMs: 13 * DAY });
    const restrictions = (await api.getTenant(SOY)).restrictions;
    expect(restrictions).not.toContain("PAYMENT_DISPUTE");
    expect(restrictions).toContain("PAYMENT_EXPIRED");
  });

  it("an online settlement records its payment: a dispute can be opened on it, and its period is what a loss revokes", async () => {
    const { api, setHooks, state } = await signedIn("tom@example.com", MOCK_TENANT_IDS.umbrella, { settlementDelayMs: 0 });
    // Umbrella's renewal paid online through the stand-in page's success.
    setHooks({ resolveCheckout: { [MOCK_INVOICE_IDS.umbrellaRenewal]: "SUCCEEDED" } });
    await api.createCheckout(MOCK_TENANT_IDS.umbrella, MOCK_INVOICE_IDS.umbrellaRenewal, "BILLING", crypto.randomUUID());
    await api.listInvoices(MOCK_TENANT_IDS.umbrella);
    expect((await api.getInvoice(MOCK_TENANT_IDS.umbrella, MOCK_INVOICE_IDS.umbrellaRenewal)).state).toBe("PAID");
    expect(state().paymentFacts.filter((fact) => fact.invoiceId === MOCK_INVOICE_IDS.umbrellaRenewal).map((fact) => fact.method)).toEqual(["PSP"]);
    const granted = state().periods.filter((period) => period.invoiceId === MOCK_INVOICE_IDS.umbrellaRenewal);
    expect(granted.map((period) => period.state)).toEqual(["GRANTED"]);
    // An early renewal: its period starts at the old end, so it is not the current one — and no restriction comes with a dispute on it.
    setHooks({ disputeOpen: { "6c9f3b2d-7e4a-4f6b-8d1c-2b3c4d5e6f0c": { tenantId: MOCK_TENANT_IDS.umbrella, invoiceId: MOCK_INVOICE_IDS.umbrellaRenewal } } });
    expect((await api.listDisputes(MOCK_TENANT_IDS.umbrella)).items.map((dispute) => dispute.state)).toEqual(["OPEN"]);
    expect((await api.getTenant(MOCK_TENANT_IDS.umbrella)).restrictions).toEqual([]);
    expect((await api.getSubscription(MOCK_TENANT_IDS.umbrella)).autopayState).toBe("DISABLED");
  });

  it("the legacy paymentDispute hook stays restriction-only: no dispute row comes with it", async () => {
    const { api } = await signedIn("tom@example.com", MOCK_TENANT_IDS.umbrella, { paymentDispute: { [MOCK_TENANT_IDS.umbrella]: true } });
    expect((await api.getTenant(MOCK_TENANT_IDS.umbrella)).restrictions).toEqual(["PAYMENT_DISPUTE"]);
    expect((await api.listDisputes(MOCK_TENANT_IDS.umbrella)).items).toEqual([]);
  });
});

describe("a full refund of a subscription payment (guard §4.5, Q3)", () => {
  const REFUND = "9a3c2e77-6f4d-4e3a-9b5c-0000000009f1";

  it("by bank transfer: the allocation, Taska's fee, no SLA until the evidence; L07's chain only; set dates kept; CONFIRMED revokes the only period", async () => {
    const { api, setHooks, state } = await signedIn("tom@example.com", CY, {
      subscriptionRefund: { [REFUND]: { tenantId: CY, invoiceId: MOCK_INVOICE_IDS.cyberdyneInitial, reasonCode: "SERVICE_FAILURE" } },
    });
    const read = async () => (await api.listRefunds(CY)).items.find((refund) => refund.id === REFUND);
    expect(await read()).toMatchObject({
      kind: "SUBSCRIPTION_FULL",
      state: "REQUESTED",
      amount: money("2000"),
      reasonCode: "SERVICE_FAILURE",
      sourceMethod: "WIRE",
      feeBearer: "TASKA",
      sendDueAt: null,
      decidedAt: null,
      submittedAt: null,
    });
    // Before its evidence a bank transfer reaches nothing but a decline; outside L07 nothing moves at all.
    setHooks({ refundState: { [REFUND]: "APPROVED" } });
    expect((await read())?.state).toBe("REQUESTED");
    setHooks({ refundState: { [REFUND]: "SUBMITTING" }, refundEvidence: [REFUND] });
    expect(await read()).toMatchObject({ state: "REQUESTED", sendDueAt: expect.any(String) });
    for (const next of ["APPROVED", "SUBMITTING", "UNKNOWN"]) {
      setHooks({ refundState: { [REFUND]: next } });
      expect((await read())?.state, next).toBe(next);
    }
    const approved = await read();
    expect(approved).toMatchObject({ decidedAt: expect.any(String), submittedAt: expect.any(String) });
    expect((await api.getTenant(CY)).restrictions).toEqual([]);
    setHooks({ refundState: { [REFUND]: "CONFIRMED" } });
    expect(await read()).toMatchObject({ state: "CONFIRMED", confirmedAt: expect.any(String), decidedAt: approved?.decidedAt, submittedAt: approved?.submittedAt });
    // The only period it paid for no longer counts: no paid-through left, PAYMENT_EXPIRED; the invoice stays PAID.
    const sub = await api.getSubscription(CY);
    expect(sub.paidThrough).toBeNull();
    expect(sub).toMatchObject({ autopayState: "DISABLED", renewalCancelled: true });
    expect((await api.getTenant(CY)).restrictions).toEqual(["PAYMENT_EXPIRED"]);
    expect((await api.getInvoice(CY, MOCK_INVOICE_IDS.cyberdyneInitial)).state).toBe("PAID");
    // Terminal.
    setHooks({ refundState: { [REFUND]: "FAILED" } });
    expect((await read())?.state).toBe("CONFIRMED");
    expect(state().refunds.filter((refund) => refund.kind === "SUBSCRIPTION_FULL" && refund.tenantId === CY)).toHaveLength(1);
  });

  it("a decline before the evidence, decided now; FAILED after sending; no second one while one is active or done; only the three reasons", async () => {
    const other = "9a3c2e77-6f4d-4e3a-9b5c-0000000009f2";
    const { api, setHooks } = await signedIn("tom@example.com", CY, {
      subscriptionRefund: { [REFUND]: { tenantId: CY, invoiceId: MOCK_INVOICE_IDS.cyberdyneInitial, reasonCode: "BILLING_ERROR" } },
    });
    const read = async (id = REFUND) => (await api.listRefunds(CY)).items.find((refund) => refund.id === id);
    setHooks({ subscriptionRefund: { [REFUND]: { tenantId: CY, invoiceId: MOCK_INVOICE_IDS.cyberdyneInitial, reasonCode: "BILLING_ERROR" }, [other]: { tenantId: CY, invoiceId: MOCK_INVOICE_IDS.cyberdyneInitial, reasonCode: "MANDATORY" } } });
    expect(await read(other)).toBeUndefined();
    setHooks({ refundState: { [REFUND]: "REJECTED" } });
    expect(await read()).toMatchObject({ state: "REJECTED", decidedAt: expect.any(String), submittedAt: null });
    // Declined, the payment can be asked for again — but never for «changed my mind», nor an invoice not paid or not here.
    setHooks({
      subscriptionRefund: {
        [other]: { tenantId: CY, invoiceId: MOCK_INVOICE_IDS.cyberdyneInitial, reasonCode: "MANDATORY" },
        "9a3c2e77-6f4d-4e3a-9b5c-0000000009f3": { tenantId: CY, invoiceId: MOCK_INVOICE_IDS.cyberdyneRenewal, reasonCode: "MANDATORY" },
        "9a3c2e77-6f4d-4e3a-9b5c-0000000009f4": { tenantId: CY, invoiceId: MOCK_INVOICE_IDS.cyberdyneInitial, reasonCode: "CHANGED_MY_MIND" },
      },
      refundEvidence: [other],
    });
    expect(await read(other)).toMatchObject({ state: "REQUESTED", reasonCode: "MANDATORY" });
    expect(await read("9a3c2e77-6f4d-4e3a-9b5c-0000000009f3")).toBeUndefined();
    expect(await read("9a3c2e77-6f4d-4e3a-9b5c-0000000009f4")).toBeUndefined();
    for (const next of ["APPROVED", "SUBMITTING", "FAILED"]) {
      setHooks({ refundState: { [REFUND]: "REJECTED", [other]: next } });
      await api.listRefunds(CY);
    }
    expect(await read(other)).toMatchObject({ state: "FAILED", submittedAt: expect.any(String) });
    // Nothing was refunded: the period still counts.
    expect((await api.getSubscription(CY)).paidThrough).not.toBeNull();
    expect((await api.getTenant(CY)).restrictions).toEqual([]);
  });

  it("online: no fee, no SLA ever — and none while a dispute on the payment is open", async () => {
    const { api, setHooks } = await inSoylent({
      subscriptionRefund: {
        [REFUND]: { tenantId: SOY, invoiceId: MOCK_INVOICE_IDS.soylentPrevious, reasonCode: "SERVICE_FAILURE" },
        "9a3c2e77-6f4d-4e3a-9b5c-0000000009f5": { tenantId: SOY, invoiceId: MOCK_INVOICE_IDS.soylentCurrent, reasonCode: "SERVICE_FAILURE" },
      },
      refundEvidence: [REFUND],
    });
    const refunds = (await api.listRefunds(SOY)).items;
    expect(refunds.find((refund) => refund.id === REFUND)).toMatchObject({ state: "REQUESTED", sourceMethod: "PSP", feeBearer: null, sendDueAt: null });
    expect(refunds.find((refund) => refund.id === "9a3c2e77-6f4d-4e3a-9b5c-0000000009f5")).toBeUndefined();
    // Approved and submitted online: sending needs no evidence.
    setHooks({ refundState: { [REFUND]: "APPROVED" } });
    await api.listRefunds(SOY);
    setHooks({ refundState: { [REFUND]: "SUBMITTING" } });
    expect((await api.listRefunds(SOY)).items.find((refund) => refund.id === REFUND)).toMatchObject({ state: "SUBMITTING", submittedAt: expect.any(String), sendDueAt: null });
  });
});
