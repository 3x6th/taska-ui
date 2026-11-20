import { describe, expect, it } from "vitest";
import { MemoryStorage } from "../../test/memoryStorage";
import type { Checkout } from "../billing";
import { checkoutAttemptKey } from "../checkoutAttempt";
import { apiErrorFacts, refusalCode, refusalReasons } from "../errors";
import { createLocalLockManager } from "../webSession";
import { MockTaskaStore } from "./MockTaskaApi";
import { MOCK_INVOICE_IDS, MOCK_PLAN_IDS, MOCK_SERVER_KEY, MOCK_TENANT_HOOKS_KEY, MOCK_TENANT_IDS, MockTenantServer } from "./MockTenantServer";
import { MOCK_COMPANY_ROUTES, createCompaniesMockApi } from "./mockCompanies";

/*
 * The companies mock's invoices and hosted checkout (TAS-513,
 * api-contract-guard §5 and its addendum): owner only; the INITIAL invoice
 * issued at a paid creation; idempotency per key, a second key refused while
 * one attempt is active; settlement in two steps — SUCCEEDED, then PAID; a
 * cancel that stays PENDING until it expires; UNKNOWN until resolved; the
 * checkout-off refusals; and the stand-in page's token never kept.
 */

const UM = MOCK_TENANT_IDS.umbrella;
const ST = MOCK_TENANT_IDS.stark;
const HO = MOCK_TENANT_IDS.hooli;
const RENEWAL = MOCK_INVOICE_IDS.umbrellaRenewal;
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

async function inCompany(email: string, tenantId: string, hooks: Record<string, unknown> = {}) {
  const local = new MemoryStorage();
  const locks = createLocalLockManager();
  local.setItem(MOCK_TENANT_HOOKS_KEY, JSON.stringify(hooks));
  const api = createCompaniesMockApi({ local, session: new MemoryStorage(), locks, events: null, latencyMs: 0, ownershipWaitMs: 25 });
  await api.signIn({ email, password: "x" });
  await api.enterCompany(tenantId);
  const setHooks = (value: Record<string, unknown>) =>
    local.setItem(MOCK_TENANT_HOOKS_KEY, JSON.stringify({ ...JSON.parse(local.getItem(MOCK_TENANT_HOOKS_KEY) ?? "{}"), ...value }));
  // The provider's side: the stand-in page reads the same storage the server keeps.
  const desk = new MockTenantServer({ storage: local, accountStore: new MockTaskaStore(), latencyMs: 0 });
  return { api, local, setHooks, desk };
}

/** The stand-in page's token, from the address the checkout would open — the one way a test sees it. */
function tokenOf(checkout: Checkout): string {
  let address = "";
  checkout.redirect?.go({ assign: (url) => void (address = String(url)) });
  return decodeURIComponent(new URL(address).pathname.split("/").pop() ?? "");
}

describe("the routes (§1)", () => {
  it("are the session layer's, as for the REST leg", () => {
    for (const name of ["listInvoices", "getInvoice", "createCheckout", "getCheckout"] as const) expect(MOCK_COMPANY_ROUTES[name]).toBe("session");
  });
});

describe("owner only (§5.5, §7)", () => {
  it("Priya, an admin of Umbrella but not its owner, is refused all four with OWNER_REQUIRED", async () => {
    const { api } = await inCompany("priya@example.com", UM);
    for (const call of [
      () => api.listInvoices(UM),
      () => api.getInvoice(UM, RENEWAL),
      () => api.createCheckout(UM, RENEWAL, "BILLING", key()),
      () => api.getCheckout(UM, crypto.randomUUID()),
    ]) {
      expect(facts(await caught(call()))).toMatchObject({ status: 403, code: "OWNER_REQUIRED" });
    }
  });

  it("Tom, Umbrella's owner, reads its invoices newest first — narrowed, no buyer or lines", async () => {
    const { api } = await inCompany("tom@example.com", UM);
    const page = await api.listInvoices(UM);
    expect(page.items.map((invoice) => [invoice.number, invoice.purpose, invoice.state])).toEqual([
      ["TSK-2026-01008", "RENEWAL", "OPEN"],
      ["TSK-2026-01002", "INITIAL", "PAID"],
    ]);
    expect(page.nextCursor).toBeNull();
    expect(JSON.stringify(page)).not.toContain("billing@example.com");
    // TAS-515: the renewal of the plan Umbrella is on, Team v1 — no longer onto an announced v2.
    expect(await api.getInvoice(UM, RENEWAL)).toMatchObject({ planVersionId: MOCK_PLAN_IDS.teamRetired, total: { amountMinor: "1500", currency: "EUR", exponent: 2 } });
    expect(facts(await caught(api.getInvoice(UM, MOCK_INVOICE_IDS.starkInitial)))).toMatchObject({ status: 404, code: "RESOURCE_NOT_FOUND" });
  });
});

