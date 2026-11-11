import type { BillingAddress, BuyerSnapshot, FxQuoteFacts, Invoice, InvoiceLine, Refund, SellerSnapshot } from "../../api/billing";
import { apiErrorFacts, isB2bErrorCode, refusalCode, refusalRetryAfter } from "../../api/errors";
import type { Money } from "../../api/tenants";
import { formatWait } from "../authText";
import { formatDeadline } from "../companySetupText";
import { formatDue, formatInvoiceMoney, isZeroMoney, methodText, type PaymentState } from "./billingText";
import { companyInside, companyStart } from "./companyGeneralText";

/*
 * TAS-514's words as pure values — the bank-transfer invoice, its document,
 * its snapshot and the company's refunds (DESIGN.md §4.41 to be): art-director's
 * pre-build B3–B11 and B14, reconciled by the orchestrator's decisions over
 * api-contract-guard's ruling and its addendum.
 *
 * **Nothing here is decided by the client's clock but wording** (A85): whether
 * bank details are shown, what is received and what goes back come from the
 * invoice as the server answered it; the clock against `dueAt` only picks
 * between «has to arrive by» and «was due to arrive by». **No duration is
 * ever this build's own**: the reconciliation target is said only when the
 * company's capabilities carried it, and nothing is counted from it.
 */

/* ------------------------------------------------------------ the facts */

const positive = (money: Money | null): money is Money => money !== null && !isZeroMoney(money);

/** A wire invoice the money may still arrive for: WIRE, OPEN or PARTIALLY_PAID — the server's state, past `dueAt` too (Q7). */
export const isWireOpen = (invoice: Pick<Invoice, "paymentMethod" | "state">) =>
  invoice.paymentMethod === "WIRE" && (invoice.state === "OPEN" || invoice.state === "PARTIALLY_PAID");

/** The «Bank transfer» group (B4): an open wire invoice with something left to send and all five details. */
export const showsBankDetails = (invoice: Invoice) => isWireOpen(invoice) && positive(invoice.remaining) && invoice.wireInstructions !== null;

/** The bank money matched to the invoice and not applied — `matchedUnallocated` above zero, else `null` (F2). */
export const receivedOf = (invoice: Pick<Invoice, "matchedUnallocated">): Money | null =>
  positive(invoice.matchedUnallocated) ? invoice.matchedUnallocated : null;

/** Whether the local clock has passed the due date — **wording only** (decision 3). */
export const pastDue = (invoice: Pick<Invoice, "dueAt">, now: Date = new Date()) =>
  invoice.dueAt !== null && Date.parse(invoice.dueAt) <= now.getTime();

/* ---------------------------------------------------- the wire state (B3) */

/** «Dec 4, 14:32» — §4.37's format for a due date, in the reader's time. */
export const dueText = (iso: string, now: Date = new Date()) => formatDeadline(iso, now);

/**
 * What the state block says for a wire invoice (B3, decision 3), or `null`
 * where the page says it otherwise (EXPIRED and VOID have their own line, PAID
 * is «Paid.» only when it resolved during the visit). `sentence3` is the
 * reconciliation note's rule for the invoice's purpose — said here past the
 * due date (B3's third row) and not again under the bank details.
 */
