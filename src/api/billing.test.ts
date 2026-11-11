import { describe, expect, it, vi } from "vitest";
import {
  CheckoutRedirect,
  documentFileName,
  httpsOnly,
  isPdfType,
  readAllInvoices,
  readAllRefunds,
  toAutopayConsentResult,
  toCheckout,
  toCompanyDurations,
  toInvoice,
  toInvoiceDetail,
  toInvoicePage,
  toPlanChange,
  toDispute,
  toDisputePage,
  toRefund,
  toRefundPage,
  readAllDisputes,
  UnreadableAnswerError,
} from "./billing";

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
      // TAS-514: an online invoice carries no bank details, whatever the answer held.
      wireInstructions: null,
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

/* ------------------------------------------------------------------ TAS-514 */

const BANK = { beneficiaryName: "Taska Mock S.L. (test only)", iban: "XX00MOCK0000000000000000", bic: "MOCKESM0XXX", bankName: "Mock Bank", reference: "TASKA-TSK-2026-00904" };
const wire = (overrides: Record<string, unknown> = {}) => ({ ...wireInvoice, paymentMethod: "WIRE", wireInstructions: { ...BANK }, ...overrides });

describe("a wire invoice's bank details (TAS-514 §2, F4)", () => {
  it("are kept on a WIRE invoice in EUR, all five, verbatim — on the list's shape too", () => {
    expect(toInvoice(wire())?.wireInstructions).toEqual(BANK);
    // No trim, no case change, no IBAN check: the server's strings as they came.
    const odd = { ...BANK, iban: " xx00 mock 0000 ", reference: "ref  with  spaces " };
    expect(toInvoice(wire({ wireInstructions: odd }))?.wireInstructions).toEqual(odd);
    expect(toInvoicePage({ items: [wire()] }).items[0].wireInstructions).toEqual(BANK);
  });

  it("are all or none: one missing or empty, a PSP invoice, or another currency drops the set", () => {
    for (const field of Object.keys(BANK)) {
      expect(toInvoice(wire({ wireInstructions: { ...BANK, [field]: "" } }))?.wireInstructions, field).toBeNull();
      const { [field as keyof typeof BANK]: _dropped, ...rest } = BANK;
      expect(toInvoice(wire({ wireInstructions: rest }))?.wireInstructions, field).toBeNull();
    }
    expect(toInvoice(wire({ paymentMethod: "PSP" }))?.wireInstructions).toBeNull();
    expect(toInvoice(wire({ total: { amountMinor: "2000", currency: "USD", exponent: 2 } }))?.wireInstructions).toBeNull();
    expect(toInvoice(wire({ wireInstructions: "IBAN XX00" }))?.wireInstructions).toBeNull();
  });
});

