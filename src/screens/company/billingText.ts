import type { Checkout, Invoice } from "../../api/billing";
import { apiErrorFacts, isB2bErrorCode, refusalCode, refusalReasons, refusalRetryAfter } from "../../api/errors";
import type { Money } from "../../api/tenants";
import { reasonedRefusal } from "../../lib/companyRestrictions";
import { formatWait } from "../authText";
import { formatDeadline } from "../companySetupText";
import { companyInside } from "./companyGeneralText";

/*
 * Company › Billing (TAS-513, DESIGN.md §4.41 to be) as pure values, so every
 * sentence and every state is pinned by a unit test — art-director's B3–B9
 * with the orchestrator's decisions over api-contract-guard's addendum.
 *
 * **Only server settlement is payment**: «Paid» comes from `Invoice.state =
 * PAID` and nothing else — a checkout's `SUCCEEDED` reads «Confirming», and a
 * return address is never read at all. A cancel is a wording hint only (A56).
 */

/* ------------------------------------------------------------- the words */

export const BILLING_LOADING_TEXT = "Loading invoices";
export const INVOICES_EMPTY_TEXT = "No invoices yet.";
export const INVOICES_READ_FAILED = "Invoices could not be loaded.";
export const INVOICE_READ_FAILED = "This invoice could not be loaded.";
export const OPENING_PAYMENT_LABEL = "Opening payment page";
export const OPENING_PAYMENT_STATUS = "Opening the payment page.";
export const NO_LONGER_PAYABLE_TEXT = "This invoice can no longer be paid.";
export const NO_INVOICE_YET_TEXT = "There’s no invoice to pay yet. It appears here once Taska issues it.";
/** «Return to payment»'s fresh read of the checkout refused (api-contract-guard F2; the orchestrator's wording). */
export const REOPEN_FAILED_TEXT = "Taska couldn’t reopen the payment page.";
export const SECURE_PAGE_NOTE = "You’ll pay on a secure page from our payment provider and come back here.";

export const billingLeadText = (company: string | null) => `Invoices for ${companyInside(company)} and how they were paid.`;
export const billingOwnerOnlyText = (company: string | null) => `Invoices and payments for ${companyInside(company)} are shown only to its owner.`;
export const replacedByText = "It was replaced by invoice";

/* ------------------------------------------------------------- the money */

const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/**
 * An invoice's amount (art-director B3): `Intl.NumberFormat('en',
 * {style:'currency'})`'s symbol around the string's own digits, **with the
 * exponent's fraction digits** — «€20.00», never «€20». No float holds it.
 */
export function formatInvoiceMoney(money: Money): string {
  const { amountMinor, currency, exponent } = money;
  const digits = amountMinor.padStart(exponent + 1, "0");
  const whole = digits.slice(0, digits.length - exponent);
  const fraction = exponent > 0 ? digits.slice(digits.length - exponent) : "";
  const number = fraction === "" ? group(whole) : `${group(whole)}.${fraction}`;
  try {
    const parts = new Intl.NumberFormat("en", { style: "currency", currency }).formatToParts(0);
    const first = parts.findIndex((part) => part.type === "integer");
    const last = parts.reduce(
      (end, part, index) => (part.type === "integer" || part.type === "decimal" || part.type === "fraction" ? index : end),
      first,
    );
    const before = parts.slice(0, first).map((part) => part.value).join("");
    const after = parts.slice(last + 1).map((part) => part.value).join("");
    return `${before}${number}${after}`;
  } catch {
    return `${number} ${currency}`;
  }
}

const isZero = (money: Money | null) => money !== null && /^0+$/.test(money.amountMinor);
/** A `Money` of nothing — its minor units all zeros. */
export const isZeroMoney = (money: Money) => /^0+$/.test(money.amountMinor);
const sameMoney = (a: Money | null, b: Money | null) =>
  a !== null && b !== null && a.amountMinor === b.amountMinor && a.currency === b.currency && a.exponent === b.exponent;

/* ------------------------------------------------------------ the facts */

/** `purpose` in words (B3); a value this build does not know, as it came. */
export function purposeText(purpose: string | null): string | null {
  switch (purpose) {
    case "INITIAL":
      return "First payment";
    case "RENEWAL":
      return "Renewal";
    case "PLAN_CHANGE":
      return "Plan change";
    default:
      return purpose;
  }
}

/** `paymentMethod` in words (B5). */
export function methodText(method: string | null): string | null {
  switch (method) {
    case "PSP":
      return "Online payment";
    case "WIRE":
      return "Bank transfer";
    default:
      return method;
  }
}

