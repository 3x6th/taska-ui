import { describe, expect, it, vi } from "vitest";
import { CheckoutRedirect, httpsOnly, readAllInvoices, toAutopayConsentResult, toCheckout, toInvoice, toInvoicePage, toPlanChange } from "./billing";

/*
 * TAS-513's narrowing (api-contract-guard §1): an invoice keeps no buyer,
 * seller, lines or wire details; a checkout keeps its page address only inside
 * the opaque `CheckoutRedirect`, which never serialises it.
 */

const SECRET = "https://checkout.psp.example/c/pay/cs_live_a1b2c3#fidkdWxOYHwnPyd1blpxYHZxWjA0";

const wireInvoice = {
  id: "inv-1",
  tenantId: "t-1",
  number: "TSK-2026-01008",
  purpose: "RENEWAL",
  state: "OPEN",
  planVersionId: "plan-team",
  buyer: { kind: "BUSINESS", name: "Umbrella", email: "billing@example.com", address: { country: "ES", postalCode: "28001", city: "Madrid", line1: "1 Mock Street" }, taxId: "ESX1234567X" },
  seller: { legalName: "Taska S.L.", registrationId: "B-1", address: { country: "ES", postalCode: "28001", city: "Madrid", line1: "2" } },
  lines: [{ description: "Team plan", quantity: 1, net: { amountMinor: "2000", currency: "EUR", exponent: 2 }, taxes: [], total: { amountMinor: "2000", currency: "EUR", exponent: 2 } }],
  total: { amountMinor: "2000", currency: "EUR", exponent: 2 },
  allocated: { amountMinor: "0", currency: "EUR", exponent: 2 },
  remaining: { amountMinor: "2000", currency: "EUR", exponent: 2 },
  issuedAt: "2026-11-10T09:00:00Z",
  dueAt: "2027-01-02T09:00:00Z",
  fxQuote: { rate: "1.08" },
  paymentMethod: "PSP",
  wireInstructions: { beneficiaryName: "Taska", iban: "ES9121000418450200051332", bic: "CAIXESBBXXX", bankName: "Bank", reference: "TSK" },
  version: "1",
  matchedUnallocated: { amountMinor: "0", currency: "EUR", exponent: 2 },
};

describe("an invoice (§1)", () => {
  it("reads what the screens draw and none of the buyer, seller, lines, FX quote or wire instructions", () => {
    const invoice = toInvoice(wireInvoice);
    expect(invoice).toEqual({
      id: "inv-1",
      tenantId: "t-1",
      number: "TSK-2026-01008",
      purpose: "RENEWAL",
      state: "OPEN",
      planVersionId: "plan-team",
      total: { amountMinor: "2000", currency: "EUR", exponent: 2 },
      allocated: { amountMinor: "0", currency: "EUR", exponent: 2 },
      remaining: { amountMinor: "2000", currency: "EUR", exponent: 2 },
      matchedUnallocated: { amountMinor: "0", currency: "EUR", exponent: 2 },
      issuedAt: "2026-11-10T09:00:00Z",
      dueAt: "2027-01-02T09:00:00Z",
      paymentMethod: "PSP",
      version: "1",
      replacesInvoiceId: null,
    });
    const serialised = JSON.stringify(invoice);
    for (const unread of ["billing@example.com", "ES9121000418450200051332", "Team plan", "Taska S.L.", "1.08", "ESX1234567X"]) {
      expect(serialised).not.toContain(unread);
    }
  });

  it("keeps an unknown state, purpose or method as its string, and drops what is not readable", () => {
    const invoice = toInvoice({ ...wireInvoice, state: "SCHEDULED", purpose: "TOP_UP", paymentMethod: "SEPA", total: { amountMinor: 20 }, dueAt: "soon", version: "v1" });
    expect(invoice).toMatchObject({ state: "SCHEDULED", purpose: "TOP_UP", paymentMethod: "SEPA", total: null, dueAt: null, version: null });
    expect(toInvoice({ number: "no id" })).toBeNull();
    expect(toInvoicePage({ items: [wireInvoice, { id: "" }], nextCursor: "n" })).toEqual({ items: [toInvoice(wireInvoice)], nextCursor: "n" });
  });

  it("every page is read, and a repeated cursor ends the loop", async () => {
    const one = toInvoice(wireInvoice)!;
    const list = vi
      .fn()
      .mockResolvedValueOnce({ items: [one], nextCursor: "p2" })
      .mockResolvedValueOnce({ items: [{ ...one, id: "inv-2" }], nextCursor: "p2" });
    expect((await readAllInvoices(list)).map((invoice) => invoice.id)).toEqual(["inv-1", "inv-2"]);
    expect(list).toHaveBeenNthCalledWith(1, { limit: 100 });
    expect(list).toHaveBeenNthCalledWith(2, { cursor: "p2", limit: 100 });
  });
});