describe("the whole invoice (TAS-514 §2)", () => {
  it("adds the snapshots as sent: buyer, seller, lines without a tax rate, the FX quote's facts", () => {
    const detail = toInvoiceDetail({
      ...wireInvoice,
      lines: [
        {
          description: "Business plan",
          quantity: 1,
          net: { amountMinor: "3581", currency: "USD", exponent: 2 },
          taxes: [{ label: "VAT", rate: "0.21", amount: { amountMinor: "752", currency: "USD", exponent: 2 } }],
          total: { amountMinor: "4333", currency: "USD", exponent: 2 },
        },
      ],
      fxQuote: { baseCurrency: "EUR", quoteCurrency: "USD", rate: "1.0832", source: "Mock FX desk", observedAt: "2026-10-27T08:06:00Z", expiresAt: "2026-10-27T09:06:00Z" },
    });
    expect(detail?.buyer).toEqual({
      kind: "BUSINESS",
      name: "Umbrella",
      email: "billing@example.com",
      address: { country: "ES", postalCode: "28001", city: "Madrid", line1: "1 Mock Street", line2: null },
      taxId: "ESX1234567X",
    });
    expect(detail?.seller).toEqual({ legalName: "Taska S.L.", registrationId: "B-1", taxId: null, address: { country: "ES", postalCode: "28001", city: "Madrid", line1: "2", line2: null } });
    expect(detail?.lines).toEqual([
      {
        description: "Business plan",
        quantity: 1,
        net: { amountMinor: "3581", currency: "USD", exponent: 2 },
        taxes: [{ label: "VAT", amount: { amountMinor: "752", currency: "USD", exponent: 2 } }],
        total: { amountMinor: "4333", currency: "USD", exponent: 2 },
      },
    ]);
    expect(JSON.stringify(detail?.lines)).not.toContain("0.21");
    expect(detail?.fxQuote).toEqual({ baseCurrency: "EUR", quoteCurrency: "USD", rate: "1.0832", source: "Mock FX desk", observedAt: "2026-10-27T08:06:00Z" });
  });

  it("an absent snapshot is null, an absent list of lines null, an empty one empty — nothing invented", () => {
    const { buyer: _b, seller: _s, lines: _l, fxQuote: _f, ...bare } = wireInvoice;
    expect(toInvoiceDetail(bare)).toMatchObject({ buyer: null, seller: null, lines: null, fxQuote: null });
    expect(toInvoiceDetail({ ...bare, lines: [] })?.lines).toEqual([]);
    expect(toInvoiceDetail({ ...bare, lines: [{ quantity: 0, taxes: "none" }] })?.lines).toEqual([{ description: null, quantity: null, net: null, taxes: [], total: null }]);
    expect(toInvoiceDetail({ number: "no id" })).toBeNull();
  });
});

const refundWire = {
  id: "rf-1",
  tenantId: "t-1",
  paymentId: "pay-1",
  kind: "UNALLOCATED_RETURN",
  state: "APPROVED",
  amount: { amountMinor: "500", currency: "EUR", exponent: 2 },
  requestedAt: "2026-11-10T09:00:00Z",
  version: "3",
  reasonCode: "EXCESS",
  sourceMethod: "WIRE",
  feeBearer: "TASKA",
  evidenceCompletedAt: "2026-11-10T09:00:00Z",
  businessCalendarId: "ES",
  calendarVersion: "1",
  slaPolicyVersion: "WIRE_RETURN_ES_V1",
  slaSnapshot: { businessDays: 5 },
  decisionDueAt: "2026-11-17T09:00:00Z",
  sendDueAt: "2026-11-17T09:00:00Z",
  decidedAt: "2026-11-11T09:00:00Z",
  submittedAt: "2026-11-12T09:00:00Z",
};

