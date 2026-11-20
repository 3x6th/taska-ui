import { describe, expect, it } from "vitest";
import type { Checkout, Invoice } from "../../api/billing";
import {
  closesAttempt,
  formatInvoiceMoney,
  inProgressState,
  invoiceMetaText,
  isPayable,
  listedInvoices,
  payRefusalWords,
  primaryPayable,
  statusWord,
  watchedPaymentState,
} from "./billingText";

/*
 * TAS-513's words and states (art-director B3, B4, B7–B9, the orchestrator's
 * decisions 1, 2, 7, 8): paid only from the invoice, a SUCCEEDED before it is
 * «Confirming», UNKNOWN offers no Pay, a cancel is «You left the payment page.»
 * with «Return to payment», Pay only on an OPEN online invoice with nothing
 * paid on it.
 */

const EUR = (amountMinor: string) => ({ amountMinor, currency: "EUR", exponent: 2 });
const invoice = (overrides: Partial<Invoice> = {}): Invoice => ({
  id: "inv-1",
  tenantId: "t",
  number: "TSK-2026-01008",
  purpose: "RENEWAL",
  state: "OPEN",
  planVersionId: "p",
  total: EUR("2000"),
  allocated: EUR("0"),
  remaining: EUR("2000"),
  matchedUnallocated: EUR("0"),
  issuedAt: "2026-11-10T09:00:00Z",
  dueAt: "2026-12-04T09:00:00Z",
  paymentMethod: "PSP",
  version: "1",
  replacesInvoiceId: null,
  ...overrides,
});
const checkout = (state: string): Checkout => ({ id: "co", invoiceId: "inv-1", state, expiresAt: null, redirect: null });
const watched = (input: { invoice?: Invoice | null; checkout?: Checkout | null; left?: boolean; stage?: "fresh" | "slow" | "stopped"; reopened?: boolean }) =>
  watchedPaymentState({
    invoice: input.invoice === undefined ? invoice() : input.invoice,
    checkout: input.checkout === undefined ? null : input.checkout,
    left: input.left ?? false,
    stage: input.stage ?? "fresh",
    company: "Umbrella",
    reopened: input.reopened ?? false,
  });

describe("the money and the row (B3)", () => {
  it("prints the exponent's fraction digits, from the string", () => {
    expect(formatInvoiceMoney(EUR("2000"))).toBe("€20.00");
    expect(formatInvoiceMoney(EUR("5"))).toBe("€0.05");
    expect(formatInvoiceMoney({ amountMinor: "120000", currency: "USD", exponent: 2 })).toBe("$1,200.00");
    expect(formatInvoiceMoney({ amountMinor: "1500", currency: "JPY", exponent: 0 })).toBe("¥1,500");
  });

  it("the meta line: purpose and due date, a wire invoice says so, no period", () => {
    const now = new Date("2026-11-11T09:00:00Z");
    expect(invoiceMetaText(invoice(), now)).toBe("Renewal · Due Dec 4");
    expect(invoiceMetaText(invoice({ purpose: "INITIAL", paymentMethod: "WIRE", dueAt: "2027-01-02T09:00:00Z" }), now)).toBe("First payment · Due Jan 2, 2027 · Bank transfer");
    expect(invoiceMetaText(invoice({ purpose: "TOP_UP", dueAt: null }), now)).toBe("TOP_UP");
  });

  it("lists every invoice but DRAFT, newest first, and the earliest due payable one is the primary Pay", () => {
    const rows = listedInvoices([
      invoice({ id: "a", issuedAt: "2026-10-01T00:00:00Z", dueAt: "2026-12-30T00:00:00Z" }),
      invoice({ id: "b", issuedAt: "2026-11-01T00:00:00Z", dueAt: "2026-12-01T00:00:00Z" }),
      invoice({ id: "c", state: "DRAFT" }),
      invoice({ id: "d", state: "VOID", issuedAt: "2026-09-01T00:00:00Z" }),
    ]);
    expect(rows.map((row) => row.id)).toEqual(["b", "a", "d"]);
    expect(primaryPayable(rows, isPayable)).toBe("b");
  });

  it("the marker's words, and confirming over them; never «overdue»", () => {
    expect(["OPEN", "PARTIALLY_PAID", "PAID", "EXPIRED", "VOID", "DISPUTED"].map((state) => statusWord(state))).toEqual([
      "unpaid",
      "part paid",
      "paid",
      "expired",
      "void",
      "DISPUTED",
    ]);
    expect(statusWord("OPEN", true)).toBe("confirming");
    expect(statusWord("DRAFT")).toBeNull();
    // The server's ended state wins over any local record (release-reviewer B1).
    expect(["PAID", "EXPIRED", "VOID"].map((state) => statusWord(state, true))).toEqual(["paid", "expired", "void"]);
  });
});

