import { Link, useLocation } from "react-router-dom";
import { useCompanies, useWorkspace } from "../hooks/useCompanies";
import { AddressLink } from "../components/CompanyRouter";
import { useCompanyAddress } from "../lib/companyAddress";
import { NotFoundMascot } from "../components/NotFoundMascot";
import { COMPANIES_ROUTE, companyRoute } from "../lib/companies";

/**
 * Why a screen that says one thing was shown. Never drawn: §4.18 folds the two
 * together on purpose. It is carried so a caller that does know the difference
 * — the by-key route, which gets a 404 and a 403 from two different checks —
 * keeps it somewhere a test can read, rather than collapsing it before anyone
 * could tell the two branches apart.
 */
export type NotFoundReason = "missing" | "forbidden";

/**
 * DESIGN.md §4.18. Full-screen route outside the app shell, used both for an
 * unknown URL (`*`) and for a board whose project answers NOT_FOUND /
 * PERMISSION_DENIED. One sentence covers both cases on purpose: telling a
 * missing project apart from a forbidden one would confirm that somebody
 * else's project exists.
 */
export function NotFoundScreen({ reason }: { reason?: NotFoundReason } = {}) {
  const address = useCompanyAddress();
  return (
    // <main>, like every other screen root: on the board path this replaces the
    // whole shell, so a <div> here would leave the document with no landmark.
    <main className="notfound-screen" data-reason={reason}>
      <div className="notfound-content">
        <NotFoundMascot />
        <h1 className="notfound-title">Page not found</h1>
        <p className="notfound-text">This page doesn&rsquo;t exist, or you don&rsquo;t have access to it.</p>
        {address ? (
          <CompanyWayOut />
        ) : (
          // A real link, not a button: it navigates, so it has to be
          // middle-clickable, copyable, and reachable as a link (§4.18).
          <Link to="/projects" className="primary-button notfound-action">
            Go to projects
          </Link>
        )}
      </div>
    </main>
  );
}

/**
 * The companies build's way out (TAS-500, §4.18): «Go to projects» is the
 * tab's company's; a tab without one is offered «Choose a company». An address
 * that came without a company and was opened in the tab's (§5.1) says it may
 * be in another, for a reader who has more than one. A foreign company is not
 * named here — this screen is the same for it.
 */
function CompanyWayOut() {
  const address = useCompanyAddress();
  const location = useLocation();
  const workspace = useWorkspace();
  const companies = useCompanies();
  const inCompany = address?.companyId != null;
  const withoutCompany = inCompany && (location.state as { withoutCompany?: unknown } | null)?.withoutCompany === true;
  const elsewhere = withoutCompany && (companies.data?.length ?? 0) >= 2;

  const primary = inCompany ? (
    <Link to="/projects" className="primary-button notfound-action">
      Go to projects
    </Link>
  ) : workspace ? (
    <AddressLink className="primary-button notfound-action" path={companyRoute(workspace.tenantId)}>
      Go to projects
    </AddressLink>
  ) : (
    <AddressLink className="primary-button notfound-action" path={COMPANIES_ROUTE} state={{ focusHeading: true }}>
      Choose a company
    </AddressLink>
  );

  if (!elsewhere) return primary;
  return (
    <>
      <p className="notfound-text">If it&rsquo;s in another company, choose that company and open the link again.</p>
      <div className="issue-key-actions">
        <AddressLink className="secondary-button notfound-secondary" path={COMPANIES_ROUTE} state={{ focusHeading: true }}>
          Choose a company
        </AddressLink>
        {primary}
      </div>
    </>
  );
}
