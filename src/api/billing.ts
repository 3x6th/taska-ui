import { toMoney, type Money } from "./tenants";

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
 * One `Invoice`, narrowed (api-contract-guard §1): `buyer`, `seller`, `lines`,
 * `fxQuote` and `wireInstructions` are **never read** — financial details stay
 * out of the cache; lines and documents are TAS-514. The object has no field
 * for any of them, so no screen can reach one.
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

/** One wire `Invoice`, or `null` for a row without a usable `id`. */
export function toInvoice(wire: unknown): Invoice | null {
  if (typeof wire !== "object" || wire === null) return null;
  const row = wire as Record<string, unknown>;
  const id = text(row.id);
  if (id === null) return null;
  return {
    id,
    tenantId: text(row.tenantId),
    number: text(row.number),
    purpose: text(row.purpose),
    state: text(row.state),
    planVersionId: text(row.planVersionId),
    total: toMoney(row.total),
    allocated: toMoney(row.allocated),
    remaining: toMoney(row.remaining),
    matchedUnallocated: toMoney(row.matchedUnallocated),
    issuedAt: instant(row.issuedAt),
    dueAt: instant(row.dueAt),
    paymentMethod: text(row.paymentMethod),
    version: typeof row.version === "string" && DECIMAL.test(row.version) ? row.version : null,
    replacesInvoiceId: text(row.replacesInvoiceId),
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

/** The largest page `listInvoices` serves (`Limit.maximum`). */
export const INVOICE_PAGE_MAX = 100;

/** Every invoice, all pages, as `readAllTenants` reads the company list — a repeated cursor ends it. */
export async function readAllInvoices(list: (params: { cursor?: string; limit?: number }) => Promise<InvoicePage>): Promise<Invoice[]> {
  const invoices: Invoice[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 50; page += 1) {
    const answer = await list(cursor === undefined ? { limit: INVOICE_PAGE_MAX } : { cursor, limit: INVOICE_PAGE_MAX });
    invoices.push(...answer.items);
    if (answer.nextCursor === null || seen.has(answer.nextCursor)) break;
    seen.add(answer.nextCursor);
    cursor = answer.nextCursor;
  }
  return invoices;
}