describe("Pay is offered (decision 1)", () => {
  it("only on an OPEN online invoice with all of it still to pay", () => {
    expect(isPayable(invoice())).toBe(true);
    expect(isPayable(invoice({ state: "PARTIALLY_PAID" }))).toBe(false);
    expect(isPayable(invoice({ remaining: EUR("800") }))).toBe(false);
    expect(isPayable(invoice({ paymentMethod: "WIRE" }))).toBe(false);
    expect(isPayable(invoice({ state: "PAID" }))).toBe(false);
    expect(isPayable(invoice({ total: null }))).toBe(false);
  });
});

describe("the payment's state (B7)", () => {
  it("is «Paid.» only from the invoice — a SUCCEEDED checkout before it is «Confirming», no Pay", () => {
    expect(watched({ checkout: checkout("SUCCEEDED") })).toMatchObject({ kind: "confirming", fact: "Confirming the payment.", action: null });
    expect(watched({ invoice: invoice({ state: "PAID" }), checkout: checkout("PENDING") })).toMatchObject({
      kind: "paid",
      fact: "Paid.",
      explanation: "Invoice TSK-2026-01008 is paid in full.",
    });
    expect(watched({ invoice: invoice({ state: "PAID" }), reopened: true }).explanation).toBe(
      "Invoice TSK-2026-01008 is paid in full. Umbrella is open for changes again.",
    );
  });

  it("before the checkout answers, and while it is open, «Confirming»; its copy changes at 30 s and «Check again» at 5 min", () => {
    expect(watched({ invoice: null, checkout: null })).toMatchObject({ kind: "confirming", action: null });
    expect(watched({ checkout: checkout("PENDING") }).explanation).toBe(
      "Taska is checking it with the payment provider. This page updates on its own — don’t pay again.",
    );
    expect(watched({ checkout: checkout("PENDING"), stage: "slow" })).toMatchObject({
      explanation: "This is taking a while. You can leave this page — the invoice will show the result. Don’t pay again.",
      action: "return",
    });
    expect(watched({ checkout: checkout("SUCCEEDED"), stage: "slow" }).action).toBeNull();
    // Five minutes on an open checkout: its page and «Check again» after it; on a SUCCEEDED one, «Check again» only (N9).
    expect(watched({ checkout: checkout("PENDING"), stage: "stopped" })).toMatchObject({
      explanation: "Taska hasn’t heard back yet. Check again in a few minutes. Don’t pay again.",
      action: "return",
      alsoCheck: true,
    });
    expect(watched({ checkout: checkout("SUCCEEDED"), stage: "stopped" })).toMatchObject({ action: "check" });
    expect(watched({ checkout: checkout("SUCCEEDED"), stage: "stopped" }).alsoCheck).toBeUndefined();
    expect(watched({ checkout: checkout("UNKNOWN"), stage: "stopped" })).toMatchObject({ action: null });
  });

  it("a way back through the cancel address is «You left the payment page.» with «Return to payment» — never a new checkout", () => {
    expect(watched({ checkout: checkout("PENDING"), left: true })).toEqual({
      kind: "left",
      fact: "You left the payment page.",
      explanation: "The invoice is still unpaid.",
      action: "return",
    });
    // Before the checkout has answered it is «Confirming», left or not (release-reviewer R1).
    expect(watched({ checkout: null, left: true })).toMatchObject({ kind: "confirming", action: null });
    expect(watched({ checkout: checkout("PENDING"), left: true, stage: "stopped" })).toMatchObject({ kind: "left", action: "return", alsoCheck: true });
    // The hint never overrides the server: a success or a payment wins.
    expect(watched({ checkout: checkout("SUCCEEDED"), left: true }).kind).toBe("confirming");
    expect(watched({ invoice: invoice({ state: "PAID" }), checkout: checkout("PENDING"), left: true }).kind).toBe("paid");
  });

  it("UNKNOWN offers no Pay; FAILED and EXPIRED offer it again; an unknown state offers nothing", () => {
    expect(watched({ checkout: checkout("UNKNOWN") })).toMatchObject({ kind: "unknown", fact: "We’re confirming this payment with the bank.", action: null });
    expect(watched({ checkout: checkout("FAILED") })).toMatchObject({ kind: "failed", fact: "The payment didn’t go through.", action: "pay" });
    expect(watched({ checkout: checkout("EXPIRED") })).toMatchObject({ kind: "expired", fact: "The payment page expired.", action: "pay" });
    expect(watched({ checkout: checkout("REFUNDED") })).toMatchObject({ kind: "unreadable", action: null });
  });

  it("«already in progress» names the time only when the record has it (decision 7)", () => {
    expect(inProgressState(null).explanation).toBe("Finish it where you started it, or wait for it to expire. Don’t pay again.");
    expect(inProgressState("2026-11-11T10:30:00Z", new Date("2026-11-11T09:00:00Z")).explanation).toMatch(
      /^Finish it where you started it, or wait until Nov 11, \d\d:30, when it expires\. Don’t pay again\.$/,
    );
  });
});