describe("the INITIAL invoice (addendum Q1, A53)", () => {
  it("is issued with a paid company — OPEN, the plan's price, due at its deadline; a FREE one has none", async () => {
    const local = new MemoryStorage();
    const api = createCompaniesMockApi({ local, session: new MemoryStorage(), locks: createLocalLockManager(), events: null, latencyMs: 0, ownershipWaitMs: 25 });
    await api.signIn({ email: "nina@example.com", password: "x" });
    const paid = await api.createTenant({ name: "Acme", planVersionId: MOCK_PLAN_IDS.team }, key());
    await api.enterCompany(paid.tenant.id);
    const [initial, ...rest] = (await api.listInvoices(paid.tenant.id)).items;
    expect(rest).toEqual([]);
    expect(initial).toMatchObject({ purpose: "INITIAL", state: "OPEN", paymentMethod: "PSP", planVersionId: MOCK_PLAN_IDS.team, dueAt: paid.tenant.creationDeadline });
    expect(initial.total).toEqual({ amountMinor: "2000", currency: "EUR", exponent: 2 });
    expect(initial.remaining).toEqual(initial.total);
    const free = await api.createTenant({ name: "Acme Free", planVersionId: MOCK_PLAN_IDS.free }, key());
    const stored = JSON.parse(local.getItem(MOCK_SERVER_KEY) ?? "{}") as { invoices: Array<{ tenantId: string }> };
    expect(stored.invoices.filter((invoice) => invoice.tenantId === free.tenant.id)).toEqual([]);
  });
});

describe("idempotency (§5.4, A57)", () => {
  it("the same key answers the same checkout; the same key with another body is a conflict; another key while it is active is INVALID_STATE", async () => {
    const { api } = await inCompany("tom@example.com", UM);
    const first = key();
    const one = await api.createCheckout(UM, RENEWAL, "BILLING", first);
    expect(one).toMatchObject({ invoiceId: RENEWAL, state: "CREATED" });
    expect(one.redirect).not.toBeNull();
    const again = await api.createCheckout(UM, RENEWAL, "BILLING", first);
    expect(again.id).toBe(one.id);
    expect(facts(await caught(api.createCheckout(UM, RENEWAL, "CREATION", first)))).toMatchObject({ status: 409, code: "IDEMPOTENCY_CONFLICT" });
    expect(facts(await caught(api.createCheckout(UM, RENEWAL, "BILLING", key())))).toMatchObject({ status: 409, code: "INVALID_STATE" });
  });

  it("a lost answer has made its checkout: the retry with the same key gets it", async () => {
    const { api, setHooks } = await inCompany("tom@example.com", UM);
    setHooks({ loseAnswer: ["createCheckout"] });
    const sent = key();
    await expect(api.createCheckout(UM, RENEWAL, "BILLING", sent)).rejects.toThrow();
    const retried = await api.createCheckout(UM, RENEWAL, "BILLING", sent);
    expect(retried.state).toBe("CREATED");
  });

  it("after a failure a new key makes a new checkout", async () => {
    const { api, desk } = await inCompany("tom@example.com", UM);
    const failed = await api.createCheckout(UM, RENEWAL, "BILLING", key());
    expect(desk.observeMockCheckout(tokenOf(failed), "fails")).toBe("return");
    expect((await api.getCheckout(UM, failed.id)).state).toBe("FAILED");
    expect((await api.getInvoice(UM, RENEWAL)).state).toBe("OPEN");
    const next = await api.createCheckout(UM, RENEWAL, "BILLING", key());
    expect(next.id).not.toBe(failed.id);
  });

  it("the stand-in page's token is never kept in a receipt, and its address only while the checkout is open", async () => {
    const { api, local, desk } = await inCompany("tom@example.com", UM, { settlementDelayMs: 60_000 });
    const checkout = await api.createCheckout(UM, RENEWAL, "BILLING", key());
    const token = tokenOf(checkout);
    const stored = JSON.parse(local.getItem(MOCK_SERVER_KEY) ?? "{}") as { checkoutReceipts: unknown };
    expect(JSON.stringify(stored.checkoutReceipts)).not.toContain(token);
    expect(desk.mockCheckoutPage(token)).toMatchObject({ checkoutId: checkout.id, company: "Umbrella", invoiceNumber: "TSK-2026-01008", open: true });
    expect((await api.getCheckout(UM, checkout.id)).state).toBe("PENDING");
    desk.observeMockCheckout(token, "succeeds");
    const succeeded = await api.getCheckout(UM, checkout.id);
    expect(succeeded.state).toBe("SUCCEEDED");
    expect(succeeded.redirect).toBeNull();
    expect(desk.mockCheckoutPage("mcs_nothing")).toBeNull();
  });
});

