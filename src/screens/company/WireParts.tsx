import { Check, Copy, Download } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { Invoice, InvoiceDetail, Refund, WireInstructions } from "../../api/billing";
import { InvoiceMarker, StepChain } from "./BillingParts";
import { formatInvoiceMoney } from "./billingText";
import type { useInvoiceDownload } from "./companyBilling";
import {
  BANK_TRANSFER_TITLE,
  BILLING_DETAILS_TITLE,
  COPY_WORDS,
  DOWNLOAD_PDF,
  ITEMS_TITLE,
  NO_ITEMS_TEXT,
  REFUNDS_LEAD,
  REFUNDS_TITLE,
  SNAPSHOT_NOTE,
  amountRestNote,
  bankLead,
  buyerLines,
  copyFailedText,
  downloadLabel,
  fxQuoteText,
  ibanGroups,
  lineMetaText,
  needsTotalRow,
  receivedOf,
  referenceNote,
  refundChain,
  refundConsequenceText,
  refundMarker,
  refundReasonText,
  sellerLines,
  type CopyField,
} from "./wireText";

/*
 * TAS-514's parts of Company › Billing, its invoice and the never-opened card
 * (DESIGN.md §4.41 to be, art-director B4, B5, B8–B11, B14): the bank details
 * with their Copy controls, the invoice's items and its billing details as
 * issued, «Download PDF», and the company's refunds. Every value is the
 * server's, drawn as it came.
 */

/** How long a Copy control shows its check and the status says it (B5). */
const COPIED_MS = 2000;

const coarsePointer = () => {
  try {
    return window.matchMedia("(pointer: coarse)").matches;
  } catch {
    return false;
  }
};

/** Selects a value's node, so the reader can copy it by hand when the clipboard refused (B5). Focus stays where it is. */
function selectNode(node: HTMLElement | null) {
  if (node === null) return;
  try {
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  } catch {
    // Nothing to select with: the sentence still says what to do.
  }
}

/**
 * The «Bank transfer» group (B4, B5; B14's card form with `card`): the lead,
 * the six rows in SEPA order — beneficiary, IBAN, BIC, bank, amount and
 * reference, all verbatim, the IBAN in groups of four for reading only —, the
 * reconciliation note under them and one persistent status for the Copy
 * controls. Copy copies exactly the server's value, and never moves focus.
 */
