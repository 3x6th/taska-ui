import { useEffect, useRef } from "react";
import { ApiNotice } from "../components/ApiNotice";
import { appUrl } from "../lib/appLinks";

/**
 * What the app draws when a page throws while rendering (TAS-173,
 * art-director's ruling 4). Outside the shell, in place of the whole page: the
 * top bar and the global search are among the things that may have failed, so
 * nothing of the page is kept. §4.18's failure column — the by-key route's
 * (`IssueKeyScreen`) — with no mascot, because the mascot means "nothing is
 * here", and this is "something went wrong drawing it".
 *
 * Both ways out leave this React tree rather than travel inside it: "Reload"
 * reloads the page, and "Go to projects" is a real link to the app's own
 * address, a full navigation, not a router push into the state that just
 * failed. The detail line is the error's message and nothing more — the stack
 * goes to the console (`ErrorBoundary`).
 */
export function AppFailureScreen({ error }: { error: Error }) {
  const heading = useRef<HTMLHeadingElement>(null);
  // The page the reader was on is gone, with whatever had focus in it; the
  // heading is where they are now (§5.1's precedent for a page that replaces
  // itself without being asked).
  useEffect(() => heading.current?.focus(), []);

  return (
    <main className="notfound-screen">
      <div className="notfound-content issue-key-failure">
        <h1 className="notfound-title" ref={heading} tabIndex={-1}>
          This page could not be shown
        </h1>
        <ApiNotice error={error} live="polite">
          Taska hit an error while drawing this page. Reloading usually clears it; if it comes back, the line below is
          what to report.
        </ApiNotice>
        <div className="issue-key-actions">
          <button className="secondary-button" onClick={() => window.location.reload()} type="button">
            Reload
          </button>
          <a className="primary-button notfound-action" href={appUrl("/projects")}>
            Go to projects
          </a>
        </div>
      </div>
    </main>
  );
}
