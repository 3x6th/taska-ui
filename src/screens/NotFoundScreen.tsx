import { Link } from "react-router-dom";
import { NotFoundMascot } from "../components/NotFoundMascot";

/**
 * DESIGN.md §4.18. Full-screen route outside the app shell, used both for an
 * unknown URL (`*`) and for a board whose project answers NOT_FOUND /
 * PERMISSION_DENIED. One sentence covers both cases on purpose: telling a
 * missing project apart from a forbidden one would confirm that somebody
 * else's project exists.
 */
export function NotFoundScreen() {
  return (
    // <main>, like every other screen root: on the board path this replaces the
    // whole shell, so a <div> here would leave the document with no landmark.
    <main className="notfound-screen">
      <div className="notfound-content">
        <NotFoundMascot />
        <h1 className="notfound-title">Page not found</h1>
        <p className="notfound-text">This page doesn&rsquo;t exist, or you don&rsquo;t have access to it.</p>
        {/* A real link, not a button: it navigates, so it has to be
            middle-clickable, copyable, and reachable as a link (§4.18). */}
        <Link to="/projects" className="primary-button notfound-action">
          Go to projects
        </Link>
      </div>
    </main>
  );
}
