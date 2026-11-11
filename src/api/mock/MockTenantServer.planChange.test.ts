import { describe, expect, it } from "vitest";
import { MemoryStorage } from "../../test/memoryStorage";
import type { Checkout, ChangePlanInput } from "../billing";
import { apiErrorFacts, refusalCode, refusalReasons } from "../errors";
import type { TaskaApi } from "../TaskaApi";
import { createLocalLockManager } from "../webSession";
import { MOCK_ACCOUNT_IDS, MockTaskaStore } from "./MockTaskaApi";
import { MOCK_INVOICE_IDS, MOCK_PLAN_IDS, MOCK_SERVER_KEY, MOCK_TENANT_HOOKS_KEY, MOCK_TENANT_IDS, MockTenantServer } from "./MockTenantServer";
import { MOCK_COMPANY_ROUTES, createCompaniesMockApi } from "./mockCompanies";

/*
 * The companies mock's plan change, renewal and automatic payments (TAS-515,
 * api-contract-guard's pre-build ruling §6 «must»): develop's effect rule and
 * target checks, receipts replayed before the version, Paid → FREE ending the
 * coverage, a new selection VOIDing the older one's invoices, PLAN_CHANGE
 * settlement (F1) and the boundary without payment (F2), cancel and resume,
 * the withdrawal of automatic payments with its mandate version, a dispute
 * switching them off (F7), Paid → FREE keeping SUSPENDED (F8), the renewal
 * calendar, and the four operations' hooks.
 */

const UM = MOCK_TENANT_IDS.umbrella;
const LN = MOCK_TENANT_IDS.longName;
const IN = MOCK_TENANT_IDS.initech;
const HO = MOCK_TENANT_IDS.hooli;
const NW = MOCK_TENANT_IDS.northwind;
const DAY = 24 * 60 * 60_000;

const key = () => crypto.randomUUID();
const caught = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error("expected a refusal");
    },
    (error: unknown) => error,
  );
const facts = (error: unknown) => ({ status: apiErrorFacts(error).status, code: refusalCode(error), reasons: [...refusalReasons(error)] });
const to = (planVersionId: string): ChangePlanInput => ({ planVersionId, currency: "EUR", paymentMethod: "PSP" });

async function inCompany(email: string, tenantId: string, hooks: Record<string, unknown> = {}) {
  const local = new MemoryStorage();
  local.setItem(MOCK_TENANT_HOOKS_KEY, JSON.stringify(hooks));
  const api = createCompaniesMockApi({ local, session: new MemoryStorage(), locks: createLocalLockManager(), events: null, latencyMs: 0, ownershipWaitMs: 25 });
  await api.signIn({ email, password: "x" });
  await api.enterCompany(tenantId);
  const setHooks = (value: Record<string, unknown>) =>
    local.setItem(MOCK_TENANT_HOOKS_KEY, JSON.stringify({ ...JSON.parse(local.getItem(MOCK_TENANT_HOOKS_KEY) ?? "{}"), ...value }));
  const desk = new MockTenantServer({ storage: local, accountStore: new MockTaskaStore(), latencyMs: 0 });
  const version = async () => (await api.getSubscription(tenantId)).version as string;
  return { api, local, setHooks, desk, version };
}

function tokenOf(checkout: Checkout): string {
  let address = "";
  checkout.redirect?.go({ assign: (url) => void (address = String(url)) });
  return decodeURIComponent(new URL(address).pathname.split("/").pop() ?? "");
}

/** Pays an invoice through the stand-in page, settled at once. */
async function pay(api: TaskaApi, desk: MockTenantServer, tenantId: string, invoiceId: string) {
  const checkout = await api.createCheckout(tenantId, invoiceId, "BILLING", key());
  desk.observeMockCheckout(tokenOf(checkout), "succeeds");
  await api.getInvoice(tenantId, invoiceId);
}

const stateOf = (local: MemoryStorage) =>
  JSON.parse(local.getItem(MOCK_SERVER_KEY) ?? "{}") as {
    freeLedger: Record<string, string>;
    invoices: Array<{ id: string; tenantId: string; purpose: string; state: string; planVersionId: string; dueAt: string; total: { amountMinor: string } }>;
    tenants: Array<{ id: string; subscription: Record<string, unknown> }>;
  };

