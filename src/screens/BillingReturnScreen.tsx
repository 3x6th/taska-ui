import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { taskaApi } from "../api/client";
import { closeCreationAttempts, listCheckoutAttempts, markLeft, type CheckoutAttempt } from "../api/checkoutAttempt";
import { apiErrorFacts } from "../api/errors";
import { AuthShell } from "../components/AuthShell";
import { AddressLink } from "../components/CompanyRouter";
import { ErrorNote } from "../components/ErrorNote";
import { useCompanies } from "../hooks/useCompanies";
import type { Theme } from "../hooks/useTheme";
import { COMPANIES_ROUTE, companyRoute, isNeverOpened, tenantsQueryOptions } from "../lib/companies";
import { useAccountQueryClient, useCompanyAddress } from "../lib/companyAddress";
import { formatDeadline } from "./companySetupText";
import {
  BELONGS_TO_TEXT,
  CHECK_FAILED_TEXT,
  NO_ATTEMPT_TEXT,
  SEVERAL_ATTEMPTS_TEXT,
  attemptTarget,
  type CheckoutReturnState,
} from "./billingReturn";

type Landing =
  | { kind: "deciding" }
  | { kind: "none" }
  | { kind: "several"; attempts: CheckoutAttempt[] }
  | { kind: "elsewhere"; attempt: CheckoutAttempt };

/**
 * The payment page's way back (TAS-513, api-contract-guard §3 and its
 * addendum A54, the orchestrator's decision 4) — `/billing/return` and
 * `/billing/cancel`, static, outside `/c/{companyId}`, because the backend
 * sends every owner to the same two addresses with no id in them.
 *
 * **The address says nothing**: its query is taken out unread
 * (`history.replace`), and the landing is routed by this account's open
 * attempt records, newest first — the one place that knows the company, the
 * invoice and the checkout. The cancel address leaves one mark on the newest
 * record (`leftAt`), a wording hint only (A56). One record: its company's
 * invoice or card, when the tab holds that company or none — entering is not
 * swapping; when the tab holds **another** company, nothing is switched: it
 * says whose payment it is, with a link. Several: the reader chooses. None:
 * there is nothing to show, and never «paid». Only records the server
 * answered with a checkout count (release-reviewer N5): one whose answer
 * never came has no payment page to have come back from. A CREATION record
 * of a company that is no longer never-opened is spent, and closed on the
 * way in (B1). The account unreadable — no records can be read — is said,
 * with the way on (N6).
 */
