import { useEffect, useRef } from "react";
import { ApiNotice } from "../components/ApiNotice";
import { AddressLink } from "../components/CompanyRouter";
import { COMPANIES_ROUTE, closedCompanyWords } from "../lib/companies";

/**
 * DESIGN.md §4.35 (TAS-500): the company cannot be opened — its entry was
 * refused, or reading it or renewing its session was refused mid-work for its
 * membership or its lifecycle. Drawn at the address that was open, without a
 * redirect: a reload asks the server again, and a direct link does not get
 * past the refusal. §4.18's column without the mascot; focus on the heading.
 *
 * No request id: this is an answer, not a failure (§4.35). A code outside the
 * table is said in the server's words.
 */
export function CompanyClosedScreen({
  name,
  refusal,
  onLogout,
  logoutPending = false,
}: {
  name: string | null;
  refusal: { code: string | null; reasons: readonly string[]; message: string | null };
  onLogout: () => void;
  logoutPending?: boolean;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  const words = closedCompanyWords(name, refusal, null);
  const text = words.text ?? refusal.message;

  return (
    <main className="notfound-screen" data-reason={refusal.code ?? undefined}>
      <div className="notfound-content company-closed">
        <h1 className="notfound-title" ref={heading} tabIndex={-1}>
          {words.title}
        </h1>
        {text ? <p className="notfound-text">{text}</p> : null}
        <div className="issue-key-actions">
          <AddressLink className="primary-button notfound-action" path={COMPANIES_ROUTE} state={{ focusHeading: true }}>
            Choose a company
          </AddressLink>
          <button className="secondary-button" disabled={logoutPending} onClick={onLogout} type="button">
            {logoutPending ? "Logging out…" : "Log out"}
          </button>
        </div>
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
        <ApiNotice error={error}>Taska could not reach this company. Nothing in it is known yet.</ApiNotice>
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
