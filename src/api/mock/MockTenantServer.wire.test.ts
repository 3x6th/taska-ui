import { describe, expect, it } from "vitest";
import { MemoryStorage } from "../../test/memoryStorage";
import { UnreadableAnswerError } from "../billing";
import { apiErrorFacts, refusalCode } from "../errors";
import { createLocalLockManager } from "../webSession";
import {
  MOCK_INVOICE_IDS,
  MOCK_PLAN_IDS,
  MOCK_SERVER_KEY,
  MOCK_TENANT_HOOKS_KEY,
  MOCK_TENANT_IDS,
  MOCK_WIRE_BANK,
  MOCK_WIRE_BENEFICIARY,
  MOCK_WIRE_BIC,
  MOCK_WIRE_IBAN,
} from "./MockTenantServer";
import { MOCK_ACCOUNT_IDS } from "./MockTaskaApi";
import { MOCK_COMPANY_ROUTES, createCompaniesMockApi } from "./mockCompanies";

/*
 * The companies mock's bank transfers, documents and refunds (TAS-514,
 * api-contract-guard's pre-build ruling §7 and its addendum B17): every wire
 * fixture is Cyberdyne Systems'; snapshots stored at issuance (F1); receipts
 * and refunds only through the admin's hooks — matched short of the rest,
 * allocated whole, expired with the money kept until it is returned, 25
 * against 20, a late first payment, a late renewal (D247) — the owner's three
 * new reads, and the bank details invalid by construction.
 */

const CY = MOCK_TENANT_IDS.cyberdyne;
const RENEWAL = MOCK_INVOICE_IDS.cyberdyneRenewal;
const DAY = 24 * 60 * 60_000;
const key = () => crypto.randomUUID();
const caught = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error("expected a refusal");
    },
    (error: unknown) => error,
  );
const facts = (error: unknown) => ({ status: apiErrorFacts(error).status, code: refusalCode(error) });

interface StateShape {
  tenants: Array<{ id: string; name: string; lifecycle: string; restrictions: string[]; subscription: { paidThrough?: string } }>;
  invoices: Array<Record<string, unknown> & { id: string; tenantId: string; state: string; purpose: string }>;
  wireReceipts: Array<Record<string, unknown> & { id: string }>;
  refunds: Array<Record<string, unknown> & { receiptId: string }>;
}

async function signedIn(email: string, hooks: Record<string, unknown> = {}) {
  const local = new MemoryStorage();
  local.setItem(MOCK_TENANT_HOOKS_KEY, JSON.stringify(hooks));
  const api = createCompaniesMockApi({ local, session: new MemoryStorage(), locks: createLocalLockManager(), events: null, latencyMs: 0, ownershipWaitMs: 25 });
  await api.signIn({ email, password: "x" });
  const setHooks = (value: Record<string, unknown>) =>
    local.setItem(MOCK_TENANT_HOOKS_KEY, JSON.stringify({ ...JSON.parse(local.getItem(MOCK_TENANT_HOOKS_KEY) ?? "{}"), ...value }));
  const state = () => JSON.parse(local.getItem(MOCK_SERVER_KEY) ?? "{}") as StateShape;
  return { api, local, setHooks, state };
}

async function inCyberdyne(email = "tom@example.com", hooks: Record<string, unknown> = {}) {
  const tab = await signedIn(email, hooks);
  await tab.api.enterCompany(CY);
  return tab;
}

const money = (amountMinor: string, currency = "EUR") => ({ amountMinor, currency, exponent: 2 });
const confirm = (id: string, amountMinor: string, invoiceId: string = RENEWAL, extra: Record<string, unknown> = {}) => ({
  wireReceipts: [{ id, tenantId: CY, amountMinor, ...extra }],
  confirmWire: { [id]: invoiceId },
});

/** The IBAN's ISO 7064 mod-97 — 1 for a valid one. */
function mod97(iban: string): number {
  const moved = `${iban.slice(4)}${iban.slice(0, 4)}`.replace(/[A-Z]/g, (char) => String(char.charCodeAt(0) - 55));
  return [...moved].reduce((rest, digit) => (rest * 10 + Number(digit)) % 97, 0);
}