describe("a refund (TAS-514, decision 6)", () => {
  it("keeps sendDueAt, decidedAt and (TAS-516) submittedAt, and drops the payment, the version and every other operator field", () => {
    expect(toRefund(refundWire)).toEqual({
      id: "rf-1",
      tenantId: "t-1",
      kind: "UNALLOCATED_RETURN",
      state: "APPROVED",
      amount: { amountMinor: "500", currency: "EUR", exponent: 2 },
      reasonCode: "EXCESS",
      sourceMethod: "WIRE",
      requestedAt: "2026-11-10T09:00:00Z",
      confirmedAt: null,
      feeBearer: "TASKA",
      sendDueAt: "2026-11-17T09:00:00Z",
      decidedAt: "2026-11-11T09:00:00Z",
      submittedAt: "2026-11-12T09:00:00Z",
    });
    const serialised = JSON.stringify(toRefund(refundWire));
    for (const dropped of ["pay-1", "WIRE_RETURN_ES_V1", "businessDays", "evidenceCompletedAt", "decisionDueAt"]) expect(serialised).not.toContain(dropped);
  });

  it("TAS-516 (T3): submittedAt from its own field only — no other field filters it, on a bank transfer or online", () => {
    const { evidenceCompletedAt: _evidence, ...noEvidence } = refundWire;
    expect(toRefund(noEvidence)?.submittedAt).toBe("2026-11-12T09:00:00Z");
    expect(toRefund({ ...noEvidence, sourceMethod: "PSP" })?.submittedAt).toBe("2026-11-12T09:00:00Z");
    expect(toRefund({ ...refundWire, submittedAt: "not a date" })?.submittedAt).toBeNull();
    const { submittedAt: _submitted, ...unsent } = refundWire;
    expect(toRefund(unsent)?.submittedAt).toBeNull();
  });

  it("TAS-516 (guard F1): a 2xx that is not a page is no answer — never an empty list", () => {
    for (const body of [null, "x", [], {}, { items: null }, { items: "none" }, { nextCursor: "n" }]) {
      expect(() => toRefundPage(body), JSON.stringify(body)).toThrow(UnreadableAnswerError);
    }
    expect(toRefundPage({ items: [] })).toEqual({ items: [], nextCursor: null });
  });

  it("reads states and reasons as open strings, and a page in the server's order", async () => {
    expect(toRefund({ ...refundWire, state: "PARKED", reasonCode: "GOODWILL" })).toMatchObject({ state: "PARKED", reasonCode: "GOODWILL" });
    expect(toRefund({ state: "REQUESTED" })).toBeNull();
    expect(toRefundPage({ items: [refundWire, { id: "" }], nextCursor: "n" })).toEqual({ items: [toRefund(refundWire)], nextCursor: "n" });
    const list = vi.fn().mockResolvedValueOnce({ items: [toRefund(refundWire)], nextCursor: "p2" }).mockResolvedValueOnce({ items: [], nextCursor: null });
    expect(await readAllRefunds(list)).toHaveLength(1);
    expect(list).toHaveBeenNthCalledWith(2, { cursor: "p2", limit: 100 });
  });
});

describe("the company's durations (TAS-514 Q3)", () => {
  it("keeps the wire reconciliation target only as an integer 1..31 536 000 — never a default", () => {
    const of = (target: unknown) => toCompanyDurations({ tenantId: "t", durationsSeconds: { WIRE_RECONCILIATION_TARGET_SECONDS: target }, expiresAt: "2026-11-11T09:00:30Z", items: [{}] });
    expect(of(86400)).toEqual({ tenantId: "t", wireReconciliationTargetSeconds: 86400, expiresAt: "2026-11-11T09:00:30Z" });
    expect(of(1)?.wireReconciliationTargetSeconds).toBe(1);
    expect(of(31_536_000)?.wireReconciliationTargetSeconds).toBe(31_536_000);
    for (const bad of [0, -5, 31_536_001, 1.5, "86400", null]) expect(of(bad)?.wireReconciliationTargetSeconds, String(bad)).toBeNull();
    expect(toCompanyDurations({ tenantId: "t" })?.wireReconciliationTargetSeconds).toBeNull();
    expect(toCompanyDurations("ok")).toBeNull();
  });
});

describe("the document (TAS-514 §3, decision 5)", () => {
  it("is a PDF only by its type", () => {
    for (const type of ["application/pdf", "application/PDF", "application/pdf; charset=binary"]) expect(isPdfType(type), type).toBe(true);
    for (const type of [null, "", "text/html", "application/json", "application/pdfx", "application/octet-stream"]) expect(isPdfType(type), String(type)).toBe(false);
  });

  it("takes a file name from a readable Content-Disposition, sanitised to a base name ending .pdf — else none", () => {
    expect(documentFileName('attachment; filename="TSK-2026-00904.pdf"')).toBe("TSK-2026-00904.pdf");
    expect(documentFileName("attachment; filename*=UTF-8''Rechnung%20%C3%84.pdf; filename=\"fallback.pdf\"")).toBe("Rechnung Ä.pdf");
    expect(documentFileName('attachment; filename="../../etc/passwd.pdf"')).toBe("passwd.pdf");
    // A token, not a quoted string: its backslashes are a path's, not escapes.
    expect(documentFileName("attachment; filename=C:\\Users\\x\\a<b>.pdf")).toBe("ab.pdf");
    expect(documentFileName('attachment; filename=".hidden.pdf"')).toBe("hidden.pdf");
    for (const header of [null, "inline", 'attachment; filename="invoice.exe"', 'attachment; filename=".pdf"', `attachment; filename="${"a".repeat(130)}.pdf"`]) {
      expect(documentFileName(header), String(header)).toBeNull();
    }
  });
});

