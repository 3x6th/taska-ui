import { describe, expect, it } from "vitest";
import type { Invoice, InvoiceLine, Refund } from "../../api/billing";
import { UnreadableAnswerError } from "../../api/billing";
import { ApiError } from "../../api/rest/RestTaskaApi";
import {
  amountRestNote,
  buyerLines,
  cardWireLine,
  copyFailedText,
  countryName,
  documentName,
  downloadRefusalWords,
  formatDuration,
  fxQuoteText,
  ibanGroups,
  lateFirstPaymentLine,
  lineMetaText,
  listedRefunds,
  needsTotalRow,
  purposeSentence,
  reconciliationSentences,
  referenceNote,
  refundMarker,
  refundMetaText,
  refundReasonText,
  sellerLines,
  showsBankDetails,
  toBeRefundedText,
  wireMatchedState,
  wireState,
} from "./wireText";

/*
 * TAS-514's words (art-director B3–B11, B14 with the orchestrator's decisions):
 * a wire invoice's state from the invoice and the clock's wording only, the
 * target only from the server, refunds never «sent» and never tied to an
 * invoice, the document's refusals as the table says them.
 */

const EUR = (amountMinor: string) => ({ amountMinor, currency: "EUR", exponent: 2 });
const BANK = { beneficiaryName: "Taska Mock S.L. (test only)", iban: "XX00MOCK0000000000000000", bic: "MOCKESM0XXX", bankName: "Mock Bank", reference: "TASKA-TSK-2026-00904" };
const BEFORE = new Date("2026-11-20T09:00:00Z");
const AFTER = new Date("2026-12-10T09:00:00Z");
const DATE_TIME = "[A-Z][a-z]{2} \\d{1,2}, \\d\\d:\\d\\d";

const wire = (overrides: Partial<Invoice> = {}): Invoice => ({
  id: "inv",
  tenantId: "t",
  number: "TSK-2026-00904",
  purpose: "RENEWAL",
  state: "OPEN",
  planVersionId: "p",
  total: EUR("2000"),
  allocated: EUR("0"),
  remaining: EUR("2000"),
  matchedUnallocated: EUR("0"),
  issuedAt: "2026-11-10T09:00:00Z",
  dueAt: "2026-12-04T09:00:00Z",
  paymentMethod: "WIRE",
  version: "1",
  replacesInvoiceId: null,
  wireInstructions: BANK,
  ...overrides,
});
const partial = (overrides: Partial<Invoice> = {}) => wire({ state: "PARTIALLY_PAID", matchedUnallocated: EUR("1200"), remaining: EUR("800"), ...overrides });