describe("the routes (§1)", () => {
  it("are the session layer's, as for the REST leg", () => {
    for (const name of ["getInvoiceDocument", "listRefunds", "getTenantCapabilities"] as const) expect(MOCK_COMPANY_ROUTES[name]).toBe("session");
  });
});

describe("Cyberdyne's fixtures (B17)", () => {
  it("its invoices: the late first, the paid replacement, the VOID dollar plan change, the open wire renewal", async () => {
    const { api } = await inCyberdyne();
    const page = await api.listInvoices(CY);
    expect(page.items.map((invoice) => [invoice.number, invoice.purpose, invoice.state, invoice.paymentMethod])).toEqual([
      ["TSK-2026-00904", "RENEWAL", "OPEN", "WIRE"],
      ["TSK-2026-00903", "PLAN_CHANGE", "VOID", "PSP"],
      ["TSK-2026-00902", "INITIAL", "PAID", "WIRE"],
      ["TSK-2026-00901", "INITIAL", "EXPIRED", "WIRE"],
    ]);
    expect(page.items[0].wireInstructions).toEqual({
      beneficiaryName: MOCK_WIRE_BENEFICIARY,
      iban: MOCK_WIRE_IBAN,
      bic: MOCK_WIRE_BIC,
      bankName: MOCK_WIRE_BANK,
      reference: "TASKA-TSK-2026-00904",
    });
    expect(page.items[1].wireInstructions).toBeNull();
    expect(page.items[2].replacesInvoiceId).toBe(MOCK_INVOICE_IDS.cyberdyneLateInitial);
    const dollars = await api.getInvoice(CY, MOCK_INVOICE_IDS.cyberdynePlanChange);
    expect(dollars.total).toEqual(money("4333", "USD"));
    expect(dollars.fxQuote).toMatchObject({ baseCurrency: "EUR", quoteCurrency: "USD", rate: "1.0832" });
    const line = dollars.lines?.[0];
    expect(BigInt(line?.net?.amountMinor ?? "0") + BigInt(line?.taxes[0]?.amount?.amountMinor ?? "0")).toBe(4333n);
    const three = await api.getInvoice(CY, MOCK_INVOICE_IDS.cyberdyneInitial);
    expect(three.lines?.reduce((sum, item) => sum + BigInt(item.total?.amountMinor ?? "0"), 0n)).toBe(2000n);
    expect((await api.listRefunds(CY)).items.map((refund) => [refund.reasonCode, refund.state])).toEqual([["LATE_FIRST_PAYMENT", "CONFIRMED"]]);
  });

  it("the bank details can never be paid to: country XX, check digits 00, no valid mod-97", () => {
    expect(MOCK_WIRE_IBAN.slice(0, 4)).toBe("XX00");
    expect(mod97(MOCK_WIRE_IBAN)).not.toBe(1);
    expect(MOCK_WIRE_IBAN).toMatch(/^[A-Z0-9]{15,34}$/);
    expect(MOCK_WIRE_BIC).toMatch(/^[A-Z0-9]{8}([A-Z0-9]{3})?$/);
  });

  it("a wire invoice cannot be checked out (TAS-513's 409)", async () => {
    const { api } = await inCyberdyne();
    expect(facts(await caught(api.createCheckout(CY, RENEWAL, "BILLING", key())))).toMatchObject({ status: 409, code: "INVALID_STATE" });
  });
});

describe("snapshots stored at issuance (F1)", () => {
  it("a rename and a transfer leave issued invoices as they were; a new invoice takes the name then", async () => {
    const { api, local, setHooks } = await inCyberdyne();
    const before = await api.getInvoice(CY, RENEWAL);
    const tenant = await api.getTenant(CY);
    const renamed = await api.renameTenant(CY, "Cyberdyne Labs", tenant.version ?? "", key());
    expect((await api.getInvoice(CY, RENEWAL)).buyer).toEqual(before.buyer);
    // Paid on time, renewed early; then the calendar issues the next renewal to the company as it is called now.
    setHooks(confirm("r-20", "2000"));
    expect(await api.getInvoice(CY, RENEWAL)).toMatchObject({ state: "PAID" });
    setHooks({ clockOffsetMs: 28 * DAY });
    const next = (await api.listInvoices(CY)).items.find((invoice) => invoice.purpose === "RENEWAL" && invoice.state === "OPEN");
    expect(next?.paymentMethod).toBe("WIRE");
    expect((await api.getInvoice(CY, next?.id ?? "")).buyer?.name).toBe("Cyberdyne Labs");
    await api.transferTenantOwnership(CY, MOCK_ACCOUNT_IDS.priya, renamed.version ?? "", key());
    const priya = createCompaniesMockApi({ local, session: new MemoryStorage(), locks: createLocalLockManager(), events: null, latencyMs: 0, ownershipWaitMs: 25 });
    await priya.signIn({ email: "priya@example.com", password: "x" });
    await priya.enterCompany(CY);
    const after = await priya.getInvoice(CY, RENEWAL);
    expect(after.buyer).toEqual(before.buyer);
    expect(after.buyer?.name).toBe("Cyberdyne Systems");
    expect(after.lines).toEqual(before.lines);
  });
});