export function wireState(invoice: Invoice, options: { now?: Date; sentence3?: string | null } = {}): PaymentState | null {
  if (!isWireOpen(invoice)) return null;
  const now = options.now ?? new Date();
  const due = invoice.dueAt !== null ? dueText(invoice.dueAt, now) : null;
  const received = receivedOf(invoice);
  const kind = "wire" as const;
  if (invoice.wireInstructions === null && positive(invoice.remaining)) {
    return { kind, fact: "Bank details for this invoice aren’t available yet.", explanation: "Don’t send money for it until they appear here.", action: null };
  }
  if (!positive(invoice.remaining)) {
    // All of it matched, not yet applied (the guard's §4 row): no bank details, nothing to send.
    return { kind, fact: "All of the bank transfer has arrived.", explanation: "Taska is confirming it — don’t send it again.", action: null };
  }
  const late = pastDue(invoice, now);
  const receivedText = received !== null ? formatInvoiceMoney(received) : null;
  if (!late) {
    if (invoice.state === "PARTIALLY_PAID" || received !== null) {
      return {
        kind,
        fact: "Part of the bank transfer has arrived.",
        explanation: [
          "The invoice is paid once all of it has.",
          due !== null && receivedText !== null ? `If the rest doesn’t arrive by ${due}, the ${receivedText} that arrived is refunded.` : null,
        ]
          .filter((part): part is string => part !== null)
          .join(" "),
        action: null,
      };
    }
    return {
      kind,
      fact: "Waiting for the bank transfer.",
      explanation: "If you’ve already sent it, there’s nothing more to do — this invoice shows it once Taska has matched it.",
      action: null,
    };
  }
  if (invoice.state === "PARTIALLY_PAID" || received !== null) {
    return {
      kind,
      fact: "Its due date has passed.",
      explanation: [
        due !== null ? `If the rest arrived by ${due}, it still counts once Taska matches it.` : "If the rest arrived in time, it still counts once Taska matches it.",
        receivedText !== null ? `If it didn’t, the ${receivedText} that arrived is refunded.` : null,
      ]
        .filter((part): part is string => part !== null)
        .join(" "),
      action: null,
    };
  }
  return {
    kind,
    fact: "Its due date has passed.",
    explanation: [
      due !== null ? `If the money arrived by ${due}, it still counts once Taska matches it.` : "If the money arrived in time, it still counts once Taska matches it.",
      options.sentence3 ?? null,
    ]
      .filter((part): part is string => part !== null && part !== "")
      .join(" "),
    action: null,
  };
}

/** An EXPIRED invoice with matched money (Q4, decision 2): what goes back. «is to be», not «is being». */
export const toBeRefundedText = (received: Money) => `The ${formatInvoiceMoney(received)} that arrived for it is to be refunded.`;

/* ---------------------------------------------- the Bank transfer group (B4) */

export const BANK_TRANSFER_TITLE = "Bank transfer";

/** The group's lead (B4): «Send {remaining} to this account. It has to arrive by {due}.», or after it «It was due to arrive by {due}.». */
export function bankLead(invoice: Invoice, now: Date = new Date()): { before: string; due: string | null; after: string } {
  const due = invoice.dueAt !== null ? dueText(invoice.dueAt, now) : null;
  const remaining = invoice.remaining !== null ? formatInvoiceMoney(invoice.remaining) : null;
  if (pastDue(invoice, now)) return { before: "It was due to arrive by ", due, after: "." };
  const send = remaining !== null ? `Send ${remaining} to this account.` : "Send it to this account.";
  return due === null ? { before: send, due: null, after: "" } : { before: `${send} It has to arrive by `, due, after: "." };
}

/** The IBAN in its print form (ISO 13616): groups of four — presentation only; Copy copies the value as received. */
export const ibanGroups = (iban: string) => iban.replace(/\s+/g, "").match(/.{1,4}/g) ?? [iban];

/** The Amount row's second line (B4), with money received: «The rest of {total} — {received} has already arrived.» */
export const amountRestNote = (total: Money, received: Money) =>
  `The rest of ${formatInvoiceMoney(total)} — ${formatInvoiceMoney(received)} has already arrived.`;

/** The Reference row's second line (B4); « Use this, not the invoice number.» only when the two differ. */
export const referenceNote = (reference: string, number: string | null) =>
  `Enter it exactly as shown in the transfer’s reference field — it’s how Taska knows the money is for this invoice.${
    number !== null && reference !== number ? " Use this, not the invoice number." : ""
  }`;

/** The four values a Copy control copies (B5): its label, its word in the failure sentence, its status. */
export type CopyField = "beneficiary" | "iban" | "bic" | "reference";

export const COPY_WORDS: Readonly<Record<CopyField, { label: string; word: string; copied: string }>> = {
  beneficiary: { label: "Copy beneficiary name", word: "beneficiary name", copied: "Beneficiary name copied" },
  iban: { label: "Copy IBAN", word: "IBAN", copied: "IBAN copied" },
  bic: { label: "Copy BIC", word: "BIC", copied: "BIC copied" },
  reference: { label: "Copy reference", word: "reference", copied: "Reference copied" },
};

/** The clipboard refused (B5): the value is selected, and the reader is told how to copy it — by touch on a coarse pointer. */
export const copyFailedText = (field: CopyField, coarse: boolean) =>
  `Couldn’t copy the ${COPY_WORDS[field].word} automatically. It’s selected — ${coarse ? "touch and hold it to copy it." : "press Ctrl+C or ⌘C to copy it."}`;

/* ---------------------------------------------------- reconciliation (B6) */

