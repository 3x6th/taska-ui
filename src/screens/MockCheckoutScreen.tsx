import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { MockTaskaStore } from "../api/mock/MockTaskaApi";
import { MockTenantServer, type MockCheckoutOutcome, type MockCheckoutPage } from "../api/mock/MockTenantServer";
import { appUrl } from "../lib/appLinks";
import { formatInvoiceMoney } from "./company/billingText";
import { BILLING_CANCEL_ROUTE, BILLING_RETURN_ROUTE } from "./billingReturn";

/*
 * The mock's stand-in for the payment provider's hosted page (TAS-513,
 * art-director B12, the orchestrator's decision 5) — **mock builds only**:
 * `App` mounts it behind a compile-time check of `VITE_TASKA_API_MODE`, so a
 * REST build has neither the route nor this chunk. Outside the app shell and
 * every session: it is the provider, not Taska.
 *
 * It reads as a Taska notice, not a payment page: §4.18's column on `--bg`, no
 * card, logo, card or IBAN field, lock icon or brand colour, and no primary or
 * accent at all. It knows its checkout only by the opaque token in its address,
 * which only `MockTenantServer` maps back; an outcome is the provider's
 * observation (`observeMockCheckout`), and the page then goes to the backend's
 * static return address — `/billing/return`, or `/billing/cancel` — with no id,
 * as PR #323 sends it.
 */

const OUTCOMES: ReadonlyArray<{ outcome: MockCheckoutOutcome; label: string }> = [
  { outcome: "succeeds", label: "Payment succeeds" },
  { outcome: "fails", label: "Payment fails" },
  { outcome: "cancel", label: "Cancel and go back" },
  { outcome: "unknown", label: "Bank doesn’t answer (unknown)" },
  { outcome: "succeedsLater", label: "Succeeds after 20 seconds" },
];

export const MOCK_CHECKOUT_TITLE = "Test checkout — Taska mock";

/** The provider's side of the mock: the same shared storage the mock server keeps its state in. */
function desk(): MockTenantServer {
  return new MockTenantServer({ storage: window.localStorage, accountStore: new MockTaskaStore(), latencyMs: 0 });
}

export default function MockCheckoutScreen() {
  const { token = "" } = useParams();
  const [page] = useState<MockCheckoutPage | null>(() => desk().mockCheckoutPage(token));
  const [leaving, setLeaving] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    document.title = MOCK_CHECKOUT_TITLE;
    heading.current?.focus();
    return () => {
      document.title = "Taska";
    };
  }, []);

  const choose = (outcome: MockCheckoutOutcome) => {
    if (leaving) return;
    setLeaving(true);
    const back = desk().observeMockCheckout(token, outcome);
    window.location.assign(appUrl(back === "cancel" ? BILLING_CANCEL_ROUTE : BILLING_RETURN_ROUTE));
  };

  return (
    <main className="notfound-screen mock-checkout-screen">
      <div className="notfound-content mock-checkout">
        <h1 className="mock-checkout-title" ref={heading} tabIndex={-1}>
          Test checkout — no real payment
        </h1>
        <p className="mock-checkout-lead">
          This page stands in for the payment provider on the mock server. No card is asked for and nothing is charged.
        </p>
        {page !== null ? (
          <>
            <dl className="settings-details mock-checkout-facts">
              <div>
                <dt>Company</dt>
                <dd>{page.company ?? "—"}</dd>
              </div>
              <div>
                <dt>Invoice</dt>
                <dd>{page.invoiceNumber ?? "—"}</dd>
              </div>
              <div>
                <dt>Amount</dt>
                <dd>{page.amount ? formatInvoiceMoney(page.amount) : "—"}</dd>
              </div>
            </dl>
            <p className="mock-checkout-id">mock checkout {page.checkoutId}</p>
          </>
        ) : null}
        {page !== null && page.open ? (
          <div className="mock-checkout-outcomes">
            {OUTCOMES.map(({ outcome, label }) => (
              <button
                aria-disabled={leaving || undefined}
                className="secondary-button mock-checkout-outcome"
                key={outcome}
                onClick={() => choose(outcome)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        ) : (
          <>
            <p className="mock-checkout-lead">This test checkout is no longer open.</p>
            <div className="mock-checkout-outcomes">
              <a className="secondary-button mock-checkout-outcome" href={appUrl(BILLING_RETURN_ROUTE)}>
                Back to Taska
              </a>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