describe("settlement, in two steps (§5.2)", () => {
  it("a success is SUCCEEDED with the invoice still OPEN, then PAID once settled — and the paid period moves on from its end", async () => {
    const { api, desk, setHooks } = await inCompany("tom@example.com", UM, { settlementDelayMs: 60_000 });
    const before = (await api.getSubscription(UM)).paidThrough as string;
    const checkout = await api.createCheckout(UM, RENEWAL, "BILLING", key());
    desk.observeMockCheckout(tokenOf(checkout), "succeeds");
    expect((await api.getCheckout(UM, checkout.id)).state).toBe("SUCCEEDED");
    expect((await api.getInvoice(UM, RENEWAL)).state).toBe("OPEN");
    setHooks({ clockOffsetMs: 61_000 });
    const paid = await api.getInvoice(UM, RENEWAL);
    expect(paid.state).toBe("PAID");
    expect(paid.allocated).toEqual(paid.total);
    expect(paid.remaining?.amountMinor).toBe("0");
    expect(Date.parse((await api.getSubscription(UM)).paidThrough as string) - Date.parse(before)).toBe(30 * DAY);
    // Paid: no second checkout.
    expect(facts(await caught(api.createCheckout(UM, RENEWAL, "BILLING", key())))).toMatchObject({ status: 409, code: "INVALID_STATE" });
  });

  it("the renewal is due at the paid-through (TAS-515 NB4): past it the period has ended and the renewal can no longer be paid", async () => {
    const { api } = await inCompany("tom@example.com", UM, { clockOffsetMs: 46 * DAY, settlementDelayMs: 0 });
    const through = (await api.getSubscription(UM)).paidThrough as string;
    expect((await api.getTenant(UM)).restrictions).toContain("PAYMENT_EXPIRED");
    const renewal = await api.getInvoice(UM, RENEWAL);
    expect(renewal.state).toBe("EXPIRED");
    expect(Date.parse(renewal.dueAt as string)).toBeLessThanOrEqual(Date.parse(through));
    // The way back is a new purchase — MockTenantServer.planChange.test.ts re-buys the plan and lifts it.
    expect(facts(await caught(api.createCheckout(UM, RENEWAL, "BILLING", key())))).toMatchObject({ status: 409, code: "INVALID_STATE" });
  });

  it("Stark's first payment opens the company — PENDING_FIRST_PAYMENT gone, a paid period started", async () => {
    const { api, desk } = await inCompany("tom@example.com", ST, { settlementDelayMs: 0 });
    const checkout = await api.createCheckout(ST, MOCK_INVOICE_IDS.starkInitial, "CREATION", key());
    desk.observeMockCheckout(tokenOf(checkout), "succeeds");
    expect((await api.getInvoice(ST, MOCK_INVOICE_IDS.starkInitial)).state).toBe("PAID");
    const tenant = await api.getTenant(ST);
    expect(tenant.lifecycle).toBe("ACTIVE");
    expect(tenant.restrictions).not.toContain("PENDING_FIRST_PAYMENT");
    expect((await api.getSubscription(ST)).paidThrough).not.toBeNull();
  });
});

describe("cancel, unknown and late (§5.3, A56)", () => {
  it("a cancel changes nothing: PENDING until it expires, then EXPIRED, and a new key may pay", async () => {
    const { api, desk, setHooks } = await inCompany("tom@example.com", UM);
    const checkout = await api.createCheckout(UM, RENEWAL, "BILLING", key());
    expect(desk.observeMockCheckout(tokenOf(checkout), "cancel")).toBe("cancel");
    const pending = await api.getCheckout(UM, checkout.id);
    expect(pending.state).toBe("PENDING");
    expect(pending.redirect).not.toBeNull();
    setHooks({ clockOffsetMs: 31 * 60_000 });
    const expired = await api.getCheckout(UM, checkout.id);
    expect(expired.state).toBe("EXPIRED");
    expect(expired.redirect).toBeNull();
    expect((await api.createCheckout(UM, RENEWAL, "BILLING", key())).state).toBe("CREATED");
  });

  it("UNKNOWN stays until the provider answers (resolveCheckout), and a second key is refused meanwhile", async () => {
    const { api, desk, setHooks } = await inCompany("tom@example.com", UM, { settlementDelayMs: 0 });
    const checkout = await api.createCheckout(UM, RENEWAL, "BILLING", key());
    desk.observeMockCheckout(tokenOf(checkout), "unknown");
    setHooks({ clockOffsetMs: 40 * 60_000 });
    expect((await api.getCheckout(UM, checkout.id)).state).toBe("UNKNOWN");
    expect(facts(await caught(api.createCheckout(UM, RENEWAL, "BILLING", key())))).toMatchObject({ status: 409, code: "INVALID_STATE" });
    setHooks({ resolveCheckout: { [RENEWAL]: "SUCCEEDED" } });
    expect((await api.getCheckout(UM, checkout.id)).state).toBe("SUCCEEDED");
    expect((await api.getInvoice(UM, RENEWAL)).state).toBe("PAID");
  });

  it("a late success is PENDING for 20 s first", async () => {
    const { api, desk, setHooks } = await inCompany("tom@example.com", UM, { settlementDelayMs: 0 });
    const checkout = await api.createCheckout(UM, RENEWAL, "BILLING", key());
    desk.observeMockCheckout(tokenOf(checkout), "succeedsLater");
    expect((await api.getCheckout(UM, checkout.id)).state).toBe("PENDING");
    setHooks({ clockOffsetMs: 21_000 });
    expect((await api.getCheckout(UM, checkout.id)).state).toBe("SUCCEEDED");
    expect((await api.getInvoice(UM, RENEWAL)).state).toBe("PAID");
  });
});