/** «Dec 4»; another year than `now`'s — «Dec 4, 2027». Local time. */
export function formatDue(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  }).format(date);
}

/** The row's second line (B3): «{Purpose} · Due {Mon D}», « · Bank transfer» for a wire one. No period: the contract has none. */
export function invoiceMetaText(invoice: Invoice, now: Date = new Date()): string {
  return [
    purposeText(invoice.purpose),
    invoice.dueAt !== null ? `Due ${formatDue(invoice.dueAt, now)}` : null,
    invoice.paymentMethod === "WIRE" ? "Bank transfer" : null,
  ]
    .filter((part): part is string => part !== null && part !== "")
    .join(" · ");
}

/** «Invoice {number}», or «Invoice» for one the server sent without a number. */
export const invoiceTitle = (invoice: Pick<Invoice, "number"> | null) => (invoice?.number ? `Invoice ${invoice.number}` : "Invoice");

/** The invoice states the server has ended: nothing a local record says outranks them (release-reviewer B1). */
export const ENDED_INVOICE_STATES: ReadonlySet<string> = new Set(["PAID", "EXPIRED", "VOID"]);

/**
 * The status marker's word (B9); an unresolved attempt reads `confirming` over
 * it — **never over PAID, EXPIRED or VOID**: the server's ended state wins
 * over any local record (release-reviewer B1). Never `overdue`.
 */
export function statusWord(state: string | null, confirming = false): string | null {
  if (confirming && !ENDED_INVOICE_STATES.has(state ?? "")) return "confirming";
  switch (state) {
    case "OPEN":
      return "unpaid";
    case "PARTIALLY_PAID":
      return "part paid";
    case "PAID":
      return "paid";
    case "EXPIRED":
      return "expired";
    case "VOID":
      return "void";
    case "DRAFT":
    case null:
      return null;
    default:
      return state;
  }
}

/**
 * Whether Pay is offered (the orchestrator's decision 1, addendum Q5): an OPEN
 * invoice paid online, with nothing paid on it yet — the provider charges the
 * whole `total`. Not PARTIALLY_PAID, not a wire invoice, not one whose
 * remaining is not its total. The caller adds: no unresolved attempt, reads
 * resolved.
 */
export function isPayable(invoice: Invoice): boolean {
  return (
    invoice.state === "OPEN" &&
    invoice.paymentMethod === "PSP" &&
    invoice.total !== null &&
    !isZero(invoice.total) &&
    sameMoney(invoice.remaining, invoice.total)
  );
}

/** «Pay {total}» on the detail and the card; the row's is «Pay». */
export const payLabel = (invoice: Invoice) => (invoice.total ? `Pay ${formatInvoiceMoney(invoice.total)}` : "Pay");

