import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
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
 *
 * **Once the lookup has failed, the failure screen stays mounted until it
 * succeeds** (art-director, TAS-246). react-query puts a query with no data
 * back to `pending` when it refetches and clears its `error`, which used to
 * swap this screen for the plane on "Try again": the button unmounted under the
 * reader's focus, focus fell to `<body>`, `tk-pop` replayed, and a second
 * failure arrived unfocused and unannounced. So:
 *
 * - the plane is drawn only for the key's *first* resolution
 *   (`errorUpdateCount === 0`); after that the failure is drawn, from the last
 *   error when react-query has cleared it, and nothing in it remounts;
 * - "Try again" is `aria-disabled` while its request is out — never `disabled`,
 *   which takes focus away in Chromium (§4.21) — and does nothing when pressed
 *   again; its label does not change;
 * - a repeated failure updates the server's words and the request id in place,
 *   outside any live region, and is said once through a persistent status
 *   region that the press empties: "{KEY} still could not be opened.";
 * - the heading takes focus only if focus has somehow ended up on `<body>`.
 *
 * Only the first resolution gets the app's hidden retry. A press is the reader
 * asking again, and making them wait through a second, silent attempt would
 * double the time the button spends off.
 */
export function IssueKeyScreen() {
  const { issueKey = "" } = useParams();
  const queryClient = useQueryClient();
  const queryKey = ["issue-by-key", issueKey];
  const query = useQuery({
    queryKey,
    queryFn: () => taskaApi.getIssueByKey(issueKey),
    retry: (failureCount: number, error: Error) =>
      (queryClient.getQueryState(queryKey)?.errorUpdateCount ?? 0) === 0 && retryUnlessMissing(failureCount, error),
  });
  const failures = query.errorUpdateCount;
  /** The last failure, kept because react-query clears `error` when a no-data query refetches. */
  const [lastError, setLastError] = useState<Error | null>(null);
  if (query.error && query.error !== lastError) setLastError(query.error);
  /** How many failures there had been when "Try again" was last pressed; `null` before any press. */
  const [pressedAt, setPressedAt] = useState<number | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    // The fallback, not the plan: the button keeps focus through a retry. Only
    // a focus that has been dropped is picked up.
    if (failures > 1 && document.activeElement === document.body) heading.current?.focus();
  }, [failures]);

  if (query.data) {
    return <Navigate replace to={`/projects/${query.data.projectId}/issues/${query.data.id}`} />;
  }

  const error = query.error ?? lastError;
  if (failures > 0 && error) {
    const reason = missingReason(error);
    if (reason) return <NotFoundScreen reason={reason} />;
    const retrying = query.isFetching;
    const stillFailing = pressedAt !== null && failures > pressedAt;
    return (
      <main aria-busy={retrying || undefined} className="notfound-screen">
        <div className="notfound-content issue-key-failure">
          <h1 className="notfound-title" ref={heading} tabIndex={-1}>
            {issueKey} could not be opened
          </h1>
          <ApiNotice error={error}>The issue could not be looked up. Nothing is known about it yet.</ApiNotice>
          {/* Mounted with the screen and only its text changes, so a repeat is
              announced once — emptied by the press, filled by the answer. */}
          <p className="visually-hidden issue-key-status" role="status">
            {stillFailing ? `${issueKey} still could not be opened.` : ""}
          </p>
          <div className="issue-key-actions">
            <button
              aria-disabled={retrying || undefined}
              className="secondary-button issue-key-retry"
              onClick={() => {
                if (retrying) return;
                setPressedAt(failures);
                void query.refetch();
              }}
              type="button"
            >
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