describe("the routes (§1)", () => {
  it("are the session layer's, as for the REST leg", () => {
    for (const name of ["changeSubscriptionPlan", "cancelSubscriptionRenewal", "resumeSubscriptionRenewal", "setAutopayConsent"] as const) {
      expect(MOCK_COMPANY_ROUTES[name]).toBe("session");
    }
  });
});

describe("who may (§7)", () => {
  it("Priya, an admin of Umbrella but not its owner, is refused all four with OWNER_REQUIRED", async () => {
    const { api } = await inCompany("priya@example.com", UM);
    for (const command of [
      () => api.changeSubscriptionPlan(UM, to(MOCK_PLAN_IDS.starter), "2", key()),
      () => api.cancelSubscriptionRenewal(UM, "2", key()),
      () => api.resumeSubscriptionRenewal(UM, "2", key()),
      () => api.setAutopayConsent(UM, false, "2", key()),
    ]) {
      expect(facts(await caught(command()))).toEqual({ status: 403, code: "OWNER_REQUIRED", reasons: [] });
    }
  });

  it("no restriction stops a plan command: paused Initech's owner changes its plan", async () => {
    const { api, version } = await inCompany("sofia@example.com", IN);
    const answer = await api.changeSubscriptionPlan(IN, to(MOCK_PLAN_IDS.business), await version(), key());
    expect(answer.effect).toBe("NEXT_PERIOD");
  });
});