describe("the admin's hooks (§7.3–7.5)", () => {
  it("a recorded receipt alone changes nothing the owner reads", async () => {
    const { api, setHooks } = await inCyberdyne();
    setHooks({ wireReceipts: [{ id: "r", tenantId: CY, amountMinor: "2000" }] });
    expect(await api.getInvoice(CY, RENEWAL)).toMatchObject({ state: "OPEN", matchedUnallocated: money("0"), remaining: money("2000") });
  });

  it("12 of 20 on time: matched, PARTIALLY_PAID, nothing allocated or covered; the 8 later — one allocation of 20, a month from the current end", async () => {
    const { api, setHooks } = await inCyberdyne();
    const before = (await api.getSubscription(CY)).paidThrough;
    setHooks(confirm("r-12", "1200"));
    expect(await api.getInvoice(CY, RENEWAL)).toMatchObject({ state: "PARTIALLY_PAID", matchedUnallocated: money("1200"), allocated: money("0"), remaining: money("800") });
    expect((await api.getSubscription(CY)).paidThrough).toBe(before);
    setHooks({ wireReceipts: [{ id: "r-12", tenantId: CY, amountMinor: "1200" }, { id: "r-8", tenantId: CY, amountMinor: "800" }], confirmWire: { "r-12": RENEWAL, "r-8": RENEWAL } });
    expect(await api.getInvoice(CY, RENEWAL)).toMatchObject({ state: "PAID", matchedUnallocated: money("0"), allocated: money("2000"), remaining: money("0") });
    expect(Date.parse((await api.getSubscription(CY)).paidThrough ?? "") - Date.parse(before ?? "")).toBe(30 * DAY);
  });

  it("past the due date the partial expires, its money kept until the return is confirmed — never returned before, never automatically", async () => {
    const { api, setHooks, state } = await inCyberdyne();
    setHooks({ ...confirm("r-12", "1200"), returnUnallocated: ["r-12"] });
    expect(await api.getInvoice(CY, RENEWAL)).toMatchObject({ state: "PARTIALLY_PAID" });
    expect(state().refunds.filter((refund) => refund.receiptId === "r-12")).toEqual([]);
    setHooks({ clockOffsetMs: 5 * DAY });
    expect(await api.getInvoice(CY, RENEWAL)).toMatchObject({ state: "EXPIRED", matchedUnallocated: money("1200") });
    const [refund] = (await api.listRefunds(CY)).items;
    expect(refund).toMatchObject({ reasonCode: "INCOMPLETE_BANK_PAYMENT", state: "REQUESTED", amount: money("1200"), sourceMethod: "WIRE", feeBearer: "TASKA", sendDueAt: null });
    // The evidence complete: the WIRE SLA set at once, frozen — send due five business dates on.
    setHooks({ evidenceComplete: ["r-12"] });
    // The hooks are the server's to apply, on its next operation.
    await api.listRefunds(CY);
    const stored = state().refunds.find((item) => item.receiptId === "r-12");
    expect(stored).toMatchObject({ slaPolicyVersion: "WIRE_RETURN_ES_V1", decisionDueAt: stored?.sendDueAt });
    const evidence = Date.parse(String(stored?.evidenceCompletedAt));
    const due = Date.parse(String(stored?.sendDueAt));
    expect(due - evidence).toBeGreaterThanOrEqual(5 * DAY);
    expect(due - evidence).toBeLessThanOrEqual(9 * DAY);
    expect([0, 6]).not.toContain(new Date(due).getUTCDay());
    setHooks({ clockOffsetMs: 6 * DAY, evidenceComplete: ["r-12"] });
    await api.listRefunds(CY);
    expect(state().refunds.find((item) => item.receiptId === "r-12")?.sendDueAt).toBe(stored?.sendDueAt);
    setHooks({ refundProgress: { "r-12": "CONFIRMED" } });
    expect(await api.getInvoice(CY, RENEWAL)).toMatchObject({ state: "EXPIRED", matchedUnallocated: money("0") });
    expect((await api.listRefunds(CY)).items[0]).toMatchObject({ state: "CONFIRMED", confirmedAt: expect.any(String) });
  });

  it("G2: 12 matched on time, then expired — a late full 20 pays the renewal and the 12 still goes back, never swallowed", async () => {
    const { api, setHooks, state } = await inCyberdyne();
    setHooks(confirm("r-12", "1200"));
    expect(await api.getInvoice(CY, RENEWAL)).toMatchObject({ state: "PARTIALLY_PAID", matchedUnallocated: money("1200") });
    setHooks({ clockOffsetMs: 6 * DAY });
    expect(await api.getInvoice(CY, RENEWAL)).toMatchObject({ state: "EXPIRED", matchedUnallocated: money("1200") });
    // Set to go back on the receipt itself, at expiry (L06.4–5).
    expect(state().wireReceipts.find((item) => item.id === "r-12")).toMatchObject({ outcome: "RETURN_REQUIRED", unallocated: money("1200") });
    setHooks({
      wireReceipts: [
        { id: "r-12", tenantId: CY, amountMinor: "1200" },
        { id: "r-20", tenantId: CY, amountMinor: "2000" },
      ],
      confirmWire: { "r-12": RENEWAL, "r-20": RENEWAL },
    });
    // D247: the late 20 alone pays it — not the 12 with 8 of it.
    expect(await api.getInvoice(CY, RENEWAL)).toMatchObject({ state: "PAID", allocated: money("2000") });
    expect(state().wireReceipts.find((item) => item.id === "r-20")).toMatchObject({ outcome: "ALLOCATED", unallocated: money("0") });
    expect(state().wireReceipts.find((item) => item.id === "r-12")).toMatchObject({ outcome: "RETURN_REQUIRED", unallocated: money("1200") });
    setHooks({ returnUnallocated: ["r-12", "r-20"] });
    const refunds = (await api.listRefunds(CY)).items;
    expect(refunds.filter((refund) => refund.reasonCode !== "LATE_FIRST_PAYMENT").map((refund) => [refund.reasonCode, refund.amount, refund.state])).toEqual([
      ["INCOMPLETE_BANK_PAYMENT", money("1200"), "REQUESTED"],
    ]);
    // Its confirmed return leaves the paid invoice as it is.
    setHooks({ refundProgress: { "r-12": "CONFIRMED" } });
    expect(await api.getInvoice(CY, RENEWAL)).toMatchObject({ state: "PAID", allocated: money("2000"), matchedUnallocated: money("0") });
    expect(state().wireReceipts.find((item) => item.id === "r-12")).toMatchObject({ unallocated: money("0") });
  });

  it("G2: money arrived on time but confirmed only after the expiry is set to go back at once — it joins nothing", async () => {
    const { api, setHooks, state } = await inCyberdyne("tom@example.com", { clockOffsetMs: 6 * DAY });
    const due = (await api.getInvoice(CY, RENEWAL)).dueAt ?? "";
    const before = new Date(Date.parse(due) - DAY).toISOString();
    setHooks({ ...confirm("r-on-time", "800", RENEWAL, { occurredAt: before }), returnUnallocated: ["r-on-time"] });
    expect(await api.getInvoice(CY, RENEWAL)).toMatchObject({ state: "EXPIRED", matchedUnallocated: money("800") });
    expect(state().wireReceipts.find((item) => item.id === "r-on-time")).toMatchObject({ outcome: "RETURN_REQUIRED" });
    expect((await api.listRefunds(CY)).items[0]).toMatchObject({ reasonCode: "INCOMPLETE_BANK_PAYMENT", amount: money("800") });
  });

  it("TAS-516 (guard N1, G2): 12 on time, expired, then 8 that arrived on time confirmed after — together they pay it: PAID, 20 allocated", async () => {
    const { api, setHooks, state } = await inCyberdyne();
    const before = (await api.getSubscription(CY)).paidThrough;
    setHooks(confirm("r-12", "1200"));
    const due = (await api.getInvoice(CY, RENEWAL)).dueAt ?? "";
    setHooks({ clockOffsetMs: 6 * DAY });
    expect(await api.getInvoice(CY, RENEWAL)).toMatchObject({ state: "EXPIRED", matchedUnallocated: money("1200") });
    expect(state().wireReceipts.find((item) => item.id === "r-12")).toMatchObject({ outcome: "RETURN_REQUIRED" });
    setHooks({
      wireReceipts: [
        { id: "r-12", tenantId: CY, amountMinor: "1200" },
        { id: "r-8", tenantId: CY, amountMinor: "800", occurredAt: new Date(Date.parse(due) - DAY).toISOString() },
      ],
      confirmWire: { "r-12": RENEWAL, "r-8": RENEWAL },
    });
    expect(await api.getInvoice(CY, RENEWAL)).toMatchObject({ state: "PAID", allocated: money("2000"), matchedUnallocated: money("0"), remaining: money("0") });
    for (const id of ["r-12", "r-8"]) expect(state().wireReceipts.find((item) => item.id === id)).toMatchObject({ outcome: "ALLOCATED", unallocated: money("0") });
    // Nothing of it is left to go back, and the company is paid for again — its ended period renewed from the settlement.
    setHooks({ returnUnallocated: ["r-12", "r-8"] });
    expect((await api.listRefunds(CY)).items.filter((refund) => refund.reasonCode !== "LATE_FIRST_PAYMENT")).toEqual([]);
    expect(Date.parse((await api.getSubscription(CY)).paidThrough ?? "")).toBeGreaterThan(Date.parse(before ?? "") + 30 * DAY);
    expect(state().tenants.find((tenant) => tenant.id === CY)?.restrictions).not.toContain("PAYMENT_EXPIRED");
  });

  it("TAS-516 (guard N1): a return once started is never undone — the 12 whose return began stays to go back, and the 8 alone pays nothing", async () => {
    const { api, setHooks, state } = await inCyberdyne();
    setHooks({ ...confirm("r-12", "1200"), returnUnallocated: ["r-12"] });
    const due = (await api.getInvoice(CY, RENEWAL)).dueAt ?? "";
    setHooks({ clockOffsetMs: 6 * DAY });
    expect(await api.getInvoice(CY, RENEWAL)).toMatchObject({ state: "EXPIRED" });
    expect(state().wireReceipts.find((item) => item.id === "r-12")).toMatchObject({ outcome: "RETURN_REQUIRED", refundId: expect.any(String) });
    setHooks({
      wireReceipts: [
        { id: "r-12", tenantId: CY, amountMinor: "1200" },
        { id: "r-8", tenantId: CY, amountMinor: "800", occurredAt: new Date(Date.parse(due) - DAY).toISOString() },
      ],
      confirmWire: { "r-12": RENEWAL, "r-8": RENEWAL },
    });
    expect(await api.getInvoice(CY, RENEWAL)).toMatchObject({ state: "EXPIRED", allocated: money("0"), matchedUnallocated: money("2000") });
    for (const id of ["r-12", "r-8"]) expect(state().wireReceipts.find((item) => item.id === id)).toMatchObject({ outcome: "RETURN_REQUIRED" });
  });

  it("TAS-516 (guard G2 hole): under holdExpiry, 12 matched and a late full 20 — the 20 pays it and the 12 is set to go back, never left matched", async () => {
    const { api, setHooks, state } = await inCyberdyne();
    setHooks({ ...confirm("r-12", "1200"), holdExpiry: [RENEWAL] });
    expect(await api.getInvoice(CY, RENEWAL)).toMatchObject({ state: "PARTIALLY_PAID" });
    setHooks({ clockOffsetMs: 6 * DAY });
    expect(await api.getInvoice(CY, RENEWAL)).toMatchObject({ state: "PARTIALLY_PAID", matchedUnallocated: money("1200") });
    expect(state().wireReceipts.find((item) => item.id === "r-12")).toMatchObject({ outcome: "MATCHED" });
    setHooks({
      wireReceipts: [
        { id: "r-12", tenantId: CY, amountMinor: "1200" },
        { id: "r-20", tenantId: CY, amountMinor: "2000" },
      ],
      confirmWire: { "r-12": RENEWAL, "r-20": RENEWAL },
    });
    expect(await api.getInvoice(CY, RENEWAL)).toMatchObject({ state: "PAID", allocated: money("2000") });
    expect(state().wireReceipts.find((item) => item.id === "r-20")).toMatchObject({ outcome: "ALLOCATED" });
    expect(state().wireReceipts.find((item) => item.id === "r-12")).toMatchObject({ outcome: "RETURN_REQUIRED", unallocated: money("1200") });
    setHooks({ returnUnallocated: ["r-12"] });
    expect((await api.listRefunds(CY)).items[0]).toMatchObject({ reasonCode: "INCOMPLETE_BANK_PAYMENT", amount: money("1200"), state: "REQUESTED" });
  });

  it("25 against 20: PAID at 20, 5 left on the receipt and returned as EXCESS; the subscription runs on", async () => {
    const { api, setHooks } = await inCyberdyne();
    const before = (await api.getSubscription(CY)).paidThrough;
    setHooks({ ...confirm("r-25", "2500"), returnUnallocated: ["r-25"] });
    expect(await api.getInvoice(CY, RENEWAL)).toMatchObject({ state: "PAID", allocated: money("2000") });
    expect((await api.listRefunds(CY)).items[0]).toMatchObject({ reasonCode: "EXCESS", amount: money("500"), state: "REQUESTED", kind: "UNALLOCATED_RETURN" });
    expect(Date.parse((await api.getSubscription(CY)).paidThrough ?? "") - Date.parse(before ?? "")).toBe(30 * DAY);
  });

  it("a late renewal (D247): EXPIRED then PAID, a month from the confirmation, PAYMENT_EXPIRED lifted — not for a blocked company", async () => {
    const { api, setHooks } = await inCyberdyne("tom@example.com", { clockOffsetMs: 6 * DAY });
    expect(await api.getInvoice(CY, RENEWAL)).toMatchObject({ state: "EXPIRED" });
    expect((await api.getTenant(CY)).restrictions).toContain("PAYMENT_EXPIRED");
    setHooks(confirm("r-late", "2000"));
    expect(await api.getInvoice(CY, RENEWAL)).toMatchObject({ state: "PAID" });
    const through = Date.parse((await api.getSubscription(CY)).paidThrough ?? "");
    expect(Math.abs(through - (Date.now() + 36 * DAY))).toBeLessThan(DAY);
    expect((await api.getTenant(CY)).restrictions).not.toContain("PAYMENT_EXPIRED");

    const blocked = await inCyberdyne("tom@example.com", { clockOffsetMs: 6 * DAY, platformBlock: { [CY]: true } });
    blocked.setHooks(confirm("r-blocked", "2000"));
    expect(await blocked.api.getInvoice(CY, RENEWAL)).toMatchObject({ state: "EXPIRED" });
    expect(blocked.state().wireReceipts.find((item) => item.id === "r-blocked")?.confirmedAt).toBeUndefined();
  });

  it("DAY precision on the due date's own day, or an invoice of another company: nothing visible", async () => {
    const { api, setHooks, state } = await inCyberdyne();
    const due = (await api.getInvoice(CY, RENEWAL)).dueAt ?? "";
    setHooks({
      wireReceipts: [
        { id: "r-day", tenantId: CY, amountMinor: "2000", occurredAt: due, precision: "DAY" },
        { id: "r-other", tenantId: CY, amountMinor: "2000" },
      ],
      confirmWire: { "r-day": RENEWAL, "r-other": MOCK_INVOICE_IDS.umbrellaRenewal },
    });
    expect(await api.getInvoice(CY, RENEWAL)).toMatchObject({ state: "OPEN", matchedUnallocated: money("0") });
    expect(state().wireReceipts.filter((item) => item.confirmedAt !== undefined).map((item) => item.id).sort()).toEqual([
      "7e1a0c55-4d2b-4c1e-9f3a-000000000901",
      "7e1a0c55-4d2b-4c1e-9f3a-000000000902",
    ]);
  });

  it("holdExpiry keeps an open invoice past its due date, as develop does", async () => {
    const { api } = await inCyberdyne("tom@example.com", { clockOffsetMs: 6 * DAY, holdExpiry: [RENEWAL] });
    expect(await api.getInvoice(CY, RENEWAL)).toMatchObject({ state: "OPEN" });
  });
});

