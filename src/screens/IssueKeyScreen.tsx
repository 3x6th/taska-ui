import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useParams } from "react-router-dom";
import { taskaApi } from "../api/client";
import { apiErrorFacts, isMissingOrForbidden } from "../api/errors";
import { ApiNotice } from "../components/ApiNotice";
import { NotFoundScreen, type NotFoundReason } from "./NotFoundScreen";

/**
 * Same budget as the board's project reads: a 404 or a 403 is an answer, not a
 * transient failure, and re-asking it would hold the reader on a blank page for
 * a full retry delay before telling them (DESIGN.md §4.18). Anything else gets
 * the app's one retry.
 */
const retryUnlessMissing = (failureCount: number, error: Error) => !isMissingOrForbidden(error) && failureCount < 1;

/**
 * The short address of an issue: `/browse/API-5` (`#/browse/API-5` on Pages).
 *
 * A key is all this address carries, and the panel needs two ids — the issue's
 * and its project's — so the key is resolved first, with
 * `GET /issues/by-key/{issueKey}` (backend TAS-214), and the reader is then
 * sent on to the issue's own address, replacing this one in the history so
 * Back does not land on a page that only ever redirects. The project is never
 * guessed from the key's prefix: a prefix is a project *key*, not an id, and a
 * key nobody can see must not be turned into one by the client.
 *
 * Three outcomes, three screens:
 * - **found** — the board of the issue's project with its panel open;
 * - **no such issue** (404) and **not yours** (403) — the §4.18 screen, with
 *   one sentence for both. The two are told apart in code (`reason`, which the
 *   tests read) and deliberately not on screen: saying "you have no access"
 *   would confirm that the key names an issue in somebody else's project,
 *   which is exactly what §4.18 exists not to reveal;
 * - **anything else** — a failure that is not an answer about the issue at
 *   all, stated as one, with the server's words and the request id, and a way
 *   to ask again.
 *
 * While the key is being resolved nothing is drawn but the plane — the same
 * choice `/admin` makes for the same reason: a board drawn and then replaced is
 * "a second of plausible chrome" (§4.18). The words are for a screen reader.
 */
export function IssueKeyScreen() {
  const { issueKey = "" } = useParams();
  const query = useQuery({
    queryKey: ["issue-by-key", issueKey],
    queryFn: () => taskaApi.getIssueByKey(issueKey),
    retry: retryUnlessMissing,
  });

  if (query.data) {
    return <Navigate replace to={`/projects/${query.data.projectId}/issues/${query.data.id}`} />;
  }

  if (query.isError) {
    const reason = missingReason(query.error);
    if (reason) return <NotFoundScreen reason={reason} />;
    return (
      <main className="notfound-screen">
        <div className="notfound-content issue-key-failure">
          <h1 className="notfound-title">{issueKey} could not be opened</h1>
          <ApiNotice error={query.error}>The issue could not be looked up. Nothing is known about it yet.</ApiNotice>
          <div className="issue-key-actions">
            <button className="secondary-button" disabled={query.isFetching} onClick={() => void query.refetch()} type="button">
              Try again
            </button>
            <Link className="primary-button notfound-action" to="/projects">
              Go to projects
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="page-shell" aria-busy="true">
      <p className="visually-hidden" role="status">
        Opening {issueKey}
      </p>
    </main>
  );
}

/**
 * Which of the two answers §4.18 folds together this failure is, or `null`
 * for a failure that is neither. Read from both halves `apiErrorFacts` carries,
 * because the mock states a code and no status and the gateway states both.
 */
function missingReason(error: unknown): NotFoundReason | null {
  const { code, status } = apiErrorFacts(error);
  if (code === "PERMISSION_DENIED" || status === 403) return "forbidden";
  if (code === "NOT_FOUND" || status === 404) return "missing";
  return null;
}