export function BankTransferGroup({
  invoice,
  details,
  note,
  card = false,
  after,
}: {
  invoice: Invoice;
  details: WireInstructions;
  note: ReactNode;
  card?: boolean;
  /** The card's «Download PDF», under the note (B14). */
  after?: ReactNode;
}) {
  const titleId = useId();
  const [copied, setCopied] = useState<CopyField | null>(null);
  const [said, setSaid] = useState<{ text: string; failed: boolean; seq: number } | null>(null);
  const timer = useRef<number | null>(null);
  const values = useRef<Partial<Record<CopyField, HTMLElement | null>>>({});
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const copy = async (field: CopyField, value: string) => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    const seq = (said?.seq ?? 0) + 1;
    try {
      if (navigator.clipboard === undefined) throw new Error("No clipboard");
      await navigator.clipboard.writeText(value);
      setCopied(field);
      setSaid({ text: COPY_WORDS[field].copied, failed: false, seq });
      timer.current = window.setTimeout(() => {
        setCopied(null);
        setSaid((current) => (current?.seq === seq ? null : current));
        timer.current = null;
      }, COPIED_MS);
    } catch {
      setCopied(null);
      selectNode(values.current[field] ?? null);
      // Stays until the next press (B5).
      setSaid({ text: copyFailedText(field, coarsePointer()), failed: true, seq });
    }
  };

  const copyButton = (field: CopyField, value: string) => (
    <button
      aria-label={COPY_WORDS[field].label}
      className="icon-button company-bank-copy"
      onClick={() => void copy(field, value)}
      title="Copy"
      type="button"
    >
      {copied === field ? <Check aria-hidden="true" size={14} /> : <Copy aria-hidden="true" size={14} />}
    </button>
  );
  const received = receivedOf(invoice);
  const lead = bankLead(invoice);

  return (
    <section aria-labelledby={titleId} className={card ? "company-group company-bank is-card" : "company-group company-bank"}>
      <h2 className="company-group-title company-bank-title" id={titleId}>
        {BANK_TRANSFER_TITLE}
      </h2>
      <p className="company-bank-lead">
        {lead.before}
        {lead.due !== null && invoice.dueAt !== null ? <time dateTime={invoice.dueAt}>{lead.due}</time> : null}
        {lead.after}
      </p>
      <dl className="settings-details company-bank-details">
        <div>
          <dt>Beneficiary</dt>
          <dd>
            <span className="company-bank-value-row">
              <span className="company-bank-value" ref={(node) => void (values.current.beneficiary = node)}>
                {details.beneficiaryName}
              </span>
              {copyButton("beneficiary", details.beneficiaryName)}
            </span>
          </dd>
        </div>
        <div>
          <dt>IBAN</dt>
          <dd>
            <span className="company-bank-value-row">
              <span className="company-bank-value company-bank-mono company-bank-iban" ref={(node) => void (values.current.iban = node)}>
                {ibanGroups(details.iban).join(" ")}
              </span>
              {copyButton("iban", details.iban)}
            </span>
          </dd>
        </div>
        <div>
          <dt>BIC</dt>
          <dd>
            <span className="company-bank-value-row">
              <span className="company-bank-value company-bank-mono" ref={(node) => void (values.current.bic = node)}>
                {details.bic}
              </span>
              {copyButton("bic", details.bic)}
            </span>
          </dd>
        </div>
        <div>
          <dt>Bank</dt>
          <dd>
            <span className="company-bank-value">{details.bankName}</span>
          </dd>
        </div>
        <div>
          <dt>Amount</dt>
          <dd>
            <span className="company-bank-amount">{invoice.remaining !== null ? formatInvoiceMoney(invoice.remaining) : null}</span>
            {received !== null && invoice.total !== null ? <span className="company-bank-line">{amountRestNote(invoice.total, received)}</span> : null}
          </dd>
        </div>
        <div>
          <dt>Reference</dt>
          <dd>
            <span className="company-bank-value-row">
              <span className="company-bank-value company-bank-mono" ref={(node) => void (values.current.reference = node)}>
                {details.reference}
              </span>
              {copyButton("reference", details.reference)}
            </span>
            <span className="company-bank-line">{referenceNote(details.reference, invoice.number)}</span>
          </dd>
        </div>
      </dl>
      <div className="company-bank-note">{note}</div>
      {after}
      {/* One persistent region for every Copy (B5): empty, it takes no height. */}
      <div className={said?.failed ? "company-bank-copy-status is-failed" : "company-bank-copy-status"} role="status">
        {said !== null ? <span key={said.seq}>{said.text}</span> : null}
      </div>
    </section>
  );
}

/** «Download PDF» (B10): a `<button>`, never a link — the bytes come by an authenticated fetch. In flight, the label stays. */
export function DownloadPdfButton({
  invoice,
  press,
  className,
}: {
  invoice: Pick<Invoice, "id" | "number">;
  press: ReturnType<typeof useInvoiceDownload>;
  className?: string;
}) {
  const inFlight = press.pending === invoice.id;
  return (
    <button
      aria-disabled={press.pending !== null || undefined}
      aria-label={downloadLabel(invoice.number)}
      className={className ? `secondary-button company-invoice-download ${className}` : "secondary-button company-invoice-download"}
      data-in-flight={inFlight || undefined}
      onClick={() => {
        if (press.pending === null) void press.download(invoice);
      }}
      type="button"
    >
      <Download aria-hidden="true" size={13} />
      {DOWNLOAD_PDF}
    </button>
  );
}

/**
 * «Items» (B8): the invoice's lines as issued, a «Total» row when there is more
 * than one or any tax, the FX quote under them. An answer that carried no list
 * of lines draws no group at all; «This invoice lists no items.» is said only
 * for an empty one (G3).
 */
