import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { Invoice } from "../../api/billing";
import { apiErrorFacts } from "../../api/errors";
import { ErrorNote } from "../../components/ErrorNote";
import { PaymentStateBlock } from "./BillingParts";
import {
  INVOICES_READ_FAILED,
  NO_INVOICE_YET_TEXT,
  OPENING_PAYMENT_LABEL,
  OPENING_PAYMENT_STATUS,
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
  companyInvoicesOptions,
  returnToPayment,
  unresolved,
  useCheckoutAttempts,
  usePayInvoice,
  usePaymentWatch,
} from "./companyBilling";

type Outcome = "failed" | "expired" | "not-found" | null;

/**
 * The never-opened card's payment slot (TAS-513, art-director B2b, DESIGN.md
 * §4.37) — its owner's, with the company's own session: the INITIAL invoice
 * the server issued with the company, «Invoice {number} · {amount}» and
 * «Pay {total}», the card's one accent, `returnTarget: CREATION`. While a
 * payment of it is unresolved, its state in the slot instead, read at the
 * watch's cadence. **The company opens only when the server says so**: an
 * invoice PAID asks the card to read the company again (`onPaid`), and only
 * its `lifecycle` ACTIVE hands the address to the app shell.
 */
export function CreationPaySlot({
  companyId,
  userId,
  company,
  creationDeadline,
  factId,
  onPaid,
}: {
  companyId: string;
  userId: string;
  company: string | null;
  creationDeadline: string | null;
  factId: string;
  onPaid: () => void;
}) {
  const invoices = useQuery(companyInvoicesOptions(companyId));
  const attempts = useCheckoutAttempts(userId, companyId);
  const listed = listedInvoices(invoices.data ?? []);
  // The invoice an unresolved payment is of, else the open first payment.
  const watched = listed.find((invoice) => unresolved(attempts.get(invoice.id))) ?? null;
  const chosen: Invoice | null =
    watched ?? listed.find((invoice) => invoice.purpose === "INITIAL" && isPayable(invoice)) ?? listed.find(isPayable) ?? null;
  const record = chosen ? (attempts.get(chosen.id) ?? null) : null;
  const watch = usePaymentWatch({ companyId, invoiceId: chosen?.id ?? null, record, enabled: chosen !== null });
  const invoice = watch.invoiceQuery.data ?? chosen;
  const press = usePayInvoice({ companyId, userId, returnTarget: "CREATION", company, creationDeadline });
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [returning, setReturning] = useState(false);

  const invoiceState = watch.invoiceQuery.data?.state ?? null;
  const checkoutState = watch.checkout?.state ?? null;
  useEffect(() => {
    if (chosen === null) return;
    if (invoiceState === "PAID") {
      if (unresolved(record)) closeAttempt(userId, companyId, chosen.id);
      onPaid();
      return;
    }
    if (!unresolved(record)) return;
    const close = (next: Outcome) => {
      setOutcome(next);
      closeAttempt(userId, companyId, chosen.id);
    };
    if (invoiceState === "EXPIRED" || invoiceState === "VOID") close(null);
    else if (checkoutState === "FAILED") close("failed");
    else if (checkoutState === "EXPIRED") close("expired");
    else if (watch.lost) close("not-found");
    // The company is the card's to follow; this only reports the invoice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record, invoiceState, checkoutState, watch.lost, chosen?.id]);

  if (invoices.isPending) return null;
  if (invoices.isError && invoices.data === undefined) {
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
    state = watchedPaymentState({ invoice: { ...invoice, state: "OPEN" }, checkout: null, left: false, stage: "fresh", company, reopened: false });
  } else if (outcome === "failed") state = failedState();
  else if (outcome === "expired") state = expiredState();
  else if (outcome === "not-found") state = notFoundState(company);
  else if (chosen !== null && press.inProgress === chosen.id) state = inProgressState(null);

  if (invoice === null) {
    return <p className="company-setup-pay">{NO_INVOICE_YET_TEXT}</p>;
  }

  const offerPay =
    isPayable(invoice) && !unresolved(record) && press.inProgress !== invoice.id && outcome !== "not-found" && (state === null || state.action === "pay");
  const inFlight = press.pending === invoice.id;
  const refusal = press.refusal?.invoiceId === invoice.id ? press.refusal : null;

  return (
    <div className="company-setup-slot">
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
      {state?.action === "return" && unresolved(record) ? (
        <button
          aria-disabled={returning || undefined}
          className="secondary-button compact-button company-setup-again"
          onClick={() => {
            if (returning) return;
            setReturning(true);
            const done = (went: boolean) => {
              if (went) return;
              setReturning(false);
              void watch.checkoutQuery.refetch();
            };
            void returnToPayment(companyId, record.checkoutId).then(done, () => done(false));
          }}
          type="button"
        >
          Return to payment
        </button>
      ) : null}
      {state?.action === "check" ? (
        <button className="secondary-button compact-button company-setup-again" onClick={watch.checkAgain} type="button">
          Check again
        </button>
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
