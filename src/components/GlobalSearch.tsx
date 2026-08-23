import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import type { KeyboardEvent } from "react";
import { useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SEARCH_QUERY_MIN_LENGTH } from "../api/TaskaApi";
import { taskaApi } from "../api/client";
import type { IssueSearchHit } from "../domain/types";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useDismissOnOutside } from "../hooks/useDismissOnOutside";
import { useUnanswered } from "../hooks/useUnanswered";
import { projectKeyFromIssueKey, typeMeta } from "../lib/format";
import { ApiNotice } from "./ApiNotice";
import { PriorityBars, TypeChip } from "./IssueBits";

/** DESIGN.md §4.14. The field is instant; only the request waits. */
const SEARCH_DEBOUNCE_MS = 200;
/**
 * A dropdown, not a results page: eight rows is what fits under the field
 * without becoming a scroller of its own. `totalCount` is what says how many
 * there really are, which is the part the reader would otherwise have to guess.
 */
const GLOBAL_SEARCH_PAGE_SIZE = 8;

/**
 * Search across every project the reader can see, from the shared top bar
 * (DESIGN.md §4.13 fixes its slot: after the spacer, before notifications and
 * the theme toggle).
 *
 * Not the board's search and deliberately not merged with it. The board's box
 * filters the issues it has already loaded, instantly and with no round trip;
 * this one asks `GET /issues/search` with no `projectId` and therefore answers
 * about projects the board has never read.
 *
 * A result is an `IssueSearchHit` and carries no `projectId`, so the route is
 * built by resolving the `issueKey` prefix against the projects list the client
 * already holds. A prefix that resolves to nothing is rendered without a link
 * rather than pointed at a guessed route.
 *
 * The widget is a combobox and behaves like one (§7): focus never leaves the
 * input, ArrowUp/ArrowDown move `aria-activedescendant` through the options,
 * Enter opens the active one, Escape closes and then clears, and a click
 * outside closes. Empty, loading, failed and none-found are four different
 * answers and read as four different things — a failed search is never
 * presented as "no results".
 */