/**
 * `WIRE_RECONCILIATION_TARGET_SECONDS` in words (B6): «24 hours», «1 hour»,
 * otherwise each non-zero part — «1 hour 30 minutes», «45 minutes» — never «a
 * day» and never business days. Nothing rounded: the server's number, said.
 */
export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const part = (count: number, unit: string) => (count === 0 ? null : `${count} ${unit}${count === 1 ? "" : "s"}`);
  return [part(hours, "hour"), part(minutes, "minute"), part(rest, "second")].filter((item): item is string => item !== null).join(" ");
}

/**
 * The reconciliation note's first two sentences (B6, decision 4): the target
 * only when the capabilities carried it, otherwise the sentence without a
 * number — never a default.
 */
export function reconciliationSentences(targetSeconds: number | null): [string, string] {
  const first =
    targetSeconds !== null
      ? `Taska matches bank transfers to invoices by hand, and aims to do it within ${formatDuration(targetSeconds)} of the money arriving. Until then this invoice shows as unpaid — don’t send it again.`
      : "Taska matches bank transfers to invoices by hand once the money arrives. Until then this invoice shows as unpaid — don’t send it again.";
  return [first, "For the due date, what counts is when the money arrives, not when Taska matches it."];
}

/**
 * The note's third sentence, by the invoice's purpose (B6 with Q7, decision 4):
 * a RENEWAL renews late too — not while the platform blocks the company; a
 * first payment late is refunded, and a new invoice is issued only while the
 * company still waits for its first payment; a PLAN_CHANGE has none (A88).
 */
export function purposeSentence(input: {
  invoice: Pick<Invoice, "purpose" | "dueAt">;
  company: string | null;
  restrictions: readonly string[];
  lifecycle: string | null;
  creationDeadline: string | null;
  now?: Date;
}): string | null {
  const { invoice, company } = input;
  const now = input.now ?? new Date();
  const due = invoice.dueAt !== null ? dueText(invoice.dueAt, now) : null;
  const after = due !== null ? `If it arrives after ${due}` : "If it arrives late";
  if (invoice.purpose === "RENEWAL") {
    if (input.restrictions.includes("PLATFORM_BLOCK")) return null;
    return `${after}, it still renews ${companyInside(company)}, but the new month starts when Taska matches it.`;
  }
  if (invoice.purpose === "INITIAL" && input.lifecycle === "AWAITING_PAYMENT") {
    const closes =
      input.creationDeadline !== null && input.creationDeadline !== invoice.dueAt
        ? ` ${companyStart(company)} still closes if it isn’t paid by ${dueText(input.creationDeadline, now)}.`
        : "";
    return `${after}, it’s refunded, and Taska issues a new invoice while ${companyInside(company)} is still waiting for its first payment.${closes}`;
  }
  return null;
}

/* ------------------------------------------------------ received (B7) */

/** The Received fact's second line (B7) — only while the invoice can still be paid. */
export const receivedNote = (total: Money) => `Counts only once all ${formatInvoiceMoney(total)} has arrived.`;

/* ---------------------------------------------------------- items (B8) */

export const ITEMS_TITLE = "Items";
export const NO_ITEMS_TEXT = "This invoice lists no items.";

/** A line's second line (B8): «Quantity {n}» above one, «Net {net}» when it is taxed, each tax «{label} {amount}» — no rate (A84). */
export function lineMetaText(line: InvoiceLine): string {
  const taxed = line.taxes.length > 0;
  return [
    line.quantity !== null && line.quantity > 1 ? `Quantity ${line.quantity}` : null,
    taxed && line.net !== null ? `Net ${formatInvoiceMoney(line.net)}` : null,
    ...line.taxes.map((tax) => [tax.label, tax.amount !== null ? formatInvoiceMoney(tax.amount) : null].filter(Boolean).join(" ") || null),
  ]
    .filter((part): part is string => part !== null && part !== "")
    .join(" · ");
}

/** A «Total» row (B8) only with two lines or more, or any tax. */
export const needsTotalRow = (lines: readonly InvoiceLine[]) => lines.length >= 2 || lines.some((line) => line.taxes.length > 0);

/** The FX quote under the items (B8): «Converted at 1 {base} = {rate} {quote}, from {source} on {observedAt}.» — the rate verbatim. */
export function fxQuoteText(fx: FxQuoteFacts, now: Date = new Date()): string | null {
  if (fx.baseCurrency === null || fx.quoteCurrency === null || fx.rate === null) return null;
  const from = fx.source !== null ? `, from ${fx.source}` : "";
  const on = fx.observedAt !== null ? ` on ${dueText(fx.observedAt, now)}` : "";
  return `Converted at 1 ${fx.baseCurrency} = ${fx.rate} ${fx.quoteCurrency}${from}${on}.`;
}