describe("the effect, by develop's rule (§0.1)", () => {
  it("paid → Free is IMMEDIATE: the coverage ends, CONSENTED goes DISABLED, the renewal is VOIDed, the allowance is spent", async () => {
    const { api, local, version } = await inCompany("tom@example.com", UM);
    const before = await version();
    const answer = await api.changeSubscriptionPlan(UM, to(MOCK_PLAN_IDS.free), before, key());
    expect(answer).toMatchObject({ effect: "IMMEDIATE", invoiceId: null, operationId: expect.any(String) });
    const after = await api.getSubscription(UM);
    expect(after).toMatchObject({ planVersionId: MOCK_PLAN_IDS.free, paidThrough: null, autopayState: "DISABLED", renewalCancelled: false });
    expect(Number(after.version)).toBeGreaterThan(Number(before));
    await expect(api.getEntitlement(UM)).resolves.toMatchObject({ planVersionId: MOCK_PLAN_IDS.free });
    expect(stateOf(local).invoices.find((invoice) => invoice.id === MOCK_INVOICE_IDS.umbrellaRenewal)?.state).toBe("VOID");
    expect(stateOf(local).freeLedger[MOCK_ACCOUNT_IDS.tom]).toBe(UM);
  });

  it("paid → cheaper paid is AFTER_PAYMENT: an invoice for it, the plan unchanged until it is paid — then a new month from the payment", async () => {
    const { api, desk, local } = await inCompany("tom@example.com", UM, { settlementDelayMs: 0 });
    const before = await api.getSubscription(UM);
    const answer = await api.changeSubscriptionPlan(UM, to(MOCK_PLAN_IDS.starter), before.version as string, key());
    expect(answer).toMatchObject({ effect: "AFTER_PAYMENT", invoiceId: expect.any(String), effectiveAt: null });
    const invoice = await api.getInvoice(UM, answer.invoiceId as string);
    expect(invoice).toMatchObject({ purpose: "PLAN_CHANGE", state: "OPEN", planVersionId: MOCK_PLAN_IDS.starter, paymentMethod: "PSP" });
    expect(invoice.total?.amountMinor).toBe("1000");
    // Nothing on the wire says a change is pending (A63); the plan is the old one.
    const pending = await api.getSubscription(UM);
    expect(pending).toMatchObject({ planVersionId: MOCK_PLAN_IDS.teamRetired, scheduledPlanVersionId: null, paidThrough: before.paidThrough });
    expect(Object.keys(pending)).not.toContain("activeChange");
    expect(stateOf(local).invoices.find((item) => item.id === MOCK_INVOICE_IDS.umbrellaRenewal)?.state).toBe("VOID");

    await pay(api, desk, UM, invoice.id);
    expect((await api.getInvoice(UM, invoice.id)).state).toBe("PAID");
    const paid = await api.getSubscription(UM);
    expect(paid.planVersionId).toBe(MOCK_PLAN_IDS.starter);
    // A new month from the payment, not added to what was left (F1).
    expect(Date.parse(paid.paidThrough as string) - Date.now()).toBeGreaterThan(29 * DAY);
    expect(Date.parse(paid.paidThrough as string) - Date.now()).toBeLessThanOrEqual(30 * DAY);
    await expect(api.getEntitlement(UM)).resolves.toMatchObject({ planVersionId: MOCK_PLAN_IDS.starter });
    expect((await api.getTenantQuotas(UM)).quotas.find((row) => row.kind === "SEAT")?.limit).toBe("10");
  });

  it("paid → dearer paid is NEXT_PERIOD: scheduled from the paid-through, its invoice due then; paid, the plan switches at the boundary", async () => {
    const { api, desk, setHooks, version } = await inCompany("tom@example.com", UM, { settlementDelayMs: 0 });
    const before = await api.getSubscription(UM);
    const answer = await api.changeSubscriptionPlan(UM, to(MOCK_PLAN_IDS.business), before.version as string, key());
    expect(answer).toMatchObject({ effect: "NEXT_PERIOD", effectiveAt: before.paidThrough, invoiceId: expect.any(String) });
    const scheduled = await api.getSubscription(UM);
    expect(scheduled).toMatchObject({ planVersionId: MOCK_PLAN_IDS.teamRetired, scheduledPlanVersionId: MOCK_PLAN_IDS.business, scheduledEffectiveAt: before.paidThrough });
    const invoice = await api.getInvoice(UM, answer.invoiceId as string);
    expect(invoice).toMatchObject({ purpose: "PLAN_CHANGE", dueAt: new Date(before.paidThrough as string).toISOString() });
    await pay(api, desk, UM, invoice.id);
    // Paid before its boundary: still the old plan (F2's other half).
    await expect(api.getEntitlement(UM)).resolves.toMatchObject({ planVersionId: MOCK_PLAN_IDS.teamRetired });
    setHooks({ clockOffsetMs: Date.parse(before.paidThrough as string) - Date.now() + 1000 });
    const switched = await api.getSubscription(UM);
    expect(switched).toMatchObject({ planVersionId: MOCK_PLAN_IDS.business, scheduledPlanVersionId: null, scheduledEffectiveAt: null });
    expect(Date.parse(switched.paidThrough as string) - Date.parse(before.paidThrough as string)).toBe(30 * DAY);
    await expect(api.getTenant(UM)).resolves.toMatchObject({ restrictions: [] });
    expect(await version()).toBe(switched.version);
  });

  it("a scheduled change left unpaid at its boundary is never applied (F2): its date goes, its plan id stays, the company read-only", async () => {
    const { api, setHooks } = await inCompany("tom@example.com", UM);
    const before = await api.getSubscription(UM);
    await api.changeSubscriptionPlan(UM, to(MOCK_PLAN_IDS.business), before.version as string, key());
    setHooks({ clockOffsetMs: Date.parse(before.paidThrough as string) - Date.now() + 1000 });
    const after = await api.getSubscription(UM);
    expect(after).toMatchObject({ planVersionId: MOCK_PLAN_IDS.teamRetired, scheduledPlanVersionId: MOCK_PLAN_IDS.business, scheduledEffectiveAt: null });
    await expect(api.getEntitlement(UM)).resolves.toMatchObject({ planVersionId: MOCK_PLAN_IDS.teamRetired });
    await expect(api.getTenant(UM)).resolves.toMatchObject({ restrictions: ["PAYMENT_EXPIRED"] });
  });

  it("the plan it is on, while a change is scheduled, withdraws it: IMMEDIATE, the schedule and its invoice gone", async () => {
    const { api, local, version } = await inCompany("priya@example.com", LN);
    const scheduled = await api.changeSubscriptionPlan(LN, to(MOCK_PLAN_IDS.business), await version(), key());
    expect(scheduled.effect).toBe("NEXT_PERIOD");
    const withdrawn = await api.changeSubscriptionPlan(LN, to(MOCK_PLAN_IDS.team), await version(), key());
    expect(withdrawn.effect).toBe("IMMEDIATE");
    await expect(api.getSubscription(LN)).resolves.toMatchObject({ planVersionId: MOCK_PLAN_IDS.team, scheduledPlanVersionId: null, scheduledEffectiveAt: null });
    expect(stateOf(local).invoices.find((invoice) => invoice.id === scheduled.invoiceId)?.state).toBe("VOID");
  });

  it("a second selection supersedes the first and VOIDs its invoice", async () => {
    const { api, local, version } = await inCompany("tom@example.com", UM);
    const first = await api.changeSubscriptionPlan(UM, to(MOCK_PLAN_IDS.starter), await version(), key());
    const second = await api.changeSubscriptionPlan(UM, to(MOCK_PLAN_IDS.business), await version(), key());
    const invoices = stateOf(local).invoices;
    expect(invoices.find((invoice) => invoice.id === first.invoiceId)?.state).toBe("VOID");
    expect(invoices.find((invoice) => invoice.id === second.invoiceId)?.state).toBe("OPEN");
  });

  it("a target that is not the latest published version is 404; another version of the plan it is on is 409", async () => {
    const { api, version } = await inCompany("tom@example.com", UM);
    // Umbrella is on retired Team v1: re-buying it is 404 — develop's edge, kept (A74).
    expect(facts(await caught(api.changeSubscriptionPlan(UM, to(MOCK_PLAN_IDS.teamRetired), await version(), key())))).toMatchObject({
      status: 404,
      code: "RESOURCE_NOT_FOUND",
    });
    expect(facts(await caught(api.changeSubscriptionPlan(UM, to(MOCK_PLAN_IDS.team), await version(), key())))).toMatchObject({
      status: 409,
      code: "INVALID_STATE",
    });
  });

  it("Free once the allowance is used is 409 FREE_ELIGIBILITY_USED — the version moves all the same, and the same key replays the refusal", async () => {
    const { api, version } = await inCompany("priya@example.com", LN);
    const before = await version();
    const sent = key();
    expect(facts(await caught(api.changeSubscriptionPlan(LN, to(MOCK_PLAN_IDS.free), before, sent)))).toEqual({
      status: 409,
      code: "FREE_ELIGIBILITY_USED",
      reasons: [],
    });
    expect(Number(await version())).toBe(Number(before) + 1);
    expect(facts(await caught(api.changeSubscriptionPlan(LN, to(MOCK_PLAN_IDS.free), before, sent)))).toMatchObject({ code: "FREE_ELIGIBILITY_USED" });
    await expect(api.getSubscription(LN)).resolves.toMatchObject({ planVersionId: MOCK_PLAN_IDS.team });
  });
});

