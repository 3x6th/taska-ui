import type { ReactNode } from "react";
import type { PaymentState } from "./billingText";

/*
 * What Company › Billing's list, its invoice and the never-opened card share
 * (TAS-513): the payment's state line and the status marker.
 */

/**
 * The state of a payment (art-director B7): §4.39's state recipe — the fact in
 * `--fg` 600, its explanation in `--fg-2`, no fill, edge, stripe or icon. One
 * persistent `role="status"`, mounted empty, so each change is announced and
 * nothing else is. `factId` is what the heading's `aria-describedby` names
 * after a return (B11).
 */
export function PaymentStateBlock({ state, factId, after }: { state: PaymentState | null; factId?: string; after?: ReactNode }) {
  return (
    <div className="company-general-states company-payment-state" role="status">
      {state !== null ? (
        <p className="company-general-state">
          <span className="company-general-state-fact" id={factId}>
            {state.fact}
          </span>{" "}
          {state.explanation}
          {after}
        </p>
      ) : null}
    </div>
  );
}

/** The status marker (B9): §5.8's `read-only` recipe, no colour — the word carries it. */
export function InvoiceMarker({ word, className }: { word: string | null; className?: string }) {
  if (word === null) return null;
  return <span className={className ? `company-marker ${className}` : "company-marker"}>{word}</span>;
}
