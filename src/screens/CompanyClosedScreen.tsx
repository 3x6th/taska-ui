import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { ApiNotice } from "../components/ApiNotice";
import { AddressLink } from "../components/CompanyRouter";
import { RequestId } from "../components/RequestId";
import type { Tenant } from "../api/tenants";
import { COMPANIES_ROUTE, closedCompanyReason, closedCompanyWords } from "../lib/companies";

/**
 * DESIGN.md §4.35 (TAS-500): the company cannot be opened — its entry was
 * refused, or reading it or renewing its session was refused mid-work for its
 * membership or its lifecycle. Drawn at the address that was open, without a
 * redirect: a reload asks the server again, and a direct link does not get
 * past the refusal. §4.18's column without the mascot; focus on the heading.
 *
 * No request id: this is an answer, not a failure (§4.35) — except on the
 * table's last row, a code outside it with no list row to read a reason from,
 * which is said in the server's words with the request id beside them: that is
 * a failure the reader will pass on (§4.18 «Request id»).
 *
 * Since TAS-504 it is also the paused or blocked company's statement on its
 * content routes (the session kept, api-contract-guard B2): to its owner —
 * `owner`, the list row's `ownerId` — the pause's and the block's rows say so,
 * and the way on is the company's settings, where Resume is, with «Choose a
 * company» beside it; no «Log out» — it is one step away in the profile menu.
 */
export function CompanyClosedScreen({
  name,
  refusal,
  tenant = null,
  onLogout,
  logoutPending = false,
  owner = false,
}: {
  name: string | null;
  refusal: { code: string | null; reasons: readonly string[]; message: string | null; requestId: string | null };
  /** The company's row in the reader's list, when it has one — the reason when the refusal's code says none (§4.35). */
  tenant?: Tenant | null;
  onLogout: () => void;
  logoutPending?: boolean;
  /** The reader owns the company (TAS-504) — its pause and its block are said to them in their own words. */
  owner?: boolean;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  const reason = closedCompanyReason(refusal, tenant);
  const ownersRow = owner && (reason === "PLATFORM_BLOCK" || reason === "OWNER_PAUSE");
  const words = closedCompanyWords(name, refusal, tenant, ownersRow);
  const text = words.text ?? refusal.message;
  const requestId = words.text === null ? refusal.requestId : null;

  return (
    <main className="notfound-screen" data-reason={refusal.code ?? undefined}>
      <div className="notfound-content company-closed">
        <h1 className="notfound-title" ref={heading} tabIndex={-1}>
          {words.title}
        </h1>
        {text ? <p className="notfound-text">{text}</p> : null}
        {requestId ? (
          <p className="notfound-text company-closed-request">
            <RequestId value={requestId} />
          </p>
        ) : null}
        {ownersRow ? (
          <div className="issue-key-actions">
            <Link className="primary-button notfound-action" to="/settings/company">
              Open company settings
            </Link>
            <AddressLink className="secondary-button company-closed-secondary" path={COMPANIES_ROUTE} state={{ focusHeading: true }}>
              Choose a company
            </AddressLink>
          </div>
        ) : (
          <div className="issue-key-actions">
            <AddressLink className="primary-button notfound-action" path={COMPANIES_ROUTE} state={{ focusHeading: true }}>
              Choose a company
            </AddressLink>
            <button className="secondary-button" disabled={logoutPending} onClick={onLogout} type="button">
              {logoutPending ? "Logging out…" : "Log out"}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

/**
 * The company could not be opened for want of an answer — no answer at all, a
 * 5xx, a 408 or a 429 (DESIGN.md §4.35 «Не этот экран»): §4.18's refusal
 * variant, with the server's words and the request id, «Try again» and
 * «Choose a company». The retry keeps the screen and its focus; the button is
 * `aria-disabled` while it is out (§4.21).
 */
export function CompanyUnavailableScreen({
  name,
  error,
  onRetry,
  retrying,
}: {
  name: string | null;
  error: unknown;
  onRetry: () => void;
  retrying: boolean;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  const company = name ?? "This company";

  return (
    <main aria-busy={retrying || undefined} className="notfound-screen">
      <div className="notfound-content issue-key-failure">
        <h1 className="notfound-title" ref={heading} tabIndex={-1}>
          {company} could not be opened
        </h1>
        <ApiNotice error={error}>Taska could not open this company right now. Nothing in it is known yet.</ApiNotice>
        <div className="issue-key-actions">
          <button
            aria-disabled={retrying || undefined}
            className="secondary-button issue-key-retry"
            onClick={() => {
              if (!retrying) onRetry();
            }}
            type="button"
          >
            Try again
          </button>
          <AddressLink className="primary-button notfound-action" path={COMPANIES_ROUTE} state={{ focusHeading: true }}>
            Choose a company
          </AddressLink>
        </div>
      </div>
    </main>
  );
}