describe("version and idempotency (§2)", () => {
  it("the same key, If-Match and body answer what they answered: one change, one invoice; another body is 409; a stale version 412", async () => {
    const { api, local, version } = await inCompany("tom@example.com", UM);
    const before = await version();
    const sent = key();
    const first = await api.changeSubscriptionPlan(UM, to(MOCK_PLAN_IDS.starter), before, sent);
    // Replayed before the version is checked (SPC 68-81): the old If-Match is the right one.
    const again = await api.changeSubscriptionPlan(UM, to(MOCK_PLAN_IDS.starter), before, sent);
    expect(again).toEqual(first);
    expect(stateOf(local).invoices.filter((invoice) => invoice.purpose === "PLAN_CHANGE")).toHaveLength(1);
    expect(facts(await caught(api.changeSubscriptionPlan(UM, to(MOCK_PLAN_IDS.business), before, sent)))).toMatchObject({ status: 409, code: "IDEMPOTENCY_CONFLICT" });
    // The same body with the version read again is another request on develop: the hash covers it.
    expect(facts(await caught(api.changeSubscriptionPlan(UM, to(MOCK_PLAN_IDS.starter), await version(), sent)))).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(facts(await caught(api.changeSubscriptionPlan(UM, to(MOCK_PLAN_IDS.business), before, key())))).toMatchObject({ status: 412, code: "VERSION_CONFLICT" });
    expect(facts(await caught(api.cancelSubscriptionRenewal(UM, "", key())))).toMatchObject({ status: 428 });
  });

  it("a lost answer has applied the change: the same key answers it again, and nothing is changed twice", async () => {
    const { api, local, setHooks, version } = await inCompany("tom@example.com", UM);
    const before = await version();
    const sent = key();
    setHooks({ loseAnswer: ["changeSubscriptionPlan"] });
    await expect(api.changeSubscriptionPlan(UM, to(MOCK_PLAN_IDS.starter), before, sent)).rejects.toThrow();
    const retried = await api.changeSubscriptionPlan(UM, to(MOCK_PLAN_IDS.starter), before, sent);
    expect(retried.effect).toBe("AFTER_PAYMENT");
    expect(stateOf(local).invoices.filter((invoice) => invoice.purpose === "PLAN_CHANGE")).toHaveLength(1);
  });

  it("refuseNext and delayMs take the four operations", async () => {
    const { api, setHooks, version } = await inCompany("tom@example.com", UM);
    setHooks({ refuseNext: { setAutopayConsent: { status: 503, code: "DEPENDENCY_UNAVAILABLE" } } });
    expect(facts(await caught(api.setAutopayConsent(UM, false, await version(), key())))).toMatchObject({ status: 503, code: "DEPENDENCY_UNAVAILABLE" });
    await expect(api.setAutopayConsent(UM, false, await version(), key())).resolves.toMatchObject({ state: "DISABLED" });
  });
});

