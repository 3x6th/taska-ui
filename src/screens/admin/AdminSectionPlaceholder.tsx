import { TaskaMascot } from "../../components/TaskaMascot";
import type { AdminSection } from "./sections";
import { jiraUrl } from "./sections";

/**
 * DESIGN.md §4.19 — a section that is already in the navigation but has no
 * endpoints yet. It lives *inside* the admin shell: rail, top bar and section
 * heading stay, and only the body is empty. That is what separates it from
 * §4.18, which replaces everything.
 *
 * One component for all the empty sections; only the name and the story key
 * differ. When a section gets its endpoints, the placeholder goes away together
 * with its row in §5.8 — it does not stay behind a flag.
 *
 * There are no buttons on purpose: the placeholder offers nothing to do,
 * because the only sensible action is to go to another section and that is
 * already in the rail.
 */
export function AdminSectionPlaceholder({ section }: { section: AdminSection }) {
  return (
    <div className="admin-placeholder">
      {/* §4.19: the Taska cube in a hard hat, with the barrier, the beacon and
          the blueprint. Same character as §4.18 and composited the same way, so
          it follows `--accent` — except the beacon, which stays amber on
          purpose (see TaskaMascot). Decorative, and it has no animation of its
          own: the beacon is already lit in the render, and a blinking element
          in a service section is exactly what §1 asks to avoid. */}
      <TaskaMascot className="admin-placeholder-mascot" name="building" />
      <h2 className="admin-placeholder-title">{section.label} — under construction</h2>
      {/* One sentence and the key of the story that opens the section. The key
          is on screen because the only person who reads this screen is also the
          one who can go and ask about its status. */}
      <p className="admin-placeholder-text">
        The gateway has no endpoints for it yet. It opens with {storyList(section.stories)}.
      </p>
    </div>
  );
}

/** «TAS-107 and TAS-108», each key a link into Jira. */
function storyList(stories: string[]) {
  return stories.map((key, index) => (
    <span key={key}>
      {index > 0 ? (index === stories.length - 1 ? " and " : ", ") : null}
      <a className="admin-placeholder-link" href={jiraUrl(key)} rel="noreferrer" target="_blank">
        {key}
      </a>
    </span>
  ));
}
