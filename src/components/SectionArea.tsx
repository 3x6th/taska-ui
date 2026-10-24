import { ArrowLeft, type LucideIcon } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";

/** One section of an area: what the rail links to and the heading names. */
export interface AreaSection {
  id: string;
  label: string;
  path: string;
  icon: LucideIcon;
}

/**
 * An area with sections rather than a screen (DESIGN.md §5.8): the rail on the
 * left, the section's heading, and the section's own body under it. Written
 * once for `/admin` and `/settings` (TAS-380, art-director's ruling 3) — the
 * rail, its exit and the heading are one recipe, and two copies of it are how
 * the second area's rail would come to drift from the first's.
 *
 * It stays inside the app shell (§5.1): the caller draws the top bar above it.
 */
export function SectionArea({
  name,
  sections,
  current,
  aside,
  className,
  children,
}: {
  /** The area's own name: the rail's `aria-label` and the crumb in the heading. */
  name: string;
  sections: readonly AreaSection[];
  /** The section the router is showing. */
  current: AreaSection;
  /** Beside the heading, on its baseline — the admin's `read-only` marker. */
  aside?: ReactNode;
  /** For the one thing an area may set apart: its own narrow-width insets. */
  className?: string;
  children: ReactNode;
}) {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const railRef = useRef<HTMLElement>(null);
  const lastSectionId = useRef<string | null>(null);

  useEffect(() => {
    // Below 900 the rail is a strip that scrolls sideways, and the section
    // shown could sit past its edge — at 320 the current Settings section was
    // cut by 19 (§5.8). So the current link is brought into the strip, on
    // arrival and on every move between sections. `nearest` on both axes: on
    // an axis where the link is already in view nothing moves, and the strip
    // sits at the top of an area that does not scroll the page, so only the
    // strip does. No `behavior`, so it jumps rather than glides, with or
    // without reduced motion; and no focus moves — the heading below takes it.
    railRef.current
      ?.querySelector<HTMLElement>('[aria-current="page"]')
      ?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [current.id]);

  useEffect(() => {
    // Moving between sections replaces the whole body while the keyboard stays
    // wherever the rail left it, and a screen reader is told nothing at all —
    // so focus goes to the new section's heading (§7). Deliberately *not* on
    // every route change inside the area: choosing a table in the Data catalog
    // also changes the URL, and yanking focus out of the list on every arrow
    // press would make the catalog unusable from the keyboard.
    const previous = lastSectionId.current;
    lastSectionId.current = current.id;
    // Not on arrival: focus that moves before the user has done anything is a
    // jump they did not ask for.
    if (previous === null || previous === current.id) return;
    headingRef.current?.focus();
  }, [current]);

  return (
    <div className={className ? `area ${className}` : "area"}>
      <nav aria-label={name} className="area-rail" ref={railRef}>
        <ul>
          {sections.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.id}>
                {/* NavLink rather than Link: it states `aria-current="page"`
                    from the match itself, so the rail cannot claim a section
                    the router is not showing. Prefix matching is what keeps
                    Data marked while a table is open. */}
                <NavLink className="area-rail-link" to={item.path}>
                  <Icon aria-hidden="true" size={15} />
                  {item.label}
                </NavLink>
              </li>
            );
          })}
        </ul>
        {/* The way out of the area belongs to the area, not to whichever
            section happens to be open (§5.8). */}
        <div className="area-rail-foot">
          <Link className="area-rail-link area-rail-exit" to="/projects">
            <ArrowLeft aria-hidden="true" size={15} />
            Back to projects
          </Link>
        </div>
      </nav>

      <section aria-labelledby={headingId} className="area-section">
        <header className="area-section-head">
          {/* The area names itself, not only the section: «Data» on its own
              reads as one more product screen (§5.8). Both parts live inside
              the h1 — the reason the crumb exists is just as true in the
              accessibility tree, and a sibling <p> would leave the heading
              announced as the bare section name. The crumb is text, not a link,
              because the area's own address only redirects into a section.

              tabIndex -1 so the effect above can put focus here; it is not in
              the tab order and never takes focus from a pointer. */}
          <h1 className="area-section-title" id={headingId} ref={headingRef} tabIndex={-1}>
            <span className="area-crumb">
              {name}
              <span aria-hidden="true"> ›</span>
            </span>
            <span className="area-section-name">{current.label}</span>
          </h1>
          {aside}
        </header>
        {children}
      </section>
    </div>
  );
}