describe("cancel and resume renewal", () => {
  it("cancel keeps what is paid, touches no automatic payments and leaves the issued renewal OPEN; resume undoes it — each moving the version", async () => {
    const { api, local, version } = await inCompany("tom@example.com", UM);
    const before = await api.getSubscription(UM);
    const cancelled = await api.cancelSubscriptionRenewal(UM, before.version as string, key());
    expect(cancelled).toMatchObject({ renewalCancelled: true, paidThrough: before.paidThrough, autopayState: "CONSENTED", planVersionId: MOCK_PLAN_IDS.teamRetired });
    expect(Number(await version())).toBe(Number(before.version) + 1);
    expect(stateOf(local).invoices.find((invoice) => invoice.id === MOCK_INVOICE_IDS.umbrellaRenewal)?.state).toBe("OPEN");
    const resumed = await api.resumeSubscriptionRenewal(UM, await version(), key());
    expect(resumed).toMatchObject({ renewalCancelled: false });
    expect(Number(await version())).toBe(Number(before.version) + 2);
  });

  it("past its period the cancelled company is read-only and not moved to Free; resume is accepted, and no renewal is issued", async () => {
    const { api, local, setHooks } = await inCompany("priya@example.com", LN);
    setHooks({ clockOffsetMs: 51 * DAY });
    await expect(api.getTenant(LN)).resolves.toMatchObject({ restrictions: ["PAYMENT_EXPIRED"] });
    const sub = await api.getSubscription(LN);
    expect(sub).toMatchObject({ planVersionId: MOCK_PLAN_IDS.team, renewalCancelled: true });
    await api.resumeSubscriptionRenewal(LN, sub.version as string, key());
    expect(stateOf(local).invoices.filter((invoice) => invoice.tenantId === LN && invoice.purpose === "RENEWAL")).toHaveLength(0);
    // Cancel needs a current paid period.
    expect(facts(await caught(api.cancelSubscriptionRenewal(LN, (await api.getSubscription(LN)).version as string, key())))).toMatchObject({ status: 409, code: "INVALID_STATE" });
  });

  it("a FREE company has no renewal to cancel: 409", async () => {
    const { api, version } = await inCompany("anna@example.com", NW);
    expect(facts(await caught(api.cancelSubscriptionRenewal(NW, await version(), key())))).toMatchObject({ status: 409, code: "INVALID_STATE" });
  });

  it("re-buying the plan it is on after the period ended is AFTER_PAYMENT, with a new month once paid", async () => {
    const { api, desk, setHooks } = await inCompany("priya@example.com", LN, { clockOffsetMs: 51 * DAY, settlementDelayMs: 0 });
    const sub = await api.getSubscription(LN);
    const answer = await api.changeSubscriptionPlan(LN, to(MOCK_PLAN_IDS.team), sub.version as string, key());
    expect(answer.effect).toBe("AFTER_PAYMENT");
    await pay(api, desk, LN, answer.invoiceId as string);
    setHooks({ clockOffsetMs: 51 * DAY + 1000 });
    await expect(api.getTenant(LN)).resolves.toMatchObject({ restrictions: [] });
    expect(Date.parse((await api.getSubscription(LN)).paidThrough as string)).toBeGreaterThan(Date.now() + 51 * DAY + 29 * DAY);
  });
});

