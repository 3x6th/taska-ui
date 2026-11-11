import { apiErrorFacts, type FieldViolation } from "../errors";
import type { LoginInput } from "../TaskaApi";
import {
  isKnownMembershipRole,
  isKnownProjectGrantRole,
  invitationEmailProblem,
  sameInvitationEmail,
  trimInvitationEmail,
  type CreateInvitationInput,
  type KnownMembershipRole,
  type ListCompanyPageParams,
} from "../tenantMembers";
import { tenantNameProblem, type CreateTenantInput, type ListBillingPlansParams, type ListTenantsParams } from "../tenants";
import type { DocumentAnswer } from "../billing";
import type { B2bTransport } from "../webSession";
import { MOCK_ACCOUNT_IDS, MOCK_PROJECT_IDS, MockTaskaStore, type MockTenantSeed } from "./MockTaskaApi";

/*
 * The companies build's mock server (TAS-500, api-contract-guard §7, B7): the
 * B2B blueprint's session routes, and the session check in front of every data
 * call, enforced — not a flag that says somebody signed in. A data call's
 * bearer resolves to a session, the session to a company, and the company to
 * its own `MockTaskaStore`; a credential of the wrong kind, an expired or
 * revoked one, a suspended membership or a paused company is refused here the
 * way the blueprint says the gateway will refuse it.
 *
 * **Shared by every tab** through `localStorage` `taska.mockServer.v8`: the
 * companies, memberships, sessions and tokens — since TAS-501 the FREE
 * ledger, the creations' operations and their durable receipts, since TAS-502
 * the invitations, the seat limits, the membership generation and the member
 * writes' durable receipts, since TAS-504 each company's subscription, and
 * since TAS-512 each company's entitlement version, its scheduled plan, the
 * quota kinds it is over and every project's lifetime issue counter, and
 * since TAS-513 each company's invoices and their checkouts, and since TAS-515
 * each subscription's plan change, renewal calendar and mandate, and the
 * subscription commands' durable receipts, and since TAS-514 each invoice's
 * snapshots as issued, the bank receipts an admin records and the refunds —
 * read and written on every operation, so a second tab — or a duplicated one
 * — meets the same server. (v1 was TAS-500's, v2 TAS-501's, v3 TAS-502's, v4
 * TAS-504's, v5 TAS-512's, v6 TAS-513's, v7 TAS-515's; each bump re-seeds,
 * signing every mock account out once.)
 * Each company's projects and issues are this page's own, in memory, as
 * today's mock's are: they reset with a reload — the lifetime counters do not.
 *
 * This narrows docs/ai/API-DIVERGENCE.md's "The mock has a session flag but no
 * session enforcement" for the companies build only; today's build's mock is
 * untouched and enforces nothing.
 */

export const MOCK_SERVER_KEY = "taska.mockServer.v8";

/**
 * `localStorage` key for the server's test hooks, as JSON — the seam
 * `taska.mockAuthMethods` set (src/api/mock/mockAuthFixtures.ts): the e2e suite
 * sets it with `page.addInitScript` or `page.evaluate`, a person clicking
 * through sets it in the console, and it is read on every operation.
 *
 * - `suspend`: memberships answered as `SUSPENDED` whatever their state, as
 *   `[{"tenantId": "…", "userId": "…"}]` — take one out and it is active again;
 * - `accessTtlSeconds`: the lifetime of every access token issued from now on
 *   (the blueprint's is 60–900; default 900), to make renewal happen;
 * - `delayMs`: extra latency per operation, keyed by a blueprint operation id
 *   (`startWebSession`, `refreshWebSession`, `listTenants`,
 *   `createTenantSession`, `revokeTenantSession`) or a `TaskaApi` method name;
 * - `contentReadUnderRestriction`: the global flag below for this browser —
 *   `false` refuses every content read of a paused or blocked company with 403
 *   `CAPABILITY_DISABLED` and its restrictions (ask A2c). A company awaiting its
 *   first payment refuses them whatever the flag says (TAS-501, B5).
 *
 * Creating a company (TAS-501, api-contract-guard §9):
 *
 * - `clockOffsetMs`: moves the **lifecycle clock** — deadlines, provisioning,
 *   new companies' `createdAt` — and nothing else (tokens keep the real one),
 *   so `+ 11 days` closes Stark Industries on the next read;
 * - `provisioning`: `{stepMs, outcome, failureCode}` — an operation is PENDING
 *   for `stepMs` (default 1200), RUNNING for as long again, then `outcome`
 *   (`SUCCEEDED` by default, or `FAILED` / `MANUAL_REVIEW`); a FREE company
 *   turns ACTIVE when its operation succeeds and stays PROVISIONING otherwise;
 * - `refuseNext`: `{[operation]: {status, code, reasons?, retryAfterSeconds?}}`,
 *   the next call of that operation refused so — once, then forgotten (429,
 *   503, 422, 409 PAYMENT_PENDING…);
 * - `loseAnswer`: `["createTenant"]` — the next creation commits and then
 *   answers like a dropped connection, once (the reload replays it); since
 *   TAS-502 `"leaveTenant"` too — the leave is applied, its answer lost;
 * - `firstPaymentConfirmed`: `[tenantId]` — an AWAITING_PAYMENT company opens
 *   (stands in for TAS-513);
 * - `latePaymentConfirmed`: `[tenantId]` — an AUTO_CLOSED company opens
 *   (D216); never an OWNER_CANCELLED one.
 *
 * A company's members and invitations (TAS-502, api-contract-guard §7):
 *
 * - `refuseNext` and `delayMs` take the new operation ids too
 *   (`listTenantMembers`, `setTenantMemberRole`, `setTenantMemberState`,
 *   `removeTenantMember`, `leaveTenant`, `listTenantInvitations`,
 *   `createTenantInvitation`, `resendTenantInvitation`,
 *   `revokeTenantInvitation`, `getTenantQuotas`) — `LAST_ADMIN` is reachable
 *   only this way, because every company's owner is an admin the server
 *   protects;
 * - `clockOffsetMs` also expires invitations;
 * - `memberOperationStepMs`: a removal's operation is PENDING for this long,
 *   RUNNING as long again, then `memberOperationOutcome` (`SUCCEEDED` by
 *   default, `FAILED` with `memberOperationFailureCode`, or `MANUAL_REVIEW`);
 *   the default 0 removes at once;
 * - `restrict`: `{[tenantId]: string[]}`, restrictions added to a company for
 *   the member routes only — `PAYMENT_EXPIRED` shows the RECOVERY policy
 *   (remove and revoke allowed, the rest `READ_ONLY`).
 *
 * The company's name, owner and pause (TAS-504, api-contract-guard §6):
 *
 * - `refuseNext`, `delayMs` and `loseAnswer` take `renameTenant`,
 *   `pauseTenant`, `resumeTenant`, `transferTenantOwnership` and
 *   `getSubscription` — a lost command is applied and then answered like a
 *   dropped connection, once;
 * - `platformBlock`: `{[tenantId]: boolean}` — stands in for the platform's
 *   `setPlatformBlock` (GLOBAL_ADMIN): `true` adds `PLATFORM_BLOCK`, `false`
 *   lifts it, a company not named keeps what it has (Hooli is seeded blocked);
 * - `ownerPauseEnabled` (default `true`): `false` refuses a new pause 403
 *   `CAPABILITY_DISABLED` (D93/D94) — never a resume;
 * - `ownershipTransferEnabled` (default `true`): `false` refuses a transfer
 *   403 `CAPABILITY_DISABLED`;
 * - `clockOffsetMs` also ends paid periods: an ACTIVE company whose
 *   `paidThrough` has passed gets `PAYMENT_EXPIRED`, which a resume never
 *   lifts (D131);
 * - `contentReadUnderRestriction: false` closes content — and the members
 *   list with it (DIRECTORY inherits CONTENT_READ, access-matrix.json) — under
 *   a pause or a block only, never under a dispute, an ended period or a quota;
 *   the reader's notifications stay readable. Whether the directory should be
 *   the control plane there instead is ask A42.
 *
 * The company's plan, usage and restrictions (TAS-512, api-contract-guard §5):
 *
 * - `refuseNext`, `delayMs` and `loseAnswer` take `getEntitlement` too, and
 *   `loseAnswer` also `getTenantQuotas`;
 * - `applyPlan`: `{[tenantId]: planVersionId}` — stands in for a plan change
 *   made elsewhere (TAS-483): applied once per value set — the plan swapped,
 *   the seat limit set, the entitlement version moved, and `OVER_QUOTA` set
 *   with every quota kind over its new limit; a FREE plan ends the paid
 *   coverage as develop's Paid→FREE does (TAS-515 F8): CONSENTED automatic
 *   payments go DISABLED, SUSPENDED stay, `renewalCancelled` is kept (A73);
 * - `taskLifetime`: `{[projectId]: n}` — a project's lifetime issue counter set
 *   to `n`, once per value; past a finite `TASK_LIFETIME` the company is
 *   `OVER_QUOTA`;
 * - `paymentDispute`: `{[tenantId]: boolean}` — sets or lifts
 *   `PAYMENT_DISPUTE`; since TAS-515 a dispute switches automatic payments off
 *   (DISABLED), and lifting it never turns them back on (F7).
 *
 * The company's invoices and their hosted checkout (TAS-513,
 * api-contract-guard §5 and its addendum) — **all payment state is here**,
 * none in a screen:
 *
 * - `refuseNext`, `delayMs` and `loseAnswer` take `listInvoices`,
 *   `getInvoice`, `createCheckout` and `getCheckout` — a lost `createCheckout`
 *   has made its checkout, so the same key answers it again;
 * - `checkoutOff`: `{status, code, reasons?}` — every `createCheckout` refused
 *   so for as long as it is set (503 `POLICY_NOT_CONFIGURED`, the stand's
 *   default; 403 `CAPABILITY_DISABLED` with or without `reasons`);
 * - `settlementDelayMs` (default 2500): how long after the provider's success
 *   the server settles — the invoice PAID, the company opened or its paid
 *   period moved on — so a checkout `SUCCEEDED` is seen before `PAID`;
 * - `checkoutTtlMs` (default 30 minutes): a checkout's life; a cancelled one
 *   stays PENDING until then, and is EXPIRED after (A56);
 * - `resolveCheckout`: `{[invoiceId]: "SUCCEEDED" | "FAILED"}` — the provider's
 *   late answer for the invoice's open or UNKNOWN checkout, once per checkout;
 * - `clockOffsetMs` also expires an OPEN invoice at its `dueAt`, and its open
 *   checkouts with it.
 *
 * The company's plan change, renewal and automatic payments (TAS-515,
 * api-contract-guard's pre-build ruling §6) — the owner's commands, each with
 * `If-Match` = `Subscription.version` and a durable receipt per (company,
 * actor, key):
 *
 * - `refuseNext`, `delayMs` and `loseAnswer` take `changeSubscriptionPlan`,
 *   `cancelSubscriptionRenewal`, `resumeSubscriptionRenewal` and
 *   `setAutopayConsent` — a lost command is applied, its answer lost, once;
 * - `autopaySuspended`: `{[tenantId]: true}` — CONSENTED automatic payments
 *   become SUSPENDED (no writer on develop names the event, A69); taking the
 *   hook out never restores them;
 * - `autopayConsentEnabled` (default `true`): `false` refuses
 *   `setAutopayConsent` 403 `CAPABILITY_DISABLED` (the AUTOPAY flag);
 * - `clockOffsetMs` also runs the renewal calendar — a RENEWAL issued 7 days
 *   before `paidThrough`, due at it, only with renewal on and no change
 *   active — and a NEXT_PERIOD change's boundary: paid, the plan switches
 *   there with a month from it; unpaid, the date goes and the plan id stays.
 *
 * The company's bank-transfer invoices, their documents and refunds (TAS-514,
 * api-contract-guard's pre-build ruling §7 with its addendum B17) — **an admin's
 * side, as hooks**: the owner reads no receipt on any route, and nothing here
 * is on `TaskaApi`. Every one is applied once per id and evaluated on every
 * read, like `resolveCheckout`:
 *
 * - `issueMethod`: `{[tenantId | "*"]: "WIRE" | "PSP"}` — the method of the
 *   invoices the server issues from then on, for that company, or with `*` for
 *   any company not named (invented — nothing on the wire says who picks it,
 *   A78); Cyberdyne Systems is seeded WIRE. A WIRE invoice is EUR only and
 *   carries all five bank details; a WIRE first payment is due a week after
 *   issuance, never after the creation deadline;
 * - `wireDetailsVariant: "long"` — wire invoices issued from then on carry a
 *   200-character beneficiary and a 140-character reference (layout review);
 * - `wireReceipts`: `[{id, tenantId, amountMinor, occurredAt?, precision?}]` —
 *   the admin records a bank statement line (`occurredAt` defaults to the
 *   lifecycle clock; `precision` `INSTANT` or `DAY`); nothing the owner reads
 *   changes;
 * - `confirmWire`: `{[receiptId]: invoiceId}` — the admin matches the receipt
 *   to the invoice and confirms it (matching at confirmation, not at record —
 *   invented). Arrived by `dueAt`: short of the rest, matched — PARTIALLY_PAID,
 *   `matchedUnallocated` up, nothing covered; the rest reached, one allocation
 *   of the whole total — PAID, the excess left on the receipt, the period from
 *   the confirmation (a first or resumed month) or from the current end (an
 *   early renewal). Arrived late: a first payment while the creation is still
 *   open — the invoice EXPIRED, nothing activated, a replacement INITIAL
 *   (`replacesInvoiceId`, due a week on, never after the unchanged deadline);
 *   a closed or cancelled creation — a return, except D216 (AUTO_CLOSED, paid
 *   in full by the earlier of due and deadline: it opens); a renewal of a
 *   company neither blocked nor deleted — PAID, a new month from the
 *   confirmation (D247); a plan change, a blocked or deleted company, DAY
 *   precision on the due date, money for an invoice not here — nothing
 *   visible (A88, B09). An invoice already PAID: all of it is a duplicate;
 * - `returnUnallocated`: `[receiptId]` — the admin returns the receipt's whole
 *   unallocated money: one Refund per receipt, REQUESTED, WIRE, fee borne by
 *   Taska, its reason from what happened (EXCESS, LATE_FIRST_PAYMENT,
 *   CLOSED_CREATION, INCOMPLETE_BANK_PAYMENT — only once the invoice has
 *   expired —, DUPLICATE_PAYMENT); never automatic, never coverage;
 * - `refundProgress`: `{[receiptId]: state}` — the receipt's refund moves to
 *   that state (APPROVED and REJECTED decided now, SUBMITTING submitted now);
 *   CONFIRMED gives the money back — the receipt holds nothing and the
 *   invoice's `matchedUnallocated` falls by it;
 * - `evidenceComplete`: `[receiptId]` — the refund's evidence is complete: the
 *   WIRE SLA set, frozen once, `sendDueAt` = `decisionDueAt` five business
 *   dates on, Mon–Fri, the evidence date excluded, the same UTC time (no
 *   holidays, not Madrid's wall clock — invented);
 * - `holdExpiry`: `[invoiceId]` — an OPEN or PARTIALLY_PAID invoice stays as it
 *   is past its `dueAt` (develop's own behaviour: nothing expires there yet);
 * - `documentOff: true` — the document is 503 `POLICY_NOT_CONFIGURED`;
 *   `documentType` — the `Content-Type` it answers with instead of
 *   `application/pdf`;
 * - `reconciliationTargetSeconds`: a number replaces the capabilities' 86 400
 *   seconds; `null` leaves the duration out;
 * - `refuseNext`, `delayMs` and `loseAnswer` take `getInvoiceDocument`,
 *   `listRefunds` and `getTenantCapabilities`;
 * - `clockOffsetMs` also expires a PARTIALLY_PAID invoice at its `dueAt`; its
 *   `matchedUnallocated` stays until its return is CONFIRMED.
 *
 * The stand-in payment page (`/mock-checkout/{token}`, the mock build only)
 * reads its checkout by an opaque token only this server maps back
 * (`mockCheckoutPage`) and reports the provider's outcome
 * (`observeMockCheckout`) — neither is on `TaskaApi`, as a provider webhook is
 * on no gateway route.
 *
 * Everything time- or hook-driven is evaluated on every read of the server's
 * state: there are no timers.
 */
export const MOCK_TENANT_HOOKS_KEY = "taska.mockTenantHooks";

export interface MockRefusalHook {
  status: number;
  code: string;
  title?: string;
  reasons?: string[];
  retryAfterSeconds?: number;
}

export interface MockTenantHooks {
  suspend?: Array<{ tenantId: string; userId: string }>;
  accessTtlSeconds?: number;
  delayMs?: Record<string, number>;
  contentReadUnderRestriction?: boolean;
  clockOffsetMs?: number;
  provisioning?: { stepMs?: number; outcome?: string; failureCode?: string };
  refuseNext?: Record<string, MockRefusalHook>;
  loseAnswer?: string[];
  firstPaymentConfirmed?: string[];
  latePaymentConfirmed?: string[];
  memberOperationStepMs?: number;
  memberOperationOutcome?: string;
  memberOperationFailureCode?: string;
  restrict?: Record<string, string[]>;
  platformBlock?: Record<string, boolean>;
  ownerPauseEnabled?: boolean;
  ownershipTransferEnabled?: boolean;
  applyPlan?: Record<string, string>;
  taskLifetime?: Record<string, number>;
  paymentDispute?: Record<string, boolean>;
  checkoutOff?: MockRefusalHook;
  settlementDelayMs?: number;
  checkoutTtlMs?: number;
  resolveCheckout?: Record<string, string>;
  autopaySuspended?: Record<string, boolean>;
  autopayConsentEnabled?: boolean;
  issueMethod?: Record<string, string>;
  wireDetailsVariant?: string;
  wireReceipts?: MockWireReceiptHook[];
  confirmWire?: Record<string, string>;
  returnUnallocated?: string[];
  refundProgress?: Record<string, string>;
  evidenceComplete?: string[];
  holdExpiry?: string[];
  documentOff?: boolean;
  documentType?: string;
  reconciliationTargetSeconds?: number | null;
}

/** A bank statement line as the admin records it (TAS-514): the server's own id for it, chosen by whoever sets the hook. */
export interface MockWireReceiptHook {
  id: string;
  tenantId: string;
  amountMinor: string;
  /** When the money arrived; the lifecycle clock when absent. */
  occurredAt?: string;
  precision?: "INSTANT" | "DAY";
}

/** The fixture companies' ids (fixed, `createdAt` ascending in this order). */
export const MOCK_TENANT_IDS = {
  northwind: "0b6f3c1e-4a2d-4e8b-9c7f-1d2e3f4a5b01",
  globex: "0b6f3c1e-4a2d-4e8b-9c7f-1d2e3f4a5b02",
  initech: "0b6f3c1e-4a2d-4e8b-9c7f-1d2e3f4a5b03",
  umbrella: "0b6f3c1e-4a2d-4e8b-9c7f-1d2e3f4a5b04",
  hooli: "0b6f3c1e-4a2d-4e8b-9c7f-1d2e3f4a5b05",
  massive: "0b6f3c1e-4a2d-4e8b-9c7f-1d2e3f4a5b06",
  longName: "0b6f3c1e-4a2d-4e8b-9c7f-1d2e3f4a5b07",
  /** TAS-501: Tom's company awaiting its first payment, the deadline ~10 days ahead. */
  stark: "0b6f3c1e-4a2d-4e8b-9c7f-1d2e3f4a5b08",
  /** TAS-501: Tom's cancelled creation. */
  wayne: "0b6f3c1e-4a2d-4e8b-9c7f-1d2e3f4a5b09",
  /** TAS-501: Sofia's deleted FREE company, unlisted — deletion did not give her FREE back. */
  vandelay: "0b6f3c1e-4a2d-4e8b-9c7f-1d2e3f4a5b0a",
  /** TAS-514: Tom's company that pays by bank transfer — every wire fixture is its own. */
  cyberdyne: "0b6f3c1e-4a2d-4e8b-9c7f-1d2e3f4a5b0b",
} as const;

/**
 * The mock's catalogue (TAS-501): fixed ids, the mock's own codes — the UI
 * never compares a code. Free and Team are `PUBLISHED`; Team's first version is
 * `RETIRED`, listed and never offered, so the screen's filter has something to
 * leave out. TAS-515 publishes Starter (€10) and Business (€40) — invented
 * (art-director B15), so a company on Team v1 (€15) reaches all three
 * outcomes of a plan change: Free at once, a cheaper plan after its payment,
 * a dearer one from the next period.
 */
export const MOCK_PLAN_IDS = {
  free: "7d2c4e1a-5b3f-4a6c-9e8d-0f1a2b3c4d01",
  team: "7d2c4e1a-5b3f-4a6c-9e8d-0f1a2b3c4d02",
  teamRetired: "7d2c4e1a-5b3f-4a6c-9e8d-0f1a2b3c4d03",
  starter: "7d2c4e1a-5b3f-4a6c-9e8d-0f1a2b3c4d04",
  business: "7d2c4e1a-5b3f-4a6c-9e8d-0f1a2b3c4d05",
} as const;

interface MockPlan {
  id: string;
  /** `PlanVersion.kind` (develop `43d6c89d`): what makes a plan the free one, never its price. */
  kind: "FREE" | "PAID";
  code: string;
  version: string;
  name: string;
  price: { amountMinor: string; currency: string; exponent: number };
  period: string;
  limits: Array<{ kind: string; limit?: string; unlimited: boolean }>;
  capabilities: string[];
  state: string;
  publishedAt: string;
}

const MOCK_PLANS: readonly MockPlan[] = [
  {
    id: MOCK_PLAN_IDS.free,
    kind: "FREE",
    code: "mock-free",
    version: "1",
    name: "Free",
    price: { amountMinor: "0", currency: "EUR", exponent: 2 },
    period: "NONE",
    limits: [
      { kind: "PROJECT", limit: "1", unlimited: false },
      { kind: "SEAT", limit: "5", unlimited: false },
      { kind: "STORAGE_BYTES", limit: "100000000", unlimited: false },
      { kind: "TASK_LIFETIME", limit: "50", unlimited: false },
    ],
    capabilities: ["projects.basic"],
    state: "PUBLISHED",
    publishedAt: "2026-05-01T00:00:00Z",
  },
  {
    id: MOCK_PLAN_IDS.teamRetired,
    kind: "PAID",
    code: "mock-team",
    version: "1",
    name: "Team",
    price: { amountMinor: "1500", currency: "EUR", exponent: 2 },
    period: "CALENDAR_MONTH",
    limits: [
      { kind: "PROJECT", limit: "3", unlimited: false },
      { kind: "SEAT", limit: "25", unlimited: false },
      // TAS-512: Umbrella is on this version, and its usage reads all four.
      { kind: "STORAGE_BYTES", limit: "2000000000", unlimited: false },
      { kind: "TASK_LIFETIME", unlimited: true },
    ],
    capabilities: ["projects.basic"],
    state: "RETIRED",
    publishedAt: "2026-01-01T00:00:00Z",
  },
  {
    id: MOCK_PLAN_IDS.team,
    kind: "PAID",
    code: "mock-team",
    version: "2",
    name: "Team",
    price: { amountMinor: "2000", currency: "EUR", exponent: 2 },
    period: "CALENDAR_MONTH",
    limits: [
      { kind: "PROJECT", limit: "5", unlimited: false },
      { kind: "SEAT", limit: "50", unlimited: false },
      { kind: "STORAGE_BYTES", limit: "5000000000", unlimited: false },
      { kind: "TASK_LIFETIME", unlimited: true },
    ],
    capabilities: ["projects.basic", "projects.unlimited-issues"],
    state: "PUBLISHED",
    publishedAt: "2026-05-01T00:00:00Z",
  },
  // TAS-515, invented (B15): one paid plan cheaper than Team v1, one dearer than Team v2.
  {
    id: MOCK_PLAN_IDS.starter,
    kind: "PAID",
    code: "mock-starter",
    version: "1",
    name: "Starter",
    price: { amountMinor: "1000", currency: "EUR", exponent: 2 },
    period: "CALENDAR_MONTH",
    limits: [
      { kind: "PROJECT", limit: "2", unlimited: false },
      { kind: "SEAT", limit: "10", unlimited: false },
      { kind: "STORAGE_BYTES", limit: "1000000000", unlimited: false },
      { kind: "TASK_LIFETIME", unlimited: true },
    ],
    capabilities: ["projects.basic"],
    state: "PUBLISHED",
    publishedAt: "2026-11-01T00:00:00Z",
  },
  {
    id: MOCK_PLAN_IDS.business,
    kind: "PAID",
    code: "mock-business",
    version: "1",
    name: "Business",
    price: { amountMinor: "4000", currency: "EUR", exponent: 2 },
    period: "CALENDAR_MONTH",
    limits: [
      { kind: "PROJECT", limit: "20", unlimited: false },
      { kind: "SEAT", limit: "200", unlimited: false },
      { kind: "STORAGE_BYTES", limit: "50000000000", unlimited: false },
      { kind: "TASK_LIFETIME", unlimited: true },
    ],
    capabilities: ["projects.basic", "projects.unlimited-issues"],
    state: "PUBLISHED",
    publishedAt: "2026-11-01T00:00:00Z",
  },
];

/**
 * The fixture invoices (TAS-513), fixed ids: what the server has issued for
 * the seeded paid companies — each one's INITIAL, and Umbrella's RENEWAL.
 */
export const MOCK_INVOICE_IDS = {
  initechInitial: "4b8e2a1c-6d3f-4e5a-9b7c-1a2b3c4d5e01",
  umbrellaInitial: "4b8e2a1c-6d3f-4e5a-9b7c-1a2b3c4d5e02",
  hooliInitial: "4b8e2a1c-6d3f-4e5a-9b7c-1a2b3c4d5e03",
  massiveInitial: "4b8e2a1c-6d3f-4e5a-9b7c-1a2b3c4d5e04",
  longNameInitial: "4b8e2a1c-6d3f-4e5a-9b7c-1a2b3c4d5e05",
  /** Stark Industries' first payment: OPEN, due at its creation deadline. */
  starkInitial: "4b8e2a1c-6d3f-4e5a-9b7c-1a2b3c4d5e06",
  wayneInitial: "4b8e2a1c-6d3f-4e5a-9b7c-1a2b3c4d5e07",
  /** Umbrella's renewal of Team v1: OPEN, due at its paid-through. */
  umbrellaRenewal: "4b8e2a1c-6d3f-4e5a-9b7c-1a2b3c4d5e08",
  /**
   * TAS-514, Cyberdyne Systems — all by bank transfer but the plan change: its
   * first invoice, EXPIRED because the money arrived after its due date
   * (refunded, LATE_FIRST_PAYMENT); the replacement that opened it, PAID, in
   * three lines; a plan change in US dollars, online, VOID; and its renewal,
   * OPEN, due at its paid-through.
   */
  cyberdyneLateInitial: "4b8e2a1c-6d3f-4e5a-9b7c-1a2b3c4d5e09",
  cyberdyneInitial: "4b8e2a1c-6d3f-4e5a-9b7c-1a2b3c4d5e0a",
  cyberdynePlanChange: "4b8e2a1c-6d3f-4e5a-9b7c-1a2b3c4d5e0b",
  cyberdyneRenewal: "4b8e2a1c-6d3f-4e5a-9b7c-1a2b3c4d5e0c",
} as const;

/**
 * TAS-514: the bank's details on every wire invoice this mock issues —
 * **invalid by construction**: the country `XX` is no ISO country and the
 * check digits `00` never pass mod-97, so nothing can be paid to it. Neither
 * the BIC nor the bank is real.
 */
export const MOCK_WIRE_BENEFICIARY = "Taska Mock S.L. (test only)";
export const MOCK_WIRE_IBAN = "XX00MOCK0000000000000000";
export const MOCK_WIRE_BIC = "MOCKESM0XXX";
export const MOCK_WIRE_BANK = "Mock Bank";
/** The reference the mock gives a wire invoice — never the number itself (Q8); invented. */
export const mockWireReference = (number: string) => `TASKA-${number}`;

/** The projects the fixture companies add of their own (fixed ids). Globex's WEB shares its key with Northwind's. */
export const MOCK_TENANT_PROJECT_IDS = {
  globexWeb: "5a1e9c3d-7b2f-4d6a-8e0c-2f4b6d8a0c01",
  globexFinance: "5a1e9c3d-7b2f-4d6a-8e0c-2f4b6d8a0c02",
  initechHelpdesk: "5a1e9c3d-7b2f-4d6a-8e0c-2f4b6d8a0c03",
  umbrellaResearch: "5a1e9c3d-7b2f-4d6a-8e0c-2f4b6d8a0c04",
  hooliSearch: "5a1e9c3d-7b2f-4d6a-8e0c-2f4b6d8a0c05",
  longNameProject: "5a1e9c3d-7b2f-4d6a-8e0c-2f4b6d8a0c07",
  cyberdyneSkynet: "5a1e9c3d-7b2f-4d6a-8e0c-2f4b6d8a0c08",
} as const;

/** A company name at the blueprint's maximum, 120 characters, for the layout review. */
export const MOCK_LONG_TENANT_NAME =
  "Consolidated Intercontinental Widget Manufacturing and Logistics Holdings of Northern Europe, Asia and the Pacific Coast";

const { anna, sofia, tom, priya } = MOCK_ACCOUNT_IDS;
/** Omar Haddad — in today's seed the LOCKED account; here also Northwind's suspended member (TAS-502). */
const omar = "d58f0e73-4b2c-4c9d-8e15-3f6a70b2c9d4";

/** The fixture invitations' ids (TAS-502). */
export const MOCK_INVITATION_IDS = {
  /** Northwind, pending: Kai, invited by Anna as a Member of WEB, holds Northwind's fifth seat. */
  kai: "9c1f2e3d-4b5a-4c6d-8e7f-0a1b2c3d4e01",
  /** Northwind, expired two days before the seed. */
  zoe: "9c1f2e3d-4b5a-4c6d-8e7f-0a1b2c3d4e02",
  /** Umbrella, pending, sent by Priya — revoked when Tom demotes her. */
  lena: "9c1f2e3d-4b5a-4c6d-8e7f-0a1b2c3d4e03",
} as const;

type MembershipRole = "TENANT_ADMIN" | "MEMBER";
type MembershipState = "ACTIVE" | "SUSPENDED" | "REMOVED";

/**
 * A company's subscription (TAS-504; `Subscription`, TAS-314) — **never on the
 * `Tenant` wire**, answered only by `getSubscription`, to the owner.
 * `paidThrough` is the exclusive end of the current paid coverage, absent for
 * FREE and before the first payment (ask A37); a pause or a block never moves
 * it (D129, D145).
 */