/** The invoices the list draws (B3): every one but DRAFT, newest issued first. */
export function listedInvoices(invoices: readonly Invoice[]): Invoice[] {
  return invoices
    .filter((invoice) => invoice.state !== "DRAFT")
    .sort((a, b) => {
      const left = a.issuedAt ?? "";
      const right = b.issuedAt ?? "";
      return left < right ? 1 : left > right ? -1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
}

/** Of the payable rows, the one whose Pay is primary (B4): the earliest due. */
export function primaryPayable(invoices: readonly Invoice[], payable: (invoice: Invoice) => boolean): string | null {
  const candidates = invoices.filter(payable);
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => ((a.dueAt ?? "~") < (b.dueAt ?? "~") ? -1 : (a.dueAt ?? "~") > (b.dueAt ?? "~") ? 1 : 0))[0].id;
}

/** The invoice that replaced this one, from the list (B5) — the listed one whose `replacesInvoiceId` names it. */
export const replacementOf = (invoice: Invoice, invoices: readonly Invoice[]) =>
  invoices.find((item) => item.replacesInvoiceId === invoice.id) ?? null;

/* ------------------------------------------------- the payment's state (B7) */

/** What the state block says, and which action stands under it. */
export interface PaymentState {
  kind:
    | "confirming"
    | "unknown"
    | "paid"
    | "failed"
    | "left"
    | "expired"
    | "in-progress"
    | "not-found"
    | "unreadable";
  fact: string;
  explanation: string;
  /** The control the block offers: Pay again, the same payment page again, or a manual re-read. */
  action: "pay" | "return" | "check" | null;
  /**
   * «Check again» after «Return to payment» (art-director N9): five minutes on
   * an open checkout keep its page and add the manual re-read after it.
   */
  alsoCheck?: boolean;
}

/**
 * The invoice page's Status word (art-director blocker 3): «confirming» only
 * while the block itself says so — confirming or the bank's UNKNOWN — and the
 * invoice's own word otherwise, «You left the payment page.» included.
 */
export const statusFollowsBlock = (state: PaymentState | null) => state !== null && (state.kind === "confirming" || state.kind === "unknown");

/** How long the watch has been at it (art-director B6): the copy changes at 30 s, the reads stop at 5 min. */
export type WatchStage = "fresh" | "slow" | "stopped";

export const DONT_PAY_AGAIN = "Don’t pay again.";

/**
 * The checkout an unresolved attempt watches, mapped to its line (B7, the
 * guard's §4 table and addendum Q4): the invoice decides «Paid»; a
 * `SUCCEEDED` before it is «Confirming»; UNKNOWN offers no Pay; FAILED and
 * EXPIRED offer it again; a CREATED or PENDING one is «Confirming» — or «You
 * left the payment page.» after the cancel address, with «Return to payment»
 * (also after 30 s of confirming). `checkout` is `null` before its first
 * answer: «Confirming», no Pay.
 */
export function watchedPaymentState(input: {
  invoice: Invoice | null;
  checkout: Checkout | null;
  left: boolean;
  stage: WatchStage;
  company: string | null;
  reopened: boolean;
}): PaymentState {
  const { invoice, checkout, left, stage } = input;
  if (invoice?.state === "PAID") return paidState(invoice, input.company, input.reopened);
  const state = checkout?.state ?? null;
  if (state === "UNKNOWN") {
    return {
      kind: "unknown",
      fact: "We’re confirming this payment with the bank.",
      explanation:
        "It may have gone through, so don’t pay again. When the bank answers, this invoice shows the result, and if the payment didn’t go through you’ll be able to pay here.",
      action: null,
    };
  }
  if (state === "FAILED") return failedState();
  if (state === "EXPIRED") return expiredState();
  // Back from the provider — the cancel address, or Back itself (the orchestrator's N3) — once the checkout
  // has answered open: before its first answer it is «Confirming» (release-reviewer R1), and a SUCCEEDED,
  // UNKNOWN or ended one overrides the hint.
  if ((state === "CREATED" || state === "PENDING") && left) {
    return {
      kind: "left",
      fact: "You left the payment page.",
      explanation: "The invoice is still unpaid.",
      action: "return",
      ...(stage === "stopped" ? { alsoCheck: true } : {}),
    };
  }
  if (state === null || state === "CREATED" || state === "PENDING" || state === "SUCCEEDED") {
    const open = state === "CREATED" || state === "PENDING";
    return {
      kind: "confirming",
      fact: "Confirming the payment.",
      explanation:
        stage === "stopped"
          ? `Taska hasn’t heard back yet. Check again in a few minutes. ${DONT_PAY_AGAIN}`
          : stage === "slow"
            ? `This is taking a while. You can leave this page — the invoice will show the result. ${DONT_PAY_AGAIN}`
            : "Taska is checking it with the payment provider. This page updates on its own — don’t pay again.",
      // Past 30 s on an open checkout, its page again (the guard's §4 table); stopped, «Check again» —
      // after «Return to payment» on an open one, alone on a SUCCEEDED one (art-director N9).
      action: open && stage !== "fresh" ? "return" : stage === "stopped" ? "check" : null,
      ...(open && stage === "stopped" ? { alsoCheck: true } : {}),
    };
  }
  return {
    kind: "unreadable",
    fact: "Taska can’t show this payment’s state.",
    explanation: `This page keeps checking. ${DONT_PAY_AGAIN}`,
    action: null,
  };
}

/** «Paid.» (B7): only from the invoice; «{Company} is open for changes again.» only when the re-read company lost `PAYMENT_EXPIRED`. */
export function paidState(invoice: Invoice, company: string | null, reopened: boolean): PaymentState {
  const paidLine = invoice.number ? `Invoice ${invoice.number} is paid in full.` : "This invoice is paid in full.";
  return {
    kind: "paid",
    fact: "Paid.",
    explanation: reopened ? `${paidLine} ${company ?? "This company"} is open for changes again.` : paidLine,
    action: null,
  };
}

export const failedState = (): PaymentState => ({
  kind: "failed",
  fact: "The payment didn’t go through.",
  explanation: "The invoice is still unpaid. You can pay it again with the same card or another one.",
  action: "pay",
});

export const expiredState = (): PaymentState => ({
  kind: "expired",
  fact: "The payment page expired.",
  explanation: "No payment was made on it. The invoice is still unpaid.",
  action: "pay",
});

/** «Already in progress» (B7, decision 7): the time only when the local record has the checkout's `expiresAt`. */
export function inProgressState(expiresAt: string | null, now: Date = new Date()): PaymentState {
  const until = expiresAt !== null && !Number.isNaN(Date.parse(expiresAt)) ? formatDeadline(expiresAt, now) : null;
  return {
    kind: "in-progress",
    fact: "A payment for this invoice is already in progress.",
    explanation:
      until !== null
        ? `Finish it where you started it, or wait until ${until}, when it expires. ${DONT_PAY_AGAIN}`
        : `Finish it where you started it, or wait for it to expire. ${DONT_PAY_AGAIN}`,
    action: null,
  };
}

/** A checkout this company does not have (B6): never a switch, a redirect or a Pay. */
export function notFoundState(company: string | null): PaymentState {
  return {
    kind: "not-found",
    fact: `This payment wasn’t found in ${company ?? "this company"}.`,
    explanation: "If you paid for another company, open it from All companies to see its invoices. Nothing here has changed.",
    action: null,
  };
}

/* ------------------------------------------------------ the refusals (B8) */

/** A refusal of Pay as it is said: the sentence, and the server's words for the detail line when B8 prints them. */
export interface PayRefusalWords {
  text: string;
  words: string | null;
}

const unanswered = (error: unknown) => {
  const { status } = apiErrorFacts(error);
  return status === null || status === 408 || status >= 500;
};

/**
 * B8 with the guard's addendum: the sentence under Pay for a refusal of
 * `createCheckout`, or `null` when the refusal is answered by re-reading
 * instead (409 `INVALID_STATE`). `creationDeadline` adds the card's « The
 * company stays reserved until {deadline}.» to the «isn't available» rows.
 */
export function payRefusalWords(
  error: unknown,
  company: string | null,
  options: { creationDeadline?: string | null; now?: Date } = {},
): PayRefusalWords | null {
  const code = refusalCode(error);
  const { status, message } = apiErrorFacts(error);
  const reserved =
    options.creationDeadline && !Number.isNaN(Date.parse(options.creationDeadline))
      ? ` The company stays reserved until ${formatDeadline(options.creationDeadline, options.now)}.`
      : "";
  const unavailable = `Online payment isn’t available right now, so the payment page wasn’t opened and nothing was charged. Try again later.${reserved}`;
  if (code === "INVALID_STATE") return null;
  if (code === "POLICY_NOT_CONFIGURED") {
    return { text: `Online payment isn’t available for this company yet, so the payment page wasn’t opened and nothing was charged.${reserved}`, words: null };
  }
  if (code === "DEPENDENCY_UNAVAILABLE") return { text: unavailable, words: null };
  if (code === "CAPABILITY_DISABLED") {
    const reasoned = refusalReasons(error).length > 0 ? reasonedRefusal(error, company, "this invoice can’t be paid right now.") : null;
    return { text: reasoned ?? unavailable, words: null };
  }
  if (code === "READ_ONLY") {
    return { text: reasonedRefusal(error, company, "this invoice can’t be paid right now.") ?? "This invoice can’t be paid right now.", words: null };
  }
  if (code === "OWNER_REQUIRED") return { text: `Only the owner of ${companyInside(company)} can pay its invoices.`, words: null };
  if (status === 429 || code === "RATE_LIMITED") return { text: `Too many attempts. Try again in ${formatWait(refusalRetryAfter(error))}.`, words: null };
  if (unanswered(error)) return { text: "Taska couldn’t open the payment page. Press Pay again — it won’t create a second payment.", words: message || null };
  return { text: "Taska couldn’t open the payment page.", words: isB2bErrorCode(code) ? null : message || null };
}

/**
 * The refusals after which the attempt's key is never sent again
 * (api-contract-guard §2; release-reviewer N4): definitive answers before
 * anything was created — 403 `OWNER_REQUIRED`, `CAPABILITY_DISABLED`,
 * `READ_ONLY`; 409 `INVALID_STATE`, `IDEMPOTENCY_CONFLICT`; 503
 * `POLICY_NOT_CONFIGURED` — so the next Pay is a fresh key. A transport loss,
 * a 5xx, a 408, a 429 and a 503 `DEPENDENCY_UNAVAILABLE` keep it: Pay again
 * sends the same key.
 */
export function closesAttempt(error: unknown): boolean {
  const code = refusalCode(error);
  return (
    code === "OWNER_REQUIRED" ||
    code === "CAPABILITY_DISABLED" ||
    code === "READ_ONLY" ||
    code === "INVALID_STATE" ||
    code === "IDEMPOTENCY_CONFLICT" ||
    code === "POLICY_NOT_CONFIGURED"
  );
}
