import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { Invoice } from "../../api/billing";
import { ErrorNote } from "../../components/ErrorNote";
import { useCompanyAddress } from "../../lib/companyAddress";
import { InvoiceMarker } from "./BillingParts";
import {
  BILLING_LOADING_TEXT,
  ENDED_INVOICE_STATES,
  INVOICES_EMPTY_TEXT,
  INVOICES_READ_FAILED,
  OPENING_PAYMENT_LABEL,
  OPENING_PAYMENT_STATUS,
  billingLeadText,
  billingOwnerOnlyText,
  formatInvoiceMoney,
  inProgressState,
  invoiceMetaText,
  isPayable,
  listedInvoices,
  primaryPayable,
  statusWord,
} from "./billingText";
import { closeAttempt, companyInvoicesOptions, unresolved, useBillingReader, useCheckoutAttempts, usePayInvoice } from "./companyBilling";
import { apiErrorFacts } from "../../api/errors";

/**
 * Company › Billing (TAS-513, art-director B1–B4, B9–B11) — the B2B build only,
 * its owner only: the company's invoices and Pay. The rail item is not in the
 * DOM for anybody else (`CompanyScreen`); an address typed by a non-owner — or
 * a tab left open after a transfer — gets the heading and one line, and no
 * billing request goes out (api-contract-guard §7).
 */
export function CompanyBillingSection() {
  const address = useCompanyAddress();
  if (address?.companyId == null) return null;
  return <CompanyBilling companyId={address.companyId} />;
}

