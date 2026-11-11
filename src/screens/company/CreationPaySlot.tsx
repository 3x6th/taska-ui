import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { Invoice } from "../../api/billing";
import { apiErrorFacts } from "../../api/errors";
import { ErrorNote } from "../../components/ErrorNote";
import { PaymentStateBlock } from "./BillingParts";
import { BankTransferGroup, DownloadPdfButton } from "./WireParts";
import {
  cardWireLine,
  isWireOpen,
  lateFirstPaymentLine,
  listedRefunds,
  pastDue,
  purposeSentence,
  reconciliationSentences,
  showsBankDetails,
  wireState,
} from "./wireText";
import {
  INVOICES_READ_FAILED,
  NO_INVOICE_YET_TEXT,
  OPENING_PAYMENT_LABEL,
  OPENING_PAYMENT_STATUS,
  REOPEN_FAILED_TEXT,
  SECURE_PAGE_NOTE,
  expiredState,
  failedState,
  formatInvoiceMoney,
  inProgressState,
  invoiceTitle,
  isPayable,
  listedInvoices,
  notFoundState,
  payLabel,
  watchedPaymentState,
  type PaymentState,
} from "./billingText";
import {
  closeAttempt,
  companyDurationsOptions,
  companyInvoicesOptions,
  companyRefundsOptions,
  returnToPayment,
  unresolved,
  useCheckoutAttempts,
  useInvoiceDownload,
  usePassedAt,
  usePayInvoice,
  usePaymentWatch,
  useReadOnReturn,
  useRestoredFromCache,
} from "./companyBilling";

type Outcome = "failed" | "expired" | "not-found" | null;

/**
 * The never-opened card's payment slot (TAS-513, art-director B2b, DESIGN.md
 * §4.37) — its owner's, with the company's own session: the INITIAL invoice
 * the server issued with the company, «Invoice {number} · {amount}» and
 * «Pay {total}», the card's one accent, `returnTarget: CREATION`. While a
 * payment of it is unresolved, its state in the slot instead, read at the
 * watch's cadence. **The company opens only when the server says so**: an
 * invoice PAID asks the card to read the company again (`onPaid`) — the card
 * then polls it (release-reviewer N1) — and only its `lifecycle` ACTIVE hands
 * the address to the app shell. `stalled`: the card's poll gave up after
 * `POLL_LIMIT_MS`, so «Check again» (`onCheckAgain`) stands under the state.
 *
 * TAS-514 (art-director B14, decision 7, api-contract-guard F3): the open or
 * part-paid first invoice **of either method** — a bank-transfer one shows its
 * bank details in the card's form, «Download PDF» and the reconciliation note,
 * and no Pay; and the company's refunds are read (+1) for the line about money
 * that arrived after an earlier first invoice was due.
 */