describe("a first payment by bank transfer (§7.3, D238, D216)", () => {
  async function created(hooks: Record<string, unknown> = {}) {
    const tab = await signedIn("nina@example.com", { issueMethod: { "*": "WIRE" }, ...hooks });
    const { tenant } = await tab.api.createTenant({ name: "Acme Wire", planVersionId: MOCK_PLAN_IDS.team }, key());
    await tab.api.enterCompany(tenant.id);
    const [first] = (await tab.api.listInvoices(tenant.id)).items;
    return { ...tab, tenantId: tenant.id, first, deadline: tenant.creationDeadline ?? "" };
  }

  it("is issued WIRE with its bank details, due a week on, before the deadline", async () => {
    const { first, deadline } = await created();
    expect(first).toMatchObject({ purpose: "INITIAL", state: "OPEN", paymentMethod: "WIRE", wireInstructions: { reference: `TASKA-${first.number}` } });
    expect(Date.parse(first.dueAt ?? "") - Date.parse(first.issuedAt ?? "")).toBe(7 * DAY);
    expect(Date.parse(first.dueAt ?? "")).toBeLessThan(Date.parse(deadline));
  });

  it("late while the creation is open: nothing activates, a replacement due by the unchanged deadline, LATE_FIRST_PAYMENT", async () => {
    const { api, setHooks, tenantId, first, deadline } = await created();
    setHooks({ clockOffsetMs: 8 * DAY, wireReceipts: [{ id: "r-first", tenantId, amountMinor: "2000" }], confirmWire: { "r-first": first.id }, returnUnallocated: ["r-first"] });
    const items = (await api.listInvoices(tenantId)).items;
    const replacement = items.find((invoice) => invoice.replacesInvoiceId === first.id);
    expect(items.find((invoice) => invoice.id === first.id)?.state).toBe("EXPIRED");
    expect(replacement).toMatchObject({ purpose: "INITIAL", state: "OPEN", paymentMethod: "WIRE" });
    expect(Date.parse(replacement?.dueAt ?? "")).toBeLessThanOrEqual(Date.parse(deadline));
    expect(await api.getTenant(tenantId)).toMatchObject({ lifecycle: "AWAITING_PAYMENT", creationDeadline: deadline });
    expect((await api.listRefunds(tenantId)).items[0]).toMatchObject({ reasonCode: "LATE_FIRST_PAYMENT", amount: money("2000") });
  });

  it("on time and in full: the company opens with a month from the confirmation", async () => {
    const { api, setHooks, tenantId, first } = await created();
    setHooks({ wireReceipts: [{ id: "r-ok", tenantId, amountMinor: "2000" }], confirmWire: { "r-ok": first.id } });
    expect(await api.getTenant(tenantId)).toMatchObject({ lifecycle: "ACTIVE" });
    expect(Math.abs(Date.parse((await api.getSubscription(tenantId)).paidThrough ?? "") - (Date.now() + 30 * DAY))).toBeLessThan(DAY);
  });

  it("a closed creation: late money is CLOSED_CREATION; money that arrived in time reopens it (D216)", async () => {
    const late = await created();
    late.setHooks({ clockOffsetMs: 31 * DAY, wireReceipts: [{ id: "r-closed", tenantId: late.tenantId, amountMinor: "2000" }], confirmWire: { "r-closed": late.first.id } });
    await late.api.listTenants();
    expect(late.state().tenants.find((tenant) => tenant.id === late.tenantId)?.lifecycle).toBe("AUTO_CLOSED");
    expect(late.state().wireReceipts.find((item) => item.id === "r-closed")).toMatchObject({ outcome: "CLOSED_CREATION" });

    const timely = await created();
    const arrived = new Date(Date.parse(timely.first.issuedAt ?? "") + DAY).toISOString();
    timely.setHooks({
      clockOffsetMs: 31 * DAY,
      wireReceipts: [{ id: "r-timely", tenantId: timely.tenantId, amountMinor: "2000", occurredAt: arrived }],
      confirmWire: { "r-timely": timely.first.id },
    });
    await timely.api.listTenants();
    expect(timely.state().tenants.find((tenant) => tenant.id === timely.tenantId)?.lifecycle).toBe("ACTIVE");
  });
});