function CompanyBilling({ companyId }: { companyId: string }) {
  const reader = useBillingReader(companyId);
  const invoices = useQuery({ ...companyInvoicesOptions(companyId), enabled: reader.owner });
  const attempts = useCheckoutAttempts(reader.meId, companyId);
  const press = usePayInvoice({ companyId, userId: reader.meId, returnTarget: "BILLING", company: reader.company });
  const retryButton = useRef<HTMLButtonElement>(null);

  // The server's ended state closes the record (release-reviewer B1): an invoice
  // read PAID, EXPIRED or VOID leaves no attempt of it behind — the invoice
  // page's rule (`INVOICE_ENDED`), on the list too.
  const ended = (invoices.data ?? []).filter((invoice) => ENDED_INVOICE_STATES.has(invoice.state ?? "")).map((invoice) => invoice.id);
  useEffect(() => {
    for (const invoiceId of ended) {
      const record = attempts.get(invoiceId);
      if (record) closeAttempt(record.userId, companyId, invoiceId, record.key);
    }
    // `ended` is derived from the list's answer, `attempts` from the records.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ended.join(), attempts, companyId]);

  // Back from the provider left a payment (N3): no «Return to payment» here — focus goes to its invoice's link.
  const returnFocusHandled = useRef(0);
  useEffect(() => {
    if (press.returnFocusRequest <= returnFocusHandled.current || press.returnFocusInvoice === null) return;
    const link = document.querySelector<HTMLElement>(`[data-invoice-link="${CSS.escape(press.returnFocusInvoice)}"]`);
    if (link === null) return;
    returnFocusHandled.current = press.returnFocusRequest;
    link.focus();
  });
  /**
   * «Try again» in flight: the failure it was pressed against stays drawn, the
   * button where it was, until the re-read answers (§4.40's mechanics) —
   * TanStack puts a failed read without data back to `pending` on a refetch.
   */
  const [retrying, setRetrying] = useState<{ error: unknown; at: number } | null>(null);
  const [refocus, setRefocus] = useState(0);
  useEffect(() => {
    if (refocus > 0) retryButton.current?.focus();
  }, [refocus]);
  // The skeleton only until the list first settles — latched (§4.40 «Загрузка»).
  const [opened, setOpened] = useState(false);
  if (!opened && (invoices.isSuccess || invoices.isError)) setOpened(true);

  if (!reader.known) return <BillingLoading />;
  if (!reader.owner) {
    return (
      <div className="settings-plane">
        <div className="settings-column company-billing">
          <p className="settings-lead">{billingOwnerOnlyText(reader.company)}</p>
        </div>
      </div>
    );
  }
  if (!opened) return <BillingLoading />;
  const failure = retrying ?? (invoices.isError && invoices.data === undefined ? { error: invoices.error, at: invoices.errorUpdatedAt } : null);

  const listed = listedInvoices(invoices.data ?? []);
  const payable = (invoice: Invoice) => isPayable(invoice) && !unresolved(attempts.get(invoice.id)) && press.inProgress !== invoice.id;
  const primary = primaryPayable(listed, payable);

  return (
    <div className="settings-plane">
      <div className="settings-column company-billing">
        <p className="settings-lead">{billingLeadText(reader.company)}</p>
        {failure !== null ? (
          <div className="company-plan-failure company-billing-failure">
            {/* Found on arrival, not announced (§5.6); a failure that stays remounts its box. */}
            <ErrorNote key={failure.at} requestId={apiErrorFacts(failure.error).requestId}>
              {INVOICES_READ_FAILED}
            </ErrorNote>
            <button
              aria-disabled={retrying !== null || undefined}
              className="secondary-button compact-button company-plan-retry"
              onClick={() => {
                if (retrying !== null) return;
                setRetrying(failure);
                void invoices.refetch().then((result) => {
                  setRetrying(null);
                  if (!result.isSuccess) setRefocus((value) => value + 1);
                  else document.querySelector<HTMLElement>(".settings-area .area-section-title")?.focus();
                });
              }}
              ref={retryButton}
              type="button"
            >
              Try again
            </button>
          </div>
        ) : (
          <section aria-labelledby="company-invoices-title" className="company-group company-billing-group">
            <h2 className="company-group-title" id="company-invoices-title">
              Invoices<span className="company-group-count">{listed.length}</span>
            </h2>
            {listed.length === 0 ? (
              <p className="company-billing-empty">{INVOICES_EMPTY_TEXT}</p>
            ) : (
              <ul className="company-invoice-list">
                {listed.map((invoice) => {
                  const confirming = unresolved(attempts.get(invoice.id));
                  const word = statusWord(invoice.state, confirming);
                  const inFlight = press.pending === invoice.id;
                  const refusal = press.refusal?.invoiceId === invoice.id ? press.refusal : null;
                  return (
                    <li className="company-invoice-row" key={invoice.id}>
                      <div className="company-invoice-text">
                        <Link
                          className="company-invoice-number"
                          data-invoice-link={invoice.id}
                          to={`/company/billing/${encodeURIComponent(invoice.id)}`}
                        >
                          {invoice.number ?? "Invoice"}
                        </Link>
                        <p className="company-invoice-meta">
                          {invoiceMetaText(invoice)}
                          <InvoiceMarker className="company-invoice-marker-inline" word={word} />
                        </p>
                      </div>
                      <span className="company-invoice-amount">{invoice.total ? formatInvoiceMoney(invoice.total) : null}</span>
                      <span className="company-invoice-status">
                        <InvoiceMarker word={word} />
                      </span>
                      <div className="company-invoice-action">
                        {payable(invoice) ? (
                          <button
                            aria-disabled={inFlight || press.pending !== null || undefined}
                            className={`${invoice.id === primary ? "primary-button" : "secondary-button"} compact-button company-billing-pay`}
                            onClick={(event) => void press.pay(invoice, event.currentTarget)}
                            type="button"
                          >
                            {inFlight ? OPENING_PAYMENT_LABEL : "Pay"}
                          </button>
                        ) : null}
                      </div>
                      {inFlight ? (
                        <span className="visually-hidden" role="status">
                          {OPENING_PAYMENT_STATUS}
                        </span>
                      ) : null}
                      {refusal ? (
                        <div className="company-invoice-note">
                          <ErrorNote key={refusal.key} live="alert" requestId={refusal.requestId} serverWords={refusal.words.words}>
                            {refusal.words.text}
                          </ErrorNote>
                        </div>
                      ) : null}
                      {press.inProgress === invoice.id ? (
                        <p className="company-general-state company-invoice-note" role="status">
                          <span className="company-general-state-fact">{inProgressState(null).fact}</span> {inProgressState(null).explanation}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

/** Three rows of bars (B3): no spinner; the hidden status says what is loading. */
function BillingLoading() {
  return (
    <div className="settings-plane">
      <div aria-busy="true" className="settings-column company-billing company-billing-loading">
        <span className="visually-hidden" role="status">
          {BILLING_LOADING_TEXT}
        </span>
        <ul aria-hidden="true" className="company-invoice-list">
          {[0, 1, 2].map((index) => (
            <li className="company-invoice-row company-invoice-skeleton" key={index}>
              <div className="company-invoice-text">
                <span className="value-skeleton company-invoice-skeleton-number" />
                <span className="value-skeleton company-invoice-skeleton-meta" />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
