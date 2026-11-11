import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { taskaApi } from "../../api/client";
import { apiErrorFacts } from "../../api/errors";
import { ErrorNote } from "../../components/ErrorNote";
import { useAccountQueryClient, useCompanyAddress } from "../../lib/companyAddress";
import { plansQueryOptions } from "../../lib/plans";
import { formatPaidUntil } from "./companyGeneralText";
import { companyEntitlementOptions } from "./companyPlan";
import { nowOnText, planChangeInvoiceText } from "./companyPlanChangeText";
import { planById, planNameParts } from "./companyPlanText";
import { PaymentStateBlock } from "./BillingParts";
import { BankTransferGroup, DownloadPdfButton, InvoiceItems, InvoiceSnapshot } from "./WireParts";
import {
  isWireOpen,
  pastDue,
  purposeSentence,
  receivedNote,
  receivedOf,
  reconciliationSentences,
  showsBankDetails,
  toBeRefundedText,
  wireState,
} from "./wireText";
import {
  INVOICE_READ_FAILED,
  NO_LONGER_PAYABLE_TEXT,
  OPENING_PAYMENT_LABEL,
  OPENING_PAYMENT_STATUS,
  REOPEN_FAILED_TEXT,
  billingOwnerOnlyText,
  expiredState,
  failedState,
  formatInvoiceMoney,
  inProgressState,
  invoiceTitle,
  isPayable,
  isZeroMoney,
  methodText,
  notFoundState,
  paidState,
  payLabel,
  purposeText,
  replacedByText,
  replacementOf,
  statusFollowsBlock,
  statusWord,
  watchedPaymentState,
  type PaymentState,
} from "./billingText";
import {
  closeAttempt,
  companyDurationsOptions,
  companyInvoiceKey,
  companyInvoicesOptions,
  returnToPayment,
  unresolved,
  useCheckoutAttempts,
  useInvoiceDownload,
  usePassedAt,
  usePayInvoice,
  usePaymentWatch,
  useReadOnReturn,
  useRereadAfterPaid,
  useBillingReader,
  useRestoredFromCache,
} from "./companyBilling";
import { useCompanyZoneOutlet, zoneHeading } from "./companyZone";
import type { CheckoutReturnState } from "../billingReturn";


/**
 * Company › Billing › Invoice (TAS-513, art-director B5–B8, B11) — its owner
 * only. The payment's state, Pay, then the facts. Where a return from the
 * payment page lands (BILLING), routed by the attempt record — the return
 * address itself says nothing.
 *
 * **Paid only from `Invoice.state = PAID`**: while an attempt is unresolved the
 * invoice and its checkout are read together at the setup card's cadence
 * (`usePaymentWatch`); a `SUCCEEDED` before PAID reads «Confirming». The
 * record closes on PAID, EXPIRED or VOID, a FAILED or EXPIRED checkout, and
 * a checkout this company does not have — which is said, and switches,
 * redirects and offers nothing.
 *
 * TAS-515 (art-director B12, decision 8): an open PLAN_CHANGE invoice says
 * which plan paying it moves the company to, and «Paid.» adds that it is on
 * it only once the entitlement read after the settlement names that plan —
 * the one read this page adds, for a PLAN_CHANGE invoice only.
 *
 * TAS-514 (art-director B1–B10, the orchestrator's decisions 2–5): the page in
 * order — the state, the action row (Pay · «Download PDF»), «Bank transfer»
 * for an open wire invoice, the facts with «Received», «Items», and «Billing
 * details» as issued. A wire invoice is read on arrival, on every return to
 * the tab and once when the local clock passes its due date — never polled —
 * and the company's capabilities are read beside it for the reconciliation
 * target. What the clock decides is wording only.
 */
export function CompanyInvoiceSection() {
  const address = useCompanyAddress();
  const { invoiceId } = useParams();
  if (address?.companyId == null || invoiceId === undefined) return null;
  return <CompanyInvoice companyId={address.companyId} invoiceId={invoiceId} key={invoiceId} />;
}

type Outcome = "paid" | "failed" | "expired" | "not-found" | null;