export function InvoiceItems({ invoice }: { invoice: InvoiceDetail }) {
  const titleId = useId();
  const lines = invoice.lines;
  const fx = invoice.fxQuote ? fxQuoteText(invoice.fxQuote) : null;
  if (lines == null) return null;
  return (
    <section aria-labelledby={titleId} className="company-group company-invoice-items">
      <h2 className="company-group-title" id={titleId}>
        {ITEMS_TITLE}
      </h2>
      {lines.length === 0 ? (
        <p className="company-billing-empty">{NO_ITEMS_TEXT}</p>
      ) : (
        <ul className="company-item-list">
          {lines.map((line, index) => {
            const meta = lineMetaText(line);
            return (
              <li className="company-item-row" key={index}>
                <div className="company-item-text">
                  <p className="company-item-description">{line.description}</p>
                  {meta !== "" ? <p className="company-item-meta">{meta}</p> : null}
                </div>
                <span className="company-item-amount">{line.total !== null ? formatInvoiceMoney(line.total) : null}</span>
              </li>
            );
          })}
          {needsTotalRow(lines) ? (
            <li className="company-item-row is-total">
              <div className="company-item-text">
                <p className="company-item-description">Total</p>
              </div>
              <span className="company-item-amount">{invoice.total !== null ? formatInvoiceMoney(invoice.total) : null}</span>
            </li>
          ) : null}
        </ul>
      )}
      {fx !== null ? <p className="company-items-fx">{fx}</p> : null}
    </section>
  );
}

/** «Billing details» (B9): Billed to and From as the invoice was issued — read-only, never merged with the company now. */
export function InvoiceSnapshot({ invoice }: { invoice: InvoiceDetail }) {
  const titleId = useId();
  const buyer = invoice.buyer ? buyerLines(invoice.buyer) : [];
  const seller = invoice.seller ? sellerLines(invoice.seller) : [];
  if (buyer.length === 0 && seller.length === 0) return null;
  const block = (lines: string[]) =>
    lines.map((line, index) => (
      <span className="company-snapshot-line" key={index}>
        {line}
      </span>
    ));
  return (
    <section aria-labelledby={titleId} className="company-group company-invoice-snapshot">
      <h2 className="company-group-title" id={titleId}>
        {BILLING_DETAILS_TITLE}
      </h2>
      <p className="company-snapshot-note">{SNAPSHOT_NOTE}</p>
      <dl className="settings-details company-snapshot">
        {buyer.length > 0 ? (
          <div>
            <dt>Billed to</dt>
            <dd>{block(buyer)}</dd>
          </div>
        ) : null}
        {seller.length > 0 ? (
          <div>
            <dt>From</dt>
            <dd>{block(seller)}</dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}

/**
 * «Refunds {n}» on Billing (B11; TAS-516 T3–T5): its own list — no invoice, no
 * link, no action; shown only when there is one. Line 2 is the refund's history,
 * each step from its own field; line 3 what it means; the lead, tied to the
 * group, says the dates are Taska's and the crediting the banks'.
 */
export function RefundsGroup({ refunds }: { refunds: readonly Refund[] }) {
  const titleId = useId();
  const leadId = useId();
  if (refunds.length === 0) return null;
  return (
    <section aria-describedby={leadId} aria-labelledby={titleId} className="company-group company-refunds">
      <h2 className="company-group-title" id={titleId}>
        {REFUNDS_TITLE}
        <span className="company-group-count">{refunds.length}</span>
      </h2>
      <p className="company-refunds-lead" id={leadId}>
        {REFUNDS_LEAD}
      </p>
      <ul className="company-refund-list">
        {refunds.map((refund) => {
          const word = refundMarker(refund.state);
          const consequence = refundConsequenceText(refund);
          return (
            <li className={consequence !== null ? "company-refund-row has-line3" : "company-refund-row"} key={refund.id}>
              <div className="company-refund-text">
                <p className="company-refund-reason">{refundReasonText(refund.reasonCode)}</p>
                <p className="company-refund-meta">
                  <StepChain steps={refundChain(refund)} />
                  <InvoiceMarker className="company-invoice-marker-inline" word={word} />
                </p>
                {consequence !== null ? <p className="company-refund-consequence">{consequence}</p> : null}
              </div>
              <span className="company-refund-amount">{refund.amount !== null ? formatInvoiceMoney(refund.amount) : null}</span>
              <span className="company-refund-status">
                <InvoiceMarker word={word} />
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