interface StoredSubscription {
  planVersionId: string;
  version: string;
  paidThrough?: string;
  anchorDay?: number;
  renewalCancelled: boolean;
  autopayState: string;
  /**
   * TAS-515: the owner's NEXT_PERIOD choice (develop's `writeSelection`) — the
   * plan it moves to and when. The date goes once the boundary passes unpaid;
   * the id stays (`SubscriptionStore.java:629-640`).
   */
  scheduledPlanVersionId?: string;
  scheduledEffectiveAt?: string;
  /** TAS-515: the plan change in force — develop's off-wire `active_plan_change_id`. Never on the wire (A63). */
  activeChange?: StoredPlanChange;
  /** TAS-515: the `paidThrough` the renewal calendar has issued a RENEWAL for. Never on the wire. */
  renewalIssuedFor?: string;
  /** TAS-515: `AutopayMandate.version` — deliberately never the subscription's. Never on the wire. */
  mandateVersion?: number;
}

/**
 * A plan change awaiting its payment (TAS-515): AFTER_PAYMENT switches once
 * its invoice settles, NEXT_PERIOD at its boundary if its invoice settled by
 * then. It ends when its invoice expires (the mock's choice, recorded), and a
 * new selection supersedes it.
 */
interface StoredPlanChange {
  operationId: string;
  planVersionId: string;
  effect: "AFTER_PAYMENT" | "NEXT_PERIOD";
  invoiceId: string;
  effectiveAt?: string;
  /** Its invoice settled (NEXT_PERIOD): the switch waits for the boundary. */
  paidAt?: string;
}

interface StoredTenant {
  id: string;
  name: string;
  ownerId: string;
  lifecycle: string;
  restrictions: string[];
  createdAt: string;
  creationDeadline?: string;
  version: string;
  ownerVersion: string;
  /** TAS-504. Never on the wire. */
  subscription: StoredSubscription;
  /** The plan's SEAT limit, a decimal string, or `null` for an unlimited one (TAS-502). Never on the wire. */
  seatLimit: string | null;
  /** `QuotaSnapshot.version`: moves whenever `used` or `reserved` does. Never on the wire. */
  quotaVersion: number;
  /** The membership generation: moves with every change to a membership, and the members cursor is bound to it. */
  generation: number;
  /** TAS-512: `Entitlement.version` — moves with the plan, a restriction or the coverage. Never on the `Tenant` wire. */
  entitlementVersion: number;
  /**
   * TAS-512: the quota kinds a plan change left over their limits, and
   * `TASK_LIFETIME` while a project's counter is past a finite one. `OVER_QUOTA`
   * is in `restrictions` exactly while this is not empty. Never on the wire.
   */
  quotaBreach: string[];
  /** TAS-512: the last `applyPlan` value applied, so one value is applied once. Never on the wire. */
  appliedPlan?: string;
  /** TAS-514: how the server issues this company's invoices when no hook says otherwise (`PSP` when absent). Never on the wire. */
  invoiceMethod?: string;
}

interface StoredMembership {
  id: string;
  tenantId: string;
  userId: string;
  role: MembershipRole;
  state: MembershipState;
  version: number;
  /** Not on the wire (`Membership` has no `joinedAt`); the list's order, `(joinedAt, userId)` as develop has it. */
  joinedAt: string;
}

/** An invitation (TAS-502). `issuedAt` orders the list and is not on the wire. */
interface StoredInvitation {
  id: string;
  tenantId: string;
  email: string;
  role: MembershipRole;
  state: string;
  issuedAt: string;
  expiresAt: string;
  createdBy: string;
  projectGrants: Array<{ projectId: string; role: string }>;
  version: number;
}

type SessionKind = "WEB_GLOBAL" | "WEB_TENANT";

interface StoredSession {
  id: string;
  kind: SessionKind;
  userId: string;
  tenantId?: string;
  /** A company session's account session: it is revoked with it and expires with it (PR #288). */
  parentId?: string;
  /** The family's absolute end — 7 days, PR #288's (contracts §11 allows 1–90). */
  expiresAt: number;
  revokedAt?: number;
}

interface WireAccessSession {
  sessionId: string;
  userId: string;
  tenantId?: string;
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
  expiresIn: number;
  mfaVerified: boolean;
}

interface StoredRefresh {
  sessionId: string;
  spentAt?: number;
  /** The rotation that spent it: the same key within 60 s answers the same pair (contracts §7). */
  receipt?: { key: string; at: number; answer: WireAccessSession };
}

interface StoredReceipt {
  operation: string;
  hash: string;
  at: number;
  answer: unknown;
}

/** A creation's provisioning (TAS-501). `state` moves with the lifecycle clock until it is terminal, then stays. */
interface StoredOperation {
  id: string;
  tenantId: string;
  actorId: string;
  type: string;
  createdAt: string;
  state: string;
  updatedAt: string;
  failureCode?: string;
  /** A removal's subject (TAS-502) — never on the wire. */
  subjectUserId?: string;
}

/**
 * A creation's receipt — **durable**, unlike the 60-second secret receipt of
 * the session routes (B2): develop replays a creation by reading the company
 * row, for as long as the key exists. Keyed by `{actor}:{key}`; `hash` is the
 * body exactly as sent.
 */
interface StoredCreation {
  hash: string;
  tenantId: string;
  operationId: string;
}

interface StoredMoney {
  amountMinor: string;
  currency: string;
  exponent: number;
}

interface StoredAddress {
  country: string;
  postalCode: string;
  city: string;
  line1: string;
  line2?: string;
}

/** The buyer as the invoice was issued to it (TAS-514, F1): copied once, at issuance — a rename never reaches it. */
interface StoredBuyer {
  kind: string;
  name: string;
  email: string;
  address: StoredAddress;
  taxId?: string;
}

interface StoredSeller {
  legalName: string;
  registrationId: string;
  taxId?: string;
  address: StoredAddress;
}

interface StoredLine {
  description: string;
  quantity: number;
  net: StoredMoney;
  /** `rate` a fraction («0.21», develop's), kept on the wire though the client draws none (A84). */
  taxes: Array<{ label: string; rate: string; amount: StoredMoney }>;
  total: StoredMoney;
}

interface StoredWire {
  beneficiaryName: string;
  iban: string;
  bic: string;
  bankName: string;
  reference: string;
}

interface StoredFxQuote {
  baseCurrency: string;
  quoteCurrency: string;
  rate: string;
  source: string;
  observedAt: string;
  expiresAt: string;
}

/**
 * An invoice (TAS-513) — issued by the server only: the INITIAL one when a
 * paid company is created (the mock's answer to A53), a RENEWAL by its
 * calendar. Never written by a client: there is no `createInvoice` here.
 * TAS-514: its buyer, seller, lines, bank details and FX quote are stored when
 * it is issued and never written again (F1); `matchedUnallocated` is the bank
 * money matched to it and not allocated — a partial payment, or money waiting
 * to go back once it expired.
 */
interface StoredInvoice {
  id: string;
  tenantId: string;
  number: string;
  purpose: string;
  state: string;
  planVersionId: string;
  total: StoredMoney;
  allocated: StoredMoney;
  remaining: StoredMoney;
  issuedAt: string;
  dueAt: string;
  paymentMethod: string;
  version: number;
  replacesInvoiceId?: string;
  buyer: StoredBuyer;
  seller: StoredSeller;
  lines: StoredLine[];
  wireInstructions?: StoredWire;
  fxQuote?: StoredFxQuote;
  matchedUnallocated: StoredMoney;
}

/**
 * A bank statement line an admin recorded (TAS-514; `PaymentFact` on develop)
 * — **admin-only, never on an owner's route**. `outcome` is what its
 * confirmation did; `unallocated` the money of it that went to no invoice,
 * which only a return (`StoredRefund`) gives back.
 */
interface StoredWireReceipt {
  id: string;
  tenantId: string;
  /** The payment fact's id, as a refund names its source (`Refund.paymentId`). */
  paymentId: string;
  amount: StoredMoney;
  occurredAt: string;
  precision: "INSTANT" | "DAY";
  observedAt: string;
  invoiceId?: string;
  confirmedAt?: string;
  outcome?: "MATCHED" | "ALLOCATED" | "LATE_FIRST_PAYMENT" | "CLOSED_CREATION" | "LATE_PARTIAL" | "DUPLICATE_PAYMENT";
  unallocated: StoredMoney;
  refundId?: string;
}

/** A refund (TAS-514): an UNALLOCATED_RETURN of one receipt's money, moved by the admin's hooks only. */
interface StoredRefund {
  id: string;
  tenantId: string;
  receiptId: string;
  paymentId: string;
  kind: string;
  state: string;
  amount: StoredMoney;
  requestedAt: string;
  confirmedAt?: string;
  version: number;
  reasonCode: string;
  sourceMethod: string;
  feeBearer?: string;
  evidenceCompletedAt?: string;
  businessCalendarId?: string;
  calendarVersion?: string;
  slaPolicyVersion?: string;
  slaSnapshot?: Record<string, unknown>;
  decisionDueAt?: string;
  sendDueAt?: string;
  decidedAt?: string;
  submittedAt?: string;
}

/**
 * A hosted checkout (TAS-513). `token` is the stand-in page's opaque key — on
 * the wire only inside `redirectUrl`, never in a receipt. The provider's
 * observation lands at `observeAt` (a 3-D Secure success that comes later);
 * the server settles at `settleAt`, after a `SUCCEEDED` — two steps, so a
 * success is seen before the invoice is PAID.
 */
interface StoredCheckout {
  id: string;
  tenantId: string;
  invoiceId: string;
  actorId: string;
  returnTarget: string;
  state: string;
  createdAt: string;
  expiresAt: string;
  token: string;
  observeAt?: string;
  observe?: string;
  settleAt?: string;
  settled?: boolean;
  /** `resolveCheckout` has answered for it. */
  resolved?: boolean;
}

interface ServerState {
  v: 8;
  tenants: StoredTenant[];
  memberships: StoredMembership[];
  sessions: StoredSession[];
  access: Record<string, { sessionId: string; expiresAt: number }>;
  refresh: Record<string, StoredRefresh>;
  receipts: Record<string, StoredReceipt>;
  /** Who has used their one FREE company, and on which (contracts §8): by account, never restored. */
  freeLedger: Record<string, string>;
  operations: StoredOperation[];
  creations: Record<string, StoredCreation>;
  /** Cancel receipts, `{actor}:{key}` — the answer a replay of the same key gets. */
  cancels: Record<string, { hash: string; answer: unknown }>;
  /** TAS-502. */
  invitations: StoredInvitation[];
  /**
   * The member writes' receipts — **durable**, `{actor}:{operation}:{key}`:
   * the same key with the same request (body and `If-Match`) answers what it
   * answered, with another is 409 `IDEMPOTENCY_CONFLICT`. A removal's receipt
   * names its operation, whose state is read as it is now.
   */
  memberReceipts: Record<string, { hash: string; answer: unknown; operationId?: string }>;
  /**
   * People whose project rows and assignments a suspension, removal or leave
   * cleared (contracts §8), so that a company store this page builds from the
   * seed — after a reload, or in another tab — leaves them out too.
   */
  cleared: Array<{ tenantId: string; userId: string; seq: number }>;
  /**
   * TAS-512: every project's lifetime issue counter (contracts §8): up by one
   * when a new issue is stored, never down — deleting an issue frees nothing —
   * and never derived from issue numbers. Keyed by project, with the company
   * it belongs to. A project not here has created none.
   */
  taskLifetime: Record<string, { tenantId: string; count: number }>;
  /** The `taskLifetime` hook's values already applied, by project — one value is applied once. */
  lifetimeApplied: Record<string, number>;
  /** TAS-513. */
  invoices: StoredInvoice[];
  /** The next invoice number's sequence. */
  invoiceSeq: number;
  checkouts: StoredCheckout[];
  /** TAS-514: the bank receipts an admin recorded, and the refunds of their money. */
  wireReceipts: StoredWireReceipt[];
  refunds: StoredRefund[];
  /**
   * `createCheckout`'s receipts — durable, `{actor}:{tenant}:{key}`: the same
   * key with the same body answers the checkout it made, as it is now; with
   * another body, 409 `IDEMPOTENCY_CONFLICT`. The answer itself is never kept:
   * it carries the page's address.
   */
  checkoutReceipts: Record<string, { hash: string; checkoutId: string }>;
  /**
   * TAS-515: the subscription commands' receipts — durable, `{tenant}:{actor}:{key}`,
   * checked before `If-Match` (develop's SPC 68-81): the same request (operation,
   * `If-Match` and body) answers what it answered — a refused FREE change its
   * refusal (SPC 404-406) —, another is 409 `IDEMPOTENCY_CONFLICT`.
   */
  billingReceipts: Record<string, { hash: string; answer?: unknown; refusal?: { status: number; code: string; title: string } }>;
}

/**
 * A refusal as the blueprint's gateway answers one: an HTTP status and a
 * `Problem` — `code`, `title` as the message, `requestId`, `reasons`. Read by
 * the same duck-typed helpers as `ApiError` (`apiErrorFacts`, `refusalCode`,
 * `refusalReasons`), so the session layer cannot tell the two apart — which is
 * the point. `details` is always `null`: a Problem has none.
 */
export class MockProblemError extends Error {
  readonly details = null;
  readonly requestId: string;

  constructor(
    readonly status: number,
    readonly code: string,
    title: string,
    readonly reasons: readonly string[] = [],
    /** The wait a 429 names — `Retry-After` on the wire (api-contract-guard N1). */
    readonly retryAfterSeconds: number | null = null,
    violations: readonly FieldViolation[] = [],
  ) {
    super(title);
    this.name = "MockProblemError";
    this.requestId = uuid();
    // Only on a refusal that names fields (TAS-502): a Problem without
    // `violations` carries none, as TAS-501's refusals are pinned to.
    if (violations.length > 0) this.violations = violations;
  }

  /** `Problem.violations`, the fields a `VALIDATION_FAILED` names (TAS-502); absent when it names none. */
  readonly violations?: readonly FieldViolation[];
}

const problem = (status: number, code: string, title: string, reasons: readonly string[] = [], retryAfterSeconds: number | null = null) =>
  new MockProblemError(status, code, title, reasons, retryAfterSeconds);

const invalid = (title: string, violations: readonly FieldViolation[]) =>
  new MockProblemError(400, "VALIDATION_FAILED", title, [], null, violations);

const uuid = () =>
  globalThis.crypto?.randomUUID?.() ??
  "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** An `Idempotency-Key` develop accepts for a creation: a canonical, lowercase UUID (`TenantRegistryService.java:81`). */
const CANONICAL_KEY = UUID_PATTERN;

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const FAMILY_LIFETIME_MS = 7 * DAY;
const SECRET_RECEIPT_MS = 60_000;
const DEFAULT_ACCESS_TTL_S = 900;
/** The window a paid creation has for its first payment — develop's default (the blueprint allows 1–90 days). */
const CREATION_WINDOW_MS = 30 * DAY;
const DEFAULT_PROVISIONING_STEP_MS = 1200;
const TERMINAL_OPERATION_STATES: ReadonlySet<string> = new Set(["SUCCEEDED", "FAILED", "MANUAL_REVIEW"]);
/** An invitation's lifetime (contracts §8: 7 days by default, configurable 1–30). */
const INVITATION_TTL_MS = 7 * DAY;
/** The operation type of a removal (TAS-502) — the screens never key on it. */
const REMOVE_OPERATION_TYPE = "removeTenantMember";
const LEAVE_OPERATION_TYPE = "leaveTenant";
/** The restrictions the RECOVERY policy allows remove and revoke under (access-matrix.json; api-contract-guard §2). */
const RECOVERY_ALLOWED: ReadonlySet<string> = new Set(["PAYMENT_EXPIRED", "OVER_QUOTA"]);
/** One limit of a plan of this mock's catalogue, a decimal string — `null` for an unlimited one or a kind it does not name. */
const planLimitOf = (planId: string, kind: string): string | null => {
  const limit = MOCK_PLANS.find((plan) => plan.id === planId)?.limits.find((item) => item.kind === kind);
  return limit && !limit.unlimited && limit.limit ? limit.limit : null;
};
/** The SEAT limit of a plan of this mock's catalogue, a decimal string — `null` for unlimited. */
const seatLimitOf = (planId: string): string | null => planLimitOf(planId, "SEAT");
/** The quota kinds a plan change re-checks, in the snapshot's order then the entitlement's. */
const BREACH_KINDS: readonly string[] = ["SEAT", "PROJECT", "STORAGE_BYTES", "TASK_LIFETIME"];

/** How long a paid period the mock starts on a confirmed first payment lasts — its own choice (TAS-504). */
const PAID_PERIOD_MS = 30 * DAY;
/** TAS-515, the mock's own choices: an AFTER_PAYMENT invoice is due a week after the change; the calendar's RENEWAL is issued a week before the end. */
const PLAN_CHANGE_DUE_MS = 7 * DAY;
const RENEWAL_LEAD_MS = 7 * DAY;
/** The restrictions the AUTOPAY profile refuses `setAutopayConsent` under (`CapabilityEvaluator.java:456-462`, A68). */
const AUTOPAY_DENIED: readonly string[] = ["OWNER_PAUSE", "PLATFORM_BLOCK", "PAYMENT_DISPUTE", "PENDING_FIRST_PAYMENT"];

/** TAS-513, the mock's own choices: a checkout's life, the settlement's delay, and a late 3-D Secure success. */
const CHECKOUT_TTL_MS = 30 * MINUTE;
const DEFAULT_SETTLEMENT_DELAY_MS = 2500;
const LATE_SUCCESS_MS = 20_000;
/** The checkouts the server's unique index counts as active for their invoice (`payment_attempts_invoice_active_uniq`). */
const ACTIVE_CHECKOUT_STATES: ReadonlySet<string> = new Set(["CREATED", "PENDING", "UNKNOWN", "SUCCEEDED"]);
const OPEN_CHECKOUT_STATES: ReadonlySet<string> = new Set(["CREATED", "PENDING"]);
/** TAS-514: the capabilities' `WIRE_RECONCILIATION_TARGET_SECONDS` — develop's default (`0003-platform-flags.sql`). */
const DEFAULT_RECONCILIATION_TARGET_S = 86_400;
/** The invoice states a wire payment may still arrive for. */
const PAYABLE_BY_WIRE: ReadonlySet<string> = new Set(["OPEN", "PARTIALLY_PAID"]);
/** The states the `refundProgress` hook may move a refund to. */
const REFUND_PROGRESS: ReadonlySet<string> = new Set(["APPROVED", "SUBMITTING", "UNKNOWN", "CONFIRMED", "FAILED", "REJECTED"]);

const money = (amountMinor: string, currency = "EUR", exponent = 2): StoredMoney => ({ amountMinor, currency, exponent });
const zeroOf = (total: StoredMoney): StoredMoney => ({ ...total, amountMinor: "0" });
const planPrice = (planVersionId: string): StoredMoney => {
  const price = MOCK_PLANS.find((plan) => plan.id === planVersionId)?.price;
  return price ? { ...price } : money("0");
};
const invoiceNumber = (seq: number) => `TSK-2026-${String(seq).padStart(5, "0")}`;

/** The outcomes the stand-in payment page offers (art-director B12). */
export type MockCheckoutOutcome = "succeeds" | "fails" | "cancel" | "unknown" | "succeedsLater";

/** What the stand-in payment page draws of its checkout — no address, no key. */
export interface MockCheckoutPage {
  checkoutId: string;
  company: string | null;
  invoiceNumber: string | null;
  amount: StoredMoney | null;
  /** Whether it still takes an outcome: CREATED or PENDING, and not expired. */
  open: boolean;
}

/**
 * A minimal valid PDF of an invoice's stored snapshot (TAS-514, invented): one
 * page of Helvetica in WinAnsi — so «—» and «€» are one byte each and every
 * offset in the cross-reference table is exact — marked as no tax document.
 */