describe("the wire state (B3, decision 3)", () => {
  it("open, nothing matched, before its due date: waiting — nothing more to do", () => {
    expect(wireState(wire(), { now: BEFORE })).toMatchObject({
      kind: "wire",
      fact: "Waiting for the bank transfer.",
      explanation: "If you’ve already sent it, there’s nothing more to do — this invoice shows it once Taska has matched it.",
      action: null,
    });
  });

  it("part arrived before its due date: the rest, and the rule that what arrived is refunded otherwise", () => {
    const state = wireState(partial(), { now: BEFORE });
    expect(state?.fact).toBe("Part of the bank transfer has arrived.");
    expect(state?.explanation).toMatch(new RegExp(`^The invoice is paid once all of it has\\. If the rest doesn’t arrive by ${DATE_TIME}, the €12\\.00 that arrived is refunded\\.$`));
  });

  it("past its due date by the local clock — wording only: it may still count; the purpose's rule once", () => {
    const open = wireState(wire(), { now: AFTER, sentence3: "If it arrives after Dec 4, it still renews Cyberdyne." });
    expect(open?.fact).toBe("Its due date has passed.");
    expect(open?.explanation).toMatch(new RegExp(`^If the money arrived by ${DATE_TIME}, it still counts once Taska matches it\\. If it arrives after Dec 4, it still renews Cyberdyne\\.$`));
    const part = wireState(partial(), { now: AFTER });
    expect(part?.explanation).toMatch(new RegExp(`^If the rest arrived by ${DATE_TIME}, it still counts once Taska matches it\\. If it didn’t, the €12\\.00 that arrived is refunded\\.$`));
  });

  it("no bank details: don't send money; all of it matched: confirming — and nothing for a PSP, PAID, EXPIRED or VOID one", () => {
    expect(wireState(wire({ wireInstructions: null }), { now: BEFORE })).toMatchObject({
      fact: "Bank details for this invoice aren’t available yet.",
      explanation: "Don’t send money for it until they appear here.",
    });
    expect(wireState(wire({ matchedUnallocated: EUR("2000"), remaining: EUR("0") }), { now: BEFORE })).toMatchObject({
      fact: "All of the bank transfer has arrived.",
      explanation: "Taska hasn’t applied it to this invoice yet, so the invoice isn’t marked as paid — don’t send the transfer again.",
      action: null,
    });
    for (const invoice of [wire({ paymentMethod: "PSP" }), wire({ state: "PAID" }), wire({ state: "EXPIRED" }), wire({ state: "VOID" })]) {
      expect(wireState(invoice, { now: BEFORE })).toBeNull();
    }
  });

  it("bank details only on an open wire invoice with something left and all five details — past its due date too (Q7)", () => {
    expect(showsBankDetails(wire())).toBe(true);
    expect(showsBankDetails(partial())).toBe(true);
    for (const invoice of [wire({ state: "EXPIRED" }), wire({ state: "PAID" }), wire({ state: "VOID" }), wire({ wireInstructions: null }), wire({ remaining: EUR("0") }), wire({ paymentMethod: "PSP" })]) {
      expect(showsBankDetails(invoice)).toBe(false);
    }
  });

  it("the money of an expired invoice is to be refunded — «is to be», not «is being»", () => {
    expect(toBeRefundedText(EUR("1200"))).toBe("The €12.00 that arrived for it is to be refunded.");
  });
});

describe("the Bank transfer group (B4)", () => {
  it("the IBAN in groups of four for reading; the amount's second line; the reference's rule", () => {
    expect(ibanGroups("XX00MOCK0000000000000000")).toEqual(["XX00", "MOCK", "0000", "0000", "0000", "0000"]);
    expect(ibanGroups("XX00 MOCK 0000 0")).toEqual(["XX00", "MOCK", "0000", "0"]);
    expect(amountRestNote(EUR("2000"), EUR("1200"))).toBe("The rest of €20.00 — €12.00 has already arrived.");
    expect(referenceNote("TASKA-TSK-2026-00904", "TSK-2026-00904")).toBe(
      "Enter it exactly as shown in the transfer’s reference field — it’s how Taska knows the money is for this invoice. Use this, not the invoice number.",
    );
    expect(referenceNote("TSK-2026-00904", "TSK-2026-00904")).not.toContain("Use this");
  });

  it("a refused copy selects the value and says how to copy it — by touch on a coarse pointer (B5)", () => {
    expect(copyFailedText("iban", false)).toBe("Couldn’t copy the IBAN automatically. It’s selected — press Ctrl+C or ⌘C to copy it.");
    expect(copyFailedText("beneficiary", true)).toBe("Couldn’t copy the beneficiary name automatically. It’s selected — touch and hold it to copy it.");
  });
});