export function CreationPaySlot({
  companyId,
  userId,
  company,
  creationDeadline,
  factId,
  onPaid,
  stalled = false,
  onCheckAgain,
}: {
  companyId: string;
  userId: string;
  company: string | null;
  creationDeadline: string | null;
  factId: string;
  onPaid: () => void;
  stalled?: boolean;
  onCheckAgain?: () => void;
}) {
  const invoices = useQuery(companyInvoicesOptions(companyId));
  const attempts = useCheckoutAttempts(userId, companyId);
  const listed = listedInvoices(invoices.data ?? []);
  // A payment out is watched from its record at once, not after the list (api-contract-guard F4); else the
  // open first payment — or one already PAID, settled before this card read it, the one the company opens on.
  const outstanding = [...attempts.values()].find((item) => unresolved(item)) ?? null;
  const listChoice =
    // The open or part-paid first invoice of either method (F3) — a wire one is never `isPayable`.
    listed.find((invoice) => invoice.purpose === "INITIAL" && (invoice.state === "OPEN" || invoice.state === "PARTIALLY_PAID")) ??
    listed.find((invoice) => invoice.purpose === "INITIAL" && isPayable(invoice)) ??
    listed.find(isPayable) ??
    listed.find((invoice) => invoice.purpose === "INITIAL" && invoice.state === "PAID") ??
    null;
  const invoiceId = outstanding?.invoiceId ?? listChoice?.id ?? null;
  const record = invoiceId !== null ? (attempts.get(invoiceId) ?? null) : null;
  // Read once (F4): without a watch the list row is the invoice; with one, the watch reads it.
  const watch = usePaymentWatch({ companyId, invoiceId, record, enabled: invoiceId !== null, readUnwatched: false });
  const listRow = invoiceId !== null ? (listed.find((invoice) => invoice.id === invoiceId) ?? null) : null;
  const invoice: Invoice | null = watch.invoiceQuery.data ?? listRow;
  const press = usePayInvoice({ companyId, userId, returnTarget: "CREATION", company, creationDeadline });
  const [outcome, setOutcome] = useState<Outcome>(null);
  // TAS-514: the refunds (+1, decision 7) and, for an open wire invoice, the durations (Q3).
  const refunds = useQuery(companyRefundsOptions(companyId));
  const wireOpen = invoice !== null && isWireOpen(invoice);
  const durations = useQuery({ ...companyDurationsOptions(companyId), enabled: wireOpen });
  const download = useInvoiceDownload(companyId, company);
  // Never polled (B3): read again on return to the tab and once when the clock passes its due date.
  useReadOnReturn(wireOpen && !unresolved(record), () => void invoices.refetch());
  usePassedAt(wireOpen ? (invoice?.dueAt ?? null) : null, () => void invoices.refetch());
  const [returning, setReturning] = useState(false);
  /** «Return to payment»'s read refused (F2): said under the block, with its id; remounted per press. */
  const [reopenFailure, setReopenFailure] = useState<{ error: unknown; key: number } | null>(null);
  useRestoredFromCache(() => setReturning(false));
  const returnButton = useRef<HTMLButtonElement>(null);

  // Back from the provider loaded the card afresh: the attempt reads as left (N3), focus on «Return to payment».
  const { checkBackOnLoad } = press;
  useEffect(() => {
    checkBackOnLoad(record);
  }, [record, checkBackOnLoad]);
  const returnFocusHandled = useRef(0);
  useEffect(() => {
    if (press.returnFocusRequest <= returnFocusHandled.current || returnButton.current === null) return;
    if (invoiceId === null || press.returnFocusInvoice !== invoiceId) return;
    returnFocusHandled.current = press.returnFocusRequest;
    returnButton.current.focus();
  });

  const invoiceState = invoice?.state ?? null;
  const checkoutState = watch.checkout?.state ?? null;
  useEffect(() => {
    if (invoiceId === null) return;
    if (invoiceState === "PAID") {
      if (record !== null) closeAttempt(userId, companyId, invoiceId, record.key);
      onPaid();
      return;
    }
    if (record !== null && (invoiceState === "EXPIRED" || invoiceState === "VOID")) {
      closeAttempt(userId, companyId, invoiceId, record.key);
      return;
    }
    if (!unresolved(record)) return;
    const close = (next: Outcome) => {
      setOutcome(next);
      closeAttempt(userId, companyId, invoiceId, record.key);
    };
    if (checkoutState === "FAILED") close("failed");
    else if (checkoutState === "EXPIRED") close("expired");
    else if (watch.lost) close("not-found");
    // The company is the card's to follow; this only reports the invoice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record, invoiceState, checkoutState, watch.lost, invoiceId]);

  const watching = unresolved(record);
  if (invoices.isPending && !watching) return null;
  if (invoices.isError && invoices.data === undefined && !watching) {
    return (
      <div className="company-setup-slot">
        <ErrorNote key={invoices.errorUpdatedAt} requestId={apiErrorFacts(invoices.error).requestId}>
          {INVOICES_READ_FAILED}
        </ErrorNote>
        <button
          aria-disabled={invoices.isFetching || undefined}
          className="secondary-button compact-button company-plan-retry"
          onClick={() => {
            if (!invoices.isFetching) void invoices.refetch();
          }}
          type="button"
        >
          Try again
        </button>
      </div>
    );
  }

  let state: PaymentState | null = null;
  if (unresolved(record)) {
    // Paid is the company opening, never a line here (B7's CREATION row): «Confirming» until it does.
    const paidYet = invoice?.state === "PAID" ? { ...invoice, state: "OPEN" } : invoice;
    state = watchedPaymentState({ invoice: paidYet, checkout: watch.checkout, left: record.leftAt !== undefined, stage: watch.stage, company, reopened: false });
  } else if (invoice?.state === "PAID") {
    // Settled; the company has not opened yet: «Confirming» while the card polls it, «Check again» once it gave up (N1).
    state = watchedPaymentState({
      invoice: { ...invoice, state: "OPEN" },
      checkout: null,
      left: false,
      stage: stalled ? "stopped" : "fresh",
      company,
      reopened: false,
    });
  } else if (outcome === "failed") state = failedState();
  else if (outcome === "expired") state = expiredState();
  else if (outcome === "not-found") state = notFoundState(company);
  else if (invoiceId !== null && press.inProgress === invoiceId) state = inProgressState(null);

  // Money that arrived after an earlier first invoice was due (decision 7): one line each, above the slot.
  const lateLines = listedRefunds(refunds.data ?? [])
    .filter((refund) => refund.reasonCode === "LATE_FIRST_PAYMENT")
    .map((refund) => ({ id: refund.id, text: lateFirstPaymentLine(refund) }))
    .filter((line): line is { id: string; text: string } => line.text !== null);
  const refundLines =
    lateLines.length > 0 ? (
      <>
        {lateLines.map((line) => (
          <p className="company-setup-refund" key={line.id}>
            {line.text}
          </p>
        ))}
      </>
    ) : null;

  if (invoice === null && !watching) {
    return refundLines === null ? (
      <p className="company-setup-pay">{NO_INVOICE_YET_TEXT}</p>
    ) : (
      <div className="company-setup-slot">
        {refundLines}
        <p className="company-setup-pay">{NO_INVOICE_YET_TEXT}</p>
      </div>
    );
  }

  // TAS-514 (B14): a first payment by bank transfer — its card form, no Pay.
  if (invoice !== null && invoice.paymentMethod === "WIRE" && !watching) {
    const sentence3 = purposeSentence({ invoice, company, restrictions: [], lifecycle: "AWAITING_PAYMENT", creationDeadline });
    const wire = wireState(invoice, { sentence3 });
    const bank = showsBankDetails(invoice) && invoice.wireInstructions !== null ? invoice.wireInstructions : null;
    const [sentence1, sentence2] = reconciliationSentences(durations.data?.wireReconciliationTargetSeconds ?? null);
    const downloadRefusal = download.refusal?.invoiceId === invoice.id ? download.refusal : null;
    const downloadRow = (
      <>
        <DownloadPdfButton className="company-setup-download" invoice={invoice} press={download} />
        <span className="visually-hidden" role="status">
          {download.status !== null ? <span key={download.status.seq}>{download.status.text}</span> : null}
        </span>
        {downloadRefusal !== null ? (
          <ErrorNote key={downloadRefusal.key} live="alert" requestId={downloadRefusal.requestId} serverWords={downloadRefusal.words}>
            {downloadRefusal.text}
          </ErrorNote>
        ) : null}
      </>
    );
    return (
      <div className="company-setup-slot">
        {refundLines}
        <p className="company-setup-pay">{cardWireLine(invoice)}</p>
        <PaymentStateBlock factId={factId} state={wire} />
        {bank !== null ? (
          <BankTransferGroup
            after={downloadRow}
            card
            details={bank}
            invoice={invoice}
            note={
              <>
                {durations.isPending ? <span aria-hidden="true" className="value-skeleton company-bank-note-skeleton" /> : <p>{sentence1}</p>}
                <p>{sentence2}</p>
                {sentence3 !== null && !pastDue(invoice) ? <p>{sentence3}</p> : null}
              </>
            }
          />
        ) : (
          downloadRow
        )}
      </div>
    );
  }

  const offerPay =
    invoice !== null &&
    isPayable(invoice) &&
    !unresolved(record) &&
    press.inProgress !== invoice.id &&
    outcome !== "not-found" &&
    (state === null || state.action === "pay");
  const inFlight = invoice !== null && press.pending === invoice.id;
  const refusal = invoice !== null && press.refusal?.invoiceId === invoice.id ? press.refusal : null;
  // «Return to payment» only when the last read of the checkout carried its page (F2).
  const offerReturn = state?.action === "return" && unresolved(record) && watch.checkout?.redirect != null;
  const offerCheck = state?.action === "check" || state?.alsoCheck === true;

  return (
    <div className="company-setup-slot">
      {refundLines}
      <PaymentStateBlock factId={factId} state={state} />
      {offerPay ? (
        <>
          <p className="company-setup-pay">
            {invoiceTitle(invoice)}
            {invoice.total ? ` · ${formatInvoiceMoney(invoice.total)}` : ""}
          </p>
          <button
            aria-disabled={inFlight || undefined}
            className="primary-button auth-submit company-setup-pay-button"
            onClick={(event) => void press.pay(invoice, event.currentTarget)}
            type="button"
          >
            {inFlight ? OPENING_PAYMENT_LABEL : payLabel(invoice)}
          </button>
          <p className="company-setup-pay-note">{SECURE_PAGE_NOTE}</p>
        </>
      ) : null}
      {offerReturn || offerCheck ? (
        // «Check again» after «Return to payment», in that order (N9).
        <div className="company-setup-actions">
          {offerReturn && unresolved(record) ? (
            <button
              aria-disabled={returning || undefined}
              className="secondary-button compact-button company-setup-again"
              onClick={(event) => {
                if (returning) return;
                const sent = record;
                setReturning(true);
                setReopenFailure(null);
                press.noteLeaving(sent.invoiceId, event.currentTarget);
                void returnToPayment(companyId, sent.checkoutId, sent.invoiceId).then(
                  (found) => {
                    if (found === "went") return;
                    setReturning(false);
                    if (found === "lost") {
                      // Not this invoice's checkout (F5): the watch's not-found path.
                      setOutcome("not-found");
                      closeAttempt(userId, companyId, sent.invoiceId, sent.key);
                      return;
                    }
                    void watch.checkoutQuery.refetch();
                  },
                  (error: unknown) => {
                    setReturning(false);
                    setReopenFailure((previous) => ({ error, key: (previous?.key ?? 0) + 1 }));
                  },
                );
              }}
              ref={returnButton}
              type="button"
            >
              Return to payment
            </button>
          ) : null}
          {offerCheck ? (
            <button
              className="secondary-button compact-button company-setup-again"
              onClick={() => (unresolved(record) ? watch.checkAgain() : onCheckAgain?.())}
              type="button"
            >
              Check again
            </button>
          ) : null}
        </div>
      ) : null}
      {reopenFailure !== null ? (
        <ErrorNote key={reopenFailure.key} live="alert" requestId={apiErrorFacts(reopenFailure.error).requestId}>
          {REOPEN_FAILED_TEXT}
        </ErrorNote>
      ) : null}
      {inFlight ? (
        <span className="visually-hidden" role="status">
          {OPENING_PAYMENT_STATUS}
        </span>
      ) : null}
      {refusal ? (
        <ErrorNote key={refusal.key} live="alert" requestId={refusal.requestId} serverWords={refusal.words.words}>
          {refusal.words.text}
        </ErrorNote>
      ) : null}
    </div>
  );
}
