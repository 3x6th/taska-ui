import { Link } from "react-router-dom";
import { BILLING_SECTION } from "./sections";
import { stateLines, stillWorksText } from "./companyGeneralText";

/**
 * «Состояние» (DESIGN.md §4.39; TAS-512 §4.40): the company's restrictions as
 * one line each — the fact, and its explanation for this reader — then, when
 * every restriction is a financial one, the one sentence of what still works.
 * One component and one wording on General and on Plan (art-director B5).
 * From `Tenant.restrictions` only; nothing here is live, and nothing is
 * switched off by it (api-contract-guard B6). Nothing is drawn when there is
 * nothing to say. Since TAS-513 the owner's «Its paid period has ended.» line
 * ends with a link — not a button — to Billing, where it is paid (art-director
 * B2c): §5.8's standalone link, «See Plan»'s recipe. Since TAS-516 (art-director
 * B13) the owner's dispute line earns it too — at most one per block, on the
 * first line that does, in §4.39's order.
 */
export function CompanyStateBlock({ restrictions, owner }: { restrictions: readonly string[]; owner: boolean }) {
  const lines = stateLines(restrictions, owner);
  const works = stillWorksText(restrictions, owner);
  if (lines.length === 0 && works === null) return null;
  const billingLinkOn = owner ? (lines.find((line) => line.code === "PAYMENT_DISPUTE" || line.code === "PAYMENT_EXPIRED")?.code ?? null) : null;
  return (
    <div className="company-general-states">
      {lines.map((line) => (
        <p className="company-general-state" key={line.code}>
          <span className="company-general-state-fact">{line.fact}</span>
          {line.explanation ? ` ${line.explanation}` : null}
          {line.code === billingLinkOn ? (
            <>
              {" "}
              <Link className="admin-note-link company-state-billing-link" to={BILLING_SECTION.path}>
                See Billing
              </Link>
            </>
          ) : null}
        </p>
      ))}
      {works !== null ? <p className="company-general-state">{works}</p> : null}
    </div>
  );
}
