import type { CheckoutAttempt } from "../api/checkoutAttempt";
import { companyRoute } from "../lib/companies";

/** Router state of a landing from the payment page: focus goes to the heading, described by the state (B11). */
export interface CheckoutReturnState {
  checkoutReturn?: boolean;
}

/** Where a payment page sends the owner back to (TAS-513, A54): two static addresses, outside every company. */
export const BILLING_RETURN_ROUTE = "/billing/return";
export const BILLING_CANCEL_ROUTE = "/billing/cancel";

export const NO_ATTEMPT_TEXT = "We can’t find a payment started in this browser — open Billing to see its state.";
export const SEVERAL_ATTEMPTS_TEXT = "More than one payment was started in this browser. Choose the one you came back from.";
/** The account could not be read on the way back, so no record could be (release-reviewer N6). */
export const CHECK_FAILED_TEXT = "Taska couldn’t check this payment.";
/** «This payment belongs to {Company}.» — the company's name is the link (api-contract-guard §3). */
export const BELONGS_TO_TEXT = "This payment belongs to";

/** Where an attempt's return lands (B6): the invoice (BILLING), or the never-opened card at any path of the company (CREATION). */
export const attemptTarget = (attempt: CheckoutAttempt) =>
  attempt.returnTarget === "CREATION"
    ? companyRoute(attempt.tenantId)
    : companyRoute(attempt.tenantId, `/company/billing/${encodeURIComponent(attempt.invoiceId)}`);