describe("refusals (§5.7, §6)", () => {
  it("checkout off: 503 POLICY_NOT_CONFIGURED for as long as it is set; 403 CAPABILITY_DISABLED with and without reasons", async () => {
    const { api, setHooks } = await inCompany("tom@example.com", UM, { checkoutOff: { status: 503, code: "POLICY_NOT_CONFIGURED" } });
    for (let press = 0; press < 2; press += 1) {
      expect(facts(await caught(api.createCheckout(UM, RENEWAL, "BILLING", key())))).toMatchObject({ status: 503, code: "POLICY_NOT_CONFIGURED" });
    }
    setHooks({ checkoutOff: { status: 403, code: "CAPABILITY_DISABLED", reasons: ["PAYMENT_DISPUTE"] } });
    expect(facts(await caught(api.createCheckout(UM, RENEWAL, "BILLING", key())))).toEqual({ status: 403, code: "CAPABILITY_DISABLED", reasons: ["PAYMENT_DISPUTE"] });
    setHooks({ checkoutOff: { status: 403, code: "CAPABILITY_DISABLED" } });
    expect(facts(await caught(api.createCheckout(UM, RENEWAL, "BILLING", key())))).toEqual({ status: 403, code: "CAPABILITY_DISABLED", reasons: [] });
  });

  it("a blocked company's owner reads its invoices but cannot pay (READ_ONLY with the block); a paid invoice is not payable", async () => {
    const { api } = await inCompany("priya@example.com", HO);
    expect((await api.listInvoices(HO)).items).toHaveLength(1);
    expect(facts(await caught(api.createCheckout(HO, MOCK_INVOICE_IDS.hooliInitial, "BILLING", key())))).toEqual({
      status: 403,
      code: "READ_ONLY",
      reasons: ["PLATFORM_BLOCK"],
    });
    const umbrella = await inCompany("tom@example.com", UM);
    expect(facts(await caught(umbrella.api.createCheckout(UM, MOCK_INVOICE_IDS.umbrellaInitial, "BILLING", key())))).toMatchObject({
      status: 409,
      code: "INVALID_STATE",
    });
  });

  it("an invoice past its due date expires, and so does its open checkout", async () => {
    const { api, setHooks } = await inCompany("tom@example.com", ST);
    const checkout = await api.createCheckout(ST, MOCK_INVOICE_IDS.starkInitial, "CREATION", key());
    setHooks({ clockOffsetMs: 11 * DAY });
    expect((await api.getCheckout(ST, checkout.id)).state).toBe("EXPIRED");
    expect((await api.getInvoice(ST, MOCK_INVOICE_IDS.starkInitial)).state).toBe("EXPIRED");
  });
});

describe("signing out (§2)", () => {
  it("clears the account's payment attempts and nobody else's", async () => {
    const { api, local } = await inCompany("tom@example.com", UM);
    const tom = (await api.getCurrentUser()).id;
    const record = (userId: string) => JSON.stringify({ v: 1, userId, tenantId: UM, invoiceId: RENEWAL, key: key(), returnTarget: "BILLING", startedAt: "2026-11-11T09:00:00Z" });
    local.setItem(checkoutAttemptKey(tom, UM, RENEWAL), record(tom));
    local.setItem(checkoutAttemptKey("someone", UM, RENEWAL), record("someone"));
    await api.logout();
    expect(local.getItem(checkoutAttemptKey(tom, UM, RENEWAL))).toBeNull();
    expect(local.getItem(checkoutAttemptKey("someone", UM, RENEWAL))).not.toBeNull();
  });
});