describe("automatic payments (consent: false only)", () => {
  it("CONSENTED → DISABLED: the subscription's version moves, the mandate's is another number", async () => {
    const { api, version } = await inCompany("tom@example.com", UM);
    const before = await version();
    const answer = await api.setAutopayConsent(UM, false, before, key());
    expect(answer).toEqual({ state: "DISABLED" });
    const after = await api.getSubscription(UM);
    expect(after).toMatchObject({ autopayState: "DISABLED", version: String(Number(before) + 1) });
  });

  it("the raw answer's mandate version is never the subscription's", async () => {
    const local = new MemoryStorage();
    const server = new MockTenantServer({ storage: local, accountStore: new MockTaskaStore(), latencyMs: 0 });
    const transport = server.transport();
    const account = (await transport.startWebSession({ email: "tom@example.com", password: "x" }, key())) as { accessToken: string };
    const company = (await transport.createTenantSession(account.accessToken, UM, key())) as { accessToken: string };
    const sub = (await transport.getSubscription(company.accessToken, UM, new AbortController().signal)) as { version: string };
    const mandate = (await transport.setAutopayConsent(company.accessToken, UM, false, sub.version, key())) as { version: string; state: string };
    const after = (await transport.getSubscription(company.accessToken, UM, new AbortController().signal)) as { version: string };
    expect(mandate.state).toBe("DISABLED");
    expect(mandate.version).not.toBe(after.version);
    expect(mandate.version).not.toBe(sub.version);
  });

  it("refused READ_ONLY under a pause or a block (A68), CAPABILITY_DISABLED behind the flag", async () => {
    const paused = await inCompany("sofia@example.com", IN);
    expect(facts(await caught(paused.api.setAutopayConsent(IN, false, await paused.version(), key())))).toEqual({
      status: 403,
      code: "READ_ONLY",
      reasons: ["OWNER_PAUSE"],
    });
    const blocked = await inCompany("priya@example.com", HO);
    expect(facts(await caught(blocked.api.setAutopayConsent(HO, false, await blocked.version(), key())))).toMatchObject({ code: "READ_ONLY" });
    const off = await inCompany("tom@example.com", UM, { autopayConsentEnabled: false });
    expect(facts(await caught(off.api.setAutopayConsent(UM, false, await off.version(), key())))).toEqual({ status: 403, code: "CAPABILITY_DISABLED", reasons: [] });
  });

  it("a dispute switches them off and lifting it never turns them back on (F7); autopaySuspended suspends a CONSENTED one", async () => {
    const { api, setHooks } = await inCompany("tom@example.com", UM);
    setHooks({ autopaySuspended: { [UM]: true } });
    await expect(api.getSubscription(UM)).resolves.toMatchObject({ autopayState: "SUSPENDED" });
    setHooks({ autopaySuspended: {}, paymentDispute: { [UM]: true } });
    await expect(api.getSubscription(UM)).resolves.toMatchObject({ autopayState: "DISABLED" });
    setHooks({ paymentDispute: { [UM]: false } });
    await expect(api.getSubscription(UM)).resolves.toMatchObject({ autopayState: "DISABLED" });
  });

  it("Paid → FREE keeps SUSPENDED and a cancelled renewal (F8, A69, A73)", async () => {
    const { api, setHooks } = await inCompany("priya@example.com", HO);
    setHooks({ applyPlan: { [HO]: MOCK_PLAN_IDS.free } });
    await expect(api.getSubscription(HO)).resolves.toMatchObject({ planVersionId: MOCK_PLAN_IDS.free, paidThrough: null, autopayState: "SUSPENDED" });
    const named = await inCompany("priya@example.com", LN, { applyPlan: { [LN]: MOCK_PLAN_IDS.free } });
    await expect(named.api.getSubscription(LN)).resolves.toMatchObject({ planVersionId: MOCK_PLAN_IDS.free, renewalCancelled: true });
  });
});

describe("the renewal calendar (invented, §6)", () => {
  it("issues a RENEWAL a week before the paid-through, due at it, once — none with renewal cancelled or a change in force", async () => {
    const { api, local, setHooks } = await inCompany("sofia@example.com", IN, { clockOffsetMs: 26 * DAY });
    const through = (await api.getSubscription(IN)).paidThrough as string;
    const renewals = () => stateOf(local).invoices.filter((invoice) => invoice.tenantId === IN && invoice.purpose === "RENEWAL");
    expect(renewals()).toHaveLength(1);
    expect(renewals()[0]).toMatchObject({ state: "OPEN", planVersionId: MOCK_PLAN_IDS.team, dueAt: new Date(through).toISOString() });
    setHooks({ clockOffsetMs: 27 * DAY });
    await api.getSubscription(IN);
    expect(renewals()).toHaveLength(1);

    const cancelled = await inCompany("priya@example.com", LN, { clockOffsetMs: 45 * DAY });
    await cancelled.api.getSubscription(LN);
    expect(stateOf(cancelled.local).invoices.filter((invoice) => invoice.tenantId === LN && invoice.purpose === "RENEWAL")).toHaveLength(0);
  });
});