describe("the refusals of Pay (B8, decision 8)", () => {
  const refusal = (status: number | null, code: string, reasons: string[] = []) =>
    Object.assign(new Error("the server's words"), { status, code, requestId: "rid", details: null, reasons });

  it("checkout off: not configured for this company, without «Try again later»; the provider down, with it", () => {
    expect(payRefusalWords(refusal(503, "POLICY_NOT_CONFIGURED"), "Umbrella")?.text).toBe(
      "Online payment isn’t available for this company yet, so the payment page wasn’t opened and nothing was charged.",
    );
    expect(payRefusalWords(refusal(503, "DEPENDENCY_UNAVAILABLE"), "Umbrella")?.text).toBe(
      "Online payment isn’t available right now, so the payment page wasn’t opened and nothing was charged. Try again later.",
    );
    expect(payRefusalWords(refusal(403, "CAPABILITY_DISABLED"), "Umbrella")?.text).toBe(
      "Online payment isn’t available right now, so the payment page wasn’t opened and nothing was charged. Try again later.",
    );
    expect(payRefusalWords(refusal(403, "CAPABILITY_DISABLED", ["PAYMENT_DISPUTE"]), "Umbrella")?.text).toBe(
      "A payment for Umbrella is disputed, so this invoice can’t be paid right now.",
    );
  });

  it("the read-only, owner, rate, lost-answer and other rows; INVALID_STATE is answered by a re-read, not a sentence", () => {
    expect(payRefusalWords(refusal(403, "READ_ONLY", ["PLATFORM_BLOCK"]), "Hooli")?.text).toBe("Taska has blocked Hooli, so this invoice can’t be paid right now.");
    expect(payRefusalWords(refusal(403, "OWNER_REQUIRED"), "Umbrella")?.text).toBe("Only the owner of Umbrella can pay its invoices.");
    expect(payRefusalWords(Object.assign(refusal(429, "RATE_LIMITED"), { retryAfterSeconds: 30 }), "Umbrella")?.text).toBe("Too many attempts. Try again in 30 seconds.");
    expect(payRefusalWords(refusal(null, "TRANSPORT"), "Umbrella")).toEqual({
      text: "Taska couldn’t open the payment page. Press Pay again — it won’t create a second payment.",
      words: "the server's words",
    });
    expect(payRefusalWords(refusal(409, "INVALID_STATE"), "Umbrella")).toBeNull();
    expect(payRefusalWords(refusal(503, "POLICY_NOT_CONFIGURED"), "Stark", { creationDeadline: "2099-12-04T14:32:00Z", now: new Date("2099-11-01T00:00:00Z") })?.text).toMatch(
      / The company stays reserved until Dec 4, \d\d:32\.$/,
    );
  });

  it("closes the attempt on the definitive refusals — the next Pay is a fresh key — and keeps it when nothing was said (N4)", () => {
    const closing = ["OWNER_REQUIRED", "CAPABILITY_DISABLED", "READ_ONLY", "INVALID_STATE", "IDEMPOTENCY_CONFLICT", "POLICY_NOT_CONFIGURED"];
    expect(closing.map((code) => closesAttempt(refusal(403, code)))).toEqual(closing.map(() => true));
    expect(closesAttempt(refusal(503, "DEPENDENCY_UNAVAILABLE"))).toBe(false);
    expect(closesAttempt(refusal(429, "RATE_LIMITED"))).toBe(false);
    expect(closesAttempt(refusal(500, "INTERNAL"))).toBe(false);
    expect(closesAttempt(refusal(408, "TIMEOUT"))).toBe(false);
    expect(closesAttempt(refusal(null, "TRANSPORT"))).toBe(false);
  });
});
