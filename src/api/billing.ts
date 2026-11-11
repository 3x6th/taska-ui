import { toMoney, toSubscription, type AutopayState, type Money, type Subscription } from "./tenants";

/*
 * A company's invoices and their hosted checkout (TAS-513), on the B2B
 * blueprint's routes (`docs/contract/b2b/b2b-openapi.yaml` at develop
 * `43d6c89d`: `listInvoices`, `getInvoice`, `createCheckout`, `getCheckout`),
 * none of which the stand serves (docs/ai/API-DIVERGENCE.md «TAS-513»). Every
 * field is read as optional and every enum as a known value or the server's
 * own string (TAS-173); money stays a string of minor units.
 *
 * api-contract-guard's pre-build design §1, with its addendum: no
 * `createInvoice` here (the INITIAL invoice of a paid company is the
 * server's to issue, A53), and **only server settlement is payment**: neither a
 * checkout's `SUCCEEDED` nor anything in a return address means paid —
 * `Invoice.state = PAID` does (contracts.md, «Checkout redirect/callback browser
 * success не доказательство»).
 */

/** `Invoice.purpose`. */
export const INVOICE_PURPOSES = ["INITIAL", "RENEWAL", "PLAN_CHANGE"] as const;
export type InvoicePurpose = (typeof INVOICE_PURPOSES)[number] | (string & {});

/** `Invoice.state`. */
export const INVOICE_STATES = ["DRAFT", "OPEN", "PARTIALLY_PAID", "PAID", "EXPIRED", "VOID"] as const;
export type InvoiceState = (typeof INVOICE_STATES)[number] | (string & {});

/** `Invoice.paymentMethod`. */
export const PAYMENT_METHODS = ["PSP", "WIRE"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number] | (string & {});

/** `Checkout.state` — no CANCELLED: a cancel stays PENDING until `expiresAt` (A56). */
export const CHECKOUT_STATES = ["CREATED", "PENDING", "UNKNOWN", "SUCCEEDED", "FAILED", "EXPIRED"] as const;
export type CheckoutState = (typeof CHECKOUT_STATES)[number] | (string & {});

/** `CheckoutRequest.returnTarget`: where the payment page is meant to bring the owner back to. */
export type ReturnTarget = "BILLING" | "CREATION";

/**
 * A wire invoice's bank details (`WireInstructions`, TAS-514, api-contract-guard
 * §2): all five as the server sent them — verbatim, no case change, no IBAN
 * check, never derived from another field — or none at all. Held in memory for
 * the page that draws them and never logged.
 */
export interface WireInstructions {
  beneficiaryName: string;
  iban: string;
  bic: string;
  bankName: string;
  reference: string;
}

/**
 * One `Invoice` as the list carries it (api-contract-guard §1, TAS-514 §2): the
 * facts the screens draw and, on a wire invoice in euros, its bank details —
 * `wireInstructions`, the setup card's source. `buyer`, `seller`, `lines` and
 * `fxQuote` are **not** on this shape: they are the detail's
 * (`InvoiceDetail`, `getInvoice`), so a list row never carries a snapshot.
 */
export interface Invoice {
  id: string;
  tenantId: string | null;
  number: string | null;
  purpose: InvoicePurpose | null;
  state: InvoiceState | null;
  planVersionId: string | null;
  total: Money | null;
  allocated: Money | null;
  remaining: Money | null;
  matchedUnallocated: Money | null;
  issuedAt: string | null;
  dueAt: string | null;
  paymentMethod: PaymentMethod | null;
  /** The entity version, a decimal string. */
  version: string | null;
  replacesInvoiceId: string | null;
  /** Only on a WIRE invoice in EUR, and only with all five details present (§2); otherwise `null`. */
  wireInstructions: WireInstructions | null;
}

/** `BillingAddress`, every part optional: an absent one is skipped where it is drawn. */
export interface BillingAddress {
  /** ISO 3166-1 alpha-2, as sent. */
  country: string | null;
  postalCode: string | null;
  city: string | null;
  line1: string | null;
  line2: string | null;
}