describe("the reconciliation target (B6, decision 4)", () => {
  it("in words, as the server sent it — never a day, never rounded", () => {
    expect(formatDuration(86400)).toBe("24 hours");
    expect(formatDuration(3600)).toBe("1 hour");
    expect(formatDuration(5400)).toBe("1 hour 30 minutes");
    expect(formatDuration(1800)).toBe("30 minutes");
    expect(formatDuration(86399)).toBe("23 hours 59 minutes 59 seconds");
  });

  it("with the target, its sentence; without it, the same sentence with no number", () => {
    expect(reconciliationSentences(86400)[0]).toBe(
      "Taska matches bank transfers to invoices by hand, and aims to do it within 24 hours of the money arriving. Until then this invoice shows as unpaid — don’t send it again.",
    );
    expect(reconciliationSentences(null)[0]).toBe(
      "Taska matches bank transfers to invoices by hand once the money arrives. Until then this invoice shows as unpaid — don’t send it again.",
    );
    expect(reconciliationSentences(null)[0]).not.toMatch(/\d/);
    expect(reconciliationSentences(null)[1]).toBe("For the due date, what counts is when the money arrives, not when Taska matches it.");
  });

  it("the third sentence by purpose: a renewal renews — not while blocked; a first payment while waiting; a plan change none", () => {
    const base = { company: "Cyberdyne Systems", restrictions: [] as string[], lifecycle: "ACTIVE", creationDeadline: null, now: BEFORE };
    expect(purposeSentence({ ...base, invoice: wire() })).toMatch(
      new RegExp(`^If it arrives after ${DATE_TIME}, it still renews Cyberdyne Systems, but the new month starts when Taska matches it\\.$`),
    );
    expect(purposeSentence({ ...base, restrictions: ["PLATFORM_BLOCK"], invoice: wire() })).toBeNull();
    expect(purposeSentence({ ...base, invoice: wire({ purpose: "PLAN_CHANGE" }) })).toBeNull();
    expect(purposeSentence({ ...base, invoice: wire({ purpose: "INITIAL" }) })).toBeNull();
  });

  it("a first payment (fix round decision 3): a new invoice and the deadline only when the deadline is later than the due date — as instants", () => {
    const awaiting = { company: "Cyberdyne Systems", restrictions: [] as string[], lifecycle: "AWAITING_PAYMENT", now: BEFORE, invoice: wire({ purpose: "INITIAL" }) };
    expect(purposeSentence({ ...awaiting, creationDeadline: "2026-12-11T09:00:00Z" })).toMatch(
      new RegExp(`^If it arrives after ${DATE_TIME}, it’s refunded and Taska issues a new invoice\\. Cyberdyne Systems still closes if it isn’t paid by ${DATE_TIME}\\.$`),
    );
    // The same instant written another way is not later; an earlier deadline or none promises no new invoice.
    for (const deadline of ["2026-12-04T09:00:00.000Z", "2026-12-04T10:00:00+01:00", "2026-12-01T09:00:00Z", null]) {
      expect(purposeSentence({ ...awaiting, creationDeadline: deadline }), String(deadline)).toMatch(new RegExp(`^If it arrives after ${DATE_TIME}, it’s refunded\\.$`));
    }
    expect(purposeSentence({ ...awaiting, company: null, creationDeadline: "2026-12-11T09:00:00Z" })).toContain("This company still closes");
  });

  it("only while nothing has arrived (fix round decision 2): no third sentence once money is matched — a renewal, before and after its due date", () => {
    const renewal = { company: "Cyberdyne Systems", restrictions: [] as string[], lifecycle: "ACTIVE", creationDeadline: null };
    for (const now of [BEFORE, AFTER]) {
      expect(purposeSentence({ ...renewal, now, invoice: partial() }), now.toISOString()).toBeNull();
      expect(purposeSentence({ ...renewal, now, invoice: wire({ matchedUnallocated: EUR("1200"), remaining: EUR("800") }) })).toBeNull();
      expect(purposeSentence({ ...renewal, now, invoice: wire({ state: "PARTIALLY_PAID", matchedUnallocated: null }) })).toBeNull();
      expect(purposeSentence({ ...renewal, now, invoice: wire() })).not.toBeNull();
    }
  });

  it("only while nothing has arrived (fix round decision 2): no third sentence once money is matched — a first payment, before and after its due date", () => {
    const first = { company: "Cyberdyne Systems", restrictions: [] as string[], lifecycle: "AWAITING_PAYMENT", creationDeadline: "2026-12-11T09:00:00Z" };
    for (const now of [BEFORE, AFTER]) {
      expect(purposeSentence({ ...first, now, invoice: partial({ purpose: "INITIAL" }) }), now.toISOString()).toBeNull();
      expect(purposeSentence({ ...first, now, invoice: wire({ purpose: "INITIAL", matchedUnallocated: EUR("500"), remaining: EUR("1500") }) })).toBeNull();
      expect(purposeSentence({ ...first, now, invoice: wire({ purpose: "INITIAL" }) })).not.toBeNull();
    }
  });
});