describe("a checkout's page address (§1, art-director B4)", () => {
  it("lives only in CheckoutRedirect, which never serialises, renders or logs it", () => {
    const checkout = toCheckout({ id: "co-1", invoiceId: "inv-1", state: "CREATED", redirectUrl: SECRET, expiresAt: "2026-11-11T10:30:00Z" });
    expect(checkout?.redirect).toBeInstanceOf(CheckoutRedirect);
    const redirect = checkout!.redirect!;
    expect(String(redirect)).toBe("[redacted]");
    expect(`${redirect}`).toBe("[redacted]");
    expect(JSON.stringify(checkout)).not.toContain("cs_live");
    expect(JSON.stringify(checkout)).toContain('"redirect":"[redacted]"');
    expect(Object.keys(redirect)).toEqual([]);
    expect(Object.values(redirect)).toEqual([]);
    expect(JSON.stringify(structuredCloneSafe(redirect))).not.toContain("cs_live");
    const assign = vi.fn();
    redirect.go({ assign });
    expect(assign).toHaveBeenCalledWith(SECRET);
  });

  it("is kept only when the build's policy accepts it — https by default, never a plain or script address", () => {
    expect(httpsOnly(new URL(SECRET))).toBe(true);
    for (const address of ["http://checkout.psp.example/pay", "javascript:alert(1)", "/mock-checkout/x", "data:text/html,hi", "not a url"]) {
      expect(toCheckout({ id: "co", invoiceId: "inv", state: "CREATED", redirectUrl: address })?.redirect, address).toBeNull();
    }
    const local = toCheckout({ id: "co", state: "CREATED", redirectUrl: "http://localhost:5185/mock-checkout/mcs_1" }, (url) => url.origin === "http://localhost:5185");
    expect(local?.redirect).not.toBeNull();
    expect(toCheckout({ id: "co", state: "CREATED", redirectUrl: `https://x.example/${"a".repeat(2050)}` })?.redirect).toBeNull();
  });

  it("reads every field optional and the state as an open string", () => {
    expect(toCheckout({ id: "co", invoiceId: "inv", state: "CANCELLED", expiresAt: "later" })).toEqual({
      id: "co",
      invoiceId: "inv",
      state: "CANCELLED",
      expiresAt: null,
      redirect: null,
    });
    expect(toCheckout({ state: "PENDING" })).toBeNull();
  });
});

/** A plain-object copy of what an enumerable walk can see — what a logger or a store would get. */
function structuredCloneSafe(value: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value));
}

describe("a plan change and a mandate (TAS-515, §1)", () => {
  it("PlanChange: every field optional, the effect open, the subscription narrowed — and no body that is not an object", () => {
    expect(
      toPlanChange({
        subscription: { tenantId: "t", planVersionId: "p", version: "9", renewalCancelled: false, autopayState: "DISABLED" },
        effect: "NEXT_PERIOD",
        invoiceId: "inv-1",
        effectiveAt: "2026-12-20T09:00:00Z",
        operationId: "op-1",
      }),
    ).toMatchObject({ effect: "NEXT_PERIOD", invoiceId: "inv-1", effectiveAt: "2026-12-20T09:00:00Z", operationId: "op-1", subscription: { tenantId: "t", version: "9" } });
    expect(toPlanChange({ effect: "LATER_SOMETIME", effectiveAt: "not a date" })).toEqual({
      subscription: null,
      effect: "LATER_SOMETIME",
      invoiceId: null,
      effectiveAt: null,
      operationId: null,
    });
    for (const body of [null, "accepted", 42, []]) expect(toPlanChange(body), String(body)).toBeNull();
  });

  it("AutopayMandate is kept as its state only: no version, owner or snapshot", () => {
    expect(toAutopayConsentResult({ id: "m", ownerId: "o", state: "DISABLED", version: "41", consentSnapshot: {} })).toEqual({ state: "DISABLED" });
    expect(toAutopayConsentResult({})).toEqual({ state: null });
    expect(toAutopayConsentResult("ok")).toBeNull();
  });
});