function mockInvoicePdf(invoice: StoredInvoice): Uint8Array {
  const amount = (value: StoredMoney) => {
    const digits = value.amountMinor.padStart(value.exponent + 1, "0");
    const whole = digits.slice(0, digits.length - value.exponent);
    return `${value.currency} ${value.exponent > 0 ? `${whole}.${digits.slice(digits.length - value.exponent)}` : whole}`;
  };
  const lines = [
    "MOCK — not a tax document",
    `Invoice ${invoice.number}`,
    `Issued ${invoice.issuedAt}`,
    `Due ${invoice.dueAt}`,
    `Billed to ${invoice.buyer.name}`,
    `From ${invoice.seller.legalName}`,
    ...invoice.lines.map((line) => `${line.description} x${line.quantity}: ${amount(line.total)}`),
    `Total ${amount(invoice.total)}`,
    ...(invoice.wireInstructions ? [`Reference ${invoice.wireInstructions.reference}`] : []),
  ];
  const WIN_ANSI: Readonly<Record<string, number>> = { "€": 0x80, "—": 0x97, "–": 0x96, "’": 0x92 };
  // One character, one byte: anything WinAnsi has no byte for (an emoji in a company's name) is «?».
  const single = (text: string) => Array.from(text, (char) => (WIN_ANSI[char] !== undefined || (char.length === 1 && char.charCodeAt(0) < 0x100) ? char : "?")).join("");
  const escape = (text: string) => single(text).replace(/[\\()]/g, (char) => `\\${char}`);
  const content = `BT /F1 12 Tf 56 780 Td 18 TL ${lines.map((line) => `(${escape(line)}) Tj T*`).join(" ")} ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(body, (char) => WIN_ANSI[char] ?? char.charCodeAt(0));
}

/** Sets or lifts one restriction, kept in `RESTRICTION_ORDER`; a change moves the company's version. */
function setRestriction(tenant: StoredTenant, code: string, on: boolean): boolean {
  if (tenant.restrictions.includes(code) === on) return false;
  tenant.restrictions = orderedRestrictions(on ? [...tenant.restrictions, code] : tenant.restrictions.filter((item) => item !== code));
  tenant.version = nextVersion(tenant.version);
  return true;
}

/** An invoice paid in full (TAS-513): everything allocated in one allocation, nothing left or matched aside, a new version. */
function markPaid(invoice: StoredInvoice): void {
  invoice.state = "PAID";
  invoice.allocated = { ...invoice.total };
  invoice.remaining = zeroOf(invoice.total);
  invoice.matchedUnallocated = zeroOf(invoice.total);
  invoice.version += 1;
}

/* --------------------------------------- an invoice's snapshots (TAS-514, F1) */

/** Who the mock bills: the company's name at issuance — every company the same placeholder address but Cyberdyne. */
function buyerOf(tenant: Pick<StoredTenant, "id" | "name">): StoredBuyer {
  if (tenant.id === MOCK_TENANT_IDS.cyberdyne) {
    return {
      kind: "BUSINESS",
      name: tenant.name,
      email: "accounts@cyberdyne.example",
      address: { country: "ES", postalCode: "28013", city: "Madrid", line1: "14 Mock Avenue", line2: "Floor 3" },
      taxId: "XX-CYB-0001",
    };
  }
  return { kind: "BUSINESS", name: tenant.name, email: "billing@example.com", address: { country: "ES", postalCode: "28001", city: "Madrid", line1: "1 Mock Street" } };
}

/** The seller every mock invoice names — invented, and marked as a test. */
const MOCK_SELLER: StoredSeller = {
  legalName: "Taska Mock S.L. (test only)",
  registrationId: "MOCK-0000",
  taxId: "XX-MOCK-0000",
  address: { country: "ES", postalCode: "28001", city: "Madrid", line1: "2 Mock Street" },
};

/** One line, the plan by its catalogue name at issuance, no tax. */
function planLines(planVersionId: string, total: StoredMoney): StoredLine[] {
  const plan = MOCK_PLANS.find((item) => item.id === planVersionId);
  return [{ description: `${plan?.name ?? "Plan"} plan`, quantity: 1, net: { ...total }, taxes: [], total: { ...total } }];
}

const LONG_BENEFICIARY = `${MOCK_WIRE_BENEFICIARY} — consolidated settlement account for invoices issued to companies on the mock server, kept long on purpose so that the bank details wrap`;

/** A wire invoice's bank details (invalid by construction); `long` for the layout review's 200 and 140 characters. */
function wireDetails(number: string, variant: string | undefined): StoredWire {
  if (variant === "long") {
    const reference = `${mockWireReference(number)}-`;
    return {
      beneficiaryName: LONG_BENEFICIARY.padEnd(200, ".").slice(0, 200),
      iban: MOCK_WIRE_IBAN,
      bic: MOCK_WIRE_BIC,
      bankName: MOCK_WIRE_BANK,
      reference: `${reference}${"0123456789".repeat(14)}`.slice(0, 140),
    };
  }
  return { beneficiaryName: MOCK_WIRE_BENEFICIARY, iban: MOCK_WIRE_IBAN, bic: MOCK_WIRE_BIC, bankName: MOCK_WIRE_BANK, reference: mockWireReference(number) };
}

/** A wire first payment's due date (invented, after the blueprint's 7 days): a week after issuance, never after the deadline. */
const WIRE_DUE_MS = 7 * DAY;

const addMoney = (a: StoredMoney, b: StoredMoney): StoredMoney => ({ ...a, amountMinor: (BigInt(a.amountMinor) + BigInt(b.amountMinor)).toString() });
const subtractMoney = (a: StoredMoney, b: StoredMoney): StoredMoney => {
  const left = BigInt(a.amountMinor) - BigInt(b.amountMinor);
  return { ...a, amountMinor: (left > 0n ? left : 0n).toString() };
};
const isPositive = (value: StoredMoney | undefined) => value !== undefined && BigInt(value.amountMinor) > 0n;

/**
 * Five business dates after `from` (`WIRE_RETURN_ES_V1`'s count, invented
 * here): Mon–Fri, the evidence date itself excluded, no holidays, the same UTC
 * time of day — not Madrid's wall clock.
 */
function businessDatesAfter(from: number, count: number): number {
  let at = from;
  let left = count;
  while (left > 0) {
    at += DAY;
    const weekday = new Date(at).getUTCDay();
    if (weekday !== 0 && weekday !== 6) left -= 1;
  }
  return at;
}

/** The WIRE SLA set a refund gets once its evidence is complete — every field at once, frozen. */
function wireSla(evidenceAt: number): Pick<
  StoredRefund,
  "evidenceCompletedAt" | "businessCalendarId" | "calendarVersion" | "slaPolicyVersion" | "slaSnapshot" | "decisionDueAt" | "sendDueAt"
> {
  const due = new Date(businessDatesAfter(evidenceAt, 5)).toISOString();
  return {
    evidenceCompletedAt: new Date(evidenceAt).toISOString(),
    businessCalendarId: "MOCK-ES-BANKING",
    calendarVersion: "mock-2026-1",
    slaPolicyVersion: "WIRE_RETURN_ES_V1",
    slaSnapshot: {
      businessDays: 5,
      feeBearer: "TASKA",
      countingRule: "T_PLUS_5_BUSINESS_DATES_SAME_LOCAL_TIME",
      timezone: "Europe/Madrid",
      calendarDigest: "0".repeat(64),
      excludeEvidenceDate: true,
      dstGapRule: "NEXT_VALID_INSTANT",
      dstOverlapRule: "LATER_OFFSET",
    },
    decisionDueAt: due,
    sendDueAt: due,
  };
}

/** A subscription with no paid period: FREE, or a paid plan before its first payment (TAS-504). */
const unpaid = (planVersionId: string): StoredSubscription => ({
  planVersionId,
  version: "1",
  renewalCancelled: false,
  autopayState: "DISABLED",
});

/** Whether a plan of this mock's catalogue is FREE — the server's knowledge, never the client's (B3). */
const isFreePlan = (planVersionId: string) => MOCK_PLANS.find((plan) => plan.id === planVersionId)?.kind === "FREE";

/**
 * The order a refusal names a company's restrictions in, and the order they
 * are kept in (api-contract-guard §6) — a code this mock does not know, last.
 */
const RESTRICTION_ORDER: readonly string[] = [
  "PLATFORM_BLOCK",
  "OWNER_PAUSE",
  "PAYMENT_DISPUTE",
  "PENDING_FIRST_PAYMENT",
  "PAYMENT_EXPIRED",
  "OVER_QUOTA",
];
const orderedRestrictions = (codes: readonly string[]): string[] => {
  const rank = (code: string) => {
    const index = RESTRICTION_ORDER.indexOf(code);
    return index === -1 ? RESTRICTION_ORDER.length : index;
  };
  return [...new Set(codes)].sort((a, b) => rank(a) - rank(b));
};

/** The two restrictions that close a company's projects when the global read flag is off (contracts §5, D82). */
const closesContent = (codes: readonly string[]) => codes.includes("OWNER_PAUSE") || codes.includes("PLATFORM_BLOCK");

/**
 * Which restrictions each command's rule lets through (access-matrix.json
 * `tenant.*`; api-contract-guard §4): rename (NORMAL) none; pause and resume
 * (OWNER_CONTROL) the owner's own pause and the two financial ones; a transfer
 * (TRANSFER) the owner's own pause only (D244). Anything else is 403
 * `READ_ONLY` with every current restriction as `reasons`.
 */
type TenantPolicy = "NORMAL" | "OWNER_CONTROL" | "TRANSFER";
const POLICY_ALLOWS: Readonly<Record<TenantPolicy, ReadonlySet<string>>> = {
  NORMAL: new Set(),
  OWNER_CONTROL: new Set(["OWNER_PAUSE", "PAYMENT_EXPIRED", "OVER_QUOTA"]),
  TRANSFER: new Set(["OWNER_PAUSE"]),
};

/** Which restriction rule a member route answers to (access-matrix.json `membership.*`, `invitation.*`). */
type MemberPolicy = "DIRECTORY" | "SEATS" | "ADMIN_READ" | "NORMAL" | "RECOVERY" | "LEAVE";
const nextVersion = (version: string) => (/^[0-9]+$/.test(version) ? (BigInt(version) + 1n).toString() : "1");
/**
 * Whether a paused or blocked company's projects can still be read — the
 * blueprint leaves it to a separate global flag (contracts §5). **This mock's
 * value: true**, so Initech and Hooli read and refuse every write with
 * `READ_ONLY` and their restrictions as `reasons`.
 */
export const MOCK_PROJECT_CONTENT_READ_UNDER_RESTRICTION = true;

/**
 * What a `MockTenantServer` call is, for the session check: the routes of a
 * company (`tenant-read`, `tenant-write`, and `tenant-self` — the reader's own
 * notifications and their settings, which a restriction does not stop), and
 * the account's own routes (`account`), which either session may call.
 */
export type MockRouteKind = "tenant-read" | "tenant-write" | "tenant-self" | "account";

/**
 * The fixture companies (api-contract-guard §7, with art-director's layout
 * account). Anna signs in to three: Northwind (owner, company admin), Globex
 * (member, OPS only), Initech (member; paused). Umbrella has suspended her and
 * is not listed. Sofia — the layout account — has five: Northwind, Initech
 * (owner), Hooli (blocked by Taska), Massive Dynamic (closed) and one with a
 * 120-character name. Nina has none. Mark is the GLOBAL_ADMIN and never gets a
 * session.
 *
 * TAS-501 adds the creation's states on Tom (api-contract-guard §9): Stark
 * Industries awaiting its first payment, created 20 days before the seed with
 * the 30-day window — so its deadline is ~10 days ahead; Wayne Enterprises,
 * cancelled; and Massive Dynamic, closed since its deadline passed in June.
 * The FREE ledger: Anna used hers on Northwind, Priya on Globex, and Sofia on
 * Vandelay — deleted and unlisted, because deleting a company does not give
 * the allowance back; Nina and Tom have theirs.
 *
 * TAS-502 adds the members' states and the invitations (api-contract-guard
 * §7): Northwind (FREE, 5 seats) is full — Anna, Sofia, Tom and Omar
 * (suspended, so still holding his seat) use four, Kai's pending invitation
 * holds the fifth, and Zoe's has expired; Umbrella has Priya as a second
 * admin, with Lena's invitation of hers pending; Globex is Anna's member view;
 * Initech, paused, keeps its directory readable and its Leave open; Hooli,
 * blocked, refuses Priya's admin writes `READ_ONLY`.
 *
 * TAS-504 adds each company's subscription (api-contract-guard §6), never on
 * the `Tenant` wire: Northwind and Globex are FREE — no `paidThrough`, autopay
 * DISABLED — so a transfer of either is refused; Initech (paused, Sofia) is
 * paid 32 days past the seed, Umbrella (Tom) 45, Hooli (blocked, Priya) 38
 * and the long-named company (Priya) 50 — every one past the largest clock
 * offset the earlier tests use (29 days), so none of them expires there.
 * Stark, Wayne and Massive Dynamic have never been paid. Who may be the new
 * owner: Initech's Anna (ACTIVE member), Umbrella's Priya (ACTIVE admin) — and
 * Umbrella's Anna is SUSPENDED, refused.
 *
 * TAS-512 adds the plans' usage and their terms (api-contract-guard §5):
 * Northwind (FREE) holds 3 projects against a limit of 1 and Globex (FREE) 3
 * — the platform's bypass, which sets no `OVER_QUOTA` (contracts §8 «может»,
 * ask A46); Northwind's lifetime counters are TAS 47, WEB 50 and MOB 12, so
 * WEB refuses a new issue while it can still be edited, moved and commented
 * on, and TAS takes three more. Umbrella is on Team v1 (€15, 25 seats, now
 * retired) and RND at 50 on a plan without a task limit. The long-named
 * company's renewal is cancelled; `applyPlan` moving it to FREE is AC2 — its
 * LNG at 64 is then past the free limit. Initech's HLP is at 12.
 *
 * TAS-515 drops TAS-512's Team v1 → v2 «announcement» on Umbrella: develop
 * writes the scheduled fields only for the owner's own NEXT_PERIOD change
 * (api-contract-guard §0.2), so a scheduled or pending change now comes from
 * the owner's actions. Umbrella's renewal invoice renews the plan it is on.
 * The FREE ledger is unchanged: Tom still has his, so Umbrella → Free applies
 * at once, and Priya — who used hers on Globex — is refused it on the
 * long-named company through the same route.
 */
function seedTenants(
  seedAt: number,
): Pick<ServerState, "tenants" | "memberships" | "freeLedger" | "invitations" | "taskLifetime" | "invoices" | "invoiceSeq" | "wireReceipts" | "refunds"> {
  const at = (day: number) => `2026-05-${String(day).padStart(2, "0")}T09:00:00Z`;
  const iso = (ms: number) => new Date(ms).toISOString();
  const tenant = (
    id: string,
    name: string,
    ownerId: string,
    day: number,
    lifecycle = "ACTIVE",
    restrictions: string[] = [],
    seatLimit: string | null = seatLimitOf(MOCK_PLAN_IDS.team),
    subscription: StoredSubscription = unpaid(MOCK_PLAN_IDS.team),
  ): StoredTenant => ({
    id,
    name,
    ownerId,
    lifecycle,
    restrictions,
    createdAt: at(day),
    version: "3",
    ownerVersion: "1",
    subscription,
    seatLimit,
    quotaVersion: 1,
    generation: 1,
    entitlementVersion: 1,
    quotaBreach: [],
  });
  /** Team (v2 unless named), paid `days` past the seed; the anchor is that day of the month. */
  const paid = (days: number, autopayState: string, planVersionId: string = MOCK_PLAN_IDS.team): StoredSubscription => {
    const through = new Date(seedAt + days * DAY);
    return {
      planVersionId,
      version: "2",
      paidThrough: through.toISOString(),
      anchorDay: through.getUTCDate(),
      renewalCancelled: false,
      autopayState,
    };
  };
  const umbrellaPaid = paid(45, "CONSENTED", MOCK_PLAN_IDS.teamRetired);
  const named = (id: string, name: string) => ({ id, name });
  const free = seatLimitOf(MOCK_PLAN_IDS.free);
  const freePlan = unpaid(MOCK_PLAN_IDS.free);
  const ids = MOCK_TENANT_IDS;
  const joined = new Map<string, string>([
    [ids.northwind, at(1)],
    [ids.globex, at(2)],
    [ids.initech, at(3)],
    [ids.umbrella, at(4)],
    [ids.hooli, at(5)],
    [ids.massive, at(6)],
    [ids.longName, at(7)],
    [ids.stark, iso(seedAt - 20 * DAY)],
    [ids.wayne, iso(seedAt - 5 * DAY)],
    [ids.vandelay, at(10)],
    [ids.cyberdyne, iso(seedAt - 40 * DAY)],
  ]);
  // TAS-514: Cyberdyne Systems pays by bank transfer. Its first invoice's money arrived two days after its
  // due date while the creation was still open: refunded, and a replacement issued — paid in time, which
  // opened it 26 days ago. A plan change in US dollars, online, was VOIDed; its renewal is OPEN, due at the
  // paid-through, four days ahead.
  const cyberdyneCreated = seedAt - 40 * DAY;
  const cyberdyneOpened = seedAt - 26 * DAY;
  const cyberdyneThrough = new Date(cyberdyneOpened + PAID_PERIOD_MS).toISOString();
  const cyberdyne = named(ids.cyberdyne, "Cyberdyne Systems");
  const member = (
    tenantId: string,
    userId: string,
    role: MembershipRole,
    state: MembershipState = "ACTIVE",
    version = 1,
  ): StoredMembership => ({
    id: uuid(),
    tenantId,
    userId,
    role,
    state,
    version,
    joinedAt: joined.get(tenantId) ?? at(1),
  });
  return {
    tenants: [
      tenant(ids.northwind, "Northwind", anna, 1, "ACTIVE", [], free, freePlan),
      tenant(ids.globex, "Globex", priya, 2, "ACTIVE", [], free, freePlan),
      tenant(ids.initech, "Initech", sofia, 3, "ACTIVE", ["OWNER_PAUSE"], undefined, paid(32, "CONSENTED")),
      // Team v1 (retired), its renewal already issued (TAS-513) — so the calendar does not issue a second one (TAS-515).
      tenant(ids.umbrella, "Umbrella", tom, 4, "ACTIVE", [], seatLimitOf(MOCK_PLAN_IDS.teamRetired), {
        ...umbrellaPaid,
        renewalIssuedFor: umbrellaPaid.paidThrough,
      }),
      // Blocked: no automatic payment is taken while it is (D145).
      tenant(ids.hooli, "Hooli", priya, 5, "ACTIVE", ["PLATFORM_BLOCK"], undefined, paid(38, "SUSPENDED")),
      {
        ...tenant(ids.massive, "Massive Dynamic", tom, 6, "AUTO_CLOSED", ["PENDING_FIRST_PAYMENT"]),
        creationDeadline: "2026-06-05T09:00:00Z",
      },
      // TAS-512: its renewal is cancelled — read-only at the paid-through, never moved to FREE on its own (D213).
      tenant(ids.longName, MOCK_LONG_TENANT_NAME, priya, 7, "ACTIVE", [], undefined, { ...paid(50, "DISABLED"), renewalCancelled: true }),
      {
        ...tenant(ids.stark, "Stark Industries", tom, 8, "AWAITING_PAYMENT", ["PENDING_FIRST_PAYMENT"]),
        createdAt: iso(seedAt - 20 * DAY),
        creationDeadline: iso(seedAt - 20 * DAY + CREATION_WINDOW_MS),
        version: "1",
      },
      {
        ...tenant(ids.wayne, "Wayne Enterprises", tom, 9, "OWNER_CANCELLED", ["PENDING_FIRST_PAYMENT"]),
        createdAt: iso(seedAt - 5 * DAY),
        creationDeadline: iso(seedAt - 5 * DAY + CREATION_WINDOW_MS),
        version: "2",
      },
      tenant(ids.vandelay, "Vandelay Industries", sofia, 10, "DELETED", [], free, freePlan),
      {
        ...tenant(ids.cyberdyne, "Cyberdyne Systems", tom, 11, "ACTIVE", [], seatLimitOf(MOCK_PLAN_IDS.team), {
          planVersionId: MOCK_PLAN_IDS.team,
          version: "4",
          paidThrough: cyberdyneThrough,
          anchorDay: new Date(cyberdyneThrough).getUTCDate(),
          renewalCancelled: false,
          autopayState: "DISABLED",
          renewalIssuedFor: cyberdyneThrough,
        }),
        createdAt: iso(cyberdyneCreated),
        invoiceMethod: "WIRE",
      },
    ],
    memberships: [
      member(ids.northwind, anna, "TENANT_ADMIN"),
      member(ids.northwind, sofia, "MEMBER"),
      member(ids.northwind, tom, "MEMBER"),
      member(ids.northwind, omar, "MEMBER", "SUSPENDED", 2),
      member(ids.globex, priya, "TENANT_ADMIN"),
      member(ids.globex, anna, "MEMBER"),
      member(ids.initech, sofia, "TENANT_ADMIN"),
      member(ids.initech, anna, "MEMBER"),
      member(ids.umbrella, tom, "TENANT_ADMIN"),
      member(ids.umbrella, priya, "TENANT_ADMIN"),
      member(ids.umbrella, anna, "MEMBER", "SUSPENDED"),
      member(ids.hooli, priya, "TENANT_ADMIN"),
      member(ids.hooli, sofia, "MEMBER"),
      member(ids.massive, tom, "TENANT_ADMIN"),
      member(ids.massive, sofia, "MEMBER"),
      member(ids.longName, priya, "TENANT_ADMIN"),
      member(ids.longName, sofia, "MEMBER"),
      member(ids.stark, tom, "TENANT_ADMIN"),
      member(ids.wayne, tom, "TENANT_ADMIN"),
      member(ids.vandelay, sofia, "TENANT_ADMIN", "REMOVED"),
      member(ids.cyberdyne, tom, "TENANT_ADMIN"),
      // An admin who is not the owner: no Billing, no document, no refund (TAS-514 B10).
      member(ids.cyberdyne, priya, "TENANT_ADMIN"),
    ],
    freeLedger: { [anna]: ids.northwind, [priya]: ids.globex, [sofia]: ids.vandelay },
    invitations: [
      {
        id: MOCK_INVITATION_IDS.kai,
        tenantId: ids.northwind,
        email: "kai@example.com",
        role: "MEMBER",
        state: "PENDING",
        issuedAt: iso(seedAt - 2 * DAY),
        expiresAt: iso(seedAt + 5 * DAY),
        createdBy: anna,
        projectGrants: [{ projectId: MOCK_PROJECT_IDS.web, role: "MEMBER" }],
        version: 1,
      },
      {
        id: MOCK_INVITATION_IDS.zoe,
        tenantId: ids.northwind,
        email: "zoe@example.com",
        role: "TENANT_ADMIN",
        state: "EXPIRED",
        issuedAt: iso(seedAt - 9 * DAY),
        expiresAt: iso(seedAt - 2 * DAY),
        createdBy: anna,
        projectGrants: [],
        version: 2,
      },
      {
        id: MOCK_INVITATION_IDS.lena,
        tenantId: ids.umbrella,
        email: "lena@example.com",
        role: "MEMBER",
        state: "PENDING",
        issuedAt: iso(seedAt - 1 * DAY),
        expiresAt: iso(seedAt + 6 * DAY),
        createdBy: priya,
        projectGrants: [{ projectId: MOCK_TENANT_PROJECT_IDS.umbrellaResearch, role: "VIEWER" }],
        version: 1,
      },
    ],
    taskLifetime: Object.fromEntries(
      MOCK_TASK_LIFETIME_SEED.map(([tenantId, projectId, count]) => [projectId, { tenantId, count }]),
    ),
    // TAS-513: what the server issued — every paid company's INITIAL, and the
    // RENEWAL of Umbrella's Team v1 (TAS-515: no longer onto an announced v2).
    // TAS-514: each with its snapshots as issued, the buyer the company's name then.
    invoices: [
      seedInvoice(1001, MOCK_INVOICE_IDS.initechInitial, named(ids.initech, "Initech"), "INITIAL", "PAID", MOCK_PLAN_IDS.team, at(3), DAY * 30),
      seedInvoice(1002, MOCK_INVOICE_IDS.umbrellaInitial, named(ids.umbrella, "Umbrella"), "INITIAL", "PAID", MOCK_PLAN_IDS.teamRetired, at(4), DAY * 30),
      seedInvoice(1003, MOCK_INVOICE_IDS.hooliInitial, named(ids.hooli, "Hooli"), "INITIAL", "PAID", MOCK_PLAN_IDS.team, at(5), DAY * 30),
      seedInvoice(1004, MOCK_INVOICE_IDS.massiveInitial, named(ids.massive, "Massive Dynamic"), "INITIAL", "EXPIRED", MOCK_PLAN_IDS.team, at(6), DAY * 30),
      seedInvoice(1005, MOCK_INVOICE_IDS.longNameInitial, named(ids.longName, MOCK_LONG_TENANT_NAME), "INITIAL", "PAID", MOCK_PLAN_IDS.team, at(7), DAY * 30),
      seedInvoice(
        1006,
        MOCK_INVOICE_IDS.starkInitial,
        named(ids.stark, "Stark Industries"),
        "INITIAL",
        "OPEN",
        MOCK_PLAN_IDS.team,
        iso(seedAt - 20 * DAY),
        CREATION_WINDOW_MS,
      ),
      seedInvoice(
        1007,
        MOCK_INVOICE_IDS.wayneInitial,
        named(ids.wayne, "Wayne Enterprises"),
        "INITIAL",
        "VOID",
        MOCK_PLAN_IDS.team,
        iso(seedAt - 5 * DAY),
        CREATION_WINDOW_MS,
      ),
      seedInvoice(
        1008,
        MOCK_INVOICE_IDS.umbrellaRenewal,
        named(ids.umbrella, "Umbrella"),
        "RENEWAL",
        "OPEN",
        MOCK_PLAN_IDS.teamRetired,
        iso(seedAt - DAY),
        // Due at the paid-through, never after it (TAS-515, art-director NB4): as the calendar issues it.
        Date.parse(umbrellaPaid.paidThrough ?? iso(seedAt)) - (seedAt - DAY),
      ),
      // TAS-514: Cyberdyne's, numbered in a series of their own so that the next invoice issued is still
      // TSK-2026-01009 (the TAS-515 specs read it).
      seedInvoice(901, MOCK_INVOICE_IDS.cyberdyneLateInitial, cyberdyne, "INITIAL", "EXPIRED", MOCK_PLAN_IDS.team, iso(cyberdyneCreated), WIRE_DUE_MS, {
        method: "WIRE",
      }),
      seedInvoice(902, MOCK_INVOICE_IDS.cyberdyneInitial, cyberdyne, "INITIAL", "PAID", MOCK_PLAN_IDS.team, iso(seedAt - 30 * DAY), WIRE_DUE_MS, {
        method: "WIRE",
        replacesInvoiceId: MOCK_INVOICE_IDS.cyberdyneLateInitial,
        // Three lines summing to the catalogue's €20 (B17).
        lines: [
          { description: "Team plan", quantity: 1, net: money("1500"), taxes: [], total: money("1500") },
          { description: "Additional seats", quantity: 5, net: money("400"), taxes: [], total: money("400") },
          { description: "Storage add-on", quantity: 1, net: money("100"), taxes: [], total: money("100") },
        ],
      }),
      // Online, in US dollars: Business's €40 at 1.0832, rounded half up once — $43.33, VAT a fraction (B17).
      seedInvoice(903, MOCK_INVOICE_IDS.cyberdynePlanChange, cyberdyne, "PLAN_CHANGE", "VOID", MOCK_PLAN_IDS.business, iso(seedAt - 15 * DAY), PLAN_CHANGE_DUE_MS, {
        method: "PSP",
        total: money("4333", "USD"),
        lines: [
          {
            description: "Business plan",
            quantity: 1,
            net: money("3581", "USD"),
            taxes: [{ label: "VAT", rate: "0.21", amount: money("752", "USD") }],
            total: money("4333", "USD"),
          },
        ],
        fxQuote: {
          baseCurrency: "EUR",
          quoteCurrency: "USD",
          rate: "1.0832",
          source: "Mock FX desk",
          observedAt: iso(seedAt - 15 * DAY - 10 * MINUTE),
          expiresAt: iso(seedAt - 15 * DAY + 50 * MINUTE),
        },
      }),
      seedInvoice(904, MOCK_INVOICE_IDS.cyberdyneRenewal, cyberdyne, "RENEWAL", "OPEN", MOCK_PLAN_IDS.team, iso(Date.parse(cyberdyneThrough) - RENEWAL_LEAD_MS), RENEWAL_LEAD_MS, {
        method: "WIRE",
      }),
    ],
    // TAS-514: what the admin recorded for Cyberdyne's first payment — the late money returned, the replacement's allocated.
    wireReceipts: [
      {
        id: "7e1a0c55-4d2b-4c1e-9f3a-000000000901",
        tenantId: ids.cyberdyne,
        paymentId: "8f2b1d66-5e3c-4d2f-8a4b-000000000901",
        amount: money("2000"),
        occurredAt: iso(seedAt - 31 * DAY),
        precision: "INSTANT",
        observedAt: iso(seedAt - 31 * DAY),
        invoiceId: MOCK_INVOICE_IDS.cyberdyneLateInitial,
        confirmedAt: iso(seedAt - 30 * DAY),
        outcome: "LATE_FIRST_PAYMENT",
        unallocated: money("0"),
        refundId: "9a3c2e77-6f4d-4e3a-9b5c-000000000901",
      },
      {
        id: "7e1a0c55-4d2b-4c1e-9f3a-000000000902",
        tenantId: ids.cyberdyne,
        paymentId: "8f2b1d66-5e3c-4d2f-8a4b-000000000902",
        amount: money("2000"),
        occurredAt: iso(seedAt - 27 * DAY),
        precision: "INSTANT",
        observedAt: iso(seedAt - 27 * DAY),
        invoiceId: MOCK_INVOICE_IDS.cyberdyneInitial,
        confirmedAt: iso(cyberdyneOpened),
        outcome: "ALLOCATED",
        unallocated: money("0"),
      },
    ],
    refunds: [
      {
        id: "9a3c2e77-6f4d-4e3a-9b5c-000000000901",
        tenantId: ids.cyberdyne,
        receiptId: "7e1a0c55-4d2b-4c1e-9f3a-000000000901",
        paymentId: "8f2b1d66-5e3c-4d2f-8a4b-000000000901",
        kind: "UNALLOCATED_RETURN",
        state: "CONFIRMED",
        amount: money("2000"),
        requestedAt: iso(seedAt - 30 * DAY),
        confirmedAt: iso(seedAt - 24 * DAY),
        version: 4,
        reasonCode: "LATE_FIRST_PAYMENT",
        sourceMethod: "WIRE",
        feeBearer: "TASKA",
        ...wireSla(seedAt - 30 * DAY),
        decidedAt: iso(seedAt - 29 * DAY),
        submittedAt: iso(seedAt - 25 * DAY),
      },
    ],
    invoiceSeq: 1009,
  };
}

/**
 * One seeded invoice: PAID ones fully allocated, the rest with all of it still
 * to pay; its snapshots as they were at issuance — the buyer the company then,
 * one line of its plan — unless `extra` gives its own (TAS-514).
 */
function seedInvoice(
  seq: number,
  id: string,
  tenant: Pick<StoredTenant, "id" | "name">,
  purpose: string,
  state: string,
  planVersionId: string,
  issuedAt: string,
  dueInMs: number,
  extra: { method?: string; replacesInvoiceId?: string; total?: StoredMoney; lines?: StoredLine[]; fxQuote?: StoredFxQuote } = {},
): StoredInvoice {
  const total = extra.total ?? planPrice(planVersionId);
  const number = invoiceNumber(seq);
  const method = extra.method ?? "PSP";
  return {
    id,
    tenantId: tenant.id,
    number,
    purpose,
    state,
    planVersionId,
    total,
    allocated: state === "PAID" ? { ...total } : zeroOf(total),
    remaining: state === "PAID" ? zeroOf(total) : { ...total },
    issuedAt,
    dueAt: new Date(Date.parse(issuedAt) + dueInMs).toISOString(),
    paymentMethod: method,
    version: state === "OPEN" ? 1 : 2,
    ...(extra.replacesInvoiceId === undefined ? {} : { replacesInvoiceId: extra.replacesInvoiceId }),
    buyer: buyerOf(tenant),
    seller: { ...MOCK_SELLER, address: { ...MOCK_SELLER.address } },
    lines: extra.lines ?? planLines(planVersionId, total),
    ...(method === "WIRE" && total.currency === "EUR" ? { wireInstructions: wireDetails(number, undefined) } : {}),
    ...(extra.fxQuote === undefined ? {} : { fxQuote: extra.fxQuote }),
    matchedUnallocated: zeroOf(total),
  };
}

/**
 * The seeded lifetime issue counters (TAS-512, api-contract-guard §5) — the
 * server's own numbers, not the stores' issue counts: a counter counts every
 * issue the project ever created, deleted ones included.
 */
export const MOCK_TASK_LIFETIME_SEED: ReadonlyArray<readonly [tenantId: string, projectId: string, count: number]> = [
  [MOCK_TENANT_IDS.northwind, MOCK_PROJECT_IDS.taska, 47],
  [MOCK_TENANT_IDS.northwind, MOCK_PROJECT_IDS.web, 50],
  [MOCK_TENANT_IDS.northwind, MOCK_PROJECT_IDS.mob, 12],
  [MOCK_TENANT_IDS.globex, MOCK_PROJECT_IDS.ops, 3],
  [MOCK_TENANT_IDS.globex, MOCK_TENANT_PROJECT_IDS.globexWeb, 2],
  [MOCK_TENANT_IDS.globex, MOCK_TENANT_PROJECT_IDS.globexFinance, 1],
  [MOCK_TENANT_IDS.initech, MOCK_TENANT_PROJECT_IDS.initechHelpdesk, 12],
  [MOCK_TENANT_IDS.umbrella, MOCK_TENANT_PROJECT_IDS.umbrellaResearch, 50],
  [MOCK_TENANT_IDS.hooli, MOCK_TENANT_PROJECT_IDS.hooliSearch, 1],
  [MOCK_TENANT_IDS.longName, MOCK_TENANT_PROJECT_IDS.longNameProject, 64],
];

/**
 * Each company's projects. Northwind is today's seed's TAS, WEB and MOB — with
 * Anna, its admin, on all three, Sofia on WEB only, Tom a viewer of TAS and
 * MOB as before; Mark and Priya, who are not in Northwind, are not on them.
 * Globex keeps OPS (Priya, and Anna as a member) and adds a WEB of its own —
 * another id, the same key, numbered from 12 as Northwind's is, so
 * `/browse/WEB-12` is a different issue in each — and FIN, neither of which
 * Anna is on.
 */
const TENANT_SEEDS: Readonly<Record<string, MockTenantSeed>> = {
  [MOCK_TENANT_IDS.northwind]: {
    keep: [
      { projectId: MOCK_PROJECT_IDS.taska, members: [[anna, "ADMIN"], [tom, "VIEWER"]] },
      { projectId: MOCK_PROJECT_IDS.web, members: [[anna, "ADMIN"], [sofia, "MEMBER"]] },
      { projectId: MOCK_PROJECT_IDS.mob, members: [[anna, "ADMIN"], [tom, "VIEWER"]] },
    ],
    add: [],
  },
  [MOCK_TENANT_IDS.globex]: {
    keep: [{ projectId: MOCK_PROJECT_IDS.ops, members: [[priya, "ADMIN"], [anna, "MEMBER"]] }],
    add: [
      {
        id: MOCK_TENANT_PROJECT_IDS.globexWeb,
        key: "WEB",
        name: "Globex Web",
        description: "Globex's storefront",
        createdAt: "2026-06-09T09:00:00Z",
        members: [[priya, "ADMIN"]],
        firstNumber: 12,
        issues: [
          {
            summary: "Checkout button overlaps the basket total on narrow screens",
            issueType: "BUG",
            status: "TODO",
            priority: "HIGH",
            assigneeId: priya,
            reporterId: priya,
          },
          {
            summary: "Translate the storefront into Spanish",
            issueType: "TASK",
            status: "IN_PROGRESS",
            priority: "MEDIUM",
            assigneeId: null,
            reporterId: priya,
          },
        ],
      },
      {
        id: MOCK_TENANT_PROJECT_IDS.globexFinance,
        key: "FIN",
        name: "Finance",
        description: "Invoices and quarterly close",
        createdAt: "2026-06-09T09:01:00Z",
        members: [[priya, "ADMIN"]],
        issues: [
          {
            summary: "Close Q2 books",
            issueType: "TASK",
            status: "TODO",
            priority: "HIGH",
            assigneeId: priya,
            reporterId: priya,
          },
        ],
      },
    ],
  },
  [MOCK_TENANT_IDS.initech]: {
    keep: [],
    add: [
      {
        id: MOCK_TENANT_PROJECT_IDS.initechHelpdesk,
        key: "HLP",
        name: "Helpdesk",
        description: "Internal IT requests",
        createdAt: "2026-06-09T09:02:00Z",
        members: [[sofia, "ADMIN"], [anna, "MEMBER"]],
        issues: [
          {
            summary: "Replace the printer on floor 3",
            issueType: "TASK",
            status: "TODO",
            priority: "LOW",
            assigneeId: anna,
            reporterId: sofia,
          },
          {
            summary: "TPS report cover sheets are out of stock",
            issueType: "BUG",
            status: "IN_PROGRESS",
            priority: "MEDIUM",
            assigneeId: sofia,
            reporterId: sofia,
          },
        ],
      },
    ],
  },
  [MOCK_TENANT_IDS.umbrella]: {
    keep: [],
    add: [
      {
        id: MOCK_TENANT_PROJECT_IDS.umbrellaResearch,
        key: "RND",
        name: "Research",
        createdAt: "2026-06-09T09:03:00Z",
        members: [[tom, "ADMIN"], [priya, "ADMIN"]],
        issues: [],
      },
    ],
  },
  [MOCK_TENANT_IDS.hooli]: {
    keep: [],
    add: [
      {
        id: MOCK_TENANT_PROJECT_IDS.hooliSearch,
        key: "HOO",
        name: "Hooli Search",
        createdAt: "2026-06-09T09:04:00Z",
        members: [[priya, "ADMIN"], [sofia, "MEMBER"]],
        issues: [
          {
            summary: "Middle-out compression benchmark",
            issueType: "TASK",
            status: "TODO",
            priority: "MEDIUM",
            assigneeId: sofia,
            reporterId: priya,
          },
        ],
      },
    ],
  },
  [MOCK_TENANT_IDS.longName]: {
    keep: [],
    add: [
      {
        id: MOCK_TENANT_PROJECT_IDS.longNameProject,
        key: "LNG",
        name: "Fulfilment",
        createdAt: "2026-06-09T09:05:00Z",
        members: [[priya, "ADMIN"], [sofia, "MEMBER"]],
        issues: [
          {
            summary: "Label printer queue stalls after 500 jobs",
            issueType: "BUG",
            status: "TODO",
            priority: "HIGH",
            assigneeId: null,
            reporterId: priya,
          },
        ],
      },
    ],
  },
  // TAS-514: Cyberdyne's one project, so the company has a Projects page to land on.
  [MOCK_TENANT_IDS.cyberdyne]: {
    keep: [],
    add: [
      {
        id: MOCK_TENANT_PROJECT_IDS.cyberdyneSkynet,
        key: "SKY",
        name: "Skynet",
        createdAt: "2026-10-02T09:00:00Z",
        members: [[tom, "ADMIN"], [priya, "MEMBER"]],
        issues: [
          {
            summary: "Pay the renewal by bank transfer",
            issueType: "TASK",
            status: "TODO",
            priority: "MEDIUM",
            assigneeId: tom,
            reporterId: tom,
          },
        ],
      },
    ],
  },
};

const EMPTY_SEED: MockTenantSeed = { keep: [], add: [] };

/** The two ends that close a company to new sessions in this mock (blueprint silent, ask A2). */
const CLOSED_LIFECYCLES: ReadonlySet<string> = new Set(["AUTO_CLOSED", "OWNER_CANCELLED", "DELETING"]);

export interface MockTenantServerOptions {
  storage: Storage;
  /** The account directory and the account's own routes: the store sign-in checks passwords against. */
  accountStore: MockTaskaStore;
  /** Base latency of a session route, ms (default 80); data routes keep the store's own. Tests pass 0. */
  latencyMs?: number;
  /** The clock, for tests. */
  now?: () => number;
  /**
   * TAS-513: the stand-in payment page's address for a checkout's token — the
   * app's own `/mock-checkout/{token}`, in the build's routing scheme.
   */
  checkoutUrl?: (token: string) => string;
}

const defaultCheckoutUrl = (token: string) =>
  new URL(`/mock-checkout/${encodeURIComponent(token)}`, globalThis.location?.origin ?? "http://localhost").href;

export class MockTenantServer {
  private readonly storage: Storage;
  private readonly accountStore: MockTaskaStore;
  private readonly latencyMs: number;
  private readonly now: () => number;
  private readonly checkoutUrl: (token: string) => string;
  /** This page's company stores, built on first use from `TENANT_SEEDS`. */
  private readonly stores = new Map<string, MockTaskaStore>();
  /** Used only when `storage` refuses (a locked-down profile): the state then lives as long as the page. */
  private memory: ServerState | null = null;
  /** The `cleared` entries each of this page's company stores has applied, by `seq` (TAS-502). */
  private readonly appliedClears = new Map<string, Set<number>>();

  constructor(options: MockTenantServerOptions) {
    this.storage = options.storage;
    this.accountStore = options.accountStore;
    this.latencyMs = options.latencyMs ?? 80;
    this.now = options.now ?? Date.now;
    this.checkoutUrl = options.checkoutUrl ?? defaultCheckoutUrl;
    // Nina is today's seed's BLOCKED account; here she is the account without
    // a company, so she has to be able to sign in.
    this.accountStore.overrideAccountStatus(MOCK_ACCOUNT_IDS.nina, "ACTIVE");
  }

  /** The blueprint routes the session layer sends — TAS-500's five, and TAS-501's creation routes. */
  transport(): B2bTransport {
    return {
      startWebSession: (input, key) => this.startWebSession(input, key),
      refreshWebSession: (refreshToken, key) => this.refreshWebSession(refreshToken, key),
      listTenants: (bearer, params) => this.listTenants(bearer, params),
      createTenantSession: (bearer, tenantId, key) => this.createTenantSession(bearer, tenantId, key),
      revokeTenantSession: (bearer, tenantSessionId) => this.revokeTenantSession(bearer, tenantSessionId),
      listBillingPlans: (params) => this.listBillingPlans(params),
      createTenant: (bearer, input, key) => this.createTenant(bearer, input, key),
      getTenant: (bearer, tenantId) => this.getTenant(bearer, tenantId),
      getTenantOperation: (bearer, tenantId, operationId) => this.getTenantOperation(bearer, tenantId, operationId),
      cancelTenantCreation: (bearer, tenantId, version, key) => this.cancelTenantCreation(bearer, tenantId, version, key),
      listTenantMembers: (bearer, tenantId, params) => this.listTenantMembers(bearer, tenantId, params),
      setTenantMemberRole: (bearer, tenantId, userId, role, version, key) =>
        this.setTenantMemberRole(bearer, tenantId, userId, role, version, key),
      setTenantMemberState: (bearer, tenantId, userId, memberState, version, key) =>
        this.setTenantMemberState(bearer, tenantId, userId, memberState, version, key),
      removeTenantMember: (bearer, tenantId, userId, version, key) => this.removeTenantMember(bearer, tenantId, userId, version, key),
      leaveTenant: (bearer, tenantId, key) => this.leaveTenant(bearer, tenantId, key),
      listTenantInvitations: (bearer, tenantId, params) => this.listTenantInvitations(bearer, tenantId, params),
      createTenantInvitation: (bearer, tenantId, input, key) => this.createTenantInvitation(bearer, tenantId, input, key),
      resendTenantInvitation: (bearer, tenantId, invitationId, key) => this.resendTenantInvitation(bearer, tenantId, invitationId, key),
      revokeTenantInvitation: (bearer, tenantId, invitationId, version, key) =>
        this.revokeTenantInvitation(bearer, tenantId, invitationId, version, key),
      getTenantQuotas: (bearer, tenantId) => this.getTenantQuotas(bearer, tenantId),
      renameTenant: (bearer, tenantId, name, version, key) => this.renameTenant(bearer, tenantId, name, version, key),
      pauseTenant: (bearer, tenantId, version, key) => this.pauseTenant(bearer, tenantId, version, key),
      resumeTenant: (bearer, tenantId, version, key) => this.resumeTenant(bearer, tenantId, version, key),
      transferTenantOwnership: (bearer, tenantId, newOwnerUserId, version, key) =>
        this.transferTenantOwnership(bearer, tenantId, newOwnerUserId, version, key),
      getSubscription: (bearer, tenantId) => this.getSubscription(bearer, tenantId),
      getEntitlement: (bearer, tenantId) => this.getEntitlement(bearer, tenantId),
      listInvoices: (bearer, tenantId, params) => this.listInvoices(bearer, tenantId, params),
      getInvoice: (bearer, tenantId, invoiceId) => this.getInvoice(bearer, tenantId, invoiceId),
      createCheckout: (bearer, tenantId, invoiceId, returnTarget, key) => this.createCheckout(bearer, tenantId, invoiceId, returnTarget, key),
      getCheckout: (bearer, tenantId, checkoutId) => this.getCheckout(bearer, tenantId, checkoutId),
      getInvoiceDocument: (bearer, tenantId, invoiceId) => this.getInvoiceDocument(bearer, tenantId, invoiceId),
      listRefunds: (bearer, tenantId, params) => this.listRefunds(bearer, tenantId, params),
      getTenantCapabilities: (bearer, tenantId) => this.getTenantCapabilities(bearer, tenantId),
      changeSubscriptionPlan: (bearer, tenantId, input, version, key) => this.changeSubscriptionPlan(bearer, tenantId, input, version, key),
      cancelSubscriptionRenewal: (bearer, tenantId, version, key) => this.setRenewalCancelled(bearer, tenantId, true, version, key),
      resumeSubscriptionRenewal: (bearer, tenantId, version, key) => this.setRenewalCancelled(bearer, tenantId, false, version, key),
      setAutopayConsent: (bearer, tenantId, consent, version, key) => this.setAutopayConsent(bearer, tenantId, consent, version, key),
    };
  }

  /**
   * One data call: the bearer checked against `kind`, then `run` on the store
   * it opens — the company's for a company route, the account's for the
   * account's own — signed in as the bearer's account.
   *
   * Since TAS-512 three company writes meet the plan's quotas here, after the
   * session's check (a restriction is `READ_ONLY` first) and before the store
   * writes (api-contract-guard §5): `createIssue` — the project's own ACL,
   * then its lifetime counter at or over a finite `TASK_LIFETIME` is 422
   * `QUOTA_EXCEEDED` with no reasons, and a stored issue moves the counter up;
   * `createProject` — 422 when `used + 1 > limit`; `createAttachmentUploadUrl`
   * — 422 when `used + reserved + size > limit`. `args` are the method's.
   */
  async serve<T>(
    bearer: string | null,
    kind: MockRouteKind,
    operation: string,
    run: (store: MockTaskaStore) => Promise<T>,
    args: readonly unknown[] = [],
  ): Promise<T> {
    await this.delay(operation, 0);
    const { grant, members, cleared } = this.read((state) => {
      const granted = this.authorize(state, bearer, kind);
      const tenantId = granted.tenantId;
      // The company's directory is its active members (TENANT_DIRECTORY, backend TAS-321).
      const active =
        tenantId === null
          ? null
          : new Set(
              state.memberships
                .filter((item) => item.tenantId === tenantId && this.membershipState(state, tenantId, item.userId) === "ACTIVE")
                .map((item) => item.userId),
            );
      return { grant: granted, members: active, cleared: tenantId === null ? [] : state.cleared.filter((item) => item.tenantId === tenantId) };
    });
    const store = kind === "account" || grant.tenantId === null ? this.accountStore : this.tenantStore(grant.tenantId);
    if (grant.tenantId !== null && store !== this.accountStore) this.applyClears(grant.tenantId, cleared);
    if (!store.restoreSession(grant.userId)) throw problem(401, "AUTHENTICATION_REQUIRED", "Invalid session");
    if (store !== this.accountStore) store.scopeDirectory(members);
    if (grant.tenantId === null || store === this.accountStore) return run(store);
    const counted = this.meetQuota(grant.tenantId, operation, args, store);
    const answer = await run(store);
    counted?.();
    return answer;
  }

  /**
   * The plan's quota in front of the three writes that use one (see `serve`),
   * or `null` for any other operation. Answers what to record once the write
   * has been stored.
   */
  private meetQuota(tenantId: string, operation: string, args: readonly unknown[], store: MockTaskaStore): (() => void) | null {
    const exceeded = (title: string) => problem(422, "QUOTA_EXCEEDED", title);
    const planOf = (state: ServerState) => state.tenants.find((item) => item.id === tenantId)?.subscription.planVersionId ?? "";
    if (operation === "createIssue") {
      const projectId = typeof args[0] === "string" ? args[0] : "";
      // The project's own checks first: one that is not there stays the store's 404.
      store.getProject(projectId);
      this.read((state) => {
        const limit = planLimitOf(planOf(state), "TASK_LIFETIME");
        const count = state.taskLifetime[projectId]?.count ?? 0;
        if (limit !== null && BigInt(count) >= BigInt(limit)) throw exceeded("The project has reached its plan's issue limit");
      });
      return () =>
        this.write((state) => {
          const entry = state.taskLifetime[projectId];
          state.taskLifetime[projectId] = { tenantId, count: (entry?.count ?? 0) + 1 };
        });
    }
    if (operation === "createProject") {
      this.read((state) => {
        const limit = planLimitOf(planOf(state), "PROJECT");
        if (limit !== null && BigInt(store.projectCount()) + 1n > BigInt(limit)) throw exceeded("The tenant has reached its plan's project limit");
      });
      return () => this.bumpQuotaVersion(tenantId);
    }
    if (operation === "createAttachmentUploadUrl") {
      const input = typeof args[2] === "object" && args[2] !== null ? (args[2] as { sizeBytes?: unknown }) : {};
      const size = typeof input.sizeBytes === "number" && Number.isInteger(input.sizeBytes) && input.sizeBytes > 0 ? BigInt(input.sizeBytes) : 0n;
      this.read((state) => {
        const limit = planLimitOf(planOf(state), "STORAGE_BYTES");
        const usage = store.storageUsage();
        if (limit !== null && usage.used + usage.reserved + size > BigInt(limit)) throw exceeded("The tenant has reached its plan's storage limit");
      });
      return () => this.bumpQuotaVersion(tenantId);
    }
    if (operation === "confirmAttachmentUpload" || operation === "deleteAttachment" || operation === "archiveProject") {
      return () => this.bumpQuotaVersion(tenantId);
    }
    return null;
  }

  private bumpQuotaVersion(tenantId: string): void {
    this.write((state) => {
      const tenant = state.tenants.find((item) => item.id === tenantId);
      if (tenant) tenant.quotaVersion += 1;
    });
  }

  /* ------------------------------------------------------------ the routes */

  /**
   * `POST /auth/web-sessions`. The password is checked as today's mock checks
   * it (any password for an `ACTIVE` account; a locked account's refusal as
   * it is). A GLOBAL_ADMIN gets the blueprint's `MfaChallenge` and no session
   * — backend PR #288 answers 403 `MFA_REQUIRED` instead, which the session
   * layer reads as the same dead end (unit-tested against `RestTaskaApi`).
   */
  private async startWebSession(input: LoginInput, key: string): Promise<unknown> {
    await this.delay("startWebSession");
    return this.write((state) => {
      const replay = this.replay(state, key, "startWebSession", input.email);
      if (replay !== undefined) return replay;
      try {
        this.accountStore.login(input);
      } catch (error) {
        if (apiErrorFacts(error).code === "UNAUTHENTICATED") throw problem(401, "AUTHENTICATION_REQUIRED", "Invalid credentials");
        throw error;
      }
      const user = this.accountStore.currentUser();
      let answer: unknown;
      if (user.globalRole === "GLOBAL_ADMIN") {
        answer = {
          challengeId: uuid(),
          purpose: "ADMIN_LOGIN",
          expiresAt: new Date(this.now() + 10 * MINUTE).toISOString(),
          delivery: "EMAIL",
          maskedDestination: user.email.replace(/^(.).*(@.*)$/, "$1•••$2"),
          retryAfterSeconds: 60,
        };
      } else {
        const session: StoredSession = { id: uuid(), kind: "WEB_GLOBAL", userId: user.id, expiresAt: this.now() + FAMILY_LIFETIME_MS };
        state.sessions.push(session);
        answer = this.issue(state, session);
      }
      state.receipts[key] = { operation: "startWebSession", hash: input.email, at: this.now(), answer };
      return answer;
    });
  }

  /**
   * `POST /auth/web-sessions/refresh`, for both families. Single use: the
   * spent token with the same key within 60 s answers the same pair, after
   * that 409 `INVALID_STATE`; with a different key it is a reuse, which
   * revokes the family — an account session with every company session under
   * it. Every other refusal is backend PR #288's one 401 "Invalid session",
   * including a company session whose membership is no longer active (ask A3).
   */
  private async refreshWebSession(refreshToken: string, key: string): Promise<unknown> {
    await this.delay("refreshWebSession");
    return this.write((state) => {
      const entry = state.refresh[refreshToken];
      if (!entry) throw problem(401, "AUTHENTICATION_REQUIRED", "Invalid session");
      const session = state.sessions.find((item) => item.id === entry.sessionId);
      if (!session) throw problem(401, "AUTHENTICATION_REQUIRED", "Invalid session");
      if (entry.spentAt !== undefined) {
        if (entry.receipt && entry.receipt.key === key) {
          if (this.now() - entry.receipt.at <= SECRET_RECEIPT_MS) return entry.receipt.answer;
          throw problem(409, "INVALID_STATE", "The refresh was already used");
        }
        this.revokeFamily(state, session);
        throw problem(401, "TOKEN_REVOKED", "Invalid session");
      }
      if (!this.alive(state, session)) throw problem(401, "TOKEN_REVOKED", "Invalid session");
      if (session.kind === "WEB_TENANT" && this.membershipState(state, session.tenantId ?? "", session.userId) !== "ACTIVE") {
        session.revokedAt = this.now();
        throw problem(401, "TOKEN_REVOKED", "Invalid session");
      }
      const answer = this.issue(state, session);
      entry.spentAt = this.now();
      entry.receipt = { key, at: this.now(), answer };
      return answer;
    });
  }

  /**
   * `GET /tenants`: the companies the reader is an `ACTIVE` member of — which
   * is the mock's reading of a list the blueprint leaves unstated (ask A1) — in
   * `(createdAt, id)` order, `limit` 1–100 (default 50), an opaque cursor bound
   * to the reader, `nextCursor` absent at the end.
   */
  private async listTenants(bearer: string, params: ListTenantsParams): Promise<unknown> {
    await this.delay("listTenants");
    return this.read((state) => {
      const grant = this.authorizeCommand(state, bearer);
      const limit = params.limit ?? 50;
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw problem(400, "VALIDATION_FAILED", "limit must be 1–100");
      const offset = params.cursor === undefined ? 0 : this.readCursor(params.cursor, grant.userId);
      const listed = state.tenants
        .filter((tenant) => this.membershipState(state, tenant.id, grant.userId) === "ACTIVE")
        .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const items = listed.slice(offset, offset + limit).map((tenant) => this.wireTenant(tenant));
      const next = offset + limit;
      return next < listed.length ? { items, nextCursor: this.writeCursor(next, grant.userId) } : { items };
    });
  }

  /**
   * `POST /auth/tenant-sessions`. Who may: an `ACTIVE` member. A company the
   * reader is not in is the same 404 `TENANT_NOT_FOUND` as one that does not
   * exist; a suspended membership is 403 `MEMBERSHIP_INACTIVE`; a deleted
   * company is 404; and **this mock's** answer for a closed one (`AUTO_CLOSED`,
   * `OWNER_CANCELLED`, `DELETING`) is 409 `INVALID_STATE` — the blueprint does
   * not say (ask A2), so the screens render whatever the answer is.
   */
  private async createTenantSession(bearer: string, tenantId: string, key: string): Promise<unknown> {
    await this.delay("createTenantSession");
    return this.write((state) => {
      const grant = this.authorizeCommand(state, bearer);
      const replay = this.replay(state, key, "createTenantSession", tenantId);
      if (replay !== undefined) return replay;
      if (!UUID_PATTERN.test(tenantId)) throw problem(400, "VALIDATION_FAILED", "tenantId must be a UUID");
      const tenant = state.tenants.find((item) => item.id === tenantId);
      const membership = this.membershipState(state, tenantId, grant.userId);
      if (!tenant || membership === null || membership === "REMOVED" || tenant.lifecycle === "DELETED") {
        throw problem(404, "TENANT_NOT_FOUND", "Tenant not found");
      }
      if (membership !== "ACTIVE") throw problem(403, "MEMBERSHIP_INACTIVE", "Membership is not active");
      if (CLOSED_LIFECYCLES.has(tenant.lifecycle)) throw problem(409, "INVALID_STATE", "The company is closed");
      const parent = state.sessions.find((item) => item.id === grant.sessionId);
      const session: StoredSession = {
        id: uuid(),
        kind: "WEB_TENANT",
        userId: grant.userId,
        tenantId,
        parentId: grant.sessionId,
        expiresAt: parent?.expiresAt ?? this.now() + FAMILY_LIFETIME_MS,
      };
      state.sessions.push(session);
      const answer = this.issue(state, session);
      state.receipts[key] = { operation: "createTenantSession", hash: tenantId, at: this.now(), answer };
      return answer;
    });
  }

  /**
   * `DELETE /auth/tenant-sessions/{id}`: 204 for the reader's own company
   * session, revoked or not; **404 `RESOURCE_NOT_FOUND` for an id that is not
   * one** — the blueprint's (contracts §6). Backend PR #288 answers 401
   * "Invalid session" there instead, which the session layer is written not to
   * read as the account dying.
   */
  private async revokeTenantSession(bearer: string, tenantSessionId: string): Promise<void> {
    await this.delay("revokeTenantSession");
    this.write((state) => {
      const grant = this.authorizeCommand(state, bearer);
      if (!UUID_PATTERN.test(tenantSessionId)) throw problem(400, "VALIDATION_FAILED", "sessionId must be a UUID");
      const session = state.sessions.find(
        (item) => item.id === tenantSessionId && item.kind === "WEB_TENANT" && item.userId === grant.userId,
      );
      if (!session) throw problem(404, "RESOURCE_NOT_FOUND", "Session not found");
      session.revokedAt ??= this.now();
    });
  }

  /* ------------------------------------------------ creating a company (TAS-501) */

  /** `GET /billing/plans`: public, `limit` 1–100 (default 50), every state, `nextCursor` absent at the end. */
  private async listBillingPlans(params: ListBillingPlansParams): Promise<unknown> {
    await this.delay("listBillingPlans");
    const refusal = this.takeRefusal("listBillingPlans");
    if (refusal) throw refusal;
    const limit = params.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw problem(400, "VALIDATION_FAILED", "limit must be 1–100");
    const offset = params.cursor === undefined ? 0 : this.readCursor(params.cursor, "billing-plans");
    const items = MOCK_PLANS.slice(offset, offset + limit).map((plan) => structuredClone(plan));
    const next = offset + limit;
    return next < MOCK_PLANS.length ? { items, nextCursor: this.writeCursor(next, "billing-plans") } : { items };
  }

  /**
   * `POST /tenants` — develop's order (`TenantRegistryService`, TAS-310): the
   * account session only (a company session is 403 `SCOPE_DENIED`); a key
   * that is not a canonical UUID is 400; a key seen before with the same body
   * replays the company **as it is now** (a deleted one, or one the reader is
   * no longer an active member of, is 404 `TENANT_NOT_FOUND`), with another
   * body is 409 `IDEMPOTENCY_CONFLICT`; then the name (the shared rule) and a
   * `PUBLISHED` plan, both 400 `VALIDATION_FAILED` without violations; then
   * the FREE ledger, 409 `FREE_ELIGIBILITY_USED`. A FREE company starts
   * PROVISIONING; a paid one AWAITING_PAYMENT with the 30-day deadline and
   * `PENDING_FIRST_PAYMENT`, and never touches the ledger. The operation is
   * answered as develop answers it — PENDING, `updatedAt = createdAt` — on
   * the first send and on every replay (ask A12).
   */
  private async createTenant(bearer: string, input: CreateTenantInput, key: string): Promise<unknown> {
    await this.delay("createTenant");
    const answer = this.write((state) => {
      const grant = this.authorizeCommand(state, bearer);
      const refusal = this.takeRefusal("createTenant");
      if (refusal) throw refusal;
      if (!CANONICAL_KEY.test(key)) throw problem(400, "VALIDATION_FAILED", "Idempotency-Key must be a canonical UUID");
      const hash = JSON.stringify({ name: input.name, planVersionId: input.planVersionId });
      const receiptKey = `${grant.userId}:${key}`;
      const receipt = state.creations[receiptKey];
      if (receipt) {
        if (receipt.hash !== hash) throw problem(409, "IDEMPOTENCY_CONFLICT", "The key was used for another request");
        const tenant = state.tenants.find((item) => item.id === receipt.tenantId);
        const operation = state.operations.find((item) => item.id === receipt.operationId);
        if (!tenant || !operation || tenant.lifecycle === "DELETED" || this.membershipState(state, tenant.id, grant.userId) !== "ACTIVE") {
          throw problem(404, "TENANT_NOT_FOUND", "Tenant not found");
        }
        return this.creationAnswer(tenant, operation);
      }
      if (typeof input.name !== "string" || tenantNameProblem(input.name) !== null) {
        throw problem(400, "VALIDATION_FAILED", "Invalid request");
      }
      const plan = MOCK_PLANS.find((item) => item.id === input.planVersionId && item.state === "PUBLISHED");
      if (!plan) throw problem(400, "VALIDATION_FAILED", "Invalid request");
      const free = plan.kind === "FREE";
      if (free && state.freeLedger[grant.userId] !== undefined) {
        throw problem(409, "FREE_ELIGIBILITY_USED", "The free company allowance has been used");
      }
      const createdMs = this.lifecycleNow();
      const createdAt = new Date(createdMs).toISOString();
      const tenant: StoredTenant = {
        id: uuid(),
        name: input.name,
        ownerId: grant.userId,
        lifecycle: free ? "PROVISIONING" : "AWAITING_PAYMENT",
        restrictions: free ? [] : ["PENDING_FIRST_PAYMENT"],
        createdAt,
        ...(free ? {} : { creationDeadline: new Date(createdMs + CREATION_WINDOW_MS).toISOString() }),
        version: "1",
        ownerVersion: "1",
        // FREE, or a paid plan before its first payment: no paid period yet (TAS-504).
        subscription: unpaid(plan.id),
        seatLimit: seatLimitOf(plan.id),
        quotaVersion: 1,
        generation: 1,
        entitlementVersion: 1,
        quotaBreach: [],
      };
      const operation: StoredOperation = {
        id: uuid(),
        tenantId: tenant.id,
        actorId: grant.userId,
        type: "TENANT_PROVISION",
        createdAt,
        state: "PENDING",
        updatedAt: createdAt,
      };
      state.tenants.push(tenant);
      state.memberships.push({
        id: uuid(),
        tenantId: tenant.id,
        userId: grant.userId,
        role: "TENANT_ADMIN",
        state: "ACTIVE",
        version: 1,
        joinedAt: createdAt,
      });
      state.operations.push(operation);
      if (free) state.freeLedger[grant.userId] = tenant.id;
      // TAS-513: a paid company's first invoice, issued by the server with the
      // company — the blueprint names no issuer (A53); due at its deadline —
      // TAS-514: by bank transfer, a week on, never after it.
      if (!free) {
        const deadline = Date.parse(tenant.creationDeadline ?? new Date(createdMs + CREATION_WINDOW_MS).toISOString());
        const wire = this.methodFor(tenant) === "WIRE";
        this.issueInvoice(state, tenant, "INITIAL", plan.id, createdMs, wire ? Math.min(createdMs + WIRE_DUE_MS, deadline) : deadline);
      }
      state.creations[receiptKey] = { hash, tenantId: tenant.id, operationId: operation.id };
      // A zero `stepMs` finishes provisioning in the same answer.
      this.evaluate(state);
      return this.creationAnswer(tenant, operation);
    });
    // Committed, and the answer never arrives (AC 3): the same key replays it.
    if (this.takeLostAnswer("createTenant")) throw new TypeError("Failed to fetch");
    return answer;
  }

  /** `GET /tenants/{tenantId}` — the tab's company session of that company; not stopped by a restriction. */
  private async getTenant(bearer: string | null, tenantId: string): Promise<unknown> {
    await this.delay("getTenant");
    return this.read((state) => this.wireTenant(this.authorizeControl(state, bearer, tenantId, "getTenant").tenant));
  }

  /** `GET /tenants/{tenantId}/operations/{operationId}` — its actor only; another's, or another company's, is 404. */
  private async getTenantOperation(bearer: string | null, tenantId: string, operationId: string): Promise<unknown> {
    await this.delay("getTenantOperation");
    return this.read((state) => {
      const { session } = this.authorizeControl(state, bearer, tenantId, "getTenantOperation");
      if (!UUID_PATTERN.test(operationId)) throw problem(400, "VALIDATION_FAILED", "operationId must be a UUID");
      const operation = state.operations.find(
        (item) => item.id === operationId && item.tenantId === tenantId && item.actorId === session.userId,
      );
      if (!operation) throw problem(404, "RESOURCE_NOT_FOUND", "Operation not found");
      return this.wireOperation(operation, false);
    });
  }

  /**
   * `POST /tenants/{tenantId}/cancel-creation`: the owner only (403
   * `OWNER_REQUIRED`), the lifecycle before the version (409 `INVALID_STATE`
   * once it no longer awaits payment, then 412 `VERSION_CONFLICT`), and a
   * durable receipt per `{actor}:{key}`. The deadline is never extended.
   */
  private async cancelTenantCreation(bearer: string | null, tenantId: string, version: string, key: string): Promise<unknown> {
    await this.delay("cancelTenantCreation");
    return this.write((state) => {
      const { session, tenant } = this.authorizeControl(state, bearer, tenantId, "cancelTenantCreation");
      if (!CANONICAL_KEY.test(key)) throw problem(400, "VALIDATION_FAILED", "Idempotency-Key must be a canonical UUID");
      const receiptKey = `${session.userId}:${key}`;
      const hash = `${tenantId}:${version}`;
      const receipt = state.cancels[receiptKey];
      if (receipt) {
        if (receipt.hash !== hash) throw problem(409, "IDEMPOTENCY_CONFLICT", "The key was used for another request");
        return receipt.answer;
      }
      if (tenant.ownerId !== session.userId) throw problem(403, "OWNER_REQUIRED", "Only the owner can cancel the creation");
      if (tenant.lifecycle !== "AWAITING_PAYMENT") throw problem(409, "INVALID_STATE", "The company is not awaiting payment");
      if (!/^[0-9]+$/.test(version)) throw problem(428, "VALIDATION_FAILED", "If-Match is required");
      if (version !== tenant.version) throw problem(412, "VERSION_CONFLICT", "The company has changed");
      tenant.lifecycle = "OWNER_CANCELLED";
      tenant.version = nextVersion(tenant.version);
      const answer = this.wireTenant(tenant);
      state.cancels[receiptKey] = { hash, answer };
      return answer;
    });
  }

  /* ------------------------------ members, invitations and seats (TAS-502) */

  /*
   * api-contract-guard §7, with the orchestrator's rulings: PR #287's order of
   * checks — (1) the company ACTIVE, (2) the caller ACTIVE, (3) the caller a
   * TENANT_ADMIN, (4) the route's restriction policy, (5) the key's receipt,
   * (6) the target, (7) the owner, (8) the version, (9) the last admin, (10)
   * apply — **except where develop deviates from the blueprint**: a change to
   * a target that is not ACTIVE is 409 `INVALID_STATE` (never the caller's
   * 403 `MEMBERSHIP_INACTIVE`, ask A17), and a change to the caller's own
   * membership never refuses the caller's next request (no stale-generation
   * refusal, ask A18 — the role is checked online, contracts §2).
   */

  /**
   * `GET /tenants/{t}/members`: ACTIVE and SUSPENDED, `(joinedAt, userId)`,
   * `limit` 1–100 (default 50), the cursor bound to the reader, the company
   * and the membership generation — a change meanwhile makes it a 400, as
   * develop does. The profile fields come from the account store (the
   * blueprint's to-be, TAS-321); `avatarPath` is never sent (no route loads
   * it, B7).
   */
  private async listTenantMembers(bearer: string | null, tenantId: string, params: ListCompanyPageParams): Promise<unknown> {
    await this.delay("listTenantMembers");
    return this.read((state) => {
      const { session, tenant } = this.authorizeMembers(state, bearer, tenantId, "listTenantMembers", "DIRECTORY");
      const limit = this.pageLimit(params);
      const bound = `members:${tenantId}:${tenant.generation}`;
      const offset = params.cursor === undefined ? 0 : this.readCursor(params.cursor, `${session.userId}:${bound}`);
      const listed = state.memberships
        .filter((item) => item.tenantId === tenantId && (item.state === "ACTIVE" || item.state === "SUSPENDED"))
        .sort((a, b) => (a.joinedAt < b.joinedAt ? -1 : a.joinedAt > b.joinedAt ? 1 : a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
      const items = listed.slice(offset, offset + limit).map((item) => this.wireMembership(state, tenant, item));
      const next = offset + limit;
      return next < listed.length ? { items, nextCursor: this.writeCursor(next, `${session.userId}:${bound}`) } : { items };
    });
  }

  /**
   * `PATCH …/members/{userId}/role`. A demotion revokes the person's pending
   * invitations (L03, B03) and nothing else: their sessions stay, and the role
   * is checked online on their next request (contracts §2, ruling 2 — only a
   * suspension or a removal ends a person's access). The same role is a no-op
   * 200 at the same version.
   */
  private async setTenantMemberRole(
    bearer: string | null,
    tenantId: string,
    userId: string,
    role: KnownMembershipRole,
    version: string,
    key: string,
  ): Promise<unknown> {
    await this.delay("setTenantMemberRole");
    return this.write((state) => {
      const { session, tenant } = this.authorizeMembers(state, bearer, tenantId, "setTenantMemberRole", "NORMAL");
      if (!isKnownMembershipRole(role)) {
        throw invalid("Invalid request", [{ field: "role", code: "INVALID", message: "role must be MEMBER or TENANT_ADMIN" }]);
      }
      const receipt = this.memberReceipt(state, session.userId, "setTenantMemberRole", key, { userId, role, version });
      if (receipt.replay !== undefined) return receipt.replay;
      const target = this.targetMembership(state, tenantId, userId);
      if (this.membershipState(state, tenantId, userId) !== "ACTIVE") {
        throw problem(409, "INVALID_STATE", "The membership is not active");
      }
      if (tenant.ownerId === userId) throw problem(409, "OWNER_MEMBERSHIP_PROTECTED", "The owner's membership is protected");
      this.checkVersion(version, target.version);
      if (target.role === role) return receipt.keep(this.wireMembership(state, tenant, target));
      if (target.role === "TENANT_ADMIN" && this.otherActiveAdmins(state, tenantId, userId) === 0) {
        throw problem(409, "LAST_ADMIN", "The last active admin cannot be demoted");
      }
      target.role = role;
      target.version += 1;
      tenant.generation += 1;
      if (role === "MEMBER") this.revokeInvitationsBy(state, tenant, userId);
      return receipt.keep(this.wireMembership(state, tenant, target));
    });
  }

  /**
   * `PATCH …/members/{userId}/state`. Suspending keeps the seat and revokes
   * the person's company sessions, pending invitations, project rows and
   * assignments (contracts §8); reactivating restores none of them and
   * answers MEMBER, whatever the role was (L03).
   */
  private async setTenantMemberState(
    bearer: string | null,
    tenantId: string,
    userId: string,
    memberState: "ACTIVE" | "SUSPENDED",
    version: string,
    key: string,
  ): Promise<unknown> {
    await this.delay("setTenantMemberState");
    return this.write((state) => {
      const { session, tenant } = this.authorizeMembers(state, bearer, tenantId, "setTenantMemberState", "NORMAL");
      if (memberState !== "ACTIVE" && memberState !== "SUSPENDED") {
        throw invalid("Invalid request", [{ field: "state", code: "INVALID", message: "state must be ACTIVE or SUSPENDED" }]);
      }
      const receipt = this.memberReceipt(state, session.userId, "setTenantMemberState", key, { userId, state: memberState, version });
      if (receipt.replay !== undefined) return receipt.replay;
      const target = this.targetMembership(state, tenantId, userId);
      const now = this.membershipState(state, tenantId, userId);
      if (memberState === "SUSPENDED" && now !== "ACTIVE") throw problem(409, "INVALID_STATE", "The membership is not active");
      if (memberState === "ACTIVE" && now !== "SUSPENDED") throw problem(409, "INVALID_STATE", "The membership is not suspended");
      if (tenant.ownerId === userId) throw problem(409, "OWNER_MEMBERSHIP_PROTECTED", "The owner's membership is protected");
      this.checkVersion(version, target.version);
      if (memberState === "SUSPENDED") {
        if (target.role === "TENANT_ADMIN" && this.otherActiveAdmins(state, tenantId, userId) === 0) {
          throw problem(409, "LAST_ADMIN", "The last active admin cannot be suspended");
        }
        target.state = "SUSPENDED";
        this.cutOff(state, tenant, userId);
      } else {
        target.state = "ACTIVE";
        target.role = "MEMBER";
      }
      target.version += 1;
      tenant.generation += 1;
      return receipt.keep(this.wireMembership(state, tenant, target));
    });
  }

  /**
   * `DELETE …/members/{userId}` — 202 with an operation of its own; the
   * removal is applied, and the seat released, when it succeeds
   * (`memberOperationStepMs`). A removal already under way is 409.
   */
  private async removeTenantMember(bearer: string | null, tenantId: string, userId: string, version: string, key: string): Promise<unknown> {
    await this.delay("removeTenantMember");
    return this.write((state) => {
      const { session, tenant } = this.authorizeMembers(state, bearer, tenantId, "removeTenantMember", "RECOVERY");
      const receiptKey = `${session.userId}:removeTenantMember:${key}`;
      if (!CANONICAL_KEY.test(key)) throw problem(400, "VALIDATION_FAILED", "Idempotency-Key must be a canonical UUID");
      const hash = JSON.stringify({ userId, version });
      const stored = state.memberReceipts[receiptKey];
      if (stored) {
        if (stored.hash !== hash) throw problem(409, "IDEMPOTENCY_CONFLICT", "The key was used for another request");
        const operation = state.operations.find((item) => item.id === stored.operationId);
        return operation ? this.wireOperation(operation, false) : stored.answer;
      }
      const target = this.targetMembership(state, tenantId, userId);
      if (tenant.ownerId === userId) throw problem(409, "OWNER_MEMBERSHIP_PROTECTED", "The owner's membership is protected");
      this.checkVersion(version, target.version);
      if (state.operations.some((item) => item.subjectUserId === userId && item.tenantId === tenantId && !TERMINAL_OPERATION_STATES.has(item.state))) {
        throw problem(409, "INVALID_STATE", "The member is already being removed");
      }
      if (
        target.role === "TENANT_ADMIN" &&
        this.membershipState(state, tenantId, userId) === "ACTIVE" &&
        this.otherActiveAdmins(state, tenantId, userId) === 0
      ) {
        throw problem(409, "LAST_ADMIN", "The last active admin cannot be removed");
      }
      const createdAt = new Date(this.lifecycleNow()).toISOString();
      const operation: StoredOperation = {
        id: uuid(),
        tenantId,
        actorId: session.userId,
        type: REMOVE_OPERATION_TYPE,
        createdAt,
        state: "PENDING",
        updatedAt: createdAt,
        subjectUserId: userId,
      };
      state.operations.push(operation);
      // A zero step finishes the removal in the same answer.
      this.evaluate(state);
      const answer = this.wireOperation(operation, false);
      state.memberReceipts[receiptKey] = { hash, answer, operationId: operation.id };
      return answer;
    });
  }

  /**
   * `POST …/leave` (TENANT_SELF): never refused by a restriction; the owner
   * and the last active admin are; applied at once, as a removal of oneself —
   * 202 with a SUCCEEDED operation. The transport always sends
   * `{confirmed: true}`, so the 422 `CONFIRMATION_REQUIRED` is unreachable here.
   */
  private async leaveTenant(bearer: string | null, tenantId: string, key: string): Promise<unknown> {
    await this.delay("leaveTenant");
    const answer = this.write((state) => {
      const { session, tenant, actor } = this.authorizeMembers(state, bearer, tenantId, "leaveTenant", "LEAVE");
      const receipt = this.memberReceipt(state, session.userId, "leaveTenant", key, { confirmed: true });
      if (receipt.replay !== undefined) return receipt.replay;
      if (tenant.ownerId === session.userId) throw problem(409, "OWNER_MEMBERSHIP_PROTECTED", "The owner cannot leave the company");
      if (actor.role === "TENANT_ADMIN" && this.otherActiveAdmins(state, tenantId, session.userId) === 0) {
        throw problem(409, "LAST_ADMIN", "The last active admin cannot leave");
      }
      this.removeMembership(state, tenant, actor);
      const at = new Date(this.lifecycleNow()).toISOString();
      const operation: StoredOperation = {
        id: uuid(),
        tenantId,
        actorId: session.userId,
        type: LEAVE_OPERATION_TYPE,
        createdAt: at,
        state: "SUCCEEDED",
        updatedAt: at,
      };
      state.operations.push(operation);
      return receipt.keep(this.wireOperation(operation, false));
    });
    // Applied, and the answer never arrives (`loseAnswer: ["leaveTenant"]`, B-1).
    if (this.takeLostAnswer("leaveTenant")) throw new TypeError("Failed to fetch");
    return answer;
  }

  /** `GET …/invitations` (a company admin's): every state, `(issuedAt, id)`; the screen keeps PENDING and EXPIRED. */
  private async listTenantInvitations(bearer: string | null, tenantId: string, params: ListCompanyPageParams): Promise<unknown> {
    await this.delay("listTenantInvitations");
    return this.read((state) => {
      const { session } = this.authorizeMembers(state, bearer, tenantId, "listTenantInvitations", "ADMIN_READ");
      const limit = this.pageLimit(params);
      const bound = `${session.userId}:invitations:${tenantId}`;
      const offset = params.cursor === undefined ? 0 : this.readCursor(params.cursor, bound);
      const listed = state.invitations
        .filter((item) => item.tenantId === tenantId)
        .sort((a, b) => (a.issuedAt < b.issuedAt ? -1 : a.issuedAt > b.issuedAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const items = listed.slice(offset, offset + limit).map((item) => this.wireInvitation(item));
      const next = offset + limit;
      return next < listed.length ? { items, nextCursor: this.writeCursor(next, bound) } : { items };
    });
  }

  /**
   * `POST …/invitations`. The mock's answers where the blueprint is silent
   * (ask A23): an address that fails the shared rule, or a grant naming a
   * project that is not this company's, is 400 with a violation; an address
   * with a pending invitation, or of a current member, is 409 `INVALID_STATE`.
   * Then the seat: `used + reserved + 1 ≤ limit`, else 422 `QUOTA_EXCEEDED`.
   * Seven days on the lifecycle clock.
   */
  private async createTenantInvitation(
    bearer: string | null,
    tenantId: string,
    input: CreateInvitationInput,
    key: string,
  ): Promise<unknown> {
    await this.delay("createTenantInvitation");
    return this.write((state) => {
      const { session, tenant } = this.authorizeMembers(state, bearer, tenantId, "createTenantInvitation", "NORMAL");
      const receipt = this.memberReceipt(state, session.userId, "createTenantInvitation", key, {
        email: input.email,
        role: input.role,
        projectGrants: input.projectGrants,
      });
      if (receipt.replay !== undefined) return receipt.replay;
      const violations: FieldViolation[] = [];
      if (typeof input.email !== "string" || input.email !== trimInvitationEmail(input.email) || invitationEmailProblem(input.email) !== null) {
        violations.push({ field: "email", code: "INVALID", message: "email must be an email address of at most 254 characters" });
      }
      if (!isKnownMembershipRole(input.role)) violations.push({ field: "role", code: "INVALID", message: "role must be MEMBER or TENANT_ADMIN" });
      const grants = Array.isArray(input.projectGrants) ? input.projectGrants : [];
      if (grants.length > 100) violations.push({ field: "projectGrants", code: "TOO_MANY", message: "at most 100 grants" });
      const store = this.tenantStore(tenantId);
      this.applyClears(tenantId, state.cleared.filter((item) => item.tenantId === tenantId));
      grants.forEach((grant, index) => {
        if (!store.hasOpenProject(grant.projectId)) {
          violations.push({ field: `projectGrants[${index}].projectId`, code: "NOT_FOUND", message: "no such project in this tenant" });
        }
        if (!isKnownProjectGrantRole(grant.role)) {
          violations.push({ field: `projectGrants[${index}].role`, code: "INVALID", message: "role must be ADMIN, MEMBER or VIEWER" });
        }
      });
      if (violations.length > 0) throw invalid("Invalid request", violations);
      if (state.invitations.some((item) => item.tenantId === tenantId && item.state === "PENDING" && sameInvitationEmail(item.email, input.email))) {
        throw problem(409, "INVALID_STATE", "An invitation to this email is already pending");
      }
      const isMember = state.memberships.some(
        (item) =>
          item.tenantId === tenantId &&
          (item.state === "ACTIVE" || item.state === "SUSPENDED") &&
          sameInvitationEmail(this.accountStore.accountProfile(item.userId)?.email ?? null, input.email),
      );
      if (isMember) throw problem(409, "INVALID_STATE", "This email belongs to a member of the tenant");
      const seats = this.seatCounts(state, tenant);
      if (tenant.seatLimit !== null && seats.used + seats.reserved + 1n > BigInt(tenant.seatLimit)) {
        throw problem(422, "QUOTA_EXCEEDED", "No seat is free");
      }
      const issued = this.lifecycleNow();
      const invitation: StoredInvitation = {
        id: uuid(),
        tenantId,
        email: input.email,
        role: input.role,
        state: "PENDING",
        issuedAt: new Date(issued).toISOString(),
        expiresAt: new Date(issued + INVITATION_TTL_MS).toISOString(),
        createdBy: session.userId,
        projectGrants: grants.map((grant) => ({ projectId: grant.projectId, role: grant.role })),
        version: 1,
      };
      state.invitations.push(invitation);
      tenant.quotaVersion += 1;
      return receipt.keep(this.wireInvitation(invitation));
    });
  }

  /** `POST …/invitations/{id}/resend`: PENDING only (409), an expired one 422; a new link, the same `expiresAt`, no seat. */
  private async resendTenantInvitation(bearer: string | null, tenantId: string, invitationId: string, key: string): Promise<unknown> {
    await this.delay("resendTenantInvitation");
    return this.write((state) => {
      const { session } = this.authorizeMembers(state, bearer, tenantId, "resendTenantInvitation", "NORMAL");
      const receipt = this.memberReceipt(state, session.userId, "resendTenantInvitation", key, { invitationId });
      if (receipt.replay !== undefined) return receipt.replay;
      const invitation = this.targetInvitation(state, tenantId, invitationId);
      if (invitation.state === "EXPIRED") throw problem(422, "INVITATION_EXPIRED", "The invitation has expired");
      if (invitation.state !== "PENDING") throw problem(409, "INVALID_STATE", "The invitation is no longer pending");
      invitation.version += 1;
      return receipt.keep(this.wireInvitation(invitation));
    });
  }

  /** `DELETE …/invitations/{id}` with `If-Match`: PENDING only (409), then the version; its seat is released. 204. */
  private async revokeTenantInvitation(
    bearer: string | null,
    tenantId: string,
    invitationId: string,
    version: string,
    key: string,
  ): Promise<void> {
    await this.delay("revokeTenantInvitation");
    this.write((state) => {
      const { session, tenant } = this.authorizeMembers(state, bearer, tenantId, "revokeTenantInvitation", "RECOVERY");
      const receipt = this.memberReceipt(state, session.userId, "revokeTenantInvitation", key, { invitationId, version });
      if (receipt.replay !== undefined) return;
      const invitation = this.targetInvitation(state, tenantId, invitationId);
      if (invitation.state !== "PENDING") throw problem(409, "INVALID_STATE", "The invitation is no longer pending");
      this.checkVersion(version, invitation.version);
      invitation.state = "REVOKED";
      invitation.version += 1;
      tenant.quotaVersion += 1;
      // A seat freed may bring the company back within its plan (TAS-512).
      this.reconcileBreaches(state, tenant);
      receipt.keep(null);
    });
  }

  /**
   * `GET …/quotas`: since TAS-512 the three rows the blueprint allows, SEAT,
   * PROJECT and STORAGE_BYTES — PROJECT counts every project of the company,
   * archived ones included; STORAGE_BYTES is the confirmed bytes, reserved
   * the upload links not yet confirmed. Never refused by a restriction.
   */
  private async getTenantQuotas(bearer: string | null, tenantId: string): Promise<unknown> {
    await this.delay("getTenantQuotas");
    const answer = this.read((state) => {
      const { tenant } = this.authorizeMembers(state, bearer, tenantId, "getTenantQuotas", "SEATS");
      const seats = this.seatCounts(state, tenant);
      const store = this.tenantStore(tenantId);
      const storage = store.storageUsage();
      const version = String(tenant.quotaVersion);
      const limitOf = (limit: string | null) => (limit === null ? { unlimited: true } : { limit, unlimited: false });
      const plan = tenant.subscription.planVersionId;
      return {
        tenantId,
        version,
        quotas: [
          // `QuotaUsage` requires `version` and `unlimited` (api-contract-guard N3).
          { kind: "SEAT", used: seats.used.toString(), reserved: seats.reserved.toString(), ...limitOf(tenant.seatLimit), version },
          { kind: "PROJECT", used: String(store.projectCount()), reserved: "0", ...limitOf(planLimitOf(plan, "PROJECT")), version },
          {
            kind: "STORAGE_BYTES",
            used: storage.used.toString(),
            reserved: storage.reserved.toString(),
            ...limitOf(planLimitOf(plan, "STORAGE_BYTES")),
            version,
          },
        ],
        asOf: new Date(this.now()).toISOString(),
      };
    });
    if (this.takeLostAnswer("getTenantQuotas")) throw new TypeError("Failed to fetch");
    return answer;
  }

  /**
   * `GET /tenants/{t}/billing/entitlement` (TAS-512, api-contract-guard §5):
   * TAS-502's order of checks (the session, `TENANT_REQUIRED`, a `refuseNext`
   * hook, the path, `TENANT_MISMATCH`, `TENANT_NOT_FOUND`, a company still
   * being set up 409, the caller ACTIVE); any role; never refused by a
   * restriction. The answer is the blueprint's whole `Entitlement` — the
   * client keeps four fields of it.
   */
  private async getEntitlement(bearer: string | null, tenantId: string): Promise<unknown> {
    await this.delay("getEntitlement");
    const answer = this.read((state) => this.wireEntitlement(this.authorizeMembers(state, bearer, tenantId, "getEntitlement", "SEATS").tenant));
    if (this.takeLostAnswer("getEntitlement")) throw new TypeError("Failed to fetch");
    return answer;
  }

  /* ------------------------------- the company's name, owner and pause (TAS-504) */

  /*
   * api-contract-guard §6, the order of checks: (1) a bearer, (2) a company
   * session — WEB_GLOBAL is 400 `TENANT_REQUIRED`, (3) a `refuseNext` hook,
   * (4) the path's id a UUID and the session's own company (403
   * `TENANT_MISMATCH`), (5) the company there (404), (6) ACTIVE (409
   * `INVALID_STATE`), (7) the caller ACTIVE (403 `MEMBERSHIP_INACTIVE`), (8)
   * the caller its owner (403 `OWNER_REQUIRED`), (9) the command's restriction
   * rule (403 `READ_ONLY` with every current restriction, in
   * `RESTRICTION_ORDER`), (10) the platform's flags (403 `CAPABILITY_DISABLED`,
   * no reasons; never for a resume), (11) a transfer's paid coverage (409
   * `INVALID_STATE` — the code the blueprint has not named, ask A32), (12) the
   * key's durable receipt — after the access checks, so a replay is checked
   * again (contracts.md:89) and a transfer's replay by its former owner is 403
   * `OWNER_REQUIRED` (ask A33) —, (13) the body, (14) `If-Match`, (15) apply.
   * No session is revoked by any of them.
   */

  /** `PATCH /tenants/{t}` `{name}` — the shared name rule; the same name is a 200 at the same version. */
  private async renameTenant(bearer: string | null, tenantId: string, name: string, version: string, key: string): Promise<unknown> {
    await this.delay("renameTenant");
    const answer = this.write((state) => {
      const { session, tenant } = this.authorizeOwner(state, bearer, tenantId, "renameTenant", "NORMAL");
      const receipt = this.memberReceipt(state, session.userId, "renameTenant", key, { name, version });
      if (receipt.replay !== undefined) return receipt.replay;
      if (typeof name !== "string" || tenantNameProblem(name) !== null) {
        throw invalid("Invalid request", [{ field: "name", code: "INVALID", message: "name must be 1-120 characters, trimmed, without control characters" }]);
      }
      this.checkVersion(version, tenant.version);
      if (name !== tenant.name) {
        tenant.name = name;
        tenant.version = nextVersion(tenant.version);
      }
      return receipt.keep(this.wireTenant(tenant));
    });
    if (this.takeLostAnswer("renameTenant")) throw new TypeError("Failed to fetch");
    return answer;
  }

  /** `PUT /tenants/{t}/pause` — adds `OWNER_PAUSE`; a company already paused is a 200 at the same version (ask A34). */
  private async pauseTenant(bearer: string | null, tenantId: string, version: string, key: string): Promise<unknown> {
    await this.delay("pauseTenant");
    const answer = this.write((state) => {
      const { session, tenant } = this.authorizeOwner(state, bearer, tenantId, "pauseTenant", "OWNER_CONTROL");
      if (this.hooks().ownerPauseEnabled === false) {
        throw problem(403, "CAPABILITY_DISABLED", "Pausing a company is not available");
      }
      const receipt = this.memberReceipt(state, session.userId, "pauseTenant", key, { confirmed: true, version });
      if (receipt.replay !== undefined) return receipt.replay;
      this.checkVersion(version, tenant.version);
      setRestriction(tenant, "OWNER_PAUSE", true);
      return receipt.keep(this.wireTenant(tenant));
    });
    if (this.takeLostAnswer("pauseTenant")) throw new TypeError("Failed to fetch");
    return answer;
  }

  /**
   * `DELETE /tenants/{t}/pause` — lifts `OWNER_PAUSE` and nothing else: a
   * block, a dispute and an ended period stay (D131), and the paid period is
   * not moved. Refused under a block, as the access matrix's OWNER_CONTROL
   * says (ask A34c). Not paused is a 200 at the same version.
   */
  private async resumeTenant(bearer: string | null, tenantId: string, version: string, key: string): Promise<unknown> {
    await this.delay("resumeTenant");
    const answer = this.write((state) => {
      const { session, tenant } = this.authorizeOwner(state, bearer, tenantId, "resumeTenant", "OWNER_CONTROL");
      const receipt = this.memberReceipt(state, session.userId, "resumeTenant", key, { version });
      if (receipt.replay !== undefined) return receipt.replay;
      this.checkVersion(version, tenant.version);
      setRestriction(tenant, "OWNER_PAUSE", false);
      return receipt.keep(this.wireTenant(tenant));
    });
    if (this.takeLostAnswer("resumeTenant")) throw new TypeError("Failed to fetch");
    return answer;
  }

  /**
   * `POST /tenants/{t}/ownership-transfer` `{newOwnerUserId, confirmed}` — a
   * paid company with current coverage only (a FREE one, or one whose period
   * has ended, is 409 `INVALID_STATE`); allowed under the owner's own pause
   * (D244). The recipient: a UUID (400), not the caller (409), a member (404
   * `RESOURCE_NOT_FOUND`), ACTIVE (409 `INVALID_STATE` — never the caller's
   * `MEMBERSHIP_INACTIVE`). Applied: the recipient owns it and is a
   * TENANT_ADMIN, the former owner stays a TENANT_ADMIN, both memberships and
   * the generation move, the old autopay consent is switched off, and no
   * session is revoked (ask A36).
   */
  private async transferTenantOwnership(
    bearer: string | null,
    tenantId: string,
    newOwnerUserId: string,
    version: string,
    key: string,
  ): Promise<unknown> {
    await this.delay("transferTenantOwnership");
    const answer = this.write((state) => {
      const { session, tenant, actor } = this.authorizeOwner(state, bearer, tenantId, "transferTenantOwnership", "TRANSFER");
      if (this.hooks().ownershipTransferEnabled === false) {
        throw problem(403, "CAPABILITY_DISABLED", "Transferring a company is not available");
      }
      const through = tenant.subscription.paidThrough;
      const covered = through !== undefined && Date.parse(through) > this.lifecycleNow();
      if (isFreePlan(tenant.subscription.planVersionId) || !covered) {
        throw problem(409, "INVALID_STATE", "The tenant has no current paid coverage");
      }
      const receipt = this.memberReceipt(state, session.userId, "transferTenantOwnership", key, { newOwnerUserId, confirmed: true, version });
      if (receipt.replay !== undefined) return receipt.replay;
      if (typeof newOwnerUserId !== "string" || !UUID_PATTERN.test(newOwnerUserId)) {
        throw invalid("Invalid request", [{ field: "newOwnerUserId", code: "INVALID", message: "newOwnerUserId must be a UUID" }]);
      }
      if (newOwnerUserId === session.userId) throw problem(409, "INVALID_STATE", "The tenant is already owned by this user");
      const recipient = state.memberships.find((item) => item.tenantId === tenantId && item.userId === newOwnerUserId);
      if (!recipient || recipient.state === "REMOVED") throw problem(404, "RESOURCE_NOT_FOUND", "Membership not found");
      if (this.membershipState(state, tenantId, newOwnerUserId) !== "ACTIVE") {
        throw problem(409, "INVALID_STATE", "The new owner's membership is not active");
      }
      this.checkVersion(version, tenant.version);
      tenant.ownerId = newOwnerUserId;
      tenant.ownerVersion = nextVersion(tenant.ownerVersion);
      tenant.version = nextVersion(tenant.version);
      tenant.generation += 1;
      recipient.role = "TENANT_ADMIN";
      recipient.version += 1;
      actor.role = "TENANT_ADMIN";
      actor.version += 1;
      // The former owner's consent is never carried over: the new owner sets up their own.
      tenant.subscription = { ...tenant.subscription, autopayState: "DISABLED", version: nextVersion(tenant.subscription.version) };
      return receipt.keep(this.wireTenant(tenant));
    });
    if (this.takeLostAnswer("transferTenantOwnership")) throw new TypeError("Failed to fetch");
    return answer;
  }

  /** `GET /tenants/{t}/billing/subscription` — the company's own session and its owner only (403 `OWNER_REQUIRED`); no restriction stops it. */
  private async getSubscription(bearer: string | null, tenantId: string): Promise<unknown> {
    await this.delay("getSubscription");
    const answer = this.read((state) => {
      const { session, tenant } = this.authorizeControl(state, bearer, tenantId, "getSubscription");
      if (tenant.ownerId !== session.userId) throw problem(403, "OWNER_REQUIRED", "Only the owner can read the subscription");
      return this.wireSubscription(tenant);
    });
    if (this.takeLostAnswer("getSubscription")) throw new TypeError("Failed to fetch");
    return answer;
  }

  /* --------------------------------- invoices and hosted checkout (TAS-513) */

  /*
   * api-contract-guard §5 and its addendum: the company's own session of
   * exactly this company and its owner only (403 `OWNER_REQUIRED` for anybody
   * else, a company admin included), never stopped by a restriction to read;
   * a payment refused under a platform block (`READ_ONLY`) only. The checks:
   * (1) a bearer and a company session of this company (`authorizeControl`,
   * which takes a `refuseNext` hook first), (2) the owner, (3) a company still
   * being set up 409 — then each route's own.
   */

  private authorizeBilling(state: ServerState, bearer: string | null, tenantId: string, operation: string): { session: StoredSession; tenant: StoredTenant } {
    const granted = this.authorizeControl(state, bearer, tenantId, operation);
    if (granted.tenant.ownerId !== granted.session.userId) {
      throw problem(403, "OWNER_REQUIRED", "Only the owner can see the company's invoices and payments");
    }
    if (granted.tenant.lifecycle === "PROVISIONING") throw problem(409, "INVALID_STATE", "The company is still being set up");
    return granted;
  }

  /** `GET /tenants/{t}/billing/invoices` — newest first, `limit` 1–100 (default 50), the cursor bound to the reader and the company. */
  private async listInvoices(bearer: string | null, tenantId: string, params: ListCompanyPageParams): Promise<unknown> {
    await this.delay("listInvoices");
    const answer = this.read((state) => {
      const { session } = this.authorizeBilling(state, bearer, tenantId, "listInvoices");
      const limit = this.pageLimit(params);
      const bound = `${session.userId}:invoices:${tenantId}`;
      const offset = params.cursor === undefined ? 0 : this.readCursor(params.cursor, bound);
      const listed = state.invoices
        .filter((invoice) => invoice.tenantId === tenantId)
        .sort((a, b) => (a.issuedAt < b.issuedAt ? 1 : a.issuedAt > b.issuedAt ? -1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const items = listed.slice(offset, offset + limit).map((invoice) => this.wireInvoice(invoice));
      const next = offset + limit;
      return next < listed.length ? { items, nextCursor: this.writeCursor(next, bound) } : { items };
    });
    if (this.takeLostAnswer("listInvoices")) throw new TypeError("Failed to fetch");
    return answer;
  }

  /** `GET /tenants/{t}/billing/invoices/{i}` — another company's, or none, is 404 `RESOURCE_NOT_FOUND`. */
  private async getInvoice(bearer: string | null, tenantId: string, invoiceId: string): Promise<unknown> {
    await this.delay("getInvoice");
    const answer = this.read((state) => {
      this.authorizeBilling(state, bearer, tenantId, "getInvoice");
      if (!UUID_PATTERN.test(invoiceId)) throw problem(400, "VALIDATION_FAILED", "invoiceId must be a UUID");
      const invoice = state.invoices.find((item) => item.id === invoiceId && item.tenantId === tenantId);
      if (!invoice) throw problem(404, "RESOURCE_NOT_FOUND", "Invoice not found");
      return this.wireInvoice(invoice);
    });
    if (this.takeLostAnswer("getInvoice")) throw new TypeError("Failed to fetch");
    return answer;
  }

  /**
   * `POST /tenants/{t}/billing/invoices/{i}/checkout` `{returnTarget,
   * confirmed: true}` — after the access checks: the `checkoutOff` hook, the
   * key (a canonical UUID), its durable receipt (the same body answers the
   * checkout it made, **as it is now**; another body 409
   * `IDEMPOTENCY_CONFLICT`), the body, the invoice (404), a platform block
   * (403 `READ_ONLY`), the invoice payable — OPEN, PSP, nothing paid yet, due
   * in the future (`PaymentAttemptStore.accept`, PR #323), else 409
   * `INVALID_STATE` — and no other active attempt of it (409 `INVALID_STATE`
   * with no pointer back, A57). 201 `Checkout`, CREATED, its page address
   * while it is open.
   */
  private async createCheckout(bearer: string | null, tenantId: string, invoiceId: string, returnTarget: string, key: string): Promise<unknown> {
    await this.delay("createCheckout");
    const answer = this.write((state) => {
      const { session, tenant } = this.authorizeBilling(state, bearer, tenantId, "createCheckout");
      const off = this.hooks().checkoutOff;
      if (off && typeof off.status === "number" && typeof off.code === "string") {
        throw problem(off.status, off.code, off.title ?? "Online payment is not available", Array.isArray(off.reasons) ? off.reasons : []);
      }
      if (!CANONICAL_KEY.test(key)) throw problem(400, "VALIDATION_FAILED", "Idempotency-Key must be a canonical UUID");
      if (!UUID_PATTERN.test(invoiceId)) throw problem(400, "VALIDATION_FAILED", "invoiceId must be a UUID");
      const receiptKey = `${session.userId}:${tenantId}:${key}`;
      const hash = JSON.stringify({ invoiceId, returnTarget, confirmed: true });
      const receipt = state.checkoutReceipts[receiptKey];
      if (receipt) {
        if (receipt.hash !== hash) throw problem(409, "IDEMPOTENCY_CONFLICT", "The key was used for another request");
        const made = state.checkouts.find((item) => item.id === receipt.checkoutId);
        if (made) return this.wireCheckout(made);
      }
      if (returnTarget !== "BILLING" && returnTarget !== "CREATION") {
        throw invalid("Invalid request", [{ field: "returnTarget", code: "INVALID", message: "returnTarget must be BILLING or CREATION" }]);
      }
      const invoice = state.invoices.find((item) => item.id === invoiceId && item.tenantId === tenantId);
      if (!invoice) throw problem(404, "RESOURCE_NOT_FOUND", "Invoice not found");
      if (tenant.restrictions.includes("PLATFORM_BLOCK")) {
        throw problem(403, "READ_ONLY", "The tenant is read-only", orderedRestrictions(tenant.restrictions));
      }
      const now = this.lifecycleNow();
      const payable =
        invoice.state === "OPEN" &&
        invoice.paymentMethod === "PSP" &&
        invoice.remaining.amountMinor === invoice.total.amountMinor &&
        Date.parse(invoice.dueAt) > now;
      if (!payable) throw problem(409, "INVALID_STATE", "The invoice cannot be paid");
      if (state.checkouts.some((item) => item.invoiceId === invoiceId && ACTIVE_CHECKOUT_STATES.has(item.state) && !item.settled)) {
        throw problem(409, "INVALID_STATE", "Another payment of this invoice is in progress");
      }
      const ttl = this.hooks().checkoutTtlMs;
      const life = typeof ttl === "number" && Number.isFinite(ttl) && ttl > 0 ? ttl : CHECKOUT_TTL_MS;
      const checkout: StoredCheckout = {
        id: uuid(),
        tenantId,
        invoiceId,
        actorId: session.userId,
        returnTarget,
        state: "CREATED",
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + life).toISOString(),
        token: `mcs_${uuid().replace(/-/g, "")}`,
      };
      state.checkouts.push(checkout);
      state.checkoutReceipts[receiptKey] = { hash, checkoutId: checkout.id };
      return this.wireCheckout(checkout);
    });
    if (this.takeLostAnswer("createCheckout")) throw new TypeError("Failed to fetch");
    return answer;
  }

  /** `GET /tenants/{t}/billing/checkout/{c}` — this company's checkout as it is now; another's, or none, is 404. */
  private async getCheckout(bearer: string | null, tenantId: string, checkoutId: string): Promise<unknown> {
    await this.delay("getCheckout");
    const answer = this.read((state) => {
      this.authorizeBilling(state, bearer, tenantId, "getCheckout");
      if (!UUID_PATTERN.test(checkoutId)) throw problem(400, "VALIDATION_FAILED", "checkoutId must be a UUID");
      const checkout = state.checkouts.find((item) => item.id === checkoutId && item.tenantId === tenantId);
      if (!checkout) throw problem(404, "RESOURCE_NOT_FOUND", "Checkout not found");
      return this.wireCheckout(checkout);
    });
    if (this.takeLostAnswer("getCheckout")) throw new TypeError("Failed to fetch");
    return answer;
  }

  /* --------------------------- documents, refunds and durations (TAS-514) */

  /**
   * `GET /tenants/{t}/billing/invoices/{i}/document` (api-contract-guard §7.7):
   * the billing checks — the owner only, 403 `OWNER_REQUIRED` for anybody
   * else —, the invoice here (404 `RESOURCE_NOT_FOUND`, a DRAFT too), the
   * `documentOff` hook (503 `POLICY_NOT_CONFIGURED`), then a minimal valid PDF
   * of the stored snapshot marked «MOCK — not a tax document» (invented). No
   * `Content-Disposition` the browser could read: the gateway exposes none to
   * CORS (A79). `documentType` answers another type, for the client's check.
   */
  private async getInvoiceDocument(bearer: string | null, tenantId: string, invoiceId: string): Promise<DocumentAnswer> {
    await this.delay("getInvoiceDocument");
    const bytes = this.read((state) => {
      this.authorizeBilling(state, bearer, tenantId, "getInvoiceDocument");
      if (!UUID_PATTERN.test(invoiceId)) throw problem(400, "VALIDATION_FAILED", "invoiceId must be a UUID");
      const invoice = state.invoices.find((item) => item.id === invoiceId && item.tenantId === tenantId);
      if (!invoice || invoice.state === "DRAFT") throw problem(404, "RESOURCE_NOT_FOUND", "Invoice not found");
      if (this.hooks().documentOff === true) throw problem(503, "POLICY_NOT_CONFIGURED", "No approved invoice format");
      return mockInvoicePdf(invoice);
    });
    if (this.takeLostAnswer("getInvoiceDocument")) throw new TypeError("Failed to fetch");
    const type = this.hooks().documentType;
    const contentType = typeof type === "string" && type !== "" ? type : "application/pdf";
    return { contentType, disposition: null, body: new Blob([bytes.buffer as ArrayBuffer], { type: contentType }) };
  }

  /**
   * `GET /tenants/{t}/billing/refunds` (§7.6): the owner only, this company's,
   * keyset by `requestedAt` then `id`, newest first (A87, invented); `limit`
   * 1–100, the cursor bound to the reader and the company.
   */
  private async listRefunds(bearer: string | null, tenantId: string, params: ListCompanyPageParams): Promise<unknown> {
    await this.delay("listRefunds");
    const answer = this.read((state) => {
      const { session } = this.authorizeBilling(state, bearer, tenantId, "listRefunds");
      const limit = this.pageLimit(params);
      const bound = `${session.userId}:refunds:${tenantId}`;
      const offset = params.cursor === undefined ? 0 : this.readCursor(params.cursor, bound);
      const listed = state.refunds
        .filter((refund) => refund.tenantId === tenantId)
        .sort((a, b) => (a.requestedAt < b.requestedAt ? 1 : a.requestedAt > b.requestedAt ? -1 : a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
      const items = listed.slice(offset, offset + limit).map((refund) => this.wireRefund(refund));
      const next = offset + limit;
      return next < listed.length ? { items, nextCursor: this.writeCursor(next, bound) } : { items };
    });
    if (this.takeLostAnswer("listRefunds")) throw new TypeError("Failed to fetch");
    return answer;
  }

  /**
   * `GET /tenants/{t}/capabilities` (§7.8): any ACTIVE member of the company,
   * with its session; `durationsSeconds` the two public durations —
   * `WIRE_RECONCILIATION_TARGET_SECONDS` 86 400 unless the
   * `reconciliationTargetSeconds` hook changes it or (`null`) leaves it out,
   * `UNPAID_CREATION_WINDOW_SECONDS` the creation window. `expiresAt` 30 s on;
   * no `items` (A30).
   */
  private async getTenantCapabilities(bearer: string | null, tenantId: string): Promise<unknown> {
    await this.delay("getTenantCapabilities");
    const answer = this.read((state) => {
      const { session, tenant } = this.authorizeControl(state, bearer, tenantId, "getTenantCapabilities");
      const membership = state.memberships.find((item) => item.tenantId === tenantId && item.userId === session.userId);
      const hook = this.hooks().reconciliationTargetSeconds;
      const target = hook === undefined ? DEFAULT_RECONCILIATION_TARGET_S : hook;
      const now = this.now();
      return {
        tenantId,
        actorUserId: session.userId,
        policyVersion: "mock-policy-1",
        entitlementVersion: String(tenant.entitlementVersion),
        membershipVersion: String(membership?.version ?? 1),
        flagVersion: "mock-flags-1",
        evaluatedAt: new Date(now).toISOString(),
        durationsSeconds: {
          UNPAID_CREATION_WINDOW_SECONDS: CREATION_WINDOW_MS / 1000,
          ...(target === null ? {} : { WIRE_RECONCILIATION_TARGET_SECONDS: target }),
        },
        expiresAt: new Date(now + 30_000).toISOString(),
        items: [],
      };
    });
    if (this.takeLostAnswer("getTenantCapabilities")) throw new TypeError("Failed to fetch");
    return answer;
  }

  /** `Refund` as the blueprint has it — the SLA set only once the evidence is complete. Its receipt is never on the wire. */
  private wireRefund(refund: StoredRefund): unknown {
    const { receiptId: _receipt, version, amount, slaSnapshot, ...rest } = refund;
    return { ...rest, amount: { ...amount }, ...(slaSnapshot === undefined ? {} : { slaSnapshot: { ...slaSnapshot } }), version: String(version) };
  }

  /* -------------------- plan change, renewal and automatic payments (TAS-515) */

  /*
   * api-contract-guard's pre-build ruling §6, develop's TAS-354 order
   * (`SubscriptionPlanChanges.java`, SPC): (1) a company session of exactly
   * this company — the `refuseNext` hook first —, the company there and
   * ACTIVE (else 409, «no subscription»), the caller ACTIVE and its owner
   * (403 `OWNER_REQUIRED`); **no restriction stops the plan commands**
   * (FINANCE_RECOVERY); automatic payments are refused `READ_ONLY` under a
   * pause, a block, a dispute or before the first payment (A68), and
   * `CAPABILITY_DISABLED` behind the flag hook; (2) the key a canonical UUID
   * and its durable receipt — replayed before the version, so a retry with the
   * same key, `If-Match` and body answers what it answered; (3) `If-Match`,
   * `Subscription.version` (428 / 412); (4) the body; (5) apply, the
   * subscription's version moving with every accepted command.
   */

  /**
   * `POST /tenants/{t}/billing/plan-changes` — develop's effect rule (SPC
   * 164-173): a FREE target IMMEDIATE (the ledger first, 409
   * `FREE_ELIGIBILITY_USED` — a refusal that still moves the version, SPC
   * 315-345); the plan it is on while paid and current IMMEDIATE (withdrawing
   * a scheduled change); a dearer one while covered NEXT_PERIOD, from the end
   * of the paid period; anything else AFTER_PAYMENT. A target that is not the
   * latest published version of its code is 404 `RESOURCE_NOT_FOUND`; another
   * version of the code it is on 409 `INVALID_STATE`
   * (`PLAN_TERMS_CHANGE_REQUIRES_NOTICE`). A paid effect needs `currency` and
   * `paymentMethod` (400). The mock issues the change's invoice itself and
   * names it in `invoiceId` (invented, A62); a new selection VOIDs every OPEN
   * invoice of the older one, RENEWAL included (invented, A65's target).
   */
  private async changeSubscriptionPlan(
    bearer: string | null,
    tenantId: string,
    input: { planVersionId: string; currency?: string; paymentMethod?: string },
    version: string,
    key: string,
  ): Promise<unknown> {
    await this.delay("changeSubscriptionPlan");
    const answer = this.write((state) => {
      const { session, tenant } = this.authorizeSubscription(state, bearer, tenantId, "changeSubscriptionPlan");
      const request = {
        operation: "changeSubscriptionPlan",
        version,
        planVersionId: input.planVersionId,
        currency: input.currency,
        paymentMethod: input.paymentMethod,
        confirmed: true,
      };
      const receipt = this.billingReceipt(state, tenantId, session.userId, key, request);
      if (receipt.replay !== undefined) return receipt.replay;
      const sub = tenant.subscription;
      this.checkVersion(version, sub.version);
      if (typeof input.planVersionId !== "string" || !UUID_PATTERN.test(input.planVersionId)) {
        throw invalid("Invalid request", [{ field: "planVersionId", code: "INVALID", message: "planVersionId must be a UUID" }]);
      }
      const target = MOCK_PLANS.find((plan) => plan.id === input.planVersionId);
      const latest = target
        ? MOCK_PLANS.filter((plan) => plan.code === target.code && plan.state === "PUBLISHED").sort((a, b) => Number(b.version) - Number(a.version))[0]
        : undefined;
      if (!target || target.state !== "PUBLISHED" || latest?.id !== target.id) throw problem(404, "RESOURCE_NOT_FOUND", "Plan version not found");
      const current = MOCK_PLANS.find((plan) => plan.id === sub.planVersionId);
      if (current && current.code === target.code && current.id !== target.id) {
        // PLAN_TERMS_CHANGE_REQUIRES_NOTICE, mapped to the blueprint's code (A70).
        throw problem(409, "INVALID_STATE", "Another version of the same plan needs a notice");
      }
      const now = this.lifecycleNow();
      const covered = sub.paidThrough !== undefined && Date.parse(sub.paidThrough) > now;
      const price = (plan: MockPlan | undefined) => BigInt(plan?.price.amountMinor ?? "0");
      const effect =
        target.kind === "FREE"
          ? "IMMEDIATE"
          : target.id === sub.planVersionId && (covered || isFreePlan(sub.planVersionId))
            ? "IMMEDIATE"
            : covered && price(target) > price(current)
              ? "NEXT_PERIOD"
              : "AFTER_PAYMENT";
      if (effect !== "IMMEDIATE" && (input.currency === undefined || input.paymentMethod === undefined)) {
        throw invalid("Invalid request", [{ field: "currency", code: "REQUIRED", message: "A paid change needs currency and paymentMethod" }]);
      }
      const operationId = uuid();
      let invoiceId: string | undefined;
      let effectiveAt: string | undefined;
      if (target.kind === "FREE" && isFreePlan(sub.planVersionId)) {
        // Already on FREE: a no-op, the ledger untouched (SPC 164-173).
        tenant.subscription = { ...sub, version: nextVersion(sub.version) };
        effectiveAt = new Date(now).toISOString();
      } else if (target.kind === "FREE") {
        const used = state.freeLedger[session.userId];
        if (used !== undefined && used !== tenantId) {
          // develop writes twice before it refuses: the version moves all the same.
          sub.version = nextVersion(sub.version);
          const refusal = { status: 409, code: "FREE_ELIGIBILITY_USED", title: "The free company allowance has been used" };
          receipt.refuse(refusal);
          throw problem(refusal.status, refusal.code, refusal.title);
        }
        this.toFree(state, tenant, session.userId);
        effectiveAt = new Date(now).toISOString();
      } else if (effect === "IMMEDIATE") {
        // The plan it is on: an unpaid scheduled change is dropped (SPC 221-247); a paid one is kept —
        // on develop `applied()` has granted its period, so this is a no-op and it still starts at its
        // date (guard M-2, A76).
        if (sub.activeChange?.paidAt === undefined) this.supersede(state, tenant, false);
        tenant.subscription = { ...tenant.subscription, version: nextVersion(tenant.subscription.version) };
        effectiveAt = new Date(now).toISOString();
      } else {
        this.supersede(state, tenant, true);
        effectiveAt = effect === "NEXT_PERIOD" ? sub.paidThrough : undefined;
        const invoice = this.issueInvoice(state, tenant, "PLAN_CHANGE", target.id, now, effectiveAt === undefined ? now + PLAN_CHANGE_DUE_MS : Date.parse(effectiveAt), {
          method: input.paymentMethod,
        });
        invoiceId = invoice.id;
        tenant.subscription = {
          ...tenant.subscription,
          version: nextVersion(tenant.subscription.version),
          ...(effect === "NEXT_PERIOD" && effectiveAt !== undefined ? { scheduledPlanVersionId: target.id, scheduledEffectiveAt: effectiveAt } : {}),
          activeChange: {
            operationId,
            planVersionId: target.id,
            effect,
            invoiceId: invoice.id,
            ...(effectiveAt === undefined ? {} : { effectiveAt }),
          },
        };
      }
      return receipt.keep({
        subscription: this.wireSubscription(tenant),
        effect,
        ...(invoiceId === undefined ? {} : { invoiceId }),
        ...(effectiveAt === undefined ? {} : { effectiveAt }),
        operationId,
      });
    });
    if (this.takeLostAnswer("changeSubscriptionPlan")) throw new TypeError("Failed to fetch");
    return answer;
  }

  /**
   * `PUT` (cancel, `{confirmed: true}`) and `DELETE` (resume) `…/billing/renewal-cancellation`:
   * cancel needs a paid subscription with current coverage, resume a paid one
   * — an ended period too (Q6) — else 409 `INVALID_STATE`
   * (`PAID_SUBSCRIPTION_REQUIRED`, A70). Each moves the version, a no-op
   * included (develop's, A72); neither touches automatic payments, and an
   * issued RENEWAL stays OPEN (A66).
   */
  private async setRenewalCancelled(bearer: string | null, tenantId: string, cancel: boolean, version: string, key: string): Promise<unknown> {
    const operation = cancel ? "cancelSubscriptionRenewal" : "resumeSubscriptionRenewal";
    await this.delay(operation);
    const answer = this.write((state) => {
      const { session, tenant } = this.authorizeSubscription(state, bearer, tenantId, operation);
      const receipt = this.billingReceipt(state, tenantId, session.userId, key, { operation, version, ...(cancel ? { confirmed: true } : {}) });
      if (receipt.replay !== undefined) return receipt.replay;
      const sub = tenant.subscription;
      this.checkVersion(version, sub.version);
      const paid = sub.paidThrough !== undefined && !isFreePlan(sub.planVersionId);
      if (!paid || (cancel && Date.parse(sub.paidThrough ?? "") <= this.lifecycleNow())) {
        throw problem(409, "INVALID_STATE", "A paid subscription is required");
      }
      tenant.subscription = { ...sub, renewalCancelled: cancel, version: nextVersion(sub.version) };
      return receipt.keep(this.wireSubscription(tenant));
    });
    if (this.takeLostAnswer(operation)) throw new TypeError("Failed to fetch");
    return answer;
  }

  /**
   * `PUT …/billing/autopay` — withdrawal only (`consent: true` would need a
   * payment method and a terms version nothing serves: 400, A67). CONSENTED
   * and SUSPENDED become DISABLED; the subscription's version moves; the
   * answer's mandate version is deliberately not the subscription's.
   */
  private async setAutopayConsent(bearer: string | null, tenantId: string, consent: unknown, version: string, key: string): Promise<unknown> {
    await this.delay("setAutopayConsent");
    const answer = this.write((state) => {
      const { session, tenant } = this.authorizeSubscription(state, bearer, tenantId, "setAutopayConsent");
      if (this.hooks().autopayConsentEnabled === false) throw problem(403, "CAPABILITY_DISABLED", "Automatic payments are not available");
      const restrictions = orderedRestrictions(tenant.restrictions);
      if (restrictions.some((code) => AUTOPAY_DENIED.includes(code))) throw problem(403, "READ_ONLY", "The tenant is read-only", restrictions);
      const receipt = this.billingReceipt(state, tenantId, session.userId, key, { operation: "setAutopayConsent", version, consent, confirmed: true });
      if (receipt.replay !== undefined) return receipt.replay;
      const sub = tenant.subscription;
      this.checkVersion(version, sub.version);
      if (consent !== false) {
        throw invalid("Invalid request", [{ field: "paymentMethodId", code: "REQUIRED", message: "consent=true requires paymentMethodId and termsVersion" }]);
      }
      const mandateVersion = (sub.mandateVersion ?? 40) + 1;
      tenant.subscription = { ...sub, autopayState: "DISABLED", version: nextVersion(sub.version), mandateVersion };
      return receipt.keep({
        id: tenant.id.replace(/^.{8}/, "a0a0a0a0"),
        ownerId: tenant.ownerId,
        state: "DISABLED",
        version: String(mandateVersion),
        ownerVersion: tenant.ownerVersion,
        consentChannel: "WEB",
      });
    });
    if (this.takeLostAnswer("setAutopayConsent")) throw new TypeError("Failed to fetch");
    return answer;
  }

  /** Check (1) for the four subscription commands — see the block comment above. */
  private authorizeSubscription(
    state: ServerState,
    bearer: string | null,
    tenantId: string,
    operation: string,
  ): { session: StoredSession; tenant: StoredTenant } {
    const granted = this.authorizeControl(state, bearer, tenantId, operation);
    if (granted.tenant.lifecycle !== "ACTIVE") throw problem(409, "INVALID_STATE", "The tenant has no subscription to change");
    if (granted.tenant.ownerId !== granted.session.userId) throw problem(403, "OWNER_REQUIRED", "Only the owner can change the subscription");
    return granted;
  }

  /**
   * Check (2): the key a canonical UUID and its receipt, `{tenant}:{actor}:{key}`.
   * `replay` is what the same request answered (a refusal is thrown again);
   * `keep` records an answer, `refuse` a refusal that a replay repeats.
   */
  private billingReceipt(
    state: ServerState,
    tenantId: string,
    actorId: string,
    key: string,
    request: unknown,
  ): { replay: unknown; keep: <T>(answer: T) => T; refuse: (refusal: { status: number; code: string; title: string }) => void } {
    if (!CANONICAL_KEY.test(key)) throw problem(400, "VALIDATION_FAILED", "Idempotency-Key must be a canonical UUID");
    const receiptKey = `${tenantId}:${actorId}:${key}`;
    const hash = JSON.stringify(request);
    const stored = state.billingReceipts[receiptKey];
    if (stored) {
      if (stored.hash !== hash) throw problem(409, "IDEMPOTENCY_CONFLICT", "The key was used for another request");
      if (stored.refusal) throw problem(stored.refusal.status, stored.refusal.code, stored.refusal.title);
      return { replay: stored.answer ?? null, keep: (answer) => answer, refuse: () => undefined };
    }
    return {
      replay: undefined,
      keep: (answer) => {
        state.billingReceipts[receiptKey] = { hash, answer };
        return answer;
      },
      refuse: (refusal) => {
        state.billingReceipts[receiptKey] = { hash, refusal };
      },
    };
  }

  /**
   * A new selection supersedes the one before it (SPC 763-771): the change
   * in force ends, its invoices OPEN are VOIDed with their open checkouts —
   * and, when the new selection moves the plan, every OPEN RENEWAL too, so no
   * money is taken for coverage that will not come (A65). The scheduled date
   * and id go, and the renewal calendar may issue again.
   */
  private supersede(state: ServerState, tenant: StoredTenant, renewals: boolean): void {
    const change = tenant.subscription.activeChange;
    for (const invoice of state.invoices) {
      if (invoice.tenantId !== tenant.id || invoice.state !== "OPEN") continue;
      const older = (change !== undefined && invoice.id === change.invoiceId) || invoice.purpose === "PLAN_CHANGE" || (renewals && invoice.purpose === "RENEWAL");
      if (!older) continue;
      invoice.state = "VOID";
      invoice.version += 1;
      for (const checkout of state.checkouts) {
        if (checkout.invoiceId === invoice.id && OPEN_CHECKOUT_STATES.has(checkout.state)) checkout.state = "EXPIRED";
      }
    }
    const {
      activeChange: _change,
      scheduledPlanVersionId: _plan,
      scheduledEffectiveAt: _at,
      renewalIssuedFor: issued,
      ...kept
    } = tenant.subscription;
    // A RENEWAL VOIDed here may be issued again once nothing is in force.
    tenant.subscription = renewals ? kept : { ...kept, ...(issued === undefined ? {} : { renewalIssuedFor: issued }) };
  }

  /**
   * Paid → FREE (develop's SPC 533-553, guard §6): every coverage ends — no
   * `paidThrough`, the rest neither kept nor refunded —, CONSENTED automatic
   * payments go DISABLED and SUSPENDED stay (A69), `renewalCancelled` stays
   * (A73), the older selection's invoices are VOIDed, `PAYMENT_EXPIRED` goes
   * (FREE needs no paid period), and every kind over the free limits is
   * breached — `OVER_QUOTA`, never a refusal. With an actor, its FREE
   * allowance is spent on this company.
   */
  private toFree(state: ServerState, tenant: StoredTenant, actorId: string | null): void {
    this.supersede(state, tenant, true);
    const sub = tenant.subscription;
    tenant.subscription = {
      planVersionId: MOCK_PLAN_IDS.free,
      version: nextVersion(sub.version),
      renewalCancelled: sub.renewalCancelled,
      autopayState: sub.autopayState === "CONSENTED" ? "DISABLED" : sub.autopayState,
      ...(sub.mandateVersion === undefined ? {} : { mandateVersion: sub.mandateVersion }),
    };
    this.switchPlan(state, tenant, MOCK_PLAN_IDS.free);
    setRestriction(tenant, "PAYMENT_EXPIRED", false);
    if (actorId !== null) state.freeLedger[actorId] = tenant.id;
    this.reconcileBreaches(state, tenant);
  }

  /** The subscription's plan moved to `planVersionId`: its seat limit, the entitlement's version, and every kind now over its limit. */
  private switchPlan(state: ServerState, tenant: StoredTenant, planVersionId: string): void {
    tenant.subscription = { ...tenant.subscription, planVersionId };
    tenant.seatLimit = seatLimitOf(planVersionId);
    tenant.entitlementVersion += 1;
    tenant.quotaBreach = BREACH_KINDS.filter((kind) => !this.withinLimit(state, tenant, kind));
  }

  /**
   * An invoice the server issues (TAS-513: the INITIAL with a paid company;
   * TAS-515: a PLAN_CHANGE at the command, a RENEWAL by the calendar; TAS-514:
   * a replacement INITIAL after a late first payment) — OPEN, the plan's
   * price, by the method `methodFor` says. **Its snapshots are taken now and
   * never again** (F1): the buyer the company is now, the plan's name now, and
   * on a wire one in euros its bank details.
   */
  private issueInvoice(
    state: ServerState,
    tenant: StoredTenant,
    purpose: string,
    planVersionId: string,
    issuedAt: number,
    dueAt: number,
    options: { replacesInvoiceId?: string; method?: string } = {},
  ): StoredInvoice {
    const { replacesInvoiceId } = options;
    const total = planPrice(planVersionId);
    const number = invoiceNumber(state.invoiceSeq);
    // A plan change's request names its method (TAS-515's always PSP); everything else is the server's pick.
    const method = options.method === "WIRE" || options.method === "PSP" ? options.method : this.methodFor(tenant);
    const wire = method === "WIRE" && total.currency === "EUR";
    const invoice: StoredInvoice = {
      id: uuid(),
      tenantId: tenant.id,
      number,
      purpose,
      state: "OPEN",
      planVersionId,
      total,
      allocated: zeroOf(total),
      remaining: { ...total },
      issuedAt: new Date(issuedAt).toISOString(),
      dueAt: new Date(dueAt).toISOString(),
      paymentMethod: wire ? "WIRE" : "PSP",
      version: 1,
      ...(replacesInvoiceId === undefined ? {} : { replacesInvoiceId }),
      buyer: buyerOf(tenant),
      seller: { ...MOCK_SELLER, address: { ...MOCK_SELLER.address } },
      lines: planLines(planVersionId, total),
      ...(wire ? { wireInstructions: wireDetails(number, this.hooks().wireDetailsVariant) } : {}),
      matchedUnallocated: zeroOf(total),
    };
    state.invoices.push(invoice);
    state.invoiceSeq += 1;
    return invoice;
  }

  /** Who picks an issued invoice's method — the server, per company (invented, A78): the hook, then the company's own, then PSP. */
  private methodFor(tenant: StoredTenant): "PSP" | "WIRE" {
    const hook = this.hooks().issueMethod;
    const named = typeof hook === "object" && hook !== null ? (hook[tenant.id] ?? hook["*"]) : undefined;
    const method = named ?? tenant.invoiceMethod;
    return method === "WIRE" ? "WIRE" : "PSP";
  }

  /**
   * The stand-in payment page's read of its checkout, by the opaque token
   * only this server maps back — not a gateway route, and not on `TaskaApi`.
   * Opening it is the provider's session starting: CREATED becomes PENDING.
   * `null` for a token that names nothing.
   */
  mockCheckoutPage(token: string): MockCheckoutPage | null {
    return this.write((state) => {
      const checkout = state.checkouts.find((item) => item.token === token);
      if (!checkout) return null;
      const invoice = state.invoices.find((item) => item.id === checkout.invoiceId);
      const tenant = state.tenants.find((item) => item.id === checkout.tenantId);
      const open = this.checkoutOpen(checkout);
      if (open && checkout.state === "CREATED") checkout.state = "PENDING";
      return {
        checkoutId: checkout.id,
        company: tenant?.name ?? null,
        invoiceNumber: invoice?.number ?? null,
        amount: invoice ? { ...invoice.total } : null,
        open,
      };
    });
  }

  /**
   * The provider's observation of the stand-in page's outcome (art-director
   * B12, api-contract-guard addendum) — a webhook in the real thing, so on no
   * gateway route. A success is SUCCEEDED, then **settled later**
   * (`settlementDelayMs`); a failure FAILED; a cancel changes nothing — the
   * checkout stays PENDING until it expires (A56); «unknown» is UNKNOWN until
   * `resolveCheckout` answers; a late success stays PENDING for 20 s first.
   * A checkout no longer open takes no outcome. Answers where the page goes
   * back to: the static return address, or the cancel one.
   */
  observeMockCheckout(token: string, outcome: MockCheckoutOutcome): "return" | "cancel" {
    this.write((state) => {
      const checkout = state.checkouts.find((item) => item.token === token);
      if (!checkout || !this.checkoutOpen(checkout)) return;
      const now = this.lifecycleNow();
      switch (outcome) {
        case "succeeds":
          checkout.state = "SUCCEEDED";
          checkout.settleAt = new Date(now + this.settlementDelayMs()).toISOString();
          break;
        case "fails":
          checkout.state = "FAILED";
          break;
        case "unknown":
          checkout.state = "UNKNOWN";
          break;
        case "succeedsLater":
          checkout.state = "PENDING";
          checkout.observe = "SUCCEEDED";
          checkout.observeAt = new Date(now + LATE_SUCCESS_MS).toISOString();
          break;
        case "cancel":
          checkout.state = "PENDING";
          break;
      }
    });
    return outcome === "cancel" ? "cancel" : "return";
  }

  private checkoutOpen(checkout: StoredCheckout): boolean {
    return OPEN_CHECKOUT_STATES.has(checkout.state) && Date.parse(checkout.expiresAt) > this.lifecycleNow();
  }

  private settlementDelayMs(): number {
    const delay = this.hooks().settlementDelayMs;
    return typeof delay === "number" && Number.isFinite(delay) && delay >= 0 ? delay : DEFAULT_SETTLEMENT_DELAY_MS;
  }

  /**
   * `Invoice` as the blueprint has it (TAS-514, F1): the snapshots **as they
   * were stored at issuance** — never rebuilt from the company or the plan as
   * they are now, so a rename or a transfer leaves every issued invoice as it
   * was; `wireInstructions` only on a wire one, `fxQuote` only where there is
   * one, `matchedUnallocated` the bank money matched to it and not allocated.
   */
  private wireInvoice(invoice: StoredInvoice): unknown {
    const { version, replacesInvoiceId, wireInstructions, fxQuote, buyer, seller, lines, ...rest } = invoice;
    return {
      ...rest,
      total: { ...invoice.total },
      allocated: { ...invoice.allocated },
      remaining: { ...invoice.remaining },
      buyer: { ...buyer, address: { ...buyer.address } },
      seller: { ...seller, address: { ...seller.address } },
      lines: lines.map((line) => ({ ...line, net: { ...line.net }, total: { ...line.total }, taxes: line.taxes.map((tax) => ({ ...tax, amount: { ...tax.amount } })) })),
      ...(fxQuote === undefined ? {} : { fxQuote: { ...fxQuote } }),
      ...(wireInstructions === undefined || invoice.paymentMethod !== "WIRE" ? {} : { wireInstructions: { ...wireInstructions } }),
      version: String(version),
      ...(replacesInvoiceId === undefined ? {} : { replacesInvoiceId }),
      matchedUnallocated: { ...invoice.matchedUnallocated },
    };
  }

  /** `Checkout`: the page's address only while it is open — CREATED or PENDING, unexpired (A59). */
  private wireCheckout(checkout: StoredCheckout): unknown {
    return {
      id: checkout.id,
      invoiceId: checkout.invoiceId,
      state: checkout.state,
      expiresAt: checkout.expiresAt,
      ...(this.checkoutOpen(checkout) ? { redirectUrl: this.checkoutUrl(checkout.token) } : {}),
    };
  }

  /** Checks (1)–(9) for the four commands — see the block comment above. */
  private authorizeOwner(
    state: ServerState,
    bearer: string | null,
    tenantId: string,
    operation: string,
    policy: TenantPolicy,
  ): { session: StoredSession; tenant: StoredTenant; actor: StoredMembership } {
    if (!bearer) throw problem(401, "AUTHENTICATION_REQUIRED", "Authentication required");
    const session = this.sessionOf(state, bearer);
    if (session.kind === "WEB_GLOBAL") throw problem(400, "TENANT_REQUIRED", "A company session is required");
    const refusal = this.takeRefusal(operation);
    if (refusal) throw refusal;
    if (!UUID_PATTERN.test(tenantId)) throw problem(400, "VALIDATION_FAILED", "tenantId must be a UUID");
    if (session.tenantId !== tenantId) throw problem(403, "TENANT_MISMATCH", "The session is for another tenant");
    const tenant = state.tenants.find((item) => item.id === tenantId);
    if (!tenant || tenant.lifecycle === "DELETED") throw problem(404, "TENANT_NOT_FOUND", "Tenant not found");
    if (tenant.lifecycle !== "ACTIVE") throw problem(409, "INVALID_STATE", "The tenant is not active");
    const actor = state.memberships.find((item) => item.tenantId === tenantId && item.userId === session.userId);
    if (!actor || this.membershipState(state, tenantId, session.userId) !== "ACTIVE") {
      throw problem(403, "MEMBERSHIP_INACTIVE", "Membership is not active");
    }
    if (tenant.ownerId !== session.userId) throw problem(403, "OWNER_REQUIRED", "Only the owner can change the tenant");
    const restrictions = orderedRestrictions(tenant.restrictions);
    if (restrictions.some((code) => !POLICY_ALLOWS[policy].has(code))) {
      throw problem(403, "READ_ONLY", "The tenant is read-only", restrictions);
    }
    return { session, tenant, actor };
  }

  /**
   * The checks in front of every member route, in PR #287's order up to the
   * receipt: a company session of exactly this company (WEB_GLOBAL is 400
   * `TENANT_REQUIRED`, another company's 403 `TENANT_MISMATCH`), the company
   * there (404), a `refuseNext` hook, (1) the lifecycle, (2) the caller's
   * membership ACTIVE, (3) a company admin where the route needs one, (4) the
   * route's restriction policy:
   *
   * - `DIRECTORY` (the members list, CONTENT_READ's rule as `authorize` has
   *   it): refused 403 `CAPABILITY_DISABLED` with the ordered restrictions
   *   before the first payment, and under a pause or a block when the global
   *   read flag is off (ask A42);
   * - `SEATS` and `LEAVE`: never;
   * - `ADMIN_READ` (the invitations list): none stated, so never;
   * - `NORMAL` (role, state, invite, resend): `READ_ONLY` under any restriction;
   * - `RECOVERY` (remove, revoke): allowed under `PAYMENT_EXPIRED` and
   *   `OVER_QUOTA` only, otherwise `READ_ONLY`.
   */
  private authorizeMembers(
    state: ServerState,
    bearer: string | null,
    tenantId: string,
    operation: string,
    policy: MemberPolicy,
  ): { session: StoredSession; tenant: StoredTenant; actor: StoredMembership } {
    if (!bearer) throw problem(401, "AUTHENTICATION_REQUIRED", "Authentication required");
    const session = this.sessionOf(state, bearer);
    if (session.kind === "WEB_GLOBAL") throw problem(400, "TENANT_REQUIRED", "A company session is required");
    const refusal = this.takeRefusal(operation);
    if (refusal) throw refusal;
    if (!UUID_PATTERN.test(tenantId)) throw problem(400, "VALIDATION_FAILED", "tenantId must be a UUID");
    if (session.tenantId !== tenantId) throw problem(403, "TENANT_MISMATCH", "The session is for another tenant");
    const tenant = state.tenants.find((item) => item.id === tenantId);
    if (!tenant || tenant.lifecycle === "DELETED") throw problem(404, "TENANT_NOT_FOUND", "Tenant not found");
    const read = policy === "DIRECTORY" || policy === "SEATS" || policy === "ADMIN_READ";
    if (read ? tenant.lifecycle === "PROVISIONING" : tenant.lifecycle !== "ACTIVE") {
      throw problem(409, "INVALID_STATE", "The tenant is not active");
    }
    const actor = state.memberships.find((item) => item.tenantId === tenantId && item.userId === session.userId);
    if (!actor || this.membershipState(state, tenantId, session.userId) !== "ACTIVE") {
      throw problem(403, "MEMBERSHIP_INACTIVE", "Membership is not active");
    }
    if ((policy === "ADMIN_READ" || policy === "NORMAL" || policy === "RECOVERY") && actor.role !== "TENANT_ADMIN") {
      throw problem(403, "SCOPE_DENIED", "A tenant admin is required");
    }
    const restrictions = this.restrictionsOf(tenant);
    if (
      policy === "DIRECTORY" &&
      (restrictions.includes("PENDING_FIRST_PAYMENT") || (closesContent(restrictions) && !this.contentReadUnderRestriction()))
    ) {
      throw problem(403, "CAPABILITY_DISABLED", "The directory is not available", orderedRestrictions(restrictions));
    }
    if (policy === "NORMAL" && restrictions.length > 0) throw problem(403, "READ_ONLY", "The tenant is read-only", restrictions);
    if (policy === "RECOVERY" && restrictions.some((code) => !RECOVERY_ALLOWED.has(code))) {
      throw problem(403, "READ_ONLY", "The tenant is read-only", restrictions);
    }
    return { session, tenant, actor };
  }

  /** The company's restrictions, with the `restrict` hook's added — for the member routes only. */
  private restrictionsOf(tenant: StoredTenant): string[] {
    const extra = this.hooks().restrict?.[tenant.id];
    const added = Array.isArray(extra) ? extra.filter((code): code is string => typeof code === "string" && code !== "") : [];
    return [...new Set([...tenant.restrictions, ...added])];
  }

  /**
   * (5) The key's durable receipt: a key that is not a canonical UUID is 400;
   * seen with the same request, `replay` is what it answered; with another,
   * 409 `IDEMPOTENCY_CONFLICT`. `keep` records an answer and hands it back.
   */
  private memberReceipt(
    state: ServerState,
    actorId: string,
    operation: string,
    key: string,
    request: unknown,
  ): { replay: unknown; keep: <T>(answer: T) => T } {
    if (!CANONICAL_KEY.test(key)) throw problem(400, "VALIDATION_FAILED", "Idempotency-Key must be a canonical UUID");
    const receiptKey = `${actorId}:${operation}:${key}`;
    const hash = JSON.stringify(request);
    const stored = state.memberReceipts[receiptKey];
    if (stored) {
      if (stored.hash !== hash) throw problem(409, "IDEMPOTENCY_CONFLICT", "The key was used for another request");
      return { replay: stored.answer ?? null, keep: (answer) => answer };
    }
    return {
      replay: undefined,
      keep: (answer) => {
        state.memberReceipts[receiptKey] = { hash, answer };
        return answer;
      },
    };
  }

  /** (6) The target membership: absent or REMOVED is 404 `RESOURCE_NOT_FOUND`. */
  private targetMembership(state: ServerState, tenantId: string, userId: string): StoredMembership {
    const target = state.memberships.find((item) => item.tenantId === tenantId && item.userId === userId);
    if (!target || target.state === "REMOVED") throw problem(404, "RESOURCE_NOT_FOUND", "Membership not found");
    return target;
  }

  private targetInvitation(state: ServerState, tenantId: string, invitationId: string): StoredInvitation {
    const invitation = state.invitations.find((item) => item.id === invitationId && item.tenantId === tenantId);
    if (!invitation) throw problem(404, "RESOURCE_NOT_FOUND", "Invitation not found");
    return invitation;
  }

  /** (8) `If-Match`: missing 428 `VERSION_CONFLICT`, malformed 400 `VALIDATION_FAILED`, stale 412 (contracts §6). */
  private checkVersion(version: string, current: number | string): void {
    if (version === "") throw problem(428, "VERSION_CONFLICT", "If-Match is required");
    if (!/^(0|[1-9][0-9]{0,18})$/.test(version)) throw problem(400, "VALIDATION_FAILED", "If-Match must be a quoted version");
    if (version !== String(current)) throw problem(412, "VERSION_CONFLICT", "The resource has changed");
  }

  /** (9) The active admins other than `userId` — the owner is always one, so this is 0 only in a fixture nobody seeds. */
  private otherActiveAdmins(state: ServerState, tenantId: string, userId: string): number {
    return state.memberships.filter(
      (item) =>
        item.tenantId === tenantId &&
        item.userId !== userId &&
        item.role === "TENANT_ADMIN" &&
        this.membershipState(state, tenantId, item.userId) === "ACTIVE",
    ).length;
  }

  /** `used` (ACTIVE and SUSPENDED memberships) and `reserved` (PENDING invitations), in BigInt. */
  private seatCounts(state: ServerState, tenant: StoredTenant): { used: bigint; reserved: bigint } {
    const used = state.memberships.filter(
      (item) => item.tenantId === tenant.id && (item.state === "ACTIVE" || item.state === "SUSPENDED"),
    ).length;
    const reserved = state.invitations.filter((item) => item.tenantId === tenant.id && item.state === "PENDING").length;
    return { used: BigInt(used), reserved: BigInt(reserved) };
  }

  /** The person's pending invitations revoked — on a suspension, removal, demotion or leave (contracts §8, L03). */
  private revokeInvitationsBy(state: ServerState, tenant: StoredTenant, userId: string): void {
    let revoked = false;
    for (const invitation of state.invitations) {
      if (invitation.tenantId !== tenant.id || invitation.createdBy !== userId || invitation.state !== "PENDING") continue;
      invitation.state = "REVOKED";
      invitation.version += 1;
      revoked = true;
    }
    if (revoked) tenant.quotaVersion += 1;
  }

  /**
   * What a suspension, a removal and a leave take from a person (contracts
   * §8): their company sessions, their pending invitations, their project
   * rows and assignments — recorded, so a store built later leaves them out.
   */
  private cutOff(state: ServerState, tenant: StoredTenant, userId: string): void {
    this.revokeSessionsOf(state, tenant, userId);
    this.revokeInvitationsBy(state, tenant, userId);
    const seq = state.cleared.reduce((top, item) => Math.max(top, item.seq), 0) + 1;
    state.cleared.push({ tenantId: tenant.id, userId, seq });
    this.applyClears(
      tenant.id,
      state.cleared.filter((item) => item.tenantId === tenant.id),
    );
  }

  /** The person's company sessions of this company, revoked. */
  private revokeSessionsOf(state: ServerState, tenant: StoredTenant, userId: string): void {
    for (const session of state.sessions) {
      if (session.kind === "WEB_TENANT" && session.tenantId === tenant.id && session.userId === userId) session.revokedAt ??= this.now();
    }
  }

  /** A membership ended — removed or left: REMOVED, its seat free, and everything `cutOff` takes. */
  private removeMembership(state: ServerState, tenant: StoredTenant, membership: StoredMembership): void {
    membership.state = "REMOVED";
    membership.version += 1;
    tenant.generation += 1;
    tenant.quotaVersion += 1;
    this.cutOff(state, tenant, membership.userId);
    // A seat freed may bring the company back within its plan (TAS-512).
    this.reconcileBreaches(state, tenant);
  }

  /** The clears this page's store of `tenantId` has not applied yet, applied — once each. */
  private applyClears(tenantId: string, cleared: ReadonlyArray<{ userId: string; seq: number }>): void {
    const store = this.stores.get(tenantId);
    if (!store) return;
    const applied = this.appliedClears.get(tenantId) ?? new Set<number>();
    this.appliedClears.set(tenantId, applied);
    for (const item of cleared) {
      if (applied.has(item.seq)) continue;
      store.forgetCompanyMember(item.userId);
      applied.add(item.seq);
    }
  }

  private pageLimit(params: ListCompanyPageParams): number {
    const limit = params.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw problem(400, "VALIDATION_FAILED", "limit must be 1–100");
    return limit;
  }

  /** `Membership` as the blueprint has it (its to-be — develop sends no profile, TAS-321); never `avatarPath`. */
  private wireMembership(state: ServerState, tenant: StoredTenant, membership: StoredMembership): unknown {
    const profile = this.accountStore.accountProfile(membership.userId);
    return {
      id: membership.id,
      tenantId: membership.tenantId,
      userId: membership.userId,
      role: membership.role,
      state: this.membershipState(state, membership.tenantId, membership.userId) ?? membership.state,
      isOwner: tenant.ownerId === membership.userId,
      ...(profile ? { displayName: profile.displayName, email: profile.email } : {}),
      version: String(membership.version),
    };
  }

  /** `Invitation` — without `issuedAt`, which is not on the wire. */
  private wireInvitation(invitation: StoredInvitation): unknown {
    const { issuedAt: _issued, version, projectGrants, ...rest } = invitation;
    return { ...rest, projectGrants: projectGrants.map((grant) => ({ ...grant })), version: String(version) };
  }

  /* ---------------------------------------------------------- the checks */

  /** The company-session commands and the list: WEB_GLOBAL only (backend PR #288's scopes; the blueprint says any web session, ask A2). */
  private authorizeCommand(state: ServerState, bearer: string): { userId: string; sessionId: string } {
    const session = this.sessionOf(state, bearer);
    if (session.kind !== "WEB_GLOBAL") throw problem(403, "SCOPE_DENIED", "An account session is required");
    return { userId: session.userId, sessionId: session.id };
  }

  /**
   * A data call's bearer. A company route with WEB_GLOBAL is 400
   * `TENANT_REQUIRED`; a WEB_TENANT whose membership is not active is 403
   * `MEMBERSHIP_INACTIVE`, of a deleted company 404 `TENANT_NOT_FOUND`; a
   * company still PROVISIONING answers its content routes 409 `INVALID_STATE`;
   * a write in a company with any restriction is 403 `READ_ONLY` with them as
   * `reasons`; a read of one awaiting its first payment is 403
   * `CAPABILITY_DISABLED` with them.
   */
  private authorize(state: ServerState, bearer: string | null, kind: MockRouteKind): { userId: string; tenantId: string | null } {
    if (!bearer) throw problem(401, "AUTHENTICATION_REQUIRED", "Authentication required");
    const session = this.sessionOf(state, bearer);
    if (session.kind === "WEB_GLOBAL") {
      if (kind !== "account") throw problem(400, "TENANT_REQUIRED", "A company session is required");
      return { userId: session.userId, tenantId: null };
    }
    const tenantId = session.tenantId ?? "";
    const tenant = state.tenants.find((item) => item.id === tenantId);
    if (!tenant || tenant.lifecycle === "DELETED") throw problem(404, "TENANT_NOT_FOUND", "Tenant not found");
    if (this.membershipState(state, tenantId, session.userId) !== "ACTIVE") {
      throw problem(403, "MEMBERSHIP_INACTIVE", "Membership is not active");
    }
    // A company still being set up has no content to serve (the blueprint is
    // silent; this mock's answer, ask A14).
    if ((kind === "tenant-read" || kind === "tenant-write") && tenant.lifecycle === "PROVISIONING") {
      throw problem(409, "INVALID_STATE", "The company is still being set up");
    }
    if (kind === "tenant-write" && tenant.restrictions.length > 0) {
      throw problem(403, "READ_ONLY", "The company is read-only", tenant.restrictions);
    }
    // Before its first payment, never — whatever the global flag (TAS-501, B5:
    // the blueprint's CONTENT_READ denies PENDING_FIRST_PAYMENT outright).
    if (kind === "tenant-read" && tenant.restrictions.includes("PENDING_FIRST_PAYMENT")) {
      throw problem(403, "CAPABILITY_DISABLED", "Project content is not available", tenant.restrictions);
    }
    // Only a pause or a block closes content with the flag off (contracts §5,
    // D82); a dispute, an ended period or a quota leaves it readable
    // (api-contract-guard §4). The reasons are every current restriction.
    if (kind === "tenant-read" && closesContent(tenant.restrictions) && !this.contentReadUnderRestriction()) {
      throw problem(403, "CAPABILITY_DISABLED", "Project content is not available", orderedRestrictions(tenant.restrictions));
    }
    return { userId: session.userId, tenantId };
  }

  /**
   * The route kind "tenant-control" (TAS-501): `getTenant`,
   * `getTenantOperation`, `cancelTenantCreation`. A company session of exactly
   * the path's company (anything else — another company's, the account's — is
   * 403 `TENANT_MISMATCH`), an `ACTIVE` membership, and **not** stopped by a
   * restriction: a company awaiting its first payment is read and cancelled
   * with its own session (api-contract-guard §4).
   */
  private authorizeControl(
    state: ServerState,
    bearer: string | null,
    tenantId: string,
    operation: string,
  ): { session: StoredSession; tenant: StoredTenant } {
    if (!bearer) throw problem(401, "AUTHENTICATION_REQUIRED", "Authentication required");
    const session = this.sessionOf(state, bearer);
    const refusal = this.takeRefusal(operation);
    if (refusal) throw refusal;
    if (!UUID_PATTERN.test(tenantId)) throw problem(400, "VALIDATION_FAILED", "tenantId must be a UUID");
    if (session.kind !== "WEB_TENANT" || session.tenantId !== tenantId) {
      throw problem(403, "TENANT_MISMATCH", "The session is for another tenant");
    }
    const tenant = state.tenants.find((item) => item.id === tenantId);
    if (!tenant || tenant.lifecycle === "DELETED") throw problem(404, "TENANT_NOT_FOUND", "Tenant not found");
    if (this.membershipState(state, tenantId, session.userId) !== "ACTIVE") {
      throw problem(403, "MEMBERSHIP_INACTIVE", "Membership is not active");
    }
    return { session, tenant };
  }

  /**
   * `Tenant` as the wire carries it: `creationDeadline` only when there is one,
   * and none of the mock's own bookkeeping — the subscription included
   * (TAS-504: `getSubscription` is the owner's only).
   */
  private wireTenant(tenant: StoredTenant): unknown {
    const {
      seatLimit: _seats,
      quotaVersion: _quota,
      generation: _generation,
      subscription: _subscription,
      entitlementVersion: _entitlement,
      quotaBreach: _breach,
      appliedPlan: _applied,
      invoiceMethod: _method,
      ...rest
    } = tenant;
    return { ...rest, restrictions: [...tenant.restrictions] };
  }

  /**
   * `Subscription`: `paidThrough` and `anchorDay` only when there is a paid
   * period (ask A37); the scheduled plan only when the owner chose one — its
   * date gone once the boundary passed unpaid (TAS-515). Never the change in
   * force, the renewal calendar or the mandate version: none is on the wire.
   */
  private wireSubscription(tenant: StoredTenant): unknown {
    const { planVersionId, version, paidThrough, anchorDay, renewalCancelled, autopayState, scheduledPlanVersionId, scheduledEffectiveAt } =
      tenant.subscription;
    return {
      tenantId: tenant.id,
      planVersionId,
      version,
      ...(paidThrough === undefined ? {} : { paidThrough }),
      ...(anchorDay === undefined ? {} : { anchorDay }),
      renewalCancelled,
      ...(scheduledPlanVersionId === undefined ? {} : { scheduledPlanVersionId }),
      ...(scheduledEffectiveAt === undefined ? {} : { scheduledEffectiveAt }),
      autopayState,
    };
  }

  /**
   * `Entitlement` as the blueprint has it (TAS-512): the subscription's plan,
   * `validFrom` the paid period's start (the mock's 30 days before its end)
   * else the company's creation, `validUntil` the paid-through only while
   * there is one, every current restriction in order, the plan's limits and
   * its capabilities as `features`, issued now.
   */
  private wireEntitlement(tenant: StoredTenant): unknown {
    const plan = MOCK_PLANS.find((item) => item.id === tenant.subscription.planVersionId);
    const through = tenant.subscription.paidThrough;
    return {
      tenantId: tenant.id,
      version: String(tenant.entitlementVersion),
      planVersionId: tenant.subscription.planVersionId,
      validFrom: through === undefined ? tenant.createdAt : new Date(Date.parse(through) - PAID_PERIOD_MS).toISOString(),
      ...(through === undefined ? {} : { validUntil: through }),
      restrictions: orderedRestrictions(tenant.restrictions),
      limits: (plan?.limits ?? []).map((limit) => ({ ...limit })),
      features: [...(plan?.capabilities ?? [])],
      issuedAt: new Date(this.now()).toISOString(),
    };
  }

  /* ------------------------------------- the plan's quotas (TAS-512) */

  /**
   * Whether the company is within its plan's limit of `kind` (api-contract-
   * guard §5): seats held (`used + reserved`), every project of its store,
   * the confirmed bytes, and every project's lifetime counter. An unlimited or
   * unnamed limit is always within.
   */
  private withinLimit(state: ServerState, tenant: StoredTenant, kind: string): boolean {
    if (kind === "SEAT") {
      if (tenant.seatLimit === null) return true;
      const seats = this.seatCounts(state, tenant);
      return seats.used + seats.reserved <= BigInt(tenant.seatLimit);
    }
    const limit = planLimitOf(tenant.subscription.planVersionId, kind);
    if (limit === null) return true;
    if (kind === "PROJECT") return BigInt(this.tenantStore(tenant.id).projectCount()) <= BigInt(limit);
    if (kind === "STORAGE_BYTES") return this.tenantStore(tenant.id).storageUsage().used <= BigInt(limit);
    if (kind === "TASK_LIFETIME") {
      return Object.values(state.taskLifetime).every((entry) => entry.tenantId !== tenant.id || BigInt(entry.count) <= BigInt(limit));
    }
    return true;
  }

  /**
   * `OVER_QUOTA` kept in step with the breached kinds: a kind leaves the
   * breach once it is within its limit; `TASK_LIFETIME` joins it whenever a
   * counter is past a finite limit; `OVER_QUOTA` is set exactly while one is
   * left, and a change moves the company's and the entitlement's versions.
   * Answers whether anything changed.
   */
  private reconcileBreaches(state: ServerState, tenant: StoredTenant): boolean {
    const breach = tenant.quotaBreach.filter((kind) => !this.withinLimit(state, tenant, kind));
    if (!breach.includes("TASK_LIFETIME") && !this.withinLimit(state, tenant, "TASK_LIFETIME")) breach.push("TASK_LIFETIME");
    const ordered = BREACH_KINDS.filter((kind) => breach.includes(kind));
    let changed = ordered.join() !== tenant.quotaBreach.join();
    tenant.quotaBreach = ordered;
    if (setRestriction(tenant, "OVER_QUOTA", ordered.length > 0)) {
      tenant.entitlementVersion += 1;
      changed = true;
    }
    return changed;
  }

  /**
   * A plan applied (the `applyPlan` hook, standing in for a change made
   * elsewhere, TAS-483): a FREE one as develop's Paid→FREE (`toFree`, F8,
   * without spending anybody's allowance); a paid one keeps the paid period,
   * any scheduled change dropped. The seat limit follows, the entitlement
   * version moves, and every kind over its new limit is breached
   * (`reconcileBreaches` sets `OVER_QUOTA`).
   */
  private applyPlan(state: ServerState, tenant: StoredTenant, planVersionId: string): void {
    tenant.appliedPlan = planVersionId;
    if (isFreePlan(planVersionId)) {
      this.toFree(state, tenant, null);
      return;
    }
    this.supersede(state, tenant, false);
    tenant.subscription = { ...tenant.subscription, version: nextVersion(tenant.subscription.version) };
    this.switchPlan(state, tenant, planVersionId);
  }

  /** The company a project belongs to, from the counters, else this page's stores. */
  private tenantOfProject(state: ServerState, projectId: string): string | null {
    const counted = state.taskLifetime[projectId]?.tenantId;
    if (counted) return counted;
    for (const [tenantId, seed] of Object.entries(TENANT_SEEDS)) {
      if (seed.keep.some((item) => item.projectId === projectId) || seed.add.some((item) => item.id === projectId)) return tenantId;
    }
    for (const [tenantId, store] of this.stores) if (store.hasOpenProject(projectId)) return tenantId;
    return null;
  }

  /** `Operation`; `asCreated` is develop's createTenant answer — PENDING, `updatedAt = createdAt` (ask A12). */
  private wireOperation(operation: StoredOperation, asCreated: boolean): unknown {
    const { actorId: _actor, subjectUserId: _subject, failureCode, ...rest } = operation;
    if (asCreated) return { ...rest, state: "PENDING", updatedAt: operation.createdAt };
    return { ...rest, ...(failureCode ? { failureCode } : {}) };
  }

  private creationAnswer(tenant: StoredTenant, operation: StoredOperation): unknown {
    return { tenant: this.wireTenant(tenant), operation: this.wireOperation(operation, true) };
  }

  private sessionOf(state: ServerState, bearer: string): StoredSession {
    const access = state.access[bearer];
    if (!access || access.expiresAt <= this.now()) throw problem(401, "AUTHENTICATION_REQUIRED", "Authentication required");
    const session = state.sessions.find((item) => item.id === access.sessionId);
    if (!session || !this.alive(state, session)) throw problem(401, "TOKEN_REVOKED", "Invalid session");
    return session;
  }

  private alive(state: ServerState, session: StoredSession): boolean {
    if (session.revokedAt !== undefined || session.expiresAt <= this.now()) return false;
    if (session.parentId === undefined) return true;
    const parent = state.sessions.find((item) => item.id === session.parentId);
    return parent !== undefined && this.alive(state, parent);
  }

  /** The membership's state as the hooks leave it: `suspend` answers `SUSPENDED` over whatever is stored. */
  private membershipState(state: ServerState, tenantId: string, userId: string): MembershipState | null {
    const membership = state.memberships.find((item) => item.tenantId === tenantId && item.userId === userId);
    if (!membership) return null;
    const suspended = this.hooks().suspend?.some((item) => item.tenantId === tenantId && item.userId === userId);
    return suspended && membership.state === "ACTIVE" ? "SUSPENDED" : membership.state;
  }

  /** A reused refresh token ends its family: an account session with every company session under it, or the one company session. */
  private revokeFamily(state: ServerState, session: StoredSession): void {
    session.revokedAt ??= this.now();
    if (session.kind === "WEB_GLOBAL") {
      for (const child of state.sessions) if (child.parentId === session.id) child.revokedAt ??= this.now();
    }
  }

  /** A fresh pair for `session`: an access token living `accessTtlSeconds`, a refresh token of 32+ characters. */
  private issue(state: ServerState, session: StoredSession): WireAccessSession {
    const ttl = this.accessTtlSeconds();
    const accessToken = `mock-${session.kind === "WEB_GLOBAL" ? "account" : "company"}-access-${uuid()}`;
    const refreshToken = `mock-refresh-${uuid()}-${uuid()}`;
    state.access[accessToken] = { sessionId: session.id, expiresAt: this.now() + ttl * 1000 };
    state.refresh[refreshToken] = { sessionId: session.id };
    return {
      sessionId: session.id,
      userId: session.userId,
      ...(session.tenantId ? { tenantId: session.tenantId } : {}),
      accessToken,
      refreshToken,
      tokenType: "Bearer",
      expiresIn: ttl,
      mfaVerified: false,
    };
  }

  /** A secret answer replayed for the same key within 60 s; the same key on another request is 409. */
  private replay(state: ServerState, key: string, operation: string, hash: string): unknown {
    const receipt = state.receipts[key];
    if (!receipt) return undefined;
    if (receipt.operation !== operation || receipt.hash !== hash) {
      throw problem(409, "IDEMPOTENCY_CONFLICT", "The key was used for another request");
    }
    if (this.now() - receipt.at > SECRET_RECEIPT_MS) throw problem(409, "INVALID_STATE", "The answer is no longer available");
    return receipt.answer;
  }

  private writeCursor(offset: number, userId: string): string {
    return btoa(JSON.stringify({ o: offset, u: userId }));
  }

  private readCursor(cursor: string, userId: string): number {
    try {
      const parsed = JSON.parse(atob(cursor)) as { o?: unknown; u?: unknown };
      if (parsed.u === userId && typeof parsed.o === "number" && Number.isInteger(parsed.o) && parsed.o >= 0) return parsed.o;
    } catch {
      // falls through to the refusal
    }
    throw problem(400, "VALIDATION_FAILED", "cursor is not valid");
  }

  /* ------------------------------------------------------------- plumbing */

  private tenantStore(tenantId: string): MockTaskaStore {
    let store = this.stores.get(tenantId);
    if (!store) {
      store = new MockTaskaStore();
      // Nina signs in here (the constructor's note) — and since TAS-501 she can
      // create a company and work in it, so every store knows her as ACTIVE.
      store.overrideAccountStatus(MOCK_ACCOUNT_IDS.nina, "ACTIVE");
      store.applyTenantSeed(TENANT_SEEDS[tenantId] ?? EMPTY_SEED);
      this.stores.set(tenantId, store);
    }
    return store;
  }

  private read<T>(run: (state: ServerState) => T): T {
    return run(this.load());
  }

  /** Read, change, write back — also when `run` throws, since a refusal may have revoked a family first. */
  private write<T>(run: (state: ServerState) => T): T {
    const state = this.load();
    try {
      return run(state);
    } finally {
      this.save(state);
    }
  }

  private load(): ServerState {
    const state = this.stored();
    // Time and the hooks are read on every load (no timers): what changed is written back.
    if (this.evaluate(state)) this.save(state);
    return state;
  }

  private stored(): ServerState {
    try {
      const raw = this.storage.getItem(MOCK_SERVER_KEY);
      if (raw !== null) {
        const parsed = JSON.parse(raw) as ServerState;
        if (parsed && parsed.v === 8 && Array.isArray(parsed.tenants)) return parsed;
      }
    } catch {
      if (this.memory) return this.memory;
    }
    return {
      v: 8,
      ...seedTenants(this.now()),
      checkouts: [],
      checkoutReceipts: {},
      billingReceipts: {},
      lifetimeApplied: {},
      sessions: [],
      access: {},
      refresh: {},
      receipts: {},
      operations: [],
      creations: {},
      cancels: {},
      memberReceipts: {},
      cleared: [],
    };
  }

  /**
   * The lifecycle clock's effects (TAS-501): an operation moves through
   * PENDING and RUNNING to its outcome by `provisioning.stepMs`, and a FREE
   * company opens when it succeeds; a confirmed first payment opens a company
   * awaiting it; a passed deadline closes it (`AUTO_CLOSED`); a late
   * confirmation reopens an auto-closed one (D216) — never a cancelled one.
   * Each change moves the company's version. Since TAS-502 a removal's
   * operation moves the same way by `memberOperationStepMs` (default 0) and
   * removes the member when it succeeds, and a pending invitation whose
   * `expiresAt` has passed is EXPIRED, its seat released. Since TAS-504 a
   * confirmed first payment starts a paid period (`PAID_PERIOD_MS`, the mock's
   * own length), an ACTIVE company whose `paidThrough` has passed gets
   * `PAYMENT_EXPIRED` (nothing here lifts it — payment is TAS-513), and the
   * `platformBlock` hook sets or lifts `PLATFORM_BLOCK`; each change moves the
   * version. Answers whether anything changed.
   */
  private evaluate(state: ServerState): boolean {
    const now = this.lifecycleNow();
    const hooks = this.hooks();
    const step = hooks.provisioning?.stepMs;
    const stepMs = typeof step === "number" && Number.isFinite(step) && step >= 0 ? step : DEFAULT_PROVISIONING_STEP_MS;
    const outcome = hooks.provisioning?.outcome;
    const terminal = outcome === "FAILED" || outcome === "MANUAL_REVIEW" ? outcome : "SUCCEEDED";
    const confirmed = new Set(Array.isArray(hooks.firstPaymentConfirmed) ? hooks.firstPaymentConfirmed : []);
    const late = new Set(Array.isArray(hooks.latePaymentConfirmed) ? hooks.latePaymentConfirmed : []);
    let changed = false;
    const open = (tenant: StoredTenant, paidAt?: number) => {
      tenant.lifecycle = "ACTIVE";
      tenant.restrictions = tenant.restrictions.filter((code) => code !== "PENDING_FIRST_PAYMENT");
      delete tenant.creationDeadline;
      tenant.version = nextVersion(tenant.version);
      // A first payment confirmed: the paid period starts (TAS-504).
      if (paidAt !== undefined && !isFreePlan(tenant.subscription.planVersionId)) {
        const through = new Date(paidAt + PAID_PERIOD_MS);
        tenant.subscription = {
          ...tenant.subscription,
          version: nextVersion(tenant.subscription.version),
          paidThrough: through.toISOString(),
          anchorDay: through.getUTCDate(),
        };
        tenant.entitlementVersion += 1;
      }
      changed = true;
    };

    const memberStep = hooks.memberOperationStepMs;
    const memberStepMs = typeof memberStep === "number" && Number.isFinite(memberStep) && memberStep >= 0 ? memberStep : 0;
    const memberOutcome = hooks.memberOperationOutcome;
    const memberTerminal = memberOutcome === "FAILED" || memberOutcome === "MANUAL_REVIEW" ? memberOutcome : "SUCCEEDED";
    for (const operation of state.operations) {
      if (TERMINAL_OPERATION_STATES.has(operation.state)) continue;
      const removal = operation.type === REMOVE_OPERATION_TYPE;
      const step = removal ? memberStepMs : stepMs;
      const end = removal ? memberTerminal : terminal;
      const started = Date.parse(operation.createdAt);
      const elapsed = now - started;
      const next = elapsed < step ? "PENDING" : elapsed < 2 * step ? "RUNNING" : end;
      if (next === operation.state) continue;
      operation.state = next;
      operation.updatedAt = new Date(next === "RUNNING" ? started + step : started + 2 * step).toISOString();
      if (next === "FAILED") {
        operation.failureCode = removal
          ? (hooks.memberOperationFailureCode ?? "DEPENDENCY_UNAVAILABLE")
          : (hooks.provisioning?.failureCode ?? "DEPENDENCY_UNAVAILABLE");
      }
      changed = true;
      const tenant = state.tenants.find((item) => item.id === operation.tenantId);
      if (removal) {
        const subject = state.memberships.find((item) => item.tenantId === operation.tenantId && item.userId === operation.subjectUserId);
        if (next === "SUCCEEDED" && tenant && subject && subject.state !== "REMOVED") this.removeMembership(state, tenant, subject);
        continue;
      }
      if (next === "SUCCEEDED" && tenant?.lifecycle === "PROVISIONING") open(tenant);
    }
    for (const invitation of state.invitations) {
      if (invitation.state !== "PENDING" || Date.parse(invitation.expiresAt) > now) continue;
      invitation.state = "EXPIRED";
      invitation.version += 1;
      const tenant = state.tenants.find((item) => item.id === invitation.tenantId);
      if (tenant) tenant.quotaVersion += 1;
      changed = true;
    }
    // TAS-513: the provider's observations, their settlement, and what expires.
    if (this.evaluatePayments(state, now, open)) changed = true;
    for (const tenant of state.tenants) {
      if (tenant.lifecycle === "AWAITING_PAYMENT" && confirmed.has(tenant.id)) {
        // The hook stands in for this path's settlement: the first invoice is paid with it.
        const first = state.invoices.find((item) => item.tenantId === tenant.id && item.purpose === "INITIAL" && item.state === "OPEN");
        if (first) markPaid(first);
        open(tenant, now);
      }
      else if (tenant.lifecycle === "AWAITING_PAYMENT" && tenant.creationDeadline && Date.parse(tenant.creationDeadline) <= now) {
        tenant.lifecycle = "AUTO_CLOSED";
        tenant.version = nextVersion(tenant.version);
        changed = true;
      } else if (tenant.lifecycle === "AUTO_CLOSED" && late.has(tenant.id)) open(tenant, now);
    }
    // TAS-512: the lifetime counters a hook sets, once per value.
    const lifetimes = typeof hooks.taskLifetime === "object" && hooks.taskLifetime !== null ? hooks.taskLifetime : {};
    for (const [projectId, count] of Object.entries(lifetimes)) {
      if (typeof count !== "number" || !Number.isInteger(count) || count < 0 || state.lifetimeApplied[projectId] === count) continue;
      const tenantId = this.tenantOfProject(state, projectId);
      if (tenantId === null) continue;
      state.taskLifetime[projectId] = { tenantId, count };
      state.lifetimeApplied[projectId] = count;
      changed = true;
    }
    // TAS-515: a NEXT_PERIOD change's boundary — never a scheduled plan applied
    // without its payment (F2). TAS-512: a plan the hook applies, a payment
    // dispute, and the quota kinds a company is over.
    const plans = typeof hooks.applyPlan === "object" && hooks.applyPlan !== null ? hooks.applyPlan : {};
    const disputes = typeof hooks.paymentDispute === "object" && hooks.paymentDispute !== null ? hooks.paymentDispute : {};
    const suspended = typeof hooks.autopaySuspended === "object" && hooks.autopaySuspended !== null ? hooks.autopaySuspended : {};
    for (const tenant of state.tenants) {
      if (this.passBoundary(state, tenant, now)) changed = true;
      const wanted = plans[tenant.id];
      if (typeof wanted === "string" && wanted !== tenant.appliedPlan && MOCK_PLANS.some((plan) => plan.id === wanted)) {
        this.applyPlan(state, tenant, wanted);
        changed = true;
      }
      const dispute = disputes[tenant.id];
      if (typeof dispute === "boolean" && setRestriction(tenant, "PAYMENT_DISPUTE", dispute)) {
        tenant.entitlementVersion += 1;
        // A dispute switches automatic payments off, and lifting it never turns them back on (F7).
        if (dispute && tenant.subscription.autopayState !== "DISABLED") {
          tenant.subscription = { ...tenant.subscription, autopayState: "DISABLED", version: nextVersion(tenant.subscription.version) };
        }
        changed = true;
      }
      if (suspended[tenant.id] === true && tenant.subscription.autopayState === "CONSENTED") {
        tenant.subscription = { ...tenant.subscription, autopayState: "SUSPENDED", version: nextVersion(tenant.subscription.version) };
        changed = true;
      }
      if (this.reconcileBreaches(state, tenant)) changed = true;
    }
    // TAS-504: the platform's block, and paid periods that have ended.
    const blocks = typeof hooks.platformBlock === "object" && hooks.platformBlock !== null ? hooks.platformBlock : {};
    for (const tenant of state.tenants) {
      const block = blocks[tenant.id];
      if (typeof block === "boolean" && setRestriction(tenant, "PLATFORM_BLOCK", block)) changed = true;
      const through = tenant.subscription.paidThrough;
      if (tenant.lifecycle === "ACTIVE" && through !== undefined && Date.parse(through) <= now && setRestriction(tenant, "PAYMENT_EXPIRED", true)) {
        // TAS-512: the coverage ended, so the entitlement moves too.
        tenant.entitlementVersion += 1;
        changed = true;
      }
      if (this.issueRenewal(state, tenant, now)) changed = true;
    }
    return changed;
  }

  /**
   * A NEXT_PERIOD change at its boundary (`PlanCoveragePolicy.java:151-200`):
   * paid by then, the plan switches there with a month from it, the anchor
   * kept; unpaid, its date goes and the plan id stays — the invoice expired
   * at the same instant, and with it the change (the mock's choice).
   */
  private passBoundary(state: ServerState, tenant: StoredTenant, now: number): boolean {
    const sub = tenant.subscription;
    const change = sub.activeChange;
    const at = sub.scheduledEffectiveAt;
    if (at === undefined || Date.parse(at) > now) return false;
    if (change?.effect === "NEXT_PERIOD" && change.paidAt !== undefined) {
      const { activeChange: _change, scheduledPlanVersionId: _plan, scheduledEffectiveAt: _at, renewalIssuedFor: _issued, ...kept } = sub;
      const end = new Date(Date.parse(at) + PAID_PERIOD_MS);
      tenant.subscription = { ...kept, version: nextVersion(sub.version), paidThrough: end.toISOString() };
      this.switchPlan(state, tenant, change.planVersionId);
      setRestriction(tenant, "PAYMENT_EXPIRED", false);
      this.reconcileBreaches(state, tenant);
      return true;
    }
    const { activeChange: _change, scheduledEffectiveAt: _at, ...kept } = sub;
    tenant.subscription = { ...kept, version: nextVersion(sub.version) };
    return true;
  }

  /**
   * The renewal calendar (invented, guard §6): a RENEWAL of the plan it is on,
   * issued 7 days before `paidThrough` and due at it, once per period — only
   * with renewal on, no plan change in force, and the period not yet over (no
   * invoice is issued after an unpaid boundary, `RenewalCalendar.java:68-73`).
   */
  private issueRenewal(state: ServerState, tenant: StoredTenant, now: number): boolean {
    const sub = tenant.subscription;
    const through = sub.paidThrough === undefined ? Number.NaN : Date.parse(sub.paidThrough);
    if (tenant.lifecycle !== "ACTIVE" || !Number.isFinite(through) || sub.renewalCancelled || sub.activeChange !== undefined) return false;
    if (isFreePlan(sub.planVersionId) || sub.renewalIssuedFor === sub.paidThrough || now < through - RENEWAL_LEAD_MS || now >= through) return false;
    if (state.invoices.some((invoice) => invoice.tenantId === tenant.id && invoice.purpose === "RENEWAL" && invoice.state === "OPEN")) return false;
    this.issueInvoice(state, tenant, "RENEWAL", sub.planVersionId, through - RENEWAL_LEAD_MS, through);
    tenant.subscription = { ...sub, renewalIssuedFor: sub.paidThrough };
    return true;
  }

  /**
   * TAS-513's two steps (api-contract-guard §5.2–5.3), on the lifecycle clock:
   * a late observation lands (`observeAt`), `resolveCheckout` answers an open
   * or UNKNOWN checkout once, an open checkout past `expiresAt` is EXPIRED, and
   * a SUCCEEDED one is **settled** at `settleAt` — its invoice PAID in full,
   * then the company opened (INITIAL) or its paid period moved on and
   * `PAYMENT_EXPIRED` lifted (RENEWAL, PLAN_CHANGE): from the current end when
   * it is still ahead, else from the settlement (D247). Then an OPEN invoice
   * past `dueAt` is EXPIRED, with its open checkouts. Answers whether anything
   * changed.
   */
  private evaluatePayments(state: ServerState, now: number, open: (tenant: StoredTenant, paidAt?: number) => void): boolean {
    const hooks = this.hooks();
    const resolve = typeof hooks.resolveCheckout === "object" && hooks.resolveCheckout !== null ? hooks.resolveCheckout : {};
    const settleDelay = this.settlementDelayMs();
    let changed = false;
    for (const checkout of state.checkouts) {
      if (checkout.observeAt !== undefined && checkout.state === "PENDING" && Date.parse(checkout.observeAt) <= now) {
        const at = Date.parse(checkout.observeAt);
        checkout.state = checkout.observe ?? "SUCCEEDED";
        if (checkout.state === "SUCCEEDED") checkout.settleAt = new Date(at + settleDelay).toISOString();
        delete checkout.observeAt;
        delete checkout.observe;
        changed = true;
      }
      const wanted = resolve[checkout.invoiceId];
      if (!checkout.resolved && (wanted === "SUCCEEDED" || wanted === "FAILED") && (OPEN_CHECKOUT_STATES.has(checkout.state) || checkout.state === "UNKNOWN")) {
        checkout.state = wanted;
        checkout.resolved = true;
        delete checkout.observeAt;
        delete checkout.observe;
        if (wanted === "SUCCEEDED") checkout.settleAt = new Date(now + settleDelay).toISOString();
        changed = true;
      }
      if (OPEN_CHECKOUT_STATES.has(checkout.state) && checkout.observeAt === undefined && Date.parse(checkout.expiresAt) <= now) {
        checkout.state = "EXPIRED";
        changed = true;
      }
      if (checkout.state === "SUCCEEDED" && !checkout.settled && checkout.settleAt !== undefined && Date.parse(checkout.settleAt) <= now) {
        checkout.settled = true;
        changed = true;
        const invoice = state.invoices.find((item) => item.id === checkout.invoiceId);
        if (invoice && invoice.state === "OPEN") this.settle(state, invoice, Date.parse(checkout.settleAt), open);
      }
    }
    // TAS-514: a PARTIALLY_PAID one expires too, its matched money kept until its return is confirmed —
    // unless `holdExpiry` keeps it past its due date, as develop does.
    const held = new Set(Array.isArray(hooks.holdExpiry) ? hooks.holdExpiry : []);
    for (const invoice of state.invoices) {
      if (!PAYABLE_BY_WIRE.has(invoice.state) || Date.parse(invoice.dueAt) > now || held.has(invoice.id)) continue;
      invoice.state = "EXPIRED";
      invoice.version += 1;
      for (const checkout of state.checkouts) {
        if (checkout.invoiceId === invoice.id && OPEN_CHECKOUT_STATES.has(checkout.state)) checkout.state = "EXPIRED";
      }
      // TAS-515: a plan change ends with its invoice (the mock's choice, Q4); a
      // NEXT_PERIOD one keeps its plan id without a date, as develop does past
      // an unpaid boundary.
      const tenant = state.tenants.find((item) => item.id === invoice.tenantId);
      const change = tenant?.subscription.activeChange;
      if (tenant && change?.invoiceId === invoice.id) {
        const { activeChange: _change, scheduledEffectiveAt: _at, ...kept } = tenant.subscription;
        tenant.subscription = { ...kept, version: nextVersion(kept.version) };
      }
      changed = true;
    }
    if (this.evaluateWire(state, now, open)) changed = true;
    return changed;
  }

  /**
   * TAS-514, the admin's side of a bank transfer (the hooks' block comment):
   * statement lines recorded, then confirmed against an invoice, their
   * unallocated money returned, the returns moved on and their evidence
   * completed — each once per receipt. Answers whether anything changed.
   */
  private evaluateWire(state: ServerState, now: number, open: (tenant: StoredTenant, paidAt?: number) => void): boolean {
    const hooks = this.hooks();
    const iso = (ms: number) => new Date(ms).toISOString();
    let changed = false;
    for (const entry of Array.isArray(hooks.wireReceipts) ? hooks.wireReceipts : []) {
      if (typeof entry !== "object" || entry === null || typeof entry.id !== "string" || typeof entry.tenantId !== "string") continue;
      if (typeof entry.amountMinor !== "string" || !/^[1-9][0-9]{0,17}$/.test(entry.amountMinor)) continue;
      if (state.wireReceipts.some((item) => item.id === entry.id)) continue;
      const occurred = typeof entry.occurredAt === "string" && !Number.isNaN(Date.parse(entry.occurredAt)) ? Date.parse(entry.occurredAt) : now;
      state.wireReceipts.push({
        id: entry.id,
        tenantId: entry.tenantId,
        paymentId: uuid(),
        amount: money(entry.amountMinor),
        occurredAt: iso(occurred),
        precision: entry.precision === "DAY" ? "DAY" : "INSTANT",
        observedAt: iso(now),
        unallocated: money(entry.amountMinor),
      });
      changed = true;
    }
    const confirm = typeof hooks.confirmWire === "object" && hooks.confirmWire !== null ? hooks.confirmWire : {};
    for (const [receiptId, invoiceId] of Object.entries(confirm)) {
      const receipt = state.wireReceipts.find((item) => item.id === receiptId);
      if (!receipt || receipt.confirmedAt !== undefined || typeof invoiceId !== "string") continue;
      if (this.confirmReceipt(state, receipt, invoiceId, now, open)) changed = true;
    }
    for (const receiptId of Array.isArray(hooks.returnUnallocated) ? hooks.returnUnallocated : []) {
      const receipt = state.wireReceipts.find((item) => item.id === receiptId);
      if (!receipt || receipt.refundId !== undefined || receipt.outcome === undefined || !isPositive(receipt.unallocated)) continue;
      const invoice = state.invoices.find((item) => item.id === receipt.invoiceId);
      const reason = (() => {
        switch (receipt.outcome) {
          case "ALLOCATED":
            return "EXCESS";
          case "LATE_FIRST_PAYMENT":
          case "CLOSED_CREATION":
          case "DUPLICATE_PAYMENT":
            return receipt.outcome;
          case "LATE_PARTIAL":
            return "INCOMPLETE_BANK_PAYMENT";
          default:
            // Matched to an invoice still waiting for the rest: nothing goes back before it has expired (D246).
            return invoice?.state === "EXPIRED" ? "INCOMPLETE_BANK_PAYMENT" : null;
        }
      })();
      if (reason === null) continue;
      const refund: StoredRefund = {
        id: uuid(),
        tenantId: receipt.tenantId,
        receiptId: receipt.id,
        paymentId: receipt.paymentId,
        kind: "UNALLOCATED_RETURN",
        state: "REQUESTED",
        amount: { ...receipt.unallocated },
        requestedAt: iso(now),
        version: 1,
        reasonCode: reason,
        sourceMethod: "WIRE",
        feeBearer: "TASKA",
      };
      state.refunds.push(refund);
      receipt.refundId = refund.id;
      changed = true;
    }
    const progress = typeof hooks.refundProgress === "object" && hooks.refundProgress !== null ? hooks.refundProgress : {};
    for (const [receiptId, wanted] of Object.entries(progress)) {
      const receipt = state.wireReceipts.find((item) => item.id === receiptId);
      const refund = state.refunds.find((item) => item.id === receipt?.refundId);
      if (!receipt || !refund || refund.state === wanted || !REFUND_PROGRESS.has(wanted) || refund.state === "CONFIRMED" || refund.state === "REJECTED") continue;
      refund.state = wanted;
      refund.version += 1;
      if ((wanted === "APPROVED" || wanted === "REJECTED") && refund.decidedAt === undefined) refund.decidedAt = iso(now);
      if (wanted === "SUBMITTING" && refund.submittedAt === undefined && refund.evidenceCompletedAt !== undefined) refund.submittedAt = iso(now);
      if (wanted === "CONFIRMED") {
        // The money is back where it came from: the receipt holds none, and an invoice it was matched to lets it go.
        refund.confirmedAt = iso(now);
        receipt.unallocated = zeroOf(receipt.amount);
        const invoice = state.invoices.find((item) => item.id === receipt.invoiceId);
        if (invoice && receipt.outcome === "MATCHED" && isPositive(invoice.matchedUnallocated)) {
          invoice.matchedUnallocated = subtractMoney(invoice.matchedUnallocated, refund.amount);
          invoice.remaining = invoice.state === "PAID" ? zeroOf(invoice.total) : subtractMoney(invoice.total, invoice.matchedUnallocated);
          invoice.version += 1;
        }
      }
      changed = true;
    }
    for (const receiptId of Array.isArray(hooks.evidenceComplete) ? hooks.evidenceComplete : []) {
      const receipt = state.wireReceipts.find((item) => item.id === receiptId);
      const refund = state.refunds.find((item) => item.id === receipt?.refundId);
      if (!refund || refund.evidenceCompletedAt !== undefined || refund.sourceMethod !== "WIRE") continue;
      Object.assign(refund, wireSla(now));
      refund.version += 1;
      changed = true;
    }
    return changed;
  }

  /**
   * One receipt confirmed against one invoice (`confirmWire`) — the outcomes in
   * the hooks' block comment. `false`, and the receipt left unconfirmed, where
   * nothing would be visible: an invoice not here or not a wire one, a void
   * one, DAY precision on its due date, a late plan change (A88), a late
   * renewal of a company blocked or not active.
   */
  private confirmReceipt(
    state: ServerState,
    receipt: StoredWireReceipt,
    invoiceId: string,
    now: number,
    open: (tenant: StoredTenant, paidAt?: number) => void,
  ): boolean {
    const invoice = state.invoices.find((item) => item.id === invoiceId && item.tenantId === receipt.tenantId);
    const tenant = state.tenants.find((item) => item.id === receipt.tenantId);
    if (!invoice || !tenant || invoice.paymentMethod !== "WIRE" || invoice.total.currency !== receipt.amount.currency) return false;
    if (tenant.lifecycle === "DELETED" || tenant.lifecycle === "DELETING" || invoice.state === "VOID" || invoice.state === "DRAFT") return false;
    const due = Date.parse(invoice.dueAt);
    const occurred = Date.parse(receipt.occurredAt);
    const dayStart = Date.UTC(new Date(occurred).getUTCFullYear(), new Date(occurred).getUTCMonth(), new Date(occurred).getUTCDate());
    if (receipt.precision === "DAY" && due >= dayStart && due < dayStart + DAY) return false;
    const arrivedBy = receipt.precision === "DAY" ? dayStart + DAY <= due : occurred <= due;
    const done = (outcome: NonNullable<StoredWireReceipt["outcome"]>, unallocated: StoredMoney) => {
      receipt.invoiceId = invoice.id;
      receipt.confirmedAt = new Date(now).toISOString();
      receipt.outcome = outcome;
      receipt.unallocated = { ...unallocated };
      return true;
    };
    if (invoice.state === "PAID") return done("DUPLICATE_PAYMENT", receipt.amount);
    const matched = addMoney(invoice.matchedUnallocated, receipt.amount);
    const enough = BigInt(matched.amountMinor) >= BigInt(invoice.total.amountMinor);
    /** One allocation of the whole total: every receipt matched to it allocated, the excess left on this one. */
    const allocate = () => {
      for (const other of state.wireReceipts) {
        if (other.invoiceId === invoice.id && other.outcome === "MATCHED") {
          other.outcome = "ALLOCATED";
          other.unallocated = zeroOf(other.amount);
        }
      }
      return subtractMoney(matched, invoice.total);
    };
    if (invoice.purpose === "INITIAL") {
      const deadline = tenant.creationDeadline === undefined ? Number.POSITIVE_INFINITY : Date.parse(tenant.creationDeadline);
      if (tenant.lifecycle === "OWNER_CANCELLED") return done("CLOSED_CREATION", receipt.amount);
      const closed = tenant.lifecycle === "AUTO_CLOSED" || (tenant.lifecycle === "AWAITING_PAYMENT" && now >= deadline);
      if (closed) {
        // D216: paid in full by the earlier of its due date and the deadline — the company opens after all.
        if (!enough || occurred > Math.min(due, deadline)) return done("CLOSED_CREATION", receipt.amount);
        const excess = allocate();
        markPaid(invoice);
        open(tenant, now);
        return done("ALLOCATED", excess);
      }
      if (tenant.lifecycle === "AWAITING_PAYMENT" && !arrivedBy) {
        // Late while the creation is still open (D238): nothing activates, the invoice ends, a new one is
        // issued — due a week on, never after the deadline, which does not move — and the money goes back.
        if (PAYABLE_BY_WIRE.has(invoice.state)) {
          invoice.state = "EXPIRED";
          invoice.version += 1;
        }
        const another = state.invoices.some((item) => item.tenantId === tenant.id && item.purpose === "INITIAL" && PAYABLE_BY_WIRE.has(item.state));
        if (!another) {
          this.issueInvoice(state, tenant, "INITIAL", invoice.planVersionId, now, Math.min(now + WIRE_DUE_MS, deadline), { replacesInvoiceId: invoice.id, method: "WIRE" });
        }
        return done("LATE_FIRST_PAYMENT", receipt.amount);
      }
      // A first invoice of a company that has opened since: its money is a second payment.
      if (tenant.lifecycle !== "AWAITING_PAYMENT") return done("DUPLICATE_PAYMENT", receipt.amount);
    }
    if (!arrivedBy) {
      if (invoice.purpose !== "RENEWAL" || tenant.lifecycle !== "ACTIVE" || tenant.restrictions.includes("PLATFORM_BLOCK")) return false;
      // D247: a late renewal of a live company is paid by this money alone, with a new month from now.
      if (BigInt(receipt.amount.amountMinor) < BigInt(invoice.total.amountMinor)) return done("LATE_PARTIAL", receipt.amount);
      const excess = subtractMoney(receipt.amount, invoice.total);
      this.settle(state, invoice, now, open);
      return done("ALLOCATED", excess);
    }
    if (!enough) {
      // On time and short of the rest (D246): matched, not allocated; nothing is covered.
      invoice.matchedUnallocated = matched;
      invoice.remaining = subtractMoney(invoice.total, matched);
      if (PAYABLE_BY_WIRE.has(invoice.state)) invoice.state = "PARTIALLY_PAID";
      invoice.version += 1;
      return done("MATCHED", receipt.amount);
    }
    const excess = allocate();
    this.settle(state, invoice, now, open);
    return done("ALLOCATED", excess);
  }

  /** A settled invoice's effects (see `evaluatePayments`). */
  private settle(state: ServerState, invoice: StoredInvoice, at: number, open: (tenant: StoredTenant, paidAt?: number) => void): void {
    markPaid(invoice);
    const tenant = state.tenants.find((item) => item.id === invoice.tenantId);
    if (!tenant) return;
    if (invoice.purpose === "INITIAL") {
      // A timely first payment opens it; one confirmed after an automatic close
      // reopens only a company whose deadline it met (D216) — never a cancelled one.
      const timely = tenant.creationDeadline === undefined || at <= Date.parse(tenant.creationDeadline);
      if (tenant.lifecycle === "AWAITING_PAYMENT" || (tenant.lifecycle === "AUTO_CLOSED" && timely)) open(tenant, at);
      return;
    }
    const sub = tenant.subscription;
    if (invoice.purpose === "PLAN_CHANGE") {
      // F1 (`PlanCoveragePolicy.java:151-200`, `PaymentSettlement.java:293-337`).
      const change = sub.activeChange;
      // An older selection's invoice changes nothing (develop: PLAN_SELECTION_CHANGED; here they are VOID first).
      if (change === undefined || change.invoiceId !== invoice.id) return;
      if (change.effect === "NEXT_PERIOD") {
        // Paid before its boundary: the switch waits for it (`passBoundary`).
        tenant.subscription = { ...sub, version: nextVersion(sub.version), activeChange: { ...change, paidAt: new Date(at).toISOString() } };
        return;
      }
      // AFTER_PAYMENT: the plan now, with a new month from the payment; every coverage before it superseded.
      const { activeChange: _change, scheduledPlanVersionId: _plan, scheduledEffectiveAt: _at, renewalIssuedFor: _issued, ...kept } = sub;
      const end = new Date(at + PAID_PERIOD_MS);
      tenant.subscription = { ...kept, version: nextVersion(sub.version), paidThrough: end.toISOString(), anchorDay: end.getUTCDate() };
      this.switchPlan(state, tenant, change.planVersionId);
      setRestriction(tenant, "PAYMENT_EXPIRED", false);
      this.reconcileBreaches(state, tenant);
      return;
    }
    const through = sub.paidThrough === undefined ? Number.NaN : Date.parse(sub.paidThrough);
    const from = Number.isFinite(through) && through > at ? through : at;
    const end = new Date(from + PAID_PERIOD_MS);
    tenant.subscription = { ...sub, version: nextVersion(sub.version), paidThrough: end.toISOString(), anchorDay: end.getUTCDate() };
    tenant.entitlementVersion += 1;
    setRestriction(tenant, "PAYMENT_EXPIRED", false);
  }

  private save(state: ServerState): void {
    const now = this.now();
    // Spent and expired entries go, so the record does not grow without end.
    for (const [token, access] of Object.entries(state.access)) if (access.expiresAt < now - MINUTE) delete state.access[token];
    for (const [key, receipt] of Object.entries(state.receipts)) if (receipt.at < now - DAY) delete state.receipts[key];
    for (const [token, entry] of Object.entries(state.refresh)) {
      if (entry.spentAt !== undefined && entry.spentAt < now - DAY) delete state.refresh[token];
    }
    state.sessions = state.sessions.filter(
      (session) => session.expiresAt >= now - DAY && (session.revokedAt === undefined || session.revokedAt >= now - DAY),
    );
    try {
      this.storage.setItem(MOCK_SERVER_KEY, JSON.stringify(state));
    } catch {
      this.memory = state;
    }
  }

  private hooks(): MockTenantHooks {
    try {
      const raw = this.storage.getItem(MOCK_TENANT_HOOKS_KEY);
      const parsed: unknown = raw === null ? null : JSON.parse(raw);
      return typeof parsed === "object" && parsed !== null ? (parsed as MockTenantHooks) : {};
    } catch {
      return {};
    }
  }

  /** The lifecycle clock: the real one, moved by `clockOffsetMs`. Tokens and sessions never read it. */
  private lifecycleNow(): number {
    const offset = this.hooks().clockOffsetMs;
    return this.now() + (typeof offset === "number" && Number.isFinite(offset) ? offset : 0);
  }

  /** `refuseNext[operation]`, taken once: the refusal it describes, or `null`. */
  private takeRefusal(operation: string): MockProblemError | null {
    const hooks = this.hooks();
    const entry = hooks.refuseNext?.[operation];
    if (!entry || typeof entry.status !== "number" || typeof entry.code !== "string") return null;
    delete hooks.refuseNext?.[operation];
    this.writeHooks(hooks);
    const wait = typeof entry.retryAfterSeconds === "number" && entry.retryAfterSeconds > 0 ? entry.retryAfterSeconds : null;
    return problem(entry.status, entry.code, entry.title ?? "Refused by the mock's hook", entry.reasons ?? [], wait);
  }

  /** `loseAnswer` holds `operation`: taken once. */
  private takeLostAnswer(operation: string): boolean {
    const hooks = this.hooks();
    if (!Array.isArray(hooks.loseAnswer) || !hooks.loseAnswer.includes(operation)) return false;
    hooks.loseAnswer = hooks.loseAnswer.filter((item) => item !== operation);
    this.writeHooks(hooks);
    return true;
  }

  private writeHooks(hooks: MockTenantHooks): void {
    try {
      this.storage.setItem(MOCK_TENANT_HOOKS_KEY, JSON.stringify(hooks));
    } catch {
      // A storage that refuses keeps the hook as it was.
    }
  }

  private contentReadUnderRestriction(): boolean {
    const flag = this.hooks().contentReadUnderRestriction;
    return typeof flag === "boolean" ? flag : MOCK_PROJECT_CONTENT_READ_UNDER_RESTRICTION;
  }

  private accessTtlSeconds(): number {
    const ttl = this.hooks().accessTtlSeconds;
    return typeof ttl === "number" && Number.isFinite(ttl) && ttl > 0 ? ttl : DEFAULT_ACCESS_TTL_S;
  }

  private async delay(operation: string, base = this.latencyMs): Promise<void> {
    const extra = this.hooks().delayMs?.[operation];
    const ms = base + (typeof extra === "number" && extra > 0 ? extra : 0);
    if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