export function BillingReturnScreen({ cancel, theme, toggleTheme }: { cancel: boolean; theme: Theme; toggleTheme: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const address = useCompanyAddress();
  const accountClient = useAccountQueryClient();
  const companies = useCompanies();
  const me = useQuery({ queryKey: ["me"], queryFn: () => taskaApi.getCurrentUser() }, accountClient ?? undefined);
  const [landing, setLanding] = useState<Landing>({ kind: "deciding" });
  const heading = useRef<HTMLHeadingElement>(null);
  const decided = useRef(false);

  // Unread: whatever the provider appended goes before anything else happens.
  useEffect(() => {
    if (location.search !== "") navigate({ pathname: location.pathname, hash: location.hash }, { replace: true, state: location.state });
  }, [location.search, location.pathname, location.hash, location.state, navigate]);

  const userId = me.data?.id ?? null;
  useEffect(() => {
    if (userId === null || decided.current || address === null) return;
    decided.current = true;
    void (async () => {
      let storage: Storage;
      try {
        storage = window.localStorage;
      } catch {
        setLanding({ kind: "none" });
        return;
      }
      const attempts = listCheckoutAttempts(storage, userId).filter((attempt) => attempt.checkoutId !== undefined);
      if (cancel && attempts[0]) attempts[0] = markLeft(storage, attempts[0]);
      if (attempts.length === 0) {
        setLanding({ kind: "none" });
        return;
      }
      if (attempts.length > 1) {
        setLanding({ kind: "several", attempts });
        return;
      }
      const attempt = attempts[0];
      const workspace = await taskaApi.settleWorkspace();
      if (workspace !== null && workspace.tenantId !== attempt.tenantId) {
        setLanding({ kind: "elsewhere", attempt });
        return;
      }
      if (attempt.returnTarget === "CREATION" && accountClient !== null) {
        let row: { lifecycle: string | null } | undefined;
        try {
          row = (await accountClient.fetchQuery(tenantsQueryOptions(taskaApi))).find((tenant) => tenant.id === attempt.tenantId);
        } catch {
          row = undefined;
        }
        // Opened already: the creation's payment is spent (B1); the address opens the app shell.
        if (row !== undefined && row.lifecycle !== null && !isNeverOpened(row.lifecycle)) closeCreationAttempts(storage, attempt.tenantId);
      }
      address.go(attemptTarget(attempt), { replace: true, state: { checkoutReturn: true } satisfies CheckoutReturnState });
    })();
  }, [userId, cancel, address, accountClient]);

  const unreadable = landing.kind === "deciding" && me.isError;
  useEffect(() => {
    if (landing.kind !== "deciding" || unreadable) heading.current?.focus();
  }, [landing.kind, unreadable]);

  const nameOf = (tenantId: string) => companies.data?.find((tenant) => tenant.id === tenantId)?.name ?? "this company";

  // The account could not be read, so neither can its records (N6): said, with the way on.
  if (unreadable) {
    const only = companies.data?.length === 1 ? companies.data[0] : null;
    return (
      <AuthShell entrance="app" theme={theme} toggleTheme={toggleTheme}>
        <div className="company-setup billing-return">
          <h1 className="auth-title" ref={heading} tabIndex={-1}>
            Payment
          </h1>
          <ErrorNote requestId={apiErrorFacts(me.error).requestId}>{CHECK_FAILED_TEXT}</ErrorNote>
          {only !== null ? (
            <AddressLink className="auth-ghost company-setup-all" path={companyRoute(only.id, "/company/billing")}>
              Open Billing
            </AddressLink>
          ) : (
            <AddressLink className="auth-ghost company-setup-all" path={COMPANIES_ROUTE} state={{ focusHeading: true, continuedShell: true }}>
              All companies
            </AddressLink>
          )}
        </div>
      </AuthShell>
    );
  }

  if (landing.kind === "deciding") {
    return (
      <main className="company-pending">
        <p className="visually-hidden" role="status">
          Opening Taska
        </p>
      </main>
    );
  }

  return (
    <AuthShell entrance="app" theme={theme} toggleTheme={toggleTheme}>
      <div className="company-setup billing-return">
        <h1 className="auth-title" ref={heading} tabIndex={-1}>
          Payment
        </h1>
        {landing.kind === "none" ? <p className="auth-text company-setup-text">{NO_ATTEMPT_TEXT}</p> : null}
        {landing.kind === "elsewhere" ? (
          // Never switched for the reader: the tab stays in its company; the link is theirs to follow.
          <p className="auth-text company-setup-text">
            {BELONGS_TO_TEXT}{" "}
            <AddressLink
              className="admin-note-link"
              path={attemptTarget(landing.attempt)}
              state={{ checkoutReturn: true } satisfies CheckoutReturnState}
            >
              {nameOf(landing.attempt.tenantId)}
            </AddressLink>
            .
          </p>
        ) : null}
        {landing.kind === "several" ? (
          <>
            <p className="auth-text company-setup-text">{SEVERAL_ATTEMPTS_TEXT}</p>
            <ul className="billing-return-list">
              {landing.attempts.map((attempt) => (
                <li key={`${attempt.tenantId}:${attempt.invoiceId}`}>
                  <AddressLink
                    className="admin-note-link billing-return-link"
                    path={attemptTarget(attempt)}
                    state={{ checkoutReturn: true } satisfies CheckoutReturnState}
                  >
                    {nameOf(attempt.tenantId)}
                  </AddressLink>
                  <span className="billing-return-when"> · started {formatDeadline(attempt.startedAt)}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        <AddressLink className="auth-ghost company-setup-all" path={COMPANIES_ROUTE} state={{ focusHeading: true, continuedShell: true }}>
          All companies
        </AddressLink>
      </div>
    </AuthShell>
  );
}