/** `BuyerDetails` as the invoice was issued with it — a snapshot, never merged with the company's current data. */
export interface BuyerSnapshot {
  /** BUSINESS, CONSUMER, or the server's own string — never printed. */
  kind: string | null;
  name: string | null;
  email: string | null;
  address: BillingAddress | null;
  taxId: string | null;
}

/** `SellerSnapshot`, as the invoice was issued with it. */
export interface SellerSnapshot {
  legalName: string | null;
  registrationId: string | null;
  taxId: string | null;
  address: BillingAddress | null;
}

/** `TaxLine` without `rate` — its meaning («21» or «0.21») is not settled, so it is not kept (A84). */
export interface TaxLine {
  label: string | null;
  amount: Money | null;
}

/** `InvoiceLine` as sent: nothing recomputed and nothing checked (§2). */
export interface InvoiceLine {
  description: string | null;
  quantity: number | null;
  net: Money | null;
  taxes: TaxLine[];
  total: Money | null;
}

/** `FxQuote`'s facts — the rate verbatim; no converted figure is ever derived from it (§2). */
export interface FxQuoteFacts {
  baseCurrency: string | null;
  quoteCurrency: string | null;
  rate: string | null;
  source: string | null;
  observedAt: string | null;
}

/**
 * `getInvoice`'s answer (TAS-514 §1, §2): the list's `Invoice` and the
 * invoice's own snapshots — the buyer and the seller as they were at issuance,
 * its lines and its FX quote. Never the coverage period (not on the wire, A82).
 */
export interface InvoiceDetail extends Invoice {
  buyer: BuyerSnapshot | null;
  seller: SellerSnapshot | null;
  /** `null` when the answer carried no list of lines. */
  lines: InvoiceLine[] | null;
  fxQuote: FxQuoteFacts | null;
}

/** `InvoicePage`, as sent: `nextCursor` absent at the end. */
export interface InvoicePage {
  items: Invoice[];
  nextCursor: string | null;
}

/**
 * The hosted payment page's address (`Checkout.redirectUrl`) — **a secret**,
 * returned only to the current owner and never payment evidence (the
 * blueprint's own words). Kept in a private field: the one thing anybody can
 * do with it is go there, in this tab (`go`). It never renders, never logs and
 * never serialises — `String(redirect)`, `JSON.stringify` and a template
 * literal all read «[redacted]» — so it cannot reach the DOM, a console or
 * `localStorage` by accident (api-contract-guard §1, art-director B4).
 */
export class CheckoutRedirect {
  readonly #url: string;

  /** Only `toCheckout` makes one, from an address it has accepted. */
  constructor(url: string) {
    this.#url = url;
  }