describe("items and the snapshot (B8, B9)", () => {
  const line = (overrides: Partial<InvoiceLine> = {}): InvoiceLine => ({ description: "Team plan", quantity: 1, net: EUR("2000"), taxes: [], total: EUR("2000"), ...overrides });

  it("a line's second line: quantity above one, net only when taxed, each tax by its label — no rate", () => {
    expect(lineMetaText(line())).toBe("");
    expect(lineMetaText(line({ quantity: 5 }))).toBe("Quantity 5");
    expect(lineMetaText(line({ net: EUR("1653"), taxes: [{ label: "VAT", amount: EUR("347") }] }))).toBe("Net €16.53 · VAT €3.47");
    expect(needsTotalRow([line()])).toBe(false);
    expect(needsTotalRow([line(), line()])).toBe(true);
    expect(needsTotalRow([line({ taxes: [{ label: "VAT", amount: EUR("1") }] })])).toBe(true);
  });

  it("the FX quote verbatim, and nothing when its rate or currencies are missing", () => {
    expect(fxQuoteText({ baseCurrency: "EUR", quoteCurrency: "USD", rate: "1.0832", source: "Mock FX desk", observedAt: "2026-10-27T08:06:00Z" }, BEFORE)).toMatch(
      new RegExp(`^Converted at 1 EUR = 1\\.0832 USD, from Mock FX desk on ${DATE_TIME}\\.$`),
    );
    expect(fxQuoteText({ baseCurrency: "EUR", quoteCurrency: "USD", rate: null, source: null, observedAt: null })).toBeNull();
  });

  it("Billed to and From a block per line, absent parts skipped, the country by name — an unknown code as it came", () => {
    expect(
      buyerLines({ kind: "BUSINESS", name: "Cyberdyne Systems", email: "a@x.example", taxId: "XX-1", address: { country: "ES", postalCode: "28013", city: "Madrid", line1: "14 Mock Avenue", line2: null } }),
    ).toEqual(["Cyberdyne Systems", "Tax ID XX-1", "14 Mock Avenue", "28013 Madrid", "Spain", "a@x.example"]);
    expect(sellerLines({ legalName: "Taska Mock S.L.", registrationId: "MOCK-0000", taxId: null, address: null })).toEqual(["Taska Mock S.L.", "Registration MOCK-0000"]);
    expect(countryName("XX")).toBe("XX");
  });
});

describe("the document (B10, decision 5)", () => {
  const refused = (status: number, code: string, message = "the server's words") => new ApiError(message, code, status, "rid-1");

  it("the refusals as the table says them", () => {
    expect(downloadRefusalWords(refused(403, "OWNER_REQUIRED"), "Cyberdyne")).toEqual({ text: "Only the owner of Cyberdyne can download its invoices.", words: null });
    expect(downloadRefusalWords(refused(404, "RESOURCE_NOT_FOUND"), "Cyberdyne").text).toBe("Taska has no PDF for this invoice yet.");
    expect(downloadRefusalWords(refused(503, "POLICY_NOT_CONFIGURED"), "Cyberdyne").text).toBe("Invoice PDFs aren’t available for Cyberdyne yet.");
    expect(downloadRefusalWords(refused(503, "DEPENDENCY_UNAVAILABLE"), "Cyberdyne").text).toBe("Taska couldn’t get the PDF right now. Try again later.");
    expect(downloadRefusalWords(refused(500, "INTERNAL"), "Cyberdyne")).toEqual({ text: "Taska couldn’t download the PDF. Try again.", words: "the server's words" });
    expect(downloadRefusalWords(new UnreadableAnswerError(), "Cyberdyne")).toEqual({ text: "Taska couldn’t download the PDF. Try again.", words: null });
    expect(downloadRefusalWords(new TypeError("Failed to fetch"), "Cyberdyne").text).toBe("Taska couldn’t download the PDF. Try again.");
    expect(downloadRefusalWords(refused(429, "RATE_LIMITED"), "Cyberdyne").text).toMatch(/^Too many attempts\. Try again in /);
    expect(downloadRefusalWords(refused(400, "SOMETHING_NEW"), "Cyberdyne")).toEqual({ text: "The PDF wasn’t downloaded.", words: "the server's words" });
  });

  it("the file's name: the server's when readable, else the number — never a path", () => {
    expect(documentName("TSK-2026-00904", null)).toBe("TSK-2026-00904.pdf");
    expect(documentName("TSK-2026-00904", "Invoice 904.pdf")).toBe("Invoice 904.pdf");
    expect(documentName("a/b:c", null)).toBe("abc.pdf");
    expect(documentName(null, null)).toBe("invoice.pdf");
  });
});

