import { useEffect, useRef } from "react";
import { ApiNotice } from "../components/ApiNotice";
import { appUrl, reloadAt } from "../lib/appLinks";

/**
 * What the app draws when a page throws while rendering (TAS-173,
 * art-director's ruling 4). Outside the shell, in place of the whole page: the
 * top bar and the global search are among the things that may have failed, so
 * nothing of the page is kept. §4.18's failure column — the by-key route's
 * (`IssueKeyScreen`) — with no mascot, because the mascot means "nothing is
 * here", and this is "something went wrong drawing it".
 *
 * Both ways out leave this React tree rather than travel inside it: "Reload"
 * reloads the page, and "Go to projects" loads the projects page from scratch
 * (`reloadAt`). Not a router push into the state that just failed — and not a
 * plain link either, because under the Pages build's hash routing following
 * `…/#/projects` is a same-document hash change: the router would move inside
 * this tree, and on `/projects` itself nothing would happen. It stays an
 * anchor with the real address, so it can still be copied, and a click with a
 * modifier or the middle button is left to the browser — a new tab is a full
 * load anyway. The detail line is the error's message and nothing more — the
 * stack goes to the console (`ErrorBoundary`).
 */
export function AppFailureScreen({ error }: { error: Error }) {
  const heading = useRef<HTMLHeadingElement>(null);
  // The page the reader was on is gone, with whatever had focus in it; the
  // heading is where they are now (§5.1's precedent for a page that replaces
  // itself without being asked).
  useEffect(() => heading.current?.focus(), []);
  const projectsUrl = appUrl("/projects");

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
          <a
            className="primary-button notfound-action"
            href={projectsUrl}
            onClick={(event) => {
              if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              reloadAt(projectsUrl);
            }}
          >
            Go to projects
          </a>
        </div>
      </div>
    </main>
  );
}