  /** The payment page in this tab — `assign`, not `replace`, so Back returns here. */
  go(location: Pick<Location, "assign"> = window.location): void {
    location.assign(this.#url);
  }

  toString(): string {
    return "[redacted]";
  }

  toJSON(): string {
    return "[redacted]";
  }
}

/** One `Checkout`: `redirect` is `null` when the answer carried no address this build accepts. */
export interface Checkout {
  id: string;
  invoiceId: string | null;
  state: CheckoutState | null;
  expiresAt: string | null;
  redirect: CheckoutRedirect | null;
}

/**
 * Which payment-page addresses a build accepts. The REST build: `https:` and
 * nothing else — no provider host is named here. The mock: its own origin
 * too, for its stand-in page (`/mock-checkout/{token}`), and only there.
 */
export type RedirectPolicy = (url: URL) => boolean;

export const httpsOnly: RedirectPolicy = (url) => url.protocol === "https:";

const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const DECIMAL = /^(0|[1-9][0-9]{0,18})$/;

const instant = (value: unknown): string | null => {
  const at = text(value);
  return at === null || Number.isNaN(Date.parse(at)) ? null : at;
};

const objectOf = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

/**
 * `wireInstructions` (§2): kept only on a WIRE invoice whose total is in EUR,
 * and only when all five are non-empty strings — otherwise none of them, never
 * a part of the set. Verbatim: no trim, no case change, no IBAN check.
 */
function toWireInstructions(wire: unknown, paymentMethod: string | null, total: Money | null): WireInstructions | null {
  const row = objectOf(wire);
  if (row === null || paymentMethod !== "WIRE" || total?.currency !== "EUR") return null;
  const beneficiaryName = text(row.beneficiaryName);
  const iban = text(row.iban);
  const bic = text(row.bic);
  const bankName = text(row.bankName);
  const reference = text(row.reference);
  if (beneficiaryName === null || iban === null || bic === null || bankName === null || reference === null) return null;
  return { beneficiaryName, iban, bic, bankName, reference };
}

/** One wire `Invoice`, or `null` for a row without a usable `id`. */
export function toInvoice(wire: unknown): Invoice | null {
  if (typeof wire !== "object" || wire === null) return null;
  const row = wire as Record<string, unknown>;
  const id = text(row.id);
  if (id === null) return null;
  const total = toMoney(row.total);
  const paymentMethod = text(row.paymentMethod);
  return {
    id,
    tenantId: text(row.tenantId),
    number: text(row.number),
    purpose: text(row.purpose),
    state: text(row.state),
    planVersionId: text(row.planVersionId),
    total,
    allocated: toMoney(row.allocated),
    remaining: toMoney(row.remaining),
    matchedUnallocated: toMoney(row.matchedUnallocated),
    issuedAt: instant(row.issuedAt),
    dueAt: instant(row.dueAt),
    paymentMethod,
    version: typeof row.version === "string" && DECIMAL.test(row.version) ? row.version : null,
    replacesInvoiceId: text(row.replacesInvoiceId),
    wireInstructions: toWireInstructions(row.wireInstructions, paymentMethod, total),
  };
}

function toAddress(wire: unknown): BillingAddress | null {
  const row = objectOf(wire);
  if (row === null) return null;
  return {
    country: text(row.country),
    postalCode: text(row.postalCode),
    city: text(row.city),
    line1: text(row.line1),
    line2: text(row.line2),
  };
}

function toBuyer(wire: unknown): BuyerSnapshot | null {
  const row = objectOf(wire);
  if (row === null) return null;
  return { kind: text(row.kind), name: text(row.name), email: text(row.email), address: toAddress(row.address), taxId: text(row.taxId) };
}

function toSeller(wire: unknown): SellerSnapshot | null {
  const row = objectOf(wire);
  if (row === null) return null;
  return { legalName: text(row.legalName), registrationId: text(row.registrationId), taxId: text(row.taxId), address: toAddress(row.address) };
}

function toLine(wire: unknown): InvoiceLine | null {
  const row = objectOf(wire);
  if (row === null) return null;
  const quantity = typeof row.quantity === "number" && Number.isInteger(row.quantity) && row.quantity >= 1 ? row.quantity : null;
  const taxes = Array.isArray(row.taxes)
    ? row.taxes
        .map((tax): TaxLine | null => {
          const item = objectOf(tax);
          return item === null ? null : { label: text(item.label), amount: toMoney(item.amount) };
        })
        .filter((tax): tax is TaxLine => tax !== null)
    : [];
  return { description: text(row.description), quantity, net: toMoney(row.net), taxes, total: toMoney(row.total) };
}

function toFxQuote(wire: unknown): FxQuoteFacts | null {
  const row = objectOf(wire);
  if (row === null) return null;
  return {
    baseCurrency: text(row.baseCurrency),
    quoteCurrency: text(row.quoteCurrency),
    rate: text(row.rate),
    source: text(row.source),
    observedAt: instant(row.observedAt),
  };
}

/** `getInvoice`'s answer (§2): the list's fields and the snapshots, each as sent; `null` without a usable `id`. */
export function toInvoiceDetail(wire: unknown): InvoiceDetail | null {
  const invoice = toInvoice(wire);
  if (invoice === null) return null;
  const row = wire as Record<string, unknown>;
  return {
    ...invoice,
    buyer: toBuyer(row.buyer),
    seller: toSeller(row.seller),
    lines: Array.isArray(row.lines) ? row.lines.map(toLine).filter((line): line is InvoiceLine => line !== null) : null,
    fxQuote: toFxQuote(row.fxQuote),
  };
}

/** `InvoicePage` in the server's order — the screen orders it (DESIGN.md §4.41). */
export function toInvoicePage(wire: unknown): InvoicePage {
  const page = typeof wire === "object" && wire !== null ? (wire as Record<string, unknown>) : {};
  const items = Array.isArray(page.items)
    ? page.items.map(toInvoice).filter((invoice): invoice is Invoice => invoice !== null)
    : [];
  return { items, nextCursor: text(page.nextCursor) };
}

/**
 * One wire `Checkout`, or `null` without a usable `id`. The address is kept
 * only when `policy` accepts it — and then only inside `CheckoutRedirect`.
 */
export function toCheckout(wire: unknown, policy: RedirectPolicy = httpsOnly): Checkout | null {
  if (typeof wire !== "object" || wire === null) return null;
  const row = wire as Record<string, unknown>;
  const id = text(row.id);
  if (id === null) return null;
  const address = text(row.redirectUrl);
  let redirect: CheckoutRedirect | null = null;
  if (address !== null && address.length <= 2048) {
    try {
      const url = new URL(address);
      if (policy(url)) redirect = new CheckoutRedirect(url.href);
    } catch {
      redirect = null;
    }
  }
  return {
    id,
    invoiceId: text(row.invoiceId),
    state: text(row.state),
    expiresAt: instant(row.expiresAt),
    redirect,
  };
}

/* ------------------------------ plan change, renewal and automatic payments (TAS-515) */

/*
 * The blueprint's four subscription commands (`changeSubscriptionPlan`,
 * `cancelSubscriptionRenewal`, `resumeSubscriptionRenewal`,
 * `setAutopayConsent`, `b2b-openapi.yaml` at develop `43d6c89d`), none of them
 * on the stand (docs/ai/API-DIVERGENCE.md «TAS-515»). api-contract-guard's
 * pre-build ruling §1: every field of an answer optional, every enum open; the
 * answer's `subscription` is **never** cached and never the next `If-Match` —
 * a same-key replay returns a stored snapshot, so a screen invalidates and
 * reads the subscription again. Nothing here is a quote: the effect and the
 * date are the server's, known only once it has answered.
 */

/** `PlanChange.effect`. */
export const PLAN_CHANGE_EFFECTS = ["IMMEDIATE", "AFTER_PAYMENT", "NEXT_PERIOD"] as const;
export type PlanChangeEffect = (typeof PLAN_CHANGE_EFFECTS)[number] | (string & {});

/**
 * `ChangePlanRequest` without `confirmed` (the transport adds it): `currency`
 * is the target's own `price.currency` — a plan with no readable price is not
 * offered — and `paymentMethod` is always `PSP`, Free included (guard Q12).
 */
export interface ChangePlanInput {
  planVersionId: string;
  currency: "EUR" | "USD";
  paymentMethod: "PSP";
}

/** `PlanChange` as the blueprint has it, narrowed and every field optional. */
export interface PlanChange {
  /** For its `tenantId` only — never written into a cache, never an `If-Match`. */
  subscription: Subscription | null;
  effect: PlanChangeEffect | null;
  /** Present only when the command issued an invoice (develop never sets it, A62). */
  invoiceId: string | null;
  effectiveAt: string | null;
  operationId: string | null;
}

/**
 * The `AutopayMandate` answer means only «2xx» (guard §1): its `version`,
 * `ownerId`, consent snapshot and payment method are never kept — the mandate's
 * version is not the subscription's, and nothing may take it for one.
 */
export interface AutopayConsentResult {
  state: AutopayState | null;
}

/**
 * A 2xx whose body is not an object — no answer about the command at all
 * (guard §1): the same intent stays open, nothing is drawn, the screen reads
 * the subscription again. Its message is empty and it carries no status,
 * code or request id, so `apiErrorFacts` finds none and no client words are
 * shown as the server's.
 */
export class UnreadableAnswerError extends Error {
  constructor() {
    super("");
    this.name = "UnreadableAnswerError";
  }
}

/** One wire `PlanChange`, or `null` for a body that is not an object. */
export function toPlanChange(wire: unknown): PlanChange | null {
  if (typeof wire !== "object" || wire === null || Array.isArray(wire)) return null;
  const row = wire as Record<string, unknown>;
  const subscription = typeof row.subscription === "object" && row.subscription !== null ? toSubscription(row.subscription) : null;
  return {
    subscription,
    effect: text(row.effect),
    invoiceId: text(row.invoiceId),
    effectiveAt: instant(row.effectiveAt),
    operationId: text(row.operationId),
  };
}

/** One wire `AutopayMandate`, kept as its state only; `null` for a body that is not an object. */
export function toAutopayConsentResult(wire: unknown): AutopayConsentResult | null {
  if (typeof wire !== "object" || wire === null || Array.isArray(wire)) return null;
  return { state: text((wire as Record<string, unknown>).state) };
}

/** The largest page `listInvoices` and `listRefunds` serve (`Limit.maximum`). */
export const INVOICE_PAGE_MAX = 100;

/** Every item of a keyset list, all pages, as `readAllTenants` reads the company list — a repeated cursor ends it. */
async function readAllPages<T>(list: (params: { cursor?: string; limit?: number }) => Promise<{ items: T[]; nextCursor: string | null }>): Promise<T[]> {
  const items: T[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 50; page += 1) {
    const answer = await list(cursor === undefined ? { limit: INVOICE_PAGE_MAX } : { cursor, limit: INVOICE_PAGE_MAX });
    items.push(...answer.items);
    if (answer.nextCursor === null || seen.has(answer.nextCursor)) break;
    seen.add(answer.nextCursor);
    cursor = answer.nextCursor;
  }
  return items;
}

/** Every invoice, all pages. */
export const readAllInvoices = (list: (params: { cursor?: string; limit?: number }) => Promise<InvoicePage>): Promise<Invoice[]> => readAllPages(list);

/* ------------------------------------------- refunds, durations, the document (TAS-514) */

/*
 * The blueprint's `listRefunds`, `getTenantCapabilities` and
 * `downloadInvoiceDocument` (`b2b-openapi.yaml` at develop `43d6c89d`), none of
 * them on the stand (docs/ai/API-DIVERGENCE.md «TAS-514»). api-contract-guard's
 * pre-build ruling §1 with its addendum and the orchestrator's decision 6: every
 * field optional, every enum open. **A refund is never tied to an invoice** —
 * the contract has no `Refund.invoiceId` (A81) — and the operator's own fields
 * stay out, but for `sendDueAt` and `decidedAt`.
 */

/** `Refund.state`. */
export const REFUND_STATES = ["REQUESTED", "APPROVED", "SUBMITTING", "UNKNOWN", "CONFIRMED", "FAILED", "REJECTED"] as const;
export type RefundState = (typeof REFUND_STATES)[number] | (string & {});

/** `RefundReasonCode`. */
export const REFUND_REASONS = [
  "EXCESS",
  "LATE_FIRST_PAYMENT",
  "CLOSED_CREATION",
  "INCOMPLETE_BANK_PAYMENT",
  "DUPLICATE_PAYMENT",
  "BILLING_ERROR",
  "SERVICE_FAILURE",
  "MANDATORY",
] as const;
export type RefundReason = (typeof REFUND_REASONS)[number] | (string & {});

/** `Refund.kind`. */
export type RefundKind = "SUBSCRIPTION_FULL" | "UNALLOCATED_RETURN" | (string & {});

/**
 * One `Refund`, narrowed (decision 6): no `paymentId` (an admin-only fact), no
 * `version` (no owner write), none of the operator's evidence, calendar and
 * SLA fields — but `sendDueAt` («Taska aims to send it by», only where a
 * screen may say it), `decidedAt` and `submittedAt` (TAS-516: the row's history,
 * each step only from its own field).
 */
export interface Refund {
  id: string;
  tenantId: string | null;
  kind: RefundKind | null;
  state: RefundState | null;
  amount: Money | null;
  reasonCode: RefundReason | null;
  sourceMethod: PaymentMethod | null;
  requestedAt: string | null;
  confirmedAt: string | null;
  feeBearer: string | null;
  sendDueAt: string | null;
  decidedAt: string | null;
  submittedAt: string | null;
}

/** `RefundPage`, as sent: `nextCursor` absent at the end. */
export interface RefundPage {
  items: Refund[];
  nextCursor: string | null;
}

/** One wire `Refund`, or `null` for a row without a usable `id`. */
export function toRefund(wire: unknown): Refund | null {
  const row = objectOf(wire);
  if (row === null) return null;
  const id = text(row.id);
  if (id === null) return null;
  return {
    id,
    tenantId: text(row.tenantId),
    kind: text(row.kind),
    state: text(row.state),
    amount: toMoney(row.amount),
    reasonCode: text(row.reasonCode),
    sourceMethod: text(row.sourceMethod),
    requestedAt: instant(row.requestedAt),
    confirmedAt: instant(row.confirmedAt),
    feeBearer: text(row.feeBearer),
    sendDueAt: instant(row.sendDueAt),
    decidedAt: instant(row.decidedAt),
    // From its own field only (T3; guard build review, deviation 2) — never filtered by another.
    submittedAt: instant(row.submittedAt),
  };
}

/** A list's `{items: []}` body (TAS-516, guard F1): a 2xx that is not one is no answer, never an empty list. */
function pageBody(wire: unknown): Record<string, unknown> & { items: unknown[] } {
  const page = objectOf(wire);
  if (page === null || !Array.isArray(page.items)) throw new UnreadableAnswerError();
  return page as Record<string, unknown> & { items: unknown[] };
}

/** `RefundPage` in the server's order — the screen orders it. A body with no `items` array is no answer (F1). */
export function toRefundPage(wire: unknown): RefundPage {
  const page = pageBody(wire);
  return { items: page.items.map(toRefund).filter((refund): refund is Refund => refund !== null), nextCursor: text(page.nextCursor) };
}

/** Every refund, all pages. */
export const readAllRefunds = (list: (params: { cursor?: string; limit?: number }) => Promise<RefundPage>): Promise<Refund[]> => readAllPages(list);

/* ------------------------------------------------------ disputes (TAS-516) */

/*
 * The blueprint's `listDisputes` (`b2b-openapi.yaml` at develop `43d6c89d`), not
 * on the stand (docs/ai/API-DIVERGENCE.md «TAS-516», TAS-490). api-contract-guard's
 * pre-build ruling §3: **no dispute names an invoice or an amount** (A91), and no
 * row is ever joined to `Tenant.restrictions` — the two say different things.
 * `paymentId`, `version` and `confirmedMoneyFactId` stay out: nothing owner-facing
 * may hold a payment id (A83, A89).
 */

/** `Dispute.state`. */
export type DisputeState = "OPEN" | "NEEDS_REVIEW" | "WON" | "LOST" | "WITHDRAWN" | (string & {});

/** `Dispute.finalOutcome`. */
export type DisputeOutcome = "WON" | "WITHDRAWN_CONFIRMED" | "LOST_FULL_REFUND" | "LOST_PARTIAL_COVERAGE_REVOKED" | (string & {});

/** One `Dispute`, narrowed: the outcome is kept only when it matches its state (§3's pair rule, `toDispute`). */
export interface Dispute {
  id: string;
  tenantId: string | null;
  state: DisputeState | null;
  finalOutcome: DisputeOutcome | null;
  openedAt: string | null;
  resolvedAt: string | null;
}

/** `DisputePage`, as sent: `nextCursor` absent at the end. */
export interface DisputePage {
  items: Dispute[];
  nextCursor: string | null;
}

/** The blueprint's `oneOf`: a terminal state and its outcome (§3) — anything else is said by the state's word alone. */
const outcomeMatches = (state: string | null, outcome: string | null) =>
  outcome !== null && ((state === "WON" && outcome === "WON") || (state === "WITHDRAWN" && outcome === "WITHDRAWN_CONFIRMED") || (state === "LOST" && outcome.startsWith("LOST_")));

/** One wire `Dispute`, or `null` for a row without a usable `id`. */
export function toDispute(wire: unknown): Dispute | null {
  const row = objectOf(wire);
  if (row === null) return null;
  const id = text(row.id);
  if (id === null) return null;
  const state = text(row.state);
  const outcome = text(row.finalOutcome);
  return {
    id,
    tenantId: text(row.tenantId),
    state,
    finalOutcome: outcomeMatches(state, outcome) ? outcome : null,
    openedAt: instant(row.openedAt),
    resolvedAt: instant(row.resolvedAt),
  };
}

/** `DisputePage` in the server's order — the screen orders it. A body with no `items` array is no answer (F1). */
export function toDisputePage(wire: unknown): DisputePage {
  const page = pageBody(wire);
  return { items: page.items.map(toDispute).filter((dispute): dispute is Dispute => dispute !== null), nextCursor: text(page.nextCursor) };
}

/** Every dispute, all pages. */
export const readAllDisputes = (list: (params: { cursor?: string; limit?: number }) => Promise<DisputePage>): Promise<Dispute[]> => readAllPages(list);

/** `WIRE_RECONCILIATION_TARGET_SECONDS`'s bounds (develop `0003-platform-flags.sql`). */
export const WIRE_RECONCILIATION_TARGET_MAX_S = 31_536_000;

/**
 * `Capabilities`, durations only (guard §1, Q3): the company, when the answer
 * stops being current, and the one duration a screen says — the wire
 * reconciliation target, an integer 1..31 536 000 seconds, else `null`. Never
 * `items`, and **no default**: without it a sentence says no number.
 */
export interface CompanyDurations {
  tenantId: string | null;
  wireReconciliationTargetSeconds: number | null;
  expiresAt: string | null;
}

/** A wire `Capabilities`, or `null` for a body that is not an object. */
export function toCompanyDurations(wire: unknown): CompanyDurations | null {
  const row = objectOf(wire);
  if (row === null) return null;
  const durations = objectOf(row.durationsSeconds);
  const target = durations?.WIRE_RECONCILIATION_TARGET_SECONDS;
  return {
    tenantId: text(row.tenantId),
    wireReconciliationTargetSeconds:
      typeof target === "number" && Number.isInteger(target) && target >= 1 && target <= WIRE_RECONCILIATION_TARGET_MAX_S ? target : null,
    expiresAt: instant(row.expiresAt),
  };
}

/**
 * What the document route answered, before it is accepted (the session layer
 * decides): its `Content-Type`, its `Content-Disposition` when the browser
 * lets it be read (the gateway does not expose it to CORS, A79), and the bytes.
 */
export interface DocumentAnswer {
  contentType: string | null;
  disposition: string | null;
  body: Blob;
}

/**
 * An invoice's PDF (TAS-514 §3, decision 5): the bytes, only ever handed to
 * `saveBlob` — never cached, stored or opened on this origin — and a file name
 * from a readable `Content-Disposition`, sanitised, or `null`.
 */
export interface InvoiceDocument {
  blob: Blob;
  fileName: string | null;
}

/** `application/pdf`, with or without parameters — nothing else is a document (§3). */
export const isPdfType = (contentType: string | null) => contentType !== null && /^\s*application\/pdf\s*(;.*)?$/i.test(contentType);

const UNSAFE_IN_FILE_NAME = /[\p{Cc}<>:"/\\|?*]/gu;

/**
 * The file name a `Content-Disposition` names, sanitised to a base name ending
 * `.pdf` (decision 5): `filename*` (RFC 5987) before `filename`, the last path
 * segment only, no control or reserved character, no leading dot, at most 120
 * characters. `null` when none is readable or what is left does not end `.pdf`.
 */
export function documentFileName(disposition: string | null): string | null {
  if (disposition === null) return null;
  let raw: string | null = null;
  const extended = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(disposition);
  if (extended) {
    try {
      raw = decodeURIComponent(extended[2].trim());
    } catch {
      raw = null;
    }
  }
  if (raw === null) {
    const plain = /filename\s*=\s*(?:"((?:\\.|[^"\\])*)"|([^;]+))/i.exec(disposition);
    raw = plain ? (plain[1] !== undefined ? plain[1].replace(/\\(.)/g, "$1") : plain[2].trim()) : null;
  }
  if (raw === null) return null;
  const base = raw.split(/[/\\]/).pop() ?? "";
  const name = base.replace(UNSAFE_IN_FILE_NAME, "").trim().replace(/^\.+/, "").trim();
  if (name.length > 120 || !/^.+\.pdf$/i.test(name)) return null;
  return name;
}