describe("refunds (B11, decision 6)", () => {
  const refund = (overrides: Partial<Refund> = {}): Refund => ({
    id: "rf",
    tenantId: "t",
    kind: "UNALLOCATED_RETURN",
    state: "REQUESTED",
    amount: EUR("500"),
    reasonCode: "EXCESS",
    sourceMethod: "WIRE",
    requestedAt: "2026-11-10T09:00:00Z",
    confirmedAt: null,
    feeBearer: "TASKA",
    sendDueAt: null,
    decidedAt: null,
    submittedAt: null,
    ...overrides,
  });

  it("each reason in words, an unknown code as it came", () => {
    expect(
      ["EXCESS", "LATE_FIRST_PAYMENT", "CLOSED_CREATION", "INCOMPLETE_BANK_PAYMENT", "DUPLICATE_PAYMENT", "BILLING_ERROR", "SERVICE_FAILURE", "MANDATORY", "GOODWILL"].map(refundReasonText),
    ).toEqual([
      "Overpayment",
      "First payment arrived late",
      "Company closed before it opened",
      "Bank transfer not completed in time",
      "Paid twice",
      "Billing error",
      "Service problem",
      "Required refund",
      "GOODWILL",
    ]);
  });

  it("the marker and the tail by state — UNKNOWN is checked, never «sent»; FAILED promises nothing; a send date only where it may be said", () => {
    expect(["REQUESTED", "APPROVED", "SUBMITTING", "UNKNOWN", "CONFIRMED", "FAILED", "REJECTED", "PARKED"].map(refundMarker)).toEqual([
      "requested",
      "approved",
      "sending",
      "checking",
      "refunded",
      "failed",
      "declined",
      "PARKED",
    ]);
    expect(refundMetaText(refund(), BEFORE)).toBe("Bank transfer · Requested Nov 10");
    expect(refundMetaText(refund({ state: "APPROVED", sendDueAt: "2026-11-17T09:00:00Z" }), BEFORE)).toBe("Bank transfer · Taska aims to send it by Nov 17");
    // Online, or past APPROVED, the operator's date is never said.
    expect(refundMetaText(refund({ sourceMethod: "PSP", sendDueAt: "2026-11-17T09:00:00Z" }), BEFORE)).toBe("Online payment · Requested Nov 10");
    expect(refundMetaText(refund({ state: "SUBMITTING", sendDueAt: "2026-11-17T09:00:00Z" }), BEFORE)).toBe("Bank transfer · Being sent");
    expect(refundMetaText(refund({ state: "UNKNOWN" }), BEFORE)).toBe("Bank transfer · Taska is checking whether it went through");
    expect(refundMetaText(refund({ state: "CONFIRMED", confirmedAt: "2026-11-18T09:00:00Z" }), BEFORE)).toBe("Bank transfer · Refunded Nov 18");
    expect(refundMetaText(refund({ state: "FAILED" }), BEFORE)).toBe("Bank transfer · It didn’t go through");
    expect(refundMetaText(refund({ state: "REJECTED", decidedAt: "2026-11-12T09:00:00Z" }), BEFORE)).toBe("Bank transfer · Declined Nov 12");
    expect(refundMetaText(refund({ state: "REJECTED" }), BEFORE)).toBe("Bank transfer · Declined");
    // UNKNOWN is never «Sent» (decision 6), and no tail ever carries the reconciliation target.
    expect(refundMetaText(refund({ state: "UNKNOWN" }), BEFORE)).not.toMatch(/\bsent\b/i);
    for (const state of ["REQUESTED", "APPROVED", "SUBMITTING", "UNKNOWN", "CONFIRMED", "FAILED", "REJECTED"]) {
      expect(refundMetaText(refund({ state }), BEFORE)).not.toMatch(/hour|retry|try again/i);
    }
  });

  it("newest requested first", () => {
    expect(listedRefunds([refund({ id: "a", requestedAt: "2026-10-01T00:00:00Z" }), refund({ id: "b" })]).map((item) => item.id)).toEqual(["b", "a"]);
  });

  it("the card's line for money that arrived late, by its refund's state", () => {
    expect(lateFirstPaymentLine(refund({ reasonCode: "LATE_FIRST_PAYMENT", amount: EUR("2000") }))).toBe(
      "The €20.00 that arrived after an earlier invoice was due is to be refunded to the account it came from.",
    );
    expect(lateFirstPaymentLine(refund({ state: "CONFIRMED", confirmedAt: "2026-11-18T09:00:00Z", amount: EUR("2000") }), BEFORE)).toBe(
      "The €20.00 that arrived after an earlier invoice was due was refunded on Nov 18.",
    );
    expect(lateFirstPaymentLine(refund({ state: "FAILED", amount: EUR("2000") }))).toContain("didn’t go through");
    expect(cardWireLine(wire())).toBe("Invoice TSK-2026-00904 · €20.00 · Bank transfer");
  });
});