describe("the owner's three reads (§7.6–7.8)", () => {
  it("refunds and documents are the owner's: Priya, an admin of Cyberdyne, is refused both — and may read the durations", async () => {
    const { api } = await inCyberdyne("priya@example.com");
    expect(facts(await caught(api.listRefunds(CY)))).toMatchObject({ status: 403, code: "OWNER_REQUIRED" });
    expect(facts(await caught(api.getInvoiceDocument(CY, RENEWAL)))).toMatchObject({ status: 403, code: "OWNER_REQUIRED" });
    expect(await api.getTenantCapabilities(CY)).toMatchObject({ tenantId: CY, wireReconciliationTargetSeconds: 86400 });
  });

  it("the document: a valid PDF of the stored snapshot, marked as no tax document; another company's invoice is 404", async () => {
    const { api } = await inCyberdyne();
    const document = await api.getInvoiceDocument(CY, RENEWAL);
    expect(document.fileName).toBeNull();
    const bytes = new Uint8Array(await document.blob.arrayBuffer());
    const text = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
    expect(text.startsWith("%PDF-1.4\n")).toBe(true);
    expect(text.endsWith("%%EOF\n")).toBe(true);
    expect(text).toContain("MOCK \x97 not a tax document");
    expect(text).toContain("Billed to Cyberdyne Systems");
    // Every cross-reference offset points at its object.
    const xref = Number(/startxref\n(\d+)/.exec(text)?.[1]);
    expect(text.slice(xref, xref + 4)).toBe("xref");
    const offsets = [...text.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((match) => Number(match[1]));
    offsets.forEach((offset, index) => expect(text.slice(offset).startsWith(`${index + 1} 0 obj`)).toBe(true));
    expect(facts(await caught(api.getInvoiceDocument(CY, MOCK_INVOICE_IDS.umbrellaRenewal)))).toMatchObject({ status: 404, code: "RESOURCE_NOT_FOUND" });
  });

  it("documentOff is 503 POLICY_NOT_CONFIGURED, documentType another type — no document; refuseNext takes it once", async () => {
    const { api, setHooks } = await inCyberdyne("tom@example.com", { documentOff: true });
    expect(facts(await caught(api.getInvoiceDocument(CY, RENEWAL)))).toMatchObject({ status: 503, code: "POLICY_NOT_CONFIGURED" });
    setHooks({ documentOff: false, documentType: "text/html" });
    await expect(api.getInvoiceDocument(CY, RENEWAL)).rejects.toBeInstanceOf(UnreadableAnswerError);
    setHooks({ documentType: "", refuseNext: { getInvoiceDocument: { status: 404, code: "RESOURCE_NOT_FOUND" } } });
    expect(facts(await caught(api.getInvoiceDocument(CY, RENEWAL)))).toMatchObject({ status: 404 });
    await expect(api.getInvoiceDocument(CY, RENEWAL)).resolves.toMatchObject({ fileName: null });
  });

  it("the target: 86 400 by default, another by the hook, none when the hook is null", async () => {
    const { api, setHooks } = await inCyberdyne();
    expect((await api.getTenantCapabilities(CY)).wireReconciliationTargetSeconds).toBe(86400);
    setHooks({ reconciliationTargetSeconds: 3600 });
    expect((await api.getTenantCapabilities(CY)).wireReconciliationTargetSeconds).toBe(3600);
    setHooks({ reconciliationTargetSeconds: null });
    expect((await api.getTenantCapabilities(CY)).wireReconciliationTargetSeconds).toBeNull();
  });

  it("refunds newest first, by keyset pages", async () => {
    const { api, setHooks } = await inCyberdyne();
    setHooks({ ...confirm("r-25", "2500"), returnUnallocated: ["r-25"] });
    const first = await api.listRefunds(CY, { limit: 1 });
    expect(first.items.map((refund) => refund.reasonCode)).toEqual(["EXCESS"]);
    const second = await api.listRefunds(CY, { cursor: first.nextCursor ?? "", limit: 1 });
    expect(second.items.map((refund) => refund.reasonCode)).toEqual(["LATE_FIRST_PAYMENT"]);
    expect(second.nextCursor).toBeNull();
  });
});