/* ------------------------------------------------------- snapshot (B9) */

export const BILLING_DETAILS_TITLE = "Billing details";
export const SNAPSHOT_NOTE = "As they were when this invoice was issued.";

/** A country's English name (`Intl.DisplayNames`), the code as it came when the platform has no name for it. */
export function countryName(code: string): string {
  try {
    return new Intl.DisplayNames("en", { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

function addressLines(address: BillingAddress | null): string[] {
  if (address === null) return [];
  const place = [address.postalCode, address.city].filter((part): part is string => part !== null).join(" ");
  return [address.line1, address.line2, place || null, address.country !== null ? countryName(address.country) : null].filter(
    (line): line is string => line !== null && line !== "",
  );
}

/** «Billed to» (B9): name · Tax ID · the address · the email — absent parts skipped, `kind` never printed. */
export const buyerLines = (buyer: BuyerSnapshot): string[] =>
  [buyer.name, buyer.taxId !== null ? `Tax ID ${buyer.taxId}` : null, ...addressLines(buyer.address), buyer.email].filter(
    (line): line is string => line !== null && line !== "",
  );

/** «From» (B9): legal name · Registration · Tax ID · the address. */
export const sellerLines = (seller: SellerSnapshot): string[] =>
  [
    seller.legalName,
    seller.registrationId !== null ? `Registration ${seller.registrationId}` : null,
    seller.taxId !== null ? `Tax ID ${seller.taxId}` : null,
    ...addressLines(seller.address),
  ].filter((line): line is string => line !== null && line !== "");

/* ------------------------------------------------------- the PDF (B10) */

export const DOWNLOAD_PDF = "Download PDF";
export const downloadLabel = (number: string | null) => (number !== null ? `Download PDF of invoice ${number}` : "Download PDF of this invoice");
export const downloadingStatus = (number: string | null) => (number !== null ? `Downloading invoice ${number}.` : "Downloading the invoice.");
export const downloadedStatus = (number: string | null) => (number !== null ? `Invoice ${number} downloaded.` : "The invoice was downloaded.");

/** The saved file's name (decision 5): the server's, when it gave a readable one, else «{number}.pdf». */
export const documentName = (number: string | null, fromServer: string | null) =>
  fromServer ?? `${(number ?? "invoice").replace(/[\p{Cc}<>:"/\\|?*]/gu, "").trim() || "invoice"}.pdf`;

/** A refusal of the download as it is said (B10's table): the sentence, and the server's words where the table prints them. */
export function downloadRefusalWords(error: unknown, company: string | null): { text: string; words: string | null } {
  const code = refusalCode(error);
  const { status, message } = apiErrorFacts(error);
  if (code === "OWNER_REQUIRED") return { text: `Only the owner of ${companyInside(company)} can download its invoices.`, words: null };
  if (status === 404 || code === "RESOURCE_NOT_FOUND") return { text: "Taska has no PDF for this invoice yet.", words: null };
  if (code === "POLICY_NOT_CONFIGURED") return { text: `Invoice PDFs aren’t available for ${companyInside(company)} yet.`, words: null };
  if (code === "DEPENDENCY_UNAVAILABLE") return { text: "Taska couldn’t get the PDF right now. Try again later.", words: null };
  if (status === 429 || code === "RATE_LIMITED") return { text: `Too many attempts. Try again in ${formatWait(refusalRetryAfter(error))}.`, words: null };
  // No answer, a 408 or a 5xx — and a 2xx that was no PDF (`UnreadableAnswerError`, no status): the same press again.
  if (status === null || status === 408 || status >= 500) return { text: "Taska couldn’t download the PDF. Try again.", words: message || null };
  return { text: "The PDF wasn’t downloaded.", words: isB2bErrorCode(code) ? null : message || null };
}

/* ------------------------------------------------------ refunds (B11) */

export const REFUNDS_TITLE = "Refunds";
export const REFUNDS_LEAD = "Refunds go back to the account the money came from. When they arrive depends on the banks.";
export const REFUNDS_READ_FAILED = "Refunds could not be loaded.";

/** A refund's reason (B11, line 1); a code this build does not know, as it came. */
export function refundReasonText(reason: string | null): string | null {
  switch (reason) {
    case "EXCESS":
      return "Overpayment";
    case "LATE_FIRST_PAYMENT":
      return "First payment arrived late";
    case "CLOSED_CREATION":
      return "Company closed before it opened";
    case "INCOMPLETE_BANK_PAYMENT":
      return "Bank transfer not completed in time";
    case "DUPLICATE_PAYMENT":
      return "Paid twice";
    case "BILLING_ERROR":
      return "Billing error";
    case "SERVICE_FAILURE":
      return "Service problem";
    case "MANDATORY":
      return "Required refund";
    default:
      return reason;
  }
}

/** The marker's word (B11, decision 6): never «sent» for an UNKNOWN one; a state this build does not know, as it came. */
export function refundMarker(state: string | null): string | null {
  switch (state) {
    case "REQUESTED":
      return "requested";
    case "APPROVED":
      return "approved";
    case "SUBMITTING":
      return "sending";
    case "UNKNOWN":
      return "checking";
    case "CONFIRMED":
      return "refunded";
    case "FAILED":
      return "failed";
    case "REJECTED":
      return "declined";
    default:
      return state;
  }
}

/**
 * The row's second line after the method (B11, decision 6): «Taska aims to
 * send it by {date}» only for a REQUESTED or APPROVED bank-transfer refund that
 * carries `sendDueAt` — never as an arrival, never the reconciliation target —
 * else «Requested {date}»; UNKNOWN «Taska is checking whether it went
 * through»; FAILED «It didn’t go through», no retry promised.
 */
export function refundTail(refund: Refund, now: Date = new Date()): string | null {
  const day = (iso: string | null) => (iso !== null ? formatDue(iso, now) : null);
  switch (refund.state) {
    case "REQUESTED":
    case "APPROVED":
      if (refund.sourceMethod === "WIRE" && refund.sendDueAt !== null) return `Taska aims to send it by ${day(refund.sendDueAt)}`;
      return refund.requestedAt !== null ? `Requested ${day(refund.requestedAt)}` : null;
    case "SUBMITTING":
      return "Being sent";
    case "UNKNOWN":
      return "Taska is checking whether it went through";
    case "CONFIRMED":
      return refund.confirmedAt !== null ? `Refunded ${day(refund.confirmedAt)}` : "Refunded";
    case "FAILED":
      return "It didn’t go through";
    case "REJECTED":
      return refund.decidedAt !== null ? `Declined ${day(refund.decidedAt)}` : "Declined";
    default:
      return null;
  }
}

/** The second line whole (B11): «{method} · {tail}» — no invoice, ever (A81). */
export const refundMetaText = (refund: Refund, now: Date = new Date()) =>
  [methodText(refund.sourceMethod), refundTail(refund, now)].filter((part): part is string => part !== null && part !== "").join(" · ");

/** Newest `requestedAt` first, then by id — the order the screen draws (B11). */
export const listedRefunds = (refunds: readonly Refund[]) =>
  [...refunds].sort((a, b) => {
    const left = a.requestedAt ?? "";
    const right = b.requestedAt ?? "";
    return left < right ? 1 : left > right ? -1 : a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });

/* ---------------------------------------------- the never-opened card (B14) */

/** The card's slot line for a wire first payment (B14): «Invoice {number} · {remaining} · Bank transfer». */
export const cardWireLine = (invoice: Invoice) =>
  [invoice.number !== null ? `Invoice ${invoice.number}` : "Invoice", invoice.remaining !== null ? formatInvoiceMoney(invoice.remaining) : null, "Bank transfer"]
    .filter((part): part is string => part !== null)
    .join(" · ");

/**
 * The card's line for a first payment that arrived late (decision 7): what
 * happens to that money, by its refund's state — never «sent», never a date
 * it will arrive.
 */
export function lateFirstPaymentLine(refund: Refund, now: Date = new Date()): string | null {
  if (refund.amount === null) return null;
  const amount = formatInvoiceMoney(refund.amount);
  const subject = `The ${amount} that arrived after an earlier invoice was due`;
  switch (refund.state) {
    case "CONFIRMED":
      return refund.confirmedAt !== null ? `${subject} was refunded on ${formatDue(refund.confirmedAt, now)}.` : `${subject} was refunded.`;
    case "FAILED":
      return `The refund of the ${amount} that arrived after an earlier invoice was due didn’t go through.`;
    case "REJECTED":
      return `The refund of the ${amount} that arrived after an earlier invoice was due was declined.`;
    default:
      return `${subject} is to be refunded to the account it came from.`;
  }
}