describe("a dispute (TAS-516, guard §3)", () => {
  const wire = {
    id: "dp-1",
    tenantId: "t-1",
    paymentId: "pay-1",
    state: "LOST",
    openedAt: "2026-11-01T09:00:00Z",
    resolvedAt: "2026-11-08T09:00:00Z",
    version: "4",
    finalOutcome: "LOST_PARTIAL_COVERAGE_REVOKED",
    confirmedMoneyFactId: "fact-1",
  };

  it("keeps its state, outcome and dates — and drops the payment, the money fact and the version", () => {
    expect(toDispute(wire)).toEqual({
      id: "dp-1",
      tenantId: "t-1",
      state: "LOST",
      finalOutcome: "LOST_PARTIAL_COVERAGE_REVOKED",
      openedAt: "2026-11-01T09:00:00Z",
      resolvedAt: "2026-11-08T09:00:00Z",
    });
    const serialised = JSON.stringify(toDispute(wire));
    for (const dropped of ["pay-1", "fact-1", "version"]) expect(serialised).not.toContain(dropped);
    expect(toDispute({ ...wire, id: "" })).toBeNull();
    expect(toDispute("dp-1")).toBeNull();
  });

  it("an outcome only with the terminal state it belongs to (the pair rule) — otherwise the state alone; both open strings", () => {
    const pair = (state: string, finalOutcome: string) => toDispute({ ...wire, state, finalOutcome })?.finalOutcome ?? null;
    expect(pair("WON", "WON")).toBe("WON");
    expect(pair("WITHDRAWN", "WITHDRAWN_CONFIRMED")).toBe("WITHDRAWN_CONFIRMED");
    expect(pair("LOST", "LOST_FULL_REFUND")).toBe("LOST_FULL_REFUND");
    expect(pair("LOST", "LOST_SOMETHING_NEW")).toBe("LOST_SOMETHING_NEW");
    for (const [state, outcome] of [
      ["WON", "WITHDRAWN_CONFIRMED"],
      ["WITHDRAWN", "WON"],
      ["LOST", "WON"],
      ["WON", "LOST_FULL_REFUND"],
      ["OPEN", "WON"],
      ["NEEDS_REVIEW", "LOST_FULL_REFUND"],
      ["ARBITRATION", "WON"],
    ]) {
      expect(pair(state, outcome), `${state} + ${outcome}`).toBeNull();
    }
    expect(toDispute({ ...wire, state: "ARBITRATION" })?.state).toBe("ARBITRATION");
  });

  it("a page in the server's order; a body with no items array is no answer (F1); all pages are read", async () => {
    expect(toDisputePage({ items: [wire, { id: "" }, null], nextCursor: "n" })).toEqual({ items: [toDispute(wire)], nextCursor: "n" });
    for (const body of [null, [], {}, { items: {} }, "items"]) expect(() => toDisputePage(body), JSON.stringify(body)).toThrow(UnreadableAnswerError);
    const list = vi.fn().mockResolvedValueOnce({ items: [toDispute(wire)], nextCursor: "p2" }).mockResolvedValueOnce({ items: [], nextCursor: null });
    expect(await readAllDisputes(list)).toHaveLength(1);
    expect(list).toHaveBeenNthCalledWith(2, { cursor: "p2", limit: 100 });
  });
});