describe("fix round 1", () => {
  it("«all of it has arrived» only from matched money with a remaining the server says is zero (G1)", () => {
    // An absent remaining, or a zero total with nothing matched: never a claim that money arrived.
    expect(wireState(wire({ remaining: null }), { now: BEFORE })?.fact).toBe("Waiting for the bank transfer.");
    expect(wireState(wire({ total: EUR("0"), remaining: EUR("0") }), { now: BEFORE })?.fact).toBe("Waiting for the bank transfer.");
    expect(wireState(wire({ remaining: null, wireInstructions: null }), { now: BEFORE })?.fact).toBe("Bank details for this invoice aren’t available yet.");
    expect(wireState(wire({ matchedUnallocated: EUR("2000"), remaining: null }), { now: BEFORE })?.fact).not.toBe("All of the bank transfer has arrived.");
    expect(wireState(wire({ matchedUnallocated: EUR("2000"), remaining: EUR("0"), wireInstructions: null }), { now: AFTER })?.fact).toBe(
      "All of the bank transfer has arrived.",
    );
  });

  it("the card's slot line names an amount only while something is left to send", () => {
    expect(cardWireLine(wire({ matchedUnallocated: EUR("2000"), remaining: EUR("0") }))).toBe("Invoice TSK-2026-00904 · Bank transfer");
    expect(cardWireLine(wire({ remaining: null }))).toBe("Invoice TSK-2026-00904 · Bank transfer");
    expect(cardWireLine(partial())).toBe("Invoice TSK-2026-00904 · €8.00 · Bank transfer");
  });

  it("a matched first transfer on a company not open yet: opening, then «Check again» once the poll stops (fix round decision 1)", () => {
    expect(wireMatchedState("Acme Wire", false)).toEqual({
      kind: "wire",
      fact: "Your bank transfer has been matched.",
      explanation: "Taska is opening Acme Wire. This page opens it when it’s ready — don’t send the transfer again.",
      action: null,
    });
    expect(wireMatchedState("Acme Wire", true)).toEqual({
      kind: "wire",
      fact: "Your bank transfer has been matched.",
      explanation: "Acme Wire hasn’t opened yet. Check again in a few minutes — don’t send the transfer again.",
      action: "check",
    });
    expect(wireMatchedState(null, false).explanation).toBe("Taska is opening this company. This page opens it when it’s ready — don’t send the transfer again.");
    expect(wireMatchedState(null, true).explanation).toMatch(/^This company hasn’t opened yet\./);
    for (const stalled of [false, true]) expect(wireMatchedState("Acme", stalled).explanation).not.toContain("payment provider");
  });

  it("refunds are ordered by instant, not by string", () => {
    const at = (id: string, requestedAt: string | null): Refund => ({
      id,
      tenantId: "t",
      kind: "UNALLOCATED_RETURN",
      state: "REQUESTED",
      amount: EUR("100"),
      reasonCode: "EXCESS",
      sourceMethod: "WIRE",
      requestedAt,
      confirmedAt: null,
      feeBearer: "TASKA",
      sendDueAt: null,
      decidedAt: null,
      submittedAt: null,
    });
    // «…00.500Z» sorts before «…00Z» as a string, but is the later instant; «+01:00» is an hour earlier than it reads.
    const listed = listedRefunds([at("a", "2026-11-10T09:00:00Z"), at("b", "2026-11-10T09:00:00.500Z"), at("c", "2026-11-10T09:30:00+01:00"), at("d", null)]);
    expect(listed.map((item) => item.id)).toEqual(["b", "a", "c", "d"]);
  });
});