function CompanyInvoice({ companyId, invoiceId }: { companyId: string; invoiceId: string }) {
  const reader = useBillingReader(companyId);
  const location = useLocation();
  const navigate = useNavigate();
  const outlet = useCompanyZoneOutlet();
  const accountClient = useAccountQueryClient();
  const factId = useId();
  const [returned] = useState(() => (location.state as CheckoutReturnState | null)?.checkoutReturn === true);
  const attempts = useCheckoutAttempts(reader.meId, companyId);
  const record = attempts.get(invoiceId) ?? null;
  const watch = usePaymentWatch({ companyId, invoiceId, record, enabled: reader.owner });
  const invoiceQuery = watch.invoiceQuery;
  const invoice = invoiceQuery.data ?? null;
  // The list only to name the invoice that replaced this one (api-contract-guard F3).
  const endedUnpaid = invoice?.state === "EXPIRED" || invoice?.state === "VOID";
  const list = useQuery({ ...companyInvoicesOptions(companyId), enabled: reader.owner && endedUnpaid });
  const plans = useQuery(plansQueryOptions(taskaApi), accountClient ?? undefined);
  const press = usePayInvoice({ companyId, userId: reader.meId, returnTarget: "BILLING", company: reader.company });
  const rereadAfterPaid = useRereadAfterPaid();
  const [outcome, setOutcome] = useState<Outcome>(null);
  /** A wire invoice read open this visit and then PAID: «Paid.» says so (B3), and the company is read again once. */
  const [wireSettled, setWireSettled] = useState(false);
  const wireSeenOpen = useRef(false);
  const queryClient = useQueryClient();
  const download = useInvoiceDownload(companyId, reader.company);
  /** The action row's one refusal slot (B10): the newer of Pay's, «Return to payment»'s and Download's. */
  const [lastRefusal, setLastRefusal] = useState<"pay" | "reopen" | "download" | null>(null);
  /** When this visit saw the payment settle: «is now on» needs an entitlement read after it. */
  const [paidAt, setPaidAt] = useState<number | null>(null);
  const [hadExpired, setHadExpired] = useState(false);
  const payButton = useRef<HTMLButtonElement>(null);
  const returnButton = useRef<HTMLButtonElement>(null);
  const [returning, setReturning] = useState(false);
  /** «Return to payment»'s read refused (F2): said under the block, with its id; remounted per press. */
  const [reopenFailure, setReopenFailure] = useState<{ error: unknown; key: number } | null>(null);
  useRestoredFromCache(() => setReturning(false));

  // Back from the provider loaded this page afresh: the attempt reads as left (N3).
  const { checkBackOnLoad } = press;
  useEffect(() => {
    if (reader.owner) checkBackOnLoad(record);
  }, [reader.owner, record, checkBackOnLoad]);
  // …and focus goes on «Return to payment» once it is drawn (N3).
  const returnFocusHandled = useRef(0);
  useEffect(() => {
    if (press.returnFocusRequest <= returnFocusHandled.current || press.returnFocusInvoice !== invoiceId || returnButton.current === null) return;
    returnFocusHandled.current = press.returnFocusRequest;
    returnButton.current.focus();
  });

  // The company's PAYMENT_EXPIRED while the payment is out — or, TAS-514, while a wire invoice is open:
  // «open for changes again» is said only when the re-read lost it.
  const expiredNow = reader.tenant?.restrictions.includes("PAYMENT_EXPIRED") ?? false;
  const awaitingWire = invoice !== null && isWireOpen(invoice);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- latched from the company's answer while a payment is out.
    if ((unresolved(record) || awaitingWire) && expiredNow) setHadExpired(true);
  }, [record, awaitingWire, expiredNow]);
  const reopened = hadExpired && reader.tenant !== null && !expiredNow;

  // The record closes on the server's word (api-contract-guard §2) — and what it said stays on screen.
  const invoiceState = invoice?.state ?? null;
  const checkoutState = watch.checkout?.state ?? null;
  useEffect(() => {
    if (record === null || reader.meId === null) return;
    const close = (next: Outcome) => {
      setOutcome(next);
      if (next === "paid") setPaidAt(Date.now());
      closeAttempt(record.userId, companyId, invoiceId, record.key);
    };
    // An ended invoice closes any record of it — one whose answer never came too (B1).
    if (invoiceState === "PAID") {
      close(unresolved(record) ? "paid" : null);
      if (unresolved(record)) rereadAfterPaid(companyId);
      return;
    }
    if (invoiceState === "EXPIRED" || invoiceState === "VOID") {
      close(null);
      return;
    }
    if (!unresolved(record)) return;
    if (checkoutState === "FAILED") close("failed");
    else if (checkoutState === "EXPIRED") close("expired");
    else if (watch.lost) close("not-found");
  }, [record, reader.meId, invoiceState, checkoutState, watch.lost, companyId, invoiceId, rereadAfterPaid]);

  // TAS-514: a wire invoice is never polled (B3) — read on return to the tab and once at its due date.
  const wireOpen = awaitingWire;
  const rereadInvoice = () => void queryClient.invalidateQueries({ queryKey: companyInvoiceKey(invoiceId) });
  useReadOnReturn(reader.owner && wireOpen, rereadInvoice);
  usePassedAt(wireOpen ? (invoice?.dueAt ?? null) : null, rereadInvoice);
  const durations = useQuery({ ...companyDurationsOptions(companyId), enabled: reader.owner && wireOpen });
  useEffect(() => {
    if (invoice === null || invoice.paymentMethod !== "WIRE") return;
    if (isWireOpen(invoice)) wireSeenOpen.current = true;
    else if (invoice.state === "PAID" && wireSeenOpen.current && !wireSettled) {
      setWireSettled(true);
      setPaidAt(Date.now());
      rereadAfterPaid(companyId);
    }
  }, [invoice, wireSettled, companyId, rereadAfterPaid]);
  // The newest refusal takes the slot (B10).
  const payRefusalKey = press.refusal?.invoiceId === invoiceId ? press.refusal.key : null;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- follows the press's own refusal.
    if (payRefusalKey !== null) setLastRefusal("pay");
  }, [payRefusalKey]);
  const downloadRefusalKey = download.refusal?.invoiceId === invoiceId ? download.refusal.key : null;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- follows the press's own refusal.
    if (downloadRefusalKey !== null) setLastRefusal("download");
  }, [downloadRefusalKey]);

  // The heading: «Company › Billing › Invoice {number}» (B5).
  const title = reader.owner && invoice !== null ? invoiceTitle(invoice) : null;
  useEffect(() => {
    outlet?.setHeadingItem(title);
    return () => outlet?.setHeadingItem(null);
  }, [outlet, title]);

  // Back from the payment page (a full load): focus on the heading, described by the state's fact (B11).
  useLayoutEffect(() => {
    if (!returned) return;
    outlet?.setHeadingDescribedBy(factId);
    zoneHeading()?.focus();
    navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: null });
    return () => outlet?.setHeadingDescribedBy(null);
    // Once, on the landing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returned]);

  // Landed from the payment page: «Confirming the payment» from the first frame, no Pay (B6).
  // TAS-515: a plan change's invoice reads the plan the company is on — and the one it is on once paid.
  const planChange = invoice?.purpose === "PLAN_CHANGE";
  const entitlement = useQuery({ ...companyEntitlementOptions(companyId), enabled: reader.owner && planChange });
  const invoicePlan = plans.data && invoice ? planById(plans.data, invoice.planVersionId) : null;
  const currentPlan = plans.data && entitlement.data ? planById(plans.data, entitlement.data.planVersionId) : null;
  const nowOn =
    planChange && invoicePlan !== null && paidAt !== null && entitlement.data !== undefined && entitlement.dataUpdatedAt >= paidAt &&
    entitlement.data.planVersionId === invoice?.planVersionId
      ? nowOnText(reader.company, invoicePlan)
      : null;

  if (!reader.known) {
    const landing = returned ? watchedPaymentState({ invoice: null, checkout: null, left: false, stage: "fresh", company: reader.company, reopened: false }) : null;
    return <InvoiceLoading state={landing} factId={factId} />;
  }
  if (!reader.owner) {
    return (
      <div className="settings-plane">
        <div className="settings-column company-billing">
          <p className="settings-lead">{billingOwnerOnlyText(reader.company)}</p>
        </div>
      </div>
    );
  }

  let state: PaymentState | null = null;
  if (unresolved(record)) {
    state = watchedPaymentState({ invoice, checkout: watch.checkout, left: record.leftAt !== undefined, stage: watch.stage, company: reader.company, reopened, nowOn });
  } else if (outcome === "paid" && invoice?.state === "PAID") state = paidState(invoice, reader.company, reopened, nowOn);
  else if (outcome === "failed" && invoice !== null && isPayable(invoice)) state = failedState();
  else if (outcome === "expired" && invoice !== null && isPayable(invoice)) state = expiredState();
  else if (outcome === "not-found") state = notFoundState(reader.company);
  else if (press.inProgress === invoiceId) state = inProgressState(null);
  else if (wireSettled && invoice?.state === "PAID") state = paidState(invoice, reader.company, reopened, nowOn);

  if (invoice === null) {
    if (invoiceQuery.isError) {
      return (
        <div className="settings-plane">
          <div className="settings-column company-billing company-invoice">
            <PaymentStateBlock factId={factId} state={state} />
            <div className="company-plan-failure company-billing-failure">
              <ErrorNote key={invoiceQuery.errorUpdatedAt} requestId={apiErrorFacts(invoiceQuery.error).requestId}>
                {INVOICE_READ_FAILED}
              </ErrorNote>
              <button
                aria-disabled={invoiceQuery.isFetching || undefined}
                className="secondary-button compact-button company-plan-retry"
                onClick={() => {
                  if (!invoiceQuery.isFetching) void invoiceQuery.refetch();
                }}
                type="button"
              >
                Try again
              </button>
            </div>
          </div>
        </div>
      );
    }
    return <InvoiceLoading state={state} factId={factId} />;
  }

  // TAS-514: a wire invoice's own state (B3) — from the invoice, the clock for its wording only.
  const sentence3 = purposeSentence({
    invoice,
    company: reader.company,
    restrictions: reader.tenant?.restrictions ?? [],
    lifecycle: reader.tenant?.lifecycle ?? null,
    creationDeadline: reader.tenant?.creationDeadline ?? null,
  });
  const late = pastDue(invoice);
  if (state === null) state = wireState(invoice, { sentence3 });
  const received = receivedOf(invoice);

  const offerPay =
    isPayable(invoice) && !unresolved(record) && press.inProgress !== invoiceId && outcome !== "not-found" && (state === null || state.action === "pay");
  const inFlight = press.pending === invoiceId;
  const refusal = press.refusal?.invoiceId === invoiceId ? press.refusal : null;
  const noLonger = invoice.state === "EXPIRED" || invoice.state === "VOID";
  const replacement = noLonger ? replacementOf(invoice, list.data ?? []) : null;
  const plan = invoicePlan;
  const moves =
    planChange && (invoice.state === "OPEN" || invoice.state === "PARTIALLY_PAID") ? planChangeInvoiceText(reader.company, invoicePlan, currentPlan) : null;

  let action: ReactNode = null;
  if (offerPay) {
    action = (
      <button
        aria-disabled={inFlight || undefined}
        className="primary-button company-invoice-pay"
        onClick={(event) => void press.pay(invoice, event.currentTarget)}
        ref={payButton}
        type="button"
      >
        {inFlight ? OPENING_PAYMENT_LABEL : payLabel(invoice)}
      </button>
    );
  } else {
    // «Return to payment» only when the last read of the checkout carried its page (F2); «Check again»
    // after it once the reads have stopped on an open one, or alone (art-director N9).
    const reopen =
      state?.action === "return" && unresolved(record) && watch.checkout?.redirect != null ? (
        <button
          aria-disabled={returning || undefined}
          className="secondary-button compact-button company-invoice-again"
          key="return"
          onClick={(event) => {
            if (returning || !unresolved(record)) return;
            const sent = record;
            setReturning(true);
            setReopenFailure(null);
            press.noteLeaving(invoiceId, event.currentTarget);
            void returnToPayment(companyId, sent.checkoutId, invoiceId).then(
              (found) => {
                if (found === "went") return;
                setReturning(false);
                if (found === "lost") {
                  // Not this invoice's checkout (F5): the watch's not-found path.
                  setOutcome("not-found");
                  closeAttempt(sent.userId, companyId, invoiceId, sent.key);
                  return;
                }
                void watch.checkoutQuery.refetch();
              },
              (error: unknown) => {
                setReturning(false);
                setReopenFailure((previous) => ({ error, key: (previous?.key ?? 0) + 1 }));
                setLastRefusal("reopen");
              },
            );
          }}
          ref={returnButton}
          type="button"
        >
          Return to payment
        </button>
      ) : null;
    const check =
      state?.action === "check" || state?.alsoCheck === true ? (
        <button className="secondary-button compact-button company-invoice-again" key="check" onClick={watch.checkAgain} type="button">
          Check again
        </button>
      ) : null;
    if (reopen !== null || check !== null) {
      action = (
        <>
          {reopen}
          {check}
        </>
      );
    }
  }

  // «Download PDF» on every listed invoice (B10): the refusal says what there is.
  const offerDownload = invoice.state !== "DRAFT";
  const shown = lastRefusal ?? (refusal ? "pay" : reopenFailure !== null ? "reopen" : download.refusal?.invoiceId === invoiceId ? "download" : null);
  const downloadRefusal = download.refusal?.invoiceId === invoiceId ? download.refusal : null;
  const bank = showsBankDetails(invoice) && invoice.wireInstructions !== null ? invoice.wireInstructions : null;
  const [sentence1, sentence2] = reconciliationSentences(durations.data?.wireReconciliationTargetSeconds ?? null);
  // Sentence 3 is said by the state block once the due date has passed (B3's third row) — once on the page.
  const note = (
    <>
      {durations.isPending ? <span aria-hidden="true" className="value-skeleton company-bank-note-skeleton" /> : <p>{sentence1}</p>}
      <p>{sentence2}</p>
      {sentence3 !== null && !late ? <p>{sentence3}</p> : null}
    </>
  );

  return (
    <div className="settings-plane">
      <div className="settings-column company-billing company-invoice">
        {moves !== null ? <p className="company-invoice-plan-change">{moves}</p> : null}
        <PaymentStateBlock factId={factId} state={state} />
        {noLonger ? (
          <p className="company-general-state company-invoice-closed">
            <span className="company-general-state-fact">{NO_LONGER_PAYABLE_TEXT}</span>
            {replacement !== null ? (
              <>
                {" "}
                {replacedByText}{" "}
                <Link
                  className="admin-note-link company-invoice-replacement"
                  state={{ focusHeading: true }}
                  to={`/company/billing/${encodeURIComponent(replacement.id)}`}
                >
                  {replacement.number ?? "Invoice"}
                </Link>
                .
              </>
            ) : null}
            {/* TAS-514 (Q4): the money that arrived for an expired invoice goes back — never tied to a refund row. */}
            {invoice.state === "EXPIRED" && received !== null ? <> {toBeRefundedText(received)}</> : null}
          </p>
        ) : null}
        {action !== null || offerDownload ? (
          <div className="company-invoice-actions">
            {action}
            {offerDownload ? <DownloadPdfButton invoice={invoice} press={download} /> : null}
          </div>
        ) : null}
        {inFlight ? (
          <span className="visually-hidden" role="status">
            {OPENING_PAYMENT_STATUS}
          </span>
        ) : null}
        {/* The download's progress, one persistent region (B10): «Downloading…», then «…downloaded.». */}
        <span className="visually-hidden" role="status">
          {download.status !== null ? <span key={download.status.seq}>{download.status.text}</span> : null}
        </span>
        {shown === "reopen" && reopenFailure !== null ? (
          <div className="company-invoice-refusal">
            <ErrorNote key={reopenFailure.key} live="alert" requestId={apiErrorFacts(reopenFailure.error).requestId}>
              {REOPEN_FAILED_TEXT}
            </ErrorNote>
          </div>
        ) : null}
        {shown === "pay" && refusal ? (
          <div className="company-invoice-refusal">
            <ErrorNote key={refusal.key} live="alert" requestId={refusal.requestId} serverWords={refusal.words.words}>
              {refusal.words.text}
            </ErrorNote>
          </div>
        ) : null}
        {shown === "download" && downloadRefusal !== null ? (
          <div className="company-invoice-refusal">
            <ErrorNote key={downloadRefusal.key} live="alert" requestId={downloadRefusal.requestId} serverWords={downloadRefusal.words}>
              {downloadRefusal.text}
            </ErrorNote>
          </div>
        ) : null}
        {bank !== null ? <BankTransferGroup details={bank} invoice={invoice} note={note} /> : null}
        <dl className="settings-details company-invoice-facts">
          {/* «Confirming» only while the block says so (art-director blocker 3): a left one shows the invoice's word. */}
          <Fact label="Status">{capitalised(statusWord(invoice.state, unresolved(record) && statusFollowsBlock(state)))}</Fact>
          {invoice.total ? <Fact label="Amount">{formatInvoiceMoney(invoice.total)}</Fact> : null}
          {/* TAS-514 (F2, B7): bank money matched to it and not applied — its own fact, never «Paid so far». */}
          {received !== null && invoice.state !== "PAID" ? (
            <Fact label="Received">
              <span className="company-invoice-received">{formatInvoiceMoney(received)}</span>
              {isWireOpen(invoice) && invoice.total ? <span className="company-invoice-fact-note">{receivedNote(invoice.total)}</span> : null}
            </Fact>
          ) : null}
          {/* Part of it paid only (NB1): a paid invoice has neither line. */}
          {invoice.allocated && !isZeroMoney(invoice.allocated) && invoice.state !== "PAID" ? (
            <Fact label="Paid so far">{formatInvoiceMoney(invoice.allocated)}</Fact>
          ) : null}
          {invoice.remaining && invoice.total && !isZeroMoney(invoice.remaining) && invoice.remaining.amountMinor !== invoice.total.amountMinor ? (
            <Fact label="Left to pay">{formatInvoiceMoney(invoice.remaining)}</Fact>
          ) : null}
          {purposeText(invoice.purpose) ? <Fact label="For">{purposeText(invoice.purpose)}</Fact> : null}
          {plan !== null ? (
            <Fact label="Plan">
              {planNameParts(plan).name}
              {planNameParts(plan).version ? <span className="company-plan-quiet">{planNameParts(plan).version}</span> : null}
            </Fact>
          ) : null}
          {invoice.issuedAt ? (
            <Fact label="Issued">
              <time dateTime={invoice.issuedAt}>{formatPaidUntil(invoice.issuedAt)}</time>
            </Fact>
          ) : null}
          {invoice.dueAt ? (
            <Fact label="Due">
              <time dateTime={invoice.dueAt}>{formatPaidUntil(invoice.dueAt)}</time>
            </Fact>
          ) : null}
          {methodText(invoice.paymentMethod) ? <Fact label="Payment">{methodText(invoice.paymentMethod)}</Fact> : null}
        </dl>
        <InvoiceItems invoice={invoice} />
        <InvoiceSnapshot invoice={invoice} />
      </div>
    </div>
  );
}

const capitalised = (word: string | null) => (word === null ? null : `${word.charAt(0).toUpperCase()}${word.slice(1)}`);

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** Before the invoice answers: the state when there is one to say (an unresolved payment), no Pay, the facts as bars (B6). */
function InvoiceLoading({ state, factId }: { state: PaymentState | null; factId: string }) {
  return (
    <div className="settings-plane">
      <div aria-busy="true" className="settings-column company-billing company-invoice company-invoice-loading">
        <PaymentStateBlock factId={factId} state={state} />
        {state === null ? (
          <span className="visually-hidden" role="status">
            Loading invoice
          </span>
        ) : null}
        <div aria-hidden="true" className="settings-details company-invoice-facts">
          {[0, 1, 2, 3, 4].map((index) => (
            <div key={index}>
              <span className="value-skeleton company-general-skeleton-label" />
              <span className="value-skeleton company-general-skeleton-value" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
