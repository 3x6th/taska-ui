import { useId } from "react";
import { Link } from "react-router-dom";
import type { Dispute } from "../../api/billing";
import { InvoiceMarker, StepChain } from "./BillingParts";
import {
  DISPUTED_PAYMENT,
  DISPUTES_TITLE,
  disputeConsequenceText,
  disputeDateSteps,
  disputeMarker,
  newPaymentRowId,
  newPaymentText,
} from "./disputeText";

/**
 * «Disputes {n}» on Billing (TAS-516, art-director B4–B8, T1–T2): the Refunds
 * recipe without an amount — the contract names no invoice and no amount (A91).
 * Shown only when there is one. What a row says comes from its own state and
 * matching outcome; «See Plan» is §4.40's Pending change link, once per group.
 */
export function DisputesGroup({
  disputes,
  company,
  restrictions,
}: {
  disputes: readonly Dispute[];
  company: string | null;
  restrictions: readonly string[];
}) {
  const titleId = useId();
  if (disputes.length === 0) return null;
  const newPaymentRow = newPaymentRowId(disputes, restrictions);
  return (
    <section aria-labelledby={titleId} className="company-group company-disputes">
      <h2 className="company-group-title" id={titleId}>
        {DISPUTES_TITLE}{" "}
        <span className="company-group-count">{disputes.length}</span>
      </h2>
      <ul className="company-dispute-list">
        {disputes.map((dispute) => {
          const word = disputeMarker(dispute);
          const consequence = disputeConsequenceText(dispute);
          return (
            <li className={consequence !== null ? "company-dispute-row has-line3" : "company-dispute-row"} key={dispute.id}>
              <div className="company-refund-text">
                <p className="company-refund-reason">{DISPUTED_PAYMENT}</p>
                <p className="company-refund-meta">
                  <StepChain steps={disputeDateSteps(dispute)} />
                  <InvoiceMarker className="company-invoice-marker-inline" word={word} />
                </p>
                {consequence !== null ? (
                  <p className="company-refund-consequence">
                    {consequence}
                    {dispute.id === newPaymentRow ? (
                      <>
                        {" "}
                        {newPaymentText(company)}{" "}
                        <Link className="admin-note-link company-plan-invoice-link" state={{ focusHeading: true }} to="/company/plan">
                          See Plan
                        </Link>
                      </>
                    ) : null}
                  </p>
                ) : null}
              </div>
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