export function GlobalSearch() {
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const trimmed = value.trim();
  const debounced = useDebouncedValue(trimmed, SEARCH_DEBOUNCE_MS);
  const longEnough = debounced.length >= SEARCH_QUERY_MIN_LENGTH;
  // The popup belongs to a field with something in it. An empty field has
  // nothing to say yet, and a panel saying so would cover the page on every
  // stray focus.
  const showPopup = open && trimmed.length > 0;

  const searchQuery = useQuery({
    queryKey: ["issue-search", "all-projects", debounced],
    enabled: showPopup && longEnough,
    // No `projectId`: this is the whole of what the reader can see. The API
    // layer refuses a query below the minimum before it reaches the wire, which
    // is why `enabled` and that guard agree on one exported constant.
    queryFn: () => taskaApi.searchIssues({ query: debounced, pageSize: GLOBAL_SEARCH_PAGE_SIZE }),
  });
  // Warmed on focus rather than with the first hit: it is the only thing that
  // turns a hit into a link, and asking for it at the same moment as the search
  // would spend the first result set as unlinkable rows. Shares its key with
  // the projects screen, so on `/projects` it costs nothing at all.
  const projectsQuery = useQuery({
    queryKey: ["projects"],
    enabled: open,
    queryFn: () => taskaApi.listProjects(),
  });

  const searchUnread = useUnanswered(searchQuery);
  const hits = useMemo(() => searchQuery.data?.items ?? [], [searchQuery.data]);
  const totalCount = searchQuery.data?.totalCount;
  /** The panel is showing rows, as opposed to showing one of the other three answers. */
  const listboxOpen = showPopup && hits.length > 0;

  // Lower-cased on both sides: project keys are upper-cased when a project is
  // created here, and the deployed gateway holds lower-case ones too
  // (`kappa-test`), so a case-sensitive lookup would silently stop linking.
  const projectIdByKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const project of projectsQuery.data ?? []) {
      map.set(project.projectKey.toLowerCase(), project.id);
    }
    return map;
  }, [projectsQuery.data]);

  const routes = useMemo(
    () =>
      hits.map((hit) => {
        const projectId = projectIdByKey.get(projectKeyFromIssueKey(hit.issueKey).toLowerCase());
        return projectId ? `/projects/${projectId}/issues/${hit.id}` : null;
      }),
    [hits, projectIdByKey],
  );

  // A new question deselects: an active row held over from the previous query
  // would put Enter on a result the reader is no longer looking at. Adjusting
  // state during render is the sanctioned pattern — React re-renders
  // immediately and commits once, where an effect would paint the stale
  // selection first.
  const [activeFor, setActiveFor] = useState(debounced);
  if (activeFor !== debounced) {
    setActiveFor(debounced);
    setActiveIndex(-1);
  }

  // Escape and a press outside, shared with the profile menu and the
  // notifications popover. The field keeps its own Escape branch below as
  // well: here that key has a second job — once the panel is gone, it clears
  // the question — and this hook only knows about the first.
  useDismissOnOutside(showPopup, rootRef, () => setOpen(false));

  const optionId = (index: number) => `${listId}-option-${index}`;

  const select = (index: number) => {
    const route = routes[index];
    if (!route) return;
    setOpen(false);
    // The question has been answered, so the field stops holding it. A global
    // field that keeps its text after navigating reads as a filter still
    // applied to the page it just opened.
    setValue("");
    setActiveIndex(-1);
    navigate(route);
  };

  const move = (delta: number) => {
    if (!hits.length) return;
    setActiveIndex((current) => {
      const next = current + delta;
      if (next < 0) return hits.length - 1;
      if (next >= hits.length) return 0;
      return next;
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!showPopup) {
        setOpen(true);
        return;
      }
      move(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Enter") {
      if (!showPopup || !hits.length) return;
      event.preventDefault();
      // Nothing chosen yet means the first thing the reader is looking at —
      // and the first one that can actually be opened, so Enter is never a
      // key that does nothing.
      const index = activeIndex >= 0 ? activeIndex : routes.findIndex((route) => route !== null);
      if (index >= 0) select(index);
      return;
    }
    if (event.key === "Escape") {
      // Two jobs, in the order the reader expects: the first press takes the
      // panel away, the second takes the question away.
      if (showPopup) {
        setOpen(false);
      } else if (value) {
        setValue("");
      }
      return;
    }
    if (event.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <div className="global-search" ref={rootRef}>
      <div className="search-box">
        <Search aria-hidden="true" size={15} />
        <input
          aria-activedescendant={listboxOpen && activeIndex >= 0 ? optionId(activeIndex) : undefined}
          aria-autocomplete="list"
          // Both track the *listbox*, not the panel. A combobox's popup has to
          // be a listbox (or a grid, tree or dialog) for `aria-expanded` to
          // mean anything, and the three states that are one sentence of text
          // are not one — they are announced by their own `role="status"`
          // instead. Pointing `aria-controls` at an id that only exists when
          // there are rows is the same rule read from the other end.
          aria-controls={listboxOpen ? listId : undefined}
          aria-expanded={listboxOpen}
          aria-label="Search issues in every project"
          autoComplete="off"
          onChange={(event) => {
            setValue(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Search issues"
          role="combobox"
          type="text"
          value={value}
        />
      </div>

      {showPopup ? (
        <div className="global-search-pop">
          {!longEnough ? (
            <p className="global-search-state" role="status">
              Type at least {SEARCH_QUERY_MIN_LENGTH} characters to search.
            </p>
          ) : searchUnread.unanswered ? (
            // Not zero results. A search that never answered says so, with the
            // server's own words and the id its log knows this failure by.
            <ApiNotice error={searchUnread.error} live="polite">
              This search could not be run.
            </ApiNotice>
          ) : searchQuery.isFetching && !hits.length ? (
            <p className="global-search-state" role="status">
              Searching every project…
            </p>
          ) : hits.length === 0 ? (
            <p className="global-search-state" role="status">
              No issues match “{debounced}”.
            </p>
          ) : null}

          {hits.length ? (
            <>
              <ul aria-label="Issue search results" className="global-search-list" id={listId} role="listbox">
                {hits.map((hit, index) => (
                  <GlobalSearchOption
                    active={index === activeIndex}
                    hit={hit}
                    id={optionId(index)}
                    key={hit.id}
                    linkable={routes[index] !== null}
                    onChoose={() => select(index)}
                    onHover={() => setActiveIndex(index)}
                  />
                ))}
              </ul>
              {/* The one number the dropdown could not otherwise state: how
                  many matches exist beyond the eight it can hold. */}
              <p className="global-search-foot" role="status">
                {totalCount !== undefined && totalCount > hits.length
                  ? `Showing ${hits.length} of ${totalCount} matches.`
                  : `${hits.length} ${hits.length === 1 ? "match" : "matches"}.`}
              </p>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * One hit, as an option of the listbox above — never a link or a button.
 *
 * Focus stays on the input for the whole life of a combobox (§7), so an option
 * that was itself focusable would put a second tab stop inside a widget the
 * arrow keys already drive. The keyboard path is ArrowUp/ArrowDown then Enter;
 * the pointer path is this click. `onMouseDown` is prevented so that clicking a
 * row does not blur the input and close the panel out from under the click.
 *
 * Everything drawn here is a field the hit actually carries. There is no status
 * and no project, so nothing pretends to either — and the assignee is a bare id
 * with no member list to resolve it against outside a project, so it is left
 * out rather than printed as a UUID.
 */
function GlobalSearchOption({
  active,
  hit,
  id,
  linkable,
  onChoose,
  onHover,
}: {
  active: boolean;
  hit: IssueSearchHit;
  id: string;
  linkable: boolean;
  onChoose: () => void;
  onHover: () => void;
}) {
  return (
    <li
      aria-disabled={linkable ? undefined : true}
      aria-selected={active}
      className={`global-search-option ${active ? "is-active" : ""}`}
      id={id}
      onClick={onChoose}
      onMouseDown={(event) => event.preventDefault()}
      onMouseEnter={onHover}
      role="option"
    >
      <TypeChip type={hit.issueType} />
      <span className="global-search-key">{hit.issueKey}</span>
      <span className="global-search-summary">{hit.summary}</span>
      <span className="visually-hidden">
        {typeMeta[hit.issueType].label}, {hit.priority.toLowerCase()} priority
      </span>
      {linkable ? null : <span className="global-search-note">Project unknown</span>}
      <PriorityBars priority={hit.priority} />
    </li>
  );
}
